"""Confusion matrix and ROC/PR of the CNN (make_deep.py) on its held-out test wells, drawn like make_ml_figures.py."""
import json
from contextlib import contextmanager
import numpy as np
import pandas as pd
import common
from common import WORK, OUT, to_webp
app = common.qt_app()
import matplotlib.pyplot as plt
from matplotlib.axes import Axes
from sklearn.metrics import roc_curve, roc_auc_score, precision_recall_curve, average_precision_score, confusion_matrix
from spacr.plot import save_figure
import spacr.plot as _sp
from spacr.figures.style import figure_style, theme_target, Palette, _apply_user_style
from spacr.classifier_evaluation import _write_confusion_figure

d = pd.read_csv(WORK / 'cnn_test_predictions.csv')
y = d['label'].to_numpy(int); p = d['prob_gra14'].to_numpy(float)
cm = confusion_matrix(y, (p >= 0.5).astype(int), labels=[0, 1])
labels = ['SAG1 (c1)', 'GRA14 (c2)']
norm = pd.DataFrame(cm / cm.sum(axis=1, keepdims=True), index=labels, columns=labels)
original_title, original_save = Axes.set_title, _sp.save_figure
Axes.set_title = lambda self, *a, **k: None
_sp.save_figure = lambda fig, path, **k: original_save(fig, path, **{**k, 'save_mode': 'screen'})
try:
    _write_confusion_figure(norm, WORK / 'cnn_confusion.png')
finally:
    Axes.set_title, _sp.save_figure = original_title, original_save
out = {'cnn_confusion': to_webp(WORK / 'cnn_confusion.png', OUT / 'cnn_confusion_matrix.webp', width=900)}
auc, ap = roc_auc_score(y, p), average_precision_score(y, p)
fpr, tpr, _ = roc_curve(y, p); prec, rec, _ = precision_recall_curve(y, p); prevalence = float(y.mean())
with figure_style(theme_target()):
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(9.6, 4.4))
    a1.plot([0, 1], [0, 1], ls='--', lw=1.0, color=Palette.GREY_DARK, label='chance')
    a1.plot(fpr, tpr, lw=2.0, color=Palette.BLUE, label=f'AUC = {auc:.3f}')
    a1.set_xlabel('False positive rate'); a1.set_ylabel('True positive rate')
    a2.axhline(prevalence, ls='--', lw=1.0, color=Palette.GREY_DARK, label=f'prevalence = {prevalence:.2f}')
    a2.plot(rec, prec, lw=2.0, color=Palette.RUST, label=f'AP = {ap:.3f}')
    a2.set_xlabel('Recall'); a2.set_ylabel('Precision')
    a1.legend(loc='lower right', frameon=False); a2.legend(loc='lower left', frameon=False)
    for ax in (a1, a2):
        ax.set_xlim(-0.01, 1.01); ax.set_ylim(-0.01, 1.01); ax.set_aspect('equal')
        ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
    fig.tight_layout(); _apply_user_style(fig)
    png = save_figure(fig, WORK / 'cnn_roc_pr.png', fmt='png', dpi=150, close=True)
out['cnn_roc_pr'] = to_webp(png, OUT / 'cnn_roc_pr.webp')
out['numbers'] = {'auc': auc, 'ap': ap, 'confusion_counts': cm.tolist(), 'n': int(len(y))}
json.dump(out, open(WORK / 'cnn_metrics.json', 'w'), indent=1)
print(json.dumps(out, indent=1))
