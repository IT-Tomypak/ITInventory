// tools/serve-out.mjs — serves the built `out/` the way Apache does, so the
// check scripts test what production serves, not what `next dev` serves.
// Mirrors Apache's trailing-slash resolution: /help -> 301 /help/ (dropping
// nothing but proving links include the slash), /help/ -> /help/index.html.
//   node tools/serve-out.mjs        (PORT=4321 by default)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("out");
const PORT = Number(process.env.PORT || 4321);
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain", ".woff2": "font/woff2",
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      res.writeHead(301, { Location: url.pathname + "/" + url.search }).end();
      return;
    }
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) {
    res.writeHead(404, { "Content-Type": TYPES[".html"] });
    fs.createReadStream(path.join(ROOT, "404.html")).on("error", () => res.end("Not found")).pipe(res);
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`serving out/ on http://localhost:${PORT}`));
