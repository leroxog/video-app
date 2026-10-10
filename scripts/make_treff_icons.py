"""Draws Treff's app icons (a speech bubble with an exclamation mark on a blue tile) and the link-preview picture with Pillow.

    python scripts/make_treff_icons.py

Writes static/img/treff-icon.svg, treff-{180,192,512,512-maskable}.png and treff-og.png.  The bubble and the mark use the same shapes
as the logo in static/js/treff-ui.js (a 48 x 48 grid), so every icon of the app looks the same.
"""
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
FONT = os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")
BLUE, CYAN, NIGHT, PANEL = (59, 130, 246), (34, 211, 238), (11, 15, 23), (23, 32, 51)
SUPER = 4


def gradient(size, start=BLUE, end=CYAN):
    image = Image.new("RGB", (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            pixels[x, y] = tuple(round(start[k] + (end[k] - start[k]) * t) for k in range(3))
    return image


def logo(size, bleed=False, scale=1.0):
    """The logo on a transparent square of `size` pixels.  bleed: the tile fills the whole square (for icons that get cropped by the phone)."""
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
    d.rounded_rectangle([*at(10, 12), *at(38, 30)], radius=3 * unit, fill=(255, 255, 255, 255))
    d.polygon([at(17, 28), at(25, 28), at(18, 36)], fill=(255, 255, 255, 255))
    d.line([at(24, 17.5), at(24, 23.5)], fill=NIGHT + (255,), width=round(3 * unit))
    for p in (at(24, 17.5), at(24, 23.5)):
        d.ellipse([p[0] - 1.5 * unit, p[1] - 1.5 * unit, p[0] + 1.5 * unit, p[1] + 1.5 * unit], fill=NIGHT + (255,))
    c = at(24, 27.2)
    d.ellipse([c[0] - 1.9 * unit, c[1] - 1.9 * unit, c[0] + 1.9 * unit, c[1] + 1.9 * unit], fill=NIGHT + (255,))
    layer.alpha_composite(ink)
    return layer.resize((size, size), Image.LANCZOS)


def font(size, weight):
    face = ImageFont.truetype(FONT, size)
    try:
        face.set_variation_by_axes([weight])
    except Exception:
        pass
    return face


def bubble(draw, box, fill, radius=34):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def og_image():
    width, height = 1200, 630
    image = Image.new("RGBA", (width, height), NIGHT + (255,))
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([560, 20, 1300, 660], fill=(40, 130, 255, 70))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    draw = ImageDraw.Draw(image)
    # a few messages, the way the page shows them
    draw.text((690, 70), "Minecraft Server", font=font(30, 800), fill=(255, 255, 255, 255))
    bubble(draw, (690, 126, 1120, 214), PANEL + (255,))
    draw.text((716, 134), "user 482913", font=font(22, 800), fill=(110, 170, 255, 255))
    draw.text((716, 168), "play.example.net:25565", font=font(28, 700), fill=(232, 237, 247, 255))
    bubble(draw, (760, 236, 1150, 314), BLUE + (255,))
    draw.text((786, 255), "Danke! Das ist jetzt ein Fakt.", font=font(25, 700), fill=(255, 255, 255, 255))
    bubble(draw, (690, 336, 1110, 438), PANEL + (255,))
    draw.rounded_rectangle((690, 336, 700, 438), radius=4, fill=(245, 158, 11, 255))
    draw.text((722, 346), "WICHTIG!", font=font(20, 800), fill=(245, 158, 11, 255))
    draw.text((722, 376), "Neustart um 20 Uhr", font=font(28, 700), fill=(232, 237, 247, 255))
    chip = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(chip).rounded_rectangle((690, 470, 980, 530), radius=22, fill=(34, 211, 238, 40), outline=(34, 211, 238, 160), width=2)
    image.alpha_composite(chip)
    draw.text((716, 480), "Fakten!  3", font=font(30, 800), fill=(34, 211, 238, 255))
    image.alpha_composite(logo(120), (84, 96))
    draw.text((80, 210), "Treff", font=font(190, 900), fill=(255, 255, 255, 255))
    draw.text((92, 430), "Gruppen zu jedem Thema.", font=font(48, 800), fill=(255, 255, 255, 255))
    draw.text((92, 494), "Ohne Konto. Mit Fakten!", font=font(48, 800), fill=(34, 211, 238, 255))
    return image.convert("RGB")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b82f6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
  <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#g)"/>
  <path d="M13 12h22a3 3 0 013 3v12a3 3 0 01-3 3H25l-7 6v-6h-5a3 3 0 01-3-3V15a3 3 0 013-3z" fill="#fff"/>
  <path d="M24 17.500v6" stroke="#0b0f17" stroke-width="3" stroke-linecap="round"/><circle cx="24" cy="27.200" r="1.900" fill="#0b0f17"/>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "treff-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(SVG)
    flat = lambda image: Image.alpha_composite(Image.new("RGBA", image.size, NIGHT + (255,)), image).convert("RGB")
    flat(logo(180)).save(os.path.join(OUT, "treff-180.png"), optimize=True)
    logo(192).save(os.path.join(OUT, "treff-192.png"), optimize=True)
    logo(512).save(os.path.join(OUT, "treff-512.png"), optimize=True)
    flat(logo(512, bleed=True, scale=0.7)).save(os.path.join(OUT, "treff-512-maskable.png"), optimize=True)
    og_image().save(os.path.join(OUT, "treff-og.png"), optimize=True)
    print("written to", OUT)


if __name__ == "__main__":
    main()
