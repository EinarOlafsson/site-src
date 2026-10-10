#!/bin/bash
# Usage: scripts/env.sh script.py [args]  -- runs CPU-only, isolated HOME, capped RAM
export CUDA_VISIBLE_DEVICES=''
export QT_QPA_PLATFORM=offscreen
export PYTHONPATH=/mnt/wd4tb/spacr-worktrees/claude-n687-20261010
export HOME=/mnt/wd4tb/scratch/n687/examples/state
export SPACR_HOME=/mnt/wd4tb/scratch/n687/examples/state/.spacr
export MPLCONFIGDIR=/mnt/wd4tb/scratch/n687/examples/state/mpl
export OMP_NUM_THREADS=8
cd /mnt/wd4tb/scratch/n687/examples/scripts
exec /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G /home/olafsson/anaconda3/envs/spacr/bin/python "$@"
