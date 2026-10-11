"""Round 4: themed (dark #0f1115 / light #fafaf9) versions of the Phenotypes figures, and input-gradient saliency.

Reuses the XGBoost run (work/ml_artifacts.pkl) and the MobileNetV3-small checkpoint of make_deep.py.
Usage: env.sh make_r4.py [figure ...]   (default: all)
"""
import json, os, pickle, sys, time
import numpy as np
import pandas as pd
import common
from common import WORK, R4, THEMES, set_page_theme, ink_axes, to_webp_on
app = common.qt_app()
import torch
torch.set_num_threads(int(os.environ.get('OMP_NUM_THREADS', '8')))
import matplotlib.pyplot as plt
from PIL import Image
from spacr.plot import save_figure, plot_image_grid, plot_feature_importance
from spacr.figures.style import figure_style, theme_target, _apply_user_style

WANT = set(sys.argv[1:]) or {'crops', 'saliency', 'beeswarm', 'waterfall', 'importance'}
R4.mkdir(parents=True, exist_ok=True)
TMP = R4 / 'work'; TMP.mkdir(exist_ok=True)
rec_path = R4 / 'r4_numbers.json'
REC = json.load(open(rec_path)) if rec_path.exists() else {}
cnn = json.load(open(WORK / 'cnn_numbers.json'))
run = json.load(open(WORK / 'deep_run.json'))
root = run['root']
classes = run['train_settings']['class_folder_names']
NAMES = {classes[0]: 'SAG1', classes[1]: 'GRA14'}
PCT = [1, 99.5]


def themed_pair(name, draw, size_from='light'):
    """draw(theme_dict) -> png path; writes <name>.light.webp and <name>.dark.webp at identical size."""
    out, size = {}, None
    for theme in ('light', 'dark'):
        t = set_page_theme(theme)
        png = draw(theme, t)
        info = to_webp_on(png, R4 / f'{name}.{theme}.webp', t['bg'], size=size)
        size = (info['width'], info['height'])
        out[theme] = info
    return out


def stretch(img):
    out = np.zeros_like(img)
    for c in range(img.shape[2]):
        lo, hi = np.percentile(img[..., c], PCT[0]), np.percentile(img[..., c], PCT[1])
        out[..., c] = np.clip((img[..., c] - lo) / max(hi - lo, 1e-9), 0, 1)
    return out


def crop_path(f):
    cls = f"c{1 if f.split('_')[1].endswith('01') else 2}"
    return os.path.join(root, 'test', cls, f)


images = REC.setdefault('images', {})

if 'crops' in WANT:
    ex = cnn['example_crops']
    grids = {}
    for cls in classes:
        paths = [crop_path(e['file']) for e in ex[cls]]
        fig = plot_image_grid(paths, PCT)
        grids[cls] = save_figure(fig, TMP / f'grid_{cls}.png', fmt='png', dpi=100, close=True, save_mode='screen')

    def draw(theme, t):
        with figure_style(theme_target()):
            fig, axes = plt.subplots(1, 2, figsize=(12, 6.5), facecolor=t['bg'])
            for ax, cls in zip(axes, classes):
                ax.imshow(Image.open(grids[cls])); ax.set_axis_off()
                ax.set_title(NAMES[cls], fontsize=16, pad=8, color=t['fg'])
            fig.subplots_adjust(left=0.01, right=0.99, top=0.92, bottom=0.01, wspace=0.04)
            return save_figure(fig, TMP / f'crops.{theme}.png', fmt='png', dpi=100, close=True,
                               save_mode='screen', facecolor=t['bg'])
    images['class_example_crops'] = themed_pair('class_example_crops', draw)

if 'saliency' in WANT:
    from spacr.deep_spacr import _load_inference_model
    from spacr.classification_pixels import checkpoint_policy
    from spacr.io import generate_loaders
    from spacr.attribution import AttributionMapGenerator
    from scipy.ndimage import binary_erosion, gaussian_filter
    BLUR = 2.0
    model, metadata = _load_inference_model(run['result'], torch.device('cpu'))
    loader, _, _ = generate_loaders(root, mode='test', image_size=224, batch_size=64, classes=classes, n_jobs=0,
                                    validation_split=0.0, normalize=True, channels=['r', 'g', 'b'], augment=False,
                                    crop_loading_policy=checkpoint_policy(metadata))
    X, F = [], []
    for data, target, names in loader:
        X.append(data); F.extend(os.path.basename(str(n)) for n in names)
    X = torch.cat(X)
    K = 5
    files = [e['file'] for cls in classes for e in cnn['example_crops'][cls][:K]]
    sel = [F.index(f) for f in files]
    Xs = X[sel].clone()
    SG = {'smoothgrad_samples': 32, 'smoothgrad_sigma': 0.15}
    vg = AttributionMapGenerator(model, method='saliency', model_type='mobilenet_v3_small')
    v_maps, v_pred = vg.compute_maps_and_predictions(Xs.clone())
    sg = AttributionMapGenerator(model, method='saliency', model_type='mobilenet_v3_small', **SG)
    s_maps, s_pred = sg.compute_maps_and_predictions(Xs.clone())
    stats = []
    raws, masks, maps = [], [], []
    for j, f in enumerate(files):
        raw8 = np.asarray(Image.open(crop_path(f)).convert('RGB'))
        mask = raw8.max(axis=2) > 0
        m = np.abs(s_maps[j].numpy()); mv = np.abs(v_maps[j].numpy())
        stats.append({'file': f, 'class': NAMES[classes[0 if j < K else 1]], 'predicted': int(s_pred[j]),
                      'cell_pixel_fraction': float(mask.mean()),
                      'smoothgrad_share_inside_cell': float(m[mask].sum() / max(m.sum(), 1e-12)),
                      'vanilla_share_inside_cell': float(mv[mask].sum() / max(mv.sum(), 1e-12))})
        shown = binary_erosion(mask, iterations=2)
        interior = binary_erosion(mask, iterations=8)
        ms = gaussian_filter(m, BLUR)
        vals = ms[interior]
        lo, hi = np.percentile(vals, 40), np.percentile(vals, 99.5)
        u = np.clip((ms - lo) / max(hi - lo, 1e-12), 0, 1) * shown
        raws.append(stretch(raw8.astype(float) / 255)); masks.append(mask); maps.append(u)
    REC['saliency'] = {'function': "spacr.attribution.AttributionMapGenerator(method='saliency', smoothgrad_samples=32, smoothgrad_sigma=0.15)",
                       'backend': 'captum Saliency (absolute input gradient of the predicted-class logit), SmoothGrad-averaged over 32 noisy copies',
                       'vanilla_checked_with': "AttributionMapGenerator(method='saliency') without SmoothGrad",
                       'checkpoint': run['result'], 'per_cell': stats,
                       'display': 'display only: |SmoothGrad| blurred with a Gaussian of sigma 2 px, scaled between its 40th and 99.5th percentile over pixels at least 8 px inside the cell, drawn as magma heat (alpha = scaled value^0.8) over the dimmed grey crop and only inside the cell (crop mask eroded 2 px)'}
    from matplotlib import colormaps
    cmap = colormaps['magma']

    def draw(theme, t):
        with figure_style(theme_target()):
            fig, axes = plt.subplots(4, K, figsize=(2.4 * K + 0.35, 2.4 * 4), facecolor=t['bg'])
            for j in range(2 * K):
                r = 0 if j < K else 2
                c = j % K
                axes[r, c].imshow(raws[j])
                grey = raws[j].mean(axis=2)
                base = np.dstack([grey * 0.55] * 3)
                heat = cmap(maps[j])[..., :3]
                a = (maps[j] ** 0.8)[..., None]
                comp = base * (1 - a) + heat * a
                comp[~masks[j]] = 0
                axes[r + 1, c].imshow(comp)
            for ax in axes.flat:
                ax.set_xticks([]); ax.set_yticks([])
                for sp in ax.spines.values():
                    sp.set_visible(False)
            for r, lab in ((0, 'SAG1'), (2, 'GRA14')):
                axes[r, 0].set_ylabel(lab, fontsize=14, color=t['fg'])
                axes[r + 1, 0].set_ylabel('saliency', fontsize=12, color=t['muted'])
            fig.subplots_adjust(left=0.035, right=0.998, top=0.998, bottom=0.002, wspace=0.03, hspace=0.03)
            return save_figure(fig, TMP / f'saliency.{theme}.png', fmt='png', dpi=100, close=True,
                               save_mode='screen', facecolor=t['bg'])
    images['saliency_maps'] = themed_pair('saliency_maps', draw)

A = pickle.load(open(WORK / 'ml_artifacts.pkl', 'rb'))
ml = json.load(open(WORK / 'ml_numbers.json'))

if 'importance' in WANT:
    def draw(theme, t):
        fi = A['feature_importance_df'].head(15).iloc[::-1]
        fig = plot_feature_importance(fi)
        fig.set_size_inches(10, 6.2)
        ink_axes(fig, t)
        fig.tight_layout()
        return save_figure(fig, TMP / f'importance.{theme}.png', fmt='png', dpi=120, close=True,
                           save_mode='screen', facecolor=t['bg'], bbox_inches='tight', pad_inches=0.15)
    images['xgb_feature_importance'] = themed_pair('xgb_feature_importance', draw)

if 'beeswarm' in WANT or 'waterfall' in WANT:
    from spacr.ml import _shap_values
    sv, note = _shap_values(A['model'], A['X_train'], A['X_test'])
    if len(sv.shape) == 3:
        sv = sv[..., 1]
    X_test = A['X_test']

if 'beeswarm' in WANT:
    from spacr.qt.widgets.fast_plots import FastPlot
    matrix = np.asarray(sv.values, float)
    TOP = 12
    order = np.argsort(np.nanmean(np.abs(matrix), axis=0))[::-1][:TOP]
    names = [str(X_test.columns[i]) for i in order]

    def draw(theme, t):
        plot = FastPlot(title='', x_label='SHAP value (log-odds of GRA14 class)', y_label='')
        plot.RANK_LABEL = 60
        plot.resize(1200, 34 * TOP + 140); plot.show(); app.processEvents()
        plot.add_beeswarm(names, matrix[:, order], X_test[names].to_numpy(dtype=float))
        app.processEvents(); plot.resize(1200, 34 * TOP + 140); app.processEvents()
        path = str(TMP / f'beeswarm.{theme}.png')
        plot.export_styled(path, ink=t['fg'], background=t['bg'])
        plot.close(); plot.deleteLater(); app.processEvents()
        im = Image.open(path).convert('RGB')
        padded = Image.new('RGB', (im.width + 24, im.height + 16), t['bg'])
        padded.paste(im, (16, 8))
        padded.save(path)
        return path
    images['shap_beeswarm'] = themed_pair('shap_beeswarm', draw)

if 'waterfall' in WANT:
    import shap
    wf = ml['waterfall_cell']
    pick = list(X_test.index).index(wf['prcfo']) if wf['prcfo'] in list(X_test.index) else None
    if pick is None:
        pick = [i for i, v in enumerate(X_test.index) if str(v) == wf['prcfo']][0]
    from matplotlib.colors import to_hex

    def draw(theme, t):
        with figure_style(theme_target()):
            shap.plots.waterfall(sv[pick], max_display=10, show=False)
            fig = plt.gcf()
            fig.set_size_inches(10, 6.0)
            keep = {'#ff0051', '#008bfb', '#ffffff'}
            ink_axes(fig, t, keep_text_colours={'#ff0051', '#008bfb'})
            for ax in fig.axes:
                for txt in ax.texts:
                    if to_hex(txt.get_color()).lower() == '#ffffff' and theme == 'light':
                        pass
                for lab in ax.get_yticklabels():
                    lab.set_color(t['fg'])
                for line in ax.lines:
                    if to_hex(line.get_color()).lower() in ('#bbbbbb', '#cccccc', '#000000', '#999999', '#888888'):
                        line.set_color(t['muted'])
            return save_figure(fig, TMP / f'waterfall.{theme}.png', fmt='png', dpi=120, close=True,
                               save_mode='screen', facecolor=t['bg'], bbox_inches='tight', pad_inches=0.12)
    images['shap_waterfall_cell'] = themed_pair('shap_waterfall_cell', draw)

json.dump(REC, open(rec_path, 'w'), indent=1, default=str)
print(json.dumps(images, indent=1))
