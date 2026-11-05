// Servidor estático mínimo para probar el build (out/) en local: npm start
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = "out";
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    p = normalize(p).replace(/^(\.\.[/\\])+/, "");
    let file = join(ROOT, p);
    const s = await stat(file).catch(() => null);
    if (s?.isDirectory()) file = join(file, "index.html");
    else if (!s && !extname(file)) {
      res.writeHead(308, { Location: p + "/" });
      return res.end();
    }
    const body = await readFile(file).catch(() => null);
    if (!body) {
      res.writeHead(404, { "Content-Type": TYPES[".html"] });
      return res.end(await readFile(join(ROOT, "404.html")).catch(() => "No encontrado"));
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith("sw.js") ? "no-cache" : "public, max-age=0" });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end();
  }
}).listen(PORT, () => console.log(`SHIFT CALCULATOR en http://localhost:${PORT}`));
