// Test helpers mirroring tools/fixtures/mask/make_fixtures.py (Node only).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const FIXTURES = path.dirname(fileURLToPath(import.meta.url));
export const fixtures = JSON.parse(readFileSync(path.join(FIXTURES, 'fixtures.json'), 'utf8'));

export function readBytes(name) {
  const raw = readFileSync(path.join(FIXTURES, name));
  return new Uint8Array(name.endsWith('.gz') ? gunzipSync(raw) : raw);
}

const CTORS = {
  '|u1': Uint8Array, '|i1': Int8Array, '<u2': Uint16Array, '<i2': Int16Array,
  '<u4': Uint32Array, '<i4': Int32Array, '<f4': Float32Array, '<f8': Float64Array,
  '<u8': BigUint64Array, '<i8': BigInt64Array,
};

/** Minimal .npy(.gz) reader: {data, shape, descr}. */
export function readNpy(name) {
  const bytes = readBytes(name);
  const hlen = bytes[8] | (bytes[9] << 8);
  const header = new TextDecoder().decode(bytes.subarray(10, 10 + hlen));
  const descr = /'descr': '([^']+)'/.exec(header)[1];
  const shape = /'shape': \(([^)]*)\)/.exec(header)[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number);
  const Ctor = CTORS[descr];
  const body = bytes.slice(10 + hlen);
  return { data: new Ctor(body.buffer, body.byteOffset, body.byteLength / Ctor.BYTES_PER_ELEMENT), shape, descr, bytes };
}

/** hash_u32 of make_fixtures.py. */
export function hashU32(n, seed) {
  const out = new Uint32Array(n);
  const s = Math.imul(seed, 40503);
  for (let i = 0; i < n; i++) {
    let x = (Math.imul(i, 2654435761 | 0) + s) >>> 0;
    x = (x ^ (x >>> 15)) >>> 0;
    x = Math.imul(x, 2246822519 | 0) >>> 0;
    x = (x ^ (x >>> 13)) >>> 0;
    out[i] = x;
  }
  return out;
}

export function unitF32(n, seed) {
  const h = hashU32(n, seed);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = h[i] / 4294967296;
  return out;
}

/** blob_image of make_fixtures.py (uint16 paraboloid blobs). */
export function blobImage(H, W, seed, n = 14) {
  const h = hashU32(4 * n, seed);
  const img = new Float64Array(H * W);
  for (let k = 0; k < n; k++) {
    const cy = (h[4 * k] % (H - 20)) + 10;
    const cx = (h[4 * k + 1] % (W - 20)) + 10;
    const r = (h[4 * k + 2] % 9) + 8;
    const a = (h[4 * k + 3] % 40) + 20;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = (r * r - (y - cy) ** 2 - (x - cx) ** 2) * a;
      if (v > img[y * W + x]) img[y * W + x] = v;
    }
  }
  const noise = hashU32(H * W, seed + 5);
  const out = new Uint16Array(H * W);
  for (let i = 0; i < H * W; i++) out[i] = img[i] + (noise[i] % 50) + 100;
  return out;
}

const f = Math.fround;

/** FakeNet of make_fixtures.py on a [n, C, bs, bs] batch (C >= 1). */
export function fakeNet(batch, n, C = 3, bs = 256) {
  const plane = bs * bs;
  const out = new Float32Array(n * 3 * plane);
  for (let b = 0; b < n; b++) {
    const x0 = batch.subarray((b * C) * plane, (b * C + 1) * plane);
    const x1 = C > 1 ? batch.subarray((b * C + 1) * plane, (b * C + 2) * plane) : null;
    const x2 = C > 2 ? batch.subarray((b * C + 2) * plane, (b * C + 3) * plane) : null;
    const o = b * 3 * plane;
    for (let y = 0; y < bs; y++) for (let x = 0; x < bs; x++) {
      const i = y * bs + x;
      if (y > 0 && y < bs - 1) out[o + i] = f(f(x0[i + bs] - x0[i - bs]) * 40);
      if (x > 0 && x < bs - 1) out[o + plane + i] = f(f(x0[i + 1] - x0[i - 1]) * 40);
      let s = f(f(x0[i] - 0.25) * 8);
      if (x1) s = f(s + f(x1[i] * 0.25));
      if (x2) s = f(s - f(x2[i] * 0.5));
      out[o + 2 * plane + i] = s;
    }
  }
  return out;
}

/** Label count and per-object IoU after optimal (greedy max-overlap, unique) matching. */
export function compareLabels(a, b) {
  let na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] > na) na = a[i]; if (b[i] > nb) nb = b[i]; }
  const inter = new Map();
  const ca = new Float64Array(na + 1), cb = new Float64Array(nb + 1);
  let identical = 0;
  for (let i = 0; i < a.length; i++) {
    ca[a[i]]++; cb[b[i]]++;
    if (a[i] === b[i]) identical++;
    if (a[i] && b[i]) { const k = a[i] * (nb + 1) + b[i]; inter.set(k, (inter.get(k) || 0) + 1); }
  }
  const pairs = [...inter.entries()].map(([k, v]) => {
    const la = Math.floor(k / (nb + 1)), lb = k % (nb + 1);
    return { la, lb, iou: v / (ca[la] + cb[lb] - v) };
  }).sort((p, q) => q.iou - p.iou);
  const usedA = new Set(), usedB = new Set();
  const ious = [];
  for (const p of pairs) {
    if (usedA.has(p.la) || usedB.has(p.lb)) continue;
    usedA.add(p.la); usedB.add(p.lb); ious.push(p.iou);
  }
  const unmatched = (na - usedA.size) + (nb - usedB.size);
  return { countA: na, countB: nb, minIoU: ious.length ? Math.min(...ious) : 1, unmatched, identicalPixels: identical, pixels: a.length };
}
