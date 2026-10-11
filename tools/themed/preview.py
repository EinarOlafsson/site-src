"""Write 600 px wide PNG previews of dark/light pairs side by side for review."""
import sys
from pathlib import Path
from PIL import Image
OUT = Path('/mnt/wd4tb/scratch/n687v3/themed')
for name in sys.argv[1:]:
    ims = [Image.open(OUT / f'{name}.{t}.webp').convert('RGB') for t in ('dark', 'light')]
    ims = [im.resize((600, round(im.height * 600 / im.width)), Image.LANCZOS) for im in ims]
    c = Image.new('RGB', (1210, max(i.height for i in ims)), (128, 128, 128))
    c.paste(ims[0], (0, 0)); c.paste(ims[1], (610, 0))
    c.save(OUT / 'view' / f'{name}.pair.png')
