import sqlite3, sys, glob, os
import numpy as np, pandas as pd
from PIL import Image
DB, CROPS = sys.argv[1], sys.argv[2]
con = sqlite3.connect(DB)
cols = ['object_label'] + [f'cell_channel_{k}_centroid_weighted{s}-{a}' for k in range(3) for s in ('', '_local') for a in (0, 1)]
q = 'select ' + ','.join(f'"{c}"' for c in cols) + " from cell where rowID='r8' and columnID='c2' and fieldID='f4'"
df = pd.read_sql(q, con).set_index('object_label')
for p in sorted(glob.glob(os.path.join(CROPS, '*.png')))[:12]:
    o = int(os.path.basename(p).split('_')[-1][:-4])
    a = np.asarray(Image.open(p)).astype(float)
    sup = a.sum(-1) > 0
    rr, cc = np.nonzero(sup)
    r0, c0 = rr.min(), cc.min(); r1, c1 = rr.max(), cc.max()
    row = df.loc[o]
    ox = [row[f'cell_channel_{k}_centroid_weighted-0'] - row[f'cell_channel_{k}_centroid_weighted_local-0'] for k in range(3)]
    oy = [row[f'cell_channel_{k}_centroid_weighted-1'] - row[f'cell_channel_{k}_centroid_weighted_local-1'] for k in range(3)]
    Y, X = np.mgrid[:224, :224]
    out = []
    for ch in range(3):
        w = a[..., ch]
        cy, cx = (w * Y).sum() / w.sum(), (w * X).sum() / w.sum()
        out.append((round(cy, 1), round(cx, 1)))
    gw = [(round(row[f'cell_channel_{k}_centroid_weighted-0'], 1), round(row[f'cell_channel_{k}_centroid_weighted-1'], 1)) for k in range(3)]
    print(o, 'supp', (r0, c0, r1, c1), 'bbox origin', np.round(ox, 1), np.round(oy, 1), 'crop wc', out, 'global wc', gw)
