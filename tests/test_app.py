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
from models import User, FeedPost, FeedLike, FeedComment, FeedPS


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    flask_app.config["UPLOAD_FOLDER"] = tempfile.mkdtemp()
    flask_app.config["PROFILE_PIC_FOLDER"] = tempfile.mkdtemp()
    flask_app.config["SOUND_FOLDER"] = tempfile.mkdtemp()
    app_module._PL_RATE.clear()  # module-level rate-limit state leaks across tests otherwise
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
    r = client.post("/api/pl/posts", json={"heading": "hi"})
    assert r.status_code == 401 and r.get_json()["error"] == "not_logged_in"


# ---------------- avatar colors ----------------

def test_avatar_color_is_stable_and_in_palette(client):
    assert app_module.pl_avatar_color("alice") == app_module.pl_avatar_color("alice")
    assert app_module.pl_avatar_color("alice") in app_module.PL_AVATAR_PALETTE
    # case-insensitive, so "Alice" and "alice" always match visually elsewhere too
    assert app_module.pl_avatar_color("Alice") == app_module.pl_avatar_color("alice")


def test_feed_avatar_uses_the_same_color_as_the_api(client):
    signup(client, "alice")
    client.post("/api/pl/posts", json={"heading": "hi"})
    color = app_module.pl_avatar_color("alice")
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


# ---------------- feed ----------------

def test_create_post_appears_in_feed(client):
    signup(client, "alice")
    r = client.post("/api/pl/posts", json={"heading": "Mein Post", "body": "Hallo Welt"})
    j = r.get_json()
    assert j["ok"] and j["post"]["heading"] == "Mein Post"
    assert b"Mein Post" in client.get("/").data


def test_create_post_requires_heading(client):
    signup(client, "alice")
    assert client.post("/api/pl/posts", json={"heading": "  "}).status_code == 400


def test_like_toggles(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "P"}).get_json()["post"]["id"]
    a = client.post(f"/api/pl/posts/{pid}/like").get_json()
    assert a["liked"] is True and a["like_count"] == 1
    b = client.post(f"/api/pl/posts/{pid}/like").get_json()
    assert b["liked"] is False and b["like_count"] == 0


def test_share_increments(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "P"}).get_json()["post"]["id"]
    assert client.post(f"/api/pl/posts/{pid}/share").get_json()["share_count"] == 1
    assert client.post(f"/api/pl/posts/{pid}/share").get_json()["share_count"] == 2


def test_ps_only_once_and_only_own(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "P"}).get_json()["post"]["id"]
    assert client.post(f"/api/pl/posts/{pid}/ps", json={"body": "Nachtrag"}).get_json()["ok"] is True
    assert client.post(f"/api/pl/posts/{pid}/ps", json={"body": "noch was"}).status_code == 409
    bob = make_user(client, "bob")
    assert bob.post(f"/api/pl/posts/{pid}/ps", json={"body": "fremd"}).status_code == 403


def test_ps_renders_on_post(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "P"}).get_json()["post"]["id"]
    client.post(f"/api/pl/posts/{pid}/ps", json={"body": "Ein Nachtrag hier"})
    body = client.get("/").data
    assert b"Ein Nachtrag hier" in body
    # P.S. is its own separate card, not inside the post article
    assert b"pl-ps-card" in body
    # inline comments panel (no bottom-sheet) + comment toggle button
    assert b'class="pl-comments"' in body and b"data-comments-toggle" in body
    assert b'id="plCommentsSheet"' not in body


def test_comments_create_list_reply_and_like(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "P"}).get_json()["post"]["id"]
    c1 = client.post(f"/api/pl/posts/{pid}/comments", json={"body": "top"}).get_json()["comment"]
    client.post(f"/api/pl/posts/{pid}/comments", json={"body": "reply", "parent_id": c1["id"]})
    lst = client.get(f"/api/pl/posts/{pid}/comments").get_json()["comments"]
    assert [c["body"] for c in lst] == ["top", "reply"]
    assert lst[1]["parent_id"] == c1["id"]
    like = client.post(f"/api/pl/comments/{c1['id']}/like").get_json()
    assert like["liked"] is True and like["like_count"] == 1


def test_reply_to_reply_collapses_to_top_thread(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "P"}).get_json()["post"]["id"]
    c1 = client.post(f"/api/pl/posts/{pid}/comments", json={"body": "top"}).get_json()["comment"]
    r1 = client.post(f"/api/pl/posts/{pid}/comments", json={"body": "r1", "parent_id": c1["id"]}).get_json()["comment"]
    r2 = client.post(f"/api/pl/posts/{pid}/comments", json={"body": "r2", "parent_id": r1["id"]}).get_json()["comment"]
    assert r2["parent_id"] == c1["id"]


def test_search_filters_feed(client):
    signup(client, "alice")
    client.post("/api/pl/posts", json={"heading": "Kuchen backen"})
    client.post("/api/pl/posts", json={"heading": "Auto waschen"})
    res = client.get("/?q=kuchen").data
    assert b"Kuchen backen" in res and b"Auto waschen" not in res
    assert "Videos zu „kuchen".encode() in res  # video placeholder row shows


def test_feed_is_shared_across_users(client):
    signup(client, "alice")
    client.post("/api/pl/posts", json={"heading": "Alices Post"})
    bob = make_user(client, "bob")
    assert b"Alices Post" in bob.get("/").data


# ---------------- shell / pages ----------------

@pytest.mark.parametrize("path,label", [
    ("/", b"Posts & Videos suchen"),
    ("/freunde", b"Freunde"),
    ("/nex", b"nxMsgs"),
    ("/videos", b"plVidFeed"),
])
def test_pages_render_for_logged_in_user(client, path, label):
    signup(client, "alice")
    r = client.get(path)
    assert r.status_code == 200 and label in r.data


def test_bottom_nav_present_on_every_tab(client):
    signup(client, "alice")
    for path in ("/", "/freunde", "/nex", "/videos"):
        data = client.get(path).data
        assert b'class="pl-nav"' in data
        # desktop-sidebar "POSTEN" pill (hidden on mobile via CSS)
        assert b'pl-nav-post' in data and b'compose=1' in data


def test_videos_tab_is_a_vertical_feed(client):
    signup(client, "alice")
    r = client.get("/videos").data
    # TikTok-style vertical video feed (empty until someone uploads a video)
    assert b"plVidFeed" in r and b"pinklemon-videos.js" in r
    assert "Noch keine Videos".encode() in r


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
    # it now shows in the feed for her posts, @handle stays as the small handle
    client.post("/api/pl/posts", json={"heading": "Hi"})
    body = client.get("/").data
    assert b"Alice Wunder" in body and b"pl-post-handle" in body and b"@alice" in body


def test_topbrand_shows_hexagonum_word_and_try_fallback(client):
    signup(client, "alice")
    body = client.get("/").data
    assert b"HEXAGONUM" in body and b">TRY<" in body


def test_origin_badge_settable_and_shown(client):
    signup(client, "alice")
    r = client.post("/api/pl/profile/origin", json={"origin": "de"})
    assert r.get_json() == {"ok": True, "origin": "de"}
    assert b">de<" in client.get("/").data
    # clearing it falls back to TRY again
    client.post("/api/pl/profile/origin", json={"origin": "  "})
    assert b">TRY<" in client.get("/").data


def test_dm_chat_title_uses_display_name(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    bob.post("/api/pl/profile", data={"display_name": "Bobby"}, content_type="multipart/form-data")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    view = client.get(f"/freunde/c/{cid}").data
    assert b"Bobby" in view and b"@bob" not in view.split(b"pl-chat-header")[1][:200]


# ---------------- Nex (single AI) ----------------

def test_nex_page_is_a_text_chat(client):
    signup(client, "alice")
    r = client.get("/nex").data
    # ChatGPT-style text chat -- message list + composer, no voice orb
    assert b"nxMsgs" in r and b"nxInput" in r and b"pinklemon-nex.js" in r
    assert b"three.min.js" not in r and b"nxCanvas" not in r
    assert b"Ehrgeizig" not in r and b"Chaos" not in r


def test_nex_chat_uses_the_blunt_nex_prompt(client, monkeypatch):
    import ai_assistant
    seen = {}
    monkeypatch.setattr(ai_assistant, "_call_model_with_router", lambda messages, *a, **k: (seen.setdefault("sp", messages[0]["content"]), None))
    signup(client, "alice")
    r = client.post("/api/ai/chat", json={"message": "wer bist du", "character": "nex7", "project_type": "nexblunt"})
    assert r.get_json()["ok"] is True
    import time
    for _ in range(30):
        if "sp" in seen:
            break
        time.sleep(0.05)
    assert "Du bist Nex" in seen["sp"] and "7Ai" not in seen["sp"]


def test_nex_sees_the_users_activity(client, monkeypatch):
    import ai_assistant
    seen = {}
    monkeypatch.setattr(ai_assistant, "_call_model_with_router",
                        lambda messages, *a, **k: (seen.setdefault("user", messages[-1]["content"]), None))
    signup(client, "alice")
    client.post("/api/pl/posts", json={"heading": "Mein geheimer Lieblingspost"})
    client.post("/api/ai/chat", json={"message": "hi", "character": "nex7", "project_type": "nexblunt"})
    import time
    for _ in range(40):
        if "user" in seen:
            break
        time.sleep(0.05)
    # the activity digest (with the user's post) is prepended to the message Nex gets
    assert "Mein geheimer Lieblingspost" in seen["user"]
    assert "Aktivität von" in seen["user"]


def test_nex_never_volunteers_activity_unless_explicitly_asked(client):
    """Regression: the digest/prompt used to also allow bringing up activity
    when it "100% matched" the current message -- that loophole is what let
    Nex greet a plain "moin" with an unsolicited rundown of the user's
    recent posts. Only an explicit ask may trigger it now."""
    import ai_assistant
    signup(client, "alice")
    with flask_app.app_context():
        digest = app_module._pl_user_activity_digest(User.query.filter_by(username="alice").first())
    assert "100%" not in digest and "passt" not in digest
    assert "explizit" in digest
    assert "100%" not in ai_assistant.NEX_BLUNT_SYSTEM_PROMPT


def test_nex_settings_set_and_clear(client):
    signup(client, "alice")
    r = client.post("/api/pl/nex/settings", json={
        "name": "Tom", "personality": "sehr freundlich und hilfsbereit", "act": "ein Ritter im Mittelalter",
    }).get_json()
    assert r == {"ok": True, "name": "Tom", "personality": "sehr freundlich und hilfsbereit",
                 "act": "ein Ritter im Mittelalter"}
    # empty string clears a single field back to default
    r2 = client.post("/api/pl/nex/settings", json={"act": ""}).get_json()
    assert r2["name"] == "Tom" and r2["act"] is None
    # reset_all clears everything at once
    r3 = client.post("/api/pl/nex/settings", json={"reset_all": True}).get_json()
    assert r3 == {"ok": True, "name": "Nex", "personality": None, "act": None}


def test_nex_page_reflects_custom_name(client):
    signup(client, "alice")
    assert b">Nex<" in client.get("/nex").data
    client.post("/api/pl/nex/settings", json={"name": "Tom"})
    body = client.get("/nex").data
    assert b">Tom<" in body and b"Hello, I'm Tom" in body


def test_nex_prompt_includes_slash_overrides(client, monkeypatch):
    import ai_assistant
    seen = {}
    monkeypatch.setattr(ai_assistant, "_call_model_with_router",
                        lambda messages, *a, **k: (seen.setdefault("user", messages[-1]["content"]), None))
    signup(client, "alice")
    client.post("/api/pl/nex/settings", json={
        "name": "Tom", "personality": "extrem hoeflich", "act": "ein Pirat",
    })
    client.post("/api/ai/chat", json={"message": "hi", "character": "nex7", "project_type": "nexblunt"})
    import time
    for _ in range(40):
        if "user" in seen:
            break
        time.sleep(0.05)
    assert 'Tom' in seen["user"] and "extrem hoeflich" in seen["user"] and "ein Pirat" in seen["user"]
    assert "ANWEISUNGEN VOM NUTZER" in seen["user"]


def test_nex_code_question_heuristic():
    import ai_assistant
    assert ai_assistant._looks_like_code_question("wie schreibe ich eine funktion in python?")
    assert ai_assistant._looks_like_code_question("ich hab einen bug in meinem javascript code")
    assert ai_assistant._looks_like_code_question("```\nprint(1)\n```")
    assert not ai_assistant._looks_like_code_question("hallo, wie geht's dir?")
    assert not ai_assistant._looks_like_code_question("was hältst du von meinem neuen profilbild")


def test_nex_uses_code_model_for_programming_questions(client, monkeypatch):
    import ai_assistant
    seen = {}
    monkeypatch.setattr(ai_assistant, "_classify_tool", lambda *a, **k: (None, {}))
    monkeypatch.setattr(ai_assistant, "_generate_groq",
                        lambda messages, max_tokens, temperature=0.7, model=None:
                            (seen.setdefault("calls", []).append(model), "Testantwort")[1])
    signup(client, "alice")

    client.post("/api/ai/chat", json={"message": "hallo", "character": "nex7", "project_type": "nexblunt"})
    import time
    for _ in range(40):
        if seen.get("calls"):
            break
        time.sleep(0.05)
    assert seen["calls"][-1] is None  # plain chat stays on the small default model

    client.post("/api/ai/chat", json={
        "message": "kannst du mir bei einem bug in meiner python funktion helfen?",
        "character": "nex7", "project_type": "nexblunt",
    })
    for _ in range(40):
        if len(seen.get("calls", [])) > 1:
            break
        time.sleep(0.05)
    assert seen["calls"][-1] == ai_assistant.GROQ_CODE_MODEL


def test_for_you_feed_ranks_followed_authors_up(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    cara = make_user(client, "cara")
    # cara posts first (older), bob posts later; alice follows bob
    for i in range(3):
        cara.post("/api/pl/posts", json={"heading": f"cara {i}"})
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/posts", json={"heading": "bob followed post"})
    html = client.get("/").data.decode()
    # bob's post (followed) should land above the older cara posts
    assert html.index("bob followed post") < html.index("cara 0")
    # "Folge ich" is still plain chronological-from-follows
    foll = client.get("/?feed=following").data.decode()
    assert "bob followed post" in foll and "cara 0" not in foll


def test_nex_page_has_plugins_button(client):
    signup(client, "alice")
    r = client.get("/nex").data
    assert b'id="nxPluginsBtn"' in r and b'id="nxPluginsMenu"' in r


def test_nex_plugins_list_default_all_off(client):
    signup(client, "alice")
    j = client.get("/api/pl/nex/plugins").get_json()
    assert j["ok"] is True
    keys = {p["key"] for p in j["plugins"]}
    assert keys == {"qwen", "gptoss", "llama"}
    assert all(not p["enabled"] for p in j["plugins"])


def test_nex_plugins_toggle_on_and_off(client):
    signup(client, "alice")
    r = client.post("/api/pl/nex/plugins", json={"key": "llama", "enabled": True})
    j = r.get_json()
    assert j["ok"] is True
    assert {p["key"]: p["enabled"] for p in j["plugins"]}["llama"] is True
    # persists across requests
    j2 = client.get("/api/pl/nex/plugins").get_json()
    assert {p["key"]: p["enabled"] for p in j2["plugins"]}["llama"] is True

    r3 = client.post("/api/pl/nex/plugins", json={"key": "llama", "enabled": False})
    j3 = r3.get_json()
    assert {p["key"]: p["enabled"] for p in j3["plugins"]}["llama"] is False


def test_nex_plugins_rejects_unknown_key(client):
    signup(client, "alice")
    r = client.post("/api/pl/nex/plugins", json={"key": "chatgpt", "enabled": True})
    assert r.status_code == 400 and r.get_json()["ok"] is False


def test_nex_plugin_council_merges_answers_and_lists_contributors(client, monkeypatch):
    import ai_assistant

    monkeypatch.setattr(ai_assistant, "_classify_tool", lambda *a, **k: (None, {}))

    def fake_generate(messages, max_tokens, temperature=0.7, model=None):
        if model == ai_assistant.GROQ_FALLBACK_MODEL:
            return "GPT-OSS-Antwort"
        if model == "llama-3.3-70b-versatile":
            return "Llama-Antwort"
        return "Finale Nex-Antwort"

    monkeypatch.setattr(ai_assistant, "_generate_groq", fake_generate)
    signup(client, "alice")
    client.post("/api/pl/nex/plugins", json={"key": "gptoss", "enabled": True})
    client.post("/api/pl/nex/plugins", json={"key": "llama", "enabled": True})

    r = client.post("/api/ai/chat", json={"message": "was ist 2+2?", "character": "nex7", "project_type": "nexblunt"})
    job_id = r.get_json()["job_id"]
    import time
    j = None
    for _ in range(60):
        j = client.get(f"/api/ai/chat/{job_id}").get_json()
        if j["status"] != "running":
            break
        time.sleep(0.05)
    assert j["status"] == "done"
    assert j["reply"] == "Finale Nex-Antwort"
    assert set(j["contributors"]) == {"Nex", "GPT-OSS", "Llama"}


def test_nex_no_contributors_when_no_plugins_enabled(client, monkeypatch):
    import ai_assistant
    monkeypatch.setattr(ai_assistant, "_classify_tool", lambda *a, **k: (None, {}))
    monkeypatch.setattr(ai_assistant, "_generate_groq", lambda *a, **k: "Nur Nex")
    signup(client, "alice")
    r = client.post("/api/ai/chat", json={"message": "hallo", "character": "nex7", "project_type": "nexblunt"})
    job_id = r.get_json()["job_id"]
    import time
    j = None
    for _ in range(60):
        j = client.get(f"/api/ai/chat/{job_id}").get_json()
        if j["status"] != "running":
            break
        time.sleep(0.05)
    assert j["status"] == "done" and j["contributors"] is None


def test_nex_page_has_call_button_and_overlay(client):
    signup(client, "alice")
    r = client.get("/nex").data
    assert b'id="nxCallBtn"' in r and b'id="nxCallOverlay"' in r and b'id="nxCallOrbWrap"' in r
    # starts hidden behind the send arrow -- only shows once the composer is empty (JS)
    assert b'id="nxCallBtn" type="button" aria-label="Nex anrufen" hidden' in r


def test_nex_voice_endpoint_rejects_missing_audio(client):
    signup(client, "alice")
    r = client.post("/api/pl/nex/voice")
    assert r.status_code == 400 and r.get_json()["ok"] is False


def test_nex_voice_endpoint_transcribes_with_whisper(client, monkeypatch):
    import ai_assistant
    monkeypatch.setattr(ai_assistant, "transcribe_audio", lambda *a, **k: "hallo nex")
    signup(client, "alice")
    data = {"audio": (io.BytesIO(b"x" * 4000), "speech.webm")}
    r = client.post("/api/pl/nex/voice", data=data, content_type="multipart/form-data")
    j = r.get_json()
    assert j["ok"] is True and j["transcript"] == "hallo nex"


# ---------------- attachments (photo / video under any text) ----------------

def test_games_are_gone(client):
    signup(client, "alice")
    # no Spiele tab, no game routes, no game attachments
    assert client.get("/spiele").status_code == 404
    assert client.get("/api/pl/games").status_code == 404
    assert b'aria-label="Spiele"' not in client.get("/").data
    j = client.post("/api/pl/posts", json={
        "heading": "kein Spiel", "att_kind": "game", "att_value": "block-blast",
    }).get_json()
    assert j["ok"] and j["post"]["attachment"] is None


def test_upload_rejects_non_media(client):
    signup(client, "alice")
    data = {"file": (io.BytesIO(b"nope"), "note.txt")}
    r = client.post("/api/pl/upload", data=data, content_type="multipart/form-data")
    assert r.status_code == 400


# ---------------- new feed features ----------------

def test_hashtags_and_mentions_are_linked(client):
    signup(client, "alice")
    make_user(client, "bob")
    client.post("/api/pl/posts", json={"heading": "T", "body": "hi @bob check #test"})
    html = client.get("/").data
    assert b'class="pl-hashtag"' in html and b'href="/?q=%23test"' in html
    assert b'class="pl-mention"' in html and b'href="/freunde/u/bob"' in html


def test_edit_and_delete_own_post(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "orig"}).get_json()["post"]["id"]
    e = client.patch(f"/api/pl/posts/{pid}", json={"heading": "geändert"}).get_json()
    assert e["ok"] and e["post"]["heading"] == "geändert" and e["post"]["edited"]
    bob = make_user(client, "bob")
    assert bob.patch(f"/api/pl/posts/{pid}", json={"heading": "x"}).status_code == 403
    assert bob.delete(f"/api/pl/posts/{pid}").status_code == 403
    assert client.delete(f"/api/pl/posts/{pid}").get_json()["ok"]
    assert client.get(f"/p/{pid}").status_code == 404


def test_repost_pin_and_poll(client):
    signup(client, "alice")
    j = client.post("/api/pl/posts", json={
        "heading": "Umfrage", "poll": ["Ja", "Nein", "Vielleicht"],
    }).get_json()
    pid = j["post"]["id"]
    assert j["post"]["poll"]["options"] == ["Ja", "Nein", "Vielleicht"]
    v = client.post(f"/api/pl/posts/{pid}/poll-vote", json={"choice": 1}).get_json()
    assert v["ok"] and v["poll"]["counts"][1] == 1 and v["poll"]["my_vote"] == 1
    # plain repost toggles on, then off again
    r1 = client.post(f"/api/pl/posts/{pid}/repost", json={}).get_json()
    assert r1["reposted"] is True and r1["repost_count"] == 1
    r2 = client.post(f"/api/pl/posts/{pid}/repost", json={}).get_json()
    assert r2["reposted"] is False and r2["repost_count"] == 0
    # quote repost keeps it on and records the quote
    r3 = client.post(f"/api/pl/posts/{pid}/repost", json={"quote": "seht euch das an"}).get_json()
    assert r3["reposted"] is True and r3["quote"] is True
    assert client.post(f"/api/pl/posts/{pid}/pin").get_json()["pinned"] is True


def test_bookmarks_and_views_are_gone(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "x"}).get_json()["post"]["id"]
    assert client.get("/lesezeichen").status_code == 404
    assert client.post(f"/api/pl/posts/{pid}/bookmark").status_code == 404
    assert client.post(f"/api/pl/posts/{pid}/view").status_code == 404
    assert b"Aufrufe" not in client.get("/").data


def test_delete_keeps_reposts_alive(client):
    bob = make_user(client, "bob")
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "bleibt erhalten"}).get_json()["post"]["id"]
    # bob reposts it
    assert bob.post(f"/api/pl/posts/{pid}/repost", json={}).get_json()["reposted"] is True
    # alice deletes -> soft delete, row stays
    d = client.delete(f"/api/pl/posts/{pid}").get_json()
    assert d["ok"] is True and d["soft"] is True
    # gone from alice's normal feed
    assert b"bleibt erhalten" not in client.get("/?feed=neu").data
    # but bob still sees it on his reposts profile tab
    assert b"bleibt erhalten" in bob.get("/freunde/u/bob?tab=reposts").data
    # bob can drop his own repost
    assert bob.post(f"/api/pl/posts/{pid}/repost", json={}).get_json()["reposted"] is False


def test_hide_comment_is_followers_only(client):
    bob = make_user(client, "bob")
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "p"}).get_json()["post"]["id"]
    cid = client.post(f"/api/pl/posts/{pid}/comments", json={"body": "geheim"}).get_json()["comment"]["id"]
    assert client.post(f"/api/pl/comments/{cid}/hide").get_json()["hidden"] is True
    # bob (not a follower) can't see it
    seen = bob.get(f"/api/pl/posts/{pid}/comments").get_json()["comments"]
    assert all(c["body"] != "geheim" for c in seen)
    # alice (author) still sees her own
    mine = client.get(f"/api/pl/posts/{pid}/comments").get_json()["comments"]
    assert any(c["body"] == "geheim" and c["hidden"] for c in mine)


def test_profile_has_posts_reposts_likes_tabs(client):
    signup(client, "alice")
    client.post("/api/pl/posts", json={"heading": "meiner"})
    body = client.get("/freunde/u/alice").data
    assert b"Reposts" in body and b"Likes" in body
    assert client.get("/freunde/u/alice?tab=likes").status_code == 200
    assert client.get("/freunde/u/alice?tab=reposts").status_code == 200


def test_not_interested_hides_post(client):
    signup(client, "alice")
    pid = client.post("/api/pl/posts", json={"heading": "nervt"}).get_json()["post"]["id"]
    assert client.post(f"/api/pl/posts/{pid}/not-interested").get_json()["ok"] is True
    assert b"nervt" not in client.get("/?feed=neu").data


def test_urls_render_as_pink_preview_links(client):
    signup(client, "alice")
    client.post("/api/pl/posts", json={"heading": "link", "body": "schau https://example.com/x"})
    body = client.get("/").data
    assert b"pl-link" in body and b'data-pl-preview="https://example.com/x"' in body


def test_app_install_promo_every_fifth_post(client):
    signup(client, "alice")
    for i in range(11):
        client.post("/api/pl/posts", json={"heading": f"p{i}"})
    body = client.get("/?feed=neu").data
    assert b"Hohl dir unsere App" in body
    assert body.count(b"pl-promo") >= 2  # at least two promo cards for 11 posts


def test_messages_list_every_mutual(client):
    bob = make_user(client, "bob")
    signup(client, "alice")
    # alice <-> bob become mutuals, no chat created yet
    client.post("/api/pl/follow/bob")
    bob.post("/api/pl/follow/alice")
    body = client.get("/freunde").data
    assert b"bob" in body and b"@bob" in body
    # the row opens (creates) the DM directly
    r = client.get("/freunde/dm/bob", follow_redirects=False)
    assert r.status_code == 302 and "/freunde/c/" in r.headers["Location"]
    chat_id = int(r.headers["Location"].rsplit("/", 1)[-1])
    # empty chat still shows the other person's @handle, not a generic label
    assert b"@bob" in client.get("/freunde").data
    # once someone writes, the preview becomes "Name: text" -- even for a
    # 1:1 chat, and even when *you* wrote the last message
    client.post(f"/api/pl/chats/{chat_id}/messages", json={"text": "hallo!"})
    body2 = client.get("/freunde").data.decode("utf-8")
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


def test_new_feed_tab_and_pagination(client):
    signup(client, "alice")
    for i in range(3):
        client.post("/api/pl/posts", json={"heading": f"post {i}"})
    body = client.get("/?feed=neu").data
    assert b"post 2" in body and b'?feed=neu' in body
    # ?before cursor filters to older ids
    j2 = client.get("/?feed=neu&before=2").data
    assert b"post 0" in j2 and b"post 2" not in j2
