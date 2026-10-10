"""Run the spaCR cross-channel models, stock Cellpose-SAM and the Gel Doc plaque model on CPU.

Writes label masks (uint16 .tif) and a run record (runs.json) into data/masks/.
Eval settings follow the published scoring code:
  cross-channel + stock: model.eval(raw.astype(float32), normalize=True,
      flow_threshold=0.4, cellprob_threshold=0.0)  (diameter None, cellpose defaults otherwise),
      as in cross_channel_models/code/cc_metrics_home_v1.py and score_model.py.
  plaque v3: normalize=True, flow_threshold=0.4, cellprob_threshold=0.0, min_size=0,
      max_size_fraction=0.95, invert=False (training/publication_config.json + model card).
"""
import hashlib, json, os, sys, time
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
import numpy as np
import tifffile
import torch
from PIL import Image

torch.set_num_threads(16)
from cellpose import models
from cellpose.models import MODEL_DIR

ROOT = Path("/mnt/wd4tb/scratch/n687/models")
HF = Path.home() / ".cache/huggingface/hub"
FIELD = "MTOC_Screen__mtocScreen_20250530_111302__plate1_L08_12_1"
PLAQUE = Path("/mnt/wd4tb/af3/projects/automated_plaque_assay/curation/gel_doc_2026-10-05/"
              "gel__GRA8__ReimagedPlate1__w00.png")


def ds_file(repo, sub, name):
    return next((HF / f"datasets--einarolafsson--{repo}" / "snapshots").glob(f"*/{sub}/{name}.tif"))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


CC = dict(normalize=True, flow_threshold=0.4, cellprob_threshold=0.0)
PLQ = dict(normalize=True, flow_threshold=0.4, cellprob_threshold=0.0, min_size=0, max_size_fraction=0.95)

weights = json.load(open(ROOT / "data/weights.json"))
inputs = {
    "hoechst": ds_file("cross-channel-cell-from-hoechst", "images", FIELD),
    "cellmask": ds_file("cross-channel-toxoplasma-from-cellmask", "images", FIELD),
    "plaque": PLAQUE,
}
JOBS = [
    ("hoechst", "nuclei", "stock:cpsam_v2", dict(CC, diameter=90.0, background=500)),
    ("hoechst", "cell", "cell_from_hoechst_v1", CC),
    ("hoechst", "toxoplasma", "toxoplasma_from_hoechst_v1", CC),
    ("cellmask", "cell", "stock:cpsam_v2", CC),
    ("cellmask", "nuclei", "nuclei_from_cellmask_v1", CC),
    ("cellmask", "toxoplasma", "toxoplasma_from_cellmask_v1", CC),
    ("plaque", "plaque", "toxoplasma_plaque_v3", PLQ),
]
only = set(sys.argv[1:])
out = ROOT / "data/masks"
out.mkdir(parents=True, exist_ok=True)
rec_path = out / "runs.json"
record = json.load(open(rec_path)) if rec_path.exists() else {}

for inp, cls, key, settings in JOBS:
    tag = f"{inp}-{cls}"
    if only and tag not in only:
        continue
    src = inputs[inp]
    img = tifffile.imread(src) if src.suffix == ".tif" else np.asarray(Image.open(src))
    img = np.asarray(img).astype(np.float32)
    settings = dict(settings)
    background = settings.pop("background", None)
    if background is not None:
        img[img < background] = 0
    if key.startswith("stock:"):
        wpath = str(Path(MODEL_DIR) / key.split(":")[1])
    else:
        wpath = weights[key]["weights"]
        assert weights[key]["match"], key
    wsha = sha256(wpath)
    model = models.CellposeModel(gpu=False, pretrained_model=wpath, use_bfloat16=False)
    assert Path(model.pretrained_model).resolve() == Path(wpath).resolve(), (model.pretrained_model, wpath)
    t0 = time.perf_counter()
    masks = np.asarray(model.eval(img, **settings)[0]).astype(np.uint16)
    dt = time.perf_counter() - t0
    tifffile.imwrite(out / f"{tag}.tif", masks, compression="zlib")
    n = int(len(np.unique(masks)) - (1 if masks.min() == 0 else 0))
    if background is not None:
        settings["background"] = background
        settings["background_note"] = ("spaCR nucleus_background-style removal: pixels < background set to 0 before "
                                       "cellpose normalisation; 500 lies between cytoplasmic Hoechst p95 (406) and "
                                       "nuclear p5 (623). diameter 90 px = median GT nuclear diameter of this field.")
    record[tag] = dict(input=inp, cls=cls, key=key, weights=wpath, sha256=wsha, settings=settings,
                       count=n, seconds=round(dt, 1), image=str(src), shape=list(img.shape),
                       device="cpu", precision="float32 (use_bfloat16=False; bf16 is ~9x slower on CPU)", torch_threads=torch.get_num_threads())
    print(tag, key, n, f"{dt:.1f}s", wsha[:12], flush=True)
    json.dump(record, open(rec_path, "w"), indent=1)
    del model
