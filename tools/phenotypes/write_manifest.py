"""figures.json and run_record.json for the Phenotypes-tab figures."""
import hashlib, json, os, pickle, platform, subprocess
from pathlib import Path
import common
from common import WORK, OUT, DL, to_webp
from PIL import Image

SPACR = common.SRC
commit = subprocess.run(['git', '-C', SPACR, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


to_webp(WORK / 'ml_confusion.png', OUT / 'xgb_confusion_matrix.webp', width=900)

ml = json.load(open(WORK / 'ml_numbers.json'))
cnn = json.load(open(WORK / 'cnn_numbers.json'))
cnnm = json.load(open(WORK / 'cnn_metrics.json'))
deep = json.load(open(WORK / 'deep_run.json'))
A = pickle.load(open(WORK / 'ml_artifacts.pkl', 'rb'))
oof = ml['oof']
(tn, fp), (fn, tp) = oof['confusion_counts']
(ctn, cfp), (cfn, ctp) = cnn['confusion_counts']
wf = ml['waterfall_cell']
bg = cnn['attribution']['background_share']
bg_s = [b['gradcam_mass_on_background'] for b in bg[:5]]
bg_g = [b['gradcam_mass_on_background'] for b in bg[5:]]
fi = ml['top_features']

def well(prc):
    r, c = prc.split('_')[1:3]
    return f"{'ABCDEFGHIJKLMNOP'[int(r[1:]) - 1]}{int(c[1:]):02d}"

SCREEN = ("spaCR GFP-TSG101 recruitment screen, plate 1 (HF datasets einarolafsson/spacr-example-screen and "
          "einarolafsson/spacr-example-hit, CC BY 4.0; Olafsson EB et al.)")
LABELS = ("classes are the screen's control wells: column 1 (wells A01-H01, enriched for guides against SAG1, "
          "TGGT1_233460, the negative control) versus column 2 (A02-H02, enriched for guides against GRA14, "
          "TGGT1_239740, the positive control whose loss removes TSG101 recruitment to the vacuole)")
MEAS = ("per-cell measurements from measurements.db of spacr-example-hit (the plate-1 cut of spacr-example-screen, "
        "fields 1-4)")
CROPS = ("224 px single-cell PNG crops of those cells read from plate1-data.tar of spacr-example-screen "
         "(blue nuclei, green GFP-TSG101, red Toxoplasma)")

test_wells_cnn = ', '.join(cnn['test_wells'])
figs = [
    {'file': 'class_example_crops.webp',
     'alt': ("Two three-by-three grids of single-cell fluorescence crops on black. Left grid labelled SAG1, right grid "
             "labelled GRA14. Each crop shows a HeLa cell with a blue nucleus, green GFP-TSG101 cytoplasm and red "
             "Toxoplasma vacuoles; in most SAG1 crops the vacuoles look yellow where green overlaps red, in the "
             "GRA14 crops they stay red."),
     'caption': (f"The 9 held-out cells per class that spaCR's CNN classified correctly with the highest confidence, "
                 f"from {cnn['n_test']} test cells in 4 wells never used for training ({test_wells_cnn}); test "
                 f"accuracy {cnn['accuracy']:.3f}."),
     'provenance': f"{SCREEN}; {CROPS}; {LABELS}. Classifier: MobileNetV3-small trained by spacr.deep_spacr.train_test_model; tiles drawn by spacr.plot.plot_image_grid (1-99.5 percentile stretch per channel)."},
    {'file': 'xgb_confusion_matrix.webp',
     'alt': "Two-by-two confusion matrix heatmap in blues, true class on rows (SAG1 c1, GRA14 c2), predicted class on columns, with row-normalised fractions 0.81, 0.19, 0.12 and 0.88.",
     'caption': (f"XGBoost on {ml['n_features']} GFP-TSG101-channel measurements per cell, 5-fold cross-validation with "
                 f"whole wells held out: {oof['n_cells']:,} control cells from {oof['n_wells']} wells, accuracy "
                 f"{oof['accuracy']:.3f} ({tn} of {tn + fp} SAG1-well and {tp} of {tp + fn} GRA14-well cells correct)."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. Model and features from spacr.ml.generate_ml_scores; folds from spacr.io.make_cv_folds grouped by well; figure by spacr.classifier_evaluation._write_confusion_figure (title removed)."},
    {'file': 'xgb_roc_pr.webp',
     'alt': "Two panels. Left: ROC curve rising steeply toward the top-left corner above a dashed diagonal chance line, legend AUC = 0.922. Right: precision-recall curve mostly between 0.85 and 0.97 precision, falling at the highest recall, above a dashed prevalence line at 0.57, legend AP = 0.913.",
     'caption': (f"ROC (AUC {oof['roc_auc']:.3f}) and precision-recall (average precision {oof['average_precision']:.3f}) "
                 f"of the same well-held-out XGBoost predictions for {oof['n_cells']:,} cells, GRA14 wells as the "
                 f"positive class (prevalence {oof['n_pos'] / oof['n_cells']:.2f})."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. Out-of-fold probabilities of the generate_ml_scores XGBoost settings (sklearn clone per fold); curves by sklearn.metrics in spaCR's figure style, saved with spacr.plot.save_figure."},
    {'file': 'cnn_confusion_matrix.webp',
     'alt': "Two-by-two confusion matrix heatmap in blues for the image classifier, true class on rows, predicted on columns, fractions 0.92, 0.08, 0.12 and 0.88.",
     'caption': (f"spaCR's CNN on single-cell crops of {cnn['n_test']} held-out cells from 4 test wells: accuracy "
                 f"{cnn['accuracy']:.3f} ({ctn} of {ctn + cfp} SAG1-well and {ctp} of {ctp + cfn} GRA14-well cells correct)."),
     'provenance': f"{SCREEN}; {CROPS}; {LABELS}. Dataset by spacr.io.generate_training_dataset (split by well), MobileNetV3-small by spacr.deep_spacr.train_test_model; figure by spacr.classifier_evaluation._write_confusion_figure (title removed)."},
    {'file': 'cnn_roc_pr.webp',
     'alt': "Two panels for the image classifier. Left: ROC curve hugging the top-left corner above a dashed chance line, legend AUC = 0.968. Right: precision-recall curve near 1.0 precision until high recall, above a dashed prevalence line at 0.51, legend AP = 0.970.",
     'caption': (f"ROC (AUC {cnn['roc_auc']:.3f}) and precision-recall (average precision {cnn['average_precision']:.3f}) "
                 f"of the CNN on {cnn['n_test']} cells from 4 held-out wells, GRA14 wells as the positive class."),
     'provenance': f"{SCREEN}; {CROPS}; {LABELS}. Probabilities from the checkpoint written by spacr.deep_spacr.train_test_model; curves by sklearn.metrics in spaCR's figure style."},
    {'file': 'shap_beeswarm.webp',
     'alt': ("SHAP beeswarm: twelve feature names on the left, one row of coloured dots per feature along a horizontal "
             "SHAP value axis from about -1.1 to 1.4. The top rows, cell_channel_1_shannon_entropy and "
             "cell_channel_1_channel_2_M2_correlation_85, spread widest in both directions; lower rows cluster near zero."),
     'caption': (f"SHAP values of the XGBoost model for {ml['n_test_cells']} held-out cells from 3 wells "
                 f"({', '.join(well(w) for w in ml['test_wells'])}), top 12 of {ml['n_features']} features by mean |SHAP|; "
                 f"each dot is a cell coloured by its feature value (dark low, yellow high), and positive values push toward the GRA14 class."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. SHAP values from spacr.ml._shap_values (TreeExplainer, tree_path_dependent) on the generate_ml_scores model; beeswarm drawn by spaCR's pyqtgraph FastPlot.add_beeswarm, as on the app's explanation panel."},
    {'file': 'shap_waterfall_cell.webp',
     'alt': ("SHAP waterfall for one cell: ten horizontal arrows, red pushing right and blue pushing left, from the "
             "expected value 0.178 at the bottom to f(x) = 1.545 at the top; cell_channel_1_shannon_entropy adds +0.92 "
             "and cell_channel_1_channel_2_M2_correlation_85 adds +0.47."),
     'caption': (f"Per-cell SHAP explanation of one held-out GRA14-well cell (plate 1, well {well(wf['prc'])}, field "
                 f"{wf['prcfo'].split('_f')[1].split('_')[0]}, object {wf['prcfo'].split('_o')[-1]}): the model's base value of "
                 f"{wf['base_value']:.3f} log-odds plus the feature contributions gives {wf['f_x']:.3f}, a GRA14 probability of {wf['probability_gra14']:.2f}."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. SHAP values from spacr.ml._shap_values; waterfall drawn by shap.plots.waterfall (spaCR has no per-cell SHAP plot) and saved with spacr.plot.save_figure."},
    {'file': 'xgb_feature_importance.webp',
     'alt': "Horizontal grey bar chart of the 15 most important measurement features, longest bar at the top for cell_channel_1_channel_2_M2_correlation_85 (about 0.20), then cell_channel_1_shannon_entropy (about 0.13), with the remaining bars below 0.06.",
     'caption': (f"Top 15 of {ml['n_features']} features by XGBoost importance for the model trained on {ml['n_train_cells']:,} "
                 f"control cells from 13 wells; {fi[0]['feature']} ranks first ({fi[0]['importance']:.3f}), then "
                 f"{fi[1]['feature']} ({fi[1]['importance']:.3f})."),
     'provenance': f"{SCREEN}; {MEAS}; {LABELS}. Importances are the fitted XGBClassifier's feature_importances_ written by spacr.ml.generate_ml_scores; bars drawn by spacr.plot.plot_feature_importance."},
    {'file': 'saliency_maps.webp',
     'alt': ("Four rows of five single-cell crops: SAG1 crops, their Grad-CAM heatmaps, GRA14 crops, their Grad-CAM "
             "heatmaps. Heatmaps are jet-coloured over a grey version of the crop; on GRA14 cells the hot spot sits on "
             "the red parasite vacuoles, on SAG1 cells heat also falls on the black background corners."),
     'caption': (f"Grad-CAM maps of the CNN for the 5 most confident correct held-out cells per class; on GRA14-well cells "
                 f"{min(bg_g) * 100:.0f}-{max(bg_g) * 100:.0f}% of the map falls on the masked black background, on SAG1-well "
                 f"cells {min(bg_s) * 100:.0f}-{max(bg_s) * 100:.0f}%."),
     'provenance': f"{SCREEN}; {CROPS}; {LABELS}. Maps from spacr.attribution.AttributionMapGenerator(method='gradcam', default last convolution), the generator spacr.deep_spacr.generate_activation_map uses."},
]
for f in figs:
    p = OUT / f['file']
    im = Image.open(p)
    f['width'], f['height'] = im.size
    f['bytes'] = p.stat().st_size
    f['sha256'] = sha(p)
    assert f['width'] <= 1200 and f['bytes'] < 100 * 1024, f
json.dump({'license': 'CC BY 4.0 (data); figures made with spaCR', 'figures': figs}, open(OUT / 'figures.json', 'w'), indent=1, ensure_ascii=False)

crop_files = sorted((DL / 'crops').glob('*/*.png'))
crop_manifest = hashlib.sha256(''.join(f"{p.parent.name}/{p.name} {sha(p)}\n" for p in crop_files).encode()).hexdigest()
try:
    from huggingface_hub import HfApi
    api = HfApi()
    revisions = {r: api.dataset_info(r).sha for r in ('einarolafsson/spacr-example-screen', 'einarolafsson/spacr-example-hit')}
except Exception as e:
    revisions = {'error': repr(e)}
model = A['model']
ENV = "tools/phenotypes/env.sh (CUDA_VISIBLE_DEVICES='', QT_QPA_PLATFORM=offscreen, MPLBACKEND=Agg, isolated HOME/SPACR_HOME/MPLCONFIGDIR/TORCH_HOME/HF_HOME under /mnt/wd4tb/scratch/n687v3/phenotypes/state, OMP_NUM_THREADS=8, tools/run_capped.sh 24G, python -I -u)"
record = {
    'spacr_commit': commit, 'spacr_worktree': SPACR,
    'python': '/home/olafsson/anaconda3/envs/spacr/bin/python ' + platform.python_version(),
    'environment': ENV, 'device': 'CPU only (no GPU used)',
    'hf_dataset_revisions_at_record_time': revisions,
    'inputs': {
        'spacr-example-hit measurements/measurements.db': {'path': str(common.HIT / 'measurements/measurements.db'), 'sha256': sha(common.HIT / 'measurements/measurements.db')},
        'spacr-example-hit spacr-example-hit.tar': {'path': '/mnt/wd4tb/scratch/n687/examples/data/spacr-example-hit/spacr-example-hit.tar', 'sha256': sha('/mnt/wd4tb/scratch/n687/examples/data/spacr-example-hit/spacr-example-hit.tar'), 'hf_revision_of_download': 'f141d22022e41461e170c95ef986b14cc48bb6b6'},
        'spacr-example-screen plate1-data.tar crops (columns c1, c2)': {'n_files': len(crop_files), 'dir': str(DL / 'crops'), 'manifest_sha256': crop_manifest, 'note': 'sha256 of the sorted lines "<columnID>/<file> <sha256>"; fetched by HTTP range reads of the tar (tools/phenotypes/fetch_crops.py), only png_list members of the hit cut'},
        'torchvision mobilenet_v3_small ImageNet weights': {'file': 'mobilenet_v3_small-047dcff4.pth', 'sha256': sha(Path(os.environ['TORCH_HOME']) / 'hub/checkpoints/mobilenet_v3_small-047dcff4.pth')},
    },
    'commands': [
        'cd /mnt/firecuda2/Claude/scratch/site-v3/tools/phenotypes',
        './env.sh fetch_crops.py c1 c2',
        './env.sh make_ml.py',
        './env.sh make_ml_figures.py',
        'OMP_NUM_THREADS=8 ./env.sh make_deep.py 8',
        './env.sh make_deep_figures.py',
        './env.sh make_cnn_metrics.py',
        './env.sh write_manifest.py',
    ],
    'steps': {
        'fetch_crops': {'seconds': 659, 'files': len(crop_files)},
        'xgboost': {'function': 'spacr.ml.generate_ml_scores', 'settings': A['settings'],
                    'seconds': A['seconds'], 'split_report': A['split_report'],
                    'xgb_params': {k: v for k, v in model.get_params().items() if v is not None and k in ('n_estimators', 'learning_rate', 'reg_alpha', 'reg_lambda', 'importance_type', 'eval_metric', 'random_state', 'max_depth', 'tree_method')},
                    'feature_importances_type': model.get_params().get('importance_type') or 'xgboost default (gain for tree boosters)',
                    'features_used': A['features'],
                    'single_split_metrics_on_256_held_out_cells': {k: ml[k] for k in ('accuracy', 'roc_auc', 'average_precision', 'confusion_counts', 'test_wells', 'n_test_neg', 'n_test_pos')},
                    'well_grouped_5fold_oof': oof,
                    'shap': {'note': ml['shap_note'], 'top12': ml['shap_top'], 'waterfall_cell': wf},
                    'figures_seconds': ml['seconds']},
        'cnn': {'dataset_function': 'spacr.io.generate_training_dataset', 'dataset_settings': deep['dataset_settings'],
                'train_function': 'spacr.deep_spacr.train_test_model', 'train_settings': deep['train_settings'],
                'images': {'train': {'c1': 609, 'c2': 604}, 'test': {'c1': 200, 'c2': 205},
                           'note': 'balanced to 809 per class; 4 of 16 wells to test/ (C01, G01, B02, E02); 2 further wells held out of train/ as validation by generate_loaders; augment=True expands train 8x (dihedral)'},
                'checkpoint': deep['result'], 'seconds_dataset': deep['seconds_dataset'],
                'seconds_train_and_test': deep['seconds_train_test'],
                'test_metrics': {k: cnn[k] for k in ('n_test', 'accuracy', 'roc_auc', 'average_precision', 'confusion_counts', 'test_wells')},
                'example_crops': cnn['example_crops'], 'attribution': cnn['attribution'],
                'figures_seconds': cnn['seconds'],
                'note': 'A first attempt with resnet18 (augment 8x, 6 epochs) was stopped after 32 min on the shared, loaded CPU; MobileNetV3-small replaced it. Validation accuracy 0.891 at epoch 7 (best by accuracy); train accuracy 1.000, so spaCR flagged overfitting.'},
    },
}
json.dump(record, open(OUT / 'run_record.json', 'w'), indent=1, default=str)
for f in figs:
    print(f['file'], f['width'], f['height'], f['bytes'])
    print('  ', f['caption'])
