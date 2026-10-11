import os, sys, json, sqlite3
import numpy as np, pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import colors as mcolors
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import binary_dilation
from skimage.segmentation import find_boundaries
from skimage.morphology import disk

DATA, WORK, OUT = sys.argv[1:4]
DB = os.path.join(DATA, 'hit/measurements/measurements.db')
DV = os.path.join(DATA, 'hit/plate1_dv.csv')
REC = os.path.join(WORK, 'recon')
RES = os.path.join(WORK, 'regress/results/ols/results_gene.csv')
os.makedirs(OUT, exist_ok=True)

WIN = (40, 940, 780, 1980)
BG = np.array([0x10, 0x13, 0x1A]) / 255
BORDER = (0x2B, 0x31, 0x3D, 255)
NUC = np.array([0x3B, 0x82, 0xF6]) / 255
CELL = np.array([0x00, 0xCE, 0xC8]) / 255
PAR = np.array([0xFF, 0x00, 0xFF]) / 255
TXT = (0xE6, 0xE9, 0xEF)
DIM = (0x8B, 0x93, 0xA3)
FONT = '/usr/share/fonts/truetype/noto/NotoSans-SemiCondensed.ttf'
FONTB = '/usr/share/fonts/truetype/noto/NotoSans-SemiCondensedMedium.ttf'
MONO = '/usr/share/fonts/truetype/noto/NotoSansMono-SemiCondensed.ttf'
SCORE_CMAP = mcolors.LinearSegmentedColormap.from_list('score', ['#4F7CFF', '#8A93A6', '#FF8A3D'])
HIT = '#FF8A3D'
ELL = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

R0, R1, C0, C1 = WIN
rgb = np.load(os.path.join(REC, 'field_rgb.npy'))[R0:R1, C0:C1].astype(np.float32)
cells = np.load(os.path.join(REC, 'cell_labels.npy'))[R0:R1, C0:C1]
nuc = np.load(os.path.join(REC, 'nucleus_labels_crop.npy'))
pat = np.load(os.path.join(REC, 'pathogen_labels_crop.npy'))


def min_size(m, n):
    ids, counts = np.unique(m, return_counts=True)
    m = m.copy()
    m[np.isin(m, ids[(counts < n) & (ids != 0)])] = 0
    return m


nuc, pat = min_size(nuc, 2000), min_size(pat, 500)
fg = cells > 0
norm = np.zeros_like(rgb)
for k in range(3):
    v = rgb[..., k][fg]
    a, b = np.percentile(v, 0.5), np.percentile(v, 99.7)
    norm[..., k] = np.clip((rgb[..., k] - a) / max(b - a, 1e-6), 0, 1)

con = sqlite3.connect(DB)
celltab = pd.read_sql("select * from cell where plateID='plate1' and rowID='r8' and columnID='c2' and fieldID='f4'", con)
if celltab.empty:
    celltab = pd.read_sql("select * from cell where rowID='r8' and columnID='c2' and fieldID='f4'", con)
celltab['object_label'] = celltab.object_label.astype(int)
celltab = celltab.set_index('object_label')
dv = pd.read_csv(DV)
dv = dv[(dv.plate == 'pplate1') & (dv.row == 'r8') & (dv.col == 'c2') & (dv.field == 'f4')]
pred = dv.set_index('object').pred


def crop(a, box):
    r0, r1, c0, c1 = box
    return a[r0:r1, c0:c1]


def resize_f(a, size):
    out = []
    for k in range(a.shape[-1]):
        im = Image.fromarray(a[..., k].astype(np.float32), mode='F').resize(size, Image.BOX)
        out.append(np.asarray(im))
    return np.stack(out, -1)


def resize_l(a, size):
    return np.asarray(Image.fromarray(a.astype(np.int32)).resize(size, Image.NEAREST))


def edge(lbl, size, width):
    b = find_boundaries(lbl, mode='inner')
    b = binary_dilation(b, structure=disk(width)) if width else b
    return np.clip(resize_f(b[..., None].astype(np.float32), size)[..., 0] * 1.6, 0, 1)


def raw_panel(box, size):
    n = crop(norm, box)
    img = (n[..., 0:1] * PAR * 0.95 + n[..., 1:2] * np.array([0.25, 1.0, 0.35]) * 0.9
           + n[..., 2:3] * NUC * 1.15)
    img = resize_f(img, size)
    return np.clip(BG + img, 0, 1)


def over(img, alpha, col):
    a = alpha[..., None]
    return img * (1 - a) + np.asarray(col) * a


def mask_panel(box, size, w):
    n = crop(norm, box)
    grey = resize_f(n.mean(-1, keepdims=True), size)
    img = BG + np.repeat(grey, 3, -1) * 0.45
    c, nu, pa = crop(cells, box), crop(nuc, box), crop(pat, box)
    fill = lambda m: resize_f((m > 0)[..., None].astype(np.float32), size)[..., 0]
    img = over(img, fill(nu) * 0.30, NUC)
    img = over(img, fill(pa) * 0.35, PAR)
    img = over(img, edge(nu, size, w), NUC * 1.0 + 0.12)
    img = over(img, edge(pa, size, w), PAR)
    img = over(img, edge(c, size, w + 1), CELL)
    return np.clip(img, 0, 1)


def score_panel(box, size, w, bar_h, font_px):
    n = crop(norm, box)
    c = crop(cells, box)
    grey = resize_f(n.mean(-1, keepdims=True), size)
    img = BG + np.repeat(grey, 3, -1) * 0.45
    ids = [int(i) for i in np.unique(c) if i]
    for i in ids:
        if i not in pred.index:
            continue
        col = np.asarray(SCORE_CMAP(float(pred[i]))[:3])
        m = resize_f((c == i)[..., None].astype(np.float32), size)[..., 0]
        img = over(img, m * 0.55, col)
        img = over(img, edge(c == i, size, w + 1), col)
    img = np.clip(img, 0, 1)
    im = Image.fromarray((img * 255).astype(np.uint8))
    d = ImageDraw.Draw(im, 'RGBA')
    W, H = size
    f = ImageFont.truetype(FONT, font_px)
    pad = max(8, W // 28)
    bw = int(W * 0.46)
    x0, y1 = W - pad - bw, H - pad - font_px - 6
    y0 = y1 - bar_h
    d.rounded_rectangle([x0 - pad // 2, y0 - pad // 2, W - pad // 2, H - pad // 3], radius=6, fill=(0x10, 0x13, 0x1A, 215))
    for x in range(bw):
        r, g, b, _ = SCORE_CMAP(x / (bw - 1))
        d.line([x0 + x, y0, x0 + x, y1], fill=(int(r * 255), int(g * 255), int(b * 255)))
    for t, anchor in ((0, 'la'), (0.5, 'ma'), (1, 'ra')):
        x = x0 + t * (bw - 1)
        d.line([x, y1, x, y1 + 3], fill=TXT)
        d.text((x, y1 + 4), f'{t:g}', font=f, fill=TXT, anchor=anchor)
    return np.asarray(im).astype(np.float32) / 255, ids


def fmt(col, v):
    if col == 'object_label':
        return f'{int(v)}'
    if 'area' in col:
        return f'{v:,.0f}'
    if 'solidity' in col or 'eccentricity' in col:
        return f'{v:.3f}'
    return f'{v:.1f}'


def table_panel(objs, cols, size, mode, max_font):
    W, H = size
    feats = [c for c in cols if c != 'object_label']
    im = Image.new('RGB', size, tuple(int(x * 255) for x in BG))
    d = ImageDraw.Draw(im)
    pad = max(10, W // 30)
    ID = (0x5E, 0xE9, 0xE4)
    LINE = (0x3A, 0x41, 0x50)
    STRIPE = (0x17, 0x1B, 0x24)
    for fs in range(max_font, 7, -1):
        fh = ImageFont.truetype(FONTB, fs)
        fv = ImageFont.truetype(MONO, fs)
        fn = ImageFont.truetype(FONT, int(fs * 0.86))
        fe = ImageFont.truetype(ELL, fs)
        tw = lambda t, f: f.getbbox(t)[2]
        if mode == 'twoline':
            vals = [[fmt(c, celltab.loc[o, c]) for o in objs] for c in feats]
            vw = [max([tw(str(o), fv)] + [tw(v[k], fv) for v in vals]) for k, o in enumerate(objs)]
            name_w = max(tw(c, fn) for c in feats)
            gap = int(fs * 0.8)
            row_w = tw('object_label', fn) + gap + sum(vw) + gap * (len(objs) - 1)
            nh, vh = int(fs * 1.25), int(fs * 1.45)
            blk = nh + vh + int(fs * 0.35)
            th = int(fs * 1.9) + blk * len(feats) + int(fs * 1.3)
            if max(row_w, name_w) <= W - 2 * pad and th <= H - 2 * pad:
                break
        else:
            header = list(cols)
            rows = [[fmt(c, celltab.loc[o, c]) if c != 'object_label' else str(o) for c in cols] for o in objs]
            widths = [max([tw(header[j], fh)] + [tw(r[j], fv) for r in rows]) for j in range(len(cols))]
            gap = int(fs * 0.9)
            total = sum(widths) + gap * (len(cols) - 1)
            rh = int(fs * 1.7)
            th = rh * (len(rows) + 1) + int(fs * 1.3)
            if total <= W - 2 * pad and th <= H - 2 * pad:
                break
    if mode == 'twoline':
        y = (H - th) // 2
        right = W - pad
        xs = []
        x = right
        for k in range(len(objs) - 1, -1, -1):
            xs.insert(0, x)
            x -= vw[k] + gap
        hy = y + int(fs * 0.95)
        d.text((pad, hy), 'object_label', font=fn, fill=DIM, anchor='lm')
        for k, o in enumerate(objs):
            d.text((xs[k], hy), str(o), font=fv, fill=ID, anchor='rm')
        y += int(fs * 1.9)
        d.line([pad, y - int(fs * 0.3), right, y - int(fs * 0.3)], fill=LINE, width=max(1, fs // 12))
        for i, c in enumerate(feats):
            if i % 2 == 0:
                d.rounded_rectangle([pad // 2, y, W - pad // 2, y + blk - int(fs * 0.2)], radius=4, fill=STRIPE)
            d.text((pad, y + nh // 2 + 2), c, font=fn, fill=DIM, anchor='lm')
            for k, v in enumerate(vals[i]):
                d.text((xs[k], y + nh + vh // 2), v, font=fv, fill=TXT, anchor='rm')
            y += blk
        d.text((pad, y + int(fs * 0.55)), '\u22ee', font=fe, fill=DIM, anchor='lm')
        for k in range(len(objs)):
            d.text((xs[k], y + int(fs * 0.55)), '\u22ee', font=fe, fill=DIM, anchor='rm')
    else:
        y = (H - th) // 2
        xs = [pad]
        for wj in widths[:-1]:
            xs.append(xs[-1] + wj + gap)
        extra = (W - 2 * pad - total) // max(1, len(widths) - 1)
        xs = [x + extra * j for j, x in enumerate(xs)]
        yc = y + rh // 2
        for j, h in enumerate(header):
            d.text((xs[j] + widths[j], yc), h, font=fh, fill=ID if j == 0 else TXT, anchor='rm')
        d.line([pad, y + rh, W - pad, y + rh], fill=LINE, width=max(1, fs // 12))
        for i, r in enumerate(rows):
            yc = y + rh * (i + 1) + rh // 2
            if i % 2 == 0:
                d.rounded_rectangle([pad // 2, yc - rh // 2 + 1, W - pad // 2, yc + rh // 2 - 1], radius=4, fill=STRIPE)
            for j, v in enumerate(r):
                d.text((xs[j] + widths[j], yc), v, font=fv, fill=ID if j == 0 else TXT, anchor='rm')
        yd = y + rh * (len(rows) + 1) + int(fs * 0.6)
        for j in range(len(cols)):
            d.text((xs[j] + widths[j], yd), '\u22ee', font=fe, fill=DIM, anchor='rm')
    return np.asarray(im).astype(np.float32) / 255, fs


def volcano_panel(size, tick_px, label_px, marker):
    from spacr.volcano_style import VolcanoStyle, render_volcano
    r = pd.read_csv(RES)
    r['gene'] = r['gene'].astype(str)
    r['label'] = r['gene']
    r['significant'] = r['q_value'] < 0.05
    W, H = size
    bg = '#%02x%02x%02x' % tuple(int(x * 255) for x in BG)
    style = VolcanoStyle(x_column='coefficient', y_column='p_value', label_column='label',
                         x_label='', y_label='', annotations={'239740': 'GRA14'},
                         figure_width=W / 100, figure_height=H / 100, dpi=100, background_color=bg,
                         significant_marker_size=marker * 1.5, marker_size=marker,
                         label_font_size=label_px * 0.72, tick_font_size=tick_px * 0.72, legend=False,
                         show_colorbar=False, grid_color='#262C38', line_color='#7A8394',
                         zero_line_color='#7A8394', axis_color='#7A8394', marker_edge_color=bg,
                         base_color='#6B7380', significant_color=HIT)
    fig, axes = render_volcano(r, style)
    ax = axes[0]
    fig.set_facecolor(bg)
    ax.set_facecolor(bg)
    g = r[r.gene == '239740'].iloc[0]
    gy = -np.log10(g.p_value)
    ax.scatter([g.coefficient], [gy], s=marker * 4.2, facecolors='none', edgecolors='#FFFFFF', linewidths=2.0, zorder=5)
    for t in list(ax.texts):
        if t.get_text() == 'GRA14':
            t.remove()
    ax.annotate('GRA14', (g.coefficient, gy), xytext=(-0.9 * label_px, 0), textcoords='offset points', ha='right', va='center',
                color='#FFFFFF', fontsize=label_px * 0.72, fontweight='bold', zorder=6)
    ax.set_xlim(min(ax.get_xlim()[0], r.coefficient.min() - 0.6), max(ax.get_xlim()[1], g.coefficient + 1.0))
    ax.tick_params(colors='#C9CED8', labelsize=tick_px * 0.72, length=3)
    for s in ax.spines.values():
        s.set_color('#4A5260')
    ax.set_xlabel('')
    ax.set_ylabel('')
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    lw = max(t.get_window_extent(rend).width for t in ax.get_yticklabels() if t.get_text())
    bh = max(t.get_window_extent(rend).height for t in ax.get_xticklabels() if t.get_text())
    l = (lw + 14) / W
    b = (bh + 14) / H
    ax.set_position([l, b, 1 - l - 12 / W, 1 - b - 14 / H])
    tmp = os.path.join(WORK, f'volcano_{W}x{H}.png')
    fig.savefig(tmp, dpi=100, facecolor=bg)
    plt.close(fig)
    im = Image.open(tmp).convert('RGB')
    assert im.size == size, im.size
    sig = r[r.q_value < 0.05][['gene', 'coefficient', 'p_value', 'q_value']]
    return np.asarray(im).astype(np.float32) / 255, dict(n_genes=int(len(r)), hit=dict(gene='239740', coefficient=float(g.coefficient), p_value=float(g.p_value), q_value=float(g.q_value)), significant=sig.round(5).to_dict('records'))


def rounded(arr, radius):
    H, W = arr.shape[:2]
    m = Image.new('L', (W * 4, H * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, W * 4 - 1, H * 4 - 1], radius=radius * 4, fill=255)
    m = np.asarray(m.resize((W, H), Image.LANCZOS)).astype(np.float32) / 255
    rgba = np.concatenate([arr, m[..., None]], -1)
    b = Image.new('L', (W * 4, H * 4), 0)
    ImageDraw.Draw(b).rounded_rectangle([0, 0, W * 4 - 1, H * 4 - 1], radius=radius * 4, outline=255, width=4)
    b = np.asarray(b.resize((W, H), Image.LANCZOS)).astype(np.float32)[..., None] / 255
    rgba[..., :3] = rgba[..., :3] * (1 - b) + (np.asarray(BORDER[:3]) / 255) * b
    return rgba


def compose(layout, W, H, radius):
    canvas = np.zeros((H, W, 4), np.float32)
    for (x, y), arr in layout:
        h, w = arr.shape[:2]
        p = rounded(arr, radius)
        a = p[..., 3:]
        canvas[y:y + h, x:x + w, :3] = p[..., :3] * a + canvas[y:y + h, x:x + w, :3] * (1 - a)
        canvas[y:y + h, x:x + w, 3:] = a + canvas[y:y + h, x:x + w, 3:] * (1 - a)
    rgb_ = np.where(canvas[..., 3:] > 0, canvas[..., :3] / np.maximum(canvas[..., 3:], 1e-6) * np.minimum(canvas[..., 3:] * 0 + 1, 1), 0)
    return Image.fromarray((np.clip(np.concatenate([rgb_, canvas[..., 3:]], -1), 0, 1) * 255).astype(np.uint8), 'RGBA')


def save(im, base, limit=120_000):
    path = os.path.join(OUT, base + '.webp')
    q = 88
    while True:
        im.save(path, 'WEBP', quality=q, method=6, alpha_quality=100)
        if os.path.getsize(path) < limit or q <= 40:
            break
        q -= 3
    res = dict(file=path, bytes=os.path.getsize(path), quality=q, size=list(im.size))
    try:
        ap = os.path.join(OUT, base + '.avif')
        aq = 70
        while True:
            im.save(ap, 'AVIF', quality=aq)
            if os.path.getsize(ap) < limit * 0.8 or aq <= 30:
                break
            aq -= 5
        res['avif'] = dict(file=ap, bytes=os.path.getsize(ap), quality=aq)
    except Exception as e:
        res['avif'] = f'skipped: {e}'
    im.save(os.path.join(WORK, base + '.png'))
    for disp in (343, 375, 1200, 1280):
        if disp <= im.size[0] * 1.0:
            sm = im.resize((disp, round(im.size[1] * disp / im.size[0])), Image.LANCZOS)
            bgp = Image.new('RGBA', sm.size, (0x0F, 0x11, 0x15, 255))
            bgp.alpha_composite(sm)
            bgp.convert('RGB').save(os.path.join(WORK, f'view_{base}_{disp}.png'))
    return res


GAP, RAD = 10, 14
STRIP_BOX = (0, 520, 780, 1170)
sw = dict(img=300, masks=300, table=320, score=300, volcano=340)
SH = 400
STACK_BOX = (0, 520, 650, 1170)
SQ = 395
TH = 330

table_cols = ['object_label', 'cell_area', 'cell_perimeter', 'cell_eccentricity', 'cell_solidity',
              'cell_feret_diameter_max', 'cell_channel_1_mean_intensity']
strip_box_cells = [int(i) for i in np.unique(crop(cells, STRIP_BOX)) if i]
order = sorted(strip_box_cells, key=lambda i: -int((crop(cells, STRIP_BOX) == i).sum()))
pick = sorted(set([9] + [o for o in order if o != 9][:2]))

p_raw = raw_panel(STRIP_BOX, (sw['img'], SH))
p_mask = mask_panel(STRIP_BOX, (sw['masks'], SH), 2)
p_tab, fs_strip = table_panel(pick, table_cols, (sw['table'], SH), 'twoline', 22)
p_score, ids_strip = score_panel(STRIP_BOX, (sw['score'], SH), 2, 10, 16)
p_volc, vinfo = volcano_panel((sw['volcano'], SH), 17, 19, 60)
x = 0
lay = []
for k, arr in (('img', p_raw), ('masks', p_mask), ('table', p_tab), ('score', p_score), ('volcano', p_volc)):
    lay.append(((x, 0), arr))
    x += arr.shape[1] + GAP
strip = compose(lay, x - GAP, SH, RAD)
r_strip = save(strip, 'overview-strip')

stack_pick = sorted(set([9] + [o for o in order if o != 9][:3]))
stack_cols = ['object_label', 'cell_area', 'cell_perimeter', 'cell_solidity']
q_raw = raw_panel(STACK_BOX, (SQ, SQ))
q_mask = mask_panel(STACK_BOX, (SQ, SQ), 2)
q_tab, fs_stack = table_panel(stack_pick, stack_cols, (2 * SQ + GAP, TH), 'wide', 34)
q_score, ids_stack = score_panel(STACK_BOX, (SQ, SQ), 2, 13, 25)
q_volc, _ = volcano_panel((SQ, SQ), 27, 30, 110)
SW = 2 * SQ + GAP
lay = [((0, 0), q_raw), ((SQ + GAP, 0), q_mask), ((0, SQ + GAP), q_tab),
       ((0, SQ + 2 * GAP + TH), q_score), ((SQ + GAP, SQ + 2 * GAP + TH), q_volc)]
stack = compose(lay, SW, 2 * SQ + TH + 2 * GAP, RAD)
r_stack = save(stack, 'overview-stack')

for bgc, name in (((0x0F, 0x11, 0x15), 'dark'), ((255, 255, 255), 'light')):
    for im, base in ((strip, 'strip'), (stack, 'stack')):
        b = Image.new('RGBA', (im.size[0] + 40, im.size[1] + 40), bgc + (255,))
        b.alpha_composite(im, (20, 20))
        b.convert('RGB').save(os.path.join(WORK, f'preview_{base}_{name}.png'))

info = dict(strip=r_strip, stack=r_stack, strip_box_in_window=STRIP_BOX, stack_box_in_window=STACK_BOX,
            window_in_canvas=WIN, table_objects_strip=pick, table_objects_stack=stack_pick,
            table_cols_strip=table_cols, table_cols_stack=stack_cols, table_font_px=dict(strip=fs_strip, stack=fs_stack),
            score_objects_strip=ids_strip, score_objects_stack=ids_stack,
            pred_strip={int(i): round(float(pred[i]), 4) for i in ids_strip if i in pred.index},
            table_rows={int(o): {c: float(celltab.loc[o, c]) for c in table_cols if c != 'object_label'} for o in sorted(set(pick) | set(stack_pick))},
            nucleus_objects_strip=int(len(np.unique(crop(nuc, STRIP_BOX))) - 1),
            pathogen_objects_strip=int(len(np.unique(crop(pat, STRIP_BOX))) - 1),
            cells_strip=len(ids_strip), cells_stack=len(ids_stack), volcano=vinfo)
json.dump(info, open(os.path.join(WORK, 'build_info.json'), 'w'), indent=1, default=str)
print(json.dumps(info, indent=1, default=str))
