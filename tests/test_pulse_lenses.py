"""Nex: face lenses. The effects are drawn in the browser (static/js/pl-face.js, tested in tests/pulse_face.test.js); here is what the server does: it turns a prompt
into a recipe of effect names (never code), keeps the lenses people publish, and remembers on a video which lens (or game) of the camera it was made with."""
import io
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
import yipi_lenses  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")


def read(name):
    with open(os.path.join(JS_DIR, name), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)


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


def mp4(extra=3000):
    return b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


def test_the_effects_of_the_server_are_the_effects_of_the_browser():
    in_browser = set()
    for name in ("pl-face.js", "pl-ar.js", "pl-ar-models.js", "pl-ar-decals.js"):
        in_browser |= set(re.findall(r'^  add\("([A-Za-z]+)"', read(name), re.M))
    assert sorted(in_browser) == sorted(yipi_lenses.EFFECTS), "the files of the lenses and yipi_lenses.py name the same effects"
    assert yipi_lenses.RETIRED <= set(yipi_lenses.EFFECTS)
    filters = re.search(r"const FILTERS = \{(.*?)\n  \};", read("pl-face.js"), re.S).group(1)
    assert sorted(re.findall(r"^    ([a-z]+): \{ label", filters, re.M)) == sorted(yipi_lenses.FILTERS)


def test_the_ready_made_lenses_use_only_effects_and_filters_that_exist():
    source = read("yipi-lenses.js")
    presets = re.findall(r'\["(l-[a-z0-9]+)", "([^"]+)", "([^"]+)", "(#[0-9a-f]{6})", "([^"]+)", \[([^\]]*)\], "([a-z]+)", "([^"]+)"\]', source)
    assert len(presets) >= 30, len(presets)
    ids = [row[0] for row in presets]
    assert len(set(ids)) == len(ids)
    for lens_id, name, emoji, color, prompt, fx, filter_name, category in presets:
        names = re.findall(r'"([A-Za-z]+)"', fx)
        assert names and len(names) <= yipi_lenses.MAX_FX and all(n in yipi_lenses.EFFECTS and n not in yipi_lenses.RETIRED for n in names), (lens_id, names)
        assert filter_name in yipi_lenses.FILTERS, (lens_id, filter_name)
        assert 2 <= len(name) <= 24 and prompt and category in ("Lustig", "Masken", "Tiere", "Liebe", "Fantasie", "Verzerrt", "Filter"), lens_id
    assert {"l-dumm", "l-zaehne", "l-sturmhaube"} <= set(ids), "the lenses of the examples of the user are there"


def test_a_recipe_only_names_effects_that_exist():
    assert yipi_lenses.clean_recipe(["sunglasses", "alert(1)", "sunglasses", 5, "crown"], "noir") == (["sunglasses", "crown"], "noir")
    assert yipi_lenses.clean_recipe("sunglasses", "x") == ([], "none")
    assert yipi_lenses.clean_recipe(list(yipi_lenses.EFFECTS), "warm")[0].__len__() == yipi_lenses.MAX_FX


def test_the_words_of_a_prompt_give_a_recipe_without_the_ai():
    for prompt, wanted in (("Mach die Person dumm aussehend", {"bigEyes", "propellerHat"}), ("Ein Hase mit riesigen Zähnen", {"bunnyEars", "bigTeeth"}), ("Setz mir eine schwarze Strickmaske auf", {"balaclava"}),
                           ("Ich bin ein Roboter", {"robot"}), ("Mach mich zum Zombie in der Nacht", {"zombie"})):
        recipe = yipi_lenses.make_recipe(prompt)
        assert recipe["source"] == "words" and wanted <= set(recipe["fx"]), (prompt, recipe)
        assert 2 <= len(recipe["title"]) <= 24 and recipe["filter"] in yipi_lenses.FILTERS and re.fullmatch(r"#[0-9a-f]{6}", recipe["color"]) and len(recipe["about"]) == len(recipe["fx"])
    assert yipi_lenses.make_recipe("xyzzy qwerty")["fx"], "something happens even when no word fits"
    assert yipi_lenses.make_recipe("Ich bin ein Zombie, es ist kalt")["filter"] in ("night", "cool")


def test_the_ai_chooses_the_effects_when_it_can_and_is_checked_when_it_does(monkeypatch):
    import ai_assistant
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    seen = []

    def good(system, message, max_tokens=0, temperature=0):
        seen.append((system, message))
        return 'Klar!\n{"title": "Matsch-Hase", "emoji": "🐰", "color": "#ff88aa", "fx": ["bunnyEars", "alert(1)", "buckTeeth", "hearts"], "filter": "dream"}'
    monkeypatch.setattr(ai_assistant, "generate_text", good)
    recipe = yipi_lenses.make_recipe("Ein süßer Hase")
    assert recipe["source"] == "ai" and recipe["fx"] == ["bunnyEars", "buckTeeth", "hearts"] and recipe["filter"] == "dream" and recipe["title"] == "Matsch-Hase" and recipe["emoji"] == "🐰"
    assert "bunnyEars" in seen[0][0] and "Ein süßer Hase" in seen[0][1], "it knows the list and the prompt"
    for bad in ("kein JSON", '{"fx": ["nichts"], "filter": "none"}', '{"fx": [], "filter": "none"}', '[1, 2]'):
        monkeypatch.setattr(ai_assistant, "generate_text", lambda *a, _bad=bad, **k: _bad)
        assert yipi_lenses.make_recipe("Ein Hase")["source"] == "words", bad

    def broken(*args, **kwargs):
        raise RuntimeError("down")
    monkeypatch.setattr(ai_assistant, "generate_text", broken)
    assert yipi_lenses.make_recipe("Ein Hase")["source"] == "words"
    monkeypatch.setattr(ai_assistant, "generate_text", lambda *a, **k: '{"title": "x", "emoji": "abc", "color": "red", "fx": ["crown"], "filter": "zzz"}')
    recipe = yipi_lenses.make_recipe("König")
    assert recipe["fx"] == ["crown"] and recipe["filter"] == "none" and re.fullmatch(r"#[0-9a-f]{6}", recipe["color"]) and not re.search(r"[A-Za-z]", recipe["emoji"])


def test_a_person_writes_a_prompt_publishes_the_lens_and_others_use_it(client):
    mia, tom = person("mia"), person("tom")
    reply = mia.post("/api/yipi/lenses/recipe", json={"prompt": "Mach die Person dumm aussehend mit großen Zähnen"})
    assert reply.status_code == 200, reply.get_json()
    recipe = reply.get_json()["recipe"]
    assert "bigEyes" in recipe["fx"] and "propellerHat" in recipe["fx"] and recipe["source"] == "words"
    made = mia.post("/api/yipi/lenses", json={"title": "Dummkopf 2", "prompt": "Mach die Person dumm aussehend mit großen Zähnen", "emoji": recipe["emoji"], "color": recipe["color"], "fx": recipe["fx"] + ["evil()"], "filter": "vivid"})
    assert made.status_code == 201, made.get_json()
    lens = made.get_json()["lens"]
    assert re.fullmatch(r"lu-[0-9a-f]{8}", lens["id"]) and lens["fx"] == recipe["fx"] and lens["filter"] == "vivid" and lens["mine"] is True and lens["user"]["handle"] == "mia" and lens["uses"] == 0
    seen = tom.get("/api/yipi/lenses?sort=popular").get_json()["items"]
    assert [item["id"] for item in seen] == [lens["id"]] and seen[0]["mine"] is False
    assert tom.get(f"/api/yipi/lenses/{lens['id']}").get_json()["lens"]["title"] == "Dummkopf 2"
    assert tom.post(f"/api/yipi/lenses/{lens['id']}/use").status_code == 200 and tom.post(f"/api/yipi/lenses/{lens['id']}/use").status_code == 200
    assert tom.get("/api/yipi/lenses?sort=new").get_json()["items"][0]["uses"] == 2
    assert [item["id"] for item in mia.get("/api/yipi/lenses?sort=mine").get_json()["items"]] == [lens["id"]] and tom.get("/api/yipi/lenses?sort=mine").get_json()["items"] == []
    assert tom.delete(f"/api/yipi/lenses/{lens['id']}").status_code == 403, "only the author (or an admin) deletes"
    assert mia.delete(f"/api/yipi/lenses/{lens['id']}").status_code == 200
    assert tom.get(f"/api/yipi/lenses/{lens['id']}").status_code == 404 and tom.get("/api/yipi/lenses").get_json()["items"] == []


def test_prompts_and_names_are_checked_and_the_number_of_lenses_is_limited(client):
    mia = person("mia")
    assert mia.post("/api/yipi/lenses/recipe", json={"prompt": "Zeig mich nackt"}).status_code == 422
    assert mia.post("/api/yipi/lenses/recipe", json={"prompt": "ab"}).status_code == 400
    assert mia.post("/api/yipi/lenses/recipe", json={"prompt": "Mit @tom und https://example.org"}).status_code == 422
    assert mia.post("/api/yipi/lenses/recipe", json={"prompt": "Mach mich dumm und doof"}).status_code == 200, "mild words are fine in a prompt"
    base = {"title": "Hase", "prompt": "Ein Hase", "fx": ["bunnyEars"], "filter": "none"}
    assert mia.post("/api/yipi/lenses", json={**base, "title": "x"}).status_code == 400
    assert mia.post("/api/yipi/lenses", json={**base, "fx": ["nope"]}).status_code == 400
    assert mia.post("/api/yipi/lenses", json={**base, "title": "Hurensohn"}).status_code == 422
    assert mia.post("/api/yipi/lenses", json={**base, "prompt": "ficken"}).status_code == 422
    assert mia.post("/api/yipi/lenses", json={**base, "emoji": "<script>", "color": "red"}).get_json()["lens"]["emoji"] == "✨"
    for _ in range(5):                                                   # (five tries were used above: ten a day, every try counts)
        assert mia.post("/api/yipi/lenses", json=base).status_code == 201
    assert mia.post("/api/yipi/lenses", json=base).status_code == 429, "ten tries a day"
    assert flask_app.test_client().post("/api/yipi/lenses/recipe", json={"prompt": "Ein Hase"}).status_code == 401


def test_lenses_of_people_who_were_blocked_are_not_shown_and_ai_accounts_make_none(client):
    mia, tom = person("mia"), person("tom")
    made = tom.post("/api/yipi/lenses", json={"title": "Tomaten", "prompt": "Eine Tomate", "fx": ["clownNose"], "filter": "warm"}).get_json()["lens"]
    assert [item["id"] for item in mia.get("/api/yipi/lenses").get_json()["items"]] == [made["id"]]
    assert mia.post("/api/yipi/users/tom/block").status_code == 200
    assert mia.get("/api/yipi/lenses").get_json()["items"] == []
    robot = yipi.YipiUser(handle="robo_x", handle_lc="robo_x", name="Robo X.", password_hash="!", agent_kind=1)
    db.session.add(robot)
    db.session.commit()
    assert robot.agent_kind == 1


def test_a_video_remembers_the_lens_or_game_it_was_made_with(client):
    mia, tom = person("mia"), person("tom")

    def upload(who, data, name, kind):
        r = who.post("/api/yipi/media", data={"file": (io.BytesIO(data), name), "width": "720", "height": "1280"}, content_type="multipart/form-data")
        assert r.status_code == 200, r.get_json()
        return r.get_json()["media"]["id"]

    video = upload(mia, mp4(), "clip.mp4", "video")
    made = mia.post("/api/yipi/posts", json={"text": "Mein Clip", "media": [video], "camId": "l-dumm"})
    assert made.status_code == 201 and made.get_json()["post"]["camId"] == "l-dumm"
    post_id = made.get_json()["post"]["id"]
    assert tom.get(f"/api/yipi/posts/{post_id}").get_json()["post"]["camId"] == "l-dumm"
    other = mia.post("/api/yipi/posts", json={"text": "Mit meiner Linse", "media": [upload(mia, mp4(3500), "b.mp4", "video")], "camId": "lu-0a1b2c3d"})
    assert other.get_json()["post"]["camId"] == "lu-0a1b2c3d"
    for bad in ("<script>", "UPPER", "x", "a" * 40, 5, ["l-dumm"]):
        reply = mia.post("/api/yipi/posts", json={"text": f"Mit komischer Id {str(bad)[:8]}", "media": [upload(mia, mp4(4000 + len(str(bad))), "c.mp4", "video")], "camId": bad})
        assert reply.status_code == 201 and "camId" not in reply.get_json()["post"], bad
    plain = mia.post("/api/yipi/posts", json={"text": "Nur Text", "camId": "l-dumm"})
    assert plain.status_code == 201 and "camId" not in plain.get_json()["post"], "only a video can carry it"


def test_the_face_lenses_are_a_file_of_their_own_and_the_page_may_run_the_model(client):
    mia = person("mia")
    lens = flask_app.test_client().get("/pulse-lens.js")
    assert lens.status_code == 200 and b"PulseFace" in lens.data and b"FaceLandmarker" in lens.data
    assert b"FaceLandmarker" not in flask_app.test_client().get("/pulse.js").data, "the main file stays small: the face tracking comes when the first lens is opened"
    page = mia.get("/camera")
    csp = page.headers["Content-Security-Policy"]
    assert "script-src 'self' 'wasm-unsafe-eval'" in csp and "connect-src 'self'" in csp and "'unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", ""), "WebAssembly yes, eval no"
    assert '"lens": "/pulse-lens.js?v=' in page.get_data(as_text=True)
    vendor = os.path.join(JS_DIR, "vendor", "mediapipe")
    for name, least in (("vision_bundle.js", 100_000), ("vision_wasm_internal.js", 100_000), ("vision_wasm_internal.wasm", 5_000_000), ("face_landmarker.task", 3_000_000), ("NOTICE.txt", 100)):
        assert os.path.getsize(os.path.join(vendor, name)) >= least, name
    wasm = flask_app.test_client().get("/static/js/vendor/mediapipe/vision_wasm_internal.wasm", headers={"Range": "bytes=0-3"})
    assert wasm.status_code in (200, 206) and wasm.data[:4] == b"\x00asm" and wasm.mimetype == "application/wasm"
