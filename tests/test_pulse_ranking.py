"""Nex: rankings that people make themselves (yipi_ranking.py): a title, a Top 5 or Top 10 and entries with a name and a picture; the AI suggests entries; the pictures come from the
person or from Wikimedia Commons (thumbnails of freely licensed pictures only, with author and licence on the page of credits); everybody plays the ranking in the camera."""
import io
import json
import os
import struct
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_ranking  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")
NAMES = ["Margherita", "Salami", "Funghi", "Hawaii", "Tonno", "Quattro Formaggi", "Diavola", "Capricciosa"]


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    yipi._agent_cache.update(at=None, ids=frozenset())
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()
    yipi._agent_cache.update(at=None, ids=frozenset())


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def png():
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 10, 10) + b"\x08\x06\x00\x00\x00" + b"\x00" * 20


def upload(c, data=None):
    reply = c.post("/api/yipi/media", data={"file": (io.BytesIO(data or png()), "p.png")}, content_type="multipart/form-data")
    assert reply.status_code == 200, reply.get_json()
    return reply.get_json()["media"]["id"]


def ranking(c, size=5, count=8, media=(), **extra):
    entries = [{"name": name, **({"media": media[i]} if i < len(media) else {})} for i, name in enumerate(NAMES[:count])]
    return c.post("/api/yipi/community-games", json={"kind": "ranking", "title": "Beste Pizza", "emoji": "🏆", "color": "#2a8cff", "ranking": {"size": size, "entries": entries}, **extra})


def test_a_ranking_is_checked_and_stored_as_json():
    owns = {"a" * 32}.__contains__
    stored, reason = yipi_ranking.clean_ranking({"size": 5, "entries": [{"name": f"  Eintrag {n}  ", "media": "a" * 32 if n == 0 else "b" * 32} for n in range(6)] + [{"name": "eintrag 0"}, {"name": ""}, "x"]}, owns)
    assert reason == "" and json.loads(stored)["size"] == 5
    entries = json.loads(stored)["entries"]
    assert [e["name"] for e in entries] == [f"Eintrag {n}" for n in range(6)], "trimmed, no doubles, no empty names"
    assert entries[0]["media"] == "a" * 32 and all("media" not in e for e in entries[1:]), "only pictures of the person stay"
    assert yipi_ranking.clean_ranking({"size": 7, "entries": []}, owns)[0] is None and "Top 5" in yipi_ranking.clean_ranking({"size": 5, "entries": [{"name": "a"}]}, owns)[1]
    assert "Höchstens" in yipi_ranking.clean_ranking({"size": 5, "entries": [{"name": f"n{n}"} for n in range(30)]}, owns)[1]
    assert yipi_ranking.clean_ranking("x", owns)[0] is None
    assert yipi_ranking.clean_ranking({"size": 5, "entries": [{"name": "böse"}] * 1 + [{"name": f"n{n}"} for n in range(6)]}, owns, lambda word: word == "böse")[0] is None
    good = {"author": "Max <b>M</b>", "licence": "CC BY-SA 4.0", "page": "https://commons.wikimedia.org/wiki/File:Pizza.jpg"}
    assert yipi_ranking.clean_credit(good) == {"author": "Max bM/b", "licence": "CC BY-SA 4.0", "page": good["page"]} or yipi_ranking.clean_credit(good)["author"].startswith("Max")
    assert yipi_ranking.clean_credit({**good, "page": "https://evil.example/File:x.jpg"}) is None and yipi_ranking.clean_credit("x") is None
    assert yipi_ranking.media_ids(stored) == {"a" * 32}


def test_only_freely_licensed_thumbnails_from_wikimedia_are_offered_and_fetched(monkeypatch):
    class Reply:
        status_code = 200

        def __init__(self, payload=None, body=b""):
            self.payload, self.body = payload, body

        def iter_content(self, size):
            yield self.body

        def json(self):
            return self.payload

    def page(index, title, licence, thumb, mime="image/jpeg", nonfree="", width=800, height=600):
        return {"index": index, "title": f"File:{title}", "imageinfo": [{"mime": mime, "width": width, "height": height, "thumburl": thumb, "extmetadata": {"LicenseShortName": {"value": licence}, "Artist": {"value": "<a href='x'>Anna</a>"}, "NonFree": {"value": nonfree}}}]}
    payload = {"query": {"pages": {
        "1": page(1, "Pizza one.jpg", "CC BY-SA 4.0", "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Pizza_one.jpg/320px-Pizza_one.jpg"),
        "2": page(2, "Pizza two.jpg", "All rights reserved", "https://upload.wikimedia.org/x.jpg"),
        "3": page(3, "Pizza three.jpg", "CC BY-NC 4.0", "https://upload.wikimedia.org/y.jpg"),
        "4": page(4, "Pizza four.png", "Public domain", "https://evil.example/z.png", mime="image/png"),
        "5": page(5, "Pizza five.svg", "CC0", "https://upload.wikimedia.org/w.svg", mime="image/svg+xml"),
        "6": page(6, "Pizza six.jpg", "CC0", "https://upload.wikimedia.org/small.jpg", width=100, height=100),
        "7": page(7, "Pizza seven.jpg", "CC0", "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Pizza_seven.jpg/320px-Pizza_seven.jpg"),
    }}}
    monkeypatch.setattr(yipi_ranking.requests, "get", lambda *a, **k: Reply(payload))
    found = yipi_ranking.search_images("Pizza")
    assert [f["title"] for f in found] == ["Pizza one.jpg", "Pizza seven.jpg"], "free licences, thumbnails of Wikimedia, big enough"
    assert found[0]["author"] == "Anna" and found[0]["licence"] == "CC BY-SA 4.0" and found[0]["page"] == "https://commons.wikimedia.org/wiki/File:Pizza_one.jpg"
    assert yipi_ranking.search_images("x") == []

    def broken(*args, **kwargs):
        raise yipi_ranking.requests.ConnectionError("down")
    monkeypatch.setattr(yipi_ranking.requests, "get", broken)
    assert yipi_ranking.search_images("Pizza") == [] and yipi_ranking.fetch_thumb("https://upload.wikimedia.org/a.jpg") is None
    calls = []
    monkeypatch.setattr(yipi_ranking.requests, "get", lambda url, **k: calls.append(url) or Reply(body=png()))
    assert yipi_ranking.fetch_thumb("https://upload.wikimedia.org/a.jpg") == png()
    for bad in ("http://upload.wikimedia.org/a.jpg", "https://evil.example/a.jpg", "https://upload.wikimedia.org.evil.example/a.jpg", "https://user@evil.example/a.jpg", "https://upload.wikimedia.org:8443/a.jpg", None, 5):
        assert yipi_ranking.fetch_thumb(bad) is None, bad
    assert calls == ["https://upload.wikimedia.org/a.jpg"], "nothing else was ever asked for"


def test_a_person_makes_a_ranking_and_others_play_it(client):
    mia, tom = person("mia"), person("tom")
    own = upload(mia)
    foreign = upload(tom)
    made = ranking(mia, media=(own, foreign), icon=own)
    assert made.status_code == 201, made.get_json()
    game = made.get_json()["game"]
    assert game["kind"] == "ranking" and game["mine"] is True and game["icon"] == f"/yipi-media/{own}" and "data" not in game
    seen = tom.get("/api/yipi/community-games").get_json()["items"]
    assert [item["id"] for item in seen] == [game["id"]] and seen[0]["kind"] == "ranking" and "ranking" not in seen[0]
    row = tom.get(f"/api/yipi/community-games/{game['id']}").get_json()["game"]
    assert row["ranking"]["size"] == 5 and [e["name"] for e in row["ranking"]["entries"]] == NAMES and "data" not in row
    assert row["ranking"]["entries"][0]["url"] == f"/yipi-media/{own}" and row["ranking"]["entries"][1]["url"] is None, "a picture of somebody else is not taken"
    assert tom.post(f"/api/yipi/community-games/{game['id']}/play").status_code == 200
    assert tom.get(f"/api/yipi/game-worker/{game['id']}").status_code == 404, "a ranking is not code: nothing runs"
    assert tom.delete(f"/api/yipi/community-games/{game['id']}").status_code == 403 and mia.delete(f"/api/yipi/community-games/{game['id']}").status_code == 200


def test_a_ranking_needs_enough_entries_and_a_good_title(client):
    mia = person("mia")
    assert ranking(mia, size=10, count=8).status_code == 422, "a Top 10 needs ten entries"
    assert ranking(mia, size=7).status_code == 422
    assert mia.post("/api/yipi/community-games", json={"kind": "ranking", "title": "x", "ranking": {"size": 5, "entries": [{"name": n} for n in NAMES]}}).status_code == 400
    assert mia.post("/api/yipi/community-games", json={"kind": "ranking", "title": "Beste Pizza"}).status_code == 422
    assert ranking(mia, size=5, count=5).status_code == 201


def test_the_pictures_of_a_ranking_are_not_cleaned_away_as_unused(client):
    mia = person("mia")
    own = upload(mia)
    assert ranking(mia, media=(own,)).status_code == 201
    with flask_app.app_context():
        user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
        for item in yipi.YipiMedia.query.filter_by(owner_id=user.id):
            item.created_at = yipi.utcnow() - yipi.timedelta(days=3)
        db.session.commit()
        yipi.cleanup_orphans(user)
        db.session.commit()
        assert yipi.YipiMedia.query.filter_by(id=own).first() is not None, "the picture belongs to a ranking"
        stray = yipi.YipiMedia.query.filter(yipi.YipiMedia.owner_id == user.id, yipi.YipiMedia.id != own).count()
        assert stray == 0


def test_the_ai_suggests_entries_and_the_pictures_are_searched_and_kept(client, monkeypatch):
    import ai_assistant
    mia = person("mia")
    monkeypatch.setattr(ai_assistant, "generate_text", lambda system, message, **k: 'Hier: ["Messi", "Ronaldo", "messi", "Neuer", 5, "<b>Pelé</b>"]')
    reply = mia.post("/api/yipi/ranking/suggest", json={"title": "Die besten Fußballer"})
    assert reply.status_code == 200 and reply.get_json()["entries"] == ["Messi", "Ronaldo", "Neuer", "b Pelé /b"] or reply.get_json()["entries"][:3] == ["Messi", "Ronaldo", "Neuer"]
    monkeypatch.setattr(ai_assistant, "generate_text", lambda *a, **k: "keine Liste")
    assert mia.post("/api/yipi/ranking/suggest", json={"title": "Die besten Fußballer"}).status_code == 502
    assert mia.post("/api/yipi/ranking/suggest", json={"title": "ab"}).status_code == 400
    assert flask_app.test_client().post("/api/yipi/ranking/suggest", json={"title": "Die besten Fußballer"}).status_code == 401
    found = [{"url": "https://upload.wikimedia.org/a.jpg", "title": "Messi.jpg", "author": "Anna", "licence": "CC BY 4.0", "page": "https://commons.wikimedia.org/wiki/File:Messi.jpg"}]
    monkeypatch.setattr(yipi_ranking, "search_images", lambda q, limit=8: found if q == "Messi" else [])
    assert mia.get("/api/yipi/ranking/images?q=Messi").get_json()["items"] == found and mia.get("/api/yipi/ranking/images?q=Nobody").get_json()["items"] == []
    monkeypatch.setattr(yipi_ranking, "fetch_thumb", lambda url: png() if url == found[0]["url"] else None)
    picked = mia.post("/api/yipi/ranking/pick", json={"url": found[0]["url"], "credit": {"author": "Anna", "licence": "CC BY 4.0", "page": found[0]["page"]}})
    assert picked.status_code == 200, picked.get_json()
    media_id = picked.get_json()["media"]["id"]
    assert picked.get_json()["credit"]["author"] == "Anna"
    assert mia.post("/api/yipi/ranking/pick", json={"url": "https://evil.example/x.png"}).status_code == 415
    made = mia.post("/api/yipi/community-games", json={"kind": "ranking", "title": "Fußballer", "ranking": {"size": 5, "entries": [{"name": n, "media": media_id, "credit": found[0] and {"author": "Anna", "licence": "CC BY 4.0", "page": found[0]["page"]}} for n in NAMES[:6]]}})
    assert made.status_code == 201
    page = flask_app.test_client().get("/bildnachweise").get_data(as_text=True)
    assert "Bilder der Ranglisten von Nutzern" in page and "Messi.jpg" in page and "CC BY 4.0" in page, "the author and the licence are on the page of credits"


def test_the_camera_knows_the_new_games_and_the_reel_follows_the_forehead():
    def read(name):
        with open(os.path.join(JS_DIR, name), encoding="utf-8") as handle:
            return handle.read()
    camera, rank, maker = read("yipi-camera.js"), read("pg-rank.js"), read("yipi-gamemaker.js")
    assert "def.face" in camera and "hooks.face" in camera and "face: true" in rank and "rankDef" in rank and "rankDef" in camera
    assert "ranking" in maker and "/ranking/pick" in maker and "/ranking/images" in maker and "/ranking/suggest" in maker
    assert "pg-race3d.js" in open(os.path.join(os.path.dirname(__file__), "..", "yipi.py"), encoding="utf-8").read()
