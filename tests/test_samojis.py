"""Satürn, 2026-11-16: Tokens and Samojis. Everybody starts with 5 Tokens; a Samoji is given as a present and costs between 1 and 220 Tokens; the receiver gets as many Tokens as the giver paid; there are
more than a thousand of them, all different; the Tokens cannot be spent twice or below zero; a present in a chat is a message that only the server can write."""
import os
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_samojis as samojis  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


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
    who = flask_app.test_client()
    assert who.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return who


def test_there_are_more_than_a_thousand_different_samojis_with_prices_from_one_up():
    assert len(samojis.CATALOGUE) >= 1000 and len({item[1:4] for item in samojis.CATALOGUE}) == len(samojis.CATALOGUE), "every one is different"
    prices = [item[4] for item in samojis.CATALOGUE]
    assert min(prices) == 1 and max(prices) > 100 and len(set(prices)) > 30, "different prices"
    assert samojis.find(1) is not None and samojis.find(0) is None and samojis.find("x") is None and samojis.find(len(samojis.CATALOGUE) + 1) is None
    assert len({samojis.name(item) for item in samojis.CATALOGUE}) == len(samojis.CATALOGUE), "and every one has its own name"


def test_everybody_starts_with_five_tokens_and_the_list_comes_with_the_balance(client):
    mia = person("mia")
    listing = mia.get("/api/yipi/samojis").get_json()
    assert listing["ok"] and listing["tokens"] == 5 and len(listing["items"]) == len(samojis.CATALOGUE) and listing["shapes"] and listing["palettes"] and listing["badges"]
    assert mia.get("/api/yipi/users/mia").get_json()["user"]["tokens"] == 5


def test_a_present_moves_the_tokens_to_the_receiver_and_cannot_be_afforded_twice(client):
    mia, tom = person("mia"), person("tom")
    cheap = min(samojis.CATALOGUE, key=lambda item: (item[4], item[0]))
    price = cheap[4]
    reply = mia.post("/api/yipi/samojis/send", json={"id": cheap[0], "to": "tom"})
    assert reply.status_code == 200 and reply.get_json()["tokens"] == 5 - price
    assert tom.get("/api/yipi/users/tom").get_json()["user"]["tokens"] == 5 + price, "the receiver gets as many Tokens as the giver paid"
    dear = max(samojis.CATALOGUE, key=lambda item: item[4])
    broke = mia.post("/api/yipi/samojis/send", json={"id": dear[0], "to": "tom"})
    assert broke.status_code == 400 and broke.get_json()["error"] == "not_enough_tokens"
    assert mia.get("/api/yipi/users/mia").get_json()["user"]["tokens"] == 5 - price, "nothing was taken"
    for who, body in ((mia, {"id": cheap[0], "to": "mia"}), (mia, {"id": 999999, "to": "tom"}), (mia, {"id": cheap[0], "to": "nobody"}), (mia, {"id": cheap[0], "to": "tom", "post": 12345})):
        assert who.post("/api/yipi/samojis/send", json=body).status_code in (400, 404), body
    assert flask_app.test_client().post("/api/yipi/samojis/send", json={"id": 1, "to": "tom"}).status_code == 401


def test_a_present_for_a_video_and_in_a_chat(client):
    mia, tom = person("mia"), person("tom")
    post = tom.post("/api/yipi/posts", json={"text": "hallo"}).get_json()["post"]
    assert mia.post("/api/yipi/samojis/send", json={"id": 1, "to": "tom", "post": post["id"]}).status_code == 200
    assert yipi.YipiGift.query.filter_by(post_id=post["id"]).count() == 1
    assert mia.post("/api/yipi/samojis/send", json={"id": 1, "to": "mia", "post": post["id"]}).status_code == 400
    # in a chat the present is a message
    assert mia.post("/api/yipi/users/tom/follow").status_code == 200 and tom.post("/api/yipi/users/mia/follow").status_code == 200
    sent = mia.post("/api/yipi/samojis/send", json={"id": 1, "to": "tom", "chat": "dm"})
    assert sent.status_code == 200
    texts = [m["text"] for m in tom.get("/api/yipi/messages/mia").get_json()["messages"]]
    assert samojis.message_text(1) in texts
    # a normal message cannot carry the sign of a present
    fake = mia.post("/api/yipi/messages/tom", json={"text": samojis.message_text(900)})
    stored = [m["text"] for m in tom.get("/api/yipi/messages/mia").get_json()["messages"]]
    assert fake.status_code in (201, 400) and samojis.message_text(900) not in stored, "the sign of a present is stripped or refused: it never makes a free Samoji"


def test_the_page_has_the_sheet_the_drawings_and_the_buttons():
    read = lambda *parts: open(os.path.join(ROOT, *parts), encoding="utf-8").read()  # noqa: E731
    page, chats, videos, components = read("static", "js", "yipi-samoji.js"), read("static", "js", "yipi-chats.js"), read("static", "js", "yipi-videos.js"), read("static", "js", "yipi-components.js")
    assert "yipi-samoji.js" in yipi.PULSE_SCRIPTS and "innerHTML" not in page and "Senden für" in page and "Der Empfänger bekommt genauso viele Tokens." in page
    assert "Y.samoji.open({ to: route.handle, chat: \"dm\"" in chats and "Y.samoji.bubble(" in chats and "Y.samoji.open({ to: item.user.handle, post: item.id })" in videos and "Samoji schenken" in components
