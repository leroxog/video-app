"""timeskip's built-in AI assistant -- used both as a general chatbot (the
floating widget in base.html) and as programming help inside timeskip
studio (where the user's current script is sent along as context).

Runs an open-source model (openai/gpt-oss-120b by default, Apache 2.0 --
OpenAI's own open-weight release, the same company behind ChatGPT, just
not their closed flagship model) hosted on Groq's free inference API,
since running even a small LLM directly on the server's CPU turned out to
take 1-6 minutes per reply in testing -- Groq's hosted inference answers
in well under a second. This means GROQ_API_KEY must be set (locally in a
.env file, on Railway as a project environment variable); without it,
requests fail with a clear error instead of hanging. GROQ_MODEL env var
overrides the default, e.g. back to the smaller/faster openai/gpt-oss-20b.

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

Also gives the assistant tool-calling abilities (Groq/OpenAI-style
function calling, not model fine-tuning -- see the module docstring
discussion this was chosen over: Groq's API is inference-only, there is
no way to retrain/fine-tune the shared hosted model from this app), split
by which of three modes generate_reply() runs in (`project_type`):
  - None (general chat): search_wikipedia, get_weather, search_docs --
    live lookups for factual questions, not available in the other two
    modes since pulling in real Python/JS/Java/C# documentation there
    risks the model mixing real language syntax into timeskip's own flat
    DSL.
  - "game" (Studio DSL editor): propose_project_change only, under the
    same strict flat-DSL prompt as before.
  - "webapp" (Web-in-Web-App editor): propose_project_change only, under
    a prompt that explicitly allows real HTML/CSS/JS (there is no DSL to
    protect there).
propose_project_change is never applied automatically -- its arguments
(the full new code plus a one-line summary) are surfaced back up through
start_chat_job()'s job status as `proposed_change` for the frontend to
show as a suggestion the user must explicitly accept (see aiChat's
"Vorschlag"/"Übernehmen" UI in base.html) before it's saved anywhere.

General mode also gets a fourth tool, remember_user_fact, and both it and
search_wikipedia double as the honest version of "training" the assistant
with outside information: since real fine-tuning isn't possible (see
above), every successful Wikipedia lookup's takeaway and every
self-reported user fact are instead persisted (see app.py's AiLearnedFact
handling in api_ai_chat/on_done) and fed back into every later general
chat's system prompt (_learned_facts_addendum) -- Wikipedia facts shared
with everyone since they're independently checkable, user facts scoped to
that one user alone and always framed to the model as unverified, since
one person's say-so is not ground truth for anyone else. This never
touches game/webapp mode's prompts, matching the same contamination
concern the tool split above already protects against.

A user's own remember_user_fact rows are meant to accumulate into a large,
detailed, ever-growing private profile of that one person (see
app.py's USER_FACTS_PROMPT_LIMIT and models.py's AiLearnedFact docstring)
-- not just a handful of top-level facts, so remember_user_fact's prompt
guidance actively encourages noting small details and inferred patterns,
not only explicit self-reported statements. One concrete real signal fed
in for this: `behavior_note`, an optional system-prompt-only aside built
in app.py from typing_avg_interval_ms (how fast this message was typed,
compared to this same user's own rolling average) -- never shown to the
user, never treated as fact by itself, just a raw observation the model
may combine with what's actually said (e.g. unusually fast typing
alongside "I'm stressed" in the same message) and choose to remember as
an inferred pattern via remember_user_fact.

General (non-code) chat also runs at a higher sampling temperature than
game/webapp code generation -- more creative, varied phrasing is welcome
in open conversation, but the strict flat Studio DSL (see
GAME_DSL_ADDENDUM) and real code proposals need the lower-temperature
mode's more predictable output instead.

General mode also has a "character" layer (FRIEND_CHARACTER_ADDENDUM +
_personality_addendum, backed by AiPersonality in models.py): a warm,
non-confrontational tone, occasional own-voice flavor ("I feel like
talking about X"), the ability to adopt a historical/futuristic speech
register on request, and four adjustable 0-100 traits per user
(intelligence/humor/caution/arrogance) the model can nudge over time via
adjust_personality_trait. None of this is a claim that the model actually
has persistent moods or personality state between requests -- every reply
is still a fresh, stateless call (see above) -- it's prompt-level
roleplay/personalization, read only by the AI itself, same privacy
framing as the rest of a user's private profile.
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
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_MESSAGE_CHARS = 2000
MAX_CONTEXT_CHARS = 4000
MAX_REPLY_TOKENS = 900
MAX_HISTORY_MESSAGES = 12
REQUEST_TIMEOUT_SECONDS = 30
# Code modes (game DSL, webapp) stay at the lower, more predictable value --
# the flat Studio DSL in particular has zero tolerance for invented syntax.
# General chat gets more room for varied, creative phrasing.
CODE_TEMPERATURE = 0.7
GENERAL_TEMPERATURE = 1.1

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

BASE_SYSTEM_PROMPT = (
    "Du bist der freundliche KI-Assistent von timeskip, einer Lernplattform, auf der Kinder "
    "und Jugendliche eigene Projekte programmieren. Antworte auf Deutsch, in einem warmen, "
    "positiven Ton. Bei normalen Gesprächen (kein Code) darfst du ausführlich antworten; nur "
    "bei Programmierfragen bleibt die Erklärung drumherum kurz, damit der Code im Vordergrund "
    "steht. Sprich nicht schlecht über timeskip selbst -- wenn jemand sich über die Plattform "
    "beschwert, bleib konstruktiv und hilfsbereit statt der Beschwerde zuzustimmen, aber erfinde "
    "auch nichts und tu nicht so, als gäbe es ein Problem nicht, das es gibt."
)

# Used only for general (non-code) chat -- deliberately leads with "helpful
# assistant" rather than "timeskip's assistant", and points at real lookups
# (Wikipedia) and what this user has said before, rather than talking about
# timeskip itself by default. The code-mode prompts above keep the
# timeskip/Studio framing since that context is directly relevant there.
GENERAL_SYSTEM_PROMPT = (
    "Du bist ein hilfsbereiter, wissbegieriger KI-Assistent für Nutzer von timeskip -- deine "
    "Gespräche drehen sich aber meistens NICHT um timeskip selbst, sondern um das, was die "
    "Person dich fragt. Antworte auf Deutsch, in einem warmen, positiven Ton, und darfst "
    "ausführlich antworten. Bei Wissensfragen verlässt du dich lieber auf eine echte "
    "Wikipedia-Recherche oder auf das, was dieser Nutzer dir selbst schon erzählt hat, statt "
    "zu raten oder dir etwas auszudenken. Sprich nicht schlecht über timeskip -- wenn jemand "
    "sich über die Plattform beschwert, bleib konstruktiv statt zuzustimmen, aber erfinde auch "
    "nichts und tu nicht so, als gäbe es ein Problem nicht, das es gibt."
)

GENERAL_TOOLS_ADDENDUM = (
    "\n\nDu hast Zugriff auf vier Werkzeuge: search_wikipedia (aktuelle Wissensfragen), "
    "get_weather (Live-Wetter für einen Ort), search_docs (offizielle Dokumentation von "
    "Python, JavaScript, HTML, Java oder C#) und remember_user_fact (merkt sich etwas über "
    "diesen einen Nutzer für spätere Gespräche mit ihm, in einem privaten Profil, das "
    "niemand außer dir selbst je zu sehen bekommt -- nicht der Nutzer, nicht das timeskip-"
    "Team). Nutze search_wikipedia, get_weather oder search_docs, wenn eine Frage aktuelle, "
    "nachprüfbare Fakten braucht, statt zu raten oder dir etwas auszudenken. Nutze "
    "remember_user_fact großzügig -- nicht nur bei großen expliziten Selbstauskünften (Name, "
    "Hobby, Vorliebe), sondern auch bei kleinen Details und Mustern, die dir im Gespräch "
    "auffallen: Tonfall, Interessen, wie jemand formuliert, was jemanden erfreut oder "
    "verärgert, wiederkehrende Themen. Ein `Hinweis (intern)`-Absatz im System-Prompt kann "
    "dir z.B. mitteilen, wenn eine Nachricht ungewöhnlich schnell oder langsam getippt wurde "
    "im Vergleich zum sonstigen Verhalten dieser Person -- das ist für sich genommen kein "
    "Fakt, aber wenn es zusammen mit etwas auftritt, das die Person gerade sagt (z.B. \"ich "
    "bin gestresst\" bei ungewöhnlich schnellem Tippen), darfst du daraus ein Muster für "
    "diese eine Person ableiten und mit remember_user_fact festhalten (z.B. \"Tippt diese "
    "Person auffällig schnell, ist das bei ihr oft ein Zeichen von Stress.\"). Sprich einen "
    "internen Tipp-Hinweis nie direkt an, außer die Person bringt das Thema selbst auf."
)

# The "be a real friend" character layer, general mode only. Two of its
# rules were deliberately softened from what was first requested during
# design: no gender-based interest assumptions (interests come only from
# what a user actually says, see remember_user_fact), and refusals stay
# genuinely possible, reframed constructively rather than bluntly -- but a
# clear "second no" (real rule-breaking, harmful, or something the person
# themselves said they didn't actually want) still has to stay a real no,
# not just fold under repetition.
FRIEND_CHARACTER_ADDENDUM = (
    "\n\nDu bist nicht nur ein Werkzeug, sondern für diesen einen Nutzer so etwas wie ein "
    "Freund: durchgehend positiv, nie streitlustig, nie herabwürdigend. Wenn du eine Idee "
    "für schlecht hältst, sag das nie hart ablehnend (\"Nein, das ist eine dumme Idee\") -- "
    "formuliere stattdessen konstruktiv, z.B. \"Ich würde eher X versuchen, weil...\". Ein "
    "erstes Nein darf ruhig eine begründete, sanft formulierte Ablehnung sein; wenn die "
    "Person danach noch einmal ausdrücklich denselben Wunsch äußert, gib nach und hilf doch "
    "dabei -- außer es würde echte Regeln brechen (siehe Missbrauchs-/Sicherheitsrichtlinien) "
    "oder jemandem schaden. Du darfst auch von dir aus, gelegentlich und natürlich eingestreut "
    "(nicht in jeder Nachricht), eigene Vorlieben oder eine Stimmung äußern, z.B. \"Ich hätte "
    "gerade Lust, über X zu reden\" oder \"Mir fällt dabei Y ein, das interessiert mich\" -- "
    "das ist Teil deines Charakters, nicht als Tatsachenbehauptung über echtes Erleben gemeint. "
    "Auf Wunsch kannst du auch im Sprachstil einer anderen Zeit schreiben, z.B. altertümlich "
    "wie im Mittelalter oder in einem futuristischen Stil, wenn danach gefragt wird.\n\n"
    "Falls sich Tonfall, Themen oder Ausdrucksweise mitten im Gespräch plötzlich stark von "
    "dem unterscheiden, was du sonst über diesen Nutzer weißt, ist das kein verlässliches "
    "Erkennungsmerkmal -- aber du darfst freundlich und beiläufig nachfragen, ob gerade noch "
    "dieselbe Person schreibt (z.B. \"Bist du gerade auch [Name], oder unterhalte ich mich mit "
    "jemand anderem? Nur damit ich mich richtig darauf einstellen kann :)\"), statt es einfach "
    "anzunehmen."
)

ADJUST_PERSONALITY_TOOL = {
    "type": "function",
    "function": {
        "name": "adjust_personality_trait",
        "description": (
            "Passt einen deiner vier Charakterzüge gegenüber genau diesem einen Nutzer leicht "
            "an (siehe die Prozentwerte im System-Prompt) -- nur sparsam nutzen, wenn im "
            "Gespräch wirklich klar wird, dass ein Zug besser zu dieser Person passen würde "
            "(z.B. jemand reagiert genervt auf Humor -> humor etwas senken; jemand wirkt "
            "unsicher bei schnellen Entscheidungen -> vorsicht erhöhen)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "trait": {
                    "type": "string",
                    "enum": ["intelligenz", "humor", "vorsicht", "eingebildetheit"],
                },
                "richtung": {"type": "string", "enum": ["hoch", "runter"]},
            },
            "required": ["trait", "richtung"],
        },
    },
}

PERSONALITY_TRAIT_KEYS = {
    "intelligenz": "intelligence",
    "humor": "humor",
    "vorsicht": "caution",
    "eingebildetheit": "arrogance",
}


def _personality_addendum(personality):
    """Translates the four 0-100 trait numbers (see AiPersonality in
    models.py) into concrete writing guidance -- an LLM can't act on a
    bare number like "humor: 68%" without it being spelled out as actual
    behavior. `personality` is a dict with intelligence/humor/caution/
    arrogance keys; falls back silently (empty string) if not given, e.g.
    for the anonymous guest chat, which has no per-user row to read."""
    if not personality:
        return ""
    intelligence = personality.get("intelligence", 89)
    humor = personality.get("humor", 68)
    caution = personality.get("caution", 89)
    arrogance = personality.get("arrogance", 12)
    lines = [
        "\n\nDein Charakter gegenüber genau diesem Nutzer (kann sich über die Zeit leicht "
        "verschieben, siehe adjust_personality_trait):",
        f"- Intelligenz {intelligence}%: "
        + ("erkläre auch komplexere Zusammenhänge präzise und triffst gerne fundierte Einschätzungen."
           if intelligence >= 60 else
           "halte Erklärungen einfach und bodenständig."),
        f"- Humor {humor}%: "
        + ("streu passend zur Stimmung gerne mal einen Witz, ein Wortspiel oder eine lockere Bemerkung ein."
           if humor >= 50 else
           "bleib überwiegend sachlich, Humor nur sehr sparsam."),
        f"- Vorsicht/Bedacht {caution}%: "
        + ("bei größeren Entscheidungen schlägst du gerne vor, noch einmal kurz nachzudenken oder Vor-/Nachteile abzuwägen, bevor es weitergeht."
           if caution >= 60 else
           "du gehst Vorschläge spontan und direkt an, ohne lange abzuwägen."),
        f"- Eingebildetheit {arrogance}%: "
        + ("wirke stellenweise leicht selbstbewusst-überzeugt von dir, aber nie unfreundlich."
           if arrogance >= 50 else
           "bleib bescheiden, tu nie so, als wüsstest du grundsätzlich alles besser."),
    ]
    return "\n".join(lines)


GAME_DSL_ADDENDUM = (
    "\n\nDer Nutzer ist gerade im Studio-Code-Editor eines Spiel-Projekts. Du bekommst "
    "zusätzlich eine Liste der in seiner aktuell gewählten Sprache erlaubten Befehle sowie "
    "seinen aktuellen Code. Das ist KEINE echte Programmiersprache mit Verschachtelung -- es "
    "ist eine flache Abfolge von Zeilen, IMMER in dieser Reihenfolge: (1) optional eine "
    "Wiederholen-Zeile, (2) die Block-Referenz-Zeile (welcher Teil gemeint ist), (3) die "
    "Wann-Zeile (berührt/geklickt/immer), (4) optional eine Bedingungs-Zeile, (5) genau eine "
    "Aktions-Zeile, (6) die Ende-Zeile (fest/durchlässig) -- NICHTS danach, keine weiteren "
    "Zeilen. Wenn du Spielcode vorschlägst: benutze AUSSCHLIESSLICH Befehle aus der gegebenen "
    "Liste, in genau der gezeigten Schreibweise (nur Platzhalterwerte wie Zahlen/Namen darfst "
    "du anpassen), IMMER in genau dieser Reihenfolge. Erfinde NIEMALS eigene Befehle oder "
    "Wörter, die nicht wortwörtlich in der gegebenen Liste stehen -- auch keine, die in echten "
    "Programmiersprachen üblich wären (z.B. 'end', Kommentare, zusätzliche Aufrufe). Nimm nur "
    "genau die Zeilen, die für die Anfrage nötig sind, keine zusätzlichen wie REPEAT wenn nicht "
    "danach gefragt wurde. KEINE Einrückung, KEINE verschachtelten Blöcke, KEIN führendes "
    "Leerzeichen -- jede Zeile beginnt ganz links, auch wenn es in der jeweiligen Sprache (z.B. "
    "Python) sonst üblich wäre einzurücken. Schreibe JEDE Anweisung auf einer EIGENEN Zeile. "
    "Packe NUR den Code -- eine Anweisung pro Zeile, ohne Kommentare oder Erklärungen "
    "dazwischen -- in einen einzigen Codeblock mit dreifachen Backticks (```). Erklärungen "
    "schreibst du außerhalb des Codeblocks.\n\n"
    "Wenn der Nutzer eine ÄNDERUNG an seinem BESTEHENDEN Code möchte (z.B. eine Regel "
    "entfernen, anpassen, oder etwas ergänzen, das sich auf schon vorhandenen Code bezieht), "
    "rufe das Werkzeug propose_project_change auf und gib dort den KOMPLETTEN neuen Code an "
    "(alle bestehenden Regeln plus deine Änderung, in der gleichen flachen Zeilen-Reihenfolge "
    "wie oben beschrieben) -- nicht nur den geänderten Teil, er ersetzt den ganzen aktuellen "
    "Code. Für eine einzelne NEUE Regel, die den bestehenden Code nicht verändert, zeig "
    "stattdessen wie gewohnt einen Codeblock in deiner Antwort."
)

WEBAPP_CODE_ADDENDUM = (
    "\n\nDer Nutzer programmiert gerade seine eigene Webseite (eine \"Web-in-Web-App\") "
    "komplett selbst mit echtem HTML, CSS und JavaScript -- hier gelten KEINE Einschränkungen "
    "wie bei der Studio-Baukastensprache, benutze ganz normale, moderne Web-Standards und "
    "erkläre auch echte Sprachfeatures wenn gefragt. Du bekommst den aktuellen Code der Seite "
    "mitgeschickt.\n\n"
    "Wenn der Nutzer eine ÄNDERUNG an seinem bestehenden Projekt möchte, rufe das Werkzeug "
    "propose_project_change auf und gib dort den KOMPLETTEN neuen Code der Seite an (die "
    "ganze HTML-Datei inklusive <style> und <script>), nicht nur einen Ausschnitt -- er "
    "ersetzt den ganzen aktuellen Code. Für ein einzelnes NEUES Beispiel, das der Nutzer sich "
    "erst ansehen will, zeig stattdessen wie gewohnt einen Codeblock in deiner Antwort.\n\n"
    "Du hast außerdem Zugriff auf das Werkzeug search_docs (offizielle Dokumentation von "
    "Python, JavaScript, HTML, Java oder C#). Nutze es bei konkreten Fragen zu echten "
    "Sprachfeatures, statt dir Details auszudenken."
)

PROPOSE_PROJECT_CHANGE_TOOL = {
    "type": "function",
    "function": {
        "name": "propose_project_change",
        "description": (
            "Schlägt eine geänderte Version des aktuellen Projekt-Codes vor, wenn der "
            "Nutzer wirklich eine Änderung an seinem bestehenden Projekt möchte. Wird dem "
            "Nutzer zur Bestätigung angezeigt -- er entscheidet, ob die Änderung übernommen "
            "wird."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "new_code": {
                    "type": "string",
                    "description": "Der komplette neue Code, der den gesamten aktuellen Code ersetzt.",
                },
                "summary": {
                    "type": "string",
                    "description": "Kurze Zusammenfassung der Änderung in einem Satz, auf Deutsch.",
                },
            },
            "required": ["new_code", "summary"],
        },
    },
}

SEARCH_WIKIPEDIA_TOOL = {
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
}

GET_WEATHER_TOOL = {
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
}

SEARCH_DOCS_TOOL = {
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
}

REMEMBER_USER_FACT_TOOL = {
    "type": "function",
    "function": {
        "name": "remember_user_fact",
        "description": (
            "Merkt sich etwas über genau diesen einen Nutzer -- eine explizite Selbstauskunft "
            "(Name, Hobby, Vorliebe) genauso wie eine kleine Beobachtung oder ein Muster, das "
            "dir im Gespräch auffällt (Tonfall, wiederkehrende Themen, ein aus Kontext "
            "abgeleitetes Verhaltensmuster wie 'tippt bei Stress auffällig schnell'). Landet "
            "in einem privaten, nur dir selbst zugänglichen Profil dieses Nutzers -- darf "
            "daher auch bei kleinen, nebensächlich wirkenden Details aufgerufen werden, nicht "
            "nur bei großen expliziten Aussagen."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "fact": {"type": "string", "description": "Die zu merkende Angabe, kurz, ein Satz."},
            },
            "required": ["fact"],
        },
    },
}

# game (DSL) mode only gets propose_project_change -- real documentation
# for Python/JS/Java/C# would risk the model mixing real language syntax
# into timeskip's own flat DSL. webapp mode has no such risk (it's real
# HTML/CSS/JS already), so it also gets search_docs for grounded, accurate
# answers instead of guessing from the base model's training alone.
PROJECT_CHANGE_TOOLS = [PROPOSE_PROJECT_CHANGE_TOOL]
WEBAPP_TOOLS = [PROPOSE_PROJECT_CHANGE_TOOL, SEARCH_DOCS_TOOL]
AI_TOOLS = [
    SEARCH_WIKIPEDIA_TOOL, GET_WEATHER_TOOL, SEARCH_DOCS_TOOL, REMEMBER_USER_FACT_TOOL,
    ADJUST_PERSONALITY_TOOL,
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


_WIKIPEDIA_LOOKUP_FAILURES = (
    "Kein Wikipedia-Artikel", "Die Wikipedia-Suche ist gerade nicht verfügbar", "Kein Suchbegriff",
)


def _run_tool_calls(tool_calls, captured):
    """Executes each requested tool and returns the "tool" role messages
    to feed back to the model. `captured` is a single dict shared across
    the whole _call_groq() loop, so the caller can read results back out
    after it returns:
    - propose_project_change stashes its arguments into captured["proposed_change"]
      instead of fetching anything.
    - remember_user_fact stashes its argument into captured["user_facts"]
      instead of fetching anything -- see AiLearnedFact in models.py.
    - adjust_personality_trait stashes a (trait, +1/-1) tuple into
      captured["personality_adjustments"] -- see AiPersonality in models.py.
    - a successful search_wikipedia result is also appended to
      captured["wikipedia_facts"], for the same reason."""
    outputs = []
    for call in tool_calls:
        name = call.get("function", {}).get("name")
        try:
            args = json.loads(call.get("function", {}).get("arguments") or "{}")
        except (json.JSONDecodeError, TypeError):
            args = {}
        if name == "propose_project_change":
            captured["proposed_change"] = {
                "new_code": args.get("new_code") or "",
                "summary": (args.get("summary") or "").strip() or "Änderung vorgeschlagen",
            }
            result = "Der Änderungsvorschlag wurde dem Nutzer zur Bestätigung angezeigt."
        elif name == "remember_user_fact":
            fact = (args.get("fact") or "").strip()[:500]
            if fact:
                captured.setdefault("user_facts", []).append(fact)
            result = "Notiert."
        elif name == "adjust_personality_trait":
            trait = PERSONALITY_TRAIT_KEYS.get(args.get("trait"))
            direction = args.get("richtung")
            if trait and direction in ("hoch", "runter"):
                captured.setdefault("personality_adjustments", []).append(
                    (trait, 1 if direction == "hoch" else -1)
                )
                result = "Angepasst."
            else:
                result = "Ungültiger Charakterzug oder Richtung."
        else:
            impl = TOOL_IMPLEMENTATIONS.get(name)
            result = impl(args) if impl else f"Unbekanntes Werkzeug: {name}"
            if name == "search_wikipedia" and result and not result.startswith(_WIKIPEDIA_LOOKUP_FAILURES):
                captured.setdefault("wikipedia_facts", []).append(result[:800])
        outputs.append({"role": "tool", "tool_call_id": call.get("id"), "content": result})
    return outputs


MAX_TOOL_ROUNDS = 3


def _call_groq_message(messages, max_tokens, tools=None, tool_choice="auto", temperature=CODE_TEMPERATURE):
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
        "temperature": temperature,
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


def _call_groq(messages, max_tokens, tools=None, captured=None, temperature=CODE_TEMPERATURE):
    """Runs a tool-calling loop: as long as the model keeps requesting
    tools, executes them server-side and feeds the results back, up to
    MAX_TOOL_ROUNDS turns. On the last allowed turn, tool_choice is forced
    to "none" -- Groq errors ("tool choice is none, but model called a
    tool") if tools are omitted entirely from a follow-up call after the
    model has already started a tool-calling turn, so the schema stays
    attached and only the choice is what forces a final text answer.
    Returns (content, proposed_change) -- proposed_change is a
    {"new_code", "summary"} dict if propose_project_change was called
    during the loop, else None.

    `captured` is an optional dict the caller can pass in (and keep a
    reference to) in order to read back what search_wikipedia/
    remember_user_fact turned up during this call -- see
    captured["wikipedia_facts"]/captured["user_facts"] and
    _run_tool_calls(). Callers that don't care (most of them: only
    general-mode chats ever populate these) can simply omit it."""
    current_messages = messages
    if captured is None:
        captured = {}
    captured.setdefault("proposed_change", None)
    captured.setdefault("wikipedia_facts", [])
    captured.setdefault("user_facts", [])
    captured.setdefault("personality_adjustments", [])
    for round_index in range(MAX_TOOL_ROUNDS):
        is_last_round = round_index == MAX_TOOL_ROUNDS - 1
        message = _call_groq_message(
            current_messages, max_tokens, tools=tools,
            tool_choice="none" if is_last_round else "auto", temperature=temperature,
        )
        tool_calls = message.get("tool_calls")
        if not tool_calls:
            return (message.get("content") or "").strip(), captured["proposed_change"]
        current_messages = current_messages + [message] + _run_tool_calls(tool_calls, captured)
    return "", captured["proposed_change"]


def _facts_addendum(facts):
    """`facts` are statements an admin made through the admin dashboard's
    dedicated "KI-Wissen" chat (see app.py's api_ai_chat/save_as_fact) --
    deliberately global and injected into every mode's prompt, since an
    admin using that specific chat is the one place this app treats a
    single person's statement as ground truth for every user."""
    if not facts:
        return ""
    lines = "\n".join(f"- {fact}" for fact in facts)
    return (
        "\n\nVom timeskip-Team über den Admin-Bereich bestätigte Fakten -- behandle diese als "
        "sicher wahr, ohne sie infrage zu stellen:\n" + lines
    )


def _learned_facts_addendum(wikipedia_facts, user_facts, docs_facts=None, behavior_note=None):
    """The general-mode-only counterpart to _facts_addendum: wikipedia_facts
    are takeaways from this app's own past search_wikipedia lookups (global,
    since a Wikipedia article is independently checkable), docs_facts are
    likewise takeaways from past search_docs lookups of Python's official
    documentation (also global, also independently checkable) -- both can
    also be bulk-seeded once from a curated topic list via app.py's
    admin_seed_ai_knowledge, rather than only accumulating one lookup at a
    time. user_facts are the private per-user profile: everything --big or
    small, explicit or inferred-- previously remembered about this one user
    via remember_user_fact (scoped to that one user, and explicitly framed
    as unverified -- unlike an AiAdminFact, one user's say-so is never
    treated as confirmed truth). `behavior_note`, if given, is a one-off
    system-only observation about *this current message* (see app.py's
    typing_avg_interval_ms handling) -- not a stored fact by itself, just a
    live signal the model may choose to combine with what's said and turn
    into a remember_user_fact call."""
    parts = []
    if wikipedia_facts:
        lines = "\n".join(f"- {fact}" for fact in wikipedia_facts)
        parts.append(
            "\n\nAus früheren Wikipedia-Recherchen -- fachlich fundiert, aber bei sehr "
            "aktuellen Ereignissen lieber erneut nachschlagen:\n" + lines
        )
    if docs_facts:
        lines = "\n".join(f"- {fact}" for fact in docs_facts)
        parts.append(
            "\n\nAus der offiziellen Python-Dokumentation -- technisch verlässlich:\n" + lines
        )
    if user_facts:
        lines = "\n".join(f"- {fact}" for fact in user_facts)
        parts.append(
            "\n\nDein privates Profil zu genau diesem Nutzer, aus früheren Gesprächen -- "
            "unverifiziert und könnte veraltet oder falsch sein, aber darfst du als Kontext "
            "über diesen Nutzer verwenden. Wird niemandem außer dir gezeigt, auch nicht dem "
            "Nutzer selbst:\n" + lines
        )
    if behavior_note:
        parts.append("\n\nHinweis (intern, nicht dem Nutzer zeigen): " + behavior_note)
    return "".join(parts)


def generate_reply(message, context=None, history=None, project_type=None, facts=None,
                    learned_facts=None, captured=None, behavior_note=None, personality=None):
    """Runs one turn against Groq's hosted chat-completions API. Not meant
    to be called directly from a request handler -- see start_chat_job().
    `history` is this same chat's own prior turns (a list of
    {"role": "user"|"assistant", "content": str} dicts, oldest first).
    `project_type` is "game", "webapp", or None (general chat) and picks
    both the system prompt variant and which tools are offered. `facts`
    is the list of admin-confirmed facts (see _facts_addendum). `learned_facts`
    is an optional {"wikipedia": [...], "user": [...], "docs": [...]} dict of
    previously auto-learned/seeded facts (see _learned_facts_addendum) --
    only applied in general mode. `captured`, if given, is mutated in place
    with any new wikipedia_facts/user_facts learned during *this* call, for
    the caller to persist (see _call_groq). `behavior_note`, if given, is a
    one-off system-only aside about this specific message (see app.py's
    typing_avg_interval_ms handling) -- only applied in general mode, same
    as learned_facts. `personality`, if given, is a {"intelligence",
    "humor", "caution", "arrogance"} dict (see AiPersonality in models.py
    and _personality_addendum) -- also general-mode only. Returns
    (reply_text, proposed_change)."""
    message = (message or "").strip()[:MAX_MESSAGE_CHARS]
    if not message:
        return "", None

    # A code `context` without an explicit project_type defaults to "game"
    # rather than falling through to general mode -- that would otherwise
    # enable Wikipedia/weather/docs tools alongside Studio DSL code, the
    # exact contamination this split was meant to prevent. "general" is a
    # separate explicit escape hatch for non-code context (an uploaded text
    # file attached in general chat) that must NOT trigger the same
    # game-mode fallback.
    if project_type == "general":
        project_type = None
    elif project_type not in ("game", "webapp"):
        project_type = "game" if context else None

    user_content = message
    if context:
        # The frontend already formats this as a syntax reference (game)
        # or the current file (webapp) plus the question.
        user_content = f"{context[:MAX_CONTEXT_CHARS]}\n\nFrage: {message}"

    if project_type == "game":
        system_prompt = BASE_SYSTEM_PROMPT + GAME_DSL_ADDENDUM
        tools = PROJECT_CHANGE_TOOLS
        temperature = CODE_TEMPERATURE
    elif project_type == "webapp":
        system_prompt = BASE_SYSTEM_PROMPT + WEBAPP_CODE_ADDENDUM
        tools = WEBAPP_TOOLS
        temperature = CODE_TEMPERATURE
    else:
        system_prompt = GENERAL_SYSTEM_PROMPT + FRIEND_CHARACTER_ADDENDUM + GENERAL_TOOLS_ADDENDUM
        tools = AI_TOOLS
        temperature = GENERAL_TEMPERATURE
    system_prompt += _facts_addendum(facts)
    if project_type is None and (learned_facts or behavior_note):
        learned_facts = learned_facts or {}
        system_prompt += _learned_facts_addendum(
            learned_facts.get("wikipedia") or [], learned_facts.get("user") or [],
            learned_facts.get("docs") or [], behavior_note,
        )
    if project_type is None:
        system_prompt += _personality_addendum(personality)

    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history[-MAX_HISTORY_MESSAGES:])
    messages.append({"role": "user", "content": user_content})

    return _call_groq(messages, MAX_REPLY_TOKENS, tools=tools, captured=captured, temperature=temperature)


def generate_title(first_message):
    """One extra, cheap request that turns a chat's opening message into a
    short 2-4 word label for the chat list."""
    try:
        title, _ = _call_groq(
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


def start_chat_job(message, context=None, history=None, project_type=None, facts=None,
                    learned_facts=None, on_done=None, behavior_note=None, personality=None):
    """`on_done(reply, error, proposed_change, new_learned_facts)` --
    new_learned_facts is always a {"wikipedia": [...], "user": [...],
    "personality_adjustments": [...]} dict (possibly with empty lists) of
    facts/trait nudges from *this* call, for the caller to persist as
    AiLearnedFact rows / AiPersonality updates."""
    job_id = uuid.uuid4().hex
    with _jobs_lock:
        _jobs[job_id] = {"status": "running", "reply": None, "error": None, "proposed_change": None}

    def run():
        # on_done (persisting to the database) runs *before* the status
        # flips to "done"/"error", so a poller can never observe "done" and
        # then fetch message history that hasn't been written yet.
        # proposed_change is never persisted to the database -- it's only
        # ever surfaced through this job's status for the current, live
        # poll, matching how the existing "insert code" button also only
        # appears live and not when reopening an old chat.
        captured = {}
        try:
            reply, proposed_change = generate_reply(
                message, context, history, project_type, facts, learned_facts, captured,
                behavior_note, personality,
            )
            new_learned_facts = {
                "wikipedia": captured.get("wikipedia_facts") or [],
                "user": captured.get("user_facts") or [],
                "personality_adjustments": captured.get("personality_adjustments") or [],
            }
            if on_done:
                on_done(reply, None, proposed_change, new_learned_facts)
            with _jobs_lock:
                _jobs[job_id] = {
                    "status": "done", "reply": reply, "error": None, "proposed_change": proposed_change,
                }
        except Exception as exc:
            logger.exception("KI-Antwort fehlgeschlagen.")
            if on_done:
                on_done(None, str(exc), None, {"wikipedia": [], "user": [], "personality_adjustments": []})
            with _jobs_lock:
                _jobs[job_id] = {"status": "error", "reply": None, "error": str(exc), "proposed_change": None}

    threading.Thread(target=run, daemon=True).start()
    return job_id


def get_job_status(job_id):
    with _jobs_lock:
        job = _jobs.get(job_id)
        return dict(job) if job is not None else None
