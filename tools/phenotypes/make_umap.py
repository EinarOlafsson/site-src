"""Image-measurement UMAP of 5,000 plate-1 cells of the public example screen, with spaCR.

stage 'embed': spacr.io._read_and_merge_data on plate1 measurements.db (all cells), seeded sample of 5,000,
six features (log1p, z-score), spacr.utils.reduction_and_clustering (UMAP + DBSCAN), crop candidates.
stage 'draw': themed figure (dark/light) from the embedding and the fetched crops.
Usage: env.sh make_umap.py embed | draw
"""
import json, os, sys, time
import numpy as np
import pandas as pd
import common
from common import R4, DL

DB = DL / 'screen_meas' / 'measurements' / 'measurements.db'
U = R4 / 'umap'; U.mkdir(parents=True, exist_ok=True)
FEATURES = ['nucleus_prcfo_count', 'pathogen_prcfo_count', 'cell_area', 'pathogen_area',
            'pathogen_channel_2_mean_intensity', 'cell_channel_2_mean_intensity']
UMAP = {'n_neighbors': 30, 'min_dist': 0.1, 'metric': 'euclidean', 'reduction_method': 'umap', 'random_seed': 0}
stage = sys.argv[1]

if stage == 'embed':
    t0 = time.time()
    from spacr.io import _read_and_merge_data
    from spacr.utils import reduction_and_clustering
    df, _ = _read_and_merge_data([str(DB)], ['cell', 'nucleus', 'pathogen'], False,
                                 nuclei_limit=None, pathogen_limit=None)
    n_all = len(df)
    df = df.dropna(subset=FEATURES)
    sample = df.sample(n=5000, random_state=0)
    X = np.log1p(sample[FEATURES].astype(float).clip(lower=0))
    X = ((X - X.mean()) / X.std()).to_numpy()
    sweep = []
    best = None
    for eps in (0.3, 0.4, 0.5, 0.6, 0.8):
        emb, lab, _ = reduction_and_clustering(X, UMAP['n_neighbors'], UMAP['min_dist'], UMAP['metric'],
                                               eps, 50, 'dbscan', reduction_method='umap', n_jobs=8,
                                               random_seed=UMAP['random_seed'])
        k = len(set(lab) - {-1}); noise = float((lab == -1).mean())
        sweep.append({'eps': eps, 'min_samples': 50, 'clusters': k, 'noise': noise})
        print(sweep[-1], flush=True)
        if best is None or (abs(k - 5) < abs(best[2] - 5)) or (k == best[2] and noise < best[3]):
            best = (eps, emb, k, noise, lab)
    eps, emb, k, noise, lab = best
    from sklearn.metrics import silhouette_score
    keep = lab != -1
    sil = float(silhouette_score(emb[keep], lab[keep])) if k > 1 else None
    nN = sample['nucleus_prcfo_count'].fillna(0).to_numpy(); nP = sample['pathogen_prcfo_count'].fillna(0).to_numpy()
    ids = sorted(set(lab) - {-1}, key=lambda l: (np.median(nN[lab == l]), np.median(nP[lab == l]), -np.sum(lab == l)))
    remap = {old: i + 1 for i, old in enumerate(ids)}
    cl = np.array([remap.get(l, 0) for l in lab])
    out = sample[FEATURES].copy()
    out['prcfo'] = sample.index.astype(str)
    out['x'], out['y'], out['cluster'] = emb[:, 0], emb[:, 1], cl
    con = __import__('sqlite3').connect(f'file:{DB}?mode=ro', uri=True)
    png = pd.read_sql('select prcfo, png_path from png_list', con)
    png['prcfo'] = png['prcfo'].str.replace(r'^pplate', 'plate', regex=True)
    png = png.set_index('prcfo')
    out['png_path'] = png.reindex(out['prcfo'])['png_path'].to_numpy()
    out.to_csv(U / 'cells.csv', index=False)
    rng = np.random.default_rng(0)
    cand = {}
    for c in range(1, len(ids) + 1):
        idx = np.where(cl == c)[0]
        cen = np.median(emb[idx], axis=0)
        near = idx[np.argsort(np.linalg.norm(emb[idx] - cen, axis=1))[:60]]
        near = near[np.argsort(-out['pathogen_channel_2_mean_intensity'].to_numpy()[near])][:30]
        rng.shuffle(near)
        seen, chosen = set(), []
        for i in near:
            field = out['prcfo'].iloc[i].rsplit('_', 1)[0]
            if field in seen or not isinstance(out['png_path'].iloc[i], str):
                continue
            seen.add(field); chosen.append(int(i))
            if len(chosen) == 8:
                break
        cand[c] = chosen
    comp = {}
    for c in range(1, len(ids) + 1):
        m = cl == c
        comp[c] = {'n': int(m.sum()), 'nuclei': pd.Series(nN[m]).astype(int).value_counts().sort_index().to_dict(),
                   'pathogen_objects': pd.Series(nP[m]).astype(int).value_counts().sort_index().to_dict(),
                   'median_nuclei': float(np.median(nN[m])), 'median_pathogen_objects': float(np.median(nP[m]))}
    rec = {'db': str(DB), 'cells_in_merged_table': n_all, 'sample': 5000, 'sample_seed': 0, 'features': FEATURES,
           'preprocessing': 'log1p then z-score per feature', 'umap': UMAP, 'dbscan_sweep': sweep,
           'dbscan': {'eps': eps, 'min_samples': 50}, 'clusters': len(ids), 'noise_fraction': noise,
           'silhouette_assigned': sil, 'composition': comp, 'candidates': {c: [out['png_path'].iloc[i] for i in v] for c, v in cand.items()},
           'seconds': time.time() - t0}
    json.dump(rec, open(U / 'umap_record.json', 'w'), indent=1, default=str)
    print(json.dumps({k: rec[k] for k in ('cells_in_merged_table', 'dbscan', 'clusters', 'noise_fraction', 'silhouette_assigned', 'seconds')}, default=str))
    print(json.dumps(comp, indent=0, default=str))

if stage == 'draw':
    import matplotlib
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle
    from scipy.spatial import ConvexHull
    from PIL import Image
    app = common.qt_app()
    from spacr.plot import save_figure
    from spacr.figures.style import figure_style, theme_target
    from common import set_page_theme, to_webp_on
    rec = json.load(open(U / 'umap_record.json'))
    df = pd.read_csv(U / 'cells.csv')
    emb = df[['x', 'y']].to_numpy(); cl = df['cluster'].to_numpy()
    K = int(cl.max())
    CROPS = DL / 'umap_crops'
    picks = {}
    for c in range(1, K + 1):
        scored = []
        for k, p in enumerate(rec['candidates'][str(c)]):
            f = CROPS / os.path.basename(p)
            if not f.exists():
                continue
            a = np.asarray(Image.open(f).convert('L'))
            scored.append(((a[40:184, 40:184] < 3).mean(), k, f))
        picks[c] = [f for _, _, f in sorted(scored)[:4]]
    rec['gallery'] = {c: [p.name for p in v] for c, v in picks.items()}
    cmap = matplotlib.colormaps['viridis']
    colours = {c: cmap(v) for c, v in zip(range(1, K + 1), np.linspace(0.42, 0.97, K))}

    def show(path):
        a = np.asarray(Image.open(path).convert('RGB')).astype(float)
        out = np.zeros_like(a)
        for ch in range(3):
            lo, hi = np.percentile(a[..., ch], 1), np.percentile(a[..., ch], 99.5)
            out[..., ch] = np.clip((a[..., ch] - lo) / max(hi - lo, 1e-9), 0, 1)
        return out

    images = {}
    size = None
    for theme in ('light', 'dark'):
        t = set_page_theme(theme)
        with figure_style(theme_target()):
            fig = plt.figure(figsize=(12, 7.0), dpi=100, facecolor=t['bg'])
            ax = fig.add_axes([0.06, 0.08, 0.50, 0.89], facecolor=t['bg'])
            noise = cl == 0
            ax.scatter(emb[noise, 0], emb[noise, 1], s=3, c=t['muted'], alpha=0.5, linewidths=0)
            for c in range(1, K + 1):
                m = cl == c
                ax.scatter(emb[m, 0], emb[m, 1], s=4, color=colours[c], alpha=0.55, linewidths=0)
                pts = emb[m]
                if len(pts) >= 3:
                    h = ConvexHull(pts); v = np.append(h.vertices, h.vertices[0])
                    ax.plot(pts[v, 0], pts[v, 1], color=colours[c], lw=1.0, alpha=0.9)
                cx, cy = np.median(pts, axis=0)
                ax.text(cx, cy, str(c), ha='center', va='center', fontsize=12, weight='bold', color='#0f1115', zorder=5,
                        bbox=dict(boxstyle='circle,pad=0.25', facecolor=colours[c], edgecolor='none'))
            ax.set_xticks([]); ax.set_yticks([])
            for s in ('top', 'right'):
                ax.spines[s].set_visible(False)
            for s in ('left', 'bottom'):
                ax.spines[s].set_color(t['fg'])
            ax.set_xlabel('UMAP 1', color=t['fg'], fontsize=13); ax.set_ylabel('UMAP 2', color=t['fg'], fontsize=13)
            top, row_h = 0.97, 0.89 / K
            for r, c in enumerate(range(1, K + 1)):
                y0 = top - (r + 1) * row_h
                lab = fig.add_axes([0.60, y0, 0.08, row_h]); lab.set_axis_off()
                lab.text(0.0, 0.62, str(c), color=colours[c], fontsize=16, weight='bold', va='center',
                         transform=lab.transAxes)
                lab.text(0.0, 0.30, f"n = {int((cl == c).sum()):,}", color=t['muted'], fontsize=10.5, va='center',
                         transform=lab.transAxes)
                for j, p in enumerate(picks[c]):
                    w = 0.075
                    tile = fig.add_axes([0.67 + j * (w + 0.008), y0 + 0.006, w, row_h - 0.012])
                    tile.imshow(show(p)); tile.set_xticks([]); tile.set_yticks([])
                    for s in tile.spines.values():
                        s.set_color(colours[c]); s.set_linewidth(2.0)
            png = save_figure(fig, U / f'umap.{theme}.png', fmt='png', dpi=100, close=True, save_mode='screen',
                              facecolor=t['bg'])
        info = to_webp_on(png, R4 / f'umap.{theme}.webp', t['bg'], size=size)
        size = (info['width'], info['height'])
        images[theme] = info
    rec['images'] = images
    json.dump(rec, open(U / 'umap_record.json', 'w'), indent=1, default=str)
    print(json.dumps(images, indent=1), json.dumps(rec['gallery'], indent=0))
