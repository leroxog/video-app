"""The freely licensed GIFs (2026-10-18): hundreds of animated GIFs of Wikimedia Commons (CC0, public domain, CC BY, CC BY-SA) are part of the library,
and the page /bildnachweise says who made them and under which licence, as the licences ask."""
import json
import os
import re
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
CC_DIR = os.path.join(yipi.STARTER_DIR, "cc")
ALLOWED = re.compile(r"^(CC0|Public domain|PD\b.*|CC BY(-SA)? \d\.\d( [A-Za-z]+)?)$")
BLOCKED = re.compile(r"nude|naked|sex|porn|penis|vagina|breast|genital|erotic|gore|nazi|swastika|hitler|killing|murder|blood|corpse|suicide|rape|torture|execution|isis|terror|shit|fuck|nigg|retard|slut|whore|gay", re.I)


@pytest.fixture(autouse=True)
def fast_passwords(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


def entries():
    with open(os.path.join(CC_DIR, "index.json"), encoding="utf-8") as handle:
        return json.load(handle)


def test_there_are_many_free_gifs_and_every_one_is_valid_and_allowed():
    found = entries()
    assert len(found) >= 150, "quantity matters: hundreds of GIFs"
    assert len({entry["slug"] for entry in found}) == len(found) and len({entry["sha1"] for entry in found}) == len(found)
    total = 0
    for entry in found:
        data = open(os.path.join(CC_DIR, entry["file"]), "rb").read()
        total += len(data)
        info = yipi.gif_info(data)
        assert info and info[2] >= 2 and len(data) <= 650_000, entry["slug"]
        assert re.fullmatch(r"[a-z0-9]{12}", entry["slug"]) and entry["file"] == entry["slug"] + ".gif"
        assert 3 <= len(entry["title"]) <= yipi.MAX_GIF_TITLE and not BLOCKED.search(entry["title"] + " " + entry["page"]), entry["title"]
        assert ALLOWED.match(entry["licence"]) and not re.search(r"\bNC\b|\bND\b", entry["licence"]), (entry["slug"], entry["licence"])
        assert entry["author"] and entry["pageUrl"].startswith("https://commons.wikimedia.org/wiki/File:"), entry["slug"]
    assert total <= 60_000_000, "the whole set stays small enough to ship and to keep in the database"


def test_the_free_gifs_are_part_of_the_library_and_are_seeded_once(client):
    mia = flask_app.test_client()
    assert mia.post("/api/yipi/signup", json={"handle": "mia", "password": PASSWORD, "adult": True}).status_code == 200
    seen, offset = [], 0
    while offset is not None:
        page = mia.get(f"/api/yipi/gifs?tab=new&offset={offset}").get_json()
        seen += page["items"]
        offset = page["next"]
    assert len(seen) == len(yipi.starter_index()) == yipi.PulseGif.query.count() and all(item["starter"] for item in seen)
    assert len(seen) >= 150 + 18
    mia.get("/api/yipi/gifs")
    assert yipi.PulseGif.query.count() == len(seen), "put in once, not again on every visit"
    some = next(item for item in seen if item["title"] == entries()[0]["title"])
    assert flask_app.test_client().get(some["url"]).status_code == 200


def test_the_page_of_credits_names_everybody(client):
    page = flask_app.test_client().get("/bildnachweise")
    text = page.get_data(as_text=True)
    assert page.status_code == 200 and "<title>Bildnachweise | Nex</title>" in text
    found = entries()
    for entry in found[:25]:
        assert entry["pageUrl"] in text.replace("&amp;", "&") or entry["pageUrl"].replace("'", "&#39;") in text, entry["slug"]
    assert text.count("<li>") >= len(found) and "Wikimedia Commons" in text and "bearbeitet: verkleinert" in text
    assert 'rel="noopener nofollow"' in text
    assert "/bildnachweise" in flask_app.test_client().get("/impressum").get_data(as_text=True), "linked from every legal page"


def test_the_pictures_of_the_ranking_games_are_free_and_credited(client):
    with open(os.path.join(yipi.RANK_DIR, "index.json"), encoding="utf-8") as handle:
        index = json.load(handle)
    assert set(index) == {"footballers", "musicians", "countries"}
    assert len(index["footballers"]) >= 30 and len(index["musicians"]) >= 30 and len(index["countries"]) >= 30
    total = 0
    for key, found in index.items():
        assert len({entry["slug"] for entry in found}) == len(found)
        for entry in found:
            path = os.path.join(yipi.RANK_DIR, key, entry["file"])
            total += os.path.getsize(path)
            assert ALLOWED.match(entry["licence"]) and not re.search(r"\bNC\b|\bND\b", entry["licence"]), (entry["slug"], entry["licence"])
            assert entry["author"] and entry["pageUrl"].startswith("https://commons.wikimedia.org/wiki/File:"), entry["slug"]
            with open(path, "rb") as picture:
                assert picture.read(3) == b"\xff\xd8\xff", "a JPEG"
    assert total <= 6_000_000
    text = flask_app.test_client().get("/bildnachweise").get_data(as_text=True)
    assert "Bilder der Ranglisten-Spiele" in text and "Fußballer" in text and "Flaggen" in text
    for key, found in index.items():
        for entry in found[:6]:
            assert entry["name"] in text and (entry["pageUrl"] in text.replace("&amp;", "&") or entry["pageUrl"].replace("'", "&#39;") in text), entry["slug"]
