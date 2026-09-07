import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveSafe, createServer } from "./serve.mjs";

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
