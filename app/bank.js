export function mergeOverrides(questions, overrides = {}) {
  return questions.map((q) => (overrides[q.id] ? { ...q, ...overrides[q.id] } : q));
}

// Flagged questions are excluded so the user is never scored on a broken
// question. Fallback questions are fine: they are usable, just not auto-graded.
export function practicePool(questions) {
  return questions.filter((q) => q.tier !== "flagged");
}

function countBy(questions, field) {
  const counts = new Map();
  for (const q of questions) {
    const value = q[field];
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function facetsOf(questions) {
  return { domains: countBy(questions, "domain"), skills: countBy(questions, "skill") };
}

export function filterQuestions(questions, { domains = [], skills = [], ids = null } = {}) {
  const idSet = ids ? new Set(ids) : null;
  return questions.filter(
    (q) =>
      (domains.length === 0 || domains.includes(q.domain)) &&
      (skills.length === 0 || skills.includes(q.skill)) &&
      (idSet === null || idSet.has(q.id)),
  );
}

export function poolKey({ subject, domains = [], skills = [], pool = "all" }) {
  const sorted = (list) => [...list].sort().join("|");
  return `${subject}::${pool}::${sorted(domains)}::${sorted(skills)}`;
}
