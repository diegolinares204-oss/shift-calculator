import { describe, expect, it } from "vitest";
import { parseHolidayFile, holidaysToCsv, normalizeDate } from "@/lib/holidays";

describe("importación de festivos", () => {
  it("normaliza fechas", () => {
    expect(normalizeDate("25/12/2026")).toBe("2026-12-25");
    expect(normalizeDate("1-5-2026")).toBe("2026-05-01");
    expect(normalizeDate("2026-02-30")).toBeNull();
  });
  it("CSV con cabecera y ámbitos", () => {
    const r = parseHolidayFile("fecha;nombre;ámbito\n25/12/2026;Navidad;nacional\n2026-09-08;Fiesta patronal;local\n31/02/2026;Malo;local\n");
    expect(r.items).toEqual([{ date: "2026-12-25", name: "Navidad", scope: "national" }, { date: "2026-09-08", name: "Fiesta patronal", scope: "local" }]);
    expect(r.errors).toHaveLength(1);
  });
  it("JSON", () => {
    const r = parseHolidayFile('[{"date":"2026-04-02","name":"Jueves Santo","scope":"autonómico"}]');
    expect(r.items[0]).toEqual({ date: "2026-04-02", name: "Jueves Santo", scope: "regional" });
  });
  it("ida y vuelta CSV", () => {
    const csv = holidaysToCsv([{ id: "1", date: "2026-12-25", name: "Navidad", scope: "national" }]);
    expect(parseHolidayFile(csv).items).toEqual([{ date: "2026-12-25", name: "Navidad", scope: "national" }]);
  });
});
