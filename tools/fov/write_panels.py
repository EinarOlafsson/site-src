"""Write panels.json: one factual line per panel, with data source, licence and settings."""
import json
import numpy as np
from common import R, load_field
import build
import volcano

DS = {
    "cross-channel-cell-from-hoechst": "Hoechst image and instance cell masks",
    "cross-channel-nuclei-from-cellmask": "CellMask image and instance nucleus masks",
    "cross-channel-toxoplasma-from-cellmask": "instance parasitophorous-vacuole masks (PV model cpsam_v2_toxo_r5)",
}


def in_window(F, key, win, frac=0.5):
    """Objects of the measured mask with at least frac of their area inside the window."""
    m = F.m[key]
    full = np.bincount(m.ravel())
    sub = m[win[0]:win[1], win[2]:win[3]]
    ids, cnt = np.unique(sub[sub > 0], return_counts=True)
    return [int(i) for i, c in zip(ids, cnt) if c / full[i] >= frac]


def main():
    F = build.Field()
    rec = json.load(open(f"{R}/work/build_record.json"))
    cls = json.load(open(f"{R}/work/classify/classify.json"))
    meas = json.load(open(f"{R}/work/measure/run.json"))
    revs = dict(l.split() for l in open(f"{R}/dl/meta/revisions.txt"))
    vf = volcano.facts()
    pw = build.PIPE_WIN
    cells = [c for c in in_window(F, "cell", pw) if c in F.cell.index]
    nucs = in_window(F, "nuc", pw)
    pvs = in_window(F, "pv", pw)
    mv = build.measure_values(F)
    mvals = np.array([mv[c] for c in cells])
    svals = np.array([F.score[c] for c in cells])
    npv = F.pat.groupby("cell_id").size()
    infected = [c for c in cells if npv.get(c, 0) > 0]
    hi = [c for c in cells if F.score[c] > 0.5]
    hi_inf = [c for c in hi if c in infected]
    stem = build.STEM
    field = {
        "stem": stem, "screen": "Toxoplasma MTOC recruitment screen (MTOC_Screen, mtocScreen_20250531_145355)",
        "plate": "plate2", "well": "P08", "field": 16, "fov_id": "plate2_P08_16_1 (spaCR prcf plate2_r16_c8_f16)",
        "size_px": [2000, 2000], "channels": {"0": "Hoechst (nuclei)", "1": "CellMask (host membranes; parasites take up the dye and are its brightest structures)"},
        "cells": "HeLa-type adherent host cells infected with Toxoplasma gondii (as named in the source datasets' screen)",
        "not_public": "The screen's MTOC marker channel is not in these datasets; only Hoechst and CellMask are shown.",
    }
    files = {"cross-channel-cell-from-hoechst": [f"images/{stem}.tif", f"masks/{stem}.tif"],
             "cross-channel-nuclei-from-cellmask": [f"images/{stem}.tif", f"masks/{stem}.tif"],
             "cross-channel-toxoplasma-from-cellmask": [f"masks_pv/{stem}.tif"]}
    sources = [{"dataset": f"einarolafsson/{k}", "url": f"https://huggingface.co/datasets/einarolafsson/{k}",
                "licence": "CC BY 4.0", "revision": revs.get(k), "used": v, "files": files[k]} for k, v in DS.items()]
    seg = ("Masks are the datasets' published instance masks for this field (not re-segmented here); spaCR Measure's own "
           "reconciliation (spacr.measure.measure_crop: cell >= 8000 px, nucleus >= 2000 px, vacuole >= 150 px, 90% "
           "overlap merge, cells without a nucleus dropped) decides which objects are drawn, so every outline is a measured object.")
    display = ("Per-channel percentile scaling over the whole field: Hoechst 1st-99.7th percentile (gamma 0.9) in blue; "
               "CellMask 1st-99.95th percentile through a cool-to-warm lookup table (slate host cytoplasm, warm peach for "
               "the brightest CellMask structures, which are the parasites). Mask panels show both channels as dimmed grey.")
    outline = "Outlines: sub-pixel contours (skimage.measure.find_contours) drawn with PIL at 4x supersampling and box-downsampled; about 1 CSS px at the page's display width. Cells #00CEC8, nuclei #3B82F6, vacuoles #FF00FF."
    window = {"pipeline_rows_cols": list(pw), "overview_rows_cols": list(build.crop_to(build.OV_WIN, 296, 400)),
              "overview_stack_rows_cols": list(build.crop_to(build.OV_WIN, 394, 525)),
              "recruitment_rows_cols": list(build.crop_to(build.REC_WIN, 232, 241))}
    clf = {k: cls[k] for k in ("n_features_offered", "n_features_used", "train_cells", "test_cells", "fields_total",
                               "auc_heldout_fields", "auc_showcase_field", "showcase_cells", "showcase_infected")}
    hit_settings = ("Gene-level OLS regression of the GFP-TSG101 example screen (four plates), run by spaCR with the "
                    "settings/regression.json shipped in einarolafsson/spacr-example-hit; results file "
                    "/mnt/wd4tb/scratch/n687v3/ols/run/screen4/results/ols/results_gene.csv")
    pipeline = [
        {"file": "01_raw", "step": "Image",
         "line": f"One whole 2000 x 2000 px field (plate 2, well P08, field 16) of the Toxoplasma MTOC screen; the panel shows a 1200 x 900 px window with {len(cells)} measured host cells and {len(pvs)} parasite vacuoles: nuclei (Hoechst) blue, CellMask grey with the dye-loaded parasites warm."},
        {"file": "02_masks", "step": "Masks",
         "line": f"Cell (cyan), nucleus (blue) and vacuole (magenta) outlines of the whole field; {F.ncells} cells, {int(len(F.nuc))} nuclei and {int(len(F.pat))} vacuole objects passed spaCR Measure in the field, {len(cells)} cells, {len(nucs)} nuclei and {len(pvs)} vacuoles in this window."},
        {"file": "03_measurements", "step": "Measure",
         "line": f"Cells coloured by cell_pathogen_overlap_fraction from spaCR Measure (fraction of the cell covered by vacuoles): {mvals.min():.3f} to {mvals.max():.3f} in this window, {len(infected)} of {len(cells)} cells above 0; colour bar 0 to {rec['measure_norm'][1]:g}."},
        {"file": "04_classification", "step": "Classify",
         "line": f"Cells coloured by a spaCR XGBoost score (spacr.ml.ml_analysis) for 'infected', learned from host features only (nucleus, cytoplasm intensity and texture with vacuole pixels excluded, cell shape) on {cls['fields_total'] - 1} other fields of the same plate; this field was never trained on. {len(hi)} of {len(cells)} cells score above 0.5 ({len(hi_inf)} of them infected); ROC AUC {cls['auc_showcase_field']} on this field, {cls['auc_heldout_fields']} on held-out training-plate fields."},
        {"file": "05_screen_hit", "step": "Hit",
         "line": f"Volcano of a different, public screen (GFP-TSG101 recruitment, pooled Toxoplasma CRISPR knockout, 4 plates): {vf['n_genes']} genes, {vf['n_significant_q05']} with q < 0.05 (orange); GRA14, the screen's positive control, is the hit (coefficient {vf['hit']['coefficient']}, reported p = 0, so drawn as a triangle at the top of the axis). The MTOC screen's hits are not public, so this panel is not computed from the field above.",
         "data": {"dataset": "einarolafsson/spacr-example-screen and einarolafsson/spacr-example-hit", "licence": "CC BY 4.0",
                  "revisions": {"spacr-example-screen": revs.get("spacr-example-screen"), "spacr-example-hit": revs.get("spacr-example-hit")},
                  "settings": hit_settings, "facts": vf, "axes": "x: regression coefficient (effect on the classifier score), clipped to +-2 with off-scale genes as edge arrows; y: -log10 p, capped at 7; dashed line p = 0.05"}},
    ]
    out = {
        "item": "N687 v3 whole-field panels", "field": field, "sources": sources,
        "segmentation": seg, "display": display, "outlines": outline, "windows": window,
        "measure": {"function": "spacr.measure.measure_crop", "settings": meas["settings"], "seconds": meas["seconds"],
                    "fields_measured": cls["fields_total"], "note": "53 fields of plate 2 measured on CPU; plate2_J02_5_1 was refused by Measure (a nucleus label spanning two cells) and is not in the database, leaving 52."},
        "classifier": {"function": "spacr.ml.ml_analysis", "settings": cls["settings"], "label": "infected = Measure linked >= 1 vacuole object to the cell", **clf},
        "spacr": {"worktree": "/mnt/wd4tb/spacr-worktrees/claude-n687-v4", "commit": "0e244094c"},
        "theme": {"dark_bg": "#0f1115", "light_bg": "#fafaf9", "dark_text": "#ffffff", "light_text": "#15181e",
                  "note": "Graph and table panels and every gap use the page background; microscopy stays on its dark image background in both themes."},
        "pipeline": pipeline,
        "overview": {"strip": "1600x400: image | masks | measurement table | classifier scores | hit volcano (panel widths 296, 296, 352, 296, 312; 12 px gaps)",
                     "stack": "800 wide: image | masks; table; scores | volcano",
                     "table_objects": rec["table_objects"],
                     "table_line": f"Five spaCR Measure columns (cell_area, cell_eccentricity, nucleus_area, cell_pathogen_overlap_fraction, cell_channel_1_mean_intensity) for cells {', '.join(map(str, rec['table_objects']))} of this field, values as stored in measurements.db (nucleus_area summed over the cell's nuclei)."},
        "recruitment_field": {"line": "One field, five views: Hoechst, CellMask, then the cell, nucleus and vacuole outlines on the same window (a 500 x 480 px window of plate2_P08_16_1).",
                              "note": "The MTOC screen is a recruitment screen, but its recruited-marker channel is not public; the strip shows the two public channels."},
        "files": rec["files"],
        "rejected_candidates": json.load(open(f"{R}/work/rejected.json")),
    }
    json.dump(out, open(f"{R}/out/panels.json", "w"), indent=1, default=str)
    for p in pipeline:
        print(p["file"], p["line"])


if __name__ == "__main__":
    main()
