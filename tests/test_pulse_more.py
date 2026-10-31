"""Satürn, the second round (2026-10-17 evening): polls, the counter of views, the lists of who liked or reposted, pinning a post to the profile,
search sorted by "Top" or only for media, the media feed and bigger lists of Explore, and removing all bookmarks at once. The first round (pages,
no videos, GIFs, Satürn) is in test_pulse.py."""
import io
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


def png():
    return b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + struct.pack(">II", 10, 10) + b"\x08\x06\x00\x00\x00" + b"\x00" * 20


def photo(client):
    r = client.post("/api/yipi/media", data={"file": (io.BytesIO(png()), "p.png")}, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_json()
    return r.get_json()["media"]


def say(client, text, **extra):
    return api(client, "post", "/posts", {"text": text, **extra}, status=201)["post"]


# ================================================================================================ polls
def make_poll(client, text="Was ist besser?", options=("Tee", "Kaffee"), minutes=None, status=201, **extra):
    poll = {"options": list(options)}
    if minutes is not None:
        poll["minutes"] = minutes
    return api(client, "post", "/posts", {"text": text, "poll": poll, **extra}, status=status)


def test_a_post_can_carry_a_poll_that_only_its_author_sees_the_numbers_of(client):
    mia = person("mia")
    tom = person("tom")
    post = make_poll(mia, options=(" Tee ", "Kaffee", "Wasser"))["post"]
    poll = post["poll"]
    assert [o["text"] for o in poll["options"]] == ["Tee", "Kaffee", "Wasser"] and poll["total"] == 0 and poll["ended"] is False
    assert poll["canVote"] is False and poll["showResults"] is True and [o["votes"] for o in poll["options"]] == [0, 0, 0], "the author sees the numbers, and cannot vote"
    seen = api(tom, "get", f"/posts/{post['id']}", status=200)["post"]["poll"]
    assert seen["canVote"] is True and seen["showResults"] is False and [o["votes"] for o in seen["options"]] == [None, None, None] and seen["voted"] is False
    ids = [o["id"] for o in seen["options"]]
    voted = api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": ids[1]}, status=200)["post"]["poll"]
    assert voted["voted"] is True and voted["canVote"] is False and voted["showResults"] is True and voted["total"] == 1
    assert [o["votes"] for o in voted["options"]] == [0, 1, 0] and [o["mine"] for o in voted["options"]] == [False, True, False]
    assert [o["votes"] for o in api(mia, "get", f"/posts/{post['id']}", status=200)["post"]["poll"]["options"]] == [0, 1, 0]
    assert api(flask_app.test_client(), "get", f"/posts/{post['id']}", status=401)["error"] == "not_logged_in"
    listed = api(tom, "get", "/timeline?feed=foryou", status=200)["items"][0]["poll"]
    assert listed["voted"] is True and listed["options"][1]["mine"] is True


def test_voting_has_rules(client):
    mia = person("mia")
    tom = person("tom")
    ann = person("ann")
    post = make_poll(mia)["post"]
    first, second = [o["id"] for o in post["poll"]["options"]]
    assert api(flask_app.test_client(), "post", f"/posts/{post['id']}/vote", {"optionId": first}, status=401)
    assert api(mia, "post", f"/posts/{post['id']}/vote", {"optionId": first}, status=400)["error"] == "self"
    assert api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": 99999}, status=400)["error"] == "bad_option"
    assert api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": "1"}, status=400)["error"] == "bad_option"
    assert api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": True}, status=400)["error"] == "bad_option"
    assert api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": first}, status=200)["ok"]
    assert api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": second}, status=409)["error"] == "already_voted"
    assert api(ann, "post", f"/posts/{post['id']}/vote", {"optionId": second}, status=200)["post"]["poll"]["total"] == 2
    plain = say(mia, "ohne Umfrage")
    assert api(tom, "post", f"/posts/{plain['id']}/vote", {"optionId": first}, status=404)["error"] == "not_found"
    assert "poll" not in api(tom, "get", f"/posts/{plain['id']}", status=200)["post"]
    api(mia, "post", "/users/tom/block", status=200)
    assert api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": first}, status=403)["error"] == "blocked"


def test_a_poll_that_is_over_shows_its_numbers_to_everybody_and_takes_no_more_votes(client):
    mia = person("mia")
    tom = person("tom")
    post = make_poll(mia, minutes=5)["post"]
    first = post["poll"]["options"][0]["id"]
    api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": first}, status=200)
    poll = yipi.YipiPoll.query.filter_by(post_id=post["id"]).one()
    poll.ends_at = yipi.utcnow() - yipi.timedelta(minutes=1)
    db.session.commit()
    ann = person("ann")
    shown = api(ann, "get", f"/posts/{post['id']}", status=200)["post"]["poll"]
    assert shown["ended"] is True and shown["canVote"] is False and shown["showResults"] is True and [o["votes"] for o in shown["options"]] == [1, 0]
    assert api(ann, "post", f"/posts/{post['id']}/vote", {"optionId": first}, status=409)["error"] == "poll_closed"


@pytest.mark.parametrize("poll", [
    {"options": ["nur eine"]}, {"options": ["a", "b", "c", "d", "e"]}, {"options": ["Tee", "tee"]}, {"options": ["Tee", "  "]}, {"options": ["x" * 26, "y"]},
    {"options": ["a", 5]}, {"options": "ab"}, {"options": ["a", "b"], "minutes": 4}, {"options": ["a", "b"], "minutes": 10081}, {"options": ["a", "b"], "minutes": True},
    {"options": ["a", "b"], "minutes": "60"}, "Ja oder Nein", {},
])
def test_a_badly_made_poll_is_refused(client, poll):
    mia = person("mia")
    assert api(mia, "post", "/posts", {"text": "Frage", "poll": poll}, status=400)["error"] == "bad_poll"
    assert yipi.YipiPost.query.count() == 0 and yipi.YipiPoll.query.count() == 0


def test_a_poll_stands_alone_with_a_question(client):
    mia = person("mia")
    root = say(mia, "Hallo")
    assert api(mia, "post", "/posts", {"text": "", "poll": {"options": ["a", "b"]}}, status=400)["error"] == "empty"
    assert make_poll(mia, replyTo=root["id"], status=400)["error"] == "bad_poll"
    assert make_poll(mia, quoteOf=root["id"], status=400)["error"] == "bad_poll"
    assert make_poll(mia, media=[photo(mia)["id"]], status=400)["error"] == "bad_poll"
    assert make_poll(mia, minutes=60)["post"]["poll"]["endsAt"]
    assert make_poll(mia, text="Noch eine Frage", options=("Ja", "Nein"), minutes=yipi.POLL_MINUTES[1])["ok"]


def test_a_poll_goes_with_its_post_and_the_votes_go_with_the_account_of_a_voter(client):
    mia = person("mia")
    tom = person("tom")
    post = make_poll(mia)["post"]
    other = make_poll(mia, text="Zweite Frage")["post"]
    api(tom, "post", f"/posts/{post['id']}/vote", {"optionId": post["poll"]["options"][0]["id"]}, status=200)
    api(tom, "post", f"/posts/{other['id']}/vote", {"optionId": other["poll"]["options"][1]["id"]}, status=200)
    assert api(tom, "post", "/delete", {"password": PASSWORD}, status=200)["ok"]
    assert yipi.YipiPollVote.query.count() == 0
    shown = api(mia, "get", f"/posts/{post['id']}", status=200)["post"]["poll"]
    assert [o["votes"] for o in shown["options"]] == [0, 0] and shown["total"] == 0
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert yipi.YipiPoll.query.count() == 1 and yipi.YipiPollOption.query.count() == 2


# ================================================================================================ views
def test_a_post_counts_how_often_others_had_it_on_screen(client):
    mia = person("mia")
    tom = person("tom")
    post = say(mia, "Schau her")
    assert post["views"] == 0
    assert api(tom, "post", "/posts/views", {"ids": [post["id"]]}, status=200)["counted"] == 1
    assert api(tom, "post", "/posts/views", {"ids": [post["id"], post["id"]]}, status=200)["counted"] == 1, "one per post and call"
    assert api(mia, "post", "/posts/views", {"ids": [post["id"]]}, status=200)["counted"] == 0, "not your own"
    assert api(tom, "get", f"/posts/{post['id']}", status=200)["post"]["views"] == 2
    assert api(tom, "get", "/timeline?feed=foryou", status=200)["items"][0]["views"] == 2
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert api(tom, "post", "/posts/views", {"ids": [post["id"], 999999]}, status=200)["counted"] == 0


def test_the_views_call_takes_only_numbers_few_at_a_time_and_only_from_people_signed_in(client):
    mia = person("mia")
    tom = person("tom")
    posts = [say(mia, f"Beitrag {n}") for n in range(3)]
    assert api(flask_app.test_client(), "post", "/posts/views", {"ids": [posts[0]["id"]]}, status=401)
    assert api(tom, "post", "/posts/views", {"ids": "1,2"}, status=400)["error"] == "bad_request"
    assert api(tom, "post", "/posts/views", {"ids": [True, "5", None, 0, -3, posts[0]["id"]]}, status=200)["counted"] == 1
    many = api(tom, "post", "/posts/views", {"ids": [posts[0]["id"]] * 100 + [posts[1]["id"]]}, status=200)
    assert many["counted"] == 1, "only the first forty entries are looked at"
    for _ in range(yipi.LIMITS["views"][0]):
        yipi.limiter.too_many("views", str(yipi.YipiUser.query.filter_by(handle="tom").one().id))
    assert api(tom, "post", "/posts/views", {"ids": [posts[2]["id"]]}, status=429)["error"] == "too_many"


# ================================================================================================ who liked, who reposted
def test_the_people_who_liked_or_reposted_can_be_listed(client):
    mia = person("mia")
    ann, bob, cyd = person("ann"), person("bob"), person("cyd")
    post = say(mia, "Beliebt")
    for who in (ann, bob, cyd):
        api(who, "post", f"/posts/{post['id']}/like", status=200)
    api(ann, "post", f"/posts/{post['id']}/repost", status=200)
    api(bob, "post", "/posts", {"text": "Zitat dazu", "quoteOf": post["id"]}, status=201)
    guest = person("zoe")                                       # somebody who is signed in and has nothing to do with the post
    likes = api(guest, "get", f"/posts/{post['id']}/likes", status=200)
    assert [u["handle"] for u in likes["users"]] == ["cyd", "bob", "ann"] and likes["next"] is None
    assert [u["handle"] for u in api(guest, "get", f"/posts/{post['id']}/reposts", status=200)["users"]] == ["ann"], "only real reposts, quotes are posts of their own"
    api(mia, "post", "/users/bob/block", status=200)
    assert [u["handle"] for u in api(mia, "get", f"/posts/{post['id']}/likes", status=200)["users"]] == ["cyd", "ann"]
    assert api(guest, "get", "/posts/99999/likes", status=404) and api(guest, "get", "/posts/99999/reposts", status=404)
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert api(guest, "get", f"/posts/{post['id']}/likes", status=404)["error"] == "not_found"


# ================================================================================================ pinning
def test_a_post_can_be_pinned_to_the_profile_and_comes_first(client):
    mia = person("mia")
    tom = person("tom")
    old = say(mia, "Mein erster")
    for n in range(3):
        say(mia, f"Später {n}")
    assert api(mia, "post", f"/posts/{old['id']}/pin", status=200) == {"ok": True, "pinnedPostId": old["id"]}
    page = api(tom, "get", "/users/mia/posts?tab=posts", status=200)
    assert page["items"][0]["id"] == old["id"] and page["items"][0]["pinned"] is True
    assert [i["text"] for i in page["items"]] == ["Mein erster", "Später 2", "Später 1", "Später 0"], "and it is not in the list a second time"
    assert api(tom, "get", "/users/mia", status=200)["user"]["pinnedPostId"] == old["id"]
    assert all("pinned" not in item for item in api(tom, "get", "/timeline?feed=foryou", status=200)["items"])
    assert api(mia, "delete", f"/posts/{old['id']}/pin", status=200)["pinnedPostId"] is None
    assert [i["text"] for i in api(tom, "get", "/users/mia/posts?tab=posts", status=200)["items"]][0] == "Später 2"


def test_only_your_own_posts_can_be_pinned_and_not_replies_or_reposts(client):
    mia = person("mia")
    tom = person("tom")
    mine = say(mia, "Meins")
    reply = say(tom, "Antwort", replyTo=mine["id"])
    assert api(tom, "post", f"/posts/{mine['id']}/pin", status=404)["error"] == "not_found"
    assert api(tom, "post", f"/posts/{reply['id']}/pin", status=400)["error"] == "bad_request"
    assert api(tom, "post", "/posts/99999/pin", status=404)
    assert api(flask_app.test_client(), "post", f"/posts/{mine['id']}/pin", status=401)
    assert api(tom, "delete", f"/posts/{mine['id']}/pin", status=404)["error"] == "not_found"


def test_deleting_the_pinned_post_unpins_it_and_a_second_pin_replaces_the_first(client):
    mia = person("mia")
    one = say(mia, "Eins")
    two = say(mia, "Zwei")
    api(mia, "post", f"/posts/{one['id']}/pin", status=200)
    assert api(mia, "post", f"/posts/{two['id']}/pin", status=200)["pinnedPostId"] == two["id"]
    assert api(mia, "get", "/users/mia/posts?tab=posts", status=200)["items"][0]["id"] == two["id"]
    api(mia, "delete", f"/posts/{two['id']}", status=200)
    assert api(mia, "get", "/users/mia", status=200)["user"]["pinnedPostId"] is None
    assert [i["text"] for i in api(mia, "get", "/users/mia/posts?tab=posts", status=200)["items"]] == ["Eins"]


# ================================================================================================ search and discovery
def test_search_can_sort_by_what_people_did_and_only_look_for_media(client):
    mia = person("mia")
    tom = person("tom")
    quiet = say(mia, "Katze ruhig")
    loved = say(mia, "Katze beliebt")
    newest = say(mia, "Katze neu")
    api(tom, "post", f"/posts/{loved['id']}/like", status=200)
    say(tom, "Antwort", replyTo=loved["id"])
    top = api(tom, "get", "/search?q=Katze&type=posts&sort=top", status=200)
    assert [i["id"] for i in top["items"]] == [loved["id"], newest["id"], quiet["id"]] and top["next"] is None
    new = api(tom, "get", "/search?q=Katze&type=posts", status=200)
    assert [i["id"] for i in new["items"]] == [newest["id"], loved["id"], quiet["id"]]
    with_photo = say(mia, "Katze mit Bild", media=[photo(mia)["id"]])
    assert [i["id"] for i in api(tom, "get", "/search?q=Katze&type=media", status=200)["items"]] == [with_photo["id"]]
    assert [i["id"] for i in api(tom, "get", "/search?q=Katze&type=media&sort=top", status=200)["items"]] == [with_photo["id"]]


def test_top_search_pages_through_its_list(client):
    mia = person("mia")
    for n in range(yipi.PAGE + 5):
        say(mia, f"Beitrag mit Wort {n}")
        yipi._hits.clear()                                      # (twelve posts a minute is the limit)
    first = api(mia, "get", "/search?q=Wort&type=posts&sort=top", status=200)
    assert len(first["items"]) == yipi.PAGE and first["next"] == yipi.PAGE
    second = api(mia, "get", f"/search?q=Wort&type=posts&sort=top&cursor={first['next']}", status=200)
    assert len(second["items"]) == 5 and second["next"] is None
    assert not {i["id"] for i in first["items"]} & {i["id"] for i in second["items"]}
    assert api(mia, "get", "/search?q=Wort&type=posts&sort=top&cursor=99999999", status=200)["items"] == []


def test_explore_has_a_media_feed_more_trends_and_more_people(client):
    mia = person("mia")
    tom = person("tom")
    with_photo = say(mia, "mit Bild #eins", media=[photo(mia)["id"]])
    say(mia, "ohne Bild")
    assert [i["id"] for i in api(tom, "get", "/timeline?feed=media", status=200)["items"]] == [with_photo["id"]]
    for n in range(12):
        say(mia, f"Thema #trend{chr(97 + n)}{chr(97 + n)}")
        yipi._hits.clear()
    assert len(api(tom, "get", "/trends", status=200)["trends"]) == 8
    assert len(api(tom, "get", "/trends?limit=20", status=200)["trends"]) == 13
    assert len(api(tom, "get", "/trends?limit=500", status=200)["trends"]) == 13 and len(api(tom, "get", "/trends?limit=0", status=200)["trends"]) == 8
    for n in range(6):
        person(f"extra{n}")
    assert len(api(tom, "get", "/suggestions", status=200)["users"]) == 3
    assert len(api(tom, "get", "/suggestions?limit=10", status=200)["users"]) == 7
    assert len(api(tom, "get", "/suggestions?limit=99999", status=200)["users"]) == 7


def test_all_bookmarks_can_be_removed_at_once(client):
    mia = person("mia")
    tom = person("tom")
    post = None
    for n in range(3):
        post = say(mia, f"Merk dir {n}")
        api(tom, "post", f"/posts/{post['id']}/bookmark", status=200)
    api(mia, "post", f"/posts/{post['id']}/bookmark", status=200)
    assert len(api(tom, "get", "/bookmarks", status=200)["items"]) == 3
    assert api(tom, "delete", "/bookmarks", status=200) == {"ok": True, "removed": 3}
    assert api(tom, "get", "/bookmarks", status=200)["items"] == [] and len(api(mia, "get", "/bookmarks", status=200)["items"]) == 1, "only your own"
    assert api(flask_app.test_client(), "delete", "/bookmarks", status=401)
