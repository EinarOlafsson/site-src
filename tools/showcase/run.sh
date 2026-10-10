#!/usr/bin/env bash
# N687 model showcase: reproduce, CPU only. Order of steps.
set -euo pipefail
export CUDA_VISIBLE_DEVICES=''
export PYTHONPATH=/mnt/wd4tb/spacr-worktrees/claude-n687-20261010
PY=/home/olafsson/anaconda3/envs/spacr/bin/python
CAP="/mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G"
cd "$(dirname "$0")"
$PY fetch_weights.py ../data/weights.json            # HF download + sha256 check against spacr.model_zoo
$PY -I get_fields.py MTOC_Screen__mtocScreen_20250530_111302__plate1_L08_12_1
$CAP $PY run_models.py                               # 7 CPU runs (fp32), masks -> ../data/masks
$PY render.py                                        # webp/avif + showcase.json -> ../out
# tune_stock_nuclei.py: crop test that chose background=500, diameter=90 for stock nuclei on Hoechst
# bench_tile.py: bf16 vs fp32 CPU timing (bf16 ~9x slower)
