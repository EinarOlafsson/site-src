import os, sys, json
import numpy as np, pandas as pd
from PIL import Image
from spacr.volcano_style import VolcanoStyle, render_volcano
BASE = sys.argv[1]
D = os.path.join(BASE, 'data'); OUT = os.path.join(BASE, 'out')
r = pd.read_csv(os.path.join(D, 'regress/results/ols/results_gene.csv'))
r['gene'] = r['gene'].astype(str)
r['significant'] = r['q_value'] < 0.05
r['label'] = r['gene']
style = VolcanoStyle(x_column='coefficient', y_column='p_value', label_column='label',
                     x_label='Effect on classifier score', y_label='-log10 p',
                     annotations={'239740': 'GRA14', '233460': 'SAG1'},
                     figure_width=8.0, figure_height=6.0, dpi=100, background_color='#FFFFFF',
                     significant_marker_size=170.0, marker_size=110.0,
                     label_font_size=21, tick_font_size=18, legend=False, show_colorbar=False)
fig, axes = render_volcano(r, style)
ax = axes[0]
g = r[r.gene == '239740'].iloc[0]
ax.scatter([g.coefficient], [-np.log10(g.p_value)], s=520, facecolors='none', edgecolors='#D55E00', linewidths=2.5, zorder=5)
ax.set_xlim(ax.get_xlim()[0], max(ax.get_xlim()[1], g.coefficient + 1.6))
fig.set_size_inches(8, 6)
fig.tight_layout(pad=0.6)
tmp = os.path.join(D, 'volcano.png')
fig.savefig(tmp, dpi=100, facecolor='white')
im = Image.open(tmp).convert('RGB')
q = 85
path = os.path.join(OUT, '05_screen_hit.webp')
while True:
    im.save(path, 'WEBP', quality=q, method=6)
    if os.path.getsize(path) < 80_000 or q <= 30: break
    q -= 5
print(im.size, os.path.getsize(path), q)
print(r[['gene', 'coefficient', 'p_value', 'q_value', 'significant']].sort_values('p_value').head(5).to_string())
print('n genes', len(r))
