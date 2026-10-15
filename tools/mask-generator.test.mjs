import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MASK_STRINGS, FIELDS, FILTERS, modelCatalogue, renderMaskGenerator } from "./mask-generator.mjs";
import { INFER_INPUTS, familyFromHash, validateConfig } from "../src/assets/js/mask-generator.js";
import { englishFor, translator, readPartials } from "./i18n.mjs";

const config = JSON.parse(fs.readFileSync(new URL("../data/mask-generator.json", import.meta.url)));
const models = JSON.parse(fs.readFileSync(new URL("../data/models.json", import.meta.url)));
const template = fs.readFileSync(new URL("../src/projects/spacr/index.html", import.meta.url), "utf8");
const english = englishFor(readPartials(new URL("../src/_partials", import.meta.url).pathname, template), new URL("../data", import.meta.url).pathname);
const tr = translator(null, english);
const statuses = { defaults: {}, display: {} };
const catalogue = () => modelCatalogue(config, models, statuses);
const clone = object => structuredClone(object);
const browserConfig = () => ({ ...config, families: catalogue().map(({ versions, ...family }) => ({ ...family, versions: versions.map(model => model.key) })) });

test("all eight real families keep defaults, versions and the public live-cell alias", () => {
  const families = catalogue();
  assert.equal(families.length, 8);
  assert.equal(families.flatMap(family => family.versions).length, 17);
  assert.equal(families.find(family => family.id === "toxoplasma_pv").default, "toxoplasma_pv_v4");
  assert.equal(families.find(family => family.id === "toxoplasma_plaque").default, "toxoplasma_plaque_v4");
  assert.equal(families.find(family => family.id === "toxoplasma_well_detector").default, "toxoplasma_well_detector_v3");
  assert.equal(families.find(family => family.id === "live_cell").default, "live-cell-v1");
  assert(!JSON.stringify(families).includes("live" + "_cell_v1"));
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

test("the actual service positional contract has all 24 inputs in order", () => {
  assert.deepEqual(config.protocol, INFER_INPUTS);
  assert.equal(config.protocol.length, 24);
  const names = [...FIELDS, ...FILTERS].map(field => field[0]);
  names.push("path", "model_key", "accepted", "chosen_channels", "native_scale", "advanced", "background_switch", "border_switch");
  assert.deepEqual([...names].sort(), [...INFER_INPUTS].sort());
  const reversed = clone(config); reversed.protocol.reverse();
  assert.throws(() => modelCatalogue(reversed, models), /protocol/);
  assert.throws(() => validateConfig({ ...browserConfig(), protocol: reversed.protocol }), /protocol/);
});

test("source defaults are retained rather than borrowing another family's settings", () => {
  const defaults = Object.fromEntries(FIELDS.map(field => [field[0], field[2]]));
  assert.equal(defaults.chosen_diameter, "");
  assert.equal(defaults.flow_threshold, 0.4);
  assert.equal(defaults.selected_dpi, 150);
  assert.equal(defaults.chosen_magnification, 20);
  assert.equal(defaults.detector_image_size, 640);
  assert.equal(defaults.detection_confidence, 0.25);
  assert.equal(defaults.minimum_axis_ratio, 0.7);
  assert.deepEqual(config.families.find(f => f.output === "boxes").channels, [1, 3]);
  assert.equal(config.families.find(f => f.id === "toxoplasma_plaque").score, 0);
  assert.equal(config.families.find(f => f.id === "toxoplasma_pv").score, -1);
});

for (const field of ["url", "accepted"]) test(`hosted ${field} cannot accidentally enable an unimplemented transport`, () => {
  const changed = clone(config); changed.hosted[field] = field === "url" ? "https://example.hf.space/" : true;
  assert.throws(() => modelCatalogue(changed, models), /adapter/);
  assert.throws(() => validateConfig({ ...browserConfig(), hosted: changed.hosted }), /adapter/);
});
for (const field of ["export_manifest", "accepted"]) test(`browser ${field} cannot claim acceptance without a verified runtime`, () => {
  const changed = clone(config); changed.browser[field] = field === "export_manifest" ? "/fake.json" : true;
  assert.throws(() => modelCatalogue(changed, models), /adapter/);
  assert.throws(() => validateConfig({ ...browserConfig(), browser: changed.browser }), /adapter/);
});

test("real rendered HTML supplies disabled upload/run/examples and all source-matched control names", () => {
  const html = renderMaskGenerator(config, models, statuses, tr);
  assert.match(html, /type="file"[^>]*disabled/);
  assert.match(html, /type="submit" disabled/);
  assert.match(html, /type="button" disabled/);
  for (const name of INFER_INPUTS.filter(name => name !== "model_key")) assert.match(html, new RegExp(`name="${name}"`));
  assert.match(html, /name="model_key"/);
  assert(!html.includes("live" + "_cell_v1"));
  assert.match(html, /boxes, not segmentation masks/);
  assert.match(html, /raw logits, not calibrated probabilities/);
  assert.equal((html.match(/data-family=/g) || []).length, 8);
  assert.equal((html.match(/data-model="/g) || []).length, 17);
  const browser = JSON.parse(html.match(/data-mask-config>(.*?)<\/script>/s)[1]);
  assert.equal(validateConfig(browser), browser);
});

test("family deep links select only real families and preserve malformed-link fallback", () => {
  for (const family of config.families) assert.equal(familyFromHash(`#mask-${family.id}`, config.families), family);
  for (const bad of ["#mask-generator", "#mask-unknown", "#mask-%", "#models"]) assert.equal(familyFromHash(bad, config.families), null);
});

test("all new strings enter the existing normal i18n reference unchanged", () => {
  for (const [key, value] of Object.entries(MASK_STRINGS)) assert.equal(english.get(key), value);
});
