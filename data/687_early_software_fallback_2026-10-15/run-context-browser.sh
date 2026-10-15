#!/bin/bash
set -u
exec 9>/mnt/wd4tb/scratch/home-b-coordination-20261014/heavy.lock
flock 9
export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 CUDA_VISIBLE_DEVICES=''
export TMPDIR=/mnt/wd4tb/scratch/home-b-website-hosted-audit-20261015
scratch=/mnt/wd4tb/scratch/home-b-website-hosted-audit-20261015
/usr/bin/time -v -o "$scratch/context-browser.time" /mnt/wd4tb/spacr-worktrees/codex-home-b-f370-generator-20261015/tools/run_capped.sh 4G timeout 75 node "$scratch/context-browser.mjs" > "$scratch/context-browser.log" 2>&1
result=$?
printf '%s\n' "$result" > "$scratch/context-browser.exit"
exit "$result"
