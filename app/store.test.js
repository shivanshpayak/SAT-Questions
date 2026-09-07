import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./store.js";

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const throwingStorage = {
  getItem() { throw new Error("denied"); },
  setItem() { throw new Error("denied"); },
  removeItem() { throw new Error("denied"); },
};

test("records attempts and accumulates counts", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", true, "B");
  store.recordAttempt("a", false, "C");
  const entry = store.getProgress().a;
  assert.equal(entry.attempts, 2);
  assert.equal(entry.correct, 1);
  assert.equal(entry.lastAnswer, "C");
  assert.ok(entry.lastAt > 0);
});

test("missedIds reflects only the most recent attempt", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", false, "B");
  store.recordAttempt("b", true, "A");
  assert.deepEqual(store.missedIds(), ["a"]);

  store.recordAttempt("a", true, "C");  // redeemed
  store.recordAttempt("b", false, "D"); // newly missed
  assert.deepEqual(store.missedIds(), ["b"]);
});

test("queues round-trip per pool key", () => {
  const store = createStore(fakeStorage());
  assert.equal(store.getQueue("math::all"), null);
  store.saveQueue("math::all", { order: ["a", "b"], idx: 1, seed: 5, cycle: 0 });
  assert.deepEqual(store.getQueue("math::all"), { order: ["a", "b"], idx: 1, seed: 5, cycle: 0 });
  assert.equal(store.getQueue("reading::all"), null, "keys are independent");
});

test("settings merge rather than replace", () => {
  const store = createStore(fakeStorage());
  store.saveSettings({ setSize: 20 });
  store.saveSettings({ subject: "math" });
  assert.deepEqual(store.getSettings(), { setSize: 20, subject: "math" });
});

test("accuracyBy groups progress against question metadata", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", true, "B");
  store.recordAttempt("b", false, "C");
  store.recordAttempt("c", true, "A");
  const questions = [
    { id: "a", domain: "Algebra" },
    { id: "b", domain: "Algebra" },
    { id: "c", domain: "Advanced Math" },
    { id: "d", domain: "Algebra" }, // never attempted
  ];
  const rows = Object.fromEntries(store.accuracyBy(questions, "domain"));
  assert.deepEqual(rows["Algebra"], { seen: 2, correct: 1 });
  assert.deepEqual(rows["Advanced Math"], { seen: 1, correct: 1 });
});

test("reset clears progress", () => {
  const store = createStore(fakeStorage());
  store.recordAttempt("a", true, "B");
  store.reset();
  assert.deepEqual(store.getProgress(), {});
});

test("survives a storage that throws on every access", () => {
  const store = createStore(throwingStorage);
  assert.deepEqual(store.getProgress(), {});
  assert.doesNotThrow(() => store.recordAttempt("a", true, "B"));
  assert.deepEqual(store.missedIds(), []);
  assert.equal(store.getQueue("k"), null);
  assert.deepEqual(store.getSettings(), {});
});

test("ignores corrupt stored JSON", () => {
  const store = createStore(fakeStorage({ "sat.progress.v1": "{not json" }));
  assert.deepEqual(store.getProgress(), {});
});
