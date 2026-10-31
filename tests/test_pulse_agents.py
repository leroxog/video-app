"""Satürn: the AI accounts are gone again (yipi_agents.py). What is left: the clean-up that removes every account that was made as an AI account, with what belongs to it,
and the list of words that nobody may use in the prompt of a lens."""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_agents  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    yipi._agent_cache.update(at=None, ids=frozenset())
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()
    yipi._agent_cache.update(at=None, ids=frozenset())


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def make_robot(handle, kind=1):
    user = yipi.YipiUser(handle=handle, handle_lc=handle.lower(), name=handle.title(), password_hash="!", agent_kind=kind)
    db.session.add(user)
    db.session.flush()
    return user


def test_the_clean_up_removes_the_robots_with_everything_they_did_and_leaves_people_alone(client):
    ana = person("ana")
    ana_id = db.session.query(yipi.YipiUser.id).filter_by(handle="ana").scalar()
    post = yipi.YipiPost(user_id=ana_id, text="Hallo Welt")
    db.session.add(post)
    db.session.flush()
    robots = [make_robot(f"robot{n}") for n in range(45)]
    for robot in robots:
        db.session.add(yipi.YipiLike(user_id=robot.id, post_id=post.id))
        yipi.bump(yipi.YipiPost, post.id, yipi.YipiPost.like_count, 1)
        db.session.add(yipi.YipiFollow(follower_id=robot.id, followee_id=ana_id))
        yipi.bump(yipi.YipiUser, ana_id, yipi.YipiUser.followers_count, 1)
        db.session.add(yipi.YipiPost(user_id=robot.id, text="Schöner Beitrag!", reply_to_id=post.id, root_id=post.id))
        yipi.bump(yipi.YipiPost, post.id, yipi.YipiPost.reply_count, 1)
    db.session.commit()
    assert db.session.get(yipi.YipiPost, post.id).like_count == 45 and db.session.get(yipi.YipiUser, ana_id).followers_count == 45

    removed = yipi_agents.remove_all(flask_app, pause=0)
    assert removed == 45
    db.session.expire_all()                                              # (the clean-up works in its own session, like the thread on the server)
    assert yipi.YipiUser.query.filter(yipi.YipiUser.agent_kind.isnot(None)).count() == 0
    assert yipi.YipiUser.query.filter(yipi.YipiUser.company.is_(False)).count() == 1, "the person is still there"
    assert yipi.YipiLike.query.count() == 0 and yipi.YipiFollow.query.count() == 0
    kept = db.session.get(yipi.YipiPost, post.id)
    assert kept is not None and kept.like_count == 0 and kept.reply_count == 0, "the counters of the person's post are right again"
    assert db.session.get(yipi.YipiUser, ana_id).followers_count == 0
    assert yipi.YipiPost.query.count() == 1, "the answers of the robots are gone"
    assert yipi_agents.remove_all(flask_app, pause=0) == 0, "a second run finds nothing"
    assert ana.get("/api/yipi/me").status_code == 200


def test_nothing_makes_robots_any_more_and_their_settings_are_gone(client):
    ana = person("ana")
    for path in ("/api/yipi/admin/agents", "/api/yipi/settings/ai"):
        assert ana.get(path).status_code in (404, 405)
        assert ana.post(path, json={"hide": True}).status_code in (404, 405)
    assert not hasattr(yipi_agents, "tick") and not hasattr(yipi_agents, "make_agents")


def test_the_words_that_nobody_may_use_in_a_lens_prompt():
    assert yipi_agents.sensitive("mach mich dumm aussehend") is False
    assert yipi_agents.sensitive("mit Waffe und Bombe") is True
    assert yipi_agents.sensitive("schreib an @jemand") is True
    assert yipi_agents.sensitive("") is False
