"""Satürn, the second half of 2026-10-31: the lenses are all 3D, the helicopter and the rocket point the way they move, a touch at once does not cancel the face tracking, the reel of the rankings sits
on the forehead, every game and lens has its QR code, the game fills the picture before the first touch, "Suche" turns into a line in landscape, and the side bar has no block "Profil".
The pages are drawn by the browser: these tests read the files (the real look was checked by hand in the browser)."""
import os
import re

JS = os.path.join(os.path.dirname(__file__), "..", "static", "js")
CSS = os.path.join(os.path.dirname(__file__), "..", "static", "css", "yipi.css")


def read(name):
    with open(os.path.join(JS, name), encoding="utf-8") as handle:
        return handle.read()


def test_every_effect_of_every_lens_is_made_of_three_d_parts():
    """A lens may only use effects that the 3D layer knows (the flat versions stay as the fallback for a device without WebGL)."""
    known = set()
    for name in ("pl-ar.js", "pl-ar-models.js", "pl-ar-decals.js"):
        known |= set(re.findall(r'\badd\("(\w+)"', read(name)))
    lenses = read("yipi-lenses.js")
    rows = re.findall(r'\["(l-[\w-]+)", "([^"]+)", "[^"]*", "#?\w+", "[^"]*", \[([^\]]*)\], "(\w+)"', lenses)
    assert len(rows) >= 30
    flat = []
    for lens_id, name, effects, _ in rows:
        ids = re.findall(r'"(\w+)"', effects)
        if ids and not all(effect in known for effect in ids):
            flat.append((name, [effect for effect in ids if effect not in known]))
    assert flat == [], f"these lenses still have flat effects: {flat}"
    flat_fx = set(re.findall(r'\badd\("(\w+)"', read("pl-face.js")))
    for effect in ("snow", "confetti", "hearts"):
        assert effect in flat_fx, "the flat version stays as the fallback"


def test_the_helicopter_is_drawn_by_the_game_and_flies_to_the_right_and_the_rocket_points_up():
    art, runners, arcade = read("pg-art.js"), read("pg-runners.js"), read("pg-arcade.js")
    assert "heli(g, x, y, size" in art and "Art.heli(g, 100, y" in runners
    copter = runners[runners.index('id: "copter"'):runners.index('id: "cube-dash"')]
    assert "🚁" not in copter.replace('emoji: "🚁"', ""), "the emoji faces a different way on every device"
    assert arcade.count('"🚀", x, 548') == 2 and arcade.count("-Math.PI / 4") >= 2, "the emoji rocket points up and to the right: it is turned"


def test_a_touch_that_starts_the_round_does_not_cancel_the_face_tracking_and_the_reel_sits_on_the_forehead():
    camera, rank = read("yipi-camera.js"), read("pg-rank.js")
    assert "let lensToken = 0" in camera and "lensToken += 1" in camera
    track = camera[camera.index("async function trackFace"):camera.index("async function ensureCommunity")]
    assert "token !== lensToken" in track and "mine !== previewId" not in track.replace("// ", ""), "the round start must not cancel it"
    lens = camera[camera.index("async function openLens"):camera.index("/* A lens is recorded like a game")]
    assert "token !== lensToken" in lens and "mine !== previewId" not in lens
    assert "brow = pt(9)" in track and "h: Math.hypot(top.x - brow.x" in track
    assert "reelAt.on" in rank and "f.h" in rank and "ty = f.y - sz * 0.05" in rank, "the middle of the reel is the middle of the forehead"


def test_every_game_and_lens_has_the_qr_symbol_under_the_sound_button():
    camera = read("yipi-camera.js")
    assert 'icon("qr")' in camera and "ctlQr" in camera
    assert "Y.qr.dialog({ path: `/camera/${item.id}`" in camera
    assert re.search(r"cam-ctl[^;]*ctlCam, ctlMic, h\(\"div\", \{ class: \"cam-ctl-sound\" \}, volume, ctlSound\), ctlQr\)", camera)
    assert 'ctlQr.hidden = game.kind === "create" || game.kind === "qr"' in camera


def test_the_game_fills_the_whole_picture_before_the_first_touch():
    css = open(CSS, encoding="utf-8").read()
    assert 'data-state="idle"] .game-frame' not in css and "scale(0.72)" not in css


def test_suche_turns_into_a_line_in_landscape_and_the_side_bar_has_no_profile_block():
    views, shell, chrome = read("yipi-views.js"), read("yipi.js"), read("yipi-chrome.js")
    assert "const searchEntry" in views and "(orientation: landscape)" in views and "Y.navigate(Core.buildPath({ name: \"search\", q: text }))" in views
    assert "Y.searchEntry(" in shell and "Y.searchEntry(" in chrome
    assert 'extraItem(`/${me.handle}`, "user", "Profil"' not in shell, "the account at the bottom leads to the profile"
    css = open(CSS, encoding="utf-8").read()
    assert ".search-row" in css and ".appbar-find-row" in css


# ================================================================================================ the camera flow of the third part of the day
def test_a_game_starts_and_is_filmed_at_once_and_leaving_it_throws_the_recording_away():
    camera = read("yipi-camera.js")
    assert "runner.isArmed() && runner.go()" not in camera and "runner.go(); }, 250)" in camera, "the game is started by the page, not by a touch"
    assert 'tapHint.hidden = true;                                  // (a game starts at once: nothing to tap)' in camera
    assert "function abortRound()" in camera and "if (state === \"playing\") abortRound();" in camera, "another lens or game, or the gallery, drops the round"
    assert "const lensBarHide = (on) => { top.hidden = on; lensName.hidden = on; lensHint.hidden = on; }" in camera, "the strip stays while a round is played"
    css = open(CSS, encoding="utf-8").read()
    assert 'data-cam="playing"] .tabbar' not in css, "the bar of the tabs stays: one can leave the camera"


def test_a_lens_has_a_shutter_a_tap_is_a_photo_and_a_finger_that_stays_is_a_clip():
    camera = read("yipi-camera.js")
    for word in ("lensBar.addEventListener(\"pointerdown\"", "async function snapshot()", "canvas.toBlob(resolve, \"image/jpeg\"", "held.holding", "Tippen: Foto · Halten: Video"):
        assert word in camera, word
    assert "startLensRound();" in camera and "startSongRound();" in camera
    assert "chosen.kind === \"lens\" && !event.target.closest(\"button\")) startLensRound()" not in camera, "no more 'tap the screen to start' for a lens"
    review = camera[camera.index("function showReview"):camera.index("function discard()")]
    assert 'h("img", { class: "cam-clip"' in review and 'action("share", "Teilen", shareOut)' in review
    assert "navigator.share({ files: [file]" in camera and "navigator.canShare({ files: [file] })" in camera, "to every other app, not only to the friends in Satürn"


def test_the_places_to_write_open_the_camera_of_satuern_and_not_the_one_of_the_device():
    camera = read("yipi-camera.js")
    assert "Y.cameraCapture = (options = {}) =>" in camera and "capture.resolve(fileOf())" in camera and "list = [NORMAL, ...(Y.lenses ? Y.lenses.PRESETS : [])]" in camera
    assert "const NORMAL = { id: \"l-normal\"" in camera and "[create, NORMAL, ...flagship" in camera
    for name, call in (("yipi-chats.js", "Y.cameraCapture ? await Y.cameraCapture()"), ("yipi-components.js", "Y.cameraCapture ? await Y.cameraCapture({ photoOnly: true })"), ("yipi-nex.js", "Y.cameraCapture ? await Y.cameraCapture({ photoOnly: true })")):
        assert call in read(name), name
    assert "files }" in read("yipi-components.js") and "options.files" in read("yipi-components.js"), "Y.compose({files}) puts a photo into the box of a post"


def test_subtitles_and_the_voice_are_off_until_somebody_switches_them_on_and_videos_fit_a_small_phone():
    captions = read("yipi-captions.js")
    assert 'let prefs = { sub: "off", audio: "orig" }' in captions and ': "off" };' in captions.replace('saved.audio === "orig" || CODES.has(saved.audio) ? saved.audio : "orig" }', ': "off" };') or 'CODES.has(saved.sub) ? saved.sub : "off"' in captions
    css = open(CSS, encoding="utf-8").read()
    assert "@media screen and (max-height: 780px)" in css and "@media screen and (max-height: 620px)" in css

