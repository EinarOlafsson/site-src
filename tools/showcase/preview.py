import sys, glob, numpy as np, tifffile
from PIL import Image
H = "/home/olafsson/.cache/huggingface/hub"
def find(repo, sub, n):
    return glob.glob(f"{H}/datasets--einarolafsson--{repo}/snapshots/*/{sub}/{n}.tif")[0]
def st(a):
    lo, hi = np.percentile(a, [1, 99.8]); return (np.clip((a - lo) / (hi - lo + 1e-9), 0, 1) * 255).astype(np.uint8)
from skimage.segmentation import find_boundaries
for n in sys.argv[2:]:
    h = tifffile.imread(find("cross-channel-cell-from-hoechst", "images", n))
    c = tifffile.imread(find("cross-channel-toxoplasma-from-cellmask", "images", n))
    c2 = tifffile.imread(find("cross-channel-nuclei-from-cellmask", "images", n))
    pv = tifffile.imread(find("cross-channel-toxoplasma-from-cellmask", "masks_pv", n))
    print(n, h.shape, h.dtype, h.min(), h.max(), c.shape, c.dtype, c.min(), c.max(), "same cellmask:", np.array_equal(c, c2), "pv", len(np.unique(pv)) - 1)
    a, b = st(h), st(c)
    rgb = np.stack([b, b, b], -1).copy(); bd = find_boundaries(pv); rgb[bd] = [255, 0, 255]
    row = np.concatenate([np.stack([a]*3, -1), rgb], 1)
    Image.fromarray(row).resize((row.shape[1] // 2, row.shape[0] // 2)).save(f"{sys.argv[1]}/{n.split('__')[-1]}.png")
