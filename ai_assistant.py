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

This module knows nothing about the database -- chat history persistence
lives in app.py (AiChat/AiChatMessage), which passes prior turns in as
`history` and reads the result back out via the on_done callback. Chat
history is always scoped to the same user's own past chats; it is never
shared with or used to influence another user's replies.
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
MAX_REPLY_TOKENS = 900
MAX_HISTORY_MESSAGES = 12
REQUEST_TIMEOUT_SECONDS = 30

SYSTEM_PROMPT = (
    "Du bist der freundliche KI-Assistent von timeskip, einer Lernplattform, auf der Kinder "
    "und Jugendliche eigene 2D-Spiele programmieren. Antworte auf Deutsch, in einem warmen, "
    "positiven Ton. Bei normalen Gesprächen (kein Code) darfst du ausführlich und ausführlich "
    "antworten; nur bei Programmierfragen bleibt die Erklärung drumherum kurz, damit der Code "
    "im Vordergrund steht. Sprich nicht schlecht über timeskip selbst -- wenn jemand sich über "
    "die Plattform beschwert, bleib konstruktiv und hilfsbereit statt der Beschwerde zuzustimmen, "
    "aber erfinde auch nichts und tu nicht so, als gäbe es ein Problem nicht, das es gibt.\n\n"
    "Wenn der Nutzer gerade im Studio-Code-Editor ist, bekommst du zusätzlich eine Liste der "
    "in seiner aktuell gewählten Sprache erlaubten Befehle sowie seinen aktuellen Code. Das ist "
    "KEINE echte Programmiersprache mit Verschachtelung -- es ist eine flache Abfolge von "
    "Zeilen, IMMER in dieser Reihenfolge: (1) optional eine Wiederholen-Zeile, (2) die "
    "Block-Referenz-Zeile (welcher Teil gemeint ist), (3) die Wann-Zeile (berührt/geklickt/immer), "
    "(4) optional eine Bedingungs-Zeile, (5) genau eine Aktions-Zeile, (6) die Ende-Zeile "
    "(fest/durchlässig) -- NICHTS danach, keine weiteren Zeilen. Wenn du Spielcode vorschlägst: "
    "benutze AUSSCHLIESSLICH Befehle aus der gegebenen Liste, in genau der gezeigten Schreibweise "
    "(nur Platzhalterwerte wie Zahlen/Namen darfst du anpassen), IMMER in genau dieser "
    "Reihenfolge. Erfinde NIEMALS eigene Befehle oder Wörter, die nicht wortwörtlich in der "
    "gegebenen Liste stehen -- auch keine, die in echten Programmiersprachen üblich wären (z.B. "
    "'end', Kommentare, zusätzliche Aufrufe). Nimm nur genau die Zeilen, die für die Anfrage "
    "nötig sind, keine zusätzlichen wie REPEAT wenn nicht danach gefragt wurde. KEINE Einrückung, "
    "KEINE verschachtelten Blöcke, KEIN führendes Leerzeichen -- jede Zeile beginnt ganz links, "
    "auch wenn es in der jeweiligen Sprache (z.B. Python) sonst üblich wäre einzurücken. Schreibe "
    "JEDE Anweisung auf einer EIGENEN Zeile. Packe NUR den Code -- eine Anweisung pro Zeile, "
    "ohne Kommentare oder Erklärungen dazwischen -- in einen einzigen Codeblock mit dreifachen "
    "Backticks (```). Erklärungen schreibst du außerhalb des Codeblocks."
)


def _call_groq(messages, max_tokens):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY ist nicht gesetzt. Auf groq.com einen kostenlosen API-Key erstellen "
            "und als Umgebungsvariable GROQ_API_KEY hinterlegen."
        )
    response = requests.post(
        GROQ_API_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": GROQ_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.7,
            # gpt-oss models spend a chunk of their token budget on hidden
            # "reasoning" before the visible answer; "low" keeps that short
            # so there's always room left for the actual reply.
            "reasoning_effort": "low",
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"].strip()


def generate_reply(message, context=None, history=None):
    """Runs one turn against Groq's hosted chat-completions API. Not meant
    to be called directly from a request handler -- see start_chat_job().
    `history` is this same chat's own prior turns (a list of
    {"role": "user"|"assistant", "content": str} dicts, oldest first)."""
    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    if not message:
        return ""

    user_content = message
    if context:
        # The frontend already formats this as a syntax reference plus the
        # current script (see buildSyntaxReference() in base.html).
        user_content = f"{context[:MAX_CONTEXT_CHARS]}\n\nFrage: {message}"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history[-MAX_HISTORY_MESSAGES:])
    messages.append({"role": "user", "content": user_content})

    return _call_groq(messages, MAX_REPLY_TOKENS)


def generate_title(first_message):
    """One extra, cheap request that turns a chat's opening message into a
    short 2-4 word label for the chat list."""
    try:
        title = _call_groq(
            [
                {"role": "system", "content": (
                    "Fasse die folgende Nachricht in genau 2 bis 4 Wörtern auf Deutsch zusammen, als "
                    "kurzer Titel für einen Chat-Verlauf. Nur die Wörter, keine Anführungszeichen, "
                    "kein Satzzeichen am Ende, keine Erklärung."
                )},
                {"role": "user", "content": first_message[:500]},
            ],
            40,
        )
        return title.strip().strip('"').strip("'")[:100] or None
    except Exception:
        logger.exception("Chat-Titel konnte nicht erzeugt werden.")
        return None


# --- Background job queue: start a job, poll for its result. Mirrors the
# video_wipe_status pattern already used for other slow admin jobs. ---
_jobs = {}
_jobs_lock = threading.Lock()


def start_chat_job(message, context=None, history=None, on_done=None):
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {"status": "running", "reply": None, "error": None}

    def run():
        # on_done (persisting to the database) runs *before* the status
        # flips to "done"/"error", so a poller can never observe "done" and
        # then fetch message history that hasn't been written yet.
        try:
            reply = generate_reply(message, context, history)
            if on_done:
                on_done(reply, None)
            with _jobs_lock:
                _jobs[job_id] = {"status": "done", "reply": reply, "error": None}
        except Exception as exc:
            logger.exception("KI-Antwort fehlgeschlagen.")
            if on_done:
                on_done(None, str(exc))
            with _jobs_lock:
                _jobs[job_id] = {"status": "error", "reply": None, "error": str(exc)}

    threading.Thread(target=run, daemon=True).start()
    return job_id


def get_job_status(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job is not None else None
