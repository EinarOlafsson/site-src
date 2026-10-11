"""Round 4: r4/figures.json (dark/light pairs) and r4/run_record.json."""
import hashlib, json, os, pickle, subprocess
from pathlib import Path
import common
from common import WORK, R4, DL
from PIL import Image

commit = subprocess.run(['git', '-C', common.SRC, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


ml = json.load(open(WORK / 'ml_numbers.json'))
cnn = json.load(open(WORK / 'cnn_numbers.json'))
deep = json.load(open(WORK / 'deep_run.json'))
r4 = json.load(open(R4 / 'r4_numbers.json'))
um = json.load(open(R4 / 'umap' / 'umap_record.json'))
A = pickle.load(open(WORK / 'ml_artifacts.pkl', 'rb'))
oof = ml['oof']; wf = ml['waterfall_cell']; fi = ml['top_features']
sal = r4['saliency']['per_cell']
ins = [s['smoothgrad_share_inside_cell'] for s in sal]; cov = [s['cell_pixel_fraction'] for s in sal]
below = sum(i < c for i, c in zip(ins, cov))


def well(prc):
    r, c = prc.split('_')[1:3]
    return f"{'ABCDEFGHIJKLMNOP'[int(r[1:]) - 1]}{int(c[1:]):02d}"


SCREEN = ("spaCR GFP-TSG101 recruitment screen, plate 1 (HF datasets einarolafsson/spacr-example-screen and "
          "einarolafsson/spacr-example-hit, CC BY 4.0; Olafsson EB et al.)")
LABELS = ("classes are the screen's control wells: column 1 (A01-H01, enriched for guides against SAG1, TGGT1_233460, "
          "the negative control) versus column 2 (A02-H02, enriched for guides against GRA14, TGGT1_239740, the "
          "positive control whose loss removes TSG101 recruitment to the vacuole)")
MEAS = "per-cell measurements from measurements.db of spacr-example-hit (the plate-1 cut of spacr-example-screen, fields 1-4)"
CROPS = ("224 px single-cell PNG crops read from plate1-data.tar of spacr-example-screen "
         "(blue nuclei, green GFP-TSG101, red Toxoplasma)")
tw = ', '.join(cnn['test_wells'])
comp = um['composition']
desc = []
for c, v in comp.items():
    nn, pp = int(v['median_nuclei']), int(v['median_pathogen_objects'])
    desc.append(f"{c}: {v['n']:,} cells, median {nn} {'nucleus' if nn == 1 else 'nuclei'} and {pp} parasite object{'' if pp == 1 else 's'}")
figs = [
    {'name': 'class_example_crops',
     'alt': ("Two three-by-three grids of single-cell fluorescence crops on black, labelled SAG1 (left) and GRA14 "
             "(right). Each crop shows a HeLa cell with a blue nucleus, green GFP-TSG101 and red Toxoplasma vacuoles; "
             "in most SAG1 crops the vacuoles look yellow where green overlaps red, in the GRA14 crops they stay red."),
     'caption': (f"The 9 held-out cells per class that spaCR's CNN classified correctly with the highest confidence, from "
                 f"{cnn['n_test']} test cells ({cnn['n_test_neg']} SAG1-well, {cnn['n_test_pos']} GRA14-well) in 4 wells "
                 f"never used for training ({tw}); test accuracy {cnn['accuracy']:.3f}, ROC AUC {cnn['roc_auc']:.3f}."),
     'provenance': f"{SCREEN}; {CROPS}; {LABELS}. Dataset by spacr.io.generate_training_dataset (split by well), MobileNetV3-small by spacr.deep_spacr.train_test_model; tiles by spacr.plot.plot_image_grid (1-99.5 percentile stretch per channel)."},
    {'name': 'saliency_maps',
     'alt': ("Four rows of five single-cell crops: SAG1 crops, the same cells as dim grey images with a magma heat "
             "overlay of input-gradient saliency drawn only inside the cell, then GRA14 crops and their saliency "
             "overlays. The heat is brightest along the cell outline, with smaller hot spots inside the cells."),
     'caption': (f"Input-gradient saliency (SmoothGrad, 32 samples) of the CNN for the 5 most confident correct held-out "
                 f"cells per class, shown inside the cell only; in {below} of 10 cells the share of saliency inside the "
                 f"cell ({min(ins) * 100:.0f}-{max(ins) * 100:.0f}%) is below the share of the crop the cell covers "
                 f"({min(cov) * 100:.0f}-{max(cov) * 100:.0f}%), and inside the cell it peaks at the cell outline."),
     'provenance': f"{SCREEN}; {CROPS}; {LABELS}. Saliency by spacr.attribution.AttributionMapGenerator(method='saliency', smoothgrad_samples=32, smoothgrad_sigma=0.15) (captum Saliency: absolute gradient of the predicted-class logit with respect to the input), on the MobileNetV3-small checkpoint of spacr.deep_spacr.train_test_model. Display: Gaussian blur sigma 2 px, scaled to the 40th-99.5th percentile of interior pixels."},
    {'name': 'shap_beeswarm',
     'alt': ("SHAP beeswarm: twelve feature names on the left, one row of coloured dots per feature along a horizontal "
             "SHAP value axis from about -1.1 to 1.4. The top rows, cell_channel_1_shannon_entropy and "
             "cell_channel_1_channel_2_M2_correlation_85, spread widest in both directions; lower rows cluster near zero."),
     'caption': (f"SHAP values of spaCR's XGBoost model for {ml['n_test_cells']} held-out cells from 3 wells "
                 f"({', '.join(well(w) for w in ml['test_wells'])}), top 12 of {ml['n_features']} features by mean |SHAP|; "
                 f"each dot is a cell coloured by its feature value (dark low, yellow high), and positive values push "
                 f"toward the GRA14 class (well-grouped 5-fold accuracy {oof['accuracy']:.3f}, ROC AUC {oof['roc_auc']:.3f} on {oof['n_cells']:,} cells)."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. Model from spacr.ml.generate_ml_scores (xgboost, channel_of_interest 1); SHAP values from spacr.ml._shap_values; beeswarm drawn by spaCR's pyqtgraph FastPlot.add_beeswarm and FastPlot.export_styled."},
    {'name': 'shap_waterfall_cell',
     'alt': ("SHAP waterfall for one cell: ten horizontal arrows, red pushing right and blue pushing left, from the "
             f"expected value {wf['base_value']:.3f} at the bottom to f(x) = {wf['f_x']:.3f} at the top; "
             "cell_channel_1_shannon_entropy adds the largest positive contribution."),
     'caption': (f"Per-cell SHAP explanation of one held-out GRA14-well cell (plate 1, well {well(wf['prc'])}, field "
                 f"{wf['prcfo'].split('_f')[1].split('_')[0]}, object {wf['prcfo'].split('_o')[-1]}): the model's base value of "
                 f"{wf['base_value']:.3f} log-odds plus the feature contributions gives {wf['f_x']:.3f}, a GRA14 probability of {wf['probability_gra14']:.2f}."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. SHAP values from spacr.ml._shap_values; drawn by shap.plots.waterfall (spaCR has no per-cell SHAP plot), recoloured for the page and saved with spacr.plot.save_figure."},
    {'name': 'xgb_feature_importance',
     'alt': ("Horizontal grey bar chart of the 15 most important measurement features, longest bar at the top for "
             f"{fi[0]['feature']} (about {fi[0]['importance']:.2f}), then {fi[1]['feature']} (about {fi[1]['importance']:.2f})."),
     'caption': (f"Top 15 of {ml['n_features']} features by XGBoost importance for the model trained on {ml['n_train_cells']:,} "
                 f"control cells from 13 wells; {fi[0]['feature']} ranks first ({fi[0]['importance']:.3f}), then "
                 f"{fi[1]['feature']} ({fi[1]['importance']:.3f})."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. Importances are the fitted XGBClassifier's feature_importances_ (gain) written by spacr.ml.generate_ml_scores; bars by spacr.plot.plot_feature_importance."},
    {'name': 'umap',
     'alt': (f"UMAP scatter of 5,000 cells forming {um['clusters']} outlined, numbered clusters on the left; on the right "
             "one row per cluster with its number, its cell count and four example single-cell crops framed in the cluster colour."),
     'caption': (f"UMAP of 6 measurements of 5,000 randomly sampled cells from screen plate 1 ({um['cells_in_merged_table']:,} cells), "
                 f"{um['clusters']} DBSCAN clusters that differ mainly in nuclei and parasite objects per cell "
                 f"({'; '.join(desc)}); crops are cells near each cluster centre."),
     'provenance': (f"{SCREEN}: plate1-measurements.tar (measurements.db) and plate1-data.tar crops. Measurements by "
                    "spacr.io._read_and_merge_data (no nucleus/pathogen limits); features nucleus_prcfo_count, "
                    "pathogen_prcfo_count, cell_area, pathogen_area (mean per cell), pathogen_channel_2_mean_intensity, "
                    "cell_channel_2_mean_intensity, log1p then z-scored; embedding and clusters by "
                    f"spacr.utils.reduction_and_clustering (UMAP n_neighbors 30, min_dist 0.1, seed 0; DBSCAN eps {um['dbscan']['eps']}, "
                    f"min_samples 50, chosen from a sweep as closest to 5 clusters; {um['noise_fraction'] * 100:.2f}% unassigned; silhouette {um['silhouette_assigned']:.2f}). "
                    "Gallery: of the 60 cells nearest each cluster's median position, the 30 with the brightest parasite channel, "
                    "shuffled (seed 0), one per field, 8 fetched, the 4 with the fewest near-black central pixels shown.")},
]
out = []
for f in figs:
    pair = {}
    for theme in ('dark', 'light'):
        p = R4 / f"{f['name']}.{theme}.webp"
        im = Image.open(p)
        pair[theme] = {'file': p.name, 'width': im.width, 'height': im.height, 'bytes': p.stat().st_size,
                       'mode': im.mode, 'sha256': sha(p)}
        assert im.width <= 1200 and p.stat().st_size < 100 * 1024, p
    assert (pair['dark']['width'], pair['dark']['height']) == (pair['light']['width'], pair['light']['height'])
    out.append({'name': f['name'], 'files': pair, 'width': pair['dark']['width'], 'height': pair['dark']['height'],
                'alt': f['alt'], 'caption': f['caption'], 'provenance': f['provenance']})
json.dump({'themes': common.THEMES, 'background_note': (
    "Opaque files are lossless with the exact page colour. Files with mode RGBA are lossy colour with a lossless alpha "
    "plane in which every pixel equal to the page colour is transparent, so the page colour shows through exactly."),
    'dropped': ['xgb_confusion_matrix', 'xgb_roc_pr', 'cnn_confusion_matrix', 'cnn_roc_pr'],
    'figures': out}, open(R4 / 'figures.json', 'w'), indent=1, ensure_ascii=False)

model = A['model']
record = {
    'spacr_commit': commit, 'spacr_worktree': common.SRC,
    'note': 'Round 4: every step re-run on this commit (classification, ML/CV, SHAP, importance, saliency, UMAP).',
    'environment': "tools/phenotypes/env.sh: CUDA_VISIBLE_DEVICES='', QT_QPA_PLATFORM=offscreen, MPLBACKEND=Agg, isolated HOME/SPACR_HOME/MPLCONFIGDIR/TORCH_HOME/HF_HOME, OMP_NUM_THREADS=8, tools/run_capped.sh 24G, python -I -u",
    'inputs': {
        'spacr-example-hit measurements.db': {'path': str(common.HIT / 'measurements/measurements.db'), 'sha256': sha(common.HIT / 'measurements/measurements.db'), 'hf_revision': 'f141d22022e41461e170c95ef986b14cc48bb6b6'},
        'spacr-example-screen plate1-measurements.tar': {'path': str(DL / 'screen_meas/plate1-measurements.tar'), 'sha256': sha(DL / 'screen_meas/plate1-measurements.tar'), 'hf_revision': 'ec328b0f411c0ea46ceccb51aa867028b59af202'},
        'spacr-example-screen plate1-data.tar crops, control columns': {'n': len(list((DL / 'crops').glob('*/*.png'))), 'manifest_sha256': hashlib.sha256(''.join(f"{p.parent.name}/{p.name} {sha(p)}\n" for p in sorted((DL / 'crops').glob('*/*.png'))).encode()).hexdigest()},
        'spacr-example-screen plate1-data.tar crops, UMAP gallery candidates': {'n': len(list((DL / 'umap_crops').glob('*.png'))), 'manifest_sha256': hashlib.sha256(''.join(f"{p.name} {sha(p)}\n" for p in sorted((DL / 'umap_crops').glob('*.png'))).encode()).hexdigest()},
        'torchvision mobilenet_v3_small weights': {'sha256': sha(Path(os.environ['TORCH_HOME']) / 'hub/checkpoints/mobilenet_v3_small-047dcff4.pth')},
    },
    'commands': ['cd /mnt/firecuda2/Claude/scratch/site-v3/tools/phenotypes',
                 './env.sh fetch_crops.py c1 c2', './env.sh fetch_measurements.py',
                 './env.sh make_ml.py', './env.sh make_ml_figures.py',
                 'OMP_NUM_THREADS=8 ./env.sh make_deep.py 8', './env.sh make_deep_figures.py',
                 './env.sh make_r4.py', './env.sh make_umap.py embed',
                 './env.sh fetch_crops.py --paths /mnt/wd4tb/scratch/n687v3/phenotypes/r4/umap/umap_record.json /mnt/wd4tb/scratch/n687v3/phenotypes/dl/umap_crops',
                 './env.sh make_umap.py draw', './env.sh write_manifest_r4.py'],
    'xgboost': {'function': 'spacr.ml.generate_ml_scores', 'settings': A['settings'], 'seconds': A['seconds'],
                'split_report': A['split_report'], 'n_features': ml['n_features'],
                'single_split_held_out': {k: ml[k] for k in ('accuracy', 'roc_auc', 'average_precision', 'confusion_counts', 'test_wells')},
                'well_grouped_5fold_oof': oof, 'shap_note': ml['shap_note'], 'shap_top12': ml['shap_top'],
                'waterfall_cell': wf, 'top_features': fi, 'figures_seconds': ml['seconds']},
    'cnn': {'dataset_settings': deep['dataset_settings'], 'train_settings': deep['train_settings'],
            'png_counts': {sp: {c: len([f for f in os.listdir(os.path.join(deep['root'], sp, c)) if f.endswith('.png')]) for c in ('c1', 'c2')} for sp in ('train', 'test')},
            'note': 'train/ is further split by generate_loaders into train and validation by well (2 of 12 wells to validation)', 'checkpoint': deep['result'],
            'seconds_dataset': deep['seconds_dataset'], 'seconds_train_and_test': deep['seconds_train_test'],
            'test': {k: cnn[k] for k in ('n_test', 'n_test_neg', 'n_test_pos', 'test_wells', 'accuracy', 'roc_auc', 'average_precision', 'confusion_counts')},
            'example_crops': cnn['example_crops']},
    'saliency': r4['saliency'],
    'umap': {k: v for k, v in um.items() if k != 'images'},
    'images': {f['name']: f['files'] for f in out},
}
json.dump(record, open(R4 / 'run_record.json', 'w'), indent=1, default=str)
for f in out:
    print(f['name'], f['width'], f['height'], f['files']['dark']['bytes'], f['files']['light']['bytes'])
    print('  ', f['caption'])
