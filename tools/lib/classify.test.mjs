import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyQuestion } from "./classify.mjs";

const metadata = { assessment: "SAT", test: "Math", domain: "Algebra", skill: "Linear functions", difficulty: "Hard" };

const base = {
  id: "aaaaaaaa",
  subject: "math",
  metadata,
  anchors: {
    question: { page: 0, y: 100 },
    correct: { page: 0, y: 300, text: "Correct Answer: 500" },
    rationale: { page: 0, y: 320 },
  },
  lines: [],
};

test("a free-response question with a numeric answer is clean", () => {
  const result = classifyQuestion(base);
  assert.equal(result.tier, "clean");
  assert.equal(result.format, "spr");
  assert.equal(result.correctRaw, "500");
  assert.deepEqual(result.flags, []);
});

test("a multiple-choice question with four choices is clean", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, answer: { page: 0, y: 200 } },
    lines: ["A. one", "B. two", "C. three", "D. four"].map((text, i) => ({ page: 0, x: 24, y: 210 + i * 10, text })),
  });
  assert.equal(result.tier, "clean");
  assert.equal(result.format, "mcq");
});

test("recognises choice labels whose content is a rendered image", () => {
  // The real shape of most Math choices: the label extracts as text but the
  // choice itself is vector math, leaving the line as bare "A. ".
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, correct: { page: 0, y: 300, text: "Correct Answer: D" }, answer: { page: 0, y: 200 } },
    lines: ["A. ", "B. ", "C. ", "D. "].map((text, i) => ({ page: 0, x: 18, y: 210 + i * 20, text })),
  });
  assert.equal(result.format, "mcq");
  assert.equal(result.choiceCount, 4);
  assert.equal(result.tier, "clean");
  assert.deepEqual(result.flags, []);
});

test("flags a multiple-choice question missing choices", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, answer: { page: 0, y: 200 } },
    lines: [{ page: 0, x: 24, y: 210, text: "A. one" }],
  });
  assert.equal(result.tier, "flagged");
  assert.ok(result.flags.includes("mcq-missing-choices"));
});

test("flags a free-response question whose answer is a bare letter", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, correct: { page: 0, y: 300, text: "Correct Answer: D" } },
  });
  assert.equal(result.tier, "flagged");
  assert.ok(result.flags.includes("spr-with-letter-answer"));
});

test("flags a question with no extractable correct answer", () => {
  const result = classifyQuestion({ ...base, anchors: { question: base.anchors.question } });
  assert.equal(result.tier, "flagged");
  assert.ok(result.flags.includes("no-correct-answer"));
});

test("flags a question whose answer block precedes its question", () => {
  const result = classifyQuestion({
    ...base,
    anchors: { ...base.anchors, answer: { page: 0, y: 50 } },
    lines: ["A. one", "B. two", "C. three", "D. four"].map((text, i) => ({ page: 0, x: 24, y: 55 + i * 5, text })),
  });
  assert.ok(result.flags.includes("answer-before-question"));
  assert.equal(result.tier, "flagged");
});
