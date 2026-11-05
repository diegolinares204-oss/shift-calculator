/**
 * Construcción de informes como tablas neutras (independientes del formato de salida).
 */
import type { Job, Absence, ClockBreak, ClockSession, Contract, Holiday, Payslip, Profile, Shift } from "./types";
import { computeSalary } from "./engine";
import { analyzeJobs, forJob, jobLabel, netJobs, payslipsNetTotal, payslipsTotal, salaryJobs } from "./jobs";
import { blockDurations, SHIFT_KIND_LABELS, SHIFT_STATUS_LABELS, sortShifts } from "./shifts";
import { addMonths, endOfMonth, fmtDate, fmtDateTimeEpoch, fmtMonth, MINUTE, timeOf, dateOf, fmtLocalDateTime, WEEKDAY_ABBR, weekdayOf, toDateKey } from "./time";

export type Cell = string | number | null;

export interface ReportTable {
  name: string;
  columns: string[];
  rows: Cell[][];
  /** Índices de columnas numéricas que representan horas (decimales) o importes */
  numeric?: number[];
}

export interface Report {
  title: string;
  subtitle: string;
  generatedAt: string;
  notes: string[];
  tables: ReportTable[];
}

export interface ReportData {
  profile: Profile | null;
  jobs: Job[];
  contracts: Contract[];
  shifts: Shift[];
  sessions: ClockSession[];
  breaks: ClockBreak[];
  holidays: Holiday[];
  absences: Absence[];
  payslips: Payslip[];
}

export type ReportKind = "monthly" | "annual" | "shifts" | "clock" | "salary";

export const REPORT_LABELS: Record<ReportKind, string> = {
  monthly: "Informe mensual",
  annual: "Informe anual",
  shifts: "Resumen de turnos",
  clock: "Registro de fichajes",
  salary: "Desglose salarial",
};

const h = (min: number) => Math.round((min / 60) * 100) / 100;
const eur = (c: number) => Math.round(c) / 100;

const DISCLAIMER = "Estimación orientativa calculada con los datos y reglas introducidos por el usuario. No es una nómina oficial.";

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let m = from.slice(0, 7);
  const end = to.slice(0, 7);
  let guard = 0;
  while (m <= end && guard++ < 240) {
    out.push(m);
    m = addMonths(m, 1);
  }
  return out;
}

function jobsIn(data: ReportData): Job[] {
  const ids = new Set(data.contracts.map((c) => c.jobId));
  return data.jobs.length ? data.jobs : [...ids].map((id) => ({ id, name: "", company: "", position: "" }) as Job);
}

function header(data: ReportData, title: string, subtitle: string): Report {
  const jobs = jobsIn(data);
  const jobText = jobs.length === 1 ? [jobs[0].name, jobs[0].company, jobs[0].position].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ") : `Trabajos: ${jobs.map((j) => jobLabel(j)).join(", ")}`;
  const who = [data.profile?.name, jobText].filter(Boolean).join(" · ");
  return { title, subtitle: who ? `${subtitle} — ${who}` : subtitle, generatedAt: fmtDateTimeEpoch(Date.now()), notes: [], tables: [] };
}

export function shiftsTable(data: ReportData, from: string, to: string): ReportTable {
  const list = sortShifts(data.shifts.filter((s) => s.date >= from && s.date <= to));
  return {
    name: "Turnos",
    columns: [...(multiJob(data) ? ["Trabajo"] : []), "Fecha", "Día", "Estado", "Tipo", "Entrada prevista", "Salida prevista", "Horas previstas", "Entrada real", "Salida real", "Horas realizadas", "Descansos (min)", "Etiquetas", "Observaciones"],
    numeric: (multiJob(data) ? [7, 10, 11] : [6, 9, 10]),
    rows: list.map((s) => {
      const p = blockDurations(s.planned);
      const real = s.status === "done" ? s.actual ?? s.planned : null;
      const r = real ? blockDurations(real) : null;
      return [
        ...(multiJob(data) ? [jobLabel(data.jobs.find((j) => j.id === s.jobId))] : []),
        fmtDate(s.date), WEEKDAY_ABBR[weekdayOf(s.date)], SHIFT_STATUS_LABELS[s.status], SHIFT_KIND_LABELS[s.kind],
        timeOf(s.planned.start), dateOf(s.planned.end) !== s.date ? fmtLocalDateTime(s.planned.end) : timeOf(s.planned.end),
        s.status === "cancelled" ? 0 : h(p.paid),
        real ? fmtLocalDateTime(real.start) : "", real ? fmtLocalDateTime(real.end) : "", r ? h(r.paid) : 0,
        (r ?? p).breaks, s.tags.join(", "), s.notes,
      ];
    }),
  };
}

export function clockTable(data: ReportData, from: string, to: string): ReportTable {
  const list = data.sessions
    .filter((s) => {
      const dk = toDateKey(new Date(s.startAt));
      return dk >= from && dk <= to;
    })
    .sort((a, b) => a.startAt - b.startAt);
  return {
    name: "Fichajes",
    columns: [...(multiJob(data) ? ["Trabajo"] : []), "Entrada", "Salida", "Descansos (min)", "Tiempo trabajado (h)", "Origen", "Observaciones"],
    numeric: multiJob(data) ? [3, 4] : [2, 3],
    rows: list.map((s) => {
      const br = data.breaks.filter((b) => b.sessionId === s.id && b.endAt !== null).reduce((acc, b) => acc + Math.round((b.endAt! - b.startAt) / MINUTE), 0);
      const total = s.endAt ? Math.round((s.endAt - s.startAt) / MINUTE) : 0;
      return [...(multiJob(data) ? [jobLabel(data.jobs.find((j) => j.id === s.jobId))] : []), fmtDateTimeEpoch(s.startAt), s.endAt ? fmtDateTimeEpoch(s.endAt) : "Abierto", br, s.endAt ? h(total - br) : 0, s.source === "live" ? "Fichaje" : "Manual", s.notes];
    }),
  };
}

function multiJob(data: ReportData): boolean {
  return data.jobs.length > 1;
}

export function monthSummaryRow(data: ReportData, ym: string) {
  const ids = jobsIn(data).map((j) => j.id);
  const sj = salaryJobs(data, ids, ym);
  const sal = sj.perJob.length ? sj : null;
  const from = `${ym}-01`;
  const to = endOfMonth(ym);
  const worked = analyzeJobs(data, ids, from, to, "worked");
  const planned = analyzeJobs(data, ids, from, to, "planned");
  const real = payslipsTotal(data.payslips, ids, ym);
  const slip = real === null ? null : { grossCents: real };
  const net = sal ? netJobs(sal) : null;
  const realNet = payslipsNetTotal(data.payslips, ids, ym);
  return { ym, sal, net, realNet, worked, planned, slip };
}

/**
 * Construye un informe. `jobIds` limita el informe a esos trabajos (por defecto, todos).
 * Los resúmenes suman los trabajos; los desgloses salariales se muestran por trabajo.
 */
export function buildReport(kind: ReportKind, fullData: ReportData, from: string, to: string, jobIds?: string[]): Report {
  const ids = jobIds ?? jobsIn(fullData).map((j) => j.id);
  const data: ReportData = {
    ...fullData,
    jobs: fullData.jobs.filter((j) => ids.includes(j.id)),
    contracts: fullData.contracts.filter((c) => ids.includes(c.jobId)),
    shifts: fullData.shifts.filter((x) => ids.includes(x.jobId)),
    sessions: fullData.sessions.filter((x) => ids.includes(x.jobId)),
    payslips: fullData.payslips.filter((x) => ids.includes(x.jobId)),
    absences: fullData.absences.filter((a) => !a.jobId || ids.includes(a.jobId)),
  };
  const salaryTables = (ym: string, name: (job: Job) => string) =>
    jobsIn(data).flatMap((job) => {
      const s = computeSalary({ ...forJob(data, job.id), ym });
      return s ? [{ job, s, name: name(job) }] : [];
    });
  const cur = data.profile?.currency ?? "EUR";
  const range = `${fmtDate(from)} – ${fmtDate(to)}`;
  if (kind === "shifts") {
    const r = header(data, REPORT_LABELS.shifts, range);
    r.tables.push(shiftsTable(data, from, to));
    return r;
  }
  if (kind === "clock") {
    const r = header(data, REPORT_LABELS.clock, range);
    r.tables.push(clockTable(data, from, to));
    return r;
  }
  const months = monthsBetween(from, to);
  if (kind === "salary") {
    const r = header(data, REPORT_LABELS.salary, range);
    r.notes.push(DISCLAIMER);
    for (const ym of months) for (const { s, name } of salaryTables(ym, (job) => (multiJob(data) ? `${fmtMonth(ym)} · ${jobLabel(job)}` : fmtMonth(ym)))) {
      r.tables.push({
        name,
        columns: ["Concepto", "Detalle", "Horas", `Importe (${cur})`, "Origen"],
        numeric: [2, 3],
        rows: [
          ...s.lines.map((l) => [l.label, l.detail, l.minutes != null ? h(l.minutes) : null, eur(l.amountCents), l.source === "user" ? "Dato introducido" : "Calculado"] as Cell[]),
          ["Total bruto estimado", "", null, eur(s.grossCents), "Calculado"],
          ["Neto estimado", s.netCents == null ? "Sin hipótesis de deducciones configuradas" : "Según tus hipótesis de deducción", null, s.netCents == null ? null : eur(s.netCents), "Calculado"],
        ],
      });
    }
    return r;
  }
  // mensual / anual: resumen por mes
  const title = kind === "annual" ? `${REPORT_LABELS.annual} ${from.slice(0, 4)}` : REPORT_LABELS.monthly;
  const r = header(data, title, kind === "monthly" && months.length === 1 ? fmtMonth(months[0]) : range);
  r.notes.push(DISCLAIMER);
  const rows: Cell[][] = [];
  const tot = { exp: 0, plan: 0, work: 0, night: 0, we: 0, hol: 0, days: 0, gross: 0, real: 0, hasReal: false, net: 0, realNet: 0, hasRealNet: false, anyNet: false };
  for (const ym of months) {
    const { sal, net, realNet, worked, planned, slip } = monthSummaryRow(data, ym);
    rows.push([fmtMonth(ym), h(worked.expected), h(planned.paid), h(worked.paid), h(worked.paid - worked.expected), h(worked.night), h(worked.weekend), h(worked.holiday), worked.daysWorked,
      net?.anyNet ? eur(net.cents) : null, realNet !== null ? eur(realNet) : null, net?.anyNet && realNet !== null ? eur(realNet - net.cents) : null,
      sal ? eur(sal.grossCents) : null, slip ? eur(slip.grossCents) : null, slip && sal ? eur(slip.grossCents - sal.grossCents) : null]);
    if (net?.anyNet) { tot.net += net.cents; tot.anyNet = true; }
    if (realNet !== null) { tot.realNet += realNet; tot.hasRealNet = true; }
    tot.exp += worked.expected; tot.plan += planned.paid; tot.work += worked.paid; tot.night += worked.night; tot.we += worked.weekend; tot.hol += worked.holiday; tot.days += worked.daysWorked;
    tot.gross += sal?.grossCents ?? 0;
    if (slip) { tot.real += slip.grossCents; tot.hasReal = true; }
  }
  if (months.length > 1) rows.push(["TOTAL", h(tot.exp), h(tot.plan), h(tot.work), h(tot.work - tot.exp), h(tot.night), h(tot.we), h(tot.hol), tot.days, tot.anyNet ? eur(tot.net) : null, tot.hasRealNet ? eur(tot.realNet) : null, null, eur(tot.gross), tot.hasReal ? eur(tot.real) : null, null]);
  r.tables.push({
    name: "Resumen",
    columns: ["Mes", "Horas contrato", "Horas previstas", "Horas realizadas", "Diferencia (h)", "Nocturnas (h)", "Fin de semana (h)", "Festivas (h)", "Días trabajados", `Neto estimado (${cur})`, `Neto real (${cur})`, `Neto real − estimado (${cur})`, `Bruto estimado (${cur})`, `Bruto real (${cur})`, `Bruto real − estimado (${cur})`],
    numeric: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    rows,
  });
  if (kind === "monthly") {
    r.tables.push(shiftsTable(data, from, to));
    for (const { s: sal, name } of salaryTables(months[0], (job) => (multiJob(data) ? `Desglose salarial · ${jobLabel(job)}` : "Desglose salarial"))) {
      r.tables.push({
        name,
        columns: ["Concepto", "Detalle", `Importe (${cur})`],
        numeric: [2],
        rows: [...sal.lines.map((l) => [l.label, l.detail, eur(l.amountCents)] as Cell[]), ["Total bruto estimado", "", eur(sal.grossCents)], ["NETO ESTIMADO", sal.netCents === null ? "Sin deducciones configuradas" : "Lo que cobrarías según tus deducciones", sal.netCents === null ? null : eur(sal.netCents)]],
      });
    }
  }
  return r;
}
