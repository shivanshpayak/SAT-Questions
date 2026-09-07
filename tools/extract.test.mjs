import { test } from "node:test";
import assert from "node:assert/strict";
import { planWork } from "./extract.mjs";

const spans = [{ id: "a" }, { id: "b" }, { id: "c" }];
const done = (id) => ({
  id, stem: { images: [`images/math/${id}-stem.png`] }, choices: [], rationale: { images: [] },
});
const previous = { questions: [done("a"), done("b"), done("c")] };
const present = () => 4096;

test("computes everything when there is no previous run", () => {
  const { reuse, compute } = planWork(spans, null, { imageSize: present });
  assert.equal(reuse.length, 0);
  assert.deepEqual(compute.map((s) => s.id), ["a", "b", "c"]);
});

test("reuses every question whose images are all present", () => {
  const { reuse, compute } = planWork(spans, previous, { imageSize: present });
  assert.equal(compute.length, 0);
  assert.deepEqual(reuse.map((q) => q.id), ["a", "b", "c"]);
});

test("recomputes only the question whose image went missing", () => {
  const imageSize = (file) => (file.includes("b-") ? 0 : 4096);
  const { reuse, compute } = planWork(spans, previous, { imageSize });
  assert.deepEqual(compute.map((s) => s.id), ["b"]);
  assert.deepEqual(reuse.map((q) => q.id), ["a", "c"]);
});

test("--force recomputes everything", () => {
  const { reuse, compute } = planWork(spans, previous, { force: true, imageSize: present });
  assert.equal(reuse.length, 0);
  assert.equal(compute.length, 3);
});

test("--only recomputes one question and keeps the others", () => {
  const { reuse, compute } = planWork(spans, previous, { only: "b", imageSize: present });
  assert.deepEqual(compute.map((s) => s.id), ["b"]);
  assert.deepEqual(reuse.map((q) => q.id), ["a", "c"]);
});

test("a text-only question with no images is reusable", () => {
  const textOnly = { questions: [{ id: "a", stem: { html: "<p>x</p>" }, choices: [], rationale: { html: "" } }] };
  const { reuse } = planWork([{ id: "a" }], textOnly, { imageSize: () => 0 });
  assert.deepEqual(reuse.map((q) => q.id), ["a"]);
});
