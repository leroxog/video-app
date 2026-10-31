"""Satürn, round 6, the page side of what brings people back (the flame, level and badges, hearts on messages, the lists of the best players,
notifications on the device) and of saving a video with the watermark and making a sticker: the files agree with each other and with the server."""
import os
import re
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


def js(name):
    return read("static", "js", name)


SERVER = read("yipi.py")


# -------------------------------------------------------------------------------------- saving a video with the watermark
def test_saving_a_video_draws_the_watermark_in_the_browser_and_sends_nothing():
    source = js("yipi-download.js")
    assert "MediaRecorder" in source and "captureStream" in source and "Core.watermarkPlan" in source and "Core.videoFileName" in source
    assert "fetch(" not in source and "Api." not in source and "XMLHttpRequest" not in source, "the video is not sent anywhere"
    assert '"Satürn"' in source and "`@${handle}`" in source, "the logo's name and the name of whoever made the video"
    assert "item.user.handle" in source, "the creator, not the person who saves it"
    assert "createMediaElementSource" in source and "createMediaStreamDestination" in source, "the sound goes along (and not out of the speakers)"
    assert "Abbrechen" in source, "a running save can be cancelled"
    assert yipi.PULSE_SCRIPTS.index("yipi-download.js") < yipi.PULSE_SCRIPTS.index("yipi-camera.js"), "the camera uses its recorder choice"
    assert "Y.pickRecorderType" in js("yipi-camera.js")


def test_every_menu_that_shares_a_video_can_also_save_it():
    components = js("yipi-components.js")
    items = components[components.index("function shareItems"):components.index("async function copyLink")]
    assert '"Video speichern"' in items and "Y.downloadVideo(item)" in items and "entry.video" in items, "only video posts get the entry"
    assert "Y.shareItems(item)" in js("yipi-videos.js"), "the share button of a reel opens that menu"


# -------------------------------------------------------------------------------------------------- the flame, level, badges
def test_the_progress_script_talks_to_routes_that_exist():
    source = js("yipi-progress.js")
    for call in ('"/progress"', '"/play"', '"/push/key"', '"/push/subscribe"', '"/push/unsubscribe"', "/games/${game.id}/top"):
        assert call in source, call
    for route in ('"/api/yipi/progress"', '"/api/yipi/play"', '"/api/yipi/push/key"', '"/api/yipi/push/subscribe"', '"/api/yipi/push/unsubscribe"', '"/api/yipi/games/<game>/top"'):
        assert route in SERVER, route
    assert "/pulse-sw.js" in source and "userVisibleOnly: true" in source and "Core.base64UrlBytes" in source
    assert '"/pulse-sw.js"' in SERVER and "Service-Worker-Allowed" in SERVER


def test_the_flame_is_on_home_and_the_settings_have_a_page_for_notifications():
    views, pages = js("yipi-views.js"), js("yipi-pages.js")
    assert "Y.streakChip ? Y.streakChip() : null" in js("yipi-chrome.js"), "the flame sits in the bar at the top (which only exists for somebody who is signed in)"
    assert "Y.pushInvite()" in views
    assert '["push", "Mitteilungen"' in pages and 'section === "push"' in pages and "Y.pushSettings()" in pages
    assert "chips" in js("yipi-progress.js") and "redrawChips" in js("yipi-progress.js")


def test_a_finished_game_goes_to_the_list_and_the_camera_has_the_list_and_the_game_of_the_day():
    camera = js("yipi-camera.js")
    assert "Y.reportPlay(chosen.id, finalScore)" in camera and "Y.leaderboard(list[active])" in camera and "Core.dailyIndex(" in camera
    assert "Spiel des Tages" in camera
    progress = js("yipi-progress.js")
    assert "score > 0" in progress or "(score > 0)" in progress, "a round without points is not sent"
    assert 'scope: scope === "friends" ? "friends" : undefined' in progress


def test_the_new_page_texts_do_not_put_user_text_into_html():
    for name in ("yipi-progress.js", "yipi-download.js"):
        source = js(name)
        assert ".innerHTML" not in source and "insertAdjacentHTML" not in source and "document.write" not in source, name


# -------------------------------------------------------------------------------------------------------- hearts on messages
def test_a_double_tap_on_a_message_uses_the_heart_routes_of_the_server():
    chats = js("yipi-chats.js")
    assert "Y.onDoubleTap(bubbles" in chats and "toggleHeart" in chats
    assert "`${base}/messages/${message.id}/heart`" in chats and "`${base}/${message.id}/heart`" in chats
    assert re.search(r'"/api/yipi/messages/<handle>/<int\(min=1, max=\d+\):message_id>/heart", methods=\["POST", "DELETE"\]', SERVER)
    assert re.search(r'"/api/yipi/groups/<int\(min=1, max=\d+\):group_id>/messages/<int\(min=1, max=\d+\):message_id>/heart", methods=\["POST", "DELETE"\]', SERVER)
    assert "reply.data.hearts" in chats, "the poll brings the hearts of the others"
    assert "item.streak >= 2" in chats and "icon(\"flame\")" in chats, "the flame of two friends in the chat list"


# ----------------------------------------------------------------------------------------------------------- the sticker
def test_a_sticker_needs_only_a_name_and_a_picture():
    source = js("yipi-gif.js")
    start = source.index("function makeView")
    view = source[start:source.index("Object.assign(Y, { gifMakeView", start)]
    assert "Eigener Sticker" in view and "Name des Stickers" in view and "Y.tabs(" not in view, "no modes to choose from"
    for gone in ("SWATCHES", "TEXT_STYLES", "SHAPES", "segmented", "drawText"):
        assert gone not in source, f"{gone} belonged to the old maker with its three modes and its options"
    assert 'accept: "image/jpeg,image/png,image/webp,image/gif"' in view and "multiple: true" in view, "one picker for everything"
    assert "Api.uploadGif(" in view and "GifCore.cleanTitle(title.value)" in view
    assert "const ready = () => !busy && named()" in view, "no name, no sticker"


# --------------------------------------------------------------------------------------------------------------- files in R2
def test_the_moderation_page_has_the_storage_card_that_calls_the_admin_routes():
    pages, api = js("yipi-pages.js"), js("yipi-api.js")
    assert "storageCard()" in pages and '"/admin/storage"' in pages and '"/admin/storage/move"' in pages and '"/admin/storage/compact"' in pages
    for route in ('"/api/yipi/admin/storage"', '"/api/yipi/admin/storage/move"', '"/api/yipi/admin/storage/compact"'):
        assert route in SERVER, route
    assert "r2_off:" in api and "not_postgres:" in api, "the answers of the server have texts"
    assert "confirmBox" in pages[pages.index("async function compact"):pages.index("async function compact") + 400], "tidying locks tables for a moment: asks first"


# ------------------------------------------------------------------------------------------------------------------ stories
def test_the_story_script_uses_the_story_routes_and_the_row_is_on_home():
    source = js("yipi-stories.js")
    for call in ('Api.get("/stories")', "Api.get(`/stories/${wanted.user.handle}`)", "Api.post(`/stories/${item.id}/seen`)", "Api.del(`/stories/${item.id}`)", 'Api.post("/stories"'):
        assert call in source, call
    for route in ('"/api/yipi/stories"', '"/api/yipi/stories/<handle>"', "/seen", "yipi_story_delete"):
        assert route in SERVER, route
    assert "Core.videoTooLong(facts.seconds)" in source and "Core.MAX_VIDEO_BYTES" in source, "a story video is at most 30 seconds, like every video"
    assert ".innerHTML" not in source and "insertAdjacentHTML" not in source
    assert "Y.storiesBar()" in js("yipi-views.js") and 'tile("Story"' in js("yipi-newpost.js"), "the row on Home and the entry in the pop-up of the plus"
    order = yipi.PULSE_SCRIPTS
    assert order.index("yipi-stories.js") < order.index("yipi.js") and order.index("yipi-chrome.js") < order.index("yipi.js")
    assert order.index("yipi-icons.js") < order.index("yipi-chrome.js"), "the lettering is drawn by the icons file"
    for key in ("ArrowRight", "ArrowLeft", "Escape"):
        assert key in source, "stories can be used with the keyboard: " + key
