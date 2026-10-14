// Release assets can arrive after the tag and PyPI version become public.
// Keep the previous complete site until every desktop installer is present.
import { createHash } from "node:crypto";

const INSTALLERS = [
  [/Windows.*\.exe$/i, "install.os.windows", "windows"],
  [/macOS.*\.pkg$/i, "install.os.macos", "macos"],
  [/Linux.*\.run$/i, "install.os.linux", "linux"]
];

export function installerAssets(assets) {
  const installers = INSTALLERS.map(([pattern, label, os]) => ({
    asset: assets.find((asset) => pattern.test(asset.name)), label, os
  }));
  const missing = installers.filter(({ asset }) => !asset).map(({ os }) => os);
  if (missing.length) throw new Error(`Release is incomplete: missing desktop installers for ${missing.join(", ")}`);
  return installers;
}

export function releaseAssetsFingerprint(assets) {
  const records = assets.map((asset) => ({
    name: asset.name,
    url: asset.browser_download_url ?? asset.url,
    size: asset.size,
    updated: asset.updated_at ?? asset.updatedAt ?? ""
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en"));
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

export function releaseChanged(pypiVersion, release, parascapeVersion, live) {
  return pypiVersion !== live.spacr?.version ||
    release.tag_name !== live.spacr?.release ||
    releaseAssetsFingerprint(release.assets) !== live.spacr?.assetsFingerprint ||
    parascapeVersion !== (live.parascape?.version || "");
}

export function requireMatchingVersions(version, tag) {
  if (version !== tag.replace(/^v/, "")) {
    throw new Error(`Release is incomplete: PyPI ${version} and GitHub ${tag} do not match`);
  }
}
