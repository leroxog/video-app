import os
import re
import uuid
import random
import logging
from datetime import datetime, timezone
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, send_from_directory, abort, flash, jsonify
)
from sqlalchemy import text
from werkzeug.utils import secure_filename
from models import db, User, Video, Pixel, Like, Subscription

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {"mp4", "webm", "ogg", "mov"}
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
PLACE_GRID_SIZE = 100
PLACE_COOLDOWN_SECONDS = 5
PLACE_SEARCH_TERM = "gigas/place"
TICTACTOE_SEARCH_TERM = "gigas/tic.tac.toe"
FRUITMERGE_SEARCH_TERM = "gigas/fruit.merge"
GRAVITYRUN_SEARCH_TERM = "gigas/gravity.run"
KNIFEHIT_SEARCH_TERM = "gigas/knife.hit"
GAME_SUGGESTIONS = [
    PLACE_SEARCH_TERM,
    TICTACTOE_SEARCH_TERM,
    FRUITMERGE_SEARCH_TERM,
    GRAVITYRUN_SEARCH_TERM,
    KNIFEHIT_SEARCH_TERM,
]
SCORED_GAMES = {"fruit.merge", "gravity.run", "knife.hit"}
HEX_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")

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

logger.warning(
    "HINWEIS: Videos werden lokal im Dateisystem gespeichert. Auf den meisten "
    "kostenlosen Hosting-Plattformen (z.B. Railway) ist dieser Speicher nicht "
    "dauerhaft und Videos koennen bei einem Neustart/Deploy verloren gehen."
)

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
    show_place_egg = query.lower() == PLACE_SEARCH_TERM
    show_tictactoe_egg = query.lower() == TICTACTOE_SEARCH_TERM
    show_fruitmerge_egg = query.lower() == FRUITMERGE_SEARCH_TERM
    show_gravityrun_egg = query.lower() == GRAVITYRUN_SEARCH_TERM
    show_knifehit_egg = query.lower() == KNIFEHIT_SEARCH_TERM
    any_egg = (
        show_place_egg or show_tictactoe_egg or show_fruitmerge_egg
        or show_gravityrun_egg or show_knifehit_egg
    )
    videos = []
    if not any_egg:
        videos_query = Video.query
        if query:
            videos_query = videos_query.filter(Video.title.ilike(f"%{query}%"))
        else:
            videos_query = videos_query.filter_by(orientation="landscape")
        videos = videos_query.order_by(Video.created_at.desc()).all()
    return render_template(
        "index.html",
        videos=videos,
        user=current_user(),
        query=query,
        show_place_egg=show_place_egg,
        show_tictactoe_egg=show_tictactoe_egg,
        show_fruitmerge_egg=show_fruitmerge_egg,
        show_gravityrun_egg=show_gravityrun_egg,
        show_knifehit_egg=show_knifehit_egg,
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
    return render_template("leaderboard.html", users=users, user=current_user())


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
            return render_template("upload.html")
        if not file or file.filename == "":
            flash("Bitte eine Videodatei auswaehlen.")
            return render_template("upload.html")
        if not allowed_file(file.filename):
            flash("Nur folgende Formate sind erlaubt: " + ", ".join(sorted(ALLOWED_EXTENSIONS)))
            return render_template("upload.html")

        extension = secure_filename(file.filename).rsplit(".", 1)[1].lower()
        stored_filename = f"{uuid.uuid4().hex}.{extension}"
        file.save(os.path.join(app.config["UPLOAD_FOLDER"], stored_filename))

        video = Video(
            title=title,
            description=description or None,
            filename=stored_filename,
            orientation=orientation,
            user_id=user.id,
        )
        db.session.add(video)
        db.session.commit()
        return redirect(url_for("watch", video_id=video.id))

    return render_template("upload.html")


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
    else:
        db.session.add(Like(user_id=user.id, video_id=video.id))
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
    else:
        db.session.add(Like(user_id=user.id, video_id=video.id))
        liked = True
    db.session.commit()
    return jsonify({"ok": True, "liked": liked, "like_count": len(video.likes)})


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
    try:
        os.remove(os.path.join(app.config["UPLOAD_FOLDER"], video.filename))
    except OSError:
        pass
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
        flash("Bitte ein Bild auswaehlen.")
        return redirect(url_for("profile", username=user.username))
    if not allowed_image_file(file.filename):
        flash("Nur folgende Bildformate sind erlaubt: " + ", ".join(sorted(ALLOWED_IMAGE_EXTENSIONS)))
        return redirect(url_for("profile", username=user.username))

    extension = secure_filename(file.filename).rsplit(".", 1)[1].lower()
    stored_filename = f"{uuid.uuid4().hex}.{extension}"
    file.save(os.path.join(app.config["PROFILE_PIC_FOLDER"], stored_filename))

    if user.profile_image:
        try:
            os.remove(os.path.join(app.config["PROFILE_PIC_FOLDER"], user.profile_image))
        except OSError:
            pass

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
        flash("Bitte eine gueltige E-Mail-Adresse angeben.")
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
    flash("Benutzername geaendert.")
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
    flash("Passwort geaendert.")
    return redirect(url_for("account_settings"))


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
        try:
            os.remove(os.path.join(app.config["UPLOAD_FOLDER"], video.filename))
        except OSError:
            pass
    if target.profile_image:
        try:
            os.remove(os.path.join(app.config["PROFILE_PIC_FOLDER"], target.profile_image))
        except OSError:
            pass

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
    return render_template("tictactoe.html", user=current_user())


@app.route("/fruitmerge")
def fruitmerge():
    return render_template("fruitmerge.html", user=current_user())


@app.route("/gravityrun")
def gravityrun():
    return render_template("gravityrun.html", user=current_user())


@app.route("/knifehit")
def knifehit():
    return render_template("knifehit.html", user=current_user())


@app.route("/place")
def place():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

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
