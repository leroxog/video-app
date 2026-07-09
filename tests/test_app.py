import io
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from app import app as flask_app, db
from models import User, Video, Sound


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

    upload_dir = tempfile.mkdtemp()
    flask_app.config["UPLOAD_FOLDER"] = upload_dir
    profile_pic_dir = tempfile.mkdtemp()
    flask_app.config["PROFILE_PIC_FOLDER"] = profile_pic_dir

    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()

    shutil.rmtree(upload_dir, ignore_errors=True)
    shutil.rmtree(profile_pic_dir, ignore_errors=True)


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
    response = client.get("/?q=gigas/place")
    assert b"gigas/place" in response.data
    assert b"place-label" in response.data


def test_search_easter_egg_shows_tictactoe_label(client):
    response = client.get("/?q=gigas/tic.tac.toe")
    assert "gigas/tic.tac.toe".encode() in response.data
    assert b"place-label" in response.data


def test_tictactoe_page_accessible_without_login(client):
    response = client.get("/tictactoe")
    assert response.status_code == 200
    assert b"tictactoe-board" in response.data


def test_search_easter_egg_shows_fruitmerge_label(client):
    response = client.get("/?q=gigas/fruit.merge")
    assert "gigas/fruit.merge".encode() in response.data
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
            "gigas/place",
            "gigas/tic.tac.toe",
            "gigas/fruit.merge",
            "gigas/gravity.run",
            "gigas/knife.hit",
        ]
    )


def test_search_easter_egg_shows_gravityrun_label(client):
    response = client.get("/?q=gigas/gravity.run")
    assert "gigas/gravity.run".encode() in response.data
    assert b"place-label" in response.data


def test_gravityrun_page_accessible_without_login(client):
    response = client.get("/gravityrun")
    assert response.status_code == 200
    assert b"runCanvas" in response.data
    assert b"mp-lobby-options" in response.data


def test_search_easter_egg_shows_knifehit_label(client):
    response = client.get("/?q=gigas/knife.hit")
    assert "gigas/knife.hit".encode() in response.data
    assert b"place-label" in response.data


def test_knifehit_page_accessible_without_login(client):
    response = client.get("/knifehit")
    assert response.status_code == 200
    assert b"knifeCanvas" in response.data
    assert b"mp-lobby-options" in response.data


def test_search_easter_egg_shows_flappybird_label(client):
    response = client.get("/?q=gigas/flappy.bird")
    assert "gigas/flappy.bird".encode() in response.data
    assert b"place-label" in response.data


def test_flappybird_page_accessible_without_login(client):
    response = client.get("/flappybird")
    assert response.status_code == 200
    assert b"flappyCanvas" in response.data


def test_search_easter_egg_shows_blockbuster_label(client):
    response = client.get("/?q=gigas/block.buster")
    assert "gigas/block.buster".encode() in response.data
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
    assert "gigas/fruit.merge".encode() in response.data
    assert b"place-label" in response.data


def test_fuzzy_search_matches_typo_in_game_term(client):
    response = client.get("/?q=fruitmerge")
    assert "gigas/fruit.merge".encode() in response.data


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
    response = client.post("/api/redeem-code", json={"code": "GIGASFREE300FOREVERYONE"})
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
