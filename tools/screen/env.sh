#!/bin/bash
# Usage: tools/screen/env.sh script.py [args] -- CPU only, isolated HOME, capped RAM
export CUDA_VISIBLE_DEVICES=''
export QT_QPA_PLATFORM=offscreen
export MPLBACKEND=Agg
export PYTHONPATH=/mnt/wd4tb/spacr-worktrees/claude-n687-v3
S=/mnt/wd4tb/scratch/n687v3/ols
export HOME=$S/state
export SPACR_HOME=$S/state/.spacr
export MPLCONFIGDIR=$S/state/mpl
export SPACR_EXAMPLE_DATA=$S/dl/example_data
export OMP_NUM_THREADS=8
cd $S/run
exec /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G /home/olafsson/anaconda3/envs/spacr/bin/python -I "$@"
