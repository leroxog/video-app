"""Collects animated GIFs of Wikimedia Commons that may be used freely (CC0, public domain, CC BY, CC BY-SA) for the GIF library of Pulse.

    python scripts/fetch_cc_gifs.py [how many, default 320]

Writes static/gifs/cc/<slug>.gif and static/gifs/cc/index.json (title, author, licence, link to the page of the file on Commons: the page
/bildnachweise of the site lists them, as the licences ask for).  Quality does not matter, quantity does: every animated GIF with a usable
licence that is small enough and passes the checks of the library (yipi.gif_info) is taken.  Files that are larger than 420 px are taken as the
smaller version Commons makes of them (and the page says so).  Be polite to the server: a pause between calls, a name that says who asks.
"""
import hashlib
import json
import os
import re
import sys
import time

import requests

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("NRS_AUTO_INDEX", "0")
import yipi  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "gifs", "cc")
API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "PulseGifFetcher/1.0 (https://nexai.up.railway.app; collects freely licensed GIFs)"}
MAX_BYTES = 650_000
MAX_TOTAL = 48_000_000
TERMS = ["animation", "animated", "emoticon", "smiley", "emoji", "cat", "dog", "bird", "fish", "horse", "butterfly", "flower", "heart", "star", "fire", "flame", "fireworks",
         "rain", "snow", "sun", "moon", "earth", "clock", "loading", "spinner", "dance", "walking", "running", "jumping", "waving", "clapping", "laughing", "crying", "love", "party",
         "balloon", "cake", "gift", "robot", "rocket", "explosion", "arrow", "check mark", "thumbs up", "applause", "bouncing ball", "rotating", "spinning", "cartoon", "pixel",
         "sprite", "neon", "ocean waves", "lightning", "wind", "tree", "cloud", "water", "bubble", "ball", "dice", "coin", "heartbeat", "eye", "blinking", "face", "hand", "christmas",
         "halloween", "birthday", "easter", "coffee", "pizza", "apple", "banana", "bee", "frog", "duck", "rabbit", "bear", "monkey", "panda", "penguin", "owl", "elephant", "lion",
         "turtle", "snail", "spider", "dragon", "ghost", "skull", "crown", "diamond", "key", "bell", "candle", "music note", "guitar", "piano", "drum", "car", "train", "plane", "ship",
         "bicycle", "wheel", "gear", "magnet", "battery", "light bulb", "atom", "molecule", "planet", "galaxy", "comet", "aurora", "volcano", "tornado", "wave", "pendulum", "kaleidoscope",
         "mandala", "fractal", "flag", "logo", "icon", "button", "banner", "countdown", "progress", "sparkle", "glitter", "confetti", "rainbow", "unicorn", "mouse", "hamster", "cow",
         "pig", "sheep", "chicken", "bat", "shark", "whale", "dolphin", "octopus", "jellyfish", "crab", "worm", "ant", "fly", "leaf", "mushroom", "cactus", "rose", "tulip", "sunflower"]
BLOCKED = re.compile(r"nude|naked|sex|porn|penis|vagina|breast|genital|erotic|gore|nazi|swastika|hitler|killing|murder|blood|corpse|suicide|rape|torture|execution|isis|terror", re.I)


def allowed(licence):
    text = (licence or "").strip().lower()
    if not text or re.search(r"\bnc\b|\bnd\b|non-?commercial|no derivatives|gfdl|fair use|all rights reserved", text):
        return False
    return text.startswith(("cc0", "public domain", "pd", "cc by", "cc-by", "no restrictions", "copyrighted free use")) and "copyrighted free use" not in text


def clean(text, limit):
    text = re.sub(r"<[^>]+>", "", str(text or ""))
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&[a-z]+;|&#\d+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def title_of(file_title):
    name = re.sub(r"^File:", "", file_title)
    name = re.sub(r"\.gif$", "", name, flags=re.I).replace("_", " ")
    name = re.sub(r"\s+", " ", name).strip()
    return name[:yipi.MAX_GIF_TITLE].rstrip(" -,.(")


def search(term, offset):
    params = {"action": "query", "format": "json", "generator": "search", "gsrsearch": f"filemime:gif {term}", "gsrnamespace": 6, "gsrlimit": 50, "gsroffset": offset,
              "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 360,
              "iiextmetadatafilter": "LicenseShortName|LicenseUrl|Artist|Credit|Restrictions|NonFree"}
    for attempt in range(3):
        try:
            reply = requests.get(API, params=params, headers=HEADERS, timeout=30)
            if reply.status_code == 200:
                return reply.json()
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 * (attempt + 1))
    return {}


def download(url):
    for attempt in range(2):
        try:
            reply = requests.get(url, headers=HEADERS, timeout=40, stream=True)
            if reply.status_code != 200:
                time.sleep(1)
                continue
            data = b""
            for chunk in reply.iter_content(65536):
                data += chunk
                if len(data) > MAX_BYTES:
                    return None
            return data
        except requests.RequestException:
            time.sleep(1.5)
    return None


def main():
    goal = int(sys.argv[1]) if len(sys.argv) > 1 else 320
    os.makedirs(OUT, exist_ok=True)
    index_path = os.path.join(OUT, "index.json")
    entries = json.load(open(index_path, encoding="utf-8")) if os.path.exists(index_path) else []
    seen_pages = {entry["page"] for entry in entries}
    seen_hash = {entry["sha1"] for entry in entries}
    seen_titles = {entry["title"].lower() for entry in entries}
    total = sum(os.path.getsize(os.path.join(OUT, entry["file"])) for entry in entries if os.path.exists(os.path.join(OUT, entry["file"])))
    for term in TERMS:
        for offset in (0, 50):
            if len(entries) >= goal or total >= MAX_TOTAL:
                break
            pages = (search(term, offset).get("query") or {}).get("pages") or {}
            time.sleep(0.4)
            for page in sorted(pages.values(), key=lambda p: p.get("index", 0)):
                if len(entries) >= goal or total >= MAX_TOTAL:
                    break
                info = (page.get("imageinfo") or [None])[0]
                if not info or info.get("mime") != "image/gif":
                    continue
                meta = info.get("extmetadata") or {}
                licence = (meta.get("LicenseShortName") or {}).get("value", "")
                if not allowed(licence) or (meta.get("Restrictions") or {}).get("value") or (meta.get("NonFree") or {}).get("value") in ("true", "1", True):
                    continue
                file_title = page["title"]
                title = title_of(file_title)
                if len(title) < 3 or BLOCKED.search(file_title) or title.lower() in seen_titles or page["title"] in seen_pages:
                    continue
                original = info["url"]
                small = info["size"] <= MAX_BYTES and info["width"] <= 420
                url = original if small else info.get("thumburl")
                if not url:
                    continue
                data = download(url)
                time.sleep(0.3)
                if not data:
                    continue
                gif = yipi.gif_info(data)
                digest = hashlib.sha1(data).hexdigest()
                if gif is None or gif[2] < 2 or digest in seen_hash or len(data) > MAX_BYTES:
                    continue
                slug = digest[:12]
                with open(os.path.join(OUT, f"{slug}.gif"), "wb") as handle:
                    handle.write(data)
                entries.append({"slug": slug, "file": f"{slug}.gif", "title": title, "author": clean((meta.get("Artist") or {}).get("value", ""), 90) or "unbekannt",
                                "licence": clean(licence, 40), "licenceUrl": clean((meta.get("LicenseUrl") or {}).get("value", ""), 200),
                                "page": file_title, "pageUrl": "https://commons.wikimedia.org/wiki/" + file_title.replace(" ", "_"), "resized": not small, "sha1": digest})
                seen_pages.add(file_title)
                seen_hash.add(digest)
                seen_titles.add(title.lower())
                total += len(data)
                if len(entries) % 20 == 0:
                    print(f"{len(entries)} GIFs, {total // 1024} KB, last term: {term}", flush=True)
                    json.dump(entries, open(index_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        if len(entries) >= goal or total >= MAX_TOTAL:
            break
    json.dump(entries, open(index_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"done: {len(entries)} GIFs, {total // 1024} KB")


if __name__ == "__main__":
    main()
