"""Within-plate Freedman-Lane permutation test of the four-plate spaCR example screen.

Readout: the per-cell MaxViT scores of the GFP-TSG101 recruitment screen. The
public example tables plate<N>_dv.csv (spaCR example-data release, fetched by
tools/screen/fetch_example.py) are byte-identical (cmp, sha256) to the
manuscript's MaxViT single-cell source data
(Figure_5B-C_Figure_S5_MaxViT_single_cell_scores_plate<N>.csv); column 'pred'
is the MaxViT PC-class probability. Guide counts: plate_<N>_unique_combinations.csv.

Analysis: spacr.ml.perform_regression with analysis_mode='guide_permutation'
(the branch spaCR's Regression module and its QC advice route to when the
guide-level design is not identifiable). It runs
spacr.guide_permutation.analyse_long_guide_table (guides) and
analyse_long_gene_table (genes): partial Pearson correlation of the
well-level phenotype and each guide/gene fraction after plate + row + column
adjustment, Freedman-Lane residual permutations within plate, two-sided
empirical P = (b + 1)/(B + 1), Benjamini-Hochberg per family.

Settings: einarolafsson/spacr-example-hit settings/regression.json (shipped)
with only inputs/src/dst replaced by the four plates and the permutation
options set: analysis_mode='guide_permutation', inference='nonparametric',
guide_permutations=<--permutations>, guide_permutation_seed=<--seed>.
regression_qc False (QC writes diagnostic PDFs only).

Run: tools/permutation/env.sh tools/permutation/run_perm.py --permutations 2000000 --seed 0
"""
import sys
sys.path.insert(0, '/mnt/wd4tb/spacr-worktrees/claude-n687-v4')
import argparse, hashlib, json, os, platform, subprocess, time, resource
from pathlib import Path

S = Path('/mnt/wd4tb/scratch/n687v3/perm')
DATA = Path('/mnt/wd4tb/scratch/n687v3/ols/dl/example_data')
SHIPPED = Path('/mnt/wd4tb/scratch/n687v3/ols/dl/hit/settings/regression.json')
MAXVIT = Path('/mnt/firecuda2/Claude/toxoplasma_projects/manuscript/version_2/submit/source_data/'
              'Figure_5B_C_and_Figure_S5_MaxViT_single_cell_scores')
WT = '/mnt/wd4tb/spacr-worktrees/claude-n687-v4'


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--permutations', type=int, default=200000)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--tag', default='screen4')
    a = ap.parse_args()
    run = S / 'run' / a.tag
    run.mkdir(parents=True, exist_ok=True)
    shipped = json.load(open(SHIPPED))
    settings = {k: v for k, v in shipped.items() if not k.startswith('_')}
    pairs = [{'score': str(DATA / f'plate{n}_dv.csv'),
              'count': str(DATA / f'plate_{n}_unique_combinations.csv'),
              'plate': f'plate{n}', 'database': None} for n in (1, 2, 3, 4)]
    overrides = dict(paired_data=pairs,
                     score_data=[p['score'] for p in pairs],
                     count_data=[p['count'] for p in pairs],
                     input_pair_audit=[], src=str(run), dst=str(run / 'results'),
                     regression_qc=False,
                     analysis_mode='guide_permutation',
                     inference='nonparametric',
                     guide_permutations=int(a.permutations),
                     guide_permutation_seed=int(a.seed))
    settings.update(overrides)
    from spacr.settings import get_perform_regression_default_settings
    from spacr.ml import perform_regression
    settings = get_perform_regression_default_settings(settings)
    t0 = time.time()
    c0 = time.process_time()
    out = perform_regression(settings)
    took = time.time() - t0
    cpu = time.process_time() - c0
    commit = subprocess.run(['git', '-C', WT, 'rev-parse', 'HEAD'],
                            capture_output=True, text=True).stdout.strip()
    inputs = {}
    for p in sorted(DATA.glob('*.csv')):
        inputs[p.name] = {'path': str(p), 'bytes': p.stat().st_size, 'sha256': sha(p)}
    maxvit = {}
    for n in (1, 2, 3, 4):
        m = MAXVIT / f'Figure_5B-C_Figure_S5_MaxViT_single_cell_scores_plate{n}.csv'
        if m.exists():
            d = inputs[f'plate{n}_dv.csv']
            maxvit[m.name] = {'path': str(m), 'bytes': m.stat().st_size, 'sha256': sha(m),
                              'identical_to': f'plate{n}_dv.csv' if sha(m) == d['sha256'] else None}
    record = {
        'tag': a.tag,
        'command': f'tools/permutation/env.sh tools/permutation/run_perm.py --permutations {a.permutations} --seed {a.seed} --tag {a.tag}',
        'function': 'spacr.ml.perform_regression(analysis_mode=guide_permutation) -> spacr.ml._run_guide_permutation_analysis -> spacr.guide_permutation.analyse_long_guide_table + analyse_long_gene_table',
        'spacr_commit': commit,
        'python': platform.python_version(),
        'wall_seconds': round(took, 1),
        'cpu_seconds_main_process': round(cpu, 1),
        'max_rss_mb': round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024, 1),
        'permutations': int(a.permutations),
        'seed': int(a.seed),
        'smallest_attainable_p': 1.0 / (int(a.permutations) + 1),
        'settings_source': 'einarolafsson/spacr-example-hit settings/regression.json (sha256 %s)' % sha(SHIPPED),
        'overrides': json.loads(json.dumps({k: v for k, v in overrides.items()
                                            if k not in ('paired_data', 'input_pair_audit')}, default=str)),
        'inputs': inputs,
        'maxvit_source_data': maxvit,
        'results_folder': str(run / 'results'),
        'outputs': sorted(out.keys()) if isinstance(out, dict) else str(type(out)),
        'settings': json.loads(json.dumps(settings, default=str)),
    }
    (run / 'run_record_part.json').write_text(json.dumps(record, indent=1) + '\n')
    print('done', took, record['outputs'])


if __name__ == '__main__':
    main()
