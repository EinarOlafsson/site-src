"""Control chart, dark and light: spaCR's Control Chart screen on spacr-example-control-chart.

Same data and settings as tools/examples/make_control_chart.py; only the theme
changes. Usage: tools/themed/env.sh make_control_chart.py dark|light
"""
import json
import pandas as pd
import sys
from pathlib import Path
from theme import qt_app, enforce, lift_data_colours, save_pair_png, to_webp, ground_check, WORK
THEME = sys.argv[1]
app = qt_app(THEME)
from spacr.qt.screens.control_chart import ControlChartScreen

CSV = '/mnt/wd4tb/scratch/n687/examples/data/spacr-example-control-chart/control_chart_wells.csv'
VALUE = 'Cells_Number_Object_Number'
frame = pd.read_csv(CSV)
screen = ControlChartScreen(threaded=False)
screen.resize(1400, 900)
screen.set_frame(frame)
screen._loading = True
screen._plate.setCurrentText('plate')
screen._order.setCurrentText('run_order')
screen._value.setCurrentText(VALUE)
screen._control_column.setCurrentText('well_type')
screen._refill_levels(frame)
for i in range(screen._levels.count()):
    it = screen._levels.item(i)
    it.setSelected(it.text() == 'negcon')
screen._loading = False
print(screen.spec())
screen.recompute()
r = screen.result
print(r.report())
from spacr.figures.style import _apply_user_style
fig = screen.canvas.figure
fig.set_size_inches(9.0, 5.6)
_apply_user_style(fig)
ax = fig.axes[0]
handles, labels = ax.get_legend_handles_labels()
ax.get_legend().remove()
ax.legend(handles, labels, loc='lower center', bbox_to_anchor=(0.5, 1.01), ncol=2,
          frameon=False, fontsize=10, labelcolor=ax.yaxis.label.get_color())
lo, hi = ax.get_ylim()
ax.set_ylim(lo, hi + 0.08 * (hi - lo))
for t in fig.axes[0].texts:
    t.set_fontsize(max(t.get_fontsize(), 10))
print('lifted', lift_data_colours(fig, THEME))
enforce(fig, THEME)
fig.tight_layout(pad=0.6)
png = save_pair_png(fig, THEME, 'control_chart', dpi=150)
info = to_webp(png, THEME, 'control_chart', width=1200)
info.update(ground_check(WORK.parent / info['file'], THEME))
print(info)
flag = sorted({r.plates[p] for v in r.violations for p in v.points})
json.dump({'n_plates': len(r), 'n_wells_total': int(len(frame)),
           'n_negcon_wells': int(r.subgroup_sizes.sum()),
           'centre': float(r.centre), 'sigma': float(r.sigma), 'estimator': r.estimator,
           'baseline_plates': [r.plates[i] for i in r.baseline],
           'rules': list(r.rules),
           'violations': [{'rule': v.rule, 'plates': [r.plates[p] for p in v.points]} for v in r.violations],
           'flagged_plates': flag, 'report': r.report(), 'webp': info},
          open(WORK / f'control_chart_numbers.{THEME}.json', 'w'), indent=1)
