"""Dose-response figure, dark and light: spaCR's Dose-Response screen on spacr-example-dose.

Same data, settings and selection as tools/examples/make_dose.py; only the
theme changes. Usage: tools/themed/env.sh make_dose.py dark|light
"""
import json
import sys
from dataclasses import replace
from pathlib import Path

from theme import qt_app, enforce, lift_data_colours, save_pair_png, to_webp, ground_check, WORK

THEME = sys.argv[1]
app = qt_app(THEME)
from spacr.qt.screens.dose_response import DoseResponseScreen
from spacr.qt.widgets.dose_response import STATUS_FITTED, fit_frame
from spacr.figures.style import _apply_user_style

DATA = Path('/mnt/wd4tb/scratch/n687/examples/data/spacr-example-dose')

screen = DoseResponseScreen(threaded=False)
screen.resize(1300, 800)
screen._open_the_dose_example(DATA)
full = screen._frame.copy()


def pick(p, v):
    i = p.findData(v)
    p.setCurrentIndex(i if i >= 0 else p.findText(v))


table = fit_frame(full, replace(screen.spec(), group='compound')).table()
counts = table.status.value_counts().to_dict()
fitted = table[table.status == STATUS_FITTED].sort_values('ec50')
keep = list(fitted.group)
screen.set_frame(full[full.compound.isin(keep)].reset_index(drop=True))
for p, v in ((screen.concentration_picker, 'dose_uM'),
             (screen.response_picker, 'Cells_Number_Object_Number'),
             (screen.group_picker, 'compound')):
    pick(p, v)
screen.unit_edit.setText('µM')
screen.fit()
s = screen.result_set()
names = [f.group for f in s.fits]
screen.show_group(names.index('SNX-2112'))
report = screen.report.toPlainText()
fig = screen._figure
fig.set_size_inches(6.5, 4.4)
_apply_user_style(fig)
ax = fig.axes[0]
for t in ax.texts:
    t.set_fontsize(max(t.get_fontsize(), 11))
FADED = {'dark': 0.8, 'light': 0.5}[THEME]
leg = ax.get_legend()
for line in list(ax.lines) + list(getattr(leg, 'legend_handles', []) if leg else []):
    a = line.get_alpha()
    if a is not None and a < 0.5:
        line.set_alpha(FADED)
print('lifted', lift_data_colours(fig, THEME))
enforce(fig, THEME)
fig.tight_layout()
png = save_pair_png(fig, THEME, 'dose_response', dpi=180)
info = to_webp(png, THEME, 'dose_response', width=1170)
info.update(ground_check(Path(WORK.parent) / info['file'], THEME))
sel = fitted.set_index('group').loc['SNX-2112']
numbers = {'status_counts': {str(k): int(v) for k, v in counts.items()},
           'n_wells': int(len(full)), 'n_plates': int(full.plate.nunique()),
           'n_compounds_excl_dmso': int(full[full.compound != 'DMSO'].compound.nunique()),
           'fitted': fitted[['group', 'ec50', 'ec50_low', 'ec50_high', 'hill', 'r_squared', 'n']].to_dict('records'),
           'SNX-2112': {'ec50': float(sel.ec50), 'ci95': [float(sel.ec50_low), float(sel.ec50_high)]},
           'report': report, 'webp': info}
json.dump(numbers, open(WORK / f'dose_numbers.{THEME}.json', 'w'), indent=1, default=float)
print(json.dumps({k: numbers[k] for k in ('status_counts', 'n_wells', 'n_plates', 'SNX-2112', 'webp')}, default=float))
