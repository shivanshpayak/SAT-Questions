import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSubject, feedbackModel } from "./ui.js";

function fakeFetch(files) {
  return async (path) => {
    if (!(path in files)) throw new Error(`404 ${path}`);
    return files[path];
  };
}

const question = (id, over = {}) => ({
  id, subject: "math", domain: "Algebra", skill: "Linear functions",
  tier: "clean", format: "mcq", correct: "B", ...over,
});

test("loadSubject merges overrides and drops flagged questions", async () => {
  const fetchJson = fakeFetch({
    "/data/math.json": { questions: [question("a"), question("b"), question("c", { tier: "flagged" })] },
    "/data/overrides.json": { b: { correct: "D" } },
  });
  const { questions, facets } = await loadSubject("math", fetchJson);
  assert.deepEqual(questions.map((q) => q.id), ["a", "b"]);
  assert.equal(questions[1].correct, "D");
  assert.deepEqual(facets.domains, [["Algebra", 2]]);
});

test("loadSubject tolerates a missing overrides file", async () => {
  const fetchJson = fakeFetch({
    "/data/reading.json": { questions: [question("a", { subject: "reading" })] },
  });
  const { questions } = await loadSubject("reading", fetchJson);
  assert.equal(questions.length, 1);
});

test("an override can rescue a flagged question into the pool", async () => {
  const fetchJson = fakeFetch({
    "/data/math.json": { questions: [question("a", { tier: "flagged" })] },
    "/data/overrides.json": { a: { tier: "clean", correct: "C" } },
  });
  const { questions } = await loadSubject("math", fetchJson);
  assert.deepEqual(questions.map((q) => q.id), ["a"]);
});

test("feedbackModel reports a correct answer", () => {
  const model = feedbackModel(question("a", { rationale: { html: "<p>why</p>" } }), { answer: "B", correct: true });
  assert.equal(model.verdict, "correct");
  assert.equal(model.correctText, "B");
  assert.ok(model.rationale.includes("why"));
  assert.equal(model.selfMarked, false);
});

test("feedbackModel reports a wrong answer and still shows the right one", () => {
  const model = feedbackModel(question("a", { rationale: { html: "" } }), { answer: "C", correct: false });
  assert.equal(model.verdict, "wrong");
  assert.equal(model.correctText, "B");
});

test("feedbackModel defers the verdict on a self-marked question", () => {
  const q = question("a", { format: "spr", correct: null, selfMarked: true, rationale: { images: ["r.png"] } });
  const model = feedbackModel(q, { answer: "1.5", correct: null });
  assert.equal(model.verdict, "unmarked");
  assert.equal(model.selfMarked, true);
  assert.equal(model.correctText, null);
  assert.ok(model.rationale.includes("r.png"));
});
