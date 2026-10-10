"""Run toxoplasma_plaque_v3 on a CC BY 4.0 literature well that v3 did not train on (eval split in
the model's training/fields.csv), on CPU, and render raw/outline/figure WebPs plus plaque_public.json."""
import hashlib, io, json, os, sys, time
from pathlib import Path
os.environ["CUDA_VISIBLE_DEVICES"] = ""
import numpy as np, tifffile, torch
from PIL import Image, ImageDraw
torch.set_num_threads(16)
from huggingface_hub import hf_hub_download
from cellpose import models
from cellpose.metrics import average_precision
sys.path.insert(0, str(Path(__file__).parent))
import render as R

ROOT = Path("/mnt/wd4tb/scratch/n687/models")
NAME = sys.argv[1] if len(sys.argv) > 1 else "literature__PMC11448412__spectrum.01229-24.f002.jpg__p19__w00"
img_p = hf_hub_download("einarolafsson/toxoplasma-plaque-dataset", f"images/{NAME}.tif", repo_type="dataset")
msk_p = hf_hub_download("einarolafsson/toxoplasma-plaque-dataset", f"masks/{NAME}.tif", repo_type="dataset")
img = tifffile.imread(img_p)
gt = tifffile.imread(msk_p)
weights = json.load(open(ROOT / "data/weights.json"))
w = weights["toxoplasma_plaque_v3"]["weights"]
sha = hashlib.sha256(open(w, "rb").read()).hexdigest()
settings = dict(normalize=True, flow_threshold=0.4, cellprob_threshold=0.0, min_size=0, max_size_fraction=0.95)
model = models.CellposeModel(gpu=False, pretrained_model=w, use_bfloat16=False)
t0 = time.perf_counter()
masks = np.asarray(model.eval(img.astype(np.float32), **settings)[0]).astype(np.uint16)
dt = time.perf_counter() - t0
n = int(len(np.unique(masks)) - 1)
ap, tp, fp, fn = average_precision([gt.astype(np.int32)], [masks.astype(np.int32)], threshold=[0.5])
tp, fp, fn = int(tp[0, 0]), int(fp[0, 0]), int(fn[0, 0])
f1 = round(2 * tp / max(2 * tp + fp + fn, 1), 3)
out = ROOT / "out_public"; out.mkdir(exist_ok=True)
tifffile.imwrite(out / "plaque.tif", masks, compression="zlib")
raw = R.stretch(img if img.ndim == 2 else img[..., 0])
s = R.scale_for(raw.shape)
size = (round(raw.shape[1] * s), round(raw.shape[0] * s))
base = Image.fromarray(raw).resize(size, Image.LANCZOS).convert("RGB")
R.save_webp_under(base, out / "plaque-raw.webp", 120_000)
layer = R.outline_layer(masks, size, "#FF00FF")
layer.save(out / "plaque-plaque.webp", "WEBP", lossless=True, method=6)
fig = base.copy().convert("RGBA"); fig.alpha_composite(layer)
R.save_webp_under(fig.convert("RGB"), out / "plaque-figure.webp", 200_000)
rec = dict(name=NAME, dataset_repo="einarolafsson/toxoplasma-plaque-dataset", file=f"images/{NAME}.tif",
           licence="CC BY 4.0 (dataset card); crop of a figure from an open-access article",
           v3_split="eval (not in training; training/fields.csv of the v3 model repo)",
           shape=list(img.shape), dtype=str(img.dtype), size=list(size), scale=s, count=n,
           reference_count=int(len(np.unique(gt)) - 1), tp=tp, fp=fp, fn=fn, f1_at_iou_0_5=f1,
           model_key="toxoplasma_plaque_v3", weights=w, sha256=sha, settings=settings, seconds=round(dt, 1),
           device="cpu fp32, 16 threads")
json.dump(rec, open(out / "plaque_public.json", "w"), indent=1)
print(json.dumps(rec, indent=1))
