"""Export the four-plate OLS run (tools/screen/run_ols.py) as src/assets/data/volcano.json.

One point per gene (results_gene.csv), the guide rows behind it
(results_grna.csv), and the gene card fields of spaCR's Regression results
screen: spacr.gene_tile.gene_tile(feature, results) as the app's
spacr/qt/widgets/gene_tile.py GeneTilePanel calls it (title, subtitle, gene id,
product, symbol, localisation (TAGM/LOPIT), effect, p, q, condition, the n_obs
column, guides fitted, guides agreeing in sign, the guides behind it, external
records).

Thresholds, as spaCR draws them:
  * horizontal: Benjamini-Hochberg FDR 0.05 drawn on the raw-p axis at the
    largest raw p the procedure called (spacr/qt/widgets/fast_plots.py
    _add_significance_lines: "the line lands on the last test it called");
  * vertical: +/-3 sigma, sigma = 1.4826 x MAD of the gene coefficients
    (the run's regression_figure legend and summary: "effect-size cut of
    0.67 (3 sigma)"; the preprint's "3xσ" line);
  * p reported as 0 (below double precision) is drawn three decades above the
    smallest non-zero p, as fast_plots.py does (_y_floor = smallest * 1e-3).

Run: tools/screen/env.sh tools/screen/export_volcano.py
"""
import sys
sys.path.insert(0, '/mnt/wd4tb/spacr-worktrees/claude-n687-v4')
import json, math
from pathlib import Path
import numpy as np
import pandas as pd
from spacr.gene_tile import gene_tile

S = Path('/mnt/wd4tb/scratch/n687v3/ols')
R = S / 'run' / 'screen4' / 'results' / 'ols'
SITE = Path(__file__).resolve().parents[2]
OUT = SITE / 'src' / 'assets' / 'data' / 'volcano.json'
RECORD = Path(__file__).resolve().parent / 'run_record_ols.json'
ALPHA = 0.05


def sig(value, digits):
    if value is None or not math.isfinite(value):
        return None
    if value == 0:
        return 0
    return float(f'{value:.{digits}g}')


def main():
    every = pd.read_csv(R / 'results.csv', dtype={'gene': str, 'grna': str})
    genes = pd.read_csv(R / 'results_gene.csv', dtype={'gene': str, 'grna': str})
    guides = pd.read_csv(R / 'results_grna.csv', dtype={'gene': str, 'grna': str})
    genes = genes[np.isfinite(genes['p_value'])].copy()
    method = str(genes['multiple_testing_method'].dropna().iloc[0])

    coef = genes['coefficient'].to_numpy(float)
    sigma = 1.4826 * float(np.median(np.abs(coef - np.median(coef))))
    cut = 3 * sigma
    called = genes['q_value'] < ALPHA
    critical = float(genes.loc[called, 'p_value'].max()) if called.any() else None
    positive = genes['p_value'] > 0
    floor = float(genes.loc[positive, 'p_value'].min()) * 1e-3

    products, places = [], []

    def index_of(table, text):
        if not text:
            return -1
        if text not in table:
            table.append(text)
        return table.index(text)

    points = []
    hits, labelled = [], []
    for row in genes.sort_values('coefficient').itertuples(index=False):
        tile = gene_tile(row.feature, every)
        cand = tile.candidates[0] if tile.candidates else None
        symbol = cand.symbol if cand else ''
        accession = cand.accession if cand else ''
        uniprot = ''
        for ref in tile.references:
            if ref.label.startswith('UniProt '):
                uniprot = ref.label.split(' ', 1)[1]
        rows = []
        for g in tile.guides:
            suffix = g.guide.rsplit('_', 1)[-1] if g.guide.startswith(row.gene + '_') else g.guide
            rows.append([suffix, sig(g.effect, 4), sig(g.p_value, 3),
                         None if not math.isfinite(g.n_obs) else int(g.n_obs)])
        is_called = bool(row.q_value < ALPHA)
        past = abs(row.coefficient) >= cut
        flag = (1 if is_called else 0) | (2 if is_called and past else 0)
        kind = {'pc': 'pc', 'nc': 'nc', 'control': 'ctl'}.get(str(row.condition), '')
        point = [row.gene, sig(row.coefficient, 4), sig(row.p_value, 3), sig(row.q_value, 3),
                 int(row.n_gene) if math.isfinite(row.n_gene) else None, flag, kind, symbol,
                 index_of(products, cand.product) if cand else -1,
                 index_of(places, cand.localisation) if cand else -1,
                 uniprot,
                 tile.n_agree if tile.guides and math.isfinite(tile.gene_effect) else None,
                 rows]
        if accession and accession != f'TGGT1_{row.gene}':
            point.append(accession)
        points.append(point)
        if is_called:
            labelled.append((row.gene, symbol, row.coefficient, row.p_value, row.q_value, past))

    data = {
        'v': 1,
        'level': 'gene',
        'alpha': ALPHA,
        'method': method,
        'sigma': sig(sigma, 4),
        'cut': sig(cut, 4),
        'critical_p': sig(critical, 4),
        'floor_p': sig(floor, 3),
        'n_genes': len(points),
        'n_guides': int(np.isfinite(guides['p_value']).sum()),
        'n_called': int(called.sum()),
        'cols': ['gene', 'coefficient', 'p', 'q', 'n_gene', 'flag (1 called, 2 past 3 sigma)', 'condition', 'symbol', 'product index', 'localisation index', 'uniprot', 'guides agreeing in sign', 'guides [n, coefficient, p, n_grna]', 'accession if not TGGT1_<gene>'],
        'products': products,
        'places': places,
        'points': points,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False))
    guide_called = int((guides['q_value'] < ALPHA).sum())
    summary = {
        'genes': len(points), 'guides': data['n_guides'],
        'genes_called_fdr_0.05': int(called.sum()), 'guides_called_fdr_0.05': guide_called,
        'genes_past_fdr_and_3sigma': int(sum(1 for x in labelled if x[5])),
        'sigma_mad': sigma, 'cut_3sigma': cut, 'critical_raw_p': critical, 'zero_p_drawn_at': floor,
        'called_genes': [dict(gene=a, symbol=b, coefficient=c, p=d, q=e, past_3sigma=bool(f))
                         for a, b, c, d, e, f in labelled],
        'json_bytes': OUT.stat().st_size,
    }
    record = json.loads(RECORD.read_text()) if RECORD.exists() else {}
    record['export'] = summary
    RECORD.write_text(json.dumps(record, indent=1) + '\n')
    print(json.dumps(summary, indent=1))


if __name__ == '__main__':
    main()
