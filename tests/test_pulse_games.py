"""Nex: games of the community. A person builds a jump-and-run level (data) or uploads the code of a game (it runs only in a sealed worker); what the server checks, keeps and serves
(yipi_games.py), and the header that seals the worker."""
import json
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


def level(cols=40, **extra):
    rows = [["."] * cols for _ in range(9)]
    for c in range(cols):
        rows[7][c] = rows[8][c] = "#"
    rows[6][cols - 6] = "F"
    return {"map": ["".join(row) for row in rows], "theme": "night", "hero": "🦊", "speed": 3, **extra}


def test_a_level_is_only_data_the_game_understands():
    good = yipi_games.clean_platformer(level())
    stored = json.loads(good)
    assert stored["theme"] == "night" and stored["hero"] == "🦊" and stored["speed"] == 3 and len(stored["map"]) == 9 and stored["v"] == 1
    assert yipi_games.clean_platformer(json.dumps(level())) == good, "also as a text"
    for bad in (None, "no json", [], {"map": []}, level(cols=29), level(cols=121), {**level(), "map": level()["map"][:8]}, {**level(), "map": [row + "." for row in level()["map"][:1]] + level()["map"][1:]},
                {**level(), "map": [row.replace(".", "x", 1) for row in level()["map"]]}, {**level(), "map": ["<script>" + row[8:] for row in level()["map"]]}):
        assert yipi_games.clean_platformer(bad) is None, bad
    two = level()
    two["map"][5] = "F" + two["map"][5][1:]
    assert yipi_games.clean_platformer(two) is None, "one goal at most"
    many = level(cols=120)
    many["map"] = [row.replace(".", "o") if i < 4 else row for i, row in enumerate(many["map"])]
    assert yipi_games.clean_platformer(many) is None, "not a field of coins"
    odd = json.loads(yipi_games.clean_platformer({**level(), "theme": "lava", "hero": "<b>x</b>", "speed": 9}))
    assert odd["theme"] == "day" and odd["hero"] == yipi_games.HERO_DEFAULT and odd["speed"] == 2


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


def test_the_sample_code_of_the_page_is_the_sample_code_of_the_server():
    source = open(os.path.join(JS_DIR, "yipi-gamemaker.js"), encoding="utf-8").read()
    sample = re.search(r"const SAMPLE_CODE = `(.*?)`;\n", source, re.S).group(1)
    assert sample == yipi_games.SAMPLE_CODE.replace("\\", "\\\\") or sample == yipi_games.SAMPLE_CODE


def test_a_person_publishes_a_level_and_others_play_it(client):
    mia, tom = person("mia"), person("tom")
    made = mia.post("/api/yipi/community-games", json={"kind": "platformer", "title": "Mias Level", "emoji": "🦊", "color": "#58cf56", "level": level()})
    assert made.status_code == 201, made.get_json()
    game = made.get_json()["game"]
    assert re.fullmatch(r"gu-[0-9a-f]{8}", game["id"]) and game["kind"] == "platformer" and game["mine"] is True and game["draft"] is False and game["plays"] == 0 and "data" not in game
    seen = tom.get("/api/yipi/community-games").get_json()["items"]
    assert [item["id"] for item in seen] == [game["id"]] and seen[0]["mine"] is False and seen[0]["user"]["handle"] == "mia" and "data" not in seen[0]
    full = tom.get(f"/api/yipi/community-games/{game['id']}").get_json()["game"]
    assert json.loads(full["data"])["theme"] == "night"
    for _ in range(3):
        assert tom.post(f"/api/yipi/community-games/{game['id']}/play").status_code == 200
    assert tom.get("/api/yipi/community-games?sort=new").get_json()["items"][0]["plays"] == 3
    assert tom.delete(f"/api/yipi/community-games/{game['id']}").status_code == 403
    assert mia.delete(f"/api/yipi/community-games/{game['id']}").status_code == 200
    assert tom.get(f"/api/yipi/community-games/{game['id']}").status_code == 404 and tom.get("/api/yipi/community-games").get_json()["items"] == []
    assert flask_app.test_client().get("/api/yipi/community-games").status_code == 401


def test_what_is_wrong_is_said_and_a_level_that_is_not_a_level_is_refused(client):
    mia = person("mia")
    base = {"kind": "platformer", "title": "Level", "level": level()}
    assert mia.post("/api/yipi/community-games", json={**base, "title": "x"}).status_code == 400
    assert mia.post("/api/yipi/community-games", json={**base, "kind": "virus"}).status_code == 400
    assert mia.post("/api/yipi/community-games", json={**base, "title": "Hurensohn"}).status_code == 422
    assert mia.post("/api/yipi/community-games", json={**base, "level": {"map": ["#"]}}).status_code == 422
    bad = mia.post("/api/yipi/community-games", json={"kind": "code", "title": "Code", "code": "fetch('x')"})
    assert bad.status_code == 422 and bad.get_json()["error"] == "bad_code" and "draw" in bad.get_json()["message"]
    assert mia.post("/api/yipi/community-games", json={**base, "emoji": "<script>", "color": "red"}).get_json()["game"]["emoji"] == "🎮"


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
    level_game = mia.post("/api/yipi/community-games", json={"kind": "platformer", "title": "Level", "level": level()}).get_json()["game"]
    assert mia.get(f"/api/yipi/game-worker/{level_game['id']}").status_code == 404, "only a code game has a worker"
    assert mia.get("/api/yipi/game-worker/not-an-id").status_code == 404


def test_games_of_people_who_were_blocked_are_hidden_and_the_number_of_new_games_is_limited(client):
    mia, tom = person("mia"), person("tom")
    tom.post("/api/yipi/community-games", json={"kind": "platformer", "title": "Tomaten", "level": level()})
    assert len(mia.get("/api/yipi/community-games").get_json()["items"]) == 1
    assert mia.post("/api/yipi/users/tom/block").status_code == 200
    assert mia.get("/api/yipi/community-games").get_json()["items"] == []
    for _ in range(10):
        assert mia.post("/api/yipi/community-games", json={"kind": "platformer", "title": "Level", "level": level(), "draft": True}).status_code == 201
    assert mia.post("/api/yipi/community-games", json={"kind": "platformer", "title": "Level", "level": level()}).status_code == 429, "ten new games a day"
    assert [item["title"] for item in mia.get("/api/yipi/community-games?sort=mine").get_json()["items"]] == [], "drafts are not listed, not even for the author"


def test_the_camera_shows_the_games_and_the_page_may_run_workers_of_the_site_only(client):
    mia = person("mia")
    page = mia.get("/camera").headers["Content-Security-Policy"]
    assert "default-src 'self'" in page and "worker-src" not in page, "the workers come from the site itself (default-src), nothing else"
    assert "frame-ancestors 'none'" in page
    camera = open(os.path.join(JS_DIR, "yipi-camera.js"), encoding="utf-8").read()
    assert "Y.communityGames.fetch(game.id)" in camera and "ensureCommunity" in camera and "chosen.community" in camera
    bundle = flask_app.test_client().get("/pulse-games.js").data
    assert b"codeDef" in bundle and b"jr-huegel" in bundle
