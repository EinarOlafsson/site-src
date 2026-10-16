// Result viewer for the mask generator: turns labels, boxes, flows and cell
// probabilities into RGBA layers and composites them like the Cellpose
// viewer (image / masks / outlines / flows / cell probability, one opacity).
// Pure functions on typed arrays; no DOM, so Node tests can run them.

/** Object count and mean area (pixels) of a label image. */
export function labelStats(labels) {
  const areas = new Map();
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i];
    if (v) areas.set(v, (areas.get(v) || 0) + 1);
  }
  let total = 0;
  for (const a of areas.values()) total += a;
  return { count: areas.size, meanArea: areas.size ? total / areas.size : 0 };
}

/** Box count and mean rectangle area (pixels). */
export function boxStats(boxes) {
  const areas = boxes.map(b => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0));
  return { count: boxes.length, meanArea: areas.length ? areas.reduce((a, b) => a + b, 0) / areas.length : 0 };
}

/** A stable, well-separated colour for label v (golden-angle hues). */
export function labelColor(v) {
  const h = (v * 137.508) % 360;
  const s = 0.65, l = 0.55;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return [f(0), f(8), f(4)];
}

// Index into a (h, w) plane for output pixel (x, y) of a (H, W) image, so a
// layer computed at the model scale still lines up with the image.
function sampler(H, W, h, w) {
  if (h === H && w === W) return null;
  const xs = new Int32Array(W), ys = new Int32Array(H);
  for (let x = 0; x < W; x++) xs[x] = Math.min(w - 1, Math.floor((x + 0.5) * w / W));
  for (let y = 0; y < H; y++) ys[y] = Math.min(h - 1, Math.floor((y + 0.5) * h / H));
  return { xs, ys, w };
}

function forEachPixel(H, W, h, w, visit) {
  const map = sampler(H, W, h, w);
  for (let y = 0, i = 0; y < H; y++) {
    const row = map ? map.ys[y] * map.w : y * W;
    for (let x = 0; x < W; x++, i++) visit(i, map ? row + map.xs[x] : i);
  }
}

/** Boundary pixels of a label image (4-neighbourhood, inner boundary). */
export function outlineMask(labels, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, v = labels[i];
    if (!v) continue;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1 || labels[i - 1] !== v || labels[i + 1] !== v || labels[i - width] !== v || labels[i + width] !== v) out[i] = 1;
  }
  return out;
}

/**
 * Flow field to RGB like Cellpose's dx_to_circ: hue from the direction,
 * brightness from the 99th-percentile-normalised magnitude.
 * flows: { data, shape } with shape [2, h, w] (dy, dx) or [h, w, 3] (RGB).
 */
export function flowRGB(flows, height, width) {
  const out = new Uint8ClampedArray(width * height * 3);
  const { data, shape } = flows;
  if (shape.length === 3 && shape[2] === 3 && shape[0] !== 2) {
    const [h, w] = shape;
    forEachPixel(height, width, h, w, (i, j) => { out[i * 3] = data[j * 3]; out[i * 3 + 1] = data[j * 3 + 1]; out[i * 3 + 2] = data[j * 3 + 2]; });
    return out;
  }
  if (shape.length !== 3 || shape[0] < 2) throw new Error('flows must have shape (2, Y, X)');
  const [, h, w] = shape;
  const n = h * w;
  const mag = new Float32Array(n);
  for (let j = 0; j < n; j++) mag[j] = Math.hypot(data[j], data[n + j]);
  const step = Math.max(1, Math.floor(n / 100000));
  const sample = [];
  for (let j = 0; j < n; j += step) sample.push(mag[j]);
  sample.sort((a, b) => a - b);
  const lo = sample[Math.floor(sample.length * 0.01)] || 0, hi = sample[Math.floor(sample.length * 0.99)] || 1;
  const span = hi > lo ? hi - lo : 1;
  forEachPixel(height, width, h, w, (i, j) => {
    const m = Math.min(1, Math.max(0, (mag[j] - lo) / span));
    const angle = Math.atan2(data[j], data[n + j]) + Math.PI;
    out[i * 3] = 255 * m * (Math.cos(angle) + 1) / 2;
    out[i * 3 + 1] = 255 * m * (Math.cos(angle + 2 * Math.PI / 3) + 1) / 2;
    out[i * 3 + 2] = 255 * m * (Math.cos(angle + 4 * Math.PI / 3) + 1) / 2;
  });
  return out;
}

/** Cell probability (logits) to grey 0-255 through the logistic function. */
export function cellprobGrey(prob, height, width) {
  const { data, shape } = prob;
  const [h, w] = shape.length === 3 ? shape.slice(-2) : shape;
  const out = new Uint8ClampedArray(width * height);
  forEachPixel(height, width, h, w, (i, j) => { out[i] = 255 / (1 + Math.exp(-data[j])); });
  return out;
}

const OUTLINE = [255, 70, 70];

/**
 * Composite the visible layers into RGBA.
 * base: RGBA image preview (or null); labels/outlines/flowRgb/probGrey/boxes optional.
 * layers: { image, masks, outlines, flows, cellprob, boxes } booleans; opacity 0..1.
 */
export function composite({ width, height, base = null, labels = null, outlines = null, flowRgb = null, probGrey = null, boxes = null }, layers, opacity = 0.5) {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const showImage = layers.image && base;
  if (showImage) out.set(base);
  else for (let i = 3; i < out.length; i += 4) out[i] = 255;
  const a = showImage ? opacity : 1;
  const blend = (i, r, g, b, alpha) => {
    const k = i * 4;
    out[k] = out[k] * (1 - alpha) + r * alpha;
    out[k + 1] = out[k + 1] * (1 - alpha) + g * alpha;
    out[k + 2] = out[k + 2] * (1 - alpha) + b * alpha;
  };
  if (layers.cellprob && probGrey) for (let i = 0; i < n; i++) blend(i, probGrey[i], probGrey[i], probGrey[i], a);
  if (layers.flows && flowRgb) for (let i = 0; i < n; i++) blend(i, flowRgb[i * 3], flowRgb[i * 3 + 1], flowRgb[i * 3 + 2], a);
  if (layers.masks && labels) {
    const cache = new Map();
    for (let i = 0; i < n; i++) {
      const v = labels[i];
      if (!v) continue;
      let c = cache.get(v);
      if (!c) { c = labelColor(v); cache.set(v, c); }
      blend(i, c[0], c[1], c[2], a);
    }
  }
  if (layers.outlines && outlines) for (let i = 0; i < n; i++) if (outlines[i]) blend(i, OUTLINE[0], OUTLINE[1], OUTLINE[2], 1);
  if (layers.boxes && boxes) {
    const t = Math.max(1, Math.round(Math.min(width, height) / 400));
    for (const box of boxes) {
      const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
      const x1 = Math.min(width - 1, Math.ceil(box.x1) - 1), y1 = Math.min(height - 1, Math.ceil(box.y1) - 1);
      if (x1 <= x0 || y1 <= y0) continue;
      for (let d = 0; d < t; d++) {
        for (let x = x0; x <= x1; x++) { blend(Math.min(y1, y0 + d) * width + x, ...OUTLINE, 1); blend(Math.max(y0, y1 - d) * width + x, ...OUTLINE, 1); }
        for (let y = y0; y <= y1; y++) { blend(y * width + Math.min(x1, x0 + d), ...OUTLINE, 1); blend(y * width + Math.max(x0, x1 - d), ...OUTLINE, 1); }
      }
    }
  }
  return out;
}

/** Number with thousands grouping in the page language. */
export function formatNumber(value, lang, digits = 0) {
  try { return new Intl.NumberFormat(lang || undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value); } catch { return String(Math.round(value)); }
}

/**
 * A short, translated explanation for an error from the browser route, plus the
 * raw text for a "Technical details" disclosure. text(key, values) translates.
 */
export function friendlyError(error, text) {
  const raw = String(error?.message || error?.title || error || "").trim();
  const title = String(error?.title || "").trim();
  const detail = [title && title !== raw ? title : "", raw].filter(Boolean).join(": ");
  const all = `${title} ${raw}`;
  let message;
  if (/^(diameter)$/.test(raw)) message = text("err_diameter");
  else if (/^(json)$/.test(raw)) message = text("err_json");
  else if (/^(desktop_only)$/.test(raw)) message = text("err_desktop_only");
  else if (/model (checksum|size)|^HTTP \d+$/.test(raw)) message = text("err_model");
  else if (/out of memory|allocation failed|RangeError|Array buffer allocation/i.test(all)) message = text("err_memory2");
  else if (/Failed to fetch|NetworkError|connection|ECONN|Load failed|fetch failed/i.test(all)) message = text("err_model");
  else message = text("err_generic");
  return { message, detail: detail && detail !== message ? detail : "" };
}
