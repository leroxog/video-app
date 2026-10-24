"""Nex: files in Cloudflare R2.  R2 is replaced by a small fake that keeps the files in a dict (and is told when something is deleted), so the tests need no account.

What is checked: without the R2 variables nothing changes; with them a new photo, video, chat file or GIF goes to R2 and the row keeps only a note; the
browser is sent to a signed address (a chat file only after the check that the person may see it); deleting a post, an account or a GIF removes the files
from R2 after the commit (and not when it is rolled back); a broken R2 never fails an upload; the admin page moves what is in the database to R2 and
checks every file; the content security policy lets the page load from the bucket."""
import io
import os
import struct
import sys
import tempfile
import zlib

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
from blobstore import BlobStore, STORE  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


class FakeR2:
    """Just enough of the boto3 client."""

    def __init__(self):
        self.files = {}
        self.types = {}
        self.deleted = []
        self.broken = False

    def _check(self):
        if self.broken:
            raise RuntimeError("R2 is down")

    def put_object(self, Bucket, Key, Body, ContentType):
        self._check()
        self.files[Key] = bytes(Body)
        self.types[Key] = ContentType

    def get_object(self, Bucket, Key):
        self._check()
        return {"Body": io.BytesIO(self.files[Key])}

    def head_object(self, Bucket, Key):
        self._check()
        if Key not in self.files:
            raise KeyError(Key)
        return {"ContentLength": len(self.files[Key])}

    def copy_object(self, Bucket, Key, CopySource):
        self._check()
        self.files[Key] = self.files[CopySource["Key"]]
        self.types[Key] = self.types.get(CopySource["Key"], "")

    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://acc.r2.cloudflarestorage.com/{Params['Bucket']}/{Params['Key']}?sig=x&exp={ExpiresIn}&disp={Params.get('ResponseContentDisposition', '')}"

    def delete_objects(self, Bucket, Delete):
        self._check()
        for entry in Delete["Objects"]:
            self.files.pop(entry["Key"], None)
            self.deleted.append(entry["Key"])


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
    STORE.disable()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        STORE.disable()
        db.drop_all()


@pytest.fixture
def r2(client):
    fake = FakeR2()
    STORE.configure("acc", "key", "secret", "bucket", client=fake)
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


def png():
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00" + b"\xff\x00\x00" * 4)) + chunk(b"IEND", b"")


def mp4(extra=3000):
    return b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


def make_gif(width=3, height=2, frames=2):
    data = b"GIF89a" + struct.pack("<HH", width, height) + b"\x80\x00\x00" + b"\x00\x00\x00\xff\xff\xff"
    for _ in range(frames):
        data += b"\x21\xf9\x04\x04\x0a\x00\x00\x00" + b"\x2c" + struct.pack("<HHHH", 0, 0, width, height) + b"\x00" + b"\x02\x03\x02\x44\x01\x00"
    return data + b"\x3b"


def upload(client, data, name, path="/api/yipi/media", **fields):
    return client.post(path, data={"file": (io.BytesIO(data), name), **fields}, content_type="multipart/form-data")


# ------------------------------------------------------------------------------------------------------------- the store itself
def test_the_store_is_off_without_the_four_variables():
    assert BlobStore({}).enabled is False
    assert BlobStore({"R2_ACCOUNT_ID": "a", "R2_ACCESS_KEY_ID": "b", "R2_SECRET_ACCESS_KEY": "c"}).enabled is False, "the bucket name is missing"
    full = BlobStore({"R2_ACCOUNT_ID": "a", "R2_ACCESS_KEY_ID": "b", "R2_SECRET_ACCESS_KEY": "c", "R2_BUCKET_NAME": "d"})
    assert full.enabled and full.host == "a.r2.cloudflarestorage.com"
    assert BlobStore.key("media", "abc") == "pulse/media/abc"


def test_without_r2_everything_stays_in_the_database(client):
    mia = person("mia")
    media = upload(mia, png(), "a.png").get_json()["media"]
    row = yipi.YipiMedia.query.get(media["id"])
    assert row.stored == "db" and row.data == png()
    r = mia.get(media["url"])
    assert r.status_code == 200 and r.data == png() and r.mimetype == "image/png"
    assert "r2.cloudflarestorage.com" not in mia.get("/").headers["Content-Security-Policy"]


# ------------------------------------------------------------------------------------------------------------------- uploads
def test_a_new_photo_goes_to_r2_and_the_browser_is_sent_there(client, r2):
    mia = person("mia")
    media = upload(mia, png(), "a.png").get_json()["media"]
    row = yipi.YipiMedia.query.get(media["id"])
    assert row.stored == "r2" and row.data == b"" and row.size == len(png())
    key = f"pulse/media/{media['id']}"
    assert r2.files[key] == png() and r2.types[key] == "image/png"
    r = mia.get(media["url"])
    assert r.status_code == 302 and r.headers["Location"].startswith(f"https://acc.r2.cloudflarestorage.com/bucket/{key}?sig=") and "exp=3600" in r.headers["Location"]
    assert "max-age=300" in r.headers["Cache-Control"] and r.headers["X-Content-Type-Options"] == "nosniff"
    assert flask_app.test_client().get(media["url"]).status_code == 302, "a picture of a post can be opened by whoever has its address (the guest view of a shared video needs that)"


def test_a_video_goes_to_r2_and_a_post_keeps_working(client, r2):
    mia = person("mia")
    media = upload(mia, mp4(), "clip.mp4", width="720", height="1280").get_json()["media"]
    assert yipi.YipiMedia.query.get(media["id"]).stored == "r2"
    post = api(mia, "post", "/posts", {"text": "Mein Video", "media": [media["id"]]}, status=201)["post"]
    assert post["media"][0]["video"] is True
    assert mia.get(post["media"][0]["url"]).status_code == 302
    assert r2.types[f"pulse/media/{media['id']}"].startswith("video/")


def test_a_file_in_a_chat_is_only_signed_for_the_people_of_the_chat(client, r2):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    api(mia, "post", "/users/ben/follow", {}, status=200)
    api(ben, "post", "/users/mia/follow", {}, status=200)
    file = upload(mia, png(), "foto.png", path="/api/yipi/attachments").get_json()["file"]
    assert yipi.YipiFile.query.get(file["id"]).stored == "r2"
    api(mia, "post", "/messages/ben", {"fileId": file["id"]}, status=201)
    assert mia.get(file["url"]).status_code == 302
    assert ben.get(file["url"]).status_code == 302
    assert cy.get(file["url"]).status_code == 404, "somebody outside the chat gets no address at all"
    assert flask_app.test_client().get(file["url"]).status_code == 404
    assert "private" in ben.get(file["url"]).headers["Cache-Control"]


def test_a_document_is_downloaded_not_shown(client, r2):
    mia, ben = person("mia"), person("ben")
    api(mia, "post", "/users/ben/follow", {}, status=200)
    api(ben, "post", "/users/mia/follow", {}, status=200)
    file = upload(mia, b"Hallo, das ist ein Text.\n", "notiz.txt", path="/api/yipi/attachments").get_json()["file"]
    api(mia, "post", "/messages/ben", {"fileId": file["id"]}, status=201)
    location = ben.get(file["url"]).headers["Location"]
    assert "disp=attachment" in location and "notiz.txt" in location


def test_a_gif_goes_to_r2_and_using_it_copies_inside_r2(client, r2):
    mia = person("mia")
    gif = upload(mia, make_gif(), "g.gif", path="/api/yipi/gifs", title="Hallo").get_json()["gif"]
    row = yipi.PulseGif.query.get(gif["id"])
    assert row.stored == "r2" and row.data == b"" and r2.files[f"pulse/gif/{gif['id']}"] == make_gif()
    assert mia.get(f"/pulse-gif/{gif['id']}").status_code == 302
    used = api(mia, "post", f"/gifs/{gif['id']}/use", {}, status=201)["media"]
    media_row = yipi.YipiMedia.query.get(used["id"])
    assert media_row.stored == "r2" and r2.files[f"pulse/media/{used['id']}"] == make_gif(), "copied inside R2, nothing downloaded"
    assert yipi.PulseGif.query.get(gif["id"]).uses == 1


def test_a_broken_r2_never_fails_an_upload(client, r2):
    r2.broken = True
    mia = person("mia")
    media = upload(mia, png(), "a.png").get_json()["media"]
    row = yipi.YipiMedia.query.get(media["id"])
    assert row.stored == "db" and row.data == png(), "the file stays in the database"
    r2.broken = False
    assert mia.get(media["url"]).data == png()


# ------------------------------------------------------------------------------------------------------------------ deleting
def test_deleting_a_post_removes_its_files_from_r2_after_the_commit(client, r2):
    mia = person("mia")
    media = upload(mia, png(), "a.png").get_json()["media"]
    post = api(mia, "post", "/posts", {"text": "Foto", "media": [media["id"]]}, status=201)["post"]
    key = f"pulse/media/{media['id']}"
    assert key in r2.files
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert key not in r2.files and key in r2.deleted


def test_a_rolled_back_deletion_keeps_the_files(client, r2):
    mia = person("mia")
    media = upload(mia, png(), "a.png").get_json()["media"]
    key = f"pulse/media/{media['id']}"
    yipi.forget_stored(yipi.YipiMedia, yipi.YipiMedia.id == media["id"])
    assert db.session.info.get("r2_forget")
    db.session.rollback()
    assert not db.session.info.get("r2_forget") and key in r2.files
    yipi.forget_stored(yipi.YipiMedia, yipi.YipiMedia.id == media["id"])
    db.session.commit()
    assert key not in r2.files


def test_deleting_an_account_removes_photos_chat_files_and_gifs(client, r2):
    mia, ben = person("mia"), person("ben")
    api(mia, "post", "/users/ben/follow", {}, status=200)
    api(ben, "post", "/users/mia/follow", {}, status=200)
    media = upload(mia, png(), "a.png").get_json()["media"]
    file = upload(mia, png(), "b.png", path="/api/yipi/attachments").get_json()["file"]
    gif = upload(mia, make_gif(), "g.gif", path="/api/yipi/gifs", title="x").get_json()["gif"]
    keys = {f"pulse/media/{media['id']}", f"pulse/file/{file['id']}", f"pulse/gif/{gif['id']}"}
    assert keys <= set(r2.files)
    reply = mia.post("/api/yipi/delete", json={"password": PASSWORD})
    assert reply.status_code == 200, reply.get_json()
    assert not (keys & set(r2.files)), "nothing of her is left in the bucket"
    assert yipi.YipiFile.query.count() == 0


def test_a_failing_delete_in_r2_does_not_break_the_deletion(client, r2):
    mia = person("mia")
    media = upload(mia, png(), "a.png").get_json()["media"]
    post = api(mia, "post", "/posts", {"text": "Foto", "media": [media["id"]]}, status=201)["post"]
    r2.broken = True
    api(mia, "delete", f"/posts/{post['id']}", status=200)
    assert yipi.YipiMedia.query.get(media["id"]) is None


# ----------------------------------------------------------------------------------------------------------------- the admin page
def make_admin(monkeypatch):
    monkeypatch.setenv("YIPI_ADMINS", "boss")
    return person("boss")


def test_the_storage_page_is_for_admins_only(client, monkeypatch):
    boss, mia = make_admin(monkeypatch), person("mia")
    for method, path in (("get", "/admin/storage"), ("post", "/admin/storage/move"), ("post", "/admin/storage/compact")):
        assert getattr(mia, method)(f"/api/yipi{path}", json={}).status_code == 403
        assert getattr(flask_app.test_client(), method)(f"/api/yipi{path}", json={}).status_code == 401
    report = api(boss, "get", "/admin/storage", status=200)
    assert report["r2"] is False and {t["name"] for t in report["tables"]} == {"media", "file", "gif"} and report["databaseBytes"] is None


def test_the_admin_moves_the_files_of_the_database_to_r2_and_checks_each_one(client, monkeypatch):
    boss = make_admin(monkeypatch)
    mia = person("mia")
    photo = upload(mia, png(), "a.png").get_json()["media"]
    video = upload(mia, mp4(), "c.mp4").get_json()["media"]
    gif = upload(mia, make_gif(), "g.gif", path="/api/yipi/gifs", title="x").get_json()["gif"]
    assert api(boss, "post", "/admin/storage/move", {}) == {"ok": False, "error": "r2_off"} or api(boss, "post", "/admin/storage/move", {})["ok"] is False
    before = api(boss, "get", "/admin/storage", status=200)
    assert sum(t["inDatabase"] for t in before["tables"]) == 3 and sum(t["inR2"] for t in before["tables"]) == 0
    fake = FakeR2()
    STORE.configure("acc", "key", "secret", "bucket", client=fake)
    moved = api(boss, "post", "/admin/storage/move", {}, status=200)
    assert moved["moved"] == 3 and moved["failed"] == 0 and moved["remaining"] == 0
    assert fake.files[f"pulse/media/{photo['id']}"] == png() and fake.files[f"pulse/gif/{gif['id']}"] == make_gif()
    assert yipi.YipiMedia.query.get(photo["id"]).data == b"" and yipi.YipiMedia.query.get(photo["id"]).stored == "r2"
    assert mia.get(video["url"]).status_code == 302, "after the move the browser is sent to R2"
    after = api(boss, "get", "/admin/storage", status=200)
    assert sum(t["inDatabase"] for t in after["tables"]) == 0 and sum(t["inR2"] for t in after["tables"]) == 3
    assert api(boss, "post", "/admin/storage/move", {}, status=200)["moved"] == 0, "nothing is moved twice"


def test_a_file_that_did_not_arrive_intact_stays_in_the_database(client, monkeypatch):
    boss = make_admin(monkeypatch)
    mia = person("mia")
    photo = upload(mia, png(), "a.png").get_json()["media"]

    class Lossy(FakeR2):
        def put_object(self, Bucket, Key, Body, ContentType):
            super().put_object(Bucket, Key, bytes(Body)[:-1], ContentType)

    STORE.configure("acc", "key", "secret", "bucket", client=Lossy())
    result = api(boss, "post", "/admin/storage/move", {}, status=200)
    assert result["moved"] == 0 and result["failed"] == 1 and result["remaining"] == 1
    row = yipi.YipiMedia.query.get(photo["id"])
    assert row.stored == "db" and row.data == png(), "the original is only dropped after the copy was checked"


def test_the_move_takes_a_few_megabytes_per_call(client, monkeypatch):
    boss = make_admin(monkeypatch)
    mia = person("mia")
    for _ in range(4):
        assert upload(mia, mp4(extra=12 * 1024 * 1024), "c.mp4", width="720", height="1280").status_code == 200
    STORE.configure("acc", "key", "secret", "bucket", client=FakeR2())
    first = api(boss, "post", "/admin/storage/move", {}, status=200)
    assert first["moved"] == 3 and first["remaining"] == 1, "about 30 MB per call: three files of 12 MB, then it stops"
    second = api(boss, "post", "/admin/storage/move", {}, status=200)
    assert second["moved"] == 1 and second["remaining"] == 0
    assert yipi.YipiMedia.query.filter_by(stored="r2").count() == 4


def test_compacting_needs_postgres(client, monkeypatch):
    boss = make_admin(monkeypatch)
    assert api(boss, "post", "/admin/storage/compact", {}) == {"ok": False, "error": "not_postgres"} or api(boss, "post", "/admin/storage/compact", {})["ok"] is False


# ------------------------------------------------------------------------------------------------------------------ the policy
def test_the_page_may_load_pictures_and_videos_from_the_bucket_only_when_it_is_used(client, r2):
    policy = yipi.content_security_policy()
    assert "img-src 'self' data: blob: https://acc.r2.cloudflarestorage.com;" in policy and "media-src 'self' blob: https://acc.r2.cloudflarestorage.com;" in policy
    assert "script-src 'self';" in policy and "connect-src 'self'" in policy, "scripts and requests still only from the site itself"
    page = flask_app.test_client().get("/")
    assert "https://acc.r2.cloudflarestorage.com" in page.headers["Content-Security-Policy"]
    STORE.disable()
    assert "r2.cloudflarestorage.com" not in yipi.content_security_policy()
