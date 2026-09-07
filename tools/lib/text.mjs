const UNDERLINE_REACH_PT = 11;
const BASELINE_TOLERANCE_PT = 2;
const PARAGRAPH_GAP_FACTOR = 1.6;

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = (s) => s.replace(/[&<>]/g, (ch) => ESCAPES[ch]);

export function isUnderlined(char, bands) {
  // Midpoint containment, not any-overlap: a rule drawn under a phrase
  // routinely overhangs the neighbouring glyph by a fraction of a point, and
  // any-overlap would drag those neighbours into the underlined run.
  const mid = (char.x0 + char.x1) / 2;
  return bands.some(
    (b) =>
      char.bot <= b.y + BASELINE_TOLERANCE_PT &&
      char.bot >= b.y - UNDERLINE_REACH_PT &&
      mid > b.x0 &&
      mid < b.x1,
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
  // Estimate normal leading from the lower quartile, not the median: a
  // paragraph break only ever makes a gap larger, so the small gaps are the
  // honest sample. A median lets the breaks inflate the very number meant to
  // detect them, which fails outright when breaks are common.
  const typical = sorted.length ? sorted[Math.floor(sorted.length * 0.25)] : 0;
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

const KERNING_SPACE_RATIO = 0.5;

// These PDFs emit a real word space as a glyph ~2.2pt wide, but also emit a
// hair-thin ~0.2pt space for kerned pairs such as "rt" and "ny", which would
// render as "effor t" and "man y". Genuine spaces outnumber the artifacts, so
// the median space width identifies the real ones and anything well under it
// is dropped. An absolute cutoff would not survive a change of font size.
export function dropKerningSpaces(chars) {
  const widths = chars.filter((c) => c.c === " ").map((c) => c.x1 - c.x0).sort((a, b) => a - b);
  if (!widths.length) return chars;
  const median = widths[Math.floor(widths.length / 2)];
  if (!(median > 0)) return chars;
  const minimum = median * KERNING_SPACE_RATIO;
  return chars.filter((c) => c.c !== " " || c.x1 - c.x0 >= minimum);
}

export function charsToHtml(chars, { bands = [], italicFonts = new Set() } = {}) {
  // Runs before grouping, so the synthetic spaces that join wrapped lines are
  // added later and cannot be filtered out here.
  const paragraphs = groupParagraphs(groupLines(dropKerningSpaces(chars)));
  return paragraphs
    .map((lines) => {
      // The joining space uses font " ", which is never in italicFonts, so
      // wrapping a line can never open a stray <em>.
      const merged = lines.flatMap((l, i) =>
        i === 0 ? l.chars : [{ c: " ", font: " ", x0: 0, x1: 0, top: 0, bot: l.baseline }, ...l.chars],
      );
      return renderRuns(merged, bands, italicFonts).replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .map((body) => `<p>${body}</p>`)
    .join("");
}
