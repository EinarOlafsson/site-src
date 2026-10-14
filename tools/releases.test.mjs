import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { installerAssets, releaseAssetsFingerprint, releaseChanged, requireMatchingVersions } from "./releases.mjs";

const assets = ["Windows-Online-Setup.exe", "macOS-Universal-Online.pkg", "Linux-x86_64-Online.run"].map((suffix, i) => ({
  name: `spaCR-1.5.1.5-${suffix}`,
  browser_download_url: `https://github.com/EinarOlafsson/spacr/releases/download/v1.5.1.5/spaCR-1.5.1.5-${suffix}`,
  size: 1024 + i, updated_at: "2026-10-14T19:00:00Z"
}));
const release = { tag_name: "v1.5.1.5", assets };
const live = {
  spacr: { version: "1.5.1.5", release: release.tag_name, assetsFingerprint: releaseAssetsFingerprint(assets) },
  parascape: { version: "0.0.1.0" }
};

test("unchanged complete publication does not rebuild", () => {
  assert.equal(releaseChanged("1.5.1.5", release, "0.0.1.0", live), false);
  assert.deepEqual(installerAssets(assets).map(({ os }) => os), ["windows", "macos", "linux"]);
});

test("same-tag staggered uploads cause another build", () => {
  const earlySite = structuredClone(live);
  earlySite.spacr.assetsFingerprint = releaseAssetsFingerprint(assets.slice(0, 1));
  assert.equal(releaseChanged("1.5.1.5", release, "0.0.1.0", earlySite), true);
});

test("no partial desktop download page replaces the complete site", () => {
  for (let missing = 0; missing < assets.length; missing++) {
    assert.throws(() => installerAssets(assets.filter((_, i) => i !== missing)), /Release is incomplete/);
  }
  assert.throws(() => installerAssets([]), /windows, macos, linux/);
});

test("replacement assets are detected even at the same URL and byte length", () => {
  const replaced = structuredClone(release);
  replaced.assets[0].updated_at = "2026-10-14T19:10:00Z";
  assert.equal(releaseChanged("1.5.1.5", replaced, "0.0.1.0", live), true);
});

test("late checksum files are detected with no version change", () => {
  const finished = structuredClone(release);
  finished.assets.push({ name: "SHA256SUMS.txt", size: 512, browser_download_url: "https://example.test/SHA256SUMS.txt" });
  assert.equal(releaseChanged("1.5.1.5", finished, "0.0.1.0", live), true);
});

test("API order and normalized build fields produce the same fingerprint", () => {
  const normalized = [...assets].reverse().map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, updatedAt: a.updated_at }));
  assert.equal(releaseAssetsFingerprint(normalized), releaseAssetsFingerprint(assets));
});

test("legacy deployed manifests upgrade once", () => {
  const legacy = structuredClone(live);
  delete legacy.spacr.assetsFingerprint;
  assert.equal(releaseChanged("1.5.1.5", release, "0.0.1.0", legacy), true);
  assert.equal(releaseChanged("1.5.1.5", release, "0.0.1.0", live), false);
});

test("PyPI and GitHub releases cannot be mixed in a built page", () => {
  assert.doesNotThrow(() => requireMatchingVersions("1.5.1.5", "v1.5.1.5"));
  assert.doesNotThrow(() => requireMatchingVersions("1.5.1.5", "1.5.1.5"));
  assert.throws(() => requireMatchingVersions("1.5.1.5", "v1.5.1.4"), /do not match/);
});

test("new project versions and an absent live manifest still rebuild", () => {
  assert.equal(releaseChanged("1.5.1.6", release, "0.0.1.0", live), true);
  assert.equal(releaseChanged("1.5.1.5", { ...release, tag_name: "v1.5.1.6" }, "0.0.1.0", live), true);
  assert.equal(releaseChanged("1.5.1.5", release, "0.0.1.1", live), true);
  assert.equal(releaseChanged("1.5.1.5", release, "0.0.1.0", {}), true);
});

test("actual scheduled workflow detects late assets and skips unchanged releases", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "site-release-test-"));
  try {
    const workflow = fs.readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
    const script = workflow.split("        run: |\n")[1].split("\n  deploy:")[0].split("\n").map((line) => line.slice(10)).join("\n");
    const releasePath = path.join(dir, "release.json");
    const livePath = path.join(dir, "live.json");
    fs.writeFileSync(releasePath, JSON.stringify(release));
    fs.writeFileSync(path.join(dir, "curl"), `#!/bin/sh\nfor arg do url="$arg"; done\ncase "$url" in\n  *pypi.org/pypi/spacr/json) printf '%s' '{"info":{"version":"1.5.1.5"}}' ;;\n  *pypi.org/pypi/parascape/json) exit 22 ;;\n  *releases/latest) cat "$FIXTURE_RELEASE" ;;\n  *build.json*) cat "$FIXTURE_LIVE" ;;\n  *) exit 3 ;;\nesac\n`, { mode: 0o700 });
    for (const changed of [false, true]) {
      const manifest = structuredClone(live);
      if (changed) manifest.spacr.assetsFingerprint = releaseAssetsFingerprint(assets.slice(0, 1));
      fs.writeFileSync(livePath, JSON.stringify(manifest));
      const output = path.join(dir, `output-${changed}`);
      execFileSync("bash", ["-c", script], { env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir,
        EVENT: "schedule", SCHEDULE: "23 * * * *", FORCE: "", GH_TOKEN: "fixture-token",
        GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: path.join(dir, "summary"),
        FIXTURE_RELEASE: releasePath, FIXTURE_LIVE: livePath
      }});
      assert.equal(fs.readFileSync(output, "utf8").trim(), `build=${changed}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("actual build refuses partial releases before replacing existing output", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), "site-build-refusal-"));
  try {
    const out = path.join(dir, "published");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "index.html"), "previous complete site");
    for (const [current, expected] of [
      [{ ...release, assets: assets.slice(0, 1) }, /missing desktop installers/],
      [{ ...release, tag_name: "v1.5.1.4" }, /do not match/]
    ]) {
      const stub = path.join(dir, "fetch.mjs");
      fs.writeFileSync(stub, `globalThis.fetch = async (url) => {
        if (url === "https://pypi.org/pypi/spacr/json") return new Response(${JSON.stringify(JSON.stringify({ info: { version: "1.5.1.5" } }))});
        if (url === "https://api.github.com/repos/EinarOlafsson/spacr/releases/latest") return new Response(${JSON.stringify(JSON.stringify(current))});
        throw new Error("unexpected network request " + url);
      };`);
      const result = spawnSync(process.execPath, ["--import", stub, "tools/build.mjs"], {
        encoding: "utf8", env: { ...process.env, SITE_PASSWORD: "test-only-unpublished-password",
          SITE_OFFLINE_META: "", SITE_DIST: path.relative(process.cwd(), out) }
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, expected);
      assert.equal(fs.readFileSync(path.join(out, "index.html"), "utf8"), "previous complete site");
      assert.deepEqual(fs.readdirSync(out), ["index.html"]);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
