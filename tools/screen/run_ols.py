"""OLS regression of the four-plate spaCR example screen for the website volcano.

Data: the published GFP-TSG101 recruitment screen (HF dataset
einarolafsson/spacr-example-screen). Its card says the per-cell classifier
scores (plate<N>_dv.csv) and the per-well guide read counts
(plate_<N>_unique_combinations.csv) are distributed with the spaCR
example-data release; spaCR's Regression screen fetches exactly these eight
files with "Load test data..." (spacr.example_data.fetch, SHA-256 checked
against spacr/example_data_manifest.py). tools/screen/fetch_example.py runs that
fetch into SPACR_EXAMPLE_DATA.

Settings: the screen ships no settings file, so the run uses the Regression
settings shipped with the plate-1 cut of the same screen
(einarolafsson/spacr-example-hit, settings/regression.json), with only the
input tables (paired_data/score_data/count_data), src and dst replaced by the
four plates, private "_" keys dropped, regression_type forced to 'ols', and
regression_qc False (QC writes diagnostic PDFs only; it does not change any
coefficient). Every other value is the shipped one, then
spacr.settings.get_perform_regression_default_settings fills the rest, as
the app does.

Command (from the site clone root):
    tools/screen/env.sh tools/screen/fetch_example.py
    tools/screen/env.sh tools/screen/run_ols.py
env.sh: CUDA_VISIBLE_DEVICES='' MPLBACKEND=Agg QT_QPA_PLATFORM=offscreen,
isolated HOME/SPACR_HOME/MPLCONFIGDIR under /mnt/wd4tb/scratch/n687v3/ols/state,
RAM capped at 24G by tools/run_capped.sh, python -I with the spaCR worktree
put on sys.path here.

Run of record (2026-10-10): spaCR commit b0952ec3af1cad78e5f2c4159bc2e7ccb3e24bd0,
Python 3.12.13, 114.5 s on CPU. Inputs (bytes, sha256; equal to
spacr/example_data_manifest.py):
  plate1_dv.csv 5088290 06aa6e51e17eb2423f9e534deb984533b98d10945dd4a7f9a8bac2f93d088594
  plate2_dv.csv 5003197 6f079cad146f0d507524317fa026235a2f76a7be04da4be396cec3628c1d1fef
  plate3_dv.csv 4824810 5cd7b59d55504680272b47060c7056dd76eb85e59d3571bbe8974e62da08d369
  plate4_dv.csv 4240228 7d5800071c15098d9f3fe02a84580d884db7a145b06e72bf5fe048286d23d07e
  plate_1_unique_combinations.csv 4325565 9bbfd6de409ec501b94abd2f20230611a695b142228892f5c3b8b2b564ba1f13
  plate_2_unique_combinations.csv 4186654 88142a5b8df993f881748845d15f2290e662cccddde269cbeacea8f28b119bf8
  plate_3_unique_combinations.csv 3577071 3fdb0c1d28f6074211775e72a93ce5a2531f4049093578251a8ee36bbc85765e
  plate_4_unique_combinations.csv 3983853 7888648e1e45155e6ef2efe44bfe02b7577a8469ca75c51a7abc6b4981abad34
  shipped settings/regression.json sha256 6f65a40c08ea316266a115c41770563585ba669b5fbe5cd75af36535cf517c49
Key settings: regression_type ols, inference parametric, level both,
analysis_unit well, agg_type mean, dependent_variable pred,
fraction_threshold 0.02, min_cells_per_well 10, outlier_detection False,
multiple_testing_method fdr_bh, fdr_alpha 0.05, intercept fitted,
model_plate_position False, positive_control_id 239740, negative_control_id
233460, nontargeting_control_grnas ['000000'], backend statsmodels (CPU).
The full settings dict is in run_record_ols.json.
"""
import sys
sys.path.insert(0, '/mnt/wd4tb/spacr-worktrees/claude-n687-v4')
import hashlib, json, os, platform, subprocess, time
from pathlib import Path

S = Path('/mnt/wd4tb/scratch/n687v3/ols')
DATA = S / 'dl' / 'example_data'
SHIPPED = S / 'dl' / 'hit' / 'settings' / 'regression.json'
RUN = S / 'run' / 'screen4'
RECORD = Path(__file__).resolve().parent / 'run_record_ols.json'
WT = '/mnt/wd4tb/spacr-worktrees/claude-n687-v4'


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main():
    shipped = json.load(open(SHIPPED))
    settings = {k: v for k, v in shipped.items() if not k.startswith('_')}
    pairs = [{'score': str(DATA / f'plate{n}_dv.csv'),
              'count': str(DATA / f'plate_{n}_unique_combinations.csv'),
              'plate': f'plate{n}', 'database': None} for n in (1, 2, 3, 4)]
    RUN.mkdir(parents=True, exist_ok=True)
    settings.update(paired_data=pairs,
                    score_data=[p['score'] for p in pairs],
                    count_data=[p['count'] for p in pairs],
                    input_pair_audit=[], src=str(RUN), dst=str(RUN / 'results'),
                    regression_type='ols', regression_qc=False)
    from spacr.settings import get_perform_regression_default_settings
    from spacr.ml import perform_regression
    settings = get_perform_regression_default_settings(settings)
    t0 = time.time()
    out = perform_regression(settings)
    took = time.time() - t0
    model = out.get('model') if isinstance(out, dict) else None
    if model is not None and hasattr(model, 'tvalues'):
        import numpy as np, pandas as pd
        from scipy import stats
        df_resid = float(getattr(model, 'df_resid', np.nan))
        t = pd.Series(model.tvalues)
        frame = pd.DataFrame({'feature': t.index, 'coefficient': pd.Series(model.params).values,
                              'std_err': pd.Series(model.bse).values, 't': t.values,
                              'df_resid': df_resid})
        frame['log10_p'] = (np.log10(2.0) + stats.t.logsf(np.abs(frame['t']), df_resid) / np.log(10))
        frame.to_csv(RUN / 'results' / 'ols' / 'fit_stats_primary_model.csv', index=False)
    commit = subprocess.run(['git', '-C', WT, 'rev-parse', 'HEAD'],
                            capture_output=True, text=True).stdout.strip()
    record = {
        'item': 'N687 v3 website OLS volcano',
        'command': ['tools/screen/env.sh tools/screen/fetch_example.py',
                    'tools/screen/env.sh tools/screen/run_ols.py',
                    'tools/screen/env.sh tools/screen/export_volcano.py'],
        'function': 'spacr.ml.perform_regression (after spacr.settings.get_perform_regression_default_settings)',
        'spacr_commit': commit,
        'spacr_worktree': WT,
        'python': platform.python_version(),
        'seconds': round(took, 1),
        'dataset': 'einarolafsson/spacr-example-screen (4 plates); tables from the spaCR example-data release (github.com/EinarOlafsson/spacr/releases/tag/example-data) via spacr.example_data.fetch',
        'settings_source': 'einarolafsson/spacr-example-hit settings/regression.json (sha256 %s); inputs swapped to the four plates, regression_type ols, regression_qc False' % sha(SHIPPED),
        'inputs': {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)}
                   for p in sorted(DATA.glob('*.csv'))},
        'results_folder': str(RUN / 'results'),
        'outputs': sorted(out.keys()) if isinstance(out, dict) else str(type(out)),
        'settings': json.loads(json.dumps(settings, default=str)),
    }
    RECORD.write_text(json.dumps(record, indent=1) + '\n')
    print('done', took, record['outputs'])


if __name__ == '__main__':
    main()
