"""gomat accounts: signing up and in, saving progress on the server, the rules around passwords, other
devices, rate limits, other sites, and what a visitor without an account does not get (a cookie)."""
import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import gomat_accounts as accounts  # noqa: E402
import siteauth  # noqa: E402
from app import app as flask_app, db  # noqa: E402

GOOD = {"name": "Mia", "email": "mia@example.com", "password": "correct horse battery"}
STATE = {"v": 1, "onboarded": True, "xp": 120, "lessons": {"1-1": {"done": True, "best": 100, "times": 1}}}


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    accounts._hits.clear()
    siteauth._keys.clear()                       # (every test has a fresh database, so a fresh key)
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


def post(client, path, body=None, **kwargs):
    return client.post(path, json=body if body is not None else {}, **kwargs)


def signup(client, **changes):
    return post(client, "/api/gomat/signup", {**GOOD, **changes})


def cookies(response):
    return response.headers.get_all("Set-Cookie")


# ------------------------------------------------------------------------------------------ signing up

def test_signing_up_creates_the_account_signs_in_and_keeps_the_progress(client):
    r = signup(client, state=STATE)
    data = r.get_json()
    assert r.status_code == 200 and data["ok"] is True and data["user"] == {"name": "Mia", "email": "mia@example.com"} and data["rev"] == 1
    assert cookies(r) and "HttpOnly" in cookies(r)[0] and "SameSite=Lax" in cookies(r)[0]
    me = client.get("/api/gomat/me").get_json()
    assert me["user"]["email"] == "mia@example.com" and me["state"] == STATE and me["rev"] == 1


def test_the_e_mail_is_tidied_and_the_name_is_cleaned_and_defaults(client):
    r = signup(client, email="  Mia@Example.COM ", name="  Mia \n\t  Maus\x07  ")
    assert r.get_json()["user"] == {"name": "Mia Maus", "email": "mia@example.com"}
    other = flask_app.test_client()
    assert signup(other, email="b@example.com", name="").get_json()["user"]["name"] == accounts.DEFAULT_NAME
    assert signup(flask_app.test_client(), email="c@example.com", name="x" * 200).get_json()["user"]["name"] == "x" * accounts.MAX_NAME


@pytest.mark.parametrize("email", ["", "mia", "mia@", "@example.com", "mia@example", "mia @example.com", "mia@exa mple.com", "a@b@c.de", None, 5, "x" * 300 + "@example.com"])
def test_a_bad_e_mail_is_refused(client, email):
    r = signup(client, email=email)
    assert r.status_code == 400 and r.get_json() == {"ok": False, "error": "bad_email"} and cookies(r) == []


@pytest.mark.parametrize("password", ["", "short", "1234567", None, 12345678, "x" * 201])
def test_a_bad_password_is_refused(client, password):
    r = signup(client, password=password)
    assert r.status_code == 400 and r.get_json()["error"] == "bad_password" and cookies(r) == []


def test_an_e_mail_can_only_be_used_once_whatever_its_case(client):
    assert signup(client).status_code == 200
    r = signup(flask_app.test_client(), email="MIA@example.com")
    assert r.status_code == 409 and r.get_json()["error"] == "email_taken" and cookies(r) == []


def test_a_signup_only_takes_json_and_never_a_web_form(client):
    r = client.post("/api/gomat/signup", data=GOOD)
    assert r.status_code == 415 and cookies(r) == []
    assert accounts.GomatUser.query.count() == 0


def test_a_broken_or_huge_state_is_dropped_but_the_account_is_made(client):
    assert signup(client, email="a@example.com", state={"v": 2}).get_json()["rev"] == 0
    assert signup(flask_app.test_client(), email="b@example.com", state="no").get_json()["rev"] == 0
    big = {"v": 1, "junk": "x" * (accounts.MAX_STATE_BYTES + 10)}
    assert signup(flask_app.test_client(), email="c@example.com", state=big).get_json()["rev"] == 0


def test_the_password_is_stored_only_as_a_hash(client):
    signup(client)
    user = accounts.GomatUser.query.one()
    assert GOOD["password"] not in user.password_hash and user.password_hash.startswith(("scrypt:", "pbkdf2:")) and user.check_password(GOOD["password"])


# --------------------------------------------------------------------------------------------- signing in

def test_signing_in_and_out(client):
    signup(client, state=STATE)
    other = flask_app.test_client()
    r = post(other, "/api/gomat/login", {"email": "MIA@example.com", "password": GOOD["password"]})
    data = r.get_json()
    assert r.status_code == 200 and data["state"] == STATE and data["rev"] == 1 and data["user"]["name"] == "Mia" and cookies(r)
    assert other.get("/api/gomat/me").get_json()["user"]["email"] == "mia@example.com"
    assert post(other, "/api/gomat/logout").get_json() == {"ok": True}
    assert other.get("/api/gomat/me").get_json() == {"ok": True, "user": None}


def test_a_wrong_password_and_an_unknown_e_mail_look_the_same(client):
    signup(client)
    a = post(flask_app.test_client(), "/api/gomat/login", {"email": GOOD["email"], "password": "wrong password"})
    b = post(flask_app.test_client(), "/api/gomat/login", {"email": "nobody@example.com", "password": "wrong password"})
    assert a.status_code == b.status_code == 401 and a.get_json() == b.get_json() == {"ok": False, "error": "wrong_login"}
    assert cookies(a) == cookies(b) == []
    for body in ({}, {"email": GOOD["email"]}, {"email": GOOD["email"], "password": 5}, {"email": GOOD["email"], "password": ["x"]}, {"email": "x" * 400, "password": "y" * 400}):
        assert post(flask_app.test_client(), "/api/gomat/login", body).status_code == 401


def test_guessing_passwords_is_stopped(client):
    signup(client)
    codes = [post(flask_app.test_client(), "/api/gomat/login", {"email": GOOD["email"], "password": f"guess number {i}"}).status_code for i in range(accounts.LIMITS["login-mail"][0] + 2)]
    assert codes[0] == 401 and codes[-1] == 429
    # even the right password is refused while the limit holds
    assert post(flask_app.test_client(), "/api/gomat/login", GOOD).status_code == 429


def test_signing_up_again_and_again_is_stopped(client):
    codes = [signup(flask_app.test_client(), email=f"user{i}@example.com").status_code for i in range(accounts.LIMITS["signup-ip"][0] + 2)]
    assert codes[:accounts.LIMITS["signup-ip"][0]] == [200] * accounts.LIMITS["signup-ip"][0] and codes[-1] == 429


# --------------------------------------------------------------------------------------- the visitor without an account

def test_a_visitor_without_an_account_gets_no_cookie_anywhere(client):
    for path in ("/", "/gomat-archiv", "/api/gomat/me", "/datenschutz", "/gomat-archiv/datenschutz", "/api/gomat/placement", "/api/gomat/lesson/1-1"):
        r = client.get(path)
        assert cookies(r) == [], path
    assert client.get("/api/gomat/me").get_json() == {"ok": True, "user": None}
    r = post(client, "/api/gomat/logout")
    assert cookies(r) == []


def test_the_account_routes_need_a_sign_in_where_they_should(client):
    assert client.put("/api/gomat/save", json={"state": STATE, "baseRev": 0}).status_code == 401
    assert post(client, "/api/gomat/password", {"oldPassword": "a", "newPassword": "b"}).status_code == 401
    assert post(client, "/api/gomat/delete", {"password": "a"}).status_code == 401


def test_the_account_api_is_never_cached(client):
    r = client.get("/api/gomat/me")
    assert r.headers["Cache-Control"] == "no-store" and "Cookie" in r.headers["Vary"] and r.headers["X-Content-Type-Options"] == "nosniff"


# ------------------------------------------------------------------------------------------------- saving

def test_saving_progress_counts_up_the_revision(client):
    signup(client)
    r = client.put("/api/gomat/save", json={"state": STATE, "baseRev": 0})
    assert r.get_json() == {"ok": True, "rev": 1}
    newer = {**STATE, "xp": 200}
    assert client.put("/api/gomat/save", json={"state": newer, "baseRev": 1}).get_json() == {"ok": True, "rev": 2}
    assert client.get("/api/gomat/me").get_json()["state"] == newer


def test_a_device_that_missed_a_save_does_not_overwrite_it(client):
    signup(client, state=STATE)
    phone = flask_app.test_client()
    post(phone, "/api/gomat/login", GOOD)
    assert client.put("/api/gomat/save", json={"state": {**STATE, "xp": 500}, "baseRev": 1}).status_code == 200
    r = phone.put("/api/gomat/save", json={"state": {**STATE, "xp": 130}, "baseRev": 1})
    data = r.get_json()
    assert r.status_code == 409 and data["error"] == "newer" and data["rev"] == 2 and data["state"]["xp"] == 500
    assert phone.put("/api/gomat/save", json={"state": {**STATE, "xp": 600}, "baseRev": data["rev"]}).get_json()["rev"] == 3


def test_a_bad_save_is_refused_and_changes_nothing(client):
    signup(client, state=STATE)
    for body in ({"state": {"v": 2}, "baseRev": 1}, {"state": "x", "baseRev": 1}, {"baseRev": 1}, {"state": {"v": 1, "junk": "x" * (accounts.MAX_STATE_BYTES + 5)}, "baseRev": 1}):
        r = client.put("/api/gomat/save", json=body)
        assert r.status_code == 400 and r.get_json()["error"] == "bad_state", body
    assert client.put("/api/gomat/save", data="not json", content_type="text/plain").status_code == 400
    assert client.get("/api/gomat/me").get_json()["state"] == STATE


# ----------------------------------------------------------------------------- password, deleting, other sites

def test_changing_the_password_signs_the_other_devices_out(client):
    signup(client)
    phone = flask_app.test_client()
    post(phone, "/api/gomat/login", GOOD)
    assert post(client, "/api/gomat/password", {"oldPassword": "not the one", "newPassword": "a brand new password"}).status_code == 403
    assert post(client, "/api/gomat/password", {"oldPassword": GOOD["password"], "newPassword": "short"}).get_json()["error"] == "bad_password"
    assert post(client, "/api/gomat/password", {"oldPassword": GOOD["password"], "newPassword": "a brand new password"}).get_json() == {"ok": True}
    assert client.get("/api/gomat/me").get_json()["user"] is not None            # this device stays signed in
    assert phone.get("/api/gomat/me").get_json()["user"] is None                  # the other one does not
    assert post(flask_app.test_client(), "/api/gomat/login", GOOD).status_code == 401
    assert post(flask_app.test_client(), "/api/gomat/login", {**GOOD, "password": "a brand new password"}).status_code == 200


def test_deleting_the_account_needs_the_password_and_removes_everything(client):
    signup(client, state=STATE)
    assert post(client, "/api/gomat/delete", {"password": "wrong password"}).status_code == 403
    assert accounts.GomatUser.query.count() == 1
    assert post(client, "/api/gomat/delete", {"password": GOOD["password"]}).get_json() == {"ok": True}
    assert accounts.GomatUser.query.count() == 0
    assert client.get("/api/gomat/me").get_json()["user"] is None
    assert post(flask_app.test_client(), "/api/gomat/login", GOOD).status_code == 401
    assert signup(flask_app.test_client()).status_code == 200            # the e-mail is free again


def test_requests_from_other_sites_are_refused(client):
    ok = client.post("/api/gomat/signup", json=GOOD, headers={"Origin": "http://localhost"})
    assert ok.status_code == 200
    for path in ("/api/gomat/signup", "/api/gomat/login", "/api/gomat/logout", "/api/gomat/delete"):
        r = client.post(path, json=GOOD, headers={"Origin": "https://evil.example"})
        assert r.status_code == 403 and r.get_json()["error"] == "forbidden", path
    assert client.put("/api/gomat/save", json={"state": STATE, "baseRev": 1}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/gomat/me").get_json()["user"] is not None            # the refused logout changed nothing


def test_the_other_parts_of_the_site_do_not_see_a_gomat_sign_in(client):
    signup(client)
    assert client.get("/api/ylib/items").status_code in (401, 302)
    assert client.get_cookie("gomat_session") is not None
    with client.session_transaction() as s:
        assert "user_id" not in s and "gomat_uid" not in s


# ------------------------------------------------------------------------------------ the sign-in cookie

def test_the_cookie_is_signed_with_a_key_from_the_database_not_with_the_site_secret(client):
    from itsdangerous import URLSafeTimedSerializer
    signup(client)
    mine = client.get_cookie("gomat_session").value
    forged = URLSafeTimedSerializer("dev-secret-change-in-production", salt="gomat-account-v1").dumps({"uid": 1, "gen": 0})
    stranger = flask_app.test_client()
    stranger.set_cookie("gomat_session", forged)
    assert stranger.get("/api/gomat/me").get_json()["user"] is None              # the public default key forges nothing
    flask_app_key = URLSafeTimedSerializer(flask_app.config["SECRET_KEY"], salt="gomat-account-v1").dumps({"uid": 1, "gen": 0})
    stranger.set_cookie("gomat_session", flask_app_key)
    assert stranger.get("/api/gomat/me").get_json()["user"] is None              # neither does the site's own secret
    stranger.set_cookie("gomat_session", mine)
    assert stranger.get("/api/gomat/me").get_json()["user"]["email"] == GOOD["email"]
    assert siteauth.SiteSecret.query.filter_by(name="cookie:gomat_session").one().value


def test_a_changed_cut_off_or_expired_cookie_is_not_a_sign_in(client, monkeypatch):
    signup(client)
    mine = client.get_cookie("gomat_session").value
    for broken in (mine[:-3] + ("aaa" if not mine.endswith("aaa") else "bbb"), "x" + mine, mine[:20], "", "....", "a.b.c"):
        stranger = flask_app.test_client()
        stranger.set_cookie("gomat_session", broken)
        assert stranger.get("/api/gomat/me").get_json()["user"] is None, broken
    monkeypatch.setattr(accounts.auth, "max_age", -1)
    assert client.get("/api/gomat/me").get_json()["user"] is None                  # too old


def test_the_cookie_is_http_only_lax_and_scoped_to_the_whole_site(client):
    header = signup(client).headers.get_all("Set-Cookie")[0]
    assert header.startswith("gomat_session=") and "HttpOnly" in header and "SameSite=Lax" in header and "Path=/" in header and "Max-Age=2592000" in header
    out = post(client, "/api/gomat/logout").headers.get_all("Set-Cookie")
    assert out and out[0].startswith("gomat_session=;") and "Expires=Thu, 01 Jan 1970" in out[0]


# ---------------------------------------------------------------------------- behind the host's proxy

def test_one_person_cannot_sign_up_over_and_over_but_others_behind_the_same_proxy_can(client):
    limit = accounts.LIMITS["signup-ip"][0]
    codes = [post(flask_app.test_client(), "/api/gomat/signup", {**GOOD, "email": f"a{i}@example.com"}, headers={"X-Forwarded-For": "203.0.113.5, 10.0.0.1"}).status_code for i in range(limit + 2)]
    assert codes[:limit] == [200] * limit and codes[-1] == 429
    other = post(flask_app.test_client(), "/api/gomat/signup", {**GOOD, "email": "someone-else@example.com"}, headers={"X-Forwarded-For": "198.51.100.7, 10.0.0.1"})
    assert other.status_code == 200


def test_the_whole_site_is_protected_from_a_flood_even_if_every_visitor_looks_alike(client, monkeypatch):
    monkeypatch.setitem(accounts.LIMITS, "signup-flood", (5, 3600))
    codes = [post(flask_app.test_client(), "/api/gomat/signup", {**GOOD, "email": f"f{i}@example.com"}, headers={"X-Forwarded-For": f"203.0.113.{i + 1}, 10.0.0.1"}).status_code for i in range(8)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429] * 3


def test_the_forwarded_host_counts_as_the_site_when_checking_the_origin(client):
    ok = client.post("/api/gomat/signup", json=GOOD, headers={"Origin": "https://nexai.up.railway.app", "X-Forwarded-Host": "nexai.up.railway.app"})
    assert ok.status_code == 200
    other = client.post("/api/gomat/logout", json={}, headers={"Origin": "https://evil.example", "X-Forwarded-Host": "nexai.up.railway.app"})
    assert other.status_code == 403
