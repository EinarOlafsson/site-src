"""Write figures.json for the themed figure pairs from the numbers files in work/."""
import json
from pathlib import Path
from PIL import Image

OUT = Path('/mnt/wd4tb/scratch/n687v3/themed')
W = OUT / 'work'
SPACR = 'a3dd6a6b8588f4cf3487ca73719edf5fdc75b397 (worktree claude-n687-v3)'
ENV = ("tools/themed/env.sh: CUDA_VISIBLE_DEVICES='', MPLBACKEND=Agg, QT_QPA_PLATFORM=offscreen, "
       "isolated HOME/SPACR_HOME/MPLCONFIGDIR, RAM cap 24G (tools/run_capped.sh)")


def pair(name):
    files = {}
    for t in ('dark', 'light'):
        p = OUT / f'{name}.{t}.webp'
        im = Image.open(p)
        files[t] = {'file': p.name, 'width': im.width, 'height': im.height, 'bytes': p.stat().st_size}
    assert (files['dark']['width'], files['dark']['height']) == (files['light']['width'], files['light']['height'])
    return files


def sup(p):
    m, e = f'{p:.1e}'.split('e')
    return f"p = {m} × 10" + str(int(e)).translate(str.maketrans('-0123456789', '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'))


dose = json.load(open(W / 'dose_numbers.dark.json'))
assert dose['fitted'] == json.load(open(W / 'dose_numbers.light.json'))['fitted']
snx = dose['SNX-2112']
cc = json.load(open(W / 'control_chart_numbers.dark.json'))
assert cc['centre'] == json.load(open(W / 'control_chart_numbers.light.json'))['centre']
pl = json.load(open(W / 'plaque_numbers.json'))
rc = json.load(open(W / 'recruitment_numbers.json'))
n_fit = len(dose['fitted'])

figures = [
    {
        'id': 'dose_response', 'tab': 'assays', 'replaces': 'src/assets/img/examples/dose_response.webp',
        'files': pair('dose_response'),
        'alt': 'Dose-response curves of median cell count for five compounds, SNX-2112 highlighted with its EC50',
        'caption': (f"Dose-Response: four-parameter logistic fits for the {n_fit} of {dose['n_compounds_excl_dmso']} "
                    f"compounds with a bounded EC50; SNX-2112 EC50 {snx['ec50']:.3f} µM "
                    f"(95% CI {snx['ci95'][0]:.3f}–{snx['ci95'][1]:.3f}). Data: spacr-example-dose, "
                    f"{dose['n_wells']:,} wells, {dose['n_plates']} plates."),
        'numbers': {k: dose[k] for k in ('status_counts', 'n_wells', 'n_plates', 'n_compounds_excl_dmso', 'fitted')},
        'provenance': {'dataset': 'einarolafsson/spacr-example-dose (CC0-1.0), dose_plate.csv',
                       'script': 'tools/themed/make_dose.py <dark|light>',
                       'spacr': ['spacr.qt.screens.dose_response.DoseResponseScreen', 'spacr.qt.widgets.dose_response.fit_frame',
                                 'spacr.figures.style._apply_user_style', 'spacr.plot.save_figure'],
                       'theme_changes': 'chrome in theme ink; unfocused series alpha 0.8 (dark) / 0.5 (light); '
                                        'series colours below 3:1 on the light ground mixed toward the ink (SNX-2112 '
                                        '#eda100 -> #c28606 on light)'},
    },
    {
        'id': 'control_chart', 'tab': 'assays', 'replaces': 'src/assets/img/examples/control_chart.webp',
        'files': pair('control_chart'),
        'alt': 'Control chart of DMSO-well median cell count across 24 plates with control limits and flagged plates',
        'caption': (f"Control chart: DMSO-well median cell count across {cc['n_plates']} plates; all "
                    f"{len(cc['flagged_plates'])} fall outside the limits after cell-line, time-point and seeding "
                    "changes. Data: spacr-example-control-chart."),
        'numbers': {k: cc[k] for k in ('n_plates', 'n_wells_total', 'n_negcon_wells', 'centre', 'sigma', 'estimator',
                                       'flagged_plates')} | {'rule_violations': len(cc['violations'])},
        'provenance': {'dataset': 'einarolafsson/spacr-example-control-chart, control_chart_wells.csv',
                       'script': 'tools/themed/make_control_chart.py <dark|light>',
                       'spacr': ['spacr.qt.screens.control_chart.ControlChartScreen', 'spacr.plot.save_figure']},
    },
    {
        'id': 'plaque', 'tab': 'assays', 'replaces': 'src/assets/img/models/plaque-figure.webp (no caption strip now)',
        'files': pair('plaque'),
        'alt': f"Crystal-violet plaque well with {pl['count_in_saved_mask']} plaques outlined in magenta",
        'caption': (f"Plaque Assay: {pl['count_in_saved_mask']} plaques found by toxoplasma_plaque_v3 in a well from "
                    f"Cabral et al. 2024 (CC BY 4.0); {pl['reference_count']} in the hand-drawn mask."),
        'numbers': {k: pl[k] for k in ('count_in_saved_mask', 'reference_count', 'tp', 'fp', 'fn', 'f1_at_iou_0_5')},
        'provenance': {'image': pl['image'], 'mask': pl['mask'] + ' (saved toxoplasma_plaque_v3 output; model not re-run)',
                       'weights_sha256': pl['weights_sha256'], 'script': 'tools/themed/make_plaque.py',
                       'render': f"outlines {pl['line_px']} px at {pl['size'][0]} px width, 4x supersampled, "
                                 f"{pl['outline_colour']}; outside the fitted well circle (native centre/radius "
                                 f"{pl['well_circle_native_px']}) is the theme ground",
                       'ground_note': 'lossy WebP (lossless does not fit 100 kB); ground decodes within 1 level of '
                                      'the theme colour (#0f1014 / #fafafa)'},
    },
    {
        'id': 'recruitment', 'tab': 'assays', 'replaces': 'src/assets/img/spacr/recruitment.webp',
        'files': pair('recruitment'),
        'alt': 'Bar plots of GFP-TSG101 recruitment for negative and positive control wells on four plates',
        'caption': (f"Recruitment: GFP-TSG101 vacuole-to-cytoplasm ratio in SAG1 (negative) and GRA14 (positive) "
                    f"control wells on four plates, 16 wells each; plate means {rc['mean_of_plate_means']['nc']:.2f} vs "
                    f"{rc['mean_of_plate_means']['pc']:.2f}, {sup(rc['p_student_plate_means'])} (t-test, n = 4). "
                    "Data: spacr-example-screen."),
        'numbers': {k: rc[k] for k in ('wells_per_plate', 'plate_means', 'mean_of_plate_means', 'p_student_plate_means',
                                       'p_welch_plate_means', 'p_paired_plate_means', 'p_student_all_wells')},
        'provenance': {'dataset': 'einarolafsson/spacr-example-screen (CC BY 4.0), plate1-4-measurements.tar',
                       'scripts': ['tools/themed/fetch_screen_measurements.py', 'tools/themed/run_recruitment.py <1-4> 1',
                                   'tools/themed/make_recruitment.py'],
                       'spacr': ['spacr.submodules.analyze_recruitment (default settings; channel_of_interest 1; '
                                 'nc = column 1 SAG1, pc = column 2 GRA14 from the plate guide counts)',
                                 'spacr.figures.style.figure_style', 'spacr.plot.save_figure'],
                       'previous_image': 'crop of README deck slide 43 (docs/source/_static/deck, "preprint data"); '
                                         'no generator in site-v3; p = 8.4e-5 there'},
    },
]
manifest = {'item': 'N687 themed figures', 'generated': '2026-10-10', 'spacr_commit': SPACR, 'environment': ENV,
            'themes': {'dark': {'ground': '#0f1115', 'ink': '#ffffff'}, 'light': {'ground': '#fafaf9', 'ink': '#15181e'}},
            'figures': figures,
            'not_made': [{'id': 'volcano', 'source': 'src/assets/img/spacr/volcano.webp (preprint Fig. 5 crop, CC BY-NC-ND)',
                          'reason': 'not reproducible from public data: plate<N>_dv.csv has one per-cell score column '
                                    '(pred, with cv_predictions 0/1) and no classifier label; no MaxViT or second '
                                    'classifier score is published in spacr-example-screen, spacr-example-hit or the '
                                    'example-data release. Show the existing crop on a neutral card.'}]}
json.dump(manifest, open(OUT / 'figures.json', 'w'), indent=1, ensure_ascii=False, default=float)
for f in figures:
    print(f['id'], f['files']['dark']['width'], f['files']['dark']['height'],
          f['files']['dark']['bytes'], f['files']['light']['bytes'], '|', f['caption'])
