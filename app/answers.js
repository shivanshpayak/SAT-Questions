// Unicode minus, en dash and em dash all appear where a minus sign is meant.
const DASHES = /[−–—]/g;

export function normalizeAnswer(raw) {
  return String(raw ?? "")
    .replace(DASHES, "-")
    .replace(/\s+/g, "")
    .replace(/^\+/, "")
    .toLowerCase();
}

export function parseRational(raw) {
  const text = normalizeAnswer(raw);

  const decimal = /^(-?)(\d*)(?:\.(\d+))?$/.exec(text);
  if (decimal && (decimal[2] || decimal[3])) {
    const sign = decimal[1] === "-" ? -1 : 1;
    const whole = decimal[2] || "0";
    const frac = decimal[3] || "";
    return { n: sign * Number(whole + frac), d: 10 ** frac.length };
  }

  const fraction = /^(-?\d+)\/(\d+)$/.exec(text);
  if (fraction) {
    const d = Number(fraction[2]);
    if (d === 0) return null;
    return { n: Number(fraction[1]), d };
  }

  return null;
}

export function acceptedAnswers(correctRaw) {
  return String(correctRaw ?? "")
    .split(/,|\sor\s/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function answersEqual(userRaw, correctRaw) {
  const user = normalizeAnswer(userRaw);
  if (!user) return false;

  const userRational = parseRational(user);
  for (const variant of acceptedAnswers(correctRaw)) {
    if (normalizeAnswer(variant) === user) return true;
    const variantRational = parseRational(variant);
    // Cross-multiply for exact equality without floating point drift.
    if (
      userRational &&
      variantRational &&
      userRational.n * variantRational.d === variantRational.n * userRational.d
    ) {
      return true;
    }
  }
  return false;
}
