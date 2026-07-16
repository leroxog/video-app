import os
import re
import math
import uuid
import random
import hashlib
import difflib
import logging
import threading
from datetime import datetime, timezone, date, timedelta
from zoneinfo import ZoneInfo
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, send_from_directory, abort, flash, jsonify, Response
)
from sqlalchemy import text
from werkzeug.utils import secure_filename
from models import (
    db, User, Post, PostPhoto, Pixel, PostLike, Subscription, PostComment, RedeemedCode,
    GamePlayCount, Sound, UserCreatedCode, Conversation, ConversationMember, Message,
    PostReport, CoinflipDeposit, MemeTemplate, MemeLobby, MemeLobbyPlayer, MemeCreation, MemeVote,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_PHOTOS_PER_POST = 10
ALLOWED_SOUND_EXTENSIONS = {"mp3", "wav", "ogg", "m4a", "aac", "mp4", "webm", "mov"}
SOUND_TITLE_MAX_LENGTH = 100
PLACE_GRID_SIZE = 100
PLACE_COOLDOWN_SECONDS = 5

GAMES = [
    {
        "key": "place",
        "search_term": "timeskip/place",
        "endpoint": "place",
        "title": "timeskip/place",
        "subtitle": "Gemeinsame Pixel-Leinwand",
        "icon_class": "place-label-icon",
    },
    {
        "key": "tic.tac.toe",
        "search_term": "timeskip/tic.tac.toe",
        "endpoint": "tictactoe",
        "title": "timeskip/tic.tac.toe",
        "subtitle": "Tic Tac Toe gegen den Bot",
        "icon_class": "place-label-icon tictactoe-icon",
    },
    {
        "key": "fruit.merge",
        "search_term": "timeskip/fruit.merge",
        "endpoint": "fruitmerge",
        "title": "timeskip/fruit.merge",
        "subtitle": "Fruechte fallen lassen und verschmelzen",
        "icon_class": "place-label-icon fruitmerge-icon",
    },
    {
        "key": "gravity.run",
        "search_term": "timeskip/gravity.run",
        "endpoint": "gravityrun",
        "title": "timeskip/gravity.run",
        "subtitle": "Schwerkraft umkehren und Hindernissen ausweichen",
        "icon_class": "place-label-icon gravityrun-icon",
    },
    {
        "key": "knife.hit",
        "search_term": "timeskip/knife.hit",
        "endpoint": "knifehit",
        "title": "timeskip/knife.hit",
        "subtitle": "Messer in den rotierenden Block werfen",
        "icon_class": "place-label-icon knifehit-icon",
    },
    {
        "key": "flappy.bird",
        "search_term": "timeskip/flappy.bird",
        "endpoint": "flappybird",
        "title": "timeskip/flappy.bird",
        "subtitle": "Zwischen Rohren hindurchfliegen",
        "icon_class": "place-label-icon flappybird-icon",
    },
    {
        "key": "block.buster",
        "search_term": "timeskip/block.buster",
        "endpoint": "blockbuster",
        "title": "timeskip/block.buster",
        "subtitle": "Bloecke mit dem Paddle zerstoeren",
        "icon_class": "place-label-icon blockbuster-icon",
    },
    {
        "key": "coin.flip",
        "search_term": "timeskip/coin.flip",
        "endpoint": "coinflip",
        "title": "timeskip/coin.flip",
        "subtitle": "Muenze werfen und Punkte verdreifachen",
        "icon_class": "place-label-icon coinflip-icon",
    },
    {
        "key": "make.a.meme",
        "search_term": "timeskip/make.a.meme",
        "endpoint": "make_a_meme_page",
        "title": "timeskip/make.a.meme",
        "subtitle": "Meme-Party mit Freunden -- gemeinsam Memes bauen und abstimmen",
        "icon_class": "place-label-icon memeparty-icon",
    },
]
GAME_SUGGESTIONS = [g["search_term"] for g in GAMES]
GAME_MATCH_THRESHOLD = 0.65
SCORED_GAMES = {"fruit.merge", "gravity.run", "knife.hit", "flappy.bird", "block.buster"}
GAME_SCORE_MULTIPLIER = 2
SHUFFLE_COST = 15
DELETE_COST = 25
BOMB_COST = 40

COINFLIP_BASE_MULTIPLIER = 1.5
COINFLIP_WORKER_MULTIPLIER = 2.5
# Win chance now scales with wealth instead of being flat: poorer accounts
# get closer to COINFLIP_MAX_WIN_CHANCE, rich accounts decay smoothly
# toward COINFLIP_MIN_WIN_CHANCE as total_score grows (never 0%, so it's
# always at least technically possible to claw back).
COINFLIP_MAX_WIN_CHANCE = 0.55
COINFLIP_MIN_WIN_CHANCE = 0.15
COINFLIP_WIN_CHANCE_SCORE_SCALE = 5000
COINFLIP_WORKER_COST = 30
COINFLIP_NEW_COIN_COST = 100
COINFLIP_REBIRTH_COST_STEP = 500
COINFLIP_REBIRTH_MULTIPLIER_STEP = 0.2
COINFLIP_DEPOSIT_MIN_MINUTES = 5
COINFLIP_DEPOSIT_MAX_MINUTES = 12 * 60
COINFLIP_DEPOSIT_COLLECT_WINDOW_MINUTES = 15
COINFLIP_DEPOSIT_MIN_PAYOUT_MULTIPLIER = 1.1
COINFLIP_DEPOSIT_MAX_PAYOUT_MULTIPLIER = 1.6

MEME_MIN_PLAYERS = 1
MEME_MAX_PLAYERS = 11
MEME_MIN_ROUND_SECONDS = 20
MEME_MAX_ROUND_SECONDS = 600
MEME_DEFAULT_ROUND_SECONDS = 70
MEME_DEFAULT_TEMPLATE_COST = 100
MEME_VOTE_SECONDS_PER_ITEM = 12
MEME_PLACEMENT_POINTS = {1: 300, 2: 150}
MEME_NEW_ACCOUNT_WINDOW_DAYS = 7
MEME_NEW_ACCOUNT_BONUS = 100
MEME_NEW_ACCOUNT_BONUS_PLACES = 3


def coinflip_worker_cost(user):
    return COINFLIP_WORKER_COST * (2 ** user.coinflip_worker_count)


def coinflip_new_coin_cost(user):
    return COINFLIP_NEW_COIN_COST * (2 ** (user.coinflip_coins - 1))


def coinflip_multiplier(user):
    base = COINFLIP_WORKER_MULTIPLIER if user.coinflip_worker_count > 0 else COINFLIP_BASE_MULTIPLIER
    return base + COINFLIP_REBIRTH_MULTIPLIER_STEP * user.coinflip_rebirths


def coinflip_win_chance(user):
    score = max(0, user.total_score)
    decay = math.exp(-score / COINFLIP_WIN_CHANCE_SCORE_SCALE)
    return COINFLIP_MIN_WIN_CHANCE + (COINFLIP_MAX_WIN_CHANCE - COINFLIP_MIN_WIN_CHANCE) * decay


def coinflip_rebirth_cost(user):
    return COINFLIP_REBIRTH_COST_STEP * (user.coinflip_rebirths + 1)
UPLOAD_BONUS_POINTS = 100
LIKE_BONUS_POINTS = 60
COMMENT_MAX_LENGTH = 500
GENDER_CHOICES = {"maennlich": "Männlich", "weiblich": "Weiblich", "keine_angabe": "Ich will nicht antworten"}
APP_SHARE_POINTS = 9999999
APP_SHARE_COOLDOWN_HOURS = 24
PROMO_CODES = {
    "FREE FOR ALL": 500,
    "TIMESKIPFREE300FOREVERYONE": 300,
}
PUBLIC_PROMO_CODE = "FREE FOR ALL"
HEX_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")
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


def find_best_game_match(query):
    if not query:
        return None
    normalized_query = query.lower().strip()
    best_game = None
    best_score = 0.0
    for game in GAMES:
        candidates = [
            game["search_term"],
            game["search_term"].replace("timeskip/", "").replace(".", " "),
            game["key"].replace(".", " "),
        ]
        for candidate in candidates:
            score = difflib.SequenceMatcher(None, normalized_query, candidate.lower()).ratio()
            if score > best_score:
                best_score = score
                best_game = game
    if best_score >= GAME_MATCH_THRESHOLD:
        return best_game
    return None


def record_game_play(key):
    row = db.session.get(GamePlayCount, key)
    if row is None:
        row = GamePlayCount(game_key=key, count=0)
        db.session.add(row)
    row.count += 1
    db.session.commit()

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


LOCAL_MEDIA_FOLDERS = {
    "posts": "UPLOAD_FOLDER",
    "profile_pics": "PROFILE_PIC_FOLDER",
    "sounds": "SOUND_FOLDER",
    "meme_templates": "MEME_FOLDER",
    "meme_creations": "MEME_FOLDER",
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
    return url_for("static", filename=f"profile_pics/{stored_filename}")

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


def ensure_columns_exist():
    """Self-healing migration: db.create_all() only creates missing tables,
    it never adds columns to tables that already exist (e.g. on Postgres
    after the model gained new fields). Add any columns the current models
    need but the live database is still missing."""
    if "sqlite" in database_url:
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
        'ALTER TABLE "user" ALTER COLUMN total_score TYPE BIGINT',
        'ALTER TABLE "user" ALTER COLUMN points_earned_today TYPE BIGINT',
        'ALTER TABLE "user" ALTER COLUMN organic_points_earned TYPE BIGINT',
        'ALTER TABLE message ADD COLUMN IF NOT EXISTS shared_post_id INTEGER',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS birthdate DATE',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS gender VARCHAR(20)',
        'ALTER TABLE post ADD COLUMN IF NOT EXISTS hashtags TEXT',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS last_app_share_at TIMESTAMP',
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


def allowed_image_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def normalize_hashtags(raw):
    tokens = raw.replace(",", " ").split()
    seen = []
    for token in tokens:
        tag = "#" + token.lstrip("#")
        if len(tag) > 1 and tag.lower() not in [t.lower() for t in seen]:
            seen.append(tag)
    return " ".join(seen)


def allowed_sound_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_SOUND_EXTENSIONS


def current_user():
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return db.session.get(User, user_id)


def require_admin():
    user = current_user()
    if user is None or not user.is_admin:
        abort(403)
    return user


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


@app.before_request
def update_last_seen():
    user_id = session.get("user_id")
    if user_id is None:
        return
    now = datetime.now(timezone.utc)
    user = db.session.get(User, user_id)
    if user is None:
        return
    last_seen = user.last_seen
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if last_seen is None or (now - last_seen).total_seconds() >= LAST_SEEN_UPDATE_THROTTLE_SECONDS:
        user.last_seen = now
        db.session.commit()


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


@app.route("/")
def index():
    query = request.args.get("q", "").strip()
    matched_game = find_best_game_match(query)

    play_counts = {row.game_key: row.count for row in GamePlayCount.query.all()}
    games_ordered = sorted(GAMES, key=lambda g: play_counts.get(g["key"], 0), reverse=True)
    most_played_key = games_ordered[0]["key"] if play_counts.get(games_ordered[0]["key"], 0) > 0 else None

    user = current_user()
    redeemed_codes = set()
    if user is not None:
        redeemed_codes = {r.code for r in RedeemedCode.query.filter_by(user_id=user.id).all()}

    return render_template(
        "index.html",
        user=user,
        query=query,
        matched_game=matched_game,
        games_ordered=games_ordered,
        most_played_key=most_played_key,
        public_promo_code=PUBLIC_PROMO_CODE,
        public_promo_code_redeemed=PUBLIC_PROMO_CODE in redeemed_codes,
        game_suggestion=random.choice(GAME_SUGGESTIONS),
        code_creation_min_points=CODE_CREATION_MIN_ORGANIC_POINTS,
        code_creation_fee_percent=CODE_CREATION_FEE_PERCENT,
        max_codes_per_batch=MAX_CODES_PER_BATCH,
    )


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        password2 = request.form.get("password2", "")
        birthdate_raw = request.form.get("birthdate", "").strip()
        gender = request.form.get("gender", "").strip()

        if not username or not password or not password2 or not birthdate_raw or not gender:
            flash("Bitte alle Felder ausfüllen.")
            return render_template("register.html")
        if password != password2:
            flash("Die Passwörter stimmen nicht überein.")
            return render_template("register.html")
        if gender not in GENDER_CHOICES:
            flash("Bitte ein gültiges Geschlecht auswählen.")
            return render_template("register.html")
        try:
            birthdate = datetime.strptime(birthdate_raw, "%Y-%m-%d").date()
        except ValueError:
            flash("Bitte ein gültiges Geburtsdatum angeben.")
            return render_template("register.html")
        if birthdate > date.today():
            flash("Das Geburtsdatum darf nicht in der Zukunft liegen.")
            return render_template("register.html")
        if User.query.filter_by(username=username).first():
            flash("Dieser Benutzername ist bereits vergeben.")
            return render_template("register.html")

        user = User(username=username, birthdate=birthdate, gender=gender)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        session["user_id"] = user.id
        return redirect(url_for("index"))
    return render_template("register.html")


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


@app.route("/leaderboard")
def leaderboard():
    users = User.query.filter(User.total_score > 0).order_by(User.total_score.desc()).all()
    if users and not users[0].ever_rank_one:
        users[0].ever_rank_one = True
        db.session.commit()
    user = current_user()
    followed_ids = set()
    if user is not None:
        followed_ids = {
            sub.channel_id for sub in Subscription.query.filter_by(subscriber_id=user.id).all()
        }
    return render_template("leaderboard.html", users=users, user=user, followed_ids=followed_ids)


@app.route("/games")
def games_page():
    user = current_user()
    return render_template("games.html", user=user, games=GAMES)


@app.route("/camera")
def camera_page():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    return render_template("camera.html", user=user, max_photos=MAX_PHOTOS_PER_POST)


@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"ok": False, "error": "Bitte Benutzername und Passwort angeben."}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"ok": False, "error": "Dieser Benutzername ist bereits vergeben."}), 400

    user = User(username=username)
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    session["user_id"] = user.id
    return jsonify({"ok": True, "username": user.username})


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    user = User.query.filter_by(username=username).first()
    if not user or not user.check_password(password):
        return jsonify({"ok": False, "error": "Benutzername oder Passwort ist falsch."}), 400

    session["user_id"] = user.id
    return jsonify({"ok": True, "username": user.username})


@app.route("/api/score", methods=["POST"])
def api_score():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    game = data.get("game")
    score = data.get("score")

    if game not in SCORED_GAMES or not isinstance(score, int) or score < 0:
        return jsonify({"ok": False, "error": "invalid_data"}), 400

    adjust_points(user, score * GAME_SCORE_MULTIPLIER)
    db.session.commit()
    return jsonify({"ok": True, "total_score": user.total_score})


@app.route("/api/spend", methods=["POST"])
def api_spend():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    amount = data.get("amount")

    if not isinstance(amount, int) or amount <= 0:
        return jsonify({"ok": False, "error": "invalid_amount"}), 400
    if user.total_score < amount:
        return jsonify({"ok": False, "error": "insufficient_funds", "total_score": user.total_score}), 400

    adjust_points(user, -amount)
    db.session.commit()
    return jsonify({"ok": True, "total_score": user.total_score})


@app.route("/api/redeem-code", methods=["POST"])
def api_redeem_code():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip().upper()

    points = PROMO_CODES.get(code)
    if points is not None:
        if RedeemedCode.query.filter_by(user_id=user.id, code=code).first() is not None:
            return jsonify({"ok": False, "error": "already_redeemed"}), 400
        db.session.add(RedeemedCode(user_id=user.id, code=code))
        adjust_points(user, points, from_code=True)
        db.session.commit()
        return jsonify({"ok": True, "points": points, "total_score": user.total_score})

    user_code = UserCreatedCode.query.filter_by(code=code, redeemed_by_id=None).first()
    if user_code is None:
        return jsonify({"ok": False, "error": "invalid_code"}), 400
    if user_code.creator_id == user.id:
        return jsonify({"ok": False, "error": "cannot_redeem_own_code"}), 400

    user_code.redeemed_by_id = user.id
    user_code.redeemed_at = datetime.now(timezone.utc)
    adjust_points(user, user_code.points_value, from_code=True)
    db.session.commit()
    return jsonify({"ok": True, "points": user_code.points_value, "total_score": user.total_score})


@app.route("/api/share-app", methods=["POST"])
def api_share_app():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    now = datetime.now(timezone.utc)
    last = user.last_app_share_at
    if last is not None:
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        seconds_left = APP_SHARE_COOLDOWN_HOURS * 3600 - (now - last).total_seconds()
        if seconds_left > 0:
            return jsonify({"ok": False, "error": "cooldown", "seconds_left": int(seconds_left)}), 429

    user.last_app_share_at = now
    adjust_points(user, APP_SHARE_POINTS)
    db.session.commit()
    return jsonify({"ok": True, "points": APP_SHARE_POINTS, "total_score": user.total_score})


@app.route("/api/create-codes", methods=["POST"])
def api_create_codes():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    if user.organic_points_earned < CODE_CREATION_MIN_ORGANIC_POINTS:
        return jsonify({"ok": False, "error": "not_eligible"}), 400

    data = request.get_json(silent=True) or {}
    points_per_code = data.get("points_per_code")
    count = data.get("count")

    if not isinstance(points_per_code, int) or points_per_code < MIN_POINTS_PER_CODE:
        return jsonify({"ok": False, "error": "invalid_points"}), 400
    if not isinstance(count, int) or count < 1 or count > MAX_CODES_PER_BATCH:
        return jsonify({"ok": False, "error": "invalid_count"}), 400

    total_cost = points_per_code * count
    if user.total_score < total_cost:
        return jsonify({"ok": False, "error": "insufficient_funds", "total_score": user.total_score}), 400

    points_value = int(points_per_code * (100 - CODE_CREATION_FEE_PERCENT) / 100)
    created_codes = []
    for _ in range(count):
        code = generate_unique_code()
        db.session.add(UserCreatedCode(
            code=code,
            original_points=points_per_code,
            points_value=points_value,
            creator_id=user.id,
        ))
        created_codes.append(code)

    adjust_points(user, -total_cost)
    db.session.commit()

    return jsonify({
        "ok": True,
        "codes": created_codes,
        "points_value": points_value,
        "fee_percent": CODE_CREATION_FEE_PERCENT,
        "total_score": user.total_score,
    })


@app.route("/api/my-stats")
def api_my_stats():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    likes_received = sum(len(p.likes) for p in user.posts)
    followers = len(user.subscribers)
    return jsonify({"ok": True, "likes_received": likes_received, "followers": followers})


@app.route("/upload", methods=["GET", "POST"])
def upload():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    if request.method == "POST":
        caption = request.form.get("caption", "").strip()
        hashtags = normalize_hashtags(request.form.get("hashtags", ""))
        files = [f for f in request.files.getlist("photos") if f and f.filename]

        if not files:
            flash("Bitte mindestens ein Foto auswählen.")
            return render_template("upload.html", user=user)
        if len(files) > MAX_PHOTOS_PER_POST:
            flash(f"Maximal {MAX_PHOTOS_PER_POST} Fotos pro Beitrag.")
            return render_template("upload.html", user=user)
        for f in files:
            if not allowed_image_file(f.filename):
                flash("Nur folgende Bildformate sind erlaubt: " + ", ".join(sorted(ALLOWED_IMAGE_EXTENSIONS)))
                return render_template("upload.html", user=user)

        hashes = []
        for f in files:
            digest = hashlib.sha256()
            for chunk in iter(lambda: f.stream.read(65536), b""):
                digest.update(chunk)
            hashes.append(digest.hexdigest())
            f.stream.seek(0)

        existing = PostPhoto.query.filter(PostPhoto.content_hash.in_(hashes)).first()
        if existing is not None:
            flash("Eines dieser Fotos wurde bereits hochgeladen.")
            return render_template("upload.html", user=user)

        post = Post(caption=caption or None, hashtags=hashtags or None, user_id=user.id)
        db.session.add(post)
        db.session.flush()

        for position, (f, content_hash) in enumerate(zip(files, hashes)):
            extension = secure_filename(f.filename).rsplit(".", 1)[1].lower()
            stored_filename = f"{uuid.uuid4().hex}.{extension}"
            save_media(f, "posts", stored_filename)
            db.session.add(PostPhoto(
                post_id=post.id, filename=stored_filename, position=position, content_hash=content_hash,
            ))

        adjust_points(user, UPLOAD_BONUS_POINTS)
        db.session.commit()
        return redirect(url_for("feed", post_id=post.id))

    return render_template("upload.html", user=user, max_photos=MAX_PHOTOS_PER_POST)


def serialize_sound(sound):
    return {
        "id": sound.id,
        "title": sound.title,
        "url": media_url("sounds", sound.filename),
        "username": sound.uploader.username,
    }


@app.route("/api/sounds", methods=["GET"])
def api_list_sounds():
    sounds = Sound.query.order_by(Sound.created_at.desc()).all()
    return jsonify({"ok": True, "sounds": [serialize_sound(s) for s in sounds]})


@app.route("/api/sounds", methods=["POST"])
def api_upload_sound():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    file = request.files.get("sound")
    title = (request.form.get("title") or "").strip()

    if not file or file.filename == "":
        return jsonify({"ok": False, "error": "no_file"}), 400
    if not allowed_sound_file(file.filename):
        return jsonify({"ok": False, "error": "invalid_format"}), 400
    if not title:
        title = secure_filename(file.filename).rsplit(".", 1)[0][:SOUND_TITLE_MAX_LENGTH] or "Sound"
    title = title[:SOUND_TITLE_MAX_LENGTH]

    extension = secure_filename(file.filename).rsplit(".", 1)[1].lower()
    stored_filename = f"{uuid.uuid4().hex}.{extension}"
    save_media(file, "sounds", stored_filename)

    sound = Sound(filename=stored_filename, title=title, user_id=user.id)
    db.session.add(sound)
    db.session.commit()

    return jsonify({"ok": True, "sound": serialize_sound(sound)})


@app.route("/api/post/<int:post_id>/like", methods=["POST"])
def api_like_post(post_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    post = db.get_or_404(Post, post_id)

    existing = PostLike.query.filter_by(user_id=user.id, post_id=post.id).first()
    if existing:
        db.session.delete(existing)
        liked = False
        adjust_points(post.uploader, -existing.points_awarded)
    else:
        awarded = adjust_points(post.uploader, LIKE_BONUS_POINTS)
        db.session.add(PostLike(user_id=user.id, post_id=post.id, points_awarded=awarded))
        liked = True
    db.session.commit()
    return jsonify({"ok": True, "liked": liked, "like_count": len(post.likes)})


def serialize_comment(comment):
    return {
        "id": comment.id,
        "username": comment.author.username,
        "profile_image": media_url("profile_pics", comment.author.profile_image),
        "text": comment.text,
        "created_at": comment.created_at.strftime("%d.%m.%Y %H:%M"),
    }


@app.route("/api/post/<int:post_id>/comments")
def api_list_post_comments(post_id):
    post = db.get_or_404(Post, post_id)
    comments = PostComment.query.filter_by(post_id=post.id).order_by(PostComment.created_at).all()
    return jsonify({"ok": True, "comments": [serialize_comment(c) for c in comments]})


@app.route("/api/post/<int:post_id>/comment", methods=["POST"])
def api_add_post_comment(post_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    post = db.get_or_404(Post, post_id)

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"ok": False, "error": "empty_comment"}), 400
    text = text[:COMMENT_MAX_LENGTH]

    comment = PostComment(user_id=user.id, post_id=post.id, text=text)
    db.session.add(comment)
    db.session.commit()

    return jsonify({
        "ok": True,
        "comment": serialize_comment(comment),
        "comment_count": len(post.comments),
    })


@app.route("/api/post/<int:post_id>/report", methods=["POST"])
def api_report_post(post_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    post = db.get_or_404(Post, post_id)

    if PostReport.query.filter_by(post_id=post.id, reporter_id=user.id).first() is not None:
        return jsonify({"ok": False, "error": "already_reported"}), 400

    db.session.add(PostReport(post_id=post.id, reporter_id=user.id))
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
    entry = {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": message.sender.username,
        "text": message.text,
        "created_at": message.created_at.strftime("%H:%M"),
        "is_mine": message.sender_id == viewer_id,
    }
    if message.shared_post_id is not None:
        post = db.session.get(Post, message.shared_post_id)
        if post is not None:
            entry["shared_post"] = {
                "id": post.id,
                "caption": post.caption or "Foto",
                "thumbnail": media_url("posts", post.photos[0].filename) if post.photos else "",
                "url": url_for("feed", post_id=post.id),
            }
    return entry


def conversation_display_name(conversation, viewer):
    if conversation.is_group:
        return conversation.group_name or "Gruppe"
    other = next(
        (m.user for m in conversation.members if m.user_id != viewer.id), None
    )
    return other.username if other else "Unbekannt"


@app.route("/messages")
def messages_page():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    memberships = ConversationMember.query.filter_by(user_id=user.id).all()
    conversations = []
    for membership in memberships:
        conv = membership.conversation
        last_message = conv.messages[-1] if conv.messages else None
        conversations.append({
            "id": conv.id,
            "name": conversation_display_name(conv, user),
            "is_group": conv.is_group,
            "last_message": last_message.text if last_message and last_message.text else (
                "[Foto geteilt]" if last_message and last_message.shared_post_id else ""
            ),
        })
    conversations.sort(key=lambda c: c["id"], reverse=True)

    contacts = [
        db.session.get(User, uid) for uid in mutual_follow_ids(user)
    ]
    return render_template("messages.html", user=user, conversations=conversations, contacts=contacts)


@app.route("/messages/<int:conversation_id>")
def conversation_page(conversation_id):
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    conversation = db.get_or_404(Conversation, conversation_id)
    if not is_conversation_member(user, conversation):
        abort(403)
    return render_template(
        "conversation.html",
        user=user,
        conversation=conversation,
        conversation_name=conversation_display_name(conversation, user),
    )


@app.route("/api/conversations")
def api_conversations():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    memberships = ConversationMember.query.filter_by(user_id=user.id).all()
    conversations = [
        {"id": m.conversation.id, "name": conversation_display_name(m.conversation, user), "is_group": m.conversation.is_group}
        for m in memberships
    ]
    return jsonify({"ok": True, "conversations": conversations})


@app.route("/api/contacts")
def api_contacts():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    contacts = [db.session.get(User, uid) for uid in mutual_follow_ids(user)]
    return jsonify({
        "ok": True,
        "contacts": [
            {"username": c.username, "profile_image": media_url("profile_pics", c.profile_image)}
            for c in contacts if c is not None
        ],
    })


@app.route("/api/messages/start-dm", methods=["POST"])
def api_start_dm():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    target = User.query.filter_by(username=username).first()
    if target is None or target.id == user.id:
        return jsonify({"ok": False, "error": "invalid_user"}), 400
    if target.id not in mutual_follow_ids(user):
        return jsonify({"ok": False, "error": "not_mutual_follow"}), 400

    my_conv_ids = {
        m.conversation_id for m in ConversationMember.query.filter_by(user_id=user.id).all()
    }
    for conv_id in my_conv_ids:
        conv = db.session.get(Conversation, conv_id)
        if conv.is_group:
            continue
        member_ids = {m.user_id for m in conv.members}
        if member_ids == {user.id, target.id}:
            return jsonify({"ok": True, "conversation_id": conv.id})

    conversation = Conversation(is_group=False, created_by=user.id)
    db.session.add(conversation)
    db.session.flush()
    db.session.add(ConversationMember(conversation_id=conversation.id, user_id=user.id))
    db.session.add(ConversationMember(conversation_id=conversation.id, user_id=target.id))
    db.session.commit()
    return jsonify({"ok": True, "conversation_id": conversation.id})


@app.route("/api/messages/create-group", methods=["POST"])
def api_create_group():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()[:100]
    usernames = data.get("usernames") or []
    if not isinstance(usernames, list):
        return jsonify({"ok": False, "error": "invalid_data"}), 400

    allowed_ids = mutual_follow_ids(user)
    member_ids = {user.id}
    for uname in usernames:
        target = User.query.filter_by(username=uname).first()
        if target is None or target.id not in allowed_ids:
            return jsonify({"ok": False, "error": "invalid_member", "username": uname}), 400
        member_ids.add(target.id)

    if not (MIN_GROUP_MEMBERS <= len(member_ids) <= MAX_GROUP_MEMBERS):
        return jsonify({"ok": False, "error": "invalid_group_size"}), 400
    if not name:
        name = "Gruppe"

    conversation = Conversation(is_group=True, group_name=name, created_by=user.id)
    db.session.add(conversation)
    db.session.flush()
    for uid in member_ids:
        db.session.add(ConversationMember(conversation_id=conversation.id, user_id=uid))
    db.session.commit()
    return jsonify({"ok": True, "conversation_id": conversation.id})


@app.route("/api/messages/<int:conversation_id>")
def api_get_messages(conversation_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    conversation = db.get_or_404(Conversation, conversation_id)
    if not is_conversation_member(user, conversation):
        return jsonify({"ok": False, "error": "forbidden"}), 403

    now = datetime.now(timezone.utc)
    for message in conversation.messages:
        if message.viewed_at is None and message.sender_id != user.id:
            message.viewed_at = now
    db.session.commit()

    purge_expired_messages(conversation)

    return jsonify({
        "ok": True,
        "messages": [serialize_message(m, user.id) for m in conversation.messages],
    })


@app.route("/api/messages/<int:conversation_id>/send", methods=["POST"])
def api_send_message(conversation_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    conversation = db.get_or_404(Conversation, conversation_id)
    if not is_conversation_member(user, conversation):
        return jsonify({"ok": False, "error": "forbidden"}), 403

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()[:2000]
    shared_post_id = data.get("shared_post_id")

    if not text and not shared_post_id:
        return jsonify({"ok": False, "error": "empty_message"}), 400

    post = None
    if shared_post_id is not None:
        post = db.session.get(Post, shared_post_id)
        if post is None:
            return jsonify({"ok": False, "error": "invalid_post"}), 400

    message = Message(
        conversation_id=conversation.id,
        sender_id=user.id,
        text=text or None,
        shared_post_id=post.id if post else None,
    )
    db.session.add(message)
    db.session.commit()
    return jsonify({"ok": True, "message": serialize_message(message, user.id)})


@app.route("/api/posts/<int:post_id>/share", methods=["POST"])
def api_share_post(post_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    post = db.get_or_404(Post, post_id)

    data = request.get_json(silent=True) or {}
    conversation_id = data.get("conversation_id")
    conversation = db.session.get(Conversation, conversation_id) if conversation_id else None
    if conversation is None or not is_conversation_member(user, conversation):
        return jsonify({"ok": False, "error": "invalid_conversation"}), 400

    message = Message(conversation_id=conversation.id, sender_id=user.id, shared_post_id=post.id)
    db.session.add(message)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/liked-posts")
def liked_posts_page():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    posts = [like.post for like in PostLike.query.filter_by(user_id=user.id).order_by(PostLike.id.desc()).all()]
    return render_template("liked_posts.html", user=user, posts=posts)


def fetch_photo_bytes(photo):
    if USE_R2:
        obj = r2_client.get_object(Bucket=R2_BUCKET_NAME, Key=f"posts/{photo.filename}")
        return obj["Body"].read()
    with open(os.path.join(app.config["UPLOAD_FOLDER"], photo.filename), "rb") as f:
        return f.read()


@app.route("/photo/<int:photo_id>/download")
def download_photo(photo_id):
    photo = db.get_or_404(PostPhoto, photo_id)
    extension = photo.filename.rsplit(".", 1)[-1]
    download_name = f"foto.{extension}"
    if USE_R2:
        data = fetch_photo_bytes(photo)
        mimetype = f"image/{'jpeg' if extension == 'jpg' else extension}"
        return Response(
            data, mimetype=mimetype,
            headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
        )
    return send_from_directory(
        app.config["UPLOAD_FOLDER"], photo.filename, as_attachment=True, download_name=download_name,
    )


@app.route("/posts/<path:filename>")
def post_photo_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/post/<int:post_id>/delete", methods=["POST"])
def delete_post(post_id):
    user = current_user()
    post = db.get_or_404(Post, post_id)
    if user is None or (post.user_id != user.id and not user.is_admin):
        abort(403)
    for photo in post.photos:
        delete_media("posts", photo.filename)
    db.session.delete(post)
    db.session.commit()
    return redirect(url_for("feed"))


@app.route("/user/<username>")
def profile(username):
    profile_user = User.query.filter_by(username=username).first_or_404()
    user = current_user()

    is_own_profile = user is not None and user.id == profile_user.id
    is_subscribed = False
    if user is not None and not is_own_profile:
        is_subscribed = Subscription.query.filter_by(
            subscriber_id=user.id, channel_id=profile_user.id
        ).first() is not None

    posts = Post.query.filter_by(user_id=profile_user.id).order_by(Post.created_at.desc()).all()

    return render_template(
        "profile.html",
        profile_user=profile_user,
        posts=posts,
        user=user,
        is_own_profile=is_own_profile,
        is_subscribed=is_subscribed,
        subscriber_count=len(profile_user.subscribers),
    )


@app.route("/user/<username>/subscribe", methods=["POST"])
def subscribe(username):
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    target = User.query.filter_by(username=username).first_or_404()
    if target.id == user.id:
        abort(400)

    existing = Subscription.query.filter_by(subscriber_id=user.id, channel_id=target.id).first()
    if existing:
        db.session.delete(existing)
    else:
        db.session.add(Subscription(subscriber_id=user.id, channel_id=target.id))
    db.session.commit()

    next_url = request.form.get("next") or url_for("profile", username=username)
    return redirect(next_url)


@app.route("/profile/picture", methods=["POST"])
def upload_profile_picture():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    file = request.files.get("profile_image")
    if not file or file.filename == "":
        flash("Bitte ein Bild auswählen.")
        return redirect(url_for("profile", username=user.username))
    if not allowed_image_file(file.filename):
        flash("Nur folgende Bildformate sind erlaubt: " + ", ".join(sorted(ALLOWED_IMAGE_EXTENSIONS)))
        return redirect(url_for("profile", username=user.username))

    extension = secure_filename(file.filename).rsplit(".", 1)[1].lower()
    stored_filename = f"{uuid.uuid4().hex}.{extension}"
    save_media(file, "profile_pics", stored_filename)

    if user.profile_image:
        delete_media("profile_pics", user.profile_image)

    user.profile_image = stored_filename
    db.session.commit()
    return redirect(url_for("profile", username=user.username))


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
    flash("E-Mail-Adresse gespeichert.")
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
    posts = Post.query.order_by(Post.created_at.desc()).all()
    online_status = {u.id: is_user_online(u) for u in users}
    reports = PostReport.query.order_by(PostReport.created_at.desc()).all()
    meme_templates = MemeTemplate.query.filter_by(active=True).order_by(MemeTemplate.created_at.desc()).all()
    return render_template(
        "admin.html", user=admin_user, users=users, posts=posts, online_status=online_status,
        reports=reports, meme_templates=meme_templates,
    )


@app.route("/admin/reports/<int:report_id>/dismiss", methods=["POST"])
def admin_dismiss_report(report_id):
    require_admin()
    report = db.get_or_404(PostReport, report_id)
    db.session.delete(report)
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

    for post in target.posts:
        for photo in post.photos:
            delete_media("posts", photo.filename)
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


def seconds_since(moment):
    return (datetime.now(timezone.utc) - moment.replace(tzinfo=timezone.utc)).total_seconds()


@app.route("/feed")
def feed():
    user = current_user()
    posts = Post.query.order_by(Post.created_at.desc()).all()
    jump_to_post_id = request.args.get("post_id", type=int)

    liked_ids = set()
    subscribed_channel_ids = set()
    if user is not None:
        liked_ids = {like.post_id for like in PostLike.query.filter_by(user_id=user.id).all()}
        subscribed_channel_ids = {
            sub.channel_id for sub in Subscription.query.filter_by(subscriber_id=user.id).all()
        }

    return render_template(
        "feed.html",
        posts=posts,
        user=user,
        liked_ids=liked_ids,
        subscribed_channel_ids=subscribed_channel_ids,
        jump_to_post_id=jump_to_post_id,
    )


@app.route("/tictactoe")
def tictactoe():
    record_game_play("tic.tac.toe")
    return render_template("tictactoe.html", user=current_user())


@app.route("/fruitmerge")
def fruitmerge():
    record_game_play("fruit.merge")
    return render_template(
        "fruitmerge.html",
        user=current_user(),
        shuffle_cost=SHUFFLE_COST,
        delete_cost=DELETE_COST,
        bomb_cost=BOMB_COST,
    )


@app.route("/gravityrun")
def gravityrun():
    record_game_play("gravity.run")
    return render_template("gravityrun.html", user=current_user())


@app.route("/knifehit")
def knifehit():
    record_game_play("knife.hit")
    return render_template("knifehit.html", user=current_user())


@app.route("/flappybird")
def flappybird():
    record_game_play("flappy.bird")
    return render_template("flappybird.html", user=current_user())


@app.route("/blockbuster")
def blockbuster():
    record_game_play("block.buster")
    return render_template("blockbuster.html", user=current_user())


@app.route("/coinflip")
def coinflip():
    record_game_play("coin.flip")
    user = current_user()
    return render_template(
        "coinflip.html",
        user=user,
        worker_cost=coinflip_worker_cost(user) if user else COINFLIP_WORKER_COST,
        new_coin_cost=coinflip_new_coin_cost(user) if user else COINFLIP_NEW_COIN_COST,
        base_multiplier=COINFLIP_BASE_MULTIPLIER,
        worker_multiplier=COINFLIP_WORKER_MULTIPLIER,
        win_chance=coinflip_win_chance(user) if user else COINFLIP_MAX_WIN_CHANCE,
        max_win_chance=COINFLIP_MAX_WIN_CHANCE,
        min_win_chance=COINFLIP_MIN_WIN_CHANCE,
        win_chance_score_scale=COINFLIP_WIN_CHANCE_SCORE_SCALE,
        rebirth_cost=coinflip_rebirth_cost(user) if user else COINFLIP_REBIRTH_COST_STEP,
        rebirth_multiplier_step=COINFLIP_REBIRTH_MULTIPLIER_STEP,
        deposit_min_minutes=COINFLIP_DEPOSIT_MIN_MINUTES,
        deposit_max_minutes=COINFLIP_DEPOSIT_MAX_MINUTES,
        deposit_collect_window_minutes=COINFLIP_DEPOSIT_COLLECT_WINDOW_MINUTES,
        deposit_min_multiplier=COINFLIP_DEPOSIT_MIN_PAYOUT_MULTIPLIER,
        deposit_max_multiplier=COINFLIP_DEPOSIT_MAX_PAYOUT_MULTIPLIER,
    )


@app.route("/api/coinflip/flip", methods=["POST"])
def api_coinflip_flip():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    stake = data.get("stake")
    if not isinstance(stake, int) or stake <= 0:
        return jsonify({"ok": False, "error": "invalid_stake"}), 400
    if user.total_score < stake:
        return jsonify({"ok": False, "error": "insufficient_funds", "total_score": user.total_score}), 400

    multiplier = coinflip_multiplier(user)
    win_chance = coinflip_win_chance(user)
    coin_count = max(1, user.coinflip_coins)  # defensive floor, coinflip_coins should never be < 1

    adjust_points(user, -stake)
    results = []
    payout = 0
    for _ in range(coin_count):
        won = random.random() < win_chance
        results.append("win" if won else "lose")
        if won:
            payout += int(stake * multiplier)

    if payout > 0:
        adjust_points(user, payout)
    db.session.commit()

    return jsonify({
        "ok": True,
        "results": results,
        "payout": payout,
        "multiplier": multiplier,
        "win_chance": win_chance,
        "total_score": user.total_score,
    })


@app.route("/api/coinflip/buy-worker", methods=["POST"])
def api_coinflip_buy_worker():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    cost = coinflip_worker_cost(user)
    if user.total_score < cost:
        return jsonify({"ok": False, "error": "insufficient_funds", "total_score": user.total_score}), 400

    adjust_points(user, -cost)
    user.coinflip_worker_count += 1
    db.session.commit()
    return jsonify({
        "ok": True,
        "worker_count": user.coinflip_worker_count,
        "total_score": user.total_score,
        "next_cost": coinflip_worker_cost(user),
    })


@app.route("/api/coinflip/buy-coin", methods=["POST"])
def api_coinflip_buy_coin():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    cost = coinflip_new_coin_cost(user)
    if user.total_score < cost:
        return jsonify({"ok": False, "error": "insufficient_funds", "total_score": user.total_score}), 400

    adjust_points(user, -cost)
    user.coinflip_coins += 1
    db.session.commit()
    return jsonify({
        "ok": True,
        "coins": user.coinflip_coins,
        "total_score": user.total_score,
        "next_cost": coinflip_new_coin_cost(user),
    })


@app.route("/api/coinflip/rebirth", methods=["POST"])
def api_coinflip_rebirth():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    cost = coinflip_rebirth_cost(user)
    if user.total_score < cost:
        return jsonify({"ok": False, "error": "insufficient_funds", "total_score": user.total_score}), 400

    adjust_points(user, -cost)
    user.coinflip_rebirths += 1
    user.coinflip_worker_count = 0
    user.coinflip_coins = 1
    db.session.commit()
    return jsonify({
        "ok": True,
        "rebirths": user.coinflip_rebirths,
        "multiplier_bonus": round(COINFLIP_REBIRTH_MULTIPLIER_STEP * user.coinflip_rebirths, 2),
        "total_score": user.total_score,
        "worker_count": user.coinflip_worker_count,
        "coins": user.coinflip_coins,
        "next_worker_cost": coinflip_worker_cost(user),
        "next_coin_cost": coinflip_new_coin_cost(user),
        "next_rebirth_cost": coinflip_rebirth_cost(user),
    })


def purge_expired_deposits(user):
    """Deposits not collected within the grace window after maturing are
    forfeited for good -- delete them so they stop showing up."""
    now = datetime.now(timezone.utc)
    for deposit in CoinflipDeposit.query.filter_by(user_id=user.id, collected=False).all():
        matures_at = deposit.matures_at
        if matures_at.tzinfo is None:
            matures_at = matures_at.replace(tzinfo=timezone.utc)
        deadline = matures_at + timedelta(minutes=COINFLIP_DEPOSIT_COLLECT_WINDOW_MINUTES)
        if now > deadline:
            db.session.delete(deposit)
    db.session.commit()


def serialize_deposit(deposit):
    now = datetime.now(timezone.utc)
    matures_at = deposit.matures_at
    if matures_at.tzinfo is None:
        matures_at = matures_at.replace(tzinfo=timezone.utc)
    deadline = matures_at + timedelta(minutes=COINFLIP_DEPOSIT_COLLECT_WINDOW_MINUTES)
    if now < matures_at:
        status = "pending"
    elif now <= deadline:
        status = "ready"
    else:
        status = "expired"
    return {
        "id": deposit.id,
        "staked_amount": deposit.staked_amount,
        "matures_at": matures_at.isoformat(),
        "collect_deadline": deadline.isoformat(),
        "status": status,
    }


@app.route("/api/coinflip/deposit/start", methods=["POST"])
def api_coinflip_deposit_start():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    stake = data.get("stake")
    duration_minutes = data.get("duration_minutes")

    if not isinstance(stake, int) or stake <= 0:
        return jsonify({"ok": False, "error": "invalid_stake"}), 400
    if (
        not isinstance(duration_minutes, int)
        or duration_minutes < COINFLIP_DEPOSIT_MIN_MINUTES
        or duration_minutes > COINFLIP_DEPOSIT_MAX_MINUTES
    ):
        return jsonify({"ok": False, "error": "invalid_duration"}), 400
    if user.total_score < stake:
        return jsonify({"ok": False, "error": "insufficient_funds", "total_score": user.total_score}), 400

    adjust_points(user, -stake)
    deposit = CoinflipDeposit(
        user_id=user.id,
        staked_amount=stake,
        matures_at=datetime.now(timezone.utc) + timedelta(minutes=duration_minutes),
    )
    db.session.add(deposit)
    db.session.commit()

    return jsonify({"ok": True, "deposit": serialize_deposit(deposit), "total_score": user.total_score})


@app.route("/api/coinflip/deposits")
def api_coinflip_deposits():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    purge_expired_deposits(user)
    deposits = CoinflipDeposit.query.filter_by(user_id=user.id, collected=False).order_by(
        CoinflipDeposit.matures_at
    ).all()
    return jsonify({"ok": True, "deposits": [serialize_deposit(d) for d in deposits]})


@app.route("/api/coinflip/deposit/<int:deposit_id>/collect", methods=["POST"])
def api_coinflip_deposit_collect(deposit_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    deposit = db.get_or_404(CoinflipDeposit, deposit_id)
    if deposit.user_id != user.id:
        abort(403)
    if deposit.collected:
        return jsonify({"ok": False, "error": "already_collected"}), 400

    now = datetime.now(timezone.utc)
    matures_at = deposit.matures_at
    if matures_at.tzinfo is None:
        matures_at = matures_at.replace(tzinfo=timezone.utc)
    deadline = matures_at + timedelta(minutes=COINFLIP_DEPOSIT_COLLECT_WINDOW_MINUTES)

    if now < matures_at:
        return jsonify({"ok": False, "error": "not_ready"}), 400
    if now > deadline:
        db.session.delete(deposit)
        db.session.commit()
        return jsonify({"ok": False, "error": "expired"}), 400

    multiplier = random.uniform(COINFLIP_DEPOSIT_MIN_PAYOUT_MULTIPLIER, COINFLIP_DEPOSIT_MAX_PAYOUT_MULTIPLIER)
    payout = int(deposit.staked_amount * multiplier)
    adjust_points(user, payout)
    deposit.collected = True
    db.session.delete(deposit)
    db.session.commit()

    return jsonify({
        "ok": True,
        "payout": payout,
        "multiplier": round(multiplier, 2),
        "total_score": user.total_score,
    })


def generate_meme_lobby_code():
    while True:
        code = "".join(random.choices("0123456789", k=6))
        if MemeLobby.query.filter_by(code=code).first() is None:
            return code


def meme_creation_score(creation):
    return sum(1 if v.value else -1 for v in creation.votes)


def advance_meme_lobby(lobby):
    """Lazily transition a lobby's status based on elapsed time, same
    pattern as the lazy expiry used for chat messages / coinflip deposits."""
    now = datetime.now(timezone.utc)

    if lobby.status == "round" and lobby.round_started_at is not None:
        started = lobby.round_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if (now - started).total_seconds() >= lobby.round_seconds:
            lobby.status = "voting"
            lobby.voting_started_at = now
            db.session.commit()

    if lobby.status == "voting" and lobby.voting_started_at is not None:
        creation_count = MemeCreation.query.filter_by(
            lobby_id=lobby.id, round_number=lobby.round_number
        ).count()
        started = lobby.voting_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed = (now - started).total_seconds()
        total_window = max(creation_count, 1) * MEME_VOTE_SECONDS_PER_ITEM
        if creation_count == 0 or elapsed >= total_window:
            lobby.status = "results"
            db.session.commit()


def award_meme_results(lobby):
    if lobby.results_awarded:
        return
    creations = MemeCreation.query.filter_by(lobby_id=lobby.id, round_number=lobby.round_number).all()
    if len(lobby.players) > 2 and creations:
        ranked = sorted(creations, key=meme_creation_score, reverse=True)
        now = datetime.now(timezone.utc)
        for index, creation in enumerate(ranked):
            place = index + 1
            points = MEME_PLACEMENT_POINTS.get(place)
            if points is None:
                continue
            winner = creation.user
            total = points
            created_at = winner.created_at
            if created_at is not None:
                if created_at.tzinfo is None:
                    created_at = created_at.replace(tzinfo=timezone.utc)
                if place <= MEME_NEW_ACCOUNT_BONUS_PLACES and (now - created_at).days <= MEME_NEW_ACCOUNT_WINDOW_DAYS:
                    total += MEME_NEW_ACCOUNT_BONUS
            adjust_points(winner, total)
    lobby.results_awarded = True
    db.session.commit()


def serialize_meme_player(player, lobby):
    return {
        "username": player.user.username,
        "profile_image": media_url("profile_pics", player.user.profile_image) if player.user.profile_image else None,
        "is_leader": player.user_id == lobby.leader_id,
    }


@app.route("/make-a-meme")
def make_a_meme_page():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    return render_template(
        "make_a_meme.html", user=user,
        min_players=MEME_MIN_PLAYERS, max_players=MEME_MAX_PLAYERS,
        min_seconds=MEME_MIN_ROUND_SECONDS, max_seconds=MEME_MAX_ROUND_SECONDS,
        default_seconds=MEME_DEFAULT_ROUND_SECONDS,
    )


@app.route("/make-a-meme/<code>")
def meme_lobby_page(code):
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    lobby = MemeLobby.query.filter_by(code=code).first_or_404()
    if MemeLobbyPlayer.query.filter_by(lobby_id=lobby.id, user_id=user.id).first() is None:
        abort(403)
    return render_template("meme_lobby.html", user=user, lobby=lobby)


@app.route("/api/meme/create-lobby", methods=["POST"])
def api_meme_create_lobby():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    try:
        max_players = int(data.get("max_players", MEME_MAX_PLAYERS))
        round_seconds = int(data.get("round_seconds", MEME_DEFAULT_ROUND_SECONDS))
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "invalid_input"}), 400

    if not (MEME_MIN_PLAYERS <= max_players <= MEME_MAX_PLAYERS):
        return jsonify({"ok": False, "error": "invalid_max_players"}), 400
    if not (MEME_MIN_ROUND_SECONDS <= round_seconds <= MEME_MAX_ROUND_SECONDS):
        return jsonify({"ok": False, "error": "invalid_round_seconds"}), 400

    lobby = MemeLobby(
        code=generate_meme_lobby_code(), leader_id=user.id, max_players=max_players,
        round_seconds=round_seconds, template_cost=MEME_DEFAULT_TEMPLATE_COST,
    )
    db.session.add(lobby)
    db.session.flush()
    db.session.add(MemeLobbyPlayer(lobby_id=lobby.id, user_id=user.id))
    db.session.commit()
    return jsonify({"ok": True, "code": lobby.code})


@app.route("/api/meme/join", methods=["POST"])
def api_meme_join():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    code = (data.get("code") or "").strip()
    lobby = MemeLobby.query.filter_by(code=code).first()
    if lobby is None:
        return jsonify({"ok": False, "error": "not_found"}), 404

    existing = MemeLobbyPlayer.query.filter_by(lobby_id=lobby.id, user_id=user.id).first()
    if existing is not None:
        return jsonify({"ok": True, "code": lobby.code})

    if lobby.status != "waiting":
        return jsonify({"ok": False, "error": "already_started"}), 400
    if len(lobby.players) >= lobby.max_players:
        return jsonify({"ok": False, "error": "full"}), 400

    db.session.add(MemeLobbyPlayer(lobby_id=lobby.id, user_id=user.id))
    db.session.commit()
    return jsonify({"ok": True, "code": lobby.code})


@app.route("/api/meme/lobby/<int:lobby_id>/start", methods=["POST"])
def api_meme_start(lobby_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    lobby = db.get_or_404(MemeLobby, lobby_id)
    if lobby.leader_id != user.id:
        abort(403)
    if lobby.status != "waiting":
        return jsonify({"ok": False, "error": "already_started"}), 400

    data = request.get_json(silent=True) or {}
    if not data.get("confirmed_responsibility"):
        return jsonify({"ok": False, "error": "responsibility_not_confirmed"}), 400

    templates = MemeTemplate.query.filter_by(active=True).all()
    if not templates:
        return jsonify({"ok": False, "error": "no_templates"}), 400

    lobby.round_number = 1
    lobby.status = "round"
    lobby.round_started_at = datetime.now(timezone.utc)
    lobby.voting_started_at = None
    lobby.results_awarded = False
    for p in lobby.players:
        p.current_template_id = random.choice(templates).id
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/meme/lobby/<int:lobby_id>/next-template", methods=["POST"])
def api_meme_next_template(lobby_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    lobby = db.get_or_404(MemeLobby, lobby_id)
    player = MemeLobbyPlayer.query.filter_by(lobby_id=lobby.id, user_id=user.id).first()
    if player is None:
        abort(403)
    advance_meme_lobby(lobby)
    if lobby.status != "round":
        return jsonify({"ok": False, "error": "not_in_round"}), 400
    if user.total_score < lobby.template_cost:
        return jsonify({"ok": False, "error": "insufficient_funds"}), 400

    templates = MemeTemplate.query.filter_by(active=True).all()
    if not templates:
        return jsonify({"ok": False, "error": "no_templates"}), 400
    choices = [t for t in templates if t.id != player.current_template_id] or templates
    new_template = random.choice(choices)

    adjust_points(user, -lobby.template_cost)
    player.current_template_id = new_template.id
    db.session.commit()
    return jsonify({
        "ok": True,
        "template": {"id": new_template.id, "url": media_url("meme_templates", new_template.filename)},
        "total_score": user.total_score,
    })


@app.route("/api/meme/lobby/<int:lobby_id>/submit", methods=["POST"])
def api_meme_submit(lobby_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    lobby = db.get_or_404(MemeLobby, lobby_id)
    player = MemeLobbyPlayer.query.filter_by(lobby_id=lobby.id, user_id=user.id).first()
    if player is None:
        abort(403)
    advance_meme_lobby(lobby)
    if lobby.status != "round":
        return jsonify({"ok": False, "error": "not_in_round"}), 400

    file = request.files.get("photo")
    if not file or not file.filename or not allowed_image_file(file.filename):
        return jsonify({"ok": False, "error": "invalid_image"}), 400

    extension = secure_filename(file.filename).rsplit(".", 1)[1].lower()
    stored_filename = f"{uuid.uuid4().hex}.{extension}"
    save_media(file, "meme_creations", stored_filename)

    existing = MemeCreation.query.filter_by(
        lobby_id=lobby.id, round_number=lobby.round_number, user_id=user.id
    ).first()
    if existing is not None:
        delete_media("meme_creations", existing.filename)
        existing.filename = stored_filename
    else:
        db.session.add(MemeCreation(
            lobby_id=lobby.id, round_number=lobby.round_number, user_id=user.id, filename=stored_filename,
        ))
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/meme/lobby/<int:lobby_id>/vote", methods=["POST"])
def api_meme_vote(lobby_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    lobby = db.get_or_404(MemeLobby, lobby_id)
    player = MemeLobbyPlayer.query.filter_by(lobby_id=lobby.id, user_id=user.id).first()
    if player is None:
        abort(403)
    advance_meme_lobby(lobby)
    if lobby.status != "voting":
        return jsonify({"ok": False, "error": "not_voting"}), 400

    data = request.get_json(silent=True) or {}
    creation_id = data.get("creation_id")
    value = data.get("value")
    creation = db.session.get(MemeCreation, creation_id) if creation_id else None
    if creation is None or creation.lobby_id != lobby.id or not isinstance(value, bool):
        return jsonify({"ok": False, "error": "invalid_vote"}), 400

    existing_vote = MemeVote.query.filter_by(creation_id=creation.id, voter_id=user.id).first()
    if existing_vote is not None:
        existing_vote.value = value
    else:
        db.session.add(MemeVote(creation_id=creation.id, voter_id=user.id, value=value))
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/meme/lobby/<int:lobby_id>/rematch-vote", methods=["POST"])
def api_meme_rematch_vote(lobby_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    lobby = db.get_or_404(MemeLobby, lobby_id)
    player = MemeLobbyPlayer.query.filter_by(lobby_id=lobby.id, user_id=user.id).first()
    if player is None:
        abort(403)
    advance_meme_lobby(lobby)
    if lobby.status != "results":
        return jsonify({"ok": False, "error": "not_results"}), 400

    data = request.get_json(silent=True) or {}
    player.wants_rematch = bool(data.get("want"))
    db.session.commit()
    wants_count = sum(1 for p in lobby.players if p.wants_rematch)
    return jsonify({"ok": True, "wants_rematch_count": wants_count, "player_count": len(lobby.players)})


@app.route("/api/meme/lobby/<int:lobby_id>/rematch-start", methods=["POST"])
def api_meme_rematch_start(lobby_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    lobby = db.get_or_404(MemeLobby, lobby_id)
    if lobby.leader_id != user.id:
        abort(403)
    advance_meme_lobby(lobby)
    if lobby.status != "results":
        return jsonify({"ok": False, "error": "not_results"}), 400

    templates = MemeTemplate.query.filter_by(active=True).all()
    if not templates:
        return jsonify({"ok": False, "error": "no_templates"}), 400

    lobby.round_number += 1
    lobby.status = "round"
    lobby.round_started_at = datetime.now(timezone.utc)
    lobby.voting_started_at = None
    lobby.results_awarded = False
    for p in lobby.players:
        p.wants_rematch = False
        p.current_template_id = random.choice(templates).id
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/api/meme/lobby/<int:lobby_id>/state")
def api_meme_lobby_state(lobby_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    lobby = db.get_or_404(MemeLobby, lobby_id)
    player = MemeLobbyPlayer.query.filter_by(lobby_id=lobby.id, user_id=user.id).first()
    if player is None:
        abort(403)

    advance_meme_lobby(lobby)
    if lobby.status == "results":
        award_meme_results(lobby)

    now = datetime.now(timezone.utc)
    payload = {
        "ok": True,
        "status": lobby.status,
        "code": lobby.code,
        "round_number": lobby.round_number,
        "round_seconds": lobby.round_seconds,
        "template_cost": lobby.template_cost,
        "max_players": lobby.max_players,
        "is_leader": lobby.leader_id == user.id,
        "players": [serialize_meme_player(p, lobby) for p in lobby.players],
        "total_score": user.total_score,
    }

    if lobby.status == "round":
        started = lobby.round_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        payload["time_left"] = max(0, lobby.round_seconds - (now - started).total_seconds())
        my_creation = MemeCreation.query.filter_by(
            lobby_id=lobby.id, round_number=lobby.round_number, user_id=user.id
        ).first()
        payload["submitted"] = my_creation is not None
        if player.current_template is not None:
            payload["template"] = {
                "id": player.current_template.id,
                "url": media_url("meme_templates", player.current_template.filename),
            }

    elif lobby.status == "voting":
        creations = MemeCreation.query.filter_by(
            lobby_id=lobby.id, round_number=lobby.round_number
        ).order_by(MemeCreation.id).all()
        started = lobby.voting_started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        elapsed = (now - started).total_seconds()
        index = int(elapsed // MEME_VOTE_SECONDS_PER_ITEM)
        index = max(0, min(index, len(creations) - 1)) if creations else 0
        payload["voting_index"] = index
        payload["voting_total"] = len(creations)
        if creations:
            current = creations[index]
            my_vote = MemeVote.query.filter_by(creation_id=current.id, voter_id=user.id).first()
            payload["current_creation"] = {
                "id": current.id,
                "url": media_url("meme_creations", current.filename),
                "my_vote": my_vote.value if my_vote is not None else None,
                "is_mine": current.user_id == user.id,
            }

    elif lobby.status == "results":
        creations = MemeCreation.query.filter_by(lobby_id=lobby.id, round_number=lobby.round_number).all()
        ranked = sorted(creations, key=meme_creation_score, reverse=True)
        payload["results"] = [
            {
                "id": c.id,
                "place": index + 1,
                "username": c.user.username,
                "url": media_url("meme_creations", c.filename),
                "download_url": url_for("download_meme_creation", creation_id=c.id),
                "score": meme_creation_score(c),
                "is_mine": c.user_id == user.id,
            }
            for index, c in enumerate(ranked)
        ]
        payload["wants_rematch"] = player.wants_rematch
        payload["wants_rematch_count"] = sum(1 for p in lobby.players if p.wants_rematch)

    return jsonify(payload)


@app.route("/meme-creation/<int:creation_id>/download")
def download_meme_creation(creation_id):
    creation = db.get_or_404(MemeCreation, creation_id)
    extension = creation.filename.rsplit(".", 1)[-1]
    download_name = f"meme.{extension}"
    if USE_R2:
        obj = r2_client.get_object(Bucket=R2_BUCKET_NAME, Key=f"meme_creations/{creation.filename}")
        data = obj["Body"].read()
        mimetype = f"image/{'jpeg' if extension == 'jpg' else extension}"
        return Response(
            data, mimetype=mimetype,
            headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
        )
    return send_from_directory(
        app.config["MEME_FOLDER"], creation.filename, as_attachment=True, download_name=download_name,
    )


@app.route("/admin/meme-templates", methods=["POST"])
def admin_upload_meme_template():
    admin_user = require_admin()
    files = [f for f in request.files.getlist("templates") if f and f.filename]
    if not files:
        flash("Bitte mindestens ein Bild auswählen.")
        return redirect(url_for("admin_dashboard"))
    for f in files:
        if not allowed_image_file(f.filename):
            flash("Nur folgende Bildformate sind erlaubt: " + ", ".join(sorted(ALLOWED_IMAGE_EXTENSIONS)))
            return redirect(url_for("admin_dashboard"))
    for f in files:
        extension = secure_filename(f.filename).rsplit(".", 1)[1].lower()
        stored_filename = f"{uuid.uuid4().hex}.{extension}"
        save_media(f, "meme_templates", stored_filename)
        db.session.add(MemeTemplate(filename=stored_filename, uploaded_by_id=admin_user.id))
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/meme-templates/<int:template_id>/delete", methods=["POST"])
def admin_delete_meme_template(template_id):
    require_admin()
    template = db.get_or_404(MemeTemplate, template_id)
    delete_media("meme_templates", template.filename)
    db.session.delete(template)
    db.session.commit()
    return redirect(url_for("admin_dashboard"))


@app.route("/place")
def place():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    record_game_play("place")

    cooldown_remaining = 0
    if user.last_pixel_at:
        remaining = PLACE_COOLDOWN_SECONDS - seconds_since(user.last_pixel_at)
        if remaining > 0:
            cooldown_remaining = remaining

    return render_template(
        "place.html",
        user=user,
        grid_size=PLACE_GRID_SIZE,
        cooldown_seconds=PLACE_COOLDOWN_SECONDS,
        cooldown_remaining=cooldown_remaining,
    )


@app.route("/place/pixels")
def place_pixels():
    pixels = Pixel.query.all()
    return jsonify([{"x": p.x, "y": p.y, "color": p.color} for p in pixels])


@app.route("/place/pixel", methods=["POST"])
def place_pixel():
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401

    data = request.get_json(silent=True) or {}
    x = data.get("x")
    y = data.get("y")
    color = data.get("color", "")

    if not isinstance(x, int) or not isinstance(y, int) or not (0 <= x < PLACE_GRID_SIZE) or not (0 <= y < PLACE_GRID_SIZE):
        return jsonify({"ok": False, "error": "invalid_coordinates"}), 400
    if not isinstance(color, str) or not HEX_COLOR_RE.fullmatch(color):
        return jsonify({"ok": False, "error": "invalid_color"}), 400

    if user.last_pixel_at:
        remaining = PLACE_COOLDOWN_SECONDS - seconds_since(user.last_pixel_at)
        if remaining > 0:
            return jsonify({"ok": False, "error": "cooldown", "retry_after": remaining}), 429

    now = datetime.now(timezone.utc)
    pixel = db.session.get(Pixel, (x, y))
    if pixel is None:
        pixel = Pixel(x=x, y=y, color=color)
        db.session.add(pixel)
    else:
        pixel.color = color
        pixel.updated_at = now

    user.last_pixel_at = now
    db.session.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True)
