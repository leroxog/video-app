"""Satürn, 2026-10-31 night: the games are in 3D (pg-lift3d.js: a recorder takes the place of the canvas and the view turns what the games draw into solids with light and shadows), the shutter of the normal
camera is a plain white disc that turns red while it films, and the notifications are on from the start. The pictures are drawn by the browser (looked at by hand); the rules of the lift run in
tests/pulse_lift.test.js (every game through the recorder). These tests read the files and ask the server for the bundle."""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import yipi  # noqa: E402
import yipi_company  # noqa: E402
from app import app as flask_app  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
JS = os.path.join(ROOT, "static", "js")
CSS = os.path.join(ROOT, "static", "css", "yipi.css")


def read(name):
    with open(os.path.join(JS, name), encoding="utf-8") as handle:
        return handle.read()


def test_the_lift_comes_right_after_the_kit_and_is_in_the_bundle_of_the_games():
    assert yipi.PULSE_GAME_SCRIPTS[:2] == ["pg-kit.js", "pg-lift3d.js"]
    bundle = flask_app.test_client().get("/pulse-games.js").data.decode("utf-8")
    assert "PulseGames.lift = lift" in bundle and "function layout(items)" in bundle and "function view(realCtx, dpr = 1)" in bundle


def test_the_kit_gives_every_game_a_recorder_and_asks_the_camera_of_the_view_where_the_finger_is():
    kit = read("pg-kit.js")
    assert "options.lift !== false && def.lift !== false && Lift && Lift.wanted && Lift.wanted() ? Lift.view(ctx, dpr) : null" in kit
    assert "env = createEnv(view ? view.ctx : ctx, hooks);" in kit, "the game draws on the recorder"
    assert "view.unproject(event.clientX, event.clientY, box)" in kit, "a touch is mapped back onto the field through the slanted camera"
    assert "view.begin();" in kit and "view.render(now / 1000);" in kit
    assert "view.onFail = () => { view = null; if (!dead) start(); };" in kit, "too slow or no WebGL: the game goes on flat"
    assert "if (view) { view.destroy(); view = null; }" in kit, "leaving a game lets go of its 3D scene"
    assert "ctx.drawImage" not in kit.split("function frame(now)")[1].split("start();")[0], "the kit does not draw the picture itself: the view does"


def test_the_games_with_a_3d_world_of_their_own_are_not_lifted():
    for name, game in (("pg-race3d.js", "car-race"), ("pg-moto3d.js", "moto")):
        assert re.search(r'R\(\{ id: "%s"[^}]*lift: false' % game, read(name)), game


def test_the_lift_has_light_shadow_and_the_finger_through_the_camera_and_never_cuts_the_games():
    lift = read("pg-lift3d.js")
    for word in ("PCFSoftShadowMap", "castShadow = true", "ShadowMaterial", "HemisphereLight", "DirectionalLight", "RoomEnvironment", "webglcontextlost", "const TILT = 11 * Math.PI / 180",
                 "v.unproject = ", "T.ColorManagement.enabled = false", "fail();", "> 24) fail()", "saturn.lift3d"):
        assert word in lift, word
    assert "fetch(" not in lift and "XMLHttpRequest" not in lift, "it loads nothing from outside (the CSP only lets the page load its own files)"
    assert lift.count("import(") == 2 and "/static/js/vendor/three" in lift, "only the two files of three.js, from our own server"


def test_the_shutter_of_the_normal_camera_is_a_white_disc_without_a_symbol_and_red_while_it_films():
    camera, css = read("yipi-camera.js"), open(CSS, encoding="utf-8").read()
    assert 'const plain = game.id === "l-normal";' in camera and ': plain ? null' in camera, "no symbol inside"
    assert '${plain ? " plain" : ""}' in camera
    for rule in (".lens-ic.plain, .lens.face .lens-ic.plain { background: #fff; border-color: #fff; }", ".lens.holding .lens-ic.plain { background: #fe2c55; border-color: #fe2c55; }"):
        assert rule in css, rule


def test_sliding_the_shutter_up_while_it_films_locks_the_clip_and_the_circle_glides_back_and_hops_every_three_seconds():
    camera, css = read("yipi-camera.js"), open(CSS, encoding="utf-8").read()
    for word in ("let lockedRound = false;", "const LOCK_AT = 78;", "function lockRound(held)", "const shutterMove = (event) =>", 'window.addEventListener("pointermove", shutterMove);',
                 'window.removeEventListener("pointermove", shutterMove);', 'held.button.style.setProperty("--lift", "0px");', "if (held.holding && held.locked && state === \"playing\") return;",
                 "if (lockedRound && state === \"playing\") { finish(finalScore); return; }", "|| lockedRound) return;", "if (next !== \"playing\" && lockedRound) endLock();", "Hochziehen: Sperren"):
        assert word in camera, word
    assert camera.index("let lockedRound = false;") < camera.index("const setState = (next) =>"), "the flag exists before the first state is set (it was an error that took the whole camera down)"
    assert ".cam-lenses { touch-action: pan-x; }" in css, "a finger that slides up is not taken by the browser"
    assert ".lens.holding { translate: 0 calc(var(--lift, 0px) * -1);" in css, "the circle follows the finger"
    assert "animation: lock-hop 3s ease-in-out 1s infinite" in css and "@keyframes lock-hop { 0%, 14%, 100% { translate: 0 0; } 6% { translate: 0 -6px; } }" in css, "a small hop every 3 seconds"
    assert "transition: translate 0.7s cubic-bezier(0.2, 1.2, 0.3, 1)" in css, "it glides back to its place with a soft overshoot"
    assert "prefers-reduced-motion: reduce) { .lens.holding.locked { animation: none; } }" in css


def test_the_site_has_one_red_the_red_of_tiktok_and_no_emoji_in_the_camera_and_the_things_that_are_sent():
    css = open(CSS, encoding="utf-8").read()
    for old in ("#ff3b4e", "#ff4d5e", "#ff4d6d", "#ef4444", "#d93025", "255, 59, 78", "255, 77, 94", "255, 60, 100"):
        assert old not in css, old
    assert "--danger: #fe2c55;" in css and "--tt-red: #fe2c55;" in css
    camera, music, composer, chats, calls = read("yipi-camera.js"), read("yipi-music.js"), read("yipi-composer.js"), read("yipi-chats.js"), read("yipi-calls.js")
    emoji = re.compile("[←-⇿⌀-⏿■-➿⬀-⯿🀀-🫿]")
    for name, text in (("yipi-camera.js", camera), ("yipi-music.js", music), ("yipi-calls.js", calls), ("yipi-chats.js", chats)):
        lines = [line.strip()[:90] for line in text.splitlines() if emoji.search(line) and not line.strip().startswith(("//", "/*", "*"))]
        assert lines == [], (name, lines)
    assert "Mein Standort: https://www.openstreetmap.org" in composer and "📍 Mein Standort: https" not in composer
    assert 'icon("music")' in camera and "const glyphOf = (game)" in camera and 'icon(game.kind === "qr" ? "qr" : game.kind === "randomsong" ? "music" : game.kind === "lens" ? "camera" : "gamepad")' in camera
    assert "music: S(" in read("yipi-icons.js")


def test_notifications_are_switched_on_by_the_first_touch_and_who_switches_them_off_is_left_alone():
    progress = read("yipi-progress.js")
    assert "async function autoOn()" in progress and 'document.addEventListener("pointerup"' in progress and "pushAuto: autoOn" in progress
    assert 'memory === "off"' in progress and 'localStorage.setItem("saturn.push", "off")' in progress, "switched off in the settings: never again by itself"
    assert 'localStorage.setItem("saturn.push", "asked")' in progress, "the browser is asked once"
    assert "push.needsInstall()" in progress.split("async function autoOn()")[1].split("let autoTried")[0], "on an iPhone in Safari the page cannot ask"
    assert 'Notification.permission === "denied"' in progress.split("async function autoOn()")[1].split("let autoTried")[0]


def test_the_site_announces_the_3d_games_and_the_notifications():
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    for key in ("2026-10-31-games3d", "2026-10-31-notify", "2026-10-31-songs", "2026-10-31-lock"):
        assert key in lines and len(lines[key][2]) <= 280 and lines[key][2].count("#") <= 2, key
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)


def test_the_sounds_of_the_page_are_not_played_late_by_a_sleeping_sound_context():
    fx = read("yipi-fx.js")
    assert 'const WAKE = ["pointerup", "touchend", "click", "keydown"];' in fx and "if (ctx && ctx.state === \"running\") WAKE.forEach" in fx
    assert '!parts || ctx.state !== "running") return;' in fx, "a sound that is asked for while the context sleeps is left out"
