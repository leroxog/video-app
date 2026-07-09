import os
import re
import uuid
import random
import hashlib
import difflib
import logging
from datetime import datetime, timezone
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, send_from_directory, abort, flash, jsonify
)
from sqlalchemy import text
from werkzeug.utils import secure_filename
from models import db, User, Video, Pixel, Like, Subscription, Comment, RedeemedCode, GamePlayCount

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {"mp4", "webm", "ogg", "mov"}
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
PLACE_GRID_SIZE = 100
PLACE_COOLDOWN_SECONDS = 5

GAMES = [
    {
        "key": "place",
        "search_term": "gigas/place",
        "endpoint": "place",
        "title": "gigas/place",
        "subtitle": "Gemeinsame Pixel-Leinwand",
        "icon_class": "place-label-icon",
    },
    {
        "key": "tic.tac.toe",
        "search_term": "gigas/tic.tac.toe",
        "endpoint": "tictactoe",
        "title": "gigas/tic.tac.toe",
        "subtitle": "Tic Tac Toe gegen den Bot",
        "icon_class": "place-label-icon tictactoe-icon",
    },
    {
        "key": "fruit.merge",
        "search_term": "gigas/fruit.merge",
        "endpoint": "fruitmerge",
        "title": "gigas/fruit.merge",
        "subtitle": "Fruechte fallen lassen und verschmelzen",
        "icon_class": "place-label-icon fruitmerge-icon",
    },
    {
        "key": "gravity.run",
        "search_term": "gigas/gravity.run",
        "endpoint": "gravityrun",
        "title": "gigas/gravity.run",
        "subtitle": "Schwerkraft umkehren und Hindernissen ausweichen",
        "icon_class": "place-label-icon gravityrun-icon",
    },
    {
        "key": "knife.hit",
        "search_term": "gigas/knife.hit",
        "endpoint": "knifehit",
        "title": "gigas/knife.hit",
        "subtitle": "Messer in den rotierenden Block werfen",
        "icon_class": "place-label-icon knifehit-icon",
    },
    {
        "key": "flappy.bird",
        "search_term": "gigas/flappy.bird",
        "endpoint": "flappybird",
        "title": "gigas/flappy.bird",
        "subtitle": "Zwischen Rohren hindurchfliegen",
        "icon_class": "place-label-icon flappybird-icon",
    },
    {
        "key": "block.buster",
        "search_term": "gigas/block.buster",
        "endpoint": "blockbuster",
        "title": "gigas/block.buster",
        "subtitle": "Bloecke mit dem Paddle zerstoeren",
        "icon_class": "place-label-icon blockbuster-icon",
    },
]
GAME_SUGGESTIONS = [g["search_term"] for g in GAMES]
GAME_MATCH_THRESHOLD = 0.65
SCORED_GAMES = {"fruit.merge", "gravity.run", "knife.hit", "flappy.bird", "block.buster"}
SHUFFLE_COST = 15
DELETE_COST = 25
BOMB_COST = 40
UPLOAD_BONUS_POINTS = 100
LIKE_BONUS_POINTS = 60
COMMENT_MAX_LENGTH = 500
PROMO_CODES = {
    "FREE FOR ALL": 500,
    "GIGASFREE300FOREVERYONE": 300,
}
PUBLIC_PROMO_CODE = "FREE FOR ALL"
HEX_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")


def find_best_game_match(query):
    if not query:
        return None
    normalized_query = query.lower().strip()
    best_game = None
    best_score = 0.0
    for game in GAMES:
        candidates = [
            game["search_term"],
            game["search_term"].replace("gigas/", "").replace(".", " "),
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
        folder = app.config["UPLOAD_FOLDER"] if kind == "uploads" else app.config["PROFILE_PIC_FOLDER"]
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
        folder = app.config["UPLOAD_FOLDER"] if kind == "uploads" else app.config["PROFILE_PIC_FOLDER"]
        try:
            os.remove(os.path.join(folder, stored_filename))
        except OSError:
            pass


@app.template_global()
def media_url(kind, stored_filename):
    if not stored_filename:
        return ""
    if USE_R2:
        return f"{R2_PUBLIC_URL}/{kind}/{stored_filename}"
    if kind == "uploads":
        return url_for("uploaded_file", filename=stored_filename)
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

    user.total_score += score
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

    user.total_score -= amount
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
    if points is None:
        return jsonify({"ok": False, "error": "invalid_code"}), 400

    if RedeemedCode.query.filter_by(user_id=user.id, code=code).first() is not None:
        return jsonify({"ok": False, "error": "already_redeemed"}), 400

    db.session.add(RedeemedCode(user_id=user.id, code=code))
    user.total_score += points
    db.session.commit()
    return jsonify({"ok": True, "points": points, "total_score": user.total_score})


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
        stored_filename = f"{uuid.uuid4().hex}.{extension}"
        save_media(file, "uploads", stored_filename)

        video = Video(
            title=title,
            description=description or None,
            filename=stored_filename,
            orientation=orientation,
            content_hash=content_hash,
            user_id=user.id,
        )
        db.session.add(video)
        user.total_score += UPLOAD_BONUS_POINTS
        db.session.commit()
        return redirect(url_for("watch", video_id=video.id))

    return render_template("upload.html", user=user)


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
        video.uploader.total_score = max(0, video.uploader.total_score - LIKE_BONUS_POINTS)
    else:
        db.session.add(Like(user_id=user.id, video_id=video.id))
        video.uploader.total_score += LIKE_BONUS_POINTS
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
        video.uploader.total_score = max(0, video.uploader.total_score - LIKE_BONUS_POINTS)
    else:
        db.session.add(Like(user_id=user.id, video_id=video.id))
        liked = True
        video.uploader.total_score += LIKE_BONUS_POINTS
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
    for content_hash, vids in by_hash.items():
        if len(vids) < 2:
            continue
        vids.sort(key=lambda v: v.created_at)
        original, duplicates = vids[0], vids[1:]
        for dup in duplicates:
            if dup.duplicate_penalty_applied:
                continue
            user = dup.uploader
            before = user.total_score
            after = max(0, before - OLD_UPLOAD_BONUS)
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


@app.route("/admin")
def admin_dashboard():
    admin_user = require_admin()
    users = User.query.order_by(User.username).all()
    videos = Video.query.order_by(Video.created_at.desc()).all()
    return render_template("admin.html", user=admin_user, users=users, videos=videos)


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


def seconds_since(moment):
    return (datetime.now(timezone.utc) - moment.replace(tzinfo=timezone.utc)).total_seconds()


@app.route("/shorts")
def shorts():
    user = current_user()
    videos = Video.query.filter_by(orientation="portrait").all()
    random.shuffle(videos)

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
