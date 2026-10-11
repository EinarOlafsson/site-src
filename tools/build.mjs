// Builds the public site into dist/.
//
//   SITE_PASSWORD=... node tools/build.mjs
//
// 1. Copies src/ (public pages and assets) to dist/.
// 2. Fills spaCR facts at build time so they never go stale: version and
//    Python range from PyPI, installers from the latest GitHub release,
//    authors and concept DOI from CITATION.cff on spaCR's main branch, and
//    the latest version DOI from Zenodo.
// 3. Renders the model showcase from data/showcase.json and the paper list
//    from data/papers.json. Only papers in that hand-checked list are shown;
//    new citing works found on OpenAlex and Semantic Scholar are only logged.
// 4. Renders protected/ pages and encrypts each one with StatiCrypt (AES-256,
//    PBKDF2) using SITE_PASSWORD. Large assets of a protected page are not
//    inlined: each is sealed with AES-256-GCM under a key derived from
//    SITE_PASSWORD and the file's content, and that key is written only into
//    the encrypted page, which fetches and decrypts the file after unlock.
//    Nothing from protected/ is ever written to dist/ in plaintext.
// 5. Fails the build if any distinctive word from a protected page appears
//    anywhere in dist/.
// 6. Pages with an i18n/ folder (see tools/i18n.mjs) are also built once per
//    i18n/<lang>.json at <page>/<lang>/index.html, from the same template.
import { createCipheriv, createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apply as applyI18n, selectModels, dataKey, englishFor, esc as escI18n, loadLanguages, readPartials, referenceJSON, sameSignature, slug, strip as stripI18n, translator, UI_KEYS } from "./i18n.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const PROTECTED = path.join(ROOT, "protected");
const DIST = path.join(ROOT, process.env.SITE_DIST || "dist");
const PARTIALS = path.join(SRC, "_partials");
const DATA = path.join(ROOT, "data");
const OFFLINE = process.env.SITE_OFFLINE_META;
const SITE_URL = "https://einarolafsson.github.io";

const PASSWORD = process.env.SITE_PASSWORD || "";
if (PASSWORD.length < 16) {
  console.error("SITE_PASSWORD is missing or shorter than 16 characters; refusing to build protected pages.");
  process.exit(2);
}

function log(...a) { console.log("[build]", ...a); }
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function getJSON(url, headers = {}) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(url, { headers: { "User-Agent": "einarolafsson-site-build", Accept: "application/json", ...headers } });
    if (r.ok) return r.json();
    if (r.status < 500 || attempt >= 3) throw new Error(`${url}: HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 3000 * attempt));
  }
}
async function getText(url) {
  const r = await fetch(url, { headers: { "User-Agent": "einarolafsson-site-build" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.text();
}

function parseCff(text) {
  const unq = (v) => v.trim().replace(/^["']|["']$/g, "");
  const top = (key) => {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
    return m ? unq(m[1]) : "";
  };
  const authorsBlock = (text.split(/^authors:\s*$/m)[1] || "").split(/^\S/m)[0];
  const authors = [];
  for (const item of authorsBlock.split(/^\s*-\s+/m).slice(1)) {
    const fam = item.match(/family-names:\s*(.+)/);
    const giv = item.match(/given-names:\s*(.+)/);
    if (fam) authors.push({ family: unq(fam[1]), given: giv ? unq(giv[1]) : "" });
  }
  let conceptDoi = "";
  const idBlock = (text.split(/^identifiers:\s*$/m)[1] || "").split(/^\S/m)[0];
  for (const item of idBlock.split(/^\s*-\s+/m).slice(1)) {
    const v = item.match(/value:\s*(.+)/);
    const d = item.match(/description:\s*(.+)/);
    if (v && d && /concept doi/i.test(d[1])) conceptDoi = unq(v[1]);
  }
  return { title: top("title"), version: top("version"), doi: top("doi"), authors, conceptDoi };
}

function initials(given) {
  return given.split(/[\s]+/).filter(Boolean).map((g) => g.split("-").map((p) => p[0].toUpperCase()).join("")).join("");
}

function fmtSize(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1e3)) + " kB";
}

async function spacrMeta() {
  if (OFFLINE) return JSON.parse(fs.readFileSync(OFFLINE, "utf8"));
  const gh = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const pypi = await getJSON("https://pypi.org/pypi/spacr/json");
  const rel = await getJSON("https://api.github.com/repos/EinarOlafsson/spacr/releases/latest", gh);
  const cff = parseCff(await getText("https://raw.githubusercontent.com/EinarOlafsson/spacr/main/CITATION.cff"));
  let zen = null;
  const concept = cff.conceptDoi || "10.5281/zenodo.21343316";
  try {
    const recid = concept.split("zenodo.")[1];
    const z = await getJSON(`https://zenodo.org/api/records/${recid}/versions/latest`);
    zen = { doi: z.doi, version: (z.metadata && z.metadata.version) || "" };
  } catch (e) {
    log("Zenodo lookup failed, falling back to CITATION.cff:", e.message);
  }
  return {
    version: pypi.info.version,
    requiresPython: pypi.info.requires_python || "",
    pypiUrl: "https://pypi.org/project/spacr/" + pypi.info.version + "/",
    releaseTag: rel.tag_name,
    releaseUrl: rel.html_url,
    releaseDate: (rel.published_at || "").slice(0, 10),
    assets: rel.assets.map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
    cff,
    conceptDoi: concept,
    versionDoi: zen ? zen.doi : cff.doi,
    versionDoiVersion: zen ? zen.version.replace(/^v/, "") : cff.version
  };
}

// Starplast facts from PyPI at build time: version, release date and Python range.
async function starplastMeta() {
  const j = await getJSON("https://pypi.org/pypi/starplast/json");
  const v = j.info.version;
  const files = (j.releases && j.releases[v]) || [];
  const released = files.length ? String(files[0].upload_time_iso_8601 || files[0].upload_time || "").slice(0, 10) : "";
  return { version: v, requiresPython: j.info.requires_python || "", released, pypiUrl: `https://pypi.org/project/starplast/${v}/` };
}

function starplastVars(sp) {
  const py = sp.requiresPython.match(/>=\s*([\d.]+)/);
  return {
    STARPLAST_VERSION: esc(sp.version),
    STARPLAST_RELEASED: esc(sp.released || "see PyPI"),
    STARPLAST_PYTHON: esc(py && !/</.test(sp.requiresPython) ? `${py[1]} or newer` : pythonRange(sp.requiresPython)),
    STARPLAST_REQUIRES: esc(sp.requiresPython),
    STARPLAST_PYPI_URL: esc(sp.pypiUrl)
  };
}

function pythonRange(spec) {
  const lo = (spec.match(/>=\s*([\d.]+)/) || [])[1];
  const hi = (spec.match(/<\s*([\d.]+)/) || [])[1];
  if (lo && hi) {
    const [maj, min] = hi.split(".").map(Number);
    return `${lo}–${maj}.${min - 1}`;
  }
  return spec || "see PyPI";
}

function spacrVars(m, tr) {
  const installers = [
    [/Windows.*\.exe$/i, tr("install.os.windows"), "windows"],
    [/macOS.*\.pkg$/i, tr("install.os.macos"), "macos"],
    [/Linux.*\.run$/i, tr("install.os.linux"), "linux"]
  ];
  const links = [];
  for (const [re, label, os] of installers) {
    const a = m.assets.find((x) => re.test(x.name));
    if (a) links.push([
      `            <li class="os">`,
      `              <img src="/assets/img/os/${os}.webp" width="64" height="75" alt="" loading="lazy" decoding="async">`,
      `              <span class="os-name">${esc(label)}</span>`,
      `              <span class="os-file">${esc(a.name)}</span>`,
      `              <a class="btn" href="${esc(a.url)}">${esc(tr("install.download"))} <span class="sz">${fmtSize(a.size)}</span></a>`,
      `            </li>`].join("\n"));
  }
  if (!links.length) throw new Error("no installers found in the latest release");
  const sha = m.assets.find((x) => /SHA256SUMS/i.test(x.name));
  const authors = m.cff.authors;
  const year = (m.releaseDate || new Date().toISOString()).slice(0, 4);
  const cite = authors.map((a) => `${a.family} ${initials(a.given)}`).join(", ") +
    `. ${m.cff.title} (version ${m.versionDoiVersion}). Zenodo; ${year}. doi:${m.versionDoi}`;
  const key = `olafsson_spacr_${year}`;
  const bib = [
    `@software{${key},`,
    `  author    = {${authors.map((a) => `${a.family}, ${a.given}`).join(" and ")}},`,
    `  title     = {{${m.cff.title}}},`,
    `  version   = {${m.versionDoiVersion}},`,
    `  year      = {${year}},`,
    `  publisher = {Zenodo},`,
    `  doi       = {${m.versionDoi}},`,
    `  url       = {https://doi.org/${m.versionDoi}}`,
    `}`
  ].join("\n");
  return {
    SPACR_VERSION: esc(m.version),
    PYTHON_RANGE: esc(pythonRange(m.requiresPython)),
    REQUIRES_PYTHON: esc(m.requiresPython),
    PYPI_URL: esc(m.pypiUrl),
    RELEASE_TAG: esc(m.releaseTag),
    RELEASE_URL: esc(m.releaseUrl),
    RELEASE_DATE: esc(m.releaseDate),
    INSTALLER_LINKS: links.join("\n"),
    SHA_URL: esc(sha ? sha.url : m.releaseUrl),
    CONCEPT_DOI: esc(m.conceptDoi),
    VERSION_DOI: esc(m.versionDoi),
    VERSION_DOI_VERSION: esc(m.versionDoiVersion),
    CITATION_TEXT: esc(cite),
    BIBTEX: esc(bib)
  };
}

function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

function showcaseVars(tr) {
  const sc = readJSON(path.join(DATA, "showcase.json"));
  const figs = sc.figures.map((f) => {
    const id = f.id;
    const layers = f.classes.map((c, i) =>
      `            <img id="${id}-l${i}" src="/assets/img/models/${esc(c.layer)}" width="${f.width}" height="${f.height}" alt="" loading="lazy" decoding="async">`).join("\n");
    const rows = f.classes.map((c, i) => [
      `          <li><label>`,
      `            <input type="checkbox" checked data-layer="${id}-l${i}" aria-label="${esc(tr("models.show").replace("{name}", tr(`showcase.class.${slug(c.name)}`)))}">`,
      `            <span class="cls"><span class="swatch" style="background:${esc(c.color)}" aria-hidden="true"></span>${esc(tr(`showcase.class.${slug(c.name)}`))}</span>`,
      `            <span class="count">${Number(c.count).toLocaleString("en-US")}</span>`,
      `            <span class="src">${c.model.url ? `<a href="${esc(c.model.url)}">${esc(c.model.display)}</a>` : esc(c.model.display)}${c.model.note ? ". " + esc(tr(dataKey("showcase.note", c.model.note))) : ""}</span>`,
      `          </label></li>`].join("\n")).join("\n");
    const dl = f.facts.map(([k, v, href]) =>
      {
      const tv = tr(dataKey("showcase.value", v));
      return `          <dt>${esc(tr(`showcase.fact.${slug(k)}`))}</dt><dd>${href ? `<a href="${esc(href)}">${esc(tv)}</a>` : esc(tv)}</dd>`;
    }).join("\n");
    return [
      `        <figure class="model-fig" aria-labelledby="${id}-h">`,
      `          <div class="viewer" style="aspect-ratio:${f.width}/${f.height}">`,
      `            <img class="base" src="/assets/img/models/${esc(f.base)}" width="${f.width}" height="${f.height}" alt="${esc(tr(dataKey(`showcase.${id}.alt`, f.alt)))}" loading="lazy" decoding="async">`,
      `            <div class="layers">`,
      layers,
      `            </div>`,
      `            <span class="lbl l">${esc(tr(`showcase.label.${slug(f.input_label)}`))}</span><span class="lbl r">${esc(tr("models.objects"))}</span>`,
      `            <input type="range" min="0" max="100" value="50" aria-label="${esc(tr("models.divider"))}">`,
      `            <span class="handle" aria-hidden="true"></span>`,
      `          </div>`,
      `          <figcaption>`,
      `          <h3 id="${id}-h">${esc(tr(dataKey(`showcase.${id}.title`, f.title)))}</h3>`,
      f.text ? `          <p class="small">${esc(tr(dataKey(`showcase.${id}.text`, f.text)))}</p>` : "",
      `          <ul class="classes">`,
      rows,
      `          </ul>`,
      `          <dl>`,
      dl,
      `          </dl>`,
      `          </figcaption>`,
      `        </figure>`].filter(Boolean).join("\n");
  });
  return { SHOWCASE_HTML: figs.join("\n"), SHOWCASE_SPACR: esc(tr(dataKey("models.note", sc.spacr_version))) };
}

// Model status at build time: spaCR's DEFAULT_* constants and the "(default)",
// "(alternative)" or "(candidate)" marker of each zoo display name on nightly.
async function zooStatus() {
  const out = { defaults: {}, display: {} };
  if (OFFLINE && !process.env.SITE_ZOO_ONLINE) return out;
  // The contents API reads the branch head; raw.githubusercontent.com can serve a copy up to minutes old.
  const gh = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
  const raw = async (f) => {
    try {
      const r = await fetch(`https://api.github.com/repos/EinarOlafsson/spacr/contents/spacr/${f}?ref=nightly`, { headers: { "User-Agent": "einarolafsson-site-build", Accept: "application/vnd.github.raw", ...gh } });
      if (r.ok) return await r.text();
      log("zoo:", f, `contents API HTTP ${r.status}, using raw.githubusercontent.com`);
    } catch (e) { log("zoo:", f, e.message); }
    return getText(`https://raw.githubusercontent.com/EinarOlafsson/spacr/nightly/spacr/${f}`).catch((e) => { log("zoo:", f, e.message); return ""; });
  };
  const [sub, zoo] = await Promise.all([raw("submodules.py"), raw("model_zoo.py")]);
  for (const m of sub.matchAll(/^(DEFAULT_[A-Z_]*MODEL)\s*=\s*['"]([^'"]+)['"]/gm)) out.defaults[m[2]] = m[1];
  const re = /["']key["']\s*:\s*["']([^"']+)["'][\s\S]*?["']display_name["']\s*:\s*["']([^"']+)["']/g;
  for (const m of zoo.matchAll(re)) if (!(m[1] in out.display)) out.display[m[1]] = m[2];
  log(`zoo: ${Object.keys(out.display).length} display names, defaults ${JSON.stringify(out.defaults)}`);
  return out;
}

function fmt3(v) { return typeof v === "number" ? v.toFixed(3) : ""; }

function modelsVars(tr, zs) {
  const p = path.join(DATA, "models.json");
  if (!fs.existsSync(p)) return { MODELS_HTML: "" };
  const mj = readJSON(p);
  const T = (prefix, text) => { try { return esc(tr(dataKey(prefix, text))); } catch (e) { return esc(text); } };
  const metricOrder = ["f1_50", "f1_75", "ap", "precision", "recall", "aji", "dice", "map50", "map50_95", "median_count_error_pct", "plates_within_5pct", "plates_within_10pct"];
  const groups = (mj.groups || []).map((g) => {
    const statusOf = (m) => {
      const zkey = String(m.key).replace(/-/g, "_");
      if (zs.defaults[zkey]) return "default";
      const mk = ((zs.display[zkey] || "").match(/\b(default|alternative|candidate)\b/i) || [])[1];
      return mk ? mk.toLowerCase() : (m.status || "");
    };
    const fams = selectModels(g, statusOf);
    const linkList = (ms) => ms.map((m) => `<a href="${esc(m.repo_url)}">${esc(m.version || m.key)}</a>${["alternative", "candidate"].includes(statusOf(m)) ? ` (${esc(tr("mc." + statusOf(m)))})` : ""}`).join(", ");
    const extra = fams.map((sel) => [
      sel.newer.length ? `          <p class="mc-more">${esc(tr("mc.newer")).replace("{value}", linkList(sel.newer))}</p>` : "",
      sel.older.length ? `          <p class="mc-more">${esc(tr("mc.previous")).replace("{value}", linkList(sel.older))}</p>` : ""].filter(Boolean).join("\n")).filter(Boolean).join("\n");
    const cards = fams.map((f) => f.shown).filter(Boolean).map((m) => {
      const zkey = String(m.key).replace(/-/g, "_");
      const def = zs.defaults[zkey];
      const disp = zs.display[zkey] || "";
      const marker = (disp.match(/\b(default|alternative|candidate)\b/i) || [])[1];
      let status = def ? "default" : marker ? marker.toLowerCase() : (m.status || "");
      if (!["default", "alternative", "candidate", "superseded", "alpha"].includes(status)) status = "";
      const badge = status ? `<span class="mc-badge ${status}"${def ? ` title="${esc(tr("mc.default_from").replace("{value}", def))}"` : ""}>${esc(tr("mc." + status))}</span>` : "";
      const rows = [];
      for (const k of metricOrder) {
        const v = m.metrics && m.metrics[k];
        if (v === undefined) continue;
        const ft = v && typeof v === "object" ? v.finetuned : v;
        const va = v && typeof v === "object" ? v.vanilla : null;
        if ((ft === null || ft === undefined) && (va === null || va === undefined)) continue;
        const pct = /pct$/.test(k);
        const bar = (x, cls) => typeof x === "number" ? `<span class="mc-bar ${cls}" style="--v:${Math.max(0, Math.min(1, pct ? x / 100 : x)).toFixed(3)}"></span><span class="mc-num">${pct ? x.toFixed(1) + "%" : fmt3(x)}</span>` : `<span class="mc-nr">${esc(tr("mc.not_recorded"))}</span>`;
        const label = k === "ap" && m.ap_label ? T("mc.aplabel", m.ap_label) : esc(tr("mc.metric." + k));
        rows.push(`<tr><th scope="row">${label}</th><td>${bar(ft, "ft")}</td><td>${typeof va === "number" ? bar(va, "va") : '<span class="mc-nr">–</span>'}</td></tr>`);
      }
      const baseLabel = m.baseline_label ? T("mc.baselabel", m.baseline_label) : esc(tr("mc.vanilla"));
      const table = rows.length ? `<table class="mc-table"><thead><tr><td></td><th scope="col"><span class="mc-key ft"></span>${esc(tr("mc.finetuned"))}</th><th scope="col"><span class="mc-key va"></span>${baseLabel}</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : `<p class="mc-nr">${esc(tr("mc.not_recorded"))}</p>`;
      const test = m.test ? [m.test.size ? T("mc.testsize", m.test.size) : "", m.test.source ? T("mc.testsrc", m.test.source) : ""].filter(Boolean).join(" · ") : "";
      return [
        `          <article class="mc">`,
        `            <header><h4>${esc(m.display)}</h4>${badge}</header>`,
        `            <dl class="mc-facts"><div><dt>${esc(tr("mc.version"))}</dt><dd>${esc(m.version || "")}</dd></div><div><dt>${esc(tr("mc.base"))}</dt><dd>${esc(m.base || "")}</dd></div><div class="wide"><dt>${esc(tr("mc.test"))}</dt><dd>${test || esc(tr("mc.not_recorded"))}</dd></div></dl>`,
        `            ${table}`,
        m.by_source ? [
          `            <div class="mc-src"><table class="mc-srctable"><caption>${T("mc.bstitle", m.by_source.title)}</caption>`,
          `<thead><tr><td></td>${m.by_source.columns.map((c) => `<th scope="col">${T("mc.bscol", c)}</th>`).join("")}</tr></thead>`,
          `<tbody>${m.by_source.rows.map(([n, vals]) => `<tr><th scope="row">${esc(n)}</th>${vals.map((v) => `<td>${fmt3(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
          m.by_source.note ? `            <p class="mc-note">${T("mc.bsnote", m.by_source.note)}</p>` : ""].join("\n") : "",
        m.note ? `            <p class="mc-note">${T("mc.note", m.note)}</p>` : "",
        m.repo_url ? `            <p class="mc-link"><a href="${esc(m.repo_url)}">${esc(tr("mc.card"))}</a></p>` : "",
        `          </article>`].filter(Boolean).join("\n");
    });
    return [
      `        <div class="mc-group${fams.length > 1 ? " wide" : ""}" role="group" aria-labelledby="mc-${esc(g.id)}">`,
      `          <h3 id="mc-${esc(g.id)}">${T(`mc.group.${g.id}.title`, g.title)}</h3>`,
      `          <p class="note mc-why">${T(`mc.group.${g.id}.motivation`, g.motivation)}</p>`,
      `          <div class="${fams.length > 1 ? "mc-grid" : "mc-one"}">`,
      cards.join("\n"),
      extra,
      `          </div>`,
      `        </div>`].join("\n");
  });
  return { MODELS_HTML: groups.join("\n") };
}

function shorten(q, n = 260) {
  const t = String(q).split(" [...] ")[0];
  return t.length <= n ? t : t.slice(0, t.lastIndexOf(" ", n)) + " …";
}

function papersVars(tr) {
  if (readJSON(path.join(DATA, "papers.json")).papers.some((p) => !["spacr-paper", "uses"].includes(p.relation))) {
    throw new Error("papers.json lists a paper that does not use spaCR; cite-only papers belong in papers_rejected.json");
  }
  const pj = readJSON(path.join(DATA, "papers.json"));
  const order = { "spacr-paper": 0, uses: 1, cites: 2 };
  const papers = [...pj.papers].sort((a, b) => (order[a.relation] - order[b.relation]) || (b.year - a.year) || a.title.localeCompare(b.title));
  let thumbs = [];
  try { thumbs = readJSON(path.join(DATA, "paper_thumbs.json")); } catch (e) { /* badges only */ }
  const thumbFor = (doi) => thumbs.find((t) => t.doi === doi && t.file && t.reusable);
  const items = papers.map((p) => {
    const t = thumbFor(p.doi);
    const venue = String(p.venue).split(" ")[0] === "Cell" ? "Cell Reports" : String(p.venue).replace(/\s+\d.*$/, "");
    const visual = t
      ? `          <img src="/assets/img/papers/${esc(t.file)}" width="480" height="320" alt="${esc(t.kind === "illustration" ? t.figure.title : t.figure.number + ": " + t.figure.title)}" loading="lazy" decoding="async">`
      : `          <div class="badge" aria-hidden="true"><span>${esc(venue)}</span><b>${esc(p.year)}</b></div>`;
    return [
      `        <li class="paper">`,
      `          <a class="title-wrap row" href="https://doi.org/${esc(p.doi)}">`,
      visual,
      `          <span class="title">${esc(p.title)}</span>`,
      `          </a>`,
      `          <span class="cite">${esc(p.authors_short)} ${esc(venue)}, ${esc(p.year)}${p.type === "preprint" ? ", " + esc(tr("papers.preprint_tag")) : ""}. <span class="rel">${esc(tr("papers.rel." + p.relation))}</span>${p.preprint ? `. ${esc(tr("papers.preprint")).replace("{value}", `<a href="https://doi.org/${esc(p.preprint.doi)}">${esc(p.preprint.venue)} ${esc(p.preprint.year)}</a>`)}` : ""}</span>`,
      p.relation === "uses" && p.evidence && p.evidence[0] ? `          <blockquote class="evidence"><q>${esc(shorten(p.evidence[0].quote, 200))}</q><span class="where">${esc(p.evidence[0].location.split(" (")[0].split(". ")[0])}</span></blockquote>` : "",
      t ? `          <span class="credit">${esc(tr("papers.image")).replace("{value}", esc(t.attribution))}</span>` : "",
      `        </li>`].filter(Boolean).join("\n");
  });
  return { PAPERS_HTML: `        <ul class="papers">\n${items.join("\n")}\n        </ul>`, PAPERS_CHECKED: esc(pj.checked) };
}

async function refreshPaperCandidates() {
  if (OFFLINE) return;
  const pj = readJSON(path.join(DATA, "papers.json"));
  let rejected = [];
  try { rejected = readJSON(path.join(DATA, "papers_rejected.json")); } catch (e) { /* none yet */ }
  const known = new Set([...pj.papers, ...(pj.also_known || []), ...rejected].map((p) => String(p.doi || "").toLowerCase()).filter(Boolean));
  const found = new Map();
  const add = (doi, title, via) => {
    if (!doi) return;
    const d = doi.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
    if (!known.has(d) && !found.has(d)) found.set(d, `${title || "(no title)"} [${via}]`);
  };
  for (const w of pj.spacr_works || []) {
    if (w.openalex) {
      try {
        const r = await getJSON(`https://api.openalex.org/works?filter=cites:${w.openalex}&per-page=200&select=doi,title`);
        for (const x of r.results || []) add(x.doi, x.title, "OpenAlex cites " + w.openalex);
      } catch (e) { log("OpenAlex lookup failed:", e.message); }
    }
    if (w.doi) {
      try {
        const r = await getJSON(`https://api.semanticscholar.org/graph/v1/paper/DOI:${w.doi}/citations?fields=title,externalIds&limit=500`);
        for (const x of r.data || []) add(x.citingPaper && x.citingPaper.externalIds && x.citingPaper.externalIds.DOI, x.citingPaper && x.citingPaper.title, "Semantic Scholar " + w.doi);
      } catch (e) { log(`Semantic Scholar: ${w.doi} ${/HTTP 404/.test(e.message) ? "is not indexed" : "lookup failed: " + e.message}`); }
    }
  }
  try {
    const q = encodeURIComponent('"github.com/EinarOlafsson/spacr" OR "github.com/EinarOlafsson/spaCR" OR "10.5281/zenodo.21343316" OR "rs-7368254"');
    const r = await getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${q}&format=json&pageSize=200&resultType=lite`);
    for (const x of (r.resultList && r.resultList.result) || []) add(x.doi, x.title, "Europe PMC full text");
  } catch (e) { log("Europe PMC lookup failed:", e.message); }
  if (!found.size) { log("papers: no new citing works outside the checked list"); return; }
  const lines = [...found].map(([d, t]) => `- ${d}: ${t}`);
  log(`papers: ${found.size} new candidate(s) need checking before they are listed:\n  ` + lines.join("\n  "));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### Papers to check\n\nNot shown on the site until added to data/papers.json.\n\n" + lines.join("\n") + "\n");
  }
}

function sealAssets(html, baseDir, name) {
  const sealed = [];
  const out = html.replace(/\{\{SEALED:([^}]+)\}\}/g, (_, rel) => {
    const p = path.join(baseDir, rel);
    const body = fs.readFileSync(p);
    const sum = createHash("sha256").update(body).digest();
    const key = createHmac("sha256", PASSWORD).update("sealed-asset-key\\0" + name + "\\0").update(sum).digest();
    const iv = createHmac("sha256", PASSWORD).update("sealed-asset-iv\\0" + name + "\\0").update(sum).digest().subarray(0, 12);
    const c = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([c.update(body), c.final(), c.getAuthTag()]);
    const file = createHash("sha256").update(enc).digest("hex").slice(0, 16) + ".bin";
    sealed.push({ file, enc });
    const mime = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".glb": "model/gltf-binary" }[path.extname(p)] || "application/octet-stream";
    return `/projects/${name}/${file}#${key.toString("hex")}.${iv.toString("hex")}.${mime}`;
  });
  return { html: out, sealed };
}

async function statsVars(papersCount) {
  const out = { models: "16", languages: "10", lessons: "84", tests: "83,739" };
  const tryText = async (url) => { try { return await getText(url); } catch (e) { log("stats:", url, e.message); return ""; } };
  if (!OFFLINE) {
    const zoo = await tryText("https://raw.githubusercontent.com/EinarOlafsson/spacr/main/spacr/model_zoo.py");
    const block = (zoo.split(/^BUNDLED_REMOTE_MODELS[^\n]*=\s*\(\s*$/m)[1] || "").split(/^\)\s*$/m)[0];
    const n = (block.match(/["']key["']\s*:\s*["']/g) || []).length;
    if (n) out.models = String(n);
    const i18n = await tryText("https://raw.githubusercontent.com/EinarOlafsson/spacr/main/spacr/qt/i18n.py");
    const langs = ((i18n.split(/^LANGUAGES = \(/m)[1] || "").split(/^\)/m)[0].match(/Language\(/g) || []).length;
    if (langs) out.languages = String(langs);
    const portal = await tryText("https://einarolafsson.github.io/spacr/tutorials/");
    const les = portal.match(/of (\d+) complete/);
    if (les) out.lessons = les[1];
    const tc = await tryText("https://raw.githubusercontent.com/EinarOlafsson/spacr/nightly/docs/source/_static/test-counts.json");
    try { const j = JSON.parse(tc); if (j.total) out.tests = Number(j.total).toLocaleString("en-US"); } catch (e) { /* keep default */ }
  }
  log(`stats: ${out.models} models, ${out.languages} languages, ${out.lessons} lessons, ${out.tests} tests, ${papersCount} papers`);
  return { STAT_MODELS: out.models, STAT_LANGUAGES: out.languages, STAT_LESSONS: out.lessons, STAT_TESTS: out.tests, STAT_PAPERS: String(papersCount) };
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

function copyPublic() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f);
    if (rel.startsWith("_partials") || rel.split(path.sep).includes("i18n")) continue;
    const dst = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f, dst);
  }
}

function assetVersion() {
  const h = createHash("sha256");
  for (const f of ["assets/css/site.css", "assets/js/fx.js", "assets/js/volcano.js", "assets/data/volcano.json", "assets/fonts/open-sans-300.woff2", "assets/fonts/open-sans-400.woff2", "assets/fonts/open-sans-italic-300.woff2", "assets/fonts/open-sans-italic-400.woff2"]) h.update(fs.readFileSync(path.join(SRC, f)));
  const fxDir = path.join(SRC, "assets", "js", "fx");
  if (fs.existsSync(fxDir)) for (const f of fs.readdirSync(fxDir).sort()) h.update(f).update(fs.readFileSync(path.join(fxDir, f)));
  return h.digest("hex").slice(0, 10);
}

// lang: null for the English template, or { lang, english, home, warn } for a translation.
function render(html, page, vars, lang = null) {
  let out = readPartials(PARTIALS, html);
  if (lang) {
    out = applyI18n(out, lang.lang.dict, lang.english, lang.warn)
      .replace(/<html lang="en">/, `<html lang="${lang.lang.tag}">`)
      .replace(/href="\/projects\/([a-z-]+)\/"/g, (m, p) => (`/projects/${p}/` === lang.home ? `href="${lang.home}${lang.lang.tag}/"` : m));
  }
  if (page) out = out.replace(`data-nav="${page}"`, `data-nav="${page}" aria-current="page"`);
  if (/\sid="about"/.test(out)) out = out.replace(/href="\/#about"/g, 'href="#about"');
  if (page === "spacr") out = out.replace(/href="\/projects\/spacr\/#/g, 'href="#');
  out = out.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`unfilled placeholder ${m}`);
    return vars[k];
  });
  return stripI18n(out);
}

const NO_LANG = { LANG_HEAD: "", LANG_MENU: "", LANG_FOOT: "" };

// Head links, header menu and footer note for one language version of a page.
function langVars(home, langs, current, tr) {
  const all = [{ code: "en", tag: "en", name: "English", status: "" }, ...langs];
  const url = (l) => (l.code === "en" ? home : `${home}${l.tag}/`);
  const head = all.map((l) => `<link rel="alternate" hreflang="${l.tag}" href="${SITE_URL}${url(l)}">`);
  head.push(`<link rel="alternate" hreflang="x-default" href="${SITE_URL}${home}">`);
  if (current.status) head.push(`<meta name="robots" content="noindex">`);
  if (current.code !== "en") {
    const ui = Object.fromEntries(UI_KEYS.map((k) => [k, tr(k)]));
    head.push(`<script type="application/json" id="i18n-ui">${JSON.stringify(ui).replace(/</g, "\\u003c")}</script>`);
  }
  const label = escI18n(tr("site.language"));
  const items = all.map((l) => `          <li><a href="${url(l)}" hreflang="${l.tag}" lang="${l.tag}" data-lang="${l.code}"${l.code === current.code ? ' aria-current="true"' : ""}>${escI18n(l.name)}</a></li>`);
  const menu = [
    `      <details class="lang" data-lang-menu>`,
    `        <summary title="${label}"><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="8" cy="8" r="6.4"/><path d="M1.6 8h12.8M8 1.6c1.8 1.9 2.6 4 2.6 6.4S9.8 12.5 8 14.4M8 1.6C6.2 3.5 5.4 5.6 5.4 8s.8 4.5 2.6 6.4"/></svg><span class="vh">${label}: </span><span class="lang-cur">${escI18n(current.name)}</span></summary>`,
    `        <ul aria-label="${label}">`,
    ...items,
    `        </ul>`,
    `      </details>`].join("\n");
  const foot = current.status ? `<p class="i18n-status" lang="en">${escI18n(current.name)}: ${escI18n(current.status)}</p>` : "";
  return { LANG_HEAD: head.join("\n"), LANG_MENU: menu, LANG_FOOT: foot };
}

function inlineAssets(html, baseDir) {
  const mime = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
  return html
    .replace(/\{\{INLINE:([^}]+)\}\}/g, (_, rel) => {
      const p = path.join(baseDir, rel);
      return `data:${mime[path.extname(p)] || "application/octet-stream"};base64,${fs.readFileSync(p).toString("base64")}`;
    })
    .replace(/\{\{INLINE_B64:([^}]+)\}\}/g, (_, rel) => fs.readFileSync(path.join(baseDir, rel)).toString("base64"));
}

function staticryptBin() {
  const p = path.join(ROOT, "node_modules", ".bin", "staticrypt");
  if (!fs.existsSync(p)) throw new Error("staticrypt is not installed; run npm ci");
  return p;
}

const TEMPLATE = path.join(ROOT, "tools", "password_template.html");
const ENCRYPT_FLAGS = [
  "--config", ".staticrypt.json",
  "--remember", "30",
  "--template", "tools/password_template.html",
  "--template-title", "Password required",
  "--template-instructions", "This page is a draft and is not public yet. Enter the password to read it.",
  "--template-placeholder", "Password",
  "--template-button", "Unlock",
  "--template-remember", "Remember me on this device for 30 days",
  "--template-error", "Wrong password",
  "--template-color-primary", "#1F5FD1",
  "--template-color-secondary", "#0f1115"
];

function encrypt(plainFile, outDir) {
  execFileSync(staticryptBin(), [plainFile, "-d", outDir, ...ENCRYPT_FLAGS],
    { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, STATICRYPT_PASSWORD: PASSWORD } });
}

// Protected-page words that are known false positives of the substring scan
// below, and only these. Every other protected-only word is checked in every
// built file, JSON and JavaScript included. Add a word here only with its reason.
const LEAK_ALLOW = new Map([
  // WebGL API: gl.getExtension(...) in assets/js/fx.js (the background themes).
  ["extension", "gl.getExtension in assets/js/fx.js"],
  // A Toxoplasma gene product description in assets/data/volcano.json (from spaCR's annotation).
  ["assembly", "gene product text in assets/data/volcano.json"]
]);

// Files of dir that contain any of words (lower-case substring match).
function scanLeaks(dir, words) {
  const out = [];
  for (const f of walk(dir)) {
    const body = fs.readFileSync(f).toString("latin1").toLowerCase();
    for (const w of words) if (body.includes(w)) out.push(`${path.relative(dir, f)}: ${w}`);
  }
  return out;
}

// Self-test: a protected-only word planted in a public .json value and inside a
// camel-case .js identifier must both be caught. The fixture is written to a
// temporary .stage-* folder (git-ignored) and removed; the word is never logged.
function leakSelfTest(sentinels) {
  const word = [...sentinels].find((w) => /^[a-z]{8,}$/.test(w) && !LEAK_ALLOW.has(w));
  if (!word) throw new Error("leak self-test: no protected-only word to plant");
  const dir = fs.mkdtempSync(path.join(ROOT, ".stage-leaktest-"));
  try {
    const cap = word[0].toUpperCase() + word.slice(1);
    fs.writeFileSync(path.join(dir, "fixture.json"), JSON.stringify({ note: `public text ${word} public text` }));
    fs.writeFileSync(path.join(dir, "fixture.js"), `var api = {}; api.get${cap}Value = function () { return 1; };\n`);
    const hits = new Set(scanLeaks(dir, sentinels).map((l) => l.split(":")[0]));
    if (!hits.has("fixture.json") || !hits.has("fixture.js")) {
      console.error("[build] LEAK CHECK SELF-TEST FAILED: a planted protected word was not detected in " +
        ["fixture.json", "fixture.js"].filter((f) => !hits.has(f)).join(" and "));
      process.exit(4);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  log("leak check self-test passed: planted word caught in a .json value and a .js identifier");
}

function sentinelWords(plainHtml, publicText) {
  const text = plainHtml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/data:[^"')\s]+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  const words = new Set((text.match(/[A-Za-z][A-Za-z_-]{7,}/g) || []).map((w) => w.toLowerCase()));
  const pub = new Set((publicText.match(/[A-Za-z][A-Za-z_-]{7,}/g) || []).map((w) => w.toLowerCase()));
  return [...words].filter((w) => !pub.has(w));
}

async function main() {
  const meta = await spacrMeta();
  log(`spaCR ${meta.version} (PyPI), release ${meta.releaseTag}, version DOI ${meta.versionDoi} (${meta.versionDoiVersion}), concept DOI ${meta.conceptDoi}`);
  if (meta.versionDoiVersion && meta.versionDoiVersion !== meta.version) {
    log(`note: Zenodo latest is ${meta.versionDoiVersion}, PyPI is ${meta.version}`);
  }
  const zs = await zooStatus();
  const sp = await starplastMeta();
  log(`Starplast ${sp.version} (PyPI, ${sp.released}), Python ${sp.requiresPython}`);
  const stats = await statsVars(readJSON(path.join(DATA, "papers.json")).papers.length);
  const ASSET_VERSION = assetVersion();
  const varsFor = (tr) => ({ ...spacrVars(meta, tr), ...showcaseVars(tr), ...papersVars(tr), ...stats, ...starplastVars(sp), ...modelsVars(tr, zs), ASSET_VERSION });
  await refreshPaperCandidates();

  const i18nPages = new Map();
  for (const f of walk(SRC).filter((f) => f.endsWith("index.html") && fs.existsSync(path.join(path.dirname(f), "i18n")))) {
    const dir = path.relative(SRC, path.dirname(f));
    const warn = (m) => log(`i18n ${dir}: ${m}`);
    const english = englishFor(readPartials(PARTIALS, fs.readFileSync(f, "utf8")), DATA);
    const enJson = path.join(path.dirname(f), "i18n", "en.json");
    if (!fs.existsSync(enJson) || fs.readFileSync(enJson, "utf8") !== referenceJSON(english)) warn("i18n/en.json is out of date; run node tools/check_i18n.mjs --write-en");
    i18nPages.set(dir, { home: `/${dir.split(path.sep).join("/")}/`, english, warn, langs: loadLanguages(path.join(path.dirname(f), "i18n"), warn) });
  }
  const spacrI18n = i18nPages.get(path.join("projects", "spacr"));
  const enTr = translator(null, englishFor(readPartials(PARTIALS, fs.readFileSync(path.join(SRC, "projects", "spacr", "index.html"), "utf8")), DATA));
  const enVars = { ...varsFor(enTr), ...NO_LANG, SPACR_LANGS: spacrI18n ? spacrI18n.langs.map((l) => l.tag).join(" ") : "" };

  copyPublic();
  let publicText = "";
  for (const f of walk(DIST).filter((f) => f.endsWith(".html"))) {
    const dir = path.relative(DIST, path.dirname(f));
    const page = dir.split(path.sep).pop() || "";
    const tpl = fs.readFileSync(f, "utf8");
    const site = i18nPages.get(dir);
    const multi = site && site.langs.length ? site : null;
    const en = { code: "en", tag: "en", name: "English", status: "" };
    const out = render(tpl, page, multi ? { ...enVars, ...langVars(multi.home, multi.langs, en, enTr) } : enVars);
    fs.writeFileSync(f, out);
    publicText += out;
    if (!multi) continue;
    for (const lang of multi.langs) {
      const own = translator(lang.dict, multi.english, multi.warn);
      const tr = (id) => (multi.english.has(id) ? own(id) : enTr(id));
      const known = [...multi.english].filter(([k, en]) => typeof lang.dict[k] === "string" && lang.dict[k].trim() && sameSignature(lang.dict[k], en) && (!/<[^>]*>/.test(lang.dict[k]) || /<[^>]*>/.test(en))).length;
      const vars = { ...varsFor(tr), ...langVars(multi.home, multi.langs, lang, tr), SPACR_LANGS: enVars.SPACR_LANGS };
      const html = render(tpl, page, vars, { lang, english: multi.english, home: multi.home, warn: multi.warn });
      fs.mkdirSync(path.join(path.dirname(f), lang.tag), { recursive: true });
      fs.writeFileSync(path.join(path.dirname(f), lang.tag, "index.html"), html);
      publicText += html;
      log(`i18n ${dir}/${lang.tag}/: ${known} of ${multi.english.size} strings translated${lang.status ? `, status "${lang.status}"` : ""}`);
    }
  }
  for (const f of walk(DIST).filter((f) => /\.(css|js|svg|txt)$/.test(f))) publicText += fs.readFileSync(f, "utf8");

  fs.rmSync(path.join(ROOT, ".stage"), { recursive: true, force: true });
  const tmp = fs.mkdtempSync(path.join(ROOT, ".stage-"));
  const digest = createHmac("sha256", PASSWORD);
  digest.update(fs.readFileSync(TEMPLATE));
  digest.update(JSON.stringify(ENCRYPT_FLAGS));
  digest.update(fs.readFileSync(path.join(ROOT, "package-lock.json")));
  const sentinels = new Set(["cellposetime", "thumbscrew", "haemocytometer", "live_cell_v1"]);
  try {
    for (const name of fs.readdirSync(PROTECTED).sort()) {
      const dir = path.join(PROTECTED, name);
      const src = path.join(dir, "index.html");
      if (!fs.existsSync(src)) continue;
      const { html: rendered, sealed } = sealAssets(render(fs.readFileSync(src, "utf8"), name, enVars), dir, name);
      const plain = inlineAssets(rendered, dir);
      digest.update(name + "\0" + plain + "\0");
      sentinelWords(plain, publicText).forEach((w) => sentinels.add(w));
      const stage = path.join(tmp, name);
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, "index.html"), plain);
      const outDir = path.join(DIST, "projects", name);
      fs.mkdirSync(outDir, { recursive: true });
      for (const a of sealed) fs.writeFileSync(path.join(outDir, a.file), a.enc);
      encrypt(path.join(stage, "index.html"), outDir);
      log(`encrypted projects/${name}/index.html (${fs.statSync(path.join(outDir, "index.html")).size} bytes)`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  for (const [w, why] of LEAK_ALLOW) if (sentinels.delete(w)) log(`leak check: "${w}" allowed (${why})`);
  leakSelfTest(sentinels);
  const leaks = scanLeaks(DIST, sentinels);
  if (leaks.length) {
    console.error("[build] LEAK CHECK FAILED: protected words found in dist/:\n  " + leaks.join("\n  "));
    process.exit(3);
  }
  log(`leak check passed: ${sentinels.size} protected-only words, none found in ${walk(DIST).length} built files`);
  fs.writeFileSync(path.join(DIST, ".protected-digest"), digest.digest("hex") + "\n");
  fs.writeFileSync(path.join(DIST, "build.json"), JSON.stringify({
    spacr: { version: meta.version, release: meta.releaseTag, versionDoi: meta.versionDoi, conceptDoi: meta.conceptDoi },
    starplast: { version: sp.version },
    built: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    trigger: process.env.GITHUB_EVENT_NAME || "local"
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
