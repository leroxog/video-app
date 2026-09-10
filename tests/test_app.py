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
    ("/spiele", b"Wir arbeiten dran!"),
    ("/videos", b"plVidFeed"),
])
def test_pages_render_for_logged_in_user(client, path, label):
    signup(client, "alice")
    r = client.get(path)
    assert r.status_code == 200 and label in r.data


def test_bottom_nav_present_on_every_tab(client):
    signup(client, "alice")
    for path in ("/", "/freunde", "/nex", "/spiele", "/videos"):
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


# ---------------- Spiele ----------------

def test_spiele_hub_shows_coming_soon(client):
    signup(client, "alice")
    r = client.get("/spiele").data
    assert b"Wir arbeiten dran!" in r


@pytest.mark.parametrize("slug", ["block-blast", "dress-up", "help-them", "phone-case", "subway-surfers", "triko-design"])
def test_each_game_page_loads(client, slug):
    signup(client, "alice")
    r = client.get(f"/spiele/{slug}")
    assert r.status_code == 200 and b"g-back" in r.data


def test_unknown_game_404s(client):
    signup(client, "alice")
    assert client.get("/spiele/nope").status_code == 404


# ---------------- attachments (photo / video / game under any text) ----------------

def test_games_list_endpoint(client):
    signup(client, "alice")
    j = client.get("/api/pl/games").get_json()
    slugs = {g["slug"] for g in j["games"]}
    assert {"block-blast", "subway-surfers"} <= slugs


def test_post_can_carry_a_playable_game(client):
    signup(client, "alice")
    j = client.post("/api/pl/posts", json={
        "heading": "Zock das", "att_kind": "game", "att_value": "block-blast",
    }).get_json()
    assert j["ok"] and j["post"]["attachment"]["kind"] == "game"
    assert b'iframe' in client.get("/").data and b"/spiele/block-blast" in client.get("/").data


def test_post_rejects_unknown_game_slug_but_still_posts(client):
    signup(client, "alice")
    j = client.post("/api/pl/posts", json={
        "heading": "Kein Spiel", "att_kind": "game", "att_value": "does-not-exist",
    }).get_json()
    assert j["ok"] and j["post"]["attachment"] is None


def test_comment_and_message_accept_game_attachment(client):
    signup(client, "alice")
    bob = make_user(client, "bob")
    client.post("/api/pl/follow/bob"); bob.post("/api/pl/follow/alice")
    pid = client.post("/api/pl/posts", json={"heading": "P"}).get_json()["post"]["id"]
    c = client.post(f"/api/pl/posts/{pid}/comments", json={
        "body": "", "att_kind": "game", "att_value": "dress-up",
    }).get_json()
    assert c["ok"] and c["comment"]["attachment"]["value"] == "dress-up"
    cid = client.post("/api/pl/chats/dm/bob").get_json()["chat_id"]
    m = client.post(f"/api/pl/chats/{cid}/messages", json={
        "text": "", "att_kind": "game", "att_value": "help-them",
    }).get_json()
    assert m["ok"] and m["message"]["attachment"]["kind"] == "game"


def test_upload_rejects_non_media(client):
    signup(client, "alice")
    data = {"file": (io.BytesIO(b"nope"), "note.txt")}
    r = client.post("/api/pl/upload", data=data, content_type="multipart/form-data")
    assert r.status_code == 400
