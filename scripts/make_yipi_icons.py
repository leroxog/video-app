"""Draws yipi's app icons (a speech bubble with a "y", violet to pink) and the link-preview picture with Pillow.

    python scripts/make_yipi_icons.py

Writes static/img/yipi-icon.svg, yipi-{180,192,512,512-maskable}.png and yipi-og.png. The bubble and the "y" use the same shapes as
the logo in static/js/yipi-icons.js (a 64 x 64 grid), so every icon of the app looks the same.
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
FONT = os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")
VIOLET, PINK, WHITE, NIGHT = (139, 108, 255), (255, 79, 154), (255, 255, 255), (11, 11, 18)
SUPER = 4

BUBBLE = "M32 5C16.5 5 5 15.5 5 29.5c0 13.5 10.7 23.5 25.5 23.5 3.3 0 6.3-.5 9-1.5L53 59l-2.8-12C55.8 42.8 59 36.5 59 29.5 59 15.5 47.5 5 32 5z"
Y_STROKES = [[(20, 21), (32, 35), (44, 21)], [(32, 35), (25, 48)]]
Y_WIDTH = 7


def path_points(path, steps=24):
    """Flattens the (small) subset of SVG path commands the bubble uses: M, C, c, L, l, z."""
    tokens = re.findall(r"[MCcLlz]|-?\d*\.?\d+", path)
    points, i, command, x, y = [], 0, None, 0.0, 0.0
    while i < len(tokens):
        if re.fullmatch(r"[MCcLlz]", tokens[i]):
            command = tokens[i]
            i += 1
            if command == "z":
                continue
        if command == "M":
            x, y = float(tokens[i]), float(tokens[i + 1]); i += 2
            points.append((x, y))
            command = "L"
        elif command in ("L", "l"):
            dx, dy = float(tokens[i]), float(tokens[i + 1]); i += 2
            x, y = (dx, dy) if command == "L" else (x + dx, y + dy)
            points.append((x, y))
        elif command in ("C", "c"):
            v = [float(t) for t in tokens[i:i + 6]]; i += 6
            if command == "c":
                v = [x + v[0], y + v[1], x + v[2], y + v[3], x + v[4], y + v[5]]
            p0, p1, p2, p3 = (x, y), (v[0], v[1]), (v[2], v[3]), (v[4], v[5])
            for s in range(1, steps + 1):
                t = s / steps
                u = 1 - t
                points.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                               u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
            x, y = p3
    return points


def gradient(size):
    """A square violet-to-pink diagonal gradient."""
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for py in range(size):
        for px in range(size):
            t = (px + py) / (2 * (size - 1))
            pixels[px, py] = tuple(round(VIOLET[k] + (PINK[k] - VIOLET[k]) * t) for k in range(3))
    return image


def shape_mask(size, scale, offset, draw_shape):
    mask = Image.new("L", (size, size), 0)
    draw_shape(ImageDraw.Draw(mask), lambda p: (offset + p[0] * scale, offset + p[1] * scale), scale)
    return mask


def draw_bubble(draw, at, scale):
    draw.polygon([at(p) for p in path_points(BUBBLE)], fill=255)


def draw_y(draw, at, scale):
    for stroke in Y_STROKES:
        pts = [at(p) for p in stroke]
        draw.line(pts, fill=255, width=round(Y_WIDTH * scale), joint="curve")
        for px, py in pts:
            r = Y_WIDTH * scale / 2
            draw.ellipse([px - r, py - r, px + r, py + r], fill=255)


def mark(size, style, bubble_size):
    """The bubble with its y on a square of `size` pixels. style: 'logo' (gradient bubble, white y) or 'tile' (white bubble, gradient y)."""
    big = size * SUPER
    scale = big * bubble_size / 64
    offset = (big - 64 * scale) / 2
    bubble = shape_mask(big, scale, offset, draw_bubble)
    letter = shape_mask(big, scale, offset, draw_y)
    fill_gradient = gradient(big)
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if style == "logo":
        layer.paste(fill_gradient, (0, 0), bubble)
        layer.paste(Image.new("RGB", (big, big), WHITE), (0, 0), letter)
    else:
        layer.paste(Image.new("RGB", (big, big), WHITE), (0, 0), bubble)
        layer.paste(fill_gradient, (0, 0), letter)
    return layer


def icon(size, mode):
    """mode: 'tile' (rounded gradient tile, see-through corners), 'square' (edge to edge) or 'maskable' (edge to edge, mark smaller)."""
    big = size * SUPER
    base = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if mode == "tile":
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([big * 0.04, big * 0.04, big * 0.96, big * 0.96], radius=big * 0.24, fill=255)
        base.paste(gradient(big), (0, 0), mask)
    else:
        base.paste(gradient(big), (0, 0))
    inner = mark(size, "tile", 0.66 if mode == "maskable" else 0.74)
    base.alpha_composite(inner)
    return base.resize((size, size), Image.LANCZOS)


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    try:
        face.set_variation_by_axes([weight])
    except Exception:
        pass
    return face


def og_image():
    width, height = 1200, 630
    image = gradient(1200).crop((0, 0, width, height)).resize((width, height))
    shade = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(shade).ellipse([-260, 330, 520, 1110], fill=(255, 255, 255, 30))
    ImageDraw.Draw(shade).ellipse([820, -300, 1500, 380], fill=(255, 255, 255, 30))
    image = Image.alpha_composite(image.convert("RGBA"), shade)
    draw = ImageDraw.Draw(image)
    draw.text((90, 130), "yipi", font=font(230, 900), fill=WHITE)
    draw.text((96, 405), "Sag, was dich bewegt.", font=font(62, 800), fill=WHITE)
    draw.text((96, 485), "Kurze Yips, Antworten, Reposts und Likes.", font=font(36, 700), fill=(255, 255, 255, 215))
    logo = mark(400, "tile", 0.92).resize((400, 400), Image.LANCZOS)
    image.alpha_composite(logo, (740, 115))
    return image.convert("RGB")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b6cff"/><stop offset="1" stop-color="#ff4f9a"/></linearGradient></defs>
  <path d="{bubble}" fill="url(#g)"/>
  <path d="M20 21l12 14 12-14M32 35l-7 13" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "yipi-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(SVG.format(bubble=BUBBLE))
    icon(180, "square").convert("RGB").save(os.path.join(OUT, "yipi-180.png"), optimize=True)
    icon(192, "tile").save(os.path.join(OUT, "yipi-192.png"), optimize=True)
    icon(512, "tile").save(os.path.join(OUT, "yipi-512.png"), optimize=True)
    icon(512, "maskable").convert("RGB").save(os.path.join(OUT, "yipi-512-maskable.png"), optimize=True)
    og_image().save(os.path.join(OUT, "yipi-og.png"), optimize=True)
    print("written to", OUT)


if __name__ == "__main__":
    main()
