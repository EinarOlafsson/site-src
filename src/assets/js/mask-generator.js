// Mask generator client. Two routes, chosen by the visitor:
//   hosted  - the spaCR Hugging Face Space (ZeroGPU) through @gradio/client;
//             the file is uploaded after explicit consent.
//   browser - the exported ONNX model in onnxruntime-web (WebGPU, WASM
//             fallback); the file never leaves the computer.
// Each route reports "not yet available" until it actually is.
import { acceptedFile, extensionOf, fetchExample, previewRGBA, readImage, sha256Hex } from "./mask-io.js";

export const INFER_INPUTS = Object.freeze([
  "path", "model_key", "accepted", "selected_series", "selected_t", "selected_z", "chosen_channels",
  "selected_page", "selected_dpi", "chosen_diameter", "native_scale", "flow_threshold", "score_threshold",
  "chosen_magnification", "advanced", "detection_confidence", "minimum_axis_ratio", "background_value",
  "signal_value", "lower_value", "background_switch", "perimeter_value", "border_switch", "detector_image_size"
]);

export const serviceKey = key => String(key).replace(/^live-cell-v/, "live_cell_v");
export const endpointFor = family => family.id === "toxoplasma_plaque" ? "/segment_plaque" : family.output === "boxes" ? "/detect_wells" : `/segment_${family.id}`;
export const channelLimit = family => family.output === "boxes" ? 3 : family.id === "toxoplasma_plaque" ? 3 : 1;

export function validateConfig(config) {
  if (config.schema !== 2 || JSON.stringify(config.protocol) !== JSON.stringify(INFER_INPUTS)) throw new Error("Unsupported inference protocol");
  if (!Array.isArray(config.families) || !config.families.length) throw new Error("Missing model families");
  const ids = new Set();
  for (const family of config.families) {
    if (!/^[a-z_]+$/.test(family.id) || ids.has(family.id) || !family.versions.includes(family.default)) throw new Error("Invalid family/default");
    ids.add(family.id);
  }
  if (config.hosted.url !== null && !/^https:\/\/[a-z0-9-]+\.hf\.space$/.test(config.hosted.url)) throw new Error("Hosted service must be an hf.space URL");
  return config;
}

export function familyFromHash(hash, families) {
  let id;
  try { id = decodeURIComponent(String(hash).replace(/^#mask-/, "")); } catch { return null; }
  return families.find(family => family.id === id) || null;
}

export const format = (text, values = {}) => String(text).replace(/\{(\w+)\}/g, (match, key) => key in values ? String(values[key]) : match);

// spaCR's magnification rule for the expected object diameter (item 696).
export function diameterFor(role, magnification) {
  const mag = Number(magnification);
  if (!Number.isFinite(mag) || mag <= 0) return null;
  if (role === "cell") return 2 * mag + 80;
  if (role === "nucleus") return 0.75 * mag + 45;
  if (role === "pathogen") return mag;
  return null;
}

const numberOrNull = value => {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function parseChannels(text) {
  const parts = String(text).split(",").map(part => part.trim()).filter(Boolean);
  const channels = parts.map(Number);
  if (!channels.length || channels.some(c => !Number.isInteger(c) || c < 0)) return null;
  return channels;
}

// The 24 positional inputs of the hosted service, named as its API names them.
export function hostedPayload(values, file, handleFile) {
  return {
    path: handleFile(file), model_key: serviceKey(values.model_key), accepted: values.accepted === true,
    selected_series: values.selected_series, selected_t: values.selected_t, selected_z: values.selected_z,
    chosen_channels: values.chosen_channels, selected_page: values.selected_page, selected_dpi: values.selected_dpi,
    chosen_diameter: values.chosen_diameter, native_scale: values.native_scale, flow_threshold: values.flow_threshold,
    score_threshold: values.score_threshold, chosen_magnification: values.chosen_magnification, advanced: values.advanced,
    detection_confidence: values.detection_confidence, minimum_axis_ratio: values.minimum_axis_ratio,
    background_value: values.background_value, signal_value: values.signal_value, lower_value: values.lower_value,
    background_switch: values.background_switch, perimeter_value: values.perimeter_value, border_switch: values.border_switch,
    detector_image_size: values.detector_image_size
  };
}

export function formValues(form, channels) {
  const get = name => form.elements[name];
  const n = name => numberOrNull(get(name).value);
  return {
    model_key: get("model_key").value, accepted: get("accepted").checked,
    selected_series: n("selected_series") ?? 0, selected_t: n("selected_t") ?? 0, selected_z: n("selected_z") ?? 0,
    chosen_channels: channels, selected_page: n("selected_page") ?? 0, selected_dpi: n("selected_dpi") ?? 150,
    chosen_diameter: n("chosen_diameter"), native_scale: get("native_scale").checked, flow_threshold: n("flow_threshold") ?? 0.4,
    score_threshold: n("score_threshold") ?? 0, chosen_magnification: n("chosen_magnification") ?? 20, advanced: get("advanced").value || "{}",
    detection_confidence: n("detection_confidence") ?? 0.25, minimum_axis_ratio: n("minimum_axis_ratio") ?? 0.7,
    background_value: n("background_value"), signal_value: n("signal_value"), lower_value: n("lower_value"),
    background_switch: get("background_switch").value, perimeter_value: n("perimeter_value"), border_switch: get("border_switch").value,
    detector_image_size: n("detector_image_size") ?? 640
  };
}

// Settings the browser route runs with, from the form and the family's desktop defaults.
export function browserSettings(family, values) {
  const desktop = family.desktop || {};
  if (family.output === "boxes") return { kind: "detector", confidence: values.detection_confidence, minAxisRatio: values.minimum_axis_ratio, imgsz: values.detector_image_size };
  if (family.id === "toxoplasma_plaque") {
    if (!values.native_scale && !(values.chosen_diameter > 0)) throw new Error("diameter");
    return { kind: "plaque", normalize: true, diameter: values.native_scale ? null : values.chosen_diameter, resample: true, flowThreshold: values.flow_threshold, cellprobThreshold: values.score_threshold, minSize: 15 };
  }
  let advanced = {};
  try { advanced = JSON.parse(values.advanced || "{}"); } catch { throw new Error("json"); }
  if (values.perimeter_value > 0 || (advanced && Object.keys(advanced).length)) throw new Error("hosted_only");
  const diameter = values.native_scale ? null : values.chosen_diameter > 0 ? values.chosen_diameter : diameterFor(desktop.role, values.chosen_magnification);
  const pick = (value, fallback) => value === null || value === undefined ? fallback : value;
  const toggle = (state, fallback) => state === "enabled" ? true : state === "disabled" ? false : fallback;
  return {
    kind: "mask", role: desktop.role, diameter, resample: desktop.resample !== false,
    flowThreshold: values.flow_threshold, cellprobThreshold: values.score_threshold, minSize: 0,
    normalization: {
      background: pick(values.background_value, desktop.background), signalToNoise: pick(values.signal_value, desktop.signal_to_noise),
      removeBackground: toggle(values.background_switch, desktop.remove_background), lowerPercentile: pick(values.lower_value, desktop.lower_percentile)
    },
    removeBorder: toggle(values.border_switch, false)
  };
}

export function removeBorderObjects(labels, width, height) {
  const drop = new Set();
  for (let x = 0; x < width; x++) { drop.add(labels[x]); drop.add(labels[(height - 1) * width + x]); }
  for (let y = 0; y < height; y++) { drop.add(labels[y * width]); drop.add(labels[y * width + width - 1]); }
  drop.delete(0);
  if (!drop.size) return labels;
  const remap = new Map();
  const out = new Uint32Array(labels.length);
  let next = 1;
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i];
    if (!v || drop.has(v)) continue;
    if (!remap.has(v)) remap.set(v, next++);
    out[i] = remap.get(v);
  }
  return out;
}

const loaded = new Map();
const once = (url) => { if (!loaded.has(url)) loaded.set(url, import(url)); return loaded.get(url); };

async function modelBytes(url, sha256, bytes, onProgress) {
  let cache = null;
  try { cache = await caches.open("spacr-mask-models-v1"); } catch { cache = null; }
  const key = `${url}#${sha256}`;
  const hit = cache && await cache.match(key);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const reader = response.body.getReader();
  const out = new Uint8Array(bytes);
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > bytes) throw new Error("model size");
    out.set(value, offset);
    offset += value.length;
    onProgress(offset, bytes);
  }
  if (offset !== bytes) throw new Error("model size");
  onProgress(-1, bytes);
  if (await sha256Hex(out) !== sha256) throw new Error("model checksum");
  if (cache) { try { await cache.put(key, new Response(out)); } catch { /* storage quota: run without caching */ } }
  return out;
}

export function initMaskGenerator(root, environment = globalThis) {
  const config = validateConfig(JSON.parse(root.querySelector("[data-mask-config]").textContent));
  const text = (key, values) => format(config.strings[`mask.${key}`] ?? key, values);
  const form = root.querySelector("[data-mask-form]");
  const $ = selector => root.querySelector(selector);
  const tabs = [...root.querySelectorAll('.mask-family-tabs [role="tab"]')];
  const cards = [...root.querySelectorAll("[data-family]")];
  const defaults = [...form.querySelectorAll("input[name], select[name], textarea[name]")].map(element => [element, element.type === "checkbox" ? element.defaultChecked : element.value]);
  const state = { family: config.families[0], file: null, image: null, credit: "", hosted: null, sessions: new Map(), job: null, url: null };
  const status = (selector, message) => { $(selector).textContent = message || ""; };

  const route = () => form.elements.route.value;
  const manifestEntry = () => config.browserModels.models[form.elements.model_key.value] ?? config.browserModels.models[serviceKey(form.elements.model_key.value)];
  const published = new Map();
  async function browserReady() {
    const entry = manifestEntry();
    if (!config.browserModels.base_url || !entry) return false;
    if (!published.has(entry.sha256)) {
      published.set(entry.sha256, environment.fetch(config.browserModels.base_url + entry.file, { method: "HEAD" })
        .then(response => response.ok).catch(() => false));
    }
    return published.get(entry.sha256);
  }

  async function probeHosted() {
    if (!config.hosted.url) return false;
    if (state.hosted !== null) return state.hosted;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await environment.fetch(`${config.hosted.url}/config`, { signal: controller.signal });
      const body = response.ok ? await response.json() : null;
      state.hosted = Boolean(body && Array.isArray(body.components));
    } catch {
      state.hosted = false;
    } finally {
      clearTimeout(timer);
    }
    return state.hosted;
  }

  function selectedChannels() {
    if (!state.image || state.image.serverOnly) return parseChannels(form.elements.chosen_channels.value);
    return [...root.querySelectorAll("[data-channel-list] input:checked")].map(input => Number(input.value));
  }

  function channelsValid() {
    const channels = selectedChannels();
    if (!channels || !channels.length) return false;
    if (state.family.output === "boxes") return channels.length === 1 || channels.length === 3;
    return channels.length <= channelLimit(state.family);
  }

  async function refreshRoute() {
    const hosted = route() === "hosted";
    $("[data-hosted-consent]").hidden = !hosted;
    $("[data-browser-note]").hidden = hosted;
    let ready;
    if (hosted) {
      status("[data-route-status]", text("hosted_checking"));
      ready = await probeHosted();
      if (route() !== "hosted") return;
      status("[data-route-status]", text(ready ? "hosted_ready" : "hosted_na"));
    } else {
      ready = await browserReady();
      if (route() !== "browser") return;
      const gpu = Boolean(environment.isSecureContext && environment.navigator?.gpu);
      status("[data-route-status]", text(ready ? (gpu ? "browser_ready_gpu" : "browser_ready_cpu") : "browser_na"));
    }
    const fileOk = Boolean(state.file) && (hosted || (state.image && !state.image.serverOnly));
    $("[data-run]").disabled = !(ready && fileOk && channelsValid() && (!hosted || form.elements.accepted.checked) && !state.job);
  }

  function drawPreview(overlay = {}) {
    const image = state.image;
    const channels = selectedChannels();
    if (!image || image.serverOnly || !channels || !channels.length || channels.some(c => c >= image.channels.length)) { $("[data-preview]").hidden = true; return; }
    const canvas = $("[data-preview-canvas]");
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext("2d").putImageData(new ImageData(previewRGBA(image, channels, overlay), image.width, image.height), 0, 0);
    $("[data-preview]").hidden = false;
  }

  function buildChannelPicker() {
    const list = $("[data-channel-list]");
    list.textContent = "";
    const family = state.family;
    $("[data-channel-hint]").textContent = text(family.output === "boxes" ? "channel_hint_detector" : family.id === "toxoplasma_plaque" ? "channel_hint_plaque" : "channel_hint_one");
    const image = state.image;
    $("[data-channels]").hidden = !image;
    if (!image) return;
    $("[data-channel-numbers]").hidden = !image.serverOnly;
    if (image.serverOnly) return;
    const preselect = image.channels.length === 3 && channelLimit(family) === 3 ? [0, 1, 2] : [0];
    image.channels.forEach((_, index) => {
      const label = environment.document.createElement("label");
      const input = environment.document.createElement("input");
      input.type = "checkbox"; input.name = "channel"; input.value = String(index); input.checked = preselect.includes(index);
      input.addEventListener("change", () => { drawPreview(); refreshRoute(); });
      label.append(input, ` ${text("channel_n", { n: index })}`);
      list.append(label);
    });
  }

  async function useFile(file, credit = "") {
    clearResult();
    const check = acceptedFile(file, config.max_upload_bytes);
    if (!check.ok) {
      status("[data-file-status]", text(check.reason === "size" ? "too_large" : "bad_type"));
      state.file = null; state.image = null;
      buildChannelPicker(); drawPreview(); refreshRoute();
      return;
    }
    state.file = file; state.credit = credit;
    status("[data-file-status]", text("reading"));
    try {
      state.image = await readImage(file, config.readers, { page: numberOrNull(form.elements.selected_page.value) ?? 0, dpi: numberOrNull(form.elements.selected_dpi.value) ?? 150 });
      const info = state.image.serverOnly ? text("server_only") : text("image_info", { width: state.image.width, height: state.image.height, channels: state.image.channels.length, dtype: state.image.dtype });
      status("[data-file-status]", [credit, `${file.name}: ${info}`].filter(Boolean).join(" "));
    } catch {
      state.image = null;
      status("[data-file-status]", [credit, text("read_failed")].filter(Boolean).join(" "));
    }
    for (const element of form.querySelectorAll('[data-scope="pdf"]')) element.hidden = extensionOf(file.name) !== ".pdf";
    buildChannelPicker();
    drawPreview();
    refreshRoute();
  }

  async function randomExample() {
    const records = config.examples.filter(record => record.family === state.family.id);
    if (!records.length) return;
    const record = records[Math.floor(Math.random() * records.length)];
    status("[data-file-status]", text("example_loading"));
    try {
      const { file } = await fetchExample(record);
      await useFile(file, text("example_credit", { name: file.name, source: `huggingface.co/datasets/${record.repo_id} (${record.credit})` }));
    } catch (error) {
      status("[data-file-status]", text("failed", { reason: error.message }));
    }
  }

  function clearResult() {
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = null;
    $("[data-result]").hidden = true;
    $("[data-quota-hint]").hidden = true;
    status("[data-run-status]", "");
  }

  function finish(zipBlob, name, message, overlay) {
    state.url = URL.createObjectURL(zipBlob);
    const link = $("[data-download]");
    link.href = state.url; link.download = name;
    $("[data-result]").hidden = false;
    status("[data-run-status]", message);
    if (overlay) drawPreview(overlay);
  }

  function progress(value, max) {
    const bar = $("[data-progress]");
    bar.hidden = value === null;
    if (value === null || value < 0) bar.removeAttribute("value");
    else { bar.max = max; bar.value = value; }
  }

  async function runHosted(values) {
    const { Client, handle_file } = await once(config.hosted.client);
    status("[data-run-status]", text("uploading"));
    progress(-1, 1);
    const client = await Client.connect(config.hosted.url, { events: ["data", "status"] });
    const job = client.submit(endpointFor(state.family), hostedPayload(values, state.file, handle_file));
    state.job = job;
    let data = null;
    for await (const message of job) {
      if (message.type === "status" && message.stage === "error") throw new Error(message.message || message.title || "error");
      if (message.type === "status" && message.stage === "pending" && Number.isFinite(message.position)) status("[data-run-status]", `${text("uploading")} (${message.position + 1})`);
      if (message.type === "data") { data = message.data; break; }
    }
    if (!data || !data[0]?.url) throw new Error(text("hosted_na"));
    const response = await fetch(data[0].url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    let count = "?";
    try {
      const pack = await import("./mask-package.js");
      const manifest = pack.readZipJSON ? await pack.readZipJSON(new Uint8Array(await blob.arrayBuffer()), "manifest.json") : null;
      if (manifest && Number.isInteger(manifest.object_count)) count = manifest.object_count;
    } catch { /* count stays unknown */ }
    if (data[1]?.url) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { const canvas = $("[data-preview-canvas]"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; canvas.getContext("2d").drawImage(img, 0, 0); $("[data-preview]").hidden = false; };
      img.src = data[1].url;
    }
    finish(blob, data[0].orig_name || "spacr-mask-result.zip", text(state.family.output === "boxes" ? "done_wells" : "done_objects", { count }));
  }

  async function session(entry) {
    if (state.sessions.has(entry.sha256)) return state.sessions.get(entry.sha256);
    const ort = await once(config.browser.runtime);
    ort.env.wasm.wasmPaths = config.browser.wasm_paths;
    const bytes = await modelBytes(config.browserModels.base_url + entry.file, entry.sha256, entry.bytes, (done, total) => {
      if (done < 0) { status("[data-run-status]", text("model_verify")); progress(-1, 1); return; }
      status("[data-run-status]", text("model_download", { done: Math.round(done / 1e6), total: Math.round(total / 1e6) }));
      progress(done, total);
    });
    status("[data-run-status]", text("model_start"));
    const gpu = Boolean(environment.isSecureContext && environment.navigator?.gpu);
    const created = await ort.InferenceSession.create(bytes, { executionProviders: gpu ? ["webgpu", "wasm"] : ["wasm"] });
    const result = { ort, model: created };
    state.sessions.set(entry.sha256, result);
    return result;
  }

  async function runBrowser(values) {
    const [core, pack] = await Promise.all([import("./mask-core.js"), import("./mask-package.js")]);
    const entry = manifestEntry();
    const family = state.family;
    const settings = browserSettings(family, values);
    const { ort, model } = await session(entry);
    const image = state.image;
    const { width: W, height: H } = image;
    const channels = values.chosen_channels;
    const inputName = model.inputNames[0], outputName = model.outputNames[0];
    const inputBytes = new Uint8Array(await state.file.arrayBuffer());
    const selected = channels.map(c => image.channels[c]);
    const key = serviceKey(values.model_key);
    const modelInfo = { id: key, version: key.replace(/^.*_(v\d+)$/, "$1"), weights_sha256: entry.sha256, source_weights_sha256: entry.source?.sha256 ?? null };
    const n = W * H;
    const planar = new selected[0].constructor(n * selected.length);
    selected.forEach((channel, c) => planar.set(channel, c * n));
    const imageInfo = { data: planar, width: W, height: H, channels: selected.length, axes: selected.length > 1 ? "CYX" : "YX" };
    const spacrVersion = config.spacr_version;
    if (settings.kind === "detector") {
      const src = selected.length === 3 ? selected : [selected[0], selected[0], selected[0]];
      let peak = 1;
      if (image.dtype !== "uint8") for (const c of src) for (let i = 0; i < c.length; i++) if (c[i] > peak) peak = c[i];
      const scale = image.dtype === "uint8" ? 1 : 255 / peak;
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.min(255, Math.round(src[k][i] * scale));
      const box = core.letterbox(rgb, H, W, settings.imgsz || 640, { channels: 3 });
      status("[data-run-status]", text("computing", { done: 0, total: 1 }));
      const output = await model.run({ [inputName]: new ort.Tensor("float32", box.tensor, [1, 3, box.height, box.width]) });
      const tensor = output[outputName];
      const wells = core.filterWells(core.decodeYolo(tensor.data, tensor.dims, { conf: settings.confidence, H, W, inputHeight: box.height, inputWidth: box.width }), { minAxisRatio: settings.minAxisRatio });
      status("[data-run-status]", text("postprocess"));
      const zip = await pack.buildDetectionZip({ inputName: state.file.name, inputBytes, image: imageInfo, wells, model: modelInfo, spacrVersion, settings: { family: family.id, ...settings, channels } });
      finish(new Blob([zip], { type: "application/zip" }), "spacr-wells.zip", text("done_wells", { count: wells.length }), { boxes: wells });
      return;
    }
    const plane = new Float32Array(n * selected.length);
    selected.forEach((channel, c) => {
      const scaled = settings.kind === "mask" ? core.spacrNormalize(channel, settings.normalization) : channel;
      for (let i = 0; i < n; i++) plane[c * n + i] = scaled[i];
    });
    const runBatch = async (batch, count) => (await model.run({ [inputName]: new ort.Tensor("float32", batch, [count, 3, 256, 256]) }))[outputName].data;
    const result = await core.cellposeEval(plane, selected.length, H, W, runBatch, {
      normalize: settings.normalize === true, diameter: settings.diameter, resample: settings.resample,
      flowThreshold: settings.flowThreshold, cellprobThreshold: settings.cellprobThreshold, minSize: settings.minSize,
      onProgress: (done, total) => { status("[data-run-status]", text("computing", { done, total })); progress(done, total); }
    });
    status("[data-run-status]", text("postprocess"));
    let labels = result.masks;
    if (settings.removeBorder) labels = removeBorderObjects(labels, W, H);
    const rows = core.measureObjects(labels, H, W, selected, { axes: imageInfo.axes });
    const sameSize = result.flowHeight === H && result.flowWidth === W;
    const zip = await pack.buildResultZip({
      inputName: state.file.name, inputBytes, image: imageInfo, labels, rows, spacrVersion, model: modelInfo,
      flows: sameSize ? result.dP : null, cellprob: sameSize ? result.cellprob : null,
      unavailable: sameSize ? {} : { flows: "computed at the model scale (resample off), not the image size", cell_probability: "computed at the model scale (resample off), not the image size" },
      settings: { family: family.id, ...settings, channels, niter: result.niter, rescale: result.rescale }
    });
    finish(new Blob([zip], { type: "application/zip" }), "spacr-masks.zip", text("done_objects", { count: rows.length }), { labels });
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if ($("[data-run]").disabled) return;
    const values = formValues(form, selectedChannels());
    clearResult();
    $("[data-cancel]").hidden = false;
    state.job = { cancel() {} };
    $("[data-run]").disabled = true;
    try {
      if (route() === "hosted") await runHosted(values);
      else await runBrowser(values);
    } catch (error) {
      status("[data-run-status]", text("failed", { reason: error?.message || String(error) }));
      if (route() === "hosted") $("[data-quota-hint]").hidden = false;
    } finally {
      state.job = null;
      $("[data-cancel]").hidden = true;
      progress(null);
      refreshRoute();
    }
  });
  $("[data-cancel]").addEventListener("click", () => { try { state.job?.cancel(); } catch { /* already finished */ } });

  function showModel() {
    const selector = root.querySelector(`[data-model-select="${state.family.id}"]`);
    const value = state.family.versions.includes(selector.value) ? selector.value : state.family.default;
    selector.value = value;
    for (const article of root.querySelectorAll("[data-model]")) article.hidden = article.dataset.model !== value;
    form.elements.model_key.value = value;
    refreshRoute();
  }

  function selectFamily(family, focus = false) {
    if (state.family.id !== family.id) {
      for (const [element, value] of defaults) {
        if (["route", "path", "model_key", "accepted"].includes(element.name)) continue;
        if (element.type === "checkbox") element.checked = value; else element.value = value;
      }
      clearResult();
    }
    state.family = family;
    for (const card of cards) card.hidden = card.dataset.family !== family.id;
    for (const tab of tabs) {
      const on = tab.hash === `#mask-${family.id}`;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    }
    const detector = family.output === "boxes";
    const plaque = family.id === "toxoplasma_plaque";
    for (const element of form.querySelectorAll("[data-scope]")) {
      const scope = element.dataset.scope;
      if (scope === "pdf" || scope === "file") continue;
      element.hidden = scope === "detector" ? !detector : scope === "segmentation" ? detector : scope === "masks" ? (detector || plaque) : false;
    }
    form.elements.score_threshold.value = String(family.score);
    root.querySelector('[data-label="chosen_diameter"]').textContent = text(plaque ? "plaque_diameter" : "diameter");
    root.querySelector('[data-label="native_scale"]').textContent = text(plaque ? "native" : "auto");
    $("[data-run]").textContent = text(detector ? "detect" : "run");
    $("[data-example]").disabled = !config.examples.some(record => record.family === family.id);
    buildChannelPicker();
    drawPreview();
    showModel();
  }

  for (const element of form.querySelectorAll('[data-scope="pdf"]')) element.hidden = true;
  root.querySelectorAll("[data-model-select]").forEach(select => select.addEventListener("change", showModel));
  form.querySelectorAll('[name="route"]').forEach(radio => radio.addEventListener("change", () => { clearResult(); refreshRoute(); }));
  form.elements.accepted.addEventListener("change", refreshRoute);
  form.elements.chosen_channels.addEventListener("input", refreshRoute);
  form.elements.path.addEventListener("change", () => { const file = form.elements.path.files[0]; if (file) useFile(file); });
  for (const name of ["selected_page", "selected_dpi"]) form.elements[name].addEventListener("change", () => { if (state.file && extensionOf(state.file.name) === ".pdf") useFile(state.file, state.credit); });
  $("[data-example]").addEventListener("click", randomExample);
  const drop = $("[data-drop]");
  drop.addEventListener("dragover", event => { event.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", event => { event.preventDefault(); drop.classList.remove("over"); const file = event.dataTransfer?.files?.[0]; if (file) useFile(file); });
  drop.addEventListener("keydown", event => { if (event.target === drop && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); form.elements.path.click(); } });
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", event => {
      event.preventDefault();
      const family = familyFromHash(tab.hash, config.families);
      if (family) { environment.history?.replaceState?.(null, "", tab.hash); selectFamily(family); }
    });
    tab.addEventListener("keydown", event => {
      const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const family = familyFromHash(tabs[(index + step + tabs.length) % tabs.length].hash, config.families);
      if (family) selectFamily(family, true);
    });
  });
  const onLocation = () => { const family = familyFromHash(environment.location.hash, config.families); if (family) selectFamily(family); };
  environment.addEventListener("hashchange", onLocation);
  selectFamily(familyFromHash(environment.location.hash, config.families) || state.family);
}

if (typeof document !== "undefined") {
  document.querySelectorAll("[data-mask-generator]").forEach(root => initMaskGenerator(root));
}
