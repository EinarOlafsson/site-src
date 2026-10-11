"""Shared theming for the website's dark/light figure pairs.

Each figure is drawn twice by spaCR, once per page theme. Before drawing, the
isolated spaCR settings store (HOME is redirected by env.sh) gets the theme,
the figure background and the text/line colours of that theme, so spaCR's own
style path (spacr.figures.style._apply_user_style via spacr.plot.save_figure)
draws in them. ``enforce`` then repaints the chrome of the finished figure
(spines, ticks, labels, legend, colorbar text) so every pixel of chrome is
exactly the theme ink, whichever code path drew it.
"""
import io
import sys
from pathlib import Path

OUT = Path('/mnt/wd4tb/scratch/n687v3/themed')
WORK = OUT / 'work'
WORK.mkdir(parents=True, exist_ok=True)

THEMES = {
    'dark': {'bg': '#0f1115', 'ink': '#ffffff', 'grid': '#ffffff', 'grid_alpha': 0.10},
    'light': {'bg': '#fafaf9', 'ink': '#15181e', 'grid': '#15181e', 'grid_alpha': 0.08},
}

WEB_STYLE = {"label_size": 13.0, "tick_size": 11.0, "legend_size": 11.0,
             "title_size": 14.0, "font_size": 12.0}


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def set_spacr_theme(theme):
    """Write the theme into the isolated spaCR settings store."""
    t = THEMES[theme]
    from spacr.qt.preferences import (set_theme, set_figure_style,
                                      set_figure_colors, set_figure_line_colour)
    set_theme(theme)
    set_figure_colors(t['bg'], t['ink'])
    set_figure_line_colour(t['ink'])
    set_figure_style(dict(WEB_STYLE, background=t['bg']))


def qt_app(theme):
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication(sys.argv)
    set_spacr_theme(theme)
    return app


def enforce(fig, theme, keep_text=()):
    """Repaint figure chrome in the theme ink and ground. Data artists are untouched.

    ``keep_text`` holds Text artists whose colour is data (e.g. an EC50 label in
    the series colour) and is left alone.
    """
    from matplotlib.text import Text
    t = THEMES[theme]
    ink, bg = t['ink'], t['bg']
    fig.patch.set_facecolor(bg)
    fig.patch.set_alpha(1)
    keep = set(map(id, keep_text))
    for ax in fig.get_axes():
        ax.set_facecolor(bg)
        for sp in ax.spines.values():
            sp.set_edgecolor(ink)
        ax.tick_params(axis='both', which='both', colors=ink, labelcolor=ink)
        ax.xaxis.label.set_color(ink)
        ax.yaxis.label.set_color(ink)
        for title in (ax.title, ax._left_title, ax._right_title):
            title.set_color(ink)
        for g in ax.get_xgridlines() + ax.get_ygridlines():
            g.set_color(t['grid'])
            g.set_alpha(t['grid_alpha'])
        for txt in ax.texts:
            if id(txt) not in keep:
                txt.set_color(ink)
        leg = ax.get_legend()
        if leg is not None:
            style_legend(leg, theme)
    for leg in fig.legends:
        style_legend(leg, theme)
    for txt in fig.texts:
        if id(txt) not in keep:
            txt.set_color(ink)
    return fig


def style_legend(leg, theme):
    t = THEMES[theme]
    for txt in leg.get_texts():
        txt.set_color(t['ink'])
    if leg.get_title() is not None:
        leg.get_title().set_color(t['ink'])
    fr = leg.get_frame()
    fr.set_facecolor(t['bg'])
    fr.set_edgecolor(t['ink'])


def save_pair_png(fig, theme, name, dpi):
    """Write the themed figure with spaCR's writer, on screen colours, opaque ground."""
    from spacr.plot import save_figure
    t = THEMES[theme]
    return save_figure(fig, WORK / f'{name}.{theme}.png', fmt='png', dpi=dpi,
                       save_mode='screen', facecolor=t['bg'], edgecolor=t['bg'])


def to_webp(png, theme, name, width, height=None, max_kb=99):
    """Flatten onto the exact theme ground, size to ``width`` (and ``height``) and write WebP.

    Lossless when that fits, which keeps the ground exactly the theme colour;
    otherwise lossy with sharp YUV and the ground checked afterwards.
    """
    from PIL import Image
    t = THEMES[theme]
    src = Image.open(png).convert('RGBA')
    im = Image.new('RGBA', src.size, hex_rgb(t['bg']) + (255,))
    im.alpha_composite(src)
    im = im.convert('RGB')
    size = (width, height or round(im.height * width / im.width))
    if im.size != size:
        im = im.resize(size, Image.LANCZOS)
    return write_webp(im, OUT / f'{name}.{theme}.webp', max_kb)


def write_webp(im, path, max_kb=99):
    from PIL import Image
    buf = io.BytesIO()
    im.save(buf, 'WEBP', lossless=True, quality=100, method=6)
    mode = 'lossless'
    if buf.tell() > max_kb * 1024:
        import numpy as np
        arr = np.asarray(im)
        for colours in (256, 192, 128, 96, 64):
            q = np.asarray(im.quantize(colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert('RGB')).copy()
            ground = (arr == arr[0, 0]).all(-1)
            q[ground] = arr[0, 0]
            buf = io.BytesIO()
            Image.fromarray(q).save(buf, 'WEBP', lossless=True, quality=100, method=6)
            mode = f'lossless, {colours} colours'
            if buf.tell() <= max_kb * 1024:
                break
    if buf.tell() > max_kb * 1024:
        for q in (92, 90, 88, 85, 82, 80, 75, 70, 65, 60):
            buf = io.BytesIO()
            im.save(buf, 'WEBP', quality=q, method=6, use_sharp_yuv=True)
            mode = f'lossy q{q}'
            if buf.tell() <= max_kb * 1024:
                break
    Path(path).write_bytes(buf.getvalue())
    return {'file': Path(path).name, 'size': list(im.size), 'bytes': buf.tell(), 'mode': mode}


def ground_check(path, theme):
    """Fraction of border pixels exactly equal to the theme ground, and the most common border colour."""
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    want = np.array(hex_rgb(THEMES[theme]['bg']))
    exact = float((border == want).all(1).mean())
    vals, counts = np.unique(border, axis=0, return_counts=True)
    common = '#%02x%02x%02x' % tuple(vals[counts.argmax()])
    return {'border_exact_fraction': round(exact, 4), 'border_mode': common}


def _lum(rgb):
    def ch(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c) for c in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(c1, c2):
    from matplotlib.colors import to_rgb
    a, b = sorted((_lum(to_rgb(c1)), _lum(to_rgb(c2))), reverse=True)
    return (a + 0.05) / (b + 0.05)


def readable(colour, theme, min_contrast=3.0):
    """``colour`` mixed toward the theme ink just enough to reach ``min_contrast`` on the ground."""
    from matplotlib.colors import to_rgba, to_hex
    t = THEMES[theme]
    rgba = to_rgba(colour)
    ink = to_rgba(t['ink'])
    if contrast(rgba, t['bg']) >= min_contrast:
        return colour
    for k in range(1, 21):
        f = k / 20
        mix = tuple(rgba[i] * (1 - f) + ink[i] * f for i in range(3))
        if contrast(mix, t['bg']) >= min_contrast:
            return to_hex(mix) if len(str(colour)) <= 7 else mix + (rgba[3],)
    return t['ink']


def lift_data_colours(fig, theme, min_contrast=3.0, artists=None):
    """Raise line and marker colours that fall below ``min_contrast`` on the theme ground (WCAG 3:1 for graphics)."""
    changed = []
    for ax in fig.get_axes():
        group = artists if artists is not None else list(ax.lines)
        leg = ax.get_legend()
        if artists is None and leg is not None:
            group = group + list(getattr(leg, 'legend_handles', []))
        for ln in group:
            for get, put in (('get_color', 'set_color'), ('get_markerfacecolor', 'set_markerfacecolor'),
                             ('get_markeredgecolor', 'set_markeredgecolor')):
                if not hasattr(ln, get):
                    continue
                c = getattr(ln, get)()
                if isinstance(c, str) and c.lower() in ('none', 'auto'):
                    continue
                try:
                    new = readable(c, theme, min_contrast)
                except Exception:
                    continue
                if contrast(c, THEMES[theme]['bg']) < 1.3:
                    continue
                if new is not c:
                    getattr(ln, put)(new)
                    changed.append((str(c), str(new)))
    return changed
