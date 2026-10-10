// Checks the translation files of every page that has an i18n/ folder.
//
//   node tools/check_i18n.mjs              report per language; exit 1 on errors
//   node tools/check_i18n.mjs --write-en   regenerate i18n/en.json from the template
//   node tools/check_i18n.mjs --strict     also fail on missing keys
//   node tools/check_i18n.mjs --list sv    print the missing keys of one language with their English
//
// Errors: en.json out of date, unknown (extra) keys, values whose tags,
// attributes or {{PLACEHOLDERS}} differ from the English, invalid JSON.
// Missing keys are not errors: the build shows the English for them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, englishFor, readPartials, referenceJSON, sameSignature } from "./i18n.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const args = process.argv.slice(2);
const WRITE = args.includes("--write-en");
const STRICT = args.includes("--strict");
const LIST = args.includes("--list") ? args[args.indexOf("--list") + 1] : null;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

let errors = 0;
const err = (m) => { errors++; console.log("  ERROR " + m); };
const words = (s) => String(s).replace(/<[^>]*>/g, " ").replace(/\{\{[A-Z_]+\}\}/g, " ").split(/\s+/).filter(Boolean).length;

for (const tpl of walk(SRC).filter((f) => f.endsWith("index.html") && fs.existsSync(path.join(path.dirname(f), "i18n")))) {
  const dir = path.join(path.dirname(tpl), "i18n");
  const rel = path.relative(ROOT, dir);
  const english = englishFor(readPartials(path.join(SRC, "_partials"), fs.readFileSync(tpl, "utf8")), path.join(ROOT, "data"));
  const refText = referenceJSON(english);
  const enFile = path.join(dir, "en.json");
  const total = [...english.values()].reduce((n, v) => n + words(v), 0);
  console.log(`${rel}: ${english.size} keys, ${total} English words`);
  if (WRITE) {
    fs.writeFileSync(enFile, refText);
    console.log(`  wrote ${path.relative(ROOT, enFile)}`);
  } else if (!fs.existsSync(enFile) || fs.readFileSync(enFile, "utf8") !== refText) {
    err("en.json is out of date: run node tools/check_i18n.mjs --write-en");
  }
  for (const [code, info] of Object.entries(LANGUAGES)) {
    if (code === "en") continue;
    const file = path.join(dir, `${code}.json`);
    if (!fs.existsSync(file)) { console.log(`  ${code.padEnd(6)} no file: no page is built`); continue; }
    let dict;
    try { dict = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { err(`${code}.json is not valid JSON: ${e.message}`); continue; }
    const keys = Object.keys(dict).filter((k) => !k.startsWith("_"));
    const missing = [...english.keys()].filter((k) => typeof dict[k] !== "string" || !dict[k].trim());
    const extra = keys.filter((k) => !english.has(k));
    const bad = keys.filter((k) => english.has(k) && typeof dict[k] === "string" && dict[k].trim() && !sameSignature(dict[k], english.get(k)));
    const status = typeof dict._status === "string" ? `, status "${dict._status}"` : "";
    console.log(`  ${code.padEnd(6)} ${info.name}: ${english.size - missing.length}/${english.size} translated, ${missing.length} missing, ${extra.length} extra, ${bad.length} markup mismatches${status}`);
    for (const k of extra) err(`${code}: unknown key ${k}`);
    for (const k of bad) err(`${code}: ${k}: tags, attributes or placeholders differ from English\n      en: ${english.get(k)}\n      ${code}: ${dict[k]}`);
    if (STRICT && missing.length) err(`${code}: ${missing.length} missing keys`);
    if (LIST === code) for (const k of missing) console.log(`    ${k}: ${english.get(k)}`);
  }
}
if (errors) { console.log(`${errors} error(s)`); process.exit(1); }
console.log("i18n check passed");
