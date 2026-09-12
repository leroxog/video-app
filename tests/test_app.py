import os
import sys
import io
import shutil
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"

import pytest
import app as app_module
from app import app as flask_app, db
from models import User


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    flask_app.config["UPLOAD_FOLDER"] = tempfile.mkdtemp()
    flask_app.config["PROFILE_PIC_FOLDER"] = tempfile.mkdtemp()
    flask_app.config["SOUND_FOLDER"] = tempfile.mkdtemp()
    app_module._pl_typing.clear()
    app_module._pl_calls.clear()
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


def test_signup_then_land_on_feed(client):
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
    r = client.get("/api/pl/mutuals")
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


def test_suggested_servers_excludes_private_and_already_joined(client):
    signup(client, "alice")
    priv = _make_server(client, "Privat")
    pub = _make_server(client, "Öffentlich")
    client.post(f"/api/pl/servers/{pub['server']['id']}/visibility", json={"is_public": True})

    bob = make_user(client, "bob")
    suggested = bob.get("/api/pl/servers/suggested").get_json()["servers"]
    names = [s["name"] for s in suggested]
    assert "Öffentlich" in names and "Privat" not in names

    code = pub["server"]["invite_code"]
    bob.post(f"/api/pl/servers/join/{code}")
    suggested_after = bob.get("/api/pl/servers/suggested").get_json()["servers"]
    assert "Öffentlich" not in [s["name"] for s in suggested_after]


def test_server_visibility_requires_manage_server_permission(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    code = j["server"]["invite_code"]
    bob = make_user(client, "bob")
    bob.post(f"/api/pl/servers/join/{code}")
    r = bob.post(f"/api/pl/servers/{sid}/visibility", json={"is_public": True})
    assert r.status_code == 403


# ---------------- avatar colors ----------------

def test_avatar_color_is_stable_and_in_palette(client):
    assert app_module.pl_avatar_color("alice") == app_module.pl_avatar_color("alice")
    assert app_module.pl_avatar_color("alice") in app_module.PL_AVATAR_PALETTE
    # case-insensitive, so "Alice" and "alice" always match visually elsewhere too
    assert app_module.pl_avatar_color("Alice") == app_module.pl_avatar_color("alice")


def test_pending_chat_avatar_uses_the_same_color_as_the_api(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    # mutual follow, no chat created yet -> bob shows up in the "pending" row
    # on the home screen, using the same avatar-color helper as the API
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    color = app_module.pl_avatar_color("bob")
    assert f'background:{color}'.encode() in client.get("/").data


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


# ---------------- shell / pages ----------------

def test_pages_render_for_logged_in_user(client):
    signup(client, "alice")
    # home (chat list / server rail / pending mutuals)
    home = client.get("/")
    assert home.status_code == 200 and b'id="plChatList"' in home.data
    # own profile
    prof = client.get("/freunde/u/alice")
    assert prof.status_code == 200 and b"plEditProfileBtn" in prof.data
    # a real chat
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    assert client.get(f"/freunde/c/{cid}").status_code == 200
    # a real server
    sid = _make_server(client)["server"]["id"]
    assert client.get(f"/freunde/server/{sid}").status_code == 200


# ---------------- Freunde ----------------

def test_dm_needs_mutual_follow(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    # alice -> bob only: not mutual yet
    client.post("/api/pl/follow/bob")
    assert client.post("/api/pl/chats/dm/bob").status_code == 403
    # bob follows back -> mutual -> DM opens
    bob.post("/api/pl/follow/alice")
    j = client.post("/api/pl/chats/dm/bob").get_json()
    assert j["ok"] and isinstance(j["chat_id"], int)
    # re-opening returns the same chat
    assert client.post("/api/pl/chats/dm/bob").get_json()["chat_id"] == j["chat_id"]


def test_follow_toggles_and_reports_mutual(client):
    signup(client, "alice")
    make_user(client, "bob")
    a = client.post("/api/pl/follow/bob").get_json()
    assert a["following"] is True and a["mutual"] is False
    b = client.post("/api/pl/follow/bob").get_json()
    assert b["following"] is False


def test_send_and_receive_messages(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    client.post(f"/api/pl/chats/{cid}/messages", json={"text": "hi bob"})
    got = bob.get(f"/api/pl/chats/{cid}/messages").get_json()
    assert [m["text"] for m in got["messages"]] == ["hi bob"]
    assert got["messages"][0]["is_mine"] is False


def _dm(client, other, other_client):
    client.post(f"/api/pl/follow/{other}")
    other_client.post("/api/pl/follow/alice")
    return client.post(f"/api/pl/chats/dm/{other}").get_json()["chat_id"]


def test_message_reply_shows_quoted_parent_and_survives_its_deletion(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    m1 = client.post(f"/api/pl/chats/{cid}/messages", json={"text": "erste Nachricht"}).get_json()["message"]
    m2 = bob.post(f"/api/pl/chats/{cid}/messages", json={"text": "Antwort drauf", "reply_to_id": m1["id"]}).get_json()["message"]
    assert m2["reply_to"] == {"id": m1["id"], "deleted": False, "sender_name": "alice", "text": "erste Nachricht"}

    client.delete(f"/api/pl/messages/{m1['id']}")
    got = bob.get(f"/api/pl/chats/{cid}/messages?after=0").get_json()["messages"]
    reply = next(m for m in got if m["id"] == m2["id"])
    assert reply["reply_to"]["deleted"] is True


def test_edit_and_delete_own_message_only(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    msg = client.post(f"/api/pl/chats/{cid}/messages", json={"text": "tippo"}).get_json()["message"]

    # bob can't edit or delete alice's message
    assert bob.patch(f"/api/pl/messages/{msg['id']}", json={"text": "hack"}).status_code == 404
    assert bob.delete(f"/api/pl/messages/{msg['id']}").status_code == 404

    r = client.patch(f"/api/pl/messages/{msg['id']}", json={"text": "korrigiert"})
    j = r.get_json()
    assert j["ok"] and j["message"]["text"] == "korrigiert" and j["message"]["edited"] is True

    assert client.delete(f"/api/pl/messages/{msg['id']}").get_json()["ok"] is True
    remaining = client.get(f"/api/pl/chats/{cid}/messages?after=0").get_json()["messages"]
    assert msg["id"] not in [m["id"] for m in remaining]


def test_message_reactions_toggle(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    msg = client.post(f"/api/pl/chats/{cid}/messages", json={"text": "hi"}).get_json()["message"]

    r1 = bob.post(f"/api/pl/messages/{msg['id']}/react", json={"emoji": "👍"}).get_json()
    assert r1["message"]["reactions"] == [{"emoji": "👍", "count": 1, "me": True}]
    r2 = client.post(f"/api/pl/messages/{msg['id']}/react", json={"emoji": "👍"}).get_json()
    assert {"emoji": "👍", "count": 2, "me": True} in r2["message"]["reactions"]
    # toggling the same emoji again removes just that user's (alice's) reaction
    r3 = client.post(f"/api/pl/messages/{msg['id']}/react", json={"emoji": "👍"}).get_json()
    assert r3["message"]["reactions"] == [{"emoji": "👍", "count": 1, "me": False}]
    assert client.post(f"/api/pl/messages/{msg['id']}/react", json={"emoji": "🍕"}).status_code == 400


def test_pin_and_unpin_message(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    msg = client.post(f"/api/pl/chats/{cid}/messages", json={"text": "wichtig"}).get_json()["message"]

    assert bob.get(f"/api/pl/chats/{cid}/pinned").get_json()["messages"] == []
    r = bob.post(f"/api/pl/messages/{msg['id']}/pin")
    assert r.get_json()["message"]["pinned"] is True
    pinned = client.get(f"/api/pl/chats/{cid}/pinned").get_json()["messages"]
    assert [m["id"] for m in pinned] == [msg["id"]]

    r2 = client.post(f"/api/pl/messages/{msg['id']}/pin")
    assert r2.get_json()["message"]["pinned"] is False
    assert client.get(f"/api/pl/chats/{cid}/pinned").get_json()["messages"] == []


def test_typing_indicator(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    assert client.get(f"/api/pl/chats/{cid}/typing").get_json()["typing"] == []
    bob.post(f"/api/pl/chats/{cid}/typing")
    j = client.get(f"/api/pl/chats/{cid}/typing").get_json()
    assert j["typing"] == ["bob"]
    # you never see yourself in your own typing list
    assert bob.get(f"/api/pl/chats/{cid}/typing").get_json()["typing"] == []


def test_chat_page_shows_online_presence(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    bob.get("/")  # touches bob's last_seen
    body = client.get(f"/freunde/c/{cid}").data
    assert b"pl-chat-presence" in body and b"Online" in body


def test_call_start_rings_the_other_member(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    assert client.post(f"/api/pl/chats/{cid}/call/start").get_json()["ok"] is True

    j = bob.get(f"/api/pl/chats/{cid}/call/state").get_json()
    assert j["active"] is True and j["caller_name"] == "alice" and j["is_caller"] is False
    # the caller's own poll also sees the call, but as the caller
    j2 = client.get(f"/api/pl/chats/{cid}/call/state").get_json()
    assert j2["active"] is True and j2["is_caller"] is True


def test_call_signal_relayed_but_not_to_sender(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    client.post(f"/api/pl/chats/{cid}/call/start")
    client.post(f"/api/pl/chats/{cid}/call/signal", json={"type": "offer", "data": {"sdp": "fake-offer"}})

    # bob sees alice's offer
    j = bob.get(f"/api/pl/chats/{cid}/call/state").get_json()
    assert len(j["signals"]) == 1 and j["signals"][0]["type"] == "offer" and j["signals"][0]["data"]["sdp"] == "fake-offer"
    # alice never sees her own signal echoed back
    j2 = client.get(f"/api/pl/chats/{cid}/call/state").get_json()
    assert j2["signals"] == []

    bob.post(f"/api/pl/chats/{cid}/call/signal", json={"type": "answer", "data": {"sdp": "fake-answer"}})
    after = j["signals"][0]["id"]
    j3 = client.get(f"/api/pl/chats/{cid}/call/state?after={after}").get_json()
    assert len(j3["signals"]) == 1 and j3["signals"][0]["type"] == "answer"


def test_call_hangup_clears_state_for_both(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    client.post(f"/api/pl/chats/{cid}/call/start")
    client.post(f"/api/pl/chats/{cid}/call/signal", json={"type": "hangup"})
    assert client.get(f"/api/pl/chats/{cid}/call/state").get_json()["active"] is False
    assert bob.get(f"/api/pl/chats/{cid}/call/state").get_json()["active"] is False


def test_call_not_supported_in_groups(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/group", json={"name": "Gruppe", "members": ["bob"]}).get_json()["chat_id"]
    r = client.post(f"/api/pl/chats/{cid}/call/start")
    assert r.status_code == 400 and r.get_json()["error"] == "group_calls_not_supported"


def test_call_cannot_start_while_one_is_active(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    client.post(f"/api/pl/chats/{cid}/call/start")
    r = bob.post(f"/api/pl/chats/{cid}/call/start")
    assert r.status_code == 409 and r.get_json()["error"] == "already_in_call"


def test_call_signal_without_active_call(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cid = _dm(client, "bob", bob)
    # a stray offer with nothing ringing is a real error ...
    r = client.post(f"/api/pl/chats/{cid}/call/signal", json={"type": "offer"})
    assert r.status_code == 404
    # ... but hangup/decline are idempotent no-ops, never an error
    assert client.post(f"/api/pl/chats/{cid}/call/signal", json={"type": "hangup"}).get_json()["ok"] is True


# ---------------- servers: channels + roles/permissions ----------------

def _make_server(client, name="Testserver"):
    return client.post("/api/pl/servers", json={"name": name}).get_json()


def test_create_server_sets_up_default_role_and_channel(client):
    signup(client, "alice")
    j = _make_server(client)
    assert j["ok"] is True
    sid = j["server"]["id"]
    assert j["server"]["is_owner"] is True
    assert sorted(j["server"]["my_permissions"]) == sorted(list(app_module.PL_SERVER_PERMISSIONS))

    detail = client.get(f"/api/pl/servers/{sid}").get_json()
    assert [c["name"] for c in detail["channels"]] == ["allgemein"]
    assert len(detail["roles"]) == 1 and detail["roles"][0]["is_default"] is True
    assert len(detail["members"]) == 1 and detail["members"][0]["username"] == "alice"

    # the owner can immediately chat in the default channel via the normal message API
    cid = detail["channels"][0]["id"]
    r = client.post(f"/api/pl/chats/{cid}/messages", json={"text": "hallo server"})
    assert r.get_json()["ok"] is True


def test_server_channels_excluded_from_normal_chat_list(client):
    signup(client, "alice")
    _make_server(client)
    assert client.get("/api/pl/chats").get_json()["chats"] == []


def test_join_via_invite_code_grants_access_to_all_channels(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    code = j["server"]["invite_code"]
    cid = client.get(f"/api/pl/servers/{sid}").get_json()["channels"][0]["id"]

    bob = make_user(client, "bob")
    jb = bob.post(f"/api/pl/servers/join/{code}").get_json()
    assert jb["ok"] is True and jb["server"]["id"] == sid
    assert bob.post(f"/api/pl/chats/{cid}/messages", json={"text": "hi"}).get_json()["ok"] is True

    detail = client.get(f"/api/pl/servers/{sid}").get_json()
    assert len(detail["members"]) == 2


def test_new_channel_syncs_existing_members(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    code = j["server"]["invite_code"]
    bob = make_user(client, "bob")
    bob.post(f"/api/pl/servers/join/{code}")

    r = client.post(f"/api/pl/servers/{sid}/channels", json={"name": "zweiter-kanal"})
    assert r.get_json()["ok"] is True
    new_cid = r.get_json()["channel"]["id"]
    # bob (an existing member, not the creator) can post immediately
    assert bob.post(f"/api/pl/chats/{new_cid}/messages", json={"text": "hi"}).get_json()["ok"] is True


def test_channel_defaults_to_text_type_and_no_category(client):
    signup(client, "alice")
    j = _make_server(client)
    detail = client.get(f"/api/pl/servers/{j['server']['id']}").get_json()
    assert detail["channels"][0]["channel_type"] == "text"
    assert detail["channels"][0]["category"] is None


def test_create_voice_channel_with_category(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    r = client.post(f"/api/pl/servers/{sid}/channels", json={
        "name": "lounge", "channel_type": "voice", "category": "Sprachkanäle",
    })
    ch = r.get_json()["channel"]
    assert ch["channel_type"] == "voice"
    assert ch["category"] == "Sprachkanäle"


def test_create_channel_rejects_bogus_channel_type(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    r = client.post(f"/api/pl/servers/{sid}/channels", json={"name": "x", "channel_type": "video"})
    assert r.get_json()["channel"]["channel_type"] == "text"


def test_non_owner_without_permission_cannot_create_channel(client):
    signup(client, "alice")
    j = _make_server(client)
    code = j["server"]["invite_code"]
    bob = make_user(client, "bob")
    bob.post(f"/api/pl/servers/join/{code}")
    r = bob.post(f"/api/pl/servers/{j['server']['id']}/channels", json={"name": "nope"})
    assert r.status_code == 403


def test_role_creation_and_permission_grant(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    code = j["server"]["invite_code"]
    bob = make_user(client, "bob")
    bob.post(f"/api/pl/servers/join/{code}")

    role = client.post(f"/api/pl/servers/{sid}/roles", json={
        "name": "Mods", "color": "#ff0000", "permissions": ["manage_channels", "kick_members"],
    }).get_json()["role"]
    # bob still can't manage channels without the role
    assert bob.post(f"/api/pl/servers/{sid}/channels", json={"name": "x"}).status_code == 403

    members = client.get(f"/api/pl/servers/{sid}").get_json()["members"]
    bob_member = next(m for m in members if m["username"] == "bob")
    r = client.post(f"/api/pl/servers/{sid}/members/{bob_member['user_id']}/roles", json={"role_id": role["id"], "assign": True})
    assert r.get_json()["ok"] is True and role["id"] in r.get_json()["member"]["role_ids"]

    # now bob can create a channel
    assert bob.post(f"/api/pl/servers/{sid}/channels", json={"name": "x"}).get_json()["ok"] is True


def test_default_role_cannot_be_deleted(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    default_role_id = client.get(f"/api/pl/servers/{sid}").get_json()["roles"][0]["id"]
    r = client.delete(f"/api/pl/servers/{sid}/roles/{default_role_id}")
    assert r.status_code == 400 and r.get_json()["error"] == "cannot_delete_default_role"


def test_kick_removes_channel_access(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    code = j["server"]["invite_code"]
    cid = client.get(f"/api/pl/servers/{sid}").get_json()["channels"][0]["id"]
    bob = make_user(client, "bob")
    bob.post(f"/api/pl/servers/join/{code}")
    assert bob.post(f"/api/pl/chats/{cid}/messages", json={"text": "hi"}).get_json()["ok"] is True

    bob_uid = next(m["user_id"] for m in client.get(f"/api/pl/servers/{sid}").get_json()["members"] if m["username"] == "bob")
    assert client.post(f"/api/pl/servers/{sid}/members/{bob_uid}/kick").get_json()["ok"] is True
    assert bob.post(f"/api/pl/chats/{cid}/messages", json={"text": "hi again"}).status_code == 404


def test_owner_cannot_be_kicked_or_banned_or_leave(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    with flask_app.app_context():
        alice_id = User.query.filter_by(username="alice").first().id
    assert client.post(f"/api/pl/servers/{sid}/members/{alice_id}/kick").status_code == 400
    assert client.post(f"/api/pl/servers/{sid}/members/{alice_id}/ban").status_code == 400
    assert client.post(f"/api/pl/servers/{sid}/leave").get_json()["error"] == "owner_cannot_leave"


def test_ban_prevents_rejoin_until_unbanned(client):
    signup(client, "alice")
    j = _make_server(client)
    sid = j["server"]["id"]
    code = j["server"]["invite_code"]
    bob = make_user(client, "bob")
    bob.post(f"/api/pl/servers/join/{code}")
    bob_uid = next(m["user_id"] for m in client.get(f"/api/pl/servers/{sid}").get_json()["members"] if m["username"] == "bob")

    assert client.post(f"/api/pl/servers/{sid}/members/{bob_uid}/ban").get_json()["ok"] is True
    assert bob.post(f"/api/pl/servers/join/{code}").get_json()["error"] == "banned"

    assert client.post(f"/api/pl/servers/{sid}/members/{bob_uid}/unban").get_json()["ok"] is True
    assert bob.post(f"/api/pl/servers/join/{code}").get_json()["ok"] is True


def test_non_member_cannot_read_chat(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    cara = make_user(client, "cara")
    assert cara.get(f"/api/pl/chats/{cid}/messages").status_code == 404


def test_group_needs_name_and_mutual_members(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    assert client.post("/api/pl/chats/group", json={"name": "", "members": ["bob"]}).status_code == 400
    j = client.post("/api/pl/chats/group", json={"name": "Crew", "members": ["bob"]}).get_json()
    assert j["ok"]
    view = client.get(f"/freunde/c/{j['chat_id']}")
    assert view.status_code == 200 and b"Crew" in view.data
    # optimised group view: empty-state placeholder + stacked member avatars
    assert b"pl-chat-empty" in view.data and b"pl-chat-members" in view.data
    assert b"Noch keine Nachrichten" in view.data


def test_mutuals_endpoint_lists_only_mutuals(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    make_user(client, "cara")
    client.post("/api/pl/follow/bob")
    client.post("/api/pl/follow/cara")
    bob.post("/api/pl/follow/alice")  # only bob reciprocates
    users = client.get("/api/pl/mutuals").get_json()["users"]
    assert [u["username"] for u in users] == ["bob"]


def test_profile_page_shows_follow_button(client):
    signup(client, "alice")
    make_user(client, "bob")
    r = client.get("/freunde/u/bob")
    assert r.status_code == 200 and b"plFollowBtn" in r.data
    assert client.get("/freunde/u/ghost").status_code == 404


def test_display_name_editable_and_shown_instead_of_handle(client):
    signup(client, "alice")
    # own profile has the edit sheet
    assert b"plEditProfileSheet" in client.get("/freunde/u/alice").data
    # set a Spitzname
    r = client.post("/api/pl/profile", data={"display_name": "Alice Wunder"},
                    content_type="multipart/form-data")
    assert r.get_json()["display_name"] == "Alice Wunder"
    # it now shows big on the profile page, @handle stays as the small handle
    body = client.get("/freunde/u/alice").data
    assert b"Alice Wunder" in body and b'id="plProfName"' in body and b"@alice" in body


def test_home_page_shows_hexagonum_word(client):
    signup(client, "alice")
    assert b"HEXAGONUM" in client.get("/").data


def test_origin_settable_via_api(client):
    signup(client, "alice")
    r = client.post("/api/pl/profile/origin", json={"origin": "de"})
    assert r.get_json() == {"ok": True, "origin": "de"}


def test_dm_chat_title_uses_display_name(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    bob.post("/api/pl/profile", data={"display_name": "Bobby"}, content_type="multipart/form-data")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    view = client.get(f"/freunde/c/{cid}").data
    assert b"Bobby" in view and b"@bob" not in view.split(b"pl-chat-header")[1][:200]


# ---------------- attachments (photo / video under any text) ----------------

def test_upload_rejects_non_media(client):
    signup(client, "alice")
    data = {"file": (io.BytesIO(b"nope"), "note.txt")}
    r = client.post("/api/pl/upload", data=data, content_type="multipart/form-data")
    assert r.status_code == 400


# ---------------- text linkification (hashtags / mentions / URLs) ----------------

def test_hashtags_and_mentions_are_linked(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    r = client.post(f"/api/pl/chats/{cid}/messages", json={"text": "hi @bob check #test"})
    html = r.get_json()["message"]["text_html"]
    assert 'class="pl-hashtag"' in html and 'href="/?q=%23test"' in html
    assert 'class="pl-mention"' in html and 'href="/freunde/u/bob"' in html


def test_urls_render_as_pink_preview_links(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    r = client.post(f"/api/pl/chats/{cid}/messages", json={"text": "schau https://example.com/x"})
    html = r.get_json()["message"]["text_html"]
    assert "pl-link" in html and 'data-pl-preview="https://example.com/x"' in html


def test_messages_list_every_mutual(client):
    bob = make_user(client, "bob")
    signup(client, "alice")
    # alice <-> bob become mutuals, no chat created yet
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    body = client.get("/").data
    assert b"bob" in body and b"@bob" in body
    # the row opens (creates) the DM directly
    r = client.get("/freunde/dm/bob", follow_redirects=False)
    assert r.status_code == 302 and "/freunde/c/" in r.headers["Location"]
    chat_id = int(r.headers["Location"].rsplit("/", 1)[-1])
    # empty chat still shows the other person's @handle, not a generic label
    assert b"@bob" in client.get("/").data
    # once someone writes, the preview becomes "Name: text" -- even for a
    # 1:1 chat, and even when *you* wrote the last message
    client.post(f"/api/pl/chats/{chat_id}/messages", json={"text": "hallo!"})
    body2 = client.get("/").data.decode("utf-8")
    assert "alice: hallo!" in body2.lower()


def test_profile_images_persist_in_db(client):
    import io as _io
    signup(client, "alice")
    png = (b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    r = client.post("/api/pl/profile", data={
        "avatar": (_io.BytesIO(png), "a.png"),
        "banner": (_io.BytesIO(png), "b.png"),
    }, content_type="multipart/form-data").get_json()
    assert r["ok"] is True
    assert r["avatar_url"].startswith("/plm/") and r["banner_url"].startswith("/plm/")
    # the bytes come back from the persistent store, not local disk
    got = client.get(r["avatar_url"])
    assert got.status_code == 200 and got.data == png
    # and a PlMedia row actually exists
    from models import PlMedia
    with flask_app.app_context():
        assert PlMedia.query.count() >= 2


def test_pl_upload_is_served_from_store(client):
    import io as _io
    signup(client, "alice")
    r = client.post("/api/pl/upload", data={
        "file": (_io.BytesIO(b"GIF89a" + b"\x00" * 32), "x.gif"),
    }, content_type="multipart/form-data").get_json()
    assert r["ok"] and r["kind"] == "image"
    assert client.get(r["url"]).status_code == 200


# ---------------- stories ----------------
def _gif():
    import io as _io
    return _io.BytesIO(b"GIF89a" + b"\x00" * 32)


def _post_story(client, caption=None):
    data = {"media": (_gif(), "story.gif")}
    if caption is not None:
        data["caption"] = caption
    return client.post("/api/pl/stories", data=data, content_type="multipart/form-data").get_json()


def test_story_create_appears_for_self(client):
    signup(client, "alice")
    r = _post_story(client, caption="hi")
    assert r["ok"] is True
    assert r["story"]["caption"] == "hi"
    assert r["story"]["is_mine"] is True
    assert r["story"]["viewed_by_me"] is False

    listing = client.get("/api/pl/stories").get_json()
    assert listing["ok"] is True
    assert listing["mine"]["username"] == "alice"
    assert [s["caption"] for s in listing["mine"]["stories"]] == ["hi"]
    assert listing["friends"] == []


def test_story_requires_media_file(client):
    signup(client, "alice")
    r = client.post("/api/pl/stories", data={}, content_type="multipart/form-data").get_json()
    assert r == {"ok": False, "error": "no_file"}


def test_story_rejects_bad_file_type(client):
    import io as _io
    signup(client, "alice")
    r = client.post("/api/pl/stories", data={
        "media": (_io.BytesIO(b"not an image"), "x.txt"),
    }, content_type="multipart/form-data").get_json()
    assert r == {"ok": False, "error": "bad_type"}


def test_story_not_visible_without_mutual_follow(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob")  # one-way only
    _post_story(bob)
    listing = client.get("/api/pl/stories").get_json()
    assert listing["friends"] == []


def test_story_visible_to_mutual_and_view_marks_seen(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    story = _post_story(bob)["story"]

    listing = client.get("/api/pl/stories").get_json()
    assert len(listing["friends"]) == 1
    assert listing["friends"][0]["username"] == "bob"
    assert listing["friends"][0]["all_seen"] is False
    assert listing["friends"][0]["stories"][0]["viewed_by_me"] is False

    r = client.post(f"/api/pl/stories/{story['id']}/view")
    assert r.get_json()["ok"] is True

    listing2 = client.get("/api/pl/stories").get_json()
    assert listing2["friends"][0]["all_seen"] is True
    assert listing2["friends"][0]["stories"][0]["viewed_by_me"] is True


def test_story_view_is_idempotent(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    story = _post_story(bob)["story"]
    client.post(f"/api/pl/stories/{story['id']}/view")
    client.post(f"/api/pl/stories/{story['id']}/view")
    from models import PlStoryView
    with flask_app.app_context():
        assert PlStoryView.query.filter_by(story_id=story["id"]).count() == 1


def test_story_viewers_only_visible_to_owner(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    story = _post_story(client)["story"]
    bob.post(f"/api/pl/stories/{story['id']}/view")

    forbidden = bob.get(f"/api/pl/stories/{story['id']}/viewers").get_json()
    assert forbidden == {"ok": False, "error": "forbidden"}

    mine = client.get(f"/api/pl/stories/{story['id']}/viewers").get_json()
    assert mine["ok"] is True
    assert [v["username"] for v in mine["viewers"]] == ["bob"]


def test_story_delete_only_by_owner(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    story = _post_story(client)["story"]

    forbidden = bob.delete(f"/api/pl/stories/{story['id']}")
    assert forbidden.get_json() == {"ok": False, "error": "forbidden"}

    ok = client.delete(f"/api/pl/stories/{story['id']}")
    assert ok.get_json() == {"ok": True}
    assert client.get("/api/pl/stories").get_json()["mine"] is None


def test_expired_story_is_excluded(client):
    signup(client, "alice")
    story = _post_story(client)["story"]
    from datetime import datetime, timedelta, timezone
    from models import PlStory
    with flask_app.app_context():
        row = db.session.get(PlStory, story["id"])
        row.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.session.commit()
    assert client.get("/api/pl/stories").get_json()["mine"] is None
