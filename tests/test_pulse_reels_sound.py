"""Satürn, 2026-11-02: the videos (reels) like TikTok: the column of buttons sits lower, a check stays at the people one follows, a small rounded square with a note opens the menu of the sound ("Sound benutzen",
"Sound melden", "Copyright-Problem melden"), the sound of a video is "Extrahierter Song <number>" (a number that is never the same for two videos), and the camera opens on the plain camera. The pictures are drawn
by the browser (looked at by hand): these tests read the files and ask the server."""
import os
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

CSS = open(os.path.join(ROOT, "static", "css", "yipi.css"), encoding="utf-8").read()
PASSWORD = "correct horse battery"


def read(name):
    with open(os.path.join(ROOT, "static", "js", name), encoding="utf-8") as handle:
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


def test_a_post_can_be_reported_for_a_copyright_problem_or_for_its_sound(client):
    assert "copyright" in yipi.REPORT_REASONS and "sound" in yipi.REPORT_REASONS
    mia, tom = flask_app.test_client(), flask_app.test_client()
    for who, handle in ((mia, "mia"), (tom, "tom")):
        assert who.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    post_id = mia.post("/api/yipi/posts", json={"text": "Ein Beitrag"}).get_json()["post"]["id"]
    for reason in ("copyright", "sound"):
        reply = tom.post("/api/yipi/reports", json={"postId": post_id, "reason": reason, "note": "Der Sound gehört mir"})
        assert reply.status_code in (200, 201) and reply.get_json()["ok"], reason
    assert tom.post("/api/yipi/reports", json={"postId": post_id, "reason": "nonsense"}).status_code == 400


def test_the_number_of_an_extracted_sound_is_never_the_same_for_two_videos_and_looks_random():
    number = lambda post_id: (post_id * 2654435761) % (1 << 30)           # the formula of yipi-music.js
    seen = {number(i) for i in range(1, 200_001)}
    assert len(seen) == 200_000, "one-to-one: two posts never share a number"
    assert len({number(i) % 10 for i in range(1, 2000)}) == 10 and number(1) != 1 and number(2) - number(1) not in (1, -1)
    music = read("yipi-music.js")
    assert "(BigInt(postId) * 2654435761n) % (1n << 30n)" in music
    assert "title: `Extrahierter Song ${extractedNumber(post.id)}`" in music and 'src: "video"' in music


def test_the_videos_have_the_sound_button_with_its_menu_and_a_check_that_stays():
    videos, ui, components = read("yipi-videos.js"), read("yipi-ui.js"), read("yipi-components.js")
    for word in ('"Sound benutzen", icon: "camera", strong: true', "Y.pendingSong = Y.music.extractedSong(item, media); Y.navigate(\"/camera\");", '"Sound melden"', '"Copyright-Problem melden"',
                 'preset: "sound"', 'preset: "copyright"', 'class: "reel-sound"', 'icon("music")'):
        assert word in videos, word
    assert 'class: "reel-follow done kept"' in videos, "a check for the people one follows"
    assert "setTimeout(() => plus.classList.add(\"gone\"), 900)" not in videos, "the check no longer goes away"
    assert "language," not in videos.split("const actions")[1].split("put(stage")[0], "the language button moved into the menu of the three dots"
    assert '"Untertitel und Sprache", icon: "captions"' in videos
    assert "item.strong ? \" strong\" : \"\"" in ui and "preset = \"\"" in components and "Copyright-Problem" in components
    for rule in (".reel-sound {", ".menu-item.strong {", ".reel-follow.done.kept {"):
        assert rule in CSS, rule


def test_the_camera_opens_on_the_plain_camera_and_takes_the_sound_of_a_video_as_its_song():
    camera, music = read("yipi-camera.js"), read("yipi-music.js")
    assert "list = [create, NORMAL, ...flagship, randomSong" in camera
    assert "active = wanted >= 0 ? wanted : 1;" in camera and "if (Y.pendingSong) { setSong(Y.pendingSong, false); Y.pendingSong = null; }" in camera
    assert 'loadWhole(sameOriginUrl(next))' in music and '/yipi-media/${song.media}?same=1' in music, "the sound of a video is loaded from the site itself (not from R2)"
    assert "song.src === \"video\" || song.src === \"device\" ? `Musik: ${song.title} · ${song.creator}`" in music


def test_the_sound_window_is_dark_with_search_styles_tabs_videos_favourites_and_a_purple_plus():
    music, camera = read("yipi-music.js"), read("yipi-camera.js")
    for word in ('class: "mu-search"', 'class: "mu-styles"', 'class: "mu-tabs"', '"flame", "Für dich"', '"file", "Eigene Dateien"', '"bookmark", "Favoriten"', 'class: "mu-videos"', 'class: "mu-add"', 'class: `mu-star',
                 'const FAVS = "saturn.favsongs";', "Api.get(\"/music/search?q=&rows=100\")", "Api.get(\"/timeline?feed=videos&order=random&limit=8\")", "onPick(song)", "extractedSong(post, media)"):
        assert word in music, word
    assert "Y.music.pick({ upload: true, onPick: (next) => setSong(next, false) })" in camera
    for rule in (".dialog.mu-box {", ".mu-add { display: grid;", "background: #7a2cf0", ".mu-video {", ".mu-star.on {"):
        assert rule in CSS, rule


def test_the_music_search_can_give_all_songs_at_once(client):
    mia = flask_app.test_client()
    assert mia.post("/api/yipi/signup", json={"handle": "mia", "password": PASSWORD, "adult": True}).status_code == 200
    import yipi_music
    assert len(mia.get("/api/yipi/music/search?q=&rows=100").get_json()["items"]) == yipi_music.count()
    assert len(mia.get("/api/yipi/music/search?q=&rows=5").get_json()["items"]) == 5
    assert len(mia.get("/api/yipi/music/search?q=&rows=abc").get_json()["items"]) == 20


def test_the_tools_of_the_camera_are_flip_filter_timer_and_a_fold_with_the_filters_and_the_timer_at_work():
    camera = read("yipi-camera.js")
    for word in ('labelled("Umdrehen", "flip", "Kamera umdrehen")', 'labelled("Filter", "filter"', 'labelled("Timer", "timer"', 'class: "cam-tool-fold"', "const USER_FILTERS = [", "const setFeedFilter = (css) =>",
                 "async function timedClip(button)", "timedClip(held.button)", 'class: "cam-count"', 'h("div", { class: "cam-ctl-extras" }, speedTool, filterTool, timerTool, ctlCam, ctlMic'):
        assert word in camera, word
    assert "feed.style.filter = filterCss(item)" not in camera and 'feed.style.filter = "";' not in camera, "every filter goes through the filter of the person"
    for rule in (".cam-tool.labelled {", ".cam-ctl.folded .cam-ctl-extras { display: none; }", ".cam-count {", ".cam-filters {"):
        assert rule in CSS, rule
    assert "timer: S(" in read("yipi-icons.js") and "filter: S(" in read("yipi-icons.js")


def test_the_site_announces_the_new_camera_and_sound_window():
    import yipi_company
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    assert "2026-11-02-camera2" in lines and len(lines["2026-11-02-camera2"][2]) <= 280 and lines["2026-11-02-camera2"][2].count("#") <= 2
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)


def test_in_the_road_games_the_picture_of_the_camera_moves_up_so_that_the_face_stays_above_the_road_and_the_clip_has_the_same_picture():
    camera = read("yipi-camera.js")
    assert 'const SHIFT = new Set(["car-race", "moto"]);' in camera and 'feed.classList.toggle("shifted", SHIFT.has(game.id));' in camera and 'feed.classList.remove("shifted");' in camera
    assert 'if (feed.classList.contains("shifted")) { g.translate(0, -0.32 * REC_H); g.translate(REC_W / 2, 0); g.scale(1.45, 1.45); g.translate(-REC_W / 2, 0); }' in camera, "the recording is moved like the page"
    assert camera.index('g.translate(0, -0.32 * REC_H)') < camera.index('g.translate(REC_W, 0); g.scale(-1, 1);'), "first the move, then the mirror"
    for rule in (".cam-feed.shifted { transform-origin: 50% 0; transform: translateY(-32%) scale(1.45); }", ".cam-feed.mirror.shifted { transform: translateY(-32%) scale(1.45) scaleX(-1); }"):
        assert rule in CSS, rule


def test_the_speed_of_a_clip_can_be_chosen_and_is_made_by_playing_the_clip_into_a_new_recording():
    camera = read("yipi-camera.js")
    for word in ('labelled("Geschw. 1x", "speed"', "speedFactor === 1 ? 2 : speedFactor === 2 ? 3 : speedFactor === 3 ? 0.5 : 1", "function retime(blob, factor)", "video.playbackRate = factor;", "video.captureStream()",
                 "createMediaElementSource(video).connect(sink)", "stopRecording().then(retimed).then(showReview)", 'toast("Auf diesem Gerät geht die Geschwindigkeit nicht.")'):
        assert word in camera, word
    assert camera.count("stopRecording().then(retimed).then(showReview)") == 2 and "stopRecording().then(showReview)" not in camera, "every clip goes through the speed"
    assert "speed: S(" in read("yipi-icons.js")


def test_the_coins_of_the_car_race_are_a_round_pill_with_a_gold_coin_and_the_style_tiles_have_pictures():
    race, music = read("pg-race3d.js"), read("yipi-music.js")
    for word in ("e.panel(W - 118, 68, 108, 50, 25, 0.55);", 'gold.addColorStop(0, "#fff7b8")', 'g.fillText("S", cx, cy + 1);', 'color: "#ffe27a"'):
        assert word in race, word
    assert 'url(/static/img/games/${picture}.jpg) center/cover' in music
    for picture in ("car-race", "basketball", "cube-dash", "darts", "copter", "mini-golf", "asteroids"):
        assert os.path.exists(os.path.join(ROOT, "static", "img", "games", f"{picture}.jpg")), picture


def test_the_site_announces_the_speed_and_the_moved_picture():
    import yipi_company
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    assert "2026-11-02-speed" in lines and len(lines["2026-11-02-speed"][2]) <= 280 and lines["2026-11-02-speed"][2].count("#") <= 2
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)


def test_the_camera_opens_on_normal_with_the_plus_before_it_and_a_search_a_long_touch_stop_and_no_red_button():
    camera = read("yipi-camera.js")
    assert "list = [create, NORMAL, ...flagship" in camera and "wanted : 1" in camera and "list.splice(2, 0, item)" in camera
    assert 'icon("search"));' in camera and "Linsen und Spiele suchen" in camera and "score, bestLine);" in camera
    for word in ("stopHold = setTimeout(", "stoppedByHold = true; navigator.vibrate?.(20); finish(finalScore);", "if (stoppedByHold) { stoppedByHold = false; return; }",
                 'board.hidden = !(game && game.kind === "game" && !game.community);'):
        assert word in camera, word


def test_clips_are_real_mp4_when_the_browser_can_and_the_sound_of_a_device_video_can_be_taken():
    download, music = read("yipi-download.js"), read("yipi-music.js")
    assert download.index('"video/mp4;codecs=avc1.42E01E,mp4a.40.2"') < download.index('"video/webm;codecs=vp9,opus"')
    for word in ('src: "device"', "Extrahierter Song ${deviceNumber()}", "URL.createObjectURL(file)", "Video aus der Galerie wählen", 'next.src === "device" ? Promise.resolve(next.url)', "(BigInt(count) + BigInt(offset)) * 2654435761n % (1n << 30n)"):
        assert word in music, word
    number = lambda n, start: ((n + start) * 2654435761) % (1 << 30)
    assert len({number(i, 12345) for i in range(1, 100_001)}) == 100_000, "one-to-one on a device"


def test_the_sound_of_a_video_comes_from_the_site_itself_not_from_r2(client, monkeypatch):
    mia = flask_app.test_client()
    assert mia.post("/api/yipi/signup", json={"handle": "mia", "password": PASSWORD, "adult": True}).status_code == 200
    item = yipi.YipiMedia(id="a" * 32, owner_id=1, content_type="video/mp4", size=7, width=1, height=1, stored="r2", data=b"")
    monkeypatch.setattr(yipi.STORE, "url", lambda *args, **kwargs: "https://r2.example/x")
    monkeypatch.setattr(yipi, "load_bytes", lambda model, row: b"abcdefg")
    db.session.add(item)
    db.session.commit()
    plain = mia.get("/yipi-media/" + "a" * 32)
    assert plain.status_code == 302, "a player goes to R2"
    same = mia.get("/yipi-media/" + "a" * 32 + "?same=1")
    assert same.status_code == 200 and same.data == b"abcdefg" and same.mimetype == "video/mp4"


def test_the_reels_have_plain_white_symbols_a_bigger_person_and_the_ranks_stand_on_the_left():
    for rule in (".reel-btn-ic, .reel-btn-ic:hover { background: transparent;", ".reel-person { width: 68px; height: 68px; margin-bottom: 16px; }"):
        assert rule in CSS, rule
    rank = read("pg-rank.js")
    assert "size === 5 ? { x: 12, y: 128 + i * 76" in rank and "{ x: W - 70, y: 112 + (i - 5) * 64" in rank and "one picture at a time" in rank


def test_the_site_announces_the_new_camera():
    import yipi_company
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    assert "2026-11-07-camera3" in lines and len(lines["2026-11-07-camera3"][2]) <= 280 and lines["2026-11-07-camera3"][2].count("#") <= 2
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)


def test_an_allowed_camera_is_kept_for_a_while_so_the_browser_does_not_ask_again_and_a_no_is_asked_again():
    camera = read("yipi-camera.js")
    for word in ("function takeKept(facingNow)", "const again = takeKept(facing);", "kept = { stream, facing, mic: micAllowed };", "keptTimer = setTimeout(dropKept, 600000);", "track.enabled = false"):
        assert word in camera, word
    assert 'error.name === "NotAllowedError" ? "Kamera nicht erlaubt"' in camera, "a no shows the chip with 'nochmal versuchen' every time"
