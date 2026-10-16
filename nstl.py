"""NSTL: no accounts, nothing to sign in to.  You ask a question; the browser looks it up on Wikipedia (German and English) and hands
what it finds to a swarm of several million small agents (static/js/nstl-swarm-worker.js, running in a Web Worker so the page itself
stays responsive).  The agents are not language models: each only compares a handful of measured properties of the Wikipedia pages it
was handed.  They argue about which page answers the question best, talking to each other in a language they make up as they go (short
made-up words), and the page shows that argument live -- a map of the swarm and a window with real sampled talks, not scripted ones --
before showing the Wikipedia passage the swarm settled on.  Nothing a visitor types reaches this server: the Wikipedia lookup and the
whole simulation run in the browser.

Was the home page for a few hours on 2026-10-16; now archived at /nstl-archiv, unlinked from anywhere, after the user asked for
"echte AIs" instead.  See regal.py (templates/regal_agents.html) for what replaced it, and /nex-ai-archiv for the plain chat before it.
"""
from flask import Response, make_response, render_template, request

SITE_NAME = "NSTL"
DESCRIPTION = "NSTL: Stell eine Frage. Bis zu 10 Millionen kleine Agenten lesen dazu die Wikipedia, einigen sich live auf eine Antwort und auf eine eigene Sprache. Ohne Anmeldung, nichts verlässt deinen Browser außer der Wikipedia-Suche selbst."

# The page asks Wikipedia (German and English) for pages matching the typed question, directly from the visitor's browser; nothing else.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self' https://de.wikipedia.org https://en.wikipedia.org; manifest-src 'self'; worker-src 'self'; "
    "base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
# The worker that runs the swarm never talks to the network at all: it only computes and reports back to the page.
WORKER_PATH = "/static/js/nstl-swarm-worker.js"
WORKER_CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self'"
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), interest-cohort=()"
ENDPOINTS = set()           # filled by register_routes: every endpoint of this module (the site's login gate must let them through)


def base_url():
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else 'https'}://{request.host}"


def manifest():
    return {
        "name": "NSTL: ein Agentenschwarm sucht deine Antwort", "short_name": SITE_NAME, "description": DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/nstl-archiv", "start_url": "/nstl-archiv", "scope": "/nstl-archiv", "display": "standalone", "orientation": "any",
        "background_color": "#212121", "theme_color": "#212121", "categories": ["utilities", "education"],
        "icons": [
            {"src": "/static/img/nstl-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/nstl-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/nstl-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def page_headers(response):
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    return response


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
    def nstl_headers(response):
        if request.path == WORKER_PATH and response.status_code == 200:
            response.headers["Content-Security-Policy"] = WORKER_CONTENT_SECURITY_POLICY
        if request.endpoint in ENDPOINTS:
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
            if request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https":
                response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        return response

    @route("/nstl-archiv", endpoint="nstl_archive_home")
    def nstl_home():
        """The question box, the swarm's live map and chat window, and the answer it agrees on.  No longer the home page; still
        fully reachable here, just unlinked from it."""
        page = render_template("nstl.html", description=DESCRIPTION, base=base_url())
        return page_headers(make_response(page))

    @route("/nstl-archiv/manifest.webmanifest", endpoint="nstl_manifest")
    def nstl_manifest():
        import json
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")
