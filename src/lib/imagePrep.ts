/**
 * Preprocesado de imágenes para el OCR (funciones puras, sin dependencias del navegador,
 * para poder probarlas igual que se ejecutan en la app).
 *
 *  1. Escala de grises.
 *  2. Polaridad local: las zonas oscuras compactas (etiquetas negras con texto blanco, como la
 *     del día en Orquest, o un fondo de modo oscuro) se invierten para que todo el texto quede
 *     oscuro sobre claro, que es lo que mejor lee Tesseract.
 *  3. Escala según el tamaño real de la letra (no según el ancho de la imagen): ampliar de más
 *     empeora la lectura de fuentes redondeadas.
 *  4. Estiramiento de contraste.
 */

export interface GrayImage { width: number; height: number; data: Uint8ClampedArray }

export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return { width, height, data };
}

interface Component { x0: number; y0: number; x1: number; y1: number; n: number }

/** Componentes conexas (4-vecindad) de los píxeles que cumplen `pred`. */
function components(img: GrayImage, pred: (v: number) => boolean): Component[] {
  const { width: w, height: h, data } = img;
  const seen = new Uint8Array(w * h);
  const out: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !pred(data[start])) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    const c: Component = { x0: w, y0: h, x1: 0, y1: 0, n: 0 };
    while (sp > 0) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      c.n++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      if (x > 0 && !seen[p - 1] && pred(data[p - 1])) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && pred(data[p + 1])) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && !seen[p - w] && pred(data[p - w])) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && !seen[p + w] && pred(data[p + w])) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    out.push(c);
  }
  return out;
}

export interface Region { x0: number; y0: number; x1: number; y1: number }

/** Invierte las zonas oscuras rellenas (fondos de etiquetas o de modo oscuro). Devuelve esas zonas. */
export function normalizePolarity(img: GrayImage, darkThreshold = 90): Region[] {
  const { width: w } = img;
  const minSide = Math.max(12, Math.round(Math.min(img.width, img.height) * 0.015));
  const inverted: Region[] = [];
  for (const c of components(img, (v) => v < darkThreshold)) {
    const bw = c.x1 - c.x0 + 1;
    const bh = c.y1 - c.y0 + 1;
    const fill = c.n / (bw * bh);
    // una letra es fina (relleno bajo); un fondo es compacto y tiene huecos solo donde está el texto
    if (bw >= minSide && bh >= minSide && fill >= 0.6) {
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) img.data[y * w + x] = 255 - img.data[y * w + x];
      inverted.push({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 });
    }
  }
  return inverted;
}

/** Altura mediana de las letras (componentes oscuras finas), en píxeles. */
export function medianCharHeight(img: GrayImage): number | null {
  const hs = components(img, (v) => v < 128)
    .map((c) => ({ bw: c.x1 - c.x0 + 1, bh: c.y1 - c.y0 + 1, n: c.n }))
    .filter((c) => c.bh >= 4 && c.bh <= img.height / 4 && c.bw <= c.bh * 3 && c.n / (c.bw * c.bh) < 0.85 && c.n >= 6)
    .map((c) => c.bh)
    .sort((a, b) => a - b);
  return hs.length >= 5 ? hs[Math.floor(hs.length / 2)] : null;
}

const cubic = (t: number) => {
  // Catmull-Rom
  const a = Math.abs(t);
  if (a <= 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
};

/** Redimensionado bicúbico en escala de grises (mejor nitidez del texto que el bilineal). */
export function resizeGray(img: GrayImage, scale: number): GrayImage {
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const out = new Uint8ClampedArray(w * h);
  const sw = img.width;
  const sh = img.height;
  const src = img.data;
  // al reducir, se amplía el núcleo para promediar (evita perder trazos finos)
  const support = scale < 1 ? 1 / scale : 1;
  for (let y = 0; y < h; y++) {
    const sy = (y + 0.5) / scale - 0.5;
    const yBase = Math.floor(sy);
    for (let x = 0; x < w; x++) {
      const sx = (x + 0.5) / scale - 0.5;
      const xBase = Math.floor(sx);
      let acc = 0;
      let wsum = 0;
      const r = Math.ceil(2 * support);
      for (let j = -r + 1; j <= r; j++) {
        const yy = Math.min(sh - 1, Math.max(0, yBase + j));
        const wy = cubic((sy - (yBase + j)) / support);
        if (wy === 0) continue;
        for (let i = -r + 1; i <= r; i++) {
          const wx = cubic((sx - (xBase + i)) / support);
          if (wx === 0) continue;
          const xx = Math.min(sw - 1, Math.max(0, xBase + i));
          acc += src[yy * sw + xx] * wx * wy;
          wsum += wx * wy;
        }
      }
      out[y * w + x] = wsum ? acc / wsum : 0;
    }
  }
  return { width: w, height: h, data: out };
}

/** Recorte (con margen claro) de una zona de la imagen. */
export function cropGray(img: GrayImage, r: Region, pad: number): GrayImage {
  const w = r.x1 - r.x0 + 1 + pad * 2;
  const h = r.y1 - r.y0 + 1 + pad * 2;
  const data = new Uint8ClampedArray(w * h).fill(255);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) data[(y - r.y0 + pad) * w + (x - r.x0 + pad)] = img.data[y * img.width + x];
  return { width: w, height: h, data };
}

export function stretchContrast(img: GrayImage) {
  let min = 255;
  let max = 0;
  for (const v of img.data) { if (v < min) min = v; if (v > max) max = v; }
  const range = Math.max(1, max - min);
  for (let i = 0; i < img.data.length; i++) img.data[i] = ((img.data[i] - min) * 255) / range;
}

/** Altura de letra objetivo para Tesseract (px). */
export const TARGET_CHAR_HEIGHT = 20;

export function prepareForOcr(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, targetCharHeight = TARGET_CHAR_HEIGHT): GrayImage & { scale: number; inverted: number; regions: Region[] } {
  const gray = toGray(rgba, width, height);
  const inverted = normalizePolarity(gray);
  const ch = medianCharHeight(gray);
  let scale = ch ? targetCharHeight / ch : 1;
  scale = Math.min(3, Math.max(0.5, scale));
  // límite de tamaño para no agotar memoria en el móvil
  const maxSide = 4000;
  scale = Math.min(scale, maxSide / Math.max(width, height));
  const out = Math.abs(scale - 1) < 0.05 ? gray : resizeGray(gray, scale);
  stretchContrast(out);
  // zonas invertidas pequeñas (etiquetas): se leerán también por separado
  const regions = inverted
    .filter((r) => (r.x1 - r.x0) < width * 0.5 && (r.y1 - r.y0) < height * 0.3)
    .map((r) => ({ x0: Math.floor(r.x0 * scale), y0: Math.floor(r.y0 * scale), x1: Math.min(out.width - 1, Math.ceil(r.x1 * scale)), y1: Math.min(out.height - 1, Math.ceil(r.y1 * scale)) }));
  return { ...out, scale, inverted: inverted.length, regions };
}
