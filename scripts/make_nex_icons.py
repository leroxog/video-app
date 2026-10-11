"""Draws the app icons of Nex Ai (the hexagon of nodes on a dark tile, the mark of Nex) and the link-preview picture with Pillow.

    python scripts/make_nex_icons.py

Writes static/img/nex-icon.svg, nex-{180,192,512,512-maskable}.png and nex-og.png.  The mark uses the same shapes as the logo in
static/js/regal-ui.js (a 100 x 100 grid), so every icon of the site looks the same.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
TILE, NIGHT = (47, 47, 47), (33, 33, 33)
SUPER = 4
# the title is set in Inter (the font of the site) when Pillow can read the font file, else in a bold sans-serif that the machine has
FONTS = [os.path.join(ROOT, "static", "fonts", "inter-latin-wght-normal.woff2"), "C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
VERTICES = [(50, 19), (78.6, 35.5), (78.6, 68.5), (50, 85), (21.4, 68.5), (21.4, 35.5)]


def mark(size, bleed=False, scale=1.0):
    """The mark on a transparent square of `size` pixels.  bleed: the tile fills the whole square (for icons that a phone crops)."""
    big = size * SUPER
    unit = big / 100 * scale
    offset = (big - 100 * unit) / 2
    at = lambda x, y: (offset + x * unit, offset + y * unit)
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    if bleed:
        d.rectangle([0, 0, big, big], fill=TILE + (255,))
    else:
        d.rounded_rectangle([*at(0, 0), *at(100, 100)], radius=20 * unit, fill=TILE + (255,))
    white, width = (255, 255, 255, 255), round(3 * unit)
    d.line([at(*v) for v in VERTICES + [VERTICES[0]]], fill=white, width=width, joint="curve")
    for v in VERTICES:
        d.line([at(50, 52), at(*v)], fill=white, width=width)
    for v in VERTICES:
        c, r = at(*v), 7.5 * unit
        d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=TILE + (255,), outline=white, width=width)
    c, r = at(50, 52), 4.6 * unit
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=white)
    return layer.resize((size, size), Image.LANCZOS)


def font(size):
    for path in FONTS:
        try:
            face = ImageFont.truetype(path, size)
            try:
                face.set_variation_by_axes([700])
            except Exception:
                pass
            return face
        except Exception:
            continue
    return ImageFont.load_default()


def og_image():
    width, height = 1200, 630
    image = Image.new("RGBA", (width, height), NIGHT + (255,))
    draw = ImageDraw.Draw(image)
    image.alpha_composite(mark(150), (90, 110))
    draw.text((90, 290), "Nex Ai", font=font(140), fill=(236, 236, 236, 255))
    draw.text((96, 470), "Chat mit einer KI auf deinem Computer.", font=font(44), fill=(180, 180, 180, 255))
    draw.text((96, 534), "Ohne App. Ohne Konto. Nichts wird gesendet.", font=font(34), fill=(142, 142, 160, 255))
    return image.convert("RGB")


def svg():
    nodes = "".join(f'<circle cx="{x}" cy="{y}" r="7.5"/>' for x, y in VERTICES)
    spokes = "".join(f"M50 52L{x} {y}" for x, y in VERTICES)
    hexagon = "M" + "L".join(f"{x} {y}" for x, y in VERTICES) + "Z"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect width="100" height="100" rx="20" fill="#2f2f2f"/>\n'
            f'  <g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="{hexagon}"/><path d="{spokes}"/></g>\n'
            f'  <g fill="#2f2f2f" stroke="#fff" stroke-width="3">{nodes}</g>\n  <circle cx="50" cy="52" r="4.6" fill="#fff"/>\n</svg>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "nex-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(svg())
    flat = lambda image: Image.alpha_composite(Image.new("RGBA", image.size, NIGHT + (255,)), image).convert("RGB")
    flat(mark(180)).save(os.path.join(OUT, "nex-180.png"), optimize=True)
    mark(192).save(os.path.join(OUT, "nex-192.png"), optimize=True)
    mark(512).save(os.path.join(OUT, "nex-512.png"), optimize=True)
    flat(mark(512, bleed=True, scale=0.62)).save(os.path.join(OUT, "nex-512-maskable.png"), optimize=True)
    og_image().save(os.path.join(OUT, "nex-og.png"), optimize=True)
    print("written to", OUT)


if __name__ == "__main__":
    main()
