"""Satürn music (yipi_music.py): songs for the clips of the camera. Not everything under the sun: a short, chosen list of music that fits short videos (yipi_music_catalogue.py: funk, dance, hip-hop beats,
lo-fi, chill, retro and the tracks that are used in memes), all under a Creative Commons licence that allows it (CC0, CC BY, CC BY-SA: no "non commercial" and no "no derivatives", because a song under
a video is a use that those licences do not allow), plus the files that a person uploads from their own folder. The audio comes from the Internet Archive and is passed on by the server (`open_stream`), so
the page of Satürn never connects to another site and the browser can mix the song into the recording. A song is fetched ONCE as a whole and kept in a folder of the server (at most MAX_CACHED files), so
that it starts at once and can be started in the middle without asking the Internet Archive again; `warm` starts that download in the background as soon as somebody looks at a song. Nothing here runs as code."""
import os
import random
import re
import tempfile
import threading
import urllib.parse

import requests

import yipi_music_catalogue

ARCHIVE = "https://archive.org"
HEADERS = {"User-Agent": "NexBot/1.0 (https://nexai.up.railway.app; music for clips) python-requests"}
LICENCE_URL = re.compile(r"^https?://(?:www\.)?creativecommons\.org/(publicdomain/zero|licenses/by|licenses/by-sa)/(\d\.\d)/?")
MAX_FILE = 18_000_000
MAX_UPLOAD = 8_000_000
MAX_CACHED = 26
CACHE_DIR = os.path.join(tempfile.gettempdir(), "saturn-music")

SONGS = {row["id"]: row for row in yipi_music_catalogue.SONGS}
ORDER = [row["id"] for row in yipi_music_catalogue.SONGS]
TAGS = list(yipi_music_catalogue.TAGS)

_lock = threading.Lock()
_fetching = {}                                         # song id -> Event (a download that is running)


def licence_label(url):
    """"CC BY 4.0" for the address of a licence that is allowed, None for any other."""
    found = LICENCE_URL.match(url if isinstance(url, str) else "")
    if not found:
        return None
    kind, version = found.groups()
    return {"publicdomain/zero": "CC0", "licenses/by": "CC BY", "licenses/by-sa": "CC BY-SA"}[kind] + f" {version}"


def _text(value, limit):
    if isinstance(value, list):
        value = value[0] if value else ""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f<>]", " ", str(value or ""))).strip()[:limit]


# ---------------------------------------------------------------------------------------------------------------- the list
def search(text, page=1, rows=20):
    """[{id, title, creator, tag, licence, licenceUrl}] of the chosen songs that have all the words (empty: all of them, in the order of the list)."""
    words = [w.lower() for w in re.findall(r"[0-9A-Za-zÄÖÜäöüß]{2,30}", text if isinstance(text, str) else "")[:6]]
    page = max(1, min(300, int(page) if str(page).isdigit() else 1))
    found = []
    for identifier in ORDER:
        row = SONGS[identifier]
        haystack = f"{row['title']} {row['creator']} {row['tag']}".lower()
        if all(word in haystack for word in words):
            found.append({"id": row["id"], "title": row["title"], "creator": row["creator"], "tag": row["tag"], "licence": row["licence"], "licenceUrl": row["licenceUrl"], "downloads": 0})
    return found[(page - 1) * rows: page * rows]


def count():
    """How many songs are offered."""
    return len(ORDER)


def resolve(identifier):
    """The song to play for an id of the list: {id, title, creator, licence, licenceUrl, file, length, size, page} or None (not in the list)."""
    row = SONGS.get(identifier) if isinstance(identifier, str) else None
    if row is None:
        return None
    return {"id": row["id"], "title": row["title"], "creator": row["creator"], "licence": row["licence"], "licenceUrl": row["licenceUrl"], "file": row["file"], "length": row["length"],
            "size": row["size"], "page": f"{ARCHIVE}/details/{urllib.parse.quote(row['item'])}"}


def random_track():
    """A random song of the list (and its download starts at once)."""
    track = resolve(random.choice(ORDER))
    if track:
        warm(track["id"])
    return track


# ---------------------------------------------------------------------------------------------------------------- the files of the songs
def _path(row):
    return os.path.join(CACHE_DIR, f"{row['id']}.mp3")


def _download(row):
    """The whole file of a song from the Internet Archive into the folder of the cache (only archive.org is ever asked); its path, or None."""
    path = _path(row)
    if os.path.exists(path):
        return path
    url = f"{ARCHIVE}/download/{urllib.parse.quote(row['item'])}/{urllib.parse.quote(row['file'])}"
    temp = f"{path}.{os.getpid()}.{threading.get_ident()}.part"
    reply = None
    try:
        for _ in range(4):
            reply = requests.get(url, headers=HEADERS, stream=True, timeout=25, allow_redirects=False)
            if reply.status_code in (301, 302, 303, 307, 308):
                url = urllib.parse.urljoin(url, reply.headers.get("Location", ""))
                host = urllib.parse.urlparse(url).hostname or ""
                reply.close()
                if urllib.parse.urlparse(url).scheme != "https" or not (host == "archive.org" or host.endswith(".archive.org")):
                    return None
                continue
            break
        else:
            return None
        if reply.status_code != 200 or int(reply.headers.get("Content-Length") or 0) > MAX_FILE:
            return None
        os.makedirs(CACHE_DIR, exist_ok=True)
        size = 0
        with open(temp, "wb") as out:
            for chunk in reply.iter_content(65536):
                size += len(chunk)
                if size > MAX_FILE:
                    raise ValueError("too big")
                out.write(chunk)
        if size < 10_000:
            raise ValueError("too small")
        os.replace(temp, path)
        _trim()
        return path
    except (requests.RequestException, OSError, ValueError):
        return None
    finally:
        if reply is not None:
            reply.close()
        try:
            os.remove(temp)
        except OSError:
            pass


def _trim():
    """Not more than MAX_CACHED songs on the disk: the least recently used go."""
    try:
        files = sorted((os.path.join(CACHE_DIR, name) for name in os.listdir(CACHE_DIR) if name.endswith(".mp3")), key=os.path.getmtime)
        for old in files[:-MAX_CACHED]:
            os.remove(old)
    except OSError:
        pass


def ensure(row):
    """The path of the file of a song, downloaded when it is not there yet (one download at a time for a song; others wait for it)."""
    path = _path(row)
    if os.path.exists(path):
        try:
            os.utime(path)                                               # (used just now: it stays)
        except OSError:
            pass
        return path
    with _lock:
        event = _fetching.get(row["id"])
        owner = event is None
        if owner:
            event = _fetching[row["id"]] = threading.Event()
    if not owner:
        event.wait(60)
        return path if os.path.exists(path) else None
    try:
        return _download(row)
    finally:
        with _lock:
            _fetching.pop(row["id"], None)
        event.set()


def warm(identifier):
    """Starts the download of a song in the background (it is looked at, so it will probably be played)."""
    row = SONGS.get(identifier) if isinstance(identifier, str) else None
    if not AUTO_WARM or row is None or os.path.exists(_path(row)) or row["id"] in _fetching:
        return False
    threading.Thread(target=ensure, args=(row,), daemon=True).start()
    return True


AUTO_WARM = True                                        # (the tests switch this off: they never ask the Internet Archive)
_warmed = []


def warm_top(count=6):
    """The first time somebody opens the list: the best known songs are fetched one after the other in the background, so that the first plays start at once."""
    if not AUTO_WARM or _warmed:
        return False
    _warmed.append(True)
    ids = [identifier for identifier in ORDER if SONGS[identifier]["tag"] == "Beliebt"][:count]

    def work():
        for identifier in ids:
            ensure(SONGS[identifier])
    threading.Thread(target=work, daemon=True).start()
    return True


def open_stream(identifier, name, range_header=None):
    """(status, headers, chunks) of the file of a song of the list, with ranges (so that a player can start in the middle), or None."""
    row = SONGS.get(identifier) if isinstance(identifier, str) else None
    if row is None or name != row["file"]:
        return None
    path = ensure(row)
    if path is None:
        return None
    try:
        size = os.path.getsize(path)
    except OSError:
        return None
    start, end, status = 0, size - 1, 200
    found = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header or "")
    if found and (found.group(1) or found.group(2)):
        if found.group(1):
            start = int(found.group(1))
            end = int(found.group(2)) if found.group(2) else size - 1
        else:
            start = max(0, size - int(found.group(2)))
        if start >= size:
            return 416, {"Content-Range": f"bytes */{size}", "Content-Type": "audio/mpeg"}, iter(())
        end = min(end, size - 1)
        status = 206
    headers = {"Content-Type": "audio/mpeg", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "Content-Length": str(end - start + 1)}
    if status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"

    def chunks():
        with open(path, "rb") as handle:
            handle.seek(start)
            left = end - start + 1
            while left > 0:
                data = handle.read(min(65536, left))
                if not data:
                    break
                left -= len(data)
                yield data
    return status, headers, chunks()


# ---------------------------------------------------------------------------------------------------------------- a song of a person's own folder
def audio_type(data):
    """The type of an audio file by its first bytes (MP3, Ogg, M4A, WAV), or None."""
    if not isinstance(data, (bytes, bytearray)) or len(data) < 12:
        return None
    if data[:3] == b"ID3" or (data[0] == 0xFF and data[1] & 0xE0 == 0xE0):
        return "audio/mpeg"
    if data[:4] == b"OggS":
        return "audio/ogg"
    if data[4:8] == b"ftyp" and data[8:12] in (b"M4A ", b"M4B ", b"mp42", b"isom", b"M4P "):
        return "audio/mp4"
    if data[:4] == b"RIFF" and data[8:12] == b"WAVE":
        return "audio/wav"
    return None


def clean_song(raw, owns_audio):
    """What a lens stores as its song: {src: "archive", id, file, title, creator, licence, licenceUrl, length, start} or {src: "upload", media, title, start}; (None, reason) when it is not allowed.
    `owns_audio(media_id)` says whether the person has uploaded that audio file."""
    if not isinstance(raw, dict):
        return None, "Kein Song."
    try:
        start = max(0, min(900, int(float(raw.get("start") or 0))))
    except (TypeError, ValueError):
        start = 0
    if raw.get("src") == "upload":
        media = raw.get("media")
        if not isinstance(media, str) or not re.fullmatch(r"[0-9a-f]{32}", media) or not owns_audio(media):
            return None, "Diese Datei gehört nicht dir."
        return {"src": "upload", "media": media, "title": _text(raw.get("title"), 60) or "Eigener Song", "start": start}, ""
    if raw.get("src") == "archive":
        track = resolve(raw.get("id") if isinstance(raw.get("id"), str) else "")
        if not track:
            return None, "Dieser Song darf nicht benutzt werden oder ist nicht erreichbar."
        return {"src": "archive", **{key: track[key] for key in ("id", "file", "title", "creator", "licence", "licenceUrl", "length")}, "start": start}, ""
    return None, "Kein Song."
