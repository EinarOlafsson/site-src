"""Plaque well, dark and light: the saved toxoplasma_plaque_v3 mask outlined on the well image.

No model run: the mask written by tools/showcase/run_plaque_public.py
(out_public/plaque.tif, 99 labels) is reused and its count re-checked. The
area outside the well (white page of the source figure) becomes the theme
ground; plaque outlines are drawn as thin anti-aliased magenta contours
(4x supersampled), about 1 px at a 560 px display width. No caption strip.

Usage: tools/themed/env.sh make_plaque.py
"""
import json
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.measure import find_contours

from theme import THEMES, OUT, WORK, hex_rgb, write_webp, ground_check

NAME = 'literature__PMC11448412__spectrum.01229-24.f002.jpg__p19__w00'
SNAP = Path('/home/olafsson/.cache/huggingface/hub/datasets--einarolafsson--toxoplasma-plaque-dataset/'
            'snapshots/7af596eae241d1ffa427243fa5343fd5b33fd42a')
MASK = Path('/mnt/wd4tb/scratch/n687/models/out_public/plaque.tif')
RECORD = Path('/mnt/wd4tb/scratch/n687/models/out_public/plaque_public.json')
MAGENTA = '#FF00FF'
WIDTH = 1024
LINE_PX = 1.8
SS = 4

img = tifffile.imread(SNAP / 'images' / f'{NAME}.tif')
img = img if img.ndim == 2 else img[..., 0]
masks = tifffile.imread(MASK)
labels = [v for v in np.unique(masks) if v]
count = len(labels)
assert count == 99, count
assert masks.shape == img.shape, (masks.shape, img.shape)

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
print('well circle', round(cx, 1), round(cy, 1), 'fit r', round(r_fit, 1), 'used r', r_well)

H, W = img.shape
scale = WIDTH / W
size = (WIDTH, round(H * scale))
big = (size[0] * SS, size[1] * SS)

contours = []
for v in labels:
    m = np.pad(masks == v, 1)
    for c in find_contours(m.astype(np.float32), 0.5):
        pts = [((x - 1 + 0.5) * scale * SS, (y - 1 + 0.5) * scale * SS) for y, x in c]
        contours.append(pts)

line = Image.new('L', big, 0)
d = ImageDraw.Draw(line)
for pts in contours:
    d.line(pts + [pts[0]], fill=255, width=round(LINE_PX * SS), joint='curve')
line = line.resize(size, Image.LANCZOS)

oy, ox = np.mgrid[:size[1], :size[0]]
dist = np.hypot((ox + 0.5) / scale - cx, (oy + 0.5) / scale - cy) * scale
alpha_well = np.clip(r_well * scale - dist + 0.5, 0, 1).astype(np.float32)
g = np.asarray(Image.fromarray((grey * 255).astype(np.uint8)).resize(size, Image.LANCZOS)).astype(np.float32)
a_line = np.asarray(line).astype(np.float32)[..., None] / 255

results = {}
for theme, t in THEMES.items():
    bg = np.array(hex_rgb(t['bg']), np.float32)
    rgb = g[..., None] * alpha_well[..., None] + bg * (1 - alpha_well[..., None])
    rgb = rgb * (1 - a_line) + np.array(hex_rgb(MAGENTA), np.float32) * a_line
    rgb = np.clip(np.round(rgb), 0, 255).astype(np.uint8)
    im = Image.fromarray(rgb)
    info = write_webp(im, OUT / f'plaque.{theme}.webp', max_kb=99)
    info.update(ground_check(OUT / f'plaque.{theme}.webp', theme))
    results[theme] = info
    print(theme, info)

rec = json.load(open(RECORD))
json.dump({'count_in_saved_mask': count, 'record_count': rec['count'], 'reference_count': rec['reference_count'],
           'tp': rec['tp'], 'fp': rec['fp'], 'fn': rec['fn'], 'f1_at_iou_0_5': rec['f1_at_iou_0_5'],
           'model_key': rec['model_key'], 'weights_sha256': rec['sha256'], 'mask': str(MASK),
           'image': f"einarolafsson/toxoplasma-plaque-dataset images/{NAME}.tif",
           'native_px': [W, H], 'well_circle_native_px': [round(float(cx), 1), round(float(cy), 1), r_well], 'size': list(size), 'line_px': LINE_PX, 'outline_colour': MAGENTA,
           'webp': results}, open(WORK / 'plaque_numbers.json', 'w'), indent=1)
