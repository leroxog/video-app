"""Satürn rankings that people make themselves (yipi_ranking.py): a person gives a ranking a title, a Top 5 or Top 10 and a list of entries (a name and a picture each), and everybody on Satürn
can play it in the camera (the reel above the head, see static/js/pg-rank.js). The list is stored as JSON in the row of the game (kind "ranking"); a picture is a file of the person on
Satürn (uploaded, or fetched here from Wikimedia Commons for the person: only thumbnails of freely licensed pictures from upload.wikimedia.org, with the author and the licence kept for the
page /bildnachweise). The AI can suggest the entries for a title. Nothing from a person ever runs as code."""
import json
import re
import urllib.parse

import requests

SIZES = (5, 10)
MAX_ENTRIES = 24
MAX_NAME = 30
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
THUMB_HOST = "upload.wikimedia.org"
MAX_THUMB_BYTES = 500_000
HEADERS = {"User-Agent": "NexBot/1.0 (https://nexai.up.railway.app; ranking pictures) python-requests"}
FREE_LICENCE = re.compile(r"^(CC0|Public domain|PD\b|CC[ -]BY(?![- ]NC)(?![- ]ND))", re.I)
MEDIA_ID = re.compile(r"[0-9a-f]{32}")
FILE_PAGE = "https://commons.wikimedia.org/wiki/File:"


def clean_name(raw):
    name = re.sub(r"[\x00-\x1f<>]+", " ", raw if isinstance(raw, str) else "")
    return re.sub(r"\s+", " ", name).strip()[:MAX_NAME]


def clean_credit(raw):
    """{author, licence, page} of a picture of Wikimedia Commons, or None."""
    if not isinstance(raw, dict):
        return None
    page = raw.get("page") if isinstance(raw.get("page"), str) else ""
    if not page.startswith(FILE_PAGE) or len(page) > 300:
        return None
    author = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f<>]", " ", str(raw.get("author") or ""))).strip()[:80]
    licence = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f<>]", " ", str(raw.get("licence") or ""))).strip()[:40]
    return {"author": author or "Unbekannt", "licence": licence or "frei", "page": page}


def clean_ranking(raw, owns, sensitive=None):
    """(the JSON to store, "") for what the form sent ({size, entries: [{name, media, credit}]}), or (None, the reason in German).
    `owns(media_id)` says whether the picture belongs to the person; `sensitive(text)` is true for a name nobody may use."""
    if not isinstance(raw, dict):
        return None, "Die Rangliste ist leer."
    size = raw.get("size")
    if size not in SIZES:
        return None, "Wähle Top 5 oder Top 10."
    entries = []
    seen = set()
    for item in raw.get("entries") if isinstance(raw.get("entries"), list) else []:
        if not isinstance(item, dict):
            continue
        name = clean_name(item.get("name"))
        if len(name) < 1 or name.lower() in seen:
            continue
        if sensitive and sensitive(name):
            return None, f"„{name}“ passt nicht."
        seen.add(name.lower())
        entry = {"name": name}
        media = item.get("media")
        if isinstance(media, str) and MEDIA_ID.fullmatch(media) and owns(media):
            entry["media"] = media
            credit = clean_credit(item.get("credit"))
            if credit:
                entry["credit"] = credit
        entries.append(entry)
    if len(entries) < size:
        return None, f"Für eine Top {size} brauchst du mindestens {size} Einträge."
    if len(entries) > MAX_ENTRIES:
        return None, f"Höchstens {MAX_ENTRIES} Einträge."
    return json.dumps({"size": size, "entries": entries}, ensure_ascii=False, separators=(",", ":")), ""


def parse(stored):
    """The ranking of a row as {size, entries} or None."""
    try:
        data = json.loads(stored)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("size") not in SIZES or not isinstance(data.get("entries"), list):
        return None
    return data


def media_ids(stored):
    """The pictures a stored ranking uses (so that they are not cleaned away as unused)."""
    data = parse(stored)
    return {entry["media"] for entry in (data["entries"] if data else []) if isinstance(entry, dict) and isinstance(entry.get("media"), str)}


# ---------------------------------------------------------------------------------------------------------------- pictures of Wikimedia Commons
def _plain(html):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]*>", "", str(html or ""))).strip()


def search_images(query, limit=8):
    """Freely licensed pictures for a name: [{url (a thumbnail), title, author, licence, page}], best matches first. Empty when Commons does not answer."""
    query = re.sub(r"\s+", " ", query if isinstance(query, str) else "").strip()[:60]
    if len(query) < 2:
        return []
    params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": f"filetype:bitmap {query}", "gsrnamespace": 6, "gsrlimit": 16, "prop": "imageinfo",
              "iiprop": "url|extmetadata|mime|size", "iiurlwidth": 320, "iiextmetadatafilter": "LicenseShortName|Artist|NonFree", "uselang": "de"}
    try:
        reply = requests.get(COMMONS_API, params=params, headers=HEADERS, timeout=12)
        pages = (reply.json().get("query") or {}).get("pages") or {}
    except (requests.RequestException, ValueError):
        return []
    found = []
    for page in sorted(pages.values(), key=lambda row: row.get("index", 0)):
        info = (page.get("imageinfo") or [None])[0]
        if not info or info.get("mime") not in ("image/jpeg", "image/png", "image/webp"):
            continue
        meta = info.get("extmetadata") or {}
        licence = _plain((meta.get("LicenseShortName") or {}).get("value"))
        if not FREE_LICENCE.match(licence) or _plain((meta.get("NonFree") or {}).get("value")).lower() == "true":
            continue
        thumb = info.get("thumburl") or ""
        if urllib.parse.urlparse(thumb).hostname != THUMB_HOST or min(info.get("width") or 0, info.get("height") or 0) < 180:
            continue
        title = re.sub(r"^File:", "", str(page.get("title") or ""))
        found.append({"url": thumb, "title": title[:80], "author": _plain((meta.get("Artist") or {}).get("value"))[:80] or "Unbekannt", "licence": licence[:40],
                      "page": FILE_PAGE + urllib.parse.quote(title.replace(" ", "_"), safe="_().,-'")})
        if len(found) >= limit:
            break
    return found


def fetch_thumb(url):
    """The bytes of a thumbnail from upload.wikimedia.org, or None (another host, too big, not found)."""
    parts = urllib.parse.urlparse(url if isinstance(url, str) else "")
    if parts.scheme != "https" or parts.hostname != THUMB_HOST or parts.port not in (None, 443) or len(url) > 600:
        return None
    try:
        reply = requests.get(url, headers=HEADERS, timeout=15, stream=True, allow_redirects=False)
        if reply.status_code != 200:
            return None
        data = b""
        for chunk in reply.iter_content(32768):
            data += chunk
            if len(data) > MAX_THUMB_BYTES:
                return None
    except requests.RequestException:
        return None
    return data if 0 < len(data) <= MAX_THUMB_BYTES else None


# ---------------------------------------------------------------------------------------------------------------- the AI suggests entries
def suggest(title, generate, how_many=12):
    """Names for a ranking with this title, from the AI service (`generate(system, message, ...)`), or an empty list."""
    title = re.sub(r"\s+", " ", title if isinstance(title, str) else "").strip()[:60]
    if len(title) < 3:
        return []
    raw = generate(f"Du hilfst bei einer Rangliste für eine Kamera-App. Nenne {how_many} verschiedene, bekannte und passende Einträge für die Rangliste mit dem Titel der Person. Jeder Eintrag ist ein kurzer Name "
                   "(höchstens 3 Wörter, so geschrieben, dass man dazu ein Foto auf Wikipedia findet). Antworte NUR mit einer JSON-Liste aus Texten, zum Beispiel [\"Messi\", \"Ronaldo\"].",
                   title, max_tokens=300, temperature=0.5)
    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        names = json.loads(raw[start:end + 1])
    except ValueError:
        return []
    out = []
    for name in names if isinstance(names, list) else []:
        name = clean_name(name)
        if name and name.lower() not in {n.lower() for n in out}:
            out.append(name)
    return out[:how_many]
