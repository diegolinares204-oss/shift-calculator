import { describe, expect, it } from "vitest";
import { addDays, dateRange, fmtDate, fmtDuration, fmtHours, minutesBetween, parseHoursInput, resolveAfter, startOfWeek, weekdayOf, endOfMonth, addMonths, isDateKey } from "@/lib/time";

describe("utilidades de tiempo", () => {
  it("formatea fechas en DD/MM/AAAA", () => {
    expect(fmtDate("2026-03-07")).toBe("07/03/2026");
  });
  it("lunes es el primer día de la semana", () => {
    expect(weekdayOf("2026-11-02")).toBe(0);
    expect(weekdayOf("2026-11-08")).toBe(6);
    expect(startOfWeek("2026-11-05")).toBe("2026-11-02");
  });
  it("resuelve el cruce de medianoche", () => {
    expect(resolveAfter("2026-11-05T20:30", "01:00")).toBe("2026-11-06T01:00");
    expect(resolveAfter("2026-11-05T08:00", "16:00")).toBe("2026-11-05T16:00");
  });
  it("calcula duraciones reales con cambio de hora (Europe/Madrid)", () => {
    // 29/03/2026: a las 02:00 pasan a ser las 03:00 → la noche dura una hora menos
    expect(minutesBetween("2026-03-28T22:00", "2026-03-29T06:00")).toBe(7 * 60);
    // 25/10/2026: a las 03:00 vuelven a ser las 02:00 → una hora más
    expect(minutesBetween("2026-10-24T22:00", "2026-10-25T06:00")).toBe(9 * 60);
  });
  it("rangos y meses", () => {
    expect(dateRange("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(endOfMonth("2028-02")).toBe("2028-02-29");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(isDateKey("2026-02-30")).toBe(false);
  });
  it("formatea y analiza horas", () => {
    expect(fmtDuration(450)).toBe("7 h 30 min");
    expect(fmtDuration(-90, true)).toBe("-1:30");
    expect(fmtHours(450)).toBe("7,5 h");
    expect(parseHoursInput("7,5")).toBe(450);
    expect(parseHoursInput("7:45")).toBe(465);
    expect(parseHoursInput("abc")).toBeNull();
  });
});
