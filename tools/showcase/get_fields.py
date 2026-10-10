import sys
from huggingface_hub import hf_hub_download
names = sys.argv[1:]
for n in names:
    for repo, sub in [("cross-channel-cell-from-hoechst", "images"), ("cross-channel-cell-from-hoechst", "masks"),
                      ("cross-channel-toxoplasma-from-cellmask", "images"), ("cross-channel-toxoplasma-from-cellmask", "masks_pv"),
                      ("cross-channel-nuclei-from-cellmask", "images"), ("cross-channel-nuclei-from-cellmask", "masks")]:
        p = hf_hub_download("einarolafsson/" + repo, f"{sub}/{n}.tif", repo_type="dataset")
        print(repo, sub, p)
