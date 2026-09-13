import os
import sys
import io
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"

import pytest
import app as app_module
from app import app as flask_app, db
from models import User, AiChat, AiChatMessage


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


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


def test_signup_then_land_on_nex(client):
    r = signup(client, "alice")
    assert r.status_code in (302, 303)
    home = client.get("/")
    assert home.status_code == 200
    assert b"HEXAGONUM" in home.data


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
        monkeypatch.setattr(app_module.ai_assistant, "generate_reply_stream", lambda message, history=None: iter(chunks))


def _chat_id(client):
    """GET / lazily creates the user's chat -- fetch its id for the
    stream route, which (unlike / ) never auto-creates one."""
    client.get("/")
    with client.session_transaction() as sess:
        uid = sess.get("user_id")
    with flask_app.app_context():
        return AiChat.query.filter_by(user_id=uid).order_by(AiChat.updated_at.desc()).first().id


def test_root_creates_a_chat_and_shows_empty_state(client):
    signup(client, "alice")
    home = client.get("/")
    assert home.status_code == 200
    assert b"nxMsgs" in home.data
    with flask_app.app_context():
        assert AiChat.query.filter_by(user_id=User.query.filter_by(username="alice").first().id).count() == 1


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


def test_stream_reuses_the_same_chat_and_sends_history(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)
    seen_history = []

    def fake_stream(message, history=None):
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


def test_stream_handles_ai_failure_gracefully(client, monkeypatch):
    signup(client, "alice")
    cid = _chat_id(client)

    def boom(message, history=None):
        raise RuntimeError("groq down")
        yield  # pragma: no cover -- makes this a generator function

    _mock_stream(monkeypatch, boom)
    r = client.post(f"/api/ai/chats/{cid}/stream", json={"message": "hi"})
    assert r.get_data(as_text=True) == ""
    # the user's message is still saved even though the reply failed
    with flask_app.app_context():
        chat = db.session.get(AiChat, cid)
        assert [m.role for m in chat.messages] == ["user"]
