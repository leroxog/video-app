"""Nex lenses on the server (yipi_lenses.py): what a person writes as a prompt for a face lens ("mach mich dumm aussehend", "ein Hase mit großen Zähnen") is turned into a recipe
of the ready-made effects that the camera knows (static/js/pl-face.js): a short list of effect names and a colour filter. Nothing from a person ever runs as code: the recipe
can only name effects of the list below (the AI service is asked to choose from it, and whatever comes back is checked against it), so a lens can show a text and some
masks, never anything else. If the AI service is not there the words of the prompt are matched with a list of keywords instead. A test keeps the list in step with the
JavaScript file."""
import json
import os
import re

# the effects of pl-face.js: name -> what it does (German; this text is also what the AI service reads to choose)
EFFECTS = {
    "sunglasses": "schwarze Sonnenbrille", "heartGlasses": "Brille aus pinken Herzen", "roundGlasses": "runde goldene Brille", "nerdGlasses": "dicke Nerd-Brille mit Pflaster",
    "starGlasses": "gelbe Sternenbrille", "catEars": "Katzenohren, Nase und Schnurrhaare", "dogEars": "Hundeohren, Hundenase und Zunge", "bunnyEars": "lange Hasenohren",
    "devilHorns": "rote Teufelshörner", "halo": "goldener Heiligenschein", "crown": "goldene Krone", "clownNose": "rote Clownsnase", "clownWig": "bunte Clownsperücke",
    "mustache": "großer Schnurrbart", "beard": "dunkler Vollbart", "blush": "rosa Wangen", "freckles": "Sommersprossen", "bigTeeth": "riesige Zähne", "buckTeeth": "zwei große Hasenzähne",
    "tongue": "Zunge raus, wenn der Mund aufgeht", "drool": "Sabberfaden", "crossEyes": "schielende Augen", "googlyEyes": "große Wackelaugen", "bigEyes": "vergrößerte Augen",
    "bigHead": "aufgeblasener dicker Kopf", "bigNose": "riesige Nase", "bigMouth": "riesiger Mund", "hearts": "Herzchen steigen auf, wenn man lächelt", "sparkles": "funkelnde Sterne um den Kopf",
    "tears": "Tränen laufen über die Wangen", "fireEyes": "brennende Augen", "propellerHat": "bunte Mütze mit Propeller (dumm, lustig)", "dunceHat": "Narrenkappe mit einem D",
    "balaclava": "schwarze Strickmaske (Sturmhaube) mit Löchern für Augen und Mund", "pirate": "Augenklappe und rotes Kopftuch", "robot": "Roboter mit Metallplatten und Antenne",
    "rainbow": "Regenbogen kommt aus dem Mund", "swirlEyes": "Spiralen in den Augen (Hypnose)", "moneyEyes": "Dollarzeichen als Augen", "heartEyes": "pochende Herzen als Augen",
    "monocle": "Monokel", "topHat": "schwarzer Zylinder", "zombie": "grüne Haut, Augenringe, Narben", "confetti": "Konfetti fällt", "snow": "es schneit", "angry": "wütende Augenbrauen, roter Kopf",
    "tophatCane": "Zylinder, Schnurrbart und Monokel",
}
FILTERS = ("none", "warm", "cool", "noir", "vivid", "retro", "dream", "night")
MAX_FX = 6

# words of a prompt (the beginnings of words, lower case) -> effects; the first matches win
KEYWORDS = [
    (("dumm", "doof", "blöd", "trottel", "idiot", "depp", "verdummt", "dämlich", "bescheuert", "schwachsinn"), ["crossEyes", "buckTeeth", "tongue", "propellerHat"]),
    (("schiel", "schielen", "cross"), ["crossEyes"]),
    (("zähne", "zahn", "gebiss", "teeth"), ["bigTeeth"]),
    (("hase", "hasen", "bunny", "kaninchen"), ["bunnyEars", "buckTeeth"]),
    (("katze", "kater", "kitty", "cat"), ["catEars", "blush"]),
    (("hund", "dog", "welpe"), ["dogEars"]),
    (("sturmhaube", "strickmaske", "balaclava", "skimaske", "maske", "ninja"), ["balaclava"]),
    (("sonnenbrille", "cool", "lässig", "boss", "gangster"), ["sunglasses"]),
    (("herz", "verliebt", "liebe", "love", "süß"), ["heartEyes", "hearts", "blush"]),
    (("clown", "zirkus", "narr", "witzig"), ["clownNose", "clownWig"]),
    (("teufel", "devil", "böse", "dämon"), ["devilHorns", "angry"]),
    (("engel", "angel", "heilig", "brav"), ["halo", "sparkles"]),
    (("könig", "königin", "krone", "prinz", "prinzessin", "king", "queen", "reich"), ["crown", "sparkles"]),
    (("pirat", "pirate"), ["pirate", "beard"]),
    (("roboter", "robot", "cyborg", "android"), ["robot"]),
    (("zombie", "untot", "gruselig", "monster"), ["zombie"]),
    (("regenbogen", "rainbow", "kotzen", "spucken"), ["rainbow"]),
    (("weinen", "heul", "träne", "traurig", "sad"), ["tears"]),
    (("feuer", "brenn", "flamme", "heiß"), ["fireEyes"]),
    (("hypno", "spirale", "schwindel", "dizzy"), ["swirlEyes"]),
    (("geld", "dollar", "money", "millionär", "reich"), ["moneyEyes"]),
    (("riesenaugen", "große augen", "grosse augen", "glubsch", "glotz"), ["bigEyes"]),
    (("dicker kopf", "dicke backen", "aufgeblasen", "riesenkopf", "ballon", "hamster"), ["bigHead"]),
    (("nase",), ["bigNose"]),
    (("mund", "lippen", "maul"), ["bigMouth"]),
    (("wackelaugen", "wackel"), ["googlyEyes"]),
    (("sabber", "sabbern"), ["drool"]),
    (("nerd", "streber", "brille", "schlau"), ["nerdGlasses"]),
    (("gentleman", "herr", "fein", "monokel", "zylinder"), ["tophatCane"]),
    (("stern", "star", "popstar", "berühmt"), ["starGlasses", "sparkles"]),
    (("party", "konfetti", "feier", "geburtstag"), ["confetti"]),
    (("schnee", "winter", "kalt", "eis"), ["snow"]),
    (("opa", "bart", "alt", "weise"), ["beard", "roundGlasses"]),
    (("schnurrbart", "schnauzer"), ["mustache"]),
    (("sommersprossen", "sommer"), ["freckles", "blush"]),
    (("wütend", "sauer", "wut", "zornig", "angry"), ["angry", "fireEyes"]),
    (("glitzer", "funkel", "traum", "magisch", "märchen"), ["sparkles"]),
    (("lach", "lol", "haha"), ["bigTeeth", "tears"]),
    (("zunge",), ["tongue"]),
    (("alien", "außerirdisch", "ausserirdisch"), ["bigEyes", "bigHead"]),
]
FILTER_WORDS = [
    (("schwarzweiß", "schwarz-weiß", "alt", "film noir", "noir"), "noir"), (("retro", "80er", "90er", "vintage", "kassette"), "retro"), (("nacht", "dunkel", "mond", "gruselig", "zombie"), "night"),
    (("traum", "weich", "märchen", "süß", "pastell"), "dream"), (("bunt", "knallig", "party", "neon", "grell"), "vivid"), (("kalt", "eis", "winter", "schnee", "roboter"), "cool"), (("warm", "sommer", "sonne", "gemütlich"), "warm"),
]
STOPWORDS = {"mach", "mache", "machen", "mich", "mir", "die", "der", "das", "den", "dem", "ein", "eine", "einen", "einem", "person", "ich", "bin", "mit", "und", "als", "zum", "zur", "wie", "aussehend",
             "aussehen", "soll", "sein", "werden", "wird", "lass", "gib", "gebe", "meine", "mein", "meinen", "meinem", "setz", "setze", "auf", "aus", "von", "für", "ganz", "sehr", "richtig", "total", "große", "großen", "riesige", "riesigen"}
COLORS = ["#7a2cf0", "#ec4899", "#f59e0b", "#2a8cff", "#22c55e", "#ef4444", "#06b6d4", "#a855f7", "#f97316", "#14b8a6"]


def clean_recipe(fx, filter_name):
    """The effects that exist (in order, none twice, at most six) and a filter that exists."""
    names = []
    for name in fx if isinstance(fx, list) else []:
        if isinstance(name, str) and name in EFFECTS and name not in names:
            names.append(name)
    return names[:MAX_FX], filter_name if filter_name in FILTERS else "none"


def recipe_from_words(prompt):
    """The recipe the keywords of a prompt give: (title, emoji, color, effects, filter)."""
    low = " " + re.sub(r"\s+", " ", prompt.lower()) + " "
    chosen = []
    for stems, effects in KEYWORDS:
        if any(f" {stem}" in low for stem in stems):
            for name in effects:
                if name not in chosen:
                    chosen.append(name)
        if len(chosen) >= MAX_FX:
            break
    if not chosen:
        chosen = ["sparkles", "blush", "sunglasses"]
    filter_name = "none"
    for stems, name in FILTER_WORDS:
        if any(f" {stem}" in low for stem in stems):
            filter_name = name
            break
    words = [w for w in re.findall(r"[A-Za-zÄÖÜäöüß]+", prompt) if len(w) > 2 and w.lower() not in STOPWORDS]
    title = f"{words[0].capitalize()}-Linse"[:24] if words else "Meine Linse"
    first = chosen[0]
    from_emoji = {"crossEyes": "🤪", "bigTeeth": "😁", "bunnyEars": "🐰", "catEars": "🐱", "dogEars": "🐶", "balaclava": "🥷", "sunglasses": "😎", "heartEyes": "😍", "clownNose": "🤡", "devilHorns": "😈",
                  "halo": "😇", "crown": "👑", "pirate": "🏴‍☠️", "robot": "🤖", "zombie": "🧟", "rainbow": "🌈", "tears": "😭", "fireEyes": "🔥", "swirlEyes": "😵‍💫", "moneyEyes": "🤑", "bigEyes": "👀",
                  "bigHead": "🎈", "nerdGlasses": "🤓", "tophatCane": "🧐", "starGlasses": "🤩", "confetti": "🎉", "snow": "❄️", "beard": "🧔", "mustache": "🥸", "angry": "😠", "sparkles": "✨"}
    return title, from_emoji.get(first, "✨"), COLORS[sum(map(ord, prompt)) % len(COLORS)], chosen[:MAX_FX], filter_name


def ask_ai(prompt):
    """The recipe the AI service chooses ((title, emoji, color, fx, filter) or None when it is not there or its answer is useless)."""
    if not os.environ.get("GROQ_API_KEY"):
        return None
    try:
        import ai_assistant
        listing = "\n".join(f"- {name}: {about}" for name, about in EFFECTS.items())
        raw = ai_assistant.generate_text(
            "Du baust Gesichts-Linsen für eine Kamera-App (wie bei Snapchat). Aus der Beschreibung einer Person wählst du EINE bis SECHS passende Effekte aus dieser Liste (nur die Namen) und einen Farbfilter, "
            "dazu einen kurzen Titel (höchstens 24 Zeichen), ein einzelnes passendes Emoji und eine Farbe (#rrggbb).\nEffekte:\n" + listing + "\nFilter: " + ", ".join(FILTERS)
            + "\nWähle Effekte, die zusammen gut aussehen und wirklich zur Beschreibung passen; mehrere Effekte dürfen kombiniert werden. Antworte NUR mit JSON der Form "
            '{"title": "...", "emoji": "...", "color": "#7a2cf0", "fx": ["name", "name"], "filter": "none"}.',
            prompt[:200], max_tokens=300, temperature=0.6)
    except Exception:  # noqa: BLE001  (not reachable, no key: the keywords do it)
        return None
    start, end = raw.find("{"), raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        data = json.loads(raw[start:end + 1])
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    fx, filter_name = clean_recipe(data.get("fx"), data.get("filter"))
    if not fx:
        return None
    title = re.sub(r"\s+", " ", str(data.get("title") or "")).strip()[:24]
    emoji = str(data.get("emoji") or "").strip()
    color = str(data.get("color") or "")
    return title, emoji if 0 < len(emoji) <= 8 and not re.search(r"[A-Za-z0-9]", emoji) else "", color if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else "", fx, filter_name


def make_recipe(prompt):
    """{title, emoji, color, fx, filter, source} for a prompt: from the AI service when it answers well, otherwise from the keywords."""
    prompt = re.sub(r"\s+", " ", prompt).strip()[:200]
    words = recipe_from_words(prompt)
    got = ask_ai(prompt)
    if got is None:
        title, emoji, color, fx, filter_name = words
        return {"title": title, "emoji": emoji, "color": color, "fx": fx, "filter": filter_name, "about": [EFFECTS[name] for name in fx], "source": "words"}
    title, emoji, color, fx, filter_name = got
    return {"title": title or words[0], "emoji": emoji or words[1], "color": color or words[2], "fx": fx, "filter": filter_name, "about": [EFFECTS[name] for name in fx], "source": "ai"}
