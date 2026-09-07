import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, createTimer } from "./timer.js";

test("formatDuration renders minutes and seconds", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(9_000), "0:09");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(600_000), "10:00");
});

test("formatDuration switches to hours past sixty minutes", () => {
  assert.equal(formatDuration(3_661_000), "1:01:01");
});

test("formatDuration never renders a negative time", () => {
  assert.equal(formatDuration(-5_000), "0:00");
});

test("a counting-up timer reports elapsed time", () => {
  let clock = 1000;
  const timer = createTimer({ now: () => clock });
  timer.start();
  clock = 4000;
  assert.equal(timer.elapsed(), 3000);
});

test("a countdown timer fires onExpire once past the limit", () => {
  let clock = 0;
  let expired = 0;
  const timer = createTimer({ limitMs: 5000, now: () => clock, onExpire: () => expired++ });
  timer.start();
  clock = 4000;
  assert.equal(timer.tick(), 1000, "remaining time");
  assert.equal(expired, 0);
  clock = 6000;
  assert.equal(timer.tick(), 0);
  clock = 7000;
  timer.tick();
  assert.equal(expired, 1, "expiry fires exactly once");
  timer.stop();
});
