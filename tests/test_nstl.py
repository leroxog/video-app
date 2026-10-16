"""NSTL: the home page since 2026-10-16.  No accounts.  You ask a question; the page (in your browser, not on this server) asks
Wikipedia and hands what it finds to a swarm of agents (static/js/nstl-swarm-core.js, tested in tests/nstl_swarm.test.js; the Wikipedia
side of things in static/js/nstl-core.js, tested in tests/nstl_core.test.js) that argue their way to an answer.  The files of the page
are checked in test_nstl_frontend.py; the chat that was the home page before it is tested in test_regal_chat.py."""
import os
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import nstl  # noqa: E402
import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


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


def test_the_home_page_is_nstl_and_a_visitor_gets_no_cookie(client):
    response = client.get("/")
    text = response.get_data(as_text=True)
    assert response.status_code == 200 and "Set-Cookie" not in response.headers
    assert 'data-worker="/static/js/nstl-swarm-worker.js?v=' in text
    assert 'rel="canonical" href="http://localhost/"' in text and "nstl-core.js" in text and "nstl.js" in text
    assert 'id="ask-form"' in text and 'id="question"' in text
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "worker-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert "connect-src 'self' https://de.wikipedia.org https://en.wikipedia.org" in csp


def test_the_worker_has_a_strict_policy_and_the_page_script_has_none(client):
    response = client.get("/static/js/nstl-swarm-worker.js")
    assert response.status_code == 200
    assert response.headers["Content-Security-Policy"] == "default-src 'none'; script-src 'self'"
    other = client.get("/static/js/nstl.js")
    assert "Content-Security-Policy" not in other.headers, "only the worker gets this policy"


def test_the_manifest_describes_nstl(client):
    data = client.get("/manifest.webmanifest").get_json()
    assert data["short_name"] == "NSTL" and data["start_url"] == "/" and data["display"] == "standalone"
    assert {icon["purpose"] for icon in data["icons"]} == {"any", "maskable"}
    for icon in data["icons"]:
        assert client.get(icon["src"]).status_code == 200, icon["src"]


def test_no_page_asks_for_a_password_or_an_account(client):
    """NSTL was explicitly asked for "ohne Anmeldung" (no sign-in)."""
    text = client.get("/").get_data(as_text=True)
    for word in ("password", "passwort", "login", "anmelden", "registrieren", "konto"):
        assert word not in text.lower()


# ------------------------------------------------------------------------------------------------- the concealed name
# The idea that became NSTL was given to this project under a longer name that must never appear anywhere in the repository, only the
# short form.  Built from pieces here (not as one literal string) so that this very check does not itself add the first occurrence.
_BANNED_WORDS = ["n" + "o", "scr" + "een", "t" + "ime", "lo" + "ck"]
_BANNED_PHRASE = " ".join(_BANNED_WORDS)
SKIP_DIRS = {".git", "__pycache__", "node_modules", os.path.join("static", "vendor"), "instance"}


def _tracked_files():
    out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=ROOT, capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        pytest.skip("not a git checkout here")
    for rel in out.stdout.splitlines():
        if any(rel.startswith(skip.replace(os.sep, "/") + "/") or rel.startswith(skip.replace(os.sep, "/")) for skip in (s.replace(os.sep, "/") for s in SKIP_DIRS)):
            continue
        yield rel


def test_the_concealed_name_appears_nowhere_in_the_repository():
    hits = []
    for rel in _tracked_files():
        path = os.path.join(ROOT, *rel.split("/"))
        if not os.path.isfile(path):
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                text = handle.read()
        except (UnicodeDecodeError, OSError):
            continue              # a binary or unreadable file cannot hold the phrase as readable text
        if _BANNED_PHRASE in text.lower().replace("-", " ").replace("_", " "):
            hits.append(rel)
    assert not hits, f"the concealed name appears in: {hits}"
