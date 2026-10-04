"""NRS Sound: an AI song studio -- pick a genre, a length and a name, describe the song, optionally
add lyrics, press create.

How a song is made (and what is honestly "AI" here):
  * our AI (the same Groq model that powers Nex) reads the description and writes the *plan* of the
    song -- tempo, key, scale, chord progression, a mood, a color palette -- plus the lyrics when the
    song is sung and none were entered, and the description of a cover picture;
  * an image model paints the cover from that description (with a generated fallback);
  * the music itself is synthesized in the listener's browser from the plan (static/js/nrs-synth.js).
    There is no neural audio model here, and "sung" songs use the browser's computer voice.
Because only the small plan is stored, a song costs a few hundred bytes. All songs are CC BY 4.0.
"""
import io
import json
import logging
import re
import threading
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone

import requests
from flask import jsonify, request, abort, render_template
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from werkzeug.datastructures import FileStorage

import ai_assistant
from models import db, Song, SongPlay, SongLike, SongReport, User

logger = logging.getLogger(__name__)

MIN_SECONDS = 15
MAX_SECONDS = 150
TITLE_MAX = 60
DESCRIPTION_MAX = 300
LYRICS_MAX = 1500
MAX_SONGS_PER_USER = 15
MAX_CREATED_PER_HOUR = 5
MAX_CONCURRENT_JOBS = 2
REPORTS_TO_HIDE = 3
LIST_LIMIT = 60
STALE_JOB_MINUTES = 5
COVER_MAX_BYTES = 2_000_000
LICENSE = "CC BY 4.0"
REPORT_REASONS = ("unpassend", "gewalt", "persoenliche-daten", "kopiert", "sonstiges")

NOTES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
SCALES = ("major", "minor", "dorian", "pentatonic")
QUALITIES = ("maj", "min", "maj7", "min7", "dom7", "sus2")
HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")

# label/emoji for the UI; bpm range, scales, chord progressions ((degree, quality) ...) and colors for the planner
GENRES = {
    "pop": {"label": "Pop", "emoji": "🎤", "bpm": (100, 124), "scales": ("major", "minor"), "swing": 0.0,
            "progs": [[(1, "maj"), (5, "maj"), (6, "min"), (4, "maj")], [(6, "min"), (4, "maj"), (1, "maj"), (5, "maj")]],
            "colors": ["#ff5fa2", "#ffb36b", "#6b5bff"], "cover": "bright pastel gradient, glossy shapes, sunny pop energy"},
    "lofi": {"label": "Lo-Fi", "emoji": "🌙", "bpm": (70, 88), "scales": ("major", "dorian"), "swing": 0.14,
             "progs": [[(2, "min7"), (5, "dom7"), (1, "maj7"), (6, "min7")], [(1, "maj7"), (6, "min7"), (2, "min7"), (5, "dom7")]],
             "colors": ["#7b6cff", "#2fd1c5", "#ffb4c8"], "cover": "cozy night window, soft purple and teal haze, rain"},
    "hiphop": {"label": "Hip-Hop", "emoji": "🎧", "bpm": (82, 98), "scales": ("minor",), "swing": 0.08,
               "progs": [[(1, "min"), (6, "maj"), (7, "maj"), (1, "min")], [(1, "min"), (4, "min"), (6, "maj"), (5, "maj")]],
               "colors": ["#ffcc33", "#ff5a3c", "#2a2a3a"], "cover": "bold geometric street art shapes, gold and black"},
    "house": {"label": "House", "emoji": "🪩", "bpm": (120, 128), "scales": ("minor", "dorian"), "swing": 0.0,
              "progs": [[(1, "min7"), (1, "min7"), (6, "maj7"), (7, "maj")], [(1, "min"), (4, "min"), (6, "maj"), (5, "maj")]],
              "colors": ["#00e5ff", "#ff2fd1", "#3a2cff"], "cover": "neon club lights, glowing geometric grid, dancefloor"},
    "rock": {"label": "Rock", "emoji": "🎸", "bpm": (112, 140), "scales": ("minor", "major"), "swing": 0.0,
             "progs": [[(1, "min"), (6, "maj"), (3, "maj"), (7, "maj")], [(1, "maj"), (4, "maj"), (5, "maj"), (4, "maj")]],
             "colors": ["#ff3b3b", "#ff9f1c", "#1d1d2b"], "cover": "dramatic stage lights, bold red and black shapes, smoke"},
    "ambient": {"label": "Ambient", "emoji": "🌌", "bpm": (60, 76), "scales": ("major", "dorian"), "swing": 0.0,
                "progs": [[(1, "maj7"), (4, "maj7"), (6, "min7"), (5, "sus2")], [(1, "sus2"), (6, "min7"), (4, "maj7"), (5, "sus2")]],
                "colors": ["#4ad7d1", "#7aa2ff", "#d6b3ff"], "cover": "misty mountains at dawn, soft glowing light, calm"},
    "cinematic": {"label": "Filmmusik", "emoji": "🎬", "bpm": (70, 100), "scales": ("minor",), "swing": 0.0,
                  "progs": [[(1, "min"), (6, "maj"), (3, "maj"), (7, "maj")], [(1, "min"), (4, "min"), (6, "maj"), (5, "maj")]],
                  "colors": ["#ffb454", "#3b5bdb", "#101426"], "cover": "epic sky with golden light rays over a vast landscape"},
    "chiptune": {"label": "Chiptune", "emoji": "👾", "bpm": (120, 150), "scales": ("major", "minor"), "swing": 0.0,
                 "progs": [[(1, "maj"), (5, "maj"), (6, "min"), (4, "maj")], [(6, "min"), (4, "maj"), (1, "maj"), (5, "maj")]],
                 "colors": ["#5dff8f", "#ff5d73", "#5d8bff"], "cover": "pixel art landscape, retro arcade colors, 8-bit"},
}

_MOOD_WORDS = {
    "minor": ("traurig", "dunkel", "düster", "regen", "melanchol", "nacht", "sad", "dark", "rain", "einsam", "kalt"),
    "major": ("fröhlich", "froh", "sonne", "party", "happy", "sommer", "glücklich", "bunt", "lachen", "spaß"),
    "slow": ("ruhig", "entspann", "chill", "sanft", "schlaf", "langsam", "calm", "relax"),
    "fast": ("schnell", "energie", "wild", "action", "rennen", "power", "fast", "tanz"),
}


# ------------------------------------------------------------------ plan

def _int_in(value, low, high, default):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return default


def _description_hints(text):
    lowered = (text or "").lower()
    return {name: any(word in lowered for word in words) for name, words in _MOOD_WORDS.items()}


def fallback_plan(genre, description, duration, seed):
    """A sensible plan without the AI: the genre's presets, nudged by mood words in the description."""
    preset = GENRES[genre]
    hints = _description_hints(description)
    low, high = preset["bpm"]
    bpm = low + (high - low) // 2
    if hints["slow"] and not hints["fast"]:
        bpm = low
    elif hints["fast"] and not hints["slow"]:
        bpm = high
    scale = preset["scales"][0]
    if hints["major"] and "major" in preset["scales"]:
        scale = "major"
    elif hints["minor"] and "minor" in preset["scales"]:
        scale = "minor"
    return {
        "bpm": bpm, "key": NOTES[seed % 12], "scale": scale,
        "progression": [list(c) for c in preset["progs"][seed % len(preset["progs"])]],
        "swing": preset["swing"], "mood": "", "palette": list(preset["colors"]),
    }


def clean_plan(raw, genre, duration, seed, description=""):
    """The plan the synthesizer will read: every field checked and clamped, with the genre's presets
    filling in whatever the AI got wrong. The browser never sees unvalidated AI output."""
    preset = GENRES[genre]
    base = fallback_plan(genre, description, duration, seed)
    raw = raw if isinstance(raw, dict) else {}
    low, high = preset["bpm"]
    scale = raw.get("scale") if raw.get("scale") in SCALES else base["scale"]
    progression = []
    for item in raw.get("progression") if isinstance(raw.get("progression"), list) else []:
        if isinstance(item, (list, tuple)) and len(item) == 2 and item[1] in QUALITIES:
            degree = _int_in(item[0], 1, 7, 0)
            if degree:
                progression.append([degree, item[1]])
    if not 2 <= len(progression) <= 8:
        progression = base["progression"]
    palette = [c for c in (raw.get("palette") if isinstance(raw.get("palette"), list) else [])
               if isinstance(c, str) and HEX_RE.fullmatch(c)][:3]
    try:
        swing = max(0.0, min(0.3, float(raw.get("swing", base["swing"]))))
    except (TypeError, ValueError):
        swing = base["swing"]
    mood = raw.get("mood") if isinstance(raw.get("mood"), str) else ""
    return {
        "v": 1, "genre": genre, "duration": duration, "seed": seed,
        "bpm": _int_in(raw.get("bpm"), low - 8, high + 8, base["bpm"]),
        "key": raw.get("key") if raw.get("key") in NOTES else base["key"],
        "scale": scale, "progression": progression, "swing": swing,
        "mood": re.sub(r"[^\w\s-]", "", mood)[:30].strip(),
        "palette": palette if len(palette) == 3 else base["palette"],
    }


def clean_lyrics(text):
    if not isinstance(text, str):
        return ""
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.replace("\r", "").split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()[:LYRICS_MAX]


def clean_cover_prompt(text, genre):
    """An English picture description for the image model. It is built from the AI's own words or
    the genre's preset, never from what a user typed, and always asks for no text and no people."""
    base = text if isinstance(text, str) else ""
    base = re.sub(r"[^A-Za-z0-9 ,.'-]", " ", base)
    base = re.sub(r"\s+", " ", base).strip()[:160] or GENRES[genre]["cover"]
    return base + ", album cover art, abstract, no text, no letters, no people, family friendly"


# ------------------------------------------------------------ AI helpers

def _extract_json(text):
    if not isinstance(text, str):
        return None
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def llm_compose(song):
    """Ask our AI for the song's plan, cover picture description and (if needed) lyrics.
    Returns a dict, or None when the AI is unavailable -- the fallback planner then steps in."""
    needs_lyrics = song.with_vocals and not song.lyrics
    lines = max(4, min(16, song.duration // 8))
    system = (
        "Du bist ein Komponist und Texter für eine Musikplattform, auch für Kinder und Jugendliche. "
        "Antworte AUSSCHLIESSLICH mit einem JSON-Objekt, ohne Text davor oder danach. Felder: "
        '"bpm" (Zahl), "key" (einer von ' + ", ".join(NOTES) + '), "scale" (einer von ' + ", ".join(SCALES) + '), '
        '"progression" (Liste aus 4 Paaren [Stufe 1-7, Akkordart], Akkordart einer von ' + ", ".join(QUALITIES) + '), '
        '"swing" (0 bis 0.3), "mood" (1-2 Wörter), "palette" (3 Hex-Farben wie #aabbcc), '
        '"cover_prompt" (englische Beschreibung eines schönen, abstrakten Bildes ohne Text und ohne Personen)'
        + (', "lyrics" (' + str(lines) + ' Zeilen Songtext, ganz neu geschrieben, reimend, kindgerecht; '
           'zitiere keine bestehenden Lieder)' if needs_lyrics else "") + "."
    )
    user = (
        f"Genre: {GENRES[song.genre]['label']}. Länge: {song.duration} Sekunden. Titel: {song.title}. "
        f"Beschreibung: {song.description or 'keine'}. Wähle Tempo und Akkorde passend zum Genre und zur Stimmung."
    )
    try:
        reply = ai_assistant._generate_groq(
            [{"role": "system", "content": system}, {"role": "user", "content": user}],
            max_tokens=2500, temperature=0.7,
        )
    except Exception:
        logger.warning("Songplan: KI nicht erreichbar, nehme die eingebaute Regel.", exc_info=True)
        return None
    return _extract_json(reply)


def moderate(song):
    """True if the title, description and lyrics are fine for a platform with young users.
    If the AI can't be reached the text is let through; reports and hiding are the safety net."""
    text = "\n".join(part for part in (song.title, song.description, song.lyrics) if part)
    system = (
        "Du prüfst Texte für eine Musikplattform, die auch Kinder ab 10 Jahren nutzen. Erlaubt ist alles "
        "Kindgerechte. Nicht erlaubt: Beleidigungen, Hass, Gewalt, Sexuelles, Drogen, persönliche Daten "
        "(echte Namen, Adressen, Telefonnummern), Werbung. Antworte nur mit JSON: "
        '{"ok": true} oder {"ok": false}.'
    )
    try:
        reply = ai_assistant._generate_groq(
            [{"role": "system", "content": system}, {"role": "user", "content": text}],
            max_tokens=400, temperature=0,
        )
    except Exception:
        logger.warning("Songprüfung: KI nicht erreichbar, Text wird durchgelassen.", exc_info=True)
        return True
    verdict = _extract_json(reply)
    return not (verdict and verdict.get("ok") is False)


def fetch_cover(prompt, seed):
    """JPEG/PNG bytes of an AI-painted cover from the free Pollinations image service, or None."""
    url = "https://image.pollinations.ai/prompt/" + urllib.parse.quote(prompt)
    try:
        r = requests.get(url, params={"width": 512, "height": 512, "nologo": "true", "safe": "true", "seed": seed},
                         timeout=40, stream=True)
        data = r.raw.read(COVER_MAX_BYTES + 1, decode_content=True) if r.status_code == 200 else b""
    except requests.RequestException:
        return None
    if not data or len(data) > COVER_MAX_BYTES:
        return None
    if data[:3] == b"\xff\xd8\xff" or data[:8] == b"\x89PNG\r\n\x1a\n":
        return data
    return None


# ------------------------------------------------------------------ jobs

_hooks = {"store_media": None, "media_url": None, "delete_media": None}


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def run_job(song_id):
    """Compose one song: check the texts, plan it, write lyrics if needed, paint the cover.
    Needs an app context. Always ends with the song 'ready' or 'failed'."""
    song = db.session.get(Song, song_id)
    if song is None:
        return

    def fail(message):
        song.status, song.error = "failed", message
        db.session.commit()

    try:
        if not moderate(song):
            return fail("Titel, Beschreibung oder Text sind hier nicht erlaubt. Bitte ändere sie.")
        raw = llm_compose(song) or {}
        seed = int(uuid.uuid4().int % 2_000_000_000)
        plan = clean_plan(raw, song.genre, song.duration, seed, song.description)
        if song.with_vocals and not song.lyrics:
            song.lyrics = clean_lyrics(raw.get("lyrics"))
            if not song.lyrics:
                return fail("Der Text konnte gerade nicht geschrieben werden. Versuch es später noch einmal.")
        cover = fetch_cover(clean_cover_prompt(raw.get("cover_prompt"), song.genre), seed)
        if cover:
            extension = "png" if cover[:4] == b"\x89PNG" else "jpg"
            name = f"cover-{uuid.uuid4().hex}.{extension}"
            _hooks["store_media"](FileStorage(stream=io.BytesIO(cover), filename=name), name)
            song.cover_name = name
        song.plan = json.dumps(plan)
        song.status, song.error = "ready", ""
        db.session.commit()
    except Exception:
        logger.exception("Song %s konnte nicht erstellt werden.", song_id)
        db.session.rollback()
        song = db.session.get(Song, song_id)
        if song is not None:
            fail("Beim Erstellen ist etwas schiefgegangen. Versuch es noch einmal.")


def start_job(app, song_id):
    def work():
        with app.app_context():
            try:
                run_job(song_id)
            except Exception:
                logger.exception("Song-Auftrag %s abgebrochen.", song_id)
            finally:
                db.session.remove()
    threading.Thread(target=work, name=f"song-{song_id}", daemon=True).start()


def fail_stale_jobs():
    """Songs still 'composing' after a few minutes lost their worker (a restart) -- mark them failed."""
    stale = Song.query.filter(Song.status == "composing", Song.created_at < _now() - timedelta(minutes=STALE_JOB_MINUTES)).all()
    for song in stale:
        song.status, song.error = "failed", "Abgebrochen. Bitte erstelle den Song noch einmal."
    if stale:
        db.session.commit()


# ---------------------------------------------------------------- routes

def _display_name(user):
    return (user.pl_display_name or user.username) if user else "Unbekannt"


def register_routes(app, current_user, is_guest, store_media, media_url, delete_media):
    _hooks.update(store_media=store_media, media_url=media_url, delete_media=delete_media)

    def _fail(error, status=400):
        return jsonify({"ok": False, "error": error}), status

    def serialize(song, creators=None, likes=None, liked=None):
        creator = (creators or {}).get(song.creator_id) or db.session.get(User, song.creator_id)
        try:
            plan = json.loads(song.plan or "{}")
        except ValueError:
            plan = {}
        preset = GENRES.get(song.genre, GENRES["pop"])
        return {
            "id": song.id, "title": song.title, "genre": song.genre, "genre_label": preset["label"],
            "emoji": preset["emoji"], "duration": song.duration, "description": song.description,
            "with_vocals": song.with_vocals, "plays": song.plays, "creator": _display_name(creator),
            "cover_url": media_url(song.cover_name) if song.cover_name else None, "plan": plan,
            "status": song.status, "error": song.error, "license": LICENSE,
            "likes": (likes or {}).get(song.id, 0), "liked": song.id in (liked or set()),
            "palette": plan.get("palette") or preset["colors"],
        }

    def serialize_many(songs, me):
        ids = [s.id for s in songs]
        creators = {u.id: u for u in User.query.filter(User.id.in_({s.creator_id for s in songs})).all()} if songs else {}
        likes = dict(db.session.query(SongLike.song_id, func.count(SongLike.id)).filter(SongLike.song_id.in_(ids))
                     .group_by(SongLike.song_id).all()) if ids else {}
        liked = {row[0] for row in db.session.query(SongLike.song_id).filter(
            SongLike.user_id == me.id, SongLike.song_id.in_(ids)).all()} if ids else set()
        return [serialize(s, creators, likes, liked) for s in songs]

    def _can_see(song, me):
        return song.status == "ready" or song.creator_id == me.id or bool(me.is_admin)

    @app.route("/api/music/genres")
    def api_music_genres():
        return jsonify({"ok": True, "min_seconds": MIN_SECONDS, "max_seconds": MAX_SECONDS, "genres": [
            {"id": key, "label": g["label"], "emoji": g["emoji"], "colors": g["colors"]} for key, g in GENRES.items()]})

    @app.route("/api/music/songs")
    def api_music_songs():
        me = current_user()
        query = Song.query.filter_by(status="ready")
        genre = request.args.get("genre")
        if genre in GENRES:
            query = query.filter_by(genre=genre)
        text = (request.args.get("q") or "").strip()[:60]
        if text:
            like = "%" + text.replace("%", "").replace("_", "") + "%"
            query = query.filter(db.or_(Song.title.ilike(like), Song.description.ilike(like)))
        order = Song.plays.desc() if request.args.get("sort") == "popular" else Song.id.desc()
        songs = query.order_by(order, Song.id.desc()).limit(LIST_LIMIT).all()
        return jsonify({"ok": True, "songs": serialize_many(songs, me)})

    @app.route("/api/music/songs/<int:song_id>")
    def api_music_song(song_id):
        me = current_user()
        song = db.session.get(Song, song_id)
        if song is None or not _can_see(song, me):
            return _fail("not_found", 404)
        data = serialize_many([song], me)[0]
        data["lyrics"] = song.lyrics
        return jsonify({"ok": True, "song": data})

    @app.route("/api/music/songs", methods=["POST"])
    def api_music_create():
        me = current_user()
        data = request.get_json(silent=True) or {}
        title = (data.get("title") or "").strip()[:TITLE_MAX]
        genre = data.get("genre")
        try:
            duration = int(data.get("duration"))
        except (TypeError, ValueError):
            return _fail("bad_duration")
        if not title:
            return _fail("empty_title")
        if genre not in GENRES:
            return _fail("bad_genre")
        if not MIN_SECONDS <= duration <= MAX_SECONDS:
            return _fail("bad_duration")
        vocals = bool(data.get("with_vocals"))
        lyrics = clean_lyrics(data.get("lyrics")) if vocals else ""
        if lyrics and data.get("own_lyrics") is not True:
            return _fail("lyrics_confirm")
        if Song.query.filter_by(creator_id=me.id).count() >= MAX_SONGS_PER_USER:
            return _fail("limit_reached")
        hour_ago = _now() - timedelta(hours=1)
        if Song.query.filter(Song.creator_id == me.id, Song.created_at > hour_ago).count() >= MAX_CREATED_PER_HOUR:
            return _fail("rate_limited", 429)
        if Song.query.filter_by(status="composing").count() >= MAX_CONCURRENT_JOBS:
            return _fail("busy", 429)
        song = Song(creator_id=me.id, title=title, genre=genre, duration=duration, with_vocals=vocals, lyrics=lyrics,
                    description=(data.get("description") or "").strip()[:DESCRIPTION_MAX])
        db.session.add(song)
        db.session.commit()
        start_job(app, song.id)
        return jsonify({"ok": True, "song": serialize_many([song], me)[0]})

    @app.route("/api/music/library")
    def api_music_library():
        me = current_user()
        fail_stale_jobs()
        mine = Song.query.filter_by(creator_id=me.id).order_by(Song.id.desc()).all()
        liked_ids = [row[0] for row in db.session.query(SongLike.song_id).filter_by(user_id=me.id).all()]
        liked = Song.query.filter(Song.id.in_(liked_ids), Song.status == "ready").order_by(Song.id.desc()).all() if liked_ids else []
        result = {"ok": True, "mine": serialize_many(mine, me), "liked": serialize_many(liked, me)}
        if me.is_admin:
            hidden = Song.query.filter_by(status="hidden").order_by(Song.id).all()
            result["hidden"] = serialize_many(hidden, me)
        return jsonify(result)

    @app.route("/api/music/songs/<int:song_id>/play", methods=["POST"])
    def api_music_play(song_id):
        me = current_user()
        song = db.session.get(Song, song_id)
        if song is None or song.status != "ready":
            return _fail("not_found", 404)
        counted = False
        if me.id != song.creator_id:
            db.session.add(SongPlay(song_id=song.id, listener_key=f"u{me.id}", day=_now().date()))
            try:
                song.plays += 1
                db.session.commit()
                counted = True
            except IntegrityError:
                db.session.rollback()
                song = db.session.get(Song, song_id)
        return jsonify({"ok": True, "counted": counted, "plays": song.plays})

    @app.route("/api/music/songs/<int:song_id>/like", methods=["POST"])
    def api_music_like(song_id):
        me = current_user()
        song = db.session.get(Song, song_id)
        if song is None or song.status != "ready":
            return _fail("not_found", 404)
        existing = SongLike.query.filter_by(song_id=song.id, user_id=me.id).first()
        if existing is None:
            db.session.add(SongLike(song_id=song.id, user_id=me.id))
        else:
            db.session.delete(existing)
        db.session.commit()
        return jsonify({"ok": True, "liked": existing is None,
                        "likes": SongLike.query.filter_by(song_id=song.id).count()})

    @app.route("/api/music/songs/<int:song_id>/report", methods=["POST"])
    def api_music_report(song_id):
        me = current_user()
        song = db.session.get(Song, song_id)
        if song is None or song.status != "ready":
            return _fail("not_found", 404)
        reason = (request.get_json(silent=True) or {}).get("reason")
        if reason not in REPORT_REASONS:
            reason = "sonstiges"
        if SongReport.query.filter_by(song_id=song.id, reporter_id=me.id).first() is None:
            db.session.add(SongReport(song_id=song.id, reporter_id=me.id, reason=reason, from_member=not is_guest(me)))
            db.session.flush()
            # Only real accounts can hide a song, so anonymous guests can't silence others by rotating cookies.
            if SongReport.query.filter_by(song_id=song.id, from_member=True).count() >= REPORTS_TO_HIDE:
                song.status = "hidden"
            db.session.commit()
        return jsonify({"ok": True})

    @app.route("/api/music/songs/<int:song_id>/restore", methods=["POST"])
    def api_music_restore(song_id):
        me = current_user()
        if not me.is_admin:
            return _fail("forbidden", 403)
        song = db.session.get(Song, song_id)
        if song is None:
            return _fail("not_found", 404)
        song.status = "ready"
        SongReport.query.filter_by(song_id=song.id).delete()
        db.session.commit()
        return jsonify({"ok": True})

    @app.route("/api/music/songs/<int:song_id>", methods=["DELETE"])
    def api_music_delete(song_id):
        me = current_user()
        song = db.session.get(Song, song_id)
        if song is None or (song.creator_id != me.id and not me.is_admin):
            return _fail("not_found", 404)
        if song.cover_name:
            delete_media(song.cover_name)
        for model in (SongPlay, SongLike, SongReport):
            model.query.filter_by(song_id=song.id).delete()
        db.session.delete(song)
        db.session.commit()
        return jsonify({"ok": True})
