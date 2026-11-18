/**
 * Asistente laboral: interpreta preguntas en español con reglas (sin modelos de IA ni servicios
 * externos) y responde con los datos reales de la aplicación, usando las mismas funciones de
 * cálculo que el resto de pantallas. Si no puede responder con los datos disponibles, lo dice.
 */
import type { Absence, Contract, Holiday, HourAdjustment, Job, Payslip, SalarySnapshot, Shift } from "./types";
import { computeBank, contractAt, referencePeriodFor, vacationSummary } from "./engine";
import { analyzeJobs, forJob, jobLabel, netJobs, netOf, payslipsNetTotal, payslipsTotal, salaryJobs } from "./jobs";
import { blockDurations, sortShifts } from "./shifts";
import { addDays, addMonths, endOfMonth, endOfWeek, fmtDate, fmtDayShort, fmtHours, fmtMonth, fmtSignedHours, startOfWeek, timeOf, weekdayOf } from "./time";
import { fmtMoney } from "./money";

export interface AssistantContext {
  today: string;
  shifts: Shift[];
  contracts: Contract[];
  holidays: Holiday[];
  absences: Absence[];
  jobs: Job[];
  payslips: Payslip[];
  snapshots: SalarySnapshot[];
  adjustments: HourAdjustment[];
  currency: string;
}

/** Tipo de dato: registrado (lo que consta), estimación (cálculo), previsión (turnos previstos). */
export type DataTag = "registrado" | "estimación" | "previsión";

export type Block =
  | { type: "text"; text: string }
  | { type: "stat"; label: string; value: string; tag: DataTag; hint?: string }
  | { type: "table"; columns: string[]; rows: string[][]; tag?: DataTag }
  | { type: "list"; items: string[] }
  | { type: "note"; text: string };

export interface Answer {
  /** qué se ha entendido, para que el usuario lo compruebe */
  understood: string;
  blocks: Block[];
  links: { href: string; label: string }[];
  /** true si no se ha podido responder con los datos disponibles */
  unanswered?: boolean;
  suggestions?: string[];
}

export const SUGGESTED_QUESTIONS = [
  "¿Cuánto voy a cobrar este mes?",
  "¿Qué turnos tengo la semana que viene?",
  "¿Cuántas horas extraordinarias llevo este mes?",
  "¿Cuántas horas nocturnas he trabajado este año?",
  "¿Cuánto dinero tengo pendiente de cobrar?",
  "¿Cuántas horas he trabajado en cada uno de mis empleos?",
  "¿Cuánto he ganado durante los últimos seis meses?",
  "¿Cuántos días de vacaciones me quedan?",
  "¿Cuánto cobraré si hago los turnos que me quedan este mes?",
];

// ------------------------------------------------------------------ interpretación

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,;:]/g, " ").replace(/\s+/g, " ").trim();
}

const NUM_WORDS: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12 };
const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };

export interface TimeFrame {
  kind: "day" | "week" | "month" | "months" | "year";
  from: string;
  to: string;
  /** meses incluidos ("AAAA-MM") */
  months: string[];
  label: string;
  /** se ha indicado explícitamente en la pregunta */
  explicit: boolean;
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let m = from.slice(0, 7);
  while (m <= to.slice(0, 7) && out.length < 240) {
    out.push(m);
    m = addMonths(m, 1);
  }
  return out;
}

function monthFrame(ym: string, label: string, explicit: boolean): TimeFrame {
  return { kind: "month", from: `${ym}-01`, to: endOfMonth(ym), months: [ym], label, explicit };
}

export function parseTimeFrame(q: string, today: string, fallback: "month" | "week" | "year" | "next-week" = "month"): TimeFrame {
  const ym = today.slice(0, 7);
  const y = Number(today.slice(0, 4));
  const future = /\b(cobrare|cobrar|voy a|tendre|trabajare|tengo que|me toca|proxim|siguiente|que viene)\b/.test(q);
  if (/\bpasado manana\b/.test(q)) { const d = addDays(today, 2); return { kind: "day", from: d, to: d, months: [d.slice(0, 7)], label: "pasado mañana", explicit: true }; }
  if (/\bmanana\b/.test(q) && !/\bpor la manana\b/.test(q)) { const d = addDays(today, 1); return { kind: "day", from: d, to: d, months: [d.slice(0, 7)], label: "mañana", explicit: true }; }
  if (/\bhoy\b/.test(q)) return { kind: "day", from: today, to: today, months: [ym], label: "hoy", explicit: true };
  if (/\bayer\b/.test(q)) { const d = addDays(today, -1); return { kind: "day", from: d, to: d, months: [d.slice(0, 7)], label: "ayer", explicit: true }; }
  const last = q.match(/\bultim[oa]s?\s+(\d{1,2}|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(mes|meses|semana|semanas|dia|dias)\b/);
  if (last) {
    const n = Number(last[1]) || NUM_WORDS[last[1]] || 1;
    if (last[2].startsWith("mes")) {
      const months = Array.from({ length: n }, (_, i) => addMonths(ym, i - n + 1));
      return { kind: "months", from: `${months[0]}-01`, to: today, months, label: `los últimos ${n} meses (incluido el actual)`, explicit: true };
    }
    const days = last[2].startsWith("semana") ? n * 7 : n;
    const from = addDays(today, -days + 1);
    return { kind: "months", from, to: today, months: monthsBetween(from, today), label: `los últimos ${n} ${last[2]}`, explicit: true };
  }
  if (/\b(semana que viene|proxima semana|siguiente semana)\b/.test(q)) { const f = addDays(startOfWeek(today), 7); return { kind: "week", from: f, to: addDays(f, 6), months: monthsBetween(f, addDays(f, 6)), label: "la semana que viene", explicit: true }; }
  if (/\b(semana pasada|semana anterior)\b/.test(q)) { const f = addDays(startOfWeek(today), -7); return { kind: "week", from: f, to: addDays(f, 6), months: monthsBetween(f, addDays(f, 6)), label: "la semana pasada", explicit: true }; }
  if (/\b(esta semana|semana actual)\b/.test(q)) { const f = startOfWeek(today); return { kind: "week", from: f, to: endOfWeek(today), months: monthsBetween(f, endOfWeek(today)), label: "esta semana", explicit: true }; }
  if (/\b(mes que viene|proximo mes|siguiente mes)\b/.test(q)) { const m = addMonths(ym, 1); return monthFrame(m, `el mes que viene (${fmtMonth(m).toLowerCase()})`, true); }
  if (/\b(mes pasado|mes anterior|ultimo mes)\b/.test(q)) { const m = addMonths(ym, -1); return monthFrame(m, `el mes pasado (${fmtMonth(m).toLowerCase()})`, true); }
  if (/\b(ano pasado|ano anterior)\b/.test(q)) return { kind: "year", from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, months: monthsBetween(`${y - 1}-01-01`, `${y - 1}-12-31`), label: `el año pasado (${y - 1})`, explicit: true };
  const yearMatch = q.match(/\b(?:en|del|de|durante)?\s*(?:el\s+)?(?:ano\s+)?(20\d{2})\b/);
  const monthMatch = q.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (monthMatch) {
    const mo = MONTHS[monthMatch[1]];
    let yy = yearMatch ? Number(yearMatch[1]) : y;
    if (!yearMatch && mo > Number(ym.slice(5)) && !future) yy = y - 1;
    const m = `${yy}-${String(mo).padStart(2, "0")}`;
    return monthFrame(m, fmtMonth(m).toLowerCase(), true);
  }
  if (/\b(este ano|ano actual|en lo que va de ano|este curso)\b/.test(q) || yearMatch) {
    const yy = yearMatch ? Number(yearMatch[1]) : y;
    const to = yy === y ? today : `${yy}-12-31`;
    return { kind: "year", from: `${yy}-01-01`, to, months: monthsBetween(`${yy}-01-01`, to), label: yy === y ? `este año (${yy}, hasta hoy)` : `${yy}`, explicit: true };
  }
  if (/\b(este mes|mes actual|en el mes|del mes)\b/.test(q)) return monthFrame(ym, `este mes (${fmtMonth(ym).toLowerCase()})`, true);
  if (fallback === "week") { const f = startOfWeek(today); return { kind: "week", from: f, to: endOfWeek(today), months: monthsBetween(f, endOfWeek(today)), label: "esta semana", explicit: false }; }
  if (fallback === "next-week") { const f = today; const t = addDays(today, 7); return { kind: "week", from: f, to: t, months: monthsBetween(f, t), label: "los próximos 7 días", explicit: false }; }
  if (fallback === "year") return { kind: "year", from: `${y}-01-01`, to: today, months: monthsBetween(`${y}-01-01`, today), label: `este año (${y}, hasta hoy)`, explicit: false };
  return monthFrame(ym, `este mes (${fmtMonth(ym).toLowerCase()})`, false);
}

/** Trabajos mencionados en la pregunta (por nombre o empresa); todos si no se menciona ninguno. */
export function parseJobs(q: string, jobs: Job[]): { ids: string[]; named: boolean } {
  const GENERIC = new Set(["trabajo", "empresa", "empleo", "principal", "tienda", "restaurante", "centro"]);
  const words = new Set(q.split(" "));
  const named = jobs.filter((j) => {
    const names = [j.name, j.company].map((x) => normalizeQuestion(x ?? "")).filter((x) => x.length >= 3);
    // el nombre completo o alguna palabra significativa del nombre (p. ej. "zenith" de "Zenith Toledo")
    return names.some((x) => q.includes(x) || x.split(" ").some((w) => w.length >= 4 && !GENERIC.has(w) && words.has(w)));
  });
  return named.length ? { ids: named.map((j) => j.id), named: true } : { ids: jobs.map((j) => j.id), named: false };
}

type Intent =
  | "help" | "vacation" | "pending" | "projection" | "salary" | "hours" | "shifts" | "next-shift"
  | "days" | "bank" | "payslip-compare" | "absences" | "holidays-list" | "pending-hours" | "unknown";

export function detectIntent(q: string): Intent {
  if (/^(hola|buenas|hey|que puedes|ayuda|que sabes|como funcionas)\b/.test(q) || /\bque (puedes|sabes) (hacer|responder)\b/.test(q)) return "help";
  if (/\bvacacion/.test(q)) return "vacation";
  if (/\bbolsa\b|\bsaldo de horas\b/.test(q)) return "bank";
  if (/\b(pendiente|pendientes|por cobrar|me deben|falta por cobrar|faltan por cobrar|aplazad)/.test(q) && /\b(cobr|dinero|pagar|pago|euros|importe|nomina)/.test(q)) return "pending";
  if (/\b(horas?)\b.*\b(me faltan|faltan|pendientes|por hacer|debo)\b|\b(me faltan|faltan)\b.*\bhoras?\b/.test(q)) return "pending-hours";
  if (/\b(si hago|si trabajo|si hiciera|turnos que me quedan|que me quedan|quedan por hacer|prevision|previsto|prevista|a final de mes)\b/.test(q)) return "projection";
  if (/\b(diferencia|compar\w*|cuadra|coincide)\b.*\bnomina|\bnomina\b.*\b(diferencia|compar\w*|cuadra|coincide)\b/.test(q)) return "payslip-compare";
  if (/\bhoras?\b/.test(q)) return "hours";
  if (/\b(cobr|gan[eoa]|ganad|sueldo|salario|nomina|neto|bruto|dinero|ingres|me pagan|pagado)/.test(q)) return "salary";
  if (/\b(proximo turno|siguiente turno|cuando (trabajo|entro|me toca))\b/.test(q)) return "next-shift";
  if (/\bdias?\b.*\b(trabajad|he trabajado|libres?)\b/.test(q)) return "days";
  if (/\b(turnos?|horario|trabajo|trabajar|libro|libre)\b/.test(q)) return "shifts";
  if (/\b(baja|bajas|ausencia|ausencias|permiso|permisos)\b/.test(q)) return "absences";
  if (/\bfestivos?\b/.test(q)) return "holidays-list";
  return "unknown";
}

// ------------------------------------------------------------------ respuestas

const LINKS = {
  salary: { href: "/salario/", label: "Ver salario" },
  stats: { href: "/estadisticas/", label: "Ver estadísticas" },
  shifts: { href: "/turnos/", label: "Ver mis turnos" },
  calendar: { href: "/calendario/", label: "Ver calendario" },
  hours: { href: "/control-horario/#horas", label: "Ver horas y bolsa" },
  vacation: { href: "/ausencias/", label: "Ver vacaciones" },
  config: { href: "/configuracion/#salary", label: "Configurar salario" },
  payslips: { href: "/salario/#nominas", label: "Ver nóminas" },
};

function scopeText(ctx: AssistantContext, ids: string[], named: boolean) {
  if (ctx.jobs.length < 2) return "";
  return named ? ` en ${ids.map((id) => jobLabel(ctx.jobs.find((j) => j.id === id))).join(" y ")}` : " (todos tus trabajos)";
}

function money(ctx: AssistantContext, cents: number) {
  return fmtMoney(cents, ctx.currency);
}

/** Estimación salarial de un mes: neto si hay deducciones configuradas, si no bruto. */
function salaryStat(ctx: AssistantContext, ids: string[], ym: string, mode: "worked" | "planned", label: string, tag: DataTag): { block: Block | null; gross: number; net: number; complete: boolean; anyNet: boolean } {
  const s = salaryJobs(ctx, ids, ym, mode);
  if (!s.perJob.length) return { block: null, gross: 0, net: 0, complete: false, anyNet: false };
  const n = netJobs(s);
  const value = n.anyNet ? money(ctx, n.cents) : money(ctx, s.grossCents);
  const hint = n.anyNet ? `Neto${n.complete ? "" : " (incluye bruto de trabajos sin deducciones)"} · bruto ${money(ctx, s.grossCents)}` : "Bruto (no tienes deducciones configuradas para estimar el neto)";
  return { block: { type: "stat", label, value, tag, hint }, gross: s.grossCents, net: n.cents, complete: n.complete, anyNet: n.anyNet };
}

function noContract(ctx: AssistantContext, ids: string[]) {
  return ids.every((id) => !ctx.contracts.some((c) => c.jobId === id));
}

export function answerQuestion(question: string, ctx: AssistantContext): Answer {
  const q = normalizeQuestion(question);
  const intent = detectIntent(q);
  const { ids, named } = parseJobs(q, ctx.jobs);
  const scope = scopeText(ctx, ids, named);
  const today = ctx.today;
  const ym = today.slice(0, 7);

  if (!q) return { understood: "", blocks: [{ type: "text", text: "Escribe una pregunta sobre tus turnos, horas, salario o vacaciones." }], links: [], suggestions: SUGGESTED_QUESTIONS.slice(0, 4), unanswered: true };

  switch (intent) {
    case "help":
      return {
        understood: "Qué puedo responder",
        blocks: [
          { type: "text", text: "Respondo con los datos que tienes en Shift Calculator (turnos, fichajes, contratos, nóminas, vacaciones) y con los mismos cálculos que el resto de la app. No me invento nada: si un dato no está registrado, te lo digo." },
          { type: "list", items: ["Salario estimado y neto de un mes o de varios meses", "Horas trabajadas, nocturnas, festivas, de fin de semana, complementarias y extraordinarias", "Turnos de hoy, mañana, esta semana o la que viene", "Dinero pendiente de cobro y previsión con los turnos que te quedan", "Vacaciones disponibles, bolsa de horas y comparación con nóminas reales"] },
        ],
        links: [],
        suggestions: SUGGESTED_QUESTIONS,
      };

    case "vacation": {
      const year = Number((q.match(/\b(20\d{2})\b/) ?? [])[1] ?? today.slice(0, 4));
      const rows = ids.map((id) => {
        const job = ctx.jobs.find((j) => j.id === id)!;
        const sum = vacationSummary(ctx.absences.filter((a) => !a.jobId || a.jobId === id), contractAt(ctx.contracts.filter((c) => c.jobId === id), today), ctx.holidays, job.annualVacationDays, job.vacationCountMode, year, today);
        return { job, sum };
      });
      if (rows.every((r) => r.sum.annual === 0)) {
        return { understood: `Vacaciones de ${year}${scope}`, blocks: [{ type: "note", text: "No tienes configurados los días de vacaciones anuales, así que no puedo calcular los que te quedan. Indícalos en Vacaciones y ausencias → Configurar." }], links: [LINKS.vacation], unanswered: true };
      }
      const unit = (j: Job) => (j.vacationCountMode === "working" ? "días laborables" : "días naturales");
      const blocks: Block[] = rows.length === 1
        ? [
          { type: "stat", label: `Días de vacaciones disponibles en ${year}`, value: `${rows[0].sum.available}`, tag: "registrado", hint: `de ${rows[0].sum.annual} ${unit(rows[0].job)} · disfrutados ${rows[0].sum.used} · programados ${rows[0].sum.scheduled} · solicitados ${rows[0].sum.requested}` },
        ]
        : [{ type: "table", tag: "registrado", columns: ["Trabajo", "Anuales", "Disfrutados", "Programados", "Solicitados", "Disponibles"], rows: rows.map((r) => [jobLabel(r.job), String(r.sum.annual), String(r.sum.used), String(r.sum.scheduled), String(r.sum.requested), String(r.sum.available)]) }];
      if (rows.some((r) => r.sum.requested > 0)) blocks.push({ type: "note", text: "Las solicitadas aún no aprobadas no se descuentan de las disponibles." });
      return { understood: `Vacaciones de ${year}${scope}`, blocks, links: [LINKS.vacation] };
    }

    case "pending": {
      if (noContract(ctx, ids)) return missingContract(scope);
      const blocks: Block[] = [];
      const cur = salaryStat(ctx, ids, ym, "worked", `Nómina de ${fmtMonth(ym).toLowerCase()} (aún no cobrada)`, "estimación");
      if (cur.block) blocks.push(cur.block);
      const s = salaryJobs(ctx, ids, ym, "worked");
      const deferred = s.perJob.reduce((acc, x) => acc + (x.result.deferredOut?.grossCents ?? 0), 0);
      const deferredMin = s.perJob.reduce((acc, x) => acc + (x.result.deferredOut?.minutes ?? 0), 0);
      if (deferred > 0) blocks.push({ type: "stat", label: `Turnos de ${fmtMonth(ym).toLowerCase()} que se cobrarán en ${fmtMonth(addMonths(ym, 1)).toLowerCase()}`, value: money(ctx, deferred), tag: "estimación", hint: `${fmtHours(deferredMin)} trabajadas · importe bruto` });
      // meses anteriores sin nómina real registrada
      const missing: string[][] = [];
      for (let i = 1; i <= 3; i++) {
        const m = addMonths(ym, -i);
        if (payslipsTotal(ctx.payslips, ids, m) !== null) continue;
        const st = salaryJobs(ctx, ids, m);
        if (!st.perJob.length || st.grossCents === 0) continue;
        const n = netJobs(st);
        missing.push([fmtMonth(m), n.anyNet ? `${money(ctx, n.cents)} neto` : `${money(ctx, st.grossCents)} bruto`]);
      }
      if (missing.length) {
        blocks.push({ type: "text", text: "Meses anteriores sin nómina real registrada (no sé si ya los has cobrado):" });
        blocks.push({ type: "table", tag: "estimación", columns: ["Mes", "Estimado"], rows: missing });
      }
      blocks.push({ type: "note", text: "Son estimaciones con tu configuración. Lo cobrado de verdad solo lo sé si registras tus nóminas reales." });
      return { understood: `Dinero pendiente de cobrar${scope}`, blocks, links: [LINKS.salary, LINKS.payslips] };
    }

    case "projection": {
      if (noContract(ctx, ids)) return missingContract(scope);
      const tf = parseTimeFrame(q, today, "month");
      const m = tf.months[tf.months.length - 1];
      const worked = salaryStat(ctx, ids, m, "worked", "Con lo ya realizado", "estimación");
      const planned = salaryStat(ctx, ids, m, "planned", "Si haces todos los turnos previstos", "previsión");
      const blocks: Block[] = [];
      if (planned.block) blocks.push(planned.block);
      if (worked.block) blocks.push(worked.block);
      const remaining = ctx.shifts.filter((s) => ids.includes(s.jobId) && s.status === "planned" && s.date >= today && s.date <= endOfMonth(m));
      const remainingMin = remaining.reduce((acc, s) => acc + blockDurations(s.planned).paid, 0);
      blocks.push({ type: "text", text: remaining.length ? `Te quedan ${remaining.length} turno(s) previstos en ${fmtMonth(m).toLowerCase()} (${fmtHours(remainingMin)}).` : `No tienes turnos previstos pendientes en ${fmtMonth(m).toLowerCase()}.` });
      blocks.push({ type: "note", text: "La previsión usa los turnos previstos (no cancelados) con tus reglas salariales; incluye pluses y horas de más según tu configuración." });
      return { understood: `Previsión de ${fmtMonth(m).toLowerCase()}${scope}`, blocks, links: [LINKS.salary] };
    }

    case "salary": {
      if (noContract(ctx, ids)) return missingContract(scope);
      const tf = parseTimeFrame(q, today, "month");
      const blocks: Block[] = [];
      const futureTense = /\b(voy a cobrar|cobrare|cobrar este|voy a ganar|ganare|me van a pagar)\b/.test(q);
      if (tf.months.length === 1) {
        const m = tf.months[0];
        const isCurrent = m === ym;
        const st = salaryStat(ctx, ids, m, "worked", isCurrent ? "Estimación con lo realizado hasta hoy" : `Estimación de ${fmtMonth(m).toLowerCase()}`, "estimación");
        if (st.block) blocks.push(st.block);
        if (isCurrent || m > ym || futureTense) {
          const pl = salaryStat(ctx, ids, m, "planned", "Previsión si haces los turnos previstos", "previsión");
          if (pl.block) blocks.push(pl.block);
        }
        const realGross = payslipsTotal(ctx.payslips, ids, m);
        const realNet = payslipsNetTotal(ctx.payslips, ids, m);
        if (realGross !== null) blocks.push({ type: "stat", label: "Nómina real registrada", value: realNet !== null ? money(ctx, realNet) : money(ctx, realGross), tag: "registrado", hint: realNet !== null ? `Neto · bruto ${money(ctx, realGross)}` : "Bruto (sin neto registrado)" });
        const s = salaryJobs(ctx, ids, m);
        const din = s.perJob.reduce((acc, x) => acc + (x.result.deferredIn?.grossCents ?? 0), 0);
        const dout = s.perJob.reduce((acc, x) => acc + (x.result.deferredOut?.grossCents ?? 0), 0);
        if (din) blocks.push({ type: "note", text: `Incluye ${money(ctx, din)} brutos de turnos del mes anterior cobrados este mes.` });
        if (dout) blocks.push({ type: "note", text: `${money(ctx, dout)} brutos de turnos de este mes se cobrarán el mes siguiente y no están incluidos.` });
        if (ctx.jobs.length > 1 && !named && s.perJob.length > 1) {
          blocks.push({ type: "table", tag: "estimación", columns: ["Trabajo", "Neto", "Bruto"], rows: s.perJob.map((x) => { const n = netOf(x.result); return [jobLabel(ctx.jobs.find((j) => j.id === x.jobId)), n.isNet ? money(ctx, n.cents) : "—", money(ctx, x.result.grossCents)]; }) });
        }
        if (s.perJob.some((x) => x.result.frozenAt)) blocks.push({ type: "note", text: "Algún mes está cerrado: se usan sus importes congelados." });
      } else {
        const rows: string[][] = [];
        let totNet = 0;
        let totGross = 0;
        let totReal = 0;
        let anyReal = false;
        let allNet = true;
        for (const m of tf.months) {
          const s = salaryJobs(ctx, ids, m);
          const n = netJobs(s);
          if (!n.complete) allNet = false;
          const real = payslipsNetTotal(ctx.payslips, ids, m);
          if (real !== null) { totReal += real; anyReal = true; }
          totNet += n.cents;
          totGross += s.grossCents;
          rows.push([fmtMonth(m), n.anyNet ? money(ctx, n.cents) : "—", money(ctx, s.grossCents), real !== null ? money(ctx, real) : "—"]);
        }
        blocks.push({ type: "stat", label: `Total estimado en ${tf.label}`, value: money(ctx, allNet ? totNet : totGross), tag: "estimación", hint: allNet ? `Neto · bruto ${money(ctx, totGross)}` : `Bruto (para el neto, configura las deducciones de todos tus trabajos)` });
        if (anyReal) blocks.push({ type: "stat", label: "Neto real según tus nóminas registradas", value: money(ctx, totReal), tag: "registrado", hint: "Solo los meses con nómina registrada" });
        blocks.push({ type: "table", tag: "estimación", columns: ["Mes", "Neto estimado", "Bruto estimado", "Neto real"], rows });
      }
      if (!tf.explicit) blocks.push({ type: "note", text: `No has indicado periodo: te muestro ${tf.label}.` });
      return { understood: `Salario${scope} · ${tf.label}`, blocks, links: [LINKS.salary, LINKS.stats] };
    }

    case "hours": {
      const tf = parseTimeFrame(q, today, /\b(ano|anual)\b/.test(q) ? "year" : "month");
      const a = analyzeJobs(ctx, ids, tf.from, tf.to, "worked");
      const blocks: Block[] = [];
      let what = "Horas trabajadas";
      const perJob = /\b(cada (uno de mis )?(empleo|trabajo)s?|por (empleo|trabajo)|cada empleo|cada trabajo|en cada)\b/.test(q) && ctx.jobs.length > 1;
      if (/nocturn/.test(q)) {
        what = "Horas nocturnas";
        blocks.push({ type: "stat", label: `Horas nocturnas en ${tf.label}`, value: fmtHours(a.night), tag: "registrado", hint: "Según la franja nocturna configurada en cada contrato · turnos realizados" });
      } else if (/extraordinari|\bextras?\b/.test(q)) {
        what = "Horas extraordinarias";
        const anyOvertimeRule = ctx.contracts.some((c) => ids.includes(c.jobId) && c.overtime.enabled);
        blocks.push({ type: "stat", label: `Horas extraordinarias en ${tf.label}`, value: fmtHours(a.excess.overtime), tag: "registrado", hint: "Clasificadas con tus reglas (sistema mensual/semanal configurado)" });
        if (!anyOvertimeRule) blocks.push({ type: "note", text: "No tienes activada la regla de horas extraordinarias, así que no se clasifica ninguna como tal." });
        if (a.excess.complementary || a.excess.unclassified) blocks.push({ type: "text", text: `Otras horas de más: ${fmtHours(a.excess.complementary)} complementarias y ${fmtHours(a.excess.unclassified)} sin clasificar.` });
      } else if (/complementari/.test(q)) {
        what = "Horas complementarias";
        blocks.push({ type: "stat", label: `Horas complementarias en ${tf.label}`, value: fmtHours(a.excess.complementary), tag: "registrado", hint: "Clasificadas con tus reglas" });
      } else if (/\bfestiv/.test(q)) {
        what = "Horas en festivos";
        blocks.push({ type: "stat", label: `Horas en festivos en ${tf.label}`, value: fmtHours(a.holiday), tag: "registrado" });
      } else if (/\bdomingos?\b|\bsabados?\b/.test(q)) {
        const wd = /\bdomingos?\b/.test(q) ? 6 : 5;
        what = wd === 6 ? "Horas en domingo" : "Horas en sábado";
        const mins = Object.entries(a.byDay).filter(([dd]) => weekdayOf(dd) === wd).reduce((acc, [, v]) => acc + v.paid, 0);
        blocks.push({ type: "stat", label: `${what} en ${tf.label}`, value: fmtHours(mins), tag: "registrado" });
      } else if (/fin(es)? de semana|finde/.test(q)) {
        what = "Horas de fin de semana";
        blocks.push({ type: "stat", label: `Horas de fin de semana en ${tf.label}`, value: fmtHours(a.weekend), tag: "registrado", hint: "Según los días de fin de semana configurados" });
      } else {
        blocks.push({ type: "stat", label: `Horas trabajadas en ${tf.label}`, value: fmtHours(a.paid), tag: "registrado", hint: `${a.daysWorked} días · turnos realizados` });
        if (a.expected > 0) blocks.push({ type: "stat", label: "Diferencia con tu contrato", value: fmtSignedHours(a.paid - a.expected), tag: "registrado", hint: `Contrato ${fmtHours(a.expected)} en el periodo` });
        const p = analyzeJobs(ctx, ids, tf.from, tf.to, "planned");
        if (p.paid !== a.paid) blocks.push({ type: "stat", label: "Horas previstas en el periodo", value: fmtHours(p.paid), tag: "previsión", hint: "Turnos no cancelados, realizados o no" });
      }
      if (perJob || (ctx.jobs.length > 1 && !named && blocks.length && /cada|por trabajo|por empleo/.test(q))) {
        const rows = ctx.jobs.map((j) => {
          const aj = analyzeJobs(ctx, [j.id], tf.from, tf.to, "worked");
          const val = what === "Horas nocturnas" ? aj.night : what === "Horas extraordinarias" ? aj.excess.overtime : what === "Horas complementarias" ? aj.excess.complementary : what === "Horas en festivos" ? aj.holiday : what === "Horas de fin de semana" ? aj.weekend : aj.paid;
          return [jobLabel(j), fmtHours(val), String(aj.daysWorked)];
        });
        blocks.push({ type: "table", tag: "registrado", columns: ["Trabajo", what, "Días"], rows });
      }
      if (!ctx.shifts.some((s) => ids.includes(s.jobId) && s.status === "done" && s.date >= tf.from && s.date <= tf.to)) blocks.push({ type: "note", text: "No hay turnos marcados como realizados en ese periodo: las horas solo cuentan cuando el turno está realizado." });
      if (!tf.explicit) blocks.push({ type: "note", text: `No has indicado periodo: te muestro ${tf.label}.` });
      return { understood: `${what}${scope} · ${tf.label}`, blocks, links: [LINKS.hours, LINKS.stats] };
    }

    case "pending-hours": {
      const tf = parseTimeFrame(q, today, "week");
      const a = analyzeJobs(ctx, ids, tf.from, tf.to, "worked");
      if (a.expected === 0) return { understood: `Horas pendientes${scope}`, blocks: [{ type: "note", text: "No tienes horas contratadas configuradas para ese periodo, así que no puedo saber cuántas te faltan." }], links: [LINKS.config], unanswered: true };
      const p = analyzeJobs(ctx, ids, tf.from, tf.to, "planned");
      return {
        understood: `Horas pendientes${scope} · ${tf.label}`,
        blocks: [
          { type: "stat", label: `Te faltan para tu contrato (${tf.label})`, value: fmtHours(Math.max(0, a.expected - a.paid)), tag: "registrado", hint: `Contrato ${fmtHours(a.expected)} · realizadas ${fmtHours(a.paid)}` },
          { type: "stat", label: "Con los turnos previstos llegarías a", value: fmtHours(p.paid), tag: "previsión" },
        ],
        links: [LINKS.hours],
      };
    }

    case "bank": {
      const rows = ids.map((id) => {
        const job = ctx.jobs.find((j) => j.id === id)!;
        const jd = forJob(ctx, id);
        const first = [...jd.contracts].sort((x, y) => x.validFrom.localeCompare(y.validFrom))[0];
        if (!first) return null;
        const c = contractAt(jd.contracts, today)!;
        const bank = computeBank({ ...jd, adjustments: ctx.adjustments.filter((x) => x.jobId === id), startDate: job.bankStartDate || first.validFrom, initialMinutes: job.bankInitialMinutes, until: c ? referencePeriodFor(c, today).to : today, today });
        return { job, balance: bank.length ? bank[bank.length - 1].balance : job.bankInitialMinutes };
      }).filter(Boolean) as { job: Job; balance: number }[];
      if (!rows.length) return missingContract(scope);
      return {
        understood: `Bolsa de horas${scope}`,
        blocks: rows.length === 1
          ? [{ type: "stat", label: "Saldo de la bolsa de horas", value: fmtSignedHours(rows[0].balance), tag: "registrado", hint: rows[0].balance >= 0 ? "Positivo: has trabajado más de lo contratado" : "Negativo: debes horas" }]
          : [{ type: "table", tag: "registrado", columns: ["Trabajo", "Saldo"], rows: rows.map((r) => [jobLabel(r.job), fmtSignedHours(r.balance)]) }],
        links: [LINKS.hours],
      };
    }

    case "next-shift": {
      const next = sortShifts(ctx.shifts.filter((s) => ids.includes(s.jobId) && s.status === "planned" && s.planned.end.slice(0, 10) >= today))[0];
      if (!next) return { understood: `Próximo turno${scope}`, blocks: [{ type: "note", text: "No tienes ningún turno previsto en el calendario." }], links: [LINKS.shifts], unanswered: true };
      return { understood: `Próximo turno${scope}`, blocks: [{ type: "stat", label: fmtDayShort(next.date), value: `${timeOf(next.planned.start)} – ${timeOf(next.planned.end)}`, tag: "registrado", hint: `${ctx.jobs.length > 1 ? `${jobLabel(ctx.jobs.find((j) => j.id === next.jobId))} · ` : ""}${fmtHours(blockDurations(next.planned).paid)}` }], links: [LINKS.calendar] };
    }

    case "shifts": {
      const tf = parseTimeFrame(q, today, "next-week");
      const list = sortShifts(ctx.shifts.filter((s) => ids.includes(s.jobId) && s.status !== "cancelled" && s.date >= tf.from && s.date <= tf.to));
      if (!list.length) return { understood: `Turnos${scope} · ${tf.label}`, blocks: [{ type: "text", text: `No tienes turnos registrados para ${tf.label}.` }], links: [LINKS.calendar] };
      const total = list.reduce((acc, s) => acc + blockDurations(s.status === "done" && s.actual ? s.actual : s.planned).paid, 0);
      return {
        understood: `Turnos${scope} · ${tf.label}`,
        blocks: [
          { type: "table", tag: "registrado", columns: ctx.jobs.length > 1 ? ["Día", "Horario", "Trabajo", "Estado"] : ["Día", "Horario", "Estado"], rows: list.map((s) => { const b = s.status === "done" && s.actual ? s.actual : s.planned; const row = [fmtDayShort(s.date), `${timeOf(b.start)}–${timeOf(b.end)}`]; if (ctx.jobs.length > 1) row.push(jobLabel(ctx.jobs.find((j) => j.id === s.jobId))); row.push(s.status === "done" ? "Realizado" : "Previsto"); return row; }) },
          { type: "text", text: `${list.length} turno(s), ${fmtHours(total)} en total.` },
        ],
        links: [LINKS.calendar],
      };
    }

    case "days": {
      const tf = parseTimeFrame(q, today, "month");
      const a = analyzeJobs(ctx, ids, tf.from, tf.to, "worked");
      const end = tf.to < today ? tf.to : today;
      const elapsed = tf.from > today ? 0 : Math.max(0, Math.round((Date.parse(end) - Date.parse(tf.from)) / 86_400_000) + 1);
      const worked = Object.keys(a.byDay).filter((dd) => dd <= end && a.byDay[dd].paid > 0).length;
      return { understood: `Días trabajados${scope} · ${tf.label}`, blocks: [{ type: "stat", label: `Días trabajados en ${tf.label}`, value: String(a.daysWorked), tag: "registrado", hint: elapsed ? `${Math.max(0, elapsed - worked)} días sin trabajar hasta hoy` : undefined }], links: [LINKS.stats] };
    }

    case "payslip-compare": {
      const tf = parseTimeFrame(q, today, "month");
      const rows: string[][] = [];
      for (const m of tf.kind === "month" && !tf.explicit ? [addMonths(ym, -1), ym] : tf.months) {
        const real = payslipsTotal(ctx.payslips, ids, m);
        if (real === null) continue;
        const s = salaryJobs(ctx, ids, m);
        const realNet = payslipsNetTotal(ctx.payslips, ids, m);
        const n = netJobs(s);
        rows.push([fmtMonth(m), money(ctx, s.grossCents), money(ctx, real), money(ctx, real - s.grossCents), n.anyNet && realNet !== null ? money(ctx, realNet - n.cents) : "—"]);
      }
      if (!rows.length) return { understood: "Comparación con nóminas reales", blocks: [{ type: "note", text: "No tienes nóminas reales registradas en ese periodo. Regístralas en Salario → Nóminas reales para poder compararlas." }], links: [LINKS.payslips], unanswered: true };
      return { understood: `Estimación frente a nómina real${scope}`, blocks: [{ type: "table", tag: "registrado", columns: ["Mes", "Bruto estimado", "Bruto real", "Diferencia bruto", "Diferencia neto"], rows }], links: [LINKS.payslips] };
    }

    case "absences": {
      const list = ctx.absences.filter((a) => a.type !== "vacation" && a.status !== "rejected" && (!a.jobId || ids.includes(a.jobId))).sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 10);
      if (!list.length) return { understood: "Bajas, permisos y ausencias", blocks: [{ type: "text", text: "No tienes bajas, permisos ni ausencias registradas." }], links: [LINKS.vacation] };
      const names = { dayoff: "Día libre", permit: "Permiso", absence: "Ausencia", sick: "Baja", vacation: "Vacaciones" } as const;
      return { understood: "Bajas, permisos y ausencias", blocks: [{ type: "table", tag: "registrado", columns: ["Tipo", "Desde", "Hasta"], rows: list.map((a) => [names[a.type], fmtDate(a.startDate), fmtDate(a.endDate)]) }], links: [LINKS.vacation] };
    }

    case "holidays-list": {
      const list = ctx.holidays.filter((h) => h.date >= today).slice(0, 8);
      if (!list.length) return { understood: "Próximos festivos", blocks: [{ type: "note", text: "No tienes festivos próximos registrados. Puedes cargarlos en Vacaciones y ausencias → Festivos." }], links: [LINKS.vacation], unanswered: true };
      return { understood: "Próximos festivos", blocks: [{ type: "list", items: list.map((h) => `${fmtDate(h.date)} · ${h.name}`) }], links: [LINKS.vacation] };
    }

    default:
      return {
        understood: "",
        blocks: [{ type: "text", text: "No he entendido la pregunta o no tengo datos para responderla. Pregúntame por tu salario, tus horas (nocturnas, extra, festivas…), tus turnos, lo pendiente de cobrar o tus vacaciones." }],
        links: [],
        unanswered: true,
        suggestions: SUGGESTED_QUESTIONS.slice(0, 5),
      };
  }
}

function missingContract(scope: string): Answer {
  return { understood: `Salario${scope}`, blocks: [{ type: "note", text: "No tienes contrato ni salario configurados para este trabajo, así que no puedo estimar importes." }], links: [LINKS.config], unanswered: true };
}
