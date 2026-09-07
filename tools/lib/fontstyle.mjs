import { renderGray } from "./pdf.mjs";

// Calibrated by tools/calibrate-slant.mjs on Reading page 0, where the four
// upright fonts all measure exactly 0 and the known italic measures 0.068.
// Set at the midpoint; the margin either side is large.
const ITALIC_THRESHOLD = 0.03;
const SAMPLE_SCALE = 12;
const SAMPLE_CHARS = 8;
const INK = 200;

// Only letters whose LEFT EDGE is a vertical stem. Measuring the left edge
// rather than the ink centroid is what makes this shape-independent: a
// centroid measure cannot tell an italic stem from the bowl of a 'b'.
const STEM = /[lhkbIHTFEBDPRN]/;

export function measureSlant(img) {
  const { pixels, width, height, stride } = img;

  const edges = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[y * stride + x] < INK) { edges.push(x); break; }
    }
    if (edges.length <= y) edges.push(-1);
  }

  const rows = edges.filter((x) => x >= 0);
  if (rows.length < 4) return null;

  const third = Math.max(1, Math.floor(rows.length / 3));
  const mean = (a) => a.reduce((sum, x) => sum + x, 0) / a.length;
  // Rows run top to bottom, so a stem leaning right sits further right at the top.
  return (mean(rows.slice(0, third)) - mean(rows.slice(-third))) / width;
}

export function slantForFont(page, chars, fontName) {
  const samples = chars
    .filter((c) => c.font === fontName && STEM.test(c.c) && c.x1 - c.x0 > 1 && c.bot - c.top > 3)
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
