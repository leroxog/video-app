import os
import uuid
import logging
from flask import (
    Flask, render_template, request, redirect, url_for,
    session, send_from_directory, abort, flash
)
from werkzeug.utils import secure_filename
from models import db, User, Video

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {"mp4", "webm", "ogg", "mov"}

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
    videos = Video.query.order_by(Video.created_at.desc()).all()
    return render_template("index.html", videos=videos, user=current_user())


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

        video = Video(title=title, filename=stored_filename, user_id=user.id)
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


if __name__ == "__main__":
    app.run(debug=True)
