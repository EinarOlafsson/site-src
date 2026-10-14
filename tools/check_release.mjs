import fs from "node:fs";
import { releaseChanged } from "./releases.mjs";

const [pypiVersion, releasePath, parascapeVersion, livePath] = process.argv.slice(2);
if (!pypiVersion || !releasePath || !livePath) {
  throw new Error("Expected PyPI version, release JSON path, ParaScape version and live JSON path");
}
const release = JSON.parse(fs.readFileSync(releasePath, "utf8"));
const live = JSON.parse(fs.readFileSync(livePath, "utf8"));
console.log(`build=${releaseChanged(pypiVersion, release, parascapeVersion, live)}`);
