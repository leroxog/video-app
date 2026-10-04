"""gomat, second round: speaking exercises, the placement test, the four characters, the sounds, the
master test, the coloured road and the animations."""
import json
import os
import re
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import gomat  # noqa: E402
from app import app as flask_app, db  # noqa: E402
from test_gomat import eval_expr, parse_display  # noqa: E402
from fractions import Fraction  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


# ------------------------------------------------------------------------------ speaking

def test_speaking_exercises_are_typed_number_answers_said_out_loud():
    spoken_total = 0
    for lesson_id, lesson in gomat.LESSONS.items():
        limit = gomat.SPEAK_PER_TEST if lesson.get("test") else gomat.SPEAK_PER_LESSON
        for seed in range(20):
            plain = gomat.lesson_exercises(lesson_id, seed)
            spoken = gomat.lesson_exercises(lesson_id, seed, speak=True)
            assert len(plain) == len(spoken)
            turned = [i for i, e in enumerate(spoken) if e["type"] == "speak"]
            assert len(turned) <= limit, (lesson_id, seed)
            for i, (a, b) in enumerate(zip(plain, spoken)):
                if i in turned:
                    assert i >= 2, "the first two exercises are never speaking exercises"
                    assert a["type"] == "input" and a["answer"] == b["answer"]
                    assert b["prompt"].endswith(a["prompt"]) and b["prompt"].startswith("Sag ")
                    assert gomat.SPOKEN_ANSWER_RE.fullmatch(b["answer"])
                else:
                    assert gomat.public(a) == gomat.public(b), (lesson_id, seed, i)
            spoken_total += len(turned)
    assert spoken_total > 200


def test_speaking_prompts_are_clean_german():
    seen = set()
    for lesson_id in gomat.LESSONS:
        for seed in range(15):
            for e in gomat.lesson_exercises(lesson_id, seed, speak=True):
                if e["type"] != "speak":
                    continue
                seen.add(e["prompt"].split(":")[0] if e["prompt"].startswith("Sag die") else "Sag deine Antwort laut.")
                assert e["prompt"] == e["prompt"].strip() and "  " not in e["prompt"]
                sum_like = not re.search(r"[A-Za-zÄÖÜäöüß]{4,}", e["prompt"].split("laut", 1)[1])
                assert e["prompt"].startswith("Sag die Lösung laut: " if sum_like else "Sag deine Antwort laut. "), e["prompt"]
    assert seen == {"Sag die Lösung laut", "Sag deine Antwort laut."}


def test_practice_rounds_can_have_one_speaking_exercise():
    rounds = [gomat.practice_exercises(9, 10, seed, speak=True) for seed in range(30)]
    assert all(sum(e["type"] == "speak" for e in r) <= 1 for r in rounds) and any(e["type"] == "speak" for r in rounds for e in r)
    assert all(e["type"] != "speak" for seed in range(30) for e in gomat.practice_exercises(9, 10, seed))


def test_the_apis_only_ask_for_speaking_when_the_browser_can_listen(client):
    def types(url):
        data = client.get(url).get_json()
        assert data["ok"] is True and "_meta" not in json.dumps(data)
        return [e["type"] for e in data["exercises"]]

    assert "speak" not in types("/api/gomat/lesson/3-2?seed=4")
    assert "speak" not in types("/api/gomat/lesson/3-2?seed=4&speak=0")
    assert "speak" not in types("/api/gomat/lesson/3-2?seed=4&speak=yes")
    assert "speak" in types("/api/gomat/lesson/3-2?seed=4&speak=1")
    test_id = gomat.UNITS[2]["lessons"][-1]["id"]
    assert types(f"/api/gomat/lesson/{test_id}?seed=4&speak=1").count("speak") <= gomat.SPEAK_PER_TEST
    assert "speak" in sum((types(f"/api/gomat/practice?max_unit=9&n=10&seed={s}&speak=1") for s in range(12)), [])


# ---------------------------------------------------------------------------- placement

def test_the_placement_api_has_a_few_questions_for_every_unit(client):
    r = client.get("/api/gomat/placement?seed=3")
    data = r.get_json()
    assert r.status_code == 200 and data["ok"] is True and data["questions"] == gomat.PLACEMENT_QUESTIONS == 10
    assert [u["unit"] for u in data["units"]] == list(range(1, 10))
    for unit in data["units"]:
        assert len(unit["exercises"]) == gomat.PLACEMENT_PER_UNIT == 3
        assert {e["type"] for e in unit["exercises"]} <= {"choice", "input"}
    assert "_meta" not in r.get_data(as_text=True)
    assert r.headers.get("Cache-Control") == "no-store" and r.headers.get_all("Set-Cookie") == []
    assert client.get("/api/gomat/placement?seed=3").get_json() == data
    assert client.get("/api/gomat/placement?seed=4").get_json() != data


def test_the_maths_of_every_placement_question_is_right():
    checked = 0
    for seed in range(40):
        for unit, e in gomat.placement_exercises(seed):
            meta = e.get("_meta")
            if not meta:
                continue
            expected = eval_expr(meta["expr"])
            assert expected == Fraction(meta["value"]), (unit, e["prompt"])
            shown = e["options"][e["answer"]] if e["type"] == "choice" else e["answer"]
            assert parse_display(shown) == expected, (unit, e["prompt"], shown, expected)
            checked += 1
    assert checked > 300


def test_placement_questions_come_from_their_own_unit():
    for seed in range(15):
        questions = gomat.placement_exercises(seed)
        assert len(questions) == 9 * gomat.PLACEMENT_PER_UNIT
        for unit, e in questions:
            families = {name for lesson in gomat.UNITS[unit - 1]["lessons"] if not lesson.get("test") for name, _, _ in lesson["mix"]}
            assert e["family"] in families, (unit, e["family"])
        for unit in range(1, 10):
            own = [gomat._signature(e) for u, e in questions if u == unit]
            assert len(set(own)) == len(own)


# ------------------------------------------------------------------------- characters, page

def test_every_unit_has_one_of_four_characters_and_they_exist_in_the_art():
    assert gomat.CAST == ("gomi", "otto", "ben", "robi")
    units = gomat.public_curriculum()
    assert [u["character"] for u in units] == [gomat.CAST[i % 4] for i in range(9)]
    art = read("static", "js", "gomat-art.js")
    for name, role in (("gomi", "der Mathe-Affe"), ("otto", "alt und nett"), ("ben", "der große Bruder"), ("robi", "der Roboter")):
        assert re.search(rf"{name}: \{{ name: \"[^\"]+\", role: \"{role}\"", art), name
    for scene in ("banana", "read", "ball", "gear"):
        assert f'scene: "{scene}"' in art


def test_the_page_hands_the_rules_to_the_script_and_loads_the_scripts_in_order(client):
    text = client.get("/").get_data(as_text=True)
    data = json.loads(re.search(r'<script type="application/json" id="gomatData">(.*?)</script>', text, re.S).group(1))
    core = read("static", "js", "gomat-core.js")
    assert data["passMistakes"] == gomat.TEST_MAX_MISTAKES == int(re.search(r"TEST_MAX_MISTAKES = (\d+)", core).group(1))
    assert data["placementQuestions"] == gomat.PLACEMENT_QUESTIONS == int(re.search(r"PLACEMENT_QUESTIONS = (\d+)", core).group(1))
    assert [u["character"] for u in data["units"]] == [gomat.CAST[i % 4] for i in range(9)]
    order = [text.index(f"js/{name}.js") for name in ("gomat-core", "gomat-art", "gomat-sound", "gomat")]
    assert order == sorted(order) and len(set(order)) == 4
    for name in ("css/gomat.css", "js/gomat.js", "js/gomat-core.js", "js/gomat-art.js", "js/gomat-sound.js"):
        version = int(os.path.getmtime(os.path.join(ROOT, "static", *name.split("/"))))
        assert f"/static/{name}?v={version}" in text, name


def test_the_unit_tests_are_called_meistertest():
    for unit in gomat.UNITS:
        assert unit["lessons"][-1]["title"] == "Meistertest"
    assert "Einheitstest" not in read("gomat.py") + read("static", "js", "gomat.js")


def test_the_screens_have_the_new_features_in_good_german():
    source = read("static", "js", "gomat.js")
    for text in ("Ich kann gerade nicht sprechen", "Überspringen", "Weiß ich nicht", "Schon aus der Schule raus", "Noch nicht in der Schule", "Kurzer Einstufungstest",
                 "Wie gut kannst du schon rechnen?", "In welcher Klassenstufe bist du?", "Meistertest nicht bestanden", "Meistertest bestanden!", "Einheit übersprungen!",
                 "Serien-Schutz", "Edelsteine", "Herzen auffüllen", "Dein Begleiter", "Sag es laut", "Wähle die richtige Antwort", "Schreibe die Antwort",
                 "Finde die Paare", "Du startest bei Einheit", "Ohne Test starten", "Zum Shop", "de-DE"):
        assert text in source, text
    shown = re.findall(r'"([^"\n]*)"|`([^`\n]*)`', source)         # every string of the script: nothing the learner reads says "Streak" or "Unit"
    for pair in shown:
        text = "".join(pair)
        assert not re.search(r"\bStreak\b|\bUnit\b|Leider|Mathe-Lerner", text), text


def test_the_speech_button_and_the_microphone_stay_inside_what_the_page_allows():
    source = read("static", "js", "gomat.js")
    assert "SpeechRecognition" in source and "muteSpeaking" in source and "canSpeakNow" in source
    headers = flask_app.test_client().get("/").headers
    assert "script-src 'self'" in headers["Content-Security-Policy"] and "connect-src 'self'" in headers["Content-Security-Policy"]
    assert "microphone=(self)" in headers["Permissions-Policy"] and "camera=()" in headers["Permissions-Policy"]


# --------------------------------------------------------------------------------- sounds

def test_every_sound_the_page_asks_for_exists():
    script = read("static", "js", "gomat.js")
    wanted = set(re.findall(r"sfx\(\"(\w+)\"\)", script)) | set(re.findall(r"snd: \"(\w+)\"", script))
    wanted.discard("none")
    made = set(re.findall(r"^    (\w+): \(\) =>", read("static", "js", "gomat-sound.js"), re.M))
    assert wanted and wanted <= made, wanted - made
    assert len(made) >= 20
    unused = made - wanted - {"tap"}
    assert len(unused) <= 6, unused


# -------------------------------------------------------------------------------- the look

CSS = read("static", "css", "gomat.css")


def rule(selector):
    match = re.search(rf"(?m)^{re.escape(selector)} \{{([^}}]*)\}}", CSS)
    assert match, selector
    return match.group(1)


def test_the_road_has_the_colour_of_its_unit_and_locked_nodes_are_grey():
    assert "var(--u)" in rule(".node") and "var(--ud)" in rule(".node")
    assert "var(--gray)" in rule(".node.locked")
    assert "gold" not in rule(".node")
    for color in ("blue", "purple", "orange", "pink", "cyan", "indigo", "red", "violet", "gold"):
        assert f'.unit[data-color="{color}"]' in CSS


def test_the_unit_banner_is_part_of_the_page_and_the_top_bar_is_always_there():
    assert "sticky" not in rule(".unit-banner")
    assert "position: sticky" in rule(".topbar")
    assert not re.search(r"\.topbar\s*\{[^}]*display:\s*none", CSS)
    script = read("static", "js", "gomat.js")
    for kind in ('"streak"', '"gems"', '"hearts"'):
        assert f"chip({kind}" in script


def test_every_animation_in_the_css_is_defined():
    defined = set(re.findall(r"@keyframes (\w+)", CSS))
    used = set(re.findall(r"animation(?:-name)?:\s*(?:[\d.]+m?s\s+)?([a-zA-Z]\w*)", CSS)) - {"none", "infinite", "both", "ease", "linear", "forwards"}
    assert used <= defined, used - defined
    assert len(defined) >= 40, "gomat is animated everywhere"
    assert "prefers-reduced-motion: reduce" in CSS


def test_the_characters_have_every_animation_they_ask_for():
    art = read("static", "js", "gomat-art.js")
    classes = {token for group in re.findall(r'class="([^"]*)"', art) for token in group.split() if re.fullmatch(r"ch-[a-z0-9]+", token)}
    assert len(classes) >= 12
    for token in classes:
        assert f".{token}" in CSS, token


def test_the_name_gomat_is_set_in_a_very_heavy_rounded_face():
    assert "font-weight: 1000" in rule(".logo .word, .wordmark")
    assert "Nunito" in CSS
    assert os.path.getsize(os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")) > 100_000
