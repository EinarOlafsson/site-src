"""Dose-response example: spaCR's Dose-Response screen fitted on spacr-example-dose."""
import json, sys
from pathlib import Path
import pandas as pd
from common import qt_app, to_webp, OUT as FINAL
app = qt_app()
from spacr.qt.screens.dose_response import DoseResponseScreen
from spacr.qt.widgets.dose_response import STATUS_FITTED
from spacr.plot import save_figure

DATA = Path('/mnt/wd4tb/scratch/n687/examples/data/spacr-example-dose')
OUT = Path('/mnt/wd4tb/scratch/n687/examples/out/work'); OUT.mkdir(parents=True, exist_ok=True)

screen = DoseResponseScreen(threaded=False)
screen.resize(1300, 800)
screen._open_the_dose_example(DATA)
full = screen._frame.copy()

def pick(p, v):
    i = p.findData(v); p.setCurrentIndex(i if i >= 0 else p.findText(v))

from dataclasses import replace
from spacr.qt.widgets.dose_response import fit_frame
all_set = fit_frame(full, replace(screen.spec(), group='compound'))
table = all_set.table()
table.to_csv(OUT / 'dose_all_fits.csv', index=False)
counts = table.status.value_counts().to_dict()
fitted = table[table.status == STATUS_FITTED].sort_values('ec50')
print(counts); print(fitted[['group', 'ec50', 'ec50_low', 'ec50_high', 'hill', 'r_squared', 'lack_of_fit_p']])

keep = list(fitted.group)
screen.set_frame(full[full.compound.isin(keep)].reset_index(drop=True))
for p, v in ((screen.concentration_picker, 'dose_uM'),
             (screen.response_picker, 'Cells_Number_Object_Number'),
             (screen.group_picker, 'compound')):
    pick(p, v)
screen.unit_edit.setText('µM')
screen.fit()
print(screen.spec())
s = screen.result_set()
names = [f.group for f in s.fits]
sel = names.index('SNX-2112')
screen.show_group(sel)
report = screen.report.toPlainText()
print(report)
fig = screen._figure
fig.set_size_inches(6.5, 4.4)
from spacr.figures.style import _apply_user_style
_apply_user_style(fig)
for t in fig.axes[0].texts:
    t.set_fontsize(max(t.get_fontsize(), 11))
fig.tight_layout()
path = save_figure(fig, OUT / 'dose_response.png', fmt='png', dpi=180)
print('saved', path, to_webp(path, FINAL / 'dose_response.webp'))
json.dump({'status_counts': {str(k): int(v) for k, v in counts.items()},
           'n_wells': int(len(full)), 'n_plates': int(full.plate.nunique()),
           'n_compounds_excl_dmso': int(full[full.compound != 'DMSO'].compound.nunique()),
           'fitted': fitted[['group', 'ec50', 'ec50_low', 'ec50_high', 'hill', 'r_squared', 'n']].to_dict('records'),
           'selected': 'SNX-2112', 'report': report},
          open(OUT / 'dose_numbers.json', 'w'), indent=1, default=float)
