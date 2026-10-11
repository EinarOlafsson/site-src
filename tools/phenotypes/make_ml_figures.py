"""Figures from the generate_ml_scores run (make_ml.py): confusion matrix, ROC/PR, SHAP, feature importance."""
import json, pickle, time
from contextlib import contextmanager
import numpy as np
import pandas as pd
import common
from common import WORK, OUT, to_webp
app = common.qt_app()
import matplotlib
import matplotlib.pyplot as plt
from matplotlib.axes import Axes
from sklearn.metrics import (roc_curve, roc_auc_score, precision_recall_curve,
                             average_precision_score, confusion_matrix, accuracy_score)
from spacr.plot import save_figure, plot_feature_importance
from spacr.figures.style import figure_style, theme_target, Palette, _apply_user_style
from spacr.ml import _shap_values
from spacr.classifier_evaluation import _write_confusion_figure

t0 = time.time()
A = pickle.load(open(WORK / 'ml_artifacts.pkl', 'rb'))
model, X_train, X_test, y_test = A['model'], A['X_train'], A['X_test'], A['y_test']
df = A['df']
numbers = {'n_features': len(A['features']), 'n_train_cells': int(len(X_train)),
           'n_test_cells': int(len(X_test)), 'split_report': A['split_report']}

from sklearn.base import clone
from spacr.io import make_cv_folds
from spacr.classifier_evaluation import split_group_values
ctrl = df[df['data_usage'].isin(['train', 'test'])].copy()
Xc = ctrl[A['features']]
yc = (ctrl['columnID'].astype(str) == common.POS).astype(int).to_numpy()
_, groups = split_group_values(group_by='well', frame=ctrl[['prcfo']].reset_index(drop=True), table='controls')
folds = make_cv_folds(yc, 5, groups=groups, seed=42)
oof = np.full(len(yc), np.nan)
fold_rows = []
for k, (tr, va) in enumerate(folds, 1):
    m = clone(model).fit(Xc.iloc[tr], yc[tr])
    oof[va] = m.predict_proba(Xc.iloc[va])[:, 1]
    fold_rows.append({'fold': k, 'val_wells': sorted(set(map(str, ctrl.iloc[va]['prc']))),
                      'n_val': int(len(va)), 'auc': float(roc_auc_score(yc[va], oof[va])) if len(set(yc[va])) > 1 else None})
numbers['oof'] = {'folds': fold_rows, 'n_cells': int(len(yc)), 'n_wells': int(len(set(groups))),
                  'n_neg': int((yc == 0).sum()), 'n_pos': int((yc == 1).sum())}
oof_pred = (oof >= 0.5).astype(int)
numbers['oof']['accuracy'] = float(accuracy_score(yc, oof_pred))
numbers['oof']['roc_auc'] = float(roc_auc_score(yc, oof))
numbers['oof']['average_precision'] = float(average_precision_score(yc, oof))
numbers['oof']['confusion_counts'] = confusion_matrix(yc, oof_pred, labels=[0, 1]).tolist()
pd.DataFrame({'prcfo': ctrl['prcfo'].to_numpy(), 'prc': ctrl['prc'].to_numpy(), 'label': yc, 'oof_prob_gra14': oof}).to_csv(WORK / 'ml_oof.csv', index=False)

test = df.loc[X_test.index]
prob = test['prediction_probability_class_1'].to_numpy(float)
pred = test['predictions'].to_numpy(int)
y = y_test.to_numpy(int)
assert (pred == model.predict(X_test)).all()
numbers['test_wells'] = sorted(set(map(str, test['prc'])))
numbers['train_wells'] = sorted(set(map(str, df.loc[X_train.index, 'prc'])))
numbers['n_test_neg'] = int((y == 0).sum()); numbers['n_test_pos'] = int((y == 1).sum())
numbers['n_train_neg'] = int((A['y_train'] == 0).sum()); numbers['n_train_pos'] = int((A['y_train'] == 1).sum())
numbers['accuracy'] = float(accuracy_score(y, pred))
numbers['roc_auc'] = float(roc_auc_score(y, prob))
numbers['average_precision'] = float(average_precision_score(y, prob))
numbers['confusion_counts'] = confusion_matrix(y, pred, labels=[0, 1]).tolist()
cm = confusion_matrix(yc, oof_pred, labels=[0, 1])
labels = ['SAG1 (c1)', 'GRA14 (c2)']
results = {}


@contextmanager
def no_titles():
    """spaCR's figure writers stamp an English title; the website captions carry it instead."""
    original = Axes.set_title
    Axes.set_title = lambda self, *a, **k: None
    try:
        yield
    finally:
        Axes.set_title = original


norm = pd.DataFrame(cm / cm.sum(axis=1, keepdims=True), index=labels, columns=labels)
import spacr.plot as _sp
_orig_save = _sp.save_figure
_sp.save_figure = lambda fig, path, **k: _orig_save(fig, path, **{**k, 'save_mode': 'screen'})
with no_titles():
    _write_confusion_figure(norm, WORK / 'ml_confusion.png')
_sp.save_figure = _orig_save
results['ml_confusion'] = to_webp(WORK / 'ml_confusion.png', OUT / 'xgb_confusion_matrix.webp')

fpr, tpr, _ = roc_curve(yc, oof)
prec, rec, _ = precision_recall_curve(yc, oof)
prevalence = float(yc.mean())
with figure_style(theme_target()):
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(9.6, 4.4))
    a1.plot([0, 1], [0, 1], ls='--', lw=1.0, color=Palette.GREY_DARK, label='chance')
    a1.plot(fpr, tpr, lw=2.0, color=Palette.BLUE, label=f'AUC = {numbers["oof"]["roc_auc"]:.3f}')
    a1.set_xlabel('False positive rate'); a1.set_ylabel('True positive rate')
    a1.set_xlim(-0.01, 1.01); a1.set_ylim(-0.01, 1.01); a1.set_aspect('equal')
    a1.legend(loc='lower right', frameon=False)
    a2.axhline(prevalence, ls='--', lw=1.0, color=Palette.GREY_DARK, label=f'prevalence = {prevalence:.2f}')
    a2.plot(rec, prec, lw=2.0, color=Palette.RUST, label=f'AP = {numbers["oof"]["average_precision"]:.3f}')
    a2.set_xlabel('Recall'); a2.set_ylabel('Precision')
    a2.set_xlim(-0.01, 1.01); a2.set_ylim(-0.01, 1.01); a2.set_aspect('equal')
    a2.legend(loc='lower left', frameon=False)
    for ax in (a1, a2):
        ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False)
    fig.tight_layout()
    _apply_user_style(fig)
    png = save_figure(fig, WORK / 'ml_roc_pr.png', fmt='png', dpi=150, close=True)
results['ml_roc_pr'] = to_webp(png, OUT / 'xgb_roc_pr.webp')

fi = A['feature_importance_df'].head(15).iloc[::-1]
fig = plot_feature_importance(fi)
fig.set_size_inches(10, 6.2); fig.tight_layout()
png = save_figure(fig, WORK / 'ml_feature_importance.png', fmt='png', dpi=120, close=True, bbox_inches='tight', pad_inches=0.15)
results['ml_feature_importance'] = to_webp(png, OUT / 'xgb_feature_importance.webp')
numbers['top_features'] = A['feature_importance_df'].head(15)[['feature', 'importance']].to_dict('records')

sv, note = _shap_values(model, X_train, X_test)
numbers['shap_note'] = note
if len(sv.shape) == 3:
    sv = sv[..., 1]
matrix = np.asarray(sv.values, float)
strength = np.nanmean(np.abs(matrix), axis=0)
TOP = 12
order = np.argsort(strength)[::-1][:TOP]
names = [str(X_test.columns[i]) for i in order]
numbers['shap_top'] = [{'feature': n, 'mean_abs_shap': float(strength[i])} for n, i in zip(names, order)]
from spacr.qt.widgets.fast_plots import FastPlot
plot = FastPlot(title='', x_label='SHAP value (log-odds of GRA14 class)', y_label='')
plot.RANK_LABEL = 60
plot.resize(1200, max(420, 34 * TOP + 140))
plot.show(); app.processEvents()
n = plot.add_beeswarm(names, matrix[:, order], X_test[names].to_numpy(dtype=float))
app.processEvents(); plot.resize(1200, max(420, 34 * TOP + 140)); app.processEvents()
plot.export(str(WORK / 'ml_shap_beeswarm.png'))
results['ml_shap_beeswarm'] = to_webp(WORK / 'ml_shap_beeswarm.png', OUT / 'shap_beeswarm.webp')
numbers['shap_points'] = int(n)

import shap
pos_idx = np.where((y == 1) & (pred == 1))[0]
pick = int(pos_idx[np.argsort(np.abs(prob[pos_idx] - np.median(prob[pos_idx])))[0]])
cell = X_test.index[pick]
numbers['waterfall_cell'] = {'prcfo': str(cell), 'prc': str(test.iloc[pick]['prc']), 'label': int(y[pick]),
                             'probability_gra14': float(prob[pick]),
                             'base_value': float(np.ravel(sv.base_values)[pick]),
                             'f_x': float(np.ravel(sv.base_values)[pick] + matrix[pick].sum())}
with figure_style(theme_target()):
    shap.plots.waterfall(sv[pick], max_display=10, show=False)
    fig = plt.gcf()
    fig.set_size_inches(10, 6.0)
    for t in fig.axes[0].texts:
        pass
    _apply_user_style(fig)
    png = save_figure(fig, WORK / 'ml_shap_waterfall.png', fmt='png', dpi=120, close=True, bbox_inches='tight')
results['ml_shap_waterfall'] = to_webp(png, OUT / 'shap_waterfall_cell.webp')
numbers['seconds'] = time.time() - t0
numbers['images'] = results
json.dump(numbers, open(WORK / 'ml_numbers.json', 'w'), indent=1, default=str)
print(json.dumps(numbers, indent=1, default=str))
