import json, os, sys
BASE = sys.argv[1]
D = os.path.join(BASE, 'data'); OUT = os.path.join(BASE, 'out')
st = json.load(open(os.path.join(D, 'panel_stats.json')))['stats']
src_screen = 'HF dataset einarolafsson/spacr-example-screen, plate1-data.tar (224 px cell_png crops)'
src_hit = 'HF dataset einarolafsson/spacr-example-hit (plate 1 cut of spacr-example-screen)'
loc = dict(plate='plate1', well='H02 (r8c2)', field='f4', gene='TGGT1_239740 (GRA14)', guide='239740_1',
           guide_fraction_in_well=0.9221)
field_id = 'plate1_r8_c2_f4 (plate1_H02 field 4)'
n = st['cells_in_window']
steps = [
 dict(step='raw', file='01_raw.webp',
      caption=f'Raw: {n} infected cells of plate 1, well H02, field 4 (GRA14 guide well), nuclei blue, channel 1 green, parasites red.',
      data_source=dict(dataset=src_screen, **loc, detail='spaCR Measure cell crops (cell-masked, per-crop 0-100 percentile normalised) placed back at their measured positions; display stretch 0.5-99.7 percentile per channel. Uninfected cells and background were not cropped (include_uninfected False), so they are black; cells larger than 224 px are clipped square.'),
      spacr_function='spacr.measure (Measure crop export: spacr.utils._crop_center); field reassembled from cell_channel_*_centroid_weighted(_local) in measurements.db'),
 dict(step='masks', file='02_masks.webp',
      caption='Masks: cell (yellow), nucleus (cyan) and parasite (magenta) outlines on the same field.',
      data_source=dict(dataset=src_screen + '; ' + src_hit + ' measurements/measurements.db', **loc,
                       detail=f"Cell outlines are the exact spaCR cell masks carried by the crops. Nucleus ({st['nucleus_objects_in_window']}) and parasite ({st['pathogen_objects_in_window']}) objects were recomputed on CPU with Cellpose-SAM (cpsam) on the reassembled planes, keeping objects at or above spaCR's Measure min sizes (nucleus 2000 px, pathogen 500 px), because the dataset ships no mask images; they are not the screen's original masks, and the magenta objects are parasite clusters/vacuoles."),
      spacr_function='spacr.deep_spacr._vs_default_segment(device="cpu") (Cellpose cpsam) for nucleus/parasite; cell masks from spacr.measure crops'),
 dict(step='measurements', file='03_measurements.webp',
      caption='Measurements: each cell coloured by the mean channel-1 intensity of its parasite objects from the spaCR measurement database.',
      data_source=dict(dataset=src_hit + ', measurements/measurements.db table pathogen', **loc,
                       detail=f"pathogen_channel_1_mean_intensity averaged over the parasite objects of each cell (joined on pathogen_cell_id); range in field {st['feature_range'][0]:.0f}-{st['feature_range'][1]:.0f}."),
      spacr_function='spacr.measure.measure_crop (Measure; table pathogen)'),
 dict(step='classification', file='04_classification.webp',
      caption=f"Classification: cells coloured by spaCR classifier score (probability of the GRA14-knockout-like phenotype); {n - 1} of {n} score above 0.5.",
      data_source=dict(dataset=src_hit + ', plate1_dv.csv column pred', **loc,
                       detail=f"Cross-validated per-cell predictions; window min {st['pred_in_window']['min']}, median {st['pred_in_window']['50%']}; whole field n={int(st['pred_field']['count'])}, mean {st['pred_field']['mean']}."),
      spacr_function="spaCR classifier per-cell cross-validated predictions (plate1_dv.csv 'pred')"),
 dict(step='screen_hit', file='05_screen_hit.webp',
      caption='Screen hit: GRA14 (ringed) is called by spaCR OLS regression of well-mean classifier score on guide fraction (effect +0.48, p 0.0062, q 0.040); SAG1 is the negative control.',
      data_source=dict(dataset=src_hit + ' (plate1_dv.csv, plate_1_unique_combinations.csv); 30 wells, fields f1-f4, 13 genes', **loc,
                       detail='Re-run on CPU here; reproduces the shipped results/ols model_summary exactly. Orange = q < 0.05 (fdr_bh); dashed line p = 0.05.'),
      spacr_function="spacr.ml.perform_regression (regression_type='ols', inference='parametric', transform=None, fraction_threshold=0.02, min_cells_per_well=10, control columns kept); drawn with spacr.volcano_style.render_volcano"),
]
for s in steps:
    s['bytes'] = os.path.getsize(os.path.join(OUT, s['file']))
doc = dict(item='N687', field_id=field_id, plate='plate1', well='H02', row='r8', column='c2', field='f4',
           crop_window_px=dict(rows=[40, 940], cols=[780, 1980], note='reassembled-canvas coordinates; field origin at canvas offset [65, 49]; panels 800x600 (1.5x downsampled)'),
           why_this_field='Well H02 is a GRA14 control-column well: 92% of its guide reads are 239740_1 (GRA14, the screen positive control and its called hit); field 4 has 45 imaged infected cells including one low-score cell.',
           steps=steps)
json.dump(doc, open(os.path.join(OUT, 'pipeline.json'), 'w'), indent=1)
print(json.dumps(doc, indent=1)[:600])
