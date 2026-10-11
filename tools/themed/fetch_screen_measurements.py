"""Download the four plate-measurement tars of einarolafsson/spacr-example-screen (about 2.05 GB)."""
from huggingface_hub import hf_hub_download
DL = '/mnt/wd4tb/scratch/n687v3/themed/dl/screen'
for n in (1, 2, 3, 4):
    print(hf_hub_download('einarolafsson/spacr-example-screen', f'plate{n}-measurements.tar',
                          repo_type='dataset', local_dir=DL), flush=True)
