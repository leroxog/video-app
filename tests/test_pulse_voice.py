"""Satürn: voice messages in chats (2026-10-31): the page records with the microphone and sends the sound as a private file of the kind "audio", which only the people of the chat may open and which
plays in the chat (the new line above the keyboard with the "+", the sticker button and the microphone is checked in test_yipi_frontend.py)."""
import io
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")


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


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def webm(size=3000):
    return b"\x1a\x45\xdf\xa3" + b"\x9f\x42\x86\x81\x01" + b"\x00" * size


def voice(c, data, name="Sprachnachricht.webm", voice_flag="1"):
    fields = {"file": (io.BytesIO(data), name)}
    if voice_flag is not None:
        fields["voice"] = voice_flag
    return c.post("/api/yipi/attachments", data=fields, content_type="multipart/form-data")


def test_a_recorded_voice_message_is_stored_as_a_private_audio_file_and_plays_for_the_other_person(client):
    mia, tom, zoe = person("mia"), person("tom"), person("zoe")
    mia.post("/api/yipi/users/tom/follow", json={})
    tom.post("/api/yipi/users/mia/follow", json={})
    made = voice(mia, webm())
    assert made.status_code == 201, made.get_json()
    file = made.get_json()["file"]
    assert file["kind"] == "audio" and file["name"].endswith(".webm")
    sent = mia.post("/api/yipi/messages/tom", json={"fileId": file["id"]})
    assert sent.status_code == 201 and sent.get_json()["message"]["file"]["kind"] == "audio"
    thread = tom.get("/api/yipi/messages/mia").get_json()["messages"]
    assert thread[-1]["file"]["kind"] == "audio" and thread[-1]["file"]["url"].startswith("/yipi-files/")
    played = tom.get(thread[-1]["file"]["url"])
    assert played.status_code == 200 and played.mimetype == "audio/webm" and played.headers["Content-Disposition"] == "inline" and played.headers["Accept-Ranges"] == "bytes"
    half = tom.get(thread[-1]["file"]["url"], headers={"Range": "bytes=0-9"})
    assert half.status_code == 206 and len(half.data) == 10, "a long voice message can be played from the middle"
    assert zoe.get(thread[-1]["file"]["url"]).status_code == 404, "nobody else may listen"
    assert [row["last"]["text"] for row in tom.get("/api/yipi/messages").get_json()["items"]] == ["Sprachnachricht"]


def test_only_real_sound_in_a_small_file_is_taken_as_a_voice_message(client):
    mia = person("mia")
    assert voice(mia, b"hello, this is no sound at all").status_code == 415 and voice(mia, b"hello, this is no sound at all").get_json()["error"] == "bad_audio"
    assert voice(mia, b"<html><script>alert(1)</script></html>", "x.webm").status_code == 415
    assert voice(mia, webm(yipi.MAX_VOICE_BYTES)).status_code == 413, "four million bytes at most (three minutes of speech)"
    assert voice(mia, b"OggS" + b"\x00" * 200, "v.ogg").get_json()["file"]["kind"] == "audio"
    assert voice(mia, b"RIFF\x00\x00\x00\x00WAVEfmt " + b"\x00" * 50, "v.wav").get_json()["file"]["kind"] == "audio"
    assert voice(mia, webm(), voice_flag=None).status_code != 201 or voice(mia, webm(), voice_flag=None).get_json()["file"]["kind"] != "audio", "without the voice mark it is not stored as sound"
    assert flask_app.test_client().post("/api/yipi/attachments", data={"file": (io.BytesIO(webm()), "a.webm"), "voice": "1"}, content_type="multipart/form-data").status_code == 401


def test_the_page_records_and_plays_voice_messages_and_dictates_into_the_other_fields():
    composer = open(os.path.join(JS_DIR, "yipi-composer.js"), encoding="utf-8").read()
    chats = open(os.path.join(JS_DIR, "yipi-chats.js"), encoding="utf-8").read()
    for word in ("MediaRecorder", "getUserMedia", "SpeechRecognition", "cb-rec", "Aufnahme verwerfen"):
        assert word in composer, word
    assert 'Api.attach(file, null, { voice: "1" })' in chats and 'file.kind === "audio"' in chats and 'h("audio"' in chats
    for name in ("yipi-components.js", "yipi-nex.js", "yipi-chats.js"):
        assert "Y.composerPanel(" in open(os.path.join(JS_DIR, name), encoding="utf-8").read(), f"{name}: every place to write has the panel of the +"
    assert "Y.composerTools.dictation(" in open(os.path.join(JS_DIR, "yipi-components.js"), encoding="utf-8").read()
    assert "Y.composerTools.dictation(" in open(os.path.join(JS_DIR, "yipi-nex.js"), encoding="utf-8").read()
