import { mergeOverrides, practicePool, facetsOf } from "./bank.js";
import { rationaleHtml } from "./render.js";

export async function loadSubject(subject, fetchJson) {
  const data = await fetchJson(`/data/${subject}.json`);
  let overrides = {};
  try {
    overrides = await fetchJson("/data/overrides.json");
  } catch {
    overrides = {}; // absent until the first correction is saved
  }
  const questions = practicePool(mergeOverrides(data.questions, overrides));
  return { questions, facets: facetsOf(questions) };
}

export function feedbackModel(question, { answer, correct }) {
  const selfMarked = correct === null;
  return {
    verdict: selfMarked ? "unmarked" : correct ? "correct" : "wrong",
    correctText: selfMarked ? null : question.correct,
    rationale: rationaleHtml(question),
    userAnswer: answer,
    selfMarked,
  };
}

export function showScreen(name) {
  for (const section of document.querySelectorAll(".screen")) {
    section.hidden = section.id !== `screen-${name}`;
  }
}
