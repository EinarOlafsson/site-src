import os, sys, json, sqlite3
import numpy as np, pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import cm, colors
from PIL import Image
from skimage.segmentation import find_boundaries
from scipy.ndimage import binary_dilation
from skimage.morphology import disk

BASE = sys.argv[1]
D = os.path.join(BASE, 'data'); OUT = os.path.join(BASE, 'out')
WIN = (40, 940, 780, 1980)
OW, OH = 800, 600
R0, R1, C0, C1 = WIN
rgb = np.load(os.path.join(D, 'recon/field_rgb.npy'))[R0:R1, C0:C1]
cells = np.load(os.path.join(D, 'recon/cell_labels.npy'))[R0:R1, C0:C1]
sr0, sc0 = R0, C0
def segcrop(name):
    p = os.path.join(D, f'recon/{name}_labels_crop.npy')
    if not os.path.exists(p):
        print('MISSING', name); return np.zeros((R1 - R0, C1 - C0), np.int32)
    m = np.load(os.path.join(D, f'recon/{name}_labels_crop.npy'))
    return m[R0 - sr0:R1 - sr0, C0 - sc0:C1 - sc0]
nuc, pat = segcrop('nucleus'), segcrop('pathogen')
def min_size(m, n):
    ids, counts = np.unique(m, return_counts=True)
    small_ids = ids[(counts < n) & (ids != 0)]
    m = m.copy(); m[np.isin(m, small_ids)] = 0
    return m
nuc_raw_n, pat_raw_n = len(np.unique(nuc)) - 1, len(np.unique(pat)) - 1
nuc, pat = min_size(nuc, 2000), min_size(pat, 500)

def stretch(img, mask, lo=0.5, hi=99.7):
    out = np.zeros(img.shape, np.float32)
    for k in range(3):
        v = img[..., k][mask].astype(np.float32)
        a, b = np.percentile(v, lo), np.percentile(v, hi)
        out[..., k] = np.clip((img[..., k] - a) / max(b - a, 1e-6), 0, 1)
    return out
disp = stretch(rgb, cells > 0)
def small(a, nearest=False):
    if a.dtype == np.float32 or a.dtype == np.float64:
        im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
        return np.asarray(im.resize((OW, OH), Image.LANCZOS)).astype(np.float32) / 255
    return np.asarray(Image.fromarray(a.astype(np.int32)).resize((OW, OH), Image.NEAREST))
disp_s = small(disp)
cells_s, nuc_s, pat_s = small(cells), small(nuc), small(pat)

def save_webp(arr, name, q=80):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
    path = os.path.join(OUT, name)
    while True:
        im.save(path, 'WEBP', quality=q, method=6)
        if os.path.getsize(path) < 80_000 or q <= 30:
            break
        q -= 5
    return path, q, os.path.getsize(path)

res = {}
res['raw'] = save_webp(disp_s, '01_raw.webp')

def outline(lbl, width=1):
    b = find_boundaries(lbl, mode='inner')
    return binary_dilation(b, structure=disk(width)) if width > 0 else b
grey = disp_s.mean(-1, keepdims=True)
base = disp_s * 0.55
m = base.copy()
for lbl, col, w in ((cells_s, (1.0, 0.85, 0.2), 2), (nuc_s, (0.3, 0.9, 1.0), 1), (pat_s, (1.0, 0.35, 0.9), 1)):
    b = outline(lbl, w)
    m[b] = col
res['masks'] = save_webp(m, '02_masks.webp')

con = sqlite3.connect(os.path.join(D, 'hit/measurements/measurements.db'))
pt = pd.read_sql("select pathogen_cell_id, pathogen_channel_1_mean_intensity v from pathogen where rowID='r8' and columnID='c2' and fieldID='f4'", con)
feat = pt.groupby('pathogen_cell_id').v.mean()
dv = pd.read_csv(os.path.join(D, 'hit/plate1_dv.csv'))
dv = dv[(dv.plate == 'pplate1') & (dv.row == 'r8') & (dv.col == 'c2') & (dv.field == 'f4')]
pred = dv.set_index('object').pred

def coloured(values, cmap, vmin, vmax, name, label, ticks, fmt):
    norm = colors.Normalize(vmin, vmax)
    lut = np.zeros((cells_s.max() + 1, 4), np.float32)
    for o, v in values.items():
        if 0 < int(o) < len(lut):
            lut[int(o)] = cmap(norm(v))
    fill = lut[cells_s]
    a = (fill[..., 3:] > 0) * 0.6
    img = np.repeat(grey, 3, -1) * 0.8 * (1 - a) + fill[..., :3] * a
    b = outline(cells_s, 1)
    img[b] = fill[..., :3][b]
    fig = plt.figure(figsize=(OW / 100, OH / 100), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1]); ax.imshow(img); ax.axis('off')
    from matplotlib.patches import Rectangle
    ax.add_patch(Rectangle((0.5, 0.0), 0.5, 0.25, transform=ax.transAxes, color=(0, 0, 0), alpha=0.8, lw=0, zorder=3))
    cax = fig.add_axes([0.54, 0.105, 0.42, 0.04])
    cb = fig.colorbar(cm.ScalarMappable(norm, cmap), cax=cax, orientation='horizontal', ticks=ticks)
    cb.ax.set_xticklabels([fmt(t) for t in ticks])
    cb.ax.tick_params(colors='white', labelsize=22, length=4)
    cb.outline.set_edgecolor('white')
    cb.ax.set_title(label, color='white', fontsize=22, pad=6)
    tmp = os.path.join(D, name + '.png')
    fig.savefig(tmp, dpi=100); plt.close(fig)
    return save_webp(np.asarray(Image.open(tmp).convert('RGB')).astype(np.float32) / 255, name)

lo, hi = np.floor(feat.min() / 50) * 50, np.ceil(feat.max() / 50) * 50
res['measurements'] = coloured(feat, plt.get_cmap('viridis'), lo, hi, '03_measurements.webp',
                               'parasite ch1 intensity', [lo, (lo + hi) / 2, hi], lambda t: f'{t:.0f}')
res['classification'] = coloured(pred, plt.get_cmap('RdBu_r'), 0, 1, '04_classification.webp',
                                 'classifier score', [0, 0.5, 1], lambda t: f'{t:g}')
in_win = sorted(set(np.unique(cells)) - {0})
stats = dict(cells_in_window=len(in_win), feature_cells=int(feat.index.isin(in_win).sum()),
             pred_cells=int(pred.index.isin(in_win).sum()),
             feature_range=[float(feat.min()), float(feat.max())],
             pred_in_window=pred[pred.index.isin(in_win)].describe().round(3).to_dict(),
             pred_field=pred.describe().round(3).to_dict(),
             nucleus_objects_in_window=int(len(np.unique(nuc)) - 1), pathogen_objects_in_window=int(len(np.unique(pat)) - 1), nucleus_raw=nuc_raw_n, pathogen_raw=pat_raw_n)
json.dump(dict(panels={k: dict(path=v[0], quality=v[1], bytes=v[2]) for k, v in res.items()}, stats=stats),
          open(os.path.join(D, 'panel_stats.json'), 'w'), indent=1, default=str)
print(json.dumps(stats, indent=1, default=str)); print(res)
