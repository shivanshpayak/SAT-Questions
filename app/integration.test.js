// Exercises the real dataset through the same modules the browser uses.
// Unit tests use fixtures; this proves the pipeline works on all 1,220
// actual questions, which is the part a fixture can never tell us.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadSubject, feedbackModel } from "./ui.js";
import { filterQuestions } from "./bank.js";
import { acceptedAnswers } from "./answers.js";
import { createQueue, currentId as queueCurrent, advanceQueue } from "./queue.js";
import { startSession, currentId, gradeAnswer, submitAnswer, advance, scoreSession } from "./session.js";
import { stemHtml, choiceHtml, choiceLetters } from "./render.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const haveData = fs.existsSync(path.join(ROOT, "data", "math.json"));

// Reads from disk the way the browser reads over HTTP.
const fetchJson = async (urlPath) => {
  const file = path.join(ROOT, urlPath.replace(/^\//, ""));
  if (!fs.existsSync(file)) throw new Error(`404 ${urlPath}`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

test("loads both real subjects with the expected shape", { skip: !haveData }, async () => {
  for (const [subject, expected] of [["reading", 610], ["math", 610]]) {
    const { questions, facets } = await loadSubject(subject, fetchJson);
    assert.equal(questions.length, expected, `${subject} pool size`);
    assert.equal(facets.domains.length, 4, `${subject} should expose 4 domains`);
    assert.ok(facets.skills.length >= 10, `${subject} should expose skills`);
  }
});

test("every real question renders a non-empty stem", { skip: !haveData }, async () => {
  for (const subject of ["reading", "math"]) {
    const { questions } = await loadSubject(subject, fetchJson);
    for (const q of questions) {
      assert.ok(stemHtml(q).length > 0, `${subject}/${q.id} rendered an empty stem`);
    }
  }
});

test("every real multiple-choice question renders four distinct choices", { skip: !haveData }, async () => {
  for (const subject of ["reading", "math"]) {
    const { questions } = await loadSubject(subject, fetchJson);
    for (const q of questions.filter((x) => x.format === "mcq")) {
      const letters = choiceLetters(q);
      assert.deepEqual(letters, ["A", "B", "C", "D"], `${subject}/${q.id} choices`);
      const rendered = letters.map((l) => choiceHtml(q, l));
      assert.ok(rendered.every((html) => html.length > 0), `${subject}/${q.id} has an empty choice`);
      assert.equal(new Set(rendered).size, 4, `${subject}/${q.id} has duplicate choices`);
    }
  }
});

test("no rendered stem or choice leaks the answer", { skip: !haveData }, async () => {
  for (const subject of ["reading", "math"]) {
    const { questions } = await loadSubject(subject, fetchJson);
    for (const q of questions) {
      const surfaces = [stemHtml(q), ...choiceLetters(q).map((l) => choiceHtml(q, l))];
      for (const html of surfaces) {
        assert.ok(!html.includes("Correct Answer"), `${subject}/${q.id} leaks the answer`);
      }
    }
  }
});

test("every listed form of every real answer is accepted", { skip: !haveData }, async () => {
  // The stored `correct` field is a list of equally valid forms, e.g.
  // "-.9333, -14/15". A user types one of them, never the whole list, so each
  // form individually must grade as correct.
  let multiForm = 0;
  for (const subject of ["reading", "math"]) {
    const { questions } = await loadSubject(subject, fetchJson);
    for (const q of questions) {
      if (q.selfMarked) {
        assert.equal(gradeAnswer(q, "anything").correct, null, `${subject}/${q.id} should defer to the user`);
        continue;
      }
      const forms = acceptedAnswers(q.correct);
      assert.ok(forms.length > 0, `${subject}/${q.id} has no usable answer`);
      if (forms.length > 1) multiForm++;
      for (const form of forms) {
        assert.equal(gradeAnswer(q, form).correct, true, `${subject}/${q.id} rejected its own form ${form}`);
      }
    }
  }
  assert.ok(multiForm > 50, `expected many multi-form answers, saw ${multiForm}`);
});

test("a plainly wrong entry is never accepted", { skip: !haveData }, async () => {
  const { questions } = await loadSubject("math", fetchJson);
  for (const q of questions.filter((x) => !x.selfMarked && x.format === "spr")) {
    assert.equal(gradeAnswer(q, "banana").correct, false, `${q.id} accepted nonsense`);
  }
});

test("a filtered no-repeat run over real Math data never repeats", { skip: !haveData }, async () => {
  const { questions } = await loadSubject("math", fetchJson);
  const pool = filterQuestions(questions, { domains: ["Algebra"] });
  assert.ok(pool.length > 50, "Algebra should be a substantial pool");

  let queue = createQueue(pool.map((q) => q.id), 12345);
  const seen = new Set();
  for (let i = 0; i < pool.length; i++) {
    const id = queueCurrent(queue);
    assert.ok(!seen.has(id), `repeat at position ${i}`);
    seen.add(id);
    queue = advanceQueue(queue);
  }
  assert.equal(seen.size, pool.length);
});

test("a full 20-question Reading session scores correctly", { skip: !haveData }, async () => {
  const { questions } = await loadSubject("reading", fetchJson);
  const byId = new Map(questions.map((q) => [q.id, q]));
  let queue = createQueue(questions.map((q) => q.id), 999);
  const ids = [];
  for (let i = 0; i < 20; i++) { ids.push(queueCurrent(queue)); queue = advanceQueue(queue); }

  let session = startSession({ ids, mode: "timed", size: 20 });
  // Answer correctly on even positions, wrongly on odd ones.
  for (let i = 0; i < 20; i++) {
    const q = byId.get(currentId(session));
    const answer = i % 2 === 0 ? q.correct : (q.correct === "A" ? "B" : "A");
    const { correct } = gradeAnswer(q, answer);
    session = advance(submitAnswer(session, { answer, correct }));
  }
  const score = scoreSession(session);
  assert.equal(score.total, 20);
  assert.equal(score.answered, 20);
  assert.equal(score.correct, 10);
  assert.equal(score.accuracy, 0.5);
});

test("self-marked Math questions produce a rationale to judge against", { skip: !haveData }, async () => {
  const { questions } = await loadSubject("math", fetchJson);
  const selfMarked = questions.filter((q) => q.selfMarked);
  assert.equal(selfMarked.length, 38, "expected the known image-answer questions");
  for (const q of selfMarked) {
    const model = feedbackModel(q, { answer: "anything", correct: null });
    assert.equal(model.verdict, "unmarked");
    assert.ok(model.rationale.length > 0, `${q.id} has no rationale to self-mark against`);
  }
});

test("every referenced Math image exists on disk", { skip: !haveData }, async () => {
  const { questions } = await loadSubject("math", fetchJson);
  let checked = 0;
  for (const q of questions) {
    const files = [
      ...(q.stem.images ?? []),
      ...q.choices.flatMap((c) => c.images ?? []),
      ...(q.rationale.images ?? []),
    ];
    for (const file of files) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `missing ${file}`);
      checked++;
    }
  }
  assert.ok(checked > 3000, `expected the full image set, saw ${checked}`);
});
