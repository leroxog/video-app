"""Satürn calls (2026-10-31): a call with a friend or a group, live, from a chat. What is checked: who may ring whom, the notification (a push that is sent even when the page was open a moment
ago), the call from ringing to talking to the end, the voice pieces (they reach the others and nobody else, they are deleted ten seconds after they were played, at the latest thirty seconds
after they came in, and they are never kept in the database), the line in the chat when a call is over, one call at a time, group calls, and people who went quiet."""
import base64
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_calls  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
JS_DIR = os.path.join(os.path.dirname(__file__), "..", "static", "js")


class Clock:
    now = 1000.0

    def __call__(self):
        return self.now

    def tick(self, seconds):
        self.now += seconds


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)


@pytest.fixture
def clock(monkeypatch):
    fake = Clock()
    monkeypatch.setattr(yipi_calls, "clock", fake)
    yipi_calls.reset()
    yield fake
    yipi_calls.reset()


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


def api(c, method, path, body=None, status=None, data=None):
    if data is not None:
        r = c.post(f"/api/yipi{path}", data=data, content_type="application/octet-stream")
    else:
        r = getattr(c, method)(f"/api/yipi{path}", json=body) if body is not None else getattr(c, method)(f"/api/yipi{path}")
    if status is not None:
        assert r.status_code == status, (path, r.status_code, r.get_json())
    return r.get_json()


def befriend(first, first_handle, second, second_handle):
    api(first, "post", f"/users/{second_handle}/follow", status=200)
    api(second, "post", f"/users/{first_handle}/follow", status=200)


def sync(c, call_id, data=b"", after=0, played=0, status=200):
    return api(c, "post", f"/calls/{call_id}/sync?after={after}&played={played}", status=status, data=data)


def lines(c, handle):
    return [m["text"] for m in api(c, "get", f"/messages/{handle}", status=200)["messages"]]


@pytest.fixture
def pair(client, clock):
    tom, mia = person("tom"), person("mia")
    befriend(tom, "tom", mia, "mia")
    return tom, mia


def wait(clock, seconds, *callers_and_ids):
    """Lets time pass in steps of ten seconds while the given (client, call id) pairs keep asking (a page in a call asks every third of a second)."""
    for _ in range(int(seconds // 10)):
        clock.tick(10)
        for who, call_id in callers_and_ids:
            api(who, "post", f"/calls/{call_id}/sync", data=b"")
    clock.tick(seconds % 10)


def talking(tom, mia):
    call = api(tom, "post", "/calls", {"handle": "mia"}, status=201)["call"]
    api(mia, "post", f"/calls/{call['id']}/answer", status=200)
    return call["id"]


# ================================================================================================ ringing
def test_a_call_rings_the_other_person_and_a_push_goes_out_even_when_the_page_was_open_a_moment_ago(pair, monkeypatch):
    tom, mia = pair
    sent = []
    monkeypatch.setattr(yipi, "PUSH_RUNNER", lambda app, user_id, payload: yipi.deliver_push(user_id, payload))
    monkeypatch.setattr(yipi, "web_push", lambda sub, payload, key: sent.append(payload))
    api(mia, "post", "/push/subscribe", {"subscription": {"endpoint": "https://push.example/1", "keys": {"p256dh": "p" * 20, "auth": "a" * 10}}}, status=200)
    user = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
    user.last_seen_at = yipi.utcnow()                                   # mia is on the page right now: a plain notification would be held back
    db.session.commit()
    sent.clear()
    made = api(tom, "post", "/calls", {"handle": "mia"}, status=201)["call"]
    assert made["status"] == "ringing" and made["kind"] == "dm" and made["me"] == "joined" and made["caller"]["handle"] == "tom"
    assert len(sent) == 1 and sent[0]["body"] == "tom ruft dich an" and sent[0]["urgent"] is True and sent[0]["url"] == "/messages/tom" and sent[0]["tag"] == f"call-{made['id']}"
    ringing = api(mia, "get", "/calls/incoming", status=200)
    assert ringing["call"]["id"] == made["id"] and ringing["call"]["caller"]["name"] == "tom" and ringing["call"]["ringLeft"] > 40 and ringing["active"] is None
    assert api(tom, "get", "/calls/incoming", status=200)["call"] is None, "the caller is not rung"
    assert api(person("zoe"), "get", "/calls/incoming", status=200)["call"] is None, "nobody else hears it"


def test_the_service_worker_keeps_a_call_on_the_screen_and_the_script_is_part_of_the_page():
    worker = open(os.path.join(JS_DIR, "pulse-sw.js"), encoding="utf-8").read()
    assert "requireInteraction: data.urgent === true" in worker and "vibrate" in worker
    assert "yipi-calls.js" in yipi.PULSE_SCRIPTS and yipi.PULSE_SCRIPTS.index("yipi-composer.js") < yipi.PULSE_SCRIPTS.index("yipi-calls.js")
    source = open(os.path.join(JS_DIR, "yipi-calls.js"), encoding="utf-8").read()
    assert 'Api.post("/calls"' in source and "/calls/incoming" in source and "/sync?after=" in source and "navigator.sendBeacon" in source


def test_only_people_who_count_the_caller_as_a_chat_partner_can_be_rung(client, clock):
    tom, mia, zoe, ben = person("tom"), person("mia"), person("zoe"), person("ben")
    assert api(tom, "post", "/calls", {"handle": "mia"}, status=403)["error"] == "call_not_allowed", "mia does not know tom"
    api(tom, "post", "/users/mia/follow", status=200)
    assert api(tom, "post", "/calls", {"handle": "mia"}, status=403)["error"] == "call_not_allowed", "mia has not followed tom back or accepted him"
    api(mia, "post", "/users/tom/follow", status=200)
    assert api(tom, "post", "/calls", {"handle": "mia"}, status=201)["ok"]
    yipi_calls.reset()
    assert api(tom, "post", "/calls", {"handle": "tom"}, status=400)["error"] == "self"
    assert api(tom, "post", "/calls", {"handle": "gibt_es_nicht"}, status=404)["error"] == "not_found"
    assert api(tom, "post", "/calls", {}, status=400)["error"] == "bad_request"
    api(ben, "post", "/users/mia/follow", status=200)
    api(mia, "post", "/users/ben/follow", status=200)
    api(mia, "post", "/users/ben/block", status=200)
    assert api(ben, "post", "/calls", {"handle": "mia"}, status=403)["error"] == "blocked"
    assert api(mia, "post", "/calls", {"handle": "ben"}, status=403)["error"] == "blocked"


def test_nobody_rings_an_ai_or_an_official_account(client, clock):
    tom = person("tom")
    robot = yipi.YipiUser(handle="robo", handle_lc="robo", name="Robo", password_hash="x", agent_kind="bot")
    official = yipi.YipiUser(handle="offi", handle_lc="offi", name="Offi", password_hash="x", company=True)
    db.session.add_all([robot, official])
    db.session.commit()
    assert api(tom, "post", "/calls", {"handle": "robo"}, status=403)["error"] == "ai_account"
    assert api(tom, "post", "/calls", {"handle": "offi"}, status=403)["error"] == "official_account"


# ================================================================================================ talking
def test_the_voice_goes_to_the_other_person_only_and_a_call_needs_both(pair):
    tom, mia = pair
    call_id = talking(tom, mia)
    assert api(tom, "post", f"/calls/{call_id}/sync", status=200, data=b"")["call"]["status"] == "active"
    heard = bytes(range(200))
    first = sync(tom, call_id, heard)
    assert first["chunks"] == [], "tom does not get his own voice back"
    got = sync(mia, call_id)
    assert [(c["seq"], base64.b64decode(c["data"])) for c in got["chunks"]] == [(1, heard)] and got["chunks"][0]["from"] == yipi.YipiUser.query.filter_by(handle_lc="tom").first().id
    assert sync(mia, call_id, after=1)["chunks"] == [], "asked for newer ones only"
    sync(mia, call_id, b"\x80" * 50)
    back = sync(tom, call_id)
    assert len(back["chunks"]) == 1 and base64.b64decode(back["chunks"][0]["data"]) == b"\x80" * 50
    assert api(person("zoe"), "post", f"/calls/{call_id}/sync", status=404)["error"] == "not_found", "a stranger cannot listen"


def test_a_piece_of_voice_is_deleted_ten_seconds_after_it_was_played(pair, clock):
    tom, mia = pair
    call_id = talking(tom, mia)
    sync(tom, call_id, b"\x90" * 100)
    pieces = lambda: yipi_calls.CALLS[call_id].chunks                   # noqa: E731
    assert len(pieces()) == 1
    clock.tick(5)
    sync(tom, call_id)
    sync(mia, call_id)                                                  # mia fetched it (and has not played it yet)
    assert len(pieces()) == 1
    clock.tick(5)
    sync(mia, call_id, played=1)                                        # mia says: played
    clock.tick(9.5)
    sync(tom, call_id)
    assert len(pieces()) == 1, "nine and a half seconds after playing it is still there"
    clock.tick(1)
    sync(tom, call_id)
    assert pieces() == [], "ten seconds after it was played it is gone"


def test_a_piece_nobody_fetched_is_deleted_after_thirty_seconds_and_a_call_over_keeps_none(pair, clock):
    tom, mia = pair
    call_id = talking(tom, mia)
    sync(tom, call_id, b"\x90" * 100)
    clock.tick(14)
    sync(tom, call_id)
    sync(mia, call_id)
    clock.tick(14)
    sync(tom, call_id)
    sync(mia, call_id)
    assert len(yipi_calls.CALLS[call_id].chunks) == 1
    clock.tick(3)
    sync(tom, call_id)
    sync(mia, call_id)
    assert yipi_calls.CALLS[call_id].chunks == [], "thirty seconds"
    sync(tom, call_id, b"\x91" * 10)
    api(mia, "post", f"/calls/{call_id}/hangup", status=200)
    assert api(tom, "post", f"/calls/{call_id}/sync", status=200, data=b"")["call"]["status"] == "ended"
    clock.tick(11)
    api(tom, "post", f"/calls/{call_id}/sync", status=200, data=b"")
    assert yipi_calls.CALLS[call_id].chunks == [], "ten seconds after the end nothing of the voice is left"
    clock.tick(61)
    yipi_calls.sweep()
    assert call_id not in yipi_calls.CALLS, "a minute after the end the call is forgotten"


def test_the_voice_never_reaches_the_database():
    source = open(os.path.join(os.path.dirname(__file__), "..", "yipi_calls.py"), encoding="utf-8").read()
    assert "db.session.add(" not in source.replace("yipi.db.session.add(yipi.YipiMessage", "").replace("yipi.db.session.add(yipi.YipiGroupMessage", ""), "only the lines for the chat are written"
    assert "Chunk(" in source and "class Chunk" in source


def test_sizes_and_the_state_of_the_person_are_checked(pair):
    tom, mia = pair
    made = api(tom, "post", "/calls", {"handle": "mia"}, status=201)["call"]
    assert api(mia, "post", f"/calls/{made['id']}/sync", status=409, data=b"")["error"] == "not_joined", "mia has not answered"
    api(mia, "post", f"/calls/{made['id']}/answer", status=200)
    assert api(tom, "post", f"/calls/{made['id']}/sync", status=413, data=b"\x00" * (yipi_calls.MAX_CHUNK + 1))["error"] == "attachment_too_big"
    assert sync(tom, made["id"], b"\x00" * yipi_calls.MAX_CHUNK)["ok"]
    assert api(mia, "post", "/calls/gibtsnicht/sync", status=404)["error"] == "not_found"


# ================================================================================================ the end, and the line in the chat
def test_a_call_that_was_talked_leaves_its_length_in_the_chat(pair, clock):
    tom, mia = pair
    call_id = talking(tom, mia)
    clock.tick(151)
    sync(tom, call_id)
    sync(mia, call_id)
    api(tom, "post", f"/calls/{call_id}/hangup", status=200)
    assert lines(tom, "mia")[-1] == "📞 Anruf · 2:31" and lines(mia, "tom")[-1] == "📞 Anruf · 2:31"
    assert api(mia, "get", f"/calls/incoming", status=200)["active"] is None
    assert api(mia, "post", f"/calls/{call_id}/sync", status=200, data=b"")["call"]["status"] == "ended", "the other one learns that it is over"
    assert [m for m in lines(mia, "tom") if m.startswith("📞")] == ["📞 Anruf · 2:31"], "one line only"


def test_a_call_nobody_answers_is_missed_and_says_so_in_the_chat_and_on_the_phone(pair, clock, monkeypatch):
    tom, mia = pair
    sent = []
    monkeypatch.setattr(yipi, "PUSH_RUNNER", lambda app, user_id, payload: yipi.deliver_push(user_id, payload))
    monkeypatch.setattr(yipi, "web_push", lambda sub, payload, key: sent.append(payload))
    api(mia, "post", "/push/subscribe", {"subscription": {"endpoint": "https://push.example/2", "keys": {"p256dh": "p" * 20, "auth": "a" * 10}}}, status=200)
    made = api(tom, "post", "/calls", {"handle": "mia"}, status=201)["call"]
    wait(clock, 30, (tom, made["id"]))
    assert api(mia, "get", "/calls/incoming", status=200)["call"]["id"] == made["id"]
    wait(clock, 20, (tom, made["id"]))
    assert api(mia, "get", "/calls/incoming", status=200)["call"] is None, "after 45 seconds it does not ring any more"
    assert api(tom, "post", f"/calls/{made['id']}/sync", status=200, data=b"")["call"]["reason"] == "missed"
    assert lines(mia, "tom")[-1] == "📞 Verpasster Anruf"
    assert any(p["body"] == "Verpasster Anruf von tom" for p in sent)
    assert api(mia, "post", f"/calls/{made['id']}/answer", status=410)["error"] == "call_over"


def test_declining_and_cancelling(pair, clock):
    tom, mia = pair
    made = api(tom, "post", "/calls", {"handle": "mia"}, status=201)["call"]
    api(mia, "post", f"/calls/{made['id']}/decline", status=200)
    assert api(tom, "post", f"/calls/{made['id']}/sync", status=200, data=b"")["call"]["reason"] == "declined"
    assert lines(tom, "mia")[-1] == "📞 Anruf abgelehnt"
    made = api(tom, "post", "/calls", {"handle": "mia"}, status=201)["call"]
    api(tom, "post", f"/calls/{made['id']}/hangup", status=200)
    assert api(mia, "get", "/calls/incoming", status=200)["call"] is None, "cancelled before it was answered"
    assert lines(mia, "tom")[-1] == "📞 Verpasster Anruf"


def test_a_person_who_went_quiet_has_left_and_the_call_ends(pair, clock):
    tom, mia = pair
    call_id = talking(tom, mia)
    sync(tom, call_id)
    sync(mia, call_id)
    clock.tick(10)
    sync(tom, call_id)
    clock.tick(10)                                                      # mia was silent for 20 seconds (a closed tab)
    assert api(tom, "post", f"/calls/{call_id}/sync", status=200, data=b"")["call"]["status"] == "ended"
    assert api(mia, "post", f"/calls/{call_id}/sync", status=200, data=b"")["call"]["reason"] == "ended"


def test_a_call_that_lasts_for_ever_ends_after_two_hours(pair, clock):
    tom, mia = pair
    call_id = talking(tom, mia)
    for _ in range(int(yipi_calls.MAX_CALL_SECONDS // 10) + 2):
        clock.tick(10)
        sync(tom, call_id)
        sync(mia, call_id)
        if yipi_calls.CALLS[call_id].status == "ended":
            break
    assert yipi_calls.CALLS[call_id].status == "ended" and yipi_calls.CALLS[call_id].reason == "timeout"


# ================================================================================================ one at a time
def test_one_call_at_a_time(client, clock):
    tom, mia, eva = person("tom"), person("mia"), person("eva")
    befriend(tom, "tom", mia, "mia")
    befriend(tom, "tom", eva, "eva")
    befriend(mia, "mia", eva, "eva")
    call_id = talking(tom, mia)
    again = api(tom, "post", "/calls", {"handle": "eva"}, status=409)
    assert again["error"] == "in_call" and again["call"]["id"] == call_id, "tom is taken back into the call he is in"
    assert api(eva, "post", "/calls", {"handle": "tom"}, status=409)["error"] == "busy"
    assert api(eva, "post", "/calls", {"handle": "mia"}, status=409)["error"] == "busy"
    assert api(mia, "get", "/calls/incoming", status=200)["active"]["id"] == call_id, "a page that was reloaded finds its call"


def test_the_limits_of_calls_are_counted(client, clock):
    tom, mia = person("tom"), person("mia")
    befriend(tom, "tom", mia, "mia")
    for _ in range(yipi.LIMITS["call-start"][0]):
        made = api(tom, "post", "/calls", {"handle": "mia"})
        assert made["ok"]
        api(tom, "post", f"/calls/{made['call']['id']}/hangup", status=200)
    assert api(tom, "post", "/calls", {"handle": "mia"}, status=429)["error"] == "too_many"


# ================================================================================================ groups
def group_of_three():
    mia, tom, ann = person("mia"), person("tom"), person("ann")
    befriend(mia, "mia", tom, "tom")
    befriend(mia, "mia", ann, "ann")
    group = api(mia, "post", "/groups", {"name": "Die Drei", "members": ["tom", "ann"]}, status=201)["group"]
    return mia, tom, ann, group


def test_a_group_call_rings_all_members_and_a_member_can_join_later(client, clock):
    mia, tom, ann, group = group_of_three()
    zoe = person("zoe")
    assert api(zoe, "post", "/calls", {"groupId": group["id"]}, status=404)["error"] == "not_found", "not a member"
    made = api(mia, "post", "/calls", {"groupId": group["id"]}, status=201)["call"]
    assert made["kind"] == "group" and made["group"]["name"] == "Die Drei" and sorted(p["handle"] for p in made["people"]) == ["ann", "mia", "tom"]
    assert api(tom, "get", "/calls/incoming", status=200)["call"]["group"]["name"] == "Die Drei" and api(ann, "get", "/calls/incoming", status=200)["call"]["id"] == made["id"]
    assert api(tom, "post", f"/calls/{made['id']}/answer", status=200)["call"]["status"] == "active"
    wait(clock, 60, (mia, made["id"]), (tom, made["id"]))               # the ringing is over but the group is talking: ann can still join
    assert api(ann, "get", "/calls/incoming", status=200)["call"] is None
    assert api(ann, "get", f"/calls/active?groupId={group['id']}", status=200)["call"]["id"] == made["id"]
    assert api(zoe, "get", f"/calls/active?groupId={group['id']}", status=200)["call"] is None
    sync(mia, made["id"])
    sync(tom, made["id"], b"\x97" * 20)                                   # said before ann came
    joined = api(ann, "post", "/calls", {"groupId": group["id"]}, status=201)["call"]
    assert joined["id"] == made["id"] and joined["me"] == "joined", "the same call"
    assert sync(ann, made["id"])["chunks"] == [], "ann hears only what is said after she came"
    sync(tom, made["id"], b"\x99" * 20)
    heard = sync(ann, made["id"])["chunks"]
    assert len(heard) == 1 and base64.b64decode(heard[0]["data"]) == b"\x99" * 20 and len(sync(mia, made["id"])["chunks"]) == 2
    sync(mia, made["id"], b"\x98" * 20)
    assert len(sync(ann, made["id"], after=heard[0]["seq"])["chunks"]) == 1 and len(sync(tom, made["id"], after=2)["chunks"]) == 1
    api(mia, "post", f"/calls/{made['id']}/hangup", status=200)
    assert api(tom, "post", f"/calls/{made['id']}/sync", status=200, data=b"")["call"]["status"] == "active", "two are left: the call goes on"
    api(tom, "post", f"/calls/{made['id']}/hangup", status=200)
    assert api(ann, "post", f"/calls/{made['id']}/sync", status=200, data=b"")["call"]["status"] == "ended"
    assert any(m["text"].startswith("📞 Gruppenanruf · ") for m in api(mia, "get", f"/groups/{group['id']}", status=200)["messages"])


def test_a_group_call_nobody_joins_is_missed_and_everybody_declining_ends_it(client, clock):
    mia, tom, ann, group = group_of_three()
    made = api(mia, "post", "/calls", {"groupId": group["id"]}, status=201)["call"]
    api(tom, "post", f"/calls/{made['id']}/decline", status=200)
    assert api(mia, "post", f"/calls/{made['id']}/sync", status=200, data=b"")["call"]["status"] == "ringing", "ann may still answer"
    api(ann, "post", f"/calls/{made['id']}/decline", status=200)
    assert api(mia, "post", f"/calls/{made['id']}/sync", status=200, data=b"")["call"]["reason"] == "declined"
    again = api(mia, "post", "/calls", {"groupId": group["id"]}, status=201)["call"]
    wait(clock, 50, (mia, again["id"]))
    assert api(tom, "get", "/calls/incoming", status=200)["call"] is None
    assert yipi_calls.CALLS[again["id"]].reason == "missed"
    assert any(m["text"] == "📞 Verpasster Gruppenanruf" for m in api(tom, "get", f"/groups/{group['id']}", status=200)["messages"])
