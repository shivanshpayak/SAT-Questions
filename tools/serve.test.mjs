import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSafe, parseRange, createServer } from "./serve.mjs";

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sat-serve-"));
  fs.mkdirSync(path.join(root, "app"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "app", "index.html"), "<h1>SAT</h1>");
  fs.writeFileSync(path.join(root, "data", "math.json"), '{"questions":[]}');
  return root;
}

async function withServer(root, fn) {
  const server = createServer({ root });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("resolveSafe refuses paths that escape the root", () => {
  const root = path.resolve("/srv/app");
  assert.equal(resolveSafe(root, "/../secrets.txt"), null);
  assert.equal(resolveSafe(root, "/..%2fsecrets.txt"), null);
  assert.equal(resolveSafe(root, "/data/../../secrets.txt"), null);
  assert.equal(resolveSafe(root, "/data/math.json"), path.join(root, "data", "math.json"));
});

test("resolveSafe maps the bare root to the app shell", () => {
  const root = path.resolve("/srv/app");
  assert.equal(resolveSafe(root, "/"), path.join(root, "app", "index.html"));
  assert.equal(resolveSafe(root, "/?mode=timed"), path.join(root, "app", "index.html"));
});

test("serves the shell, data files, and 404s for the missing", async () => {
  const root = tempRoot();
  await withServer(root, async (base) => {
    const home = await fetch(base + "/");
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type"), /text\/html/);
    assert.match(await home.text(), /SAT/);

    const data = await fetch(base + "/data/math.json");
    assert.equal(data.status, 200);
    assert.match(data.headers.get("content-type"), /application\/json/);
    assert.deepEqual(await data.json(), { questions: [] });

    assert.equal((await fetch(base + "/data/nope.json")).status, 404);
  });
});

test("POST /api/overrides writes the corrections file", async () => {
  const root = tempRoot();
  await withServer(root, async (base) => {
    const res = await fetch(base + "/api/overrides", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ abc123: { correct: "C" } }),
    });
    assert.equal(res.status, 200);
    const written = JSON.parse(fs.readFileSync(path.join(root, "data", "overrides.json"), "utf8"));
    assert.deepEqual(written, { abc123: { correct: "C" } });
  });
});

test("POST /api/overrides rejects a non-object body", async () => {
  const root = tempRoot();
  await withServer(root, async (base) => {
    const res = await fetch(base + "/api/overrides", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[1,2,3]",
    });
    assert.equal(res.status, 400);
    assert.equal(fs.existsSync(path.join(root, "data", "overrides.json")), false);
  });
});

test("parseRange reads the single-range forms a PDF viewer sends", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=500-", 1000), { start: 500, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=0-4000", 1000), { start: 0, end: 999 }, "clamps past the end");
});

test("parseRange separates 'no range' from 'impossible range'", () => {
  // undefined means send the whole file; null means 416.
  assert.equal(parseRange(undefined, 1000), undefined);
  assert.equal(parseRange("bytes=cheese", 1000), undefined);
  assert.equal(parseRange("bytes=1000-1200", 1000), null);
  assert.equal(parseRange("bytes=800-700", 1000), null);
});

function withPdf(root, name = "Math SAT Questions.pdf") {
  const body = Buffer.from(`%PDF-1.7\n${"x".repeat(2000)}`);
  fs.writeFileSync(path.join(root, name), body);
  return { body, url: "/" + encodeURIComponent(name) };
}

test("serves a PDF as a PDF, so the browser views it instead of downloading it", async () => {
  const root = tempRoot();
  const { body, url } = withPdf(root);
  await withServer(root, async (base) => {
    const res = await fetch(base + url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /application\/pdf/);
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal((await res.arrayBuffer()).byteLength, body.length);
  });
});

test("answers a byte range so a viewer can seek to one page", async () => {
  const root = tempRoot();
  const { body, url } = withPdf(root);
  await withServer(root, async (base) => {
    const res = await fetch(base + url, { headers: { range: "bytes=9-19" } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes 9-19/${body.length}`);
    assert.equal(await res.text(), body.subarray(9, 20).toString());

    const bad = await fetch(base + url, { headers: { range: `bytes=${body.length}-` } });
    assert.equal(bad.status, 416);
    assert.equal(bad.headers.get("content-range"), `bytes */${body.length}`);
  });
});

test("revalidates with an ETag instead of resending the file", async () => {
  const root = tempRoot();
  const { url } = withPdf(root);
  await withServer(root, async (base) => {
    const first = await fetch(base + url);
    const etag = first.headers.get("etag");
    assert.ok(etag, "a cacheable response needs an ETag");
    await first.arrayBuffer();

    const again = await fetch(base + url, { headers: { "if-none-match": etag } });
    assert.equal(again.status, 304);
    assert.equal((await again.arrayBuffer()).byteLength, 0);
  });
});

test("a directory is not a file", async () => {
  const root = tempRoot();
  await withServer(root, async (base) => {
    assert.equal((await fetch(base + "/data")).status, 404);
  });
});
