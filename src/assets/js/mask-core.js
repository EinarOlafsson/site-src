/*
 * spaCR web mask generator: numerical core (no DOM, browser + Node 18).
 *
 * Faithful ports of the Cellpose 4.2.1.1 (2-D) pre/post-processing used by
 * spaCR, plus the spaCR channel normalisation, skimage regionprops measures
 * and the ultralytics YOLO letterbox/NMS used by spacr.plaque.detect_wells.
 * Float32 arithmetic is reproduced with Math.fround where the reference runs
 * in float32. Parity is checked by tools/mask-core.test.mjs against fixtures
 * produced by tools/fixtures/mask/make_fixtures.py from the real Python code.
 */

const f = Math.fround;

/* ------------------------------------------------------------------ */
/* small numeric helpers                                               */
/* ------------------------------------------------------------------ */

/** Python round() / numpy.round(): round half to even. */
export function pyRound(x) {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return r;
}

function isFloat32(a) { return a instanceof Float32Array; }
function isFloat64(a) { return a instanceof Float64Array; }

/** numpy pairwise_sum (float64), used by np.add.reduce / np.mean on 1-D data. */
function pairwiseSum64(a, start, n) {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[start + i];
    return res;
  }
  if (n <= 128) {
    let r0 = a[start], r1 = a[start + 1], r2 = a[start + 2], r3 = a[start + 3];
    let r4 = a[start + 4], r5 = a[start + 5], r6 = a[start + 6], r7 = a[start + 7];
    let i = 8;
    const end = n - (n % 8);
    for (; i < end; i += 8) {
      const p = start + i;
      r0 += a[p]; r1 += a[p + 1]; r2 += a[p + 2]; r3 += a[p + 3];
      r4 += a[p + 4]; r5 += a[p + 5]; r6 += a[p + 6]; r7 += a[p + 7];
    }
    let res = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
    for (; i < n; i++) res += a[start + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwiseSum64(a, start, n2) + pairwiseSum64(a, start + n2, n - n2);
}

/** numpy pairwise_sum in float32 arithmetic. */
function pairwiseSum32(a, start, n) {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res = f(res + a[start + i]);
    return res;
  }
  if (n <= 128) {
    let r0 = a[start], r1 = a[start + 1], r2 = a[start + 2], r3 = a[start + 3];
    let r4 = a[start + 4], r5 = a[start + 5], r6 = a[start + 6], r7 = a[start + 7];
    let i = 8;
    const end = n - (n % 8);
    for (; i < end; i += 8) {
      const p = start + i;
      r0 = f(r0 + a[p]); r1 = f(r1 + a[p + 1]); r2 = f(r2 + a[p + 2]); r3 = f(r3 + a[p + 3]);
      r4 = f(r4 + a[p + 4]); r5 = f(r5 + a[p + 5]); r6 = f(r6 + a[p + 6]); r7 = f(r7 + a[p + 7]);
    }
    let res = f(f(f(r0 + r1) + f(r2 + r3)) + f(f(r4 + r5) + f(r6 + r7)));
    for (; i < n; i++) res = f(res + a[start + i]);
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return f(pairwiseSum32(a, start, n2) + pairwiseSum32(a, start + n2, n - n2));
}

/**
 * np.percentile(..., method="linear") on an ascending-sorted array.
 * mode "f32weak": float32 data, Python-number q (numpy 2 weak promotion).
 * mode "f32strong": float32 data, numpy-float64 q (result float64).
 * mode "f64": integer or float64 data (result float64).
 */
export function percentileSorted(sorted, q, mode = 'f64') {
  const n = sorted.length;
  if (!n) return NaN;
  const vi = (n - 1) * (q / 100);
  let prev = Math.floor(vi);
  let next = prev + 1;
  let gamma;
  if (vi >= n - 1) { prev = n - 1; next = n - 1; gamma = vi + 1; }
  else if (vi < 0) { prev = 0; next = 0; gamma = vi; }
  else gamma = vi - prev;
  const a = sorted[prev];
  const b = sorted[next];
  if (mode === 'f32weak') {
    const d = f(b - a);
    let r = f(a + f(d * f(gamma)));
    if (gamma >= 0.5) r = f(b - f(d * f(1 - gamma)));
    return r;
  }
  if (mode === 'f32strong') {
    const d = f(b - a);
    let r = a + d * gamma;
    if (gamma >= 0.5) r = b - d * (1 - gamma);
    return r;
  }
  const d = b - a;
  let r = a + d * gamma;
  if (gamma >= 0.5) r = b - d * (1 - gamma);
  return r;
}

/* ------------------------------------------------------------------ */
/* normalisation                                                       */
/* ------------------------------------------------------------------ */

/**
 * cellpose.transforms.normalize99 for one channel (float32 result).
 * downsample mirrors normalize_img's downsample=True (only active when the
 * plane has more than 224**3 pixels and height/width are given).
 */
export function normalize99(plane, { lower = 1, upper = 99, height = 0, width = 0, downsample = false } = {}) {
  const X = Float32Array.from(plane);
  let sample = X;
  if (downsample && X.length > 224 ** 3 && height > 0 && width > 0) {
    const s0 = Math.max(1, Math.floor(height / 224));
    const s1 = Math.max(1, Math.floor(width / 224));
    const ny = Math.ceil(height / s0), nx = Math.ceil(width / s1);
    sample = new Float32Array(ny * nx);
    let k = 0;
    for (let y = 0; y < height; y += s0) for (let x = 0; x < width; x += s1) sample[k++] = X[y * width + x];
  } else {
    sample = Float32Array.from(X);
  }
  sample.sort();
  const x01 = percentileSorted(sample, lower, 'f32weak');
  const x99 = percentileSorted(sample, upper, 'f32weak');
  const range = f(x99 - x01);
  if (range > f(1e-3)) {
    for (let i = 0; i < X.length; i++) X[i] = f(f(X[i] - x01) / range);
  } else {
    X.fill(0);
  }
  return X;
}

/**
 * cellpose.transforms.normalize_img for a 2-D CHW image (normalize=True,
 * percentile (lower, upper), no tile norm / smoothing / invert): each channel
 * with a nonzero range is passed through normalize99(downsample=True), the
 * others become zero. Returns a new Float32Array (CHW).
 */
export function normalizeImg(image, C, H, W, { lower = 1, upper = 99 } = {}) {
  const plane = H * W;
  const out = new Float32Array(C * plane);
  for (let c = 0; c < C; c++) {
    const view = image.subarray ? image.subarray(c * plane, (c + 1) * plane) : image.slice(c * plane, (c + 1) * plane);
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < plane; i++) { const v = f(view[i]); if (v < mn) mn = v; if (v > mx) mx = v; }
    if (f(mx - mn) > 0) out.set(normalize99(view, { lower, upper, height: H, width: W, downsample: true }), c * plane);
  }
  return out;
}

/**
 * spacr.io._normalize_img_channels for one 2-D channel with workspace_dir=None.
 * Integer planes are processed in float64 like numpy; Float32Array planes in
 * float32 where numpy does. Returns Float32Array in [0, 1].
 */
export function spacrNormalize(plane, { background = 100, signalToNoise = 10, removeBackground = false, lowerPercentile = 2 } = {}) {
  const f32 = isFloat32(plane);
  const n = plane.length;
  const data = f32 ? Float32Array.from(plane) : (isFloat64(plane) ? Float64Array.from(plane) : Float64Array.from(plane));
  if (removeBackground) {
    const bg = f32 ? f(background) : background;
    for (let i = 0; i < n; i++) if (data[i] < bg) data[i] = 0;
  }
  let nz = 0;
  for (let i = 0; i < n; i++) if (data[i] !== 0) nz++;
  const out = new Float32Array(n);
  if (!nz) return out;
  const sorted = f32 ? new Float32Array(nz) : new Float64Array(nz);
  let k = 0;
  for (let i = 0; i < n; i++) if (data[i] !== 0) sorted[k++] = data[i];
  sorted.sort();
  const signalThreshold = signalToNoise * background;
  const lower = percentileSorted(sorted, lowerPercentile, f32 ? 'f32weak' : 'f64');
  let upper = null;
  const step = (99.5 - 98) / 15;
  for (let i = 0; i < 16; i++) {
    const p = i === 15 ? 99.5 : i * step + 98;
    const value = percentileSorted(sorted, p, f32 ? 'f32strong' : 'f64');
    if (value >= signalThreshold) { upper = value; break; }
  }
  if (upper === null) upper = percentileSorted(sorted, 99.5, f32 ? 'f32weak' : 'f64');
  const imin = lower, imax = upper;
  if (f32) {
    const lo = f(imin), hi = f(imax), span = f(imax - imin);
    for (let i = 0; i < n; i++) {
      let v = data[i];
      if (v < lo) v = lo; else if (v > hi) v = hi;
      if (imin !== imax) out[i] = f(f(v - lo) / span);
      else out[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
  } else {
    const span = imax - imin;
    for (let i = 0; i < n; i++) {
      let v = data[i];
      if (v < imin) v = imin; else if (v > imax) v = imax;
      if (imin !== imax) out[i] = f(((v - imin) / span) * 1 + 0);
      else out[i] = v < 0 ? 0 : (v > 1 ? 1 : v);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* resizing (OpenCV semantics)                                         */
/* ------------------------------------------------------------------ */

function linearCoeffs(src, dst, clampFraction = true, single = true) {
  const scale = 1 / (dst / src);
  const ofs = new Int32Array(dst);
  const a1 = single ? new Float32Array(dst) : new Float64Array(dst);
  for (let d = 0; d < dst; d++) {
    let fx = (d + 0.5) * scale - 0.5;
    if (single) fx = f(fx);
    let sx = Math.floor(fx);
    fx -= sx;
    if (single) fx = f(fx);
    if (clampFraction) {
      if (sx < 0) { fx = 0; sx = 0; }
      if (sx >= src - 1) { fx = 0; sx = src - 1; }
    }
    ofs[d] = sx; a1[d] = fx;
  }
  return { ofs, a1 };
}

/**
 * cv2.resize(..., INTER_LINEAR) for float32 data as used by
 * cellpose.transforms.resize_image (OpenCV 5 half-pixel geometry with
 * double-precision coefficients; results agree to about one float32 ulp).
 * Layout "chw" (default, planar) or "hwc". Returns Float32Array.
 */
export function resizeBilinear(src, H, W, C, newH, newW, { layout = 'chw' } = {}) {
  const out = new Float32Array(C * newH * newW);
  const get = layout === 'hwc'
    ? (c, y, x) => src[(y * W + x) * C + c]
    : (c, y, x) => src[(c * H + y) * W + x];
  const put = layout === 'hwc'
    ? (c, y, x, v) => { out[(y * newW + x) * C + c] = v; }
    : (c, y, x, v) => { out[(c * newH + y) * newW + x] = v; };
  if (newH === H && newW === W) {
    for (let c = 0; c < C; c++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(c, y, x, f(get(c, y, x)));
    return out;
  }
  const scaleX = 1 / (newW / W), scaleY = 1 / (newH / H);
  const isx = Math.round(scaleX), isy = Math.round(scaleY);
  const areaFast = Math.abs(scaleX - isx) < 2.220446049250313e-16 && Math.abs(scaleY - isy) < 2.220446049250313e-16;
  if (areaFast && isx === 2 && isy === 2) {
    for (let c = 0; c < C; c++) for (let y = 0; y < newH; y++) for (let x = 0; x < newW; x++) {
      const s = f(f(f(get(c, 2 * y, 2 * x) + get(c, 2 * y, 2 * x + 1)) + get(c, 2 * y + 1, 2 * x)) + get(c, 2 * y + 1, 2 * x + 1));
      put(c, y, x, f(s * 0.25));
    }
    return out;
  }
  const cx = linearCoeffs(W, newW, true, false), cy = linearCoeffs(H, newH, false, false);
  const row0 = new Float64Array(newW), row1 = new Float64Array(newW);
  const hrow = (c, y, row) => {
    for (let x = 0; x < newW; x++) {
      const sx = cx.ofs[x], a = cx.a1[x];
      const v0 = get(c, y, sx);
      row[x] = sx + 1 < W ? v0 * (1 - a) + get(c, y, sx + 1) * a : v0;
    }
  };
  for (let c = 0; c < C; c++) {
    for (let y = 0; y < newH; y++) {
      const sy = cy.ofs[y], b = cy.a1[y];
      hrow(c, Math.min(H - 1, Math.max(0, sy)), row0);
      hrow(c, Math.min(H - 1, Math.max(0, sy + 1)), row1);
      for (let x = 0; x < newW; x++) put(c, y, x, f(row0[x] * (1 - b) + row1[x] * b));
    }
  }
  return out;
}

/**
 * cv2.resize(..., INTER_LINEAR) for uint8 HWC data, bit-exact with OpenCV's
 * fixed-point SIMD path (11-bit coefficients). Returns Uint8Array (HWC).
 */
export function resizeBilinearU8(src, H, W, C, newH, newW) {
  const out = new Uint8Array(newH * newW * C);
  if (newH === H && newW === W) { out.set(src.subarray(0, out.length)); return out; }
  const cx = linearCoeffs(W, newW), cy = linearCoeffs(H, newH, false);
  const ia0 = new Int32Array(newW), ia1 = new Int32Array(newW);
  for (let x = 0; x < newW; x++) { ia0[x] = pyRound(f(f(1 - cx.a1[x]) * 2048)); ia1[x] = pyRound(f(cx.a1[x] * 2048)); }
  const rowBuf = (y) => {
    const r = new Int32Array(newW * C);
    for (let x = 0; x < newW; x++) {
      const sx = cx.ofs[x], sx1 = Math.min(sx + 1, W - 1);
      for (let c = 0; c < C; c++) r[x * C + c] = src[(y * W + sx) * C + c] * ia0[x] + src[(y * W + sx1) * C + c] * ia1[x];
    }
    return r;
  };
  const cache = new Map();
  const getRow = (y) => { let r = cache.get(y); if (!r) { r = rowBuf(y); cache.set(y, r); if (cache.size > 4) cache.delete(cache.keys().next().value); } return r; };
  for (let y = 0; y < newH; y++) {
    const sy = cy.ofs[y];
    const b0 = pyRound(f(f(1 - cy.a1[y]) * 2048)), b1 = pyRound(f(cy.a1[y] * 2048));
    const S0 = getRow(Math.min(H - 1, Math.max(0, sy))), S1 = getRow(Math.min(H - 1, Math.max(0, sy + 1)));
    const o = y * newW * C;
    for (let i = 0; i < newW * C; i++) {
      const v = ((Math.floor((b0 * (S0[i] >> 4)) / 65536) + Math.floor((b1 * (S1[i] >> 4)) / 65536) + 2) >> 2);
      out[o + i] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
  }
  return out;
}

/** cv2.resize(..., INTER_NEAREST) for one label plane. Returns Uint32Array. */
export function resizeNearestLabels(src, H, W, newH, newW) {
  const out = new Uint32Array(newH * newW);
  const ifx = 1 / (newW / W), ify = 1 / (newH / H);
  const xo = new Int32Array(newW);
  for (let x = 0; x < newW; x++) xo[x] = Math.min(Math.floor(x * ifx), W - 1);
  for (let y = 0; y < newH; y++) {
    const sy = Math.min(Math.floor(y * ify), H - 1);
    for (let x = 0; x < newW; x++) out[y * newW + x] = src[sy * W + xo[x]];
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* tiling (cellpose.core.run_net, transforms.make_tiles/average_tiles) */
/* ------------------------------------------------------------------ */

/** transforms.get_pad_yx(Ly, Lx, div, extra, min_size). */
export function getPadYX(Ly, Lx, div = 16, extra = 1, minSize = null) {
  const one = (L, m) => {
    const Lpad = (minSize === null || L >= m) ? Math.trunc(div * Math.ceil(L / div) - L) : Math.max(0, m - L - extra * div);
    const half = Math.floor(extra * div / 2);
    return [half + Math.floor(Lpad / 2), half + Lpad - Math.floor(Lpad / 2)];
  };
  const [y1, y2] = one(Ly, minSize ? minSize[0] : 0);
  const [x1, x2] = one(Lx, minSize ? minSize[1] : 0);
  return [y1, y2, x1, x2];
}

function linspaceInt(stop, num) {
  const out = new Int32Array(num);
  if (num === 1) return out;
  const div = num - 1;
  const step = stop / div;
  for (let i = 0; i < num; i++) out[i] = Math.trunc(step === 0 ? (i / div) * stop : i * step);
  out[num - 1] = Math.trunc(stop);
  return out;
}

/** transforms._taper_mask(ly, lx, sig) as Float64Array (ly*lx). */
export function taperMask(ly = 224, lx = 224, sig = 7.5) {
  const bs = Math.max(224, Math.max(ly, lx));
  const m = new Float64Array(bs);
  let mean = 0;
  for (let i = 0; i < bs; i++) mean += i;
  mean /= bs;
  for (let i = 0; i < bs; i++) m[i] = 1 / (1 + Math.exp((Math.abs(i - mean) - (bs / 2 - 20)) / sig));
  const y0 = Math.floor(bs / 2) - Math.floor(ly / 2);
  const x0 = Math.floor(bs / 2) - Math.floor(lx / 2);
  const out = new Float64Array(ly * lx);
  for (let y = 0; y < ly; y++) for (let x = 0; x < lx; x++) out[y * lx + x] = m[x0 + x] * m[y0 + y];
  return out;
}

/**
 * Tile one CHW image (C = 1..3, already normalised and resized) exactly like
 * cellpose 4 run_net (augment=False) and average the network outputs.
 * runBatch(batch Float32Array [n, netChannels, bsize, bsize], n) must resolve
 * to Float32Array [n, nout, bsize, bsize] (nout >= 3: ..., flowY, flowX, cellprob).
 * Channels beyond C are zero, which equals Cellpose-SAM's weight[:, :C] slicing.
 */
export async function runTiled(image, H, W, runBatch, { bsize = 256, overlap = 0.1, batchSize = 8, onProgress = null, netChannels = 3, channels = null } = {}) {
  const plane = H * W;
  const C = Math.min(3, channels ?? Math.round(image.length / plane));
  if (C < 1 || image.length < C * plane) throw new Error('image does not match H, W');
  if (C > netChannels) throw new Error('more image channels than network channels');
  const [yp1, yp2, xp1, xp2] = getPadYX(H, W, 16, 1, [bsize, bsize]);
  const Ly = H + yp1 + yp2, Lx = W + xp1 + xp2;
  const to = Math.min(0.5, Math.max(0.05, overlap));
  const bY = Math.min(bsize, Ly), bX = Math.min(bsize, Lx);
  const ny = Ly <= bsize ? 1 : Math.ceil((1 + 2 * to) * Ly / bsize);
  const nx = Lx <= bsize ? 1 : Math.ceil((1 + 2 * to) * Lx / bsize);
  const ys = linspaceInt(Ly - bY, ny), xs = linspaceInt(Lx - bX, nx);
  const tiles = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) tiles.push([ys[j], xs[i]]);
  const mask = taperMask(bY, bX);
  const tilePix = bY * bX;
  let yf = null, nout = 0;
  const navg = new Float64Array(Ly * Lx);
  for (let t0 = 0; t0 < tiles.length; t0 += batchSize) {
    const n = Math.min(batchSize, tiles.length - t0);
    const batch = new Float32Array(n * netChannels * tilePix);
    for (let b = 0; b < n; b++) {
      const [ty, tx] = tiles[t0 + b];
      for (let c = 0; c < C; c++) {
        const base = (b * netChannels + c) * tilePix;
        for (let y = 0; y < bY; y++) {
          const iy = ty + y - yp1;
          if (iy < 0 || iy >= H) continue;
          const rowSrc = (c * H + iy) * W;
          const rowDst = base + y * bX;
          for (let x = 0; x < bX; x++) {
            const ix = tx + x - xp1;
            if (ix >= 0 && ix < W) batch[rowDst + x] = image[rowSrc + ix];
          }
        }
      }
    }
    const out = await runBatch(batch, n);
    if (!yf) {
      nout = Math.round(out.length / (n * tilePix));
      if (nout < 3) throw new Error('network output needs at least 3 channels');
      yf = new Float32Array(nout * Ly * Lx);
    }
    for (let b = 0; b < n; b++) {
      const [ty, tx] = tiles[t0 + b];
      for (let c = 0; c < nout; c++) {
        const ob = (b * nout + c) * tilePix;
        const yb = c * Ly * Lx;
        for (let y = 0; y < bY; y++) {
          const dst = yb + (ty + y) * Lx + tx;
          const src = ob + y * bX;
          const mrow = y * bX;
          for (let x = 0; x < bX; x++) yf[dst + x] = f(yf[dst + x] + out[src + x] * mask[mrow + x]);
        }
      }
      for (let y = 0; y < bY; y++) {
        const dst = (ty + y) * Lx + tx;
        for (let x = 0; x < bX; x++) navg[dst + x] += mask[y * bX + x];
      }
    }
    if (onProgress) onProgress(t0 + n, tiles.length);
  }
  const dP = new Float32Array(2 * plane);
  const cellprob = new Float32Array(plane);
  const chans = [nout - 3, nout - 2, nout - 1];
  for (let k = 0; k < 3; k++) {
    const yb = chans[k] * Ly * Lx;
    const dst = k < 2 ? dP.subarray(k * plane, (k + 1) * plane) : cellprob;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = (y + yp1) * Lx + x + xp1;
        dst[y * W + x] = f(yf[yb + p] / navg[p]);
      }
    }
  }
  return { dP, cellprob, tiles: tiles.length };
}

/* ------------------------------------------------------------------ */
/* dynamics                                                            */
/* ------------------------------------------------------------------ */

/** fastremap.renumber(in_place=True): labels in order of first appearance. */
function renumberInPlace(m) {
  let max = 0;
  for (let i = 0; i < m.length; i++) if (m[i] > max) max = m[i];
  if (!max) return 0;
  const map = new Int32Array(max + 1).fill(-1);
  map[0] = 0;
  let next = 1;
  for (let i = 0; i < m.length; i++) {
    const v = m[i];
    if (v) {
      let r = map[v];
      if (r < 0) { r = next++; map[v] = r; }
      m[i] = r;
    }
  }
  return next - 1;
}

function maxLabel(m) {
  let max = 0;
  for (let i = 0; i < m.length; i++) if (m[i] > max) max = m[i];
  return max;
}

/** dynamics.steps_interp / follow_flows; returns final integer [y, x]. */
function followFlows(dPmasked, inds, n, H, W, niter) {
  const plane = H * W;
  const sx = f(W - 1), sy = f(H - 1);
  const kx = f(2 / sx), ky = f(2 / sy);
  const imx = new Float32Array(plane), imy = new Float32Array(plane);
  for (let i = 0; i < plane; i++) {
    imy[i] = f(dPmasked[i] * ky);
    imx[i] = f(dPmasked[plane + i] * kx);
  }
  const hw = f(W / 2), hh = f(H / 2);
  const outY = new Int32Array(n), outX = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    const p0 = inds[k];
    const y0 = Math.floor(p0 / W), x0 = p0 - y0 * W;
    let px = f(f(f(x0 / sx) * 2) - 1);
    let py = f(f(f(y0 / sy) * 2) - 1);
    for (let t = 0; t < niter; t++) {
      const ix = f(f(px + 1) * hw + -0.5);
      const iy = f(f(py + 1) * hh + -0.5);
      const xw = Math.floor(ix), yn = Math.floor(iy);
      const w = f(ix - xw), e = f(1 - w), nn = f(iy - yn), s = f(1 - nn);
      const wnw = f(s * e), wne = f(s * w), wsw = f(nn * e), wse = f(nn * w);
      const xe = xw + 1, ys = yn + 1;
      const inW = xw >= 0 && xw < W, inE = xe >= 0 && xe < W;
      const inN = yn >= 0 && yn < H, inS = ys >= 0 && ys < H;
      let ax = 0, ay = 0, bx = 0, by = 0, cx = 0, cy = 0, dx = 0, dy = 0;
      if (inN) {
        const r = yn * W;
        if (inW) { ax = imx[r + xw]; ay = imy[r + xw]; }
        if (inE) { bx = imx[r + xe]; by = imy[r + xe]; }
      }
      if (inS) {
        const r = ys * W;
        if (inW) { cx = imx[r + xw]; cy = imy[r + xw]; }
        if (inE) { dx = imx[r + xe]; dy = imy[r + xe]; }
      }
      const vx = f(dx * wse + f(cx * wsw + f(bx * wne + f(ax * wnw))));
      const vy = f(dy * wse + f(cy * wsw + f(by * wne + f(ay * wnw))));
      px = f(px + vx);
      if (px < -1) px = -1; else if (px > 1) px = 1;
      py = f(py + vy);
      if (py < -1) py = -1; else if (py > 1) py = 1;
    }
    outX[k] = Math.trunc(f(f(f(px + 1) * 0.5) * sx));
    outY[k] = Math.trunc(f(f(f(py + 1) * 0.5) * sy));
  }
  return { outY, outX };
}

/** dynamics.get_masks_torch for 2-D. */
function getMasks(py, px, inds, n, H, W, maxSizeFraction) {
  const rpad = 20, Hs = H + 2 * rpad, Ws = W + 2 * rpad;
  const pos = new Int32Array(n);
  const h1 = new Int32Array(Hs * Ws);
  for (let k = 0; k < n; k++) {
    let y = py[k] + rpad, x = px[k] + rpad;
    if (y < 0) y = 0; if (x < 0) x = 0;
    if (y > H + rpad - 1) y = H + rpad - 1;
    if (x > W + rpad - 1) x = W + rpad - 1;
    pos[k] = y * Ws + x;
    h1[pos[k]]++;
  }
  const seeds = [];
  for (let y = 0; y < Hs; y++) {
    for (let x = 0; x < Ws; x++) {
      const v = h1[y * Ws + x];
      if (v <= 10) continue;
      let isMax = true;
      for (let yy = Math.max(0, y - 2); yy <= Math.min(Hs - 1, y + 2) && isMax; yy++) {
        for (let xx = Math.max(0, x - 2); xx <= Math.min(Ws - 1, x + 2); xx++) {
          if (h1[yy * Ws + xx] > v) { isMax = false; break; }
        }
      }
      if (isMax) seeds.push(y * Ws + x);
    }
  }
  const M0 = new Uint32Array(H * W);
  if (!seeds.length) return M0;
  const order = seeds.map((s, i) => i);
  order.sort((a, b) => (h1[seeds[a]] - h1[seeds[b]]) || (a - b));
  const M1 = new Int32Array(Hs * Ws);
  const hs = new Uint8Array(121);
  let sm = new Uint8Array(121), tmp = new Uint8Array(121);
  for (let k = 0; k < order.length; k++) {
    const s = seeds[order[k]];
    const sy = Math.floor(s / Ws), sxp = s - sy * Ws;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      hs[(dy + 5) * 11 + dx + 5] = h1[(sy + dy) * Ws + sxp + dx] > 2 ? 1 : 0;
    }
    sm.fill(0); sm[60] = 1;
    for (let it = 0; it < 5; it++) {
      for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
        let m = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(10, y + 1) && !m; yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(10, x + 1); xx++) if (sm[yy * 11 + xx]) { m = 1; break; }
        }
        tmp[y * 11 + x] = m & hs[y * 11 + x];
      }
      const t = sm; sm = tmp; tmp = t;
    }
    const lab = k + 1;
    for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
      if (sm[(dy + 5) * 11 + dx + 5]) {
        const p = (sy + dy) * Ws + sxp + dx;
        if (M1[p] < lab) M1[p] = lab;
      }
    }
  }
  for (let k = 0; k < n; k++) M0[inds[k]] = M1[pos[k]];
  const nl = order.length;
  const counts = new Float64Array(nl + 1);
  for (let i = 0; i < M0.length; i++) counts[M0[i]]++;
  const big = H * W * maxSizeFraction;
  const bigc = [];
  for (let l = 0; l <= nl; l++) if (counts[l] > 0 && counts[l] > big) bigc.push(l);
  if (bigc.length > 0 && (bigc.length > 1 || bigc[0] !== 0)) {
    const kill = new Uint8Array(nl + 1);
    for (const l of bigc) kill[l] = 1;
    for (let i = 0; i < M0.length; i++) if (kill[M0[i]]) M0[i] = 0;
  }
  renumberInPlace(M0);
  return M0;
}

/** scipy.ndimage.find_objects + pixel sums for labels 1..nl. */
function labelStats(masks, H, W, nl) {
  const ymin = new Int32Array(nl + 1).fill(2147483647), ymax = new Int32Array(nl + 1).fill(-1);
  const xmin = new Int32Array(nl + 1).fill(2147483647), xmax = new Int32Array(nl + 1).fill(-1);
  const count = new Float64Array(nl + 1), sy = new Float64Array(nl + 1), sx = new Float64Array(nl + 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = masks[y * W + x];
    if (!l) continue;
    if (y < ymin[l]) ymin[l] = y; if (y > ymax[l]) ymax[l] = y;
    if (x < xmin[l]) xmin[l] = x; if (x > xmax[l]) xmax[l] = x;
    count[l]++; sy[l] += y; sx[l] += x;
  }
  return { ymin, ymax, xmin, xmax, count, sy, sx };
}

/**
 * dynamics.masks_to_flows_gpu (2-D): diffusion from the centre pixel.
 * Returns {mu: Float64Array(2*H*W), nl, stats}.
 */
export function masksToFlows(masks, H, W, { niter = null } = {}) {
  const nl = maxLabel(masks);
  const mu = new Float64Array(2 * H * W);
  if (!nl) return { mu, nl, stats: null };
  const st = labelStats(masks, H, W, nl);
  const cy = new Int32Array(nl + 1), cx = new Int32Array(nl + 1);
  const needSearch = [];
  let extMax = 0;
  for (let l = 1; l <= nl; l++) {
    if (!st.count[l]) continue;
    const ly = pyRound((st.sy[l] - st.count[l] * st.ymin[l]) / st.count[l]);
    const lx = pyRound((st.sx[l] - st.count[l] * st.xmin[l]) / st.count[l]);
    cy[l] = ly; cx[l] = lx;
    const gy = st.ymin[l] + ly, gx = st.xmin[l] + lx;
    if (!(gy <= st.ymax[l] && gx <= st.xmax[l] && masks[gy * W + gx] === l)) needSearch.push(l);
    const ext = (st.ymax[l] - st.ymin[l] + 1) + (st.xmax[l] - st.xmin[l] + 1) + 2;
    if (ext > extMax) extMax = ext;
  }
  if (needSearch.length) {
    const best = new Float64Array(nl + 1).fill(Infinity);
    const flag = new Uint8Array(nl + 1);
    for (const l of needSearch) flag[l] = 1;
    const by = new Int32Array(nl + 1), bx = new Int32Array(nl + 1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const l = masks[y * W + x];
      if (!l || !flag[l]) continue;
      const yi = y - st.ymin[l], xi = x - st.xmin[l];
      const d = (xi - cx[l]) ** 2 + (yi - cy[l]) ** 2;
      if (d < best[l]) { best[l] = d; by[l] = yi; bx[l] = xi; }
    }
    for (const l of needSearch) { cy[l] = by[l]; cx[l] = bx[l]; }
  }
  const nIter = niter ?? 2 * extMax;
  const Wp = W + 2, size = (H + 2) * Wp;
  let n = 0;
  for (let i = 0; i < masks.length; i++) if (masks[i]) n++;
  const pidx = new Int32Array(n);
  {
    let k = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (masks[y * W + x]) pidx[k++] = (y + 1) * Wp + x + 1;
  }
  const offs = [0, -Wp, Wp, -1, 1, -Wp - 1, -Wp + 1, Wp - 1, Wp + 1];
  const nb = new Int32Array(9 * n);
  const lab = (p) => {
    const y = Math.floor(p / Wp) - 1, x = p - (y + 1) * Wp - 1;
    return (y < 0 || x < 0 || y >= H || x >= W) ? 0 : masks[y * W + x];
  };
  for (let k = 0; k < n; k++) {
    const p = pidx[k];
    const l0 = lab(p);
    nb[9 * k] = p;
    for (let j = 1; j < 9; j++) {
      const q = p + offs[j];
      nb[9 * k + j] = lab(q) === l0 ? q : size;
    }
  }
  const meds = [];
  for (let l = 1; l <= nl; l++) if (st.count[l]) meds.push((st.ymin[l] + cy[l] + 1) * Wp + st.xmin[l] + cx[l] + 1);
  const use32 = size > 4e7;
  const T = use32 ? new Float32Array(size + 1) : new Float64Array(size + 1);
  const tmp = use32 ? new Float32Array(n) : new Float64Array(n);
  for (let it = 0; it < nIter; it++) {
    for (let m = 0; m < meds.length; m++) T[meds[m]] += 1;
    if (use32) {
      for (let k = 0; k < n; k++) {
        const b = 9 * k;
        let s = 0;
        for (let j = 0; j < 9; j++) s = f(s + T[nb[b + j]]);
        tmp[k] = f(s / 9);
      }
    } else {
      for (let k = 0; k < n; k++) {
        const b = 9 * k;
        tmp[k] = (((((((T[nb[b]] + T[nb[b + 1]]) + T[nb[b + 2]]) + T[nb[b + 3]]) + T[nb[b + 4]]) + T[nb[b + 5]]) + T[nb[b + 6]]) + T[nb[b + 7]] + T[nb[b + 8]]) / 9;
      }
    }
    for (let k = 0; k < n; k++) T[pidx[k]] = tmp[k];
  }
  const plane = H * W;
  for (let k = 0; k < n; k++) {
    const p = pidx[k];
    let dy = T[p + Wp] - T[p - Wp];
    let dx = T[p + 1] - T[p - 1];
    if (use32) { dy = f(dy); dx = f(dx); }
    const mag = 1e-60 + Math.sqrt(dy * dy + dx * dx);
    const y = Math.floor(p / Wp) - 1, x = p - (y + 1) * Wp - 1;
    mu[y * W + x] = dy / mag;
    mu[plane + y * W + x] = dx / mag;
  }
  return { mu, nl, stats: st };
}

/** dynamics.remove_bad_flow_masks (in place, returns masks). */
function removeBadFlowMasks(masks, dP, H, W, threshold) {
  const { mu, nl, stats } = masksToFlows(masks, H, W);
  if (!nl) return masks;
  const plane = H * W;
  const start = new Int32Array(nl + 2);
  for (let l = 1; l <= nl; l++) start[l + 1] = start[l] + stats.count[l];
  const fill = Int32Array.from(start);
  const err = new Float64Array(start[nl + 1]);
  for (let i = 0; i < plane; i++) {
    const l = masks[i];
    if (!l) continue;
    const ey = mu[i] - f(dP[i] / 5);
    const ex = mu[plane + i] - f(dP[plane + i] / 5);
    err[fill[l]++] = ey * ey + ex * ex;
  }
  const bad = new Uint8Array(nl + 1);
  let anyBad = false;
  for (let l = 1; l <= nl; l++) {
    const c = stats.count[l];
    if (!c) continue;
    const mean = (0 + pairwiseSum64(err, start[l], c)) / c;
    if (mean > threshold) { bad[l] = 1; anyBad = true; }
  }
  if (anyBad) for (let i = 0; i < plane; i++) if (bad[masks[i]]) masks[i] = 0;
  renumberInPlace(masks);
  return masks;
}

/** fill_voids.fill on a binary bbox patch: fill background not 4-connected to the border. */
function fillVoids(patch, h, w) {
  const seen = new Uint8Array(h * w);
  const stack = new Int32Array(h * w);
  let sp = 0;
  const push = (i) => { if (!patch[i] && !seen[i]) { seen[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (sp) {
    const i = stack[--sp];
    const y = Math.floor(i / w), x = i - y * w;
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
  }
  for (let i = 0; i < h * w; i++) if (!patch[i] && !seen[i]) patch[i] = 1;
  return patch;
}

function removeSmall(masks, minSize) {
  const nl = maxLabel(masks);
  const counts = new Float64Array(nl + 1);
  for (let i = 0; i < masks.length; i++) counts[masks[i]]++;
  const present = [];
  for (let l = 0; l <= nl; l++) if (counts[l] > 0) present.push(l);
  const kill = new Uint8Array(nl + 1);
  let any = false;
  for (let j = 1; j < present.length; j++) if (counts[present[j]] < minSize) { kill[present[j]] = 1; any = true; }
  if (any) for (let i = 0; i < masks.length; i++) if (kill[masks[i]]) masks[i] = 0;
  renumberInPlace(masks);
}

/** cellpose.utils.fill_holes_and_remove_small_masks (2-D, in place). */
export function fillHolesAndRemoveSmallMasks(masks, H, W, minSize = 15) {
  if (minSize > 0) removeSmall(masks, minSize);
  const nl = maxLabel(masks);
  if (nl) {
    const st = labelStats(masks, H, W, nl);
    let j = 0;
    for (let i = 0; i < nl; i++) {
      const l = i + 1;
      if (st.ymax[l] < 0) continue;
      const y0 = st.ymin[l], x0 = st.xmin[l];
      const h = st.ymax[l] - y0 + 1, w = st.xmax[l] - x0 + 1;
      const patch = new Uint8Array(h * w);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) patch[y * w + x] = masks[(y0 + y) * W + x0 + x] === l ? 1 : 0;
      fillVoids(patch, h, w);
      const nv = j + 1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (patch[y * w + x]) masks[(y0 + y) * W + x0 + x] = nv;
      j++;
    }
  }
  if (minSize > 0) removeSmall(masks, minSize);
  return masks;
}

/**
 * dynamics.compute_masks (2-D, CPU path) followed, when minSize > 0, by
 * utils.fill_holes_and_remove_small_masks. dP is (2, H, W) [flowY, flowX].
 */
export function computeMasks(dP, cellprob, H, W, { niter = 200, cellprobThreshold = 0, flowThreshold = 0.4, minSize = 15, maxSizeFraction = 0.4 } = {}) {
  const plane = H * W;
  const thr = f(cellprobThreshold);
  let n = 0;
  for (let i = 0; i < plane; i++) if (cellprob[i] > thr) n++;
  if (!n) return new Uint32Array(plane);
  const inds = new Int32Array(n);
  const dPm = new Float32Array(2 * plane);
  {
    let k = 0;
    for (let i = 0; i < plane; i++) {
      if (cellprob[i] > thr) {
        inds[k++] = i;
        dPm[i] = f(dP[i] / 5);
        dPm[plane + i] = f(dP[plane + i] / 5);
      }
    }
  }
  const { outY, outX } = followFlows(dPm, inds, n, H, W, niter);
  let masks = getMasks(outY, outX, inds, n, H, W, maxSizeFraction);
  if (flowThreshold !== null && flowThreshold > 0 && maxLabel(masks) > 0) {
    masks = removeBadFlowMasks(masks, dP, H, W, flowThreshold);
  }
  if (minSize > 0) fillHolesAndRemoveSmallMasks(masks, H, W, minSize);
  return masks;
}

/**
 * dynamics.resize_and_compute_masks (2-D): compute_masks without size filter,
 * optional nearest-neighbour resize to resize=[H0, W0], then
 * fill_holes_and_remove_small_masks(min_size) (always run, as in cellpose).
 */
export function resizeAndComputeMasks(dP, cellprob, H, W, { niter = 200, cellprobThreshold = 0, flowThreshold = 0.4, minSize = 15, maxSizeFraction = 0.4, resize = null } = {}) {
  let masks = computeMasks(dP, cellprob, H, W, { niter, cellprobThreshold, flowThreshold, minSize: -1, maxSizeFraction });
  let oh = H, ow = W;
  if (resize) {
    [oh, ow] = resize;
    masks = resizeNearestLabels(masks, H, W, oh, ow);
  }
  return fillHolesAndRemoveSmallMasks(masks, oh, ow, minSize);
}

/** models.CellposeModel.eval niter rule. */
export function niterFor(rescale, resample = true, niter = null) {
  const scale = resample ? rescale : 1;
  return (niter === null || niter === undefined || niter === 0) ? Math.trunc(200 / scale) : niter;
}

/**
 * CellposeModel.eval for one 2-D image (CHW, C >= 1; only the first three
 * channels are used) with a network supplied through runBatch.
 */
export async function cellposeEval(image, C, H, W, runBatch, {
  normalize = true, diameter = null, resample = true, flowThreshold = 0.4, cellprobThreshold = 0,
  minSize = 15, maxSizeFraction = 0.4, niter = null, bsize = 256, tileOverlap = 0.1, batchSize = 8,
  onProgress = null, netChannels = 3,
} = {}) {
  const Cn = Math.min(C, 3);
  const plane = H * W;
  let x = Float32Array.from(image.subarray ? image.subarray(0, Cn * plane) : image.slice(0, Cn * plane));
  if (normalize) x = normalizeImg(x, Cn, H, W, { lower: 1, upper: 99 });
  const rescale = (diameter !== null && diameter !== undefined && diameter > 0) ? 30 / diameter : 1.0;
  let Hr = H, Wr = W, xr = x;
  if (rescale !== 1) {
    Hr = Math.trunc(H * rescale); Wr = Math.trunc(W * rescale);
    if (Hr === 0 || Wr === 0) throw new Error('diameter too high -- not enough pixels to resize to ratio');
    xr = resizeBilinear(x, H, W, Cn, Hr, Wr);
  }
  let { dP, cellprob } = await runTiled(xr, Hr, Wr, runBatch, { bsize, overlap: tileOverlap, batchSize, onProgress, netChannels, channels: Cn });
  let Hf = Hr, Wf = Wr;
  if (resample && rescale !== 1) {
    dP = resizeBilinear(dP, Hr, Wr, 2, H, W);
    cellprob = resizeBilinear(cellprob, Hr, Wr, 1, H, W);
    Hf = H; Wf = W;
  }
  const it = niterFor(rescale, resample, niter);
  const resize = (Hf === H && Wf === W) ? null : [H, W];
  const masks = resizeAndComputeMasks(dP, cellprob, Hf, Wf, {
    niter: it, cellprobThreshold, flowThreshold, minSize, maxSizeFraction, resize,
  });
  return { masks, dP, cellprob, flowHeight: Hf, flowWidth: Wf, niter: it, rescale };
}

/* ------------------------------------------------------------------ */
/* measurements (skimage.measure.regionprops_table as in results.py)   */
/* ------------------------------------------------------------------ */

/**
 * Rows {label, area, centroid_y, centroid_x, intensity_mean_channel_k...}
 * in ascending label order. channels: one typed array per channel (H*W).
 * axes "YX" or "CYX" only affects float32 accumulation order.
 */
export function measureObjects(labels, H, W, channels, { axes = null } = {}) {
  const plane = H * W;
  const ax = axes ?? (channels.length > 1 ? 'CYX' : 'YX');
  const present = new Map();
  for (let i = 0; i < plane; i++) {
    const l = labels[i];
    if (l) present.set(l, (present.get(l) || 0) + 1);
  }
  const ids = [...present.keys()].sort((a, b) => a - b);
  const index = new Map(ids.map((l, i) => [l, i]));
  const nObj = ids.length;
  const start = new Int32Array(nObj + 1);
  for (let i = 0; i < nObj; i++) start[i + 1] = start[i] + present.get(ids[i]);
  const fill = Int32Array.from(start);
  const pix = new Int32Array(start[nObj]);
  const sy = new Float64Array(nObj), sx = new Float64Array(nObj);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const l = labels[y * W + x];
    if (!l) continue;
    const o = index.get(l);
    pix[fill[o]++] = y * W + x;
    sy[o] += y; sx[o] += x;
  }
  const rows = [];
  for (let o = 0; o < nObj; o++) {
    const n = start[o + 1] - start[o];
    const row = { label: ids[o], area: n, centroid_y: sy[o] / n, centroid_x: sx[o] / n };
    channels.forEach((ch, c) => {
      let mean;
      if (isFloat32(ch)) {
        const vals = new Float32Array(n);
        for (let k = 0; k < n; k++) vals[k] = ch[pix[start[o] + k]];
        let s;
        if (ax === 'CYX' && channels.length > 1) {
          s = 0;
          for (let k = 0; k < n; k++) s = f(s + vals[k]);
        } else {
          s = f(0 + pairwiseSum32(vals, 0, n));
        }
        mean = f(s / n);
      } else {
        const vals = new Float64Array(n);
        for (let k = 0; k < n; k++) vals[k] = ch[pix[start[o] + k]];
        let s;
        if (ax === 'CYX' && channels.length > 1) {
          s = 0;
          for (let k = 0; k < n; k++) s += vals[k];
        } else {
          s = 0 + pairwiseSum64(vals, 0, n);
        }
        mean = s / n;
      }
      row[`intensity_mean_channel_${c}`] = mean;
    });
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------ */
/* YOLO well detector (ultralytics LetterBox + NMS, spacr.plaque)      */
/* ------------------------------------------------------------------ */

/**
 * ultralytics LetterBox(new_shape=(size, size), auto, stride, scaleup=True,
 * center=True, padding 114) on an HWC image (C = 1 or 3, RGB order), then the
 * predictor's /255 scaling. auto=true (desktop predict with a .pt model)
 * pads only to a multiple of stride. Uint8 input is resized bit-exactly like
 * OpenCV; other input types use float bilinear then round to 0..255.
 * Returns {tensor [1, 3, height, width] RGB, width, height, scale, padX, padY}.
 */
export function letterbox(img, H, W, size = 640, { auto = true, stride = 32, channels = null } = {}) {
  const C = channels ?? Math.round(img.length / (H * W));
  const r = Math.min(size / H, size / W);
  const nw = pyRound(W * r), nh = pyRound(H * r);
  let dw = size - nw, dh = size - nh;
  if (auto) { dw = ((dw % stride) + stride) % stride; dh = ((dh % stride) + stride) % stride; }
  dw /= 2; dh /= 2;
  const top = pyRound(dh - 0.1), bottom = pyRound(dh + 0.1);
  const left = pyRound(dw - 0.1), right = pyRound(dw + 0.1);
  const height = nh + top + bottom, width = nw + left + right;
  const plane = height * width;
  const tensor = new Float32Array(3 * plane).fill(f(114 / 255));
  const scale255 = (v) => f(v / 255);
  if (img instanceof Uint8Array || img instanceof Uint8ClampedArray) {
    let src = img;
    if (C === 1) {
      src = new Uint8Array(H * W * 3);
      for (let i = 0; i < H * W; i++) { src[3 * i] = img[i]; src[3 * i + 1] = img[i]; src[3 * i + 2] = img[i]; }
    } else if (C !== 3) {
      src = new Uint8Array(H * W * 3);
      for (let i = 0; i < H * W; i++) for (let c = 0; c < 3; c++) src[3 * i + c] = img[i * C + c];
    }
    const res = (nh !== H || nw !== W) ? resizeBilinearU8(src, H, W, 3, nh, nw) : src;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) for (let c = 0; c < 3; c++) {
      tensor[c * plane + (y + top) * width + x + left] = scale255(res[(y * nw + x) * 3 + c]);
    }
  } else {
    const src3 = new Float32Array(3 * H * W);
    for (let c = 0; c < 3; c++) {
      const sc = C === 1 ? 0 : c;
      for (let i = 0; i < H * W; i++) src3[c * H * W + i] = img[i * C + sc];
    }
    const res = (nh !== H || nw !== W) ? resizeBilinear(src3, H, W, 3, nh, nw) : src3;
    for (let c = 0; c < 3; c++) for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const v = Math.min(255, Math.max(0, Math.round(res[(c * nh + y) * nw + x])));
      tensor[c * plane + (y + top) * width + x + left] = scale255(v);
    }
  }
  return { tensor, width, height, scale: r, padX: left, padY: top, newWidth: nw, newHeight: nh };
}

function nmsIndices(boxes, scores, iou) {
  const n = scores.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (scores[b] - scores[a]) || (a - b));
  const areas = new Float64Array(n);
  for (let i = 0; i < n; i++) areas[i] = f(f(boxes[4 * i + 2] - boxes[4 * i]) * f(boxes[4 * i + 3] - boxes[4 * i + 1]));
  const sup = new Uint8Array(n);
  const keep = [];
  for (let a = 0; a < n; a++) {
    const i = order[a];
    if (sup[i]) continue;
    keep.push(i);
    const ix1 = boxes[4 * i], iy1 = boxes[4 * i + 1], ix2 = boxes[4 * i + 2], iy2 = boxes[4 * i + 3];
    for (let b = a + 1; b < n; b++) {
      const j = order[b];
      if (sup[j]) continue;
      const xx1 = Math.max(ix1, boxes[4 * j]), yy1 = Math.max(iy1, boxes[4 * j + 1]);
      const xx2 = Math.min(ix2, boxes[4 * j + 2]), yy2 = Math.min(iy2, boxes[4 * j + 3]);
      const w = Math.max(0, f(xx2 - xx1)), h = Math.max(0, f(yy2 - yy1));
      const inter = f(w * h);
      const ovr = f(inter / f(f(areas[i] + areas[j]) - inter));
      if (ovr > iou) sup[j] = 1;
    }
  }
  return keep;
}

/**
 * Decode a YOLOv8-style detection head [1, 4+nc, N] (xywh in letterboxed
 * pixels) with ultralytics non_max_suppression (agnostic=False by default,
 * as Predictor uses) and scale_boxes/clip_boxes back to the H x W image.
 * Returns [{x0, y0, x1, y1, confidence, class}] in NMS keep order.
 */
export function decodeYolo(output, shape, { conf = 0.25, iou = 0.7, H, W, inputHeight = null, inputWidth = null, agnostic = false, maxDet = 300, maxNms = 30000, maxWh = 7680 } = {}) {
  const [, ch, N] = shape;
  const nc = ch - 4;
  const ct = f(conf);
  let cand = [];
  for (let i = 0; i < N; i++) {
    let best = -Infinity, cls = 0;
    for (let c = 0; c < nc; c++) {
      const v = output[(4 + c) * N + i];
      if (v > best) { best = v; cls = c; }
    }
    if (!(best > ct)) continue;
    const xc = output[i], yc = output[N + i], w = output[2 * N + i], h = output[3 * N + i];
    const hw = f(w / 2), hh = f(h / 2);
    cand.push({ x1: f(xc - hw), y1: f(yc - hh), x2: f(xc + hw), y2: f(yc + hh), score: best, cls });
  }
  if (!cand.length) return [];
  if (cand.length > maxNms) cand = cand.map((c, i) => [c, i]).sort((a, b) => (b[0].score - a[0].score) || (a[1] - b[1])).slice(0, maxNms).map((p) => p[0]);
  const bx = new Float32Array(4 * cand.length);
  const scores = new Float32Array(cand.length);
  cand.forEach((c, i) => {
    const off = agnostic ? 0 : c.cls * maxWh;
    bx[4 * i] = f(c.x1 + off); bx[4 * i + 1] = f(c.y1 + off); bx[4 * i + 2] = f(c.x2 + off); bx[4 * i + 3] = f(c.y2 + off);
    scores[i] = c.score;
  });
  const keep = nmsIndices(bx, scores, iou).slice(0, maxDet);
  const h1 = inputHeight ?? 640, w1 = inputWidth ?? h1;
  const gain = Math.min(h1 / H, w1 / W);
  const padX = pyRound((w1 - pyRound(W * gain)) / 2 - 0.1);
  const padY = pyRound((h1 - pyRound(H * gain)) / 2 - 0.1);
  const g = f(gain);
  const clip = (v, hi) => (v < 0 ? 0 : (v > hi ? hi : v));
  return keep.map((i) => {
    const c = cand[i];
    return {
      x0: clip(f(f(c.x1 - padX) / g), W), y0: clip(f(f(c.y1 - padY) / g), H),
      x1: clip(f(f(c.x2 - padX) / g), W), y1: clip(f(f(c.y2 - padY) / g), H),
      confidence: c.score, class: c.cls,
    };
  });
}

/**
 * spacr.plaque.detect_wells post-processing: integer boxes (Python round),
 * drop empty and non-square (axis_ratio < minAxisRatio) boxes, then reading
 * order (y0, x0). Each well carries Well.as_dict() geometry.
 */
export function filterWells(boxes, { minAxisRatio = 0.7 } = {}) {
  const wells = [];
  for (const b of boxes) {
    const x0 = pyRound(b.x0), y0 = pyRound(b.y0), x1 = pyRound(b.x1), y1 = pyRound(b.y1);
    const width = x1 - x0, height = y1 - y0;
    if (width <= 0 || height <= 0) continue;
    const longSide = Math.max(width, height);
    const axisRatio = longSide <= 0 ? 0 : Math.min(width, height) / longSide;
    if (axisRatio < minAxisRatio) continue;
    wells.push({
      x0, y0, x1, y1, confidence: b.confidence ?? 1.0, width, height,
      diameter_px: (width + height) / 2, axis_ratio: axisRatio,
    });
  }
  return wells.map((w, i) => [w, i]).sort((a, b) => (a[0].y0 - b[0].y0) || (a[0].x0 - b[0].x0) || (a[1] - b[1])).map((p) => p[0]);
}
