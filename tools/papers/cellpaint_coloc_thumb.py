"""Render the Diessl et al. 2026 card illustration with spaCR.

Not a figure from the paper (bioRxiv licence: no reuse). An illustration of
the step the paper used spaCR for: segment cells and nuclei in confocal
fields, measure each channel per cell, and score per-cell Pearson
correlation between a protein and a Golgi stain.

Data: JUMP Cell Painting pilot CPJUMP1 (Chandrasekaran et al. 2024, Nature
Methods, doi:10.1038/s41592-024-02241-6), Cell Painting Gallery cpg0000,
CC0 1.0. U2OS, plate BR00117011, well C03 (DMSO), site 5:
  ch2 Alexa 568 (WGA + phalloidin: Golgi, plasma membrane, actin)
  ch4 Alexa 488 (concanavalin A: ER)
  ch5 Hoechst 33342 (DNA)

Steps (CPU only):
  1. Cellpose (cpsam) through spacr.utils._choose_model, cells on
     AGP + ER + DNA, nuclei on DNA
  2. per-cell Pearson r between ER and AGP with
     spacr.measure._calculate_correlation_object_level
  3. composite (DNA blue, ER green, AGP magenta), cell outlines coloured by
     each cell's r, nuclei outlined faintly, and an inset with every cell's r

Usage: python cellpaint_coloc_thumb.py <image dir> <out.webp>
Images are named r03c03f05-ch{1..5}.tiff as downloaded from
s3://cellpainting-gallery/cpg0000-jump-pilot/source_4/images/2020_11_04_CPJUMP1/
images/BR00117011__2020-11-08T19_57_47-Measurement1/Images/r03c03f05p01-ch{c}sk1fk1fl1.tiff
"""
import os
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import tifffile
import torch
from matplotlib import colormaps
from PIL import Image
from scipy import ndimage as ndi
from skimage.segmentation import clear_border, find_boundaries

from spacr.measure import _calculate_correlation_object_level
from spacr.utils import _choose_model

src, out = sys.argv[1], sys.argv[2]
SITE = "r03c03f05"
W, H = 480, 320
BG = np.array([12, 14, 18]) / 255.0
X0, Y0, CW, CH = 150, 250, 780, 520
R_LO, R_HI = 0.4, 1.0
torch.set_num_threads(8)


def load(c):
    a = tifffile.imread(os.path.join(src, f"{SITE}-ch{c}.tiff")).astype(np.float32)
    return np.clip(a - np.percentile(a, 2), 0, None)


def norm(a, hi=99.7):
    return np.clip(a / np.percentile(a, hi), 0, 1)


agp, er, dna = load(2), load(4), load(5)
dev = torch.device("cpu")
cyto = _choose_model("cpsam", dev, object_type="cell")
nuc = _choose_model("cpsam", dev, object_type="nucleus")
stack = np.stack([norm(agp + er), norm(dna), np.zeros_like(dna)], axis=-1)
cells, *_ = cyto.eval(stack, diameter=None, flow_threshold=0.4, cellprob_threshold=0.0)
nuclei, *_ = nuc.eval(np.stack([norm(dna)] * 3, axis=-1), diameter=None,
                      flow_threshold=0.4, cellprob_threshold=0.0)
cells = clear_border(cells.astype(np.int32))
nuclei = nuclei.astype(np.int32)
corr = _calculate_correlation_object_level(er, agp, cells, {})
r = dict(zip(corr["label_correlation"].astype(int), corr["Pearson_correlation"]))
print(f"{len(r)} whole cells, {nuclei.max()} nuclei, "
      f"median r {np.nanmedian(list(r.values())):.2f}", flush=True)

rgb = (norm(dna, 99.5)[..., None] * np.array([0.25, 0.45, 1.0]) * 0.8
       + norm(er)[..., None] * np.array([0.30, 0.95, 0.45]) * 0.85
       + norm(agp)[..., None] * np.array([1.0, 0.25, 0.85]))
img = BG + np.clip(rgb, 0, 1) * (1 - BG)
img = np.clip(img, 0, 1)

cmap = colormaps["plasma"]
ncol = np.array([1.0, 1.0, 1.0])
nedge = find_boundaries(nuclei, mode="inner")
img[nedge] = img[nedge] * 0.55 + ncol * 0.45
for lab, val in r.items():
    edge = ndi.binary_dilation(find_boundaries(cells == lab, mode="outer"), iterations=1)
    col = np.array(cmap(0.15 + 0.85 * np.clip((val - R_LO) / (R_HI - R_LO), 0, 1))[:3])
    img[edge] = img[edge] * 0.1 + col * 0.9

crop = img[Y0:Y0 + CH, X0:X0 + CW]
dpi = 100
fig = plt.figure(figsize=(W / dpi, H / dpi), dpi=dpi, facecolor=BG)
ax = fig.add_axes([0, 0, 1, 1])
ax.imshow(crop, extent=(0, CW, CH, 0), interpolation="lanczos")
ax.set_xlim(0, CW)
ax.set_ylim(CH, 0)
ax.axis("off")

vals = np.array(sorted(v for v in r.values() if np.isfinite(v)))
ins = fig.add_axes([0.035, 0.06, 0.40, 0.17], facecolor=(0, 0, 0, 0.62))
rng = np.random.default_rng(1)
ins.scatter(vals, rng.uniform(0.2, 0.8, len(vals)), s=10, lw=0,
            c=[cmap(0.15 + 0.85 * np.clip((v - R_LO) / (R_HI - R_LO), 0, 1)) for v in vals])
ins.axvline(np.median(vals), color="white", lw=0.9, alpha=0.8, ls=(0, (2, 2)))
ins.set_xlim(R_LO - 0.05, R_HI + 0.05)
ins.set_ylim(0, 1)
ins.set_yticks([])
ins.set_xticks([0.4, 0.7, 1.0])
ins.tick_params(axis="x", colors=(1, 1, 1, 0.75), labelsize=6.5, length=2, pad=1)
for s in ins.spines.values():
    s.set_color((1, 1, 1, 0.35))
    s.set_linewidth(0.8)
fig.text(0.035, 0.255, "Pearson r per cell, ER vs Golgi stain", color="white",
         fontsize=7.5, fontfamily="Noto Sans", fontweight="semibold", va="bottom")

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
