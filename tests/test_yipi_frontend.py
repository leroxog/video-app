"""Pulse's page (the files keep the name yipi): the files the page is made of agree with each other and with the server (every address the script calls exists,
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
SCRIPTS = ["yipi-core.js", "yipi-gif-core.js", "yipi-icons.js", "yipi-api.js", "yipi-ui.js", "yipi-gif.js", "yipi-components.js", "yipi-views.js", "yipi-pages.js", "yipi-nex.js", "yipi.js"]


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
    for name in ("yipi.html", "legal.html", "error.html"):
        text = read("templates", name)
        assert not re.search(r"\son[a-z]+\s*=", text), f"{name}: inline event handler"
        assert 'style="' not in text and "javascript:" not in text, name


def test_every_file_the_templates_load_exists():
    for template in ("yipi.html", "legal.html", "error.html"):
        html = read("templates", template)
        for path in re.findall(r"static_url\('([^']+)'\)", html):
            assert os.path.exists(os.path.join(ROOT, "static", *path.split("/"))), f"{template} loads {path}"


def test_the_images_of_the_page_and_the_manifest_exist():
    for name in ("pulse-icon.svg", "pulse-180.png", "pulse-192.png", "pulse-512.png", "pulse-512-maskable.png", "pulse-og.png"):
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
    assert len(found) > 45, "the pattern that finds the calls stopped working"
    for name, method, literal in found:
        for concrete in KINDS.get(literal, [literal]):
            path = "/api/yipi" + js_literal_to_path(concrete)
            assert matches(path, method), f"{name}: {method} {literal} is not a route of the server"


def test_the_calls_the_pattern_above_cannot_see_use_addresses_the_server_knows():
    """The GIF upload goes through its own helper, Nex through fetch (a stream, not JSON)."""
    assert 'call("POST", "/gifs", undefined, form)' in JS["yipi-api.js"] and matches("/api/yipi/gifs", "POST")
    nex = JS["yipi-nex.js"]
    assert 'fetch("/api/yipi/nex", { method: "POST"' in nex and matches("/api/yipi/nex", "POST")
    assert nex.count("fetch(") == 1, "Nex is the one page that does not use YipiApi: its answer is a stream"
    assert 'credentials: "same-origin"' in nex


def test_calls_that_hand_the_address_over_use_addresses_the_server_knows():
    """Post buttons hand their address (/posts/<id>/like ...) to a helper, so the pattern above cannot see them."""
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
                 "/moderation", "/i/login", "/i/signup", "/i/nex", "/mia", "/mia/status/1", "/mia/followers", "/mia/following"):
        adapter.match(path, method="GET")


def test_the_script_and_the_server_agree_on_the_limits():
    core = JS["yipi-core.js"]
    assert f"MAX_POST = {yipi.MAX_POST}" in core
    assert f"MAX_MEDIA = {yipi.MAX_MEDIA}" in core
    components = JS["yipi-components.js"]
    assert f"{yipi.MAX_IMAGE_BYTES // (1024 * 1024)} * 1024 * 1024" in components
    gif = JS["yipi-gif-core.js"]
    assert f"MAX_BYTES = {yipi.MAX_GIF_BYTES // (1024 * 1024)} * 1024 * 1024" in gif and f"MAX_FRAMES = {yipi.MAX_GIF_FRAMES}" in gif and f"MAX_TITLE = {yipi.MAX_GIF_TITLE}" in gif
    assert "maxPixels = 2000000" in gif and yipi.MAX_GIF_PIXELS == 2000000
    assert f"NEX_TURNS = {yipi.NEX_TURNS}" in core
    assert "slice(0, 1500)" in core and yipi.MAX_NEX_MESSAGE == 1500
    assert f"maxlength: {yipi.MAX_NEX_MESSAGE}" in JS["yipi-nex.js"]
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
    assert keyframes == {"spin", "fade", "rise", "pop", "shimmer", "toast-in", "drop", "blink", "sheet", "drawer-in"}
    for name in keyframes:
        assert re.search(rf"animation:[^;]*\b{name}\b", CSS), f"{name} is defined but never used"
    for declaration in re.findall(r"animation:\s*([a-z][\w-]*)", CSS):
        assert declaration in keyframes or declaration == "none", declaration


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


def test_the_layout_fits_wide_tablet_phone_held_sideways_and_phone_held_upright_and_respects_reduced_motion():
    assert "@media (max-width: 1280px)" in CSS and "@media (max-width: 1050px)" in CSS, "tablet: a rail of icons, then no extras column"
    landscape = "(min-width: 561px) and (max-height: 499px)"
    assert CSS.count(landscape) >= 4, "a phone held sideways: the rail, no bar at the bottom"
    assert "@media (max-width: 560px), (max-width: 700px) and (min-height: 500px)" in CSS, "a phone held upright: the floating bar at the bottom"
    assert "prefers-reduced-motion: reduce" in CSS
    assert "env(safe-area-inset-bottom)" in CSS and "env(safe-area-inset-left)" in CSS and "100dvh" in CSS
    phone = CSS.split("@media (max-width: 560px), (max-width: 700px) and (min-height: 500px) {")[1].split("\n}\n")[0]
    for rule in (".tabbar {", ".fab {", ".side { display: none; }", '.tabbar .nav-item[data-nav="nex"]'):
        assert rule in phone, rule
    sideways = CSS.split("@media (min-width: 561px) and (max-height: 499px) {")[1].split("\n}\n")[0]
    assert ".mobile-head { display: none; }" in sideways and ".tabbar" not in sideways, "sideways: no bar at the bottom"


def test_the_look_is_glass_on_every_surface():
    assert "backdrop-filter: blur(" in CSS and CSS.count("backdrop-filter") >= 20
    for selector in (".center {", ".card {", ".topbar {", ".dialog {", ".menu {", ".tabbar {", ".toast {", ".nex-compose-box {", ".auth-card {", ".legal {"):
        blocks = [part.split("}")[0] for part in CSS.split(selector)[1:]]
        assert any("backdrop-filter" in block for block in blocks), selector
    assert ".orbs {" in CSS and "font-family: \"Inter\"" in CSS


def test_the_accent_colours_of_the_settings_the_theme_script_and_the_style_agree():
    named = re.findall(r'\[\"(\w+)\", \"[^\"]+\", \"linear-gradient', JS["yipi-pages.js"])
    assert named == ["pulse", "indigo", "orchid", "lilac"], "the standard purple and three purples more: Pulse is black and purple"
    in_css = set(re.findall(r':root\[data-accent=\"(\w+)\"\]', CSS))
    assert in_css == set(named) - {"pulse"}, "the standard colour is the one without an attribute"
    assert in_css == set(re.findall(r'accent === \"(\w+)\"', JS["yipi-theme.js"]))
    for name in in_css:
        assert f'name === "pulse"' in JS["yipi.js"] and f':root[data-theme="light"][data-accent="{name}"]' in CSS, name


def test_the_notification_tabs_ask_the_server_for_what_it_offers():
    views = JS["yipi-views.js"]
    assert '["all", "Alle"], ["mentions", "Erwähnungen"]' in views and 'filter: only === "mentions" ? "mentions" : ""' in views
    assert 'request.args.get("filter") == "mentions"' in read("yipi.py")


def test_the_timeline_is_a_flat_column_like_on_x_the_width_is_used_and_nothing_is_offered_twice():
    center = CSS.split(".center {")[1].split("}")[0]
    assert "border-radius" not in center and "margin: 0" in center and "border-left: 1px solid" in center and "box-shadow" not in center
    for name in ("side", "rail", "center"):
        assert f"--{name}: clamp(" in CSS, "the columns grow with a wide screen instead of leaving big margins"
    assert "side-guest" not in CSS and "side-guest" not in JS["yipi.js"], "the buttons to sign up are in the right column (or in the intro on a small screen), not three times"
    assert ".hero .hero-actions { display: none; }" in CSS
    assert ".nav-item.active { font-weight: 800; }" in CSS, "the active menu entry is bold, not boxed"
    assert ".card { border: 0;" in CSS


def test_the_materials_give_depth_without_playful_colours():
    for name in ("--hl", "--sheen", "--shadow", "--glow"):
        for theme in ("dark", "dim", "light"):
            assert name in re.search(rf':root\[data-theme="{theme}"\]\s*\{{(.*?)\}}', CSS, re.S).group(1), (name, theme)
    assert "--btn-3d:" in CSS and ".btn.primary { background: var(--grad); color: var(--on-accent); text-shadow" in CSS
    assert "radial-gradient(circle at 32% 24%" in CSS, "Nex is a sphere"
    assert "var(--grad): linear" not in CSS and "--grad: linear-gradient(180deg, #9d78ff 0%, #6d3df0 100%)" in CSS, "one purple, lit from above"
    assert "135deg, #8b5cf6" not in CSS and "#22d3ee" not in CSS.split("*, *::before")[0], "no violet-to-cyan rainbow in the colours of the page"


def test_the_page_is_black_and_purple_and_nothing_else():
    assert "--bg: #000;" in CSS.split(':root[data-theme="dark"]')[1].split("}")[0], "the standard look is black"
    for blue in ("#639eff", "#3a6ee8", "#22d3ee", "#3b82f6", "#2c5bd1", "#c3dbff"):
        assert blue not in CSS, blue
    assert "--accent: #8b5cf6;" in CSS and "#9d78ff" in CSS and "#6d3df0" in CSS
    for name in ("pink", "orange", "green"):
        assert f'data-accent="{name}"' not in CSS
    icons = read("scripts", "make_pulse_icons.py")
    assert "(167, 139, 250), (124, 58, 237), (76, 29, 149)" in icons and "#a78bfa" in JS["yipi-icons.js"] and "#22d3ee" not in JS["yipi-icons.js"]
    gifs = read("scripts", "make_pulse_gifs.py")
    assert "Pulse is black and purple" in gifs and "(255, 215, 60)" not in gifs and "(46, 204, 113)" not in gifs


def test_the_menu_is_where_it_is_on_x():
    shell = JS["yipi.js"]
    ids = re.findall(r'\{ id: "(\w+)", label: "([^"]+)"', shell.split("const NAV = [")[1].split("];")[0])
    assert [name for name, _ in ids] == ["home", "explore", "notifications", "messages", "nex", "bookmarks", "profile", "more"]
    assert dict(ids)["profile"] == "Profil" and "settings" not in dict(ids) and dict(ids)["more"] == "Mehr"
    assert '"/i/login"' in shell.split("const NAV = [")[1].split("];")[0], "somebody not signed in who taps Profil is asked to sign in"
    for entry in ("/settings", "/settings/display", "/settings/about"):
        assert f'Y.navigate("{entry}")' in shell, entry
    assert "Y.openDrawer = " in shell and "drawer-back" in shell and ".drawer {" in CSS
    assert 'Y.openDrawer()' in JS["yipi-views.js"], "the picture in the top bar of a phone opens the menu"
    assert 'class: "home-search"' in JS["yipi-views.js"] and ".home-search { display: none;" in CSS
    assert "(max-width: 1050px), (min-width: 561px) and (max-height: 499px) { .home-search { display: block; } }" in CSS, "a search line above the posts where there is no right column"


def test_the_polls_of_the_page_and_the_server_agree():
    core = JS["yipi-core.js"]
    assert f"MAX_POLL_OPTION = {yipi.MAX_POLL_OPTION}" in core and f"POLL_OPTIONS = [{yipi.POLL_OPTIONS[0]}, {yipi.POLL_OPTIONS[1]}]" in core
    lengths = [int(minutes) for minutes in re.findall(r"\[(\d+), \"[^\"]+\"\]", re.search(r"POLL_LENGTHS = \[(.*?)\];", core).group(1))]
    assert lengths and all(yipi.POLL_MINUTES[0] <= minutes <= yipi.POLL_MINUTES[1] for minutes in lengths) and yipi.POLL_MINUTES[2] in lengths
    components = JS["yipi-components.js"]
    assert "Core.pollAnswers(poll.options)" in components and "body.poll = { options: answers.options, minutes: poll.minutes }" in components
    assert "`/posts/${item.id}/vote`" in components and "`/posts/${item.id}/pin`" in components and 'Api.post("/posts/views"' in components
    assert "MAX_VIEWS_AT_ONCE = 40" in read("yipi.py") and "slice(0, 40)" in components


def test_what_the_page_offers_for_search_and_explore_exists_on_the_server():
    views = JS["yipi-views.js"]
    for text in ('["top", "Top"], ["new", "Neueste"], ["people", "Personen"], ["media", "Medien"]', '["foryou", "Für dich"], ["trends", "Trends"], ["media", "Medien"], ["people", "Personen"]',
                 'feed: "media"', '"/trends?limit=20"', '"/suggestions?limit=20"', 'Api.del("/bookmarks")'):
        assert text in views, text
    server = read("yipi.py")
    for text in ('request.args.get("sort") == "top"', 'kind == "media"', 'feed == "media"', 'def yipi_bookmarks_clear'):
        assert text in server, text


def test_the_bottom_bar_of_a_phone_has_nex_in_the_middle():
    shell = JS["yipi.js"]
    assert 'const TABBAR = ["home", "explore", "nex", "notifications", "messages"]' in shell
    assert 'id: "nex"' in shell and "/i/nex" in shell


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
    page = read("templates", "legal.html")
    for key in ("yipi.theme", "yipi.feed", "yipi.recent", "yipi.nex", "yipi.draft"):
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
    assert data["short_name"] == "Pulse" and data["start_url"] == "/" and data["display"] == "standalone"
    assert {icon["purpose"] for icon in data["icons"]} == {"any", "maskable"}
    robots = client.get("/robots.txt").get_data(as_text=True)
    for private in ("/api/", "/messages", "/settings", "/nex-agenten-archiv", "/gomat-archiv", "/ysound-archiv"):
        assert f"Disallow: {private}" in robots
    assert "Sitemap: http://localhost/sitemap.xml" in robots
    sitemap = client.get("/sitemap.xml").get_data(as_text=True)
    for page in ("/", "/datenschutz", "/impressum", "/nutzungsbedingungen"):
        assert f"<loc>http://localhost{page}</loc>" in sitemap
    assert "gomat-archiv" not in sitemap and "yipi-archiv" not in sitemap


def test_error_pages_are_pulse_pages(client):
    page = client.get("/gibt-es-nicht-1234")
    assert page.status_code == 404
    text = page.get_data(as_text=True)
    assert "Pulse" in text and "Diese Seite gibt es nicht" in text and "gomat" not in text.lower() and "Nex Ai" not in text
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
    result = subprocess.run([shutil.which("node"), "--test", os.path.join(ROOT, "tests", "yipi_core.test.js"), os.path.join(ROOT, "tests", "yipi_gif_core.test.js")],
                            capture_output=True, text=True, timeout=180)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is not installed")
def test_every_script_of_the_page_is_valid_javascript():
    for name in SCRIPTS + ["yipi-theme.js"]:
        result = subprocess.run([shutil.which("node"), "--check", os.path.join(JS_DIR, name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, f"{name}: {result.stderr[-800:]}"
