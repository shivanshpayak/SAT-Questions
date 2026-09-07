const DEFAULTS = {
  darkThreshold: 128,
  minRunPx: 20,
  maxRows: 4,
  minWidthPt: 15,
  mergeGapPt: 8,
};

export function detectUnderlines(img, scale, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const { pixels, width, height, stride, ox = 0, oy = 0 } = img;

  const runs = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const dark = x < width && pixels[y * stride + x] < cfg.darkThreshold;
      if (dark && start < 0) start = x;
      else if (!dark && start >= 0) {
        if (x - start >= cfg.minRunPx) runs.push({ y, x0: start, x1: x });
        start = -1;
      }
    }
  }
  runs.sort((a, b) => a.y - b.y || a.x0 - b.x0);

  const bands = [];
  for (const run of runs) {
    const host = bands.find(
      (b) => Math.abs(b.yEnd - run.y) <= 1 && run.x0 < b.x1 + 3 && run.x1 > b.x0 - 3,
    );
    if (host) {
      host.yEnd = run.y;
      host.x0 = Math.min(host.x0, run.x0);
      host.x1 = Math.max(host.x1, run.x1);
      host.rows++;
    } else {
      bands.push({ yStart: run.y, yEnd: run.y, x0: run.x0, x1: run.x1, rows: 1 });
    }
  }

  const toPt = (device) => device / scale;
  const thin = bands
    .filter((b) => b.rows <= cfg.maxRows)
    .map((b) => ({
      y: toPt(oy + b.yStart),
      x0: toPt(ox + b.x0),
      x1: toPt(ox + b.x1),
    }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0);

  // Join neighbours on the same baseline separated only by a descender.
  const merged = [];
  for (const band of thin) {
    const prev = merged.at(-1);
    if (prev && Math.abs(prev.y - band.y) <= 1 && band.x0 - prev.x1 <= cfg.mergeGapPt) {
      prev.x1 = Math.max(prev.x1, band.x1);
    } else {
      merged.push({ ...band });
    }
  }

  // Width is filtered after merging, so a wide underline broken into short
  // fragments by several descenders still survives.
  return merged.filter((b) => b.x1 - b.x0 >= cfg.minWidthPt);
}
