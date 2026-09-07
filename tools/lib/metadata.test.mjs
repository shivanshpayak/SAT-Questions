import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMetadata } from "./metadata.mjs";

const HEADER = [
  { x: 24, y: 58, text: "Assessment" },
  { x: 139, y: 58, text: "Test" },
  { x: 254, y: 58, text: "Domain" },
  { x: 369, y: 58, text: "Skill" },
  { x: 484, y: 58, text: "Difficulty" },
];

test("assigns each value to the column its x falls under", () => {
  const lines = [
    ...HEADER,
    { x: 24, y: 83, text: "SAT" },
    { x: 139, y: 83, text: "Math" },
    { x: 254, y: 83, text: "Algebra" },
    { x: 369, y: 83, text: "Linear functions" },
    { x: 484, y: 83, text: "Hard" },
  ];
  assert.deepEqual(parseMetadata(lines, 127), {
    assessment: "SAT", test: "Math", domain: "Algebra",
    skill: "Linear functions", difficulty: "Hard",
  });
});

test("joins a skill that wraps onto a second line", () => {
  const lines = [
    ...HEADER,
    { x: 24, y: 83, text: "SAT" },
    { x: 139, y: 83, text: "Math" },
    { x: 254, y: 83, text: "Algebra" },
    { x: 369, y: 83, text: "Linear inequalities in one" },
    { x: 484, y: 83, text: "Hard" },
    { x: 369, y: 94, text: "or two variables" },
  ];
  assert.equal(parseMetadata(lines, 127).skill, "Linear inequalities in one or two variables");
});

test("ignores lines at or below the Question heading", () => {
  const lines = [
    ...HEADER,
    { x: 24, y: 83, text: "SAT" },
    { x: 139, y: 83, text: "Reading and Writing" },
    { x: 254, y: 83, text: "Craft and Structure" },
    { x: 369, y: 83, text: "Words in Context" },
    { x: 484, y: 83, text: "Hard" },
    { x: 24, y: 140, text: "Rejecting the premise that the literary magazine" },
  ];
  assert.equal(parseMetadata(lines, 127).domain, "Craft and Structure");
});

test("returns null when the header row is missing", () => {
  assert.equal(parseMetadata([{ x: 24, y: 83, text: "SAT" }], 127), null);
});
