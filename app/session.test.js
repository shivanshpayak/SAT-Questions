import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startSession, currentId, gradeAnswer, submitAnswer, advance, isComplete, scoreSession,
} from "./session.js";

const ids = ["a", "b", "c", "d", "e"];

test("a practice session runs the whole list", () => {
  const session = startSession({ ids, mode: "practice" });
  assert.equal(session.ids.length, 5);
  assert.equal(currentId(session), "a");
  assert.equal(isComplete(session), false);
});

test("a timed set is truncated to its size", () => {
  const session = startSession({ ids, mode: "timed", size: 3 });
  assert.deepEqual(session.ids, ["a", "b", "c"]);
});

test("a size larger than the pool uses the whole pool", () => {
  assert.deepEqual(startSession({ ids: ["a"], mode: "timed", size: 20 }).ids, ["a"]);
});

test("advancing past the last question completes the session", () => {
  let session = startSession({ ids: ["a", "b"], mode: "practice" });
  session = advance(submitAnswer(session, { answer: "B", correct: true }));
  assert.equal(currentId(session), "b");
  session = advance(submitAnswer(session, { answer: "C", correct: false }));
  assert.equal(isComplete(session), true);
  assert.equal(currentId(session), null);
});

test("scoreSession counts only answered questions", () => {
  let session = startSession({ ids, mode: "timed", size: 3 });
  session = advance(submitAnswer(session, { answer: "B", correct: true }));
  session = advance(submitAnswer(session, { answer: "C", correct: false }));
  const score = scoreSession(session);
  assert.deepEqual(
    { total: score.total, answered: score.answered, correct: score.correct },
    { total: 3, answered: 2, correct: 1 },
  );
  assert.equal(score.accuracy, 0.5);
});

test("accuracy is zero rather than NaN before anything is answered", () => {
  assert.equal(scoreSession(startSession({ ids, mode: "practice" })).accuracy, 0);
});

test("gradeAnswer marks a multiple-choice answer", () => {
  const question = { format: "mcq", correct: "B" };
  assert.deepEqual(gradeAnswer(question, "B"), { correct: true, selfMarked: false });
  assert.deepEqual(gradeAnswer(question, "C"), { correct: false, selfMarked: false });
});

test("gradeAnswer accepts equivalent free-response forms", () => {
  const question = { format: "spr", correct: "-.9333, -14/15" };
  assert.equal(gradeAnswer(question, "-14/15").correct, true);
  assert.equal(gradeAnswer(question, "0").correct, false);
});

test("gradeAnswer defers to the user on a self-marked question", () => {
  const question = { format: "spr", correct: null, selfMarked: true };
  assert.deepEqual(gradeAnswer(question, "1.5"), { correct: null, selfMarked: true });
});

test("re-submitting the same question overwrites rather than duplicates", () => {
  let session = startSession({ ids: ["a"], mode: "practice" });
  session = submitAnswer(session, { answer: "B", correct: false });
  session = submitAnswer(session, { answer: "B", correct: true });
  const score = scoreSession(session);
  assert.equal(score.answered, 1);
  assert.equal(score.correct, 1);
});
