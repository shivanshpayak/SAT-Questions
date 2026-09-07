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
