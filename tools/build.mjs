// Builds the public site into dist/.
//
//   SITE_PASSWORD=... node tools/build.mjs
//
// 1. Copies src/ (public pages and assets) to dist/.
// 2. Fills spaCR facts at build time so they never go stale: version and
//    Python range from PyPI, installers from the latest GitHub release,
//    authors and concept DOI from CITATION.cff on spaCR's main branch, and
//    the latest version DOI from Zenodo.
// 3. Renders protected/ pages with their images and 3D model inlined, then
//    encrypts each one with StatiCrypt (AES-256, PBKDF2) using SITE_PASSWORD.
//    Nothing from protected/ is ever written to dist/ in plaintext.
// 4. Fails the build if any distinctive word from a protected page appears
//    anywhere in dist/.
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const PROTECTED = path.join(ROOT, "protected");
const DIST = path.join(ROOT, process.env.SITE_DIST || "dist");
const PARTIALS = path.join(SRC, "_partials");
const OFFLINE = process.env.SITE_OFFLINE_META;

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

function pythonRange(spec) {
  const lo = (spec.match(/>=\s*([\d.]+)/) || [])[1];
  const hi = (spec.match(/<\s*([\d.]+)/) || [])[1];
  if (lo && hi) {
    const [maj, min] = hi.split(".").map(Number);
    return `${lo}–${maj}.${min - 1}`;
  }
  return spec || "see PyPI";
}

function spacrVars(m) {
  const installers = [
    [/Windows.*\.exe$/i, "Windows 10/11"],
    [/macOS.*\.pkg$/i, "macOS 11+ (Intel and Apple silicon)"],
    [/Linux.*\.run$/i, "Linux x86-64"]
  ];
  const links = [];
  for (const [re, label] of installers) {
    const a = m.assets.find((x) => re.test(x.name));
    if (a) links.push(`            <li><a href="${esc(a.url)}"><span>${esc(label)}<br><span class="small muted">${esc(a.name)}</span></span><span class="sz">${fmtSize(a.size)}</span></a></li>`);
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
  if (m.versionDoiVersion && m.versionDoiVersion !== m.version) {
    log(`note: Zenodo latest is ${m.versionDoiVersion}, PyPI is ${m.version}`);
  }
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
    if (rel.startsWith("_partials")) continue;
    const dst = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(f, dst);
  }
}

function assetVersion() {
  const h = createHash("sha256");
  for (const f of ["assets/css/site.css", "assets/js/fx.js"]) h.update(fs.readFileSync(path.join(SRC, f)));
  return h.digest("hex").slice(0, 10);
}

function render(html, page, vars) {
  const part = (n) => fs.readFileSync(path.join(PARTIALS, n), "utf8");
  let out = html
    .replace("{{HEAD}}", part("head.html"))
    .replace("{{HEADER}}", part("header.html"))
    .replace("{{FOOTER}}", part("footer.html"));
  if (page) out = out.replace(`data-nav="${page}"`, `data-nav="${page}" aria-current="page"`);
  out = out.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
    if (!(k in vars)) throw new Error(`unfilled placeholder ${m}`);
    return vars[k];
  });
  return out;
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

function encrypt(plainFile, outDir, title) {
  execFileSync(staticryptBin(), [
    plainFile, "-d", outDir,
    "--config", ".staticrypt.json",
    "--remember", "30",
    "--template-title", "Password required",
    "--template-instructions", "This project page is not public yet. Enter the password to read it.",
    "--template-placeholder", "Password",
    "--template-button", "Unlock",
    "--template-remember", "Remember me on this device for 30 days",
    "--template-error", "Wrong password",
    "--template-color-primary", "#3B82F6",
    "--template-color-secondary", "#0e1015"
  ], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, STATICRYPT_PASSWORD: PASSWORD } });
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
  const vars = {
    ...spacrVars(meta),
    ASSET_VERSION: assetVersion()
  };

  copyPublic();
  let publicText = "";
  for (const f of walk(DIST).filter((f) => f.endsWith(".html"))) {
    const page = path.relative(DIST, path.dirname(f)).split(path.sep).pop() || "";
    const out = render(fs.readFileSync(f, "utf8"), page, vars);
    fs.writeFileSync(f, out);
    publicText += out;
  }
  for (const f of walk(DIST).filter((f) => /\.(css|js|svg|txt)$/.test(f))) publicText += fs.readFileSync(f, "utf8");

  fs.rmSync(path.join(ROOT, ".stage"), { recursive: true, force: true });
  const tmp = fs.mkdtempSync(path.join(ROOT, ".stage-"));
  const digest = createHmac("sha256", PASSWORD);
  const sentinels = new Set(["cellposetime", "thumbscrew", "haemocytometer", "live_cell_v1"]);
  try {
    for (const name of fs.readdirSync(PROTECTED)) {
      const dir = path.join(PROTECTED, name);
      const src = path.join(dir, "index.html");
      if (!fs.existsSync(src)) continue;
      const plain = inlineAssets(render(fs.readFileSync(src, "utf8"), name, vars), dir);
      digest.update(name + "\0" + plain + "\0");
      sentinelWords(plain, publicText).forEach((w) => sentinels.add(w));
      const stage = path.join(tmp, name);
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, "index.html"), plain);
      const outDir = path.join(DIST, "projects", name);
      fs.mkdirSync(outDir, { recursive: true });
      encrypt(path.join(stage, "index.html"), outDir, name);
      log(`encrypted projects/${name}/index.html (${fs.statSync(path.join(outDir, "index.html")).size} bytes)`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const leaks = [];
  for (const f of walk(DIST)) {
    const body = fs.readFileSync(f).toString("latin1").toLowerCase();
    for (const w of sentinels) if (body.includes(w)) leaks.push(`${path.relative(DIST, f)}: ${w}`);
  }
  if (leaks.length) {
    console.error("[build] LEAK CHECK FAILED: protected words found in dist/:\n  " + leaks.join("\n  "));
    process.exit(3);
  }
  log(`leak check passed: ${sentinels.size} protected-only words, none found in ${walk(DIST).length} built files`);
  fs.writeFileSync(path.join(DIST, ".protected-digest"), digest.digest("hex") + "\n");
  fs.writeFileSync(path.join(DIST, "build.json"), JSON.stringify({
    spacr: { version: meta.version, release: meta.releaseTag, versionDoi: meta.versionDoi, conceptDoi: meta.conceptDoi }
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
