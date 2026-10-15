// Pins a small set of held-out TEST images per mask-generator model class
// from the public spaCR Hugging Face datasets, at an immutable revision.
//
//   node tools/mask-examples.mjs            rewrite data/mask-examples.json
//   node tools/mask-examples.mjs --check    exit 1 if the pinned records changed upstream
//
// Each record has exactly the fields the hosted service's approved-example list
// accepts (family, repo_id, revision, filename, sha256, bytes, credit, split),
// so the same file can be given to the Space as SPACR_WEB_EXAMPLES_JSON.
// Only rows whose split is "test" are used; training or validation images are
// never offered as examples. Reads public metadata only (no token).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "mask-examples.json");
const HF = "https://huggingface.co";
const PER_FAMILY = 12;
const MAX_BYTES = 40_000_000;
const CC = "CC BY 4.0";

// split: CSV file, name column, split column, test value, optional row filter,
// image directory and how a row maps to an image file name.
export const SOURCES = [
  { family: "toxoplasma_pv", repo: "einarolafsson/toxoplasma-pv-segmentation-dataset-r7", csv: "split.csv", name: "stem", split: "set", dir: "images", credit: `spaCR Toxoplasma vacuole dataset r7 (${CC})` },
  { family: "toxoplasma_plaque", repo: "einarolafsson/toxoplasma-plaque-dataset", csv: "splits.csv", name: "name", split: "split", dir: "images", keep: (row) => Number(row.n_objects) > 0, credit: `spaCR Toxoplasma plaque dataset (${CC}); literature crops keep their article credit in the dataset manifest` },
  { family: "toxoplasma_well_detector", repo: "einarolafsson/toxoplasma-plaque-well-detector-dataset", csv: "split.csv", name: "filename", split: "set", dir: "images/test", keep: (row) => Number(row.n_boxes) > 0, exact: true, credit: `spaCR plaque-well detector dataset (${CC}); figure sources are listed in the dataset` },
  { family: "cell_from_hoechst", repo: "einarolafsson/cross-channel-cell-from-hoechst", csv: "fields.csv", name: "name", split: "split", dir: "images", credit: `spaCR cross-channel cell-from-Hoechst dataset (${CC})` },
  { family: "nuclei_from_cellmask", repo: "einarolafsson/cross-channel-nuclei-from-cellmask", csv: "fields.csv", name: "name", split: "split", dir: "images", credit: `spaCR cross-channel nuclei-from-cell-mask dataset (${CC})` },
  { family: "toxoplasma_from_cellmask", repo: "einarolafsson/cross-channel-toxoplasma-from-cellmask", csv: "fields.csv", name: "name", split: "split", dir: "images", keep: (row) => Number(row.n_objects) > 0, credit: `spaCR cross-channel Toxoplasma-from-cell-mask dataset (${CC})` },
  // The Hoechst images of the same held-out wells: the toxoplasma test rows
  // name the fields, the cell-from-Hoechst dataset holds their Hoechst image.
  { family: "toxoplasma_from_hoechst", repo: "einarolafsson/cross-channel-cell-from-hoechst", csv: "fields.csv", name: "name", split: "split", dir: "images", rowsFrom: "einarolafsson/cross-channel-toxoplasma-from-cellmask", keep: (row) => Number(row.n_objects) > 0, credit: `spaCR cross-channel datasets, Hoechst images of held-out Toxoplasma fields (${CC})` },
  // Only openly licensed live-cell sources (CC0, CC BY 4.0, MIT).
  { family: "live_cell", repo: "einarolafsson/live-cell-segmentation-dataset", csv: "splits.csv", name: "name", split: "split", dir: "images", sub: "source", keep: (row) => ["bbbc009_dic", "qpi_phase_adherent", "yeast_microstructures_brightfield"].includes(row.source), credit: "spaCR live-cell dataset: BBBC009 (CC0), Vicar et al. 2021 QPI (CC BY 4.0), Reich et al. 2023 yeast (MIT); see SOURCES.md" },
];

const parseCSV = (text) => {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const keys = head.split(",");
  return lines.map((line) => Object.fromEntries(line.split(",").map((value, i) => [keys[i], value])));
};

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return { body: await response.json(), link: response.headers.get("link") };
}

async function listDir(repo, revision, dir) {
  const files = new Map();
  let url = `${HF}/api/datasets/${repo}/tree/${revision}/${dir}?limit=1000`;
  while (url) {
    const { body, link } = await getJSON(url);
    for (const entry of body) if (entry.type === "file") files.set(entry.path, entry);
    const next = link && link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return files;
}

const revisionOf = async (repo) => (await getJSON(`${HF}/api/datasets/${repo}`)).body.sha;
const csvAt = async (repo, revision, file) => {
  const response = await fetch(`${HF}/datasets/${repo}/resolve/${revision}/${file}`);
  if (!response.ok) throw new Error(`${repo}/${file}: HTTP ${response.status}`);
  return parseCSV(await response.text());
};

export function spread(items, count) {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, i) => items[Math.floor((i * items.length) / count)]);
}

async function recordsFor(source) {
  const revision = await revisionOf(source.repo);
  const rowRepo = source.rowsFrom || source.repo;
  const rowRevision = source.rowsFrom ? await revisionOf(rowRepo) : revision;
  const rows = (await csvAt(rowRepo, rowRevision, source.csv)).filter((row) => row[source.split] === "test" && (!source.keep || source.keep(row)));
  const dirs = source.sub ? [...new Set(rows.map((row) => `${source.dir}/${row[source.sub]}`))] : [source.dir];
  const files = new Map();
  for (const dir of dirs) for (const [p, entry] of await listDir(source.repo, revision, dir)) files.set(p, entry);
  const byStem = new Map();
  for (const [p, entry] of files) {
    const base = p.slice(p.lastIndexOf("/") + 1);
    byStem.set(source.exact ? p : p.replace(/\.[^./]+$/, ""), entry);
    if (!source.exact) byStem.set(`${p.slice(0, p.lastIndexOf("/") + 1)}${base}`, entry);
  }
  const found = [];
  for (const row of rows.sort((a, b) => a[source.name].localeCompare(b[source.name]))) {
    const dir = source.sub ? `${source.dir}/${row[source.sub]}` : source.dir;
    const entry = byStem.get(`${dir}/${row[source.name]}`);
    if (!entry || !entry.lfs || !/^[0-9a-f]{64}$/.test(entry.lfs.oid) || !(entry.size > 0) || entry.size > MAX_BYTES) continue;
    if (!/\.(tiff?|png|jpe?g|bmp)$/i.test(entry.path)) continue;
    found.push({ family: source.family, repo_id: source.repo, revision, filename: entry.path, sha256: entry.lfs.oid, bytes: entry.size, credit: source.credit, split: "test" });
  }
  if (!found.length) throw new Error(`${source.family}: no test image found in ${source.repo}`);
  return spread(found, PER_FAMILY);
}

export async function buildExamples() {
  const records = [];
  for (const source of SOURCES) records.push(...(await recordsFor(source)));
  return { schema: 1, note: "Held-out test images only; generated by tools/mask-examples.mjs", records };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await buildExamples();
  const text = JSON.stringify(result, null, 1) + "\n";
  if (process.argv.includes("--check")) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === text;
    console.log(same ? "mask examples are current" : "mask examples changed upstream; rerun without --check");
    process.exit(same ? 0 : 1);
  }
  fs.writeFileSync(OUT, text);
  const counts = {};
  for (const r of result.records) counts[r.family] = (counts[r.family] || 0) + 1;
  console.log(`wrote ${path.relative(ROOT, OUT)}:`, counts);
}
