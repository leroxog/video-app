"""Satürn Samojis (yipi_samojis.py): the 3D presents that can be given for Tokens, like the gifts of the big live apps. All of them are built by Satürn in 3D in the page (static/js/gift3d.mjs, three.js)
from the numbers kept here: 16 figures (a whale, a rose, a rocket ...) x 15 looks (colours, gold, silver, neon, glass, a rainbow shimmer) x 5 extras (sparkles, a halo, wings, an aura) = 1200 of
them, and each one costs a different number of Tokens (1 to 220): small plain figures are cheap, the rose, the butterfly and above all the whale are dear, and so are gold, glass and the extras.
Whoever gets a Samoji gets as many Tokens as the giver paid. Everybody starts with 5 Tokens (and gets 2 more every day)."""

START_TOKENS = 5

SHAPES = ["Herz", "Stern", "Blitz", "Eis", "Donut", "Planet", "Katze", "Geist", "Kleeblatt", "Rakete", "Krone", "Pokal", "Diamant", "Rose", "Schmetterling", "Wal"]
SHAPE_PRICE = [1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 8, 10, 15, 20, 30, 50]
# name, the main colour, the second colour, the finish (gloss, gold, silver, neon, glass, holo)
LOOKS = [("Rosa", "#ff6fa5", "#c2185b", "gloss"), ("Rot", "#ff3b4e", "#a8071a", "gloss"), ("Orange", "#ff9f3a", "#ad4e00", "gloss"), ("Sonnengelb", "#ffd60a", "#b38600", "gloss"),
         ("Grün", "#43d17a", "#1d7a3f", "gloss"), ("Türkis", "#16c7c7", "#00717a", "gloss"), ("Blau", "#3d8bff", "#0b3fa8", "gloss"), ("Lila", "#9b5cf0", "#4a1d9a", "gloss"),
         ("Schwarz", "#2b2b30", "#000000", "gloss"), ("Weiß", "#fafafa", "#bdbdc8", "gloss"),
         ("Gold", "#ffc83d", "#b8860b", "gold"), ("Silber", "#e8e8f0", "#9aa0b0", "silver"), ("Neon", "#ff4fd8", "#7a1fa2", "neon"), ("Glas", "#6fd0ff", "#2a7fb0", "glass"), ("Regenbogen", "#ffffff", "#ff9bd5", "holo")]
LOOK_FACTOR = [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 3, 2, 2, 3, 4]
BADGES = ["", "Funkeln", "Heiligenschein", "Flügel", "Aura"]
BADGE_PRICE = [0, 1, 3, 8, 20]
PALETTES = LOOKS                                                # (the old name, the page and the tests still use it)


def _build():
    items = []
    number = 0
    for shape, base in enumerate(SHAPE_PRICE):
        for look, factor in enumerate(LOOK_FACTOR):
            for badge, extra in enumerate(BADGE_PRICE):
                number += 1
                items.append((number, shape, look, badge, max(1, base * factor) + extra))
    return items


CATALOGUE = _build()
BY_ID = {item[0]: item for item in CATALOGUE}


def find(samoji_id):
    """The entry (id, shape, look, badge, price) of a Samoji, or None."""
    try:
        return BY_ID.get(int(samoji_id))
    except (TypeError, ValueError):
        return None


def name(entry):
    _, shape, look, badge, _ = entry
    return f"{SHAPES[shape]} {LOOKS[look][0]}{(' ' + BADGES[badge]) if BADGES[badge] else ''}"


def public():
    """What the page needs to build and list every Samoji: the names of the figures, looks and extras, and one short row per Samoji."""
    return {"shapes": SHAPES, "palettes": [list(look) for look in LOOKS], "badges": BADGES, "items": [list(item) for item in CATALOGUE]}


MARKER = "⁣samoji:"                                      # a message that carries a Samoji: an invisible sign, "samoji:" and the number (only the server writes these)


def message_text(samoji_id):
    return f"{MARKER}{int(samoji_id)}⁣"
