"""Shared pieces for the parts of this site that have accounts of their own (gomat, yipi).

* A signing key that lives in the database. Sessions of the older parts of the site are signed with the
  environment's SECRET_KEY, which falls back to a public default when nobody set it. The sign-in cookies made
  here do not depend on that: their key is a random value created on first use and stored in the table
  `site_secret`, so forging a cookie would need the database itself.
* `CookieAuth`: a signed, HttpOnly, SameSite=Lax cookie that carries a small payload (who is signed in).
  Visitors who never sign in never get one.
* `RateLimiter`: counts attempts per key inside a time window (in this process, which is enough to stop guessing).
"""
import os
import secrets
import time

from flask import request
from itsdangerous import BadSignature, URLSafeTimedSerializer
from sqlalchemy.exc import IntegrityError

from models import db

PRODUCTION = bool(os.environ.get("RAILWAY_ENVIRONMENT_NAME") or os.environ.get("RAILWAY_ENVIRONMENT"))


class SiteSecret(db.Model):
    __tablename__ = "site_secret"
    name = db.Column(db.String(64), primary_key=True)
    value = db.Column(db.String(128), nullable=False)


_keys = {}


def secret(name):
    """A random key that is made on first use and kept in the database (the same for every worker process)."""
    if name in _keys:
        return _keys[name]
    row = db.session.get(SiteSecret, name)
    if row is None:
        row = SiteSecret(name=name, value=secrets.token_hex(32))
        db.session.add(row)
        try:
            db.session.commit()
        except IntegrityError:                     # another worker was faster: use its key
            db.session.rollback()
            row = db.session.get(SiteSecret, name)
    _keys[name] = row.value
    return row.value


class CookieAuth:
    """`read()` gives the payload of the request's cookie (or None), `attach()` sets it on a response, `clear()` removes it."""

    def __init__(self, cookie, salt, days=30):
        self.cookie = cookie
        self.salt = salt
        self.max_age = days * 86400

    def _serializer(self):
        return URLSafeTimedSerializer(secret(f"cookie:{self.cookie}"), salt=self.salt)

    def read(self):
        raw = request.cookies.get(self.cookie)
        if not raw:
            return None
        try:
            return self._serializer().loads(raw, max_age=self.max_age)
        except BadSignature:                      # also an expired one
            return None

    def attach(self, response, payload):
        response.set_cookie(self.cookie, self._serializer().dumps(payload), max_age=self.max_age, httponly=True, samesite="Lax", secure=PRODUCTION, path="/")
        return response

    def clear(self, response):
        """Removes the cookie -- but only if the browser sent one, so a visitor without an account never gets a cookie header."""
        if request.cookies.get(self.cookie) is not None:
            response.delete_cookie(self.cookie, path="/", httponly=True, samesite="Lax", secure=PRODUCTION)
        return response


class RateLimiter:
    """Counts one attempt per call; True once the limit of its kind is used up within the kind's time window.
    `limits` maps a kind to (how many, within how many seconds)."""

    def __init__(self, limits, hits=None):
        self.limits = limits
        self.hits = {} if hits is None else hits

    def too_many(self, kind, key):
        limit, window = self.limits[kind]
        now = time.time()
        slot = (kind, key)
        recent = [t for t in self.hits.get(slot, ()) if now - t < window]
        recent.append(now)
        self.hits[slot] = recent
        if len(self.hits) > 5000:                 # keep the table small
            for old in [s for s, times in self.hits.items() if not times or now - times[-1] > 3600]:
                self.hits.pop(old, None)
        return len(recent) > limit

    def clear(self, kind, key):
        self.hits.pop((kind, key), None)


def client_addresses():
    """(first, last) address of the visitor: the first entry of X-Forwarded-For is who the request claims to come from
    (it can be faked), the last one is what the host's own proxy saw. Each gets its own, differently strict, limit: the
    first one keeps one person from trying too often, the last one (with a high ceiling) keeps the whole site safe from a flood
    even when the proxy chain makes every visitor look alike."""
    entries = [part.strip() for part in request.headers.get("X-Forwarded-For", "").split(",") if part.strip()]
    fallback = request.remote_addr or "?"
    return (entries[0] if entries else fallback), (entries[-1] if entries else fallback)


def same_origin():
    """A request that names another site as its origin is not ours (behind the host's proxy the site's name may come in a header)."""
    import urllib.parse
    origin = request.headers.get("Origin")
    if not origin:
        return True
    names = {request.host, request.headers.get("X-Forwarded-Host", "").split(",")[0].strip()}
    return urllib.parse.urlparse(origin).netloc in names - {""}
