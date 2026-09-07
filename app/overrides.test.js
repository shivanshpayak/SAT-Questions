import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverride, saveOverrides } from "./overrides.js";

test("buildOverride keeps only the corrected fields", () => {
  const question = { id: "a", tier: "flagged", correct: null, domain: "Algebra", stem: { images: [] } };
  assert.deepEqual(buildOverride(question, { correct: "C", tier: "clean" }), { correct: "C", tier: "clean" });
});

test("buildOverride drops empty values so a blank field is not persisted", () => {
  const question = { id: "a", tier: "flagged", correct: null };
  assert.deepEqual(buildOverride(question, { correct: "  ", tier: "clean" }), { tier: "clean" });
});

test("saveOverrides posts the whole map and reports the count", async () => {
  const sent = [];
  const postJson = async (path, body) => { sent.push([path, body]); return { ok: true, count: Object.keys(body).length }; };
  const result = await saveOverrides({ a: { correct: "C" }, b: { tier: "clean" } }, postJson);
  assert.equal(sent[0][0], "/api/overrides");
  assert.deepEqual(sent[0][1], { a: { correct: "C" }, b: { tier: "clean" } });
  assert.deepEqual(result, { ok: true, count: 2 });
});
