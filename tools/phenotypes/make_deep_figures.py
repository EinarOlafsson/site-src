"""Figures from the CNN of make_deep.py on its held-out test wells: per-class example crops,
saliency maps (spacr.utils.SaliencyMapGenerator, as the Explain/activation-map screen uses), and test metrics."""
import json, os, sys, time
import numpy as np
import pandas as pd
import common
from common import WORK, OUT, to_webp
app = common.qt_app()
import torch
torch.set_num_threads(int(os.environ.get('OMP_NUM_THREADS', '8')))
import matplotlib.pyplot as plt
from PIL import Image
from sklearn.metrics import roc_auc_score, average_precision_score, accuracy_score, confusion_matrix
from spacr.plot import save_figure, plot_image_grid
from spacr.figures.style import figure_style, theme_target
from spacr.deep_spacr import _load_inference_model
from spacr.classification_pixels import checkpoint_policy
from spacr.io import generate_loaders
from spacr.utils import SaliencyMapGenerator

t0 = time.time()
run = json.load(open(WORK / 'deep_run.json'))
root = run['root']
model_path = run['result']
model, metadata = _load_inference_model(model_path, torch.device('cpu'))
classes = run['train_settings']['class_folder_names']
loader, _, _ = generate_loaders(root, mode='test', image_size=224, batch_size=64, classes=classes,
                                n_jobs=0, validation_split=0.0, normalize=True, channels=['r', 'g', 'b'],
                                augment=False, crop_loading_policy=checkpoint_policy(metadata))
X, Y, F = [], [], []
for data, target, names in loader:
    X.append(data); Y.append(target); F.extend(names)
X = torch.cat(X); Y = torch.cat(Y).numpy().astype(int).ravel()
with torch.no_grad():
    logits = model(X)
if logits.ndim > 1 and logits.shape[-1] > 1:
    prob = torch.softmax(logits, -1)[:, 1].numpy()
else:
    prob = torch.sigmoid(logits.squeeze()).numpy()
pred = (prob >= 0.5).astype(int)
F = [os.path.basename(str(f)) for f in F]
wells = sorted({f.split('_')[1] for f in F})
numbers = {'model_path': model_path, 'n_test': int(len(Y)), 'n_test_neg': int((Y == 0).sum()), 'n_test_pos': int((Y == 1).sum()),
           'test_wells': wells, 'accuracy': float(accuracy_score(Y, pred)), 'roc_auc': float(roc_auc_score(Y, prob)),
           'average_precision': float(average_precision_score(Y, prob)),
           'confusion_counts': confusion_matrix(Y, pred, labels=[0, 1]).tolist(), 'classes': classes}
pd.DataFrame({'file': F, 'label': Y, 'prob_gra14': prob}).to_csv(WORK / 'cnn_test_predictions.csv', index=False)
print(json.dumps(numbers, indent=1))

files = {cls: os.path.join(root, 'test', cls) for cls in classes}
N = 9
picked = {}
for k, cls in enumerate(classes):
    idx = np.where((Y == k) & (pred == k))[0]
    conf = prob[idx] if k == 1 else 1 - prob[idx]
    order = idx[np.argsort(-conf)][:N]
    picked[cls] = [int(i) for i in order]
numbers['example_crops'] = {cls: [{'file': F[i], 'prob_gra14': float(prob[i])} for i in picked[cls]] for cls in classes}

PCT = [1, 99.5]
panels = []
for cls in classes:
    paths = [os.path.join(files[cls], F[i]) for i in picked[cls]]
    fig = plot_image_grid(paths, PCT)
    png = save_figure(fig, WORK / f'grid_{cls}.png', fmt='png', dpi=100, close=True, save_mode='screen')
    panels.append(png)
with figure_style(theme_target()):
    fig, axes = plt.subplots(1, 2, figsize=(12, 6.6))
    for ax, png, name in zip(axes, panels, [common.NEG_NAME, common.POS_NAME]):
        ax.imshow(Image.open(png)); ax.set_axis_off()
        ax.set_title(name.split(' ')[0], fontsize=16, pad=8)
    fig.subplots_adjust(left=0.01, right=0.99, top=0.92, bottom=0.01, wspace=0.04)
    png = save_figure(fig, WORK / 'cnn_examples.png', fmt='png', dpi=100, close=True)
img_examples = to_webp(png, OUT / 'class_example_crops.webp')

S = 6
sel = picked[classes[0]][:S] + picked[classes[1]][:S]
Xs = X[sel].clone()
gen = SaliencyMapGenerator(model)
sal, spred = gen.compute_saliency_and_predictions(Xs)
sal_img = sal.sum(dim=1)
numbers['saliency'] = {'files': [F[i] for i in sel], 'labels': [int(Y[i]) for i in sel],
                       'predicted': [int(v) for v in spred], 'method': 'SaliencyMapGenerator (|d score / d input|, summed over RGB)'}
fig = gen.plot_activation_grid(Xs.detach(), sal_img, spred, overlay=True, normalize=True)
png_grid = save_figure(fig, WORK / 'cnn_saliency_grid_app.png', fmt='png', dpi=100, close=True, save_mode='screen')

def stretch(img):
    out = np.zeros_like(img)
    for c in range(img.shape[2]):
        lo, hi = np.percentile(img[..., c], PCT[0]), np.percentile(img[..., c], PCT[1])
        out[..., c] = np.clip((img[..., c] - lo) / max(hi - lo, 1e-9), 0, 1)
    return out


def unit(m, q=99.5):
    m = np.asarray(m, float)
    lo, hi = np.percentile(m, 0.5), np.percentile(m, q)
    return np.clip((m - lo) / max(hi - lo, 1e-12), 0, 1)


from spacr.attribution import AttributionMapGenerator
K = 5
sel4 = picked[classes[0]][:K] + picked[classes[1]][:K]
X4 = X[sel4].clone()
SG = {'method': 'saliency', 'smoothgrad_samples': 16, 'smoothgrad_sigma': 0.15}
sg_gen = AttributionMapGenerator(model, method='saliency', model_type='mobilenet_v3_small',
                                 smoothgrad_samples=SG['smoothgrad_samples'], smoothgrad_sigma=SG['smoothgrad_sigma'])
sg_maps, sg_pred = sg_gen.compute_maps_and_predictions(X4.clone())
cam_gen = AttributionMapGenerator(model, method='gradcam', model_type='mobilenet_v3_small')
cam_maps, cam_pred = cam_gen.compute_maps_and_predictions(X4.clone())
numbers['attribution'] = {'files': [F[i] for i in sel4], 'labels': [int(Y[i]) for i in sel4],
                          'prob_gra14': [float(prob[i]) for i in sel4],
                          'smoothgrad': {**SG, 'predicted': [int(v) for v in sg_pred]},
                          'gradcam': {'method': 'gradcam', 'target_layer': 'default (last convolution)',
                                      'predicted': [int(v) for v in cam_pred]}}
bg_share = []
for j, i in enumerate(sel4):
    raw8 = np.asarray(Image.open(os.path.join(files[classes[int(Y[i])]], F[i])).convert('RGB'))
    background = raw8.max(axis=2) == 0
    m = np.abs(sg_maps[j].numpy())
    bg_share.append({'file': F[i], 'background_pixel_fraction': float(background.mean()),
                     'smoothgrad_mass_on_background': float(m[background].sum() / max(m.sum(), 1e-12)),
                     'gradcam_mass_on_background': float(np.asarray(cam_maps[j].numpy())[background].sum() / max(float(cam_maps[j].numpy().sum()), 1e-12))})
numbers['attribution']['background_share'] = bg_share
with figure_style(theme_target()):
    fig, axes = plt.subplots(4, K, figsize=(2.4 * K, 2.4 * 4 + 0.1))
    for j, i in enumerate(sel4):
        r = 0 if j < K else 2
        c = j % K
        raw = stretch(np.asarray(Image.open(os.path.join(files[classes[int(Y[i])]], F[i])).convert('RGB'), float) / 255)
        axes[r, c].imshow(raw)
        axes[r + 1, c].imshow(raw.mean(axis=2), cmap='gray', vmin=0, vmax=1)
        axes[r + 1, c].imshow(unit(cam_maps[j].numpy(), 100), cmap='jet', alpha=0.45)
    for ax in axes.flat:
        ax.set_xticks([]); ax.set_yticks([])
        for sp in ax.spines.values():
            sp.set_visible(False)
    axes[0, 0].set_ylabel('SAG1', fontsize=14)
    axes[1, 0].set_ylabel('Grad-CAM', fontsize=12)
    axes[2, 0].set_ylabel('GRA14', fontsize=14)
    axes[3, 0].set_ylabel('Grad-CAM', fontsize=12)
    fig.subplots_adjust(left=0.05, right=0.998, top=0.998, bottom=0.002, wspace=0.03, hspace=0.03)
    png = save_figure(fig, WORK / 'cnn_saliency.png', fmt='png', dpi=100, close=True, save_mode='screen')
img_sal = to_webp(png, OUT / 'saliency_maps.webp')
numbers['images'] = {'class_example_crops': img_examples, 'saliency_maps': img_sal,
                     'app_grid_png': str(png_grid)}
numbers['seconds'] = time.time() - t0
json.dump(numbers, open(WORK / 'cnn_numbers.json', 'w'), indent=1, default=str)
print(json.dumps(numbers['images'], indent=1))
