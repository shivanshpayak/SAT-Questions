export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(ids, seed) {
  const out = [...ids];
  const rng = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function createQueue(ids, seed) {
  return { order: shuffle(ids, seed), idx: 0, seed, cycle: 0 };
}

export function currentId(queue) {
  return queue.order[queue.idx] ?? null;
}

export function advanceQueue(queue) {
  const idx = queue.idx + 1;
  if (idx < queue.order.length) return { ...queue, idx };
  // Pool exhausted: reshuffle so the next pass differs from the last.
  const seed = (queue.seed + 0x9e3779b9) >>> 0;
  return { order: shuffle(queue.order, seed), idx: 0, seed, cycle: queue.cycle + 1 };
}
