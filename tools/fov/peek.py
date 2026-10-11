"""Render a whole field (or a window) at a given size for inspection."""
import sys
from common import R, load_field, field_limits, composite, to_img
s = sys.argv[1]
size = int(sys.argv[2])
win = tuple(int(x) for x in sys.argv[3].split(",")) if len(sys.argv) > 3 else None
f = load_field(s)
lim = field_limits(f)
rgb = composite(f, lim, win)
h, w = rgb.shape[:2]
to_img(rgb, (size, int(size * h / w))).save(f"{R}/preview/peek_{s.split('__')[-1]}.png")
