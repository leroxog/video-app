"""Satürn, 2026-11-08: the admin side (moderation page): who is online, everybody who is registered, the requests that people send to the team, and the delete button for every post.
The admins are named in the environment variable YIPI_ADMINS (never in the code, and never with a password), and no password is ever shown: the site only keeps a hash."""
import os
import sys
import tempfile
from datetime import timedelta

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.setenv("YIPI_ADMINS", "lerox")


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
    who = flask_app.test_client()
    assert who.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return who


def test_only_an_admin_sees_the_overview_and_it_shows_the_people_but_no_password(client):
    lerox, mia = person("lerox"), person("mia")
    assert mia.get("/api/yipi/admin/overview").status_code == 403
    assert mia.get("/api/yipi/admin/requests").status_code == 403
    me = yipi.YipiUser.query.filter_by(handle_lc="mia").one()
    me.email = "mia@example.com"
    db.session.commit()
    data = lerox.get("/api/yipi/admin/overview").get_json()
    assert data["ok"] and data["total"] == 2 and data["online"] == 2
    row = next(p for p in data["people"] if p["handle"] == "mia")
    assert row["email"] == "mia@example.com" and row["online"] is True
    assert PASSWORD not in str(data) and "password" not in str(data).lower() and "plain:" not in str(data)
    me.last_seen_at = yipi.utcnow() - timedelta(hours=1)
    db.session.commit()
    assert next(p for p in lerox.get("/api/yipi/admin/overview").get_json()["people"] if p["handle"] == "mia")["online"] is False


def test_requests_reach_the_admins_who_can_mark_them_done(client):
    lerox, mia = person("lerox"), person("mia")
    assert mia.post("/api/yipi/requests", json={"kind": "survey", "text": "   "}).status_code == 400
    assert mia.post("/api/yipi/requests", json={"kind": "survey", "text": "Ich finde die Kamera gut"}).status_code == 201
    assert mia.post("/api/yipi/requests", json={"kind": "nonsense", "text": "Noch etwas"}).status_code == 201
    items = lerox.get("/api/yipi/admin/requests").get_json()["items"]
    assert [i["kind"] for i in items] == ["request", "survey"] and items[1]["handle"] == "mia" and items[1]["text"] == "Ich finde die Kamera gut"
    assert mia.post(f"/api/yipi/admin/requests/{items[0]['id']}").status_code == 403
    assert lerox.post(f"/api/yipi/admin/requests/{items[0]['id']}").status_code == 200
    assert len(lerox.get("/api/yipi/admin/requests").get_json()["items"]) == 1
    anonymous = flask_app.test_client()
    assert anonymous.post("/api/yipi/requests", json={"text": "Hallo"}).status_code == 401


def test_an_admin_can_delete_the_post_of_anybody(client):
    lerox, mia = person("lerox"), person("mia")
    post_id = mia.post("/api/yipi/posts", json={"text": "Ein Beitrag"}).get_json()["post"]["id"]
    assert person("tom").delete(f"/api/yipi/posts/{post_id}").status_code == 403
    assert lerox.delete(f"/api/yipi/posts/{post_id}").status_code == 200
    assert yipi.db.session.get(yipi.YipiPost, post_id) is None or yipi.db.session.get(yipi.YipiPost, post_id).deleted


def test_the_pages_show_the_cards_the_delete_entry_for_admins_and_the_form_for_the_team():
    pages, components, videos = read("static", "js", "yipi-pages.js"), read("static", "js", "yipi-components.js"), read("static", "js", "yipi-videos.js")
    for word in ("function peopleCard()", "function requestsCard()", 'Api.get("/admin/overview")', 'Api.get("/admin/requests")', "function teamSection()", 'Api.post("/requests"', 'peopleCard(), requestsCard(), storageCard()'):
        assert word in pages, word
    assert "mine || (Y.me && Y.me.isAdmin) ? { label: \"Beitrag löschen\"" in components and "mine || (Y.me && Y.me.isAdmin) ? { label: \"Beitrag löschen\"" in videos
    assert "Percy" not in read("yipi.py") + pages, "no password in the code"


def test_the_site_announces_the_message_to_the_team():
    import yipi_company
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    assert "2026-11-08-team" in lines and len(lines["2026-11-08-team"][2]) <= 280 and lines["2026-11-08-team"][2].count("#") <= 2
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)
