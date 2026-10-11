"""spaCR Recruitment on the control columns of one plate of einarolafsson/spacr-example-screen.

The plate's measurements.db (plate<N>-measurements.tar) is unpacked under
dl/plates/plate<N>. Control columns follow the plate's guide read counts
(plate_<N>_unique_combinations.csv): column 1 is SAG1 (TGGT1_233460, negative
control, "nc"), column 2 is GRA14 (TGGT1_239740, positive control, "pc").
Everything else is spaCR's default Recruitment settings
(spacr.settings.get_analyze_recruitment_default_settings).

Usage: tools/themed/env.sh run_recruitment.py <plate number> [channel_of_interest]
"""
import json
import sys
from pathlib import Path

N = int(sys.argv[1])
CHANNEL = int(sys.argv[2]) if len(sys.argv) > 2 else 1
SRC = Path(f'/mnt/wd4tb/scratch/n687v3/themed/dl/plates/plate{N}')

from spacr.submodules import analyze_recruitment

settings = {
    'src': str(SRC),
    'target': 'GFP-TSG101',
    'cell_types': ['HeLa'],
    'cell_plate_metadata': None,
    'pathogen_types': ['nc', 'pc'],
    'pathogen_plate_metadata': [['c1'], ['c2']],
    'treatments': ['cm'],
    'treatment_plate_metadata': None,
    'channel_dims': [0, 1, 2, 3],
    'cell_chann_dim': 3,
    'nucleus_chann_dim': 0,
    'pathogen_chann_dim': 2,
    'channel_of_interest': CHANNEL,
    'plot': False,
    'plot_control': False,
}
cells, wells = analyze_recruitment(settings)
used = {k: (v if isinstance(v, (int, float, str, list, type(None), bool)) else str(v)) for k, v in settings.items()}
json.dump(used, open(SRC / 'results' / 'recruitment_settings_used.json', 'w'), indent=1)
cols = [c for c in wells.columns if 'recruitment' in c]
print(wells.groupby('pathogen')[cols].mean().T.to_string())
print(wells.groupby('pathogen').size())
