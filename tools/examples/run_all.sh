#!/bin/bash
# Reproduce every N687 example figure (CPU only). Datasets are expected in ../data/
# (huggingface_hub snapshot_download of einarolafsson/spacr-example-{dose,control-chart,hit}).
set -e
cd /mnt/wd4tb/scratch/n687/examples/scripts
./env.sh make_dose.py
./env.sh make_control_chart.py
MPLBACKEND=Agg ./env.sh make_hit.py
MPLBACKEND=Agg ./env.sh make_hit_figure.py
/home/olafsson/anaconda3/bin/python write_manifest.py
