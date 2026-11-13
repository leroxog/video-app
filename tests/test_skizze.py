"""Satürn, 2026-11-13: the look that was drawn by hand (yipi-skizze.js and the pages it changes) and the video editor (yipi-editor.js). The scripts run in a browser; here the files are
checked for what the sketches ask for: the five tabs, Home with its three rows, the sheet of the "+", Chats with the time at the right, the profile with three tabs and a grid, the videos with
the magnifier and "Folge ich / Für dich", no text posts to make, and an editor with the tools of CapCut and the button "Hochladen"."""
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import yipi  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


def test_the_new_scripts_are_in_the_bundle_before_the_frame():
    scripts = yipi.PULSE_SCRIPTS
    assert scripts.index("yipi-editor.js") < scripts.index("yipi-skizze.js") < scripts.index("yipi-chrome.js") < scripts.index("yipi.js")
    assert scripts.index("yipi-chats.js") < scripts.index("yipi-skizze.js") and scripts.index("yipi-stories.js") < scripts.index("yipi-skizze.js")


def test_home_has_the_three_rows_of_the_sketch_and_the_plus_is_a_sheet():
    skizze = read("static", "js", "yipi-skizze.js")
    for word in ('h("h2", {}, "Freunde")', '"Abos"', 'h("h2", {}, "Entdecke")', '"Kontakt hinzufügen"', '"oder Gruppe erstellen"', '"Datei hochladen"', "Y.newPost = function newPost",
                 'feed: "media"', "Y.views.home = function home", "(max-width: 819px)"):
        assert word in skizze, word
    assert 'if (options.only || !narrow()) return oldNewPost(options);' in skizze, "a wide screen and the places that know what they want keep the old way"


def test_the_tabs_the_bar_and_the_chats_follow_the_sketch():
    shell, chrome, chats = read("static", "js", "yipi.js"), read("static", "js", "yipi-chrome.js"), read("static", "js", "yipi-chats.js")
    assert 'id: "profile", label: "Profil"' in shell and 'id: "camera"' not in shell.split("const TABS = [")[1].split("];")[0]
    assert 'extraItem("/camera", "camera", "Kamera und Spiele"' in shell and 'entry("/camera", "camera", "Kamera und Spiele")' in shell, "the camera is in the side bar and the menu"
    assert 'class: "appbar-pill"' in chrome and 'appbar-group"' in chrome and "Y.openDrawer()" in chrome
    assert '"Nex AI fragen oder suchen"' in chats and 'h("span", { class: "convo-time" }, Y.timeEl(item.at))' in chats and 'Core.buildPath({ name: "nex"' in chats


def test_the_profile_and_the_videos_follow_the_sketch():
    views, videos = read("static", "js", "yipi-views.js"), read("static", "js", "yipi-videos.js")
    assert '[["posts", "Beiträge"], ["likes", "Gefällt mir"], ["bookmarks", "Lesezeichen"]]' in views and 'qs("/bookmarks", { cursor })' in views and "Y.skizze.cell(item)" in views
    assert '[["following", "Folge ich"], ["foryou", "Für dich"]]' in videos and 'class: "reels-side reels-search"' in videos and 'class: "reel-pill"' in videos and 'class: "reel-author"' in videos


def test_there_are_no_text_posts_to_make_and_the_editor_has_the_tools_of_capcut():
    newpost, editor = read("static", "js", "yipi-newpost.js"), read("static", "js", "yipi-editor.js")
    assert 'chooseCard("post"' not in newpost and 'chooseCard("video", "Ein Video"' in newpost and 'chooseCard("story", "Eine Story"' in newpost
    assert "Y.videoEditor.open({ file: picked.original" in newpost and "edit();" in newpost, "a picked video opens in the editor first"
    for word in ('"Bearbeiten"', '"Audio"', '"Text"', '"Effekte"', '"Überlagerung"', '"Untertitel"', '"Hochladen"', "new MediaRecorder(", "captureStream(30)", "createMediaElementSource", "Y.music.pick(", "Clipaudio aus"):
        assert word in editor, word
    assert 'h("button", { class: "ed-upload", type: "button" }, "Hochladen")' in editor and '"Exportieren")' not in editor, "the button says Hochladen, not Exportieren"
    assert "if (!changed())" in editor, "a clip that was not changed is handed on as it is"


def test_a_post_tells_whether_the_viewer_follows_its_author():
    """The videos and the cards must remember a follow after a reload: the author of every post carries followedByMe."""
    import yipi as module
    from app import app as flask_app, db
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    module._hits.clear()
    with flask_app.app_context():
        db.create_all()
        mia, bob = flask_app.test_client(), flask_app.test_client()
        for who, handle in ((mia, "mia_f"), (bob, "bob_f")):
            assert who.post("/api/yipi/signup", json={"handle": handle, "password": "correct horse battery", "adult": True}).status_code == 200
        post = bob.post("/api/yipi/posts", json={"text": "hallo"}).get_json()["post"]
        first = mia.get("/api/yipi/timeline?feed=foryou").get_json()["items"][0]
        assert first["id"] == post["id"] and first["user"]["followedByMe"] is False
        assert mia.post("/api/yipi/users/bob_f/follow").status_code == 200
        again = mia.get("/api/yipi/timeline?feed=foryou").get_json()["items"][0]
        assert again["user"]["followedByMe"] is True
        own = bob.get("/api/yipi/timeline?feed=foryou").get_json()["items"][0]
        assert "followedByMe" not in own["user"], "nobody follows himself"
        db.drop_all()


def test_the_big_round_button_uploads_videos_and_photos():
    newpost, skizze = read("static", "js", "yipi-newpost.js"), read("static", "js", "yipi-skizze.js")
    assert "function uploadFile(" in newpost and "Y.pendingPost = { files: photos }" in newpost and "composeVideo({ file: video })" in newpost
    assert 'chooseCard("photo", "Ein Foto"' in newpost and "Y.uploadFile()" in skizze


def test_the_round_button_of_the_chats_only_adds_contacts_and_groups():
    skizze, chrome = read("static", "js", "yipi-skizze.js"), read("static", "js", "yipi-chrome.js")
    assert "Y.plusSheet?.({ contactOnly: true })" in chrome and "...(contactOnly ? [people] : [contact," in skizze
    assert '"Kontakt hinzufügen"' in skizze and '"Gruppe erstellen"' in skizze


def test_the_three_dots_of_the_videos_open_the_menu_of_the_video_on_the_screen():
    videos = read("static", "js", "yipi-videos.js")
    assert "active && active.moreMenu ? active.moreMenu(moreButton)" in videos
    for word in ('"Video herunterladen"', '"Link kopieren"', '"Beitrag melden"', "Y.downloadVideo(item)"):
        assert word in videos, word
    assert "like, comment, save, share, soundButton);" in videos, "the dots are not in the row at the side any more, the sound button is the last one of the column"


def test_the_look_of_snapchat_the_tour_and_the_page_to_turn_the_device():
    css = read("static", "css", "yipi.css")
    tour, skizze, chats, videos, auth = (read("static", "js", name) for name in ("yipi-tour.js", "yipi-skizze.js", "yipi-chats.js", "yipi-videos.js", "yipi-auth.js"))
    assert "yipi-tour.js" in yipi.PULSE_SCRIPTS
    assert '--snap: #8e44f2' in css and ':root { --font: "Nunito"' in css, "one purple (where Snapchat is yellow) and a round font"
    assert ".tour { position: fixed;" in css and "pointer-events: none" in css.split(".tour { position: fixed;")[1].split("}")[0], "the dark layer lets every touch through"
    for word in ("six quick taps", "api.reelsScrolled()", "api.doubleTapped()", "api.swiped()", "saturn.tour."):
        assert word in tour, word
    assert 'class: "turn-note"' in skizze and "(pointer: coarse) and (orientation: landscape)" in css
    assert "Nicht akzeptieren" in auth and "Doch akzeptieren" in auth
    assert "border-left: 3px solid var(--who" in css and "--who: ${whoColor(" in chats
    assert "devicemotion" in videos and "active.shakeLike()" in videos and "reels-searchline" in videos
