import os
import sys
import io
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

from datetime import date

import pytest
import app as app_module
import mc_hosting
import search_engine
from app import app as flask_app, db
from models import User, AiChat, AiChatMessage, Team, TeamMember, TeamMessage, UserIntegration, NrsHistoryEntry, YlibItem, PlMedia
from models import McHost, McHostInvite, McServer

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "host_agent")))
import nrs_host_agent as agent_mod


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app_module._ai_rate_hits.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


@pytest.fixture(autouse=True)
def _no_real_title_generation(monkeypatch):
    """generate_chat_title is a real Groq call, separate from
    generate_reply_stream -- mocked to a no-op by default so no test
    accidentally hits the network; tests that care about the actual
    title-update behavior monkeypatch it again to a real value, which
    simply overrides this default within that same test."""
    monkeypatch.setattr(app_module.ai_assistant, "generate_chat_title", lambda history: "")
    monkeypatch.setattr(app_module.ai_assistant, "generate_next_suggestion", lambda history: "")


def signup(client, username="alice", password="secret1"):
    return client.post("/signup", data={"username": username, "password": password, "password2": password})


def make_user(client, username):
    """Second/other account, then log the fixture's main client back in as alice."""
    other = flask_app.test_client()
    other.post("/signup", data={"username": username, "password": "secret1", "password2": "secret1"})
    return other


# ---------------- auth ----------------

def test_root_redirects_to_login_when_logged_out(client):
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers["Location"]


def test_nex_archived_redirects_to_login_when_logged_out(client):
    r = client.get("/nex-archiv", follow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers["Location"]


def test_signup_then_land_on_the_server_panel(client):
    r = signup(client, "alice")
    assert r.status_code in (302, 303)
    home = client.get("/")
    assert home.status_code == 200
    assert b"svList" in home.data


def test_ylib_archived_redirects_to_login_when_logged_out(client):
    r = client.get("/ylib-archiv", follow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers["Location"]


def test_ychat_archived_redirects_to_login_when_logged_out(client):
    r = client.get("/ychat-archiv", follow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers["Location"]


def test_signup_rejects_bad_username_and_short_password(client):
    assert client.post("/signup", data={"username": "a b", "password": "secret1", "password2": "secret1"}).status_code == 400
    assert client.post("/signup", data={"username": "bob", "password": "abc", "password2": "abc"}).status_code == 400


def test_signup_rejects_duplicate_username(client):
    signup(client, "alice")
    other = flask_app.test_client()
    assert other.post("/signup", data={"username": "ALICE", "password": "secret1", "password2": "secret1"}).status_code == 400


def test_login_wrong_password(client):
    signup(client, "alice")
    client.get("/logout")
    assert client.post("/login", data={"username": "alice", "password": "nope"}).status_code == 401


def test_login_success(client):
    signup(client, "alice")
    client.get("/logout")
    r = client.post("/login", data={"username": "alice", "password": "secret1"}, follow_redirects=False)
    assert r.status_code == 302 and client.get("/").status_code == 200


def test_api_returns_401_json_when_logged_out(client):
    r = client.post("/api/ai/chats/1/stream", json={"message": "hi"})
    assert r.status_code == 401 and r.get_json()["error"] == "not_logged_in"


# ---------------- onboarding wizard (pinklemon-auth.js) ----------------

def test_check_username_available_and_taken(client):
    signup(client, "alice")
    client.get("/logout")
    assert client.post("/api/pl/register/check-username", json={"username": "brandnew"}).get_json()["available"] is True
    assert client.post("/api/pl/register/check-username", json={"username": "ALICE"}).get_json()["available"] is False
    assert client.post("/api/pl/register/check-username", json={"username": "a b"}).get_json()["available"] is False


def test_register_complete_creates_full_account_and_logs_in(client):
    r = client.post("/api/pl/register/complete", data={
        "username": "newkid", "password": "secret123", "password2": "secret123",
        "birth_day": "14", "birth_month": "6", "birth_year": "2001",
        "gender": "weiblich", "email": "newkid@example.com", "display_name": "New Kid",
    })
    assert r.get_json()["ok"] is True
    # logged in immediately -- no separate /login needed
    home = client.get("/")
    assert home.status_code == 200
    with flask_app.app_context():
        u = User.query.filter_by(username="newkid").first()
        assert u is not None and u.gender == "weiblich" and u.email == "newkid@example.com"
        assert u.pl_display_name == "New Kid" and u.birthdate.isoformat() == "2001-06-14"


def test_register_complete_rejects_mismatched_password(client):
    r = client.post("/api/pl/register/complete", data={
        "username": "mismatch", "password": "secret123", "password2": "different",
    })
    assert r.status_code == 400 and r.get_json()["error"] == "password_mismatch"


def test_register_complete_rejects_taken_username(client):
    signup(client, "alice")
    client.get("/logout")
    r = client.post("/api/pl/register/complete", data={
        "username": "alice", "password": "secret123", "password2": "secret123",
    })
    assert r.status_code == 409 and r.get_json()["error"] == "username_taken"


def test_register_complete_future_birthdate_ignored(client):
    r = client.post("/api/pl/register/complete", data={
        "username": "futurekid", "password": "secret123", "password2": "secret123",
        "birth_day": "1", "birth_month": "1", "birth_year": "2099",
    })
    assert r.get_json()["ok"] is True
    with flask_app.app_context():
        assert User.query.filter_by(username="futurekid").first().birthdate is None


def test_register_complete_with_avatar_upload(client):
    r = client.post("/api/pl/register/complete", data={
        "username": "pictured", "password": "secret123", "password2": "secret123",
        "avatar": (io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 200), "pic.png"),
    }, content_type="multipart/form-data")
    assert r.get_json()["ok"] is True
    with flask_app.app_context():
        u = User.query.filter_by(username="pictured").first()
        assert u.pl_avatar_image is not None


def test_api_login_success_and_failure(client):
    signup(client, "alice")
    client.get("/logout")
    bad = client.post("/api/pl/login", json={"username": "alice", "password": "nope"})
    assert bad.status_code == 401 and bad.get_json()["error"] == "invalid_credentials"
    good = client.post("/api/pl/login", json={"username": "alice", "password": "secret1"})
    assert good.get_json()["ok"] is True
    assert client.get("/").status_code == 200


# ---------------- own profile edit ----------------

def test_update_profile_display_name_and_avatar(client):
    signup(client, "alice")
    r = client.post("/api/pl/profile", data={
        "display_name": "Alicia",
        "avatar": (io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 200), "pic.png"),
    }, content_type="multipart/form-data")
    j = r.get_json()
    assert j["ok"] is True and j["display_name"] == "Alicia" and j["avatar_url"]
    with flask_app.app_context():
        u = User.query.filter_by(username="alice").first()
        assert u.pl_display_name == "Alicia" and u.pl_avatar_image is not None


def test_update_profile_rejects_bad_avatar_type(client):
    signup(client, "alice")
    r = client.post("/api/pl/profile", data={
        "avatar": (io.BytesIO(b"not an image"), "pic.exe"),
    }, content_type="multipart/form-data")
    assert r.status_code == 400 and r.get_json()["error"] == "bad_type"


# ---------------- avatar colors ----------------

def test_avatar_color_is_stable_and_in_palette(client):
    assert app_module.pl_avatar_color("alice") == app_module.pl_avatar_color("alice")
    assert app_module.pl_avatar_color("alice") in app_module.PL_AVATAR_PALETTE
    # case-insensitive, so "Alice" and "alice" always match visually elsewhere too
    assert app_module.pl_avatar_color("Alice") == app_module.pl_avatar_color("alice")


# ---------------- google login ----------------

class _FakeGoogleResp:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception("http error")

    def json(self):
        return self._data


def _mock_google(monkeypatch, userinfo):
    monkeypatch.setattr(app_module, "GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(app_module, "GOOGLE_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setattr(app_module.requests, "post", lambda *a, **k: _FakeGoogleResp({"access_token": "tok123"}))
    monkeypatch.setattr(app_module.requests, "get", lambda *a, **k: _FakeGoogleResp(userinfo))


def _start_google_flow(client):
    r = client.get("/auth/google", follow_redirects=False)
    assert r.status_code == 302 and "accounts.google.com" in r.headers["Location"]
    with client.session_transaction() as sess:
        return sess["google_oauth_state"]


def test_google_auth_start_without_config_redirects_with_error(client):
    r = client.get("/auth/google", follow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers["Location"] and "g_error=not_configured" in r.headers["Location"]


def test_google_auth_start_redirects_to_google_when_configured(client, monkeypatch):
    monkeypatch.setattr(app_module, "GOOGLE_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(app_module, "GOOGLE_CLIENT_SECRET", "test-client-secret")
    state = _start_google_flow(client)
    assert state


def test_google_auth_callback_creates_new_user(client, monkeypatch):
    _mock_google(monkeypatch, {
        "sub": "google-sub-1", "email": "newperson@example.com",
        "email_verified": True, "name": "New Person",
    })
    state = _start_google_flow(client)
    r = client.get(f"/auth/google/callback?state={state}&code=abc", follow_redirects=False)
    assert r.status_code == 302 and r.headers["Location"].endswith("/")
    with flask_app.app_context():
        user = User.query.filter_by(google_sub="google-sub-1").first()
        assert user is not None and user.email == "newperson@example.com"
    assert client.get("/").status_code == 200


def test_google_auth_callback_logs_in_returning_user(client, monkeypatch):
    _mock_google(monkeypatch, {"sub": "google-sub-2", "email": "x@example.com", "email_verified": True})
    state = _start_google_flow(client)
    client.get(f"/auth/google/callback?state={state}&code=abc")
    client.get("/logout")

    state2 = _start_google_flow(client)
    client.get(f"/auth/google/callback?state={state2}&code=abc")
    assert client.get("/").status_code == 200
    with flask_app.app_context():
        assert User.query.filter_by(google_sub="google-sub-2").count() == 1


def test_google_auth_callback_links_existing_password_account_by_email(client, monkeypatch):
    signup(client, "bob")
    with flask_app.app_context():
        u = User.query.filter_by(username="bob").first()
        u.email = "bob@example.com"
        db.session.commit()
    client.get("/logout")

    _mock_google(monkeypatch, {"sub": "google-sub-3", "email": "bob@example.com", "email_verified": True})
    state = _start_google_flow(client)
    client.get(f"/auth/google/callback?state={state}&code=abc")

    with flask_app.app_context():
        assert User.query.count() == 1
        assert User.query.filter_by(username="bob").first().google_sub == "google-sub-3"


def test_google_auth_callback_rejects_bad_state(client, monkeypatch):
    _mock_google(monkeypatch, {"sub": "google-sub-4", "email": "y@example.com", "email_verified": True})
    _start_google_flow(client)
    r = client.get("/auth/google/callback?state=wrong&code=abc", follow_redirects=False)
    assert r.status_code == 302 and "g_error=state_mismatch" in r.headers["Location"]
    assert client.get("/", follow_redirects=False).status_code == 302


# ---------------- Nex AI chat ----------------

def _mock_stream(monkeypatch, chunks):
    """chunks: a list of text pieces the fake Groq stream yields one at a
    time, or a callable(message, history) -> iterable for tests that need
    to inspect what was sent."""
    if callable(chunks):
        monkeypatch.setattr(app_module.ai_assistant, "generate_reply_stream", chunks)
    else:
        monkeypatch.setattr(
            app_module.ai_assistant, "generate_reply_stream",
            lambda message, history=None, persona=None: iter(chunks),
        )


def _chat_id(client):
    """Create a chat via the API (mirrors what the frontend does lazily on
    first send) and return its id."""
    return client.post("/api/ai/chats").get_json()["chat"]["id"]


def test_root_serves_the_server_panel_not_the_archived_pages(client):
    """The home page cycled Nex, browser, ychat, ylib, the browser again and is now NRS
    Server (2026-10-03). The browser, ylib, ychat and Nex UIs still fully work at
    /browser-archiv, /ylib-archiv, /ychat-archiv and /nex-archiv, unlinked from anywhere."""
    signup(client, "alice")
    home = client.get("/")
    assert home.status_code == 200
    assert (
        b"svList" in home.data
        and b"nrsAddress" not in home.data
        and b"ylGrid" not in home.data
        and b"ycFeed" not in home.data
        and b"nxMsgs" not in home.data
    )


def test_browser_archived_still_serves_the_browser(client):
    signup(client, "alice")
    home = client.get("/browser-archiv")
    assert home.status_code == 200
    assert b"nrsAddress" in home.data


def test_ylib_archived_still_serves_the_library(client):
    signup(client, "alice")
    home = client.get("/ylib-archiv")
    assert home.status_code == 200
    assert b"ylGrid" in home.data


def test_ychat_archived_still_serves_ychat(client):
    signup(client, "alice")
    home = client.get("/ychat-archiv")
    assert home.status_code == 200
    assert b"ycFeed" in home.data


def test_nex_archived_still_reachable_and_shows_empty_state(client):
    signup(client, "alice")
    home = client.get("/nex-archiv")
    assert home.status_code == 200
    assert b"nxMsgs" in home.data and b"nxEmpty" in home.data
    with flask_app.app_context():
        assert AiChat.query.filter_by(user_id=User.query.filter_by(username="alice").first().id).count() == 0


def test_nex_archived_shows_version_picker(client):
    signup(client, "alice")
    home = client.get("/nex-archiv")
    assert "NexAi 0.1 (Beta)".encode() in home.data
    assert "Neo AI".encode() in home.data


def test_nex_archived_shows_most_recently_active_chat_by_default(client, monkeypatch):
    signup(client, "alice")
    _chat_id(client)
    cid2 = _chat_id(client)
    _mock_stream(monkeypatch, ["hi"])
    client.post(f"/api/ai/chats/{cid2}/stream", json={"message": "hallo"})
    home = client.get("/nex-archiv")
    assert f"window.NEX_CHAT_ID = {cid2};".encode() in home.data


def test_nex_archived_honors_chat_query_param(client):
    signup(client, "alice")
    cid1 = _chat_id(client)
    _chat_id(client)
    home = client.get(f"/nex-archiv?chat={cid1}")
    assert f"window.NEX_CHAT_ID = {cid1};".encode() in home.data


def test_stream_requires_login(client):
    r = client.post("/api/ai/chats/1/stream", json={"message": "hi"})
    assert r.status_code == 401


def test_stream_rejects_empty(client):
    signup(client, "alice")
    cid = _chat_id(client)
    r = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "   "})
    assert r.status_code == 400 and r.get_json()["error"] == "empty"


def test_stream_rejects_a_chat_that_is_not_yours(client):
    signup(client, "alice")
    cid = _chat_id(client)
    bob = make_user(client, "bob")
    r = bob.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"})
    assert r.status_code == 404


def test_stream_rate_limits_after_too_many_messages(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    _mock_stream(monkeypatch, ["ok"])
    for _ in range(app_module.AI_RATE_LIMIT_MAX):
        r = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"})
        assert r.status_code == 200
        r.get_data()  # fully drain+close the streamed response before the next request
    over = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"})
    assert over.status_code == 429 and over.get_json()["error"] == "rate_limited"


def test_stream_rate_limit_is_per_user(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    bob = make_user(client, "bob")
    cid_bob = bob.post("/api/ai/chats").get_json()["chat"]["id"]
    _mock_stream(monkeypatch, ["ok"])
    for _ in range(app_module.AI_RATE_LIMIT_MAX):
        client.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"}).get_data()
    # alice is now rate-limited, but bob's own quota is untouched
    r = bob.post(f"/api/ai/chats/{cid_bob}/stream", json={"message": "hi"})
    assert r.status_code == 200


def test_stream_returns_chunks_and_persists_both_messages(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    _mock_stream(monkeypatch, ["Hallo ", "zurück!"])
    r = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "Hallo Nex"})
    assert r.get_data(as_text=True) == "Hallo zurück!"
    with flask_app.app_context():
        msgs = AiChatMessage.query.filter_by(chat_id=cid).order_by(AiChatMessage.created_at).all()
        assert [(m.role, m.content) for m in msgs] == [("user", "Hallo Nex"), ("assistant", "Hallo zurück!")]
        chat = db.session.get(AiChat, cid)
        assert chat.title == "Hallo Nex"


def test_generate_chat_title_uses_a_large_enough_token_budget(monkeypatch):
    # Found via live debugging: GROQ_FALLBACK_MODEL is a reasoning model
    # that spends ~150-180 tokens of hidden "reasoning" before emitting
    # the actual short title -- a small max_tokens budget (tuned for a
    # plain non-reasoning model) left no room for the real answer and
    # silently came back empty every time. Guard against regressing back
    # to a too-small budget.
    monkeypatch.undo()  # this test targets the real generate_chat_title, not the autouse no-op mock
    seen = {}

    def fake_generate_groq(messages, max_tokens, temperature=0.7):
        seen["max_tokens"] = max_tokens
        return "Ein Titel"

    monkeypatch.setattr(app_module.ai_assistant, "_generate_groq", fake_generate_groq)
    title = app_module.ai_assistant.generate_chat_title(
        [{"role": "user", "content": "Hallo"}, {"role": "assistant", "content": "Hi!"}]
    )
    assert title == "Ein Titel"
    assert seen["max_tokens"] >= 200


def test_stream_regenerates_title_from_the_whole_conversation_every_turn(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    seen_histories = []

    def fake_title(history):
        seen_histories.append(history)
        return "Titel " + str(len(seen_histories))

    monkeypatch.setattr(app_module.ai_assistant, "generate_chat_title", fake_title)
    _mock_stream(monkeypatch, ["erste Antwort"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "erste Frage"})
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).title == "Titel 1"

    _mock_stream(monkeypatch, ["zweite Antwort"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "zweite Frage"})
    with flask_app.app_context():
        # regenerated again on the second turn, not left at "Titel 1"
        assert db.session.get(AiChat, cid).title == "Titel 2"

    # the second call's history includes the first full exchange too
    assert seen_histories[1] == [
        {"role": "user", "content": "erste Frage"},
        {"role": "assistant", "content": "erste Antwort"},
        {"role": "user", "content": "zweite Frage"},
        {"role": "assistant", "content": "zweite Antwort"},
    ]


def test_stream_falls_back_to_truncated_title_if_generation_fails_on_first_message(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    _mock_stream(monkeypatch, ["Hallo zurück!"])
    # the autouse fixture already mocks generate_chat_title to return ""
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "Hallo Nex"})
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).title == "Hallo Nex"


def test_generate_next_suggestion_uses_a_large_enough_token_budget(monkeypatch):
    # Same reasoning-model token-starvation risk as generate_chat_title --
    # this call shares the same generous budget for the same reason.
    monkeypatch.undo()  # this test targets the real generate_next_suggestion, not the autouse no-op mock
    seen = {}

    def fake_generate_groq(messages, max_tokens, temperature=0.7):
        seen["max_tokens"] = max_tokens
        return "Wie mache ich das noch besser?"

    monkeypatch.setattr(app_module.ai_assistant, "_generate_groq", fake_generate_groq)
    suggestion = app_module.ai_assistant.generate_next_suggestion(
        [{"role": "user", "content": "Hallo"}, {"role": "assistant", "content": "Hi!"}]
    )
    assert suggestion == "Wie mache ich das noch besser?"
    assert seen["max_tokens"] >= 200


def test_generate_next_suggestion_returns_empty_string_for_empty_history():
    assert app_module.ai_assistant.generate_next_suggestion([]) == ""


def test_stream_regenerates_suggestion_from_the_whole_conversation_every_turn(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    seen_histories = []

    def fake_suggestion(history):
        seen_histories.append(history)
        return "Vorschlag " + str(len(seen_histories))

    monkeypatch.setattr(app_module.ai_assistant, "generate_next_suggestion", fake_suggestion)
    _mock_stream(monkeypatch, ["erste Antwort"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "erste Frage"})
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).next_suggestion == "Vorschlag 1"

    _mock_stream(monkeypatch, ["zweite Antwort"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "zweite Frage"})
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).next_suggestion == "Vorschlag 2"


def test_stream_keeps_previous_suggestion_if_generation_fails(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    with flask_app.app_context():
        chat = db.session.get(AiChat, cid)
        chat.next_suggestion = "Alter Vorschlag"
        db.session.commit()
    _mock_stream(monkeypatch, ["Hallo zurück!"])
    # the autouse fixture already mocks generate_next_suggestion to return ""
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "Hallo Nex"})
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).next_suggestion == "Alter Vorschlag"


def test_chat_messages_endpoint_returns_next_suggestion(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    with flask_app.app_context():
        chat = db.session.get(AiChat, cid)
        chat.next_suggestion = "Erzähl mir mehr"
        db.session.commit()
    resp = client.get(f"/api/ai/chats/{cid}/messages")
    assert resp.get_json()["chat"]["next_suggestion"] == "Erzähl mir mehr"


# ---------------- Teams ----------------

def test_create_team_adds_creator_as_member(client):
    signup(client, "alice")
    r = client.post("/api/teams", json={"name": "Projekt X"})
    j = r.get_json()
    assert j["ok"] and j["team"]["name"] == "Projekt X" and j["team"]["member_count"] == 1
    assert len(j["team"]["invite_code"]) > 0


def test_create_team_rejects_empty_name(client):
    signup(client, "alice")
    assert client.post("/api/teams", json={"name": "  "}).status_code == 400


def test_join_team_via_invite_code(client):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]

    bob = make_user(client, "bob")
    r = bob.post("/api/teams/join", json={"invite_code": team["invite_code"]})
    j = r.get_json()
    assert j["ok"] and j["team"]["id"] == team["id"] and j["team"]["member_count"] == 2


def test_join_team_rejects_invalid_code(client):
    signup(client, "alice")
    r = client.post("/api/teams/join", json={"invite_code": "does-not-exist"})
    assert r.status_code == 404 and r.get_json()["error"] == "not_found"


def test_list_teams_only_shows_teams_user_belongs_to(client):
    signup(client, "alice")
    client.post("/api/teams", json={"name": "Alices Team"})

    bob = make_user(client, "bob")
    bob.post("/api/teams", json={"name": "Bobs Team"})

    names = [t["name"] for t in client.get("/api/teams").get_json()["teams"]]
    assert names == ["Alices Team"]


def test_team_message_without_mention_does_not_trigger_nex(client, monkeypatch):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]
    called = []
    monkeypatch.setattr(app_module.ai_assistant, "generate_reply", lambda *a, **k: called.append(1) or "sollte nie laufen")

    r = client.post(f"/api/teams/{team['id']}/messages", json={"message": "Hallo zusammen"})
    j = r.get_json()
    assert j["ok"] and len(j["messages"]) == 1 and j["messages"][0]["content"] == "Hallo zusammen"
    assert not called


def test_team_message_with_nex_mention_triggers_ai_reply(client, monkeypatch):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]
    monkeypatch.setattr(app_module.ai_assistant, "generate_reply", lambda message, history=None, persona=None: "Klar, hier ist ein Vorschlag.")

    r = client.post(f"/api/teams/{team['id']}/messages", json={"message": "@nex was meinst du?"})
    j = r.get_json()
    assert j["ok"] and len(j["messages"]) == 2
    assert j["messages"][0]["role"] == "user" and j["messages"][0]["is_me"] is True
    assert j["messages"][1]["role"] == "assistant" and j["messages"][1]["content"] == "Klar, hier ist ein Vorschlag."
    assert j["messages"][1]["author"] is None

    with flask_app.app_context():
        stored = TeamMessage.query.filter_by(team_id=team["id"]).all()
        assert [m.role for m in stored] == ["user", "assistant"]
        assert stored[1].user_id is None


def test_team_messages_poll_returns_only_messages_after_given_id(client):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]
    client.post(f"/api/teams/{team['id']}/messages", json={"message": "eins"})
    second = client.post(f"/api/teams/{team['id']}/messages", json={"message": "zwei"}).get_json()["messages"][0]

    r = client.get(f"/api/teams/{team['id']}/messages?after={second['id'] - 1}")
    contents = [m["content"] for m in r.get_json()["messages"]]
    assert contents == ["zwei"]


def test_typing_shows_up_for_other_members_but_not_yourself(client):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]
    bob = make_user(client, "bob")
    bob.post("/api/teams/join", json={"invite_code": team["invite_code"]})

    bob.post(f"/api/teams/{team['id']}/typing")
    alice_view = client.get(f"/api/teams/{team['id']}/messages").get_json()
    assert alice_view["typing"] == ["bob"]

    client.post(f"/api/teams/{team['id']}/typing")
    bob_view = bob.get(f"/api/teams/{team['id']}/messages").get_json()
    assert bob_view["typing"] == ["alice"]
    assert "bob" not in bob_view["typing"]


def test_typing_expires_after_the_window(client, monkeypatch):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]
    bob = make_user(client, "bob")
    bob.post("/api/teams/join", json={"invite_code": team["invite_code"]})
    bob.post(f"/api/teams/{team['id']}/typing")

    monkeypatch.setattr(app_module, "_TYPING_WINDOW_SECONDS", -1)
    j = client.get(f"/api/teams/{team['id']}/messages").get_json()
    assert j["typing"] == []


def test_sending_a_message_clears_typing_status(client):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]
    bob = make_user(client, "bob")
    bob.post("/api/teams/join", json={"invite_code": team["invite_code"]})
    bob.post(f"/api/teams/{team['id']}/typing")
    bob.post(f"/api/teams/{team['id']}/messages", json={"message": "fertig gedacht"})

    j = client.get(f"/api/teams/{team['id']}/messages").get_json()
    assert j["typing"] == []


def test_non_member_cannot_view_or_post_team_messages(client):
    signup(client, "alice")
    team = client.post("/api/teams", json={"name": "Projekt X"}).get_json()["team"]

    bob = make_user(client, "bob")
    assert bob.get(f"/api/teams/{team['id']}/messages").status_code == 404
    assert bob.post(f"/api/teams/{team['id']}/messages", json={"message": "hi"}).status_code == 404


# ---------------- Plugins ----------------

def test_plugins_google_connect_bounces_when_not_configured(client):
    signup(client, "alice")
    r = client.get("/plugins/google/connect", follow_redirects=False)
    assert r.status_code == 302
    assert "plugin_error=not_configured" in r.headers["Location"]


def test_list_plugins_default_state(client):
    signup(client, "alice")
    r = client.get("/api/plugins")
    google = next(p for p in r.get_json()["plugins"] if p["service"] == "google")
    assert google["connected"] is False


def test_list_plugins_shows_connected_once_a_token_row_exists(client):
    signup(client, "alice")
    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        db.session.add(UserIntegration(user_id=user.id, service="google", access_token="tok"))
        db.session.commit()
    r = client.get("/api/plugins")
    google = next(p for p in r.get_json()["plugins"] if p["service"] == "google")
    assert google["connected"] is True


def test_disconnect_plugin_removes_row(client):
    signup(client, "alice")
    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        db.session.add(UserIntegration(user_id=user.id, service="google", access_token="tok"))
        db.session.commit()
    r = client.post("/api/plugins/google/disconnect")
    assert r.get_json()["ok"] is True
    with flask_app.app_context():
        assert UserIntegration.query.filter_by(service="google").count() == 0


def test_calendar_context_not_fetched_without_calendar_keyword(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        db.session.add(UserIntegration(user_id=user.id, service="google", access_token="tok"))
        db.session.commit()
    called = []
    monkeypatch.setattr(app_module.integrations, "get_upcoming_google_events", lambda *a, **k: called.append(1) or [])
    _mock_stream(monkeypatch, ["Hallo!"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "Wie geht's dir?"})
    assert not called


def test_calendar_context_injected_when_message_mentions_calendar(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        db.session.add(UserIntegration(user_id=user.id, service="google", access_token="tok"))
        db.session.commit()
    monkeypatch.setattr(
        app_module.integrations, "get_upcoming_google_events",
        lambda user, client_id, client_secret, max_results=5: [{"summary": "Zahnarzt", "start": "2026-09-15T10:00:00"}],
    )
    seen = {}

    def fake_stream(message, history=None, persona=None):
        seen["history"] = history
        yield "Klar, hier ist dein Termin."

    _mock_stream(monkeypatch, fake_stream)
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "Was steht heute in meinem Kalender?"})
    assert any("Zahnarzt" in (m.get("content") or "") for m in seen["history"])


# ---------------- NRS ----------------

def test_nrs_history_add_and_list(client):
    signup(client, "alice")
    r = client.post("/api/nrs/history", json={"url": "https://example.com/", "title": "example.com"})
    assert r.get_json()["ok"] is True
    entries = client.get("/api/nrs/history").get_json()["entries"]
    assert len(entries) == 1
    assert entries[0]["url"] == "https://example.com/" and entries[0]["title"] == "example.com"


def test_nrs_history_rejects_non_http_url(client):
    signup(client, "alice")
    r = client.post("/api/nrs/history", json={"url": "javascript:alert(1)", "title": "x"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_url"


def test_nrs_history_newest_first(client):
    signup(client, "alice")
    client.post("/api/nrs/history", json={"url": "https://one.example/", "title": "one"})
    client.post("/api/nrs/history", json={"url": "https://two.example/", "title": "two"})
    entries = client.get("/api/nrs/history").get_json()["entries"]
    assert [e["title"] for e in entries] == ["two", "one"]


def test_nrs_history_clear_removes_entries(client):
    signup(client, "alice")
    client.post("/api/nrs/history", json={"url": "https://example.com/", "title": "example.com"})
    r = client.post("/api/nrs/history/clear")
    assert r.get_json()["ok"] is True
    assert client.get("/api/nrs/history").get_json()["entries"] == []


def test_nrs_history_only_shows_own_entries(client):
    signup(client, "alice")
    client.post("/api/nrs/history", json={"url": "https://alice-only.example/", "title": "alice's"})

    bob = make_user(client, "bob")
    bob.post("/api/nrs/history", json={"url": "https://bob-only.example/", "title": "bob's"})

    alice_urls = [e["url"] for e in client.get("/api/nrs/history").get_json()["entries"]]
    bob_urls = [e["url"] for e in bob.get("/api/nrs/history").get_json()["entries"]]
    assert alice_urls == ["https://alice-only.example/"]
    assert bob_urls == ["https://bob-only.example/"]


def test_nrs_history_requires_login(client):
    r = client.get("/api/nrs/history")
    assert r.status_code == 401


def test_nrs_site_create_and_fetch_by_slug(client):
    signup(client, "alice")
    r = client.post("/api/nrs/sites", json={"name": "Meine Seite", "slug": "meine-seite", "html_code": "<h1>Hi</h1>"})
    j = r.get_json()
    assert j["ok"] is True and j["site"]["slug"] == "meine-seite" and j["site"]["is_mine"] is True

    fetched = client.get("/api/nrs/sites/meine-seite").get_json()
    assert fetched["ok"] is True
    assert fetched["site"]["name"] == "Meine Seite"
    assert fetched["site"]["html_code"] == "<h1>Hi</h1>"


def test_nrs_site_rejects_invalid_slug(client):
    signup(client, "alice")
    r = client.post("/api/nrs/sites", json={"name": "X", "slug": "not valid!", "html_code": "<p>x</p>"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_slug"


def test_nrs_site_rejects_empty_name_or_code(client):
    signup(client, "alice")
    assert client.post("/api/nrs/sites", json={"name": "", "slug": "x", "html_code": "<p>x</p>"}).status_code == 400
    assert client.post("/api/nrs/sites", json={"name": "X", "slug": "x", "html_code": ""}).status_code == 400


def test_nrs_site_rejects_duplicate_slug(client):
    signup(client, "alice")
    client.post("/api/nrs/sites", json={"name": "Erste", "slug": "dupe", "html_code": "<p>1</p>"})
    r = client.post("/api/nrs/sites", json={"name": "Zweite", "slug": "dupe", "html_code": "<p>2</p>"})
    assert r.status_code == 409 and r.get_json()["error"] == "slug_taken"


def test_nrs_site_get_unknown_slug_404s(client):
    signup(client, "alice")
    assert client.get("/api/nrs/sites/does-not-exist").status_code == 404


def test_nrs_site_any_logged_in_user_can_visit_by_slug(client):
    signup(client, "alice")
    client.post("/api/nrs/sites", json={"name": "Alices Seite", "slug": "alices-seite", "html_code": "<p>hi</p>"})

    bob = make_user(client, "bob")
    j = bob.get("/api/nrs/sites/alices-seite").get_json()
    assert j["ok"] is True and j["site"]["html_code"] == "<p>hi</p>"
    assert j["site"]["is_mine"] is False


def test_nrs_site_list_mine_only_shows_own_sites(client):
    signup(client, "alice")
    client.post("/api/nrs/sites", json={"name": "Alices Seite", "slug": "alices-only", "html_code": "<p>x</p>"})

    bob = make_user(client, "bob")
    bob.post("/api/nrs/sites", json={"name": "Bobs Seite", "slug": "bobs-only", "html_code": "<p>x</p>"})

    alice_slugs = [s["slug"] for s in client.get("/api/nrs/sites").get_json()["sites"]]
    bob_slugs = [s["slug"] for s in bob.get("/api/nrs/sites").get_json()["sites"]]
    assert alice_slugs == ["alices-only"]
    assert bob_slugs == ["bobs-only"]


def test_nrs_site_delete_requires_ownership(client):
    signup(client, "alice")
    client.post("/api/nrs/sites", json={"name": "Alices Seite", "slug": "owned-by-alice", "html_code": "<p>x</p>"})

    bob = make_user(client, "bob")
    assert bob.delete("/api/nrs/sites/owned-by-alice").status_code == 404
    assert client.get("/api/nrs/sites/owned-by-alice").status_code == 200  # still exists

    assert client.delete("/api/nrs/sites/owned-by-alice").status_code == 200
    assert client.get("/api/nrs/sites/owned-by-alice").status_code == 404


# ---------------- ychat ----------------

def test_ychat_create_and_list_post(client):
    signup(client, "alice")
    r = client.post("/api/ychat/posts", json={"content": "Hallo Welt"})
    j = r.get_json()
    assert j["ok"] is True and j["post"]["content"] == "Hallo Welt" and j["post"]["is_mine"] is True
    assert j["post"]["likes"] == 0 and j["post"]["liked_by_me"] is False

    posts = client.get("/api/ychat/posts").get_json()["posts"]
    assert len(posts) == 1 and posts[0]["content"] == "Hallo Welt"


def test_ychat_rejects_empty_post(client):
    signup(client, "alice")
    assert client.post("/api/ychat/posts", json={"content": "   "}).status_code == 400


def test_ychat_feed_shows_newest_first(client):
    signup(client, "alice")
    client.post("/api/ychat/posts", json={"content": "eins"})
    client.post("/api/ychat/posts", json={"content": "zwei"})
    contents = [p["content"] for p in client.get("/api/ychat/posts").get_json()["posts"]]
    assert contents == ["zwei", "eins"]


def test_ychat_feed_shows_posts_from_all_users(client):
    signup(client, "alice")
    client.post("/api/ychat/posts", json={"content": "von alice"})
    bob = make_user(client, "bob")
    bob.post("/api/ychat/posts", json={"content": "von bob"})

    authors = sorted(p["author"] for p in bob.get("/api/ychat/posts").get_json()["posts"])
    assert authors == ["alice", "bob"]


def test_ychat_like_toggles_and_is_per_user(client):
    signup(client, "alice")
    post_id = client.post("/api/ychat/posts", json={"content": "hi"}).get_json()["post"]["id"]
    bob = make_user(client, "bob")

    r1 = bob.post(f"/api/ychat/posts/{post_id}/like")
    j1 = r1.get_json()
    assert j1["ok"] is True and j1["post"]["likes"] == 1 and j1["post"]["liked_by_me"] is True

    # alice's own view of liked_by_me is independent of bob's like
    alice_view = client.get("/api/ychat/posts").get_json()["posts"][0]
    assert alice_view["likes"] == 1 and alice_view["liked_by_me"] is False

    r2 = bob.post(f"/api/ychat/posts/{post_id}/like")
    j2 = r2.get_json()
    assert j2["post"]["likes"] == 0 and j2["post"]["liked_by_me"] is False


def test_ychat_delete_requires_ownership(client):
    signup(client, "alice")
    post_id = client.post("/api/ychat/posts", json={"content": "hi"}).get_json()["post"]["id"]

    bob = make_user(client, "bob")
    assert bob.delete(f"/api/ychat/posts/{post_id}").status_code == 404
    assert len(client.get("/api/ychat/posts").get_json()["posts"]) == 1

    assert client.delete(f"/api/ychat/posts/{post_id}").status_code == 200
    assert len(client.get("/api/ychat/posts").get_json()["posts"]) == 0


def test_ychat_requires_login(client):
    assert client.get("/api/ychat/posts").status_code == 401


def test_ychat_created_at_is_explicitly_utc(client):
    # A naive-UTC isoformat() string with no "Z"/offset gets misread as
    # local time by JS's `new Date(...)` -- verified live (a fresh post
    # showed as hours old). Guard against losing the explicit "Z" again.
    signup(client, "alice")
    post = client.post("/api/ychat/posts", json={"content": "hi"}).get_json()["post"]
    assert post["created_at"].endswith("Z")


def test_ychat_live_toggle_on_and_off(client):
    signup(client, "alice")
    assert client.get("/api/ychat/live").get_json()["live"] == []

    r = client.post("/api/ychat/live", json={"is_live": True, "title": "baue was"})
    j = r.get_json()
    assert j["ok"] is True and j["is_live"] is True and j["title"] == "baue was"

    live = client.get("/api/ychat/live").get_json()["live"]
    assert live == [{"name": "alice", "title": "baue was", "video_id": None}]

    r2 = client.post("/api/ychat/live", json={"is_live": False})
    assert r2.get_json()["is_live"] is False
    assert client.get("/api/ychat/live").get_json()["live"] == []


def test_ychat_live_list_only_shows_live_users(client):
    signup(client, "alice")
    client.post("/api/ychat/live", json={"is_live": True, "title": "eins"})
    bob = make_user(client, "bob")
    # bob never goes live
    live_names = [u["name"] for u in bob.get("/api/ychat/live").get_json()["live"]]
    assert live_names == ["alice"]


def test_ychat_live_requires_login(client):
    assert client.post("/api/ychat/live", json={"is_live": True}).status_code == 401


def test_ychat_live_with_valid_youtube_url_extracts_video_id(client):
    signup(client, "alice")
    r = client.post("/api/ychat/live", json={
        "is_live": True, "title": "streame", "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    })
    j = r.get_json()
    assert j["ok"] is True and j["video_id"] == "dQw4w9WgXcQ"
    live = client.get("/api/ychat/live").get_json()["live"]
    assert live[0]["video_id"] == "dQw4w9WgXcQ"


def test_ychat_live_accepts_youtu_be_short_url(client):
    signup(client, "alice")
    r = client.post("/api/ychat/live", json={"is_live": True, "video_url": "https://youtu.be/dQw4w9WgXcQ"})
    assert r.get_json()["video_id"] == "dQw4w9WgXcQ"


def test_ychat_live_rejects_non_youtube_video_url(client):
    signup(client, "alice")
    r = client.post("/api/ychat/live", json={"is_live": True, "video_url": "https://example.com/stream"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_video_url"


def test_ychat_live_without_video_url_is_text_only(client):
    signup(client, "alice")
    r = client.post("/api/ychat/live", json={"is_live": True, "title": "nur Text"})
    j = r.get_json()
    assert j["ok"] is True and j["video_id"] is None


def test_ychat_live_video_id_cleared_when_going_offline(client):
    signup(client, "alice")
    client.post("/api/ychat/live", json={"is_live": True, "video_url": "https://youtu.be/dQw4w9WgXcQ"})
    client.post("/api/ychat/live", json={"is_live": False})
    assert client.get("/api/ychat/live").get_json()["live"] == []


def test_ylib_requires_login(client):
    r = client.get("/api/ylib/items")
    assert r.status_code == 401


BROWSER = {"Accept": "text/html,application/xhtml+xml"}


def test_browser_opening_root_gets_guest_session_without_login(client):
    home = client.get("/", headers=BROWSER)
    assert home.status_code == 200 and "Anmelden oder registrieren".encode() in home.data
    assert client.get("/api/ylib/items").get_json()["ok"] is True
    with flask_app.app_context():
        guest = User.query.one()
        assert guest.username.startswith("gast-") and guest.pl_display_name == "Gast"


def test_non_browser_request_to_root_does_not_create_a_guest(client):
    r = client.get("/", headers={"Accept": "*/*"}, follow_redirects=False)
    assert r.status_code == 302 and "/login" in r.headers["Location"]
    with flask_app.app_context():
        assert User.query.count() == 0


def test_guest_session_is_reused_on_later_visits(client):
    client.get("/", headers=BROWSER)
    client.get("/", headers=BROWSER)
    with flask_app.app_context():
        assert User.query.count() == 1


def test_library_offers_picking_files_from_this_device(client):
    home = client.get("/ylib-archiv", headers=BROWSER)
    assert b'data-filter="local"' in home.data
    assert b"ylLocalFolder" in home.data and b"ylLocalFiles" in home.data


def test_guest_can_upload_and_add_youtube_link(client, monkeypatch):
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: "YT")
    client.get("/", headers=BROWSER)
    up = client.post("/api/ylib/items", data={
        "title": "Bild", "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
    }, content_type="multipart/form-data")
    assert up.get_json()["ok"] is True
    yt = client.post("/api/ylib/youtube", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert yt.get_json()["ok"] is True
    assert len(client.get("/api/ylib/items").get_json()["items"]) == 2


def test_guests_have_separate_libraries(client):
    client.get("/", headers=BROWSER)
    client.post("/api/ylib/items", data={
        "title": "Meins", "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
    }, content_type="multipart/form-data")
    other = flask_app.test_client()
    other.get("/", headers=BROWSER)
    assert other.get("/api/ylib/items").get_json()["items"] == []


def test_guest_cannot_use_other_features(client):
    client.get("/", headers=BROWSER)
    assert client.post("/api/ychat/posts", json={"content": "hi"}).status_code == 401
    assert client.get("/api/teams").status_code == 401
    r = client.get("/ychat-archiv", follow_redirects=False)
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_guest_can_log_out_and_reach_the_login_page(client):
    client.get("/", headers=BROWSER)
    assert client.get("/logout", follow_redirects=False).status_code == 302
    assert client.get("/login").status_code == 200


def test_guest_username_prefix_cannot_be_registered(client):
    r = client.post("/api/pl/register/check-username", json={"username": "gast-1234567890"})
    assert r.get_json()["available"] is False


def test_link_page_redirects_non_browsers_to_login(client):
    r = client.get("/link", follow_redirects=False)
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_link_page_gives_browsers_a_guest_and_lists_examples(client):
    r = client.get("/link", headers=BROWSER)
    assert r.status_code == 200 and b"lkForm" in r.data
    for ex in app_module.LINK_EXAMPLES:
        assert ex["title"].encode() in r.data
    assert b'class="lk-ex-url" hidden' in r.data
    assert client.get("/api/ylib/items").get_json()["ok"] is True


def test_link_examples_are_valid_youtube_links():
    for ex in app_module.LINK_EXAMPLES:
        match = app_module._YOUTUBE_ID_RE.search(f"https://www.youtube.com/watch?v={ex['id']}")
        assert match and match.group(1) == ex["id"]


def test_link_preview_returns_thumbnail_and_title(client, monkeypatch):
    client.get("/link", headers=BROWSER)
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: "Echter Titel")
    j = client.get("/api/link/preview", query_string={"url": "https://youtu.be/dQw4w9WgXcQ"}).get_json()
    assert j == {
        "ok": True, "video_id": "dQw4w9WgXcQ", "title": "Echter Titel",
        "thumbnail_url": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    }


def test_link_preview_falls_back_to_generic_title(client, monkeypatch):
    client.get("/link", headers=BROWSER)
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: None)
    j = client.get("/api/link/preview", query_string={"url": "https://youtu.be/dQw4w9WgXcQ"}).get_json()
    assert j["title"] == "YouTube-Video"


def test_link_preview_rejects_non_youtube_url(client):
    client.get("/link", headers=BROWSER)
    r = client.get("/api/link/preview", query_string={"url": "https://example.com/video"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_url"


def test_link_preview_requires_a_session(client):
    r = client.get("/api/link/preview", query_string={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert r.status_code == 401


JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100


def _upload_video(client, thumb=None, thumb_name="thumb.jpg"):
    data = {"title": "Clip", "file": (io.BytesIO(b"FAKEMP4DATA"), "clip.mp4")}
    if thumb is not None:
        data["thumb"] = (io.BytesIO(thumb), thumb_name)
    return client.post("/api/ylib/items", data=data, content_type="multipart/form-data").get_json()


def test_ylib_video_upload_keeps_optional_thumbnail(client):
    signup(client, "alice")
    item = _upload_video(client, thumb=JPEG)["item"]
    assert item["thumbnail_url"]
    served = client.get(item["thumbnail_url"])
    assert served.status_code == 200 and served.mimetype == "image/jpeg" and served.data == JPEG


def test_ylib_video_upload_without_thumbnail_still_works(client):
    signup(client, "alice")
    item = _upload_video(client)["item"]
    assert item["kind"] == "video" and item["thumbnail_url"] is None


@pytest.mark.parametrize("thumb,name", [
    pytest.param(b"\xff\xd8\xff" + b"0" * (300 * 1024), "t.jpg", id="too_big"),
    pytest.param(b"not a jpeg at all", "t.jpg", id="not_a_jpeg"),
    pytest.param(JPEG, "t.exe", id="wrong_extension"),
    pytest.param(b"", "t.jpg", id="empty"),
])
def test_ylib_ignores_a_bad_thumbnail_but_keeps_the_upload(client, thumb, name):
    signup(client, "alice")
    result = _upload_video(client, thumb=thumb, thumb_name=name)
    assert result["ok"] is True and result["item"]["thumbnail_url"] is None


def test_ylib_thumbnail_is_ignored_for_images(client):
    signup(client, "alice")
    r = client.post("/api/ylib/items", data={
        "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
        "thumb": (io.BytesIO(JPEG), "t.jpg"),
    }, content_type="multipart/form-data")
    assert r.get_json()["item"]["thumbnail_url"] is None


def test_ylib_delete_removes_video_and_thumbnail_media(client):
    signup(client, "alice")
    item = _upload_video(client, thumb=JPEG)["item"]
    with flask_app.app_context():
        assert PlMedia.query.count() == 2
    client.delete(f"/api/ylib/items/{item['id']}")
    with flask_app.app_context():
        assert PlMedia.query.count() == 0


def test_media_type_comes_from_extension_not_uploader_header(client):
    signup(client, "alice")
    r = client.post("/api/ylib/items", data={
        "file": (io.BytesIO(b"<script>alert(1)</script>"), "evil.png", "text/html"),
    }, content_type="multipart/form-data")
    served = client.get(r.get_json()["item"]["url"])
    assert served.mimetype == "image/png"
    assert served.headers["X-Content-Type-Options"] == "nosniff"


# ---------------- NRS Suche (own search engine) ----------------

def _add_page(title, extract, slug=None):
    doc = search_engine.index_document(f"https://de.wikipedia.org/wiki/{slug or title}", title, extract)
    db.session.commit()
    return doc


def test_tokenize_folds_case_umlauts_and_drops_stopwords():
    assert search_engine.tokenize("Die Größe der BÄREN in Köln") == ["grosse", "baren", "koln"]


def test_index_document_skips_urls_that_are_already_indexed(client):
    assert _add_page("Katze", "Die Katze ist ein Haustier.") is not None
    assert _add_page("Katze", "Die Katze ist ein Haustier.") is None
    assert search_engine.doc_count() == 1


def test_search_without_terms_or_index_returns_nothing(client):
    assert search_engine.search("") == ([], 0)
    assert search_engine.search("katze") == ([], 0)


def test_search_finds_matching_pages_only(client):
    _add_page("Katze", "Die Katze ist ein Haustier. Katzen jagen Mäuse.")
    _add_page("Hund", "Der Hund ist ein Haustier und Begleiter des Menschen.")
    results, total = search_engine.search("katze")
    assert [r["title"] for r in results] == ["Katze"] and total == 1
    both, _ = search_engine.search("haustier")
    assert {r["title"] for r in both} == {"Katze", "Hund"}


def test_search_prefers_pages_matching_all_terms(client):
    _add_page("Bonn", "Bonn war die Hauptstadt der Bundesrepublik.")
    _add_page("Berlin", "Berlin ist die Hauptstadt von Deutschland.")
    results, _ = search_engine.search("hauptstadt berlin")
    assert results[0]["title"] == "Berlin"


def test_search_finds_longer_words_by_prefix(client):
    _add_page("Berliner Mauer", "Die Berliner Mauer teilte die Stadt.")
    results, _ = search_engine.search("berlin")
    assert [r["title"] for r in results] == ["Berliner Mauer"]


def test_bm25_accepts_a_decimal_average_like_postgres_returns():
    from decimal import Decimal
    assert search_engine._bm25(2, 120, Decimal("95.5"), 1.3) == search_engine._bm25(2, 120, 95.5, 1.3)


def test_snippet_highlights_hits_and_escapes_html():
    html = str(search_engine.make_snippet("Ein <script>alert(1)</script> Text über Katzen.", ["katzen"]))
    assert "<script>" not in html and "&lt;script&gt;" in html
    assert "<mark>Katzen</mark>" in html


def test_search_pages_need_a_session(client):
    r = client.get("/suche", follow_redirects=False)
    assert r.status_code == 302 and "/login" in r.headers["Location"]


def test_search_home_shows_how_many_pages_are_indexed(client):
    _add_page("Katze", "Die Katze ist ein Haustier.")
    home = client.get("/suche", headers=BROWSER)
    assert home.status_code == 200 and b"Durchsucht 1 Seiten" in home.data


def test_search_results_page_lists_hits_with_links_to_the_card(client):
    doc = _add_page("Katze", "Die Katze ist ein Haustier.")
    client.get("/suche", headers=BROWSER)
    r = client.get("/suche", query_string={"q": "katze"})
    assert r.status_code == 200 and b"1 Ergebnisse" in r.data and b"<mark>Katze</mark>" in r.data
    assert f"/suche/artikel/{doc.id}".encode() in r.data


def test_search_results_page_without_hits_says_so(client):
    client.get("/suche", headers=BROWSER)
    r = client.get("/suche", query_string={"q": "zzzzqqq"})
    assert b"Keine Ergebnisse" in r.data


def test_search_query_is_escaped_on_the_page(client):
    client.get("/suche", headers=BROWSER)
    r = client.get("/suche", query_string={"q": "<script>alert(1)</script>"})
    assert b"<script>alert(1)</script>" not in r.data and b"&lt;script&gt;" in r.data


def test_search_results_are_paged_ten_at_a_time(client):
    for i in range(12):
        _add_page(f"Seite{i}", "Dieser Text erwähnt das Wort Testwort.")
    client.get("/suche", headers=BROWSER)
    first = client.get("/suche", query_string={"q": "testwort"}).data
    second = client.get("/suche", query_string={"q": "testwort", "p": 2}).data
    assert first.count(b'class="sr-result"') == 10 and b"Weiter" in first
    assert second.count(b'class="sr-result"') == 2 and b"Weiter" not in second


def test_search_card_shows_text_with_attribution(client):
    doc = _add_page("Katze", "Die Katze ist ein Haustier.")
    client.get("/suche", headers=BROWSER)
    r = client.get(f"/suche/artikel/{doc.id}")
    assert r.status_code == 200 and b"Die Katze ist ein Haustier." in r.data
    assert b"CC BY-SA 4.0" in r.data and doc.url.encode() in r.data
    assert client.get("/suche/artikel/9999").status_code == 404


class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload, self.status_code = payload, status_code

    def json(self):
        return self._payload


def test_fetch_popular_titles_skips_namespace_pages_and_sums_views(monkeypatch):
    monkeypatch.setattr(search_engine.time, "sleep", lambda s: None)
    pages = {
        "2026/09": [{"article": "Berlin", "views": 10}, {"article": "Spezial:Suche", "views": 99}],
        "2026/08": [{"article": "Hamburg", "views": 15}, {"article": "Berlin", "views": 10},
                    {"article": "Wikipedia:Hauptseite", "views": 98}],
    }

    def fake_get(url, **kwargs):
        key = "/".join(url.split("/")[-3:-1])
        return _FakeResponse({"items": [{"articles": pages[key]}]})

    monkeypatch.setattr(search_engine.requests, "get", fake_get)
    titles = search_engine.fetch_popular_titles(months=2, today=date(2026, 10, 3))
    assert titles == ["Berlin", "Hamburg"]


def test_crawl_indexes_pages_once_and_skips_stubs(client, monkeypatch):
    monkeypatch.setattr(search_engine.time, "sleep", lambda s: None)
    long_text = "Berlin ist die Hauptstadt und eine Stadt in Deutschland. " * 3
    monkeypatch.setattr(search_engine, "fetch_popular_titles", lambda months: ["Berlin", "Stub"])
    monkeypatch.setattr(search_engine, "fetch_extracts", lambda titles: [("Berlin", long_text), ("Stub", "kurz")])
    search_engine.crawl_wikipedia(limit=10)
    search_engine.crawl_wikipedia(limit=10)
    assert search_engine.doc_count() == 1
    assert search_engine.search("hauptstadt")[0][0]["url"] == "https://de.wikipedia.org/wiki/Berlin"


def test_article_url_quotes_titles():
    assert search_engine.article_url("Frankfurt am Main") == "https://de.wikipedia.org/wiki/Frankfurt_am_Main"
    assert search_engine.article_url("Köln") == "https://de.wikipedia.org/wiki/K%C3%B6ln"


def test_guest_browser_page_hides_the_mini_site_button_but_accounts_keep_it(client):
    guest = client.get("/browser-archiv", headers=BROWSER)
    assert b'title="Mini-Site erstellen" hidden' in guest.data
    member = flask_app.test_client()
    member.post("/signup", data={"username": "carol", "password": "secret1", "password2": "secret1"})
    assert b'title="Mini-Site erstellen" hidden' not in member.get("/browser-archiv").data


def test_guest_can_use_the_browser_history(client):
    client.get("/", headers=BROWSER)
    assert client.post("/api/nrs/history", json={"url": "https://example.com", "title": "x"}).get_json()["ok"] is True
    assert len(client.get("/api/nrs/history").get_json()["entries"]) == 1


def test_guest_cannot_create_mini_sites(client):
    client.get("/", headers=BROWSER)
    r = client.post("/api/nrs/sites", json={"name": "x", "slug": "meine-seite", "html_code": "<p>hi</p>"})
    assert r.status_code == 401


# ---------------- NRS Server (Minecraft hosting on volunteers' computers) ----------------

@pytest.fixture(autouse=True)
def _fixed_minecraft_versions(monkeypatch):
    """Never ask Mojang over the network during tests."""
    monkeypatch.setattr(mc_hosting, "valid_versions", lambda: ["1.21.4", "1.20.1"])


def _make_admin(username):
    User.query.filter_by(username=username).first().is_admin = True
    db.session.commit()


def _user_client(username):
    other = flask_app.test_client()
    other.post("/signup", data={"username": username, "password": "secret1", "password2": "secret1"})
    return other


def _new_host(admin, owner, name="Gaming-PC"):
    code = admin.post("/api/mc/invites").get_json()["code"]
    return owner.post("/api/mc/hosts", json={"invite": code, "name": name}).get_json()


def _sync(token, servers=None, **extra):
    return flask_app.test_client().post(
        "/api/agent/sync", json={"servers": servers or [], **extra}, headers={"Authorization": "Bearer " + token},
    ).get_json()


def _new_server(user, name="Survival", version="1.21.4"):
    return user.post("/api/mc/servers", json={"name": name, "version": version}).get_json()["server"]["id"]


def test_guest_sees_a_landing_page_not_the_panel(client):
    home = client.get("/", headers=BROWSER)
    assert "Anmelden oder registrieren".encode() in home.data and b"svList" not in home.data


def test_guests_cannot_use_the_server_api(client):
    client.get("/", headers=BROWSER)
    assert client.get("/api/mc/servers").status_code == 401
    assert client.post("/api/mc/servers", json={"name": "x", "version": "1.21.4"}).status_code == 401


def test_create_server_validates_name_version_and_limit(client):
    signup(client, "alice")
    assert client.post("/api/mc/servers", json={"name": "  ", "version": "1.21.4"}).get_json()["error"] == "empty_name"
    assert client.post("/api/mc/servers", json={"name": "x", "version": "0.0.1"}).get_json()["error"] == "bad_version"
    assert _new_server(client, "Eins") and _new_server(client, "Zwei")
    r = client.post("/api/mc/servers", json={"name": "Drei", "version": "1.21.4"})
    assert r.status_code == 400 and r.get_json()["error"] == "limit_reached"


def test_max_players_is_capped(client):
    signup(client, "alice")
    r = client.post("/api/mc/servers", json={"name": "Groß", "version": "1.21.4", "max_players": 500})
    assert r.get_json()["server"]["max_players"] == 20


def test_start_queues_and_stop_cancels_a_queued_server(client):
    signup(client, "alice")
    sid = _new_server(client)
    started = client.post(f"/api/mc/servers/{sid}/start").get_json()["server"]
    assert started["status"] == "queued"
    stopped = client.post(f"/api/mc/servers/{sid}/stop").get_json()["server"]
    assert stopped["status"] == "offline"


def test_servers_belong_to_their_owner(client):
    signup(client, "alice")
    sid = _new_server(client)
    bob = _user_client("bob")
    assert bob.get("/api/mc/servers").get_json()["servers"] == []
    assert bob.post(f"/api/mc/servers/{sid}/start").status_code == 404
    assert bob.post(f"/api/mc/servers/{sid}/stop").status_code == 404
    assert bob.delete(f"/api/mc/servers/{sid}").status_code == 404


def test_only_admins_can_create_invites(client):
    signup(client, "alice")
    assert client.post("/api/mc/invites").status_code == 403
    _make_admin("alice")
    j = client.post("/api/mc/invites").get_json()
    assert j["ok"] is True and len(j["code"].replace("-", "")) == 16


def test_invite_lets_someone_add_a_computer_exactly_once(client):
    signup(client, "alice")
    _make_admin("alice")
    bob = _user_client("bob")
    code = client.post("/api/mc/invites").get_json()["code"]
    first = bob.post("/api/mc/hosts", json={"invite": code.lower(), "name": "Bobs PC"}).get_json()
    assert first["ok"] is True and first["token"]
    again = bob.post("/api/mc/hosts", json={"invite": code, "name": "Noch ein PC"})
    assert again.status_code == 403 and again.get_json()["error"] == "bad_invite"
    host = McHost.query.one()
    assert host.token_hash == mc_hosting.hash_token(first["token"]) and host.token_hash != first["token"]


def test_wrong_or_expired_invites_are_rejected(client):
    signup(client, "alice")
    _make_admin("alice")
    assert client.post("/api/mc/hosts", json={"invite": "NICHTECHT", "name": "PC"}).status_code == 403
    client.post("/api/mc/invites")
    invite = McHostInvite.query.one()
    invite.expires_at = invite.expires_at.replace(year=2020)
    db.session.commit()
    assert client.post("/api/mc/hosts", json={"invite": invite.code, "name": "PC"}).status_code == 403


def test_adding_a_computer_needs_a_name_and_an_account(client):
    signup(client, "alice")
    _make_admin("alice")
    code = client.post("/api/mc/invites").get_json()["code"]
    assert client.post("/api/mc/hosts", json={"invite": code, "name": " "}).get_json()["error"] == "empty_name"
    guest = flask_app.test_client()
    guest.get("/", headers=BROWSER)
    assert guest.post("/api/mc/hosts", json={"invite": code, "name": "PC"}).status_code == 401


def test_hosts_list_shows_own_computers_and_admins_see_all(client):
    signup(client, "alice")
    _make_admin("alice")
    bob = _user_client("bob")
    _new_host(client, bob, "Bobs PC")
    assert [h["name"] for h in bob.get("/api/mc/hosts").get_json()["hosts"]] == ["Bobs PC"]
    assert client.get("/api/mc/hosts").get_json()["hosts"][0]["owner"] == "bob"
    carol = _user_client("carol")
    assert carol.get("/api/mc/hosts").get_json()["hosts"] == []


def test_agent_needs_a_valid_token(client):
    assert flask_app.test_client().post("/api/agent/sync", json={}).status_code == 401
    r = flask_app.test_client().post("/api/agent/sync", json={}, headers={"Authorization": "Bearer falsch"})
    assert r.status_code == 401


def test_agent_sync_marks_the_computer_online_and_stores_its_address(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    assert client.get("/api/mc/hosts").get_json()["hosts"][0]["online"] is False
    _sync(token, address="203.0.113.7:25565")
    host = client.get("/api/mc/hosts").get_json()["hosts"][0]
    assert host["online"] is True and host["address"] == "203.0.113.7:25565"
    for bad in ("evil<script>", "203.0.113.9:25565\n"):
        _sync(token, address=bad)
        assert client.get("/api/mc/hosts").get_json()["hosts"][0]["address"] == "203.0.113.7:25565"


def test_computer_counts_as_offline_after_30_quiet_seconds(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    _sync(token)
    host = McHost.query.one()
    host.last_seen = host.last_seen.replace(year=2020)
    db.session.commit()
    assert client.get("/api/mc/hosts").get_json()["hosts"][0]["online"] is False


def test_queued_server_is_handed_to_a_computer_and_runs_through_to_online(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    sid = _new_server(client, version="1.20.1")
    client.post(f"/api/mc/servers/{sid}/start")
    jobs = _sync(token)["jobs"]
    assert jobs == [{"action": "start", "server_id": sid, "version": "1.20.1", "max_players": 10}]
    assert client.get("/api/mc/servers").get_json()["servers"][0]["status"] == "starting"
    assert _sync(token, [{"id": sid, "status": "starting"}])["jobs"] == []
    _sync(token, [{"id": sid, "status": "online", "players": 3, "address": "203.0.113.7:25565",
                   "log": ["Done (3.1s)!"]}])
    server = client.get("/api/mc/servers").get_json()["servers"][0]
    assert (server["status"], server["players"], server["address"], server["host"]) == (
        "online", 3, "203.0.113.7:25565", "Gaming-PC")
    assert "Done (3.1s)!" in server["console"]


def test_start_job_is_repeated_until_the_agent_reports_the_server(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    assert len(_sync(token)["jobs"]) == 1
    assert len(_sync(token)["jobs"]) == 1


def test_a_computer_only_runs_as_many_servers_as_it_allows(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    first, second = _new_server(client, "A"), _new_server(client, "B")
    client.post(f"/api/mc/servers/{first}/start")
    client.post(f"/api/mc/servers/{second}/start")
    jobs = _sync(token, max_servers=1)["jobs"]
    assert [j["server_id"] for j in jobs] == [first]
    assert [s["status"] for s in client.get("/api/mc/servers").get_json()["servers"]] == ["starting", "queued"]
    client.post(f"/api/mc/servers/{first}/stop")
    assert _sync(token, [{"id": first, "status": "online"}])["jobs"] == [{"action": "stop", "server_id": first}]
    jobs = _sync(token, [{"id": first, "status": "offline"}])["jobs"]
    assert [j["server_id"] for j in jobs] == [second]


def test_max_servers_reported_by_the_agent_is_capped(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    _sync(token, max_servers=99)
    assert McHost.query.one().max_servers == mc_hosting.MAX_HOST_SERVERS


def test_stopping_an_online_server_sends_a_stop_job_and_ends_offline(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    _sync(token)
    _sync(token, [{"id": sid, "status": "online", "address": "203.0.113.7:25565"}])
    assert client.post(f"/api/mc/servers/{sid}/stop").get_json()["server"]["status"] == "stopping"
    assert _sync(token, [{"id": sid, "status": "online"}])["jobs"] == [{"action": "stop", "server_id": sid}]
    _sync(token, [{"id": sid, "status": "offline"}])
    server = client.get("/api/mc/servers").get_json()["servers"][0]
    assert (server["status"], server["host"], server["address"], server["players"]) == ("offline", None, None, 0)


def test_server_the_agent_no_longer_runs_is_finalized_when_stopping(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    _sync(token)
    client.post(f"/api/mc/servers/{sid}/stop")
    _sync(token)
    assert client.get("/api/mc/servers").get_json()["servers"][0]["status"] == "offline"


def test_agent_error_report_takes_the_server_offline_and_shows_the_reason(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    _sync(token)
    _sync(token, [{"id": sid, "status": "error", "log": ["Fehler: Java wurde nicht gefunden."]}])
    server = client.get("/api/mc/servers").get_json()["servers"][0]
    assert server["status"] == "offline" and "Java wurde nicht gefunden" in server["console"]


def test_agent_is_told_to_stop_servers_that_are_not_its_to_run(client):
    signup(client, "alice")
    _make_admin("alice")
    mine = _new_host(client, client, "Erster")["token"]
    other = _new_host(client, client, "Zweiter")["token"]
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    _sync(mine)
    jobs = _sync(other, [{"id": sid, "status": "online"}, {"id": 9999, "status": "online"}])["jobs"]
    assert sorted(j["server_id"] for j in jobs) == [sid, 9999] and all(j["action"] == "stop" for j in jobs)
    assert client.get("/api/mc/servers").get_json()["servers"][0]["host"] == "Erster"


def test_agent_reports_are_clamped_and_cannot_flood_the_console(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    _sync(token)
    _sync(token, [{"id": sid, "status": "online", "players": 10**9, "log": ["x" * 5000] * 200 + [42, None]}])
    server = McServer.query.one()
    assert server.players == server.max_players
    assert len(server.console) <= mc_hosting.CONSOLE_MAX_CHARS
    assert server.console.count("\n") <= mc_hosting.MAX_LOG_LINES_PER_SYNC


def test_malformed_agent_payloads_do_not_crash_the_site(client):
    signup(client, "alice")
    _make_admin("alice")
    token = _new_host(client, client)["token"]
    auth = {"Authorization": "Bearer " + token}
    for body in ([1, 2], {"servers": "nope"}, {"servers": [None, 5, {"id": "x"}, {"id": 1, "log": "text"}]}):
        r = flask_app.test_client().post("/api/agent/sync", json=body, headers=auth)
        assert r.status_code == 200 and r.get_json()["ok"] is True


def test_running_servers_cannot_be_deleted_offline_ones_can(client):
    signup(client, "alice")
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    assert client.delete(f"/api/mc/servers/{sid}").status_code == 409
    client.post(f"/api/mc/servers/{sid}/stop")
    assert client.delete(f"/api/mc/servers/{sid}").get_json()["ok"] is True
    assert client.get("/api/mc/servers").get_json()["servers"] == []


def test_removing_a_computer_releases_its_servers(client):
    signup(client, "alice")
    _make_admin("alice")
    host = _new_host(client, client)
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    _sync(host["token"])
    assert client.delete(f"/api/mc/hosts/{host['host']['id']}").get_json()["ok"] is True
    assert client.get("/api/mc/servers").get_json()["servers"][0]["status"] == "offline"
    assert _sync(host["token"]).get("error") == "bad_token"


def test_only_the_owner_or_an_admin_can_remove_a_computer(client):
    signup(client, "alice")
    _make_admin("alice")
    bob = _user_client("bob")
    host_id = _new_host(client, bob)["host"]["id"]
    carol = _user_client("carol")
    assert carol.delete(f"/api/mc/hosts/{host_id}").status_code == 404
    assert client.delete(f"/api/mc/hosts/{host_id}").get_json()["ok"] is True


def test_auto_start_queues_only_offline_servers_marked_for_it(client):
    signup(client, "alice")
    auto, manual = _new_server(client, "Auto"), _new_server(client, "Manuell")
    assert client.post(f"/api/mc/servers/{auto}/auto-start", json={"enabled": True}).get_json()["server"]["auto_start"]
    assert client.post("/api/mc/auto-start").get_json()["queued"] == 1
    statuses = {s["id"]: s["status"] for s in client.get("/api/mc/servers").get_json()["servers"]}
    assert statuses == {auto: "queued", manual: "offline"}
    assert client.post("/api/mc/auto-start").get_json()["queued"] == 0


def test_host_agent_download_is_public_and_is_the_readable_source(client):
    r = flask_app.test_client().get("/host-agent.py")
    assert r.status_code == 200 and b"NRS Server host agent" in r.data
    assert b"never runs commands" in r.data.lower().replace(b"\n", b" ").replace(b"  ", b" ") or b"never runs" in r.data.lower()


# ---- the host agent program itself

def test_agent_accepts_only_plain_release_version_numbers():
    assert agent_mod.clean_version("1.21.4") == "1.21.4"
    for bad in ("../../etc", "1.21; calc", "latest", "", None, 121, "1.21.4\n"):
        assert agent_mod.clean_version(bad) is None


def test_agent_only_downloads_from_mojang_over_https():
    assert agent_mod.check_download_url("https://piston-data.mojang.com/v1/objects/x/server.jar")
    for bad in ("http://piston-data.mojang.com/x", "https://example.com/server.jar",
                "https://piston-data.mojang.com.evil.example/x", "file:///etc/passwd"):
        with pytest.raises(ValueError):
            agent_mod.check_download_url(bad)


def test_agent_server_properties_are_safe_and_capped():
    props = agent_mod.build_properties(25570, 500)
    assert props["server-port"] == "25570" and props["max-players"] == "20"
    assert props["online-mode"] == "true" and props["enable-rcon"] == "false"


def test_agent_keeps_existing_properties_when_writing_its_own(tmp_path):
    path = tmp_path / "server.properties"
    path.write_text("# comment\ndifficulty=hard\nmax-players=3\n", encoding="utf-8")
    agent_mod.write_properties(str(path), {"max-players": "7"})
    text = path.read_text(encoding="utf-8")
    assert "difficulty=hard" in text and "max-players=7" in text and "max-players=3" not in text


class _Config:
    def __init__(self, tmp_path, **overrides):
        self.dir, self.ram, self.port, self.max_servers = str(tmp_path), 1024, 25565, 1
        self.advertise_host, self.simulate, self.accept_eula = "198.51.100.4", True, False
        self.__dict__.update(overrides)


def _agent_for(token, tmp_path, **overrides):
    def transport(payload):
        r = flask_app.test_client().post("/api/agent/sync", json=payload, headers={"Authorization": "Bearer " + token})
        return r.get_json()
    return agent_mod.Agent(_Config(tmp_path, **overrides), transport)


def test_simulated_agent_runs_a_server_from_start_to_stop(client, tmp_path):
    signup(client, "alice")
    _make_admin("alice")
    agent = _agent_for(_new_host(client, client)["token"], tmp_path)
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    for _ in range(12):
        agent.step()
        if client.get("/api/mc/servers").get_json()["servers"][0]["status"] == "online":
            break
    server = client.get("/api/mc/servers").get_json()["servers"][0]
    assert server["status"] == "online" and server["address"] == "198.51.100.4:25565"
    for _ in range(4):
        agent.step()
    assert client.get("/api/mc/servers").get_json()["servers"][0]["players"] == 1
    client.post(f"/api/mc/servers/{sid}/stop")
    for _ in range(8):
        agent.step()
        if client.get("/api/mc/servers").get_json()["servers"][0]["status"] == "offline":
            break
    server = client.get("/api/mc/servers").get_json()["servers"][0]
    assert server["status"] == "offline" and agent.instances == {}
    assert "Simulation" in server["console"]


def test_agent_refuses_to_start_a_real_server_without_the_eula(client, tmp_path):
    signup(client, "alice")
    _make_admin("alice")
    agent = _agent_for(_new_host(client, client)["token"], tmp_path, simulate=False, accept_eula=False)
    sid = _new_server(client)
    client.post(f"/api/mc/servers/{sid}/start")
    for _ in range(4):
        agent.step()
    server = client.get("/api/mc/servers").get_json()["servers"][0]
    assert server["status"] == "offline" and "EULA" in server["console"]
    assert not (tmp_path / "servers").exists()


def test_agent_ignores_jobs_with_bad_data(tmp_path):
    agent = agent_mod.Agent(_Config(tmp_path), lambda payload: {"jobs": []})
    agent.handle({"action": "start", "server_id": "1; rm -rf", "version": "1.21.4"})
    agent.handle({"action": "rm", "server_id": 1})
    agent.handle("start")
    agent.handle({"action": "start", "server_id": 5, "version": "../../x"})
    assert [type(i).__name__ for i in agent.instances.values()] == ["FailedInstance"]


def test_agent_survives_an_unreachable_site(tmp_path):
    def broken(payload):
        raise OSError("offline")
    assert agent_mod.Agent(_Config(tmp_path), broken).step() is False


class _FakeProc:
    def __init__(self, lines):
        self.stdout, self.stdin, self.terminated = iter(lines), io.StringIO(), False

    def poll(self):
        return None

    def terminate(self):
        self.terminated = True


def test_java_instance_follows_the_server_log(tmp_path):
    import time
    proc = _FakeProc([
        "[12:00:00] [Server thread/INFO]: Preparing level",
        '[12:00:03] [Server thread/INFO]: Done (3.2s)! For help, type "help"',
        "[12:00:10] [Server thread/INFO]: Alice joined the game",
        "[12:00:11] [Server thread/INFO]: Bob joined the game",
        "[12:00:20] [Server thread/INFO]: Alice left the game",
    ])
    instance = agent_mod.JavaInstance(1, proc, "198.51.100.4:25565")
    for _ in range(50):
        if len(instance.log) == 5:
            break
        time.sleep(0.02)
    assert (instance.status, instance.players) == ("online", 1)
    instance.stop()
    assert instance.status == "stopping" and proc.stdin.getvalue() == "stop\n"


def test_agent_report_sends_at_most_fifty_log_lines_at_a_time():
    instance = agent_mod.SimulatedInstance(1, "x:1")
    instance.log.extend(f"Zeile {i}" for i in range(120))
    first = agent_mod.report_of(instance)
    assert len(first["log"]) == 50 and len(agent_mod.report_of(instance)["log"]) == 50


def test_ylib_rejects_oversized_upload(client, monkeypatch):
    signup(client, "alice")
    monkeypatch.setattr(app_module, "YLIB_MAX_UPLOAD_BYTES", 100)
    r = client.post("/api/ylib/items", data={
        "file": (io.BytesIO(b"\x89PNG" + b"0" * 500), "big.png"),
    }, content_type="multipart/form-data")
    assert r.status_code == 413 and r.get_json()["error"] == "too_large"
    assert client.get("/api/ylib/items").get_json()["items"] == []


def test_ylib_item_limit_applies_to_uploads_and_youtube_links(client, monkeypatch):
    signup(client, "alice")
    monkeypatch.setattr(app_module, "YLIB_MAX_ITEMS_PER_USER", 2)
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: "YT")
    for _ in range(2):
        ok = client.post("/api/ylib/items", data={
            "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
        }, content_type="multipart/form-data")
        assert ok.get_json()["ok"] is True
    full = client.post("/api/ylib/items", data={
        "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
    }, content_type="multipart/form-data")
    assert full.status_code == 400 and full.get_json()["error"] == "limit_reached"
    yt = client.post("/api/ylib/youtube", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert yt.status_code == 400 and yt.get_json()["error"] == "limit_reached"


def test_ylib_upload_and_list_image(client):
    signup(client, "alice")
    r = client.post("/api/ylib/items", data={
        "title": "Strand",
        "file": (io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 200), "beach.png"),
    }, content_type="multipart/form-data")
    j = r.get_json()
    assert j["ok"] is True
    assert j["item"]["title"] == "Strand" and j["item"]["kind"] == "image" and j["item"]["url"]
    listed = client.get("/api/ylib/items").get_json()["items"]
    assert len(listed) == 1 and listed[0]["title"] == "Strand"


def test_ylib_upload_video_sets_kind_video(client):
    signup(client, "alice")
    r = client.post("/api/ylib/items", data={
        "title": "Urlaubsclip",
        "file": (io.BytesIO(b"FAKEMP4DATA"), "clip.mp4"),
    }, content_type="multipart/form-data")
    assert r.get_json()["item"]["kind"] == "video"


def test_ylib_upload_defaults_title_to_filename(client):
    signup(client, "alice")
    r = client.post("/api/ylib/items", data={
        "file": (io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"0" * 200), "sonnenuntergang.png"),
    }, content_type="multipart/form-data")
    assert r.get_json()["item"]["title"] == "sonnenuntergang.png"


def test_ylib_upload_rejects_bad_extension(client):
    signup(client, "alice")
    r = client.post("/api/ylib/items", data={
        "file": (io.BytesIO(b"not media"), "virus.exe"),
    }, content_type="multipart/form-data")
    assert r.status_code == 400 and r.get_json()["error"] == "bad_type"


def test_ylib_upload_requires_a_file(client):
    signup(client, "alice")
    r = client.post("/api/ylib/items", data={"title": "leer"}, content_type="multipart/form-data")
    assert r.status_code == 400 and r.get_json()["error"] == "no_file"


def test_ylib_items_are_private_to_owner(client):
    signup(client, "alice")
    client.post("/api/ylib/items", data={
        "title": "Geheim", "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
    }, content_type="multipart/form-data")
    bob = make_user(client, "bob")
    assert bob.get("/api/ylib/items").get_json()["items"] == []


def test_ylib_delete_own_item(client):
    signup(client, "alice")
    item_id = client.post("/api/ylib/items", data={
        "title": "Weg damit", "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
    }, content_type="multipart/form-data").get_json()["item"]["id"]
    r = client.delete(f"/api/ylib/items/{item_id}")
    assert r.get_json()["ok"] is True
    assert client.get("/api/ylib/items").get_json()["items"] == []
    with flask_app.app_context():
        assert db.session.get(YlibItem, item_id) is None


def test_ylib_youtube_add_uses_given_title(client, monkeypatch):
    signup(client, "alice")
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: "sollte nicht benutzt werden")
    r = client.post("/api/ylib/youtube", json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Mein Titel"})
    j = r.get_json()
    assert j["ok"] is True
    item = j["item"]
    assert item["title"] == "Mein Titel" and item["source"] == "youtube" and item["kind"] == "video"
    assert item["youtube_video_id"] == "dQw4w9WgXcQ"
    assert item["thumbnail_url"] == "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    assert item["url"] is None


def test_ylib_youtube_add_falls_back_to_oembed_title(client, monkeypatch):
    signup(client, "alice")
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: "Echter Titel via oEmbed")
    r = client.post("/api/ylib/youtube", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert r.get_json()["item"]["title"] == "Echter Titel via oEmbed"


def test_ylib_youtube_add_falls_back_to_generic_title_when_oembed_fails(client, monkeypatch):
    signup(client, "alice")
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: None)
    r = client.post("/api/ylib/youtube", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert r.get_json()["item"]["title"] == "YouTube-Video"


def test_ylib_youtube_add_rejects_non_youtube_url(client):
    signup(client, "alice")
    r = client.post("/api/ylib/youtube", json={"url": "https://example.com/video"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_url"


def test_ylib_youtube_items_show_up_in_list_alongside_uploads(client, monkeypatch):
    signup(client, "alice")
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: "YT")
    client.post("/api/ylib/youtube", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    client.post("/api/ylib/items", data={
        "title": "Bild", "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
    }, content_type="multipart/form-data")
    items = client.get("/api/ylib/items").get_json()["items"]
    assert len(items) == 2
    sources = {it["source"] for it in items}
    assert sources == {"youtube", "upload"}


def test_ylib_youtube_item_delete_does_not_touch_media_store(client, monkeypatch):
    signup(client, "alice")
    monkeypatch.setattr(app_module, "_youtube_oembed_title", lambda vid: "YT")
    item_id = client.post("/api/ylib/youtube", json={"url": "https://youtu.be/dQw4w9WgXcQ"}).get_json()["item"]["id"]
    r = client.delete(f"/api/ylib/items/{item_id}")
    assert r.get_json()["ok"] is True
    with flask_app.app_context():
        assert db.session.get(YlibItem, item_id) is None


def test_ylib_delete_rejects_foreign_item(client):
    signup(client, "alice")
    item_id = client.post("/api/ylib/items", data={
        "title": "Nicht deins", "file": (io.BytesIO(b"\x89PNG" + b"0" * 50), "a.png"),
    }, content_type="multipart/form-data").get_json()["item"]["id"]
    bob = make_user(client, "bob")
    r = bob.delete(f"/api/ylib/items/{item_id}")
    assert r.status_code == 404
    with flask_app.app_context():
        assert db.session.get(YlibItem, item_id) is not None


def test_system_prompt_documents_the_nexpreview_artifact_convention():
    assert "nexpreview" in app_module.ai_assistant.SYSTEM_PROMPT


def test_system_prompt_requires_clean_code_style():
    assert "aussagekräftige Namen" in app_module.ai_assistant.SYSTEM_PROMPT


def test_system_prompt_requires_polished_visual_design_for_artifacts():
    assert "wie von einem echten Designer gebaut" in app_module.ai_assistant.SYSTEM_PROMPT


def test_system_prompt_requires_self_review_before_emitting_code():
    prompt = app_module.ai_assistant.SYSTEM_PROMPT
    assert "mindestens 15 Mal gründlich durch" in prompt


def test_system_prompt_documents_the_tfjs_exception():
    prompt = app_module.ai_assistant.SYSTEM_PROMPT
    assert "cdn.jsdelivr.net" in prompt and "tf.min.js" in prompt
    # the exception must stay additive: the base "no external deps" rule
    # for ordinary nexpreview artifacts is still there, unmodified
    assert "keine externen Abhängigkeiten/CDN-Links" in prompt


def test_system_prompt_requires_autonomous_first_training_run():
    assert "SOFORT automatisch" in app_module.ai_assistant.SYSTEM_PROMPT


def test_system_prompt_asks_for_visible_thorough_work_on_complex_questions():
    prompt = app_module.ai_assistant.SYSTEM_PROMPT
    assert "Ich gehe das in drei Teilen an" in prompt
    # must stay scoped to genuinely complex questions, not become a
    # blanket instruction to pad every reply
    assert "nicht jede Frage braucht diese Tiefe" in prompt


def test_system_prompt_requires_cpu_backend_and_float32_labels_for_training():
    # Found via live testing: WebGL backend can hang forever on .fit() for
    # these tiny models without ever throwing, and int32 label tensors
    # throw a real dtype error with some loss functions (sparseCategorical-
    # Crossentropy's internal floor op requires float32). Both silently
    # broke every training artifact, so both must stay pinned in the prompt.
    prompt = app_module.ai_assistant.SYSTEM_PROMPT
    assert 'tf.setBackend("cpu")' in prompt
    assert "'float32'" in prompt and "NIE 'int32'" in prompt


def test_max_reply_tokens_raised_for_ml_artifacts():
    assert app_module.ai_assistant.MAX_REPLY_TOKENS == 4000


def test_neo_persona_shares_artifact_protocol():
    assert "nexpreview" in app_module.ai_assistant.PERSONAS["neo"]["prompt"]


def test_neo_persona_excludes_admin_credentials_and_theme():
    for persona in app_module.ai_assistant.PERSONAS.values():
        prompt = persona["prompt"]
        assert "ADMIN_PASSWORD" not in prompt
        assert "f0b64d" not in prompt
        assert "Administrator" not in prompt


def test_stream_persists_nexpreview_blocks_verbatim(client, monkeypatch):
    """The raw fence text is stored unchanged -- extraction/hiding the
    artifact from the chat bubble is purely a client-side concern, see
    pinklemon-nex.js's splitPreview()."""
    signup(client, "alice")
    cid = _chat_id(client)
    raw = "Hier ist deine Seite.\n\n````nexpreview:Test\n<html><body>Hi</body></html>\n````"
    _mock_stream(monkeypatch, [raw])
    r = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "baue mir was"})
    assert r.get_data(as_text=True) == raw
    with flask_app.app_context():
        chat = db.session.get(AiChat, cid)
        assert chat.messages[-1].content == raw


def test_system_prompt_documents_the_neximage_convention():
    assert "neximage" in app_module.ai_assistant.SYSTEM_PROMPT


def test_stream_persists_neximage_blocks_verbatim(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    raw = "Hier ist dein Bild.\n\n````neximage:Test\na small red circle on white background\n````"
    _mock_stream(monkeypatch, [raw])
    r = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "mal mir was"})
    assert r.get_data(as_text=True) == raw
    with flask_app.app_context():
        chat = db.session.get(AiChat, cid)
        assert chat.messages[-1].content == raw


def test_stream_collapses_prior_neximage_blocks_before_sending_as_history(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    raw = "Hier ist dein Bild.\n\n````neximage:Test-Titel\na small red circle\n````"
    _mock_stream(monkeypatch, [raw])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "mal mir was"})

    seen_history = []

    def fake_stream(message, history=None, persona=None):
        seen_history.append(history)
        yield "ok"

    _mock_stream(monkeypatch, fake_stream)
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "danke"})

    assistant_turn = seen_history[0][1]
    assert assistant_turn["content"] == "Hier ist dein Bild.\n\n[Bild-Prompt: Test-Titel]"
    with flask_app.app_context():
        chat = db.session.get(AiChat, cid)
        assert "````neximage" in chat.messages[1].content


def test_collapses_neximage_block_with_no_trailing_newline_before_closing_fence():
    """Found via live testing: the model's prompt trails off mid-sentence
    right into the closing ```` with no newline in between (e.g. "...a
    mystical atmosphere.````"). The regex used to require \n```` exactly,
    so this real-world shape silently fell through uncollapsed -- and on
    the client, the matching bug meant the whole block rendered as a raw
    code block instead of becoming an image at all."""
    raw = "Hier ist dein Bild.\n\n````neximage:Fox\nA red fox in a forest.````"
    collapsed = app_module._collapse_artifacts_for_history(raw)
    assert collapsed == "Hier ist dein Bild.\n\n[Bild-Prompt: Fox]"


def test_stream_collapses_prior_artifacts_before_sending_as_history(client, monkeypatch):
    """The DB/UI keep the full artifact; only what's sent back to Groq on
    the NEXT turn gets collapsed to a placeholder (see
    _collapse_artifacts_for_history in app.py)."""
    signup(client, "alice")
    cid = _chat_id(client)
    raw = "Hier ist deine Seite.\n\n````nexpreview:Test-Titel\n<html><body>Hi</body></html>\n````"
    _mock_stream(monkeypatch, [raw])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "baue mir was"})

    seen_history = []

    def fake_stream(message, history=None, persona=None):
        seen_history.append(history)
        yield "ok"

    _mock_stream(monkeypatch, fake_stream)
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "danke"})

    assistant_turn = seen_history[0][1]
    assert assistant_turn["content"] == "Hier ist deine Seite.\n\n[Vorschau-Code: Test-Titel]"
    with flask_app.app_context():
        # the stored/rendered message itself is untouched
        chat = db.session.get(AiChat, cid)
        assert "````nexpreview" in chat.messages[1].content


def test_stream_reuses_the_same_chat_and_sends_history(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    seen_history = []

    def fake_stream(message, history=None, persona=None):
        seen_history.append(history)
        yield "reply " + str(len(seen_history))

    _mock_stream(monkeypatch, fake_stream)
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "first"})
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "second"})

    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        assert AiChat.query.filter_by(user_id=alice.id).count() == 1

    assert seen_history[0] == []
    assert seen_history[1] == [{"role": "user", "content": "first"}, {"role": "assistant", "content": "reply 1"}]


def test_stream_uses_chat_persona(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    client.patch(f"/api/ai/chats/{cid}", json={"character": "neo"})
    seen_personas = []

    def fake_stream(message, history=None, persona=None):
        seen_personas.append(persona)
        yield "ok"

    _mock_stream(monkeypatch, fake_stream)
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"})
    assert seen_personas == ["neo"]


def test_stream_handles_ai_failure_gracefully(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)

    def boom(message, history=None, persona=None):
        raise RuntimeError("groq down")
        yield  # pragma: no cover -- makes this a generator function

    _mock_stream(monkeypatch, boom)
    r = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"})
    assert r.get_data(as_text=True) == ""
    # the user's message is still saved even though the reply failed
    with flask_app.app_context():
        chat = db.session.get(AiChat, cid)
        assert [m.role for m in chat.messages] == ["user"]


# ---------------- Nex chat sidebar (list / create / rename / delete) ----------------

def test_chats_endpoints_require_login(client):
    assert client.get("/api/ai/chats").status_code == 401
    assert client.post("/api/ai/chats").status_code == 401
    assert client.get("/api/ai/chats/1/messages").status_code == 401
    assert client.patch("/api/ai/chats/1", json={"title": "x"}).status_code == 401
    assert client.post("/api/ai/chats/1/delete").status_code == 401


def test_create_chat_returns_default_title(client):
    signup(client, "alice")
    j = client.post("/api/ai/chats").get_json()
    assert j["ok"] is True and j["chat"]["title"] == "Neuer Chat"


def test_create_chat_defaults_to_nex_persona(client):
    signup(client, "alice")
    j = client.post("/api/ai/chats").get_json()
    assert j["chat"]["character"] == "nex"


def test_create_chat_accepts_character(client):
    signup(client, "alice")
    j = client.post("/api/ai/chats", json={"character": "neo"}).get_json()
    assert j["ok"] is True and j["chat"]["character"] == "neo"


def test_create_chat_rejects_invalid_character(client):
    signup(client, "alice")
    r = client.post("/api/ai/chats", json={"character": "not-a-persona"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_character"


def test_list_chats_returns_only_own_chats_sorted_by_updated_at(client, monkeypatch):
    signup(client, "alice")
    cid1 = _chat_id(client)
    cid2 = _chat_id(client)
    bob = make_user(client, "bob")
    bob.post("/api/ai/chats")

    # touch cid1 more recently by sending a message in it
    _mock_stream(monkeypatch, ["ok"])
    client.post(f"/api/ai/chats/{cid1}/stream", json={"message": "hi"})

    listed = client.get("/api/ai/chats").get_json()["chats"]
    assert [c["id"] for c in listed] == [cid1, cid2]


def test_get_chat_messages(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    _mock_stream(monkeypatch, ["Hi!"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "Hallo"})
    j = client.get(f"/api/ai/chats/{cid}/messages").get_json()
    assert j["ok"] is True
    assert [(m["role"], m["content"]) for m in j["messages"]] == [("user", "Hallo"), ("assistant", "Hi!")]


def test_get_chat_messages_preserves_multiple_nexpreview_blocks(client, monkeypatch):
    """The version-tabs UI in the preview panel is built entirely from this
    endpoint's history -- if a chat has several nexpreview artifacts across
    turns, all of them must come back verbatim, not just the latest."""
    signup(client, "alice")
    cid = _chat_id(client)
    _mock_stream(monkeypatch, ["Erste Version.\n\n````nexpreview:V1\n<html>1</html>\n````"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "baue ein spiel"})
    _mock_stream(monkeypatch, ["Zweite Version.\n\n````nexpreview:V2\n<html>2</html>\n````"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "mach es besser"})

    messages = client.get(f"/api/ai/chats/{cid}/messages").get_json()["messages"]
    assistant_replies = [m["content"] for m in messages if m["role"] == "assistant"]
    assert len(assistant_replies) == 2
    assert "````nexpreview:V1" in assistant_replies[0]
    assert "````nexpreview:V2" in assistant_replies[1]


def test_get_chat_messages_rejects_a_chat_that_is_not_yours(client):
    signup(client, "alice")
    cid = _chat_id(client)
    bob = make_user(client, "bob")
    assert bob.get(f"/api/ai/chats/{cid}/messages").status_code == 404


def test_rename_chat(client):
    signup(client, "alice")
    cid = _chat_id(client)
    r = client.patch(f"/api/ai/chats/{cid}", json={"title": "Mein Chat"})
    assert r.get_json()["chat"]["title"] == "Mein Chat"
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).title == "Mein Chat"


def test_rename_chat_rejects_empty_title(client):
    signup(client, "alice")
    cid = _chat_id(client)
    r = client.patch(f"/api/ai/chats/{cid}", json={"title": "   "})
    assert r.status_code == 400 and r.get_json()["error"] == "empty"


def test_rename_chat_rejects_a_chat_that_is_not_yours(client):
    signup(client, "alice")
    cid = _chat_id(client)
    bob = make_user(client, "bob")
    assert bob.patch(f"/api/ai/chats/{cid}", json={"title": "hijack"}).status_code == 404


def test_patch_chat_updates_character(client):
    signup(client, "alice")
    cid = _chat_id(client)
    r = client.patch(f"/api/ai/chats/{cid}", json={"character": "neo"})
    assert r.get_json()["chat"]["character"] == "neo"
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).character == "neo"


def test_patch_chat_rejects_invalid_character(client):
    signup(client, "alice")
    cid = _chat_id(client)
    r = client.patch(f"/api/ai/chats/{cid}", json={"character": "not-a-persona"})
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_character"
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).character == "nex"


def test_patch_chat_rejects_empty_body(client):
    signup(client, "alice")
    cid = _chat_id(client)
    r = client.patch(f"/api/ai/chats/{cid}", json={})
    assert r.status_code == 400 and r.get_json()["error"] == "empty"


def test_patch_chat_rejects_character_on_a_chat_that_is_not_yours(client):
    signup(client, "alice")
    cid = _chat_id(client)
    bob = make_user(client, "bob")
    assert bob.patch(f"/api/ai/chats/{cid}", json={"character": "neo"}).status_code == 404
    with flask_app.app_context():
        assert db.session.get(AiChat, cid).character == "nex"


def test_delete_chat_removes_its_messages(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    _mock_stream(monkeypatch, ["ok"])
    client.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"})

    r = client.post(f"/api/ai/chats/{cid}/delete")
    assert r.get_json()["ok"] is True
    with flask_app.app_context():
        assert db.session.get(AiChat, cid) is None
        assert AiChatMessage.query.filter_by(chat_id=cid).count() == 0


def test_delete_chat_rejects_a_chat_that_is_not_yours(client):
    signup(client, "alice")
    cid = _chat_id(client)
    bob = make_user(client, "bob")
    assert bob.post(f"/api/ai/chats/{cid}/delete").status_code == 404
    with flask_app.app_context():
        assert db.session.get(AiChat, cid) is not None
