import type { Holiday, HolidayScope } from "./types";
import { isDateKey } from "./time";

const SCOPES: Record<string, HolidayScope> = {
  nacional: "national", national: "national", estatal: "national",
  autonomico: "regional", autonómico: "regional", regional: "regional", autonomica: "regional", autonómica: "regional", comunidad: "regional",
  local: "local", municipal: "local",
};

export const SCOPE_LABELS: Record<HolidayScope, string> = { national: "Nacional", regional: "Autonómico", local: "Local" };

/** Convierte "DD/MM/AAAA", "DD-MM-AAAA" o "AAAA-MM-DD" en "AAAA-MM-DD". */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, "");
  if (isDateKey(s)) return s;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (!m) return null;
  const k = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isDateKey(k) ? k : null;
}

export interface ParsedHolidays {
  items: Omit<Holiday, "id">[];
  errors: string[];
}

/**
 * Importa festivos desde:
 *  - CSV/TXT: una línea por festivo "fecha;nombre;ámbito" (separador ; , o tabulador; cabecera opcional).
 *  - JSON: [{ "date": "2026-12-25", "name": "Navidad", "scope": "national" }, ...]
 */
export function parseHolidayFile(text: string, defaultScope: HolidayScope = "local"): ParsedHolidays {
  const out: ParsedHolidays = { items: [], errors: [] };
  const t = text.replace(/^﻿/, "").trim();
  if (!t) return { items: [], errors: ["El archivo está vacío."] };
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const raw = JSON.parse(t);
      const arr = Array.isArray(raw) ? raw : Array.isArray(raw.holidays) ? raw.holidays : null;
      if (!arr) return { items: [], errors: ["El JSON debe ser una lista de festivos."] };
      arr.forEach((r: Record<string, unknown>, i: number) => {
        const date = normalizeDate(String(r.date ?? r.fecha ?? ""));
        const name = String(r.name ?? r.nombre ?? "").trim();
        const scope = SCOPES[String(r.scope ?? r.ambito ?? r["ámbito"] ?? "").toLowerCase()] ?? defaultScope;
        if (!date || !name) out.errors.push(`Elemento ${i + 1}: fecha o nombre no válidos.`);
        else out.items.push({ date, name, scope });
      });
    } catch {
      out.errors.push("JSON no válido.");
    }
    return out;
  }
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const sep = line.includes(";") ? ";" : line.includes("\t") ? "\t" : ",";
    const cols = line.split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
    const date = normalizeDate(cols[0] ?? "");
    if (!date) {
      if (i === 0) return; // cabecera
      out.errors.push(`Línea ${i + 1}: fecha no válida («${cols[0]}»).`);
      return;
    }
    const name = (cols[1] ?? "").trim() || "Festivo";
    const scope = SCOPES[(cols[2] ?? "").toLowerCase()] ?? defaultScope;
    out.items.push({ date, name, scope });
  });
  return out;
}

export function holidaysToCsv(list: Holiday[]): string {
  return "﻿fecha;nombre;ámbito\r\n" + list.map((h) => `${h.date.split("-").reverse().join("/")};${h.name.replace(/;/g, ",")};${SCOPE_LABELS[h.scope].toLowerCase()}`).join("\r\n") + "\r\n";
}
