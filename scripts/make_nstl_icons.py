"""Draws the app icons of NSTL (a small swarm of dots on a dark tile, the mark of the agent swarm) and the link-preview picture with
Pillow.

    python scripts/make_nstl_icons.py

Writes static/img/nstl-icon.svg, nstl-{180,192,512,512-maskable}.png and nstl-og.png.  The mark uses the same points as the logo in
templates/partials/_nstl_mark.html, so every icon of the site looks the same.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
TILE, NIGHT = (47, 47, 47), (33, 33, 33)
SUPER = 4
FONTS = [os.path.join(ROOT, "static", "fonts", "inter-latin-wght-normal.woff2"), "C:/Windows/Fonts/segoeuib.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
CENTER = (50, 50, 7.2)
SATELLITES = [(30, 68, 5), (74, 40, 4.2), (62, 78, 4.2), (22, 40, 4.6), (40, 24, 4.2), (78, 66, 4.6)]


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
    white, width = (255, 255, 255, 255), round(1.6 * unit)
    cx, cy, _ = CENTER
    for x, y, _ in SATELLITES:
        d.line([at(cx, cy), at(x, y)], fill=white, width=width)
    for x, y, r in SATELLITES:
        c, radius = at(x, y), r * unit
        d.ellipse([c[0] - radius, c[1] - radius, c[0] + radius, c[1] + radius], fill=white)
    c, radius = at(cx, cy), CENTER[2] * unit
    d.ellipse([c[0] - radius, c[1] - radius, c[0] + radius, c[1] + radius], fill=white)
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
    draw.text((90, 290), "NSTL", font=font(140), fill=(236, 236, 236, 255))
    draw.text((96, 470), "Ein Agentenschwarm sucht deine Antwort.", font=font(40), fill=(180, 180, 180, 255))
    draw.text((96, 534), "Ohne Anmeldung. Läuft in deinem Browser.", font=font(34), fill=(142, 142, 160, 255))
    return image.convert("RGB")


def svg():
    cx, cy, cr = CENTER
    spokes = "".join(f"M{cx} {cy}L{x} {y}" for x, y, _ in SATELLITES)
    dots = "".join(f'<circle cx="{x}" cy="{y}" r="{r}"/>' for x, y, r in SATELLITES)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect width="100" height="100" rx="20" fill="#2f2f2f"/>\n'
            f'  <g stroke="#fff" stroke-width="1.6" stroke-linecap="round"><path d="{spokes}"/></g>\n'
            f'  <g fill="#fff"><circle cx="{cx}" cy="{cy}" r="{cr}"/>{dots}</g>\n</svg>\n')


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "nstl-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(svg())
    flat = lambda image: Image.alpha_composite(Image.new("RGBA", image.size, NIGHT + (255,)), image).convert("RGB")
    flat(mark(180)).save(os.path.join(OUT, "nstl-180.png"), optimize=True)
    mark(192).save(os.path.join(OUT, "nstl-192.png"), optimize=True)
    mark(512).save(os.path.join(OUT, "nstl-512.png"), optimize=True)
    flat(mark(512, bleed=True, scale=0.62)).save(os.path.join(OUT, "nstl-512-maskable.png"), optimize=True)
    og_image().save(os.path.join(OUT, "nstl-og.png"), optimize=True)
    print("written to", OUT)


if __name__ == "__main__":
    main()
