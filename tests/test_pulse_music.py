"""Satürn: music for the clips (yipi_music.py): a short, chosen list of songs that fit short videos (yipi_music_catalogue.py), all under a Creative Commons licence that allows it (CC0, CC BY, CC BY-SA),
fetched once from the Internet Archive and kept by the server, and files of the person's own folder; a lens can bring a song. The Internet Archive is never really asked here: the answers are made up."""
import io
import os
import sys
import tempfile
import urllib.parse

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_music  # noqa: E402
import yipi_music_catalogue  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")
MP3 = b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\xff\xfb\x90\x00" * 400
SONG = b"ID3\x03\x00\x00\x00\x00\x00\x00" + bytes(range(256)) * 60               # a "song" of 15 kB
FIRST = yipi_music.ORDER[0]


@pytest.fixture(autouse=True)
def calm(monkeypatch, tmp_path):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.setattr(yipi_music, "AUTO_WARM", False)
    monkeypatch.setattr(yipi_music, "CACHE_DIR", str(tmp_path / "music"))
    yipi_music._fetching.clear()


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
    def __init__(self, status=200, headers=None, body=b""):
        self.status_code, self.headers, self.body = status, headers or {}, body

    def iter_content(self, size):
        for start in range(0, len(self.body), size):
            yield self.body[start:start + size]

    def close(self):
        pass


def archive(monkeypatch, serve):
    """The Internet Archive, made up: `serve(url)` answers a request for a file."""
    calls = []

    def fake(url, params=None, headers=None, timeout=None, stream=False, allow_redirects=True):
        calls.append(url)
        return serve(url)
    monkeypatch.setattr(yipi_music.requests, "get", fake)
    return calls


def ok_archive(url):
    if url.startswith("https://archive.org/download/"):
        return Reply(status=302, headers={"Location": "https://ia800000.us.archive.org/1/items/x/song.mp3"})
    return Reply(status=200, headers={"Content-Length": str(len(SONG))}, body=SONG)


def test_only_licences_that_allow_it_are_accepted():
    assert yipi_music.licence_label("http://creativecommons.org/publicdomain/zero/1.0/") == "CC0 1.0"
    assert yipi_music.licence_label("https://creativecommons.org/licenses/by/4.0/") == "CC BY 4.0"
    assert yipi_music.licence_label("https://creativecommons.org/licenses/by-sa/3.0/de/") == "CC BY-SA 3.0"
    for no in ("https://creativecommons.org/licenses/by-nc/4.0/", "https://creativecommons.org/licenses/by-nd/4.0/", "https://creativecommons.org/licenses/by-nc-sa/2.0/", "https://evil.example/licenses/by/4.0/", "", None, 5):
        assert yipi_music.licence_label(no) is None, no


def test_the_list_is_short_chosen_and_every_song_has_an_allowed_licence_a_file_and_a_style():
    songs = yipi_music_catalogue.SONGS
    assert 40 <= len(songs) <= 80, "a short list, not four hundred thousand files"
    assert yipi_music.count() == len(songs)
    ids = [row["id"] for row in songs]
    assert len(set(ids)) == len(ids) and all(i.startswith("tt-") for i in ids)
    for row in songs:
        assert yipi_music.licence_label(row["licenceUrl"]) is not None and row["licence"] == yipi_music.licence_label(row["licenceUrl"]), row["id"]
        assert row["file"].lower().endswith(".mp3") and row["item"] and row["title"] and row["creator"], row["id"]
        assert row["tag"] in yipi_music_catalogue.TAGS and 20 <= row["length"] <= 900 and 0 < row["size"] <= yipi_music.MAX_FILE, row["id"]
    for tag in yipi_music_catalogue.TAGS:
        assert sum(1 for row in songs if row["tag"] == tag) >= 2, tag
    titles = {row["title"] for row in songs}
    assert {"Sneaky Snitch", "Monkeys Spinning Monkeys", "Funkorama"} <= titles, "the songs that are used in memes are there"


def test_a_search_finds_songs_by_word_or_style_and_pages_through_the_list():
    everything = yipi_music.search("", 1, rows=100)
    assert len(everything) == yipi_music.count() and everything[0]["id"] == FIRST
    assert len(yipi_music.search("", 1, rows=20)) == 20 and len(yipi_music.search("", 2, rows=20)) == 20 and len(yipi_music.search("", 3, rows=20)) == yipi_music.count() - 40
    funk = yipi_music.search("funk", 1, rows=100)
    assert funk and all("funk" in f"{s['title']} {s['creator']} {s['tag']}".lower() for s in funk)
    hip = yipi_music.search("Hip-Hop", 1, rows=100)
    assert hip and all(s["tag"] == "Hip-Hop" for s in hip), "the chip of a style is a search for its name"
    assert yipi_music.search("sneaky snitch")[0]["title"] == "Sneaky Snitch" and yipi_music.search("Sommer <script>") == [] and yipi_music.search(None)[0]["id"] == FIRST
    assert {"id", "title", "creator", "tag", "licence", "licenceUrl"} <= set(everything[0])


def test_only_a_song_of_the_list_can_be_played_and_the_old_ones_of_the_archive_are_gone():
    track = yipi_music.resolve(FIRST)
    assert track["id"] == FIRST and track["file"].endswith(".mp3") and track["licence"] and track["page"].startswith("https://archive.org/details/")
    for bad in ("gut", "sommer-lied", "KevinMacLeod_2019-04_Discography", "../x", "", None, 5):
        assert yipi_music.resolve(bad) is None, bad
    assert yipi_music.random_track()["id"] in yipi_music.SONGS


def test_a_song_is_fetched_once_kept_and_passed_on_with_ranges_and_only_from_archive_org(monkeypatch):
    row = yipi_music.SONGS[FIRST]
    calls = archive(monkeypatch, ok_archive)
    status, headers, chunks = yipi_music.open_stream(FIRST, row["file"], "bytes=0-9")
    assert status == 206 and headers["Content-Type"] == "audio/mpeg" and headers["Content-Range"] == f"bytes 0-9/{len(SONG)}" and b"".join(chunks) == SONG[:10]
    first_calls = len(calls)
    assert calls[0] == f"https://archive.org/download/{urllib.parse.quote(row['item'])}/{urllib.parse.quote(row['file'])}" and calls[1].startswith("https://ia800000.us.archive.org/")
    status, headers, chunks = yipi_music.open_stream(FIRST, row["file"])
    assert status == 200 and b"".join(chunks) == SONG and headers["Content-Length"] == str(len(SONG)) and headers["Accept-Ranges"] == "bytes"
    status, headers, chunks = yipi_music.open_stream(FIRST, row["file"], "bytes=100-")
    assert status == 206 and b"".join(chunks) == SONG[100:] and headers["Content-Range"] == f"bytes 100-{len(SONG) - 1}/{len(SONG)}"
    status, headers, chunks = yipi_music.open_stream(FIRST, row["file"], "bytes=-50")
    assert status == 206 and b"".join(chunks) == SONG[-50:]
    assert yipi_music.open_stream(FIRST, row["file"], f"bytes={len(SONG) + 5}-")[0] == 416
    assert len(calls) == first_calls, "after the first time the Internet Archive is not asked again"
    assert yipi_music.open_stream(FIRST, "Kevin MacLeod/other.mp3") is None and yipi_music.open_stream("tt-999", row["file"]) is None and yipi_music.open_stream("../etc", "passwd") is None


def test_a_redirect_to_another_site_a_bad_answer_and_a_file_that_is_too_big_are_not_taken(monkeypatch, tmp_path):
    row = yipi_music.SONGS[FIRST]
    archive(monkeypatch, lambda url: Reply(status=302, headers={"Location": "https://evil.example/x.mp3"}) if "archive.org/download" in url else Reply(status=200, body=SONG))
    assert yipi_music.open_stream(FIRST, row["file"]) is None, "a redirect to another site is not followed"
    archive(monkeypatch, lambda url: Reply(status=404))
    assert yipi_music.open_stream(FIRST, row["file"]) is None
    archive(monkeypatch, lambda url: Reply(status=200, headers={"Content-Length": str(yipi_music.MAX_FILE + 1)}, body=SONG))
    assert yipi_music.open_stream(FIRST, row["file"]) is None
    archive(monkeypatch, lambda url: Reply(status=200, headers={}, body=b"x" * 50))
    assert yipi_music.open_stream(FIRST, row["file"]) is None, "a few bytes are no song"
    leftovers = [name for name in os.listdir(yipi_music.CACHE_DIR)] if os.path.isdir(yipi_music.CACHE_DIR) else []
    assert leftovers == [], "no half files stay behind"


def test_the_folder_of_the_cache_never_holds_more_than_the_allowed_number_of_songs(monkeypatch):
    monkeypatch.setattr(yipi_music, "MAX_CACHED", 3)
    archive(monkeypatch, ok_archive)
    for identifier in yipi_music.ORDER[:6]:
        assert yipi_music.open_stream(identifier, yipi_music.SONGS[identifier]["file"]) is not None
    assert len(os.listdir(yipi_music.CACHE_DIR)) == 3


def test_a_song_that_is_looked_at_is_fetched_in_the_background_and_two_people_do_not_fetch_it_twice(monkeypatch):
    monkeypatch.setattr(yipi_music, "AUTO_WARM", True)
    calls = archive(monkeypatch, ok_archive)
    assert yipi_music.warm(FIRST) is True
    for _ in range(100):
        if os.path.exists(yipi_music._path(yipi_music.SONGS[FIRST])):
            break
        import time
        time.sleep(0.05)
    assert os.path.exists(yipi_music._path(yipi_music.SONGS[FIRST]))
    assert yipi_music.warm(FIRST) is False and yipi_music.warm("nope") is False
    assert len([c for c in calls if c.startswith("https://archive.org/download/")]) == 1


def test_the_songs_of_the_person_are_recognised_by_their_first_bytes():
    assert yipi_music.audio_type(MP3) == "audio/mpeg" and yipi_music.audio_type(b"OggS" + b"\x00" * 30) == "audio/ogg"
    assert yipi_music.audio_type(b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 30) == "audio/mp4" and yipi_music.audio_type(b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 20) == "audio/wav"
    for bad in (b"MZ\x90\x00" + b"\x00" * 30, b"<html>" + b"x" * 30, b"", None, b"\x89PNG\r\n\x1a\n" + b"\x00" * 30):
        assert yipi_music.audio_type(bad) is None


def test_the_endpoints_need_a_login_and_give_the_search_a_track_and_a_random_song(client, monkeypatch):
    archive(monkeypatch, ok_archive)
    row = yipi_music.SONGS[FIRST]
    guest = flask_app.test_client()
    for path in ("/api/yipi/music/search", f"/api/yipi/music/track/{FIRST}", "/api/yipi/music/random", f"/yipi-music/{FIRST}/{urllib.parse.quote(row['file'])}"):
        assert guest.get(path).status_code == 401, path
    mia = person("mia")
    found = mia.get("/api/yipi/music/search?q=sneaky").get_json()
    assert found["items"][0]["title"] == "Sneaky Snitch" and found["total"] == yipi_music.count()
    track = mia.get(f"/api/yipi/music/track/{FIRST}").get_json()["track"]
    assert track["url"] == f"/yipi-music/{FIRST}/{urllib.parse.quote(row['file'])}" and track["licence"] == row["licence"]
    assert mia.get("/api/yipi/music/track/nicht-da").status_code == 404 and mia.get("/api/yipi/music/track/gut").status_code == 404
    assert mia.get("/api/yipi/music/random").get_json()["track"]["id"] in yipi_music.SONGS
    played = mia.get(track["url"])
    assert played.status_code == 200 and played.data == SONG and played.mimetype == "audio/mpeg"
    ranged = mia.get(track["url"], headers={"Range": "bytes=10-19"})
    assert ranged.status_code == 206 and ranged.data == SONG[10:20]
    assert mia.get(f"/yipi-music/{FIRST}/geheim.txt").status_code == 404


def test_a_lens_brings_a_song_and_a_person_uploads_a_song_from_the_folder(client, monkeypatch):
    mia, tom = person("mia"), person("tom")
    bad = mia.post("/api/yipi/music/upload", data={"file": (io.BytesIO(b"MZ" + b"\x00" * 40), "x.mp3")}, content_type="multipart/form-data")
    assert bad.status_code == 415
    monkeypatch.setattr(yipi_music, "MAX_UPLOAD", 1_000_000)                          # (the real limit is 50 MB)
    big = mia.post("/api/yipi/music/upload", data={"file": (io.BytesIO(MP3 + b"\x00" * 1_100_000), "big.mp3")}, content_type="multipart/form-data")
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
    row = yipi_music.SONGS[FIRST]
    free = mia.post("/api/yipi/lenses", json={**base, "title": "Mit Archiv", "song": {"src": "archive", "id": FIRST, "start": 5}})
    assert free.status_code == 201 and free.get_json()["lens"]["song"]["url"] == f"/yipi-music/{FIRST}/{urllib.parse.quote(row['file'])}" and free.get_json()["lens"]["song"]["licence"] == row["licence"]
    assert mia.post("/api/yipi/lenses", json={**base, "song": {"src": "archive", "id": "nicht-da"}}).status_code == 422
    assert mia.post("/api/yipi/lenses", json={**base, "song": {"src": "archive", "id": "KevinMacLeod_2019-04_Discography"}}).status_code == 422, "an item of the archive that is not on the list is not a song of Satürn"
    assert mia.post("/api/yipi/lenses", json={**base, "song": "x"}).status_code == 422
    assert tom.get("/api/yipi/lenses?sort=popular").get_json()["items"][0]["song"] is not None
    plain = mia.post("/api/yipi/lenses", json={**base, "title": "Ohne Song"}).get_json()["lens"]
    assert plain["song"] is None
    with flask_app.app_context():                                               # the uploaded song is not cleaned away as unused
        user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
        for row2 in yipi.YipiMedia.query.filter_by(owner_id=user.id):
            row2.created_at = yipi.utcnow() - yipi.timedelta(days=3)
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


def test_the_song_starts_at_once_and_in_the_right_place_and_the_clip_begins_when_the_song_does():
    camera, music = open(os.path.join(JS_DIR, "yipi-camera.js"), encoding="utf-8").read(), open(os.path.join(JS_DIR, "yipi-music.js"), encoding="utf-8").read()
    for word in ("function loadWhole(address)", "URL.createObjectURL(blob)", "await Promise.race([loaded,", "async start(wait = 450)", "this.rewind();", "element.currentTime = next.start"):
        assert word in music, word
    assert "element.src = blobUrl || urlOf(next)" in music, "no whole file: it plays from the server"
    for word in ("const lead = song && musicPlayer && musicPlayer.ready ? musicPlayer.start() : null;", "recordingPending", "lead.then(begin, begin)", "mineRecorder.start(500)"):
        assert word in camera, word
    assert "musicPlayer.rewind(); musicPlayer.play();" not in camera, "the clip no longer begins before the song"
    for style in ('["Beliebt", "#7a2cf0"', '["Funk", "#f59e0b"', '["Dance", "#06b6d4"', '["Hip-Hop", "#334155"', '["Lo-Fi", "#14b8a6"', '["Chill", "#22c55e"', '["Retro", "#f97316"'):
        assert style in music, style
    assert '"Pop"' not in music and '"Klassik"' not in music, "the old styles of the archive are gone"
