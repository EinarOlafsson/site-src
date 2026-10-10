"""Hit example: re-run spacr.ml.perform_regression on spacr-example-hit with its shipped settings."""
import json, shutil, tarfile
from pathlib import Path
from common import WORK, OUT
SRC_TAR = Path('/mnt/wd4tb/scratch/n687/examples/data/spacr-example-hit/spacr-example-hit.tar')
RUN = WORK / 'hit_run'
if RUN.exists():
    shutil.rmtree(RUN)
RUN.mkdir(parents=True)
with tarfile.open(SRC_TAR) as t:
    for name in ('plate1_dv.csv', 'plate_1_unique_combinations.csv', 'settings/regression.json', 'hit.json'):
        t.extract(name, RUN, filter='data')
settings = json.load(open(RUN / 'settings/regression.json'))
settings = {k: v for k, v in settings.items() if not k.startswith('_')}
text = json.dumps(settings).replace('<dataset>', str(RUN))
settings = json.loads(text)
from spacr.ml import perform_regression
out = perform_regression(settings)
print(sorted(out.keys()) if isinstance(out, dict) else type(out))
