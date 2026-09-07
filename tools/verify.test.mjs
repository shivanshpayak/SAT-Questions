import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyDataset } from "./verify.mjs";

const readingQuestion = (over = {}) => ({
  id: "r1", subject: "reading", tier: "clean", format: "mcq", presentation: "text",
  domain: "Craft and Structure", skill: "Words in Context", difficulty: "Hard",
  stem: { html: "<p>plain</p>" }, choices: [], correct: "B", rationale: { html: "" }, ...over,
});
const mathQuestion = (over = {}) => ({
  id: "m1", subject: "math", tier: "clean", format: "spr", presentation: "image",
  domain: "Algebra", skill: "Linear functions", difficulty: "Hard",
  stem: { images: ["images/math/m1-stem.png"] }, choices: [], correct: "5",
  rationale: { images: [] }, ...over,
});

const always = () => 4096;

test("passes a well-formed dataset", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion()] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test("fails when a stem leaks the correct answer", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion({ stem: { html: "<p>Correct Answer: B</p>" } })] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("answer-leak")));
});

test("fails when a referenced image is missing or empty", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion()] },
    math: { questions: [mathQuestion()] },
    imageSize: () => 0,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("missing-image")));
});

test("fails when an underline question lost its underline", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion({ stem: { html: "<p>the underlined portion</p>" } })] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("lost-underline")));
});

test("fails when the question count is wrong", () => {
  const result = verifyDataset({
    reading: { questions: [] },
    math: { questions: [mathQuestion()] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("count")));
});

test("fails when body text bled into a metadata field", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion({ difficulty: "Hard . rettgeri correlates" })] },
    math: { questions: [mathQuestion({ domain: "Algebra , which is equivalent to yields" })] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.includes("bad-difficulty")));
  assert.ok(result.failures.some((f) => f.includes("contaminated-domain")));
});

test("accepts the genuinely long taxonomy names College Board uses", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion({ skill: "Ratios, rates, proportional relationships, and units" })] },
    math: { questions: [mathQuestion({ skill: "Nonlinear equations in one variable and systems of equations in two variables" })] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test("allows a self-marked question to have no correct answer", () => {
  const result = verifyDataset({
    reading: { questions: [readingQuestion()] },
    math: { questions: [mathQuestion({ correct: null, selfMarked: true, tier: "fallback" })] },
    imageSize: always,
    expectedCount: 1,
  });
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});
