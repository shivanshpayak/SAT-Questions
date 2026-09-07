const COLUMNS = ["assessment", "test", "domain", "skill", "difficulty"];
const HEADINGS = ["Assessment", "Test", "Domain", "Skill", "Difficulty"];
const X_TOLERANCE = 4;

export function parseMetadata(lines, questionY) {
  const headers = HEADINGS.map((h) => lines.find((l) => l.text.trim() === h));
  if (headers.some((h) => !h)) return null;

  const xs = headers.map((h) => h.x);
  const headerY = headers[0].y;
  const buckets = COLUMNS.map(() => []);

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    if (line.y <= headerY) continue;
    if (questionY !== undefined && line.y >= questionY) continue;

    let column = 0;
    for (let i = 0; i < xs.length; i++) if (line.x >= xs[i] - X_TOLERANCE) column = i;
    buckets[column].push(text);
  }

  return Object.fromEntries(COLUMNS.map((name, i) => [name, buckets[i].join(" ")]));
}
