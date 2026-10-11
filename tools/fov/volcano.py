"""Gene-level volcano of the GFP-TSG101 example screen regression, themed for the page."""
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from PIL import Image
from common import THEMES, FONT

RESULTS = "/mnt/wd4tb/scratch/n687v3/ols/run/screen4/results/ols/results_gene.csv"
HIT = "#FF8A3D"
SIG = "#FF8A3D"
P_FLOOR_LOG = 7.0
X_CAP = 2.0


def load():
    r = pd.read_csv(RESULTS, dtype={"gene": str})
    r["nlp"] = -np.log10(r["p_value"].clip(lower=1e-300))
    return r


def facts():
    r = load()
    g = r[r.gene == "239740"].iloc[0]
    sig = r[r.q_value < 0.05]
    return {"n_genes": int(len(r)), "n_significant_q05": int(len(sig)),
            "significant": [{"gene": x.gene, "gene_name": None if pd.isna(x.gene_name) else x.gene_name,
                             "coefficient": round(float(x.coefficient), 3), "p_value": float(x.p_value),
                             "q_value": float(x.q_value), "condition": x.condition} for x in sig.itertuples()],
            "hit": {"gene": "TGGT1_239740", "name": "GRA14", "coefficient": round(float(g.coefficient), 3),
                    "p_value_reported": float(g.p_value), "q_value": float(g.q_value), "n_cells_gene": int(g.n_gene)},
            "y_cap": P_FLOOR_LOG}


def render(theme, w, h, dpi=100, tick_px=15, label_px=19, pad=None, hit=HIT):
    t = THEMES[theme]
    hexc = lambda c: "#%02x%02x%02x" % c
    font_manager.fontManager.addfont(FONT)
    fam = font_manager.FontProperties(fname=FONT).get_name()
    plt.rcParams.update({"font.family": fam, "font.size": tick_px * 72 / dpi})
    r = load()
    fig = plt.figure(figsize=(w / dpi, h / dpi), dpi=dpi, facecolor=hexc(t["bg"]))
    ax = fig.add_axes(pad or [0.13, 0.11, 0.83, 0.85])
    ax.set_facecolor(hexc(t["bg"]))
    y = r["nlp"].clip(upper=P_FLOOR_LOG)
    off = r["nlp"] > P_FLOOR_LOG
    sig = r["q_value"] < 0.05
    ax.axhline(-np.log10(0.05), color=hexc(t["faint"]), lw=max(1.0, tick_px / 16), ls=(0, (3, 3)), zorder=1)
    ax.axvline(0, color=hexc(t["grid"]), lw=max(1.0, tick_px / 16), zorder=1)
    x = r.coefficient.clip(-X_CAP, X_CAP)
    xin = r.coefficient.abs() <= X_CAP
    ms = (tick_px * 0.42) ** 2
    for m, mk in ((xin, "o"), (r.coefficient < -X_CAP, "<"), (r.coefficient > X_CAP, ">")):
        k = m & ~sig
        ax.scatter(x[k], y[k], s=ms, c=hexc(t["faint"]), alpha=0.6, marker=mk, linewidths=0, zorder=2, clip_on=False)
    k = sig & ~off & xin
    ax.scatter(x[k], y[k], s=ms * 1.5, c=hit, linewidths=0, zorder=3)
    g = r[r.gene == "239740"].iloc[0]
    gy = min(g.nlp, P_FLOOR_LOG)
    ax.scatter([g.coefficient], [gy], s=ms * 2.6, c=hit, marker="^" if g.nlp > P_FLOOR_LOG else "o",
               linewidths=0, zorder=5, clip_on=False)
    ax.annotate("GRA14", (g.coefficient, gy), xytext=(-label_px * 0.55, -label_px * 0.1), textcoords="offset points", ha="right", va="top",
                fontsize=label_px * 72 / dpi, color=hexc(t["fg"]), zorder=6)
    ax.set_ylim(0, P_FLOOR_LOG * 1.04)
    ax.set_xlim(-X_CAP - 0.08, X_CAP + 0.08)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(hexc(t["fg"]))
        ax.spines[s].set_linewidth(max(1.0, tick_px / 14))
    ax.tick_params(colors=hexc(t["fg"]), labelcolor=hexc(t["fg"]), width=max(1.0, tick_px / 14), length=tick_px / 3,
                   labelsize=tick_px * 72 / dpi)
    ax.yaxis.set_major_locator(matplotlib.ticker.MultipleLocator(2))
    ax.xaxis.set_major_locator(matplotlib.ticker.MultipleLocator(1))
    fig.canvas.draw()
    im = Image.frombuffer("RGBA", fig.canvas.get_width_height(), fig.canvas.buffer_rgba()).convert("RGB")
    plt.close(fig)
    return im


if __name__ == "__main__":
    import sys
    from common import R
    for th in ("dark", "light"):
        render(th, 800, 600, tick_px=30, label_px=38, pad=[0.12, 0.13, 0.84, 0.82]).save(f"{R}/preview/volcano_{th}.png")
    print(facts())
