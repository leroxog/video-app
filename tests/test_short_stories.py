"""Satürn, 2026-11-02: the videos of the account "Short_Stories7k" (scripts/short_stories.py) and the longer videos (120 seconds) that make them possible. The script reads the length of every MP4 from its
header, writes the name "<Person> in <N> Sekunden" and the description "Glückwunsch du hast das Leben von <Person> in <N> Sekunden verstanden!!!" (seconds, never minutes) and puts the videos online
through the API of the site like a person would. Here the real server takes the uploads (the Flask test client), only the sound recognition is switched off."""
import io
import json
import os
import struct
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import short_stories  # noqa: E402
import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_captions  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"
HANDLE = "Short_Stories7k"


def box(kind, body):
    return struct.pack(">I", len(body) + 8) + kind + body


def mp4(seconds, width=720, height=1280, extra=2000):
    """A file that is built like an MP4 with a movie header (timescale 1000) and one track with a picture of the given size."""
    mvhd = box(b"mvhd", b"\x00\x00\x00\x00" + b"\x00" * 8 + struct.pack(">II", 1000, int(round(seconds * 1000))) + b"\x00" * 80)
    tkhd = box(b"tkhd", b"\x00\x00\x00\x07" + b"\x00" * 8 + struct.pack(">I", 1) + b"\x00" * 4 + struct.pack(">I", int(seconds * 1000)) + b"\x00" * 8 + b"\x00" * 8 + b"\x00" * 36
               + struct.pack(">II", width << 16, height << 16))
    moov = box(b"moov", mvhd + box(b"trak", tkhd))
    return b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + moov + b"\x00\x00\x00\x08free" + (8 + extra).to_bytes(4, "big") + b"mdat" + bytes(range(256)) * (extra // 256 + 1)


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    monkeypatch.setattr(yipi_captions, "RUNNER_BOX", [lambda *args, **kwargs: None])          # (no sound recognition here)


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


class Session:
    """What requests.Session does, on the Flask test client (the same calls, the same answers)."""

    def __init__(self, client):
        self.client = client

    def post(self, url, json=None, data=None, files=None):
        path = url.split("//", 1)[-1].split("/", 1)[1]
        if files:
            fields = dict(data or {})
            for name, (filename, handle, content_type) in files.items():
                fields[name] = (io.BytesIO(handle.read()), filename, content_type)
            reply = self.client.post("/" + path, data=fields, content_type="multipart/form-data")
        else:
            reply = self.client.post("/" + path, json=json)
        return Reply(reply)


class Reply:
    def __init__(self, reply):
        self.status_code, self._reply = reply.status_code, reply

    def json(self):
        data = self._reply.get_json(silent=True)
        if data is None:
            raise ValueError("no json")
        return data


def sign_up(client):
    assert client.post("/api/yipi/signup", json={"handle": HANDLE, "password": PASSWORD, "adult": True}).status_code == 200
    return Session(flask_app.test_client())


# ================================================================================================ the texts
def test_the_name_and_the_description_say_seconds_and_never_minutes():
    assert short_stories.texts("Steve Jobs", 78) == ("Steve Jobs in 78 Sekunden", "Glückwunsch du hast das Leben von Steve Jobs in 78 Sekunden verstanden!!!")
    name, description = short_stories.texts("Anne Frank", 61)
    assert name == "Anne Frank in 61 Sekunden" and description.endswith("in 61 Sekunden verstanden!!!"), "61 seconds, not 1 minute 1 second"
    assert short_stories.texts("  J.K.   Rowling ", 49)[0] == "J.K. Rowling in 49 Sekunden"
    for seconds in (7, 59, 60, 78, 119):
        for line in short_stories.texts("Kleopatra", seconds):
            assert "inute" not in line and "min" not in line.lower() and f"{seconds} Sekunden" in line
    assert short_stories.post_text("A in 5 Sekunden", "B") == "A in 5 Sekunden\nB"


def test_the_length_is_rounded_to_whole_seconds_and_is_at_least_one():
    assert [short_stories.whole_seconds(v) for v in (49.734, 49.2, 50.5, 0.2, 77.6, 120)] == [50, 49, 50, 1, 78, 120]


# ================================================================================================ the header of a video
def test_the_length_and_the_picture_size_are_read_from_the_header():
    facts = short_stories.mp4_facts(mp4(49.734))
    assert abs(facts["seconds"] - 49.734) < 0.001 and (facts["width"], facts["height"]) == (720, 1280)
    assert short_stories.mp4_facts(mp4(77.6, 1080, 1920))["height"] == 1920
    assert short_stories.mp4_facts(b"junk") is None and short_stories.mp4_facts(b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2") is None


def test_the_list_is_built_from_the_videos_with_the_names_and_the_descriptions(tmp_path):
    videos, out = tmp_path / "in", tmp_path / "out"
    videos.mkdir()
    (videos / "aaa.mp4").write_bytes(mp4(49.734))
    (videos / "bbb.mp4").write_bytes(mp4(77.6))
    source = [{"n": 2, "name": "Anne Frank", "blob": "bbb"}, {"n": 1, "name": "Steve Jobs", "blob": "aaa"}]
    rows = short_stories.build_manifest(source, str(videos), str(out))
    assert [r["n"] for r in rows] == [1, 2], "in the order of the numbers"
    assert rows[0]["name"] == "Steve Jobs in 50 Sekunden" and rows[0]["description"] == "Glückwunsch du hast das Leben von Steve Jobs in 50 Sekunden verstanden!!!"
    assert rows[1]["name"] == "Anne Frank in 78 Sekunden" and rows[1]["seconds"] == 78 and rows[1]["exact_seconds"] == 77.6
    assert rows[0]["file"] == "videos/01_Steve_Jobs.mp4" and (out / "videos" / "01_Steve_Jobs.mp4").read_bytes() == mp4(49.734)
    assert json.loads((out / "manifest.json").read_text(encoding="utf-8")) == rows
    with pytest.raises(FileNotFoundError):
        short_stories.build_manifest([{"n": 3, "name": "Nobody", "blob": "zzz"}], str(videos), str(out))
    (videos / "ccc.mp4").write_bytes(b"not a video")
    with pytest.raises(ValueError):
        short_stories.build_manifest([{"n": 4, "name": "Broken", "blob": "ccc"}], str(videos), str(out))


# ================================================================================================ the upload through the real server
def make_folder(tmp_path, people):
    videos = tmp_path / "videos"
    videos.mkdir()
    source = []
    for n, (name, seconds) in enumerate(people, 1):
        (videos / f"b{n}.mp4").write_bytes(mp4(seconds))
        source.append({"n": n, "name": name, "blob": f"b{n}"})
    short_stories.build_manifest(source, str(videos), str(tmp_path))
    return str(tmp_path)


def test_the_account_name_has_to_have_at_most_fifteen_characters(client):
    refused = client.post("/api/yipi/signup", json={"handle": "Short_Stories_7000", "password": PASSWORD, "adult": True})
    assert refused.status_code == 400 and refused.get_json()["error"] == "bad_handle"
    assert len(HANDLE) == 15 and sign_up(client)


def test_the_videos_go_online_one_after_the_other_with_the_name_the_description_and_a_length_over_thirty_seconds(client, tmp_path):
    session = sign_up(client)
    folder = make_folder(tmp_path, [("Steve Jobs", 49.734), ("Anne Frank", 60.864), ("Marie Curie", 78.0)])
    site = short_stories.Site(session, "https://example.test")
    site.login(HANDLE, PASSWORD)
    lines = []
    done = short_stories.upload_all(site, folder, HANDLE, log=lines.append, wait=lambda seconds: None)
    assert len(done) == 3 and all(address.startswith(f"https://example.test/{HANDLE}/status/") for address in done.values())
    with flask_app.app_context():
        posts = yipi.YipiPost.query.order_by(yipi.YipiPost.id).all()
        assert [p.text for p in posts] == ["Steve Jobs in 50 Sekunden\nGlückwunsch du hast das Leben von Steve Jobs in 50 Sekunden verstanden!!!",
                                           "Anne Frank in 61 Sekunden\nGlückwunsch du hast das Leben von Anne Frank in 61 Sekunden verstanden!!!",
                                           "Marie Curie in 78 Sekunden\nGlückwunsch du hast das Leben von Marie Curie in 78 Sekunden verstanden!!!"]
        media = yipi.YipiMedia.query.order_by(yipi.YipiMedia.created_at).all()
        assert [m.alt for m in media] == ["Steve Jobs in 50 Sekunden", "Anne Frank in 61 Sekunden", "Marie Curie in 78 Sekunden"]
        assert all(m.content_type.startswith("video/") and (m.width, m.height) == (720, 1280) for m in media)
        owner = yipi.YipiUser.query.filter_by(handle_lc=HANDLE.lower()).first()
        assert {p.user_id for p in posts} == {owner.id} and owner.handle == HANDLE
    # a second run goes on where the first stopped: nothing is uploaded twice
    again = []
    short_stories.upload_all(site, folder, HANDLE, log=again.append, wait=lambda seconds: None)
    assert all("already online" in line for line in again) and len(again) == 3
    with flask_app.app_context():
        assert yipi.YipiPost.query.count() == 3


def test_when_the_site_says_too_many_the_script_waits_and_goes_on(client, tmp_path):
    session = sign_up(client)
    count = yipi.LIMITS["media"][0] + 2                                                  # more than the 40 uploads an hour
    folder = make_folder(tmp_path, [(f"Person {n}", 30 + n % 7) for n in range(count)])
    site = short_stories.Site(session, "https://example.test")
    site.login(HANDLE, PASSWORD)
    waits = []

    def wait(seconds):
        waits.append(seconds)
        yipi._hits.clear()                                                               # (an hour passes)
    done = short_stories.upload_all(site, folder, HANDLE, log=lambda line: None, wait=wait)
    assert len(done) == count and waits, "it had to wait at least once"
    with flask_app.app_context():
        assert yipi.YipiPost.query.count() == count


def test_a_video_over_the_new_limit_is_refused_and_the_script_stops_with_a_clear_message(client, tmp_path):
    session = sign_up(client)
    assert yipi.MAX_VIDEO_SECONDS == 120
    folder = make_folder(tmp_path, [("Steve Jobs", 50.0), ("Zu Lang", 121.0)])
    site = short_stories.Site(session, "https://example.test")
    site.login(HANDLE, PASSWORD)
    with pytest.raises(SystemExit) as stopped:
        short_stories.upload_all(site, folder, HANDLE, log=lambda line: None, wait=lambda seconds: None)
    assert "video_too_long" in str(stopped.value) and "02" in str(stopped.value)
    with flask_app.app_context():
        assert yipi.YipiPost.query.count() == 1, "the first one is online"
    assert list(json.loads(open(os.path.join(folder, "uploaded.json"), encoding="utf-8").read())) == ["videos/01_Steve_Jobs.mp4"]


def test_a_wrong_password_stops_the_sign_in_and_nothing_is_printed_of_it(client, capsys):
    sign_up(client)
    site = short_stories.Site(Session(flask_app.test_client()), "https://example.test")
    with pytest.raises(SystemExit) as stopped:
        site.login(HANDLE, "wrong password!")
    assert "wrong_login" in str(stopped.value) and "wrong password!" not in str(stopped.value)
    captured = capsys.readouterr()
    assert "wrong password!" not in captured.out + captured.err


def test_a_dry_run_only_shows_the_names_and_the_descriptions(tmp_path, capsys):
    folder = make_folder(tmp_path, [("Steve Jobs", 49.734), ("Anne Frank", 60.864)])
    assert short_stories.main(["upload", "--folder", folder, "--login", HANDLE, "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "Steve Jobs in 50 Sekunden" in out and "verstanden!!!" in out and "Anne Frank in 61 Sekunden" in out
    assert short_stories.main(["upload", "--folder", folder, "--login", HANDLE, "--dry-run", "--only", "2"]) == 0
    out = capsys.readouterr().out
    assert "Anne Frank" in out and "Steve Jobs" not in out


def test_the_site_says_the_new_limit_everywhere_and_stories_stay_at_thirty_seconds():
    def read(name):
        with open(os.path.join(ROOT, "static", "js", name), encoding="utf-8") as handle:
            return handle.read()
    core, api, newpost, stories = read("yipi-core.js"), read("yipi-api.js"), read("yipi-newpost.js"), read("yipi-stories.js")
    assert "const MAX_VIDEO_SECONDS = 120;" in core and "const MAX_STORY_SECONDS = 30;" in core and "function videoTooLong(seconds, limit = MAX_VIDEO_SECONDS)" in core
    assert "höchstens 120 Sekunden" in api and "Story darf höchstens 30 Sekunden" in api
    assert "Core.videoTooLong(facts.seconds, Core.MAX_STORY_SECONDS)" in stories and "Api.MESSAGES.story_too_long" in stories
    assert newpost.count("120 Sekunden") >= 4 and "30 Sekunden" not in newpost.replace("bis 30 Sekunden", "") or "30 Sekunden" not in newpost


def test_the_site_announces_the_longer_videos():
    import yipi_company
    lines = {line[0]: line for line in yipi_company.ANNOUNCEMENTS}
    assert "2026-11-02-longvideos" in lines and "120 Sekunden" in lines["2026-11-02-longvideos"][2] and len(lines["2026-11-02-longvideos"][2]) <= 280
    assert len(lines) == len(yipi_company.ANNOUNCEMENTS)


def test_the_script_can_make_the_account_first_and_signs_in_when_it_exists_already(client):
    site = short_stories.Site(Session(flask_app.test_client()), "https://example.test")
    answers = iter(["25"])
    secrets = iter(["a long password", "a long password"])
    lines = []
    password = short_stories.make_account(site, HANDLE, ask=lambda prompt: next(answers), secret=lambda prompt: next(secrets), log=lines.append)
    assert password == "a long password" and "angelegt und angemeldet" in lines[-1]
    status, data = site.post("/posts", json={"text": "Ich bin angemeldet"})
    assert status in (200, 201) and data["ok"], "the new account is signed in without a second step"
    with flask_app.app_context():
        assert yipi.YipiUser.query.filter_by(handle_lc=HANDLE.lower()).count() == 1
    again = short_stories.Site(Session(flask_app.test_client()), "https://example.test")
    secrets2, answers2 = iter(["another password", "another password"]), iter(["25"])
    assert short_stories.make_account(again, HANDLE, ask=lambda prompt: next(answers2), secret=lambda prompt: next(secrets2), log=lines.append) is None
    assert "gibt es schon" in lines[-1]


def test_the_account_is_not_made_with_two_different_passwords_a_short_one_or_a_child(client):
    def attempt(passwords, answers, handle=HANDLE):
        site = short_stories.Site(Session(flask_app.test_client()), "https://example.test")
        secrets, said = iter(passwords), iter(answers)
        with pytest.raises(SystemExit) as stopped:
            short_stories.make_account(site, handle, ask=lambda prompt: next(said), secret=lambda prompt: next(secrets), log=lambda line: None)
        return str(stopped.value)
    assert "nicht gleich" in attempt(["a long password", "another one!!"], ["25"])
    assert "mindestens 8" in attempt(["short", "short"], ["25"])
    assert "keine Zahl" in attempt(["a long password", "a long password"], ["abc"])
    assert "ab 13" in attempt(["a long password", "a long password"], ["11"])
    assert "Eltern" in attempt(["a long password", "a long password"], ["14", "n"])
    assert "3 bis 15" in attempt(["a long password", "a long password"], ["25"], handle="Short_Stories_7000")
    with flask_app.app_context():
        assert yipi.YipiUser.query.count() == 0
