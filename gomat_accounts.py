"""gomat accounts: real accounts (name, e-mail, password) that keep a learner's progress on the server, so it
follows them from one device to the next. Without an account gomat still works: the progress then lives only
in the browser (static/js/gomat-core.js).

  POST /api/gomat/signup    {name, email, password, state?}  -> creates the account and signs in
  POST /api/gomat/login     {email, password}                -> signs in, returns the saved progress
  POST /api/gomat/logout                                     -> signs out
  GET  /api/gomat/me                                         -> who is signed in (and the saved progress); sets no cookie
  PUT  /api/gomat/save      {state, baseRev}                 -> saves the progress (refuses if another device saved in between)
  POST /api/gomat/password  {oldPassword, newPassword}       -> changes the password, signs the other devices out
  POST /api/gomat/delete    {password}                       -> deletes the account and everything stored with it

The sign-in is kept in its own signed cookie (`gomat_session`, see siteauth.py), separate from the other parts of
this site and independent of the site's SECRET_KEY. Passwords are stored only as salted hashes. Every route takes
JSON only (a web form cannot send it) and refuses requests that come from another site.
"""
import json
import re
from datetime import datetime, timezone

from flask import jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

import siteauth
from models import db
from siteauth import CookieAuth, RateLimiter, client_addresses, same_origin

ACCOUNT_ENDPOINTS = {"gomat_signup", "gomat_login", "gomat_logout", "gomat_me", "gomat_save", "gomat_password", "gomat_delete"}
COOKIE = "gomat_session"

MAX_STATE_BYTES = 120_000
MIN_PASSWORD = 8
MAX_PASSWORD = 200
MAX_NAME = 30
MAX_EMAIL = 254
DEFAULT_NAME = "Mathe-Fan"
EMAIL_RE = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,24}")
CONTROL_RE = re.compile("[\x00-\x1f\x7f  ]")

# Attempts are counted per address / per e-mail in this process (enough to stop guessing, no extra database). The address limits
# are generous because a whole school class can share one address; the per-e-mail limit is what stops password guessing.
LIMITS = {"login-ip": (60, 600), "login-mail": (8, 900), "signup-ip": (30, 3600), "password": (8, 900), "delete": (6, 900),
          "login-flood": (600, 600), "signup-flood": (300, 3600)}
_hits = {}
limiter = RateLimiter(LIMITS, _hits)
auth = CookieAuth(COOKIE, salt="gomat-account-v1")


class GomatUser(db.Model):
    __tablename__ = "gomat_user"
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(MAX_EMAIL), unique=True, nullable=False)
    name = db.Column(db.String(60), nullable=False, default=DEFAULT_NAME)
    password_hash = db.Column(db.String(255), nullable=False)
    session_gen = db.Column(db.Integer, nullable=False, default=0)       # bumped by a password change: older sessions end
    state = db.Column(db.Text, nullable=True)                            # the learner's progress (JSON)
    rev = db.Column(db.Integer, nullable=False, default=0)               # +1 with every save
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_login_at = db.Column(db.DateTime, nullable=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def public(self):
        return {"name": self.name, "email": self.email}


_DUMMY_HASH = generate_password_hash("not-a-real-password")      # checked when the e-mail is unknown, so timing does not tell


# --------------------------------------------------------------------------------------------- helpers

def too_many(kind, key):
    return limiter.too_many(kind, key)


def clear_attempts(kind, key):
    limiter.clear(kind, key)


def fail(error, status=400, **extra):
    return jsonify({"ok": False, "error": error, **extra}), status


def read_json():
    data = request.get_json(silent=True) if request.is_json else None
    return data if isinstance(data, dict) else None


def normalise_email(raw):
    email = raw.strip().lower() if isinstance(raw, str) else ""
    return email if len(email) <= MAX_EMAIL and EMAIL_RE.fullmatch(email) else None


def clean_name(raw, email=""):
    name = re.sub(r"\s+", " ", CONTROL_RE.sub(" ", raw)).strip() if isinstance(raw, str) else ""
    return name[:MAX_NAME].strip() or DEFAULT_NAME


def valid_password(raw):
    return isinstance(raw, str) and MIN_PASSWORD <= len(raw) <= MAX_PASSWORD


def valid_state(raw):
    """Progress is stored as the page's own JSON: a small object with version 1."""
    if not isinstance(raw, dict) or raw.get("v") != 1:
        return False
    return len(json.dumps(raw, separators=(",", ":"))) <= MAX_STATE_BYTES


def current_account():
    payload = auth.read()
    if not isinstance(payload, dict) or not isinstance(payload.get("uid"), int):
        return None
    user = db.session.get(GomatUser, payload["uid"])
    if user is None or payload.get("gen") != user.session_gen:
        return None
    return user


def signed_in(response, user):
    """Puts the sign-in cookie on `response`."""
    return auth.attach(response, {"uid": user.id, "gen": user.session_gen})


def stored_state(user):
    if not user.state:
        return None
    try:
        return json.loads(user.state)
    except ValueError:
        return None


# ----------------------------------------------------------------------------------------------- routes

def register_routes(app):
    @app.before_request
    def gomat_accounts_guard():
        if request.endpoint in ACCOUNT_ENDPOINTS and request.method != "GET" and not same_origin():
            return fail("forbidden", 403)

    @app.after_request
    def gomat_accounts_headers(response):
        if request.endpoint in ACCOUNT_ENDPOINTS:
            response.headers["Cache-Control"] = "no-store"
            response.headers["Vary"] = "Cookie"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.route("/api/gomat/signup", methods=["POST"])
    def gomat_signup():
        data = read_json()
        if data is None:
            return fail("bad_request", 415)
        first, last = client_addresses()
        if too_many("signup-ip", first) or too_many("signup-flood", last):
            return fail("too_many", 429)
        email = normalise_email(data.get("email"))
        if email is None:
            return fail("bad_email")
        if not valid_password(data.get("password")):
            return fail("bad_password")
        if GomatUser.query.filter_by(email=email).first() is not None:
            return fail("email_taken", 409)
        user = GomatUser(email=email, name=clean_name(data.get("name")), last_login_at=datetime.now(timezone.utc))
        user.set_password(data["password"])
        state = data.get("state")
        if state is not None and valid_state(state):
            user.state = json.dumps(state, separators=(",", ":"))
            user.rev = 1
        db.session.add(user)
        db.session.commit()
        return signed_in(jsonify({"ok": True, "user": user.public(), "rev": user.rev}), user)

    @app.route("/api/gomat/login", methods=["POST"])
    def gomat_login():
        data = read_json()
        if data is None:
            return fail("bad_request", 415)
        email = normalise_email(data.get("email"))
        password = data.get("password")
        first, last = client_addresses()
        if too_many("login-ip", first) or too_many("login-flood", last) or (email and too_many("login-mail", email)):
            return fail("too_many", 429)
        user = GomatUser.query.filter_by(email=email).first() if email else None
        hash_to_check = user.password_hash if user else _DUMMY_HASH
        right = isinstance(password, str) and len(password) <= MAX_PASSWORD and check_password_hash(hash_to_check, password)
        if not user or not right:
            return fail("wrong_login", 401)
        clear_attempts("login-mail", email)
        user.last_login_at = datetime.now(timezone.utc)
        db.session.commit()
        return signed_in(jsonify({"ok": True, "user": user.public(), "rev": user.rev, "state": stored_state(user)}), user)

    @app.route("/api/gomat/logout", methods=["POST"])
    def gomat_logout():
        return auth.clear(jsonify({"ok": True}))

    @app.route("/api/gomat/me")
    def gomat_me():
        user = current_account()
        if user is None:
            return jsonify({"ok": True, "user": None})
        return jsonify({"ok": True, "user": user.public(), "rev": user.rev, "state": stored_state(user)})

    @app.route("/api/gomat/save", methods=["PUT"])
    def gomat_save():
        user = current_account()
        if user is None:
            return fail("not_logged_in", 401)
        data = read_json()
        if data is None or not valid_state(data.get("state")):
            return fail("bad_state", 400)
        base_rev = data.get("baseRev")
        if base_rev != user.rev:
            # Another device saved since this one last looked: hand over what is stored instead of overwriting it.
            return fail("newer", 409, rev=user.rev, state=stored_state(user))
        user.state = json.dumps(data["state"], separators=(",", ":"))
        user.rev += 1
        db.session.commit()
        return jsonify({"ok": True, "rev": user.rev})

    @app.route("/api/gomat/password", methods=["POST"])
    def gomat_password():
        user = current_account()
        if user is None:
            return fail("not_logged_in", 401)
        data = read_json()
        if data is None:
            return fail("bad_request", 415)
        if too_many("password", str(user.id)):
            return fail("too_many", 429)
        old, new = data.get("oldPassword"), data.get("newPassword")
        if not isinstance(old, str) or len(old) > MAX_PASSWORD or not user.check_password(old):
            return fail("wrong_password", 403)
        if not valid_password(new):
            return fail("bad_password")
        user.set_password(new)
        user.session_gen += 1                  # every other device has to sign in again
        db.session.commit()
        return signed_in(jsonify({"ok": True}), user)

    @app.route("/api/gomat/delete", methods=["POST"])
    def gomat_delete():
        user = current_account()
        if user is None:
            return fail("not_logged_in", 401)
        data = read_json()
        if data is None:
            return fail("bad_request", 415)
        if too_many("delete", str(user.id)):
            return fail("too_many", 429)
        password = data.get("password")
        if not isinstance(password, str) or len(password) > MAX_PASSWORD or not user.check_password(password):
            return fail("wrong_password", 403)
        db.session.delete(user)
        db.session.commit()
        return auth.clear(jsonify({"ok": True}))
