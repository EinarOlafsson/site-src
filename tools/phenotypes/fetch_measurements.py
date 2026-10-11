"""Download plate1-measurements.tar of einarolafsson/spacr-example-screen into DL/screen_meas (untrusted data)."""
import json, time
import common
from huggingface_hub import hf_hub_download
t = time.time()
p = hf_hub_download('einarolafsson/spacr-example-screen', 'plate1-measurements.tar', repo_type='dataset',
                    local_dir=str(common.DL / 'screen_meas'))
print(json.dumps({'path': p, 'seconds': time.time() - t}))
