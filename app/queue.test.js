import { test } from "node:test";
import assert from "node:assert/strict";
import { mulberry32, shuffle, createQueue, currentId, advanceQueue } from "./queue.js";

const ids = (n) => Array.from({ length: n }, (_, i) => `q${i}`);

test("mulberry32 is deterministic for a seed", () => {
  const a = mulberry32(42), b = mulberry32(42);
  const draw = (rng) => [rng(), rng(), rng()];
  assert.deepEqual(draw(a), draw(b));
  assert.notDeepEqual(draw(mulberry32(1)), draw(mulberry32(2)));
});

test("shuffle keeps every id exactly once and does not mutate the input", () => {
  const source = ids(50);
  const copy = [...source];
  const out = shuffle(source, 7);
  assert.deepEqual(source, copy, "input must not be mutated");
  assert.equal(out.length, 50);
  assert.deepEqual([...out].sort(), [...source].sort());
});

test("shuffle actually reorders and is reproducible", () => {
  assert.deepEqual(shuffle(ids(50), 7), shuffle(ids(50), 7));
  assert.notDeepEqual(shuffle(ids(50), 7), ids(50));
});

test("a full cycle serves every question exactly once", () => {
  let queue = createQueue(ids(20), 3);
  const seen = [];
  for (let i = 0; i < 20; i++) {
    seen.push(currentId(queue));
    queue = advanceQueue(queue);
  }
  assert.equal(new Set(seen).size, 20, "no repeats within a cycle");
  assert.equal(queue.cycle, 1, "cycle advances on exhaustion");
});

test("exhausting the pool reshuffles into a different order", () => {
  const first = createQueue(ids(20), 3);
  let queue = first;
  for (let i = 0; i < 20; i++) queue = advanceQueue(queue);
  assert.equal(queue.idx, 0);
  assert.notEqual(queue.seed, first.seed);
  assert.notDeepEqual(queue.order, first.order);
  assert.deepEqual([...queue.order].sort(), [...first.order].sort());
});

test("currentId returns null for an empty pool and advancing is safe", () => {
  const queue = createQueue([], 1);
  assert.equal(currentId(queue), null);
  assert.equal(currentId(advanceQueue(queue)), null);
});
