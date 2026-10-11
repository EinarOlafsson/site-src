#!/bin/bash
# Usage: tools/themed/env.sh script.py [args] -- CPU only, isolated HOME, RAM capped at 24G.
export CUDA_VISIBLE_DEVICES=''
export QT_QPA_PLATFORM=offscreen
export MPLBACKEND=Agg
export PYTHONPATH=/mnt/wd4tb/spacr-worktrees/claude-n687-v3
export HOME=/mnt/wd4tb/scratch/n687v3/themed/state
export SPACR_HOME=/mnt/wd4tb/scratch/n687v3/themed/state/.spacr
export MPLCONFIGDIR=/mnt/wd4tb/scratch/n687v3/themed/state/mpl
export OMP_NUM_THREADS=8
cd "$(dirname "$0")"
exec /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G /home/olafsson/anaconda3/envs/spacr/bin/python "$@"
