import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function resolveSafe(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  const relative = decoded === "/" ? "app/index.html" : decoded.replace(/^\/+/, "");
  const base = path.resolve(root);
  const full = path.resolve(base, relative);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function createServer({ root = process.cwd() } = {}) {
  return http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url.split("?")[0] === "/api/overrides") {
      try {
        const parsed = JSON.parse(await readBody(req));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          res.writeHead(400, { "content-type": TYPES[".json"] });
          res.end(JSON.stringify({ error: "overrides must be a JSON object keyed by question id" }));
          return;
        }
        const file = path.join(path.resolve(root), "data", "overrides.json");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
        res.writeHead(200, { "content-type": TYPES[".json"] });
        res.end(JSON.stringify({ ok: true, count: Object.keys(parsed).length }));
      } catch {
        res.writeHead(400, { "content-type": TYPES[".json"] });
        res.end(JSON.stringify({ error: "invalid JSON body" }));
      }
      return;
    }

    const file = resolveSafe(root, req.url);
    if (!file) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "cache-control": "no-cache",
      });
      res.end(body);
    });
  });
}

if (import.meta.filename === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8123);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`SAT practice app: http://127.0.0.1:${port}`);
  });
}
