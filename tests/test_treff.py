"""Treff: groups where everybody can talk, without an account.  The numbers of six digits and their keys, the groups, the messages
(answers, reactions, "Wichtig!"), the facts ("Fakten!"), reports and the person who looks after the site, and the pages around it."""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import treff  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    treff._hits.clear()
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


class Browser:
    """A browser that is (or is not yet) somebody: it keeps its key like the page does."""

    def __init__(self, identify=True):
        self.client = flask_app.test_client()
        self.key = None
        self.number = None
        if identify:
            self.identify()

    def identify(self):
        r = self.client.post("/api/treff/identity", json={})
        assert r.status_code == 200, r.get_json()
        data = r.get_json()
        self.key, self.number = data["key"], data["number"]
        return data

    def call(self, method, path, body=None, **kwargs):
        headers = dict(kwargs.pop("headers", {}))
        if self.key:
            headers["X-Treff-Key"] = self.key
        send = getattr(self.client, method)
        return send(f"/api/treff{path}", json=body, headers=headers, **kwargs) if body is not None else send(f"/api/treff{path}", headers=headers, **kwargs)

    def get(self, path, **kw):
        return self.call("get", path, **kw)

    def post(self, path, body=None, **kw):
        return self.call("post", path, {} if body is None else body, **kw)

    def patch(self, path, body=None, **kw):
        return self.call("patch", path, {} if body is None else body, **kw)

    def delete(self, path, **kw):
        return self.call("delete", path, **kw)

    def group(self, name="Minecraft Server", **extra):
        r = self.post("/groups", {"name": name, **extra})
        assert r.status_code == 201, r.get_json()
        return r.get_json()["group"]

    def say(self, group, text="Hallo zusammen", **extra):
        r = self.post(f"/groups/{group['id']}/messages", {"text": text, **extra})
        assert r.status_code == 201, r.get_json()
        return r.get_json()["message"]


def error(response):
    return response.get_json()["error"]


# ------------------------------------------------------------------------------------------------ numbers
def test_a_browser_gets_a_number_of_six_digits_and_a_key_and_the_server_keeps_only_a_hash(client):
    data = Browser(identify=False).identify()
    assert 100000 <= data["number"] <= 999999 and len(str(data["number"])) == 6 and len(data["key"]) >= 30
    with flask_app.app_context():
        user = treff.TreffUser.query.one()
        assert user.number == data["number"] and data["key"] not in user.key_hash and user.key_hash == treff.key_hash(data["key"])


def test_nobody_gets_the_same_number_twice(client):
    numbers = {Browser().number for _ in range(7)}
    assert len(numbers) == 7


def test_the_same_browser_keeps_its_number_and_a_wrong_key_is_nobody(client):
    me = Browser()
    again = me.post("/identity").get_json()
    assert again["number"] == me.number and "key" not in again, "the key is shown only once"
    assert me.get("/me").get_json()["number"] == me.number
    stranger = Browser(identify=False)
    stranger.key = "not-a-real-key"
    assert stranger.get("/me").get_json()["number"] is None
    assert error(stranger.post("/groups", {"name": "Test group"})) == "need_identity"


def test_a_visitor_who_only_reads_gets_no_number_and_no_cookie(client):
    r = client.get("/api/treff/groups")
    assert r.status_code == 200 and r.get_json()["me"] is None
    assert "Set-Cookie" not in r.headers
    with flask_app.app_context():
        assert treff.TreffUser.query.count() == 0


def test_making_numbers_cannot_be_used_to_use_them_all_up(client):
    codes = [flask_app.test_client().post("/api/treff/identity", json={}).status_code for _ in range(10)]
    assert codes[:8] == [200] * 8 and codes[8] == 429


def test_when_all_numbers_are_taken_nobody_gets_a_wrong_one(client, monkeypatch):
    monkeypatch.setattr(treff, "NUMBER_LOW", 500000)
    monkeypatch.setattr(treff, "NUMBER_HIGH", 500002)
    got = sorted(Browser().number for _ in range(3))
    assert got == [500000, 500001, 500002]
    assert flask_app.test_client().post("/api/treff/identity", json={}).status_code == 503


# ------------------------------------------------------------------------------------------------- groups
def test_a_group_is_made_and_listed_with_everybody_seeing_it(client):
    mia = Browser()
    group = mia.group("Minecraft Server", description="Alles zu unserem Server")
    assert group["name"] == "Minecraft Server" and group["creator"] == mia.number and group["mine"] and group["slug"] == "minecraft-server"
    reader = Browser(identify=False)
    listed = reader.get("/groups").get_json()["groups"]
    assert [g["name"] for g in listed] == ["Minecraft Server"] and not listed[0]["mine"] and listed[0]["messageCount"] == 0 and listed[0]["last"] is None
    one = reader.get(f"/groups/{group['id']}").get_json()
    assert one["group"]["description"] == "Alles zu unserem Server" and one["facts"] == []


def test_names_of_groups_have_rules_and_are_used_once(client):
    mia = Browser()
    for bad in ("a", "x" * 41, "", "   ", None, 5):
        assert error(mia.post("/groups", {"name": bad})) == "bad_name", bad
    assert error(mia.post("/groups", {"name": "Okay", "description": "x" * 301})) == "bad_description"
    assert mia.group("  Mein   Thema \n")["name"] == "Mein Thema", "spaces and line breaks are tidied"
    other = Browser()
    r = other.post("/groups", {"name": "MEIN thema"})
    assert r.status_code == 409 and error(r) == "name_taken", "the same name in other letters is the same name"


def test_groups_can_be_sorted_and_searched(client):
    mia = Browser()
    a = mia.group("Alpha", description="Fußball und mehr")
    b = mia.group("Beta 100%")
    c = mia.group("Gamma")
    mia.say(b, "eins"); mia.say(b, "zwei"); mia.say(a, "drei")
    names = lambda path: [g["name"] for g in mia.get(path).get_json()["groups"]]
    assert names("/groups?sort=active")[0] == "Alpha", "the last one who got a message comes first"
    assert names("/groups?sort=top")[0] == "Beta 100%"
    assert names("/groups?sort=new")[0] == "Gamma"
    assert names("/groups?q=fußball") == ["Alpha"], "the description is searched too, in any case"
    assert names("/groups?q=100%") == ["Beta 100%"] and names("/groups?q=%") == ["Beta 100%"], "% is a character, not a wildcard"
    assert names("/groups?q=_") == [] and names("/groups?q=nichts") == []
    assert c["id"] != a["id"]


def test_only_the_one_who_made_a_group_changes_or_deletes_it(client):
    mia, tom = Browser(), Browser()
    group = mia.group("Alte Gruppe")
    assert tom.patch(f"/groups/{group['id']}", {"description": "Meine"}).status_code == 403
    assert tom.delete(f"/groups/{group['id']}").status_code == 403
    changed = mia.patch(f"/groups/{group['id']}", {"name": "Neue Gruppe", "description": "Besser", "factsOpen": False}).get_json()["group"]
    assert changed["name"] == "Neue Gruppe" and changed["description"] == "Besser" and changed["factsOpen"] is False
    mia.group("Besetzt")
    assert error(mia.patch(f"/groups/{group['id']}", {"name": "besetzt"})) == "name_taken"
    assert mia.patch(f"/groups/{group['id']}", {"name": "NEUE gruppe"}).status_code == 200, "its own name is no problem"
    mia.say(group, "Hallo")
    assert mia.delete(f"/groups/{group['id']}").status_code == 200
    assert mia.get(f"/groups/{group['id']}").status_code == 404
    with flask_app.app_context():
        assert treff.TreffMessage.query.count() == 0


def test_making_too_many_groups_is_stopped(client):
    mia = Browser()
    codes = [mia.post("/groups", {"name": f"Gruppe {i}"}).status_code for i in range(6)]
    assert codes[:4] == [201] * 4 and codes[4] == 429


# ----------------------------------------------------------------------------------------------- messages
def test_messages_are_written_by_numbers_and_come_back_in_order(client):
    mia, tom = Browser(), Browser()
    group = mia.group()
    first = mia.say(group, "Wer kommt heute?")
    second = tom.say(group, "Ich!", replyTo=first["id"])
    assert first["user"] == mia.number and first["mine"] is True
    assert second["user"] == tom.number and second["replyTo"] == {"id": first["id"], "user": mia.number, "text": "Wer kommt heute?", "deleted": False}
    seen_by_tom = tom.get(f"/groups/{group['id']}/messages").get_json()
    assert [m["text"] for m in seen_by_tom["messages"]] == ["Wer kommt heute?", "Ich!"] and [m["mine"] for m in seen_by_tom["messages"]] == [False, True]
    assert seen_by_tom["hasMore"] is False
    reader = Browser(identify=False).get(f"/groups/{group['id']}/messages").get_json()["messages"]
    assert all(not m["mine"] for m in reader), "somebody without a number owns nothing"
    listed = tom.get("/groups").get_json()["groups"][0]
    assert listed["messageCount"] == 2 and listed["last"]["text"] == "Ich!" and listed["last"]["user"] == tom.number


def test_text_has_rules_and_is_kept_as_written_for_the_page_to_show_as_text(client):
    mia = Browser()
    group = mia.group()
    for bad in ("", "   ", None, 5, "x" * 2001):
        assert error(mia.post(f"/groups/{group['id']}/messages", {"text": bad})) == "bad_text", bad
    assert error(mia.post(f"/groups/{group['id']}/messages", {"text": " ".join(f"https://example.com/{i}" for i in range(7))})) == "too_many_links"
    assert mia.say(group, " ".join(f"https://example.com/{i}" for i in range(6)))["id"]
    html = mia.say(group, "<script>alert(1)</script> <b>fett</b>")
    assert html["text"] == "<script>alert(1)</script> <b>fett</b>", "the server does not guess: the page only ever shows it as text"
    assert mia.say(group, "a‮b\u0000c\n\n\n\nd")["text"] == "abc\n\nd", "control and direction characters are removed, blank lines shortened"
    assert mia.say(group, "x" * 2000)["text"] == "x" * 2000


def test_answers_must_stay_in_their_group(client):
    mia = Browser()
    one, two = mia.group("Eins"), mia.group("Zwei")
    message = mia.say(one)
    for bad in (message["id"] + 99, "1", True, -1):
        assert error(mia.post(f"/groups/{one['id']}/messages", {"text": "Antwort", "replyTo": bad})) == "bad_reply", bad
    assert error(mia.post(f"/groups/{two['id']}/messages", {"text": "Antwort", "replyTo": message["id"]})) == "bad_reply"
    assert mia.post("/groups/99999/messages", {"text": "Hallo"}).status_code == 404


def test_messages_come_in_pages_and_new_ones_by_after(client):
    mia = Browser()
    group = mia.group()
    ids = []
    for i in range(7):
        ids.append(mia.say(group, f"Nachricht {i}")["id"])
        treff._hits.clear()                                                          # (the limit on writing is tested elsewhere)
    path = f"/groups/{group['id']}/messages"
    latest = mia.get(f"{path}?limit=3").get_json()
    assert [m["id"] for m in latest["messages"]] == ids[-3:] and latest["hasMore"] is True
    older = mia.get(f"{path}?limit=3&before={ids[-3]}").get_json()
    assert [m["id"] for m in older["messages"]] == ids[1:4] and older["hasMore"] is True
    oldest = mia.get(f"{path}?limit=3&before={ids[1]}").get_json()
    assert [m["id"] for m in oldest["messages"]] == ids[:1] and oldest["hasMore"] is False
    new = mia.get(f"{path}?after={ids[4]}").get_json()
    assert [m["id"] for m in new["messages"]] == ids[5:]
    assert mia.get(f"{path}?after={ids[-1]}").get_json()["messages"] == []
    assert mia.get(f"{path}?limit=abc&after=x").status_code == 200


def test_reactions_are_switched_on_and_off_and_only_the_known_ones_exist(client):
    mia, tom = Browser(), Browser()
    group = mia.group()
    message = mia.say(group)
    path = f"/messages/{message['id']}/react"
    assert error(tom.post(path, {"emoji": "💩"})) == "bad_emoji" and error(tom.post(path, {"emoji": 5})) == "bad_emoji"
    after = tom.post(path, {"emoji": "👍"}).get_json()["message"]
    assert after["reactions"] == [{"emoji": "👍", "count": 1, "mine": True}]
    mia.post(path, {"emoji": "👍"}); mia.post(path, {"emoji": "❤️"})
    seen = mia.get(f"/groups/{group['id']}/messages").get_json()["messages"][0]["reactions"]
    assert seen == [{"emoji": "👍", "count": 2, "mine": True}, {"emoji": "❤️", "count": 1, "mine": True}]
    assert tom.post(path, {"emoji": "👍"}).get_json()["message"]["reactions"][0] == {"emoji": "👍", "count": 1, "mine": False}, "a second tap takes it back"
    assert Browser(identify=False).post(path, {"emoji": "👍"}).status_code == 401


def test_important_messages_are_marked_by_their_writer_or_the_one_who_made_the_group(client):
    mia, tom, eve = Browser(), Browser(), Browser()
    group = mia.group()
    plain = tom.say(group, "Normal")
    urgent = tom.say(group, "Neustart um 20 Uhr", important=True)
    assert urgent["important"] is True and plain["important"] is False
    assert eve.post(f"/messages/{plain['id']}/important", {"on": True}).status_code == 403
    assert tom.post(f"/messages/{plain['id']}/important", {"on": True}).get_json()["message"]["important"] is True
    assert mia.post(f"/messages/{plain['id']}/important", {"on": False}).get_json()["message"]["important"] is False, "the one who made the group may too"
    only = mia.get(f"/groups/{group['id']}/messages?important=1").get_json()["messages"]
    assert [m["id"] for m in only] == [urgent["id"]]
    feed = Browser(identify=False).get("/important").get_json()["messages"]
    assert [m["id"] for m in feed] == [urgent["id"]] and feed[0]["group"]["name"] == "Minecraft Server" and feed[0]["group"]["slug"] == "minecraft-server"
    assert mia.get("/groups").get_json()["groups"][0]["last"]["important"] is True, "the last message of the group is the urgent one"


def test_a_message_is_deleted_by_its_writer_or_by_the_one_who_made_the_group_and_nobody_else(client):
    mia, tom, eve = Browser(), Browser(), Browser()
    group = mia.group()
    message = tom.say(group, "Das gehört mir", important=True)
    answer = mia.say(group, "Antwort", replyTo=message["id"])
    tom.post(f"/messages/{message['id']}/react", {"emoji": "👍"})
    assert eve.delete(f"/messages/{message['id']}").status_code == 403
    gone = tom.delete(f"/messages/{message['id']}").get_json()["message"]
    assert gone["deleted"] is True and gone["text"] == "" and gone["important"] is False and gone["reactions"] == []
    listed = mia.get(f"/groups/{group['id']}/messages").get_json()["messages"]
    assert listed[0]["deleted"] and listed[1]["replyTo"] == {"id": message["id"], "user": tom.number, "text": "", "deleted": True}
    assert mia.get("/important").get_json()["messages"] == []
    assert mia.delete(f"/messages/{answer['id']}").status_code == 200
    other = tom.say(group, "Noch eine")
    assert mia.delete(f"/messages/{other['id']}").status_code == 200, "the one who made the group deletes what others wrote"
    assert tom.post(f"/messages/{message['id']}/react", {"emoji": "👍"}).status_code == 404


def test_writing_too_fast_is_stopped(client):
    mia = Browser()
    group = mia.group()
    codes = [mia.post(f"/groups/{group['id']}/messages", {"text": f"Nachricht {i}"}).status_code for i in range(10)]
    assert codes[:8] == [201] * 8 and codes[8] == 429


# ------------------------------------------------------------------------------------------------- facts
def test_facts_are_kept_for_the_whole_group(client):
    mia, tom = Browser(), Browser()
    group = mia.group()
    fact = tom.post(f"/groups/{group['id']}/facts", {"title": "Server-Adresse", "value": "play.example.net:25565"})
    assert fact.status_code == 201
    data = fact.get_json()["fact"]
    assert data["title"] == "Server-Adresse" and data["value"] == "play.example.net:25565" and data["user"] == tom.number and data["mine"] and data["canDelete"]
    seen = Browser(identify=False).get(f"/groups/{group['id']}").get_json()
    assert [f["title"] for f in seen["facts"]] == ["Server-Adresse"] and seen["group"]["factCount"] == 1 and not seen["facts"][0]["canDelete"]
    assert mia.get(f"/groups/{group['id']}").get_json()["facts"][0]["canDelete"] is True, "the one who made the group may delete every fact"
    assert error(tom.post(f"/groups/{group['id']}/facts", {"title": "", "value": "x"})) == "bad_title"
    assert error(tom.post(f"/groups/{group['id']}/facts", {"title": "x" * 61, "value": "x"})) == "bad_title"
    assert error(tom.post(f"/groups/{group['id']}/facts", {"title": "Titel", "value": ""})) == "bad_value"
    assert error(tom.post(f"/groups/{group['id']}/facts", {"title": "Titel", "value": "x" * 601})) == "bad_value"
    assert Browser(identify=False).post(f"/groups/{group['id']}/facts", {"title": "A", "value": "B"}).status_code == 401


def test_a_group_can_keep_the_facts_to_the_one_who_made_it(client):
    mia, tom = Browser(), Browser()
    group = mia.group(factsOpen=False)
    assert group["factsOpen"] is False
    r = tom.post(f"/groups/{group['id']}/facts", {"title": "Titel", "value": "Wert"})
    assert r.status_code == 403 and error(r) == "facts_closed"
    assert mia.post(f"/groups/{group['id']}/facts", {"title": "Titel", "value": "Wert"}).status_code == 201
    mia.patch(f"/groups/{group['id']}", {"factsOpen": True})
    assert tom.post(f"/groups/{group['id']}/facts", {"title": "Zwei", "value": "Wert"}).status_code == 201


def test_facts_are_changed_and_deleted_by_their_writer_or_the_one_who_made_the_group(client):
    mia, tom, eve = Browser(), Browser(), Browser()
    group = mia.group()
    fact = tom.post(f"/groups/{group['id']}/facts", {"title": "Alt", "value": "Alt"}).get_json()["fact"]
    assert eve.patch(f"/facts/{fact['id']}", {"title": "Hack"}).status_code == 403 and eve.delete(f"/facts/{fact['id']}").status_code == 403
    assert tom.patch(f"/facts/{fact['id']}", {"title": "Neu", "value": "Neuer Wert"}).get_json()["fact"]["title"] == "Neu"
    assert error(tom.patch(f"/facts/{fact['id']}", {"title": ""})) == "bad_title"
    assert mia.delete(f"/facts/{fact['id']}").status_code == 200
    assert mia.get(f"/groups/{group['id']}").get_json()["group"]["factCount"] == 0
    assert mia.delete(f"/facts/{fact['id']}").status_code == 404


def test_a_group_holds_at_most_sixty_facts(client):
    mia = Browser()
    group = mia.group()
    for i in range(60):
        treff._hits.clear()
        assert mia.post(f"/groups/{group['id']}/facts", {"title": f"Fakt {i}", "value": "x"}).status_code == 201
    treff._hits.clear()
    r = mia.post(f"/groups/{group['id']}/facts", {"title": "Zu viel", "value": "x"})
    assert r.status_code == 409 and error(r) == "too_many_facts"


# ------------------------------------------------------------------------------------------------ reports
def test_reports_need_a_number_and_a_real_target(client):
    mia, tom = Browser(), Browser()
    group = mia.group()
    message = mia.say(group, "Böse")
    assert Browser(identify=False).post("/report", {"kind": "message", "id": message["id"]}).status_code == 401
    assert tom.post("/report", {"kind": "message", "id": 99999}).status_code == 404
    assert tom.post("/report", {"kind": "unknown", "id": 1}).status_code == 404
    assert error(tom.post("/report", {"kind": "message", "id": message["id"], "reason": "x" * 201})) == "bad_reason"
    assert tom.post("/report", {"kind": "message", "id": message["id"], "reason": "Beleidigung"}).status_code == 200
    assert tom.post("/report", {"kind": "message", "id": message["id"]}).status_code == 200
    with flask_app.app_context():
        assert treff.TreffReport.query.count() == 1, "the same person reports the same thing once"


def test_the_person_who_looks_after_the_site_deletes_what_was_reported(client, monkeypatch):
    mia, tom = Browser(), Browser()
    group = mia.group("Böse Gruppe")
    message = mia.say(group, "Etwas Schlimmes")
    fact = mia.post(f"/groups/{group['id']}/facts", {"title": "Schlimm", "value": "Auch schlimm"}).get_json()["fact"]
    other = mia.group("Gute Gruppe")
    for kind, target in (("message", message["id"]), ("fact", fact["id"]), ("group", other["id"])):
        tom.post("/report", {"kind": kind, "id": target, "reason": "Spam"})
    header = {"X-Treff-Admin": "geheim"}
    assert tom.get("/admin/reports", headers=header).status_code == 404, "without a token set the page does not exist"
    monkeypatch.setenv("TREFF_ADMIN_TOKEN", "geheim")
    assert tom.get("/admin/reports").status_code == 403 and tom.get("/admin/reports", headers={"X-Treff-Admin": "falsch"}).status_code == 403
    reports = tom.get("/admin/reports", headers=header).get_json()["reports"]
    assert sorted(r["kind"] for r in reports) == ["fact", "group", "message"] and reports[0]["reason"] == "Spam"
    by_kind = {r["kind"]: r for r in reports}
    assert tom.post(f"/admin/reports/{by_kind['message']['id']}", {"action": "delete"}, headers=header).status_code == 200
    assert tom.post(f"/admin/reports/{by_kind['fact']['id']}", {"action": "delete"}, headers=header).status_code == 200
    assert tom.post(f"/admin/reports/{by_kind['group']['id']}", {"action": "dismiss"}, headers=header).status_code == 200
    assert error(tom.post(f"/admin/reports/{by_kind['group']['id']}", {"action": "nonsense"}, headers=header)) == "bad_action"
    assert tom.get("/admin/reports", headers=header).get_json()["reports"] == []
    assert mia.get(f"/groups/{group['id']}/messages").get_json()["messages"][0]["deleted"] is True
    assert mia.get(f"/groups/{group['id']}").get_json()["facts"] == []
    assert mia.get(f"/groups/{other['id']}").status_code == 200, "dismissed: the group stays"
    tom.post("/report", {"kind": "group", "id": other["id"]})
    report = tom.get("/admin/reports", headers=header).get_json()["reports"][0]
    tom.post(f"/admin/reports/{report['id']}", {"action": "delete"}, headers=header)
    assert mia.get(f"/groups/{other['id']}").status_code == 404


def test_guessing_the_admin_word_is_stopped(client, monkeypatch):
    monkeypatch.setenv("TREFF_ADMIN_TOKEN", "geheim")
    codes = [client.get("/api/treff/admin/reports", headers={"X-Treff-Admin": f"x{i}"}).status_code for i in range(32)]
    assert codes[0] == 403 and codes[-1] == 429


# --------------------------------------------------------------------------------------- the pages around
def test_only_this_site_may_change_things_and_only_with_json(client):
    r = client.post("/api/treff/identity", json={}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert client.post("/api/treff/identity", data="x=1", headers={"Content-Type": "text/plain"}).status_code == 415 or client.post("/api/treff/identity", json={}).status_code == 200
    mia = Browser()
    assert mia.client.post("/api/treff/groups", data="name=x", headers={"Content-Type": "text/plain", "X-Treff-Key": mia.key}).status_code == 415


def test_the_home_page_is_treff_with_a_strict_policy_and_no_cookie(client):
    response = client.get("/")
    text = response.get_data(as_text=True)
    assert response.status_code == 200 and 'id="app"' in text and "treff-core.js" in text and "yipiBoot" not in text
    assert "Set-Cookie" not in response.headers
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "'unsafe-inline'" not in csp.split("style-src")[0] and "frame-ancestors 'none'" in csp
    assert response.headers["X-Frame-Options"] == "DENY" and response.headers["Permissions-Policy"].startswith("camera=()")
    assert client.get("/", headers={"X-Forwarded-Proto": "https"}).headers["Strict-Transport-Security"].startswith("max-age=")


def test_a_group_address_shows_its_name_for_sharing_and_a_missing_one_is_a_404(client):
    group = Browser().group('<b>Böse</b> "Name" & Co')
    page = client.get(f"/g/{group['id']}/irgendwas")
    text = page.get_data(as_text=True)
    assert page.status_code == 200 and "<b>Böse</b>" not in text and "&lt;b&gt;Böse&lt;/b&gt;" in text
    assert 'property="og:title" content="&lt;b&gt;' in text and f'href="{"http://localhost"}/g/{group["id"]}"' in text
    assert client.get(f"/g/{group['id']}").status_code == 200
    missing = client.get("/g/99999")
    assert missing.status_code == 404 and "Treff" in missing.get_data(as_text=True)
    admin = client.get("/treff-admin")
    assert admin.status_code == 200 and admin.headers["X-Robots-Tag"] == "noindex"


def test_the_manifest_and_the_images_exist(client):
    data = client.get("/manifest.webmanifest").get_json()
    assert data["short_name"] == "Treff" and data["start_url"] == "/" and data["display"] == "standalone"
    assert {icon["purpose"] for icon in data["icons"]} == {"any", "maskable"}
    for icon in data["icons"]:
        assert client.get(icon["src"]).status_code == 200, icon["src"]
    for name in ("treff-icon.svg", "treff-180.png", "treff-og.png"):
        assert client.get(f"/static/img/{name}").status_code == 200, name


def test_the_old_home_pages_are_still_there_and_the_site_pages_are_treffs(client):
    assert b"yipiBoot" in client.get("/yipi-archiv").data and b"gomatData" in client.get("/gomat-archiv").data
    for path, words in (("/datenschutz", ("Treff", "treff.key", "keine Cookies", "yipi_session")), ("/impressum", ("§ 5 DDG", "Melden")), ("/nutzungsbedingungen", ("Treff", "16 Jahren", "yipi"))):
        page = client.get(path)
        text = page.get_data(as_text=True)
        assert page.status_code == 200 and "| Treff</title>" in text, path
        for word in words:
            assert word in text, (path, word)
    error_page = client.get("/gibt-es-nicht-1234")
    assert error_page.status_code == 404 and "Treff" in error_page.get_data(as_text=True)
    assert "Disallow: /treff-admin" in client.get("/robots.txt").get_data(as_text=True)
