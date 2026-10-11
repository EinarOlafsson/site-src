"""Build data/models.json, the Models tab's sourced metrics, from published files only.

Every number comes from a published file: spaCR's model zoo and plaque model
comparison on GitHub (at a fixed nightly commit) or a file in an einarolafsson
Hugging Face repository (at a fixed revision). Nothing is recomputed; a metric a
source does not record is written as null. Each number's source URL is written
to tools/models/sources.json.

Usage (run isolated, downloads are untrusted data):
    python -I tools/models/collect.py [--spacr-sha SHA] [--cache DIR]
"""

import argparse
import ast
import csv
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(SITE, "data", "models.json")
RUN_RECORD = os.path.join(HERE, "sources.json")
GH = "https://github.com/EinarOlafsson/spacr"
RAW = "https://raw.githubusercontent.com/EinarOlafsson/spacr"
HF = "https://huggingface.co"
OWNER = "einarolafsson"
FORBIDDEN = ("cellposetime", "thumbscrew", "haemocytometer", "live_cell_v1", "fine-tun", "incucyte", "livecell-style")
ZOO_PATH = "spacr/model_zoo.py"
SETTINGS_PATH = "spacr/settings.py"
COMPARE_PATH = "features/data/model_compare_2026-10-10/plaque_compare.json"

RECORD = []


def r3(value):
    """Round half up to 3 decimals from the value's decimal text, so 0.7755 is 0.776."""
    out = float(Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))
    return int(out) if out.is_integer() and abs(out) >= 1 else out


def fetch(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "site-models-collect"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest + ".part", "wb") as f:
        f.write(r.read())
    os.replace(dest + ".part", dest)
    return dest


def nightly_sha():
    out = subprocess.run(["git", "ls-remote", GH + ".git", "refs/heads/nightly"],
                         capture_output=True, text=True, check=True).stdout.split()
    return out[0]


class Sources:
    def __init__(self, cache, sha):
        self.cache = cache
        self.sha = sha
        self.revs = {}

    def gh(self, path):
        dest = os.path.join(self.cache, "github", self.sha, path)
        fetch(f"{RAW}/{self.sha}/{path}", dest)
        return dest, f"{GH}/blob/{self.sha}/{path}"

    def rev(self, repo, kind="model"):
        if (repo, kind) not in self.revs:
            api = f"{HF}/api/{'datasets' if kind == 'dataset' else 'models'}/{OWNER}/{repo}"
            dest = os.path.join(self.cache, "hf-api", kind, repo + ".json")
            if os.path.exists(dest):
                os.remove(dest)
            fetch(api, dest)
            with open(dest) as f:
                self.revs[(repo, kind)] = json.load(f)["sha"]
        return self.revs[(repo, kind)]

    def hf(self, repo, path, kind="model"):
        rev = self.rev(repo, kind)
        base = f"{HF}/datasets/{OWNER}/{repo}" if kind == "dataset" else f"{HF}/{OWNER}/{repo}"
        dest = os.path.join(self.cache, "hf", kind, repo, rev, path)
        fetch(f"{base}/resolve/{rev}/{path}", dest)
        return dest, f"{base}/blob/{rev}/{path}"


def literal(node, names):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, (ast.Tuple, ast.List)):
        return [literal(e, names) for e in node.elts]
    if isinstance(node, ast.Dict):
        return {literal(k, names): literal(v, names) for k, v in zip(node.keys, node.values)}
    if isinstance(node, ast.Name):
        return names[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -literal(node.operand, names)
    raise ValueError(f"unsupported node {type(node).__name__}")


def zoo_records(path):
    tree = ast.parse(open(path, encoding="utf-8").read())
    names = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                names[node.targets[0].id] = node.value.value
    for node in tree.body:
        target = getattr(node, "target", None) or (node.targets[0] if isinstance(node, ast.Assign) else None)
        if isinstance(target, ast.Name) and target.id == "BUNDLED_REMOTE_MODELS":
            return {r["key"]: r for r in literal(node.value, names)}
    raise KeyError("BUNDLED_REMOTE_MODELS")


def num(text):
    m = re.search(r"-?\d+(?:\.\d+)?", str(text).replace(",", ""))
    if not m:
        raise ValueError(f"no number in {text!r}")
    return float(m.group(0))


def md_tables(path):
    tables, cur = [], None
    for line in open(path, encoding="utf-8"):
        s = line.strip()
        if s.startswith("|"):
            cells = [c.strip().replace("**", "") for c in s.strip("|").split("|")]
            if cur is None:
                cur = {"header": cells, "rows": []}
            elif not all(re.fullmatch(r":?-+:?", c) for c in cells if c):
                cur["rows"].append(cells)
        elif cur is not None:
            tables.append(cur)
            cur = None
    if cur is not None:
        tables.append(cur)
    return tables


class Ex:
    """Extractors: each returns (value, url) and records the lookup."""

    def __init__(self, src, zoo_url, zoo):
        self.src, self.zoo_url, self.zoo = src, zoo_url, zoo

    def note(self, what, value, url, raw):
        RECORD.append({"what": what, "value": value, "raw": raw, "source": url})
        return value

    def table(self, what, repo, row, col, kind="model", path="README.md", nth=0):
        dest, url = self.src.hf(repo, path, kind)
        hits = []
        for t in md_tables(dest):
            if col not in t["header"]:
                continue
            i = t["header"].index(col)
            for r in t["rows"]:
                if re.search(row, r[0]) and i < len(r):
                    hits.append(r[i])
        raw = hits[nth]
        return self.note(what, r3(num(raw)), url, raw)

    def text(self, what, repo, pattern, kind="model", path="README.md", group=1, scale=1.0):
        dest, url = self.src.hf(repo, path, kind)
        m = re.search(pattern, open(dest, encoding="utf-8").read(), re.S)
        if not m:
            raise ValueError(f"{what}: pattern not found in {url}")
        raw = m.group(group)
        return self.note(what, r3(num(raw) * scale), url, raw)

    def jpath(self, what, repo, path, keys, kind="model", gh=False):
        dest, url = self.src.gh(path) if gh else self.src.hf(repo, path, kind)
        obj = json.load(open(dest, encoding="utf-8"))
        for k in keys:
            obj = obj[k]
        return self.note(what, r3(float(obj)), url + "#" + "/".join(map(str, keys)), obj)

    def row(self, what, repo, path, match, col):
        dest, url = self.src.hf(repo, path)
        for r in csv.DictReader(io.StringIO(open(dest, encoding="utf-8").read())):
            if all(str(r.get(k)) == str(v) for k, v in match.items()):
                return self.note(what, r3(r[col]), url, r[col])
        raise KeyError(f"{what}: no row {match} in {url}")


def pair(ft, va):
    return {"finetuned": ft, "vanilla": va}


EMPTY = ("f1_50", "f1_75", "ap", "precision", "recall", "aji", "dice", "map50", "map50_95")


def metrics(**kw):
    out = {k: None for k in EMPTY}
    out.update(kw)
    return out


def build(src, zoo, zoo_url, sha):
    x = Ex(src, zoo_url, zoo)
    settings_dest, settings_url = src.gh(SETTINGS_PATH)
    settings_text = open(settings_dest, encoding="utf-8").read()
    if "Default 'toxoplasma_well_detector_v2'" not in settings_text:
        raise ValueError("settings.py no longer names well detector v2 as the default")
    cmp_ = lambda what, keys: x.jpath(what, None, COMPARE_PATH, keys, gh=True)
    hf_url = lambda repo: f"{HF}/{OWNER}/{repo}"
    rev_url = lambda repo: f"{HF}/{OWNER}/{repo}/tree/{src.rev(repo)}"

    def model(key, display, version, base, status, status_quote, repo, test, m, baseline, note, extra_sources, public_key=None, repo_url=None):
        urls = [zoo_url] + ([rev_url(repo)] if repo else []) + extra_sources
        seen = []
        for u in urls:
            if u not in seen:
                seen.append(u)
        if status != "alternative":
            display = re.sub(r",\s*alternative\)", ")", display)
        if status != "default":
            display = re.sub(r",\s*default\)", ")", display)
        return {"key": public_key or key, "display": display, "version": version, "base": base,
                "status": status, "status_quote": status_quote,
                "repo_url": repo_url or (hf_url(repo) if repo else None), "test": test, "metrics": m,
                "baseline_label": baseline, "note": note, "sources": seen}

    groups = []

    r = "toxoplasma-pv-segmentation-cpsam"
    k = "toxoplasma_pv_v1"
    pv1 = model(k, zoo[k]["display_name"], "v1", "cpsam_v2", "superseded",
                "Superseded. Toxoplasma PV v2 (round 5) is trained on 556 images against this model's 229 and is 5-fold cross-validated. (model card)",
                r, {"size": "11 held-out in-house wells", "objects": None,
                    "source": "the 11 in-house wells held out since round 1, scored at IoU 0.5"},
                metrics(f1_50=pair(x.table("pv_v1 f1 ft", r, r"this model", "F1 @ IoU 0.5"),
                                   x.table("pv_v1 f1 stock", r, r"stock cpsam_v2", "F1 @ IoU 0.5")),
                        ap=pair(x.row("pv_v1 mAP ft", r, "round2_vs_round1.csv", {"n_test": 11}, "round2_mAP"),
                                x.jpath("pv_v1 mAP stock", r, "vanilla_vs_finetuned.json", ["vanilla_mAP"])),
                        precision=pair(x.row("pv_v1 precision ft", r, "round2_heldout_metrics.csv", {"iou": "0.5"}, "precision"), None),
                        recall=pair(x.row("pv_v1 recall ft", r, "round2_heldout_metrics.csv", {"iou": "0.5"}, "recall"), None),
                        aji=pair(x.table("pv_v1 aji ft", r, r"this model", "AJI"),
                                 x.table("pv_v1 aji stock", r, r"stock cpsam_v2", "AJI")),
                        dice=pair(x.row("pv_v1 dice ft", r, "round2_vs_round1.csv", {"n_test": 11}, "round2_dice"), None)),
                "stock cpsam_v2", "Accuracy falls sharply above IoU 0.8; suited to counting and area rather than precise morphometry.",
                [], )
    pv1["ap_label"] = "mAP over IoU 0.5 to 0.9"

    r = "toxoplasma-pv-segmentation-cpsam-r5"
    k = "toxoplasma_pv_v2"
    cv = "evaluation/cv_aggregate.json"
    pv2 = model(k, zoo[k]["display_name"], "v2", "cpsam_v2", "superseded",
                "the PV project still promotes round 5 (zoo note on toxoplasma_pv_v3); the zoo opens the PV family on its newest non-alternative version, toxoplasma_pv_v4",
                r, {"size": "619 curated pairs, 5-fold cross-validation", "objects": None,
                    "source": "mean over 5 cross-validation folds; stock cpsam_v2 was not scored on these folds"},
                metrics(f1_50=pair(x.jpath("pv_v2 f1 cv", r, cv, ["aggregate", "all", "f1", "mean"]), None),
                        ap=pair(x.jpath("pv_v2 mAP cv", r, cv, ["aggregate", "all", "mAP", "mean"]), None),
                        precision=pair(x.jpath("pv_v2 precision cv", r, cv, ["aggregate", "all", "precision", "mean"]), None),
                        recall=pair(x.jpath("pv_v2 recall cv", r, cv, ["aggregate", "all", "recall", "mean"]), None),
                        aji=pair(x.jpath("pv_v2 aji cv", r, cv, ["aggregate", "all", "aji", "mean"]), None),
                        dice=pair(x.jpath("pv_v2 dice cv", r, cv, ["aggregate", "all", "dice", "mean"]), None)),
                "stock cpsam_v2 (not scored on the cross-validation folds)",
                "F1 0.817 +/- 0.036 over five folds; the card's stock row (F1 0.713) is on the 11 in-house held-out wells, a different set.",
                [])
    pv2["ap_label"] = "mAP over IoU 0.5 to 0.9"
    x.table("pv_v2 stock f1 (11 wells, note)", r, r"stock cpsam_v2", "F1 @ IoU 0.5")

    def pv_anchor(k, ver, r, get, status, quote, note, extra):
        m = metrics(**{name: pair(get(met, "ft"), get(met, "stock"))
                       for name, met in (("f1_50", "f1"), ("ap", "mAP"), ("precision", "precision"),
                                         ("recall", "recall"), ("aji", "aji"), ("dice", "dice"))})
        rec = model(k, zoo[k]["display_name"], ver, "cpsam_v2", status, quote, r,
                    {"size": "11 anchor wells (10 with objects scored)", "objects": None,
                     "source": "the 11 in-house anchor wells held out since round 1; no PV round has trained on them"},
                    m, "stock cpsam_v2", note, extra)
        rec["ap_label"] = "mAP over IoU 0.5 to 0.9"
        return rec

    r6 = "toxoplasma-pv-segmentation-cpsam-r6"
    pv3 = pv_anchor("toxoplasma_pv_v3", "v3", r6,
                    lambda met, side: x.jpath(f"pv_v3 {met} {side}", r6, "qc/summary.json",
                                              ["r6" if side == "ft" else "stock_cpsam_v2", "test", met]),
                    "superseded",
                    "NEWEST IS NOT BEST HERE: round 6 does not beat round 2 on the anchor wells -- 0.8602 against 0.8648 -- and the PV project still promotes round 5 (zoo note)",
                    "First PV round whose checkpoint was chosen on a held-out validation set (108 fields) instead of on the test wells.",
                    [f"{HF}/{OWNER}/{r6}/blob/{src.rev(r6)}/qc/summary.json"])
    pv3["test"]["objects"] = int(x.text("pv_v3 test objects", r6, r"\|\s*test\s*\|\s*11\s*\|\s*(\d+)\s*\|"))
    r7 = "toxoplasma-pv-segmentation-cpsam-r7"
    pv4 = pv_anchor("toxoplasma_pv_v4", "v4", r7,
                    lambda met, side: x.jpath(f"pv_v4 {met} {side}", r7, "scorecard.json",
                                              [met, "finetuned" if side == "ft" else "vanilla"]),
                    "default",
                    "prefer toxoplasma_pv_v4 (zoo note on toxoplasma_pv_v5); the zoo opens a family on its newest version that is not an alternative",
                    "On 20 held-out fields of the new plate it was trained on it scores F1 0.748 against 0.899 for round 6; prefer toxoplasma_pv_v3 on that plate.",
                    [f"{HF}/{OWNER}/{r7}/blob/{src.rev(r7)}/scorecard.json"])
    pv4["test"]["objects"] = int(x.jpath("pv_v4 n_objects", r7, "scorecard.json", ["n_objects"]))

    r = "toxoplasma-pv-segmentation-cpsam-r8"
    k = "toxoplasma_pv_v5"
    q = "qc/comparison_vs_published.json"
    pv5 = model(k, zoo[k]["display_name"], "v5", "cpsam_v2", "alternative",
                "Alternative, not the recommended default. On the only fair comparison available it ties the published round 7 model (toxoplasma_pv_v4). (model card)",
                r, {"size": "50 held-out fields (36 lab, 14 published-figure crops)",
                    "objects": int(x.text("pv_v5 test objects", r, r"\(9,276 / 1,008 / ([\d,]+) objects\)")),
                    "source": "test split grouped by whole acquisition and whole paper"},
                metrics(f1_50=pair(x.jpath("pv_v5 f1 ft", r, q, ["models", "new_r8_best", "overall", "f1"]),
                                   x.jpath("pv_v5 f1 stock", r, q, ["models", "stock_cpsam_v2", "overall", "f1"])),
                        precision=pair(x.jpath("pv_v5 precision ft", r, q, ["models", "new_r8_best", "overall", "precision"]),
                                       x.jpath("pv_v5 precision stock", r, q, ["models", "stock_cpsam_v2", "overall", "precision"])),
                        recall=pair(x.jpath("pv_v5 recall ft", r, q, ["models", "new_r8_best", "overall", "recall"]),
                                    x.jpath("pv_v5 recall stock", r, q, ["models", "stock_cpsam_v2", "overall", "recall"]))),
                "stock cpsam_v2",
                "35 of the 50 test fields were in round 7's training or validation set; on the 15 it never saw, v5 scores F1 0.536 against v4's 0.525.",
                [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/{q}"])

    pv_m = {"f1_v3": pv3["metrics"]["f1_50"], "f1_v4": pv4["metrics"]["f1_50"], "f1_v5": pv5["metrics"]["f1_50"],
            "aji_v3": pv3["metrics"]["aji"], "aji_v4": pv4["metrics"]["aji"]}
    groups.append({"id": "pv", "title": "Parasitophorous vacuole segmentation",
                   "motivation": (
                       "Stock Cellpose-SAM (cpsam_v2) misses or misdraws many Toxoplasma parasitophorous vacuoles. "
                       f"On the 11 anchor wells held out since round 1 it scores F1 {pv_m['f1_v3']['vanilla']:.3f} at IoU 0.5 and AJI {pv_m['aji_v3']['vanilla']:.3f}, "
                       f"against F1 {pv_m['f1_v3']['finetuned']:.3f} and {pv_m['f1_v4']['finetuned']:.3f} and AJI {pv_m['aji_v3']['finetuned']:.3f} and {pv_m['aji_v4']['finetuned']:.3f} for v3 and v4. "
                       f"On 50 held-out fields that include published-figure crops, stock scores {pv_m['f1_v5']['vanilla']:.3f} and v5 {pv_m['f1_v5']['finetuned']:.3f}."),
                   "motivation_sources": [pv3["sources"][1], pv4["sources"][-1], pv5["sources"][-1]],
                   "models": [pv1, pv2, pv3, pv4, pv5]})

    r = "toxoplasma-plaque-segmentation-cpsam"
    k = "toxoplasma_plaque_v1"
    fm = "final_metrics.csv"
    pl1 = model(k, zoo[k]["display_name"], "v1", "cpsam", "superseded",
                "toxoplasma_plaque_v3 is the default plaque model since 2026-10-10 (zoo note); this entry still says: PREFER THIS ONE FOR MICROSCOPE-ONLY WORK",
                r, {"size": "184 wells, 3-fold cross-validation (in-domain)", "objects": None,
                    "source": "in-house crystal violet plaque wells, held out per fold"},
                metrics(f1_50=pair(x.row("plaque_v1 f1 ft", r, fm, {"set": "nas_indomain"}, "f1"),
                                   x.row("plaque_v1 f1 round1", r, fm, {"set": "nas_round1_baseline"}, "f1")),
                        precision=pair(x.row("plaque_v1 precision ft", r, fm, {"set": "nas_indomain"}, "precision"),
                                       x.row("plaque_v1 precision round1", r, fm, {"set": "nas_round1_baseline"}, "precision")),
                        recall=pair(x.row("plaque_v1 recall ft", r, fm, {"set": "nas_indomain"}, "recall"),
                                    x.row("plaque_v1 recall round1", r, fm, {"set": "nas_round1_baseline"}, "recall"))),
                "round 1 (the retired earlier plaque model); stock not recorded",
                "F1 0.806 on a held-out literature set (3-fold cross-validated, SD 0.020); round 3 trades precision for recall on that set.",
                [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/{fm}"])

    stock_v2 = lambda met: cmp_(f"plaque stock cpsam_v2 {met}", ["models", "stock_cpsam_v2", "overall", met])
    stock_v1 = lambda met: cmp_(f"plaque stock cpsam {met}", ["models", "stock_cpsam", "overall", met])
    cmp_m = lambda name, met: cmp_(f"plaque {name} {met}", ["models", name, "overall", met])
    n263 = int(x.text("plaque 263 objects", "toxoplasma-plaque-segmentation-cpsam-r6",
                      r"263 test fields \(16,467 / 3,458 / ([\d,]+) objects\)"))
    t263 = {"size": "263 held-out fields", "objects": n263,
            "source": "3 held-out Bio-Rad Gel Doc plates plus the round-5 evaluation split; no compared model trained on them"}
    _, cmp_url = src.gh(COMPARE_PATH)

    r = "toxoplasma-plaque-segmentation-cpsam-r5"
    k = "toxoplasma_plaque_v2"
    pl2 = model(k, zoo[k]["display_name"], "v2", "cpsam_v2", "superseded",
                "no longer the default: toxoplasma_plaque_v3 replaced it on 2026-10-10 (zoo note); the default is now toxoplasma_plaque_v4 (model cards)",
                r, dict(t263),
                metrics(f1_50=pair(cmp_m("toxoplasma_plaque_v2", "f1"), stock_v2("f1")),
                        precision=pair(cmp_m("toxoplasma_plaque_v2", "precision"), stock_v2("precision")),
                        recall=pair(cmp_m("toxoplasma_plaque_v2", "recall"), stock_v2("recall"))),
                "stock cpsam_v2 (same fields, Cellpose evaluation scorer)",
                "The only plaque model trained on phone-camera wells (F1 0.415 there against round 3's 0.249); scores 0.013 on Gel Doc wells.",
                [cmp_url])

    r = "toxoplasma-plaque-segmentation-cpsam-r5-geldoc"
    k = "toxoplasma_plaque_v3"
    pl3 = model(k, zoo[k]["display_name"], "v3", "cpsam", "alternative",
                "Alternative since 2026-10-11 (catalogue key toxoplasma_plaque_v3). spaCR's default plaque model is now toxoplasma_plaque_v4, chosen by the maintainer because spaCR models build on cpsam_v2 (model card; the zoo entry at this commit still names it the default)",
                r, dict(t263),
                metrics(f1_50=pair(cmp_m("toxoplasma_plaque_v3", "f1"), stock_v1("f1")),
                        precision=pair(cmp_m("toxoplasma_plaque_v3", "precision"), stock_v1("precision")),
                        recall=pair(cmp_m("toxoplasma_plaque_v3", "recall"), stock_v1("recall"))),
                "stock cpsam (same fields, Cellpose evaluation scorer)",
                "Scores higher than v4 on every source of the 263 fields (Gel Doc 0.913 against 0.804); it was the default from 2026-10-10 to 2026-10-11.",
                [cmp_url, f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/scorecard.json"])
    r6p = "toxoplasma-plaque-segmentation-cpsam-r6"
    gd_v3 = x.table("plaque_v3 geldoc f1 (card)", r6p, r"^toxoplasma_plaque_v3", "Gel Doc")
    gd_v2 = x.table("plaque_v2 geldoc f1 (card)", r6p, r"^toxoplasma_plaque_v2", "Gel Doc")
    gd_v4 = x.table("plaque_v4 geldoc f1 (card)", r6p, r"^this model", "Gel Doc")
    gd_stock_v1 = cmp_("plaque stock cpsam geldoc f1", ["models", "stock_cpsam", "by_source", "geldoc", "f1"])
    gd_stock_v2 = cmp_("plaque stock cpsam_v2 geldoc f1", ["models", "stock_cpsam_v2", "by_source", "geldoc", "f1"])
    x.jpath("plaque_v3 geldoc scorecard f1", r, "scorecard.json", ["f1", "finetuned"])

    r = "toxoplasma-plaque-segmentation-cpsam-r6"
    k = "toxoplasma_plaque_v4"
    pc = "qc/pipeline_check_vs_v3.json"
    pl4 = model(k, zoo[k]["display_name"], "v4", "cpsam_v2", "default",
                "spaCR's default plaque model since 2026-10-11, chosen by the maintainer because spaCR models build on cpsam_v2 (model card; the zoo entry at this commit still says: Alternative, not the default)",
                r, dict(t263, source=t263["source"] + "; scored through spacr.plaque.segment_plaque_image"),
                metrics(f1_50=pair(x.jpath("plaque_v4 f1 ft", r, pc, ["plaque_v4_cpsam_v2", "f1"]),
                                   x.jpath("plaque_v4 f1 v3", r, pc, ["toxoplasma_plaque_v3", "f1"])),
                        precision=pair(x.text("plaque_v4 precision", r, r"This model: precision ([\d.]+)"), None),
                        recall=pair(x.text("plaque_v4 recall", r, r"This model: precision [\d.]+, recall ([\d.]+)"), None)),
                "toxoplasma_plaque_v3 (same fields, spaCR plaque pipeline scorer)",
                "Stock cpsam_v2 scores 0.373 on the same fields with the Cellpose evaluation scorer; literature crops stay hard (F1 0.530).",
                [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/{pc}"])

    groups.append({"id": "plaque", "title": "Plaque segmentation",
                   "motivation": (
                       f"Stock Cellpose-SAM scores F1 {pl3['metrics']['f1_50']['vanilla']:.3f} (cpsam) and {pl2['metrics']['f1_50']['vanilla']:.3f} (cpsam_v2) at IoU 0.5 on 263 held-out crystal violet plaque fields, "
                       f"against {pl4['metrics']['f1_50']['finetuned']:.3f} for v4 and {pl3['metrics']['f1_50']['finetuned']:.3f} for v3. "
                       f"On Bio-Rad Gel Doc wells stock scores {max(gd_stock_v1, gd_stock_v2):.3f}, the earlier v2 model {gd_v2:.3f}, v4 {gd_v4:.3f} and v3 {gd_v3:.3f}."),
                   "motivation_sources": [cmp_url, rev_url("toxoplasma-plaque-segmentation-cpsam-r6")],
                   "models": [pl1, pl2, pl3, pl4]})

    r = "toxoplasma-plaque-well-detector-yolo11"
    k = "toxoplasma_well_detector_v1"
    det_col = lambda what, repo, col: x.table(what, repo, r"this model", col)
    w1 = model(k, zoo[k]["display_name"], "v1", "yolo11n", "superseded",
               "on that shared set this model scores mAP50 0.8838 against v2's 0.9457, so v2 is the better detector (zoo note)",
               r, {"size": "held-out split of 562 images (190 with no well)", "objects": None,
                   "source": "its own held-out split, which the zoo notes is easier than the set v2 is measured on"},
               metrics(map50=pair(det_col("well_v1 mAP50", r, "mAP50"), None),
                       map50_95=pair(det_col("well_v1 mAP50-95", r, "mAP50-95"), None),
                       precision=pair(det_col("well_v1 precision", r, "precision"), None),
                       recall=pair(det_col("well_v1 recall", r, "recall"), None)),
               "none recorded (stock YOLO has no plaque-well class)",
               "Kept because the published plaque corpus was measured with these weights; on v2's test set it scores mAP50 0.884.",
               [])

    r = "toxoplasma-plaque-well-detector-yolo26"
    k = "toxoplasma_well_detector_v2"
    tm = "qc/test_metrics.json"
    wm = lambda met, side: x.jpath(f"well_v2 {met} {side}", r, tm, [side, met])
    w2 = model(k, zoo[k]["display_name"], "v2", "yolo26n", "default",
               "figure_detector: Default 'toxoplasma_well_detector_v2' (spacr/settings.py)",
               r, {"size": "129 test images (84 with no well)",
                   "objects": int(x.text("well_v2 test boxes", r, r"\|\s*test\s*\|\s*129\s*\|\s*(\d+)\s*\|")),
                   "source": "plate images and literature figures, split by PMC article; never used for training or model selection"},
               metrics(map50=pair(wm("mAP50", "v4_yolo26n"), wm("mAP50", "v3_yolo11n")),
                       map50_95=pair(wm("mAP50_95", "v4_yolo26n"), wm("mAP50_95", "v3_yolo11n")),
                       precision=pair(wm("precision", "v4_yolo26n"), wm("precision", "v3_yolo11n")),
                       recall=pair(wm("recall", "v4_yolo26n"), wm("recall", "v3_yolo11n"))),
               "previous version (well detector v1, YOLO11n) on the same test set",
               "Cuts false boxes on no-well images from 152 to 49 on the shared test set.",
               [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/{tm}", settings_url])
    fb_v1 = x.table("well v1 false boxes", r, r"v3 \(yolo11n\)", "false boxes on no-well images")
    fb_v2 = x.table("well v2 false boxes", r, r"v4 \(yolo26n\)", "false boxes on no-well images")

    r = "toxoplasma-plaque-well-detector-yolo11-v4-geldoc"
    k = "toxoplasma_well_detector_v3"
    sc = "scorecard.json"
    vt = lambda what, model_, col: x.table(what, r, r"^v3_clean$", col, nth=0 if model_ == "v3" else 1)
    w3 = model(k, zoo[k]["display_name"], "v3", "yolo11n", "candidate",
               "Candidate, not promoted: clean incumbent-validation mAP50-95 regresses. (zoo note)",
               r, {"size": "73 clean validation images",
                   "objects": int(x.jpath("well_v3 n_objects", r, sc, ["n_objects"])),
                   "source": "incumbent validation images after removing exact and canonical-figure duplicates; validation data, not an independent test"},
               metrics(map50=pair(x.jpath("well_v3 mAP50", r, sc, ["mAP50", "finetuned"]), vt("well_v3 incumbent mAP50", "v3", "mAP50")),
                       map50_95=pair(x.jpath("well_v3 mAP50-95", r, sc, ["mAP50_95", "finetuned"]), vt("well_v3 incumbent mAP50-95", "v3", "mAP50-95")),
                       precision=pair(x.jpath("well_v3 precision", r, sc, ["precision", "finetuned"]), vt("well_v3 incumbent precision", "v3", "Precision")),
                       recall=pair(x.jpath("well_v3 recall", r, sc, ["recall", "finetuned"]), vt("well_v3 incumbent recall", "v3", "Recall"))),
               "previous version (well detector v1, the YOLO11n incumbent) on the same validation images",
               "On 3 Gel Doc validation plates mAP50-95 rises from 0.895 to 0.931; both models recover the expected well count on all 3.",
               [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/{sc}"])

    groups.append({"id": "wells", "title": "Plaque-well detection",
                   "motivation": (
                       "The plaque module first finds each well in a plate image or published figure and then segments plaques inside it; "
                       "the detected well also gives the diameter that makes plaque areas comparable across microscopes. "
                       f"Stock YOLO has no plaque-well class, so each detector is compared with the one before it: on 129 held-out test images v2 scores mAP50 {w2['metrics']['map50']['finetuned']:.3f} against v1's {w2['metrics']['map50']['vanilla']:.3f}, with {int(fb_v2)} false boxes on no-well images against {int(fb_v1)}."),
                   "motivation_sources": [zoo_url, rev_url("toxoplasma-plaque-well-detector-yolo26")],
                   "models": [w1, w2, w3]})

    def cc_qc(k, ver, r, test_size, quote, note):
        cmp_csv = "qc/comparison_vs_stock.csv"
        g = lambda met, col: x.row(f"{k} {met} {col}", r, cmp_csv, {"model": "best", "scope": "ALL", "metric": met}, col)
        f75 = lambda path: x.row(f"{k} f1@0.75 {path}", r, path, {"scope": "ALL", "iou": "0.75"}, "f1")
        objects = int(x.jpath(f"{k} n_true", r, "qc/best_summary.json", ["scopes", "ALL", "n_true"]))
        m = metrics(f1_50=pair(g("f1", "model_value"), g("f1", "stock")),
                    f1_75=pair(f75("qc/best_periou.csv"), f75("qc/stock_cpsam_v2_periou.csv")),
                    ap=pair(g("mAP", "model_value"), g("mAP", "stock")),
                    precision=pair(g("precision", "model_value"), g("precision", "stock")),
                    recall=pair(g("recall", "model_value"), g("recall", "stock")),
                    aji=pair(g("aji", "model_value"), g("aji", "stock")),
                    dice=pair(g("dice", "model_value"), g("dice", "stock")))
        rec = model(k, zoo[k]["display_name"], ver, "cpsam_v2", "default", quote, r,
                    {"size": test_size, "objects": objects,
                     "source": "well-grouped held-out split (no well on both sides), hosts HFF, HeLa and THP1; the split also selected the checkpoint"},
                    m, "stock cpsam_v2", note,
                    [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/{cmp_csv}", f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/qc/best_periou.csv",
                     f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/qc/stock_cpsam_v2_periou.csv"])
        rec["ap_label"] = "mAP over IoU thresholds"
        return rec

    cc1 = cc_qc("cell_from_hoechst_v1", "v1", "cross-channel-cell-from-hoechst-cpsam", "451 held-out fields",
                "only version in the zoo",
                "Precision 0.944 against recall 0.806: it misses cells rather than inventing them.")
    cc2 = cc_qc("nuclei_from_cellmask_v1", "v1", "cross-channel-nuclei-from-cellmask-cpsam", "453 held-out fields",
                "only version in the zoo",
                "Predicts nuclei from cell morphology; expect lower accuracy on unusual or highly confluent morphologies.")

    def cc_eval(k, r, row_re, best_epoch, note):
        mrow = lambda met: x.row(f"{k} {met} ft", r, "evaluation/metrics.csv", {"epoch": best_epoch, "scope": "ALL"}, met)
        tab = lambda who, col: x.table(f"{k} {col} {who}", r, row_re if who == "ft" else r"stock cpsam_v2", col)
        m = metrics(f1_50=pair(tab("ft", "F1 @ IoU 0.5"), tab("stock", "F1 @ IoU 0.5")),
                    ap=pair(mrow("mAP"), None),
                    precision=pair(mrow("precision"), None),
                    recall=pair(mrow("recall"), None),
                    aji=pair(tab("ft", "AJI"), tab("stock", "AJI")),
                    dice=pair(tab("ft", "Dice"), tab("stock", "Dice")))
        rec = model(k, zoo[k]["display_name"], "v1", "cpsam_v2", "default", "only version in the zoo", r,
                    {"size": f"{int(tab('ft', 'test'))} held-out fields", "objects": int(tab("ft", "test obj.")),
                     "source": "well-grouped held-out split (no well on both sides), hosts HFF, HeLa and THP1, fields without parasites included; the split also selected the checkpoint"},
                    m, "stock cpsam_v2", note,
                    [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/evaluation/metrics.csv"])
        rec["ap_label"] = "mAP over IoU thresholds"
        return rec

    cc3 = cc_eval("toxoplasma_from_cellmask_v1", "toxoplasma-from-cellmask-cpsam", r"this model", "100",
                  "Per host F1: HeLa 0.711, HFF 0.557, THP1 0.465.")
    cc4 = cc_eval("toxoplasma_from_hoechst_v1", "toxoplasma-from-hoechst-cpsam", r"this model", "50",
                  "The Hoechst route is harder than the cell-mask route; compare Toxoplasma from Cell Mask.")
    f = lambda rec, side: rec["metrics"]["f1_50"][side]
    groups.append({"id": "crosschannel", "title": "Cross-channel models",
                   "motivation": (
                       "Cross-channel models predict one object type from another channel's image, so a stain can be left out and its channel used for another marker: "
                       "cells from Hoechst alone, nuclei from a cell mask alone, and Toxoplasma vacuoles from either. "
                       f"Stock cpsam_v2 does not do this: on held-out fields its F1 at IoU 0.5 is {f(cc1, 'vanilla'):.3f}, {f(cc2, 'vanilla'):.3f}, {f(cc3, 'vanilla'):.3f} and {f(cc4, 'vanilla'):.3f} "
                       f"against {f(cc1, 'finetuned'):.3f}, {f(cc2, 'finetuned'):.3f}, {f(cc3, 'finetuned'):.3f} and {f(cc4, 'finetuned'):.3f} for the four trained models."),
                   "motivation_sources": [rev_url(m["repo_url"].rsplit("/", 1)[1]) for m in (cc1, cc2, cc3, cc4)],
                   "models": [cc1, cc2, cc3, cc4]})

    r = "live-cell-segmentation-cpsam"
    k = "live_cell_v1"
    mod = "qc/test_by_modality.csv"
    lrow = lambda what, col: x.row(what, r, mod, {"modality": "ALL"}, col)
    unseen_ft = x.table("live unseen ft", r, r"only datasets stock was", "this model")
    unseen_va = x.table("live unseen stock", r, r"only datasets stock was", "stock cpsam_v2")
    lc = model(k, zoo[k]["display_name"], "v1", "cpsam_v2", "default",
               "only version in the zoo; the card states it does not replace stock on LIVECell phase-contrast images",
               r, {"size": f"{int(lrow('live test fields', 'fields')):,} test fields from 14 public datasets",
                   "objects": int(lrow("live test cells", "cells")),
                   "source": "transmitted-light test split grouped by acquisition (phase contrast, brightfield, DIC)"},
               metrics(f1_50=pair(lrow("live f1 ft", "finetuned_f1"), lrow("live f1 stock", "stock_f1")),
                       ap=pair(lrow("live ap50 ft", "finetuned_ap50"), lrow("live ap50 stock", "stock_ap50"))),
               "stock cpsam_v2",
               f"On test datasets stock cpsam_v2 was not trained on, F1 {unseen_ft:.3f} against {unseen_va:.3f}; stock was trained on LIVECell and scores higher there.",
               [f"{HF}/{OWNER}/{r}/blob/{src.rev(r)}/{mod}"], public_key="live-cell-v1")
    lc["ap_label"] = "AP at IoU 0.5"
    groups.append({"id": "livecell", "title": "Live-cell segmentation",
                   "motivation": (
                       "Segments unstained cells in phase contrast, brightfield and DIC images. "
                       f"On test datasets stock cpsam_v2 was not trained on, F1 at IoU 0.5 is {unseen_ft:.3f} against {unseen_va:.3f} for stock; "
                       f"over all {lc['test']['size'].split()[0]} test fields it is {f(lc, 'finetuned'):.3f} against {f(lc, 'vanilla'):.3f}, because stock was trained on LIVECell and scores higher on it."),
                   "motivation_sources": [rev_url(r)],
                   "models": [lc]})

    k = "colony_yolo11n_makrai_v1"
    cr = "colony_detector/v1/README.md"
    dest, colony_url = src.hf("models", cr, "dataset")
    ct = lambda what, pat: x.text(what, "models", pat, kind="dataset", path=cr)
    co = model(k, zoo[k]["display_name"], "v1", "yolo11n", "alpha",
               "Colony Detector v1 (alpha) (zoo display name); listed under ALPHA_FEATURES in spacr/settings.py",
               None, {"size": f"{int(ct('colony test plates', r'\(n = (\d+)\)'))} held-out plates with 30-300 colonies", "objects": None,
                      "source": "smartphone plate photos of 24 bacterial and fungal species (Makrai et al. 2023, Scientific Data, CC BY 4.0)"},
               metrics(median_count_error_pct=pair(ct("colony median error ft", r"median count error ([\d.]+)%"),
                                                   ct("colony median error threshold", r"pipeline: ([\d.]+)% median error")),
                       plates_within_5pct=pair(ct("colony within 5%", r"(\d+)% within 5%"), None),
                       plates_within_10pct=pair(ct("colony within 10%", r"(\d+)% within 10%"), None)),
               "spaCR's classical thresholding colony counter on the same plates",
               "One dataset and one split; confluent swarming colonies remain hard.",
               [colony_url], repo_url=f"{HF}/datasets/{OWNER}/models/tree/{src.rev('models', 'dataset')}/colony_detector/v1")
    co["sources"] = [s for s in co["sources"] if s]
    groups.append({"id": "other", "title": "Other",
                   "motivation": (
                       "The colony detector (alpha) counts bacterial and fungal colonies on plate photos for colony counting. "
                       f"On {co['test']['size'].split()[0]} held-out plates with 30-300 colonies its median count error is {co['metrics']['median_count_error_pct']['finetuned']}% "
                       f"against {co['metrics']['median_count_error_pct']['vanilla']}% for spaCR's thresholding counter."),
                   "motivation_sources": [colony_url],
                   "models": [co]})
    return groups


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spacr-sha", default=None)
    ap.add_argument("--cache", default=os.environ.get("MODELS_CACHE", "/mnt/wd4tb/scratch/n687v3/models/cache"))
    a = ap.parse_args()
    sha = a.spacr_sha or nightly_sha()
    src = Sources(a.cache, sha)
    zoo_dest, zoo_url = src.gh(ZOO_PATH)
    zoo = zoo_records(zoo_dest)
    groups = build(src, zoo, zoo_url, sha)
    listed = {m["key"] for g in groups for m in g["models"]}
    missing = [k for k in zoo if k not in listed and not (k == "live_cell_v1" and "live-cell-v1" in listed)]
    if missing:
        raise SystemExit(f"zoo keys missing from models.json: {missing}")
    data = {"generated": date.today().isoformat(), "spacr_commit": sha,
            "note": "Numbers are copied from the cited sources and rounded to 3 decimals; null means the source does not record the metric. 'vanilla' holds the comparison named in baseline_label.",
            "groups": groups}
    text = json.dumps(data, indent=1, ensure_ascii=False)
    low = text.lower()
    bad = [w for w in FORBIDDEN if w in low]
    if bad:
        raise SystemExit(f"refusing to write: protected words {bad}")
    if "/mnt/" in text or "/home/" in text:
        raise SystemExit("refusing to write: local path in output")
    if len(text.encode()) >= 60000:
        raise SystemExit(f"models.json is {len(text.encode())} bytes, over 60 kB")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    with open(RUN_RECORD, "w", encoding="utf-8") as fh:
        json.dump({"generated": data["generated"], "spacr_commit": sha,
                   "hf_revisions": {f"{k[1]}:{OWNER}/{k[0]}": v for k, v in sorted(src.revs.items())},
                   "numbers": RECORD}, fh, indent=1, ensure_ascii=False, default=str)
        fh.write("\n")
    print(f"wrote {OUT} ({len(text.encode())} bytes), {len(RECORD)} sourced numbers")


if __name__ == "__main__":
    main()
