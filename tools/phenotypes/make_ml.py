"""XGBoost on the measurements of the SAG1 (c1) vs GRA14 (c2) control wells via spacr.ml.generate_ml_scores.

Writes work/ml_src/results/..., work/ml_artifacts.pkl and work/ml_numbers.json.
"""
import json, pickle, shutil, time
import common
from common import WORK
app = common.qt_app()

t0 = time.time()
src = WORK / 'ml_src'
if src.exists():
    shutil.rmtree(src)
(src / 'measurements').mkdir(parents=True)
shutil.copy2(common.HIT / 'measurements' / 'measurements.db', src / 'measurements' / 'measurements.db')

SETTINGS = {
    'src': str(src),
    'model_type_ml': 'xgboost',
    'channel_of_interest': 1,
    'location_column': 'columnID',
    'positive_control_id': common.POS,
    'negative_control_id': common.NEG,
    'heatmap_feature': 'predictions',
    'cross_validation': False,
    'test_size': 0.2,
    'cv_group_by': 'well',
    'n_estimators': 1000,
    'learning_rate': 0.001,
    'reg_alpha': 0.1,
    'reg_lambda': 1.0,
    'n_repeats': 10,
    'top_features': 30,
    'n_jobs': 8,
    'verbose': True,
}
from spacr.ml import generate_ml_scores
settings_in = dict(SETTINGS)
output, plate_heatmap = generate_ml_scores(dict(SETTINGS))
df, permutation_df, feature_importance_df, model, X_train, X_test, y_train, y_test, metrics_df, features = output
elapsed = time.time() - t0
pickle.dump({'df': df, 'permutation_df': permutation_df, 'feature_importance_df': feature_importance_df,
             'model': model, 'X_train': X_train, 'X_test': X_test, 'y_train': y_train, 'y_test': y_test,
             'metrics_df': metrics_df, 'features': features, 'settings': settings_in,
             'split_report': getattr(model, 'spacr_split_report_', None), 'seconds': elapsed},
            open(WORK / 'ml_artifacts.pkl', 'wb'))
print('split', model.spacr_split_report_)
print(metrics_df)
print('seconds', elapsed)
