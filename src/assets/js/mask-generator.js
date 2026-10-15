// Capability/configuration UI only. This client intentionally has no upload,
// model download or inference transport until an accepted adapter is supplied.
export const INFER_INPUTS = Object.freeze([
  "path", "model_key", "accepted", "selected_series", "selected_t", "selected_z", "chosen_channels",
  "selected_page", "selected_dpi", "chosen_diameter", "native_scale", "flow_threshold", "score_threshold",
  "chosen_magnification", "advanced", "detection_confidence", "minimum_axis_ratio", "background_value",
  "signal_value", "lower_value", "background_switch", "perimeter_value", "border_switch", "detector_image_size"
]);

export function validateConfig(config) {
  if (config.schema !== 1 || JSON.stringify(config.protocol) !== JSON.stringify(INFER_INPUTS)) throw new Error("Unsupported inference protocol");
  if (config.hosted?.accepted !== false || config.hosted.url !== null || config.browser?.accepted !== false || config.browser.export_manifest !== null) throw new Error("No accepted execution adapter");
  if (!Array.isArray(config.families) || !config.families.length) throw new Error("Missing model families");
  const ids = new Set();
  for (const family of config.families) {
    if (!/^[a-z_]+$/.test(family.id) || ids.has(family.id) || !family.versions.includes(family.default)) throw new Error("Invalid family/default");
    ids.add(family.id);
  }
  return config;
}

export function familyFromHash(hash, families) {
  let id;
  try { id = decodeURIComponent(hash.replace(/^#mask-/, "")); } catch { return null; }
  return families.find(family => family.id === id) || null;
}

export function initMaskGenerator(root, environment = globalThis) {
  const config = validateConfig(JSON.parse(root.querySelector("[data-mask-config]").textContent));
  const form = root.querySelector("[data-mask-form]");
  const cards = [...root.querySelectorAll("[data-family]")];
  const selections = [...root.querySelectorAll("[data-model-select]")];
  const defaults = [...form.querySelectorAll("input[name], select[name], textarea[name]")].map(element => [element, element.type === "checkbox" ? element.defaultChecked : element.value]);
  const text = key => config.strings[`mask.${key}`];
  let current = config.families[0];

  function routeChanged() {
    const hosted = form.elements.route.value === "hosted";
    root.querySelector("[data-route-status]").textContent = text(hosted ? "hosted_unavailable" : "browser_unavailable");
    const capability = root.querySelector("[data-browser-status]");
    capability.hidden = hosted;
    capability.textContent = text(environment.isSecureContext && environment.navigator?.gpu ? "gpu_present" : "gpu_absent");
    root.querySelector("[data-hosted-privacy]").hidden = !hosted;
    root.querySelector("[data-hosted-consent]").hidden = !hosted;
    form.elements.accepted.checked = false;
    form.elements.path.value = "";
    // Consent is necessary for a future hosted upload; it is not an endpoint,
    // model-export, header-validation or adapter acceptance override.
    form.elements.path.disabled = true;
    root.querySelector("[data-run]").disabled = true;
  }

  function showModel() {
    const selector = root.querySelector(`[data-model-select="${current.id}"]`);
    const value = current.versions.includes(selector.value) ? selector.value : current.default;
    selector.value = value;
    for (const article of root.querySelectorAll("[data-model]")) article.hidden = article.dataset.model !== value;
    form.elements.model_key.value = value;
    form.elements.accepted.checked = false;
    form.elements.path.value = "";
  }

  function selectFamily(family) {
    if (current.id !== family.id) {
      for (const [element, value] of defaults) {
        if (["route", "path", "model_key"].includes(element.name)) continue;
        if (element.type === "checkbox") element.checked = value;
        else element.value = value;
      }
    }
    current = family;
    for (const card of cards) card.hidden = card.dataset.family !== family.id;
    for (const link of root.querySelectorAll(".mask-family-links a")) {
      if (link.hash === `#mask-${family.id}`) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    const detector = family.output === "boxes";
    const plaque = family.id === "toxoplasma_plaque";
    for (const element of form.querySelectorAll("[data-scope]")) {
      const scope = element.dataset.scope;
      element.hidden = scope === "detector" ? !detector : scope === "segmentation" ? detector : scope === "masks" ? (detector || plaque) : false;
    }
    form.elements.score_threshold.value = String(family.score);
    root.querySelector('[data-label="chosen_diameter"]').textContent = text(plaque ? "plaque_diameter" : "diameter");
    root.querySelector('[data-label="native_scale"]').textContent = text(plaque ? "native" : "auto");
    root.querySelector("[data-run]").textContent = text(detector ? "detect" : "run");
    showModel();
  }

  const onLocation = () => selectFamily(familyFromHash(environment.location.hash, config.families) || current);
  selections.forEach(select => select.addEventListener("change", showModel));
  form.querySelectorAll('[name="route"]').forEach(radio => radio.addEventListener("change", routeChanged));
  form.elements.accepted.addEventListener("change", () => { form.elements.path.disabled = true; });
  form.addEventListener("submit", event => { event.preventDefault(); routeChanged(); });
  root.addEventListener("drop", event => event.preventDefault());
  root.addEventListener("dragover", event => event.preventDefault());
  root.querySelectorAll(".mask-family-links a").forEach(link => link.addEventListener("click", () => {
    const family = familyFromHash(link.hash, config.families);
    if (family) selectFamily(family);
  }));
  environment.addEventListener("hashchange", onLocation);
  environment.addEventListener("popstate", onLocation);
  selectFamily(familyFromHash(environment.location.hash, config.families) || current);
  routeChanged();
}

if (typeof document !== "undefined") {
  document.querySelectorAll("[data-mask-generator]").forEach(root => initMaskGenerator(root));
}
