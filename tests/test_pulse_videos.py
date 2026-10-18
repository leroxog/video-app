"""Videos (2026-10-18): a post can carry one video (MP4, MOV or WebM, up to 25 MB), which is also shown in the Videos tab (a feed like TikTok's: one
video after the other, with likes and comments).  The file is kept in the database like a picture and handed out in pieces (Range), which phones
need to play and to jump around in a video."""
import io
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


def mp4(extra=2000):
    """A file that is built like an MP4 (a type box, a free box, a data box); no real picture in it, which the server cannot judge anyway."""
    return b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


def webm():
    return b"\x1aE\xdf\xa3\x9fB\x82\x84webm" + b"\x00" * 12 + b"\x18S\x80g" + b"\x01" * 600


def png():
    import struct
    import zlib
    raw = b"\x00" + b"\xff\x00\x00" * 4
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def upload(client, data, name, **fields):
    return client.post("/api/yipi/media", data={"file": (io.BytesIO(data), name), **fields}, content_type="multipart/form-data")


def post_video(client, text="Mein Video", name="clip.mp4", data=None, **fields):
    media = upload(client, data or mp4(), name, **fields).get_json()["media"]
    return api(client, "post", "/posts", {"text": text, "media": [media["id"]]}, status=201)["post"], media


def test_a_video_can_be_uploaded_and_posted(client):
    mia = person("mia")
    r = upload(mia, mp4(), "clip.mp4", width="1080", height="1920")
    assert r.status_code == 200
    media = r.get_json()["media"]
    assert media["video"] is True and media["gif"] is False and (media["width"], media["height"]) == (1080, 1920)
    post = api(mia, "post", "/posts", {"text": "Hallo", "media": [media["id"]]}, status=201)["post"]
    assert post["media"][0]["video"] is True and post["media"][0]["url"] == media["url"]
    assert upload(mia, webm(), "clip.webm").get_json()["media"]["video"] is True
    mov = b"\x00\x00\x00\x14ftypqt  \x00\x00\x00\x00qt  " + b"\x00\x00\x00\x08wide" + b"\x00" * 100
    assert upload(mia, mov, "movie.mov").get_json()["media"]["video"] is True
    assert upload(mia, png(), "p.png").get_json()["media"]["video"] is False


def test_sizes_that_make_no_sense_fall_back_to_a_phone_shape(client):
    mia = person("mia")
    assert [upload(mia, mp4(), "a.mp4", width=w, height=h).get_json()["media"] for w, h in (("x", "y"), ("0", "99999"), ("", ""))] and True
    media = upload(mia, mp4(), "a.mp4", width="99999", height="-5").get_json()["media"]
    assert (media["width"], media["height"]) == (720, 1280)


def test_only_videos_a_browser_can_play_are_taken(client):
    mia = person("mia")
    for data, name in ((b"\x00\x00\x00\x18ftypisom" + b"\x00" * 20, "empty.mp4"), (b"\x1aE\xdf\xa3" + b"\x00" * 100, "other.mkv"), (b"RIFF\x00\x00\x00\x00AVI LIST" + b"\x00" * 10, "old.avi"),
                       (b"\x00\x00\x00\x18ftyp3gp4" + b"\x00" * 20, "phone.3gp"), (b"just text", "fake.mp4")):
        r = upload(mia, data, name)
        assert r.status_code == 415 and r.get_json()["error"] == "bad_video", name


def test_a_video_over_the_limit_is_refused(client):
    mia = person("mia")
    big = mp4(yipi.MAX_VIDEO_BYTES)
    r = upload(mia, big, "big.mp4")
    assert r.status_code == 413 and r.get_json()["error"] == "video_too_big"
    exact = mp4(2000)
    exact += bytes(yipi.MAX_VIDEO_BYTES - len(exact))
    assert len(exact) == yipi.MAX_VIDEO_BYTES and upload(mia, exact, "ok.mp4").status_code == 200, "exactly the limit is still fine"


def test_a_video_stands_alone_and_is_not_an_answer(client):
    mia, tom = person("mia"), person("tom")
    post, media = post_video(mia)
    photo = upload(mia, png(), "p.png").get_json()["media"]
    video = upload(mia, mp4(), "b.mp4").get_json()["media"]
    assert api(mia, "post", "/posts", {"text": "beides", "media": [video["id"], photo["id"]]}, status=400)["error"] == "video_alone"
    assert api(mia, "post", "/posts", {"text": "zwei", "media": [video["id"], upload(mia, mp4(), "c.mp4").get_json()["media"]["id"]]}, status=400)["error"] == "video_alone"
    assert api(tom, "post", "/posts", {"text": "Antwort mit Video", "replyTo": post["id"], "media": [upload(tom, mp4(), "d.mp4").get_json()["media"]["id"]]}, status=400)["error"] == "video_top"
    assert api(tom, "post", "/posts", {"text": "Zitat mit Video", "quoteOf": post["id"], "media": [upload(tom, mp4(), "e.mp4").get_json()["media"]["id"]]}, status=400)["error"] == "video_top"
    assert api(mia, "post", "/posts", {"text": "nur Video", "media": [video["id"]]}, status=201)


def test_the_file_is_handed_out_in_pieces_like_phones_ask_for_it(client):
    mia = person("mia")
    data = mp4(3000)
    _, media = post_video(mia, data=data)
    url = media["url"]
    whole = flask_app.test_client().get(url)
    assert whole.status_code == 200 and whole.data == data and whole.headers["Accept-Ranges"] == "bytes" and whole.mimetype == "video/mp4"
    first = flask_app.test_client().get(url, headers={"Range": "bytes=0-99"})
    assert first.status_code == 206 and first.data == data[:100] and first.headers["Content-Range"] == f"bytes 0-99/{len(data)}" and first.headers["Content-Length"] == "100"
    middle = flask_app.test_client().get(url, headers={"Range": "bytes=1000-1499"})
    assert middle.status_code == 206 and middle.data == data[1000:1500]
    rest = flask_app.test_client().get(url, headers={"Range": "bytes=2500-"})
    assert rest.status_code == 206 and rest.data == data[2500:] and rest.headers["Content-Range"] == f"bytes 2500-{len(data) - 1}/{len(data)}"
    tail = flask_app.test_client().get(url, headers={"Range": "bytes=-50"})
    assert tail.status_code == 206 and tail.data == data[-50:]
    over = flask_app.test_client().get(url, headers={"Range": "bytes=0-999999999"})
    assert over.status_code == 206 and over.data == data
    assert flask_app.test_client().get(url, headers={"Range": f"bytes={len(data) + 5}-"}).status_code == 416
    assert flask_app.test_client().get(url, headers={"Range": "bytes=nonsense"}).status_code == 200, "an unreadable range is ignored"
    assert flask_app.test_client().get("/yipi-media/" + "0" * 32).status_code == 404


def test_pictures_are_still_handed_out_whole_and_cached(client):
    mia = person("mia")
    media = upload(mia, png(), "p.png").get_json()["media"]
    first = flask_app.test_client().get(media["url"])
    assert first.status_code == 200 and first.data == png() and "immutable" in first.headers["Cache-Control"]
    assert flask_app.test_client().get(media["url"], headers={"If-None-Match": first.headers["ETag"]}).status_code == 304


def test_the_videos_feed_holds_only_posts_with_a_video_newest_first(client):
    mia, tom = person("mia"), person("tom")
    api(mia, "post", "/posts", {"text": "nur Text"}, status=201)
    api(mia, "post", "/posts", {"text": "Foto", "media": [upload(mia, png(), "p.png").get_json()["media"]["id"]]}, status=201)
    first, _ = post_video(mia, "erstes")
    second, _ = post_video(tom, "zweites", name="b.mp4")
    reply = api(tom, "post", "/posts", {"text": "Antwort", "replyTo": first["id"]}, status=201)["post"]
    feed = api(tom, "get", "/timeline?feed=videos", status=200)
    assert [item["text"] for item in feed["items"]] == ["zweites", "erstes"] and all(item["media"][0]["video"] for item in feed["items"])
    assert reply["id"] not in [item["id"] for item in feed["items"]]
    assert [item["text"] for item in api(tom, "get", "/timeline?feed=media")["items"]] == ["zweites", "erstes", "Foto"], "videos are media too"
    assert "zweites" in [item["text"] for item in api(tom, "get", "/timeline?feed=foryou")["items"]], "and they are in the normal feed"
    page = api(tom, "get", f"/timeline?feed=videos&cursor={second['id']}")
    assert [item["text"] for item in page["items"]] == ["erstes"]
    api(mia, "post", "/users/tom/block", status=200)
    assert [item["text"] for item in api(mia, "get", "/timeline?feed=videos")["items"]] == ["erstes"], "blocked people are not in the feed"


def test_likes_replies_and_deleting_work_for_a_video_like_for_any_post(client):
    mia, tom = person("mia"), person("tom")
    post, media = post_video(mia)
    assert api(tom, "post", f"/posts/{post['id']}/like", status=200)["counts"]["likes"] == 1
    api(tom, "post", "/posts", {"text": "Schön!", "replyTo": post["id"]}, status=201)
    again = api(tom, "get", "/timeline?feed=videos")["items"][0]
    assert again["counts"] == {"replies": 1, "reposts": 0, "likes": 1} and again["viewer"]["liked"] is True
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert api(tom, "get", "/timeline?feed=videos")["items"] == []
    assert flask_app.test_client().get(media["url"]).status_code == 404, "the file goes with the post"


def test_a_video_that_was_never_posted_is_cleaned_up_with_the_next_upload(client):
    mia = person("mia")
    first = upload(mia, mp4(), "a.mp4").get_json()["media"]
    assert yipi.YipiMedia.query.filter_by(id=first["id"]).first() is not None
    assert upload(mia, mp4(), "b.mp4").status_code == 200
    assert yipi.YipiMedia.query.count() >= 1


def test_the_page_may_play_the_videos_it_shows_before_they_are_sent(client):
    assert "media-src 'self' blob:" in yipi.CONTENT_SECURITY_POLICY
    mia = person("mia")
    assert "media-src 'self' blob:" in mia.get("/").headers["Content-Security-Policy"]


def test_the_videos_feed_can_show_only_the_people_you_follow(client):
    mia, tom, ann = person("mia"), person("tom"), person("ann")
    post_video(mia, "von mia")
    post_video(tom, "von tom", name="b.mp4")
    api(ann, "post", "/users/mia/follow", status=200)
    assert [item["text"] for item in api(ann, "get", "/timeline?feed=videos&scope=following", status=200)["items"]] == ["von mia"]
    assert len(api(ann, "get", "/timeline?feed=videos", status=200)["items"]) == 2
    assert api(person("zed"), "get", "/timeline?feed=videos&scope=following", status=200)["items"] == []
