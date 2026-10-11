#!/bin/bash
# Usage: ./env.sh script.py [args]  -- CPU only, isolated HOME, capped RAM, python -I
P=/mnt/wd4tb/scratch/n687v3/phenotypes
D="$(dirname "$(readlink -f "$0")")"
export CUDA_VISIBLE_DEVICES=''
export QT_QPA_PLATFORM=offscreen
export MPLBACKEND=Agg
export HOME=$P/state
export SPACR_HOME=$P/state/.spacr
export MPLCONFIGDIR=$P/state/mpl
export TORCH_HOME=$P/state/torch
export HF_HOME=$P/state/hf
export OMP_NUM_THREADS=${OMP_NUM_THREADS:-8}
export SPACR_PHENO_ROOT=$P
export SPACR_SRC=/mnt/wd4tb/spacr-worktrees/claude-n687-v3
cd $P/work
exec /mnt/firecuda2/Claude/repo/spacr/tools/run_capped.sh 24G /home/olafsson/anaconda3/envs/spacr/bin/python -I -u -c 'import sys, runpy; sys.path.insert(0, sys.argv[1]); sys.argv = sys.argv[2:]; runpy.run_path(sys.argv[0], run_name="__main__")' "$D" "$D/$1" "${@:2}"
