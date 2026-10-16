// Renders the Mask generator tab: one sub-tab per model class, the model's
// score card, and the shared form. Processing runs in the visitor's browser
// (WebGPU/WASM with exported ONNX models, the default) or in Google Colab
// (the spaCR notebook for the model class, the real spaCR pipeline on
// Google's free GPU under the visitor's own Google account);
// src/assets/js/mask-generator.js does the work. The browser route is not
// announced as ready here: the client checks at run time.
import { INFER_INPUTS, colabUrl, validateColab } from "../src/assets/js/mask-generator.js";
export const MASK_STRINGS = {
  "mask.title": "Mask generator",
  "mask.intro3": "Drop in an image and get masks from a spaCR model: one page per model class. Run it entirely in your browser (WebGPU, nothing is uploaded), or open it in Google Colab, where the real spaCR pipeline runs on Google's free GPU under your own Google account. The download is a ZIP with the image, the mask, the flows, the cell probability, a per-object CSV and a README.",
  "mask.family": "Model class",
  "mask.version": "Model version",
  "mask.recommended": "Recommended input",
  "mask.input.toxoplasma_pv": "One fluorescence channel showing the parasite vacuoles (for example a parasite or vacuole marker), 20x to 60x, TIFF or PNG.",
  "mask.input.toxoplasma_plaque": "Bright-field or gel-documenter image of a plaque well or plate, grey or RGB, TIFF, PNG or JPEG.",
  "mask.input.toxoplasma_well_detector": "Photo or scan of a whole plate, grey or RGB, PNG, JPEG or TIFF; the model returns one box per well.",
  "mask.input.cell_from_hoechst": "One Hoechst (DNA) channel; the model outlines whole cells from it. 20x is the magnification it was trained at.",
  "mask.input.nuclei_from_cellmask": "One CellMask (membrane) channel; the model outlines nuclei from it. 20x is the magnification it was trained at.",
  "mask.input.toxoplasma_from_cellmask": "One CellMask (membrane) channel; the model outlines parasite vacuoles from it.",
  "mask.input.toxoplasma_from_hoechst": "One Hoechst (DNA) channel; the model outlines parasite vacuoles from it.",
  "mask.input.live_cell": "One transmitted-light channel (phase contrast, bright field or DIC).",
  "mask.route": "Where to run",
  "mask.browser": "In my browser (WebGPU, no upload)",
  "mask.colab": "Google Colab (free GPU, your Google account)",
  "mask.colab_open": "Open in Google Colab",
  "mask.colab_text": "Opens the spaCR notebook for this model class in Google Colab. It installs spaCR, takes your image or a held-out test image, runs the real spaCR pipeline on Google's free GPU (or, more slowly, on the CPU when no GPU is assigned) and offers the same ZIP for download. You need a Google account.",
  "mask.colab_hint": "No WebGPU here, or no in-browser model yet? Google Colab runs the real spaCR pipeline on a free GPU instead.",
  "mask.checking": "Checking the in-browser model…",
  "mask.browser_na2": "In-browser model not yet published for this model version. Use Google Colab for now.",
  "mask.browser_ready_gpu": "In-browser model available. Your browser supports WebGPU; the model (about 1.2 GB for segmentation models) is downloaded once and cached.",
  "mask.browser_ready_cpu": "In-browser model available, but this browser does not expose WebGPU, so it runs on the CPU and can take several minutes.",
  "mask.privacy3": "In my browser: the file never leaves your computer. Google Colab: the notebook runs in your own Colab session under your Google account; spaCR does not receive your file. Maximum file size 64 MB. For research use only.",
  "mask.drop": "Drop an image or PDF here, or choose a file",
  "mask.choose": "Choose a file",
  "mask.formats3": "TIFF and OME-TIFF (multi-channel), PNG, JPEG, BMP and PDF. CZI and ND2 open in the Google Colab notebook.",
  "mask.example2": "Random test image from Hugging Face",
  "mask.example_loading": "Loading a held-out test image from Hugging Face…",
  "mask.example_credit": "Test image: {name}, from {source}.",
  "mask.reading": "Reading the image…",
  "mask.image_info": "{width} × {height} pixels, {channels} channel(s), {dtype}.",
  "mask.server_only2": "The browser cannot read this format. Open it in the Google Colab notebook, where spaCR reads it.",
  "mask.too_large": "This file is larger than 64 MB.",
  "mask.bad_type": "This file type is not supported.",
  "mask.read_failed": "This image could not be read in the browser.",
  "mask.channels2": "Channels to use",
  "mask.channel_hint_one": "Choose one channel.",
  "mask.channel_hint_plaque": "Choose one channel, or up to three for colour.",
  "mask.channel_hint_detector": "Choose one grey channel or three colour channels.",
  "mask.channel_n": "Channel {n}",
  "mask.channel_numbers": "Channel numbers (zero-based, comma-separated)",
  "mask.preview": "Preview",
  "mask.settings": "Processing settings",
  "mask.series": "Image series / position (zero-based)",
  "mask.time": "Time frame (zero-based)",
  "mask.depth": "Z plane (zero-based)",
  "mask.page": "PDF page (zero-based)",
  "mask.dpi": "PDF rendering DPI",
  "mask.diameter": "Diameter in pixels (blank uses magnification)",
  "mask.plaque_diameter": "Resolved diameter in pixels",
  "mask.auto": "Auto diameter",
  "mask.native": "Use native scale explicitly",
  "mask.flow": "Flow threshold",
  "mask.cellprob": "Cell probability threshold",
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
  "mask.cancel": "Cancel",
  "mask.model_download": "Downloading the model ({done} of {total} MB)…",
  "mask.model_verify": "Checking the model file…",
  "mask.model_start": "Starting the model…",
  "mask.computing": "Running the model ({done} of {total} tiles)…",
  "mask.postprocess": "Building masks and packaging the ZIP…",
  "mask.done_objects": "Done: {count} objects.",
  "mask.done_wells": "Done: {count} wells.",
  "mask.download": "Download ZIP",
  "mask.output": "Download contents",
  "mask.labels": "Original upload, selected image, label TIFF, object measurements CSV, README and provenance. Flows and cell scores are included only when the model returns them; cell scores may be raw logits, not calibrated probabilities.",
  "mask.boxes": "Original upload, selected image, detection boxes and confidence scores, CSV, README and provenance. This detector returns boxes, not segmentation masks, flows or cell probabilities.",
  "mask.browser_note2": "The browser route runs the same model weights exported to ONNX with the same normalization, tiling and Cellpose mask dynamics; the shared-perimeter merge and additional JSON object filters run only in the spaCR desktop app.",
  "mask.card": "Model card and test data",
  "mask.snapshot": "Scores are copied from the published model snapshot, not recomputed here. Compare only the test sets described in each model card.",
  "mask.scores": "Scores and model card",
  "mask.viewer": "Image viewer",
  "mask.replace": "Choose another image",
  "mask.more": "More settings",
  "mask.running": "Running…",
  "mask.show": "Show",
  "mask.layer_image": "Image",
  "mask.layer_masks": "Masks",
  "mask.layer_outlines": "Outlines",
  "mask.layer_flows": "Flows",
  "mask.layer_cellprob": "Cell probability",
  "mask.layer_boxes": "Boxes",
  "mask.opacity": "Overlay opacity",
  "mask.results": "Results",
  "mask.stat_objects": "Objects",
  "mask.stat_wells": "Wells",
  "mask.stat_area": "Mean area (pixels)",
  "mask.stat_box_area": "Mean box area (pixels)",
  "mask.download_png": "Mask PNG",
  "mask.download_tiff": "Mask TIFF",
  "mask.download_csv": "Objects CSV",
  "mask.err_model": "The model could not be downloaded or verified. Check your connection and try again.",
  "mask.err_memory2": "The browser ran out of memory. Try a smaller image, or Google Colab.",
  "mask.err_diameter": "Enter the plaque diameter in pixels, or choose native scale.",
  "mask.err_json": "The additional desktop settings are not valid JSON.",
  "mask.err_desktop_only": "The shared-perimeter merge and additional JSON filters run only in the spaCR desktop app.",
  "mask.err_example": "The test image could not be loaded from Hugging Face. Try again.",
  "mask.err_generic": "Something went wrong while processing this image.",
  "mask.details": "Technical details"
};

// [name, label key, default, min, max, scope, placement]: "main" sits next to
// the viewer like Cellpose's controls; "more" goes under "More settings".
export const FIELDS = [
  ["chosen_diameter", "diameter", "", 0, null, "segmentation", "main"],
  ["flow_threshold", "flow", 0.4, 0, null, "segmentation", "main"],
  ["score_threshold", "cellprob", -1, null, null, "segmentation", "main"],
  ["detection_confidence", "confidence", 0.25, 0, 1, "detector", "main"],
  ["minimum_axis_ratio", "axis", 0.7, 0, 1, "detector", "main"],
  ["chosen_magnification", "magnification", 20, 0, null, "masks", "more"],
  ["detector_image_size", "detector_size", 640, 1, null, "detector", "more"],
  ["selected_series", "series", 0, 0, null, "file", "more"],
  ["selected_t", "time", 0, 0, null, "file", "more"],
  ["selected_z", "depth", 0, 0, null, "file", "more"],
  ["selected_page", "page", 0, 0, null, "pdf", "more"],
  ["selected_dpi", "dpi", 150, 1, 600, "pdf", "more"]
];
export const FILTERS = [
  ["background_value", "background", "", 0, null, "masks"],
  ["signal_value", "signal", "", 0, null, "masks"],
  ["lower_value", "lower", "", 0, 100, "masks"],
  ["perimeter_value", "perimeter", "", 0, 1, "masks"]
];
const COLAB_ICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
export const LAYERS = ["image", "masks", "outlines", "flows", "cellprob", "boxes"];
const esc = value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const safeJSON = value => JSON.stringify(value).replace(/</g, "\\u003c");
const HTTPS = /^https:\/\/(cdn\.jsdelivr\.net\/npm\/|huggingface\.co\/)/;

export function validateBuildConfig(config) {
  if (config.schema !== 3 || JSON.stringify(config.protocol) !== JSON.stringify(INFER_INPUTS)) throw new Error("Invalid mask protocol");
  const urls = [config.browser?.runtime, config.browser?.wasm_paths, config.readers?.geotiff, config.readers?.pdfjs, config.readers?.pdfjsWorker];
  if (urls.some(url => typeof url !== "string" || !HTTPS.test(url))) throw new Error("Mask generator libraries must come from pinned CDN URLs");
  for (const url of urls) if (url.includes("cdn.jsdelivr.net") && !/@\d+\.\d+\.\d+\//.test(url)) throw new Error("Mask generator libraries must pin an exact version");
  if ("hosted" in config) throw new Error("The hosted Space route was replaced by Google Colab");
  validateColab(config.colab);
  return config;
}

export function validateBrowserManifest(manifest) {
  if (!manifest || manifest.schema !== 1 || typeof manifest.models !== "object") throw new Error("Invalid browser model manifest");
  if (manifest.base_url !== null && !/^https:\/\/huggingface\.co\/[^?#]+\/$/.test(manifest.base_url)) throw new Error("Browser models must be served from Hugging Face");
  for (const [key, model] of Object.entries(manifest.models)) {
    if (!/^[a-z0-9_-]+$/.test(key) || !/^[A-Za-z0-9_.-]+\.onnx$/.test(model.file) || !/^[0-9a-f]{64}$/.test(model.sha256) || !(model.bytes > 0)) throw new Error(`Invalid browser model ${key}`);
  }
  return manifest;
}

export function validateExamples(examples, families) {
  const ids = new Set(families.map(family => family.id));
  for (const record of examples.records) {
    if (!ids.has(record.family) || record.split !== "test" || !/^[0-9a-f]{40}$/.test(record.revision) || !/^[0-9a-f]{64}$/.test(record.sha256)
      || !/^einarolafsson\/[A-Za-z0-9_.-]+$/.test(record.repo_id) || record.filename.includes("..") || !(record.bytes > 0)) throw new Error("Invalid approved example");
  }
  return examples;
}

export function modelCatalogue(config, snapshot, statuses = { defaults: {}, display: {} }) {
  validateBuildConfig(config);
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

export function renderMaskGenerator(config, snapshot, statuses, tr, extras = {}) {
  const families = modelCatalogue(config, snapshot, statuses);
  const manifest = validateBrowserManifest(extras.browserModels || { schema: 1, base_url: null, models: {} });
  const examples = validateExamples(extras.examples || { records: [] }, families);
  const t = key => esc(tr(`mask.${key}`));
  const title = family => esc(tr(`mc.short.${family.stem}`));
  const number = ([name, label, value, min, max, scope]) => `<label data-scope="${scope}"><span data-label="${name}">${t(label)}</span><input type="number" name="${name}" value="${value}" step="any" inputmode="decimal"${min === null ? "" : ` min="${min}"`}${max === null ? "" : ` max="${max}"`}></label>`;
  const option = state => `<option value="${state}">${t(state)}</option>`;
  const main = FIELDS.filter(field => field[6] === "main");
  const more = FIELDS.filter(field => field[6] === "more");
  const tabs = families.map((family, i) => `<a role="tab" id="mask-tab-${family.id}" href="#mask-${family.id}" aria-controls="mask-${family.id}" aria-selected="${i === 0}"${i ? ' tabindex="-1"' : ""}>${title(family)}</a>`).join("");
  const cards = families.map(family => `<section class="mask-family" id="mask-${family.id}" role="tabpanel" aria-labelledby="mask-tab-${family.id}" data-family="${family.id}">
    <div class="mask-family-head"><div><h3>${title(family)}</h3>
    <p class="note"><strong>${t("recommended")}:</strong> ${t(`input.${family.id}`)}</p></div>
    <div class="mask-family-actions"><a class="btn mask-colab-btn" href="${esc(colabUrl(config.colab, family.id))}" target="_blank" rel="noopener">${COLAB_ICON}<span>${t("colab_open")}</span></a>
    <label class="mask-version"><span>${t("version")}</span><select data-model-select="${family.id}">${family.versions.map(model => `<option value="${esc(model.key)}"${model.key === family.default ? " selected" : ""}>${esc(model.display)}${model.key === family.default ? ` · ${esc(tr("mc.default"))}` : ""}</option>`).join("")}</select></label></div></div>
    <details class="mask-card"><summary>${t("scores")}</summary>
    ${family.versions.map(model => `<article data-model="${esc(model.key)}"><h4>${esc(model.display)}</h4><table><caption>${esc(tr("mc.all_scores"))}</caption><tbody>${["f1_50", "precision", "recall", "aji", "dice", "map50", "map50_95"].flatMap(key => {
      const score = model.metrics?.[key]?.finetuned;
      return typeof score === "number" ? [`<tr><th scope="row">${esc(tr(`mc.metric.${key}`))}</th><td>${score.toFixed(3)}</td></tr>`] : [];
    }).join("")}</tbody></table><a href="${esc(model.repo_url)}">${t("card")}</a></article>`).join("")}
    <p class="note"><strong>${t("output")}:</strong> ${t(family.output === "boxes" ? "boxes" : "labels")}</p>
    <p class="note">${t("snapshot")}</p></details>
  </section>`).join("\n");
  const layers = LAYERS.map(layer => `<label class="mask-chip" data-layer-wrap="${layer}"><input type="checkbox" data-layer="${layer}"${["image", "masks", "outlines", "boxes"].includes(layer) ? " checked" : ""}> <span>${t(`layer_${layer}`)}</span></label>`).join("");
  const publicConfig = {
    ...config,
    families: families.map(({ versions, ...family }) => ({ ...family, versions: versions.map(model => model.key) })),
    browserModels: manifest,
    examples: examples.records,
    spacr_version: extras.spacrVersion ?? null,
    strings: Object.fromEntries(Object.keys(MASK_STRINGS).map(key => [key, tr(key)]))
  };
  return `<div class="mask-generator" data-mask-generator>
    <p class="lede">${t("intro3")}</p>
    <div class="mask-family-tabs" role="tablist" aria-label="${t("family")}">${tabs}</div>
    <div class="mask-models">${cards}</div>
    <form class="mask-app" data-mask-form novalidate>
      <input type="hidden" name="model_key" value="${esc(families[0].default)}">
      <div class="mask-stage">
        <div class="mask-drop" data-drop tabindex="0" role="group" aria-label="${t("viewer")}" aria-describedby="mask-formats">
          <div class="mask-drop-empty" data-drop-empty>
            <svg class="mask-drop-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>
            <p class="mask-drop-title">${t("drop")}</p>
            <div class="btns"><label class="btn primary"><span>${t("choose")}</span><input class="vh" type="file" name="path" accept=".tif,.tiff,.png,.jpg,.jpeg,.bmp,.pdf,.czi,.nd2"></label>
            <button class="btn" type="button" data-example>${t("example2")}</button></div>
            <p class="note" id="mask-formats">${t("formats3")}</p>
          </div>
          <canvas class="mask-canvas" data-view-canvas role="img" aria-label="${t("preview")}" hidden></canvas>
          <p class="mask-drop-msg" data-view-msg hidden></p>
          <div class="mask-busy" data-busy hidden><span class="mask-spinner" aria-hidden="true"></span></div>
        </div>
        <div class="mask-viewbar" data-viewbar hidden>
          <p class="note" data-file-status role="status" aria-live="polite"></p>
          <div class="btns"><button class="btn" type="button" data-replace>${t("replace")}</button><button class="btn" type="button" data-example>${t("example2")}</button></div>
        </div>
        <fieldset class="mask-layers" data-layers hidden><legend>${t("show")}</legend>
          <div class="mask-chips">${layers}</div>
          <label class="mask-opacity"><span>${t("opacity")}</span><input type="range" data-opacity min="0" max="100" value="50"></label>
        </fieldset>
        <section class="mask-results" data-result hidden aria-labelledby="mask-results-title">
          <h4 id="mask-results-title">${t("results")}</h4>
          <dl class="mask-stats"><div><dt data-stat-label="count">${t("stat_objects")}</dt><dd data-stat="count">–</dd></div><div><dt data-stat-label="area">${t("stat_area")}</dt><dd data-stat="area">–</dd></div></dl>
          <div class="btns"><a class="btn primary" data-download download>${t("download")}</a><a class="btn" data-download-png download hidden>${t("download_png")}</a><a class="btn" data-download-tiff download hidden>${t("download_tiff")}</a><a class="btn" data-download-csv download hidden>${t("download_csv")}</a></div>
          <p class="note" data-output-note></p>
        </section>
      </div>
      <div class="mask-controls">
        <fieldset class="mask-route"><legend>${t("route")}</legend><div class="mask-seg"><label><input type="radio" name="route" value="browser" checked> <span>${t("browser")}</span></label><label><input type="radio" name="route" value="colab"> <span>${t("colab")}</span></label></div></fieldset>
        <p class="note mask-status" data-route-status role="status" aria-live="polite">${t("checking")}</p>
        <div class="mask-colab" data-colab hidden><p class="note">${t("colab_text")}</p><a class="btn primary" data-colab-link href="${esc(colabUrl(config.colab, families[0].id))}" target="_blank" rel="noopener">${COLAB_ICON}<span>${t("colab_open")}</span></a></div>
        <p class="note" data-colab-hint hidden>${t("colab_hint")}</p>
        <div class="mask-browser-run" data-browser-run>
        <fieldset data-channels hidden><legend>${t("channels2")}</legend><p class="note" data-channel-hint></p><div class="mask-chips" data-channel-list></div>
          <label data-channel-numbers hidden>${t("channel_numbers")}<input type="text" name="chosen_channels" inputmode="numeric" value="0"></label></fieldset>
        <div class="mask-fields">${number(main[0])}
          <label class="mask-check" data-scope="segmentation"><input type="checkbox" name="native_scale"> <span data-label="native_scale">${t("auto")}</span></label>${main.slice(1).map(number).join("")}</div>
        <div class="mask-run"><button class="btn primary" type="submit" disabled data-run><span class="mask-spinner" data-run-spinner aria-hidden="true" hidden></span><span data-run-label>${t("run")}</span></button><button class="btn" type="button" data-cancel hidden>${t("cancel")}</button></div>
        <progress data-progress hidden></progress>
        <p class="note mask-status" data-run-status role="status" aria-live="polite"></p>
        <div class="mask-error" data-error role="alert" hidden><p data-error-text></p><details data-error-more hidden><summary>${t("details")}</summary><code data-error-detail></code></details></div>
        <details class="mask-more"><summary>${t("more")}</summary>
          <div class="mask-fields">${more.map(number).join("")}</div>
          <div data-scope="masks"><h4>${t("advanced")}</h4><p class="note">${t("defaults")}</p><div class="mask-fields">${FILTERS.map(number).join("")}
          <label>${t("remove_background")}<select name="background_switch">${["default", "enabled", "disabled"].map(option).join("")}</select></label>
          <label>${t("border")}<select name="border_switch">${["default", "enabled", "disabled"].map(option).join("")}</select></label></div>
          <label>${t("extra")}<textarea name="advanced" rows="2">{}</textarea></label></div>
        </details>
        </div>
        <p class="note">${t("privacy3")}</p>
        <p class="note" data-browser-note>${t("browser_note2")}</p>
      </div>
    </form>
    <script type="application/json" data-mask-config>${safeJSON(publicConfig)}</script>
  </div>`;
}
