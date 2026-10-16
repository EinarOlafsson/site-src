/*
 * spaCR web mask generator: result packaging (no DOM, browser + Node 18).
 *
 * Builds the same downloadable archive as
 * tools/web_mask_generator/results.py (segmentation) and detector.py (well
 * detection) in spaCR: TIFF, NPY, CSV and JSON writers that match the Python
 * readers and formatting, plus a small PKZIP writer.
 */

/* ------------------------------------------------------------------ */
/* checksums                                                           */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (PKZIP polynomial) of a byte array. */
export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xFFFFFFFF) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** SHA-256 hex digest via WebCrypto (globalThis.crypto.subtle; node:crypto on Node 18). */
export async function sha256Hex(bytes) {
  let subtle = globalThis.crypto?.subtle;
  if (!subtle) subtle = (await import('node:crypto')).webcrypto.subtle;
  const digest = await subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

const encoder = new TextEncoder();
const utf8 = (text) => encoder.encode(text);

/* ------------------------------------------------------------------ */
/* ZIP                                                                 */
/* ------------------------------------------------------------------ */

async function compress(bytes, format) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    return await compress(bytes, 'deflate-raw');
  } catch {
    try {
      const wrapped = await compress(bytes, 'deflate');
      return wrapped.subarray(2, wrapped.length - 4);
    } catch {
      return null;
    }
  }
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return [time & 0xFFFF, day & 0xFFFF];
}

/**
 * PKZIP archive of files [{name, bytes}] (store, or deflate when asked for
 * and CompressionStream('deflate-raw' or zlib 'deflate', unwrapped) exists; a member is stored when
 * deflate does not shrink it). Async; resolves to Uint8Array.
 */
export async function zipStore(files, { deflate = false, date = new Date() } = {}) {
  const [dosTime, dosDate] = dosDateTime(date);
  const entries = [];
  let offset = 0;
  const chunks = [];
  for (const file of files) {
    const name = utf8(file.name);
    const data = file.bytes instanceof Uint8Array ? file.bytes : new Uint8Array(file.bytes);
    const crc = crc32(data);
    let method = 0;
    let payload = data;
    if (deflate) {
      const packed = await deflateRaw(data);
      if (packed && packed.length < data.length) { method = 8; payload = packed; }
    }
    const flags = /[^\x00-\x7f]/.test(file.name) ? 0x0800 : 0;
    const version = method === 8 ? 20 : 10;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, version, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, payload);
    entries.push({ name, crc, method, version, flags, csize: payload.length, size: data.length, offset });
    offset += 30 + name.length + payload.length;
  }
  const centralStart = offset;
  for (const e of entries) {
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, (3 << 8) | 20, true);
    c.setUint16(6, e.version, true);
    c.setUint16(8, e.flags, true);
    c.setUint16(10, e.method, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, e.crc, true);
    c.setUint32(20, e.csize, true);
    c.setUint32(24, e.size, true);
    c.setUint16(28, e.name.length, true);
    c.setUint16(30, 0, true);
    c.setUint16(32, 0, true);
    c.setUint16(34, 0, true);
    c.setUint16(36, 0, true);
    c.setUint32(38, (0o100644 << 16) >>> 0, true);
    c.setUint32(42, e.offset, true);
    chunks.push(new Uint8Array(c.buffer), e.name);
    offset += 46 + e.name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, offset - centralStart, true);
  end.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(end.buffer));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/* ------------------------------------------------------------------ */
/* dtypes                                                              */
/* ------------------------------------------------------------------ */

const DTYPES = {
  uint8: { ctor: Uint8Array, bits: 8, format: 1, npy: '|u1' },
  int8: { ctor: Int8Array, bits: 8, format: 2, npy: '|i1' },
  uint16: { ctor: Uint16Array, bits: 16, format: 1, npy: '<u2' },
  int16: { ctor: Int16Array, bits: 16, format: 2, npy: '<i2' },
  uint32: { ctor: Uint32Array, bits: 32, format: 1, npy: '<u4' },
  int32: { ctor: Int32Array, bits: 32, format: 2, npy: '<i4' },
  float32: { ctor: Float32Array, bits: 32, format: 3, npy: '<f4' },
  float64: { ctor: Float64Array, bits: 64, format: 3, npy: '<f8' },
};

/** dtype name of a typed array ("uint8", "float32", ...). */
export function dtypeOf(data) {
  for (const [name, info] of Object.entries(DTYPES)) if (data instanceof info.ctor) return name;
  if (data instanceof Uint8ClampedArray) return 'uint8';
  throw new Error('unsupported typed array');
}

function littleEndianBytes(data) {
  const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const probe = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (probe || data.BYTES_PER_ELEMENT === 1) return new Uint8Array(view);
  const out = new Uint8Array(view.length);
  const n = data.BYTES_PER_ELEMENT;
  for (let i = 0; i < view.length; i += n) for (let k = 0; k < n; k++) out[i + k] = view[i + n - 1 - k];
  return out;
}

/* ------------------------------------------------------------------ */
/* NPY                                                                 */
/* ------------------------------------------------------------------ */

/** NumPy .npy v1.0 bytes, identical to np.save for C-ordered arrays. */
export function npyBytes(data, shape) {
  const info = DTYPES[dtypeOf(data)];
  const shapeRepr = shape.length === 0 ? '()' : shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
  let header = `{'descr': '${info.npy}', 'fortran_order': False, 'shape': ${shapeRepr}, }`;
  if (shape.length > 0) header += ' '.repeat(Math.max(0, 21 - String(shape[0]).length));
  const hlen = header.length + 1;
  const padlen = (64 - ((10 + hlen) % 64)) % 64;
  const full = header + ' '.repeat(padlen) + '\n';
  const body = littleEndianBytes(data);
  const out = new Uint8Array(10 + full.length + body.length);
  out.set([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59, 1, 0], 0);
  out[8] = full.length & 0xFF;
  out[9] = full.length >> 8;
  out.set(utf8(full), 10);
  out.set(body, 10 + full.length);
  return out;
}

/* ------------------------------------------------------------------ */
/* TIFF                                                                */
/* ------------------------------------------------------------------ */

/**
 * Minimal baseline little-endian TIFF (one uncompressed strip per page,
 * minisblack). Multi-channel planar data become C pages; the first page holds
 * tifffile's shaped description {"shape": [...], "axes": "..."} so
 * tifffile.imread returns (Y, X) or (C, Y, X).
 */
export function tiffBytes(data, { width, height, channels = 1, axes = null } = {}) {
  const info = DTYPES[dtypeOf(data)];
  const bps = info.bits / 8;
  const pages = channels;
  const shape = pages > 1 ? [pages, height, width] : [height, width];
  const ax = axes ?? (pages > 1 ? 'CYX' : 'YX');
  const description = utf8(`{"shape": [${shape.join(', ')}], "axes": ${JSON.stringify(ax)}}\0`);
  const description2 = description;
  const pageBytes = width * height * bps;
  const body = littleEndianBytes(data);
  if (body.length !== pageBytes * pages) throw new Error('TIFF data size does not match its shape');
  const tagsFor = (first) => (first ? 12 : 11);
  let size = 8;
  const layout = [];
  for (let p = 0; p < pages; p++) {
    const ntags = tagsFor(p === 0);
    const ifd = size;
    size += 2 + ntags * 12 + 4;
    let desc = 0;
    if (p === 0) { desc = size; size += description2.length; size += size % 2; }
    const strip = size;
    size += pageBytes;
    size += size % 2;
    layout.push({ ifd, desc, strip, ntags });
  }
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, layout[0].ifd, true);
  layout.forEach((page, p) => {
    let q = page.ifd;
    dv.setUint16(q, page.ntags, true);
    q += 2;
    const tag = (code, type, count, value) => {
      dv.setUint16(q, code, true);
      dv.setUint16(q + 2, type, true);
      dv.setUint32(q + 4, count, true);
      if (type === 3 && count === 1) dv.setUint16(q + 8, value, true);
      else dv.setUint32(q + 8, value, true);
      q += 12;
    };
    tag(256, 4, 1, width);
    tag(257, 4, 1, height);
    tag(258, 3, 1, info.bits);
    tag(259, 3, 1, 1);
    tag(262, 3, 1, 1);
    if (p === 0) tag(270, 2, description2.length, page.desc);
    tag(273, 4, 1, page.strip);
    tag(277, 3, 1, 1);
    tag(278, 4, 1, height);
    tag(279, 4, 1, pageBytes);
    tag(284, 3, 1, 1);
    tag(339, 3, 1, info.format);
    dv.setUint32(q, p + 1 < pages ? layout[p + 1].ifd : 0, true);
    if (p === 0) out.set(description2, page.desc);
    out.set(body.subarray(p * pageBytes, (p + 1) * pageBytes), page.strip);
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Python-compatible text formatting                                   */
/* ------------------------------------------------------------------ */

function formatShortest(digits, exponent, negative) {
  const decpt = exponent + 1;
  let body;
  if (decpt > -4 && decpt <= 16) {
    if (decpt <= 0) body = '0.' + '0'.repeat(-decpt) + digits;
    else if (decpt >= digits.length) body = digits + '0'.repeat(decpt - digits.length) + '.0';
    else body = digits.slice(0, decpt) + '.' + digits.slice(decpt);
  } else {
    const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const e = Math.abs(exponent);
    body = `${mant}e${exponent < 0 ? '-' : '+'}${e < 10 ? '0' + e : e}`;
  }
  return (negative ? '-' : '') + body;
}

function splitExponential(text) {
  const [mant, exp] = text.split('e');
  return [mant.replace('.', ''), parseInt(exp, 10)];
}

/** Python repr(float) / numpy float64 str. */
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  const negative = x < 0 || Object.is(x, -0);
  if (x === 0) return negative ? '-0.0' : '0.0';
  const [digits, exponent] = splitExponential(Math.abs(x).toExponential());
  return formatShortest(digits, exponent, negative);
}

/** numpy float32 str (shortest digits that round-trip through float32). */
export function pyFloat32Repr(x) {
  if (Number.isNaN(x) || !Number.isFinite(x) || x === 0) return pyFloatRepr(x);
  const ax = Math.abs(x);
  let text = null;
  for (let p = 1; p <= 9; p++) {
    const candidate = ax.toExponential(p - 1);
    if (Math.fround(parseFloat(candidate)) === Math.fround(ax)) { text = candidate; break; }
  }
  let [digits, exponent] = splitExponential(text);
  digits = digits.replace(/0+$/, '') || '0';
  return formatShortest(digits, exponent, x < 0);
}

/** Float value marker so pyJson / csvText print it as a Python float. */
export class PyFloat {
  constructor(value) { this.value = value; }
}

function jsonString(text) {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20 || code > 0x7e) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/**
 * json.dumps(value, indent=indent, sort_keys=sortKeys) with ensure_ascii.
 * JavaScript integers print as ints, other numbers and PyFloat as floats.
 */
export function pyJson(value, { indent = 2, sortKeys = false } = {}, level = 0) {
  const pad = (n) => (indent === null ? '' : '\n' + ' '.repeat(indent * n));
  const sep = indent === null ? ', ' : ',';
  if (value === null || value === undefined) return 'null';
  if (value instanceof PyFloat) {
    if (!Number.isFinite(value.value)) throw new Error('Out of range float values are not JSON compliant');
    return pyFloatRepr(value.value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Out of range float values are not JSON compliant');
    return Number.isInteger(value) && !Object.is(value, -0) ? String(value) : pyFloatRepr(value);
  }
  if (typeof value === 'string') return jsonString(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return '[' + value.map((v) => pad(level + 1) + pyJson(v, { indent, sortKeys }, level + 1)).join(sep) + pad(level) + ']';
  }
  const keys = Object.keys(value);
  if (sortKeys) keys.sort();
  if (!keys.length) return '{}';
  return '{' + keys.map((k) => pad(level + 1) + jsonString(k) + ': ' + pyJson(value[k], { indent, sortKeys }, level + 1)).join(sep) + pad(level) + '}';
}

function csvField(text) {
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

/**
 * pandas DataFrame.to_csv(index=False) text. columns: names, or
 * {name, kind} with kind "int" | "float" | "float32" | "bool" | "str".
 * Without a kind, integers print as ints and other numbers as floats; a
 * column holding any non-integer number is printed as float throughout.
 */
export function csvText(rows, columns) {
  const cols = columns.map((c) => (typeof c === 'string' ? { name: c } : c));
  for (const col of cols) {
    if (col.kind) continue;
    const values = rows.map((r) => r[col.name]);
    if (values.some((v) => v instanceof PyFloat || (typeof v === 'number' && (!Number.isInteger(v) || Number.isNaN(v))) || v === null)) col.kind = 'float';
    else if (values.every((v) => typeof v === 'boolean')) col.kind = 'bool';
    else if (values.every((v) => typeof v === 'number')) col.kind = 'int';
    else col.kind = 'str';
  }
  const lines = [cols.map((c) => csvField(c.name)).join(',')];
  for (const row of rows) {
    lines.push(cols.map((c) => {
      let v = row[c.name];
      if (v instanceof PyFloat) v = v.value;
      if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) return '';
      if (c.kind === 'float') return pyFloatRepr(v);
      if (c.kind === 'float32') return pyFloat32Repr(v);
      if (c.kind === 'int') return String(v);
      if (c.kind === 'bool') return v ? 'True' : 'False';
      return csvField(String(v));
    }).join(','));
  }
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------ */
/* result archives                                                     */
/* ------------------------------------------------------------------ */

const HEX64 = /^[0-9a-fA-F]{64}$/;

function basename(name) {
  const parts = String(name).split(/[\\/]/);
  return parts[parts.length - 1];
}

function pathKey(a, b) {
  const pa = a.split('/'), pb = b.split('/');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return pa.length - pb.length;
}

async function finishArchive(files, manifest, { deflate, date }) {
  files.sort((a, b) => pathKey(a.name, b.name));
  manifest.files = {};
  for (const file of files) manifest.files[file.name] = { sha256: await sha256Hex(file.bytes), bytes: file.bytes.length };
  files.push({ name: 'manifest.json', bytes: utf8(pyJson(manifest, { indent: 2, sortKeys: true }) + '\n') });
  files.sort((a, b) => pathKey(a.name, b.name));
  return zipStore(files, { deflate, date });
}

function finiteArray(array) {
  for (let i = 0; i < array.length; i++) if (!Number.isFinite(array[i])) return false;
  return true;
}

/** README.txt of results.py (English source text of the tr() template). */
export function defaultResultReadme({ id, version, spacr }) {
  return 'spaCR web mask result (research use only)\n'
    + `Model: ${id}; version: ${version}; spaCR: ${spacr}\n`
    + 'Selected image: image.tif; labels: mask.tif; objects: objects.csv.\n'
    + 'The input/ folder preserves the uploaded bytes.\n'
    + 'Measurements use pixels, zero-based centroid coordinates and the selected image intensities.\n'
    + 'flows.npy stores actual backend Y/X vector components when available.\n'
    + 'cell_probability.npy stores actual backend scores when available.\n'
    + 'Raw logits are not calibrated probabilities; no calibration is claimed.\n'
    + 'Missing backend outputs are omitted, with reasons in manifest.json.\n'
    + 'Exact model weights SHA-256, settings and file hashes are in manifest.json.\n';
}

/** objects.csv columns of results.py for a given channel count. */
export function objectColumns(rows, channels) {
  const cols = [{ name: 'label', kind: 'int' }, { name: 'area', kind: 'float' }, { name: 'centroid_y', kind: 'float' }, { name: 'centroid_x', kind: 'float' }];
  for (let c = 0; c < channels; c++) cols.push({ name: `intensity_mean_channel_${c}`, kind: 'float' });
  return cols;
}

/**
 * The segmentation result archive of tools/web_mask_generator/results.py.
 * image: {data (CYX planar for C > 1), width, height, channels, axes?};
 * rows: measureObjects() output for the same labels and image.
 */
export async function buildResultZip({
  inputName, inputBytes, image, labels, flows = null, cellprob = null, model, settings = {},
  unavailable = {}, readmeText = null, spacrVersion, rows, deflate = true, date = new Date(), backend = 'browser-onnx',
}) {
  const { data, width, height } = image;
  const channels = image.channels ?? 1;
  const axes = image.axes ?? (channels > 1 ? 'CYX' : 'YX');
  if (!['YX', 'CYX'].includes(axes) || (axes === 'YX' && channels !== 1)) throw new Error('image_axes must describe a YX or CYX image');
  if (!width || !height || data.length !== width * height * channels) throw new Error('image must contain real numeric pixels');
  if (!finiteArray(data)) throw new Error('image contains non-finite pixels');
  if (!(labels instanceof Uint32Array) || labels.length !== width * height) throw new Error('masks must match the selected image plane');
  if (flows && (flows.length !== 2 * width * height || !finiteArray(flows))) throw new Error('flows must have shape (2, Y, X)');
  if (cellprob && (cellprob.length !== width * height || !finiteArray(cellprob))) throw new Error('cell probability must match the selected image plane');
  if (!String(model?.id ?? '').trim() || !String(model?.version ?? '').trim()) throw new Error('model identity and version are required');
  if (!HEX64.test(model.weights_sha256 ?? '')) throw new Error('weights_sha256 must identify the actual model weights');
  const missing = { ...unavailable };
  for (const [key, output] of [['flows', flows], ['cell_probability', cellprob]]) {
    const reason = missing[key];
    if (!output && (typeof reason !== 'string' || !reason.trim())) throw new Error(`explain the unavailable ${key} output`);
    if (output && key in missing) throw new Error(`${key} cannot be both supplied and unavailable`);
  }
  if (Object.keys(missing).some((k) => !['flows', 'cell_probability'].includes(k))) throw new Error('unrecognized unavailable output');
  const settingsCopy = JSON.parse(JSON.stringify(settings));
  if (!settingsCopy || typeof settingsCopy !== 'object' || Array.isArray(settingsCopy)) throw new Error('settings must be a JSON object');
  if (!rows) throw new Error('rows (measureObjects output) are required');
  const columns = objectColumns(rows, channels);
  const files = [
    { name: `input/${basename(inputName)}`, bytes: new Uint8Array(inputBytes) },
    { name: 'image.tif', bytes: tiffBytes(data, { width, height, channels, axes }) },
    { name: 'mask.tif', bytes: tiffBytes(labels, { width, height, channels: 1, axes: 'YX' }) },
    { name: 'objects.csv', bytes: utf8(csvText(rows, columns)) },
  ];
  if (flows) files.push({ name: 'flows.npy', bytes: npyBytes(flows instanceof Float32Array ? flows : Float32Array.from(flows), [2, height, width]) });
  if (cellprob) files.push({ name: 'cell_probability.npy', bytes: npyBytes(cellprob instanceof Float32Array ? cellprob : Float32Array.from(cellprob), [height, width]) });
  const text = readmeText ?? defaultResultReadme({ id: model.id, version: model.version, spacr: spacrVersion });
  files.push({ name: 'README.txt', bytes: utf8(text) });
  const modelEntry = { id: model.id, version: model.version, weights_sha256: model.weights_sha256.toLowerCase() };
  if (model.source_weights_sha256) modelEntry.source_weights_sha256 = model.source_weights_sha256.toLowerCase();
  const manifest = {
    schema_version: 1, spacr_version: spacrVersion, backend,
    model: modelEntry, settings: settingsCopy, image_axes: axes,
    shape_yx: [height, width], object_count: rows.length,
    measurements: { area_unit: 'pixel^2', centroid_unit: 'pixel', centroid_origin: 0, intensity: 'selected image values' },
    outputs: {
      flows: { available: !!flows, axes: 'vector_yx,Y,X' },
      cell_probability: { available: !!cellprob, kind: cellprob ? 'logits' : null, calibrated: false },
    },
    unavailable: missing,
  };
  return finishArchive(files, manifest, { deflate, date });
}

export const DETECTION_COLUMNS = [
  { name: 'detection_id', kind: 'int' }, { name: 'x0', kind: 'int' }, { name: 'y0', kind: 'int' },
  { name: 'x1', kind: 'int' }, { name: 'y1', kind: 'int' }, { name: 'confidence', kind: 'float' },
  { name: 'diameter_px', kind: 'float' }, { name: 'axis_ratio', kind: 'float' },
  { name: 'bbox_area_pixels', kind: 'int' }, { name: 'bbox_center_x', kind: 'float' }, { name: 'bbox_center_y', kind: 'float' },
];

export const DETECTION_README = 'spaCR well detection result (research use only).\nThe original upload, selected image and actual boxes/confidences are included.\nBounding-box areas/centres describe rectangles, not segmented well pixels.\nDiameter and axis ratio use the desktop Well geometry. No physical scale is assumed.\nMasks, flows and per-pixel cell probabilities are unavailable for this detector.\nModel identity, settings, unavailable-output reasons and file hashes are in manifest.json.\n';

export const DETECTION_UNAVAILABLE = {
  masks: 'The well detector returns bounding boxes, not instance masks.',
  flows: 'This detector does not produce flow vectors.',
  cell_probability: 'Detection confidence is not a per-pixel cell probability.',
};

/** Detection rows as built by detector.build_well_result_zip. */
export function detectionRows(wells, width, height) {
  return wells.map((w, i) => {
    if (!(w.x0 >= 0 && w.x0 < w.x1 && w.x1 <= width && w.y0 >= 0 && w.y0 < w.y1 && w.y1 <= height)) throw new Error('A detected box falls outside the selected image.');
    if (!Number.isFinite(w.confidence) || w.confidence < 0 || w.confidence > 1) throw new Error('A detection confidence is invalid.');
    const bw = w.x1 - w.x0, bh = w.y1 - w.y0;
    const long = Math.max(bw, bh);
    return {
      detection_id: i + 1, x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1,
      confidence: new PyFloat(w.confidence), diameter_px: new PyFloat((bw + bh) / 2),
      axis_ratio: new PyFloat(long <= 0 ? 0 : Math.min(bw, bh) / long),
      bbox_area_pixels: bw * bh, bbox_center_x: new PyFloat((w.x0 + w.x1) / 2), bbox_center_y: new PyFloat((w.y0 + w.y1) / 2),
    };
  });
}

/** The box-only archive of tools/web_mask_generator/detector.py. */
export async function buildDetectionZip({
  inputName, inputBytes, image, wells, model, settings = {}, spacrVersion, readmeText = null,
  unavailable = null, deflate = true, date = new Date(), backend = 'browser-onnx',
}) {
  const { data, width, height } = image;
  const channels = image.channels ?? 1;
  const axes = image.axes ?? (channels > 1 ? 'CYX' : 'YX');
  if (!['YX', 'CYX'].includes(axes) || !width || !height || data.length !== width * height * channels) throw new Error('The detection image must declare YX or CYX axes.');
  if (!finiteArray(data)) throw new Error('The detection image must contain finite numeric pixels.');
  if (!String(model?.id ?? '').trim() || !String(model?.version ?? '').trim() || !HEX64.test(model?.weights_sha256 ?? '')) throw new Error('The detection model identity and weight SHA-256 are required.');
  const settingsCopy = JSON.parse(JSON.stringify(settings));
  if (!settingsCopy || typeof settingsCopy !== 'object' || Array.isArray(settingsCopy)) throw new Error('Detection settings must be a JSON object.');
  const rows = detectionRows(wells, width, height);
  const files = [
    { name: `input/${basename(inputName)}`, bytes: new Uint8Array(inputBytes) },
    { name: 'image.tif', bytes: tiffBytes(data, { width, height, channels, axes }) },
    { name: 'objects.csv', bytes: utf8(csvText(rows, DETECTION_COLUMNS)) },
    { name: 'boxes.json', bytes: utf8(pyJson(rows, { indent: 2 }) + '\n') },
    { name: 'README.txt', bytes: utf8(readmeText ?? DETECTION_README) },
  ];
  const modelEntry = { id: model.id, version: model.version, weights_sha256: model.weights_sha256.toLowerCase() };
  if (model.source_weights_sha256) modelEntry.source_weights_sha256 = model.source_weights_sha256.toLowerCase();
  const manifest = {
    schema_version: 1, spacr_version: spacrVersion, result_kind: 'detections', backend,
    model: modelEntry, settings: settingsCopy, image_axes: axes, shape_yx: [height, width],
    detection_count: rows.length, outputs: { boxes: { available: true } }, unavailable: unavailable ?? DETECTION_UNAVAILABLE,
    measurements: { box_coordinates: 'pixels, zero-based, exclusive upper edge', area: 'bounding rectangle pixels', centre: 'bounding rectangle centre' },
  };
  return finishArchive(files, manifest, { deflate, date });
}

/* ------------------------------------------------------------------ */
/* readers for the result viewer (the browser route's ZIPs)          */
/* ------------------------------------------------------------------ */

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch { /* fall through to node:zlib */ }
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.inflateRawSync(bytes));
}

/** Members of a PKZIP archive (stored or deflated) as Map(name -> Uint8Array), CRC-checked. */
export async function unzip(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  const stop = Math.max(0, bytes.length - 22 - 65535);
  while (eocd >= stop && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < stop) throw new Error('not a ZIP archive');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('corrupt ZIP directory');
    const method = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(off + 26, true), lext = dv.getUint16(off + 28, true);
    const raw = bytes.subarray(off + 30 + lnlen + lext, off + 30 + lnlen + lext + csize);
    if (method !== 0 && method !== 8) throw new Error(`unsupported ZIP method ${method}`);
    const data = method === 8 ? await inflateRaw(raw) : raw;
    if (crc32(data) !== crc) throw new Error(`ZIP checksum mismatch: ${name}`);
    out.set(name, data);
    p += 46 + nlen + elen + clen;
  }
  return out;
}

const NPY_TYPES = { u1: Uint8Array, i1: Int8Array, u2: Uint16Array, i2: Int16Array, u4: Uint32Array, i4: Int32Array, f4: Float32Array, f8: Float64Array, b1: Uint8Array };

/** NumPy .npy (v1-v3, C order, little-endian numeric) to { data, shape, descr }. */
export function parseNpy(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (bytes[0] !== 0x93 || String.fromCharCode(...bytes.subarray(1, 6)) !== 'NUMPY') throw new Error('not an NPY file');
  const major = bytes[6];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hlen = major === 1 ? dv.getUint16(8, true) : dv.getUint32(8, true);
  const start = major === 1 ? 10 : 12;
  const header = new TextDecoder().decode(bytes.subarray(start, start + hlen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const fortran = /'fortran_order':\s*True/.test(header);
  const shapeText = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? '';
  const shape = shapeText.split(',').map(s => s.trim()).filter(Boolean).map(Number);
  const kind = descr ? descr.slice(1) : '';
  const Ctor = NPY_TYPES[kind];
  if (!Ctor || fortran || (descr[0] === '>' && Ctor.BYTES_PER_ELEMENT > 1)) throw new Error(`unsupported NPY array ${descr}`);
  const count = shape.reduce((n, s) => n * s, 1);
  const offset = start + hlen;
  const copy = bytes.slice(offset, offset + count * Ctor.BYTES_PER_ELEMENT);
  return { data: new Ctor(copy.buffer, 0, count), shape, descr };
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function zlibDeflate(bytes) {
  if (typeof CompressionStream === 'function') {
    try { return await compress(bytes, 'deflate'); } catch { /* node fallback */ }
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.deflateSync(bytes));
}

/**
 * Lossless 16-bit greyscale PNG of a label image (label value = pixel value),
 * readable by skimage/imageio/PIL. Labels above 65535 cannot be stored.
 */
export async function labelPng(labels, width, height) {
  if (labels.length !== width * height) throw new Error('label size does not match its shape');
  const row = 1 + width * 2;
  const raw = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const base = y * row;
    for (let x = 0; x < width; x++) {
      const v = labels[y * width + x];
      if (v > 65535 || v < 0) throw new Error('labels exceed the 16-bit PNG range');
      raw[base + 1 + 2 * x] = v >> 8;
      raw[base + 2 + 2 * x] = v & 0xFF;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), pngChunk('IHDR', ihdr), pngChunk('IDAT', await zlibDeflate(raw)), pngChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
