import os
import re
import uuid
import random
import hashlib
import difflib
import logging
import shutil
import subprocess
import tempfile
import threading
from datetime import datetime, timezone, date, timedelta
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, send_from_directory, abort, flash, jsonify, Response
)
from sqlalchemy import text
from werkzeug.utils import secure_filename
from models import (
    db, User, Video, Pixel, Like, Subscription, Comment, RedeemedCode, GamePlayCount, Sound,
    UserCreatedCode, Conversation, ConversationMember, Message,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {"mp4", "webm", "ogg", "mov"}
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
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
]
GAME_SUGGESTIONS = [g["search_term"] for g in GAMES]
GAME_MATCH_THRESHOLD = 0.65
SCORED_GAMES = {"fruit.merge", "gravity.run", "knife.hit", "flappy.bird", "block.buster"}
SHUFFLE_COST = 15
DELETE_COST = 25
BOMB_COST = 40

COINFLIP_BASE_MULTIPLIER = 3
COINFLIP_WORKER_MULTIPLIER = 5
COINFLIP_WORKER_COST = 30
COINFLIP_NEW_COIN_COST = 100
COINFLIP_REBIRTH_COST_STEP = 500
COINFLIP_REBIRTH_MULTIPLIER_STEP = 0.2


def coinflip_worker_cost(user):
    return COINFLIP_WORKER_COST * (2 ** user.coinflip_worker_count)


def coinflip_new_coin_cost(user):
    return COINFLIP_NEW_COIN_COST * (2 ** (user.coinflip_coins - 1))


def coinflip_multiplier(user):
    base = COINFLIP_WORKER_MULTIPLIER if user.coinflip_worker_count > 0 else COINFLIP_BASE_MULTIPLIER
    return base + COINFLIP_REBIRTH_MULTIPLIER_STEP * user.coinflip_rebirths


def coinflip_rebirth_cost(user):
    return COINFLIP_REBIRTH_COST_STEP * (user.coinflip_rebirths + 1)
UPLOAD_BONUS_POINTS = 100
LIKE_BONUS_POINTS = 60
COMMENT_MAX_LENGTH = 500
PROMO_CODES = {
    "FREE FOR ALL": 500,
    "TIMESKIPFREE300FOREVERYONE": 300,
}
PUBLIC_PROMO_CODE = "FREE FOR ALL"
HEX_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")
STREAK_DAILY_THRESHOLD = 100

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


def adjust_points(user, delta, from_code=False):
    """Central helper for every point change. Positive deltas (earned
    points) also feed the daily-earned counter (for streaks), the
    organic-earned counter (for self-serve code creation eligibility,
    unless from_code=True), and the streak logic. Negative deltas (spending,
    unliking) only touch the raw balance."""
    if delta <= 0:
        user.total_score = max(0, user.total_score + delta)
        return

    user.total_score += delta

    today = date.today()
    if user.points_today_date != today:
        user.points_today_date = today
        user.points_earned_today = 0
    user.points_earned_today += delta

    if not from_code:
        user.organic_points_earned += delta

    if user.points_earned_today >= STREAK_DAILY_THRESHOLD:
        _update_streak(user, today)


def effective_streak(user):
    """Streak value for display: lapses back to 0 once a day has passed
    without the user re-qualifying (the DB field itself only resets
    lazily, on the next day the user actually earns enough points)."""
    if user.last_streak_date is None:
        return 0
    if user.last_streak_date >= date.today() - timedelta(days=1):
        return user.current_streak
    return 0


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


def video_matches_query(video, query_lower):
    title_lower = video.title.lower()
    if query_lower in title_lower:
        return True
    query_words = [w for w in query_lower.split() if len(w) >= 3]
    title_words = title_lower.split()
    for qw in query_words:
        for tw in title_words:
            if difflib.SequenceMatcher(None, qw, tw).ratio() >= 0.75:
                return True
    return False


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
    "uploads": "UPLOAD_FOLDER",
    "profile_pics": "PROFILE_PIC_FOLDER",
    "sounds": "SOUND_FOLDER",
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


def save_media_from_path(local_path, kind, stored_filename, content_type="application/octet-stream"):
    """Like save_media, but takes a plain file path instead of a Flask
    FileStorage (used after ffmpeg has written a transcoded file to disk)."""
    if USE_R2:
        key = f"{kind}/{stored_filename}"
        with open(local_path, "rb") as f:
            r2_client.upload_fileobj(f, R2_BUCKET_NAME, key, ExtraArgs={"ContentType": content_type})
    else:
        folder = app.config[LOCAL_MEDIA_FOLDERS[kind]]
        shutil.copyfile(local_path, os.path.join(folder, stored_filename))


FFMPEG_PATH = shutil.which("ffmpeg")


def transcode_to_mp4(input_path):
    """Transcode a video file to a broadly-compatible H.264/AAC MP4 so it
    plays on every device/browser (Safari/iOS in particular can't play
    WebM at all). Returns the output path on success, or None if ffmpeg
    isn't installed or the conversion fails -- callers should fall back
    to uploading the original file untouched."""
    if not FFMPEG_PATH:
        logger.warning("ffmpeg nicht gefunden -- Video wird ohne Transkodierung hochgeladen.")
        return None
    output_path = input_path + "-converted.mp4"
    try:
        subprocess.run(
            [
                FFMPEG_PATH, "-y", "-i", input_path,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                output_path,
            ],
            check=True,
            capture_output=True,
            timeout=280,
        )
        return output_path
    except Exception:
        logger.exception("Video-Transkodierung fehlgeschlagen fuer %s", input_path)
        if os.path.exists(output_path):
            os.remove(output_path)
        return None


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


R2_CLEANUP_HIGH_WATER_BYTES = 9 * 1024 ** 3
R2_CLEANUP_LOW_WATER_BYTES = 7 * 1024 ** 3


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


def cleanup_oldest_videos_if_over_quota(keep_video_id=None):
    """If the R2 bucket is at/above the 9 GB high-water mark, delete the
    oldest videos (oldest upload first) until usage drops back to 7 GB.
    Called after every upload, so it keeps repeating forever as new
    uploads push storage back over the threshold. Never deletes
    keep_video_id (the video that was just uploaded)."""
    if not USE_R2:
        return
    try:
        total_bytes, sizes_by_key = get_r2_bucket_usage()
        if total_bytes < R2_CLEANUP_HIGH_WATER_BYTES:
            return
        for video in Video.query.order_by(Video.created_at.asc()).all():
            if total_bytes <= R2_CLEANUP_LOW_WATER_BYTES:
                break
            if video.id == keep_video_id:
                continue
            total_bytes -= sizes_by_key.get(f"uploads/{video.filename}", 0)
            delete_media("uploads", video.filename)
            db.session.delete(video)
            db.session.commit()
            logger.info(
                "R2-Aufraeumen: Video '%s' (id=%s) geloescht, da Speicherlimit (9GB) erreicht war.",
                video.title, video.id,
            )
    except Exception:
        logger.exception("R2-Speicher-Aufraeumen fehlgeschlagen.")


VIDEO_MIME_TYPES = {
    "mp4": "video/mp4",
    "webm": "video/webm",
    "ogg": "video/ogg",
    "mov": "video/quicktime",
}


@app.template_global()
def video_mime_type(filename):
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return VIDEO_MIME_TYPES.get(extension, "video/mp4")


app.template_global()(effective_streak)
app.template_global()(user_badges)


@app.template_global()
def media_url(kind, stored_filename):
    if not stored_filename:
        return ""
    if USE_R2:
        return f"{R2_PUBLIC_URL}/{kind}/{stored_filename}"
    if kind == "uploads":
        return url_for("uploaded_file", filename=stored_filename)
    if kind == "sounds":
        return url_for("static", filename=f"sounds/{stored_filename}")
    return url_for("static", filename=f"profile_pics/{stored_filename}")

db.init_app(app)


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
        'ALTER TABLE video ADD COLUMN IF NOT EXISTS description TEXT',
        "ALTER TABLE video ADD COLUMN IF NOT EXISTS orientation VARCHAR(10) NOT NULL DEFAULT 'landscape'",
        'ALTER TABLE video ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)',
        'CREATE INDEX IF NOT EXISTS ix_video_content_hash ON video (content_hash)',
        'ALTER TABLE video ADD COLUMN IF NOT EXISTS duplicate_penalty_applied BOOLEAN NOT NULL DEFAULT FALSE',
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


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def allowed_image_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


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


@app.route("/")
def index():
    query = request.args.get("q", "").strip()
    matched_game = find_best_game_match(query)

    videos = []
    if matched_game is None:
        if query:
            query_lower = query.lower()
            candidates = Video.query.order_by(Video.created_at.desc()).all()
            videos = [v for v in candidates if video_matches_query(v, query_lower)]
        else:
            videos = (
                Video.query.filter_by(orientation="landscape")
                .order_by(Video.created_at.desc())
                .all()
            )

    play_counts = {row.game_key: row.count for row in GamePlayCount.query.all()}
    games_ordered = sorted(GAMES, key=lambda g: play_counts.get(g["key"], 0), reverse=True)
    most_played_key = games_ordered[0]["key"] if play_counts.get(games_ordered[0]["key"], 0) > 0 else None

    user = current_user()
    redeemed_codes = set()
    if user is not None:
        redeemed_codes = {r.code for r in RedeemedCode.query.filter_by(user_id=user.id).all()}

    return render_template(
        "index.html",
        videos=videos,
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
        if not username or not password:
            flash("Bitte Benutzername und Passwort angeben.")
            return render_template("register.html")
        if User.query.filter_by(username=username).first():
            flash("Dieser Benutzername ist bereits vergeben.")
            return render_template("register.html")
        user = User(username=username)
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

    adjust_points(user, score)
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

    likes_received = sum(len(v.likes) for v in user.videos)
    followers = len(user.subscribers)
    return jsonify({"ok": True, "likes_received": likes_received, "followers": followers})


@app.route("/upload", methods=["GET", "POST"])
def upload():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        description = request.form.get("description", "").strip()
        orientation = request.form.get("orientation", "landscape")
        if orientation not in ("landscape", "portrait"):
            orientation = "landscape"
        file = request.files.get("video")

        if not title:
            flash("Bitte einen Titel angeben.")
            return render_template("upload.html", user=user)
        if not file or file.filename == "":
            flash("Bitte eine Videodatei auswählen.")
            return render_template("upload.html", user=user)
        if not allowed_file(file.filename):
            flash("Nur folgende Formate sind erlaubt: " + ", ".join(sorted(ALLOWED_EXTENSIONS)))
            return render_template("upload.html", user=user)

        content_hash = hashlib.sha256()
        for chunk in iter(lambda: file.stream.read(65536), b""):
            content_hash.update(chunk)
        content_hash = content_hash.hexdigest()
        file.stream.seek(0)

        if Video.query.filter_by(content_hash=content_hash).first() is not None:
            flash("Dieses Video wurde bereits hochgeladen.")
            return render_template("upload.html", user=user)

        extension = secure_filename(file.filename).rsplit(".", 1)[1].lower()

        with tempfile.TemporaryDirectory() as tmp_dir:
            input_path = os.path.join(tmp_dir, f"input.{extension}")
            file.save(input_path)

            converted_path = transcode_to_mp4(input_path)
            final_path, final_extension = (converted_path, "mp4") if converted_path else (input_path, extension)

            stored_filename = f"{uuid.uuid4().hex}.{final_extension}"
            save_media_from_path(
                final_path, "uploads", stored_filename,
                content_type=VIDEO_MIME_TYPES.get(final_extension, "application/octet-stream"),
            )

        video = Video(
            title=title,
            description=description or None,
            filename=stored_filename,
            orientation=orientation,
            content_hash=content_hash,
            user_id=user.id,
        )
        db.session.add(video)
        adjust_points(user, UPLOAD_BONUS_POINTS)
        db.session.commit()
        cleanup_oldest_videos_if_over_quota(keep_video_id=video.id)
        return redirect(url_for("watch", video_id=video.id))

    return render_template("upload.html", user=user)


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


@app.route("/video/<int:video_id>")
def watch(video_id):
    video = db.get_or_404(Video, video_id)
    user = current_user()

    is_liked = False
    is_subscribed = False
    if user is not None:
        is_liked = Like.query.filter_by(user_id=user.id, video_id=video.id).first() is not None
        is_subscribed = Subscription.query.filter_by(
            subscriber_id=user.id, channel_id=video.user_id
        ).first() is not None

    return render_template(
        "watch.html",
        video=video,
        user=user,
        like_count=len(video.likes),
        is_liked=is_liked,
        is_subscribed=is_subscribed,
        subscriber_count=len(video.uploader.subscribers),
        comments=video.comments,
    )


@app.route("/video/<int:video_id>/like", methods=["POST"])
def like_video(video_id):
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    video = db.get_or_404(Video, video_id)

    existing = Like.query.filter_by(user_id=user.id, video_id=video.id).first()
    if existing:
        db.session.delete(existing)
        adjust_points(video.uploader, -LIKE_BONUS_POINTS)
    else:
        db.session.add(Like(user_id=user.id, video_id=video.id))
        adjust_points(video.uploader, LIKE_BONUS_POINTS)
    db.session.commit()
    return redirect(url_for("watch", video_id=video.id))


@app.route("/api/video/<int:video_id>/like", methods=["POST"])
def api_like_video(video_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    video = db.get_or_404(Video, video_id)

    existing = Like.query.filter_by(user_id=user.id, video_id=video.id).first()
    if existing:
        db.session.delete(existing)
        liked = False
        adjust_points(video.uploader, -LIKE_BONUS_POINTS)
    else:
        db.session.add(Like(user_id=user.id, video_id=video.id))
        liked = True
        adjust_points(video.uploader, LIKE_BONUS_POINTS)
    db.session.commit()
    return jsonify({"ok": True, "liked": liked, "like_count": len(video.likes)})


def serialize_comment(comment):
    return {
        "id": comment.id,
        "username": comment.author.username,
        "profile_image": media_url("profile_pics", comment.author.profile_image),
        "text": comment.text,
        "created_at": comment.created_at.strftime("%d.%m.%Y %H:%M"),
    }


@app.route("/api/video/<int:video_id>/comments")
def api_list_comments(video_id):
    video = db.get_or_404(Video, video_id)
    comments = Comment.query.filter_by(video_id=video.id).order_by(Comment.created_at).all()
    return jsonify({"ok": True, "comments": [serialize_comment(c) for c in comments]})


@app.route("/api/video/<int:video_id>/comment", methods=["POST"])
def api_add_comment(video_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    video = db.get_or_404(Video, video_id)

    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"ok": False, "error": "empty_comment"}), 400
    text = text[:COMMENT_MAX_LENGTH]

    comment = Comment(user_id=user.id, video_id=video.id, text=text)
    db.session.add(comment)
    db.session.commit()

    return jsonify({
        "ok": True,
        "comment": serialize_comment(comment),
        "comment_count": len(video.comments),
    })


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
    if message.shared_video_id is not None:
        video = db.session.get(Video, message.shared_video_id)
        if video is not None:
            entry["shared_video"] = {
                "id": video.id,
                "title": video.title,
                "url": url_for("watch", video_id=video.id),
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
                "[Video geteilt]" if last_message and last_message.shared_video_id else ""
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
    shared_video_id = data.get("shared_video_id")

    if not text and not shared_video_id:
        return jsonify({"ok": False, "error": "empty_message"}), 400

    video = None
    if shared_video_id is not None:
        video = db.session.get(Video, shared_video_id)
        if video is None:
            return jsonify({"ok": False, "error": "invalid_video"}), 400

    message = Message(
        conversation_id=conversation.id,
        sender_id=user.id,
        text=text or None,
        shared_video_id=video.id if video else None,
    )
    db.session.add(message)
    db.session.commit()
    return jsonify({"ok": True, "message": serialize_message(message, user.id)})


@app.route("/api/videos/<int:video_id>/share", methods=["POST"])
def api_share_video(video_id):
    user = current_user()
    if user is None:
        return jsonify({"ok": False, "error": "not_logged_in"}), 401
    video = db.get_or_404(Video, video_id)

    data = request.get_json(silent=True) or {}
    conversation_id = data.get("conversation_id")
    conversation = db.session.get(Conversation, conversation_id) if conversation_id else None
    if conversation is None or not is_conversation_member(user, conversation):
        return jsonify({"ok": False, "error": "invalid_conversation"}), 400

    message = Message(conversation_id=conversation.id, sender_id=user.id, shared_video_id=video.id)
    db.session.add(message)
    db.session.commit()
    return jsonify({"ok": True})


@app.route("/liked-videos")
def liked_videos_page():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))
    videos = [like.video for like in Like.query.filter_by(user_id=user.id).order_by(Like.id.desc()).all()]
    return render_template("liked_videos.html", user=user, videos=videos)


@app.route("/video/<int:video_id>/download")
def download_video(video_id):
    video = db.get_or_404(Video, video_id)
    if USE_R2:
        data = fetch_video_bytes(video)
        return Response(
            data,
            mimetype=video_mime_type(video.filename),
            headers={"Content-Disposition": f'attachment; filename="{secure_filename(video.title)[:100] or "video"}.{video.filename.rsplit(".", 1)[-1]}"'},
        )
    return send_from_directory(
        app.config["UPLOAD_FOLDER"], video.filename, as_attachment=True,
        download_name=f"{secure_filename(video.title)[:100] or 'video'}.{video.filename.rsplit('.', 1)[-1]}",
    )


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/video/<int:video_id>/delete", methods=["POST"])
def delete_video(video_id):
    user = current_user()
    video = db.get_or_404(Video, video_id)
    if user is None or (video.user_id != user.id and not user.is_admin):
        abort(403)
    delete_media("uploads", video.filename)
    db.session.delete(video)
    db.session.commit()
    return redirect(url_for("index"))


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

    videos = Video.query.filter_by(user_id=profile_user.id).order_by(Video.created_at.desc()).all()

    return render_template(
        "profile.html",
        profile_user=profile_user,
        videos=videos,
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


OLD_UPLOAD_BONUS = 600


def fetch_video_bytes(video):
    if USE_R2:
        obj = r2_client.get_object(Bucket=R2_BUCKET_NAME, Key=f"uploads/{video.filename}")
        return obj["Body"].read()
    with open(os.path.join(app.config["UPLOAD_FOLDER"], video.filename), "rb") as f:
        return f.read()


def run_duplicate_cleanup(dry_run=True):
    """Hash any videos still missing a content_hash, then revoke the old
    600pt upload bonus from duplicate uploads (same content, not the
    earliest copy) that haven't been penalized yet. Idempotent: safe to
    call repeatedly, and with dry_run=True makes no database changes."""
    videos = Video.query.order_by(Video.created_at.asc()).all()
    computed_hashes = {}
    hashed = 0
    unreadable = []
    for video in videos:
        if video.content_hash:
            computed_hashes[video.id] = video.content_hash
            continue
        try:
            data = fetch_video_bytes(video)
        except Exception as exc:
            unreadable.append({"video_id": video.id, "filename": video.filename, "error": str(exc)})
            continue
        digest = hashlib.sha256(data).hexdigest()
        computed_hashes[video.id] = digest
        if not dry_run:
            video.content_hash = digest
        hashed += 1

    if not dry_run:
        db.session.commit()

    by_hash = {}
    for video in videos:
        content_hash = computed_hashes.get(video.id)
        if content_hash is None:
            continue
        by_hash.setdefault(content_hash, []).append(video)

    penalties = []
    simulated_scores = {}

    def current_score(user):
        if user.id not in simulated_scores:
            simulated_scores[user.id] = user.total_score
        return simulated_scores[user.id]

    for content_hash, vids in by_hash.items():
        if len(vids) < 2:
            continue
        vids.sort(key=lambda v: v.created_at)
        original, duplicates = vids[0], vids[1:]
        for dup in duplicates:
            if dup.duplicate_penalty_applied:
                continue
            user = dup.uploader
            before = current_score(user)
            after = max(0, before - OLD_UPLOAD_BONUS)
            simulated_scores[user.id] = after
            penalties.append({
                "video_id": dup.id,
                "kept_original_video_id": original.id,
                "username": user.username,
                "total_score_before": before,
                "total_score_after": after,
                "deducted": before - after,
            })
            if not dry_run:
                user.total_score = after
                dup.duplicate_penalty_applied = True

    if not dry_run:
        db.session.commit()

    return {
        "dry_run": dry_run,
        "videos_total": len(videos),
        "hashed_this_run": hashed,
        "unreadable": unreadable,
        "duplicate_groups": len([h for h, v in by_hash.items() if len(v) > 1]),
        "penalties": penalties,
        "total_deducted": sum(p["deducted"] for p in penalties),
    }


@app.route("/admin/cleanup-duplicate-videos", methods=["POST"])
def admin_cleanup_duplicate_videos():
    require_admin()
    dry_run = request.args.get("dry_run", "1") != "0"
    report = run_duplicate_cleanup(dry_run=dry_run)
    return jsonify(report)


def run_transcode_migration(dry_run=True, limit=None):
    """One-off fix for videos uploaded before automatic transcoding
    existed (e.g. the legacy WebM uploads that can't play on Safari).
    Re-encodes every non-MP4 video to H.264 MP4 and replaces the R2
    object + filename. Idempotent: videos already .mp4 are skipped.
    `limit` caps how many videos are processed per call, since
    transcoding several videos in one HTTP request risks hitting a
    platform-level proxy timeout."""
    if not FFMPEG_PATH:
        return {"ok": False, "error": "ffmpeg_not_available"}

    query = Video.query.filter(~Video.filename.ilike("%.mp4"))
    if limit is not None:
        query = query.limit(limit)
    videos = query.all()
    results = []
    for video in videos:
        entry = {"video_id": video.id, "title": video.title, "old_filename": video.filename}
        try:
            with tempfile.TemporaryDirectory() as tmp_dir:
                extension = video.filename.rsplit(".", 1)[-1]
                input_path = os.path.join(tmp_dir, f"input.{extension}")
                with open(input_path, "wb") as f:
                    f.write(fetch_video_bytes(video))

                converted_path = transcode_to_mp4(input_path)
                if converted_path is None:
                    entry["status"] = "transcode_failed"
                    results.append(entry)
                    continue

                new_filename = f"{uuid.uuid4().hex}.mp4"
                entry["new_filename"] = new_filename
                if not dry_run:
                    save_media_from_path(converted_path, "uploads", new_filename, content_type="video/mp4")
                    old_filename = video.filename
                    video.filename = new_filename
                    db.session.commit()
                    delete_media("uploads", old_filename)
                entry["status"] = "converted" if not dry_run else "would_convert"
        except Exception as exc:
            entry["status"] = "error"
            entry["error"] = str(exc)
        results.append(entry)

    return {"ok": True, "dry_run": dry_run, "results": results}


transcode_migration_status = {"running": False, "last_report": None}


def _run_transcode_migration_background(dry_run, limit):
    transcode_migration_status["running"] = True
    try:
        with app.app_context():
            report = run_transcode_migration(dry_run=dry_run, limit=limit)
        transcode_migration_status["last_report"] = report
        logger.info("Transcode-Migration abgeschlossen: %s", report)
    except Exception:
        logger.exception("Transcode-Migration im Hintergrund fehlgeschlagen.")
    finally:
        transcode_migration_status["running"] = False


@app.route("/admin/transcode-legacy-videos", methods=["POST"])
def admin_transcode_legacy_videos():
    require_admin()
    dry_run = request.args.get("dry_run", "1") != "0"
    limit = request.args.get("limit", type=int)
    if transcode_migration_status["running"]:
        return jsonify({"ok": False, "error": "already_running"}), 409
    thread = threading.Thread(
        target=_run_transcode_migration_background, args=(dry_run, limit), daemon=True,
    )
    thread.start()
    return jsonify({"ok": True, "status": "started"})


@app.route("/admin/transcode-legacy-videos/status")
def admin_transcode_legacy_videos_status():
    require_admin()
    return jsonify(transcode_migration_status)


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
    videos = Video.query.order_by(Video.created_at.desc()).all()
    online_status = {u.id: is_user_online(u) for u in users}
    return render_template(
        "admin.html", user=admin_user, users=users, videos=videos, online_status=online_status,
    )


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

    for video in target.videos:
        delete_media("uploads", video.filename)
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


@app.route("/shorts")
def shorts():
    user = current_user()
    videos = Video.query.filter_by(orientation="portrait").all()
    videos.sort(key=lambda v: len(v.likes), reverse=True)
    if len(videos) > 1:
        top, rest = videos[0], videos[1:]
        random.shuffle(rest)
        videos = [top] + rest

    liked_ids = set()
    subscribed_channel_ids = set()
    if user is not None:
        liked_ids = {like.video_id for like in Like.query.filter_by(user_id=user.id).all()}
        subscribed_channel_ids = {
            sub.channel_id for sub in Subscription.query.filter_by(subscriber_id=user.id).all()
        }

    return render_template(
        "shorts.html",
        videos=videos,
        user=user,
        liked_ids=liked_ids,
        subscribed_channel_ids=subscribed_channel_ids,
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
        rebirth_cost=coinflip_rebirth_cost(user) if user else COINFLIP_REBIRTH_COST_STEP,
        rebirth_multiplier_step=COINFLIP_REBIRTH_MULTIPLIER_STEP,
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

    adjust_points(user, -stake)
    results = []
    payout = 0
    for _ in range(user.coinflip_coins):
        won = random.random() < 0.5
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
