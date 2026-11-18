/**
 * Analizador de cuadrantes (optimizado para capturas de Orquest y formatos similares).
 *
 * Recibe el resultado del OCR (fragmentos de texto con su posición en la imagen) y obtiene,
 * por día, los horarios de entrada y salida y los días libres. Funciona por geometría:
 *  - Formato lista (un día por fila): cada horario se asigna al día de su fila o al
 *    encabezado de día más cercano por encima.
 *  - Formato semana en columnas: cada horario se asigna a la columna (día) más cercana.
 * Nunca inventa datos: lo que no se reconoce con seguridad se marca como dudoso o se deja sin
 * asignar para que el usuario lo revise.
 */
import { addDays, addMonths, diffDays, isDateKey, parseDateKey, toDateKey, weekdayOf } from "./time";

export interface OcrBox { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; confidence: number; bbox: OcrBox }
export interface OcrLine { text: string; confidence: number; bbox: OcrBox; words: OcrWord[] }
export interface OcrResult { lines: OcrLine[]; width: number; height: number }

export interface RosterShift {
  start: string;
  end: string;
  /** las horas se reconstruyeron a partir de horas sueltas */
  rebuilt?: boolean;
  /**
   * Tramo posterior a la medianoche dentro del mismo día del cuadrante
   * (p. ej. "19:00 - 23:30 / 0:30 - 3:00": el segundo tramo es ya el día siguiente).
   */
  nextDay?: boolean;
}

export interface RosterRow {
  key: string;
  /** AAAA-MM-DD; null si no se pudo determinar */
  date: string | null;
  /** texto del día tal como se leyó */
  label: string;
  shifts: RosterShift[];
  dayOff: boolean;
  /** 0-100: confianza mínima de las lecturas usadas */
  confidence: number;
  issues: string[];
}

export interface RosterParse {
  rows: RosterRow[];
  layout: "list" | "grid" | "none";
  /** rango de fechas detectado en el encabezado, si lo hay */
  detectedRange: { from: string; to: string } | null;
  /** horarios que no se han podido asociar a ningún día */
  unassigned: string[];
}

const WEEKDAYS: Record<string, number> = {
  lunes: 0, lun: 0, lu: 0, mon: 0, monday: 0,
  martes: 1, mar: 1, ma: 1, tue: 1, tuesday: 1,
  miercoles: 2, mie: 2, mi: 2, x: 2, wed: 2, wednesday: 2,
  jueves: 3, jue: 3, ju: 3, thu: 3, thursday: 3,
  viernes: 4, vie: 4, vi: 4, fri: 4, friday: 4,
  sabado: 5, sab: 5, sa: 5, sat: 5, saturday: 5,
  domingo: 6, dom: 6, do: 6, sun: 6, sunday: 6,
};

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, jan: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4, apr: 4, may: 5, mayo: 5,
  jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8, aug: 8, sep: 9, sept: 9, septiembre: 9, set: 9,
  oct: 10, octubre: 10, nov: 11, noviembre: 11, dic: 12, diciembre: 12, dec: 12,
};

const OFF_RE = /\b(libre|descanso|day\s*off|off|vacaciones|vacacion|baja|no\s*laborable|sin\s*turno|ausencia|festivo)\b/;
const IGNORE_TIMES_RE = /\b(total|totales|horas\s+semana|semana:|acumulad|balance|saldo)\b/;

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Corrige confusiones típicas del OCR dentro de lo que parecen horas: O→0, l/I/|→1, "." o "h" como
 * separador. Devuelve el texto corregido y si se ha corregido algo.
 */
export function fixTimeChars(text: string): { text: string; fixed: boolean } {
  let fixed = false;
  const out = text.replace(/([0-9OoIl|]{1,2})\s?[:.;h]\s?([0-9OoIl|]{2})(?![0-9])/g, (m, h: string, mm: string) => {
    const map = (s: string) => s.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
    const nh = map(h);
    const nm = map(mm);
    if (!/^\d{1,2}$/.test(nh) || !/^\d{2}$/.test(nm)) return m;
    if (nh !== h || nm !== mm) fixed = true;
    return `${nh}:${nm}`;
  });
  return { text: out, fixed };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function validTime(h: number, m: number) {
  return h >= 0 && h <= 24 && m >= 0 && m < 60 && !(h === 24 && m > 0);
}

function fmtTime(h: number, m: number) {
  return `${pad2(h === 24 ? 0 : h)}:${pad2(m)}`;
}

// ------------------------------------------------------------------ tokens

type TokenKind = "day" | "range" | "time" | "off" | "header" | "num";

interface Token {
  kind: TokenKind;
  cx: number;
  cy: number;
  h: number;
  conf: number;
  text: string;
  fixed?: boolean;
  // día
  dayNum?: number;
  month?: number;
  year?: number;
  weekday?: number;
  // horario
  start?: string;
  end?: string;
  time?: string;
  /** hora suelta junto a "/" (fragmento de dos turnos distintos): no se empareja */
  noPair?: boolean;
  // encabezado de rango
  from?: { d: number; m: number };
  to?: { d: number; m: number };
}

interface Piece { text: string; words: OcrWord[] }

/** Posición (centro) y confianza de la parte de una línea que ocupa [a, b) en el texto unido. */
function spanGeometry(piece: Piece, offsets: number[], a: number, b: number) {
  const ws = piece.words.filter((_, i) => offsets[i] < b && offsets[i] + piece.words[i].text.length > a);
  const list = ws.length ? ws : piece.words;
  const x0 = Math.min(...list.map((w) => w.bbox.x0));
  const x1 = Math.max(...list.map((w) => w.bbox.x1));
  const y0 = Math.min(...list.map((w) => w.bbox.y0));
  const y1 = Math.max(...list.map((w) => w.bbox.y1));
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, h: Math.max(1, y1 - y0), conf: Math.min(...list.map((w) => w.confidence)) };
}

function tokenize(line: OcrLine): Token[] {
  const words = line.words.length ? line.words : [{ text: line.text, confidence: line.confidence, bbox: line.bbox }];
  const offsets: number[] = [];
  let joined = "";
  for (const w of words) {
    if (joined) joined += " ";
    offsets.push(joined.length);
    joined += w.text;
  }
  const piece: Piece = { text: joined, words };
  const { text: fixedText, fixed } = fixTimeChars(joined);
  // la corrección mantiene longitudes casi iguales; para posiciones usamos el texto original
  // ruido habitual alrededor de etiquetas y bordes ("|", "_", "[", ")"…): se sustituye por espacios
  // (misma longitud, para conservar las posiciones)
  const norm = stripAccents(fixedText).toLowerCase().replace(/[_|()[\]{}"“”'`~=<>]/g, " ");
  const tokens: Token[] = [];
  const geo = (a: number, b: number) => spanGeometry(piece, offsets, Math.min(a, joined.length - 1), Math.min(b, joined.length));
  const used: [number, number][] = [];
  const isUsed = (a: number, b: number) => used.some(([x, y]) => a < y && b > x);

  // encabezado de rango: "17 nov - 23 nov 2026"
  const rangeRe = /(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?\s*(?:-|–|—|al|a)\s*(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?(?:\s*(?:de\s+)?(20\d{2}))?/g;
  for (const m of norm.matchAll(rangeRe)) {
    const m1 = MONTHS[m[2]];
    const m2 = MONTHS[m[4]];
    if (!m1 || !m2) continue;
    const a = m.index!;
    const b = a + m[0].length;
    used.push([a, b]);
    tokens.push({ kind: "header", ...geo(a, b), text: m[0], from: { d: +m[1], m: m1 }, to: { d: +m[3], m: m2 }, year: m[5] ? +m[5] : undefined });
  }

  const ignoreTimes = IGNORE_TIMES_RE.test(norm);

  // horarios "08:00 - 12:30"
  const rangeTimeRe = /(\d{1,2}):(\d{2})\s*(?:h\s*)?(?:-|–|—|a|al|hasta|>|→)\s*(\d{1,2}):(\d{2})/g;
  for (const m of norm.matchAll(rangeTimeRe)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (isUsed(a, b)) continue;
    used.push([a, b]);
    if (ignoreTimes) continue;
    const [h1, m1, h2, m2] = [+m[1], +m[2], +m[3], +m[4]];
    if (!validTime(h1, m1) || !validTime(h2, m2)) continue;
    tokens.push({ kind: "range", ...geo(a, b), text: m[0], start: fmtTime(h1, m1), end: fmtTime(h2, m2), fixed });
  }
  // horas sueltas (formatos en los que entrada y salida están en líneas distintas)
  for (const m of norm.matchAll(/(\d{1,2}):(\d{2})/g)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (isUsed(a, b)) continue;
    used.push([a, b]);
    if (ignoreTimes) continue;
    const [h, mi] = [+m[1], +m[2]];
    if (!validTime(h, mi)) continue;
    const around = norm.slice(Math.max(0, a - 3), Math.min(norm.length, b + 3));
    tokens.push({ kind: "time", ...geo(a, b), text: m[0], time: fmtTime(h, mi), fixed, noPair: around.includes("/") });
  }
  // días: "lun 17", "Mar1", "17 nov", "17/11", "lunes"
  const dayRe = /\b(\d{1,2})\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom)\.?\b|\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|lun|mar|mie|jue|vie|sab|dom|mon|tue|wed|thu|fri|sat|sun)\.?\s*(\d{1,2})?\b|\b(\d{1,2})\s*(?:de\s+)?(ene|enero|feb|febrero|marzo|abr|abril|may|mayo|jun|junio|jul|julio|ago|agosto|sep|sept|septiembre|oct|octubre|nov|noviembre|dic|diciembre)\b|\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
  for (const m of norm.matchAll(dayRe)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (isUsed(a, b)) continue;
    let t: Token | null = null;
    if (m[1]) {
      // "23 lun": número delante del día de la semana ("mar" aquí es martes; marzo se escribe entero)
      t = { kind: "day", ...geo(a, b), text: m[0], weekday: WEEKDAYS[m[2]], dayNum: +m[1] };
    } else if (m[3]) {
      // "mar" delante de un número es martes
      t = { kind: "day", ...geo(a, b), text: m[0], weekday: WEEKDAYS[m[3]], dayNum: m[4] ? +m[4] : undefined };
    } else if (m[5]) {
      t = { kind: "day", ...geo(a, b), text: m[0], dayNum: +m[5], month: MONTHS[m[6]] };
    } else if (m[7]) {
      const y = m[9] ? (m[9].length === 2 ? 2000 + +m[9] : +m[9]) : undefined;
      if (+m[8] >= 1 && +m[8] <= 12) t = { kind: "day", ...geo(a, b), text: m[0], dayNum: +m[7], month: +m[8], year: y };
    }
    if (t && (t.dayNum === undefined || (t.dayNum >= 1 && t.dayNum <= 31))) {
      used.push([a, b]);
      tokens.push(t);
    }
  }
  // días libres
  for (const m of norm.matchAll(new RegExp(OFF_RE.source, "g"))) {
    const a = m.index!;
    const b = a + m[0].length;
    if (isUsed(a, b)) continue;
    used.push([a, b]);
    tokens.push({ kind: "off", ...geo(a, b), text: m[0] });
  }
  // números sueltos 1-31: posibles días apilados en una etiqueta ("23" encima de "Lun")
  for (const m of norm.matchAll(/(?<![\d:/])\b(\d{1,2})\b(?![:/\d])/g)) {
    const a = m.index!;
    const b = a + m[0].length;
    if (isUsed(a, b)) continue;
    const n = +m[1];
    if (n < 1 || n > 31) continue;
    used.push([a, b]);
    tokens.push({ kind: "num", ...geo(a, b), text: m[0], dayNum: n });
  }
  // año suelto ("noviembre 2026")
  const year = norm.match(/\b(20\d{2})\b/);
  if (year && !tokens.some((t) => t.kind === "header")) {
    const mo = norm.match(/\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/);
    tokens.push({ kind: "header", ...geo(0, joined.length), text: year[0], year: +year[1], from: mo ? { d: 1, m: MONTHS[mo[1]] } : undefined });
  }
  return tokens;
}

// ------------------------------------------------------------------ fechas

/** Elige la fecha concreta para un día del mes, cerca de la referencia y sin retroceder. */
function resolveDate(t: Token, ref: string, prev: string | null, year?: number): { date: string | null; issue?: string } {
  if (t.dayNum === undefined) {
    if (t.weekday === undefined) return { date: null };
    // solo día de la semana: siguiente fecha con ese día a partir del anterior (o del lunes de referencia)
    let d = prev ? addDays(prev, 1) : addDays(ref, -weekdayOf(ref));
    for (let i = 0; i < 7; i++) {
      if (weekdayOf(d) === t.weekday) return { date: d, issue: "Fecha deducida solo del día de la semana" };
      d = addDays(d, 1);
    }
    return { date: null };
  }
  const refD = parseDateKey(ref);
  const candidates: string[] = [];
  if (t.month) {
    const years = year ? [year] : [refD.getFullYear() - 1, refD.getFullYear(), refD.getFullYear() + 1];
    for (const y of years) {
      const k = toDateKey(new Date(y, t.month - 1, t.dayNum));
      if (isDateKey(k) && Number(k.slice(8)) === t.dayNum) candidates.push(k);
    }
  } else {
    for (let off = -2; off <= 2; off++) {
      const ym = addMonths(ref.slice(0, 7), off);
      const k = `${ym}-${pad2(t.dayNum)}`;
      if (isDateKey(k)) candidates.push(k);
    }
  }
  if (!candidates.length) return { date: null };
  const score = (k: string) => {
    let sc = Math.abs(diffDays(ref, k));
    if (prev && k <= prev) sc += 1000; // las fechas avanzan
    if (prev && diffDays(prev, k) > 40) sc += 200;
    if (t.weekday !== undefined && weekdayOf(k) !== t.weekday) sc += 500;
    return sc;
  };
  const best = [...candidates].sort((a, b) => score(a) - score(b))[0];
  const issue = t.weekday !== undefined && weekdayOf(best) !== t.weekday ? "El día de la semana leído no coincide con la fecha" : undefined;
  return { date: best, issue };
}

// ------------------------------------------------------------------ análisis

export interface ParseOptions {
  /** fecha de referencia (semana o mes del cuadrante); por defecto, hoy */
  reference: string;
  /** confianza mínima para no marcar una lectura como dudosa */
  minConfidence?: number;
}

const tokenValue = (t: Token) =>
  t.kind === "range" ? `${t.start}-${t.end}` : t.kind === "time" ? t.time! : t.kind === "num" ? String(t.dayNum) : t.kind === "off" ? "off" : "";

const near = (a: Token, b: Token, fx = 3, fy = 0.8) => {
  const h = Math.max(a.h, b.h);
  return Math.abs(a.cx - b.cx) < h * fx && Math.abs(a.cy - b.cy) < h * fy;
};

/**
 * Une las lecturas de varias pasadas de OCR: elimina repetidas (misma lectura en la misma
 * posición), resuelve discrepancias quedándose con la de mayor confianza y combina número y
 * día de la semana apilados en una misma etiqueta ("23" sobre "Lun").
 */
export function consolidateTokens(all: Token[]): Token[] {
  const out: Token[] = [];
  // 1. horarios, horas sueltas, días libres y números: las lecturas de una misma posición se agrupan
  //    y gana el valor más respaldado por las distintas pasadas (suma de confianzas)
  const clusters: Token[][] = [];
  for (const t of all.filter((x) => x.kind !== "day" && x.kind !== "header")) {
    const c = clusters.find((cl) => cl[0].kind === t.kind && cl.some((o) => near(o, t, t.kind === "range" ? 2.5 : 1.5, 0.8)));
    if (c) c.push(t);
    else clusters.push([t]);
  }
  for (const cl of clusters) {
    const votes = new Map<string, { score: number; best: Token }>();
    for (const t of cl) {
      const v = votes.get(tokenValue(t));
      const score = Math.max(1, t.conf);
      if (v) { v.score += score; if (t.conf > v.best.conf) v.best = t; }
      else votes.set(tokenValue(t), { score, best: t });
    }
    const winner = [...votes.values()].sort((a, b) => b.score - a.score)[0];
    const alternatives = votes.size - 1;
    out.push(alternatives > 0 && winner.score < cl.reduce((acc, t) => acc + Math.max(1, t.conf), 0) * 0.6 ? { ...winner.best, conf: Math.min(winner.best.conf, 60) } : winner.best);
  }
  // un horario suelto que ya forma parte de un intervalo leído en otra pasada sobra
  const ranges = out.filter((t) => t.kind === "range");
  const filtered = out.filter((t) => t.kind !== "time" || !ranges.some((r) => near(r, t, 6, 0.8) && (r.start === t.time || r.end === t.time)));
  const nums = filtered.filter((t) => t.kind === "num");
  const rest = filtered.filter((t) => t.kind !== "num");

  // 2. días: combinar lecturas compatibles de la misma etiqueta
  const days: Token[] = [];
  for (const d0 of all.filter((x) => x.kind === "day").sort((a, b) => b.conf - a.conf)) {
    const d = { ...d0 };
    const same = days.find((o) => near(o, d, 3, 1.2) && (o.weekday === undefined || d.weekday === undefined || o.weekday === d.weekday) && (o.dayNum === undefined || d.dayNum === undefined || o.dayNum === d.dayNum));
    if (same) {
      same.weekday ??= d.weekday;
      same.dayNum ??= d.dayNum;
      same.month ??= d.month;
      continue;
    }
    days.push(d);
  }
  // 3. número apilado encima (o debajo) del día de la semana: se usa como día del mes
  const usedNums = new Set<Token>();
  for (const d of days.filter((x) => x.weekday !== undefined)) {
    const cand = nums
      .filter((n) => !usedNums.has(n) && Math.abs(n.cx - d.cx) <= Math.max(n.h, d.h) * 1.5 && Math.abs(n.cy - d.cy) <= Math.max(n.h, d.h) * 2.5 && Math.abs(n.cy - d.cy) >= Math.min(n.h, d.h) * 0.5)
      .sort((a, b) => Math.abs(a.cx - d.cx) + Math.abs(a.cy - d.cy) - (Math.abs(b.cx - d.cx) + Math.abs(b.cy - d.cy)) || (a.cy < d.cy ? -1 : 1));
    if (!cand.length) continue;
    // si varias pasadas leen números distintos en la etiqueta, gana el más respaldado
    const tally = new Map<number, number>();
    for (const c of cand) tally.set(c.dayNum!, (tally.get(c.dayNum!) ?? 0) + Math.max(1, c.conf));
    const bestNum = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const n = cand.find((c) => c.dayNum === bestNum)!;
    // en una etiqueta apilada manda el número de la etiqueta (una cifra pegada al día suele ser ruido)
    d.dayNum = n.dayNum;
    const y0 = Math.min(d.cy - d.h / 2, n.cy - n.h / 2);
    const y1 = Math.max(d.cy + d.h / 2, n.cy + n.h / 2);
    d.cy = (y0 + y1) / 2;
    d.h = y1 - y0;
    d.conf = Math.max(d.conf, n.conf);
    d.text = `${n.dayNum} ${d.text}`;
    usedNums.add(n);
  }
  // fusión final de días que tras emparejar resultan ser el mismo
  const finalDays: Token[] = [];
  for (const d of days.sort((a, b) => (b.dayNum !== undefined ? 1 : 0) - (a.dayNum !== undefined ? 1 : 0) || b.conf - a.conf)) {
    if (finalDays.some((o) => near(o, d, 3, 1.2) && (o.weekday === d.weekday || d.weekday === undefined) && (d.dayNum === undefined || o.dayNum === d.dayNum))) continue;
    finalDays.push(d);
  }
  return [...all.filter((x) => x.kind === "header"), ...finalDays, ...rest];
}

export function parseRoster(ocr: OcrResult, opts: ParseOptions): RosterParse {
  const minConf = opts.minConfidence ?? 80;
  const tokens = consolidateTokens(ocr.lines.flatMap(tokenize));
  const header = tokens.find((t) => t.kind === "header");
  let reference = opts.reference;
  let year: number | undefined = header?.year;
  let detectedRange: RosterParse["detectedRange"] = null;
  if (header?.from) {
    const y = year ?? parseDateKey(opts.reference).getFullYear();
    const from = toDateKey(new Date(y, header.from.m - 1, header.from.d));
    let to = header.to ? toDateKey(new Date(y, header.to.m - 1, header.to.d)) : from;
    if (to < from) to = toDateKey(new Date(y + 1, header.to!.m - 1, header.to!.d));
    if (header.to) detectedRange = { from, to };
    reference = from;
    if (header.to && to.slice(0, 4) !== from.slice(0, 4)) year = undefined; // el rango cruza el año
  }

  const days = tokens.filter((t) => t.kind === "day");
  const items = tokens.filter((t) => t.kind === "range" || t.kind === "time" || t.kind === "off");
  if (!days.length) {
    return { rows: [], layout: "none", detectedRange, unassigned: items.filter((t) => t.kind !== "off").map((t) => t.text) };
  }

  // ¿formato en columnas? 3 o más días en la misma horizontal
  const medianH = [...days].sort((a, b) => a.h - b.h)[Math.floor(days.length / 2)].h;
  const rowsOfDays: Token[][] = [];
  for (const d of [...days].sort((a, b) => a.cy - b.cy)) {
    const row = rowsOfDays.find((r) => Math.abs(r[0].cy - d.cy) < medianH * 0.8);
    if (row) row.push(d);
    else rowsOfDays.push([d]);
  }
  const grid = rowsOfDays.some((r) => r.length >= 3);
  const ordered = grid
    ? rowsOfDays.flatMap((r) => [...r].sort((a, b) => a.cx - b.cx))
    : [...days].sort((a, b) => a.cy - b.cy || a.cx - b.cx);

  // fechas, en dos fases: primero los días con número; después los que solo tienen día de la
  // semana, situados entre sus vecinos (un "Lun" antes de "24 Mar" es el 23)
  const dates: (string | null)[] = ordered.map(() => null);
  const dateIssues: (string | undefined)[] = ordered.map(() => undefined);
  let prevNum: string | null = null;
  const bySequence = new Set<number>();
  ordered.forEach((d, i) => {
    if (d.dayNum === undefined) return;
    const { date, issue } = resolveDate(d, reference, prevNum, year);
    // salto anómalo en la secuencia (p. ej. "5 mar" leído en lugar de "24 mar"): se deduce de los vecinos
    const gap = date && prevNum ? diffDays(prevNum, date) : null;
    const breaksSequence = gap !== null && (gap < 1 || gap > 7);
    // el número manda mientras mantenga la secuencia; si la rompe y además no cuadra con el día
    // de la semana (o salta más de una semana), se considera mal leído
    if (d.weekday !== undefined && (breaksSequence || (!date && issue))) {
      // el número leído no cuadra con el día de la semana: probablemente está mal leído;
      // la fecha se deducirá de los días vecinos y se marcará para revisar
      bySequence.add(i);
      return;
    }
    if (date) prevNum = date;
    dates[i] = date;
    dateIssues[i] = issue;
  });
  ordered.forEach((d, i) => {
    if ((d.dayNum !== undefined && !bySequence.has(i)) || d.weekday === undefined) return;
    if (bySequence.has(i)) dateIssues[i] = `El número del día leído (${d.dayNum}) no cuadra con el día de la semana: fecha deducida de los días vecinos, revísala`;
    const prevK = [...dates.slice(0, i)].reverse().find(Boolean) ?? null;
    const nextK = dates.slice(i + 1).find(Boolean) ?? null;
    if (nextK) {
      let x = addDays(nextK, -1);
      for (let k = 0; k < 7 && (!prevK || x > prevK); k++, x = addDays(x, -1)) if (weekdayOf(x) === d.weekday) { dates[i] = x; return; }
    }
    if (prevK) {
      let x = addDays(prevK, 1);
      for (let k = 0; k < 7; k++, x = addDays(x, 1)) if (weekdayOf(x) === d.weekday && (!nextK || x < nextK)) { dates[i] = x; return; }
    }
    const res = resolveDate(d, reference, prevK, year);
    dates[i] = res.date;
    dateIssues[i] = res.issue;
  });
  const rowsMap = new Map<Token, RosterRow>();
  ordered.forEach((d, i) => {
    const date = dates[i];
    const issue = dateIssues[i];
    const issues: string[] = [];
    if (!date) issues.push("No se ha reconocido la fecha: indícala");
    if (issue) issues.push(issue);
    rowsMap.set(d, { key: `r${i}`, date, label: d.text, shifts: [], dayOff: false, confidence: Math.round(d.conf), issues });
  });

  // asignación de horarios a días
  const tol = medianH * 0.75;
  const ys = [...days].map((d) => d.cy).sort((a, b) => a - b);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((g) => g > medianH * 0.5).sort((a, b) => a - b);
  const rowGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : medianH * 3;
  // estilo de lista: ¿la mayoría de horarios comparten fila con un día?
  const sameRowStyle = !grid && items.filter((it) => days.some((d) => Math.abs(d.cy - it.cy) < medianH * 0.6)).length * 2 >= items.length;
  const owner = (t: Token): Token | null => {
    if (grid) {
      const headerRow = [...rowsOfDays].filter((r) => r.length >= 3 && r[0].cy < t.cy - tol / 2).sort((a, b) => b[0].cy - a[0].cy)[0];
      if (!headerRow) return null;
      return [...headerRow].sort((a, b) => Math.abs(a.cx - t.cx) - Math.abs(b.cx - t.cx))[0];
    }
    if (sameRowStyle) {
      // filas "día … horario": el día más cercano en vertical (un turno partido puede quedar
      // ligeramente por encima o por debajo de la etiqueta del día)
      const near = [...days].sort((a, b) => Math.abs(a.cy - t.cy) - Math.abs(b.cy - t.cy))[0];
      return Math.abs(near.cy - t.cy) <= rowGap * 0.6 ? near : null;
    }
    // encabezados de día con sus turnos debajo: el encabezado más cercano por encima
    const above = days.filter((d) => d.cy <= t.cy + tol);
    if (!above.length) return null;
    return above.sort((a, b) => b.cy - a.cy || Math.abs(a.cx - t.cx) - Math.abs(b.cx - t.cx))[0];
  };
  const unassigned: string[] = [];
  const loneTimes = new Map<Token, Token[]>();
  for (const it of [...items].sort((a, b) => a.cy - b.cy || a.cx - b.cx)) {
    const d = owner(it);
    const row = d ? rowsMap.get(d) : undefined;
    if (!d || !row) {
      if (it.kind !== "off") unassigned.push(it.text);
      continue;
    }
    row.confidence = Math.min(row.confidence, Math.round(it.conf));
    if (it.kind === "off") row.dayOff = true;
    else if (it.kind === "range") {
      // la misma lectura de otra pasada no se añade dos veces
      if (!row.shifts.some((x) => x.start === it.start && x.end === it.end)) row.shifts.push({ start: it.start!, end: it.end! });
      if (it.fixed) row.issues.push("Se han corregido caracteres dudosos en las horas");
    } else {
      loneTimes.set(d, [...(loneTimes.get(d) ?? []), it]);
      if (it.fixed) row.issues.push("Se han corregido caracteres dudosos en las horas");
    }
  }
  // horas sueltas: se emparejan en orden (entrada, salida)
  for (const [d, list] of loneTimes) {
    const row = rowsMap.get(d)!;
    // si el día ya tiene horarios completos, las horas sueltas son fragmentos de otra lectura
    if (row.shifts.length) continue;
    if (list.some((t) => t.noPair)) {
      row.issues.push(`Horas sueltas sin horario completo (${list.map((t) => t.time).join(", ")}): revísalas`);
      unassigned.push(...list.map((t) => t.time!));
      continue;
    }
    for (let i = 0; i + 1 < list.length; i += 2) row.shifts.push({ start: list[i].time!, end: list[i + 1].time!, rebuilt: true });
    if (list.length % 2 === 1) {
      row.issues.push(`Hora sin pareja (${list[list.length - 1].time}): complétala o descártala`);
      unassigned.push(list[list.length - 1].time!);
    }
  }

  const rows = ordered.map((d) => rowsMap.get(d)!);
  for (const r of rows) {
    // tramos en orden de lectura: si uno empieza antes que el anterior, ya es de madrugada del día siguiente
    let after = false;
    r.shifts.forEach((s, i) => {
      if (i > 0 && s.start < r.shifts[i - 1].start) after = true;
      if (after) s.nextDay = true;
    });
    r.issues = [...new Set(r.issues)];
    if (r.confidence < minConf) r.issues.push(`Lectura poco fiable (${r.confidence} %)`);
    if (r.dayOff && r.shifts.length) r.issues.push("Aparece como libre y con horario a la vez");
    if (!r.dayOff && !r.shifts.length && r.date) r.issues.push("No se ha leído ningún horario para este día");
    for (const s of r.shifts) {
      const mins = durationMinutes(s.start, s.end);
      if (mins === 0) r.issues.push(`Horario ${s.start}–${s.end} sin duración`);
      else if (mins > 14 * 60) r.issues.push(`Horario ${s.start}–${s.end} de más de 14 h`);
    }
  }
  return { rows, layout: grid ? "grid" : "list", detectedRange, unassigned };
}

/** Duración en minutos de un horario "HH:mm"–"HH:mm" (cruza la medianoche si la salida es menor). */
export function durationMinutes(start: string, end: string): number {
  const [h1, m1] = start.split(":").map(Number);
  const [h2, m2] = end.split(":").map(Number);
  const a = h1 * 60 + m1;
  let b = h2 * 60 + m2;
  if (b <= a) b += 24 * 60;
  const d = b - a;
  return d === 24 * 60 ? 0 : d;
}
