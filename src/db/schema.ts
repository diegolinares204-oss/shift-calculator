import Dexie, { type Table, type Transaction } from "dexie";
import { migrateToJobs } from "@/lib/jobs";
import type { Job, AuditEntry, Absence, ClockBreak, ClockSession, Holiday, HourAdjustment, Payslip, Profile, Settings, Shift, Template } from "@/lib/types";
import type { ContractRow, ComplementRow } from "./rows";

export const DB_NAME = "shift-calculator";

/**
 * Historial de esquemas. NUNCA modificar una versión publicada: añadir siempre una nueva
 * con su función `upgrade` para transformar los datos existentes sin perderlos.
 */
export const SCHEMA_V1: Record<string, string> = {
  profile: "id",
  contracts: "id, validFrom",
  shifts: "id, date, status, seriesId, templateId",
  clockSessions: "id, startAt, endAt",
  clockBreaks: "id, sessionId",
  payslips: "id, &period",
  absences: "id, startDate, endDate, type",
  holidays: "id, date, scope",
  templates: "id, kind",
  settings: "id",
  auditLog: "id, at, entityId",
};

export const SCHEMA_V2: Record<string, string> = {
  ...SCHEMA_V1,
  complements: "id, contractId, kind",
  hourAdjustments: "id, date",
  shifts: "id, date, status, seriesId, templateId, *tags",
};

export const SCHEMA_V3: Record<string, string> = {
  ...SCHEMA_V2,
  jobs: "id, order",
  contracts: "id, validFrom, jobId",
  shifts: "id, date, status, seriesId, templateId, *tags, jobId",
  clockSessions: "id, startAt, endAt, jobId",
  payslips: "id, period, jobId, [jobId+period]",
  absences: "id, startDate, endDate, type, jobId",
  hourAdjustments: "id, date, jobId",
};

export const CURRENT_DB_VERSION = 3;

/**
 * Migración v1 → v2:
 *  - Los complementos y deducciones que en v1 vivían dentro del contrato pasan a su tabla.
 *  - Se garantiza que todos los turnos tienen `tags` y `kind`.
 */
export async function upgradeToV2(tx: Transaction): Promise<void> {
  const contracts = tx.table("contracts");
  const all = (await contracts.toArray()) as Record<string, unknown>[];
  const rows: Record<string, unknown>[] = [];
  for (const c of all) {
    const oc = Array.isArray(c.otherComplements) ? (c.otherComplements as Record<string, unknown>[]) : [];
    const de = Array.isArray(c.deductions) ? (c.deductions as Record<string, unknown>[]) : [];
    for (const x of oc) rows.push({ ...x, contractId: c.id, kind: "earning" });
    for (const x of de) rows.push({ ...x, contractId: c.id, kind: "deduction" });
  }
  if (rows.length) await tx.table("complements").bulkPut(rows);
  await contracts.toCollection().modify((c: Record<string, unknown>) => {
    delete c.otherComplements;
    delete c.deductions;
  });
  await tx.table("shifts").toCollection().modify((s: Record<string, unknown>) => {
    if (!Array.isArray(s.tags)) s.tags = [];
    if (typeof s.kind !== "string") s.kind = "normal";
    if (typeof s.notes !== "string") s.notes = "";
  });
}

/**
 * Migración v2 → v3 (varios trabajos): crea el trabajo principal a partir del perfil y le
 * asigna contratos, turnos, fichajes, nóminas y ajustes existentes. Las ausencias pasan a
 * afectar a todos los trabajos. No se elimina ningún dato.
 */
export async function upgradeToV3(tx: Transaction): Promise<void> {
  const names = ["profile", "jobs", "contracts", "shifts", "clockSessions", "payslips", "hourAdjustments", "absences", "settings"];
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const n of names) data[n] = (await tx.table(n).toArray()) as Record<string, unknown>[];
  const migrated = migrateToJobs(data);
  for (const n of names) {
    if (n === "profile") continue;
    const rows = migrated[n] ?? [];
    if (rows.length) await tx.table(n).bulkPut(rows);
  }
}

export class ShiftDB extends Dexie {
  jobs!: Table<Job, string>;
  profile!: Table<Profile, string>;
  contracts!: Table<ContractRow, string>;
  complements!: Table<ComplementRow, string>;
  shifts!: Table<Shift, string>;
  clockSessions!: Table<ClockSession, string>;
  clockBreaks!: Table<ClockBreak, string>;
  payslips!: Table<Payslip, string>;
  absences!: Table<Absence, string>;
  holidays!: Table<Holiday, string>;
  templates!: Table<Template, string>;
  settings!: Table<Settings, string>;
  auditLog!: Table<AuditEntry, string>;
  hourAdjustments!: Table<HourAdjustment, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2).stores(SCHEMA_V2).upgrade(upgradeToV2);
    this.version(3).stores(SCHEMA_V3).upgrade(upgradeToV3);
  }
}

export const TABLE_NAMES = [
  "profile", "jobs", "contracts", "complements", "shifts", "clockSessions", "clockBreaks", "payslips",
  "absences", "holidays", "templates", "settings", "auditLog", "hourAdjustments",
] as const;

export type TableName = (typeof TABLE_NAMES)[number];
