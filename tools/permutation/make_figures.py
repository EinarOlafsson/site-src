"""Permutation-test figures (dark and light) for the website's Screen results tab.

Input: the results folder of tools/permutation/run_perm.py (spacr.ml.perform_regression,
analysis_mode='guide_permutation') on the four public plates of the spaCR example
screen, readout = per-cell MaxViT score.

Figures, after the preprint's Figure S7R,S (within-plate Freedman-Lane permutation
volcanoes: x = partial Pearson correlation, y = -log10 BH-adjusted empirical P,
dashed line BH q = 0.05, dotted line the positive-effect cutoff, points coloured by
predicted compartment, hits named):
  perm_gene_volcano   gene level (one regressor per gene = summed guide fractions)
  perm_guide_volcano  guide level
  perm_null           the permutation null of the partial correlation for the
                      named genes, observed value marked. The null draws are
                      regenerated with spaCR's own building blocks
                      (spacr.guide_permutation.prepare_long_gene_data,
                      _nuisance_design, _residualize) and the same seeded
                      generator, and the script asserts that the regenerated
                      exceedance counts equal the counts spaCR reported.
Also writes perm.json (compact per-gene table) and figures.json.

Compartments: spacr.gene_tile.gene_tile (the Regression results gene card),
collapsed into the paper's legend groups.

Usage: tools/permutation/env.sh tools/permutation/make_figures.py --tag p200k
"""
import sys
sys.path.insert(0, '/mnt/wd4tb/spacr-worktrees/claude-n687-v4')
import argparse, json, math, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'themed'))

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

import theme as T

S = Path('/mnt/wd4tb/scratch/n687v3/perm')
OUT = S / 'out'
T.OUT = OUT
T.WORK = OUT / 'work'
T.WORK.mkdir(parents=True, exist_ok=True)
THEMES = T.THEMES

NAMES = {'225160': 'EAF1'}

GROUPS = [
    ('Dense granules', '#2bb39a', '#3cc9ad'),
    ('Rhoptries', '#a04ea3', '#c77bca'),
    ('Micronemes', '#555555', '#b0b0b0'),
    ('Apical', '#e0982e', '#f0b04f'),
    ('PM', '#8e2f6b', '#d16aa9'),
    ('IMC', '#a8a8a8', '#8c8c8c'),
    ('ER', '#ee8f8f', '#f4a3a3'),
    ('Golgi', '#3d9a3d', '#5cbf5c'),
    ('Mitochondrion', '#de3b3b', '#ff6b6b'),
    ('Nucleus', '#3a3aae', '#8888ee'),
    ('Cytosol', '#3a9fb5', '#5cc0d6'),
    ('No data', '#c4c7cc', '#6b717c'),
    ('Non-cutting', '#15181e', '#ffffff'),
]


def group_of(localisation, gene):
    if str(gene).startswith('000000'):
        return 'Non-cutting'
    s = (localisation or '').lower()
    if not s or s == 'unknown':
        return 'No data'
    for key, name in (('dense', 'Dense granules'), ('rhopt', 'Rhoptries'), ('micro', 'Micronemes'),
                      ('apical', 'Apical'), ('pm ', 'PM'), ('pm-', 'PM'), ('imc', 'IMC'),
                      ('er ', 'ER'), ('golgi', 'Golgi'), ('mito', 'Mitochondrion'),
                      ('nucle', 'Nucleus'), ('cyto', 'Cytosol')):
        if s.startswith(key) or key in s + ' ':
            return name
    return 'No data'


def colour(group, theme):
    for name, light, dark in GROUPS:
        if name == group:
            return dark if theme == 'dark' else light
    raise KeyError(group)


def sig(value, digits=4):
    if value is None or not math.isfinite(float(value)):
        return None
    return float(f'{float(value):.{digits}g}')


def sci(p, digits=1):
    e = int(math.floor(math.log10(p)))
    m = p / 10 ** e
    if round(m, digits) >= 10:
        m, e = m / 10, e + 1
    return f'{m:.{digits}f}×10$^{{{e}}}$'


def annotate(meta, every):
    from spacr.gene_tile import gene_tile
    rows = []
    for row in meta.itertuples(index=False):
        tile = gene_tile(row.feature, every)
        cand = tile.candidates[0] if tile.candidates else None
        symbol = (cand.symbol if cand else '') or ''
        loc = (cand.localisation if cand else '') or ''
        product = (cand.product if cand else '') or ''
        rows.append((symbol, loc, product))
    meta = meta.copy()
    meta['symbol'] = [r[0] for r in rows]
    meta['localisation'] = [r[1] for r in rows]
    meta['product'] = [r[2] for r in rows]
    return meta


def label_of(gene, symbol):
    gene = str(gene)
    if gene in NAMES:
        return NAMES[gene]
    if gene.startswith('000000'):
        return 'non-cutting'
    return symbol or f'TGGT1_{gene}'


def place(points):
    """Label offsets: right of the point; above it near either edge; below-right when a
    labelled neighbour sits just to the right at the same height."""
    out = []
    for x, y, text in points:
        crowded = any(0 < ox - x < 0.16 and abs(oy - y) < 0.15 for ox, oy, _ in points)
        if x > 0.38 or x < 0:
            out.append((x, y, text, 0, 16, 'center'))
        elif crowded:
            out.append((x, y, text, 6, -16, 'left'))
        else:
            out.append((x, y, text, 14, 0, 'left'))
    return out


def volcano(table, theme, cut, alpha, labels, legend_groups, ylab, name, xlim, ymax, floor_note):
    t = THEMES[theme]
    T.set_spacr_theme(theme)
    from spacr.figures.style import figure_style
    keep = []
    with figure_style('screen', ink=t['ink'], line=t['ink'], ground=t['bg']):
        fig = plt.figure(figsize=(8.0, 5.0), dpi=150)
        ax = fig.add_axes([0.095, 0.13, 0.665, 0.83])
        ax.set_facecolor(t['bg'])
        y = -np.log10(np.clip(table['q_value'].to_numpy(float), 1e-300, 1))
        x = table['coefficient'].to_numpy(float)
        groups = table['group'].to_numpy()
        for gname, _, _ in GROUPS[::-1]:
            m = groups == gname
            if not m.any():
                continue
            ax.scatter(x[m], y[m], s=22 if gname != 'No data' else 16, color=colour(gname, theme),
                       edgecolor='none', alpha=0.95, zorder=3 if gname != 'No data' else 2)
        ax.axhline(-math.log10(alpha), color=t['ink'], ls=(0, (4, 3)), lw=0.9, zorder=1)
        if cut is not None:
            for c in (cut, -cut):
                ax.axvline(c, color=t['ink'], ls=(0, (1, 2)), lw=1.0, zorder=1)
        ax.set_xlim(*xlim)
        ax.set_ylim(-0.08, ymax)
        ax.set_xlabel("Partial correlation (Pearson's r)", fontsize=12.5)
        ax.set_ylabel(ylab, fontsize=12.5)
        ax.spines[['top', 'right']].set_visible(False)
        ax.tick_params(labelsize=11, width=0.8, length=4)
        for sp in ax.spines.values():
            sp.set_linewidth(0.8)
        for (lx, ly, text, dx, dy, ha) in labels:
            a = ax.annotate(text, (lx, ly), xytext=(dx, dy), textcoords='offset points', ha=ha,
                            va='center', fontsize=11.5,
                            arrowprops=dict(arrowstyle='-', color=t['ink'], lw=0.8, shrinkA=0, shrinkB=3))
        ax.text(0.42, 0.985, floor_note, transform=ax.transAxes, ha='center', va='top', fontsize=10)
        fig.text(0.80, 0.95, 'Compartment', fontsize=11.5, fontweight='bold', va='top')
        yy = 0.95 - 0.058
        shown = set(groups)
        for gname in legend_groups:
            if gname not in shown:
                continue
            tx = fig.text(0.80, yy, gname, fontsize=11, va='top', color=colour(gname, theme))
            keep.append(tx)
            yy -= 0.052
        T.enforce(fig, theme, keep_text=keep)
        png = T.save_pair_png(fig, theme, name, dpi=150)
        plt.close(fig)
    info = T.to_webp(png, theme, name, width=1200, height=750)
    info.update(T.ground_check(OUT / info['file'], theme))
    return info


def regenerate_null(data, genes, n_perm, seed, batch, nuisance, block='plateID', outcome='pred'):
    from spacr.guide_permutation import prepare_long_gene_data, _nuisance_design, _residualize
    gf, outcomes, _meta = prepare_long_gene_data(data, outcome, block_column=block, nuisance_columns=nuisance)
    x = gf[genes].to_numpy(float)
    y = pd.to_numeric(outcomes[outcome]).to_numpy(float)
    design = _nuisance_design(outcomes, block, nuisance)
    q, _ = np.linalg.qr(design, mode='reduced')
    xr = _residualize(x, q)
    yf = q @ (q.T @ y)
    yr = y - yf
    xu = xr / np.sqrt((xr ** 2).sum(0))
    observed = (xu.T @ yr) / np.sqrt((yr ** 2).sum())
    blocks = outcomes[block].astype(str).to_numpy()
    idx = [np.flatnonzero(blocks == lv) for lv in pd.unique(blocks)]
    rng = np.random.default_rng(seed)
    null = np.empty((len(genes), n_perm), dtype=np.float32)
    for start in range(0, n_perm, batch):
        cur = min(batch, n_perm - start)
        pr = np.empty((len(y), cur))
        for k in range(cur):
            p = yr.copy()
            for ii in idx:
                p[ii] = p[ii][rng.permutation(len(ii))]
            pr[:, k] = p
        po = _residualize(yf[:, None] + pr, q)
        null[:, start:start + cur] = (xu.T @ po) / np.sqrt((po ** 2).sum(0))[None, :]
    eps = np.finfo(float).eps
    exceed = (np.abs(null.astype(float)) >= np.abs(observed)[:, None] - eps).sum(1)
    return observed, null, exceed, len(y)


def null_figure(theme, panels, n_perm, name):
    t = THEMES[theme]
    T.set_spacr_theme(theme)
    from spacr.figures.style import figure_style
    keep = []
    with figure_style('screen', ink=t['ink'], line=t['ink'], ground=t['bg']):
        fig, axes = plt.subplots(1, len(panels), figsize=(8.0, 3.2), dpi=150, sharey=True)
        fig.subplots_adjust(left=0.085, right=0.99, top=0.86, bottom=0.2, wspace=0.08)
        null_col = '#9aa0aa' if theme == 'dark' else '#8a909a'
        lo = min(min(float(p['null'].min()), -abs(p['observed'])) for p in panels) * 1.08
        hi = max(max(float(p['null'].max()), abs(p['observed'])) for p in panels) * 1.08
        lim = max(abs(lo), abs(hi))
        bins = np.linspace(-lim, lim, 121)
        for ax, p in zip(axes, panels):
            ax.set_facecolor(t['bg'])
            h, e = np.histogram(p['null'], bins=bins)
            ax.stairs(h, e, fill=True, color=null_col, alpha=0.85)
            obs_c = colour(p['group'], theme)
            ax.axvline(p['observed'], color=obs_c, lw=2.0)
            ax.axvline(-p['observed'], color=obs_c, lw=1.0, ls=(0, (2, 2)))
            ax.set_yscale('log')
            ax.set_ylim(0.6, h.max() * 4000)
            ax.set_xlim(-lim, lim)
            ax.spines[['top', 'right']].set_visible(False)
            ax.tick_params(labelsize=10, width=0.8, length=4)
            ttl = ax.set_title(p['label'], fontsize=12, color=obs_c, pad=4)
            keep.append(ttl)
            pt = f"r = {p['observed']:+.3f}\nb = {p['exceed']:,}\nP = {sci(p['p'])}"
            ax.text(0.5, 0.975, pt, transform=ax.transAxes, ha='center', va='top', fontsize=9.5,
                    linespacing=1.25)
        axes[0].set_ylabel('Permutations', fontsize=11.5)
        fig.text(0.5, 0.035, "Partial correlation under the within-plate permutation null",
                 ha='center', va='bottom', fontsize=11.5)
        T.enforce(fig, theme, keep_text=keep)
        for ax, p in zip(axes, panels):
            ax.title.set_color(colour(p['group'], theme))
        png = T.save_pair_png(fig, theme, name, dpi=150)
        plt.close(fig)
    info = T.to_webp(png, theme, name, width=1200, height=480)
    info.update(T.ground_check(OUT / info['file'], theme))
    return info


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', default='p200k')
    a = ap.parse_args()
    t0 = time.time()
    R = S / 'run' / a.tag / 'results' / 'guide_permutation'
    rec = json.loads((S / 'run' / a.tag / 'run_record_part.json').read_text())
    n_perm, seed = rec['permutations'], rec['seed']
    floor = 1.0 / (n_perm + 1)
    every = pd.read_csv(R / 'results.csv', dtype={'gene': str, 'grna': str})
    long = pd.read_csv(R / 'guide_permutation_results_long.csv', dtype={'guide': str})
    genes = pd.read_csv(R / 'results_gene.csv', dtype={'gene': str, 'grna': str})
    guides = pd.read_csv(R / 'results_grna.csv', dtype={'gene': str, 'grna': str})
    alpha = float(genes['alpha'].iloc[0])
    cut = float(guides['effect_size_threshold'].dropna().iloc[0]) if guides['effect_size_threshold'].notna().any() else None

    genes = annotate(genes, every)
    genes['group'] = [group_of(l, g) for l, g in zip(genes['localisation'], genes['gene'])]
    guide_gene = guides['grna'].str.rsplit('_', n=1).str[0]
    gmap = genes.set_index('gene')
    guides['gene'] = guide_gene
    guides['symbol'] = guide_gene.map(gmap['symbol']).fillna('')
    guides['group'] = [('Non-cutting' if str(g).startswith('000000') else gmap['group'].get(g, 'No data'))
                       for g in guide_gene]

    def passes(df):
        return (df['q_value'] < alpha) & (df['coefficient'].abs() >= (cut or 0))

    genes['hit'] = passes(genes)
    guides['hit'] = passes(guides)
    named_genes = list(dict.fromkeys(['239740', '225160', '233460']
                                     + genes.loc[genes['q_value'] < alpha, 'gene'].tolist()))

    present = [g for g, _, _ in GROUPS if g in set(genes['group']) | set(guides['group'])]
    ymax_g = max(-math.log10(max(floor * 0.5, genes['q_value'].min())), 1.6) * 1.12
    ymax_r = max(-math.log10(max(floor * 0.5, guides['q_value'].min())), 1.6) * 1.12
    xs = np.concatenate([genes['coefficient'], guides['coefficient']])
    xlim = (min(-0.4, xs.min() - 0.04), max(0.5, xs.max() + 0.06))

    def gene_labels():
        out = []
        for g in named_genes:
            r = genes.loc[genes['gene'] == g].iloc[0]
            yv = -math.log10(r['q_value'])
            text = label_of(g, r['symbol'])
            out.append([r['coefficient'], yv, text])
        out.sort(key=lambda z: (z[0]))
        return place(out)

    def guide_labels():
        best = guides.loc[guides['gene'].isin(['239740', '225160', '233460'])].sort_values('q_value')
        best = best.drop_duplicates('gene')
        sel = pd.concat([guides.loc[guides['q_value'] < alpha], best]).drop_duplicates('grna')
        placed = []
        for r in sel.itertuples(index=False):
            yv = -math.log10(r.q_value)
            base = label_of(r.gene, r.symbol)
            text = f"{base} g{r.grna.rsplit('_', 1)[-1]}"
            placed.append((r.coefficient, yv, text))
        placed.sort(key=lambda z: (-z[1], z[0]))
        return place(placed)

    floor_note = f'{n_perm:,} permutations · seed {seed}'
    figs = {}
    figs['perm_gene_volcano'] = {th: volcano(genes, th, cut, alpha, gene_labels(), present,
                                             '−log$_{10}$(BH-adjusted empirical P)', 'perm_gene_volcano',
                                             xlim, ymax_g, floor_note) for th in THEMES}
    figs['perm_guide_volcano'] = {th: volcano(guides, th, cut, alpha, guide_labels(), present,
                                              '−log$_{10}$(BH-adjusted empirical P)', 'perm_guide_volcano',
                                              xlim, ymax_r, floor_note) for th in THEMES}

    data = pd.read_csv(R / 'regression_data.csv', dtype={'gene': str, 'grna': str})
    nuis = [c for c in str(genes['nuisance_columns'].iloc[0]).split(';') if c]
    null_genes = ['239740', '225160', '233460']
    tn = time.time()
    observed, null, exceed, n_wells = regenerate_null(data, null_genes, n_perm, seed,
                                                      int(rec['settings'].get('guide_permutation_batch_size', 500)), nuis)
    null_seconds = time.time() - tn
    check = []
    panels = []
    for i, g in enumerate(null_genes):
        r = genes.loc[genes['gene'] == g].iloc[0]
        ok_b = int(exceed[i]) == int(r['permutation_exceedances'])
        ok_r = abs(float(observed[i]) - float(r['coefficient'])) < 1e-9
        check.append({'gene': g, 'spacr_exceedances': int(r['permutation_exceedances']),
                      'regenerated_exceedances': int(exceed[i]), 'spacr_r': float(r['coefficient']),
                      'regenerated_r': float(observed[i]), 'match': bool(ok_b and ok_r)})
        assert ok_b and ok_r, check[-1]
        panels.append({'label': label_of(g, r['symbol']), 'observed': float(observed[i]), 'null': null[i],
                       'exceed': int(exceed[i]), 'p': float(r['permutation_p_value']),
                       'group': r['group']})
    figs['perm_null'] = {th: null_figure(th, panels, n_perm, 'perm_null') for th in THEMES}

    perm = {
        'v': 1, 'readout': 'MaxViT per-cell score (pred), mean per well',
        'test': 'within-plate Freedman-Lane permutation, partial Pearson r given plate+row+column',
        'permutations': n_perm, 'seed': seed, 'floor_p': sig(floor, 4), 'alpha': alpha,
        'method': str(genes['multiple_testing_method'].iloc[0]),
        'effect_cut': sig(cut, 4), 'n_wells': int(n_wells),
        'groups': [g for g, _, _ in GROUPS],
        'cols': ['gene', 'symbol', 'r', 'p', 'q', 'wells', 'guides', 'group index', 'hit'],
        'genes': [[r.gene, label_of(r.gene, r.symbol) if (r.symbol or r.gene in NAMES) else '',
                   sig(r.coefficient, 4), sig(r.permutation_p_value, 3), sig(r.q_value, 3),
                   int(r.wells_with_gene), None if pd.isna(r.guides_in_gene) else int(r.guides_in_gene),
                   [g for g, _, _ in GROUPS].index(r.group), int(bool(r.hit))]
                  for r in genes.sort_values('permutation_p_value').itertuples(index=False)],
    }
    (OUT / 'perm.json').write_text(json.dumps(perm, separators=(',', ':'), ensure_ascii=False))

    numbers = {
        'n_genes': int(len(genes)), 'n_guides': int(len(guides)), 'n_wells': int(n_wells),
        'permutations': n_perm, 'seed': seed, 'smallest_attainable_p': floor,
        'effect_cut': cut, 'effect_rule': str(rec.get('effect_rule', '')),
        'genes_q_lt_alpha': genes.loc[genes['q_value'] < alpha, ['gene', 'symbol', 'coefficient', 'permutation_p_value', 'q_value', 'permutation_exceedances', 'wells_with_gene', 'hit']].to_dict('records'),
        'guides_q_lt_alpha': guides.loc[guides['q_value'] < alpha, ['grna', 'symbol', 'coefficient', 'permutation_p_value', 'q_value', 'permutation_exceedances', 'wells_with_guide', 'hit']].to_dict('records'),
        'genes_at_floor': int((genes['permutation_exceedances'] == 0).sum()),
        'guides_at_floor': int((guides['permutation_exceedances'] == 0).sum()),
        'null_check': check, 'null_regeneration_seconds': round(null_seconds, 1),
        'groups_present': present,
        'figure_seconds': round(time.time() - t0, 1),
    }
    (T.WORK / 'numbers.json').write_text(json.dumps({'numbers': numbers, 'figs': figs}, indent=1, default=float))
    print(json.dumps(numbers, indent=1, default=float))
    print(json.dumps(figs, indent=1, default=float))


if __name__ == '__main__':
    main()
