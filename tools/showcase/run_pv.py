"""Run toxoplasma_pv_v4 (PV round 7) on CPU on one held-out test field of the CC BY 4.0 dataset
einarolafsson/toxoplasma-pv-segmentation-dataset-r7, and score it against that field's hand-curated mask.

Command (CPU only, RAM-capped; -I because it reads downloaded files):
    CUDA_VISIBLE_DEVICES='' /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G \
        /home/olafsson/anaconda3/envs/spacr/bin/python -I \
        /mnt/firecuda2/Claude/scratch/site-v3/tools/showcase/run_pv.py plate7_K07_8

Writes /mnt/wd4tb/scratch/n687v3/pv/work/pv-vacuole.tif and
/mnt/firecuda2/Claude/scratch/site-v3/tools/showcase/run_record_pv.json.
Settings: the r7 model card and training/report.json give no eval settings, so this uses the options of
the maintainer's 2026-10-10 PV head-to-head that scored toxoplasma_pv_v4 (spacr features/data/
model_compare_2026-10-10/compare.py: normalize=True, min_size=15, max_size_fraction=1.0) with Cellpose 4
defaults otherwise (flow_threshold 0.4, cellprob_threshold 0.0, diameter None, single grayscale channel).
"""
import hashlib, json, os, platform, sys, time
from pathlib import Path

os.environ["CUDA_VISIBLE_DEVICES"] = ""
WORKTREE = "/mnt/wd4tb/spacr-worktrees/claude-n687-v3"
sys.path.insert(0, WORKTREE)

import numpy as np, tifffile, torch
from huggingface_hub import hf_hub_download
from importlib.metadata import version

torch.set_num_threads(16)
from cellpose import models
from cellpose.metrics import average_precision
from spacr import model_zoo as mz

KEY = "toxoplasma_pv_v4"
DATASET = "einarolafsson/toxoplasma-pv-segmentation-dataset-r7"
STEM = sys.argv[1] if len(sys.argv) > 1 else "plate7_K07_8"
SCRATCH = Path("/mnt/wd4tb/scratch/n687v3/pv")
DL = SCRATCH / "dl"
WORK = SCRATCH / "work"
WORK.mkdir(parents=True, exist_ok=True)
RECORD = Path(__file__).resolve().parent / "run_record_pv.json"


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


raw_entry = {d["key"]: d for d in mz.BUNDLED_REMOTE_MODELS}[KEY]
entry = mz.resolve(KEY)
repo = raw_entry["repo_id"]
wfile = entry.uri.split("/resolve/main/")[1].split("?")[0]
t0 = time.perf_counter()
weights = hf_hub_download(repo, wfile, repo_type="model")
t_dl = time.perf_counter() - t0
w_sha = sha256(weights)
if w_sha != entry.sha256.lower():
    raise SystemExit(f"sha256 mismatch: {w_sha} != zoo {entry.sha256}")

meta = {f: hf_hub_download(DATASET, f, repo_type="dataset") for f in ["README.md", "split.csv", "fields.csv", "folds.csv"]}
split = {l.split(",")[0]: l.strip().split(",")[1] for l in open(meta["split.csv"]).read().splitlines()[1:]}
folds = {l.split(",")[0]: l.strip().split(",")[3] for l in open(meta["folds.csv"]).read().splitlines()[1:]}
if split.get(STEM) != "test":
    raise SystemExit(f"{STEM} is in split {split.get(STEM)!r}, not test")
img_p = hf_hub_download(DATASET, f"images/{STEM}.tif", repo_type="dataset", local_dir=str(DL))
msk_p = hf_hub_download(DATASET, f"masks/{STEM}.tif", repo_type="dataset", local_dir=str(DL))
img = tifffile.imread(img_p)
gt = tifffile.imread(msk_p)

settings = dict(normalize=True, flow_threshold=0.4, cellprob_threshold=0.0, diameter=None,
                min_size=15, max_size_fraction=1.0)
t0 = time.perf_counter()
model = models.CellposeModel(gpu=False, pretrained_model=weights, use_bfloat16=False)
t_load = time.perf_counter() - t0
t0 = time.perf_counter()
masks = np.asarray(model.eval(img.astype(np.float32), **settings)[0]).astype(np.uint16)
t_eval = time.perf_counter() - t0
tifffile.imwrite(WORK / "pv-vacuole.tif", masks, compression="zlib")

n_pred = int(len(np.unique(masks)) - 1)
n_gt = int(len(np.unique(gt)) - 1)
ap, tp, fp, fn = average_precision([gt.astype(np.int32)], [masks.astype(np.int32)], threshold=[0.5])
tp, fp, fn = int(tp[0, 0]), int(fp[0, 0]), int(fn[0, 0])
rec = dict(
    item="N687 v3 showcase, PV figure", generated=time.strftime("%Y-%m-%d"),
    command=f"CUDA_VISIBLE_DEVICES='' run_capped.sh 24G python -I {Path(__file__).resolve()} {STEM}",
    model=dict(key=KEY, display_name=raw_entry["display_name"], weights_name=raw_entry["name"], repo_id=repo,
               repo_file=wfile, url=f"https://huggingface.co/{repo}", weights_path=weights,
               sha256=w_sha, zoo_sha256=entry.sha256, sha256_match=True,
               why_default=("Newest non-alternative PV entry in spacr.model_zoo.BUNDLED_REMOTE_MODELS; "
                            "toxoplasma_pv_v5 (round 8) is labelled 'ALTERNATIVE, NOT BETTER ... prefer "
                            "toxoplasma_pv_v4'; the zoo has no explicit default flag and the Model Zoo screen "
                            "lists families newest version first; neither PV entry is alpha-gated"),
               card_test_metric=dict(set="11 anchor wells (10 nonempty scored, 683 objects)", f1_at_iou_0_5=0.8536,
                                     stock_cpsam_v2_f1=0.7648, cv_f1="0.8142 +/- 0.0145 (5-fold)")),
    image=dict(dataset=DATASET, dataset_url=f"https://huggingface.co/datasets/{DATASET}", licence="CC BY 4.0 (dataset card)",
               stem=STEM, file=f"images/{STEM}.tif", mask=f"masks/{STEM}.tif", split=split[STEM], fold=folds.get(STEM),
               image_sha256=sha256(img_p), mask_sha256=sha256(msk_p), shape=list(img.shape), dtype=str(img.dtype),
               channel="single Toxoplasma fluorescence channel, 2-D greyscale"),
    settings=dict(settings, channels="single grayscale channel, 2-D input (cellpose 4 has no channels argument)",
                  input="float32 of the raw uint16 values; cellpose 1st-99th percentile normalisation",
                  source=("r7 card and training/report.json give no eval settings; options of spacr "
                          "features/data/model_compare_2026-10-10/compare.py (the maintainer's PV head-to-head "
                          "that scored toxoplasma_pv_v4), Cellpose 4 defaults otherwise")),
    environment=dict(cellpose=version("cellpose"), torch=torch.__version__, python=platform.python_version(),
                     device="cpu fp32", torch_threads=torch.get_num_threads(), spacr_worktree=WORKTREE),
    timings_s=dict(weights_fetch=round(t_dl, 1), model_load=round(t_load, 1), eval=round(t_eval, 1)),
    counts=dict(predicted=n_pred, ground_truth=n_gt),
    comparison=dict(matching="cellpose.metrics.average_precision (Hungarian matching), IoU 0.5",
                    tp=tp, fp=fp, fn=fn, precision=round(tp / max(tp + fp, 1), 4),
                    recall=round(tp / max(tp + fn, 1), 4), f1_at_iou_0_5=round(2 * tp / max(2 * tp + fp + fn, 1), 4),
                    model_card_qc_for_this_field="qc/r7_perimage.csv: n_true 136, n_pred 125, tp 114, fp 11, fn 22, F1 0.8736"
                    if STEM == "plate7_K07_8" else None),
    masks_tif=str(WORK / "pv-vacuole.tif"),
)
json.dump(rec, open(RECORD, "w"), indent=1)
print(json.dumps(dict(counts=rec["counts"], comparison=rec["comparison"], timings=rec["timings_s"]), indent=1))
