"""Treff's page: the files it is made of agree with each other (the scripts in the right order, every style a script uses exists), nothing
a person writes is ever put on the page as HTML, links to other sites do not hand over the page, and the page stores only what the
privacy page says.  The functions that do not touch the page are tested in treff_core.test.js (run from here too)."""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
JS_DIR = os.path.join(ROOT, "static", "js")
SCRIPTS = ["treff-core.js", "treff-ui.js", "treff-api.js", "treff-render.js", "treff-chat.js", "treff-side.js", "treff.js"]
NODE = shutil.which("node")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


JS = {name: read("static", "js", name) for name in SCRIPTS}
CSS = read("static", "css", "treff.css")


def code_of(source):
    return re.sub(r"/\*.*?\*/|(?<![:\"'])//[^\n]*", "", source, flags=re.S)


def test_the_template_loads_the_scripts_in_dependency_order_and_nothing_inline():
    html = read("templates", "treff.html")
    assert re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", html) == SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", html):
        assert "src=" in tag, f"an inline script would break the content security policy: {tag}"
    for name in ("treff.html", "legal.html", "error.html"):
        text = read("templates", name)
        assert not re.search(r"\son[a-z]+\s*=", text), f"{name}: inline event handler"
        assert 'style="' not in text and "javascript:" not in text, name
        for path in re.findall(r"static_url\('([^']+)'\)", text):
            assert os.path.exists(os.path.join(ROOT, "static", *path.split("/"))), f"{name} loads {path}"


def test_every_script_is_listed_in_the_template_and_is_valid_javascript():
    on_disk = sorted(os.path.basename(path) for path in glob.glob(os.path.join(JS_DIR, "treff*.js")))
    assert on_disk == sorted(SCRIPTS), "a treff script that the page does not load (or the other way round)"
    if NODE is None:
        pytest.skip("Node.js is not installed")
    for name in on_disk:
        result = subprocess.run([NODE, "--check", os.path.join(JS_DIR, name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, f"{name}: {result.stderr[-800:]}"


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_the_node_tests_of_treff_pass():
    files = sorted(glob.glob(os.path.join(ROOT, "tests", "treff_*.test.js")))
    assert files
    result = subprocess.run([NODE, "--test"] + files, capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout


def test_nothing_a_person_writes_is_put_on_the_page_as_html_and_the_page_runs_no_foreign_code():
    for name, source in JS.items():
        code = code_of(source)
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie"):
            assert sink not in code, f"{name} uses {sink}"
        for address in re.findall(r"https?://[^\s\"'`)]+", code):
            assert address.startswith(("http://www.w3.org/2000/svg", "https://${", "http://${")), f"{name} points to {address}"
        assert "importScripts" not in code and "import(" not in code, name


def test_only_the_api_file_talks_to_the_server_and_only_the_server_of_this_site():
    for name, source in JS.items():
        code = code_of(source)
        for sink in ("XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"):
            assert sink not in code, f"{name} uses {sink}"
        if name != "treff-api.js":
            assert "fetch(" not in code, f"{name} makes a request"
    api = code_of(JS["treff-api.js"])
    assert api.count("fetch(") == 1 and "`/api/treff${path}`" in api and 'credentials: "omit"' in api


def test_links_to_other_sites_do_not_hand_over_the_page():
    for name, source in JS.items():
        for line in code_of(source).split("\n"):
            if 'target: "_blank"' in line:
                assert ("rel: REL" in line) or ("noopener" in line and "noreferrer" in line), f"{name}: {line.strip()[:120]}"
    assert 'const REL = "noopener noreferrer nofollow ugc"' in JS["treff-render.js"]


def test_the_page_stores_only_what_the_privacy_page_says():
    legal = read("templates", "legal.html")
    keys = set()
    for name, source in JS.items():
        keys |= set(re.findall(r'"(treff\.[a-z]+)"', code_of(source)))
        assert ("localStorage" in code_of(source)) == (name == "treff-api.js"), f"{name}: only treff-api.js keeps things in the browser"
        assert ("sessionStorage" in code_of(source)) == (name == "treff-side.js"), f"{name}: only the admin page keeps a word until the tab is closed"
    assert {"treff.key", "treff.seen", "treff.dismissed", "treff.intro"} <= keys
    for key in keys - {"treff.admin"}:
        assert key in legal, f"{key} is stored but the privacy page does not say so"
    assert "keine Cookies" in legal and "document.cookie" not in "".join(JS.values())


def test_every_style_variable_that_is_used_is_defined():
    defined = set(re.findall(r"(--[\w-]+)\s*:", CSS))
    used = set(re.findall(r"var\((--[\w-]+)", CSS))
    for source in JS.values():
        used |= set(re.findall(r"var\((--[\w-]+)", source))
    assert used and used <= defined, used - defined


CLASS_PATTERNS = [re.compile(pattern) for pattern in (r'\bclass:\s*"([^"]*)"', r"\bclass:\s*'([^']*)'", r'\.className\s*=\s*"([^"]*)"', r'classList\.(?:add|remove|toggle|contains)\("([^"]*)"')]


def class_names_in(source):
    names = set()
    for pattern in CLASS_PATTERNS:
        for text in pattern.findall(source):
            for token in re.sub(r"\$\{[^}]*\}", " ", text).split():
                if re.fullmatch(r"[a-z][\w-]*", token):
                    names.add(token)
    return names


# Classes that are only a marker for the script (nothing to draw).
MARKERS = {"on", "open", "important", "new-group", "time"}


def test_every_class_the_scripts_give_to_an_element_has_a_style():
    css_classes = set(re.findall(r"\.([a-z][\w-]*)", CSS))
    missing = {}
    for name, source in JS.items():
        for token in class_names_in(source):
            if token not in css_classes and token not in MARKERS:
                missing.setdefault(token, []).append(name)
    assert not missing, missing


def test_the_layout_has_two_panes_and_one_on_a_phone_and_hidden_things_stay_hidden():
    assert "[hidden] { display: none !important; }" in CSS, "a hidden element must be hidden whatever display its class says"
    assert "@media (max-width: 860px)" in CSS and '.app[data-pane="list"] .main { display: none; }' in CSS and '.app[data-pane="chat"] .side { display: none; }' in CSS
    assert "prefers-reduced-motion: reduce" in CSS and "prefers-color-scheme: light" in CSS
    assert "env(safe-area-inset-bottom)" in CSS and "env(safe-area-inset-top)" in CSS


def test_the_page_shows_the_numbers_the_way_the_task_says():
    assert 'userName = (number) => `user ${number}`' in read("static", "js", "treff-core.js")
    assert "100000, 999999" in read("treff.py")
    assert "Fakten!" in JS["treff-chat.js"] and "Wichtig!" in JS["treff-render.js"]
