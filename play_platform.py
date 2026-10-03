"""NRS Play: members publish small browser games, everyone plays them, ad revenue is shared.

Built so it can be used by people under 16:
  * games are one HTML file that runs in a locked-down frame (CSP sandbox + no network),
    and they only become public after an admin approved them;
  * no private messages, no personal data, a report button, and enough reports hide a game;
  * ads are NOT connected yet -- there is only a placeholder slot, and earnings shown to creators
    are clearly an *estimate*. A payout (to a parent's or adult's account) is not built.
"""
import re
from datetime import date, datetime, timezone

from flask import jsonify, render_template, request, abort, Response
from sqlalchemy.exc import IntegrityError

from models import db, PlayGame, PlayView, PlayReport, User
from play_demo import DEMO_GAMES

MAX_GAMES_PER_USER = 5
MAX_CODE_CHARS = 100_000
TITLE_MAX = 60
DESCRIPTION_MAX = 300
ACCENT_COUNT = 6
REPORTS_TO_HIDE = 3
LIST_LIMIT = 60
REPORT_REASONS = ("unpassend", "gewalt", "persoenliche-daten", "kopiert", "sonstiges")

# Estimated ad revenue per 1000 views for non-personalized (contextual) ads, and the creators' share.
AD_RPM_EUR = 0.80
CREATOR_SHARE = 0.50

TEAM_USERNAME = "nrs-team"  # '-' can't be registered by anyone (see PL_USERNAME_RE)

# Sent as real HTTP headers with every game, so a game's own markup can't switch them off.
# "sandbox" (without allow-same-origin) gives it an opaque origin: no cookies, no storage, no access
# to NRS. The rest blocks every network request and form post; only the game's own inline code runs.
GAME_CSP = (
    "sandbox allow-scripts allow-modals allow-pointer-lock; default-src 'none'; "
    "script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; "
    "font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"
)


def estimate_eur(views):
    """Estimated creator earnings in euros -- an estimate, not a promise."""
    return round(views / 1000 * AD_RPM_EUR * CREATOR_SHARE, 2)


def _today():
    return datetime.now(timezone.utc).date()


def _display_name(user):
    return (user.pl_display_name or user.username) if user else "Unbekannt"


def serialize_card(game):
    return {
        "id": game.id, "title": game.title, "description": game.description, "emoji": game.emoji,
        "accent": game.accent, "views": game.views, "author": _display_name(db.session.get(User, game.author_id)),
    }


def serialize_mine(game):
    return {**serialize_card(game), "status": game.status, "review_note": game.review_note,
            "earnings_eur": estimate_eur(game.views)}


def seed_demo_games():
    """Put the two bundled demo games on a fresh platform. Does nothing once any game exists."""
    if PlayGame.query.count():
        return
    team = User.query.filter_by(username=TEAM_USERNAME).first()
    if team is None:
        import secrets
        team = User(username=TEAM_USERNAME, pl_display_name="NRS Team", purpose_of_use="private")
        team.set_password(secrets.token_urlsafe(32))
        db.session.add(team)
        db.session.flush()
    for demo in DEMO_GAMES:
        db.session.add(PlayGame(author_id=team.id, status="published", **demo))
    db.session.commit()


def register_routes(app, current_user, is_guest):
    def _fail(error, status=400):
        return jsonify({"ok": False, "error": error}), status

    def _can_see(game, me):
        return game.status == "published" or game.author_id == me.id or bool(me.is_admin)

    def _clean_fields(data):
        """Validated game fields from a request body, or an error code."""
        title = (data.get("title") or "").strip()[:TITLE_MAX]
        code = data.get("code")
        if not title:
            return None, "empty_title"
        if not isinstance(code, str) or not code.strip():
            return None, "empty_code"
        if len(code) > MAX_CODE_CHARS:
            return None, "code_too_long"
        try:
            accent = max(0, min(ACCENT_COUNT - 1, int(data.get("accent", 0))))
        except (TypeError, ValueError):
            accent = 0
        emoji = (data.get("emoji") or "").strip()[:4] or "🎮"
        return {"title": title, "description": (data.get("description") or "").strip()[:DESCRIPTION_MAX],
                "code": code, "accent": accent, "emoji": emoji}, None

    # ------------------------------------------------------------- pages

    @app.route("/spiele")
    def pl_play():
        me = current_user()
        return render_template("pl_play.html", is_guest=is_guest(me), is_admin=bool(me.is_admin),
                               username=_display_name(me), rpm=AD_RPM_EUR, share=int(CREATOR_SHARE * 100),
                               max_games=MAX_GAMES_PER_USER)

    @app.route("/spiele/<int:game_id>")
    def pl_play_game(game_id):
        game = db.session.get(PlayGame, game_id)
        me = current_user()
        if game is None or not _can_see(game, me):
            abort(404)
        return render_template("pl_play_game.html", game=serialize_card(game), status=game.status,
                               is_guest=is_guest(me))

    @app.route("/spiele/frame/<int:game_id>")
    def play_frame(game_id):
        """The game itself, served as its own document with locked-down headers."""
        game = db.session.get(PlayGame, game_id)
        if game is None or not _can_see(game, current_user()):
            abort(404)
        return Response(game.code, mimetype="text/html", headers={
            "Content-Security-Policy": GAME_CSP, "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer", "Cache-Control": "no-store",
        })

    # --------------------------------------------------------- public API

    @app.route("/api/play/games")
    def api_play_games():
        query = PlayGame.query.filter_by(status="published")
        order = PlayGame.views.desc() if request.args.get("sort") == "popular" else PlayGame.id.desc()
        games = query.order_by(order, PlayGame.id.desc()).limit(LIST_LIMIT).all()
        return jsonify({"ok": True, "games": [serialize_card(g) for g in games]})

    @app.route("/api/play/games/<int:game_id>/view", methods=["POST"])
    def api_play_view(game_id):
        game = db.session.get(PlayGame, game_id)
        me = current_user()
        if game is None or game.status != "published":
            return _fail("not_found", 404)
        counted = False
        if me.id != game.author_id:
            db.session.add(PlayView(game_id=game.id, viewer_key=f"u{me.id}", day=_today()))
            try:
                game.views += 1
                db.session.commit()
                counted = True
            except IntegrityError:
                db.session.rollback()
                game = db.session.get(PlayGame, game_id)
        return jsonify({"ok": True, "counted": counted, "views": game.views})

    @app.route("/api/play/games/<int:game_id>/report", methods=["POST"])
    def api_play_report(game_id):
        game = db.session.get(PlayGame, game_id)
        me = current_user()
        if game is None or game.status != "published":
            return _fail("not_found", 404)
        reason = (request.get_json(silent=True) or {}).get("reason")
        if reason not in REPORT_REASONS:
            reason = "sonstiges"
        if PlayReport.query.filter_by(game_id=game.id, reporter_id=me.id).first() is None:
            db.session.add(PlayReport(game_id=game.id, reporter_id=me.id, reason=reason, from_member=not is_guest(me)))
            db.session.flush()
            # Only real accounts can hide a game, so anonymous guests can't silence others by rotating cookies.
            if PlayReport.query.filter_by(game_id=game.id, from_member=True).count() >= REPORTS_TO_HIDE:
                game.status = "hidden"
            db.session.commit()
        return jsonify({"ok": True})

    # ---------------------------------------------------- creator API (accounts only)

    @app.route("/api/play/mine")
    def api_play_mine():
        me = current_user()
        games = PlayGame.query.filter_by(author_id=me.id).order_by(PlayGame.id.desc()).all()
        views = sum(g.views for g in games)
        return jsonify({"ok": True, "games": [serialize_mine(g) for g in games],
                        "totals": {"games": len(games), "views": views, "earnings_eur": estimate_eur(views)}})

    @app.route("/api/play/games", methods=["POST"])
    def api_play_create():
        me = current_user()
        fields, error = _clean_fields(request.get_json(silent=True) or {})
        if error:
            return _fail(error)
        if PlayGame.query.filter_by(author_id=me.id).count() >= MAX_GAMES_PER_USER:
            return _fail("limit_reached")
        game = PlayGame(author_id=me.id, status="pending", **fields)
        db.session.add(game)
        db.session.commit()
        return jsonify({"ok": True, "game": serialize_mine(game)})

    def _own_game(me, game_id):
        game = db.session.get(PlayGame, game_id)
        return game if game is not None and game.author_id == me.id else None

    @app.route("/api/play/games/<int:game_id>/source")
    def api_play_source(game_id):
        game = _own_game(current_user(), game_id)
        if game is None:
            return _fail("not_found", 404)
        return jsonify({"ok": True, "game": {"title": game.title, "description": game.description,
                                             "code": game.code, "emoji": game.emoji, "accent": game.accent}})

    @app.route("/api/play/games/<int:game_id>", methods=["PUT"])
    def api_play_update(game_id):
        game = _own_game(current_user(), game_id)
        if game is None:
            return _fail("not_found", 404)
        fields, error = _clean_fields(request.get_json(silent=True) or {})
        if error:
            return _fail(error)
        for key, value in fields.items():
            setattr(game, key, value)
        game.status = "pending"
        game.review_note = ""
        PlayReport.query.filter_by(game_id=game.id).delete()
        db.session.commit()
        return jsonify({"ok": True, "game": serialize_mine(game)})

    @app.route("/api/play/games/<int:game_id>", methods=["DELETE"])
    def api_play_delete(game_id):
        me = current_user()
        game = db.session.get(PlayGame, game_id)
        if game is None or (game.author_id != me.id and not me.is_admin):
            return _fail("not_found", 404)
        PlayView.query.filter_by(game_id=game.id).delete()
        PlayReport.query.filter_by(game_id=game.id).delete()
        db.session.delete(game)
        db.session.commit()
        return jsonify({"ok": True})

    # ------------------------------------------------------------ admin review

    @app.route("/api/play/review")
    def api_play_review_list():
        me = current_user()
        if not me.is_admin:
            return _fail("forbidden", 403)
        games = PlayGame.query.filter(PlayGame.status.in_(("pending", "hidden"))).order_by(PlayGame.id).all()
        return jsonify({"ok": True, "games": [
            {**serialize_card(g), "status": g.status,
             "reports": PlayReport.query.filter_by(game_id=g.id).count()} for g in games]})

    @app.route("/api/play/games/<int:game_id>/review", methods=["POST"])
    def api_play_review(game_id):
        me = current_user()
        if not me.is_admin:
            return _fail("forbidden", 403)
        game = db.session.get(PlayGame, game_id)
        if game is None:
            return _fail("not_found", 404)
        data = request.get_json(silent=True) or {}
        if data.get("decision") == "approve":
            game.status = "published"
            game.review_note = ""
            PlayReport.query.filter_by(game_id=game.id).delete()
        elif data.get("decision") == "reject":
            game.status = "rejected"
            game.review_note = (data.get("note") or "").strip()[:200]
        else:
            return _fail("bad_decision")
        db.session.commit()
        return jsonify({"ok": True, "game": serialize_mine(game)})
