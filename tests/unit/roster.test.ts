import { describe, expect, it, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { parseRoster, fixTimeChars, durationMinutes, type OcrResult, type OcrLine } from "@/lib/roster";
import { tesseractToOcr } from "@/lib/ocr";

const fixture = (f: string) => path.join(__dirname, "../fixtures", f);

/** Línea sintética de OCR: texto con posición, para casos límite sin imagen. */
function line(text: string, x: number, y: number, conf = 95): OcrLine {
  const words = text.split(" ").reduce<{ list: OcrLine["words"]; x: number }>((acc, w) => {
    const width = w.length * 10;
    acc.list.push({ text: w, confidence: conf, bbox: { x0: acc.x, y0: y, x1: acc.x + width, y1: y + 20 } });
    acc.x += width + 8;
    return acc;
  }, { list: [], x }).list;
  return { text, confidence: conf, bbox: { x0: x, y0: y, x1: words[words.length - 1].bbox.x1, y1: y + 20 }, words };
}
const ocr = (lines: OcrLine[]): OcrResult => ({ lines, width: 1000, height: 1000 });

describe("analizador de cuadrantes (datos sintéticos)", () => {
  it("corrige confusiones típicas del OCR en las horas", () => {
    expect(fixTimeChars("O8:3O - l2.00")).toEqual({ text: "08:30 - 12:00", fixed: true });
    expect(fixTimeChars("08:00 - 12:00").fixed).toBe(false);
  });
  it("duraciones con cruce de medianoche", () => {
    expect(durationMinutes("20:30", "01:00")).toBe(270);
    expect(durationMinutes("08:00", "08:00")).toBe(0);
  });
  it("formato lista con día libre, turno partido y nocturno", () => {
    const r = parseRoster(ocr([
      line("Mi horario 17 nov - 23 nov 2026", 10, 0),
      line("lun 17", 10, 60), line("08:00 - 12:30", 700, 60),
      line("mar 18", 10, 110), line("Libre", 700, 110),
      line("08:00 - 12:00", 700, 150), line("mié 19", 10, 160), line("17:00 - 21:00", 700, 172),
      line("jue 20", 10, 220), line("20:30 - 01:00", 700, 220),
      line("Total semana: 33:00 h", 10, 300),
    ]), { reference: "2026-01-01" });
    expect(r.layout).toBe("list");
    expect(r.detectedRange).toEqual({ from: "2026-11-17", to: "2026-11-23" });
    expect(r.rows.map((x) => [x.date, x.dayOff, x.shifts.map((s) => `${s.start}-${s.end}`).join(",")])).toEqual([
      ["2026-11-17", false, "08:00-12:30"],
      ["2026-11-18", true, ""],
      ["2026-11-19", false, "08:00-12:00,17:00-21:00"],
      ["2026-11-20", false, "20:30-01:00"],
    ]);
    expect(r.unassigned).toEqual([]);
  });
  it("cambio de mes y de año sin retroceder fechas", () => {
    const r = parseRoster(ocr([line("mié 30", 10, 0), line("09:00 - 13:00", 600, 0), line("jue 31", 10, 50), line("09:00 - 13:00", 600, 50), line("vie 1", 10, 100), line("Libre", 600, 100)]), { reference: "2026-12-28" });
    expect(r.rows.map((x) => x.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(r.rows.flatMap((x) => x.issues)).toEqual([]);
  });
  it("encabezado de día con los turnos debajo", () => {
    const r = parseRoster(ocr([line("Lunes 17", 10, 0), line("08:00 - 12:00", 10, 30), line("16:00 - 20:00", 10, 60), line("Martes 18", 10, 100), line("09:00 - 14:00", 10, 130)]), { reference: "2026-11-17" });
    expect(r.rows.map((x) => x.shifts.length)).toEqual([2, 1]);
  });
  it("si el día de la semana no coincide con la fecha, se avisa", () => {
    const r = parseRoster(ocr([line("dom 30", 10, 0), line("09:00 - 13:00", 600, 0)]), { reference: "2026-12-28" });
    expect(r.rows[0].issues.join(" ")).toMatch(/no coincide/);
  });
  it("horarios ilegibles: no se inventan, se marcan para revisar", () => {
    const r = parseRoster(ocr([line("lun 17", 10, 0), line("O8:?? - 1:", 600, 0, 40), line("mar 18", 10, 50), line("09:00 - 13:00", 600, 50, 45)]), { reference: "2026-11-17" });
    expect(r.rows[0].shifts).toEqual([]);
    expect(r.rows[0].issues.join(" ")).toMatch(/No se ha leído ningún horario/);
    expect(r.rows[1].shifts).toEqual([{ start: "09:00", end: "13:00" }]);
    expect(r.rows[1].issues.join(" ")).toMatch(/poco fiable/);
  });
  it("hora suelta sin pareja y horarios sin día se informan", () => {
    const r = parseRoster(ocr([line("10:00 - 14:00", 600, 0), line("lun 17", 10, 50), line("08:00", 600, 50)]), { reference: "2026-11-17" });
    expect(r.unassigned).toContain("10:00 - 14:00");
    expect(r.rows[0].issues.join(" ")).toMatch(/Hora sin pareja/);
  });
  it("sin días reconocibles devuelve vacío", () => {
    expect(parseRoster(ocr([line("texto cualquiera", 0, 0)]), { reference: "2026-11-17" })).toMatchObject({ rows: [], layout: "none" });
  });
});

describe("OCR real en el dispositivo (Tesseract.js, sin red)", () => {
  let worker: Worker;
  beforeAll(async () => {
    worker = await createWorker("spa", 1, { langPath: path.join(__dirname, "../../node_modules/@tesseract.js-data/spa/4.0.0_best_int"), cachePath: path.join(__dirname, "../../node_modules/.cache/tesseract"), gzip: true });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  }, 60_000);
  afterAll(async () => { await worker?.terminate(); });
  const read = async (f: string) => {
    const { data } = await worker.recognize(fixture(f), {}, { blocks: true });
    return tesseractToOcr(data as never, 0, 0);
  };
  const summary = (rows: ReturnType<typeof parseRoster>["rows"]) => rows.map((x) => `${x.date} ${x.dayOff ? "libre" : x.shifts.map((s) => `${s.start}-${s.end}`).join(",")}`);

  it("captura tipo lista (modo claro)", async () => {
    const r = parseRoster(await read("roster-list.png"), { reference: "2026-11-01" });
    expect(r.detectedRange).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(summary(r.rows)).toEqual([
      "2026-11-16 08:00-12:30", "2026-11-17 libre", "2026-11-18 20:30-01:00", "2026-11-19 13:00-17:00",
      "2026-11-20 08:00-12:00,17:00-21:00", "2026-11-21 libre", "2026-11-22 10:00-16:00",
    ]);
    // un cuadrante legible y coherente no genera avisos
    expect(r.rows.flatMap((x) => x.issues)).toEqual([]);
  }, 30_000);
  it("captura tipo lista (modo oscuro)", async () => {
    const r = parseRoster(await read("roster-list-dark.png"), { reference: "2026-11-01" });
    expect(summary(r.rows)).toHaveLength(7);
    expect(summary(r.rows)[4]).toBe("2026-11-20 08:00-12:00,17:00-21:00");
  }, 30_000);
  it("semana en columnas con cambio de mes y turno que acaba de madrugada", async () => {
    const r = parseRoster(await read("roster-grid.png"), { reference: "2026-11-25" });
    expect(r.layout).toBe("grid");
    expect(summary(r.rows)).toEqual([
      "2026-11-30 07:00-15:00", "2026-12-01 libre", "2026-12-02 16:00-23:30", "2026-12-03 18:00-02:00",
      "2026-12-04 libre", "2026-12-05 09:00-13:00", "2026-12-06 12:00-20:00",
    ]);
  }, 30_000);
  it("imagen ilegible: no reconoce nada y no inventa", async () => {
    const r = parseRoster(await read("roster-blurry.png"), { reference: "2026-11-01" });
    expect(r.rows.flatMap((x) => x.shifts)).toEqual([]);
  }, 30_000);
});

describe("planificación e importación de cuadrantes", async () => {
  const { planImport, rowsToEditable } = await import("@/lib/rosterImport");
  const { ShiftDB } = await import("@/db/schema");
  const { applyRosterImport, ensureInitialized, newShift } = await import("@/db/repo");
  const { buildBlock: bb } = await import("@/lib/shifts");
  const { MAIN_JOB_ID } = await import("@/lib/jobs");
  const rows = parseRoster(ocr([
    line("lun 17", 10, 0), line("08:00 - 12:30", 600, 0),
    line("mar 18", 10, 50), line("Libre", 600, 50),
    line("mié 19", 10, 100), line("20:30 - 01:00", 600, 100),
  ]), { reference: "2026-11-17" }).rows;
  const editable = rowsToEditable(rows);
  const dayOff = rows.filter((r) => r.dayOff && r.date).map((r) => r.date!);

  it("primera importación: todo nuevo, el nocturno acaba al día siguiente", async () => {
    const db = new ShiftDB(`imp-${Date.now()}-1`);
    await ensureInitialized(db);
    const plan = planImport(editable, dayOff, [], MAIN_JOB_ID);
    expect(plan.items.map((i) => [i.date, i.status, i.action])).toEqual([["2026-11-17", "new", "add"], ["2026-11-19", "new", "add"]]);
    const res = await applyRosterImport({ jobId: MAIN_JOB_ID, create: plan.items.map((i) => ({ date: i.date, block: bb({ date: i.date, start: i.start, end: i.end, breaks: [] }) })), removeIds: [], allowOverlaps: false }, db);
    expect(res.created).toHaveLength(2);
    const night = (await db.shifts.toArray()).find((s) => s.date === "2026-11-19")!;
    expect(night.planned.end).toBe("2026-11-20T01:00");
    expect(night.tags).toContain("cuadrante");
  });

  it("importar dos veces el mismo cuadrante no duplica", async () => {
    const db = new ShiftDB(`imp-${Date.now()}-2`);
    await ensureInitialized(db);
    const create = editable.map((r) => ({ date: r.date, block: bb({ date: r.date, start: r.start, end: r.end, breaks: [] }) }));
    await applyRosterImport({ jobId: MAIN_JOB_ID, create, removeIds: [], allowOverlaps: false }, db);
    const plan = planImport(editable, dayOff, await db.shifts.toArray(), MAIN_JOB_ID);
    expect(plan.items.every((i) => i.status === "exists" && i.action === "skip")).toBe(true);
    const again = await applyRosterImport({ jobId: MAIN_JOB_ID, create, removeIds: [], allowOverlaps: false }, db);
    expect(again.created).toHaveLength(0);
    expect(again.skippedDuplicates).toHaveLength(2);
    expect(await db.shifts.count()).toBe(2);
  });

  it("cuadrante actualizado: detecta cambios y días que pasan a libres sin borrar nada por defecto", async () => {
    const existing = [
      newShift(MAIN_JOB_ID, "2026-11-17", bb({ date: "2026-11-17", start: "09:00", end: "13:00", breaks: [] })),
      newShift(MAIN_JOB_ID, "2026-11-18", bb({ date: "2026-11-18", start: "10:00", end: "14:00", breaks: [] })),
      { ...newShift(MAIN_JOB_ID, "2026-11-19", bb({ date: "2026-11-19", start: "16:00", end: "20:00", breaks: [] })), status: "done" as const },
      newShift("otro-trabajo", "2026-11-17", bb({ date: "2026-11-17", start: "08:00", end: "12:30", breaks: [] })),
    ];
    const plan = planImport(editable, dayOff, existing, MAIN_JOB_ID);
    const byDate = Object.fromEntries(plan.items.map((i) => [i.date, i]));
    expect(byDate["2026-11-17"]).toMatchObject({ status: "changed", action: "skip", existing: [{ start: "09:00", end: "13:00" }] });
    expect(byDate["2026-11-19"]).toMatchObject({ status: "done", action: "skip" }); // nunca se sustituye un turno realizado
    expect(plan.freedDays).toEqual([{ date: "2026-11-18", shifts: [{ id: existing[1].id, start: "10:00", end: "14:00" }] }]);

    // el usuario elige sustituir el 17: se borra solo ese turno
    const db = new ShiftDB(`imp-${Date.now()}-3`);
    await ensureInitialized(db);
    await db.shifts.bulkPut(existing);
    const res = await applyRosterImport({ jobId: MAIN_JOB_ID, create: [{ date: "2026-11-17", block: bb({ date: "2026-11-17", start: "08:00", end: "12:30", breaks: [] }) }], removeIds: [existing[0].id, existing[2].id], allowOverlaps: false }, db);
    expect(res.removed).toBe(1); // el realizado no se borra aunque se pida
    const left = await db.shifts.toArray();
    expect(left.map((s) => `${s.jobId === MAIN_JOB_ID ? "A" : "B"} ${s.date} ${timeOfS(s.planned.start)}`).sort()).toEqual(["A 2026-11-17 08:00", "A 2026-11-18 10:00", "A 2026-11-19 16:00", "B 2026-11-17 08:00"]);
    expect((await db.auditLog.toArray()).some((a) => a.reason === "Importación de cuadrante")).toBe(true);
  });

  it("filas ilegibles quedan como no válidas hasta que el usuario las complete", () => {
    const plan = planImport([{ key: "x", date: "", start: "", end: "", issues: ["No se ha reconocido la fecha: indícala"], doubtful: true }], [], [], MAIN_JOB_ID);
    expect(plan.items[0]).toMatchObject({ status: "invalid", action: "skip" });
  });
});

function timeOfS(ldt: string) {
  return ldt.slice(11, 16);
}

describe("formato Orquest (etiqueta negra con día apilado)", async () => {
  const { makeWorker, ocrFile } = await import("../support/nodeOcr");
  const { rowsToEditable } = await import("@/lib/rosterImport");
  const EXPECTED = ["libre", "libre", "19:00-22:30", "19:30-22:30", "19:00-23:30,00:30-03:00", "18:00-23:30,00:30-03:00", "18:00-23:30"];
  const DATES = ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"];
  let w: Awaited<ReturnType<typeof makeWorker>>;
  beforeAll(async () => { w = await makeWorker(); }, 60_000);
  afterAll(async () => { await w?.terminate(); });
  const got = (rows: ReturnType<typeof parseRoster>["rows"]) => rows.map((r) => (r.dayOff ? "libre" : r.shifts.map((s) => `${s.start}-${s.end}`).join(",")));

  it("captura de escritorio (1x): todo correcto y sin avisos", async () => {
    const r = parseRoster(await ocrFile(w, fixture("orquest-1x.png")), { reference: "2026-11-18" });
    expect(r.rows.map((x) => x.date)).toEqual(DATES);
    expect(got(r.rows)).toEqual(EXPECTED);
    expect(r.rows.flatMap((x) => x.issues)).toEqual([]);
    // el tramo "0:30 - 3:00" es de madrugada: se guarda en el día siguiente
    const ed = rowsToEditable(r.rows).map((e) => `${e.date} ${e.start}-${e.end}`);
    expect(ed).toEqual(["2026-11-25 19:00-22:30", "2026-11-26 19:30-22:30", "2026-11-27 19:00-23:30", "2026-11-28 00:30-03:00", "2026-11-28 18:00-23:30", "2026-11-29 00:30-03:00", "2026-11-29 18:00-23:30"]);
  }, 60_000);

  it("captura de iPhone (3x): fechas correctas y cualquier lectura errónea queda marcada como dudosa", async () => {
    const r = parseRoster(await ocrFile(w, fixture("orquest-3x.png")), { reference: "2026-11-18" });
    expect(r.rows.map((x) => x.date)).toEqual(DATES);
    got(r.rows).forEach((g, i) => {
      if (g !== EXPECTED[i]) expect(r.rows[i].issues.length, `fila ${i}: ${g}`).toBeGreaterThan(0);
    });
  }, 60_000);
});

describe("formato Orquest (datos sintéticos)", () => {
  it("número y día apilados, votación entre pasadas y '/' como separador de turnos", () => {
    const r = parseRoster(ocr([
      line("23", 20, 0), line("Lun", 18, 22), line("Día libre", 120, 6),
      line("24", 20, 80), line("Mar", 18, 102), line("19:00 - 23:30 / 0:30 - 3:00", 120, 86),
      // otra pasada lee mal la misma fila con menos confianza
      line("19:00 - 23:30 / 0:30 - 3:00", 120, 88, 90), line("12:00 - 23:30", 120, 87, 40),
      line("25", 20, 160), line("Mié", 18, 182), line("23:30 / 0:30", 120, 166),
    ]), { reference: "2026-11-18" });
    expect(r.rows.map((x) => [x.date, x.dayOff, x.shifts.map((s) => `${s.start}-${s.end}${s.nextDay ? "+1" : ""}`).join(",")])).toEqual([
      ["2026-11-23", true, ""],
      ["2026-11-24", false, "19:00-23:30,00:30-03:00+1"],
      ["2026-11-25", false, ""],
    ]);
    // "23:30 / 0:30" no es un horario: se informa para revisar
    expect(r.rows[2].issues.join(" ")).toMatch(/Horas sueltas sin horario completo/);
  });
  it("un número mal leído que no cuadra con la secuencia se deduce de los vecinos y se marca", () => {
    const r = parseRoster(ocr([
      line("23", 20, 0), line("Lun", 18, 22), line("08:00 - 12:00", 120, 6),
      line("5", 20, 80), line("Mar", 18, 102), line("08:00 - 12:00", 120, 86),
      line("25", 20, 160), line("Mié", 18, 182), line("08:00 - 12:00", 120, 166),
    ]), { reference: "2026-11-18" });
    expect(r.rows.map((x) => x.date)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25"]);
    expect(r.rows[1].issues.join(" ")).toMatch(/no cuadra/);
  });
});
