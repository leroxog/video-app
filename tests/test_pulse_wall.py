"""The login wall (2026-10-18): somebody who is not signed in sees nothing of Pulse but the page to sign in. The pages answer with the same
page for every address (without anything about the profile or the post that was asked for), and every call of the API except the ones to
sign up, sign in, sign out, ask who is signed in and check a name answers "not_logged_in"."""
import os
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


READS = ["/timeline", "/timeline/new?after=1", "/trends", "/suggestions", "/search?q=abc", "/users/mia", "/users/mia/posts", "/users/mia/followers", "/users/mia/following",
         "/posts/1", "/posts/1/replies", "/posts/1/likes", "/notifications", "/bookmarks", "/messages", "/chats", "/friends", "/gifs", "/groups/1"]


def test_every_read_needs_an_account(client):
    person("mia")
    guest = flask_app.test_client()
    for path in READS:
        r = guest.get("/api/yipi" + path)
        assert r.status_code == 401 and r.get_json() == {"ok": False, "error": "not_logged_in"}, path
    for path in ("/posts", "/posts/1/like", "/users/mia/follow", "/messages/mia", "/nex", "/groups", "/media"):
        assert guest.post("/api/yipi" + path, json={}).status_code == 401, path


def test_what_works_without_an_account_is_signing_up_in_and_out(client):
    guest = flask_app.test_client()
    assert guest.get("/api/yipi/me").get_json()["me"] is None
    assert guest.get("/api/yipi/handle?handle=abcd").status_code == 200
    assert guest.post("/api/yipi/logout", json={}).status_code == 200
    mia = person("mia")
    assert mia.get("/api/yipi/timeline").status_code == 200 and mia.get("/api/yipi/me").get_json()["me"]["handle"] == "mia"
    assert flask_app.test_client().post("/api/yipi/login", json={"login": "mia", "password": PASSWORD}).status_code == 200


def test_every_address_gives_a_guest_the_same_page_without_anything_about_it(client):
    mia = person("mia")
    post = mia.post("/api/yipi/posts", json={"text": "Geheimer Satz im Beitrag"}).get_json()["post"]
    guest = flask_app.test_client()
    pages = [guest.get(path).get_data(as_text=True) for path in ("/", "/mia", f"/mia/status/{post['id']}", "/messages", "/i/nex", "/camera", "/videos", "/g/1")]
    for text in pages:
        assert "Geheimer Satz" not in text and "(@mia)" not in text
        assert '"me": null' in text.replace('"me":null', '"me": null')
    assert "<title>Pulse" in pages[0] and 'content="noindex"' not in pages[0]
    assert all('content="noindex"' in text for text in pages[1:])
    assert 'content="noindex"' not in mia.get("/mia").get_data(as_text=True)
    assert "(@mia) auf Pulse" in mia.get("/mia").get_data(as_text=True)
    assert guest.get("/gibt-es-nicht-oder-doch").status_code == 404 and guest.get("/nobody").status_code == 404


def test_the_legal_pages_stay_open_because_the_law_wants_them_to_be(client):
    guest = flask_app.test_client()
    for path in ("/nutzungsbedingungen", "/datenschutz", "/impressum"):
        assert guest.get(path).status_code == 200, path
