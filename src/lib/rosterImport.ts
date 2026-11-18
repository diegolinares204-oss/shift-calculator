/**
 * Planificación de una importación de cuadrante: compara lo reconocido con los turnos que ya
 * existen en el calendario del trabajo elegido. No modifica nada: solo propone acciones que el
 * usuario confirma (añadir, sustituir u omitir). Nunca se proponen por defecto borrados.
 */
import type { Shift, TimeBlock } from "./types";
import { buildBlock, validateBlock } from "./shifts";
import { addDays, isDateKey, isHHMM, timeOf } from "./time";
import type { RosterRow } from "./roster";

export type ImportStatus = "new" | "exists" | "changed" | "done" | "invalid";
export type ImportAction = "add" | "replace" | "skip";

export interface ImportItem {
  key: string;
  date: string;
  start: string;
  end: string;
  status: ImportStatus;
  action: ImportAction;
  /** turnos existentes del mismo día y trabajo que se sustituirían */
  existing: { id: string; start: string; end: string; status: Shift["status"] }[];
  issues: string[];
  /** proviene de una lectura dudosa */
  doubtful: boolean;
}

export interface ImportPlan {
  items: ImportItem[];
  /** días que el cuadrante marca como libres pero en los que tienes turnos previstos */
  freedDays: { date: string; shifts: { id: string; start: string; end: string }[] }[];
}

export interface EditableRow {
  key: string;
  date: string;
  start: string;
  end: string;
  issues: string[];
  doubtful: boolean;
}

/** Convierte las filas del analizador en filas editables (una por turno). */
export function rowsToEditable(rows: RosterRow[]): EditableRow[] {
  const out: EditableRow[] = [];
  for (const r of rows) {
    if (r.dayOff && !r.shifts.length) continue;
    const doubtful = r.issues.length > 0;
    if (!r.shifts.length) {
      // día sin horario legible: se muestra vacío para que el usuario lo complete o lo descarte
      out.push({ key: `${r.key}-0`, date: r.date ?? "", start: "", end: "", issues: r.issues, doubtful: true });
      continue;
    }
    r.shifts.forEach((s, i) => out.push({
      key: `${r.key}-${i}`,
      // un tramo de madrugada ("… / 0:30 - 3:00") se guarda en el día siguiente, que es cuando ocurre
      date: r.date ? (s.nextDay ? addDays(r.date, 1) : r.date) : "",
      start: s.start, end: s.end,
      issues: [...r.issues, ...(s.rebuilt ? ["Horas reconstruidas a partir de horas sueltas"] : [])],
      doubtful: doubtful || !!s.rebuilt,
    }));
  }
  return out;
}

export function rowBlock(r: { date: string; start: string; end: string }): TimeBlock | null {
  if (!isDateKey(r.date) || !isHHMM(r.start) || !isHHMM(r.end)) return null;
  const b = buildBlock({ date: r.date, start: r.start, end: r.end, breaks: [] });
  return validateBlock(b).some((i) => i.level === "error") ? null : b;
}

export function planImport(rows: EditableRow[], dayOffDates: string[], existing: Shift[], jobId: string): ImportPlan {
  const mine = existing.filter((s) => s.jobId === jobId && s.status !== "cancelled");
  const byDate = new Map<string, Shift[]>();
  for (const s of mine) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const seen = new Set<string>();
  const items: ImportItem[] = [];
  for (const r of rows) {
    const block = rowBlock(r);
    const issues = [...r.issues];
    if (!block) {
      items.push({ key: r.key, date: r.date, start: r.start, end: r.end, status: "invalid", action: "skip", existing: [], issues: [...issues, "Completa una fecha y un horario válidos"], doubtful: true });
      continue;
    }
    const sig = `${block.start}|${block.end}`;
    if (seen.has(sig)) continue; // repetido dentro de la misma captura
    seen.add(sig);
    const sameDay = byDate.get(r.date) ?? [];
    const identical = sameDay.find((s) => s.planned.start === block.start && s.planned.end === block.end);
    const toInfo = (s: Shift) => ({ id: s.id, start: timeOf(s.planned.start), end: timeOf(s.planned.end), status: s.status });
    if (identical) {
      items.push({ key: r.key, date: r.date, start: r.start, end: r.end, status: "exists", action: "skip", existing: [toInfo(identical)], issues, doubtful: r.doubtful });
    } else if (sameDay.length) {
      const others = sameDay.filter((s) => !rows.some((x) => x.date === r.date && rowBlock(x)?.start === s.planned.start && rowBlock(x)?.end === s.planned.end));
      const anyDone = others.some((s) => s.status === "done");
      items.push({
        key: r.key, date: r.date, start: r.start, end: r.end,
        status: anyDone ? "done" : others.length ? "changed" : "new",
        // sustituir siempre requiere que el usuario lo elija
        action: anyDone || others.length ? "skip" : "add",
        existing: others.map(toInfo), issues, doubtful: r.doubtful,
      });
    } else {
      items.push({ key: r.key, date: r.date, start: r.start, end: r.end, status: "new", action: "add", existing: [], issues, doubtful: r.doubtful });
    }
  }
  const freedDays = [...new Set(dayOffDates)]
    .filter((d) => (byDate.get(d) ?? []).some((s) => s.status === "planned"))
    .map((d) => ({ date: d, shifts: (byDate.get(d) ?? []).filter((s) => s.status === "planned").map((s) => ({ id: s.id, start: timeOf(s.planned.start), end: timeOf(s.planned.end) })) }));
  return { items: items.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)), freedDays };
}
