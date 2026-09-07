# SAT Practice App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, offline practice app over the verified dataset: pick a subject, filter by domain and skill, work through randomized questions with clickable choices or a typed answer, and reveal the correct answer with College Board's full rationale.

**Architecture:** A dependency-free Node static server serves the project root so `data/` and `images/` resolve as plain URLs. All logic lives in small pure ESM modules (`answers`, `bank`, `store`, `session`) that import cleanly under `node --test` with no DOM; only `render`, `ui`, and `main` touch the page. Progress lives in `localStorage`; hand corrections live in `data/overrides.json` and are merged over the generated data at load.

**Tech Stack:** Node 24 ESM, `node --test`, browser-native ES modules. No framework, no bundler, no new dependency.

**Spec:** `docs/superpowers/specs/2026-09-06-sat-randomizer-design.md` (Phase B)

## Global Constraints

- Node >= 24. No new dependencies: `mupdf` stays the only entry in `package.json`, and it is used by extraction only — the app must not import it.
- ESM everywhere. App files are `.js` under `app/` and run unchanged in both the browser and `node --test`.
- **Logic modules must never touch `document`, `window`, or `localStorage` directly.** `store.js` receives its storage object as an argument. This is what keeps them testable.
- The app never parses a PDF and never reads `images/` from disk; it references images by URL.
- **Generated data is read-only.** The app writes corrections only to `data/overrides.json` via `POST /api/overrides`.
- Questions with `tier: "flagged"` are excluded from every practice pool. Currently there are none, but the rule holds.
- **No difficulty filter.** All 1,220 questions are `"Hard"`; a control with one value is not built.

### Dataset facts this plan is written against

Verified by `npm run verify` before this plan was written:

| | Reading | Math |
|---|---|---|
| Questions | 610, all `mcq`, `presentation: "text"` | 610 (387 `mcq`, 223 `spr`), `presentation: "image"` |
| Tiers | 610 clean | 572 clean, 38 `fallback` + `selfMarked` |
| Domains | 4 (238 / 158 / 130 / 84) | 4 (198 / 152 / 147 / 113) |
| Skills | 11 | 19 |
| File size | 3.6 MB | 606 KB, plus 3,406 PNGs (104 MB) |

Subject data is fetched only when that subject is chosen, so a Reading session never downloads Math and vice versa.

Free-response answers appear in these real shapes: `"500"`, `"-14"`, `"-.9333, -14/15"`, `".0465, 2/43"`. A comma separates equally acceptable forms.

The 38 `selfMarked` Math questions have **no answer value at all** — the source PDF omits the Correct Answer line and states the answer only inside the rationale. They are shown with an input box, then the rationale, and the user marks themselves right or wrong.

---

### Task 1: Static server and launcher

**Files:**
- Create: `tools/serve.mjs`
- Create: `start.cmd`
- Test: `tools/serve.test.mjs`

**Interfaces:**
- Produces:
  - `resolveSafe(root: string, urlPath: string): string | null` — maps a URL path to an absolute file path, returning `null` for anything escaping `root`.
  - `createServer({root?: string}): http.Server` — static file server plus `POST /api/overrides`.

A server is required because `file://` blocks `fetch`, so the app could not load `data/*.json` by double-clicking the HTML.

- [ ] **Step 1: Write the failing test**

Create `tools/serve.test.mjs`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/serve.test.mjs`
Expected: FAIL — `Cannot find module './serve.mjs'`.

- [ ] **Step 3: Implement `tools/serve.mjs`**

```js
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
      if (size > MAX_BODY_BYTES) { reject(new Error("body too large")); req.destroy(); return; }
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
    if (!file) { res.writeHead(403).end("Forbidden"); return; }

    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404, { "content-type": "text/plain" }).end("Not found"); return; }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/serve.test.mjs`
Expected: PASS, 5/5.

- [ ] **Step 5: Create `start.cmd`**

```bat
@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:8123
node tools/serve.mjs
```

- [ ] **Step 6: Add the serve script**

Modify `package.json` scripts, adding one line:

```json
    "serve": "node tools/serve.mjs",
```

- [ ] **Step 7: Commit**

```bash
git add tools/serve.mjs tools/serve.test.mjs start.cmd package.json
git commit -m "feat: add dependency-free static server and launcher"
```

---

### Task 2: Free-response answer matching

**Files:**
- Create: `app/answers.js`
- Test: `app/answers.test.js`

**Interfaces:**
- Produces:
  - `normalizeAnswer(raw: string): string` — trims, removes all whitespace, converts Unicode minus/dashes to ASCII `-`, drops a leading `+`, lowercases.
  - `parseRational(raw: string): {n: number, d: number} | null` — parses an integer, decimal, or `a/b` into an exact rational.
  - `acceptedAnswers(correctRaw: string): string[]` — splits the stored answer on `,` or ` or ` into equally acceptable forms.
  - `answersEqual(userRaw: string, correctRaw: string): boolean` — true when the user's entry matches any accepted form, by normalized string or exact rational equality.

Also used for multiple choice, where `correctRaw` is a bare letter.

- [ ] **Step 1: Write the failing test**

Create `app/answers.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAnswer, parseRational, acceptedAnswers, answersEqual } from "./answers.js";

test("normalizeAnswer strips spacing and normalises signs", () => {
  assert.equal(normalizeAnswer("  500 "), "500");
  assert.equal(normalizeAnswer("3 / 2"), "3/2");
  assert.equal(normalizeAnswer("− 14"), "-14");   // Unicode minus
  assert.equal(normalizeAnswer("+7"), "7");
  assert.equal(normalizeAnswer("B"), "b");
  assert.equal(normalizeAnswer(null), "");
});

test("parseRational handles integers, decimals and fractions", () => {
  assert.deepEqual(parseRational("6"), { n: 6, d: 1 });
  assert.deepEqual(parseRational("1.50"), { n: 150, d: 100 });
  assert.deepEqual(parseRational("-14/15"), { n: -14, d: 15 });
  assert.deepEqual(parseRational(".5"), { n: 5, d: 10 });
  assert.equal(parseRational("abc"), null);
  assert.equal(parseRational("1/0"), null);
});

test("acceptedAnswers splits the real multi-form answers", () => {
  assert.deepEqual(acceptedAnswers("-.9333, -14/15"), ["-.9333", "-14/15"]);
  assert.deepEqual(acceptedAnswers(".0465, 2/43"), [".0465", "2/43"]);
  assert.deepEqual(acceptedAnswers("500"), ["500"]);
  assert.deepEqual(acceptedAnswers("2 or 3"), ["2", "3"]);
});

test("answersEqual accepts equivalent numeric forms", () => {
  assert.ok(answersEqual("1.5", "3/2"));
  assert.ok(answersEqual("3/2", "1.5"));
  assert.ok(answersEqual(" 1.50 ", "1.5"));
  assert.ok(answersEqual("-14", "−14"));
  assert.ok(!answersEqual("1.6", "3/2"));
});

test("answersEqual accepts any listed form of a real answer", () => {
  assert.ok(answersEqual("-14/15", "-.9333, -14/15"));
  assert.ok(answersEqual("-.9333", "-.9333, -14/15"));
  assert.ok(answersEqual("2/43", ".0465, 2/43"));
  assert.ok(!answersEqual("14/15", "-.9333, -14/15"), "sign matters");
});

test("answersEqual handles multiple-choice letters case-insensitively", () => {
  assert.ok(answersEqual("b", "B"));
  assert.ok(answersEqual("B", "B"));
  assert.ok(!answersEqual("C", "B"));
});

test("an empty entry is never correct", () => {
  assert.ok(!answersEqual("", "500"));
  assert.ok(!answersEqual("   ", "500"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/answers.test.js`
Expected: FAIL — `Cannot find module './answers.js'`.

- [ ] **Step 3: Implement `app/answers.js`**

```js
// Unicode minus, en dash and em dash all appear where a minus sign is meant.
const DASHES = /[−–—]/g;

export function normalizeAnswer(raw) {
  return String(raw ?? "")
    .replace(DASHES, "-")
    .replace(/\s+/g, "")
    .replace(/^\+/, "")
    .toLowerCase();
}

export function parseRational(raw) {
  const text = normalizeAnswer(raw);

  const decimal = /^(-?)(\d*)(?:\.(\d+))?$/.exec(text);
  if (decimal && (decimal[2] || decimal[3])) {
    const sign = decimal[1] === "-" ? -1 : 1;
    const whole = decimal[2] || "0";
    const frac = decimal[3] || "";
    return { n: sign * Number(whole + frac), d: 10 ** frac.length };
  }

  const fraction = /^(-?\d+)\/(\d+)$/.exec(text);
  if (fraction) {
    const d = Number(fraction[2]);
    if (d === 0) return null;
    return { n: Number(fraction[1]), d };
  }

  return null;
}

export function acceptedAnswers(correctRaw) {
  return String(correctRaw ?? "")
    .split(/,|\sor\s/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function answersEqual(userRaw, correctRaw) {
  const user = normalizeAnswer(userRaw);
  if (!user) return false;

  const userRational = parseRational(user);
  for (const variant of acceptedAnswers(correctRaw)) {
    if (normalizeAnswer(variant) === user) return true;
    const variantRational = parseRational(variant);
    // Cross-multiply for exact equality without floating point drift.
    if (userRational && variantRational &&
        userRational.n * variantRational.d === variantRational.n * userRational.d) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/answers.test.js`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add app/answers.js app/answers.test.js
git commit -m "feat: add free-response answer normalization and equivalence"
```

---

### Task 3: Question bank — loading, overrides, facets, filtering

**Files:**
- Create: `app/bank.js`
- Test: `app/bank.test.js`

**Interfaces:**
- Produces:
  - `mergeOverrides(questions: Question[], overrides: object): Question[]` — shallow-merges each override onto the question with that id.
  - `practicePool(questions): Question[]` — everything not `tier: "flagged"`.
  - `facetsOf(questions): {domains: Array<[string, number]>, skills: Array<[string, number]>}` — value/count pairs sorted by count descending.
  - `filterQuestions(questions, {domains?, skills?, ids?}): Question[]` — empty or omitted criteria mean "no restriction".
  - `poolKey({subject, domains, skills, pool}): string` — a stable identity for a filter selection, used to key the saved shuffle queue.

- [ ] **Step 1: Write the failing test**

Create `app/bank.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOverrides, practicePool, facetsOf, filterQuestions, poolKey } from "./bank.js";

const q = (id, over = {}) => ({
  id, subject: "math", domain: "Algebra", skill: "Linear functions",
  difficulty: "Hard", format: "mcq", tier: "clean", correct: "B", ...over,
});

test("mergeOverrides applies corrections and leaves others untouched", () => {
  const merged = mergeOverrides([q("a"), q("b")], { b: { correct: "D", tier: "clean" } });
  assert.equal(merged[0].correct, "B");
  assert.equal(merged[1].correct, "D");
  assert.equal(merged[1].skill, "Linear functions", "override must not drop other fields");
});

test("mergeOverrides ignores ids that are not in the dataset", () => {
  const merged = mergeOverrides([q("a")], { zzz: { correct: "D" } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].correct, "B");
});

test("practicePool excludes flagged questions", () => {
  const pool = practicePool([q("a"), q("b", { tier: "flagged" }), q("c", { tier: "fallback" })]);
  assert.deepEqual(pool.map((x) => x.id), ["a", "c"], "fallback questions stay in the pool");
});

test("facetsOf counts values and sorts by frequency", () => {
  const facets = facetsOf([
    q("a", { domain: "Algebra" }),
    q("b", { domain: "Advanced Math" }),
    q("c", { domain: "Advanced Math" }),
  ]);
  assert.deepEqual(facets.domains, [["Advanced Math", 2], ["Algebra", 1]]);
});

test("filterQuestions treats empty criteria as no restriction", () => {
  const all = [q("a", { domain: "Algebra" }), q("b", { domain: "Advanced Math" })];
  assert.equal(filterQuestions(all, {}).length, 2);
  assert.equal(filterQuestions(all, { domains: [] }).length, 2);
  assert.deepEqual(filterQuestions(all, { domains: ["Algebra"] }).map((x) => x.id), ["a"]);
});

test("filterQuestions combines domain, skill and explicit ids", () => {
  const all = [
    q("a", { domain: "Algebra", skill: "Linear functions" }),
    q("b", { domain: "Algebra", skill: "Nonlinear functions" }),
    q("c", { domain: "Advanced Math", skill: "Linear functions" }),
  ];
  assert.deepEqual(filterQuestions(all, { domains: ["Algebra"], skills: ["Linear functions"] }).map((x) => x.id), ["a"]);
  assert.deepEqual(filterQuestions(all, { ids: ["b", "c"] }).map((x) => x.id), ["b", "c"]);
});

test("poolKey is stable regardless of selection order", () => {
  const a = poolKey({ subject: "math", domains: ["Algebra", "Geometry and Trigonometry"], skills: [], pool: "all" });
  const b = poolKey({ subject: "math", domains: ["Geometry and Trigonometry", "Algebra"], skills: [], pool: "all" });
  assert.equal(a, b);
  assert.notEqual(a, poolKey({ subject: "reading", domains: [], skills: [], pool: "all" }));
  assert.notEqual(a, poolKey({ subject: "math", domains: ["Algebra", "Geometry and Trigonometry"], skills: [], pool: "missed" }));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/bank.test.js`
Expected: FAIL — `Cannot find module './bank.js'`.

- [ ] **Step 3: Implement `app/bank.js`**

```js
export function mergeOverrides(questions, overrides = {}) {
  return questions.map((q) => (overrides[q.id] ? { ...q, ...overrides[q.id] } : q));
}

// Flagged questions are excluded so the user is never scored on a broken
// question. Fallback questions are fine: they are usable, just not auto-graded.
export function practicePool(questions) {
  return questions.filter((q) => q.tier !== "flagged");
}

function countBy(questions, field) {
  const counts = new Map();
  for (const q of questions) {
    const value = q[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function facetsOf(questions) {
  return { domains: countBy(questions, "domain"), skills: countBy(questions, "skill") };
}

export function filterQuestions(questions, { domains = [], skills = [], ids = null } = {}) {
  const idSet = ids ? new Set(ids) : null;
  return questions.filter(
    (q) =>
      (domains.length === 0 || domains.includes(q.domain)) &&
      (skills.length === 0 || skills.includes(q.skill)) &&
      (idSet === null || idSet.has(q.id)),
  );
}

export function poolKey({ subject, domains = [], skills = [], pool = "all" }) {
  const sorted = (list) => [...list].sort().join("|");
  return `${subject}::${pool}::${sorted(domains)}::${sorted(skills)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/bank.test.js`
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add app/bank.js app/bank.test.js
git commit -m "feat: add question bank loading, overrides merge and filtering"
```

---

### Task 4: No-repeat shuffle queue

**Files:**
- Create: `app/queue.js`
- Test: `app/queue.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `mulberry32(seed: number): () => number` — deterministic PRNG in `[0, 1)`.
  - `shuffle(ids: string[], seed: number): string[]` — seeded Fisher-Yates; does not mutate its input.
  - `createQueue(ids: string[], seed: number): {order: string[], idx: number, seed: number, cycle: number}`
  - `currentId(queue): string | null`
  - `advanceQueue(queue): queue` — steps forward; on exhaustion reshuffles with a new seed and increments `cycle`.

Kept separate from `bank.js` because it is stateful sequencing rather than selection, and it is the piece most worth testing exhaustively.

- [ ] **Step 1: Write the failing test**

Create `app/queue.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, shuffle, createQueue, currentId, advanceQueue } from "./queue.js";

const ids = (n) => Array.from({ length: n }, (_, i) => `q${i}`);

test("mulberry32 is deterministic for a seed", () => {
  const a = mulberry32(42), b = mulberry32(42);
  const draw = (rng) => [rng(), rng(), rng()];
  assert.deepEqual(draw(a), draw(b));
  assert.notDeepEqual(draw(mulberry32(1)), draw(mulberry32(2)));
});

test("shuffle keeps every id exactly once and does not mutate the input", () => {
  const source = ids(50);
  const copy = [...source];
  const out = shuffle(source, 7);
  assert.deepEqual(source, copy, "input must not be mutated");
  assert.equal(out.length, 50);
  assert.deepEqual([...out].sort(), [...source].sort());
});

test("shuffle actually reorders and is reproducible", () => {
  assert.deepEqual(shuffle(ids(50), 7), shuffle(ids(50), 7));
  assert.notDeepEqual(shuffle(ids(50), 7), ids(50));
});

test("a full cycle serves every question exactly once", () => {
  let queue = createQueue(ids(20), 3);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    seen.push(currentId(queue));
    queue = advanceQueue(queue);
  }
  assert.equal(new Set(seen).size, 20, "no repeats within a cycle");
  assert.equal(queue.cycle, 1, "cycle advances on exhaustion");
});

test("exhausting the pool reshuffles into a different order", () => {
  const first = createQueue(ids(20), 3);
  let queue = first;
  for (let i = 0; i < 20; i++) queue = advanceQueue(queue);
  assert.equal(queue.idx, 0);
  assert.notEqual(queue.seed, first.seed);
  assert.notDeepEqual(queue.order, first.order);
  assert.deepEqual([...queue.order].sort(), [...first.order].sort());
});

test("currentId returns null for an empty pool and advancing is safe", () => {
  const queue = createQueue([], 1);
  assert.equal(currentId(queue), null);
  assert.equal(currentId(advanceQueue(queue)), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/queue.test.js`
Expected: FAIL — `Cannot find module './queue.js'`.

- [ ] **Step 3: Implement `app/queue.js`**

```js
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(ids, seed) {
  const out = [...ids];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createQueue(ids, seed) {
  return { order: shuffle(ids, seed), idx: 0, seed, cycle: 0 };
}

export function currentId(queue) {
  return queue.order[queue.idx] ?? null;
}

export function advanceQueue(queue) {
  const idx = queue.idx + 1;
  if (idx < queue.order.length) return { ...queue, idx };
  // Pool exhausted: reshuffle so the next pass differs from the last.
  const seed = (queue.seed + 0x9e3779b9) >>> 0;
  return { order: shuffle(queue.order, seed), idx: 0, seed, cycle: queue.cycle + 1 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/queue.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit**

```bash
git add app/queue.js app/queue.test.js
git commit -m "feat: add seeded no-repeat shuffle queue"
```

---

### Task 5: Progress and settings persistence

**Files:**
- Create: `app/store.js`
- Test: `app/store.test.js`

**Interfaces:**
- Produces `createStore(storage): Store`, where `storage` is any object with `getItem`/`setItem`/`removeItem`. The browser passes `localStorage`; tests pass a fake. `Store` has:
  - `getProgress(): {[id]: {attempts, correct, lastAt, lastAnswer}}`
  - `recordAttempt(id, wasCorrect: boolean, answer: string): void`
  - `missedIds(): string[]` — ids whose most recent attempt was wrong
  - `getQueue(key): object | null` / `saveQueue(key, queue): void`
  - `getSettings(): object` / `saveSettings(patch): object`
  - `accuracyBy(questions, field): Array<[string, {seen, correct}]>`
  - `reset(): void`

Every read and write is wrapped: a browser in private mode can throw on access, and the app must still work with progress simply not persisting.

- [ ] **Step 1: Write the failing test**

Create `app/store.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const throwingStorage = {
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
  removeItem() { throw new Error("denied"); },
};

test("records attempts and accumulates counts", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", true, "B");
  store.recordAttempt("a", false, "C");
  const entry = store.getProgress().a;
  assert.equal(entry.attempts, 2);
  assert.equal(entry.correct, 1);
  assert.equal(entry.lastAnswer, "C");
  assert.ok(entry.lastAt > 0);
});

test("missedIds reflects only the most recent attempt", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", false, "B");
  store.recordAttempt("b", true, "A");
  assert.deepEqual(store.missedIds(), ["a"]);

  store.recordAttempt("a", true, "C");     // redeemed
  store.recordAttempt("b", false, "D");    // newly missed
  assert.deepEqual(store.missedIds(), ["b"]);
});

test("queues round-trip per pool key", () => {
  const store = createStore(fakeStorage());
  assert.equal(store.getQueue("math::all"), null);
  store.saveQueue("math::all", { order: ["a", "b"], idx: 1, seed: 5, cycle: 0 });
  assert.deepEqual(store.getQueue("math::all"), { order: ["a", "b"], idx: 1, seed: 5, cycle: 0 });
  assert.equal(store.getQueue("reading::all"), null, "keys are independent");
});

test("settings merge rather than replace", () => {
  const store = createStore(fakeStorage());
  store.saveSettings({ setSize: 20 });
  store.saveSettings({ subject: "math" });
  assert.deepEqual(store.getSettings(), { setSize: 20, subject: "math" });
});

test("accuracyBy groups progress against question metadata", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", true, "B");
  store.recordAttempt("b", false, "C");
  store.recordAttempt("c", true, "A");
  const questions = [
    { id: "a", domain: "Algebra" },
    { id: "b", domain: "Algebra" },
    { id: "c", domain: "Advanced Math" },
    { id: "d", domain: "Algebra" }, // never attempted
  ];
  const rows = Object.fromEntries(store.accuracyBy(questions, "domain"));
  assert.deepEqual(rows["Algebra"], { seen: 2, correct: 1 });
  assert.deepEqual(rows["Advanced Math"], { seen: 1, correct: 1 });
});

test("reset clears progress", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", true, "B");
  store.reset();
  assert.deepEqual(store.getProgress(), {});
});

test("survives a storage that throws on every access", () => {
  const store = createStore(throwingStorage);
  assert.deepEqual(store.getProgress(), {});
  assert.doesNotThrow(() => store.recordAttempt("a", true, "B"));
  assert.deepEqual(store.missedIds(), []);
  assert.equal(store.getQueue("k"), null);
  assert.deepEqual(store.getSettings(), {});
});

test("ignores corrupt stored JSON", () => {
  const store = createStore(fakeStorage({ "sat.progress.v1": "{not json" }));
  assert.deepEqual(store.getProgress(), {});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/store.test.js`
Expected: FAIL — `Cannot find module './store.js'`.

- [ ] **Step 3: Implement `app/store.js`**

```js
const KEY_PROGRESS = "sat.progress.v1";
const KEY_QUEUES = "sat.queues.v1";
const KEY_SETTINGS = "sat.settings.v1";

export function createStore(storage) {
  // A browser in private mode can throw on any storage access, and stored
  // JSON can be corrupt. Neither may break the app; progress just stops
  // persisting.
  const read = (key, fallback) => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  return {
    getProgress() {
      return read(KEY_PROGRESS, {});
    },

    recordAttempt(id, wasCorrect, answer) {
      const progress = read(KEY_PROGRESS, {});
      const entry = progress[id] ?? { attempts: 0, correct: 0, lastAt: 0, lastAnswer: "" };
      progress[id] = {
        attempts: entry.attempts + 1,
        correct: entry.correct + (wasCorrect ? 1 : 0),
        lastAt: Date.now(),
        lastAnswer: String(answer ?? ""),
        lastCorrect: Boolean(wasCorrect),
      };
      write(KEY_PROGRESS, progress);
    },

    missedIds() {
      const progress = read(KEY_PROGRESS, {});
      return Object.entries(progress)
        .filter(([, entry]) => entry.lastCorrect === false)
        .map(([id]) => id);
    },

    getQueue(key) {
      return read(KEY_QUEUES, {})[key] ?? null;
    },

    saveQueue(key, queue) {
      const queues = read(KEY_QUEUES, {});
      queues[key] = queue;
      write(KEY_QUEUES, queues);
    },

    getSettings() {
      return read(KEY_SETTINGS, {});
    },

    saveSettings(patch) {
      const merged = { ...read(KEY_SETTINGS, {}), ...patch };
      write(KEY_SETTINGS, merged);
      return merged;
    },

    accuracyBy(questions, field) {
      const progress = read(KEY_PROGRESS, {});
      const rows = new Map();
      for (const q of questions) {
        const entry = progress[q.id];
        if (!entry) continue;
        const key = q[field];
        const row = rows.get(key) ?? { seen: 0, correct: 0 };
        row.seen += 1;
        if (entry.lastCorrect) row.correct += 1;
        rows.set(key, row);
      }
      return [...rows.entries()].sort((a, b) => b[1].seen - a[1].seen);
    },

    reset() {
      try {
        storage.removeItem(KEY_PROGRESS);
      } catch {
        /* nothing to do */
      }
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/store.test.js`
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add app/store.js app/store.test.js
git commit -m "feat: add progress and settings persistence with graceful degradation"
```

---

### Task 6: Session state and scoring

**Files:**
- Create: `app/session.js`
- Test: `app/session.test.js`

**Interfaces:**
- Consumes: `answersEqual` from `app/answers.js` (Task 2).
- Produces:
  - `startSession({ids, mode, size, limitMs}): Session` — `mode` is `"practice"` or `"timed"`; `size` truncates the id list for a timed set; `limitMs` is an optional countdown.
  - `currentId(session): string | null`
  - `gradeAnswer(question, answer): {correct: boolean|null, selfMarked: boolean}` — `correct` is `null` for a self-marked question, which the user resolves.
  - `submitAnswer(session, {answer, correct}): Session` — records the response.
  - `advance(session): Session`
  - `isComplete(session): boolean`
  - `scoreSession(session): {total, answered, correct, accuracy}`

State transitions return new objects rather than mutating, which is what makes the flow testable without a DOM.

- [ ] **Step 1: Write the failing test**

Create `app/session.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { startSession, currentId, gradeAnswer, submitAnswer, advance, isComplete, scoreSession } from "./session.js";

const ids = ["a", "b", "c", "d", "e"];

test("a practice session runs the whole list", () => {
  const session = startSession({ ids, mode: "practice" });
  assert.equal(session.ids.length, 5);
  assert.equal(currentId(session), "a");
  assert.equal(isComplete(session), false);
});

test("a timed set is truncated to its size", () => {
  const session = startSession({ ids, mode: "timed", size: 3 });
  assert.deepEqual(session.ids, ["a", "b", "c"]);
});

test("a size larger than the pool uses the whole pool", () => {
  assert.deepEqual(startSession({ ids: ["a"], mode: "timed", size: 20 }).ids, ["a"]);
});

test("advancing past the last question completes the session", () => {
  let session = startSession({ ids: ["a", "b"], mode: "practice" });
  session = advance(submitAnswer(session, { answer: "B", correct: true }));
  assert.equal(currentId(session), "b");
  session = advance(submitAnswer(session, { answer: "C", correct: false }));
  assert.equal(isComplete(session), true);
  assert.equal(currentId(session), null);
});

test("scoreSession counts only answered questions", () => {
  let session = startSession({ ids, mode: "timed", size: 3 });
  session = advance(submitAnswer(session, { answer: "B", correct: true }));
  session = advance(submitAnswer(session, { answer: "C", correct: false }));
  const score = scoreSession(session);
  assert.deepEqual(
    { total: score.total, answered: score.answered, correct: score.correct },
    { total: 3, answered: 2, correct: 1 },
  );
  assert.equal(score.accuracy, 0.5);
});

test("accuracy is zero rather than NaN before anything is answered", () => {
  assert.equal(scoreSession(startSession({ ids, mode: "practice" })).accuracy, 0);
});

test("gradeAnswer marks a multiple-choice answer", () => {
  const question = { format: "mcq", correct: "B" };
  assert.deepEqual(gradeAnswer(question, "B"), { correct: true, selfMarked: false });
  assert.deepEqual(gradeAnswer(question, "C"), { correct: false, selfMarked: false });
});

test("gradeAnswer accepts equivalent free-response forms", () => {
  const question = { format: "spr", correct: "-.9333, -14/15" };
  assert.equal(gradeAnswer(question, "-14/15").correct, true);
  assert.equal(gradeAnswer(question, "0").correct, false);
});

test("gradeAnswer defers to the user on a self-marked question", () => {
  const question = { format: "spr", correct: null, selfMarked: true };
  assert.deepEqual(gradeAnswer(question, "1.5"), { correct: null, selfMarked: true });
});

test("re-submitting the same question overwrites rather than duplicates", () => {
  let session = startSession({ ids: ["a"], mode: "practice" });
  session = submitAnswer(session, { answer: "B", correct: false });
  session = submitAnswer(session, { answer: "B", correct: true });
  const score = scoreSession(session);
  assert.equal(score.answered, 1);
  assert.equal(score.correct, 1);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/session.test.js`
Expected: FAIL — `Cannot find module './session.js'`.

- [ ] **Step 3: Implement `app/session.js`**

```js
import { answersEqual } from "./answers.js";

export function startSession({ ids, mode = "practice", size = null, limitMs = null, startedAt = Date.now() }) {
  const list = mode === "timed" && size ? ids.slice(0, size) : [...ids];
  return { ids: list, idx: 0, mode, limitMs, startedAt, responses: {} };
}

export function currentId(session) {
  return session.ids[session.idx] ?? null;
}

export function gradeAnswer(question, answer) {
  // A self-marked question has no stored answer to compare against, so the
  // verdict belongs to the user after they see the rationale.
  if (question.selfMarked || question.correct == null) {
    return { correct: null, selfMarked: true };
  }
  return { correct: answersEqual(answer, question.correct), selfMarked: false };
}

export function submitAnswer(session, { answer, correct }) {
  const id = currentId(session);
  if (id === null) return session;
  return {
    ...session,
    responses: { ...session.responses, [id]: { answer, correct, at: Date.now() } },
  };
}

export function advance(session) {
  return { ...session, idx: Math.min(session.idx + 1, session.ids.length) };
}

export function isComplete(session) {
  return session.idx >= session.ids.length;
}

export function scoreSession(session) {
  const responses = Object.values(session.responses);
  const answered = responses.length;
  const correct = responses.filter((r) => r.correct === true).length;
  return {
    total: session.ids.length,
    answered,
    correct,
    accuracy: answered === 0 ? 0 : correct / answered,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/session.test.js`
Expected: PASS, 10/10.

- [ ] **Step 5: Commit**

```bash
git add app/session.js app/session.test.js
git commit -m "feat: add session state machine, grading and scoring"
```

---

### Task 7: App shell and question rendering

**Files:**
- Create: `app/index.html`
- Create: `app/styles.css`
- Create: `app/render.js`
- Test: `app/render.test.js`

**Interfaces:**
- Consumes: question objects from the dataset.
- Produces:
  - `isImageQuestion(q): boolean`
  - `choiceLetters(q): string[]`
  - `stemHtml(q): string` — the stem as HTML: passage markup for Reading, `<img>` tags for Math (one per page-spanning crop).
  - `choiceHtml(q, label): string` — one choice's inner HTML.
  - `rationaleHtml(q): string`
  - `escapeAttr(value): string`

Rendering is expressed as HTML-producing pure functions so it can be tested under `node --test` without a DOM. `ui.js` (Task 8) does the actual insertion.

- [ ] **Step 1: Write the failing test**

Create `app/render.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isImageQuestion, choiceLetters, stemHtml, choiceHtml, rationaleHtml, escapeAttr } from "./render.js";

const reading = {
  id: "r1", subject: "reading", presentation: "text", format: "mcq",
  stem: { html: "<p>Passage with <u>underline</u> and <em>italics</em>.</p>" },
  choices: [
    { label: "A", html: "<p>A. first</p>" },
    { label: "B", html: "<p>B. second</p>" },
  ],
  rationale: { html: "<p>Because.</p>" },
};

const math = {
  id: "m1", subject: "math", presentation: "image", format: "mcq",
  stem: { images: ["images/math/m1-stem.png", "images/math/m1-stem-1.png"] },
  choices: [{ label: "A", images: ["images/math/m1-choice-A.png"] }],
  rationale: { images: ["images/math/m1-rationale.png"] },
};

test("distinguishes image questions from text questions", () => {
  assert.equal(isImageQuestion(math), true);
  assert.equal(isImageQuestion(reading), false);
});

test("choiceLetters lists the labels in order", () => {
  assert.deepEqual(choiceLetters(reading), ["A", "B"]);
  assert.deepEqual(choiceLetters(math), ["A"]);
  assert.deepEqual(choiceLetters({ choices: [] }), []);
});

test("a Reading stem passes its markup through intact", () => {
  const html = stemHtml(reading);
  assert.ok(html.includes("<u>underline</u>"), "underlines must survive");
  assert.ok(html.includes("<em>italics</em>"), "italics must survive");
});

test("a Math stem becomes one img per crop, in order", () => {
  const html = stemHtml(math);
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ["images/math/m1-stem.png", "images/math/m1-stem-1.png"]);
  assert.ok(html.includes("loading=\"lazy\""), "images must load lazily");
  assert.ok(html.includes("alt="), "images need alt text");
});

test("choiceHtml renders text and image choices", () => {
  assert.ok(choiceHtml(reading, "B").includes("second"));
  assert.ok(choiceHtml(math, "A").includes("images/math/m1-choice-A.png"));
  assert.equal(choiceHtml(reading, "Z"), "");
});

test("rationaleHtml handles both shapes", () => {
  assert.ok(rationaleHtml(reading).includes("Because."));
  assert.ok(rationaleHtml(math).includes("m1-rationale.png"));
  assert.equal(rationaleHtml({ rationale: {} }), "");
});

test("escapeAttr neutralises quotes and angle brackets", () => {
  assert.equal(escapeAttr('a"b<c>&d'), "a&quot;b&lt;c&gt;&amp;d");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/render.test.js`
Expected: FAIL — `Cannot find module './render.js'`.

- [ ] **Step 3: Implement `app/render.js`**

```js
const ATTR = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ATTR[ch]);
}

export function isImageQuestion(q) {
  return q.presentation === "image";
}

export function choiceLetters(q) {
  return (q.choices ?? []).map((c) => c.label);
}

function imagesHtml(paths, alt) {
  return (paths ?? [])
    .map((src) => `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" loading="lazy">`)
    .join("");
}

export function stemHtml(q) {
  // Reading HTML is generated by our own extractor, never user input.
  return isImageQuestion(q) ? imagesHtml(q.stem.images, "Question") : q.stem.html ?? "";
}

export function choiceHtml(q, label) {
  const choice = (q.choices ?? []).find((c) => c.label === label);
  if (!choice) return "";
  return isImageQuestion(q) ? imagesHtml(choice.images, `Choice ${label}`) : choice.html ?? "";
}

export function rationaleHtml(q) {
  const rationale = q.rationale ?? {};
  if (rationale.images) return imagesHtml(rationale.images, "Explanation");
  return rationale.html ?? "";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/render.test.js`
Expected: PASS, 7/7.

- [ ] **Step 5: Create `app/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- Math crops are referenced as relative paths like images/math/x.png.
       This keeps them resolving even if the page is opened at /app/index.html
       rather than /. -->
  <base href="/">
  <title>SAT Practice</title>
  <link rel="stylesheet" href="/app/styles.css">
</head>
<body>
  <header class="bar">
    <button id="nav-home" class="link">SAT Practice</button>
    <span id="bar-status" class="status"></span>
    <span class="grow"></span>
    <span id="bar-timer" class="timer" hidden></span>
    <button id="nav-stats" class="link">Stats</button>
  </header>

  <main>
    <section id="screen-home" class="screen">
      <h1>Practice</h1>
      <div class="row">
        <button class="subject" data-subject="reading">Reading &amp; Writing<small>610 questions</small></button>
        <button class="subject" data-subject="math">Math<small>610 questions</small></button>
      </div>

      <div id="home-filters" hidden>
        <h2>Domains</h2>
        <div id="filter-domains" class="chips"></div>
        <h2>Skills</h2>
        <div id="filter-skills" class="chips"></div>

        <h2>Mode</h2>
        <div class="row">
          <label><input type="radio" name="mode" value="practice" checked> Practice (untimed)</label>
          <label><input type="radio" name="mode" value="timed"> Timed set of
            <input id="set-size" type="number" min="1" max="100" value="20"> questions</label>
        </div>

        <div class="row">
          <label><input type="checkbox" id="only-missed"> Only questions I got wrong</label>
        </div>

        <p id="pool-count" class="muted"></p>
        <button id="start" class="primary">Start</button>
      </div>
    </section>

    <section id="screen-question" class="screen" hidden>
      <div class="meta"><span id="q-domain"></span> &middot; <span id="q-skill"></span> &middot; <span id="q-progress"></span></div>
      <div id="q-stem" class="stem"></div>
      <div id="q-choices" class="choices"></div>
      <div id="q-entry" class="entry" hidden>
        <label for="q-input">Your answer</label>
        <input id="q-input" type="text" autocomplete="off" spellcheck="false">
      </div>
      <div class="row">
        <button id="q-submit" class="primary">Check answer</button>
        <button id="q-skip" class="link">Skip</button>
      </div>
      <div id="q-feedback" class="feedback" hidden></div>
    </section>

    <section id="screen-results" class="screen" hidden>
      <h1>Set complete</h1>
      <p id="results-score" class="score"></p>
      <div id="results-list"></div>
      <button id="results-again" class="primary">Practice again</button>
    </section>

    <section id="screen-stats" class="screen" hidden>
      <h1>Your progress</h1>
      <p id="stats-summary"></p>
      <h2>By domain</h2>
      <div id="stats-domains"></div>
      <h2>By skill</h2>
      <div id="stats-skills"></div>
      <button id="stats-reset" class="danger">Reset all progress</button>
    </section>

    <section id="screen-review" class="screen" hidden>
      <h1>Flagged questions</h1>
      <p id="review-empty" class="muted">No flagged questions. Nothing to fix.</p>
      <div id="review-list"></div>
    </section>
  </main>

  <script type="module" src="/app/main.js"></script>
</body>
</html>
```

- [ ] **Step 6: Create `app/styles.css`**

```css
:root {
  --ink: #1a1a1a; --muted: #666; --line: #ddd; --bg: #fff;
  --accent: #1a4b8c; --good: #0a7d38; --bad: #b3261e; --sel: #eaf1fb;
  color-scheme: light;
}
* { box-sizing: border-box; }
body { margin: 0; font: 16px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--bg); }
main { max-width: 62rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }

.bar { display: flex; align-items: center; gap: 1rem; padding: .6rem 1rem; border-bottom: 1px solid var(--line); }
.grow { flex: 1; }
.status, .timer { color: var(--muted); font-size: .9rem; }
.timer { font-variant-numeric: tabular-nums; }

h1 { font-size: 1.5rem; } h2 { font-size: 1rem; margin: 1.4rem 0 .5rem; color: var(--muted); font-weight: 600; }
.row { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; }
.muted { color: var(--muted); }

button { font: inherit; cursor: pointer; }
.primary { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: .6rem 1.2rem; }
.link { background: none; border: 0; color: var(--accent); padding: .3rem; }
.danger { background: none; border: 1px solid var(--bad); color: var(--bad); border-radius: 6px; padding: .5rem 1rem; }
.subject { flex: 1; min-width: 14rem; text-align: left; padding: 1rem; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.subject small { display: block; color: var(--muted); }
.subject[aria-pressed="true"] { border-color: var(--accent); background: var(--sel); }

.chips { display: flex; flex-wrap: wrap; gap: .5rem; }
.chip { border: 1px solid var(--line); border-radius: 999px; padding: .35rem .8rem; background: #fff; font-size: .9rem; }
.chip[aria-pressed="true"] { border-color: var(--accent); background: var(--sel); color: var(--accent); }

.meta { color: var(--muted); font-size: .85rem; margin-bottom: .75rem; }
.stem { margin-bottom: 1.25rem; }
.stem img, .choice img, .feedback img { max-width: 100%; height: auto; display: block; }

.choices { display: grid; gap: .5rem; margin-bottom: 1rem; }
.choice { display: flex; gap: .75rem; align-items: flex-start; text-align: left; width: 100%;
          border: 1px solid var(--line); border-radius: 8px; padding: .7rem .9rem; background: #fff; }
.choice[aria-pressed="true"] { border-color: var(--accent); background: var(--sel); }
.choice .tag { font-weight: 600; min-width: 1.4rem; }
.choice p { margin: 0; }
.choice.correct { border-color: var(--good); background: #eefaf1; }
.choice.wrong { border-color: var(--bad); background: #fdeeed; }

.entry input { font: inherit; padding: .5rem .7rem; border: 1px solid var(--line); border-radius: 6px; min-width: 12rem; }

.feedback { border-top: 2px solid var(--line); margin-top: 1.25rem; padding-top: 1rem; }
.verdict { font-weight: 600; }
.verdict.correct { color: var(--good); } .verdict.wrong { color: var(--bad); }
.score { font-size: 1.3rem; }
table { border-collapse: collapse; width: 100%; }
td, th { text-align: left; padding: .35rem .5rem; border-bottom: 1px solid var(--line); font-size: .95rem; }
```

- [ ] **Step 7: Commit**

```bash
git add app/index.html app/styles.css app/render.js app/render.test.js
git commit -m "feat: add app shell, styles and question rendering helpers"
```

---

### Task 8: Wiring — load data, filter, answer, reveal

**Files:**
- Create: `app/main.js`
- Create: `app/ui.js`
- Test: `app/ui.test.js`

**Interfaces:**
- Consumes: every module from Tasks 2–7.
- Produces:
  - `loadSubject(subject, fetchJson): Promise<{questions, facets}>` — fetches `data/<subject>.json` and `data/overrides.json`, merges overrides, drops flagged questions, computes facets. A missing overrides file is not an error.
  - `feedbackModel(question, {answer, correct}): {verdict, correctText, rationale, selfMarked}` — everything the feedback panel needs, as data.
  - `showScreen(name): void` — toggles the `hidden` attribute across screens.

`loadSubject` and `feedbackModel` are pure enough to test with an injected fetch; screen wiring is verified by running the app in Task 12.

- [ ] **Step 1: Write the failing test**

Create `app/ui.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSubject, feedbackModel } from "./ui.js";

function fakeFetch(files) {
  return async (path) => {
    if (!(path in files)) throw new Error(`404 ${path}`);
    return files[path];
  };
}

const question = (id, over = {}) => ({
  id, subject: "math", domain: "Algebra", skill: "Linear functions",
  tier: "clean", format: "mcq", correct: "B", ...over,
});

test("loadSubject merges overrides and drops flagged questions", async () => {
  const fetchJson = fakeFetch({
    "/data/math.json": { questions: [question("a"), question("b"), question("c", { tier: "flagged" })] },
    "/data/overrides.json": { b: { correct: "D" } },
  });
  const { questions, facets } = await loadSubject("math", fetchJson);
  assert.deepEqual(questions.map((q) => q.id), ["a", "b"]);
  assert.equal(questions[1].correct, "D");
  assert.deepEqual(facets.domains, [["Algebra", 2]]);
});

test("loadSubject tolerates a missing overrides file", async () => {
  const fetchJson = fakeFetch({ "/data/reading.json": { questions: [question("a", { subject: "reading" })] } });
  const { questions } = await loadSubject("reading", fetchJson);
  assert.equal(questions.length, 1);
});

test("an override can rescue a flagged question into the pool", async () => {
  const fetchJson = fakeFetch({
    "/data/math.json": { questions: [question("a", { tier: "flagged" })] },
    "/data/overrides.json": { a: { tier: "clean", correct: "C" } },
  });
  const { questions } = await loadSubject("math", fetchJson);
  assert.deepEqual(questions.map((q) => q.id), ["a"]);
});

test("feedbackModel reports a correct answer", () => {
  const model = feedbackModel(question("a", { rationale: { html: "<p>why</p>" } }), { answer: "B", correct: true });
  assert.equal(model.verdict, "correct");
  assert.equal(model.correctText, "B");
  assert.ok(model.rationale.includes("why"));
  assert.equal(model.selfMarked, false);
});

test("feedbackModel reports a wrong answer and still shows the right one", () => {
  const model = feedbackModel(question("a", { rationale: { html: "" } }), { answer: "C", correct: false });
  assert.equal(model.verdict, "wrong");
  assert.equal(model.correctText, "B");
});

test("feedbackModel defers the verdict on a self-marked question", () => {
  const q = question("a", { format: "spr", correct: null, selfMarked: true, rationale: { images: ["r.png"] } });
  const model = feedbackModel(q, { answer: "1.5", correct: null });
  assert.equal(model.verdict, "unmarked");
  assert.equal(model.selfMarked, true);
  assert.equal(model.correctText, null);
  assert.ok(model.rationale.includes("r.png"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/ui.test.js`
Expected: FAIL — `Cannot find module './ui.js'`.

- [ ] **Step 3: Implement `app/ui.js`**

```js
import { mergeOverrides, practicePool, facetsOf } from "./bank.js";
import { rationaleHtml } from "./render.js";

export async function loadSubject(subject, fetchJson) {
  const data = await fetchJson(`/data/${subject}.json`);
  let overrides = {};
  try {
    overrides = await fetchJson("/data/overrides.json");
  } catch {
    overrides = {}; // absent until the first correction is saved
  }
  const questions = practicePool(mergeOverrides(data.questions, overrides));
  return { questions, facets: facetsOf(questions) };
}

export function feedbackModel(question, { answer, correct }) {
  const selfMarked = correct === null;
  return {
    verdict: selfMarked ? "unmarked" : correct ? "correct" : "wrong",
    correctText: selfMarked ? null : question.correct,
    rationale: rationaleHtml(question),
    userAnswer: answer,
    selfMarked,
  };
}

export function showScreen(name) {
  for (const section of document.querySelectorAll(".screen")) {
    section.hidden = section.id !== `screen-${name}`;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/ui.test.js`
Expected: PASS, 6/6.

- [ ] **Step 5: Implement `app/main.js`**

```js
import { loadSubject, feedbackModel, showScreen } from "./ui.js";
import { filterQuestions, poolKey } from "./bank.js";
import { createQueue, currentId as queueCurrent, advanceQueue } from "./queue.js";
import { createStore } from "./store.js";
import { startSession, currentId, gradeAnswer, submitAnswer, advance, isComplete, scoreSession } from "./session.js";
import { stemHtml, choiceHtml, choiceLetters, isImageQuestion, escapeAttr } from "./render.js";

const store = createStore(globalThis.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} });
const fetchJson = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
};

const state = {
  subject: null, questions: [], facets: null, byId: new Map(),
  domains: [], skills: [], onlyMissed: false,
  session: null, queue: null, selected: null, answered: false,
};

const el = (id) => document.getElementById(id);

function selectedPool() {
  const ids = state.onlyMissed ? store.missedIds() : null;
  return filterQuestions(state.questions, { domains: state.domains, skills: state.skills, ids });
}

function renderChips(container, entries, selected, onToggle) {
  container.replaceChildren();
  for (const [value, count] of entries) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = `${value} (${count})`;
    chip.setAttribute("aria-pressed", String(selected.includes(value)));
    chip.addEventListener("click", () => onToggle(value));
    container.append(chip);
  }
}

function refreshFilters() {
  renderChips(el("filter-domains"), state.facets.domains, state.domains, (value) => {
    state.domains = state.domains.includes(value)
      ? state.domains.filter((v) => v !== value) : [...state.domains, value];
    refreshFilters();
  });
  renderChips(el("filter-skills"), state.facets.skills, state.skills, (value) => {
    state.skills = state.skills.includes(value)
      ? state.skills.filter((v) => v !== value) : [...state.skills, value];
    refreshFilters();
  });
  const count = selectedPool().length;
  el("pool-count").textContent = `${count} question${count === 1 ? "" : "s"} match`;
  el("start").disabled = count === 0;
}

async function chooseSubject(subject) {
  state.subject = subject;
  state.domains = []; state.skills = []; state.onlyMissed = false;
  const { questions, facets } = await loadSubject(subject, fetchJson);
  state.questions = questions;
  state.facets = facets;
  state.byId = new Map(questions.map((q) => [q.id, q]));
  for (const button of document.querySelectorAll(".subject")) {
    button.setAttribute("aria-pressed", String(button.dataset.subject === subject));
  }
  el("home-filters").hidden = false;
  el("only-missed").checked = false;
  refreshFilters();
}

function startPractice() {
  const pool = selectedPool();
  const key = poolKey({ subject: state.subject, domains: state.domains, skills: state.skills, pool: state.onlyMissed ? "missed" : "all" });
  const saved = store.getQueue(key);
  const poolIds = pool.map((q) => q.id);
  const stale = !saved || saved.order.length !== poolIds.length;
  state.queue = stale ? createQueue(poolIds, Date.now() >>> 0) : saved;
  state.queueKey = key;

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const size = Number(el("set-size").value) || 20;
  const ordered = [];
  let walker = state.queue;
  const wanted = mode === "timed" ? Math.min(size, poolIds.length) : poolIds.length;
  for (let i = 0; i < wanted; i++) { ordered.push(queueCurrent(walker)); walker = advanceQueue(walker); }
  state.queue = walker;
  store.saveQueue(key, walker);

  state.session = startSession({ ids: ordered.filter(Boolean), mode, size: wanted });
  showScreen("question");
  renderCurrent();
}

function renderCurrent() {
  const id = currentId(state.session);
  if (id === null) return finishSession();
  const q = state.byId.get(id);
  state.selected = null;
  state.answered = false;

  el("q-domain").textContent = q.domain ?? "";
  el("q-skill").textContent = q.skill ?? "";
  el("q-progress").textContent = `${state.session.idx + 1} of ${state.session.ids.length}`;
  el("q-stem").innerHTML = stemHtml(q);
  el("q-feedback").hidden = true;
  el("q-submit").textContent = "Check answer";
  el("q-submit").disabled = false;

  const letters = choiceLetters(q);
  const choices = el("q-choices");
  choices.replaceChildren();
  el("q-entry").hidden = letters.length > 0;

  if (letters.length) {
    for (const label of letters) {
      const button = document.createElement("button");
      button.className = "choice";
      button.type = "button";
      button.dataset.label = label;
      button.setAttribute("aria-pressed", "false");
      button.innerHTML = `<span class="tag">${escapeAttr(label)}</span><span class="body">${choiceHtml(q, label)}</span>`;
      button.addEventListener("click", () => {
        if (state.answered) return;
        state.selected = label;
        for (const other of choices.children) other.setAttribute("aria-pressed", String(other === button));
      });
      choices.append(button);
    }
  } else {
    el("q-input").value = "";
    el("q-input").focus();
  }
}

function submit() {
  if (state.answered) { state.session = advance(state.session); return renderCurrent(); }
  const q = state.byId.get(currentId(state.session));
  const letters = choiceLetters(q);
  const answer = letters.length ? state.selected : el("q-input").value;
  if (!answer) return;

  const { correct } = gradeAnswer(q, answer);
  state.session = submitAnswer(state.session, { answer, correct });
  if (correct !== null) store.recordAttempt(q.id, correct, answer);
  state.answered = true;

  if (letters.length) {
    for (const button of el("q-choices").children) {
      const label = button.dataset.label;
      if (label === q.correct) button.classList.add("correct");
      else if (label === answer && correct === false) button.classList.add("wrong");
    }
  }
  showFeedback(q, { answer, correct });
  el("q-submit").textContent = isComplete(advance(state.session)) ? "See results" : "Next question";
}

function showFeedback(q, response) {
  const model = feedbackModel(q, response);
  const panel = el("q-feedback");
  const heading =
    model.verdict === "correct" ? '<p class="verdict correct">Correct</p>'
    : model.verdict === "wrong" ? `<p class="verdict wrong">Not quite &mdash; the answer is ${escapeAttr(model.correctText)}</p>`
    : '<p class="verdict">Check the explanation, then mark yourself</p>';

  const selfMark = model.selfMarked
    ? '<div class="row"><button id="self-right" class="primary">I got it right</button><button id="self-wrong" class="danger">I got it wrong</button></div>'
    : "";

  panel.innerHTML = `${heading}${selfMark}<div class="rationale">${model.rationale}</div>`;
  panel.hidden = false;

  if (model.selfMarked) {
    const mark = (wasCorrect) => {
      store.recordAttempt(q.id, wasCorrect, response.answer);
      state.session = submitAnswer(state.session, { answer: response.answer, correct: wasCorrect });
      el("self-right").disabled = true;
      el("self-wrong").disabled = true;
    };
    el("self-right").addEventListener("click", () => mark(true));
    el("self-wrong").addEventListener("click", () => mark(false));
  }
}

function finishSession() { showScreen("results"); renderResults(); }

function renderResults() {
  const score = scoreSession(state.session);
  el("results-score").textContent =
    `${score.correct} of ${score.answered} correct (${Math.round(score.accuracy * 100)}%)`;
  el("results-list").replaceChildren();
}

function skip() { state.session = advance(state.session); renderCurrent(); }

document.addEventListener("DOMContentLoaded", () => {
  for (const button of document.querySelectorAll(".subject")) {
    button.addEventListener("click", () => chooseSubject(button.dataset.subject));
  }
  el("only-missed").addEventListener("change", (e) => { state.onlyMissed = e.target.checked; refreshFilters(); });
  el("start").addEventListener("click", startPractice);
  el("q-submit").addEventListener("click", submit);
  el("q-skip").addEventListener("click", skip);
  el("results-again").addEventListener("click", () => showScreen("home"));
  el("nav-home").addEventListener("click", () => showScreen("home"));
  el("q-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  showScreen("home");
});
```

- [ ] **Step 6: Run the app and confirm one question end to end**

Run: `npm run serve`, then open `http://127.0.0.1:8123`.

Verify by hand, because no unit test covers the DOM:
1. Choose **Reading** — domain chips appear with counts summing to 610.
2. Press **Start** — a passage renders with any underline visible.
3. Choose a wrong answer, press **Check answer** — the chosen choice turns red, the correct one green, and the rationale appears.
4. Press **Next question** — a different question loads.
5. Choose **Math**, start, and confirm the stem renders as a crisp image and free-response questions show an input box.

- [ ] **Step 7: Commit**

```bash
git add app/main.js app/ui.js app/ui.test.js
git commit -m "feat: wire up subject loading, filtering, answering and feedback"
```

---

### Task 9: Timed sets, results detail and the countdown

**Files:**
- Modify: `app/main.js` (results rendering and timer wiring)
- Create: `app/timer.js`
- Test: `app/timer.test.js`

**Interfaces:**
- Produces:
  - `formatDuration(ms): string` — `"m:ss"`, or `"h:mm:ss"` past an hour.
  - `createTimer({limitMs, onTick, onExpire, now}): {start, stop, elapsed, tick}` — counts up, or down when `limitMs` is set. `tick()` advances one step and returns the displayed value, which is what makes the timer testable against an injected clock instead of real time.

- [ ] **Step 1: Write the failing test**

Create `app/timer.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, createTimer } from "./timer.js";

test("formatDuration renders minutes and seconds", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(9_000), "0:09");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(600_000), "10:00");
});

test("formatDuration switches to hours past sixty minutes", () => {
  assert.equal(formatDuration(3_661_000), "1:01:01");
});

test("formatDuration never renders a negative time", () => {
  assert.equal(formatDuration(-5_000), "0:00");
});

test("a counting-up timer reports elapsed time", () => {
  let clock = 1000;
  const timer = createTimer({ now: () => clock });
  timer.start();
  clock = 4000;
  assert.equal(timer.elapsed(), 3000);
});

test("a countdown timer fires onExpire once past the limit", () => {
  let clock = 0;
  let expired = 0;
  const timer = createTimer({ limitMs: 5000, now: () => clock, onExpire: () => expired++ });
  timer.start();
  clock = 4000;
  assert.equal(timer.tick(), 1000, "remaining time");
  assert.equal(expired, 0);
  clock = 6000;
  assert.equal(timer.tick(), 0);
  clock = 7000;
  timer.tick();
  assert.equal(expired, 1, "expiry fires exactly once");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/timer.test.js`
Expected: FAIL — `Cannot find module './timer.js'`.

- [ ] **Step 3: Implement `app/timer.js`**

```js
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function createTimer({ limitMs = null, onTick = () => {}, onExpire = () => {}, now = Date.now } = {}) {
  let startedAt = null;
  let handle = null;
  let expired = false;

  const elapsed = () => (startedAt === null ? 0 : now() - startedAt);

  const tick = () => {
    const value = limitMs === null ? elapsed() : Math.max(0, limitMs - elapsed());
    onTick(value);
    if (limitMs !== null && value === 0 && !expired) {
      expired = true;
      onExpire();
    }
    return value;
  };

  return {
    start() {
      startedAt = now();
      expired = false;
      if (typeof setInterval === "function") handle = setInterval(tick, 1000);
      tick();
    },
    stop() {
      if (handle !== null) { clearInterval(handle); handle = null; }
    },
    elapsed,
    tick,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/timer.test.js`
Expected: PASS, 5/5.

- [ ] **Step 5: Show the timer and a per-question results breakdown**

In `app/main.js`, add the import:

```js
import { formatDuration, createTimer } from "./timer.js";
```

Replace `renderResults` and add timer control:

```js
function renderResults() {
  const score = scoreSession(state.session);
  const seconds = state.timer ? state.timer.elapsed() : 0;
  el("results-score").textContent =
    `${score.correct} of ${score.answered} correct (${Math.round(score.accuracy * 100)}%) in ${formatDuration(seconds)}`;

  const table = document.createElement("table");
  table.innerHTML = "<tr><th>#</th><th>Skill</th><th>Your answer</th><th>Correct</th></tr>";
  state.session.ids.forEach((id, i) => {
    const q = state.byId.get(id);
    const response = state.session.responses[id];
    const verdict = !response ? "skipped" : response.correct === true ? "right"
      : response.correct === false ? "wrong" : "self-marked";
    const row = document.createElement("tr");
    row.innerHTML = `<td>${i + 1}</td><td>${escapeAttr(q.skill ?? "")}</td>` +
      `<td>${escapeAttr(response?.answer ?? "")}</td>` +
      `<td>${escapeAttr(q.correct ?? "-")} (${verdict})</td>`;
    table.append(row);
  });
  el("results-list").replaceChildren(table);
}
```

In `startPractice`, after building the session, start the timer:

```js
  state.timer?.stop();
  state.timer = createTimer({ onTick: (ms) => { el("bar-timer").textContent = formatDuration(ms); } });
  el("bar-timer").hidden = false;
  state.timer.start();
```

And in `finishSession`, stop it:

```js
function finishSession() {
  state.timer?.stop();
  el("bar-timer").hidden = true;
  showScreen("results");
  renderResults();
}
```

- [ ] **Step 6: Verify a timed set by hand**

Run: `npm run serve`, choose Math, select **Timed set of 5**, and start.
Expected: the header shows a running clock; after the fifth question the results screen shows the score, the elapsed time, and a row per question.

- [ ] **Step 7: Commit**

```bash
git add app/timer.js app/timer.test.js app/main.js
git commit -m "feat: add session timer and per-question results breakdown"
```

---

### Task 10: Stats screen and review-missed pool

**Files:**
- Modify: `app/main.js` (stats rendering, navigation)
- Test: covered by `app/store.test.js` (Task 5) for the accuracy maths

**Interfaces:**
- Consumes: `store.accuracyBy(questions, field)` and `store.missedIds()` from Task 5.

The "only questions I got wrong" checkbox is already wired in Task 8 through `selectedPool()`; this task makes it visible and adds the stats view.

- [ ] **Step 1: Implement stats rendering in `app/main.js`**

```js
function accuracyTable(rows) {
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>Name</th><th>Seen</th><th>Correct</th><th>Accuracy</th></tr>";
  for (const [name, { seen, correct }] of rows) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${escapeAttr(name)}</td><td>${seen}</td><td>${correct}</td>` +
      `<td>${Math.round((correct / seen) * 100)}%</td>`;
    table.append(row);
  }
  return table;
}

async function renderStats() {
  // Stats span both subjects, so load whichever is not in memory.
  const subjects = ["reading", "math"];
  const all = [];
  for (const subject of subjects) {
    if (state.subject === subject && state.questions.length) { all.push(...state.questions); continue; }
    try {
      const { questions } = await loadSubject(subject, fetchJson);
      all.push(...questions);
    } catch { /* a subject that fails to load is simply not counted */ }
  }

  const progress = store.getProgress();
  const attempted = Object.keys(progress).length;
  const correct = Object.values(progress).filter((e) => e.lastCorrect).length;
  const missed = store.missedIds().length;
  el("stats-summary").textContent = attempted === 0
    ? "No questions answered yet."
    : `${attempted} questions attempted, ${correct} currently correct, ${missed} to review.`;

  el("stats-domains").replaceChildren(accuracyTable(store.accuracyBy(all, "domain")));
  el("stats-skills").replaceChildren(accuracyTable(store.accuracyBy(all, "skill")));
}
```

- [ ] **Step 2: Wire the stats navigation**

Inside the `DOMContentLoaded` handler in `app/main.js`, add:

```js
  el("nav-stats").addEventListener("click", async () => { showScreen("stats"); await renderStats(); });
  el("stats-reset").addEventListener("click", () => {
    if (!confirm("Erase all progress? This cannot be undone.")) return;
    store.reset();
    renderStats();
  });
```

- [ ] **Step 3: Verify the whole loop by hand**

Run: `npm run serve`.
1. Answer 3 Reading questions, deliberately getting one wrong.
2. Open **Stats** — the summary reads "3 questions attempted", and the domain table shows the split.
3. Return home, tick **Only questions I got wrong** — the match count drops to 1.
4. Start, and confirm the question served is the one missed.
5. Answer it correctly, revisit Stats — "to review" drops to 0.

- [ ] **Step 4: Commit**

```bash
git add app/main.js
git commit -m "feat: add stats screen and review-missed practice pool"
```

---

### Task 11: Flagged-question review and overrides

**Files:**
- Modify: `app/main.js` (review screen)
- Modify: `app/index.html` (header link)
- Test: `app/overrides.test.js`
- Create: `app/overrides.js`

**Interfaces:**
- Produces:
  - `buildOverride(question, patch): object` — the minimal correction to persist for one question.
  - `saveOverrides(overrides, postJson): Promise<{ok, count}>` — POSTs the whole map to `/api/overrides`.

Currently no question is flagged, so this screen normally reports "nothing to fix". It exists because the spec requires flagged questions to be recoverable without hand-editing generated data.

- [ ] **Step 1: Write the failing test**

Create `app/overrides.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverride, saveOverrides } from "./overrides.js";

test("buildOverride keeps only the corrected fields", () => {
  const question = { id: "a", tier: "flagged", correct: null, domain: "Algebra", stem: { images: [] } };
  assert.deepEqual(buildOverride(question, { correct: "C", tier: "clean" }), { correct: "C", tier: "clean" });
});

test("buildOverride drops empty values so a blank field is not persisted", () => {
  const question = { id: "a", tier: "flagged", correct: null };
  assert.deepEqual(buildOverride(question, { correct: "  ", tier: "clean" }), { tier: "clean" });
});

test("saveOverrides posts the whole map and reports the count", async () => {
  const sent = [];
  const postJson = async (path, body) => { sent.push([path, body]); return { ok: true, count: Object.keys(body).length }; };
  const result = await saveOverrides({ a: { correct: "C" }, b: { tier: "clean" } }, postJson);
  assert.equal(sent[0][0], "/api/overrides");
  assert.deepEqual(sent[0][1], { a: { correct: "C" }, b: { tier: "clean" } });
  assert.deepEqual(result, { ok: true, count: 2 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test app/overrides.test.js`
Expected: FAIL — `Cannot find module './overrides.js'`.

- [ ] **Step 3: Implement `app/overrides.js`**

```js
export function buildOverride(question, patch) {
  const override = {};
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim() === "") continue;
    override[key] = typeof value === "string" ? value.trim() : value;
  }
  return override;
}

export async function saveOverrides(overrides, postJson) {
  return postJson("/api/overrides", overrides);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test app/overrides.test.js`
Expected: PASS, 3/3.

- [ ] **Step 5: Add the review screen link to `app/index.html`**

Insert immediately before the `nav-stats` button in the header:

```html
    <button id="nav-review" class="link">Review</button>
```

- [ ] **Step 6: Implement the review screen in `app/main.js`**

Add the import:

```js
import { buildOverride, saveOverrides } from "./overrides.js";
```

Add the renderer and wiring:

```js
async function renderReview() {
  // loadSubject drops flagged questions, so read the raw files here.
  const flagged = [];
  for (const subject of ["reading", "math"]) {
    try {
      const data = await fetchJson(`/data/${subject}.json`);
      flagged.push(...data.questions.filter((q) => q.tier === "flagged"));
    } catch { /* subject unavailable */ }
  }

  el("review-empty").hidden = flagged.length > 0;
  const list = el("review-list");
  list.replaceChildren();

  for (const q of flagged) {
    const card = document.createElement("div");
    card.className = "choice";
    card.innerHTML =
      `<div><p><strong>${escapeAttr(q.id)}</strong> &middot; ${escapeAttr(q.subject)} &middot; ` +
      `${escapeAttr((q.flags ?? []).join(", "))}</p>` +
      `<div class="stem">${stemHtml(q)}</div>` +
      `<label>Correct answer <input type="text" data-id="${escapeAttr(q.id)}" value="${escapeAttr(q.correct ?? "")}"></label>` +
      `<button class="primary" data-save="${escapeAttr(q.id)}">Save correction</button></div>`;
    list.append(card);
  }

  // Assignment, not addEventListener: renderReview runs again on every visit
  // to the screen, and addEventListener would stack a duplicate handler each
  // time, saving the same correction repeatedly.
  list.onclick = async (event) => {
    const id = event.target.dataset?.save;
    if (!id) return;
    const input = list.querySelector(`input[data-id="${id}"]`);
    const question = flagged.find((q) => q.id === id);
    const existing = await fetchJson("/data/overrides.json").catch(() => ({}));
    existing[id] = buildOverride(question, { correct: input.value, tier: "clean" });
    const result = await saveOverrides(existing, postJson);
    el("bar-status").textContent = result.ok ? `Saved correction for ${id}` : "Save failed";
  };
}
```

Add the POST helper beside `fetchJson`:

```js
const postJson = async (path, body) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
};
```

And in `DOMContentLoaded`:

```js
  el("nav-review").addEventListener("click", async () => { showScreen("review"); await renderReview(); });
```

- [ ] **Step 7: Verify the review screen**

Run: `npm run serve`, click **Review**.
Expected: "No flagged questions. Nothing to fix." — the dataset currently has none.

To prove the save path works end to end, temporarily flag one question and confirm a correction round-trips:

```bash
node -e "const fs=require('fs');const f='data/math.json';const d=JSON.parse(fs.readFileSync(f));d.questions[0].tier='flagged';d.questions[0].flags=['manual-test'];fs.writeFileSync(f,JSON.stringify(d,null,2));console.log('flagged',d.questions[0].id)"
```

Reload **Review**, type an answer, press **Save correction**, and confirm `data/overrides.json` now contains that id. Then restore the data and confirm the override rescues it:

```bash
npm run extract -- --math --only <that id>
npm run verify
```

- [ ] **Step 8: Commit**

```bash
git add app/overrides.js app/overrides.test.js app/main.js app/index.html
git commit -m "feat: add flagged-question review screen writing to overrides.json"
```

---

### Task 12: Full verification pass

**Files:**
- Modify: `README.md` (create)

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: every test file passes, including the extraction suite from the previous plan.

- [ ] **Step 2: Run the data gate**

Run: `npm run verify`
Expected: `PASS - dataset verified`.

- [ ] **Step 3: Walk the app end to end**

Run: `npm run serve` and confirm each of these, which together cover every feature in the spec:

1. **Reading, unfiltered** — start, answer one question, see the rationale.
2. **An underline question renders its underline** — pick the Craft and Structure domain and look for underlined text in a stem.
3. **Math multiple choice** — choices render as separate images and are individually clickable.
4. **Math free-response** — an input box appears. Find a question whose stored answer lists two forms (`npm run diagnose` output aside, search `data/math.json` for a `correct` value containing a comma, e.g. `"-.9333, -14/15"`) and confirm **both** forms are accepted.
5. **A self-marked question** — the two self-marking buttons appear with the rationale.
6. **Filters** — selecting a domain reduces the match count; selecting a skill reduces it further.
7. **Timed set** — the clock runs and results list every question.
8. **No-repeat** — within one pass no question repeats.
9. **Stats** — accuracy appears by domain and by skill.
10. **Review missed** — the checkbox narrows the pool to missed questions.
11. **Reload the page** — progress survives.

- [ ] **Step 4: Write `README.md`**

```markdown
# SAT Practice

Randomized, interactive practice over 1,220 College Board questions
(610 Reading and Writing, 610 Math) extracted from the source PDFs.

## Running it

    npm install
    npm run serve

Then open http://127.0.0.1:8123 — or just double-click `start.cmd`.

## Rebuilding the data

The app reads `data/*.json` and `images/`, which are generated and
gitignored. To rebuild from the PDFs:

    npm run extract      # resumable; only redoes what is missing
    npm run verify       # integrity gate, must pass

Useful flags: `--force` recomputes everything, `--only <id>` rebuilds one
question, `--reading` / `--math` restrict to one subject.

`npm run diagnose` reports how many questions parse cleanly without
writing any output.

## How it works

Math questions are cropped images. Their equations and figures are drawn
with unmapped Type3 fonts, so text extraction silently drops every number
— 534 of 610 stems come out with no digits at all. Cropping the page
region preserves them exactly, and crop bounds stop above the answer line
so the answer cannot leak.

Reading questions are real text, with underlines recovered by scanning
for horizontal rules and italics by measuring glyph stem angle.

Corrections belong in `data/overrides.json`, which is merged over the
generated data at load. Never hand-edit the generated files.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add README covering setup, rebuild and design rationale"
```

---

## Completion criteria

1. `npm test` passes across every test file, extraction and app alike.
2. `npm run verify` reports PASS.
3. All eleven checks in Task 12 Step 3 pass **in a real browser** — not inferred from unit tests.
4. `README.md` explains running, rebuilding, and why Math is images.
