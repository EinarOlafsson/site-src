"""Render the McFadden et al. 2025 card illustration from ycam_segment_track.py output.

Not a figure from the paper (CC BY-NC-ND): an illustration made with spaCR from
Zenodo 10.5281/zenodo.4501412 (Mahlandt, Arts & Goedhart 2021, CC BY 4.0),
Yellow Cameleon 3.60 calcium time-lapse, histamine then pyrilamine.

Shows: YFP/CFP ratio image of one frame (warm = high calcium), Cellpose outlines
coloured by spaCR track id, short centroid trails, and an inset with the
per-cell ratio trace over the whole movie.

Usage: python ycam_render_thumb.py <work dir> <out.webp> [FRAME]
"""
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib import colormaps
from PIL import Image
from scipy import ndimage as ndi
from skimage.segmentation import find_boundaries

work, out = sys.argv[1], sys.argv[2]
FRAME = int(sys.argv[3]) if len(sys.argv) > 3 else 46
W, H = 480, 320
BG = np.array([12, 14, 18]) / 255.0
X0, Y0, CW, CH = 70, 52, 612, 408
TRACK_COLORS = {1: "#5ad1ff", 2: "#8cf08c", 3: "#ff7ad9", 4: "#c9a8ff"}
RATIO_LO, RATIO_HI = 8.0, 26.0
HIS_FRAME, PYR_FRAME = 14, 86

Y = np.load(os.path.join(work, "Y.npy"))
C = np.load(os.path.join(work, "C.npy"))
masks = np.load(os.path.join(work, "masks.npy"))
seg = np.load(os.path.join(work, "seg_frames.npy"))
tracks = pd.read_csv(os.path.join(work, "tracks.csv"))
ratios = pd.read_csv(os.path.join(work, "ratios.csv"))
bgY, bgC = float(np.percentile(Y, 5)), float(np.percentile(C, 5))

k = int(np.argmin(np.abs(seg - FRAME)))
lab = masks[k]
y = ndi.gaussian_filter(Y[FRAME] - bgY, 1.5)
c = ndi.gaussian_filter(C[FRAME] - bgC, 1.5)
ratio = np.where(c > 1, y / np.maximum(c, 1e-3), 0)
inten = ndi.gaussian_filter((Y[FRAME] - bgY) + (C[FRAME] - bgC), 1.0)
inten = np.clip(inten / np.percentile(inten[lab > 0], 99.5), 0, 1) ** 0.7

cmap = colormaps["inferno"]
rgb = cmap(np.clip((ratio - RATIO_LO) / (RATIO_HI - RATIO_LO), 0, 1) * 0.92 + 0.08)[..., :3]
cell = ndi.binary_dilation(lab > 0, iterations=3)
alpha = inten * np.where(cell, 1.0, 0.25)
img = BG + (rgb - BG) * alpha[..., None]

for tid, hexc in TRACK_COLORS.items():
    edge = find_boundaries(lab == tid, mode="outer")
    edge = ndi.binary_dilation(edge, iterations=1)
    col = np.array(matplotlib.colors.to_rgb(hexc))
    img[edge] = img[edge] * 0.15 + col * 0.85

pad = np.empty((CH, CW, 3))
pad[:] = BG
crop = img[Y0:Y0 + CH, X0:X0 + CW]
pad[:crop.shape[0], :crop.shape[1]] = crop
img = pad

dpi = 100
fig = plt.figure(figsize=(W / dpi, H / dpi), dpi=dpi, facecolor=BG)
ax = fig.add_axes([0, 0, 1, 1])
ax.imshow(img, extent=(0, CW, CH, 0), interpolation="lanczos")
ax.set_xlim(0, CW)
ax.set_ylim(CH, 0)
ax.axis("off")

for tid, hexc in TRACK_COLORS.items():
    tr = tracks[tracks.track_id == tid].sort_values("frame")
    xs, ys = tr.x.values - X0, tr.y.values - Y0
    ax.plot(xs, ys, color=hexc, lw=2.2, alpha=0.95, solid_capstyle="round")
    ax.plot(xs[-1], ys[-1], "o", ms=4.5, color=hexc, mec="white", mew=0.8)

ins = fig.add_axes([0.605, 0.575, 0.375, 0.34], facecolor=(0, 0, 0, 0.55))
piv = ratios.pivot(index="frame", columns="track_id", values="ratio")
for tid, hexc in TRACK_COLORS.items():
    ins.plot(piv.index, piv[tid], color=hexc, lw=1.4)
ins.axvspan(HIS_FRAME, PYR_FRAME, color="white", alpha=0.07, lw=0)
ins.axvline(FRAME, color="white", lw=0.9, alpha=0.8, ls=(0, (2, 2)))
ins.set_xlim(0, piv.index.max())
ins.set_ylim(6, 42)
ins.set_xticks([])
ins.set_yticks([])
for s in ins.spines.values():
    s.set_color((1, 1, 1, 0.35))
    s.set_linewidth(0.8)
kw = dict(color="white", fontsize=7.5, fontfamily="Noto Sans", fontweight="semibold",
          va="top")
fig.text(0.605, 0.975, "Calcium (YFP/CFP) per tracked cell", **kw)
small = dict(color=(1, 1, 1, 0.75), fontsize=6.5, fontfamily="Noto Sans", va="top",
             transform=ins.get_xaxis_transform())
ins.text(HIS_FRAME, -0.04, "+histamine", ha="left", **small)
ins.text(PYR_FRAME, -0.04, "+pyrilamine", ha="center", **small)

tmp = out + ".png"
fig.savefig(tmp, dpi=dpi, facecolor=BG)
plt.close(fig)
im = Image.open(tmp).convert("RGB")
assert im.size == (W, H), im.size
for q in (90, 86, 82, 78, 74, 70, 65, 60):
    im.save(out, "WEBP", quality=q, method=6)
    if os.path.getsize(out) < 45000:
        break
os.remove(tmp)
print(out, q, os.path.getsize(out))
