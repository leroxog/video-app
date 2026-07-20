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

Also gives the assistant three live lookup tools (Groq/OpenAI-style
function calling, not model fine-tuning -- see the module docstring
discussion this was chosen over: Groq's API is inference-only, there is
no way to retrain/fine-tune the shared hosted model from this app):
search_wikipedia, get_weather, search_docs. These only run in general
chat mode (no Studio code `context` attached) -- the code-help prompt is
tuned tightly around timeskip's own flat DSL, and pulling in real
Python/JavaScript/Java/C# documentation there risks the model mixing in
real language syntax instead of the DSL.
"""
import os
import re
import json
import html
import logging
import threading
import uuid
import urllib.parse
import urllib.robotparser

import requests

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")
MAX_MESSAGE_CHARS = 2000
MAX_CONTEXT_CHARS = 4000
MAX_REPLY_TOKENS = 900
MAX_HISTORY_MESSAGES = 12
REQUEST_TIMEOUT_SECONDS = 30

TOOL_REQUEST_TIMEOUT_SECONDS = 8
MAX_TOOL_RESULT_CHARS = 1500
TOOL_USER_AGENT = "timeskip-studio-assistant/1.0 (+https://timeskip.up.railway.app)"

WIKIPEDIA_SEARCH_URL = "https://de.wikipedia.org/w/api.php"
WIKIPEDIA_SUMMARY_URL = "https://de.wikipedia.org/api/rest_v1/page/summary/{}"
OPEN_METEO_GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# Official documentation homepages the search_docs tool is allowed to look
# in -- each fetch still checks robots.txt before requesting anything, per
# "vorausgesetzt die jeweilige Webseite erlaubt es".
DOCS_SITES = {
    "python": "https://docs.python.org/3/",
    "javascript": "https://developer.mozilla.org/de/docs/Web/JavaScript",
    "html": "https://developer.mozilla.org/de/docs/Web/HTML",
    "java": "https://docs.oracle.com/en/java/javase/21/docs/api/index.html",
    "csharp": "https://learn.microsoft.com/de-de/dotnet/csharp/",
}

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

TOOLS_SYSTEM_ADDENDUM = (
    "\n\nDu hast Zugriff auf drei Werkzeuge: search_wikipedia (aktuelle Wissensfragen), "
    "get_weather (Live-Wetter für einen Ort) und search_docs (offizielle Dokumentation von "
    "Python, JavaScript, HTML, Java oder C#). Nutze sie, wenn eine Frage aktuelle, "
    "nachprüfbare Fakten braucht, statt zu raten oder dir etwas auszudenken."
)

AI_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_wikipedia",
            "description": (
                "Sucht einen Begriff auf der deutschen Wikipedia und liefert eine kurze "
                "Zusammenfassung des passendsten Artikels. Für allgemeine Wissensfragen "
                "(Geschichte, Wissenschaft, Personen, Orte, Begriffe usw.)."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "Suchbegriff"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Ruft das aktuelle Live-Wetter für einen Ort ab.",
            "parameters": {
                "type": "object",
                "properties": {"location": {"type": "string", "description": "Ortsname, z.B. 'Berlin'"}},
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_docs",
            "description": (
                "Durchsucht die offizielle Dokumentation einer Programmiersprache nach einem Begriff."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "language": {"type": "string", "enum": list(DOCS_SITES.keys())},
                    "query": {"type": "string", "description": "Suchbegriff"},
                },
                "required": ["language", "query"],
            },
        },
    },
]


def _strip_html(raw_html):
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw_html)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _tool_search_wikipedia(query):
    query = (query or "").strip()
    if not query:
        return "Kein Suchbegriff angegeben."
    try:
        search_res = requests.get(
            WIKIPEDIA_SEARCH_URL,
            params={"action": "query", "list": "search", "srsearch": query, "format": "json", "srlimit": 1},
            headers={"User-Agent": TOOL_USER_AGENT},
            timeout=TOOL_REQUEST_TIMEOUT_SECONDS,
        )
        search_res.raise_for_status()
        results = search_res.json().get("query", {}).get("search", [])
        if not results:
            return f"Kein Wikipedia-Artikel zu '{query}' gefunden."
        title = results[0]["title"]
        summary_res = requests.get(
            WIKIPEDIA_SUMMARY_URL.format(urllib.parse.quote(title)),
            headers={"User-Agent": TOOL_USER_AGENT},
            timeout=TOOL_REQUEST_TIMEOUT_SECONDS,
        )
        summary_res.raise_for_status()
        extract = summary_res.json().get("extract", "")
        return f"Wikipedia-Artikel \"{title}\":\n{extract[:MAX_TOOL_RESULT_CHARS]}"
    except Exception:
        logger.exception("Wikipedia-Abfrage fehlgeschlagen.")
        return "Die Wikipedia-Suche ist gerade nicht verfügbar."


def _tool_get_weather(location):
    location = (location or "").strip()
    if not location:
        return "Kein Ort angegeben."
    try:
        geo_res = requests.get(
            OPEN_METEO_GEOCODING_URL, params={"name": location, "count": 1, "language": "de"},
            headers={"User-Agent": TOOL_USER_AGENT}, timeout=TOOL_REQUEST_TIMEOUT_SECONDS,
        )
        geo_res.raise_for_status()
        geo_results = geo_res.json().get("results") or []
        if not geo_results:
            return f"Kein Ort namens '{location}' gefunden."
        place = geo_results[0]
        forecast_res = requests.get(
            OPEN_METEO_FORECAST_URL,
            params={
                "latitude": place["latitude"], "longitude": place["longitude"],
                "current": "temperature_2m,weather_code,wind_speed_10m",
            },
            headers={"User-Agent": TOOL_USER_AGENT}, timeout=TOOL_REQUEST_TIMEOUT_SECONDS,
        )
        forecast_res.raise_for_status()
        current = forecast_res.json().get("current", {})
        return (
            f"Aktuelles Wetter in {place.get('name', location)}: "
            f"{current.get('temperature_2m')}°C, Wind {current.get('wind_speed_10m')} km/h "
            f"(Wettercode {current.get('weather_code')})."
        )
    except Exception:
        logger.exception("Wetter-Abfrage fehlgeschlagen.")
        return "Die Wetterabfrage ist gerade nicht verfügbar."


def _docs_allowed(url):
    """robots.txt check -- "vorausgesetzt die jeweilige Webseite erlaubt es"."""
    try:
        parsed = urllib.parse.urlparse(url)
        parser = urllib.robotparser.RobotFileParser()
        parser.set_url(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
        parser.read()
        return parser.can_fetch(TOOL_USER_AGENT, url)
    except Exception:
        return False


def _tool_search_docs(language, query):
    query = (query or "").strip()
    base_url = DOCS_SITES.get((language or "").strip().lower())
    if not base_url:
        return f"Keine offizielle Dokumentation für '{language}' bekannt."
    if not query:
        return "Kein Suchbegriff angegeben."
    if not _docs_allowed(base_url):
        return f"Die Dokumentationsseite für {language} erlaubt kein automatisches Abrufen."
    try:
        domain = urllib.parse.urlparse(base_url).netloc
        search_res = requests.get(
            "https://html.duckduckgo.com/html/", params={"q": f"site:{domain} {query}"},
            headers={"User-Agent": TOOL_USER_AGENT}, timeout=TOOL_REQUEST_TIMEOUT_SECONDS,
        )
        search_res.raise_for_status()
        links = re.findall(r'href="(https?://[^"]*' + re.escape(domain) + r'[^"]*)"', search_res.text)
        if not links:
            return f"Keine passende Seite in der {language}-Dokumentation gefunden."
        page_url = html.unescape(links[0])
        if not _docs_allowed(page_url):
            return "Die gefundene Seite erlaubt kein automatisches Abrufen."
        page_res = requests.get(
            page_url, headers={"User-Agent": TOOL_USER_AGENT}, timeout=TOOL_REQUEST_TIMEOUT_SECONDS,
        )
        page_res.raise_for_status()
        text = _strip_html(page_res.text)
        return f"Aus der offiziellen {language}-Dokumentation ({page_url}):\n{text[:MAX_TOOL_RESULT_CHARS]}"
    except Exception:
        logger.exception("Dokumentations-Suche fehlgeschlagen.")
        return "Die Dokumentations-Suche ist gerade nicht verfügbar."


TOOL_IMPLEMENTATIONS = {
    "search_wikipedia": lambda args: _tool_search_wikipedia(args.get("query")),
    "get_weather": lambda args: _tool_get_weather(args.get("location")),
    "search_docs": lambda args: _tool_search_docs(args.get("language"), args.get("query")),
}


def _run_tool_calls(tool_calls):
    outputs = []
    for call in tool_calls:
        name = call.get("function", {}).get("name")
        try:
            args = json.loads(call.get("function", {}).get("arguments") or "{}")
        except (json.JSONDecodeError, TypeError):
            args = {}
        impl = TOOL_IMPLEMENTATIONS.get(name)
        result = impl(args) if impl else f"Unbekanntes Werkzeug: {name}"
        outputs.append({"role": "tool", "tool_call_id": call.get("id"), "content": result})
    return outputs


MAX_TOOL_ROUNDS = 3


def _call_groq_message(messages, max_tokens, tools=None, tool_choice="auto"):
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY ist nicht gesetzt. Auf groq.com einen kostenlosen API-Key erstellen "
            "und als Umgebungsvariable GROQ_API_KEY hinterlegen."
        )
    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.7,
        # gpt-oss models spend a chunk of their token budget on hidden
        # "reasoning" before the visible answer; "low" keeps that short
        # so there's always room left for the actual reply.
        "reasoning_effort": "low",
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice
    response = requests.post(
        GROQ_API_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json=payload,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]


def _call_groq(messages, max_tokens, tools=None):
    """Runs a tool-calling loop: as long as the model keeps requesting
    tools, executes them server-side and feeds the results back, up to
    MAX_TOOL_ROUNDS turns. On the last allowed turn, tool_choice is forced
    to "none" -- Groq errors ("tool choice is none, but model called a
    tool") if tools are omitted entirely from a follow-up call after the
    model has already started a tool-calling turn, so the schema stays
    attached and only the choice is what forces a final text answer."""
    current_messages = messages
    for round_index in range(MAX_TOOL_ROUNDS):
        is_last_round = round_index == MAX_TOOL_ROUNDS - 1
        message = _call_groq_message(
            current_messages, max_tokens, tools=tools,
            tool_choice="none" if is_last_round else "auto",
        )
        tool_calls = message.get("tool_calls")
        if not tool_calls:
            return (message.get("content") or "").strip()
        current_messages = current_messages + [message] + _run_tool_calls(tool_calls)
    return ""


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

    # Tools are only offered in general chat -- see the module docstring on
    # why Studio's code-help mode (context present) stays tool-free.
    system_prompt = SYSTEM_PROMPT if context else SYSTEM_PROMPT + TOOLS_SYSTEM_ADDENDUM
    tools = None if context else AI_TOOLS

    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history[-MAX_HISTORY_MESSAGES:])
    messages.append({"role": "user", "content": user_content})

    return _call_groq(messages, MAX_REPLY_TOKENS, tools=tools)


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
