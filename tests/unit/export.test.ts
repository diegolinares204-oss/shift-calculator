import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { buildReport, type ReportData } from "@/lib/reports";
import { reportToCsv, reportToPdf, reportToXlsx } from "@/lib/exporters";
import { defaultProfile } from "@/lib/defaults";
import { contract, shift } from "../helpers";
import { MAIN_JOB_ID, makeJob } from "@/lib/jobs";

const data: ReportData = {
  profile: { ...defaultProfile(), name: "Prueba" },
  jobs: [makeJob({ id: MAIN_JOB_ID, name: "Bar" })],
  contracts: [contract({ weeklyMinutes: 900, hourlyRateCents: 1000 })],
  shifts: [shift("2026-11-02", "20:30", "01:00"), shift("2026-11-03", "09:00", "13:00", { status: "planned", breaks: [] })],
  sessions: [{ id: "s", jobId: MAIN_JOB_ID, startAt: new Date("2026-11-02T20:30:00").getTime(), endAt: new Date("2026-11-03T01:00:00").getTime(), notes: "Nota; con \"comillas\"", source: "live", createdAt: 0, updatedAt: 0 }],
  breaks: [],
  holidays: [],
  absences: [],
  payslips: [{ id: "p", jobId: MAIN_JOB_ID, period: "2026-11", grossCents: 5000, netCents: 4500, concepts: [], notes: "", createdAt: 0, updatedAt: 0 }],
};

describe("informes y exportación", () => {
  it("informe mensual con resumen, turnos y desglose", () => {
    const r = buildReport("monthly", data, "2026-11-01", "2026-11-30");
    expect(r.tables.map((t) => t.name)).toEqual(["Resumen", "Turnos", "Desglose salarial"]);
    const row = r.tables[0].rows[0];
    expect(row[3]).toBe(4.5); // horas realizadas
    expect(row[9]).toBeNull(); // sin deducciones configuradas no se inventa un neto
    expect(row[10]).toBe(45); // neto real de la nómina
    expect(row[12]).toBe(45); // bruto estimado 4,5 h × 10 €
    expect(row[13]).toBe(50); // bruto real de la nómina
    expect(row[14]).toBe(5);
  });
  it("el neto estimado figura antes que el bruto cuando hay deducciones", () => {
    const withDed = { ...data, contracts: [contract({ weeklyMinutes: 900, hourlyRateCents: 1000, deductions: [{ id: "d", name: "Retención", type: "percent", value: 10, enabled: true }] })] };
    const r = buildReport("monthly", withDed, "2026-11-01", "2026-11-30");
    expect(r.tables[0].columns[9]).toMatch(/^Neto estimado/);
    expect(r.tables[0].rows[0][9]).toBe(40.5); // 45 € − 10 %
    expect(r.tables[0].rows[0][11]).toBe(4.5); // neto real 45 − estimado 40,5
    expect(r.tables[2].rows.at(-1)).toEqual(["NETO ESTIMADO", "Lo que cobrarías según tus deducciones", 40.5]);
  });
  it("informe anual con fila de totales", () => {
    const r = buildReport("annual", data, "2026-01-01", "2026-12-31");
    expect(r.tables[0].rows).toHaveLength(13);
    expect(r.tables[0].rows[12][0]).toBe("TOTAL");
  });
  it("CSV con BOM, punto y coma, coma decimal y escape", () => {
    const csv = reportToCsv(buildReport("clock", data, "2026-11-01", "2026-11-30"));
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("4,5");
    expect(csv).toContain('"Nota; con ""comillas"""');
    expect(csv).toContain("02/11/2026 20:30");
  });
  it("XLSX válido con una hoja por tabla", () => {
    const bytes = reportToXlsx(buildReport("monthly", data, "2026-11-01", "2026-11-30"));
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toContain("xl/workbook.xml");
    expect(strFromU8(files["xl/workbook.xml"])).toContain('name="Desglose salarial"');
    expect(strFromU8(files["xl/worksheets/sheet2.xml"])).toContain("20:30");
  });
  it("PDF generado localmente", async () => {
    const blob = await reportToPdf(buildReport("salary", data, "2026-11-01", "2026-11-30"));
    const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 5);
    expect(String.fromCharCode(...head)).toBe("%PDF-");
  });
});
