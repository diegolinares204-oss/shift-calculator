import { describe, expect, it } from "vitest";
import { amountForMinutes, fmtMoney, parseMoney, percentOf, roundCents } from "@/lib/money";

describe("importes", () => {
  it("analiza importes en formato español e internacional", () => {
    expect(parseMoney("1.234,56")).toBe(123456);
    expect(parseMoney("1234.56")).toBe(123456);
    expect(parseMoney("12,5")).toBe(1250);
    expect(parseMoney("10")).toBe(1000);
    expect(parseMoney("0,005")).toBe(1);
    expect(parseMoney("abc")).toBeNull();
  });
  it("redondea sin errores de coma flotante", () => {
    expect(roundCents(100.5)).toBe(101);
    expect(roundCents(1.005 * 100)).toBe(101);
    expect(roundCents(-2.5)).toBe(-3);
    // 7 h 20 min a 10,01 €/h = 73,406666 → 73,41 €
    expect(amountForMinutes(440, 1001)).toBe(7341);
    expect(percentOf(33333, 25)).toBe(8333);
  });
  it("suma de 0,1 + 0,2 en céntimos es exacta", () => {
    expect(parseMoney("0,1")! + parseMoney("0,2")!).toBe(30);
  });
  it("formatea en euros por defecto", () => {
    expect(fmtMoney(123456).replace(/\s/g, " ")).toMatch(/1\.?234,56 €/);
  });
});
