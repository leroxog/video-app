"""The start of Satürn (yipi-auth.js): the terms in short with "Akzeptieren" and "Anmelden", signing in in two pages, signing up in pages of one question each (the age is a slider: the server
only checks the number), and a colour for the picture and another for the banner of everybody who has none."""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def calm(monkeypatch):
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


def signup(client, handle, **extra):
    return client.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, **extra})


def test_the_slider_age_is_checked_and_not_kept(client):
    assert signup(client, "kid_a", age=12).get_json()["error"] == "too_young"
    assert signup(client, "kid_b", age=14).get_json()["error"] == "need_parents"
    assert signup(client, "kid_c", age=14, parents=True).status_code == 200
    adult = flask_app.test_client()
    reply = signup(adult, "grown_up", age=25)
    assert reply.status_code == 200 and reply.get_json()["me"]["name"] == "grown_up", "without a name the account is called like its handle"
    assert not any(column.name in ("age", "birthday", "birth_date") for column in yipi.YipiUser.__table__.columns), "the age is not stored"
    for bad in (130, -1, True, "20", 20.5, None):
        other = flask_app.test_client()
        assert signup(other, "bad_age", age=bad).status_code == 400, bad
    assert signup(flask_app.test_client(), "old_way", adult=True).status_code == 200, "the older way (a birthday or 'adult') still works"


def test_the_pages_say_what_the_person_asked_for():
    auth = read("static", "js", "yipi-auth.js")
    for text in ('"Akzeptieren"', '"Anmelden"', "Bevor du zu Satürn weitergehst", "Willkommen zurück!", "Bitte gib deinen Namen ein", "Bitte gib nun dein Passwort ein!", "Wie willst du heißen?",
                 "Gib bitte dein zukünftiges Passwort ein!", "Wir bitten dich für deine eigene Account Sicherheit dein Passwort erneut einzugeben", "Wie alt bist du???", 'type: "range"',
                 "Style verbessern?", "Dein Account sieht noch etwas leer aus willst du ihn verbessern?", '"Ja, gerne!"', '"Nein, danke"', "Mit Google anmelden"):
        assert text in auth, text
    assert "Pulse" not in auth and "auth-hero" not in auth, "nothing about Pulse at the side: one white column in the middle"
    assert 'localStorage.setItem(START' in auth and 'startState() === "accepted"' in auth, "the terms are asked once; signing up needs them"
    css = read("static", "css", "yipi.css")
    assert 'font-family: "Nunito"' in css and ".auth-white {" in css and ".wb-dialog {" in css and ".au-yes {" in css


def test_everybody_without_a_picture_has_a_colour_for_the_picture_and_another_for_the_banner():
    ui = read("static", "js", "yipi-ui.js")
    views = read("static", "js", "yipi-views.js")
    assert "Core.defaultColors(" in ui and "Core.defaultColors(user.handle).banner" in views and '"banner-name"' in views
    assert ".banner.plain, .edit-banner.plain { background: var(--banner" in read("static", "css", "yipi.css")
