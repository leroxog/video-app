"""Satürn, round 6: signing up and in -- the birthday (only the age is checked, nothing is kept), a phone number as a way to sign in, and Google."""
import os
import sys
import tempfile
from datetime import date, timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def fast_passwords(monkeypatch):
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


def signup(client, **fields):
    body = {"handle": "newbie", "password": PASSWORD, **fields}
    return client.post("/api/yipi/signup", json=body)


def test_the_age_comes_from_the_birthday_which_is_not_kept():
    today = date(2026, 10, 21)
    assert yipi.age_from("2010-10-21", today) == 16 and yipi.age_from("2010-10-22", today) == 15 and yipi.age_from("1990-02-28", today) == 36
    for bad in ("2026-10-22", "1899-01-01", "2010-02-30", "heute", "", None, 20100101, "2010-1-1"):
        assert yipi.age_from(bad, today) is None, bad


def test_the_birthday_decides_who_may_sign_up(client):
    today = yipi.utcnow().date()

    def years_ago(n):
        return (today - timedelta(days=365 * n + n // 4 + 2)).isoformat()

    assert signup(flask_app.test_client(), birthday=years_ago(20)).status_code == 200
    assert signup(flask_app.test_client(), handle="young1", birthday=years_ago(10)).get_json()["error"] == "too_young"
    teen = signup(flask_app.test_client(), handle="teen1", birthday=years_ago(14))
    assert teen.status_code == 400 and teen.get_json()["error"] == "need_parents"
    assert signup(flask_app.test_client(), handle="teen2", birthday=years_ago(14), parents=True).status_code == 200
    assert signup(flask_app.test_client(), handle="odd1", birthday="2020-13-45").get_json()["error"] == "bad_birthday"
    assert signup(flask_app.test_client(), handle="odd2", birthday=(today + timedelta(days=3)).isoformat()).get_json()["error"] == "bad_birthday"
    assert signup(flask_app.test_client(), handle="old1", adult=True).status_code == 200, "the box of the earlier page still works"
    assert signup(flask_app.test_client(), handle="none1").get_json()["error"] == "need_age"
    assert not hasattr(yipi.YipiUser, "birthday"), "the birthday is only looked at, never stored"


def test_a_phone_number_is_a_way_to_sign_in(client):
    assert yipi.normalise_phone("+49 151 1234 5678") == "+4915112345678" and yipi.normalise_phone("0049 (151) 1234-5678") == "+4915112345678"
    for bad in ("", "0151 1234567", "+0123456789", "+49", "abc", "+49 151 1234 5678 9999 1234", None, 49151):
        assert yipi.normalise_phone(bad) is None, bad
    made = signup(flask_app.test_client(), handle="phoney", phone="+49 151 1234 5678", adult=True)
    assert made.status_code == 200 and made.get_json()["me"]["phone"] == "+4915112345678"
    for text in ("+4915112345678", "+49 151 1234 5678", "0049 151 12345678"):
        r = flask_app.test_client().post("/api/yipi/login", json={"login": text, "password": PASSWORD})
        assert r.status_code == 200 and r.get_json()["me"]["handle"] == "phoney", text
    assert flask_app.test_client().post("/api/yipi/login", json={"login": "+4915112345678", "password": "wrong password"}).status_code == 401
    assert flask_app.test_client().post("/api/yipi/login", json={"login": "+4915199999999", "password": PASSWORD}).status_code == 401
    assert signup(flask_app.test_client(), handle="phoney2", phone="+4915112345678", adult=True).get_json()["error"] == "phone_taken"
    assert signup(flask_app.test_client(), handle="phoney3", phone="12", adult=True).get_json()["error"] == "bad_phone"
    assert flask_app.test_client().post("/api/yipi/login", json={"login": "phoney", "password": PASSWORD}).status_code == 200, "the name still works"


def test_google_sign_in_is_off_until_the_server_has_the_keys(client, monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET", raising=False)
    guest = flask_app.test_client()
    assert '"google": false' in guest.get("/").get_data(as_text=True).replace('"google":false', '"google": false')
    r = guest.get("/api/yipi/google/start")
    assert r.status_code == 302 and r.headers["Location"].endswith("/i/login?google=off")
    assert guest.get("/api/yipi/google/callback?code=x&state=y").headers["Location"].endswith("/i/login?google=off")


class FakeReply:
    def __init__(self, data, ok=True):
        self._data, self.ok = data, ok

    def json(self):
        return self._data


def test_google_sign_in_creates_or_finds_the_account(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    answer = {"sub": "1234567890", "email": "Lena@Example.com", "email_verified": True, "name": "Lena Muster"}
    monkeypatch.setattr(yipi.requests, "post", lambda url, **kw: FakeReply({"access_token": "tok"}))
    monkeypatch.setattr(yipi.requests, "get", lambda url, **kw: FakeReply(answer))
    guest = flask_app.test_client()
    assert '"google": true' in guest.get("/").get_data(as_text=True).replace('"google":true', '"google": true')
    start = guest.get("/api/yipi/google/start")
    assert start.status_code == 302 and start.headers["Location"].startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    assert "client_id=client-id" in start.headers["Location"] and "scope=openid+email+profile" in start.headers["Location"] and "redirect_uri=" in start.headers["Location"]
    state = guest.get_cookie("yipi_gstate").value
    assert f"state={state}" in start.headers["Location"]
    assert guest.get("/api/yipi/google/callback?code=abc&state=wrong").headers["Location"].endswith("/i/login?google=error"), "a wrong state is refused"
    done = guest.get(f"/api/yipi/google/callback?code=abc&state={state}")
    assert done.status_code == 302 and done.headers["Location"].endswith("/i/signup?google=1"), "no account yet: the sign-up page opens, with what Google said"
    pending = guest.get("/api/yipi/google/pending").get_json()
    assert pending["email"] == "lena@example.com" and pending["name"] == "Lena Muster"
    r = guest.post("/api/yipi/signup", json={"handle": "lena", "google": True, "birthday": "2000-05-05"})
    me = r.get_json()["me"]
    assert r.status_code == 200 and me["handle"] == "lena" and me["email"] == "lena@example.com" and me["name"] == "Lena Muster"
    user = yipi.YipiUser.query.filter_by(handle_lc="lena").first()
    assert user.google_sub == "1234567890" and user.password_hash
    assert guest.get("/api/yipi/google/pending").status_code == 404, "the note is used up"
    again = flask_app.test_client()
    again.get("/api/yipi/google/start")
    back = again.get(f"/api/yipi/google/callback?code=abc&state={again.get_cookie('yipi_gstate').value}")
    assert back.headers["Location"].endswith("/") and "signup" not in back.headers["Location"], "the second time Google signs the person in"
    assert again.get("/api/yipi/me").get_json()["me"]["handle"] == "lena"


def test_google_with_an_unconfirmed_address_or_a_broken_answer_is_refused(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    monkeypatch.setattr(yipi.requests, "post", lambda url, **kw: FakeReply({"access_token": "tok"}))
    for info in ({"sub": "1", "email": "a@b.de", "email_verified": False}, {"sub": "1"}, "junk", {"email": "a@b.de", "email_verified": True}):
        monkeypatch.setattr(yipi.requests, "get", lambda url, info=info, **kw: FakeReply(info))
        guest = flask_app.test_client()
        guest.get("/api/yipi/google/start")
        r = guest.get(f"/api/yipi/google/callback?code=abc&state={guest.get_cookie('yipi_gstate').value}")
        assert r.headers["Location"].endswith("/i/login?google=error"), info
    monkeypatch.setattr(yipi.requests, "post", lambda url, **kw: FakeReply({}, ok=False))
    guest = flask_app.test_client()
    guest.get("/api/yipi/google/start")
    assert guest.get(f"/api/yipi/google/callback?code=abc&state={guest.get_cookie('yipi_gstate').value}").headers["Location"].endswith("google=error")
    assert flask_app.test_client().post("/api/yipi/signup", json={"handle": "ghost", "google": True, "birthday": "2000-05-05"}).get_json()["error"] == "google_expired"


def test_a_google_account_with_the_same_address_is_linked(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "id")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "secret")
    signup(flask_app.test_client(), handle="martin", email="martin@example.com", adult=True)
    monkeypatch.setattr(yipi.requests, "post", lambda url, **kw: FakeReply({"access_token": "tok"}))
    monkeypatch.setattr(yipi.requests, "get", lambda url, **kw: FakeReply({"sub": "777", "email": "martin@example.com", "email_verified": True, "name": "Martin"}))
    guest = flask_app.test_client()
    guest.get("/api/yipi/google/start")
    r = guest.get(f"/api/yipi/google/callback?code=abc&state={guest.get_cookie('yipi_gstate').value}")
    assert r.headers["Location"].endswith("/") and guest.get("/api/yipi/me").get_json()["me"]["handle"] == "martin"
    assert yipi.YipiUser.query.filter_by(handle_lc="martin").first().google_sub == "777"
