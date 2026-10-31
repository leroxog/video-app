"""Nex: a notification on the phone when somebody you follow posts something new (the ones for likes, answers, follows and messages are in test_pulse_engage6.py). An iPhone shows
notifications only for an app of the home screen: the page says how to make one."""
import io
import os
import struct
import sys
import tempfile
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")


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


def subscription(n):
    return {"endpoint": f"https://push.example/{n}", "keys": {"p256dh": "p" * 20, "auth": "a" * 10}}


def png():
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 10, 10) + b"\x08\x06\x00\x00\x00" + b"\x00" * 20


def idle(handle):
    user = yipi.YipiUser.query.filter_by(handle_lc=handle).first()
    user.last_seen_at = yipi.utcnow() - timedelta(minutes=10)
    db.session.commit()


def test_a_new_post_buzzes_the_phones_of_the_people_who_follow_the_author(client, monkeypatch):
    sent = []
    monkeypatch.setattr(yipi, "PUSH_RUNNER", lambda app, user_id, payload: yipi.deliver_push(user_id, payload))
    monkeypatch.setattr(yipi, "web_push", lambda sub, payload, key: sent.append((sub["endpoint"], payload)))
    mia, tom, eva, ben, zoe = (person(name) for name in ("mia", "tom", "eva", "ben", "zoe"))
    for n, (who, name) in enumerate(((tom, "tom"), (eva, "eva"), (ben, "ben")), start=1):
        assert who.post("/api/yipi/users/mia/follow", json={}).status_code == 200
        assert who.post("/api/yipi/push/subscribe", json={"subscription": subscription(n)}).status_code == 200
        idle(name)
    assert zoe.post("/api/yipi/push/subscribe", json={"subscription": subscription(9)}).status_code == 200, "zoe does not follow mia"
    idle("zoe")
    assert eva.post("/api/yipi/users/mia/mute", json={}).status_code == 200, "eva muted mia"
    assert ben.post("/api/yipi/users/mia/block", json={}).status_code == 200, "ben blocked mia"
    sent.clear()
    idle("tom")
    post = mia.post("/api/yipi/posts", json={"text": "Mein neuer Beitrag"})
    assert post.status_code == 201, post.get_json()
    assert [endpoint for endpoint, _ in sent] == ["https://push.example/1"], "only tom: eva muted mia, ben blocked her, zoe does not follow her"
    assert len(sent) == 1 and "hat etwas Neues gepostet" in sent[0][1]["body"] and sent[0][1]["url"] == f"/mia/status/{post.get_json()['post']['id']}"
    assert "Mein neuer Beitrag" not in str(sent), "the text of the post is not in the notification"
    sent.clear()
    reply = mia.post("/api/yipi/posts", json={"text": "Antwort", "replyTo": post.get_json()["post"]["id"]})
    assert reply.status_code == 201 and sent == [], "an answer is not told to the followers"
    tom_user = yipi.YipiUser.query.filter_by(handle_lc="tom").first()
    tom_user.last_seen_at = yipi.utcnow()
    db.session.commit()
    mia.post("/api/yipi/posts", json={"text": "Noch einer"})
    assert sent == [], "tom is on the page right now"


def test_the_notification_says_photo_or_video(client, monkeypatch):
    sent = []
    monkeypatch.setattr(yipi, "PUSH_RUNNER", lambda app, user_id, payload: yipi.deliver_push(user_id, payload))
    monkeypatch.setattr(yipi, "web_push", lambda sub, payload, key: sent.append(payload))
    mia, tom = person("mia"), person("tom")
    tom.post("/api/yipi/users/mia/follow", json={})
    tom.post("/api/yipi/push/subscribe", json={"subscription": subscription(1)})
    sent.clear()
    idle("tom")
    up = mia.post("/api/yipi/media", data={"file": (io.BytesIO(png()), "p.png")}, content_type="multipart/form-data")
    assert up.status_code == 200
    assert mia.post("/api/yipi/posts", json={"text": "Foto", "media": [up.get_json()["media"]["id"]]}).status_code == 201
    assert len(sent) == 1 and "ein neues Foto" in sent[0]["body"]


def test_the_page_says_how_an_iphone_gets_notifications():
    progress = open(os.path.join(JS_DIR, "yipi-progress.js"), encoding="utf-8").read()
    assert "needsInstall" in progress and "navigator.standalone" in progress and "Zum Home-Bildschirm" in progress and "wenn jemand, dem du folgst" in progress
    sw = flask_app.test_client().get("/pulse-sw.js")
    assert sw.status_code == 200 and b"showNotification" in sw.data
    manifest = flask_app.test_client().get("/manifest.webmanifest").get_json()
    assert manifest["display"] == "standalone" and manifest["start_url"] == "/" and any(icon["sizes"] == "192x192" for icon in manifest["icons"])
    html = flask_app.test_client().get("/i/login").get_data(as_text=True)
    assert 'name="apple-mobile-web-app-capable"' in html and 'rel="apple-touch-icon"' in html
