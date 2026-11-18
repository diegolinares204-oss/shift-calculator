import { describe, expect, it } from "vitest";
import { answerQuestion, detectIntent, normalizeQuestion, parseTimeFrame, SUGGESTED_QUESTIONS, type AssistantContext, type Answer } from "@/lib/assistant";
import { makeJob } from "@/lib/jobs";
import { contract, shift } from "../helpers";
import type { Shift } from "@/lib/types";

const H = (n: number) => n * 60;
const TODAY = "2026-11-18";
const text = (a: Answer) => JSON.stringify(a.blocks);

function ctx(over: Partial<AssistantContext> = {}): AssistantContext {
  const bar = makeJob({ id: "bar", name: "Mcdonalds", annualVacationDays: 30, vacationCountMode: "natural" });
  const shop = makeJob({ id: "shop", name: "Zenith Toledo", order: 1 });
  const done = (s: Shift) => ({ ...s, status: "done" as const });
  return {
    today: TODAY,
    jobs: [bar, shop],
    contracts: [
      contract({ id: "c1", jobId: "bar", weeklyMinutes: H(20), hourlyRateCents: 1000, night: { enabled: true, mode: "percent", value: 25, start: "22:00", end: "06:00" }, deductions: [{ id: "d", name: "SS", type: "percent", value: 10, enabled: true }] }),
      contract({ id: "c2", jobId: "shop", weeklyMinutes: H(10), hourlyRateCents: 1200 }),
    ],
    shifts: [
      done(shift("2026-11-02", "20:00", "00:00", { jobId: "bar" })), // 2 h nocturnas
      done(shift("2026-11-10", "09:00", "13:00", { jobId: "shop" })),
      { ...done(shift("2026-11-12", "09:00", "14:00", { jobId: "bar" })), payNextMonth: true },
      shift("2026-11-24", "16:00", "20:00", { jobId: "bar", status: "planned" }),
      shift("2026-11-26", "10:00", "14:00", { jobId: "shop", status: "planned" }),
      done(shift("2026-10-05", "09:00", "13:00", { jobId: "bar" })),
    ],
    holidays: [{ id: "h", date: "2026-12-08", name: "Inmaculada Concepción", scope: "national" }],
    absences: [{ id: "v", jobId: "bar", type: "vacation", startDate: "2026-08-01", endDate: "2026-08-10", status: "taken", justified: true, paid: true, notes: "", createdAt: 0, updatedAt: 0 }],
    payslips: [{ id: "p", jobId: "bar", period: "2026-10", grossCents: 4000, netCents: 3600, concepts: [], notes: "", createdAt: 0, updatedAt: 0 }],
    snapshots: [],
    adjustments: [],
    currency: "EUR",
    ...over,
  };
}

describe("interpretación de preguntas", () => {
  it("intenciones de las preguntas de ejemplo", () => {
    expect(SUGGESTED_QUESTIONS.map((q) => detectIntent(normalizeQuestion(q)))).toEqual(["salary", "shifts", "hours", "hours", "pending", "hours", "salary", "vacation", "projection"]);
  });
  it("periodos", () => {
    expect(parseTimeFrame(normalizeQuestion("la semana que viene"), TODAY)).toMatchObject({ from: "2026-11-23", to: "2026-11-29" });
    expect(parseTimeFrame(normalizeQuestion("últimos seis meses"), TODAY).months).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(parseTimeFrame(normalizeQuestion("en octubre"), TODAY).months).toEqual(["2026-10"]);
    expect(parseTimeFrame(normalizeQuestion("cuánto cobré en diciembre"), TODAY).months).toEqual(["2025-12"]);
    expect(parseTimeFrame(normalizeQuestion("cuánto cobraré en diciembre"), TODAY).months).toEqual(["2026-12"]);
    expect(parseTimeFrame(normalizeQuestion("este año"), TODAY)).toMatchObject({ from: "2026-01-01", to: TODAY });
    expect(parseTimeFrame(normalizeQuestion("mañana"), TODAY)).toMatchObject({ from: "2026-11-19", to: "2026-11-19" });
  });
});

describe("respuestas con datos reales", () => {
  it("¿Cuánto voy a cobrar este mes? → estimación y previsión, por trabajo, avisando del aplazado", () => {
    const a = answerQuestion("¿Cuánto voy a cobrar este mes?", ctx());
    const t = text(a);
    expect(a.unanswered).toBeFalsy();
    expect(t).toContain("estimación");
    expect(t).toContain("previsión");
    expect(t).toMatch(/se cobrarán el mes siguiente/);
    expect(t).toContain("Mcdonalds");
  });
  it("horas nocturnas del año", () => {
    const a = answerQuestion("¿Cuántas horas nocturnas he trabajado este año?", ctx());
    expect(a.blocks[0]).toMatchObject({ type: "stat", value: "2 h", tag: "registrado" });
  });
  it("horas extraordinarias sin la regla activada: lo explica", () => {
    const t = text(answerQuestion("¿Cuántas horas extraordinarias llevo este mes?", ctx()));
    expect(t).toMatch(/No tienes activada la regla de horas extraordinarias/);
  });
  it("turnos de la semana que viene en ambos empleos", () => {
    const a = answerQuestion("¿Qué turnos tengo la semana que viene?", ctx());
    const table = a.blocks.find((b) => b.type === "table") as { rows: string[][] };
    expect(table.rows.map((r) => r[2])).toEqual(["Mcdonalds", "Zenith Toledo"]);
  });
  it("pendiente de cobro incluye la nómina del mes y los turnos aplazados", () => {
    const t = text(answerQuestion("¿Cuánto dinero tengo pendiente de cobrar?", ctx()));
    expect(t).toMatch(/aún no cobrada/);
    expect(t).toMatch(/que se cobrarán en diciembre/);
  });
  it("horas en cada uno de mis empleos", () => {
    const a = answerQuestion("¿Cuántas horas he trabajado en cada uno de mis empleos?", ctx());
    const table = a.blocks.find((b) => b.type === "table") as { rows: string[][] };
    // el turno aplazado cuenta sus horas en noviembre aunque se cobre en diciembre
    expect(table.rows).toEqual([["Mcdonalds", "9 h", "2"], ["Zenith Toledo", "4 h", "1"]]);
  });
  it("lo ganado en los últimos seis meses con la nómina real registrada", () => {
    const a = answerQuestion("¿Cuánto he ganado durante los últimos seis meses?", ctx());
    expect(text(a)).toContain("Neto real según tus nóminas registradas");
    expect((a.blocks.find((b) => b.type === "table") as { rows: string[][] }).rows).toHaveLength(6);
  });
  it("vacaciones que quedan (días naturales)", () => {
    const a = answerQuestion("¿Cuántos días de vacaciones me quedan en Mcdonalds?", ctx());
    expect(a.blocks[0]).toMatchObject({ type: "stat", value: "20", tag: "registrado" });
  });
  it("previsión si hago los turnos que me quedan", () => {
    const a = answerQuestion("¿Cuánto cobraré si hago los turnos que me quedan este mes?", ctx());
    expect(text(a)).toMatch(/Te quedan 2 turno\(s\) previstos/);
    expect(a.blocks[0]).toMatchObject({ tag: "previsión" });
  });
  it("filtra por el empleo nombrado", () => {
    const a = answerQuestion("¿Cuántas horas he trabajado este mes en Zenith?", ctx());
    expect(a.understood).toContain("Zenith Toledo");
    expect(a.blocks[0]).toMatchObject({ value: "4 h" });
  });
});

describe("respuestas con datos insuficientes", () => {
  it("sin contrato no inventa salario", () => {
    const a = answerQuestion("¿Cuánto voy a cobrar este mes?", ctx({ contracts: [] }));
    expect(a.unanswered).toBe(true);
    expect(text(a)).toMatch(/no puedo estimar importes/);
  });
  it("sin días de vacaciones configurados", () => {
    const c = ctx();
    const a = answerQuestion("¿Cuántos días de vacaciones me quedan?", { ...c, jobs: c.jobs.map((j) => ({ ...j, annualVacationDays: 0 })) });
    expect(a.unanswered).toBe(true);
  });
  it("sin nóminas registradas no compara", () => {
    const a = answerQuestion("¿Mi nómina coincide con la estimación?", ctx({ payslips: [] }));
    expect(a.unanswered).toBe(true);
  });
  it("pregunta que no entiende", () => {
    const a = answerQuestion("¿Qué tiempo hará el sábado en Toledo?", ctx());
    expect(a.unanswered).toBe(true);
    expect(a.suggestions?.length).toBeGreaterThan(0);
  });
  it("horas de un periodo sin turnos realizados lo advierte", () => {
    const t = text(answerQuestion("¿Cuántas horas trabajé en marzo?", ctx()));
    expect(t).toMatch(/No hay turnos marcados como realizados/);
  });
});
