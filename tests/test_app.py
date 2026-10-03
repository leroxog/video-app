import os
import sys
import io
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"

import pytest
import app as app_module
from app import app as flask_app, db
from models import User, AiChat, AiChatMessage, Team, TeamMember, TeamMessage, UserIntegration, NrsHistoryEntry, YlibItem


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


def test_signup_then_land_on_ylib(client):
    r = signup(client, "alice")
    assert r.status_code in (302, 303)
    home = client.get("/")
    assert home.status_code == 200
    assert b"ylGrid" in home.data


def test_nrs_archived_redirects_to_login_when_logged_out(client):
    r = client.get("/nrs-archiv", follow_redirects=False)
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


def test_root_serves_ylib_not_ychat_nrs_or_nex(client):
    """Nex was archived in favor of NRS, then NRS in favor of ychat, then
    ychat itself was archived in favor of ylib as the site's main page
    (2026-09-25) -- "/" now serves ylib; all older UIs still fully work,
    just at /nex-archiv, /nrs-archiv and /ychat-archiv (see tests
    elsewhere), unlinked from anywhere a normal user would land."""
    signup(client, "alice")
    home = client.get("/")
    assert home.status_code == 200
    assert (
        b"ylGrid" in home.data
        and b"ycFeed" not in home.data
        and b"nrsAddress" not in home.data
        and b"nxMsgs" not in home.data
    )


def test_nrs_archived_still_serves_nrs(client):
    signup(client, "alice")
    home = client.get("/nrs-archiv")
    assert home.status_code == 200
    assert b"nrsAddress" in home.data


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
