import fs from "node:fs";
import path from "node:path";
import { MATH_PDF, READING_PDF, openDoc } from "./lib/pdf.mjs";
import { findSpans } from "./lib/segment.mjs";
import { extractReadingQuestion } from "./extract-reading.mjs";
import { extractMathQuestion } from "./extract-math.mjs";

const MIN_IMAGE_BYTES = 200;

function imagesOf(question) {
  return [
    ...(question.stem?.images ?? []),
    ...(question.choices ?? []).flatMap((c) => c.images ?? []),
    ...(question.rationale?.images ?? []),
  ];
}

export function planWork(spans, previous, { force = false, only = null, imageSize = () => 4096 } = {}) {
  const byId = new Map((previous?.questions ?? []).map((q) => [q.id, q]));
  const reuse = [];
  const compute = [];

  for (const span of spans) {
    const prev = byId.get(span.id);

    if (only) {
      if (span.id === only) compute.push(span);
      else if (prev) reuse.push(prev);
      continue;
    }
    if (force || !prev) {
      compute.push(span);
      continue;
    }
    if (imagesOf(prev).every((file) => imageSize(file) > MIN_IMAGE_BYTES)) reuse.push(prev);
    else compute.push(span);
  }
  return { reuse, compute };
}

function run(subject, file, extractOne, options) {
  const outFile = path.join("data", `${subject}.json`);
  const previous = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : null;
  const doc = openDoc(file);
  const spans = findSpans(doc);

  const imageSize = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
  const { reuse, compute } = planWork(spans, previous, { ...options, imageSize });
  console.log(`${subject}: reusing ${reuse.length}, computing ${compute.length}`);

  const fresh = [];
  for (const [i, span] of compute.entries()) {
    fresh.push(extractOne(doc, span));
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${compute.length}`);
  }

  const order = new Map(spans.map((s, i) => [s.id, i]));
  const questions = [...reuse, ...fresh].sort((a, b) => order.get(a.id) - order.get(b.id));

  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), questions }, null, 2));
  console.log(`Wrote ${outFile} (${questions.length} questions)`);
}

if (import.meta.filename === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
  const options = { force: args.includes("--force"), only: valueOf("--only") };

  const wantReading = !args.includes("--math");
  const wantMath = !args.includes("--reading");

  if (wantReading) run("reading", READING_PDF, extractReadingQuestion, options);
  if (wantMath) run("math", MATH_PDF, extractMathQuestion, options);
}
