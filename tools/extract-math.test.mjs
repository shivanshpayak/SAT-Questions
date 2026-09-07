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

test("a question with no Correct Answer line still stops short of the Rationale", () => {
  const doc = openDoc(MATH_PDF);
  const spans = findSpans(doc);
  let checked = 0;
  for (const span of spans) {
    const anchors = findAnchors(linesInSpan(doc, span));
    if (anchors.correct || !anchors.rationale) continue;
    const regions = mathRegions(doc, span);
    for (const r of [...regions.stem, ...regions.choices.flatMap((c) => c.regions)]) {
      if (r.page !== anchors.rationale.page) continue;
      assert.ok(
        r.y1 < anchors.rationale.y,
        `${span.id}: region ends at ${r.y1}, Rationale heading at ${anchors.rationale.y}`,
      );
    }
    if (++checked >= 5) break;
  }
  assert.ok(checked > 0, "expected questions with no Correct Answer line");
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
