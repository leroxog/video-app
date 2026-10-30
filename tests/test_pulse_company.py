"""Nex: the official accounts (yipi_company.py): "Nex-Web" and "Nex-AI" belong to Nex itself, nobody can sign in as them or get one, they read no
messages, they are marked, and a release posts its announcements by itself, once."""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_company  # noqa: E402
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


def test_the_announcements_are_well_formed():
    ids = [key for key, _, _ in yipi_company.ANNOUNCEMENTS]
    assert len(ids) == len(set(ids)), "an id is never used twice"
    for key, kind, text in yipi_company.ANNOUNCEMENTS:
        assert kind in yipi_company.ACCOUNTS and 10 < len(text) <= yipi.MAX_POST, key
        assert text.count("#") <= 2, key


def test_the_two_accounts_are_made_marked_and_nobody_can_sign_in_as_one(client):
    yipi_company.start_up(flask_app)
    web = yipi.YipiUser.query.filter_by(handle="nexweb").one()
    ai = yipi.YipiUser.query.filter_by(handle="nexai").one()
    assert web.name == "Nex-Web" and ai.name == "Nex-AI" and web.company and ai.company
    assert web.password_hash == "!" and ai.password_hash == "!"
    for handle in ("nexweb", "nexai"):
        for password in (PASSWORD, "!", ""):
            assert client.post("/api/yipi/login", json={"login": handle, "password": password}).status_code in (400, 401), (handle, password)
        assert client.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).get_json()["error"] in ("reserved_handle", "handle_taken")
    for handle in ("Nex_Web", "nex_ai", "NexTeam"):
        assert client.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).get_json()["error"] == "reserved_handle", handle


def test_a_release_posts_its_announcements_once(client):
    assert yipi_company.publish_pending() == len(yipi_company.ANNOUNCEMENTS)
    assert yipi_company.publish_pending() == 0, "the second start of the site posts nothing again"
    posts = yipi.YipiPost.query.order_by(yipi.YipiPost.id).all()
    assert len(posts) == len(yipi_company.ANNOUNCEMENTS)
    authors = {yipi.db.session.get(yipi.YipiUser, post.user_id).handle for post in posts}
    assert authors == {"nexweb", "nexai"}
    assert yipi.YipiUser.query.filter_by(handle="nexweb").one().posts_count == sum(1 for _, kind, _ in yipi_company.ANNOUNCEMENTS if kind == "web")
    assert yipi.YipiTag.query.count() >= 1, "the hashtags of the announcements are searchable"
    yipi_company.publish_pending([("2026-11-01-test", "web", "Ein neuer Test-Eintrag für Nex-Web.")])
    assert yipi.YipiPost.query.count() == len(yipi_company.ANNOUNCEMENTS) + 1


def test_nobody_is_made_to_follow_them_but_their_posts_are_in_the_feed_and_they_are_suggested(client):
    olga = person("olga")
    yipi_company.start_up(flask_app)
    assert olga.get("/api/yipi/me").get_json()["me"]["following"] == 0, "a new account follows nobody"
    timeline = olga.get("/api/yipi/timeline?feed=foryou").get_json()["items"]
    assert {item["user"]["handle"] for item in timeline} >= {"nexweb", "nexai"}, "the announcements are in everybody's feed"
    assert olga.get("/api/yipi/timeline?feed=following").get_json()["items"] == []
    suggested = {user["handle"] for user in olga.get("/api/yipi/suggestions?limit=20").get_json()["users"]}
    assert {"nexweb", "nexai"} <= suggested, "and they are suggested under 'Wem folgen'"


def test_the_profile_says_official_and_nobody_can_write_to_them(client):
    olga = person("olga")
    yipi_company.official_ids()
    profile = olga.get("/api/yipi/users/nexweb").get_json()
    assert profile["user"]["company"] is True and profile["user"]["name"] == "Nex-Web"
    assert olga.get("/api/yipi/users/olga").get_json()["user"]["company"] is False
    reply = olga.post("/api/yipi/messages/nexweb", json={"text": "Hallo"})
    assert reply.status_code == 403 and reply.get_json()["error"] == "official_account"
    olga.post("/api/yipi/posts", json={"text": "Mein Beitrag"})
    timeline = olga.get("/api/yipi/timeline?feed=foryou").get_json()["items"]
    assert any(item["user"]["handle"] == "olga" for item in timeline)
    yipi_company.publish_pending()
    timeline = olga.get("/api/yipi/timeline?feed=foryou").get_json()["items"]
    official = [item for item in timeline if item["user"]["handle"] in ("nexweb", "nexai")]
    assert official and all(item["user"]["company"] is True for item in official)
    friends = olga.get("/api/yipi/friends").get_json()
    assert not any(user["handle"] in ("nexweb", "nexai") for user in friends["users"]), "official accounts are not friends to chat with"


def test_the_front_end_shows_the_mark():
    root = os.path.join(os.path.dirname(__file__), "..")
    ui = open(os.path.join(root, "static", "js", "yipi-ui.js"), encoding="utf-8").read()
    css = open(os.path.join(root, "static", "css", "yipi.css"), encoding="utf-8").read()
    assert 'user.company' in ui and 'co-badge' in ui and ".co-badge {" in css
