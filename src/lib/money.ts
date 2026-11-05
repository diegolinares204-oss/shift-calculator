/**
 * Importes en céntimos enteros para evitar errores de coma flotante.
 */

export const CURRENCIES: { code: string; name: string }[] = [
  { code: "EUR", name: "Euro (€)" },
  { code: "USD", name: "Dólar estadounidense ($)" },
  { code: "GBP", name: "Libra esterlina (£)" },
  { code: "CHF", name: "Franco suizo (CHF)" },
  { code: "MXN", name: "Peso mexicano (MXN)" },
  { code: "ARS", name: "Peso argentino (ARS)" },
  { code: "COP", name: "Peso colombiano (COP)" },
  { code: "CLP", name: "Peso chileno (CLP)" },
  { code: "PEN", name: "Sol peruano (PEN)" },
  { code: "UYU", name: "Peso uruguayo (UYU)" },
  { code: "BOB", name: "Boliviano (BOB)" },
  { code: "PYG", name: "Guaraní (PYG)" },
  { code: "DOP", name: "Peso dominicano (DOP)" },
  { code: "GTQ", name: "Quetzal (GTQ)" },
  { code: "CRC", name: "Colón costarricense (CRC)" },
  { code: "VES", name: "Bolívar (VES)" },
];

const fmtCache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  let f = fmtCache.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("es-ES", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    fmtCache.set(currency, f);
  }
  return f;
}

export function fmtMoney(cents: number, currency = "EUR"): string {
  return formatter(currency).format(cents / 100);
}

/** Redondeo "half away from zero" de un valor (posiblemente fraccionario) a céntimo entero. */
export function roundCents(value: number): number {
  const s = Math.sign(value);
  // corrección de epsilon para valores como 1.005 * 100 = 100.49999999
  return s * Math.round(Math.abs(value) + 1e-9);
}

/** Importe por minutos a una tarifa en céntimos/hora. */
export function amountForMinutes(minutes: number, centsPerHour: number): number {
  return roundCents((minutes * centsPerHour) / 60);
}

/** Aplica un porcentaje a un importe en céntimos. */
export function percentOf(cents: number, percent: number): number {
  return roundCents((cents * percent) / 100);
}

/** "1.234,56" / "1234.56" / "12,5" → céntimos. Devuelve null si no es válido. */
export function parseMoney(input: string): number | null {
  let s = input.trim().replace(/\s|€|\$|£/g, "");
  if (!s) return null;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // el último separador es el decimal
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    s = s.replace(",", ".");
  } else if (lastDot > -1) {
    // "1.234" sin decimales se interpreta como miles si hay 3 cifras tras el punto y más de un punto
    const parts = s.split(".");
    if (parts.length > 2) s = parts.join("");
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const [int, dec = ""] = s.replace("-", "").split(".");
  const neg = s.startsWith("-");
  const decPadded = (dec + "000").slice(0, 3);
  let cents = Number(int) * 100 + Number(decPadded.slice(0, 2));
  if (Number(decPadded[2]) >= 5) cents += 1;
  return neg ? -cents : cents;
}

/** céntimos → "1234,56" para campos editables */
export function centsToInput(cents: number): string {
  if (!cents) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function parseNumber(input: string): number | null {
  const s = input.trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function numberToInput(n: number): string {
  if (!n) return "";
  return String(n).replace(".", ",");
}

export function fmtPercent(n: number): string {
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: 2 })} %`;
}
