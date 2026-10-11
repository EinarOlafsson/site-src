"""Build the Kaur et al. 2026 (GRA8) paper card thumbnail.

Source: bioRxiv 10.64898/2026.07.20.739547, Fig. 4C (CC0 1.0 / US Government work).
Rearranges the six Fig. 4C microscopy tiles (merge + ALIX zoom for WT, dgra8,
dgra8::GRA8) into a 3x2 grid on a dark background. No chart or axis content.

Usage: python -I kaur_gra8_thumb.py F4.large.jpg out.webp
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

SRC, OUT = sys.argv[1], sys.argv[2]
W, H = 480, 320
BG = (12, 14, 18)
INSET = 3
COLS = [(19, 189), (192, 363), (366, 537), (539, 709), (713, 885), (887, 1057)]
ROW = (350, 521)
FONT = "/usr/share/fonts/truetype/noto/NotoSans-SemiBold.ttf"
FONT_I = "/usr/share/fonts/truetype/noto/NotoSans-SemiBoldItalic.ttf"

src = Image.open(SRC).convert("RGB")


def tile(i):
    x0, x1 = COLS[i]
    return src.crop((x0 + INSET, ROW[0] + INSET, x1 - INSET + 1, ROW[1] - INSET + 1))


gap, margin = 4, 2
side = (W - 2 * margin - 2 * gap) // 3
side_v = (H - 2 * margin - gap) // 2
side = min(side, side_v)
ox = (W - (3 * side + 2 * gap)) // 2
oy = (H - (2 * side + gap)) // 2

canvas = Image.new("RGB", (W, H), BG)
for c in range(3):
    for r, idx in enumerate((2 * c, 2 * c + 1)):
        t = tile(idx).resize((side, side), Image.LANCZOS)
        canvas.paste(t, (ox + c * (side + gap), oy + r * (side + gap)))

d = ImageDraw.Draw(canvas)
f = ImageFont.truetype(FONT, 15)
fi = ImageFont.truetype(FONT_I, 15)
fs = ImageFont.truetype(FONT, 12)


def label(x, y, parts):
    w = sum(d.textlength(t, font=fo) for t, fo in parts)
    d.rounded_rectangle((x - 4, y - 1, x + w + 4, y + 20), 4, fill=(0, 0, 0))
    for t, fo in parts:
        d.text((x, y), t, font=fo, fill=(255, 255, 255))
        x += d.textlength(t, font=fo)


labels = [[("WT", f)], [("Δgra8", fi)], [("Δgra8", fi), ("::", f), ("GRA8", fi)]]
for c, parts in enumerate(labels):
    label(ox + c * (side + gap) + 8, oy + side - 26, parts)

zx, zy = ox + 8, oy + 2 * side + gap - 22
txt = "ALIX at the PV"
w = d.textlength(txt, font=fs)
d.rounded_rectangle((zx - 4, zy - 1, zx + w + 4, zy + 17), 4, fill=(0, 0, 0))
d.text((zx, zy), txt, font=fs, fill=(255, 255, 255))

for q in (90, 86, 82, 78, 74, 70, 65, 60, 55):
    canvas.save(OUT, "WEBP", quality=q, method=6)
    if os.path.getsize(OUT) < 45000:
        break
print(OUT, q, os.path.getsize(OUT))
