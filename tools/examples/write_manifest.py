"""Write out/examples.json from the numbers the make_*.py scripts saved."""
import json
from pathlib import Path
OUT = Path('/mnt/wd4tb/scratch/n687/examples/out'); W = OUT / 'work'
dose = json.load(open(W / 'dose_numbers.json'))
cc = json.load(open(W / 'control_chart_numbers.json'))
hit = json.load(open(W / 'hit_numbers.json'))
snx = next(f for f in dose['fitted'] if f['group'] == 'SNX-2112')
entries = [
 {"file": "dose_response.webp",
  "dataset": {"repo": "einarolafsson/spacr-example-dose", "repo_type": "dataset", "files": ["dose_plate.csv"]},
  "licence": "CC0-1.0",
  "spacr": ["spacr.qt.screens.dose_response.DoseResponseScreen (_open_the_dose_example, fit, show_group, _draw)",
            "spacr.qt.widgets.dose_response.fit_frame (4PL, profile-likelihood 95% CI)",
            "spacr.plot.save_figure", "spacr.figures.style._apply_user_style"],
  "settings": {"concentration": "dose_uM", "response": "Cells_Number_Object_Number", "group": "compound",
               "model": "4pl", "ci_method": "profile", "unit": "µM"},
  "key_numbers": {"wells": dose['n_wells'], "plates": dose['n_plates'], "compound_groups_fitted": 59,
                  "status_counts": dose['status_counts'],
                  "bounded_ec50_uM": {f['group']: {"ec50": round(f['ec50'], 3), "ci95": [round(f['ec50_low'], 3), round(f['ec50_high'], 3)],
                                       "hill": round(f['hill'], 2), "r2": round(f['r_squared'], 3)} for f in dose['fitted']},
                  "highlighted": "SNX-2112"},
  "caption": f"Four-parameter logistic fits of median cell count against dose for the 5 of 58 LINCS compounds (A549, 4 plates) with a bounded EC50; SNX-2112 EC50 {snx['ec50']:.3f} µM (95% profile CI {snx['ec50_low']:.3f}–{snx['ec50_high']:.3f}).",
  "notes": "Fit over all compounds with the engine (fit_frame); the figure redraws the 5 bounded fits in the screen. 28 groups were unbounded (EC50 outside the tested range) and 26 refused (non-monotone, or DMSO/MG-132/bortezomib with a single dose)."},
 {"file": "control_chart.webp",
  "dataset": {"repo": "einarolafsson/spacr-example-control-chart", "repo_type": "dataset", "files": ["control_chart_wells.csv"]},
  "licence": "CC0-1.0",
  "spacr": ["spacr.qt.screens.control_chart.ControlChartScreen (set_frame, recompute)",
            "spacr.qt.widgets.control_chart.control_chart (X-bar/S, rules 1,2,5,6)",
            "spacr.plot.save_figure", "spacr.figures.style._apply_user_style"],
  "settings": {"value": "Cells_Number_Object_Number", "plate": "plate", "order": "run_order",
               "control_column": "well_type", "control_levels": ["negcon"], "estimator": cc['estimator'],
               "baseline_plates": len(cc['baseline_plates']), "rules": cc['rules']},
  "key_numbers": {"plates": cc['n_plates'], "wells": cc['n_wells_total'], "negcon_wells": cc['n_negcon_wells'],
                  "centre": round(cc['centre'], 2), "sigma": round(cc['sigma'], 3),
                  "rule_violations": len(cc['violations']), "plates_flagged": len(cc['flagged_plates'])},
  "caption": f"X-bar/S control chart of DMSO-well median cell count across the {cc['n_plates']} CPJUMP1 compound plates; {len(cc['flagged_plates'])} of {cc['n_plates']} plates fall outside the limits, following the cell-line, time-point and seeding-density changes between plate groups.",
  "notes": "All 24 plates mix 7 plate conditions, so the chart shows the design changes as shifts (as the dataset card says). spaCR's report states the baseline itself is out of control."},
 {"file": "hit_volcano.webp",
  "dataset": {"repo": "einarolafsson/spacr-example-hit", "repo_type": "dataset",
              "files": ["spacr-example-hit.tar: plate1_dv.csv, plate_1_unique_combinations.csv, settings/regression.json"]},
  "licence": "CC-BY-4.0",
  "spacr": ["spacr.ml.perform_regression (OLS, well level, shipped settings)",
            "spacr.qt.screens.volcano.load_results", "spacr.volcano_style.render_volcano",
            "spacr.plot.save_figure", "spacr.figures.style._apply_user_style"],
  "settings": {"regression_type": "ols", "dependent_variable": "pred", "fraction_threshold": 0.02,
               "multiple_testing": "fdr_bh", "alpha": 0.05, "level": "gene"},
  "key_numbers": {"wells": hit['n_wells'], "gene_coefficients": hit['n_coefficients'],
                  "called_q_lt_0.05": [{"gene": r['gene'], "name": r['gene_name'], "control": r['condition'],
                                         "effect": round(r['coefficient'], 3), "p": float(f"{r['p_value']:.3g}"),
                                         "q": float(f"{r['q_value']:.3g}"), "wells": int(r['n_gene'])}
                                        for r in hit['called_q_lt_0.05']]},
  "caption": "Gene-level OLS regression of a GRA14-knockout-like score on guide fraction across 30 wells of the TSG101 recruitment screen; GRA14 (effect 0.482, q 0.040) and SAG1 (effect -0.708, q 0.006), the positive and negative controls, pass q < 0.05.",
  "notes": "Re-run reproduces the dataset card's GRA14 numbers (effect 0.482, p 0.00617, adjusted 0.0401). Demonstration cut of one plate; the hit is the screen's built-in positive control."},
]
not_produced = [{"item": "tracked time-lapse loop (MP4/WebM/WebP poster)",
                 "reason": "No time-lapse example exists in spaCR's public data: none of the einarolafsson spacr-example-* datasets, spacr-tutorials, or tests/data holds a multi-frame movie (spacr-example-import's leica_lasx_series_time variant is a single t000 naming test). Not produced; no other project's data used."}]
json.dump({"item": "N687", "spacr_commit": "55dbed313 (origin/nightly worktree claude-n687-20261010)",
           "generated": "2026-10-10", "examples": entries, "not_produced": not_produced},
          open(OUT / 'examples.json', 'w'), indent=2, ensure_ascii=False)
print(open(OUT / 'examples.json').read()[:400])
