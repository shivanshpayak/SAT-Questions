import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOverrides, practicePool, facetsOf, filterQuestions, poolKey } from "./bank.js";

const q = (id, over = {}) => ({
  id, subject: "math", domain: "Algebra", skill: "Linear functions",
  difficulty: "Hard", format: "mcq", tier: "clean", correct: "B", ...over,
});

test("mergeOverrides applies corrections and leaves others untouched", () => {
  const merged = mergeOverrides([q("a"), q("b")], { b: { correct: "D", tier: "clean" } });
  assert.equal(merged[0].correct, "B");
  assert.equal(merged[1].correct, "D");
  assert.equal(merged[1].skill, "Linear functions", "override must not drop other fields");
});

test("mergeOverrides ignores ids that are not in the dataset", () => {
  const merged = mergeOverrides([q("a")], { zzz: { correct: "D" } });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].correct, "B");
});

test("practicePool excludes flagged questions", () => {
  const pool = practicePool([q("a"), q("b", { tier: "flagged" }), q("c", { tier: "fallback" })]);
  assert.deepEqual(pool.map((x) => x.id), ["a", "c"], "fallback questions stay in the pool");
});

test("facetsOf counts values and sorts by frequency", () => {
  const facets = facetsOf([
    q("a", { domain: "Algebra" }),
    q("b", { domain: "Advanced Math" }),
    q("c", { domain: "Advanced Math" }),
  ]);
  assert.deepEqual(facets.domains, [["Advanced Math", 2], ["Algebra", 1]]);
});

test("filterQuestions treats empty criteria as no restriction", () => {
  const all = [q("a", { domain: "Algebra" }), q("b", { domain: "Advanced Math" })];
  assert.equal(filterQuestions(all, {}).length, 2);
  assert.equal(filterQuestions(all, { domains: [] }).length, 2);
  assert.deepEqual(filterQuestions(all, { domains: ["Algebra"] }).map((x) => x.id), ["a"]);
});

test("filterQuestions combines domain, skill and explicit ids", () => {
  const all = [
    q("a", { domain: "Algebra", skill: "Linear functions" }),
    q("b", { domain: "Algebra", skill: "Nonlinear functions" }),
    q("c", { domain: "Advanced Math", skill: "Linear functions" }),
  ];
  assert.deepEqual(
    filterQuestions(all, { domains: ["Algebra"], skills: ["Linear functions"] }).map((x) => x.id),
    ["a"],
  );
  assert.deepEqual(filterQuestions(all, { ids: ["b", "c"] }).map((x) => x.id), ["b", "c"]);
});

test("poolKey is stable regardless of selection order", () => {
  const a = poolKey({ subject: "math", domains: ["Algebra", "Geometry and Trigonometry"], skills: [], pool: "all" });
  const b = poolKey({ subject: "math", domains: ["Geometry and Trigonometry", "Algebra"], skills: [], pool: "all" });
  assert.equal(a, b);
  assert.notEqual(a, poolKey({ subject: "reading", domains: [], skills: [], pool: "all" }));
  assert.notEqual(
    a,
    poolKey({ subject: "math", domains: ["Algebra", "Geometry and Trigonometry"], skills: [], pool: "missed" }),
  );
});
