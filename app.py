import os
import io
import re
import sys
import json
import math
import random
import uuid
import shutil
import urllib.parse
import secrets
import hashlib
import logging
import smtplib
import tempfile
import threading
import traceback
import requests
from email.mime.text import MIMEText
from datetime import datetime, timezone, date, timedelta
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

# Reads a local .env file (if present) into the process environment before
# anything below reads os.environ -- lets secrets like ELEVENLABS_API_KEY be
# set locally without exporting them in the shell every time. Railway itself
# doesn't need this: its dashboard sets real environment variables directly.
load_dotenv()
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, send_from_directory, abort, flash, jsonify, Response
)
from sqlalchemy import text
from werkzeug.utils import secure_filename
from werkzeug.exceptions import HTTPException
# Flask's own transitive dependency (used internally for session-cookie
# signing) -- reused directly here for the site-unlock cookie, see
# UNLOCK_COOKIE_NAME's own comment on why that can't just live in the
# normal `session` cookie.
from itsdangerous import URLSafeSerializer, BadSignature
from models import (
    db, User, Subscription, ErrorLog,
    PlChat, PlChatMember, PlMessage, PlMessageReaction, PlMedia,
    PlServer, PlRole, PlServerMember, PlServerBan, PL_SERVER_PERMISSIONS,
    PlStory, PlStoryView,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
COMMENT_MAX_LENGTH = 500
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
    questions existed must answer them once before using the site again.
    Company accounts never go through this -- register_company collects
    everything they actually need (name, address), and these
    customer-only questions (birthdate, gender, purpose) don't apply to
    a business."""
    if user.is_company:
        return False
    return user.purpose_of_use is None
APP_SHARE_POINTS = 9999999
APP_SHARE_COOLDOWN_HOURS = 24
PROMO_CODES = {
    "FREE FOR ALL": 500,
    "TIMESKIPFREE300FOREVERYONE": 300,
}
PUBLIC_PROMO_CODE = "FREE FOR ALL"
STREAK_DAILY_THRESHOLD = 100
STREAK_POINTS_MULTIPLIER_STEP = 0.1
# Lowered from 1.0 (which let a 10-day streak double every point gain) --
# still +0.1x per streak day, but the ceiling is now +30% at a 3-day streak.
STREAK_POINTS_MULTIPLIER_CAP = 0.3
# The "streak day" rolls over at 11:00 Europe/Berlin instead of midnight.
STREAK_TIMEZONE = ZoneInfo("Europe/Berlin")
STREAK_ROLLOVER_HOUR = 11

CODE_CREATION_MIN_ORGANIC_POINTS = 500
CODE_CREATION_FEE_PERCENT = 3
MIN_POINTS_PER_CODE = 1
MAX_CODES_PER_BATCH = 20


def generate_unique_code():
    while True:
        candidate = uuid.uuid4().hex[:10].upper()
        if candidate in PROMO_CODES:
            continue
        if UserCreatedCode.query.filter_by(code=candidate).first() is not None:
            continue
        return candidate


def streak_today():
    """The "streak day" -- rolls over at STREAK_ROLLOVER_HOUR (11:00)
    Europe/Berlin instead of at midnight."""
    now_local = datetime.now(timezone.utc).astimezone(STREAK_TIMEZONE)
    return (now_local - timedelta(hours=STREAK_ROLLOVER_HOUR)).date()


def _update_streak(user, today):
    if user.last_streak_date == today:
        return
    yesterday = today - timedelta(days=1)
    if user.last_streak_date == yesterday:
        user.current_streak += 1
    else:
        user.current_streak = 1
    user.last_streak_date = today
    if user.current_streak > user.best_streak:
        user.best_streak = user.current_streak


def streak_points_multiplier(user):
    """Users with an active streak earn a bonus on every point gain:
    +10% per streak day, capped at +100% so it can't compound out of
    control (evaluated on the streak as it stands *before* this
    earning event, to avoid circular chicken-and-egg effects)."""
    bonus = min(STREAK_POINTS_MULTIPLIER_STEP * effective_streak(user), STREAK_POINTS_MULTIPLIER_CAP)
    return 1 + bonus


def adjust_points(user, delta, from_code=False):
    """Central helper for every point change. Positive deltas (earned
    points) get boosted by the user's streak multiplier, then also feed
    the daily-earned counter (for streaks), the organic-earned counter
    (for self-serve code creation eligibility, unless from_code=True),
    and the streak logic. Negative deltas (spending, unliking) only
    touch the raw balance, unscaled. Returns the actual delta applied to
    total_score (after the streak multiplier), so callers that need to
    reverse an award later (e.g. unliking) can subtract the exact same
    amount instead of the un-boosted base value."""
    if delta <= 0:
        user.total_score = max(0, user.total_score + delta)
        return delta

    delta = int(delta * streak_points_multiplier(user))
    user.total_score += delta

    today = streak_today()
    if user.points_today_date != today:
        user.points_today_date = today
        user.points_earned_today = 0
    user.points_earned_today += delta

    if not from_code:
        user.organic_points_earned += delta

    if user.points_earned_today >= STREAK_DAILY_THRESHOLD:
        _update_streak(user, today)

    return delta


def effective_streak(user):
    """Streak value for display: lapses back to 0 once a day has passed
    without the user re-qualifying (the DB field itself only resets
    lazily, on the next day the user actually earns enough points)."""
    if user.last_streak_date is None:
        return 0
    if user.last_streak_date >= streak_today() - timedelta(days=1):
        return user.current_streak
    return 0


def is_streak_secured_today(user):
    """True once today's streak requirement has already been met, i.e.
    the streak can no longer be lost today. Used to gate the streak
    *display* -- unlike effective_streak (used for the point multiplier),
    this stays hidden while the streak is merely "at risk" from a prior
    day and only shows once it's locked in for today."""
    return user.last_streak_date == streak_today() and effective_streak(user) > 0


def user_badges(user):
    """List of badge labels a user has permanently earned."""
    badges = [str(n) for n in range(1, user.best_streak + 1)]
    if user.ever_rank_one:
        badges.append("Platz 1")
    return badges


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

# Site-wide "locked" gate (2026-09-08, explicit user request) -- see
# require_site_unlock() near the other before_request hooks below.
# Deliberately NEVER hardcoded here -- this repo (leroxog/video-app) is
# public on GitHub, so the actual code must only ever live in a real
# environment variable (Railway's dashboard in production, this app's
# gitignored .env locally), never in source control. Left unset, the gate
# stays fully inactive -- local dev and the whole test suite never need
# to know a secret code, only a real deployment that deliberately
# configures this env var actually gets gated.
SITE_UNLOCK_CODE = os.environ.get("SITE_UNLOCK_CODE")

# "Mit Google fortfahren" on the login/signup screen -- same reasoning as
# SITE_UNLOCK_CODE above: real credentials only ever come from a Railway
# env var, never hardcoded (this repo is public). Left unset, the button
# still renders but pl_google_auth_start bounces back with a friendly
# error instead of crashing, so local dev/tests need no Google setup at
# all to run the rest of the app.
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")

UPLOAD_FOLDER = os.path.join(app.root_path, "static", "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER

PROFILE_PIC_FOLDER = os.path.join(app.root_path, "static", "profile_pics")
os.makedirs(PROFILE_PIC_FOLDER, exist_ok=True)
app.config["PROFILE_PIC_FOLDER"] = PROFILE_PIC_FOLDER

SOUND_FOLDER = os.path.join(app.root_path, "static", "sounds")
os.makedirs(SOUND_FOLDER, exist_ok=True)
app.config["SOUND_FOLDER"] = SOUND_FOLDER

MEME_FOLDER = os.path.join(app.root_path, "static", "meme")
os.makedirs(MEME_FOLDER, exist_ok=True)
app.config["MEME_FOLDER"] = MEME_FOLDER

APP_ICON_FOLDER = os.path.join(app.root_path, "static", "app_icons")
os.makedirs(APP_ICON_FOLDER, exist_ok=True)
app.config["APP_ICON_FOLDER"] = APP_ICON_FOLDER

HUMAN_SPOTTER_FOLDER = os.path.join(app.root_path, "static", "human_spotter")
os.makedirs(HUMAN_SPOTTER_FOLDER, exist_ok=True)
app.config["HUMAN_SPOTTER_FOLDER"] = HUMAN_SPOTTER_FOLDER

GENERATED_AUDIO_FOLDER = os.path.join(app.root_path, "static", "generated_audio")
os.makedirs(GENERATED_AUDIO_FOLDER, exist_ok=True)
app.config["GENERATED_AUDIO_FOLDER"] = GENERATED_AUDIO_FOLDER

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
        "HINWEIS: Videos/Profilbilder werden lokal im Dateisystem gespeichert. Auf den meisten "
        "kostenlosen Hosting-Plattformen (z.B. Railway) ist dieser Speicher nicht "
        "dauerhaft und Dateien können bei einem Neustart/Deploy verloren gehen."
    )

# Generic SMTP config for the account-recovery email (works with any
# provider's SMTP relay -- Gmail app password, SendGrid, Mailgun, etc. --
# so there's no dependency on one specific transactional-email vendor.
SMTP_HOST = os.environ.get("SMTP_HOST")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD")
SMTP_FROM_ADDRESS = os.environ.get("SMTP_FROM_ADDRESS") or SMTP_USERNAME or "timeskip_support@gmail.com"
USE_SMTP = all([SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD, SMTP_FROM_ADDRESS])
if not USE_SMTP:
    logger.warning(
        "HINWEIS: Kein SMTP konfiguriert (SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD) -- "
        "die Passwort-vergessen-E-Mails können nicht verschickt werden."
    )


def send_email(to_address, subject, body):
    if not USE_SMTP:
        raise RuntimeError(
            "SMTP ist nicht konfiguriert. SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD (und optional "
            "SMTP_FROM_ADDRESS) als Umgebungsvariablen setzen."
        )
    message = MIMEText(body, "plain", "utf-8")
    message["Subject"] = subject
    message["From"] = SMTP_FROM_ADDRESS
    message["To"] = to_address
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(SMTP_USERNAME, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM_ADDRESS, [to_address], message.as_string())


def send_email_best_effort(to_address, subject, body):
    """Like send_email, but a delivery failure (or SMTP simply not being
    configured) never blocks the caller's primary action -- registering,
    closing an account, etc. still succeed either way, it's just logged."""
    try:
        send_email(to_address, subject, body)
    except Exception:
        logger.exception("E-Mail an %s konnte nicht verschickt werden.", to_address)


# Real, single-person voice cloning for AI voice chat, via ElevenLabs'
# hosted API -- there's no way to train or clone a voice from within this
# app itself (no ML pipeline, no GPU; same constraint as ai_assistant.py's
# module docstring about text). Entirely optional: without a key, voice
# chat just uses the browser's own built-in text-to-speech, same as
# before. Sign up at elevenlabs.io yourself and set ELEVENLABS_API_KEY --
# this app never creates that account or enters payment details for you.
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1"
USE_ELEVENLABS = bool(ELEVENLABS_API_KEY)
VOICE_PROFILE_GENDERS = {"male", "female"}
if not USE_ELEVENLABS:
    logger.warning(
        "HINWEIS: Kein ELEVENLABS_API_KEY gesetzt -- Sprachchat nutzt nur die eingebaute "
        "Text-zu-Sprache-Funktion des Browsers, keine echte geklonte Stimme."
    )


LOCAL_MEDIA_FOLDERS = {
    "posts": "UPLOAD_FOLDER",
    "pl": "PL_MEDIA_FOLDER",           # HEXAGONUM avatars/banners + post/comment/chat attachments
    "profile_pics": "PROFILE_PIC_FOLDER",
    "sounds": "SOUND_FOLDER",
    "meme_templates": "MEME_FOLDER",
    "meme_creations": "MEME_FOLDER",
    "app_icons": "APP_ICON_FOLDER",
    "human_spotter": "HUMAN_SPOTTER_FOLDER",
    "generated_audio": "GENERATED_AUDIO_FOLDER",
}


def save_media(file_storage, kind, stored_filename):
    """Save an uploaded file either to R2 (persistent) or local disk (fallback)."""
    if USE_R2:
        key = f"{kind}/{stored_filename}"
        r2_client.upload_fileobj(
            file_storage.stream,
            R2_BUCKET_NAME,
            key,
            ExtraArgs={"ContentType": file_storage.mimetype or "application/octet-stream"},
        )
    else:
        folder = app.config[LOCAL_MEDIA_FOLDERS[kind]]
        file_storage.save(os.path.join(folder, stored_filename))


def save_media_bytes(data, kind, stored_filename, content_type):
    """Same as save_media, but for raw bytes that were never a request
    upload (e.g. the AI's generate_audio tool -- see
    _synthesize_and_store_audio)."""
    if USE_R2:
        r2_client.upload_fileobj(
            io.BytesIO(data),
            R2_BUCKET_NAME,
            f"{kind}/{stored_filename}",
            ExtraArgs={"ContentType": content_type},
        )
    else:
        folder = app.config[LOCAL_MEDIA_FOLDERS[kind]]
        with open(os.path.join(folder, stored_filename), "wb") as f:
            f.write(data)


def delete_media(kind, stored_filename):
    if not stored_filename:
        return
    if USE_R2:
        try:
            r2_client.delete_object(Bucket=R2_BUCKET_NAME, Key=f"{kind}/{stored_filename}")
        except Exception:
            logger.exception("R2-Löschung fehlgeschlagen für %s/%s", kind, stored_filename)
    else:
        folder = app.config[LOCAL_MEDIA_FOLDERS[kind]]
        try:
            os.remove(os.path.join(folder, stored_filename))
        except OSError:
            pass


def get_r2_bucket_usage():
    """Return (total_bytes, {key: size}) for every object in the R2 bucket."""
    total_bytes = 0
    sizes_by_key = {}
    continuation_token = None
    while True:
        kwargs = {"Bucket": R2_BUCKET_NAME}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        resp = r2_client.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            sizes_by_key[obj["Key"]] = obj["Size"]
            total_bytes += obj["Size"]
        if resp.get("IsTruncated"):
            continuation_token = resp.get("NextContinuationToken")
        else:
            break
    return total_bytes, sizes_by_key


app.template_global()(effective_streak)
app.template_global()(user_badges)
app.template_global()(streak_points_multiplier)
app.template_global()(is_streak_secured_today)
app.jinja_env.globals["GENDER_CHOICES"] = GENDER_CHOICES
app.jinja_env.globals["PURPOSE_CHOICES"] = PURPOSE_CHOICES
app.jinja_env.globals["REGION_CHOICES"] = REGION_CHOICES
app.template_global()(compute_age)
app.jinja_env.globals["APP_SHARE_POINTS"] = APP_SHARE_POINTS


@app.template_global()
def media_url(kind, stored_filename):
    if not stored_filename:
        return ""
    if USE_R2:
        return f"{R2_PUBLIC_URL}/{kind}/{stored_filename}"
    # "posts" was the old photo-feed's media kind -- that feature (and its
    # post_photo_file route) is gone, see run_post_wipe()'s docstring below.
    # No caller passes "posts" here anymore; intentionally no branch for it.
    if kind == "sounds":
        return url_for("static", filename=f"sounds/{stored_filename}")
    if kind in ("meme_templates", "meme_creations"):
        return url_for("static", filename=f"meme/{stored_filename}")
    if kind == "app_icons":
        return url_for("static", filename=f"app_icons/{stored_filename}")
    if kind == "human_spotter":
        return url_for("static", filename=f"human_spotter/{stored_filename}")
    if kind == "generated_audio":
        return url_for("static", filename=f"generated_audio/{stored_filename}")
    if kind == "pl":
        return url_for("static", filename=f"uploads/pl/{stored_filename}")
    return url_for("static", filename=f"profile_pics/{stored_filename}")


# Deterministic per-username color for the initial-letter avatar fallback --
# same username always gets the same color (not literally random on every
# render), picked from a curated palette so it's never white/black/too dark
# to read the white initial letter on top of. md5 (not Python's built-in
# hash()) because str hashing is randomized per-process otherwise, which
# would make the color change on every server restart.
AVATAR_COLOR_PALETTE = [
    "#e63946", "#f4a261", "#2a9d8f", "#457b9d", "#e76f51",
    "#8e44ad", "#2980b9", "#16a085", "#c0392b", "#d35400",
    "#27ae60", "#f39c12", "#9b59b6", "#1abc9c", "#3f51b5",
]


@app.template_filter("avatar_color")
def avatar_color_filter(username):
    digest = hashlib.md5((username or "").encode("utf-8")).hexdigest()
    return AVATAR_COLOR_PALETTE[int(digest, 16) % len(AVATAR_COLOR_PALETTE)]


db.init_app(app)


def ensure_r2_cors_configured():
    """Self-healing fix for scripts/check_r2_cors.py's finding: a fresh R2
    bucket has no CORS policy at all, and Safari (unlike Chrome/Firefox) is
    strict enough about it to fail loading range-requested/cross-origin
    media -- this showed up first as broken video playback on iPad and
    again as photos not displaying on iPad Safari. Apply a permissive
    GET/HEAD policy on every boot if one isn't already set, the same way
    ensure_columns_exist() self-heals the schema."""
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
        "studio_project": [
            ("script_code", "TEXT"),
            ("builtin_endpoint", "VARCHAR(50)"),
            ("language", "VARCHAR(20) NOT NULL DEFAULT 'timeskipcode'"),
            ("project_type", "VARCHAR(20) NOT NULL DEFAULT 'game'"),
            ("web_code", "TEXT"),
            ("web_slug", "VARCHAR(50)"),
            ("icon_image", "VARCHAR(255)"),
            ("age_rating", "INTEGER NOT NULL DEFAULT 0"),
            ("previous_web_code", "TEXT"),
        ],
        "studio_block": [("kind", "VARCHAR(20) NOT NULL DEFAULT 'normal'")],
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
        # ai_personality itself is created fresh by db.create_all() on any
        # brand-new database, but on one that already had the table from
        # before mimic_user_style existed on the model, create_all() never
        # goes back to add it -- same class of gap this whole function
        # exists to self-heal for every other table.
        "ai_personality": [("mimic_user_style", "BOOLEAN NOT NULL DEFAULT 0")],
        "ai_generated_media": [("liked", "BOOLEAN NOT NULL DEFAULT 0")],
        # pinklemon attachments: photo / video / playable game under any
        # post, comment, P.S. or chat message.
        "feed_post": [
            ("att_kind", "VARCHAR(12)"), ("att_value", "VARCHAR(255)"),
            ("edited_at", "DATETIME"), ("pinned_at", "DATETIME"),
            ("view_count", "INTEGER NOT NULL DEFAULT 0"),
            ("is_sensitive", "BOOLEAN NOT NULL DEFAULT 0"),
            ("poll_json", "TEXT"),
            ("author_deleted_at", "DATETIME"),
        ],
        "feed_comment": [
            ("att_kind", "VARCHAR(12)"), ("att_value", "VARCHAR(255)"),
            ("hidden_at", "DATETIME"),
        ],
        "feed_ps": [("att_kind", "VARCHAR(12)"), ("att_value", "VARCHAR(255)")],
        "pl_message": [
            ("att_kind", "VARCHAR(12)"), ("att_value", "VARCHAR(255)"),
            ("reply_to_id", "INTEGER"), ("edited_at", "DATETIME"), ("pinned_at", "DATETIME"),
        ],
        "pl_chat": [
            ("server_id", "INTEGER"), ("topic", "VARCHAR(300)"),
            ("position", "INTEGER NOT NULL DEFAULT 0"),
            ("category", "VARCHAR(80)"), ("channel_type", "VARCHAR(10) NOT NULL DEFAULT 'text'"),
        ],
        "pl_server": [("is_public", "BOOLEAN NOT NULL DEFAULT 0")],
        # 7Ai (2026-09-08, see ai_assistant.py's SEVENAI_SYSTEM_PROMPT) --
        # existing ai_chat rows predate this column and are all Nex chats,
        # so the default backfills them correctly with no extra code.
        "ai_chat": [("character", "VARCHAR(20) NOT NULL DEFAULT 'nex'")],
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
        'ALTER TABLE message ADD COLUMN IF NOT EXISTS shared_post_id INTEGER',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS birthdate DATE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS gender VARCHAR(20)',
        'ALTER TABLE post ADD COLUMN IF NOT EXISTS hashtags TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_app_share_at TIMESTAMP',
        'ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS script_code TEXT',
        "ALTER TABLE studio_block ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'normal'",
        'ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS builtin_endpoint VARCHAR(50)',
        "ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS language VARCHAR(20) NOT NULL DEFAULT 'timeskipcode'",
        "ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS project_type VARCHAR(20) NOT NULL DEFAULT 'game'",
        'ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS web_code TEXT',
        'ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS web_slug VARCHAR(50)',
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_studio_project_web_slug ON studio_project (web_slug) WHERE web_slug IS NOT NULL',
        'ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS icon_image VARCHAR(255)',
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
        'ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS age_rating INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE studio_project ADD COLUMN IF NOT EXISTS previous_web_code TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS google_sub VARCHAR(64)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pl_display_name VARCHAR(50)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pl_avatar_image VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS pl_banner_image VARCHAR(255)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_custom_name VARCHAR(40)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_custom_personality TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_custom_act TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS nex_plugins TEXT',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS att_kind VARCHAR(12)',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS att_value VARCHAR(255)',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS is_sensitive BOOLEAN NOT NULL DEFAULT FALSE',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS poll_json TEXT',
        'ALTER TABLE feed_post ADD COLUMN IF NOT EXISTS author_deleted_at TIMESTAMP',
        'ALTER TABLE feed_comment ADD COLUMN IF NOT EXISTS att_kind VARCHAR(12)',
        'ALTER TABLE feed_comment ADD COLUMN IF NOT EXISTS att_value VARCHAR(255)',
        'ALTER TABLE feed_comment ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMP',
        'ALTER TABLE feed_ps ADD COLUMN IF NOT EXISTS att_kind VARCHAR(12)',
        'ALTER TABLE feed_ps ADD COLUMN IF NOT EXISTS att_value VARCHAR(255)',
        'ALTER TABLE pl_message ADD COLUMN IF NOT EXISTS att_kind VARCHAR(12)',
        'ALTER TABLE pl_message ADD COLUMN IF NOT EXISTS att_value VARCHAR(255)',
        'ALTER TABLE pl_message ADD COLUMN IF NOT EXISTS reply_to_id INTEGER',
        'ALTER TABLE pl_message ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP',
        'ALTER TABLE pl_message ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMP',
        'ALTER TABLE pl_chat ADD COLUMN IF NOT EXISTS server_id INTEGER',
        'ALTER TABLE pl_chat ADD COLUMN IF NOT EXISTS topic VARCHAR(300)',
        'ALTER TABLE pl_chat ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE pl_chat ADD COLUMN IF NOT EXISTS category VARCHAR(80)',
        "ALTER TABLE pl_chat ADD COLUMN IF NOT EXISTS channel_type VARCHAR(10) NOT NULL DEFAULT 'text'",
        'ALTER TABLE pl_server ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE',
        # Root cause confirmed live (psycopg2.errors.UndefinedColumn):
        # ai_personality was created by db.create_all() back when the
        # AiPersonality model first shipped (no mimic_user_style yet) --
        # create_all() only creates tables that don't exist yet, it never
        # goes back to add a column to a table that's already there, so
        # mimic_user_style silently never arrived on the live table when
        # the model gained that field later. Same self-heal as every ALTER
        # TABLE above, just for a table instead of "user".
        """CREATE TABLE IF NOT EXISTS ai_personality (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL UNIQUE REFERENCES "user" (id),
            intelligence INTEGER NOT NULL DEFAULT 89,
            humor INTEGER NOT NULL DEFAULT 68,
            caution INTEGER NOT NULL DEFAULT 89,
            arrogance INTEGER NOT NULL DEFAULT 12,
            mimic_user_style BOOLEAN NOT NULL DEFAULT FALSE,
            updated_at TIMESTAMP
        )""",
        "ALTER TABLE ai_personality ADD COLUMN IF NOT EXISTS mimic_user_style BOOLEAN NOT NULL DEFAULT FALSE",
        # Same self-heal as ai_personality above, for the newer
        # AiGeneratedMedia table: covers a deploy that already ran
        # db.create_all() before the "liked" column existed on the model.
        """CREATE TABLE IF NOT EXISTS ai_generated_media (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES "user" (id),
            kind VARCHAR(10) NOT NULL,
            url VARCHAR(500) NOT NULL,
            prompt TEXT,
            liked BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMP
        )""",
        "ALTER TABLE ai_generated_media ADD COLUMN IF NOT EXISTS liked BOOLEAN NOT NULL DEFAULT FALSE",
        # 7Ai (2026-09-08, see ai_assistant.py's SEVENAI_SYSTEM_PROMPT) --
        # existing ai_chat rows predate this column and are all Nex chats,
        # so the default backfills them correctly with no extra code.
        "ALTER TABLE ai_chat ADD COLUMN IF NOT EXISTS character VARCHAR(20) NOT NULL DEFAULT 'nex'",
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

    # Live chat generation moved back to Groq's hosted API (see
    # ai_assistant.py's _generate_groq) -- local_ai.py's self-hosted model
    # is no longer on the hot path, only still used lazily by the admin
    # fine-tuning feature if a training run is actually started, so there's
    # no reason to eagerly download/load its ~1 GB model at every startup
    # anymore (that used to happen here; removed to save the memory/CPU on
    # Railway's free tier).

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

# pinklemon fake community. Bots are OFF by default (set PL_BOTS=1 to
# enable); bootstrap() purges any leftover bot accounts when disabled.
# Skipped entirely under pytest.
if "pytest" not in sys.modules:
    try:
        import pl_bots
        pl_bots.bootstrap(app)
    except Exception:
        logger.exception("pl_bots konnte nicht gestartet werden.")


def allowed_image_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


# Bumped each time a one-time global logout is explicitly requested
# (2026-09-11, then again 2026-09-12 for the new onboarding-wizard login
# screen) -- not a recurring mechanism. A session's user_id only counts
# if it also carries the current epoch, so any cookie issued before the
# bump is treated as logged out. Bump again only if another blanket
# logout is ever needed.
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
    """A safety net for cheaper_base.html's templates (the shared chrome
    for login/register/account-settings/terms/etc, despite the name --
    those pages aren't Chepal-specific even though the base template
    predates that distinction), most of which also get `user` passed
    explicitly per-route like the rest of the app -- this just means a
    template never hard-crashes with an undefined `user` if a route
    forgets to. is_app_context flags a request coming from an Electron
    desktop wrapper, which sends this header so the page can skip the
    "download the app" banner."""
    return {
        "user": current_user(),
        "is_app_context": request.headers.get("X-Cheaper-App") == "1",
    }


def require_admin():
    user = current_user()
    if user is None or not user.is_admin:
        abort(403)
    return user


def log_error(message, path=None, method=None, tb=None, user_id=None):
    """Shared by the global error handler below and the AI chat job's
    failure path (a Groq outage/rate limit/bad key doesn't raise an
    exception in a request handler -- it fails inside a background
    thread), so both land in the same admin-visible log. Rolls back first
    -- whatever failed may have left the session mid-transaction, and any
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
    # HTTPException subclasses (404, 403, the redirect-based onboarding
    # gate, etc.) are expected control flow, not bugs -- only genuinely
    # unhandled exceptions (which would otherwise be a bare 500) get
    # logged here.
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


ONLINE_THRESHOLD_SECONDS = 5 * 60
LAST_SEEN_UPDATE_THROTTLE_SECONDS = 60


def _pl_is_online(user):
    if user is None or user.last_seen is None:
        return False
    last_seen = user.last_seen
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last_seen).total_seconds() < ONLINE_THRESHOLD_SECONDS


def _pl_presence_text(user):
    if _pl_is_online(user):
        return "Online"
    if user is None or user.last_seen is None:
        return "Zuletzt online unbekannt"
    return "Zuletzt online " + pl_ago(user.last_seen)

# AI tokens: a currency separate from total_score ("Punkte"), spent only on
# AI actions (see TOKEN_COST_* below). STARTING_AI_TOKENS is the one-time
# grant the very first time this system sees an account (a brand-new
# registration, or an existing account visiting for the first time after
# this shipped) -- every day after that, DAILY_AI_TOKENS is added on top of
# whatever's left (unused tokens carry over, never reset to a cap).
STARTING_AI_TOKENS = 1000
DAILY_AI_TOKENS = 900

# Accounts that never pay a token cost and never get an insufficient-tokens
# block -- their ai_tokens balance still exists and still gets the daily
# grant (see _grant_daily_tokens_if_due), it's just never checked or
# deducted from in api_ai_chat, and never disclosed to the model (so it
# doesn't nudge the AI's own image-generation behavior either).
UNLIMITED_AI_TOKENS_USERNAMES = {"LEROX"}


def user_has_unlimited_ai_tokens(user):
    # There is no login and no way to buy or earn tokens anymore, so the
    # token economy is effectively off -- everyone chats freely.
    return True


def _grant_daily_tokens_if_due(user):
    today = date.today()
    if user.ai_tokens is None:
        user.ai_tokens = STARTING_AI_TOKENS
        user.ai_tokens_last_award_date = today
    elif user.ai_tokens_last_award_date != today:
        user.ai_tokens += DAILY_AI_TOKENS
        user.ai_tokens_last_award_date = today


# Per-message token costs. Voice costs more than text (speech synthesis is
# the pricier path); both scale up for long messages; a Buddy-mode
# (mimic_user_style) reply costs a bit more on top since it asks more of the
# model. Image generation is priced separately, see ai_assistant.IMAGE_TOKEN_COST
# -- that one's charged after the fact in on_done, only if an image was
# actually generated, since it's the AI's own tool-call decision, not
# something the user directly requests up front.
TOKEN_COST_MESSAGE_BASE = 9
TOKEN_COST_VOICE_BASE = 13
TOKEN_COST_LARGE_MESSAGE_CHARS = 400
TOKEN_COST_LARGE_MESSAGE_EXTRA = 6
TOKEN_COST_BUDDY_SURCHARGE = 6


def _compute_message_token_cost(message, via_voice, is_buddy):
    cost = TOKEN_COST_VOICE_BASE if via_voice else TOKEN_COST_MESSAGE_BASE
    cost += TOKEN_COST_LARGE_MESSAGE_EXTRA * (len(message) // TOKEN_COST_LARGE_MESSAGE_CHARS)
    if is_buddy:
        cost += TOKEN_COST_BUDDY_SURCHARGE
    return cost


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
    """pinklemon is account-only (needed for @usernames, follows, DMs).
    Anonymous visitors get the login screen; unauthenticated API calls get
    a 401 JSON so the frontend can react instead of getting an HTML
    redirect."""
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
# pinklemon -- auth (minimal: username + password, no email/terms/age gate)
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
    """JSON login for the new onboarding-wizard screen (see pinklemon-
    auth.js) -- the classic form POST at /login above still works
    unchanged, this is just the fetch-driven equivalent the animated
    card uses so it can show its own loading/error state without a full
    page reload."""
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
    earlier steps (birthday, gender, email, nickname, avatar, banner)
    arrives here in one multipart request and is applied atomically, so
    a half-finished wizard never leaves a half-set-up account behind.
    multipart/form-data (not JSON) because avatar/banner are real files."""
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

    for field, col in (("avatar", "pl_avatar_image"), ("banner", "pl_banner_image")):
        f = request.files.get(field)
        if f is None or not f.filename:
            continue
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in PL_IMAGE_EXT:
            continue
        name = f"{uuid.uuid4().hex}.{ext}"
        _pl_store_media(f, name)
        setattr(user, col, name)

    db.session.commit()
    _pl_log_user_in(user)
    return jsonify({"ok": True})


@app.route("/api/pl/servers/suggested")
def api_pl_servers_suggested():
    me = current_user()
    already_in = {r.server_id for r in PlServerMember.query.filter_by(user_id=me.id)}
    rows = PlServer.query.filter_by(is_public=True).all()
    candidates = [s for s in rows if s.id not in already_in]
    random.shuffle(candidates)
    picked = candidates[:6]
    return jsonify({"ok": True, "servers": [
        {"id": s.id, "name": s.name, "icon_url": _pl_media_url(s.icon_image),
         "invite_code": s.invite_code, "member_count": len(s.members)}
        for s in picked
    ]})


@app.route("/api/pl/servers/<int:server_id>/visibility", methods=["POST"])
def api_pl_server_set_visibility(server_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "manage_server")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    server.is_public = bool((request.get_json(silent=True) or {}).get("is_public"))
    db.session.commit()
    return jsonify({"ok": True, "is_public": server.is_public})


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
    SECRET come only from Railway env vars (never hardcoded, see their
    definitions above) -- if they're unset, this bounces back with a
    friendly error instead of ever reaching Google."""
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
# pinklemon -- feed helpers
# ==========================================================================
def pl_ago(dt):
    """Compact German relative time: 'gerade eben', '5 Min', '3 Std', '2 d',
    '3 Wo', then a plain date."""
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    secs = (datetime.now(timezone.utc) - dt).total_seconds()
    if secs < 60:
        return "gerade eben"
    if secs < 3600:
        return f"{int(secs // 60)} Min"
    if secs < 86400:
        return f"{int(secs // 3600)} Std"
    if secs < 86400 * 7:
        return f"{int(secs // 86400)} d"
    if secs < 86400 * 60:
        return f"{int(secs // (86400 * 7))} Wo"
    return dt.strftime("%d.%m.%y")


def pl_avatar_letter(username):
    return (username or "?").lstrip("@")[:1].upper() or "?"


# Default (no uploaded picture) avatars: a letter on a colour, one per
# account. Picked once per identity via a stable hash of the same seed
# used for the letter (username, or a group chat's title) -- every
# existing account gets a colour the moment this ships (no backfill
# needed), it never changes on its own, and it's identical across every
# worker process (unlike Python's salted hash()).
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


def pl_display_name(user):
    """The "Spitzname" -- what shows big everywhere. Falls back to the
    @username when unset."""
    return (getattr(user, "pl_display_name", None) or "").strip() or user.username


@app.template_global()
def _pl_media_url(name):
    if not name:
        return None
    return media_url("pl", name) if USE_R2 else f"/plm/{name}"


def _pl_store_media(file_storage, name):
    """Persist a HEXAGONUM image/video upload durably. R2 when configured;
    otherwise a Postgres row (Railway wipes local disk on every deploy,
    the DB survives) plus a best-effort local copy for dev speed."""
    if USE_R2:
        save_media(file_storage, "pl", name)
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
        delete_media("pl", name)
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


def _pl_user_brief(user):
    return {
        "username": user.username,
        "name": pl_display_name(user),
        "avatar_letter": pl_avatar_letter(user.username),
        "avatar_url": _pl_media_url(getattr(user, "pl_avatar_image", None)),
        "avatar_color": pl_avatar_color(user.username),
    }


_PL_TAG_RE = re.compile(r"#([A-Za-z0-9_äöüÄÖÜß]{1,40})")
_PL_MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_.]{3,30})")
_PL_URL_RE = re.compile(r"(https?://[^\s<]+)")


def _pl_pretty_url(url):
    """Shorten a URL for display: drop the scheme and any trailing slash,
    cap the length. The full URL stays in href / data-pl-preview."""
    shown = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
    return shown if len(shown) <= 42 else shown[:39] + "…"


def _pl_linkify(text):
    """Escape user text, then turn #hashtags, @mentions and URLs into links.
    Returns HTML (mark |safe when rendering)."""
    import markupsafe
    out = str(markupsafe.escape(text or ""))
    out = _PL_URL_RE.sub(
        lambda m: (
            f'<a href="{m.group(1)}" target="_blank" rel="noopener nofollow" '
            f'class="pl-link" data-pl-preview="{m.group(1)}">{_pl_pretty_url(m.group(1))}</a>'
        ),
        out,
    )
    out = _PL_TAG_RE.sub(
        lambda m: f'<a href="/?q=%23{m.group(1)}" class="pl-hashtag">#{m.group(1)}</a>', out,
    )
    out = _PL_MENTION_RE.sub(
        lambda m: f'<a href="/freunde/u/{m.group(1)}" class="pl-mention">@{m.group(1)}</a>', out,
    )
    return out.replace("\n", "<br>")


# ==========================================================================
# pinklemon -- pages
# ==========================================================================
def _pl_socialise(me):
    """Best-effort: give this real user a populated feed/Freunde tab from
    the bot community. No-op under pytest / when bots are disabled."""
    if "pytest" in sys.modules or os.environ.get("PL_BOTS") != "1":
        return
    try:
        import pl_bots
        pl_bots.ensure_social(me)
    except Exception:
        logger.exception("pl_bots.ensure_social")


@app.route("/")
def pl_home():
    me = current_user()
    _pl_socialise(me)
    chats = _pl_chat_list(me)
    # Every mutual follow shows up in Nachrichten, chat or no chat yet.
    i_follow = {s.channel_id for s in Subscription.query.filter_by(subscriber_id=me.id)}
    follow_me = {s.subscriber_id for s in Subscription.query.filter_by(channel_id=me.id)}
    mutuals = User.query.filter(User.id.in_(i_follow & follow_me)).all() if (i_follow & follow_me) else []
    existing_dm_uids = set()
    for c in PlChatMember.query.filter_by(user_id=me.id):
        ch = db.session.get(PlChat, c.chat_id)
        if ch and not ch.is_group and len(ch.members) == 2:
            existing_dm_uids.update(m.user_id for m in ch.members if m.user_id != me.id)
    pending = [
        {
            "username": u.username,
            "title": pl_display_name(u),
            "avatar_letter": pl_avatar_letter(pl_display_name(u)),
            "avatar_url": _pl_media_url(u.pl_avatar_image),
        }
        for u in sorted(mutuals, key=lambda x: pl_display_name(x).lower())
        if u.id not in existing_dm_uids
    ]
    servers = [db.session.get(PlServer, r.server_id) for r in PlServerMember.query.filter_by(user_id=me.id)]
    servers = [s for s in servers if s is not None]
    return render_template(
        "pl_home.html", chats=chats, pending=pending, servers=servers,
        me_json={"id": me.id, "username": me.username},
    )


@app.route("/freunde")
def pl_freunde_redirect():
    return redirect(url_for("pl_home"))


@app.route("/freunde/u/<username>")
def pl_profile(username):
    me = current_user()
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if user is None:
        abort(404)
    i_follow = Subscription.query.filter_by(subscriber_id=me.id, channel_id=user.id).first() is not None
    follows_me = Subscription.query.filter_by(subscriber_id=user.id, channel_id=me.id).first() is not None

    joined = None
    if user.created_at:
        joined = user.created_at.strftime("%B %Y")
    return render_template(
        "pl_profile.html", prof=user, is_me=user.id == me.id,
        i_follow=i_follow, follows_me=follows_me, mutual=i_follow and follows_me,
        followers=Subscription.query.filter_by(channel_id=user.id).count(),
        following=Subscription.query.filter_by(subscriber_id=user.id).count(),
        avatar_letter=pl_avatar_letter(user.username), joined=joined,
        display_name=pl_display_name(user),
        avatar_url=_pl_media_url(user.pl_avatar_image),
        banner_url=_pl_media_url(user.pl_banner_image),
        me_json={"id": me.id, "username": me.username},
    )


@app.route("/api/pl/profile/origin", methods=["POST"])
def api_pl_update_origin():
    """Where-you're-from badge next to the HEXAGONUM wordmark (see
    _pl_topbrand.html) -- reuses the existing (until now unused) `country`
    column rather than free text tied to a specific UI, so it's just
    whatever short label the user wants shown, "TRY" if never set."""
    me = current_user()
    data = request.get_json(silent=True) or {}
    origin = (data.get("origin") or "").strip()[:12]
    me.country = origin or None
    db.session.commit()
    return jsonify({"ok": True, "origin": me.country})


@app.route("/api/pl/profile", methods=["POST"])
def api_pl_update_profile():
    """Edit your own HEXAGONUM profile: display name ("Spitzname"),
    avatar image, banner image. multipart form -- any field optional."""
    me = current_user()
    if "display_name" in request.form:
        name = request.form["display_name"].strip()[:50]
        me.pl_display_name = name or None
    for field, col, ratio in (("avatar", "pl_avatar_image", None), ("banner", "pl_banner_image", None)):
        f = request.files.get(field)
        if f is None or not f.filename:
            continue
        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
        if ext not in PL_IMAGE_EXT:
            return jsonify({"ok": False, "error": "bad_type"}), 400
        old = getattr(me, col, None)
        name = f"{uuid.uuid4().hex}.{ext}"
        _pl_store_media(f, name)
        setattr(me, col, name)
        if old:
            _pl_delete_media(old)
    db.session.commit()
    return jsonify({
        "ok": True,
        "display_name": pl_display_name(me),
        "avatar_url": _pl_media_url(me.pl_avatar_image),
        "banner_url": _pl_media_url(me.pl_banner_image),
    })


@app.route("/freunde/c/<int:chat_id>")
def pl_chat_view(chat_id):
    me = current_user()
    chat = db.session.get(PlChat, chat_id)
    if chat is None or not any(m.user_id == me.id for m in chat.members):
        abort(404)
    return render_template(
        "pl_chat.html", chat=_pl_chat_summary(chat, me), chat_id=chat_id,
        me_json={"id": me.id, "username": me.username},
    )


# ---- attachments: photo / video under any text ----
PL_MEDIA_DIR = os.path.join(app.root_path, "static", "uploads", "pl")
os.makedirs(PL_MEDIA_DIR, exist_ok=True)
app.config["PL_MEDIA_FOLDER"] = PL_MEDIA_DIR   # used by save_media/media_url("pl", ...)
PL_IMAGE_EXT = {"png", "jpg", "jpeg", "gif", "webp"}
PL_VIDEO_EXT = {"mp4", "webm", "mov", "m4v"}


def _pl_attachment(row):
    """row is any model with att_kind / att_value -> a small dict for the
    frontend, or None."""
    kind = getattr(row, "att_kind", None)
    value = getattr(row, "att_value", None)
    if not kind or not value:
        return None
    if kind in ("image", "video"):
        return {"kind": kind, "value": value, "url": _pl_media_url(value)}
    return None


def _pl_read_att(data):
    """Validate an {att_kind, att_value} pair from a request body.
    Returns (kind, value) or (None, None). The value must be a bare
    filename our own /api/pl/upload just handed back -- checked by shape
    (basename + known extension), not by disk existence, since with R2 the
    file lives in the bucket, not on local disk."""
    kind = (data.get("att_kind") or "").strip()
    value = (data.get("att_value") or "").strip()
    if kind in ("image", "video"):
        safe = os.path.basename(value)
        ext = safe.rsplit(".", 1)[-1].lower() if "." in safe else ""
        if safe == value and safe and ext in (PL_IMAGE_EXT | PL_VIDEO_EXT):
            return kind, safe
    return None, None


@app.route("/api/pl/upload", methods=["POST"])
def api_pl_upload():
    current_user()
    f = request.files.get("file")
    if f is None or not f.filename:
        return jsonify({"ok": False, "error": "no_file"}), 400
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext in PL_IMAGE_EXT:
        kind = "image"
    elif ext in PL_VIDEO_EXT:
        kind = "video"
    else:
        return jsonify({"ok": False, "error": "bad_type"}), 400
    name = f"{uuid.uuid4().hex}.{ext}"
    _pl_store_media(f, name)
    db.session.commit()
    return jsonify({"ok": True, "kind": kind, "value": name, "url": _pl_media_url(name)})




# ==========================================================================
# pinklemon "Freunde" -- follows + WhatsApp-style chats
# ==========================================================================
def _are_mutual(a_id, b_id):
    return (
        Subscription.query.filter_by(subscriber_id=a_id, channel_id=b_id).first() is not None
        and Subscription.query.filter_by(subscriber_id=b_id, channel_id=a_id).first() is not None
    )


def _pl_chat_title(chat, me):
    if chat.is_group:
        return chat.name or "Gruppe"
    other = next((m.user for m in chat.members if m.user_id != me.id), None)
    return pl_display_name(other) if other else "Chat"


def _pl_chat_summary(chat, me):
    last = chat.messages[-1] if chat.messages else None
    my_member = next((m for m in chat.members if m.user_id == me.id), None)
    unread = 0
    if my_member:
        unread = sum(1 for m in chat.messages if m.id > my_member.last_read_id and m.sender_id != me.id)
    title = _pl_chat_title(chat, me)
    other = None if chat.is_group else next((m.user for m in chat.members if m.user_id != me.id), None)
    return {
        "id": chat.id,
        "is_group": chat.is_group,
        "title": title,
        "avatar_letter": pl_avatar_letter(title),
        "avatar_url": _pl_media_url(getattr(other, "pl_avatar_image", None)) if other else None,
        "other_username": (other.username if other else None),
        "other_online": (_pl_is_online(other) if other else False),
        "other_presence_text": (_pl_presence_text(other) if other else None),
        "members": [pl_display_name(m.user) for m in chat.members],
        "last_text": (last.text[:80] if last else ""),
        "last_sender": (pl_display_name(last.sender) if last else ""),
        "last_ago": (pl_ago(last.created_at) if last else ""),
        "unread": unread,
    }


def _pl_chat_list(me):
    memberships = PlChatMember.query.filter_by(user_id=me.id).all()
    chats = [db.session.get(PlChat, m.chat_id) for m in memberships]
    # server channels reuse PlChat/PlChatMember (see PlChat.server_id's own
    # comment) but belong in that server's channel list, not the plain
    # Nachrichten/Freunde DM+group list.
    chats = [c for c in chats if c is not None and c.server_id is None]
    chats.sort(key=lambda c: c.last_activity or c.created_at, reverse=True)
    return [_pl_chat_summary(c, me) for c in chats]


@app.route("/api/pl/users/search")
def api_pl_user_search():
    me = current_user()
    q = (request.args.get("q") or "").strip()
    if len(q) < 1:
        return jsonify({"ok": True, "users": []})
    rows = (
        User.query.filter(User.username.ilike(f"%{q}%"), User.id != me.id)
        .order_by(User.username).limit(20).all()
    )
    return jsonify({"ok": True, "users": [
        {
            "username": u.username,
            "avatar_letter": pl_avatar_letter(u.username),
            "avatar_color": pl_avatar_color(u.username),
            "i_follow": Subscription.query.filter_by(subscriber_id=me.id, channel_id=u.id).first() is not None,
            "mutual": _are_mutual(me.id, u.id),
        }
        for u in rows
    ]})


@app.route("/api/pl/follow/<username>", methods=["POST"])
def api_pl_follow(username):
    me = current_user()
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if user is None or user.id == me.id:
        return jsonify({"ok": False, "error": "bad_user"}), 400
    existing = Subscription.query.filter_by(subscriber_id=me.id, channel_id=user.id).first()
    if existing:
        db.session.delete(existing)
        following = False
    else:
        db.session.add(Subscription(subscriber_id=me.id, channel_id=user.id))
        following = True
    db.session.commit()
    return jsonify({
        "ok": True, "following": following, "mutual": _are_mutual(me.id, user.id),
        "followers": Subscription.query.filter_by(channel_id=user.id).count(),
    })


@app.route("/api/pl/mutuals")
def api_pl_mutuals():
    """Everyone the current user follows who follows back -- the pool you
    can DM or add to a group."""
    me = current_user()
    i_follow_ids = {s.channel_id for s in Subscription.query.filter_by(subscriber_id=me.id)}
    follow_me_ids = {s.subscriber_id for s in Subscription.query.filter_by(channel_id=me.id)}
    mutual_ids = i_follow_ids & follow_me_ids
    users = User.query.filter(User.id.in_(mutual_ids)).order_by(User.username).all() if mutual_ids else []
    return jsonify({"ok": True, "users": [
        {"username": u.username, "avatar_letter": pl_avatar_letter(u.username), "avatar_color": pl_avatar_color(u.username)} for u in users
    ]})


PL_STORY_TTL_HOURS = 24


def _pl_mutual_ids(me):
    i_follow_ids = {s.channel_id for s in Subscription.query.filter_by(subscriber_id=me.id)}
    follow_me_ids = {s.subscriber_id for s in Subscription.query.filter_by(channel_id=me.id)}
    return i_follow_ids & follow_me_ids


def _pl_serialize_story(s, me):
    return {
        "id": s.id,
        "media_kind": s.media_kind,
        "url": _pl_media_url(s.media_name),
        "caption": s.caption,
        "created_ago": pl_ago(s.created_at),
        "is_mine": s.user_id == me.id,
        "viewed_by_me": any(v.viewer_id == me.id for v in s.views),
    }


@app.route("/api/pl/stories", methods=["GET"])
def api_pl_stories_list():
    me = current_user()
    now = datetime.now(timezone.utc)
    mutual_ids = _pl_mutual_ids(me)
    rows = (
        PlStory.query.filter(
            PlStory.user_id.in_(mutual_ids | {me.id}),
            PlStory.expires_at > now,
        ).order_by(PlStory.created_at.asc()).all()
    )
    by_user = {}
    for s in rows:
        by_user.setdefault(s.user_id, []).append(s)

    mine = None
    if me.id in by_user:
        mine = {
            "username": me.username, "name": pl_display_name(me),
            "avatar_letter": pl_avatar_letter(me.username), "avatar_color": pl_avatar_color(me.username),
            "avatar_url": _pl_media_url(me.pl_avatar_image),
            "stories": [_pl_serialize_story(s, me) for s in by_user[me.id]],
        }

    friends = []
    for uid, stories in by_user.items():
        if uid == me.id:
            continue
        u = db.session.get(User, uid)
        if u is None:
            continue
        all_seen = all(any(v.viewer_id == me.id for v in s.views) for s in stories)
        friends.append({
            "username": u.username, "name": pl_display_name(u),
            "avatar_letter": pl_avatar_letter(u.username), "avatar_color": pl_avatar_color(u.username),
            "avatar_url": _pl_media_url(u.pl_avatar_image),
            "all_seen": all_seen,
            "stories": [_pl_serialize_story(s, me) for s in stories],
        })
    friends.sort(key=lambda f: (f["all_seen"], f["name"].lower()))

    return jsonify({"ok": True, "mine": mine, "friends": friends})


@app.route("/api/pl/stories", methods=["POST"])
def api_pl_stories_create():
    me = current_user()
    f = request.files.get("media")
    if f is None or not f.filename:
        return jsonify({"ok": False, "error": "no_file"}), 400
    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else ""
    if ext in PL_IMAGE_EXT:
        kind = "image"
    elif ext in PL_VIDEO_EXT:
        kind = "video"
    else:
        return jsonify({"ok": False, "error": "bad_type"}), 400
    name = f"{uuid.uuid4().hex}.{ext}"
    _pl_store_media(f, name)
    now = datetime.now(timezone.utc)
    story = PlStory(
        user_id=me.id, media_name=name, media_kind=kind,
        caption=(request.form.get("caption") or "").strip()[:300] or None,
        created_at=now, expires_at=now + timedelta(hours=PL_STORY_TTL_HOURS),
    )
    db.session.add(story)
    db.session.commit()
    return jsonify({"ok": True, "story": _pl_serialize_story(story, me)})


@app.route("/api/pl/stories/<int:story_id>/view", methods=["POST"])
def api_pl_story_view(story_id):
    me = current_user()
    story = db.session.get(PlStory, story_id)
    if story is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if not PlStoryView.query.filter_by(story_id=story_id, viewer_id=me.id).first():
        db.session.add(PlStoryView(story_id=story_id, viewer_id=me.id))
        db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/stories/<int:story_id>/viewers")
def api_pl_story_viewers(story_id):
    me = current_user()
    story = db.session.get(PlStory, story_id)
    if story is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if story.user_id != me.id:
        return jsonify({"ok": False, "error": "forbidden"}), 403
    views = sorted(story.views, key=lambda v: v.viewed_at, reverse=True)
    return jsonify({"ok": True, "viewers": [
        {
            "username": v.viewer.username, "name": pl_display_name(v.viewer),
            "avatar_letter": pl_avatar_letter(v.viewer.username), "avatar_color": pl_avatar_color(v.viewer.username),
            "avatar_url": _pl_media_url(v.viewer.pl_avatar_image),
            "viewed_ago": pl_ago(v.viewed_at),
        }
        for v in views
    ]})


@app.route("/api/pl/stories/<int:story_id>", methods=["DELETE"])
def api_pl_story_delete(story_id):
    me = current_user()
    story = db.session.get(PlStory, story_id)
    if story is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if story.user_id != me.id:
        return jsonify({"ok": False, "error": "forbidden"}), 403
    _pl_delete_media(story.media_name)
    db.session.delete(story)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/chats")
def api_pl_chats():
    return jsonify({"ok": True, "chats": _pl_chat_list(current_user())})


def _pl_find_or_create_dm(me, other):
    """Return the 1:1 PlChat between me and other, creating it if needed.
    Caller must have already checked they are mutual follows."""
    my_chat_ids = {m.chat_id for m in PlChatMember.query.filter_by(user_id=me.id)}
    for cid in my_chat_ids:
        chat = db.session.get(PlChat, cid)
        if chat and not chat.is_group and len(chat.members) == 2 and any(m.user_id == other.id for m in chat.members):
            return chat
    chat = PlChat(is_group=False, created_by=me.id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(PlChatMember(chat_id=chat.id, user_id=me.id))
    db.session.add(PlChatMember(chat_id=chat.id, user_id=other.id))
    db.session.commit()
    return chat


@app.route("/api/pl/chats/dm/<username>", methods=["POST"])
def api_pl_open_dm(username):
    me = current_user()
    other = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if other is None or other.id == me.id:
        return jsonify({"ok": False, "error": "bad_user"}), 400
    if not _are_mutual(me.id, other.id):
        return jsonify({"ok": False, "error": "not_mutual"}), 403
    return jsonify({"ok": True, "chat_id": _pl_find_or_create_dm(me, other).id})


@app.route("/freunde/dm/<username>")
def pl_open_dm(username):
    me = current_user()
    other = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if other is None or other.id == me.id or not _are_mutual(me.id, other.id):
        abort(404)
    return redirect(url_for("pl_chat_view", chat_id=_pl_find_or_create_dm(me, other).id))


@app.route("/api/pl/chats/group", methods=["POST"])
def api_pl_create_group():
    me = current_user()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:80]
    usernames = data.get("members") or []
    if not name:
        return jsonify({"ok": False, "error": "no_name"}), 400
    members = []
    for uname in usernames[:50]:
        u = User.query.filter(db.func.lower(User.username) == str(uname).lower()).first()
        if u and u.id != me.id and _are_mutual(me.id, u.id):
            members.append(u)
    if not members:
        return jsonify({"ok": False, "error": "no_members"}), 400
    chat = PlChat(is_group=True, name=name, created_by=me.id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(PlChatMember(chat_id=chat.id, user_id=me.id))
    for u in members:
        db.session.add(PlChatMember(chat_id=chat.id, user_id=u.id))
    db.session.commit()
    return jsonify({"ok": True, "chat_id": chat.id})


def _pl_require_chat_member(chat_id, me):
    chat = db.session.get(PlChat, chat_id)
    if chat is None or not any(m.user_id == me.id for m in chat.members):
        return None
    return chat


def _pl_require_own_message(message_id, me):
    """Returns (message, chat) if this message exists, the caller sent it,
    and the caller is still a member of its chat -- None otherwise."""
    msg = db.session.get(PlMessage, message_id)
    if msg is None or msg.sender_id != me.id:
        return None, None
    chat = _pl_require_chat_member(msg.chat_id, me)
    if chat is None:
        return None, None
    return msg, chat


def _pl_serialize_message(m, me):
    reply_to = None
    if m.reply_to_id:
        parent = m.reply_to
        reply_to = (
            {"id": m.reply_to_id, "deleted": True, "sender_name": None, "text": None}
            if parent is None else
            {"id": parent.id, "deleted": False, "sender_name": pl_display_name(parent.sender),
             "text": (parent.text or "")[:140]}
        )
    reaction_groups = {}
    for r in m.reactions:
        g = reaction_groups.setdefault(r.emoji, {"emoji": r.emoji, "count": 0, "me": False})
        g["count"] += 1
        if r.user_id == me.id:
            g["me"] = True
    return {
        "id": m.id, "text": m.text, "text_html": _pl_linkify(m.text),
        "sender": m.sender.username, "sender_name": pl_display_name(m.sender),
        "sender_avatar_color": pl_avatar_color(m.sender.username),
        "is_mine": m.sender_id == me.id, "created_ago": pl_ago(m.created_at),
        "created_at": (m.created_at.replace(tzinfo=timezone.utc) if m.created_at.tzinfo is None else m.created_at).isoformat(),
        "edited": m.edited_at is not None,
        "pinned": m.pinned_at is not None,
        "attachment": _pl_attachment(m),
        "reply_to": reply_to,
        "reactions": list(reaction_groups.values()),
    }


@app.route("/api/pl/chats/<int:chat_id>/messages")
def api_pl_chat_messages(chat_id):
    me = current_user()
    chat = _pl_require_chat_member(chat_id, me)
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    after = request.args.get("after", type=int) or 0
    msgs = [m for m in chat.messages if m.id > after]
    # mark read up to the newest message
    if chat.messages:
        my_member = next(m for m in chat.members if m.user_id == me.id)
        my_member.last_read_id = max(my_member.last_read_id, chat.messages[-1].id)
        db.session.commit()
    return jsonify({"ok": True, "messages": [_pl_serialize_message(m, me) for m in msgs]})


@app.route("/api/pl/chats/<int:chat_id>/messages", methods=["POST"])
def api_pl_send_message(chat_id):
    me = current_user()
    chat = _pl_require_chat_member(chat_id, me)
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()[:4000]
    att_kind, att_value = _pl_read_att(data)
    if not text and not att_kind:
        return jsonify({"ok": False, "error": "empty"}), 400
    # 1:1 chats stay gated on the follow-each-other rule even after creation
    if not chat.is_group:
        other = next((m.user for m in chat.members if m.user_id != me.id), None)
        if other and not _are_mutual(me.id, other.id):
            return jsonify({"ok": False, "error": "not_mutual"}), 403
    reply_to_id = data.get("reply_to_id")
    if reply_to_id is not None:
        parent = db.session.get(PlMessage, reply_to_id)
        reply_to_id = parent.id if (parent is not None and parent.chat_id == chat_id) else None
    msg = PlMessage(chat_id=chat_id, sender_id=me.id, text=text,
                    att_kind=att_kind, att_value=att_value, reply_to_id=reply_to_id)
    db.session.add(msg)
    chat.last_activity = datetime.now(timezone.utc)
    db.session.flush()
    my_member = next(m for m in chat.members if m.user_id == me.id)
    my_member.last_read_id = msg.id
    db.session.commit()
    return jsonify({"ok": True, "message": _pl_serialize_message(msg, me)})


@app.route("/api/pl/messages/<int:message_id>", methods=["PATCH"])
def api_pl_edit_message(message_id):
    me = current_user()
    msg, chat = _pl_require_own_message(message_id, me)
    if msg is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()[:4000]
    if not text:
        return jsonify({"ok": False, "error": "empty"}), 400
    msg.text = text
    msg.edited_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify({"ok": True, "message": _pl_serialize_message(msg, me)})


@app.route("/api/pl/messages/<int:message_id>", methods=["DELETE"])
def api_pl_delete_message(message_id):
    me = current_user()
    msg, chat = _pl_require_own_message(message_id, me)
    if msg is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    db.session.delete(msg)
    db.session.commit()
    return jsonify({"ok": True})


PL_REACTION_EMOJI = {"👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👎"}


@app.route("/api/pl/messages/<int:message_id>/react", methods=["POST"])
def api_pl_react_message(message_id):
    """Toggling the same emoji twice removes it (like Discord) -- one
    reaction per (message, user, emoji), no limit on how many *different*
    emoji one person can put on the same message."""
    me = current_user()
    msg = db.session.get(PlMessage, message_id)
    if msg is None or _pl_require_chat_member(msg.chat_id, me) is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    data = request.get_json(silent=True) or {}
    emoji = data.get("emoji")
    if emoji not in PL_REACTION_EMOJI:
        return jsonify({"ok": False, "error": "bad_emoji"}), 400
    existing = PlMessageReaction.query.filter_by(message_id=message_id, user_id=me.id, emoji=emoji).first()
    if existing is not None:
        db.session.delete(existing)
    else:
        db.session.add(PlMessageReaction(message_id=message_id, user_id=me.id, emoji=emoji))
    db.session.commit()
    db.session.refresh(msg)
    return jsonify({"ok": True, "message": _pl_serialize_message(msg, me)})


@app.route("/api/pl/messages/<int:message_id>/pin", methods=["POST"])
def api_pl_pin_message(message_id):
    me = current_user()
    msg = db.session.get(PlMessage, message_id)
    if msg is None or _pl_require_chat_member(msg.chat_id, me) is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    msg.pinned_at = None if msg.pinned_at else datetime.now(timezone.utc)
    db.session.commit()
    return jsonify({"ok": True, "message": _pl_serialize_message(msg, me)})


@app.route("/api/pl/chats/<int:chat_id>/pinned")
def api_pl_chat_pinned(chat_id):
    me = current_user()
    chat = _pl_require_chat_member(chat_id, me)
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    pinned = sorted((m for m in chat.messages if m.pinned_at is not None), key=lambda m: m.pinned_at)
    return jsonify({"ok": True, "messages": [_pl_serialize_message(m, me) for m in pinned]})


# In-memory "X is typing" state -- {chat_id: {user_id: last_ping_datetime}}.
# Deliberately not a DB table: it's a few-seconds-TTL presence blip, not
# data anyone needs to persist or query historically.
_pl_typing = {}
_PL_TYPING_TTL_SECONDS = 6


@app.route("/api/pl/chats/<int:chat_id>/typing", methods=["POST"])
def api_pl_typing_ping(chat_id):
    me = current_user()
    if _pl_require_chat_member(chat_id, me) is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    _pl_typing.setdefault(chat_id, {})[me.id] = datetime.now(timezone.utc)
    return jsonify({"ok": True})


@app.route("/api/pl/chats/<int:chat_id>/typing")
def api_pl_typing_list(chat_id):
    me = current_user()
    if _pl_require_chat_member(chat_id, me) is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    now = datetime.now(timezone.utc)
    by_user = _pl_typing.get(chat_id, {})
    active_ids = [uid for uid, ts in list(by_user.items())
                  if uid != me.id and (now - ts).total_seconds() < _PL_TYPING_TTL_SECONDS]
    names = [pl_display_name(u) for u in User.query.filter(User.id.in_(active_ids)).all()] if active_ids else []
    return jsonify({"ok": True, "typing": names})


# ---------------------------------------------------------------------
# 1:1 voice calls: WebRTC peer-to-peer, this backend is only the
# signaling relay (offer/answer/ICE candidates get handed through it so
# the two browsers can find each other) -- once connected, audio flows
# directly browser-to-browser, never through this server. In-memory only
# (like _pl_typing above): a call's signaling exchange is only ever
# relevant while it's actively being set up, nothing worth persisting.
# STUN-only (see pinklemon-chat.js's ICE server list) -- works for most
# networks but has no TURN relay fallback for strict/symmetric NATs.
# Group calls are out of scope for now: WebRTC mesh/SFU for 3+ people is
# a materially bigger problem than a single peer connection.
# ---------------------------------------------------------------------
_pl_calls = {}  # chat_id -> {"caller_id": int, "started_at": datetime, "signals": [...]}
_pl_call_signal_seq = {"n": 0}
_PL_CALL_RING_TIMEOUT_SECONDS = 45


def _pl_call_prune(chat_id):
    call = _pl_calls.get(chat_id)
    if call is None:
        return None
    if (datetime.now(timezone.utc) - call["started_at"]).total_seconds() > _PL_CALL_RING_TIMEOUT_SECONDS and not call.get("accepted"):
        del _pl_calls[chat_id]
        return None
    return call


@app.route("/api/pl/chats/<int:chat_id>/call/start", methods=["POST"])
def api_pl_call_start(chat_id):
    me = current_user()
    chat = _pl_require_chat_member(chat_id, me)
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if chat.is_group:
        return jsonify({"ok": False, "error": "group_calls_not_supported"}), 400
    if _pl_call_prune(chat_id) is not None:
        return jsonify({"ok": False, "error": "already_in_call"}), 409
    _pl_calls[chat_id] = {
        "caller_id": me.id, "caller_name": pl_display_name(me),
        "started_at": datetime.now(timezone.utc), "accepted": False, "signals": [],
    }
    return jsonify({"ok": True})


@app.route("/api/pl/chats/<int:chat_id>/call/signal", methods=["POST"])
def api_pl_call_signal(chat_id):
    """type: 'offer' | 'answer' | 'ice' | 'decline' | 'hangup'. `data` is
    forwarded to the other member verbatim (SDP or ICE candidate JSON)."""
    me = current_user()
    chat = _pl_require_chat_member(chat_id, me)
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    call = _pl_call_prune(chat_id)
    payload = request.get_json(silent=True) or {}
    sig_type = payload.get("type")
    if sig_type not in ("offer", "answer", "ice", "decline", "hangup"):
        return jsonify({"ok": False, "error": "bad_type"}), 400
    if call is None:
        if sig_type not in ("hangup", "decline"):
            return jsonify({"ok": False, "error": "no_call"}), 404
        return jsonify({"ok": True})
    if sig_type == "answer":
        call["accepted"] = True
    _pl_call_signal_seq["n"] += 1
    call["signals"].append({
        "id": _pl_call_signal_seq["n"], "from_id": me.id, "type": sig_type,
        "data": payload.get("data"),
    })
    if sig_type in ("hangup", "decline"):
        del _pl_calls[chat_id]
    return jsonify({"ok": True})


@app.route("/api/pl/chats/<int:chat_id>/call/state")
def api_pl_call_state(chat_id):
    me = current_user()
    chat = _pl_require_chat_member(chat_id, me)
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    call = _pl_call_prune(chat_id)
    after = request.args.get("after", type=int) or 0
    if call is None:
        return jsonify({"ok": True, "active": False, "signals": []})
    signals = [s for s in call["signals"] if s["id"] > after and s["from_id"] != me.id]
    return jsonify({
        "ok": True, "active": True, "caller_id": call["caller_id"], "caller_name": call["caller_name"],
        "is_caller": call["caller_id"] == me.id, "signals": signals,
    })


# ---------------------------------------------------------------------
# Servers: persistent communities with channels + roles/permissions
# (2026-09-11, "genau wie Discord"). Channels are PlChat rows with
# server_id set -- see the model's own comment for why: every existing
# message feature (reactions, replies, edit, pins, typing) just works on
# them for free. Deliberately simpler than real Discord in two ways: (1)
# server-wide role permissions only, no per-channel overwrites, and (2)
# no voice channels -- multi-person voice needs a mesh/SFU, a materially
# bigger problem than the 1:1 WebRTC calls already built.
# ---------------------------------------------------------------------
def _pl_gen_invite_code():
    import secrets as _secrets
    alphabet = "abcdefghijkmnpqrstuvwxyz23456789"  # no 0/O/1/l/I -- avoids misreads
    while True:
        code = "".join(_secrets.choice(alphabet) for _ in range(8))
        if not PlServer.query.filter_by(invite_code=code).first():
            return code


def _pl_server_member_row(server_id, user):
    if user is None:
        return None
    return PlServerMember.query.filter_by(server_id=server_id, user_id=user.id).first()


def _pl_server_permissions(server, member):
    if member is None:
        return set()
    if server.owner_id == member.user_id:
        return set(PL_SERVER_PERMISSIONS)
    perms = set()
    for role in member.roles:
        try:
            perms.update(json.loads(role.permissions or "[]"))
        except Exception:
            pass
    return perms & set(PL_SERVER_PERMISSIONS)


def _pl_require_server_permission(server_id, me, perm=None):
    """Returns (server, member) if `me` is a member (and has `perm`, when
    given) -- (None, None) otherwise. `perm=None` just requires membership."""
    server = db.session.get(PlServer, server_id)
    if server is None:
        return None, None
    member = _pl_server_member_row(server_id, me)
    if member is None:
        return None, None
    if perm is not None and perm not in _pl_server_permissions(server, member):
        return None, None
    return server, member


def _pl_sync_new_member_into_channels(server, user):
    for ch in server.channels:
        if not any(m.user_id == user.id for m in ch.members):
            db.session.add(PlChatMember(chat_id=ch.id, user_id=user.id))


def _pl_sync_new_channel_members(channel, server):
    for sm in server.members:
        if not any(m.user_id == sm.user_id for m in channel.members):
            db.session.add(PlChatMember(chat_id=channel.id, user_id=sm.user_id))


def _pl_serialize_server(server, me):
    member = _pl_server_member_row(server.id, me)
    return {
        "id": server.id, "name": server.name,
        "icon_url": _pl_media_url(server.icon_image),
        "owner_id": server.owner_id, "is_owner": server.owner_id == me.id,
        "invite_code": server.invite_code, "is_public": server.is_public,
        "my_permissions": sorted(_pl_server_permissions(server, member)) if member else [],
        "member_count": len(server.members),
    }


def _pl_serialize_channel(ch):
    return {
        "id": ch.id, "name": ch.name, "topic": ch.topic, "position": ch.position,
        "category": ch.category, "channel_type": ch.channel_type,
    }


def _pl_serialize_role(role):
    try:
        perms = json.loads(role.permissions or "[]")
    except Exception:
        perms = []
    return {
        "id": role.id, "name": role.name, "color": role.color,
        "permissions": perms, "position": role.position, "is_default": role.is_default,
    }


def _pl_serialize_server_member(server, sm):
    return {
        "user_id": sm.user_id, "username": sm.user.username,
        "name": pl_display_name(sm.user), "nickname": sm.nickname,
        "avatar_color": pl_avatar_color(sm.user.username),
        "avatar_url": _pl_media_url(sm.user.pl_avatar_image),
        "is_owner": server.owner_id == sm.user_id,
        "role_ids": [r.id for r in sm.roles],
        "online": _pl_is_online(sm.user),
    }


@app.route("/api/pl/servers", methods=["GET"])
def api_pl_servers_list():
    me = current_user()
    rows = PlServerMember.query.filter_by(user_id=me.id).all()
    servers = [db.session.get(PlServer, r.server_id) for r in rows]
    return jsonify({"ok": True, "servers": [_pl_serialize_server(s, me) for s in servers if s is not None]})


@app.route("/api/pl/servers", methods=["POST"])
def api_pl_servers_create():
    me = current_user()
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:80]
    if not name:
        return jsonify({"ok": False, "error": "no_name"}), 400
    server = PlServer(name=name, owner_id=me.id, invite_code=_pl_gen_invite_code())
    db.session.add(server)
    db.session.flush()
    default_role = PlRole(server_id=server.id, name="@everyone", color="#99aab5", permissions="[]",
                           position=0, is_default=True)
    db.session.add(default_role)
    channel = PlChat(is_group=True, server_id=server.id, name="allgemein", position=0, created_by=me.id)
    db.session.add(channel)
    db.session.flush()
    db.session.add(PlServerMember(server_id=server.id, user_id=me.id))
    db.session.add(PlChatMember(chat_id=channel.id, user_id=me.id))
    db.session.commit()
    return jsonify({"ok": True, "server": _pl_serialize_server(server, me), "channel_id": channel.id})


@app.route("/api/pl/servers/<int:server_id>")
def api_pl_server_detail(server_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me)
    if server is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    return jsonify({
        "ok": True, "server": _pl_serialize_server(server, me),
        "channels": [_pl_serialize_channel(c) for c in server.channels],
        "roles": [_pl_serialize_role(r) for r in server.roles],
        "members": [_pl_serialize_server_member(server, sm) for sm in server.members],
    })


@app.route("/api/pl/servers/<int:server_id>/channels", methods=["POST"])
def api_pl_server_create_channel(server_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "manage_channels")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:50]
    if not name:
        return jsonify({"ok": False, "error": "no_name"}), 400
    topic = (data.get("topic") or "").strip()[:300] or None
    category = (data.get("category") or "").strip()[:80] or None
    channel_type = data.get("channel_type") if data.get("channel_type") in ("text", "voice") else "text"
    channel = PlChat(is_group=True, server_id=server_id, name=name, topic=topic,
                      category=category, channel_type=channel_type,
                      position=len(server.channels), created_by=me.id)
    db.session.add(channel)
    db.session.flush()
    _pl_sync_new_channel_members(channel, server)
    db.session.commit()
    return jsonify({"ok": True, "channel": _pl_serialize_channel(channel)})


@app.route("/api/pl/servers/<int:server_id>/channels/<int:channel_id>", methods=["DELETE"])
def api_pl_server_delete_channel(server_id, channel_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "manage_channels")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    channel = db.session.get(PlChat, channel_id)
    if channel is None or channel.server_id != server_id:
        return jsonify({"ok": False, "error": "not_found"}), 404
    db.session.delete(channel)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/servers/join/<code>", methods=["POST"])
def api_pl_server_join(code):
    me = current_user()
    server = PlServer.query.filter_by(invite_code=code).first()
    if server is None:
        return jsonify({"ok": False, "error": "invalid_invite"}), 404
    if PlServerBan.query.filter_by(server_id=server.id, user_id=me.id).first():
        return jsonify({"ok": False, "error": "banned"}), 403
    existing = _pl_server_member_row(server.id, me)
    if existing is None:
        sm = PlServerMember(server_id=server.id, user_id=me.id)
        db.session.add(sm)
        db.session.flush()
        default_role = next((r for r in server.roles if r.is_default), None)
        if default_role is not None:
            sm.roles.append(default_role)
        _pl_sync_new_member_into_channels(server, me)
        db.session.commit()
    return jsonify({"ok": True, "server": _pl_serialize_server(server, me)})


@app.route("/api/pl/servers/<int:server_id>/leave", methods=["POST"])
def api_pl_server_leave(server_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me)
    if server is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if server.owner_id == me.id:
        return jsonify({"ok": False, "error": "owner_cannot_leave"}), 400
    for ch in server.channels:
        cm = next((m for m in ch.members if m.user_id == me.id), None)
        if cm is not None:
            db.session.delete(cm)
    db.session.delete(member)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/servers/<int:server_id>/roles", methods=["POST"])
def api_pl_server_create_role(server_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "manage_roles")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:50]
    if not name:
        return jsonify({"ok": False, "error": "no_name"}), 400
    color = data.get("color") if re.match(r"^#[0-9a-fA-F]{6}$", data.get("color") or "") else "#99aab5"
    perms = [p for p in (data.get("permissions") or []) if p in PL_SERVER_PERMISSIONS]
    role = PlRole(server_id=server_id, name=name, color=color, permissions=json.dumps(perms),
                  position=len(server.roles))
    db.session.add(role)
    db.session.commit()
    return jsonify({"ok": True, "role": _pl_serialize_role(role)})


@app.route("/api/pl/servers/<int:server_id>/roles/<int:role_id>", methods=["PATCH"])
def api_pl_server_edit_role(server_id, role_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "manage_roles")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    role = db.session.get(PlRole, role_id)
    if role is None or role.server_id != server_id:
        return jsonify({"ok": False, "error": "not_found"}), 404
    data = request.get_json(silent=True) or {}
    if "name" in data and not role.is_default:
        v = (data.get("name") or "").strip()[:50]
        if v:
            role.name = v
    if "color" in data and re.match(r"^#[0-9a-fA-F]{6}$", data.get("color") or ""):
        role.color = data["color"]
    if "permissions" in data:
        role.permissions = json.dumps([p for p in (data.get("permissions") or []) if p in PL_SERVER_PERMISSIONS])
    db.session.commit()
    return jsonify({"ok": True, "role": _pl_serialize_role(role)})


@app.route("/api/pl/servers/<int:server_id>/roles/<int:role_id>", methods=["DELETE"])
def api_pl_server_delete_role(server_id, role_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "manage_roles")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    role = db.session.get(PlRole, role_id)
    if role is None or role.server_id != server_id:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if role.is_default:
        return jsonify({"ok": False, "error": "cannot_delete_default_role"}), 400
    db.session.delete(role)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/servers/<int:server_id>/members/<int:user_id>/roles", methods=["POST"])
def api_pl_server_toggle_member_role(server_id, user_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "manage_roles")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    target = _pl_server_member_row(server_id, db.session.get(User, user_id))
    role = db.session.get(PlRole, (request.get_json(silent=True) or {}).get("role_id"))
    if target is None or role is None or role.server_id != server_id:
        return jsonify({"ok": False, "error": "not_found"}), 404
    assign = bool((request.get_json(silent=True) or {}).get("assign"))
    if assign and role not in target.roles:
        target.roles.append(role)
    elif not assign and role in target.roles:
        target.roles.remove(role)
    db.session.commit()
    return jsonify({"ok": True, "member": _pl_serialize_server_member(server, target)})


@app.route("/api/pl/servers/<int:server_id>/members/<int:user_id>/kick", methods=["POST"])
def api_pl_server_kick(server_id, user_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "kick_members")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    if user_id == server.owner_id:
        return jsonify({"ok": False, "error": "cannot_kick_owner"}), 400
    target = _pl_server_member_row(server_id, db.session.get(User, user_id))
    if target is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    for ch in server.channels:
        cm = next((m for m in ch.members if m.user_id == user_id), None)
        if cm is not None:
            db.session.delete(cm)
    db.session.delete(target)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/servers/<int:server_id>/members/<int:user_id>/ban", methods=["POST"])
def api_pl_server_ban(server_id, user_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "ban_members")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    if user_id == server.owner_id:
        return jsonify({"ok": False, "error": "cannot_ban_owner"}), 400
    target = _pl_server_member_row(server_id, db.session.get(User, user_id))
    if target is not None:
        for ch in server.channels:
            cm = next((m for m in ch.members if m.user_id == user_id), None)
            if cm is not None:
                db.session.delete(cm)
        db.session.delete(target)
    if not PlServerBan.query.filter_by(server_id=server_id, user_id=user_id).first():
        db.session.add(PlServerBan(server_id=server_id, user_id=user_id))
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/servers/<int:server_id>/members/<int:user_id>/unban", methods=["POST"])
def api_pl_server_unban(server_id, user_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "ban_members")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    ban = PlServerBan.query.filter_by(server_id=server_id, user_id=user_id).first()
    if ban is not None:
        db.session.delete(ban)
        db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/pl/servers/<int:server_id>/bans")
def api_pl_server_bans(server_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me, "ban_members")
    if server is None:
        return jsonify({"ok": False, "error": "not_found_or_no_permission"}), 403
    bans = PlServerBan.query.filter_by(server_id=server_id).all()
    users = {u.id: u for u in User.query.filter(User.id.in_([b.user_id for b in bans])).all()} if bans else {}
    return jsonify({"ok": True, "bans": [
        {"user_id": b.user_id, "username": users[b.user_id].username}
        for b in bans if b.user_id in users
    ]})


@app.route("/freunde/server/<int:server_id>")
def pl_server_view(server_id):
    me = current_user()
    server, member = _pl_require_server_permission(server_id, me)
    if server is None:
        abort(404)
    return render_template(
        "pl_server.html", server_id=server_id, me_json={"id": me.id, "username": me.username},
    )


if __name__ == "__main__":
    app.run(debug=True)

