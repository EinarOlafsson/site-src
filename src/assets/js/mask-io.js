// Reads an uploaded or example image in the browser, for the channel picker,
// the preview and the in-browser route. Nothing is uploaded by this module.
// TIFF uses geotiff.js and PDF uses pdf.js, both loaded on demand from the
// pinned CDN URLs in the page configuration.

export const EXTENSIONS = [".tif", ".tiff", ".png", ".jpg", ".jpeg", ".bmp", ".pdf", ".czi", ".nd2"];
const SERVER_ONLY = [".czi", ".nd2"];
const MAX_PAGES_AS_CHANNELS = 64;

export const extensionOf = (name) => {
  const match = /\.[^.]+$/.exec(String(name || "").toLowerCase());
  return match ? match[0] : "";
};

export function acceptedFile(file, maxBytes) {
  const extension = extensionOf(file && file.name);
  if (!EXTENSIONS.includes(extension)) return { ok: false, reason: "type" };
  if (maxBytes && file.size > maxBytes) return { ok: false, reason: "size" };
  return { ok: true, serverOnly: SERVER_ONLY.includes(extension), extension };
}

const moduleCache = new Map();
const load = (url) => {
  if (!moduleCache.has(url)) moduleCache.set(url, import(url));
  return moduleCache.get(url);
};

function sameGrey(r, g, b) {
  for (let i = 0; i < r.length; i += 7) if (r[i] !== g[i] || r[i] !== b[i]) return false;
  for (let i = 0; i < r.length; i++) if (r[i] !== g[i] || r[i] !== b[i]) return false;
  return true;
}

function fromRGBA(rgba, width, height, format) {
  const n = width * height;
  const r = new Uint8Array(n), g = new Uint8Array(n), b = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { r[i] = rgba[j]; g[i] = rgba[j + 1]; b[i] = rgba[j + 2]; }
  const grey = sameGrey(r, g, b);
  return { format, width, height, dtype: "uint8", channels: grey ? [r] : [r, g, b], names: grey ? ["grey"] : ["red", "green", "blue"] };
}

async function rasterFromBitmap(source, width, height) {
  const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

async function readOrdinary(blob, format) {
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  try {
    return fromRGBA(await rasterFromBitmap(bitmap, bitmap.width, bitmap.height), bitmap.width, bitmap.height, format);
  } finally {
    bitmap.close();
  }
}

const dtypeOf = (array) => array instanceof Uint8Array ? "uint8" : array instanceof Uint16Array ? "uint16" : array instanceof Uint32Array ? "uint32"
  : array instanceof Int8Array ? "int8" : array instanceof Int16Array ? "int16" : array instanceof Int32Array ? "int32" : array instanceof Float64Array ? "float64" : "float32";

async function readTiff(buffer, urls) {
  const GeoTIFF = await load(urls.geotiff);
  const tiff = await GeoTIFF.fromArrayBuffer(buffer);
  const count = await tiff.getImageCount();
  const first = await tiff.getImage(0);
  const width = first.getWidth(), height = first.getHeight();
  const samples = first.getSamplesPerPixel();
  if (samples > 1) {
    const rasters = await first.readRasters({ interleave: false });
    const channels = Array.from({ length: samples }, (_, i) => rasters[i]);
    return { format: "TIFF", width, height, dtype: dtypeOf(channels[0]), channels, names: channels.map((_, i) => `c${i}`), pages: count };
  }
  const channels = [];
  for (let i = 0; i < Math.min(count, MAX_PAGES_AS_CHANNELS); i++) {
    const image = i ? await tiff.getImage(i) : first;
    if (image.getWidth() !== width || image.getHeight() !== height || image.getSamplesPerPixel() !== 1) break;
    channels.push((await image.readRasters({ interleave: false }))[0]);
  }
  return { format: "TIFF", width, height, dtype: dtypeOf(channels[0]), channels, names: channels.map((_, i) => `c${i}`), pages: count, truncated: count > channels.length };
}

async function readPdf(buffer, urls, { page = 0, dpi = 150 } = {}) {
  const pdfjs = await load(urls.pdfjs);
  if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = urls.pdfjsWorker;
  const document_ = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  try {
    const pages = document_.numPages;
    const pdfPage = await document_.getPage(Math.min(Math.max(0, page), pages - 1) + 1);
    const viewport = pdfPage.getViewport({ scale: dpi / 72 });
    const width = Math.floor(viewport.width), height = Math.floor(viewport.height);
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    const result = fromRGBA(context.getImageData(0, 0, width, height).data, width, height, "PDF");
    return { ...result, pages, page, dpi };
  } finally {
    document_.destroy();
  }
}

// Returns { format, width, height, dtype, channels: TypedArray[], names, pages? }
// or { format, serverOnly: true } for files only the hosted service can read.
export async function readImage(file, urls, options = {}) {
  const extension = extensionOf(file.name);
  if (SERVER_ONLY.includes(extension)) return { format: extension.slice(1).toUpperCase(), serverOnly: true };
  const buffer = await file.arrayBuffer();
  if (extension === ".tif" || extension === ".tiff") return readTiff(buffer, urls);
  if (extension === ".pdf") return readPdf(buffer, urls, options);
  return readOrdinary(new Blob([buffer], { type: file.type || "application/octet-stream" }), extension.slice(1).toUpperCase());
}

// Percentile-stretched 8-bit preview of up to three channels (grey or RGB),
// with optional label outlines or boxes on top.
export function previewRGBA(image, selected, { labels = null, boxes = null } = {}) {
  const { width, height } = image;
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const stretch = (channel) => {
    const step = Math.max(1, Math.floor(n / 200000));
    const sample = [];
    for (let i = 0; i < n; i += step) sample.push(channel[i]);
    sample.sort((a, b) => a - b);
    const lo = sample[Math.floor(sample.length * 0.01)], hi = sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.99))];
    const scale = hi > lo ? 255 / (hi - lo) : 0;
    const result = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) result[i] = (channel[i] - lo) * scale;
    return result;
  };
  const picks = selected.slice(0, 3).map((index) => stretch(image.channels[index]));
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (picks.length === 3) { out[j] = picks[0][i]; out[j + 1] = picks[1][i]; out[j + 2] = picks[2][i]; }
    else { const v = picks.length === 2 ? (picks[0][i] + picks[1][i]) / 2 : picks[0][i]; out[j] = out[j + 1] = out[j + 2] = v; }
    out[j + 3] = 255;
  }
  if (labels) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = y * width + x, v = labels[i];
      if (!v) continue;
      if ((x > 0 && labels[i - 1] !== v) || (x < width - 1 && labels[i + 1] !== v) || (y > 0 && labels[i - width] !== v) || (y < height - 1 && labels[i + width] !== v)) {
        out[i * 4] = 255; out[i * 4 + 1] = 70; out[i * 4 + 2] = 70;
      }
    }
  }
  for (const box of boxes || []) {
    const x0 = Math.max(0, Math.floor(box.x0)), y0 = Math.max(0, Math.floor(box.y0));
    const x1 = Math.min(width - 1, Math.ceil(box.x1) - 1), y1 = Math.min(height - 1, Math.ceil(box.y1) - 1);
    if (x1 <= x0 || y1 <= y0) continue;
    const paint = (x, y) => { const k = (y * width + x) * 4; out[k] = 255; out[k + 1] = 70; out[k + 2] = 70; };
    for (let x = x0; x <= x1; x++) { paint(x, y0); paint(x, y1); }
    for (let y = y0; y <= y1; y++) { paint(x0, y); paint(x1, y); }
  }
  return out;
}

export async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Fetches one pinned held-out test image and checks its size and SHA-256.
export async function fetchExample(record, { fetchImpl = fetch } = {}) {
  const url = `https://huggingface.co/datasets/${record.repo_id}/resolve/${record.revision}/${record.filename.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength !== record.bytes || (await sha256Hex(buffer)) !== record.sha256) throw new Error("checksum");
  const name = record.filename.slice(record.filename.lastIndexOf("/") + 1);
  return { file: new File([buffer], name, { type: name.endsWith(".png") ? "image/png" : name.match(/\.jpe?g$/) ? "image/jpeg" : "image/tiff" }), url };
}
