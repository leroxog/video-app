"""Draws KI-Regal's app icons (a shelf with three boxes on a violet-to-pink tile) and the link-preview picture with Pillow.

    python scripts/make_regal_icons.py

Writes static/img/regal-icon.svg, regal-{180,192,512,512-maskable}.png and regal-og.png.  The shelf uses the same shapes as the logo
in static/js/regal-ui.js (a 48 x 48 grid), so every icon of the site looks the same.
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
FONT = os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")
VIOLET, PINK, NIGHT, PANEL = (139, 92, 246), (236, 72, 153), (11, 14, 20), (25, 32, 46)
SUPER = 4


def gradient(size, start=VIOLET, end=PINK):
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(round(start[k] + (end[k] - start[k]) * t) for k in range(3))
    return image


def logo(size, bleed=False, scale=1.0):
    """The logo on a transparent square of `size` pixels.  bleed: the tile fills the whole square (for icons that a phone crops)."""
    big = size * SUPER
    unit = big / 48 * scale
    offset = (big - 48 * unit) / 2
    at = lambda x, y: (offset + x * unit, offset + y * unit)
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    if bleed:
        draw.rectangle([0, 0, big, big], fill=255)
    else:
        draw.rounded_rectangle([*at(2, 2), *at(46, 46)], radius=12 * unit, fill=255)
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    layer.paste(gradient(big), (0, 0), mask)
    ink = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(ink)
    d.rounded_rectangle([*at(9, 12), *at(18, 25)], radius=2 * unit, fill=(255, 255, 255, 255))
    d.rounded_rectangle([*at(20, 8), *at(29, 25)], radius=2 * unit, fill=(255, 255, 255, 230))
    d.rounded_rectangle([*at(31, 14), *at(39, 25)], radius=2 * unit, fill=(255, 255, 255, 205))
    for line in (((7, 28), (41, 28)), ((10, 28), (10, 38)), ((38, 28), (38, 38))):
        d.line([at(*line[0]), at(*line[1])], fill=(255, 255, 255, 255), width=round(3 * unit))
        for p in line:
            c = at(*p)
            d.ellipse([c[0] - 1.5 * unit, c[1] - 1.5 * unit, c[0] + 1.5 * unit, c[1] + 1.5 * unit], fill=(255, 255, 255, 255))
    layer.alpha_composite(ink)
    return layer.resize((size, size), Image.LANCZOS)


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    try:
        face.set_variation_by_axes([weight])
    except Exception:
        pass
    return face


def og_image():
    width, height = 1200, 630
    image = Image.new("RGBA", (width, height), NIGHT + (255,))
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([560, -40, 1300, 560], fill=(150, 80, 240, 80))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(100)))
    draw = ImageDraw.Draw(image)
    # a few cards of the list, the way the page shows them
    cards = [("Chat", "Llama 3.2 3B Instruct", "2,0 GB", (251, 191, 36), 700, 70), ("Bilder", "FLUX.1 schnell", "23 GB", (96, 165, 250), 700, 235), ("Musik", "MusicGen small", "1,2 GB", (52, 211, 153), 700, 400)]
    for kind, name, size, color, x, y in cards:
        draw.rounded_rectangle((x, y, x + 440, y + 140), radius=26, fill=PANEL + (255,), outline=(55, 66, 93, 255), width=2)
        draw.rounded_rectangle((x + 22, y + 20, x + 22 + 26 + len(kind) * 14, y + 54), radius=17, fill=(139, 92, 246, 60))
        draw.text((x + 34, y + 21), kind, font=font(22, 800), fill=(196, 181, 253, 255))
        draw.text((x + 22, y + 62), name, font=font(34, 800), fill=(236, 239, 247, 255))
        draw.text((x + 22, y + 104), "Gratis zum Herunterladen", font=font(20, 600), fill=(143, 154, 180, 255))
        draw.text((x + 440 - 22 - len(size) * 18, y + 100), size, font=font(28, 800), fill=color + (255,))
    image.alpha_composite(logo(120), (84, 96))
    draw.text((80, 210), "KI-Regal", font=font(128, 900), fill=(255, 255, 255, 255))
    draw.text((92, 400), "Über 1000 KI-Modelle.", font=font(48, 800), fill=(255, 255, 255, 255))
    draw.text((92, 464), "Gratis. Auf deinem PC.", font=font(48, 800), fill=(236, 72, 153, 255))
    return image.convert("RGB")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
  <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#g)"/>
  <rect x="9" y="12" width="9" height="13" rx="2" fill="#fff"/><rect x="20" y="8" width="9" height="17" rx="2" fill="#fff" opacity=".9"/><rect x="31" y="14" width="8" height="11" rx="2" fill="#fff" opacity=".8"/>
  <path d="M7 28h34M10 28v10M38 28v10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "regal-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(SVG)
    flat = lambda image: Image.alpha_composite(Image.new("RGBA", image.size, NIGHT + (255,)), image).convert("RGB")
    flat(logo(180)).save(os.path.join(OUT, "regal-180.png"), optimize=True)
    logo(192).save(os.path.join(OUT, "regal-192.png"), optimize=True)
    logo(512).save(os.path.join(OUT, "regal-512.png"), optimize=True)
    flat(logo(512, bleed=True, scale=0.7)).save(os.path.join(OUT, "regal-512-maskable.png"), optimize=True)
    og_image().save(os.path.join(OUT, "regal-og.png"), optimize=True)
    print("written to", OUT)


if __name__ == "__main__":
    main()
