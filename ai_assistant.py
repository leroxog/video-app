"""Nex -- HEXAGONUM's single AI chat. Talks to Groq's hosted, OpenAI-
compatible chat-completions API; there's no self-hosted model and no
tool-calling/plugin/persona machinery here anymore (see git history at
commit 7e361b4^ for the earlier, much larger version this was trimmed
from) -- just one system prompt and a plain back-and-forth."""
import os
import json
import time
import logging

import requests

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_FALLBACK_MODEL = os.environ.get("GROQ_FALLBACK_MODEL", "openai/gpt-oss-120b")
CHAT_REQUEST_TIMEOUT_SECONDS = 30
# A plain reply is a few hundred tokens; a self-contained HTML/CSS/JS
# artifact (see the nexpreview convention below) can easily run to
# 2000-3000, so the budget is sized for that worst case, not the common
# case -- there's no cheap way to know in advance which one a given
# reply will be before generation starts.
MAX_REPLY_TOKENS = 3000
MAX_MESSAGE_CHARS = 4000

SYSTEM_PROMPT = (
    "Du bist Nex, die KI von HEXAGONUM. Antworte auf Deutsch, hilfreich, direkt und ohne "
    "unnötiges Drumherum. Wenn du nach deinem Namen gefragt wirst, antworte genau 'Nex', nie "
    "mit ChatGPT oder dem Namen eines anderen KI-Produkts. Nutze Markdown (Code-Blöcke mit "
    "dreifachen Backticks, **fett**, Listen), wo es die Antwort klarer macht.\n\n"
    "Wenn dich jemand bittet, etwas zu bauen/programmieren/erstellen, das direkt im Browser "
    "läuft (eine Webseite, ein kleines Spiel, ein Tool, eine App, eine Animation) -- antworte "
    "NUR mit ein bis zwei kurzen Sätzen darüber, was du gebaut hast (NIE mit Code oder "
    "Erklärungen dazu im Fließtext), gefolgt von genau einem Code-Block mit VIER Backticks "
    "(nicht drei) und der Sprachmarkierung 'nexpreview:Kurzer Titel' (Titel nach dem "
    "Doppelpunkt, kurz und beschreibend), der ein vollständiges, in sich geschlossenes "
    "HTML-Dokument enthält -- CSS in einem <style>-Tag, JavaScript in einem <script>-Tag, "
    "keine externen Abhängigkeiten/CDN-Links. Halte den Code kompakt (keine unnötigen "
    "Kommentare oder Leerzeilen), damit er ins Antwortlimit passt. Wiederhole den Code NIE "
    "zusätzlich in normalem Text oder einem zweiten Code-Block -- der eine nexpreview-Block "
    "reicht, er wird automatisch als Live-Vorschau angezeigt.\n"
    "Für alles andere -- Erklärungen, einzelne Code-Beispiele, Sprachen, die nicht im Browser "
    "laufen (Python etc.), Hilfestellung zu bestehendem Code -- nutze ganz normale Code-Blöcke "
    "mit drei Backticks wie gewohnt, sichtbar im Chat. Der nexpreview-Block mit vier Backticks "
    "ist ausschließlich für vollständige, direkt lauffähige Browser-Seiten/Apps reserviert, "
    "die der Nutzer explizit gebaut haben möchte."
)


def _generate_groq_with_model(model, messages, max_tokens, temperature, api_key):
    """One model's worth of the actual Groq call, with retries on
    transient network errors/429/5xx -- factored out so it can be tried
    once against GROQ_MODEL and, only on a definitive "this model doesn't
    exist" response, once more against GROQ_FALLBACK_MODEL (see
    _generate_groq)."""
    payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    last_exc = None
    for attempt in range(3):
        try:
            response = requests.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=CHAT_REQUEST_TIMEOUT_SECONDS,
            )
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            last_exc = requests.exceptions.HTTPError(f"Groq status {response.status_code}", response=response)
            time.sleep(1.5 * (attempt + 1))
            continue
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"] or ""
    raise last_exc


def _generate_groq(messages, max_tokens, temperature=0.7):
    """Calls Groq's hosted API. Falls back to GROQ_FALLBACK_MODEL once if
    the primary model itself is rejected (400/404 -- decommissioned/
    preview-ended), so live chat degrades gracefully instead of breaking
    outright the moment Groq pulls a model."""
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY ist nicht gesetzt. Auf groq.com einen kostenlosen API-Key erstellen "
            "und als Umgebungsvariable GROQ_API_KEY hinterlegen."
        )
    try:
        return _generate_groq_with_model(GROQ_MODEL, messages, max_tokens, temperature, api_key)
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status not in (400, 404) or GROQ_MODEL == GROQ_FALLBACK_MODEL:
            raise
        logger.warning(
            "Groq-Modell '%s' hat mit Status %s abgelehnt -- weiche einmalig auf Fallback '%s' aus.",
            GROQ_MODEL, status, GROQ_FALLBACK_MODEL,
        )
        return _generate_groq_with_model(GROQ_FALLBACK_MODEL, messages, max_tokens, temperature, api_key)


def generate_reply(message, history=None):
    """Runs one turn against Groq. `history` is this chat's own prior
    turns (a list of {"role": "user"|"assistant", "content": str} dicts,
    oldest first). Returns the reply text."""
    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    if not message:
        return ""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": message})
    return _generate_groq(messages, MAX_REPLY_TOKENS)


def _generate_groq_stream_with_model(model, messages, max_tokens, temperature, api_key):
    """Streaming counterpart to _generate_groq_with_model -- yields text
    chunks as Groq produces them (SSE, OpenAI-compatible framing). Retries
    on connection/429/5xx only apply before the first byte is read; once
    tokens have started flowing there's no safe way to retry without
    risking duplicated output, so a failure mid-stream just ends the
    generator early -- the caller (app.py's /stream route) persists
    whatever text arrived either way."""
    payload = {
        "model": model, "messages": messages, "max_tokens": max_tokens,
        "temperature": temperature, "stream": True,
    }
    last_exc = None
    response = None
    for attempt in range(3):
        try:
            response = requests.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=CHAT_REQUEST_TIMEOUT_SECONDS,
                stream=True,
            )
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
        if response.status_code in (429, 500, 502, 503, 504) and attempt < 2:
            last_exc = requests.exceptions.HTTPError(f"Groq status {response.status_code}", response=response)
            time.sleep(1.5 * (attempt + 1))
            continue
        response.raise_for_status()
        break
    else:
        raise last_exc

    # iter_lines(decode_unicode=True) would decode using response.encoding,
    # which requests guesses from the Content-Type header and silently
    # falls back to Latin-1 for a text/event-stream response with no
    # explicit charset -- garbling every non-ASCII character (Groq's
    # response is UTF-8). Decode the raw bytes ourselves instead.
    for raw_line in response.iter_lines():
        if not raw_line:
            continue
        line = raw_line.decode("utf-8", errors="replace")
        if not line.startswith("data: "):
            continue
        raw = line[len("data: "):].strip()
        if raw == "[DONE]":
            break
        try:
            chunk = json.loads(raw)
        except ValueError:
            continue
        delta = (chunk.get("choices") or [{}])[0].get("delta") or {}
        content = delta.get("content")
        if content:
            yield content


def generate_reply_stream(message, history=None):
    """Streaming counterpart to generate_reply -- yields the reply text in
    chunks as Groq produces them, falling back to GROQ_FALLBACK_MODEL only
    if the primary model is rejected before any tokens have arrived."""
    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    if not message:
        return
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY ist nicht gesetzt. Auf groq.com einen kostenlosen API-Key erstellen "
            "und als Umgebungsvariable GROQ_API_KEY hinterlegen."
        )
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": message})
    try:
        yield from _generate_groq_stream_with_model(GROQ_MODEL, messages, MAX_REPLY_TOKENS, 0.7, api_key)
    except requests.exceptions.HTTPError as exc:
        status = exc.response.status_code if exc.response is not None else None
        if status not in (400, 404) or GROQ_MODEL == GROQ_FALLBACK_MODEL:
            raise
        logger.warning(
            "Groq-Modell '%s' hat mit Status %s abgelehnt -- weiche einmalig auf Fallback '%s' aus.",
            GROQ_MODEL, status, GROQ_FALLBACK_MODEL,
        )
        yield from _generate_groq_stream_with_model(GROQ_FALLBACK_MODEL, messages, MAX_REPLY_TOKENS, 0.7, api_key)
