"""KI-Regal: a shelf with more than a thousand free AI models to download to your own computer.  This is the home page of the site.

The models themselves are not here (that would be many terabytes): they live at Hugging Face, the usual public place for free models.
What is here is the list (static/data/models.json, made by scripts/build_catalog.py): what each model does, how big it is, its licence,
and the exact files.  The page lets people look for one, and download its files: either with the browser's normal download, or (in
Chrome and Edge on a computer) straight into a folder they pick, such as the models folder of ComfyUI or LM Studio.  The files come from
Hugging Face to the visitor's browser; our server is not involved, and it keeps no data about visitors: no accounts, no cookies.
The scripts are static/js/regal*.js.
"""
import json
import os

from flask import Response, make_response, render_template, request

SITE_NAME = "KI-Regal"
DESCRIPTION = "KI-Regal: über 1000 kostenlose KI-Modelle zum Herunterladen auf deinen PC. Zum Chatten, für Bilder, Videos, Musik, Sprache und mehr, mit Größe, Lizenz und allen Dateien."

# The page asks Hugging Face for the files that people choose to download (never for anything else), and the CDN that Hugging Face
# sends them from; that is all it may talk to besides this site.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co; manifest-src 'self'; worker-src 'self'; "
    "base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), interest-cohort=()"
ENDPOINTS = set()           # filled by register_routes: every endpoint of this module (the site's login gate must let them through)


def base_url():
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else 'https'}://{request.host}"


def manifest():
    return {
        "name": f"{SITE_NAME}: kostenlose KI-Modelle", "short_name": SITE_NAME, "description": DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any",
        "background_color": "#0b0e14", "theme_color": "#0b0e14", "categories": ["utilities", "productivity"],
        "icons": [
            {"src": "/static/img/regal-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/regal-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/regal-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
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
        if request.endpoint in ENDPOINTS:
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
            if request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https":
                response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        return response

    @route("/", endpoint="pl_home")
    def regal_home():
        count, generated = catalog_facts(app.root_path)
        page = render_template("regal.html", description=DESCRIPTION, base=base_url(), count=count, generated=generated)
        return page_headers(make_response(page))

    @route("/manifest.webmanifest", endpoint="regal_manifest")
    def regal_manifest():
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")
