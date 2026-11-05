// Genera los iconos PNG de la PWA a partir del SVG (requiere Playwright/Chromium instalado).
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("public/favicon.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(size, file, { maskable = false } = {}) {
  const inner = maskable ? svg.replace('rx="112"', 'rx="0"') : svg;
  const pad = maskable ? Math.round(size * 0.1) : 0;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${maskable ? "#4f46e5" : "transparent"}"><div style="padding:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px">${inner.replace("<svg ", `<svg width="${size - 2 * pad}" height="${size - 2 * pad}" `)}</div></body></html>`);
  writeFileSync(file, await page.screenshot({ omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } }));
}
await render(192, "public/icons/icon-192.png");
await render(512, "public/icons/icon-512.png");
await render(512, "public/icons/maskable-512.png", { maskable: true });
await render(180, "public/icons/apple-touch-icon.png", { maskable: true });
await browser.close();
console.log("Iconos generados");
