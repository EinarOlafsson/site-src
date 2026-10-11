"""Contact sheet of candidate fields: Hoechst blue, CellMask grey, PV outlines magenta."""
import os
import numpy as np
import tifffile
from PIL import Image
from skimage.segmentation import find_boundaries

R = os.environ["FOV_ROOT"]
cc = f"{R}/dl/cc"
out = f"{R}/preview/contact"
os.makedirs(out, exist_ok=True)


def pct(a, lo=1, hi=99.7):
    a = a.astype(np.float32)
    l, h = np.percentile(a, [lo, hi])
    return np.clip((a - l) / max(h - l, 1e-6), 0, 1)


for line in open(f"{R}/work/cands.txt"):
    s = line.strip()
    if not s:
        continue
    h = tifffile.imread(f"{cc}/{s}.hoechst.tif")
    c = tifffile.imread(f"{cc}/{s}.cellmask.tif")
    pv = tifffile.imread(f"{cc}/{s}.pv.tif")
    cell = tifffile.imread(f"{cc}/{s}.cell.tif")
    nuc = tifffile.imread(f"{cc}/{s}.nuc.tif")
    print(s, h.shape, h.dtype, c.shape, pv.shape, cell.shape, nuc.shape, pv.max(), cell.max(), nuc.max())
    hn, cn = pct(h), pct(c)
    rgb = np.stack([0.75 * cn, 0.75 * cn + 0.35 * hn, 0.75 * cn + hn], -1)
    rgb[find_boundaries(pv, mode="thick")] = [1, 0, 1]
    rgb[find_boundaries(cell, mode="inner")] = [0, 0.8, 0.78]
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize((700, 700), Image.LANCZOS)
    im.save(f"{out}/{s.split('__')[0]}_{s.split('__')[-1]}.png")
