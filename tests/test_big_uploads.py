"""Satürn, 2026-11-02: files may be much bigger. A video 250 MB (it was 25), a document 100 MB (15), a photo 25 MB (5 or 8), a song of the own folder 50 MB (8), a request 300 MB (200). The page says
the same numbers as the server. The tests never build files of that size: they check the numbers and take one file that is bigger than the old limit."""
import os
import struct
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_captions  # noqa: E402
import yipi_music  # noqa: E402
from app import app as flask_app, db  # noqa: E402

MB = 1024 * 1024
PASSWORD = "correct horse battery"


def read(name):
    with open(os.path.join(ROOT, "static", "js", name), encoding="utf-8") as handle:
        return handle.read()


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.setattr(yipi_captions, "RUNNER_BOX", [lambda *args, **kwargs: None])


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


def mp4(extra, seconds=60):
    mvhd = b"mvhd" + b"\x00\x00\x00\x00" + b"\x00" * 8 + struct.pack(">II", 1000, int(seconds * 1000)) + b"\x00" * 80
    mvhd = struct.pack(">I", len(mvhd) + 4) + mvhd
    head = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + struct.pack(">I", len(mvhd) + 8) + b"moov" + mvhd
    return head + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + b"\x00" * extra


def test_the_limits_are_much_higher_than_before():
    assert yipi.MAX_VIDEO_BYTES == 250 * MB and yipi.MAX_DOCUMENT_BYTES == 100 * MB and yipi.MAX_IMAGE_BYTES == 25 * MB and yipi.MAX_FILE_IMAGE_BYTES == 25 * MB
    assert yipi_music.MAX_UPLOAD == 50_000_000
    assert flask_app.config["MAX_CONTENT_LENGTH"] >= yipi.MAX_VIDEO_BYTES + 20 * MB, "a request may carry the biggest video and the form around it"


def test_a_video_bigger_than_the_old_limit_is_taken_and_one_over_the_new_limit_is_not(client, monkeypatch):
    assert client.post("/api/yipi/signup", json={"handle": "mia", "password": PASSWORD, "adult": True}).status_code == 200
    from io import BytesIO
    big = mp4(30 * MB)                                                                   # 30 MB: refused before, fine now
    assert len(big) > 25 * MB
    ok = client.post("/api/yipi/media", data={"file": (BytesIO(big), "gross.mp4"), "width": "720", "height": "1280"}, content_type="multipart/form-data")
    assert ok.status_code == 200 and ok.get_json()["media"]["video"] is True
    monkeypatch.setattr(yipi, "MAX_VIDEO_BYTES", 3 * MB)
    over = client.post("/api/yipi/media", data={"file": (BytesIO(mp4(4 * MB)), "zu-gross.mp4")}, content_type="multipart/form-data")
    assert over.status_code == 413 and over.get_json()["error"] == "video_too_big"


def test_the_page_says_the_same_numbers_as_the_server():
    core, api, newpost, music, components = read("yipi-core.js"), read("yipi-api.js"), read("yipi-newpost.js"), read("yipi-music.js"), read("yipi-components.js")
    assert "const MAX_VIDEO_BYTES = 250 * 1024 * 1024;" in core
    assert "(höchstens 250 MB)" in api and "Die Datei ist zu groß (höchstens 100 MB, Fotos 25 MB, Videos 250 MB)." in api and "Das Foto ist zu groß (höchstens 25 MB)." in api
    assert "bis 250 MB" in newpost and "file.size > 50_000_000" in music and "höchstens 50 MB" in music
    assert "blob.size <= 25 * 1024 * 1024" in components
    for old in ("Foto ist zu groß (höchstens 5 MB)", "Videos 25 MB", "höchstens 15 MB", "Fotos 8 MB", "bis 25 MB\""):
        assert old not in api + newpost, old


def test_the_site_announces_the_bigger_files():
    import yipi_company
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    assert "2026-11-02-bigfiles" in lines and "250 MB" in lines["2026-11-02-bigfiles"][2] and len(lines["2026-11-02-bigfiles"][2]) <= 280 and lines["2026-11-02-bigfiles"][2].count("#") <= 2
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)
