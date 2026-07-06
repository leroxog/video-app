import io
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from app import app as flask_app, db


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
        assert b"home-link" in response.data


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


def test_place_requires_login(client):
    response = client.get("/place", follow_redirects=True)
    assert b"Login" in response.data


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


def upload_video(client, title="Testvideo", description=""):
    data = {
        "title": title,
        "description": description,
        "video": (io.BytesIO(b"fake video bytes"), "clip.mp4"),
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
    assert b"Abonniert" in response.data

    response = client.post("/user/bob/subscribe", follow_redirects=True)
    assert b"Abonnieren" in response.data


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
