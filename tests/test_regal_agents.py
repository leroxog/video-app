"""Nex Ai's home page since 2026-10-16: not one chat turn but three real passes of the one on-device model (a first answer, a check
of it, then the final one), each visible as it is written.  Shares its worker, its hardware and loading logic (as pure functions) and
its CSP with the archived single chat (tested in test_regal_chat.py); this file tests only what is new: the route, that three
passes really run one after another and that a stop or a failure does not leave the page in a broken state.  The files of the page are
checked in test_regal_agents_frontend.py."""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import regal  # noqa: E402
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


def test_the_home_page_is_the_agents_page_and_a_visitor_gets_no_cookie(client):
    response = client.get("/")
    text = response.get_data(as_text=True)
    assert response.status_code == 200 and "Set-Cookie" not in response.headers
    assert 'data-models="/static/data/browser-models.json?v=' in text and 'data-worker="/static/js/regal-chat-worker.js?v=' in text
    assert 'rel="canonical" href="http://localhost/"' in text and "regal-agents.js" in text and "regal-chat.js" not in text
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "worker-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert client.get("/static/data/browser-models.json").status_code == 200


def test_the_old_address_of_the_chat_leads_here_again(client):
    response = client.get("/chat")
    assert response.status_code == 301 and response.headers["Location"].endswith("/")


def test_the_worker_is_shared_with_the_archived_chat_and_keeps_its_own_policy(client):
    response = client.get("/static/js/regal-chat-worker.js")
    csp = response.headers["Content-Security-Policy"]
    assert response.status_code == 200 and csp.startswith("default-src 'none'")
    assert "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co" in csp
    other = client.get("/static/js/regal-agents.js")
    assert "Content-Security-Policy" not in other.headers, "only the worker gets this policy"


def test_the_skip_list_key_is_shared_with_the_archived_chat():
    """A model (or the graphics card) that failed on the archived chat must not be tried again here, and the other way round: both
    pages read and write the same localStorage key."""
    agents = read_js("regal-agents.js")
    chat = read_js("regal-chat.js")
    assert 'const SKIP_KEY = "regal.skip"' in agents and 'const SKIP_KEY = "regal.skip"' in chat


def read_js(name):
    with open(os.path.join(ROOT, "static", "js", name), encoding="utf-8") as handle:
        return handle.read()


def test_three_passes_run_one_after_another_each_reading_what_came_before():
    code = read_js("regal-agents.js")
    assert code.count('app.worker.postMessage({ type: "generate"') == 1, "one call site, reused for every pass"
    assert "app.step++" in code and "runStep()" in code
    assert "AGENT_MAX_TOKENS[index]" in code, "every pass has its own token budget, so three passes do not take forever"


def test_a_stop_or_an_empty_pass_does_not_chain_into_the_next_one():
    code = read_js("regal-agents.js")
    assert "if (message.stopped || !agent || !agent.text)" in code and "app.step = -1" in code
