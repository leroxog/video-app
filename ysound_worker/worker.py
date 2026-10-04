#!/usr/bin/env python3
"""ysound song computer: makes the songs that visitors order on the website, on THIS computer.

How it works (and what it deliberately does NOT do):
  * It asks the website "is a song waiting?" (outgoing HTTPS requests only; no port on this computer is
    opened to the internet) and receives a small job: style tags, lyrics, length.
  * It checks the job, then hands only those fields to the ACE-Step server that runs on THIS computer
    (127.0.0.1, see serve_model.py), waits for the finished MP3 and uploads it to the website.
  * It never runs commands, never opens files named by the website, never follows redirects (so the secret
    token can't be sent anywhere else), and never prints the token.
Only the Python standard library is used, so the whole program can be read in one sitting.

    python worker.py --init --site https://nexai.up.railway.app    (once: creates the config + secrets)
    python worker.py --check                                        (is everything reachable?)
    python worker.py                                                (make songs until Ctrl+C)
"""
import argparse
import hashlib
import json
import logging
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

log = logging.getLogger("ysound-worker")

DEFAULT_CONFIG = Path.home() / "ysound-ai" / "worker.json"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
LANGUAGES = {"unknown", "de", "en", "es", "fr", "it", "pt", "ja", "ko", "zh", "ru", "nl", "pl", "tr"}
CONFIG_KEYS = {"site", "token", "model_api", "model_api_key", "poll_seconds", "job_timeout_seconds",
               "cooldown_seconds", "inference_steps"}
MIN_SECONDS, MAX_SECONDS = 10, 240
TAGS_MAX, LYRICS_MAX = 300, 2500
AUDIO_MAX = 30_000_000
CLAIM_MAX_BYTES = 64_000
STEP_RANGE = (1, 20)                  # the turbo model's allowed number of steps


class WorkerError(Exception):
    pass


class Rejected(WorkerError):
    """The website answered, and said no (retrying the same thing won't help)."""


# ------------------------------------------------------------------ config

def _is_loopback_url(url):
    host = urllib.parse.urlsplit(url).hostname or ""
    return host in LOCAL_HOSTS


def _check_site(value):
    site = str(value or "").rstrip("/")
    parts = urllib.parse.urlsplit(site)
    if parts.scheme not in ("https", "http") or not parts.hostname or parts.path or parts.query:
        raise WorkerError("'site' muss eine Adresse wie https://nexai.up.railway.app sein.")
    if parts.scheme == "http" and parts.hostname not in LOCAL_HOSTS:
        raise WorkerError("'site' muss https:// sein (http ist nur für localhost erlaubt).")
    return site


def load_config(path):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise WorkerError(f"Config {path} kann nicht gelesen werden ({exc}). Lege sie mit --init an.")
    if not isinstance(data, dict) or set(data) - CONFIG_KEYS:
        raise WorkerError(f"Config hat unbekannte Felder: {sorted(set(data) - CONFIG_KEYS)}" if isinstance(data, dict) else "Config ist kein Objekt.")
    site = _check_site(data.get("site"))
    token = data.get("token")
    if not isinstance(token, str) or len(token) < 32:
        raise WorkerError("'token' fehlt oder ist zu kurz (mindestens 32 Zeichen).")
    model_api = str(data.get("model_api", "http://127.0.0.1:8001")).rstrip("/")
    if not _is_loopback_url(model_api) or urllib.parse.urlsplit(model_api).scheme != "http":
        raise WorkerError("'model_api' darf nur auf diesen Computer zeigen (http://127.0.0.1:PORT).")

    def number(name, default, low, high):
        value = data.get(name, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
            raise WorkerError(f"'{name}' muss eine Zahl zwischen {low} und {high} sein.")
        return value

    return {
        "site": site, "token": token, "model_api": model_api, "model_api_key": str(data.get("model_api_key", "")),
        "poll_seconds": number("poll_seconds", 4, 1, 120), "job_timeout_seconds": number("job_timeout_seconds", 1500, 60, 7200),
        "cooldown_seconds": number("cooldown_seconds", 5, 0, 600),
        "inference_steps": int(number("inference_steps", 8, STEP_RANGE[0], STEP_RANGE[1])),
    }


def init_config(path, site):
    """Create the config with fresh random secrets. Returns the SHA-256 of the site token: that hash (not
    the token) is what goes into the website's environment as YSOUND_WORKER_TOKEN_SHA256."""
    path = Path(path)
    if path.exists():
        raise WorkerError(f"{path} gibt es schon. Lösche sie zuerst, wenn du neue Geheimnisse willst.")
    site = _check_site(site)                            # before anything is written
    token = secrets.token_urlsafe(48)
    config = {"site": site, "token": token, "model_api": "http://127.0.0.1:8001",
              "model_api_key": secrets.token_urlsafe(32)}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    restrict_to_owner(path)
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def restrict_to_owner(path):
    """Only the current user may read the file (it holds the secrets)."""
    try:
        if os.name == "nt":
            subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"{os.environ['USERNAME']}:(R,W)"],
                           check=True, capture_output=True, timeout=30)
        else:
            os.chmod(path, 0o600)
    except (OSError, subprocess.SubprocessError, KeyError):
        log.warning("Konnte die Rechte von %s nicht einschränken -- bitte selbst prüfen.", path)


# --------------------------------------------------------------------- jobs

def _text(value, limit, multiline):
    if not isinstance(value, str):
        raise WorkerError("Auftragstext fehlt.")
    allowed = "\n" if multiline else ""
    value = "".join(ch for ch in value.replace("\r", "") if ch in allowed or (ch.isprintable() and ch != "\x7f"))
    return value.strip()[:limit]


def clean_job(raw):
    """The only things from the website that reach the model, each checked and cut to size."""
    if not isinstance(raw, dict):
        raise WorkerError("Auftrag ist kein Objekt.")
    job_id, duration = raw.get("id"), raw.get("duration")
    if isinstance(job_id, bool) or not isinstance(job_id, int) or not 0 < job_id < 2 ** 31:
        raise WorkerError("Auftrags-ID ist ungültig.")
    if isinstance(duration, bool) or not isinstance(duration, int) or not MIN_SECONDS <= duration <= MAX_SECONDS:
        raise WorkerError("Länge ist ungültig.")
    tags = _text(raw.get("tags"), TAGS_MAX, multiline=False)
    lyrics = _text(raw.get("lyrics"), LYRICS_MAX, multiline=True)
    if not tags or not lyrics:
        raise WorkerError("Tags oder Text sind leer.")
    language = raw.get("language") if raw.get("language") in LANGUAGES else "unknown"
    return {"id": job_id, "tags": tags, "lyrics": lyrics, "duration": duration, "language": language}


# --------------------------------------------------------------------- http

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(_NoRedirect)


def http(method, url, *, headers=None, body=None, timeout=30, max_bytes=1_000_000):
    """(status, bytes). Never follows redirects; reads at most max_bytes (+1 so callers can detect overflow)."""
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with _opener.open(request, timeout=timeout) as response:
            return response.status, response.read(max_bytes + 1)
    except urllib.error.HTTPError as exc:
        try:
            return exc.code, exc.read(max_bytes + 1)
        finally:
            exc.close()
    except (urllib.error.URLError, OSError) as exc:
        raise WorkerError(f"Keine Verbindung zu {urllib.parse.urlsplit(url).netloc}: {exc}")


def _json(status, body, what):
    try:
        return json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise WorkerError(f"{what}: Antwort ist kein JSON (Status {status}).")


class Site:
    def __init__(self, base, token):
        self.base, self._auth = base, {"Authorization": f"Bearer {token}"}

    def _post(self, path, body=None, content_type=None, timeout=30):
        headers = dict(self._auth)
        if content_type:
            headers["Content-Type"] = content_type
        return http("POST", self.base + path, headers=headers, body=body if body is not None else b"",
                    timeout=timeout, max_bytes=CLAIM_MAX_BYTES)

    def ping(self):
        status, body = self._post("/api/ysound/worker/ping")
        if status == 401:
            raise WorkerError("Die Webseite lehnt das Token ab (401). Stimmt YSOUND_WORKER_TOKEN_SHA256 bei Railway?")
        if status == 404:
            raise WorkerError("Die Webseite kennt den Song-Rechner nicht (404). Ist YSOUND_WORKER_TOKEN_SHA256 gesetzt und die neue Version online?")
        return _json(status, body, "ping")

    def claim(self):
        status, body = self._post("/api/ysound/worker/claim")
        if status in (401, 404):
            self.ping()                                  # raises with the matching explanation
        if status != 200:
            raise WorkerError(f"claim: Status {status}")
        return _json(status, body, "claim").get("job")

    def upload(self, job_id, audio):
        for attempt in range(3):
            try:
                status, _ = self._post(f"/api/ysound/worker/jobs/{int(job_id)}/audio", audio, "application/octet-stream", timeout=180)
                if status == 200:
                    return
                raise Rejected(f"Upload abgelehnt (Status {status}).")
            except Rejected:
                raise
            except WorkerError:                          # no connection: try again a moment later
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))

    def fail(self, job_id):
        try:
            self._post(f"/api/ysound/worker/jobs/{int(job_id)}/fail")
        except WorkerError:
            log.warning("Konnte der Webseite den Fehler von Auftrag %s nicht melden.", job_id)


class Model:
    """The ACE-Step API server on this computer, used through three fixed endpoints."""

    def __init__(self, base, key, steps, timeout):
        self.base, self.steps, self.timeout = base, steps, timeout
        self._headers = {"Authorization": f"Bearer {key}"} if key else {}

    def _call(self, method, path, body=None, max_bytes=1_000_000, timeout=60):
        headers = dict(self._headers)
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode("utf-8")
        return http(method, self.base + path, headers=headers, body=data, timeout=timeout, max_bytes=max_bytes)

    def health(self):
        status, body = self._call("GET", "/health", timeout=10)
        return status == 200 and b"ok" in body

    def generate(self, job):
        """MP3 bytes for a checked job. Raises WorkerError."""
        status, body = self._call("POST", "/release_task", {
            "prompt": job["tags"], "lyrics": job["lyrics"], "audio_duration": job["duration"],
            "vocal_language": job["language"], "audio_format": "mp3", "inference_steps": self.steps,
            "thinking": False, "use_format": False, "batch_size": 1,
        })
        task_id = (_json(status, body, "release_task").get("data") or {}).get("task_id")
        if status != 200 or not isinstance(task_id, str) or not re.fullmatch(r"[0-9a-fA-F-]{8,64}", task_id):
            raise WorkerError(f"Das Modell hat den Auftrag nicht angenommen (Status {status}).")
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            time.sleep(3)
            status, body = self._call("POST", "/query_result", {"task_id_list": [task_id]})
            entries = _json(status, body, "query_result").get("data")
            entry = next((e for e in (entries if isinstance(entries, list) else [entries]) if isinstance(e, dict) and e.get("task_id") == task_id), None)
            if entry is None or entry.get("status") == 0:
                continue
            if entry.get("status") != 1:
                raise WorkerError("Das Modell meldet einen Fehler bei der Erzeugung.")
            try:
                files = json.loads(entry["result"])
                path = files[0]["file"]
            except (KeyError, IndexError, TypeError, ValueError):
                raise WorkerError("Das Modell hat keine Audiodatei gemeldet.")
            if not isinstance(path, str) or not path.startswith("/v1/audio?path="):
                raise WorkerError("Das Modell hat einen unerwarteten Dateipfad gemeldet.")
            status, audio = self._call("GET", path, max_bytes=AUDIO_MAX, timeout=120)
            if status != 200 or not audio or len(audio) > AUDIO_MAX or not (audio[:3] == b"ID3" or audio[:2] in (b"\xff\xfb", b"\xff\xf3", b"\xff\xf2")):
                raise WorkerError("Das Modell hat keine brauchbare MP3 geliefert.")
            return audio
        raise WorkerError("Zeitlimit: das Modell war nicht rechtzeitig fertig.")


# --------------------------------------------------------------------- loop

def run_once(site, model):
    """Handle at most one job. Returns True if there was one."""
    job = site.claim()
    if job is None:
        return False
    job_id = job.get("id") if isinstance(job, dict) else None
    try:
        clean = clean_job(job)
        log.info("Auftrag %s: %ss, Tags: %s", clean["id"], clean["duration"], clean["tags"])
        started = time.monotonic()
        audio = model.generate(clean)
        log.info("Auftrag %s fertig nach %.0f s (%d KB), lade hoch ...", clean["id"], time.monotonic() - started, len(audio) // 1024)
        site.upload(clean["id"], audio)
        log.info("Auftrag %s hochgeladen.", clean["id"])
    except WorkerError as exc:
        log.error("Auftrag %s fehlgeschlagen: %s", job_id, exc)
        if isinstance(job_id, int) and not isinstance(job_id, bool):
            site.fail(job_id)
    return True


def main_loop(config, once=False):
    site = Site(config["site"], config["token"])
    model = Model(config["model_api"], config["model_api_key"], config["inference_steps"], config["job_timeout_seconds"])
    delay = config["poll_seconds"]
    while True:
        try:
            worked = run_once(site, model)
            delay = config["poll_seconds"]
            if worked:
                time.sleep(config["cooldown_seconds"])      # let the graphics card cool down between songs
        except WorkerError as exc:
            log.warning("%s -- neuer Versuch in %s s", exc, int(delay))
            if once:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 120)
            continue
        if once:
            return worked
        if not worked:
            time.sleep(delay)


def check(config):
    model = Model(config["model_api"], config["model_api_key"], config["inference_steps"], config["job_timeout_seconds"])
    problems = []
    try:
        print("Modell auf diesem Computer:", "bereit" if model.health() else "antwortet, ist aber nicht ok")
    except WorkerError as exc:
        problems.append(f"Modell: {exc}")
    try:
        answer = Site(config["site"], config["token"]).ping()
        print("Webseite:", "Token ok,", answer.get("waiting", "?"), "Song(s) warten")
    except WorkerError as exc:
        problems.append(f"Webseite: {exc}")
    for problem in problems:
        print("PROBLEM:", problem)
    return not problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--init", action="store_true", help="Config mit neuen Geheimnissen anlegen (braucht --site)")
    parser.add_argument("--site", help="Adresse der Webseite, z.B. https://nexai.up.railway.app")
    parser.add_argument("--check", action="store_true", help="Modell und Webseite prüfen, nichts erzeugen")
    parser.add_argument("--once", action="store_true", help="höchstens einen Auftrag bearbeiten und beenden")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    try:
        if args.init:
            if not args.site:
                parser.error("--init braucht --site")
            token_hash = init_config(args.config, args.site)
            print(f"Config angelegt: {args.config}")
            print("Trage bei Railway diese Variable ein (das ist nur der Hash, kein Geheimnis):")
            print(f"YSOUND_WORKER_TOKEN_SHA256={token_hash}")
            return 0
        config = load_config(args.config)
        if args.check:
            return 0 if check(config) else 1
        main_loop(config, once=args.once)
        return 0
    except WorkerError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nBeendet.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
