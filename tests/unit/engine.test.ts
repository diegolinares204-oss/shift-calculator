import { describe, expect, it } from "vitest";
import { analyze, computeBank, computeSalary, easterSunday, expectedMinutes, buildDayContext, hourlyRate, payPeriod, quickCalc, spainNationalHolidays, vacationSummary, contractAt, inNightWindow } from "@/lib/engine";
import type { Absence, Holiday } from "@/lib/types";
import { contract, shift } from "../helpers";

const H = (n: number) => n * 60;
const noCtx = { holidays: [] as Holiday[], absences: [] as Absence[] };

describe("horas contratadas y bolsa", () => {
  // semana del lunes 2 al domingo 8 de noviembre de 2026
  const c15 = contract({ weeklyMinutes: H(15), workDays: [0, 1, 2], hourlyRateCents: 1000 });
  const week = [
    shift("2026-11-02", "09:00", "17:00"), // 8 h
    shift("2026-11-03", "09:00", "17:00"), // 8 h
    shift("2026-11-04", "09:00", "16:00"), // 7 h
  ];
  it("contrato de 15 h, trabajo real 23 h: diferencia de 8 h SIN clasificar", () => {
    const a = analyze({ ...noCtx, shifts: week, contracts: [c15], from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(a.paid).toBe(H(23));
    expect(a.expected).toBe(H(15));
    expect(a.excess).toEqual({ total: H(8), complementary: 0, overtime: 0, unclassified: H(8) });
    expect(a.ordinary).toBe(H(15));
  });
  it("con horas complementarias activadas, el exceso se clasifica como complementarias", () => {
    const c = { ...c15, complementary: { enabled: true, payMode: "multiplier" as const, value: 100, maxMinutesPerPeriod: 0 } };
    const a = analyze({ ...noCtx, shifts: week, contracts: [c], from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(a.excess.complementary).toBe(H(8));
    expect(a.excess.unclassified).toBe(0);
  });
  it("límite de complementarias: lo que lo supera queda sin clasificar", () => {
    const c = { ...c15, complementary: { enabled: true, payMode: "multiplier" as const, value: 100, maxMinutesPerPeriod: H(5) } };
    const a = analyze({ ...noCtx, shifts: week, contracts: [c], from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(a.excess.complementary).toBe(H(5));
    expect(a.excess.unclassified).toBe(H(3));
  });
  it("extraordinarias a partir de la jornada completa de referencia", () => {
    const c = contract({ weeklyMinutes: H(40), fullTime: true, fullTimeWeeklyMinutes: H(40), overtime: { enabled: true, payMode: "multiplier", value: 175 }, hourlyRateCents: 1000 });
    const shifts = ["02", "03", "04", "05", "06"].map((d) => shift(`2026-11-${d}`, "08:00", "17:00")); // 45 h
    const a = analyze({ ...noCtx, shifts, contracts: [c], from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(a.excess.overtime).toBe(H(5));
    const s = computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-11" })!;
    const ot = s.lines.find((l) => l.key === "overtime")!;
    expect(ot.amountCents).toBe(5 * 1750);
  });
  it("parcial con complementarias hasta jornada completa y extraordinarias después", () => {
    const c = contract({ weeklyMinutes: H(20), fullTimeWeeklyMinutes: H(40), complementary: { enabled: true, payMode: "multiplier", value: 100, maxMinutesPerPeriod: 0 }, overtime: { enabled: true, payMode: "fixed", value: 2000 } });
    const shifts = ["02", "03", "04", "05"].map((d) => shift(`2026-11-${d}`, "08:00", "19:00")); // 44 h
    const a = analyze({ ...noCtx, shifts, contracts: [c], from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(a.excess).toMatchObject({ complementary: H(20), overtime: H(4), unclassified: 0 });
  });
  it("las horas previstas y las realizadas no se mezclan", () => {
    const shifts = [shift("2026-11-02", "09:00", "17:00", { status: "planned" }), shift("2026-11-03", "09:00", "13:00", { status: "done", actual: ["09:00", "14:00"] }), shift("2026-11-04", "09:00", "13:00", { status: "cancelled" })];
    const p = analyze({ ...noCtx, shifts, contracts: [c15], from: "2026-11-02", to: "2026-11-08", mode: "planned" });
    const w = analyze({ ...noCtx, shifts, contracts: [c15], from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(p.paid).toBe(H(12)); // 8 + 4 previstas (la cancelada no cuenta)
    expect(w.paid).toBe(H(5)); // solo el realizado, con su horario real
  });
  it("festivos y vacaciones reducen las horas esperadas", () => {
    const holidays: Holiday[] = [{ id: "h", date: "2026-11-02", name: "Festivo", scope: "local" }];
    const ctx = buildDayContext(holidays, [{ id: "a", jobId: null, type: "vacation", startDate: "2026-11-03", endDate: "2026-11-03", status: "approved", justified: true, paid: true, notes: "", createdAt: 0, updatedAt: 0 }]);
    expect(expectedMinutes([c15], "2026-11-02", "2026-11-08", ctx).expected).toBe(H(5));
  });
  it("distribución por días de la semana", () => {
    const c = contract({ weeklyMinutes: H(15), distribution: [H(5), H(5), H(5), 0, 0, 0, 0] });
    expect(expectedMinutes([c], "2026-11-02", "2026-11-03", buildDayContext([], [])).expected).toBe(H(10));
  });
  it("bolsa de horas acumulada con ajustes", () => {
    const shifts = [...week, shift("2026-11-09", "09:00", "14:00")];
    const rows = computeBank({ ...noCtx, shifts, contracts: [c15], adjustments: [{ date: "2026-11-10", minutes: -H(2) }], startDate: "2026-11-02", initialMinutes: H(1), until: "2026-11-15", today: "2026-11-20" });
    expect(rows).toHaveLength(2);
    expect(rows[0].diff).toBe(H(8));
    expect(rows[0].balance).toBe(H(9));
    expect(rows[1].diff).toBe(H(5) - H(15) - H(2));
    expect(rows[1].balance).toBe(H(9) - H(12));
  });
  it("periodo de referencia mensual", () => {
    const c = contract({ weeklyMinutes: H(10), monthlyMinutes: H(43), referencePeriod: "monthly" });
    const a = analyze({ ...noCtx, shifts: [shift("2026-11-02", "08:00", "20:00")], contracts: [c], from: "2026-11-01", to: "2026-11-30", mode: "worked" });
    expect(a.expected).toBe(H(43));
    expect(a.excess.total).toBe(0);
  });
  it("antes del inicio del contrato no hay horas esperadas", () => {
    const c = contract({ validFrom: "2026-11-04", weeklyMinutes: H(15), workDays: [0, 1, 2] });
    expect(expectedMinutes([c], "2026-11-02", "2026-11-08", buildDayContext([], [])).expected).toBe(H(5));
  });
  it("selecciona el contrato vigente por fecha", () => {
    const a = contract({ validFrom: "2025-01-01", weeklyMinutes: H(20) });
    const b = contract({ validFrom: "2026-06-01", weeklyMinutes: H(30) });
    expect(contractAt([b, a], "2026-01-10")!.weeklyMinutes).toBe(H(20));
    expect(contractAt([b, a], "2026-07-10")!.weeklyMinutes).toBe(H(30));
  });
});

describe("nocturnidad, fines de semana y festivos", () => {
  it("franja nocturna que cruza la medianoche", () => {
    expect(inNightWindow(23 * 60, "22:00", "06:00")).toBe(true);
    expect(inNightWindow(5 * 60 + 59, "22:00", "06:00")).toBe(true);
    expect(inNightWindow(6 * 60, "22:00", "06:00")).toBe(false);
  });
  it("turno 20:30–01:00 → 3 h nocturnas", () => {
    const c = contract({ weeklyMinutes: H(40), night: { enabled: true, mode: "percent", value: 25, start: "22:00", end: "06:00" }, hourlyRateCents: 1200 });
    const a = analyze({ ...noCtx, shifts: [shift("2026-11-02", "20:30", "01:00")], contracts: [c], from: "2026-11-02", to: "2026-11-08", mode: "worked" });
    expect(a.night).toBe(H(3));
    // el tramo de 00:00 a 01:00 se imputa al día siguiente
    expect(a.byDay["2026-11-03"].paid).toBe(60);
    const s = computeSalary({ ...noCtx, shifts: [shift("2026-11-02", "20:30", "01:00")], contracts: [c], ym: "2026-11" })!;
    expect(s.lines.find((l) => l.key === "night")!.amountCents).toBe(900); // 3 h × 12 € × 25 %
  });
  it("sábado noche + festivo: acumulado o el mayor", () => {
    const base = { weeklyMinutes: H(40), hourlyRateCents: 1000, night: { enabled: true, mode: "percent" as const, value: 20, start: "22:00", end: "06:00" }, holiday: { enabled: true, mode: "fixed" as const, value: 500 } };
    const holidays: Holiday[] = [{ id: "h", date: "2026-11-07", name: "Fiesta", scope: "local" }];
    const shifts = [shift("2026-11-07", "22:00", "23:00")];
    const stacked = computeSalary({ shifts, contracts: [contract({ ...base, stackPremiums: true })], holidays, absences: [], ym: "2026-11" })!;
    expect(stacked.lines.find((l) => l.key === "night")!.amountCents).toBe(200);
    expect(stacked.lines.find((l) => l.key === "holiday")!.amountCents).toBe(500);
    const best = computeSalary({ shifts, contracts: [contract({ ...base, stackPremiums: false })], holidays, absences: [], ym: "2026-11" })!;
    expect(best.lines.find((l) => l.key === "night")).toBeUndefined();
    expect(best.lines.find((l) => l.key === "holiday")!.amountCents).toBe(500);
  });
  it("plus de fin de semana solo en los días configurados", () => {
    const c = contract({ weeklyMinutes: H(40), hourlyRateCents: 1000, weekend: { enabled: true, mode: "percent", value: 50, days: [6] } });
    const a = computeSalary({ ...noCtx, shifts: [shift("2026-11-07", "10:00", "12:00"), shift("2026-11-08", "10:00", "12:00")], contracts: [c], ym: "2026-11" })!;
    expect(a.analysis.weekend).toBe(H(2));
    expect(a.lines.find((l) => l.key === "weekend")!.amountCents).toBe(1000);
  });
  it("turno marcado como festivo aplica el plus aunque el día no esté en el calendario", () => {
    const c = contract({ weeklyMinutes: H(40), hourlyRateCents: 1000, holiday: { enabled: true, mode: "percent", value: 100 } });
    const s = computeSalary({ ...noCtx, shifts: [shift("2026-11-04", "10:00", "12:00", { kind: "holiday" })], contracts: [c], ym: "2026-11" })!;
    expect(s.lines.find((l) => l.key === "holiday")!.amountCents).toBe(2000);
  });
});

describe("cálculo salarial", () => {
  it("salario mensual con pagas prorrateadas, complementos y deducciones de hipótesis", () => {
    const c = contract({
      payType: "monthly", monthlyGrossCents: 150000, weeklyMinutes: H(40), monthlyMinutes: H(160), numPayments: 14, extraPaysProrated: true,
      otherComplements: [{ id: "1", name: "Transporte", type: "monthly_fixed", amount: 5000, enabled: true }, { id: "2", name: "Antigüedad", type: "percent_base", amount: 3, enabled: true }],
      deductions: [{ id: "d", name: "Retención estimada", type: "percent", value: 10, enabled: true }],
    });
    const s = computeSalary({ ...noCtx, shifts: [], contracts: [c], ym: "2026-11" })!;
    expect(s.hourlyCents).toBe(Math.round((150000 * 60) / H(160)));
    expect(s.hourlyDerived).toBe(true);
    const by = Object.fromEntries(s.lines.map((l) => [l.key, l.amountCents]));
    expect(by.base).toBe(150000);
    expect(by["extra-prorated"]).toBe(25000);
    expect(by["oc-1"]).toBe(5000);
    expect(by["oc-2"]).toBe(4500);
    expect(s.grossCents).toBe(184500);
    expect(s.netCents).toBe(184500 - 18450);
  });
  it("sin deducciones configuradas no se inventa un neto", () => {
    const c = contract({ hourlyRateCents: 1000, weeklyMinutes: H(10) });
    const s = computeSalary({ ...noCtx, shifts: [shift("2026-11-02", "09:00", "13:00")], contracts: [c], ym: "2026-11" })!;
    expect(s.netCents).toBeNull();
    expect(s.grossCents).toBe(4000);
  });
  it("paga extra no prorrateada solo en sus meses", () => {
    const c = contract({ payType: "monthly", monthlyGrossCents: 100000, numPayments: 14, extraPaysProrated: false, extraPayMonths: [6, 12] });
    expect(computeSalary({ ...noCtx, shifts: [], contracts: [c], ym: "2026-12" })!.grossCents).toBe(200000);
    expect(computeSalary({ ...noCtx, shifts: [], contracts: [c], ym: "2026-11" })!.grossCents).toBe(100000);
  });
  it("diferencia sin clasificar a precio ordinario o no retribuida según configuración", () => {
    const shifts = [shift("2026-11-02", "08:00", "20:00")];
    const paid = computeSalary({ ...noCtx, shifts, contracts: [contract({ weeklyMinutes: H(10), hourlyRateCents: 1000, workDays: [0] })], ym: "2026-11" })!;
    expect(paid.grossCents).toBe(12000);
    const unpaid = computeSalary({ ...noCtx, shifts, contracts: [contract({ weeklyMinutes: H(10), hourlyRateCents: 1000, workDays: [0], unclassifiedPay: "unpaid" })], ym: "2026-11" })!;
    expect(unpaid.grossCents).toBe(10000);
  });
  it("redondeo una sola vez por línea", () => {
    const c = contract({ hourlyRateCents: 1001, weeklyMinutes: H(40) });
    const shifts = [shift("2026-11-02", "09:00", "09:20"), shift("2026-11-03", "09:00", "09:20"), shift("2026-11-04", "09:00", "09:20")];
    // 60 min × 10,01 = 10,01 (si se redondease por turno: 3 × 3,34 = 10,02)
    expect(computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-11" })!.grossCents).toBe(1001);
  });
  it("periodo de nómina desplazado", () => {
    expect(payPeriod(contract({ payPeriodStartDay: 21 }), "2026-11")).toEqual({ from: "2026-10-21", to: "2026-11-20" });
    expect(payPeriod(contract(), "2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("precio hora derivado del salario anual", () => {
    expect(hourlyRate(contract({ annualGrossCents: 2080000, weeklyMinutes: H(40) })).cents).toBe(1000);
  });
  it("calculadora rápida con cruce de medianoche y descanso", () => {
    const c = contract({ night: { enabled: true, mode: "percent", value: 50, start: "22:00", end: "06:00" } });
    const r = quickCalc({ date: "2026-11-02", start: "20:30", end: "01:00", breaks: [{ start: "23:00", end: "23:30", paid: false }], hourlyCents: 1000, contract: c });
    expect(r.durations.paid).toBe(240);
    expect(r.crossesMidnight).toBe(true);
    expect(r.baseCents).toBe(4000);
    expect(r.premiums[0].minutes).toBe(150);
    expect(r.totalCents).toBe(4000 + 1250);
  });
});

describe("vacaciones y festivos", () => {
  it("Pascua y festivos nacionales de España", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(spainNationalHolidays(2026).find((h) => h.name === "Viernes Santo")!.date).toBe("2026-04-03");
  });
  it("cómputo de vacaciones en días laborables y naturales", () => {
    const c = contract({ workDays: [0, 1, 2, 3, 4] });
    const a: Absence = { id: "1", jobId: null, type: "vacation", startDate: "2026-08-10", endDate: "2026-08-23", status: "approved", justified: true, paid: true, notes: "", createdAt: 0, updatedAt: 0 };
    const holidays: Holiday[] = [{ id: "h", date: "2026-08-15", name: "Asunción", scope: "national" }];
    expect(vacationSummary([a], c, holidays, 22, "working", 2026, "2026-07-01")).toMatchObject({ scheduled: 10, used: 0, available: 12 });
    expect(vacationSummary([a], c, holidays, 30, "natural", 2026, "2026-09-01")).toMatchObject({ used: 14, available: 16 });
  });
});

describe("turnos que cruzan la medianoche a fin de mes", () => {
  const shifts = [shift("2026-10-31", "20:00", "01:00"), shift("2026-10-30", "09:00", "13:00")];
  it("por defecto, la hora posterior a medianoche cuenta en noviembre", () => {
    const c = contract({ weeklyMinutes: H(20), hourlyRateCents: 1000 });
    const oct = computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-10" })!;
    const nov = computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-11" })!;
    expect(oct.analysis.paid).toBe(H(8));
    expect(nov.analysis.paid).toBe(H(1));
  });
  it("con la regla activada, todo el turno cuenta en el día y mes en que empieza", () => {
    const c = contract({ weeklyMinutes: H(20), hourlyRateCents: 1000, crossMidnightToStartDay: true, night: { enabled: true, mode: "percent", value: 25, start: "22:00", end: "06:00" } });
    const oct = computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-10" })!;
    const nov = computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-11" })!;
    expect(oct.analysis.paid).toBe(H(9));
    expect(oct.analysis.byDay["2026-10-31"].paid).toBe(H(5));
    expect(oct.analysis.night).toBe(H(3)); // la nocturnidad sigue dependiendo de la hora real
    expect(nov.analysis.paid).toBe(0);
  });
  it("el domingo/festivo se aplica según la hora real aunque se impute al día de inicio", () => {
    const holidays: Holiday[] = [{ id: "h", date: "2026-11-01", name: "Todos los Santos", scope: "national" }];
    const c = contract({ crossMidnightToStartDay: true, hourlyRateCents: 1000, holiday: { enabled: true, mode: "fixed", value: 500 } });
    const s = computeSalary({ shifts, contracts: [c], holidays, absences: [], ym: "2026-10" })!;
    expect(s.analysis.holiday).toBe(H(1));
  });
});
