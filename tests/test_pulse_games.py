"""Nex: games of the community. A person (or the AI for a person) writes the code of a game and publishes it (it runs only in a sealed worker); what the server checks, keeps and
serves (yipi_games.py), the games the AI writes, and the header that seals the worker. The jump-and-run builder is gone."""
import os
import re
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_games  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    yipi._agent_cache.update(at=None, ids=frozenset())
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()
    yipi._agent_cache.update(at=None, ids=frozenset())


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def publish(c, title="Ball", **extra):
    return c.post("/api/yipi/community-games", json={"kind": "code", "title": title, "emoji": "🟡", "color": "#58cf56", "code": yipi_games.SAMPLE_CODE, **extra})


def test_the_code_of_a_game_is_checked_and_the_worker_script_is_the_harness_and_the_code():
    code, reason = yipi_games.clean_code(yipi_games.SAMPLE_CODE)
    assert code == yipi_games.SAMPLE_CODE and reason == ""
    script = yipi_games.worker_script(code)
    assert script.startswith('"use strict";') and "OffscreenCanvas" in script and script.rstrip().endswith("}") and "function draw(g)" in script and script.index("game of the person starts here") < script.index("function draw(g)")
    for bad, why in ((None, "Schreib"), ("   ", "Schreib"), ("x" * (yipi_games.MAX_CODE + 1), "zu lang"), ("function update() {}", "draw"), ("function draw(g) { fetch('/api/yipi/me'); }", "fetch"),
                     ("function draw(g) { importScripts('x'); }", "importScripts"), ("function draw(g) { postMessage(1); }", "postMessage"), ("function draw(g) { new XMLHttpRequest(); }", "XMLHttpRequest"),
                     ("function draw(g) { eval('1'); }", "eval"), ("function draw(g) { localStorage.x = 1; }", "localStorage"), ("function draw(g) { const f = new Function('return 1'); }", "Function"),
                     ("function draw(g) {}\n\x00", "ungültig"), ("import x from 'y'; function draw(g) {}", "import")):
        result, message = yipi_games.clean_code(bad)
        assert result is None and why.lower() in message.lower(), (bad, message)
    assert yipi_games.clean_code("const draw = (g) => { g.closePath(); g.fillRect(0, 0, 1, 1); };")[0], "closePath is not close()"
    assert yipi_games.WORKER_CSP.startswith("default-src 'none'"), "no connections of any kind"


def test_a_person_publishes_a_game_and_others_play_it(client):
    mia, tom = person("mia"), person("tom")
    made = publish(mia, "Mias Spiel")
    assert made.status_code == 201, made.get_json()
    game = made.get_json()["game"]
    assert re.fullmatch(r"gu-[0-9a-f]{8}", game["id"]) and game["kind"] == "code" and game["mine"] is True and game["draft"] is False and game["plays"] == 0 and "data" not in game and game["icon"] is None
    seen = tom.get("/api/yipi/community-games").get_json()["items"]
    assert [item["id"] for item in seen] == [game["id"]] and seen[0]["mine"] is False and seen[0]["user"]["handle"] == "mia" and "data" not in seen[0]
    full = tom.get(f"/api/yipi/community-games/{game['id']}").get_json()["game"]
    assert full["data"].startswith("// Dein Spiel")
    for _ in range(3):
        assert tom.post(f"/api/yipi/community-games/{game['id']}/play").status_code == 200
    assert tom.get("/api/yipi/community-games?sort=new").get_json()["items"][0]["plays"] == 3
    assert tom.delete(f"/api/yipi/community-games/{game['id']}").status_code == 403
    assert mia.delete(f"/api/yipi/community-games/{game['id']}").status_code == 200
    assert tom.get(f"/api/yipi/community-games/{game['id']}").status_code == 404 and tom.get("/api/yipi/community-games").get_json()["items"] == []
    assert flask_app.test_client().get("/api/yipi/community-games").status_code == 401


def test_what_is_wrong_is_said_and_only_code_games_exist_now(client):
    mia = person("mia")
    assert publish(mia, "x").status_code == 400
    assert mia.post("/api/yipi/community-games", json={"kind": "virus", "title": "Spiel", "code": yipi_games.SAMPLE_CODE}).status_code == 400
    assert mia.post("/api/yipi/community-games", json={"kind": "platformer", "title": "Level", "level": {"map": ["#"]}}).status_code == 400, "the level builder is gone"
    assert publish(mia, "Hurensohn").status_code == 422
    bad = mia.post("/api/yipi/community-games", json={"kind": "code", "title": "Code", "code": "fetch('x')"})
    assert bad.status_code == 422 and bad.get_json()["error"] == "bad_code" and "draw" in bad.get_json()["message"]
    assert publish(mia, "Spiel", emoji="<script>", color="red").get_json()["game"]["emoji"] == "🎮"


def test_the_round_button_of_a_game_has_a_photo_of_the_author_and_only_of_the_author(client):
    mia, tom = person("mia"), person("tom")
    mia_id = yipi.YipiUser.query.filter_by(handle="mia").one().id
    mine = "a" * 32
    db.session.add(yipi.YipiMedia(id=mine, owner_id=mia_id, content_type="image/png", data=b"x", size=1, width=64, height=64, alt=""))
    db.session.commit()
    made = publish(mia, "Mit Foto", icon=mine).get_json()["game"]
    assert made["icon"] == f"/yipi-media/{mine}"
    assert publish(tom, "Geklaut", icon=mine).get_json()["game"]["icon"] is None, "a picture of somebody else is not taken"
    assert publish(mia, "Kaputt", icon="not-an-id").get_json()["game"]["icon"] is None
    changed = mia.put(f"/api/yipi/community-games/{made['id']}", json={"title": "Mit Foto 2", "code": yipi_games.SAMPLE_CODE}).get_json()["game"]
    assert changed["icon"] == f"/yipi-media/{mine}", "saving again keeps the photo"


def test_the_old_levels_are_removed_and_never_listed(client):
    mia = person("mia")
    mia_id = yipi.YipiUser.query.filter_by(handle="mia").one().id
    db.session.add(yipi.PulseGame(id="gu-00000001", owner_id=mia_id, kind="platformer", title="Altes Level", data="{}"))
    db.session.commit()
    assert mia.get("/api/yipi/community-games").get_json()["items"] == []
    assert mia.get("/api/yipi/community-games/gu-00000001").status_code == 404
    import yipi_company
    assert yipi_company.purge_levels() == 1 and yipi.PulseGame.query.count() == 0


def test_the_ai_writes_a_game_checks_it_like_the_code_of_a_person_and_tries_again_once(client, monkeypatch):
    mia = person("mia")
    good = "TITEL: Ballspiel\nSYMBOL: 🟡\n```javascript\n" + yipi_games.SAMPLE_CODE + "\n```"
    calls = []

    def fake(system, message, max_tokens=900, temperature=0.9, model=None):
        calls.append({"system": system, "message": message, "model": model})
        return good
    monkeypatch.setattr(yipi.ai_assistant, "generate_text", fake)
    reply = mia.post("/api/yipi/games/ai", json={"prompt": "Ein Ball, der über Balken springt"}).get_json()
    assert reply["ok"] and reply["title"] == "Ballspiel" and reply["emoji"] == "🟡" and "function draw(g)" in reply["code"]
    assert calls[0]["model"] == yipi.ai_assistant.GROQ_FALLBACK_MODEL and "360 mal 640" in calls[0]["system"] and "Ball, der über Balken" in calls[0]["message"]
    answers = iter(["Hier ist dein Spiel: function draw(g) {}", "TITEL: Zweiter Versuch\nSYMBOL: 🎯\n```js\nfunction draw(g) { g.fillRect(0, 0, 9, 9); }\n```"])
    monkeypatch.setattr(yipi.ai_assistant, "generate_text", lambda *args, **kwargs: next(answers))
    second = mia.post("/api/yipi/games/ai", json={"prompt": "Ein Zielspiel mit Punkten"}).get_json()
    assert second["ok"] and second["title"] == "Zweiter Versuch", "the second try is used"
    monkeypatch.setattr(yipi.ai_assistant, "generate_text", lambda *args, **kwargs: "TITEL: Böse\n```javascript\nfunction draw(g) { fetch('/x'); }\n```")
    refused = mia.post("/api/yipi/games/ai", json={"prompt": "Ein böses Spiel mit Netz"})
    assert refused.status_code == 502 and refused.get_json()["error"] == "ai_failed", "code that does not pass the checks is never handed out"
    assert mia.post("/api/yipi/games/ai", json={"prompt": "ab"}).status_code == 400
    assert mia.post("/api/yipi/games/ai", json={"prompt": "Ein Spiel mit Waffe und Bombe"}).status_code == 422
    assert flask_app.test_client().post("/api/yipi/games/ai", json={"prompt": "Ein Spiel"}).status_code == 401


def test_the_ai_that_chats_knows_the_game_format_when_somebody_talks_about_a_game(client, monkeypatch):
    seen = []

    def fake(system_prompt, message, max_tokens=600, temperature=0.7, model=None):
        seen.append(system_prompt)
        yield "ok"
    monkeypatch.setattr(yipi.ai_assistant, "generate_custom_stream", fake)
    mia = person("mia")
    mia.post("/api/yipi/nex", json={"messages": [{"role": "user", "content": "Baue mir ein Spiel für Nex"}], "mode": "code"})
    mia.post("/api/yipi/nex", json={"messages": [{"role": "user", "content": "Wie wird das Wetter morgen?"}], "mode": "code"})
    assert "360 mal 640" in seen[0] and "Als Spiel hochladen" in seen[0]
    assert "360 mal 640" not in seen[1], "not for every question"


def test_a_code_game_is_tried_as_a_draft_served_by_the_sealed_worker_and_published_later(client):
    mia, tom = person("mia"), person("tom")
    draft = mia.post("/api/yipi/community-games", json={"kind": "code", "title": "Ball", "emoji": "🟡", "code": yipi_games.SAMPLE_CODE, "draft": True})
    assert draft.status_code == 201 and draft.get_json()["game"]["draft"] is True
    game_id = draft.get_json()["game"]["id"]
    assert tom.get("/api/yipi/community-games").get_json()["items"] == [] and tom.get(f"/api/yipi/community-games/{game_id}").status_code == 404, "a draft is only for its author"
    assert tom.get(f"/api/yipi/game-worker/{game_id}").status_code == 404
    script = mia.get(f"/api/yipi/game-worker/{game_id}")
    assert script.status_code == 200 and script.mimetype == "application/javascript" and b"function draw(g)" in script.data and b"OffscreenCanvas" in script.data
    assert script.headers["Content-Security-Policy"].startswith("default-src 'none'"), "the script of the worker forbids every connection"
    assert script.headers["X-Content-Type-Options"] == "nosniff" and "no-store" in script.headers["Cache-Control"]
    assert flask_app.test_client().get(f"/api/yipi/game-worker/{game_id}").status_code == 401, "not for somebody who is not signed in"
    changed = mia.put(f"/api/yipi/community-games/{game_id}", json={"title": "Ball 2", "code": yipi_games.SAMPLE_CODE.replace("460", "500")})
    assert changed.status_code == 200 and b"vy = -500" in mia.get(f"/api/yipi/game-worker/{game_id}").data
    assert tom.put(f"/api/yipi/community-games/{game_id}", json={"title": "Geklaut", "code": yipi_games.SAMPLE_CODE}).status_code == 404
    assert mia.put(f"/api/yipi/community-games/{game_id}", json={"title": "Ball 2", "code": "fetch('x')"}).status_code == 422
    assert tom.post(f"/api/yipi/community-games/{game_id}/publish").status_code == 404
    assert mia.post(f"/api/yipi/community-games/{game_id}/publish").get_json()["game"]["draft"] is False
    assert [item["title"] for item in tom.get("/api/yipi/community-games").get_json()["items"]] == ["Ball 2"]
    assert tom.get(f"/api/yipi/game-worker/{game_id}").status_code == 200 and tom.get(f"/api/yipi/community-games/{game_id}").get_json()["game"]["data"].startswith("// Dein Spiel")
    assert mia.get("/api/yipi/game-worker/not-an-id").status_code == 404


def test_games_of_people_who_were_blocked_are_hidden_and_the_number_of_new_games_is_limited(client):
    mia, tom = person("mia"), person("tom")
    publish(tom, "Tomaten")
    assert len(mia.get("/api/yipi/community-games").get_json()["items"]) == 1
    assert mia.post("/api/yipi/users/tom/block").status_code == 200
    assert mia.get("/api/yipi/community-games").get_json()["items"] == []
    for _ in range(10):
        assert publish(mia, "Spiel", draft=True).status_code == 201
    assert publish(mia, "Spiel").status_code == 429, "ten new games a day"
    assert [item["title"] for item in mia.get("/api/yipi/community-games?sort=mine").get_json()["items"]] == [], "drafts are not listed, not even for the author"


def test_the_camera_shows_the_games_and_the_page_may_run_workers_of_the_site_only(client):
    mia = person("mia")
    page = mia.get("/camera").headers["Content-Security-Policy"]
    assert "default-src 'self'" in page and "worker-src" not in page, "the workers come from the site itself (default-src), nothing else"
    assert "frame-ancestors 'none'" in page
    camera = open(os.path.join(JS_DIR, "yipi-camera.js"), encoding="utf-8").read()
    assert "Y.communityGames.fetch(game.id)" in camera and "ensureCommunity" in camera and "chosen.community" in camera
    bundle = flask_app.test_client().get("/pulse-games.js").data
    assert b"codeDef" in bundle and b"jr-huegel" not in bundle and b"platformerDef" not in bundle, "the jump-and-run games and their builder are gone"
