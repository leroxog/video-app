"""Satürn music (yipi_music.py): songs for the clips of the camera. Only music that may be used is offered: audio of the Internet Archive that carries a Creative Commons licence that allows it
(CC0, CC BY, CC BY-SA: no "non commercial" and no "no derivatives", because a song under a video is a use that those licences do not allow) and files that a person uploads from their own
folder. The Internet Archive is asked on the server (a search, the data of one item) and the audio is passed on by the server (`stream`), so the page of Satürn never connects to another
site and the browser can mix the song into the recording. Nothing here runs as code. The honest size of the offer is what the Internet Archive has under these licences: some 400 000 audio
items (songs, albums, sessions; a part of them is not music), see `count()`."""
import random
import re
import threading
import time
import urllib.parse

import requests

ARCHIVE = "https://archive.org"
HEADERS = {"User-Agent": "NexBot/1.0 (https://nexai.up.railway.app; music for clips) python-requests"}
ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{2,99}")
FILE_RE = re.compile(r"[A-Za-z0-9][^\x00-\x1f\\<>\"?#]{0,180}\.(?:mp3|ogg|oga|m4a)", re.I)
LICENCE_URL = re.compile(r"^https?://(?:www\.)?creativecommons\.org/(publicdomain/zero|licenses/by|licenses/by-sa)/(\d\.\d)/?")
GOOD_FORMATS = ("VBR MP3", "MP3", "128Kbps MP3", "64Kbps MP3", "192Kbps MP3", "256Kbps MP3", "Ogg Vorbis", "OGG")
MAX_FILE = 18_000_000
MAX_UPLOAD = 8_000_000
LICENCE_QUERY = r"(licenseurl:*creativecommons.org\/publicdomain\/zero* OR licenseurl:*creativecommons.org\/licenses\/by\/* OR licenseurl:*creativecommons.org\/licenses\/by-sa\/*)"
WHERE = ("mediatype:audio AND (collection:(netlabels OR audio_music) OR subject:(music OR song OR songs OR album OR electronic OR rock OR pop OR jazz OR ambient OR hiphop OR instrumental))"
         " AND NOT collection:(librivoxaudio OR podcasts OR radioprograms)")

_cache = {}
_lock = threading.Lock()


def licence_label(url):
    """"CC BY 4.0" for the address of a licence that is allowed, None for any other."""
    found = LICENCE_URL.match(url if isinstance(url, str) else "")
    if not found:
        return None
    kind, version = found.groups()
    return {"publicdomain/zero": "CC0", "licenses/by": "CC BY", "licenses/by-sa": "CC BY-SA"}[kind] + f" {version}"


def _remember(key, value, seconds):
    with _lock:
        if len(_cache) > 3000:
            _cache.clear()
        _cache[key] = (time.time() + seconds, value)


def _recall(key):
    with _lock:
        got = _cache.get(key)
    return got[1] if got and got[0] > time.time() else None


def _text(value, limit):
    if isinstance(value, list):
        value = value[0] if value else ""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f<>]", " ", str(value or ""))).strip()[:limit]


def search(text, page=1, rows=20):
    """[{id, title, creator, licence, licenceUrl, downloads}] for some words (empty: the most loved), only allowed licences."""
    words = re.findall(r"[0-9A-Za-zÄÖÜäöüß]{2,30}", text if isinstance(text, str) else "")[:6]
    page = max(1, min(300, int(page) if str(page).isdigit() else 1))
    query = f"{WHERE} AND {LICENCE_QUERY}" + "".join(f" AND (title:{w} OR creator:{w} OR subject:{w})" for w in words)
    key = ("search", query, page, rows)
    got = _recall(key)
    if got is not None:
        return got
    params = {"q": query, "fl[]": ["identifier", "title", "creator", "licenseurl", "downloads"], "rows": rows, "page": page, "output": "json", "sort[]": "downloads desc"}
    try:
        reply = requests.get(f"{ARCHIVE}/advancedsearch.php", params=params, headers=HEADERS, timeout=15)
        docs = ((reply.json().get("response") or {}).get("docs")) or []
    except (requests.RequestException, ValueError):
        return []
    found = []
    for doc in docs:
        label = licence_label(_text(doc.get("licenseurl"), 200))
        identifier = _text(doc.get("identifier"), 100)
        if label and ID_RE.fullmatch(identifier):
            found.append({"id": identifier, "title": _text(doc.get("title"), 80) or identifier, "creator": _text(doc.get("creator"), 60) or "Unbekannt", "licence": label,
                          "licenceUrl": _text(doc.get("licenseurl"), 200), "downloads": int(doc.get("downloads") or 0) if str(doc.get("downloads") or "0").isdigit() else 0})
    _remember(key, found, 600)
    return found


def count():
    """How many audio items of the Internet Archive have an allowed licence (cached for a day)."""
    got = _recall(("count",))
    if got is not None:
        return got
    try:
        reply = requests.get(f"{ARCHIVE}/advancedsearch.php", params={"q": f"mediatype:audio AND {LICENCE_QUERY}", "fl[]": "identifier", "rows": 0, "output": "json"}, headers=HEADERS, timeout=15)
        number = int(reply.json()["response"]["numFound"])
    except (requests.RequestException, ValueError, KeyError, TypeError):
        return 0
    _remember(("count",), number, 86400)
    return number


def _seconds(value):
    if value is None:
        return None
    text = str(value).strip()
    try:
        if ":" in text:
            total = 0.0
            for part in text.split(":"):
                total = total * 60 + float(part)
            return total
        return float(text)
    except ValueError:
        return None


def metadata(identifier):
    if not ID_RE.fullmatch(identifier or ""):
        return None
    key = ("meta", identifier)
    got = _recall(key)
    if got is not None:
        return got or None
    try:
        reply = requests.get(f"{ARCHIVE}/metadata/{urllib.parse.quote(identifier)}", headers=HEADERS, timeout=15)
        data = reply.json()
    except (requests.RequestException, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("metadata"), dict):
        _remember(key, False, 300)
        return None
    _remember(key, data, 6 * 3600)
    return data


def resolve(identifier):
    """The song to play for an item: {id, title, creator, licence, licenceUrl, file, length, size, page} or None (not allowed, no usable file, not reachable)."""
    data = metadata(identifier)
    if not data:
        return None
    meta = data["metadata"]
    licence_url = _text(meta.get("licenseurl"), 200)
    label = licence_label(licence_url)
    if meta.get("mediatype") != "audio" or not label:
        return None
    candidates = []
    for entry in data.get("files") or []:
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not FILE_RE.fullmatch(name) or entry.get("format") not in GOOD_FORMATS or entry.get("source") == "metadata":
            continue
        try:
            size = int(entry.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        length = _seconds(entry.get("length"))
        if 0 < size <= MAX_FILE and (length is None or length >= 15):
            candidates.append((name, size, length))
    if not candidates:
        return None
    # the best: a file of one to five minutes (a song), then the nearest to that
    candidates.sort(key=lambda c: (0 if c[0].lower().endswith(".mp3") else 1, abs((c[2] or 200) - 180), c[1]))      # (MP3 first: every browser plays it, Safari does not play Ogg)
    name, size, length = candidates[0]
    return {"id": identifier, "title": _text(meta.get("title"), 80) or identifier, "creator": _text(meta.get("creator"), 60) or "Unbekannt", "licence": label, "licenceUrl": licence_url,
            "file": name, "length": round(length) if length else None, "size": size, "page": f"{ARCHIVE}/details/{urllib.parse.quote(identifier)}"}


def random_track(tries=5):
    """A random song among the best loved ones (a random page of the most downloaded), or None."""
    for _ in range(tries):
        found = search("", random.randint(1, 120))
        if not found:
            continue
        for item in random.sample(found, min(4, len(found))):
            track = resolve(item["id"])
            if track and (track["length"] is None or track["length"] <= 900):
                return track
    return None


def open_stream(identifier, name, range_header=None):
    """(status, headers, chunks) of the file of an allowed item, passed on from the Internet Archive (only archive.org is ever asked), or None."""
    track = resolve(identifier)
    if not track or name != track["file"]:
        found = metadata(identifier)                                              # (another file of the item may be used when it is one the item really has)
        names = {entry.get("name") for entry in (found or {}).get("files", []) if isinstance(entry, dict)}
        if not found or name not in names or not FILE_RE.fullmatch(name or "") or not licence_label(_text(found["metadata"].get("licenseurl"), 200)):
            return None
    url = f"{ARCHIVE}/download/{urllib.parse.quote(identifier)}/{urllib.parse.quote(name)}"
    headers = dict(HEADERS)
    if range_header and re.fullmatch(r"bytes=\d*-\d*", range_header):
        headers["Range"] = range_header
    try:
        for _ in range(4):
            reply = requests.get(url, headers=headers, stream=True, timeout=20, allow_redirects=False)
            if reply.status_code in (301, 302, 303, 307, 308):
                url = urllib.parse.urljoin(url, reply.headers.get("Location", ""))
                host = urllib.parse.urlparse(url).hostname or ""
                if urllib.parse.urlparse(url).scheme != "https" or not (host == "archive.org" or host.endswith(".archive.org")):
                    return None
                reply.close()
                continue
            break
        else:
            return None
    except requests.RequestException:
        return None
    if reply.status_code not in (200, 206):
        reply.close()
        return None
    if int(reply.headers.get("Content-Length") or 0) > MAX_FILE:
        reply.close()
        return None
    kind = "audio/ogg" if name.lower().endswith((".ogg", ".oga")) else "audio/mp4" if name.lower().endswith(".m4a") else "audio/mpeg"
    out = {"Content-Type": kind, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    for key in ("Content-Length", "Content-Range"):
        if reply.headers.get(key):
            out[key] = reply.headers[key]
    return reply.status_code, out, reply.iter_content(65536)


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
