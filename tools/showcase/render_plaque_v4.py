"""Render the toxoplasma_plaque_v4 plaque showcase from run_plaque_v4.py's mask and record.

(a) Showcase layers exactly as run_plaque_public.py + caption_plaque_public.py made them for v3:
    plaque-raw.webp (re-made with the same settings, kept only if identical to the published base),
    plaque-v4-plaque.webp (2 px magenta outline layer), plaque-v4-figure.webp (base + outlines +
    caption strip).
(b) Themed assay pair plaque.dark.webp / plaque.light.webp with tools/themed/make_plaque.py's logic
    (thin anti-aliased magenta outlines, theme ground outside the well).
(c) figure.json: the showcase.json "plaque" entry for v4, plus an assay caption line.

Usage: /home/olafsson/anaconda3/envs/spacr/bin/python -I render_plaque_v4.py
"""
import hashlib, io, json, sys
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from skimage.measure import find_contours
from skimage.morphology import dilation, square
from skimage.segmentation import find_boundaries

sys.path.insert(0, "/mnt/firecuda2/Claude/scratch/site-v3/tools/themed")
from theme import THEMES, hex_rgb, write_webp, ground_check

OUT = Path("/mnt/wd4tb/scratch/n687v3/plaque_v4")
PREV = Path("/mnt/wd4tb/scratch/n687/models/out_public")
SITE_RAW = Path("/mnt/firecuda2/Claude/scratch/site-v3/src/assets/img/models/plaque-raw.webp")
REC = json.load(open(OUT / "run_record_plaque_v4.json"))
NAME = REC["name"]
SNAP = Path("/home/olafsson/.cache/huggingface/hub/datasets--einarolafsson--toxoplasma-plaque-dataset/"
            "snapshots/" + REC["dataset_revision"])
MAGENTA = "#FF00FF"

img = tifffile.imread(SNAP / "images" / f"{NAME}.tif")
img = img if img.ndim == 2 else img[..., 0]
masks = tifffile.imread(OUT / "plaque_v4.tif")
labels = [v for v in np.unique(masks) if v]
count = len(labels)
run = REC["runs"]["v4_documented"]
assert count == run["count"], (count, run["count"])
assert masks.shape == img.shape


def stretch(a):
    lo, hi = np.percentile(a, [1, 99.8])
    return (np.clip((a.astype(np.float32) - lo) / max(hi - lo, 1e-9), 0, 1) * 255).astype(np.uint8)


def scale_for(shape):
    return min(1.0, 1024 / max(shape))


def outline_layer(m, size, colour):
    lab = np.asarray(Image.fromarray(m.astype(np.int32)).resize(size, Image.NEAREST))
    b = dilation(find_boundaries(lab, mode="inner"), square(2))
    rgba = np.zeros((size[1], size[0], 4), np.uint8)
    rgba[b] = (*hex_rgb(colour), 255)
    return Image.fromarray(rgba, "RGBA")


def save_webp_under(im, path, limit, q0=80, **kw):
    q = q0
    while True:
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=q, method=6, **kw)
        if buf.tell() <= limit or q <= 30:
            break
        q -= 5
    path.write_bytes(buf.getvalue())
    return q, buf.tell()


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


raw = stretch(img)
s = scale_for(raw.shape)
size = (round(raw.shape[1] * s), round(raw.shape[0] * s))
base = Image.fromarray(raw).resize(size, Image.LANCZOS).convert("RGB")
save_webp_under(base, OUT / "plaque-raw.webp", 120_000)
raw_identical = {"previous_out_public": sha(OUT / "plaque-raw.webp") == sha(PREV / "plaque-raw.webp"),
                 "site_asset": SITE_RAW.exists() and sha(OUT / "plaque-raw.webp") == sha(SITE_RAW)}
print("raw identical", raw_identical)

layer = outline_layer(masks, size, MAGENTA)
layer.save(OUT / "plaque-v4-plaque.webp", "WEBP", lossless=True, method=6)

f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
fig = base.copy().convert("RGBA")
fig.alpha_composite(Image.open(OUT / "plaque-v4-plaque.webp").convert("RGBA"))
W, H = fig.size
lines = [
    "Input: crystal-violet plaque well, greyscale | toxoplasma-plaque-dataset, held out from v4 training (test split)",
    "Source: Cabral G et al. 2024, Microbiol Spectrum, doi:10.1128/spectrum.01229-24, Fig. 2 | licence: CC BY 4.0",
    f"plaque: n={count}  Toxoplasma Plaque v4 [toxoplasma_plaque_v4], alternative  sha256 {REC['sha256'][:12]}",
]
pad, lh = 8, 21
meas = ImageDraw.Draw(Image.new("RGB", (1, 1)))
rows = []
for t in lines:
    cur = ""
    for wd in t.split(" "):
        trial = (cur + " " + wd).strip()
        if meas.textlength(trial, font=f) > W - 2 * pad - 20 and cur:
            rows.append(cur); cur = wd
        else:
            cur = trial
    rows.append(cur)
canvas = Image.new("RGB", (W, H + 2 * pad + lh * len(rows)), (18, 18, 18))
canvas.paste(fig.convert("RGB"), (0, 0))
d = ImageDraw.Draw(canvas)
y = H + pad
for t in rows:
    if t.startswith("plaque:"):
        d.rectangle([pad, y + 4, pad + 12, y + 16], fill=MAGENTA)
        d.text((pad + 20, y), t, fill=(235, 235, 235), font=f)
    else:
        d.text((pad, y), t, fill=(235, 235, 235), font=f)
    y += lh
canvas.save(OUT / "plaque-v4-figure.webp", "WEBP", quality=82, method=6)

WIDTH, LINE_PX, SS = 1024, 1.8, 4
lo, hi = np.percentile(img, [1, 99.8])
grey = np.clip((img.astype(np.float32) - lo) / max(hi - lo, 1e-9), 0, 1)
page = img >= 250
seeds = np.zeros_like(page)
seeds[0, :] = seeds[-1, :] = seeds[:, 0] = seeds[:, -1] = True
lab, _ = ndi.label(page)
outside_ids = np.unique(lab[seeds & page])
inside = ndi.binary_fill_holes(~np.isin(lab, outside_ids[outside_ids > 0]))
edge = inside & ~ndi.binary_erosion(inside)
ey, ex = np.nonzero(edge)
A = np.c_[2 * ex, 2 * ey, np.ones(len(ex))]
cx, cy, c0 = np.linalg.lstsq(A, ex ** 2 + ey ** 2, rcond=None)[0]
r_fit = float(np.sqrt(c0 + cx ** 2 + cy ** 2))
yy, xx = np.mgrid[:img.shape[0], :img.shape[1]]
rr = np.hypot(xx - cx, yy - cy)
radii = np.arange(int(r_fit * 0.85), int(r_fit) + 1)
profile = np.array([np.median(img[(rr >= r) & (rr < r + 1)]) for r in radii])
dark_enough = radii[profile < 200]
r_well = float(dark_enough.max()) if len(dark_enough) else r_fit

Hn, Wn = img.shape
tscale = WIDTH / Wn
tsize = (WIDTH, round(Hn * tscale))
big = (tsize[0] * SS, tsize[1] * SS)
line = Image.new("L", big, 0)
dl = ImageDraw.Draw(line)
for v in labels:
    m = np.pad(masks == v, 1)
    for c in find_contours(m.astype(np.float32), 0.5):
        pts = [((x - 1 + 0.5) * tscale * SS, (y - 1 + 0.5) * tscale * SS) for y, x in c]
        dl.line(pts + [pts[0]], fill=255, width=round(LINE_PX * SS), joint="curve")
line = line.resize(tsize, Image.LANCZOS)
oy, ox = np.mgrid[:tsize[1], :tsize[0]]
dist = np.hypot((ox + 0.5) / tscale - cx, (oy + 0.5) / tscale - cy) * tscale
alpha_well = np.clip(r_well * tscale - dist + 0.5, 0, 1).astype(np.float32)
g = np.asarray(Image.fromarray((grey * 255).astype(np.uint8)).resize(tsize, Image.LANCZOS)).astype(np.float32)
a_line = np.asarray(line).astype(np.float32)[..., None] / 255
themed = {}
for theme, t in THEMES.items():
    bg = np.array(hex_rgb(t["bg"]), np.float32)
    rgb = g[..., None] * alpha_well[..., None] + bg * (1 - alpha_well[..., None])
    rgb = rgb * (1 - a_line) + np.array(hex_rgb(MAGENTA), np.float32) * a_line
    im = Image.fromarray(np.clip(np.round(rgb), 0, 255).astype(np.uint8))
    info = write_webp(im, OUT / f"plaque.{theme}.webp", max_kb=99)
    info.update(ground_check(OUT / f"plaque.{theme}.webp", theme))
    themed[theme] = info
    print(theme, info)

v3 = REC["runs"]["v3_documented"]
gtn = REC["reference_count"]
note = (f"An alternative plaque model in the zoo, not the default (toxoplasma_plaque_v3 is the default). "
        f"Card test set: F1 {REC['card_test_metric']['f1']} on 263 held-out fields (v3 {REC['card_test_metric']['v3_f1_same_fields']}). "
        f"{gtn} plaques in the hand-drawn mask; F1 {run['f1_at_iou_0_5']} at IoU 0.5 on this well")
figure = {
    "id": "plaque",
    "title": "Plaque assay: Toxoplasma plaques",
    "input_label": "Well",
    "text": "A crystal-violet plaque-assay well from a published figure. Plaques are segmented by spaCR's plaque model. This well was not used to train the model.",
    "base": "plaque-raw.webp",
    "alt": "Greyscale image of a crystal-violet stained well with pale plaques in a dark monolayer",
    "width": size[0],
    "height": size[1],
    "classes": [{
        "name": "Plaques", "color": MAGENTA, "count": count, "layer": "plaque-v4-plaque.webp",
        "model": {"display": "toxoplasma_plaque_v4 (round 6, cpsam_v2)",
                  "url": "https://huggingface.co/einarolafsson/toxoplasma-plaque-segmentation-cpsam-r6",
                  "note": note},
    }],
    "facts": [
        ["Input", "Crystal violet, greyscale"],
        ["Image", "Cabral G, et al. Microbiol Spectrum 2024, Fig. 2", "https://doi.org/10.1128/spectrum.01229-24"],
        ["Dataset", "toxoplasma-plaque-dataset (held out from v4 training)",
         "https://huggingface.co/datasets/einarolafsson/toxoplasma-plaque-dataset"],
        ["Licence", "CC BY 4.0"],
        ["Figure", "With caption and checksums", "/assets/img/models/plaque-v4-figure.webp"],
    ],
}
caption = (f"toxoplasma_plaque_v4 found {count} plaques against {gtn} hand-drawn "
           f"(TP {run['tp']}, FP {run['fp']}, FN {run['fn']}; F1 {run['f1_at_iou_0_5']} at IoU 0.5) "
           f"on a held-out CC BY 4.0 well (Cabral et al. 2024); v3, the default, scores F1 {v3['f1_at_iou_0_5']} "
           f"({v3['count']} plaques) on the same well with the same call.")
json.dump({"figure": figure, "assay_caption": caption,
           "evidence": {"zoo_default": REC["zoo_default_plaque_model"], "runs": REC["runs"]}},
          open(OUT / "figure.json", "w"), indent=1)

REC["render"] = {"raw_identical": raw_identical, "showcase_size": list(size), "themed_size": list(tsize),
                 "themed": themed, "well_circle_native_px": [round(float(cx), 1), round(float(cy), 1), r_well],
                 "line_px": LINE_PX,
                 "files": {p.name: {"bytes": p.stat().st_size, "sha256": sha(p)} for p in sorted(OUT.glob("*.webp"))}}
json.dump(REC, open(OUT / "run_record_plaque_v4.json", "w"), indent=1)
print(caption)
