"""The notice for computers (2026-10-18): the page tells a visitor what the site sees of their own visit. The server part is one endpoint that answers
with the data of the request itself and keeps nothing; the table is made by the script from that and from what the browser tells about itself."""
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


def test_the_visitor_sees_the_data_of_their_own_request(client):
    reply = client.get("/api/yipi/visitor", headers={"X-Forwarded-For": "203.0.113.7, 10.0.0.2", "X-Forwarded-Proto": "https", "User-Agent": "TestBrowser/1.0",
                                                     "Accept-Language": "de-DE,de;q=0.9", "DNT": "1"})
    assert reply.status_code == 200
    visitor = reply.get_json()["visitor"]
    assert visitor["ip"] == "203.0.113.7" and visitor["via"] == "10.0.0.2" and visitor["forwardedFor"] == "203.0.113.7, 10.0.0.2"
    assert visitor["protocol"] == "https" and visitor["userAgent"] == "TestBrowser/1.0" and visitor["acceptLanguage"].startswith("de-DE") and visitor["doNotTrack"] == "1"
    assert visitor["time"].endswith("Z") or "T" in visitor["time"]


def test_without_a_proxy_the_address_is_the_one_of_the_connection(client):
    visitor = client.get("/api/yipi/visitor").get_json()["visitor"]
    assert visitor["ip"] and visitor["via"] == "" and visitor["forwardedFor"] == ""


def test_the_answer_is_never_cached_and_nothing_is_stored(client):
    reply = client.get("/api/yipi/visitor", headers={"X-Forwarded-For": "198.51.100.9"})
    assert reply.headers["Cache-Control"] == "no-store" and "Cookie" in reply.headers["Vary"]
    for table in db.metadata.tables.values():
        assert db.session.execute(table.select()).first() is None, f"{table.name}: a visit must not leave a row behind"


def test_long_headers_are_cut_and_the_endpoint_only_answers_get(client):
    visitor = client.get("/api/yipi/visitor", headers={"User-Agent": "x" * 5000, "Accept-Language": "y" * 5000}).get_json()["visitor"]
    assert len(visitor["userAgent"]) <= 400 and len(visitor["acceptLanguage"]) <= 200
    assert client.post("/api/yipi/visitor", json={}).status_code == 405


def test_the_page_for_computers_is_in_every_page_of_the_app(client):
    for path in ("/", "/explore", "/games", "/videos", "/messages"):
        html = client.get(path).get_data(as_text=True)
        assert 'id="desktopNotice"' in html and "Erneut Versuchen!" in html and 'id="dnData"' in html, path
        assert "Sie können vielleicht deswegen nicht auf unser Programm zugreifen" in html and "Sie können auf das Bild nicht zugreifen" in html, path
    assert "X-Forwarded-For" not in client.get("/", headers={"X-Forwarded-For": "203.0.113.7"}).get_data(as_text=True), "the address is fetched for the notice, never written into the page"
    assert "203.0.113.7" not in client.get("/", headers={"X-Forwarded-For": "203.0.113.7"}).get_data(as_text=True)
