"""Test spaCR-style background removal / diameter for stock cpsam_v2 nuclei on Hoechst (1000x1000 crop)."""
import os, glob, time
os.environ["CUDA_VISIBLE_DEVICES"] = ""
import numpy as np, tifffile, torch
torch.set_num_threads(8)
from cellpose import models
from cellpose.metrics import average_precision
H = '/home/olafsson/.cache/huggingface/hub'
n = 'MTOC_Screen__mtocScreen_20250530_111302__plate1_L08_12_1'
h = tifffile.imread(glob.glob(H + f'/datasets--einarolafsson--cross-channel-cell-from-hoechst/snapshots/*/images/{n}.tif')[0]).astype(np.float32)
g = tifffile.imread(glob.glob(H + f'/datasets--einarolafsson--cross-channel-nuclei-from-cellmask/snapshots/*/masks/{n}.tif')[0])
h, g = h[:1000, :1000], g[:1000, :1000]
m = models.CellposeModel(gpu=False, pretrained_model='cpsam_v2', use_bfloat16=False)
for name, bg, diam in [("default", None, None), ("bg300", 300, None), ("bg500", 500, None), ("diam90", None, 90), ("bg500+diam90", 500, 90)]:
    x = h.copy()
    if bg is not None:
        x[x < bg] = 0
    t = time.perf_counter()
    p = m.eval(x, normalize=True, flow_threshold=0.4, cellprob_threshold=0.0, diameter=diam)[0]
    ap, tp, fp, fn = average_precision([g], [p], threshold=[0.5])
    f1 = 2 * tp[0, 0] / max(2 * tp[0, 0] + fp[0, 0] + fn[0, 0], 1)
    print(name, "n", p.max(), "gt", len(np.unique(g)) - 1, "F1@0.5", round(float(f1), 3), f"{time.perf_counter()-t:.0f}s", flush=True)
    tifffile.imwrite(f"/mnt/wd4tb/scratch/n687/models/data/preview/tune_{name}.tif", p.astype(np.uint16))
