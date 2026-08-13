import os
import io
import sys
import uuid
import shutil
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
from models import (
    db, User, Subscription, UserCreatedCode, Conversation, ConversationMember, Message,
    AiChatFeedback, AiChat, AiChatMessage, AiAdminFact, AiLearnedFact, PasswordResetCode,
    AccountRecoveryRequest, ErrorLog,
    AiVoiceProfile, AiPersonality, AiGeneratedMedia,
    AiTrainingExample, AiTrainingRun,
    Offer, OFFER_CATEGORIES, OFFER_CATEGORY_LABELS,
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
    if kind == "posts":
        return url_for("post_photo_file", filename=stored_filename)
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
        ],
        # ai_personality itself is created fresh by db.create_all() on any
        # brand-new database, but on one that already had the table from
        # before mimic_user_style existed on the model, create_all() never
        # goes back to add it -- same class of gap this whole function
        # exists to self-heal for every other table.
        "ai_personality": [("mimic_user_style", "BOOLEAN NOT NULL DEFAULT 0")],
        "ai_generated_media": [("liked", "BOOLEAN NOT NULL DEFAULT 0")],
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

    # Re-applies the curated offer list (seed_data.py) on every startup, so
    # every deploy -- i.e. every git push, which Railway rebuilds and
    # restarts -- keeps the live database (and therefore both the web app
    # and the desktop app, which just displays that same live site) in sync
    # with whatever offers are defined there. Each insert there is guarded
    # by its own existence check, so this is safe to re-run every time.
    # Skipped under pytest so test runs don't pollute the throwaway test DB.
    if "pytest" not in sys.modules:
        try:
            import seed_data
            seed_data.seed_offers()
        except Exception:
            logger.exception("Angebote konnten beim Start nicht automatisch geladen werden.")

    # Pre-warms the local AI model (download + load, ~1 GB, see
    # local_ai.py) in the background at startup instead of leaving it to
    # happen lazily on whichever user's chat request is first -- that
    # request would otherwise eat the full download+load time itself and
    # risk the gunicorn worker's own request timeout. Runs in a daemon
    # thread so a slow/failed download never blocks the app from starting;
    # get_llama() is called again (and just returns the cached instance)
    # on the first real chat request either way. Skipped under pytest --
    # loading a real ~1.5 GB model would eat CPU throughout the whole test
    # run and race with tests that assume a mocked generate_reply()
    # completes near-instantly.
    if "pytest" not in sys.modules:
        def _prewarm_local_ai():
            try:
                local_ai.get_llama()
            except Exception:
                logger.exception("Lokales KI-Modell konnte beim Start nicht vorgeladen werden.")

        threading.Thread(target=_prewarm_local_ai, daemon=True).start()

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
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return db.session.get(User, user_id)


@app.context_processor
def inject_cheaper_globals():
    """A safety net for cheaper_base.html's templates, most of which also
    get `user` passed explicitly per-route like the rest of the app --
    this just means a template never hard-crashes with an undefined `user`
    if a route forgets to. is_app_context flags a request coming from the
    Electron desktop wrapper (see cheaper-desktop/), which sends this
    header so the page can skip the "download the app" banner."""
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
    user = current_user()
    log_error(
        exc, path=request.path, method=request.method,
        tb=traceback.format_exc(), user_id=user.id if user else None,
    )
    return render_template("500.html", user=user), 500


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
    return user.username in UNLIMITED_AI_TOKENS_USERNAMES


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
    # logged out constantly (backgrounding the browser, restarting the
    # phone, etc.). Marking the session permanent + a long lifetime above
    # gives it a real expiry date instead, and Flask refreshes that expiry
    # on every request by default, so active users effectively never expire.
    session.permanent = True


TERMS_ALLOWED_ENDPOINTS = {
    "terms_page", "terms_accept", "terms_decline", "terms_declined_page",
    "logout", "static", "service_worker", "offline_page",
}

# Bump this whenever terms.html's actual content changes -- it forces
# EVERY registered account (not just new signups) back through the terms
# gate on their next request, since User.terms_accepted_version no longer
# matches. Anonymous visitors go through the session-based path below
# regardless of this number (a fresh browser session always sees the
# current terms once anyway).
TERMS_VERSION = 4


@app.before_request
def require_terms_acceptance():
    """Shown before anything else on the site, for every visitor -- logged
    in or not. Acceptance is tracked per-account (User.terms_accepted_at
    plus terms_accepted_version, see TERMS_VERSION) once logged in, or
    per-browser-session before that; declining logs a logged-in user out
    too, since continuing a session while "not agreeing" would be
    contradictory. Re-triggers for an already-accepted account whenever
    TERMS_VERSION has moved past what that account last accepted -- an
    old acceptance doesn't carry over to genuinely changed terms."""
    if request.endpoint is None or request.endpoint in TERMS_ALLOWED_ENDPOINTS:
        return
    if request.path.startswith("/api/"):
        return  # redirecting a JSON/fetch call to an HTML page makes no sense
    user = current_user()
    if user is not None:
        if user.terms_accepted_at is None or user.terms_accepted_version != TERMS_VERSION:
            return redirect(url_for("terms_page"))
    elif not session.get("terms_accepted"):
        return redirect(url_for("terms_page"))


LOGIN_GATE_ALLOWED_ENDPOINTS = {
    "login", "register", "register_company", "agb_page",
    "logout", "static", "service_worker", "offline_page",
    "forgot_password", "forgot_password_email", "forgot_password_verify",
    "forgot_password_help",
} | TERMS_ALLOWED_ENDPOINTS


@app.before_request
def require_login_everywhere():
    """The entire site is login-only now -- an anonymous visitor can reach
    nothing except the login/register/password-recovery pages (and the
    terms gate, already handled by require_terms_acceptance above). There
    is deliberately no more guest browsing of any kind (no guest AI chat,
    no public game gallery -- games themselves are gone too, see the
    module-level notes near index())."""
    if request.endpoint is None or request.endpoint in LOGIN_GATE_ALLOWED_ENDPOINTS:
        return
    if current_user() is not None:
        return
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    return redirect(url_for("login"))


PROFILE_COMPLETION_ALLOWED_ENDPOINTS = {
    "complete_profile", "logout", "login", "register", "static",
    "service_worker", "offline_page",
} | TERMS_ALLOWED_ENDPOINTS


@app.before_request
def require_profile_completion():
    if request.endpoint is None or request.endpoint in PROFILE_COMPLETION_ALLOWED_ENDPOINTS:
        return
    if request.path.startswith("/api/"):
        return  # redirecting a JSON/fetch call to an HTML page makes no sense
    user = current_user()
    if user is not None and user_needs_onboarding(user):
        return redirect(url_for("complete_profile"))


@app.route("/terms")
def terms_page():
    return render_template("terms.html", user=current_user())


@app.route("/terms/accept", methods=["POST"])
def terms_accept():
    user = current_user()
    if user is not None:
        user.terms_accepted_at = datetime.now(timezone.utc)
        user.terms_accepted_version = TERMS_VERSION
        db.session.commit()
    else:
        session["terms_accepted"] = True
    return redirect(url_for("index"))


@app.route("/terms/decline", methods=["POST"])
def terms_decline():
    session.pop("user_id", None)
    session.pop("terms_accepted", None)
    return redirect(url_for("terms_declined_page"))


@app.route("/terms/declined")
def terms_declined_page():
    return render_template("terms_declined.html", user=None)


@app.route("/agb")
def agb_page():
    # Retired in favor of the comprehensive /terms page -- kept as a
    # redirect so old links (e.g. in the Web-in-Web-App editor settings
    # panel) don't break.
    return redirect(url_for("terms_page"))


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


CHEAPER_SUGGESTION_CHIPS = [
    "Kino in der Nähe", "Schwimmbad", "Fast Food", "Freizeitpark", "Bowling", "Escape Room",
]


def offers_query(category=None, q=None):
    query = Offer.query.filter_by(is_active=True)
    if category:
        query = query.filter_by(category=category)
    if q:
        like = f"%{q}%"
        query = query.filter(db.or_(Offer.provider_name.ilike(like), Offer.title.ilike(like)))
    return query


def sort_offers_by_city(offers, city):
    """Offers in the visitor's own city (from their profile, or from live
    browser geolocation reverse-geocoded client-side, see the JS in
    home.html) are shown first -- everything else keeps its normal order
    after that. No distance math: without a paid geocoding API this is a
    plain, honest city-name match, not real proximity sorting."""
    city_lower = (city or "").strip().lower()
    if not city_lower:
        return offers

    def matches(offer):
        offer_city = (offer.city or "").strip().lower()
        return bool(offer_city) and (offer_city in city_lower or city_lower in offer_city)

    matching = [o for o in offers if matches(o)]
    matching_ids = {o.id for o in matching}
    rest = [o for o in offers if o.id not in matching_ids]
    return matching + rest


@app.route("/")
def index():
    """Cheaper's homepage: search + category filter + offer cards, sorted
    to favor the visitor's own city (profile city, or a live browser
    geolocation lookup, see resolved_city below) when known. Prices shown
    already reflect this visitor's own age-based discount, see
    Offer.price_for()."""
    user = current_user()
    q = (request.args.get("q") or "").strip()
    category = (request.args.get("category") or "").strip()
    if category not in OFFER_CATEGORIES:
        category = ""
    resolved_city = (request.args.get("city") or "").strip() or (user.city if user else "")

    offers = offers_query(category or None, q or None).order_by(Offer.created_at.desc()).all()
    offers = sort_offers_by_city(offers, resolved_city)

    user_age = compute_age(user.birthdate) if user and user.birthdate else None
    offer_cards = []
    for offer in offers:
        price_cents, is_discounted = offer.price_for(user_age)
        offer_cards.append({
            "offer": offer,
            "price": price_cents / 100,
            "normal_price": offer.normal_price_cents / 100,
            "is_discounted": is_discounted,
            "savings": (offer.normal_price_cents - price_cents) / 100 if is_discounted else 0,
        })

    return render_template(
        "home.html", user=user, offer_cards=offer_cards, q=q, category=category,
        categories=OFFER_CATEGORIES, category_labels=OFFER_CATEGORY_LABELS,
        chips=CHEAPER_SUGGESTION_CHIPS, resolved_city=resolved_city,
    )


def parse_onboarding_fields(form):
    """Shared between /register and /complete-profile: purpose of use,
    country, region (or explicit skip), and a guardian email that's
    required under 18 and merely offered/recommended at 18+."""
    return {
        "purpose_of_use": (form.get("purpose_of_use") or "").strip(),
        "country": (form.get("country") or "").strip(),
        "region": (form.get("region") or "").strip(),
        "region_skipped": form.get("region_skipped") == "1",
        "guardian_email": (form.get("guardian_email") or "").strip(),
    }


def validate_onboarding_fields(fields):
    """The e-mail (guardian's, for a minor; the user's own, for an adult)
    is always optional-but-recommended -- never required, regardless of
    age. "Diese letzten beiden Fragen möchte ich nicht beantworten" refers
    to country + region together, for everyone; skipping it must bypass
    both, not just region."""
    if fields["purpose_of_use"] not in PURPOSE_CHOICES:
        return "Bitte angeben, wofür du den Account nutzt."
    if not fields["country"] and not fields["region_skipped"]:
        return "Bitte ein Land angeben oder die Frage überspringen."
    if not fields["region"] and not fields["region_skipped"]:
        return "Bitte ein Bundesland angeben oder die Frage überspringen."
    if fields["guardian_email"] and "@" not in fields["guardian_email"]:
        return "Bitte eine gültige E-Mail-Adresse angeben."
    return None


def apply_onboarding_fields(user, fields):
    user.purpose_of_use = fields["purpose_of_use"]
    user.country = fields["country"] or None
    user.region = fields["region"] or None
    user.region_skipped = fields["region_skipped"] and not fields["region"]
    user.guardian_email = fields["guardian_email"] or None


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        password2 = request.form.get("password2", "")
        birthdate_raw = request.form.get("birthdate", "").strip()
        gender = request.form.get("gender", "").strip()
        onboarding = parse_onboarding_fields(request.form)

        def rerender(error):
            flash(error)
            return render_template("register.html", form_values=request.form)

        if not username or not password or not password2 or not birthdate_raw or not gender:
            return rerender("Bitte alle Felder ausfüllen.")
        if password != password2:
            return rerender("Die Passwörter stimmen nicht überein.")
        if gender not in GENDER_CHOICES:
            return rerender("Bitte ein gültiges Geschlecht auswählen.")
        try:
            birthdate = datetime.strptime(birthdate_raw, "%Y-%m-%d").date()
        except ValueError:
            return rerender("Bitte ein gültiges Geburtsdatum angeben.")
        if birthdate > date.today():
            return rerender("Das Geburtsdatum darf nicht in der Zukunft liegen.")

        age = compute_age(birthdate)
        if age < MIN_REGISTRATION_AGE:
            return rerender(f"Du musst mindestens {MIN_REGISTRATION_AGE} Jahre alt sein, um dich zu registrieren.")

        onboarding_error = validate_onboarding_fields(onboarding)
        if onboarding_error:
            return rerender(onboarding_error)

        if User.query.filter_by(username=username).first():
            return rerender("Dieser Benutzername ist bereits vergeben.")

        user = User(username=username, birthdate=birthdate, gender=gender)
        user.city = (request.form.get("city") or "").strip()
        user.set_password(password)
        apply_onboarding_fields(user, onboarding)
        # Reaching this form at all already required accepting the terms
        # gate as an anonymous visitor (it blocks GET /register otherwise)
        # -- carry that acceptance onto the new account itself, or the
        # terms gate would immediately re-trigger on the very next request
        # since a fresh User's terms_accepted_at is still None.
        user.terms_accepted_at = datetime.now(timezone.utc)
        user.terms_accepted_version = TERMS_VERSION
        db.session.add(user)
        db.session.commit()
        # The only e-mail actually collected during registration itself is
        # the guardian's (the account owner's own address is set later, in
        # account settings) -- so that's who gets the welcome notice here.
        if user.guardian_email:
            send_email_best_effort(
                user.guardian_email, "Willkommen bei Cheaper",
                f"Hallo,\n\n"
                f"für {user.username} wurde gerade ein Cheaper-Konto erstellt. Diese E-Mail-Adresse "
                "wurde bei der Registrierung als Kontakt eines Erziehungsberechtigten angegeben.\n\n"
                "Das Cheaper-Team",
            )
        session["user_id"] = user.id
        return redirect(url_for("index"))
    return render_template("register.html")


@app.route("/register-firma", methods=["GET", "POST"])
def register_company():
    """A business account: no birthdate/gender/onboarding (those only make
    sense for a customer whose age drives discounts) -- just credentials
    plus the two fields the offers table actually needs, company_address
    mandatory per the product's own requirement that every listed offer be
    traceable to a real, named business."""
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        password2 = request.form.get("password2", "")
        company_name = request.form.get("company_name", "").strip()
        company_address = request.form.get("company_address", "").strip()
        email = request.form.get("email", "").strip()

        def rerender(error):
            flash(error)
            return render_template("register_company.html", form_values=request.form)

        if not username or not password or not password2 or not company_name or not company_address:
            return rerender("Bitte alle Pflichtfelder ausfüllen (Firmensitz ist Pflicht).")
        if password != password2:
            return rerender("Die Passwörter stimmen nicht überein.")
        if User.query.filter_by(username=username).first():
            return rerender("Dieser Benutzername ist bereits vergeben.")
        if email and User.query.filter_by(email=email).first():
            return rerender("Diese E-Mail-Adresse wird bereits verwendet.")

        user = User(
            username=username, is_company=True, company_name=company_name,
            company_address=company_address, email=email or None,
        )
        user.set_password(password)
        user.terms_accepted_at = datetime.now(timezone.utc)
        user.terms_accepted_version = TERMS_VERSION
        db.session.add(user)
        db.session.commit()
        session["user_id"] = user.id
        return redirect(url_for("company_dashboard"))
    return render_template("register_company.html")


def require_company():
    user = current_user()
    if user is None or not user.is_company:
        abort(403)
    return user


@app.route("/firma/angebote")
def company_dashboard():
    user = require_company()
    offers = Offer.query.filter_by(company_id=user.id).order_by(Offer.created_at.desc()).all()
    return render_template(
        "company_dashboard.html", user=user, offers=offers,
        categories=OFFER_CATEGORIES, category_labels=OFFER_CATEGORY_LABELS,
    )


def _apply_offer_form(offer, form):
    offer.provider_name = (form.get("provider_name") or "").strip()
    offer.title = (form.get("title") or "").strip()
    offer.category = form.get("category") if form.get("category") in OFFER_CATEGORIES else "sonstiges"
    offer.description = (form.get("description") or "").strip() or None
    offer.image_url = (form.get("image_url") or "").strip() or None
    offer.link_url = (form.get("link_url") or "").strip()
    offer.city = (form.get("city") or "").strip() or None
    offer.discount_label = (form.get("discount_label") or "").strip() or None

    def to_cents(value):
        try:
            return round(float(str(value).replace(",", ".")) * 100)
        except (TypeError, ValueError):
            return None

    offer.normal_price_cents = to_cents(form.get("normal_price")) or 0
    discount_price = to_cents(form.get("discount_price"))
    offer.discount_price_cents = discount_price
    max_age_raw = (form.get("discount_max_age") or "").strip()
    offer.discount_max_age = int(max_age_raw) if max_age_raw.isdigit() else None


@app.route("/firma/angebote/neu", methods=["GET", "POST"])
def company_offer_new():
    user = require_company()
    if request.method == "POST":
        offer = Offer(company_id=user.id)
        _apply_offer_form(offer, request.form)
        if not offer.provider_name or not offer.title or not offer.link_url or not offer.normal_price_cents:
            flash("Bitte Anbieter, Titel, Link und Normalpreis ausfüllen.")
            return render_template("company_offer_form.html", user=user, offer=None, form_values=request.form, categories=OFFER_CATEGORIES, category_labels=OFFER_CATEGORY_LABELS)
        db.session.add(offer)
        db.session.commit()
        flash("Angebot erstellt.")
        return redirect(url_for("company_dashboard"))
    return render_template("company_offer_form.html", user=user, offer=None, form_values=None, categories=OFFER_CATEGORIES, category_labels=OFFER_CATEGORY_LABELS)


@app.route("/firma/angebote/<int:offer_id>/bearbeiten", methods=["GET", "POST"])
def company_offer_edit(offer_id):
    user = require_company()
    offer = Offer.query.get_or_404(offer_id)
    if offer.company_id != user.id:
        abort(403)
    if request.method == "POST":
        _apply_offer_form(offer, request.form)
        if not offer.provider_name or not offer.title or not offer.link_url or not offer.normal_price_cents:
            flash("Bitte Anbieter, Titel, Link und Normalpreis ausfüllen.")
            return render_template("company_offer_form.html", user=user, offer=offer, form_values=request.form, categories=OFFER_CATEGORIES, category_labels=OFFER_CATEGORY_LABELS)
        db.session.commit()
        flash("Angebot aktualisiert.")
        return redirect(url_for("company_dashboard"))
    return render_template("company_offer_form.html", user=user, offer=offer, form_values=None, categories=OFFER_CATEGORIES, category_labels=OFFER_CATEGORY_LABELS)


@app.route("/firma/angebote/<int:offer_id>/loeschen", methods=["POST"])
def company_offer_delete(offer_id):
    user = require_company()
    offer = Offer.query.get_or_404(offer_id)
    if offer.company_id != user.id:
        abort(403)
    db.session.delete(offer)
    db.session.commit()
    flash("Angebot gelöscht.")
    return redirect(url_for("company_dashboard"))


@app.route("/firma/angebote/<int:offer_id>/toggle", methods=["POST"])
def company_offer_toggle(offer_id):
    user = require_company()
    offer = Offer.query.get_or_404(offer_id)
    if offer.company_id != user.id:
        abort(403)
    offer.is_active = not offer.is_active
    db.session.commit()
    return redirect(url_for("company_dashboard"))


@app.route("/complete-profile", methods=["GET", "POST"])
def complete_profile():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    if not user_needs_onboarding(user):
        return redirect(url_for("index"))

    if request.method == "POST":
        onboarding = parse_onboarding_fields(request.form)
        birthdate = user.birthdate
        gender = user.gender

        def rerender(error):
            flash(error)
            return render_template("complete_profile.html", user=user, form_values=request.form)

        if user.birthdate is None:
            birthdate_raw = (request.form.get("birthdate") or "").strip()
            try:
                birthdate = datetime.strptime(birthdate_raw, "%Y-%m-%d").date()
            except ValueError:
                return rerender("Bitte ein gültiges Geburtsdatum angeben.")
            if birthdate > date.today():
                return rerender("Das Geburtsdatum darf nicht in der Zukunft liegen.")

        if user.gender is None:
            gender = (request.form.get("gender") or "").strip()
            if gender not in GENDER_CHOICES:
                return rerender("Bitte ein gültiges Geschlecht auswählen.")

        age = compute_age(birthdate)
        if age < MIN_REGISTRATION_AGE:
            return rerender(f"Du musst mindestens {MIN_REGISTRATION_AGE} Jahre alt sein.")

        onboarding_error = validate_onboarding_fields(onboarding)
        if onboarding_error:
            return rerender(onboarding_error)

        user.birthdate = birthdate
        user.gender = gender
        apply_onboarding_fields(user, onboarding)
        db.session.commit()
        return redirect(url_for("index"))

    return render_template("complete_profile.html", user=user)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            session["user_id"] = user.id
            return redirect(url_for("index"))
        flash("Benutzername oder Passwort ist falsch.")
    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    session.pop("user_id", None)
    return redirect(url_for("index"))


OTP_EXPIRY_MINUTES = 15


def _issue_reset_code(user):
    code = f"{secrets.randbelow(1_000_000):06d}"
    db.session.add(PasswordResetCode(
        user_id=user.id, code=code,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRY_MINUTES),
    ))
    db.session.commit()
    return code


@app.route("/forgot-password")
def forgot_password():
    return render_template("forgot_password.html")


@app.route("/forgot-password/email", methods=["GET", "POST"])
def forgot_password_email():
    if request.method == "POST":
        email = (request.form.get("email") or "").strip()
        user = User.query.filter_by(email=email).first() if email else None
        if user is not None:
            code = _issue_reset_code(user)
            try:
                send_email(
                    email, "Dein NexAI-Code",
                    f"Dein Code lautet: {code}\nEr ist {OTP_EXPIRY_MINUTES} Minuten gültig.",
                )
            except Exception:
                logger.exception("Passwort-Code-E-Mail konnte nicht verschickt werden.")
                flash("Die E-Mail konnte gerade nicht verschickt werden. Bitte später erneut versuchen.")
                return redirect(url_for("forgot_password_email"))
            session["recovery_user_id"] = user.id
        # Same redirect regardless of a match -- this is an account-
        # enumeration safeguard, so a stranger can't use this form to
        # learn whether a given email address has an account here.
        flash("Falls diese E-Mail-Adresse bei uns hinterlegt ist, wurde ein Code verschickt.")
        return redirect(url_for("forgot_password_verify"))
    return render_template("forgot_password_email.html")


@app.route("/forgot-password/verify", methods=["GET", "POST"])
def forgot_password_verify():
    if request.method == "POST":
        user_id = session.get("recovery_user_id")

        if request.form.get("action") == "resend":
            if user_id:
                user = db.session.get(User, user_id)
                if user is not None and user.email:
                    code = _issue_reset_code(user)
                    try:
                        send_email(
                            user.email, "Dein neuer NexAI-Code",
                            f"Dein neuer Code lautet: {code}\nEr ist {OTP_EXPIRY_MINUTES} Minuten gültig.",
                        )
                    except Exception:
                        logger.exception("Erneuter Code konnte nicht verschickt werden.")
            flash("Falls ein Code angefordert werden konnte, wurde ein neuer verschickt.")
            return redirect(url_for("forgot_password_verify"))

        code = (request.form.get("code") or "").strip()
        new_password = request.form.get("new_password") or ""
        new_password2 = request.form.get("new_password2") or ""
        if not code or not new_password:
            flash("Bitte Code und neues Passwort angeben.")
            return redirect(url_for("forgot_password_verify"))
        if new_password != new_password2:
            flash("Die Passwörter stimmen nicht überein.")
            return redirect(url_for("forgot_password_verify"))

        # The email flow already knows which account this is (set in
        # session by /forgot-password/email) -- someone redeeming a code
        # an admin approved for them never went through that route in
        # this browser session, so they identify their account by
        # username instead (they already typed it once, on the "Eine
        # Mail an unser Team schicken" form).
        if user_id is None:
            typed_username = (request.form.get("username") or "").strip()
            typed_user = User.query.filter_by(username=typed_username).first() if typed_username else None
            if typed_user is not None:
                user_id = typed_user.id

        reset_code = None
        if user_id:
            reset_code = PasswordResetCode.query.filter_by(
                user_id=user_id, code=code, used=False,
            ).filter(PasswordResetCode.expires_at > datetime.now(timezone.utc)) \
                .order_by(PasswordResetCode.created_at.desc()).first()
        if reset_code is None:
            flash("Der Code ist ungültig oder abgelaufen.")
            return redirect(url_for("forgot_password_verify"))

        target_user = db.session.get(User, user_id)
        target_user.set_password(new_password)
        reset_code.used = True
        db.session.commit()
        session.pop("recovery_user_id", None)
        session["user_id"] = target_user.id
        flash("Dein Passwort wurde geändert.")
        return redirect(url_for("index"))

    return render_template("forgot_password_verify.html")


@app.route("/forgot-password/help", methods=["GET", "POST"])
def forgot_password_help():
    if request.method == "POST":
        submitted_username = (request.form.get("username") or "").strip()[:50]
        message = (request.form.get("message") or "").strip()[:1000]
        matched_user = User.query.filter_by(username=submitted_username).first() if submitted_username else None
        db.session.add(AccountRecoveryRequest(
            user_id=matched_user.id if matched_user else None,
            submitted_username=submitted_username or None,
            message=message or None,
        ))
        db.session.commit()
        flash("Deine Anfrage wurde an unser Team gesendet.")
        return redirect(url_for("login"))
    return render_template("forgot_password_help.html")


@app.route("/admin/recovery/<int:request_id>/approve", methods=["POST"])
def admin_approve_recovery(request_id):
    require_admin()
    recovery = db.get_or_404(AccountRecoveryRequest, request_id)
    if recovery.user_id is None:
        flash("Zu dieser Anfrage konnte kein Konto gefunden werden.")
        return redirect(url_for("admin_dashboard"))
    user = db.session.get(User, recovery.user_id)
    code = _issue_reset_code(user)
    recovery.status = "approved"
    recovery.resolved_at = datetime.now(timezone.utc)
    db.session.commit()
    flash(f"Code für {user.username}: {code} ({OTP_EXPIRY_MINUTES} Minuten gültig) -- dem Nutzer manuell mitteilen.")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/recovery/<int:request_id>/deny", methods=["POST"])
def admin_deny_recovery(request_id):
    require_admin()
    recovery = db.get_or_404(AccountRecoveryRequest, request_id)
    recovery.status = "denied"
    recovery.resolved_at = datetime.now(timezone.utc)
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


@app.route("/assistant")
def assistant_page():
    # The AI chat is no longer shown anywhere in the UI (see index()'s
    # docstring) -- its own code, routes, and data are all still fully
    # intact underneath, this page just isn't linked from or reachable
    # through normal navigation anymore.
    return redirect(url_for("index"))


@app.route("/galerie")
def ai_gallery():
    return redirect(url_for("index"))


@app.route("/api/ai/gallery/<int:item_id>/like", methods=["POST"])
def api_ai_gallery_like(item_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    item = db.session.get(AiGeneratedMedia, item_id)
    if item is None or item.user_id != user.id:
        abort(404)
    item.liked = not item.liked
    # Feeds straight into the same private per-user profile remember_user_fact
    # writes to (see AiLearnedFact/_learned_facts_addendum in ai_assistant.py)
    # -- a like becomes a concrete style preference the AI actually sees
    # before its next reply, not just a silent counter nobody reads.
    if item.liked:
        kind_label = "Bild" if item.kind == "image" else "Sprachnachricht"
        note = f"Mag das KI-generierte {kind_label} in der Galerie"
        if item.prompt:
            note += f" mit der Beschreibung: \"{item.prompt[:300]}\""
        note += " -- beim nächsten Erzeugen von Ähnlichem gerne an diesem Stil orientieren."
        db.session.add(AiLearnedFact(source="user", content=note, user_id=user.id))
    db.session.commit()
    return jsonify({"ok": True, "liked": item.liked})


def serialize_ai_chat(chat):
    return {
        "id": chat.id,
        "title": chat.title or "Neuer Chat",
        "mode": chat.mode,
        "specialize_prompted": chat.specialize_prompted,
        "updated_at": chat.updated_at.strftime("%d.%m.%Y %H:%M"),
    }


@app.route("/api/ai/chats")
def api_ai_list_chats():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    chats = AiChat.query.filter_by(user_id=user.id).order_by(AiChat.updated_at.desc()).all()
    return jsonify({"ok": True, "chats": [serialize_ai_chat(c) for c in chats]})


@app.route("/api/ai/chats", methods=["POST"])
def api_ai_create_chat():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    chat = AiChat(user_id=user.id)
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

# The homepage's anonymous trial chat (see index()/guest_home.html): a
# short, unauthenticated taste of the AI before the register/login prompt
# takes over. session["guest_chat_count"] is a signed cookie value, so it
# can't be tampered with client-side the way a plain request body counter
# could -- that's what actually enforces the limit, not the frontend's own
# message counter (which only exists for a responsive UI, not security).
# No AiChat/AiChatMessage rows are ever created for a guest conversation --
# there's no user_id to scope them to -- so continuity across the 3
# messages is carried by the client re-sending its own short history in
# the request body instead (safe: worst case a tampered value just gives
# the model wrong context for its own reply, nothing is persisted from it).
GUEST_CHAT_MESSAGE_LIMIT = 3
GUEST_CHAT_HISTORY_MAX_MESSAGES = 6


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
    project_type = data.get("project_type") if data.get("project_type") in ("game", "webapp", "general", "code") else None
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
        chat = AiChat(user_id=user.id, mode="code" if project_type == "code" else "general")
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


@app.route("/api/ai/guest-chat", methods=["POST"])
def api_ai_guest_chat():
    """The homepage's anonymous trial chat -- see GUEST_CHAT_MESSAGE_LIMIT
    above for the reasoning. Logged-in visitors use /api/ai/chat instead
    (full history, per-user learned facts, chat persistence)."""
    if current_user() is not None:
        return jsonify({"ok": False, "error": "already_logged_in"}), 400

    data = request.get_json(silent=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"ok": False, "error": "empty_message"}), 400

    sent_count = session.get("guest_chat_count", 0)
    if sent_count >= GUEST_CHAT_MESSAGE_LIMIT:
        return jsonify({"ok": False, "error": "limit_reached"}), 403
    session["guest_chat_count"] = sent_count + 1

    raw_history = data.get("history") if isinstance(data.get("history"), list) else []
    history = [
        {"role": m.get("role"), "content": (m.get("content") or "")[:ai_assistant.MAX_MESSAGE_CHARS]}
        for m in raw_history if m.get("role") in ("user", "assistant") and m.get("content")
    ][-GUEST_CHAT_HISTORY_MAX_MESSAGES:]

    facts = [
        f.content for f in
        AiAdminFact.query.order_by(AiAdminFact.created_at.desc()).limit(ADMIN_FACTS_PROMPT_LIMIT).all()
    ]

    def on_done(reply, error, proposed_change, new_learned_facts):
        if error:
            with app.app_context():
                log_error(error, path="/api/ai/guest-chat", method="POST")

    job_id = ai_assistant.start_chat_job(
        message, None, history=history, project_type=None, facts=facts, on_done=on_done,
    )
    remaining = GUEST_CHAT_MESSAGE_LIMIT - session["guest_chat_count"]
    return jsonify({"ok": True, "job_id": job_id, "remaining": remaining})


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


@app.route("/api/user/<username>/subscribe", methods=["POST"])
def api_subscribe(username):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    target = User.query.filter_by(username=username).first_or_404()
    if target.id == user.id:
        return jsonify({"ok": False, "error": "self_subscribe"}), 400

    existing = Subscription.query.filter_by(subscriber_id=user.id, channel_id=target.id).first()
    if existing:
        db.session.delete(existing)
        subscribed = False
    else:
        db.session.add(Subscription(subscriber_id=user.id, channel_id=target.id))
        subscribed = True
    db.session.commit()
    return jsonify({"ok": True, "subscribed": subscribed, "subscriber_count": len(target.subscribers)})


def serialize_message(message, viewer_id):
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": message.sender.username,
        "text": message.text,
        "created_at": message.created_at.strftime("%H:%M"),
        "is_mine": message.sender_id == viewer_id,
    }


def conversation_display_name(conversation, viewer):
    if conversation.is_group:
        return conversation.group_name or "Gruppe"
    other = next(
        (m.user for m in conversation.members if m.user_id != viewer.id), None
    )
    return other.username if other else "Unbekannt"



@app.route("/account/settings")
def account_settings():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    return render_template("account_settings.html", user=user)


@app.route("/account/email", methods=["POST"])
def update_email():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    email = request.form.get("email", "").strip()
    if not email or "@" not in email:
        flash("Bitte eine gültige E-Mail-Adresse angeben.")
        return redirect(url_for("account_settings"))

    if User.query.filter(User.email == email, User.id != user.id).first():
        flash("Diese E-Mail-Adresse wird bereits verwendet.")
        return redirect(url_for("account_settings"))

    user.email = email
    db.session.commit()
    send_email_best_effort(
        email, "E-Mail-Adresse bei NexAI hinterlegt",
        f"Hallo {user.username},\n\n"
        "diese E-Mail-Adresse wurde gerade bei deinem NexAI-Konto hinterlegt. Über sie "
        "kannst du ab jetzt z. B. dein Passwort zurücksetzen, falls du es einmal vergisst.\n\n"
        "Wenn du das nicht warst, ändere bitte umgehend dein Passwort.\n\n"
        "Das NexAI-Team",
    )
    flash("E-Mail-Adresse gespeichert.")
    return redirect(url_for("account_settings"))


@app.route("/account/city", methods=["POST"])
def update_city():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    user.city = (request.form.get("city") or "").strip()
    db.session.commit()
    flash("Stadt gespeichert.")
    return redirect(url_for("account_settings"))


@app.route("/account/username", methods=["POST"])
def update_username():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    if not user.email:
        abort(400)

    new_username = request.form.get("username", "").strip()
    if not new_username:
        flash("Bitte einen Benutzernamen angeben.")
        return redirect(url_for("account_settings"))
    if User.query.filter(User.username == new_username, User.id != user.id).first():
        flash("Dieser Benutzername ist bereits vergeben.")
        return redirect(url_for("account_settings"))

    user.username = new_username
    db.session.commit()
    flash("Benutzername geändert.")
    return redirect(url_for("account_settings"))


@app.route("/account/password", methods=["POST"])
def update_password():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    if not user.email:
        abort(400)

    current_password = request.form.get("current_password", "")
    new_password = request.form.get("new_password", "")

    if not user.check_password(current_password):
        flash("Aktuelles Passwort ist falsch.")
        return redirect(url_for("account_settings"))
    if not new_password:
        flash("Bitte ein neues Passwort angeben.")
        return redirect(url_for("account_settings"))

    user.set_password(new_password)
    db.session.commit()
    flash("Passwort geändert.")
    return redirect(url_for("account_settings"))


@app.route("/account/ai-profile/delete", methods=["POST"])
def delete_ai_profile():
    """Erases this user's private AiLearnedFact(source="user") rows (see
    models.py's AiLearnedFact docstring and the Nutzungsbedingungen's
    "NexAI AI und Ihr persönliches Nutzerprofil" section) and resets
    their typing-speed baseline. The assistant starts learning about this
    person from scratch in future chats."""
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    deleted = AiLearnedFact.query.filter_by(source="user", user_id=user.id).delete()
    AiPersonality.query.filter_by(user_id=user.id).delete()
    user.avg_typing_interval_ms = None
    user.typing_sample_count = 0
    db.session.commit()
    flash(f"Dein privates KI-Profil wurde gelöscht ({deleted} Einträge).")
    return redirect(url_for("account_settings"))


@app.route("/account/ai-chats/delete-all", methods=["POST"])
def delete_all_ai_chats():
    """Deletes every saved AiChat (and, via cascade, their AiChatMessage
    rows) for this user. Deliberately does NOT touch AiLearnedFact --
    the private per-user profile the AI learned across those chats (see
    delete_ai_profile above, a separate, explicit action) survives this
    exactly like it already survives deleting a single chat."""
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    # A bulk Query.delete() would bypass the ORM session entirely and skip
    # AiChat.messages' cascade="all, delete-orphan" (that cascade only
    # fires for individually-deleted objects), leaving every AiChatMessage
    # row orphaned instead of actually removed -- deleting each chat
    # through the session, like the single-chat route already does, is
    # what actually cascades correctly.
    chats = AiChat.query.filter_by(user_id=user.id).all()
    deleted = len(chats)
    for chat in chats:
        db.session.delete(chat)
    db.session.commit()
    flash(f"Alle deine Chats wurden gelöscht ({deleted}). Dein privates KI-Profil bleibt erhalten.")
    return redirect(url_for("account_settings"))


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


def run_video_wipe():
    """One-off, irreversible cleanup: delete every legacy Video (and its
    R2 file) left over from before the site switched from video hosting
    to photos. Safe to call repeatedly (no-ops once the table is empty)."""
    try:
        with db.engine.connect() as conn:
            rows = conn.execute(text('SELECT id, filename FROM video')).fetchall()
            for row in rows:
                delete_media("uploads", row.filename)
            conn.execute(text('DELETE FROM "like"'))
            conn.execute(text('DELETE FROM comment'))
            conn.execute(text('DELETE FROM video_report'))
            conn.execute(text('DELETE FROM video'))
            conn.commit()
        return {"ok": True, "deleted": len(rows)}
    except Exception as exc:
        logger.exception("Video-Wipe fehlgeschlagen.")
        return {"ok": False, "error": str(exc)}


video_wipe_status = {"running": False, "last_report": None}


def _run_video_wipe_background():
    video_wipe_status["running"] = True
    try:
        with app.app_context():
            report = run_video_wipe()
        video_wipe_status["last_report"] = report
        logger.info("Video-Wipe abgeschlossen: %s", report)
    finally:
        video_wipe_status["running"] = False


@app.route("/admin/wipe-legacy-videos", methods=["POST"])
def admin_wipe_legacy_videos():
    require_admin()
    if video_wipe_status["running"]:
        return jsonify({"ok": False, "error": "already_running"}), 409
    thread = threading.Thread(target=_run_video_wipe_background, daemon=True)
    thread.start()
    return jsonify({"ok": True, "status": "started"})


@app.route("/admin/wipe-legacy-videos/status")
def admin_wipe_legacy_videos_status():
    require_admin()
    return jsonify(video_wipe_status)


def run_post_wipe():
    """One-off, irreversible cleanup: delete every legacy photo Post (and
    its R2 files) left over from before the site switched from photos to
    being a pure games/Studio platform. Safe to call repeatedly (no-ops
    once the table is empty)."""
    try:
        with db.engine.connect() as conn:
            rows = conn.execute(text('SELECT id, filename FROM post_photo')).fetchall()
            for row in rows:
                delete_media("posts", row.filename)
            conn.execute(text('UPDATE message SET shared_post_id = NULL WHERE shared_post_id IS NOT NULL'))
            conn.execute(text('DELETE FROM post_report'))
            conn.execute(text('DELETE FROM post_comment'))
            conn.execute(text('DELETE FROM post_like'))
            conn.execute(text('DELETE FROM post_photo'))
            conn.execute(text('DELETE FROM post'))
            conn.commit()
        return {"ok": True, "deleted": len(rows)}
    except Exception as exc:
        logger.exception("Post-Wipe fehlgeschlagen.")
        return {"ok": False, "error": str(exc)}


post_wipe_status = {"running": False, "last_report": None}


def _run_post_wipe_background():
    post_wipe_status["running"] = True
    try:
        with app.app_context():
            report = run_post_wipe()
        post_wipe_status["last_report"] = report
        logger.info("Post-Wipe abgeschlossen: %s", report)
    finally:
        post_wipe_status["running"] = False


@app.route("/admin/wipe-legacy-posts", methods=["POST"])
def admin_wipe_legacy_posts():
    require_admin()
    if post_wipe_status["running"]:
        return jsonify({"ok": False, "error": "already_running"}), 409
    thread = threading.Thread(target=_run_post_wipe_background, daemon=True)
    thread.start()
    return jsonify({"ok": True, "status": "started"})


@app.route("/admin/wipe-legacy-posts/status")
def admin_wipe_legacy_posts_status():
    require_admin()
    return jsonify(post_wipe_status)


def is_user_online(user):
    if user.last_seen is None:
        return False
    last_seen = user.last_seen
    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - last_seen).total_seconds() <= ONLINE_THRESHOLD_SECONDS


@app.route("/admin")
def admin_dashboard():
    admin_user = require_admin()
    users = User.query.order_by(User.username).all()
    online_status = {u.id: is_user_online(u) for u in users}
    ai_feedback = AiChatFeedback.query.order_by(AiChatFeedback.created_at.desc()).limit(100).all()
    admin_facts = AiAdminFact.query.order_by(AiAdminFact.created_at.desc()).all()
    recovery_requests = AccountRecoveryRequest.query.filter_by(status="pending") \
        .order_by(AccountRecoveryRequest.created_at.desc()).all()
    error_logs = ErrorLog.query.order_by(ErrorLog.created_at.desc()).limit(100).all()
    voice_profiles = {p.gender: p for p in AiVoiceProfile.query.all()}
    learned_facts_counts = {
        "wikipedia": AiLearnedFact.query.filter_by(source="wikipedia").count(),
        "python_docs": AiLearnedFact.query.filter_by(source="python_docs").count(),
        "user": AiLearnedFact.query.filter_by(source="user").count(),
    }
    return render_template(
        "admin.html", user=admin_user, users=users, online_status=online_status,
        ai_feedback=ai_feedback, admin_facts=admin_facts,
        recovery_requests=recovery_requests, error_logs=error_logs,
        voice_profiles=voice_profiles,
        use_elevenlabs=USE_ELEVENLABS, learned_facts_counts=learned_facts_counts,
    )


@app.route("/admin/facts/<int:fact_id>/delete", methods=["POST"])
def admin_delete_fact(fact_id):
    require_admin()
    fact = db.get_or_404(AiAdminFact, fact_id)
    db.session.delete(fact)
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


# A curated, one-time "foundational knowledge" batch for the general-mode
# assistant's learned facts (see AiLearnedFact/_learned_facts_addendum) --
# not remotely "all of Wikipedia" (millions of articles, wouldn't fit in
# any prompt anyway, and 9999 arbitrary scraped websites wouldn't either --
# LEARNED_FACTS_PROMPT_LIMIT caps what actually reaches a single prompt
# regardless of how many rows exist), just a broad, useful starting set on
# top of the live per-question search_wikipedia/search_docs lookups that
# already run during normal chats. Real Wikipedia summaries and real
# Python documentation excerpts, fetched the same way a live lookup would.
WIKIPEDIA_SEED_TOPICS = [
    "Deutschland", "Europa", "Erde", "Sonnensystem", "Wasser", "Photosynthese",
    "Zweiter Weltkrieg", "Römisches Reich", "Dinosaurier", "Klimawandel",
    "Künstliche Intelligenz", "Internet", "Elektrizität", "Chemisches Element",
    "Mathematik", "Physik", "Biologie", "Weltgeschichte", "Fußball", "Musik",
    "Kunst", "Literatur", "Demokratie", "Menschenrechte", "Evolution", "DNA",
    "Gehirn", "Vulkan", "Erdbeben", "Ozean",
    "Programmierung", "Programmiersprache", "Quellcode", "Softwareentwicklung",
]

# _tool_search_docs's DuckDuckGo-based site search turned out to already be
# broken independently of this feature -- DuckDuckGo's html.duckduckgo.com
# endpoint now answers automated requests with a bot-detection challenge
# page (HTTP 202, no real results) instead of search results, discovered
# while building this seeding feature. Rather than depend on that fragile
# search for a small, curated topic list we already know good pages for,
# fetch these official docs.python.org pages directly.
PYTHON_SEED_DOC_URLS = {
    "list": "https://docs.python.org/3/tutorial/introduction.html#lists",
    "dictionary": "https://docs.python.org/3/tutorial/datastructures.html#dictionaries",
    "for loop": "https://docs.python.org/3/tutorial/controlflow.html#for-statements",
    "function": "https://docs.python.org/3/tutorial/controlflow.html#defining-functions",
    "class": "https://docs.python.org/3/tutorial/classes.html",
    "exception handling": "https://docs.python.org/3/tutorial/errors.html",
    "string methods": "https://docs.python.org/3/library/stdtypes.html#string-methods",
    "file handling": "https://docs.python.org/3/tutorial/inputoutput.html#reading-and-writing-files",
    "modules": "https://docs.python.org/3/tutorial/modules.html",
    "list comprehension": "https://docs.python.org/3/tutorial/datastructures.html#list-comprehensions",
    "lambda": "https://docs.python.org/3/reference/expressions.html#lambda",
    "decorators": "https://docs.python.org/3/glossary.html#term-decorator",
    "generators": "https://docs.python.org/3/tutorial/classes.html#generators",
    "regular expressions": "https://docs.python.org/3/library/re.html",
    "datetime": "https://docs.python.org/3/library/datetime.html",
}


def _fetch_python_doc_page(topic, url):
    if not ai_assistant._docs_allowed(url):
        return None
    try:
        response = requests.get(
            url, headers={"User-Agent": ai_assistant.TOOL_USER_AGENT},
            timeout=ai_assistant.TOOL_REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        text = ai_assistant._strip_html(response.text)
        return f"Aus der offiziellen python-Dokumentation ({url}):\n{text[:ai_assistant.MAX_TOOL_RESULT_CHARS]}"
    except Exception:
        logger.exception("Direkter Doku-Abruf für %s fehlgeschlagen.", url)
        return None


@app.route("/admin/ai/seed-knowledge", methods=["POST"])
def admin_seed_ai_knowledge():
    """One-time bulk import into AiLearnedFact -- see WIKIPEDIA_SEED_TOPICS/
    PYTHON_SEED_DOC_URLS above. Skips topics already stored (by prefix
    match on content) so re-running only fills in gaps rather than
    duplicating."""
    require_admin()
    added = 0
    for topic in WIKIPEDIA_SEED_TOPICS:
        prefix = f'Wikipedia-Artikel "{topic}"'
        if AiLearnedFact.query.filter_by(source="wikipedia").filter(
            AiLearnedFact.content.like(f"{prefix}%")
        ).first() is not None:
            continue
        result = ai_assistant._tool_search_wikipedia(topic)
        if result and not result.startswith(ai_assistant._WIKIPEDIA_LOOKUP_FAILURES):
            db.session.add(AiLearnedFact(source="wikipedia", content=result[:800]))
            added += 1
    for topic, url in PYTHON_SEED_DOC_URLS.items():
        prefix = f"Python-Doku: {topic}"
        if AiLearnedFact.query.filter_by(source="python_docs").filter(
            AiLearnedFact.content.like(f"{prefix}%")
        ).first() is not None:
            continue
        result = _fetch_python_doc_page(topic, url)
        if result:
            db.session.add(AiLearnedFact(source="python_docs", content=f"{prefix}: {result[:800]}"))
            added += 1
    db.session.commit()
    flash(f"{added} neue Wissens-Einträge geladen.")
    return redirect(url_for("admin_dashboard"))


MIN_TRAINING_EXAMPLES = 3


@app.route("/admin/ai-training")
def admin_ai_training():
    """Real fine-tuning of the local chat model (see fine_tune.py) --
    admin-only. Distinct from the "KI-Wissen" facts chat and
    seed-knowledge button above, which only ever feed the prompt
    (AiLearnedFact/AiAdminFact); this actually retrains the model's
    weights on curated instruction/response pairs."""
    admin_user = require_admin()
    examples = AiTrainingExample.query.order_by(AiTrainingExample.created_at.desc()).all()
    runs = AiTrainingRun.query.order_by(AiTrainingRun.started_at.desc()).limit(20).all()
    active_run = AiTrainingRun.query.filter_by(status="running").first()
    return render_template(
        "admin_ai_training.html", user=admin_user, examples=examples, runs=runs,
        active_run=active_run, min_examples=MIN_TRAINING_EXAMPLES,
    )


@app.route("/admin/ai-training/examples", methods=["POST"])
def admin_ai_training_add_example():
    admin_user = require_admin()
    instruction = (request.form.get("instruction") or "").strip()
    response = (request.form.get("response") or "").strip()
    if not instruction or not response:
        flash("Frage und Antwort dürfen nicht leer sein.")
        return redirect(url_for("admin_ai_training"))
    db.session.add(AiTrainingExample(
        instruction=instruction[:2000], response=response[:4000], created_by_id=admin_user.id,
    ))
    db.session.commit()
    return redirect(url_for("admin_ai_training"))


@app.route("/admin/ai-training/examples/<int:example_id>/delete", methods=["POST"])
def admin_ai_training_delete_example(example_id):
    require_admin()
    example = db.get_or_404(AiTrainingExample, example_id)
    db.session.delete(example)
    db.session.commit()
    return redirect(url_for("admin_ai_training"))


@app.route("/admin/ai-training/start", methods=["POST"])
def admin_ai_training_start():
    """Kicks off a real fine-tuning run in the background -- see
    fine_tune.run_training_job. Only one run at a time: training
    saturates the same CPU the live chat feature runs on, so a second
    concurrent run would just make both slower without any benefit."""
    admin_user = require_admin()
    if AiTrainingRun.query.filter_by(status="running").first() is not None:
        flash("Es läuft bereits ein Training.")
        return redirect(url_for("admin_ai_training"))

    examples = AiTrainingExample.query.order_by(AiTrainingExample.created_at.asc()).all()
    if len(examples) < MIN_TRAINING_EXAMPLES:
        flash(f"Mindestens {MIN_TRAINING_EXAMPLES} Beispiele nötig, bevor trainiert werden kann.")
        return redirect(url_for("admin_ai_training"))

    example_pairs = [(e.instruction, e.response) for e in examples]
    run = AiTrainingRun(status="running", example_count=len(examples), started_by_id=admin_user.id)
    db.session.add(run)
    db.session.commit()
    run_id = run.id

    def do_training():
        import fine_tune
        import local_ai
        work_dir = tempfile.mkdtemp(prefix="nexai_training_")

        def on_status(message):
            with app.app_context():
                run_row = db.session.get(AiTrainingRun, run_id)
                if run_row is not None:
                    run_row.status_message = message[:300]
                    db.session.commit()

        try:
            gguf_path = fine_tune.run_training_job(example_pairs, work_dir, on_status=on_status)
            # Written to a temp path first, then renamed into place --
            # os.replace is atomic on both Windows and POSIX for a
            # same-volume move, so a request loading the model mid-copy
            # can never observe a half-written file.
            staged_path = local_ai.MODEL_PATH + ".new"
            shutil.copy2(gguf_path, staged_path)
            os.replace(staged_path, local_ai.MODEL_PATH)
            local_ai.reload_model()
            with app.app_context():
                run_row = db.session.get(AiTrainingRun, run_id)
                if run_row is not None:
                    run_row.status = "done"
                    run_row.status_message = "Training abgeschlossen."
                    run_row.finished_at = datetime.now(timezone.utc)
                    db.session.commit()
        except Exception as exc:
            logger.exception("KI-Training fehlgeschlagen.")
            with app.app_context():
                run_row = db.session.get(AiTrainingRun, run_id)
                if run_row is not None:
                    run_row.status = "error"
                    run_row.error = str(exc)[:2000]
                    run_row.finished_at = datetime.now(timezone.utc)
                    db.session.commit()
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    threading.Thread(target=do_training, daemon=True).start()
    flash("Training gestartet -- das kann eine Weile dauern, der Chat antwortet währenddessen langsamer.")
    return redirect(url_for("admin_ai_training"))


@app.route("/admin/ai-training/status")
def admin_ai_training_status():
    """Polled by the admin training page while a run is active."""
    require_admin()
    run = AiTrainingRun.query.order_by(AiTrainingRun.started_at.desc()).first()
    if run is None:
        return jsonify({"ok": True, "run": None})
    return jsonify({"ok": True, "run": {
        "status": run.status, "status_message": run.status_message,
        "example_count": run.example_count, "error": run.error,
    }})


@app.route("/admin/errors/clear", methods=["POST"])
def admin_clear_errors():
    require_admin()
    ErrorLog.query.delete()
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/users", methods=["POST"])
def admin_create_user():
    require_admin()
    username = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    if not username or not password:
        flash("Bitte Benutzername und Passwort angeben.")
        return redirect(url_for("admin_dashboard"))
    if User.query.filter_by(username=username).first():
        flash("Dieser Benutzername ist bereits vergeben.")
        return redirect(url_for("admin_dashboard"))

    fake_user = User(username=username)
    fake_user.set_password(password)
    db.session.add(fake_user)
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
def admin_delete_user(user_id):
    admin_user = require_admin()
    target = db.get_or_404(User, user_id)
    if target.id == admin_user.id:
        abort(400)

    if target.email:
        send_email_best_effort(
            target.email, "Dein NexAI-Konto wurde geschlossen",
            f"Hallo {target.username},\n\n"
            "dein NexAI-Konto wurde von einem Administrator geschlossen.\n\n"
            "Falls du glaubst, dass das zu Unrecht geschehen ist, kannst du uns unter "
            "timeskip_support@gmail.com kontaktieren.\n\n"
            "Das NexAI-Team",
        )

    if target.profile_image:
        delete_media("profile_pics", target.profile_image)

    db.session.delete(target)
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/users/<int:user_id>/set-points", methods=["POST"])
def admin_set_points(user_id):
    require_admin()
    target = db.get_or_404(User, user_id)
    try:
        new_score = int(request.form.get("total_score", ""))
    except (TypeError, ValueError):
        flash("Ungültiger Punktewert.")
        return redirect(url_for("admin_dashboard"))

    target.total_score = max(0, new_score)
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


VOICE_PROFILE_GENDERS = {"male", "female"}


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


@app.route("/admin/voice-profile/<gender>/reset", methods=["POST"])
def admin_voice_profile_reset(gender):
    require_admin()
    if gender not in VOICE_PROFILE_GENDERS:
        abort(400)
    profile = AiVoiceProfile.query.filter_by(gender=gender).first()
    if profile is not None:
        if profile.elevenlabs_voice_id:
            elevenlabs_delete_voice(profile.elevenlabs_voice_id)
        db.session.delete(profile)
        db.session.commit()
    return redirect(url_for("admin_dashboard"))


if __name__ == "__main__":
    app.run(debug=True)

