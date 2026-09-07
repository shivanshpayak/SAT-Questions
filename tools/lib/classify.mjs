// Matched against trimmed text, so the separator after the dot may be gone
// entirely: most Math choices extract as a bare "A." because the choice
// itself is vector math with no text content.
const CHOICE_RE = /^([A-D])\.(?:\s|$)/;

function before(a, b) {
  if (!a || !b) return false;
  return a.page < b.page || (a.page === b.page && a.y < b.y);
}

export function findChoiceLines(lines, anchors) {
  if (!anchors.answer) return [];
  const stop = anchors.correct;
  const seen = new Map();
  for (const line of lines) {
    if (!before(anchors.answer, line)) continue;
    if (stop && !before(line, stop)) continue;
    const match = CHOICE_RE.exec(line.text.trim());
    if (match && !seen.has(match[1])) seen.set(match[1], line);
  }
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, line]) => ({ label, line }));
}

export function classifyQuestion({ id, subject, anchors, lines, metadata }) {
  const flags = [];

  if (!anchors.question) flags.push("no-question-anchor");
  if (!anchors.rationale) flags.push("no-rationale");
  if (!metadata) flags.push("no-metadata");

  const correctRaw = anchors.correct
    ? anchors.correct.text.replace(/^Correct Answer:\s*/, "").trim()
    : null;
  if (!correctRaw) flags.push("no-correct-answer");

  const choices = findChoiceLines(lines, anchors);
  const format = anchors.answer && choices.length >= 2 ? "mcq" : "spr";

  if (anchors.answer && choices.length > 0 && choices.length < 4) flags.push("mcq-missing-choices");
  if (anchors.question && anchors.answer && !before(anchors.question, anchors.answer)) {
    flags.push("answer-before-question");
  }
  if (format === "spr" && correctRaw && /^[A-D]$/.test(correctRaw)) flags.push("spr-with-letter-answer");

  const blocking = flags.some((f) => f !== "no-rationale");
  return {
    id,
    subject,
    tier: blocking ? "flagged" : flags.length ? "fallback" : "clean",
    format,
    flags,
    correctRaw,
    choiceCount: choices.length,
  };
}
