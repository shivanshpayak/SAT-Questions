# SAT Question Randomizer — Design

**Date:** 2026-09-06
**Status:** Approved for planning

## Problem

Two College Board Question Bank PDF exports sit in this directory: `Math SAT Questions.pdf` (642 pages) and `SAT Reading.pdf` (687 pages), 610 questions each. In the PDFs the questions are not clickable, not randomized, and answers sit directly beneath each question where they spoil it.

Goal: a local, offline practice app that serves these 1,220 questions in randomized order with real interaction — clickable multiple choice, typed free-response answers, and answers plus explanations revealed on demand.

## Findings that constrain the design

Established by direct measurement, not assumption:

1. **Both PDFs share one rigid structure.** Each question is `Question ID: <hex>` then a metadata table (Assessment / Test / Domain / Skill / Difficulty), then `Question`, then an optional `Answer` block with choices `A.`–`D.`, then `Correct Answer: X`, then `Rationale`. All 610 IDs in each file are unique.

2. **Reading text extracts cleanly.** 610/610 stems, choices, correct answers, and rationales. Domains: Information and Ideas (238), Standard English Conventions (158), Craft and Structure (130), Expression of Ideas (84).

3. **Math text extraction is unusable.** 534 of 610 stems extract with *zero digits*: every equation, number, and variable is dropped. 38 questions have no text-extractable correct answer. Cause: the math is drawn with Type3 fonts carrying no Unicode mapping, and figures are vector paths. There are zero raster images in either PDF.

4. **Region cropping reproduces math perfectly.** Rendering a page region to a pixmap preserves equations, graphs, and italic variables at full fidelity. Because the source is vector, crops stay crisp at any scale.

5. **Underlines are recoverable.** 173 Reading questions refer to an "underlined" portion, which plain text extraction loses. A pixel scan for horizontal dark runs finds them reliably; on the test page it recovered exactly `"How lifelike are they?"`. Discriminating rule: bands at most 4px tall (at 3x) and at least 15pt wide are underlines; thicker bands are table shading and are rejected.

6. **Font style is not readable from font metadata.** Every font in both PDFs is an unnamed Type3 (`Type3 (3367 0 R)`), so `isBold()` and `isItalic()` return false universally. However, *font identity changes exactly at style boundaries*: on Reading page 1 the italic title "Ebony and Topaz" is drawn with font `3367` while the surrounding prose uses `3365`. Style is therefore recoverable from font-run boundaries plus a per-font measurement, not from names.

7. **Tooling.** Node 24 and npm are available; Python is not. The `pdftotext` on PATH is xpdf's and offers no bounding boxes. The `mupdf` npm package (WASM, no native build) supplies page rendering, character-level quads, and font identity. It is the only runtime dependency.

## Architecture

Two phases. Nothing parses a PDF at runtime.

```
PDFs --> [ tools/ extraction ] --> data/*.json + images/ --> [ app/ ] --> browser
```

### Phase A — extraction (`tools/`, run offline)

Resumable and per-question cached: a re-run only reprocesses questions whose inputs changed.

**Segmentation.** Scan every page for `Question ID:` anchors. A question spans from its anchor to the next anchor, possibly crossing a page boundary. Within that span, locate the `Question`, `Answer`, `Correct Answer:`, and `Rationale` anchor lines and record their y coordinates.

**Format detection.** A question is `mcq` when the span contains an `Answer` heading followed by lines beginning `A.`, `B.`, `C.`, `D.` before the `Correct Answer:` line; otherwise it is `spr` (student-produced response, an input box). Measured expectation: Reading is 610/610 `mcq`; Math text extraction currently exposes choices for 375 of 610, so the remainder resolve as `spr` or as choices recoverable only from crops. Any Math question detected as `spr` whose `Correct Answer:` value is a letter A–D is contradictory and is flagged rather than guessed at.

**Metadata.** The header row (`Assessment`, `Test`, `Domain`, `Skill`, `Difficulty`) supplies its own x positions, which define column boundaries for that question. Assign each metadata line to the nearest column start at or left of its x, joining wrapped values such as "Linear inequalities in one / or two variables". This is self-calibrating per question, so varying column layouts do not matter.

**Reading — faithful text.** Walk characters with quads and fonts within each region. Group by baseline into lines, and lines into paragraphs by vertical gap. Emit escaped HTML, wrapping runs in `<u>` from detected underline bands. A character is underlined when its glyph bottom sits within roughly 11pt above a band and its x range overlaps the band.

**Italics.** Because font names are useless (finding 6), italics are recovered in two steps. First, group characters into runs by font identity — these boundaries are exact. Second, classify each distinct font on a page once by measuring glyph slant: render a tall-stemmed glyph from that font at high scale and compare the horizontal ink centroid of its top third against its bottom third; a rightward shift means italic. Results are cached per page, so at most a handful of measurements occur per page.

Italics are **cosmetic** — unlike underlines, no question becomes unanswerable without them. If slant classification is inconclusive for a font, its runs render as plain text rather than guessing. Bold is not detected and is deliberately dropped: it is effectively absent from passage prose, and a wrong `<strong>` is worse than none.

**Underline detection.** Render the page grayscale at 3x. Collect horizontal runs of dark pixels at least 20px wide, merge runs on adjacent rows into bands, then merge bands sharing a y whose x gap is at most 8pt (descenders break the line). Keep bands at most 4 rows tall and at least 15pt wide.

**Math — cropped images.** Per question emit a stem crop, one crop per answer choice, and a rationale crop. Crop bounds come from the anchor y coordinates. Choice `i` spans from its `A.`/`B.`/`C.`/`D.` line down to the next choice's start, the last ending at the `Correct Answer:` line. Rendered grayscale — the content is black on white, so this is visually lossless at roughly a third the size.

Sections crossing a page boundary emit one crop per page part, stacked in order by the UI.

**PNG encoding** (`tools/lib/png.mjs`) is a small grayscale encoder over Node's built-in `zlib`. Writing it directly rather than using `Pixmap.asPNG()` allows trimming each crop to its ink bounding box, which removes surrounding whitespace and shrinks output. No extra dependency.

### Answer leakage

A hard requirement, enforced by test: **no stem or choice crop may extend to or past the `Correct Answer:` line.** Verification asserts the y bound for all 610 math questions. The rationale is always a separate asset, delivered only after the user answers.

### Tiering and manual correction

Extraction is tolerant, not all-or-nothing. Every question validates independently into one of three tiers:

| Tier | Meaning | Pool |
|---|---|---|
| `clean` | Passed all checks | Included |
| `fallback` | Text reassembly suspect; auto-degraded to an image crop | Included |
| `flagged` | Genuinely wrong, with a recorded reason | Excluded until fixed |

Tier 2 keeps manual work rare: a crop depends only on anchor words that extract reliably, so nearly anything that defeats *text* reassembly can degrade to an *image* with no human involvement.

**Corrections live in `data/overrides.json`, keyed by question ID, and are merged over generated data at load.** Generated files are never hand-edited, so re-running extraction can never destroy a correction.

Manual correction is restricted to cheap operations — adjust a crop boundary, fix an answer key, exclude a question. **Retyping question content is never required**; for math that would mean authoring LaTeX, so the answer to an unparseable math question is always "crop it."

The app ships usable with whatever is clean; flagged questions trickle in later.

### Phase B — the app (`app/`)

`start.cmd` runs `tools/serve.mjs`, a dependency-free static server, and opens the browser. A server is required because `file://` blocks `fetch`. It also exposes `POST /api/overrides`, which writes `data/overrides.json` so corrections made in the UI are durable.

Modules stay small and single-purpose. Logic modules are pure ESM, importable under `node --test` with no DOM:

| Module | Responsibility |
|---|---|
| `bank.js` | Load data, apply filters, maintain the no-repeat queue |
| `session.js` | Practice and timed-set flow, scoring |
| `store.js` | localStorage: progress, queues, settings |
| `answers.js` | Free-response normalization and equivalence |
| `render.js` | Question rendering (text or image), choices, feedback |
| `ui.js` | Screen routing |

**Screens:** Home (subject, mode, filters), Question, Results, Stats, Review.

**Features.**

- *Filters* — subject, domain, skill, difficulty, all sourced from the parsed metadata.
- *No-repeat shuffle* — seeded Fisher-Yates over the filtered pool, with order and index persisted. Changing filters starts a new queue. Exhausting the pool reshuffles with a fresh seed.
- *Timed sets* — N questions (default 20), elapsed timer, scored at the end. An optional time limit auto-submits.
- *Progress* — per-question attempt history, accuracy by domain and skill, and a "review missed" pool that re-serves incorrect questions.
- *Feedback* — right/wrong, the correct answer, and the full College Board rationale.

**Review screen** lists flagged questions with the raw PDF crop beside the extracted result, and writes fixes to `overrides.json`.

**Free-response matching** (`answers.js`): trim, strip spaces, normalize Unicode minus to ASCII, drop a leading `+`. If both values parse as rationals, compare exactly by cross-multiplication, so `3/2`, `1.5`, and `1.50` all match. Otherwise compare normalized strings case-insensitively. Correct-answer fields listing alternates separated by `or` or `,` accept any listed value.

**The 38 image-answer math questions** cannot be string-matched. They present an input box, then on reveal show the answer image and let the user self-mark. They count toward statistics.

### Directory layout

```
SAT Questions/
  Math SAT Questions.pdf
  SAT Reading.pdf
  package.json               # one dependency: mupdf
  start.cmd                  # launches serve.mjs, opens browser
  tools/
    lib/{pdf,png,segment,metadata,text,underline,cache}.mjs
    diagnose.mjs             # Stage 1 report
    extract.mjs              # writes data/ + images/
    verify.mjs               # data-integrity gate
    serve.mjs                # static server + POST /api/overrides
  data/{reading,math,overrides,diagnostic}.json
  images/math/*.png
  app/{index.html,styles.css,main,bank,session,store,answers,render,ui}.js
  docs/superpowers/specs/
```

`answers.js` lives in `app/` and is imported by both the app and the
test suite; extraction does not depend on it.

## Data model

```json
{
  "id": "22a41819",
  "subject": "reading",
  "domain": "Craft and Structure",
  "skill": "Words in Context",
  "difficulty": "Hard",
  "format": "mcq",
  "presentation": "text",
  "stem": { "html": "..." },
  "choices": [ { "label": "A", "html": "..." } ],
  "correct": "B",
  "rationale": { "html": "..." },
  "tier": "clean",
  "flags": [],
  "source": { "pages": [1], "anchors": { "question": 127.0 } }
}
```

`presentation: "image"` replaces `html` with `images: [...]` (an array, for page-spanning crops). `format: "spr"` omits `choices` and carries a string or image `correct`.

## Testing

TDD with Node's built-in runner; no test dependency.

Unit tests cover: metadata column assignment, character-run to HTML conversion (italic and underline), underline band filtering, glyph-slant italic classification, free-response equivalence, filter logic, no-repeat queue exhaustion, session scoring, and PNG round-trip.

Two tests are pinned to known ground truth in the source PDFs, so a regression in extraction cannot pass silently: Reading page 1 must yield the underlined span `"How lifelike are they?"`, and Reading page 0 must render `Ebony and Topaz` as italic.

`tools/verify.mjs` is a data-integrity gate over all 1,220 questions that must pass before the app is considered working:

- 610 questions per subject, all IDs unique
- every `clean` or `fallback` question has a correct answer
- no stem or choice crop region reaches the `Correct Answer:` line
- every referenced image exists and exceeds 200 bytes
- every Reading stem containing "underlined" has at least one detected underline
- tier counts reported per subject

## Build order

Each stage ends in evidence, not a claim.

1. **Diagnostic.** Segmentation plus validation across all 1,220 questions, emitting `data/diagnostic.json` and a printed report of tier counts and flag reasons. Builds nothing else. This replaces estimates with real numbers, and a bad result forces redesign before any app effort is spent.
2. **Extraction.** Reading text with formatting; math crops; tiering, fallback, and the overrides merge. Gated by `verify.mjs`.
3. **App.** Data loading, filters, shuffle, question rendering, feedback, persistence.
4. **Modes and review.** Timed sets, stats, and the flagged-question review screen.

## Decisions taken

- Local folder plus launcher, not a hosted link or single file — no size ceiling and best fidelity.
- Reading as real text with recovered underlines, not images — keeps it selectable, searchable, and readable on any screen.
- Math as images — forced by the extraction findings; there is no correct text alternative.
- Grayscale rendering — visually lossless for black-on-white, about a third the size.
- Flagged questions excluded from the pool, so the user is never scored on a broken question.

## Out of scope

Shuffling answer-choice order, editing question content by hand, an account system, cross-device sync, and hosting. Reading choice shuffling is deferred rather than rejected; math choices are baked into crops and cannot shuffle.
