"""Satürn: "+" and "Posten" lead to a page of their own ("Was willst du hochladen?", 2026-10-31): a video on the left, a post on the right, each one a whole page (like TikTok and like X), white and round
like the sign-up. The pages are drawn by the browser (checked by hand in it): these tests read the files and ask the server for the addresses."""
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
from app import app as flask_app, db  # noqa: E402

JS = os.path.join(os.path.dirname(__file__), "..", "static", "js")
CSS = os.path.join(os.path.dirname(__file__), "..", "static", "css", "yipi.css")
PASSWORD = "correct horse battery"


def read(name):
    with open(os.path.join(JS, name), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)


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


def test_the_three_addresses_are_pages_of_the_app_and_not_for_search_engines(client):
    mia = flask_app.test_client()
    assert mia.post("/api/yipi/signup", json={"handle": "mia", "password": PASSWORD, "adult": True}).status_code == 200
    for path in ("/new", "/new/post", "/new/video"):
        reply = mia.get(path)
        assert reply.status_code == 200 and b'id="yipiBoot"' in reply.data, path
        assert 'content="noindex"' in reply.get_data(as_text=True), path
    for name in ("new", "neu"):
        refused = flask_app.test_client().post("/api/yipi/signup", json={"handle": name, "password": PASSWORD, "adult": True})
        assert refused.status_code == 400 and refused.get_json()["error"] == "reserved_handle", "nobody can be called like the page"


def test_the_router_knows_the_pages_and_every_way_to_upload_leads_to_them():
    core = read("yipi-core.js")
    assert '"/new": "new", "/new/post": "newpost", "/new/video": "newvideo"' in core
    assert 'case "new": return "/new"' in core and 'case "newpost": return "/new/post"' in core and 'case "newvideo": return "/new/video"' in core
    page = read("yipi-newpost.js")
    for word in ("Was willst du hochladen?", 'chooseCard("video", "Ein Video"', 'chooseCard("story", "Eine Story"', "pages.new = ", "pages.newpost = ", "pages.newvideo = ", "uploadPages: pages"):
        assert word in page, word
    assert page.index('chooseCard("video", "Ein Video"') < page.index('chooseCard("photo", "Ein Foto"') < page.index('chooseCard("story", "Eine Story"'), "the video is on the left, the story on the right (no text posts any more)"
    assert 'chooseCard("post"' not in page, "there is no choice for a text post any more"
    assert 'Y.navigate(only === "video" ? "/new/video" : only === "post" ? "/new/post" : "/new")' in page, "the + leads to the page"
    assert "floating(anchor" not in page and "pc-tile" not in page, "the pop-up is gone"
    assert "{ ...(Y.uploadPages || {}) }" in read("yipi-views.js")
    components = read("yipi-components.js")
    assert 'if (!target) { Y.pendingPost = { text, files, onPosted }; Y.navigate("/new/post"); return null; }' in components, "a new post is a page, a reply or a quote stays a window"
    camera = read("yipi-camera.js")
    assert "Y.composeVideo({ file, camId: clip.game.id })" in camera and "Y.compose({ files: [file] })" in camera, "what the camera posts goes to the pages too"
    assert "Y.pendingVideo = options;" in page and "Y.pendingVideo || {}" in page and "Y.pendingPost || {}" in page


def test_the_pages_are_white_and_round_like_the_sign_up_and_fit_a_phone():
    css = open(CSS, encoding="utf-8").read()
    for selector in (".nu-choices {", ".nu-card {", ".nu-card.video .nu-ic {", ".nu-card.post .nu-ic {", ".vt-page {", ".vt-page .vt-slot {", ".nu-main {"):
        assert selector in css, selector
    assert "grid-template-columns: repeat(2, minmax(0, 1fr))" in css.split(".nu-choices {")[1].split("}")[0], "two cards side by side, also on a phone"
    page = read("yipi-newpost.js")
    assert 'class: `au auth-white nu ${modifier}`' in page, "the same white and round look as the sign-up"
    assert re.search(r"@media \(max-width: 720px\) \{\s*\.vt-page \{ grid-template-columns: 1fr", css)
