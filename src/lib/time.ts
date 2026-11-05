/**
 * Utilidades de fecha y hora. Todas trabajan con la hora local del dispositivo,
 * de modo que los cambios de horario de verano/invierno se respetan al calcular
 * duraciones reales.
 */
import type { Weekday } from "./types";

export const MINUTE = 60_000;
export const DAY_MIN = 24 * 60;

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "YYYY-MM-DD" de una fecha local */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DDTHH:mm" de una fecha local */
export function toLocalDateTime(d: Date): string {
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const HM_RE = /^(\d{1,2}):(\d{2})$/;

export function isDateKey(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = parseDateKey(s);
  return toDateKey(d) === s;
}

export function isLocalDateTime(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DT_RE.exec(s);
  if (!m) return false;
  return isDateKey(`${m[1]}-${m[2]}-${m[3]}`) && +m[4] < 24 && +m[5] < 60;
}

export function isHHMM(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = HM_RE.exec(s);
  return !!m && +m[1] < 24 && +m[2] < 60;
}

export function parseDateKey(s: string): Date {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`Fecha no válida: ${s}`);
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

export function parseLocalDateTime(s: string): Date {
  const m = DT_RE.exec(s);
  if (!m) throw new Error(`Fecha y hora no válida: ${s}`);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}

export function toEpoch(s: string): number {
  return parseLocalDateTime(s).getTime();
}

export function hhmmToMinutes(s: string): number {
  const m = HM_RE.exec(s);
  if (!m) throw new Error(`Hora no válida: ${s}`);
  return +m[1] * 60 + +m[2];
}

export function minutesToHHMM(min: number): string {
  const m = ((min % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function addDays(dateKey: string, n: number): string {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function diffDays(a: string, b: string): number {
  // días naturales de a hasta b (b - a), robusto frente a cambios de hora
  const da = parseDateKey(a);
  const db = parseDateKey(b);
  return Math.round((Date.UTC(db.getFullYear(), db.getMonth(), db.getDate()) - Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())) / 86_400_000);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** Día de la semana con lunes = 0 */
export function weekdayOf(dateKey: string): Weekday {
  return ((parseDateKey(dateKey).getDay() + 6) % 7) as Weekday;
}

export function startOfWeek(dateKey: string): string {
  return addDays(dateKey, -weekdayOf(dateKey));
}

export function endOfWeek(dateKey: string): string {
  return addDays(startOfWeek(dateKey), 6);
}

export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function startOfMonth(ym: string): string {
  return `${ym}-01`;
}

export function endOfMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return toDateKey(new Date(y, m, 0));
}

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * Combina una fecha y una hora "HH:mm". Si `notBefore` se indica y el resultado
 * es anterior o igual, se avanza al día siguiente (cruce de medianoche).
 */
export function combine(dateKey: string, hhmm: string): string {
  return `${dateKey}T${hhmm.padStart(5, "0")}`;
}

export function resolveAfter(reference: string, hhmm: string, allowEqual = false): string {
  const refDate = reference.slice(0, 10);
  let candidate = combine(refDate, hhmm);
  const cmp = candidate.localeCompare(reference);
  if (cmp < 0 || (cmp === 0 && !allowEqual)) candidate = combine(addDays(refDate, 1), hhmm);
  return candidate;
}

/** Duración en minutos reales entre dos fechas-hora locales (respeta horario de verano). */
export function minutesBetween(start: string, end: string): number {
  return Math.round((toEpoch(end) - toEpoch(start)) / MINUTE);
}

export function timeOf(ldt: string): string {
  return ldt.slice(11, 16);
}

export function dateOf(ldt: string): string {
  return ldt.slice(0, 10);
}

/** Intersección en minutos de dos intervalos epoch [a1,a2) y [b1,b2) */
export function overlapMs(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

// ----------------------------------------------------------------- formatos es-ES

const dateFmt = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
const longDateFmt = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortDayFmt = new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit", hour12: false });

/** DD/MM/AAAA */
export function fmtDate(dateKey: string): string {
  return dateFmt.format(parseDateKey(dateKey));
}

export function fmtDateLong(dateKey: string): string {
  const s = longDateFmt.format(parseDateKey(dateKey));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function fmtDayShort(dateKey: string): string {
  return shortDayFmt.format(parseDateKey(dateKey));
}

export function fmtMonth(ym: string): string {
  const s = monthFmt.format(parseDateKey(`${ym}-01`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** HH:mm 24 h desde epoch */
export function fmtTimeEpoch(ms: number): string {
  return timeFmt.format(new Date(ms));
}

export function fmtDateTimeEpoch(ms: number): string {
  return `${dateFmt.format(new Date(ms))} ${timeFmt.format(new Date(ms))}`;
}

/** Fecha-hora local → "DD/MM/AAAA HH:mm" */
export function fmtLocalDateTime(ldt: string): string {
  return `${fmtDate(dateOf(ldt))} ${timeOf(ldt)}`;
}

/** 450 → "7 h 30 min"; con compact → "7:30" */
export function fmtDuration(min: number, compact = false): string {
  const sign = min < 0 ? "-" : "";
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (compact) return `${sign}${h}:${pad(m)}`;
  if (h === 0) return `${sign}${m} min`;
  if (m === 0) return `${sign}${h} h`;
  return `${sign}${h} h ${m} min`;
}

/** Horas decimales con coma: 450 → "7,5 h" */
export function fmtHours(min: number, digits = 2): string {
  const v = min / 60;
  return `${v.toLocaleString("es-ES", { maximumFractionDigits: digits, minimumFractionDigits: 0 })} h`;
}

export function fmtSignedHours(min: number): string {
  const s = fmtHours(Math.abs(min));
  if (min > 0) return `+${s}`;
  if (min < 0) return `−${s}`;
  return s;
}

/** Horas decimales introducidas por el usuario ("7,5", "7.5", "7:30") → minutos */
export function parseHoursInput(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (HM_RE.test(s)) {
    const [h, m] = s.split(":").map(Number);
    return m < 60 ? h * 60 + m : null;
  }
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 60);
}

export const WEEKDAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const WEEKDAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"];
export const WEEKDAY_ABBR = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
export const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
