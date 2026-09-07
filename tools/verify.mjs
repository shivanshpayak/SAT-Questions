import fs from "node:fs";
import path from "node:path";

const EXPECTED = 610;
const DIFFICULTIES = ["Easy", "Medium", "Hard"];
// Body text bleeding into a metadata field joins on a space, so the stray
// fragment usually starts with sentence punctuation ("Hard . rettgeri",
// "Algebra , which is equivalent"). Real taxonomy values never contain a
// space before punctuation, though they do contain commas ("Ratios, rates,
// proportional relationships, and units") and run as long as 77 characters,
// so length alone is not a usable signal.
const CONTAMINATION = /\s[.,;:]/;
const MAX_FIELD_LENGTH = 100;

function imagesOf(question) {
  return [
    ...(question.stem.images ?? []),
    ...question.choices.flatMap((c) => c.images ?? []),
    ...(question.rationale?.images ?? []),
  ];
}

function htmlOf(question) {
  return [question.stem.html ?? "", ...question.choices.map((c) => c.html ?? "")];
}

export function verifyDataset({ reading, math, imageSize, expectedCount = EXPECTED }) {
  const failures = [];
  const summary = {};

  for (const [name, dataset] of Object.entries({ reading, math })) {
    const questions = dataset.questions;
    if (questions.length !== expectedCount) {
      failures.push(`${name}: count ${questions.length}, expected ${expectedCount}`);
    }
    const ids = new Set(questions.map((q) => q.id));
    if (ids.size !== questions.length) failures.push(`${name}: duplicate ids`);

    const tiers = { clean: 0, fallback: 0, flagged: 0 };
    for (const q of questions) {
      tiers[q.tier] = (tiers[q.tier] ?? 0) + 1;
      if (q.tier === "flagged") continue;

      if (!q.correct && !q.selfMarked) failures.push(`${name}/${q.id}: no-correct-answer`);

      if (!DIFFICULTIES.includes(q.difficulty)) {
        failures.push(`${name}/${q.id}: bad-difficulty ${JSON.stringify(q.difficulty)}`);
      }
      for (const field of ["domain", "skill"]) {
        const value = q[field];
        if (!value) failures.push(`${name}/${q.id}: empty-${field}`);
        else if (CONTAMINATION.test(value) || value.length > MAX_FIELD_LENGTH) {
          failures.push(`${name}/${q.id}: contaminated-${field} ${JSON.stringify(value.slice(0, 50))}`);
        }
      }

      for (const html of htmlOf(q)) {
        if (html.includes("Correct Answer")) failures.push(`${name}/${q.id}: answer-leak`);
      }
      for (const file of imagesOf(q)) {
        if (imageSize(file) <= 200) failures.push(`${name}/${q.id}: missing-image ${file}`);
      }
      if (name === "reading" && /\bunderlined\b/.test(q.stem.html ?? "") && !/<u>/.test(q.stem.html)) {
        failures.push(`${name}/${q.id}: lost-underline`);
      }
    }
    summary[name] = tiers;
  }

  return { ok: failures.length === 0, failures, summary };
}

if (import.meta.filename === path.resolve(process.argv[1])) {
  const load = (f) => JSON.parse(fs.readFileSync(path.join("data", f), "utf8"));
  const imageSize = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };

  const result = verifyDataset({ reading: load("reading.json"), math: load("math.json"), imageSize });

  for (const [subject, tiers] of Object.entries(result.summary)) {
    console.log(`${subject}: clean ${tiers.clean} | fallback ${tiers.fallback} | flagged ${tiers.flagged}`);
  }
  if (result.ok) {
    console.log(`\nPASS - dataset verified`);
  } else {
    console.error(`\nFAIL - ${result.failures.length} problem(s):`);
    for (const failure of result.failures.slice(0, 50)) console.error(`  ${failure}`);
    if (result.failures.length > 50) console.error(`  ...and ${result.failures.length - 50} more`);
    process.exit(1);
  }
}
