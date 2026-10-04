"""yipi: accounts, Yips (posts, replies, quotes, reposts), likes, bookmarks, pictures, feeds, profiles, following,
blocking and muting, search, trends, notifications, private messages, reports and moderation -- through the JSON API."""
import os
import re
import struct
import sys
import tempfile
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402


@pytest.fixture(autouse=True)
def fast_passwords(monkeypatch, request):
    """Hashing passwords on purpose takes a while; the tests use a stand-in (one test checks the real thing)."""
    if "real_hashing" in request.keywords:
        return
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)


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


PASSWORD = "correct horse battery"


def call(client, method, path, body=None, **kwargs):
    if body is None and method in ("post", "patch", "put"):
        body = {}
    return getattr(client, method)(path, json=body, **kwargs) if body is not None else getattr(client, method)(path, **kwargs)


def api(client, method, path, body=None, status=None, **kwargs):
    r = call(client, method, f"/api/yipi{path}", body, **kwargs)
    if status is not None:
        assert r.status_code == status, (path, r.status_code, r.get_json())
    return r.get_json()


def signup(client, handle="mia", **changes):
    body = {"handle": handle, "password": PASSWORD, "adult": True, **changes}
    r = call(client, "post", "/api/yipi/signup", body)
    assert r.status_code == 200, r.get_json()
    return r.get_json()["me"]


def person(handle, **changes):
    """A new browser, signed up as `handle`."""
    c = flask_app.test_client()
    signup(c, handle, **changes)
    return c


def yip(client, text="Hallo yipi", status=201, **extra):
    data = api(client, "post", "/posts", {"text": text, **extra}, status=status)
    return data["post"] if status == 201 else data


def png(width=10, height=10):
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00" + b"\x00" * 20


def jpeg(width=10, height=10):
    return (b"\xff\xd8" + b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\xff\xc0\x00\x11\x08" + struct.pack(">HH", height, width)
            + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01" + b"\xff\xd9")


def gif(width=10, height=10):
    return b"GIF89a" + struct.pack("<HH", width, height) + b"\x00\x00\x00;"


def webp_lossless(width=10, height=10):
    return b"RIFF" + struct.pack("<I", 30) + b"WEBPVP8L" + struct.pack("<I", 10) + b"\x2f" + struct.pack("<I", (width - 1) | ((height - 1) << 14)) + b"\x00" * 6


def webp_extended(width=10, height=10):
    return b"RIFF" + struct.pack("<I", 30) + b"WEBPVP8X" + struct.pack("<I", 10) + b"\x00\x00\x00\x00" + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")


def upload(client, data, name="p.png", status=200, **form):
    import io
    r = client.post("/api/yipi/media", data={"file": (io.BytesIO(data), name), **form}, content_type="multipart/form-data")
    assert r.status_code == status, (r.status_code, r.get_json())
    return r.get_json()


def cookies(response):
    return response.headers.get_all("Set-Cookie")


# ========================================================================================== accounts
def test_signing_up_makes_the_account_and_signs_in(client):
    r = call(client, "post", "/api/yipi/signup", {"handle": "Mia_1", "name": "Mia Maus", "password": PASSWORD, "adult": True, "email": " Mia@Example.com "})
    me = r.get_json()["me"]
    assert r.status_code == 200 and me["handle"] == "Mia_1" and me["name"] == "Mia Maus" and me["email"] == "mia@example.com"
    assert me["followers"] == me["following"] == me["posts"] == 0 and me["isMe"] is True and me["isAdmin"] is False
    header = cookies(r)[0]
    assert header.startswith("yipi_session=") and "HttpOnly" in header and "SameSite=Lax" in header and "Path=/" in header
    assert api(client, "get", "/me")["me"]["handle"] == "Mia_1"


def test_the_name_defaults_to_the_handle_and_the_e_mail_is_optional(client):
    me = signup(client, "tim")
    assert me["name"] == "tim" and me["email"] == ""


@pytest.mark.parametrize("handle", ["ab", "a" * 16, "mia maus", "mia-maus", "mia.maus", "mía", "", None, 5, "@mia", "mia\n"])
def test_a_bad_handle_is_refused(client, handle):
    r = call(client, "post", "/api/yipi/signup", {"handle": handle, "password": PASSWORD, "adult": True})
    assert r.status_code == 400 and r.get_json()["error"] == "bad_handle" and cookies(r) == []


@pytest.mark.parametrize("handle", ["explore", "Notifications", "yipi", "admin", "login", "api", "gomat", "settings", "Messages"])
def test_reserved_handles_are_refused(client, handle):
    r = call(client, "post", "/api/yipi/signup", {"handle": handle, "password": PASSWORD, "adult": True})
    assert r.status_code == 400 and r.get_json()["error"] == "reserved_handle" and cookies(r) == []


def test_a_handle_can_only_be_taken_once_whatever_its_case(client):
    signup(client, "Mia")
    r = call(flask_app.test_client(), "post", "/api/yipi/signup", {"handle": "mIA", "password": PASSWORD, "adult": True})
    assert r.status_code == 409 and r.get_json()["error"] == "handle_taken"
    assert api(flask_app.test_client(), "get", "/handle?handle=MIA")["available"] is False
    assert api(flask_app.test_client(), "get", "/handle?handle=mia2")["available"] is True


def test_the_handle_check_tells_why(client):
    c = flask_app.test_client()
    assert api(c, "get", "/handle?handle=x")["reason"] == "format"
    assert api(c, "get", "/handle?handle=explore")["reason"] == "reserved"
    signup(client, "mia")
    assert api(c, "get", "/handle?handle=mia")["reason"] == "taken"
    assert api(c, "get", "/handle")["available"] is False


@pytest.mark.parametrize("password", ["", "short", "1234567", None, 12345678, "x" * 201])
def test_a_bad_password_is_refused(client, password):
    r = call(client, "post", "/api/yipi/signup", {"handle": "mia", "password": password, "adult": True})
    assert r.status_code == 400 and r.get_json()["error"] == "bad_password" and cookies(r) == []


def test_signing_up_needs_the_age_confirmation(client):
    for adult in (None, False, "yes", 1):
        r = call(client, "post", "/api/yipi/signup", {"handle": "mia", "password": PASSWORD, "adult": adult})
        assert r.status_code == 400 and r.get_json()["error"] == "need_age"


def test_an_e_mail_must_look_like_one_and_can_be_used_once(client):
    for email in ("mia", "mia@", "@example.com", "mia@example", "a b@example.com"):
        assert call(client, "post", "/api/yipi/signup", {"handle": "mia", "password": PASSWORD, "adult": True, "email": email}).get_json()["error"] == "bad_email"
    signup(client, "mia", email="mia@example.com")
    r = call(flask_app.test_client(), "post", "/api/yipi/signup", {"handle": "other", "password": PASSWORD, "adult": True, "email": "MIA@example.com"})
    assert r.status_code == 409 and r.get_json()["error"] == "email_taken"


def test_the_display_name_is_cleaned(client):
    me = signup(client, "mia", name="  Mia \n\t Maus\x07‮  ")
    assert me["name"] == "Mia Maus"
    assert signup(flask_app.test_client(), "tom", name="x" * 200)["name"] == "tom"        # too long: the handle instead


def test_a_signup_only_takes_json_never_a_web_form(client):
    r = client.post("/api/yipi/signup", data={"handle": "mia", "password": PASSWORD, "adult": "true"})
    assert r.status_code == 415 and cookies(r) == []
    assert yipi.YipiUser.query.count() == 0


@pytest.mark.real_hashing
def test_the_password_is_stored_only_as_a_hash(client):
    signup(client, "mia")
    user = yipi.YipiUser.query.one()
    assert PASSWORD not in user.password_hash and user.password_hash.startswith(("scrypt:", "pbkdf2:")) and user.check_password(PASSWORD)


def test_signing_in_by_handle_by_at_handle_or_by_e_mail(client):
    signup(client, "Mia", email="mia@example.com")
    for login in ("mia", "MIA", "@mia", "mia@example.com", " Mia@Example.com "):
        c = flask_app.test_client()
        r = call(c, "post", "/api/yipi/login", {"login": login, "password": PASSWORD})
        assert r.status_code == 200 and r.get_json()["me"]["handle"] == "Mia" and cookies(r), login
        assert api(c, "get", "/me")["me"]["handle"] == "Mia"


def test_a_wrong_password_and_an_unknown_name_look_the_same(client):
    signup(client, "mia")
    a = call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "mia", "password": "wrong password"})
    b = call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "nobody", "password": "wrong password"})
    assert a.status_code == b.status_code == 401 and a.get_json() == b.get_json() == {"ok": False, "error": "wrong_login"}
    assert cookies(a) == cookies(b) == []
    for body in ({}, {"login": "mia"}, {"login": "mia", "password": 5}, {"login": ["mia"], "password": "x"}, {"login": "x" * 400, "password": "y" * 400}):
        assert call(flask_app.test_client(), "post", "/api/yipi/login", body).status_code == 401


def test_guessing_passwords_is_stopped(client):
    signup(client, "mia")
    codes = [call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "mia", "password": f"guess {i}"}).status_code for i in range(yipi.LIMITS["login-name"][0] + 2)]
    assert codes[0] == 401 and codes[-1] == 429
    assert call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "mia", "password": PASSWORD}).status_code == 429


def test_signing_up_again_and_again_is_stopped(client):
    limit = yipi.LIMITS["signup-ip"][0]
    codes = [call(flask_app.test_client(), "post", "/api/yipi/signup", {"handle": f"user{i:03d}", "password": PASSWORD, "adult": True}).status_code for i in range(limit + 2)]
    assert codes[:limit] == [200] * limit and codes[-1] == 429


def test_signing_out_and_the_visitor_without_an_account(client):
    signup(client, "mia")
    out = call(client, "post", "/api/yipi/logout")
    assert out.get_json() == {"ok": True} and "Expires=Thu, 01 Jan 1970" in cookies(out)[0]
    assert api(client, "get", "/me")["me"] is None
    guest = flask_app.test_client()
    for path in ("/", "/explore", "/api/yipi/me", "/api/yipi/timeline", "/api/yipi/trends", "/api/yipi/suggestions", "/mia", "/api/yipi/users/mia", "/api/yipi/handle?handle=x"):
        assert cookies(guest.get(path)) == [], path
    assert cookies(call(guest, "post", "/api/yipi/logout")) == []


def test_the_sign_in_cookie_cannot_be_forged_or_changed(client):
    from itsdangerous import URLSafeTimedSerializer
    signup(client, "mia")
    mine = client.get_cookie("yipi_session").value
    for forged in (URLSafeTimedSerializer("dev-secret-change-in-production", salt="yipi-account-v1").dumps({"uid": 1, "gen": 0}),
                   URLSafeTimedSerializer(flask_app.config["SECRET_KEY"], salt="yipi-account-v1").dumps({"uid": 1, "gen": 0}),
                   mine[:-3] + ("aaa" if not mine.endswith("aaa") else "bbb"), "x" + mine, mine[:20], "", "a.b.c"):
        stranger = flask_app.test_client()
        stranger.set_cookie("yipi_session", forged)
        assert api(stranger, "get", "/me")["me"] is None, forged
    gomat_cookie = URLSafeTimedSerializer(siteauth.secret("cookie:yipi_session"), salt="gomat-account-v1").dumps({"uid": 1, "gen": 0})
    stranger = flask_app.test_client()
    stranger.set_cookie("yipi_session", gomat_cookie)
    assert api(stranger, "get", "/me")["me"] is None                       # another part of the site cannot make a yipi sign-in either


def test_requests_from_other_sites_are_refused(client):
    signup(client, "mia")
    for path in ("/posts", "/logout", "/password", "/delete", "/reports"):
        r = client.post(f"/api/yipi{path}", json={"text": "x"}, headers={"Origin": "https://evil.example"})
        assert r.status_code == 403 and r.get_json()["error"] == "forbidden", path
    assert client.patch("/api/yipi/profile", json={"bio": "x"}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.delete("/api/yipi/posts/1", headers={"Origin": "https://evil.example"}).status_code == 403
    assert yipi.YipiPost.query.count() == 0
    assert client.post("/api/yipi/posts", json={"text": "fine"}, headers={"Origin": "http://localhost"}).status_code == 201


def test_changing_the_password_signs_the_other_devices_out(client):
    signup(client, "mia")
    phone = flask_app.test_client()
    call(phone, "post", "/api/yipi/login", {"login": "mia", "password": PASSWORD})
    assert api(client, "post", "/password", {"oldPassword": "nope nope nope", "newPassword": "a brand new password"}, status=403)["error"] == "wrong_password"
    assert api(client, "post", "/password", {"oldPassword": PASSWORD, "newPassword": "short"}, status=400)["error"] == "bad_password"
    api(client, "post", "/password", {"oldPassword": PASSWORD, "newPassword": "a brand new password"}, status=200)
    assert api(client, "get", "/me")["me"] is not None and api(phone, "get", "/me")["me"] is None
    assert call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "mia", "password": PASSWORD}).status_code == 401
    assert call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "mia", "password": "a brand new password"}).status_code == 200


def test_the_profile_can_be_changed_and_is_checked(client):
    signup(client, "mia")
    me = api(client, "patch", "/profile", {"name": "Mia M.", "bio": "Hallo\nWelt", "location": "Berlin", "website": "https://example.com/mia"}, status=200)["me"]
    assert (me["name"], me["bio"], me["location"], me["website"]) == ("Mia M.", "Hallo\nWelt", "Berlin", "https://example.com/mia")
    for body, error in (({"name": ""}, "bad_name"), ({"name": "x" * 51}, "bad_name"), ({"bio": "x" * 161}, "bad_bio"), ({"location": "x" * 31}, "bad_location"),
                        ({"website": "javascript:alert(1)"}, "bad_website"), ({"website": "example.com"}, "bad_website"), ({"website": 5}, "bad_website"), ({"avatar": "0" * 32}, "bad_media")):
        assert api(client, "patch", "/profile", body, status=400)["error"] == error, body
    assert api(client, "patch", "/profile", {"website": ""}, status=200)["me"]["website"] == ""
    assert api(client, "get", "/users/mia")["user"]["bio"] == "Hallo\nWelt"


def test_deleting_the_account_needs_the_password_and_removes_everything(client):
    mia = person("mia")
    tom = person("tom")
    post = yip(tom, "Ein Yip von Tom")
    api(mia, "post", f"/posts/{post['id']}/like", status=200)
    api(mia, "post", "/users/tom/follow", status=200)
    api(tom, "post", "/users/mia/follow", status=200)
    mine = yip(mia, "Ein Yip von Mia")
    api(tom, "post", f"/posts/{mine['id']}/repost", status=200)
    yip(tom, "Antwort an Mia", replyTo=mine["id"])
    assert api(mia, "post", "/delete", {"password": "wrong password"}, status=403)["error"] == "wrong_password"
    assert yipi.YipiUser.query.count() == 2
    api(mia, "post", "/delete", {"password": PASSWORD}, status=200)
    assert yipi.YipiUser.query.filter_by(handle_lc="mia").first() is None
    assert api(mia, "get", "/me")["me"] is None
    user = yipi.YipiUser.query.filter_by(handle_lc="tom").one()
    assert (user.followers_count, user.following_count) == (0, 0)
    assert yipi.YipiLike.query.count() == 0 and yipi.YipiFollow.query.count() == 0
    assert yipi.db.session.get(yipi.YipiPost, post["id"]).like_count == 0
    assert [p.text for p in yipi.YipiPost.query.order_by(yipi.YipiPost.id)] == ["Ein Yip von Tom", "Antwort an Mia"]
    assert api(flask_app.test_client(), "get", "/handle?handle=mia")["available"] is True


# ============================================================================================= Yips
def test_a_yip_is_made_cleaned_and_counted(client):
    mia = person("mia")
    post = yip(mia, "  Hallo   yipi!  ")
    assert post["text"] == "Hallo   yipi!" and post["user"]["handle"] == "mia" and post["counts"] == {"replies": 0, "reposts": 0, "likes": 0}
    assert post["viewer"] == {"liked": False, "reposted": False, "bookmarked": False} and post["replyTo"] is None and post["quote"] is None
    assert api(mia, "get", "/me")["me"]["posts"] == 1
    assert api(mia, "get", f"/posts/{post['id']}")["post"]["text"] == "Hallo   yipi!"


def test_the_length_limit_counts_characters_not_bytes(client):
    mia = person("mia")
    assert yip(mia, "x" * 280)["text"] == "x" * 280
    assert yip(mia, "ä" * 280)["text"] == "ä" * 280
    assert yip(mia, "😀" * 280)["text"] == "😀" * 280
    assert yip(mia, "y" * 281, status=400)["error"] == "too_long"
    assert yip(mia, "😀" * 281, status=400)["error"] == "too_long"


def test_empty_wrong_and_odd_texts(client):
    mia = person("mia")
    assert yip(mia, "", status=400)["error"] == "empty"
    assert yip(mia, "   \n\t  ", status=400)["error"] == "empty"
    assert api(mia, "post", "/posts", {"text": 5}, status=400)["error"] == "bad_text"
    assert api(mia, "post", "/posts", {}, status=400)["error"] == "empty"
    assert yip(mia, "a\x00b‮c​d⁠e")["text"] == "abcde"                   # no control or direction-changing characters
    assert yip(mia, "line1\r\n\r\n\r\n\r\nline2")["text"] == "line1\n\nline2"
    assert yip(mia, "👨‍👩‍👧 family")["text"] == "👨‍👩‍👧 family"                                    # the joiner of emoji sequences stays
    assert yip(mia, "é")["text"] == "é"                                       # one Unicode form


def test_the_same_text_twice_in_a_row_is_refused(client):
    mia = person("mia")
    first = yip(mia, "Doppelt")
    assert yip(mia, "Doppelt", status=409)["error"] == "duplicate"
    assert yip(mia, "Doppelt", replyTo=first["id"])["replyTo"]["id"] == first["id"]       # a reply with that text is something else
    assert yip(person("tom"), "Doppelt")["text"] == "Doppelt"


def test_posting_too_fast_is_stopped(client):
    mia = person("mia")
    limit = yipi.LIMITS["post-burst"][0]
    codes = [call(mia, "post", "/api/yipi/posts", {"text": f"Yip {i}"}).status_code for i in range(limit + 2)]
    assert codes[:limit] == [201] * limit and codes[-1] == 429


def test_only_signed_in_people_can_post(client):
    assert api(flask_app.test_client(), "post", "/posts", {"text": "hi"}, status=401)["error"] == "not_logged_in"


def test_hashtags_and_mentions_are_found(client):
    mia = person("mia")
    tom = person("tom")
    yip(mia, "Heute #Mathe und #mathe und #2026 mit @tom und @TOM und @niemand und @mia #wichtig_1")
    assert sorted(t.tag for t in yipi.YipiTag.query) == ["mathe", "wichtig_1"]
    notes = api(tom, "get", "/notifications", status=200)["items"]
    assert [(n["kind"], n["actor"]["handle"]) for n in notes] == [("mention", "mia")]
    assert api(mia, "get", "/notifications")["items"] == []                              # naming yourself tells nobody


def test_a_reply_has_a_parent_a_root_and_counts(client):
    mia = person("mia")
    tom = person("tom")
    root = yip(mia, "Wurzel")
    first = yip(tom, "Antwort 1", replyTo=root["id"])
    second = yip(mia, "Antwort auf die Antwort", replyTo=first["id"])
    assert first["replyTo"] == {"id": root["id"], "handle": "mia"}
    assert yipi.db.session.get(yipi.YipiPost, second["id"]).root_id == root["id"]
    assert api(mia, "get", f"/posts/{root['id']}")["post"]["counts"]["replies"] == 1
    detail = api(mia, "get", f"/posts/{second['id']}")
    assert [p["id"] for p in detail["ancestors"]] == [root["id"], first["id"]] and detail["post"]["id"] == second["id"]
    replies = api(mia, "get", f"/posts/{root['id']}/replies")
    assert [p["id"] for p in replies["items"]] == [first["id"]] and replies["next"] is None
    assert [n["kind"] for n in api(tom, "get", "/notifications")["items"]] == ["reply"]
    assert [n["kind"] for n in api(mia, "get", "/notifications")["items"]] == ["reply"]


def test_replies_are_listed_oldest_first_in_pages(client):
    mia = person("mia")
    root = yip(mia, "Wurzel")
    for i in range(yipi.PAGE + 5):
        yipi.db.session.add(yipi.YipiPost(user_id=1, text=f"r{i}", reply_to_id=root["id"], root_id=root["id"]))
    yipi.db.session.commit()
    first = api(mia, "get", f"/posts/{root['id']}/replies")
    assert len(first["items"]) == yipi.PAGE and first["items"][0]["text"] == "r0" and first["next"]
    second = api(mia, "get", f"/posts/{root['id']}/replies?cursor={first['next']}")
    assert [p["text"] for p in second["items"]] == [f"r{i}" for i in range(yipi.PAGE, yipi.PAGE + 5)] and second["next"] is None


def test_replying_to_nothing_or_to_a_repost_fails(client):
    mia = person("mia")
    assert yip(mia, "x", status=404, replyTo=99999)["error"] == "reply_gone"
    assert yip(mia, "x", status=404, replyTo="abc")["error"] == "reply_gone"
    post = yip(mia, "Original")
    api(person("tom"), "post", f"/posts/{post['id']}/repost", status=200)
    repost_row = yipi.YipiPost.query.filter(yipi.YipiPost.repost_of_id.isnot(None)).one()
    assert yip(mia, "x", status=404, replyTo=repost_row.id)["error"] == "reply_gone"


def test_a_quote_counts_and_shows_the_quoted_yip(client):
    mia = person("mia")
    tom = person("tom")
    original = yip(mia, "Original mit Bild?")
    quote = yip(tom, "Seht mal", quoteOf=original["id"])
    assert quote["quote"]["id"] == original["id"] and quote["quote"]["text"] == "Original mit Bild?" and quote["quote"]["user"]["handle"] == "mia"
    assert api(mia, "get", f"/posts/{original['id']}")["post"]["counts"]["reposts"] == 1
    assert [n["kind"] for n in api(mia, "get", "/notifications")["items"]] == ["quote"]
    assert yip(tom, "", status=400, quoteOf=original["id"])["error"] == "empty"
    assert yip(tom, "x", status=404, quoteOf=99999)["error"] == "quote_gone"


def test_reposting_is_idempotent_counted_and_can_be_undone(client):
    mia = person("mia")
    tom = person("tom")
    post = yip(mia, "Original")
    first = api(tom, "post", f"/posts/{post['id']}/repost", status=200)
    again = api(tom, "post", f"/posts/{post['id']}/repost", status=200)
    assert first["counts"]["reposts"] == again["counts"]["reposts"] == 1
    assert api(tom, "get", "/me")["me"]["posts"] == 1
    assert [n["kind"] for n in api(mia, "get", "/notifications")["items"]] == ["repost"]
    assert api(tom, "get", f"/posts/{post['id']}")["post"]["viewer"]["reposted"] is True
    gone = api(tom, "delete", f"/posts/{post['id']}/repost", status=200)
    assert gone["counts"]["reposts"] == 0 and api(tom, "get", "/me")["me"]["posts"] == 0
    assert api(tom, "delete", f"/posts/{post['id']}/repost", status=200)["counts"]["reposts"] == 0
    assert api(mia, "get", "/notifications")["items"] == []                              # an undone repost leaves no notification
    assert api(tom, "post", "/posts/99999/repost", status=404)["error"] == "not_found"


def test_a_repost_shows_the_original_with_who_reposted_it(client):
    mia = person("mia")
    tom = person("tom")
    api(tom, "post", "/users/mia/follow", status=200)
    post = yip(mia, "Original")
    api(person("ann"), "post", f"/posts/{post['id']}/repost", status=200)
    ann = person("ann2")
    api(ann, "post", f"/posts/{post['id']}/repost", status=200)
    api(tom, "post", "/users/ann2/follow", status=200)
    items = api(tom, "get", "/timeline?feed=following")["items"]
    reposted = [i for i in items if i.get("repostedBy")]
    assert [i["id"] for i in reposted] == [post["id"]] and reposted[0]["repostedBy"]["handle"] == "ann2" and reposted[0]["user"]["handle"] == "mia"
    assert reposted[0]["cursor"] != post["id"]


def test_liking_is_idempotent_counted_and_can_be_undone(client):
    mia = person("mia")
    tom = person("tom")
    post = yip(mia, "Gefällt?")
    assert api(tom, "post", f"/posts/{post['id']}/like", status=200)["counts"]["likes"] == 1
    assert api(tom, "post", f"/posts/{post['id']}/like", status=200)["counts"]["likes"] == 1
    assert api(tom, "get", f"/posts/{post['id']}")["post"]["viewer"]["liked"] is True
    assert api(mia, "get", f"/posts/{post['id']}")["post"]["viewer"]["liked"] is False
    assert [n["kind"] for n in api(mia, "get", "/notifications")["items"]] == ["like"]
    assert api(tom, "delete", f"/posts/{post['id']}/like", status=200)["counts"]["likes"] == 0
    assert api(tom, "delete", f"/posts/{post['id']}/like", status=200)["counts"]["likes"] == 0
    api(tom, "post", f"/posts/{post['id']}/like", status=200)
    assert len(api(mia, "get", "/notifications")["items"]) == 1                            # liking again after unliking: still one
    api(mia, "post", f"/posts/{post['id']}/like", status=200)
    assert len(api(mia, "get", "/notifications")["items"]) == 1                            # liking your own Yip tells nobody
    assert api(tom, "post", "/posts/99999/like", status=404)["error"] == "not_found"
    assert api(flask_app.test_client(), "post", f"/posts/{post['id']}/like", status=401)


def test_bookmarks(client):
    mia = person("mia")
    tom = person("tom")
    first, second = yip(mia, "eins"), yip(mia, "zwei")
    api(tom, "post", f"/posts/{first['id']}/bookmark", status=200)
    api(tom, "post", f"/posts/{second['id']}/bookmark", status=200)
    api(tom, "post", f"/posts/{second['id']}/bookmark", status=200)
    marks = api(tom, "get", "/bookmarks", status=200)
    assert [p["text"] for p in marks["items"]] == ["zwei", "eins"] and all(p["viewer"]["bookmarked"] for p in marks["items"])
    api(tom, "delete", f"/posts/{second['id']}/bookmark", status=200)
    assert [p["text"] for p in api(tom, "get", "/bookmarks")["items"]] == ["eins"]
    assert api(mia, "get", "/bookmarks")["items"] == []
    assert api(flask_app.test_client(), "get", "/bookmarks", status=401)


def test_deleting_a_yip_is_for_its_author_and_cleans_up(client):
    mia = person("mia")
    tom = person("tom")
    post = yip(mia, "Weg damit #tag")
    api(tom, "post", f"/posts/{post['id']}/like", status=200)
    api(tom, "post", f"/posts/{post['id']}/bookmark", status=200)
    api(tom, "post", f"/posts/{post['id']}/repost", status=200)
    assert api(tom, "delete", f"/posts/{post['id']}", status=403)["error"] == "forbidden"
    assert api(flask_app.test_client(), "delete", f"/posts/{post['id']}", status=401)
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert yipi.YipiPost.query.count() == 0 and yipi.YipiLike.query.count() == 0 and yipi.YipiBookmark.query.count() == 0 and yipi.YipiTag.query.count() == 0
    assert yipi.YipiNotification.query.count() == 0
    assert api(mia, "get", "/me")["me"]["posts"] == 0 and api(tom, "get", "/me")["me"]["posts"] == 0
    assert api(mia, "get", f"/posts/{post['id']}", status=404)["error"] == "not_found"
    assert api(mia, "delete", f"/posts/{post['id']}", status=404)["error"] == "not_found"


def test_a_yip_with_replies_stays_as_an_empty_place_holder(client):
    mia = person("mia")
    tom = person("tom")
    root = yip(mia, "Wurzel")
    reply = yip(tom, "Antwort", replyTo=root["id"])
    api(mia, "delete", f"/posts/{root['id']}", status=200)
    detail = api(tom, "get", f"/posts/{reply['id']}", status=200)
    assert detail["ancestors"][0]["deleted"] is True and "text" not in detail["ancestors"][0]
    assert all(item["id"] != root["id"] for item in api(tom, "get", "/timeline?feed=foryou")["items"])
    api(tom, "delete", f"/posts/{reply['id']}", status=200)
    assert api(mia, "get", "/me")["me"]["posts"] == 0 and api(tom, "get", "/me")["me"]["posts"] == 0


def test_an_admin_can_delete_any_yip(client, monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss, other")
    boss = person("boss")
    mia = person("mia")
    post = yip(mia, "Regelverstoß")
    assert api(boss, "get", "/me")["me"]["isAdmin"] is True and api(mia, "get", "/me")["me"]["isAdmin"] is False
    api(boss, "delete", f"/posts/{post['id']}", status=200)
    assert yipi.YipiPost.query.count() == 0


# ===================================================================================== pictures
@pytest.mark.parametrize("make,kind,size", [(png, "image/png", (30, 20)), (jpeg, "image/jpeg", (31, 21)), (gif, "image/gif", (32, 22)),
                                            (webp_lossless, "image/webp", (33, 23)), (webp_extended, "image/webp", (34, 24))])
def test_the_known_picture_kinds_are_recognised_and_measured(client, make, kind, size):
    mia = person("mia")
    media = upload(mia, make(*size))["media"]
    assert (media["width"], media["height"]) == size
    served = mia.get(media["url"])
    assert served.status_code == 200 and served.mimetype == kind and served.headers["X-Content-Type-Options"] == "nosniff"
    assert "immutable" in served.headers["Cache-Control"] and "sandbox" in served.headers["Content-Security-Policy"]


@pytest.mark.parametrize("data", [b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"<html><script>alert(1)</script></html>", b"hello", b"", b"\x89PNG\r\n\x1a\n", b"GIF89a", b"\xff\xd8\xff", b"RIFF\x00\x00\x00\x00WEBPXXXX"])
def test_things_that_are_not_pictures_are_refused(client, data):
    mia = person("mia")
    assert upload(mia, data, status=415)["error"] == "bad_image"
    assert yipi.YipiMedia.query.count() == 0


def test_pictures_have_a_size_limit_and_a_pixel_limit(client):
    mia = person("mia")
    assert upload(mia, png() + b"\x00" * (yipi.MAX_IMAGE_BYTES + 10), status=413)["error"] == "too_big"
    assert upload(mia, png(10000, 10000), status=415)["error"] == "bad_image"
    assert upload(mia, png(0, 5), status=415)["error"] == "bad_image"


def test_uploading_needs_a_file_and_an_account(client):
    mia = person("mia")
    assert mia.post("/api/yipi/media", data={}, content_type="multipart/form-data").get_json()["error"] == "no_file"
    import io
    assert flask_app.test_client().post("/api/yipi/media", data={"file": (io.BytesIO(png()), "p.png")}, content_type="multipart/form-data").status_code == 401


def test_a_yip_can_carry_up_to_four_pictures_in_order(client):
    mia = person("mia")
    ids = [upload(mia, png(10 + i, 10), alt=f"Bild {i}")["media"]["id"] for i in range(5)]
    post = yip(mia, "Vier Bilder", media=ids[:4])
    assert [m["id"] for m in post["media"]] == ids[:4] and [m["alt"] for m in post["media"]] == ["Bild 0", "Bild 1", "Bild 2", "Bild 3"]
    assert yip(mia, "Fünf Bilder", status=400, media=ids)["error"] == "bad_media"
    assert yip(mia, "Schon benutzt", status=400, media=[ids[0]])["error"] == "bad_media"
    assert yip(mia, "Doppelt", status=400, media=[ids[4], ids[4]])["error"] == "bad_media"
    assert yip(mia, "Unbekannt", status=400, media=["0" * 32])["error"] == "bad_media"
    assert yip(mia, "", media=[ids[4]])["text"] == ""


def test_somebody_elses_picture_cannot_be_used(client):
    mia = person("mia")
    tom = person("tom")
    media = upload(mia, png())["media"]["id"]
    assert yip(tom, "geklaut", status=400, media=[media])["error"] == "bad_media"
    assert api(tom, "patch", "/profile", {"avatar": media}, status=400)["error"] == "bad_media"


def test_avatar_and_banner_come_from_uploads_and_can_be_removed(client):
    mia = person("mia")
    avatar = upload(mia, png(40, 40))["media"]
    banner = upload(mia, jpeg(150, 50))["media"]
    me = api(mia, "patch", "/profile", {"avatar": avatar["id"], "banner": banner["id"]}, status=200)["me"]
    assert me["avatar"] == avatar["url"] and me["banner"] == banner["url"]
    assert yip(mia, "Avatar als Bild?", status=400, media=[avatar["id"]])["error"] == "bad_media"
    me = api(mia, "patch", "/profile", {"avatar": "", "banner": None}, status=200)["me"]
    assert me["avatar"] is None and me["banner"] is None


def test_pictures_that_were_never_used_disappear_after_a_day(client):
    mia = person("mia")
    kept = upload(mia, png())["media"]["id"]
    api(mia, "patch", "/profile", {"avatar": kept})
    old = upload(mia, png(11, 11))["media"]["id"]
    for item in yipi.YipiMedia.query.all():
        item.created_at = yipi.utcnow() - timedelta(days=2)
    yipi.db.session.commit()
    upload(mia, png(12, 12))
    ids = {m.id for m in yipi.YipiMedia.query.all()}
    assert kept in ids and old not in ids and len(ids) == 2


def test_a_picture_is_served_with_a_validator_and_unknown_ones_are_404(client):
    mia = person("mia")
    url = upload(mia, png())["media"]["url"]
    first = mia.get(url)
    assert first.headers["ETag"]
    assert mia.get(url, headers={"If-None-Match": first.headers["ETag"]}).status_code == 304
    assert mia.get("/yipi-media/" + "0" * 32).status_code == 404
    assert mia.get("/yipi-media/not-an-id").status_code == 404
    assert cookies(flask_app.test_client().get(url)) == []


def test_deleting_a_yip_deletes_its_pictures(client):
    mia = person("mia")
    media = upload(mia, png())["media"]["id"]
    post = yip(mia, "mit Bild", media=[media])
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert yipi.YipiMedia.query.count() == 0


# ======================================================================================== the feeds
def test_the_for_you_feed_shows_everybody_newest_first_without_replies_and_reposts(client):
    mia = person("mia")
    tom = person("tom")
    a = yip(mia, "A")
    b = yip(tom, "B")
    yip(tom, "Antwort", replyTo=a["id"])
    api(tom, "post", f"/posts/{a['id']}/repost", status=200)
    guest = flask_app.test_client()
    assert [p["text"] for p in api(guest, "get", "/timeline?feed=foryou", status=200)["items"]] == ["B", "A"]
    assert api(guest, "get", "/timeline", status=200)["items"][0]["viewer"] == {"liked": False, "reposted": False, "bookmarked": False}


def test_the_following_feed_needs_an_account_and_shows_you_and_those_you_follow(client):
    assert api(flask_app.test_client(), "get", "/timeline?feed=following", status=401)["error"] == "not_logged_in"
    mia = person("mia")
    tom = person("tom")
    ann = person("ann")
    yip(mia, "von Mia")
    yip(tom, "von Tom")
    yip(ann, "von Ann")
    assert [p["text"] for p in api(mia, "get", "/timeline?feed=following")["items"]] == ["von Mia"]
    api(mia, "post", "/users/tom/follow", status=200)
    assert [p["text"] for p in api(mia, "get", "/timeline?feed=following")["items"]] == ["von Tom", "von Mia"]


def test_feeds_come_in_pages(client):
    mia = person("mia")
    for i in range(yipi.PAGE + 7):
        yipi.db.session.add(yipi.YipiPost(user_id=1, text=f"p{i}"))
    yipi.db.session.commit()
    first = api(mia, "get", "/timeline?feed=foryou")
    assert len(first["items"]) == yipi.PAGE and first["items"][0]["text"] == f"p{yipi.PAGE + 6}" and first["next"]
    second = api(mia, "get", f"/timeline?feed=foryou&cursor={first['next']}")
    assert len(second["items"]) == 7 and second["next"] is None and second["items"][-1]["text"] == "p0"
    ids = [i["id"] for i in first["items"]] + [i["id"] for i in second["items"]]
    assert len(set(ids)) == len(ids) == yipi.PAGE + 7
    assert len(api(mia, "get", "/timeline?feed=foryou&cursor=abc")["items"]) == yipi.PAGE


def test_the_page_can_ask_how_many_new_yips_there_are(client):
    mia = person("mia")
    tom = person("tom")
    api(mia, "post", "/users/tom/follow", status=200)
    first = yip(tom, "eins")
    assert api(mia, "get", f"/timeline/new?feed=following&after={first['id']}")["count"] == 0
    yip(tom, "zwei")
    yip(tom, "drei")
    assert api(mia, "get", f"/timeline/new?feed=following&after={first['id']}")["count"] == 2
    assert api(mia, "get", f"/timeline/new?feed=foryou&after={first['id']}")["count"] == 2
    assert api(mia, "get", "/timeline/new?feed=foryou")["count"] == 0
    assert api(flask_app.test_client(), "get", "/timeline/new?feed=following&after=1", status=401)


# ====================================================================== profiles, following, blocking
def test_a_profile_has_counts_and_tabs(client):
    mia = person("mia")
    tom = person("tom")
    root = yip(tom, "Tom eins")
    reply = yip(mia, "Antwort von Mia", replyTo=root["id"])
    plain = yip(mia, "Mia mit Bild", media=[upload(mia, png())["media"]["id"]])
    api(mia, "post", f"/posts/{root['id']}/repost", status=200)
    profile = api(tom, "get", "/users/mia", status=200)["user"]
    assert profile["handle"] == "mia" and profile["posts"] == 3 and profile["followedByMe"] is False and profile["isMe"] is False
    posts = api(tom, "get", "/users/mia/posts?tab=posts")["items"]
    assert [p["text"] for p in posts] == ["Tom eins", "Mia mit Bild"] and posts[0]["repostedBy"]["handle"] == "mia"
    assert [p["text"] for p in api(tom, "get", "/users/mia/posts?tab=replies")["items"]] == ["Mia mit Bild", "Antwort von Mia"]
    assert [p["text"] for p in api(tom, "get", "/users/mia/posts?tab=media")["items"]] == ["Mia mit Bild"]
    assert api(tom, "get", "/users/mia/posts?tab=likes", status=403)["error"] == "forbidden"
    assert api(flask_app.test_client(), "get", "/users/nobody", status=404)["error"] == "not_found"
    assert api(flask_app.test_client(), "get", "/users/x", status=404)["error"] == "not_found"


def test_the_likes_tab_is_only_for_the_owner_and_in_the_order_of_liking(client):
    mia = person("mia")
    tom = person("tom")
    a, b = yip(tom, "a"), yip(tom, "b")
    api(mia, "post", f"/posts/{b['id']}/like", status=200)
    api(mia, "post", f"/posts/{a['id']}/like", status=200)
    assert [p["text"] for p in api(mia, "get", "/users/mia/posts?tab=likes", status=200)["items"]] == ["a", "b"]
    assert api(flask_app.test_client(), "get", "/users/mia/posts?tab=likes", status=403)


def test_following_counts_lists_and_notifies(client):
    mia = person("mia")
    tom = person("tom")
    me = api(mia, "post", "/users/tom/follow", status=200)["user"]
    assert me["followedByMe"] is True and me["followers"] == 1
    assert api(mia, "post", "/users/tom/follow", status=200)["user"]["followers"] == 1
    assert api(mia, "get", "/me")["me"]["following"] == 1
    assert api(tom, "get", "/users/mia")["user"]["followsMe"] is True and api(tom, "get", "/users/mia")["user"]["followedByMe"] is False
    assert api(mia, "get", "/users/tom")["user"]["followedByMe"] is True and api(mia, "get", "/users/tom")["user"]["followsMe"] is False
    assert [u["handle"] for u in api(flask_app.test_client(), "get", "/users/tom/followers")["users"]] == ["mia"]
    assert [u["handle"] for u in api(flask_app.test_client(), "get", "/users/mia/following")["users"]] == ["tom"]
    assert [n["kind"] for n in api(tom, "get", "/notifications")["items"]] == ["follow"]
    assert api(mia, "delete", "/users/tom/follow", status=200)["user"]["followers"] == 0
    assert api(mia, "delete", "/users/tom/follow", status=200)["user"]["followers"] == 0
    assert api(mia, "get", "/me")["me"]["following"] == 0
    assert api(mia, "post", "/users/mia/follow", status=400)["error"] == "self"
    assert api(mia, "post", "/users/nobody/follow", status=404)["error"] == "not_found"
    assert api(flask_app.test_client(), "post", "/users/tom/follow", status=401)


def test_blocking_ends_following_hides_yips_and_stops_contact(client):
    mia = person("mia")
    tom = person("tom")
    api(mia, "post", "/users/tom/follow", status=200)
    api(tom, "post", "/users/mia/follow", status=200)
    mine, theirs = yip(mia, "von Mia"), yip(tom, "von Tom")
    blocked = api(mia, "post", "/users/tom/block", status=200)["user"]
    assert blocked["blockedByMe"] is True and blocked["followedByMe"] is False and blocked["followers"] == 0
    assert api(mia, "get", "/me")["me"]["following"] == 0 and api(tom, "get", "/me")["me"]["following"] == 0
    assert [p["text"] for p in api(mia, "get", "/timeline?feed=foryou")["items"]] == ["von Mia"]
    assert [p["text"] for p in api(tom, "get", "/timeline?feed=foryou")["items"]] == ["von Tom"]
    assert api(tom, "get", "/users/mia/posts")["items"] == []
    assert api(tom, "get", "/users/mia")["user"]["blockedMe"] is True and api(tom, "get", "/users/mia")["user"]["bio"] == ""
    assert api(tom, "post", "/users/mia/follow", status=403)["error"] == "blocked"
    assert api(tom, "post", f"/posts/{mine['id']}/like", status=403)["error"] == "blocked"
    assert api(tom, "post", f"/posts/{mine['id']}/repost", status=403)["error"] == "blocked"
    assert yip(tom, "x", status=403, replyTo=mine["id"])["error"] == "blocked"
    assert yip(tom, "x", status=403, quoteOf=mine["id"])["error"] == "blocked"
    assert api(tom, "get", f"/posts/{mine['id']}", status=403)["error"] == "blocked"
    assert api(mia, "get", f"/posts/{theirs['id']}", status=403)["error"] == "blocked"
    assert [u["handle"] for u in api(mia, "get", "/settings/blocked")["users"]] == ["tom"]
    api(mia, "delete", "/users/tom/block", status=200)
    assert api(mia, "get", "/settings/blocked")["users"] == []
    assert [p["text"] for p in api(tom, "get", "/timeline?feed=foryou")["items"]] == ["von Tom", "von Mia"]


def test_muting_hides_a_person_from_feeds_and_notifications_only(client):
    mia = person("mia")
    tom = person("tom")
    yip(tom, "laut")
    api(mia, "post", "/users/tom/mute", status=200)
    assert api(mia, "get", "/timeline?feed=foryou")["items"] == []
    assert [p["text"] for p in api(mia, "get", "/users/tom/posts")["items"]] == []          # (hidden from lists, like feeds)
    assert api(mia, "get", "/users/tom", status=200)["user"]["mutedByMe"] is True
    api(mia, "post", f"/posts/{yip(mia, 'meins')['id']}/like", status=200)
    post = yip(mia, "noch eins")
    api(tom, "post", f"/posts/{post['id']}/like", status=200)
    assert [n for n in api(mia, "get", "/notifications")["items"] if n["actor"]["handle"] == "tom"] == []
    assert [u["handle"] for u in api(mia, "get", "/settings/muted")["users"]] == ["tom"]
    api(mia, "delete", "/users/tom/mute", status=200)
    assert [p["text"] for p in api(mia, "get", "/timeline?feed=foryou")["items"]] == ["noch eins", "meins", "laut"]


def test_suspended_people_disappear(client, monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss")
    boss = person("boss")
    mia = person("mia")
    post = yip(mia, "Böse")
    report = api(person("tom"), "post", "/reports", {"postId": post["id"], "reason": "abuse"}, status=201)
    item = api(boss, "get", "/moderation/reports", status=200)["items"][0]
    api(boss, "post", f"/moderation/reports/{item['id']}", {"action": "suspend"}, status=200)
    assert api(flask_app.test_client(), "get", "/timeline?feed=foryou")["items"] == []
    assert api(flask_app.test_client(), "get", "/users/mia", status=200)["user"]["suspended"] is True
    assert api(flask_app.test_client(), "get", "/users/mia/posts", status=404)
    assert api(mia, "get", "/me")["me"] is None                                            # the session ends
    assert call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "mia", "password": PASSWORD}).get_json()["error"] == "suspended"
    assert report["ok"]
    api(person("ann"), "post", "/reports", {"handle": "mia", "reason": "other"}, status=201)
    again = api(boss, "get", "/moderation/reports", status=200)["items"][0]
    assert again["suspended"] is True
    api(boss, "post", f"/moderation/reports/{again['id']}", {"action": "restore"}, status=200)
    assert call(flask_app.test_client(), "post", "/api/yipi/login", {"login": "mia", "password": PASSWORD}).status_code == 200


# ===================================================================== search, trends, suggestions
def test_searching_yips_and_people(client):
    mia = person("mia", name="Mia Maus")
    tom = person("tom", name="Tom Tiger")
    yip(mia, "Ich liebe Kartoffelsalat")
    yip(tom, "Nudeln sind besser #essen")
    assert [p["text"] for p in api(tom, "get", "/search?q=kartoffel", status=200)["items"]] == ["Ich liebe Kartoffelsalat"]
    assert [p["text"] for p in api(tom, "get", "/search?q=%23essen")["items"]] == ["Nudeln sind besser #essen"]
    assert [u["handle"] for u in api(tom, "get", "/search?q=maus&type=people")["users"]] == ["mia"]
    assert [u["handle"] for u in api(tom, "get", "/search?q=%40tom&type=people")["users"]] == ["tom"]
    assert api(tom, "get", "/search?q=x")["items"] == [] and api(tom, "get", "/search?q=%23")["items"] == [] and api(tom, "get", "/search")["items"] == []


def test_search_treats_wildcards_as_plain_characters(client):
    mia = person("mia")
    yip(mia, "100% sicher")
    yip(mia, "fast_sicher")
    yip(mia, "100 prozent")
    assert [p["text"] for p in api(mia, "get", "/search?q=100%25")["items"]] == ["100% sicher"]
    assert [p["text"] for p in api(mia, "get", "/search?q=st_si")["items"]] == ["fast_sicher"]
    assert api(mia, "get", "/search?q=%25%25")["items"] == []


def test_search_is_rate_limited_and_hides_blocked_people(client):
    mia = person("mia")
    tom = person("tom")
    yip(tom, "Kartoffel")
    api(mia, "post", "/users/tom/block", status=200)
    assert api(mia, "get", "/search?q=kartoffel")["items"] == []
    assert api(mia, "get", "/search?q=tom&type=people")["users"] == []
    limit = yipi.LIMITS["search"][0]
    codes = [call(mia, "get", "/api/yipi/search?q=abc").status_code for _ in range(limit + 2)]
    assert codes[-1] == 429


def test_trends_count_recent_hashtags(client):
    mia = person("mia")
    tom = person("tom")
    yip(mia, "#eins #zwei")
    yip(tom, "#zwei noch mal")
    yip(mia, "#zwei und #drei")
    trends = api(flask_app.test_client(), "get", "/trends", status=200)["trends"]
    assert trends[0] == {"tag": "zwei", "posts": 3, "people": 2} and {t["tag"] for t in trends} == {"eins", "zwei", "drei"}
    for tag in yipi.YipiTag.query.all():
        tag.created_at = yipi.utcnow() - timedelta(hours=30)
    yipi.db.session.commit()
    assert api(flask_app.test_client(), "get", "/trends")["trends"] == []


def test_suggestions_skip_you_and_those_you_follow(client):
    mia = person("mia")
    tom = person("tom")
    ann = person("ann")
    api(ann, "post", "/users/tom/follow", status=200)
    assert [u["handle"] for u in api(mia, "get", "/suggestions", status=200)["users"]] == ["tom", "ann"]
    api(mia, "post", "/users/tom/follow", status=200)
    assert [u["handle"] for u in api(mia, "get", "/suggestions")["users"]] == ["ann"]
    assert {u["handle"] for u in api(flask_app.test_client(), "get", "/suggestions")["users"]} == {"mia", "tom", "ann"}


# ============================================================================================ notifications
def test_notifications_are_listed_counted_and_marked_read(client):
    mia = person("mia")
    tom = person("tom")
    post = yip(mia, "Hallo")
    api(tom, "post", f"/posts/{post['id']}/like", status=200)
    api(tom, "post", "/users/mia/follow", status=200)
    assert api(mia, "get", "/me")["me"]["unreadNotifications"] == 2
    items = api(mia, "get", "/notifications", status=200)["items"]
    assert [n["kind"] for n in items] == ["follow", "like"] and items[1]["post"]["text"] == "Hallo" and items[0]["actor"]["handle"] == "tom" and not any(n["read"] for n in items)
    api(mia, "post", "/notifications/read", status=200)
    assert api(mia, "get", "/me")["me"]["unreadNotifications"] == 0 and all(n["read"] for n in api(mia, "get", "/notifications")["items"])
    assert api(tom, "get", "/notifications")["items"] == []
    assert api(flask_app.test_client(), "get", "/notifications", status=401)


def test_notifications_come_in_pages(client):
    mia = person("mia")
    for i in range(yipi.PAGE + 3):
        yipi.db.session.add(yipi.YipiNotification(user_id=1, actor_id=1000 + i, kind="follow"))
        yipi.db.session.add(yipi.YipiUser(handle=f"u{i:05d}", handle_lc=f"u{i:05d}", name="n", password_hash="x", id=1000 + i))
    yipi.db.session.commit()
    first = api(mia, "get", "/notifications")
    assert len(first["items"]) == yipi.PAGE and first["next"]
    assert len(api(mia, "get", f"/notifications?cursor={first['next']}")["items"]) == 3


# =============================================================================================== messages
def test_messages_need_a_follower_or_an_earlier_message(client):
    mia = person("mia")
    tom = person("tom")
    assert api(mia, "post", "/messages/tom", {"text": "Hi"}, status=403)["error"] == "dm_closed"
    api(tom, "post", "/users/mia/follow", status=200)
    sent = api(mia, "post", "/messages/tom", {"text": "Hi Tom"}, status=201)["message"]
    assert sent["mine"] is True and sent["text"] == "Hi Tom"
    assert api(tom, "post", "/messages/mia", {"text": "Hi Mia"}, status=201)["message"]["mine"] is True        # answering is always allowed


def test_a_conversation_is_listed_read_and_polled(client):
    mia = person("mia")
    tom = person("tom")
    api(tom, "post", "/users/mia/follow", status=200)
    api(mia, "post", "/messages/tom", {"text": "eins"}, status=201)
    api(mia, "post", "/messages/tom", {"text": "zwei"}, status=201)
    assert api(tom, "get", "/me")["me"]["unreadMessages"] == 2
    listing = api(tom, "get", "/messages", status=200)["items"]
    assert len(listing) == 1 and listing[0]["user"]["handle"] == "mia" and listing[0]["unread"] == 2 and listing[0]["last"] == {"text": "zwei", "createdAt": listing[0]["last"]["createdAt"], "mine": False}
    thread = api(tom, "get", "/messages/mia", status=200)
    assert [m["text"] for m in thread["messages"]] == ["eins", "zwei"] and [m["mine"] for m in thread["messages"]] == [False, False] and thread["canWrite"] is True
    assert api(tom, "get", "/me")["me"]["unreadMessages"] == 0
    last = thread["messages"][-1]["id"]
    api(mia, "post", "/messages/tom", {"text": "drei"}, status=201)
    polled = api(tom, "get", f"/messages/mia/poll?after={last}", status=200)["messages"]
    assert [m["text"] for m in polled] == ["drei"]
    assert api(tom, "get", f"/messages/mia/poll?after={polled[0]['id']}")["messages"] == []
    assert api(mia, "get", "/messages")["items"][0]["last"]["mine"] is True


def test_the_conversation_list_has_the_newest_message_of_each_person(client):
    mia = person("mia")
    for name in ("ann", "bob", "cyd"):
        other = person(name)
        api(other, "post", "/users/mia/follow", status=200)
        api(mia, "post", f"/messages/{name}", {"text": f"hallo {name}"}, status=201)
    api(mia, "post", "/messages/ann", {"text": "noch mal ann"}, status=201)
    items = api(mia, "get", "/messages")["items"]
    assert [i["user"]["handle"] for i in items] == ["ann", "cyd", "bob"] and items[0]["last"]["text"] == "noch mal ann"


def test_message_rules(client):
    mia = person("mia")
    tom = person("tom")
    api(tom, "post", "/users/mia/follow", status=200)
    assert api(mia, "post", "/messages/tom", {"text": ""}, status=400)["error"] == "empty"
    assert api(mia, "post", "/messages/tom", {"text": "x" * 1001}, status=400)["error"] == "too_long"
    assert api(mia, "post", "/messages/tom", {"text": "x" * 1000}, status=201)
    assert api(mia, "post", "/messages/mia", {"text": "x"}, status=400)["error"] == "self"
    assert api(mia, "post", "/messages/nobody", {"text": "x"}, status=404)["error"] == "not_found"
    api(tom, "post", "/users/mia/block", status=200)
    assert api(mia, "post", "/messages/tom", {"text": "x"}, status=403)["error"] == "blocked"
    assert api(mia, "get", "/messages/tom", status=403)["error"] == "blocked"
    assert api(mia, "get", "/messages")["items"] == []
    assert api(flask_app.test_client(), "get", "/messages", status=401)


# ===================================================================== reports and moderation
def test_reporting_a_yip_or_a_person(client, monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss")
    boss = person("boss")
    mia = person("mia")
    tom = person("tom")
    post = yip(mia, "Spam spam")
    assert api(tom, "post", "/reports", {"postId": post["id"], "reason": "spam", "note": "immer wieder"}, status=201)["ok"]
    assert api(tom, "post", "/reports", {"handle": "mia", "reason": "abuse"}, status=201)["ok"]
    assert api(tom, "post", "/reports", {"postId": post["id"], "reason": "nonsense"}, status=400)["error"] == "bad_reason"
    assert api(tom, "post", "/reports", {"postId": 99999, "reason": "spam"}, status=404)["error"] == "not_found"
    assert api(tom, "post", "/reports", {"handle": "nobody", "reason": "spam"}, status=404)["error"] == "not_found"
    assert api(tom, "post", "/reports", {"reason": "spam"}, status=400)["error"] == "bad_request"
    assert api(flask_app.test_client(), "post", "/reports", {"postId": post["id"], "reason": "spam"}, status=401)
    assert api(tom, "get", "/moderation/reports", status=403)["error"] == "forbidden"
    items = api(boss, "get", "/moderation/reports", status=200)["items"]
    assert len(items) == 2 and {i["reason"] for i in items} == {"spam", "abuse"} and items[0]["text"] == "Spam spam" and items[0]["reporter"] == "tom"


def test_moderators_can_dismiss_delete_and_suspend(client, monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss")
    boss = person("boss")
    mia = person("mia")
    tom = person("tom")
    one, two = yip(mia, "Eins"), yip(mia, "Zwei")
    api(tom, "post", "/reports", {"postId": one["id"], "reason": "spam"}, status=201)
    api(tom, "post", "/reports", {"postId": two["id"], "reason": "illegal"}, status=201)
    first, second = api(boss, "get", "/moderation/reports")["items"]
    assert api(boss, "post", f"/moderation/reports/{first['id']}", {"action": "dismiss"}, status=200)["ok"]
    assert api(boss, "post", f"/moderation/reports/{second['id']}", {"action": "delete_post"}, status=200)["ok"]
    assert api(boss, "get", "/moderation/reports")["items"] == []
    assert [p["text"] for p in api(tom, "get", "/timeline?feed=foryou")["items"]] == ["Eins"]
    assert api(boss, "post", "/moderation/reports/99999", {"action": "dismiss"}, status=404)["error"] == "not_found"
    api(tom, "post", "/reports", {"handle": "mia", "reason": "hate"}, status=201)
    item = api(boss, "get", "/moderation/reports")["items"][0]
    assert api(boss, "post", f"/moderation/reports/{item['id']}", {"action": "explode"}, status=400)["error"] == "bad_action"
    assert api(tom, "post", f"/moderation/reports/{item['id']}", {"action": "dismiss"}, status=403)
    api(boss, "post", f"/moderation/reports/{item['id']}", {"action": "suspend"}, status=200)
    assert yipi.YipiUser.query.filter_by(handle="mia").one().suspended is True


def test_moderators_cannot_be_suspended_by_a_report(client, monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss, chief")
    boss = person("boss")
    person("chief")
    tom = person("tom")
    api(tom, "post", "/reports", {"handle": "chief", "reason": "abuse"}, status=201)
    item = api(boss, "get", "/moderation/reports")["items"][0]
    api(boss, "post", f"/moderation/reports/{item['id']}", {"action": "suspend"}, status=200)
    assert yipi.YipiUser.query.filter_by(handle="chief").one().suspended is False


# =============================================================================================== pages
def test_every_page_of_the_app_is_served_with_security_headers(client):
    c = flask_app.test_client()
    for path in ("/", "/explore", "/notifications", "/messages", "/messages/someone", "/bookmarks", "/settings", "/settings/account", "/search", "/moderation", "/i/login", "/i/signup"):
        r = c.get(path)
        assert r.status_code == 200 and b'id="yipiBoot"' in r.data, path
        assert "script-src 'self'" in r.headers["Content-Security-Policy"] and r.headers["X-Frame-Options"] == "DENY", path
        assert cookies(r) == [], path


def test_profile_and_yip_pages_exist_only_for_real_ones_and_carry_link_previews(client):
    mia = person("Mia", name="Mia Maus")
    api(mia, "patch", "/profile", {"bio": "Ich mag Mathe"})
    post = yip(mia, "Mein erster Yip mit <b>Tags</b>")
    c = flask_app.test_client()
    page = c.get("/mia").get_data(as_text=True)
    assert c.get("/Mia").status_code == 200 and "Mia Maus (@Mia) auf yipi" in page and "Ich mag Mathe" in page
    status = c.get(f"/mia/status/{post['id']}").get_data(as_text=True)
    assert "Mein erster Yip mit &lt;b&gt;Tags&lt;/b&gt;" in status and "<b>Tags</b>" not in status
    assert c.get("/nobody").status_code == 404 and c.get("/mia/status/99999").status_code == 404 and c.get("/tom/status/1").status_code == 404
    assert c.get("/mia/followers").status_code == 200 and c.get("/mia/following").status_code == 200 and c.get("/nobody/followers").status_code == 404
    assert c.get("/gibt-es-nicht-oder-doch").status_code == 404


def test_the_home_page_knows_who_is_signed_in(client):
    mia = person("mia")
    page = mia.get("/").get_data(as_text=True)
    assert re.search(r'"handle":\s*"mia"', page)
    assert re.search(r'"me":\s*null', flask_app.test_client().get("/").get_data(as_text=True))


# ============================================================================================ huge numbers
HUGE = "99999999999999999999999"


def test_absurdly_large_cursors_and_ids_are_not_passed_on_to_the_database(client):
    """A number that does not fit the database's integer type used to be an error 500 (or an exception) instead of "nothing there"."""
    mia = person("mia")
    post = yip(mia, "hallo")
    for path in (f"/timeline?cursor={HUGE}", f"/timeline/new?after={HUGE}", f"/users/mia/posts?cursor={HUGE}", f"/posts/{post['id']}/replies?cursor={HUGE}",
                 f"/search?q=ha&cursor={HUGE}", f"/bookmarks?cursor={HUGE}", f"/notifications?cursor={HUGE}", f"/users/mia/followers?page={HUGE}",
                 f"/settings/blocked?page={HUGE}", "/messages/mia?cursor=" + HUGE):
        r = mia.get(f"/api/yipi{path}")
        assert r.status_code in (200, 403), (path, r.status_code)
    assert api(mia, "get", f"/timeline?cursor={HUGE}")["items"][0]["id"] == post["id"], "a cursor beyond every id starts from the newest Yip"
    for method, path in (("get", f"/posts/{HUGE}"), ("get", f"/posts/{HUGE}/replies"), ("post", f"/posts/{HUGE}/like"), ("delete", f"/posts/{HUGE}"), ("post", f"/moderation/reports/{HUGE}")):
        assert call(mia, method, f"/api/yipi{path}").status_code in (404, 405), (method, path)         # (nothing the server could look up)
    assert mia.get(f"/mia/status/{HUGE}").status_code == 404
    assert call(mia, "post", "/api/yipi/posts", {"text": "x", "replyTo": int(HUGE)}).status_code == 404
    assert call(mia, "post", "/api/yipi/posts", {"text": "y", "quoteOf": int(HUGE)}).status_code == 404
    assert call(mia, "post", "/api/yipi/reports", {"postId": int(HUGE), "reason": "spam"}).status_code == 404
    assert yipi.clamp_cursor(HUGE) == yipi.MAX_ID and yipi.clamp_cursor("0") is None and yipi.clamp_cursor("-5") is None and yipi.clamp_cursor("abc") is None
