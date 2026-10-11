"""Nex Ai: a chat with one AI that runs on the visitor's own computer.  This is the home page of the site.

There is nothing to choose: the page takes the best model that the computer can run (static/data/browser-models.json, made by
scripts/build_browser_models.py), loads it once from Hugging Face into the browser, and a worker (static/js/regal-chat-worker.js) lets it
write the answers on the graphics card or processor.  What people write never reaches this server: it delivers the page and the
program that runs the model (static/vendor/transformers) and keeps no data about visitors: no accounts, no cookies.  The scripts are
static/js/regal-chat*.js.

The earlier home page, a list of more than a thousand free AI models to download (static/data/models.json, made by
scripts/build_catalog.py), is still at /modelle-archiv (scripts static/js/regal*.js).
"""
import gzip
import json
import os

from flask import Response, make_response, redirect, render_template, request, send_file, send_from_directory
from werkzeug.utils import safe_join

SITE_NAME = "Nex Ai"
DESCRIPTION = "Nex Ai: über 1000 kostenlose KI-Modelle zum Herunterladen auf deinen PC. Zum Chatten, für Bilder, Videos, Musik, Sprache und mehr, mit Größe, Lizenz und allen Dateien."

# The page asks Hugging Face for the files that people choose to download (never for anything else), and the CDN that Hugging Face
# sends them from; that is all it may talk to besides this site.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co; manifest-src 'self'; worker-src 'self'; "
    "base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
CHAT_DESCRIPTION = "Nex Ai: Chat mit einer KI, die auf deinem eigenen Computer läuft. Ohne App, ohne Konto, ohne Server. Deine Fragen verlassen dein Gerät nie."
# The worker that runs the model (static/js/regal-chat-worker.js) gets its own policy, because a worker is bound by the policy of its own
# script and not by the page's: it may run WebAssembly (the AI runtime) and fetch the model from Hugging Face, and nothing else.
WORKER_PATH = "/static/js/regal-chat-worker.js"
WORKER_CONTENT_SECURITY_POLICY = (
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co"
)
VENDOR_PATH = "/static/vendor/"
VENDOR_TYPES = {".mjs": "text/javascript", ".js": "text/javascript", ".wasm": "application/wasm", ".txt": "text/plain; charset=utf-8"}
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), interest-cohort=()"
ENDPOINTS = set()           # filled by register_routes: every endpoint of this module (the site's login gate must let them through)


def base_url():
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else 'https'}://{request.host}"


def manifest():
    return {
        "name": f"{SITE_NAME}: KI-Chat auf deinem Computer", "short_name": SITE_NAME, "description": CHAT_DESCRIPTION, "lang": "de", "dir": "ltr",
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
    def regal_home():
        """The home page is the chat: one AI, nothing to choose, running on the visitor's own computer."""
        page = render_template("regal_chat.html", description=CHAT_DESCRIPTION, base=base_url())
        return page_headers(make_response(page))

    @route("/chat", endpoint="regal_chat")
    def regal_chat():
        return redirect("/", code=301)                      # the chat used to live here

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

    @route("/manifest.webmanifest", endpoint="regal_manifest")
    def regal_manifest():
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")
