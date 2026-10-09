"""raumo, the home page: what the server hands out (page, manifest, headers, the other pages around it), that the files of the page agree
with each other, and that the page keeps its promise of sending nothing anywhere.  The maths (points, rooms, files, the walk) is tested
in raumo_*.test.js; these tests run those too."""
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

import raumo  # noqa: E402
import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
JS_DIR = os.path.join(ROOT, "static", "js")
SCRIPTS = ["raumo-core.js", "raumo-cloud.js", "raumo-export.js", "raumo-store.js", "raumo-sim.js", "raumo-gl.js", "raumo-demo.js", "raumo-xr.js", "raumo-ui.js",
           "raumo-sensors.js", "raumo-bake.js", "raumo-scan.js", "raumo-walk.js", "raumo-editors.js", "raumo-project.js", "raumo-views.js", "raumo.js"]
NODE = shutil.which("node")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


JS = {name: read("static", "js", name) for name in SCRIPTS}
CSS = read("static", "css", "raumo.css")


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


# -------------------------------------------------------------------------------------------------- the server
def test_the_home_page_is_raumo_and_needs_no_account(client):
    response = client.get("/")
    assert response.status_code == 200
    text = response.get_data(as_text=True)
    assert "raumo" in text and 'id="app"' in text and "yipiBoot" not in text
    assert 'rel="manifest" href="/manifest.webmanifest"' in text
    assert "Set-Cookie" not in response.headers, "raumo knows no visitors: no cookie, no session"


def test_the_home_page_has_a_strict_policy_and_may_use_only_the_camera_and_the_sensors(client):
    response = client.get("/")
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "'unsafe-inline'" not in csp.split("style-src")[0] and "connect-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp and response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    policy = response.headers["Permissions-Policy"]
    for allowed in ("camera=(self)", "gyroscope=(self)", "accelerometer=(self)", "xr-spatial-tracking=(self)"):
        assert allowed in policy
    for refused in ("microphone=()", "geolocation=()", "payment=()"):
        assert refused in policy
    assert client.get("/", headers={"X-Forwarded-Proto": "https"}).headers["Strict-Transport-Security"].startswith("max-age=")


def test_the_manifest_lets_the_page_be_installed(client):
    response = client.get("/manifest.webmanifest")
    assert response.mimetype == "application/manifest+json"
    data = response.get_json()
    assert data["short_name"] == "raumo" and data["start_url"] == "/" and data["display"] == "standalone" and data["scope"] == "/"
    assert {icon["purpose"] for icon in data["icons"]} == {"any", "maskable"}
    for icon in data["icons"]:
        assert os.path.getsize(os.path.join(ROOT, icon["src"].lstrip("/").replace("/", os.sep))) > 200, icon["src"]
        assert client.get(icon["src"]).status_code == 200
    assert raumo.manifest() == data


def test_the_images_of_the_page_exist():
    for name in ("raumo-icon.svg", "raumo-180.png", "raumo-192.png", "raumo-512.png", "raumo-512-maskable.png", "raumo-og.png"):
        assert os.path.getsize(os.path.join(ROOT, "static", "img", name)) > 200, name
    html = read("templates", "raumo.html")
    for path in re.findall(r"static_url\('([^']+)'\)", html):
        assert os.path.exists(os.path.join(ROOT, "static", *path.split("/"))), path


def test_the_social_network_yipi_moved_to_its_archive_address(client):
    page = client.get("/yipi-archiv")
    text = page.get_data(as_text=True)
    assert page.status_code == 200 and 'id="yipiBoot"' in text and "raumo-core.js" not in text
    assert '<meta name="robots" content="noindex">' in text and "/yipi-archiv/manifest.webmanifest" in text
    assert client.get("/yipi-archiv/manifest.webmanifest").get_json()["start_url"] == "/yipi-archiv"
    assert client.get("/explore").status_code == 200 and b"yipiBoot" in client.get("/explore").data      # the links inside yipi keep working
    assert client.get("/nobody_here").status_code == 404
    robots = client.get("/robots.txt").get_data(as_text=True)
    assert "Disallow: /yipi-archiv" in robots and "Disallow: /gomat-archiv" in robots


def test_the_legal_pages_and_the_error_pages_belong_to_raumo(client):
    for path, words in (("/datenschutz", ("raumo", "IndexedDB", "nicht an uns oder andere gesendet", "yipi_session")), ("/impressum", ("§ 5 DDG",)),
                        ("/nutzungsbedingungen", ("yipi", "16 Jahren"))):
        response = client.get(path)
        text = response.get_data(as_text=True)
        assert response.status_code == 200 and "| raumo</title>" in text and 'href="/"' in text, path
        for word in words:
            assert word in text, (path, word)
        assert "Set-Cookie" not in response.headers
    error = client.get("/gibt-es-nicht-1234")
    assert error.status_code == 404 and "raumo" in error.get_data(as_text=True) and 'href="/"' in error.get_data(as_text=True)
    assert "Content-Security-Policy" in error.headers


def test_the_privacy_page_says_what_the_page_really_stores():
    page = read("templates", "legal.html")
    assert "IndexedDB" in page and "Kamera" in page and "Bewegungssensoren" in page and "ARCore" in page
    assert "indexedDB" in JS["raumo-store.js"] and "getUserMedia" in JS["raumo-sensors.js"] and "deviceorientation" in JS["raumo-sensors.js"].lower()
    for forbidden in ("Google Analytics", "AdSense", "Facebook", "doubleclick"):
        assert forbidden not in page


# ----------------------------------------------------------------------------------------- the files of the page
def test_the_template_loads_the_scripts_in_dependency_order_and_nothing_inline():
    html = read("templates", "raumo.html")
    assert re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", html) == SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", html):
        assert "src=" in tag, f"an inline script would break the content security policy: {tag}"
    for name in ("raumo.html", "legal.html", "error.html"):
        text = read("templates", name)
        assert not re.search(r"\son[a-z]+\s*=", text), f"{name}: inline event handler"
        assert 'style="' not in text and "javascript:" not in text, name


def test_every_script_is_listed_in_the_template_and_is_valid_javascript():
    on_disk = sorted(os.path.basename(path) for path in glob.glob(os.path.join(JS_DIR, "raumo*.js")))
    assert on_disk == sorted(SCRIPTS), "a raumo script that the page does not load (or the other way round)"
    if NODE is None:
        pytest.skip("Node.js is not installed")
    for name in SCRIPTS:
        result = subprocess.run([NODE, "--check", os.path.join(JS_DIR, name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, f"{name}: {result.stderr[-800:]}"


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_the_node_tests_of_raumo_pass():
    files = sorted(glob.glob(os.path.join(ROOT, "tests", "raumo_*.test.js")))
    assert len(files) >= 5
    result = subprocess.run([NODE, "--test"] + files, capture_output=True, text=True, timeout=600)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout


def test_the_page_sends_nothing_anywhere_and_writes_no_text_as_html():
    for name, source in JS.items():
        code = re.sub(r"/\*.*?\*/|(?<![:\"'])//[^\n]*", "", source, flags=re.S)
        for sink in ("fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "document.cookie", "localStorage", "sessionStorage"):
            assert sink not in code, f"{name} uses {sink}: the scans must not leave the device"
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"):
            assert sink not in code, f"{name} uses {sink}"
        for address in re.findall(r"https?://[^\s\"'`)]+", code):
            assert address.startswith("http://www.w3.org/2000/svg"), f"{name} points to {address}"
    assert "navigator.serviceWorker.register(\"/service-worker.js\")" in JS["raumo.js"]


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
            for token in text.split():
                if re.fullmatch(r"[a-z][\w-]*", token):
                    names.add(token)
    return names


# Classes that are only a marker for the script (nothing to draw), or that the browser or another style sheet answers for.
MARKERS = {"on", "open", "hidden", "active", "done", "selected", "dragging", "busy", "ready",
           "home", "help", "home-bar", "intro", "tall", "walk-hint", "opening-editor", "plan-editor-wrap"}      # (the second line only says what an element is)


def test_every_class_the_scripts_give_to_an_element_has_a_style():
    css_classes = set(re.findall(r"\.([a-z][\w-]*)", CSS))
    missing = {}
    for name, source in JS.items():
        for token in class_names_in(source):
            if token not in css_classes and token not in MARKERS:
                missing.setdefault(token, []).append(name)
    assert not missing, missing


def test_the_layout_works_on_small_screens_and_respects_reduced_motion():
    assert "@media (max-width:" in CSS or "@media (min-width:" in CSS
    assert "prefers-reduced-motion: reduce" in CSS
    assert "env(safe-area-inset-bottom)" in CSS and "env(safe-area-inset-top)" in CSS
    assert "min-width: auto" not in CSS


def test_the_scan_bar_cannot_be_wider_than_the_screen():
    """The bar of the practice walk once grew wider than a phone and pushed the whole picture sideways."""
    assert re.search(r"\.scan-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)", CSS)
    assert re.search(r"\.scan-controls\s*\{[^}]*flex-wrap:\s*wrap", CSS)
    assert re.search(r"\.scan\s*\{[^}]*overflow:\s*hidden", CSS)


def test_the_skip_link_does_not_change_the_address_of_the_page():
    html = read("templates", "raumo.html")
    assert 'class="skip" href="#main"' in html
    assert '.skip")?.addEventListener("click"' in JS["raumo.js"] and "preventDefault" in JS["raumo.js"]
