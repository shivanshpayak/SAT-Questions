import { pageLines } from "./pdf.mjs";

const ID_RE = /^Question ID:\s*([0-9a-f]{6,})$/;

export function findSpans(doc) {
  const starts = [];
  const pageCount = doc.countPages();
  for (let page = 0; page < pageCount; page++) {
    for (const line of pageLines(doc.loadPage(page))) {
      const match = ID_RE.exec(line.text.trim());
      if (match) starts.push({ id: match[1], page, y: line.y });
    }
  }
  return starts.map((start, i) => {
    const next = starts[i + 1];
    return {
      id: start.id,
      startPage: start.page,
      startY: start.y,
      endPage: next ? next.page : pageCount - 1,
      endY: next ? next.y : Infinity,
    };
  });
}

export function linesInSpan(doc, span) {
  const out = [];
  for (let page = span.startPage; page <= span.endPage; page++) {
    for (const line of pageLines(doc.loadPage(page))) {
      if (page === span.startPage && line.y < span.startY) continue;
      if (page === span.endPage && line.y >= span.endY) continue;
      out.push({ page, ...line });
    }
  }
  return out;
}

export function findAnchors(lines) {
  const anchors = {};
  for (const line of lines) {
    const text = line.text.trim();
    const at = { page: line.page, y: line.y, text };
    if (text === "Question" && !anchors.question) anchors.question = at;
    else if (text === "Answer" && !anchors.answer) anchors.answer = at;
    else if (text.startsWith("Correct Answer:") && !anchors.correct) anchors.correct = at;
    else if (text === "Rationale" && !anchors.rationale) anchors.rationale = at;
  }
  return anchors;
}
