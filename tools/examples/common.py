"""Shared setup: a QApplication and the figure preferences used for the website.

HOME points at examples/state (see env.sh), so these preferences are written to
an isolated store, never the user's own spaCR settings.
"""
import sys
from pathlib import Path

OUT = Path('/mnt/wd4tb/scratch/n687/examples/out')
WORK = OUT / 'work'
WORK.mkdir(parents=True, exist_ok=True)

WEB_STYLE = {"label_size": 13.0, "tick_size": 11.0, "legend_size": 11.0,
             "title_size": 14.0, "font_size": 12.0, "background": "white"}


def qt_app():
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication(sys.argv)
    from spacr.qt.preferences import set_theme, set_figure_style
    set_theme('light')
    set_figure_style(WEB_STYLE)
    return app


def to_webp(png, webp, width=1200, max_kb=150):
    """Downscale a spaCR-saved PNG to at most ``width`` px and write WebP under ``max_kb``."""
    from PIL import Image
    src = Image.open(png).convert('RGBA')
    im = Image.new('RGBA', src.size, (255, 255, 255, 255))
    im.alpha_composite(src)
    im = im.convert('RGB')
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    for q in (90, 85, 80, 75, 70, 60, 50):
        im.save(webp, 'WEBP', quality=q, method=6)
        if Path(webp).stat().st_size <= max_kb * 1024:
            break
    return im.size, Path(webp).stat().st_size, q
