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

test("drops hair-thin kerning spaces that split words", () => {
  // Real word spaces in these PDFs are ~2.2pt; kerning artifacts inside a
  // word are ~0.2pt and would otherwise render as "effor t".
  const chars = [];
  let x = 10;
  const push = (c, width) => { chars.push({ c, font: "body", x0: x, x1: x + width, top: 92, bot: 100 }); x += width; };
  for (const c of "effor") push(c, 4);
  push(" ", 0.2);            // kerning artifact
  push("t", 3);
  push(" ", 2.2);            // real word space
  for (const c of "people") push(c, 4);

  assert.equal(charsToHtml(chars, { bands: [], italicFonts: new Set() }), "<p>effort people</p>");
});

test("returns an empty string when there are no characters", () => {
  assert.equal(charsToHtml([], { bands: [], italicFonts: new Set() }), "");
});
