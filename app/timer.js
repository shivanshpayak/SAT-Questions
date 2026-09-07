export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function createTimer({ limitMs = null, onTick = () => {}, onExpire = () => {}, now = Date.now } = {}) {
  let startedAt = null;
  let handle = null;
  let expired = false;

  const elapsed = () => (startedAt === null ? 0 : now() - startedAt);

  const tick = () => {
    const value = limitMs === null ? elapsed() : Math.max(0, limitMs - elapsed());
    onTick(value);
    if (limitMs !== null && value === 0 && !expired) {
      expired = true;
      onExpire();
    }
    return value;
  };

  return {
    start() {
      startedAt = now();
      expired = false;
      if (typeof setInterval === "function") {
        handle = setInterval(tick, 1000);
        // Under Node the interval would otherwise hold the event loop open
        // forever, hanging any test that starts a timer. No-op in browsers.
        handle?.unref?.();
      }
      tick();
    },
    stop() {
      if (handle !== null) { clearInterval(handle); handle = null; }
    },
    elapsed,
    tick,
  };
}
