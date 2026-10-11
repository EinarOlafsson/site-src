import os, sys, json

WORK, OUT, CMDS = sys.argv[1:4]
b = json.load(open(os.path.join(WORK, 'build_info.json')))
seg = json.load(open(os.path.join(WORK, 'recon/segment.json')))
v = b['volcano']
hit = v['hit']
sag = [s for s in v['significant'] if s['gene'] == '233460']
pred = {int(k): x for k, x in b['pred_strip'].items()}
low = [k for k, x in pred.items() if x < 0.5]
high = [k for k, x in pred.items() if x >= 0.5]

source = dict(
    datasets=[
        dict(name='einarolafsson/spacr-example-screen', kind='Hugging Face dataset',
             url='https://huggingface.co/datasets/einarolafsson/spacr-example-screen',
             used='plate1-data.tar: spaCR Measure cell_png crops (224 px) of plate1 H02 field 4'),
        dict(name='einarolafsson/spacr-example-hit', kind='Hugging Face dataset',
             url='https://huggingface.co/datasets/einarolafsson/spacr-example-hit',
             used='measurements/measurements.db (spaCR Measure database, plate 1 cut), plate1_dv.csv (classifier predictions), plate_1_unique_combinations.csv (guide reads)')],
    licence='CC BY 4.0',
    screen='HeLa GFP-TSG101 cells infected with a pooled Toxoplasma gondii CRISPR-Cas9 library (spaCR TSG101 recruitment screen), plate 1',
    plate='plate1', well='H02 (rowID r8, columnID c2)', field='f4',
    well_guide='239740_1 (TGGT1_239740, GRA14; 92% of the well\'s guide reads)',
    crop_in_field_window_rows_cols=dict(strip=b['strip_box_in_window'], stack=b['stack_box_in_window'], window_in_reassembled_canvas=b['window_in_canvas']))

panels = [
    dict(n=1, key='image', label='Image',
         description=f"Raw image of plate 1, well H02, field 4 (GRA14 guide well): nuclei blue, channel 1 green, parasites magenta; {b['cells_strip']} infected cells in the strip crop.",
         detail='Field reassembled from spaCR Measure cell crops placed at their measured centroids (cell-masked crops, so uninfected cells and background are dark and some cells are clipped square); 0.5-99.7 percentile stretch per channel.',
         spacr='spacr.measure (crop export); positions from measurements.db cell table'),
    dict(n=2, key='masks', label='Masks',
         description=f"Cell (cyan), nucleus (blue) and parasite (magenta) masks of the same cells: {b['cells_strip']} cells, {b['nucleus_objects_strip']} nuclei and {b['pathogen_objects_strip']} parasite objects in the strip crop.",
         detail=f"Cell outlines are the spaCR cell masks carried by the crops. Nucleus and parasite masks were recomputed on CPU with {seg['segmenter']} on the reassembled planes and filtered at spaCR Measure minimum sizes (nucleus 2000 px, parasite 500 px), because the dataset ships no mask images.",
         spacr='spacr.deep_spacr._vs_default_segment(device="cpu")'),
    dict(n=3, key='measurements', label='Measurements',
         description=f"Real rows from the spaCR measurement database (measurements.db, table cell) for cells {', '.join(map(str, b['table_objects_strip']))} of this field; 166 columns per cell, a few shown.",
         columns=dict(strip=b['table_cols_strip'], stack=b['table_cols_stack']),
         objects=dict(strip=b['table_objects_strip'], stack=b['table_objects_stack']),
         values=b['table_rows'],
         spacr='spacr.measure (Measure; measurements.db table cell)'),
    dict(n=4, key='classifier_scores', label='Classifier scores',
         description=f"Each cell coloured by its spaCR classifier score (probability of the GRA14-knockout-like phenotype, 0 blue to 1 orange): {len(high)} of {len(pred)} cells in the crop score above 0.5" + (f"; cell {', '.join(map(str, low))} scores {min(pred[k] for k in low):.3f}." if low else '.'),
         scores=pred,
         spacr="spaCR classifier per-cell cross-validated predictions (plate1_dv.csv column 'pred')"),
    dict(n=5, key='hits', label='Hits',
         description=f"Volcano plot of {v['n_genes']} genes: OLS regression of well-mean classifier score on guide fraction calls GRA14 (TGGT1_239740, ringed) a hit, effect +{hit['coefficient']:.2f}, p {hit['p_value']:.4f}, q {hit['q_value']:.3f}" + (f"; the other orange point is the negative control SAG1 (effect {sag[0]['coefficient']:.2f}, q {sag[0]['q_value']:.4f})." if sag else '.'),
         detail='Orange = q < 0.05 (Benjamini-Hochberg); dashed line p = 0.05; x = regression coefficient, y = -log10 p. Re-run here on CPU; matches the shipped results/ols.',
         spacr="spacr.ml.perform_regression(regression_type='ols', inference='parametric'); drawn with spacr.volcano_style.render_volcano"),
]
files = {k: dict(webp=os.path.basename(b[k]['file']), bytes=b[k]['bytes'], size=b[k]['size'],
                 avif=(os.path.basename(b[k]['avif']['file']) if isinstance(b[k]['avif'], dict) else None),
                 avif_bytes=(b[k]['avif']['bytes'] if isinstance(b[k]['avif'], dict) else None))
         for k in ('strip', 'stack')}
files['strip']['layout'] = '5 panels in one row (300, 300, 320, 300, 340 px wide, 400 px tall), 10 px transparent gaps, 14 px corner radius'
files['stack']['layout'] = 'row 1: image | masks (395 px squares); row 2: measurements table (800 x 330); row 3: classifier scores | hits; 10 px transparent gaps'
doc = dict(item='N687 overview composite', alt_hint='From one microscope field to a screen hit with spaCR: image, masks, measurements, classifier scores and hits.',
           text_policy='No burned-in captions or panel labels; only data text (table column names and values, colour-bar and axis tick values, the gene name GRA14). Captions go in HTML.',
           palette=dict(nuclei='#3B82F6', cells='#00CEC8', parasites='#FF00FF', panel_background='#10131A', panel_border='#2B313D', score_low='#4F7CFF', score_high_and_significant='#FF8A3D'),
           files=files, data_source=source, panels=panels, commands=open(CMDS).read().strip().splitlines())
json.dump(doc, open(os.path.join(OUT, 'panels.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps(doc, indent=1, ensure_ascii=False)[:4000])
