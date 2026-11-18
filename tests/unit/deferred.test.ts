import { describe, expect, it } from "vitest";
import { computeSalary, payMonthOf } from "@/lib/engine";
import { salaryJobs } from "@/lib/jobs";
import type { Contract, SalarySnapshot, Shift } from "@/lib/types";
import { contract, shift } from "../helpers";

const H = (n: number) => n * 60;
const noCtx = { holidays: [], absences: [] };
const defer = (s: Shift): Shift => ({ ...s, payNextMonth: true });
const amount = (r: ReturnType<typeof computeSalary>, key: string) => r!.lines.find((l) => l.key === key)?.amountCents ?? 0;

describe("cobro de un turno en el mes siguiente", () => {
  const c = contract({ weeklyMinutes: H(10), hourlyRateCents: 1000 });

  it("turno del 29 de octubre cobrado en noviembre: horas en octubre, dinero en noviembre, sin duplicar", () => {
    const base = [shift("2026-10-05", "09:00", "13:00"), shift("2026-11-04", "09:00", "13:00")];
    const plain = [...base, shift("2026-10-29", "09:00", "14:00")];
    const deferred = [...base, defer(shift("2026-10-29", "09:00", "14:00"))];
    const octPlain = computeSalary({ ...noCtx, shifts: plain, contracts: [c], ym: "2026-10" })!;
    const novPlain = computeSalary({ ...noCtx, shifts: plain, contracts: [c], ym: "2026-11" })!;
    const oct = computeSalary({ ...noCtx, shifts: deferred, contracts: [c], ym: "2026-10" })!;
    const nov = computeSalary({ ...noCtx, shifts: deferred, contracts: [c], ym: "2026-11" })!;
    // horas: el turno sigue contando en octubre
    expect(oct.analysis.paid).toBe(H(9));
    expect(nov.analysis.paid).toBe(H(4));
    // dinero: se mueve a noviembre
    expect(oct.grossCents).toBe(4000);
    expect(oct.deferredOut).toMatchObject({ workYm: "2026-10", payYm: "2026-11", minutes: H(5), grossCents: 5000 });
    expect(nov.deferredIn).toMatchObject({ workYm: "2026-10", payYm: "2026-11", grossCents: 5000 });
    expect(nov.grossCents).toBe(4000 + 5000);
    expect(nov.lines.some((l) => l.label.includes("(turnos de octubre)"))).toBe(true);
    // el total de los dos meses es el mismo: no se cuenta dos veces
    expect(oct.grossCents + nov.grossCents).toBe(octPlain.grossCents + novPlain.grossCents);
  });

  it("sin turnos aplazados el cálculo es idéntico al de siempre", () => {
    const shifts = [shift("2026-10-05", "09:00", "13:00")];
    const r = computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-10" })!;
    expect(r.deferredIn).toBeNull();
    expect(r.deferredOut).toBeNull();
    expect(r.grossCents).toBe(4000);
  });

  it("turno nocturno que termina al día siguiente (31 → 1): todo se cobra en noviembre con su nocturnidad", () => {
    const cn = contract({ weeklyMinutes: H(40), hourlyRateCents: 1000, night: { enabled: true, mode: "percent", value: 25, start: "22:00", end: "06:00" } });
    const shifts = [defer(shift("2026-10-31", "20:00", "02:00"))];
    const oct = computeSalary({ ...noCtx, shifts, contracts: [cn], ym: "2026-10" })!;
    const nov = computeSalary({ ...noCtx, shifts, contracts: [cn], ym: "2026-11" })!;
    const dec = computeSalary({ ...noCtx, shifts, contracts: [cn], ym: "2026-12" })!;
    expect(oct.analysis.paid).toBe(H(4)); // 20:00–24:00 cuentan en octubre
    expect(oct.grossCents).toBe(0);
    // noviembre cobra las 4 h de octubre (aplazadas) y las 2 h del día 1 (también del turno aplazado)
    expect(nov.grossCents).toBe(6 * 1000 + 4 * 250);
    expect(nov.lines.filter((l) => l.key.endsWith("night")).reduce((s, l) => s + l.amountCents, 0)).toBe(4 * 250);
    expect(dec.grossCents).toBe(0);
  });

  it("horas complementarias con cobro aplazado: se clasifican con el sistema mensual de octubre y se pagan en noviembre", () => {
    const cm = contract({ weeklyMinutes: H(10), monthlyMinutes: H(20), referencePeriod: "monthly", hourlyRateCents: 1000, complementary: { enabled: true, payMode: "fixed", value: 1043, maxMinutesPerPeriod: 0 } });
    const shifts = [shift("2026-10-05", "08:00", "20:00"), shift("2026-10-12", "08:00", "16:00"), defer(shift("2026-10-29", "09:00", "14:00"))]; // 12 + 8 + 5 = 25 h
    const oct = computeSalary({ ...noCtx, shifts, contracts: [cm], ym: "2026-10" })!;
    expect(oct.analysis.excess.complementary).toBe(H(5)); // la clasificación del mes no cambia
    expect(amount(oct, "complementary")).toBe(0); // pero no se paga en octubre
    const nov = computeSalary({ ...noCtx, shifts, contracts: [cm], ym: "2026-11" })!;
    expect(amount(nov, "def-2026-10-complementary")).toBe(5 * 1043);
  });

  it("turno con varios complementos: por hora, por día y % de la base viajan; el fijo mensual no", () => {
    const cc = contract({
      weeklyMinutes: H(40), hourlyRateCents: 1000, holiday: { enabled: true, mode: "fixed", value: 300 }, weekend: { enabled: true, mode: "percent", value: 10, days: [6] },
      otherComplements: [
        { id: "h", name: "Plus por hora", type: "per_hour", amount: 50, enabled: true },
        { id: "d", name: "Transporte", type: "per_day", amount: 418, enabled: true },
        { id: "p", name: "Antigüedad", type: "percent_base", amount: 5, enabled: true },
        { id: "m", name: "Calzado", type: "monthly_fixed", amount: 547, enabled: true },
      ],
    });
    const holidays = [{ id: "h1", date: "2026-11-01", name: "Todos los Santos", scope: "national" as const }];
    const shifts = [defer(shift("2026-10-25", "10:00", "14:00"))]; // domingo 25 de octubre, 4 h
    const oct = computeSalary({ shifts, contracts: [cc], holidays, absences: [], ym: "2026-10" })!;
    expect(oct.grossCents).toBe(547); // solo el fijo mensual se queda
    const out = oct.deferredOut!;
    const k = (s: string) => out.lines.find((l) => l.key === `def-2026-10-${s}`)?.amountCents;
    expect(k("base")).toBe(4000);
    expect(k("weekend")).toBe(400);
    expect(k("oc-h")).toBe(200);
    expect(k("oc-d")).toBe(418);
    expect(k("oc-p")).toBe(200);
    expect(k("oc-m")).toBeUndefined();
  });

  it("conserva las condiciones del mes trabajado aunque cambien después", () => {
    const old = contract({ id: "a", validFrom: "2026-01-01", weeklyMinutes: H(40), hourlyRateCents: 1000 });
    const nuevo = contract({ id: "b", validFrom: "2026-11-01", weeklyMinutes: H(40), hourlyRateCents: 1200 });
    const shifts = [defer(shift("2026-10-29", "09:00", "14:00"))];
    const nov = computeSalary({ ...noCtx, shifts, contracts: [old, nuevo], ym: "2026-11" })!;
    expect(nov.grossCents).toBe(5 * 1000); // precio de octubre, no el nuevo
  });

  it("mes cerrado: los importes congelados no cambian al editar el contrato y la parte aplazada se respeta", () => {
    const jobId = "j";
    const c1 = { ...contract({ jobId, weeklyMinutes: H(40), hourlyRateCents: 1000 }) } as Contract;
    const shifts = [shift("2026-10-05", "09:00", "13:00", { jobId }), defer(shift("2026-10-29", "09:00", "14:00", { jobId }))];
    const data = { shifts, contracts: [c1], holidays: [], absences: [] };
    const oct = salaryJobs(data, [jobId], "2026-10").perJob[0].result;
    const snap: SalarySnapshot = { id: "s", jobId, ym: "2026-10", createdAt: 1, result: oct };
    // el usuario sube después el precio/hora editando el contrato existente
    const edited = { ...data, contracts: [{ ...c1, hourlyRateCents: 2000 }], snapshots: [snap] };
    const octAfter = salaryJobs(edited, [jobId], "2026-10").perJob[0].result;
    expect(octAfter.grossCents).toBe(4000);
    expect(octAfter.frozenAt).toBe(1);
    const novAfter = salaryJobs(edited, [jobId], "2026-11").perJob[0].result;
    expect(novAfter.deferredIn!.grossCents).toBe(5000); // congelado con las condiciones de octubre
    // sin cerrar, el cambio sí se aplicaría
    expect(salaryJobs({ ...edited, snapshots: [] }, [jobId], "2026-11").perJob[0].result.deferredIn!.grossCents).toBe(10000);
  });

  it("varios empleos con condiciones distintas: el aplazamiento solo afecta a su trabajo", () => {
    const a = contract({ id: "ca", jobId: "a", weeklyMinutes: H(40), hourlyRateCents: 1000 });
    const b = contract({ id: "cb", jobId: "b", weeklyMinutes: H(40), hourlyRateCents: 1500 });
    const shifts = [defer(shift("2026-10-29", "09:00", "13:00", { jobId: "a" })), shift("2026-10-29", "15:00", "19:00", { jobId: "b" })];
    const data = { shifts, contracts: [a, b], holidays: [], absences: [] };
    const oct = salaryJobs(data, ["a", "b"], "2026-10");
    const nov = salaryJobs(data, ["a", "b"], "2026-11");
    expect(oct.perJob.find((x) => x.jobId === "a")!.result.grossCents).toBe(0);
    expect(oct.perJob.find((x) => x.jobId === "b")!.result.grossCents).toBe(6000);
    expect(nov.perJob.find((x) => x.jobId === "a")!.result.grossCents).toBe(4000);
    expect(nov.perJob.find((x) => x.jobId === "b")!.result.grossCents).toBe(0);
  });

  it("periodo de nómina desplazado (del 21 al 20): el aplazado pasa a la nómina siguiente a la suya", () => {
    const cp = contract({ weeklyMinutes: H(40), hourlyRateCents: 1000, payPeriodStartDay: 21 });
    expect(payMonthOf(cp, "2026-10-25")).toBe("2026-11");
    expect(payMonthOf(cp, "2026-10-20")).toBe("2026-10");
    const shifts = [defer(shift("2026-10-25", "09:00", "13:00"))];
    expect(computeSalary({ ...noCtx, shifts, contracts: [cp], ym: "2026-11" })!.grossCents).toBe(0);
    expect(computeSalary({ ...noCtx, shifts, contracts: [cp], ym: "2026-12" })!.grossCents).toBe(4000);
  });

  it("también en la previsión (turnos previstos)", () => {
    const shifts = [defer(shift("2026-10-29", "09:00", "14:00", { status: "planned" }))];
    expect(computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-10", mode: "planned" })!.grossCents).toBe(0);
    expect(computeSalary({ ...noCtx, shifts, contracts: [c], ym: "2026-11", mode: "planned" })!.grossCents).toBe(5000);
  });

  it("salario mensual fijo: el turno aplazado solo mueve sus horas de más y pluses", () => {
    const cm = contract({ payType: "monthly", monthlyGrossCents: 100000, weeklyMinutes: H(10), monthlyMinutes: H(10), referencePeriod: "monthly", unclassifiedPay: "ordinary", hourlyRateCents: 1000 });
    const shifts = [shift("2026-10-05", "08:00", "18:00"), defer(shift("2026-10-29", "09:00", "11:00"))];
    const oct = computeSalary({ ...noCtx, shifts, contracts: [cm], ym: "2026-10" })!;
    const nov = computeSalary({ ...noCtx, shifts, contracts: [cm], ym: "2026-11" })!;
    expect(oct.grossCents).toBe(100000);
    expect(nov.grossCents).toBe(100000 + 2000);
  });
});
