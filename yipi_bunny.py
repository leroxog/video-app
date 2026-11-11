"""Satürn videos on Bunny Stream (yipi_bunny.py): when the site is set up with a Bunny library (BUNNY_LIBRARY_ID, BUNNY_API_KEY, BUNNY_CDN_HOST), every video that somebody posts is also sent
to Bunny in the background. Bunny makes small versions of it (the library is set to 480p, 360p ...), and as soon as they are ready the site sends everybody who asks for the video to the small
MP4 on the Bunny CDN, so that the server of the site carries nothing and the phones load a few megabytes instead of a big file. Until it is ready (and for every video that never went there) the
file of the site itself is served as before. Nothing here runs without the three settings, and a failed upload only means "not on Bunny".

The settings: BUNNY_LIBRARY_ID (a number), BUNNY_API_KEY (the key of the library), BUNNY_CDN_HOST (like vz-xxxxxxxx-xxx.b-cdn.net), BUNNY_HEIGHT (480 by default: the height of the MP4 that is
played; the library must make it and have "MP4 Fallback" switched on)."""
import logging
import os
import threading
import time

import requests

log = logging.getLogger(__name__)

API = "https://video.bunnycdn.com"
FINISHED = (3, 4)                 # Bunny: 3 = transcoded and playable, 4 = finished (resolutions done); both play
FAILED = (5, 6)                   # processing or upload failed
_checked = {}                     # media id -> when its state was asked last (so that a busy page does not ask Bunny all the time)
CHECK_EVERY = 20


def library():
    return os.environ.get("BUNNY_LIBRARY_ID", "").strip()


def key():
    return os.environ.get("BUNNY_API_KEY", "").strip()


def host():
    return os.environ.get("BUNNY_CDN_HOST", "").strip().removeprefix("https://").strip("/")


def height():
    value = os.environ.get("BUNNY_HEIGHT", "480").strip()
    return value if value in ("240", "360", "480", "720", "1080") else "480"


def enabled():
    return bool(library() and key() and host())


def headers():
    return {"AccessKey": key(), "Accept": "application/json"}


def mp4_url(guid):
    return f"https://{host()}/{guid}/play_{height()}p.mp4"


def thumbnail_url(guid):
    return f"https://{host()}/{guid}/thumbnail.jpg"


def upload(title, data):
    """Creates the video at Bunny and sends the bytes: returns its guid (raises when Bunny says no)."""
    made = requests.post(f"{API}/library/{library()}/videos", json={"title": (title or "video")[:100]}, headers=headers(), timeout=30)
    made.raise_for_status()
    guid = made.json()["guid"]
    sent = requests.put(f"{API}/library/{library()}/videos/{guid}", data=data, headers={**headers(), "Content-Type": "application/octet-stream"}, timeout=600)
    sent.raise_for_status()
    return guid


def status(guid):
    """The state of a video at Bunny (a number, see FINISHED and FAILED), None when Bunny cannot be asked."""
    try:
        reply = requests.get(f"{API}/library/{library()}/videos/{guid}", headers=headers(), timeout=15)
        reply.raise_for_status()
        return int(reply.json().get("status"))
    except Exception:  # noqa: BLE001
        return None


def due(media_id, now=None):
    """True when it is time to ask Bunny again about this video (at most every CHECK_EVERY seconds)."""
    now = time.time() if now is None else now
    if now - _checked.get(media_id, 0) < CHECK_EVERY:
        return False
    _checked[media_id] = now
    if len(_checked) > 5000:
        _checked.clear()
    return True


def push(app, media_id, loader, record, title=""):
    """Sends one video (bytes from `loader()`) to Bunny and writes the guid down with `record(guid)`. Runs in a thread."""
    try:
        with app.app_context():
            data = loader()
            if not data:
                return None
            guid = upload(title or media_id, data)
            record(guid)
            return guid
    except Exception:  # noqa: BLE001
        log.exception("A video could not be sent to Bunny")
        return None


def push_later(app, media_id, loader, record, title=""):
    if not enabled():
        return None
    thread = threading.Thread(target=push, args=(app, media_id, loader, record, title), daemon=True, name="bunny-upload")
    thread.start()
    return thread
