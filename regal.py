"""Nex Ai: real AI, not on the visitor's own computer any more.  The home page (`/`) sends a question to this server, which asks Groq's
hosted API (ai_assistant.py, the same one the site's other "Nex" chat already uses) in five short, independent passes -- four agents
each write their own answer in a shared, terse symbol notation (AGENT_NOTATION: no grammar, no prose, fewer tokens for the same
content), then a fifth reads all four notes and translates them into the one plain-language answer the visitor sees -- and streams
every word of every pass back to the page as it is written (templates/regal_agents.html, static/js/regal-agents.js), collapsed behind
an "In Bearbeitung" row the visitor can open to watch the agents at work (in their own notation; the final answer below it is always
plain language).  It was an on-device chat before (no download any more: that is the point of this change, made at the user's explicit
request -- "ai's die nicht auf deinem pc laufen"), and for a few hours on 2026-10-16 a page that asked Wikipedia and let small, non-AI
"agents" argue over the result (see nstl.py); both earlier shapes still fully work, unlinked: the on-device single chat at
/nex-ai-archiv, the Wikipedia-swarm one at /nstl-archiv.

Five is a real, honest number, not the "10.000.000" the user asked for: that many real calls to a real AI, per question, has no
realistic cost or latency on a hobby project (and this server runs one request at a time -- see AGENT_ROLES below -- so the five run
one after another, not even in parallel). The page says so plainly rather than pretending otherwise.

The even earlier home page, a list of more than a thousand free AI models to download (static/data/models.json, made by
scripts/build_catalog.py), is still at /modelle-archiv (scripts static/js/regal*.js).
"""
import gzip
import json
import logging
import os

from flask import Response, jsonify, make_response, redirect, render_template, request, send_file, send_from_directory, stream_with_context
from werkzeug.utils import safe_join

import ai_assistant
import siteauth

logger = logging.getLogger(__name__)

SITE_NAME = "Nex Ai"
DESCRIPTION = "Nex Ai: über 1000 kostenlose KI-Modelle zum Herunterladen auf deinen PC. Zum Chatten, für Bilder, Videos, Musik, Sprache und mehr, mit Größe, Lizenz und allen Dateien."

# The page asks Hugging Face for the files that people choose to download (never for anything else), and the CDN that Hugging Face
# sends them from; that is all it may talk to besides this site.  Only the archived single chat (/nex-ai-archiv) uses this any more.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co; manifest-src 'self'; worker-src 'self'; "
    "base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
# The home page only ever talks to its own server now (which in turn talks to Groq, not the visitor's browser): a plain, narrow policy.
AGENTS_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
CHAT_DESCRIPTION = "Nex Ai: Chat mit einer KI, die auf deinem eigenen Computer läuft. Ohne App, ohne Konto, ohne Server. Deine Fragen verlassen dein Gerät nie."
AGENTS_DESCRIPTION = "Nex Ai: Stell eine Frage. Fünf echte KI-Durchgänge arbeiten nacheinander daran und einigen sich auf die beste Antwort – du kannst live mitlesen, was sie schreiben. Ohne Download, ohne Konto."
# The worker that runs the model (static/js/regal-chat-worker.js) gets its own policy, because a worker is bound by the policy of its own
# script and not by the page's: it may run WebAssembly (the AI runtime) and fetch the model from Hugging Face, and nothing else.
# Only the archived single chat (/nex-ai-archiv) loads this worker any more.
WORKER_PATH = "/static/js/regal-chat-worker.js"
WORKER_CONTENT_SECURITY_POLICY = (
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co"
)
VENDOR_PATH = "/static/vendor/"
VENDOR_TYPES = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8"}
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), interest-cohort=()"
ENDPOINTS = set()           # filled by register_routes: every endpoint of this module (the site's login gate must let them through)

# ------------------------------------------------------------------------------------------- the five agents (/api/agents/ask)
# Four independent takes on the question, then a fifth that has read all four and writes the one the visitor actually sees.  Kept
# server-side (not sent by the client) so nobody can turn this into a free-form prompt box for an arbitrary system prompt.
#
# The user asked, after seeing the four agents write plain German, for them to talk "in ihrer effizienten Sprache die niemand
# versteht außer sie selber" (their efficient language that nobody understands but them) -- the same idea behind the very first
# version of this page (the agent swarm, now archived at /nstl-archiv), applied to real AI this time.  A real model does not
# spontaneously invent a shared language between separate, stateless API calls; what IS real and buildable is a fixed, terse
# notation (symbols instead of grammar) that every one of the four agents is given the SAME definition of, so their notes really
# are mutually legible to each other (and to the fifth agent that reads all four) while looking like nothing a visitor could
# read at a glance.  It is genuinely more efficient too -- fewer tokens for the same content -- not just decoration.
AGENT_NOTATION = (
    "Schreib NICHT in ausformulierten Sätzen, sondern in der knappen Notiz-Sprache der Agenten: nur Stichworte, keine Füllwörter, "
    "keine Artikel, kurze Symbole statt ganzer Wörter. '=' heißt ist/bedeutet, '>' heißt führt-zu/deshalb, '+' heißt spricht-dafür, "
    "'-' heißt spricht-dagegen, '?' heißt unsicher/zu-prüfen, ';' trennt Punkte. Trotzdem inhaltlich vollständig und korrekt -- nur "
    "extrem knapp notiert, wie eine Abkürzungs-Notiz für einen anderen Agenten, nicht für Menschen."
)
AGENT_ROLES = {
    "direkt": "Du bist ein KI-Agent. Beantworte die folgende Frage direkt, klar und präzise, in wenigen Punkten. Antworte auf Deutsch, außer die Frage ist in einer anderen Sprache. Sag ehrlich, wenn du etwas nicht sicher weißt.\n\n" + AGENT_NOTATION,
    "gruendlich": "Du bist ein KI-Agent. Beantworte die folgende Frage besonders gründlich: nenne relevante Hintergründe oder Zusammenhänge, die eine ganz kurze Antwort auslassen würde. Antworte auf Deutsch, außer die Frage ist in einer anderen Sprache.\n\n" + AGENT_NOTATION,
    "kritisch": "Du bist ein KI-Agent. Überlege bei der folgenden Frage, was an einer naheliegenden Antwort falsch, unvollständig oder missverständlich sein könnte, und worauf man achten sollte. Antworte auf Deutsch, außer die Frage ist in einer anderen Sprache.\n\n" + AGENT_NOTATION,
    "praktisch": "Du bist ein KI-Agent. Beantworte die folgende Frage so, dass sie im Alltag sofort nützlich ist: konkret, mit einem Beispiel oder nächsten Schritt, wenn das passt. Antworte auf Deutsch, außer die Frage ist in einer anderen Sprache.\n\n" + AGENT_NOTATION,
    "final": (
        "Du bist der KI-Agent, der entscheidet. Du bekommst eine Frage und die Notizen von vier anderen Agenten, geschrieben in "
        "ihrer knappen Notiz-Sprache ('=' ist/bedeutet, '>' führt-zu, '+' dafür, '-' dagegen, '?' unsicher, ';' trennt Punkte). Lies "
        "die Notizen, verstehe ihren Inhalt, und schreib daraus die beste, klare Antwort für den Nutzer in ganz normaler, flüssiger "
        "Sprache -- keine Symbole, keine Notiz-Form, nur normaler Text. Nimm, was am meisten stimmt und am hilfreichsten ist, lass "
        "Widersprüchliches oder Falsches weg. Erwähne die anderen Agenten oder ihre Notation nicht. Antworte auf Deutsch, außer die "
        "Frage ist in einer anderen Sprache."
    ),
}
AGENT_ORDER = ("direkt", "gruendlich", "kritisch", "praktisch")   # the four independent ones, in the order the page asks them
#  GROQ_MODEL currently rejects every call (see ai_assistant.py's comment on generate_chat_title), so every one of these actually runs
#  on GROQ_FALLBACK_MODEL, a reasoning model that spends an unpredictable chunk of max_tokens on its own hidden "reasoning" before
#  writing anything visible -- a low budget here does NOT mean a short visible notation, it means the reasoning eats the whole budget
#  and nothing visible comes out at all (found live: 3 of 4 agents came back empty at 260). Terse output needs just as much headroom
#  as verbose prose did, because the hidden part dwarfs it; these numbers mirror what ai_assistant.py already found necessary.
AGENT_MAX_TOKENS = 600
FINAL_MAX_TOKENS = 700
# One visitor (by the address their own request claims) may ask at most 7 questions (35 agent calls) in 10 minutes; the whole site
# together at most 10 questions a minute -- generous for normal use, a real ceiling against a script hammering the Groq key.
AGENT_LIMITS = {"agents-ip": (35, 600), "agents-flood": (50, 60)}
_agents_hits = {}
_agents_limiter = siteauth.RateLimiter(AGENT_LIMITS, _agents_hits)


def base_url():
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else 'https'}://{request.host}"


def manifest():
    return {
        "name": f"{SITE_NAME}: KI-Chat auf deinem Computer", "short_name": SITE_NAME, "description": CHAT_DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/nex-ai-archiv", "start_url": "/nex-ai-archiv", "scope": "/nex-ai-archiv", "display": "standalone", "orientation": "any",
        "background_color": "#212121", "theme_color": "#212121", "categories": ["utilities", "productivity"],
        "icons": [
            {"src": "/static/img/nex-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/nex-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/nex-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def agents_manifest():
    return {
        "name": f"{SITE_NAME}: mehrere KI-Agenten", "short_name": SITE_NAME, "description": AGENTS_DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any",
        "background_color": "#212121", "theme_color": "#212121", "categories": ["utilities", "productivity"],
        "icons": [
            {"src": "/static/img/nex-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/nex-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/nex-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def page_headers(response):
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    return response


def agents_page_headers(response):
    response.headers["Content-Security-Policy"] = AGENTS_CONTENT_SECURITY_POLICY
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    return response


def catalog_facts(root_path):
    """(count, generated) of the list that is shipped with the site, for the first picture of the page before the list has loaded."""
    try:
        with open(os.path.join(root_path, "static", "data", "models.json"), encoding="utf-8") as handle:
            data = json.load(handle)
        return int(data.get("count") or len(data.get("models", []))), str(data.get("generated", ""))
    except (OSError, ValueError):
        return 0, ""


def register_routes(app):
    def route(rule, **options):
        """Like app.route, and remembers the endpoint for ENDPOINTS."""
        def decorator(function):
            endpoint = options.pop("endpoint", function.__name__)
            ENDPOINTS.add(endpoint)
            app.add_url_rule(rule, endpoint, function, **options)
            return function
        return decorator

    @app.after_request
    def regal_headers(response):
        if request.path == WORKER_PATH and response.status_code == 200:
            response.headers["Content-Security-Policy"] = WORKER_CONTENT_SECURITY_POLICY
        elif request.path.endswith(".woff2") and response.status_code == 200:                  # the font of the site: Python does not know this type on every machine
            response.headers["Content-Type"] = "font/woff2"
        elif request.path.startswith(VENDOR_PATH) and response.status_code == 200:           # the AI runtime: a module script and WebAssembly need the right types
            for ending, kind in VENDOR_TYPES.items():
                if request.path.endswith(ending):
                    response.headers["Content-Type"] = kind
                    response.headers["X-Content-Type-Options"] = "nosniff"
        if request.endpoint in ENDPOINTS:
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
            if request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https":
                response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        return response

    @route("/", endpoint="pl_home")
    def regal_agents_home():
        """The home page: a question runs through five real, server-side AI passes (see AGENT_ROLES), each reading what came
        before it, all visible as they are written."""
        page = render_template("regal_agents.html", description=AGENTS_DESCRIPTION, base=base_url())
        return agents_page_headers(make_response(page))

    @route("/api/agents/ask", endpoint="regal_agents_ask", methods=["POST"])
    def regal_agents_ask():
        """One agent's turn.  `role` picks its system prompt (AGENT_ROLES); `message` is the visitor's question; for role "final"
        the client also sends `agents`, the other four agents' own answers, so the final pass can read and judge them.  Streams the
        reply back as plain text, exactly like /api/ai/chats/<id>/stream -- but this one keeps no history and writes nothing to the
        database: a visitor here has no account and the page promises not to remember the conversation."""
        if not siteauth.same_origin():
            return jsonify({"ok": False, "error": "bad_origin"}), 403
        first, last = siteauth.client_addresses()
        if _agents_limiter.too_many("agents-ip", first) or _agents_limiter.too_many("agents-flood", last):
            return jsonify({"ok": False, "error": "rate_limited"}), 429
        data = request.get_json(silent=True) or {}
        role = data.get("role")
        message = (data.get("message") or "").strip()[:2000]
        if role not in AGENT_ROLES or not message:
            return jsonify({"ok": False, "error": "bad_request"}), 400
        parts = [f"Frage: {message}"]
        if role == "final":
            agents = data.get("agents") if isinstance(data.get("agents"), dict) else {}
            for key in AGENT_ORDER:
                text = str(agents.get(key, "")).strip()[:1500]
                if text:
                    parts.append(f"{key}: {text}")
        combined = "\n\n".join(parts)
        max_tokens = FINAL_MAX_TOKENS if role == "final" else AGENT_MAX_TOKENS

        def generate():
            try:
                yield from ai_assistant.generate_custom_stream(AGENT_ROLES[role], combined, max_tokens=max_tokens)
            except Exception:
                logger.exception("Agenten-Durchgang (%s) fehlgeschlagen", role)        # the client reads a short/empty stream as "nothing came back"
        return Response(stream_with_context(generate()), mimetype="text/plain")

    @route("/nex-ai-archiv", endpoint="regal_archive_home")
    def regal_home():
        """The plain single chat: one AI, nothing to choose, running on the visitor's own computer.  No longer the home page;
        still fully reachable here, just unlinked from it."""
        page = render_template("regal_chat.html", description=CHAT_DESCRIPTION, base=base_url())
        return page_headers(make_response(page))

    @route("/chat", endpoint="regal_chat")
    def regal_chat():
        return redirect("/", code=301)                       # the chat (now the multi-agent page) lives at "/" again

    @route("/modelle-archiv", endpoint="regal_models_archive")
    def regal_models_archive():
        """The earlier home page: the list of more than a thousand free AI models to download (not linked any more)."""
        count, generated = catalog_facts(app.root_path)
        page = render_template("regal.html", description=DESCRIPTION, base=base_url(), count=count, generated=generated)
        return page_headers(make_response(page))

    @route("/static/vendor/transformers/<path:name>", endpoint="regal_vendor")
    def regal_vendor(name):
        """The AI runtime (static/vendor/transformers).  Its two big files are kept compressed in the repository (the WebAssembly: 6.6 MB
        instead of 27 MB; the library: 0.17 instead of 0.58 MB) and sent compressed, which every browser unpacks by itself; a client that
        cannot gets them unpacked.  The other files are sent as they are."""
        folder = os.path.join(app.root_path, "static", "vendor", "transformers")
        packed = safe_join(folder, f"{name}.gz")
        kind = next((mime for ending, mime in VENDOR_TYPES.items() if name.endswith(ending)), "application/octet-stream")
        if packed is None or not os.path.isfile(packed):
            return send_from_directory(folder, name, mimetype=kind, conditional=True, max_age=0)
        if "gzip" in request.headers.get("Accept-Encoding", "").lower():
            response = send_file(packed, mimetype=kind, conditional=True, max_age=0)
            response.headers["Content-Encoding"] = "gzip"
        else:
            response = Response(gzip.open(packed, "rb"), mimetype=kind)
        response.headers["Vary"] = "Accept-Encoding"
        return response

    @route("/nex-ai-archiv/manifest.webmanifest", endpoint="regal_manifest")
    def regal_manifest():
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")

    @route("/manifest.webmanifest", endpoint="regal_agents_manifest")
    def regal_agents_manifest_route():
        return Response(json.dumps(agents_manifest(), ensure_ascii=False), mimetype="application/manifest+json")
