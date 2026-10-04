"""gomat's finish: security headers, app manifest and icons, link previews, robots/sitemap, error pages,
the monkey mascot, and the quality of the German texts."""
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import gomat  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NODE = shutil.which("node")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


def png_size(path):
    with open(path, "rb") as handle:
        header = handle.read(24)
    assert header[:8] == b"\x89PNG\r\n\x1a\n", path
    return struct.unpack(">II", header[16:24])


# ------------------------------------------------------------------ security headers

@pytest.mark.parametrize("path", ["/", "/datenschutz", "/impressum"])
def test_pages_send_a_strict_content_security_policy_and_other_security_headers(client, path):
    r = client.get(path, headers={"X-Forwarded-Proto": "https"})
    csp = r.headers["Content-Security-Policy"]
    for part in ("default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "connect-src 'self'"):
        assert part in csp, part
    assert "'unsafe-eval'" not in csp and "script-src 'self' 'unsafe-inline'" not in csp and "http:" not in csp.replace("https:", "")
    assert r.headers["X-Content-Type-Options"] == "nosniff" and r.headers["X-Frame-Options"] == "DENY"
    assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin" and "microphone=(self)" in r.headers["Permissions-Policy"] and "camera=()" in r.headers["Permissions-Policy"]
    assert r.headers["Strict-Transport-Security"].startswith("max-age=")
    assert "Strict-Transport-Security" not in client.get(path).headers            # plain http (local development): no HSTS


def test_the_api_is_never_cached_and_sniffing_is_off(client):
    for path in ("/api/gomat/lesson/1-1?seed=1", "/api/gomat/practice?seed=1"):
        r = client.get(path)
        assert r.headers["Cache-Control"] == "no-store" and r.headers["X-Content-Type-Options"] == "nosniff"


def test_the_page_templates_have_nothing_a_strict_policy_would_block():
    for name in ("gomat.html", "gomat_legal.html", "gomat_error.html"):
        text = read("templates", name)
        for tag in re.findall(r"<script\b[^>]*>", text):
            assert "src=" in tag or 'type="application/json"' in tag, (name, tag)
        assert not re.search(r"\son[a-z]+\s*=", text), name              # no inline event handlers
        assert 'style="' not in text and "javascript:" not in text, name


# --------------------------------------------------------------------- app, icons, previews

def test_the_web_app_manifest_describes_an_installable_app(client):
    r = client.get("/manifest.webmanifest")
    data = json.loads(r.get_data(as_text=True))
    assert r.status_code == 200 and r.mimetype == "application/manifest+json" and r.headers.get_all("Set-Cookie") == []
    assert (data["name"], data["short_name"], data["lang"], data["display"], data["start_url"]) == ("gomat – Mathe lernen", "gomat", "de", "standalone", "/")
    assert data["theme_color"] == "#1cb0f6" and data["background_color"] == "#ffffff"
    purposes = {(i["sizes"], i["purpose"]) for i in data["icons"]}
    assert purposes == {("192x192", "any"), ("512x512", "any"), ("512x512", "maskable")}
    for icon in data["icons"]:
        path = os.path.join(ROOT, icon["src"].lstrip("/").replace("/", os.sep))
        assert png_size(path) == tuple(int(n) for n in icon["sizes"].split("x")), icon["src"]


def test_icons_and_the_link_preview_picture_have_the_right_sizes():
    img = os.path.join(ROOT, "static", "img")
    assert png_size(os.path.join(img, "gomat-180.png")) == (180, 180)
    assert png_size(os.path.join(img, "gomat-og.png")) == (1200, 630)
    assert os.path.getsize(os.path.join(img, "gomat-og.png")) < 300_000
    ET.parse(os.path.join(img, "gomat-icon.svg"))


def test_the_home_page_has_link_preview_and_app_meta_tags(client):
    text = client.get("/", headers={"Host": "gomat.example", "X-Forwarded-Proto": "https"}).get_data(as_text=True)
    for fragment in ('<meta property="og:title" content="gomat – Mathe lernen, Schritt für Schritt">', '<meta property="og:locale" content="de_DE">',
                     '<meta property="og:image" content="https://gomat.example/static/img/gomat-og.png">', '<meta name="twitter:card" content="summary_large_image">',
                     '<link rel="canonical" href="https://gomat.example/">', '<link rel="manifest" href="/manifest.webmanifest">', '<meta name="theme-color" content="#1cb0f6">',
                     'rel="apple-touch-icon"', '<a class="skip" href="#main">Zum Inhalt springen</a>', '<html lang="de">'):
        assert fragment in text, fragment
    assert "noindex" not in text


def test_static_files_carry_their_modification_time_so_updates_reach_everyone(client):
    text = client.get("/").get_data(as_text=True)
    for name in ("css/gomat.css", "js/gomat.js", "js/gomat-core.js", "js/gomat-art.js", "js/gomat-sound.js"):
        version = int(os.path.getmtime(os.path.join(ROOT, "static", *name.split("/"))))
        assert f"/static/{name}?v={version}" in text, name
    assert client.get(f"/static/js/gomat.js?v=1").status_code == 200


def test_robots_and_sitemap(client):
    robots = client.get("/robots.txt", headers={"X-Forwarded-Proto": "https", "Host": "gomat.example"})
    text = robots.get_data(as_text=True)
    assert robots.status_code == 200 and robots.mimetype == "text/plain" and "Allow: /\n" in text
    for path in ("/api/", "/ysound-archiv", "/sound-archiv", "/nex-archiv"):
        assert f"Disallow: {path}\n" in text, path
    assert "Sitemap: https://gomat.example/sitemap.xml" in text
    sitemap = client.get("/sitemap.xml", headers={"Host": "gomat.example"})
    root = ET.fromstring(sitemap.data)
    urls = [e.text for e in root.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    assert sitemap.mimetype == "application/xml" and urls == ["http://gomat.example/", "http://gomat.example/datenschutz", "http://gomat.example/impressum"]
    for path in ("/robots.txt", "/sitemap.xml", "/manifest.webmanifest"):
        assert client.get(path).headers.get_all("Set-Cookie") == [], path


# ---------------------------------------------------------------------------- error pages

def test_unknown_pages_get_a_friendly_404_and_no_cookie(client):
    r = client.get("/gibt-es-nicht")
    text = r.get_data(as_text=True)
    assert r.status_code == 404 and "Diese Seite gibt es nicht" in text and 'href="/"' in text and "gomi-sad.svg" in text
    assert '<meta name="robots" content="noindex">' in text and r.headers.get_all("Set-Cookie") == []
    api = client.get("/api/gomat/nope")
    assert api.status_code == 404 and api.get_json() == {"ok": False, "error": "not_found"}
    assert client.get("/api/ylib/items").status_code == 401 or client.get("/api/ylib/items").status_code == 302


def test_a_crash_shows_the_friendly_500_page_without_details(client, monkeypatch):
    def boom():
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(gomat, "public_curriculum", boom)
    r = client.get("/")
    text = r.get_data(as_text=True)
    assert r.status_code == 500 and "Da ist etwas schiefgelaufen" in text and "gomi-sad.svg" in text
    assert "secret internal detail" not in text and "Traceback" not in text and "noindex" in text


# ----------------------------------------------------------------------------- the monkey

def test_the_mascot_is_a_monkey_with_three_moods_and_the_files_match_the_script():
    source = read("static", "js", "gomat-art.js")
    assert "Gomi, the maths monkey" in source and "owl" not in source.lower() and "Eule" not in source
    assert "Mathe-Affe" in source and "Mathe-Affe" in read("static", "js", "gomat.js")
    images = {}
    for name in ("gomi.svg", "gomi-sad.svg", "gomi-cheer.svg"):
        tree = ET.parse(os.path.join(ROOT, "static", "img", name))
        shapes = [e for e in tree.iter() if e.tag.split("}")[1] in ("circle", "ellipse", "path", "rect")]
        assert len(shapes) >= 20, name                                   # ears, face, eyes, arms, shirt, tail ...
        assert not [e for e in tree.iter() if e.tag.split("}")[1] in ("script", "image", "foreignObject")], name
        images[name] = open(os.path.join(ROOT, "static", "img", name), encoding="utf-8").read()
    assert len(set(images.values())) == 3
    assert "2b1d14" in images["gomi.svg"] and "#8a5a3b" in images["gomi.svg"]          # brown fur, dark features


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_the_exported_mascot_files_are_up_to_date():
    result = subprocess.run([NODE, os.path.join(ROOT, "scripts", "export_mascot.js"), "--check"], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr


# ----------------------------------------------------------------------------- German texts

TEXT_FIELDS = ("prompt", "explain")


def all_texts(seeds=range(12)):
    for lesson_id in gomat.LESSONS:
        for seed in seeds:
            for e in gomat.lesson_exercises(lesson_id, seed):
                for field in TEXT_FIELDS:
                    yield lesson_id, e["family"], field, e[field]
                for option in e.get("options") or []:
                    yield lesson_id, e["family"], "option", option


def test_exercise_texts_are_clean_german_sentences():
    for lesson_id, family, field, text in all_texts():
        where = (lesson_id, family, field, text)
        assert text == text.strip() and "  " not in text and "\t" not in text and "\n" not in text, where
        assert not re.search(r"\s[,.;:!]|(?<!=)\s\?", text), where              # no space before punctuation (" = ?" is maths)
        assert '"' not in text and "'" not in text, where                       # typographic quotes only
        if field == "option":
            continue
        has_word = re.search(r"[A-Za-zÄÖÜäöüß]{4,}", text)
        if has_word:
            assert text[0].isupper() or not text[0].isalpha() or text.startswith(("x ", "xy")), where   # capital, or an equation in x
            assert text[-1] in ".?!)…▢" or text.endswith(("%", "°", "cm²", "²")) or re.search(r"\d$", text), where
        if field == "explain":
            assert text[-1] in ".!)", where


def test_known_awkward_phrases_are_gone():
    forbidden = ["Runde 17 auf Zehner.", "das ergibt dasselbe", "mit 4 mal etwas bekommst", "Wie viele bekommt jedes?", "Setze Komma", "nehme sie mal",
                 "Gegenteil von Malnehmen", "den Rest (", "weg."]
    seen = "\n".join(t for _, _, _, t in all_texts(range(30)))
    assert not re.search(r"Runde \d+ auf Zehner\.", seen)
    for phrase in forbidden[1:]:
        assert phrase not in seen, phrase
    assert "Wie viele Bonbons bekommt jedes Kind?" in seen or "bekommt jeder" in seen


def test_division_word_problems_agree_in_gender():
    import random
    text = "\n".join(gomat.divide_word(random.Random(n), {"rows": [3, 4]})["prompt"] for n in range(80))
    for group, each in (("Kinder", "jedes Kind"), ("Freunde", "jeder Freund"), ("Gäste", "jeder Gast")):
        assert f"{group} verteilt" in text and f"bekommt {each}?" in text
        assert not re.search(rf"{group} verteilt\. Wie viele \w+ bekommt (?!{each})", text)


def test_the_page_script_uses_the_better_german_and_says_serie_not_streak():
    source = read("static", "js", "gomat.js") + read("static", "js", "gomat-core.js")
    for good in ("Deine Serie:", "Mathe lernen mit gomat", "Hallo, ich bin Gomi, dein Mathe-Affe!", "Wie viel möchtest du täglich üben?", "Nicht ganz",
                 "Richtige Lösung: ", "Wiederholen", "Zur nächsten Lektion", "Üben und Herz verdienen", "Wochenserie", "Monatsserie", "Drei Tage in Folge",
                 "Wenn du jetzt aufhörst", "Fehler kosten hier kein Herz", "Entspannt", "Ehrgeizig", "unwiderruflich"):
        assert good in source, good
    for bad in ("Leider falsch", "Nochmal üben", "Weiter geht’s hier", "Ich bin schon weit", "Ernsthaft", "Wochen-Serie", "Drei Tage dran", "Mathe-Lerner"):
        assert bad not in source, bad
    visible = re.findall(r'"([^"\n]*Streak[^"\n]*)"|`([^`\n]*Streak[^`\n]*)`', source)
    assert [pair for pair in visible if not re.search(r"state\.\w*Streak|raw\.\w*Streak|bestStreak", "".join(pair))] == []


def test_course_titles_and_descriptions_are_tidy():
    for unit in gomat.UNITS:
        for text in [unit["title"], unit["desc"]] + [l["title"] for l in unit["lessons"]]:
            assert text == text.strip() and "  " not in text and (text[0].isupper() or text[0].isdigit() or text.startswith("x ")), text
            assert not text.endswith(".") and '"' not in text, text
    assert [u["title"] for u in gomat.UNITS][6] == "Negative Zahlen und Rechenregeln"
