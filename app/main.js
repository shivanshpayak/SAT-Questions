import { loadSubject, feedbackModel, showScreen } from "./ui.js";
import { filterQuestions, poolKey } from "./bank.js";
import { createQueue, currentId as queueCurrent, advanceQueue } from "./queue.js";
import { createStore } from "./store.js";
import {
  startSession, currentId, gradeAnswer, submitAnswer, advance, isComplete, scoreSession,
} from "./session.js";
import { stemHtml, choiceHtml, choiceLetters, escapeAttr } from "./render.js";

const store = createStore(
  globalThis.localStorage ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} },
);

const fetchJson = async (path) => {
  const res = await fetch(path);
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
  showScreen("question");
  renderCurrent();
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
  showScreen("results");
  renderResults();
}

function renderResults() {
  const score = scoreSession(state.session);
  el("results-score").textContent =
    `${score.correct} of ${score.answered} correct (${Math.round(score.accuracy * 100)}%)`;
  el("results-list").replaceChildren();
}

function skip() {
  state.session = advance(state.session);
  renderCurrent();
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
  showScreen("home");
});
