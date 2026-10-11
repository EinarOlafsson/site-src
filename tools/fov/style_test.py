"""Try channel-to-colour mappings on one window."""
import numpy as np
from PIL import Image
from common import R, load_field, pscale, to_img
s = "MTOC_Screen__mtocScreen_20250531_145355__plate2_P08_16_1"
f = load_field(s)
win = (200, 1100, 200, 1400)
sl = (slice(win[0], win[1]), slice(win[2], win[3]))
H = f["hoechst"][sl]; C = f["cellmask"][sl]
hl = np.percentile(f["hoechst"], [1, 99.7]); cl = np.percentile(f["cellmask"], [1, 99.7]); cl2 = np.percentile(f["cellmask"], [1, 99.95])
def screen(*layers):
    out = np.zeros(layers[0].shape, np.float32)
    for l in layers:
        out = 1 - (1 - out) * (1 - np.clip(l, 0, 1))
    return out
h = pscale(H, *hl, 0.9)[..., None]
variants = {}
c = pscale(C, *cl2, 1.0)[..., None]
lut = lambda v, stops: np.stack([np.interp(v[..., 0], [s[0] for s in stops], [s[1][i] for s in stops]) for i in range(3)], -1)
variants["A_grey"] = screen(pscale(C, *cl, 0.75)[..., None] * [0.8, 0.8, 0.76], h * [0.16, 0.42, 1.0])
variants["B_lut_warm"] = screen(lut(c, [(0, (0, 0, 0)), (0.35, (0.30, 0.38, 0.40)), (0.6, (0.62, 0.66, 0.64)), (1, (1.0, 0.72, 0.42))]), h * [0.18, 0.45, 1.0])
variants["C_green"] = screen(pscale(C, *cl2, 0.8)[..., None] * [0.35, 0.95, 0.55], h * [0.25, 0.4, 1.0])
variants["D_lut_mag"] = screen(lut(c, [(0, (0, 0, 0)), (0.4, (0.30, 0.40, 0.38)), (0.65, (0.62, 0.70, 0.66)), (1, (1.0, 0.55, 0.85))]), h * [0.18, 0.45, 1.0])
for k, v in variants.items():
    to_img(v, (800, 600)).save(f"{R}/preview/style_{k}.png")
