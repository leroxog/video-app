"""yipi's page: the files the page is made of agree with each other and with the server (every address the script calls exists,
every style the script uses exists, nothing writes user text as HTML), and the pages around the app (legal pages, manifest, robots,
error pages) are there. The behaviour of the helper functions is tested in yipi_core.test.js, the API in test_yipi.py."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

import pytest
from werkzeug.exceptions import MethodNotAllowed, NotFound

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
JS_DIR = os.path.join(ROOT, "static", "js")
SCRIPTS = ["yipi-core.js", "yipi-icons.js", "yipi-api.js", "yipi-ui.js", "yipi-components.js", "yipi-views.js", "yipi-pages.js", "yipi.js"]


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


JS = {name: read("static", "js", name) for name in SCRIPTS + ["yipi-theme.js"]}
CSS = read("static", "css", "yipi.css")


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


# ------------------------------------------------------------------------------------------- the page
def test_template_loads_the_scripts_in_dependency_order():
    html = read("templates", "yipi.html")
    sources = re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", html)
    assert sources == ["yipi-theme.js"] + SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", html):
        assert "src=" in tag or 'type="application/json"' in tag, f"an inline script would break the content security policy: {tag}"


def test_the_templates_have_nothing_a_strict_policy_would_block():
    for name in ("yipi.html", "yipi_legal.html", "yipi_error.html"):
        text = read("templates", name)
        assert not re.search(r"\son[a-z]+\s*=", text), f"{name}: inline event handler"
        assert 'style="' not in text and "javascript:" not in text, name


def test_every_file_the_templates_load_exists():
    for template in ("yipi.html", "yipi_legal.html", "yipi_error.html"):
        html = read("templates", template)
        for path in re.findall(r"static_url\('([^']+)'\)", html):
            assert os.path.exists(os.path.join(ROOT, "static", *path.split("/"))), f"{template} loads {path}"


def test_the_images_of_the_page_and_the_manifest_exist():
    for name in ("yipi-icon.svg", "yipi-180.png", "yipi-192.png", "yipi-512.png", "yipi-512-maskable.png", "yipi-og.png"):
        assert os.path.getsize(os.path.join(ROOT, "static", "img", name)) > 200, name
    for icon in yipi.manifest()["icons"]:
        assert os.path.exists(os.path.join(ROOT, icon["src"].lstrip("/").replace("/", os.sep))), icon["src"]


def test_the_shell_is_served_with_a_strict_policy_and_the_boot_data(client):
    response = client.get("/")
    assert response.status_code == 200
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "'unsafe-inline'" not in csp.split("style-src")[0]
    assert response.headers["X-Frame-Options"] == "DENY"
    assert 'id="yipiBoot"' in response.get_data(as_text=True)
    assert "Set-Cookie" not in response.headers, "a visitor without an account gets no cookie"


# ---------------------------------------------------------------------------------------- the script and the server
def js_literal_to_path(literal):
    """`/users/${handle}/posts` becomes /users/1/posts (an id and a name are both matched by a plain "1")."""
    return re.sub(r"\$\{[^}]*\}", "1", literal).split("?")[0]


def matches(path, method):
    adapter = flask_app.url_map.bind("localhost")
    try:
        adapter.match(path, method=method)
        return True
    except (NotFound, MethodNotAllowed):
        return False


# Addresses the script puts together from a name it knows at run time: all the names it can use.
KINDS = {"/users/${handle}/${kind}": ["/users/${handle}/followers", "/users/${handle}/following"],
         "/settings/${kind}": ["/settings/muted", "/settings/blocked"]}


def test_every_address_the_script_calls_exists_on_the_server_with_that_method():
    methods = {"get": "GET", "post": "POST", "patch": "PATCH", "del": "DELETE", "upload": "POST"}
    found = []
    for name, source in JS.items():
        for verb, quote, literal in re.findall(r"Api\.(get|post|patch|del|upload)\(\s*([`\"'])(/[^`\"']*)\2", source):
            found.append((name, methods[verb], literal))
        for quote, literal in re.findall(r"\bqs\(\s*([`\"'])(/[^`\"']*)\1", source):
            found.append((name, "GET", literal))
    assert len(found) > 40, "the pattern that finds the calls stopped working"
    for name, method, literal in found:
        for concrete in KINDS.get(literal, [literal]):
            path = "/api/yipi" + js_literal_to_path(concrete)
            assert matches(path, method), f"{name}: {method} {literal} is not a route of the server"


def test_calls_that_hand_the_address_over_use_addresses_the_server_knows():
    """Yip buttons hand their address (/posts/<id>/like ...) to a helper, so the pattern above cannot see them."""
    source = JS["yipi-components.js"]
    for literal, method in (("/posts/${item.id}/like", "POST"), ("/posts/${item.id}/repost", "POST"), ("/posts/${item.id}/bookmark", "POST"),
                            ("/posts/${item.id}/like", "DELETE"), ("/posts/${item.id}/repost", "DELETE"), ("/posts/${item.id}/bookmark", "DELETE"),
                            ("/posts/${item.id}", "DELETE")):
        assert literal in source, literal
        assert matches("/api/yipi" + js_literal_to_path(literal), method), (literal, method)


def test_the_pages_the_router_knows_are_served_by_the_server():
    """A reload or a shared link on any address of the app must find a page (the shell) and not an error."""
    adapter = flask_app.url_map.bind("localhost")
    for path in ("/", "/explore", "/notifications", "/messages", "/messages/mia", "/bookmarks", "/settings", "/settings/display", "/search",
                 "/moderation", "/i/login", "/i/signup", "/mia", "/mia/status/1", "/mia/followers", "/mia/following"):
        adapter.match(path, method="GET")


def test_the_script_and_the_server_agree_on_the_limits():
    core = JS["yipi-core.js"]
    assert f"MAX_POST = {yipi.MAX_POST}" in core
    assert f"MAX_MEDIA = {yipi.MAX_MEDIA}" in core
    components = JS["yipi-components.js"]
    assert f"{yipi.MAX_IMAGE_BYTES // (1024 * 1024)} * 1024 * 1024" in components
    assert 'maxlength: 1000' in JS["yipi-pages.js"] and yipi.MAX_DM == 1000
    views = JS["yipi-views.js"]
    assert f"maxlength: {yipi.MAX_NAME}" in views and f"maxlength: {yipi.MAX_BIO}" in views
    assert f"maxlength: {yipi.MAX_LOCATION}" in views and f"maxlength: {yipi.MAX_WEBSITE}" in views


def test_every_message_the_server_can_send_has_a_german_sentence():
    api = JS["yipi-api.js"]
    messages = set(re.findall(r"^\s{4}(\w+): \"", api, re.M))
    server = read("yipi.py")
    errors = set(re.findall(r"fail\(\"(\w+)\"", server))
    missing = errors - messages
    assert not missing, f"errors without a message in yipi-api.js: {sorted(missing)}"


def test_the_reasons_for_a_report_are_the_ones_the_server_accepts():
    listed = re.findall(r"\[\"(\w+)\", \"[^\"]+\"\]", re.search(r"const REASONS = \[(.*?)\];", JS["yipi-components.js"], re.S).group(1))
    assert tuple(listed) == yipi.REPORT_REASONS


# ------------------------------------------------------------------------------------------- safety of the script
def test_user_text_is_never_written_as_html():
    for name, source in JS.items():
        code = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
        code = re.sub(r"(?m)^\s*//.*$", "", code)
        if name == "yipi-icons.js":
            assert code.count("innerHTML") == 2, "only the fixed drawings of the icons and the logo may use innerHTML"
            continue
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "setTimeout(\"", "javascript:"):
            assert sink not in code, f"{name} uses {sink}"


def test_the_icon_drawings_do_not_contain_anything_but_shapes():
    icons = JS["yipi-icons.js"]
    for forbidden in ("<script", "onload", "onerror", "<foreignObject", "href="):
        assert forbidden not in icons


def test_links_to_other_sites_do_not_hand_over_the_page():
    for name, source in JS.items():
        for tag in re.findall(r"h\(\"a\",\s*\{[^}]*target:\s*\"_blank\"[^}]*\}", source):
            assert "noopener" in tag or "rel:" in tag, f"{name}: {tag}"
    assert 'rel: "noopener noreferrer nofollow ugc"' in JS["yipi-ui.js"]


# ------------------------------------------------------------------------------------------------ the styles
def defined_variables():
    return set(re.findall(r"(--[\w-]+)\s*:", CSS))


def test_every_style_variable_that_is_used_is_defined():
    used = set(re.findall(r"var\((--[\w-]+)", CSS))
    set_by_script = {variable for source in JS.values() for variable in re.findall(r"setProperty\(\"(--[\w-]+)\"", source)}
    assert set_by_script == {"--hue"}
    assert used - defined_variables() - set_by_script == set(), sorted(used - defined_variables() - set_by_script)


def test_every_theme_defines_the_same_colours():
    blocks = re.findall(r":root\[data-theme=\"(\w+)\"\]\s*\{(.*?)\}", CSS, re.S)
    assert {name for name, _ in blocks} == {"dark", "dim", "light"}
    tokens = {name: set(re.findall(r"(--[\w-]+)\s*:", body)) for name, body in blocks}
    assert tokens["dark"] == tokens["dim"] and tokens["dark"] <= tokens["light"] and tokens["light"] - tokens["dark"] <= {"--accent"}
    tokens = [tokens["dark"], tokens["dim"], tokens["light"]]
    assert {"--bg", "--text", "--muted", "--line", "--hover"} <= tokens[0]


def test_every_animation_has_its_keyframes():
    keyframes = set(re.findall(r"@keyframes\s+([\w-]+)", CSS))
    assert keyframes == {"spin", "fade", "rise", "pop", "shimmer", "toast-in", "drop"}
    for name in keyframes:
        assert re.search(rf"animation:[^;]*\b{name}\b", CSS), f"{name} is defined but never used"
    for declaration in re.findall(r"animation:\s*([a-z][\w-]*)", CSS):
        assert declaration in keyframes, declaration


# Class names the script uses only as hooks or states (no style of their own).
UNSTYLED = {"on", "single", "set", "remove", "who", "sub", "line", "gone", "plain", "busy", "good", "bad", "unread", "joined", "active", "following", "blocked",
            "faded", "more", "send", "tools", "wide", "big", "top", "dot", "tok", "handle", "n-reply", "n-like", "n-repost", "n-follow", "with-post", "mine", "theirs",
            "reply", "repost", "like", "bookmark", "share", "sentinel", "single", "bare", "home", "viewing", "letters", "t-on", "t-hover", "thread-skeleton",
            "mobile-only", "small", "tiny", "outlined", "glass", "primary", "ghost", "danger", "follow", "tab", "m1", "m2", "m3", "m4", "empty", "error",
            "theme-auto", "theme-light", "theme-dim", "theme-dark", "search-bar", "home-tabs", "feed", "thread-main", "thread-above", "reply-box", "replies",
            "explore-cards", "profile-body", "ph-top", "profile-list", "profile-tabs", "pager", "list", "search-body", "settings-body", "reports", "pick-list",
            "view", "profile", "profile-head", "convos"}


def test_every_class_the_script_gives_to_an_element_has_a_style():
    css_classes = set(re.findall(r"\.([A-Za-z][\w-]*)", CSS))
    missing = {}
    for name, source in JS.items():
        for quote, value in re.findall(r"\bclass:\s*([`\"])([^`\"]*)\1", source):
            for token in re.sub(r"\$\{[^}]*\}", "§", value).split():
                if "§" in token:
                    continue                                      # a name put together while running ("m" + number)
                if token not in css_classes and token not in UNSTYLED:
                    missing.setdefault(token, name)
    assert not missing, f"classes without a style: {missing}"


def test_the_layout_has_the_three_sizes_and_respects_reduced_motion():
    assert "@media (max-width: 700px)" in CSS and "@media (max-width: 1050px)" in CSS and "@media (max-width: 1280px)" in CSS
    assert "prefers-reduced-motion: reduce" in CSS
    assert "env(safe-area-inset-bottom)" in CSS


# ------------------------------------------------------------------------- the pages around the app
def test_the_legal_pages_exist_and_say_what_they_must(client):
    for path, words in (("/nutzungsbedingungen", ("16 Jahren", "Melden", "Haftung")), ("/datenschutz", ("yipi_session", "Railway", "DSGVO", "Löschen")),
                        ("/impressum", ("§ 5 DDG", "Rechtswidrige Inhalte melden"))):
        response = client.get(path)
        assert response.status_code == 200, path
        text = response.get_data(as_text=True)
        for word in words:
            assert word in text, (path, word)
        assert "Content-Security-Policy" in response.headers
        assert "Set-Cookie" not in response.headers


def test_the_privacy_page_matches_what_the_app_really_stores():
    page = read("templates", "yipi_legal.html")
    for key in ("yipi.theme", "yipi.feed", "yipi.recent"):
        assert key in page
        assert any(key in source for source in JS.values()), f"{key} is described but not used"
    assert yipi.COOKIE in page and "30 Tage" in page
    assert "Cookie" in page
    for forbidden in ("Google Analytics", "AdSense", "Facebook", "doubleclick"):
        assert forbidden not in page


def test_the_imprint_shows_the_operator_when_it_is_set(client, monkeypatch):
    monkeypatch.setattr(yipi.ysound, "imprint", lambda: {"name": "Erika Muster", "address": ["Musterstrasse 1", "12345 Musterstadt"], "email": "erika@example.com"})
    text = client.get("/impressum").get_data(as_text=True)
    assert "Erika Muster" in text and "Musterstadt" in text and "mailto:erika@example.com" in text


def test_manifest_robots_and_sitemap(client):
    manifest = client.get("/manifest.webmanifest")
    assert manifest.mimetype == "application/manifest+json"
    data = manifest.get_json()
    assert data["name"] == "yipi" and data["start_url"] == "/" and data["display"] == "standalone"
    assert {icon["purpose"] for icon in data["icons"]} == {"any", "maskable"}
    robots = client.get("/robots.txt").get_data(as_text=True)
    for private in ("/api/", "/messages", "/settings", "/gomat-archiv", "/ysound-archiv"):
        assert f"Disallow: {private}" in robots
    assert "Sitemap: http://localhost/sitemap.xml" in robots
    sitemap = client.get("/sitemap.xml").get_data(as_text=True)
    for page in ("/", "/explore", "/datenschutz", "/impressum", "/nutzungsbedingungen"):
        assert f"<loc>http://localhost{page}</loc>" in sitemap
    assert "gomat-archiv" not in sitemap


def test_error_pages_are_yipi_pages(client):
    page = client.get("/gibt-es-nicht-1234")
    assert page.status_code == 404
    text = page.get_data(as_text=True)
    assert "yipi" in text and "Diese Seite gibt es nicht" in text and "gomat" not in text.lower()
    assert "Content-Security-Policy" in page.headers
    api = client.get("/api/yipi/gibt-es-nicht")
    assert api.status_code == 404 and api.get_json() == {"ok": False, "error": "not_found"}
    assert client.get("/nobody_here").status_code == 404                     # a profile that does not exist


def test_an_unexpected_error_shows_the_error_page_and_not_the_details(client):
    with flask_app.test_request_context("/boom"):
        response = flask_app.handle_user_exception(RuntimeError("secret detail that must not reach the visitor"))
    assert response.status_code == 500
    text = response.get_data(as_text=True)
    assert "Da ist etwas schiefgelaufen" in text and "secret detail" not in text and "gomat" not in text.lower()
    with flask_app.test_request_context("/api/yipi/boom"):
        api = flask_app.make_response(flask_app.handle_user_exception(RuntimeError("secret detail")))
    assert api.status_code == 500 and api.get_json() == {"ok": False, "error": "server_error"}


def test_the_old_home_page_is_still_reachable_and_links_inside_its_own_address(client):
    page = client.get("/gomat-archiv").get_data(as_text=True)
    assert "/gomat-archiv/manifest.webmanifest" in page
    assert client.get("/gomat-archiv/manifest.webmanifest").get_json()["start_url"] == "/gomat-archiv"
    for path in ("/gomat-archiv/datenschutz", "/gomat-archiv/impressum"):
        legal = client.get(path)
        assert legal.status_code == 200 and "gomat" in legal.get_data(as_text=True)
    gomat_js = read("static", "js", "gomat.js")
    assert 'href: "/datenschutz"' not in gomat_js and 'href: "/impressum"' not in gomat_js
    assert "/gomat-archiv/datenschutz" in gomat_js


# --------------------------------------------------------------------------------------- Node tests of the helpers
@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_the_helper_functions_pass_their_node_tests():
    result = subprocess.run([shutil.which("node"), "--test", os.path.join(ROOT, "tests", "yipi_core.test.js")], capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_every_script_of_the_page_is_valid_javascript():
    for name in SCRIPTS + ["yipi-theme.js"]:
        result = subprocess.run([shutil.which("node"), "--check", os.path.join(JS_DIR, name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, f"{name}: {result.stderr[-800:]}"
