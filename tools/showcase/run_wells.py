"""Well detector v3 (YOLO11n) on a CC BY 4.0 literature figure crop, CPU only."""
import hashlib, json, os, sys, time
os.environ["CUDA_VISIBLE_DEVICES"] = ""
from pathlib import Path
import numpy as np, tifffile, torch
from PIL import Image, ImageDraw
torch.set_num_threads(16)
sys.path.insert(0, "/mnt/firecuda2/Claude/scratch/site-flipcards/tools/showcase")
sys.path.insert(0, "/mnt/firecuda2/Claude/repo/spacr")
from spacr.plaque import detect_wells, DEFAULT_CONFIDENCE
import importlib.util
spec = importlib.util.spec_from_file_location("rh", "/mnt/firecuda2/Claude/scratch/site-flipcards-examples/scripts/render_helpers.py")
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)

ROOT = Path("/mnt/firecuda2/Claude/scratch/site-flipcards-examples")
W = sys.argv[1]
fig = tifffile.imread(ROOT / "dl/fig/f003_full.tif")
H0, W0 = fig.shape[:2]
x0, y0, x1, y1 = [int(v) for v in sys.argv[2].split(",")]
crop = np.ascontiguousarray(fig[y0:y1, x0:x1, :3])
sha = hashlib.sha256(open(W, "rb").read()).hexdigest()
t0 = time.perf_counter()
wells = detect_wells(crop, W, confidence=DEFAULT_CONFIDENCE, imgsz=640)
dt = time.perf_counter() - t0
s = R.scale_for(crop.shape[:2])
size = (round(crop.shape[1] * s), round(crop.shape[0] * s))
base = Image.fromarray(crop).resize(size, Image.LANCZOS).convert("RGB")
out = ROOT / "out"
q, nb = R.save_webp_under(base, out / "wells-raw.webp", 150_000)
layer = Image.new("RGBA", size, (0, 0, 0, 0))
d = ImageDraw.Draw(layer)
for w in wells:
    d.rectangle([w.x0 * s, w.y0 * s, w.x1 * s, w.y1 * s], outline=(255, 0, 255, 255), width=3)
layer.save(out / "wells-boxes.webp", "WEBP", lossless=True, method=6)
comp = base.convert("RGBA"); comp.alpha_composite(layer)
comp.convert("RGB").save(ROOT / "work/wells-preview.png")
rec = dict(figure_native_px=[W0, H0], crop_xyxy_native=[x0, y0, x1, y1], crop_px=[crop.shape[1], crop.shape[0]],
           size=list(size), scale=s, raw_webp_quality=q, raw_webp_bytes=nb, count=len(wells),
           boxes_native=[[w.x0, w.y0, w.x1, w.y1, round(w.confidence, 3)] for w in wells],
           weights=W, sha256=sha, seconds=round(dt, 2),
           settings=dict(confidence=DEFAULT_CONFIDENCE, imgsz=640, min_axis_ratio=0.7,
                         call="spacr.plaque.detect_wells (RGB array converted to BGR for ultralytics)"))
json.dump(rec, open(ROOT / "work/wells_record.json", "w"), indent=1)
print(json.dumps({k: v for k, v in rec.items() if k != "boxes_native"}, indent=1))
print([b[4] for b in rec["boxes_native"]])
