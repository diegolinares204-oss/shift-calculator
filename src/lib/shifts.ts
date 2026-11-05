import type { BreakInterval, Shift, ShiftKind, ShiftSpec, TimeBlock } from "./types";
import { addDays, combine, dateOf, isHHMM, minutesBetween, resolveAfter, toEpoch, MINUTE } from "./time";

export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  normal: "Jornada normal",
  morning: "Mañana",
  afternoon: "Tarde",
  night: "Noche",
  split: "Partido",
  weekend: "Fin de semana",
  holiday: "Festivo",
  oncall: "Guardia",
  training: "Formación",
  other: "Otro",
};

export const SHIFT_STATUS_LABELS = { planned: "Previsto", done: "Realizado", cancelled: "Cancelado" } as const;

export interface BlockDurations {
  /** Desde entrada hasta salida */
  gross: number;
  /** Descansos (fusionados, recortados al turno) */
  breaks: number;
  paidBreaks: number;
  unpaidBreaks: number;
  /** Tiempo efectivo de trabajo (sin ningún descanso) */
  net: number;
  /** Tiempo retribuido = bruto − descansos no remunerados */
  paid: number;
}

interface Interval {
  start: number;
  end: number;
  paid: boolean;
}

/**
 * Recorta los descansos al turno y fusiona solapamientos para no contarlos dos veces.
 * Si un tramo está cubierto a la vez por un descanso remunerado y otro no remunerado,
 * prevalece el no remunerado.
 */
export function normalizedBreaks(block: TimeBlock): Interval[] {
  const s = toEpoch(block.start);
  const e = toEpoch(block.end);
  const raw: Interval[] = block.breaks
    .map((b) => ({ start: Math.max(s, toEpoch(b.start)), end: Math.min(e, toEpoch(b.end)), paid: b.paid }))
    .filter((b) => b.end > b.start);
  if (raw.length === 0) return [];
  const points = [...new Set(raw.flatMap((b) => [b.start, b.end]))].sort((a, b) => a - b);
  const out: Interval[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const z = points[i + 1];
    const covering = raw.filter((b) => b.start <= a && b.end >= z);
    if (covering.length === 0) continue;
    const paid = covering.every((b) => b.paid);
    const last = out[out.length - 1];
    if (last && last.end === a && last.paid === paid) last.end = z;
    else out.push({ start: a, end: z, paid });
  }
  return out;
}

export function blockDurations(block: TimeBlock): BlockDurations {
  const gross = Math.max(0, minutesBetween(block.start, block.end));
  let paidBreaks = 0;
  let unpaidBreaks = 0;
  for (const b of normalizedBreaks(block)) {
    const m = Math.round((b.end - b.start) / MINUTE);
    if (b.paid) paidBreaks += m;
    else unpaidBreaks += m;
  }
  const breaks = paidBreaks + unpaidBreaks;
  return { gross, breaks, paidBreaks, unpaidBreaks, net: gross - breaks, paid: gross - unpaidBreaks };
}

/** Intervalos retribuidos (epoch ms) de un bloque: el turno menos los descansos no remunerados. */
export function paidIntervals(block: TimeBlock): { start: number; end: number }[] {
  const s = toEpoch(block.start);
  const e = toEpoch(block.end);
  if (e <= s) return [];
  const unpaid = normalizedBreaks(block).filter((b) => !b.paid);
  const out: { start: number; end: number }[] = [];
  let cursor = s;
  for (const b of unpaid) {
    if (b.start > cursor) out.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < e) out.push({ start: cursor, end: e });
  return out;
}

/** Bloque efectivamente trabajado de un turno realizado (real si existe, si no el previsto). */
export function workedBlock(shift: Shift): TimeBlock | null {
  if (shift.status !== "done") return null;
  return shift.actual ?? shift.planned;
}

export function plannedBlock(shift: Shift): TimeBlock | null {
  if (shift.status === "cancelled") return null;
  return shift.planned;
}

export type CalcMode = "planned" | "worked";

export function blockFor(shift: Shift, mode: CalcMode): TimeBlock | null {
  return mode === "worked" ? workedBlock(shift) : plannedBlock(shift);
}

export interface BuildBlockInput {
  date: string;
  start: string;
  end: string;
  /** Fecha de salida explícita (para turnos de más de 24 h o cambios de fecha) */
  endDate?: string | null;
  breaks: { start: string; end: string; paid: boolean }[];
}

/**
 * Construye un bloque a partir de horas "HH:mm". Si la salida es anterior o igual a la
 * entrada se interpreta que el turno cruza la medianoche. Los descansos se sitúan
 * dentro del turno (el primer instante posterior a la entrada con esa hora).
 */
export function buildBlock(input: BuildBlockInput): TimeBlock {
  const start = combine(input.date, input.start);
  const end = input.endDate ? combine(input.endDate, input.end) : resolveAfter(start, input.end);
  const breaks: BreakInterval[] = input.breaks
    .filter((b) => isHHMM(b.start) && isHHMM(b.end))
    .map((b) => {
      const bs = resolveAfter(start, b.start, true);
      const be = resolveAfter(bs, b.end);
      return { start: bs, end: be, paid: b.paid };
    });
  return { start, end, breaks };
}

export function specToBlock(date: string, spec: ShiftSpec): TimeBlock {
  return buildBlock({ date, start: spec.start, end: spec.end, breaks: spec.breaks });
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export const MAX_SHIFT_HOURS = 72;

export function validateBlock(block: TimeBlock): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const gross = minutesBetween(block.start, block.end);
  if (gross <= 0) {
    issues.push({ level: "error", code: "order", message: "La salida debe ser posterior a la entrada." });
    return issues;
  }
  if (gross > MAX_SHIFT_HOURS * 60) {
    issues.push({ level: "error", code: "too-long", message: `Un turno no puede superar ${MAX_SHIFT_HOURS} horas. Divídelo en varios turnos.` });
  } else if (gross > 24 * 60) {
    issues.push({ level: "warning", code: "over-24h", message: "El turno dura más de 24 horas. Confirma que es correcto." });
  } else if (gross > 14 * 60) {
    issues.push({ level: "warning", code: "long", message: "Turno de más de 14 horas." });
  }
  for (const b of block.breaks) {
    const bs = toEpoch(b.start);
    const be = toEpoch(b.end);
    if (be <= bs) issues.push({ level: "error", code: "break-order", message: "Un descanso termina antes de empezar." });
    else if (bs < toEpoch(block.start) || be > toEpoch(block.end))
      issues.push({ level: "error", code: "break-outside", message: "Hay un descanso fuera del horario del turno." });
  }
  const d = blockDurations(block);
  if (d.breaks >= d.gross) issues.push({ level: "error", code: "breaks-cover", message: "Los descansos ocupan todo el turno." });
  return issues;
}

/** Turnos (no cancelados) cuyo horario previsto se solapa con el bloque dado. */
export function findOverlaps(block: TimeBlock, shifts: Shift[], excludeId?: string): Shift[] {
  const s = toEpoch(block.start);
  const e = toEpoch(block.end);
  return shifts.filter((sh) => {
    if (sh.id === excludeId || sh.status === "cancelled") return false;
    const b = sh.actual && sh.status === "done" ? sh.actual : sh.planned;
    return toEpoch(b.start) < e && toEpoch(b.end) > s;
  });
}

export function isDuplicate(block: TimeBlock, shifts: Shift[], excludeId?: string): boolean {
  return shifts.some((sh) => sh.id !== excludeId && sh.status !== "cancelled" && sh.planned.start === block.start && sh.planned.end === block.end);
}

/** Desplaza un bloque completo a otra fecha conservando horas y duración. */
export function shiftBlockToDate(block: TimeBlock, newDate: string): TimeBlock {
  const offset = Math.round((toEpoch(combine(newDate, "12:00")) - toEpoch(combine(dateOf(block.start), "12:00"))) / 86_400_000);
  const move = (ldt: string) => `${addDays(dateOf(ldt), offset)}${ldt.slice(10)}`;
  return { start: move(block.start), end: move(block.end), breaks: block.breaks.map((b) => ({ ...b, start: move(b.start), end: move(b.end) })) };
}

export function shiftToSpec(shift: Shift): ShiftSpec {
  const b = shift.planned;
  return {
    start: b.start.slice(11, 16),
    end: b.end.slice(11, 16),
    breaks: b.breaks.map((x) => ({ start: x.start.slice(11, 16), end: x.end.slice(11, 16), paid: x.paid })),
    kind: shift.kind,
    tags: [...shift.tags],
  };
}

/** Comparación previsto vs. real en minutos (positivo = se trabajó más de lo previsto). */
export function comparePlannedActual(shift: Shift): { planned: number; actual: number; diff: number; startDelta: number; endDelta: number } | null {
  if (!shift.actual) return null;
  const p = blockDurations(shift.planned).paid;
  const a = blockDurations(shift.actual).paid;
  return {
    planned: p,
    actual: a,
    diff: a - p,
    startDelta: minutesBetween(shift.planned.start, shift.actual.start),
    endDelta: minutesBetween(shift.planned.end, shift.actual.end),
  };
}

export function sortShifts<T extends Shift>(list: T[]): T[] {
  return [...list].sort((a, b) => a.planned.start.localeCompare(b.planned.start));
}
