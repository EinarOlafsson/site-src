// Parity tests for src/assets/js/mask-core.js against fixtures produced by the
// real cellpose / spaCR / ultralytics code (tools/fixtures/mask/make_fixtures.py).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  normalize99, normalizeImg, resizeBilinear, resizeNearestLabels, runTiled, computeMasks,
  cellposeEval, spacrNormalize, measureObjects, letterbox, decodeYolo, filterWells, pyRound,
} from '../src/assets/js/mask-core.js';
import { fixtures, readNpy, unitF32, hashU32, blobImage, fakeNet, compareLabels } from './fixtures/mask/helpers.mjs';

const report = (...args) => { if (process.env.MASK_PARITY_VERBOSE) console.log(...args); };

function maxAbsDiff(a, b) {
  assert.equal(a.length, b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function q256(name) {
  const { data, shape } = readNpy(name);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = Math.fround(data[i] / 256);
  return { data: out, shape };
}

test('pyRound rounds half to even', () => {
  assert.deepEqual([0.5, 1.5, 2.5, -0.5, -1.5, 2.4, 2.6].map(pyRound), [0, 2, 2, -0, -2, 2, 3]);
});

test('normalize99 matches cellpose.transforms.normalize99', () => {
  const t = fixtures.transforms.normalize99;
  const u = unitF32(t.H * t.W, t.seed);
  const x = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) x[i] = Math.fround(Math.fround(u[i] * t.scale) + t.offset);
  const d1 = maxAbsDiff(normalize99(x), readNpy(t.expected).data);
  const d2 = maxAbsDiff(normalize99(x, { lower: 5, upper: 95 }), readNpy(t.expected_5_95).data);
  report('normalize99 max diff', d1, d2);
  assert.equal(d1, 0);
  assert.equal(d2, 0);
});

test('normalizeImg matches cellpose.transforms.normalize_img (constant channel zeroed)', () => {
  const u = unitF32(37 * 53 * 3, 42);
  const chw = new Float32Array(3 * 37 * 53);
  for (let y = 0; y < 37; y++) for (let x = 0; x < 53; x++) for (let c = 0; c < 3; c++) {
    chw[(c * 37 + y) * 53 + x] = c === 2 ? 0.5 : u[(y * 53 + x) * 3 + c];
  }
  const d = maxAbsDiff(normalizeImg(chw, 3, 37, 53), readNpy(fixtures.transforms.normalize_img).data);
  report('normalize_img max diff', d);
  assert.equal(d, 0);
});

test('resizeBilinear matches cv2 INTER_LINEAR via cellpose resize_image', () => {
  const u = unitF32(37 * 53 * 3, 42);
  const chw = new Float32Array(3 * 37 * 53);
  for (let y = 0; y < 37; y++) for (let x = 0; x < 53; x++) for (let c = 0; c < 3; c++) {
    chw[(c * 37 + y) * 53 + x] = c === 2 ? 0.5 : u[(y * 53 + x) * 3 + c];
  }
  let worst = 0;
  for (const [key, name] of Object.entries(fixtures.transforms.resize)) {
    if (key.startsWith('area')) continue;
    const [nh, nw] = key.split('x').map(Number);
    const d = maxAbsDiff(resizeBilinear(chw, 37, 53, 3, nh, nw), readNpy(name).data);
    worst = Math.max(worst, d);
    assert.ok(d < 2.5e-7, `${key}: ${d}`);
  }
  const even = unitF32(40 * 50, 43);
  const dArea = maxAbsDiff(resizeBilinear(even, 40, 50, 1, 20, 25), readNpy(fixtures.transforms.resize.area_20x25).data);
  report('resize max diff', worst, 'area', dArea);
  assert.ok(dArea < 2.5e-7, `area: ${dArea}`);
});

test('resizeNearestLabels matches cv2 INTER_NEAREST', () => {
  const t = fixtures.transforms.nearest;
  const src = readNpy(t.src).data;
  assert.deepEqual(Array.from(resizeNearestLabels(src, 29, 31, 61, 47)), Array.from(readNpy(t.up).data));
  assert.deepEqual(Array.from(resizeNearestLabels(src, 29, 31, 13, 11)), Array.from(readNpy(t.down).data));
});

test('runTiled matches cellpose.core.run_net with the same network', async () => {
  for (const c of fixtures.tiling) {
    const u = unitF32(c.C * c.H * c.W, c.seed);
    const res = await runTiled(u, c.H, c.W, async (batch, n) => fakeNet(batch, n, 3), { channels: c.C });
    const sub = readNpy(c.sub);
    const [, sh, sw] = sub.shape;
    let worst = 0;
    for (let k = 0; k < 3; k++) {
      const plane = k < 2 ? res.dP.subarray(k * c.H * c.W, (k + 1) * c.H * c.W) : res.cellprob;
      let sum = 0;
      for (let i = 0; i < plane.length; i++) sum += plane[i];
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        worst = Math.max(worst, Math.abs(plane[(y * 9) * c.W + x * 9] - sub.data[(k * sh + y) * sw + x]));
      }
      assert.ok(Math.abs(sum - c.sums[k]) <= 1e-6 * Math.max(1, Math.abs(c.sums[k])), `${c.name} sum ${k}: ${sum} vs ${c.sums[k]}`);
    }
    report(`tiling ${c.name}: tiles=${res.tiles}, max abs diff ${worst}`);
    assert.ok(worst < 1e-4, `${c.name}: ${worst}`);
  }
});

for (const c of fixtures.dynamics) {
  test(`computeMasks matches cellpose.dynamics.compute_masks (${c.name})`, () => {
    const dP = q256(c.dP_q256).data, cellprob = q256(c.cellprob_q256).data;
    const expected = readNpy(c.masks).data;
    const t0 = Date.now();
    const got = computeMasks(dP, cellprob, c.H, c.W, { niter: 200, cellprobThreshold: 0, flowThreshold: 0.4, minSize: 15 });
    const ms = Date.now() - t0;
    const cmp = compareLabels(got, expected);
    const raw = computeMasks(dP, cellprob, c.H, c.W, { niter: 200, cellprobThreshold: 0, flowThreshold: 0, minSize: -1 });
    const cmpRaw = compareLabels(raw, readNpy(c.masks_noflow_nomin).data);
    report(`dynamics ${c.name}: labels js=${cmp.countA} py=${cmp.countB} minIoU=${cmp.minIoU} identical=${cmp.identicalPixels}/${cmp.pixels} (${ms} ms); no-QC labels js=${cmpRaw.countA} py=${cmpRaw.countB} identical=${cmpRaw.identicalPixels}/${cmpRaw.pixels}`);
    assert.equal(cmp.countA, c.labels);
    assert.equal(cmp.countA, cmp.countB);
    assert.equal(cmp.unmatched, 0);
    assert.ok(cmp.minIoU >= 0.99, `IoU ${cmp.minIoU}`);
    assert.equal(cmp.identicalPixels, cmp.pixels);
    assert.equal(cmpRaw.identicalPixels, cmpRaw.pixels);
  });
}

test('cellposeEval matches CellposeModel.eval with the same network', async () => {
  const e = fixtures.eval;
  const img = blobImage(e.H, e.W, e.seed);
  assert.equal(createHash('sha256').update(new Uint8Array(img.buffer)).digest('hex'), e.image_sha256);
  for (const c of e.cases) {
    const opts = { normalize: true, diameter: c.kwargs.diameter ?? null, resample: c.kwargs.resample ?? true };
    const res = await cellposeEval(img, 1, e.H, e.W, async (batch, n) => fakeNet(batch, n, 3), opts);
    const cmp = compareLabels(res.masks, readNpy(c.masks).data);
    assert.deepEqual([res.flowHeight, res.flowWidth], c.flow_shape);
    const sub = readNpy(c.cellprob_sub);
    const [sh, sw] = sub.shape;
    let worst = 0;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) worst = Math.max(worst, Math.abs(res.cellprob[(y * 7) * res.flowWidth + x * 7] - sub.data[y * sw + x]));
    report(`eval ${c.name}: labels js=${cmp.countA} py=${cmp.countB} minIoU=${cmp.minIoU} identical=${cmp.identicalPixels}/${cmp.pixels}, cellprob max diff ${worst}, niter ${res.niter}`);
    assert.ok(worst < 1e-4, `${c.name} cellprob ${worst}`);
    assert.equal(cmp.countA, c.labels);
    assert.equal(cmp.unmatched, 0);
    assert.ok(cmp.minIoU >= 0.99);
  }
});

test('spacrNormalize matches spacr.io._normalize_img_batch', () => {
  for (const c of fixtures.spacr_normalize) {
    const input = readNpy(c.input).data;
    const s = c.settings;
    const got = spacrNormalize(input, { background: s.background, signalToNoise: s.Signal_to_noise, removeBackground: s.remove_background, lowerPercentile: s.lower_percentile });
    const d = maxAbsDiff(got, readNpy(c.expected).data);
    report(`spacrNormalize ${c.name}: max diff ${d}`);
    assert.equal(d, 0, c.name);
  }
});

test('measureObjects matches regionprops_table values from results.py', async () => {
  const H = fixtures.package.H, W = fixtures.package.W;
  const masks = readNpy('pkg_masks.npy').data;
  const yx = readNpy('pkg_yx_u16.npy').data;
  const rows = measureObjects(masks, H, W, [yx]);
  assert.deepEqual(rows.map((r) => r.label), [1, 2, 5, 7]);
  assert.deepEqual(rows[1], { label: 2, area: 35, centroid_y: 8, centroid_x: 5, intensity_mean_channel_0: 1972.0285714285715 });
});

test('letterbox matches ultralytics LetterBox (auto and square)', () => {
  for (const c of fixtures.yolo.letterbox) {
    const img = new Uint8Array(c.H * c.W * c.C);
    const h = hashU32(c.H * c.W * c.C, c.seed);
    for (let i = 0; i < img.length; i++) img[i] = h[i] % 256;
    for (const mode of ['auto', 'square']) {
      const lb = letterbox(img, c.H, c.W, c.size, { auto: mode === 'auto' });
      const [eh, ew] = c[`${mode}_shape`];
      assert.deepEqual([lb.height, lb.width], [eh, ew], `${c.H}x${c.W} ${mode}`);
      const hwc = new Uint8Array(eh * ew * 3);
      const plane = eh * ew;
      let sum = 0;
      for (let i = 0; i < plane; i++) for (let k = 0; k < 3; k++) {
        const v = Math.round(lb.tensor[k * plane + i] * 255);
        hwc[i * 3 + k] = v;
        sum += v;
      }
      assert.equal(sum, c[`${mode}_sum`], `${c.H}x${c.W} ${mode} sum`);
      assert.equal(createHash('sha256').update(hwc).digest('hex'), c[`${mode}_sha256`], `${c.H}x${c.W} ${mode} pixels`);
    }
  }
});

test('decodeYolo + filterWells match ultralytics NMS and spacr.plaque.detect_wells', () => {
  for (const c of fixtures.yolo.cases) {
    const pred = readNpy(c.pred);
    const boxes = decodeYolo(pred.data, [1, 4 + c.nc, c.N], { conf: 0.25, iou: 0.7, H: c.H, W: c.W, inputHeight: c.inputHeight, inputWidth: c.inputWidth });
    assert.equal(boxes.length, c.detections.length, c.name);
    let worst = 0;
    boxes.forEach((b, i) => {
      const r = c.detections[i];
      worst = Math.max(worst, Math.abs(b.x0 - r[0]), Math.abs(b.y0 - r[1]), Math.abs(b.x1 - r[2]), Math.abs(b.y1 - r[3]), Math.abs(b.confidence - r[4]));
      assert.equal(b.class, r[5]);
    });
    const wells = filterWells(boxes, { minAxisRatio: 0.7 });
    report(`yolo ${c.name}: ${boxes.length} boxes (max diff ${worst}), ${wells.length} wells`);
    assert.equal(worst, 0);
    assert.deepEqual(wells.map(({ x0, y0, x1, y1, confidence, diameter_px, axis_ratio }) => ({ x0, y0, x1, y1, confidence, diameter_px, axis_ratio })), c.wells);
  }
});
