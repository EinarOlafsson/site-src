"""Add the caption strip (input, source, licence, model, count) to out_public/plaque-figure.webp."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
OUT = Path("/mnt/wd4tb/scratch/n687/models/out_public")
r = json.load(open(OUT / "plaque_public.json"))
base = Image.open(OUT / "plaque-raw.webp").convert("RGBA")
base.alpha_composite(Image.open(OUT / "plaque-plaque.webp").convert("RGBA"))
W, H = base.size
f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
lines = [
    "Input: crystal-violet plaque well, greyscale | toxoplasma-plaque-dataset, held out from v3 training",
    "Source: Cabral G et al. 2024, Microbiol Spectrum, doi:10.1128/spectrum.01229-24, Fig. 2 | licence: CC BY 4.0",
    f"plaque: n={r['count']}  Toxoplasma Plaque v3 [toxoplasma_plaque_v3], candidate  sha256 {r['sha256'][:12]}",
]
pad, lh = 8, 21
meas = ImageDraw.Draw(Image.new("RGB", (1, 1)))
rows = []
for t in lines:
    cur = ""
    for w in t.split(" "):
        trial = (cur + " " + w).strip()
        if meas.textlength(trial, font=f) > W - 2 * pad - 20 and cur:
            rows.append(cur); cur = w
        else:
            cur = trial
    rows.append(cur)
canvas = Image.new("RGB", (W, H + 2 * pad + lh * len(rows)), (18, 18, 18))
canvas.paste(base.convert("RGB"), (0, 0))
d = ImageDraw.Draw(canvas)
y = H + pad
for t in rows:
    if t.startswith("plaque:"):
        d.rectangle([pad, y + 4, pad + 12, y + 16], fill="#FF00FF")
        d.text((pad + 20, y), t, fill=(235, 235, 235), font=f)
    else:
        d.text((pad, y), t, fill=(235, 235, 235), font=f)
    y += lh
canvas.save(OUT / "plaque-figure.webp", "WEBP", quality=82, method=6)
print(canvas.size, (OUT / "plaque-figure.webp").stat().st_size)
