#!/usr/bin/env python3
"""
Rebuild ConsultUro app icon assets from the original icon artwork.

Problems being fixed (user report 2026-06-11):
  1. icon.png had a WHITE margin + baked rounded corners around the blue
     tile -> iOS / launchers showed white edges ("unnecessary border").
  2. adaptive-icon.png foreground contained that same white-margined
     image -> Android adaptive icon = teal circle + white ring + tile
     (double border), with the kidney artwork right at the mask edge
     (sides visibly cut on circular masks).
  3. splash-icon.png was the same white-margined square -> splash showed
     a white-cornered box instead of the app icon.

Outputs (all 1024x1024):
  assets/icon.png         - full-bleed cleaned tile (no white, no baked
                            corners). iOS applies its own mask.
  assets/adaptive-icon.png- ARTWORK ONLY (kidneys/cross/tube) on
                            transparency, scaled into the adaptive safe
                            zone so no mask shape ever cuts it.
  assets/adaptive-bg.png  - full-bleed vertical gradient matching the
                            tile background -> the launcher mask is
                            100% filled, seamless, no border.
  assets/splash-icon.png  - the new icon with iOS-style rounded corners
                            on transparency -> splash literally shows
                            the app icon.

Originals preserved in assets-backup/.
"""
from PIL import Image, ImageDraw, ImageFilter
import os
import shutil
import statistics

ASSETS = os.path.join(os.path.dirname(__file__), "..", "assets")
BACKUP = os.path.join(os.path.dirname(__file__), "..", "assets-backup")
SIZE = 1024


def near_white(p, t=215):
    return p[0] > t and p[1] > t and p[2] > t


def is_tile_color(p):
    """True for the tile's own pixels: saturated blue bg or red kidney.
    Excludes the white margin AND the soft grey drop-shadow."""
    r, g, b = p[:3]
    return (b - r > 25) or (r - g > 60)


def main():
    os.makedirs(BACKUP, exist_ok=True)
    for n in ("icon.png", "adaptive-icon.png", "splash-icon.png"):
        src = os.path.join(ASSETS, n)
        dst = os.path.join(BACKUP, n)
        if os.path.exists(src) and not os.path.exists(dst):
            shutil.copy2(src, dst)

    im = Image.open(os.path.join(BACKUP, "icon.png")).convert("RGB")
    W, H = im.size
    px = im.load()

    # ── 1. Find the blue tile bounding box (ignore margin + shadow) ──
    xs, ys = [], []
    step = 4
    for y in range(0, H, step):
        for x in range(0, W, step):
            if is_tile_color(px[x, y]):
                xs.append(x)
                ys.append(y)
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    tile = im.crop((x0, y0, x1 + 1, y1 + 1))
    tw, th = tile.size
    print(f"tile bbox: ({x0},{y0})-({x1},{y1}) size {tw}x{th}")

    # ── 2. Repaint white/shadow rounded-corner remnants row by row ───
    tp = tile.load()
    max_run = int(tw * 0.45)
    for y in range(th):
        # left edge
        run = 0
        while run < max_run and not is_tile_color(tp[run, y]):
            run += 1
        if 0 < run < max_run:
            src_x = min(run + 8, tw - 1)
            c = tp[src_x, y]
            for x in range(run + 2):
                tp[x, y] = c
        # right edge
        run = 0
        while run < max_run and not is_tile_color(tp[tw - 1 - run, y]):
            run += 1
        if 0 < run < max_run:
            src_x = max(tw - 1 - run - 8, 0)
            c = tp[src_x, y]
            for x in range(run + 2):
                tp[tw - 1 - x, y] = c

    clean = tile.resize((SIZE, SIZE), Image.LANCZOS)
    clean.save(os.path.join(ASSETS, "icon.png"))
    print("icon.png written (full-bleed, no white margin)")

    # ── 3. Per-row background gradient of the tile ────────────────────
    cp = clean.load()
    row_bg = []
    prev = None
    for y in range(SIZE):
        samples = []
        for x in list(range(12, 70, 6)) + list(range(SIZE - 70, SIZE - 12, 6)):
            p = cp[x, y]
            if is_tile_color(p) and not (p[0] - p[1] > 60):  # blue only
                samples.append(p)
        if samples:
            c = tuple(int(statistics.median(s[i] for s in samples)) for i in range(3))
            prev = c
        row_bg.append(prev if prev else (84, 155, 175))
    # backfill leading Nones
    first = next(c for c in row_bg if c)
    row_bg = [c if c else first for c in row_bg]

    strip = Image.new("RGB", (1, SIZE))
    sp = strip.load()
    for y in range(SIZE):
        sp[0, y] = row_bg[y]
    bg = strip.resize((SIZE, SIZE), Image.LANCZOS)
    bg.save(os.path.join(ASSETS, "adaptive-bg.png"))
    print("adaptive-bg.png written (full-bleed gradient)")

    # ── 4. Extract artwork by colour type: the kidneys are red, the
    # tube/cross/circles are white-grey; the tile bg is saturated blue.
    # Soft scores give feathered (anti-aliased) edges.
    def clamp01(v):
        return 0.0 if v < 0 else (1.0 if v > 1 else v)

    art = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ap = art.load()
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b = cp[x, y]
            red_score = clamp01((r - g - 30) / 40)
            balance = max(r, g, b) - min(r, g, b)
            white_score = clamp01((min(r, g, b) - 170) / 40) * clamp01((80 - balance) / 40)
            a = int(255 * max(red_score, white_score))
            if a > 10:
                ap[x, y] = (r, g, b, a)

    # Density-based bbox — ignore isolated stray pixels (AA noise at
    # tile edges) that would otherwise inflate the bbox to full canvas.
    col_counts = [0] * SIZE
    row_counts = [0] * SIZE
    for y in range(SIZE):
        for x in range(SIZE):
            if ap[x, y][3] > 40:
                col_counts[x] += 1
                row_counts[y] += 1
    MIN_PX = 4
    bx0 = next(i for i, c in enumerate(col_counts) if c >= MIN_PX)
    bx1 = next(i for i in range(SIZE - 1, -1, -1) if col_counts[i] >= MIN_PX)
    by0 = next(i for i, c in enumerate(row_counts) if c >= MIN_PX)
    by1 = next(i for i in range(SIZE - 1, -1, -1) if row_counts[i] >= MIN_PX)
    abox = (bx0, by0, bx1 + 1, by1 + 1)
    art_c = art.crop(abox)
    aw, ah = art_c.size
    print(f"artwork bbox {abox} size {aw}x{ah}")

    # Scale artwork so EVERY pixel sits inside the adaptive-icon SAFE
    # ZONE — a 66dp circle on the 108dp canvas (61.1% => 313px radius
    # at 1024). This guarantees no launcher mask (circle, squircle,
    # rounded square) ever cuts the kidneys/cross.
    acp = art_c.load()
    ccx, ccy = aw / 2, ah / 2
    r_max = 1.0
    for y in range(0, ah, 2):
        for x in range(0, aw, 2):
            if acp[x, y][3] > 40:
                d = ((x - ccx) ** 2 + (y - ccy) ** 2) ** 0.5
                if d > r_max:
                    r_max = d
    R_SAFE = SIZE * 0.611 / 2 - 3  # small AA margin
    scale = R_SAFE / r_max
    art_s = art_c.resize((int(aw * scale), int(ah * scale)), Image.LANCZOS)
    print(f"artwork r_max={r_max:.0f}px scale={scale:.3f} -> {art_s.size}")
    fg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    fg.paste(art_s, ((SIZE - art_s.width) // 2, (SIZE - art_s.height) // 2), art_s)
    fg.save(os.path.join(ASSETS, "adaptive-icon.png"))
    print("adaptive-icon.png written (artwork-only foreground)")

    # ── 5. Splash icon = the app icon with iOS-style rounded corners ──
    mask = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    radius = int(SIZE * 0.225)
    d.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=radius, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1))
    splash = clean.convert("RGBA")
    splash.putalpha(mask)
    splash.save(os.path.join(ASSETS, "splash-icon.png"))
    print("splash-icon.png written (rounded app icon on transparency)")

    # Mid-gradient color for android.adaptiveIcon.backgroundColor fallback
    mid = row_bg[SIZE // 2]
    print("suggested backgroundColor: #%02X%02X%02X" % mid)


if __name__ == "__main__":
    main()
