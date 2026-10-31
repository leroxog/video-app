"""Subtitles and the spoken translation of videos (2026-10-31, yipi_captions.py and yipi-captions.js): a video that is uploaded is sent to the speech recognition in the background, the sentences
are kept once, other languages are translated once and kept, the pitch the browser measured tells women from men, and the page has the window to choose the languages. The calls to Groq are replaced
by fakes here (the real ones were tried by hand)."""
import io
import json
import os
import struct
import sys
import tempfile
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_captions  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(yipi_captions, "RUNNER_BOX", [lambda app, media_id: yipi_captions.ensure_source(media_id)])      # (in the tests the work is done at once, in the same session)
    yipi_captions._work.clear()
    yipi_captions._cool["until"] = 0.0


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


def mp4(extra=2000):
    head = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
    return head + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


def upload_video(c, **fields):
    reply = c.post("/api/yipi/media", data={"file": (io.BytesIO(mp4()), "clip.mp4"), **fields}, content_type="multipart/form-data")
    assert reply.status_code == 200, reply.get_json()
    return reply.get_json()["media"]["id"]


RAW = [
    {"start": 0.0, "end": 2.0, "text": " Hallo, ich bin Anna.", "no_speech_prob": 0.01, "avg_logprob": -0.2},
    {"start": 2.0, "end": 4.0, "text": " Und ich bin Tom.", "no_speech_prob": 0.02, "avg_logprob": -0.3},
    {"start": 4.0, "end": 5.0, "text": " Untertitel der Amara.org-Community", "no_speech_prob": 0.01, "avg_logprob": -0.2},
    {"start": 5.0, "end": 6.0, "text": " Rauschen", "no_speech_prob": 0.95, "avg_logprob": -0.2},
    {"start": 6.0, "end": 7.0, "text": " unsicher", "no_speech_prob": 0.1, "avg_logprob": -2.0},
]
PITCH = [220] * 20 + [110] * 20 + [0] * 30                     # a woman for the first two seconds, a man for the next two


@pytest.fixture
def groq(monkeypatch):
    calls = {"transcribe": 0, "translate": []}

    def fake_transcribe(data, name, content_type):
        calls["transcribe"] += 1
        calls["name"], calls["type"] = name, content_type
        return "german", RAW

    def fake_translate(texts, target, source_name):
        calls["translate"].append((target, source_name, list(texts)))
        return [f"[{target}] {text}" for text in texts]

    monkeypatch.setattr(yipi_captions, "transcribe", fake_transcribe)
    monkeypatch.setattr(yipi_captions, "translate", fake_translate)
    return calls


def get(c, media_id, lang=None):
    return c.get(f"/api/yipi/videos/{media_id}/captions" + (f"?lang={lang}" if lang else ""))


# ================================================================================================ the languages
def test_there_are_german_english_and_twenty_other_languages_and_the_page_knows_the_same_ones():
    assert len(yipi_captions.LANGUAGES) == 22 and len({code for code, _, _ in yipi_captions.LANGUAGES}) == 22
    assert [code for code, _, _ in yipi_captions.LANGUAGES][:2] == ["de", "en"]
    source = open(os.path.join(JS_DIR, "yipi-captions.js"), encoding="utf-8").read()
    for code, name, tag in yipi_captions.LANGUAGES:
        assert f'["{code}", "{name}", "{tag}"]' in source, code
        assert code in yipi_captions.ENGLISH
    assert yipi_captions.WHISPER_CODES["german"] == "de" and yipi_captions.WHISPER_CODES["ukrainian"] == "uk"


# ================================================================================================ from the upload to the subtitles
def test_a_video_of_a_post_is_transcribed_in_the_background_and_kept(client, groq):
    mia = person("mia")
    media_id = upload_video(mia, captions="1", pitch=json.dumps(PITCH))
    assert groq["transcribe"] == 1 and groq["name"] == "video.mp4" and groq["type"] == "video/mp4"
    reply = get(mia, media_id).get_json()
    assert reply["status"] == "ready" and reply["original"] == {"code": "de", "name": "Deutsch"} and reply["lang"] == "de"
    assert [(s["t"], s["g"]) for s in reply["segments"]] == [("Hallo, ich bin Anna.", "f"), ("Und ich bin Tom.", "m")], "noise, made-up credits and unsure guesses are left out; the pitch tells who speaks"
    assert reply["segments"][0]["s"] == 0.0 and reply["segments"][1]["e"] == 4.0
    again = get(mia, media_id, "orig").get_json()
    assert again["segments"] == reply["segments"] and groq["transcribe"] == 1, "once per video"


def test_a_story_or_a_video_without_the_mark_is_not_sent_anywhere(client, groq):
    mia = person("mia")
    media_id = upload_video(mia)
    assert groq["transcribe"] == 0
    assert get(mia, media_id).get_json()["status"] == "pending", "an older video is transcribed the first time somebody asks (the page asks again in a few seconds)"
    assert groq["transcribe"] == 1 and get(mia, media_id).get_json()["status"] == "ready"


def test_another_language_is_translated_once_and_kept(client, groq):
    mia, tom = person("mia"), person("tom")
    media_id = upload_video(mia, captions="1", pitch=json.dumps(PITCH))
    english = get(tom, media_id, "en").get_json()
    assert english["status"] == "ready" and english["lang"] == "en" and english["original"]["name"] == "Deutsch"
    assert [s["t"] for s in english["segments"]] == ["[en] Hallo, ich bin Anna.", "[en] Und ich bin Tom."]
    assert [s["g"] for s in english["segments"]] == ["f", "m"], "the sex of the speaker goes with the translation"
    assert [s["s"] for s in english["segments"]] == [0.0, 2.0]
    assert groq["translate"] == [("en", "German", ["Hallo, ich bin Anna.", "Und ich bin Tom."])]
    get(mia, media_id, "en")
    get(mia, media_id, "fr")
    assert [call[0] for call in groq["translate"]] == ["en", "fr"], "a language is translated once"
    assert get(mia, media_id, "de").get_json()["segments"][0]["t"] == "Hallo, ich bin Anna.", "the spoken language needs no translation"
    rows = {row.lang for row in yipi.YipiCaption.query.filter_by(media_id=media_id)}
    assert rows == {"_pitch", "de", "en", "fr"}


def test_unknown_languages_missing_videos_and_strangers_are_refused(client, groq):
    mia = person("mia")
    media_id = upload_video(mia, captions="1")
    assert get(mia, media_id, "xx").status_code == 400 and get(mia, media_id, "xx").get_json()["error"] == "bad_language"
    assert get(mia, "0" * 32).status_code == 404 and get(mia, "nothex").status_code == 404
    photo = mia.post("/api/yipi/media", data={"file": (io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 10, 10) + b"\x08\x06\x00\x00\x00" + b"\x00" * 20), "a.png")}, content_type="multipart/form-data")
    if photo.status_code == 200:
        assert get(mia, photo.get_json()["media"]["id"]).status_code == 404, "only videos have subtitles"
    assert flask_app.test_client().get(f"/api/yipi/videos/{media_id}/captions").status_code == 401


def test_a_video_without_speech_says_so_and_a_failing_service_is_tried_again_later(client, groq, monkeypatch):
    mia = person("mia")
    monkeypatch.setattr(yipi_captions, "transcribe", lambda data, name, content_type: ("english", [{"start": 0, "end": 1, "text": " Thank you.", "no_speech_prob": 0.9, "avg_logprob": -0.5}]))
    silent = upload_video(mia, captions="1")
    assert get(mia, silent).get_json()["status"] == "none"
    calls = []

    def broken(data, name, content_type):
        calls.append(1)
        raise yipi_captions.Unavailable("status 500")
    monkeypatch.setattr(yipi_captions, "transcribe", broken)
    failing = upload_video(mia, captions="1")
    assert len(calls) == 1 and get(mia, failing).get_json()["status"] == "error"
    assert get(mia, failing).get_json()["status"] == "error" and len(calls) == 1, "not asked again at once"
    entry = yipi.YipiCaption.query.filter_by(media_id=failing, lang="_error").first()
    entry.created_at = yipi.utcnow() - timedelta(seconds=yipi_captions.RETRY_AFTER + 5)
    db.session.commit()
    monkeypatch.setattr(yipi_captions, "transcribe", lambda data, name, content_type: ("german", RAW))
    assert get(mia, failing).get_json()["status"] == "pending", "after ten minutes it is tried again"
    assert get(mia, failing).get_json()["status"] == "ready", "and it works again"


def test_a_translation_that_fails_is_not_kept(client, groq, monkeypatch):
    mia = person("mia")
    media_id = upload_video(mia, captions="1")
    monkeypatch.setattr(yipi_captions, "translate", lambda texts, target, source: (_ for _ in ()).throw(yipi_captions.Unavailable("boom")))
    assert get(mia, media_id, "es").get_json()["status"] == "error"
    assert yipi.YipiCaption.query.filter_by(media_id=media_id, lang="es").first() is None
    monkeypatch.setattr(yipi_captions, "translate", lambda texts, target, source: [f"({target}) {t}" for t in texts])
    assert get(mia, media_id, "es").get_json()["segments"][0]["t"] == "(es) Hallo, ich bin Anna."


def test_without_a_key_nothing_is_sent_and_the_page_is_told(client, groq, monkeypatch):
    mia = person("mia")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    media_id = upload_video(mia, captions="1")
    assert groq["transcribe"] == 0
    assert get(mia, media_id).get_json()["status"] == "unavailable"


def test_the_requests_of_one_person_are_counted(client, groq):
    mia = person("mia")
    media_id = upload_video(mia, captions="1")
    for _ in range(yipi.LIMITS["caption"][0]):
        assert get(mia, media_id).status_code == 200
    assert get(mia, media_id).status_code == 429


# ================================================================================================ the pieces
def test_the_pitch_the_browser_sends_is_checked_and_turns_into_a_sex_per_sentence():
    assert yipi_captions.clean_pitch(json.dumps([0, 120, 130])) == [0, 120, 130]
    for bad in ("nonsense", "[]", "{}", json.dumps([10]), json.dumps([1000]), json.dumps(["a"]), json.dumps([True]), json.dumps([120] * 500), None, 5):
        assert yipi_captions.clean_pitch(bad) is None, bad
    assert yipi_captions.gender_of(PITCH, 0, 2) == "f" and yipi_captions.gender_of(PITCH, 2.0, 4.0) == "m"
    assert yipi_captions.gender_of(PITCH, 4.5, 6.5) == "" and yipi_captions.gender_of(None, 0, 2) == "" and yipi_captions.gender_of([0, 0, 0], 0, 1) == ""
    assert yipi_captions.gender_of([165] * 10, 0, 1) == "m" and yipi_captions.gender_of([166] * 10, 0, 1) == "f"


def test_the_answer_of_the_language_model_must_fit_the_sentences(monkeypatch):
    import ai_assistant
    answers = iter(['Sure! ["Hello", "World"]', "no list at all", '["a", "b"]'])
    monkeypatch.setattr(ai_assistant, "generate_text", lambda *args, **kwargs: next(answers))
    assert yipi_captions.translate(["eins", "zwei"], "en", "German") == ["Hello", "World"]
    assert yipi_captions.translate(["eins", "zwei"], "en", "German") == ["a", "b"], "the second try fits"
    monkeypatch.setattr(ai_assistant, "generate_text", lambda *args, **kwargs: "[1, 2]")
    with pytest.raises(yipi_captions.Unavailable):
        yipi_captions.translate(["eins", "zwei"], "en", "German")


def test_subtitles_of_videos_that_are_gone_are_removed(client, groq):
    mia = person("mia")
    media_id = upload_video(mia, captions="1")
    assert yipi.YipiCaption.query.filter_by(media_id=media_id).count() >= 1
    yipi.YipiMedia.query.filter_by(id=media_id).delete()
    db.session.commit()
    assert yipi_captions.purge_orphans() >= 1 and yipi.YipiCaption.query.filter_by(media_id=media_id).count() == 0


# ================================================================================================ the page
def test_the_page_has_the_button_the_window_and_the_voice_logic():
    assert "yipi-captions.js" in yipi.PULSE_SCRIPTS
    captions = open(os.path.join(JS_DIR, "yipi-captions.js"), encoding="utf-8").read()
    for word in ("speechSynthesis", "SpeechSynthesisUtterance", "voiceFor", "pitchOf", "OfflineAudioContext", "/captions?lang=", "reel-subs", "Sprache des Tons", "Originalton", "keine Stimme auf diesem Gerät"):
        assert word in captions, word
    videos = open(os.path.join(JS_DIR, "yipi-videos.js"), encoding="utf-8").read()
    assert "Y.captions.bind(" in videos and "Y.captions.sheet(" in videos and "cc.element" in videos and "reel.cc?.start()" in videos and "reel.cc?.stop()" in videos
    newpost = open(os.path.join(JS_DIR, "yipi-newpost.js"), encoding="utf-8").read()
    assert 'captions: "1"' in newpost and "pitchOf" in newpost
