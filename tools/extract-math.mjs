import fs from "node:fs";
import path from "node:path";
import { MATH_PDF, openDoc, renderGray, withPage } from "./lib/pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./lib/segment.mjs";
import { parseMetadata } from "./lib/metadata.mjs";
import { classifyQuestion, findChoiceLines } from "./lib/classify.mjs";
import { cropToPng } from "./lib/png.mjs";

const CROP_SCALE = 2.5;
const HEADING_DROP = 10;   // clear the section heading itself
const ANSWER_GUARD = 4;    // stay this far above the Correct Answer line
const NEXT_QUESTION_GUARD = 4; // stay this far above the next "Question ID:" line
const IMAGE_DIR = path.join("images", "math");

const pageBoundsCache = new Map();
function boundsOf(doc, index) {
  if (!pageBoundsCache.has(index)) {
    pageBoundsCache.set(index, withPage(doc, index, (page) => page.getBounds()));
  }
  return pageBoundsCache.get(index);
}

// Split [from, to) into one region per page it covers.
function regionsBetween(doc, span, from, to) {
  const regions = [];
  const lastPage = to ? to.page : span.endPage;
  for (let page = from.page; page <= lastPage; page++) {
    const bounds = boundsOf(doc, page);
    const y0 = page === from.page ? from.y : bounds[1];
    let y1 = to && page === to.page ? to.y : bounds[3];
    // Open-ended crops (the rationale) have no inner stop line, so on the
    // span's final page we must cap at the next question's "Question ID:" row
    // or the crop pulls the next question's full card into the rationale image.
    if (!to && page === span.endPage && Number.isFinite(span.endY)) {
      y1 = Math.min(y1, span.endY - NEXT_QUESTION_GUARD);
    }
    if (y1 - y0 > 2) regions.push({ page, y0, y1 });
  }
  return regions;
}

export function mathRegions(doc, span) {
  const lines = linesInSpan(doc, span);
  const anchors = findAnchors(lines);
  const choiceLines = findChoiceLines(lines, anchors);

  // 38 questions have no Correct Answer line at all - the whole line is absent
  // and the answer appears only inside the rationale prose. Those fall back to
  // the Rationale heading, which needs the same offset or the crop catches the
  // top pixel row of the word "Rationale".
  const stop = anchors.correct ?? anchors.rationale;
  const guard = stop ? { page: stop.page, y: stop.y - ANSWER_GUARD } : null;

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
    const bounds = boundsOf(doc, region.page);
    const png = withPage(doc, region.page, (page) => {
      const img = renderGray(page, CROP_SCALE, [bounds[0], region.y0, bounds[2], region.y1]);
      return cropToPng(img);
    });
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

  const common = {
    id: span.id,
    subject: "math",
    domain: metadata?.domain ?? null,
    skill: metadata?.skill ?? null,
    difficulty: metadata?.difficulty ?? null,
    format: verdict.format,
    presentation: "image",
    correct: verdict.correctRaw,
    source: { pages: [span.startPage, span.endPage] },
  };

  // Without a Question anchor there is no region to crop. Flag it instead of
  // throwing, so a single malformed question never aborts a 610-question run.
  if (!anchors.question) {
    return {
      ...common,
      stem: { images: [] },
      choices: [],
      selfMarked: false,
      rationale: { images: [] },
      tier: "flagged",
      flags: [...new Set([...verdict.flags, "no-question-anchor"])],
    };
  }

  const regions = mathRegions(doc, span);

  return {
    ...common,
    stem: { images: writeCrops(doc, span.id, "stem", regions.stem, write) },
    choices: regions.choices.map((c) => ({
      label: c.label,
      images: writeCrops(doc, span.id, `choice-${c.label}`, c.regions, write),
    })),
    // An image-only answer is usable, just not auto-gradable, so it stays in
    // the pool as self-marked rather than being flagged out of it.
    selfMarked: verdict.correctRaw === null,
    rationale: { images: writeCrops(doc, span.id, "rationale", regions.rationale, write) },
    tier: verdict.correctRaw === null ? "fallback" : verdict.tier,
    flags: verdict.flags,
  };
}

if (import.meta.filename === path.resolve(process.argv[1])) {
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
