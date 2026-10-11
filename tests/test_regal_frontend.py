"""KI-Regal's page: the files it is made of agree with each other (the scripts in the right order, every style a script uses exists),
nothing from the list is ever put on the page as HTML, links to other sites do not hand over the page, and the page talks only to
Hugging Face and only for the files that a person chooses.  The functions that do not touch the page are tested in regal_core.test.js
(run from here too)."""
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
SCRIPTS = ["regal-core.js", "regal-ui.js", "regal-download.js", "regal.js"]
NODE = shutil.which("node")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


JS = {name: read("static", "js", name) for name in SCRIPTS}
CSS = read("static", "css", "regal.css")


def code_of(source):
    return re.sub(r"/\*.*?\*/|(?<![:\"'])//[^\n]*", "", source, flags=re.S)


def test_the_template_loads_the_scripts_in_dependency_order_and_nothing_inline():
    html = read("templates", "regal.html")
    assert re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", html) == SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", html):
        assert "src=" in tag, f"an inline script would break the content security policy: {tag}"
    for name in ("regal.html", "legal.html", "error.html"):
        text = read("templates", name)
        assert not re.search(r"\son[a-z]+\s*=", text), f"{name}: inline event handler"
        assert 'style="' not in text and "javascript:" not in text, name
        for path in re.findall(r"static_url\('([^']+)'\)", text):
            assert os.path.exists(os.path.join(ROOT, "static", *path.split("/"))), f"{name} loads {path}"


def test_every_script_is_listed_in_the_template_and_is_valid_javascript():
    on_disk = sorted(os.path.basename(path) for path in glob.glob(os.path.join(JS_DIR, "regal*.js")))
    assert on_disk == sorted(SCRIPTS), "a regal script that the page does not load (or the other way round)"
    if NODE is None:
        pytest.skip("Node.js is not installed")
    for name in on_disk:
        result = subprocess.run([NODE, "--check", os.path.join(JS_DIR, name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, f"{name}: {result.stderr[-800:]}"


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_the_node_tests_of_the_shelf_pass():
    files = sorted(glob.glob(os.path.join(ROOT, "tests", "regal_*.test.js")))
    assert files
    result = subprocess.run([NODE, "--test"] + files, capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout


ALLOWED = ("http://www.w3.org/2000/svg", "https://huggingface.co", "https://github.com/", "https://lmstudio.ai", "https://ollama.com", "https://${", "http://${")


def test_nothing_from_the_list_is_put_on_the_page_as_html_and_the_page_runs_no_foreign_code():
    for name, source in JS.items():
        code = code_of(source)
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie", "sessionStorage"):
            assert sink not in code, f"{name} uses {sink}"
        for address in re.findall(r"https?://[^\s\"'`)]+", code):
            assert address.startswith(ALLOWED), f"{name} points to {address}"
        assert "importScripts" not in code and "import(" not in code, name


def test_the_page_asks_only_for_its_own_list_and_for_the_files_a_person_chooses():
    for name, source in JS.items():
        code = code_of(source)
        for sink in ("XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"):
            assert sink not in code, f"{name} uses {sink}"
    fetches = {name: code_of(source).count("fetch(") for name, source in JS.items()}
    assert fetches == {"regal-core.js": 0, "regal-ui.js": 0, "regal-download.js": 1, "regal.js": 1}, fetches
    assert "fetch(root.dataset.models" in JS["regal.js"] and "Core.fileUrl(model.id, item.path, false)" in JS["regal-download.js"]
    assert 'credentials: "omit"' in JS["regal.js"]


def test_links_to_other_sites_do_not_hand_over_the_page():
    for name, source in JS.items():
        for line in code_of(source).split("\n"):
            if 'target: "_blank"' in line:
                assert "noopener" in line and "noreferrer" in line, f"{name}: {line.strip()[:120]}"
    assert 'a.rel = "noopener noreferrer"' in JS["regal-download.js"]


def test_the_page_stores_only_what_the_privacy_page_says():
    legal = read("templates", "legal.html")
    keys = set()
    for name, source in JS.items():
        keys |= set(re.findall(r'"(regal\.[a-z]+)"', code_of(source)))
        assert ("localStorage" in code_of(source)) == (name == "regal.js"), f"{name}: only regal.js keeps things in the browser"
    assert keys == {"regal.fav"}
    assert "regal.fav" in legal and "keine Cookies" in legal and "Hugging Face" in legal


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


# Classes that are only a marker for the script (nothing to draw) or are made from a name (fmt-gguf, lic-yes ...).
MARKERS = {"on", "open", "count", "bar", "more", "fav", "section", "size", "kind"}


def test_every_class_the_scripts_give_to_an_element_has_a_style():
    css_classes = set(re.findall(r"\.([a-z][\w-]*)", CSS))
    missing = {}
    for name, source in JS.items():
        for token in class_names_in(source):
            if token not in css_classes and token not in MARKERS:
                missing.setdefault(token, []).append(name)
    assert not missing, missing


def test_the_layout_works_on_small_screens_and_respects_reduced_motion_and_light_mode():
    assert "[hidden] { display: none !important; }" in CSS, "a hidden element must be hidden whatever display its class says"
    assert "@media (max-width: 560px)" in CSS and "grid-template-columns: repeat(auto-fill, minmax(min(290px, 100%), 1fr))" in CSS
    # a grid column that may not shrink below its content pushed the dialog out of a phone screen
    assert ".model-body { display: grid; grid-template-columns: minmax(0, 1fr);" in CSS
    assert "prefers-reduced-motion: reduce" in CSS and "prefers-color-scheme: light" in CSS
    assert "env(safe-area-inset-bottom)" in CSS and "env(safe-area-inset-top)" in CSS
    for page in ("regal.html", "legal.html", "error.html"):             # a fixed data-theme="dark" would keep the light colours from ever being used
        with open(os.path.join(ROOT, "templates", page), encoding="utf-8") as handle:
            assert "data-theme" not in handle.read(), page


def test_the_page_names_what_there_is_in_plain_words_and_promises_what_the_list_holds():
    core = JS["regal-core.js"]
    for word in ("Chat & Schreiben", "Bilder erzeugen", "Videos erzeugen", "Musik & Klänge", "Sprache vorlesen"):
        assert word in core, word
    assert "Gratis" in JS["regal.js"] and "Ohne Konto" in JS["regal.js"]
