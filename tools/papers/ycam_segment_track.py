"""Segment and track the Zenodo 4501412 Yellow Cameleon 3.60 time-lapse with spaCR.

Data: Mahlandt, Arts & Goedhart (2021) "Example data from timelapse fluorescence
imaging experiments", Zenodo 10.5281/zenodo.4501412, CC BY 4.0 (YCaM.zip).

Steps (CPU only):
  1. load 121 CFP/YFP frames
  2. segment cells with Cellpose (cpsam) through spacr.utils._choose_model
     on every STEP-th frame (YFP+CFP sum, background subtracted, 2x2 binned
     for CPU speed; masks are upsampled back to full size)
  3. link the label frames with spaCR's trackpy helper
     (spacr.timelapse._facilitate_trackin_with_adaptive_removal) and relabel with
     spacr.timelapse._relabel_masks_based_on_tracks
  4. per tracked cell and per frame: background-subtracted YFP/CFP ratio

Usage: python ycam_segment_track.py <YCaM dir> <work dir> [STEP]
Writes <work>/masks.npy (tracked labels on segmented frames), seg_frames.npy,
Y.npy, C.npy, tracks.csv, ratios.csv.
"""
import glob
import os
import sys
import time

import numpy as np
import pandas as pd
import tifffile

src, work = sys.argv[1], sys.argv[2]
step = int(sys.argv[3]) if len(sys.argv) > 3 else 4
os.makedirs(work, exist_ok=True)


def stack(channel):
    files = glob.glob(os.path.join(src, f"*_{channel}_t*.TIF"))
    files.sort(key=lambda f: int(f.rsplit("_t", 1)[1].split(".")[0]))
    return np.stack([tifffile.imread(f).astype(np.float32) for f in files])


Y, C = stack("w2YCam-YFP"), stack("w1YCam-CFP")
np.save(os.path.join(work, "Y.npy"), Y)
np.save(os.path.join(work, "C.npy"), C)
T = Y.shape[0]
bgY, bgC = float(np.percentile(Y, 5)), float(np.percentile(C, 5))

import torch

torch.set_num_threads(8)
from spacr.utils import _choose_model
from spacr.timelapse import (_facilitate_trackin_with_adaptive_removal,
                             _relabel_masks_based_on_tracks)

model = _choose_model("cpsam", torch.device("cpu"), object_type="cell")
seg_frames = list(range(0, T, step))
masks = []
for t in seg_frames:
    img = (Y[t] - bgY) + (C[t] - bgC)
    img = np.clip(img, 0, None)
    small = img.reshape(img.shape[0] // 2, 2, img.shape[1] // 2, 2).mean(axis=(1, 3))
    t0 = time.time()
    m, *_ = model.eval(small, diameter=None, flow_threshold=0.4, cellprob_threshold=0.0)
    m = np.repeat(np.repeat(m, 2, axis=0), 2, axis=1)
    masks.append(m.astype(np.int32))
    print(f"frame {t}: {m.max()} cells, {time.time() - t0:.1f}s", flush=True)
masks = np.stack(masks)

masks, features, tracks = _facilitate_trackin_with_adaptive_removal(
    masks.copy(), search_range=40, memory=3, min_mass=2000)
if "particle" in tracks.columns:
    tracks = tracks.rename(columns={"particle": "track_id"})
tracks["track_id"] = tracks["track_id"] + 1
tracked = _relabel_masks_based_on_tracks(masks, tracks)
tracks["frame_index"] = tracks["frame"].map(dict(enumerate(seg_frames)))
tracks.to_csv(os.path.join(work, "tracks.csv"), index=False)
np.save(os.path.join(work, "masks.npy"), tracked)
np.save(os.path.join(work, "seg_frames.npy"), np.array(seg_frames))

rows = []
seg = np.array(seg_frames)
for t in range(T):
    k = int(np.argmin(np.abs(seg - t)))
    lab = tracked[k]
    for tid in np.unique(lab)[1:]:
        px = lab == tid
        y = Y[t][px].mean() - bgY
        c = C[t][px].mean() - bgC
        rows.append({"frame": t, "track_id": int(tid), "yfp": y, "cfp": c,
                     "ratio": y / c if c > 0 else np.nan, "area": int(px.sum())})
pd.DataFrame(rows).to_csv(os.path.join(work, "ratios.csv"), index=False)
print("tracks:", sorted(tracks["track_id"].unique()))
