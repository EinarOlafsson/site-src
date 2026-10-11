"""Run toxoplasma_plaque_v4 (cpsam_plaque_r6, cpsam_v2 base) on the same CC BY 4.0 literature well as
run_plaque_public.py, on CPU, and score it against the same hand-drawn mask.

Primary run: the model card's documented evaluation, spacr.plaque.segment_plaque_image with
diameter 30, flow threshold 0.4, cell probability 0. Two comparison runs on the same well:
v4 with the settings of the earlier v3 showcase run, and v3 through the same documented call.

Usage (CPU, capped):
  CUDA_VISIBLE_DEVICES='' /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G \
    /home/olafsson/anaconda3/envs/spacr/bin/python -I run_plaque_v4.py
"""
import hashlib, json, os, sys, time
from importlib.metadata import version
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
WORKTREE = "/mnt/wd4tb/spacr-worktrees/claude-n687-v5"
sys.path.insert(0, WORKTREE)

import numpy as np, tifffile, torch
torch.set_num_threads(16)
from huggingface_hub import hf_hub_download
from cellpose import models
from cellpose.metrics import average_precision
from spacr import model_zoo as mz
from spacr.plaque import segment_plaque_image

OUT = Path("/mnt/wd4tb/scratch/n687v3/plaque_v4")
OUT.mkdir(parents=True, exist_ok=True)
NAME = "literature__PMC11448412__spectrum.01229-24.f002.jpg__p19__w00"
DATASET = "einarolafsson/toxoplasma-plaque-dataset"
DATASET_REV = "7af596eae241d1ffa427243fa5343fd5b33fd42a"
V4_REV = "c6aca2b05cd09699fa0da36c48f2b4c3a09093ce"
ZOO = {d["key"]: d for d in mz.BUNDLED_REMOTE_MODELS}


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def weights(key, revision=None):
    z = ZOO[key]
    rel = z["uri"].split("/resolve/main/")[1]
    p = hf_hub_download(z["repo_id"], rel, revision=revision)
    s = sha256(p)
    assert s == z["sha256"], (key, s, z["sha256"])
    return p, s, z


def score(gt, pred):
    ap, tp, fp, fn = average_precision([gt.astype(np.int32)], [pred.astype(np.int32)], threshold=[0.5])
    tp, fp, fn = int(tp[0, 0]), int(fp[0, 0]), int(fn[0, 0])
    return dict(count=int(len(np.unique(pred)) - 1), tp=tp, fp=fp, fn=fn,
                precision=round(tp / max(tp + fp, 1), 3), recall=round(tp / max(tp + fn, 1), 3),
                f1_at_iou_0_5=round(2 * tp / max(2 * tp + fp + fn, 1), 3), ap_at_iou_0_5=round(float(ap[0, 0]), 3))


img_p = hf_hub_download(DATASET, f"images/{NAME}.tif", repo_type="dataset", revision=DATASET_REV)
msk_p = hf_hub_download(DATASET, f"masks/{NAME}.tif", repo_type="dataset", revision=DATASET_REV)
img = tifffile.imread(img_p)
gt = tifffile.imread(msk_p)

w4, s4, z4 = weights("toxoplasma_plaque_v4", V4_REV)
w3, s3, z3 = weights("toxoplasma_plaque_v3")

DOC = {"diameter": 30, "flow_threshold": 0.4, "CP_prob": 0}
OLD = dict(normalize=True, flow_threshold=0.4, cellprob_threshold=0.0, min_size=0, max_size_fraction=0.95)

runs = {}
masks_out = {}
for tag, w, how in (("v4_documented", w4, "doc"), ("v4_prev_showcase_settings", w4, "old"),
                    ("v3_documented", w3, "doc")):
    model = models.CellposeModel(gpu=False, pretrained_model=w, use_bfloat16=False)
    t0 = time.perf_counter()
    if how == "doc":
        m = segment_plaque_image(model, img, DOC)
        settings = dict(call="spacr.plaque.segment_plaque_image", **DOC)
    else:
        m = model.eval(img.astype(np.float32), **OLD)[0]
        settings = dict(call="CellposeModel.eval (as run_plaque_public.py)", **OLD)
    dt = round(time.perf_counter() - t0, 1)
    m = np.asarray(m).astype(np.uint16)
    masks_out[tag] = m
    runs[tag] = dict(settings=settings, seconds=dt, **score(gt, m))
    print(tag, json.dumps(runs[tag]), flush=True)
    del model

tifffile.imwrite(OUT / "plaque_v4.tif", masks_out["v4_documented"], compression="zlib")
tifffile.imwrite(OUT / "plaque_v4_prev_settings.tif", masks_out["v4_prev_showcase_settings"], compression="zlib")
tifffile.imwrite(OUT / "plaque_v3_documented.tif", masks_out["v3_documented"], compression="zlib")

zoo_src = Path(WORKTREE) / "spacr/model_zoo.py"
import subprocess
head = subprocess.run(["git", "-C", WORKTREE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
rec = dict(
    name=NAME, dataset_repo=DATASET, dataset_revision=DATASET_REV, file=f"images/{NAME}.tif",
    image_sha256=sha256(img_p), reference_mask=f"masks/{NAME}.tif", reference_mask_sha256=sha256(msk_p),
    licence="CC BY 4.0 (dataset card); crop of a figure from an open-access article",
    source="Cabral G et al. 2024, Microbiol Spectrum, doi:10.1128/spectrum.01229-24, Fig. 2",
    v4_split="test (training/fields.csv of the v4 model repo: split=test, n_objects=98)",
    shape=list(img.shape), dtype=str(img.dtype), reference_count=int(len(np.unique(gt)) - 1),
    model_key="toxoplasma_plaque_v4", model_name=z4["name"], display_name=z4["display_name"],
    repo_id=z4["repo_id"], repo_revision=V4_REV, weights=w4, sha256=s4, zoo_sha256=z4["sha256"],
    zoo_default_plaque_model="toxoplasma_plaque_v3 (spacr.submodules.DEFAULT_PLAQUE_MODEL at spaCR nightly "
                             + head[:9] + "); v4 is registered as 'alternative, not the default'",
    comparison_v3=dict(model_key="toxoplasma_plaque_v3", weights=w3, sha256=s3),
    spacr_nightly=head, cellpose=version("cellpose"), torch=torch.__version__,
    device="cpu fp32 (use_bfloat16=False), 16 threads, CUDA_VISIBLE_DEVICES=''",
    card_test_metric=dict(fields=263, f1=0.815, precision=0.825, recall=0.806, v3_f1_same_fields=0.844,
                          scorer="spacr.plaque.segment_plaque_image, diameter 30, flow 0.4, CP_prob 0, IoU 0.5"),
    scorer="cellpose.metrics.average_precision at IoU 0.5 (Hungarian matching), as render.py / run_plaque_public.py",
    runs=runs, mask=str(OUT / "plaque_v4.tif"),
)
json.dump(rec, open(OUT / "run_record_plaque_v4.json", "w"), indent=1)
print(json.dumps({k: v for k, v in rec.items() if k != "runs"}, indent=1))
