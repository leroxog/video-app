"""Message requests, like on Instagram (2026-10-18). Who gets a message where:
     you follow each other             -> straight into the main chats, with a notification
     the sender follows you, you not   -> under "Anfragen": you have to accept first, and the sender learns nothing about reading until then
     nobody follows anybody            -> under "Anfragen" too, but in the folder "Allgemein" further back
Until the request is accepted the sender may send one message; declining hides the conversation."""
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


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


def api(client, method, path, body=None, status=None):
    r = getattr(client, method)(f"/api/yipi{path}", json=body) if body is not None else getattr(client, method)(f"/api/yipi{path}")
    if status is not None:
        assert r.status_code == status, (path, r.status_code, r.get_json())
    return r.get_json()


def follow(who, handle):
    api(who, "post", f"/users/{handle}/follow", status=200)


def me(client):
    return api(client, "get", "/me")["me"]


def box_of(client, handle):
    return [item["box"] for item in api(client, "get", "/messages")["items"] if item["user"]["handle"] == handle]


def test_mutual_followers_write_straight_into_the_main_chats(client):
    mia, tom = person("mia"), person("tom")
    follow(mia, "tom")
    follow(tom, "mia")
    api(mia, "post", "/messages/tom", {"text": "Hallo Tom"}, status=201)
    assert box_of(tom, "mia") == ["primary"] and me(tom)["unreadMessages"] == 1 and me(tom)["messageRequests"] == 0
    thread = api(tom, "get", "/messages/mia", status=200)
    assert thread["box"] == "primary" and thread["request"] is False and thread["canWrite"] is True
    assert me(tom)["unreadMessages"] == 0
    assert [m["read"] for m in api(mia, "get", "/messages/tom")["messages"]] == [True], "the sender sees that it was read"


def test_somebody_who_follows_you_but_you_do_not_follow_is_a_request(client):
    mia, tom = person("mia"), person("tom")
    follow(mia, "tom")                                                      # mia follows tom, tom does not follow mia
    api(mia, "post", "/messages/tom", {"text": "Darf ich?"}, status=201)
    assert box_of(tom, "mia") == ["request"] and box_of(mia, "tom") == ["primary"], "for the sender it is a normal chat"
    assert me(tom)["unreadMessages"] == 0 and me(tom)["messageRequests"] == 1, "no notification in the main chats, only a request"
    chats = api(tom, "get", "/chats", status=200)
    assert chats["requests"] == 1 and chats["items"][0]["box"] == "request"
    thread = api(tom, "get", "/messages/mia", status=200)
    assert thread["request"] is True and thread["canWrite"] is False and thread["gate"] == "accept_first" and thread["box"] == "request"
    assert [m["read"] for m in api(mia, "get", "/messages/tom")["messages"]] == [False], "looking at a request does not tell the sender that it was read"
    assert api(tom, "get", "/messages/mia/poll?after=0")["messages"][0]["text"] == "Darf ich?"
    assert [m["read"] for m in api(mia, "get", "/messages/tom")["messages"]] == [False]
    assert api(tom, "post", "/messages/mia", {"text": "ja"}, status=403)["error"] == "accept_first", "accept before answering"


def test_the_sender_may_send_one_message_until_the_request_is_accepted(client):
    mia, tom = person("mia"), person("tom")
    follow(mia, "tom")
    api(mia, "post", "/messages/tom", {"text": "eins"}, status=201)
    assert api(mia, "post", "/messages/tom", {"text": "zwei"}, status=403)["error"] == "request_pending"
    thread = api(mia, "get", "/messages/tom", status=200)
    assert thread["canWrite"] is False and thread["gate"] == "request_pending" and thread["request"] is False
    api(tom, "post", "/messages/mia/accept", status=200)
    assert box_of(tom, "mia") == ["primary"]
    assert api(mia, "post", "/messages/tom", {"text": "zwei"}, status=201)["message"]["text"] == "zwei"
    seen = api(tom, "get", "/messages/mia", status=200)
    assert seen["request"] is False and seen["canWrite"] is True and [m["text"] for m in seen["messages"]] == ["eins", "zwei"]
    assert [m["read"] for m in api(mia, "get", "/messages/tom")["messages"]] == [True, True], "after accepting, the sender sees that it was read"
    assert me(tom)["messageRequests"] == 0 and me(tom)["unreadMessages"] == 0


def test_strangers_land_in_the_folder_further_back(client):
    mia, tom, ann = person("mia"), person("tom"), person("ann")
    follow(ann, "tom")                                                      # a request
    api(ann, "post", "/messages/tom", {"text": "Hi von Ann"}, status=201)
    api(mia, "post", "/messages/tom", {"text": "Hi von Mia"}, status=201)    # nobody follows anybody: general
    assert box_of(tom, "ann") == ["request"] and box_of(tom, "mia") == ["general"]
    chats = api(tom, "get", "/chats")
    assert chats["requests"] == 2 and me(tom)["messageRequests"] == 2 and me(tom)["unreadMessages"] == 0
    assert api(mia, "post", "/messages/tom", {"text": "Hallo?"}, status=403)["error"] == "request_pending"
    api(tom, "post", "/messages/mia/accept", status=200)
    assert box_of(tom, "mia") == ["primary"]


def test_declining_hides_the_conversation_and_keeps_the_sender_waiting(client):
    mia, tom = person("mia"), person("tom")
    api(mia, "post", "/messages/tom", {"text": "Hey"}, status=201)
    assert box_of(tom, "mia") == ["general"]
    assert api(tom, "post", "/messages/mia/decline", status=200)["box"] == "declined"
    assert api(tom, "get", "/messages")["items"] == [] and api(tom, "get", "/chats")["requests"] == 0 and me(tom)["messageRequests"] == 0
    assert api(mia, "post", "/messages/tom", {"text": "bitte"}, status=403)["error"] == "request_pending", "the one who was declined cannot write on"
    follow(tom, "mia")                                                      # a change of mind: following brings the chat back
    assert box_of(tom, "mia") == ["primary"]


def test_answering_a_message_of_somebody_you_follow_is_a_normal_chat(client):
    mia, tom = person("mia"), person("tom")
    api(mia, "post", "/messages/tom", {"text": "Hallo"}, status=201)          # a request from a stranger
    follow(tom, "mia")
    thread = api(tom, "get", "/messages/mia", status=200)
    assert thread["box"] == "primary" and thread["canWrite"] is True and thread["request"] is False
    assert api(tom, "post", "/messages/mia", {"text": "Hi!"}, status=201)["message"]["mine"] is True
    assert api(mia, "post", "/messages/tom", {"text": "Schön"}, status=201), "after an answer the chat is open both ways"


def test_blocking_still_wins_and_deciding_needs_a_real_other_person(client):
    mia, tom = person("mia"), person("tom")
    api(mia, "post", "/messages/tom", {"text": "Hey"}, status=201)
    api(tom, "post", "/users/mia/block", status=200)
    assert api(mia, "post", "/messages/tom", {"text": "Hey"}, status=403)["error"] == "blocked"
    assert api(tom, "post", "/messages/mia/accept", status=200)["ok"], "deciding about a conversation is always possible"
    assert api(tom, "post", "/messages/nobody/accept", status=404)["error"] == "not_found"
    assert api(tom, "post", "/messages/tom/decline", status=404)["error"] == "not_found"
    assert api(flask_app.test_client(), "post", "/messages/mia/accept", status=401)


def test_deleting_an_account_removes_the_decisions(client):
    mia, tom = person("mia"), person("tom")
    api(mia, "post", "/messages/tom", {"text": "Hey"}, status=201)
    api(tom, "post", "/messages/mia/decline", status=200)
    assert yipi.YipiDmState.query.count() == 1
    assert api(tom, "post", "/delete", {"password": PASSWORD}, status=200)["ok"]
    assert yipi.YipiDmState.query.count() == 0
