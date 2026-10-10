"""Render raw/outline/figure WebPs and showcase.json from data/masks/*.tif + runs.json."""
import io, json, os, re, shutil, subprocess
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFont
from skimage.segmentation import find_boundaries
from skimage.morphology import dilation, square

ROOT = Path("/mnt/wd4tb/scratch/n687/models")
OUT = ROOT / "out"
OUT.mkdir(exist_ok=True)
runs = json.load(open(ROOT / "data/masks/runs.json"))

import sys
sys.path.insert(0, "/mnt/wd4tb/spacr-worktrees/claude-n687-20261010")
from spacr import model_zoo as mz

ZOO = {d["key"]: d for d in mz.BUNDLED_REMOTE_MODELS}
COLOURS = {"nuclei": "#3B82F6", "cell": "#00CEC8", "toxoplasma": "#FF00FF", "plaque": "#FF00FF"}
ORDER = {"hoechst": ["nuclei", "cell", "toxoplasma"], "cellmask": ["toxoplasma", "nuclei", "cell"],
         "plaque": ["plaque"]}
FIELD = "MTOC_Screen__mtocScreen_20250530_111302__plate1_L08_12_1"
STOCK_SHA = {}

SOURCES = {
    "hoechst": dict(dataset_repo="einarolafsson/cross-channel-cell-from-hoechst",
                    file_path=f"images/{FIELD}.tif", split="test (well-grouped held-out split, split_by_well.csv)",
                    host_cell_line="HeLa", licence="CC BY 4.0 (dataset card)", channel="Hoechst (nuclear stain)",
                    also_in="einarolafsson/cross-channel-nuclei-from-cellmask (test), "
                            "einarolafsson/cross-channel-toxoplasma-from-cellmask (test)",
                    screen="MTOC_Screen / mtocScreen_20250530_111302 / plate1 well L08, field 12"),
    "cellmask": dict(dataset_repo="einarolafsson/cross-channel-toxoplasma-from-cellmask",
                     file_path=f"images/{FIELD}.tif", split="test (well-grouped held-out split, split_by_well.csv)",
                     host_cell_line="HeLa", licence="CC BY 4.0 (dataset card)",
                     channel="cell mask (whole-cell stain)",
                     also_in="einarolafsson/cross-channel-nuclei-from-cellmask images/ (byte-identical array)",
                     screen="MTOC_Screen / mtocScreen_20250530_111302 / plate1 well L08, field 12"),
    "plaque": dict(dataset_repo="none -- not published on Hugging Face (the model card states the raw "
                                "training/evaluation images are not published)",
                   file_path="/mnt/wd4tb/af3/projects/automated_plaque_assay/curation/gel_doc_2026-10-05/"
                             "gel__GRA8__ReimagedPlate1__w00.png",
                   split="Gel Doc held-out group GRA8__Plate1 (geldoc_heldout_min_size_0, version 20261007T205603)",
                   host_cell_line="not recorded with the image (crystal-violet Toxoplasma plaque assay on a host monolayer)",
                   licence="unpublished in-house data (maintainer's lab); no public licence -- confirm before web use",
                   channel="crystal violet, Bio-Rad Gel Doc greyscale", screen="GRA8 ReimagedPlate1 well w00"),
}
DISPLAY_STOCK = "stock Cellpose-SAM (cpsam_v2, env default), same channel"


def stretch(a):
    lo, hi = np.percentile(a, [1, 99.8])
    return (np.clip((a.astype(np.float32) - lo) / max(hi - lo, 1e-9), 0, 1) * 255).astype(np.uint8)


def load_raw(path):
    path = Path(path)
    return tifffile.imread(path) if path.suffix == ".tif" else np.asarray(Image.open(path))


def scale_for(shape):
    return min(1.0, 1024 / max(shape))


def outline_layer(masks, size, colour):
    """Boundaries computed at full resolution on the label image, resized with nearest neighbour,
    then thickened to 2 px at output size."""
    labels = Image.fromarray(masks.astype(np.int32)).resize(size, Image.NEAREST)
    lab = np.asarray(labels)
    b = find_boundaries(lab, mode="inner")
    b = dilation(b, square(2))
    rgba = np.zeros((size[1], size[0], 4), np.uint8)
    rgb = tuple(int(colour[i:i + 2], 16) for i in (1, 3, 5))
    rgba[b] = (*rgb, 255)
    return Image.fromarray(rgba, "RGBA")


def save_webp_under(img, path, limit, q0=80, **kw):
    q = q0
    while True:
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=6, **kw)
        if buf.tell() <= limit or q <= 30:
            break
        q -= 5
    path.write_bytes(buf.getvalue())
    return q, buf.tell()


REF = {
    ("hoechst", "nuclei"): ("cross-channel-nuclei-from-cellmask", "masks"),
    ("cellmask", "nuclei"): ("cross-channel-nuclei-from-cellmask", "masks"),
    ("hoechst", "cell"): ("cross-channel-cell-from-hoechst", "masks"),
    ("cellmask", "cell"): ("cross-channel-cell-from-hoechst", "masks"),
    ("hoechst", "toxoplasma"): ("cross-channel-toxoplasma-from-cellmask", "masks_pv"),
    ("cellmask", "toxoplasma"): ("cross-channel-toxoplasma-from-cellmask", "masks_pv"),
}


def reference(inp, c, pred):
    from cellpose.metrics import average_precision
    if inp == "plaque":
        seg = np.load("/mnt/wd4tb/af3/projects/automated_plaque_assay/curation/gel_doc_2026-10-05/"
                      "gel__GRA8__ReimagedPlate1__w00_seg.npy", allow_pickle=True).item()
        gt = np.asarray(seg["masks"]); src = "curated Gel Doc mask gel__GRA8__ReimagedPlate1__w00_seg.npy"
    else:
        repo, sub = REF[(inp, c)]
        gt = tifffile.imread(next((Path.home() / ".cache/huggingface/hub" / f"datasets--einarolafsson--{repo}"
                                   / "snapshots").glob(f"*/{sub}/{FIELD}.tif")))
        src = f"einarolafsson/{repo} {sub}/{FIELD}.tif"
    ap, tp, fp, fn = average_precision([gt.astype(np.int32)], [pred.astype(np.int32)], threshold=[0.5])
    tp, fp, fn = int(tp[0, 0]), int(fp[0, 0]), int(fn[0, 0])
    return dict(reference_masks=src, reference_count=int(len(np.unique(gt)) - 1), tp=tp, fp=fp, fn=fn,
                f1_at_iou_0_5=round(2 * tp / max(2 * tp + fp + fn, 1), 3),
                note="single-field sanity check against the dataset's reference masks, not a benchmark")


def font(sz):
    for p in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def model_label(r):
    if r["key"].startswith("stock:"):
        return DISPLAY_STOCK
    z = ZOO[r["key"]]
    return f"{z['display_name']} [{r['key']}]"


def metric_for(key):
    if key.startswith("stock:"):
        return None
    z = ZOO[key]
    m = z.get("metrics") or {}
    f1 = m.get("f1")
    if isinstance(f1, dict):
        f1 = f1.get("finetuned")
    return dict(f1=f1, test_set=m.get("n_test") or m.get("holdout"),
                holdout=m.get("holdout"), versus_stock=z.get("versus_stock"),
                note=None if m else "model_zoo.py carries no metrics dict for this entry; F1 is in versus_stock")


showcase = {"generated": "2026-10-10", "item": "N687", "device": "CPU (CUDA_VISIBLE_DEVICES='')",
            "cellpose": None, "inputs": {}}
from importlib.metadata import version
showcase["cellpose"] = version("cellpose")

for inp, classes in ORDER.items():
    rs = {c: runs[f"{inp}-{c}"] for c in classes if f"{inp}-{c}" in runs}
    if not rs:
        continue
    raw = load_raw(next(iter(rs.values()))["image"])
    s = scale_for(raw.shape)
    size = (round(raw.shape[1] * s), round(raw.shape[0] * s))
    g = Image.fromarray(stretch(raw)).resize(size, Image.LANCZOS) if s < 1 else Image.fromarray(stretch(raw))
    q, nb = save_webp_under(g, OUT / f"{inp}-raw.webp", 120_000)
    print(inp, "raw", size, q, nb)
    comp = g.convert("RGBA")
    entry = dict(source=SOURCES[inp], channel=SOURCES[inp]["channel"],
                 native_size_px=[int(raw.shape[1]), int(raw.shape[0])], image_size_px=list(size),
                 scale=round(s, 4), scale_note=f"output px = native px x {round(s, 4)}",
                 raw_stretch="1st-99.8th percentile, grayscale", classes=[])
    for c, r in rs.items():
        masks = tifffile.imread(ROOT / f"data/masks/{inp}-{c}.tif")
        layer = outline_layer(masks, size, COLOURS[c])
        layer.save(OUT / f"{inp}-{c}.webp", "WEBP", lossless=True, method=6)
        comp = Image.alpha_composite(comp, layer)
        stock = r["key"].startswith("stock:")
        z = None if stock else ZOO[r["key"]]
        entry["classes"].append(dict(
            **{"class": c}, count=r["count"], colour=COLOURS[c],
            model_key=None if stock else r["key"],
            display_name=DISPLAY_STOCK if stock else z["display_name"],
            repo_id="cellpose built-in model cpsam_v2 (cellpose 4.2.1.1 default; ~/.cellpose/models/cpsam_v2)" if stock else z["repo_id"],
            hf_url="https://github.com/MouseLand/cellpose" if stock else f"https://huggingface.co/{z['repo_id']}",
            weights_file=Path(r["weights"]).name, sha256_12=r["sha256"][:12], sha256=r["sha256"],
            zoo_sha256_match=None if stock else (r["sha256"] == z["sha256"].lower()),
            settings=dict({"diameter": None}, **r["settings"], channels="single grayscale channel, 2-D input",
                          input_dtype="float32 of raw uint16/uint8 values; cellpose percentile normalisation"),
            runtime_s=r["seconds"], device="cpu, 16 torch threads",
            kind="stock Cellpose-SAM" if stock else ("spaCR plaque" if inp == "plaque" else "spaCR cross-channel"),
            zoo_metric=metric_for(r["key"]), this_field_vs_reference=reference(inp, c, masks)))
    showcase["inputs"][inp] = entry

    W, H = size
    f = font(max(11, round(W / 85)))
    lines = []
    src = SOURCES[inp]
    lines.append(f"Input: {src['channel']} | {Path(src['file_path']).name} ("
                 + (f"{src['host_cell_line']}, held-out test split" if inp != "plaque" else "Gel Doc held-out group") + ")")
    lines.append(f"Source: {src['dataset_repo'] if inp != 'plaque' else 'spaCR Gel Doc curation (unpublished)'}"
                 f" | licence: {src['licence'].split(' (')[0].split(';')[0]}")
    for c, r in rs.items():
        lines.append(f"■ {c}: n={r['count']}  {model_label(r)}  sha256 {r['sha256'][:12]}")
    pad = round(f.size * 0.5)
    lh = round(f.size * 1.35)
    meas = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    rows = []
    for t in lines:
        swatch = None
        if t.startswith("\u25A0"):
            swatch = t.split(":")[0][2:]
            t = t[2:]
        indent = round(f.size * 1.2) if swatch else 0
        words, cur, first = t.split(" "), "", True
        for w in words:
            trial = (cur + " " + w).strip()
            if meas.textlength(trial, font=f) > W - 2 * pad - indent and cur:
                rows.append((swatch if first else None, indent, cur)); cur, first = w, False
            else:
                cur = trial
        rows.append((swatch if first else None, indent, cur))
    strip_h = pad * 2 + lh * len(rows)
    canvas = Image.new("RGB", (W, H + strip_h), (18, 18, 18))
    canvas.paste(comp.convert("RGB"), (0, 0))
    d = ImageDraw.Draw(canvas)
    y = H + pad
    for swatch, indent, t in rows:
        if swatch:
            d.rectangle([pad, y + lh * 0.2, pad + f.size * 0.8, y + lh * 0.2 + f.size * 0.8], fill=COLOURS[swatch])
        d.text((pad + indent, y), t, fill=(235, 235, 235), font=f)
        y += lh
    q, nb = save_webp_under(canvas, OUT / f"{inp}-figure.webp", 200_000, q0=85)
    print(inp, "figure", canvas.size, q, nb)

json.dump(showcase, open(OUT / "showcase.json", "w"), indent=1)

if shutil.which("ffmpeg") or True:
    try:
        import pillow_avif  # noqa: F401
    except Exception:
        pass
    for p in sorted(list(OUT.glob("*-raw.webp")) + list(OUT.glob("*-figure.webp"))):
        try:
            Image.open(p).save(p.with_suffix(".avif"), "AVIF", quality=60)
        except Exception as e:
            print("avif skipped:", e)
            break
