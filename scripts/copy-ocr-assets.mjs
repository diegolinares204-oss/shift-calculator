// Copia los archivos de OCR (Tesseract.js, Apache-2.0) a public/ocr para servirlos desde la propia app.
// Así el reconocimiento de cuadrantes funciona sin conexión y sin descargar nada de servidores externos.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const out = "public/ocr";
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

const tess = dirname(require.resolve("tesseract.js/package.json"));
const core = dirname(require.resolve("tesseract.js-core/package.json"));
const spa = dirname(require.resolve("@tesseract.js-data/spa/package.json"));

const files = [
  [join(tess, "dist/worker.min.js"), join(out, "worker.min.js")],
  // solo las variantes LSTM (las que usa el motor configurado); el navegador descarga una de ellas
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [join(core, f), join(out, "core", f)]),
  // modelo de español optimizado (best_int, 2 MB)
  [join(spa, "4.0.0_best_int/spa.traineddata.gz"), join(out, "lang/spa.traineddata.gz")],
];
let total = 0;
for (const [from, to] of files) {
  if (!existsSync(from)) {
    console.error(`Falta ${from}. Ejecuta npm install.`);
    process.exit(1);
  }
  copyFileSync(from, to);
  total += statSync(to).size;
}
console.log(`Archivos de OCR copiados a ${out} (${(total / 1024 / 1024).toFixed(1)} MB)`);
