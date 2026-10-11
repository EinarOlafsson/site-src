"""Rank windows of each candidate field and render raw + mask previews at panel size."""
import os
import sys
import json
import numpy as np
from scipy import ndimage as ndi
from common import R, load_field, field_limits, composite, to_img, contours_of, draw_outlines, CELL, NUC, PV


def best_window(f, wh, ww, step=50):
    cell = f["cell"] > 0
    pv = f["pv"]
    H, W = cell.shape
    ii = ndi.uniform_filter(cell.astype(np.float32), size=1)
    cs = np.pad(cell.astype(np.int64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    def cov(r0, r1, c0, c1):
        return (cs[r1, c1] - cs[r0, c1] - cs[r1, c0] + cs[r0, c0]) / ((r1 - r0) * (c1 - c0))
    pvc = ndi.center_of_mass(pv > 0, pv, range(1, pv.max() + 1)) if pv.max() else []
    pvc = np.array([c for c in pvc if np.all(np.isfinite(c))]) if len(pvc) else np.zeros((0, 2))
    best = None
    for r0 in range(0, H - wh + 1, step):
        for c0 in range(0, W - ww + 1, step):
            r1, c1 = r0 + wh, c0 + ww
            q = [cov(r0, r0 + wh // 2, c0, c0 + ww // 2), cov(r0, r0 + wh // 2, c0 + ww // 2, c1),
                 cov(r0 + wh // 2, r1, c0, c0 + ww // 2), cov(r0 + wh // 2, r1, c0 + ww // 2, c1)]
            npv = int(((pvc[:, 0] >= r0) & (pvc[:, 0] < r1) & (pvc[:, 1] >= c0) & (pvc[:, 1] < c1)).sum()) if len(pvc) else 0
            sc = min(q) * 2 + np.mean(q) + 0.01 * npv
            if best is None or sc > best[0]:
                best = (sc, (r0, r1, c0, c1), q, npv)
    return best


if __name__ == "__main__":
    wh, ww = int(sys.argv[1]), int(sys.argv[2])
    out = f"{R}/preview/win_{ww}x{wh}"
    os.makedirs(out, exist_ok=True)
    res = {}
    for line in open(f"{R}/work/cands.txt"):
        s = line.strip()
        if not s or "CSA" in s or "THP1" in s:
            continue
        f = load_field(s)
        sc, win, q, npv = best_window(f, wh, ww)
        res[s] = {"score": sc, "win": win, "quad_cov": q, "n_pv": npv}
        print(s, round(sc, 3), win, [round(x, 2) for x in q], npv, flush=True)
        lim = field_limits(f)
        rgb = composite(f, lim, win)
        size = (800, 600) if ww > wh else (300, 400)
        im = to_img(rgb, size)
        im.save(f"{out}/{s.split('__')[-1]}_raw.png")
        layers = [(contours_of(f["cell"], win), CELL, 1.0), (contours_of(f["nuc"], win), NUC, 1.0),
                  (contours_of(f["pv"], win), PV, 1.0)]
        draw_outlines(to_img(composite(f, lim, win, mono=True) * 0.6, size), layers, win, 2.2).save(f"{out}/{s.split('__')[-1]}_masks.png")
    json.dump(res, open(f"{out}/windows.json", "w"), indent=1)
