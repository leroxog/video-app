"""Satürn, 2026-10-31: AI pictures ("KI-Bild" in the "+" panel of the chats and of the posts). The server asks the free service Pollinations (yipi_aiimage.py): one picture at a time, a pause after it,
a queue, honest errors. These tests never reach the internet: the fetch is replaced. The window is drawn by the browser (looked at by hand), so the JS tests read the files."""
import io
import os
import re
import sys
import tempfile
import threading
import time

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_aiimage  # noqa: E402
import yipi_company  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), "..")
JS = os.path.join(ROOT, "static", "js")
CSS = os.path.join(ROOT, "static", "css", "yipi.css")
PASSWORD = "correct horse battery"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 200


def read(name):
    with open(os.path.join(JS, name), encoding="utf-8") as handle:
        return handle.read()


class Raw:
    def __init__(self, body):
        self.body = io.BytesIO(body)

    def read(self, size, decode_content=False):
        return self.body.read(size)


class Reply:
    """What requests.get answers."""

    def __init__(self, status=200, body=b"", headers=None, text=""):
        self.status_code = status
        self.headers = headers or {}
        self.text = text or body[:600].decode("latin-1")
        self.raw = Raw(body)

    def close(self):
        pass


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.delenv("POLLINATIONS_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)                     # (no translation: the text stays as it is)
    monkeypatch.setattr(yipi_aiimage, "COOLDOWN", 0)
    yipi_aiimage.reset()
    yield
    yipi_aiimage.reset()


@pytest.fixture
def gate(monkeypatch):
    """A fetch that waits until the test lets it go; answers a JPEG."""
    opened = threading.Event()
    calls = []

    def fetch(prompt, seed):
        calls.append(prompt)
        opened.wait(5)
        return "ok", JPEG

    monkeypatch.setattr(yipi_aiimage, "fetch", fetch)
    fetch.opened, fetch.calls = opened, calls
    yield fetch
    opened.set()
    for _ in range(100):
        if not yipi_aiimage._state["worker"]:
            break
        time.sleep(0.05)


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


def sign_up(handle):
    person = flask_app.test_client()
    assert person.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return person


def wait_for(person, job, status="done"):
    for _ in range(100):
        data = person.get(f"/api/yipi/ai-image/{job}").get_json()
        if data["status"] == status or data["status"] in ("error", "cancelled"):
            return data
        time.sleep(0.05)
    raise AssertionError("the picture did not come")


# ================================================================================================ the fetch
def test_without_a_key_the_old_address_is_asked_with_the_safe_filter_and_a_picture_is_taken(monkeypatch):
    seen = []
    monkeypatch.setattr(yipi_aiimage.requests, "get", lambda url, **kwargs: seen.append((url, kwargs)) or Reply(200, JPEG))
    assert yipi_aiimage.fetch("a fox in space", 7) == ("ok", JPEG)
    url, kwargs = seen[0]
    assert url.startswith("https://image.pollinations.ai/prompt/a%20fox%20in%20space")
    assert kwargs["params"]["safe"] == "true" and kwargs["params"]["seed"] == 7 and "headers" not in kwargs
    monkeypatch.setattr(yipi_aiimage.requests, "get", lambda url, **kwargs: Reply(200, PNG))
    assert yipi_aiimage.fetch("a fox", 1) == ("ok", PNG)


def test_with_a_key_the_new_address_is_asked_and_the_key_goes_in_the_header_never_in_the_address(monkeypatch):
    monkeypatch.setenv("POLLINATIONS_API_KEY", "sk_test_value")
    seen = []
    monkeypatch.setattr(yipi_aiimage.requests, "get", lambda url, **kwargs: seen.append((url, kwargs)) or Reply(200, JPEG))
    assert yipi_aiimage.fetch("a fox", 3)[0] == "ok"
    url, kwargs = seen[0]
    assert url.startswith("https://gen.pollinations.ai/image/")
    assert kwargs["headers"] == {"Authorization": "Bearer sk_test_value"} and "sk_test_value" not in url and "sk_test_value" not in str(kwargs["params"])
    assert yipi_aiimage.cooldown() == yipi_aiimage.COOLDOWN_KEY


def test_the_service_saying_later_is_obeyed_and_everything_else_is_a_failure(monkeypatch):
    def answer(reply):
        monkeypatch.setattr(yipi_aiimage.requests, "get", lambda url, **kwargs: reply)
        return yipi_aiimage.fetch("a fox", 1)

    assert answer(Reply(503, b"{}", {"Retry-After": "10"})) == ("wait", 12), "the header, with a little extra"
    free_limit = '{"error":{"code":"FREE_LIMIT","message":"Free limit reached: 1 image every 45 seconds per IP. Retry after 43s, or get unlimited images"}}'
    assert answer(Reply(402, free_limit.encode(), {})) == ("wait", 45), "the number in the message"
    assert answer(Reply(429, b"{}", {"Retry-After": "9999"})) == ("wait", 120), "never longer than two minutes"
    assert answer(Reply(503, b"{}", {})) == ("wait", yipi_aiimage.cooldown()), "no number: the normal pause"
    assert answer(Reply(500, b"oops")) == ("fail", "")
    assert answer(Reply(200, b"<html>not a picture</html>")) == ("fail", "")
    assert answer(Reply(200, JPEG + b"0" * yipi_aiimage.MAX_BYTES)) == ("fail", ""), "too big"
    monkeypatch.setenv("POLLINATIONS_API_KEY", "sk_test_value")
    assert answer(Reply(402, free_limit.encode(), {})) == ("fail", ""), "with a key a 402 means the budget is empty: waiting does not help"

    def broken(url, **kwargs):
        raise yipi_aiimage.requests.ConnectionError("down")

    monkeypatch.setattr(yipi_aiimage.requests, "get", broken)
    assert yipi_aiimage.fetch("a fox", 1)[0] == "wait"


# ================================================================================================ the queue
def test_the_text_is_cleaned_and_what_is_not_allowed_never_reaches_the_service(monkeypatch):
    assert yipi_aiimage.clean_prompt("  a   fox \n in space ") == "a fox in space"
    assert len(yipi_aiimage.clean_prompt("x" * 500)) == yipi_aiimage.PROMPT_MAX
    for bad in ("eine Waffe", "ein Bild von Hitler", "schau auf https://example.org", "mail mir an a@b.de", "besuche www.test.de", "ein Hund.com"):
        assert yipi_aiimage.submit(1, bad, "free") == (None, "bad_prompt"), bad
    assert yipi_aiimage.submit(1, "   ", "free") == (None, "empty")
    monkeypatch.setattr(yipi_aiimage, "fetch", lambda prompt, seed: ("fail", ""))
    job, error = yipi_aiimage.submit(1, "ein freundlicher Fuchs im Raumanzug", "no-such-style")
    assert error == "" and job["style"] == "free", "an unknown style is the free one"


def test_one_picture_at_a_time_per_person_and_a_short_queue(gate, monkeypatch):
    monkeypatch.setattr(yipi_aiimage, "QUEUE_MAX", 2)
    first, error = yipi_aiimage.submit(1, "ein Fuchs", "free")
    assert error == ""
    assert yipi_aiimage.submit(1, "noch ein Fuchs", "free") == (None, "ai_image_running"), "one at a time for one person"
    second, error = yipi_aiimage.submit(2, "ein Hase", "free")
    assert error == ""
    assert yipi_aiimage.submit(3, "ein Igel", "free") == (None, "ai_image_full"), "the queue is short"
    assert yipi_aiimage.describe(first)["position"] == 1 and yipi_aiimage.describe(second)["position"] == 2
    assert yipi_aiimage.describe(second)["wait"] >= 12
    gate.opened.set()
    for _ in range(100):
        if first["status"] == "done" and second["status"] == "done":
            break
        time.sleep(0.05)
    assert first["image"] == JPEG and second["image"] == JPEG and yipi_aiimage.describe(second)["position"] == 0


def test_a_later_from_the_service_is_tried_again_and_too_many_laters_end_with_an_honest_error(monkeypatch):
    answers = [("wait", 0), ("wait", 0), ("ok", JPEG)]
    monkeypatch.setattr(yipi_aiimage, "fetch", lambda prompt, seed: answers.pop(0))
    job, _ = yipi_aiimage.submit(1, "ein Fuchs", "free")
    for _ in range(100):
        if job["status"] == "done":
            break
        time.sleep(0.05)
    assert job["status"] == "done" and job["tries"] == 3

    monkeypatch.setattr(yipi_aiimage, "fetch", lambda prompt, seed: ("wait", 0))
    job, _ = yipi_aiimage.submit(2, "ein Hase", "free")
    for _ in range(100):
        if job["status"] == "error":
            break
        time.sleep(0.05)
    assert job["status"] == "error" and job["error"] == "ai_image_busy" and job["tries"] == yipi_aiimage.TRIES

    monkeypatch.setattr(yipi_aiimage, "fetch", lambda prompt, seed: ("fail", ""))
    job, _ = yipi_aiimage.submit(3, "ein Igel", "free")
    for _ in range(100):
        if job["status"] == "error":
            break
        time.sleep(0.05)
    assert job["error"] == "ai_image_failed" and job["tries"] == 1, "a failure is not tried again and again"


def test_the_style_goes_to_the_service_in_english_after_the_text(gate):
    gate.opened.set()
    job, _ = yipi_aiimage.submit(1, "ein Fuchs", "pixel")
    for _ in range(100):
        if job["status"] == "done":
            break
        time.sleep(0.05)
    assert gate.calls == ["ein Fuchs, pixel art, 16-bit video game style"]


def test_the_text_is_translated_when_the_ai_is_there_and_stays_when_it_is_not(monkeypatch):
    assert yipi_aiimage.english("ein Fuchs") == "ein Fuchs"
    import ai_assistant
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setattr(ai_assistant, "generate_text", lambda system, message, **kwargs: '"a fox"')
    assert yipi_aiimage.english("ein Fuchs") == "a fox"

    def down(*args, **kwargs):
        raise RuntimeError("down")

    monkeypatch.setattr(ai_assistant, "generate_text", down)
    assert yipi_aiimage.english("ein Fuchs") == "ein Fuchs"


# ================================================================================================ the routes
def test_the_routes_need_an_account_and_every_picture_belongs_to_the_one_who_asked(client, gate):
    nobody = flask_app.test_client()
    assert nobody.post("/api/yipi/ai-image", json={"prompt": "ein Fuchs"}).status_code == 401
    assert nobody.get("/api/yipi/ai-image/" + "0" * 32).status_code == 401
    mia, tom = sign_up("mia"), sign_up("tom")
    started = mia.post("/api/yipi/ai-image", json={"prompt": "ein Fuchs im Raumanzug", "style": "cartoon"})
    assert started.status_code == 200
    data = started.get_json()
    assert data["ok"] and re.fullmatch(r"[0-9a-f]{32}", data["job"]) and data["position"] == 1 and data["status"] in ("queued", "working") and data["free"] is True
    job = data["job"]
    assert mia.get(f"/api/yipi/ai-image/{job}/file").status_code == 404, "not painted yet"
    assert tom.get(f"/api/yipi/ai-image/{job}").status_code == 404 and tom.get(f"/api/yipi/ai-image/{job}/file").status_code == 404, "somebody else's picture"
    assert tom.delete(f"/api/yipi/ai-image/{job}").status_code == 404
    again = mia.post("/api/yipi/ai-image", json={"prompt": "ein Hase"})
    assert again.status_code == 409 and again.get_json()["error"] == "ai_image_running"
    gate.opened.set()
    assert wait_for(mia, job)["status"] == "done"
    file = mia.get(f"/api/yipi/ai-image/{job}/file")
    assert file.status_code == 200 and file.mimetype == "image/jpeg" and file.data == JPEG and file.headers["Cache-Control"] == "no-store"
    assert tom.get(f"/api/yipi/ai-image/{job}/file").status_code == 404
    assert mia.delete(f"/api/yipi/ai-image/{job}").status_code == 200
    assert mia.get(f"/api/yipi/ai-image/{job}").status_code == 404, "fetched: forgotten"
    assert mia.get("/api/yipi/ai-image/not-an-id").status_code == 404


def test_a_bad_text_is_refused_and_a_person_cannot_ask_without_end(client, gate):
    mia = sign_up("mia")
    refused = mia.post("/api/yipi/ai-image", json={"prompt": "eine Waffe"})
    assert refused.status_code == 400 and refused.get_json()["error"] == "bad_prompt"
    assert mia.post("/api/yipi/ai-image", json={"prompt": ""}).get_json()["error"] == "empty"
    assert mia.post("/api/yipi/ai-image", json=["x"]).status_code in (400, 415), "not an object"
    limit, _ = yipi.LIMITS["ai-image"]
    yipi._hits.clear()
    codes = []
    for _ in range(limit + 2):
        reply = mia.post("/api/yipi/ai-image", json={"prompt": ""})
        codes.append(reply.status_code)
    assert codes[0] == 400 and codes[-1] == 429, "the 21st is too many"


def test_a_picture_that_is_cancelled_is_dropped(client, gate):
    mia, tom = sign_up("mia"), sign_up("tom")
    first = mia.post("/api/yipi/ai-image", json={"prompt": "ein Fuchs"}).get_json()["job"]
    second = tom.post("/api/yipi/ai-image", json={"prompt": "ein Hase"}).get_json()
    assert second["position"] == 2
    assert tom.delete(f"/api/yipi/ai-image/{second['job']}").status_code == 200
    assert tom.get(f"/api/yipi/ai-image/{second['job']}").get_json()["status"] == "cancelled"
    assert yipi_aiimage.describe(yipi_aiimage._jobs[first])["position"] == 1
    assert tom.post("/api/yipi/ai-image", json={"prompt": "ein Igel"}).status_code == 200, "after a cancel one may ask again"
    gate.opened.set()
    assert wait_for(mia, first)["status"] == "done"


def test_a_finished_picture_is_forgotten_after_ten_minutes(gate):
    gate.opened.set()
    job, _ = yipi_aiimage.submit(1, "ein Fuchs", "free")
    for _ in range(100):
        if job["status"] == "done":
            break
        time.sleep(0.05)
    with yipi_aiimage._lock:
        yipi_aiimage._expire(job["finished"] + yipi_aiimage.KEEP - 1)
        assert job["id"] in yipi_aiimage._jobs
        yipi_aiimage._expire(job["finished"] + yipi_aiimage.KEEP + 1)
        assert job["id"] not in yipi_aiimage._jobs


# ================================================================================================ the pages
def test_every_answer_of_the_server_has_a_german_sentence():
    api = read("yipi-api.js")
    source = open(os.path.join(ROOT, "yipi_aiimage.py"), encoding="utf-8").read()
    codes = set(re.findall(r'"(ai_image_\w+|bad_prompt)"', source)) | {"empty", "too_many", "not_found"}
    for code in codes:
        assert f"{code}:" in api, code


def test_the_plus_panels_of_chats_and_posts_have_the_entry_and_the_window_answers_a_file():
    composer, chats, components = read("yipi-composer.js"), read("yipi-chats.js"), read("yipi-components.js")
    assert 'ai: ["KI-Bild", "sparkle"' in composer and "voiceName, aiImage }" in composer
    assert '["photo", "camera", "ai", "location", "contact", "document", "sticker"]' in chats and 'else if (id === "ai") { const file = await T.aiImage(); if (file) stage(file, "image"); }' in chats
    assert '["photo", "camera", "ai", "location", "contact"]' in components and 'else if (id === "ai") { const file = await T.aiImage(); if (file) addFiles([file]); }' in components
    assert 'alt: file.alt || ""' in components, "the picture of the AI is described as such in the post"
    for word in ('Api.post("/ai-image"', "Api.get(`/ai-image/${job}`)", "Api.del(`/ai-image/${job}`)", "/api/yipi/ai-image/${mine}/file", 'new File([blob], png ? "ki-bild.png" : "ki-bild.jpg"',
                 "`KI-Bild: ${asked}`", "Warteschlange", "Pollinations", "Dieses Bild hat eine KI gemalt", "if (!answered) resolve(null)"):
        assert word in composer, word


def test_every_class_of_the_window_has_a_rule():
    css = open(CSS, encoding="utf-8").read()
    composer = read("yipi-composer.js")
    block = composer[composer.index("function aiImage()"):composer.index("/* \"📍 Mein Standort")]
    classes = set(re.findall(r'class: [`"]([\w -]+)', block)) - {"field-area", "btn", "hint", "spinner"}
    classes |= {"ai-style", "ai-go"}
    for name in sorted({part for entry in classes for part in entry.split() if part not in ("primary", "ghost", "on")}):
        assert f".{name}" in css, name


def test_the_people_are_told_where_the_text_goes_and_the_site_announces_the_feature():
    legal = open(os.path.join(ROOT, "templates", "legal.html"), encoding="utf-8").read()
    assert "<h2>KI-Bilder</h2>" in legal and "Pollinations" in legal and "Arbeitsspeicher" in legal
    assert "Beschreibungen für KI-Bilder an Pollinations" in legal
    new = [line for line in yipi_company.ANNOUNCEMENTS if line[0] == "2026-10-31-aiimage"]
    assert len(new) == 1 and len(new[0][2]) <= 280 and new[0][2].count("#") <= 2
    assert len({line[0] for line in yipi_company.ANNOUNCEMENTS}) == len(yipi_company.ANNOUNCEMENTS)
