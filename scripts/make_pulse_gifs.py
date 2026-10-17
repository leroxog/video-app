"""Draws the starter GIFs of Pulse's GIF library (animated words and shapes of our own, in black and purple, no clips from anywhere) with Pillow.

    python scripts/make_pulse_gifs.py

Writes static/gifs/<slug>.gif and static/gifs/index.json.  The server (yipi.py: ensure_starters) puts them into the library the first
time somebody opens the picker; people add their own GIFs next to them.  Every GIF is 320 x 240 pixels, flat colours (so a 32-colour
palette does not band) and a loop of about one second; most stay under 100 KB, none is over 200 KB.
"""
import json
import math
import os
import random

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "gifs")
FONT = os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")
W, H, SS = 320, 240, 2                                     # the picture, and how much bigger it is drawn (then shrunk: smooth edges)
FRAMES, DURATION = 14, 75

# Pulse is black and purple: every picture is drawn with these (the names of the older colours are kept, their values are purples)
WHITE, INK = (255, 255, 255), (10, 8, 18)
PINK, RED, ORANGE, YELLOW, GREEN, CYAN, BLUE, VIOLET = (192, 38, 211), (167, 139, 250), (196, 181, 253), (233, 226, 255), (124, 58, 237), (167, 139, 250), (88, 50, 190), (139, 92, 246)
DEEP, DARK = (46, 16, 101), (24, 16, 42)


def font(size, weight=900):
    face = ImageFont.truetype(FONT, int(size * SS))
    try:
        face.set_variation_by_axes([weight])
    except Exception:
        pass
    return face


def ease(t):
    return t * t * (3 - 2 * t)


def wave(t, cycles=1, phase=0.0):
    return math.sin((t * cycles + phase) * math.tau)


def pop(t):
    """0 to 1 with an overshoot: something that jumps into place."""
    return max(0.02, 1 + 2.2 * math.pow(t - 1, 3) + 1.2 * math.pow(t - 1, 2)) if t < 1 else 1


def new(bg):
    image = Image.new("RGB", (W * SS, H * SS), bg)
    return image, ImageDraw.Draw(image)


def at(x, y):
    return (x * SS, y * SS)


def text(draw, message, cx, cy, size, fill=WHITE, shadow=None, weight=900, angle=0.0, image=None):
    """Centred text.  With `angle` the text is drawn on its own layer and turned (needs `image`)."""
    face = font(size, weight)
    box = draw.textbbox((0, 0), message, font=face, anchor="lt")
    width, height = box[2] - box[0], box[3] - box[1]
    if angle and image is not None:
        layer = Image.new("RGBA", (width + 40 * SS, height + 40 * SS), (0, 0, 0, 0))
        layer_draw = ImageDraw.Draw(layer)
        if shadow:
            layer_draw.text((20 * SS + 3 * SS, 20 * SS + 4 * SS - box[1]), message, font=face, fill=shadow, anchor="lt")
        layer_draw.text((20 * SS, 20 * SS - box[1]), message, font=face, fill=fill, anchor="lt")
        layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
        image.paste(layer, (int(cx * SS - layer.width / 2), int(cy * SS - layer.height / 2)), layer)
        return
    x, y = cx * SS - width / 2 - box[0], cy * SS - height / 2 - box[1]
    if shadow:
        draw.text((x + 3 * SS, y + 4 * SS), message, font=face, fill=shadow)
    draw.text((x, y), message, font=face, fill=fill)


def heart(draw, cx, cy, size, fill):
    points = []
    for step in range(80):
        a = step / 80 * math.tau
        points.append(at(cx + size * 16 * math.sin(a) ** 3 / 16, cy - size * (13 * math.cos(a) - 5 * math.cos(2 * a) - 2 * math.cos(3 * a) - math.cos(4 * a)) / 16))
    draw.polygon(points, fill=fill)


def star(draw, cx, cy, radius, fill, points=4, inner=0.28, turn=0.0):
    shape = []
    for k in range(points * 2):
        r = radius if k % 2 == 0 else radius * inner
        a = turn + k * math.pi / points - math.pi / 2
        shape.append(at(cx + r * math.cos(a), cy + r * math.sin(a)))
    draw.polygon(shape, fill=fill)


def circle(draw, cx, cy, r, fill=None, outline=None, width=0):
    draw.ellipse([*at(cx - r, cy - r), *at(cx + r, cy + r)], fill=fill, outline=outline, width=width * SS)


# ----------------------------------------------------------------------------------------------------------- the pictures
def hallo(t):
    image, draw = new((92, 44, 196))
    for k in range(3):
        circle(draw, 60 + k * 100, 190 + 8 * wave(t, 1, k / 3), 46, fill=(112, 64, 214))
    text(draw, "Hallo!", 160, 105 + 8 * wave(t, 1), 82, WHITE, shadow=DEEP, angle=6 * wave(t, 1, 0.25), image=image)
    hand = 22 * wave(t, 2)
    circle(draw, 266 + hand * 0.4, 52, 20, fill=YELLOW)
    circle(draw, 266 + hand * 0.4, 52, 20, outline=WHITE, width=3)
    return image


def lol(t):
    image, draw = new(ORANGE)
    shake = 7 * wave(t, 3)
    text(draw, "LOL", 160 + shake, 112 + 3 * wave(t, 6), 104, INK, angle=5 * wave(t, 3), image=image)
    for k in range(3):
        y = (t * 120 + k * 40) % 120
        circle(draw, 60 + k * 100, 190 - y * 0.2, 6 + k, fill=(228, 218, 255))
    return image


def wow(t):
    image, draw = new(INK)
    turn = t * math.tau / 6
    for k in range(12):
        a = turn + k * math.tau / 12
        draw.polygon([at(160, 120), at(160 + 300 * math.cos(a - 0.09), 120 + 300 * math.sin(a - 0.09)), at(160 + 300 * math.cos(a + 0.09), 120 + 300 * math.sin(a + 0.09))], fill=(30, 18, 60) if k % 2 else (46, 26, 92))
    grow = 1 + 0.12 * wave(t, 1)
    text(draw, "WOW", 160, 118, 88 * grow, WHITE, shadow=VIOLET)
    star(draw, 52, 52 + 5 * wave(t, 1), 20, CYAN, turn=turn * 3)
    star(draw, 270, 188 - 5 * wave(t, 1, 0.5), 17, PINK, turn=-turn * 3)
    return image


def danke(t):
    image, draw = new(GREEN)
    beat = 1 + 0.14 * max(0, math.sin(t * math.tau * 2)) ** 2
    heart(draw, 160, 92, 66 * beat, WHITE)
    text(draw, "Danke!", 160, 200, 54, WHITE, shadow=DEEP)
    return image


def ja(t):
    image, draw = new(DARK)
    grow = pop(min(1, t * 2.2))
    circle(draw, 160, 96, 64 * grow, fill=VIOLET)
    circle(draw, 160, 96, 64 * grow, outline=WHITE, width=6)
    draw.line([*at(160 - 32 * grow, 98), *at(160 - 8 * grow, 122), *at(160 + 36 * grow, 70)], fill=WHITE, width=int(14 * SS * grow), joint="curve")
    text(draw, "JA", 160, 202, 52 + 3 * wave(t, 2), WHITE)
    return image


def nein(t):
    image, draw = new(DARK)
    shake = 8 * wave(t, 3) if t < 0.7 else 0
    circle(draw, 160 + shake, 96, 64, fill=(70, 40, 120))
    circle(draw, 160 + shake, 96, 64, outline=WHITE, width=6)
    draw.line([*at(130 + shake, 66), *at(190 + shake, 126)], fill=WHITE, width=14 * SS)
    draw.line([*at(190 + shake, 66), *at(130 + shake, 126)], fill=WHITE, width=14 * SS)
    text(draw, "NEIN", 160, 202, 52, WHITE)
    return image


def herz(t):
    image, draw = new(DARK)
    for k in range(6):
        p = (t + k / 6) % 1
        heart(draw, 40 + k * 48 + 8 * wave(p, 1, k / 6), 240 - p * 260, 14 + 8 * (k % 3), (150 + k * 14, 70 + k * 8, 230 - k * 4))
    beat = 1 + 0.16 * max(0, math.sin(t * math.tau * 2)) ** 2
    heart(draw, 160, 118, 96 * beat, VIOLET)
    return image


def party(t):
    image, draw = new(DEEP)
    rng = random.Random(7)
    colours = (PINK, YELLOW, CYAN, VIOLET, ORANGE, WHITE)
    for k in range(34):
        x, speed, phase = rng.uniform(6, 314), rng.uniform(0.8, 1.6), rng.random()
        y = ((t * speed + phase) % 1) * 280 - 20
        size = rng.uniform(5, 9)
        spin = (t * 4 + phase) * math.tau
        colour = colours[k % len(colours)]
        draw.polygon([at(x + size * math.cos(spin), y + size * math.sin(spin)), at(x + size * math.cos(spin + 2), y + size * math.sin(spin + 2)), at(x + size * math.cos(spin + 4), y + size * math.sin(spin + 4))], fill=colour)
    text(draw, "PARTY", 160, 120, 84, WHITE, shadow=INK, angle=7 * wave(t, 1), image=image)
    return image


def nacht(t):
    image, draw = new((16, 10, 36))
    circle(draw, 110, 100, 54, fill=(230, 222, 255))
    circle(draw, 132, 86, 50, fill=(16, 10, 36))
    rng = random.Random(3)
    for k in range(9):
        x, y = rng.uniform(150, 310), rng.uniform(20, 130)
        glow = 0.5 + 0.5 * math.sin((t + k / 9) * math.tau)
        star(draw, x, y, 5 + 7 * glow, (255, 255, 255), turn=0)
    text(draw, "Gute Nacht", 160, 200, 50, WHITE)
    return image


def bravo(t):
    image, draw = new((112, 52, 220))
    for k in range(7):
        p = (t * 2 + k / 7) % 1
        a = k * math.tau / 7 + 0.3
        star(draw, 160 + math.cos(a) * (40 + 120 * p), 110 + math.sin(a) * (30 + 80 * p), 18 * (1 - p), YELLOW)
    text(draw, "BRAVO", 160, 116, 82 + 4 * wave(t, 2), WHITE, shadow=DEEP, angle=-4 * wave(t, 2), image=image)
    return image


def hmm(t):
    image, draw = new((36, 28, 58))
    text(draw, "Hmm", 130, 112, 92, WHITE, angle=3 * wave(t, 1), image=image)
    shown = int(t * 4) % 4
    for k in range(3):
        circle(draw, 244 + k * 24, 140, 8, fill=ORANGE if k < shown else (84, 72, 118))
    return image


def feuer(t):
    image, draw = new(INK)
    for layer, (colour, scale) in enumerate((((112, 52, 220), 1.0), (VIOLET, 0.74), (YELLOW, 0.46))):
        points = []
        for k in range(0, 41):
            a = k / 40 * math.tau
            flick = 1 + 0.12 * math.sin(a * 5 + t * math.tau * 2 + layer) + 0.06 * math.sin(a * 9 - t * math.tau * 3)
            r = 78 * scale * flick
            x, y = 160 + r * 0.8 * math.sin(a), 130 - r * 0.9 * math.cos(a) * (1.25 if math.cos(a) > 0 else 0.7)
            points.append(at(x, y))
        draw.polygon(points, fill=colour)
    text(draw, "HEISS", 160, 212, 40, ORANGE)
    return image


def gluckwunsch(t):
    image, draw = new(INK)
    rng = random.Random(11)
    for burst in range(3):
        cx, cy = 70 + burst * 90, 80 + 30 * (burst % 2)
        p = (t + burst / 3) % 1
        for k in range(14):
            a = k * math.tau / 14
            r = 8 + 52 * ease(p)
            circle(draw, cx + math.cos(a) * r, cy + math.sin(a) * r, 4 * (1 - p) + 1, fill=(YELLOW, PINK, VIOLET)[burst])
    text(draw, "Glückwunsch!", 160, 200, 36, WHITE, shadow=DEEP)
    return image


def cool(t):
    image, draw = new((104, 56, 226))
    bob = 6 * wave(t, 1)
    circle(draw, 160, 110 + bob, 66, fill=YELLOW)
    draw.rounded_rectangle([*at(104, 92 + bob), *at(216, 128 + bob)], radius=14 * SS, fill=INK)
    draw.line([*at(160, 100 + bob), *at(160, 100 + bob)], fill=INK, width=4 * SS)
    draw.arc([*at(122, 128 + bob), *at(198, 164 + bob)], 20, 160, fill=INK, width=6 * SS)
    shine = (t * 3) % 1
    draw.line([*at(112 + shine * 40, 98 + bob), *at(124 + shine * 40, 98 + bob)], fill=(120, 140, 170), width=4 * SS)
    text(draw, "COOL", 160, 208, 40, WHITE)
    return image


def spaeter(t):
    image, draw = new((84, 46, 184))
    slide = 1 - ease(min(1, t * 1.6))
    text(draw, "Bis später!", 160 - 260 * slide, 104, 62, WHITE, shadow=DEEP)
    circle(draw, 160, 190, 20 + 4 * wave(t, 2), fill=YELLOW)
    for k in range(3):
        draw.line([*at(124 + k * 36, 160), *at(124 + k * 36, 160 - 12 * (1 + wave(t, 2, k / 3)))], fill=YELLOW, width=4 * SS)
    return image


def zzz(t):
    image, draw = new(DEEP)
    for k in range(3):
        p = (t + k / 3) % 1
        text(draw, "Z", 120 + p * 90 + k * 8, 190 - p * 150, 30 + 24 * p + k * 6, (210, 200, 255) if k else WHITE)
    circle(draw, 76, 168, 46, fill=(70, 62, 130))
    return image


def haha(t):
    image, draw = new(PINK)
    for k in range(4):
        shake = 5 * wave(t, 2, k / 4)
        text(draw, "HA", 58 + (k % 2) * 110 + shake + (k // 2) * 30, 78 + (k // 2) * 84 + 10 * wave(t, 2, k / 4), 66, WHITE, shadow=DEEP, angle=10 * wave(t, 2, k / 4), image=image)
    return image


def pulse(t):
    image, draw = new(INK)
    base = [(20, 128), (96, 128), (124, 62), (166, 190), (194, 108), (214, 128), (300, 128)]
    length = [0]
    for a, b in zip(base, base[1:]):
        length.append(length[-1] + math.dist(a, b))
    shown = length[-1] * min(1, t * 1.25)
    points = [base[0]]
    for k in range(1, len(base)):
        if length[k] <= shown:
            points.append(base[k])
        else:
            f = (shown - length[k - 1]) / (length[k] - length[k - 1])
            points.append((base[k - 1][0] + (base[k][0] - base[k - 1][0]) * f, base[k - 1][1] + (base[k][1] - base[k - 1][1]) * f))
            break
    draw.line([at(*p) for p in points], fill=CYAN, width=9 * SS, joint="curve")
    for px, py in points[:1] + points[-1:]:
        circle(draw, px, py, 5, fill=CYAN)
    text(draw, "Pulse", 160, 40, 34, WHITE)
    return image


GIFS = [
    ("hallo", "Hallo", hallo), ("lol", "Lol", lol), ("haha", "Haha", haha), ("wow", "Wow", wow), ("danke", "Danke", danke), ("ja", "Ja", ja),
    ("nein", "Nein", nein), ("herz", "Herz Liebe", herz), ("party", "Party", party), ("bravo", "Bravo Applaus", bravo), ("hmm", "Hmm", hmm),
    ("feuer", "Feuer heiß", feuer), ("gluckwunsch", "Glückwunsch", gluckwunsch), ("cool", "Cool", cool), ("nacht", "Gute Nacht", nacht),
    ("zzz", "Müde Schlafen", zzz), ("spaeter", "Bis später", spaeter), ("pulse", "Pulse", pulse),
]


def build(function):
    frames = []
    for number in range(FRAMES):
        big = function(number / FRAMES)
        small = big.resize((W, H), Image.LANCZOS)
        frames.append(small.quantize(colors=32, method=Image.MEDIANCUT, dither=Image.Dither.NONE))
    return frames


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for slug, title, function in GIFS:
        frames = build(function)
        path = os.path.join(OUT, slug + ".gif")
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=DURATION, loop=0, optimize=True, disposal=1)
        index.append({"slug": slug, "title": title, "file": slug + ".gif"})
        print(f"{slug}.gif  {os.path.getsize(path) // 1024} KB")
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, indent=1)
        handle.write("\n")


if __name__ == "__main__":
    main()
