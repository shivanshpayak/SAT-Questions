import { test } from "node:test";
import assert from "node:assert/strict";
import { READING_PDF, openDoc, renderGray } from "./pdf.mjs";
import { detectUnderlines } from "./underline.mjs";

// Fixtures are built in device pixels at scale 3, matching how pages are
// actually rendered: a value in points occupies three pixels.
const S = 3;

function blank(widthPt, heightPt) {
  const width = widthPt * S, height = heightPt * S;
  return { pixels: new Uint8Array(width * height).fill(255), width, height, stride: width, ox: 0, oy: 0 };
}

function drawRule(img, { yPt, x0Pt, x1Pt, rows = 2 }) {
  for (let r = 0; r < rows; r++) {
    const y = Math.round(yPt * S) + r;
    for (let x = Math.round(x0Pt * S); x < Math.round(x1Pt * S); x++) img.pixels[y * img.stride + x] = 0;
  }
}

test("merges runs split by a descender into one band", () => {
  // Reproduces the real page-1 shape: a long run and a short one 3pt later.
  const img = blank(200, 10);
  drawRule(img, { yPt: 5, x0Pt: 18, x1Pt: 97 });
  drawRule(img, { yPt: 5, x0Pt: 100, x1Pt: 110 });

  const bands = detectUnderlines(img, S);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].x0, 18);
  assert.equal(bands[0].x1, 110);
});

test("drops a fragment too narrow to be a rule, keeping the main band", () => {
  // A 2pt speck (6px) is below minRunPx and is not treated as underline ink.
  const img = blank(200, 10);
  drawRule(img, { yPt: 5, x0Pt: 18, x1Pt: 97 });
  drawRule(img, { yPt: 5, x0Pt: 120, x1Pt: 122 });

  const bands = detectUnderlines(img, S);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].x1, 97, "the speck must not extend the band");
});

test("rejects thick bands such as table shading", () => {
  const img = blank(120, 30);
  drawRule(img, { yPt: 5, x0Pt: 10, x1Pt: 110, rows: 20 });
  assert.deepEqual(detectUnderlines(img, S), []);
});

test("rejects a rule shorter than the minimum underline width", () => {
  // 10pt wide: thin enough to be a rule, too short to be an underline.
  const img = blank(120, 10);
  drawRule(img, { yPt: 5, x0Pt: 40, x1Pt: 50 });
  assert.deepEqual(detectUnderlines(img, S), []);
});

test("finds exactly one underline on Reading page 1", () => {
  const img = renderGray(openDoc(READING_PDF).loadPage(1), 3);
  const bands = detectUnderlines(img, 3);
  assert.equal(bands.length, 1, "the 'How lifelike are they?' underline");
  assert.ok(Math.abs(bands[0].y - 150.7) < 1.5, `unexpected y ${bands[0].y}`);
  assert.ok(bands[0].x0 < 20 && bands[0].x1 > 105, `unexpected span ${bands[0].x0}..${bands[0].x1}`);
});
