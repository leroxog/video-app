"""Satürn chats (2026-10-17, night): the list of the chats page (people and groups together), group chats (friends only: members follow each other
with the creator; messages with text or a GIF; unread counters; leaving, renaming, adding), the friends list, and the new places of the pages
(games and videos are "coming soon", a group has its own address)."""
import os
import struct
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
    r = c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True})
    assert r.status_code == 200, r.get_json()
    return c


def api(client, method, path, body=None, status=None):
    r = getattr(client, method)(f"/api/yipi{path}", json=body) if body is not None else getattr(client, method)(f"/api/yipi{path}")
    if status is not None:
        assert r.status_code == status, (path, r.status_code, r.get_json())
    return r.get_json()


def befriend(first, first_handle, second, second_handle):
    api(first, "post", f"/users/{second_handle}/follow", status=200)
    api(second, "post", f"/users/{first_handle}/follow", status=200)


def group_of_three():
    mia, tom, ann = person("mia"), person("tom"), person("ann")
    befriend(mia, "mia", tom, "tom")
    befriend(mia, "mia", ann, "ann")
    group = api(mia, "post", "/groups", {"name": "Die Drei", "members": ["tom", "ann"]}, status=201)["group"]
    return mia, tom, ann, group


# ================================================================================================ the places of the pages
def test_the_camera_and_videos_are_pages_and_a_group_has_its_own_address(client):
    c = person("lia")
    for path in ("/camera", "/camera/dino", "/camera/fruit-merge", "/videos", "/g/1", "/messages", "/i/nex"):
        r = c.get(path)
        assert r.status_code == 200 and b'id="yipiBoot"' in r.data, path
    assert "<title>Kamera und Games auf Satürn</title>" in c.get("/camera").get_data(as_text=True)
    assert 'content="noindex"' in c.get("/camera/dino").get_data(as_text=True) and c.get("/camera/Gibt-Es-Nicht").status_code == 404 and c.get("/camera/a/b").status_code == 404
    old = c.get("/games")
    assert old.status_code == 301 and old.headers["Location"].endswith("/camera"), "the Games tab became the camera tab"
    old = c.get("/games/fruit-merge")
    assert old.status_code == 301 and old.headers["Location"].endswith("/camera/fruit-merge")
    assert 'content="noindex"' in c.get("/g/1").get_data(as_text=True)
    assert c.get("/g/0").status_code == 404 and c.get("/g/abc").status_code == 404
    for name in ("games", "videos", "chats", "camera", "kamera"):
        r = flask_app.test_client().post("/api/yipi/signup", json={"handle": name, "password": PASSWORD, "adult": True})
        assert r.status_code == 400 and r.get_json()["error"] == "reserved_handle", name


# ================================================================================================ friends
def test_the_friends_are_those_who_follow_each_other(client):
    mia, tom, ann, bob = person("mia"), person("tom"), person("ann"), person("bob")
    befriend(mia, "mia", tom, "tom")
    api(mia, "post", "/users/ann/follow", status=200)                 # only one way
    api(bob, "post", "/users/mia/follow", status=200)                 # only the other way
    assert [u["handle"] for u in api(mia, "get", "/friends", status=200)["users"]] == ["tom"]
    api(mia, "post", "/users/tom/block", status=200)
    assert api(mia, "get", "/friends", status=200)["users"] == []
    assert api(flask_app.test_client(), "get", "/friends", status=401)


# ================================================================================================ making a group
def test_a_group_is_made_with_friends_only(client):
    mia, tom, ann = person("mia"), person("tom"), person("ann")
    befriend(mia, "mia", tom, "tom")
    api(mia, "post", "/users/ann/follow", status=200)                 # ann does not follow back
    made = api(mia, "post", "/groups", {"name": "  Meine   Gruppe ", "members": ["TOM"]}, status=201)["group"]
    assert made["name"] == "Meine Gruppe" and made["isOwner"] is True and made["count"] == 2 and made["owner"] == "mia"
    assert [m["handle"] for m in made["members"]] == ["mia", "tom"] and [m["isOwner"] for m in made["members"]] == [True, False]
    refused = api(mia, "post", "/groups", {"name": "Mit ann", "members": ["tom", "ann"]}, status=403)
    assert refused["error"] == "not_friends" and refused["handle"] == "ann"
    assert api(mia, "post", "/groups", {"name": "x", "members": ["nobody"]}, status=404)["error"] == "not_found"
    assert yipi.YipiGroup.query.count() == 1


@pytest.mark.parametrize("body,error", [
    ({"name": "", "members": ["tom"]}, "bad_group_name"), ({"name": "x" * 41, "members": ["tom"]}, "bad_group_name"), ({"name": 5, "members": ["tom"]}, "bad_group_name"),
    ({"name": "Ohne Leute", "members": []}, "bad_request"), ({"name": "Nur ich", "members": ["mia"]}, "bad_request"), ({"name": "Falsch", "members": "tom"}, "bad_request"),
    ({"name": "Falsch", "members": [5]}, "bad_request"), ({"name": "Falsch"}, "bad_request"),
])
def test_a_badly_made_group_is_refused(client, body, error):
    mia, tom = person("mia"), person("tom")
    befriend(mia, "mia", tom, "tom")
    assert api(mia, "post", "/groups", body, status=400)["error"] == error
    assert yipi.YipiGroup.query.count() == 0


def test_a_group_has_at_most_twenty_members_and_is_rate_limited(client):
    mia = person("mia")
    names = [f"friend{n:02d}" for n in range(20)]
    for name in names:
        befriend(mia, "mia", person(name), name)
        yipi._hits.clear()                                          # (twenty sign-ups an hour from one address is the limit)
    assert api(mia, "post", "/groups", {"name": "Zu viele", "members": names}, status=400)["error"] == "bad_request"
    assert api(mia, "post", "/groups", {"name": "Genau voll", "members": names[:19]}, status=201)["group"]["count"] == 20
    for _ in range(yipi.LIMITS["group"][0]):
        yipi.limiter.too_many("group", str(yipi.YipiUser.query.filter_by(handle="mia").one().id))
    assert api(mia, "post", "/groups", {"name": "Noch eine", "members": names[:2]}, status=429)["error"] == "too_many"


# ================================================================================================ talking in a group
def test_the_members_talk_and_read_each_other_and_the_others_cannot(client):
    mia, tom, ann, group = group_of_three()
    stranger = person("zed")
    first = api(mia, "post", f"/groups/{group['id']}/messages", {"text": "Hallo ihr"}, status=201)["message"]
    assert first["mine"] is True and first["text"] == "Hallo ihr" and first["sender"]["handle"] == "mia" and first["gif"] is None
    api(tom, "post", f"/groups/{group['id']}/messages", {"text": "Hi Mia"}, status=201)
    seen = api(ann, "get", f"/groups/{group['id']}", status=200)
    assert [m["text"] for m in seen["messages"]] == ["Hallo ihr", "Hi Mia"] and [m["mine"] for m in seen["messages"]] == [False, False]
    assert [m["sender"]["handle"] for m in seen["messages"]] == ["mia", "tom"] and seen["group"]["count"] == 3 and seen["group"]["isOwner"] is False
    assert api(stranger, "get", f"/groups/{group['id']}", status=404)["error"] == "not_found"
    assert api(stranger, "post", f"/groups/{group['id']}/messages", {"text": "Moin"}, status=404)["error"] == "not_found"
    assert api(stranger, "get", f"/groups/{group['id']}/poll", status=404)
    assert api(flask_app.test_client(), "get", f"/groups/{group['id']}", status=401)
    assert api(mia, "get", "/groups/99999", status=404)["error"] == "not_found"


def test_what_is_unread_is_counted_per_group_and_in_total_and_cleared_by_reading(client):
    mia, tom, ann, group = group_of_three()
    api(tom, "post", "/messages/mia", {"text": "privat"}, status=201)
    api(mia, "post", f"/groups/{group['id']}/messages", {"text": "meine eigene"}, status=201)
    for text in ("eins", "zwei", "drei"):
        api(tom, "post", f"/groups/{group['id']}/messages", {"text": text}, status=201)
    assert api(mia, "get", "/me", status=200)["me"]["unreadMessages"] == 4, "one private message and three of the group; your own never count"
    chats = api(mia, "get", "/chats", status=200)["items"]
    group_row = [i for i in chats if i["kind"] == "group"][0]
    assert group_row["unread"] == 3 and group_row["last"]["text"] == "drei" and group_row["last"]["mine"] is False and group_row["last"]["sender"] == "tom"
    api(mia, "post", f"/groups/{group['id']}/messages", {"text": "gelesen und geantwortet"}, status=201)
    assert api(mia, "get", "/me", status=200)["me"]["unreadMessages"] == 1, "answering a group means you have read it"
    assert [i for i in api(mia, "get", "/chats", status=200)["items"] if i["kind"] == "group"][0]["last"]["mine"] is True
    api(mia, "get", f"/groups/{group['id']}", status=200)
    assert api(mia, "get", "/me", status=200)["me"]["unreadMessages"] == 1
    assert [i for i in api(mia, "get", "/chats", status=200)["items"] if i["kind"] == "group"][0]["unread"] == 0
    assert api(ann, "get", "/me", status=200)["me"]["unreadMessages"] == 5


def test_polling_a_group_gives_only_the_new_messages_of_the_others(client):
    mia, tom, ann, group = group_of_three()
    first = api(tom, "post", f"/groups/{group['id']}/messages", {"text": "alt"}, status=201)["message"]
    api(mia, "post", f"/groups/{group['id']}/messages", {"text": "von mir"}, status=201)
    api(ann, "post", f"/groups/{group['id']}/messages", {"text": "neu von ann"}, status=201)
    polled = api(mia, "get", f"/groups/{group['id']}/poll?after={first['id']}", status=200)["messages"]
    assert [m["text"] for m in polled] == ["neu von ann"] and polled[0]["sender"]["handle"] == "ann"
    assert api(mia, "get", f"/groups/{group['id']}/poll?after={polled[0]['id']}", status=200)["messages"] == []
    assert api(mia, "get", "/me", status=200)["me"]["unreadMessages"] == 0


def test_a_message_of_a_group_has_text_or_a_gif_and_nothing_else(client):
    mia, tom, ann, group = group_of_three()
    path = f"/groups/{group['id']}/messages"
    assert api(mia, "post", path, {"text": ""}, status=400)["error"] == "empty"
    assert api(mia, "post", path, {"text": "x" * 1001}, status=400)["error"] == "too_long"
    assert api(mia, "post", path, {"text": "x" * 1000}, status=201)
    assert api(mia, "post", path, {"gifId": "a" * 32}, status=404)["error"] == "gif_gone"
    yipi_gif = api(mia, "get", "/gifs", status=200)["items"][0]
    sent = api(mia, "post", path, {"gifId": yipi_gif["id"]}, status=201)["message"]
    assert sent["text"] == "" and sent["gif"]["id"] == yipi_gif["id"]
    assert api(tom, "get", f"/groups/{group['id']}", status=200)["messages"][-1]["gif"]["id"] == yipi_gif["id"]
    row = [i for i in api(tom, "get", "/chats", status=200)["items"] if i["kind"] == "group"][0]
    assert row["last"]["text"] == "Sticker" and row["last"]["gif"] is True and row["last"]["sender"] == "mia"


def test_a_group_conversation_pages_back_to_older_messages(client):
    mia, tom, ann, group = group_of_three()
    for n in range(yipi.PAGE * 2 + 5):
        api(tom, "post", f"/groups/{group['id']}/messages", {"text": f"Nachricht {n}"}, status=201)
        yipi._hits.clear()
    newest = api(mia, "get", f"/groups/{group['id']}", status=200)
    assert len(newest["messages"]) == yipi.PAGE * 2 and newest["next"] and newest["messages"][-1]["text"] == f"Nachricht {yipi.PAGE * 2 + 4}"
    older = api(mia, "get", f"/groups/{group['id']}?cursor={newest['next']}", status=200)
    assert len(older["messages"]) == 5 and older["next"] is None and older["messages"][0]["text"] == "Nachricht 0"


# ================================================================================================ the list of chats
def test_the_chats_list_has_people_and_groups_with_the_newest_first(client):
    mia, tom, ann, group = group_of_three()
    api(ann, "post", "/messages/mia", {"text": "erste private"}, status=201)
    api(tom, "post", f"/groups/{group['id']}/messages", {"text": "in der Gruppe"}, status=201)
    empty = api(mia, "post", "/groups", {"name": "Leer", "members": ["tom"]}, status=201)["group"]
    chats = api(mia, "get", "/chats", status=200)["items"]
    assert len(chats) == 3 and sorted(i["kind"] for i in chats) == ["dm", "group", "group"]
    by_kind = {(i["kind"], i["group"]["id"] if i["kind"] == "group" else i["user"]["handle"]): i for i in chats}
    assert by_kind[("dm", "ann")]["last"]["text"] == "erste private" and by_kind[("dm", "ann")]["unread"] == 1
    assert by_kind[("group", group["id"])]["group"] == {"id": group["id"], "name": "Die Drei", "count": 3} and by_kind[("group", group["id"])]["last"]["text"] == "in der Gruppe"
    assert by_kind[("group", empty["id"])]["last"] is None and by_kind[("group", empty["id"])]["unread"] == 0
    assert chats[0]["at"] >= chats[1]["at"] >= chats[2]["at"], "the newest first"
    assert api(person("zed"), "get", "/chats", status=200)["items"] == []
    assert api(flask_app.test_client(), "get", "/chats", status=401)


# ================================================================================================ leaving, renaming, adding
def test_leaving_a_group_and_a_group_that_nobody_is_in_any_more(client):
    mia, tom, ann, group = group_of_three()
    api(tom, "post", f"/groups/{group['id']}/messages", {"text": "bleibt"}, status=201)
    assert api(tom, "post", f"/groups/{group['id']}/leave", status=200)["ok"]
    assert api(tom, "get", f"/groups/{group['id']}", status=404)
    assert api(mia, "get", f"/groups/{group['id']}", status=200)["group"]["count"] == 2
    assert api(tom, "post", f"/groups/{group['id']}/leave", status=404)["error"] == "not_found"
    assert api(mia, "post", f"/groups/{group['id']}/leave", status=200)["ok"]
    seen = api(ann, "get", f"/groups/{group['id']}", status=200)["group"]
    assert seen["owner"] == "ann" and seen["isOwner"] is True, "the group goes to the member who is left"
    api(ann, "post", f"/groups/{group['id']}/leave", status=200)
    assert yipi.YipiGroup.query.count() == 0 and yipi.YipiGroupMember.query.count() == 0 and yipi.YipiGroupMessage.query.count() == 0


def test_only_the_owner_renames_and_adds(client):
    mia, tom, ann, group = group_of_three()
    zed = person("zed")
    befriend(mia, "mia", zed, "zed")
    befriend(tom, "tom", zed, "zed")
    path = f"/groups/{group['id']}"
    assert api(tom, "patch", path, {"name": "Neu"}, status=403)["error"] == "forbidden"
    assert api(mia, "patch", path, {"name": ""}, status=400)["error"] == "bad_group_name"
    assert api(mia, "patch", path, {"name": " Neuer   Name "}, status=200)["group"]["name"] == "Neuer Name"
    assert api(tom, "post", path + "/members", {"handle": "zed"}, status=403)["error"] == "forbidden"
    added = api(mia, "post", path + "/members", {"handle": "zed"}, status=200)["group"]
    assert added["count"] == 4 and "zed" in [m["handle"] for m in added["members"]]
    assert api(mia, "post", path + "/members", {"handle": "zed"}, status=200)["group"]["count"] == 4, "the same person twice is one member"
    assert api(zed, "get", path, status=200)["messages"] == [], "a new member does not see what was said before... nothing was said yet"
    stranger = person("yan")
    assert api(mia, "post", path + "/members", {"handle": "yan"}, status=403)["error"] == "not_friends"
    assert api(mia, "post", path + "/members", {"handle": 5}, status=400)["error"] == "bad_request"
    assert api(stranger, "patch", path, {"name": "Meins"}, status=404)


def test_a_new_member_does_not_get_the_old_messages_as_unread(client):
    mia, tom, ann, group = group_of_three()
    zed = person("zed")
    befriend(mia, "mia", zed, "zed")
    for n in range(3):
        api(tom, "post", f"/groups/{group['id']}/messages", {"text": f"alt {n}"}, status=201)
    api(mia, "post", f"/groups/{group['id']}/members", {"handle": "zed"}, status=200)
    assert api(zed, "get", "/me", status=200)["me"]["unreadMessages"] == 0
    api(tom, "post", f"/groups/{group['id']}/messages", {"text": "neu"}, status=201)
    assert api(zed, "get", "/me", status=200)["me"]["unreadMessages"] == 1


def test_deleting_an_account_takes_it_out_of_its_groups(client):
    mia, tom, ann, group = group_of_three()
    api(mia, "post", f"/groups/{group['id']}/messages", {"text": "Tschüss"}, status=201)
    assert api(mia, "post", "/delete", {"password": PASSWORD}, status=200)["ok"]
    seen = api(tom, "get", f"/groups/{group['id']}", status=200)
    assert seen["group"]["count"] == 2 and seen["group"]["owner"] in ("tom", "ann") and seen["messages"] == []
    api(tom, "post", "/delete", {"password": PASSWORD}, status=200)
    api(ann, "post", "/delete", {"password": PASSWORD}, status=200)
    assert yipi.YipiGroup.query.count() == 0 and yipi.YipiGroupMember.query.count() == 0 and yipi.YipiGroupMessage.query.count() == 0
