"""Write figures.json and run_record.json for the permutation figures.

Reads the run record of tools/permutation/run_perm.py, the run log, and the numbers
written by tools/permutation/make_figures.py; writes
/mnt/wd4tb/scratch/n687v3/perm/out/{figures.json,run_record.json} and a copy of
run_record.json next to this script.

Usage: tools/permutation/env.sh tools/permutation/write_manifest.py --tag p2m
"""
import argparse, datetime, hashlib, json, re
from pathlib import Path

HERE = Path(__file__).resolve().parent
S = Path('/mnt/wd4tb/scratch/n687v3/perm')
OUT = S / 'out'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def sci(p):
    m, e = f'{p:.1e}'.split('e')
    return f'{m}×10^{int(e)}'


def name(row, key='gene'):
    s = row.get('symbol') or ''
    g = str(row.get(key))
    if g.startswith('225160'):
        return 'EAF1 (TGGT1_225160)' if key == 'gene' else f'EAF1 guide {g.rsplit("_", 1)[-1]}'
    if key == 'grna':
        return f'{s or "TGGT1_" + g.rsplit("_", 1)[0]} guide {g.rsplit("_", 1)[-1]}'
    return f'{s} (TGGT1_{g})' if s else f'TGGT1_{g}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', default='p2m')
    a = ap.parse_args()
    run = S / 'run' / a.tag
    rec = json.loads((run / 'run_record_part.json').read_text())
    nb = json.loads((OUT / 'work' / 'numbers.json').read_text())
    n, figs = nb['numbers'], nb['figs']
    log = (S / f'{a.tag}.log').read_text()
    rule = re.search(r'Effect-size cut: (.*)', log).group(1).strip()
    wall = re.search(r'Elapsed \(wall clock\) time \(h:mm:ss or m:ss\): (\S+)', log)
    user = re.search(r'User time \(seconds\): (\S+)', log)
    rss = re.search(r'Maximum resident set size \(kbytes\): (\d+)', log)
    B, seed, floor = n['permutations'], n['seed'], n['smallest_attainable_p']
    cut = n['effect_cut']
    gq = n['genes_q_lt_alpha']
    rq = n['guides_q_lt_alpha']
    hits = [r for r in gq if r['hit']]
    hits_r = [r for r in rq if r['hit']]
    common = (f"{B:,} within-plate Freedman-Lane permutations, seed {seed}; smallest attainable "
              f"P = 1/(B+1) = {sci(floor)}. MaxViT per-cell scores averaged per well, "
              f"{n['n_wells']:,} wells on 4 plates, partial Pearson r given plate, row and column. "
              f"Dashed line BH q = 0.05; dotted lines the spaCR effect cut ({rule}).")

    def listing(rows, key):
        return '; '.join(f"{name(r, key)} r = {r['coefficient']:+.3f}, P = {sci(r['permutation_p_value'])}, "
                         f"q = {sci(r['q_value'])}" for r in rows)

    gene_cap = (f"Gene level: {n['n_genes']} genes tested (each gene's summed guide fractions). "
                f"{len(gq)} reach BH q < 0.05 ({listing(gq, 'gene')}); "
                f"{len(hits)} also pass the effect cut: {', '.join(name(r) for r in hits)}. "
                f"{n['genes_at_floor']} genes sit at the P floor (no permutation as extreme). " + common)
    guide_cap = (f"Guide level: {n['n_guides']} guides tested. {len(rq)} reach BH q < 0.05 "
                 f"({listing(rq, 'grna')}); {len(hits_r)} pass the effect cut. "
                 f"{n['guides_at_floor']} guides sit at the P floor. " + common)
    chk = n['null_check']
    null_cap = (f"Permutation null of the gene-level partial correlation for GRA14, EAF1 and SAG1 "
                f"({B:,} draws, seed {seed}; log count scale). Solid line: observed r; dashed: -r "
                f"(the test is two-sided on |r|). b = permutations at least as extreme; "
                f"P = (b+1)/(B+1). "
                + '; '.join(f"{'EAF1' if c['gene']=='225160' else {'239740':'GRA14','233460':'SAG1'}[c['gene']]}"
                            f" r = {c['spacr_r']:+.3f}, b = {c['spacr_exceedances']}" for c in chk)
                + ". The draws were regenerated from spaCR's own projection and seeded generator, and "
                  "their exceedance counts equal the counts spaCR reported for these genes.")
    themes = {'dark': {'ground': '#0f1115', 'ink': '#ffffff'},
              'light': {'ground': '#fafaf9', 'ink': '#15181e'}}
    entries = []
    alts = {
        'perm_gene_volcano': 'Gene-level permutation volcano: partial correlation against minus log10 BH-adjusted empirical P, coloured by compartment; GRA14, EAF1 and SAG1 named.',
        'perm_guide_volcano': 'Guide-level permutation volcano: partial correlation against minus log10 BH-adjusted empirical P, coloured by compartment; GRA14 guides 1 and 3, SAG1 guide 4 and EAF1 guide 2 named.',
        'perm_null': 'Three histograms of the permutation null of the partial correlation, for GRA14, EAF1 and SAG1, each with the observed value far outside the null.',
    }
    caps = {'perm_gene_volcano': gene_cap, 'perm_guide_volcano': guide_cap, 'perm_null': null_cap}
    for fid in ('perm_gene_volcano', 'perm_guide_volcano', 'perm_null'):
        files = {}
        for th in ('dark', 'light'):
            info = figs[fid][th]
            p = OUT / info['file']
            files[th] = {'file': info['file'], 'width': info['size'][0], 'height': info['size'][1],
                         'bytes': p.stat().st_size, 'sha256': sha(p),
                         'border_exact_fraction': info['border_exact_fraction']}
        entries.append({'id': fid, 'tab': 'screen', 'files': files, 'alt': alts[fid], 'caption': caps[fid]})
    figures = {
        'item': 'N687 v3 Screen results: permutation test',
        'generated': datetime.date.today().isoformat(),
        'spacr_commit': rec['spacr_commit'],
        'themes': themes,
        'style_reference': 'Figure S7R,S of the spaCR/EAF1 preprint (within-plate Freedman-Lane permutation volcanoes, x partial Pearson r, y -log10 BH-adjusted empirical P, dashed BH q = 0.05, dotted effect cutoff, points coloured by predicted compartment)',
        'figures': entries,
        'data': {'file': 'perm.json', 'bytes': (OUT / 'perm.json').stat().st_size,
                 'sha256': sha(OUT / 'perm.json')},
        'numbers': {k: n[k] for k in ('n_genes', 'n_guides', 'n_wells', 'permutations', 'seed',
                                      'smallest_attainable_p', 'effect_cut', 'genes_at_floor',
                                      'guides_at_floor', 'genes_q_lt_alpha', 'guides_q_lt_alpha')},
        'effect_rule': rule,
    }
    (OUT / 'figures.json').write_text(json.dumps(figures, indent=1, ensure_ascii=False, default=float) + '\n')

    record = {
        'item': 'N687 v3 website permutation figures',
        'commands': [
            'tools/screen/env.sh tools/screen/fetch_example.py   (public tables, already fetched)',
            rec['command'],
            f'tools/permutation/env.sh tools/permutation/make_figures.py --tag {a.tag}',
            f'tools/permutation/env.sh tools/permutation/write_manifest.py --tag {a.tag}',
        ],
        'environment': "tools/permutation/env.sh: CUDA_VISIBLE_DEVICES='', MPLBACKEND=Agg, QT_QPA_PLATFORM=offscreen, HOME/SPACR_HOME/MPLCONFIGDIR under /mnt/wd4tb/scratch/n687v3/perm/state, OMP/BLAS threads 8, RAM cap 24G (tools/run_capped.sh), python -I; CPU only",
        'spacr_commit': rec['spacr_commit'],
        'spacr_worktree': '/mnt/wd4tb/spacr-worktrees/claude-n687-v4',
        'python': rec['python'],
        'functions': [
            'spacr.settings.get_perform_regression_default_settings',
            'spacr.ml.perform_regression (analysis_mode=guide_permutation, inference=nonparametric) -> spacr.ml._run_guide_permutation_analysis',
            'spacr.guide_permutation.analyse_long_guide_table / guide_freedman_lane_test (guides)',
            'spacr.guide_permutation.analyse_long_gene_table / gene_freedman_lane_test (genes)',
            'spacr.multiple_testing.adjust_p_values (fdr_bh), spacr.thresholds.coefficient_threshold (effect cut)',
            'spacr.permutation_qc (exchangeability report), spacr.regression_diagnostics.write_diagnostic_suite',
            'spacr.gene_tile.gene_tile (symbols, compartments)',
            'figures: spacr.figures.style.figure_style, spacr.plot.save_figure (applies spacr.figures.style._apply_user_style), tools/themed/theme.py',
            'null panel: spacr.guide_permutation.prepare_long_gene_data, _nuisance_design, _residualize with numpy.random.default_rng(seed) (exceedances verified equal to spaCR\'s)',
        ],
        'readout': {
            'what': 'MaxViT per-cell PC-class probability (column pred), averaged per well (agg_type mean)',
            'public_tables': 'plate<N>_dv.csv from the spaCR example-data release (einarolafsson/spacr-example-screen), fetched by spacr.example_data.fetch',
            'maxvit_source': 'byte-identical (sha256) to the manuscript MaxViT single-cell score source data listed in maxvit_source_data',
            'maxvit_source_data': rec['maxvit_source_data'],
        },
        'inputs': rec['inputs'],
        'settings_source': rec['settings_source'],
        'overrides': rec['overrides'],
        'seed': seed,
        'permutations': B,
        'smallest_attainable_p': floor,
        'timings': {
            'perform_regression_wall_seconds': rec['wall_seconds'],
            'process_wall': wall.group(1) if wall else None,
            'process_user_cpu_seconds': float(user.group(1)) if user else None,
            'max_rss_kb': int(rss.group(1)) if rss else None,
            'figures_seconds': n['figure_seconds'],
            'null_regeneration_seconds': n['null_regeneration_seconds'],
            'machine_load_note': 'shared workstation, load average 20-80 on 32 cores during the run',
        },
        'null_check': n['null_check'],
        'effect_rule': rule,
        'differences_from_preprint_S7S': 'The preprint run excluded the control columns (filter_value c1-c3) and the three control gRNAs, required >= 100 cells per well and < 4 vacuoles per cell, used fraction_threshold 0.0168 and log transform. This run uses the shipped spacr-example-hit settings (all columns, min_cells_per_well 10, fraction_threshold 0.02, no transform), so the control guides (SAG1 gRNA 4 and GRA14 gRNA 1 in their control columns) stay in the test.',
        'results_folder': rec['results_folder'],
        'settings': rec['settings'],
    }
    for p in (OUT / 'run_record.json', HERE / 'run_record.json'):
        p.write_text(json.dumps(record, indent=1, ensure_ascii=False, default=float) + '\n')
    print(json.dumps(figures['numbers'], indent=1, default=float))
    for e in entries:
        print(e['id'], e['caption'])


if __name__ == '__main__':
    main()
