"""Treff: groups where everybody can talk about one thing, without an account.  This is the home page of the site.

Anybody can start a group (a topic) and anybody can write in it.  Nobody signs up: the first time somebody writes, the server gives their
browser a number of six digits (never the same twice) and a secret key that the browser keeps; on the page they are "user 482913".  The
server keeps only a hash of the key.  Every group has "Fakten!" (a list of things worth keeping, for example the address of a Minecraft
server), messages can be marked "Wichtig!", answered, reacted to, saved as a fact, and reported.  The scripts are static/js/treff*.js.
"""
import hashlib
import json
import os
import re
import secrets
import unicodedata
from datetime import datetime, timezone

from flask import Response, jsonify, make_response, render_template, request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError

from models import db
from siteauth import RateLimiter, client_addresses, same_origin

SITE_NAME = "Treff"
DESCRIPTION = "Treff: Gruppen zu jedem Thema, in denen alle mitreden können, ohne Konto. Mit „Fakten!“ für das, was jeder wissen muss, zum Beispiel die Adresse eines Minecraft-Servers."

MAX_GROUP_NAME = 40
MIN_GROUP_NAME = 2
MAX_DESCRIPTION = 300
MAX_MESSAGE = 2000
MAX_FACT_TITLE = 60
MAX_FACT_VALUE = 600
MAX_FACTS = 60
MAX_REASON = 200
MAX_LINKS = 6
PAGE = 60
GROUP_LIST = 300
REACTIONS = ("👍", "❤️", "😂", "😮", "🙏", "✅")
NUMBER_LOW, NUMBER_HIGH = 100000, 999999            # six digits, so that "user 482913" always looks the same
HEADER = "X-Treff-Key"

CONTROL_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​‎‏‪-‮⁠-⁤﻿]")
URL_RE = re.compile(r"https?://[^\s<>\"']+", re.I)

LIMITS = {
    "identity": (8, 3600), "identity-flood": (300, 3600),
    "message-burst": (8, 20), "message-hour": (240, 3600), "group-hour": (4, 3600), "group-ip": (10, 3600), "fact-hour": (40, 3600),
    "react": (150, 600), "report": (20, 3600), "edit": (60, 3600), "admin": (30, 600),
}
_hits = {}
limiter = RateLimiter(LIMITS, _hits)

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; "
    "connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), interest-cohort=()"
ENDPOINTS = set()           # filled by register_routes: every endpoint of this module (the site's login gate must let them through)


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(moment):
    return moment.isoformat() + "Z" if moment else None


# ------------------------------------------------------------------------------------------------------ tables
class TreffUser(db.Model):
    """Somebody who wrote something: a number (shown as "user 482913") and the hash of the secret key their browser keeps."""
    __tablename__ = "treff_user"
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.Integer, nullable=False, unique=True, index=True)
    key_hash = db.Column(db.String(64), nullable=False, unique=True, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    last_seen_at = db.Column(db.DateTime, nullable=True)


class TreffGroup(db.Model):
    __tablename__ = "treff_group"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    name_lc = db.Column(db.String(80), nullable=False, unique=True, index=True)
    description = db.Column(db.Text, nullable=False, default="")
    creator_id = db.Column(db.Integer, nullable=False, index=True)
    facts_open = db.Column(db.Boolean, nullable=False, default=True)             # may everybody add facts, or only the one who made the group?
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    last_activity_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
    message_count = db.Column(db.Integer, nullable=False, default=0)
    fact_count = db.Column(db.Integer, nullable=False, default=0)
    last_message_id = db.Column(db.Integer, nullable=False, default=0)


class TreffMessage(db.Model):
    __tablename__ = "treff_message"
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.Text, nullable=False)
    reply_to_id = db.Column(db.Integer, nullable=True)
    important = db.Column(db.Boolean, nullable=False, default=False, index=True)
    deleted = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class TreffReaction(db.Model):
    __tablename__ = "treff_reaction"
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False)
    emoji = db.Column(db.String(16), nullable=False)
    __table_args__ = (db.UniqueConstraint("message_id", "user_id", "emoji", name="treff_reaction_once"),)


class TreffFact(db.Model):
    __tablename__ = "treff_fact"
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False)
    title = db.Column(db.String(120), nullable=False)
    value = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class TreffReport(db.Model):
    __tablename__ = "treff_report"
    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(10), nullable=False)                               # message, fact or group
    target_id = db.Column(db.Integer, nullable=False, index=True)
    reporter_id = db.Column(db.Integer, nullable=False)
    reason = db.Column(db.String(400), nullable=False, default="")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    handled = db.Column(db.Boolean, nullable=False, default=False, index=True)


# ---------------------------------------------------------------------------------------------------- helpers
def clean_text(raw, limit, keep_newlines=True, minimum=1):
    """Tidy text from a person: one Unicode form, no control or direction-changing characters, no long runs of blank lines.
    None when it is not text, too short or longer than `limit` characters."""
    if not isinstance(raw, str):
        return None
    text = unicodedata.normalize("NFC", raw).replace("\r\n", "\n").replace("\r", "\n")
    text = CONTROL_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text) if keep_newlines else re.sub(r"\s+", " ", text)
    text = text.strip()
    return text if minimum <= len(text) <= limit else None


def slugify(name):
    base = unicodedata.normalize("NFKD", name.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss"))
    base = re.sub(r"[^a-z0-9]+", "-", base.encode("ascii", "ignore").decode()).strip("-")
    return base[:40] or "gruppe"


def key_hash(key):
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def fail(error, status=400, **extra):
    return jsonify({"ok": False, "error": error, **extra}), status


def read_json():
    data = request.get_json(silent=True) if request.is_json else None
    return data if isinstance(data, dict) else None


def current_user():
    key = request.headers.get(HEADER, "")
    if not key or len(key) > 100:
        return None
    return TreffUser.query.filter_by(key_hash=key_hash(key)).first()


def snippet(text, length=140):
    flat = re.sub(r"\s+", " ", text or "").strip()
    return flat if len(flat) <= length else flat[: length - 1].rstrip() + "…"


def base_url():
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else 'https'}://{request.host}"


def manifest():
    return {
        "name": f"{SITE_NAME}: Gruppen ohne Konto", "short_name": SITE_NAME, "description": DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any",
        "background_color": "#0b0f17", "theme_color": "#0b0f17", "categories": ["social"],
        "icons": [
            {"src": "/static/img/treff-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/treff-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/treff-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def page_headers(response):
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
    return response


def new_number():
    """A number of six digits that nobody has."""
    for _ in range(40):
        number = NUMBER_LOW + secrets.randbelow(NUMBER_HIGH - NUMBER_LOW + 1)
        if TreffUser.query.filter_by(number=number).first() is None:
            return number
    taken = {row[0] for row in db.session.query(TreffUser.number).all()}              # nearly all taken: look for a free one
    free = [n for n in range(NUMBER_LOW, NUMBER_HIGH + 1) if n not in taken]
    return secrets.choice(free) if free else None


# -------------------------------------------------------------------------------------------------- serializers
def user_label(user_id, cache):
    if user_id not in cache:
        row = db.session.get(TreffUser, user_id)
        cache[user_id] = row.number if row else 0
    return cache[user_id]


def serialize_messages(rows, me):
    """The messages for the page: with the numbers of their writers, what they answer to and the reactions."""
    if not rows:
        return []
    ids = [m.id for m in rows]
    numbers = {u.id: u.number for u in TreffUser.query.filter(TreffUser.id.in_({m.user_id for m in rows})).all()}
    reply_ids = {m.reply_to_id for m in rows if m.reply_to_id}
    replies = {r.id: r for r in TreffMessage.query.filter(TreffMessage.id.in_(reply_ids)).all()} if reply_ids else {}
    for r in replies.values():
        if r.user_id not in numbers:
            numbers[r.user_id] = user_label(r.user_id, {})
    counts = {}
    for message_id, emoji, count in db.session.query(TreffReaction.message_id, TreffReaction.emoji, func.count()).filter(TreffReaction.message_id.in_(ids)).group_by(TreffReaction.message_id, TreffReaction.emoji).all():
        counts.setdefault(message_id, {})[emoji] = count
    mine = set()
    if me is not None:
        mine = {(r.message_id, r.emoji) for r in TreffReaction.query.filter(TreffReaction.message_id.in_(ids), TreffReaction.user_id == me.id).all()}
    out = []
    for m in rows:
        reply = replies.get(m.reply_to_id) if m.reply_to_id else None
        out.append({
            "id": m.id, "groupId": m.group_id, "user": numbers.get(m.user_id, 0), "mine": me is not None and m.user_id == me.id,
            "text": "" if m.deleted else m.text, "deleted": m.deleted, "important": m.important and not m.deleted, "time": iso(m.created_at),
            "replyTo": None if reply is None else {"id": reply.id, "user": numbers.get(reply.user_id, 0), "text": "" if reply.deleted else snippet(reply.text, 120), "deleted": reply.deleted},
            "reactions": [] if m.deleted else [{"emoji": e, "count": c, "mine": (m.id, e) in mine} for e, c in sorted(counts.get(m.id, {}).items(), key=lambda kv: (-kv[1], REACTIONS.index(kv[0]) if kv[0] in REACTIONS else 99))],
        })
    return out


def serialize_groups(rows, me):
    last_ids = [g.last_message_id for g in rows if g.last_message_id]
    lasts = {m.id: m for m in TreffMessage.query.filter(TreffMessage.id.in_(last_ids)).all()} if last_ids else {}
    numbers = {u.id: u.number for u in TreffUser.query.filter(TreffUser.id.in_({m.user_id for m in lasts.values()} | {g.creator_id for g in rows})).all()}
    out = []
    for g in rows:
        last = lasts.get(g.last_message_id)
        out.append({
            "id": g.id, "slug": slugify(g.name), "name": g.name, "description": g.description, "createdAt": iso(g.created_at), "lastActivityAt": iso(g.last_activity_at),
            "messageCount": g.message_count, "factCount": g.fact_count, "lastMessageId": g.last_message_id, "factsOpen": g.facts_open,
            "creator": numbers.get(g.creator_id, 0), "mine": me is not None and g.creator_id == me.id,
            "last": None if last is None else {"user": numbers.get(last.user_id, 0), "text": "Nachricht gelöscht" if last.deleted else snippet(last.text, 90), "time": iso(last.created_at), "important": last.important and not last.deleted},
        })
    return out


def serialize_facts(rows, me, group):
    numbers = {u.id: u.number for u in TreffUser.query.filter(TreffUser.id.in_({f.user_id for f in rows})).all()} if rows else {}
    return [{"id": f.id, "groupId": f.group_id, "title": f.title, "value": f.value, "user": numbers.get(f.user_id, 0), "time": iso(f.created_at),
             "mine": me is not None and f.user_id == me.id, "canDelete": me is not None and (f.user_id == me.id or group.creator_id == me.id)} for f in rows]


# ---------------------------------------------------------------------------------------------------- deleting
def remove_message(message):
    """A message is not removed from the list, only emptied (answers to it still make sense)."""
    message.deleted = True
    message.important = False
    TreffReaction.query.filter_by(message_id=message.id).delete()


def remove_group(group):
    ids = [m.id for m in TreffMessage.query.filter_by(group_id=group.id).all()]
    if ids:
        TreffReaction.query.filter(TreffReaction.message_id.in_(ids)).delete(synchronize_session=False)
        TreffReport.query.filter(TreffReport.kind == "message", TreffReport.target_id.in_(ids)).delete(synchronize_session=False)
    fact_ids = [f.id for f in TreffFact.query.filter_by(group_id=group.id).all()]
    if fact_ids:
        TreffReport.query.filter(TreffReport.kind == "fact", TreffReport.target_id.in_(fact_ids)).delete(synchronize_session=False)
    TreffMessage.query.filter_by(group_id=group.id).delete()
    TreffFact.query.filter_by(group_id=group.id).delete()
    TreffReport.query.filter_by(kind="group", target_id=group.id).delete()
    db.session.delete(group)


def admin_token():
    return os.environ.get("TREFF_ADMIN_TOKEN", "")


# ---------------------------------------------------------------------------------------------------- routes
def register_routes(app):
    def route(rule, **options):
        """Like app.route, and remembers the endpoint for ENDPOINTS."""
        def decorator(function):
            endpoint = options.pop("endpoint", function.__name__)
            ENDPOINTS.add(endpoint)
            app.add_url_rule(rule, endpoint, function, **options)
            return function
        return decorator

    def api_guard():
        if request.endpoint in ENDPOINTS and request.path.startswith("/api/treff/") and request.method not in ("GET", "HEAD") and not same_origin():
            return fail("forbidden", 403)

    app.before_request(api_guard)

    @app.after_request
    def treff_headers(response):
        if request.endpoint in ENDPOINTS:
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
            if request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https":
                response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
            if request.path.startswith("/api/treff/"):
                response.headers["Cache-Control"] = "no-store"
                response.headers["Vary"] = HEADER
        return response

    def body():
        data = read_json()
        return data, (None if data is not None else fail("bad_request", 415))

    def need_user():
        user = current_user()
        return user, (None if user else fail("need_identity", 401))

    def find_group(gid):
        return db.session.get(TreffGroup, gid)

    # ------------------------------------------------------------------------------------------ the pages
    def shell(title=None, description=None, path="/"):
        page = render_template("treff.html", title=title or f"{SITE_NAME}: Gruppen ohne Konto", description=description or DESCRIPTION, base=base_url(), path=path)
        return page_headers(make_response(page))

    @route("/", endpoint="pl_home")
    def treff_home():
        return shell()

    @route("/g/<int:gid>")
    @route("/g/<int:gid>/<slug>")
    def treff_group_page(gid, slug=None):
        group = find_group(gid)
        if group is None:
            response = shell("Diese Gruppe gibt es nicht | Treff", None, f"/g/{gid}")
            response.status_code = 404
            return response
        return shell(f"{group.name} | {SITE_NAME}", snippet(group.description or f"Die Gruppe „{group.name}“ auf Treff: reden, Fakten sammeln, Wichtiges teilen.", 200), f"/g/{gid}")

    @route("/treff-admin")
    def treff_admin_page():
        response = shell(f"Verwaltung | {SITE_NAME}", None, "/treff-admin")
        response.headers["X-Robots-Tag"] = "noindex"
        return response

    @route("/manifest.webmanifest", endpoint="treff_manifest")
    def treff_manifest():
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")

    # --------------------------------------------------------------------------------------- who is who
    @route("/api/treff/me")
    def treff_me():
        user = current_user()
        return jsonify({"ok": True, "number": user.number if user else None})

    @route("/api/treff/identity", methods=["POST"])
    def treff_identity():
        """A browser that has no number yet gets one (with its secret key, which is shown only this once)."""
        user = current_user()
        if user is not None:
            return jsonify({"ok": True, "number": user.number})
        first, last = client_addresses()
        if limiter.too_many("identity", first) or limiter.too_many("identity-flood", last):
            return fail("too_many", 429)
        for _ in range(5):
            number = new_number()
            if number is None:
                return fail("full", 503)
            key = secrets.token_urlsafe(24)
            user = TreffUser(number=number, key_hash=key_hash(key), last_seen_at=utcnow())
            db.session.add(user)
            try:
                db.session.commit()
            except IntegrityError:                                                    # somebody got the same number a moment ago
                db.session.rollback()
                continue
            return jsonify({"ok": True, "number": number, "key": key})
        return fail("busy", 503)

    # --------------------------------------------------------------------------------------------- groups
    @route("/api/treff/groups")
    def treff_groups():
        me = current_user()
        query = TreffGroup.query
        q = request.args.get("q", "").strip()[:60]
        if q:
            like = "%" + q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            query = query.filter(db.or_(TreffGroup.name_lc.like(like, escape="\\"), func.lower(TreffGroup.description).like(like, escape="\\")))
        order = {"new": TreffGroup.created_at.desc(), "top": TreffGroup.message_count.desc()}.get(request.args.get("sort"), TreffGroup.last_activity_at.desc())
        rows = query.order_by(order, TreffGroup.id.desc()).limit(GROUP_LIST).all()
        return jsonify({"ok": True, "groups": serialize_groups(rows, me), "me": me.number if me else None})

    @route("/api/treff/groups", methods=["POST"])
    def treff_create_group():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        name = clean_text(data.get("name"), MAX_GROUP_NAME, keep_newlines=False, minimum=MIN_GROUP_NAME)
        if name is None:
            return fail("bad_name")
        description = clean_text(data.get("description", "") or "", MAX_DESCRIPTION, minimum=0)
        if description is None:
            return fail("bad_description")
        if TreffGroup.query.filter_by(name_lc=name.lower()).first() is not None:
            return fail("name_taken", 409)
        first, _ = client_addresses()                                        # (only what would really be made counts, not a typo)
        if limiter.too_many("group-hour", str(user.id)) or limiter.too_many("group-ip", first):
            return fail("too_many", 429)
        group = TreffGroup(name=name, name_lc=name.lower(), description=description, creator_id=user.id, facts_open=data.get("factsOpen") is not False)
        db.session.add(group)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return fail("name_taken", 409)
        return jsonify({"ok": True, "group": serialize_groups([group], user)[0]}), 201

    @route("/api/treff/groups/<int:gid>")
    def treff_group(gid):
        me = current_user()
        group = find_group(gid)
        if group is None:
            return fail("not_found", 404)
        facts = TreffFact.query.filter_by(group_id=gid).order_by(TreffFact.id).all()
        return jsonify({"ok": True, "group": serialize_groups([group], me)[0], "facts": serialize_facts(facts, me, group)})

    @route("/api/treff/groups/<int:gid>", methods=["PATCH"])
    def treff_update_group(gid):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        group = find_group(gid)
        if group is None:
            return fail("not_found", 404)
        if group.creator_id != user.id:
            return fail("forbidden", 403)
        if limiter.too_many("edit", str(user.id)):
            return fail("too_many", 429)
        if "name" in data:
            name = clean_text(data["name"], MAX_GROUP_NAME, keep_newlines=False, minimum=MIN_GROUP_NAME)
            if name is None:
                return fail("bad_name")
            other = TreffGroup.query.filter_by(name_lc=name.lower()).first()
            if other is not None and other.id != group.id:
                return fail("name_taken", 409)
            group.name, group.name_lc = name, name.lower()
        if "description" in data:
            description = clean_text(data["description"] or "", MAX_DESCRIPTION, minimum=0)
            if description is None:
                return fail("bad_description")
            group.description = description
        if "factsOpen" in data:
            group.facts_open = data["factsOpen"] is True
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return fail("name_taken", 409)
        return jsonify({"ok": True, "group": serialize_groups([group], user)[0]})

    @route("/api/treff/groups/<int:gid>", methods=["DELETE"])
    def treff_delete_group(gid):
        user, problem = need_user()
        if problem:
            return problem
        group = find_group(gid)
        if group is None:
            return fail("not_found", 404)
        if group.creator_id != user.id:
            return fail("forbidden", 403)
        remove_group(group)
        db.session.commit()
        return jsonify({"ok": True})

    # ------------------------------------------------------------------------------------------- messages
    @route("/api/treff/groups/<int:gid>/messages")
    def treff_messages(gid):
        me = current_user()
        if find_group(gid) is None:
            return fail("not_found", 404)
        query = TreffMessage.query.filter_by(group_id=gid)
        if request.args.get("important") == "1":
            query = query.filter_by(important=True, deleted=False)
        limit = max(1, min(100, int(request.args["limit"]))) if request.args.get("limit", "").isdigit() else PAGE
        after = int(request.args["after"]) if request.args.get("after", "").isdigit() else None
        before = int(request.args["before"]) if request.args.get("before", "").isdigit() else None
        if after is not None:
            rows = query.filter(TreffMessage.id > after).order_by(TreffMessage.id).limit(limit).all()
            more = False
        else:
            if before is not None:
                query = query.filter(TreffMessage.id < before)
            rows = list(reversed(query.order_by(TreffMessage.id.desc()).limit(limit).all()))
            more = bool(rows) and query.filter(TreffMessage.id < rows[0].id).first() is not None
        return jsonify({"ok": True, "messages": serialize_messages(rows, me), "hasMore": more})

    @route("/api/treff/groups/<int:gid>/messages", methods=["POST"])
    def treff_post(gid):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        group = find_group(gid)
        if group is None:
            return fail("not_found", 404)
        text = clean_text(data.get("text"), MAX_MESSAGE)
        if text is None:
            return fail("bad_text")
        if len(URL_RE.findall(text)) > MAX_LINKS:
            return fail("too_many_links")
        reply_to = data.get("replyTo")
        if reply_to is not None:
            parent = db.session.get(TreffMessage, reply_to) if isinstance(reply_to, int) and not isinstance(reply_to, bool) else None
            if parent is None or parent.group_id != gid:
                return fail("bad_reply")
        if limiter.too_many("message-burst", str(user.id)) or limiter.too_many("message-hour", str(user.id)):
            return fail("too_many", 429)
        message = TreffMessage(group_id=gid, user_id=user.id, text=text, reply_to_id=reply_to, important=data.get("important") is True)
        db.session.add(message)
        db.session.flush()
        group.message_count += 1
        group.last_message_id = message.id
        group.last_activity_at = utcnow()
        db.session.commit()
        return jsonify({"ok": True, "message": serialize_messages([message], user)[0]}), 201

    def get_message(mid):
        return db.session.get(TreffMessage, mid)

    @route("/api/treff/messages/<int:mid>", methods=["DELETE"])
    def treff_delete_message(mid):
        user, problem = need_user()
        if problem:
            return problem
        message = get_message(mid)
        if message is None:
            return fail("not_found", 404)
        group = find_group(message.group_id)
        if message.user_id != user.id and (group is None or group.creator_id != user.id):
            return fail("forbidden", 403)
        remove_message(message)
        db.session.commit()
        return jsonify({"ok": True, "message": serialize_messages([message], user)[0]})

    @route("/api/treff/messages/<int:mid>/important", methods=["POST"])
    def treff_important(mid):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        message = get_message(mid)
        if message is None or message.deleted:
            return fail("not_found", 404)
        group = find_group(message.group_id)
        if message.user_id != user.id and (group is None or group.creator_id != user.id):
            return fail("forbidden", 403)
        message.important = data.get("on") is True
        db.session.commit()
        return jsonify({"ok": True, "message": serialize_messages([message], user)[0]})

    @route("/api/treff/messages/<int:mid>/react", methods=["POST"])
    def treff_react(mid):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        message = get_message(mid)
        if message is None or message.deleted:
            return fail("not_found", 404)
        emoji = data.get("emoji")
        if emoji not in REACTIONS:
            return fail("bad_emoji")
        if limiter.too_many("react", str(user.id)):
            return fail("too_many", 429)
        existing = TreffReaction.query.filter_by(message_id=mid, user_id=user.id, emoji=emoji).first()
        if existing is not None:
            db.session.delete(existing)
        else:
            db.session.add(TreffReaction(message_id=mid, user_id=user.id, emoji=emoji))
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        return jsonify({"ok": True, "message": serialize_messages([message], user)[0]})

    @route("/api/treff/important")
    def treff_important_feed():
        me = current_user()
        rows = TreffMessage.query.filter_by(important=True, deleted=False).order_by(TreffMessage.id.desc()).limit(12).all()
        groups = {g.id: g for g in TreffGroup.query.filter(TreffGroup.id.in_({m.group_id for m in rows})).all()} if rows else {}
        items = []
        for message, data in zip(rows, serialize_messages(rows, me)):
            group = groups.get(message.group_id)
            if group is not None:
                items.append({**data, "group": {"id": group.id, "slug": slugify(group.name), "name": group.name}})
        return jsonify({"ok": True, "messages": items})

    # ---------------------------------------------------------------------------------------------- facts
    @route("/api/treff/groups/<int:gid>/facts", methods=["POST"])
    def treff_add_fact(gid):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        group = find_group(gid)
        if group is None:
            return fail("not_found", 404)
        if not group.facts_open and group.creator_id != user.id:
            return fail("facts_closed", 403)
        title = clean_text(data.get("title"), MAX_FACT_TITLE, keep_newlines=False)
        value = clean_text(data.get("value"), MAX_FACT_VALUE)
        if title is None:
            return fail("bad_title")
        if value is None:
            return fail("bad_value")
        if group.fact_count >= MAX_FACTS:
            return fail("too_many_facts", 409)
        if limiter.too_many("fact-hour", str(user.id)):
            return fail("too_many", 429)
        fact = TreffFact(group_id=gid, user_id=user.id, title=title, value=value)
        db.session.add(fact)
        group.fact_count += 1
        group.last_activity_at = utcnow()
        db.session.commit()
        return jsonify({"ok": True, "fact": serialize_facts([fact], user, group)[0]}), 201

    @route("/api/treff/facts/<int:fid>", methods=["PATCH"])
    def treff_update_fact(fid):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        fact = db.session.get(TreffFact, fid)
        if fact is None:
            return fail("not_found", 404)
        group = find_group(fact.group_id)
        if fact.user_id != user.id and group.creator_id != user.id:
            return fail("forbidden", 403)
        if limiter.too_many("edit", str(user.id)):
            return fail("too_many", 429)
        if "title" in data:
            title = clean_text(data["title"], MAX_FACT_TITLE, keep_newlines=False)
            if title is None:
                return fail("bad_title")
            fact.title = title
        if "value" in data:
            value = clean_text(data["value"], MAX_FACT_VALUE)
            if value is None:
                return fail("bad_value")
            fact.value = value
        db.session.commit()
        return jsonify({"ok": True, "fact": serialize_facts([fact], user, group)[0]})

    @route("/api/treff/facts/<int:fid>", methods=["DELETE"])
    def treff_delete_fact(fid):
        user, problem = need_user()
        if problem:
            return problem
        fact = db.session.get(TreffFact, fid)
        if fact is None:
            return fail("not_found", 404)
        group = find_group(fact.group_id)
        if fact.user_id != user.id and group.creator_id != user.id:
            return fail("forbidden", 403)
        db.session.delete(fact)
        group.fact_count = max(0, group.fact_count - 1)
        TreffReport.query.filter_by(kind="fact", target_id=fid).delete()
        db.session.commit()
        return jsonify({"ok": True})

    # -------------------------------------------------------------------------------------------- reports
    @route("/api/treff/report", methods=["POST"])
    def treff_report():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        kind, target = data.get("kind"), data.get("id")
        model = {"message": TreffMessage, "fact": TreffFact, "group": TreffGroup}.get(kind)
        if model is None or not isinstance(target, int) or isinstance(target, bool) or db.session.get(model, target) is None:
            return fail("not_found", 404)
        if limiter.too_many("report", str(user.id)):
            return fail("too_many", 429)
        reason = clean_text(data.get("reason") or "", MAX_REASON, keep_newlines=False, minimum=0)
        if reason is None:
            return fail("bad_reason")
        if TreffReport.query.filter_by(kind=kind, target_id=target, reporter_id=user.id, handled=False).first() is None:
            db.session.add(TreffReport(kind=kind, target_id=target, reporter_id=user.id, reason=reason))
            db.session.commit()
        return jsonify({"ok": True})

    # ----------------------------------------------------------------------------------------------- admin
    def admin_guard():
        token = admin_token()
        if not token:
            return fail("not_found", 404)
        first, _ = client_addresses()
        if limiter.too_many("admin", first):
            return fail("too_many", 429)
        given = request.headers.get("X-Treff-Admin", "")
        if not secrets.compare_digest(given.encode("utf-8"), token.encode("utf-8")):
            return fail("forbidden", 403)
        return None

    @route("/api/treff/admin/reports")
    def treff_admin_reports():
        problem = admin_guard()
        if problem:
            return problem
        reports = TreffReport.query.filter_by(handled=False).order_by(TreffReport.id).limit(100).all()
        out = []
        for r in reports:
            target = {"message": TreffMessage, "fact": TreffFact, "group": TreffGroup}[r.kind]
            row = db.session.get(target, r.target_id)
            if row is None:
                r.handled = True
                continue
            if r.kind == "message":
                shown = {"text": snippet(row.text, 300), "group": row.group_id, "user": user_label(row.user_id, {}), "deleted": row.deleted}
            elif r.kind == "fact":
                shown = {"text": f"{row.title}: {snippet(row.value, 300)}", "group": row.group_id, "user": user_label(row.user_id, {})}
            else:
                shown = {"text": f"{row.name}: {snippet(row.description, 300)}", "group": row.id, "user": user_label(row.creator_id, {})}
            out.append({"id": r.id, "kind": r.kind, "targetId": r.target_id, "reason": r.reason, "time": iso(r.created_at), **shown})
        db.session.commit()
        return jsonify({"ok": True, "reports": out})

    @route("/api/treff/admin/reports/<int:rid>", methods=["POST"])
    def treff_admin_handle(rid):
        problem = admin_guard()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        report = db.session.get(TreffReport, rid)
        if report is None:
            return fail("not_found", 404)
        action = data.get("action")
        if action == "delete":
            if report.kind == "message":
                message = db.session.get(TreffMessage, report.target_id)
                if message is not None:
                    remove_message(message)
            elif report.kind == "fact":
                fact = db.session.get(TreffFact, report.target_id)
                if fact is not None:
                    group = find_group(fact.group_id)
                    db.session.delete(fact)
                    if group is not None:
                        group.fact_count = max(0, group.fact_count - 1)
            else:
                group = find_group(report.target_id)
                if group is not None:
                    remove_group(group)
        elif action != "dismiss":
            return fail("bad_action")
        TreffReport.query.filter_by(kind=report.kind, target_id=report.target_id).update({"handled": True})
        report.handled = True
        db.session.commit()
        return jsonify({"ok": True})
