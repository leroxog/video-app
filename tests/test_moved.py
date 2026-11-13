"""Satürn, 2026-11-13: the old address on Railway only says that the site has moved and gives the new link (moved.py)."""
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)

import moved  # noqa: E402


def test_every_address_shows_the_notice_with_the_link_to_the_same_place_on_the_new_site():
    client = moved.app.test_client()
    page = client.get("/").get_data(as_text=True)
    assert "Wir sind umgezogen!" in page and "Das ist unser neuer Link" in page and 'href="https://thesaturnweb.duckdns.org/"' in page
    deep = client.get("/mia/status/12?x=1&y=2")
    assert deep.status_code == 200 and 'href="https://thesaturnweb.duckdns.org/mia/status/12?x=1&amp;y=2"' in deep.get_data(as_text=True)
    assert "no-store" in deep.headers["Cache-Control"] and "default-src 'none'" in deep.headers["Content-Security-Policy"]
    assert client.post("/api/yipi/login").status_code == 405


def test_the_address_cannot_be_used_to_inject_into_the_page():
    client = moved.app.test_client()
    page = client.get('/%22%3E%3Cscript%3Ealert(1)%3C/script%3E').get_data(as_text=True)
    assert "<script>alert" not in page


def test_railway_starts_this_small_page_and_the_own_server_does_not():
    assert "gunicorn moved:app" in open(os.path.join(ROOT, "Procfile"), encoding="utf-8").read()
    assert "gunicorn moved:app" in open(os.path.join(ROOT, "railpack.json"), encoding="utf-8").read()
    assert 'CMD ["gunicorn", "app:app"' in open(os.path.join(ROOT, "Dockerfile"), encoding="utf-8").read()
