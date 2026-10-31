"""Satürn, round 6 (2026-10-21): the Videos tab shows a shuffle (five at a time, and it starts over), videos are at most 30 seconds, somebody who is not
signed in may watch the video that was sent to them (and nothing else), photos / videos / documents go into chats (private), and Satürn can read
documents and look at photos."""
import base64
import io
import os
import struct
import sys
import tempfile
import zipfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import ai_assistant  # noqa: E402
import docread  # noqa: E402
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


def mp4(extra=2000, seconds=None):
    """A file that is built like an MP4; with `seconds` it has a movie header that says how long it is (timescale 1000)."""
    head = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
    if seconds is not None:
        mvhd = b"mvhd" + b"\x00\x00\x00\x00" + b"\x00" * 8 + struct.pack(">II", 1000, int(seconds * 1000)) + b"\x00" * 80
        mvhd = struct.pack(">I", len(mvhd) + 4) + mvhd
        head += struct.pack(">I", len(mvhd) + 8) + b"moov" + mvhd
    return head + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


def png():
    import zlib
    raw = b"\x00" + b"\xff\x00\x00" * 4
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def upload(client, data, name, path="/api/yipi/media", **fields):
    return client.post(path, data={"file": (io.BytesIO(data), name), **fields}, content_type="multipart/form-data")


def post_video(client, text="Mein Video", seconds=None):
    media = upload(client, mp4(seconds=seconds), "clip.mp4").get_json()["media"]
    return api(client, "post", "/posts", {"text": text, "media": [media["id"]]}, status=201)["post"]


# ------------------------------------------------------------------------------------------------- the shuffle
def test_the_videos_tab_reads_a_shuffle_five_at_a_time(client):
    mia = person("mia")
    ids = {post_video(mia, f"Video {n}")["id"] for n in range(12)}
    first = api(mia, "get", "/timeline?feed=videos&order=random&seed=7&offset=0&limit=5", status=200)
    assert len(first["items"]) == 5 and first["next"] == 5 and first["seed"] == 7
    seen, offset = [], 0
    while offset is not None:
        page = api(mia, "get", f"/timeline?feed=videos&order=random&seed=7&offset={offset}&limit=5", status=200)
        seen += [item["id"] for item in page["items"]]
        offset = page["next"]
    assert sorted(seen) == sorted(ids), "every video exactly once"
    again = [item["id"] for item in api(mia, "get", "/timeline?feed=videos&order=random&seed=7&offset=0&limit=5")["items"]]
    assert again == seen[:5], "the same seed is the same shuffle"
    orders = {tuple(item["id"] for item in api(mia, "get", f"/timeline?feed=videos&order=random&seed={s}&offset=0&limit=10")["items"]) for s in range(1, 12)}
    assert len(orders) >= 8, "a new seed shuffles again"
    newest_first = [item["id"] for item in api(mia, "get", "/timeline?feed=videos")["items"]]
    assert any(tuple(order[:5]) != tuple(newest_first[:5]) for order in orders), "not the newest first"
    assert len(api(mia, "get", "/timeline?feed=videos&order=random&seed=7&limit=500")["items"]) == 10, "never more than ten at once"
    assert api(mia, "get", "/timeline?feed=videos&order=random&seed=7&offset=99999&limit=5")["items"] == []
    assert api(mia, "get", "/timeline?feed=videos&order=random&seed=-3&offset=abc&limit=zero", status=200)["ok"] is True


def test_the_shuffle_of_the_people_you_follow_stays_with_them(client):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    mine, others = post_video(ben, "von Ben"), post_video(cy, "von Cyrus")
    api(mia, "post", "/users/ben/follow", {}, status=200)
    page = api(mia, "get", "/timeline?feed=videos&order=random&seed=3&scope=following&limit=10")
    assert [item["id"] for item in page["items"]] == [mine["id"]] and others["id"] not in [item["id"] for item in page["items"]]


def test_a_shuffle_key_scrambles_neighbours():
    close = 0
    for seed in range(1, 40):
        import random
        rng = random.Random(seed)
        multiplier, shift = rng.randrange(2, yipi.SHUFFLE_PRIME - 1), rng.randrange(1, yipi.SHUFFLE_PRIME - 1)
        ordered = sorted(range(1, 200), key=lambda n: ((((n * n) % yipi.SHUFFLE_PRIME) * multiplier + n * shift) % yipi.SHUFFLE_PRIME, n))
        close += sum(1 for a, b in zip(ordered, ordered[1:]) if abs(a - b) == 1)
    assert close / (39 * 198) < 0.03, "videos that were posted one after the other are not shown one after the other"


# --------------------------------------------------------------------------------------- 30 seconds
def test_a_video_may_be_30_seconds_and_the_milliseconds_do_not_count(client):
    mia = person("mia")
    assert upload(mia, mp4(seconds=12.0), "a.mp4").status_code == 200
    assert upload(mia, mp4(seconds=30.0), "b.mp4").status_code == 200
    assert upload(mia, mp4(seconds=30.9), "c.mp4").status_code == 200, "30 seconds and 900 milliseconds is still 30 seconds"
    long = upload(mia, mp4(seconds=31.0), "d.mp4")
    assert long.status_code == 413 and long.get_json()["error"] == "video_too_long"
    assert upload(mia, mp4(seconds=600), "e.mp4").status_code == 413
    assert upload(mia, mp4(), "f.mp4").status_code == 200, "a file that does not say how long it is (a recording) is judged by the page"
    assert yipi.video_seconds(mp4(seconds=2.5)) == 2.5 and yipi.video_seconds(b"junk") is None


def test_the_length_of_a_webm_is_read_when_it_says_so():
    duration = struct.pack(">f", 12500.0)                          # in timecode units of 1 ms
    data = b"\x1aE\xdf\xa3\x9fB\x82\x84webm" + b"\x2a\xd7\xb1\x83\x0f\x42\x40" + b"\x44\x89\x84" + duration + b"\x18S\x80g" + b"\x01" * 100
    assert abs(yipi.video_seconds(data) - 12.5) < 0.01
    assert yipi.video_type(data) == "video/webm"


# ----------------------------------------------------------------------------------- the page for a guest
def test_a_guest_sees_the_video_that_was_sent_to_him_and_one_more(client):
    mia, ben = person("mia"), person("ben")
    sent = post_video(mia, "Der Hund\n#hund")
    other = post_video(ben, "Eine Katze")
    guest = flask_app.test_client()
    reply = guest.get(f"/api/yipi/share/{sent['id']}")
    assert reply.status_code == 200
    data = reply.get_json()
    assert data["post"]["id"] == sent["id"] and data["post"]["media"][0]["video"] is True and data["post"]["user"]["handle"] == "mia"
    assert data["next"]["id"] == other["id"] and data["next"]["media"][0]["video"] is True, "the next one is another video"
    assert data["text"] == yipi.SHARE_VIDEO and set(data["post"]) == {"id", "text", "createdAt", "user", "media"}, "no counts, no comments"
    assert guest.get(f"/api/yipi/share/{other['id']}").get_json()["next"]["id"] == sent["id"]
    assert guest.get("/api/yipi/share/999999").status_code == 404
    api(mia, "delete", f"/posts/{sent['id']}", status=200)
    assert guest.get(f"/api/yipi/share/{sent['id']}").status_code == 404


def test_a_post_without_a_video_is_shared_as_a_card_and_replies_stay_hidden(client):
    mia = person("mia")
    text = api(mia, "post", "/posts", {"text": "Ein Gedanke zum Tag"}, status=201)["post"]
    reply = api(mia, "post", "/posts", {"text": "Antwort", "replyTo": text["id"]}, status=201)["post"]
    guest = flask_app.test_client()
    data = guest.get(f"/api/yipi/share/{text['id']}").get_json()
    assert data["post"]["text"] == "Ein Gedanke zum Tag" and data["next"] is None and data["text"] == yipi.SHARE_POST
    assert guest.get("/api/yipi/timeline").status_code == 401 and guest.get(f"/api/yipi/posts/{text['id']}/replies").status_code == 401
    assert guest.get(f"/api/yipi/share/{reply['id']}").status_code == 200, "a reply is a post too; its page is the same card"


def test_a_suspended_account_and_a_repost_are_not_shared(client):
    mia, ben = person("mia"), person("ben")
    post = post_video(mia)
    repost = api(ben, "post", f"/posts/{post['id']}/repost", {}, status=200)
    with flask_app.app_context():
        owner = yipi.YipiUser.query.filter_by(handle_lc="mia").first()
        owner.suspended = True
        db.session.commit()
    guest = flask_app.test_client()
    assert guest.get(f"/api/yipi/share/{post['id']}").status_code == 404 and repost["ok"]


def test_the_link_preview_says_what_a_person_would_say(client):
    mia = person("mia")
    video = post_video(mia, "Mein Hund")
    text = api(mia, "post", "/posts", {"text": "Nur Text"}, status=201)["post"]
    guest = flask_app.test_client()
    home = guest.get("/").get_data(as_text=True)
    assert 'property="og:description" content="Ich habe Satürn gefunden!!!!"' in home and 'name="description" content="Ich habe Satürn gefunden!!!!"' in home
    page = guest.get(f"/mia/status/{video['id']}").get_data(as_text=True)
    assert 'property="og:description" content="Ich habe ein tolles Video auf Satürn gefunden willst du es auch sehen?!"' in page
    assert "Mein Hund" not in page and 'content="noindex"' in page and '"me": null' in page.replace('"me":null', '"me": null')
    page = guest.get(f"/mia/status/{text['id']}").get_data(as_text=True)
    assert "Ich habe einen tollen Beitrag auf Satürn gefunden willst du ihn auch sehen?!" in page and "Nur Text" not in page
    assert guest.get("/mia/status/999999").status_code == 404, "a post that is not there is not there"
    signed_in = mia.get("/").get_data(as_text=True)
    assert "Ich habe Satürn gefunden!!!!" not in signed_in


# ------------------------------------------------------------------------------------ files in chats
def attach(client, data, name, **fields):
    return upload(client, data, name, path="/api/yipi/attachments", **fields)


def pdf_bytes(text="Hallo Welt aus dem PDF"):
    stream = f"BT /F1 24 Tf 72 700 Td ({text}) Tj ET".encode()
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
               b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offsets = b"%PDF-1.4\n", []
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    start = len(out)
    out += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets)
    return out + b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + str(start).encode() + b"\n%%EOF"


def make_zip(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


def test_a_chat_takes_photos_videos_and_documents_and_nothing_else(client):
    mia = person("mia")
    photo = attach(mia, png(), "bild.png")
    assert photo.status_code == 201 and photo.get_json()["file"]["kind"] == "image" and photo.get_json()["file"]["width"] == 4
    video = attach(mia, mp4(), "clip.mp4", width="720", height="1280")
    assert video.status_code == 201 and video.get_json()["file"]["kind"] == "video"
    for data, name, kind in ((pdf_bytes(), "Bericht Q3.pdf", "document"), (b"hallo\nwelt", "notiz.txt", "document"), (make_zip({"word/document.xml": "<w:p/>"}), "brief.docx", "document"),
                             (b"{" + bytes([92]) + b"rtf1 Hallo}", "alt.rtf", "document"), (b"a,b\n1,2", "zahlen.csv", "document")):
        reply = attach(mia, data, name)
        assert reply.status_code == 201 and reply.get_json()["file"]["kind"] == kind, name
    for data, name in ((b"MZ" + b"\x00" * 50, "programm.exe"), (b"not a pdf", "fake.pdf"), (b"<script>alert(1)</script>", "seite.html"), (b"\x00\x01\x02", "daten.txt"),
                       (b"just a file", "nichts"), (make_zip({"a": "b"}), "archiv.zip"), (b"PK\x03\x04", "x.exe")):
        reply = attach(mia, data, name)
        assert reply.status_code == 415 and reply.get_json()["error"] == "bad_attachment", name
    assert attach(mia, b"%PDF-1.4" + b"0" * (yipi.MAX_DOCUMENT_BYTES + 10), "gross.pdf").status_code == 413
    assert flask_app.test_client().post("/api/yipi/attachments", data={"file": (io.BytesIO(b"x"), "a.txt")}, content_type="multipart/form-data").status_code == 401


def test_a_file_in_a_message_is_for_the_two_people_only(client):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    for a, b in ((mia, "ben"), (ben, "mia")):
        api(a, "post", f"/users/{b}/follow", {}, status=200)
    file = attach(mia, pdf_bytes(), "Bericht Q3.pdf").get_json()["file"]
    sent = api(mia, "post", "/messages/ben", {"text": "Hier", "fileId": file["id"]}, status=201)["message"]
    assert sent["file"]["name"] == "Bericht Q3.pdf" and sent["file"]["kind"] == "document" and sent["text"] == "Hier"
    for who in (mia, ben):
        r = who.get(file["url"])
        assert r.status_code == 200 and r.mimetype == "application/pdf" and r.data.startswith(b"%PDF")
        assert r.headers["Content-Disposition"].startswith("attachment; filename=") and "Bericht" in r.headers["Content-Disposition"] and r.headers["X-Content-Type-Options"] == "nosniff"
        assert "sandbox" in r.headers["Content-Security-Policy"] and r.headers["Cache-Control"].startswith("private")
    assert cy.get(file["url"]).status_code == 404 and flask_app.test_client().get(file["url"]).status_code == 404
    assert api(ben, "get", "/messages/mia", status=200)["messages"][0]["file"]["name"] == "Bericht Q3.pdf"
    chats = api(ben, "get", "/chats", status=200)["items"]
    assert chats[0]["last"]["text"] == "Hier"
    only = attach(mia, png(), "bild.png").get_json()["file"]
    api(mia, "post", "/messages/ben", {"fileId": only["id"]}, status=201)
    assert api(ben, "get", "/chats", status=200)["items"][0]["last"]["text"] == "Foto"
    api(mia, "post", "/messages/ben", {"fileId": file["id"], "text": "Noch einmal"}, status=201)        # the same file can go to several people (the clip of the camera tab)
    stranger = attach(cy, png(), "x.png").get_json()["file"]
    assert api(mia, "post", "/messages/ben", {"fileId": stranger["id"]}, status=404)["error"] == "bad_attachment", "somebody else's file cannot be sent"
    assert api(mia, "post", "/messages/ben", {"fileId": "0" * 32}, status=404)
    assert api(mia, "post", "/messages/ben", {}, status=400)["error"] == "empty"


def test_a_video_in_a_chat_is_played_in_pieces(client):
    mia, ben = person("mia"), person("ben")
    api(mia, "post", "/users/ben/follow", {}, status=200)
    api(ben, "post", "/users/mia/follow", {}, status=200)
    file = attach(mia, mp4(extra=4000), "clip.mp4").get_json()["file"]
    api(mia, "post", "/messages/ben", {"fileId": file["id"]}, status=201)
    whole = ben.get(file["url"])
    assert whole.status_code == 200 and whole.headers["Accept-Ranges"] == "bytes" and whole.headers["Content-Disposition"] == "inline"
    part = ben.get(file["url"], headers={"Range": "bytes=0-9"})
    assert part.status_code == 206 and len(part.data) == 10 and part.data == whole.data[:10]
    assert ben.get(file["url"], headers={"Range": "bytes=99999999-"}).status_code == 416


def test_a_group_chat_shares_files_with_its_members_only(client):
    mia, ben, cy = person("mia"), person("ben"), person("cyrus")
    for a in (mia, ben):
        for other in ("mia", "ben"):
            pass
    api(mia, "post", "/users/ben/follow", {}, status=200)
    api(ben, "post", "/users/mia/follow", {}, status=200)
    group = api(mia, "post", "/groups", {"name": "Team", "members": ["ben"]}, status=201)["group"]
    file = attach(mia, b"Plan\nA", "plan.txt").get_json()["file"]
    sent = api(mia, "post", f"/groups/{group['id']}/messages", {"fileId": file["id"], "text": "Plan"}, status=201)["message"]
    assert sent["file"]["name"] == "plan.txt"
    assert ben.get(file["url"]).data == b"Plan\nA" and cy.get(file["url"]).status_code == 404
    listed = api(ben, "get", f"/groups/{group['id']}", status=200)["messages"]
    assert listed[-1]["file"]["name"] == "plan.txt"
    assert api(ben, "get", "/chats", status=200)["items"][0]["last"]["text"] == "Plan"


def test_files_that_never_went_into_a_message_are_cleaned_up_later(client):
    mia = person("mia")
    old = attach(mia, png(), "alt.png").get_json()["file"]
    with flask_app.app_context():
        row = db.session.get(yipi.YipiFile, old["id"])
        row.created_at = yipi.utcnow() - yipi.timedelta(hours=7)
        db.session.commit()
    attach(mia, png(), "neu.png")
    with flask_app.app_context():
        assert db.session.get(yipi.YipiFile, old["id"]) is None


def test_the_names_of_files_are_made_safe():
    assert yipi.safe_filename("../../etc/passwd") == "passwd"
    assert yipi.safe_filename('C:' + chr(92) + 'Users' + chr(92) + 'x' + chr(92) + 'a"b<c>.pdf') == "abc.pdf"
    assert yipi.safe_filename("") == "datei" and len(yipi.safe_filename("x" * 500 + ".pdf")) <= 100
    assert yipi.safe_filename("Bericht\x00\n.pdf") == "Bericht.pdf"


# ------------------------------------------------------------------------------------------ Satürn reads
def test_docread_takes_the_text_out_of_documents():
    word = make_zip({"word/document.xml": "<w:document><w:body><w:p><w:r><w:t>Erster Absatz</w:t></w:r></w:p><w:p><w:r><w:t>Zweiter &amp; letzter</w:t></w:r></w:p></w:body></w:document>"})
    text, cut = docread.extract(word, "brief.docx")
    assert text == "Erster Absatz\nZweiter & letzter" and cut is False
    slides = make_zip({"ppt/slides/slide2.xml": "<p><a:p><a:t>Zweite</a:t></a:p></p>", "ppt/slides/slide1.xml": "<p><a:p><a:t>Erste</a:t></a:p></p>"})
    assert docread.extract(slides, "x.pptx")[0] == "Folie 1:\nErste\n\nFolie 2:\nZweite"
    sheet = make_zip({"xl/sharedStrings.xml": "<sst><si><t>Name</t></si><si><t>Alter</t></si><si><t>Mia</t></si></sst>",
                      "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c><v>16</v></c></row></sheetData></worksheet>'})
    assert docread.extract(sheet, "x.xlsx")[0] == "Name Alter\nMia 16"
    odt = make_zip({"content.xml": "<office:text><text:p>Hallo</text:p><text:p>Welt</text:p></office:text>"})
    assert docread.extract(odt, "x.odt")[0] == "Hallo\nWelt"
    assert docread.extract(b"{" + bytes([92]) + b"rtf1 Hallo" + bytes([92]) + b"par Welt}", "x.rtf")[0] == "Hallo\nWelt"
    assert docread.extract("Über uns\n\n\n\nZeile".encode(), "x.txt")[0] == "Über uns\n\nZeile"
    assert docread.extract(pdf_bytes("Hallo Welt aus dem PDF"), "x.pdf")[0] == "Hallo Welt aus dem PDF"
    text, cut = docread.extract(("wort " * 5000).encode(), "lang.txt", limit=100)
    assert len(text) == 100 and cut is True


def test_docread_refuses_what_it_cannot_or_should_not_read():
    for data, name, reason in ((b"not a zip", "x.docx", "bad_file"), (b"not a pdf", "x.pdf", "bad_file"), (b"   \n ", "x.txt", "empty"), (b"x", "x.exe", "bad_type"),
                               (make_zip({"word/document.xml": "<w:p></w:p>"}), "leer.docx", "empty")):
        with pytest.raises(docread.Unreadable) as error:
            docread.extract(data, name)
        assert str(error.value) == reason, name
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", "<w:p>" + "a" * (docread.MAX_UNPACKED + 1000) + "</w:p>")
    assert len(bomb.getvalue()) < 100000
    with pytest.raises(docread.Unreadable) as error:
        docread.extract(bomb.getvalue(), "bombe.docx")
    assert str(error.value) == "too_big"


def test_nex_reads_a_document_without_keeping_it(client):
    mia = person("mia")
    reply = upload(mia, b"Der Vertrag beginnt am 1. Mai.", "vertrag.txt", path="/api/yipi/nex/read")
    assert reply.status_code == 200 and reply.get_json()["text"] == "Der Vertrag beginnt am 1. Mai." and reply.get_json()["name"] == "vertrag.txt" and reply.get_json()["cut"] is False
    assert upload(mia, b"MZ", "x.exe", path="/api/yipi/nex/read").get_json()["error"] == "doc_bad"
    assert upload(mia, b"   ", "leer.txt", path="/api/yipi/nex/read").get_json()["error"] == "doc_empty"
    assert upload(mia, b"x" * (yipi.NEX_DOC_BYTES + 5), "gross.txt", path="/api/yipi/nex/read").status_code == 413
    with flask_app.app_context():
        assert yipi.YipiFile.query.count() == 0, "nothing was stored"
    assert flask_app.test_client().post("/api/yipi/nex/read", data={"file": (io.BytesIO(b"x"), "a.txt")}, content_type="multipart/form-data").status_code == 401


def test_nex_gets_the_text_of_a_document_and_the_picture_goes_to_the_vision_model(client, monkeypatch):
    mia = person("mia")
    seen = {}
    monkeypatch.setattr(ai_assistant, "generate_custom_stream", lambda system, message, max_tokens=0, **kw: (seen.update(kind="text", message=message) or iter(["Antwort"])))
    monkeypatch.setattr(ai_assistant, "generate_vision_stream", lambda system, message, images, **kw: (seen.update(kind="vision", message=message, images=list(images)) or iter(["Bild-Antwort"])))
    ask = [{"role": "user", "content": "Was steht drin?"}]
    r = mia.post("/api/yipi/nex", json={"messages": ask, "files": [{"kind": "document", "name": "vertrag.txt", "text": "Beginn: 1. Mai"}]})
    assert r.status_code == 200 and r.get_data(as_text=True) == "Antwort" and seen["kind"] == "text"
    assert "„vertrag.txt“" in seen["message"] and "Beginn: 1. Mai" in seen["message"] and seen["message"].rstrip().endswith("Nutzer: Was steht drin?"), "the question stays last"
    jpeg = b"\xff\xd8\xff\xc0\x00\x0b\x08\x00\x10\x00\x20\x01\x01\x11\x00\xff\xd9"
    r = mia.post("/api/yipi/nex", json={"messages": ask, "files": [{"kind": "image", "name": "hund.jpg", "data": base64.b64encode(jpeg).decode()}]})
    assert r.status_code == 200 and r.get_data(as_text=True) == "Bild-Antwort" and seen["kind"] == "vision"
    assert seen["images"][0].startswith("data:image/jpeg;base64,") and "Foto" in seen["message"] and "Was steht drin?" in seen["message"]
    bad = mia.post("/api/yipi/nex", json={"messages": ask, "files": [{"kind": "image", "name": "x.jpg", "data": base64.b64encode(b"not a picture").decode()}]})
    assert bad.status_code == 415 and bad.get_json()["error"] == "bad_image"
    huge = mia.post("/api/yipi/nex", json={"messages": ask, "files": [{"kind": "image", "name": "x.jpg", "data": "A" * (yipi.NEX_IMAGE_CHARS + 10)}]})
    assert huge.status_code == 415
    long = "wort " * 3000
    mia.post("/api/yipi/nex", json={"messages": [{"role": "user", "content": "Frage"}], "files": [{"kind": "document", "name": f"{n}.txt", "text": long} for n in range(3)]})
    assert len(seen["message"]) <= 8000 and seen["message"].rstrip().endswith("Nutzer: Frage"), "three long documents still leave room for the question"
