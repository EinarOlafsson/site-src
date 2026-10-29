import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MASK_STRINGS, FIELDS, FILTERS, modelCatalogue, renderMaskGenerator, validateBrowserManifest, validateBuildConfig, validateExamples } from "./mask-generator.mjs";
import { INFER_INPUTS, browserSettings, channelLimit, colabUrl, diameterFor, familyFromHash, format, parseChannels, removeBorderObjects, serviceKey, validateConfig } from "../src/assets/js/mask-generator.js";
import { acceptedFile, extensionOf, previewRGBA } from "../src/assets/js/mask-io.js";
import { englishFor, translator, readPartials } from "./i18n.mjs";

const read = name => JSON.parse(fs.readFileSync(new URL(`../data/${name}`, import.meta.url)));
const config = read("mask-generator.json");
const models = read("models.json");
const examples = read(config.examples);
const browserModels = read(config.browser.manifest);
const template = fs.readFileSync(new URL("../src/projects/spacr/index.html", import.meta.url), "utf8");
const english = englishFor(readPartials(new URL("../src/_partials", import.meta.url).pathname, template), new URL("../data", import.meta.url).pathname);
const tr = translator(null, english);
const statuses = { defaults: {}, display: {} };
const catalogue = () => modelCatalogue(config, models, statuses);
const clone = object => structuredClone(object);
const html = () => renderMaskGenerator(config, models, statuses, tr, { browserModels, examples });
const pageConfig = () => JSON.parse(html().match(/data-mask-config>(.*?)<\/script>/s)[1]);

// spaCR's generated notebooks, one per model class (tools/web_mask_generator/colab/by_class/ on nightly).
const NOTEBOOKS = ["toxoplasma_pv", "toxoplasma_plaque", "toxoplasma_well_detector", "cell_from_hoechst", "nuclei_from_cellmask", "toxoplasma_from_cellmask", "toxoplasma_from_hoechst", "live_cell"];

test("all eight real families keep defaults, versions and the public live-cell alias", () => {
  const families = catalogue();
  assert.equal(families.length, 8);
  assert.equal(families.flatMap(family => family.versions).length, 19);
  assert.equal(families.find(family => family.id === "toxoplasma_pv").default, "toxoplasma_pv_v4");
  assert.equal(families.find(family => family.id === "toxoplasma_plaque").default, "toxoplasma_plaque_v6");
  assert.equal(families.find(family => family.id === "toxoplasma_well_detector").default, "toxoplasma_well_detector_v3");
  assert.equal(families.find(family => family.id === "live_cell").default, "live-cell-v1");
});

test("actual current defaults win; unavailable or ambiguous defaults refuse instead of silently substituting", () => {
  const changed = { defaults: { toxoplasma_pv_v2: "current" }, display: {} };
  assert.equal(modelCatalogue(config, models, changed)[0].default, "toxoplasma_pv_v2");
  assert.throws(() => modelCatalogue(config, models, { defaults: { toxoplasma_pv_v999: "current" } }), /absent/);
  assert.throws(() => modelCatalogue(config, models, { defaults: { toxoplasma_pv_v2: "a", toxoplasma_pv_v4: "b" } }), /Ambiguous/);
});

test("unsafe cards, missing versions and invalid family identities fail before HTML is rendered", () => {
  const unsafe = clone(models); unsafe.groups[0].models[0].repo_url = "javascript:alert(1)";
  assert.throws(() => modelCatalogue(config, unsafe), /public model cards/);
  const missing = clone(config); missing.families[0].default = "unknown";
  assert.throws(() => modelCatalogue(missing, models), /default/);
  const duplicate = clone(config); duplicate.families.push(duplicate.families[0]);
  assert.throws(() => modelCatalogue(duplicate, models), /duplicate/);
});

test("the form contract names all 23 inputs in order", () => {
  assert.deepEqual(config.protocol, INFER_INPUTS);
  const names = [...FIELDS, ...FILTERS].map(field => field[0]);
  names.push("path", "model_key", "chosen_channels", "native_scale", "advanced", "background_switch", "border_switch");
  assert.deepEqual([...names].sort(), [...INFER_INPUTS].sort());
  const reversed = clone(config); reversed.protocol.reverse();
  assert.throws(() => modelCatalogue(reversed, models), /protocol/);
  assert.throws(() => validateConfig({ ...pageConfig(), protocol: reversed.protocol }), /protocol/);
  assert.equal(serviceKey("live-cell-v1"), "live_cell_v1");
  assert.equal(serviceKey("toxoplasma_pv_v4"), "toxoplasma_pv_v4");
});

test("each model class links its own spaCR notebook in Google Colab; no hosted Space is linked", () => {
  assert.deepEqual(catalogue().map(family => family.id).sort(), [...NOTEBOOKS].sort());
  assert.equal(colabUrl(config.colab, "toxoplasma_pv"), "https://colab.research.google.com/github/EinarOlafsson/spacr/blob/nightly/tools/web_mask_generator/colab/by_class/toxoplasma_pv.ipynb");
  const page = html();
  for (const id of NOTEBOOKS) assert.match(page, new RegExp(`href="${colabUrl(config.colab, id).replace(/[.?/]/g, "\\$&")}"[^>]*target="_blank" rel="noopener"`));
  assert.doesNotMatch(page, /hf\.space|huggingface\.co\/spaces|ZeroGPU|name="accepted"/);
  for (const bad of [{ ...config.colab, branch: "a b" }, { ...config.colab, notebook: "../x/{family}.ipynb" }, { ...config.colab, notebook: "x.ipynb" }, { ...config.colab, repository: "javascript:alert(1)" }]) {
    assert.throws(() => validateBuildConfig({ ...clone(config), colab: bad }), /Colab/);
  }
  assert.throws(() => validateBuildConfig({ ...clone(config), hosted: { url: "https://x.hf.space" } }), /Colab/);
});

test("pinned libraries are validated", () => {
  assert.equal(validateBuildConfig(config), config);
  for (const url of [config.browser.runtime, config.readers.geotiff, config.readers.pdfjs]) assert.match(url, /@\d+\.\d+\.\d+\//);
  const floating = clone(config); floating.browser.runtime = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.webgpu.min.mjs";
  assert.throws(() => validateBuildConfig(floating), /pin/);
  const foreign = clone(config); foreign.browser.runtime = "https://example.com/ort@1.0.0/ort.mjs";
  assert.throws(() => validateBuildConfig(foreign), /CDN/);
});

test("browser manifest stays unpublished until a Hugging Face base URL and verified files exist", () => {
  assert.equal(validateBrowserManifest(browserModels), browserModels);
  assert.throws(() => validateBrowserManifest({ ...browserModels, base_url: "https://example.com/" }), /Hugging Face/);
  const bad = { schema: 1, base_url: null, models: { nuclei_from_cellmask_v1: { file: "x.onnx", sha256: "nothex", bytes: 1 } } };
  assert.throws(() => validateBrowserManifest(bad), /Invalid browser model/);
});

test("random examples are pinned held-out TEST images for every model class", () => {
  assert.equal(validateExamples(examples, catalogue()), examples);
  const families = new Set(examples.records.map(record => record.family));
  assert.deepEqual([...families].sort(), catalogue().map(family => family.id).sort());
  for (const record of examples.records) {
    assert.equal(record.split, "test");
    assert.deepEqual(Object.keys(record).sort(), ["bytes", "credit", "family", "filename", "repo_id", "revision", "sha256", "split"]);
    assert(record.bytes <= config.max_upload_bytes);
  }
  const training = clone(examples); training.records[0].split = "train";
  assert.throws(() => validateExamples(training, catalogue()), /approved example/);
});

test("source defaults are retained rather than borrowing another family's settings", () => {
  const defaults = Object.fromEntries(FIELDS.map(field => [field[0], field[2]]));
  assert.equal(defaults.chosen_diameter, "");
  assert.equal(defaults.flow_threshold, 0.4);
  assert.equal(defaults.selected_dpi, 150);
  assert.equal(defaults.chosen_magnification, 20);
  assert.equal(defaults.detector_image_size, 640);
  assert.equal(config.families.find(f => f.id === "toxoplasma_plaque").score, 0);
  assert.equal(config.families.find(f => f.id === "toxoplasma_pv").score, -1);
});

test("browser settings follow spaCR's desktop defaults and refuse desktop-only filters", () => {
  const families = Object.fromEntries(config.families.map(f => [f.id, f]));
  const base = { chosen_diameter: null, native_scale: false, flow_threshold: 0.4, score_threshold: 0, chosen_magnification: 20, advanced: "{}", background_value: null, signal_value: null, lower_value: null, background_switch: "default", perimeter_value: null, border_switch: "default", detection_confidence: 0.25, minimum_axis_ratio: 0.7, detector_image_size: 640 };
  assert.equal(diameterFor("cell", 20), 120);
  assert.equal(diameterFor("nucleus", 20), 60);
  assert.equal(diameterFor("pathogen", 40), 40);
  const nuclei = browserSettings(families.nuclei_from_cellmask, base);
  assert.equal(nuclei.diameter, 60);
  assert.deepEqual(nuclei.normalization, { background: 100, signalToNoise: 10, removeBackground: false, lowerPercentile: 2 });
  assert.equal(nuclei.resample, true);
  const pv = browserSettings(families.toxoplasma_pv, { ...base, score_threshold: -1, background_switch: "disabled", border_switch: "enabled" });
  assert.deepEqual([pv.diameter, pv.resample, pv.normalization.removeBackground, pv.removeBorder], [20, false, false, true]);
  assert.equal(browserSettings(families.cell_from_hoechst, { ...base, native_scale: true }).diameter, null);
  assert.throws(() => browserSettings(families.cell_from_hoechst, { ...base, perimeter_value: 0.2 }), /desktop_only/);
  assert.throws(() => browserSettings(families.cell_from_hoechst, { ...base, advanced: '{"object_filters": []}' }), /desktop_only/);
  assert.throws(() => browserSettings(families.toxoplasma_plaque, base), /diameter/);
  assert.equal(browserSettings(families.toxoplasma_plaque, { ...base, chosen_diameter: 52 }).normalize, true);
  assert.equal(browserSettings(families.toxoplasma_well_detector, base).kind, "detector");
  assert.deepEqual(config.families.map(channelLimit), [1, 3, 3, 1, 1, 1, 1, 1]);
});

test("channel parsing, border removal and previews behave on real arrays", () => {
  assert.deepEqual(parseChannels("0, 2"), [0, 2]);
  assert.equal(parseChannels("a"), null);
  assert.equal(parseChannels("-1"), null);
  const labels = new Uint32Array([1, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0]);
  assert.deepEqual([...removeBorderObjects(labels, 4, 4)], [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const image = { width: 2, height: 2, channels: [new Uint16Array([0, 100, 200, 300])] };
  const rgba = previewRGBA(image, [0], { labels: new Uint32Array([1, 0, 0, 0]) });
  assert.equal(rgba.length, 16);
  assert.deepEqual([...rgba.slice(0, 4)], [255, 70, 70, 255]);
  assert.equal(format("{n} of {total}", { n: 1 }), "1 of {total}");
});

test("file type and size checks run before anything is read or uploaded", () => {
  assert.equal(extensionOf("A.OME.TIFF"), ".tiff");
  assert.deepEqual(acceptedFile({ name: "x.czi", size: 10 }, 100), { ok: true, serverOnly: true, extension: ".czi" });
  assert.equal(acceptedFile({ name: "x.exe", size: 10 }, 100).reason, "type");
  assert.equal(acceptedFile({ name: "x.png", size: 101 }, 100).reason, "size");
});

test("rendered HTML has one tab per model class, live controls and no premature readiness claim", () => {
  const page = html();
  assert.equal((page.match(/role="tab" /g) || []).length, 8);
  assert.equal((page.match(/role="tabpanel"/g) || []).length, 8);
  assert.equal((page.match(/data-model="/g) || []).length, 18);
  assert.match(page, /type="submit" disabled/);
  assert.doesNotMatch(page, /type="file"[^>]*disabled/);
  for (const name of INFER_INPUTS) assert.match(page, new RegExp(`name="${name}"`));
  assert.match(page, /boxes, not segmentation masks/);
  assert.match(page, /raw logits, not calibrated probabilities/);
  assert.match(page, /Checking the in-browser model/);
  assert.match(page, /name="route" value="browser" checked/);
  assert.match(page, /name="route" value="colab">/);
  const browser = pageConfig();
  assert.equal(validateConfig(browser), browser);
  assert.equal(browser.examples.length, examples.records.length);
  assert.equal(browser.strings["mask.browser_na2"], MASK_STRINGS["mask.browser_na2"]);
  assert.equal(browser.hosted, undefined);
});

test("family deep links select only real families and preserve malformed-link fallback", () => {
  for (const family of config.families) assert.equal(familyFromHash(`#mask-${family.id}`, config.families), family);
  for (const bad of ["#mask-generator", "#mask-unknown", "#mask-%", "#models"]) assert.equal(familyFromHash(bad, config.families), null);
});

test("all new strings enter the existing normal i18n reference unchanged", () => {
  for (const [key, value] of Object.entries(MASK_STRINGS)) assert.equal(english.get(key), value);
});
