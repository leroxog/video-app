import os
import io
import re
import sys
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
    db, User, Subscription, UserCreatedCode, Conversation, ConversationMember, Message,
    AiChatFeedback, AiChat, AiChatMessage, AiAdminFact, AiLearnedFact, PasswordResetCode,
    AccountRecoveryRequest, ErrorLog,
    AiVoiceProfile, AiPersonality, AiGeneratedMedia,
    AiTrainingExample, AiTrainingRun,
    FeedPost, FeedLike, FeedComment, FeedCommentLike, FeedPS,
    PlChat, PlChatMember, PlMessage,
)
import ai_assistant
import local_ai

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


def elevenlabs_clone_voice(name, audio_bytes, content_type):
    if not USE_ELEVENLABS:
        raise RuntimeError("ELEVENLABS_API_KEY ist nicht gesetzt.")
    response = requests.post(
        f"{ELEVENLABS_API_URL}/voices/add",
        headers={"xi-api-key": ELEVENLABS_API_KEY},
        data={"name": name},
        files={"files": ("sample", audio_bytes, content_type or "audio/webm")},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["voice_id"]


def elevenlabs_delete_voice(voice_id):
    try:
        requests.delete(
            f"{ELEVENLABS_API_URL}/voices/{voice_id}",
            headers={"xi-api-key": ELEVENLABS_API_KEY},
            timeout=15,
        )
    except Exception:
        logger.exception("ElevenLabs-Stimme %s konnte nicht gelöscht werden.", voice_id)


def elevenlabs_text_to_speech(voice_id, text):
    if not USE_ELEVENLABS:
        raise RuntimeError("ELEVENLABS_API_KEY ist nicht gesetzt.")
    response = requests.post(
        f"{ELEVENLABS_API_URL}/text-to-speech/{voice_id}",
        headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
        json={
            "text": text,
            "model_id": "eleven_multilingual_v2",
            # Explicit settings (ElevenLabs' own defaults are more neutral/
            # flat) -- some style lets the model vary delivery more
            # naturally instead of a flat monotone read. stability raised
            # back up from an earlier lower value: that made delivery more
            # expressive but introduced noticeably long pauses between
            # words, so this trades a little of that expressiveness back
            # for steadier, more continuous pacing.
            "voice_settings": {
                "stability": 0.68, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True,
            },
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.content


def _synthesize_and_store_audio(text, gender=None):
    """Real text-to-speech for the generate_audio AI tool (see
    ai_assistant.py): tries the requested gender's cloned ElevenLabs voice
    first, then any other gender that has one, and returns None -- never
    fakes it -- if no cloned voice exists yet or the API call/storage
    fails. Runs from the chat job's background thread (see
    ai_assistant.start_chat_job), so it pushes its own app context for the
    AiVoiceProfile query rather than relying on one already being active."""
    with app.app_context():
        genders_to_try = ([gender] if gender else []) + [g for g in VOICE_PROFILE_GENDERS if g != gender]
        voice_id = None
        for g in genders_to_try:
            profile = AiVoiceProfile.query.filter_by(gender=g).first()
            if profile is not None and profile.elevenlabs_voice_id:
                voice_id = profile.elevenlabs_voice_id
                break
        if not voice_id:
            return None
        try:
            audio_bytes = elevenlabs_text_to_speech(voice_id, text)
        except Exception:
            logger.exception("generate_audio: ElevenLabs-Synthese fehlgeschlagen.")
            return None
        stored_filename = f"{uuid.uuid4().hex}.mp3"
        try:
            save_media_bytes(audio_bytes, "generated_audio", stored_filename, "audio/mpeg")
        except Exception:
            logger.exception("generate_audio: Speichern fehlgeschlagen.")
            return None
        return media_url("generated_audio", stored_filename)


LOCAL_MEDIA_FOLDERS = {
    "posts": "UPLOAD_FOLDER",
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


def allowed_image_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def current_user():
    uid = session.get("user_id")
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


MESSAGE_VIEW_TTL_SECONDS = 15
MIN_GROUP_MEMBERS = 2
MAX_GROUP_MEMBERS = 99


def mutual_follow_ids(user):
    """IDs of users that `user` follows AND that follow `user` back."""
    following = {
        s.channel_id for s in Subscription.query.filter_by(subscriber_id=user.id).all()
    }
    followers = {
        s.subscriber_id for s in Subscription.query.filter_by(channel_id=user.id).all()
    }
    return following & followers


def is_conversation_member(user, conversation):
    return ConversationMember.query.filter_by(
        conversation_id=conversation.id, user_id=user.id
    ).first() is not None


def purge_expired_messages(conversation):
    now = datetime.now(timezone.utc)
    for message in list(conversation.messages):
        viewed_at = message.viewed_at
        if viewed_at is None:
            continue
        if viewed_at.tzinfo is None:
            viewed_at = viewed_at.replace(tzinfo=timezone.utc)
        if (now - viewed_at).total_seconds() >= MESSAGE_VIEW_TTL_SECONDS:
            db.session.delete(message)
    db.session.commit()


ONLINE_THRESHOLD_SECONDS = 5 * 60
LAST_SEEN_UPDATE_THROTTLE_SECONDS = 60

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
    user_id = session.get("user_id")
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
        session.permanent = True
        return redirect(url_for("pl_home"))
    return render_template("pl_auth.html", mode="login")


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
        session.permanent = True
        return redirect(url_for("pl_home"))
    return render_template("pl_auth.html", mode="signup")


@app.route("/logout", methods=["POST", "GET"])
def pl_logout():
    session.pop("user_id", None)
    return redirect(url_for("pl_login"))


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


def serialize_pl_post(post, me):
    liked_ids = {pl.user_id for pl in post.likes}
    return {
        "id": post.id,
        "heading": post.heading,
        "body": post.body or "",
        "created_ago": pl_ago(post.created_at),
        "share_count": post.share_count,
        "like_count": len(post.likes),
        "comment_count": len(post.comments),
        "liked_by_me": me.id in liked_ids,
        "is_mine": post.author_id == me.id,
        "author": {
            "username": post.author.username,
            "avatar_letter": pl_avatar_letter(post.author.username),
        },
        "ps": (
            {"body": post.ps.body, "created_ago": pl_ago(post.ps.created_at)}
            if post.ps else None
        ),
    }


def render_pl_post(post, me):
    return render_template("partials/_pl_post.html", post=serialize_pl_post(post, me))


PL_POST_MAX = 60           # posts per feed page
_PL_RATE = {}              # user_id -> [timestamps] of recent creates


def _pl_rate_ok(uid, limit=8, window=120):
    now = datetime.now(timezone.utc).timestamp()
    recent = [t for t in _PL_RATE.get(uid, []) if now - t < window]
    _PL_RATE[uid] = recent
    if len(recent) >= limit:
        return False
    recent.append(now)
    return True


# ==========================================================================
# pinklemon -- pages
# ==========================================================================
@app.route("/")
def pl_home():
    me = current_user()
    q = (request.args.get("q") or "").strip()
    query = FeedPost.query
    if q:
        like = f"%{q}%"
        query = query.filter(db.or_(FeedPost.heading.ilike(like), FeedPost.body.ilike(like)))
    posts = query.order_by(FeedPost.created_at.desc()).limit(PL_POST_MAX).all()
    serialized = [serialize_pl_post(p, me) for p in posts]
    return render_template(
        "pl_home.html", posts=serialized, q=q,
        me_json={"id": me.id, "username": me.username},
    )


@app.route("/freunde")
def pl_friends():
    me = current_user()
    return render_template("pl_friends.html", chats=_pl_chat_list(me), me_json={"id": me.id, "username": me.username})


@app.route("/freunde/u/<username>")
def pl_profile(username):
    me = current_user()
    user = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if user is None:
        abort(404)
    i_follow = Subscription.query.filter_by(subscriber_id=me.id, channel_id=user.id).first() is not None
    follows_me = Subscription.query.filter_by(subscriber_id=user.id, channel_id=me.id).first() is not None
    return render_template(
        "pl_profile.html", prof=user, is_me=user.id == me.id,
        i_follow=i_follow, follows_me=follows_me, mutual=i_follow and follows_me,
        followers=Subscription.query.filter_by(channel_id=user.id).count(),
        following=Subscription.query.filter_by(subscriber_id=user.id).count(),
        avatar_letter=pl_avatar_letter(user.username),
    )


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


NEX7_PERSONAS = [
    {"key": "nex", "name": "Nex", "tag": "ausgewogen & hilfsbereit",
     "desc": "Die klassische Nex: freundlich, klar, immer hilfsbereit."},
    {"key": "seven", "name": "7", "tag": "direkt & frech",
     "desc": "Roh, sarkastisch, ohne Zuckerguss. Lässt sich nichts gefallen."},
    {"key": "ehrgeizig", "name": "Ehrgeizig", "tag": "SEHR SEHR SEHR ehrgeizig",
     "desc": "Macht aus allem ein Ziel. Fordert dich, feiert Fortschritt, keine Ausreden."},
    {"key": "ruhig", "name": "Ruhig", "tag": "gelassen & geduldig",
     "desc": "Nichts bringt sie aus der Ruhe. Kein Druck, ein Schritt nach dem anderen."},
    {"key": "chaos", "name": "Chaos", "tag": "überdreht & verspielt",
     "desc": "Hyperaktiv, sprunghaft, voller Energie — liefert am Ende trotzdem sauber ab."},
]
# maps the persona key -> the project_type api_ai_chat / ai_assistant expect
NEX7_PROJECT_TYPE = {"seven": "sevenai", "ehrgeizig": "ehrgeizig", "ruhig": "ruhig", "chaos": "chaos"}


@app.route("/nex7")
def pl_nex7():
    me = current_user()
    persona = me.nex7_persona if me.nex7_persona in NEX7_PROJECT_TYPE or me.nex7_persona == "nex" else "nex"
    return render_template(
        "pl_nex7.html", personas=NEX7_PERSONAS, current_persona=persona,
        project_type=NEX7_PROJECT_TYPE.get(persona, ""),
        me_json={"id": me.id, "username": me.username},
    )


@app.route("/api/pl/nex7/persona", methods=["POST"])
def api_pl_nex7_persona():
    me = current_user()
    key = (request.get_json(silent=True) or {}).get("persona")
    if key not in ("nex", "seven", "ehrgeizig", "ruhig", "chaos"):
        return jsonify({"ok": False, "error": "bad_persona"}), 400
    me.nex7_persona = key
    db.session.commit()
    return jsonify({"ok": True, "persona": key, "project_type": NEX7_PROJECT_TYPE.get(key, "")})


@app.route("/spiele")
def pl_spiele():
    return render_template("pl_spiele.html")


@app.route("/videos")
def pl_videos():
    return render_template("pl_videos.html")


@app.route("/p/<int:post_id>")
def pl_post_page(post_id):
    me = current_user()
    post = db.session.get(FeedPost, post_id)
    if post is None:
        abort(404)
    return render_template(
        "pl_home.html", posts=[serialize_pl_post(post, me)], q="",
        me_json={"id": me.id, "username": me.username},
    )


# ==========================================================================
# pinklemon -- feed API
# ==========================================================================
@app.route("/api/pl/posts", methods=["POST"])
def api_pl_create_post():
    me = current_user()
    if not _pl_rate_ok(me.id):
        return jsonify({"ok": False, "error": "rate"}), 429
    data = request.get_json(silent=True) or {}
    heading = (data.get("heading") or "").strip()[:140]
    body = (data.get("body") or "").strip()[:4000] or None
    if not heading:
        return jsonify({"ok": False, "error": "empty"}), 400
    post = FeedPost(author_id=me.id, heading=heading, body=body)
    db.session.add(post)
    db.session.commit()
    return jsonify({"ok": True, "post": serialize_pl_post(post, me), "html": render_pl_post(post, me)})


@app.route("/api/pl/posts/<int:post_id>/like", methods=["POST"])
def api_pl_like_post(post_id):
    me = current_user()
    post = db.session.get(FeedPost, post_id)
    if post is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    existing = FeedLike.query.filter_by(post_id=post_id, user_id=me.id).first()
    if existing:
        db.session.delete(existing)
        liked = False
    else:
        db.session.add(FeedLike(post_id=post_id, user_id=me.id))
        liked = True
    db.session.commit()
    return jsonify({"ok": True, "liked": liked, "like_count": FeedLike.query.filter_by(post_id=post_id).count()})


@app.route("/api/pl/posts/<int:post_id>/share", methods=["POST"])
def api_pl_share_post(post_id):
    post = db.session.get(FeedPost, post_id)
    if post is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    post.share_count = (post.share_count or 0) + 1
    db.session.commit()
    return jsonify({"ok": True, "share_count": post.share_count})


@app.route("/api/pl/posts/<int:post_id>/ps", methods=["POST"])
def api_pl_add_ps(post_id):
    me = current_user()
    post = db.session.get(FeedPost, post_id)
    if post is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    if post.author_id != me.id:
        return jsonify({"ok": False, "error": "not_yours"}), 403
    if post.ps is not None:
        return jsonify({"ok": False, "error": "exists"}), 409
    body = (request.get_json(silent=True) or {}).get("body", "").strip()[:2000]
    if not body:
        return jsonify({"ok": False, "error": "empty"}), 400
    db.session.add(FeedPS(post_id=post_id, body=body))
    db.session.commit()
    return jsonify({"ok": True})


def _serialize_pl_comment(c, me):
    liked_ids = {cl.user_id for cl in c.likes}
    return {
        "id": c.id,
        "parent_id": c.parent_id,
        "body": c.body,
        "created_at": (c.created_at.replace(tzinfo=timezone.utc) if c.created_at.tzinfo is None else c.created_at).isoformat(),
        "like_count": len(c.likes),
        "liked_by_me": me.id in liked_ids,
        "author": {"username": c.author.username, "avatar_letter": pl_avatar_letter(c.author.username)},
    }


@app.route("/api/pl/posts/<int:post_id>/comments")
def api_pl_list_comments(post_id):
    me = current_user()
    post = db.session.get(FeedPost, post_id)
    if post is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    # Top-level comments oldest-first, each followed by its replies.
    tops = [c for c in post.comments if c.parent_id is None]
    tops.sort(key=lambda c: c.created_at)
    out = []
    for top in tops:
        out.append(_serialize_pl_comment(top, me))
        for r in sorted(top.replies, key=lambda c: c.created_at):
            out.append(_serialize_pl_comment(r, me))
    return jsonify({"ok": True, "comments": out})


@app.route("/api/pl/posts/<int:post_id>/comments", methods=["POST"])
def api_pl_add_comment(post_id):
    me = current_user()
    post = db.session.get(FeedPost, post_id)
    if post is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    data = request.get_json(silent=True) or {}
    body = (data.get("body") or "").strip()[:2000]
    if not body:
        return jsonify({"ok": False, "error": "empty"}), 400
    parent_id = data.get("parent_id")
    if parent_id is not None:
        parent = db.session.get(FeedComment, parent_id)
        if parent is None or parent.post_id != post_id:
            return jsonify({"ok": False, "error": "bad_parent"}), 400
        # collapse a reply-to-a-reply onto the same top-level thread
        if parent.parent_id is not None:
            parent_id = parent.parent_id
    c = FeedComment(post_id=post_id, author_id=me.id, parent_id=parent_id, body=body)
    db.session.add(c)
    db.session.commit()
    return jsonify({"ok": True, "comment": _serialize_pl_comment(c, me)})


@app.route("/api/pl/comments/<int:comment_id>/like", methods=["POST"])
def api_pl_like_comment(comment_id):
    me = current_user()
    c = db.session.get(FeedComment, comment_id)
    if c is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    existing = FeedCommentLike.query.filter_by(comment_id=comment_id, user_id=me.id).first()
    if existing:
        db.session.delete(existing)
        liked = False
    else:
        db.session.add(FeedCommentLike(comment_id=comment_id, user_id=me.id))
        liked = True
    db.session.commit()
    return jsonify({"ok": True, "liked": liked, "like_count": FeedCommentLike.query.filter_by(comment_id=comment_id).count()})


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
    return f"@{other.username}" if other else "Chat"


def _pl_chat_summary(chat, me):
    last = chat.messages[-1] if chat.messages else None
    my_member = next((m for m in chat.members if m.user_id == me.id), None)
    unread = 0
    if my_member:
        unread = sum(1 for m in chat.messages if m.id > my_member.last_read_id and m.sender_id != me.id)
    title = _pl_chat_title(chat, me)
    return {
        "id": chat.id,
        "is_group": chat.is_group,
        "title": title,
        "avatar_letter": pl_avatar_letter(title.lstrip("@")),
        "members": [m.user.username for m in chat.members],
        "last_text": (last.text[:80] if last else ""),
        "last_sender": (last.sender.username if last else ""),
        "last_ago": (pl_ago(last.created_at) if last else ""),
        "unread": unread,
    }


def _pl_chat_list(me):
    memberships = PlChatMember.query.filter_by(user_id=me.id).all()
    chats = [db.session.get(PlChat, m.chat_id) for m in memberships]
    chats = [c for c in chats if c is not None]
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
        {"username": u.username, "avatar_letter": pl_avatar_letter(u.username)} for u in users
    ]})


@app.route("/api/pl/chats")
def api_pl_chats():
    return jsonify({"ok": True, "chats": _pl_chat_list(current_user())})


@app.route("/api/pl/chats/dm/<username>", methods=["POST"])
def api_pl_open_dm(username):
    me = current_user()
    other = User.query.filter(db.func.lower(User.username) == username.lower()).first()
    if other is None or other.id == me.id:
        return jsonify({"ok": False, "error": "bad_user"}), 400
    if not _are_mutual(me.id, other.id):
        return jsonify({"ok": False, "error": "not_mutual"}), 403
    # existing 1:1?
    my_chat_ids = {m.chat_id for m in PlChatMember.query.filter_by(user_id=me.id)}
    for cid in my_chat_ids:
        chat = db.session.get(PlChat, cid)
        if chat and not chat.is_group and len(chat.members) == 2 and any(m.user_id == other.id for m in chat.members):
            return jsonify({"ok": True, "chat_id": chat.id})
    chat = PlChat(is_group=False, created_by=me.id)
    db.session.add(chat)
    db.session.flush()
    db.session.add(PlChatMember(chat_id=chat.id, user_id=me.id))
    db.session.add(PlChatMember(chat_id=chat.id, user_id=other.id))
    db.session.commit()
    return jsonify({"ok": True, "chat_id": chat.id})


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
    return jsonify({"ok": True, "messages": [
        {
            "id": m.id, "text": m.text, "sender": m.sender.username,
            "is_mine": m.sender_id == me.id, "created_ago": pl_ago(m.created_at),
            "created_at": (m.created_at.replace(tzinfo=timezone.utc) if m.created_at.tzinfo is None else m.created_at).isoformat(),
        }
        for m in msgs
    ]})


@app.route("/api/pl/chats/<int:chat_id>/messages", methods=["POST"])
def api_pl_send_message(chat_id):
    me = current_user()
    chat = _pl_require_chat_member(chat_id, me)
    if chat is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    text = ((request.get_json(silent=True) or {}).get("text") or "").strip()[:4000]
    if not text:
        return jsonify({"ok": False, "error": "empty"}), 400
    # 1:1 chats stay gated on the follow-each-other rule even after creation
    if not chat.is_group:
        other = next((m.user for m in chat.members if m.user_id != me.id), None)
        if other and not _are_mutual(me.id, other.id):
            return jsonify({"ok": False, "error": "not_mutual"}), 403
    msg = PlMessage(chat_id=chat_id, sender_id=me.id, text=text)
    db.session.add(msg)
    chat.last_activity = datetime.now(timezone.utc)
    db.session.flush()
    my_member = next(m for m in chat.members if m.user_id == me.id)
    my_member.last_read_id = msg.id
    db.session.commit()
    return jsonify({"ok": True, "message": {
        "id": msg.id, "text": msg.text, "sender": me.username, "is_mine": True,
        "created_ago": pl_ago(msg.created_at),
    }})


@app.route("/assistant")
def assistant_page():
    return render_template("assistant.html", user=current_user())


@app.route("/7ai")
def sevenai_page():
    """7Ai's own full-page chat -- structurally identical to /assistant
    (same shared chat widget in base.html), just with a different persona
    server-side and its own chat history (see AiChat.character). See
    templates/sevenai.html's data-ai-character attribute, which is what
    tells base.html's script to send character "sevenai" instead of "nex"."""
    return render_template("sevenai.html", user=current_user())


def serialize_ai_chat(chat):
    return {
        "id": chat.id,
        "title": chat.title or "Neuer Chat",
        "mode": chat.mode,
        "character": chat.character,
        "specialize_prompted": chat.specialize_prompted,
        "updated_at": chat.updated_at.strftime("%d.%m.%Y %H:%M"),
    }


@app.route("/api/ai/chats")
def api_ai_list_chats():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    # Defaults to "nex" so old frontend code that never sends `character`
    # (there is none anymore, but this keeps the endpoint itself backward-
    # compatible) still only sees Nex chats -- see AiChat.character.
    character = request.args.get("character") if request.args.get("character") in ("nex", "sevenai", "nex7") else "nex"
    chats = (
        AiChat.query.filter_by(user_id=user.id, character=character)
        .order_by(AiChat.updated_at.desc()).all()
    )
    return jsonify({"ok": True, "chats": [serialize_ai_chat(c) for c in chats]})


@app.route("/api/ai/chats", methods=["POST"])
def api_ai_create_chat():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    data = request.get_json(silent=True) or {}
    character = data.get("character") if data.get("character") in ("nex", "sevenai", "nex7") else "nex"
    chat = AiChat(user_id=user.id, character=character)
    db.session.add(chat)
    db.session.commit()
    return jsonify({"ok": True, "chat": serialize_ai_chat(chat)})


@app.route("/api/ai/chats/<int:chat_id>/messages")
def api_ai_chat_messages(chat_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    chat = AiChat.query.filter_by(id=chat_id, user_id=user.id).first_or_404()
    messages = [{"role": m.role, "content": m.content} for m in chat.messages]
    return jsonify({"ok": True, "chat": serialize_ai_chat(chat), "messages": messages})


@app.route("/api/ai/chats/<int:chat_id>", methods=["PATCH"])
def api_ai_update_chat(chat_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    chat = AiChat.query.filter_by(id=chat_id, user_id=user.id).first_or_404()

    data = request.get_json(silent=True) or {}
    if "title" in data:
        title = (data.get("title") or "").strip()[:100]
        if not title:
            return jsonify({"ok": False, "error": "invalid_title"}), 400
        chat.title = title
    if "mode" in data and data["mode"] in ("general", "code"):
        chat.mode = data["mode"]
    if "specialize_prompted" in data:
        chat.specialize_prompted = bool(data["specialize_prompted"])
    db.session.commit()
    return jsonify({"ok": True, "chat": serialize_ai_chat(chat)})


@app.route("/api/ai/chats/<int:chat_id>/delete", methods=["POST"])
def api_ai_delete_chat(chat_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    chat = AiChat.query.filter_by(id=chat_id, user_id=user.id).first_or_404()
    db.session.delete(chat)
    db.session.commit()
    return jsonify({"ok": True})


ADMIN_FACT_MAX_LENGTH = 500
ADMIN_FACTS_PROMPT_LIMIT = 20
LEARNED_FACTS_PROMPT_LIMIT = 15
# The private per-user profile (source="user") gets a much larger budget
# than the shared wikipedia/python_docs knowledge above -- it's meant to
# grow into a large, detailed record of one specific person over many
# conversations, not stay capped at a handful of entries. Each row is
# short (a sentence, see remember_user_fact's arg cap), so even a few
# hundred of them still comfortably fits Groq's context window alongside
# everything else. Raised from 120 -> 240 so the profile stays precise
# for long-running users instead of quietly dropping older detail once
# they cross the old cap.
USER_FACTS_PROMPT_LIMIT = 240

# Typing-speed baseline: how many samples before we trust a user's average
# enough to flag a single message as unusually fast/slow *for them*, and
# how far a message's interval has to deviate to count as an anomaly. The
# baseline itself uses a capped rolling weight (TYPING_BASELINE_MAX_WEIGHT)
# so it keeps adapting to a person's current typing habits rather than
# being frozen in by their first hundred messages forever.
TYPING_BASELINE_MIN_SAMPLES = 5
TYPING_BASELINE_MAX_WEIGHT = 100
TYPING_ANOMALY_FAST_RATIO = 0.6
TYPING_ANOMALY_SLOW_RATIO = 1.7
TYPING_INTERVAL_MIN_MS = 15
TYPING_INTERVAL_MAX_MS = 5000


def _update_typing_baseline_and_get_note(user, interval_ms):
    """Updates `user`'s rolling average typing interval with this message's
    value (mutates in place, caller still needs to commit) and returns a
    private, system-prompt-only note if this message's typing speed was
    unusually fast/slow *compared to this same person's own baseline* --
    or None if there's no reliable baseline yet or nothing stands out. See
    ai_assistant.py's behavior_note handling: this is a raw observation,
    never treated as a fact by itself, only ever fed to the model as
    context it may choose to act on."""
    note = None
    if user.typing_sample_count >= TYPING_BASELINE_MIN_SAMPLES and user.avg_typing_interval_ms:
        if interval_ms <= user.avg_typing_interval_ms * TYPING_ANOMALY_FAST_RATIO:
            note = (
                "Diese Nachricht wurde auffällig schnell getippt im Vergleich zum sonstigen "
                "Tippverhalten dieser Person. Das ist nur ein Indiz (z.B. für Eile, Aufregung "
                "oder Stress), keine Tatsache."
            )
        elif interval_ms >= user.avg_typing_interval_ms * TYPING_ANOMALY_SLOW_RATIO:
            note = (
                "Diese Nachricht wurde auffällig langsam getippt im Vergleich zum sonstigen "
                "Tippverhalten dieser Person. Das ist nur ein Indiz (z.B. für Nachdenklichkeit, "
                "Unsicherheit oder Ablenkung), keine Tatsache."
            )
    weight = min(user.typing_sample_count, TYPING_BASELINE_MAX_WEIGHT)
    previous_avg = user.avg_typing_interval_ms or interval_ms
    user.avg_typing_interval_ms = (previous_avg * weight + interval_ms) / (weight + 1)
    user.typing_sample_count += 1
    return note


def _get_or_create_personality_row(user_id):
    """Looks up (or creates) this user's AiPersonality row. Wrapped
    defensively: AiPersonality is a brand-new table, and on at least one
    deploy it turned out to not actually exist yet on the live Postgres
    database despite db.create_all() running at startup (still
    unexplained -- every other table added this same way, this session,
    came up fine) -- rather than let that 500 the entire chat endpoint
    again, this degrades to "no personality info this turn" and logs the
    real error for the admin dashboard instead. session.rollback() is
    required after a failed query or the whole request's DB session stays
    unusable for anything that runs afterward."""
    try:
        row = AiPersonality.query.filter_by(user_id=user_id).first()
        if row is None:
            row = AiPersonality(user_id=user_id)
            db.session.add(row)
            db.session.commit()
        return row
    except Exception as exc:
        db.session.rollback()
        logger.exception("AiPersonality nicht verfügbar für user_id=%s.", user_id)
        log_error(str(exc), path=request.path, method=request.method, user_id=user_id)
        return None


@app.route("/api/ai/chat", methods=["POST"])
def api_ai_chat():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    context = (data.get("context") or "").strip() or None
    project_type = (
        data.get("project_type")
        if data.get("project_type") in ("game", "webapp", "general", "code", "sevenai", "ehrgeizig", "ruhig", "chaos") else None
    )
    # Which AI character this message belongs to -- see AiChat.character
    # and ai_assistant.py's SEVENAI_SYSTEM_PROMPT. Not trusted blindly for
    # an existing chat (see below, once `chat` is resolved) -- an already-
    # started chat keeps whatever character it was created with, since a
    # chat's persona/history shouldn't be able to flip mid-conversation.
    character = data.get("character") if data.get("character") in ("nex", "sevenai", "nex7") else "nex"
    # Only messages sent through the admin dashboard's dedicated "KI-Wissen"
    # chat become a global fact -- an admin's ordinary chats elsewhere are
    # unaffected, and a non-admin can never set save_as_fact regardless of
    # what the request body claims.
    save_as_fact = bool(data.get("save_as_fact")) and user.is_admin
    chat_id = data.get("chat_id")
    via_voice = bool(data.get("via_voice"))
    if not message:
        return jsonify({"ok": False, "error": "empty_message"}), 400

    # Token check happens before anything is written to the DB, so a
    # rejected message never gets persisted or shows up in chat history.
    is_buddy = False
    if project_type in (None, "general"):
        personality_row_precheck = _get_or_create_personality_row(user.id)
        is_buddy = bool(personality_row_precheck and personality_row_precheck.mimic_user_style)
    is_unlimited_tokens = user_has_unlimited_ai_tokens(user)
    token_cost = _compute_message_token_cost(message, via_voice, is_buddy)
    tokens_available = user.ai_tokens if user.ai_tokens is not None else STARTING_AI_TOKENS
    if not is_unlimited_tokens and tokens_available < token_cost:
        return jsonify({
            "ok": False, "error": "insufficient_tokens",
            "tokens_needed": token_cost, "tokens_available": tokens_available,
        }), 402
    if not is_unlimited_tokens:
        user.ai_tokens = tokens_available - token_cost

    # Optional real signal from the frontend: average ms between keystrokes
    # while typing *this* message (see base.html's keydown tracking) --
    # only used to compare against this same user's own rolling baseline,
    # never against other users, see _update_typing_baseline_and_get_note.
    behavior_note = None
    typing_interval_raw = data.get("typing_avg_interval_ms")
    if isinstance(typing_interval_raw, (int, float)) and TYPING_INTERVAL_MIN_MS <= typing_interval_raw <= TYPING_INTERVAL_MAX_MS:
        behavior_note = _update_typing_baseline_and_get_note(user, float(typing_interval_raw))
    # Set when the user clicked the orb to cut the AI's spoken reply short
    # mid-sentence (see base.html's stopAiSpeaking) -- a one-off aside for
    # this turn only, not a stored fact, so the model can react to actually
    # being interrupted instead of just continuing as if nothing happened.
    if data.get("was_interrupted"):
        interrupted_note = (
            "Der Nutzer hat deine letzte gesprochene Antwort unterbrochen, bevor sie fertig war -- "
            "wie bei einem echten Gespräch: halt dich jetzt etwas kürzer, komm schneller auf den "
            "Punkt, aber erwähne die Unterbrechung selbst nicht extra."
        )
        behavior_note = f"{behavior_note} {interrupted_note}" if behavior_note else interrupted_note

    chat = None
    if chat_id:
        chat = AiChat.query.filter_by(id=chat_id, user_id=user.id).first()
    if chat is None:
        # A chat started via "Neuesten Code-Chat erstellen" (project_type
        # "code", see api_ai_chat's project_type handling) is tagged
        # mode="code" from creation, so reopening it later keeps sending
        # project_type "code" on every message -- see openChat() in
        # base.html, which reads chat.mode back into currentChatMode.
        # `character` (see AiChat.character) is set once at creation from
        # whichever page started the chat (/assistant sends "nex", /7ai
        # sends "sevenai") and never changes afterwards.
        chat = AiChat(user_id=user.id, mode="code" if project_type == "code" else "general", character=character)
        db.session.add(chat)
        db.session.flush()

    is_first_message = len(chat.messages) == 0
    history = [{"role": m.role, "content": m.content} for m in chat.messages]

    db.session.add(AiChatMessage(chat_id=chat.id, role="user", content=message))
    if save_as_fact:
        db.session.add(AiAdminFact(admin_id=user.id, content=message[:ADMIN_FACT_MAX_LENGTH]))
    chat.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    chat_id_captured = chat.id
    user_id_captured = user.id

    facts = [
        f.content for f in
        AiAdminFact.query.order_by(AiAdminFact.created_at.desc()).limit(ADMIN_FACTS_PROMPT_LIMIT).all()
    ]

    # AiLearnedFact/AiPersonality only ever apply in general mode (see
    # ai_assistant.py's module docstring) -- game/webapp DSL prompts stay
    # protected from both, same reasoning as the tool split.
    learned_facts = None
    personality = None
    if project_type in (None, "general"):
        learned_facts = {
            "wikipedia": [
                f.content for f in AiLearnedFact.query.filter_by(source="wikipedia")
                .order_by(AiLearnedFact.created_at.desc()).limit(LEARNED_FACTS_PROMPT_LIMIT).all()
            ],
            "user": [
                f.content for f in AiLearnedFact.query.filter_by(source="user", user_id=user.id)
                .order_by(AiLearnedFact.created_at.desc()).limit(USER_FACTS_PROMPT_LIMIT).all()
            ],
            "docs": [
                f.content for f in AiLearnedFact.query.filter_by(source="python_docs")
                .order_by(AiLearnedFact.created_at.desc()).limit(LEARNED_FACTS_PROMPT_LIMIT).all()
            ],
        }
        personality_row = personality_row_precheck
        if personality_row is not None:
            personality = {
                "intelligence": personality_row.intelligence, "humor": personality_row.humor,
                "caution": personality_row.caution, "arrogance": personality_row.arrogance,
                "mimic_user_style": personality_row.mimic_user_style,
            }
    else:
        behavior_note = None

    def on_done(reply, error, proposed_change, new_learned_facts):
        with app.app_context():
            if reply:
                db.session.add(AiChatMessage(chat_id=chat_id_captured, role="assistant", content=reply))
                for fact in (new_learned_facts or {}).get("wikipedia", []):
                    db.session.add(AiLearnedFact(source="wikipedia", content=fact))
                for fact in (new_learned_facts or {}).get("user", []):
                    db.session.add(AiLearnedFact(source="user", content=fact, user_id=user_id_captured))
                adjustments = (new_learned_facts or {}).get("personality_adjustments") or []
                if adjustments:
                    personality_row = _get_or_create_personality_row(user_id_captured)
                    if personality_row is not None:
                        for trait, step in adjustments:
                            current = getattr(personality_row, trait)
                            setattr(personality_row, trait, max(0, min(100, current + step * 3)))
                        personality_row.updated_at = datetime.now(timezone.utc)
                # Image generation is the AI's own tool-call decision made
                # mid-reply, so its cost is only known/charged here, after
                # the fact -- generate_image already refused if the balance
                # (checked live via available_tokens) was too low, this is
                # just applying the charge for one that actually ran.
                image_generated = (new_learned_facts or {}).get("image_generated")
                audio_generated = (new_learned_facts or {}).get("audio_generated")
                if image_generated and not is_unlimited_tokens:
                    image_user_row = db.session.get(User, user_id_captured)
                    if image_user_row is not None:
                        image_user_row.ai_tokens = max(
                            0, (image_user_row.ai_tokens or 0) - ai_assistant.IMAGE_TOKEN_COST,
                        )
                if audio_generated and not is_unlimited_tokens:
                    audio_user_row = db.session.get(User, user_id_captured)
                    if audio_user_row is not None:
                        audio_user_row.ai_tokens = max(
                            0, (audio_user_row.ai_tokens or 0) - ai_assistant.AUDIO_TOKEN_COST,
                        )
                # Kept as its own record (in addition to being embedded
                # inline in the reply above) purely so the "Galerie" page
                # can list everything generated without re-parsing chats.
                if image_generated:
                    db.session.add(AiGeneratedMedia(
                        user_id=user_id_captured, kind="image",
                        url=image_generated.get("url", ""), prompt=image_generated.get("prompt"),
                    ))
                if audio_generated:
                    db.session.add(AiGeneratedMedia(
                        user_id=user_id_captured, kind="audio",
                        url=audio_generated.get("url", ""), prompt=audio_generated.get("text"),
                    ))
                db.session.commit()
                if is_first_message:
                    # Fired off as its own background thread rather than
                    # awaited here -- generate_title() is a whole separate
                    # model call, and with the local model (see
                    # ai_assistant.py) that alone can take several seconds.
                    # Blocking on it here would delay the job's "done"
                    # status -- and therefore the reply the user is
                    # actually waiting for -- by that same amount, even
                    # though the reply itself was ready already. The title
                    # just applies a moment later instead; nothing reads it
                    # synchronously off this same request.
                    def _apply_title():
                        try:
                            title = ai_assistant.generate_title(message)
                            if title:
                                with app.app_context():
                                    chat_row = db.session.get(AiChat, chat_id_captured)
                                    if chat_row is not None:
                                        chat_row.title = title
                                        db.session.commit()
                        except Exception:
                            logger.exception("Chat-Titel konnte im Hintergrund nicht gesetzt werden.")

                    threading.Thread(target=_apply_title, daemon=True).start()
            elif error:
                # A Groq outage/rate limit/bad key fails silently from the
                # user's perspective (they just see "KI gerade nicht
                # verfügbar") -- this is the background-thread equivalent
                # of the global error handler, since nothing here ever
                # raises into a request handler for that to catch.
                log_error(error, path="/api/ai/chat", method="POST", user_id=user_id_captured)

    job_id = ai_assistant.start_chat_job(
        message, context, history=history, project_type=project_type, facts=facts,
        learned_facts=learned_facts, on_done=on_done, behavior_note=behavior_note,
        personality=personality, available_tokens=None if is_unlimited_tokens else user.ai_tokens,
        synthesize_audio_fn=_synthesize_and_store_audio,
    )
    return jsonify({
        "ok": True, "job_id": job_id, "chat_id": chat.id, "tokens_remaining": user.ai_tokens,
    })


@app.route("/api/ai/chat/<job_id>")
def api_ai_chat_status(job_id):
    # No login check: job_id is a random uuid4, already an unguessable
    # capability token on its own (this was true even before the guest
    # chat existed -- get_job_status() never scoped by user either) -- so
    # this same route can safely also serve /api/ai/guest-chat's polling.
    job = ai_assistant.get_job_status(job_id)
    if job is None:
        return jsonify({"ok": False, "error": "not_found"}), 404
    return jsonify({"ok": True, **job})


@app.route("/api/ai/feedback", methods=["POST"])
def api_ai_feedback():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()[:2000]
    reply = (data.get("reply") or "").strip()[:4000]
    rating = data.get("rating")
    if rating not in (1, -1) or not message or not reply:
        return jsonify({"ok": False, "error": "invalid_feedback"}), 400

    db.session.add(AiChatFeedback(user_id=user.id, message=message, reply=reply, rating=rating))
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/ai/buddy-mode", methods=["POST"])
def api_ai_buddy_mode():
    """"Buddy"-Umschalter aus der Sidebar (siehe base.html's Bestätigungs-
    Dialog) -- setzt AiPersonality.mimic_user_style für diesen Nutzer, kein
    zurück-Schalten aus der UI vorgesehen (kann über "Mein KI-Profil
    löschen" zurückgesetzt werden)."""
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    personality_row = _get_or_create_personality_row(user.id)
    if personality_row is None:
        return jsonify({"ok": False, "error": "unavailable"}), 500
    personality_row.mimic_user_style = True
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/voice-profile/status")
def api_voice_profile_status():
    profiles = AiVoiceProfile.query.all()
    return jsonify({
        "ok": True,
        "profiles": {
            p.gender: {
                "cloned": bool(p.elevenlabs_voice_id),
                "contributor": p.contributor.username if p.contributor else None,
            }
            for p in profiles
        },
    })


@app.route("/api/voice-profile/<gender>/contribute", methods=["POST"])
def api_voice_profile_contribute(gender):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    if gender not in VOICE_PROFILE_GENDERS:
        return jsonify({"ok": False, "error": "invalid_gender"}), 400
    if not USE_ELEVENLABS:
        return jsonify({
            "ok": False, "error": "not_configured",
            "message": "Stimmen-Klonen ist auf dieser Seite gerade nicht eingerichtet.",
        }), 400

    file = request.files.get("sample")
    if not file or not file.filename:
        return jsonify({"ok": False, "error": "no_file", "message": "Keine Sprachaufnahme erhalten."}), 400

    profile = AiVoiceProfile.query.filter_by(gender=gender).first()
    old_voice_id = profile.elevenlabs_voice_id if profile else None

    try:
        new_voice_id = elevenlabs_clone_voice(
            f"NexAI-{gender}-{user.username}", file.stream.read(), file.mimetype,
        )
    except Exception:
        logger.exception("ElevenLabs-Stimmenklon fehlgeschlagen.")
        return jsonify({
            "ok": False, "error": "clone_failed",
            "message": "Die Stimme konnte nicht geklont werden. Versuch es später erneut.",
        }), 502

    if profile is None:
        profile = AiVoiceProfile(gender=gender)
        db.session.add(profile)
    profile.elevenlabs_voice_id = new_voice_id
    profile.contributor_id = user.id
    profile.updated_at = datetime.now(timezone.utc)
    db.session.commit()

    if old_voice_id:
        elevenlabs_delete_voice(old_voice_id)

    return jsonify({"ok": True})


@app.route("/api/voice-profile/<gender>/speak", methods=["POST"])
def api_voice_profile_speak(gender):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    if gender not in VOICE_PROFILE_GENDERS:
        return jsonify({"ok": False, "error": "invalid_gender"}), 400

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()[:2000]
    if not text:
        return jsonify({"ok": False, "error": "empty_text"}), 400

    profile = AiVoiceProfile.query.filter_by(gender=gender).first()
    if profile is None or not profile.elevenlabs_voice_id:
        return jsonify({"ok": False, "error": "no_cloned_voice"}), 404

    try:
        audio_bytes = elevenlabs_text_to_speech(profile.elevenlabs_voice_id, text)
    except Exception:
        logger.exception("ElevenLabs-Sprachausgabe fehlgeschlagen.")
        return jsonify({"ok": False, "error": "speech_failed"}), 502

    return Response(audio_bytes, mimetype="audio/mpeg")


if __name__ == "__main__":
    app.run(debug=True)

