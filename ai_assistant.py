"""NexAI's built-in AI assistant -- used both as a general chatbot (the
floating widget in base.html) and as programming help inside NexAI
studio (where the user's current script is sent along as context).

Text generation runs through Groq's hosted inference API (see
_generate_groq below; requires GROQ_API_KEY) -- a far larger free-tier
model, giving noticeably better/faster replies than this app's brief
stint on a small self-hosted CPU model (local_ai.py, ~1.5B params run via
llama-cpp-python). That self-hosted setup was tried deliberately (see
local_ai.py's own docstring) to avoid depending on a third party for the
app's core feature, but the reply-quality tradeoff wasn't worth it and
this module was switched back. local_ai.py itself is NOT deleted -- the
admin fine-tuning feature (see app.py's admin_ai_training_start) still
fine-tunes that same local model on demand, it's just no longer on live
chat's hot path. Tool-calling stays on this module's own prompt-based
```tool_call``` convention (see _tools_instructions/_parse_tool_call
below) rather than switching to Groq's native structured tool-calling --
that convention already works reliably, and reply quality was the actual
problem being fixed here, not the tool pipeline.

Image generation (generate_image) and editing (edit_image, real
image-to-image via Pollinations' "kontext" model -- see
_build_edit_image_url) both run through Pollinations.ai; cloned-voice
audio (generate_audio, via ElevenLabs/browser TTS) is a separate external
service. None of these were affected by the Groq-vs-local-model swap
above -- only the actual chat/voice-chat TEXT reply's backend changed.
There is deliberately no video generation tool -- no free/no-key service
for it exists the way Pollinations covers images, and adding one would
mean picking and paying for a third-party API, which hasn't happened.

Requests still run through a background-thread job queue and are polled by
the client (see start_chat_job()/get_job_status()), since that keeps the
API contract the same regardless of which backend answers it (Groq today,
something else potentially later) and matches the run_video_wipe()-style
pattern already used elsewhere in this app for other async jobs.

This module knows nothing about the database -- chat history persistence
lives in app.py (AiChat/AiChatMessage), which passes prior turns in as
`history` and reads the result back out via the on_done callback. Chat
history is always scoped to the same user's own past chats; it is never
shared with or used to influence another user's replies.

Also gives the assistant tool-calling abilities -- rather than switching to
Groq's native structured function calling, tool use is still taught
entirely through the system prompt (see _tools_instructions) as a
convention the model follows by imitation: to call a tool, respond with
nothing but a fenced ```tool_call``` block containing {"name",
"arguments"} JSON, which _parse_tool_call then reads back out. This is
the same prompt-based scheme from this module's brief self-hosted-model
era, kept as-is because it already works reliably and switching tool-call
mechanisms wasn't needed just to fix reply quality. Not model fine-tuning
either way -- Groq's hosted model can't be retrained from within this
app, tool use is purely a per-request prompting technique. Split by which of three
modes generate_reply() runs in (`project_type`):
  - None (general chat): search_wikipedia, get_weather, search_docs --
    live lookups for factual questions, not available in the other two
    modes since pulling in real Python/JS/Java/C# documentation there
    risks the model mixing real language syntax into NexAI's own flat
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
import time
import uuid
import urllib.parse
import urllib.robotparser

import requests

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
# Switched to a real open-weight Chinese model (Alibaba's Qwen) on the
# user's explicit request (2026-08-19), knowingly accepting the tradeoff:
# it's Preview-tier on Groq ("intended for evaluation purposes, not
# production" per Groq's own docs), and Groq has already deprecated two
# other Chinese preview models this year without much notice
# (qwen/qwen3-32b in June 2026, moonshotai/kimi-k2-instruct-0905 in March
# 2026). GROQ_FALLBACK_MODEL below is the safety net for exactly that --
# see _generate_groq.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "qwen/qwen3.6-27b")
GROQ_FALLBACK_MODEL = os.environ.get("GROQ_FALLBACK_MODEL", "openai/gpt-oss-120b")
CHAT_REQUEST_TIMEOUT_SECONDS = 30

MAX_MESSAGE_CHARS = 2000
MAX_CONTEXT_CHARS = 4000
MAX_REPLY_TOKENS = 900
MAX_HISTORY_MESSAGES = 12
# Code modes (game DSL, webapp) stay at the lower, more predictable value --
# the flat Studio DSL in particular has zero tolerance for invented syntax.
# General chat gets more room for varied, creative phrasing, but kept
# below Groq's own default (1.1) since this module's prompt-based
# tool-calling (see _tools_instructions) is more prone to going off the
# rails at high sampling temperature than Groq's native, separately-
# constrained tool selection would be.
CODE_TEMPERATURE = 0.7
GENERAL_TEMPERATURE = 0.85

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
    "Du bist der freundliche KI-Assistent von NexAI, einem KI-Produkt mit einem eigenen "
    "Programmier-Modus. Dein Name ist Nex -- wenn du nach deinem Namen gefragt wirst, "
    "antworte genau damit, nicht mit ChatGPT oder dem Namen eines anderen KI-Produkts. "
    "Antworte auf Deutsch, in einem warmen, positiven Ton. Da du gerade "
    "im Programmier-Modus bist, darf es hier -- und nur hier -- um Code gehen; halte die "
    "Erklärung drumherum kurz, damit der Code im Vordergrund steht. Sprich nicht schlecht "
    "über NexAI selbst -- wenn jemand sich über die Plattform beschwert, bleib konstruktiv "
    "und hilfsbereit statt der Beschwerde zuzustimmen, aber erfinde auch nichts und tu nicht "
    "so, als gäbe es ein Problem nicht, das es gibt."
)

# Used only for general (non-code) chat -- deliberately leads with "helpful
# assistant" rather than "NexAI's assistant", and points at real lookups
# (Wikipedia) and what this user has said before, rather than talking about
# NexAI itself by default. The code-mode prompt above keeps the
# NexAI/programming framing since that context is directly relevant there;
# general mode instead explicitly steers AWAY from programming topics --
# NexAI is specialized on being a general AI, with programming cleanly
# split off into its own mode (see base.html's "Neuesten Code-Chat
# erstellen" sidebar button) rather than blended into every conversation.
GENERAL_SYSTEM_PROMPT = (
    "Du bist ein hilfsbereiter, wissbegieriger, neugieriger KI-Assistent -- deine Gespräche "
    "drehen sich meistens NICHT um NexAI selbst, sondern um das, was die Person dich fragt. "
    "Dein Name ist Nex -- wenn du nach deinem Namen gefragt wirst, antworte genau damit, "
    "nicht mit ChatGPT oder dem Namen eines anderen KI-Produkts. "
    "Antworte auf Deutsch, in einem warmen, positiven Ton, und darfst ausführlich antworten. "
    "Bei Wissensfragen verlässt du dich lieber auf eine echte Wikipedia-Recherche oder auf "
    "das, was dieser Nutzer dir selbst schon erzählt hat, statt zu raten oder dir etwas "
    "auszudenken. Sprich nicht schlecht über NexAI -- wenn jemand sich über die Plattform "
    "beschwert, bleib konstruktiv statt zuzustimmen, aber erfinde auch nichts und tu nicht so, "
    "als gäbe es ein Problem nicht, das es gibt.\n\n"
    "Dieser Chat hier ist NICHT der Programmier-Modus -- bring Programmieren/Code deshalb "
    "von dir aus nie zur Sprache. Fragt die Person trotzdem explizit nach Code oder einem "
    "Programmierthema, beantworte es nicht hier, sondern weise kurz und freundlich auf den "
    "Button \"Neuesten Code-Chat erstellen\" hin, der genau dafür gedacht ist.\n\n"
    "Wenn du bei einer Antwort ziemlich sicher bist (du würdest sagen: mindestens 80-90% "
    "sicher, aus echtem Wissen und nicht geraten), ergänze am Ende oft noch eine kurze, "
    "wirklich passende Extra-Empfehlung oder einen verwandten Gedanken -- nicht nur stur "
    "das beantworten, wonach explizit gefragt wurde, sondern von dir aus noch etwas "
    "Nützliches oder Interessantes dranhängen, das der Person weiterhilft oder gefallen "
    "könnte. Bei Unsicherheit lieber knapp bleiben, statt dir etwas Falsches auszudenken.\n\n"
    "Wenn du nach einer persönlichen Meinung oder Entscheidung zwischen Optionen gefragt "
    "wirst (z.B. \"Messi oder Ronaldo?\"), antworte wie ein echter Mensch mit einer echten "
    "Meinung reagieren würde -- entschieden, mit einer natürlichen, alltagssprachlichen "
    "Reaktion passend zum Thema (Ausrufe, Slang, Emotion), statt neutral abzuwägen oder "
    "auszuweichen. Frag außerdem gerne von dir aus auch mal etwas zurück -- nicht nach jeder "
    "Nachricht, aber oft genug, dass sich das Gespräch wie ein echter Austausch anfühlt und "
    "nicht wie ein reines Frage-Antwort-Formular.\n\n"
    "Schreib so, wie ein echter Mensch in einem Chat schreiben würde, nicht wie ein "
    "Nachschlagewerk: wechsle bewusst zwischen kurzen und längeren Sätzen, greif nicht bei "
    "jeder Antwort zu Aufzählungen oder Überschriften (die sind für wirklich strukturierte "
    "Inhalte reserviert, nicht der Standardfall), und vermeide steife Textbausteine wie "
    "\"Zusammenfassend lässt sich sagen\" oder \"Ich hoffe, das hilft dir weiter\". "
    "Alltagssprache, gelegentliche Umgangsformulierungen und ein bisschen Persönlichkeit in "
    "der Wortwahl sind ausdrücklich erwünscht."
)

GENERAL_TOOLS_ADDENDUM = (
    "\n\nDu hast Zugriff auf vier Werkzeuge: search_wikipedia (aktuelle Wissensfragen), "
    "get_weather (Live-Wetter für einen Ort), search_docs (offizielle Dokumentation von "
    "Python, JavaScript, HTML, Java oder C#) und remember_user_fact (merkt sich etwas über "
    "diesen einen Nutzer für spätere Gespräche mit ihm, in einem privaten Profil, das "
    "niemand außer dir selbst je zu sehen bekommt -- nicht der Nutzer, nicht das NexAI-"
    "Team). Bevor du eine Sach- oder Wissensfrage beantwortest, prüfe zuerst von dir aus, ob "
    "search_wikipedia, get_weather oder search_docs weiterhelfen würde -- das ist der "
    "Standardfall bei nachprüfbaren Fakten, nicht nur eine Notlösung für den Moment, in dem "
    "dir auffällt, dass du unsicher bist. Antworte danach ganz normal und natürlich in "
    "deinen eigenen Worten, nicht als bloße Fakten-Auflistung. Nutze "
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

IMAGE_TOKEN_COST = 600
AUDIO_TOKEN_COST = 400

GENERATE_AUDIO_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_audio",
        "description": (
            f"Erzeugt eine echte, hörbare Sprachnachricht aus Text und zeigt sie dem Nutzer als "
            f"abspielbaren Player an. Kostet {AUDIO_TOKEN_COST} Tokens vom Nutzer-Guthaben -- nur "
            "aufrufen, wenn der Nutzer wirklich ausdrücklich eine Sprachnachricht/Audio möchte UND "
            "genug Tokens übrig hat. Funktioniert nur, wenn bereits eine echte KI-Stimme vorhanden "
            "ist -- falls nicht, kommt ehrlich ein Fehler zurück, den du dem Nutzer erklären sollst, "
            "statt es erneut zu versuchen oder etwas vorzutäuschen."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "Der Text, der gesprochen werden soll, auf Deutsch.",
                },
                "gender": {
                    "type": "string",
                    "enum": ["male", "female"],
                    "description": "Gewünschte Stimme, falls vom Nutzer erwähnt -- sonst weglassen.",
                },
            },
            "required": ["text"],
        },
    },
}

GENERATE_IMAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_image",
        "description": (
            f"Erzeugt ein echtes Bild aus einer Beschreibung und zeigt es dem Nutzer an. Kostet "
            f"{IMAGE_TOKEN_COST} Tokens vom Nutzer-Guthaben (siehe Kontostand im System-Prompt) -- "
            "nur aufrufen, wenn der Nutzer wirklich ausdrücklich ein Bild möchte UND genug Tokens "
            "übrig hat. Reicht das Guthaben nicht, erkläre das stattdessen ehrlich, statt es zu "
            "versuchen."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Bildbeschreibung, auf Englisch, so konkret wie möglich.",
                },
            },
            "required": ["prompt"],
        },
    },
}

EDIT_IMAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "edit_image",
        "description": (
            "Bearbeitet ein bereits existierendes Bild anhand einer Beschreibung (z.B. \"füge einen "
            "Hut hinzu\", \"mach den Himmel lila\") und zeigt das Ergebnis an. Braucht eine ECHTE "
            "Bild-URL -- entweder ein Bild, das zuvor in diesem Chat mit generate_image erzeugt "
            "wurde (die URL steht im ![]() der vorherigen Antwort), oder eine Bild-URL, die der "
            "Nutzer selbst geschickt hat. Erfinde NIEMALS eine Bild-URL -- ist keine echte "
            "vorhanden, sag das ehrlich statt das Werkzeug aufzurufen. Kostet "
            f"{IMAGE_TOKEN_COST} Tokens vom Nutzer-Guthaben, genau wie generate_image."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "image_url": {
                    "type": "string",
                    "description": "Die echte, bereits existierende Bild-URL, die bearbeitet werden soll.",
                },
                "prompt": {
                    "type": "string",
                    "description": "Beschreibung der gewünschten Änderung, auf Englisch, so konkret wie möglich.",
                },
            },
            "required": ["image_url", "prompt"],
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
    if personality.get("mimic_user_style"):
        lines.append(
            "- \"Buddy\"-Modus ist aktiv: Diese Person hat ausdrücklich zugestimmt, dass du "
            "versuchst, ähnlich zu reden/schreiben wie sie selbst -- orientiere dich an "
            "Wortwahl, Satzlänge, Emoji-/Slang-Nutzung und Tonfall aus ihren bisherigen "
            "Nachrichten in diesem Gespräch, ohne dabei unverständlich oder unpassend zu werden."
        )
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
    "\n\nDer Nutzer programmiert gerade seine eigene wiwa (\"Web-in-Web-App\") mit echtem HTML, "
    "CSS und JavaScript -- OHNE jemals selbst Code zu sehen oder zu schreiben. Er sieht nur "
    "eine Live-Vorschau seiner wiwa, nie den Code dahinter. Zeig deshalb NIE einen Codeblock in "
    "deiner Antwort, auch nicht als Beispiel -- jede Änderung läuft ausschließlich über das "
    "Werkzeug propose_project_change, mit dem KOMPLETTEN neuen Code der Seite (die ganze "
    "HTML-Datei inklusive <style> und <script>), nicht nur einem Ausschnitt -- er ersetzt den "
    "ganzen aktuellen Code. Beschreib stattdessen in normaler Sprache, was du geändert hast. Du "
    "bekommst den aktuellen Code der Seite mitgeschickt, um zu wissen, was schon da ist -- "
    "zeig ihn aber nie.\n\n"
    "Du hast außerdem Zugriff auf das Werkzeug search_docs (offizielle Dokumentation von "
    "Python, JavaScript, HTML, Java oder C#). Nutze es bei konkreten Fragen zu echten "
    "Sprachfeatures, statt dir Details auszudenken."
)

# Standalone code-help chat: no attached Studio project/file (unlike game/
# webapp mode), just plain programming Q&A through the conversation itself.
CODE_CHAT_ADDENDUM = (
    "\n\nDies ist ein eigenständiger Programmier-Chat OHNE angehängtes Projekt oder Datei -- "
    "es gibt hier keinen Code, den du automatisch siehst oder direkt ändern kannst. Hilf "
    "stattdessen über den Chat-Verlauf selbst: Erklärungen, Codebeispiele in Codeblöcken, "
    "Debugging anhand von dem, was der Nutzer dir zeigt oder beschreibt. Du hast Zugriff auf "
    "das Werkzeug search_docs (offizielle Dokumentation von Python, JavaScript, HTML, Java "
    "oder C#) -- nutze es bei konkreten Fragen zu echten Sprachfeatures, statt dir Details "
    "auszudenken."
)

# Applied to every mode's system prompt -- the frontend (base.html's
# renderMarkdown) renders standard markdown plus one custom extra: ==word==
# for colored emphasis, since normal markdown has no syntax for that.
FORMATTING_ADDENDUM = (
    "\n\nFormatierung: Nutze ganz normales Markdown -- **fett**, # / ## / ### Überschriften, "
    "Listen und ```Codeblöcke``` wie gewohnt. Zusätzlich stehen dir zwei Extras zur "
    "Verfügung, aber setz sie GEZIELT ein, nicht in jeder Antwort und nicht in jedem Absatz: "
    "echte Markdown-Tabellen (| Spalte A | Spalte B |, gefolgt von einer |---|---|-Trennzeile) "
    "wenn wirklich vergleichbare, strukturierte Daten in einer Tabelle übersichtlicher sind "
    "als in Fließtext oder einer Liste; und ==wichtiges Wort== (doppeltes Gleichheitszeichen "
    "davor und danach) um einzelne, wirklich wichtige Wörter oder ganz kurze Ausdrücke farblich "
    "hervorzuheben -- sparsam und gezielt, für echte Betonung, nie für ganze Sätze."
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
            "nur bei großen expliziten Aussagen. Je genauer und konkreter der einzelne Fakt "
            "formuliert ist, desto nützlicher ist er später -- lieber 'mag Science-Fiction, "
            "besonders Weltraum-Themen, hat kürzlich nach schwarzen Löchern gefragt' als nur "
            "'interessiert sich für Wissenschaft'."
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
# into NexAI's own flat DSL. webapp mode has no such risk (it's real
# HTML/CSS/JS already), so it also gets search_docs for grounded, accurate
# answers instead of guessing from the base model's training alone.
PROJECT_CHANGE_TOOLS = [PROPOSE_PROJECT_CHANGE_TOOL]
WEBAPP_TOOLS = [PROPOSE_PROJECT_CHANGE_TOOL, SEARCH_DOCS_TOOL]
# No propose_project_change here -- a standalone code chat has no attached
# project/file for that tool to write back to.
CODE_CHAT_TOOLS = [SEARCH_DOCS_TOOL]
AI_TOOLS = [
    SEARCH_WIKIPEDIA_TOOL, GET_WEATHER_TOOL, SEARCH_DOCS_TOOL, REMEMBER_USER_FACT_TOOL,
    ADJUST_PERSONALITY_TOOL, GENERATE_IMAGE_TOOL, EDIT_IMAGE_TOOL, GENERATE_AUDIO_TOOL,
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


# Pollinations.ai: a genuinely free, no-API-key image generation service --
# a GET request to this URL *is* the generation request, the image itself
# is the response body, so the URL can be embedded directly (e.g. in a
# markdown ![]() the frontend renders) without this app fetching/storing
# the bytes itself. No account, no key, matches this app's existing "use a
# real free service instead of faking the capability" pattern (Wikipedia,
# Open-Meteo, browser speech synthesis).
POLLINATIONS_IMAGE_URL = "https://image.pollinations.ai/prompt/{}"


def _build_image_url(prompt):
    return POLLINATIONS_IMAGE_URL.format(urllib.parse.quote(prompt)) + "?width=768&height=768&nologo=true"


# Same Pollinations service, but its "kontext" model does real image-to-image
# editing: passing an existing image's URL alongside the prompt transforms
# that image instead of generating a fresh one from scratch. Still a plain
# GET whose response body is the resulting image -- no separate download/
# upload/storage step needed here either.
def _build_edit_image_url(prompt, image_url):
    return (
        POLLINATIONS_IMAGE_URL.format(urllib.parse.quote(prompt))
        + f"?model=kontext&image={urllib.parse.quote(image_url, safe='')}&width=768&height=768&nologo=true"
    )


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


def _run_tool_calls(tool_calls, captured, available_tokens=None, synthesize_audio_fn=None):
    """Executes each requested tool and returns the "tool" role messages
    to feed back to the model. `captured` is a single dict shared across
    the whole _call_model() loop, so the caller can read results back out
    after it returns:
    - propose_project_change stashes its arguments into captured["proposed_change"]
      instead of fetching anything.
    - remember_user_fact stashes its argument into captured["user_facts"]
      instead of fetching anything -- see AiLearnedFact in models.py.
    - adjust_personality_trait stashes a (trait, +1/-1) tuple into
      captured["personality_adjustments"] -- see AiPersonality in models.py.
    - generate_image stashes {"url", "prompt"} into captured["image_generated"]
      -- app.py's on_done actually deducts IMAGE_TOKEN_COST from the
      database afterward; `available_tokens` (this user's current balance,
      or None if the caller doesn't track tokens, e.g. the guest chat) is
      only a server-side guard against generating when it's already clear
      there's not enough, not the actual deduction.
    - a successful search_wikipedia result is also appended to
      captured["wikipedia_facts"], for the same reason."""
    outputs = []
    for call in tool_calls:
        name = call.get("function", {}).get("name")
        try:
            args = json.loads(call.get("function", {}).get("arguments") or "{}")
        except (json.JSONDecodeError, TypeError):
            args = {}
        try:
            result = _execute_one_tool_call(
                name, args, captured, available_tokens=available_tokens, synthesize_audio_fn=synthesize_audio_fn,
            )
        except Exception:
            # One tool call blowing up (e.g. a transient network error deep
            # inside generate_audio's synthesize_audio_fn) must never take
            # the whole reply down with it -- that's what previously turned
            # into a hard "Die KI ist gerade nicht verfügbar." for the user
            # even though the model's own text response would otherwise have
            # gone through fine. Feed the model an honest failure instead,
            # so it can tell the user rather than silently pretending nothing
            # happened.
            logger.exception("Werkzeugaufruf '%s' fehlgeschlagen.", name)
            result = (
                f"Das Werkzeug '{name}' ist gerade an einem technischen Fehler gescheitert. "
                "Erklär das dem Nutzer ehrlich, statt es als Erfolg darzustellen oder "
                "stillschweigend erneut zu versuchen."
            )
        outputs.append({"role": "tool", "tool_call_id": call.get("id"), "content": result})
    return outputs


def _execute_one_tool_call(name, args, captured, available_tokens=None, synthesize_audio_fn=None):
    if name == "propose_project_change":
        captured["proposed_change"] = {
            "new_code": args.get("new_code") or "",
            "summary": (args.get("summary") or "").strip() or "Änderung vorgeschlagen",
        }
        return "Der Änderungsvorschlag wurde dem Nutzer zur Bestätigung angezeigt."
    if name == "remember_user_fact":
        fact = (args.get("fact") or "").strip()[:500]
        if fact:
            captured.setdefault("user_facts", []).append(fact)
        return "Notiert."
    if name == "adjust_personality_trait":
        trait = PERSONALITY_TRAIT_KEYS.get(args.get("trait"))
        direction = args.get("richtung")
        if trait and direction in ("hoch", "runter"):
            captured.setdefault("personality_adjustments", []).append(
                (trait, 1 if direction == "hoch" else -1)
            )
            return "Angepasst."
        return "Ungültiger Charakterzug oder Richtung."
    if name == "generate_image":
        prompt = (args.get("prompt") or "").strip()
        if not prompt:
            return "Keine Bildbeschreibung angegeben."
        if available_tokens is not None and available_tokens < IMAGE_TOKEN_COST:
            return (
                f"Nicht genug Tokens ({available_tokens} übrig, {IMAGE_TOKEN_COST} nötig) -- "
                "kein Bild erzeugt. Erklär das dem Nutzer ehrlich."
            )
        image_url = _build_image_url(prompt)
        captured["image_generated"] = {"url": image_url, "prompt": prompt}
        return (
            f"Bild erzeugt. Füge es in deiner Antwort als Markdown-Bild ein: "
            f"![{prompt}]({image_url})\n\n"
            "Erwähne dabei NICHT von dir aus, womit oder wie das Bild erzeugt wurde -- "
            "schreib nur normal etwas Kurzes dazu. NUR falls der Nutzer (in dieser oder "
            "einer späteren Nachricht) ausdrücklich danach fragt, wie/womit/mit welchem "
            "Dienst das Bild erstellt wurde, antworte ehrlich: über den externen Dienst "
            "Pollinations.ai, mit einem Link zur Webseite: "
            "[Pollinations.ai](https://pollinations.ai)"
        )
    if name == "edit_image":
        prompt = (args.get("prompt") or "").strip()
        image_url = (args.get("image_url") or "").strip()
        if not prompt or not image_url:
            return "Keine Bildbeschreibung oder keine Bild-URL angegeben."
        if not re.match(r"^https?://", image_url):
            return "Ungültige Bild-URL -- muss eine echte http(s)-Adresse sein. Kein Bild bearbeitet."
        if available_tokens is not None and available_tokens < IMAGE_TOKEN_COST:
            return (
                f"Nicht genug Tokens ({available_tokens} übrig, {IMAGE_TOKEN_COST} nötig) -- "
                "kein Bild bearbeitet. Erklär das dem Nutzer ehrlich."
            )
        edited_url = _build_edit_image_url(prompt, image_url)
        captured["image_generated"] = {"url": edited_url, "prompt": prompt}
        return (
            f"Bild bearbeitet. Füge es in deiner Antwort als Markdown-Bild ein: "
            f"![{prompt}]({edited_url})\n\n"
            "Erwähne dabei NICHT von dir aus, womit oder wie es bearbeitet wurde -- schreib nur "
            "normal etwas Kurzes dazu. NUR falls der Nutzer ausdrücklich danach fragt, antworte "
            "ehrlich: über den externen Dienst Pollinations.ai (Kontext-Modell), mit Link: "
            "[Pollinations.ai](https://pollinations.ai)"
        )
    if name == "generate_audio":
        text = (args.get("text") or "").strip()[:2000]
        gender = args.get("gender") if args.get("gender") in ("male", "female") else None
        if not text:
            return "Kein Text angegeben."
        if synthesize_audio_fn is None:
            return (
                "Es gibt aktuell keine echte, geklonte KI-Stimme -- Sprachnachrichten können "
                "gerade nicht erzeugt werden. Erklär das dem Nutzer ehrlich, statt es zu "
                "versuchen oder etwas vorzutäuschen."
            )
        if available_tokens is not None and available_tokens < AUDIO_TOKEN_COST:
            return (
                f"Nicht genug Tokens ({available_tokens} übrig, {AUDIO_TOKEN_COST} nötig) -- "
                "keine Sprachnachricht erzeugt. Erklär das dem Nutzer ehrlich."
            )
        audio_url = synthesize_audio_fn(text, gender)
        if not audio_url:
            return (
                "Die Sprachausgabe ist gerade nicht verfügbar (technischer Fehler). "
                "Erklär das dem Nutzer ehrlich, statt es erneut zu versuchen."
            )
        captured["audio_generated"] = {"url": audio_url, "text": text}
        return (
            "Sprachnachricht erzeugt. Füge sie in deiner Antwort als Audio-Markdown ein: "
            f"!audio[Sprachnachricht]({audio_url})"
        )
    impl = TOOL_IMPLEMENTATIONS.get(name)
    result = impl(args) if impl else f"Unbekanntes Werkzeug: {name}"
    if name == "search_wikipedia" and result and not result.startswith(_WIKIPEDIA_LOOKUP_FAILURES):
        captured.setdefault("wikipedia_facts", []).append(result[:800])
    return result


MAX_TOOL_ROUNDS = 3

# This module's entire prompt-based "tool-calling API" is this one
# convention, taught via _tools_instructions and read back out by
# _parse_tool_call: a fenced code block, language-tagged "tool_call",
# containing nothing but {"name": ..., "arguments": {...}} JSON. Chosen
# over e.g. a custom XML tag because fenced code blocks are exactly the
# kind of structured-looking output instruct models already imitate
# reliably from their own training data -- kept even after switching back
# to Groq (which does support native structured tool-calling) since it
# already works reliably and reply quality, not tool-calling, was the
# actual problem being fixed.
_TOOL_CALL_PATTERN = re.compile(r"```tool_call\s*\n(.*?)```", re.DOTALL)
# propose_project_change's new_code argument is often too long, and too
# easy to mangle via JSON string-escaping, for a small model to embed
# reliably inline -- instead it's taught (see _tools_instructions) to
# leave arguments.new_code empty and put the raw, unescaped code in its
# own fenced ```new_code``` block right after the tool_call block, which
# this pattern then reads back out and splices into the parsed arguments.
_NEW_CODE_BLOCK_PATTERN = re.compile(r"```new_code\s*\n(.*?)\n```", re.DOTALL)


def _parse_tool_call(raw):
    """Parses the model's raw text reply for _TOOL_CALL_PATTERN.
    Returns (remaining_text, tool_calls_or_None) -- remaining_text always
    has any matched tool_call/new_code block stripped out (so a
    malformed/unwanted one never leaks into what the user sees), even if
    the JSON inside it didn't parse or named an unknown tool, in which
    case tool_calls is None and the caller falls back to treating this as
    a normal text reply."""
    match = _TOOL_CALL_PATTERN.search(raw)
    if not match:
        return raw, None
    remaining = (raw[:match.start()] + raw[match.end():]).strip()
    try:
        parsed = json.loads(match.group(1).strip())
    except (json.JSONDecodeError, TypeError):
        return remaining, None
    name = parsed.get("name") if isinstance(parsed, dict) else None
    if not name:
        return remaining, None
    arguments = parsed.get("arguments")
    arguments = dict(arguments) if isinstance(arguments, dict) else {}
    if name == "propose_project_change":
        code_match = _NEW_CODE_BLOCK_PATTERN.search(raw)
        if code_match:
            arguments["new_code"] = code_match.group(1)
            remaining = _NEW_CODE_BLOCK_PATTERN.sub("", remaining).strip()
    tool_calls = [{
        "id": f"call_{uuid.uuid4().hex[:12]}",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }]
    return remaining, tool_calls


def _tools_instructions(tools):
    """System-prompt addendum that teaches the model NexAI's own
    prompt-based tool-calling convention (the matching parser is
    _parse_tool_call) -- entirely through worked examples, since a model
    follows a concrete example far more reliably than an abstract
    instruction alone. Only ever appended when `tools` is non-empty."""
    lines = [
        "\n\nDu hast Zugriff auf Werkzeuge, brauchst sie aber nur SEHR SELTEN -- die meisten "
        "Nachrichten (Fragen, Small Talk, Erklärungen, Programmierhilfe) beantwortest du ganz "
        "normal mit Text, OHNE irgendein Werkzeug. Nur wenn ein Werkzeug für die Antwort "
        "wirklich gebraucht wird, antwortest du NUR mit diesem Codeblock, ohne Erklärung davor "
        "oder danach:\n```tool_call\n{\"name\": \"WERKZEUGNAME\", \"arguments\": {...}}\n```",
        "\nBeispiel -- KEIN Werkzeug nötig:\n"
        "Nutzer: \"Wie schreibe ich eine for-Schleife in Python?\"\n"
        "Deine Antwort: \"Eine for-Schleife in Python sieht so aus:\n"
        "```python\nfor i in range(10):\n    print(i)\n```\"\n"
        "(ganz normaler Text, KEIN tool_call, weil kein Werkzeug gebraucht wurde)",
        "\nVerfügbare Werkzeuge:",
    ]
    for tool in tools:
        fn = tool.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        props = (fn.get("parameters", {}) or {}).get("properties", {}) or {}
        arg_bits = [f"{arg_name} ({schema.get('type', 'string')})" for arg_name, schema in props.items()]
        args_str = ", ".join(arg_bits) if arg_bits else "keine"
        lines.append(f"- {name}: {desc} Argumente: {args_str}.")
        if name == "propose_project_change":
            lines.append(
                "  WICHTIG bei propose_project_change: lass \"new_code\" in den arguments "
                "leer (nur \"summary\" angeben) und häng danach den kompletten neuen Code "
                "UNVERÄNDERT, ohne JSON-Escaping, in einem eigenen Codeblock an:\n"
                "  ```new_code\n  <hier der komplette neue Code>\n  ```"
            )
    lines.append(
        "\nBeispiel -- Werkzeug wirklich nötig (Nutzer verlangt ausdrücklich ein Bild):\n"
        "Nutzer: \"Erstelle mir ein Bild von einer Katze\"\n"
        "Deine Antwort:\n```tool_call\n{\"name\": \"generate_image\", \"arguments\": "
        "{\"prompt\": \"a cat\"}}\n```"
    )
    lines.append(
        "\nBeispiel -- edit_image (Nutzer will ein zuvor erzeugtes/geschicktes Bild ändern):\n"
        "Nutzer: \"Erstelle mir ein Bild von einer Katze\" -> du rufst generate_image auf, "
        "Ergebnis enthält z.B. ![a cat](https://image.pollinations.ai/prompt/a%20cat?...)\n"
        "Nutzer (danach): \"setz ihr einen Hut auf\"\n"
        "Deine Antwort:\n```tool_call\n{\"name\": \"edit_image\", \"arguments\": "
        "{\"image_url\": \"https://image.pollinations.ai/prompt/a%20cat?...\", "
        "\"prompt\": \"the cat wearing a hat\"}}\n```\n"
        "(die image_url ist dabei IMMER eine echte URL aus einer vorherigen Nachricht in "
        "diesem Chat -- nie erfunden)"
    )
    return "\n".join(lines)


# reasoning_effort's accepted values aren't uniform across Groq's models --
# gpt-oss takes "low"/"medium"/"high", but Qwen3.6 only accepts "none" or
# "default" and returns a hard 400 for anything else (found by actually
# testing live against Groq's API, not assumed -- an initial "harmless
# no-op" assumption here was wrong and made every Qwen request 400,
# permanently masked by _generate_groq's own fallback-on-400 logic below,
# which is exactly the kind of silent failure that's worse than an honest
# error). "none" is Qwen's closest match to gpt-oss's "low": skip/minimize
# hidden reasoning so there's more room left for the actual visible reply.
GROQ_REASONING_EFFORT_BY_MODEL = {
    "qwen/qwen3.6-27b": "none",
}
GROQ_DEFAULT_REASONING_EFFORT = "low"


def _generate_groq_with_model(model, messages, max_tokens, temperature, api_key):
    """One model's worth of the actual Groq call, with retries on
    transient network errors/429/5xx -- factored out of _generate_groq so
    it can be tried once against GROQ_MODEL and, only on a definitive
    "this model doesn't exist" response, once more against
    GROQ_FALLBACK_MODEL (see _generate_groq)."""
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "reasoning_effort": GROQ_REASONING_EFFORT_BY_MODEL.get(model, GROQ_DEFAULT_REASONING_EFFORT),
    }
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
    """Drop-in replacement for the self-hosted local_ai.generate_chat with
    the identical (messages, max_tokens, temperature) signature -- routes
    text generation through Groq's hosted API instead of the small
    self-hosted CPU model. Reverts the quality/speed-for-ownership
    tradeoff local_ai.py was built for; still keeps this module's own
    prompt-based ```tool_call``` convention (see _call_local_model_message
    below) rather than switching to Groq's native structured tool-calling,
    since that convention already works reliably and rewriting the tool
    pipeline isn't needed just to fix reply quality.

    GROQ_MODEL defaults to a Preview-tier Chinese open-weight model
    (qwen/qwen3.6-27b, see that constant's own comment on why and the
    accepted risk) -- if Groq responds that the model itself is invalid or
    decommissioned (400/404, distinct from a transient 429/5xx which
    _generate_groq_with_model already retries), this falls back to
    GROQ_FALLBACK_MODEL once so live chat degrades gracefully instead of
    breaking outright the moment Groq pulls a preview model, same as it
    already did to qwen3-32b and kimi-k2 earlier this year."""
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
            "Groq-Modell '%s' hat mit Status %s abgelehnt (vermutlich abgeschaltet/Preview-Ende) -- "
            "weiche einmalig auf Fallback-Modell '%s' aus.", GROQ_MODEL, status, GROQ_FALLBACK_MODEL,
        )
        return _generate_groq_with_model(GROQ_FALLBACK_MODEL, messages, max_tokens, temperature, api_key)


def _call_local_model_message(messages, max_tokens, tools=None, tool_choice="auto", temperature=CODE_TEMPERATURE):
    call_messages = messages
    if tool_choice == "none" and tools:
        # Unlike Groq's native tool_choice="none", this prompt-based
        # scheme has no hard constraint forcing a plain answer -- only
        # this one extra nudge, appended just for this call.
        call_messages = messages + [{
            "role": "system",
            "content": (
                "Antworte JETZT ausschließlich in normalem Text, OHNE tool_call-Codeblock, "
                "auch wenn du vorher eins gebraucht hast."
            ),
        }]
    raw = _generate_groq(call_messages, max_tokens, temperature=temperature)
    remaining, tool_calls = _parse_tool_call(raw) if tools else (raw, None)
    if tool_choice == "none":
        tool_calls = None
    message = {"content": remaining}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return message


def _call_model(messages, max_tokens, tools=None, captured=None, temperature=CODE_TEMPERATURE, available_tokens=None,
                 synthesize_audio_fn=None):
    """Runs a tool-calling loop: as long as the model keeps requesting
    tools (see _parse_tool_call), executes them server-side and feeds the
    results back, up to MAX_TOOL_ROUNDS turns. On the last allowed turn,
    tool_choice is forced to "none" so the loop always ends in a real
    text answer rather than potentially looping forever. Returns
    (content, proposed_change) -- proposed_change is a
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
        message = _call_local_model_message(
            current_messages, max_tokens, tools=tools,
            tool_choice="none" if is_last_round else "auto", temperature=temperature,
        )
        tool_calls = message.get("tool_calls")
        if not tool_calls:
            return (message.get("content") or "").strip(), captured["proposed_change"]
        current_messages = current_messages + [message] + _run_tool_calls(
            tool_calls, captured, available_tokens=available_tokens, synthesize_audio_fn=synthesize_audio_fn,
        )
    return "", captured["proposed_change"]


def _classify_tool(user_message, tools):
    """A short, single-purpose classification pass, deliberately kept
    separate from the main reply generation -- see _call_model_with_router
    for why. Returns (tool_name_or_None, arguments_dict)."""
    lines = [
        "Du bist ein Klassifizierer. Deine EINZIGE Aufgabe: entscheiden, ob die Nachricht "
        "eines Nutzers eines der folgenden Werkzeuge braucht.\n\nWerkzeuge:",
    ]
    for tool in tools:
        fn = tool.get("function", {})
        name = fn.get("name", "")
        desc = fn.get("description", "")
        props = (fn.get("parameters", {}) or {}).get("properties", {}) or {}
        arg_bits = [f"{arg_name} ({schema.get('type', 'string')})" for arg_name, schema in props.items()]
        lines.append(f"- {name}: {desc} Argumente: {', '.join(arg_bits) if arg_bits else 'keine'}.")
    lines.append(
        "- none: keines der obigen Werkzeuge wird für diese Nachricht gebraucht (Small Talk, "
        "Meinungsfragen, Programmierhilfe, alles, wofür oben kein passendes Werkzeug steht).\n\n"
        "Antworte AUSSCHLIESSLICH mit einem einzeiligen JSON-Objekt, sonst absolut nichts:\n"
        '{"tool": "WERKZEUGNAME oder none", "arguments": {...}}'
    )
    messages = [
        {"role": "system", "content": "\n".join(lines)},
        {"role": "user", "content": user_message[:MAX_MESSAGE_CHARS]},
    ]
    try:
        raw = _generate_groq(messages, max_tokens=150, temperature=0.1)
    except Exception:
        logger.exception("Werkzeug-Klassifizierung fehlgeschlagen.")
        return None, {}
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return None, {}
    try:
        parsed = json.loads(match.group(0))
    except (json.JSONDecodeError, TypeError):
        return None, {}
    tool_name = parsed.get("tool") if isinstance(parsed, dict) else None
    if not tool_name or tool_name == "none":
        return None, {}
    arguments = parsed.get("arguments")
    return tool_name, dict(arguments) if isinstance(arguments, dict) else {}


def _call_model_with_router(messages, user_message, max_tokens, tools, captured, temperature,
                             available_tokens=None, synthesize_audio_fn=None):
    """General-mode counterpart to _call_model: tool selection runs as its
    own dedicated classification pass (_classify_tool) instead of being
    embedded in the same call as the actual reply. The model follows a
    short, single-purpose prompt (just the tool list and the latest
    message) far more reliably than the same tool-calling
    convention competing for attention inside NexAI's much longer,
    already-elaborate character/personality system prompt (see this
    module's docstring) -- verified empirically: the combined-prompt
    approach _call_model uses missed or hallucinated tool calls in
    testing once the full character prompt was included, while this
    split version chose correctly across image/Wikipedia/none cases.
    Game/webapp/code modes don't use this -- their one real "tool",
    propose_project_change, IS the generative task (produce the whole new
    code), not a lookup a classifier could route to, so they keep
    _call_model's embedded-tool_call approach, and their system prompts
    are far shorter/more focused to begin with.

    `messages` is the full prompt (system + history + this turn) for the
    actual reply; `user_message` is just this turn's raw text, used only
    for classification (kept short and history-free on purpose, for the
    same reliability reason)."""
    if captured is None:
        captured = {}
    captured.setdefault("proposed_change", None)
    captured.setdefault("wikipedia_facts", [])
    captured.setdefault("user_facts", [])
    captured.setdefault("personality_adjustments", [])

    final_messages = messages
    # generate_image/generate_audio have a strict output-format requirement
    # (the frontend only renders an image/audio player if the reply
    # contains the exact ![]()/!audio[]() markdown) -- rather than hoping
    # the follow-up call reliably reproduces that syntax verbatim (it
    # often didn't, in testing: the model would talk about the image
    # instead of embedding it), the markdown is appended in code below,
    # guaranteed, and the model is only asked for a short natural comment
    # around it.
    forced_markdown = None
    if tools:
        tool_name, arguments = _classify_tool(user_message, tools)
        if tool_name:
            try:
                result = _execute_one_tool_call(
                    tool_name, arguments, captured,
                    available_tokens=available_tokens, synthesize_audio_fn=synthesize_audio_fn,
                )
            except Exception:
                logger.exception("Werkzeugaufruf '%s' fehlgeschlagen.", tool_name)
                result = (
                    f"Das Werkzeug '{tool_name}' ist gerade an einem technischen Fehler "
                    "gescheitert. Erklär das dem Nutzer ehrlich, statt es als Erfolg "
                    "darzustellen."
                )
            image_generated = captured.get("image_generated")
            audio_generated = captured.get("audio_generated")
            if tool_name == "generate_image" and image_generated:
                forced_markdown = f"![{image_generated['prompt']}]({image_generated['url']})"
            elif tool_name == "generate_audio" and audio_generated:
                forced_markdown = f"!audio[Sprachnachricht]({audio_generated['url']})"
            follow_up = (
                f"Du hast gerade automatisch das Werkzeug '{tool_name}' benutzt. Ergebnis:\n{result}\n\n"
            )
            if forced_markdown:
                follow_up += (
                    "Schreib dazu nur einen KURZEN, natürlichen Kommentar (ein bis zwei Sätze) -- "
                    "das Bild/die Sprachnachricht selbst wird automatisch angehängt, du musst "
                    "KEIN Markdown dafür selbst einbinden."
                )
            else:
                follow_up += (
                    "Schreib jetzt deine eigentliche Antwort an den Nutzer, die dieses Ergebnis "
                    "einbezieht."
                )
            final_messages = messages + [{"role": "system", "content": follow_up}]
    content = _generate_groq(final_messages, max_tokens, temperature=temperature).strip()
    if forced_markdown and forced_markdown not in content:
        content = f"{content}\n\n{forced_markdown}" if content else forced_markdown
    return content, captured["proposed_change"]


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
        "\n\nVom NexAI-Team über den Admin-Bereich bestätigte Fakten -- sieh sie dir vor "
        "JEDER Antwort aktiv an, behandle sie als sicher wahr ohne sie infrage zu stellen, "
        "und beziehe sie ein, wann immer sie zur Frage passen:\n" + lines
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
            "unverifiziert und könnte veraltet oder falsch sein, aber sieh es dir vor JEDER "
            "Antwort aktiv an und beziehe ein, was wirklich relevant für diese Nachricht ist "
            "(nicht stur alles erwähnen, aber auch nicht ignorieren). Wird niemandem außer dir "
            "gezeigt, auch nicht dem Nutzer selbst:\n" + lines
        )
    if behavior_note:
        parts.append("\n\nHinweis (intern, nicht dem Nutzer zeigen): " + behavior_note)
    return "".join(parts)


def generate_reply(message, context=None, history=None, project_type=None, facts=None,
                    learned_facts=None, captured=None, behavior_note=None, personality=None,
                    available_tokens=None, synthesize_audio_fn=None):
    """Runs one turn against Groq's hosted model (see _generate_groq). Not
    meant to be called directly from a request handler -- see start_chat_job().
    `history` is this same chat's own prior turns (a list of
    {"role": "user"|"assistant", "content": str} dicts, oldest first).
    `project_type` is "game", "webapp", or None (general chat) and picks
    both the system prompt variant and which tools are offered. `facts`
    is the list of admin-confirmed facts (see _facts_addendum). `learned_facts`
    is an optional {"wikipedia": [...], "user": [...], "docs": [...]} dict of
    previously auto-learned/seeded facts (see _learned_facts_addendum) --
    only applied in general mode. `captured`, if given, is mutated in place
    with any new wikipedia_facts/user_facts learned during *this* call, for
    the caller to persist (see _call_model). `behavior_note`, if given, is a
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
    elif project_type == "code":
        pass
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
    elif project_type == "code":
        # The standalone "Neuesten Code-Chat erstellen" sidebar button, with
        # no Studio project/file attached (that's what game/webapp are for)
        # -- plain programming help via the chat itself, still kept out of
        # general mode so it doesn't get NexAI-platform chit-chat framing
        # or the Wikipedia/weather/personality machinery meant for that.
        system_prompt = BASE_SYSTEM_PROMPT + CODE_CHAT_ADDENDUM
        tools = CODE_CHAT_TOOLS
        temperature = CODE_TEMPERATURE
    else:
        system_prompt = GENERAL_SYSTEM_PROMPT + FRIEND_CHARACTER_ADDENDUM + GENERAL_TOOLS_ADDENDUM
        tools = AI_TOOLS
        temperature = GENERAL_TEMPERATURE
    system_prompt += FORMATTING_ADDENDUM
    system_prompt += _facts_addendum(facts)
    if project_type is None and (learned_facts or behavior_note):
        learned_facts = learned_facts or {}
        system_prompt += _learned_facts_addendum(
            learned_facts.get("wikipedia") or [], learned_facts.get("user") or [],
            learned_facts.get("docs") or [], behavior_note,
        )
    if project_type is None:
        system_prompt += _personality_addendum(personality)
        if available_tokens is not None:
            system_prompt += (
                f"\n\nDieser Nutzer hat aktuell {available_tokens} Tokens übrig (eine App-interne "
                f"Währung, getrennt von Punkten). Ein Bild erzeugen oder bearbeiten kostet "
                f"{IMAGE_TOKEN_COST} Tokens, eine Sprachnachricht erzeugen kostet {AUDIO_TOKEN_COST} "
                "Tokens -- ruf generate_image/edit_image/generate_audio nur auf, wenn klar genug Tokens übrig sind und der "
                "Nutzer das wirklich ausdrücklich möchte. Echte Video-Erstellung gibt es aktuell "
                "NICHT -- falls danach gefragt wird, erklär ehrlich, dass das (noch) nicht "
                "unterstützt wird, statt es vorzutäuschen. WICHTIG, falls jemand fragt, wie "
                "man mehr Tokens bekommt: Es gibt AKTUELL KEINEN Store, keine kaufbaren "
                "Token-Pakete und keine Möglichkeit, mit echtem Geld Tokens zu kaufen -- erfinde "
                "so etwas niemals (kein Store, keine Preise, keine Zahlungsmethoden). Die einzigen "
                "echten Wege sind: 1000 Tokens einmalig beim allerersten Start, danach jeden Tag, "
                "an dem der Account aktiv ist, automatisch +900 Tokens dazu (nicht anfragbar, "
                "läuft von selbst). Sag das ehrlich, statt dir Käufe oder Codes auszudenken."
            )
    # General mode's tools are handled by _call_model_with_router's separate
    # classification pass instead (see there for why) -- the embedded
    # ```tool_call``` convention below is only taught to game/webapp/code
    # mode's prompt, where the one real "tool" (propose_project_change) is
    # inherently generative and doesn't fit a classify-then-look-up router.
    if tools and project_type is not None:
        system_prompt += _tools_instructions(tools)

    messages = [{"role": "system", "content": system_prompt}]
    if history:
        messages.extend(history[-MAX_HISTORY_MESSAGES:])
    messages.append({"role": "user", "content": user_content})

    if project_type is None:
        return _call_model_with_router(
            messages, message, MAX_REPLY_TOKENS, tools, captured, temperature,
            available_tokens=available_tokens, synthesize_audio_fn=synthesize_audio_fn,
        )
    return _call_model(messages, MAX_REPLY_TOKENS, tools=tools, captured=captured, temperature=temperature)


def generate_title(first_message):
    """One extra, cheap request that turns a chat's opening message into a
    short 2-4 word label for the chat list."""
    try:
        title, _ = _call_model(
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
                    learned_facts=None, on_done=None, behavior_note=None, personality=None,
                    available_tokens=None, synthesize_audio_fn=None):
    """`on_done(reply, error, proposed_change, new_learned_facts)` --
    new_learned_facts is always a {"wikipedia": [...], "user": [...],
    "personality_adjustments": [...], "image_generated": {...} or None,
    "audio_generated": {...} or None} dict (possibly with empty lists) of
    facts/trait nudges/image-or-audio-tool-calls from *this* call, for the
    caller to persist as AiLearnedFact rows / AiPersonality updates / token
    deductions. `synthesize_audio_fn(text, gender)`, if given, is called
    synchronously from inside the generate_audio tool handler and must
    return a playable URL (already generated *and* stored) or None on
    failure/unavailability -- see app.py's _synthesize_and_store_audio."""
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
                behavior_note, personality, available_tokens,
                synthesize_audio_fn=synthesize_audio_fn,
            )
            new_learned_facts = {
                "wikipedia": captured.get("wikipedia_facts") or [],
                "user": captured.get("user_facts") or [],
                "personality_adjustments": captured.get("personality_adjustments") or [],
                "image_generated": captured.get("image_generated"),
                "audio_generated": captured.get("audio_generated"),
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
