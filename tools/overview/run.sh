#!/usr/bin/env bash
set -euo pipefail
SITE=/mnt/firecuda2/Claude/scratch/site-v3
P=$SITE/tools/pipeline
O=$SITE/tools/overview
D=/mnt/wd4tb/scratch/n687/pipeline/data
W=/mnt/wd4tb/scratch/n687v3/overview/work
OUT=/mnt/wd4tb/scratch/n687v3/overview
R=/mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh
PY=/home/olafsson/anaconda3/envs/spacr/bin/python
export CUDA_VISIBLE_DEVICES='' MPLBACKEND=Agg OMP_NUM_THREADS=8
export PYTHONPATH=/mnt/wd4tb/spacr-worktrees/claude-n687-v3
mkdir -p $W/recon $W/regress
cp $D/hit/plate1_dv.csv $D/hit/plate_1_unique_combinations.csv $W/regress/
cd $P
$R 16G $PY -I reconstruct.py $D/hit/measurements/measurements.db $D/crops_H02_f4 $W/recon
$R 16G $PY segment.py $W/recon 40 940 780 1980
rm -rf $W/regress/results $W/regress/settings
$R 16G $PY regress.py $W/regress transform=None outlier_detection=False min_cells_per_well=10
cd $O
$R 16G $PY build_overview.py $D $W $OUT
$R 16G $PY -I write_panels_json.py $W $OUT $O/run.sh
