"""Draws raumo's app icons (a cube in the corners of a viewfinder, orange to yellow, on a dark tile) and the link-preview picture (a room
made of coloured points) with Pillow.

    python scripts/make_raumo_icons.py

Writes static/img/raumo-icon.svg, raumo-{180,192,512,512-maskable}.png and raumo-og.png. The cube and the corners use the same shapes
as the logo in static/js/raumo-ui.js (a 48 x 48 grid), so every icon of the app looks the same.
"""
import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
FONT = os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")
ORANGE, YELLOW, NIGHT, TILE = (255, 138, 31), (255, 207, 58), (12, 13, 16), (21, 23, 28)
SUPER = 4

BRACKETS = [[(6, 15), (6, 9), (9, 6), (15, 6)], [(33, 6), (39, 6), (42, 9), (42, 15)], [(42, 33), (42, 39), (39, 42), (33, 42)], [(15, 42), (9, 42), (6, 39), (6, 33)]]
CUBE = [(24, 13), (33.5, 18.3), (33.5, 28.9), (24, 34.3), (14.5, 28.9), (14.5, 18.3)]
EDGES = [[(24, 23.6), (33.5, 18.3)], [(24, 23.6), (24, 34.3)], [(24, 23.6), (14.5, 18.3)]]


def gradient(size):
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(round(ORANGE[k] + (YELLOW[k] - ORANGE[k]) * t) for k in range(3))
    return image


def mark(size, scale):
    """The brackets and the cube on a transparent square of `size` pixels; the 48-unit drawing is `scale` of its width."""
    big = size * SUPER
    unit = big * scale / 48
    offset = (big - 48 * unit) / 2
    at = lambda p: (offset + p[0] * unit, offset + p[1] * unit)
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    width = round(3.4 * unit)
    for line in BRACKETS:
        pts = [at(p) for p in line]
        draw.line(pts, fill=255, width=width, joint="curve")
        for px, py in (pts[0], pts[-1]):
            r = width / 2
            draw.ellipse([px - r, py - r, px + r, py + r], fill=255)
    draw.polygon([at(p) for p in CUBE], fill=255)
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    layer.paste(gradient(big), (0, 0), mask)
    ink = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    idraw = ImageDraw.Draw(ink)
    for line in EDGES:
        pts = [at(p) for p in line]
        idraw.line(pts, fill=(26, 18, 4, 140), width=round(2 * unit))
        for px, py in pts:
            r = unit
            idraw.ellipse([px - r, py - r, px + r, py + r], fill=(26, 18, 4, 140))
    layer.alpha_composite(ink)
    return layer


def icon(size, mode):
    """mode: 'tile' (rounded dark tile, see-through corners), 'square' (edge to edge) or 'maskable' (edge to edge, mark smaller)."""
    big = size * SUPER
    base = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if mode == "tile":
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([big * 0.04, big * 0.04, big * 0.96, big * 0.96], radius=big * 0.24, fill=255)
        base.paste(Image.new("RGBA", (big, big), TILE + (255,)), (0, 0), mask)
    else:
        base.paste(Image.new("RGBA", (big, big), TILE + (255,)), (0, 0))
    base.alpha_composite(mark(size, 0.62 if mode == "maskable" else 0.72))
    return base.resize((size, size), Image.LANCZOS)


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    try:
        face.set_variation_by_axes([weight])
    except Exception:
        pass
    return face


def og_image():
    """A room made of points, seen from a corner, and the name."""
    width, height = 1200, 630
    image = Image.new("RGBA", (width, height), NIGHT + (255,))
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([620, 60, 1320, 640], fill=(255, 150, 40, 70))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    draw = ImageDraw.Draw(image)
    rng = random.Random(7)
    cx, cy, f = 880, 340, 640.0
    yaw, pitch, dist = math.radians(38), math.radians(17), 8.2

    def project(x, y, z):
        x, z = x * math.cos(yaw) - z * math.sin(yaw), x * math.sin(yaw) + z * math.cos(yaw)
        y, z = y * math.cos(pitch) - z * math.sin(pitch), y * math.sin(pitch) + z * math.cos(pitch)
        z += dist
        return cx + f * x / z, cy - f * y / z, z

    colors = [(0.92, 0.88, 0.8), (0.74, 0.84, 0.92), (0.92, 0.76, 0.8), (0.78, 0.9, 0.78)]
    step = 0.075
    W, D, H = 4.6, 3.7, 2.6
    nx, nz, ny = int(W / step), int(D / step), int(H / step)
    groups = []
    groups.append([((i * step - W / 2, j * step, -D / 2), colors[0]) for i in range(nx) for j in range(ny)])
    groups.append([((i * step - W / 2, j * step, D / 2), colors[2]) for i in range(nx) for j in range(ny)])
    groups.append([((-W / 2, j * step, k * step - D / 2), colors[3]) for k in range(nz) for j in range(ny)])
    groups.append([((W / 2, j * step, k * step - D / 2), colors[1]) for k in range(nz) for j in range(ny)])
    # the two walls nearest to the viewer are left out, so that one looks into the room
    def depth_of(group):
        return sum(project(x, y - 1.2, z)[2] for (x, y, z), _ in group[:: max(1, len(group) // 40)]) / max(1, len(group[:: max(1, len(group) // 40)]))
    far = sorted(groups, key=depth_of, reverse=True)[:2]
    points = [p for group in far for p in group]
    for i in range(nx):
        for k in range(nz):
            wood = 0.72 + 0.12 * ((int(k * step * 7) % 2))
            points.append(((i * step - W / 2, 0, k * step - D / 2), (wood, wood * 0.78, wood * 0.52)))
    for i in range(0, nx, 2):                                   # a sofa and a table as small blocks of points
        for k in range(0, 14, 2):
            for j in range(0, 8, 2):
                points.append(((i * step - 1.1 + 0.4, j * step, -D / 2 + 0.3 + k * step * 0.7), (0.62, 0.3, 0.26)) if 0.6 < i * step < 2.0 else ((0, -9, 0), (0, 0, 0)))
    projected = []
    for (x, y, z), color in points:
        sx, sy, depth = project(x, y - 1.2, z)
        shade = 0.45 + 0.55 * (1 - (depth - (dist - 3)) / 6)
        projected.append((depth, sx, sy, tuple(int(255 * c * max(0.3, min(1.1, shade))) for c in color)))
    projected.sort(reverse=True)
    for depth, sx, sy, color in projected:
        if rng.random() < 0.9:
            r = 3.0 * 8.2 / depth
            draw.ellipse([sx - r, sy - r, sx + r, sy + r], fill=color + (235,))
    logo = mark(120, 0.92).resize((120, 120), Image.LANCZOS)
    image.alpha_composite(logo, (86, 96))
    draw.text((84, 190), "raumo", font=font(190, 900), fill=(255, 255, 255, 255))
    draw.text((92, 430), "Durch den Raum gehen.", font=font(50, 800), fill=(255, 255, 255, 255))
    draw.text((92, 495), "Scannen. Punkte ansehen.", font=font(50, 800), fill=(255, 190, 70, 255))
    return image.convert("RGB")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ffcf3a"/></linearGradient></defs>
  <rect x="1" y="1" width="46" height="46" rx="11" fill="#15171c"/>
  <path d="M10 18v-5a3 3 0 013-3h5M30 10h5a3 3 0 013 3v5M38 30v5a3 3 0 01-3 3h-5M18 38h-5a3 3 0 01-3-3v-5" fill="none" stroke="url(#g)" stroke-width="2.6" stroke-linecap="round"/>
  <path d="M24 15.500l7.200 4v8l-7.200 4-7.200-4v-8z" fill="url(#g)"/><path d="M24 23.500l7.200-4M24 23.500v8M24 23.500l-7.200-4" fill="none" stroke="#1a1204" stroke-width="1.500" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "raumo-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(SVG)
    icon(180, "square").convert("RGB").save(os.path.join(OUT, "raumo-180.png"), optimize=True)
    icon(192, "tile").save(os.path.join(OUT, "raumo-192.png"), optimize=True)
    icon(512, "tile").save(os.path.join(OUT, "raumo-512.png"), optimize=True)
    icon(512, "maskable").convert("RGB").save(os.path.join(OUT, "raumo-512-maskable.png"), optimize=True)
    og_image().save(os.path.join(OUT, "raumo-og.png"), optimize=True)
    print("written to", OUT)


if __name__ == "__main__":
    main()
