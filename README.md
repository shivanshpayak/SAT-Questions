# SAT Practice

Randomized, interactive practice over 1,220 College Board questions
(610 Reading and Writing, 610 Math) extracted from the source PDFs.

## Running it

    npm install
    npm run serve

Then open http://127.0.0.1:8123 — or just double-click `start.cmd`.

Pick a subject, narrow by domain or skill, and go. Multiple-choice
questions are clickable; free-response questions get an answer box.
Checking an answer reveals whether you were right, the correct answer,
and College Board's full explanation.

Progress is stored in your browser, so it survives a reload but does not
follow you to another machine.

## Rebuilding the data

The app reads `data/*.json` and `images/`, which are generated and
gitignored. To rebuild from the PDFs:

    npm run extract      # resumable; only redoes what is missing
    npm run verify       # integrity gate, must pass

Useful flags: `--force` recomputes everything, `--only <id>` rebuilds one
question, `--reading` / `--math` restrict to one subject.

`npm run diagnose` reports how many questions parse cleanly without
writing any output.

A full rebuild takes about 12 minutes and produces ~104 MB of images. A
re-run with nothing missing takes about 26 seconds.

## How it works

**Math questions are cropped images.** Their equations and figures are
drawn with unmapped Type3 fonts, so text extraction silently drops every
number — 534 of 610 stems come out with no digits at all. Cropping the
page region preserves them exactly. Crop bounds are derived from text
anchors and stop above the answer line, so the answer cannot leak.

**Reading questions are real text**, which keeps them selectable and
readable at any width. Underlines are recovered by scanning for
horizontal rules (173 questions refer to an underlined portion, so losing
them would make those questions unanswerable), and italics by measuring
glyph stem angle, since every font is an unnamed Type3 whose metadata
reports neither.

**38 Math questions are self-marked.** The source PDF omits their answer
line entirely and states the answer only inside the explanation, so the
app shows the explanation and asks you to mark yourself. They still count
toward your stats.

Every question in both PDFs is difficulty **Hard** — that is how the
export was filtered — so there is no difficulty control.

## Corrections

If a question is wrong, put the fix in `data/overrides.json`, keyed by
question id. It is merged over the generated data at load, so rebuilding
never destroys a correction. The **Review** screen writes this file for
you. Never hand-edit the generated files.

## Layout

    tools/      extraction pipeline and the static server
    app/        the browser app (plain ES modules, no framework)
    data/       generated question JSON, plus overrides.json
    images/     generated Math crops
    docs/       design spec and implementation plans

## Tests

    npm test

Runs 138 tests with no test framework — `node --test` only. Alongside the
unit tests, `app/integration.test.js` runs the real 1,220-question
dataset through the same modules the browser uses, checking that every
stem renders, no rendered surface leaks an answer, every stored answer
form is accepted, and every referenced image exists.
