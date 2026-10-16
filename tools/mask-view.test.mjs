import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { boxStats, cellprobGrey, composite, flowRGB, friendlyError, labelColor, labelStats, outlineMask } from "../src/assets/js/mask-view.js";
import { labelPng, npyBytes, parseNpy, unzip, zipStore } from "../src/assets/js/mask-package.js";
import { MASK_STRINGS } from "./mask-generator.mjs";

const text = (key, values = {}) => String(MASK_STRINGS[`mask.${key}`] ?? key).replace(/\{(\w+)\}/g, (m, k) => k in values ? values[k] : m);

test("object count and mean area come from the label image", () => {
  const labels = new Uint32Array([0, 1, 1, 0, 2, 2, 2, 0, 5]);
  assert.deepEqual(labelStats(labels), { count: 3, meanArea: 2 });
  assert.deepEqual(labelStats(new Uint16Array(4)), { count: 0, meanArea: 0 });
  assert.deepEqual(boxStats([{ x0: 0, y0: 0, x1: 2, y1: 3 }, { x0: 1, y0: 1, x1: 5, y1: 2 }]), { count: 2, meanArea: 5 });
});

test("outlines mark only object boundaries", () => {
  const labels = new Uint8Array([
    0, 0, 0, 0, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 1, 1, 1, 0,
    0, 0, 0, 0, 0]);
  const out = outlineMask(labels, 5, 5);
  assert.equal(out[12], 0);
  assert.equal(out[6], 1);
  assert.equal(out.reduce((a, b) => a + b, 0), 8);
});

test("flows map direction to hue and magnitude to brightness; cell probability is logistic", () => {
  const flows = { data: new Float32Array([0, 0, 1, -1, 0, 1, 0, 0]), shape: [2, 2, 2] };
  const rgb = flowRGB(flows, 2, 2);
  assert.equal(rgb.length, 12);
  assert.deepEqual([...rgb.slice(0, 3)], [0, 0, 0]);
  assert.notDeepEqual([...rgb.slice(3, 6)], [...rgb.slice(9, 12)]);
  const grey = cellprobGrey({ data: new Float32Array([0, 50, -50, 0]), shape: [2, 2] }, 2, 2);
  assert.deepEqual([...grey], [128, 255, 0, 128]);
  const upsampled = cellprobGrey({ data: new Float32Array([50]), shape: [1, 1] }, 2, 3);
  assert.deepEqual([...upsampled], [255, 255, 255, 255, 255, 255]);
});

test("composite toggles layers and applies the overlay opacity", () => {
  const base = new Uint8ClampedArray([100, 100, 100, 255, 100, 100, 100, 255]);
  const labels = new Uint8Array([1, 0]);
  const off = composite({ width: 2, height: 1, base, labels }, { image: true, masks: false }, 0.5);
  assert.deepEqual([...off], [...base]);
  const on = composite({ width: 2, height: 1, base, labels }, { image: true, masks: true }, 0.5);
  const c = labelColor(1);
  assert.deepEqual([...on.slice(0, 3)], [...Uint8ClampedArray.from(c, v => 50 + v / 2)]);
  assert.deepEqual([...on.slice(4, 8)], [100, 100, 100, 255]);
  const alone = composite({ width: 2, height: 1, base, labels }, { image: false, masks: true }, 0.2);
  assert.deepEqual([...alone.slice(0, 3)], c);
  const boxes = composite({ width: 4, height: 4, base: null, boxes: [{ x0: 0, y0: 0, x1: 4, y1: 4 }] }, { boxes: true }, 0.5);
  assert.deepEqual([...boxes.slice(0, 3)], [255, 70, 70]);
  assert.deepEqual([...boxes.slice(20, 23)], [0, 0, 0]);
});

test("result archives, NPY arrays and label PNGs round-trip", async () => {
  const flows = new Float32Array([0.5, -1, 2, 3]);
  const zip = await zipStore([{ name: "flows.npy", bytes: npyBytes(flows, [2, 1, 2]) }, { name: "objects.csv", bytes: new TextEncoder().encode("label,area\n1,4\n".repeat(50)) }], { deflate: true });
  const files = await unzip(zip);
  assert.deepEqual([...files.keys()], ["flows.npy", "objects.csv"]);
  const parsed = parseNpy(files.get("flows.npy"));
  assert.deepEqual(parsed.shape, [2, 1, 2]);
  assert.deepEqual([...parsed.data], [...flows]);
  assert.match(new TextDecoder().decode(files.get("objects.csv")), /^label,area\n1,4/);
  const png = await labelPng(new Uint32Array([0, 1, 300, 65535]), 2, 2);
  assert.deepEqual([...png.slice(1, 4)], [80, 78, 71]);
  const view = new DataView(png.buffer);
  assert.equal(view.getUint32(16), 2);
  assert.equal(png[24], 16);
  const idatLength = view.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  assert.deepEqual([...raw], [0, 0, 0, 0, 1, 0, 1, 44, 255, 255]);
  await assert.rejects(labelPng(new Uint32Array([70000]), 1, 1), /16-bit/);
});

test("errors become short translated messages with the raw text kept as details", () => {
  assert.equal(friendlyError(new Error("model checksum"), text).message, text("err_model"));
  assert.equal(friendlyError(new Error("HTTP 404"), text).message, text("err_model"));
  assert.equal(friendlyError(new TypeError("Failed to fetch"), text).message, text("err_model"));
  assert.equal(friendlyError(new Error("diameter"), text).message, text("err_diameter"));
  assert.equal(friendlyError(new Error("json"), text).message, text("err_json"));
  assert.equal(friendlyError(new Error("desktop_only"), text).message, text("err_desktop_only"));
  const memory = friendlyError(new RangeError("Array buffer allocation failed"), text);
  assert.equal(memory.message, text("err_memory2"));
  assert.match(memory.detail, /allocation failed/);
  assert.equal(friendlyError(new Error("weird"), text).message, text("err_generic"));
});
