import { describe, expect, it, beforeEach } from "vitest";
import Dexie from "dexie";
import { ShiftDB, SCHEMA_V1, CURRENT_DB_VERSION } from "@/db/schema";
import { applyTemplate, clockIn, clockOut, copyDayTo, createRecurring, duplicateWeek, endBreak, ensureInitialized, expandRecurrence, getOpenSession, loadContracts, saveContract, saveManualSession, startBreak, templateFromWeek, wipeAllData, newShift, createShiftsBulk } from "@/db/repo";
import { createBackup, importBackup, validateBackup, type Backup } from "@/lib/backup";
import { blockDurations, buildBlock } from "@/lib/shifts";
import { contract, shift } from "../helpers";
import { MAIN_JOB_ID } from "@/lib/jobs";

let n = 0;
const fresh = () => new ShiftDB(`test-${Date.now()}-${n++}`);
const at = (s: string) => new Date(s).getTime();

describe("migraciones", () => {
  it("v1 → v2 conserva los datos y separa complementos", async () => {
    const name = `mig-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1.open();
    await v1.table("contracts").put({ ...contract({ id: "c1" }), otherComplements: [{ id: "oc", name: "Plus", type: "monthly_fixed", amount: 1000, enabled: true }], deductions: [{ id: "d", name: "IRPF hipótesis", type: "percent", value: 10, enabled: true }] });
    const legacy = shift("2026-11-02", "09:00", "17:00") as unknown as Record<string, unknown>;
    delete legacy.tags;
    await v1.table("shifts").put(legacy);
    v1.close();

    const db = new ShiftDB(name);
    await db.open();
    expect(db.verno).toBe(CURRENT_DB_VERSION);
    const [c] = await loadContracts(db);
    expect(c.otherComplements).toEqual([{ id: "oc", name: "Plus", type: "monthly_fixed", amount: 1000, enabled: true }]);
    expect(c.deductions[0].value).toBe(10);
    expect((await db.contracts.get("c1")) as unknown as Record<string, unknown>).not.toHaveProperty("otherComplements");
    const s = (await db.shifts.toArray())[0];
    expect(s.tags).toEqual([]);
    expect(s.planned.start).toBe("2026-11-02T09:00");
    db.close();
  });
});

describe("repositorio", () => {
  let db: ShiftDB;
  beforeEach(async () => {
    db = fresh();
    await ensureInitialized(db);
  });

  it("guarda y lee contratos con complementos", async () => {
    const c = contract({ otherComplements: [{ id: "x", name: "Plus", type: "per_day", amount: 300, enabled: true }] });
    await saveContract(c, db);
    await saveContract({ ...c, otherComplements: [] }, db);
    const [r] = await loadContracts(db);
    expect(r.otherComplements).toEqual([]);
  });

  it("fichaje completo con descanso, persistencia y vinculación al turno previsto", async () => {
    const planned = newShift(MAIN_JOB_ID, "2026-11-02", buildBlock({ date: "2026-11-02", start: "09:00", end: "17:00", breaks: [] }));
    await db.shifts.put(planned);
    const s = await clockIn(MAIN_JOB_ID, at("2026-11-02T08:55:00"), "", db);
    await expect(clockIn(MAIN_JOB_ID, Date.now(), "", db)).rejects.toThrow(/abierto/);
    // simular cierre de la app: una nueva instancia recupera el fichaje abierto
    const reopened = new ShiftDB(db.name);
    expect((await getOpenSession(reopened))!.id).toBe(s.id);
    await startBreak(s.id, at("2026-11-02T13:00:00"), db);
    await endBreak(s.id, at("2026-11-02T13:30:00"), db);
    const linked = await clockOut(s.id, at("2026-11-02T17:10:00"), { syncShift: true, breaksPaid: false }, db);
    expect(linked!.id).toBe(planned.id);
    expect(linked!.status).toBe("done");
    expect(blockDurations(linked!.actual!).paid).toBe(8 * 60 + 15 - 30);
    expect(await getOpenSession(db)).toBeNull();
    expect((await db.auditLog.toArray()).length).toBeGreaterThanOrEqual(4);
  });

  it("fichaje manual sin turno previsto crea un turno realizado y la corrección queda auditada", async () => {
    const id = await saveManualSession({ jobId: MAIN_JOB_ID, startAt: at("2026-11-03T20:30:00"), endAt: at("2026-11-04T01:00:00"), breaks: [], notes: "", reason: "Olvidé fichar", syncShift: true, breaksPaid: false }, db);
    let shifts = await db.shifts.toArray();
    expect(shifts).toHaveLength(1);
    expect(blockDurations(shifts[0].actual!).paid).toBe(270);
    await saveManualSession({ jobId: MAIN_JOB_ID, id, startAt: at("2026-11-03T20:00:00"), endAt: at("2026-11-04T01:00:00"), breaks: [], notes: "", reason: "Hora real de entrada", syncShift: true, breaksPaid: false }, db);
    shifts = await db.shifts.toArray();
    expect(shifts).toHaveLength(1);
    expect(blockDurations(shifts[0].actual!).paid).toBe(300);
    const log = await db.auditLog.where("entityId").equals(id).toArray();
    expect(log.some((l) => l.reason === "Hora real de entrada" && l.action === "update")).toBe(true);
  });

  it("valida fichajes incoherentes", async () => {
    await expect(saveManualSession({ jobId: MAIN_JOB_ID, startAt: 2000, endAt: 1000, breaks: [], notes: "", reason: "", syncShift: false, breaksPaid: false }, db)).rejects.toThrow();
  });

  it("turnos recurrentes, cada dos semanas", () => {
    const dates = expandRecurrence({ jobId: MAIN_JOB_ID, spec: { start: "09:00", end: "13:00", breaks: [], kind: "normal", tags: [] }, from: "2026-11-02", to: "2026-11-29", weekdays: [0, 2], everyWeeks: 2 });
    expect(dates).toEqual(["2026-11-02", "2026-11-04", "2026-11-16", "2026-11-18"]);
  });

  it("evita duplicados y pide confirmación para solapamientos", async () => {
    const spec = { start: "09:00", end: "13:00", breaks: [], kind: "normal" as const, tags: [] };
    const r1 = await createRecurring({ jobId: MAIN_JOB_ID, spec, from: "2026-11-02", to: "2026-11-08", weekdays: [0, 1, 2, 3, 4], everyWeeks: 1 }, { allowOverlaps: false }, db);
    expect(r1.created).toHaveLength(5);
    const r2 = await createRecurring({ jobId: MAIN_JOB_ID, spec, from: "2026-11-02", to: "2026-11-08", weekdays: [0, 1, 2, 3, 4], everyWeeks: 1 }, { allowOverlaps: false }, db);
    expect(r2.created).toHaveLength(0);
    expect(r2.skippedDuplicates).toHaveLength(5);
    const overlapping = { jobId: MAIN_JOB_ID, date: "2026-11-02", block: buildBlock({ date: "2026-11-02", start: "12:00", end: "14:00", breaks: [] }) };
    expect((await createShiftsBulk([overlapping], { allowOverlaps: false }, db)).created).toHaveLength(0);
    expect((await createShiftsBulk([overlapping], { allowOverlaps: true }, db)).created[0].overlapConfirmed).toBe(true);
  });

  it("copia días, duplica semanas y aplica plantillas", async () => {
    await db.shifts.bulkPut([shift("2026-11-02", "22:00", "06:00", { status: "planned" }), shift("2026-11-04", "09:00", "13:00", { status: "planned" })]);
    const c = await copyDayTo("2026-11-02", ["2026-11-05"], { allowOverlaps: false }, db);
    expect(c.created[0].planned.end).toBe("2026-11-06T06:00");
    const w = await duplicateWeek("2026-11-02", "2026-11-09", 2, { allowOverlaps: false }, db);
    expect(w.created).toHaveLength(6);
    const t = await templateFromWeek("2026-11-02", "Semana tipo", db);
    expect(t.week![0][0].start).toBe("22:00");
    await db.shifts.clear();
    const applied = await applyTemplate(t, "2026-11-30", "2026-12-06", [], { allowOverlaps: false, jobId: MAIN_JOB_ID }, db);
    expect(applied.created.map((s) => s.date).sort()).toEqual(["2026-11-30", "2026-12-02", "2026-12-03"]);
  });

  it("borrado total deja la base de datos inicializada y vacía", async () => {
    await db.shifts.put(shift("2026-11-02", "09:00", "17:00"));
    await wipeAllData(db);
    expect(await db.shifts.count()).toBe(0);
    expect(await db.settings.get("app")).toBeTruthy();
  });
});

describe("copias de seguridad", () => {
  it("exporta e importa (reemplazar) con todos los datos", async () => {
    const a = fresh();
    await ensureInitialized(a);
    await saveContract(contract({ otherComplements: [{ id: "x", name: "Plus", type: "monthly_fixed", amount: 100, enabled: true }] }), a);
    await a.shifts.put(shift("2026-11-02", "09:00", "17:00"));
    await a.payslips.put({ id: "p", jobId: MAIN_JOB_ID, period: "2026-10", grossCents: 100000, netCents: 85000, concepts: [], notes: "", createdAt: 0, updatedAt: 0 });
    await a.holidays.put({ id: "h", date: "2026-12-25", name: "Navidad", scope: "national" });
    await a.absences.put({ id: "v", jobId: null, type: "vacation", startDate: "2026-08-01", endDate: "2026-08-15", status: "taken", justified: true, paid: true, notes: "", createdAt: 0, updatedAt: 0 });
    const s = await clockIn(MAIN_JOB_ID, at("2026-11-02T09:00:00"), "", a);
    await startBreak(s.id, at("2026-11-02T10:00:00"), a);
    const backup = JSON.parse(JSON.stringify(await createBackup(a))) as Backup;
    expect(validateBackup(backup).ok).toBe(true);

    const b = fresh();
    await ensureInitialized(b);
    await b.shifts.put(shift("2027-01-01", "09:00", "10:00"));
    await importBackup(b, backup, "replace");
    expect(await b.shifts.count()).toBe(1);
    expect((await b.shifts.toArray())[0].date).toBe("2026-11-02");
    expect((await loadContracts(b))[0].otherComplements).toHaveLength(1);
    expect(await b.payslips.count()).toBe(1);
    expect(await b.clockBreaks.count()).toBe(1);
    expect((await getOpenSession(b))!.id).toBe(s.id);
  });

  it("fusiona sin duplicar (por id y por contenido)", async () => {
    const a = fresh();
    await ensureInitialized(a);
    await a.shifts.put(shift("2026-11-02", "09:00", "17:00"));
    await a.payslips.put({ id: "p1", jobId: MAIN_JOB_ID, period: "2026-10", grossCents: 1, netCents: null, concepts: [], notes: "", createdAt: 0, updatedAt: 0 });
    const backup = await createBackup(a);
    const b = fresh();
    await ensureInitialized(b);
    await b.shifts.put(shift("2026-11-02", "09:00", "17:00")); // mismo contenido, distinto id
    await b.payslips.put({ id: "p2", jobId: MAIN_JOB_ID, period: "2026-10", grossCents: 2, netCents: null, concepts: [], notes: "", createdAt: 0, updatedAt: 0 });
    const stats = await importBackup(b, backup, "merge");
    expect(await b.shifts.count()).toBe(1);
    expect((await b.payslips.toArray())[0].grossCents).toBe(2);
    expect(stats.byTable.shifts).toEqual({ added: 0, skipped: 1 });
    // importar dos veces la misma copia no duplica
    await importBackup(b, backup, "merge");
    expect(await b.shifts.count()).toBe(1);
  });

  it("rechaza archivos con estructura no válida", () => {
    expect(validateBackup(null).ok).toBe(false);
    expect(validateBackup({ app: "otra", format: 1, dbVersion: 1, data: {} }).ok).toBe(false);
    const bad = validateBackup({ app: "shift-calculator", format: 1, dbVersion: 2, exportedAt: "", data: { shifts: [{ id: "1", date: "2026-13-01", planned: {}, status: "x" }], hackers: [] } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/Tabla desconocida/);
    expect(bad.errors.join(" ")).toMatch(/shifts\[0\]/);
    expect(validateBackup({ app: "shift-calculator", format: 1, dbVersion: 99, data: {} }).ok).toBe(false);
  });
});
