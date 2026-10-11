"""Shared paths and setup for the Phenotypes-tab figures (CPU only, isolated HOME)."""
import os
import sys
from pathlib import Path

SRC = os.environ.get('SPACR_SRC', '/mnt/wd4tb/spacr-worktrees/claude-n687-v3')
if SRC not in sys.path:
    sys.path.insert(0, SRC)

ROOT = Path(os.environ.get('SPACR_PHENO_ROOT', '/mnt/wd4tb/scratch/n687v3/phenotypes'))
OUT = ROOT
WORK = ROOT / 'work'
DL = ROOT / 'dl'
HIT = Path('/mnt/wd4tb/scratch/n687/pipeline/data/hit')
WORK.mkdir(parents=True, exist_ok=True)

WEB_STYLE = {"label_size": 13.0, "tick_size": 11.0, "legend_size": 11.0,
             "title_size": 14.0, "font_size": 12.0, "background": "white"}

NEG, POS = 'c1', 'c2'
NEG_NAME, POS_NAME = 'SAG1 wells (c1)', 'GRA14 wells (c2)'


def qt_app():
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication(sys.argv)
    from spacr.qt.preferences import set_theme, set_figure_style, set_figure_colors
    set_theme('light')
    set_figure_colors('#ffffff', '#222222')
    set_figure_style(WEB_STYLE)
    return app


def to_webp(png, webp, width=1200, max_kb=98):
    """Flatten onto white, downscale to at most ``width`` px and write WebP under ``max_kb``."""
    from PIL import Image
    src = Image.open(png).convert('RGBA')
    im = Image.new('RGBA', src.size, (255, 255, 255, 255))
    im.alpha_composite(src)
    im = im.convert('RGB')
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    for q in (90, 85, 80, 75, 70, 60, 50, 40):
        im.save(webp, 'WEBP', quality=q, method=6)
        if Path(webp).stat().st_size <= max_kb * 1024:
            break
    return {'width': im.width, 'height': im.height, 'bytes': Path(webp).stat().st_size, 'quality': q}
