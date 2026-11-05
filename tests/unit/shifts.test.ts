import { describe, expect, it } from "vitest";
import { blockDurations, buildBlock, comparePlannedActual, findOverlaps, isDuplicate, paidIntervals, shiftBlockToDate, validateBlock } from "@/lib/shifts";
import { shift } from "../helpers";

describe("turnos", () => {
  it("turno normal", () => {
    const b = buildBlock({ date: "2026-11-02", start: "09:00", end: "17:00", breaks: [] });
    expect(blockDurations(b)).toMatchObject({ gross: 480, net: 480, paid: 480 });
  });
  it("turno nocturno 20:30–01:00 cruza la medianoche", () => {
    const b = buildBlock({ date: "2026-11-02", start: "20:30", end: "01:00", breaks: [] });
    expect(b.end).toBe("2026-11-03T01:00");
    expect(blockDurations(b).gross).toBe(270);
  });
  it("descanso no remunerado se resta del tiempo retribuido", () => {
    const b = buildBlock({ date: "2026-11-02", start: "09:00", end: "17:00", breaks: [{ start: "13:00", end: "13:30", paid: false }] });
    expect(blockDurations(b)).toMatchObject({ gross: 480, net: 450, paid: 450, unpaidBreaks: 30 });
  });
  it("descanso remunerado no reduce el retribuido pero sí el efectivo", () => {
    const b = buildBlock({ date: "2026-11-02", start: "09:00", end: "17:00", breaks: [{ start: "11:00", end: "11:15", paid: true }] });
    expect(blockDurations(b)).toMatchObject({ net: 465, paid: 480, paidBreaks: 15 });
  });
  it("descansos solapados no se cuentan dos veces", () => {
    const b = buildBlock({ date: "2026-11-02", start: "09:00", end: "17:00", breaks: [{ start: "13:00", end: "14:00", paid: false }, { start: "13:30", end: "14:30", paid: false }] });
    expect(blockDurations(b).unpaidBreaks).toBe(90);
  });
  it("descanso mixto: prevalece el no remunerado en el tramo común", () => {
    const b = buildBlock({ date: "2026-11-02", start: "09:00", end: "17:00", breaks: [{ start: "13:00", end: "14:00", paid: true }, { start: "13:30", end: "14:30", paid: false }] });
    const d = blockDurations(b);
    expect(d.unpaidBreaks).toBe(60);
    expect(d.paidBreaks).toBe(30);
    expect(d.breaks).toBe(90);
  });
  it("descanso después de medianoche en turno nocturno", () => {
    const b = buildBlock({ date: "2026-11-02", start: "22:00", end: "06:00", breaks: [{ start: "02:00", end: "02:30", paid: false }] });
    expect(b.breaks[0].start).toBe("2026-11-03T02:00");
    expect(blockDurations(b).paid).toBe(450);
    expect(paidIntervals(b)).toHaveLength(2);
  });
  it("turno de más de 24 horas con fecha de salida explícita", () => {
    const b = buildBlock({ date: "2026-11-02", start: "08:00", end: "10:00", endDate: "2026-11-03", breaks: [] });
    expect(blockDurations(b).gross).toBe(26 * 60);
    expect(validateBlock(b).some((i) => i.code === "over-24h" && i.level === "warning")).toBe(true);
  });
  it("rechaza turnos excesivos y salidas anteriores", () => {
    const tooLong = buildBlock({ date: "2026-11-02", start: "08:00", end: "09:00", endDate: "2026-11-06", breaks: [] });
    expect(validateBlock(tooLong).some((i) => i.level === "error")).toBe(true);
    const inverted = buildBlock({ date: "2026-11-02", start: "08:00", end: "07:00", endDate: "2026-11-02", breaks: [] });
    expect(validateBlock(inverted)[0].code).toBe("order");
  });
  it("detecta solapamientos y duplicados (turnos partidos no se solapan)", () => {
    const morning = shift("2026-11-02", "09:00", "13:00", { status: "planned" });
    const evening = buildBlock({ date: "2026-11-02", start: "17:00", end: "21:00", breaks: [] });
    expect(findOverlaps(evening, [morning])).toHaveLength(0);
    const clash = buildBlock({ date: "2026-11-02", start: "12:00", end: "15:00", breaks: [] });
    expect(findOverlaps(clash, [morning])).toHaveLength(1);
    expect(isDuplicate(morning.planned, [morning])).toBe(true);
  });
  it("mueve un turno nocturno a otra fecha conservando la duración", () => {
    const s = shift("2026-11-02", "22:00", "06:00", { breaks: [{ start: "02:00", end: "02:30" }] });
    const moved = shiftBlockToDate(s.planned, "2026-11-10");
    expect(moved.start).toBe("2026-11-10T22:00");
    expect(moved.end).toBe("2026-11-11T06:00");
    expect(moved.breaks[0].start).toBe("2026-11-11T02:00");
  });
  it("compara previsto y real", () => {
    const s = shift("2026-11-02", "09:00", "17:00", { actual: ["08:45", "17:30"] });
    expect(comparePlannedActual(s)).toMatchObject({ planned: 480, actual: 525, diff: 45, startDelta: -15, endDelta: 30 });
  });
});
