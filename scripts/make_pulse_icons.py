"""Draws Pulse's app icons (a white heartbeat line on a black tile) and the link-preview picture with Pillow.

    python scripts/make_pulse_icons.py

Writes static/img/pulse-icon.svg, pulse-{180,192,512,512-maskable}.png and pulse-og.png.  The line uses the same shape as the
logo in static/js/yipi-icons.js (a 64 x 64 grid), so every icon of the app looks the same.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "img")
FONT = os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")
WHITE, BLACK, GREY = (255, 255, 255), (0, 0, 0), (70, 70, 70)
SUPER = 4

LINE = [(8, 34), (21, 34), (27, 17), (37, 49), (43, 30), (48, 34), (56, 34)]     # the beat, on a 64 x 64 grid
LINE_WIDTH = 6.5


def lerp(a, b, t):
    return tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3))


def plate(size):
    """The black ground of the icons."""
    return Image.new("RGB", (size, size), BLACK)


def line_mask(size, scale, offset):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    points = [(offset + x * scale, offset + y * scale) for x, y in LINE]
    draw.line(points, fill=255, width=round(LINE_WIDTH * scale), joint="curve")
    radius = LINE_WIDTH * scale / 2
    for px, py in points:
        draw.ellipse([px - radius, py - radius, px + radius, py + radius], fill=255)
    return mask


def mark(size, line_size, fill):
    """The beat alone on a transparent square of `size` pixels, in the colour `fill` (a PIL image or colour)."""
    big = size * SUPER
    scale = big * line_size / 64
    offset = (big - 64 * scale) / 2
    mask = line_mask(big, scale, offset)
    layer = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    layer.paste(fill if isinstance(fill, Image.Image) else Image.new("RGB", (big, big), fill), (0, 0), mask)
    return layer


def icon(size, mode):
    """mode: 'tile' (rounded black tile, see-through corners), 'square' (edge to edge) or 'maskable' (edge to edge, beat smaller)."""
    big = size * SUPER
    base = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    if mode == "tile":
        mask = Image.new("L", (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle([big * 0.04, big * 0.04, big * 0.96, big * 0.96], radius=big * 0.26, fill=255)
        base.paste(plate(big), (0, 0), mask)
        ImageDraw.Draw(base).rounded_rectangle([big * 0.04, big * 0.04, big * 0.96, big * 0.96], radius=big * 0.26, outline=GREY, width=max(2, big // 100))
    else:
        base.paste(plate(big), (0, 0))
    base.alpha_composite(mark(size, 0.74 if mode == "maskable" else 0.84, WHITE))
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
    image = Image.new("RGBA", (width, height), BLACK + (255,))
    panel = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    ImageDraw.Draw(panel).rounded_rectangle([60, 60, width - 60, height - 60], radius=44, fill=(255, 255, 255, 14), outline=(255, 255, 255, 70), width=2)
    image = Image.alpha_composite(image, panel)
    draw = ImageDraw.Draw(image)
    draw.text((120, 150), "Nex", font=font(210, 900), fill=WHITE)
    draw.text((126, 395), "Was gerade passiert.", font=font(64, 800), fill=WHITE)
    draw.text((126, 478), "Beiträge, Videos, Fotos, GIFs und Nex AI, die KI.", font=font(36, 700), fill=(255, 255, 255, 205))
    beat = Image.new("RGBA", (360, 360), (0, 0, 0, 0))
    beat.alpha_composite(icon(360, "tile"))
    image.alpha_composite(beat, (760, 110))
    return image.convert("RGB")


SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="2.5" y="2.5" width="59" height="59" rx="16" fill="#000" stroke="#464646" stroke-width="1.5"/>
  <path d="M{points}" fill="none" stroke="#fff" stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
"""


def main():
    os.makedirs(OUT, exist_ok=True)
    # the line on the 64 grid, scaled to the same 84% the png tile uses
    pairs = [f"{32 + (x - 32) * 0.84:.1f} {32 + (y - 32) * 0.84:.1f}" for x, y in LINE]
    with open(os.path.join(OUT, "pulse-icon.svg"), "w", encoding="utf-8") as handle:
        handle.write(SVG.format(points="L".join(pairs), width=f"{LINE_WIDTH * 0.84:.1f}"))
    icon(180, "square").convert("RGB").save(os.path.join(OUT, "pulse-180.png"), optimize=True)
    icon(192, "tile").save(os.path.join(OUT, "pulse-192.png"), optimize=True)
    icon(512, "tile").save(os.path.join(OUT, "pulse-512.png"), optimize=True)
    icon(512, "maskable").convert("RGB").save(os.path.join(OUT, "pulse-512-maskable.png"), optimize=True)
    og_image().save(os.path.join(OUT, "pulse-og.png"), optimize=True)
    print("written to", OUT)


if __name__ == "__main__":
    main()
