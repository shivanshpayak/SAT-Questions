import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isImageQuestion, choiceLetters, stemHtml, choiceHtml, rationaleHtml, escapeAttr, sourceUrl,
} from "./render.js";

const reading = {
  id: "r1", subject: "reading", presentation: "text", format: "mcq", source: { pages: [12, 13] },
  stem: { html: "<p>Passage with <u>underline</u> and <em>italics</em>.</p>" },
  choices: [
    { label: "A", html: "<p>A. first</p>" },
    { label: "B", html: "<p>B. second</p>" },
  ],
  rationale: { html: "<p>Because.</p>" },
};

const math = {
  id: "m1", subject: "math", presentation: "image", format: "mcq", source: { pages: [177, 179] },
  stem: { images: ["images/math/m1-stem.png", "images/math/m1-stem-1.png"] },
  choices: [{ label: "A", images: ["images/math/m1-choice-A.png"] }],
  rationale: { images: ["images/math/m1-rationale.png"] },
};

test("distinguishes image questions from text questions", () => {
  assert.equal(isImageQuestion(math), true);
  assert.equal(isImageQuestion(reading), false);
});

test("choiceLetters lists the labels in order", () => {
  assert.deepEqual(choiceLetters(reading), ["A", "B"]);
  assert.deepEqual(choiceLetters(math), ["A"]);
  assert.deepEqual(choiceLetters({ choices: [] }), []);
});

test("a Reading stem passes its markup through intact", () => {
  const html = stemHtml(reading);
  assert.ok(html.includes("<u>underline</u>"), "underlines must survive");
  assert.ok(html.includes("<em>italics</em>"), "italics must survive");
});

test("a Math stem becomes one img per crop, in order", () => {
  const html = stemHtml(math);
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(srcs, ["images/math/m1-stem.png", "images/math/m1-stem-1.png"]);
  assert.ok(html.includes('loading="lazy"'), "images must load lazily");
  assert.ok(html.includes("alt="), "images need alt text");
});

test("choiceHtml renders text and image choices", () => {
  assert.ok(choiceHtml(reading, "B").includes("second"));
  assert.ok(choiceHtml(math, "A").includes("images/math/m1-choice-A.png"));
  assert.equal(choiceHtml(reading, "Z"), "");
});

test("rationaleHtml handles both shapes", () => {
  assert.ok(rationaleHtml(reading).includes("Because."));
  assert.ok(rationaleHtml(math).includes("m1-rationale.png"));
  assert.equal(rationaleHtml({ rationale: {} }), "");
});

test("escapeAttr neutralises quotes and angle brackets", () => {
  assert.equal(escapeAttr('a"b<c>&d'), "a&quot;b&lt;c&gt;&amp;d");
});

test("sourceUrl points at the page in the source PDF, counting from one", () => {
  // Stored pages are 0-based mupdf indices; a PDF viewer's #page= counts from 1.
  assert.deepEqual(sourceUrl(math), { href: "/Math%20SAT%20Questions.pdf#page=178", page: 178 });
  assert.deepEqual(sourceUrl(reading), { href: "/SAT%20Reading.pdf#page=13", page: 13 });
});

test("sourceUrl gives up rather than guessing a page", () => {
  assert.equal(sourceUrl({ subject: "math" }), null);
  assert.equal(sourceUrl({ subject: "math", source: { pages: [] } }), null);
  assert.equal(sourceUrl({ subject: "geography", source: { pages: [1] } }), null);
  assert.equal(sourceUrl(undefined), null);
});
