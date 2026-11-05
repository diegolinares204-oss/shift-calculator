/**
 * Motor de cálculo de horas y salario.
 *
 * Principios:
 *  - Las horas previstas (turnos no cancelados, horario previsto) y las realizadas
 *    (turnos marcados como realizados, horario real si existe) se calculan por separado.
 *  - El cálculo se hace minuto a minuto sobre marcas de tiempo reales, por lo que los
 *    turnos que cruzan la medianoche o el cambio de hora se reparten correctamente
 *    entre días, franjas nocturnas, fines de semana y festivos.
 *  - Los excesos sobre el contrato solo se clasifican como complementarias o
 *    extraordinarias si el usuario ha activado esas reglas. En otro caso se muestran
 *    como "diferencia sin clasificar".
 *  - Los importes se calculan en céntimos enteros y se redondean una sola vez por línea.
 */
import type { Absence, Contract, Holiday, Shift, Weekday, PremiumRule } from "./types";
import { blockFor, type CalcMode, paidIntervals, blockDurations, buildBlock } from "./shifts";
import { addDays, dateRange, diffDays, endOfMonth, endOfWeek, hhmmToMinutes, MINUTE, startOfWeek, toDateKey, weekdayOf, parseDateKey } from "./time";
import { amountForMinutes, percentOf, roundCents } from "./money";

// ------------------------------------------------------------------ contrato

export function contractAt(contracts: Contract[], date: string): Contract | null {
  if (contracts.length === 0) return null;
  const sorted = [...contracts].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  let found = sorted[0];
  for (const c of sorted) if (c.validFrom <= date) found = c;
  return found;
}

/** Minutos mensuales de referencia: los configurados o semanales × 52 / 12. */
export function monthlyReferenceMinutes(c: Contract): number {
  return c.monthlyMinutes > 0 ? c.monthlyMinutes : Math.round((c.weeklyMinutes * 52) / 12);
}

/** Precio/hora ordinario en céntimos. Si el salario es mensual y no hay precio/hora, se deriva. */
export function hourlyRate(c: Contract): { cents: number; derived: boolean } {
  if (c.hourlyRateCents > 0) return { cents: c.hourlyRateCents, derived: false };
  const ref = monthlyReferenceMinutes(c);
  if (c.monthlyGrossCents > 0 && ref > 0) return { cents: roundCents((c.monthlyGrossCents * 60) / ref), derived: true };
  if (c.annualGrossCents > 0 && c.weeklyMinutes > 0) return { cents: roundCents((c.annualGrossCents * 60) / ((c.weeklyMinutes * 52))), derived: true };
  return { cents: 0, derived: true };
}

export function extraPayAmount(c: Contract): number {
  if (c.extraPayAmountCents > 0) return c.extraPayAmountCents;
  return c.payType === "monthly" ? c.monthlyGrossCents : 0;
}

// ------------------------------------------------------------------ calendario laboral

export interface DayContext {
  holidays: Map<string, Holiday>;
  /** Fecha → ausencia que reduce la jornada esperada */
  absenceDays: Map<string, Absence>;
}

export function absenceCounts(a: Absence): boolean {
  if (a.status === "rejected") return false;
  if (a.type === "vacation") return a.status === "approved" || a.status === "taken";
  if (a.type === "absence") return a.justified;
  return true;
}

export function buildDayContext(holidays: Holiday[], absences: Absence[]): DayContext {
  const h = new Map<string, Holiday>();
  for (const x of holidays) if (!h.has(x.date)) h.set(x.date, x);
  const a = new Map<string, Absence>();
  for (const x of absences) {
    if (!absenceCounts(x)) continue;
    if (x.endDate < x.startDate) continue;
    for (const d of dateRange(x.startDate, x.endDate)) if (!a.has(d)) a.set(d, x);
  }
  return { holidays: h, absenceDays: a };
}

/** Minutos nominales de un día según la distribución o el reparto uniforme en días habituales. */
export function nominalDayMinutes(c: Contract, date: string): number {
  const wd = weekdayOf(date);
  if (c.distribution && c.distribution.length === 7 && c.distribution.some((x) => x > 0)) return c.distribution[wd];
  const days: Weekday[] = c.workDays.length ? c.workDays : [0, 1, 2, 3, 4];
  return days.includes(wd) ? c.weeklyMinutes / days.length : 0;
}

export function isDayReduced(c: Contract, date: string, ctx: DayContext): boolean {
  return c.absencesReduceExpected && (ctx.holidays.has(date) || ctx.absenceDays.has(date));
}

/** Horas esperadas por contrato en un rango [from, to] (minutos). */
export function expectedMinutes(contracts: Contract[], from: string, to: string, ctx: DayContext, scaleMonthly = false): { expected: number; nominal: number } {
  let expected = 0;
  let nominal = 0;
  const firstValid = contracts.reduce((m, c) => (c.validFrom < m ? c.validFrom : m), "9999-12-31");
  for (const d of dateRange(from, to)) {
    // antes del inicio del primer contrato no hay horas esperadas
    if (d < firstValid) continue;
    const c = contractAt(contracts, d);
    if (!c) continue;
    const n = nominalDayMinutes(c, d);
    nominal += n;
    if (!isDayReduced(c, d, ctx)) expected += n;
  }
  if (scaleMonthly) {
    const c = contractAt(contracts, from);
    if (c && c.monthlyMinutes > 0 && nominal > 0) {
      expected = (expected * c.monthlyMinutes) / nominal;
      nominal = c.monthlyMinutes;
    }
  }
  return { expected: Math.round(expected), nominal: Math.round(nominal) };
}

// ------------------------------------------------------------------ periodos de referencia

export interface Period {
  from: string;
  to: string;
}

export function referencePeriodFor(c: Contract, date: string): Period {
  if (c.referencePeriod === "monthly") {
    const ym = date.slice(0, 7);
    return { from: `${ym}-01`, to: endOfMonth(ym) };
  }
  if (c.referencePeriod === "custom" && c.customPeriodDays > 0) {
    const anchor = c.customPeriodAnchor || "2020-01-06";
    const n = Math.floor(diffDays(anchor, date) / c.customPeriodDays);
    const from = addDays(anchor, n * c.customPeriodDays);
    return { from, to: addDays(from, c.customPeriodDays - 1) };
  }
  return { from: startOfWeek(date), to: endOfWeek(date) };
}

/** Periodos de referencia que cubren [from, to]. */
export function referencePeriods(contracts: Contract[], from: string, to: string): Period[] {
  const out: Period[] = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard++ < 5000) {
    const c = contractAt(contracts, d);
    if (!c) break;
    const p = referencePeriodFor(c, d);
    out.push(p);
    d = addDays(p.to, 1);
  }
  return out;
}

/** Periodo de nómina del mes `ym` según el día de inicio configurado. */
export function payPeriod(c: Contract | null, ym: string): Period {
  const day = Math.min(28, Math.max(1, c?.payPeriodStartDay ?? 1));
  if (day === 1) return { from: `${ym}-01`, to: endOfMonth(ym) };
  const [y, m] = ym.split("-").map(Number);
  const prev = toDateKey(new Date(y, m - 2, day));
  return { from: prev, to: addDays(toDateKey(new Date(y, m - 1, day)), -1) };
}

// ------------------------------------------------------------------ clasificación por minutos

export const FLAG_NIGHT = 1;
export const FLAG_WEEKEND = 2;
export const FLAG_HOLIDAY = 4;

export function inNightWindow(minuteOfDay: number, startHHMM: string, endHHMM: string): boolean {
  const s = hhmmToMinutes(startHHMM);
  const e = hhmmToMinutes(endHHMM);
  if (s === e) return false;
  return s < e ? minuteOfDay >= s && minuteOfDay < e : minuteOfDay >= s || minuteOfDay < e;
}

export interface DayStats {
  paid: number;
  net: number;
  night: number;
  weekend: number;
  holiday: number;
  shifts: number;
}

export interface Analysis {
  from: string;
  to: string;
  mode: CalcMode;
  /** Minutos retribuidos (bruto − descansos no remunerados) */
  paid: number;
  /** Minutos de trabajo efectivo (sin descansos) */
  net: number;
  breaks: number;
  night: number;
  weekend: number;
  holiday: number;
  /** minutos por combinación de flags (bitmask) */
  flagCombos: Record<number, number>;
  byDay: Record<string, DayStats>;
  daysWorked: number;
  shiftCount: number;
  expected: number;
  nominal: number;
  /** Exceso sobre el contrato imputado al rango */
  excess: { total: number; complementary: number; overtime: number; unclassified: number };
  ordinary: number;
}

interface Minute {
  t: number;
  date: string;
  flags: number;
}

function emptyDay(): DayStats {
  return { paid: 0, net: 0, night: 0, weekend: 0, holiday: 0, shifts: 0 };
}

function shiftMinutes(shift: Shift, mode: CalcMode, contracts: Contract[], ctx: DayContext): Minute[] {
  const block = blockFor(shift, mode);
  if (!block) return [];
  const out: Minute[] = [];
  // regla del contrato: imputar todo el turno al día en que empieza (habitual en nóminas de hostelería)
  const startDate = block.start.slice(0, 10);
  const toStartDay = !!contractAt(contracts, startDate)?.crossMidnightToStartDay;
  for (const iv of paidIntervals(block)) {
    for (let t = iv.start; t < iv.end; t += MINUTE) {
      const d = new Date(t);
      // los pluses (nocturnidad, fin de semana, festivo) dependen del momento real trabajado;
      // la imputación a día, semana y mes depende de la regla configurada
      const realDate = toDateKey(d);
      const date = toStartDay ? startDate : realDate;
      const c = contractAt(contracts, date);
      let flags = 0;
      if (c) {
        if (inNightWindow(d.getHours() * 60 + d.getMinutes(), c.night.start, c.night.end)) flags |= FLAG_NIGHT;
        if (c.weekend.days.includes(((d.getDay() + 6) % 7) as Weekday)) flags |= FLAG_WEEKEND;
      }
      if (ctx.holidays.has(realDate) || shift.kind === "holiday") flags |= FLAG_HOLIDAY;
      out.push({ t, date, flags });
    }
  }
  return out;
}

export interface AnalyzeInput {
  shifts: Shift[];
  contracts: Contract[];
  holidays: Holiday[];
  absences: Absence[];
  from: string;
  to: string;
  mode: CalcMode;
}

/**
 * Analiza un rango de fechas. El exceso se calcula por periodos de referencia completos
 * (aunque se salgan del rango) y cada minuto de exceso se imputa al día en que se trabaja.
 */
export function analyze(input: AnalyzeInput): Analysis {
  const { contracts, from, to, mode } = input;
  const ctx = buildDayContext(input.holidays, input.absences);
  const periods = contracts.length ? referencePeriods(contracts, from, to) : [{ from, to }];
  const extFrom = periods[0]?.from ?? from;
  const extTo = periods[periods.length - 1]?.to ?? to;

  // minutos de todos los turnos que tocan el rango ampliado (se incluye 3 días de margen por turnos largos)
  const lo = addDays(extFrom, -3);
  const relevant = input.shifts.filter((s) => s.date >= lo && s.date <= extTo);
  const minutes: Minute[] = [];
  for (const s of relevant) minutes.push(...shiftMinutes(s, mode, contracts, ctx));
  minutes.sort((a, b) => a.t - b.t);
  // evitar contar dos veces un mismo minuto si dos turnos se solapan (confirmado por el usuario)
  const unique: Minute[] = [];
  for (const m of minutes) if (unique.length === 0 || unique[unique.length - 1].t !== m.t) unique.push(m);

  const res: Analysis = {
    from, to, mode, paid: 0, net: 0, breaks: 0, night: 0, weekend: 0, holiday: 0, flagCombos: {}, byDay: {},
    daysWorked: 0, shiftCount: 0, expected: 0, nominal: 0,
    excess: { total: 0, complementary: 0, overtime: 0, unclassified: 0 }, ordinary: 0,
  };

  for (const m of unique) {
    if (m.date < from || m.date > to) continue;
    res.paid++;
    const day = (res.byDay[m.date] ??= emptyDay());
    day.paid++;
    if (m.flags & FLAG_NIGHT) { res.night++; day.night++; }
    if (m.flags & FLAG_WEEKEND) { res.weekend++; day.weekend++; }
    if (m.flags & FLAG_HOLIDAY) { res.holiday++; day.holiday++; }
    res.flagCombos[m.flags] = (res.flagCombos[m.flags] ?? 0) + 1;
  }

  // minutos netos (sin descansos) y descansos por día de inicio del turno
  for (const s of relevant) {
    const block = blockFor(s, mode);
    if (!block || s.date < from || s.date > to) continue;
    const d = blockDurations(block);
    const day = (res.byDay[s.date] ??= emptyDay());
    day.net += d.net;
    day.shifts++;
    res.net += d.net;
    res.breaks += d.breaks;
    res.shiftCount++;
  }
  res.daysWorked = Object.values(res.byDay).filter((d) => d.paid > 0).length;

  // horas esperadas en el rango
  if (contracts.length) {
    const scale = contractAt(contracts, from)?.referencePeriod === "monthly" && from.endsWith("-01") && to === endOfMonth(from.slice(0, 7));
    const e = expectedMinutes(contracts, from, to, ctx, scale);
    res.expected = e.expected;
    res.nominal = e.nominal;
  }

  // excesos por periodo de referencia
  if (contracts.length) {
    for (const p of periods) {
      const c = contractAt(contracts, p.from)!;
      const scale = c.referencePeriod === "monthly";
      const { expected, nominal } = expectedMinutes(contracts, p.from, p.to, ctx, scale);
      const periodDays = diffDays(p.from, p.to) + 1;
      const ftNominal = (c.fullTimeWeeklyMinutes * periodDays) / 7;
      const contractNominal = scale && c.monthlyMinutes > 0 ? c.monthlyMinutes : (c.weeklyMinutes * periodDays) / 7;
      const ratio = contractNominal > 0 ? expected / contractNominal : 1;
      const threshold = Math.max(expected, Math.round(ftNominal * Math.min(1, ratio)));
      void nominal;
      let cumulative = 0;
      let compUsed = 0;
      for (const m of unique) {
        if (m.date < p.from || m.date > p.to) continue;
        cumulative++;
        if (cumulative <= expected) continue;
        const inRange = m.date >= from && m.date <= to;
        let cls: "complementary" | "overtime" | "unclassified" = "unclassified";
        if (c.overtime.enabled && cumulative > threshold) cls = "overtime";
        else if (c.complementary.enabled && (!c.overtime.enabled || cumulative <= threshold)) {
          const limit = c.complementary.maxMinutesPerPeriod;
          if (limit <= 0 || compUsed < limit) {
            cls = "complementary";
            compUsed++;
          }
        }
        if (inRange) {
          res.excess.total++;
          res.excess[cls]++;
        }
      }
    }
  }
  res.ordinary = res.paid - res.excess.total;
  return res;
}

// ------------------------------------------------------------------ salario

export type LineKind = "earning" | "deduction";

export interface SalaryLine {
  key: string;
  label: string;
  detail: string;
  minutes?: number;
  rateCents?: number;
  amountCents: number;
  kind: LineKind;
  /** "user": importe fijo introducido por el usuario; "calc": calculado por la aplicación */
  source: "user" | "calc";
}

export interface SalaryResult {
  period: Period;
  ym: string;
  analysis: Analysis;
  hourlyCents: number;
  hourlyDerived: boolean;
  lines: SalaryLine[];
  grossCents: number;
  deductionsCents: number;
  /** null si el usuario no ha configurado hipótesis de deducciones */
  netCents: number | null;
  warnings: string[];
}

function premiumPerHourCents(rule: PremiumRule, hourly: number): number {
  if (!rule.enabled) return 0;
  return rule.mode === "percent" ? (hourly * rule.value) / 100 : rule.value;
}

function excessRate(rule: { payMode: string; value: number }, hourly: number): number {
  if (rule.payMode === "unpaid") return 0;
  if (rule.payMode === "fixed") return rule.value;
  return (hourly * rule.value) / 100;
}

function hoursLabel(min: number): string {
  return `${(min / 60).toLocaleString("es-ES", { maximumFractionDigits: 2 })} h`;
}

export interface SalaryInput {
  shifts: Shift[];
  contracts: Contract[];
  holidays: Holiday[];
  absences: Absence[];
  ym: string;
  /** "worked" (realizado) o "planned" (previsión) */
  mode?: CalcMode;
}

export function computeSalary(input: SalaryInput): SalaryResult | null {
  const mode = input.mode ?? "worked";
  const anchor = contractAt(input.contracts, endOfMonth(input.ym));
  if (!anchor) return null;
  const c = anchor;
  const period = payPeriod(c, input.ym);
  const analysis = analyze({ ...input, from: period.from, to: period.to, mode });
  const { cents: hourly, derived } = hourlyRate(c);
  const lines: SalaryLine[] = [];
  const warnings: string[] = [];
  if (hourly === 0) warnings.push("No hay precio por hora ni salario configurado: los importes por hora serán 0.");

  // Salario base
  let baseCents = 0;
  if (c.payType === "hourly") {
    baseCents = amountForMinutes(analysis.ordinary, hourly);
    lines.push({ key: "base", label: "Salario por horas ordinarias", detail: `${hoursLabel(analysis.ordinary)} × precio/hora`, minutes: analysis.ordinary, rateCents: hourly, amountCents: baseCents, kind: "earning", source: "calc" });
  } else {
    baseCents = c.monthlyGrossCents;
    lines.push({ key: "base", label: "Salario base mensual", detail: "Importe mensual introducido", amountCents: baseCents, kind: "earning", source: "user" });
  }

  // Pagas extra
  const extras = Math.max(0, c.numPayments - 12);
  const extraAmt = extraPayAmount(c);
  if (extras > 0 && extraAmt > 0) {
    if (c.extraPaysProrated) {
      const v = roundCents((extraAmt * extras) / 12);
      lines.push({ key: "extra-prorated", label: "Prorrata de pagas extra", detail: `${extras} pagas × importe ÷ 12`, amountCents: v, kind: "earning", source: "calc" });
    } else {
      const month = Number(input.ym.slice(5, 7));
      if (c.extraPayMonths.includes(month)) {
        lines.push({ key: "extra", label: "Paga extra", detail: "Mes configurado como de paga extra", amountCents: extraAmt, kind: "earning", source: "user" });
      }
    }
  } else if (extras > 0 && extraAmt === 0) {
    warnings.push("Hay pagas extra configuradas pero sin importe: indica el importe de cada paga.");
  }

  // Excesos
  const ex = analysis.excess;
  if (ex.unclassified > 0) {
    const rate = c.unclassifiedPay === "ordinary" ? hourly : 0;
    lines.push({
      key: "unclassified",
      label: "Diferencia sobre contrato (sin clasificar)",
      detail: c.unclassifiedPay === "ordinary" ? `${hoursLabel(ex.unclassified)} a precio ordinario (según tu configuración)` : `${hoursLabel(ex.unclassified)} no retribuidas (según tu configuración)`,
      minutes: ex.unclassified, rateCents: rate, amountCents: amountForMinutes(ex.unclassified, rate), kind: "earning", source: "calc",
    });
  }
  if (ex.complementary > 0) {
    const rate = excessRate(c.complementary, hourly);
    lines.push({ key: "complementary", label: "Horas complementarias", detail: c.complementary.payMode === "unpaid" ? `${hoursLabel(ex.complementary)} compensadas con descanso` : `${hoursLabel(ex.complementary)} × tarifa configurada`, minutes: ex.complementary, rateCents: roundCents(rate), amountCents: amountForMinutes(ex.complementary, rate), kind: "earning", source: "calc" });
  }
  if (ex.overtime > 0) {
    const rate = excessRate(c.overtime, hourly);
    lines.push({ key: "overtime", label: "Horas extraordinarias", detail: c.overtime.payMode === "unpaid" ? `${hoursLabel(ex.overtime)} compensadas con descanso` : `${hoursLabel(ex.overtime)} × tarifa configurada`, minutes: ex.overtime, rateCents: roundCents(rate), amountCents: amountForMinutes(ex.overtime, rate), kind: "earning", source: "calc" });
  }

  // Pluses por franja (nocturnidad, fin de semana, festivos)
  const rates = {
    night: premiumPerHourCents(c.night, hourly),
    weekend: premiumPerHourCents(c.weekend, hourly),
    holiday: premiumPerHourCents(c.holiday, hourly),
  };
  const premiumMinutes = { night: 0, weekend: 0, holiday: 0 };
  for (const [k, mins] of Object.entries(analysis.flagCombos)) {
    const flags = Number(k);
    const applicable: (keyof typeof rates)[] = [];
    if (flags & FLAG_NIGHT && rates.night > 0) applicable.push("night");
    if (flags & FLAG_WEEKEND && rates.weekend > 0) applicable.push("weekend");
    if (flags & FLAG_HOLIDAY && rates.holiday > 0) applicable.push("holiday");
    if (applicable.length === 0) continue;
    if (c.stackPremiums) for (const a of applicable) premiumMinutes[a] += mins;
    else {
      const best = applicable.reduce((x, y) => (rates[y] > rates[x] ? y : x));
      premiumMinutes[best] += mins;
    }
  }
  const premiumLabels = { night: "Plus de nocturnidad", weekend: "Plus de fin de semana", holiday: "Plus de festivos" } as const;
  for (const k of ["night", "weekend", "holiday"] as const) {
    const mins = premiumMinutes[k];
    if (mins <= 0) continue;
    const rule = c[k];
    lines.push({
      key: k, label: premiumLabels[k],
      detail: `${hoursLabel(mins)} × ${rule.mode === "percent" ? `${rule.value.toLocaleString("es-ES")} % del precio/hora` : "importe fijo por hora"}${c.stackPremiums ? "" : " (sin acumular pluses)"}`,
      minutes: mins, rateCents: roundCents(rates[k]), amountCents: amountForMinutes(mins, rates[k]), kind: "earning", source: "calc",
    });
  }

  // Otros complementos
  for (const oc of c.otherComplements) {
    if (!oc.enabled) continue;
    let amount = 0;
    let detail = "";
    let source: "user" | "calc" = "calc";
    switch (oc.type) {
      case "monthly_fixed": amount = oc.amount; detail = "Importe mensual fijo"; source = "user"; break;
      case "per_hour": amount = amountForMinutes(analysis.paid, oc.amount); detail = `${hoursLabel(analysis.paid)} × importe por hora`; break;
      case "per_day": amount = oc.amount * analysis.daysWorked; detail = `${analysis.daysWorked} días trabajados × importe por día`; break;
      case "percent_base": amount = percentOf(baseCents, oc.amount); detail = `${oc.amount.toLocaleString("es-ES")} % del salario base`; break;
    }
    if (amount !== 0) lines.push({ key: `oc-${oc.id}`, label: oc.name || "Complemento", detail, amountCents: amount, kind: "earning", source });
  }

  const grossCents = lines.reduce((s, l) => s + l.amountCents, 0);

  // Deducciones (solo hipótesis configuradas por el usuario)
  const activeDeductions = c.deductions.filter((d) => d.enabled);
  let deductionsCents = 0;
  for (const d of activeDeductions) {
    const v = d.type === "percent" ? percentOf(grossCents, d.value) : d.value;
    deductionsCents += v;
    lines.push({ key: `ded-${d.id}`, label: d.name || "Deducción", detail: d.type === "percent" ? `${d.value.toLocaleString("es-ES")} % del bruto (hipótesis tuya)` : "Importe fijo (hipótesis tuya)", amountCents: -v, kind: "deduction", source: d.type === "percent" ? "calc" : "user" });
  }

  return {
    period, ym: input.ym, analysis, hourlyCents: hourly, hourlyDerived: derived, lines, grossCents, deductionsCents,
    netCents: activeDeductions.length ? grossCents - deductionsCents : null, warnings,
  };
}

/** Calculadora rápida: duración e importe estimado de un turno aislado (sin excesos por periodo). */
export function quickCalc(params: {
  date: string;
  start: string;
  end: string;
  breaks: { start: string; end: string; paid: boolean }[];
  hourlyCents: number;
  contract?: Contract | null;
  holidays?: Holiday[];
}) {
  const block = buildBlock({ date: params.date, start: params.start, end: params.end, breaks: params.breaks });
  const durations = blockDurations(block);
  const c = params.contract ?? null;
  const holidays = new Set((params.holidays ?? []).map((h) => h.date));
  const combos: Record<number, number> = {};
  for (const iv of paidIntervals(block)) {
    for (let t = iv.start; t < iv.end; t += MINUTE) {
      const d = new Date(t);
      let flags = 0;
      if (c) {
        if (inNightWindow(d.getHours() * 60 + d.getMinutes(), c.night.start, c.night.end)) flags |= FLAG_NIGHT;
        if (c.weekend.days.includes(((d.getDay() + 6) % 7) as Weekday)) flags |= FLAG_WEEKEND;
      }
      if (holidays.has(toDateKey(d))) flags |= FLAG_HOLIDAY;
      combos[flags] = (combos[flags] ?? 0) + 1;
    }
  }
  const hourly = params.hourlyCents;
  const base = amountForMinutes(durations.paid, hourly);
  const premiums: { key: "night" | "weekend" | "holiday"; label: string; minutes: number; amountCents: number }[] = [];
  if (c) {
    const rates = { night: premiumPerHourCents(c.night, hourly), weekend: premiumPerHourCents(c.weekend, hourly), holiday: premiumPerHourCents(c.holiday, hourly) };
    const mins = { night: 0, weekend: 0, holiday: 0 };
    for (const [k, m] of Object.entries(combos)) {
      const f = Number(k);
      const app: (keyof typeof rates)[] = [];
      if (f & FLAG_NIGHT && rates.night > 0) app.push("night");
      if (f & FLAG_WEEKEND && rates.weekend > 0) app.push("weekend");
      if (f & FLAG_HOLIDAY && rates.holiday > 0) app.push("holiday");
      if (!app.length) continue;
      if (c.stackPremiums) for (const a of app) mins[a] += m;
      else mins[app.reduce((x, y) => (rates[y] > rates[x] ? y : x))] += m;
    }
    const labels = { night: "Plus de nocturnidad", weekend: "Plus de fin de semana", holiday: "Plus de festivos" };
    for (const k of ["night", "weekend", "holiday"] as const) {
      if (mins[k] > 0) premiums.push({ key: k, label: labels[k], minutes: mins[k], amountCents: amountForMinutes(mins[k], rates[k]) });
    }
  }
  const total = base + premiums.reduce((s, p) => s + p.amountCents, 0);
  return { block, durations, baseCents: base, premiums, totalCents: total, crossesMidnight: block.start.slice(0, 10) !== block.end.slice(0, 10) };
}

// ------------------------------------------------------------------ bolsa de horas

export interface BankRow {
  period: Period;
  expected: number;
  planned: number;
  worked: number;
  adjustments: number;
  diff: number;
  balance: number;
  excess: Analysis["excess"];
  current: boolean;
}

export function computeBank(input: {
  shifts: Shift[];
  contracts: Contract[];
  holidays: Holiday[];
  absences: Absence[];
  adjustments: { date: string; minutes: number }[];
  startDate: string;
  initialMinutes: number;
  until: string;
  today: string;
}): BankRow[] {
  const { contracts } = input;
  if (!contracts.length || input.startDate > input.until) return [];
  const periods = referencePeriods(contracts, input.startDate, input.until);
  let balance = input.initialMinutes;
  const rows: BankRow[] = [];
  for (const p0 of periods) {
    // el primer periodo puede empezar a mitad: se recorta al inicio de la bolsa
    const p = { from: p0.from < input.startDate ? input.startDate : p0.from, to: p0.to };
    const worked = analyze({ ...input, from: p.from, to: p.to, mode: "worked" });
    const planned = analyze({ ...input, from: p.from, to: p.to, mode: "planned" });
    const adj = input.adjustments.filter((a) => a.date >= p.from && a.date <= p.to).reduce((s, a) => s + a.minutes, 0);
    // la diferencia de un periodo en curso solo cuenta lo esperado hasta hoy
    const current = input.today >= p.from && input.today <= p.to;
    let expected = worked.expected;
    if (current) {
      const ctx = buildDayContext(input.holidays, input.absences);
      expected = expectedMinutes(contracts, p.from, input.today, ctx, false).expected;
    }
    if (p.from > input.today) expected = 0;
    const diff = worked.paid - expected + adj;
    balance += diff;
    rows.push({ period: p, expected: worked.expected, planned: planned.paid, worked: worked.paid, adjustments: adj, diff, balance, excess: worked.excess, current });
  }
  return rows;
}

// ------------------------------------------------------------------ vacaciones

export function vacationDaysIn(a: Absence, contract: Contract | null, holidays: Map<string, Holiday>, mode: "working" | "natural", year?: number): number {
  let n = 0;
  for (const d of dateRange(a.startDate, a.endDate)) {
    if (year && parseDateKey(d).getFullYear() !== year) continue;
    if (mode === "natural") { n++; continue; }
    const days: Weekday[] = contract?.workDays.length ? contract.workDays : [0, 1, 2, 3, 4];
    if (!days.includes(weekdayOf(d))) continue;
    if (holidays.has(d)) continue;
    n++;
  }
  return n;
}

export function vacationSummary(absences: Absence[], contract: Contract | null, holidays: Holiday[], annual: number, mode: "working" | "natural", year: number, today: string) {
  const hm = new Map(holidays.map((h) => [h.date, h]));
  let used = 0;
  let scheduled = 0;
  let requested = 0;
  for (const a of absences) {
    if (a.type !== "vacation" || a.status === "rejected") continue;
    const n = vacationDaysIn(a, contract, hm, mode, year);
    if (a.status === "requested") requested += n;
    else if (a.status === "taken" || a.endDate < today) used += n;
    else scheduled += n;
  }
  return { annual, used, scheduled, requested, available: annual - used - scheduled };
}

// ------------------------------------------------------------------ festivos

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toDateKey(new Date(year, month - 1, day));
}

/**
 * Festivos nacionales comunes de España (no sustituibles por las CC. AA.) calculados localmente.
 * Las comunidades pueden trasladar o sustituir otros festivos: verifica siempre el calendario oficial.
 */
export function spainNationalHolidays(year: number): { date: string; name: string }[] {
  return [
    { date: `${year}-01-01`, name: "Año Nuevo" },
    { date: `${year}-01-06`, name: "Epifanía del Señor" },
    { date: addDays(easterSunday(year), -2), name: "Viernes Santo" },
    { date: `${year}-05-01`, name: "Fiesta del Trabajo" },
    { date: `${year}-08-15`, name: "Asunción de la Virgen" },
    { date: `${year}-10-12`, name: "Fiesta Nacional de España" },
    { date: `${year}-11-01`, name: "Todos los Santos" },
    { date: `${year}-12-06`, name: "Día de la Constitución Española" },
    { date: `${year}-12-08`, name: "Inmaculada Concepción" },
    { date: `${year}-12-25`, name: "Natividad del Señor" },
  ];
}
