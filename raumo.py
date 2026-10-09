"""raumo: scanning rooms by walking through them, in the browser of a phone.  This is the home page of the site.

What the server does is little: it hands out the page and its files, and the manifest that lets the page be installed like an app.
Everything else happens on the phone: the camera and the sensors are read there, the points are made there, and the scans are kept
there (in the browser's own database).  Nothing a visitor scans is sent to the server, and there are no accounts, no cookies and no
analytics.  The scripts are static/js/raumo*.js (see raumo-core.js for how the measuring works).
"""
import json

from flask import Response, make_response, render_template, request

ENDPOINTS = {"pl_home", "raumo_manifest"}
DESCRIPTION = "raumo: Gehe mit dem Handy durch einen Raum und scanne ihn. Etwa alle 5 cm entsteht ein Punkt in der gescannten Farbe, die Punktwolke siehst du in 3D. Alles läuft im Browser, nichts wird hochgeladen."

# What the page may load: only its own files (and pictures made on the device).  Styles may be set by the script.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; "
    "connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
# The camera and the motion sensors are the point of the page: it may use them (and WebXR, which follows the phone), nothing else.
PERMISSIONS_POLICY = (
    "camera=(self), gyroscope=(self), accelerometer=(self), magnetometer=(self), xr-spatial-tracking=(self), "
    "microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=()"
)


def base_url():
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else 'https'}://{request.host}"


def manifest():
    return {
        "name": "raumo – Räume scannen", "short_name": "raumo", "description": DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any",
        "background_color": "#0c0d10", "theme_color": "#0c0d10", "categories": ["utilities", "productivity"],
        "icons": [
            {"src": "/static/img/raumo-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/raumo-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/raumo-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
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
        def decorator(function):
            endpoint = options.pop("endpoint", function.__name__)
            app.add_url_rule(rule, endpoint, function, **options)
            return function
        return decorator

    @route("/", endpoint="pl_home")
    def raumo_home():
        return page_headers(make_response(render_template("raumo.html", description=DESCRIPTION, base=base_url())))

    @route("/manifest.webmanifest", endpoint="raumo_manifest")
    def raumo_manifest():
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")

    @app.after_request
    def raumo_headers(response):
        if request.endpoint in ENDPOINTS:
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
            if request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https":
                response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        return response
