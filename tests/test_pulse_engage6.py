"""Pulse, round 6: what brings people back -- the streak of days, level and badges, the lists of the best players, hearts on chat messages, the flame of
two friends who write every day, and notifications on the device (Web Push)."""
import base64
import os
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


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def api(client, method, path, body=None, status=None):
    r = getattr(client, method)(f"/api/yipi{path}", json=body) if body is not None else getattr(client, method)(f"/api/yipi{path}")
    if status is not None:
        assert r.status_code == status, (path, r.status_code, r.get_json())
    return r.get_json()


def friends(a, b, a_name, b_name):
    api(a, "post", f"/users/{b_name}/follow", {}, status=200)
    api(b, "post", f"/users/{a_name}/follow", {}, status=200)


# -------------------------------------------------------------------------------------------- the streak and the level
def test_the_streak_counts_days_in_a_row(client):
    from datetime import date
    mia = person("mia")
    user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
    assert user.streak == 1 and user.last_day == yipi.utcnow().date().isoformat()
    yipi.count_day(user, yipi.utcnow())
    db.session.commit()
    assert user.streak == 1, "the same day twice counts once"
    today = yipi.utcnow().date()
    user.last_day = (today - timedelta(days=1)).isoformat()
    user.streak = 4
    yipi.count_day(user)
    db.session.commit()
    assert user.streak == 5 and user.streak_best == 5
    user.last_day = (today - timedelta(days=3)).isoformat()
    yipi.count_day(user)
    db.session.commit()
    assert user.streak == 1 and user.streak_best == 5, "a missed day starts again, the best stays"
    assert api(mia, "get", "/me")["me"]["streak"] >= 1 and date.fromisoformat(user.last_day) == today


def test_level_and_badges_grow_with_what_a_person_does(client):
    mia, ben = person("mia"), person("ben")
    first = api(mia, "get", "/progress", status=200)
    assert first["level"] == 1 and first["xp"] >= 10 and first["from"] == 0 and first["to"] == 30 and first["streak"] == 1
    assert {b["id"] for b in first["badges"]} >= {"first-post", "likes-10", "streak-3", "video", "plays-10", "games-5", "chatter"}
    assert not next(b for b in first["badges"] if b["id"] == "first-post")["done"]
    post = api(mia, "post", "/posts", {"text": "Hallo"}, status=201)["post"]
    api(ben, "post", f"/posts/{post['id']}/like", {}, status=200)
    api(ben, "post", "/users/mia/follow", {}, status=200)
    second = api(mia, "get", "/progress", status=200)
    assert second["xp"] > first["xp"] and next(b for b in second["badges"] if b["id"] == "first-post")["done"]
    assert next(b for b in second["badges"] if b["id"] == "likes-10")["value"] == 1
    assert yipi.level_of(0) == (1, 0, 30) and yipi.level_of(29)[0] == 1 and yipi.level_of(30) == (2, 30, 120) and yipi.level_of(120)[0] == 3 and yipi.level_of(270)[0] == 4
    assert flask_app.test_client().get("/api/yipi/progress").status_code == 401


# --------------------------------------------------------------------------------------- the lists of the best players
def test_the_best_scores_of_a_game_make_a_list(client):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    r = api(mia, "post", "/play", {"game": "dino", "score": 120}, status=200)
    assert r["best"] == 120 and r["plays"] == 1 and r["record"] is True and r["rank"] == 1
    r = api(mia, "post", "/play", {"game": "dino", "score": 80}, status=200)
    assert r["best"] == 120 and r["plays"] == 2 and r["record"] is False
    api(ben, "post", "/play", {"game": "dino", "score": 300}, status=200)
    api(cy, "post", "/play", {"game": "dino", "score": 50}, status=200)
    api(cy, "post", "/play", {"game": "snake", "score": 9}, status=200)
    top = api(mia, "get", "/games/dino/top", status=200)
    assert [(i["user"]["handle"], i["best"], i["rank"]) for i in top["items"]] == [("ben", 300, 1), ("mia", 120, 2), ("cyrus", 50, 3)]
    assert top["items"][1]["isMe"] is True and top["me"] == {"best": 120, "plays": 2}
    assert api(mia, "get", "/games/snake/top", status=200)["me"] is None
    friends(mia, cy, "mia", "cyrus")
    only = api(mia, "get", "/games/dino/top?scope=friends", status=200)
    assert [i["user"]["handle"] for i in only["items"]] == ["mia", "cyrus"], "only you and your friends"
    for bad in ({"game": "Dino!", "score": 1}, {"game": "dino", "score": -5}, {"game": "dino", "score": "many"}, {"game": "dino", "score": 10 ** 9}, {"game": "dino", "score": True}, {"score": 4}):
        assert api(mia, "post", "/play", bad)["ok"] is False, bad
    assert api(mia, "get", "/games/Bad_Name/top").get("ok") is not True
    api(mia, "post", "/users/ben/block", {}, status=200)
    assert [i["user"]["handle"] for i in api(mia, "get", "/games/dino/top", status=200)["items"]] == ["mia", "cyrus"], "somebody you blocked is not in your list"
    assert flask_app.test_client().post("/api/yipi/play", json={"game": "dino", "score": 1}).status_code == 401


# ------------------------------------------------------------------------------------------------- hearts on messages
def test_a_double_tap_puts_a_heart_on_a_message(client):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    friends(mia, ben, "mia", "ben")
    sent = api(mia, "post", "/messages/ben", {"text": "Schau mal"}, status=201)["message"]
    assert sent["hearts"] == 0 and sent["hearted"] is False
    r = api(ben, "post", f"/messages/mia/{sent['id']}/heart", {}, status=200)
    assert r["hearts"] == 1 and r["hearted"] is True
    assert api(ben, "post", f"/messages/mia/{sent['id']}/heart", {}, status=200)["hearts"] == 1, "a second heart of the same person does not count"
    thread = api(mia, "get", "/messages/ben", status=200)["messages"][0]
    assert thread["hearts"] == 1 and thread["hearted"] is False
    poll = api(mia, "get", "/messages/ben/poll?after=999999", status=200)
    assert poll["hearts"][str(sent["id"])] == [1, False]
    api(mia, "post", f"/messages/ben/{sent['id']}/heart", {}, status=200)
    assert api(mia, "get", "/messages/ben", status=200)["messages"][0]["hearts"] == 2
    r = api(ben, "delete", f"/messages/mia/{sent['id']}/heart", status=200)
    assert r["hearts"] == 1 and r["hearted"] is False
    assert cy.post(f"/api/yipi/messages/mia/{sent['id']}/heart", json={}).status_code == 404, "somebody outside the conversation cannot"
    assert ben.post(f"/api/yipi/messages/cyrus/{sent['id']}/heart", json={}).status_code == 404, "and not through another conversation either"
    assert ben.post("/api/yipi/messages/mia/99999/heart", json={}).status_code == 404


def test_hearts_on_the_messages_of_a_group(client):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    friends(mia, ben, "mia", "ben")
    group = api(mia, "post", "/groups", {"name": "Team", "members": ["ben"]}, status=201)["group"]
    sent = api(mia, "post", f"/groups/{group['id']}/messages", {"text": "Hallo Team"}, status=201)["message"]
    assert api(ben, "post", f"/groups/{group['id']}/messages/{sent['id']}/heart", {}, status=200)["hearts"] == 1
    listed = api(mia, "get", f"/groups/{group['id']}", status=200)["messages"][-1]
    assert listed["hearts"] == 1 and listed["hearted"] is False
    assert api(mia, "get", f"/groups/{group['id']}/poll?after=0", status=200)["hearts"][str(sent["id"])] == [1, False]
    assert cy.post(f"/api/yipi/groups/{group['id']}/messages/{sent['id']}/heart", json={}).status_code == 404
    assert api(ben, "delete", f"/groups/{group['id']}/messages/{sent['id']}/heart", status=200)["hearts"] == 0


# ------------------------------------------------------------------------------------------ the flame of two friends
def test_two_people_who_write_each_other_every_day_get_a_flame(client):
    mia, ben = person("mia"), person("ben")
    friends(mia, ben, "mia", "ben")
    api(mia, "post", "/messages/ben", {"text": "Hi"}, status=201)
    api(ben, "post", "/messages/mia", {"text": "Hi!"}, status=201)
    assert api(mia, "get", "/messages", status=200)["items"][0]["streak"] == 0, "one day is no streak yet"
    today = yipi.utcnow()
    # the same two people, on the three days before: both wrote each day
    for days_ago in (1, 2):
        for sender, recipient in ((1, 2), (2, 1)):
            db.session.add(yipi.YipiMessage(sender_id=sender, recipient_id=recipient, text="früher", created_at=today - timedelta(days=days_ago)))
    db.session.commit()
    assert api(mia, "get", "/messages", status=200)["items"][0]["streak"] == 3
    assert api(ben, "get", "/chats", status=200)["items"][0]["streak"] == 3
    assert yipi.friend_streaks(db.session.get(yipi.YipiUser, 1), [2]) == {2: 3}
    # ben skips yesterday: today both wrote, but the day before only mia did -> the flame is out
    yesterday = [m for m in yipi.YipiMessage.query.filter_by(sender_id=2).all() if m.created_at.date() == (today - timedelta(days=1)).date()]
    assert len(yesterday) == 1
    db.session.delete(yesterday[0])
    db.session.commit()
    assert api(mia, "get", "/messages", status=200)["items"][0]["streak"] == 0, "when one side skipped a day the flame is out"


# --------------------------------------------------------------------------------------- notifications on the device
def b64url_len(text):
    return len(base64.urlsafe_b64decode(text + "=" * (-len(text) % 4)))


def subscription(n=1):
    return {"endpoint": f"https://push.example.com/send/abc{n}", "keys": {"p256dh": "BNc" + "x" * 80, "auth": "authsecret" + str(n)}}


def test_the_site_makes_its_own_keys_and_takes_subscriptions(client, monkeypatch):
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    mia = person("mia")
    key = api(mia, "get", "/push/key", status=200)
    assert b64url_len(key["key"]) == 65 and key["subscribed"] == 0, "an uncompressed P-256 point"
    assert api(mia, "get", "/push/key", status=200)["key"] == key["key"], "the same key every time"
    assert yipi.YipiPushKey.query.count() == 1
    api(mia, "post", "/push/subscribe", {"subscription": subscription(1)}, status=200)
    api(mia, "post", "/push/subscribe", {"subscription": subscription(1)}, status=200)
    assert yipi.YipiPush.query.count() == 1, "the same browser twice is one"
    for k in range(2, 9):
        api(mia, "post", "/push/subscribe", {"subscription": subscription(k)}, status=200)
    assert yipi.YipiPush.query.count() == 5, "at most five browsers per person (the oldest goes)"
    for bad in ({}, {"subscription": {"endpoint": "http://insecure.example.com/x", "keys": {"p256dh": "a", "auth": "b"}}}, {"subscription": {"endpoint": "https://x.example.com/y"}}, {"subscription": "x"}):
        assert api(mia, "post", "/push/subscribe", bad)["ok"] is False
    api(mia, "post", "/push/unsubscribe", {"endpoint": subscription(8)["endpoint"]}, status=200)
    assert yipi.YipiPush.query.count() == 4
    api(mia, "post", "/push/unsubscribe", {}, status=200)
    assert yipi.YipiPush.query.count() == 0
    assert flask_app.test_client().get("/api/yipi/push/key").status_code == 401


def test_the_service_worker_is_served_from_the_root(client):
    r = flask_app.test_client().get("/pulse-sw.js")
    assert r.status_code == 200 and r.mimetype == "application/javascript" and r.headers["Service-Worker-Allowed"] == "/" and "no-cache" in r.headers["Cache-Control"]
    assert b'addEventListener("push"' in r.data and b"notificationclick" in r.data


def test_a_like_a_message_and_a_follow_send_a_notification_to_the_other_device(client, monkeypatch):
    sent = []
    monkeypatch.setattr(yipi, "PUSH_RUNNER", lambda app, user_id, payload: yipi.deliver_push(user_id, payload))
    monkeypatch.setattr(yipi, "web_push", lambda subscription, payload, key: sent.append((subscription["endpoint"], payload)))
    mia, ben = person("mia"), person("ben")
    api(mia, "post", "/push/subscribe", {"subscription": subscription(1)}, status=200)
    user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
    post = api(mia, "post", "/posts", {"text": "Mein Beitrag"}, status=201)["post"]
    api(ben, "post", f"/posts/{post['id']}/like", {}, status=200)
    assert sent == [], "mia is on the page right now: no notification"
    user.last_seen_at = yipi.utcnow() - timedelta(minutes=10)
    db.session.commit()
    api(ben, "post", "/users/mia/follow", {}, status=200)
    assert len(sent) == 1 and sent[0][0] == subscription(1)["endpoint"] and sent[0][1]["title"] == "Pulse" and "folgt dir" in sent[0][1]["body"] and sent[0][1]["url"] == "/ben"
    api(mia, "post", "/users/ben/follow", {}, status=200)
    user.last_seen_at = yipi.utcnow() - timedelta(minutes=10)
    db.session.commit()
    api(ben, "post", "/messages/mia", {"text": "Hallo"}, status=201)
    assert len(sent) == 2 and "hat dir geschrieben" in sent[1][1]["body"] and sent[1][1]["url"] == "/messages/ben"
    group = api(mia, "post", "/groups", {"name": "Team", "members": ["ben"]}, status=201)["group"]
    user.last_seen_at = yipi.utcnow() - timedelta(minutes=10)
    db.session.commit()
    api(ben, "post", f"/groups/{group['id']}/messages", {"text": "Moin"}, status=201)
    assert len(sent) == 3 and "Team" in sent[2][1]["body"] and sent[2][1]["url"] == f"/g/{group['id']}"
    assert "Hallo" not in str(sent) and "Moin" not in str(sent), "the text of a message never goes into a notification"


def test_a_browser_that_is_gone_is_forgotten_and_a_broken_one_does_not_break_a_like(client, monkeypatch):
    class Gone(Exception):
        response = type("R", (), {"status_code": 410})()

    class Broken(Exception):
        response = type("R", (), {"status_code": 500})()

    calls = []

    def fake(subscription, payload, key):
        calls.append(subscription["endpoint"])
        raise Gone() if subscription["endpoint"].endswith("abc1") else Broken()

    monkeypatch.setattr(yipi, "PUSH_RUNNER", lambda app, user_id, payload: yipi.deliver_push(user_id, payload))
    monkeypatch.setattr(yipi, "web_push", fake)
    mia, ben = person("mia"), person("ben")
    api(mia, "post", "/push/subscribe", {"subscription": subscription(1)}, status=200)
    api(mia, "post", "/push/subscribe", {"subscription": subscription(2)}, status=200)
    user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
    user.last_seen_at = yipi.utcnow() - timedelta(minutes=10)
    db.session.commit()
    assert api(ben, "post", "/users/mia/follow", {}, status=200)["ok"] is True
    assert len(calls) == 2
    assert [row.endpoint for row in yipi.YipiPush.query.all()] == [subscription(2)["endpoint"]], "410: that browser is removed, 500: kept"


def test_the_keys_of_the_site_are_real_vapid_keys(client, monkeypatch):
    """Made by the site: a PEM that the push library takes. Set in the environment: the usual raw form (or a PEM) works as well."""
    from py_vapid import Vapid
    monkeypatch.delenv("VAPID_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("VAPID_PUBLIC_KEY", raising=False)
    mia = person("mia")
    api(mia, "get", "/push/key", status=200)
    key = yipi.YipiPushKey.query.first()
    assert key.private_pem.startswith("-----BEGIN") and yipi.vapid_signer(key).public_key is not None
    db.session.delete(key)
    db.session.commit()
    own = Vapid()
    own.generate_keys()
    from cryptography.hazmat.primitives import serialization
    raw_private = base64.urlsafe_b64encode(own.private_key.private_numbers().private_value.to_bytes(32, "big")).rstrip(b"=").decode()
    raw_public = base64.urlsafe_b64encode(own.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)).rstrip(b"=").decode()
    monkeypatch.setenv("VAPID_PRIVATE_KEY", raw_private)
    monkeypatch.setenv("VAPID_PUBLIC_KEY", raw_public)
    assert api(mia, "get", "/push/key", status=200)["key"] == raw_public
    signer = yipi.vapid_signer(yipi.YipiPushKey.query.first())
    assert signer.public_key.public_numbers() == own.public_key.public_numbers(), "the same key as the one in the environment"
    pem = YipiPem = type("K", (), {"private_pem": own.private_pem().decode()})
    assert yipi.vapid_signer(pem).public_key.public_numbers() == own.public_key.public_numbers()
