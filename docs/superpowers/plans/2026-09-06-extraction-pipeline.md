# SAT Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the two College Board PDFs into a verified, app-ready dataset: 610 Reading questions as faithful HTML (underlines and italics recovered) and 610 Math questions as cropped grayscale PNGs that never contain the answer.

**Architecture:** A library of small, individually tested modules under `tools/lib/` (PDF access, PNG encoding, segmentation, metadata, underline detection, font slant, text reassembly), driven by three entry points: `diagnose.mjs` (report only, no output artifacts), `extract.mjs` (writes `data/` and `images/`), and `verify.mjs` (integrity gate). Every question is independently classified `clean` / `fallback` / `flagged`, so a failure never blocks the rest.

**Tech Stack:** Node 24 ESM, `mupdf` (WASM) as the sole dependency, `node --test` and `node:assert/strict` for tests, `node:zlib` for PNG encoding.

**Spec:** `docs/superpowers/specs/2026-09-06-sat-randomizer-design.md`

## Global Constraints

- Node >= 24. Verified present: v24.13.1.
- **Exactly one runtime dependency: `mupdf` (^1.28.1).** No test framework, no image library, no PDF library besides mupdf. Python is unavailable; do not reach for it.
- ESM only. Tools are `.mjs`; `package.json` sets `"type": "module"`.
- Source PDFs are read-only inputs and must never be modified or moved: `Math SAT Questions.pdf` (642 pages), `SAT Reading.pdf` (687 pages).
- Expected counts, asserted by tests: **610 questions per subject**, all IDs unique.
- **Hard rule: no stem or answer-choice crop may extend to or past the `Correct Answer:` line.** This is the answer-leakage guard and is enforced by `verify.mjs`.
- Generated files (`data/reading.json`, `data/math.json`, `images/**`) are **never hand-edited**. Corrections go only into `data/overrides.json`.
- Rendering is grayscale (`DeviceGray`). Detection renders at scale 3; output crops render at scale 2.5.
- This directory is **not currently a git repository**. If `git init` has not been run, skip the commit step in each task; every other step still applies.

---

### Task 1: Project scaffold and PDF access layer

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `tools/lib/pdf.mjs`
- Test: `tools/lib/pdf.test.mjs`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `MATH_PDF: string`, `READING_PDF: string` — absolute paths to the two source PDFs.
  - `openDoc(path: string): Document` — mupdf document.
  - `pageLines(page): Array<{x, y, w, h, text}>` — line boxes in PDF points.
  - `pageChars(page): Array<{c, font, size, x0, x1, top, bot}>` — per-character quads; `font` is the mupdf font name string, `top`/`bot` are glyph top and bottom y.
  - `renderGray(page, scale, clip?): {pixels: Uint8Array, width, height, stride, ox, oy}` — 8-bit grayscale render. `clip` is `[x0,y0,x1,y1]` in PDF points; `ox`/`oy` are the device-space origin, so `pageY = (oy + pixelY) / scale`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "sat-questions",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "dependencies": { "mupdf": "^1.28.1" },
  "scripts": {
    "test": "node --test",
    "diagnose": "node tools/diagnose.mjs",
    "extract": "node tools/extract.mjs",
    "verify": "node tools/verify.mjs"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
images/
data/*.json
!data/overrides.json
.cache/

# Source PDFs: ~97MB of immutable input that never changes.
*.pdf
```

Generated data is ignored; `overrides.json` is the one data file that is tracked, because it holds hand corrections.

The source PDFs are excluded deliberately. They are read-only inputs that never change, so tracking them would add ~97MB to the repository for no history value. **This means git does not back them up** — they must be preserved separately. If this file already exists from repository setup, keep the PDF exclusion rather than overwriting it.

- [ ] **Step 3: Install the dependency**

Run: `npm install`
Expected: `mupdf` appears in `node_modules/`, no build step, no compiler invoked.

- [ ] **Step 4: Write the failing test**

Create `tools/lib/pdf.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MATH_PDF, READING_PDF, openDoc, pageLines, pageChars, renderGray } from "./pdf.mjs";

test("opens both source PDFs with their known page counts", () => {
  assert.equal(openDoc(MATH_PDF).countPages(), 642);
  assert.equal(openDoc(READING_PDF).countPages(), 687);
});

test("pageLines exposes the question id anchor on the first math page", () => {
  const lines = pageLines(openDoc(MATH_PDF).loadPage(0));
  assert.ok(lines.some((l) => l.text.trim() === "Question ID: 590d662d"));
});

test("pageChars returns ordered characters with quads and font identity", () => {
  const chars = pageChars(openDoc(READING_PDF).loadPage(0));
  assert.ok(chars.map((c) => c.c).join("").includes("Ebony and Topaz"));
  const first = chars[0];
  assert.ok(first.x1 > first.x0, "glyph must have positive width");
  assert.ok(first.bot > first.top, "glyph bottom must be below its top");
  assert.match(first.font, /Type3/);
});

test("renderGray produces an 8-bit grayscale buffer for a clipped region", () => {
  const img = renderGray(openDoc(READING_PDF).loadPage(0), 2, [0, 0, 612, 100]);
  assert.equal(img.width, 1224);
  assert.equal(img.height, 200);
  assert.equal(img.pixels.length, img.stride * img.height);
  assert.ok(img.pixels.some((v) => v < 128), "expected ink in the header region");
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `node --test tools/lib/pdf.test.mjs`
Expected: FAIL — `Cannot find module './pdf.mjs'`.

- [ ] **Step 6: Implement `tools/lib/pdf.mjs`**

```js
import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MATH_PDF = path.join(ROOT, "Math SAT Questions.pdf");
export const READING_PDF = path.join(ROOT, "SAT Reading.pdf");

export function openDoc(file) {
  return mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
}

export function pageLines(page) {
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
  const out = [];
  for (const block of json.blocks) {
    if (block.type !== "text") continue;
    for (const line of block.lines) {
      out.push({ x: line.bbox.x, y: line.bbox.y, w: line.bbox.w, h: line.bbox.h, text: line.text });
    }
  }
  return out;
}

export function pageChars(page) {
  const chars = [];
  page.toStructuredText("preserve-whitespace").walk({
    onChar(c, origin, font, size, quad) {
      // quad is flat: [ulx, uly, urx, ury, llx, lly, lrx, lry]
      chars.push({ c, font: font.getName(), size, x0: quad[0], top: quad[1], x1: quad[2], bot: quad[5] });
    },
  });
  return chars;
}

export function renderGray(page, scale, clip) {
  const bounds = page.getBounds();
  const region = clip ?? [bounds[0], bounds[1], bounds[2], bounds[3]];
  const box = [
    Math.floor(region[0] * scale),
    Math.floor(region[1] * scale),
    Math.ceil(region[2] * scale),
    Math.ceil(region[3] * scale),
  ];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, box, false);
  pix.clear(255);
  const device = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
  page.run(device, mupdf.Matrix.identity);
  device.close();
  return {
    pixels: pix.getPixels(),
    width: pix.getWidth(),
    height: pix.getHeight(),
    stride: pix.getStride(),
    ox: box[0],
    oy: box[1],
  };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test tools/lib/pdf.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 8: Commit** *(skip if not a git repo)*

```bash
git add package.json package-lock.json .gitignore tools/lib/pdf.mjs tools/lib/pdf.test.mjs
git commit -m "feat: add mupdf-backed PDF access layer"
```

---

### Task 2: Grayscale PNG encoder

**Files:**
- Create: `tools/lib/png.mjs`
- Test: `tools/lib/png.test.mjs`

**Interfaces:**
- Consumes: `renderGray` output shape from Task 1.
- Produces:
  - `encodeGray(width: number, height: number, rowAt: (y: number) => Buffer): Buffer` — a complete 8-bit grayscale PNG.
  - `inkBounds(img, threshold?): {x0, y0, x1, y1} | null` — bounding box of non-white pixels, in pixel coordinates.
  - `cropToPng(img, pad?): Buffer | null` — trims `img` to its ink bounds plus padding and encodes it. Returns `null` when the region is blank.

Written by hand rather than using `Pixmap.asPNG()` because trimming each crop to its ink bounds is what keeps the image set small, and mupdf offers no sub-pixmap crop.

- [ ] **Step 1: Write the failing test**

Create `tools/lib/png.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { encodeGray, inkBounds, cropToPng } from "./png.mjs";

function chunks(png) {
  const found = {};
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("latin1");
    found[type] = png.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  return found;
}

test("encodeGray writes a valid PNG whose pixels round-trip", () => {
  const rows = [Buffer.from([0, 128, 255]), Buffer.from([255, 0, 64])];
  const png = encodeGray(3, 2, (y) => rows[y]);

  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const { IHDR, IDAT, IEND } = chunks(png);
  assert.equal(IHDR.readUInt32BE(0), 3);
  assert.equal(IHDR.readUInt32BE(4), 2);
  assert.equal(IHDR[8], 8, "bit depth must be 8");
  assert.equal(IHDR[9], 0, "colour type must be grayscale");
  assert.ok(IEND, "IEND chunk required");

  const raw = zlib.inflateSync(IDAT);
  assert.equal(raw.length, (3 + 1) * 2);
  assert.equal(raw[0], 0, "scanline filter byte must be 0");
  assert.deepEqual(raw.subarray(1, 4), rows[0]);
  assert.equal(raw[4], 0);
  assert.deepEqual(raw.subarray(5, 8), rows[1]);
});

test("inkBounds finds the dark region and ignores white margin", () => {
  const width = 5, height = 4, stride = 5;
  const pixels = new Uint8Array(width * height).fill(255);
  pixels[1 * stride + 2] = 0;
  pixels[2 * stride + 3] = 10;
  assert.deepEqual(inkBounds({ pixels, width, height, stride }), { x0: 2, y0: 1, x1: 3, y1: 2 });
});

test("inkBounds returns null for a blank region", () => {
  const pixels = new Uint8Array(9).fill(255);
  assert.equal(inkBounds({ pixels, width: 3, height: 3, stride: 3 }), null);
});

test("cropToPng trims to ink plus padding", () => {
  const width = 10, height = 10, stride = 10;
  const pixels = new Uint8Array(width * height).fill(255);
  pixels[5 * stride + 5] = 0;
  const png = cropToPng({ pixels, width, height, stride }, 2);
  const { IHDR } = chunks(png);
  assert.equal(IHDR.readUInt32BE(0), 5, "1 ink px + 2 padding each side");
  assert.equal(IHDR.readUInt32BE(4), 5);
});

test("cropToPng returns null for a blank region", () => {
  const pixels = new Uint8Array(16).fill(255);
  assert.equal(cropToPng({ pixels, width: 4, height: 4, stride: 4 }, 2), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/lib/png.test.mjs`
Expected: FAIL — `Cannot find module './png.mjs'`.

- [ ] **Step 3: Implement `tools/lib/png.mjs`**

```js
import zlib from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function encodeGray(width, height, rowAt) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter type: None
    rowAt(y).copy(raw, y * (width + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function inkBounds(img, threshold = 250) {
  const { pixels, width, height, stride } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * stride + x] < threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function cropToPng(img, pad = 4) {
  const bounds = inkBounds(img);
  if (!bounds) return null;
  const x0 = Math.max(0, bounds.x0 - pad);
  const y0 = Math.max(0, bounds.y0 - pad);
  const x1 = Math.min(img.width - 1, bounds.x1 + pad);
  const y1 = Math.min(img.height - 1, bounds.y1 + pad);
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const row = Buffer.alloc(width);
  return encodeGray(width, height, (y) => {
    const start = (y0 + y) * img.stride + x0;
    Buffer.from(img.pixels.buffer, img.pixels.byteOffset + start, width).copy(row);
    return row;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/lib/png.test.mjs`
Expected: PASS, 5/5.

- [ ] **Step 5: Commit** *(skip if not a git repo)*

```bash
git add tools/lib/png.mjs tools/lib/png.test.mjs
git commit -m "feat: add dependency-free grayscale PNG encoder with ink trimming"
```

---

### Task 3: Question segmentation

**Files:**
- Create: `tools/lib/segment.mjs`
- Test: `tools/lib/segment.test.mjs`

**Interfaces:**
- Consumes: `openDoc`, `pageLines` from Task 1.
- Produces:
  - `findSpans(doc): Array<{id, startPage, startY, endPage, endY}>` — one entry per question, in document order. `endY` is `Infinity` for the final question.
  - `linesInSpan(doc, span): Array<{page, x, y, w, h, text}>` — every line belonging to a span, page-ordered.
  - `findAnchors(lines): {question?, answer?, correct?, rationale?}` — each value `{page, y, text}`.

A question runs from its `Question ID:` line to the next one, which may be several pages later.

- [ ] **Step 1: Write the failing test**

Create `tools/lib/segment.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MATH_PDF, READING_PDF, openDoc } from "./pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./segment.mjs";

test("finds exactly 610 uniquely identified questions in each PDF", () => {
  for (const file of [MATH_PDF, READING_PDF]) {
    const spans = findSpans(openDoc(file));
    assert.equal(spans.length, 610);
    assert.equal(new Set(spans.map((s) => s.id)).size, 610);
  }
});

test("spans are contiguous and ordered", () => {
  const spans = findSpans(openDoc(MATH_PDF));
  assert.equal(spans[0].id, "590d662d");
  for (let i = 0; i < spans.length - 1; i++) {
    assert.equal(spans[i].endPage, spans[i + 1].startPage);
    assert.equal(spans[i].endY, spans[i + 1].startY);
  }
  assert.equal(spans.at(-1).endY, Infinity);
});

test("anchors of the first math question appear in document order", () => {
  const doc = openDoc(MATH_PDF);
  const span = findSpans(doc)[0];
  const anchors = findAnchors(linesInSpan(doc, span));
  assert.ok(anchors.question, "Question heading required");
  assert.ok(anchors.correct, "Correct Answer line required");
  assert.ok(anchors.rationale, "Rationale heading required");
  assert.ok(anchors.question.y < anchors.correct.y);
  assert.ok(anchors.correct.y < anchors.rationale.y);
  assert.match(anchors.correct.text, /^Correct Answer:\s*500$/);
});

test("a multiple-choice question exposes an Answer heading before its answer", () => {
  const doc = openDoc(READING_PDF);
  const span = findSpans(doc)[0];
  const anchors = findAnchors(linesInSpan(doc, span));
  assert.ok(anchors.answer, "Reading questions are all multiple choice");
  assert.ok(anchors.answer.y < anchors.correct.y);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/lib/segment.test.mjs`
Expected: FAIL — `Cannot find module './segment.mjs'`.

- [ ] **Step 3: Implement `tools/lib/segment.mjs`**

```js
import { pageLines } from "./pdf.mjs";

const ID_RE = /^Question ID:\s*([0-9a-f]{6,})$/;

export function findSpans(doc) {
  const starts = [];
  const pageCount = doc.countPages();
  for (let page = 0; page < pageCount; page++) {
    for (const line of pageLines(doc.loadPage(page))) {
      const match = ID_RE.exec(line.text.trim());
      if (match) starts.push({ id: match[1], page, y: line.y });
    }
  }
  return starts.map((start, i) => {
    const next = starts[i + 1];
    return {
      id: start.id,
      startPage: start.page,
      startY: start.y,
      endPage: next ? next.page : pageCount - 1,
      endY: next ? next.y : Infinity,
    };
  });
}

export function linesInSpan(doc, span) {
  const out = [];
  for (let page = span.startPage; page <= span.endPage; page++) {
    for (const line of pageLines(doc.loadPage(page))) {
      if (page === span.startPage && line.y < span.startY) continue;
      if (page === span.endPage && line.y >= span.endY) continue;
      out.push({ page, ...line });
    }
  }
  return out;
}

export function findAnchors(lines) {
  const anchors = {};
  for (const line of lines) {
    const text = line.text.trim();
    const at = { page: line.page, y: line.y, text };
    if (text === "Question" && !anchors.question) anchors.question = at;
    else if (text === "Answer" && !anchors.answer) anchors.answer = at;
    else if (text.startsWith("Correct Answer:") && !anchors.correct) anchors.correct = at;
    else if (text === "Rationale" && !anchors.rationale) anchors.rationale = at;
  }
  return anchors;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/lib/segment.test.mjs`
Expected: PASS, 4/4. This is slow (it reads every page of both PDFs); allow up to a few minutes.

- [ ] **Step 5: Commit** *(skip if not a git repo)*

```bash
git add tools/lib/segment.mjs tools/lib/segment.test.mjs
git commit -m "feat: segment both PDFs into 610 anchored question spans"
```

---

### Task 4: Metadata column parsing

**Files:**
- Create: `tools/lib/metadata.mjs`
- Test: `tools/lib/metadata.test.mjs`

**Interfaces:**
- Consumes: line shape `{x, y, text}` from Task 1.
- Produces: `parseMetadata(lines, questionY): {assessment, test, domain, skill, difficulty} | null` — `lines` are the span's lines, `questionY` is the y of the `Question` anchor. Returns `null` when the header row is absent.

The header row supplies its own x positions, so column boundaries are calibrated per question and varying layouts do not matter. Values that wrap onto a second line (`Linear inequalities in one` / `or two variables`) are joined.

- [ ] **Step 1: Write the failing test**

Create `tools/lib/metadata.test.mjs`. The fixture reproduces the real wrapped-skill layout observed on math page 2:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata } from "./metadata.mjs";

const HEADER = [
  { x: 24, y: 58, text: "Assessment" },
  { x: 139, y: 58, text: "Test" },
  { x: 254, y: 58, text: "Domain" },
  { x: 369, y: 58, text: "Skill" },
  { x: 484, y: 58, text: "Difficulty" },
];

test("assigns each value to the column its x falls under", () => {
  const lines = [
    ...HEADER,
    { x: 24, y: 83, text: "SAT" },
    { x: 139, y: 83, text: "Math" },
    { x: 254, y: 83, text: "Algebra" },
    { x: 369, y: 83, text: "Linear functions" },
    { x: 484, y: 83, text: "Hard" },
  ];
  assert.deepEqual(parseMetadata(lines, 127), {
    assessment: "SAT", test: "Math", domain: "Algebra",
    skill: "Linear functions", difficulty: "Hard",
  });
});

test("joins a skill that wraps onto a second line", () => {
  const lines = [
    ...HEADER,
    { x: 24, y: 83, text: "SAT" },
    { x: 139, y: 83, text: "Math" },
    { x: 254, y: 83, text: "Algebra" },
    { x: 369, y: 83, text: "Linear inequalities in one" },
    { x: 484, y: 83, text: "Hard" },
    { x: 369, y: 94, text: "or two variables" },
  ];
  assert.equal(parseMetadata(lines, 127).skill, "Linear inequalities in one or two variables");
});

test("ignores lines at or below the Question heading", () => {
  const lines = [
    ...HEADER,
    { x: 24, y: 83, text: "SAT" },
    { x: 139, y: 83, text: "Reading and Writing" },
    { x: 254, y: 83, text: "Craft and Structure" },
    { x: 369, y: 83, text: "Words in Context" },
    { x: 484, y: 83, text: "Hard" },
    { x: 24, y: 140, text: "Rejecting the premise that the literary magazine" },
  ];
  assert.equal(parseMetadata(lines, 127).domain, "Craft and Structure");
});

test("returns null when the header row is missing", () => {
  assert.equal(parseMetadata([{ x: 24, y: 83, text: "SAT" }], 127), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/lib/metadata.test.mjs`
Expected: FAIL — `Cannot find module './metadata.mjs'`.

- [ ] **Step 3: Implement `tools/lib/metadata.mjs`**

```js
const COLUMNS = ["assessment", "test", "domain", "skill", "difficulty"];
const HEADINGS = ["Assessment", "Test", "Domain", "Skill", "Difficulty"];
const X_TOLERANCE = 4;

export function parseMetadata(lines, questionY) {
  const headers = HEADINGS.map((h) => lines.find((l) => l.text.trim() === h));
  if (headers.some((h) => !h)) return null;

  const xs = headers.map((h) => h.x);
  const headerY = headers[0].y;
  const buckets = COLUMNS.map(() => []);

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    if (line.y <= headerY) continue;
    if (questionY !== undefined && line.y >= questionY) continue;

    let column = 0;
    for (let i = 0; i < xs.length; i++) if (line.x >= xs[i] - X_TOLERANCE) column = i;
    buckets[column].push(text);
  }

  return Object.fromEntries(COLUMNS.map((name, i) => [name, buckets[i].join(" ")]));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/lib/metadata.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit** *(skip if not a git repo)*

```bash
git add tools/lib/metadata.mjs tools/lib/metadata.test.mjs
git commit -m "feat: parse question metadata using self-calibrating column positions"
```

---

### Task 5: Underline detection

**Files:**
- Create: `tools/lib/underline.mjs`
- Test: `tools/lib/underline.test.mjs`

**Interfaces:**
- Consumes: `renderGray` output from Task 1.
- Produces: `detectUnderlines(img, scale, opts?): Array<{y, x0, x1}>` — bands in **PDF points**, sorted by y then x.

Discrimination rule, derived from measurement on Reading page 1: keep bands at most 4 pixel-rows tall and at least 15pt wide. On that page the rejected candidates are a 198-row block (the header rule) and 22-row blocks (table shading); the accepted band is the underline beneath `"How lifelike are they?"`, which arrives as two runs (`x=[18,97]` and `x=[100,109]`) split by a descender and merged by the 8pt gap rule.

- [ ] **Step 1: Write the failing test**

Create `tools/lib/underline.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { READING_PDF, openDoc, renderGray } from "./pdf.mjs";
import { detectUnderlines } from "./underline.mjs";

test("merges runs split by a descender into one band", () => {
  // Two 2-row runs at the same y with a 3pt gap, at scale 1.
  const width = 120, height = 6, stride = 120;
  const pixels = new Uint8Array(width * height).fill(255);
  for (const y of [2, 3]) {
    for (let x = 18; x < 97; x++) pixels[y * stride + x] = 0;
    for (let x = 100; x < 110; x++) pixels[y * stride + x] = 0;
  }
  const bands = detectUnderlines({ pixels, width, height, stride, ox: 0, oy: 0 }, 1);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].x0, 18);
  assert.equal(bands[0].x1, 110);
});

test("rejects thick bands such as table shading", () => {
  const width = 120, height = 30, stride = 120;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 5; y < 25; y++) for (let x = 10; x < 110; x++) pixels[y * stride + x] = 0;
  assert.deepEqual(detectUnderlines({ pixels, width, height, stride, ox: 0, oy: 0 }, 1), []);
});

test("rejects short marks narrower than the minimum width", () => {
  const width = 120, height = 6, stride = 120;
  const pixels = new Uint8Array(width * height).fill(255);
  for (const y of [2, 3]) for (let x = 40; x < 47; x++) pixels[y * stride + x] = 0;
  assert.deepEqual(detectUnderlines({ pixels, width, height, stride, ox: 0, oy: 0 }, 1), []);
});

test("finds exactly one underline on Reading page 1", () => {
  const img = renderGray(openDoc(READING_PDF).loadPage(1), 3);
  const bands = detectUnderlines(img, 3);
  assert.equal(bands.length, 1, "the 'How lifelike are they?' underline");
  assert.ok(Math.abs(bands[0].y - 150.7) < 1.5, `unexpected y ${bands[0].y}`);
  assert.ok(bands[0].x0 < 20 && bands[0].x1 > 105, `unexpected span ${bands[0].x0}..${bands[0].x1}`);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/lib/underline.test.mjs`
Expected: FAIL — `Cannot find module './underline.mjs'`.

- [ ] **Step 3: Implement `tools/lib/underline.mjs`**

```js
const DEFAULTS = {
  darkThreshold: 128,
  minRunPx: 20,
  maxRows: 4,
  minWidthPt: 15,
  mergeGapPt: 8,
};

export function detectUnderlines(img, scale, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const { pixels, width, height, stride, ox = 0, oy = 0 } = img;

  const runs = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const dark = x < width && pixels[y * stride + x] < cfg.darkThreshold;
      if (dark && start < 0) start = x;
      else if (!dark && start >= 0) {
        if (x - start >= cfg.minRunPx) runs.push({ y, x0: start, x1: x });
        start = -1;
      }
    }
  }
  runs.sort((a, b) => a.y - b.y || a.x0 - b.x0);

  const bands = [];
  for (const run of runs) {
    const host = bands.find(
      (b) => Math.abs(b.yEnd - run.y) <= 1 && run.x0 < b.x1 + 3 && run.x1 > b.x0 - 3,
    );
    if (host) {
      host.yEnd = run.y;
      host.x0 = Math.min(host.x0, run.x0);
      host.x1 = Math.max(host.x1, run.x1);
      host.rows++;
    } else {
      bands.push({ yStart: run.y, yEnd: run.y, x0: run.x0, x1: run.x1, rows: 1 });
    }
  }

  const toPt = (device) => device / scale;
  const thin = bands
    .filter((b) => b.rows <= cfg.maxRows)
    .map((b) => ({
      y: toPt(oy + b.yStart),
      x0: toPt(ox + b.x0),
      x1: toPt(ox + b.x1),
    }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);

  // Join neighbours on the same baseline separated only by a descender.
  const merged = [];
  for (const band of thin) {
    const prev = merged.at(-1);
    if (prev && Math.abs(prev.y - band.y) <= 1 && band.x0 - prev.x1 <= cfg.mergeGapPt) {
      prev.x1 = Math.max(prev.x1, band.x1);
    } else {
      merged.push({ ...band });
    }
  }

  return merged.filter((b) => b.x1 - b.x0 >= cfg.minWidthPt);
}
```

Width filtering happens **after** merging so that a wide underline broken into short fragments by several descenders still survives.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/lib/underline.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit** *(skip if not a git repo)*

```bash
git add tools/lib/underline.mjs tools/lib/underline.test.mjs
git commit -m "feat: detect underlines by pixel scan with shading rejection"
```

---

### Task 6: Italic classification by glyph slant

**Files:**
- Create: `tools/lib/fontstyle.mjs`
- Create: `tools/calibrate-slant.mjs`
- Test: `tools/lib/fontstyle.test.mjs`

**Interfaces:**
- Consumes: `pageChars`, `renderGray` from Task 1.
- Produces:
  - `measureSlant(img): number | null` — normalized horizontal shift between the ink centroid of the top third and the bottom third of a glyph image. Positive means it leans right. `null` when either band has no ink.
  - `italicFontsForPage(page, chars, opts?): Set<string>` — font names on this page classified italic. Computed once per page and cheap: there are about six fonts per page.

Font *names* are useless here — every font is an unnamed Type3 — but font *identity* changes exactly at style boundaries, so classification runs per distinct font.

- [ ] **Step 1: Write the failing test**

Create `tools/lib/fontstyle.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { READING_PDF, openDoc, pageChars } from "./pdf.mjs";
import { measureSlant, italicFontsForPage } from "./fontstyle.mjs";

test("measureSlant returns null for an image with no ink", () => {
  const pixels = new Uint8Array(100).fill(255);
  assert.equal(measureSlant({ pixels, width: 10, height: 10, stride: 10 }), null);
});

test("measureSlant reports a rightward lean as positive", () => {
  // A stroke shifted progressively right toward the top.
  const width = 12, height = 12, stride = 12;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) {
    const x = 2 + Math.floor(((height - 1 - y) / (height - 1)) * 6);
    pixels[y * stride + x] = 0;
  }
  assert.ok(measureSlant({ pixels, width, height, stride }) > 0.1);
});

test("measureSlant reports an upright stroke as near zero", () => {
  const width = 12, height = 12, stride = 12;
  const pixels = new Uint8Array(width * height).fill(255);
  for (let y = 0; y < height; y++) pixels[y * stride + 6] = 0;
  assert.ok(Math.abs(measureSlant({ pixels, width, height, stride })) < 0.05);
});

test("classifies the italic title font on Reading page 0, and not the body font", () => {
  const page = openDoc(READING_PDF).loadPage(0);
  const chars = pageChars(page);
  const italic = italicFontsForPage(page, chars);

  const text = chars.map((c) => c.c).join("");
  const at = text.indexOf("Ebony and Topaz");
  assert.ok(at > 0, "fixture text must be present");

  const titleFont = chars[at].font;
  const bodyFont = chars[at - 5].font;
  assert.notEqual(titleFont, bodyFont, "style boundary must change font identity");
  assert.ok(italic.has(titleFont), "magazine title must classify as italic");
  assert.ok(!italic.has(bodyFont), "surrounding prose must not classify as italic");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/lib/fontstyle.test.mjs`
Expected: FAIL — `Cannot find module './fontstyle.mjs'`.

- [ ] **Step 3: Implement `tools/lib/fontstyle.mjs`**

`ITALIC_THRESHOLD` is set in Step 5 from real measurements; start at `0.08`.

```js
import { renderGray } from "./pdf.mjs";

const ITALIC_THRESHOLD = 0.08;
const SAMPLE_SCALE = 12;
const SAMPLE_CHARS = 6;
const TALL = /[bdfhklABDEFHIKLMNPRT]/;

export function measureSlant(img) {
  const { pixels, width, height, stride } = img;
  const centroid = (yStart, yEnd) => {
    let weighted = 0, total = 0;
    for (let y = yStart; y < yEnd; y++) {
      for (let x = 0; x < width; x++) {
        const ink = 255 - pixels[y * stride + x];
        if (ink > 40) { weighted += x * ink; total += ink; }
      }
    }
    return total ? weighted / total : null;
  };
  const third = Math.max(1, Math.floor(height / 3));
  const top = centroid(0, third);
  const bottom = centroid(height - third, height);
  if (top === null || bottom === null) return null;
  return (top - bottom) / width;
}

export function slantForFont(page, chars, fontName) {
  const samples = chars
    .filter((c) => c.font === fontName && TALL.test(c.c) && c.x1 - c.x0 > 1 && c.bot - c.top > 3)
    .slice(0, SAMPLE_CHARS);
  const values = [];
  for (const ch of samples) {
    const img = renderGray(page, SAMPLE_SCALE, [ch.x0, ch.top, ch.x1, ch.bot]);
    const slant = measureSlant(img);
    if (slant !== null) values.push(slant);
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]; // median resists outliers
}

export function italicFontsForPage(page, chars, opts = {}) {
  const threshold = opts.threshold ?? ITALIC_THRESHOLD;
  const italic = new Set();
  for (const fontName of new Set(chars.map((c) => c.font))) {
    const slant = slantForFont(page, chars, fontName);
    if (slant !== null && slant > threshold) italic.add(fontName);
  }
  return italic;
}
```

- [ ] **Step 4: Create `tools/calibrate-slant.mjs`**

```js
import { READING_PDF, openDoc, pageChars } from "./lib/pdf.mjs";
import { slantForFont } from "./lib/fontstyle.mjs";

const page = openDoc(READING_PDF).loadPage(0);
const chars = pageChars(page);
const text = chars.map((c) => c.c).join("");
const at = text.indexOf("Ebony and Topaz");
const known = { italic: chars[at].font, body: chars[at - 5].font };

for (const font of new Set(chars.map((c) => c.font))) {
  const label = font === known.italic ? "  <- known ITALIC" : font === known.body ? "  <- known BODY" : "";
  console.log(`${font}  slant=${String(slantForFont(page, chars, font)).slice(0, 8)}${label}`);
}
```

- [ ] **Step 5: Calibrate the threshold**

Run: `node tools/calibrate-slant.mjs`
Expected: a slant value per font, with the known-italic font clearly higher than the known-body font.

Set `ITALIC_THRESHOLD` in `tools/lib/fontstyle.mjs` to the midpoint between those two values, rounded to two decimals. If the two are not clearly separated, the measurement is unreliable: leave the threshold high enough that nothing classifies as italic, note it in the task's completion report, and continue. Italics are cosmetic and must never be guessed at.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test tools/lib/fontstyle.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 7: Commit** *(skip if not a git repo)*

```bash
git add tools/lib/fontstyle.mjs tools/lib/fontstyle.test.mjs tools/calibrate-slant.mjs
git commit -m "feat: classify italic fonts by glyph slant measurement"
```

---

### Task 7: Text reassembly to HTML

**Files:**
- Create: `tools/lib/text.mjs`
- Test: `tools/lib/text.test.mjs`

**Interfaces:**
- Consumes: char shape from Task 1, band shape from Task 5, italic set from Task 6.
- Produces:
  - `isUnderlined(char, bands): boolean` — true when the glyph bottom sits within 11pt above a band and the x ranges overlap.
  - `charsToHtml(chars, {bands, italicFonts}): string` — escaped HTML, one `<p>` per paragraph, with `<u>` and `<em>` runs.

- [ ] **Step 1: Write the failing test**

Create `tools/lib/text.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { charsToHtml, isUnderlined } from "./text.mjs";

// Build a run of characters on one baseline starting at x=10, 5pt apart.
function line(text, { y = 100, font = "body", x = 10 } = {}) {
  return [...text].map((c, i) => ({
    c, font, x0: x + i * 5, x1: x + i * 5 + 5, top: y - 8, bot: y,
  }));
}

test("isUnderlined matches a glyph sitting just above a band", () => {
  const band = { y: 102, x0: 8, x1: 60 };
  assert.ok(isUnderlined({ x0: 10, x1: 15, bot: 100 }, [band]));
  assert.ok(!isUnderlined({ x0: 200, x1: 205, bot: 100 }, [band]), "outside the x range");
  assert.ok(!isUnderlined({ x0: 10, x1: 15, bot: 60 }, [band]), "too far above the band");
});

test("escapes HTML-significant characters", () => {
  const html = charsToHtml(line("a<b&c"), { bands: [], italicFonts: new Set() });
  assert.equal(html, "<p>a&lt;b&amp;c</p>");
});

test("wraps underlined characters in a single u element", () => {
  const chars = line("abcdef");
  const bands = [{ y: 102, x0: 19, x1: 36 }]; // covers c, d, e
  const html = charsToHtml(chars, { bands, italicFonts: new Set() });
  assert.equal(html, "<p>ab<u>cde</u>f</p>");
});

test("wraps runs in the italic font in an em element", () => {
  const chars = [...line("read ", { font: "body" }), ...line("Ebony", { font: "italic", x: 35 })];
  const html = charsToHtml(chars, { bands: [], italicFonts: new Set(["italic"]) });
  assert.equal(html, "<p>read <em>Ebony</em></p>");
});

test("splits paragraphs on a large vertical gap and joins wrapped lines", () => {
  const chars = [
    ...line("one", { y: 100 }),
    ...line("two", { y: 112 }),   // same paragraph, normal leading
    ...line("three", { y: 160 }), // new paragraph
  ];
  const html = charsToHtml(chars, { bands: [], italicFonts: new Set() });
  assert.equal(html, "<p>one two</p><p>three</p>");
});

test("returns an empty string when there are no characters", () => {
  assert.equal(charsToHtml([], { bands: [], italicFonts: new Set() }), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/lib/text.test.mjs`
Expected: FAIL — `Cannot find module './text.mjs'`.

- [ ] **Step 3: Implement `tools/lib/text.mjs`**

```js
const UNDERLINE_REACH_PT = 11;
const BASELINE_TOLERANCE_PT = 2;
const PARAGRAPH_GAP_FACTOR = 1.6;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = (s) => s.replace(/[&<>]/g, (ch) => ESCAPES[ch]);

export function isUnderlined(char, bands) {
  return bands.some(
    (b) =>
      char.bot <= b.y + BASELINE_TOLERANCE_PT &&
      char.bot >= b.y - UNDERLINE_REACH_PT &&
      char.x1 > b.x0 &&
      char.x0 < b.x1,
  );
}

function groupLines(chars) {
  const lines = [];
  for (const char of [...chars].sort((a, b) => a.bot - b.bot || a.x0 - b.x0)) {
    const host = lines.find((l) => Math.abs(l.baseline - char.bot) <= BASELINE_TOLERANCE_PT);
    if (host) host.chars.push(char);
    else lines.push({ baseline: char.bot, chars: [char] });
  }
  for (const l of lines) l.chars.sort((a, b) => a.x0 - b.x0);
  return lines.sort((a, b) => a.baseline - b.baseline);
}

function groupParagraphs(lines) {
  if (!lines.length) return [];
  const gaps = lines.slice(1).map((l, i) => l.baseline - lines[i].baseline);
  const sorted = [...gaps].sort((a, b) => a - b);
  const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const limit = typical * PARAGRAPH_GAP_FACTOR;

  const paragraphs = [[lines[0]]];
  for (let i = 1; i < lines.length; i++) {
    if (typical > 0 && lines[i].baseline - lines[i - 1].baseline > limit) paragraphs.push([lines[i]]);
    else paragraphs.at(-1).push(lines[i]);
  }
  return paragraphs;
}

function renderRuns(chars, bands, italicFonts) {
  let html = "";
  let open = null;
  let buffer = "";

  const flush = () => {
    if (!buffer) return;
    const text = escapeHtml(buffer);
    if (open === "u") html += `<u>${text}</u>`;
    else if (open === "em") html += `<em>${text}</em>`;
    else html += text;
    buffer = "";
  };

  for (const char of chars) {
    // Underline wins over italic: it carries meaning, italic is cosmetic.
    const style = isUnderlined(char, bands) ? "u" : italicFonts.has(char.font) ? "em" : null;
    if (style !== open) { flush(); open = style; }
    buffer += char.c;
  }
  flush();
  return html;
}

export function charsToHtml(chars, { bands = [], italicFonts = new Set() } = {}) {
  const paragraphs = groupParagraphs(groupLines(chars));
  return paragraphs
    .map((lines) => {
      const merged = lines.flatMap((l, i) =>
        i === 0 ? l.chars : [{ c: " ", font: " ", x0: 0, x1: 0, top: 0, bot: l.baseline }, ...l.chars],
      );
      return renderRuns(merged, bands, italicFonts).replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .map((body) => `<p>${body}</p>`)
    .join("");
}
```

The synthetic space inserted between wrapped lines uses font `" "`, which is never in `italicFonts`, so joining lines can never open a stray `<em>`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/lib/text.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Commit** *(skip if not a git repo)*

```bash
git add tools/lib/text.mjs tools/lib/text.test.mjs
git commit -m "feat: reassemble characters into HTML with underline and italic runs"
```

---

### Task 8: Diagnostic report — Stage 1 checkpoint

**Files:**
- Create: `tools/lib/classify.mjs`
- Create: `tools/diagnose.mjs`
- Test: `tools/lib/classify.test.mjs`

**Interfaces:**
- Consumes: everything from Tasks 1, 3, 4.
- Produces:
  - `classifyQuestion({id, subject, anchors, lines, metadata}): {id, subject, tier, format, flags, correctRaw, choiceCount}` where `tier` is `"clean" | "fallback" | "flagged"`, `format` is `"mcq" | "spr"`, `flags` is an array of short reason strings, and `correctRaw` is the answer text or `null`.
  - `findChoiceLines(lines, anchors): Array<{label: "A"|"B"|"C"|"D", line}>` — choice lines between the `Answer` and `Correct Answer:` anchors, deduplicated and label-sorted. Tasks 9 and 10 both depend on this.
  - `data/diagnostic.json` — `{generatedAt, subjects: {math: {...}, reading: {...}}}`, each holding `total`, `tiers`, `flagCounts`, and a `questions` array of `{id, tier, format, flags}`.

**This task builds no extraction output.** It exists to replace estimates with real numbers before any further effort is spent, and its report is the checkpoint the user reviews.

Flag reasons, all lowercase kebab-case: `no-question-anchor`, `no-correct-answer`, `no-metadata`, `no-rationale`, `mcq-missing-choices`, `spr-with-letter-answer`, `answer-before-question`.

- [ ] **Step 1: Write the failing test**

Create `tools/lib/classify.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQuestion } from "./classify.mjs";

const metadata = { assessment: "SAT", test: "Math", domain: "Algebra", skill: "Linear functions", difficulty: "Hard" };

const base = {
  id: "aaaaaaaa",
  subject: "math",
  metadata,
  anchors: {
    question: { page: 0, y: 100 },
    correct: { page: 0, y: 300, text: "Correct Answer: 500" },
    rationale: { page: 0, y: 320 },
  },
  lines: [],
};

test("a free-response question with a numeric answer is clean", () => {
  const result = classifyQuestion(base);
  assert.equal(result.tier, "clean");
  assert.equal(result.format, "spr");
  assert.equal(result.correctRaw, "500");
  assert.deepEqual(result.flags, []);
});

test("a multiple-choice question with four choices is clean", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, answer: { page: 0, y: 200 } },
    lines: ["A. one", "B. two", "C. three", "D. four"].map((text, i) => ({ page: 0, x: 24, y: 210 + i * 10, text })),
  });
  assert.equal(result.tier, "clean");
  assert.equal(result.format, "mcq");
});

test("flags a multiple-choice question missing choices", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, answer: { page: 0, y: 200 } },
    lines: [{ page: 0, x: 24, y: 210, text: "A. one" }],
  });
  assert.equal(result.tier, "flagged");
  assert.ok(result.flags.includes("mcq-missing-choices"));
});

test("flags a free-response question whose answer is a bare letter", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, correct: { page: 0, y: 300, text: "Correct Answer: D" } },
  });
  assert.equal(result.tier, "flagged");
  assert.ok(result.flags.includes("spr-with-letter-answer"));
});

test("flags a question with no extractable correct answer", () => {
  const result = classifyQuestion({ ...base, anchors: { question: base.anchors.question } });
  assert.equal(result.tier, "flagged");
  assert.ok(result.flags.includes("no-correct-answer"));
});

test("flags a question whose answer block precedes its question", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, answer: { page: 0, y: 50 } },
    lines: ["A. one", "B. two", "C. three", "D. four"].map((text, i) => ({ page: 0, x: 24, y: 55 + i * 5, text })),
  });
  assert.ok(result.flags.includes("answer-before-question"));
  assert.equal(result.tier, "flagged");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/lib/classify.test.mjs`
Expected: FAIL — `Cannot find module './classify.mjs'`.

- [ ] **Step 3: Implement `tools/lib/classify.mjs`**

```js
const CHOICE_RE = /^([A-D])\.\s/;

function before(a, b) {
  if (!a || !b) return false;
  return a.page < b.page || (a.page === b.page && a.y < b.y);
}

export function findChoiceLines(lines, anchors) {
  if (!anchors.answer) return [];
  const stop = anchors.correct;
  const seen = new Map();
  for (const line of lines) {
    if (!before(anchors.answer, line)) continue;
    if (stop && !before(line, stop)) continue;
    const match = CHOICE_RE.exec(line.text.trim());
    if (match && !seen.has(match[1])) seen.set(match[1], line);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, line]) => ({ label, line }));
}

export function classifyQuestion({ id, subject, anchors, lines, metadata }) {
  const flags = [];

  if (!anchors.question) flags.push("no-question-anchor");
  if (!anchors.rationale) flags.push("no-rationale");
  if (!metadata) flags.push("no-metadata");

  const correctRaw = anchors.correct
    ? anchors.correct.text.replace(/^Correct Answer:\s*/, "").trim()
    : null;
  if (!correctRaw) flags.push("no-correct-answer");

  const choices = findChoiceLines(lines, anchors);
  const format = anchors.answer && choices.length >= 2 ? "mcq" : "spr";

  if (anchors.answer && choices.length > 0 && choices.length < 4) flags.push("mcq-missing-choices");
  if (anchors.question && anchors.answer && !before(anchors.question, anchors.answer)) {
    flags.push("answer-before-question");
  }
  if (format === "spr" && correctRaw && /^[A-D]$/.test(correctRaw)) flags.push("spr-with-letter-answer");

  const blocking = flags.some((f) => f !== "no-rationale");
  return {
    id,
    subject,
    tier: blocking ? "flagged" : flags.length ? "fallback" : "clean",
    format,
    flags,
    correctRaw,
    choiceCount: choices.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/lib/classify.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Implement `tools/diagnose.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { MATH_PDF, READING_PDF, openDoc } from "./lib/pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./lib/segment.mjs";
import { parseMetadata } from "./lib/metadata.mjs";
import { classifyQuestion } from "./lib/classify.mjs";

function diagnose(file, subject) {
  const doc = openDoc(file);
  const questions = findSpans(doc).map((span) => {
    const lines = linesInSpan(doc, span);
    const anchors = findAnchors(lines);
    const metadata = parseMetadata(lines, anchors.question?.y);
    const result = classifyQuestion({ id: span.id, subject, anchors, lines, metadata });
    return { ...result, domain: metadata?.domain ?? null, difficulty: metadata?.difficulty ?? null };
  });

  const tiers = { clean: 0, fallback: 0, flagged: 0 };
  const flagCounts = {};
  for (const q of questions) {
    tiers[q.tier]++;
    for (const flag of q.flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  }
  return { total: questions.length, tiers, flagCounts, questions };
}

const subjects = { math: diagnose(MATH_PDF, "math"), reading: diagnose(READING_PDF, "reading") };

fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), "data", "diagnostic.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), subjects }, null, 2),
);

for (const [name, report] of Object.entries(subjects)) {
  console.log(`\n=== ${name.toUpperCase()} (${report.total} questions) ===`);
  console.log(`  clean ${report.tiers.clean} | fallback ${report.tiers.fallback} | flagged ${report.tiers.flagged}`);
  const formats = report.questions.reduce((acc, q) => ({ ...acc, [q.format]: (acc[q.format] ?? 0) + 1 }), {});
  console.log(`  formats: ${JSON.stringify(formats)}`);
  if (Object.keys(report.flagCounts).length) {
    console.log("  flags:");
    for (const [flag, count] of Object.entries(report.flagCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${count.toString().padStart(4)}  ${flag}`);
    }
  }
}
console.log("\nWrote data/diagnostic.json");
```

- [ ] **Step 6: Run the diagnostic**

Run: `npm run diagnose`
Expected: both subjects report `total` 610, and `data/diagnostic.json` is written.

Sanity expectations from the measurements already taken — investigate before proceeding if reality differs sharply:
- Reading should be almost entirely `clean` and 610/610 `mcq`.
- Math should show roughly 375 `mcq` and the remainder `spr`.
- Around 38 Math questions are expected to carry `no-correct-answer`, because their answer is a rendered image rather than text.

- [ ] **Step 7: Report the numbers and STOP for review**

Summarise the tier and flag counts for the user. **This is the plan's checkpoint** — the spec calls for a bad result to force redesign before further effort. Do not begin Task 9 until the numbers have been reviewed.

- [ ] **Step 8: Commit** *(skip if not a git repo)*

```bash
git add tools/lib/classify.mjs tools/lib/classify.test.mjs tools/diagnose.mjs
git commit -m "feat: add tier classification and Stage 1 diagnostic report"
```

---

### Task 9: Reading extraction

**Files:**
- Create: `tools/extract-reading.mjs`
- Test: `tools/extract-reading.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5, 6, 7, 8.
- Produces: `data/reading.json` — `{generatedAt, questions: [...]}` in the spec's data model, and `extractReadingQuestion(doc, span, subjectOpts)` exported for testing.

Region rule: the stem runs from the `Question` anchor to the `Answer` anchor; each choice runs from its own line to the next choice (last one ends at `Correct Answer:`); the rationale runs from the `Rationale` anchor to the end of the span.

- [ ] **Step 1: Write the failing test**

Create `tools/extract-reading.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { READING_PDF, openDoc } from "./lib/pdf.mjs";
import { findSpans } from "./lib/segment.mjs";
import { extractReadingQuestion } from "./extract-reading.mjs";

test("extracts the first Reading question in full", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[0]);

  assert.equal(q.id, "22a41819");
  assert.equal(q.subject, "reading");
  assert.equal(q.format, "mcq");
  assert.equal(q.presentation, "text");
  assert.equal(q.difficulty, "Hard");
  assert.equal(q.domain, "Craft and Structure");
  assert.equal(q.skill, "Words in Context");
  assert.equal(q.correct, "B");

  assert.match(q.stem.html, /^<p>/);
  assert.ok(q.stem.html.includes("Charles S. Johnson"));
  assert.equal(q.choices.length, 4);
  assert.deepEqual(q.choices.map((c) => c.label), ["A", "B", "C", "D"]);
  assert.ok(q.choices[1].html.includes("dogmatic"));
  assert.ok(q.rationale.html.includes("dogmatic"));
});

test("the stem never contains the correct answer line or the rationale", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[0]);
  assert.ok(!q.stem.html.includes("Correct Answer"));
  assert.ok(!q.stem.html.includes("Rationale"));
  for (const choice of q.choices) assert.ok(!choice.html.includes("Correct Answer"));
});

test("recovers the underline on the second Reading question", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[1]);
  assert.equal(q.id, "ca50de52");
  assert.match(q.stem.html, /<u>[^<]*How lifelike are they\?[^<]*<\/u>/);
});

test("renders the italic magazine title in the first question", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[0]);
  assert.match(q.stem.html, /<em>[^<]*Ebony and Topaz[^<]*<\/em>/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/extract-reading.test.mjs`
Expected: FAIL — `Cannot find module './extract-reading.mjs'`.

- [ ] **Step 3: Implement `tools/extract-reading.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { READING_PDF, openDoc, pageChars, renderGray } from "./lib/pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./lib/segment.mjs";
import { parseMetadata } from "./lib/metadata.mjs";
import { detectUnderlines } from "./lib/underline.mjs";
import { italicFontsForPage } from "./lib/fontstyle.mjs";
import { charsToHtml } from "./lib/text.mjs";
import { classifyQuestion, findChoiceLines } from "./lib/classify.mjs";

const DETECT_SCALE = 3;
const pageCache = new Map();

function pageData(doc, index) {
  if (!pageCache.has(index)) {
    const page = doc.loadPage(index);
    const chars = pageChars(page);
    pageCache.set(index, {
      chars,
      bands: detectUnderlines(renderGray(page, DETECT_SCALE), DETECT_SCALE),
      italicFonts: italicFontsForPage(page, chars),
    });
  }
  return pageCache.get(index);
}

// Collect characters between two document positions, each {page, y}, exclusive of the end.
function charsBetween(doc, span, from, to) {
  const collected = [];
  let italicFonts = new Set();
  let bands = [];
  for (let p = span.startPage; p <= span.endPage; p++) {
    const { chars, bands: pageBands, italicFonts: pageItalics } = pageData(doc, p);
    const after = (c) => p > from.page || (p === from.page && c.top >= from.y);
    const before = (c) => !to || p < to.page || (p === to.page && c.bot <= to.y);
    const kept = chars.filter((c) => after(c) && before(c));
    if (kept.length) {
      collected.push(...kept);
      bands = bands.concat(pageBands);
      italicFonts = new Set([...italicFonts, ...pageItalics]);
    }
  }
  return { chars: collected, bands, italicFonts };
}

const toHtml = (region) =>
  charsToHtml(region.chars, { bands: region.bands, italicFonts: region.italicFonts });

// A question missing its anchors cannot be located in the page at all. Return a
// flagged shell rather than throwing, so one bad question never aborts the run.
function flaggedShell(span, subject, verdict, metadata, extra) {
  return {
    id: span.id,
    subject,
    domain: metadata?.domain ?? null,
    skill: metadata?.skill ?? null,
    difficulty: metadata?.difficulty ?? null,
    format: verdict.format,
    correct: verdict.correctRaw,
    tier: "flagged",
    flags: [...new Set([...verdict.flags, "no-question-anchor"])],
    source: { pages: [span.startPage, span.endPage] },
    ...extra,
  };
}

export function extractReadingQuestion(doc, span) {
  const lines = linesInSpan(doc, span);
  const anchors = findAnchors(lines);
  const metadata = parseMetadata(lines, anchors.question?.y);
  const verdict = classifyQuestion({ id: span.id, subject: "reading", anchors, lines, metadata });

  if (!anchors.question || !anchors.correct) {
    return flaggedShell(span, "reading", verdict, metadata, {
      presentation: "text",
      stem: { html: "" },
      choices: [],
      rationale: { html: "" },
    });
  }

  const choiceLines = findChoiceLines(lines, anchors);

  const stemStart = { page: anchors.question.page, y: anchors.question.y + 10 };
  const stemEnd = anchors.answer ?? anchors.correct;

  const choices = choiceLines.map(({ label, line }, i) => {
    const next = choiceLines[i + 1]?.line;
    const end = next ? { page: next.page, y: next.y } : { page: anchors.correct.page, y: anchors.correct.y };
    return { label, html: toHtml(charsBetween(doc, span, { page: line.page, y: line.y }, end)) };
  });

  const rationale = anchors.rationale
    ? toHtml(charsBetween(doc, span, { page: anchors.rationale.page, y: anchors.rationale.y + 10 }, null))
    : "";

  return {
    id: span.id,
    subject: "reading",
    domain: metadata?.domain ?? null,
    skill: metadata?.skill ?? null,
    difficulty: metadata?.difficulty ?? null,
    format: verdict.format,
    presentation: "text",
    stem: { html: toHtml(charsBetween(doc, span, stemStart, stemEnd)) },
    choices,
    correct: verdict.correctRaw,
    rationale: { html: rationale },
    tier: verdict.tier,
    flags: verdict.flags,
    source: { pages: [span.startPage, span.endPage] },
  };
}

if (import.meta.filename === process.argv[1]) {
  const doc = openDoc(READING_PDF);
  const questions = findSpans(doc).map((span) => {
    pageCache.clear();
    return extractReadingQuestion(doc, span);
  });
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(
    path.join("data", "reading.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), questions }, null, 2),
  );
  console.log(`Wrote data/reading.json (${questions.length} questions)`);
}
```

Choice text strips its own `A. ` prefix at render time in the app, not here, so the raw source stays inspectable.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/extract-reading.test.mjs`
Expected: PASS, 4/4.

- [ ] **Step 5: Run the full extraction**

Run: `node tools/extract-reading.mjs`
Expected: `Wrote data/reading.json (610 questions)`.

- [ ] **Step 6: Commit** *(skip if not a git repo)*

```bash
git add tools/extract-reading.mjs tools/extract-reading.test.mjs
git commit -m "feat: extract Reading questions to HTML with underlines and italics"
```

---

### Task 10: Math crop extraction

**Files:**
- Create: `tools/extract-math.mjs`
- Test: `tools/extract-math.test.mjs`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 4, 8.
- Produces: `data/math.json` and `images/math/<id>-<part>.png`; exports `mathRegions(doc, span)` and `extractMathQuestion(doc, span, {write})`.

`mathRegions` returns `{stem: Region[], choices: {label, regions}[], rationale: Region[]}` where a `Region` is `{page, y0, y1}`. A section crossing a page boundary yields one region per page.

- [ ] **Step 1: Write the failing test**

Create `tools/extract-math.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { MATH_PDF, openDoc } from "./lib/pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./lib/segment.mjs";
import { mathRegions, extractMathQuestion } from "./extract-math.mjs";

test("no stem or choice region reaches the Correct Answer line", () => {
  const doc = openDoc(MATH_PDF);
  for (const span of findSpans(doc).slice(0, 40)) {
    const anchors = findAnchors(linesInSpan(doc, span));
    if (!anchors.correct) continue;
    const regions = mathRegions(doc, span);
    const guarded = [...regions.stem, ...regions.choices.flatMap((c) => c.regions)];
    for (const r of guarded) {
      if (r.page < anchors.correct.page) continue;
      assert.ok(
        r.page > anchors.correct.page ? false : r.y1 <= anchors.correct.y,
        `${span.id}: region on page ${r.page} ends at ${r.y1}, answer line at ${anchors.correct.y}`,
      );
    }
  }
});

test("the first math question yields a stem image and a numeric answer", () => {
  const doc = openDoc(MATH_PDF);
  const q = extractMathQuestion(doc, findSpans(doc)[0], { write: false });
  assert.equal(q.id, "590d662d");
  assert.equal(q.subject, "math");
  assert.equal(q.presentation, "image");
  assert.equal(q.format, "spr");
  assert.equal(q.correct, "500");
  assert.equal(q.domain, "Algebra");
  assert.ok(q.stem.images.length >= 1);
  assert.ok(q.stem.images.every((p) => p.startsWith("images/math/590d662d-")));
});

test("a multiple-choice math question produces one image per choice", () => {
  const doc = openDoc(MATH_PDF);
  const span = findSpans(doc).find((s) => s.id === "af2ba762");
  const q = extractMathQuestion(doc, span, { write: false });
  assert.equal(q.format, "mcq");
  assert.equal(q.correct, "D");
  assert.equal(q.choices.length, 4);
  for (const choice of q.choices) assert.ok(choice.images.length >= 1);
});

test("questions whose answer is an image are flagged for self-marking", () => {
  const doc = openDoc(MATH_PDF);
  const spans = findSpans(doc);
  const withoutText = spans.filter((span) => !findAnchors(linesInSpan(doc, span)).correct);
  assert.ok(withoutText.length > 0, "expected image-answer questions to exist");
  const q = extractMathQuestion(doc, withoutText[0], { write: false });
  assert.equal(q.correct, null);
  assert.equal(q.selfMarked, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/extract-math.test.mjs`
Expected: FAIL — `Cannot find module './extract-math.mjs'`.

- [ ] **Step 3: Implement `tools/extract-math.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { MATH_PDF, openDoc, renderGray } from "./lib/pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./lib/segment.mjs";
import { parseMetadata } from "./lib/metadata.mjs";
import { classifyQuestion, findChoiceLines } from "./lib/classify.mjs";
import { cropToPng } from "./lib/png.mjs";

const CROP_SCALE = 2.5;
const HEADING_DROP = 10;   // clear the section heading itself
const ANSWER_GUARD = 4;    // stay this far above the Correct Answer line
const IMAGE_DIR = path.join("images", "math");

// Split [from, to) into one region per page it covers.
function regionsBetween(doc, span, from, to) {
  const regions = [];
  const lastPage = to ? to.page : span.endPage;
  for (let page = from.page; page <= lastPage; page++) {
    const bounds = doc.loadPage(page).getBounds();
    const y0 = page === from.page ? from.y : bounds[1];
    const y1 = to && page === to.page ? to.y : bounds[3];
    if (y1 - y0 > 2) regions.push({ page, y0, y1 });
  }
  return regions;
}

export function mathRegions(doc, span) {
  const lines = linesInSpan(doc, span);
  const anchors = findAnchors(lines);
  const choiceLines = findChoiceLines(lines, anchors);

  const guard = anchors.correct
    ? { page: anchors.correct.page, y: anchors.correct.y - ANSWER_GUARD }
    : anchors.rationale ?? null;

  const stemStart = { page: anchors.question.page, y: anchors.question.y + HEADING_DROP };
  const stemEnd = anchors.answer ? { page: anchors.answer.page, y: anchors.answer.y } : guard;

  const choices = choiceLines.map(({ label, line }, i) => {
    const next = choiceLines[i + 1]?.line;
    const end = next ? { page: next.page, y: next.y } : guard;
    return { label, regions: regionsBetween(doc, span, { page: line.page, y: line.y }, end) };
  });

  const rationale = anchors.rationale
    ? regionsBetween(doc, span, { page: anchors.rationale.page, y: anchors.rationale.y + HEADING_DROP }, null)
    : [];

  return { stem: regionsBetween(doc, span, stemStart, stemEnd), choices, rationale };
}

function writeCrops(doc, id, part, regions, write) {
  const files = [];
  regions.forEach((region, i) => {
    const bounds = doc.loadPage(region.page).getBounds();
    const img = renderGray(doc.loadPage(region.page), CROP_SCALE, [bounds[0], region.y0, bounds[2], region.y1]);
    const png = cropToPng(img);
    if (!png) return;
    const file = path.posix.join("images", "math", `${id}-${part}${i ? `-${i}` : ""}.png`);
    if (write) {
      fs.mkdirSync(IMAGE_DIR, { recursive: true });
      fs.writeFileSync(file, png);
    }
    files.push(file);
  });
  return files;
}

export function extractMathQuestion(doc, span, { write = true } = {}) {
  const lines = linesInSpan(doc, span);
  const anchors = findAnchors(lines);
  const metadata = parseMetadata(lines, anchors.question?.y);
  const verdict = classifyQuestion({ id: span.id, subject: "math", anchors, lines, metadata });

  // Without a Question anchor there is no region to crop. Flag it instead of throwing,
  // so a single malformed question never aborts a 610-question run.
  if (!anchors.question) {
    return {
      id: span.id,
      subject: "math",
      domain: metadata?.domain ?? null,
      skill: metadata?.skill ?? null,
      difficulty: metadata?.difficulty ?? null,
      format: verdict.format,
      presentation: "image",
      stem: { images: [] },
      choices: [],
      correct: verdict.correctRaw,
      selfMarked: false,
      rationale: { images: [] },
      tier: "flagged",
      flags: [...new Set([...verdict.flags, "no-question-anchor"])],
      source: { pages: [span.startPage, span.endPage] },
    };
  }

  const regions = mathRegions(doc, span);

  return {
    id: span.id,
    subject: "math",
    domain: metadata?.domain ?? null,
    skill: metadata?.skill ?? null,
    difficulty: metadata?.difficulty ?? null,
    format: verdict.format,
    presentation: "image",
    stem: { images: writeCrops(doc, span.id, "stem", regions.stem, write) },
    choices: regions.choices.map((c) => ({
      label: c.label,
      images: writeCrops(doc, span.id, `choice-${c.label}`, c.regions, write),
    })),
    correct: verdict.correctRaw,
    selfMarked: verdict.correctRaw === null,
    rationale: { images: writeCrops(doc, span.id, "rationale", regions.rationale, write) },
    tier: verdict.correctRaw === null ? "fallback" : verdict.tier,
    flags: verdict.flags,
    source: { pages: [span.startPage, span.endPage] },
  };
}

if (import.meta.filename === process.argv[1]) {
  const doc = openDoc(MATH_PDF);
  const spans = findSpans(doc);
  const questions = [];
  for (const [i, span] of spans.entries()) {
    questions.push(extractMathQuestion(doc, span));
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${spans.length}`);
  }
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(
    path.join("data", "math.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), questions }, null, 2),
  );
  console.log(`Wrote data/math.json (${questions.length} questions)`);
}
```

Image-answer questions are `fallback`, not `flagged`: they are fully usable, they just cannot be auto-graded, so they stay in the pool and are self-marked.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/extract-math.test.mjs`
Expected: PASS, 4/4. The leakage test is the important one.

- [ ] **Step 5: Run the full extraction**

Run: `node tools/extract-math.mjs`
Expected: progress every 50 questions, then `Wrote data/math.json (610 questions)`. Expect this to take several minutes and produce roughly 25MB under `images/math/`.

- [ ] **Step 6: Spot-check three crops visually**

Run: `node -e "const d=require('./data/math.json');console.log(d.questions.slice(0,3).map(q=>q.stem.images).flat().join('\n'))"`

Open the listed PNGs. Confirm each shows the question with its equations and figures, and that **no crop shows the words "Correct Answer" or any rationale text**. A passing test is not sufficient here; look at the images.

- [ ] **Step 7: Commit** *(skip if not a git repo)*

```bash
git add tools/extract-math.mjs tools/extract-math.test.mjs
git commit -m "feat: extract Math questions as answer-safe grayscale crops"
```

---

### Task 11: Unified extraction entry point with resumability

**Files:**
- Create: `tools/extract.mjs`
- Test: `tools/extract.test.mjs`

**Interfaces:**
- Consumes: `extractReadingQuestion` (Task 9), `extractMathQuestion` (Task 10), `findSpans` (Task 3).
- Produces: `planWork(spans, previous, {force, only, imageSize}): {reuse: Question[], compute: Span[]}` — decides per question whether prior output can be kept.

This is the `npm run extract` target referenced by `package.json`, and it delivers the spec's resumability requirement: a re-run reprocesses only what is missing, so an interrupted extraction resumes instead of starting over.

Flags: `--force` recomputes everything, `--only <id>` recomputes one question and keeps the rest, `--reading` / `--math` restrict to one subject.

- [ ] **Step 1: Write the failing test**

Create `tools/extract.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { planWork } from "./extract.mjs";

const spans = [{ id: "a" }, { id: "b" }, { id: "c" }];
const done = (id) => ({
  id, stem: { images: [`images/math/${id}-stem.png`] }, choices: [], rationale: { images: [] },
});
const previous = { questions: [done("a"), done("b"), done("c")] };
const present = () => 4096;

test("computes everything when there is no previous run", () => {
  const { reuse, compute } = planWork(spans, null, { imageSize: present });
  assert.equal(reuse.length, 0);
  assert.deepEqual(compute.map((s) => s.id), ["a", "b", "c"]);
});

test("reuses every question whose images are all present", () => {
  const { reuse, compute } = planWork(spans, previous, { imageSize: present });
  assert.equal(compute.length, 0);
  assert.deepEqual(reuse.map((q) => q.id), ["a", "b", "c"]);
});

test("recomputes only the question whose image went missing", () => {
  const imageSize = (file) => (file.includes("b-") ? 0 : 4096);
  const { reuse, compute } = planWork(spans, previous, { imageSize });
  assert.deepEqual(compute.map((s) => s.id), ["b"]);
  assert.deepEqual(reuse.map((q) => q.id), ["a", "c"]);
});

test("--force recomputes everything", () => {
  const { reuse, compute } = planWork(spans, previous, { force: true, imageSize: present });
  assert.equal(reuse.length, 0);
  assert.equal(compute.length, 3);
});

test("--only recomputes one question and keeps the others", () => {
  const { reuse, compute } = planWork(spans, previous, { only: "b", imageSize: present });
  assert.deepEqual(compute.map((s) => s.id), ["b"]);
  assert.deepEqual(reuse.map((q) => q.id), ["a", "c"]);
});

test("a text-only question with no images is reusable", () => {
  const textOnly = { questions: [{ id: "a", stem: { html: "<p>x</p>" }, choices: [], rationale: { html: "" } }] };
  const { reuse } = planWork([{ id: "a" }], textOnly, { imageSize: () => 0 });
  assert.deepEqual(reuse.map((q) => q.id), ["a"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/extract.test.mjs`
Expected: FAIL — `Cannot find module './extract.mjs'`.

- [ ] **Step 3: Implement `tools/extract.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { MATH_PDF, READING_PDF, openDoc } from "./lib/pdf.mjs";
import { findSpans } from "./lib/segment.mjs";
import { extractReadingQuestion } from "./extract-reading.mjs";
import { extractMathQuestion } from "./extract-math.mjs";

const MIN_IMAGE_BYTES = 200;

function imagesOf(question) {
  return [
    ...(question.stem?.images ?? []),
    ...(question.choices ?? []).flatMap((c) => c.images ?? []),
    ...(question.rationale?.images ?? []),
  ];
}

export function planWork(spans, previous, { force = false, only = null, imageSize = () => 4096 } = {}) {
  const byId = new Map((previous?.questions ?? []).map((q) => [q.id, q]));
  const reuse = [];
  const compute = [];

  for (const span of spans) {
    const prev = byId.get(span.id);

    if (only) {
      if (span.id === only) compute.push(span);
      else if (prev) reuse.push(prev);
      continue;
    }
    if (force || !prev) {
      compute.push(span);
      continue;
    }
    if (imagesOf(prev).every((file) => imageSize(file) > MIN_IMAGE_BYTES)) reuse.push(prev);
    else compute.push(span);
  }
  return { reuse, compute };
}

function run(subject, file, extractOne, options) {
  const outFile = path.join("data", `${subject}.json`);
  const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : null;
  const doc = openDoc(file);
  const spans = findSpans(doc);

  const imageSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const { reuse, compute } = planWork(spans, previous, { ...options, imageSize });
  console.log(`${subject}: reusing ${reuse.length}, computing ${compute.length}`);

  const fresh = [];
  for (const [i, span] of compute.entries()) {
    fresh.push(extractOne(doc, span));
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${compute.length}`);
  }

  const order = new Map(spans.map((s, i) => [s.id, i]));
  const questions = [...reuse, ...fresh].sort((a, b) => order.get(a.id) - order.get(b.id));

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), questions }, null, 2));
  console.log(`Wrote ${outFile} (${questions.length} questions)`);
}

if (import.meta.filename === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const options = { force: args.includes("--force"), only: valueOf("--only") };

  const wantReading = !args.includes("--math");
  const wantMath = !args.includes("--reading");

  if (wantReading) run("reading", READING_PDF, extractReadingQuestion, options);
  if (wantMath) run("math", MATH_PDF, extractMathQuestion, options);
}
```

Note the `path.resolve(process.argv[1])` comparison: `extract-reading.mjs` and `extract-math.mjs` use the same guard, and it must not fire when they are imported here.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/extract.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Verify resumability against the real data**

Run: `npm run extract`
Expected: on a second run, both subjects report `reusing 610, computing 0` and finish in seconds.

Run: `npm run extract -- --only 590d662d`
Expected: `computing 1`, and the other 609 questions are preserved unchanged.

- [ ] **Step 6: Commit** *(skip if not a git repo)*

```bash
git add tools/extract.mjs tools/extract.test.mjs
git commit -m "feat: add resumable unified extraction entry point"
```

---

### Task 12: Integrity gate

**Files:**
- Create: `tools/verify.mjs`
- Test: `tools/verify.test.mjs`

**Interfaces:**
- Consumes: `data/reading.json`, `data/math.json`, `images/`.
- Produces: `verifyDataset({reading, math, imageSize, expectedCount?}): {ok, failures, summary}` where `imageSize(file) => number` returns a file's size in bytes (0 when absent); the CLI exits non-zero on failure.

Checks, from the spec:
1. 610 questions per subject, all ids unique.
2. Every `clean` or `fallback` question has a correct answer, unless it is `selfMarked`.
3. Every referenced image exists and exceeds 200 bytes.
4. Every Reading stem containing "underlined" has at least one `<u>` element.
5. No stem or choice HTML contains `Correct Answer`.
6. Tier counts reported per subject.

- [ ] **Step 1: Write the failing test**

Create `tools/verify.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDataset } from "./verify.mjs";

const readingQuestion = (over = {}) => ({
  id: "r1", subject: "reading", tier: "clean", format: "mcq", presentation: "text",
  stem: { html: "<p>plain</p>" }, choices: [], correct: "B", rationale: { html: "" }, ...over,
});
const mathQuestion = (over = {}) => ({
  id: "m1", subject: "math", tier: "clean", format: "spr", presentation: "image",
  stem: { images: ["images/math/m1-stem.png"] }, choices: [], correct: "5",
  rationale: { images: [] }, ...over,
});

const always = () => 4096;

test("passes a well-formed dataset", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion()] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test("fails when a stem leaks the correct answer", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion({ stem: { html: "<p>Correct Answer: B</p>" } })] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("answer-leak")));
});

test("fails when a referenced image is missing or empty", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion()] },
    math: { questions: [mathQuestion()] },
    imageSize: () => 0,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("missing-image")));
});

test("fails when an underline question lost its underline", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion({ stem: { html: "<p>the underlined portion</p>" } })] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("lost-underline")));
});

test("fails when the question count is wrong", () => {
  const result = verifyDataset({
    reading: { questions: [] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("count")));
});

test("allows a self-marked question to have no correct answer", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion()] },
    math: { questions: [mathQuestion({ correct: null, selfMarked: true, tier: "fallback" })] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tools/verify.test.mjs`
Expected: FAIL — `Cannot find module './verify.mjs'`.

- [ ] **Step 3: Implement `tools/verify.mjs`**

```js
import fs from "node:fs";
import path from "node:path";

const EXPECTED = 610;

function imagesOf(question) {
  return [
    ...(question.stem.images ?? []),
    ...question.choices.flatMap((c) => c.images ?? []),
    ...(question.rationale?.images ?? []),
  ];
}

function htmlOf(question) {
  return [question.stem.html ?? "", ...question.choices.map((c) => c.html ?? "")];
}

export function verifyDataset({ reading, math, imageSize, expectedCount = EXPECTED }) {
  const failures = [];
  const summary = {};

  for (const [name, dataset] of Object.entries({ reading, math })) {
    const questions = dataset.questions;
    if (questions.length !== expectedCount) {
      failures.push(`${name}: count ${questions.length}, expected ${expectedCount}`);
    }
    const ids = new Set(questions.map((q) => q.id));
    if (ids.size !== questions.length) failures.push(`${name}: duplicate ids`);

    const tiers = { clean: 0, fallback: 0, flagged: 0 };
    for (const q of questions) {
      tiers[q.tier] = (tiers[q.tier] ?? 0) + 1;
      if (q.tier === "flagged") continue;

      if (!q.correct && !q.selfMarked) failures.push(`${name}/${q.id}: no-correct-answer`);

      for (const html of htmlOf(q)) {
        if (html.includes("Correct Answer")) failures.push(`${name}/${q.id}: answer-leak`);
      }
      for (const file of imagesOf(q)) {
        if (imageSize(file) <= 200) failures.push(`${name}/${q.id}: missing-image ${file}`);
      }
      if (name === "reading" && /\bunderlined\b/.test(q.stem.html ?? "") && !/<u>/.test(q.stem.html)) {
        failures.push(`${name}/${q.id}: lost-underline`);
      }
    }
    summary[name] = tiers;
  }

  return { ok: failures.length === 0, failures, summary };
}

if (import.meta.filename === process.argv[1]) {
  const load = (f) => JSON.parse(fs.readFileSync(path.join("data", f), "utf8"));
  const imageSize = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };

  const result = verifyDataset({ reading: load("reading.json"), math: load("math.json"), imageSize });

  for (const [subject, tiers] of Object.entries(result.summary)) {
    console.log(`${subject}: clean ${tiers.clean} | fallback ${tiers.fallback} | flagged ${tiers.flagged}`);
  }
  if (result.ok) {
    console.log(`\nPASS - dataset verified`);
  } else {
    console.error(`\nFAIL - ${result.failures.length} problem(s):`);
    for (const failure of result.failures.slice(0, 50)) console.error(`  ${failure}`);
    if (result.failures.length > 50) console.error(`  ...and ${result.failures.length - 50} more`);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tools/verify.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Run the gate against the real dataset**

Run: `npm run verify`
Expected: tier counts per subject, then `PASS - dataset verified`.

If it fails, do not weaken a check to make it pass. Fix the extraction, or reclassify the offending questions as `flagged` so they leave the pool honestly.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: every test file passes.

- [ ] **Step 7: Commit** *(skip if not a git repo)*

```bash
git add tools/verify.mjs tools/verify.test.mjs
git commit -m "feat: add dataset integrity gate with answer-leak detection"
```

---

## Deferred to the app plan

These spec items are deliberately **not** in this plan, because they belong to the consuming application rather than the extraction pipeline:

- Merging `data/overrides.json` over generated data at load time (`bank.js`).
- The review screen that writes corrections into `overrides.json`, and the `POST /api/overrides` endpoint that persists them.
- `answers.js` free-response normalization — it is app-side and unused by extraction.
- The static server, launcher, filters, no-repeat shuffle, timed sets, and progress tracking.

`.gitignore` already tracks `data/overrides.json` while ignoring the other generated data, so the app plan can assume that file is the durable one.

## Completion criteria

This plan is done when:

1. `npm test` passes across all twelve test files.
2. `npm run verify` reports PASS.
3. `data/reading.json` and `data/math.json` each hold 610 questions.
4. `npm run extract` on a second run reports `computing 0` for both subjects.
5. Three Math crops have been **opened and looked at** (Task 10, Step 6), confirming no answer leakage — a passing test alone does not satisfy this.
6. Tier and flag counts have been reported to the user.

The app is planned separately, once these numbers are real.
