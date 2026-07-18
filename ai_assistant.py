"""timeskip's built-in AI assistant -- used both as a general chatbot (the
floating widget in base.html) and as programming help inside timeskip
studio (where the user's current script is sent along as context).

Runs an open-source model (openai/gpt-oss-20b, Apache 2.0) hosted on Groq's
free inference API, since running even a small LLM directly on the server's
CPU turned out to take 1-6 minutes per reply in testing -- Groq's hosted
inference answers in well under a second. This means GROQ_API_KEY must be
set (locally in a .env file, on Railway as a project environment variable);
without it, requests fail with a clear error instead of hanging.

Requests still run through a background-thread job queue and are polled by
the client (see start_chat_job()/get_job_status()) even though Groq itself
is fast, since that keeps the API contract the same regardless of which
backend answers it and matches the run_video_wipe()-style pattern already
used elsewhere in this app for other async jobs.
"""
import os
import logging
import threading
import uuid

import requests

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
MAX_MESSAGE_CHARS = 2000
MAX_CONTEXT_CHARS = 4000
MAX_REPLY_TOKENS = 400
REQUEST_TIMEOUT_SECONDS = 30

SYSTEM_PROMPT = (
    "Du bist der freundliche KI-Assistent von timeskip, einer Lernplattform, auf der Kinder "
    "und Jugendliche eigene 2D-Spiele programmieren. Antworte kurz, einfach und auf Deutsch. "
    "Wenn nach Programmcode gefragt wird, hilf konkret beim Schreiben der Spielregeln."
)


def generate_reply(message, context=None):
    """Runs one turn against Groq's hosted chat-completions API. Not meant
    to be called directly from a request handler -- see start_chat_job()."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY ist nicht gesetzt. Auf groq.com einen kostenlosen API-Key erstellen "
            "und als Umgebungsvariable GROQ_API_KEY hinterlegen."
        )

    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    if not message:
        return ""

    user_content = message
    if context:
        user_content = f"Aktueller Code im Studio-Editor:\n{context[:MAX_CONTEXT_CHARS]}\n\nFrage: {message}"

    response = requests.post(
        GROQ_API_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": GROQ_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            "max_tokens": MAX_REPLY_TOKENS,
            "temperature": 0.7,
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    return data["choices"][0]["message"]["content"].strip()


# --- Background job queue: start a job, poll for its result. Mirrors the
# video_wipe_status pattern already used for other slow admin jobs. ---
_jobs = {}
_jobs_lock = threading.Lock()


def start_chat_job(message, context=None):
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {"status": "running", "reply": None, "error": None}

    def run():
        try:
            reply = generate_reply(message, context)
            with _jobs_lock:
                _jobs[job_id] = {"status": "done", "reply": reply, "error": None}
        except Exception as exc:
            logger.exception("KI-Antwort fehlgeschlagen.")
            with _jobs_lock:
                _jobs[job_id] = {"status": "error", "reply": None, "error": str(exc)}

    threading.Thread(target=run, daemon=True).start()
    return job_id


def get_job_status(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job is not None else None
