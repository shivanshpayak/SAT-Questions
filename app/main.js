import { loadSubject, feedbackModel, showScreen } from "./ui.js";
import { filterQuestions, poolKey } from "./bank.js";
import { createQueue, currentId as queueCurrent, advanceQueue } from "./queue.js";
import { createStore } from "./store.js";
import {
  startSession, currentId, gradeAnswer, submitAnswer, advance, isComplete, scoreSession,
} from "./session.js";
import { stemHtml, choiceHtml, choiceLetters, escapeAttr, sourceUrl } from "./render.js";
import { formatDuration, createTimer } from "./timer.js";
import { buildOverride, saveOverrides } from "./overrides.js";

const store = createStore(
  globalThis.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} },
);

const fetchJson = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
};

const postJson = async (path, body) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
};

const state = {
  subject: null, questions: [], facets: null, byId: new Map(),
  domains: [], skills: [], onlyMissed: false,
  session: null, queue: null, queueKey: null, selected: null, answered: false,
};

const el = (id) => document.getElementById(id);

function selectedPool() {
  const ids = state.onlyMissed ? store.missedIds() : null;
  return filterQuestions(state.questions, { domains: state.domains, skills: state.skills, ids });
}

function renderChips(container, entries, selected, onToggle) {
  container.replaceChildren();
  for (const [value, count] of entries) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.textContent = `${value} (${count})`;
    chip.setAttribute("aria-pressed", String(selected.includes(value)));
    chip.addEventListener("click", () => onToggle(value));
    container.append(chip);
  }
}

function refreshFilters() {
  renderChips(el("filter-domains"), state.facets.domains, state.domains, (value) => {
    state.domains = state.domains.includes(value)
      ? state.domains.filter((v) => v !== value)
      : [...state.domains, value];
    refreshFilters();
  });
  renderChips(el("filter-skills"), state.facets.skills, state.skills, (value) => {
    state.skills = state.skills.includes(value)
      ? state.skills.filter((v) => v !== value)
      : [...state.skills, value];
    refreshFilters();
  });
  const count = selectedPool().length;
  el("pool-count").textContent = `${count} question${count === 1 ? "" : "s"} match`;
  el("start").disabled = count === 0;
}

async function chooseSubject(subject) {
  state.subject = subject;
  state.domains = [];
  state.skills = [];
  state.onlyMissed = false;
  const { questions, facets } = await loadSubject(subject, fetchJson);
  state.questions = questions;
  state.facets = facets;
  state.byId = new Map(questions.map((q) => [q.id, q]));
  for (const button of document.querySelectorAll(".subject")) {
    button.setAttribute("aria-pressed", String(button.dataset.subject === subject));
  }
  el("home-filters").hidden = false;
  el("only-missed").checked = false;
  refreshFilters();
}

function startPractice() {
  const pool = selectedPool();
  const key = poolKey({
    subject: state.subject, domains: state.domains, skills: state.skills,
    pool: state.onlyMissed ? "missed" : "all",
  });
  const poolIds = pool.map((q) => q.id);
  const saved = store.getQueue(key);
  const stale = !saved || saved.order.length !== poolIds.length;
  state.queue = stale ? createQueue(poolIds, Date.now() >>> 0) : saved;
  state.queueKey = key;

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const size = Number(el("set-size").value) || 20;
  const wanted = mode === "timed" ? Math.min(size, poolIds.length) : poolIds.length;

  const ordered = [];
  let walker = state.queue;
  for (let i = 0; i < wanted; i++) {
    ordered.push(queueCurrent(walker));
    walker = advanceQueue(walker);
  }
  state.queue = walker;
  store.saveQueue(key, walker);

  state.session = startSession({ ids: ordered.filter(Boolean), mode, size: wanted });

  state.timer?.stop();
  state.timer = createTimer({ onTick: (ms) => { el("bar-timer").textContent = formatDuration(ms); } });
  el("bar-timer").hidden = false;
  state.timer.start();

  showScreen("question");
  renderCurrent();
}

// The id, linked to its PDF page. Used on the surfaces that appear only once
// the answer is already out, so it needs no "shows the answer" warning.
function sourceCellHtml(q) {
  const id = `<code class="qid">${escapeAttr(q.id)}</code>`;
  const source = sourceUrl(q);
  if (!source) return id;
  return `<a class="pdf" target="_blank" rel="noopener" href="${escapeAttr(source.href)}"` +
    ` title="Page ${source.page} in the source PDF">${id}</a>`;
}

// Points the wrapper's anchor at the source PDF, or hides the whole thing
// (separator and warning included) when a question has no page recorded.
function showSource(wrapper, q) {
  const source = sourceUrl(q);
  wrapper.hidden = !source;
  if (!source) return;
  const link = wrapper.querySelector("a");
  link.href = source.href;
  link.textContent = `page ${source.page} in the PDF`;
}

function renderCurrent() {
  const id = currentId(state.session);
  if (id === null) return finishSession();
  const q = state.byId.get(id);
  state.selected = null;
  state.answered = false;

  el("q-domain").textContent = q.domain ?? "";
  el("q-skill").textContent = q.skill ?? "";
  el("q-progress").textContent = `${state.session.idx + 1} of ${state.session.ids.length}`;
  el("q-id").textContent = q.id;
  showSource(el("q-source"), q);
  el("q-stem").innerHTML = stemHtml(q);
  el("q-feedback").hidden = true;
  el("q-submit").textContent = "Check answer";
  el("q-submit").disabled = false;

  const letters = choiceLetters(q);
  const choices = el("q-choices");
  choices.replaceChildren();
  el("q-entry").hidden = letters.length > 0;

  if (letters.length) {
    for (const label of letters) {
      const button = document.createElement("button");
      button.className = "choice";
      button.type = "button";
      button.dataset.label = label;
      button.setAttribute("aria-pressed", "false");
      button.innerHTML =
        `<span class="tag">${escapeAttr(label)}</span><span class="body">${choiceHtml(q, label)}</span>`;
      button.addEventListener("click", () => {
        if (state.answered) return;
        state.selected = label;
        for (const other of choices.children) other.setAttribute("aria-pressed", String(other === button));
      });
      choices.append(button);
    }
  } else {
    el("q-input").value = "";
    el("q-input").focus();
  }
}

function submit() {
  if (state.answered) {
    state.session = advance(state.session);
    return renderCurrent();
  }
  const q = state.byId.get(currentId(state.session));
  const letters = choiceLetters(q);
  const answer = letters.length ? state.selected : el("q-input").value;
  if (!answer) return;

  const { correct } = gradeAnswer(q, answer);
  state.session = submitAnswer(state.session, { answer, correct });
  if (correct !== null) store.recordAttempt(q.id, correct, answer);
  state.answered = true;

  if (letters.length) {
    for (const button of el("q-choices").children) {
      const label = button.dataset.label;
      if (label === q.correct) button.classList.add("correct");
      else if (label === answer && correct === false) button.classList.add("wrong");
    }
  }
  showFeedback(q, { answer, correct });
  el("q-submit").textContent = isComplete(advance(state.session)) ? "See results" : "Next question";
}

function showFeedback(q, response) {
  const model = feedbackModel(q, response);
  const panel = el("q-feedback");
  const heading =
    model.verdict === "correct"
      ? '<p class="verdict correct">Correct</p>'
      : model.verdict === "wrong"
        ? `<p class="verdict wrong">Not quite &mdash; the answer is ${escapeAttr(model.correctText)}</p>`
        : '<p class="verdict">Check the explanation, then mark yourself</p>';

  const selfMark = model.selfMarked
    ? '<div class="row"><button id="self-right" class="primary">I got it right</button>' +
      '<button id="self-wrong" class="danger">I got it wrong</button></div>'
    : "";

  panel.innerHTML = `${heading}${selfMark}<div class="rationale">${model.rationale}</div>`;
  panel.hidden = false;

  if (model.selfMarked) {
    const mark = (wasCorrect) => {
      store.recordAttempt(q.id, wasCorrect, response.answer);
      state.session = submitAnswer(state.session, { answer: response.answer, correct: wasCorrect });
      el("self-right").disabled = true;
      el("self-wrong").disabled = true;
    };
    el("self-right").addEventListener("click", () => mark(true));
    el("self-wrong").addEventListener("click", () => mark(false));
  }
}

function finishSession() {
  state.timer?.stop();
  el("bar-timer").hidden = true;
  showScreen("results");
  renderResults();
}

function renderResults() {
  const score = scoreSession(state.session);
  const seconds = state.timer ? state.timer.elapsed() : 0;
  el("results-score").textContent =
    `${score.correct} of ${score.answered} correct (${Math.round(score.accuracy * 100)}%) in ${formatDuration(seconds)}`;

  const table = document.createElement("table");
  table.innerHTML = "<tr><th>#</th><th>Question</th><th>Skill</th><th>Your answer</th><th>Correct</th></tr>";
  state.session.ids.forEach((id, i) => {
    const q = state.byId.get(id);
    const response = state.session.responses[id];
    const verdict = !response
      ? "skipped"
      : response.correct === true ? "right"
      : response.correct === false ? "wrong"
      : "self-marked";
    const row = document.createElement("tr");
    row.innerHTML =
      `<td>${i + 1}</td><td>${sourceCellHtml(q)}</td><td>${escapeAttr(q.skill ?? "")}</td>` +
      `<td>${escapeAttr(response?.answer ?? "")}</td>` +
      `<td>${escapeAttr(q.correct ?? "-")} (${verdict})</td>`;
    table.append(row);
  });
  el("results-list").replaceChildren(table);
}

function skip() {
  state.session = advance(state.session);
  renderCurrent();
}

function accuracyTable(rows) {
  const table = document.createElement("table");
  table.innerHTML = "<tr><th>Name</th><th>Seen</th><th>Correct</th><th>Accuracy</th></tr>";
  for (const [name, { seen, correct }] of rows) {
    const row = document.createElement("tr");
    row.innerHTML =
      `<td>${escapeAttr(name)}</td><td>${seen}</td><td>${correct}</td>` +
      `<td>${Math.round((correct / seen) * 100)}%</td>`;
    table.append(row);
  }
  return table;
}

async function renderStats() {
  // Stats span both subjects, so load whichever is not already in memory.
  const all = [];
  for (const subject of ["reading", "math"]) {
    if (state.subject === subject && state.questions.length) {
      all.push(...state.questions);
      continue;
    }
    try {
      const { questions } = await loadSubject(subject, fetchJson);
      all.push(...questions);
    } catch {
      /* a subject that fails to load is simply not counted */
    }
  }

  const progress = store.getProgress();
  const attempted = Object.keys(progress).length;
  const correct = Object.values(progress).filter((e) => e.lastCorrect).length;
  const missed = store.missedIds().length;
  el("stats-summary").textContent =
    attempted === 0
      ? "No questions answered yet."
      : `${attempted} questions attempted, ${correct} currently correct, ${missed} to review.`;

  el("stats-domains").replaceChildren(accuracyTable(store.accuracyBy(all, "domain")));
  el("stats-skills").replaceChildren(accuracyTable(store.accuracyBy(all, "skill")));
}

async function renderReview() {
  // loadSubject drops flagged questions, so read the raw files here.
  const flagged = [];
  for (const subject of ["reading", "math"]) {
    try {
      const data = await fetchJson(`/data/${subject}.json`);
      flagged.push(...data.questions.filter((q) => q.tier === "flagged"));
    } catch {
      /* subject unavailable */
    }
  }

  el("review-empty").hidden = flagged.length > 0;
  const list = el("review-list");
  list.replaceChildren();

  for (const q of flagged) {
    const card = document.createElement("div");
    card.className = "choice";
    card.innerHTML =
      `<div><p>${sourceCellHtml(q)} &middot; ${escapeAttr(q.subject)} &middot; ` +
      `${escapeAttr((q.flags ?? []).join(", "))}</p>` +
      `<div class="stem">${stemHtml(q)}</div>` +
      `<label>Correct answer <input type="text" data-id="${escapeAttr(q.id)}" value="${escapeAttr(q.correct ?? "")}"></label> ` +
      `<button class="primary" data-save="${escapeAttr(q.id)}">Save correction</button></div>`;
    list.append(card);
  }

  // Assignment, not addEventListener: renderReview runs again on every visit
  // to the screen, and addEventListener would stack a duplicate handler each
  // time, saving the same correction repeatedly.
  list.onclick = async (event) => {
    const id = event.target.dataset?.save;
    if (!id) return;
    const input = list.querySelector(`input[data-id="${id}"]`);
    const question = flagged.find((q) => q.id === id);
    const existing = await fetchJson("/data/overrides.json").catch(() => ({}));
    existing[id] = buildOverride(question, { correct: input.value, tier: "clean" });
    try {
      const result = await saveOverrides(existing, postJson);
      el("bar-status").textContent = result.ok ? `Saved correction for ${id}` : "Save failed";
    } catch {
      el("bar-status").textContent = "Save failed";
    }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  for (const button of document.querySelectorAll(".subject")) {
    button.addEventListener("click", () => chooseSubject(button.dataset.subject));
  }
  el("only-missed").addEventListener("change", (e) => {
    state.onlyMissed = e.target.checked;
    refreshFilters();
  });
  el("start").addEventListener("click", startPractice);
  el("q-submit").addEventListener("click", submit);
  el("q-skip").addEventListener("click", skip);
  el("results-again").addEventListener("click", () => showScreen("home"));
  el("nav-home").addEventListener("click", () => showScreen("home"));
  el("q-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  el("nav-stats").addEventListener("click", async () => { showScreen("stats"); await renderStats(); });
  el("nav-review").addEventListener("click", async () => { showScreen("review"); await renderReview(); });
  el("stats-reset").addEventListener("click", () => {
    if (!confirm("Erase all progress? This cannot be undone.")) return;
    store.reset();
    renderStats();
  });

  showScreen("home");
});
