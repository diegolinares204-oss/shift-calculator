// Genera out/sw.js con la lista de precaché de todos los archivos del export estático.
// Se ejecuta automáticamente tras `next build` (npm run build).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const OUT = "out";
if (!existsSync(OUT)) {
  console.error("No existe la carpeta out/. Ejecuta primero next build.");
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const hash = createHash("sha256");
const urls = [];
for (const file of walk(OUT).sort()) {
  const rel = "/" + relative(OUT, file).split(sep).join("/");
  if (rel === "/sw.js" || rel.endsWith(".map")) continue;
  hash.update(rel);
  hash.update(readFileSync(file));
  if (rel.endsWith("/index.html")) urls.push(rel.slice(0, -"index.html".length));
  else urls.push(rel);
}
const version = hash.digest("hex").slice(0, 12);

const sw = `/* SHIFT CALCULATOR — service worker generado automáticamente. Versión ${version} */
const VERSION = "${version}";
const CACHE = "shift-calculator-" + VERSION;
const PRECACHE = ${JSON.stringify(urls)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("shift-calculator-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Actualizaciones controladas: la nueva versión espera hasta que el usuario pulsa «Actualizar».
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let path = url.pathname;
    if (req.mode === "navigate" && !path.endsWith("/") && !path.includes(".")) path += "/";
    const hit = (await cache.match(path)) || (await cache.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    try {
      const res = await fetch(req);
      return res;
    } catch (e) {
      if (req.mode === "navigate") return (await cache.match("/")) || Response.error();
      throw e;
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window" }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return self.clients.openWindow("/");
  }));
});
`;
writeFileSync(join(OUT, "sw.js"), sw);
console.log(`sw.js generado: ${urls.length} recursos en precaché (versión ${version})`);
