// Localisation for pages that have an i18n/ folder next to their index.html.
//
// The English page is the template. Every translatable element carries a key:
//   data-i18n="id"             the element's inner HTML
//   data-i18n-<attr>="id"      one attribute, e.g. data-i18n-alt, data-i18n-aria-label
// Strings that tools/build.mjs generates from code or data (installer labels,
// model showcase, paper list, script labels) are listed by generatedStrings().
//
// i18n/<lang>.json maps id -> text. Content values are HTML fragments and
// must keep the English tags (same attributes) and {{PLACEHOLDERS}}; any key
// that does not is reported by tools/check_i18n.mjs and falls back to English
// in the build. Keys that start with "_" are metadata, e.g. "_status".
// i18n/en.json is the generated reference (node tools/check_i18n.mjs --write-en).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const LANGUAGES = {
  en: { tag: "en", name: "English" },
  de: { tag: "de", name: "Deutsch" },
  es: { tag: "es", name: "Español" },
  fr: { tag: "fr", name: "Français" },
  hi: { tag: "hi", name: "हिन्दी" },
  is: { tag: "is", name: "Íslenska" },
  ko: { tag: "ko", name: "한국어" },
  pt: { tag: "pt", name: "Português" },
  sv: { tag: "sv", name: "Svenska" },
  zh_CN: { tag: "zh-CN", name: "简体中文" }
};

const ATTR_RE = /\sdata-i18n(?:-([a-z-]+))?="([^"]+)"/g;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function unesc(s) {
  return String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
export function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

function closeOf(html, tag, from) {
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, "gi");
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (!depth) return { start: m.index, end: re.lastIndex };
  }
  throw new Error(`no closing </${tag}> after offset ${from}`);
}

// Every keyed element in html: { id, attr (null for content), start, end, value }.
// start/end delimit the inner HTML (content) or the attribute value.
export function scan(html) {
  const out = [];
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(html))) {
    const [, attr, id] = m;
    const open = html.lastIndexOf("<", m.index);
    const openEnd = html.indexOf(">", m.index) + 1;
    const tag = html.slice(open + 1).match(/^[a-zA-Z0-9-]+/)[0].toLowerCase();
    if (!attr) {
      if (VOID.has(tag)) throw new Error(`data-i18n="${id}" on a void <${tag}>`);
      const close = closeOf(html, tag, openEnd);
      out.push({ id, attr: null, start: openEnd, end: close.start, value: html.slice(openEnd, close.start) });
    } else {
      const tagText = html.slice(open, openEnd);
      const a = tagText.match(new RegExp(`\\s${attr}="([^"]*)"`));
      if (!a) throw new Error(`data-i18n-${attr}="${id}" but the element has no ${attr} attribute`);
      const start = open + a.index + a[0].indexOf('"') + 1;
      out.push({ id, attr, start, end: start + a[1].length, value: a[1] });
    }
  }
  for (const e of out) {
    if (!e.attr && out.some((o) => o !== e && o.start >= e.start && o.end <= e.end)) {
      throw new Error(`data-i18n="${e.id}" contains another keyed element; key the parts separately`);
    }
  }
  return out;
}

// English strings of a template (after partials are inserted): ordered [id, text].
export function extract(html) {
  const seen = new Map();
  for (const e of scan(html)) {
    const text = e.attr ? unesc(e.value) : norm(e.value);
    if (seen.has(e.id) && seen.get(e.id) !== text) throw new Error(`key ${e.id} is used for two different texts`);
    seen.set(e.id, text);
  }
  return [...seen];
}

// Tags with their attributes, and {{PLACEHOLDERS}}, as a sorted list.
export function signature(text) {
  const tags = (String(text).match(/<[^>]*>/g) || []).map((t) => t.replace(/\s+/g, " "));
  const ph = String(text).match(/\{\{[A-Z_]+\}\}|\{[a-z]+\}/g) || [];
  return [...tags, ...ph].sort();
}
export function sameSignature(a, b) {
  const x = signature(a), y = signature(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

// Replaces keyed content and attributes with translations; English where
// a key is missing or its markup or placeholders differ from the English.
export function apply(html, dict, english, warn = () => {}) {
  const items = scan(html).sort((a, b) => b.start - a.start);
  let out = html;
  for (const e of items) {
    const v = dict[e.id];
    if (typeof v !== "string" || !v.trim()) continue;
    const en = english.get(e.id);
    if (en !== undefined && !sameSignature(v, en)) { warn(`${e.id}: markup or placeholders differ from English; English used`); continue; }
    if (e.attr && /<[^>]*>/.test(v)) { warn(`${e.id}: attribute text must not contain tags; English used`); continue; }
    out = out.slice(0, e.start) + (e.attr ? esc(v) : v) + out.slice(e.end);
  }
  return out;
}

// Plain-text lookup for generated strings, with the same English fallback.
export function translator(dict, english, warn = () => {}) {
  return (id) => {
    const en = english.get(id);
    if (en === undefined) throw new Error(`unknown i18n key ${id}`);
    const v = dict && dict[id];
    if (typeof v !== "string" || !v.trim()) return en;
    if (/<[^>]*>/.test(v) || !sameSignature(v, en)) { warn(`${id}: markup or placeholders differ from English; English used`); return en; }
    return v;
  };
}

export function strip(html) { return html.replace(ATTR_RE, ""); }

export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function h4(s) { return createHash("sha256").update(String(s)).digest("hex").slice(0, 6); }
// Keys of strings that come from data files end in a hash of the English, so
// a changed source drops its old translation instead of showing it stale.
export function dataKey(prefix, text) { return `${prefix}.${h4(text)}`; }

export const FIXED = {
  "site.language": "Language",
  "ui.theme_dark": "Switch to dark theme",
  "ui.theme_light": "Switch to light theme",
  "ui.fx_pause": "Pause background animation",
  "ui.fx_resume": "Resume background animation",
  "ui.fx_reduced": "Background animation is off: your system asks for reduced motion",
  "ui.pause": "Pause",
  "ui.resume": "Resume",
  "ui.copied": "Copied",
  "install.download": "Download",
  "install.os.windows": "Windows 10 and 11",
  "install.os.macos": "macOS 11 or later, Intel and Apple silicon",
  "install.os.linux": "Linux x86-64",
  "models.objects": "Objects",
  "models.divider": "Divider: left of it the input image, right of it the detected objects",
  "models.show": "Show {name} outlines",
  "papers.rel.spacr-paper": "The spaCR paper",
  "papers.rel.uses": "Uses spaCR",
  "papers.preprint_tag": "preprint",
  "papers.preprint": "Preprint: {value}",
  "papers.image": "Image: {value}",
  "mc.version": "Version",
  "mc.base": "Base model",
  "mc.test": "Held-out test set",
  "mc.status": "Status",
  "mc.finetuned": "This model",
  "mc.vanilla": "Stock Cellpose-SAM",
  "mc.baseline": "Baseline",
  "mc.difference": "Difference",
  "mc.not_recorded": "not recorded",
  "mc.card": "Model card",
  "mc.default": "default",
  "mc.alternative": "alternative",
  "mc.candidate": "candidate",
  "mc.superseded": "earlier version",
  "mc.alpha": "alpha",
  "mc.metric.f1_50": "F1 at IoU 0.5",
  "mc.metric.f1_75": "F1 at IoU 0.75",
  "mc.metric.ap": "Average precision",
  "mc.metric.precision": "Precision",
  "mc.metric.recall": "Recall",
  "mc.metric.aji": "AJI",
  "mc.metric.dice": "Dice",
  "mc.metric.map50": "mAP at IoU 0.5",
  "mc.metric.map50_95": "mAP at IoU 0.5 to 0.95",
  "mc.metric.median_count_error_pct": "Median count error",
  "mc.metric.plates_within_5pct": "Plates within 5%",
  "mc.metric.plates_within_10pct": "Plates within 10%",
  "mc.default_from": "Default in spaCR ({value})",
  "mc.newer": "Also published, not the default: {value}",
  "mc.previous": "Previous versions: {value}",
  "mc.read.title": "How to read these scores",
  "mc.read.precision_recall": "Precision is the share of objects the model reported that match a reference object; low precision means false detections. Recall is the share of reference objects the model found; low recall means missed objects.",
  "mc.read.f1": "F1 is the harmonic mean of precision and recall, so it is high only when both are. Either alone can look near-perfect: a model that reports one obvious object has high precision, and one that reports every dark blob has high recall.",
  "mc.read.iou": "IoU (intersection over union) is the overlap between a predicted and a reference object divided by the area the two cover together. F1 at IoU 0.5 counts an object as found when that ratio reaches 0.5.",
  "mc.read.iou75": "F1 at IoU 0.75 counts an object only when the ratio reaches 0.75, so the outline has to fit more closely.",
  "mc.read.ap": "Average precision at one IoU threshold is true positives divided by true positives, false positives and false negatives together. mAP averages it over several thresholds, so it also rewards outlines that fit closely.",
  "mc.read.aji": "AJI (aggregated Jaccard index) adds up the overlap of every matched pair and divides it by their combined area plus the area of unmatched objects, so merged, split and missed objects all lower it.",
  "mc.read.dice": "Dice is twice the overlap divided by the predicted area plus the reference area.",
  "mc.read.map": "mAP at IoU 0.5 is the mean average precision of the predicted boxes when a box counts as correct at an IoU (overlap divided by the area the two boxes cover together) of 0.5 or more. mAP at IoU 0.5 to 0.95 averages it over ten thresholds, so loosely placed boxes score lower.",
  "mc.read.boxes": "Precision is the share of predicted boxes that match a reference box; low precision means false boxes. Recall is the share of reference boxes the model found; low recall means missed wells.",
  "mc.read.count": "Median count error is the median difference between the predicted and the reference count per plate, as a percentage of the reference. Plates within 5% or 10% is the share of plates whose count error stays inside that limit.",
  "mc.read.baseline": "The grey bar is the baseline named in the column header, scored on the same test images: stock Cellpose-SAM without fine-tuning, or an earlier model where no stock model has the class.",
  "mc.read.cv": "Cross-validated scores split the data into folds, hold out each fold once and report the mean over folds with its standard deviation (SD). A single split can mislead; the SD shows how far the score moves from one split to another.",
  "mc.read.heldout": "The held-out test set is images kept out of training and used only for scoring."
};

export const UI_KEYS = Object.keys(FIXED).filter((k) => k.startsWith("ui."));

export function showcaseKeys(sc) {
  const out = [];
  const add = (k, v) => { if (v && !out.some(([x]) => x === k)) out.push([k, v]); };
  add(dataKey("models.note", sc.spacr_version), sc.spacr_version);
  for (const f of sc.figures) {
    add(dataKey(`showcase.${f.id}.title`, f.title), f.title);
    add(dataKey(`showcase.${f.id}.text`, f.text), f.text);
    add(dataKey(`showcase.${f.id}.alt`, f.alt), f.alt);
    add(`showcase.label.${slug(f.input_label)}`, f.input_label);
    for (const c of f.classes) {
      add(`showcase.class.${slug(c.name)}`, c.name);
      if (c.model.note) add(dataKey("showcase.note", c.model.note), c.model.note);
    }
    for (const [k, v] of f.facts) {
      add(`showcase.fact.${slug(k)}`, k);
      add(dataKey("showcase.value", v), v);
    }
  }
  return out;
}

// One card per task: the newest model that is not an alternative or a
// candidate. Newer alternatives/candidates and older versions are listed
// in one line each. statusOf(m) gives the model's status.
// Versions of one model share a key stem (key without its _vN suffix).
export function selectModels(g, statusOf) {
  const fam = new Map();
  for (const m of g.models || []) {
    const stem = String(m.key).replace(/[_-]v\d+$/, "");
    if (!fam.has(stem)) fam.set(stem, []);
    fam.get(stem).push(m);
  }
  return [...fam.values()].map((ms) => {
    let i = ms.length - 1;
    while (i > 0 && ["alternative", "candidate"].includes(statusOf(ms[i]))) i--;
    return { shown: ms[i], newer: ms.slice(i + 1), older: ms.slice(0, i) };
  });
}

// Strings that come from data/models.json (group titles, motivations, notes, labels).
export function modelKeys(mj) {
  const out = [];
  const add = (k, v) => { if (v && !out.some(([x]) => x === k)) out.push([k, v]); };
  for (const g of mj.groups || []) {
    add(dataKey(`mc.group.${g.id}.title`, g.title), g.title);
    add(dataKey(`mc.group.${g.id}.motivation`, g.motivation), g.motivation);
    for (const m of selectModels(g, (x) => x.status || "").map((f) => f.shown)) {
      if (m.note) add(dataKey("mc.note", m.note), m.note);
      if (m.test && m.test.source) add(dataKey("mc.testsrc", m.test.source), m.test.source);
      if (m.test && m.test.size) add(dataKey("mc.testsize", m.test.size), m.test.size);
      if (m.baseline_label) add(dataKey("mc.baselabel", m.baseline_label), m.baseline_label);
      if (m.ap_label) add(dataKey("mc.aplabel", m.ap_label), m.ap_label);
      if (m.by_source) {
        add(dataKey("mc.bstitle", m.by_source.title), m.by_source.title);
        if (m.by_source.note) add(dataKey("mc.bsnote", m.by_source.note), m.by_source.note);
        for (const c of m.by_source.columns) add(dataKey("mc.bscol", c), c);
      }
    }
  }
  return out;
}

// withShowcase: only pages that render the model showcase carry its strings.
export function generatedStrings(dataDir, withShowcase = true) {
  if (!withShowcase) return Object.entries(FIXED);
  const sc = JSON.parse(fs.readFileSync(path.join(dataDir, "showcase.json"), "utf8"));
  let mk = [];
  const mp = path.join(dataDir, "models.json");
  if (fs.existsSync(mp)) mk = modelKeys(JSON.parse(fs.readFileSync(mp, "utf8")));
  return [...Object.entries(FIXED), ...showcaseKeys(sc), ...mk];
}

// English reference for a page: template keys, then generated keys.
export function englishFor(templateWithPartials, dataDir) {
  const en = new Map(extract(templateWithPartials));
  for (const [k, v] of generatedStrings(dataDir, templateWithPartials.includes("{{SHOWCASE_HTML}}"))) {
    if (en.has(k) && en.get(k) !== v) throw new Error(`key ${k} is both in the template and generated`);
    en.set(k, v);
  }
  return en;
}

// Text of i18n/en.json, the reference that translators work from.
export function referenceJSON(english) {
  const ref = { _note: "Generated by node tools/check_i18n.mjs --write-en from the English page; do not edit. Translate into <lang>.json with the same keys.", ...Object.fromEntries(english) };
  return JSON.stringify(ref, null, 2) + "\n";
}

// Languages with an i18n/<lang>.json next to a page. Unreadable files are skipped.
export function loadLanguages(dir, warn = () => {}) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const code = f.replace(/\.json$/, "");
    if (!f.endsWith(".json") || code === "en") continue;
    if (!LANGUAGES[code]) { warn(`i18n/${f}: unknown language code; skipped`); continue; }
    let dict;
    try { dict = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch (e) { warn(`i18n/${f}: ${e.message}; skipped`); continue; }
    if (!dict || typeof dict !== "object" || Array.isArray(dict)) { warn(`i18n/${f}: not an object; skipped`); continue; }
    out.push({ code, ...LANGUAGES[code], dict, status: typeof dict._status === "string" ? dict._status : "" });
  }
  return out;
}

export function readPartials(partialsDir, html) {
  const part = (n) => fs.readFileSync(path.join(partialsDir, n), "utf8");
  return html.replace("{{HEAD}}", part("head.html")).replace("{{HEADER}}", part("header.html")).replace("{{FOOTER}}", part("footer.html")).replace("{{ABOUT}}", part("about.html"));
}
