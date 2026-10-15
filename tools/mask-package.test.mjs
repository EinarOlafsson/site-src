// Parity tests for src/assets/js/mask-package.js against the spaCR Python
// packagers (tools/web_mask_generator/results.py and detector.py).
// Set MASK_JS_ZIP_OUT=<dir> to also write the JS archives for
// `python tools/fixtures/mask/make_fixtures.py --verify-js-zip <dir>`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { measureObjects } from '../src/assets/js/mask-core.js';
import {
  crc32, sha256Hex, zipStore, npyBytes, tiffBytes, csvText, pyJson, pyFloatRepr, pyFloat32Repr, PyFloat,
  buildResultZip, buildDetectionZip, objectColumns,
} from '../src/assets/js/mask-package.js';
import { fixtures, readNpy, FIXTURES } from './fixtures/mask/helpers.mjs';

const text = (name) => readFileSync(path.join(FIXTURES, name), 'utf8');
const decoder = new TextDecoder();

/** Tiny ZIP reader for the tests (stored and deflated members). */
function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(off + 26, true), lext = dv.getUint16(off + 28, true);
    const raw = bytes.subarray(off + 30 + lnlen + lext, off + 30 + lnlen + lext + csize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
    assert.equal(crc32(data), crc, name);
    out.set(name, data);
    p += 46 + nlen;
  }
  return out;
}

const DATE = new Date(2026, 9, 15, 12, 30, 0);

test('crc32 and sha256Hex', async () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xCBF43926);
  assert.equal(await sha256Hex(bytes), '15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225');
});

test('npyBytes is byte-identical to np.save', () => {
  const H = fixtures.package.H, W = fixtures.package.W;
  const flows = readNpy('pkg_flows.npy').data;
  const cellprob = readNpy('pkg_cellprob.npy').data;
  assert.deepEqual(npyBytes(flows, [2, H, W]), readNpy('pkg_flows_expected.npy').bytes);
  assert.deepEqual(npyBytes(cellprob, [H, W]), readNpy('pkg_cellprob_expected.npy').bytes);
  for (const name of ['pkg_masks.npy', 'pkg_yx_u16.npy', 'pkg_cyx_u8.npy', 'yolo_wells_1c_pred.npy']) {
    const { data, shape, bytes } = readNpy(name);
    assert.deepEqual(npyBytes(data, shape), bytes, name);
  }
});

test('Python float formatting (repr, numpy float32 str)', () => {
  const cases = [[0.1, '0.1'], [1, '1.0'], [1e-5, '1e-05'], [1e16, '1e+16'], [1e15, '1000000000000000.0'],
    [0.0001, '0.0001'], [-0, '-0.0'], [5e-324, '5e-324'], [1.7976931348623157e308, '1.7976931348623157e+308'], [123.456, '123.456']];
  for (const [v, s] of cases) assert.equal(pyFloatRepr(v), s);
  assert.equal(pyFloat32Repr(Math.fround(1 / 3)), '0.33333334');
  assert.equal(pyFloat32Repr(Math.fround(3.4e38)), '3.4e+38');
});

test('csvText matches pandas to_csv through spacr.tabular.write_table', () => {
  const fx = fixtures.csv_format;
  const rows = fx.values.map((v, i) => ({
    label: i, value: v === null ? NaN : v, f32: fx.f32[i] === null ? NaN : fx.f32[i], text: fx.text[i], flag: fx.flag[i],
  }));
  const got = csvText(rows, [{ name: 'label', kind: 'int' }, { name: 'value', kind: 'float' }, { name: 'f32', kind: 'float32' }, { name: 'text', kind: 'str' }, { name: 'flag', kind: 'bool' }]);
  assert.equal(got, text('csv_format_expected.csv'));
});

test('measureObjects + csvText reproduce results.py objects.csv', () => {
  const H = fixtures.package.H, W = fixtures.package.W;
  const masks = readNpy('pkg_masks.npy').data;
  const yx = readNpy('pkg_yx_u16.npy').data;
  const f32 = readNpy('pkg_yx_f32.npy').data;
  const cyx = readNpy('pkg_cyx_u8.npy').data;
  const planes = [0, 1, 2].map((c) => cyx.subarray(c * H * W, (c + 1) * H * W));
  for (const [name, channels] of [['yx_u16', [yx]], ['yx_f32', [f32]], ['cyx_u8', planes]]) {
    const rows = measureObjects(masks, H, W, channels);
    assert.equal(csvText(rows, objectColumns(rows, channels.length)), text(`pkg_${name}_objects.csv`), name);
  }
  assert.equal(csvText([], objectColumns([], 1)), text('pkg_empty_objects.csv'));
});

test('pyJson matches json.dumps(indent=2, sort_keys=True)', () => {
  const manifest = fixtures.package.cases[0].manifest;
  const value = { b: [1, new PyFloat(2), 'é"\n'], a: { z: null, y: true }, c: [], d: {}, e: 0.4 };
  assert.equal(pyJson(value, { indent: 2, sortKeys: true }),
    '{\n  "a": {\n    "y": true,\n    "z": null\n  },\n  "b": [\n    1,\n    2.0,\n    "\\u00e9\\"\\n"\n  ],\n  "c": [],\n  "d": {},\n  "e": 0.4\n}');
  assert.equal(JSON.stringify(JSON.parse(pyJson(manifest, { sortKeys: true }))), JSON.stringify(manifest));
});

test('tiffBytes writes tifffile shaped descriptions', () => {
  const t = tiffBytes(new Uint16Array(6), { width: 3, height: 2 });
  assert.equal(String.fromCharCode(t[0], t[1]), 'II');
  assert.ok(decoder.decode(t).includes('{"shape": [2, 3], "axes": "YX"}'));
  const c = tiffBytes(new Uint8Array(18), { width: 3, height: 2, channels: 3 });
  assert.ok(decoder.decode(c).includes('{"shape": [3, 2, 3], "axes": "CYX"}'));
});

function packageInputs() {
  const H = fixtures.package.H, W = fixtures.package.W;
  return {
    H, W,
    masks: readNpy('pkg_masks.npy').data,
    flows: readNpy('pkg_flows.npy').data,
    cellprob: readNpy('pkg_cellprob.npy').data,
    images: { yx_u16: readNpy('pkg_yx_u16.npy').data, cyx_u8: readNpy('pkg_cyx_u8.npy').data, yx_f32: readNpy('pkg_yx_f32.npy').data },
  };
}

const MODEL = { id: 'toxoplasma_pv_v3', version: '3.0.0', weights_sha256: 'ab'.repeat(32) };
const SETTINGS = { diameter: 30, flow_threshold: 0.4, cellprob_threshold: 0.0, nested: { b: [1, 2.5, 'x'], a: true } };
const UPLOAD = new Uint8Array([0x49, 0x49, 0x2a, 0x00, ...new TextEncoder().encode('uploaded-bytes')]);

test('buildResultZip mirrors results.build_result_zip', async () => {
  const { H, W, masks, flows, cellprob, images } = packageInputs();
  const outDir = process.env.MASK_JS_ZIP_OUT;
  if (outDir) mkdirSync(outDir, { recursive: true });
  for (const c of fixtures.package.cases) {
    const channels = c.axes === 'CYX' ? 3 : 1;
    const data = images[c.name];
    const planes = Array.from({ length: channels }, (_, k) => data.subarray(k * H * W, (k + 1) * H * W));
    const rows = measureObjects(masks, H, W, planes);
    for (const deflate of [false, true]) {
      const zip = await buildResultZip({
        inputName: 'C:\\uploads\\upload image.tif', inputBytes: UPLOAD,
        image: { data, width: W, height: H, channels, axes: c.axes }, labels: masks, flows, cellprob,
        model: MODEL, settings: SETTINGS, spacrVersion: fixtures.spacr_version, rows, deflate, date: DATE,
      });
      const files = readZip(zip);
      assert.deepEqual([...files.keys()], c.names);
      const manifest = JSON.parse(decoder.decode(files.get('manifest.json')));
      assert.deepEqual(Object.keys(manifest).sort(), [...Object.keys(c.manifest), 'backend'].sort());
      for (const key of ['schema_version', 'model', 'settings', 'image_axes', 'shape_yx', 'object_count', 'measurements', 'outputs', 'unavailable', 'spacr_version']) {
        assert.deepEqual(manifest[key], c.manifest[key], key);
      }
      for (const name of ['README.txt', 'objects.csv', 'flows.npy', 'cell_probability.npy', 'input/upload image.tif']) {
        assert.deepEqual(manifest.files[name], c.manifest.files[name], name);
      }
      for (const [name, info] of Object.entries(manifest.files)) {
        assert.equal(info.bytes, files.get(name).length);
        assert.equal(info.sha256, await sha256Hex(files.get(name)));
      }
      assert.equal(decoder.decode(files.get('README.txt')), fixtures.package.readme);
      if (outDir && deflate) writeFileSync(path.join(outDir, `${c.name}.zip`), zip);
    }
  }
});

test('buildResultZip without optional outputs mirrors the empty case', async () => {
  const { H, W, images } = packageInputs();
  const zip = await buildResultZip({
    inputName: 'upload image.tif', inputBytes: UPLOAD, image: { data: images.yx_u16, width: W, height: H },
    labels: new Uint32Array(H * W), model: MODEL, settings: {}, unavailable: { flows: 'none', cell_probability: 'none' },
    spacrVersion: fixtures.spacr_version, rows: [], date: DATE,
  });
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], fixtures.package.empty_names);
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')));
  assert.deepEqual(manifest.outputs, fixtures.package.empty_manifest.outputs);
  assert.deepEqual(manifest.unavailable, fixtures.package.empty_manifest.unavailable);
  assert.equal(decoder.decode(files.get('objects.csv')), text('pkg_empty_objects.csv'));
  await assert.rejects(buildResultZip({
    inputName: 'x', inputBytes: UPLOAD, image: { data: images.yx_u16, width: W, height: H }, labels: new Uint32Array(H * W),
    model: MODEL, spacrVersion: 'x', rows: [],
  }), /explain the unavailable flows output/);
});

test('buildDetectionZip mirrors detector.build_well_result_zip', async () => {
  const { H, W, images } = packageInputs();
  const det = fixtures.detection_package;
  const zip = await buildDetectionZip({
    inputName: 'plate.png', inputBytes: new Uint8Array([0x89, ...new TextEncoder().encode('PNG-fake-bytes')]),
    image: { data: images.cyx_u8, width: W, height: H, channels: 3, axes: 'CYX' },
    wells: det.wells, model: { id: 'toxoplasma_well_detector_v2', version: '2', weights_sha256: 'cd'.repeat(32) },
    settings: { confidence: 0.25, imgsz: 640, min_axis_ratio: 0.7 }, spacrVersion: fixtures.spacr_version, date: DATE,
  });
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], det.names);
  assert.equal(decoder.decode(files.get('objects.csv')), text('det_objects.csv'));
  assert.equal(decoder.decode(files.get('boxes.json')), text('det_boxes.json'));
  assert.equal(decoder.decode(files.get('README.txt')), text('det_README.txt'));
  const manifest = JSON.parse(decoder.decode(files.get('manifest.json')));
  assert.deepEqual(Object.keys(manifest).sort(), [...Object.keys(det.manifest), 'backend'].sort());
  for (const key of ['result_kind', 'model', 'settings', 'image_axes', 'shape_yx', 'detection_count', 'outputs', 'unavailable', 'measurements']) {
    assert.deepEqual(manifest[key], det.manifest[key], key);
  }
  for (const name of ['objects.csv', 'boxes.json', 'README.txt', 'input/plate.png']) assert.deepEqual(manifest.files[name], det.manifest.files[name], name);
  if (process.env.MASK_JS_ZIP_OUT) writeFileSync(path.join(process.env.MASK_JS_ZIP_OUT, 'detection.zip'), zip);
});

test('zipStore deflate falls back to store and stays readable', async () => {
  const files = [{ name: 'a.txt', bytes: new TextEncoder().encode('a'.repeat(1000)) }, { name: 'dir/ü.bin', bytes: new Uint8Array([1, 2, 3]) }];
  for (const deflate of [false, true]) {
    const read = readZip(await zipStore(files, { deflate, date: DATE }));
    assert.equal(decoder.decode(read.get('a.txt')), 'a'.repeat(1000));
    assert.deepEqual(read.get('dir/ü.bin'), new Uint8Array([1, 2, 3]));
  }
});
