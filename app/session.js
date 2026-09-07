import { answersEqual } from "./answers.js";

export function startSession({ ids, mode = "practice", size = null, limitMs = null, startedAt = Date.now() }) {
  const list = mode === "timed" && size ? ids.slice(0, size) : [...ids];
  return { ids: list, idx: 0, mode, limitMs, startedAt, responses: {} };
}

export function currentId(session) {
  return session.ids[session.idx] ?? null;
}

export function gradeAnswer(question, answer) {
  // A self-marked question has no stored answer to compare against, so the
  // verdict belongs to the user after they see the rationale.
  if (question.selfMarked || question.correct == null) {
    return { correct: null, selfMarked: true };
  }
  return { correct: answersEqual(answer, question.correct), selfMarked: false };
}

export function submitAnswer(session, { answer, correct }) {
  const id = currentId(session);
  if (id === null) return session;
  return {
    ...session,
    responses: { ...session.responses, [id]: { answer, correct, at: Date.now() } },
  };
}

export function advance(session) {
  return { ...session, idx: Math.min(session.idx + 1, session.ids.length) };
}

export function isComplete(session) {
  return session.idx >= session.ids.length;
}

export function scoreSession(session) {
  const responses = Object.values(session.responses);
  const answered = responses.length;
  const correct = responses.filter((r) => r.correct === true).length;
  return {
    total: session.ids.length,
    answered,
    correct,
    accuracy: answered === 0 ? 0 : correct / answered,
  };
}
