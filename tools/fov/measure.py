"""Run spaCR Measure (spacr.measure.measure_crop) on the merged fields, CPU only."""
import json
import os
import time
from common import R

SETTINGS = {
    "src": f"{R}/work/measure/merged",
    "channels": [0, 1],
    "cell_mask_dim": 2,
    "nucleus_mask_dim": 3,
    "pathogen_mask_dim": 4,
    "cell_min_size": 8000,
    "nucleus_min_size": 2000,
    "pathogen_min_size": 150,
    "save_png": False,
    "save_arrays": False,
    "plot": False,
    "measure_gpu": False,
    "n_jobs": 8,
    "verbose": False,
}

if __name__ == "__main__":
    from spacr.measure import measure_crop
    t = time.time()
    from spacr.settings import get_measure_crop_settings
    measure_crop(get_measure_crop_settings(dict(SETTINGS)))
    json.dump({"settings": SETTINGS, "seconds": round(time.time() - t, 1)},
              open(f"{R}/work/measure/run.json", "w"), indent=1)
    print("done", time.time() - t)
