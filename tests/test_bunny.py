"""Satürn, 2026-11-11: the videos on Bunny Stream (yipi_bunny.py). Bunny itself is made up here (requests is replaced): the tests check that nothing happens without the settings, that a video that is
ready is served from the Bunny CDN and one that is not ready from the site itself, that the pictures of the videos come from Bunny, that the policy of the pages lets the page load from the CDN, and
that the migration sends every video once."""
import os
import sys
import tempfile
import uuid

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_bunny  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
CDN = "vz-test-123.b-cdn.net"


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    for name in ("BUNNY_LIBRARY_ID", "BUNNY_API_KEY", "BUNNY_CDN_HOST", "BUNNY_HEIGHT"):
        monkeypatch.delenv(name, raising=False)
    yipi_bunny._checked.clear()


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


def on(monkeypatch, height="480"):
    monkeypatch.setenv("BUNNY_LIBRARY_ID", "42")
    monkeypatch.setenv("BUNNY_API_KEY", "secret")
    monkeypatch.setenv("BUNNY_CDN_HOST", "https://" + CDN + "/")
    monkeypatch.setenv("BUNNY_HEIGHT", height)


def video_row(data=b"x" * 16):
    item = yipi.YipiMedia(id=uuid.uuid4().hex, owner_id=1, content_type="video/mp4", size=len(data), width=720, height=1280, data=data)
    db.session.add(item)
    db.session.commit()
    return item


def person(handle="mia"):
    who = flask_app.test_client()
    assert who.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return who


def test_without_the_settings_nothing_happens_and_the_height_is_checked(monkeypatch):
    assert yipi_bunny.enabled() is False and yipi_bunny.push_later(flask_app, "a" * 32, lambda: b"x", lambda guid: None) is None
    on(monkeypatch)
    assert yipi_bunny.enabled() and yipi_bunny.host() == CDN
    assert yipi_bunny.mp4_url("g1") == f"https://{CDN}/g1/play_480p.mp4" and yipi_bunny.thumbnail_url("g1") == f"https://{CDN}/g1/thumbnail.jpg"
    monkeypatch.setenv("BUNNY_HEIGHT", "999")
    assert yipi_bunny.height() == "480", "only heights that exist"
    monkeypatch.setenv("BUNNY_HEIGHT", "360")
    assert yipi_bunny.mp4_url("g1").endswith("play_360p.mp4")


def test_a_video_that_is_ready_goes_to_the_cdn_and_one_that_is_not_is_served_by_the_site(client, monkeypatch):
    mia = person()
    item = video_row()
    assert mia.get(f"/yipi-media/{item.id}").status_code == 200, "no settings: the site serves it"
    on(monkeypatch)
    assert mia.get(f"/yipi-media/{item.id}").status_code == 200, "not on Bunny: the site serves it"
    db.session.add(yipi.YipiBunny(media_id=item.id, guid="g-1"))
    db.session.commit()
    asked = []
    monkeypatch.setattr(yipi_bunny, "status", lambda guid: asked.append(guid) or 2)
    assert mia.get(f"/yipi-media/{item.id}").status_code == 200 and asked == ["g-1"], "still being made: the site serves it, Bunny was asked"
    assert mia.get(f"/yipi-media/{item.id}").status_code == 200 and asked == ["g-1"], "and it is not asked again at once"
    yipi_bunny._checked.clear()
    monkeypatch.setattr(yipi_bunny, "status", lambda guid: 4)
    reply = mia.get(f"/yipi-media/{item.id}")
    assert reply.status_code == 302 and reply.headers["Location"] == f"https://{CDN}/g-1/play_480p.mp4"
    assert db.session.get(yipi.YipiBunny, item.id).ready is True
    monkeypatch.setattr(yipi_bunny, "status", lambda guid: (_ for _ in ()).throw(AssertionError("a ready video is not asked about again")))
    assert mia.get(f"/yipi-media/{item.id}").status_code == 302
    assert mia.get(f"/yipi-media/{item.id}?same=1").status_code == 200, "the music player asks for the bytes from the site (the mixer is silent for another origin)"


def test_a_video_that_failed_at_bunny_stays_with_the_site(client, monkeypatch):
    on(monkeypatch)
    mia = person()
    item = video_row()
    db.session.add(yipi.YipiBunny(media_id=item.id, guid="g-2"))
    db.session.commit()
    monkeypatch.setattr(yipi_bunny, "status", lambda guid: 5)
    assert mia.get(f"/yipi-media/{item.id}").status_code == 200
    assert db.session.get(yipi.YipiBunny, item.id).failed is True
    assert mia.get(f"/yipi-media/{item.id}/poster").status_code == 404


def test_the_picture_of_a_video_comes_from_bunny(client, monkeypatch):
    mia = person()
    item = video_row()
    assert mia.get(f"/yipi-media/{item.id}/poster").status_code == 404
    on(monkeypatch)
    assert mia.get(f"/yipi-media/{item.id}/poster").status_code == 404, "not on Bunny"
    db.session.add(yipi.YipiBunny(media_id=item.id, guid="g-3"))
    db.session.commit()
    reply = mia.get(f"/yipi-media/{item.id}/poster")
    assert reply.status_code == 302 and reply.headers["Location"] == f"https://{CDN}/g-3/thumbnail.jpg"
    assert mia.get("/yipi-media/not-an-id/poster").status_code == 404


def test_the_policy_of_the_pages_lets_them_load_from_the_cdn(monkeypatch):
    assert CDN not in yipi.content_security_policy()
    on(monkeypatch)
    policy = yipi.content_security_policy()
    assert f"media-src 'self' blob: https://{CDN}" in policy and f"img-src 'self' data: blob: https://{CDN}" in policy and "script-src 'self'" in policy and "connect-src 'self';" in policy


def test_the_upload_and_the_migration_send_each_video_once(client, monkeypatch):
    calls = {"post": [], "put": []}

    class Reply:
        def __init__(self, data=None):
            self.data = data

        def raise_for_status(self):
            pass

        def json(self):
            return self.data
    monkeypatch.setattr(yipi_bunny.requests, "post", lambda url, json=None, headers=None, timeout=None: calls["post"].append((url, headers["AccessKey"], json)) or Reply({"guid": f"guid-{len(calls['post'])}"}))
    monkeypatch.setattr(yipi_bunny.requests, "put", lambda url, data=None, headers=None, timeout=None: calls["put"].append((url, len(data))) or Reply())
    on(monkeypatch)
    first, second = video_row(b"a" * 10), video_row(b"b" * 20)
    image = yipi.YipiMedia(id=uuid.uuid4().hex, owner_id=1, content_type="image/png", size=3, width=1, height=1, data=b"png")
    db.session.add(image)
    db.session.commit()
    assert yipi.bunny_migrate(pause=0) == (2, 0)
    assert {row.media_id for row in yipi.YipiBunny.query.all()} == {first.id, second.id}
    assert [url for url, _, _ in calls["post"]] == ["https://video.bunnycdn.com/library/42/videos"] * 2 and all(key == "secret" for _, key, _ in calls["post"])
    assert sorted(size for _, size in calls["put"]) == [10, 20]
    assert yipi.bunny_migrate(pause=0) == (0, 0), "what is on Bunny is skipped"


def mp4_bytes(extra=2000):
    """A file that is built like an MP4 (a type box, a free box, a data box)."""
    return bytes([0, 0, 0, 24]) + b"ftypisom" + bytes([0, 0, 2, 0]) + b"isomiso2" + bytes([0, 0, 0, 8]) + b"free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


def test_the_upload_of_a_video_starts_the_transfer_to_bunny(client, monkeypatch):
    seen = []
    monkeypatch.setattr(yipi_bunny, "push_later", lambda app, media_id, loader, record, title="": seen.append((media_id, len(loader()))))
    mia = person()
    data = mp4_bytes()
    reply = mia.post("/api/yipi/media", data={"file": (__import__("io").BytesIO(data), "clip.mp4", "video/mp4")}, content_type="multipart/form-data")
    assert reply.status_code == 200, reply.get_json()
    assert len(seen) == 1 and seen[0][1] == len(data)


def test_the_deployment_files_exist():
    for name in ("Dockerfile", "docker-compose.yml", os.path.join("deploy", "Caddyfile"), os.path.join("deploy", ".env.example"), os.path.join("deploy", "backup.sh"), os.path.join("deploy", "ANLEITUNG.md")):
        assert os.path.exists(os.path.join(ROOT, name)), name


def test_the_reels_warm_up_the_next_videos_in_steps_and_never_load_whole_videos_nobody_watches():
    with open(os.path.join(ROOT, "static", "js", "yipi-videos.js"), encoding="utf-8") as handle:
        videos = handle.read()
    for word in ("const warm = (reel, mode) =>", "else if (away === 1) { dress(reel); warm(reel, \"auto\"); }", "else if (away === 2 || away === 3) { dress(reel); warm(reel, \"metadata\"); }",
                 "else if (away === 4 || away === 5) dress(reel);", "reel.video.poster = `${reel.url}/poster`", "if (index >= reels.length - 6) more();"):
        assert word in videos, word
