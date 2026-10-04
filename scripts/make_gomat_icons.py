"""Draws gomat's app icons (a monkey face on a blue tile) and the link-preview picture with Pillow.

    python scripts/make_gomat_icons.py

Writes static/img/gomat-{180,192,512,512-maskable}.png and gomat-og.png. The face uses the same shapes as the
logo in static/js/gomat.js (a 24 x 24 grid), so every icon of the app looks the same.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
FONT = os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")
BLUE, BLUE_DARK, WHITE, MASK, INK = "#1cb0f6", "#1899d6", "#ffffff", "#cdeeff", "#1f3a4d"
SUPER = 4


def draw_face(draw, cx, cy, unit):
    """The monkey face on a 24-unit grid centred at (cx, cy); `unit` is the size of one grid unit in pixels."""
    def at(x, y):
        return cx + (x - 12) * unit, cy + (y - 12) * unit

    def circle(x, y, r, fill):
        (px, py) = at(x, y)
        draw.ellipse([px - r * unit, py - r * unit, px + r * unit, py + r * unit], fill=fill)

    circle(6, 11.2, 2.7, WHITE)
    circle(18, 11.2, 2.7, WHITE)
    circle(12, 12.4, 6.4, WHITE)
    (px, py) = at(12, 14.2)
    draw.ellipse([px - 4.2 * unit, py - 3.6 * unit, px + 4.2 * unit, py + 3.6 * unit], fill=MASK)
    circle(9.9, 11.2, 1, INK)
    circle(14.1, 11.2, 1, INK)
    (sx, sy) = at(12, 14.4)
    draw.arc([sx - 1.9 * unit, sy - 1.7 * unit, sx + 1.9 * unit, sy + 1.5 * unit], 20, 160, fill=INK, width=max(2, int(unit * 1.0)))


def icon(size, mode):
    """mode: 'tile' (rounded, see-through corners), 'square' (edge to edge) or 'maskable' (edge to edge, face smaller)."""
    big = size * SUPER
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if mode == "tile":
        draw.rounded_rectangle([big * 1.5 / 24, big * 1.5 / 24, big * 22.5 / 24, big * 22.5 / 24], radius=big * 6.5 / 24, fill=BLUE)
        unit = big / 24
    else:
        draw.rectangle([0, 0, big, big], fill=BLUE)
        unit = big / 24 * (0.72 if mode == "maskable" else 0.92)
    draw_face(draw, big / 2, big / 2, unit)
    return image.resize((size, size), Image.LANCZOS)


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    try:
        face.set_variation_by_axes([weight])
    except Exception:
        pass
    return face


def og_image():
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), BLUE_DARK)
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, width, height], fill=BLUE)
    draw.ellipse([-220, 330, 520, 1070], fill="#35bbf8")
    draw.ellipse([800, -260, 1420, 360], fill="#35bbf8")
    draw.text((90, 150), "gomat", font=font(210, 900), fill=WHITE)
    draw.text((96, 395), "Mathe lernen,", font=font(62, 800), fill=WHITE)
    draw.text((96, 470), "Schritt für Schritt", font=font(62, 800), fill=WHITE)
    tile = icon(380, "tile")
    ring = Image.new("RGBA", (380, 380), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle([17, 17, 363, 363], radius=108, outline=WHITE, width=10)
    image.paste(tile, (750, 125), tile)
    image.paste(ring, (750, 125), ring)
    return image


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, size, mode in (("gomat-180.png", 180, "square"), ("gomat-192.png", 192, "tile"), ("gomat-512.png", 512, "tile"), ("gomat-512-maskable.png", 512, "maskable")):
        icon(size, mode).save(os.path.join(OUT, name), optimize=True)
        print("wrote", name)
    og_image().save(os.path.join(OUT, "gomat-og.png"), optimize=True)
    print("wrote gomat-og.png")
