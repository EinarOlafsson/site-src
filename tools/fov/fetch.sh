#!/bin/bash
# Download the Hoechst/CellMask images and the cell, nucleus and vacuole masks of the listed fields
# (CC BY 4.0 cross-channel datasets) into $FOV_ROOT/dl/cc. Usage: ./fetch.sh fields.txt
set -e
P=/mnt/wd4tb/scratch/n687v3/fov
B=https://huggingface.co/datasets/einarolafsson
mkdir -p $P/dl/cc $P/dl/meta
for d in cross-channel-cell-from-hoechst cross-channel-toxoplasma-from-cellmask cross-channel-nuclei-from-cellmask; do
  curl -sfL "$B/$d/resolve/main/fields.csv" -o $P/dl/meta/$d.fields.csv
done
while read s; do
  [ -z "$s" ] && continue
  for spec in "cross-channel-cell-from-hoechst images hoechst" "cross-channel-cell-from-hoechst masks cell" \
              "cross-channel-nuclei-from-cellmask images cellmask" "cross-channel-nuclei-from-cellmask masks nuc" \
              "cross-channel-toxoplasma-from-cellmask masks_pv pv"; do
    set -- $spec
    [ -s $P/dl/cc/$s.$3.tif ] || curl -sfL "$B/$1/resolve/main/$2/$s.tif" -o $P/dl/cc/$s.$3.tif
  done
done < "$1"
