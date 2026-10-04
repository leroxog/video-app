"""Tests for gomat, the maths course: the curriculum, every exercise generator (the maths is re-checked
independently with exact fractions), the JSON API, the page, and the rules about colours and branding."""
import ast
import os
import re
import sys
import tempfile
from fractions import Fraction

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import gomat  # noqa: E402
from app import app as flask_app, db  # noqa: E402
from models import User  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SEEDS = range(60)
MINUS = "−"


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


# ------------------------------------------------------------- independent maths helpers

def eval_expr(expr):
    """Exact value of a +, -, *, /, ** expression (re-computes what a generator claims)."""
    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
            return Fraction(str(node.value))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -ev(node.operand)
        if isinstance(node, ast.BinOp):
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if isinstance(node.op, ast.Div):
                return left / right
            if isinstance(node.op, ast.Pow):
                assert right.denominator == 1
                return left ** int(right)
        raise ValueError(f"unsupported expression: {expr}")
    return ev(ast.parse(expr, mode="eval"))


def parse_display(text):
    """The number a displayed answer stands for ('−3', '3,5', '3/4', '50 %'), or None if it isn't a number."""
    t = text.strip().replace(MINUS, "-").replace(",", ".").replace("%", "").replace("°", "").strip()
    try:
        if "/" in t:
            top, bottom = t.split("/")
            return Fraction(top) / Fraction(bottom)
        return Fraction(t)
    except (ValueError, ZeroDivisionError):
        return None


def all_exercises(seeds=SEEDS):
    for lesson_id in gomat.LESSONS:
        for seed in seeds:
            for exercise in gomat.lesson_exercises(lesson_id, seed):
                yield lesson_id, seed, exercise


# ------------------------------------------------------------------------------ curriculum

def test_the_course_has_nine_units_each_ending_in_a_trophy_test():
    assert [u["id"] for u in gomat.UNITS] == list(range(1, 10))
    for unit in gomat.UNITS:
        assert 5 <= len(unit["lessons"]) <= 6 and unit["lessons"][-1]["test"] is True and unit["lessons"][-1]["icon"] == "trophy"
        assert all(not l.get("test") for l in unit["lessons"][:-1])
        assert [l["id"] for l in unit["lessons"]] == [f"{unit['id']}-{n}" for n in range(1, len(unit["lessons"]) + 1)]
    assert len(gomat.LESSONS) == sum(len(u["lessons"]) for u in gomat.UNITS)
    assert all(gomat.LESSON_ID_RE.fullmatch(lesson_id) for lesson_id in gomat.LESSONS)


def test_every_lesson_only_uses_known_generators():
    for lesson in gomat.LESSONS.values():
        assert lesson["mix"] and lesson["title"]
        for name, params, weight in lesson["mix"]:
            assert name in gomat.FAMILIES and isinstance(params, dict) and weight > 0, (lesson["id"], name)


def test_the_public_curriculum_hides_generator_details():
    units = gomat.public_curriculum()
    assert len(units) == 9 and set(units[0]) == {"id", "title", "desc", "color", "lessons"}
    assert set(units[0]["lessons"][0]) == {"id", "title", "icon", "test"}
    assert "mix" not in repr(units)


def test_no_unit_is_coloured_green():
    assert {u["color"] for u in gomat.UNITS}.isdisjoint({"green", "lime", "mint", "emerald", "teal"})
    assert len({u["color"] for u in gomat.UNITS}) == 9


# ---------------------------------------------------------------------------- exercises

def test_every_lesson_gives_the_right_number_of_different_exercises():
    for lesson_id, lesson in gomat.LESSONS.items():
        want = gomat.TEST_LENGTH if lesson.get("test") else gomat.LESSON_LENGTH
        for seed in SEEDS:
            exercises = gomat.lesson_exercises(lesson_id, seed)
            assert len(exercises) == want, (lesson_id, seed)
            assert len({gomat._signature(e) for e in exercises}) == want, (lesson_id, seed)


def test_lessons_are_repeatable_by_seed_and_different_across_seeds():
    first = [gomat.public(e) for e in gomat.lesson_exercises("3-2", 7)]
    assert first == [gomat.public(e) for e in gomat.lesson_exercises("3-2", 7)]
    assert first != [gomat.public(e) for e in gomat.lesson_exercises("3-2", 8)]


def test_every_exercise_is_well_formed():
    for lesson_id, seed, e in all_exercises(range(25)):
        where = (lesson_id, seed, e["prompt"])
        assert isinstance(e["prompt"], str) and 3 <= len(e["prompt"]) <= 170, where
        assert isinstance(e["explain"], str) and len(e["explain"]) >= 8, where
        for text in [e["prompt"], e["explain"]] + list(e.get("options") or []) + list(e.get("tokens") or []):
            assert not re.search(r"None|nan|inf\b|\{|\}", str(text)), (where, text)
        if e["type"] == "choice":
            assert 2 <= len(e["options"]) <= 4 and len(set(e["options"])) == len(e["options"]), where
            assert 0 <= e["answer"] < len(e["options"]) and all(len(o) <= 40 for o in e["options"]), where
        elif e["type"] == "input":
            assert re.fullmatch(rf"{MINUS}?\d+(,\d+)?", e["answer"]), where
        elif e["type"] == "match":
            lefts, rights = [p[0] for p in e["pairs"]], [p[1] for p in e["pairs"]]
            assert 3 <= len(lefts) <= 5 and len(set(lefts)) == len(lefts) and len(set(rights)) == len(rights), where
        elif e["type"] == "build":
            assert 3 <= len(e["answer"]) <= 6 and sorted(e["answer"]) == sorted(e["tokens"][:len(e["tokens"])]) or set(e["answer"]) <= set(e["tokens"]), where
            assert e["tokens"] != e["answer"] or len(set(e["tokens"])) == 1, where
        else:
            pytest.fail(f"unknown type {e['type']}")
        if e.get("visual"):
            assert e["visual"]["kind"] in {"dots", "array", "pie", "bar", "rect", "triangle"}, where


def test_the_maths_of_every_generated_answer_is_right():
    """Each generator reports the expression behind its answer; recompute it exactly and compare with
    what the exercise really shows as the right answer."""
    checked = 0
    for lesson_id, seed, e in all_exercises():
        meta = e.get("_meta")
        if not meta:
            continue
        expected = eval_expr(meta["expr"])
        assert expected == Fraction(meta["value"]), (lesson_id, e["prompt"], meta)
        shown = e["options"][e["answer"]] if e["type"] == "choice" else e["answer"]
        assert parse_display(shown) == expected, (lesson_id, seed, e["prompt"], shown, expected)
        checked += 1
    assert checked > 5000


def test_a_wrong_option_is_never_secretly_right():
    """No distractor may be the same number as the answer, however it is written (1/2 and 2/4, 0,5 and 50 %)."""
    for lesson_id, seed, e in all_exercises():
        if e["type"] != "choice":
            continue
        values = [parse_display(o) for o in e["options"]]
        if any(v is None for v in values):
            continue
        right = values[e["answer"]]
        assert [v for i, v in enumerate(values) if i != e["answer"] and v == right] == [], (lesson_id, e["prompt"], e["options"])


def test_matching_exercises_pair_things_that_really_belong_together():
    ops = {"×": "*", "÷": "/", MINUS: "-"}
    seen = set()
    for lesson_id, seed, e in all_exercises():
        if e["type"] != "match":
            continue
        if e["family"] == "match_calc":
            for left, right in e["pairs"]:
                expr = left
                for a, b in ops.items():
                    expr = expr.replace(a, b)
                assert eval_expr(expr) == Fraction(right), (lesson_id, left, right)
        elif e["family"] == "frac_match":
            for left, right in e["pairs"]:
                assert parse_display(left) == parse_display(right), (left, right)
        seen.add(e["family"])
    assert {"match_calc", "frac_match", "percent_match", "geometry_match"} <= seen


def test_sorting_exercises_have_the_right_order():
    count = 0
    for lesson_id, seed, e in all_exercises():
        if e["type"] != "build":
            continue
        numbers = [parse_display(t) for t in e["answer"]]
        assert numbers == sorted(numbers, reverse="groß nach klein" in e["prompt"]), (e["prompt"], e["answer"])
        count += 1
    assert count > 50


def test_pictures_agree_with_their_answers():
    kinds = set()
    for lesson_id, seed, e in all_exercises():
        v = e.get("visual")
        if not v:
            continue
        kinds.add(v["kind"])
        shown = e["options"][e["answer"]] if e["type"] == "choice" else e["answer"]
        if v["kind"] == "dots":
            assert 1 <= v["n"] <= 20 and parse_display(shown) == v["n"]
        elif v["kind"] == "array":
            assert parse_display(shown) == v["rows"] * v["cols"]
        elif v["kind"] in ("pie", "bar"):
            assert 0 < v["num"] < v["den"] and parse_display(shown) == Fraction(v["num"], v["den"])
        elif v["kind"] == "rect":
            w, h = v["w"], v["h"]
            assert parse_display(shown) in (2 * (w + h), w * h)
            assert ("Umfang" in e["prompt"]) == (parse_display(shown) == 2 * (w + h)) or w + h == w * h / 2
        elif v["kind"] == "triangle":
            assert parse_display(shown) == Fraction(v["base"] * v["height"], 2) and (v["base"] * v["height"]) % 2 == 0
    assert kinds == {"dots", "array", "pie", "bar", "rect", "triangle"}


def test_every_generator_is_used_by_the_curriculum():
    used = {name for lesson in gomat.LESSONS.values() for name, _, _ in lesson["mix"]}
    assert used == set(gomat.FAMILIES)


def test_units_get_harder_in_the_right_order():
    assert max(parse_display(e["answer"] if e["type"] == "input" else e["options"][e["answer"]]) or 0
               for lid in ("1-2", "1-3") for s in SEEDS for e in gomat.lesson_exercises(lid, s) if e["type"] != "match") <= 20
    mult = [e for s in SEEDS for e in gomat.lesson_exercises("3-1", s) if e["family"] == "times"]
    assert mult and all(re.fullmatch(r"(2|5|10) × \d+ = \?|\d+ × (2|5|10) = \?", e["prompt"]) for e in mult)


def test_german_text_and_decimals_use_a_comma():
    for lesson_id, seed, e in all_exercises(range(15)):
        for text in [e["prompt"]] + list(e.get("options") or []):
            assert not re.search(r"\d\.\d", text), (lesson_id, text)


def test_formatters():
    assert gomat.sgn(-3) == f"{MINUS}3" and gomat.sgn(4) == "4"
    assert gomat.dec(35) == "3,5" and gomat.dec(30, trim=True) == "3" and gomat.dec(305, 2) == "3,05" and gomat.dec(-5) == f"{MINUS}0,5"
    assert gomat.dec(250, 2, trim=True) == "2,5" and gomat.value_of(Fraction(6, 4)) == "3/2" and gomat.value_of(4) == "4"


def test_near_gives_three_plausible_wrong_numbers_even_in_tiny_ranges():
    import random
    rng = random.Random(1)
    for correct, low, high in [(5, 0, 10), (1, 0, 3), (9, 0, 9), (0, 0, 4), (50, 0, 100)]:
        out = gomat.near(rng, correct, low, high)
        assert len(out) == 3 and correct not in out and len(set(out)) == 3 and all(low <= o <= high for o in out), (correct, out)


def test_practice_rounds_only_use_units_up_to_the_chosen_one():
    for seed in range(20):
        families = {e["family"] for e in gomat.practice_exercises(2, 10, seed)}
        unit_families = {name for u in gomat.UNITS if u["id"] <= 2 for l in u["lessons"] for name, _, _ in l["mix"]}
        assert families <= unit_families and len(gomat.practice_exercises(2, 10, seed)) == 10


# ---------------------------------------------------------------------------------- API

def test_the_lesson_api_returns_a_playable_lesson_without_private_fields(client):
    r = client.get("/api/gomat/lesson/3-2?seed=5")
    data = r.get_json()
    assert r.status_code == 200 and data["ok"] is True and data["lesson"] == {"id": "3-2", "title": "3er und 4er", "unit": 3}
    assert len(data["exercises"]) == 10 and all("_meta" not in e for e in data["exercises"])
    assert r.get_json() == client.get("/api/gomat/lesson/3-2?seed=5").get_json()
    assert client.get("/api/gomat/lesson/3-2?seed=6").get_json() != data
    assert len(client.get("/api/gomat/lesson/3-4").get_json()["exercises"]) == 10
    assert len(client.get("/api/gomat/lesson/9-5").get_json()["exercises"]) == 12      # the unit test is longer


def test_the_lesson_api_without_a_seed_is_random_and_junk_seeds_are_harmless(client):
    a = client.get("/api/gomat/lesson/1-1").get_json()["exercises"]
    b = client.get("/api/gomat/lesson/1-1").get_json()["exercises"]
    assert a != b
    for seed in ("abc", "-5", "99999999999999999999", ""):
        assert client.get(f"/api/gomat/lesson/1-1?seed={seed}").status_code == 200


@pytest.mark.parametrize("lesson_id", ["0-1", "10-1", "1-0", "1-9", "9-9", "a-b", "1_1", "11", "1-1-1", "..", "1-1%20", "1-1/x"])
def test_unknown_lessons_are_404_json_or_plain_404(client, lesson_id):
    r = client.get(f"/api/gomat/lesson/{lesson_id}")
    assert r.status_code == 404


def test_the_practice_api(client):
    data = client.get("/api/gomat/practice?max_unit=3&n=8&seed=1").get_json()
    assert data["ok"] is True and len(data["exercises"]) == 8 and all("_meta" not in e for e in data["exercises"])
    assert len(client.get("/api/gomat/practice?max_unit=99&n=999").get_json()["exercises"]) == 20      # clamped
    assert len(client.get("/api/gomat/practice?max_unit=0&n=1").get_json()["exercises"]) == 5
    assert client.get("/api/gomat/practice?max_unit=x").status_code == 400
    assert len(client.get("/api/gomat/practice").get_json()["exercises"]) == 10


# -------------------------------------------------------------------------------- page

def test_the_home_page_is_gomat_open_to_everyone_and_sets_no_cookie(client):
    visitor = flask_app.test_client()
    home = visitor.get("/", headers={"Accept": "text/html"})
    text = home.get_data(as_text=True)
    assert home.status_code == 200 and "<title>gomat" in text and "gomat.js" in text and "gomat-core.js" in text
    assert home.headers.get_all("Set-Cookie") == []
    assert visitor.get("/api/gomat/lesson/1-1").headers.get_all("Set-Cookie") == []
    with flask_app.app_context():
        assert User.query.count() == 0
    assert 'id="gomatData"' in text and "Zahlen bis 20" in text and "Einheitstest" in text
    assert "ysound" not in text.lower()


def test_logging_in_still_works_and_the_session_cookie_is_still_set_there(client):
    r = client.post("/signup", data={"username": "alice", "password": "secret1", "password2": "secret1"})
    assert r.status_code in (302, 303) and client.get("/").status_code == 200
    assert any("session=" in c for c in r.headers.get_all("Set-Cookie"))


def test_the_page_loads_a_self_hosted_font_and_nothing_from_other_sites(client):
    text = flask_app.test_client().get("/").get_data(as_text=True)
    css = open(os.path.join(ROOT, "static", "css", "gomat.css"), encoding="utf-8").read()
    assert "/static/fonts/Nunito-Variable.ttf" in css and os.path.getsize(os.path.join(ROOT, "static", "fonts", "Nunito-Variable.ttf")) > 100_000
    for source in (text, css):       # nothing from other sites (the page's own address, e.g. in link previews, is fine)
        assert not re.search(r"https?://(?!www\.w3\.org|localhost)", source), re.findall(r"https?://[^\s\"')]+", source)
    assert os.path.exists(os.path.join(ROOT, "static", "fonts", "OFL-Nunito.txt"))


def test_the_look_is_blue_not_green_and_the_code_does_not_name_another_brand():
    css = open(os.path.join(ROOT, "static", "css", "gomat.css"), encoding="utf-8").read().lower()
    assert "--blue: #1cb0f6" in css or "--blue:#1cb0f6" in css
    for green in ("#58cc02", "#58a700", "#89e219", "#d7ffb8", "#78c800", "#46a302", "green", "lime"):
        assert green not in css, green
    for path in ("static/css/gomat.css", "static/js/gomat.js", "static/js/gomat-core.js", "templates/gomat.html", "gomat.py"):
        source = open(os.path.join(ROOT, path), encoding="utf-8").read().lower()
        assert "duolingo" not in source.replace("duolingo-style", ""), path


def test_the_page_script_builds_text_with_the_dom_never_with_user_data_in_html():
    source = open(os.path.join(ROOT, "static", "js", "gomat.js"), encoding="utf-8").read()
    unsafe = [line.strip() for line in source.splitlines() if "innerHTML" in line and not re.search(r"\b(ICON|SVG)\b|mascot\(", line)]
    assert unsafe == [] and "insertAdjacentHTML" not in source and "document.write" not in source and "eval(" not in source
