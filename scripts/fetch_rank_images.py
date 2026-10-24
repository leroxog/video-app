"""Collects the pictures for the ranking games of the camera tab (footballers, musicians, countries) from Wikimedia Commons, only files that may be used freely
(CC0, public domain, CC BY, CC BY-SA).

    python scripts/fetch_rank_images.py

Writes static/rank/<category>/<slug>.jpg and static/rank/index.json (name, author, licence, link to the page of the file on Commons: the page /bildnachweise lists
them, as the licences ask for).  A person is taken with the main picture of the English Wikipedia article (when that file lives on Commons and has a usable licence), cut to a
square around the face and made 256 pixels big; a country is taken with its flag (the picture is kept as it is, 256 pixels wide).  Names without a usable picture are left out.
Be polite to the server: a pause between calls, a name that says who asks.
"""
import io
import json
import os
import re
import sys
import time

import requests
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "rank")
WIKI = "https://en.wikipedia.org/w/api.php"
COMMONS = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "NexRankImages/1.0 (https://nexai.up.railway.app; collects freely licensed pictures for a small game)"}

PEOPLE = {
    "footballers": [
        ("Lionel Messi", "Lionel Messi"), ("Cristiano Ronaldo", "Cristiano Ronaldo"), ("Kylian Mbappé", "Kylian Mbappé"), ("Erling Haaland", "Erling Haaland"), ("Manuel Neuer", "Manuel Neuer"),
        ("Thomas Müller", "Thomas Müller"), ("Jamal Musiala", "Jamal Musiala"), ("Florian Wirtz", "Florian Wirtz"), ("Toni Kroos", "Toni Kroos"), ("Pelé", "Pelé"),
        ("Diego Maradona", "Diego Maradona"), ("Franz Beckenbauer", "Franz Beckenbauer"), ("Zinedine Zidane", "Zinedine Zidane"), ("Ronaldinho", "Ronaldinho"), ("Neymar", "Neymar"),
        ("Robert Lewandowski", "Robert Lewandowski"), ("Luka Modrić", "Luka Modrić"), ("Kevin De Bruyne", "Kevin De Bruyne"), ("Mohamed Salah", "Mohamed Salah"), ("Harry Kane", "Harry Kane"),
        ("Vinícius Júnior", "Vinícius Júnior"), ("Jude Bellingham", "Jude Bellingham"), ("Lamine Yamal", "Lamine Yamal"), ("Pedri", "Pedri"), ("Joshua Kimmich", "Joshua Kimmich"),
        ("Kai Havertz", "Kai Havertz"), ("İlkay Gündoğan", "İlkay Gündoğan"), ("Miroslav Klose", "Miroslav Klose"), ("Michael Ballack", "Michael Ballack"), ("Mesut Özil", "Mesut Özil"),
        ("Mario Götze", "Mario Götze"), ("Bastian Schweinsteiger", "Bastian Schweinsteiger"), ("Philipp Lahm", "Philipp Lahm"), ("Oliver Kahn", "Oliver Kahn"), ("Gianluigi Buffon", "Gianluigi Buffon"),
        ("Andrés Iniesta", "Andrés Iniesta"), ("Xavi", "Xavi"), ("Johan Cruyff", "Johan Cruyff"), ("Thierry Henry", "Thierry Henry"), ("David Beckham", "David Beckham"),
        ("Zlatan Ibrahimović", "Zlatan Ibrahimović"), ("Gerd Müller", "Gerd Müller"), ("Lothar Matthäus", "Lothar Matthäus"), ("Marco Reus", "Marco Reus"), ("Leroy Sané", "Leroy Sané"),
        ("Antonio Rüdiger", "Antonio Rüdiger"), ("Ter Stegen", "Marc-André ter Stegen"), ("Karim Benzema", "Karim Benzema"), ("Luis Suárez", "Luis Suárez"), ("Son Heung-min", "Son Heung-min"),
    ],
    "musicians": [
        ("Taylor Swift", "Taylor Swift"), ("Ed Sheeran", "Ed Sheeran"), ("Billie Eilish", "Billie Eilish"), ("Drake", "Drake (musician)"), ("The Weeknd", "The Weeknd"),
        ("Eminem", "Eminem"), ("Rihanna", "Rihanna"), ("Beyoncé", "Beyoncé"), ("Ariana Grande", "Ariana Grande"), ("Bruno Mars", "Bruno Mars"),
        ("Adele", "Adele"), ("Justin Bieber", "Justin Bieber"), ("Dua Lipa", "Dua Lipa"), ("Shakira", "Shakira"), ("Lady Gaga", "Lady Gaga"),
        ("Kanye West", "Kanye West"), ("Travis Scott", "Travis Scott"), ("Post Malone", "Post Malone"), ("Harry Styles", "Harry Styles"), ("Capital Bra", "Capital Bra"),
        ("Apache 207", "Apache 207"), ("Helene Fischer", "Helene Fischer"), ("Sido", "Sido"), ("Bushido", "Bushido (rapper)"), ("Cro", "Cro (rapper)"),
        ("Mark Forster", "Mark Forster"), ("Lena Meyer-Landrut", "Lena Meyer-Landrut"), ("Nena", "Nena"), ("Herbert Grönemeyer", "Herbert Grönemeyer"), ("Michael Jackson", "Michael Jackson"),
        ("Madonna", "Madonna (entertainer)"), ("Elvis Presley", "Elvis Presley"), ("Freddie Mercury", "Freddie Mercury"), ("John Lennon", "John Lennon"), ("Bob Marley", "Bob Marley"),
        ("Snoop Dogg", "Snoop Dogg"), ("Jay-Z", "Jay-Z"), ("Kendrick Lamar", "Kendrick Lamar"), ("Shawn Mendes", "Shawn Mendes"), ("Selena Gomez", "Selena Gomez"),
        ("Katy Perry", "Katy Perry"), ("Miley Cyrus", "Miley Cyrus"), ("Olivia Rodrigo", "Olivia Rodrigo"), ("Sabrina Carpenter", "Sabrina Carpenter"), ("Nicki Minaj", "Nicki Minaj"),
        ("David Guetta", "David Guetta"), ("Calvin Harris", "Calvin Harris"), ("Kollegah", "Kollegah"), ("Farid Bang", "Farid Bang"), ("Max Giesinger", "Max Giesinger"),
    ],
}
COUNTRIES = [
    ("Deutschland", "Flag of Germany.svg"), ("Frankreich", "Flag of France.svg"), ("Italien", "Flag of Italy.svg"), ("Spanien", "Flag of Spain.svg"), ("Brasilien", "Flag of Brazil.svg"),
    ("Argentinien", "Flag of Argentina.svg"), ("USA", "Flag of the United States.svg"), ("Japan", "Flag of Japan.svg"), ("Kanada", "Flag of Canada (Pantone).svg"), ("Australien", "Flag of Australia (converted).svg"),
    ("Schweiz", "Flag of Switzerland.svg"), ("Österreich", "Flag of Austria.svg"), ("Türkei", "Flag of Turkey.svg"), ("Polen", "Flag of Poland.svg"), ("Griechenland", "Flag of Greece.svg"),
    ("Portugal", "Flag of Portugal.svg"), ("Niederlande", "Flag of the Netherlands.svg"), ("England", "Flag of England.svg"), ("Mexiko", "Flag of Mexico.svg"), ("Indien", "Flag of India.svg"),
    ("China", "Flag of the People's Republic of China.svg"), ("Südkorea", "Flag of South Korea.svg"), ("Ägypten", "Flag of Egypt.svg"), ("Marokko", "Flag of Morocco.svg"), ("Norwegen", "Flag of Norway.svg"),
    ("Schweden", "Flag of Sweden.svg"), ("Dänemark", "Flag of Denmark.svg"), ("Irland", "Flag of Ireland.svg"), ("Neuseeland", "Flag of New Zealand.svg"), ("Südafrika", "Flag of South Africa.svg"),
    ("Belgien", "Flag of Belgium.svg"), ("Kroatien", "Flag of Croatia.svg"), ("Ukraine", "Flag of Ukraine.svg"), ("Island", "Flag of Iceland.svg"), ("Jamaika", "Flag of Jamaica.svg"),
    ("Kolumbien", "Flag of Colombia.svg"), ("Chile", "Flag of Chile.svg"), ("Peru", "Flag of Peru.svg"), ("Thailand", "Flag of Thailand.svg"), ("Vietnam", "Flag of Vietnam.svg"),
]


def allowed(licence):
    text = (licence or "").strip().lower()
    if not text or re.search(r"\bnc\b|\bnd\b|non-?commercial|no derivatives|gfdl|fair use|all rights reserved", text):
        return False
    return text.startswith(("cc0", "public domain", "pd", "cc by", "cc-by", "no restrictions"))


def clean(text, limit):
    text = re.sub(r"<[^>]+>", "", str(text or ""))
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&[a-z]+;|&#\d+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def get(url, **params):
    for attempt in range(3):
        try:
            reply = requests.get(url, params=params or None, headers=HEADERS, timeout=40)
            if reply.status_code == 200:
                return reply
        except requests.RequestException:
            pass
        time.sleep(2 * (attempt + 1))
    return None


def lead_file(article):
    reply = get(WIKI, action="query", format="json", prop="pageimages", piprop="name", titles=article, redirects=1)
    if reply is None:
        return ""
    pages = (reply.json().get("query") or {}).get("pages") or {}
    for page in pages.values():
        if page.get("pageimage"):
            return page["pageimage"]
    return ""


def file_info(name, width):
    reply = get(COMMONS, action="query", format="json", prop="imageinfo", iiprop="url|mime|extmetadata", iiurlwidth=width, titles=f"File:{name}",
                iiextmetadatafilter="LicenseShortName|LicenseUrl|Artist|NonFree|Restrictions")
    if reply is None:
        return None
    pages = (reply.json().get("query") or {}).get("pages") or {}
    for page in pages.values():
        info = (page.get("imageinfo") or [None])[0]
        if not info or page.get("missing") is not None:
            continue
        meta = info.get("extmetadata") or {}
        licence = clean((meta.get("LicenseShortName") or {}).get("value"), 60)
        if (meta.get("NonFree") or {}).get("value") in ("true", "1", True) or not allowed(licence):
            return None
        return {"url": info.get("thumburl") or info.get("url"), "page": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/File:{name}",
                "licence": licence, "licenceUrl": clean((meta.get("LicenseUrl") or {}).get("value"), 200),
                "author": clean((meta.get("Artist") or {}).get("value"), 120) or "unbekannt", "mime": info.get("mime", "")}
    return None


def square_face(image, size=256):
    image = image.convert("RGB")
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = int((height - side) * 0.12)
    return image.crop((left, top, left + side, top + side)).resize((size, size), Image.LANCZOS)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    index = {}
    for category, people in PEOPLE.items():
        folder = os.path.join(OUT, category)
        os.makedirs(folder, exist_ok=True)
        entries = []
        for name, article in people:
            slug = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("é", "e").replace("ö", "o").replace("ü", "u").replace("ä", "a").replace("ć", "c").replace("í", "i").replace("ş", "s").replace("ğ", "g").replace("ı", "i").replace("ó", "o").replace("á", "a")).strip("-")
            file_name = lead_file(article)
            time.sleep(0.25)
            info = file_info(file_name, 480) if file_name else None
            time.sleep(0.25)
            if not info or not info["url"] or not info["mime"].startswith("image/") or info["mime"] == "image/svg+xml":
                print("skip", name, "-", "no free picture" if file_name else "no picture")
                continue
            picture = get(info["url"])
            if picture is None:
                print("skip", name, "- download failed")
                continue
            try:
                image = Image.open(io.BytesIO(picture.content))
                square_face(image).save(os.path.join(folder, f"{slug}.jpg"), "JPEG", quality=82, optimize=True)
            except Exception as error:  # noqa: BLE001
                print("skip", name, "-", error)
                continue
            entries.append({"slug": slug, "name": name, "file": f"{slug}.jpg", "author": info["author"], "licence": info["licence"], "licenceUrl": info["licenceUrl"], "pageUrl": info["page"]})
            print("ok  ", name, "-", info["licence"])
            time.sleep(0.3)
        index[category] = entries
    folder = os.path.join(OUT, "countries")
    os.makedirs(folder, exist_ok=True)
    entries = []
    for name, file_name in COUNTRIES:
        info = file_info(file_name, 256)
        time.sleep(0.25)
        if not info or not info["url"]:
            print("skip", name, "- no free flag")
            continue
        picture = get(info["url"])
        if picture is None:
            print("skip", name, "- download failed")
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")).strip("-")
        try:
            image = Image.open(io.BytesIO(picture.content)).convert("RGB")
            image.thumbnail((256, 256), Image.LANCZOS)
            image.save(os.path.join(folder, f"{slug}.jpg"), "JPEG", quality=86, optimize=True)
        except Exception as error:  # noqa: BLE001
            print("skip", name, "-", error)
            continue
        entries.append({"slug": slug, "name": name, "file": f"{slug}.jpg", "author": info["author"], "licence": info["licence"], "licenceUrl": info["licenceUrl"], "pageUrl": info["page"]})
        print("ok  ", name, "-", info["licence"])
        time.sleep(0.3)
    index["countries"] = entries
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as handle:
        json.dump(index, handle, ensure_ascii=False, indent=1)
    print({category: len(entries) for category, entries in index.items()})


if __name__ == "__main__":
    sys.exit(main())
