"""Satürn Samojis (yipi_samojis.py): the presents that can be given for Tokens, like the gifts of the big live apps. Since 2026-11-22 they are 15 pictures (a rose, a whale, a panda, a unicorn, a wallet,
a hand with two shopping bags ...; static/img/samoji/<file>.png, with the background cut away), each with its own price (2 to 100 Tokens); the hand with the bags costs the most.
Whoever gets a Samoji gets as many Tokens as the giver paid. Everybody starts with 5 Tokens (and gets 2 more every day)."""

START_TOKENS = 5

SHAPES = ["Herz", "Rose", "Brot", "Bubble Tea", "Nadel", "Kaktus", "Bär", "Flugzeug", "Klo", "Einhorn", "Elefant", "Panda", "Wal", "Geldbörse", "Einkaufstüten"]
SHAPE_PRICE = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 30, 40, 50, 60, 100]            # the hand with the bags costs the most
FILES = ["herz", "rose", "brot", "bubbletea", "nadel", "kaktus", "baer", "flugzeug", "klo", "einhorn", "elefant", "panda", "wal", "geldboerse", "tueten"]      # static/img/samoji/<file>.png
# (one look and no extras any more: every Samoji is a picture; the lists stay so that the old page code and the numbers keep their shape)
LOOKS = [("Original", "#ffffff", "#c9b8ff", "gloss")]
LOOK_FACTOR = [1]
BADGES = [""]
BADGE_PRICE = [0]
PALETTES = LOOKS


def _build():
    items = []
    for number, base in enumerate(SHAPE_PRICE, start=1):
        items.append((number, number - 1, 0, 0, base))
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
    return {"shapes": SHAPES, "files": FILES, "palettes": [list(look) for look in LOOKS], "badges": BADGES, "items": [list(item) for item in CATALOGUE]}


MARKER = "⁣samoji:"                                      # a message that carries a Samoji: an invisible sign, "samoji:" and the number (only the server writes these)


def message_text(samoji_id):
    return f"{MARKER}{int(samoji_id)}⁣"
