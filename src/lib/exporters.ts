/**
 * Escritores de formatos: CSV (compatible con Excel en español), XLSX y PDF.
 * Todo se genera en el dispositivo; nada se envía a ningún servidor.
 */
import { strToU8, zipSync } from "fflate";
import type { Cell, Report } from "./reports";

const fmtNum = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 2, useGrouping: false });

function csvCell(c: Cell): string {
  if (c == null) return "";
  const s = typeof c === "number" ? fmtNum(c) : c;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV separado por punto y coma, con BOM UTF-8 y coma decimal (abre bien en Excel en español). */
export function reportToCsv(r: Report): string {
  const lines: string[] = [];
  lines.push(csvCell(r.title));
  lines.push(csvCell(r.subtitle));
  lines.push(csvCell(`Generado: ${r.generatedAt}`));
  for (const n of r.notes) lines.push(csvCell(n));
  for (const t of r.tables) {
    lines.push("");
    if (r.tables.length > 1) lines.push(csvCell(t.name));
    lines.push(t.columns.map(csvCell).join(";"));
    for (const row of t.rows) lines.push(row.map(csvCell).join(";"));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}

const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

function colName(i: number): string {
  let s = "";
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Hoja";
  let n = 2;
  let candidate = base;
  while (used.has(candidate.toLowerCase())) candidate = `${base.slice(0, 28)} ${n++}`;
  used.add(candidate.toLowerCase());
  base = candidate;
  return base;
}

function cellXml(ref: string, v: Cell, style = 0): string {
  const s = style ? ` s="${style}"` : "";
  if (v == null || v === "") return "";
  if (typeof v === "number") return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
}

/** Libro Excel (.xlsx) con una hoja por tabla, generado sin dependencias de pago. */
export function reportToXlsx(r: Report): Uint8Array {
  const used = new Set<string>();
  const sheets = r.tables.map((t, idx) => {
    const rows: string[] = [];
    let rowIdx = 1;
    const push = (cells: Cell[], style = 0) => {
      rows.push(`<row r="${rowIdx}">${cells.map((c, i) => cellXml(`${colName(i)}${rowIdx}`, c, style)).join("")}</row>`);
      rowIdx++;
    };
    if (idx === 0) {
      push([r.title], 1);
      push([r.subtitle]);
      push([`Generado: ${r.generatedAt}`]);
      for (const n of r.notes) push([n]);
      rowIdx++;
    }
    push(t.columns, 1);
    for (const row of t.rows) push(row);
    const widths = t.columns.map((c, i) => Math.min(60, Math.max(c.length, ...t.rows.map((row) => String(row[i] ?? "").length)) + 2));
    const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
    return {
      name: sheetName(t.name, used),
      xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows.join("")}</sheetData></worksheet>`,
    };
  });
  if (sheets.length === 0) sheets.push({ name: "Informe", xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${`<row r="1">${cellXml("A1", r.title, 1)}</row>`}</sheetData></worksheet>` });

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml)));
  return zipSync(files, { level: 6 });
}

/** PDF con tablas (jsPDF + autotable, MIT). Se carga bajo demanda para no aumentar la carga inicial. */
export async function reportToPdf(r: Report): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const { autoTable } = await import("jspdf-autotable");
  const wide = r.tables.some((t) => t.columns.length > 7);
  const doc = new jsPDF({ orientation: wide ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const clean = (s: string) => s.replace(/−/g, "-").replace(/[–—]/g, "-").replace(/ | /g, " ");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(clean(r.title), 40, 48);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(clean(r.subtitle), 40, 66);
  doc.text(clean(`Generado: ${r.generatedAt} · SHIFT CALCULATOR`), 40, 80);
  let y = 96;
  for (const n of r.notes) {
    const lines = doc.splitTextToSize(clean(n), doc.internal.pageSize.getWidth() - 80);
    doc.text(lines, 40, y);
    y += 12 * lines.length;
  }
  doc.setTextColor(0);
  for (const t of r.tables) {
    if (r.tables.length > 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(clean(t.name), 40, y + 14);
      y += 20;
    }
    autoTable(doc, {
      startY: y + 4,
      head: [t.columns.map(clean)],
      body: t.rows.map((row) => row.map((c) => (c == null ? "" : typeof c === "number" ? fmtNum(c) : clean(c)))),
      styles: { fontSize: wide ? 7 : 8.5, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
      alternateRowStyles: { fillColor: [245, 246, 250] },
      columnStyles: Object.fromEntries((t.numeric ?? []).map((i) => [i, { halign: "right" as const }])),
      margin: { left: 40, right: 40 },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16;
  }
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Página ${i} de ${pages}`, doc.internal.pageSize.getWidth() - 100, doc.internal.pageSize.getHeight() - 20);
  }
  return doc.output("blob");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
