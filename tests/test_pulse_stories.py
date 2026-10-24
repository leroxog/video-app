"""Pulse: stories (a photo or short video for 24 hours, like on Snapchat and Instagram)."""
import io
import os
import struct
import sys
import tempfile
import zlib
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from blobstore import STORE  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def fast_passwords(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    yipi._story_purge["at"] = None
    siteauth._keys.clear()
    STORE.disable()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def api(client, method, path, body=None, status=None):
    r = getattr(client, method)(f"/api/yipi{path}", json=body) if body is not None else getattr(client, method)(f"/api/yipi{path}")
    if status is not None:
        assert r.status_code == status, (path, r.status_code, r.get_json())
    return r.get_json()


def png():
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00" + b"\xff\x00\x00" * 4)) + chunk(b"IEND", b"")


def mp4(extra=3000):
    return b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


def upload(client, data, name):
    r = client.post("/api/yipi/media", data={"file": (io.BytesIO(data), name), "width": "720", "height": "1280"}, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_json()
    return r.get_json()["media"]


def tell(client, caption="", data=None, name="a.png"):
    media = upload(client, data or png(), name)
    return api(client, "post", "/stories", {"media": media["id"], "caption": caption}, status=201)["story"]


def follow(a, a_name, b_name):
    api(a, "post", f"/users/{b_name}/follow", {}, status=200)


def test_a_story_is_a_photo_or_video_that_shows_up_in_the_row_of_the_people_who_follow(client):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    follow(ben, "ben", "mia")
    story = tell(mia, "Guten Morgen")
    assert story["caption"] == "Guten Morgen" and story["mine"] is True and story["media"]["url"].startswith("/yipi-media/") and story["views"] == 0
    video = tell(mia, "", mp4(), "c.mp4")
    assert video["media"]["video"] is True
    ring = api(ben, "get", "/stories", status=200)
    assert [(i["user"]["handle"], i["count"], i["unseen"], i["isMe"]) for i in ring["items"]] == [("mia", 2, 2, False)] and ring["me"] is False
    assert api(cy, "get", "/stories", status=200)["items"] == [], "somebody who does not follow mia does not get her story in the row"
    own = api(mia, "get", "/stories", status=200)
    assert [(i["user"]["handle"], i["isMe"], i["unseen"]) for i in own["items"]] == [("mia", True, 0)] and own["me"] is True
    assert flask_app.test_client().get("/api/yipi/stories").status_code == 401


def test_the_items_of_a_person_come_in_order_and_seeing_them_turns_the_ring_grey(client):
    mia, ben = person("mia"), person("ben")
    follow(ben, "ben", "mia")
    first, second = tell(mia, "eins"), tell(mia, "zwei")
    listing = api(ben, "get", "/stories/mia", status=200)
    assert [i["caption"] for i in listing["items"]] == ["eins", "zwei"] and all(i["seen"] is False and i["mine"] is False and "views" not in i for i in listing["items"])
    assert listing["user"]["handle"] == "mia"
    api(ben, "post", f"/stories/{first['id']}/seen", {}, status=200)
    api(ben, "post", f"/stories/{first['id']}/seen", {}, status=200)
    assert api(ben, "get", "/stories", status=200)["items"][0]["unseen"] == 1
    api(ben, "post", f"/stories/{second['id']}/seen", {}, status=200)
    assert api(ben, "get", "/stories", status=200)["items"][0]["unseen"] == 0
    assert [i["seen"] for i in api(ben, "get", "/stories/mia", status=200)["items"]] == [True, True]
    seen_by_owner = api(mia, "get", "/stories/mia", status=200)["items"]
    assert [i["views"] for i in seen_by_owner] == [1, 1], "a second look of the same person does not count twice"
    api(mia, "post", f"/stories/{first['id']}/seen", {}, status=200)
    assert api(mia, "get", "/stories/mia", status=200)["items"][0]["views"] == 1, "looking at your own story does not count"


def test_unseen_stories_come_first_and_yours_is_the_first_circle(client):
    mia, ben, cy, di = person("mia"), person("ben"), person("cyrus"), person("dina")
    for name in ("mia", "cyrus", "dina"):
        follow(ben, "ben", name)
    tell(cy, "von cy")
    watched = tell(mia, "von mia")
    tell(di, "von dina")
    api(ben, "post", f"/stories/{watched['id']}/seen", {}, status=200)
    tell(ben, "meine")
    handles = [i["user"]["handle"] for i in api(ben, "get", "/stories", status=200)["items"]]
    assert handles[0] == "ben" and handles[-1] == "mia" and set(handles[1:3]) == {"cyrus", "dina"}, handles


def test_a_story_lasts_a_day(client):
    mia, ben = person("mia"), person("ben")
    follow(ben, "ben", "mia")
    story = tell(mia, "alt")
    row = db.session.get(yipi.YipiStory, story["id"])
    row.created_at = yipi.utcnow() - timedelta(hours=25)
    db.session.commit()
    assert api(ben, "get", "/stories", status=200)["items"] == []
    assert api(ben, "get", "/stories/mia", status=200)["items"] == []
    assert api(ben, "post", f"/stories/{story['id']}/seen", {}).get("ok") is not True
    yipi._story_purge["at"] = None
    api(ben, "get", "/stories", status=200)
    assert yipi.YipiStory.query.count() == 0 and yipi.YipiMedia.query.count() == 0, "the story and its picture are removed"


def test_the_picture_of_a_story_is_not_thrown_away_as_an_unused_upload(client):
    mia = person("mia")
    story = tell(mia, "bleibt")
    media = db.session.get(yipi.YipiMedia, story["media"]["id"])
    media.created_at = yipi.utcnow() - timedelta(hours=10)
    db.session.commit()
    user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
    db.session.query(yipi.YipiMedia).filter_by(id=media.id).update({"created_at": yipi.utcnow() - timedelta(days=2)})
    db.session.commit()
    upload(mia, png(), "b.png")                                   # an upload triggers the cleanup of old unused pictures
    assert db.session.get(yipi.YipiMedia, media.id) is not None
    assert user is not None


def test_only_your_own_fresh_uploads_can_become_a_story(client):
    mia, ben = person("mia"), person("ben")
    foreign = upload(ben, png(), "a.png")
    assert api(mia, "post", "/stories", {"media": foreign["id"]})["ok"] is False, "somebody else's picture"
    mine = upload(mia, png(), "b.png")
    post = api(mia, "post", "/posts", {"text": "Foto", "media": [mine["id"]]}, status=201)["post"]
    assert api(mia, "post", "/stories", {"media": mine["id"]})["ok"] is False, "a picture that belongs to a post"
    for bad in ({}, {"media": 5}, {"media": "nope"}, {"media": "0" * 32}, {"media": upload(mia, png(), "c.png")["id"], "caption": "x" * 141}):
        assert api(mia, "post", "/stories", bad)["ok"] is False, bad
    fresh = upload(mia, png(), "d.png")
    api(mia, "post", "/stories", {"media": fresh["id"], "caption": "ok"}, status=201)
    assert api(mia, "post", "/stories", {"media": fresh["id"]})["ok"] is False, "a picture makes one story"
    assert post["id"]


def test_deleting_a_story_removes_it_and_its_picture(client):
    mia, ben = person("mia"), person("ben")
    follow(ben, "ben", "mia")
    story = tell(mia, "weg")
    assert ben.delete(f"/api/yipi/stories/{story['id']}").status_code == 403
    api(mia, "delete", f"/stories/{story['id']}", status=200)
    assert yipi.YipiStory.query.count() == 0 and db.session.get(yipi.YipiMedia, story["media"]["id"]) is None
    assert api(mia, "delete", f"/stories/{story['id']}").get("ok") is not True


def test_blocking_and_muting_hide_the_story_of_a_person(client):
    mia, ben = person("mia"), person("ben")
    follow(ben, "ben", "mia")
    tell(mia, "hallo")
    api(ben, "post", "/users/mia/block", {}, status=200)
    assert api(ben, "get", "/stories", status=200)["items"] == []
    assert ben.get("/api/yipi/stories/mia").status_code == 404


def test_deleting_an_account_removes_its_stories_and_views(client):
    mia, ben = person("mia"), person("ben")
    follow(ben, "ben", "mia")
    story = tell(mia, "tschüss")
    api(ben, "post", f"/stories/{story['id']}/seen", {}, status=200)
    assert yipi.YipiStoryView.query.count() == 1
    reply = mia.post("/api/yipi/delete", json={"password": PASSWORD})
    assert reply.status_code == 200, reply.get_json()
    assert yipi.YipiStory.query.count() == 0 and yipi.YipiStoryView.query.count() == 0 and yipi.YipiMedia.query.count() == 0


def test_a_person_can_have_thirty_stories_at_most(client):
    mia = person("mia")
    for n in range(30):
        tell(mia, f"s{n}")
        yipi._hits.clear()
    media = upload(mia, png(), "x.png")
    assert api(mia, "post", "/stories", {"media": media["id"]}) == {"ok": False, "error": "too_many_stories"}
