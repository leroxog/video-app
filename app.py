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
from werkzeug.utils import secure_filename
from models import db, User, Video, Pixel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {"mp4", "webm", "ogg", "mov"}
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

logger.warning(
    "HINWEIS: Videos werden lokal im Dateisystem gespeichert. Auf den meisten "
    "kostenlosen Hosting-Plattformen (z.B. Railway) ist dieser Speicher nicht "
    "dauerhaft und Videos koennen bei einem Neustart/Deploy verloren gehen."
)

db.init_app(app)

with app.app_context():
    db.create_all()


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def current_user():
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return db.session.get(User, user_id)


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


@app.route("/upload", methods=["GET", "POST"])
def upload():
    user = current_user()
    if user is None:
        return redirect(url_for("login"))

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        description = request.form.get("description", "").strip()
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

        video = Video(title=title, description=description or None, filename=stored_filename, user_id=user.id)
        db.session.add(video)
        db.session.commit()
        return redirect(url_for("watch", video_id=video.id))

    return render_template("upload.html")


@app.route("/video/<int:video_id>")
def watch(video_id):
    video = db.get_or_404(Video, video_id)
    return render_template("watch.html", video=video, user=current_user())


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(app.config["UPLOAD_FOLDER"], filename)


@app.route("/video/<int:video_id>/delete", methods=["POST"])
def delete_video(video_id):
    user = current_user()
    video = db.get_or_404(Video, video_id)
    if user is None or video.user_id != user.id:
        abort(403)
    try:
        os.remove(os.path.join(app.config["UPLOAD_FOLDER"], video.filename))
    except OSError:
        pass
    db.session.delete(video)
    db.session.commit()
    return redirect(url_for("index"))


def seconds_since(moment):
    return (datetime.now(timezone.utc) - moment.replace(tzinfo=timezone.utc)).total_seconds()


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
