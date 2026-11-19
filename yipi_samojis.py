"""Satürn Samojis (yipi_samojis.py): the stickers that can be given as a present, for Tokens. All of them are drawn by Satürn (the page draws them as small pictures from the numbers: a shape,
a pair of colours and a badge), there are 24 shapes x 10 colour pairs x 5 badges = 1200 of them, and each one costs a different number of Tokens (1 to 220): the plain ones are cheap, the
rare shapes, the shiny colours and the badges cost more. Whoever gets a Samoji gets as many Tokens as the giver paid. Everybody starts with 5 Tokens."""

START_TOKENS = 5

SHAPES = ["Herz", "Stern", "Planet", "Krone", "Flamme", "Blitz", "Mond", "Sonne", "Diamant", "Rakete", "Katze", "Geist", "Wolke", "Blume", "Kleeblatt", "Donut", "Pizza", "Eis", "Pokal", "Note", "Würfel", "Auge", "Fisch", "Kristall"]
SHAPE_PRICE = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 10, 12, 15, 20, 25, 30, 40]
# name, the main colour, the colour of the line
PALETTES = [("Rosa", "#ff6fa5", "#c2185b"), ("Rot", "#ff4d4f", "#a8071a"), ("Orange", "#ffa940", "#ad4e00"), ("Gold", "#ffd60a", "#b38600"), ("Grün", "#52c41a", "#237804"),
            ("Türkis", "#13c2c2", "#006d75"), ("Blau", "#40a9ff", "#0050b3"), ("Lila", "#9254de", "#391085"), ("Schwarz", "#434343", "#000000"), ("Weiß", "#ffffff", "#8c8c8c")]
PALETTE_FACTOR = [1, 1, 1, 2, 2, 2, 3, 3, 4, 5]
BADGES = ["", "Funkeln", "Ring", "Flügel", "Krone"]
BADGE_PRICE = [0, 1, 3, 8, 20]


def _build():
    items = []
    number = 0
    for shape, base in enumerate(SHAPE_PRICE):
        for palette, factor in enumerate(PALETTE_FACTOR):
            for badge, extra in enumerate(BADGE_PRICE):
                number += 1
                items.append((number, shape, palette, badge, max(1, base * factor) + extra))
    return items


CATALOGUE = _build()
BY_ID = {item[0]: item for item in CATALOGUE}


def find(samoji_id):
    """The entry (id, shape, palette, badge, price) of a Samoji, or None."""
    try:
        return BY_ID.get(int(samoji_id))
    except (TypeError, ValueError):
        return None


def name(entry):
    _, shape, palette, badge, _ = entry
    return f"{SHAPES[shape]} {PALETTES[palette][0]}{(' ' + BADGES[badge]) if BADGES[badge] else ''}"


def public():
    """What the page needs to draw and list every Samoji: the names of the shapes, colours and badges, and one short row per Samoji."""
    return {"shapes": SHAPES, "palettes": [[n, a, b] for n, a, b in PALETTES], "badges": BADGES, "items": [list(item) for item in CATALOGUE]}


MARKER = "⁣samoji:"                                      # a message that carries a Samoji: an invisible sign, "samoji:" and the number (only the server writes these)


def message_text(samoji_id):
    return f"{MARKER}{int(samoji_id)}⁣"
