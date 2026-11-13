"""The page that Railway shows now (moved.py): the site has moved to its own server, so the old address only says so and gives the new link. It needs no database and no other settings;
the new address comes from NEW_URL (https://thesaturnweb.duckdns.org by default). Railway starts it with `gunicorn moved:app` (see railpack.json and Procfile); the new server does not use this file."""
import os
from urllib.parse import quote

from flask import Flask, Response, request
from markupsafe import escape

app = Flask(__name__)
NEW_URL = os.environ.get("NEW_URL", "https://thesaturnweb.duckdns.org").rstrip("/")

PAGE = """<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Wir sind umgezogen!</title>
<style>
  :root { --bg: #ffffff; --text: #111111; --muted: #666666; --accent: #7a2cf0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0b0b0d; --text: #f4f4f5; --muted: #a1a1aa; } }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 520px; margin: 0 auto; padding: 18vh 24px 48px; text-align: center; }
  h1 { margin: 0 0 12px; font-size: 34px; letter-spacing: -0.02em; }
  p { margin: 0 0 22px; color: var(--muted); }
  a.go { display: inline-block; padding: 14px 24px; border-radius: 14px; background: var(--accent); color: #fff; font-weight: 700; text-decoration: none; word-break: break-all; }
  a.go:focus-visible { outline: 3px solid var(--text); outline-offset: 3px; }
  small { display: block; margin-top: 26px; color: var(--muted); }
</style>
</head>
<body>
<main>
  <h1>Wir sind umgezogen!</h1>
  <p>Das ist unser neuer Link:</p>
  <a class="go" href="{href}">{shown}</a>
  <small>Beim ersten Besuch musst du dich neu anmelden und Benachrichtigungen neu erlauben.</small>
</main>
</body>
</html>
"""


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>", methods=["GET", "HEAD"])
def moved(path):
    """Every address of the old site answers with the notice; the link goes to the same place on the new site."""
    target = NEW_URL + "/" + quote(path, safe="/@:+~-._")
    if request.query_string:
        target += "?" + request.query_string.decode("utf-8", "replace")
    html = PAGE.replace("{href}", str(escape(target))).replace("{shown}", str(escape(NEW_URL.removeprefix("https://").removeprefix("http://"))))
    response = Response(html, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    return response
