import os
import re
import sys
import uuid
import urllib.parse
import secrets
import hashlib
import logging
import traceback
import requests
from datetime import datetime, timezone, date, timedelta
from dotenv import load_dotenv

# Reads a local .env file (if present) into the process environment before
# anything below reads os.environ -- lets secrets like GROQ_API_KEY be set
# locally without exporting them in the shell every time. Railway itself
# doesn't need this: its dashboard sets real environment variables directly.
load_dotenv()
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, send_from_directory, abort, jsonify, Response, stream_with_context
)
from sqlalchemy import text
from werkzeug.exceptions import HTTPException
from models import (
    db, User, Subscription, ErrorLog, PlMedia, AiChat, AiChatMessage,
    Team, TeamMember, TeamMessage, UserIntegration, NrsHistoryEntry, NrsSite,
)
import ai_assistant
import integrations

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

GENDER_CHOICES = {"maennlich": "Männlich", "weiblich": "Weiblich", "keine_angabe": "Ich will nicht antworten"}
PURPOSE_CHOICES = {
    "school": "Schulische Aktivitäten",
    "work": "Für die Arbeit",
    "private": "Private Nutzung",
}
MIN_REGISTRATION_AGE = 10
KIDS_ACCOUNT_MAX_AGE = 17
REGION_CHOICES = [
    "Baden-Württemberg", "Bayern", "Berlin", "Brandenburg", "Bremen", "Hamburg",
    "Hessen", "Mecklenburg-Vorpommern", "Niedersachsen", "Nordrhein-Westfalen",
    "Rheinland-Pfalz", "Saarland", "Sachsen", "Sachsen-Anhalt",
    "Schleswig-Holstein", "Thüringen", "Anderes",
]


def compute_age(birthdate, today=None):
    today = today or date.today()
    age = today.year - birthdate.year
    if (today.month, today.day) < (birthdate.month, birthdate.day):
        age -= 1
    return age


def is_kids_account(birthdate):
    age = compute_age(birthdate)
    return MIN_REGISTRATION_AGE <= age <= KIDS_ACCOUNT_MAX_AGE


def user_needs_onboarding(user):
    """Existing accounts created before the purpose/country/region/guardian
    questions existed must answer them once before using the site again."""
    return user.purpose_of_use is None


app = Flask(__name__)

database_url = os.environ.get("DATABASE_URL", "sqlite:///videos.db")
if database_url.startswith("postgres://"):
    database_url = database_url.replace("postgres://", "postgresql://", 1)

if "sqlite" in database_url:
    logger.warning("DATENBANK: SQLite wird verwendet — Daten gehen bei Deploys verloren!")
else:
    logger.info("DATENBANK: PostgreSQL verbunden — Daten bleiben dauerhaft erhalten.")

app.config["SQLALCHEMY_DATABASE_URI"] = database_url
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB pro Upload
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

# "Mit Google fortfahren" on the login/signup screen -- real credentials only
# ever come from a Railway env var, never hardcoded (this repo is public).
# Left unset, the button still renders but pl_google_auth_start bounces back
# with a friendly error instead of crashing, so local dev/tests need no
# Google setup at all to run the rest of the app.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME")
R2_PUBLIC_URL = (os.environ.get("R2_PUBLIC_URL") or "").rstrip("/")

USE_R2 = all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL])

r2_client = None
if USE_R2:
    import boto3

    r2_client = boto3.client(
        "s3",
        endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )
    logger.info("MEDIENSPEICHER: Cloudflare R2 verbunden — Dateien bleiben dauerhaft erhalten.")
else:
    logger.warning(
        "HINWEIS: Profilbilder werden lokal im Dateisystem gespeichert. Auf den meisten "
        "kostenlosen Hosting-Plattformen (z.B. Railway) ist dieser Speicher nicht "
        "dauerhaft und Dateien können bei einem Neustart/Deploy verloren gehen."
    )

if not os.environ.get("GROQ_API_KEY"):
    logger.warning("HINWEIS: Kein GROQ_API_KEY gesetzt -- Nex kann keine Antworten generieren.")


def save_media(file_storage, stored_filename):
    """Save an uploaded HEXAGONUM avatar either to R2 (persistent) or local disk (fallback)."""
    if USE_R2:
        r2_client.upload_fileobj(
            file_storage.stream,
            R2_BUCKET_NAME,
            f"pl/{stored_filename}",
            ExtraArgs={"ContentType": file_storage.mimetype or "application/octet-stream"},
        )
    else:
        file_storage.save(os.path.join(PL_MEDIA_DIR, stored_filename))


def delete_media(stored_filename):
    if not stored_filename:
        return
    if USE_R2:
        try:
            r2_client.delete_object(Bucket=R2_BUCKET_NAME, Key=f"pl/{stored_filename}")
        except Exception:
            logger.exception("R2-Löschung fehlgeschlagen für %s", stored_filename)
    else:
        try:
            os.remove(os.path.join(PL_MEDIA_DIR, stored_filename))
        except OSError:
            pass


app.jinja_env.globals["GENDER_CHOICES"] = GENDER_CHOICES
app.jinja_env.globals["PURPOSE_CHOICES"] = PURPOSE_CHOICES
app.jinja_env.globals["REGION_CHOICES"] = REGION_CHOICES
app.template_global()(compute_age)


# Deterministic per-username color for the initial-letter avatar fallback --
# same username always gets the same color (not literally random on every
# render), picked from a curated palette so it's never white/black/too dark
# to read the white initial letter on top of. md5 (not Python's built-in
# hash()) because str hashing is randomized per-process otherwise, which
# would make the color change on every server restart.
PL_AVATAR_PALETTE = [
    "#ff6b6b", "#ff922b", "#f2994a", "#ffb703", "#94d82d",
    "#20c997", "#12b886", "#22b8cf", "#4dabf7", "#5c7cfa",
    "#748ffc", "#9775fa", "#cc5de8", "#da77f2", "#f06595",
]


@app.template_global()
def pl_avatar_color(seed):
    seed = (seed or "?").strip().lower() or "?"
    idx = int(hashlib.md5(seed.encode("utf-8")).hexdigest(), 16) % len(PL_AVATAR_PALETTE)
    return PL_AVATAR_PALETTE[idx]


db.init_app(app)


def ensure_r2_cors_configured():
    """Self-healing fix: a fresh R2 bucket has no CORS policy at all, and
    Safari is strict enough about it to fail loading cross-origin media.
    Apply a permissive GET/HEAD policy on every boot if one isn't already
    set, the same way ensure_columns_exist() self-heals the schema."""
    if not USE_R2:
        return
    try:
        r2_client.get_bucket_cors(Bucket=R2_BUCKET_NAME)
        return  # already configured, leave it alone
    except Exception as exc:
        error_code = getattr(exc, "response", {}).get("Error", {}).get("Code")
        if error_code != "NoSuchCORSConfiguration":
            logger.exception("Konnte R2-CORS-Konfiguration nicht pruefen.")
            return

    try:
        r2_client.put_bucket_cors(
            Bucket=R2_BUCKET_NAME,
            CORSConfiguration={
                "CORSRules": [
                    {
                        "AllowedOrigins": ["*"],
                        "AllowedMethods": ["GET", "HEAD"],
                        "AllowedHeaders": ["*"],
                        "ExposeHeaders": ["Content-Length", "Content-Range", "Content-Type", "Accept-Ranges"],
                        "MaxAgeSeconds": 3600,
                    }
                ]
            },
        )
        logger.info("R2-Bucket hatte keine CORS-Regeln -- permissive GET/HEAD-Policy angewendet.")
    except Exception:
        logger.exception("Konnte R2-CORS-Konfiguration nicht setzen.")


def ensure_sqlite_columns_exist():
    """SQLite equivalent of ensure_columns_exist() below -- db.create_all()
    doesn't add columns to tables that already exist there either, and
    unlike Postgres, SQLite's ALTER TABLE has no "IF NOT EXISTS" clause,
    so existing columns are checked via PRAGMA first."""
    wanted = {
        "user": [
            ("google_sub", "VARCHAR(64)"),
            ("pl_display_name", "VARCHAR(50)"),
            ("pl_avatar_image", "VARCHAR(255)"),
            ("pl_banner_image", "VARCHAR(255)"),
            ("nex_custom_name", "VARCHAR(40)"),
            ("nex_custom_personality", "TEXT"),
            ("nex_custom_act", "TEXT"),
            ("nex_plugins", "TEXT"),
            ("purpose_of_use", "VARCHAR(20)"),
            ("country", "VARCHAR(100)"),
            ("region", "VARCHAR(100)"),
            ("region_skipped", "BOOLEAN NOT NULL DEFAULT 0"),
            ("guardian_email", "VARCHAR(255)"),
            ("terms_accepted_at", "DATETIME"),
            ("avg_typing_interval_ms", "FLOAT"),
            ("typing_sample_count", "INTEGER NOT NULL DEFAULT 0"),
            ("terms_accepted_version", "INTEGER"),
            ("ai_tokens", "INTEGER"),
            ("ai_tokens_last_award_date", "DATE"),
            ("city", "VARCHAR(100)"),
            ("is_company", "BOOLEAN NOT NULL DEFAULT 0"),
            ("company_name", "VARCHAR(200)"),
            ("company_address", "VARCHAR(300)"),
            ("nex7_persona", "VARCHAR(20)"),
            ("bio", "VARCHAR(300)"),
        ],
        "ai_chat": [
            ("character", "VARCHAR(20) NOT NULL DEFAULT 'nex'"),
            ("next_suggestion", "VARCHAR(200)"),
        ],
        "team_member": [("typing_at", "DATETIME")],
    }
    with db.engine.connect() as conn:
        for table, columns in wanted.items():
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            for entry in columns:
                col_name = entry[0]
                col_def = entry[1] if len(entry) > 1 else entry[0]
                if col_name in existing:
                    continue
                try:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col_name} {col_def}"))
                    conn.commit()
                except Exception:
                    conn.rollback()
                    logger.exception("SQLite migration step failed: %s.%s", table, col_name)


def ensure_columns_exist():
    """Self-healing migration: db.create_all() only creates missing tables,
    it never adds columns to tables that already exist (e.g. on Postgres
    after the model gained new fields). Add any columns the current models
    need but the live database is still missing."""
    if "sqlite" in database_url:
        ensure_sqlite_columns_exist()
        return

    statements = [
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS public_id VARCHAR(36)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS email VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_pixel_at TIMESTAMP',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS profile_image VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS total_score INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS current_streak INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS best_streak INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_streak_date DATE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS points_earned_today INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS points_today_date DATE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS organic_points_earned INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS ever_rank_one BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS coinflip_coins INTEGER NOT NULL DEFAULT 1',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS coinflip_worker_count INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS coinflip_rebirths INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMP',
        'ALTER TABLE "user" ALTER COLUMN total_score TYPE BIGINT',
        'ALTER TABLE "user" ALTER COLUMN points_earned_today TYPE BIGINT',
        'ALTER TABLE "user" ALTER COLUMN organic_points_earned TYPE BIGINT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS birthdate DATE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS gender VARCHAR(20)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_app_share_at TIMESTAMP',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS purpose_of_use VARCHAR(20)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS country VARCHAR(100)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS region VARCHAR(100)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS region_skipped BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS guardian_email VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS avg_typing_interval_ms DOUBLE PRECISION',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS typing_sample_count INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS terms_accepted_version INTEGER',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS ai_tokens INTEGER',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS ai_tokens_last_award_date DATE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS city VARCHAR(100)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_company BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS company_name VARCHAR(200)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS company_address VARCHAR(300)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex7_persona VARCHAR(20)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS bio VARCHAR(300)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pl_display_name VARCHAR(50)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pl_avatar_image VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pl_banner_image VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_custom_name VARCHAR(40)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_custom_personality TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_custom_act TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_plugins TEXT',
        # 7Ai (2026-09-08) -- existing ai_chat rows predate this column and
        # are all Nex chats, so the default backfills them correctly.
        "ALTER TABLE ai_chat ADD COLUMN IF NOT EXISTS character VARCHAR(20) NOT NULL DEFAULT 'nex'",
        "ALTER TABLE ai_chat ADD COLUMN IF NOT EXISTS next_suggestion VARCHAR(200)",
        "ALTER TABLE team_member ADD COLUMN IF NOT EXISTS typing_at TIMESTAMP",
    ]
    with db.engine.connect() as conn:
        for statement in statements:
            try:
                conn.execute(text(statement))
                conn.commit()
            except Exception:
                conn.rollback()
                logger.exception("Migration step failed: %s", statement)

    missing_public_id = User.query.filter(User.public_id.is_(None)).all()
    for user in missing_public_id:
        user.public_id = str(uuid.uuid4())
    if missing_public_id:
        db.session.commit()
        logger.info("Backfilled public_id for %d existing user(s).", len(missing_public_id))


with app.app_context():
    db.create_all()
    ensure_columns_exist()
    ensure_r2_cors_configured()

    admin_username = os.environ.get("ADMIN_USERNAME")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_username and admin_password:
        admin_user = User.query.filter_by(username=admin_username).first()
        if admin_user is None:
            admin_user = User(username=admin_username, is_admin=True)
            admin_user.set_password(admin_password)
            db.session.add(admin_user)
            db.session.commit()
            logger.info("Admin-Account '%s' angelegt.", admin_username)
        elif not admin_user.is_admin:
            admin_user.is_admin = True
            db.session.commit()


# Bumped each time a one-time global logout is explicitly requested -- not a
# recurring mechanism. A session's user_id only counts if it also carries
# the current epoch, so any cookie issued before the bump is treated as
# logged out.
AUTH_EPOCH = 2


def _pl_session_uid():
    uid = session.get("user_id")
    if uid is None or session.get("auth_epoch") != AUTH_EPOCH:
        return None
    return uid


def current_user():
    uid = _pl_session_uid()
    return db.session.get(User, uid) if uid else None


@app.context_processor
def inject_cheaper_globals():
    """A safety net so a template never hard-crashes with an undefined
    `user` if a route forgets to pass one explicitly."""
    return {
        "user": current_user(),
        "is_app_context": request.headers.get("X-Cheaper-App") == "1",
    }


def log_error(message, path=None, method=None, tb=None, user_id=None):
    """Shared by the global error handler -- rolls back first, since
    whatever failed may have left the session mid-transaction, and any
    query (even an unrelated one) would otherwise fail too."""
    try:
        db.session.rollback()
        db.session.add(ErrorLog(
            path=path, method=method, message=str(message)[:2000],
            traceback=(tb or "")[:8000], user_id=user_id,
        ))
        db.session.commit()
    except Exception:
        logger.exception("Fehler konnte nicht ins Fehlerprotokoll geschrieben werden.")


@app.errorhandler(Exception)
def handle_unexpected_error(exc):
    # HTTPException subclasses (404, 403, redirects, etc.) are expected
    # control flow, not bugs -- only genuinely unhandled exceptions (which
    # would otherwise be a bare 500) get logged here.
    if isinstance(exc, HTTPException):
        return exc
    logger.exception("Unbehandelter Fehler bei %s %s", request.method, request.path)
    db.session.rollback()
    # Plain session lookup, not current_user() -- the error handler must
    # never itself create/commit an anon user while the session is in a
    # rolled-back state.
    uid = session.get("user_id")
    user = db.session.get(User, uid) if uid else None
    log_error(
        exc, path=request.path, method=request.method,
        tb=traceback.format_exc(), user_id=user.id if user else None,
    )
    return render_template("500.html"), 500


LAST_SEEN_UPDATE_THROTTLE_SECONDS = 60

# AI tokens: shown as a cosmetic balance only -- user_has_unlimited_ai_tokens
# below already makes the economy unconditionally unlimited, so nothing
# actually deducts from this anymore. Kept so the number stays meaningful
# if gating is ever reinstated, and so existing balances aren't orphaned.
STARTING_AI_TOKENS = 1000
DAILY_AI_TOKENS = 900


def user_has_unlimited_ai_tokens(user):
    return True


def _grant_daily_tokens_if_due(user):
    today = date.today()
    if user.ai_tokens is None:
        user.ai_tokens = STARTING_AI_TOKENS
        user.ai_tokens_last_award_date = today
    elif user.ai_tokens_last_award_date != today:
        user.ai_tokens += DAILY_AI_TOKENS
        user.ai_tokens_last_award_date = today


@app.before_request
def update_last_seen():
    user_id = _pl_session_uid()
    if user_id is None:
        return
    now = datetime.now(timezone.utc)
    user = db.session.get(User, user_id)
    if user is None:
        return
    _grant_daily_tokens_if_due(user)
    last_seen = user.last_seen
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if last_seen is None or (now - last_seen).total_seconds() >= LAST_SEEN_UPDATE_THROTTLE_SECONDS:
        user.last_seen = now
    db.session.commit()


@app.before_request
def _make_session_permanent():
    # Without this, Flask issues a session cookie that expires as soon as
    # the browser is closed -- on mobile in particular that meant users got
    # logged out constantly. Marking the session permanent + a long
    # lifetime gives it a real expiry date instead.
    session.permanent = True


_PUBLIC_ENDPOINTS = {
    "pl_login", "pl_signup", "static", "service_worker", "offline_page",
    "pl_google_auth_start", "pl_google_auth_callback",
    "api_pl_login", "api_pl_register_check_username", "api_pl_register_complete",
}


@app.before_request
def require_login():
    """HEXAGONUM is account-only. Anonymous visitors get the login screen;
    unauthenticated API calls get a 401 JSON so the frontend can react
    instead of getting an HTML redirect."""
    if request.endpoint is None or request.endpoint in _PUBLIC_ENDPOINTS:
        return
    if current_user() is not None:
        return
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    return redirect(url_for("pl_login"))


@app.route("/service-worker.js")
def service_worker():
    # Served from the root path (not /static/) so its default scope covers
    # the whole site -- a service worker's scope can't exceed its own URL
    # path unless the server sends a Service-Worker-Allowed header.
    response = send_from_directory(
        os.path.join(app.root_path, "static", "js"), "service-worker.js",
    )
    response.headers["Content-Type"] = "application/javascript"
    return response


@app.route("/offline")
def offline_page():
    return render_template("offline.html")


# ==========================================================================
# auth (minimal: username + password, no email/terms/age gate)
# ==========================================================================
PL_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_.]{3,30}$")


@app.route("/login", methods=["GET", "POST"])
def pl_login():
    if current_user() is not None:
        return redirect(url_for("pl_home"))
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
        if user is None or not user.check_password(password):
            return render_template("pl_auth.html", mode="login", error="Benutzername oder Passwort falsch.", username=username), 401
        session["user_id"] = user.id
        session["auth_epoch"] = AUTH_EPOCH
        session.permanent = True
        return redirect(url_for("pl_home"))
    g_error = GOOGLE_AUTH_ERRORS.get(request.args.get("g_error"))
    return render_template("pl_auth.html", mode="login", error=g_error)


@app.route("/signup", methods=["GET", "POST"])
def pl_signup():
    if current_user() is not None:
        return redirect(url_for("pl_home"))
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        password2 = request.form.get("password2") or ""
        err = None
        if not PL_USERNAME_RE.match(username):
            err = "3-30 Zeichen, nur Buchstaben, Zahlen, _ und ."
        elif password != password2:
            err = "Passwörter stimmen nicht überein."
        elif len(password) < 6:
            err = "Passwort muss mindestens 6 Zeichen haben."
        elif User.query.filter(db.func.lower(User.username) == username.lower()).first():
            err = "Benutzername ist schon vergeben."
        if err:
            return render_template("pl_auth.html", mode="signup", error=err, username=username), 400
        user = User(username=username, purpose_of_use="private")
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        session["user_id"] = user.id
        session["auth_epoch"] = AUTH_EPOCH
        session.permanent = True
        return redirect(url_for("pl_home"))
    return render_template("pl_auth.html", mode="signup")


@app.route("/logout", methods=["POST", "GET"])
def pl_logout():
    session.pop("user_id", None)
    session.pop("auth_epoch", None)
    return redirect(url_for("pl_login"))


def _pl_log_user_in(user):
    session["user_id"] = user.id
    session["auth_epoch"] = AUTH_EPOCH
    session.permanent = True


@app.route("/api/pl/login", methods=["POST"])
def api_pl_login():
    """JSON login for the onboarding-wizard screen (see pinklemon-auth.js)
    -- the classic form POST at /login above still works unchanged, this
    is just the fetch-driven equivalent the animated card uses so it can
    show its own loading/error state without a full page reload."""
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if user is None or not user.check_password(password):
        return jsonify({"ok": False, "error": "invalid_credentials"}), 401
    _pl_log_user_in(user)
    return jsonify({"ok": True})


@app.route("/api/pl/register/check-username", methods=["POST"])
def api_pl_register_check_username():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    if not PL_USERNAME_RE.match(username):
        return jsonify({"ok": True, "available": False, "error": "format"})
    taken = User.query.filter(db.func.lower(User.username) == username.lower()).first() is not None
    return jsonify({"ok": True, "available": not taken})


@app.route("/api/pl/register/complete", methods=["POST"])
def api_pl_register_complete():
    """The final step of the onboarding wizard: this is the only point a
    User row actually gets created -- everything collected across the
    earlier steps (birthday, gender, email, nickname, avatar) arrives here
    in one multipart request and is applied atomically, so a half-finished
    wizard never leaves a half-set-up account behind. multipart/form-data
    (not JSON) because the avatar is a real file."""
    if current_user() is not None:
        return jsonify({"ok": False, "error": "already_logged_in"}), 400
    form = request.form
    username = (form.get("username") or "").strip()
    password = form.get("password") or ""
    password2 = form.get("password2") or ""
    if not PL_USERNAME_RE.match(username):
        return jsonify({"ok": False, "error": "bad_username"}), 400
    if password != password2:
        return jsonify({"ok": False, "error": "password_mismatch"}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "error": "password_too_short"}), 400
    if User.query.filter(db.func.lower(User.username) == username.lower()).first():
        return jsonify({"ok": False, "error": "username_taken"}), 409

    birthdate = None
    try:
        y, m, d = int(form.get("birth_year")), int(form.get("birth_month")), int(form.get("birth_day"))
        birthdate = date(y, m, d)
        if birthdate > date.today():
            birthdate = None
    except (TypeError, ValueError):
        birthdate = None

    gender = (form.get("gender") or "").strip()[:20] or None
    email = (form.get("email") or "").strip()[:255] or None
    display_name = (form.get("display_name") or "").strip()[:50] or None

    user = User(username=username, purpose_of_use="private", birthdate=birthdate,
                gender=gender, email=email, pl_display_name=display_name)
    user.set_password(password)
    db.session.add(user)
    db.session.flush()

    f = request.files.get("avatar")
    if f is not None and f.filename:
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext in PL_IMAGE_EXT:
            name = f"{uuid.uuid4().hex}.{ext}"
            _pl_store_media(f, name)
            user.pl_avatar_image = name

    db.session.commit()
    _pl_log_user_in(user)
    return jsonify({"ok": True})


GOOGLE_AUTH_ERRORS = {
    "not_configured": "Google-Login ist auf diesem Server noch nicht eingerichtet.",
    "state_mismatch": "Die Google-Anmeldung ist abgelaufen, bitte nochmal versuchen.",
    "denied": "Google-Anmeldung abgebrochen.",
    "failed": "Google-Anmeldung ist fehlgeschlagen, bitte nochmal versuchen.",
}


def _pl_username_from_google(seed):
    """Turn a Google display name/email into a free HEXAGONUM username --
    strip to the allowed charset, pad if too short, then suffix with
    digits until it's actually free."""
    base = re.sub(r"[^a-zA-Z0-9_.]", "", (seed.split("@")[0] if "@" in seed else seed))[:24]
    if len(base) < 3:
        base = (base + "user")[:24]
    candidate = base
    n = 0
    while User.query.filter(db.func.lower(User.username) == candidate.lower()).first() is not None:
        n += 1
        candidate = f"{base}{n}"[:30]
    return candidate


@app.route("/auth/google")
def pl_google_auth_start():
    """Kicks off Google's OAuth authorization-code flow. GOOGLE_CLIENT_ID/
    SECRET come only from Railway env vars (never hardcoded) -- if they're
    unset, this bounces back with a friendly error instead of ever
    reaching Google."""
    if current_user() is not None:
        return redirect(url_for("pl_home"))
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return redirect(url_for("pl_login", g_error="not_configured"))
    state = secrets.token_urlsafe(24)
    session["google_oauth_state"] = state
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": url_for("pl_google_auth_callback", _external=True),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "prompt": "select_account",
    }
    return redirect("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))


@app.route("/auth/google/callback")
def pl_google_auth_callback():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return redirect(url_for("pl_login", g_error="not_configured"))
    if request.args.get("error"):
        return redirect(url_for("pl_login", g_error="denied"))
    state = request.args.get("state")
    expected_state = session.pop("google_oauth_state", None)
    if not state or not expected_state or state != expected_state:
        return redirect(url_for("pl_login", g_error="state_mismatch"))
    code = request.args.get("code")
    if not code:
        return redirect(url_for("pl_login", g_error="failed"))

    try:
        token_res = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "code": code,
                "redirect_uri": url_for("pl_google_auth_callback", _external=True),
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        token_res.raise_for_status()
        access_token = token_res.json()["access_token"]
        # userinfo over the access_token rather than decoding the id_token
        # ourselves -- the access_token only exists because Google already
        # verified our client_secret during the code exchange above, so
        # this call is just as trustworthy without needing a JWT library.
        info_res = requests.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        info_res.raise_for_status()
        info = info_res.json()
    except Exception:
        logger.exception("Google-OAuth-Austausch fehlgeschlagen.")
        return redirect(url_for("pl_login", g_error="failed"))

    sub = info.get("sub")
    email = (info.get("email") or "").strip().lower() or None
    email_verified = bool(info.get("email_verified"))
    name = (info.get("name") or info.get("given_name") or "").strip()
    if not sub:
        return redirect(url_for("pl_login", g_error="failed"))

    user = User.query.filter_by(google_sub=sub).first()
    if user is None and email and email_verified:
        # Same verified email already has a password account -- link
        # Google to it rather than creating a duplicate.
        existing = User.query.filter(db.func.lower(User.email) == email).first()
        if existing is not None:
            existing.google_sub = sub
            user = existing
    if user is None:
        user = User(
            username=_pl_username_from_google(name or email or "user"),
            purpose_of_use="private", google_sub=sub, email=email,
        )
        user.set_password(secrets.token_urlsafe(32))
        if name:
            user.pl_display_name = name[:50]
        db.session.add(user)

    db.session.commit()
    session["user_id"] = user.id
    session["auth_epoch"] = AUTH_EPOCH
    session.permanent = True
    return redirect(url_for("pl_home"))


# ==========================================================================
# Plugins -- third-party accounts a user connects so Nex can read from
# them (a Google Calendar lookup, for now -- see integrations.py). This
# is a SEPARATE OAuth flow from /auth/google above: that one is for
# logged-out login/signup, this one only runs for an already-logged-in
# user and requests an additional scope plus access_type=offline so
# Google actually returns a refresh_token (the login flow never needed
# one, since it doesn't call back into Google's API afterwards).
# ==========================================================================

@app.route("/plugins/google/connect")
def pl_plugins_google_connect():
    if current_user() is None:
        return redirect(url_for("pl_login"))
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return redirect(url_for("pl_home", plugin_error="not_configured"))
    state = secrets.token_urlsafe(24)
    session["google_plugin_oauth_state"] = state
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": url_for("pl_plugins_google_callback", _external=True),
        "response_type": "code",
        "scope": "openid email " + integrations.GOOGLE_CALENDAR_SCOPE,
        "state": state,
        "access_type": "offline",
        "prompt": "consent",
    }
    return redirect("https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params))


@app.route("/plugins/google/callback")
def pl_plugins_google_callback():
    me = current_user()
    if me is None:
        return redirect(url_for("pl_login"))
    if request.args.get("error"):
        return redirect(url_for("pl_home", plugin_error="denied"))
    state = request.args.get("state")
    expected_state = session.pop("google_plugin_oauth_state", None)
    if not state or not expected_state or state != expected_state:
        return redirect(url_for("pl_home", plugin_error="state_mismatch"))
    code = request.args.get("code")
    if not code:
        return redirect(url_for("pl_home", plugin_error="failed"))

    try:
        token_res = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "code": code,
                "redirect_uri": url_for("pl_plugins_google_callback", _external=True),
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        token_res.raise_for_status()
        token_data = token_res.json()
    except Exception:
        logger.exception("Google-Plugin-OAuth-Austausch fehlgeschlagen.")
        return redirect(url_for("pl_home", plugin_error="failed"))

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    if not access_token:
        return redirect(url_for("pl_home", plugin_error="failed"))

    integration = UserIntegration.query.filter_by(user_id=me.id, service="google").first()
    if integration is None:
        integration = UserIntegration(user_id=me.id, service="google", access_token=access_token)
        db.session.add(integration)
    integration.access_token = access_token
    # Google only returns a refresh_token on first consent, or when
    # prompt=consent forces re-consent -- which the connect route above
    # always sets, but keep any previous one if this response somehow
    # lacks it rather than silently losing offline access.
    if refresh_token:
        integration.refresh_token = refresh_token
    integration.token_expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))
    integration.scopes = token_data.get("scope", "")
    db.session.commit()
    return redirect(url_for("pl_home", plugin_connected="google"))


@app.route("/api/plugins")
def api_plugins_list():
    me = current_user()
    connected = {row.service for row in UserIntegration.query.filter_by(user_id=me.id).all()}
    return jsonify({
        "ok": True,
        "plugins": [
            {"service": "google", "label": "Google Kalender", "connected": "google" in connected},
        ],
    })


@app.route("/api/plugins/<service>/disconnect", methods=["POST"])
def api_plugins_disconnect(service):
    me = current_user()
    integration = UserIntegration.query.filter_by(user_id=me.id, service=service).first()
    if integration is not None:
        db.session.delete(integration)
        db.session.commit()
    return jsonify({"ok": True})


def pl_display_name(user):
    """The "Spitzname" -- what shows big everywhere. Falls back to the
    @username when unset."""
    return (getattr(user, "pl_display_name", None) or "").strip() or user.username


@app.template_global()
def _pl_media_url(name):
    if not name:
        return None
    if USE_R2:
        return f"{R2_PUBLIC_URL}/pl/{name}"
    return f"/plm/{name}"


PL_MEDIA_DIR = os.path.join(app.root_path, "static", "uploads", "pl")
os.makedirs(PL_MEDIA_DIR, exist_ok=True)
PL_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}


def _pl_store_media(file_storage, name):
    """Persist a HEXAGONUM avatar upload durably. R2 when configured;
    otherwise a Postgres row (Railway wipes local disk on every deploy,
    the DB survives) plus a best-effort local copy for dev speed."""
    if USE_R2:
        save_media(file_storage, name)
        return
    data = file_storage.read()
    db.session.add(PlMedia(
        name=name,
        content_type=(file_storage.mimetype or "application/octet-stream")[:90],
        data=data,
    ))
    try:
        with open(os.path.join(PL_MEDIA_DIR, name), "wb") as fh:
            fh.write(data)
    except OSError:
        pass


def _pl_delete_media(name):
    if not name:
        return
    if USE_R2:
        delete_media(name)
        return
    row = db.session.get(PlMedia, name)
    if row is not None:
        db.session.delete(row)
    try:
        os.remove(os.path.join(PL_MEDIA_DIR, name))
    except OSError:
        pass


@app.route("/plm/<name>")
def pl_media_file(name):
    """Serve a HEXAGONUM upload from the persistent Postgres store, falling
    back to local disk (dev / pre-migration rows)."""
    name = os.path.basename(name)
    row = db.session.get(PlMedia, name)
    if row is not None:
        return Response(row.data, mimetype=row.content_type,
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
    if os.path.exists(os.path.join(PL_MEDIA_DIR, name)):
        return send_from_directory(PL_MEDIA_DIR, name, max_age=31536000)
    abort(404)


@app.route("/api/pl/profile", methods=["POST"])
def api_pl_update_profile():
    """Edit your own HEXAGONUM profile: display name ("Spitzname") and
    avatar image. multipart form -- any field optional."""
    me = current_user()
    if "display_name" in request.form:
        name = request.form["display_name"].strip()[:50]
        me.pl_display_name = name or None
    f = request.files.get("avatar")
    if f is not None and f.filename:
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in PL_IMAGE_EXT:
            return jsonify({"ok": False, "error": "bad_type"}), 400
        old = me.pl_avatar_image
        name = f"{uuid.uuid4().hex}.{ext}"
        _pl_store_media(f, name)
        me.pl_avatar_image = name
        if old:
            _pl_delete_media(old)
    db.session.commit()
    return jsonify({
        "ok": True,
        "display_name": pl_display_name(me),
        "avatar_url": _pl_media_url(me.pl_avatar_image),
    })


# ==========================================================================
# Nex -- the app's single AI chat (see ai_assistant.py for the Groq call).
# A user can hold several named conversations at once, listed in the
# sidebar; nothing is written to the database until the first message is
# actually sent (see api_ai_stream) or "Neuer Chat" is explicitly used, so
# opening the app fresh never leaves behind an empty untitled row.
# ==========================================================================
def _ai_serialize_chat(chat):
    return {
        "id": chat.id, "title": chat.title or "Neuer Chat", "character": chat.character,
        "next_suggestion": chat.next_suggestion,
    }


# In-memory sliding-window rate limit protecting the Groq key from a
# runaway client (buggy or malicious) -- same non-persistent, per-process
# dict pattern as the old chat feature's _pl_typing/_pl_calls, cleared in
# the pytest client fixture for the same reason. Not a token/quota
# economy (see user_has_unlimited_ai_tokens above, deliberately off).
_ai_rate_hits = {}
AI_RATE_LIMIT_MAX = 20
AI_RATE_LIMIT_WINDOW_SECONDS = 300


def _ai_rate_limited(user_id):
    now = datetime.now(timezone.utc).timestamp()
    hits = [t for t in _ai_rate_hits.get(user_id, []) if now - t < AI_RATE_LIMIT_WINDOW_SECONDS]
    hits.append(now)
    _ai_rate_hits[user_id] = hits
    return len(hits) > AI_RATE_LIMIT_MAX


@app.route("/nex-archiv")
def pl_nex_archived():
    """Nex, Teams and Plugins -- archived, not deleted, at the user's
    request (2026-09-19) in favor of NRS (see pl_home below) as the
    site's main page. All the code, models and routes behind this stay
    exactly as they were; this view is just no longer linked from
    anywhere, so nobody lands here without typing the URL directly."""
    me = current_user()
    chats = AiChat.query.filter_by(user_id=me.id).order_by(AiChat.updated_at.desc()).all()
    wanted_id = request.args.get("chat", type=int)
    chat = next((c for c in chats if c.id == wanted_id), None) if wanted_id else None
    if chat is None:
        chat = chats[0] if chats else None
    messages = [{"role": m.role, "content": m.content} for m in chat.messages] if chat else []
    return render_template(
        "pl_nex.html", messages=messages, chat_id=(chat.id if chat else None),
        chats=[_ai_serialize_chat(c) for c in chats],
    )


@app.route("/")
def pl_home():
    return render_template("pl_nrs.html")


# ==========================================================================
# NRS history -- a per-user log of pages visited in NRS's embedded
# browser (see static/js/pinklemon-nrs.js). Write-on-navigate, read-only
# list, and a clear action; nothing here ever touches the actual page
# content or traffic, just the URLs the user's own browser already
# loaded directly.
# ==========================================================================

@app.route("/api/nrs/history")
def api_nrs_history_list():
    me = current_user()
    entries = (
        NrsHistoryEntry.query.filter_by(user_id=me.id)
        .order_by(NrsHistoryEntry.id.desc()).limit(200).all()
    )
    return jsonify({
        "ok": True,
        "entries": [
            {"id": e.id, "url": e.url, "title": e.title, "visited_at": e.visited_at.isoformat()}
            for e in entries
        ],
    })


@app.route("/api/nrs/history", methods=["POST"])
def api_nrs_history_add():
    me = current_user()
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()[:2000]
    title = (data.get("title") or "").strip()[:255] or None
    if not url.lower().startswith(("http://", "https://")):
        return jsonify({"ok": False, "error": "invalid_url"}), 400
    db.session.add(NrsHistoryEntry(user_id=me.id, url=url, title=title))
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/nrs/history/clear", methods=["POST"])
def api_nrs_history_clear():
    me = current_user()
    NrsHistoryEntry.query.filter_by(user_id=me.id).delete()
    db.session.commit()
    return jsonify({"ok": True})


# ==========================================================================
# NRS sites -- user-made mini "sites" addressable by a made-up "<slug>.nrs"
# address (see models.NrsSite's docstring for why this is safe: .nrs isn't
# a real TLD, nothing here ever touches the real internet, and rendering
# is sandboxed without allow-same-origin). Any logged-in user can create
# one and visit any other user's by slug -- a small closed "build your own
# site" feature, not a real hosting service.
# ==========================================================================

_NRS_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


def _nrs_site_serialize(site, include_code=False):
    data = {
        "slug": site.slug, "name": site.name,
        "is_mine": site.owner_id == current_user().id,
        "updated_at": site.updated_at.isoformat(),
    }
    if include_code:
        data["html_code"] = site.html_code
    return data


@app.route("/api/nrs/sites")
def api_nrs_sites_list_mine():
    me = current_user()
    sites = NrsSite.query.filter_by(owner_id=me.id).order_by(NrsSite.updated_at.desc()).all()
    return jsonify({"ok": True, "sites": [_nrs_site_serialize(s) for s in sites]})


@app.route("/api/nrs/sites", methods=["POST"])
def api_nrs_sites_create():
    me = current_user()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:100]
    slug = (data.get("slug") or "").strip().lower()[:63]
    html_code = (data.get("html_code") or "").strip()[:200000]
    if not name or not html_code:
        return jsonify({"ok": False, "error": "empty"}), 400
    if not _NRS_SLUG_RE.match(slug):
        return jsonify({"ok": False, "error": "invalid_slug"}), 400
    if NrsSite.query.filter_by(slug=slug).first() is not None:
        return jsonify({"ok": False, "error": "slug_taken"}), 409
    site = NrsSite(owner_id=me.id, slug=slug, name=name, html_code=html_code)
    db.session.add(site)
    db.session.commit()
    return jsonify({"ok": True, "site": _nrs_site_serialize(site)})


@app.route("/api/nrs/sites/<slug>")
def api_nrs_sites_get(slug):
    site = NrsSite.query.filter_by(slug=slug.strip().lower()).first()
    if site is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    return jsonify({"ok": True, "site": _nrs_site_serialize(site, include_code=True)})


@app.route("/api/nrs/sites/<slug>", methods=["DELETE"])
def api_nrs_sites_delete(slug):
    me = current_user()
    site = NrsSite.query.filter_by(slug=slug.strip().lower(), owner_id=me.id).first()
    if site is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    db.session.delete(site)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/ai/chats")
def api_ai_chats_list():
    me = current_user()
    chats = AiChat.query.filter_by(user_id=me.id).order_by(AiChat.updated_at.desc()).all()
    return jsonify({"ok": True, "chats": [_ai_serialize_chat(c) for c in chats]})


@app.route("/api/ai/chats", methods=["POST"])
def api_ai_chats_create():
    me = current_user()
    data = request.get_json(silent=True) or {}
    character = data.get("character")
    if character is not None and character not in ai_assistant.PERSONAS:
        return jsonify({"ok": False, "error": "invalid_character"}), 400
    chat = AiChat(user_id=me.id, character=character or "nex")
    db.session.add(chat)
    db.session.commit()
    return jsonify({"ok": True, "chat": _ai_serialize_chat(chat)})


@app.route("/api/ai/chats/<int:chat_id>/messages")
def api_ai_chat_messages(chat_id):
    me = current_user()
    chat = AiChat.query.filter_by(id=chat_id, user_id=me.id).first()
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    return jsonify({
        "ok": True, "chat": _ai_serialize_chat(chat),
        "messages": [{"role": m.role, "content": m.content} for m in chat.messages],
    })


@app.route("/api/ai/chats/<int:chat_id>", methods=["PATCH"])
def api_ai_chat_rename(chat_id):
    me = current_user()
    chat = AiChat.query.filter_by(id=chat_id, user_id=me.id).first()
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()[:100] if "title" in data else None
    character = data.get("character") if "character" in data else None
    if "title" in data and not title:
        return jsonify({"ok": False, "error": "empty"}), 400
    if character is not None and character not in ai_assistant.PERSONAS:
        return jsonify({"ok": False, "error": "invalid_character"}), 400
    if title is None and character is None:
        return jsonify({"ok": False, "error": "empty"}), 400
    if title is not None:
        chat.title = title
    if character is not None:
        chat.character = character
    db.session.commit()
    return jsonify({"ok": True, "chat": _ai_serialize_chat(chat)})


@app.route("/api/ai/chats/<int:chat_id>/delete", methods=["POST"])
def api_ai_chat_delete(chat_id):
    me = current_user()
    chat = AiChat.query.filter_by(id=chat_id, user_id=me.id).first()
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    db.session.delete(chat)
    db.session.commit()
    return jsonify({"ok": True})


# Matches the same 4-backtick fences the client extracts into the preview
# panel / an inline image (see pinklemon-nex.js's splitPreview, NEXPREVIEW_RE
# and NEXIMAGE_RE) -- kept in sync deliberately, not shared code, since one
# lives in Python and the other in JS. No \n required right before the
# closing fence (only after the opening info line) -- the model doesn't
# always end its content with a trailing newline before the closing ````.
_NEXPREVIEW_HISTORY_RE = re.compile(r"````nexpreview[:\s]*([^\n]*)\n[\s\S]*?````")
_NEXIMAGE_HISTORY_RE = re.compile(r"````neximage[:\s]*([^\n]*)\n[\s\S]*?````")


def _collapse_artifacts_for_history(content):
    """A generated artifact is 2000-3000+ tokens of raw HTML sitting in a
    message's content -- fine to keep in full in the database/UI, but
    re-sending it verbatim as conversation history on every later turn in
    the same chat would compound fast (a chat with two or three artifacts
    would re-send 5-10k extra tokens on every unrelated follow-up). Same
    idea for a neximage prompt, though it's small -- the raw fence syntax
    in history is still just noise the model doesn't need to see again.
    Collapse both to short placeholders for what actually goes back to
    Groq; the stored message and what the UI renders are untouched."""
    content = _NEXPREVIEW_HISTORY_RE.sub(
        lambda m: f"[Vorschau-Code: {(m.group(1) or '').strip() or 'Vorschau'}]", content,
    )
    content = _NEXIMAGE_HISTORY_RE.sub(
        lambda m: f"[Bild-Prompt: {(m.group(1) or '').strip() or 'Bild'}]", content,
    )
    return content


_CALENDAR_KEYWORDS = ("kalender", "termin", "meeting", "verabredung", "agenda")


def _maybe_google_calendar_context(user, text_):
    """If the user has Google Calendar connected (see the /plugins/
    google/... routes) AND this message plausibly asks about it, fetch
    a few upcoming events and return them as a ready-to-inject system
    message -- else None, so a plain unrelated message never pays for a
    Google API round-trip. Real, live data, not a hardcoded connected
    checkmark: this is what actually makes Plugins do something."""
    if not any(kw in text_.lower() for kw in _CALENDAR_KEYWORDS):
        return None
    events = integrations.get_upcoming_google_events(user, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
    if not events:
        return None
    lines = "\n".join(f"- {e['summary']} ({e['start']})" for e in events)
    return {"role": "system", "content": f"Nächste Termine im Google-Kalender des Nutzers:\n{lines}"}


@app.route("/api/ai/chats/<int:chat_id>/stream", methods=["POST"])
def api_ai_stream(chat_id):
    """Streams Nex's reply to the browser as plain text chunks, token by
    token, instead of one big JSON blob. The user's message is persisted
    up front (so it survives even if streaming never starts); the
    assistant's full reply is only persisted once in the generator's
    `finally` block below, from a buffer this function accumulates as it
    streams out -- that way a client that disconnects mid-reply still
    ends up with the (partial) reply saved, and a message is never
    double-written by both the client and the server racing each other."""
    me = current_user()
    chat = AiChat.query.filter_by(id=chat_id, user_id=me.id).first()
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if _ai_rate_limited(me.id):
        return jsonify({"ok": False, "error": "rate_limited"}), 429
    data = request.get_json(silent=True) or {}
    text_ = (data.get("message") or "").strip()[:4000]
    if not text_:
        return jsonify({"ok": False, "error": "empty"}), 400

    history = [{"role": m.role, "content": _collapse_artifacts_for_history(m.content)} for m in chat.messages]
    calendar_context = _maybe_google_calendar_context(me, text_)
    if calendar_context:
        history = history + [calendar_context]
    db.session.add(AiChatMessage(chat_id=chat.id, role="user", content=text_))
    chat.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    def generate():
        full = []
        try:
            for token in ai_assistant.generate_reply_stream(text_, history=history, persona=chat.character):
                full.append(token)
                yield token
        except Exception:
            logger.exception("Nex-Streaming fehlgeschlagen")
        finally:
            reply_text = "".join(full)
            if reply_text:
                db.session.add(AiChatMessage(chat_id=chat.id, role="assistant", content=reply_text))
            chat.updated_at = datetime.now(timezone.utc)
            if reply_text:
                # Re-summarize the WHOLE conversation into a fresh title on
                # every turn (not just the first message) so the sidebar
                # row stays representative as the topic evolves -- a
                # small, separate, low-token Groq call. Falls back to the
                # old first-message truncation only if title generation
                # itself fails and the chat has no title yet at all.
                title_history = history + [
                    {"role": "user", "content": _collapse_artifacts_for_history(text_)},
                    {"role": "assistant", "content": _collapse_artifacts_for_history(reply_text)},
                ]
                new_title = ai_assistant.generate_chat_title(title_history)
                if new_title:
                    chat.title = new_title
                elif chat.title is None:
                    chat.title = text_[:40]
                # Same idea for the compose-line suggestion shown on this
                # chat's next visit -- read the whole conversation, guess
                # what the user will probably type next. Keeps the
                # previous suggestion (or none) if generation fails.
                new_suggestion = ai_assistant.generate_next_suggestion(title_history)
                if new_suggestion:
                    chat.next_suggestion = new_suggestion
            db.session.commit()

    return Response(stream_with_context(generate()), mimetype="text/plain")


# ==========================================================================
# Teams -- several people writing together with Nex in the same shared
# chat. Kept in sync across members by short polling (GET .../messages
# ?after=<id>) instead of websockets, see models.py's Team docstring for
# why. Nex only replies when a message @-mentions it, so a team can also
# just be a normal human group chat without Nex interjecting on every line.
# ==========================================================================

def _team_serialize(team):
    member_count = TeamMember.query.filter_by(team_id=team.id).count()
    return {
        "id": team.id, "name": team.name, "invite_code": team.invite_code,
        "member_count": member_count,
    }


def _team_serialize_message(msg, me_id):
    author = None
    if msg.user_id:
        u = db.session.get(User, msg.user_id)
        author = (u.pl_display_name or u.username) if u else "Unbekannt"
    return {
        "id": msg.id, "role": msg.role, "author": author, "is_me": msg.user_id == me_id,
        "content": msg.content, "created_at": msg.created_at.isoformat(),
    }


@app.route("/api/teams")
def api_teams_list():
    me = current_user()
    team_ids = [m.team_id for m in TeamMember.query.filter_by(user_id=me.id).all()]
    teams = Team.query.filter(Team.id.in_(team_ids)).order_by(Team.created_at.desc()).all() if team_ids else []
    return jsonify({"ok": True, "teams": [_team_serialize(t) for t in teams]})


@app.route("/api/teams", methods=["POST"])
def api_teams_create():
    me = current_user()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:60]
    if not name:
        return jsonify({"ok": False, "error": "empty"}), 400
    team = Team(name=name, invite_code=secrets.token_hex(4), created_by=me.id)
    db.session.add(team)
    db.session.flush()
    db.session.add(TeamMember(team_id=team.id, user_id=me.id))
    db.session.commit()
    return jsonify({"ok": True, "team": _team_serialize(team)})


@app.route("/api/teams/join", methods=["POST"])
def api_teams_join():
    me = current_user()
    data = request.get_json(silent=True) or {}
    code = (data.get("invite_code") or "").strip().lower()
    team = Team.query.filter_by(invite_code=code).first() if code else None
    if team is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if TeamMember.query.filter_by(team_id=team.id, user_id=me.id).first() is None:
        db.session.add(TeamMember(team_id=team.id, user_id=me.id))
        db.session.commit()
    return jsonify({"ok": True, "team": _team_serialize(team)})


_TYPING_WINDOW_SECONDS = 5


@app.route("/api/teams/<int:team_id>/messages")
def api_team_messages(team_id):
    me = current_user()
    if TeamMember.query.filter_by(team_id=team_id, user_id=me.id).first() is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    team = db.session.get(Team, team_id)
    after = request.args.get("after", type=int) or 0
    q = TeamMessage.query.filter_by(team_id=team_id)
    if after:
        q = q.filter(TeamMessage.id > after)
    msgs = q.order_by(TeamMessage.id.asc()).all()
    members = TeamMember.query.filter_by(team_id=team_id).all()
    member_names = []
    typing_names = []
    typing_cutoff = datetime.utcnow() - timedelta(seconds=_TYPING_WINDOW_SECONDS)
    for m in members:
        u = db.session.get(User, m.user_id)
        if not u:
            continue
        member_names.append(u.pl_display_name or u.username)
        if m.user_id != me.id and m.typing_at and m.typing_at >= typing_cutoff:
            typing_names.append(u.pl_display_name or u.username)
    return jsonify({
        "ok": True, "team": _team_serialize(team), "members": member_names, "typing": typing_names,
        "messages": [_team_serialize_message(m, me.id) for m in msgs],
    })


@app.route("/api/teams/<int:team_id>/typing", methods=["POST"])
def api_team_typing(team_id):
    me = current_user()
    member = TeamMember.query.filter_by(team_id=team_id, user_id=me.id).first()
    if member is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    member.typing_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/teams/<int:team_id>/messages", methods=["POST"])
def api_team_send(team_id):
    me = current_user()
    member = TeamMember.query.filter_by(team_id=team_id, user_id=me.id).first()
    if member is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if _ai_rate_limited(me.id):
        return jsonify({"ok": False, "error": "rate_limited"}), 429
    data = request.get_json(silent=True) or {}
    text_ = (data.get("message") or "").strip()[:4000]
    if not text_:
        return jsonify({"ok": False, "error": "empty"}), 400

    # The message itself is proof positive typing has stopped -- no need
    # to wait out _TYPING_WINDOW_SECONDS for the "X tippt …" line to clear.
    member.typing_at = None
    author_name = me.pl_display_name or me.username
    user_msg = TeamMessage(team_id=team_id, user_id=me.id, role="user", content=text_)
    db.session.add(user_msg)
    db.session.commit()
    new_messages = [_team_serialize_message(user_msg, me.id)]

    if "@nex" in text_.lower():
        prior_rows = (
            TeamMessage.query.filter(TeamMessage.team_id == team_id, TeamMessage.id < user_msg.id)
            .order_by(TeamMessage.id.desc()).limit(30).all()
        )[::-1]
        history = []
        for row in prior_rows:
            if row.role == "assistant":
                history.append({"role": "assistant", "content": row.content})
            else:
                author = db.session.get(User, row.user_id)
                label = (author.pl_display_name or author.username) if author else "Jemand"
                history.append({"role": "user", "content": f"{label}: {row.content}"})
        try:
            reply_text = ai_assistant.generate_reply(
                f"(Team-Chat, mehrere Personen schreiben mit) {author_name}: {text_}", history=history,
            )
        except Exception:
            logger.exception("Team-Nex-Antwort fehlgeschlagen")
            reply_text = ""
        if reply_text:
            ai_msg = TeamMessage(team_id=team_id, user_id=None, role="assistant", content=reply_text)
            db.session.add(ai_msg)
            db.session.commit()
            new_messages.append(_team_serialize_message(ai_msg, me.id))

    return jsonify({"ok": True, "messages": new_messages})


if __name__ == "__main__":
    app.run(debug=True)
