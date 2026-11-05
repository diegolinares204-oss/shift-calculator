import type { ShiftDB } from "@/db/schema";
import { CURRENT_DB_VERSION, TABLE_NAMES, type TableName } from "@/db/schema";
import { isDateKey, isLocalDateTime } from "./time";
import { migrateToJobs } from "./jobs";

export const BACKUP_APP = "shift-calculator";
export const BACKUP_FORMAT = 1;

export interface Backup {
  app: typeof BACKUP_APP;
  format: number;
  dbVersion: number;
  exportedAt: string;
  data: Partial<Record<TableName, Record<string, unknown>[]>>;
}

export async function createBackup(db: ShiftDB): Promise<Backup> {
  const data: Backup["data"] = {};
  await db.transaction("r", TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) data[t] = await db.table(t).toArray();
  });
  return { app: BACKUP_APP, format: BACKUP_FORMAT, dbVersion: CURRENT_DB_VERSION, exportedAt: new Date().toISOString(), data };
}

type Check = (r: Record<string, unknown>) => string | null;

const isStr = (v: unknown) => typeof v === "string";
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isBlock = (b: unknown) => {
  if (!b || typeof b !== "object") return false;
  const x = b as Record<string, unknown>;
  return isLocalDateTime(x.start) && isLocalDateTime(x.end) && Array.isArray(x.breaks) && (x.breaks as Record<string, unknown>[]).every((y) => isLocalDateTime(y.start) && isLocalDateTime(y.end) && typeof y.paid === "boolean");
};

const CHECKS: Partial<Record<TableName, Check>> = {
  jobs: (r) => (!isStr(r.name) ? "nombre" : !isStr(r.color) ? "color" : null),
  shifts: (r) => (!isDateKey(r.date) ? "fecha" : !isBlock(r.planned) ? "horario previsto" : r.actual != null && !isBlock(r.actual) ? "horario real" : !["planned", "done", "cancelled"].includes(r.status as string) ? "estado" : null),
  clockSessions: (r) => (!isNum(r.startAt) ? "entrada" : r.endAt !== null && !isNum(r.endAt) ? "salida" : null),
  clockBreaks: (r) => (!isStr(r.sessionId) || !isNum(r.startAt) ? "descanso" : null),
  payslips: (r) => (!/^\d{4}-\d{2}$/.test(String(r.period)) ? "periodo" : !isNum(r.grossCents) ? "bruto" : null),
  absences: (r) => (!isDateKey(r.startDate) || !isDateKey(r.endDate) ? "fechas" : !isStr(r.type) ? "tipo" : null),
  holidays: (r) => (!isDateKey(r.date) ? "fecha" : !isStr(r.name) ? "nombre" : null),
  contracts: (r) => (!isDateKey(r.validFrom) ? "fecha de inicio" : !isNum(r.weeklyMinutes) ? "horas semanales" : null),
  complements: (r) => (!isStr(r.contractId) ? "contrato" : null),
  templates: (r) => (!isStr(r.name) ? "nombre" : null),
  hourAdjustments: (r) => (!isDateKey(r.date) || !isNum(r.minutes) ? "ajuste" : null),
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  counts: Partial<Record<TableName, number>>;
}

export function validateBackup(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const counts: ValidationResult["counts"] = {};
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["El archivo no contiene un objeto JSON válido."], counts };
  const b = raw as Record<string, unknown>;
  if (b.app !== BACKUP_APP) errors.push("El archivo no es una copia de seguridad de SHIFT CALCULATOR.");
  if (typeof b.format !== "number" || b.format > BACKUP_FORMAT) errors.push("Formato de copia no compatible con esta versión.");
  if (typeof b.dbVersion !== "number" || b.dbVersion > CURRENT_DB_VERSION) errors.push("La copia procede de una versión más reciente de la aplicación.");
  if (!b.data || typeof b.data !== "object") {
    errors.push("La copia no contiene datos.");
    return { ok: false, errors, counts };
  }
  const data = b.data as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    if (!(TABLE_NAMES as readonly string[]).includes(key)) {
      errors.push(`Tabla desconocida: ${key}`);
      continue;
    }
    const t = key as TableName;
    const rows = data[t];
    if (!Array.isArray(rows)) { errors.push(`La tabla ${t} no es una lista.`); continue; }
    counts[t] = rows.length;
    const check = CHECKS[t];
    rows.forEach((r, i) => {
      if (!r || typeof r !== "object" || typeof (r as Record<string, unknown>).id !== "string") {
        errors.push(`${t}[${i}]: registro sin identificador.`);
        return;
      }
      const e = check?.(r as Record<string, unknown>);
      if (e) errors.push(`${t}[${i}]: campo no válido (${e}).`);
    });
  }
  return { ok: errors.length === 0, errors: errors.slice(0, 50), counts };
}

export interface ImportStats {
  added: number;
  skipped: number;
  byTable: Partial<Record<TableName, { added: number; skipped: number }>>;
}

/** Clave de contenido para detectar duplicados aunque tengan distinto id. */
function contentKey(t: TableName, r: Record<string, unknown>): string | null {
  switch (t) {
    case "shifts": {
      const p = r.planned as { start: string; end: string };
      return `${r.jobId}|${p.start}|${p.end}`;
    }
    case "payslips": return `${r.jobId}|${r.period}`;
    case "holidays": return `${r.date}|${String(r.name).toLowerCase()}`;
    case "clockSessions": return String(r.startAt);
    case "absences": return `${r.jobId ?? "*"}|${r.type}|${r.startDate}|${r.endDate}`;
    default: return null;
  }
}

/**
 * Importa una copia validada.
 *  - "merge": añade solo registros nuevos (por id y por contenido). La configuración y el perfil
 *    actuales se conservan.
 *  - "replace": borra todos los datos actuales y restaura la copia (pedir confirmación antes).
 */
export async function importBackup(db: ShiftDB, backup: Backup, mode: "merge" | "replace"): Promise<ImportStats> {
  const v = validateBackup(backup);
  if (!v.ok) throw new Error(v.errors.join("\n"));
  // copias anteriores a los varios trabajos: se adaptan igual que la base de datos
  if (backup.dbVersion < 3) backup = { ...backup, data: migrateToJobs(backup.data as Record<string, Record<string, unknown>[]>) as Backup["data"] };
  const stats: ImportStats = { added: 0, skipped: 0, byTable: {} };
  await db.transaction("rw", TABLE_NAMES.map((t) => db.table(t)), async () => {
    if (mode === "replace") for (const t of TABLE_NAMES) await db.table(t).clear();
    for (const t of TABLE_NAMES) {
      const rows = (backup.data[t] ?? []) as Record<string, unknown>[];
      const s = { added: 0, skipped: 0 };
      if (mode === "replace") {
        if (rows.length) await db.table(t).bulkPut(rows);
        s.added = rows.length;
      } else {
        const existing = (await db.table(t).toArray()) as Record<string, unknown>[];
        const ids = new Set(existing.map((r) => r.id as string));
        const keys = new Set(existing.map((r) => contentKey(t, r)).filter(Boolean) as string[]);
        const toAdd: Record<string, unknown>[] = [];
        for (const r of rows) {
          const k = contentKey(t, r);
          if (ids.has(r.id as string) || (k && keys.has(k)) || ((t === "settings" || t === "profile") && existing.length > 0)) { s.skipped++; continue; }
          ids.add(r.id as string);
          if (k) keys.add(k);
          toAdd.push(r);
        }
        // los descansos de fichaje solo se importan si su fichaje existe
        let final = toAdd;
        if (t === "clockBreaks") {
          const sessions = new Set(((await db.clockSessions.toArray()) as { id: string }[]).map((x) => x.id));
          final = toAdd.filter((b) => sessions.has(b.sessionId as string));
          s.skipped += toAdd.length - final.length;
        }
        if (final.length) await db.table(t).bulkPut(final);
        s.added = final.length;
      }
      stats.byTable[t] = s;
      stats.added += s.added;
      stats.skipped += s.skipped;
    }
  });
  return stats;
}
