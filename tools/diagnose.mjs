import fs from "node:fs";
import path from "node:path";
import { MATH_PDF, READING_PDF, openDoc } from "./lib/pdf.mjs";
import { findSpans, linesInSpan, findAnchors } from "./lib/segment.mjs";
import { parseMetadata } from "./lib/metadata.mjs";
import { classifyQuestion } from "./lib/classify.mjs";

function diagnose(file, subject) {
  const doc = openDoc(file);
  const questions = findSpans(doc).map((span) => {
    const lines = linesInSpan(doc, span);
    const anchors = findAnchors(lines);
    const metadata = parseMetadata(lines, anchors.question?.y);
    const result = classifyQuestion({ id: span.id, subject, anchors, lines, metadata });
    return { ...result, domain: metadata?.domain ?? null, difficulty: metadata?.difficulty ?? null };
  });

  const tiers = { clean: 0, fallback: 0, flagged: 0 };
  const flagCounts = {};
  for (const q of questions) {
    tiers[q.tier]++;
    for (const flag of q.flags) flagCounts[flag] = (flagCounts[flag] ?? 0) + 1;
  }
  return { total: questions.length, tiers, flagCounts, questions };
}

const subjects = { math: diagnose(MATH_PDF, "math"), reading: diagnose(READING_PDF, "reading") };

fs.mkdirSync(path.join(process.cwd(), "data"), { recursive: true });
fs.writeFileSync(
  path.join(process.cwd(), "data", "diagnostic.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), subjects }, null, 2),
);

for (const [name, report] of Object.entries(subjects)) {
  console.log(`\n=== ${name.toUpperCase()} (${report.total} questions) ===`);
  console.log(`  clean ${report.tiers.clean} | fallback ${report.tiers.fallback} | flagged ${report.tiers.flagged}`);
  const formats = report.questions.reduce((acc, q) => ({ ...acc, [q.format]: (acc[q.format] ?? 0) + 1 }), {});
  console.log(`  formats: ${JSON.stringify(formats)}`);
  if (Object.keys(report.flagCounts).length) {
    console.log("  flags:");
    for (const [flag, count] of Object.entries(report.flagCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${count.toString().padStart(4)}  ${flag}`);
    }
  }
}
console.log("\nWrote data/diagnostic.json");
