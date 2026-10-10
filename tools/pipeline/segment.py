import sys, os, json
import numpy as np
import torch
assert not torch.cuda.is_available()
from spacr.deep_spacr import _vs_default_segment

RECON = sys.argv[1]
R0, R1, C0, C1 = map(int, sys.argv[2:6])
WANT = sys.argv[6].split(',') if len(sys.argv) > 6 else ['nucleus', 'pathogen']
rgb = np.load(os.path.join(RECON, 'field_rgb.npy'))[R0:R1, C0:C1]
cells = np.load(os.path.join(RECON, 'cell_labels.npy'))[R0:R1, C0:C1]
seg = _vs_default_segment('cpu')
print('segmenter', seg.name, flush=True)
out = {}
for name, ch in (('nucleus', 2), ('pathogen', 0)):
    if name not in WANT:
        continue
    plane = rgb[..., ch].astype(np.float32) / 255.0
    m = seg(plane)
    m[cells == 0] = 0
    np.save(os.path.join(RECON, f'{name}_labels_crop.npy'), m)
    out[name] = int(len(np.unique(m)) - 1)
    print(name, out[name], flush=True)
prev = json.load(open(os.path.join(RECON, 'segment.json')))['counts'] if os.path.exists(os.path.join(RECON, 'segment.json')) else {}
prev.update(out); out = prev
json.dump(dict(window=[R0, R1, C0, C1], segmenter=seg.name, counts=out), open(os.path.join(RECON, 'segment.json'), 'w'))
