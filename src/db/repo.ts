import { ShiftDB, TABLE_NAMES } from "./schema";
import { joinContract, splitContract } from "./rows";
import type { Job, AuditEntry, BreakInterval, ClockSession, Contract, Shift, ShiftSpec, Template, TimeBlock } from "@/lib/types";
import { uid } from "@/lib/id";
import { defaultContract, defaultProfile, defaultSettings } from "@/lib/defaults";
import { MAIN_JOB_ID, makeJob, nextJobColor } from "@/lib/jobs";
import { addDays, dateRange, diffDays, fmtDateTimeEpoch, startOfWeek, toLocalDateTime, weekdayOf, dateOf, minutesBetween } from "@/lib/time";
import { findOverlaps, isDuplicate, shiftBlockToDate, specToBlock } from "@/lib/shifts";

let instance: ShiftDB | null = null;

export function getDb(): ShiftDB {
  if (!instance) instance = new ShiftDB();
  return instance;
}

/** Solo para pruebas: usar una base de datos concreta. */
export function setDb(db: ShiftDB | null) {
  instance = db;
}

export async function ensureInitialized(db = getDb()) {
  await db.transaction("rw", db.settings, db.profile, db.jobs, async () => {
    if (!(await db.settings.get("app"))) await db.settings.put(defaultSettings());
    if (!(await db.profile.get("main"))) await db.profile.put(defaultProfile());
    // siempre existe al menos un trabajo
    if ((await db.jobs.count()) === 0) await db.jobs.put(makeJob({ id: MAIN_JOB_ID, name: "Trabajo principal" }));
  });
}

// ------------------------------------------------------------------ trabajos

export async function loadJobs(db = getDb()): Promise<Job[]> {
  return (await db.jobs.toArray()).sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export async function createJob(partial: Partial<Job>, opts: { copyContractFrom?: Contract | null; validFrom: string }, db = getDb()): Promise<Job> {
  const jobs = await loadJobs(db);
  const job = makeJob({ order: (jobs[jobs.length - 1]?.order ?? -1) + 1, color: nextJobColor(jobs), ...partial });
  await db.jobs.put(job);
  const base = opts.copyContractFrom
    ? { ...structuredClone(opts.copyContractFrom), otherComplements: opts.copyContractFrom.otherComplements.map((x) => ({ ...x, id: uid() })), deductions: opts.copyContractFrom.deductions.map((x) => ({ ...x, id: uid() })) }
    : defaultContract(opts.validFrom, job.id);
  await saveContract({ ...base, id: uid(), jobId: job.id, validFrom: opts.validFrom, createdAt: Date.now(), updatedAt: Date.now() }, db);
  return job;
}

/** Elimina un trabajo y TODOS sus datos (contratos, turnos, fichajes, nóminas, ajustes y ausencias propias). */
export async function deleteJob(jobId: string, db = getDb()) {
  const others = (await db.jobs.toArray()).filter((j) => j.id !== jobId);
  if (others.length === 0) throw new Error("Debe quedar al menos un trabajo.");
  await db.transaction("rw", [db.jobs, db.contracts, db.complements, db.shifts, db.clockSessions, db.clockBreaks, db.payslips, db.hourAdjustments, db.absences, db.settings], async () => {
    const contracts = await db.contracts.where("jobId").equals(jobId).primaryKeys();
    for (const c of contracts) await db.complements.where("contractId").equals(c).delete();
    await db.contracts.bulkDelete(contracts);
    await db.shifts.where("jobId").equals(jobId).delete();
    const sessions = await db.clockSessions.where("jobId").equals(jobId).primaryKeys();
    for (const s of sessions) await db.clockBreaks.where("sessionId").equals(s).delete();
    await db.clockSessions.bulkDelete(sessions);
    await db.payslips.where("jobId").equals(jobId).delete();
    await db.hourAdjustments.where("jobId").equals(jobId).delete();
    await db.absences.where("jobId").equals(jobId).delete();
    await db.jobs.delete(jobId);
    const st = await db.settings.get("app");
    if (st && st.activeJobId === jobId) await db.settings.put({ ...st, activeJobId: "all" });
  });
}

// ------------------------------------------------------------------ auditoría

export async function audit(entry: Omit<AuditEntry, "id" | "at">, db = getDb()) {
  await db.auditLog.put({ id: uid(), at: Date.now(), ...entry });
}

// ------------------------------------------------------------------ contratos

export async function loadContracts(db = getDb()): Promise<Contract[]> {
  const [rows, comps] = await Promise.all([db.contracts.toArray(), db.complements.toArray()]);
  return rows.map((r) => joinContract(r, comps)).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}

export async function saveContract(c: Contract, db = getDb()) {
  const { row, complements } = splitContract({ ...c, updatedAt: Date.now() });
  await db.transaction("rw", db.contracts, db.complements, async () => {
    await db.contracts.put(row);
    await db.complements.where("contractId").equals(c.id).delete();
    if (complements.length) await db.complements.bulkPut(complements);
  });
}

export async function deleteContract(id: string, db = getDb()) {
  await db.transaction("rw", db.contracts, db.complements, async () => {
    await db.contracts.delete(id);
    await db.complements.where("contractId").equals(id).delete();
  });
}

// ------------------------------------------------------------------ turnos

export function newShift(jobId: string, date: string, planned: TimeBlock, partial: Partial<Shift> = {}): Shift {
  const now = Date.now();
  return {
    id: uid(), jobId, date, planned, actual: null, kind: "normal", status: "planned", notes: "", tags: [],
    templateId: null, seriesId: null, overlapConfirmed: false, createdAt: now, updatedAt: now, ...partial,
  };
}

export async function saveShift(shift: Shift, db = getDb()) {
  const prev = await db.shifts.get(shift.id);
  const next = { ...shift, date: dateOf(shift.planned.start), updatedAt: Date.now() };
  await db.shifts.put(next);
  if (prev) await audit({ entity: "shift", entityId: shift.id, action: "update", summary: describeShiftChange(prev, next), reason: "" }, db);
}

function describeShiftChange(a: Shift, b: Shift): string {
  const parts: string[] = [];
  if (a.planned.start !== b.planned.start || a.planned.end !== b.planned.end) parts.push(`Horario previsto ${a.planned.start.slice(11)}–${a.planned.end.slice(11)} → ${b.planned.start.slice(11)}–${b.planned.end.slice(11)}`);
  if (a.date !== b.date) parts.push(`Fecha ${a.date} → ${b.date}`);
  if (a.status !== b.status) parts.push(`Estado ${a.status} → ${b.status}`);
  if (JSON.stringify(a.actual) !== JSON.stringify(b.actual)) parts.push("Horario real modificado");
  return parts.join("; ") || "Turno editado";
}

export async function deleteShift(id: string, db = getDb()) {
  const prev = await db.shifts.get(id);
  await db.shifts.delete(id);
  if (prev) await audit({ entity: "shift", entityId: id, action: "delete", summary: `Turno del ${prev.date} eliminado`, reason: "" }, db);
}

export async function duplicateShift(id: string, targetDate: string, db = getDb()): Promise<Shift | null> {
  const src = await db.shifts.get(id);
  if (!src) return null;
  const planned = shiftBlockToDate(src.planned, targetDate);
  const copy = newShift(src.jobId, targetDate, planned, { kind: src.kind, notes: src.notes, tags: [...src.tags], templateId: src.templateId ?? null });
  await db.shifts.put(copy);
  return copy;
}

export interface BulkResult {
  created: Shift[];
  skippedDuplicates: string[];
  overlaps: string[];
}

/**
 * Crea turnos en lote evitando duplicados exactos. Los solapamientos se crean solo si
 * `allowOverlaps` es verdadero (el usuario ha confirmado la excepción).
 */
/** Cada elemento lleva el trabajo al que pertenece. Duplicados y solapamientos se comprueban dentro del mismo trabajo. */
export async function createShiftsBulk(items: { jobId: string; date: string; block: TimeBlock; partial?: Partial<Shift> }[], opts: { allowOverlaps: boolean }, db = getDb()): Promise<BulkResult> {
  const res: BulkResult = { created: [], skippedDuplicates: [], overlaps: [] };
  await db.transaction("rw", db.shifts, async () => {
    const dates = items.map((i) => i.date).sort();
    const existing = dates.length ? await db.shifts.where("date").between(addDays(dates[0], -2), addDays(dates[dates.length - 1], 2), true, true).toArray() : [];
    for (const it of items) {
      const sameJob = existing.filter((x) => x.jobId === it.jobId);
      if (isDuplicate(it.block, sameJob)) { res.skippedDuplicates.push(it.date); continue; }
      const ov = findOverlaps(it.block, sameJob);
      if (ov.length) {
        res.overlaps.push(it.date);
        if (!opts.allowOverlaps) continue;
      }
      const s = newShift(it.jobId, it.date, it.block, { ...it.partial, overlapConfirmed: ov.length > 0 });
      existing.push(s);
      res.created.push(s);
    }
    if (res.created.length) await db.shifts.bulkPut(res.created);
  });
  return res;
}

/** Copia los turnos de un día a otros días (opcionalmente solo los de un trabajo). */
export async function copyDayTo(sourceDate: string, targets: string[], opts: { allowOverlaps: boolean; jobId?: string | null }, db = getDb()) {
  const src = (await db.shifts.where("date").equals(sourceDate).toArray()).filter((s) => s.status !== "cancelled" && (!opts.jobId || s.jobId === opts.jobId));
  const items = targets.flatMap((t) => src.map((s) => ({ jobId: s.jobId, date: t, block: shiftBlockToDate(s.planned, t), partial: { kind: s.kind, tags: [...s.tags], notes: s.notes } })));
  return createShiftsBulk(items, opts, db);
}

/** Duplica todos los turnos de la semana que empieza en `srcMonday` en `weeks` semanas consecutivas a partir de `dstMonday`. */
export async function duplicateWeek(srcMonday: string, dstMonday: string, weeks: number, opts: { allowOverlaps: boolean; jobId?: string | null }, db = getDb()) {
  const from = startOfWeek(srcMonday);
  const src = (await db.shifts.where("date").between(from, addDays(from, 6), true, true).toArray()).filter((s) => s.status !== "cancelled" && (!opts.jobId || s.jobId === opts.jobId));
  const items: { jobId: string; date: string; block: TimeBlock; partial: Partial<Shift> }[] = [];
  for (let w = 0; w < Math.max(1, weeks); w++) {
    const base = addDays(startOfWeek(dstMonday), w * 7);
    for (const s of src) {
      const target = addDays(base, diffDays(from, s.date));
      items.push({ jobId: s.jobId, date: target, block: shiftBlockToDate(s.planned, target), partial: { kind: s.kind, tags: [...s.tags], notes: s.notes } });
    }
  }
  return createShiftsBulk(items, opts, db);
}

export interface Recurrence {
  jobId: string;
  spec: ShiftSpec;
  from: string;
  to: string;
  weekdays: number[];
  /** Cada cuántas semanas (1 = todas) */
  everyWeeks: number;
}

export function expandRecurrence(r: Recurrence): string[] {
  const out: string[] = [];
  if (r.to < r.from) return out;
  const anchor = startOfWeek(r.from);
  for (const d of dateRange(r.from, r.to)) {
    const weekIndex = Math.floor(diffDays(anchor, d) / 7);
    if (weekIndex % Math.max(1, r.everyWeeks) !== 0) continue;
    if (r.weekdays.includes(weekdayOf(d))) out.push(d);
  }
  return out;
}

export async function createRecurring(r: Recurrence, opts: { allowOverlaps: boolean; templateId?: string | null }, db = getDb()) {
  const seriesId = uid();
  const items = expandRecurrence(r).map((d) => ({ jobId: r.jobId, date: d, block: specToBlock(d, r.spec), partial: { kind: r.spec.kind, tags: [...r.spec.tags], seriesId, templateId: opts.templateId ?? null } }));
  return createShiftsBulk(items, opts, db);
}

/** Aplica una plantilla (de turno o de semana) a un periodo. */
export async function applyTemplate(t: Template, from: string, to: string, weekdays: number[], opts: { allowOverlaps: boolean; jobId: string }, db = getDb()) {
  const items: { jobId: string; date: string; block: TimeBlock; partial: Partial<Shift> }[] = [];
  for (const d of dateRange(from, to)) {
    const wd = weekdayOf(d);
    const specs = t.kind === "week" ? t.week?.[wd] ?? [] : t.shift && weekdays.includes(wd) ? [t.shift] : [];
    for (const spec of specs) items.push({ jobId: opts.jobId, date: d, block: specToBlock(d, spec), partial: { kind: spec.kind, tags: [...spec.tags], templateId: t.id } });
  }
  return createShiftsBulk(items, opts, db);
}

/** Crea una plantilla semanal a partir de los turnos de una semana. */
export async function templateFromWeek(monday: string, name: string, db = getDb(), jobId?: string | null): Promise<Template> {
  const from = startOfWeek(monday);
  const src = (await db.shifts.where("date").between(from, addDays(from, 6), true, true).toArray()).filter((s) => s.status !== "cancelled" && (!jobId || s.jobId === jobId));
  const week: ShiftSpec[][] = [[], [], [], [], [], [], []];
  for (const s of src.sort((a, b) => a.planned.start.localeCompare(b.planned.start))) {
    week[weekdayOf(s.date)].push({
      start: s.planned.start.slice(11, 16), end: s.planned.end.slice(11, 16),
      breaks: s.planned.breaks.map((b) => ({ start: b.start.slice(11, 16), end: b.end.slice(11, 16), paid: b.paid })),
      kind: s.kind, tags: [...s.tags],
    });
  }
  const t: Template = { id: uid(), name, kind: "week", week, color: "#6366f1", createdAt: Date.now(), updatedAt: Date.now() };
  await db.templates.put(t);
  return t;
}

// ------------------------------------------------------------------ fichajes

export async function getOpenSession(db = getDb()): Promise<ClockSession | null> {
  const all = await db.clockSessions.filter((s) => s.endAt === null).toArray();
  return all.sort((a, b) => b.startAt - a.startAt)[0] ?? null;
}

export async function clockIn(jobId: string, at = Date.now(), notes = "", db = getDb()): Promise<ClockSession> {
  const open = await getOpenSession(db);
  if (open) throw new Error("Ya hay un fichaje abierto. Ficha la salida antes de iniciar otro.");
  const s: ClockSession = { id: uid(), jobId, startAt: at, endAt: null, notes, source: "live", shiftId: null, createdAt: Date.now(), updatedAt: Date.now() };
  await db.clockSessions.put(s);
  await audit({ entity: "clockSession", entityId: s.id, action: "create", summary: `Entrada fichada ${fmtDateTimeEpoch(at)}`, reason: "" }, db);
  return s;
}

export async function startBreak(sessionId: string, at = Date.now(), db = getDb()) {
  const open = (await db.clockBreaks.where("sessionId").equals(sessionId).toArray()).find((b) => b.endAt === null);
  if (open) throw new Error("Ya hay un descanso en curso.");
  const s = await db.clockSessions.get(sessionId);
  if (!s || s.endAt !== null) throw new Error("No hay un fichaje abierto.");
  if (at < s.startAt) throw new Error("El descanso no puede empezar antes de la entrada.");
  const b = { id: uid(), sessionId, startAt: at, endAt: null };
  await db.clockBreaks.put(b);
  await audit({ entity: "clockBreak", entityId: b.id, action: "create", summary: `Inicio de descanso ${fmtDateTimeEpoch(at)}`, reason: "" }, db);
}

export async function endBreak(sessionId: string, at = Date.now(), db = getDb()) {
  const open = (await db.clockBreaks.where("sessionId").equals(sessionId).toArray()).find((b) => b.endAt === null);
  if (!open) throw new Error("No hay ningún descanso en curso.");
  if (at < open.startAt) throw new Error("El fin del descanso no puede ser anterior a su inicio.");
  await db.clockBreaks.update(open.id, { endAt: at });
  await audit({ entity: "clockBreak", entityId: open.id, action: "update", summary: `Fin de descanso ${fmtDateTimeEpoch(at)}`, reason: "" }, db);
}

export async function clockOut(sessionId: string, at = Date.now(), opts: { syncShift: boolean; breaksPaid: boolean }, db = getDb()) {
  const s = await db.clockSessions.get(sessionId);
  if (!s || s.endAt !== null) throw new Error("No hay un fichaje abierto.");
  if (at <= s.startAt) throw new Error("La salida debe ser posterior a la entrada.");
  // cerrar un descanso que siga abierto en el momento de la salida
  const open = (await db.clockBreaks.where("sessionId").equals(sessionId).toArray()).find((b) => b.endAt === null);
  if (open) await db.clockBreaks.update(open.id, { endAt: at });
  await db.clockSessions.update(sessionId, { endAt: at, updatedAt: Date.now() });
  await audit({ entity: "clockSession", entityId: sessionId, action: "update", summary: `Salida fichada ${fmtDateTimeEpoch(at)}`, reason: "" }, db);
  if (opts.syncShift) return syncSessionToShift(sessionId, opts.breaksPaid, db);
  return null;
}

/** Bloque de tiempo (a minuto) a partir de un fichaje cerrado. */
export async function sessionBlock(sessionId: string, breaksPaid: boolean, db = getDb()): Promise<TimeBlock | null> {
  const s = await db.clockSessions.get(sessionId);
  if (!s || s.endAt === null) return null;
  const breaks = (await db.clockBreaks.where("sessionId").equals(sessionId).toArray())
    .filter((b) => b.endAt !== null)
    .map<BreakInterval>((b) => ({ start: toLocalDateTime(new Date(b.startAt)), end: toLocalDateTime(new Date(b.endAt!)), paid: breaksPaid }))
    .filter((b) => b.end > b.start);
  return { start: toLocalDateTime(new Date(s.startAt)), end: toLocalDateTime(new Date(s.endAt)), breaks };
}

/**
 * Registra el fichaje como horario real de un turno: si ya estaba vinculado se actualiza;
 * si hay un turno previsto que se solapa ese día se marca como realizado con el horario real;
 * en otro caso se crea un turno realizado nuevo. Así las horas trabajadas se cuentan una sola vez.
 */
export async function syncSessionToShift(sessionId: string, breaksPaid: boolean, db = getDb()): Promise<Shift | null> {
  const s = await db.clockSessions.get(sessionId);
  const block = await sessionBlock(sessionId, breaksPaid, db);
  if (!s || !block || minutesBetween(block.start, block.end) <= 0) return null;
  let shift: Shift | undefined;
  if (s.shiftId) shift = await db.shifts.get(s.shiftId);
  if (!shift) {
    const date = dateOf(block.start);
    const near = await db.shifts.where("date").between(addDays(date, -1), date, true, true).toArray();
    shift = findOverlaps(block, near.filter((x) => x.status === "planned" && x.jobId === s.jobId))[0];
  }
  if (shift) {
    shift = { ...shift, jobId: s.jobId, actual: block, status: "done", updatedAt: Date.now() };
  } else {
    shift = newShift(s.jobId, dateOf(block.start), block, { status: "done", actual: block, notes: s.notes ? `Fichaje: ${s.notes}` : "Creado desde fichaje" });
  }
  await db.shifts.put(shift);
  await db.clockSessions.update(sessionId, { shiftId: shift.id });
  return shift;
}

export async function saveManualSession(input: { id?: string; jobId: string; startAt: number; endAt: number; breaks: { startAt: number; endAt: number }[]; notes: string; reason: string; syncShift: boolean; breaksPaid: boolean }, db = getDb()) {
  if (input.endAt <= input.startAt) throw new Error("La salida debe ser posterior a la entrada.");
  for (const b of input.breaks) {
    if (b.endAt <= b.startAt) throw new Error("Un descanso termina antes de empezar.");
    if (b.startAt < input.startAt || b.endAt > input.endAt) throw new Error("Hay un descanso fuera del fichaje.");
  }
  const id = input.id ?? uid();
  const prev = input.id ? await db.clockSessions.get(input.id) : undefined;
  await db.transaction("rw", db.clockSessions, db.clockBreaks, db.auditLog, async () => {
    const session: ClockSession = {
      id, jobId: input.jobId, startAt: input.startAt, endAt: input.endAt, notes: input.notes, source: prev?.source ?? "manual",
      shiftId: prev?.shiftId ?? null, createdAt: prev?.createdAt ?? Date.now(), updatedAt: Date.now(),
    };
    await db.clockSessions.put(session);
    await db.clockBreaks.where("sessionId").equals(id).delete();
    await db.clockBreaks.bulkPut(input.breaks.map((b) => ({ id: uid(), sessionId: id, startAt: b.startAt, endAt: b.endAt })));
    const summary = prev
      ? `Corrección: ${fmtDateTimeEpoch(prev.startAt)}–${prev.endAt ? fmtDateTimeEpoch(prev.endAt) : "abierto"} → ${fmtDateTimeEpoch(input.startAt)}–${fmtDateTimeEpoch(input.endAt)}`
      : `Fichaje manual ${fmtDateTimeEpoch(input.startAt)}–${fmtDateTimeEpoch(input.endAt)}`;
    await audit({ entity: "clockSession", entityId: id, action: prev ? "update" : "create", summary, reason: input.reason }, db);
  });
  if (input.syncShift) await syncSessionToShift(id, input.breaksPaid, db);
  return id;
}

export async function deleteSession(id: string, reason: string, db = getDb()) {
  const prev = await db.clockSessions.get(id);
  await db.transaction("rw", db.clockSessions, db.clockBreaks, db.auditLog, async () => {
    await db.clockSessions.delete(id);
    await db.clockBreaks.where("sessionId").equals(id).delete();
    if (prev) await audit({ entity: "clockSession", entityId: id, action: "delete", summary: `Fichaje ${fmtDateTimeEpoch(prev.startAt)} eliminado`, reason }, db);
  });
}

// ------------------------------------------------------------------ borrado total

export async function wipeAllData(db = getDb()) {
  await db.transaction("rw", TABLE_NAMES.map((t) => db.table(t)), async () => {
    for (const t of TABLE_NAMES) await db.table(t).clear();
  });
  await ensureInitialized(db);
}
