"""Stack each field into a spaCR merged array: Hoechst, CellMask, cell, nucleus, vacuole labels."""
import os
import sys
import numpy as np
from common import R, load_field

dst = f"{R}/work/measure/merged"
os.makedirs(dst, exist_ok=True)
stems = [l.strip() for l in open(f"{R}/work/train_fields.txt") if l.strip()]
sizes = {"cell": [], "nuc": [], "pv": []}
for s in stems:
    f = load_field(s)
    name = s.split("__")[-1] + ".npy"
    arr = np.stack([f["hoechst"], f["cellmask"], f["cell"].astype(np.uint16), f["nuc"].astype(np.uint16), f["pv"].astype(np.uint16)], -1)
    np.save(f"{dst}/{name}", arr)
    for k in sizes:
        c = np.bincount(f[k].ravel())[1:]
        sizes[k] += list(c[c > 0])
for k, v in sizes.items():
    v = np.array(v)
    print(k, len(v), np.percentile(v, [1, 5, 10, 25, 50, 75, 95, 99]).astype(int))
