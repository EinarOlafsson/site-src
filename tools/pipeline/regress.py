import sys, os
import pandas as pd
from spacr.settings import get_perform_regression_default_settings
from spacr.ml import perform_regression
D = sys.argv[1]
s = dict(score_data=[os.path.join(D, 'plate1_dv.csv')],
         count_data=[os.path.join(D, 'plate_1_unique_combinations.csv')],
         regression_type='ols', inference='parametric', dependent_variable='pred',
         agg_type='mean', analysis_unit='well', filter_value=[], min_cells_per_well=0,
         fraction_threshold=0.02, regression_qc=False, verbose=False, dst=os.path.join(D, 'results'))
for k, v in [a.split('=', 1) for a in sys.argv[2:]]:
    s[k] = eval(v)
s = get_perform_regression_default_settings(s)
print({k: s[k] for k in ('transform', 'outlier_detection', 'filter_value', 'level', 'intercept', 'inference')})
out = perform_regression(s)
print(list(out.keys()) if isinstance(out, dict) else type(out))
