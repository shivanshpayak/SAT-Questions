import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAnswer, parseRational, acceptedAnswers, answersEqual } from "./answers.js";

test("normalizeAnswer strips spacing and normalises signs", () => {
  assert.equal(normalizeAnswer("  500 "), "500");
  assert.equal(normalizeAnswer("3 / 2"), "3/2");
  assert.equal(normalizeAnswer("− 14"), "-14"); // Unicode minus
  assert.equal(normalizeAnswer("+7"), "7");
  assert.equal(normalizeAnswer("B"), "b");
  assert.equal(normalizeAnswer(null), "");
});

test("parseRational handles integers, decimals and fractions", () => {
  assert.deepEqual(parseRational("6"), { n: 6, d: 1 });
  assert.deepEqual(parseRational("1.50"), { n: 150, d: 100 });
  assert.deepEqual(parseRational("-14/15"), { n: -14, d: 15 });
  assert.deepEqual(parseRational(".5"), { n: 5, d: 10 });
  assert.equal(parseRational("abc"), null);
  assert.equal(parseRational("1/0"), null);
});

test("acceptedAnswers splits the real multi-form answers", () => {
  assert.deepEqual(acceptedAnswers("-.9333, -14/15"), ["-.9333", "-14/15"]);
  assert.deepEqual(acceptedAnswers(".0465, 2/43"), [".0465", "2/43"]);
  assert.deepEqual(acceptedAnswers("500"), ["500"]);
  assert.deepEqual(acceptedAnswers("2 or 3"), ["2", "3"]);
});

test("answersEqual accepts equivalent numeric forms", () => {
  assert.ok(answersEqual("1.5", "3/2"));
  assert.ok(answersEqual("3/2", "1.5"));
  assert.ok(answersEqual(" 1.50 ", "1.5"));
  assert.ok(answersEqual("-14", "−14"));
  assert.ok(!answersEqual("1.6", "3/2"));
});

test("answersEqual accepts any listed form of a real answer", () => {
  assert.ok(answersEqual("-14/15", "-.9333, -14/15"));
  assert.ok(answersEqual("-.9333", "-.9333, -14/15"));
  assert.ok(answersEqual("2/43", ".0465, 2/43"));
  assert.ok(!answersEqual("14/15", "-.9333, -14/15"), "sign matters");
});

test("answersEqual handles multiple-choice letters case-insensitively", () => {
  assert.ok(answersEqual("b", "B"));
  assert.ok(answersEqual("B", "B"));
  assert.ok(!answersEqual("C", "B"));
});

test("an empty entry is never correct", () => {
  assert.ok(!answersEqual("", "500"));
  assert.ok(!answersEqual("   ", "500"));
});
