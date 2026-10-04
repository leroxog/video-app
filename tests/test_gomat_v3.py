"""gomat, third round: the glass look, the rounder characters (drawn and shaded in code), the daily chest, and the
screens for accounts (landing, sign up, sign in, profile) -- everything that can be checked without a browser."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import gomat  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
NODE = shutil.which("node")
CSS = open(os.path.join(ROOT, "static", "css", "gomat.css"), encoding="utf-8").read()


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


# ------------------------------------------------------------------------------------------------- glass

def test_the_panels_are_frosted_glass_over_a_colourful_background():
    assert "backdrop-filter: var(--blur)" in CSS and "-webkit-backdrop-filter: var(--blur)" in CSS
    for token in ("--glass:", "--glass-2:", "--glass-edge:", "--glass-shadow:", "--glass-in:", "--blur:", "--mesh-a:", "--mesh-d:"):
        assert token in CSS, token
    for selector in (".card", ".topbar", ".side", ".bottomnav", ".modal", ".opt", ".l-foot", ".speech", ".field-group"):
        assert re.search(rf"(?m)^[^{{]*{re.escape(selector)}[,\s{{][^{{]*\{{[^}}]*backdrop-filter", CSS) or re.search(rf"{re.escape(selector)}[^{{]*,[^{{]*\{{\s*-webkit-backdrop-filter", CSS), selector
    assert ".bg i" in CSS and "@keyframes drift" in CSS
    assert re.search(r"body \{[^}]*background: transparent", CSS), "the body must not cover the moving background"


def test_glass_has_fallbacks_for_old_browsers_and_for_people_who_want_less_transparency():
    assert "@supports not ((backdrop-filter: blur(1px))" in CSS
    assert "prefers-reduced-transparency: reduce" in CSS
    assert "prefers-color-scheme: dark" in CSS and "--glass: rgba(26, 42, 58" in CSS


@pytest.mark.parametrize("path", ["/gomat-archiv", "/gomat-archiv/datenschutz", "/gomat-archiv/impressum"])
def test_every_page_has_the_background(client, path):
    assert '<div class="bg" aria-hidden="true"><i></i><i></i><i></i><i></i></div>' in client.get(path).get_data(as_text=True)


# ---------------------------------------------------------------------------------------------- characters

CHARACTER_SCRIPT = r"""
const fs = require("fs");
const window = {};
new Function("window", "document", fs.readFileSync(process.argv[1], "utf8"))(window, {});
const A = window.GomatArt;
const out = [];
for (const name of Object.keys(A.CAST)) for (const mood of ["happy", "cheer", "sad"]) for (const scene of ["", A.CAST[name].scene]) out.push({ name, mood, scene, svg: A.character(name, mood, scene) });
out.push({ name: "portrait", svg: A.portrait("gomi", "happy") }, { name: "chest", svg: A.chest() }, { name: "chest", svg: A.chest() }, { name: "unknown", svg: A.character("nobody", "angry") });
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def drawings():
    if NODE is None:
        pytest.skip("Node.js is not installed")
    result = subprocess.run([NODE, "-e", CHARACTER_SCRIPT, os.path.join(ROOT, "static", "js", "gomat-art.js")], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def test_every_drawing_is_valid_svg_and_every_gradient_it_uses_exists(drawings):
    assert len(drawings) == 4 * 3 * 2 + 4
    for item in drawings:
        tree = ET.fromstring(item["svg"])
        ids = {e.get("id") for e in tree.iter() if e.get("id")}
        used = set(re.findall(r"url\(#([\w-]+)\)", item["svg"]))
        assert used <= ids, (item["name"], used - ids)
        assert not [e for e in tree.iter() if e.tag.split("}")[-1] in ("script", "image", "foreignObject", "style")], item["name"]
        assert "javascript:" not in item["svg"].lower() and " on" not in re.sub(r'"[^"]*"', "", item["svg"]).lower().replace(" opacity", ""), item["name"]
        assert len(item["svg"]) < 16000, (item["name"], len(item["svg"]))


def test_two_drawings_never_share_a_gradient_name(drawings):
    seen = {}
    for index, item in enumerate(drawings):
        for gradient_id in re.findall(r'id="([\w-]+)"', item["svg"]):
            assert gradient_id not in seen, (gradient_id, item["name"], drawings[seen[gradient_id]]["name"])
            seen[gradient_id] = index


def test_the_characters_look_rounded_and_their_eyes_can_follow_the_pointer(drawings):
    for item in drawings:
        if item["name"] in ("gomi", "otto", "ben", "robi"):
            assert "radialGradient" in item["svg"] and "linearGradient" in item["svg"], item["name"]
            if item["mood"] != "cheer":
                assert 'class="ch-look"' in item["svg"], (item["name"], item["mood"])
            assert "ch-bob" in item["svg"] and ("ch-blink" in item["svg"] or item["mood"] == "cheer"), (item["name"], item["mood"])
    classes = {c for item in drawings for c in re.findall(r'class="([^"]*)"', item["svg"]) for c in c.split() if re.fullmatch(r"ch-[a-z0-9]+", c)}
    assert {"ch-look", "ch-ear", "ch-hair", "ch-scan", "ch-wave", "ch-tail", "ch-stache", "ch-gear", "ch-ball", "ch-banana"} <= classes
    for token in classes - {"ch-gomi", "ch-otto", "ch-ben", "ch-robi", "ch-happy"}:         # (names and the plain mood only label the drawing)
        assert f".{token}" in CSS, token


def test_unknown_names_and_moods_still_draw_gomi_happy(drawings):
    unknown = [item for item in drawings if item["name"] == "unknown"][0]["svg"]
    assert 'class="ch ch-gomi ch-happy"' in unknown


def test_the_chest_opens_with_css_only(drawings):
    chests = [item["svg"] for item in drawings if item["name"] == "chest"]
    assert len(chests) == 2 and all(re.search(r'class="chest-lid"', c) and "chest-gems" in c and "chest-glow" in c for c in chests)
    for rule in (".open .chest-lid", ".open .chest-gems", ".open .chest-glow", ".chest-side", ".chest-tag"):
        assert rule in CSS, rule


def test_the_pointer_makes_the_eyes_move_and_a_poke_makes_the_character_jump():
    script = read("static", "js", "gomat.js")
    assert "--lx" in script and "--ly" in script and "pointermove" in script and "touchstart" in script
    assert "function poke(" in script and '"poked"' in script and "sfx(\"poke\")" in script
    assert "--lx" in CSS and ".ch.poked .ch-bob" in CSS


def test_each_companion_has_their_own_voice():
    script = read("static", "js", "gomat.js")
    block = script[script.index("const LINES = {"):script.index("/* A click on a character")]
    for who in ("gomi", "otto", "ben", "robi"):
        part = block[block.index(f"    {who}: {{"):]
        part = part[:part.index("\n")]
        right, wrong, poke = (re.search(rf"{key}: \[([^\]]*)\]", part).group(1) for key in ("right", "wrong", "poke"))
        assert len(re.findall(r'"[^"]+"', right)) >= 4 and len(re.findall(r'"[^"]+"', poke)) >= 4, who
        wrong_lines = re.findall(r'"([^"]+)"', wrong)
        assert len(wrong_lines) >= 3 and any(line.startswith("Nicht ganz") for line in wrong_lines), who
        assert not [line for line in wrong_lines if re.search(r"dumm|falsch|schlecht|versagt", line, re.I)], who      # kind to a child who made a mistake
    assert "Leider" not in block


# ------------------------------------------------------------------------------------------------ accounts

def test_the_page_script_only_calls_routes_the_server_has():
    account = read("static", "js", "gomat-account.js")
    calls = re.findall(r'call\("(GET|POST|PUT)", "(/api/gomat/[a-z]+)"', account)
    assert len(calls) == 7
    rules = {(rule.rule, method) for rule in flask_app.url_map.iter_rules() for method in rule.methods}
    for method, path in calls:
        assert (path, method) in rules, (method, path)


def test_the_account_script_never_throws_and_keeps_its_note_small():
    account = read("static", "js", "gomat-account.js")
    assert "catch (error)" in account and "offline: true" in account and 'credentials: "same-origin"' in account
    assert "localStorage" not in account and "XMLHttpRequest" not in account and "eval(" not in account


def test_the_screens_for_accounts_say_what_they_should():
    script = read("static", "js", "gomat.js")
    for text in ("Mathe lernen: kostenlos, spielerisch und wirksam", "Jetzt starten", "Ich habe bereits ein Konto", "Erstelle dein Profil, um deinen Fortschritt zu speichern!",
                 "Konto erstellen", "Willkommen zurück!", "Anmelden", "Abmelden", "Passwort ändern", "Konto löschen", "Konto endgültig löschen", "Fortschritt sichern",
                 "Welchen Fortschritt behalten?", "Gespeichert", "Wird gespeichert", "Jetzt nicht", "Passwort anzeigen", "Wer soll dich beim Lernen begleiten?",
                 "Tagesgeschenk", "Datenschutzerklärung", "E-Mail oder Passwort stimmt nicht.", "Mit dieser E-Mail gibt es schon ein Konto.", "Zu viele Versuche."):
        assert text in script, text
    for field in ('"new-password"', '"current-password"', 'autocomplete: "email"', 'autocomplete: "given-name"', 'type: "email"', 'name: "password"'):
        assert field in script, field
    assert "Account.signup(" in script and "Account.login(" in script and "Account.logout()" in script and "Account.remove(" in script and "Account.changePassword(" in script


def test_the_profile_offers_an_account_and_the_text_matches_the_state():
    script = read("static", "js", "gomat.js")
    assert "function accountCard()" in script and "function syncBadge()" in script and "forgetDevice" in script
    assert "Es gibt keine Konten und keine Cookies" not in script
    assert "Ohne Konto wird dein Fortschritt nur in diesem Browser gespeichert" in script


def test_the_privacy_page_explains_the_account_and_its_cookie(client):
    text = client.get("/gomat-archiv/datenschutz").get_data(as_text=True)
    for fragment in ("Dein Konto (freiwillig)", "E-Mail-Adresse", "verschlüsselter Hash", "<code>session</code>", "30 Tage", "Konto löschen", "Kinder unter 16", "Du kannst ganz ohne Konto lernen"):
        assert fragment in text, fragment
    assert "Es gibt keine Konten" not in text and "setzt keine Cookies" not in text
    assert "Mit oder ohne Konto" in gomat.DESCRIPTION.replace("mit oder", "Mit oder") or "mit oder ohne Konto" in gomat.DESCRIPTION


def test_the_landing_and_the_forms_are_styled():
    for selector in (".landing .ld-top", ".ld-stage", ".ld-copy", ".ob-top", ".ob-back", ".ob-bar", ".guide", ".speech.beside", ".auth-form", ".field-group", ".field", ".field .eye",
                     ".auth-error", ".acct", ".sync", ".save-prompt", ".cast-pick", ".combo", ".flygem", ".say", ".chest-card"):
        assert selector in CSS, selector
    assert "@media (max-width: 859px) { .landing .ld-top .btn { display: none; } }" in CSS


def test_class_names_do_not_collide_with_the_side_menu():
    """The side menu is `.side`; an element called "side" next to a speech bubble once stretched it to full height."""
    script = read("static", "js", "gomat.js")
    assert not re.search(r'class: "[^"]*(?<![\w-])side(?![\w-])[^"]*"', script.replace('class: "side"', "")), "only the menu may be called side"
    assert "speech beside" in script and ".speech.side" not in CSS
