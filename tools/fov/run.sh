#!/bin/bash
# N687 v3 whole-field website panels. CPU only; every python runs through env.sh
# (CUDA_VISIBLE_DEVICES='', run_capped.sh 24G, python -I, PYTHONPATH = spaCR worktree claude-n687-v4).
set -e
cd /mnt/firecuda2/Claude/scratch/site-v3/tools/fov
mkdir -p /mnt/wd4tb/scratch/n687v3/fov/{dl,work,out,preview,state}
cp candidates.txt plate2_fields.txt /mnt/wd4tb/scratch/n687v3/fov/work/
cp /mnt/wd4tb/scratch/n687v3/fov/work/plate2_fields.txt /mnt/wd4tb/scratch/n687v3/fov/work/train_fields.txt
./fetch.sh candidates.txt
./fetch.sh plate2_fields.txt
./env.sh contact.py                 # candidate contact sheets (looked at by eye)
./env.sh window_search.py 900 1200  # per-candidate best 1200x900 windows, raw + mask previews
./env.sh make_merged.py             # 53 plate-2 fields -> spaCR merged stacks (Hoechst, CellMask, cell, nucleus, vacuole)
OMP_NUM_THREADS=2 ./env.sh measure.py   # spacr.measure.measure_crop on CPU
./env.sh classify.py                # spacr.ml.ml_analysis XGBoost, showcase field held out
./env.sh build.py                   # all panels, dark + light
./env.sh write_panels.py            # out/panels.json
./env.sh preview_page.py            # 1280 px and 375 px page simulations in preview/
