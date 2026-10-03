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
  // Without this the fallback is octet-stream, which makes the browser download
  // the source PDF rather than open it at the #page= a question links to.
  ".pdf": "application/pdf",
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;

export function resolveSafe(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null; // malformed percent-encoding
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const base = path.resolve(root);
  const full = path.resolve(base, relative);
  if (full !== base && !full.startsWith(base + path.sep)) return null;
  return full;
}

// Returns the requested slice, `undefined` for "send the whole file", or `null`
// for a range that cannot be satisfied. Only the single-range forms are handled,
// which is all a PDF viewer seeking to one page of a 61 MB file ever sends.
export function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header ?? "").trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return undefined;

  const start = rawStart === "" ? Math.max(0, size - Number(rawEnd)) : Number(rawStart);
  const end = rawStart === "" || rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start > end || start >= size) return null;
  return { start, end };
}

function sendFile(file, req, res) {
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }

    // no-cache still revalidates every request, so edits show up immediately;
    // the ETag just turns that revalidation into a 304 instead of a resend.
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
      "content-type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": "no-cache",
      "accept-ranges": "bytes",
      "last-modified": stat.mtime.toUTCString(),
      etag,
    };

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const range = parseRange(req.headers.range, stat.size);
    if (range === null) {
      res.writeHead(416, { ...headers, "content-range": `bytes */${stat.size}` });
      res.end();
      return;
    }

    if (range) {
      res.writeHead(206, {
        ...headers,
        "content-range": `bytes ${range.start}-${range.end}/${stat.size}`,
        "content-length": range.end - range.start + 1,
      });
    } else {
      res.writeHead(200, { ...headers, "content-length": stat.size });
    }

    const stream = fs.createReadStream(file, range ?? {});
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
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

    sendFile(file, req, res);
  });
}

if (import.meta.filename === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8123);
  createServer().listen(port, "127.0.0.1", () => {
    console.log(`SAT practice app: http://127.0.0.1:${port}`);
  });
}
