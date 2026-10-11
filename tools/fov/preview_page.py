"""Simulate the page at 1280 px and 375 px wide in both themes (display-size check)."""
from PIL import Image
from common import R, THEMES
O = f"{R}/out"


def fit(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


for th in ("dark", "light"):
    bg = THEMES[th]["bg"]
    pipe = [Image.open(f"{O}/pipeline/{k}.{th}.webp").convert("RGB") for k in
            ("01_raw", "02_masks", "03_measurements", "04_classification", "05_screen_hit")]
    strip = Image.open(f"{O}/spacr/overview-strip.{th}.webp").convert("RGB")
    rec = Image.open(f"{O}/spacr/recruitment-field.{th}.webp").convert("RGB")
    W = 1280
    pw = 325
    page = Image.new("RGB", (W, 1100), bg)
    page.paste(fit(strip, 1040), (120, 20))
    for i, im in enumerate(pipe):
        page.paste(fit(im, pw), (120 + (i % 3) * (pw + 32), 330 + (i // 3) * 280))
    page.paste(fit(rec, 504), (120, 900))
    page.save(f"{R}/preview/page1280_{th}.png")
    stack = Image.open(f"{O}/spacr/overview-stack.{th}.webp").convert("RGB")
    ph = Image.new("RGB", (375, 1600), bg)
    y = 16
    s = fit(stack, 343); ph.paste(s, (16, y)); y += s.height + 24
    for im in pipe[:3]:
        s = fit(im, 343); ph.paste(s, (16, y)); y += s.height + 16
    s = fit(rec, 343); ph.paste(s, (16, min(y, 1500)))
    ph.save(f"{R}/preview/page375_{th}.png")
