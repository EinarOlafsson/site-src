import sqlite3, sys, glob, os, json
import numpy as np, pandas as pd
from PIL import Image
from scipy import ndimage as ndi

DB, CROPS, OUT = sys.argv[1:4]
con = sqlite3.connect(DB)
cols = ['object_label', 'cell_area'] + [f'cell_channel_0_centroid_weighted{s}-{a}' for s in ('', '_local') for a in (0, 1)]
q = 'select ' + ','.join(f'"{c}"' for c in cols) + " from cell where rowID='r8' and columnID='c2' and fieldID='f4'"
df = pd.read_sql(q, con)
df['object_label'] = df.object_label.astype(int)
df = df.set_index('object_label')
Y, X = np.mgrid[:224, :224]
place = {}
for p in sorted(glob.glob(os.path.join(CROPS, '*.png'))):
    o = int(os.path.basename(p).split('_')[-1][:-4])
    a = np.asarray(Image.open(p))
    sup = ndi.binary_fill_holes(a.sum(-1) > 0)
    rr, cc = np.nonzero(sup)
    r0, c0, r1, c1 = rr.min(), cc.min(), rr.max(), cc.max()
    row = df.loc[o]
    gr = row['cell_channel_0_centroid_weighted-0']; gc = row['cell_channel_0_centroid_weighted-1']
    w = a[..., 2].astype(float)
    dr_w = gr - (w * Y).sum() / w.sum(); dc_w = gc - (w * X).sum() / w.sum()
    br = row['cell_channel_0_centroid_weighted-0'] - row['cell_channel_0_centroid_weighted_local-0']
    bc = row['cell_channel_0_centroid_weighted-1'] - row['cell_channel_0_centroid_weighted_local-1']
    clipped = (r0 == 0 or c0 == 0 or r1 == 223 or c1 == 223)
    dr_b, dc_b = br - r0, bc - c0
    top_ok, left_ok = r0 > 0, c0 > 0
    dr = dr_b if top_ok else dr_w
    dc = dc_b if left_ok else dc_w
    place[o] = dict(dr=int(round(dr)), dc=int(round(dc)), clipped=bool(clipped),
                    dr_w=float(dr_w), dc_w=float(dc_w), dr_b=float(dr_b), dc_b=float(dc_b),
                    top_ok=bool(top_ok), left_ok=bool(left_ok), visible_px=int(sup.sum()),
                    cell_area=float(row['cell_area']))
H = max(v['dr'] for v in place.values()) + 224
W = max(v['dc'] for v in place.values()) + 224
off_r = -min(0, min(v['dr'] for v in place.values())); off_c = -min(0, min(v['dc'] for v in place.values()))
canvas = np.zeros((H + off_r, W + off_c, 3), np.uint8)
labels = np.zeros(canvas.shape[:2], np.int32)
overlap = 0
for p in sorted(glob.glob(os.path.join(CROPS, '*.png'))):
    o = int(os.path.basename(p).split('_')[-1][:-4])
    a = np.asarray(Image.open(p))
    sup = ndi.binary_fill_holes(a.sum(-1) > 0)
    v = place[o]
    r, c = v['dr'] + off_r, v['dc'] + off_c
    sl = (slice(r, r + 224), slice(c, c + 224))
    tgt = labels[sl]
    free = sup & (tgt == 0)
    overlap += int((sup & (tgt != 0)).sum())
    canvas[sl][free] = a[free]
    tgt[free] = o
os.makedirs(OUT, exist_ok=True)
np.save(os.path.join(OUT, 'field_rgb.npy'), canvas)
np.save(os.path.join(OUT, 'cell_labels.npy'), labels)
json.dump(dict(offset=[off_r, off_c], shape=list(canvas.shape), overlap_px=overlap, cells=place),
          open(os.path.join(OUT, 'placement.json'), 'w'), indent=1)
Image.fromarray(canvas).resize((canvas.shape[1] // 3, canvas.shape[0] // 3)).save(os.path.join(OUT, 'field_preview.png'))
d = pd.DataFrame(place).T
print(canvas.shape, 'overlap px', overlap, 'clipped', int(d.clipped.sum()), 'of', len(d))
u = d[d.top_ok & d.left_ok]
print('weighted-vs-bbox offset disagreement (unclipped top/left):', (u.dr_w - u.dr_b).abs().describe().round(2).to_dict(), (u.dc_w - u.dc_b).abs().describe().round(2).to_dict())
print('visible / measured area:', (d.visible_px / d.cell_area).describe().round(2).to_dict())
