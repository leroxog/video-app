"""Satürn AI pictures (yipi_aiimage.py): "KI-Bild" in the "+" panel of the chats and of the posts. Somebody writes what the picture shows, the server asks the free image service Pollinations
(image.pollinations.ai) and the picture comes back to the one who asked. The browser never talks to Pollinations (the pages may only load their own files); the server does, and it has to be careful:
without a key the service gives ONE picture every 45 seconds to ONE internet address, and all people of Satürn share the address of the server. So the requests wait in a queue (at most a few), one
picture is fetched at a time with a pause after it, a "try again in ... seconds" of the service is obeyed, and the person sees the place in the queue. With the variable POLLINATIONS_API_KEY (a key from
enter.pollinations.ai) the new address gen.pollinations.ai is used and the pause is short. The text of the person goes to Pollinations: the dialog and the privacy page say so. Everything here lives in
memory (one worker process): a picture is kept for ten minutes so that it can be fetched, then it is gone."""
import logging
import os
import re
import threading
import time
import uuid
from urllib.parse import quote

import requests
from flask import Response, jsonify, request

import yipi
import yipi_agents

logger = logging.getLogger(__name__)

CLASSIC = "https://image.pollinations.ai/prompt/"
GEN = "https://gen.pollinations.ai/image/"
SIZE = 768
PROMPT_MAX = 200
COOLDOWN = 48                  # seconds between two pictures without a key (the service says: one picture every 45 seconds per address)
COOLDOWN_KEY = 2
QUEUE_MAX = 6                  # more people than this have to wait for later: "busy"
TRIES = 12                     # how often one picture is tried when the service says "later" or does not answer ...
GIVE_UP = 150                  # ... but never longer than this many seconds after the first try (then the person gets the honest "overloaded")
KEEP = 600                     # seconds that a finished picture or a failure stays for the one who asked
MAX_BYTES = 3_000_000
TIMEOUT = (6, 75)

STYLES = {
    "free": "",
    "cartoon": "colorful cartoon illustration, clean shapes",
    "photo": "realistic photo, natural light, sharp",
    "paint": "oil painting, visible brush strokes",
    "pixel": "pixel art, 16-bit video game style",
    "anime": "anime style illustration",
    "render": "cute 3D render, soft light",
}

_lock = threading.Lock()
_jobs = {}                      # id -> job
_queue = []                     # ids that wait, the first one is next
_state = {"next": 0.0, "worker": False, "last": ""}


def key():
    return os.environ.get("POLLINATIONS_API_KEY", "").strip()


def cooldown():
    return COOLDOWN_KEY if key() else COOLDOWN


def clean_prompt(text):
    """The text of the person without line breaks and doubled blanks, cut to PROMPT_MAX, or "" when it is empty."""
    return re.sub(r"\s+", " ", str(text or "")).strip()[:PROMPT_MAX]


def allowed(text):
    """Nothing that a link, an address or a word of the list of Nex could turn into a picture."""
    return not (yipi_agents.sensitive(text) or re.search(r"https?:|www\.|\.(?:com|de|net|org|io)\b", text, re.I))


def english(text):
    """The text in English (the image models understand it best), or the text itself when the translation is not there. Short, one try."""
    if not os.environ.get("GROQ_API_KEY"):
        return text
    try:
        import ai_assistant
        answer = ai_assistant.generate_text("Translate the user's text into English for an image generator. Keep every person, animal, thing, colour and place of it; add nothing. "
                                            "Answer with the English text only, one line.", text, max_tokens=120, temperature=0)
    except Exception:  # noqa: BLE001
        return text
    answer = clean_prompt(str(answer).strip().strip('"'))
    return answer if answer and len(answer) <= PROMPT_MAX * 2 else text


def _retry_seconds(reply):
    """How long the service wants us to wait: its header or the 'Retry after 43s' in its message, with a little extra; at least 5, at most 120."""
    found = reply.headers.get("Retry-After", "")
    if not found.isdigit():
        match = re.search(r"[Rr]etry after (\d+)\s*s", reply.text[:600])
        found = match.group(1) if match else ""
    return max(5, min(120, int(found) + 2)) if found.isdigit() else cooldown()


def fetch(prompt, seed):
    """One try at Pollinations. Answers ("ok", bytes), ("wait", seconds) when the service says "later", or ("fail", "")."""
    token = key()
    try:
        if token:
            reply = requests.get(GEN + quote(prompt), params={"width": SIZE, "height": SIZE, "seed": seed, "safe": "true,nsfw"}, headers={"Authorization": f"Bearer {token}"},
                                 timeout=TIMEOUT, stream=True)
        else:
            reply = requests.get(CLASSIC + quote(prompt), params={"width": SIZE, "height": SIZE, "nologo": "true", "safe": "true", "model": "flux", "seed": seed},
                                 timeout=TIMEOUT, stream=True)
    except requests.RequestException:
        return "wait", 15
    try:
        if reply.status_code in (429, 503) or (reply.status_code == 402 and not token):
            seconds = _retry_seconds(reply)
            logger.info("Pollinations says later (%s): %s seconds.", reply.status_code, seconds)
            return "wait", seconds
        if reply.status_code != 200:
            logger.warning("Pollinations answered %s.", reply.status_code)
            return "fail", ""
        data = reply.raw.read(MAX_BYTES + 1, decode_content=True)
    except requests.RequestException:
        return "wait", 15
    finally:
        reply.close()
    if data and len(data) <= MAX_BYTES and (data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n"):
        return "ok", data
    return "fail", ""


def _expire(now):
    for job_id in [job_id for job_id, job in _jobs.items() if job["status"] in ("done", "error", "cancelled") and now - job["finished"] > KEEP]:
        _jobs.pop(job_id, None)


def _finish(job, status, **extra):
    job.update(status=status, finished=time.time(), **extra)


def _work():
    """The one worker: takes the first in the queue when the pause is over, asks Pollinations, and obeys when it says 'later'. Ends when nobody waits."""
    while True:
        with _lock:
            _expire(time.time())
            if not _queue:
                _state["worker"] = False
                return
            pause = _state["next"] - time.time()
            job = _jobs[_queue[0]] if pause <= 0 else None
            if job is not None:
                job["status"] = "working"
                job["first"] = job["first"] or time.time()
        if job is None:
            time.sleep(min(pause, 2))
            continue
        try:
            text = english(job["prompt"])
            style = STYLES.get(job["style"], "")
            outcome, value = fetch(f"{text}, {style}" if style else text, job["seed"])
        except Exception:  # noqa: BLE001
            logger.exception("The AI picture could not be made.")
            outcome, value = "fail", ""
        with _lock:
            job["tries"] += 1
            if job["status"] == "cancelled":                      # the person left: the picture is dropped
                if job["id"] in _queue:
                    _queue.remove(job["id"])
                _state["next"] = time.time() + cooldown()
                continue
            if outcome == "ok":
                _queue.remove(job["id"])
                _finish(job, "done", image=value)
                _state["next"] = time.time() + cooldown()
            elif outcome == "wait" and job["tries"] < TRIES and time.time() - job["first"] < GIVE_UP:
                job["status"] = "queued"
                _state["next"] = time.time() + value
            else:
                _queue.remove(job["id"])
                _finish(job, "error", error="ai_image_busy" if outcome == "wait" else "ai_image_failed")
                _state["next"] = time.time() + (value if outcome == "wait" else cooldown())


def submit(user_id, prompt, style):
    """Puts a request in the queue. Answers (job, "") or (None, error)."""
    prompt = clean_prompt(prompt)
    if not prompt:
        return None, "empty"
    if style not in STYLES:
        style = "free"
    if not allowed(prompt):
        return None, "bad_prompt"
    now = time.time()
    with _lock:
        _expire(now)
        mine = [job for job in _jobs.values() if job["user"] == user_id and job["status"] in ("queued", "working")]
        if mine:
            return None, "ai_image_running"
        if len(_queue) >= QUEUE_MAX:
            return None, "ai_image_full"
        job = {"id": uuid.uuid4().hex, "user": user_id, "prompt": prompt, "style": style, "seed": uuid.uuid4().int % 2_000_000_000, "status": "queued", "tries": 0, "created": now, "first": 0.0,
               "finished": 0.0, "image": None, "error": ""}
        _jobs[job["id"]] = job
        _queue.append(job["id"])
        if not _state["worker"]:
            _state["worker"] = True
            threading.Thread(target=_work, daemon=True).start()
    return job, ""


def describe(job):
    """What the browser may know: the state, the place in the queue (1 = this one is being made) and about how many seconds it will take."""
    with _lock:
        place = _queue.index(job["id"]) + 1 if job["id"] in _queue else 0
        wait = max(0, _state["next"] - time.time()) + (place - 1) * cooldown() + 12 if place else 0
    out = {"ok": True, "status": job["status"], "position": place, "wait": int(wait), "free": not key()}
    if job["status"] == "error":
        out["error"] = job["error"]
    return out


def cancel(job):
    with _lock:
        if job["status"] == "queued" and job["id"] in _queue:
            _queue.remove(job["id"])
            _finish(job, "cancelled")
        elif job["status"] == "working":
            job["status"] = "cancelled"                          # (the worker drops the picture when it arrives)
            job["finished"] = time.time()
        elif job["status"] in ("done", "error", "cancelled"):
            _jobs.pop(job["id"], None)                           # (fetched: the picture is not kept any longer)


def reset():
    """For the tests: nothing waits, nothing is kept."""
    with _lock:
        _jobs.clear()
        _queue.clear()
        _state.update(next=0.0, worker=False)


# ------------------------------------------------------------------------------------------------------------------ the routes
def register(route, need_user, body):
    fail = yipi.fail
    limiter = yipi.limiter

    def mine(job_id, user):
        job = _jobs.get(job_id)
        return job if job is not None and job["user"] == user.id else None

    @route("/api/yipi/ai-image", methods=["POST"], endpoint="yipi_ai_image")
    def yipi_ai_image():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("ai-image", str(user.id)):
            return fail("too_many", 429)
        job, error = submit(user.id, data.get("prompt"), str(data.get("style") or "free"))
        if job is None:
            return fail(error, 409 if error == "ai_image_running" else 503 if error == "ai_image_full" else 400)
        return jsonify(describe(job) | {"job": job["id"]})

    @route("/api/yipi/ai-image/<job_id>", methods=["GET", "DELETE"], endpoint="yipi_ai_image_job")
    def yipi_ai_image_job(job_id):
        user, problem = need_user()
        if problem:
            return problem
        if not re.fullmatch(r"[0-9a-f]{32}", job_id):
            return fail("not_found", 404)
        job = mine(job_id, user)
        if job is None:
            return fail("not_found", 404)
        if request.method == "DELETE":
            cancel(job)
            return jsonify({"ok": True})
        return jsonify(describe(job))

    @route("/api/yipi/ai-image/<job_id>/file", endpoint="yipi_ai_image_file")
    def yipi_ai_image_file(job_id):
        user, problem = need_user()
        if problem:
            return problem
        job = mine(job_id, user) if re.fullmatch(r"[0-9a-f]{32}", job_id) else None
        if job is None or job["status"] != "done" or not job["image"]:
            return fail("not_found", 404)
        kind = "image/png" if job["image"][:4] == b"\x89PNG" else "image/jpeg"
        return Response(job["image"], mimetype=kind, headers={"Cache-Control": "no-store", "Content-Disposition": "inline; filename=ki-bild"})
