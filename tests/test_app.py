import io
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from app import app as flask_app, db
from models import (
    User, Post, PostPhoto, PostLike, PostComment, PostReport, Sound, Conversation, Message,
    MemeTemplate, MemeLobby, MemeLobbyPlayer, MemeCreation, MemeVote,
    StudioProject, StudioBlock,
)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

    upload_dir = tempfile.mkdtemp()
    flask_app.config["UPLOAD_FOLDER"] = upload_dir
    profile_pic_dir = tempfile.mkdtemp()
    flask_app.config["PROFILE_PIC_FOLDER"] = profile_pic_dir
    sound_dir = tempfile.mkdtemp()
    flask_app.config["SOUND_FOLDER"] = sound_dir

    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()

    shutil.rmtree(upload_dir, ignore_errors=True)
    shutil.rmtree(profile_pic_dir, ignore_errors=True)
    shutil.rmtree(sound_dir, ignore_errors=True)


def register(client, username="alice", password="secret123"):
    return client.post(
        "/register",
        data={
            "username": username,
            "password": password,
            "password2": password,
            "birthdate": "2005-01-01",
            "gender": "keine_angabe",
        },
        follow_redirects=True,
    )


def make_admin(username):
    user = User.query.filter_by(username=username).first()
    user.is_admin = True
    db.session.commit()


def upload_post(client, caption="Testfoto", filenames=None, content=None, hashtags=""):
    if filenames is None:
        filenames = ["clip.png"]
    if content is None:
        contents = [f"fake image bytes for {caption}-{name}".encode() for name in filenames]
    elif isinstance(content, bytes):
        contents = [content] * len(filenames)
    else:
        contents = content
    data = {
        "caption": caption,
        "hashtags": hashtags,
        "photos": [(io.BytesIO(c), name) for c, name in zip(contents, filenames)],
    }
    return client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)


def test_register_and_login(client):
    response = register(client)
    assert response.status_code == 200

    client.post("/logout")
    response = client.post(
        "/login",
        data={"username": "alice", "password": "secret123"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert b"alice" in response.data


def test_register_stores_birthdate_and_gender(client):
    register(client, username="alice")
    from datetime import date
    user = User.query.filter_by(username="alice").first()
    assert user.birthdate == date(2005, 1, 1)
    assert user.gender == "keine_angabe"


def test_register_rejects_mismatched_passwords(client):
    response = client.post(
        "/register",
        data={
            "username": "alice",
            "password": "secret123",
            "password2": "different123",
            "birthdate": "2005-01-01",
            "gender": "keine_angabe",
        },
        follow_redirects=True,
    )
    assert "stimmen nicht".encode() in response.data
    assert User.query.filter_by(username="alice").first() is None


def test_register_requires_birthdate_and_gender(client):
    response = client.post(
        "/register",
        data={"username": "alice", "password": "secret123", "password2": "secret123"},
        follow_redirects=True,
    )
    assert "alle Felder".encode() in response.data
    assert User.query.filter_by(username="alice").first() is None


def test_login_wrong_password(client):
    register(client)
    client.post("/logout")
    response = client.post(
        "/login",
        data={"username": "alice", "password": "wrong"},
        follow_redirects=True,
    )
    assert "falsch".encode() in response.data


def test_upload_requires_login(client):
    response = client.get("/upload", follow_redirects=True)
    assert b"Login" in response.data


def test_api_upload_sound_requires_login(client):
    data = {"sound": (io.BytesIO(b"fake audio bytes"), "clip.mp3")}
    response = client.post("/api/sounds", data=data, content_type="multipart/form-data")
    assert response.status_code == 401


def test_api_upload_sound_adds_to_public_library(client):
    register(client, username="alice")
    data = {"title": "My Cool Sound", "sound": (io.BytesIO(b"fake audio bytes"), "clip.mp3")}
    response = client.post("/api/sounds", data=data, content_type="multipart/form-data")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["sound"]["title"] == "My Cool Sound"
    assert payload["sound"]["username"] == "alice"

    with flask_app.app_context():
        assert Sound.query.count() == 1

    client.post("/logout")
    register(client, username="bob")
    list_response = client.get("/api/sounds")
    list_payload = list_response.get_json()
    assert list_payload["ok"] is True
    assert len(list_payload["sounds"]) == 1
    assert list_payload["sounds"][0]["title"] == "My Cool Sound"
    assert list_payload["sounds"][0]["username"] == "alice"


def test_api_upload_sound_rejects_bad_extension(client):
    register(client)
    data = {"sound": (io.BytesIO(b"not audio"), "clip.exe")}
    response = client.post("/api/sounds", data=data, content_type="multipart/form-data")
    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_format"


def test_api_upload_sound_accepts_video_file_as_sound_source(client):
    register(client)
    data = {"sound": (io.BytesIO(b"fake video-with-audio bytes"), "clip.mp4")}
    response = client.post("/api/sounds", data=data, content_type="multipart/form-data")
    assert response.status_code == 200
    assert response.get_json()["ok"] is True


def test_api_upload_sound_defaults_title_from_filename(client):
    register(client)
    data = {"sound": (io.BytesIO(b"fake audio bytes"), "mein_toller_sound.mp3")}
    response = client.post("/api/sounds", data=data, content_type="multipart/form-data")
    payload = response.get_json()
    assert payload["sound"]["title"] == "mein_toller_sound"


def test_index_shows_upload_bonus_banner(client):
    response = client.get("/")
    assert b"upload-bonus-banner" in response.data
    assert "+100 Punkte".encode() in response.data


def test_upload_awards_bonus_points(client):
    register(client)
    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 0

    upload_post(client, caption="Bonus Testfoto")

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 100


def test_duplicate_photo_upload_is_rejected(client):
    register(client)
    upload_post(client, caption="Original", filenames=["clip.png"], content=b"identical photo bytes")

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 100

    response = upload_post(client, caption="Duplicate", filenames=["clip2.png"], content=b"identical photo bytes")
    assert b"bereits hochgeladen" in response.data

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 100
        assert Post.query.count() == 1


def test_like_awards_and_removes_bonus_points(client):
    register(client, username="alice", password="secret123")
    upload_post(client, caption="Likeable Photo")
    client.post("/logout")

    register(client, username="bob", password="secret123")
    with flask_app.app_context():
        post = Post.query.filter_by(caption="Likeable Photo").first()
        post_id = post.id

    client.post(f"/api/post/{post_id}/like")
    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        # Alice's upload already crossed the 100pt daily threshold, so her
        # streak is active by the time the like lands -> +10% streak bonus
        # on the 60pt like bonus (60 * 1.1 = 66).
        assert alice.total_score == 166

    client.post(f"/api/post/{post_id}/like")
    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        # Unliking must remove the exact same (boosted) amount that was
        # awarded, not the flat 60, otherwise like/unlike would leak points.
        assert alice.total_score == 100


def test_upload_and_view_in_feed(client):
    register(client)
    response = upload_post(client, caption="Mein Testfoto")
    assert response.status_code == 200
    assert "Mein Testfoto".encode() in response.data

    response = client.get("/feed")
    assert "Mein Testfoto".encode() in response.data


def test_upload_with_caption_is_shown_in_feed(client):
    register(client)
    response = upload_post(client, caption="Das ist eine Testbeschreibung.")
    assert response.status_code == 200
    assert "Das ist eine Testbeschreibung.".encode() in response.data


def test_upload_with_hashtags_normalizes_and_shows_in_feed(client):
    register(client)
    response = upload_post(client, caption="Mit Hashtags", hashtags="schule, #freunde #Freunde lustig")
    assert response.status_code == 200
    assert b"#schule" in response.data
    assert b"#freunde" in response.data
    assert b"#lustig" in response.data

    with flask_app.app_context():
        post = Post.query.filter_by(caption="Mit Hashtags").first()
        # duplicate #freunde/#Freunde collapses to a single tag, case-insensitively
        assert post.hashtags == "#schule #freunde #lustig"


def test_upload_without_caption_works(client):
    register(client)
    response = upload_post(client, caption="")
    assert response.status_code == 200
    with flask_app.app_context():
        assert Post.query.count() == 1


def test_upload_rejects_bad_extension(client):
    register(client)
    response = client.post(
        "/upload",
        data={"caption": "Boeses Format", "photos": [(io.BytesIO(b"not an image"), "clip.exe")]},
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert "erlaubt".encode() in response.data


def test_search_easter_egg_shows_place_label(client):
    response = client.get("/?q=timeskip/place")
    assert b"timeskip/place" in response.data
    assert b"place-label" in response.data


def test_search_easter_egg_shows_tictactoe_label(client):
    response = client.get("/?q=timeskip/tic.tac.toe")
    assert "timeskip/tic.tac.toe".encode() in response.data
    assert b"place-label" in response.data


def test_tictactoe_page_accessible_without_login(client):
    response = client.get("/tictactoe")
    assert response.status_code == 200
    assert b"tictactoe-board" in response.data


def test_search_easter_egg_shows_fruitmerge_label(client):
    response = client.get("/?q=timeskip/fruit.merge")
    assert "timeskip/fruit.merge".encode() in response.data
    assert b"place-label" in response.data


def test_fruitmerge_page_accessible_without_login(client):
    response = client.get("/fruitmerge")
    assert response.status_code == 200
    assert b"fruitCanvas" in response.data


def test_header_search_bar_present_on_every_page(client):
    for path in ["/", "/login", "/register"]:
        response = client.get(path)
        assert b"headerSearchInput" in response.data
        assert b"bottom-nav-house" in response.data


def test_service_worker_served_from_root_for_full_scope(client):
    response = client.get("/service-worker.js")
    assert response.status_code == 200
    assert response.content_type.startswith("application/javascript")
    assert b"CACHE_NAME" in response.data


def test_offline_page_accessible(client):
    response = client.get("/offline")
    assert response.status_code == 200
    assert "Du bist offline".encode() in response.data


def test_manifest_and_service_worker_referenced_in_every_page(client):
    response = client.get("/")
    assert b'rel="manifest"' in response.data
    assert b"/service-worker.js" in response.data


def test_header_search_bar_present_on_feed_page(client):
    register(client)
    upload_post(client, caption="Header Test")
    response = client.get("/feed")
    assert b"headerSearchInput" in response.data


def test_search_hint_shows_a_game_suggestion(client):
    response = client.get("/")
    assert b"search-hint" in response.data
    assert any(
        term.encode() in response.data
        for term in [
            "timeskip/place",
            "timeskip/tic.tac.toe",
            "timeskip/fruit.merge",
            "timeskip/gravity.run",
            "timeskip/knife.hit",
        ]
    )


def test_search_easter_egg_shows_gravityrun_label(client):
    response = client.get("/?q=timeskip/gravity.run")
    assert "timeskip/gravity.run".encode() in response.data
    assert b"place-label" in response.data


def test_gravityrun_page_accessible_without_login(client):
    response = client.get("/gravityrun")
    assert response.status_code == 200
    assert b"runCanvas" in response.data
    assert b"mp-lobby-options" in response.data


def test_search_easter_egg_shows_knifehit_label(client):
    response = client.get("/?q=timeskip/knife.hit")
    assert "timeskip/knife.hit".encode() in response.data
    assert b"place-label" in response.data


def test_knifehit_page_accessible_without_login(client):
    response = client.get("/knifehit")
    assert response.status_code == 200
    assert b"knifeCanvas" in response.data
    assert b"mp-lobby-options" in response.data


def test_search_easter_egg_shows_flappybird_label(client):
    response = client.get("/?q=timeskip/flappy.bird")
    assert "timeskip/flappy.bird".encode() in response.data
    assert b"place-label" in response.data


def test_flappybird_page_accessible_without_login(client):
    response = client.get("/flappybird")
    assert response.status_code == 200
    assert b"flappyCanvas" in response.data


def test_search_easter_egg_shows_blockbuster_label(client):
    response = client.get("/?q=timeskip/block.buster")
    assert "timeskip/block.buster".encode() in response.data
    assert b"place-label" in response.data


def test_blockbuster_page_accessible_without_login(client):
    response = client.get("/blockbuster")
    assert response.status_code == 200
    assert b"blockCanvas" in response.data


def test_place_requires_login(client):
    response = client.get("/place", follow_redirects=True)
    assert b"Login" in response.data


def test_games_page_accessible_without_login_and_lists_all_games(client):
    response = client.get("/games")
    assert response.status_code == 200
    assert b"timeskip/fruit.merge" in response.data
    assert b"timeskip/coin.flip" in response.data


def test_camera_page_requires_login(client):
    response = client.get("/camera", follow_redirects=True)
    assert b"Login" in response.data


def test_camera_page_accessible_when_logged_in(client):
    register(client)
    response = client.get("/camera")
    assert response.status_code == 200
    assert b"cameraCanvas" in response.data


def test_bottom_nav_has_games_and_camera_buttons(client):
    response = client.get("/")
    assert b"bottom-nav-games-btn" in response.data
    assert b"bottom-nav-camera-btn" in response.data


def test_fuzzy_search_matches_game_without_exact_term(client):
    response = client.get("/?q=fruit merge")
    assert "timeskip/fruit.merge".encode() in response.data
    assert b"place-label" in response.data


def test_fuzzy_search_matches_typo_in_game_term(client):
    response = client.get("/?q=fruitmerge")
    assert "timeskip/fruit.merge".encode() in response.data


def test_homepage_shows_game_showcase_row(client):
    response = client.get("/")
    assert b"game-showcase-row" in response.data
    assert b"game-showcase-card" in response.data


def test_most_played_game_gets_highlighted(client):
    client.get("/fruitmerge")
    client.get("/fruitmerge")
    client.get("/gravityrun")

    response = client.get("/")
    assert b"most-played" in response.data
    assert b"MEISTGESPIELT" in response.data


def test_redeem_code_awards_points(client):
    register(client)
    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 0

    response = client.post(
        "/api/redeem-code",
        json={"code": "free for all"},
    )
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["points"] == 500

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 500


def test_redeem_code_cannot_be_used_twice(client):
    register(client)
    client.post("/api/redeem-code", json={"code": "FREE FOR ALL"})
    response = client.post("/api/redeem-code", json={"code": "FREE FOR ALL"})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "already_redeemed"

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 500


def test_redeem_hidden_code_awards_300(client):
    register(client)
    response = client.post("/api/redeem-code", json={"code": "TIMESKIPFREE300FOREVERYONE"})
    data = response.get_json()
    assert data["ok"] is True
    assert data["points"] == 300


def test_redeem_invalid_code_rejected(client):
    register(client)
    response = client.post("/api/redeem-code", json={"code": "NOT-A-REAL-CODE"})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "invalid_code"


def test_redeem_code_requires_login(client):
    response = client.post("/api/redeem-code", json={"code": "FREE FOR ALL"})
    assert response.status_code == 401


def test_share_app_requires_login(client):
    response = client.post("/api/share-app")
    assert response.status_code == 401


def test_share_app_awards_points(client):
    import app as app_module

    register(client, username="alice")
    response = client.post("/api/share-app")
    data = response.get_json()
    assert data["ok"] is True
    assert data["points"] == app_module.APP_SHARE_POINTS
    assert data["total_score"] == app_module.APP_SHARE_POINTS


def test_share_app_enforces_cooldown(client):
    register(client, username="alice")
    client.post("/api/share-app")
    response = client.post("/api/share-app")
    assert response.status_code == 429
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "cooldown"
    assert data["seconds_left"] > 0


def test_share_app_available_again_after_cooldown_window(client):
    import app as app_module
    from datetime import datetime, timedelta, timezone

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.last_app_share_at = datetime.now(timezone.utc) - timedelta(hours=app_module.APP_SHARE_COOLDOWN_HOURS, minutes=1)
    db.session.commit()

    response = client.post("/api/share-app")
    data = response.get_json()
    assert data["ok"] is True
    assert data["total_score"] == app_module.APP_SHARE_POINTS


def test_homepage_shows_app_share_banner_for_logged_in_user(client):
    import app as app_module

    register(client, username="alice")
    response = client.get("/")
    assert b"app-share-banner" in response.data
    assert str(app_module.APP_SHARE_POINTS).encode() in response.data


def test_homepage_shows_redeem_section_for_guest(client):
    response = client.get("/")
    assert b"CODES EINL\xc3\x96SEN" in response.data
    assert "+ 500 PUNKTE BEI ANMELDUNG".encode() in response.data


def test_homepage_shows_redeem_code_chip_for_user(client):
    register(client)
    response = client.get("/")
    assert b"FREE FOR ALL" in response.data
    assert "CODE ERHALTEN".encode() in response.data


def test_homepage_shows_secret_tip_only_for_logged_in_users(client):
    guest_response = client.get("/")
    assert "GEHEIM TIPP".encode() not in guest_response.data

    register(client)
    user_response = client.get("/")
    assert "GEHEIM TIPP".encode() in user_response.data
    assert "COIN FLIPP".encode() in user_response.data
    assert b'href="/coinflip"' in user_response.data


def test_place_pixel_flow(client):
    register(client)

    response = client.post("/place/pixel", json={"x": 5, "y": 10, "color": "#ff0000"})
    assert response.status_code == 200
    assert response.get_json() == {"ok": True}

    pixels = client.get("/place/pixels").get_json()
    assert {"x": 5, "y": 10, "color": "#ff0000"} in pixels

    response = client.post("/place/pixel", json={"x": 6, "y": 10, "color": "#00ff00"})
    assert response.status_code == 429
    assert response.get_json()["error"] == "cooldown"


def test_place_pixel_rejects_out_of_bounds(client):
    register(client)
    response = client.post("/place/pixel", json={"x": 100, "y": 0, "color": "#ff0000"})
    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_coordinates"


def test_place_pixel_rejects_bad_color(client):
    register(client)
    response = client.post("/place/pixel", json={"x": 1, "y": 1, "color": "notacolor"})
    assert response.status_code == 400
    assert response.get_json()["error"] == "invalid_color"


def test_api_like_post_toggle(client):
    register(client)
    upload_post(client, caption="Like API Test")
    with flask_app.app_context():
        post_id = Post.query.filter_by(caption="Like API Test").first().id

    response = client.post(f"/api/post/{post_id}/like")
    assert response.status_code == 200
    data = response.get_json()
    assert data == {"ok": True, "liked": True, "like_count": 1}

    response = client.post(f"/api/post/{post_id}/like")
    assert response.get_json() == {"ok": True, "liked": False, "like_count": 0}


def test_api_like_post_requires_login(client):
    response = client.post("/api/post/1/like")
    assert response.status_code == 401


def test_feed_page_has_download_link(client):
    register(client)
    upload_post(client, caption="Download Test")
    response = client.get("/feed")
    assert b"post-download-btn" in response.data
    assert b"Herunterladen" in response.data


def test_profile_page_shows_username_and_posts(client):
    register(client, username="bob")
    upload_post(client, caption="Bobs Foto")
    response = client.get("/user/bob")
    assert response.status_code == 200
    assert b"bob" in response.data
    assert b"Bobs Foto" in response.data


def test_profile_page_404_for_unknown_user(client):
    response = client.get("/user/doesnotexist")
    assert response.status_code == 404


def test_subscribe_toggle(client):
    register(client, username="alice", password="secret123")
    client.post("/logout")
    register(client, username="bob", password="secret123")
    client.post("/logout")
    client.post("/login", data={"username": "alice", "password": "secret123"})

    response = client.post("/user/bob/subscribe", follow_redirects=True)
    assert response.status_code == 200
    assert b"Gefolgt" in response.data

    response = client.post("/user/bob/subscribe", follow_redirects=True)
    assert b"Folgen" in response.data


def test_leaderboard_shows_follow_button(client):
    register(client, username="alice", password="secret123")
    upload_post(client, caption="Leaderboard Clip")
    client.post("/logout")

    register(client, username="bob", password="secret123")
    response = client.get("/leaderboard")
    assert b"leaderboard-follow-form" in response.data
    assert b"Folgen" in response.data


def test_subscribe_to_self_is_rejected(client):
    register(client, username="alice")
    response = client.post("/user/alice/subscribe")
    assert response.status_code == 400


def test_profile_picture_upload(client):
    register(client, username="alice")
    data = {"profile_image": (io.BytesIO(b"fake image bytes"), "avatar.png")}
    response = client.post(
        "/profile/picture", data=data, content_type="multipart/form-data", follow_redirects=True
    )
    assert response.status_code == 200
    assert b"profile_pics/" in response.data


def test_profile_picture_upload_rejects_bad_extension(client):
    register(client, username="alice")
    data = {"profile_image": (io.BytesIO(b"not an image"), "avatar.exe")}
    response = client.post(
        "/profile/picture", data=data, content_type="multipart/form-data", follow_redirects=True
    )
    assert "erlaubt".encode() in response.data


def test_api_register_and_score(client):
    response = client.post(
        "/api/register", json={"username": "charlie", "password": "secret123"}
    )
    assert response.status_code == 200
    assert response.get_json()["ok"] is True

    response = client.post("/api/score", json={"game": "fruit.merge", "score": 42})
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["total_score"] == 84  # 42 * GAME_SCORE_MULTIPLIER (2)

    response = client.post("/api/score", json={"game": "gravity.run", "score": 8})
    assert response.get_json()["total_score"] == 100  # 84 + 8*2


def test_api_register_duplicate_username(client):
    client.post("/api/register", json={"username": "dana", "password": "secret123"})
    client.post("/logout")
    response = client.post("/api/register", json={"username": "dana", "password": "other123"})
    assert response.status_code == 400
    assert response.get_json()["ok"] is False


def test_api_login_success_and_failure(client):
    register(client, username="erin", password="secret123")
    client.post("/logout")

    response = client.post("/api/login", json={"username": "erin", "password": "wrong"})
    assert response.status_code == 400
    assert response.get_json()["ok"] is False

    response = client.post("/api/login", json={"username": "erin", "password": "secret123"})
    assert response.status_code == 200
    assert response.get_json()["ok"] is True


def test_api_score_requires_login(client):
    response = client.post("/api/score", json={"game": "fruit.merge", "score": 10})
    assert response.status_code == 401


def test_api_score_applies_game_score_multiplier(client):
    import app as app_module

    register(client, username="alice")
    response = client.post("/api/score", json={"game": "block.buster", "score": 50})
    data = response.get_json()
    assert data["total_score"] == 50 * app_module.GAME_SCORE_MULTIPLIER


def test_api_score_rejects_unknown_game(client):
    register(client)
    response = client.post("/api/score", json={"game": "not.a.game", "score": 10})
    assert response.status_code == 400


def test_leaderboard_shows_only_scored_users(client):
    register(client, username="frank")
    client.post("/api/score", json={"game": "knife.hit", "score": 15})
    client.post("/logout")

    register(client, username="gina")
    client.post("/logout")

    response = client.get("/leaderboard")
    assert response.status_code == 200
    assert b"frank" in response.data
    assert b"15" in response.data
    assert b"gina" not in response.data


def test_admin_dashboard_requires_admin(client):
    register(client, username="regular")
    response = client.get("/admin")
    assert response.status_code == 403


def test_admin_dashboard_accessible_for_admin(client):
    register(client, username="boss")
    make_admin("boss")
    response = client.get("/admin")
    assert response.status_code == 200
    assert b"Neuen Account erstellen" in response.data


def test_admin_can_create_fake_account(client):
    register(client, username="boss")
    make_admin("boss")

    response = client.post(
        "/admin/users", data={"username": "fakeuser", "password": "secret123"}, follow_redirects=True
    )
    assert response.status_code == 200
    assert b"fakeuser" in response.data

    client.post("/logout")
    response = client.post(
        "/login", data={"username": "fakeuser", "password": "secret123"}, follow_redirects=True
    )
    assert b"fakeuser" in response.data


def test_non_admin_cannot_create_account_via_admin_route(client):
    register(client, username="regular")
    response = client.post("/admin/users", data={"username": "sneaky", "password": "secret123"})
    assert response.status_code == 403


def test_admin_can_delete_other_account(client):
    register(client, username="boss")
    make_admin("boss")
    client.post("/admin/users", data={"username": "throwaway", "password": "secret123"})

    target = User.query.filter_by(username="throwaway").first()
    response = client.post(f"/admin/users/{target.id}/delete", follow_redirects=True)
    assert response.status_code == 200
    assert User.query.filter_by(username="throwaway").first() is None


def test_admin_cannot_delete_self(client):
    register(client, username="boss")
    make_admin("boss")
    admin = User.query.filter_by(username="boss").first()
    response = client.post(f"/admin/users/{admin.id}/delete")
    assert response.status_code == 400


def test_admin_can_set_any_users_points(client):
    register(client, username="boss")
    make_admin("boss")
    register(client, username="regular")
    client.post("/logout")
    client.post("/login", data={"username": "boss", "password": "secret123"})

    target = User.query.filter_by(username="regular").first()
    response = client.post(f"/admin/users/{target.id}/set-points", data={"total_score": "12345"}, follow_redirects=True)
    assert response.status_code == 200

    target = User.query.filter_by(username="regular").first()
    assert target.total_score == 12345


def test_admin_set_points_requires_admin(client):
    register(client, username="alice")
    response = client.post(f"/admin/users/1/set-points", data={"total_score": "999"})
    assert response.status_code == 403


def test_admin_set_points_clamps_negative_to_zero(client):
    register(client, username="boss")
    make_admin("boss")
    target = User.query.filter_by(username="boss").first()

    client.post(f"/admin/users/{target.id}/set-points", data={"total_score": "-50"})
    target = User.query.filter_by(username="boss").first()
    assert target.total_score == 0


def test_admin_can_delete_any_post(client):
    register(client, username="owner")
    upload_post(client, caption="Owned Photo")
    client.post("/logout")

    register(client, username="boss")
    make_admin("boss")

    with flask_app.app_context():
        post_id = Post.query.filter_by(caption="Owned Photo").first().id

    response = client.post(f"/post/{post_id}/delete", follow_redirects=True)
    assert response.status_code == 200
    assert Post.query.count() == 0


def test_report_post_requires_login(client):
    register(client, username="owner")
    upload_post(client, caption="Photo")
    client.post("/logout")

    response = client.post("/api/post/1/report")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "not_logged_in"


def test_report_post_success(client):
    register(client, username="owner")
    upload_post(client, caption="Photo")
    client.post("/logout")

    register(client, username="reporter")
    response = client.post("/api/post/1/report")
    data = response.get_json()
    assert data["ok"] is True

    reports = PostReport.query.filter_by(post_id=1).all()
    assert len(reports) == 1
    assert reports[0].reporter.username == "reporter"


def test_report_post_twice_by_same_user_fails(client):
    register(client, username="owner")
    upload_post(client, caption="Photo")
    client.post("/logout")

    register(client, username="reporter")
    client.post("/api/post/1/report")
    response = client.post("/api/post/1/report")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "already_reported"


def test_admin_sees_reported_posts(client):
    register(client, username="owner")
    upload_post(client, caption="Reported Photo")
    client.post("/logout")

    register(client, username="reporter")
    client.post("/api/post/1/report")
    client.post("/logout")

    register(client, username="boss")
    make_admin("boss")
    response = client.get("/admin")
    assert b"Reported Photo" in response.data
    assert b"reporter" in response.data


def test_admin_can_dismiss_report(client):
    register(client, username="owner")
    upload_post(client, caption="Photo")
    client.post("/logout")

    register(client, username="reporter")
    client.post("/api/post/1/report")
    client.post("/logout")

    register(client, username="boss")
    make_admin("boss")
    report = PostReport.query.first()
    response = client.post(f"/admin/reports/{report.id}/dismiss", follow_redirects=True)
    assert response.status_code == 200
    assert PostReport.query.count() == 0
    # dismissing a report does not delete the post itself
    assert Post.query.count() == 1


def test_regular_user_still_cannot_delete_others_post(client):
    register(client, username="owner")
    upload_post(client, caption="Protected Photo")
    client.post("/logout")

    register(client, username="stranger")
    response = client.post("/post/1/delete")
    assert response.status_code == 403


def test_feed_page_accessible_and_shows_photo(client):
    register(client)
    upload_post(client, caption="Feed Photo")
    response = client.get("/feed")
    assert response.status_code == 200
    assert b"Feed Photo" in response.data


def test_feed_page_empty_state(client):
    response = client.get("/feed")
    assert response.status_code == 200
    assert "Noch keine Fotos vorhanden".encode() in response.data


def test_feed_shows_swipe_dots_for_multi_photo_post(client):
    register(client)
    upload_post(client, caption="Multi", filenames=["a.png", "b.png"])
    response = client.get("/feed")
    assert b"post-photo-dot" in response.data


def test_homepage_shows_redeem_login_button_for_guest(client):
    response = client.get("/")
    assert b"redeem-login-btn" in response.data
    assert b'href="/register"' in response.data


def test_api_my_stats_requires_login(client):
    response = client.get("/api/my-stats")
    assert response.status_code == 401


def test_api_my_stats_reports_likes_and_followers(client):
    register(client, username="alice")
    upload_post(client, caption="Stats Photo")
    client.post("/logout")

    register(client, username="bob")
    client.post("/api/post/1/like")
    client.post("/user/alice/subscribe")
    client.post("/logout")

    register(client, username="carol")
    client.post("/api/post/1/like")
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    response = client.get("/api/my-stats")
    assert response.status_code == 200
    data = response.get_json()
    assert data == {"ok": True, "likes_received": 2, "followers": 1}


def test_homepage_bottom_nav_has_stats_bubble_markup_for_user(client):
    register(client)
    response = client.get("/")
    assert b"statsBubble" in response.data
    assert b"stats-bubble-tail" in response.data


def test_api_subscribe_toggle(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    client.post("/login", data={"username": "alice", "password": "secret123"})

    response = client.post("/api/user/bob/subscribe")
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["subscribed"] is True
    assert data["subscriber_count"] == 1

    response = client.post("/api/user/bob/subscribe")
    assert response.get_json()["subscribed"] is False


def test_api_subscribe_to_self_rejected(client):
    register(client, username="alice")
    response = client.post("/api/user/alice/subscribe")
    assert response.status_code == 400


def test_user_has_unique_public_id(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")

    alice = User.query.filter_by(username="alice").first()
    bob = User.query.filter_by(username="bob").first()
    assert alice.public_id is not None
    assert bob.public_id is not None
    assert alice.public_id != bob.public_id


def test_account_settings_requires_login(client):
    response = client.get("/account/settings", follow_redirects=True)
    assert b"Login" in response.data


def test_account_settings_shows_public_id(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    response = client.get("/account/settings")
    assert user.public_id.encode() in response.data


def test_username_change_blocked_without_email(client):
    register(client, username="alice")
    response = client.post("/account/username", data={"username": "newname"})
    assert response.status_code == 400


def test_password_change_blocked_without_email(client):
    register(client, username="alice")
    response = client.post(
        "/account/password", data={"current_password": "secret123", "new_password": "newpass123"}
    )
    assert response.status_code == 400


def test_add_email_unlocks_username_and_password_change(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "alice@example.com"}, follow_redirects=True)

    response = client.post("/account/username", data={"username": "newalice"}, follow_redirects=True)
    assert response.status_code == 200
    assert User.query.filter_by(username="newalice").first() is not None

    response = client.post(
        "/account/password",
        data={"current_password": "secret123", "new_password": "newpass123"},
        follow_redirects=True,
    )
    assert response.status_code == 200

    client.post("/logout")
    response = client.post(
        "/login", data={"username": "newalice", "password": "newpass123"}, follow_redirects=True
    )
    assert b"newalice" in response.data


def test_password_change_rejects_wrong_current_password(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "alice@example.com"})
    response = client.post(
        "/account/password",
        data={"current_password": "wrongpass", "new_password": "newpass123"},
        follow_redirects=True,
    )
    assert "falsch".encode() in response.data


def test_email_must_be_unique(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "shared@example.com"})
    client.post("/logout")

    register(client, username="bob")
    response = client.post(
        "/account/email", data={"email": "shared@example.com"}, follow_redirects=True
    )
    assert "verwendet".encode() in response.data


def test_email_not_shown_on_public_profile(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "secret@example.com"})
    client.post("/logout")

    response = client.get("/user/alice")
    assert b"secret@example.com" not in response.data


def test_last_seen_updated_on_request_and_shown_as_online_in_admin(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice")
    make_admin("alice")

    register(client, username="bob")
    client.get("/")  # updates bob's last_seen via before_request
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})

    response = client.get("/admin")
    assert b"Online" in response.data

    bob = User.query.filter_by(username="bob").first()
    assert bob.last_seen is not None

    # Simulate bob having been gone for a long time -> should show Offline
    bob.last_seen = datetime.now(timezone.utc) - timedelta(hours=1)
    db.session.commit()

    response = client.get("/admin")
    assert b"Offline" in response.data


def test_streak_starts_at_one_after_earning_100_points_in_a_day(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    assert user.current_streak == 0

    app_module.adjust_points(user, 100)
    db.session.commit()

    assert user.current_streak == 1
    assert user.best_streak == 1
    assert app_module.effective_streak(user) == 1


def test_streak_multiplier_boosts_points_earned(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 3
    user.best_streak = 3
    user.last_streak_date = app_module.streak_today()  # active streak, counted by effective_streak
    db.session.commit()

    assert app_module.streak_points_multiplier(user) == 1.3  # 1 + 3*0.1

    before = user.total_score
    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.total_score == before + 130  # 100 * 1.3


def test_streak_multiplier_caps_at_30_percent(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 25  # way past the 3-day cap point
    user.best_streak = 25
    user.last_streak_date = app_module.streak_today()
    db.session.commit()

    assert app_module.streak_points_multiplier(user) == 1.3  # capped at +30%

    before = user.total_score
    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.total_score == before + 130


def test_no_streak_means_no_multiplier_bonus(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    assert app_module.streak_points_multiplier(user) == 1.0

    before = user.total_score
    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.total_score == before + 100


def test_like_unlike_stays_symmetric_with_active_streak_bonus(client):
    import app as app_module

    register(client, username="owner")
    owner = User.query.filter_by(username="owner").first()
    owner.current_streak = 5
    owner.best_streak = 5
    owner.last_streak_date = app_module.streak_today()
    post = Post(caption="Photo", user_id=owner.id)
    db.session.add(post)
    db.session.flush()
    db.session.add(PostPhoto(post_id=post.id, filename="clip.png", position=0, content_hash="hash1"))
    db.session.commit()
    post_id = post.id
    client.post("/logout")

    register(client, username="liker")
    client.post(f"/api/post/{post_id}/like")

    owner = User.query.filter_by(username="owner").first()
    assert owner.total_score == 78  # 60 * 1.3 (5-day streak, capped at +30%)

    client.post(f"/api/post/{post_id}/like")  # unlike
    owner = User.query.filter_by(username="owner").first()
    assert owner.total_score == 0  # exact reversal, no leftover leak


def test_streak_continues_on_consecutive_day_and_resets_after_gap(client):
    import app as app_module
    from datetime import timedelta

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    yesterday = app_module.streak_today() - timedelta(days=1)
    user.current_streak = 3
    user.best_streak = 3
    user.last_streak_date = yesterday
    user.points_today_date = yesterday
    user.points_earned_today = 0
    db.session.commit()

    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.current_streak == 4
    assert user.best_streak == 4

    # Now simulate a missed day (streak was 4, two days ago) -> should reset to 1
    two_days_ago = app_module.streak_today() - timedelta(days=2)
    user.current_streak = 4
    user.last_streak_date = two_days_ago
    user.points_today_date = two_days_ago
    user.points_earned_today = 0
    db.session.commit()

    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.current_streak == 1
    assert user.best_streak == 4  # best streak is preserved even after a reset


def test_streak_below_100_points_does_not_count(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    app_module.adjust_points(user, 99)
    db.session.commit()
    assert user.current_streak == 0


def test_badges_include_streak_milestones_and_rank_one(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.best_streak = 3
    user.ever_rank_one = True
    db.session.commit()

    badges = app_module.user_badges(user)
    assert badges == ["1", "2", "3", "Platz 1"]


def test_leaderboard_marks_top_user_as_ever_rank_one(client):
    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    alice.total_score = 500
    db.session.commit()

    client.get("/leaderboard")
    alice = User.query.filter_by(username="alice").first()
    assert alice.ever_rank_one is True


def test_profile_shows_streak_and_badge_for_owner(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 2
    user.best_streak = 2
    user.last_streak_date = app_module.streak_today()
    db.session.commit()

    response = client.get("/user/alice")
    assert b"Tage Streak" in response.data
    assert b"badgeModalOpenBtn" in response.data


def test_streak_day_rolls_over_at_11am_berlin(client, monkeypatch):
    import app as app_module
    from datetime import datetime, timezone, timedelta
    from zoneinfo import ZoneInfo

    berlin = ZoneInfo("Europe/Berlin")
    just_before = datetime(2025, 6, 15, 10, 59, tzinfo=berlin).astimezone(timezone.utc)
    just_after = datetime(2025, 6, 15, 11, 1, tzinfo=berlin).astimezone(timezone.utc)

    class FakeDateTime(datetime):
        fixed_now = just_before

        @classmethod
        def now(cls, tz=None):
            return cls.fixed_now

    monkeypatch.setattr(app_module, "datetime", FakeDateTime)

    day_before = app_module.streak_today()
    FakeDateTime.fixed_now = just_after
    day_after = app_module.streak_today()

    assert day_after == day_before + timedelta(days=1)


def test_streak_display_hidden_until_secured_today(client):
    import app as app_module
    from datetime import timedelta

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 3
    user.best_streak = 3
    # streak is still alive (yesterday), but not yet secured for today
    user.last_streak_date = app_module.streak_today() - timedelta(days=1)
    db.session.commit()

    assert app_module.effective_streak(user) == 3  # still counts for the multiplier
    assert app_module.is_streak_secured_today(user) is False  # but not shown yet

    response = client.get("/user/alice")
    assert b"Tage Streak" not in response.data

    user.last_streak_date = app_module.streak_today()
    db.session.commit()
    assert app_module.is_streak_secured_today(user) is True

    response = client.get("/user/alice")
    assert b"Tage Streak" in response.data


def test_leaderboard_shows_streak_only_when_secured(client):
    import app as app_module
    from datetime import timedelta

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 500
    user.current_streak = 4
    user.best_streak = 4
    user.last_streak_date = app_module.streak_today() - timedelta(days=1)
    db.session.commit()

    response = client.get("/leaderboard")
    assert b"leaderboard-streak" not in response.data

    user.last_streak_date = app_module.streak_today()
    db.session.commit()

    response = client.get("/leaderboard")
    assert b"leaderboard-streak" in response.data


def make_eligible_for_code_creation(username, total_score=1000):
    user = User.query.filter_by(username=username).first()
    user.organic_points_earned = 500
    user.total_score = total_score
    db.session.commit()
    return user


def test_create_codes_requires_500_organic_points(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.organic_points_earned = 100
    user.total_score = 1000
    db.session.commit()

    response = client.post("/api/create-codes", json={"points_per_code": 100, "count": 1})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "not_eligible"


def test_create_codes_success_deducts_points_and_applies_fee(client):
    register(client, username="alice")
    make_eligible_for_code_creation("alice", total_score=1000)

    response = client.post("/api/create-codes", json={"points_per_code": 100, "count": 3})
    data = response.get_json()
    assert data["ok"] is True
    assert len(data["codes"]) == 3
    assert len(set(data["codes"])) == 3  # all unique
    assert data["points_value"] == 97  # 100 - 3%
    assert data["fee_percent"] == 3

    alice = User.query.filter_by(username="alice").first()
    assert alice.total_score == 1000 - 300  # 3 codes * 100 points each


def test_create_codes_insufficient_funds(client):
    register(client, username="alice")
    make_eligible_for_code_creation("alice", total_score=50)

    response = client.post("/api/create-codes", json={"points_per_code": 100, "count": 1})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "insufficient_funds"


def test_redeem_user_created_code(client):
    register(client, username="alice")
    make_eligible_for_code_creation("alice", total_score=1000)
    create_response = client.post("/api/create-codes", json={"points_per_code": 100, "count": 1})
    code = create_response.get_json()["codes"][0]
    client.post("/logout")

    register(client, username="bob")
    response = client.post("/api/redeem-code", json={"code": code})
    data = response.get_json()
    assert data["ok"] is True
    assert data["points"] == 97

    bob = User.query.filter_by(username="bob").first()
    assert bob.total_score == 97

    # Redeeming again (by a third user) must fail -- single-use code
    client.post("/logout")
    register(client, username="carol")
    response = client.post("/api/redeem-code", json={"code": code})
    assert response.get_json()["ok"] is False


def test_cannot_redeem_own_created_code(client):
    register(client, username="alice")
    make_eligible_for_code_creation("alice", total_score=1000)
    create_response = client.post("/api/create-codes", json={"points_per_code": 100, "count": 1})
    code = create_response.get_json()["codes"][0]

    response = client.post("/api/redeem-code", json={"code": code})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "cannot_redeem_own_code"


def mutual_follow(client, user_a, user_b):
    """Log in as each user in turn and subscribe to the other, making them mutual followers."""
    client.post("/login", data={"username": user_a, "password": "secret123"})
    a = User.query.filter_by(username=user_a).first()
    b = User.query.filter_by(username=user_b).first()
    client.post(f"/api/user/{user_b}/subscribe")
    client.post("/logout")
    client.post("/login", data={"username": user_b, "password": "secret123"})
    client.post(f"/api/user/{user_a}/subscribe")
    client.post("/logout")


def test_cannot_start_dm_without_mutual_follow(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")

    response = client.post("/api/messages/start-dm", json={"username": "alice"})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "not_mutual_follow"


def test_start_dm_with_mutual_follow_and_reuses_existing_conversation(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")

    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    response = client.post("/api/messages/start-dm", json={"username": "bob"})
    data = response.get_json()
    assert data["ok"] is True
    conv_id = data["conversation_id"]

    # Calling again returns the same conversation, doesn't create a second one
    response2 = client.post("/api/messages/start-dm", json={"username": "bob"})
    assert response2.get_json()["conversation_id"] == conv_id


def test_send_and_receive_message_in_dm(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    client.post(f"/api/messages/{conv_id}/send", json={"text": "Hallo Bob!"})
    client.post("/logout")

    client.post("/login", data={"username": "bob", "password": "secret123"})
    response = client.get(f"/api/messages/{conv_id}")
    data = response.get_json()
    assert data["ok"] is True
    assert len(data["messages"]) == 1
    assert data["messages"][0]["text"] == "Hallo Bob!"
    assert data["messages"][0]["is_mine"] is False


def test_non_member_cannot_access_conversation(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    client.post("/logout")

    register(client, username="carol")
    response = client.get(f"/api/messages/{conv_id}")
    assert response.get_json()["ok"] is False


def test_message_self_deletes_15_seconds_after_being_viewed(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    client.post(f"/api/messages/{conv_id}/send", json={"text": "Hallo Bob!"})
    client.post("/logout")

    client.post("/login", data={"username": "bob", "password": "secret123"})
    client.get(f"/api/messages/{conv_id}")  # marks it viewed
    message = Message.query.filter_by(conversation_id=conv_id).first()
    assert message is not None
    assert message.viewed_at is not None

    # Simulate 16 seconds having passed since it was viewed
    message.viewed_at = datetime.now(timezone.utc) - timedelta(seconds=16)
    db.session.commit()

    response = client.get(f"/api/messages/{conv_id}")
    assert response.get_json()["messages"] == []
    assert Message.query.filter_by(conversation_id=conv_id).first() is None


def test_messages_page_shows_prominent_group_button_once(client):
    register(client, username="alice")
    response = client.get("/messages")
    assert response.data.count(b'id="createGroupToggleBtn"') == 1
    assert b"Gruppe" in response.data


def test_create_group_requires_2_to_99_mutual_follow_members(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    response = client.post("/api/messages/create-group", json={"name": "Team", "usernames": ["bob"]})
    data = response.get_json()
    assert data["ok"] is True

    conv = db.session.get(Conversation, data["conversation_id"])
    assert conv.is_group is True
    assert len(conv.members) == 2


def test_create_group_rejects_non_mutual_follow_member(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    register(client, username="carol")  # not mutually followed by alice
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    response = client.post("/api/messages/create-group", json={"name": "Team", "usernames": ["carol"]})
    assert response.get_json()["ok"] is False


def test_share_post_creates_message_with_shared_post(client):
    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    post = Post(caption="cool photo", user_id=alice.id)
    db.session.add(post)
    db.session.flush()
    db.session.add(PostPhoto(post_id=post.id, filename="clip.png", position=0, content_hash="clip-hash"))
    db.session.commit()
    post_id = post.id
    client.post("/logout")

    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    response = client.post(f"/api/posts/{post_id}/share", json={"conversation_id": conv_id})
    assert response.get_json()["ok"] is True

    messages_data = client.get(f"/api/messages/{conv_id}").get_json()["messages"]
    assert messages_data[0]["shared_post"]["caption"] == "cool photo"


def test_liked_posts_page_lists_liked_posts(client):
    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    post = Post(caption="liked photo", user_id=alice.id)
    db.session.add(post)
    db.session.flush()
    db.session.add(PostPhoto(post_id=post.id, filename="liked.png", position=0, content_hash="liked-hash"))
    db.session.commit()
    post_id = post.id

    client.post(f"/api/post/{post_id}/like")
    response = client.get("/liked-posts")
    assert b"liked photo" in response.data


def test_coinflip_page_loads(client):
    register(client, username="alice")
    response = client.get("/coinflip")
    assert response.status_code == 200
    assert b"timeskip/coin.flip" in response.data


def test_coinflip_win_chance_is_highest_for_zero_points(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 0
    db.session.commit()

    assert app_module.coinflip_win_chance(user) == app_module.COINFLIP_MAX_WIN_CHANCE


def test_coinflip_win_chance_decreases_as_points_grow(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    user.total_score = 500
    db.session.commit()
    low_chance = app_module.coinflip_win_chance(user)

    user.total_score = 100000
    db.session.commit()
    high_chance = app_module.coinflip_win_chance(user)

    assert app_module.COINFLIP_MIN_WIN_CHANCE < low_chance < app_module.COINFLIP_MAX_WIN_CHANCE
    assert high_chance < low_chance
    assert high_chance == pytest.approx(app_module.COINFLIP_MIN_WIN_CHANCE, abs=0.01)


def test_coinflip_page_shows_win_chance_for_current_balance(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 0
    db.session.commit()

    response = client.get("/coinflip")
    expected_pct = round(app_module.COINFLIP_MAX_WIN_CHANCE * 100)
    assert f'id="coinflipWinChanceText">{expected_pct}<'.encode() in response.data


def test_coinflip_flip_response_includes_win_chance(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 100
    db.session.commit()
    expected_chance = app_module.coinflip_win_chance(user)  # win_chance is based on pre-stake balance

    monkeypatch.setattr(app_module.random, "random", lambda: 0.1)
    response = client.post("/api/coinflip/flip", json={"stake": 10})
    data = response.get_json()
    assert data["ok"] is True
    assert data["win_chance"] == pytest.approx(expected_chance, abs=0.001)


def test_coinflip_win_pays_1point5x_stake(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 100
    db.session.commit()

    monkeypatch.setattr(app_module.random, "random", lambda: 0.1)  # < 0.4 win chance -> win
    response = client.post("/api/coinflip/flip", json={"stake": 10})
    data = response.get_json()
    assert data["ok"] is True
    assert data["results"] == ["win"]
    assert data["payout"] == 15  # 10 * 1.5x base multiplier
    assert data["total_score"] == 105  # 100 - 10 + 15


def test_coinflip_lose_forfeits_stake(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 100
    db.session.commit()

    monkeypatch.setattr(app_module.random, "random", lambda: 0.9)  # >= 0.4 win chance -> lose
    response = client.post("/api/coinflip/flip", json={"stake": 10})
    data = response.get_json()
    assert data["ok"] is True
    assert data["results"] == ["lose"]
    assert data["payout"] == 0
    assert data["total_score"] == 90


def test_coinflip_insufficient_funds(client):
    register(client, username="alice")
    response = client.post("/api/coinflip/flip", json={"stake": 999999})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "insufficient_funds"


def test_coinflip_buy_worker_boosts_multiplier(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    buy_response = client.post("/api/coinflip/buy-worker")
    buy_data = buy_response.get_json()
    assert buy_data["ok"] is True
    assert buy_data["worker_count"] == 1
    assert buy_data["total_score"] == 970  # 1000 - 30

    monkeypatch.setattr(app_module.random, "random", lambda: 0.1)  # win
    response = client.post("/api/coinflip/flip", json={"stake": 10})
    data = response.get_json()
    assert data["multiplier"] == 2.5
    assert data["payout"] == 25  # 10 * 2.5x


def test_coinflip_buy_coin_adds_simultaneous_flip(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    buy_response = client.post("/api/coinflip/buy-coin")
    buy_data = buy_response.get_json()
    assert buy_data["ok"] is True
    assert buy_data["coins"] == 2
    assert buy_data["total_score"] == 900  # 1000 - 100

    monkeypatch.setattr(app_module.random, "random", lambda: 0.1)  # both coins win
    response = client.post("/api/coinflip/flip", json={"stake": 10})
    data = response.get_json()
    assert len(data["results"]) == 2
    assert data["payout"] == 30  # 2 coins x 10 stake x 1.5x


def test_coinflip_buy_worker_insufficient_funds(client):
    register(client, username="alice")
    response = client.post("/api/coinflip/buy-worker")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "insufficient_funds"


def test_coinflip_worker_cost_doubles_each_purchase(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    first = client.post("/api/coinflip/buy-worker").get_json()
    assert first["total_score"] == 970  # 1000 - 30
    assert first["next_cost"] == 60

    second = client.post("/api/coinflip/buy-worker").get_json()
    assert second["total_score"] == 910  # 970 - 60
    assert second["next_cost"] == 120

    third = client.post("/api/coinflip/buy-worker").get_json()
    assert third["total_score"] == 790  # 910 - 120


def test_coinflip_coin_cost_doubles_each_purchase(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    first = client.post("/api/coinflip/buy-coin").get_json()
    assert first["total_score"] == 900  # 1000 - 100
    assert first["next_cost"] == 200

    second = client.post("/api/coinflip/buy-coin").get_json()
    assert second["total_score"] == 700  # 900 - 200
    assert second["next_cost"] == 400


def test_coinflip_rebirth_resets_gadgets_and_grants_multiplier_bonus(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 10000
    db.session.commit()

    client.post("/api/coinflip/buy-worker")
    client.post("/api/coinflip/buy-coin")
    client.post("/api/coinflip/buy-coin")

    user = User.query.filter_by(username="alice").first()
    assert user.coinflip_worker_count == 1
    assert user.coinflip_coins == 3
    before_score = user.total_score

    response = client.post("/api/coinflip/rebirth")
    data = response.get_json()
    assert data["ok"] is True
    assert data["rebirths"] == 1
    assert data["worker_count"] == 0
    assert data["coins"] == 1
    assert data["multiplier_bonus"] == 0.2
    assert data["total_score"] == before_score - 500

    user = User.query.filter_by(username="alice").first()
    assert user.coinflip_worker_count == 0
    assert user.coinflip_coins == 1
    assert user.coinflip_rebirths == 1

    # Winning payout now includes the +0.2 rebirth bonus on top of the base 1.5x
    # (no worker owned yet post-rebirth, so this is base_multiplier + bonus)
    monkeypatch.setattr(app_module.random, "random", lambda: 0.1)  # win
    flip_response = client.post("/api/coinflip/flip", json={"stake": 10}).get_json()
    assert flip_response["multiplier"] == 1.7
    assert flip_response["payout"] == 17  # int(10 * 1.7)

    # Next worker/coin purchase is back to the base cost after the reset
    balance_before_worker = flip_response["total_score"]
    worker_response = client.post("/api/coinflip/buy-worker").get_json()
    assert worker_response["total_score"] == balance_before_worker - 30


def test_coinflip_second_rebirth_costs_1000_and_gives_0point4_bonus(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 10000
    db.session.commit()

    first = client.post("/api/coinflip/rebirth").get_json()
    assert first["next_rebirth_cost"] == 1000

    second = client.post("/api/coinflip/rebirth")
    second_data = second.get_json()
    assert second_data["ok"] is True
    assert second_data["rebirths"] == 2
    assert second_data["multiplier_bonus"] == 0.4
    assert second_data["total_score"] == 10000 - 500 - 1000


def test_coinflip_rebirth_insufficient_funds(client):
    register(client, username="alice")
    response = client.post("/api/coinflip/rebirth")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "insufficient_funds"


def test_coinflip_deposit_start_success(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    response = client.post("/api/coinflip/deposit/start", json={"stake": 100, "duration_minutes": 30})
    data = response.get_json()
    assert data["ok"] is True
    assert data["total_score"] == 900
    assert data["deposit"]["staked_amount"] == 100
    assert data["deposit"]["status"] == "pending"

    from models import CoinflipDeposit
    assert CoinflipDeposit.query.count() == 1


def test_coinflip_deposit_start_rejects_duration_out_of_range(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    too_short = client.post("/api/coinflip/deposit/start", json={"stake": 10, "duration_minutes": 4}).get_json()
    assert too_short["ok"] is False
    assert too_short["error"] == "invalid_duration"

    too_long = client.post("/api/coinflip/deposit/start", json={"stake": 10, "duration_minutes": 721}).get_json()
    assert too_long["ok"] is False
    assert too_long["error"] == "invalid_duration"


def test_coinflip_deposit_start_insufficient_funds(client):
    register(client, username="alice")
    response = client.post("/api/coinflip/deposit/start", json={"stake": 999999, "duration_minutes": 30})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "insufficient_funds"


def test_coinflip_deposit_collect_too_early(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    start = client.post("/api/coinflip/deposit/start", json={"stake": 100, "duration_minutes": 30}).get_json()
    response = client.post(f"/api/coinflip/deposit/{start['deposit']['id']}/collect")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "not_ready"


def test_coinflip_deposit_collect_success_within_window(client, monkeypatch):
    import app as app_module
    from datetime import datetime, timezone, timedelta
    from models import CoinflipDeposit

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    start = client.post("/api/coinflip/deposit/start", json={"stake": 100, "duration_minutes": 30}).get_json()
    deposit = db.session.get(CoinflipDeposit, start["deposit"]["id"])
    deposit.matures_at = datetime.now(timezone.utc) - timedelta(minutes=5)  # already matured
    db.session.commit()

    monkeypatch.setattr(app_module.random, "uniform", lambda lo, hi: 1.3)
    response = client.post(f"/api/coinflip/deposit/{deposit.id}/collect")
    data = response.get_json()
    assert data["ok"] is True
    assert data["multiplier"] == 1.3
    assert data["payout"] == 130  # int(100 * 1.3)
    assert data["total_score"] == 900 + 130  # 1000 - 100 stake + 130 payout

    assert CoinflipDeposit.query.count() == 0  # collected deposit is removed


def test_coinflip_deposit_collect_expired_forfeits_stake(client):
    from datetime import datetime, timezone, timedelta
    from models import CoinflipDeposit

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    start = client.post("/api/coinflip/deposit/start", json={"stake": 100, "duration_minutes": 30}).get_json()
    deposit = db.session.get(CoinflipDeposit, start["deposit"]["id"])
    # matured 20 minutes ago -> 5 minutes past the 15-minute collect window
    deposit.matures_at = datetime.now(timezone.utc) - timedelta(minutes=20)
    db.session.commit()

    response = client.post(f"/api/coinflip/deposit/{deposit.id}/collect")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "expired"

    user = User.query.filter_by(username="alice").first()
    assert user.total_score == 900  # stake never comes back
    assert CoinflipDeposit.query.count() == 0  # forfeited deposit is purged


def test_coinflip_deposits_list_purges_expired_ones(client):
    from datetime import datetime, timezone, timedelta
    from models import CoinflipDeposit

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    start = client.post("/api/coinflip/deposit/start", json={"stake": 100, "duration_minutes": 30}).get_json()
    deposit = db.session.get(CoinflipDeposit, start["deposit"]["id"])
    deposit.matures_at = datetime.now(timezone.utc) - timedelta(minutes=20)
    db.session.commit()

    response = client.get("/api/coinflip/deposits")
    data = response.get_json()
    assert data["deposits"] == []
    assert CoinflipDeposit.query.count() == 0


def create_meme_template():
    tpl = MemeTemplate(filename="template.png")
    db.session.add(tpl)
    db.session.commit()
    return tpl


def create_lobby_via_api(client, max_players=11, round_seconds=60):
    response = client.post(
        "/api/meme/create-lobby",
        json={"max_players": max_players, "round_seconds": round_seconds},
    )
    data = response.get_json()
    assert data["ok"] is True
    return data["code"]


def join_lobby_via_api(client, code):
    response = client.post("/api/meme/join", json={"code": code})
    return response.get_json()


def start_lobby_via_api(client, lobby_id):
    return client.post(
        f"/api/meme/lobby/{lobby_id}/start", json={"confirmed_responsibility": True}
    ).get_json()


def test_make_a_meme_page_requires_login(client):
    response = client.get("/make-a-meme", follow_redirects=True)
    assert b"Login" in response.data


def test_games_page_includes_make_a_meme(client):
    response = client.get("/games")
    assert b"timeskip/make.a.meme" in response.data


def test_meme_create_lobby_and_join(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    assert len(code) == 6
    client.post("/logout")

    register(client, username="bob")
    data = join_lobby_via_api(client, code)
    assert data["ok"] is True
    assert data["code"] == code

    with flask_app.app_context():
        lobby = MemeLobby.query.filter_by(code=code).first()
        assert len(lobby.players) == 2


def test_meme_join_invalid_code(client):
    register(client, username="alice")
    data = join_lobby_via_api(client, "000000")
    assert data["ok"] is False
    assert data["error"] == "not_found"


def test_meme_join_full_lobby(client):
    register(client, username="alice")
    code = create_lobby_via_api(client, max_players=1)
    client.post("/logout")

    register(client, username="bob")
    data = join_lobby_via_api(client, code)
    assert data["ok"] is False
    assert data["error"] == "full"


def test_meme_lobby_page_requires_membership(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    client.post("/logout")

    register(client, username="stranger")
    response = client.get(f"/make-a-meme/{code}")
    assert response.status_code == 403


def test_meme_start_requires_leader(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    client.post("/logout")

    register(client, username="bob")
    join_lobby_via_api(client, code)
    response = client.post(f"/api/meme/lobby/{lobby_id}/start", json={"confirmed_responsibility": True})
    assert response.status_code == 403


def test_meme_start_requires_responsibility_confirmation(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    create_meme_template()
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id

    response = client.post(f"/api/meme/lobby/{lobby_id}/start", json={"confirmed_responsibility": False})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "responsibility_not_confirmed"


def test_meme_start_requires_templates(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id

    data = start_lobby_via_api(client, lobby_id)
    assert data["ok"] is False
    assert data["error"] == "no_templates"


def test_meme_start_assigns_templates_and_transitions_to_round(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    create_meme_template()
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id

    data = start_lobby_via_api(client, lobby_id)
    assert data["ok"] is True

    state = client.get(f"/api/meme/lobby/{lobby_id}/state").get_json()
    assert state["status"] == "round"
    assert state["round_number"] == 1
    assert state["template"]["id"] is not None
    assert state["submitted"] is False


def test_meme_next_template_costs_points(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 1000
    db.session.commit()

    code = create_lobby_via_api(client)
    create_meme_template()
    create_meme_template()
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)

    response = client.post(f"/api/meme/lobby/{lobby_id}/next-template")
    data = response.get_json()
    assert data["ok"] is True
    assert data["total_score"] == 900  # 1000 - MEME_DEFAULT_TEMPLATE_COST (100)


def test_meme_next_template_insufficient_funds(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    create_meme_template()
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)

    response = client.post(f"/api/meme/lobby/{lobby_id}/next-template")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "insufficient_funds"


def test_meme_submit_creates_creation(client):
    register(client, username="alice")
    code = create_lobby_via_api(client)
    create_meme_template()
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)

    response = client.post(
        f"/api/meme/lobby/{lobby_id}/submit",
        data={"photo": (io.BytesIO(b"fake meme bytes"), "meme.png")},
        content_type="multipart/form-data",
    )
    assert response.get_json()["ok"] is True

    with flask_app.app_context():
        assert MemeCreation.query.filter_by(lobby_id=lobby_id, round_number=1).count() == 1

    state = client.get(f"/api/meme/lobby/{lobby_id}/state").get_json()
    assert state["submitted"] is True


def test_meme_round_auto_transitions_to_voting_after_time(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice")
    code = create_lobby_via_api(client, round_seconds=20)
    create_meme_template()
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.round_started_at = datetime.now(timezone.utc) - timedelta(seconds=21)
    db.session.commit()

    state = client.get(f"/api/meme/lobby/{lobby_id}/state").get_json()
    assert state["status"] in ("voting", "results")  # no creations submitted -> skips straight to results


def test_meme_vote_and_results_ranking(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice", password="secret123")
    code = create_lobby_via_api(client, round_seconds=20)
    create_meme_template()
    client.post("/logout")

    register(client, username="bob", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    register(client, username="carol", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)
    client.post(
        f"/api/meme/lobby/{lobby_id}/submit",
        data={"photo": (io.BytesIO(b"alice meme"), "a.png")},
        content_type="multipart/form-data",
    )
    client.post("/logout")

    client.post("/login", data={"username": "bob", "password": "secret123"})
    client.post(
        f"/api/meme/lobby/{lobby_id}/submit",
        data={"photo": (io.BytesIO(b"bob meme"), "b.png")},
        content_type="multipart/form-data",
    )

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.round_started_at = datetime.now(timezone.utc) - timedelta(seconds=21)
    db.session.commit()

    state = client.get(f"/api/meme/lobby/{lobby_id}/state").get_json()
    assert state["status"] == "voting"
    assert state["voting_total"] == 2
    first_creation_id = state["current_creation"]["id"]

    client.post(
        f"/api/meme/lobby/{lobby_id}/vote",
        json={"creation_id": first_creation_id, "value": True},
    )
    client.post("/logout")

    client.post("/login", data={"username": "carol", "password": "secret123"})
    client.post(
        f"/api/meme/lobby/{lobby_id}/vote",
        json={"creation_id": first_creation_id, "value": True},
    )

    voting_lobby = db.session.get(MemeLobby, lobby_id)
    voting_lobby.voting_started_at = datetime.now(timezone.utc) - timedelta(seconds=100)
    db.session.commit()

    state = client.get(f"/api/meme/lobby/{lobby_id}/state").get_json()
    assert state["status"] == "results"
    assert state["results"][0]["score"] == 2
    assert state["results"][0]["place"] == 1


def test_meme_results_awards_points_to_top_two(client):
    import app as app_module
    from datetime import datetime, timedelta, timezone

    register(client, username="alice", password="secret123")
    code = create_lobby_via_api(client, round_seconds=20)
    create_meme_template()
    client.post("/logout")

    register(client, username="bob", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    register(client, username="carol", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    # backdate alice's account so the new-account bonus doesn't confound this
    # test -- it's covered separately by test_meme_new_account_bonus_applied
    alice = User.query.filter_by(username="alice").first()
    alice.created_at = datetime.now(timezone.utc) - timedelta(days=app_module.MEME_NEW_ACCOUNT_WINDOW_DAYS + 1)
    db.session.commit()

    start_lobby_via_api(client, lobby_id)
    client.post(
        f"/api/meme/lobby/{lobby_id}/submit",
        data={"photo": (io.BytesIO(b"alice meme"), "a.png")},
        content_type="multipart/form-data",
    )

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.round_started_at = datetime.now(timezone.utc) - timedelta(seconds=21)
    db.session.commit()
    client.get(f"/api/meme/lobby/{lobby_id}/state")  # round -> voting

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.voting_started_at = datetime.now(timezone.utc) - timedelta(seconds=200)
    db.session.commit()
    client.get(f"/api/meme/lobby/{lobby_id}/state")  # voting -> results, triggers award_meme_results

    alice = User.query.filter_by(username="alice").first()
    assert alice.total_score == app_module.MEME_PLACEMENT_POINTS[1]


def test_meme_results_skips_points_for_two_or_fewer_players(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice", password="secret123")
    code = create_lobby_via_api(client, round_seconds=20)
    create_meme_template()
    client.post("/logout")

    register(client, username="bob", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)
    client.post(
        f"/api/meme/lobby/{lobby_id}/submit",
        data={"photo": (io.BytesIO(b"alice meme"), "a.png")},
        content_type="multipart/form-data",
    )

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.round_started_at = datetime.now(timezone.utc) - timedelta(seconds=21)
    db.session.commit()
    client.get(f"/api/meme/lobby/{lobby_id}/state")  # round -> voting

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.voting_started_at = datetime.now(timezone.utc) - timedelta(seconds=200)
    db.session.commit()
    state = client.get(f"/api/meme/lobby/{lobby_id}/state").get_json()  # voting -> results
    assert state["status"] == "results"

    alice = User.query.filter_by(username="alice").first()
    assert alice.total_score == 0  # only 2 players -> no placement points awarded


def test_meme_new_account_bonus_applied(client):
    import app as app_module
    from datetime import datetime, timedelta, timezone

    register(client, username="alice", password="secret123")
    code = create_lobby_via_api(client, round_seconds=20)
    create_meme_template()
    client.post("/logout")

    register(client, username="bob", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    register(client, username="carol", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)
    client.post(
        f"/api/meme/lobby/{lobby_id}/submit",
        data={"photo": (io.BytesIO(b"alice meme"), "a.png")},
        content_type="multipart/form-data",
    )

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.round_started_at = datetime.now(timezone.utc) - timedelta(seconds=21)
    db.session.commit()
    client.get(f"/api/meme/lobby/{lobby_id}/state")  # round -> voting

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.voting_started_at = datetime.now(timezone.utc) - timedelta(seconds=200)
    db.session.commit()
    client.get(f"/api/meme/lobby/{lobby_id}/state")  # voting -> results

    alice = User.query.filter_by(username="alice").first()
    assert alice.total_score == app_module.MEME_PLACEMENT_POINTS[1] + app_module.MEME_NEW_ACCOUNT_BONUS


def test_meme_rematch_flow(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice", password="secret123")
    code = create_lobby_via_api(client, round_seconds=20)
    create_meme_template()
    client.post("/logout")

    register(client, username="bob", password="secret123")
    join_lobby_via_api(client, code)
    client.post("/logout")

    register(client, username="carol", password="secret123")
    join_lobby_via_api(client, code)

    client.post("/login", data={"username": "alice", "password": "secret123"})
    with flask_app.app_context():
        lobby_id = MemeLobby.query.filter_by(code=code).first().id
    start_lobby_via_api(client, lobby_id)

    lobby = db.session.get(MemeLobby, lobby_id)
    lobby.round_started_at = datetime.now(timezone.utc) - timedelta(seconds=21)
    lobby.voting_started_at = datetime.now(timezone.utc) - timedelta(seconds=200)
    db.session.commit()
    client.get(f"/api/meme/lobby/{lobby_id}/state")

    rematch_response = client.post(f"/api/meme/lobby/{lobby_id}/rematch-vote", json={"want": True})
    rematch_data = rematch_response.get_json()
    assert rematch_data["ok"] is True
    assert rematch_data["wants_rematch_count"] == 1

    start_response = client.post(f"/api/meme/lobby/{lobby_id}/rematch-start")
    assert start_response.get_json()["ok"] is True

    lobby = db.session.get(MemeLobby, lobby_id)
    assert lobby.round_number == 2
    assert lobby.status == "round"


def test_admin_can_upload_and_delete_meme_template(client):
    register(client, username="boss")
    make_admin("boss")

    response = client.post(
        "/admin/meme-templates",
        data={"templates": (io.BytesIO(b"fake template bytes"), "tpl.png")},
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert response.status_code == 200
    with flask_app.app_context():
        assert MemeTemplate.query.count() == 1
        template_id = MemeTemplate.query.first().id

    delete_response = client.post(f"/admin/meme-templates/{template_id}/delete", follow_redirects=True)
    assert delete_response.status_code == 200
    with flask_app.app_context():
        assert MemeTemplate.query.count() == 0


def test_admin_meme_template_upload_requires_admin(client):
    register(client, username="regular")
    response = client.post(
        "/admin/meme-templates",
        data={"templates": (io.BytesIO(b"fake template bytes"), "tpl.png")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 403


def test_r2_cors_left_alone_when_already_configured(client, monkeypatch):
    import app as app_module
    from unittest.mock import MagicMock

    fake_r2 = MagicMock()
    fake_r2.get_bucket_cors.return_value = {"CORSRules": [{"AllowedOrigins": ["*"]}]}
    monkeypatch.setattr(app_module, "USE_R2", True)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)
    monkeypatch.setattr(app_module, "R2_BUCKET_NAME", "test-bucket")

    app_module.ensure_r2_cors_configured()
    fake_r2.put_bucket_cors.assert_not_called()


def test_r2_cors_applied_when_missing(client, monkeypatch):
    import app as app_module
    from unittest.mock import MagicMock
    from botocore.exceptions import ClientError

    fake_r2 = MagicMock()
    fake_r2.get_bucket_cors.side_effect = ClientError(
        {"Error": {"Code": "NoSuchCORSConfiguration"}}, "GetBucketCors"
    )
    monkeypatch.setattr(app_module, "USE_R2", True)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)
    monkeypatch.setattr(app_module, "R2_BUCKET_NAME", "test-bucket")

    app_module.ensure_r2_cors_configured()

    fake_r2.put_bucket_cors.assert_called_once()
    call_kwargs = fake_r2.put_bucket_cors.call_args.kwargs
    assert call_kwargs["Bucket"] == "test-bucket"
    rule = call_kwargs["CORSConfiguration"]["CORSRules"][0]
    assert rule["AllowedOrigins"] == ["*"]
    assert "GET" in rule["AllowedMethods"]


def test_r2_cors_skipped_when_r2_not_in_use(client, monkeypatch):
    import app as app_module
    from unittest.mock import MagicMock

    fake_r2 = MagicMock()
    monkeypatch.setattr(app_module, "USE_R2", False)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)

    app_module.ensure_r2_cors_configured()
    fake_r2.get_bucket_cors.assert_not_called()


def create_studio_project(client, name="Testspiel"):
    return client.post("/studio/create", data={"name": name}, follow_redirects=True)


def test_studio_requires_login(client):
    response = client.get("/studio", follow_redirects=False)
    assert response.status_code == 302
    assert "/login" in response.headers["Location"]


def test_studio_create_project_adds_default_block(client):
    register(client)
    create_studio_project(client)

    project = StudioProject.query.filter_by(name="Testspiel").first()
    assert project is not None
    assert project.published is False
    assert len(project.blocks) == 1
    assert project.blocks[0].name == "Part1"
    assert project.blocks[0].is_default is True


def test_studio_editor_forbidden_for_non_owner(client):
    register(client, username="alice")
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()

    client.post("/logout")
    register(client, username="bob")
    response = client.get(f"/studio/{project.id}")
    assert response.status_code == 403


def test_studio_api_create_block_assigns_unique_name(client):
    register(client)
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()

    res1 = client.post(f"/api/studio/{project.id}/block", json={"name": "Block"})
    res2 = client.post(f"/api/studio/{project.id}/block", json={"name": "Block"})
    assert res1.get_json()["block"]["name"] == "Block"
    assert res2.get_json()["block"]["name"] == "Block2"


def test_studio_default_block_cannot_be_renamed_or_deleted(client):
    register(client)
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()
    default_block = project.blocks[0]

    rename_res = client.post(
        f"/api/studio/{project.id}/block/{default_block.id}", json={"name": "Renamed"}
    )
    assert rename_res.status_code == 400
    assert rename_res.get_json()["error"] == "default_block_locked"

    delete_res = client.post(f"/api/studio/{project.id}/block/{default_block.id}/delete")
    assert delete_res.status_code == 400
    assert delete_res.get_json()["error"] == "default_block_locked"


def test_studio_block_name_collision_rejected(client):
    register(client)
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()
    new_block = client.post(f"/api/studio/{project.id}/block", json={"name": "Extra"}).get_json()["block"]

    res = client.post(f"/api/studio/{project.id}/block/{new_block['id']}", json={"name": "Part1"})
    assert res.status_code == 400
    assert res.get_json()["error"] == "name_taken"


def test_studio_play_page_hidden_until_published(client):
    register(client, username="alice")
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()

    client.post("/logout")
    register(client, username="bob")
    response = client.get(f"/studio/play/{project.id}")
    assert response.status_code == 404

    client.post("/logout")
    client.post("/login", data={"username": "alice", "password": "secret123"})
    client.post(f"/studio/{project.id}/publish")

    client.post("/logout")
    register(client, username="carol")
    response = client.get(f"/studio/play/{project.id}")
    assert response.status_code == 200


def test_studio_published_game_listed_on_games_page(client):
    register(client)
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()
    client.post(f"/studio/{project.id}/publish")

    response = client.get("/games")
    assert b"Testspiel" in response.data


def test_studio_award_requires_login(client):
    register(client)
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()
    client.post("/logout")

    response = client.post(f"/api/studio/{project.id}/award", json={"amount": 5})
    assert response.status_code == 401


def test_studio_award_credits_points_on_published_game(client):
    register(client, username="alice")
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()
    client.post(f"/studio/{project.id}/publish")

    client.post("/logout")
    register(client, username="bob")
    before = User.query.filter_by(username="bob").first().total_score

    response = client.post(f"/api/studio/{project.id}/award", json={"amount": 25})
    assert response.status_code == 200
    after = User.query.filter_by(username="bob").first().total_score
    assert after == before + 25


def test_studio_award_rejects_absurd_amount(client):
    register(client)
    create_studio_project(client)
    project = StudioProject.query.filter_by(name="Testspiel").first()
    client.post(f"/studio/{project.id}/publish")

    response = client.post(f"/api/studio/{project.id}/award", json={"amount": 999999})
    assert response.status_code == 400


