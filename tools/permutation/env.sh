#!/bin/bash
# Usage: tools/permutation/env.sh script.py [args] -- CPU only, isolated HOME, RAM capped at 24G.
export CUDA_VISIBLE_DEVICES=''
export QT_QPA_PLATFORM=offscreen
export MPLBACKEND=Agg
export PYTHONPATH=/mnt/wd4tb/spacr-worktrees/claude-n687-v4
S=/mnt/wd4tb/scratch/n687v3/perm
export HOME=$S/state
export SPACR_HOME=$S/state/.spacr
export MPLCONFIGDIR=$S/state/mpl
export SPACR_EXAMPLE_DATA=/mnt/wd4tb/scratch/n687v3/ols/dl/example_data
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8
export MKL_NUM_THREADS=8
mkdir -p "$S/run" "$HOME" "$SPACR_HOME" "$MPLCONFIGDIR"
cd "$S/run"
exec /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G /home/olafsson/anaconda3/envs/spacr/bin/python -I "$@"
