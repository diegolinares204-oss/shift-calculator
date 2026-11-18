/**
 * Reconocimiento de texto (OCR) 100 % local con Tesseract.js (Apache-2.0).
 * El motor, el modelo de español y el worker se sirven desde /ocr (copiados en el build):
 * la imagen nunca sale del dispositivo y no se contacta con ningún servidor externo.
 */
import type { OcrLine, OcrResult } from "./roster";
import { cropGray, prepareForOcr, type GrayImage, type Region } from "./imagePrep";

type Bbox = { x0: number; y0: number; x1: number; y1: number };
interface TessWord { text: string; confidence: number; bbox: Bbox }
interface TessLine { text: string; confidence: number; bbox: Bbox; words: TessWord[] }
export interface TessData { blocks: { paragraphs: { lines: TessLine[] }[] }[] | null }

/** Convierte la salida de Tesseract (bloques → párrafos → líneas → palabras) al formato del analizador. */
export function tesseractToOcr(data: TessData, width: number, height: number): OcrResult {
  const lines: OcrLine[] = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).map((l) => ({
    text: l.text.trim(),
    confidence: l.confidence,
    bbox: l.bbox,
    words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
  })).filter((l) => l.text.length > 0);
  return { lines, width, height };
}

export const OCR_PATHS = {
  workerPath: "/ocr/worker.min.js",
  corePath: "/ocr/core",
  langPath: "/ocr/lang",
};

export type RecognizeFn = (img: GrayImage, psm: "6" | "11") => Promise<TessData>;

/**
 * Lectura en varias pasadas sobre la imagen preparada:
 *  - página completa en modo bloque (PSM 6) y en modo texto disperso (PSM 11);
 *  - cada etiqueta oscura invertida (p. ej. el día en Orquest) por separado, ampliada y con margen.
 * Las líneas se devuelven juntas con sus posiciones en la imagen preparada; el analizador
 * elimina las lecturas repetidas y se queda con la más fiable.
 */
export async function runOcrPasses(img: GrayImage & { regions: Region[] }, recognize: RecognizeFn): Promise<OcrResult> {
  const lines: OcrLine[] = [];
  for (const psm of ["6", "11"] as const) lines.push(...tesseractToOcr(await recognize(img, psm), img.width, img.height).lines);
  // franja horizontal de cada etiqueta (una fila de cuadrante): la lectura de la fila completa es la más fiable
  for (const r of img.regions.slice(0, 40)) {
    const h = r.y1 - r.y0;
    const band = { x0: 0, x1: img.width - 1, y0: Math.max(0, Math.round(r.y0 - h * 0.35)), y1: Math.min(img.height - 1, Math.round(r.y1 + h * 0.35)) };
    const pad = Math.round(h * 0.3);
    const crop = cropGray(img, band, pad);
    const res = tesseractToOcr(await recognize(crop, "6"), crop.width, crop.height);
    const dx = band.x0 - pad;
    const dy = band.y0 - pad;
    const shift = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
    for (const l of res.lines) lines.push({ ...l, bbox: shift(l.bbox), words: l.words.map((w) => ({ ...w, bbox: shift(w.bbox) })) });
  }
  for (const r of img.regions.slice(0, 60)) {
    const pad = Math.round(Math.max(r.x1 - r.x0, r.y1 - r.y0) * 0.3);
    const crop = cropGray(img, r, pad);
    const res = tesseractToOcr(await recognize(crop, "6"), crop.width, crop.height);
    const dx = r.x0 - pad;
    const dy = r.y0 - pad;
    const shift = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
    for (const l of res.lines) lines.push({ ...l, bbox: shift(l.bbox), words: l.words.map((w) => ({ ...w, bbox: shift(w.bbox) })) });
  }
  return { lines, width: img.width, height: img.height };
}

/** Píxeles RGBA de un archivo de imagen (navegador). */
async function readPixels(file: Blob): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data: d.data, width: d.width, height: d.height };
}

function grayToCanvas(img: GrayImage): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  const out = ctx.createImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = img.data[i];
    out.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

export interface OcrProgress { status: string; progress: number }

/** Reconoce el texto de una imagen en el propio dispositivo. */
export async function recognizeImage(file: Blob, onProgress?: (p: OcrProgress) => void): Promise<OcrResult> {
  const px = await readPixels(file);
  const prepared = prepareForOcr(px.data, px.width, px.height);
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("spa", 1, {
    ...OCR_PATHS,
    workerBlobURL: false,
    gzip: true,
    logger: (m: { status: string; progress: number }) => onProgress?.({ status: m.status, progress: m.progress }),
  });
  try {
    return await runOcrPasses(prepared, async (img, psm) => {
      await worker.setParameters({ tessedit_pageseg_mode: psm as never });
      const { data } = await worker.recognize(grayToCanvas(img), {}, { blocks: true });
      return data as unknown as TessData;
    });
  } finally {
    await worker.terminate();
  }
}
