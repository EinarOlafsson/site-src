"""Build the website's image-and-mask panels from ONE whole field (MTOC screen plate 2, P08 field 16).

Writes, for each theme (dark, light): the five pipeline panels (800x600), the overview strip
(1600x400) and stack (800 wide), and the recruitment-field strip (1200x241)."""
import json
import os
import sqlite3
import numpy as np
import pandas as pd
from matplotlib import colors as mcolors
from matplotlib import cm as mcm
from PIL import Image, ImageDraw
from common import (R, THEMES, load_field, field_limits, composite, to_img, contours_of, draw_outlines,
                    fill_cells, rounded, save_webp, font, masks_as_measured, pscale, lut, CELLMASK_LUT,
                    HOECHST_RGB)
from measure import SETTINGS
import volcano

STEM = "MTOC_Screen__mtocScreen_20250531_145355__plate2_P08_16_1"
SHOW = "plate2_P08_16_1"
OUT = f"{R}/out"
DB = os.environ.get("FOV_DB", f"{R}/work/measure/measurements/measurements.db")
SCORES = os.environ.get("FOV_SCORES", f"{R}/work/classify/scored_cells.csv")

CELL = (0x00, 0xCE, 0xC8)
NUC = (0x3B, 0x82, 0xF6)
PV = (0xFF, 0x00, 0xFF)
PIPE_WIN = (200, 1100, 200, 1400)
OV_WIN = (280, 1080, 480, 1080)
REC_WIN = (540, 1040, 520, 1000)

MEASURE_COL = "cell_pathogen_overlap_fraction"
MEASURE_CMAP = mcolors.LinearSegmentedColormap.from_list(
    "measure", ["#2A2F45", "#6D3FA0", "#C640C8", "#FF7BEA", "#FFE3FA"])
SCORE_CMAP = mcolors.LinearSegmentedColormap.from_list("score", ["#4F7CFF", "#8A93A6", "#FF8A3D"])
HIT = {"dark": "#FF8A3D", "light": "#EA6A17"}

LIMITS = {"pipe": 90_000, "ov": 120_000, "rec": 120_000}


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


class Field:
    def __init__(self):
        self.f = load_field(STEM)
        self.lim = field_limits(self.f)
        self.m = masks_as_measured(self.f, SETTINGS)
        con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
        self.cell = pd.read_sql(f"select * from cell where file_name='{SHOW}'", con).set_index("object_label")
        self.cell.index = self.cell.index.astype(int)
        self.nuc = pd.read_sql(f"select * from nucleus where file_name='{SHOW}'", con)
        self.pat = pd.read_sql(f"select * from pathogen where file_name='{SHOW}'", con)
        sc = pd.read_csv(SCORES)
        sc = sc[sc.file_name == SHOW]
        pc = "prediction_probability_class_1"
        self.score = dict(zip(sc.object_label.astype(int), sc[pc].astype(float)))
        self.ncells = len(self.cell)
        self._cont = {}

    def contours(self, key, win):
        k = (key, win)
        if k not in self._cont:
            self._cont[k] = contours_of(self.m[key], win)
        return self._cont[k]

    def raw(self, win, size):
        return to_img(composite(self.f, self.lim, win), size)

    def mono(self, win, size, dim=0.62):
        return to_img(composite(self.f, self.lim, win, mono=True) * dim, size)

    def masks(self, win, size, lw):
        layers = [(self.contours("cell", win), CELL, 1.0), (self.contours("nuc", win), NUC, 1.0),
                  (self.contours("pv", win), PV, 1.0)]
        return draw_outlines(self.mono(win, size), layers, win, lw)

    def valuemap(self, win, size, values, cmap, norm, lw, alpha=0.5):
        base = composite(self.f, self.lim, win, mono=True)
        rgb = fill_cells(base, self.m["cell"], win, values, cmap, alpha=alpha, norm=norm, dim=0.62)
        im = to_img(rgb, size)
        cont = self.contours("cell", win)
        layers = []
        for k, paths in cont.items():
            v = values.get(k, np.nan)
            if np.isfinite(v):
                c = cmap((v - norm[0]) / (norm[1] - norm[0]))
                layers.append(({k: paths}, tuple(int(255 * x) for x in c[:3]), 1.0))
        return draw_outlines(im, layers, win, lw)


def colorbar_chip(theme, cmap, ticks, labels, w, h, font_px, bar_h, radius=10):
    t = THEMES[theme]
    ss = 3
    im = Image.new("RGB", (w * ss, h * ss), t["bg"])
    d = ImageDraw.Draw(im)
    f = font(font_px * ss)
    pad = int(font_px * 0.9) * ss
    x0, x1 = pad, w * ss - pad
    y0 = int(h * ss * 0.24)
    grad = np.linspace(0, 1, x1 - x0)
    bar = (np.array([cmap(g)[:3] for g in grad]) * 255).astype(np.uint8)
    bar = np.repeat(bar[None], bar_h * ss, 0)
    im.paste(Image.fromarray(bar), (x0, y0))
    for tv, tl in zip(ticks, labels):
        x = x0 + tv * (x1 - x0)
        anchor = "lt" if tv == 0 else ("rt" if tv == 1 else "mt")
        d.line([(x, y0 + bar_h * ss), (x, y0 + bar_h * ss + 5 * ss)], fill=t["fg"], width=max(1, int(1.2 * ss)))
        d.text((x, y0 + bar_h * ss + 8 * ss), tl, font=f, fill=t["fg"], anchor=anchor)
    im = im.resize((w, h), Image.LANCZOS)
    return im


def paste_chip(panel, chip, margin, radius):
    W, H = panel.size
    cw, ch = chip.size
    ss = 4
    m = Image.new("L", (cw * ss, ch * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, cw * ss - 1, ch * ss - 1], radius * ss, fill=255)
    m = m.resize((cw, ch), Image.LANCZOS)
    out = panel.copy()
    out.paste(chip, (W - cw - margin, H - ch - margin), m)
    return out


def table_panel(theme, F, objs, rows, size, font_px, head_px):
    t = THEMES[theme]
    W, H = size
    ss = 3
    im = Image.new("RGB", (W * ss, H * ss), t["bg"])
    d = ImageDraw.Draw(im)
    fl = font(font_px * ss)
    fh = font(head_px * ss, 600)
    fv = font(int(font_px * 1.08) * ss)
    padx = int(W * 0.06) * ss
    y = int(H * 0.07) * ss
    inline = W >= 600
    x_first = padx + (W * ss - 2 * padx) * (0.66 if inline else 0.53)
    colw = (W * ss - padx - x_first) / (len(objs) - 1) if len(objs) > 1 else 0
    colx = [x_first + colw * i for i in range(len(objs))]
    d.text((padx, y), "object_label", font=fh, fill=t["dim"], anchor="lt")
    yh = y
    for i, o in enumerate(objs):
        d.text((colx[i], yh), str(o), font=fh, fill=t["fg"], anchor="rt")
    y += int(head_px * 1.7) * ss
    d.line([(padx, y), (W * ss - padx, y)], fill=t["grid"], width=ss)
    gap = (H * ss - y - int(H * 0.05) * ss) / len(rows)
    for name, fmt, getter in rows:
        yy = y + (gap * 0.32 if inline else gap * 0.18)
        d.text((padx, yy), name, font=fl, fill=t["dim"], anchor="lt")
        for i, o in enumerate(objs):
            v = getter(o)
            d.text((colx[i], yy if inline else yy + font_px * 1.45 * ss), fmt(v), font=fv, fill=t["fg"], anchor="rt")
        y += gap
    return im.resize((W, H), Image.LANCZOS)


def bordered(im, theme, radius):
    t = THEMES[theme]
    W, H = im.size
    ss = 4
    big = im.resize((W * ss, H * ss), Image.LANCZOS)
    d = ImageDraw.Draw(big)
    line = (0x2A, 0x2F, 0x38) if theme == "dark" else (0xE2, 0xE4, 0xE8)
    d.rounded_rectangle([ss // 2, ss // 2, W * ss - ss // 2 - 1, H * ss - ss // 2 - 1], radius * ss, outline=line, width=ss)
    return big.resize((W, H), Image.LANCZOS)


def place(canvas, im, xy, radius, theme):
    canvas.paste(rounded(im, radius, THEMES[theme]["bg"]), xy)


def measure_values(F):
    return {int(k): float(v) for k, v in F.cell[MEASURE_COL].items()}


def build(theme, F, record):
    t = THEMES[theme]
    os.makedirs(f"{OUT}/pipeline", exist_ok=True)
    os.makedirs(f"{OUT}/spacr", exist_ok=True)
    files = {}
    mv = measure_values(F)
    mnorm = (0.0, float(np.ceil(max(mv.values()) * 20) / 20))
    record["measure_norm"] = mnorm

    def chip_for(cmap, ticks, labels, scale=1.0):
        return colorbar_chip(theme, cmap, ticks, labels, int(300 * scale), int(84 * scale), int(26 * scale), int(14 * scale))

    size = (800, 600)
    p = {
        "01_raw": F.raw(PIPE_WIN, size),
        "02_masks": F.masks(PIPE_WIN, size, 2.2),
        "03_measurements": paste_chip(F.valuemap(PIPE_WIN, size, mv, MEASURE_CMAP, mnorm, 2.2),
                                      chip_for(MEASURE_CMAP, [0, 0.5, 1], ["0", f"{mnorm[1] / 2:g}", f"{mnorm[1]:g}"]), 18, 12),
        "04_classification": paste_chip(F.valuemap(PIPE_WIN, size, F.score, SCORE_CMAP, (0, 1), 2.2),
                                        chip_for(SCORE_CMAP, [0, 0.5, 1], ["0", "0.5", "1"]), 18, 12),
        "05_screen_hit": volcano.render(theme, 800, 600, tick_px=30, label_px=38, pad=[0.12, 0.13, 0.84, 0.82],
                                        hit=HIT[theme]),
    }
    for k, im in p.items():
        path = f"{OUT}/pipeline/{k}.{theme}.webp"
        n, q = save_webp(im, path, LIMITS["pipe"])
        files[f"pipeline/{k}.{theme}.webp"] = {"bytes": n, "quality": q, "size": list(im.size)}

    objs = table_objects(F)
    record["table_objects"] = objs
    rows = table_rows(F)

    gap, rad = 12, 14
    widths = [296, 296, 352, 296, 312]
    H = 400
    strip = Image.new("RGB", (1600, H), t["bg"])
    panels = [F.raw(crop_to(OV_WIN, 296, 400), (296, 400)),
              F.masks(crop_to(OV_WIN, 296, 400), (296, 400), 1.6),
              bordered(table_panel(theme, F, objs, rows, (352, 400), 17, 17), theme, rad),
              paste_chip(F.valuemap(crop_to(OV_WIN, 296, 400), (296, 400), F.score, SCORE_CMAP, (0, 1), 1.6),
                         chip_for(SCORE_CMAP, [0, 0.5, 1], ["0", "0.5", "1"], 0.62), 10, 8),
              bordered(volcano.render(theme, 312, 400, tick_px=18, label_px=21, pad=[0.19, 0.1, 0.72, 0.85],
                                      hit=HIT[theme]), theme, rad)]
    x = 0
    for w, im in zip(widths, panels):
        place(strip, im, (x, 0), rad, theme)
        x += w + gap
    path = f"{OUT}/spacr/overview-strip.{theme}.webp"
    n, q = save_webp(strip, path, LIMITS["ov"])
    files[f"spacr/overview-strip.{theme}.webp"] = {"bytes": n, "quality": q, "size": list(strip.size)}

    g = 12
    half = (800 - g) // 2
    sq = (half, int(half * 4 / 3))
    tab_h = 340
    Hs = sq[1] + g + tab_h + g + sq[1]
    stack = Image.new("RGB", (800, Hs), t["bg"])
    sw = crop_to(OV_WIN, *sq)
    place(stack, F.raw(sw, sq), (0, 0), rad, theme)
    place(stack, F.masks(sw, sq, 2.3), (half + g, 0), rad, theme)
    place(stack, bordered(table_panel(theme, F, objs, rows, (800, tab_h), 25, 25), theme, rad), (0, sq[1] + g), rad, theme)
    y3 = sq[1] + g + tab_h + g
    place(stack, paste_chip(F.valuemap(sw, sq, F.score, SCORE_CMAP, (0, 1), 2.3),
                            chip_for(SCORE_CMAP, [0, 0.5, 1], ["0", "0.5", "1"], 0.95), 14, 10), (0, y3), rad, theme)
    place(stack, bordered(volcano.render(theme, sq[0], sq[1], tick_px=26, label_px=32, pad=[0.17, 0.11, 0.75, 0.84],
                                         hit=HIT[theme]), theme, rad), (half + g, y3), rad, theme)
    path = f"{OUT}/spacr/overview-stack.{theme}.webp"
    n, q = save_webp(stack, path, LIMITS["ov"])
    files[f"spacr/overview-stack.{theme}.webp"] = {"bytes": n, "quality": q, "size": list(stack.size)}

    rec = recruitment(F, theme)
    path = f"{OUT}/spacr/recruitment-field.{theme}.webp"
    n, q = save_webp(rec, path, LIMITS["rec"])
    files[f"spacr/recruitment-field.{theme}.webp"] = {"bytes": n, "quality": q, "size": list(rec.size)}
    return files


def crop_to(win, w, h):
    """Largest window of aspect w:h centred in win."""
    r0, r1, c0, c1 = win
    H, W = r1 - r0, c1 - c0
    if W / H > w / h:
        nw = int(round(H * w / h))
        c0 += (W - nw) // 2
        return (r0, r1, c0, c0 + nw)
    nh = int(round(W * h / w))
    r0 += (H - nh) // 2
    return (r0, r0 + nh, c0, c1)


def table_objects(F):
    win = crop_to(OV_WIN, 296, 400)
    lab = F.m["cell"][win[0]:win[1], win[2]:win[3]]
    ids, cnt = np.unique(lab[lab > 0], return_counts=True)
    full = np.bincount(F.m["cell"].ravel())
    inside = [(i, c / full[i]) for i, c in zip(ids, cnt) if c / full[i] > 0.6 and int(i) in F.cell.index]
    inside = sorted(inside, key=lambda x: -x[1])
    ids = [int(i) for i, _ in inside]
    ids = sorted(ids, key=lambda i: -F.cell.loc[i, MEASURE_COL])
    inf = [i for i in ids if F.cell.loc[i, MEASURE_COL] > 0]
    pick = [inf[0], inf[len(inf) // 2], ids[-1]]
    assert len(pick) == 3, ids
    return pick


def table_rows(F):
    npv = F.pat.groupby("cell_id").size()
    nuc_area = F.nuc.groupby("cell_id")["nucleus_area"].sum()
    return [
        ("cell_area", lambda v: f"{v:,.0f}", lambda o: F.cell.loc[o, "cell_area"]),
        ("cell_eccentricity", lambda v: f"{v:.3f}", lambda o: F.cell.loc[o, "cell_eccentricity"]),
        ("nucleus_area", lambda v: f"{v:,.0f}", lambda o: nuc_area.get(o, np.nan)),
        ("cell_pathogen_overlap_fraction", lambda v: f"{v:.3f}", lambda o: F.cell.loc[o, MEASURE_COL]),
        ("cell_channel_1_mean_intensity", lambda v: f"{v:,.1f}", lambda o: F.cell.loc[o, "cell_channel_1_mean_intensity"]),
    ]


def recruitment(F, theme):
    """Five panels: Hoechst, CellMask, then cell, nucleus and vacuole outlines on the field."""
    t = THEMES[theme]
    W, H, g = 1200, 241, 10
    pw = (W - 4 * g) // 5
    rem = W - 4 * g - 5 * pw
    win = crop_to(REC_WIN, pw, H)
    sl = (slice(win[0], win[1]), slice(win[2], win[3]))
    h = pscale(F.f["hoechst"][sl], *F.lim["hoechst"], 0.9)
    c = pscale(F.f["cellmask"][sl], *F.lim["cellmask"])
    size = (pw, H)
    hoechst = to_img(lut(h, [(0.0, (0.0, 0.0, 0.0)), (0.55, HOECHST_RGB), (1.0, (0.78, 0.88, 1.0))]), size)
    cellmask = to_img(lut(c, CELLMASK_LUT), size)
    lw = 1.5
    cellp = draw_outlines(F.mono(win, size), [(F.contours("cell", win), CELL, 1.0)], win, lw)
    nucp = draw_outlines(F.mono(win, size), [(F.contours("nuc", win), NUC, 1.0)], win, lw)
    pvp = draw_outlines(F.mono(win, size), [(F.contours("pv", win), PV, 1.0)], win, lw)
    canvas = Image.new("RGB", (W, H), t["bg"])
    x = 0
    for i, im in enumerate([hoechst, cellmask, cellp, nucp, pvp]):
        w = pw + (rem if i == 4 else 0)
        if w != pw:
            im = im.resize((w, H), Image.LANCZOS)
        place(canvas, im, (x, 0), 8, theme)
        x += w + g
    return canvas


if __name__ == "__main__":
    F = Field()
    record = {"n_cells_measured": F.ncells}
    files = {}
    for th in ("dark", "light"):
        files.update(build(th, F, record))
    record["files"] = files
    json.dump(record, open(f"{R}/work/build_record.json", "w"), indent=1, default=str)
    for k, v in files.items():
        print(k, v)
