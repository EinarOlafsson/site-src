"""Shared helpers for the whole-field website panels (N687 v3 FOV)."""
import os
import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFont
from skimage.measure import find_contours

R = os.environ.get("FOV_ROOT", "/mnt/wd4tb/scratch/n687v3/fov")
CC = f"{R}/dl/cc"

THEMES = {
    "dark": {"bg": (0x0F, 0x11, 0x15), "fg": (0xFF, 0xFF, 0xFF), "dim": (0xA9, 0xB0, 0xBD),
             "grid": (0x2A, 0x2F, 0x38), "faint": (0x6B, 0x72, 0x80)},
    "light": {"bg": (0xFA, 0xFA, 0xF9), "fg": (0x15, 0x18, 0x1E), "dim": (0x55, 0x5C, 0x68),
              "grid": (0xE2, 0xE4, 0xE8), "faint": (0x9C, 0xA3, 0xAF)},
}
IMG_BG = (0x0B, 0x0D, 0x11)
CELL = (0x00, 0xCE, 0xC8)
NUC = (0x5B, 0x9B, 0xFF)
PV = (0xFF, 0x3D, 0xF5)
FONT = "/mnt/wd4tb/scratch/n687/fonts/OpenSans-VF.ttf"


def font(px, weight=400):
    f = ImageFont.truetype(FONT, px)
    try:
        f.set_variation_by_axes([weight, 100])
    except Exception:
        try:
            f.set_variation_by_axes([weight])
        except Exception:
            pass
    return f


def load_field(stem, cc=CC):
    """Hoechst, CellMask planes and the cell, nucleus and vacuole label images of one field."""
    g = lambda k: tifffile.imread(f"{cc}/{stem}.{k}.tif")
    return {"hoechst": g("hoechst"), "cellmask": g("cellmask"), "cell": g("cell"),
            "nuc": g("nuc"), "pv": g("pv")}


def pscale(a, lo, hi, gamma=1.0):
    a = a.astype(np.float32)
    v = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    return v ** gamma


def field_limits(f, lo=1.0, hi=99.7, hi_cellmask=99.95):
    """Per-channel percentile limits over the whole field (not the window).

    CellMask uses a higher top percentile because the parasites, which take up the
    dye, are its brightest structures and would otherwise clip to a flat white."""
    return {"hoechst": tuple(np.percentile(f["hoechst"], [lo, hi])),
            "cellmask": tuple(np.percentile(f["cellmask"], [lo, hi_cellmask]))}


CELLMASK_LUT = [(0.0, (0.0, 0.0, 0.0)), (0.22, (0.20, 0.25, 0.29)),
                (0.56, (0.50, 0.55, 0.59)), (0.80, (0.98, 0.74, 0.55)), (1.0, (1.0, 0.88, 0.76))]
HOECHST_RGB = (0.20, 0.47, 1.0)


def lut(v, stops):
    xs = [s[0] for s in stops]
    return np.stack([np.interp(v, xs, [s[1][i] for s in stops]) for i in range(3)], -1).astype(np.float32)


def screen(*layers):
    out = np.zeros(layers[0].shape, np.float32)
    for layer in layers:
        out = 1 - (1 - out) * (1 - np.clip(layer, 0, 1))
    return out


def composite(f, lim, win=None, mono=False):
    """Float RGB: Hoechst blue; CellMask through a cool-to-warm lookup table (grey host
    cytoplasm, warm brightest structures, which are the dye-loaded parasites)."""
    sl = (slice(None), slice(None)) if win is None else (slice(win[0], win[1]), slice(win[2], win[3]))
    h = pscale(f["hoechst"][sl], *lim["hoechst"], gamma=0.9)
    c = pscale(f["cellmask"][sl], *lim["cellmask"])
    if mono:
        g = np.clip(0.85 * c ** 0.8 + 0.25 * h, 0, 1)
        return np.stack([g * 0.93, g * 0.96, g], -1)
    return screen(lut(c, CELLMASK_LUT), h[..., None] * np.array(HOECHST_RGB, np.float32))


def to_img(rgb, size):
    im = Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8))
    return im.resize(size, Image.LANCZOS)


def contours_of(labels, win, ids=None):
    """Sub-pixel contour paths (row, col in window coordinates) for every label in a window.

    Labels are taken from the whole-field mask; a 1 px margin around the window keeps
    objects that cross the window edge open rather than closed along the edge."""
    r0, r1, c0, c1 = win
    H, W = labels.shape
    a0, a1, b0, b1 = max(r0 - 2, 0), min(r1 + 2, H), max(c0 - 2, 0), min(c1 + 2, W)
    sub = labels[a0:a1, b0:b1]
    out = {}
    from scipy import ndimage as ndi
    objs = ndi.find_objects(sub)
    for i, sl in enumerate(objs, start=1):
        if sl is None or (ids is not None and i not in ids):
            continue
        rs, cs = sl
        m = np.pad(sub[rs, cs] == i, 1).astype(np.float32)
        m = ndi.gaussian_filter(m, 0.7)
        paths = []
        for p in find_contours(m, 0.5):
            if len(p) < 6:
                continue
            p = p + [rs.start - 1 + a0 - r0, cs.start - 1 + b0 - c0]
            paths.append(p)
        if paths:
            out[i] = paths
    return out


def draw_outlines(im, layers, win, width_px, ss=4):
    """Draw anti-aliased contour polylines on a PIL RGB image.

    layers: list of (contours dict, rgb colour, alpha). width_px is the line width in
    output pixels; drawing happens at ss-times supersampling and is box-downsampled."""
    W, H = im.size
    sy = H / (win[1] - win[0])
    sx = W / (win[3] - win[2])
    big = im.resize((W * ss, H * ss), Image.LANCZOS).convert("RGBA")
    for cont, col, alpha in layers:
        ov = Image.new("RGBA", big.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(ov)
        w = max(1, int(round(width_px * ss)))
        for paths in cont.values():
            for p in paths:
                pts = [((c + 0.5) * sx * ss, (r + 0.5) * sy * ss) for r, c in p]
                closed = np.allclose(p[0], p[-1])
                d.line(pts, fill=col + (255,), width=w, joint="curve")
                if closed:
                    d.line([pts[-1], pts[0]], fill=col + (255,), width=w)
        if alpha < 1:
            a = np.asarray(ov).copy()
            a[..., 3] = (a[..., 3] * alpha).astype(np.uint8)
            ov = Image.fromarray(a)
        big = Image.alpha_composite(big, ov)
    return big.convert("RGB").resize((W, H), Image.BOX)


def fill_cells(rgb_img, labels, win, values, cmap, alpha=0.55, size=None, norm=(0, 1), dim=0.55):
    """Blend each cell's fill colour (from values: label -> value) over a dimmed image."""
    r0, r1, c0, c1 = win
    lab = labels[r0:r1, c0:c1]
    base = rgb_img * dim
    col = np.zeros(base.shape, np.float32)
    a = np.zeros(lab.shape, np.float32)
    lo, hi = norm
    for k, v in values.items():
        if not np.isfinite(v):
            continue
        m = lab == k
        if not m.any():
            continue
        c = np.array(cmap((v - lo) / max(hi - lo, 1e-9))[:3], np.float32)
        col[m] = c
        a[m] = alpha
    out = base * (1 - a[..., None]) + (base * 0.4 + col * 0.95) * a[..., None]
    return np.clip(out, 0, 1)


def rounded(im, radius, bg):
    """Paste an image on a page-coloured canvas with rounded corners (anti-aliased)."""
    W, H = im.size
    ss = 4
    m = Image.new("L", (W * ss, H * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, W * ss - 1, H * ss - 1], radius * ss, fill=255)
    m = m.resize((W, H), Image.LANCZOS)
    out = Image.new("RGB", (W, H), bg)
    out.paste(im, (0, 0), m)
    return out


def save_webp(im, path, limit, q0=90):
    """Save at the highest quality that stays under limit bytes."""
    for q in range(q0, 30, -2):
        im.save(path, "WEBP", quality=q, method=6)
        n = os.path.getsize(path)
        if n <= limit:
            return n, q
    return n, q


def masks_as_measured(f, s):
    """Reproduce spaCR Measure's mask reconciliation (spacr.measure._measure_crop_core with
    merge_edge_pathogen_cells, cytoplasm and uninfected on) so outlines match measured objects."""
    from spacr.utils import _filter_object, _merge_overlapping_objects, _exclude_objects
    cell = f["cell"].astype(np.int32).copy()
    nuc = f["nuc"].astype(np.int32).copy()
    pv = f["pv"].astype(np.int32).copy()
    cell = _filter_object(cell, s["cell_min_size"])
    nuc, cell = _merge_overlapping_objects(mask1=nuc, mask2=cell)
    nuc = _filter_object(nuc, s["nucleus_min_size"])
    pv, cell = _merge_overlapping_objects(mask1=pv, mask2=cell)
    pv = _filter_object(pv, s["pathogen_min_size"])
    cyto = np.where((nuc != 0) | (pv != 0), 0, cell)
    cell = _filter_object(cell, s["cell_min_size"])
    nuc = _filter_object(nuc, s["nucleus_min_size"])
    pv = _filter_object(pv, s["pathogen_min_size"])
    cell, nuc, pv, cyto = _exclude_objects(cell, nuc, pv, cyto, uninfected=True)
    return {"cell": cell, "nuc": nuc, "pv": pv, "cyto": cyto}
