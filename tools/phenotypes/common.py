"""Shared paths and setup for the Phenotypes-tab figures (CPU only, isolated HOME)."""
import os
import sys
from pathlib import Path

SRC = os.environ.get('SPACR_SRC', '/mnt/wd4tb/spacr-worktrees/claude-n687-v4')
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


R4 = ROOT / 'r4'
THEMES = {'dark': {'bg': '#0f1115', 'fg': '#ffffff', 'muted': '#9aa3ad'},
          'light': {'bg': '#fafaf9', 'fg': '#15181e', 'muted': '#5b6270'}}


def set_page_theme(name):
    """Point spaCR's figure preferences at one website theme: page ground, ink and lines, saved as drawn."""
    from spacr.qt.preferences import (set_theme, set_figure_style, set_figure_colors,
                                      set_figure_line_colour, set_figure_save_mode)
    t = THEMES[name]
    set_theme('dark' if name == 'dark' else 'light')
    set_figure_colors(t['bg'], t['fg'])
    set_figure_line_colour(t['fg'])
    set_figure_save_mode('screen')
    set_figure_style(dict(WEB_STYLE, background=t['bg']))
    return t


def ink_axes(fig, t, keep_text_colours=()):
    """Force every piece of chrome on ``fig`` to the theme ink; data colours are untouched."""
    from matplotlib.colors import to_hex
    fig.patch.set_facecolor(t['bg'])
    for ax in fig.axes:
        ax.set_facecolor(t['bg']) if ax.get_facecolor()[3] > 0 else None
        for s in ax.spines.values():
            s.set_color(t['fg'])
        ax.tick_params(colors=t['fg'], which='both')
        ax.xaxis.label.set_color(t['fg']); ax.yaxis.label.set_color(t['fg'])
        ax.title.set_color(t['fg'])
        for lab in ax.get_xticklabels() + ax.get_yticklabels():
            lab.set_color(t['fg'])
        for txt in ax.texts:
            if to_hex(txt.get_color()).lower() not in keep_text_colours:
                txt.set_color(t['fg'])
        leg = ax.get_legend()
        if leg is not None:
            for txt in leg.get_texts():
                txt.set_color(t['fg'])
            leg.get_frame().set_alpha(0)


def to_webp_on(png, webp, bg, width=1200, max_kb=98, size=None):
    """Flatten onto the page colour, fit to ``size`` or ``width`` and write WebP under ``max_kb``.

    Lossless (background exactly ``bg``) when that fits; otherwise lossy colour with a lossless alpha
    plane in which every pixel exactly equal to ``bg`` is transparent, so the page colour shows through
    exactly instead of a lossy approximation of it.
    """
    import io
    import numpy as np
    from PIL import Image
    src = Image.open(png).convert('RGBA')
    im = Image.new('RGBA', src.size, bg)
    im.alpha_composite(src)
    im = im.convert('RGB')
    if size is not None and im.size != tuple(size):
        im = im.resize(tuple(size), Image.LANCZOS)
    elif im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', lossless=True, quality=100, method=6)
    if buf.tell() <= max_kb * 1024:
        Path(webp).write_bytes(buf.getvalue())
        return {'width': im.width, 'height': im.height, 'bytes': Path(webp).stat().st_size, 'encoding': 'lossless'}
    a = np.asarray(im)
    rgb = tuple(int(bg[i:i + 2], 16) for i in (1, 3, 5))
    page = (a == np.array(rgb, dtype=np.uint8)).all(axis=2)
    rgba = np.dstack([a, np.where(page, 0, 255).astype(np.uint8)])
    out = Image.fromarray(rgba, 'RGBA')
    for q in (90, 85, 80, 75, 70, 60, 50, 40):
        out.save(webp, 'WEBP', quality=q, method=6, alpha_quality=100, exact=True)
        if Path(webp).stat().st_size <= max_kb * 1024:
            break
    return {'width': im.width, 'height': im.height, 'bytes': Path(webp).stat().st_size,
            'encoding': f'lossy q{q} with lossless alpha; page-colour pixels transparent ({page.mean():.0%})'}
