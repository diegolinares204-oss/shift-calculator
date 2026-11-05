import { describe, expect, it } from "vitest";
import Dexie from "dexie";
import { ShiftDB, SCHEMA_V1, SCHEMA_V2, CURRENT_DB_VERSION } from "@/db/schema";
import { clockOut, clockIn, createJob, createShiftsBulk, deleteJob, ensureInitialized, loadContracts, loadJobs, newShift, saveContract } from "@/db/repo";
import { MAIN_JOB_ID, analyzeJobs, forJob, migrateToJobs, netJobs, netOf, salaryJobs } from "@/lib/jobs";
import { analyze } from "@/lib/engine";
import { createBackup, importBackup, type Backup } from "@/lib/backup";
import { buildReport } from "@/lib/reports";
import { buildBlock } from "@/lib/shifts";
import { defaultProfile } from "@/lib/defaults";
import { contract, shift } from "../helpers";

const H = (n: number) => n * 60;
let n = 0;
const fresh = () => new ShiftDB(`jobs-${Date.now()}-${n++}`);

describe("varios trabajos: cálculos independientes", () => {
  const bar = contract({ id: "c-bar", jobId: "bar", weeklyMinutes: H(15), workDays: [0, 1, 2], hourlyRateCents: 1000 });
  const shop = contract({ id: "c-shop", jobId: "shop", weeklyMinutes: H(10), workDays: [3, 4], hourlyRateCents: 1200, night: { enabled: true, mode: "percent", value: 50, start: "22:00", end: "06:00" } });
  const shifts = [
    shift("2026-11-02", "09:00", "17:00", { jobId: "bar" }), // 8 h
    shift("2026-11-03", "09:00", "17:00", { jobId: "bar" }), // 8 h
    shift("2026-11-02", "18:00", "23:00", { jobId: "shop" }), // 5 h, 1 h nocturna
    shift("2026-11-05", "16:00", "21:00", { jobId: "shop" }), // 5 h
  ];
  const data = { shifts, contracts: [bar, shop], holidays: [], absences: [] };

  it("cada trabajo se compara con su propio contrato", () => {
    const a = analyze({ ...forJob(data, "bar"), from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    const b = analyze({ ...forJob(data, "shop"), from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(a.paid).toBe(H(16));
    expect(a.excess.unclassified).toBe(H(1));
    expect(b.paid).toBe(H(10));
    expect(b.excess.total).toBe(0);
    expect(b.night).toBe(H(1));
  });

  it("los totales combinados suman ambos trabajos", () => {
    const all = analyzeJobs(data, ["bar", "shop"], "2026-11-02", "2026-11-08", "worked");
    expect(all.paid).toBe(H(26));
    expect(all.expected).toBe(H(25));
    expect(all.daysWorked).toBe(3); // el día 2 trabajó en los dos, cuenta una vez
    expect(all.byDay["2026-11-02"].paid).toBe(H(13));
  });

  it("el salario de cada trabajo usa su precio y sus pluses; el total es la suma", () => {
    const s = salaryJobs(data, ["bar", "shop"], "2026-11");
    const bySum = Object.fromEntries(s.perJob.map((x) => [x.jobId, x.result.grossCents]));
    expect(bySum.bar).toBe(16 * 1000);
    expect(bySum.shop).toBe(10 * 1200 + 600); // + 1 h nocturna al 50 %
    expect(s.grossCents).toBe(bySum.bar + bySum.shop);
    expect(s.netCents).toBeNull();
  });

  it("neto combinado: usa el neto de cada trabajo y marca si alguno no tiene deducciones", () => {
    const withDed = { ...data, contracts: [{ ...bar, deductions: [{ id: "d", name: "Ret.", type: "percent" as const, value: 10, enabled: true }] }, shop] };
    const s = salaryJobs(withDed, ["bar", "shop"], "2026-11");
    const n = netJobs(s);
    expect(n.cents).toBe(14400 + 12600); // bar: 160 € − 10 %; shop sin deducciones: bruto
    expect(n.complete).toBe(false);
    expect(n.anyNet).toBe(true);
    expect(netOf(s.perJob[0].result)).toEqual({ cents: 14400, isNet: true });
  });
});

describe("varios trabajos: base de datos", () => {
  it("migración v2 → v3: crea el trabajo principal y le asigna todo sin perder datos", async () => {
    const name = `mig3-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores(SCHEMA_V1);
    old.version(2).stores(SCHEMA_V2);
    await old.open();
    await old.table("profile").put({ ...defaultProfile(), company: "Bar Central", position: "Camarero", annualVacationDays: 22, bankStartDate: "2026-01-01", bankInitialMinutes: 90 });
    const c = contract({ id: "c1" }) as unknown as Record<string, unknown>;
    delete c.jobId; delete c.otherComplements; delete c.deductions;
    await old.table("contracts").put(c);
    const s = shift("2026-11-02", "09:00", "17:00") as unknown as Record<string, unknown>;
    delete s.jobId;
    await old.table("shifts").put(s);
    await old.table("payslips").put({ id: "p", period: "2026-10", grossCents: 1000, netCents: null, concepts: [], notes: "", createdAt: 0, updatedAt: 0 });
    await old.table("absences").put({ id: "a", type: "vacation", startDate: "2026-08-01", endDate: "2026-08-05", status: "taken", justified: true, paid: true, notes: "", createdAt: 0, updatedAt: 0 });
    await old.table("hourAdjustments").put({ id: "h", date: "2026-11-01", minutes: 30, reason: "", createdAt: 0 });
    await old.table("settings").put({ id: "app", onboardingDone: true, theme: "system", reminders: {}, lastBackupAt: null, updatedAt: 0 });
    old.close();

    const db = new ShiftDB(name);
    await db.open();
    expect(db.verno).toBe(CURRENT_DB_VERSION);
    const jobs = await loadJobs(db);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: MAIN_JOB_ID, name: "Bar Central", position: "Camarero", annualVacationDays: 22, bankStartDate: "2026-01-01", bankInitialMinutes: 90 });
    expect((await loadContracts(db))[0].jobId).toBe(MAIN_JOB_ID);
    expect((await db.shifts.toArray())[0].jobId).toBe(MAIN_JOB_ID);
    expect((await db.payslips.where("[jobId+period]").equals([MAIN_JOB_ID, "2026-10"]).first())?.grossCents).toBe(1000);
    expect((await db.absences.toArray())[0].jobId).toBeNull();
    expect((await db.hourAdjustments.toArray())[0].jobId).toBe(MAIN_JOB_ID);
    expect((await db.settings.get("app"))?.activeJobId).toBe("all");
    db.close();
  });

  it("un turno a la misma hora en otro trabajo no es duplicado ni solapamiento", async () => {
    const db = fresh();
    await ensureInitialized(db);
    const job = await createJob({ name: "Tienda" }, { validFrom: "2026-01-01" }, db);
    const block = buildBlock({ date: "2026-11-02", start: "09:00", end: "13:00", breaks: [] });
    const r = await createShiftsBulk([{ jobId: MAIN_JOB_ID, date: "2026-11-02", block }, { jobId: job.id, date: "2026-11-02", block }], { allowOverlaps: false }, db);
    expect(r.created).toHaveLength(2);
    expect(r.overlaps).toHaveLength(0);
    const again = await createShiftsBulk([{ jobId: job.id, date: "2026-11-02", block }], { allowOverlaps: false }, db);
    expect(again.skippedDuplicates).toHaveLength(1);
  });

  it("crear trabajo copiando condiciones de otro y el fichaje se vincula al turno de su trabajo", async () => {
    const db = fresh();
    await ensureInitialized(db);
    await saveContract(contract({ jobId: MAIN_JOB_ID, weeklyMinutes: H(20), hourlyRateCents: 900 }), db);
    const [main] = await loadContracts(db);
    const job = await createJob({ name: "Tienda" }, { validFrom: "2026-06-01", copyContractFrom: main }, db);
    const copied = (await loadContracts(db)).find((c) => c.jobId === job.id)!;
    expect(copied).toMatchObject({ weeklyMinutes: H(20), hourlyRateCents: 900, validFrom: "2026-06-01" });
    expect(copied.id).not.toBe(main.id);

    const planned = newShift(MAIN_JOB_ID, "2026-11-02", buildBlock({ date: "2026-11-02", start: "09:00", end: "13:00", breaks: [] }));
    await db.shifts.put(planned);
    const s = await clockIn(job.id, new Date("2026-11-02T09:00:00").getTime(), "", db);
    const linked = await clockOut(s.id, new Date("2026-11-02T13:00:00").getTime(), { syncShift: true, breaksPaid: false }, db);
    expect(linked!.id).not.toBe(planned.id); // no toca el turno del otro trabajo
    expect(linked!.jobId).toBe(job.id);
    expect((await db.shifts.get(planned.id))!.status).toBe("planned");
  });

  it("eliminar un trabajo borra solo sus datos y siempre queda uno", async () => {
    const db = fresh();
    await ensureInitialized(db);
    const job = await createJob({ name: "Tienda" }, { validFrom: "2026-01-01" }, db);
    await db.shifts.bulkPut([shift("2026-11-02", "09:00", "10:00", { jobId: job.id }), shift("2026-11-02", "11:00", "12:00")]);
    await db.absences.bulkPut([
      { id: "x", jobId: job.id, type: "dayoff", startDate: "2026-11-03", endDate: "2026-11-03", status: "approved", justified: true, paid: true, notes: "", createdAt: 0, updatedAt: 0 },
      { id: "y", jobId: null, type: "vacation", startDate: "2026-12-01", endDate: "2026-12-03", status: "approved", justified: true, paid: true, notes: "", createdAt: 0, updatedAt: 0 },
    ]);
    await deleteJob(job.id, db);
    expect(await db.shifts.count()).toBe(1);
    expect((await db.absences.toArray()).map((a) => a.id)).toEqual(["y"]);
    expect((await loadContracts(db)).every((c) => c.jobId !== job.id)).toBe(true);
    await expect(deleteJob(MAIN_JOB_ID, db)).rejects.toThrow(/al menos un trabajo/);
  });

  it("importar una copia antigua (sin trabajos) la adapta y no duplica el trabajo principal", async () => {
    const legacy: Backup = {
      app: "shift-calculator", format: 1, dbVersion: 2, exportedAt: new Date().toISOString(),
      data: {
        profile: [{ ...defaultProfile(), company: "Bar" } as unknown as Record<string, unknown>],
        shifts: [(() => { const s = shift("2026-11-02", "09:00", "17:00") as unknown as Record<string, unknown>; delete s.jobId; return s; })()],
      },
    };
    const db = fresh();
    await ensureInitialized(db);
    await importBackup(db, structuredClone(legacy), "merge");
    await importBackup(db, structuredClone(legacy), "merge");
    expect(await db.jobs.count()).toBe(1);
    expect(await db.shifts.count()).toBe(1);
    expect((await db.shifts.toArray())[0].jobId).toBe(MAIN_JOB_ID);
    const b = await createBackup(db);
    expect(b.data.jobs).toHaveLength(1);
    expect(migrateToJobs({}).jobs).toHaveLength(1);
  });

  it("los informes muestran la columna Trabajo y un desglose salarial por trabajo", () => {
    const data = {
      profile: null,
      jobs: [{ id: "bar", name: "Bar" }, { id: "shop", name: "Tienda" }].map((j, i) => ({ ...j, company: "", position: "", color: "#000", order: i, archived: false, annualVacationDays: 0, vacationCountMode: "working" as const, bankStartDate: "", bankInitialMinutes: 0, createdAt: 0, updatedAt: 0 })),
      contracts: [contract({ id: "1", jobId: "bar", hourlyRateCents: 1000 }), contract({ id: "2", jobId: "shop", hourlyRateCents: 1200 })],
      shifts: [shift("2026-11-02", "09:00", "11:00", { jobId: "bar" }), shift("2026-11-03", "09:00", "10:00", { jobId: "shop" })],
      sessions: [], breaks: [], holidays: [], absences: [], payslips: [],
    };
    const r = buildReport("monthly", data, "2026-11-01", "2026-11-30");
    expect(r.tables.map((t) => t.name)).toEqual(["Resumen", "Turnos", "Desglose salarial · Bar", "Desglose salarial · Tienda"]);
    expect(r.tables[1].columns[0]).toBe("Trabajo");
    expect(r.tables[0].rows[0][12]).toBe(32); // 2 h × 10 € + 1 h × 12 €
    const onlyShop = buildReport("monthly", data, "2026-11-01", "2026-11-30", ["shop"]);
    expect(onlyShop.tables[0].rows[0][12]).toBe(12);
    expect(onlyShop.tables[1].columns[0]).toBe("Fecha");
  });
});
