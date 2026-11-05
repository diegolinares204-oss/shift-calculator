/**
 * Varios trabajos: utilidades para filtrar datos por trabajo y sumar resultados.
 * El motor de cálculo trabaja siempre con un único trabajo; las vistas "Todos"
 * suman los resultados de cada trabajo calculado por separado.
 */
import type { Absence, Contract, Holiday, Job, Payslip, Shift } from "./types";
import { analyze, computeSalary, type Analysis, type SalaryResult } from "./engine";
import type { CalcMode } from "./shifts";
import { uid } from "./id";

/** Identificador fijo del primer trabajo (también el creado al migrar datos antiguos). */
export const MAIN_JOB_ID = "job-main";

/** Paleta categórica validada (orden fijo; el color sigue al trabajo, no a su posición en un filtro). */
export const JOB_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];

export function makeJob(partial: Partial<Job> = {}): Job {
  const now = Date.now();
  return {
    id: uid(), name: "", company: "", position: "", color: JOB_COLORS[0], order: 0, archived: false,
    annualVacationDays: 0, vacationCountMode: "working", bankStartDate: "", bankInitialMinutes: 0,
    createdAt: now, updatedAt: now, ...partial,
  };
}

export function nextJobColor(jobs: Job[]): string {
  const used = new Set(jobs.map((j) => j.color));
  return JOB_COLORS.find((c) => !used.has(c)) ?? JOB_COLORS[jobs.length % JOB_COLORS.length];
}

export function jobLabel(j: Job | undefined | null): string {
  if (!j) return "Trabajo";
  return j.name.trim() || j.company.trim() || "Trabajo sin nombre";
}

export interface CalcInput {
  shifts: Shift[];
  contracts: Contract[];
  holidays: Holiday[];
  absences: Absence[];
}

/** Datos de un trabajo: sus turnos y contratos, y las ausencias suyas o comunes a todos. */
export function forJob<T extends CalcInput>(d: T, jobId: string): CalcInput {
  return {
    shifts: d.shifts.filter((s) => s.jobId === jobId),
    contracts: d.contracts.filter((c) => c.jobId === jobId),
    absences: d.absences.filter((a) => !a.jobId || a.jobId === jobId),
    holidays: d.holidays,
  };
}

/** Suma análisis de varios trabajos (los días trabajados se cuentan una vez por fecha). */
export function sumAnalyses(list: Analysis[], from: string, to: string, mode: CalcMode): Analysis {
  const out: Analysis = {
    from, to, mode, paid: 0, net: 0, breaks: 0, night: 0, weekend: 0, holiday: 0, flagCombos: {}, byDay: {},
    daysWorked: 0, shiftCount: 0, expected: 0, nominal: 0, excess: { total: 0, complementary: 0, overtime: 0, unclassified: 0 }, ordinary: 0,
  };
  for (const a of list) {
    out.paid += a.paid; out.net += a.net; out.breaks += a.breaks; out.night += a.night; out.weekend += a.weekend; out.holiday += a.holiday;
    out.shiftCount += a.shiftCount; out.expected += a.expected; out.nominal += a.nominal; out.ordinary += a.ordinary;
    out.excess.total += a.excess.total; out.excess.complementary += a.excess.complementary; out.excess.overtime += a.excess.overtime; out.excess.unclassified += a.excess.unclassified;
    for (const [k, v] of Object.entries(a.flagCombos)) out.flagCombos[Number(k)] = (out.flagCombos[Number(k)] ?? 0) + v;
    for (const [day, s] of Object.entries(a.byDay)) {
      const t = (out.byDay[day] ??= { paid: 0, net: 0, night: 0, weekend: 0, holiday: 0, shifts: 0 });
      t.paid += s.paid; t.net += s.net; t.night += s.night; t.weekend += s.weekend; t.holiday += s.holiday; t.shifts += s.shifts;
    }
  }
  out.daysWorked = Object.values(out.byDay).filter((d) => d.paid > 0).length;
  return out;
}

/** Análisis de un conjunto de trabajos (uno o varios). */
export function analyzeJobs(d: CalcInput, jobIds: string[], from: string, to: string, mode: CalcMode): Analysis {
  const list = jobIds.map((id) => analyze({ ...forJob(d, id), from, to, mode }));
  if (list.length === 1) return list[0];
  return sumAnalyses(list, from, to, mode);
}

export interface JobsSalary {
  perJob: { jobId: string; result: SalaryResult }[];
  grossCents: number;
  /** null si algún trabajo no tiene hipótesis de deducciones */
  netCents: number | null;
}

export function salaryJobs(d: CalcInput, jobIds: string[], ym: string, mode: CalcMode = "worked"): JobsSalary {
  const perJob = jobIds
    .map((jobId) => ({ jobId, result: computeSalary({ ...forJob(d, jobId), ym, mode }) }))
    .filter((x): x is { jobId: string; result: SalaryResult } => x.result !== null);
  const grossCents = perJob.reduce((s, x) => s + x.result.grossCents, 0);
  const netCents = perJob.length && perJob.every((x) => x.result.netCents !== null) ? perJob.reduce((s, x) => s + (x.result.netCents ?? 0), 0) : null;
  return { perJob, grossCents, netCents };
}

export function payslipsTotal(payslips: Payslip[], jobIds: string[], ym: string): number | null {
  const list = payslips.filter((p) => p.period === ym && jobIds.includes(p.jobId));
  return list.length ? list.reduce((s, p) => s + p.grossCents, 0) : null;
}

// ------------------------------------------------------------------ migración de datos anteriores (v2 → v3)

type Rec = Record<string, unknown>;

/**
 * Transforma datos sin trabajos (versión 2) al modelo con trabajos: crea el trabajo principal
 * con la empresa, el puesto, las vacaciones y la bolsa del perfil, y le asigna todo lo existente.
 * Se usa tanto al actualizar la base de datos como al importar copias de seguridad antiguas.
 */
export function migrateToJobs(data: Partial<Record<string, Rec[]>>): Partial<Record<string, Rec[]>> {
  const out: Partial<Record<string, Rec[]>> = { ...data };
  const jobs = [...((data.jobs ?? []) as Rec[])];
  if (!jobs.some((j) => j.id === MAIN_JOB_ID) && jobs.length === 0) {
    const p = ((data.profile ?? [])[0] ?? {}) as Rec;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    jobs.push(makeJob({
      id: MAIN_JOB_ID,
      name: str(p.company) || "Trabajo principal",
      company: str(p.company),
      position: str(p.position),
      color: JOB_COLORS[0],
      annualVacationDays: num(p.annualVacationDays),
      vacationCountMode: p.vacationCountMode === "natural" ? "natural" : "working",
      bankStartDate: str(p.bankStartDate),
      bankInitialMinutes: num(p.bankInitialMinutes),
    }) as unknown as Rec);
  }
  out.jobs = jobs;
  const defaultJob = (jobs[0]?.id as string) ?? MAIN_JOB_ID;
  for (const t of ["contracts", "shifts", "clockSessions", "payslips", "hourAdjustments"]) {
    if (data[t]) out[t] = (data[t] as Rec[]).map((r) => (typeof r.jobId === "string" ? r : { ...r, jobId: defaultJob }));
  }
  if (data.absences) out.absences = (data.absences as Rec[]).map((r) => ("jobId" in r ? r : { ...r, jobId: null }));
  if (data.settings) out.settings = (data.settings as Rec[]).map((r) => (typeof r.activeJobId === "string" ? r : { ...r, activeJobId: "all" }));
  return out;
}

// ------------------------------------------------------------------ neto (lo que se cobra)

/**
 * Neto estimado de un resultado salarial. Si un trabajo no tiene hipótesis de deducciones
 * se usa su bruto y se marca como incompleto, para no inventar retenciones.
 */
export function netOf(result: SalaryResult | null | undefined): { cents: number; isNet: boolean } {
  if (!result) return { cents: 0, isNet: false };
  return result.netCents !== null ? { cents: result.netCents, isNet: true } : { cents: result.grossCents, isNet: false };
}

/** Neto combinado de varios trabajos. `complete` es falso si algún trabajo no tiene deducciones configuradas. */
export function netJobs(s: JobsSalary): { cents: number; complete: boolean; anyNet: boolean } {
  let cents = 0;
  let complete = true;
  let anyNet = false;
  for (const x of s.perJob) {
    const n = netOf(x.result);
    cents += n.cents;
    if (n.isNet) anyNet = true;
    else complete = false;
  }
  return { cents, complete: complete && s.perJob.length > 0, anyNet };
}

/** Neto real de las nóminas registradas (suma); null si no hay ninguna con neto. */
export function payslipsNetTotal(payslips: Payslip[], jobIds: string[], ym: string): number | null {
  const list = payslips.filter((p) => p.period === ym && jobIds.includes(p.jobId) && p.netCents !== null);
  return list.length ? list.reduce((s, p) => s + (p.netCents ?? 0), 0) : null;
}
