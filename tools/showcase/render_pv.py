"""Render pv-raw.webp, pv-vacuole.webp, pv-figure.webp and figure.json for the showcase "pv" figure.

Same display rules as render.py / run_plaque_public.py / caption_plaque_public.py: 1st-99.8th percentile
greyscale stretch, longest side 1024 px (LANCZOS), outlines found at full resolution on the label image
resized with nearest neighbour and thickened to 2 px, magenta #FF00FF, caption strip in DejaVu Sans 15 px
on #121212. Reads run_record_pv.json written by run_pv.py.

Command (run after run_pv.py; -I because it reads the downloaded image):
    CUDA_VISIBLE_DEVICES='' /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G \
        /home/olafsson/anaconda3/envs/spacr/bin/python -I \
        /mnt/firecuda2/Claude/scratch/site-v3/tools/showcase/render_pv.py
"""
import io, json
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFont
from skimage.morphology import dilation
from skimage.segmentation import find_boundaries

HERE = Path(__file__).resolve().parent
OUT = Path("/mnt/wd4tb/scratch/n687v3/pv/out")
OUT.mkdir(parents=True, exist_ok=True)
COLOUR = "#FF00FF"
rec = json.load(open(HERE / "run_record_pv.json"))


def stretch(a):
    lo, hi = np.percentile(a, [1, 99.8])
    return (np.clip((a.astype(np.float32) - lo) / max(hi - lo, 1e-9), 0, 1) * 255).astype(np.uint8)


def outline_layer(masks, size, colour):
    lab = np.asarray(Image.fromarray(masks.astype(np.int32)).resize(size, Image.NEAREST))
    b = dilation(find_boundaries(lab, mode="inner"), np.ones((2, 2), bool))
    rgba = np.zeros((size[1], size[0], 4), np.uint8)
    rgba[b] = (*(int(colour[i:i + 2], 16) for i in (1, 3, 5)), 255)
    return Image.fromarray(rgba, "RGBA")


def save_webp_under(img, path, limit, q0=80):
    q = q0
    while True:
        buf = io.BytesIO()
        img.save(buf, "WEBP", quality=q, method=6)
        if buf.tell() <= limit or q <= 30:
            break
        q -= 5
    path.write_bytes(buf.getvalue())
    return q, buf.tell()


img = tifffile.imread(Path("/mnt/wd4tb/scratch/n687v3/pv/dl") / rec["image"]["file"])
masks = tifffile.imread(rec["masks_tif"])
raw = stretch(img)
s = min(1.0, 1024 / max(raw.shape))
size = (round(raw.shape[1] * s), round(raw.shape[0] * s))
base = Image.fromarray(raw).resize(size, Image.LANCZOS).convert("RGB")
q_raw, nb_raw = save_webp_under(base, OUT / "pv-raw.webp", 120_000)
layer = outline_layer(masks, size, COLOUR)
layer.save(OUT / "pv-vacuole.webp", "WEBP", lossless=True, method=6)
comp = base.convert("RGBA")
comp.alpha_composite(layer)

m, c, im = rec["model"], rec["comparison"], rec["image"]
n, n_gt = rec["counts"]["predicted"], rec["counts"]["ground_truth"]
W, H = size
f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
lines = [
    f"Input: Toxoplasma fluorescence channel, greyscale | {im['stem']}.tif, held-out test split (anchor well)",
    f"Source: {im['dataset']} | licence: CC BY 4.0",
    f"vacuoles: n={n}  {m['display_name']} [{m['key']}]  sha256 {m['sha256'][:12]}",
    f"Hand-curated mask: n={n_gt} | F1 {c['f1_at_iou_0_5']:.3f} at IoU 0.5 ({c['tp']} matched, {c['fp']} extra, "
    f"{c['fn']} missed)",
]
pad, lh = 8, 21
meas = ImageDraw.Draw(Image.new("RGB", (1, 1)))
rows = []
for t in lines:
    cur = ""
    for w in t.split(" "):
        trial = (cur + " " + w).strip()
        if meas.textlength(trial, font=f) > W - 2 * pad - 20 and cur:
            rows.append(cur)
            cur = w
        else:
            cur = trial
    rows.append(cur)
canvas = Image.new("RGB", (W, H + 2 * pad + lh * len(rows)), (18, 18, 18))
canvas.paste(comp.convert("RGB"), (0, 0))
d = ImageDraw.Draw(canvas)
y = H + pad
for t in rows:
    if t.startswith("vacuoles:"):
        d.rectangle([pad, y + 4, pad + 12, y + 16], fill=COLOUR)
        d.text((pad + 20, y), t, fill=(235, 235, 235), font=f)
    else:
        d.text((pad, y), t, fill=(235, 235, 235), font=f)
    y += lh
q_fig, nb_fig = save_webp_under(canvas, OUT / "pv-figure.webp", 200_000, q0=82)

h, w = img.shape
figure = {
    "id": "pv",
    "title": "Toxoplasma vacuoles: parasitophorous vacuole segmentation",
    "input_label": "Toxoplasma",
    "text": ("One fluorescence image of the Toxoplasma channel from an infected host-cell monolayer. "
             "Parasitophorous vacuoles are segmented by spaCR's PV model. This well is in the dataset's "
             "held-out test split and was not used to train the model."),
    "base": "pv-raw.webp",
    "alt": "Greyscale fluorescence image with bright, rounded Toxoplasma vacuoles scattered over faint host cells",
    "width": W,
    "height": H,
    "classes": [{
        "name": "Vacuoles",
        "color": COLOUR,
        "count": n,
        "layer": "pv-vacuole.webp",
        "model": {
            "display": "toxoplasma_pv_v4 (round 7)",
            "url": m["url"],
            "note": (f"Test F1 0.854 on 11 held-out wells (model card). {n_gt} vacuoles in the hand-curated "
                     f"mask; F1 {c['f1_at_iou_0_5']:.3f} at IoU 0.5 on this well"),
        },
    }],
    "facts": [
        ["Input", "Toxoplasma fluorescence channel, greyscale"],
        ["Image", f"Anchor well {im['stem']}, test split (held out from training)", im["dataset_url"]],
        ["Licence", "CC BY 4.0"],
        ["Size", f"{w} × {h} px, shown at {max(W, H)} px"],
        ["Figure", "With caption and checksums", "/assets/img/models/pv-figure.webp"],
    ],
}
json.dump(figure, open(OUT / "figure.json", "w"), indent=1, ensure_ascii=False)
rec["render"] = dict(out_dir=str(OUT), size=[W, H], scale=round(s, 4), raw_stretch="1st-99.8th percentile, grayscale",
                     raw_webp=dict(quality=q_raw, bytes=nb_raw), figure_webp=dict(quality=q_fig, bytes=nb_fig,
                     size=list(canvas.size)), layer_webp=dict(lossless=True, bytes=(OUT / "pv-vacuole.webp").stat().st_size))
json.dump(rec, open(HERE / "run_record_pv.json", "w"), indent=1)
print(json.dumps(rec["render"], indent=1))
