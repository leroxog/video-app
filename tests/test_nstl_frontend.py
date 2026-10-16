"""NSTL's page: the files it is made of agree with each other (the scripts in the right order, every style a script uses exists), the
page itself asks nothing but Wikipedia, and the agent swarm (which never touches the network) is not mistaken for a language model
anywhere in its own text.  The pure functions are tested by the Node tests run from here (tests/nstl_core.test.js, nstl_swarm.test.js)."""
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
PAGE_SCRIPTS = ["nstl-core.js", "nstl.js"]                 # what the page itself loads
WORKER = "nstl-swarm-worker.js"                            # loaded by nstl.js as a Worker; importScripts's nstl-swarm-core.js itself
WORKER_ONLY = ["nstl-swarm-core.js", WORKER]
NODE = shutil.which("node")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


PAGE_JS = {name: read("static", "js", name) for name in PAGE_SCRIPTS}
ALL_JS = {name: read("static", "js", name) for name in PAGE_SCRIPTS + WORKER_ONLY}
CSS = read("static", "css", "regal.css")
NSTL_CSS = read("static", "css", "nstl.css")


def code_of(source):
    return re.sub(r"/\*.*?\*/|(?<![:\"'])//[^\n]*", "", source, flags=re.S)


def test_the_template_loads_the_scripts_in_order_and_nothing_inline():
    html = read("templates", "nstl.html")
    assert re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", html) == PAGE_SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", html):
        assert "src=" in tag, f"an inline script would break the content security policy: {tag}"
    assert not re.search(r"\son[a-z]+\s*=", html), "inline event handler"
    assert 'style="' not in html and "javascript:" not in html
    assert "data-theme" not in html, "a fixed theme would keep light mode from ever being used"
    for path in re.findall(r"static_url\('([^']+)'\)", html):
        assert os.path.exists(os.path.join(ROOT, "static", *path.split("/"))), f"nstl.html loads {path}"


def test_every_nstl_script_exists_is_listed_and_is_valid_javascript():
    on_disk = sorted(os.path.basename(path) for path in glob.glob(os.path.join(JS_DIR, "nstl*.js")))
    assert on_disk == sorted(set(PAGE_SCRIPTS + WORKER_ONLY))
    if NODE is None:
        pytest.skip("Node.js is not installed")
    for name in on_disk:
        result = subprocess.run([NODE, "--check", os.path.join(JS_DIR, name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, f"{name}: {result.stderr[-800:]}"


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_the_node_tests_pass():
    files = sorted(glob.glob(os.path.join(ROOT, "tests", "nstl_*.test.js")))
    assert files
    result = subprocess.run([NODE, "--test"] + files, capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout


def test_the_page_puts_nothing_from_wikipedia_on_the_page_as_html_and_runs_no_foreign_code():
    for name, source in ALL_JS.items():
        code = code_of(source)
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie", "sessionStorage", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"):
            assert sink not in code, f"{name} uses {sink}"
        if name != WORKER:
            assert "importScripts" not in code and "import(" not in code, name
        for address in re.findall(r"https?://[^\s\"'`)]+", code):
            assert address.startswith(("https://de.wikipedia.org", "https://en.wikipedia.org", "http://www.w3.org/2000/svg", "https://${")), f"{name} points to {address}"


def test_only_the_page_script_fetches_and_only_wikipedia_with_no_credentials():
    fetches = {name: code_of(source).count("fetch(") for name, source in ALL_JS.items()}
    assert fetches == {"nstl-core.js": 0, "nstl.js": 1, "nstl-swarm-core.js": 0, WORKER: 0}, fetches
    assert 'credentials: "omit"' in PAGE_JS["nstl.js"]
    assert "NstlCore.searchUrl" in PAGE_JS["nstl.js"]


def test_the_worker_runs_the_swarm_and_nothing_else():
    worker = code_of(ALL_JS[WORKER])
    assert 'importScripts("nstl-swarm-core.js")' in worker
    assert "NstlSwarm.create(" in worker and "NstlSwarm.step(" in worker and "NstlSwarm.measure(" in worker and "NstlSwarm.paint(" in worker
    assert "fetch(" not in worker and "XMLHttpRequest" not in worker


def test_agents_are_never_called_a_language_model_and_the_page_says_so():
    html = read("templates", "nstl.html")
    legal = read("templates", "legal.html")
    for text in (html, legal):
        assert "keine Sprachmodelle" in text or "kein Sprachmodell" in text
    assert "besser als alle, die es gibt" in html, "the page must not itself claim the made-up language beats every other one"


def test_every_style_variable_that_is_used_is_defined():
    defined = set(re.findall(r"(--[\w-]+)\s*:", CSS))
    used = set(re.findall(r"var\((--[\w-]+)", NSTL_CSS))
    for source in ALL_JS.values():
        used |= set(re.findall(r"var\((--[\w-]+)", source))
    assert used and used <= defined, used - defined


def test_the_page_works_on_small_screens_and_respects_reduced_motion():
    assert "@media (max-width: 560px)" in NSTL_CSS and "prefers-reduced-motion: reduce" in NSTL_CSS


def test_no_module_asks_for_a_password_or_an_account():
    for name, source in ALL_JS.items():
        low = code_of(source).lower()
        for word in ("password", "passwort", "login"):
            assert word not in low, (name, word)
