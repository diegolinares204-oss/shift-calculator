/** Ejecuta en Node la misma cadena de OCR que la app (preprocesado + pasadas), para las pruebas. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { createWorker, type Worker } from "tesseract.js";
import { prepareForOcr, type GrayImage } from "@/lib/imagePrep";
import { runOcrPasses, type TessData } from "@/lib/ocr";

export async function makeWorker(): Promise<Worker> {
  const root = path.join(__dirname, "../..");
  return createWorker("spa", 1, { langPath: path.join(root, "node_modules/@tesseract.js-data/spa/4.0.0_best_int"), cachePath: path.join(root, "node_modules/.cache/tesseract"), gzip: true });
}

function grayToPng(img: GrayImage): Buffer {
  const out = new PNG({ width: img.width, height: img.height });
  for (let i = 0; i < img.data.length; i++) {
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = img.data[i];
    out.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(out);
}

export async function ocrFile(worker: Worker, file: string) {
  const png = PNG.sync.read(readFileSync(file));
  const prepared = prepareForOcr(png.data, png.width, png.height, process.env.TCH ? Number(process.env.TCH) : undefined);
  return runOcrPasses(prepared, async (img, psm) => {
    await worker.setParameters({ tessedit_pageseg_mode: psm as never });
    const { data } = await worker.recognize(grayToPng(img), {}, { blocks: true });
    return data as unknown as TessData;
  });
}
