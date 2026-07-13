import io
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from app import app as flask_app, db
from models import User, Video, Sound, Conversation, Message, VideoReport


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
        data={"username": username, "password": password},
        follow_redirects=True,
    )


def make_admin(username):
    user = User.query.filter_by(username=username).first()
    user.is_admin = True
    db.session.commit()


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


def test_upload_page_has_sound_picker(client):
    register(client)
    response = client.get("/upload")
    assert b"soundToggleBtn" in response.data
    assert b"soundPicker" in response.data


def test_upload_page_has_own_sound_upload_notice(client):
    register(client)
    response = client.get("/upload")
    assert b"ownSoundInput" in response.data
    assert "öffentlichen Sound-Bibliothek".encode() in response.data


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


def test_fruitmerge_page_has_record_button(client):
    response = client.get("/fruitmerge")
    assert b"recordBtn" in response.data
    assert "Aufnehmen".encode() in response.data


def test_index_shows_upload_bonus_banner(client):
    response = client.get("/")
    assert b"upload-bonus-banner" in response.data
    assert "+100 Punkte".encode() in response.data


def test_upload_awards_bonus_points(client):
    register(client)
    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 0

    data = {
        "title": "Bonus Testvideo",
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
    }
    client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 100


def test_duplicate_video_upload_is_rejected(client):
    register(client)
    data = {
        "title": "Original",
        "video": (io.BytesIO(b"identical video bytes"), "clip.mp4"),
    }
    client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 100

    data2 = {
        "title": "Duplicate",
        "video": (io.BytesIO(b"identical video bytes"), "clip2.mp4"),
    }
    response = client.post("/upload", data=data2, content_type="multipart/form-data", follow_redirects=True)
    assert b"bereits hochgeladen" in response.data

    with flask_app.app_context():
        user = User.query.filter_by(username="alice").first()
        assert user.total_score == 100
        assert Video.query.count() == 1


def test_like_awards_and_removes_bonus_points(client):
    register(client, username="alice", password="secret123")
    data = {
        "title": "Likeable Video",
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
    }
    client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)
    client.post("/logout")

    register(client, username="bob", password="secret123")
    with flask_app.app_context():
        video = Video.query.filter_by(title="Likeable Video").first()
        video_id = video.id

    client.post(f"/video/{video_id}/like")
    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        assert alice.total_score == 160

    client.post(f"/video/{video_id}/like")
    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        assert alice.total_score == 100


def test_upload_and_watch_video(client):
    register(client)
    data = {
        "title": "Mein Testvideo",
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
    }
    response = client.post(
        "/upload",
        data=data,
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Mein Testvideo".encode() in response.data

    response = client.get("/")
    assert "Mein Testvideo".encode() in response.data


def test_upload_with_description_is_shown_on_watch_page(client):
    register(client)
    data = {
        "title": "Video mit Beschreibung",
        "description": "Das ist eine Testbeschreibung.",
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
    }
    response = client.post(
        "/upload",
        data=data,
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Das ist eine Testbeschreibung.".encode() in response.data


def test_upload_without_description_works(client):
    register(client)
    data = {
        "title": "Video ohne Beschreibung",
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
    }
    response = client.post(
        "/upload",
        data=data,
        content_type="multipart/form-data",
        follow_redirects=True,
    )
    assert response.status_code == 200
    assert "Video ohne Beschreibung".encode() in response.data


def test_upload_rejects_bad_extension(client):
    register(client)
    data = {
        "title": "Boeses Format",
        "video": (io.BytesIO(b"not a video"), "clip.exe"),
    }
    response = client.post(
        "/upload",
        data=data,
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


def test_header_search_bar_present_on_watch_page(client):
    register(client)
    data = {
        "title": "Header Test",
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
    }
    client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)
    response = client.get("/")
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


def test_fuzzy_search_matches_game_without_exact_term(client):
    response = client.get("/?q=fruit merge")
    assert "timeskip/fruit.merge".encode() in response.data
    assert b"place-label" in response.data


def test_fuzzy_search_matches_typo_in_game_term(client):
    response = client.get("/?q=fruitmerge")
    assert "timeskip/fruit.merge".encode() in response.data


def test_search_does_not_treat_generic_word_as_game(client):
    register(client)
    upload_video(client, title="My Running Blog")
    response = client.get("/?q=run")
    assert b"place-label-sub" not in response.data
    assert b"My Running Blog" in response.data


def test_fuzzy_search_finds_similar_sounding_video_title(client):
    register(client)
    upload_video(client, title="Katzenvideo vom Urlaub")
    response = client.get("/?q=katzen")
    assert "Katzenvideo vom Urlaub".encode() in response.data


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


def upload_video(client, title="Testvideo", description="", orientation="landscape"):
    data = {
        "title": title,
        "description": description,
        "orientation": orientation,
        "video": (io.BytesIO(f"fake video bytes for {title}".encode()), "clip.mp4"),
    }
    return client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)


def test_like_toggle(client):
    register(client)
    upload_video(client, title="Like Test")
    response = client.get("/")
    assert response.status_code == 200

    video_id = 1
    response = client.post(f"/video/{video_id}/like", follow_redirects=True)
    assert response.status_code == 200
    assert b"Geliked" in response.data
    assert b"(1)" in response.data

    response = client.post(f"/video/{video_id}/like", follow_redirects=True)
    assert b"Geliked" not in response.data
    assert b"(0)" in response.data


def test_like_requires_login(client):
    register(client)
    upload_video(client, title="Like Login Test")
    client.post("/logout")
    response = client.post("/video/1/like", follow_redirects=True)
    assert b"Login" in response.data


def test_download_link_present_on_watch_page(client):
    register(client)
    upload_video(client, title="Download Test")
    response = client.get("/video/1")
    assert b"download" in response.data
    assert b"Herunterladen" in response.data


def test_profile_page_shows_username_and_videos(client):
    register(client, username="bob")
    upload_video(client, title="Bobs Video")
    response = client.get("/user/bob")
    assert response.status_code == 200
    assert b"bob" in response.data
    assert b"Bobs Video" in response.data


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
    data = {
        "title": "Leaderboard Clip",
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
    }
    client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)
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
    assert data["total_score"] == 42

    response = client.post("/api/score", json={"game": "gravity.run", "score": 8})
    assert response.get_json()["total_score"] == 50


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


def test_cleanup_duplicate_videos_requires_admin(client):
    register(client, username="regular")
    response = client.post("/admin/cleanup-duplicate-videos?dry_run=1")
    assert response.status_code == 403


def test_cleanup_duplicate_videos_dry_run_makes_no_changes(client):
    register(client, username="alice")
    upload_video(client, title="Original")
    client.post("/logout")

    register(client, username="bob")
    make_admin("bob")

    with flask_app.app_context():
        original = Video.query.filter_by(title="Original").first()
        dup = Video(
            title="Duplicate",
            filename=original.filename,
            content_hash=None,
            user_id=original.user_id,
        )
        db.session.add(dup)
        db.session.commit()

    response = client.post("/admin/cleanup-duplicate-videos?dry_run=1")
    assert response.status_code == 200
    data = response.get_json()
    assert data["dry_run"] is True
    assert data["duplicate_groups"] == 1
    assert data["total_deducted"] == 100

    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        assert alice.total_score == 100
        dup_video = Video.query.filter_by(title="Duplicate").first()
        assert dup_video.content_hash is None
        assert dup_video.duplicate_penalty_applied is False


def test_cleanup_duplicate_videos_reports_cumulative_deductions(client):
    register(client, username="alice")
    upload_video(client, title="Original")
    client.post("/logout")

    register(client, username="bob")
    make_admin("bob")

    with flask_app.app_context():
        original = Video.query.filter_by(title="Original").first()
        for i in range(3):
            db.session.add(Video(
                title=f"Duplicate {i}",
                filename=original.filename,
                content_hash=None,
                user_id=original.user_id,
            ))
        db.session.commit()
        alice = User.query.filter_by(username="alice").first()
        alice.total_score = 3000
        db.session.commit()

    response = client.post("/admin/cleanup-duplicate-videos?dry_run=1")
    data = response.get_json()
    assert data["total_deducted"] == 1800
    befores = [p["total_score_before"] for p in data["penalties"]]
    afters = [p["total_score_after"] for p in data["penalties"]]
    assert befores == [3000, 2400, 1800]
    assert afters == [2400, 1800, 1200]

    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        assert alice.total_score == 3000

    real_response = client.post("/admin/cleanup-duplicate-videos?dry_run=0")
    real_data = real_response.get_json()
    assert real_data["total_deducted"] == 1800

    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        assert alice.total_score == 1200


def test_cleanup_duplicate_videos_real_run_deducts_points(client):
    register(client, username="alice")
    upload_video(client, title="Original")
    client.post("/logout")

    register(client, username="bob")
    make_admin("bob")

    with flask_app.app_context():
        original = Video.query.filter_by(title="Original").first()
        dup = Video(
            title="Duplicate",
            filename=original.filename,
            content_hash=None,
            user_id=original.user_id,
        )
        db.session.add(dup)
        db.session.commit()

    response = client.post("/admin/cleanup-duplicate-videos?dry_run=0")
    data = response.get_json()
    assert data["total_deducted"] == 100

    with flask_app.app_context():
        alice = User.query.filter_by(username="alice").first()
        assert alice.total_score == 0

    second_response = client.post("/admin/cleanup-duplicate-videos?dry_run=0")
    second_data = second_response.get_json()
    assert second_data["total_deducted"] == 0
    assert second_data["penalties"] == []


def test_admin_can_delete_any_video(client):
    register(client, username="owner")
    upload_video(client, title="Owned Video")
    client.post("/logout")

    register(client, username="boss")
    make_admin("boss")

    response = client.post("/video/1/delete", follow_redirects=True)
    assert response.status_code == 200
    assert b"Owned Video" not in response.data


def test_report_video_requires_login(client):
    register(client, username="owner")
    upload_video(client, title="Video")
    client.post("/logout")

    response = client.post("/api/video/1/report")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "not_logged_in"


def test_report_video_success(client):
    register(client, username="owner")
    upload_video(client, title="Video")
    client.post("/logout")

    register(client, username="reporter")
    response = client.post("/api/video/1/report")
    data = response.get_json()
    assert data["ok"] is True

    reports = VideoReport.query.filter_by(video_id=1).all()
    assert len(reports) == 1
    assert reports[0].reporter.username == "reporter"


def test_report_video_twice_by_same_user_fails(client):
    register(client, username="owner")
    upload_video(client, title="Video")
    client.post("/logout")

    register(client, username="reporter")
    client.post("/api/video/1/report")
    response = client.post("/api/video/1/report")
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "already_reported"


def test_admin_sees_reported_videos(client):
    register(client, username="owner")
    upload_video(client, title="Reported Video")
    client.post("/logout")

    register(client, username="reporter")
    client.post("/api/video/1/report")
    client.post("/logout")

    register(client, username="boss")
    make_admin("boss")
    response = client.get("/admin")
    assert b"Reported Video" in response.data
    assert b"reporter" in response.data


def test_admin_can_dismiss_report(client):
    register(client, username="owner")
    upload_video(client, title="Video")
    client.post("/logout")

    register(client, username="reporter")
    client.post("/api/video/1/report")
    client.post("/logout")

    register(client, username="boss")
    make_admin("boss")
    report = VideoReport.query.first()
    response = client.post(f"/admin/reports/{report.id}/dismiss", follow_redirects=True)
    assert response.status_code == 200
    assert VideoReport.query.count() == 0
    # dismissing a report does not delete the video itself
    assert Video.query.count() == 1


def test_regular_user_still_cannot_delete_others_video(client):
    register(client, username="owner")
    upload_video(client, title="Protected Video")
    client.post("/logout")

    register(client, username="stranger")
    response = client.post("/video/1/delete")
    assert response.status_code == 403


def test_index_shows_only_landscape_videos_by_default(client):
    register(client)
    upload_video(client, title="Landscape Video", orientation="landscape")
    upload_video(client, title="Portrait Video", orientation="portrait")

    response = client.get("/")
    assert b"Landscape Video" in response.data
    assert b"Portrait Video" not in response.data


def test_search_still_finds_portrait_videos(client):
    register(client)
    upload_video(client, title="Portrait Video", orientation="portrait")

    response = client.get("/?q=Portrait")
    assert b"Portrait Video" in response.data


def test_shorts_page_shows_only_portrait_videos(client):
    register(client)
    upload_video(client, title="Landscape Video", orientation="landscape")
    upload_video(client, title="Portrait Video", orientation="portrait")

    response = client.get("/shorts")
    assert response.status_code == 200
    assert b"Portrait Video" in response.data
    assert b"Landscape Video" not in response.data


def test_shorts_feed_shows_most_liked_video_first(client):
    register(client, username="alice")
    upload_video(client, title="Popular Clip", orientation="portrait")
    upload_video(client, title="Unpopular Clip", orientation="portrait")
    client.post("/logout")

    register(client, username="bob")
    with flask_app.app_context():
        popular = Video.query.filter_by(title="Popular Clip").first()
        video_id = popular.id
    client.post(f"/video/{video_id}/like")

    response = client.get("/shorts")
    data = response.data
    assert data.index(b"Popular Clip") < data.index(b"Unpopular Clip")


def test_homepage_shows_redeem_login_button_for_guest(client):
    response = client.get("/")
    assert b"redeem-login-btn" in response.data
    assert b'href="/register"' in response.data


def test_shorts_page_empty_state(client):
    response = client.get("/shorts")
    assert response.status_code == 200
    assert b"Noch keine Hochformat-Videos" in response.data


def test_api_like_video_toggle(client):
    register(client)
    upload_video(client, title="Like API Test")

    response = client.post("/video/1/like".replace("video/1", "api/video/1"))
    assert response.status_code == 200
    data = response.get_json()
    assert data == {"ok": True, "liked": True, "like_count": 1}

    response = client.post("/api/video/1/like")
    assert response.get_json() == {"ok": True, "liked": False, "like_count": 0}


def test_api_like_video_requires_login(client):
    response = client.post("/api/video/1/like")
    assert response.status_code == 401


def test_api_my_stats_requires_login(client):
    response = client.get("/api/my-stats")
    assert response.status_code == 401


def test_api_my_stats_reports_likes_and_followers(client):
    register(client, username="alice")
    upload_video(client, title="Stats Video")
    client.post("/logout")

    register(client, username="bob")
    client.post("/video/1/like")
    client.post("/user/alice/subscribe")
    client.post("/logout")

    register(client, username="carol")
    client.post("/video/1/like")
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


def test_r2_cleanup_deletes_oldest_videos_until_low_water_mark(client, monkeypatch):
    import app as app_module
    from datetime import datetime, timedelta, timezone
    from unittest.mock import MagicMock

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    base = datetime.now(timezone.utc)
    videos = []
    for i in range(4):
        video = Video(
            title=f"video{i}",
            filename=f"video{i}.mp4",
            content_hash=f"hash{i}",
            user_id=user.id,
            created_at=base + timedelta(minutes=i),
        )
        db.session.add(video)
        db.session.commit()
        videos.append(video)

    # Each of the 4 videos is 3GB -> total 12GB, over the 9GB high-water mark.
    sizes = {f"uploads/video{i}.mp4": 3 * 1024 ** 3 for i in range(4)}
    fake_r2 = MagicMock()
    fake_r2.list_objects_v2.return_value = {
        "Contents": [{"Key": key, "Size": size} for key, size in sizes.items()],
        "IsTruncated": False,
    }

    monkeypatch.setattr(app_module, "USE_R2", True)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)
    monkeypatch.setattr(app_module, "R2_BUCKET_NAME", "test-bucket")

    with flask_app.app_context():
        app_module.cleanup_oldest_videos_if_over_quota()

    # 12GB -> delete video0 (9GB left, still >7GB) -> delete video1 (6GB left, <=7GB) -> stop
    remaining_titles = {v.title for v in Video.query.all()}
    assert remaining_titles == {"video2", "video3"}


def test_r2_cleanup_never_deletes_just_uploaded_video(client, monkeypatch):
    import app as app_module
    from datetime import datetime, timedelta, timezone
    from unittest.mock import MagicMock

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    base = datetime.now(timezone.utc)
    old_video = Video(
        title="old", filename="old.mp4", content_hash="old-hash",
        user_id=user.id, created_at=base,
    )
    new_video = Video(
        title="new", filename="new.mp4", content_hash="new-hash",
        user_id=user.id, created_at=base + timedelta(minutes=1),
    )
    db.session.add_all([old_video, new_video])
    db.session.commit()

    # Both videos are 8GB each -> 16GB total, well over quota, but even
    # deleting "old" alone only gets to 8GB (still above 7GB) so a naive
    # loop would also delete "new" -- keep_video_id must prevent that.
    sizes = {"uploads/old.mp4": 8 * 1024 ** 3, "uploads/new.mp4": 8 * 1024 ** 3}
    fake_r2 = MagicMock()
    fake_r2.list_objects_v2.return_value = {
        "Contents": [{"Key": key, "Size": size} for key, size in sizes.items()],
        "IsTruncated": False,
    }

    monkeypatch.setattr(app_module, "USE_R2", True)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)
    monkeypatch.setattr(app_module, "R2_BUCKET_NAME", "test-bucket")

    with flask_app.app_context():
        app_module.cleanup_oldest_videos_if_over_quota(keep_video_id=new_video.id)

    remaining_titles = {v.title for v in Video.query.all()}
    assert remaining_titles == {"new"}


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


def test_webm_video_shows_ipad_safari_warning(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    video = Video(title="old webm clip", filename="abc.webm", content_hash="webmhash", user_id=user.id)
    db.session.add(video)
    db.session.commit()

    response = client.get(f"/video/{video.id}")
    assert b"iPhone/iPad" in response.data
    assert b'type="video/webm"' in response.data


def test_mp4_video_has_correct_source_type_and_no_warning(client):
    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    video = Video(title="normal clip", filename="abc.mp4", content_hash="mp4hash", user_id=user.id)
    db.session.add(video)
    db.session.commit()

    response = client.get(f"/video/{video.id}")
    assert b'type="video/mp4"' in response.data
    assert b"iPhone/iPad" not in response.data


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


def test_streak_continues_on_consecutive_day_and_resets_after_gap(client):
    import app as app_module
    from datetime import date, timedelta

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    yesterday = date.today() - timedelta(days=1)
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
    two_days_ago = date.today() - timedelta(days=2)
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
    from datetime import date

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 2
    user.best_streak = 2
    user.last_streak_date = date.today()
    db.session.commit()

    response = client.get("/user/alice")
    assert b"Tage Streak" in response.data
    assert b"badgeModalOpenBtn" in response.data


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


def test_share_video_creates_message_with_shared_video(client):
    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    video = Video(title="cool clip", filename="clip.mp4", content_hash="clip-hash", user_id=alice.id)
    db.session.add(video)
    db.session.commit()
    client.post("/logout")

    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    response = client.post(f"/api/videos/{video.id}/share", json={"conversation_id": conv_id})
    assert response.get_json()["ok"] is True

    messages_data = client.get(f"/api/messages/{conv_id}").get_json()["messages"]
    assert messages_data[0]["shared_video"]["title"] == "cool clip"


def test_upload_without_ffmpeg_keeps_original_format(client, monkeypatch):
    import app as app_module
    monkeypatch.setattr(app_module, "FFMPEG_PATH", None)

    register(client, username="alice")
    data = {
        "title": "webm clip",
        "description": "",
        "orientation": "landscape",
        "video": (io.BytesIO(b"fake webm bytes"), "clip.webm"),
    }
    client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)

    video = Video.query.filter_by(title="webm clip").first()
    assert video is not None
    assert video.filename.endswith(".webm")


def test_upload_transcodes_to_mp4_when_ffmpeg_available(client, monkeypatch, tmp_path):
    import app as app_module

    fake_output = tmp_path / "fake_converted.mp4"
    fake_output.write_bytes(b"fake transcoded mp4 bytes")

    monkeypatch.setattr(app_module, "FFMPEG_PATH", "/usr/bin/ffmpeg")
    monkeypatch.setattr(app_module, "transcode_to_mp4", lambda input_path: str(fake_output))

    register(client, username="alice")
    data = {
        "title": "recorded clip",
        "description": "",
        "orientation": "landscape",
        "video": (io.BytesIO(b"fake webm bytes"), "clip.webm"),
    }
    client.post("/upload", data=data, content_type="multipart/form-data", follow_redirects=True)

    video = Video.query.filter_by(title="recorded clip").first()
    assert video is not None
    assert video.filename.endswith(".mp4")


def test_transcode_migration_dry_run_does_not_modify_anything(client, monkeypatch, tmp_path):
    import app as app_module

    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    video = Video(title="legacy webm", filename="legacy.webm", content_hash="legacyhash", user_id=alice.id)
    db.session.add(video)
    db.session.commit()

    fake_output = tmp_path / "fake_converted.mp4"
    fake_output.write_bytes(b"fake transcoded mp4 bytes")

    monkeypatch.setattr(app_module, "FFMPEG_PATH", "/usr/bin/ffmpeg")
    monkeypatch.setattr(app_module, "transcode_to_mp4", lambda input_path: str(fake_output))
    monkeypatch.setattr(app_module, "fetch_video_bytes", lambda v: b"old webm bytes")

    report = app_module.run_transcode_migration(dry_run=True)

    assert report["ok"] is True
    assert report["results"][0]["status"] == "would_convert"

    video = Video.query.filter_by(id=video.id).first()
    assert video.filename == "legacy.webm"  # unchanged in dry run


def test_transcode_migration_limit_processes_fewer_videos_per_call(client, monkeypatch, tmp_path):
    import app as app_module

    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    for i in range(3):
        db.session.add(Video(title=f"legacy {i}", filename=f"legacy{i}.webm", content_hash=f"hash{i}", user_id=alice.id))
    db.session.commit()

    fake_output = tmp_path / "fake_converted.mp4"
    fake_output.write_bytes(b"fake transcoded mp4 bytes")

    monkeypatch.setattr(app_module, "FFMPEG_PATH", "/usr/bin/ffmpeg")
    monkeypatch.setattr(app_module, "transcode_to_mp4", lambda input_path: str(fake_output))
    monkeypatch.setattr(app_module, "fetch_video_bytes", lambda v: b"old webm bytes")

    report = app_module.run_transcode_migration(dry_run=True, limit=1)
    assert len(report["results"]) == 1


def test_transcode_migration_real_run_updates_filename(client, monkeypatch, tmp_path):
    import app as app_module

    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    video = Video(title="legacy webm", filename="legacy.webm", content_hash="legacyhash", user_id=alice.id)
    db.session.add(video)
    db.session.commit()
    video_id = video.id

    fake_output = tmp_path / "fake_converted.mp4"
    fake_output.write_bytes(b"fake transcoded mp4 bytes")

    monkeypatch.setattr(app_module, "FFMPEG_PATH", "/usr/bin/ffmpeg")
    monkeypatch.setattr(app_module, "transcode_to_mp4", lambda input_path: str(fake_output))
    monkeypatch.setattr(app_module, "fetch_video_bytes", lambda v: b"old webm bytes")
    deleted = []
    monkeypatch.setattr(app_module, "delete_media", lambda kind, filename: deleted.append(filename))

    report = app_module.run_transcode_migration(dry_run=False)

    assert report["results"][0]["status"] == "converted"
    video = Video.query.filter_by(id=video_id).first()
    assert video.filename.endswith(".mp4")
    assert deleted == ["legacy.webm"]


def test_admin_transcode_route_starts_in_background_and_reports_status(client, monkeypatch, tmp_path):
    import app as app_module
    import time

    register(client, username="alice")
    make_admin("alice")
    victim = User.query.filter_by(username="alice").first()
    video = Video(title="legacy webm", filename="legacy.webm", content_hash="legacyhash", user_id=victim.id)
    db.session.add(video)
    db.session.commit()

    fake_output = tmp_path / "fake_converted.mp4"
    fake_output.write_bytes(b"fake transcoded mp4 bytes")
    monkeypatch.setattr(app_module, "FFMPEG_PATH", "/usr/bin/ffmpeg")
    monkeypatch.setattr(app_module, "transcode_to_mp4", lambda input_path: str(fake_output))
    monkeypatch.setattr(app_module, "fetch_video_bytes", lambda v: b"old webm bytes")

    response = client.post("/admin/transcode-legacy-videos?dry_run=1")
    assert response.get_json()["ok"] is True
    assert response.get_json()["status"] == "started"

    for _ in range(50):
        status = client.get("/admin/transcode-legacy-videos/status").get_json()
        if not status["running"] and status["last_report"] is not None:
            break
        time.sleep(0.05)

    assert status["last_report"]["results"][0]["status"] == "would_convert"


def test_liked_videos_page_lists_liked_videos(client):
    register(client, username="alice")
    alice = User.query.filter_by(username="alice").first()
    video = Video(title="liked clip", filename="liked.mp4", content_hash="liked-hash", user_id=alice.id)
    db.session.add(video)
    db.session.commit()

    client.post(f"/video/{video.id}/like")
    response = client.get("/liked-videos")
    assert b"liked clip" in response.data


def test_coinflip_page_loads(client):
    register(client, username="alice")
    response = client.get("/coinflip")
    assert response.status_code == 200
    assert b"timeskip/coin.flip" in response.data


def test_coinflip_win_pays_3x_stake(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 100
    db.session.commit()

    monkeypatch.setattr(app_module.random, "random", lambda: 0.1)  # < 0.5 -> win
    response = client.post("/api/coinflip/flip", json={"stake": 10})
    data = response.get_json()
    assert data["ok"] is True
    assert data["results"] == ["win"]
    assert data["payout"] == 30  # 10 * 3x base multiplier
    assert data["total_score"] == 120  # 100 - 10 + 30


def test_coinflip_lose_forfeits_stake(client, monkeypatch):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.total_score = 100
    db.session.commit()

    monkeypatch.setattr(app_module.random, "random", lambda: 0.9)  # >= 0.5 -> lose
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


def test_coinflip_buy_worker_boosts_multiplier_to_5x(client, monkeypatch):
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
    assert data["multiplier"] == 5
    assert data["payout"] == 50  # 10 * 5x


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
    assert data["payout"] == 60  # 2 coins x 10 stake x 3x


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

    # Winning payout now includes the +0.2 rebirth bonus on top of the base 3x
    # (no worker owned yet post-rebirth, so this is base_multiplier + bonus)
    monkeypatch.setattr(app_module.random, "random", lambda: 0.1)  # win
    flip_response = client.post("/api/coinflip/flip", json={"stake": 10}).get_json()
    assert flip_response["multiplier"] == 3.2
    assert flip_response["payout"] == 32  # int(10 * 3.2)

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
