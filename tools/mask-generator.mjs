// The website uses only its public model aliases. This renderer never imports
// the service registry, resolves checkpoints, or starts an inference request.
import { INFER_INPUTS } from "../src/assets/js/mask-generator.js";
export const MASK_STRINGS = {
  "mask.title": "Mask generator",
  "mask.intro": "Choose a model and inspect its settings. Processing is unavailable until a hosted service or a verified browser model is connected.",
  "mask.family": "Model class",
  "mask.version": "Model version",
  "mask.route": "Processing location",
  "mask.hosted": "Hugging Face Space (hosted GPU)",
  "mask.browser": "In my browser (WebGPU)",
  "mask.hosted_unavailable": "Hosted processing is unavailable: no accepted service is configured. No image will be uploaded.",
  "mask.browser_unavailable": "Browser processing is unavailable: no verified model export is configured. Files will not be sent to a server.",
  "mask.gpu_present": "This browser exposes WebGPU. Model compatibility and GPU availability have not been verified.",
  "mask.gpu_absent": "WebGPU is not exposed in this browser or page context.",
  "mask.connection": "Service connection",
  "mask.no_connection": "Not configured",
  "mask.consent": "I agree to upload this image for processing and understand that the ZIP includes the original file.",
  "mask.privacy": "Hosted processing sends the selected file to the configured service. Its source currently limits uploads to 64 MB and configures cache cleanup after one hour, checked every five minutes. These are source settings, not a verified retention guarantee for a deployed service.",
  "mask.file": "Image or PDF",
  "mask.formats": "TIFF, OME-TIFF, PNG, JPEG, BMP and PDF; CZI and ND2 require the service's compatible readers. Series, time, Z, page and channel selections are zero-based and require header validation before processing.",
  "mask.settings": "Processing settings",
  "mask.series": "Image series / position (zero-based)",
  "mask.time": "Time frame (zero-based)",
  "mask.depth": "Z plane (zero-based)",
  "mask.channels": "Input channels (zero-based, comma-separated)",
  "mask.page": "PDF page (zero-based)",
  "mask.dpi": "PDF rendering DPI",
  "mask.diameter": "Diameter in pixels (blank uses magnification)",
  "mask.plaque_diameter": "Resolved diameter in pixels",
  "mask.auto": "Auto diameter",
  "mask.native": "Use native scale explicitly",
  "mask.flow": "Flow threshold",
  "mask.score": "Cell-score threshold (logits)",
  "mask.magnification": "Magnification",
  "mask.confidence": "Detection confidence",
  "mask.axis": "Minimum well axis ratio",
  "mask.detector_size": "Detector image size (pixels)",
  "mask.advanced": "Normalization and object filters",
  "mask.defaults": "Blank numeric fields and Desktop default keep the model's desktop settings. Intensity values use original image units.",
  "mask.background": "Background floor",
  "mask.signal": "Signal-to-noise anchor",
  "mask.lower": "Lower intensity percentile",
  "mask.remove_background": "Remove background",
  "mask.perimeter": "Shared-perimeter merge fraction",
  "mask.border": "Remove objects touching image borders",
  "mask.extra": "Additional desktop object-filter settings (JSON)",
  "mask.default": "Desktop default",
  "mask.enabled": "Enabled",
  "mask.disabled": "Disabled",
  "mask.run": "Generate masks",
  "mask.detect": "Detect wells",
  "mask.example": "Random approved test image",
  "mask.example_unavailable": "No approved example connection is configured for this page.",
  "mask.output": "Download contents",
  "mask.labels": "Original upload, selected image, label TIFF, object measurements CSV, README and provenance. Flows and cell scores are included only when the model returns them; cell scores may be raw logits, not calibrated probabilities.",
  "mask.boxes": "Original upload, selected image, detection boxes and confidence scores, CSV, README and provenance. This detector returns boxes, not segmentation masks, flows or cell probabilities.",
  "mask.card": "Model card and test data",
  "mask.snapshot": "Scores are copied from the published model snapshot, not recomputed here. Compare only the test sets described in each model card.",
  "mask.research": "For research use. No inference or upload occurs on this page while processing is unavailable."
};

export const FIELDS = [
  ["selected_series", "series", 0, 0, null, "all"],
  ["selected_t", "time", 0, 0, null, "all"],
  ["selected_z", "depth", 0, 0, null, "all"],
  ["selected_page", "page", 0, 0, null, "all"],
  ["selected_dpi", "dpi", 150, 1, 600, "all"],
  ["chosen_diameter", "diameter", "", 0, null, "segmentation"],
  ["flow_threshold", "flow", 0.4, 0, null, "segmentation"],
  ["score_threshold", "score", -1, null, null, "segmentation"],
  ["chosen_magnification", "magnification", 20, 0, null, "masks"],
  ["detection_confidence", "confidence", 0.25, 0, 1, "detector"],
  ["minimum_axis_ratio", "axis", 0.7, 0, 1, "detector"],
  ["detector_image_size", "detector_size", 640, 1, null, "detector"]
];
export const FILTERS = [
  ["background_value", "background", "", 0, null, "masks"],
  ["signal_value", "signal", "", 0, null, "masks"],
  ["lower_value", "lower", "", 0, 100, "masks"],
  ["perimeter_value", "perimeter", "", 0, 1, "masks"]
];
const esc = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeJSON = value => JSON.stringify(value).replace(/</g, "\\u003c");

export function modelCatalogue(config, snapshot, statuses = { defaults: {}, display: {} }) {
  if (config.schema !== 1 || JSON.stringify(config.protocol) !== JSON.stringify(INFER_INPUTS)) throw new Error("Invalid mask protocol");
  // No execution transport is implemented by this static client. Refuse an
  // accidental configuration change that could falsely advertise readiness.
  if (config.hosted.url !== null || config.hosted.accepted !== false || config.browser.export_manifest !== null || config.browser.accepted !== false) throw new Error("Execution requires an accepted client adapter");
  const models = snapshot.groups.flatMap(group => group.models);
  const seen = new Set();
  return config.families.map(family => {
    if (!/^[a-z_]+$/.test(family.id) || seen.has(family.id)) throw new Error("Invalid or duplicate family");
    seen.add(family.id);
    const versions = models.filter(model => model.key.replace(/[_-]v\d+$/, "") === family.stem);
    if (!versions.length || versions.some(model => !/^https:\/\/huggingface\.co\//.test(model.repo_url))) throw new Error("Missing public model cards");
    const currentKeys = Object.keys(statuses.defaults).filter(key => key.replace(/_v\d+$/, "") === family.stem.replace(/-/g, "_"));
    if (currentKeys.some(key => !versions.some(model => model.key.replace(/-/g, "_") === key))) throw new Error("Current default is absent from the public snapshot");
    const current = versions.filter(model => statuses.defaults[model.key.replace(/-/g, "_")]);
    if (current.length > 1) throw new Error("Ambiguous model default");
    const defaultKey = current.length ? current[0].key : family.default;
    if (!versions.some(model => model.key === defaultKey)) throw new Error("Unavailable model default");
    return { ...family, default: defaultKey, versions };
  });
}

export function renderMaskGenerator(config, snapshot, statuses, tr) {
  const families = modelCatalogue(config, snapshot, statuses);
  const t = key => esc(tr(`mask.${key}`));
  const title = family => esc(tr(`mc.short.${family.stem}`));
  const number = ([name, label, value, min, max, scope]) => `<label data-scope="${scope}"><span data-label="${name}">${t(label)}</span><input type="number" name="${name}" value="${value}" step="any"${min === null ? "" : ` min="${min}"`}${max === null ? "" : ` max="${max}"`}></label>`;
  const option = state => `<option value="${state}">${t(state)}</option>`;
  const cards = families.map(family => `<section class="mask-family" id="mask-${family.id}" data-family="${family.id}">
    <h3>${title(family)}</h3>
    <label>${t("version")}<select data-model-select="${family.id}">${family.versions.map(model => `<option value="${esc(model.key)}"${model.key === family.default ? " selected" : ""}>${esc(model.display)}${model.key === family.default ? ` · ${esc(tr("mc.default"))}` : ""}</option>`).join("")}</select></label>
    ${family.versions.map(model => `<article data-model="${esc(model.key)}"><h4>${esc(model.display)}</h4><table><caption>${esc(tr("mc.all_scores"))}</caption><tbody>${["f1_50", "precision", "recall", "aji", "dice", "map50", "map50_95"].flatMap(key => {
      const score = model.metrics?.[key]?.finetuned;
      return typeof score === "number" ? [`<tr><th scope="row">${esc(tr(`mc.metric.${key}`))}</th><td>${score.toFixed(3)}</td></tr>`] : [];
    }).join("")}</tbody></table><a href="${esc(model.repo_url)}">${t("card")}</a></article>`).join("")}
    <p><strong>${t("output")}</strong> ${t(family.output === "boxes" ? "boxes" : "labels")}</p>
  </section>`).join("\n");
  const publicConfig = { ...config, families: families.map(({ versions, ...family }) => ({ ...family, versions: versions.map(model => model.key) })), strings: Object.fromEntries(Object.keys(MASK_STRINGS).map(key => [key, tr(key)])) };
  return `<div class="mask-generator" data-mask-generator>
    <p class="lede">${t("intro")}</p>
    <nav class="mask-family-links" aria-label="${t("family")}">${families.map(family => `<a href="#mask-${family.id}">${title(family)}</a>`).join(" · ")}</nav>
    <div class="mask-layout"><div class="mask-models">${cards}<p class="note">${t("snapshot")}</p></div>
    <form class="mask-settings" data-mask-form>
      <input type="hidden" name="model_key" value="${esc(families[0].default)}">
      <fieldset><legend>${t("route")}</legend><label><input type="radio" name="route" value="hosted" checked> ${t("hosted")}</label><label><input type="radio" name="route" value="browser"> ${t("browser")}</label></fieldset>
      <p class="note" data-route-status role="status">${t("hosted_unavailable")}</p><p class="note" data-browser-status hidden></p>
      <label>${t("connection")}<input type="text" readonly value="${t("no_connection")}" aria-disabled="true"></label>
      <p class="note" data-hosted-privacy>${t("privacy")}</p>
      <label data-hosted-consent><input type="checkbox" name="accepted"> ${t("consent")}</label>
      <label>${t("file")}<input type="file" name="path" accept=".tif,.tiff,.png,.jpg,.jpeg,.bmp,.pdf,.czi,.nd2" disabled></label>
      <p class="note">${t("formats")}</p>
      <fieldset><legend>${t("settings")}</legend><div class="mask-fields">${FIELDS.map(number).join("")}
      <label>${t("channels")}<input type="text" name="chosen_channels" inputmode="numeric" value="" placeholder="0"></label>
      <label data-scope="segmentation"><span data-label="native_scale">${t("auto")}</span><input type="checkbox" name="native_scale"></label></div></fieldset>
      <details data-scope="masks"><summary>${t("advanced")}</summary><p class="note">${t("defaults")}</p><div class="mask-fields">${FILTERS.map(number).join("")}
      <label>${t("remove_background")}<select name="background_switch">${["default", "enabled", "disabled"].map(option).join("")}</select></label>
      <label>${t("border")}<select name="border_switch">${["default", "enabled", "disabled"].map(option).join("")}</select></label>
      <label>${t("extra")}<textarea name="advanced" rows="2">{}</textarea></label></div></details>
      <div class="btns"><button class="btn primary" type="submit" disabled data-run>${t("run")}</button><button class="btn" type="button" disabled>${t("example")}</button></div>
      <p class="note">${t("example_unavailable")}</p><p class="note">${t("research")}</p>
    </form></div>
    <script type="application/json" data-mask-config>${safeJSON(publicConfig)}</script>
  </div>`;
}
