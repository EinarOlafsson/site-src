"""Live cell v1 (Cellpose-SAM weights) on one held-out BBBC030 DIC test field, CPU fp32."""
import hashlib, json, os, sys, time
os.environ["CUDA_VISIBLE_DEVICES"] = ""
from pathlib import Path
import numpy as np, tifffile, torch
from PIL import Image
torch.set_num_threads(16)
from cellpose import models
from cellpose.metrics import average_precision
import importlib.util
spec = importlib.util.spec_from_file_location("rh", "/mnt/firecuda2/Claude/scratch/site-flipcards-examples/scripts/render_helpers.py")
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)

ROOT = Path("/mnt/firecuda2/Claude/scratch/site-flipcards-examples")
W = sys.argv[1]
NAME = sys.argv[2] if len(sys.argv) > 2 else "bbbc030_dic__cho07"
img = tifffile.imread(ROOT / f"dl/lcds/images/bbbc030_dic/{NAME}.tif")
gt = tifffile.imread(ROOT / f"dl/lcds/masks/bbbc030_dic/{NAME}.tif")
assert img.ndim == 3 and (img[..., 0] == img[..., 1]).all() and (img[..., 0] == img[..., 2]).all()
g = img[..., 0]
sha = hashlib.sha256(open(W, "rb").read()).hexdigest()
settings = dict(diameter=None, normalize=True, flow_threshold=0.4, cellprob_threshold=0.0, min_size=15)
model = models.CellposeModel(gpu=False, pretrained_model=W, use_bfloat16=False)
t0 = time.perf_counter()
masks = np.asarray(model.eval(g.astype(np.float32), **settings)[0]).astype(np.uint16)
dt = time.perf_counter() - t0
n = int(len(np.unique(masks)) - 1)
ap, tp, fp, fn = average_precision([gt.astype(np.int32)], [masks.astype(np.int32)], threshold=[0.5])
tp, fp, fn = int(tp[0, 0]), int(fp[0, 0]), int(fn[0, 0])
f1 = round(2 * tp / max(2 * tp + fp + fn, 1), 3)
out = ROOT / "out"
tifffile.imwrite(ROOT / "work/livecell-masks.tif", masks, compression="zlib")
s = R.scale_for(g.shape)
size = (round(g.shape[1] * s), round(g.shape[0] * s))
base = Image.fromarray(R.stretch(g)).resize(size, Image.LANCZOS).convert("RGB")
q, nb = R.save_webp_under(base, out / "livecell-raw.webp", 150_000)
layer = R.outline_layer(masks, size, "#FF00FF")
layer.save(out / "livecell-cells.webp", "WEBP", lossless=True, method=6)
comp = base.convert("RGBA"); comp.alpha_composite(layer)
comp.convert("RGB").save(ROOT / "work/livecell-preview.png")
rec = dict(name=NAME, shape=list(img.shape), dtype=str(img.dtype), input="channel 0 of a 3-channel greyscale PNG (channels identical)",
           size=list(size), scale=s, raw_webp_quality=q, raw_webp_bytes=nb, count=n,
           reference_count=int(len(np.unique(gt)) - 1), tp=tp, fp=fp, fn=fn, f1_at_iou_0_5=f1,
           weights=W, sha256=sha, settings=settings, seconds=round(dt, 1), device="cpu fp32 (use_bfloat16=False), 16 threads")
json.dump(rec, open(ROOT / "work/livecell_record.json", "w"), indent=1)
print(json.dumps(rec, indent=1))
