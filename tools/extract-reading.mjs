import fs from "node:fs";
import path from "node:path";
import { READING_PDF, openDoc, pageChars, renderGray, withPage } from "./lib/pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./lib/segment.mjs";
import { parseMetadata } from "./lib/metadata.mjs";
import { detectUnderlines } from "./lib/underline.mjs";
import { italicFontsForPage } from "./lib/fontstyle.mjs";
import { charsToHtml } from "./lib/text.mjs";
import { classifyQuestion, findChoiceLines } from "./lib/classify.mjs";

const DETECT_SCALE = 3;
const CACHE_PAGES = 4;

// Page-local y coordinates repeat on every page, so a band on page 3 would
// match a glyph at the same height on page 4. Offsetting each page's
// coordinates keeps regions that span a page break unambiguous, and makes
// line grouping order correctly across the boundary.
const PAGE_STRIDE = 10000;

// Questions are visited in page order, so a small LRU gives a near-perfect hit
// rate. Caching every page instead would hold ~2M character objects.
const pageCache = new Map();

function pageData(doc, index) {
  const hit = pageCache.get(index);
  if (hit) {
    pageCache.delete(index);
    pageCache.set(index, hit);
    return hit;
  }
  // Everything derived here is plain JS, so the page is released immediately.
  const data = withPage(doc, index, (page) => {
    const chars = pageChars(page);
    return {
      chars,
      bands: detectUnderlines(renderGray(page, DETECT_SCALE), DETECT_SCALE),
      italicFonts: italicFontsForPage(page, chars),
    };
  });
  pageCache.set(index, data);
  if (pageCache.size > CACHE_PAGES) pageCache.delete(pageCache.keys().next().value);
  return data;
}

// Collect characters between two document positions, each {page, y}.
function regionChars(doc, span, from, to) {
  const chars = [];
  const bands = [];
  let italicFonts = new Set();

  for (let p = Math.max(span.startPage, from.page); p <= span.endPage; p++) {
    if (to && p > to.page) break;

    const data = pageData(doc, p);
    const lo = p === from.page ? from.y : -Infinity;
    const hi = to && p === to.page ? to.y : Infinity;

    const kept = data.chars.filter((c) => c.top >= lo && c.bot <= hi);
    if (!kept.length) continue;

    const offset = p * PAGE_STRIDE;
    for (const c of kept) chars.push({ ...c, top: c.top + offset, bot: c.bot + offset });
    for (const b of data.bands) {
      if (b.y >= lo && b.y <= hi + 12) bands.push({ ...b, y: b.y + offset });
    }
    italicFonts = new Set([...italicFonts, ...data.italicFonts]);
  }
  return { chars, bands, italicFonts };
}

const toHtml = (region) =>
  charsToHtml(region.chars, { bands: region.bands, italicFonts: region.italicFonts });

function flaggedShell(span, verdict, metadata) {
  return {
    id: span.id,
    subject: "reading",
    domain: metadata?.domain ?? null,
    skill: metadata?.skill ?? null,
    difficulty: metadata?.difficulty ?? null,
    format: verdict.format,
    presentation: "text",
    stem: { html: "" },
    choices: [],
    correct: verdict.correctRaw,
    rationale: { html: "" },
    tier: "flagged",
    flags: [...new Set([...verdict.flags, "no-question-anchor"])],
    source: { pages: [span.startPage, span.endPage] },
  };
}

export function extractReadingQuestion(doc, span) {
  const lines = linesInSpan(doc, span);
  const anchors = findAnchors(lines);
  const metadata = parseMetadata(lines, anchors.question?.y);
  const verdict = classifyQuestion({ id: span.id, subject: "reading", anchors, lines, metadata });

  // A question without these anchors cannot be located in the page at all.
  // Return a flagged shell rather than throwing, so one bad question never
  // aborts a 610-question run.
  if (!anchors.question || !anchors.correct) return flaggedShell(span, verdict, metadata);

  const choiceLines = findChoiceLines(lines, anchors);
  const stemStart = { page: anchors.question.page, y: anchors.question.y + 10 };
  const stemEnd = anchors.answer ?? anchors.correct;

  const choices = choiceLines.map(({ label, line }, i) => {
    const next = choiceLines[i + 1]?.line;
    const end = next ? { page: next.page, y: next.y } : { page: anchors.correct.page, y: anchors.correct.y };
    return { label, html: toHtml(regionChars(doc, span, { page: line.page, y: line.y }, end)) };
  });

  const rationale = anchors.rationale
    ? toHtml(regionChars(doc, span, { page: anchors.rationale.page, y: anchors.rationale.y + 10 }, null))
    : "";

  return {
    id: span.id,
    subject: "reading",
    domain: metadata?.domain ?? null,
    skill: metadata?.skill ?? null,
    difficulty: metadata?.difficulty ?? null,
    format: verdict.format,
    presentation: "text",
    stem: { html: toHtml(regionChars(doc, span, stemStart, stemEnd)) },
    choices,
    correct: verdict.correctRaw,
    rationale: { html: rationale },
    tier: verdict.tier,
    flags: verdict.flags,
    source: { pages: [span.startPage, span.endPage] },
  };
}

if (import.meta.filename === path.resolve(process.argv[1])) {
  const doc = openDoc(READING_PDF);
  const spans = findSpans(doc);
  const questions = [];
  for (const [i, span] of spans.entries()) {
    questions.push(extractReadingQuestion(doc, span));
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${spans.length}`);
  }
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(
    path.join("data", "reading.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), questions }, null, 2),
  );
  console.log(`Wrote data/reading.json (${questions.length} questions)`);
}
