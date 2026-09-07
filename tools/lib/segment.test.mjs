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
