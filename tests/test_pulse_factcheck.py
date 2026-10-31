"""The fact check (2026-10-18): like the notes of X, a post whose claim is wrong gets a "Fact Check" under it.  Satürn (the AI) judges it in the
background, when the post is written or when somebody sees it for the first time; a note is only shown when the AI is sure.  Nobody can write
the note, and a person who thinks it is wrong can report it ("factcheck"), after which an admin can remove it."""
import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import ai_assistant  # noqa: E402
import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
CLAIM = "Die Erde ist eine Scheibe und die Sonne dreht sich um sie, das weiß jeder."


@pytest.fixture(autouse=True)
def fast_passwords(monkeypatch):
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


@pytest.fixture
def judge(monkeypatch):
    """The AI answers what the test says (a dict), the check runs at once instead of in a thread."""
    monkeypatch.setenv("GROQ_API_KEY", "test")
    answer = {"verdict": "false", "confidence": 97, "note": "Die Erde ist annähernd eine Kugel (genauer: ein Geoid)."}
    calls = []

    def fake(messages, max_tokens, temperature=0.7):
        calls.append(messages[-1]["content"])
        return "Hier das Urteil: " + json.dumps(answer, ensure_ascii=False)

    monkeypatch.setattr(ai_assistant, "_generate_groq", fake)
    monkeypatch.setattr(yipi, "FACT_RUNNER", lambda application, ids: [yipi.run_fact_check(application, post_id) for post_id in ids])
    fake.answer, fake.calls = answer, calls
    return fake


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def api(client, method, path, body=None, status=None):
    r = getattr(client, method)(f"/api/yipi{path}", json=body) if body is not None else getattr(client, method)(f"/api/yipi{path}")
    if status is not None:
        assert r.status_code == status, (path, r.status_code, r.get_json())
    return r.get_json()


def say(client, text, **extra):
    return api(client, "post", "/posts", {"text": text, **extra}, status=201)["post"]


def test_a_false_claim_gets_a_note_when_it_is_written(client, judge):
    mia, tom = person("mia"), person("tom")
    post = say(mia, CLAIM)
    assert "factCheck" not in post, "the answer to the writer comes before the check is done (it runs in the background)"
    assert api(mia, "get", f"/posts/{post['id']}", status=200)["post"]["factCheck"] == {"status": "false", "note": "Die Erde ist annähernd eine Kugel (genauer: ein Geoid)."}
    assert api(tom, "get", f"/posts/{post['id']}", status=200)["post"]["factCheck"]["status"] == "false"
    assert api(tom, "get", "/timeline?feed=foryou")["items"][0]["factCheck"]["note"].startswith("Die Erde")
    assert len(judge.calls) == 1 and judge.calls[0] == CLAIM


def test_misleading_claims_get_a_note_too(client, judge):
    judge.answer.update({"verdict": "misleading", "note": "Das gilt nur für Erwachsene, nicht für Kinder."})
    mia = person("mia")
    post = say(mia, "Jeder Mensch braucht jeden Tag genau acht Stunden Schlaf, nicht mehr und nicht weniger.")
    assert api(mia, "get", f"/posts/{post['id']}", status=200)["post"]["factCheck"]["status"] == "misleading"


def test_nothing_is_added_for_opinions_jokes_unsure_answers_or_short_posts(client, judge):
    mia = person("mia")
    for verdict, confidence, note in (("ok", 99, ""), ("opinion", 90, "Meinung"), ("unclear", 50, "vielleicht"), ("false", 60, "unsicher"), ("false", 99, ""), ("nonsense", 99, "x")):
        judge.answer.update({"verdict": verdict, "confidence": confidence, "note": note})
        post = say(mia, f"Eine Aussage mit genug Zeichen für eine Prüfung: {verdict} {confidence}")
        assert "factCheck" not in api(mia, "get", f"/posts/{post['id']}", status=200)["post"]
    before = len(judge.calls)
    assert "factCheck" not in say(mia, "Hallo!")
    assert len(judge.calls) == before, "a short post is not even sent to the AI"


def test_a_post_is_checked_once_and_a_reply_or_repost_is_not_a_new_claim(client, judge):
    mia, tom = person("mia"), person("tom")
    post = say(mia, CLAIM)
    api(tom, "post", "/posts/views", {"ids": [post["id"]]}, status=200)
    assert len(judge.calls) == 1, "checked at writing, not again when seen"
    api(tom, "post", f"/posts/{post['id']}/repost", status=200)
    assert len(judge.calls) == 1


def test_an_unchecked_post_is_checked_when_somebody_sees_it_first(client, judge, monkeypatch):
    mia, tom = person("mia"), person("tom")
    monkeypatch.delenv("GROQ_API_KEY")
    post = say(mia, CLAIM)                                                  # written while the AI could not be asked
    assert "factCheck" not in api(tom, "get", f"/posts/{post['id']}")["post"] and not judge.calls
    monkeypatch.setenv("GROQ_API_KEY", "test")
    api(tom, "post", "/posts/views", {"ids": [post["id"]]}, status=200)
    assert api(tom, "get", f"/posts/{post['id']}", status=200)["post"]["factCheck"]["status"] == "false"


def test_when_the_ai_cannot_be_reached_the_post_stays_unchecked_and_nothing_breaks(client, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setattr(yipi, "FACT_RUNNER", lambda application, ids: [yipi.run_fact_check(application, post_id) for post_id in ids])

    def broken(messages, max_tokens, temperature=0.7):
        raise RuntimeError("no connection")

    monkeypatch.setattr(ai_assistant, "_generate_groq", broken)
    post = say(person("mia"), CLAIM)
    assert "factCheck" not in post
    assert yipi.db.session.get(yipi.YipiPost, post["id"]).fact_status == ""


def test_garbage_from_the_ai_is_ignored(client, monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test")
    monkeypatch.setattr(yipi, "FACT_RUNNER", lambda application, ids: [yipi.run_fact_check(application, post_id) for post_id in ids])
    for garbage in ("", "keine Ahnung", "{kaputt", '{"verdict": ["false"], "confidence": "viel", "note": 5}', "[]"):
        monkeypatch.setattr(ai_assistant, "_generate_groq", lambda messages, max_tokens, temperature=0.7, garbage=garbage: garbage)
        assert "factCheck" not in say(person(f"p{abs(hash(garbage)) % 10000:04d}"), CLAIM)


def test_without_an_api_key_no_check_is_made(client, monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(yipi, "FACT_RUNNER", lambda application, ids: pytest.fail("the AI must not be asked"))
    assert "factCheck" not in say(person("mia"), CLAIM)


def test_the_checks_have_a_limit_for_the_whole_site(client, judge):
    mia = person("mia")
    for _ in range(yipi.LIMITS["factcheck"][0] + 1):
        yipi._hits.pop(("post-burst", str(1)), None)
        yipi.limiter.clear("post-burst", str(1))
        say(mia, CLAIM + str(_))
    assert len(judge.calls) == yipi.LIMITS["factcheck"][0], "after the limit new posts are simply not checked"


def test_a_wrong_note_can_be_reported_and_an_admin_can_remove_it(client, judge, monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss")
    boss, mia, tom = person("boss"), person("mia"), person("tom")
    post = say(mia, CLAIM)
    assert "factcheck" in yipi.REPORT_REASONS
    api(tom, "post", "/reports", {"postId": post["id"], "reason": "factcheck", "note": "stimmt doch"}, status=201)
    item = api(boss, "get", "/moderation/reports", status=200)["items"][0]
    assert item["reason"] == "factcheck" and item["postId"] == post["id"]
    api(boss, "post", f"/moderation/reports/{item['id']}", {"action": "clear_factcheck"}, status=200)
    assert "factCheck" not in api(tom, "get", f"/posts/{post['id']}", status=200)["post"]
    api(tom, "post", "/posts/views", {"ids": [post["id"]]}, status=200)
    assert len(judge.calls) == 1, "removed notes do not come back"
