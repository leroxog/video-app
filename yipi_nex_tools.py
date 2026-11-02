"""Nex can do much more than talk (yipi_nex_tools.py): when the question of a person fits one of these free services, the server asks the service (no key, nothing of the person is sent but the word
the question is about) and hands the answer to Nex with the question, so that Nex can use it: the weather (Open-Meteo), Wikipedia, exchange rates (Frankfurter), crypto prices (CoinGecko), calculations
(math.js), countries (Wikipedia), the space station and earthquakes, Pokémon, jokes in German (JokeAPI), useless facts, advice, quotes, Chuck Norris, what a name says about the age (agify) and a few
things that need no service at all (dice, coin, magic 8 ball). Some of it makes no sense, and that is the point. Every question is checked with simple patterns (no second AI call), at most two services
answer one question, each has five seconds, and a service that is down is skipped without a word. Only these fixed hosts are ever asked. The second use of the free AI of Pollinations (text.pollinations.ai) is
`fallback_text`: when the main AI does not answer, Pollinations may."""
import logging
import random
import re
import urllib.parse

import requests

logger = logging.getLogger(__name__)

HEADERS = {"User-Agent": "NexBot/1.0 (https://nexai.up.railway.app) python-requests", "Accept": "application/json"}
TIMEOUT = 5
MAX_TOOLS = 2
POLLINATIONS_TEXT = "https://text.pollinations.ai/openai"

WEATHER_CODES = {0: "klar", 1: "überwiegend klar", 2: "teils bewölkt", 3: "bedeckt", 45: "Nebel", 48: "Reifnebel", 51: "leichter Nieselregen", 53: "Nieselregen", 55: "starker Nieselregen", 61: "leichter Regen",
                 63: "Regen", 65: "starker Regen", 71: "leichter Schneefall", 73: "Schneefall", 75: "starker Schneefall", 80: "Regenschauer", 81: "kräftige Schauer", 82: "heftige Schauer", 95: "Gewitter", 96: "Gewitter mit Hagel", 99: "schweres Gewitter mit Hagel"}
CURRENCIES = {"usd": "USD", "dollar": "USD", "us-dollar": "USD", "eur": "EUR", "euro": "EUR", "chf": "CHF", "franken": "CHF", "gbp": "GBP", "pfund": "GBP", "jpy": "JPY", "yen": "JPY", "try": "TRY", "lira": "TRY",
              "pln": "PLN", "zloty": "PLN", "sek": "SEK", "krone": "SEK", "cad": "CAD", "aud": "AUD", "cny": "CNY", "yuan": "CNY", "inr": "INR", "rupie": "INR", "brl": "BRL", "real": "BRL"}
COINS = {"bitcoin": "bitcoin", "btc": "bitcoin", "ethereum": "ethereum", "eth": "ethereum", "dogecoin": "dogecoin", "doge": "dogecoin", "solana": "solana", "litecoin": "litecoin", "xrp": "ripple"}


def _get(url, **params):
    reply = requests.get(url, params=params or None, headers=HEADERS, timeout=TIMEOUT)
    if reply.status_code != 200:
        raise ValueError(reply.status_code)
    return reply.json()


def _name(text):
    return re.sub(r"\s+", " ", text).strip(" ?!.,;:")[:40]


# ------------------------------------------------------------------------------------------------------------------ the tools (each answers one short text or raises)
def weather(place):
    found = _get("https://geocoding-api.open-meteo.com/v1/search", name=place, count=1, language="de")["results"][0]
    now = _get("https://api.open-meteo.com/v1/forecast", latitude=found["latitude"], longitude=found["longitude"], current="temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m",
               daily="temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset", timezone="auto", forecast_days=2)
    c, d = now["current"], now["daily"]
    return (f"Wetter in {found['name']} ({found.get('country', '')}): jetzt {c['temperature_2m']} °C (gefühlt {c['apparent_temperature']} °C), {WEATHER_CODES.get(c['weather_code'], 'wechselhaft')}, Wind {c['wind_speed_10m']} km/h, "
            f"Luftfeuchte {c['relative_humidity_2m']} %. Heute {d['temperature_2m_min'][0]} bis {d['temperature_2m_max'][0]} °C, Regenrisiko {d['precipitation_probability_max'][0]} %, Sonnenaufgang {d['sunrise'][0][-5:]}, Sonnenuntergang {d['sunset'][0][-5:]}. "
            f"Morgen {d['temperature_2m_min'][1]} bis {d['temperature_2m_max'][1]} °C.")


def wikipedia(topic):
    if not re.search(r"[A-Za-zÄÖÜäöüß]{2}", topic):
        raise ValueError("not a topic")
    hits = _get("https://de.wikipedia.org/w/api.php", action="opensearch", search=topic, limit=1, format="json")
    title = hits[1][0]
    page = _get(f"https://de.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title.replace(' ', '_'), safe='')}")
    if not page.get("extract"):
        raise ValueError("empty")
    return f"Wikipedia „{page['title']}“: {page['extract'][:900]}"


def currency(amount, source, target):
    data = _get("https://api.frankfurter.app/latest", amount=amount, **{"from": source, "to": target})
    return f"Wechselkurs (Frankfurter, Europäische Zentralbank): {amount} {source} = {data['rates'][target]} {target} (Stand {data['date']})."


def crypto(coin):
    data = _get("https://api.coingecko.com/api/v3/simple/price", ids=coin, vs_currencies="eur,usd", include_24hr_change="true")[coin]
    return f"Preis von {coin} (CoinGecko): {data['eur']} € / {data['usd']} $, in 24 Stunden {data.get('eur_24h_change', 0):+.1f} %. Das ist keine Anlageberatung."


def calculate(expression):
    reply = requests.get("https://api.mathjs.org/v4/", params={"expr": expression}, headers=HEADERS, timeout=TIMEOUT)
    if reply.status_code != 200 or not reply.text.strip():
        raise ValueError("no result")
    return f"Rechnung (math.js): {expression} = {reply.text.strip()[:60]}"


def iss():
    d = _get("https://api.wheretheiss.at/v1/satellites/25544")
    return f"Die Internationale Raumstation ist gerade bei {d['latitude']:.2f}° Breite, {d['longitude']:.2f}° Länge, {d['altitude']:.0f} km hoch und fliegt {d['velocity']:.0f} km/h schnell."


def earthquakes():
    rows = _get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson")["features"][:3]
    if not rows:
        return "Erdbeben (USGS): in den letzten 24 Stunden gab es kein auffallend starkes Beben."
    return "Starke Erdbeben der letzten 24 Stunden (USGS): " + "; ".join(f"{r['properties']['mag']} bei {r['properties']['place']}" for r in rows) + "."


def pokemon(name):
    d = _get(f"https://pokeapi.co/api/v2/pokemon/{urllib.parse.quote(name.lower())}")
    return f"Pokémon {d['name']}: Typ {', '.join(t['type']['name'] for t in d['types'])}, {d['height'] / 10} m groß, {d['weight'] / 10} kg schwer, Fähigkeiten {', '.join(a['ability']['name'] for a in d['abilities'])}."


def joke():
    d = _get("https://v2.jokeapi.dev/joke/Any", lang="de", safeMode="true", blacklistFlags="nsfw,religious,political,racist,sexist,explicit")
    return "Ein Witz (JokeAPI): " + (d["joke"] if d.get("type") == "single" else f"{d['setup']} – {d['delivery']}")


def useless_fact():
    return "Nutzloses Wissen: " + _get("https://uselessfacts.jsph.pl/api/v2/facts/random", language="en")["text"] + " (englisch, übersetze es für den Nutzer)"


def advice():
    return "Ein Ratschlag (Advice Slip, englisch, übersetze ihn): " + requests.get("https://api.adviceslip.com/advice", headers=HEADERS, timeout=TIMEOUT).json()["slip"]["advice"]


def quote():
    d = _get("https://zenquotes.io/api/random")[0]
    return f"Ein Zitat (ZenQuotes, englisch, übersetze es): „{d['q']}“ – {d['a']}"


def chuck():
    return "Ein Chuck-Norris-Witz (englisch, übersetze ihn): " + _get("https://api.chucknorris.io/jokes/random")["value"]


def age_of_name(name):
    d = _get("https://api.agify.io", name=name)
    return f"Der Vorname {name} gehört im Durchschnitt zu Leuten, die etwa {d['age']} Jahre alt sind (agify, geschätzt aus {d['count']} Einträgen; nur ein Spaß)." if d.get("age") else f"Zum Vornamen {name} kennt agify kein Alter."


def meaning(word):
    d = _get(f"https://api.dictionaryapi.dev/api/v2/entries/en/{urllib.parse.quote(word.lower())}")[0]
    first = d["meanings"][0]
    return f"Englisches Wort {d['word']} ({first['partOfSpeech']}): {first['definitions'][0]['definition']}"


def dice(sides=6):
    return f"Würfel (W{sides}): {random.randint(1, sides)}"


def coin():
    return f"Münzwurf: {random.choice(['Kopf', 'Zahl'])}"


def eight_ball():
    return "Magische Kugel: " + random.choice(["Ja, ganz sicher.", "Auf jeden Fall.", "Sieht gut aus.", "Frag später noch einmal.", "Besser, ich sage es dir nicht.", "Darauf würde ich nicht wetten.", "Meine Quellen sagen nein.", "Sehr zweifelhaft."])


# ------------------------------------------------------------------------------------------------------------------ which question needs which tool
PLACE = r"([A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+(?: [A-ZÄÖÜ][A-Za-zÄÖÜäöüß\-]+)?)"
RULES = [
    ("weather", re.compile(r"(?:wetter|temperatur|regnet|schneit|wie warm|wie kalt|weather).{0,30}?\b(?:in|für|von|bei|at|for)\s+" + PLACE, re.I | re.S), lambda m: weather(_name(m.group(1)))),
    ("calc", re.compile(r"(?:rechne|berechne|was ist|wieviel ist|wie viel ist|calculate)\s*:?\s*([\d\s+\-*/^().,%]{3,60})\??\s*$", re.I), lambda m: calculate(m.group(1).replace(",", ".").strip())),
    ("currency", re.compile(r"(\d+(?:[.,]\d+)?)\s*([a-zA-Z\-]{3,9})\s+(?:in|zu|nach|to)\s+([a-zA-Z\-]{3,9})", re.I), None),
    ("crypto", re.compile(r"\b(bitcoin|btc|ethereum|eth|dogecoin|doge|solana|litecoin|xrp)\b", re.I), lambda m: crypto(COINS[m.group(1).lower()])),
    ("country", re.compile(r"(?:hauptstadt|einwohner|bevölkerung|währung|sprachen?|fläche)\s+(?:von|in|der|des)\s+" + PLACE, re.I), lambda m: wikipedia(_name(m.group(1)))),
    ("iss", re.compile(r"\b(?:iss|raumstation)\b", re.I), lambda m: iss()),
    ("earthquake", re.compile(r"erdbeben|earthquake", re.I), lambda m: earthquakes()),
    ("pokemon", re.compile(r"pok[eé]mon\s+([A-Za-z\-]{3,20})", re.I), lambda m: pokemon(m.group(1))),
    ("joke", re.compile(r"\b(?:witz|joke|witze)\b", re.I), lambda m: joke()),
    ("chuck", re.compile(r"chuck\s*norris", re.I), lambda m: chuck()),
    ("fact", re.compile(r"zufallsfakt|unnütz|nutzlos|useless fact|fun fact|irres wissen", re.I), lambda m: useless_fact()),
    ("advice", re.compile(r"\b(?:ratschlag|rat mir|advice)\b", re.I), lambda m: advice()),
    ("quote", re.compile(r"\b(?:zitat|weisheit|quote)\b", re.I), lambda m: quote()),
    ("name", re.compile(r"(?:wie alt|alter).{0,25}?(?:vorname|name)\s+" + PLACE, re.I), lambda m: age_of_name(_name(m.group(1)))),
    ("meaning", re.compile(r"(?:definition (?:von|of)|what does)\s+([A-Za-z]{3,20})(?: mean)?", re.I), lambda m: meaning(m.group(1))),
    ("dice", re.compile(r"würfel|wuerfel|\bdice\b|\bw(\d{1,3})\b", re.I), lambda m: dice(int(m.group(1)) if m.lastindex and 2 <= int(m.group(1)) <= 1000 else 6)),
    ("coin", re.compile(r"münze|muenze|kopf oder zahl|coin ?flip", re.I), lambda m: coin()),
    ("ball", re.compile(r"8[- ]?ball|magische kugel|magic ball", re.I), lambda m: eight_ball()),
    ("wiki", re.compile(r"^(?:wer|was)\s+(?:ist|war|sind|waren)\s+(?:ein|eine|der|die|das)?\s*(.{2,50}?)\s*\??$|(?:erzähl(?:e)? mir|sag mir|info(?:s)?)\s+(?:etwas |was )?(?:über|zu)\s+(.{2,50}?)\s*\??$", re.I), lambda m: wikipedia(_name(m.group(1) or m.group(2)))),
]


def _currency(match):
    source, target = CURRENCIES.get(match.group(2).lower()), CURRENCIES.get(match.group(3).lower())
    if not source or not target or source == target:
        raise ValueError("no pair")
    return currency(float(match.group(1).replace(",", ".")), source, target)


def run(question):
    """The answers of the services that fit the question (at most MAX_TOOLS): a text for Nex, or ""."""
    text = str(question or "")[:600]
    found = []
    for name, pattern, make in RULES:
        match = pattern.search(text)
        if match is None:
            continue
        try:
            found.append(_currency(match) if name == "currency" else make(match))
        except (requests.RequestException, ValueError, KeyError, IndexError, TypeError, AttributeError):
            logger.info("The service %s did not answer", name)
            continue
        if len(found) >= MAX_TOOLS:
            break
    if not found:
        return ""
    return "Daten aus kostenlosen Diensten (nutze sie, wenn sie zur Frage passen, und nenne die Quelle in einem Halbsatz):\n" + "\n".join(f"- {line}" for line in found)


def fallback_text(system, transcript, max_tokens=700):
    """The free AI of Pollinations as a second chance: one whole answer, or None. Without a key the service takes a request every few seconds and may be busy."""
    try:
        reply = requests.post(POLLINATIONS_TEXT, json={"model": "openai-fast", "messages": [{"role": "system", "content": system[:3000]}, {"role": "user", "content": transcript[:7000]}], "max_tokens": max_tokens, "private": True},
                              headers={**HEADERS, "Content-Type": "application/json"}, timeout=40)
        if reply.status_code != 200:
            return None
        text = reply.json()["choices"][0]["message"]["content"]
        return text.strip() or None
    except (requests.RequestException, ValueError, KeyError, IndexError, TypeError):
        return None
