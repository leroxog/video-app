"""Satürn: music for the clips (yipi_music.py): only audio of the Internet Archive with a Creative Commons licence that allows it (CC0, CC BY, CC BY-SA), passed on by the server, and files of the person's
own folder; a lens can bring a song. The Internet Archive is never really asked here: the answers are made up."""
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
import yipi_music  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")
MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 400


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    yipi_music._cache.clear()


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


class Reply:
    def __init__(self, payload=None, status=200, headers=None, body=b""):
        self.payload, self.status_code, self.headers, self.body = payload, status, headers or {}, body

    def json(self):
        return self.payload

    def iter_content(self, size):
        yield self.body

    def close(self):
        pass


def archive(monkeypatch, search=None, items=None, serve=None):
    """The Internet Archive, made up: a search, the metadata of items, and a file."""
    calls = []

    def fake(url, params=None, headers=None, timeout=None, stream=False, allow_redirects=True):
        calls.append(url)
        if url.endswith("/advancedsearch.php"):
            return Reply({"response": {"numFound": 408000, "docs": search or []}})
        if "/metadata/" in url:
            return Reply((items or {}).get(url.rsplit("/", 1)[1]))
        return serve(url, headers) if serve else Reply(status=404)                  # (the files: the address of the item, or where it was sent)
    monkeypatch.setattr(yipi_music.requests, "get", fake)
    return calls


def item(licence="http://creativecommons.org/licenses/by/4.0/", files=None, mediatype="audio"):
    return {"metadata": {"title": "Sommer Lied", "creator": "Anna", "licenseurl": licence, "mediatype": mediatype},
            "files": files if files is not None else [{"name": "lied.mp3", "format": "VBR MP3", "size": "4000000", "length": "181.2", "source": "original"},
                                                      {"name": "lied.ogg", "format": "Ogg Vorbis", "size": "3000000", "length": "181.2", "source": "derivative"}]}


def test_only_licences_that_allow_it_are_accepted():
    assert yipi_music.licence_label("http://creativecommons.org/publicdomain/zero/1.0/") == "CC0 1.0"
    assert yipi_music.licence_label("https://creativecommons.org/licenses/by/4.0/") == "CC BY 4.0"
    assert yipi_music.licence_label("https://creativecommons.org/licenses/by-sa/3.0/de/") == "CC BY-SA 3.0"
    for no in ("https://creativecommons.org/licenses/by-nc/4.0/", "https://creativecommons.org/licenses/by-nd/4.0/", "https://creativecommons.org/licenses/by-nc-sa/2.0/", "https://evil.example/licenses/by/4.0/", "", None, 5):
        assert yipi_music.licence_label(no) is None, no


def test_a_search_gives_songs_with_their_licence_and_drops_the_others(monkeypatch):
    docs = [{"identifier": "sommer-lied", "title": "Sommer Lied", "creator": "Anna", "licenseurl": "http://creativecommons.org/licenses/by/4.0/", "downloads": 50},
            {"identifier": "nur-nc", "title": "Nicht kommerziell", "creator": "Bob", "licenseurl": "https://creativecommons.org/licenses/by-nc/4.0/", "downloads": 90},
            {"identifier": "../böse", "title": "x", "licenseurl": "http://creativecommons.org/licenses/by/4.0/"}]
    archive(monkeypatch, search=docs)
    found = yipi_music.search("Sommer <script>", 1)
    assert [song["id"] for song in found] == ["sommer-lied"] and found[0]["licence"] == "CC BY 4.0" and found[0]["creator"] == "Anna"
    assert yipi_music.count() == 408000


def test_the_best_file_of_an_item_is_a_song_of_a_few_minutes_and_a_wrong_item_is_refused(monkeypatch):
    archive(monkeypatch, items={"gut": item(), "nc": item(licence="https://creativecommons.org/licenses/by-nc/4.0/"), "buch": item(mediatype="texts"),
                                "gross": item(files=[{"name": "a.mp3", "format": "MP3", "size": "99000000", "length": "300"}]), "kurz": item(files=[{"name": "a.mp3", "format": "MP3", "size": "1000", "length": "4"}])})
    track = yipi_music.resolve("gut")
    assert track["file"] == "lied.mp3" and track["length"] == 181 and track["licence"] == "CC BY 4.0" and track["title"] == "Sommer Lied"
    for bad in ("nc", "buch", "gross", "kurz", "nicht-da", "../x", "", None):
        assert yipi_music.resolve(bad) is None, bad


def test_the_audio_is_passed_on_with_ranges_and_only_from_archive_org(monkeypatch):
    seen = []

    def stream(url, headers):
        seen.append((url, headers.get("Range")))
        if url.startswith("https://archive.org/download/"):
            return Reply(status=302, headers={"Location": "https://ia800000.us.archive.org/1/items/gut/lied.mp3"})
        return Reply(status=206, headers={"Content-Length": "2", "Content-Range": "bytes 0-1/4000000"}, body=b"ID")
    archive(monkeypatch, items={"gut": item()}, serve=stream)
    status, headers, chunks = yipi_music.open_stream("gut", "lied.mp3", "bytes=0-1")
    assert status == 206 and headers["Content-Type"] == "audio/mpeg" and headers["Content-Range"] == "bytes 0-1/4000000" and b"".join(chunks) == b"ID"
    assert seen[-1] == ("https://ia800000.us.archive.org/1/items/gut/lied.mp3", "bytes=0-1")
    assert yipi_music.open_stream("nc-item", "lied.mp3") is None and yipi_music.open_stream("gut", "../etc/passwd") is None

    def away(url, headers):
        return Reply(status=302, headers={"Location": "https://evil.example/x.mp3"}) if "archive.org/download" in url else Reply(status=200, body=b"x")
    archive(monkeypatch, items={"gut": item()}, serve=away)
    assert yipi_music.open_stream("gut", "lied.mp3") is None, "a redirect to another site is not followed"


def test_the_songs_of_the_person_are_recognised_by_their_first_bytes():
    assert yipi_music.audio_type(MP3) == "audio/mpeg" and yipi_music.audio_type(b"OggS" + b"\x00" * 30) == "audio/ogg"
    assert yipi_music.audio_type(b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 30) == "audio/mp4" and yipi_music.audio_type(b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 20) == "audio/wav"
    for bad in (b"MZ\x90\x00" + b"\x00" * 30, b"<html>" + b"x" * 30, b"", None, b"\x89PNG\r\n\x1a\n" + b"\x00" * 30):
        assert yipi_music.audio_type(bad) is None


def test_the_endpoints_need_a_login_and_give_the_search_a_track_and_a_random_song(client, monkeypatch):
    archive(monkeypatch, search=[{"identifier": "gut", "title": "Sommer Lied", "creator": "Anna", "licenseurl": "http://creativecommons.org/licenses/by/4.0/", "downloads": 5}], items={"gut": item()},
            serve=lambda url, headers: Reply(status=200, headers={"Content-Length": "3"}, body=b"ID3"))
    guest = flask_app.test_client()
    for path in ("/api/yipi/music/search", "/api/yipi/music/track/gut", "/api/yipi/music/random", "/yipi-music/gut/lied.mp3"):
        assert guest.get(path).status_code == 401, path
    mia = person("mia")
    found = mia.get("/api/yipi/music/search?q=sommer").get_json()
    assert found["items"][0]["id"] == "gut" and found["total"] == 408000
    track = mia.get("/api/yipi/music/track/gut").get_json()["track"]
    assert track["url"] == "/yipi-music/gut/lied.mp3" and track["licence"] == "CC BY 4.0"
    assert mia.get("/api/yipi/music/track/nicht-da").status_code == 404
    assert mia.get("/api/yipi/music/random").get_json()["track"]["id"] == "gut"
    played = mia.get(track["url"])
    assert played.status_code == 200 and played.data == b"ID3" and played.mimetype == "audio/mpeg"
    assert mia.get("/yipi-music/gut/geheim.txt").status_code == 404


def test_a_lens_brings_a_song_and_a_person_uploads_a_song_from_the_folder(client, monkeypatch):
    archive(monkeypatch, items={"gut": item()})
    mia, tom = person("mia"), person("tom")
    bad = mia.post("/api/yipi/music/upload", data={"file": (io.BytesIO(b"MZ" + b"\x00" * 40), "x.mp3")}, content_type="multipart/form-data")
    assert bad.status_code == 415
    big = mia.post("/api/yipi/music/upload", data={"file": (io.BytesIO(MP3 + b"\x00" * 8_100_000), "big.mp3")}, content_type="multipart/form-data")
    assert big.status_code == 413
    up = mia.post("/api/yipi/music/upload", data={"file": (io.BytesIO(MP3), "mein lied.mp3"), "title": "Mein Lied"}, content_type="multipart/form-data")
    assert up.status_code == 200, up.get_json()
    media = up.get_json()["media"]
    assert media["type"] == "audio/mpeg" and media["title"] == "Mein Lied"
    got = mia.get(media["url"], headers={"Range": "bytes=0-9"})
    assert got.status_code == 206 and got.mimetype == "audio/mpeg", "a song of the folder is served with ranges"
    base = {"title": "Sommerlinse", "prompt": "Ein Hase", "fx": ["bunnyEars"], "filter": "none"}
    own = mia.post("/api/yipi/lenses", json={**base, "song": {"src": "upload", "media": media["id"], "title": "Mein Lied", "start": 12}})
    assert own.status_code == 201, own.get_json()
    song = own.get_json()["lens"]["song"]
    assert song["src"] == "upload" and song["url"] == f"/yipi-media/{media['id']}" and song["start"] == 12
    assert tom.post("/api/yipi/lenses", json={**base, "song": {"src": "upload", "media": media["id"]}}).status_code == 422, "a song of somebody else is not taken"
    free = mia.post("/api/yipi/lenses", json={**base, "title": "Mit Archiv", "song": {"src": "archive", "id": "gut", "start": 5}})
    assert free.status_code == 201 and free.get_json()["lens"]["song"]["url"] == "/yipi-music/gut/lied.mp3" and free.get_json()["lens"]["song"]["licence"] == "CC BY 4.0"
    assert mia.post("/api/yipi/lenses", json={**base, "song": {"src": "archive", "id": "nicht-da"}}).status_code == 422
    assert mia.post("/api/yipi/lenses", json={**base, "song": "x"}).status_code == 422
    assert tom.get("/api/yipi/lenses?sort=popular").get_json()["items"][0]["song"] is not None
    plain = mia.post("/api/yipi/lenses", json={**base, "title": "Ohne Song"}).get_json()["lens"]
    assert plain["song"] is None
    with flask_app.app_context():                                               # the uploaded song is not cleaned away as unused
        user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
        for row in yipi.YipiMedia.query.filter_by(owner_id=user.id):
            row.created_at = yipi.utcnow() - yipi.timedelta(days=3)
        db.session.commit()
        yipi.cleanup_orphans(user)
        db.session.commit()
        assert yipi.YipiMedia.query.filter_by(id=media["id"]).first() is not None


def test_the_camera_has_the_controls_the_song_and_the_random_song_lens():
    def read(name):
        with open(os.path.join(JS_DIR, name), encoding="utf-8") as handle:
            return handle.read()
    camera, music, lenses = read("yipi-camera.js"), read("yipi-music.js"), read("yipi-lenses.js")
    assert "Kamera ausschalten" in camera and "Mikrofon ausschalten" in camera and "camSound" in camera and "setCamera" in camera
    assert "musicPlayer.track()" in camera and "randomsong" in camera and "/music/random" in camera and "Y.music.credit" in camera
    assert "createMediaStreamDestination" in music and "/music/search" in music and "/music/track/" in music and "Zufälliger Song" in music
    assert "Y.music.pick" in lenses and "song" in lenses
    assert "yipi-music.js" in open(os.path.join(os.path.dirname(__file__), "..", "yipi.py"), encoding="utf-8").read()
