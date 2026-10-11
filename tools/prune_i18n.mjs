// Removes keys that the English page no longer has from every i18n/<lang>.json.
// Translations of removed text are dropped; nothing is added or machine-filled.
//   node tools/prune_i18n.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { englishFor, readPartials } from "./i18n.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const tpl = path.join(SRC, "projects", "spacr", "index.html");
const english = englishFor(readPartials(path.join(SRC, "_partials"), fs.readFileSync(tpl, "utf8")), path.join(ROOT, "data"));
const dir = path.join(path.dirname(tpl), "i18n");
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json")) {
  const p = path.join(dir, f);
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const gone = Object.keys(d).filter((k) => !k.startsWith("_") && !english.has(k));
  for (const k of gone) delete d[k];
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
  console.log(`${f}: removed ${gone.length}${gone.length ? ": " + gone.join(", ") : ""}`);
}
