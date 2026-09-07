const KEY_PROGRESS = "sat.progress.v1";
const KEY_QUEUES = "sat.queues.v1";
const KEY_SETTINGS = "sat.settings.v1";

export function createStore(storage) {
  // A browser in private mode can throw on any storage access, and stored
  // JSON can be corrupt. Neither may break the app; progress just stops
  // persisting.
  const read = (key, fallback) => {
    try {
      const raw = storage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  };

  return {
    getProgress() {
      return read(KEY_PROGRESS, {});
    },

    recordAttempt(id, wasCorrect, answer) {
      const progress = read(KEY_PROGRESS, {});
      const entry = progress[id] ?? { attempts: 0, correct: 0, lastAt: 0, lastAnswer: "" };
      progress[id] = {
        attempts: entry.attempts + 1,
        correct: entry.correct + (wasCorrect ? 1 : 0),
        lastAt: Date.now(),
        lastAnswer: String(answer ?? ""),
        lastCorrect: Boolean(wasCorrect),
      };
      write(KEY_PROGRESS, progress);
    },

    missedIds() {
      const progress = read(KEY_PROGRESS, {});
      return Object.entries(progress)
        .filter(([, entry]) => entry.lastCorrect === false)
        .map(([id]) => id);
    },

    getQueue(key) {
      return read(KEY_QUEUES, {})[key] ?? null;
    },

    saveQueue(key, queue) {
      const queues = read(KEY_QUEUES, {});
      queues[key] = queue;
      write(KEY_QUEUES, queues);
    },

    getSettings() {
      return read(KEY_SETTINGS, {});
    },

    saveSettings(patch) {
      const merged = { ...read(KEY_SETTINGS, {}), ...patch };
      write(KEY_SETTINGS, merged);
      return merged;
    },

    accuracyBy(questions, field) {
      const progress = read(KEY_PROGRESS, {});
      const rows = new Map();
      for (const q of questions) {
        const entry = progress[q.id];
        if (!entry) continue;
        const key = q[field];
        const row = rows.get(key) ?? { seen: 0, correct: 0 };
        row.seen += 1;
        if (entry.lastCorrect) row.correct += 1;
        rows.set(key, row);
      }
      return [...rows.entries()].sort((a, b) => b[1].seen - a[1].seen);
    },

    reset() {
      try {
        storage.removeItem(KEY_PROGRESS);
      } catch {
        /* nothing to do */
      }
    },
  };
}
