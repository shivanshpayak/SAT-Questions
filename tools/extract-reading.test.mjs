import { test } from "node:test";
import assert from "node:assert/strict";
import { READING_PDF, openDoc } from "./lib/pdf.mjs";
import { findSpans } from "./lib/segment.mjs";
import { extractReadingQuestion } from "./extract-reading.mjs";

test("no rationale pulls in the next question's 'Question ID:' line", () => {
  const doc = openDoc(READING_PDF);
  const spans = findSpans(doc);
  let checked = 0;
  for (const span of spans.slice(0, 40)) {
    const q = extractReadingQuestion(doc, span);
    if (!q.rationale.html) continue;
    assert.ok(
      !/Question ID:/i.test(q.rationale.html),
      `${span.id}: rationale leaked next question — ${q.rationale.html.slice(-200)}`,
    );
    checked++;
  }
  assert.ok(checked > 0, "expected to check at least one rationale");
});

test("extracts the first Reading question in full", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[0]);

  assert.equal(q.id, "22a41819");
  assert.equal(q.subject, "reading");
  assert.equal(q.format, "mcq");
  assert.equal(q.presentation, "text");
  assert.equal(q.difficulty, "Hard");
  assert.equal(q.domain, "Craft and Structure");
  assert.equal(q.skill, "Words in Context");
  assert.equal(q.correct, "B");

  assert.match(q.stem.html, /^<p>/);
  assert.ok(q.stem.html.includes("Charles S. Johnson"));
  assert.equal(q.choices.length, 4);
  assert.deepEqual(q.choices.map((c) => c.label), ["A", "B", "C", "D"]);
  assert.ok(q.choices[1].html.includes("dogmatic"));
  assert.ok(q.rationale.html.includes("dogmatic"));
});

test("the stem never contains the correct answer line or the rationale", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[0]);
  assert.ok(!q.stem.html.includes("Correct Answer"));
  assert.ok(!q.stem.html.includes("Rationale"));
  for (const choice of q.choices) assert.ok(!choice.html.includes("Correct Answer"));
});

test("recovers the underline on the second Reading question", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[1]);
  assert.equal(q.id, "ca50de52");
  assert.match(q.stem.html, /<u>[^<]*How lifelike are they\?[^<]*<\/u>/);
});

test("renders the italic magazine title in the first question", () => {
  const doc = openDoc(READING_PDF);
  const q = extractReadingQuestion(doc, findSpans(doc)[0]);
  assert.match(q.stem.html, /<em>[^<]*Ebony and Topaz[^<]*<\/em>/);
});
