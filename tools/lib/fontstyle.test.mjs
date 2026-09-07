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
