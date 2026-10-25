"""Nex: the AI accounts (yipi_agents.py): about a thousand accounts, marked "KI", that write, answer, like, follow and vote so that the site is alive, and that are careful
with people (no push messages, a few reactions an hour, nothing for people who blocked, muted or switched them off)."""
import json
import os
import random
import re
import sys
import tempfile
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_agents  # noqa: E402
import yipi_agents_data as words  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.setenv("YIPI_AGENT_COUNT", "60")
    monkeypatch.delenv("YIPI_AGENTS", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setattr(yipi_agents, "_llm_calls", [])


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    yipi._agent_cache.update(at=None, ids=frozenset())
    yipi_agents.AGENTS_CACHE["ids"] = set()
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()
    yipi._agent_cache.update(at=None, ids=frozenset())                 # (the ids of the AI accounts of this test must not be remembered by the next test)
    yipi_agents.AGENTS_CACHE["ids"] = set()


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def turn(rng_seed=1, minutes=0, **options):
    """One turn of the agents, `minutes` after the start of the test clock."""
    return yipi_agents.tick(flask_app, force=True, rng=random.Random(rng_seed), now=yipi.utcnow() + timedelta(minutes=minutes), **options)


def grown_up():
    """The accounts made and the first day of life given."""
    assert turn() == "seeding"
    result = turn(2)
    assert isinstance(result, dict) and result["backfilled"] > 20, result


def test_the_accounts_are_made_marked_and_nobody_can_sign_in_as_one(client):
    assert turn() == "seeding"
    agents = yipi.YipiUser.query.filter(yipi.YipiUser.agent_kind.isnot(None)).all()
    assert len(agents) == 60 and len({user.handle_lc for user in agents}) == 60
    for user in agents:
        assert yipi.HANDLE_RE.fullmatch(user.handle) and user.bio.startswith("KI-Konto · ") and len(user.bio) <= yipi.MAX_BIO and user.name.endswith(".")
        assert not user.check_password("") and not user.check_password(PASSWORD) and user.email is None and user.phone is None
        assert yipi.user_brief(user)["ai"] is True
    follows = yipi.YipiFollow.query.count()
    assert follows >= 60 * 8, "they know each other"
    first = agents[0]
    assert first.following_count == yipi.YipiFollow.query.filter_by(follower_id=first.id).count() and first.followers_count == yipi.YipiFollow.query.filter_by(followee_id=first.id).count()
    login = flask_app.test_client().post("/api/yipi/login", json={"handle": first.handle, "password": "anything at all"})
    assert login.status_code in (400, 401, 403), login.get_json()
    mia = person("mia")
    profile = mia.get(f"/api/yipi/users/{first.handle}").get_json()["user"]
    assert profile["ai"] is True and mia.get("/api/yipi/users/mia").get_json()["user"]["ai"] is False


def test_the_first_day_of_life_and_the_turns_keep_every_number_right(client):
    grown_up()
    posts = yipi.YipiPost.query.all()
    assert len(posts) > 20 and all(not post.deleted for post in posts)
    for post in posts:
        assert yipi_agents.tidy(post.text) and not re.search(r"https?:|www\.|@", post.text), post.text
        assert post.like_count == yipi.YipiLike.query.filter_by(post_id=post.id).count(), "likes are counted"
        assert post.reply_count == yipi.YipiPost.query.filter_by(reply_to_id=post.id).count(), "answers are counted"
    for user in yipi.YipiUser.query.filter(yipi.YipiUser.agent_kind.isnot(None)):
        assert user.posts_count == yipi.YipiPost.query.filter_by(user_id=user.id).count(), user.handle
    assert any(post.reply_to_id for post in posts), "a few answers between them"
    done = {"posts": 0, "likes": 0, "follows": 0, "votes": 0}
    for step in range(1, 7):
        result = turn(10 + step, minutes=20 * step)
        assert isinstance(result, dict), result
        for key in done:
            done[key] += result[key]
    assert done["posts"] > 0 and done["likes"] > 0 and done["follows"] > 0, done
    assert yipi.YipiPost.query.count() > len(posts)
    old = yipi.YipiPost.query.filter(yipi.YipiPost.created_at < yipi.utcnow() - timedelta(hours=40)).count()
    assert old == 0, "nothing is made for the past beyond the first day"
    polls = yipi.YipiPoll.query.all()
    for poll in polls:
        assert poll.total == yipi.YipiPollVote.query.filter_by(poll_id=poll.id).count() == sum(option.votes for option in yipi.YipiPollOption.query.filter_by(poll_id=poll.id))


def test_they_are_gentle_with_people_no_push_few_reactions_nothing_after_a_block(client, monkeypatch):
    pushes = []
    monkeypatch.setattr(yipi, "push_later", lambda *args, **kwargs: pushes.append(args))
    grown_up()
    mia = person("mia")
    assert mia.post("/api/yipi/posts", json={"text": "Heute habe ich zum ersten Mal Gnocchi gemacht und sie sind gut geworden"}).status_code == 201
    pushes.clear()
    state = yipi_agents.state_row()
    state.activity = "lebhaft"
    db.session.commit()
    for step in range(1, 9):
        turn(30 + step, minutes=25 * step)
    me = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
    ours = yipi.YipiNotification.query.filter(yipi.YipiNotification.user_id == me.id, yipi.YipiNotification.actor_id.in_(list(yipi_agents.AGENTS_CACHE["ids"]))).count()
    assert 0 < ours <= yipi_agents.PER_PERSON_PER_HOUR, f"the agents noticed her post, a few times only ({ours})"
    assert not pushes, "an AI account never buzzes a phone"
    # a person who blocked all of them hears nothing more
    before = yipi.YipiNotification.query.filter_by(user_id=me.id).count()
    for agent_id in yipi_agents.AGENTS_CACHE["ids"]:
        db.session.add(yipi.YipiBlock(blocker_id=me.id, blocked_id=agent_id))
    db.session.commit()
    assert mia.post("/api/yipi/posts", json={"text": "Und gleich gibt es Nachtisch mit Eis und Früchten"}).status_code == 201
    for step in range(1, 9):
        turn(60 + step, minutes=300 + 25 * step)
    assert yipi.YipiNotification.query.filter_by(user_id=me.id).count() == before


def test_a_person_can_switch_the_ai_accounts_off_for_themselves(client):
    grown_up()
    mia = person("mia")
    page = mia.get("/api/yipi/timeline?feed=foryou").get_json()
    assert any(item["user"]["ai"] for item in page["items"]), "the AI accounts show up, marked"
    assert mia.get("/api/yipi/me").get_json()["me"]["hideAi"] is False
    reply = mia.post("/api/yipi/settings/ai", json={"hide": True})
    assert reply.status_code == 200 and reply.get_json()["hideAi"] is True
    assert mia.post("/api/yipi/settings/ai", json={"hide": "yes"}).status_code == 400
    yipi._agent_cache.update(at=None, ids=frozenset())
    page = mia.get("/api/yipi/timeline?feed=foryou").get_json()
    assert not any(item["user"]["ai"] for item in page["items"]), "switched off: none of them"
    assert mia.get("/api/yipi/me").get_json()["me"]["hideAi"] is True
    assert mia.post("/api/yipi/settings/ai", json={"hide": False}).get_json()["hideAi"] is False


def test_only_good_texts_get_through():
    assert yipi_agents.tidy("Heute gibt es Nudeln mit Tomatensoße, ganz einfach und lecker.")
    assert yipi_agents.tidy("Das Wetter ist total schön heute #sommer")
    for bad in ("Schau mal auf https://example.org", "Schreib mir @mia", "Mehr unter www.beispiel.de", "Politik ist heute das Thema", "Wer wählt wen bei der Wahl?", "ok", "x" * 300,
                "Zwei #tags #sind zu viel", "Die AfD hat gewonnen", "Ich finde den Typ dumm", 5, None):
        assert yipi_agents.tidy(bad) is None, bad
    for text in words.GENERIC_POSTS + words.QUESTION_REPLIES + words.REACTIONS + [post for kind in words.ARCHETYPES for post in kind["posts"]] + [question for question, _ in words.POLLS]:
        assert yipi_agents.tidy(text), f"the list itself has to pass the filter: {text}"
    assert len(words.ARCHETYPES) >= 28 and len(words.FIRST_NAMES) >= 100
    for kind in words.ARCHETYPES:
        assert len(kind["posts"]) >= 6 and kind["nick"] and kind["bio"] and kind["hint"]
        for nick in kind["nick"]:
            assert re.fullmatch(r"[a-z0-9]{3,10}", nick), nick


def test_the_ai_service_writes_the_words_when_it_can_and_the_list_when_it_cannot(client, monkeypatch):
    import ai_assistant
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    seen = []

    def good(system, message, max_tokens=0, temperature=0):
        seen.append(json.loads(message))
        return 'Gern!\n[{"id": 0, "text": "Eine ganz neue Idee für den Abend mit Freunden"}, {"id": 1, "text": "Mehr dazu auf https://example.org"}, {"id": "x", "text": "falsch"}]'
    monkeypatch.setattr(ai_assistant, "generate_text", good)
    texts = yipi_agents.generate([{"id": 0, "art": "beitrag", "person": "kocht gern"}, {"id": 1, "art": "beitrag", "person": "läuft gern"}])
    assert texts == {0: "Eine ganz neue Idee für den Abend mit Freunden"}, "the one with a link is dropped"
    assert seen and seen[0][0]["art"] == "beitrag"
    monkeypatch.setattr(ai_assistant, "generate_text", lambda *args, **kwargs: "keine Liste")
    assert yipi_agents.generate([{"id": 0}]) == {}

    def broken(*args, **kwargs):
        raise RuntimeError("down")
    monkeypatch.setattr(ai_assistant, "generate_text", broken)
    assert yipi_agents.generate([{"id": 0}]) == {}
    monkeypatch.setattr(yipi_agents, "_llm_calls", [__import__("time").monotonic()] * yipi_agents.LLM_PER_HOUR)
    monkeypatch.setattr(ai_assistant, "generate_text", good)
    assert yipi_agents.generate([{"id": 0}]) == {}, "at most so many calls an hour"
    monkeypatch.delenv("GROQ_API_KEY")
    monkeypatch.setattr(yipi_agents, "_llm_calls", [])
    assert yipi_agents.generate([{"id": 0}]) == {}, "without a key the list does it"
    # the turns work with the AI service down: the posts come from the list
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(ai_assistant, "generate_text", broken)
    grown_up()
    assert yipi.YipiPost.query.count() > 20


def test_the_admin_can_see_pause_and_slow_down_the_agents_and_nobody_else(client, monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss")
    boss, nobody = person("boss"), person("nobody")
    grown_up()
    info = boss.get("/api/yipi/admin/agents").get_json()
    assert info["accounts"] == 60 and info["enabled"] is True and info["activity"] == "normal" and info["envOn"] is True and info["posts24h"] > 20
    assert nobody.get("/api/yipi/admin/agents").status_code == 403 and nobody.post("/api/yipi/admin/agents", json={"enabled": False}).status_code == 403
    assert boss.post("/api/yipi/admin/agents", json={"activity": "wild"}).status_code == 400
    assert boss.post("/api/yipi/admin/agents", json={"enabled": "nein"}).status_code == 400
    assert boss.post("/api/yipi/admin/agents", json={"activity": "ruhig", "enabled": False}).get_json()["activity"] == "ruhig"
    assert yipi_agents.tick(flask_app, rng=random.Random(5), now=yipi.utcnow() + timedelta(minutes=500)) == "off"
    boss.post("/api/yipi/admin/agents", json={"enabled": True})
    monkeypatch.setenv("YIPI_AGENTS", "0")
    assert yipi_agents.tick(flask_app, rng=random.Random(5), now=yipi.utcnow() + timedelta(minutes=600)) == "off", "the environment variable stops them for good"


def test_a_request_wakes_the_agents_only_outside_the_tests_and_never_twice_at_once(client, monkeypatch):
    started = []
    monkeypatch.setattr(yipi_agents.threading, "Thread", lambda **kw: type("T", (), {"start": lambda self: started.append(kw)})())
    mia = person("mia")
    mia.get("/api/yipi/me")
    assert not started, "the tests never start a thread by themselves"
    flask_app.config["YIPI_AGENTS_IN_TESTS"] = True
    try:
        yipi_agents._gate.update(checked=0.0, running=False)
        mia.get("/api/yipi/me")
        mia.get("/api/yipi/me")
        assert len(started) == 1, "once, and not again while it runs or within 20 seconds"
        yipi_agents._gate.update(checked=0.0, running=False)
        monkeypatch.setenv("YIPI_AGENTS", "0")
        mia.get("/api/yipi/me")
        assert len(started) == 1
    finally:
        flask_app.config.pop("YIPI_AGENTS_IN_TESTS", None)
        yipi_agents._gate.update(checked=0.0, running=False)


def test_two_turns_at_once_do_not_double_the_work(client):
    assert turn() == "seeding"
    # the claim is made in the database: a second worker that comes within 25 seconds finds the turn taken
    assert yipi_agents.tick(flask_app, rng=random.Random(1)) == "busy"


def test_the_legal_page_and_the_settings_tell_what_the_ai_accounts_are(client):
    text = flask_app.test_client().get("/nutzungsbedingungen").get_data(as_text=True)
    assert "KI-Konten" in text and "keine Menschen" in text and "ausblenden" in text
    pages = open(os.path.join(os.path.dirname(__file__), "..", "static", "js", "yipi-pages.js"), encoding="utf-8").read()
    assert "KI-Konten für mich ausblenden" in pages and "/settings/ai" in pages and "/admin/agents" in pages


def test_nobody_can_write_to_an_ai_account_and_they_are_not_offered_for_chats(client):
    assert turn() == "seeding"
    agent = yipi.YipiUser.query.filter(yipi.YipiUser.agent_kind.isnot(None)).first()
    mia = person("mia")
    reply = mia.post(f"/api/yipi/messages/{agent.handle}", json={"text": "Hallo, bist du da?"})
    assert reply.status_code == 403 and reply.get_json()["error"] == "ai_account"
    assert yipi.YipiMessage.query.count() == 0
    mia_user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
    db.session.add_all([yipi.YipiFollow(follower_id=mia_user.id, followee_id=agent.id), yipi.YipiFollow(follower_id=agent.id, followee_id=mia_user.id)])
    db.session.commit()
    yipi._agent_cache.update(at=None, ids=frozenset())
    assert mia.get("/api/yipi/friends").get_json()["users"] == [], "a mutual follow with an AI account makes no friend to chat with"

