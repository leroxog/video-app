"""Nex Ai's home page from 2026-10-16 evening until Pulse took "/" (2026-10-17), archived at /nex-agenten-archiv since: a question runs through five real, server-side AI passes (ai_assistant.py's Groq
call, not an on-device model any more -- the user explicitly asked for "ai's die nicht auf deinem pc laufen") -- four agents each
write their own answer, a fifth reads all four and writes the one the visitor sees, every word streamed to the page as it is written.
This file tests the route (/api/agents/ask): who may call it, what it sends to Groq for each role, and that it keeps no history. The
older on-device chat (still real AI, just running in the visitor's own browser) is archived and unchanged at /nex-ai-archiv, tested in
test_regal_chat.py; the files of the page are checked in test_regal_agents_frontend.py."""
import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import ai_assistant  # noqa: E402
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
    regal._agents_hits.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


def _mock_groq(monkeypatch, reply="Hallo!", *, capture=None):
    """Replaces the real Groq call with a fake one that yields `reply` in two chunks and, if `capture` is a list, appends
    (system_prompt, message) for every call made -- so a test can see exactly what regal.py sent."""
    def fake(system_prompt, message, max_tokens=600, temperature=0.7):
        if capture is not None:
            capture.append((system_prompt, message))
        if reply:
            yield reply[: len(reply) // 2]
            yield reply[len(reply) // 2:]
    monkeypatch.setattr(ai_assistant, "generate_custom_stream", fake)


def _post(client, **body):
    return client.post("/api/agents/ask", json=body)


def test_the_archived_page_is_the_agents_page_and_a_visitor_gets_no_cookie(client):
    response = client.get("/nex-agenten-archiv")
    text = response.get_data(as_text=True)
    assert response.status_code == 200 and "Set-Cookie" not in response.headers
    assert 'rel="canonical" href="http://localhost/nex-agenten-archiv"' in text and "regal-agents.js" in text and "regal-chat.js" not in text
    assert "data-worker" not in text and "data-models" not in text, "the home page downloads nothing any more"
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "connect-src 'self';" in csp and "frame-ancestors 'none'" in csp


def test_the_old_address_of_the_chat_leads_to_nex_inside_pulse(client):
    response = client.get("/chat")
    assert response.status_code == 301 and response.headers["Location"].endswith("/i/nex")


def test_one_agent_turn_streams_what_groq_wrote(client, monkeypatch):
    _mock_groq(monkeypatch, "Die Hauptstadt ist Berlin.")
    response = _post(client, role="direkt", message="Was ist die Hauptstadt von Deutschland?")
    assert response.status_code == 200 and response.mimetype == "text/plain"
    assert response.get_data(as_text=True) == "Die Hauptstadt ist Berlin."
    assert "Set-Cookie" not in response.headers


def test_an_unknown_role_or_an_empty_question_is_refused(client, monkeypatch):
    _mock_groq(monkeypatch)
    assert _post(client, role="not-a-role", message="Hallo").status_code == 400
    assert _post(client, role="direkt", message="   ").status_code == 400
    assert _post(client, role="direkt").status_code == 400


def test_each_of_the_four_independent_agents_gets_its_own_system_prompt_and_only_the_question(client, monkeypatch):
    seen = []
    _mock_groq(monkeypatch, capture=seen)
    for role in regal.AGENT_ORDER:
        _post(client, role=role, message="Wie funktioniert ein Kühlschrank?")
    assert len(seen) == len(regal.AGENT_ORDER)
    prompts = {system for system, _ in seen}
    assert len(prompts) == len(regal.AGENT_ORDER), "every one of the four has its own, different instruction"
    for system, message in seen:
        assert message == "Frage: Wie funktioniert ein Kühlschrank?"


def test_the_final_agent_reads_the_question_and_all_four_other_answers(client, monkeypatch):
    seen = []
    _mock_groq(monkeypatch, capture=seen)
    agents = {"direkt": "Kurze Antwort.", "gruendlich": "Lange Antwort.", "kritisch": "Vorsicht, das stimmt nicht ganz.", "praktisch": "Mach einfach X."}
    _post(client, role="final", message="Wie funktioniert ein Kühlschrank?", agents=agents)
    assert len(seen) == 1
    system, message = seen[0]
    assert system == regal.AGENT_ROLES["final"]
    assert "Frage: Wie funktioniert ein Kühlschrank?" in message
    for key, text in agents.items():
        assert f"{key}: {text}" in message


# -------------------------------------------------------------------------------- the agents' own notation ("alles besser machen")
def test_the_four_independent_agents_are_told_to_write_in_the_shared_notation():
    for role in regal.AGENT_ORDER:
        assert regal.AGENT_NOTATION in regal.AGENT_ROLES[role], role


def test_the_final_agent_is_not_told_to_write_in_the_notation_but_to_decode_it_into_plain_language():
    final = regal.AGENT_ROLES["final"]
    assert regal.AGENT_NOTATION not in final
    assert "normaler" in final.lower() or "normale" in final.lower()
    assert "keine Symbole" in final


def test_the_notation_is_the_same_for_every_agent_so_they_can_actually_read_each_other(client, monkeypatch):
    """The whole point of a *shared* notation is that it is the one and only definition -- not each agent improvising its own
    private shorthand, which the next, independent call could not reliably parse."""
    seen = []
    _mock_groq(monkeypatch, capture=seen)
    for role in regal.AGENT_ORDER:
        _post(client, role=role, message="Testfrage")
    systems = [system for system, _ in seen]
    assert len(systems) == len(regal.AGENT_ORDER)
    for system in systems:
        assert regal.AGENT_NOTATION in system, "every agent gets the identical, verbatim notation definition -- not its own invention"


def test_a_visitor_who_asks_too_often_is_rate_limited(client, monkeypatch):
    _mock_groq(monkeypatch)
    limit = regal.AGENT_LIMITS["agents-ip"][0]
    for _ in range(limit):
        assert _post(client, role="direkt", message="Hallo").status_code == 200
    assert _post(client, role="direkt", message="Hallo").status_code == 429


def test_a_request_from_another_site_is_refused(client, monkeypatch):
    _mock_groq(monkeypatch)
    response = client.post("/api/agents/ask", data=json.dumps({"role": "direkt", "message": "Hallo"}),
                            content_type="application/json", headers={"Origin": "https://not-this-site.example"})
    assert response.status_code == 403


def test_nothing_is_written_to_the_database(client, monkeypatch):
    """No account, no server-side history: a question here must leave the database exactly as it found it. (Earlier chats are kept
    only in the visitor's own browser -- see test_regal_agents_frontend.py for that part.)"""
    from models import AiChat, AiChatMessage
    _mock_groq(monkeypatch, "Antwort.")
    _post(client, role="direkt", message="Frage?")
    with flask_app.app_context():
        assert AiChat.query.count() == 0 and AiChatMessage.query.count() == 0


def test_a_failed_groq_call_ends_the_stream_instead_of_leaking_an_error(client, monkeypatch):
    def boom(system_prompt, message, max_tokens=600, temperature=0.7):
        raise RuntimeError("Groq ist down")
        yield  # pragma: no cover - makes this a generator
    monkeypatch.setattr(ai_assistant, "generate_custom_stream", boom)
    response = _post(client, role="direkt", message="Hallo")
    assert response.status_code == 200 and response.get_data(as_text=True) == ""


# -------------------------------------------------------------------------------------------- /api/agents/title (chat history)
def _title(client, **body):
    return client.post("/api/agents/title", json=body)


def test_a_chat_gets_a_short_title_from_its_own_question_and_answer(client, monkeypatch):
    monkeypatch.setattr(ai_assistant, "generate_chat_title", lambda history: "Kühlschrank Funktionsweise")
    response = _title(client, messages=[{"role": "user", "content": "Wie funktioniert ein Kühlschrank?"}, {"role": "assistant", "content": "..."}])
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True and data["title"] == "Kühlschrank Funktionsweise"
    assert "Set-Cookie" not in response.headers


def test_the_title_call_reuses_the_exact_function_the_sites_other_chat_already_uses(client, monkeypatch):
    seen = []
    monkeypatch.setattr(ai_assistant, "generate_chat_title", lambda history: (seen.append(history), "Titel")[1])
    _title(client, messages=[{"role": "user", "content": "Frage"}, {"role": "assistant", "content": "Antwort"}, {"role": "user", "content": "Noch eine"}, {"role": "assistant", "content": "Zweite Antwort"}])
    assert seen == [[{"role": "user", "content": "Frage"}, {"role": "assistant", "content": "Antwort"}, {"role": "user", "content": "Noch eine"}, {"role": "assistant", "content": "Zweite Antwort"}]]


def test_an_empty_or_malformed_messages_list_is_refused(client, monkeypatch):
    monkeypatch.setattr(ai_assistant, "generate_chat_title", lambda history: "Titel")
    assert _title(client, messages=[]).status_code == 400
    assert _title(client).status_code == 400
    assert _title(client, messages=[{"role": "system", "content": "nope"}]).status_code == 400
    assert _title(client, messages="not a list").status_code == 400


def test_the_title_endpoint_shares_the_same_rate_limit_and_origin_check(client, monkeypatch):
    monkeypatch.setattr(ai_assistant, "generate_chat_title", lambda history: "Titel")
    refused = client.post("/api/agents/title", data=json.dumps({"messages": [{"role": "user", "content": "Hi"}]}),
                           content_type="application/json", headers={"Origin": "https://not-this-site.example"})
    assert refused.status_code == 403
    limit = regal.AGENT_LIMITS["agents-ip"][0]
    for _ in range(limit):
        assert _title(client, messages=[{"role": "user", "content": "Hi"}]).status_code == 200
    assert _title(client, messages=[{"role": "user", "content": "Hi"}]).status_code == 429


def test_a_failed_title_call_comes_back_as_an_empty_title_not_an_error(client, monkeypatch):
    def boom(history):
        raise RuntimeError("Groq ist down")
    monkeypatch.setattr(ai_assistant, "generate_chat_title", boom)
    response = _title(client, messages=[{"role": "user", "content": "Hi"}])
    assert response.status_code == 200 and response.get_json() == {"ok": True, "title": ""}
