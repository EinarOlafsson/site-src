"""Hit example figure: the regression run of make_hit.py drawn by spacr.volcano_style.render_volcano."""
import json
import pandas as pd
from common import qt_app, to_webp, OUT, WORK
app = qt_app()
from spacr.qt.screens.volcano import find_results_table, load_results
from spacr.volcano_style import VolcanoStyle, render_volcano
from spacr.plot import save_figure

folder = WORK / 'hit_run/results/ols'
table = load_results(folder / 'results_gene.csv')
table['label'] = [f"{n} ({g})" if isinstance(n, str) else str(g)
                  for n, g in zip(table.gene_name, table.gene)]
style = VolcanoStyle(x_column='coefficient', y_column='q_value', label_column='label',
                     x_label='Effect on GRA14-knockout-like score (slope on gene fraction)',
                     alpha=0.05, show_effect_lines=False, annotate_significant=True,
                     y_label='-log10 adjusted p (BH)', x_lim=(-9.0, 2.5), figure_width=6.4, figure_height=4.4, dpi=180,
                     font_size=12.0, label_font_size=11.0, tick_font_size=11.0)
fig, axes = render_volcano(table, style)
for ax in fig.axes:
    for text in ax.texts:
        if text.get_text().startswith('GRA14'):
            text.xyann = (6, 6)
png = save_figure(fig, WORK / 'hit_volcano.png', fmt='png', dpi=180)
print(png, to_webp(png, OUT / 'hit_volcano.webp'))
hit = json.load(open(WORK / 'hit_run/hit.json'))
called = table[table.q_value < 0.05][['gene', 'gene_name', 'condition', 'coefficient', 'p_value', 'q_value', 'n_gene']]
print(called)
summary = open(folder / 'model_summary.txt').read()
json.dump({'n_coefficients': int(len(table)), 'called_q_lt_0.05': called.to_dict('records'),
           'shipped_hit': hit, 'n_wells': 30},
          open(WORK / 'hit_numbers.json', 'w'), indent=1, default=str)
