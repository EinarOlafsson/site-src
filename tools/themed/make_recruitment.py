"""Recruitment figure, dark and light, from spaCR Recruitment runs on the four public plates.

Inputs: results/wells.csv written by run_recruitment.py (spacr.submodules.analyze_recruitment)
for plates 1-4 of einarolafsson/spacr-example-screen. Left: every control well per plate
(bar = mean, error bar = SD, dots = wells). Right: the four plate means per control (bar =
mean, error bar = SD) with a two-sided Student t-test on the plate means.

Usage: tools/themed/env.sh make_recruitment.py
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

from theme import THEMES, WORK, enforce, readable, save_pair_png, to_webp, ground_check, set_spacr_theme, contrast

PLATES = Path('/mnt/wd4tb/scratch/n687v3/themed/dl/plates')
NC_COLOUR = '#8DC63F'
PC_COLOUR = '#34497F'

frames = []
for n in (1, 2, 3, 4):
    w = pd.read_csv(PLATES / f'plate{n}' / 'results' / 'wells.csv')
    w = w[w.pathogen.isin(['nc', 'pc'])].copy()
    w['plate'] = n
    frames.append(w[['plate', 'rowID', 'columnID', 'pathogen', 'recruitment', 'cells_per_well']
                    if 'cells_per_well' in w.columns else ['plate', 'rowID', 'columnID', 'pathogen', 'recruitment']])
wells = pd.concat(frames, ignore_index=True)
wells.to_csv(WORK / 'recruitment_wells.csv', index=False)
per_plate = wells.groupby(['plate', 'pathogen']).recruitment.agg(['mean', 'std', 'count']).reset_index()
means = per_plate.pivot(index='plate', columns='pathogen', values='mean')
t_student = stats.ttest_ind(means.nc, means.pc)
t_welch = stats.ttest_ind(means.nc, means.pc, equal_var=False)
t_paired = stats.ttest_rel(means.nc, means.pc)
t_wells = stats.ttest_ind(wells[wells.pathogen == 'nc'].recruitment, wells[wells.pathogen == 'pc'].recruitment)
P = float(t_student.pvalue)


def sci(p):
    e = int(np.floor(np.log10(p)))
    m = p / 10 ** e
    return f'p = {m:.1f} × 10$^{{{e}}}$'


rng = np.random.default_rng(0)
out = {}
for theme, t in THEMES.items():
    set_spacr_theme(theme)
    from spacr.figures.style import figure_style
    nc = readable(NC_COLOUR, theme, 3.0)
    pc = readable(PC_COLOUR, theme, 3.0)
    with figure_style('screen', ink=t['ink'], line=t['ink'], ground=t['bg']):
        fig, (a1, a2) = plt.subplots(1, 2, figsize=(8, 3.0933), dpi=150,
                                     gridspec_kw={'width_ratios': [3.0, 1.45], 'wspace': 0.14})
        for ax in (a1, a2):
            ax.set_facecolor(t['bg'])
        xt, xl = [], []
        for i, n in enumerate((1, 2, 3, 4)):
            for j, (cond, col) in enumerate((('nc', nc), ('pc', pc))):
                x = i * 2.6 + j
                v = wells[(wells.plate == n) & (wells.pathogen == cond)].recruitment.values
                a1.bar(x, v.mean(), 0.72, color=col, zorder=1)
                a1.errorbar(x, v.mean(), v.std(ddof=1), color=t['ink'], capsize=3, lw=0.9, zorder=3)
                a1.scatter(x + rng.uniform(-0.17, 0.17, len(v)), v, s=7, color=t['ink'],
                           edgecolor=t['bg'], linewidth=0.5, zorder=4)
                xt.append(x); xl.append('NC' if cond == 'nc' else 'PC')
            a1.text(i * 2.6 + 0.5, -0.17, f'plate {n}', transform=a1.get_xaxis_transform(),
                    ha='center', va='top', fontsize=11)
        a1.set_xticks(xt, xl)
        a1.set_ylabel('GFP-TSG101 recruitment\n(vacuole / cytoplasm)', fontsize=12)
        for j, (cond, col, lab) in enumerate((('nc', nc, 'NC\n(SAG1 gRNA)'), ('pc', pc, 'PC\n(GRA14 gRNA)'))):
            v = means[cond].values
            a2.bar(j, v.mean(), 0.7, color=col, zorder=1)
            a2.errorbar(j, v.mean(), v.std(ddof=1), color=t['ink'], capsize=3, lw=0.9, zorder=3)
            a2.scatter(j + rng.uniform(-0.12, 0.12, len(v)), v, s=10, color=t['ink'],
                       edgecolor=t['bg'], linewidth=0.5, zorder=4)
        a2.set_xticks([0, 1], ['NC\nSAG1', 'PC\nGRA14'])
        lo = 0.95
        hi = max(wells.recruitment.max(), means.values.max()) + 0.04
        for ax in (a1, a2):
            ax.set_ylim(lo, hi)
            ax.spines[['top', 'right']].set_visible(False)
            ax.tick_params(labelsize=11, width=0.8, length=4)
            for sp in ax.spines.values():
                sp.set_linewidth(0.8)
        a2.yaxis.set_tick_params(labelleft=True)
        y = means.nc.mean() + means.nc.std(ddof=1) + 0.04
        a2.plot([0, 0, 1, 1], [y - 0.01, y, y, y - 0.01], color=t['ink'], lw=1)
        a2.text(0.5, y + 0.008, sci(P), ha='center', va='bottom', fontsize=11)
        a1.set_xlim(-0.7, 3 * 2.6 + 1.7)
        a2.set_xlim(-0.65, 1.65)
        enforce(fig, theme)
        fig.subplots_adjust(left=0.105, right=0.99, top=0.96, bottom=0.2)
        png = save_pair_png(fig, theme, 'recruitment', dpi=150)
        plt.close(fig)
    info = to_webp(png, theme, 'recruitment', width=1200, height=464)
    info.update(ground_check(WORK.parent / info['file'], theme))
    info['colours'] = {'nc': nc, 'pc': pc, 'nc_contrast': round(contrast(nc, t['bg']), 2),
                       'pc_contrast': round(contrast(pc, t['bg']), 2)}
    out[theme] = info
    print(theme, info)

numbers = {
    'wells_per_plate': per_plate.to_dict('records'),
    'plate_means': {c: [round(float(v), 4) for v in means[c].values] for c in ('nc', 'pc')},
    'mean_of_plate_means': {c: round(float(means[c].mean()), 4) for c in ('nc', 'pc')},
    'p_student_plate_means': P, 'p_welch_plate_means': float(t_welch.pvalue),
    'p_paired_plate_means': float(t_paired.pvalue), 'p_student_all_wells': float(t_wells.pvalue),
    'p_label': sci(P), 'webp': out,
}
json.dump(numbers, open(WORK / 'recruitment_numbers.json', 'w'), indent=1, default=float)
print(json.dumps({k: numbers[k] for k in ('plate_means', 'p_student_plate_means', 'p_welch_plate_means',
                                          'p_paired_plate_means', 'p_student_all_wells')}, indent=1))
