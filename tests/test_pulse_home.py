"""Home held upright has no videos: the timeline can be asked for the posts without videos (and without reposts of them); held sideways it is the normal feed."""
import os
import sys
import tempfile
import uuid

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def calm(monkeypatch):
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


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def make_post(user_id, text, video=False):
    post = yipi.YipiPost(user_id=user_id, text=text)
    db.session.add(post)
    db.session.flush()
    if video:
        db.session.add(yipi.YipiMedia(id=uuid.uuid4().hex, owner_id=user_id, post_id=post.id, content_type="video/mp4", data=b"x", size=1, width=9, height=16, alt=""))
    db.session.commit()
    return post


def test_the_feed_without_videos_for_a_phone_held_upright(client):
    ana = person("ana")
    bob_id = yipi.YipiUser.query.filter_by(handle="ana").one().id
    plain = make_post(bob_id, "Nur Text")
    clip = make_post(bob_id, "Ein Video", video=True)
    repost = yipi.YipiPost(user_id=bob_id, text="", repost_of_id=clip.id)
    db.session.add(repost)
    db.session.commit()
    everything = {item["id"] for item in ana.get("/api/yipi/timeline?feed=following").get_json()["items"]}
    assert {plain.id, clip.id} <= everything
    upright = {item["id"] for item in ana.get("/api/yipi/timeline?feed=following&novideo=1").get_json()["items"]}
    assert plain.id in upright and clip.id not in upright and repost.id not in upright, "no video and no repost of a video"
    upright = {item["id"] for item in ana.get("/api/yipi/timeline?feed=foryou&novideo=1").get_json()["items"]}
    assert plain.id in upright and clip.id not in upright
    assert clip.id in {item["id"] for item in ana.get("/api/yipi/timeline?feed=foryou").get_json()["items"]}, "sideways it is the normal feed"
    later = make_post(bob_id, "Noch ein Text")
    other = person("ben")
    assert other.get("/api/yipi/timeline/new?feed=foryou&after=1&novideo=1").get_json()["count"] == 1, "the pill 'new posts' does not count videos either"
    assert other.get("/api/yipi/timeline/new?feed=foryou&after=1").get_json()["count"] == 2 and later.id > clip.id
