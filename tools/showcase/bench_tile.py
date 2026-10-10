import os, sys, time, json
os.environ["CUDA_VISIBLE_DEVICES"] = ""
import numpy as np, torch, tifffile
torch.set_num_threads(16)
from cellpose import models
w = json.load(open("/mnt/wd4tb/scratch/n687/models/data/weights.json"))["cell_from_hoechst_v1"]["weights"]
img = tifffile.imread(sys.argv[1]).astype(np.float32)[:512, :512]
for bf in [False, True]:
    m = models.CellposeModel(gpu=False, pretrained_model=w, use_bfloat16=bf)
    t = time.perf_counter(); r = m.eval(img, normalize=True, flow_threshold=0.4, cellprob_threshold=0.0)[0]
    print("bf16", bf, f"{time.perf_counter()-t:.1f}s", r.max(), flush=True)
