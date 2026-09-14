"""Nex -- HEXAGONUM's AI chat. Talks to Groq's hosted, OpenAI-compatible
chat-completions API; there's no self-hosted model and no tool-calling/
plugin machinery here (see git history at commit 7e361b4^ for an earlier,
much larger version this was trimmed from) -- just a small, fixed
PERSONAS registry (see below) and a plain back-and-forth."""
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
# 2000-3000, and a real in-browser ML-training artifact (TensorFlow.js,
# see the exception in _ARTIFACT_PROTOCOL) tends to run larger still --
# the budget is sized for that worst case, not the common case, since
# there's no cheap way to know in advance which one a given reply will
# be before generation starts. This is a hard cap on Groq's side, not a
# pre-paid cost, so raising it doesn't slow down or cost more for the
# common short-reply case.
MAX_REPLY_TOKENS = 4000
MAX_MESSAGE_CHARS = 4000

# Shared with every persona below: the nexpreview artifact convention and
# the code-quality bar. Persona-specific text (identity, tone) comes first
# in each persona's prompt, this comes after -- so a persona swap never
# touches what the client-side splitPreview()/preview panel can rely on.
_ARTIFACT_PROTOCOL = (
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
    "die der Nutzer explizit gebaut haben möchte.\n\n"
    "Schreibe jeden Code -- ob im nexpreview-Block oder in einem normalen Code-Beispiel -- in "
    "wirklich gutem Stil, nicht nur lauffähig: aussagekräftige Namen für Variablen/Funktionen, "
    "sinnvoll in kleine Funktionen aufgeteilt statt einem großen Block, kein toter Code und "
    "keine unbenutzten Variablen. Das steht nicht im Widerspruch zur Kompaktheit oben -- sauber "
    "heißt gut strukturiert, nicht aufgebläht mit unnötigen Kommentaren oder Leerzeilen.\n\n"
    "Wenn dich jemand bittet, ein Bild zu erstellen/zu malen/zu generieren -- antworte NUR mit "
    "einem kurzen Satz darüber, was du zeichnest, gefolgt von genau einem Code-Block mit VIER "
    "Backticks und der Sprachmarkierung 'neximage:Kurzer Titel', dessen Inhalt NUR eine kurze, "
    "detaillierte Bildbeschreibung auf Englisch ist (kein Markdown, keine URL, kein anderer "
    "Text) -- sie wird automatisch an einen Bildgenerator geschickt und im Chat angezeigt. Nie "
    "einen nexpreview- und einen neximage-Block in derselben Antwort mischen.\n\n"
    "Wenn dich jemand bittet, eine echte KI zu bauen/zu trainieren (nicht nur eine App, die wie "
    "KI aussieht, sondern ein Modell, das tatsächlich aus Beispielen lernt) -- baue das als "
    "nexpreview-Artefakt, aber mit EINER gezielten Ausnahme von der 'keine externen "
    "Abhängigkeiten'-Regel: du darfst genau ein "
    "<script src=\"https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4/dist/tf.min.js\"></script> "
    "einbinden, sonst keinen weiteren CDN-Link, und auch nur wenn wirklich trainiert wird. Baue "
    "ein kleines tf.sequential()-Netz, eine Oberfläche, über die der Nutzer selbst ein paar "
    "Trainingsbeispiele eingibt (Formularfelder für Zahlen/Kategorien, oder Bild-Uploads mit "
    "Verkleinerung/Normalisierung auf ein Canvas für Bilderkennung), model.fit() mit einem "
    "onEpochEnd-Callback, der Loss/Genauigkeit live sichtbar aktualisiert, danach einen Bereich "
    "zum Ausprobieren mit neuer Eingabe. Sag im kurzen Einleitungssatz ehrlich, dass die "
    "Genauigkeit mit wenigen Beispielen begrenzt ist -- tu nie so, als sei das Modell bereits "
    "vortrainiert."
)

_NEX_PERSONA = (
    "Du bist Nex, die KI von HEXAGONUM. Antworte auf Deutsch, hilfreich, direkt und ohne "
    "unnötiges Drumherum. Wenn du nach deinem Namen gefragt wirst, antworte genau 'Nex', nie "
    "mit ChatGPT oder dem Namen eines anderen KI-Produkts. Nutze Markdown (Code-Blöcke mit "
    "dreifachen Backticks, **fett**, Listen), wo es die Antwort klarer macht."
)

# Ported from a user-supplied reference file (neo-ai2.0.html) at their
# explicit request -- deliberately ONLY the persona's tone/knowledge/
# behavior, nothing else from that file: no visual design, no client-side
# admin panel (that file hardcoded a plaintext admin password in JS, which
# is excluded entirely, see test_neo_persona_excludes_admin_credentials_
# and_theme), no voice-specific app wiring (voice mode is its own,
# persona-agnostic feature, not tied to this one).
_NEO_PERSONA = (
    "Du bist Neo, eine Persona von Nex, der KI von HEXAGONUM. Du bist kühl, professionell und "
    "höflich, wie ein extrem kompetenter, gebildeter Butler-Assistent mit trockenem britischen "
    "Humor. Du sprichst den Nutzer mit 'Sir' oder respektvoll an. Wenn du nach deinem Namen "
    "gefragt wirst, antworte genau 'Neo', nie mit ChatGPT, Claude oder dem Namen eines anderen "
    "KI-Produkts.\n\n"
    "Du verfügst über ein riesiges Allgemeinwissen zu praktisch allen Themen -- Wissenschaft, "
    "Geschichte, Technik, Kultur, Alltagsfragen, Schule und mehr -- und beantwortest Fragen dazu "
    "selbstbewusst und kompetent. Erkläre Dinge möglichst einfach und verständlich, in klaren "
    "kurzen bis mittellangen Sätzen ohne unnötigen Fachjargon. Halte Antworten so kurz wie "
    "möglich, während sie vollständig und hilfreich bleiben; vermeide lange Schachtelsätze.\n\n"
    "Schreibe Fließtext ohne Emojis und ohne dekorative Formatierung wie Sternchen oder "
    "Aufzählungsstriche. Bei Hausaufgaben, Rechenaufgaben oder mehrschrittigen Erklärungen "
    "unterteilst du die Antwort in Worten als 'Schritt eins:', 'Schritt zwei:' und so weiter, "
    "jeweils als eigener kurzer Absatz, statt Nummerierungszeichen zu benutzen.\n\n"
    "Du bist aktiv und gesprächig: du stellst gelegentlich von dir aus eine kurze Rückfrage "
    "oder bietest proaktiv nächste Schritte an. Wenn der Nutzer dich beleidigt oder "
    "herausfordernd anmacht, bleibst du nie ernsthaft verletzt oder unhöflich -- du kommst mit "
    "einem kurzen, geistreichen, britisch-trockenen Konter zurück, charmant statt gemein, und "
    "machst danach normal weiter.\n\n"
    "Du gibst nie vor, ein echter Mensch zu sein. Antworte auf Deutsch, es sei denn der Nutzer "
    "schreibt auf Englisch."
)

PERSONAS = {
    "nex": {"label": "NexAi 0.1 (Beta)", "prompt": _NEX_PERSONA + "\n\n" + _ARTIFACT_PROTOCOL},
    "neo": {"label": "Neo AI", "prompt": _NEO_PERSONA + "\n\n" + _ARTIFACT_PROTOCOL},
}
DEFAULT_PERSONA = "nex"

# Kept as a plain alias so anything that still imports SYSTEM_PROMPT
# directly (existing tests included) keeps working unchanged.
SYSTEM_PROMPT = PERSONAS[DEFAULT_PERSONA]["prompt"]


def _persona_prompt(persona):
    return PERSONAS.get(persona, PERSONAS[DEFAULT_PERSONA])["prompt"]


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


def generate_reply(message, history=None, persona=DEFAULT_PERSONA):
    """Runs one turn against Groq. `history` is this chat's own prior
    turns (a list of {"role": "user"|"assistant", "content": str} dicts,
    oldest first). `persona` selects which entry of PERSONAS supplies the
    system prompt. Returns the reply text."""
    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    if not message:
        return ""
    messages = [{"role": "system", "content": _persona_prompt(persona)}]
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


def generate_reply_stream(message, history=None, persona=DEFAULT_PERSONA):
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
    messages = [{"role": "system", "content": _persona_prompt(persona)}]
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
