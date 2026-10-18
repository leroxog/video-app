"""Pulse (internally still called "yipi": the module, the tables, the cookie and the /api/yipi/ addresses keep that name so that
nothing that already exists breaks): a short-post social network (all code, texts and artwork are original; it works like the
well-known microblogs, but nothing here is copied from any of them).  Since 2026-10-17 it is the home page of the whole site.

What people do:
  * write "Posts" of up to 280 characters with up to 4 photos (never videos) or one GIF, reply to them, repost them, quote them,
    like them, bookmark them;
  * follow each other: the home page has a "Für dich" feed (everybody) and a "Folge ich" feed (the people you follow);
  * look at profiles (Posts, Antworten, Medien, Gefällt mir), search for Posts and people, see what is trending (hashtags);
  * get notifications (likes, reposts, replies, quotes, mentions, new followers) and send private messages (text or a GIF);
  * pick a GIF from the shared library, mark favourites, make their own (or upload one) and let others favourite and send it;
  * ask Nex, the assistant of the site (Groq, streamed word by word), anything -- or let Nex explain a post;
  * block or mute people and report Posts and GIFs; people named in the environment variable YIPI_ADMINS can handle reports.

How it is built:
  * a post, a reply, a quote and a repost are all rows of one table (`yipi_post`): a reply has `reply_to_id`, a quote
    has `quote_of_id`, a repost has `repost_of_id` (and no text). The counters (likes, reposts, ...) are kept on the
    post and changed in the same transaction as the row that causes them;
  * the page (static/js/yipi*.js) draws everything from JSON (/api/yipi/...); text from users is only ever put on the
    page as text, never as HTML;
  * the sign-in is its own signed cookie (`yipi_session`, see siteauth.py); every route that changes something takes
    JSON (or a file upload) only and refuses requests that come from another site; attempts are rate limited;
  * photos are checked by their first bytes (JPEG, PNG, GIF, WebP), measured, and stored in the database; anything that looks
    like a video is refused with its own message;
  * the GIF library (`pulse_gif`, `pulse_gif_fav`) holds the GIFs people made or uploaded plus a few starter GIFs that ship with
    the site (static/gifs, made by scripts/make_pulse_gifs.py); using one copies its bytes into a fresh, unattached `yipi_media`
    row of the user, so a post never changes when the original is deleted.
"""
import hashlib
import json
import logging
import os
import re
import struct
import unicodedata
import uuid
from datetime import datetime, timedelta, timezone

from flask import Response, abort, jsonify, make_response, redirect, render_template, request, stream_with_context
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import defer
from werkzeug.security import check_password_hash, generate_password_hash

import ai_assistant
import siteauth
import ysound
from models import db
from siteauth import CookieAuth, RateLimiter, client_addresses, same_origin

# ------------------------------------------------------------------------------------------------ settings
COOKIE = "yipi_session"
MAX_POST = 280
MAX_BIO = 160
MAX_NAME = 50
MAX_LOCATION = 30
MAX_WEBSITE = 100
MAX_DM = 1000
MAX_MEDIA = 3                                    # photos per post (or one GIF, or a poll)
MAX_GROUP_NAME = 40
MAX_GROUP_MEMBERS = 20
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 40_000_000
MAX_GIF_BYTES = 3 * 1024 * 1024                  # a GIF of the library: it is shown many times in a picker, so it stays small
MAX_GIF_PIXELS = 2_000_000                       # one picture of a GIF
MAX_GIF_TOTAL_PIXELS = 40_000_000                # all pictures of a GIF together: what a browser has to draw while it plays
MAX_GIF_FRAMES = 200
MAX_GIF_TITLE = 40
GIF_PAGE = 24
MAX_POLL_OPTION = 25                             # characters of one answer of a poll
POLL_OPTIONS = (2, 4)                            # fewest and most answers
POLL_MINUTES = (5, 7 * 24 * 60, 24 * 60)         # shortest, longest and usual running time of a poll
MAX_VIEWS_AT_ONCE = 40
NEX_TURNS = 12                                   # how many of the last messages of a Nex conversation are sent along
MAX_NEX_MESSAGE = 1500
MIN_PASSWORD = 8
MAX_PASSWORD = 200
PAGE = 20
PEOPLE_PAGE = 30

HANDLE_RE = re.compile(r"[A-Za-z0-9_]{3,15}")
EMAIL_RE = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,24}")
MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_]{3,15})(?![\w@])")
HASHTAG_RE = re.compile(r"(?<![\w#&/])#(\w{2,50})")
CONTROL_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​‎‏‪-‮⁠-⁤﻿]")
REPORT_REASONS = ("spam", "abuse", "hate", "violence", "illegal", "self_harm", "other")
NOTIFICATION_KINDS = ("like", "repost", "reply", "quote", "mention", "follow")

# Names that must not be a handle: the page's own addresses, and names that would pretend to be the site.
RESERVED_HANDLES = {
    "api", "static", "explore", "notifications", "messages", "bookmarks", "settings", "search", "compose", "login", "signup", "logout",
    "home", "i", "m", "admin", "administrator", "moderation", "yipi", "yips", "support", "help", "about", "terms", "privacy", "rules",
    "datenschutz", "impressum", "nutzungsbedingungen", "regeln", "hilfe", "suche", "entdecken", "robots", "sitemap", "manifest",
    "gomat", "ysound", "root", "system", "staff", "team", "official", "null", "undefined", "me", "you", "intent", "share", "hashtag",
    "yipi_media", "service", "offline", "link", "play", "plm", "auth", "plugins", "music", "servers", "ychat", "ylib", "nrs", "nex", "sound",
    "browser", "server", "play_game", "service_worker", "games", "videos", "chats", "friends", "groups",
}

LIMITS = {
    "login-ip": (60, 600), "login-name": (8, 900), "login-flood": (600, 600), "signup-ip": (20, 3600), "signup-flood": (300, 3600),
    "password": (8, 900), "delete": (6, 900),
    "post-burst": (12, 60), "post-hour": (150, 3600), "like": (400, 3600), "follow": (120, 3600), "media": (40, 3600), "dm": (120, 3600),
    "report": (20, 3600), "profile": (30, 3600), "search": (120, 600), "block": (60, 3600),
    "gif-make": (20, 3600), "gif-fav": (400, 3600), "gif-use": (300, 3600), "gif-list": (600, 600),
    "nex": (40, 600), "nex-flood": (80, 60), "views": (90, 600), "vote": (200, 3600), "pin": (60, 3600), "group": (12, 3600),
}
_hits = {}
limiter = RateLimiter(LIMITS, _hits)
auth = CookieAuth(COOKIE, salt="yipi-account-v1")

# What the pages may load: only our own files (and the pictures people chose, shown from memory before they are sent).
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; "
    "connect-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"
)
SITE_NAME = "Pulse"
DESCRIPTION = "Pulse: Was gerade passiert. Kurze Beiträge, Fotos und GIFs, Antworten, Reposts und Likes, dazu Nex, die KI, die dir weiterhilft."
# Old home pages of the site that stay reachable but are not for search engines.
ARCHIVE_PATHS = ("/nex-agenten-archiv", "/gomat-archiv", "/ysound-archiv", "/sound-archiv", "/server-archiv", "/browser-archiv", "/ylib-archiv", "/ychat-archiv", "/nex-archiv", "/modelle-archiv", "/nex-ai-archiv", "/nstl-archiv")
PRIVATE_PATHS = ("/i/", "/g/", "/search", "/messages", "/notifications", "/bookmarks", "/settings", "/moderation")   # not for search engines
OLD_HOME = "/yipi-archiv"                         # the address of the earlier yipi home page: it leads to "/" now
STARTER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "gifs")
logger = logging.getLogger(__name__)
ENDPOINTS = set()           # filled by register_routes: every endpoint of this module (the site's login gate must let them through)


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def iso(moment):
    return moment.isoformat() + "Z" if moment else None


BigId = db.BigInteger().with_variant(db.Integer, "sqlite")


# ----------------------------------------------------------------------------------------------- models
class YipiUser(db.Model):
    __tablename__ = "yipi_user"
    id = db.Column(db.Integer, primary_key=True)
    handle = db.Column(db.String(15), nullable=False)
    handle_lc = db.Column(db.String(15), unique=True, nullable=False)
    name = db.Column(db.String(MAX_NAME), nullable=False)
    email = db.Column(db.String(254), unique=True, nullable=True)
    password_hash = db.Column(db.String(255), nullable=False)
    bio = db.Column(db.String(MAX_BIO), nullable=False, default="")
    location = db.Column(db.String(MAX_LOCATION), nullable=False, default="")
    website = db.Column(db.String(MAX_WEBSITE), nullable=False, default="")
    avatar_id = db.Column(db.String(32), nullable=True)
    banner_id = db.Column(db.String(32), nullable=True)
    session_gen = db.Column(db.Integer, nullable=False, default=0)
    pinned_post_id = db.Column(BigId, nullable=True)                  # the post shown first on the profile
    suspended = db.Column(db.Boolean, nullable=False, default=False)
    followers_count = db.Column(db.Integer, nullable=False, default=0)
    following_count = db.Column(db.Integer, nullable=False, default=0)
    posts_count = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    last_seen_at = db.Column(db.DateTime, nullable=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class YipiPost(db.Model):
    __tablename__ = "yipi_post"
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.Text, nullable=False, default="")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)
    reply_to_id = db.Column(BigId, nullable=True, index=True)
    root_id = db.Column(BigId, nullable=True, index=True)
    quote_of_id = db.Column(BigId, nullable=True, index=True)
    repost_of_id = db.Column(BigId, nullable=True, index=True)
    like_count = db.Column(db.Integer, nullable=False, default=0)
    reply_count = db.Column(db.Integer, nullable=False, default=0)
    repost_count = db.Column(db.Integer, nullable=False, default=0)
    quote_count = db.Column(db.Integer, nullable=False, default=0)
    view_count = db.Column(db.Integer, nullable=False, default=0)
    deleted = db.Column(db.Boolean, nullable=False, default=False)


class YipiMedia(db.Model):
    __tablename__ = "yipi_media"
    id = db.Column(db.String(32), primary_key=True)
    owner_id = db.Column(db.Integer, nullable=False, index=True)
    post_id = db.Column(BigId, nullable=True, index=True)
    position = db.Column(db.Integer, nullable=False, default=0)
    content_type = db.Column(db.String(30), nullable=False)
    data = db.Column(db.LargeBinary, nullable=False)
    size = db.Column(db.Integer, nullable=False)
    width = db.Column(db.Integer, nullable=False)
    height = db.Column(db.Integer, nullable=False)
    alt = db.Column(db.String(200), nullable=False, default="")
    gif_id = db.Column(db.String(32), nullable=True)                  # the GIF of the library this picture was copied from, if it was
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiFollow(db.Model):
    __tablename__ = "yipi_follow"
    __table_args__ = (db.UniqueConstraint("follower_id", "followee_id"),)
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    follower_id = db.Column(db.Integer, nullable=False, index=True)
    followee_id = db.Column(db.Integer, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiLike(db.Model):
    __tablename__ = "yipi_like"
    __table_args__ = (db.UniqueConstraint("user_id", "post_id"),)
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    post_id = db.Column(BigId, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiBookmark(db.Model):
    __tablename__ = "yipi_bookmark"
    __table_args__ = (db.UniqueConstraint("user_id", "post_id"),)
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    post_id = db.Column(BigId, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiBlock(db.Model):
    __tablename__ = "yipi_block"
    __table_args__ = (db.UniqueConstraint("blocker_id", "blocked_id"),)
    id = db.Column(db.Integer, primary_key=True)
    blocker_id = db.Column(db.Integer, nullable=False, index=True)
    blocked_id = db.Column(db.Integer, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiMute(db.Model):
    __tablename__ = "yipi_mute"
    __table_args__ = (db.UniqueConstraint("muter_id", "muted_id"),)
    id = db.Column(db.Integer, primary_key=True)
    muter_id = db.Column(db.Integer, nullable=False, index=True)
    muted_id = db.Column(db.Integer, nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiTag(db.Model):
    __tablename__ = "yipi_tag"
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    tag = db.Column(db.String(50), nullable=False, index=True)
    post_id = db.Column(BigId, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)


class YipiNotification(db.Model):
    __tablename__ = "yipi_notification"
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    actor_id = db.Column(db.Integer, nullable=False)
    kind = db.Column(db.String(10), nullable=False)
    post_id = db.Column(BigId, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    read = db.Column(db.Boolean, nullable=False, default=False)


class YipiMessage(db.Model):
    __tablename__ = "yipi_message"
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    sender_id = db.Column(db.Integer, nullable=False, index=True)
    recipient_id = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.String(MAX_DM), nullable=False)
    gif_id = db.Column(db.String(32), nullable=True)                  # a GIF of the library sent instead of (or with) text
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    read = db.Column(db.Boolean, nullable=False, default=False)


class YipiGroup(db.Model):
    """A group chat: a name, an owner, members (yipi_group_member) and messages (yipi_group_message)."""
    __tablename__ = "yipi_group"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(MAX_GROUP_NAME), nullable=False)
    owner_id = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiGroupMember(db.Model):
    __tablename__ = "yipi_group_member"
    __table_args__ = (db.UniqueConstraint("group_id", "user_id"),)
    id = db.Column(db.Integer, primary_key=True)
    group_id = db.Column(db.Integer, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    last_read = db.Column(BigId, nullable=False, default=0)          # the newest message of the group this member has seen
    joined_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiGroupMessage(db.Model):
    __tablename__ = "yipi_group_message"
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    group_id = db.Column(db.Integer, nullable=False, index=True)
    sender_id = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.String(MAX_DM), nullable=False, default="")
    gif_id = db.Column(db.String(32), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiReport(db.Model):
    __tablename__ = "yipi_report"
    id = db.Column(db.Integer, primary_key=True)
    reporter_id = db.Column(db.Integer, nullable=False)
    post_id = db.Column(BigId, nullable=True)
    gif_id = db.Column(db.String(32), nullable=True)
    user_id = db.Column(db.Integer, nullable=True)
    reason = db.Column(db.String(20), nullable=False)
    note = db.Column(db.String(300), nullable=False, default="")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)
    handled = db.Column(db.Boolean, nullable=False, default=False)


class YipiPoll(db.Model):
    """The poll of a post: answers (yipi_poll_option), who voted for what (yipi_poll_vote), and when it ends."""
    __tablename__ = "yipi_poll"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(BigId, nullable=False, unique=True, index=True)
    ends_at = db.Column(db.DateTime, nullable=False)
    total = db.Column(db.Integer, nullable=False, default=0)


class YipiPollOption(db.Model):
    __tablename__ = "yipi_poll_option"
    id = db.Column(db.Integer, primary_key=True)
    poll_id = db.Column(db.Integer, nullable=False, index=True)
    position = db.Column(db.Integer, nullable=False, default=0)
    text = db.Column(db.String(MAX_POLL_OPTION), nullable=False)
    votes = db.Column(db.Integer, nullable=False, default=0)


class YipiPollVote(db.Model):
    __tablename__ = "yipi_poll_vote"
    __table_args__ = (db.UniqueConstraint("poll_id", "user_id"),)
    id = db.Column(db.Integer, primary_key=True)
    poll_id = db.Column(db.Integer, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    option_id = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class PulseGif(db.Model):
    """A GIF of the shared library: made in the browser or uploaded by somebody (owner_id), or one of the starters that ship with the
    site (starter, no owner).  Everybody who is signed in sees it, can favourite it and send it."""
    __tablename__ = "pulse_gif"
    id = db.Column(db.String(32), primary_key=True)
    owner_id = db.Column(db.Integer, nullable=True, index=True)
    title = db.Column(db.String(MAX_GIF_TITLE), nullable=False, default="")
    data = db.Column(db.LargeBinary, nullable=False)
    size = db.Column(db.Integer, nullable=False)
    width = db.Column(db.Integer, nullable=False)
    height = db.Column(db.Integer, nullable=False)
    frames = db.Column(db.Integer, nullable=False, default=1)
    uses = db.Column(db.Integer, nullable=False, default=0)
    favorites = db.Column(db.Integer, nullable=False, default=0)
    starter = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)


class PulseGifFav(db.Model):
    __tablename__ = "pulse_gif_fav"
    __table_args__ = (db.UniqueConstraint("user_id", "gif_id"),)
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    gif_id = db.Column(db.String(32), nullable=False, index=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


_DUMMY_HASH = generate_password_hash("not-a-real-password")      # checked when the name is unknown, so timing does not tell


# ------------------------------------------------------------------------------------------ small helpers
def fail(error, status=400, **extra):
    return jsonify({"ok": False, "error": error, **extra}), status


def read_json():
    data = request.get_json(silent=True) if request.is_json else None
    return data if isinstance(data, dict) else None


def admins():
    return {name.strip().lower() for name in os.environ.get("YIPI_ADMINS", "").split(",") if name.strip()}


def is_admin(user):
    return bool(user) and user.handle_lc in admins()


def clean_text(raw, limit, keep_newlines=True):
    """Tidy user text: one Unicode form, no control or direction-changing characters, no runs of blank lines.
    None when it is not text or is longer than `limit` characters (counted as characters, like the page counts them)."""
    if not isinstance(raw, str):
        return None
    text = unicodedata.normalize("NFC", raw).replace("\r\n", "\n").replace("\r", "\n")
    text = CONTROL_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text) if keep_newlines else re.sub(r"\s+", " ", text)
    text = text.strip()
    return text if len(text) <= limit else None


def like_pattern(query):
    return "%" + query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def valid_password(raw):
    return isinstance(raw, str) and MIN_PASSWORD <= len(raw) <= MAX_PASSWORD


def normalise_email(raw):
    email = raw.strip().lower() if isinstance(raw, str) else ""
    return email if email and len(email) <= 254 and EMAIL_RE.fullmatch(email) else None


def valid_website(raw):
    """A web address with http or https (or nothing)."""
    if raw == "":
        return True
    return bool(re.fullmatch(r"https?://[^\s<>\"']{3,}", raw)) and len(raw) <= MAX_WEBSITE


MAX_ID = 2 ** 62            # larger than any id there will be, and still a number every database takes


def clamp_cursor(raw):
    """A positive whole number from a request (a cursor, an id), or None. Absurdly large ones are cut down, not passed to the database."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return min(value, MAX_ID) if value > 0 else None


def extract_mentions(text):
    seen = []
    for name in MENTION_RE.findall(text):
        if name.lower() not in seen:
            seen.append(name.lower())
    return seen[:10]


def extract_tags(text):
    seen = []
    for tag in HASHTAG_RE.findall(text):
        low = tag.lower()
        if any(ch.isalpha() for ch in low) and low not in seen:
            seen.append(low)
    return seen[:10]


# ------------------------------------------------------------------------------------------ pictures
def image_info(data):
    """(content type, width, height) of a JPEG, PNG, GIF or WebP picture judged by its first bytes, or None."""
    try:
        if data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR":
            width, height = struct.unpack(">II", data[16:24])
            return "image/png", width, height
        if data[:6] in (b"GIF87a", b"GIF89a"):
            width, height = struct.unpack("<HH", data[6:10])
            return "image/gif", width, height
        if data[:2] == b"\xff\xd8":
            position = 2
            while position + 9 < len(data):
                if data[position] != 0xFF:
                    position += 1
                    continue
                marker = data[position + 1]
                if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xFF:
                    position += 2 if marker != 0xFF else 1
                    continue
                length = struct.unpack(">H", data[position + 2:position + 4])[0]
                if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                    height, width = struct.unpack(">HH", data[position + 5:position + 9])
                    return "image/jpeg", width, height
                position += 2 + length
            return None
        if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            kind = data[12:16]
            if kind == b"VP8 ":
                width, height = struct.unpack("<HH", data[26:30])
                return "image/webp", width & 0x3FFF, height & 0x3FFF
            if kind == b"VP8L":
                bits = struct.unpack("<I", data[21:25])[0]
                return "image/webp", (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
            if kind == b"VP8X":
                width = int.from_bytes(data[24:27], "little") + 1
                height = int.from_bytes(data[27:30], "little") + 1
                return "image/webp", width, height
    except (struct.error, IndexError):
        return None
    return None


VIDEO_EXTENSIONS = {".mp4", ".m4v", ".mov", ".qt", ".webm", ".mkv", ".avi", ".wmv", ".flv", ".mpg", ".mpeg", ".3gp", ".3g2", ".ogv", ".ts", ".m2ts", ".mts"}
IMAGE_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"avif", b"avis", b"crx "}   # "ftyp" files that are pictures


def looks_like_video(data, filename="", mimetype=""):
    """True for a file that is a video: by what is written in it (the container formats of the common cameras and phones), and
    also by the name and type the browser gave it.  Photos and GIFs are never judged a video."""
    head = data[:16]
    if head[:6] in (b"GIF87a", b"GIF89a") or head[:3] == b"\xff\xd8\xff" or head[:8] == b"\x89PNG\r\n\x1a\n":
        return False
    if head[4:8] == b"ftyp" and head[8:12] not in IMAGE_BRANDS:
        return True                                                   # MP4, MOV, M4V, 3GP
    if head[:4] == b"\x1aE\xdf\xa3" or head[:4] == b"OggS" or head[:4] == b"FLV\x01":
        return True                                                   # WebM / Matroska, Ogg, Flash video
    if head[:4] == b"RIFF" and head[8:12] == b"AVI ":
        return True
    if head[:4] in (b"\x00\x00\x01\xba", b"\x00\x00\x01\xb3") or head[:4] == b"0&\xb2u":
        return True                                                   # MPEG, Windows Media
    if str(mimetype or "").lower().startswith("video/"):
        return True
    return os.path.splitext(str(filename or "").lower())[1] in VIDEO_EXTENSIONS


def gif_info(data):
    """(width, height, frames) of a well-formed GIF, or None.  The file is walked block by block (so a truncated or mangled file
    is refused and a GIF that claims a huge size or hundreds of frames is too), not just judged by its first bytes."""
    try:
        if data[:6] not in (b"GIF87a", b"GIF89a") or len(data) < 14:
            return None
        width, height, flags = struct.unpack("<HHB", data[6:11])
        if width < 1 or height < 1 or width * height > MAX_GIF_PIXELS:
            return None
        position = 13
        if flags & 0x80:
            position += 3 * (2 << (flags & 7))
        frames = 0
        while position < len(data):
            marker = data[position]
            if marker == 0x3B:
                return (width, height, frames) if frames and width * height * frames <= MAX_GIF_TOTAL_PIXELS else None
            if marker == 0x21:                                        # extension: a label, then blocks of data
                position += 2
            elif marker == 0x2C:                                      # picture: its box, maybe its own colours, then packed data
                frames += 1
                if frames > MAX_GIF_FRAMES or position + 10 > len(data):
                    return None
                local = data[position + 9]
                position += 10
                if local & 0x80:
                    position += 3 * (2 << (local & 7))
                position += 1                                         # the LZW code size
            else:
                return None
            while True:                                               # sub-blocks end with a block of length 0
                if position >= len(data):
                    return None
                length = data[position]
                position += 1 + length
                if length == 0:
                    break
        return None
    except (struct.error, IndexError):
        return None


NEX_MAX_TOKENS = 900                              # the model reasons before it writes: a small number would leave nothing visible
NEX_PROMPT = (
    "Du bist Nex, die KI von Pulse, einer Plattform für kurze Beiträge. Du antwortest dem Nutzer, der gerade mit dir schreibt. "
    "Das Gespräch steht unten; schreib nur die nächste Antwort von Nex. Antworte kurz, klar und freundlich, in der Sprache des Nutzers "
    "(meist Deutsch), in normalem Text ohne Sternchen, ohne Überschriften und ohne Tabellen; für Aufzählungen nimm einfache Zeilen mit "
    "'- '. Entscheide dich für die wahrscheinlichste Deutung, statt nachzufragen. Wenn du etwas nicht sicher weißt, sag es offen. "
    "Du hilfst beim Schreiben von Beiträgen (höchstens 280 Zeichen), erklärst Beiträge und beantwortest Fragen. Du kannst keine Seiten "
    "öffnen und nichts in Pulse ändern. Gib nie Medizin-, Rechts- oder Finanzberatung als sicher aus."
)


# ------------------------------------------------------------------------------------ who is who
def current_user():
    payload = auth.read()
    if not isinstance(payload, dict) or not isinstance(payload.get("uid"), int):
        return None
    user = db.session.get(YipiUser, payload["uid"])
    if user is None or user.suspended or payload.get("gen") != user.session_gen:
        return None
    return user


def signed_in(response, user):
    return auth.attach(response, {"uid": user.id, "gen": user.session_gen})


def media_url(media_id):
    return f"/yipi-media/{media_id}" if media_id else None


GIF_ID_RE = re.compile(r"[0-9a-f]{32}")
_starters = []                                    # the starter GIFs that ship with the site, read once (static/gifs/index.json)


def starter_id(slug):
    return hashlib.md5(("pulse-starter-" + slug).encode("utf-8")).hexdigest()


def starter_index():
    if not _starters:
        try:
            with open(os.path.join(STARTER_DIR, "index.json"), encoding="utf-8") as handle:
                entries = json.load(handle)
            _starters.extend(entry for entry in entries if isinstance(entry, dict) and re.fullmatch(r"[a-z0-9-]{1,40}", str(entry.get("slug", ""))))
        except (OSError, ValueError):
            pass
    return _starters


def ensure_starters():
    """Puts the starter GIFs that ship with the site (static/gifs) into the library the first time it is looked at (and again if
    somebody emptied the table), so that it is never empty."""
    entries = starter_index()
    if not entries:
        return
    have = {row.id for row in PulseGif.query.filter_by(starter=True).with_entities(PulseGif.id)}
    added = False
    for entry in entries:
        gif_id = starter_id(entry["slug"])
        if gif_id in have:
            continue
        try:
            with open(os.path.join(STARTER_DIR, os.path.basename(str(entry.get("file", entry["slug"] + ".gif")))), "rb") as handle:
                data = handle.read(MAX_GIF_BYTES + 1)
        except OSError:
            continue
        info = gif_info(data) if len(data) <= MAX_GIF_BYTES else None
        if info is None:
            continue
        title = clean_text(str(entry.get("title", "")), MAX_GIF_TITLE, keep_newlines=False) or ""
        db.session.add(PulseGif(id=gif_id, owner_id=None, title=title, data=data, size=len(data), width=info[0], height=info[1], frames=info[2], starter=True))
        added = True
    if added:
        try:
            db.session.commit()
        except IntegrityError:                                    # another request put them in at the same moment
            db.session.rollback()


def gif_json(gif, viewer_id=None, favorites=()):
    return {"id": gif.id, "url": f"/pulse-gif/{gif.id}", "title": gif.title, "width": gif.width, "height": gif.height, "favorites": gif.favorites,
            "uses": gif.uses, "starter": bool(gif.starter), "mine": bool(viewer_id and gif.owner_id == viewer_id), "favorite": gif.id in favorites}


def gifs_by_id(ids):
    """{id: gif} of the library GIFs with these ids, without their bytes."""
    wanted = {value for value in ids if isinstance(value, str) and GIF_ID_RE.fullmatch(value)}
    if not wanted:
        return {}
    return {gif.id: gif for gif in PulseGif.query.options(defer(PulseGif.data)).filter(PulseGif.id.in_(wanted))}


def group_unread(user):
    """{group id: number of messages of others the user has not seen} for every group the user is in."""
    rows = (db.session.query(YipiGroupMessage.group_id, func.count(YipiGroupMessage.id))
            .join(YipiGroupMember, and_(YipiGroupMember.group_id == YipiGroupMessage.group_id, YipiGroupMember.user_id == user.id))
            .filter(YipiGroupMessage.id > YipiGroupMember.last_read, YipiGroupMessage.sender_id != user.id).group_by(YipiGroupMessage.group_id).all())
    return dict(rows)


def media_json(item):
    return {"id": item.id, "url": media_url(item.id), "width": item.width, "height": item.height, "alt": item.alt, "gif": item.content_type == "image/gif", "gifId": item.gif_id}


def favorite_ids(viewer, ids):
    """Which of these library GIFs the viewer has marked with a star."""
    wanted = {value for value in ids if isinstance(value, str) and GIF_ID_RE.fullmatch(value)}
    if viewer is None or not wanted:
        return set()
    return {row.gif_id for row in PulseGifFav.query.filter(PulseGifFav.user_id == viewer.id, PulseGifFav.gif_id.in_(wanted))}


def user_brief(user):
    return {"handle": user.handle, "name": user.name, "avatar": media_url(user.avatar_id)}


def hidden_user_ids(viewer):
    """People whose posts this viewer does not see: those they blocked or muted, and those who blocked them."""
    if viewer is None:
        return set()
    ids = {row.blocked_id for row in YipiBlock.query.filter_by(blocker_id=viewer.id)}
    ids |= {row.muted_id for row in YipiMute.query.filter_by(muter_id=viewer.id)}
    ids |= {row.blocker_id for row in YipiBlock.query.filter_by(blocked_id=viewer.id)}
    return ids


def suspended_ids():
    return {row.id for row in YipiUser.query.filter_by(suspended=True).with_entities(YipiUser.id)}


def user_dict(user, viewer=None, relations=None):
    """A profile. `relations` (optional) already knows who the viewer follows, blocks, mutes and who follows the viewer."""
    data = {
        "id": user.id, "handle": user.handle, "name": user.name, "bio": user.bio, "location": user.location, "website": user.website,
        "avatar": media_url(user.avatar_id), "banner": media_url(user.banner_id), "createdAt": iso(user.created_at),
        "followers": user.followers_count, "following": user.following_count, "posts": user.posts_count,
        "isMe": bool(viewer and viewer.id == user.id), "suspended": user.suspended, "pinnedPostId": user.pinned_post_id,
    }
    if viewer and viewer.id != user.id:
        rel = relations or relations_to(viewer, [user.id])
        data.update({"followedByMe": user.id in rel["following"], "followsMe": user.id in rel["followers"],
                     "blockedByMe": user.id in rel["blocked"], "mutedByMe": user.id in rel["muted"], "blockedMe": user.id in rel["blockedMe"]})
    return data


def relations_to(viewer, ids):
    ids = list(ids)
    empty = {"following": set(), "followers": set(), "blocked": set(), "muted": set(), "blockedMe": set()}
    if viewer is None or not ids:
        return empty
    return {
        "following": {r.followee_id for r in YipiFollow.query.filter(YipiFollow.follower_id == viewer.id, YipiFollow.followee_id.in_(ids))},
        "followers": {r.follower_id for r in YipiFollow.query.filter(YipiFollow.followee_id == viewer.id, YipiFollow.follower_id.in_(ids))},
        "blocked": {r.blocked_id for r in YipiBlock.query.filter(YipiBlock.blocker_id == viewer.id, YipiBlock.blocked_id.in_(ids))},
        "muted": {r.muted_id for r in YipiMute.query.filter(YipiMute.muter_id == viewer.id, YipiMute.muted_id.in_(ids))},
        "blockedMe": {r.blocker_id for r in YipiBlock.query.filter(YipiBlock.blocked_id == viewer.id, YipiBlock.blocker_id.in_(ids))},
    }


# ------------------------------------------------------------------------------------------- posts to JSON
def feed_items(rows, viewer):
    """Turns post rows (including repost rows) into the JSON the page draws, with a handful of queries for the whole list."""
    rows = list(rows)
    if not rows:
        return []
    original_ids = {row.repost_of_id or row.id for row in rows}
    posts = {p.id: p for p in YipiPost.query.filter(YipiPost.id.in_(original_ids))}
    extra_ids = set()
    for post in posts.values():
        for related in (post.quote_of_id, post.reply_to_id):
            if related and related not in posts:
                extra_ids.add(related)
    extras = {p.id: p for p in YipiPost.query.filter(YipiPost.id.in_(extra_ids))} if extra_ids else {}
    everything = {**extras, **posts}
    user_ids = {p.user_id for p in everything.values()} | {row.user_id for row in rows if row.repost_of_id}
    users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_(user_ids))}
    media = {}
    rows_of_media = list(YipiMedia.query.filter(YipiMedia.post_id.in_(list(everything))).order_by(YipiMedia.position, YipiMedia.id))
    starred = favorite_ids(viewer, [item.gif_id for item in rows_of_media if item.gif_id])
    for item in rows_of_media:
        entry = media_json(item)
        entry["gifFavorite"] = item.gif_id in starred
        media.setdefault(item.post_id, []).append(entry)
    polls = poll_states([p for p in posts.values() if not p.deleted], viewer)
    liked = bookmarked = reposted = set()
    hidden = hidden_user_ids(viewer)
    if viewer:
        ids = list(original_ids)
        liked = {r.post_id for r in YipiLike.query.filter(YipiLike.user_id == viewer.id, YipiLike.post_id.in_(ids))}
        bookmarked = {r.post_id for r in YipiBookmark.query.filter(YipiBookmark.user_id == viewer.id, YipiBookmark.post_id.in_(ids))}
        reposted = {r.repost_of_id for r in YipiPost.query.filter(YipiPost.user_id == viewer.id, YipiPost.repost_of_id.in_(ids))}

    def available(post):
        owner = users.get(post.user_id) if post else None
        return bool(post and not post.deleted and owner and not owner.suspended and owner.id not in hidden)

    def brief(post):
        if post is None or not available(post):
            return {"id": post.id if post else None, "unavailable": True}
        owner = users[post.user_id]
        return {"id": post.id, "user": user_brief(owner), "text": post.text, "createdAt": iso(post.created_at), "media": media.get(post.id, [])[:1]}

    items = []
    for row in rows:
        post = posts.get(row.repost_of_id or row.id)
        if post is None:
            continue
        owner = users.get(post.user_id)
        if post.deleted:
            item = {"id": post.id, "deleted": True, "user": user_brief(owner) if owner else None, "createdAt": iso(post.created_at)}
        else:
            parent = everything.get(post.reply_to_id) if post.reply_to_id else None
            parent_owner = users.get(parent.user_id) if parent else None
            item = {
                "id": post.id, "user": user_brief(owner), "text": post.text, "createdAt": iso(post.created_at), "media": media.get(post.id, []),
                "replyTo": {"id": post.reply_to_id, "handle": parent_owner.handle if parent_owner else None} if post.reply_to_id else None,
                "quote": brief(everything.get(post.quote_of_id)) if post.quote_of_id else None,
                "counts": {"replies": post.reply_count, "reposts": post.repost_count + post.quote_count, "likes": post.like_count},
                "viewer": {"liked": post.id in liked, "reposted": post.id in reposted, "bookmarked": post.id in bookmarked},
                "views": post.view_count,
            }
            if post.id in polls:
                item["poll"] = polls[post.id]
        item["cursor"] = row.id
        if row.repost_of_id:
            item["repostedBy"] = user_brief(users[row.user_id]) if row.user_id in users else None
        items.append(item)
    return items


def poll_states(posts, viewer):
    """{post id: the poll as the viewer sees it}.  The numbers per answer are only handed out to somebody who may see them: the author,
    anybody who has voted, and everybody once the poll is over."""
    ids = [post.id for post in posts]
    if not ids:
        return {}
    rows = {poll.post_id: poll for poll in YipiPoll.query.filter(YipiPoll.post_id.in_(ids))}
    if not rows:
        return {}
    options = {}
    for option in YipiPollOption.query.filter(YipiPollOption.poll_id.in_([poll.id for poll in rows.values()])).order_by(YipiPollOption.position, YipiPollOption.id):
        options.setdefault(option.poll_id, []).append(option)
    mine = {}
    if viewer is not None:
        mine = {vote.poll_id: vote.option_id for vote in YipiPollVote.query.filter(YipiPollVote.user_id == viewer.id, YipiPollVote.poll_id.in_([poll.id for poll in rows.values()]))}
    owners = {post.id: post.user_id for post in posts}
    now = utcnow()
    states = {}
    for post_id, poll in rows.items():
        ended = poll.ends_at <= now
        voted = poll.id in mine
        author = viewer is not None and owners.get(post_id) == viewer.id
        show = ended or voted or author
        states[post_id] = {
            "id": poll.id, "total": poll.total, "endsAt": iso(poll.ends_at), "ended": ended, "voted": voted, "showResults": show,
            "canVote": bool(viewer is not None and not ended and not voted and not author),
            "options": [{"id": option.id, "text": option.text, "votes": option.votes if show else None, "mine": mine.get(poll.id) == option.id} for option in options.get(poll.id, [])],
        }
    return states


def feed_page(query, viewer, descending=True):
    """Runs a post query one page at a time: returns {items, next}."""
    order = YipiPost.id.desc() if descending else YipiPost.id.asc()
    rows = query.order_by(order).limit(PAGE + 1).all()
    more = len(rows) > PAGE
    rows = rows[:PAGE]
    items = feed_items(rows, viewer)
    return {"ok": True, "items": items, "next": rows[-1].id if more and rows else None}


def visible_posts(viewer):
    """The rows a reader may see in a list: not deleted, not from suspended, blocked or muted people."""
    query = YipiPost.query.filter(YipiPost.deleted.is_(False))
    banned = suspended_ids() | hidden_user_ids(viewer)
    if banned:
        query = query.filter(~YipiPost.user_id.in_(banned))
    return query


# ------------------------------------------------------------------------------- notifications and counters
def notify(user_id, actor, kind, post_id=None):
    """A notification for `user_id` (never for yourself, never twice for the same like, repost or follow)."""
    if user_id == actor.id or kind not in NOTIFICATION_KINDS:
        return
    if user_id in {row.blocker_id for row in YipiBlock.query.filter_by(blocked_id=actor.id)} | {row.muted_id for row in YipiMute.query.filter_by(muter_id=user_id)}:
        return
    if kind in ("like", "repost", "follow"):
        same = YipiNotification.query.filter_by(user_id=user_id, actor_id=actor.id, kind=kind, post_id=post_id).first()
        if same is not None:
            return
    db.session.add(YipiNotification(user_id=user_id, actor_id=actor.id, kind=kind, post_id=post_id))


def bump(model, row_id, column, amount):
    """Counts up (or down) a counter in the database itself, so two requests at once do not lose a count."""
    db.session.query(model).filter(model.id == row_id).update({column: getattr(model, column.key) + amount}, synchronize_session=False)


def remove_post(post, by_admin=False):
    """Deletes a post. One with replies stays as an empty "deleted" place holder so the conversation under it keeps its shape."""
    author = db.session.get(YipiUser, post.user_id)
    if post.repost_of_id:
        bump(YipiPost, post.repost_of_id, YipiPost.repost_count, -1)
        YipiNotification.query.filter_by(actor_id=post.user_id, kind="repost", post_id=post.repost_of_id).delete()
    if post.reply_to_id:
        bump(YipiPost, post.reply_to_id, YipiPost.reply_count, -1)
    if post.quote_of_id:
        bump(YipiPost, post.quote_of_id, YipiPost.quote_count, -1)
    for repost in YipiPost.query.filter_by(repost_of_id=post.id).all():
        bump(YipiUser, repost.user_id, YipiUser.posts_count, -1)
        db.session.delete(repost)
    YipiLike.query.filter_by(post_id=post.id).delete()
    YipiBookmark.query.filter_by(post_id=post.id).delete()
    YipiTag.query.filter_by(post_id=post.id).delete()
    YipiMedia.query.filter_by(post_id=post.id).delete()
    YipiNotification.query.filter_by(post_id=post.id).delete()
    poll = YipiPoll.query.filter_by(post_id=post.id).first()
    if poll is not None:
        YipiPollVote.query.filter_by(poll_id=poll.id).delete()
        YipiPollOption.query.filter_by(poll_id=poll.id).delete()
        db.session.delete(poll)
    if author:
        bump(YipiUser, author.id, YipiUser.posts_count, -1)
        if author.pinned_post_id == post.id:
            author.pinned_post_id = None
    if post.reply_count > 0 and not post.repost_of_id:
        post.deleted = True
        post.text = ""
        post.like_count = post.quote_count = post.repost_count = 0
    else:
        db.session.delete(post)


def leave_group(group_id, user_id):
    """Takes a user out of a group; a group nobody is left in disappears, one that loses its owner gives the group to the member who was there longest."""
    YipiGroupMember.query.filter_by(group_id=group_id, user_id=user_id).delete()
    db.session.flush()
    group = db.session.get(YipiGroup, group_id)
    if group is None:
        return
    rest = YipiGroupMember.query.filter_by(group_id=group_id).order_by(YipiGroupMember.id).first()
    if rest is None:
        YipiGroupMessage.query.filter_by(group_id=group_id).delete()
        db.session.delete(group)
    elif group.owner_id == user_id:
        group.owner_id = rest.user_id


def purge_user(user):
    """Deletes an account and everything that belongs to it."""
    uid = user.id
    for post in YipiPost.query.filter_by(user_id=uid).order_by(YipiPost.id.desc()).all():
        if db.session.get(YipiPost, post.id) is not None:
            post.reply_count = 0 if not post.repost_of_id else post.reply_count      # the account is going away: nothing is kept as a place holder
            remove_post(post)
    db.session.flush()
    for like in YipiLike.query.filter_by(user_id=uid).all():
        bump(YipiPost, like.post_id, YipiPost.like_count, -1)
        db.session.delete(like)
    for follow in YipiFollow.query.filter(or_(YipiFollow.follower_id == uid, YipiFollow.followee_id == uid)).all():
        other = follow.followee_id if follow.follower_id == uid else follow.follower_id
        if follow.follower_id == uid:
            bump(YipiUser, other, YipiUser.followers_count, -1)
        else:
            bump(YipiUser, other, YipiUser.following_count, -1)
        db.session.delete(follow)
    for vote in YipiPollVote.query.filter_by(user_id=uid).all():
        bump(YipiPollOption, vote.option_id, YipiPollOption.votes, -1)
        bump(YipiPoll, vote.poll_id, YipiPoll.total, -1)
        db.session.delete(vote)
    YipiBookmark.query.filter_by(user_id=uid).delete()
    YipiBlock.query.filter(or_(YipiBlock.blocker_id == uid, YipiBlock.blocked_id == uid)).delete()
    YipiMute.query.filter(or_(YipiMute.muter_id == uid, YipiMute.muted_id == uid)).delete()
    YipiNotification.query.filter(or_(YipiNotification.user_id == uid, YipiNotification.actor_id == uid)).delete()
    YipiMessage.query.filter(or_(YipiMessage.sender_id == uid, YipiMessage.recipient_id == uid)).delete()
    for member in YipiGroupMember.query.filter_by(user_id=uid).all():
        leave_group(member.group_id, uid)
    YipiGroupMessage.query.filter_by(sender_id=uid).delete()
    YipiReport.query.filter_by(reporter_id=uid).delete()
    YipiMedia.query.filter_by(owner_id=uid).delete()
    PulseGifFav.query.filter_by(user_id=uid).delete()
    own_gifs = [row.id for row in PulseGif.query.filter_by(owner_id=uid).with_entities(PulseGif.id)]
    if own_gifs:
        PulseGifFav.query.filter(PulseGifFav.gif_id.in_(own_gifs)).delete(synchronize_session=False)
        PulseGif.query.filter(PulseGif.id.in_(own_gifs)).delete(synchronize_session=False)
    db.session.delete(user)


def cleanup_orphans(user):
    """Pictures that were uploaded but never used (not in a post, not an avatar or banner) disappear after a day."""
    keep = [x for x in (user.avatar_id, user.banner_id) if x]
    query = YipiMedia.query.filter(YipiMedia.owner_id == user.id, YipiMedia.post_id.is_(None), YipiMedia.created_at < utcnow() - timedelta(days=1))
    if keep:
        query = query.filter(~YipiMedia.id.in_(keep))
    query.delete(synchronize_session=False)


# ---------------------------------------------------------------------------------------------- the page
def page_meta(path):
    """Title and description for link previews of the pages that have something to say (profiles, single posts)."""
    title, description = f"{SITE_NAME}: was gerade passiert", DESCRIPTION
    if path == "/games":                                          # (these two look like a profile address, so they are answered first)
        return f"Games auf {SITE_NAME}: kommt bald", "Kleine Spiele für dich und deine Freunde. Kommt bald!"
    if path == "/videos":
        return f"Videos auf {SITE_NAME}: kommt bald", "Kurze Videos auf Pulse. Kommt bald!"
    match = re.fullmatch(r"/([A-Za-z0-9_]{3,15})(?:/status/(\d+))?", path)
    if match:
        user = YipiUser.query.filter_by(handle_lc=match.group(1).lower()).first()
        if user and not user.suspended:
            if match.group(2):
                post = db.session.get(YipiPost, int(match.group(2)))
                if post and not post.deleted and post.user_id == user.id and not post.repost_of_id:
                    title = f"{user.name} auf {SITE_NAME}: „{post.text[:80]}{'…' if len(post.text) > 80 else ''}“"
                    description = post.text[:200] or "Ein Beitrag mit Bild."
            else:
                title = f"{user.name} (@{user.handle}) auf {SITE_NAME}"
                description = user.bio or f"Die neuesten Beiträge von @{user.handle}."
    elif path == "/i/nex":
        title, description = f"Nex auf {SITE_NAME}", "Nex ist die KI von Pulse: frag sie etwas, lass dir einen Beitrag erklären oder dir beim Schreiben helfen."
    return title, description


def manifest():
    return {
        "name": f"{SITE_NAME}: was gerade passiert", "short_name": SITE_NAME, "description": DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "portrait-primary",
        "background_color": "#000000", "theme_color": "#000000", "categories": ["social"],
        "icons": [
            {"src": "/static/img/pulse-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/pulse-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/pulse-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def page_headers(response):
    """The headers every page of the site (the app itself, the legal pages, the error pages) is sent with."""
    response.headers["Content-Security-Policy"] = CONTENT_SECURITY_POLICY
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
    return response


def error_page(code, title, text):
    """The page for a mistake (a 404, a 500) for the whole site."""
    return page_headers(make_response(render_template("error.html", code=code, title=title, text=text), code))


def base_url():
    root = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{root if root in ('http', 'https') else 'https'}://{request.host}"


# --------------------------------------------------------------------------------------------- the routes
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
        if request.endpoint in ENDPOINTS and request.path.startswith("/api/yipi/") and request.method not in ("GET", "HEAD") and not same_origin():
            return fail("forbidden", 403)

    app.before_request(api_guard)

    @app.after_request
    def yipi_headers(response):
        if request.endpoint in ENDPOINTS:
            response.headers.setdefault("X-Content-Type-Options", "nosniff")
            response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
            if request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https":
                response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
            if request.path.startswith("/api/yipi/"):
                response.headers["Cache-Control"] = "no-store"
                response.headers["Vary"] = "Cookie"
        return response

    def need_user():
        user = current_user()
        return user, (None if user else fail("not_logged_in", 401))

    def body():
        data = read_json()
        return data, (None if data is not None else fail("bad_request", 415))

    def find_user(handle):
        return YipiUser.query.filter_by(handle_lc=str(handle).lower()).first() if HANDLE_RE.fullmatch(str(handle)) else None

    def touch(user):
        now = utcnow()
        if user.last_seen_at is None or now - user.last_seen_at > timedelta(minutes=5):
            user.last_seen_at = now
            db.session.commit()

    def me_dict(user):
        unread = YipiNotification.query.filter_by(user_id=user.id, read=False).count()
        messages = YipiMessage.query.filter_by(recipient_id=user.id, read=False).count() + sum(group_unread(user).values())
        data = user_dict(user, user)
        data.update({"email": user.email or "", "unreadNotifications": unread, "unreadMessages": messages, "isAdmin": is_admin(user)})
        return data

    # ------------------------------------------------------------------------------------ account
    @route("/api/yipi/handle")
    def yipi_handle_check():
        handle = request.args.get("handle", "")
        if not HANDLE_RE.fullmatch(handle):
            return jsonify({"ok": True, "available": False, "reason": "format"})
        if handle.lower() in RESERVED_HANDLES:
            return jsonify({"ok": True, "available": False, "reason": "reserved"})
        taken = YipiUser.query.filter_by(handle_lc=handle.lower()).first() is not None
        return jsonify({"ok": True, "available": not taken, "reason": "taken" if taken else None})

    @route("/api/yipi/signup", methods=["POST"])
    def yipi_signup():
        data, problem = body()
        if problem:
            return problem
        first, last = client_addresses()
        if limiter.too_many("signup-ip", first) or limiter.too_many("signup-flood", last):
            return fail("too_many", 429)
        handle = data.get("handle")
        if not isinstance(handle, str) or not HANDLE_RE.fullmatch(handle):
            return fail("bad_handle")
        if handle.lower() in RESERVED_HANDLES:
            return fail("reserved_handle")
        if not valid_password(data.get("password")):
            return fail("bad_password")
        if data.get("adult") is not True:
            return fail("need_age")
        email = None
        if data.get("email") not in (None, ""):
            email = normalise_email(data.get("email"))
            if email is None:
                return fail("bad_email")
            if YipiUser.query.filter_by(email=email).first() is not None:
                return fail("email_taken", 409)
        name = clean_text(data.get("name") or handle, MAX_NAME, keep_newlines=False) or handle
        if YipiUser.query.filter_by(handle_lc=handle.lower()).first() is not None:
            return fail("handle_taken", 409)
        user = YipiUser(handle=handle, handle_lc=handle.lower(), name=name or handle, email=email, last_seen_at=utcnow())
        user.set_password(data["password"])
        db.session.add(user)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return fail("handle_taken", 409)
        return signed_in(jsonify({"ok": True, "me": me_dict(user)}), user)

    @route("/api/yipi/login", methods=["POST"])
    def yipi_login():
        data, problem = body()
        if problem:
            return problem
        name = data.get("login")
        password = data.get("password")
        key = str(name).strip().lower()[:254] if isinstance(name, str) else ""
        first, last = client_addresses()
        if limiter.too_many("login-ip", first) or limiter.too_many("login-flood", last) or (key and limiter.too_many("login-name", key)):
            return fail("too_many", 429)
        user = None
        if key:
            by_mail = "@" in key and not key.startswith("@")           # "@mia" is a handle, "mia@example.com" an e-mail address
            user = YipiUser.query.filter_by(email=key).first() if by_mail else YipiUser.query.filter_by(handle_lc=key.lstrip("@")).first()
        hash_to_check = user.password_hash if user else _DUMMY_HASH
        right = isinstance(password, str) and len(password) <= MAX_PASSWORD and check_password_hash(hash_to_check, password)
        if not user or not right:
            return fail("wrong_login", 401)
        if user.suspended:
            return fail("suspended", 403)
        limiter.clear("login-name", key)
        user.last_seen_at = utcnow()
        db.session.commit()
        return signed_in(jsonify({"ok": True, "me": me_dict(user)}), user)

    @route("/api/yipi/logout", methods=["POST"])
    def yipi_logout():
        return auth.clear(jsonify({"ok": True}))

    @route("/api/yipi/me")
    def yipi_me():
        user = current_user()
        if user is None:
            return jsonify({"ok": True, "me": None})
        touch(user)
        return jsonify({"ok": True, "me": me_dict(user)})

    @route("/api/yipi/password", methods=["POST"])
    def yipi_password():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("password", str(user.id)):
            return fail("too_many", 429)
        old, new = data.get("oldPassword"), data.get("newPassword")
        if not isinstance(old, str) or len(old) > MAX_PASSWORD or not user.check_password(old):
            return fail("wrong_password", 403)
        if not valid_password(new):
            return fail("bad_password")
        user.set_password(new)
        user.session_gen += 1
        db.session.commit()
        return signed_in(jsonify({"ok": True}), user)

    @route("/api/yipi/delete", methods=["POST"])
    def yipi_delete_account():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("delete", str(user.id)):
            return fail("too_many", 429)
        password = data.get("password")
        if not isinstance(password, str) or len(password) > MAX_PASSWORD or not user.check_password(password):
            return fail("wrong_password", 403)
        purge_user(user)
        db.session.commit()
        return auth.clear(jsonify({"ok": True}))

    @route("/api/yipi/profile", methods=["PATCH"])
    def yipi_update_profile():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("profile", str(user.id)):
            return fail("too_many", 429)
        if "name" in data:
            name = clean_text(data["name"], MAX_NAME, keep_newlines=False)
            if not name:
                return fail("bad_name")
            user.name = name
        if "bio" in data:
            bio = clean_text(data["bio"], MAX_BIO)
            if bio is None:
                return fail("bad_bio")
            user.bio = bio
        if "location" in data:
            place = clean_text(data["location"], MAX_LOCATION, keep_newlines=False)
            if place is None:
                return fail("bad_location")
            user.location = place
        if "website" in data:
            site = data["website"].strip() if isinstance(data["website"], str) else None
            if site is None or not valid_website(site):
                return fail("bad_website")
            user.website = site
        for field, column in (("avatar", "avatar_id"), ("banner", "banner_id")):
            if field in data:
                value = data[field]
                if value in ("", None):
                    setattr(user, column, None)
                else:
                    item = db.session.get(YipiMedia, value) if isinstance(value, str) else None
                    if item is None or item.owner_id != user.id:
                        return fail("bad_media")
                    setattr(user, column, item.id)
        db.session.commit()
        return jsonify({"ok": True, "me": me_dict(user)})

    # ------------------------------------------------------------------------------------ pictures
    @route("/api/yipi/media", methods=["POST"])
    def yipi_upload():
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("media", str(user.id)):
            return fail("too_many", 429)
        upload = request.files.get("file")
        if upload is None:
            return fail("no_file")
        data = upload.read(MAX_IMAGE_BYTES + 1)
        if looks_like_video(data, upload.filename, upload.mimetype):
            return fail("no_video", 415)                             # Pulse takes photos and GIFs, never videos
        if len(data) > MAX_IMAGE_BYTES:
            return fail("too_big", 413)
        info = image_info(data)
        if info is None or info[1] < 1 or info[2] < 1 or info[1] * info[2] > MAX_PIXELS:
            return fail("bad_image", 415)
        alt = clean_text(request.form.get("alt", ""), 200, keep_newlines=False) or ""
        cleanup_orphans(user)
        item = YipiMedia(id=uuid.uuid4().hex, owner_id=user.id, content_type=info[0], data=data, size=len(data), width=info[1], height=info[2], alt=alt)
        db.session.add(item)
        db.session.commit()
        return jsonify({"ok": True, "media": media_json(item)})

    @route("/yipi-media/<media_id>")
    def yipi_media_file(media_id):
        item = db.session.get(YipiMedia, media_id) if re.fullmatch(r"[0-9a-f]{32}", media_id) else None
        if item is None:
            abort(404)
        response = Response(item.data, mimetype=item.content_type)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        response.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
        response.headers["Content-Disposition"] = "inline"
        response.set_etag(item.id)
        return response.make_conditional(request)

    # ------------------------------------------------------------------------------------ posts
    def create_post(user, data):
        text = clean_text(data.get("text", ""), MAX_POST)
        if text is None:
            return None, fail("too_long" if isinstance(data.get("text", ""), str) else "bad_text")
        media_ids = data.get("media") or []
        if not isinstance(media_ids, list) or len(media_ids) > MAX_MEDIA or not all(isinstance(m, str) for m in media_ids) or len(set(media_ids)) != len(media_ids):
            return None, fail("bad_media")
        if not text and not media_ids:
            return None, fail("empty")
        poll_options, poll_minutes = None, POLL_MINUTES[2]
        if data.get("poll") is not None:
            poll = data["poll"]
            if not isinstance(poll, dict) or media_ids or data.get("replyTo") is not None or data.get("quoteOf") is not None:
                return None, fail("bad_poll")                    # a poll is a post of its own: no photos, not a reply, not a quote
            if not text:
                return None, fail("poll_text")
            raw = poll.get("options")
            if not isinstance(raw, list) or not POLL_OPTIONS[0] <= len(raw) <= POLL_OPTIONS[1]:
                return None, fail("bad_poll")
            poll_options = [clean_text(option, MAX_POLL_OPTION, keep_newlines=False) for option in raw]
            if any(not option for option in poll_options) or len({option.lower() for option in poll_options}) != len(poll_options):
                return None, fail("bad_poll")
            minutes = poll.get("minutes", POLL_MINUTES[2])
            if isinstance(minutes, bool) or not isinstance(minutes, int) or not POLL_MINUTES[0] <= minutes <= POLL_MINUTES[1]:
                return None, fail("bad_poll")
            poll_minutes = minutes
        if limiter.too_many("post-burst", str(user.id)) or limiter.too_many("post-hour", str(user.id)):
            return None, fail("too_many", 429)
        reply_to = quote_of = None
        if data.get("replyTo") is not None:
            reply_to = db.session.get(YipiPost, clamp_cursor(data["replyTo"]) or 0)
            if reply_to is None or reply_to.deleted or reply_to.repost_of_id:
                return None, fail("reply_gone", 404)
        if data.get("quoteOf") is not None:
            quote_of = db.session.get(YipiPost, clamp_cursor(data["quoteOf"]) or 0)
            if quote_of is None or quote_of.deleted or quote_of.repost_of_id:
                return None, fail("quote_gone", 404)
            if not text and not media_ids:
                return None, fail("empty")
        for target in (reply_to, quote_of):
            if target is not None:
                owner = db.session.get(YipiUser, target.user_id)
                if owner is None or owner.suspended or target.user_id in hidden_user_ids(user):
                    return None, fail("blocked", 403)
        if text:
            same = YipiPost.query.filter(YipiPost.user_id == user.id, YipiPost.text == text, YipiPost.repost_of_id.is_(None),
                                         YipiPost.created_at > utcnow() - timedelta(minutes=2), YipiPost.reply_to_id == (reply_to.id if reply_to else None)).first()
            if same is not None:
                return None, fail("duplicate", 409)
        items = []
        for position, media_id in enumerate(media_ids):
            item = db.session.get(YipiMedia, media_id)
            if item is None or item.owner_id != user.id or item.post_id is not None or media_id in (user.avatar_id, user.banner_id):
                return None, fail("bad_media")
            items.append((position, item))
        if len(items) > 1 and any(item.content_type == "image/gif" for _, item in items):
            return None, fail("gif_alone")                           # up to three photos, or one GIF
        post = YipiPost(user_id=user.id, text=text, reply_to_id=reply_to.id if reply_to else None, quote_of_id=quote_of.id if quote_of else None,
                        root_id=(reply_to.root_id or reply_to.id) if reply_to else None)
        db.session.add(post)
        db.session.flush()
        for position, item in items:
            item.post_id = post.id
            item.position = position
        for tag in extract_tags(text):
            db.session.add(YipiTag(tag=tag, post_id=post.id, user_id=user.id))
        if poll_options:
            poll_row = YipiPoll(post_id=post.id, ends_at=utcnow() + timedelta(minutes=poll_minutes))
            db.session.add(poll_row)
            db.session.flush()
            for position, option in enumerate(poll_options):
                db.session.add(YipiPollOption(poll_id=poll_row.id, position=position, text=option))
        bump(YipiUser, user.id, YipiUser.posts_count, 1)
        told = set()
        if reply_to:
            bump(YipiPost, reply_to.id, YipiPost.reply_count, 1)
            notify(reply_to.user_id, user, "reply", post.id)
            told.add(reply_to.user_id)
        if quote_of:
            bump(YipiPost, quote_of.id, YipiPost.quote_count, 1)
            notify(quote_of.user_id, user, "quote", post.id)
            told.add(quote_of.user_id)
        for name in extract_mentions(text):
            target = YipiUser.query.filter_by(handle_lc=name).first()
            if target and target.id not in told and not target.suspended:
                notify(target.id, user, "mention", post.id)
                told.add(target.id)
        db.session.commit()
        return post, None

    @route("/api/yipi/posts", methods=["POST"])
    def yipi_post_create():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        post, problem = create_post(user, data)
        if problem:
            return problem
        return jsonify({"ok": True, "post": feed_items([post], user)[0]}), 201

    def get_post_or_none(post_id, viewer):
        post = db.session.get(YipiPost, post_id)
        if post is None or post.repost_of_id:
            return None
        owner = db.session.get(YipiUser, post.user_id)
        if owner is None or owner.suspended:
            return None
        return post

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>")
    def yipi_post_get(post_id):
        viewer = current_user()
        post = get_post_or_none(post_id, viewer)
        if post is None:
            return fail("not_found", 404)
        if viewer and post.user_id in hidden_user_ids(viewer) and post.user_id != viewer.id:
            return fail("blocked", 403)
        ancestors = []
        parent_id = post.reply_to_id
        while parent_id and len(ancestors) < 12:
            parent = db.session.get(YipiPost, parent_id)
            if parent is None:
                break
            ancestors.append(parent)
            parent_id = parent.reply_to_id
        ancestors.reverse()
        rows = ancestors + [post]
        items = feed_items(rows, viewer)
        return jsonify({"ok": True, "post": items[-1], "ancestors": items[:-1]})

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/replies")
    def yipi_post_replies(post_id):
        viewer = current_user()
        post = get_post_or_none(post_id, viewer)
        if post is None:
            return fail("not_found", 404)
        query = visible_posts(viewer).filter(YipiPost.reply_to_id == post_id)
        cursor = clamp_cursor(request.args.get("cursor"))
        if cursor:
            query = query.filter(YipiPost.id > cursor)
        rows = query.order_by(YipiPost.id.asc()).limit(PAGE + 1).all()
        more = len(rows) > PAGE
        rows = rows[:PAGE]
        return jsonify({"ok": True, "items": feed_items(rows, viewer), "next": rows[-1].id if more and rows else None})

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/vote", methods=["POST"])
    def yipi_vote(post_id):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("vote", str(user.id)):
            return fail("too_many", 429)
        post = get_post_or_none(post_id, user)
        if post is None or post.deleted:
            return fail("not_found", 404)
        if post.user_id in hidden_user_ids(user) and post.user_id != user.id:
            return fail("blocked", 403)
        poll = YipiPoll.query.filter_by(post_id=post.id).first()
        if poll is None:
            return fail("not_found", 404)
        if poll.ends_at <= utcnow():
            return fail("poll_closed", 409)
        if post.user_id == user.id:
            return fail("self", 400)
        option_id = data.get("optionId")
        option = YipiPollOption.query.filter_by(id=option_id, poll_id=poll.id).first() if isinstance(option_id, int) and not isinstance(option_id, bool) else None
        if option is None:
            return fail("bad_option")
        try:
            db.session.add(YipiPollVote(poll_id=poll.id, user_id=user.id, option_id=option.id))
            bump(YipiPollOption, option.id, YipiPollOption.votes, 1)
            bump(YipiPoll, poll.id, YipiPoll.total, 1)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return fail("already_voted", 409)
        return jsonify({"ok": True, "post": feed_items([post], user)[0]})

    @route("/api/yipi/posts/views", methods=["POST"], endpoint="yipi_views")
    def yipi_views():
        """The page tells which posts were really on screen (a batch, once per post and page view): the counter "Aufrufe" of each goes up."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("views", str(user.id)):
            return fail("too_many", 429)
        raw = data.get("ids")
        if not isinstance(raw, list):
            return fail("bad_request")
        ids = {clamp_cursor(value) for value in raw[:MAX_VIEWS_AT_ONCE] if isinstance(value, int) and not isinstance(value, bool)}
        ids.discard(None)
        ids.discard(0)
        counted = 0
        if ids:
            for post in YipiPost.query.filter(YipiPost.id.in_(ids), YipiPost.deleted.is_(False), YipiPost.repost_of_id.is_(None), YipiPost.user_id != user.id):
                bump(YipiPost, post.id, YipiPost.view_count, 1)
                counted += 1
            db.session.commit()
        return jsonify({"ok": True, "counted": counted})

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/likes")
    def yipi_post_likes(post_id):
        viewer = current_user()
        post = get_post_or_none(post_id, viewer)
        if post is None or post.deleted:
            return fail("not_found", 404)
        query = YipiLike.query.filter_by(post_id=post.id)
        hidden = hidden_user_ids(viewer)
        if hidden:
            query = query.filter(~YipiLike.user_id.in_(hidden))
        return people_page(query.order_by(YipiLike.id.desc()), viewer, "user_id")

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/reposts")
    def yipi_post_reposts(post_id):
        viewer = current_user()
        post = get_post_or_none(post_id, viewer)
        if post is None or post.deleted:
            return fail("not_found", 404)
        query = YipiPost.query.filter(YipiPost.repost_of_id == post.id)
        hidden = hidden_user_ids(viewer)
        if hidden:
            query = query.filter(~YipiPost.user_id.in_(hidden))
        return people_page(query.order_by(YipiPost.id.desc()), viewer, "user_id")

    def set_pin(post_id, on):
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("pin", str(user.id)):
            return fail("too_many", 429)
        post = db.session.get(YipiPost, post_id)
        if post is None or post.deleted or post.user_id != user.id:
            return fail("not_found", 404)
        if on:
            if post.reply_to_id or post.repost_of_id:
                return fail("bad_request")                        # a reply or a repost cannot be pinned
            user.pinned_post_id = post.id
        elif user.pinned_post_id == post.id:
            user.pinned_post_id = None
        db.session.commit()
        return jsonify({"ok": True, "pinnedPostId": user.pinned_post_id})

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/pin", methods=["POST"], endpoint="yipi_pin")
    def yipi_pin(post_id):
        return set_pin(post_id, True)

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/pin", methods=["DELETE"], endpoint="yipi_unpin")
    def yipi_unpin(post_id):
        return set_pin(post_id, False)

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>", methods=["DELETE"])
    def yipi_post_delete(post_id):
        user, problem = need_user()
        if problem:
            return problem
        post = db.session.get(YipiPost, post_id)
        if post is None:
            return fail("not_found", 404)
        if post.user_id != user.id and not is_admin(user):
            return fail("forbidden", 403)
        remove_post(post)
        db.session.commit()
        return jsonify({"ok": True})

    def toggle(model, user, post_id, on, counter=None, kind=None):
        """Likes and bookmarks: adding what is there already, or removing what is not there, changes nothing."""
        existing = model.query.filter_by(user_id=user.id, post_id=post_id).first()
        if on and existing is None:
            db.session.add(model(user_id=user.id, post_id=post_id))
            if counter is not None:
                bump(YipiPost, post_id, counter, 1)
            return True
        if not on and existing is not None:
            db.session.delete(existing)
            if counter is not None:
                bump(YipiPost, post_id, counter, -1)
            return True
        return False

    def interact(post_id, on, model, counter, kind):
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("like", str(user.id)):
            return fail("too_many", 429)
        post = get_post_or_none(post_id, user)
        if post is None or post.deleted:
            return fail("not_found", 404)
        if post.user_id in hidden_user_ids(user) and post.user_id != user.id:
            return fail("blocked", 403)
        try:
            changed = toggle(model, user, post_id, on, counter)
            if changed and on and kind:
                notify(post.user_id, user, kind, post_id)
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        db.session.refresh(post)
        return jsonify({"ok": True, "counts": {"replies": post.reply_count, "reposts": post.repost_count + post.quote_count, "likes": post.like_count}})

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/like", methods=["POST"], endpoint="yipi_like")
    def yipi_like(post_id):
        return interact(post_id, True, YipiLike, YipiPost.like_count, "like")

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/like", methods=["DELETE"], endpoint="yipi_unlike")
    def yipi_unlike(post_id):
        return interact(post_id, False, YipiLike, YipiPost.like_count, None)

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/bookmark", methods=["POST"], endpoint="yipi_bookmark")
    def yipi_bookmark(post_id):
        return interact(post_id, True, YipiBookmark, None, None)

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/bookmark", methods=["DELETE"], endpoint="yipi_unbookmark")
    def yipi_unbookmark(post_id):
        return interact(post_id, False, YipiBookmark, None, None)

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/repost", methods=["POST"], endpoint="yipi_repost")
    def yipi_repost(post_id):
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("like", str(user.id)):
            return fail("too_many", 429)
        post = get_post_or_none(post_id, user)
        if post is None or post.deleted:
            return fail("not_found", 404)
        if post.user_id in hidden_user_ids(user) and post.user_id != user.id:
            return fail("blocked", 403)
        if YipiPost.query.filter_by(user_id=user.id, repost_of_id=post_id).first() is None:
            db.session.add(YipiPost(user_id=user.id, text="", repost_of_id=post_id))
            bump(YipiPost, post_id, YipiPost.repost_count, 1)
            bump(YipiUser, user.id, YipiUser.posts_count, 1)
            notify(post.user_id, user, "repost", post_id)
            db.session.commit()
        db.session.refresh(post)
        return jsonify({"ok": True, "counts": {"replies": post.reply_count, "reposts": post.repost_count + post.quote_count, "likes": post.like_count}})

    @route("/api/yipi/posts/<int(min=1, max=4611686018427387904):post_id>/repost", methods=["DELETE"], endpoint="yipi_unrepost")
    def yipi_unrepost(post_id):
        user, problem = need_user()
        if problem:
            return problem
        post = db.session.get(YipiPost, post_id)
        if post is None:
            return fail("not_found", 404)
        mine = YipiPost.query.filter_by(user_id=user.id, repost_of_id=post_id).first()
        if mine is not None:
            remove_post(mine)
            db.session.commit()
            db.session.refresh(post)
        return jsonify({"ok": True, "counts": {"replies": post.reply_count, "reposts": post.repost_count + post.quote_count, "likes": post.like_count}})

    # ---------------------------------------------------------------------------------------- feeds
    @route("/api/yipi/timeline")
    def yipi_timeline():
        viewer = current_user()
        feed = request.args.get("feed", "foryou")
        cursor = clamp_cursor(request.args.get("cursor"))
        if feed == "following":
            if viewer is None:
                return fail("not_logged_in", 401)
            followed = [r.followee_id for r in YipiFollow.query.filter_by(follower_id=viewer.id)] + [viewer.id]
            query = visible_posts(viewer).filter(YipiPost.user_id.in_(followed), YipiPost.reply_to_id.is_(None))
            if hidden_user_ids(viewer):
                originals = select(YipiPost.id).where(YipiPost.user_id.in_(hidden_user_ids(viewer)))
                query = query.filter(or_(YipiPost.repost_of_id.is_(None), ~YipiPost.repost_of_id.in_(originals)))
        else:
            query = visible_posts(viewer).filter(YipiPost.reply_to_id.is_(None), YipiPost.repost_of_id.is_(None))
            if feed == "media":                                   # Explore, "Medien": posts with photos or a GIF
                query = query.filter(YipiPost.id.in_(select(YipiMedia.post_id).where(YipiMedia.post_id.isnot(None))))
        if cursor:
            query = query.filter(YipiPost.id < cursor)
        return jsonify(feed_page(query, viewer))

    @route("/api/yipi/timeline/new")
    def yipi_timeline_new():
        viewer = current_user()
        after = clamp_cursor(request.args.get("after")) or 0
        feed = request.args.get("feed", "foryou")
        if feed == "following":
            if viewer is None:
                return fail("not_logged_in", 401)
            followed = [r.followee_id for r in YipiFollow.query.filter_by(follower_id=viewer.id)]
            query = visible_posts(viewer).filter(YipiPost.user_id.in_(followed), YipiPost.reply_to_id.is_(None))      # (your own Yips are added by the page itself)
        else:
            query = visible_posts(viewer).filter(YipiPost.reply_to_id.is_(None), YipiPost.repost_of_id.is_(None))
            if viewer:
                query = query.filter(YipiPost.user_id != viewer.id)
        return jsonify({"ok": True, "count": query.filter(YipiPost.id > after).count() if after else 0})

    @route("/api/yipi/users/<handle>")
    def yipi_user_get(handle):
        viewer = current_user()
        user = find_user(handle)
        if user is None:
            return fail("not_found", 404)
        data = user_dict(user, viewer)
        if user.suspended and not (viewer and is_admin(viewer)):
            return jsonify({"ok": True, "user": {"handle": user.handle, "name": user.handle, "suspended": True}})
        if viewer and data.get("blockedMe"):
            return jsonify({"ok": True, "user": {**data, "bio": "", "location": "", "website": "", "banner": None}})
        return jsonify({"ok": True, "user": data})

    @route("/api/yipi/users/<handle>/posts")
    def yipi_user_posts(handle):
        viewer = current_user()
        user = find_user(handle)
        if user is None or (user.suspended and not (viewer and is_admin(viewer))):
            return fail("not_found", 404)
        if viewer and viewer.id != user.id and user.id in {r.blocker_id for r in YipiBlock.query.filter_by(blocked_id=viewer.id)}:
            return jsonify({"ok": True, "items": [], "next": None})
        tab = request.args.get("tab", "posts")
        cursor = clamp_cursor(request.args.get("cursor"))
        if tab == "likes":
            if viewer is None or viewer.id != user.id:
                return fail("forbidden", 403)
            likes = YipiLike.query.filter_by(user_id=user.id)
            if cursor:
                likes = likes.filter(YipiLike.id < cursor)
            likes = likes.order_by(YipiLike.id.desc()).limit(PAGE + 1).all()
            more = len(likes) > PAGE
            likes = likes[:PAGE]
            posts = {p.id: p for p in YipiPost.query.filter(YipiPost.id.in_([l.post_id for l in likes]), YipiPost.deleted.is_(False))}
            banned = suspended_ids() | hidden_user_ids(viewer)
            rows = [posts[l.post_id] for l in likes if l.post_id in posts and posts[l.post_id].user_id not in banned]
            items = feed_items(rows, viewer)
            for item, like in zip(items, [l for l in likes if l.post_id in posts and posts[l.post_id].user_id not in banned]):
                item["cursor"] = like.id
            return jsonify({"ok": True, "items": items, "next": likes[-1].id if more and likes else None})
        query = visible_posts(viewer).filter(YipiPost.user_id == user.id)
        if viewer and viewer.id == user.id:
            query = YipiPost.query.filter(YipiPost.deleted.is_(False), YipiPost.user_id == user.id)
        if tab == "replies":
            query = query.filter(YipiPost.repost_of_id.is_(None))
        elif tab == "media":
            query = query.filter(YipiPost.repost_of_id.is_(None), YipiPost.id.in_(select(YipiMedia.post_id).where(YipiMedia.post_id.isnot(None))))
        else:
            query = query.filter(YipiPost.reply_to_id.is_(None))
        pinned = None
        if tab == "posts" and not cursor and user.pinned_post_id:
            candidate = db.session.get(YipiPost, user.pinned_post_id)
            if candidate is not None and not candidate.deleted and candidate.user_id == user.id and not candidate.reply_to_id and not candidate.repost_of_id:
                pinned = candidate
                query = query.filter(YipiPost.id != pinned.id)
        if cursor:
            query = query.filter(YipiPost.id < cursor)
        page = feed_page(query, viewer)
        if pinned is not None:
            first = feed_items([pinned], viewer)
            if first:
                first[0]["pinned"] = True
                page["items"].insert(0, first[0])
        return jsonify(page)

    # --------------------------------------------------------------------------------------- people
    def people_page(query, viewer, key):
        page = min(max(1, clamp_cursor(request.args.get("page")) or 1), 10000)
        rows = query.limit(PEOPLE_PAGE + 1).offset((page - 1) * PEOPLE_PAGE).all()
        more = len(rows) > PEOPLE_PAGE
        rows = rows[:PEOPLE_PAGE]
        users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_([getattr(r, key) for r in rows]), YipiUser.suspended.is_(False))}
        relations = relations_to(viewer, users)
        ordered = [users[getattr(r, key)] for r in rows if getattr(r, key) in users]
        return jsonify({"ok": True, "users": [user_dict(u, viewer, relations) for u in ordered], "next": page + 1 if more else None})

    @route("/api/yipi/users/<handle>/followers")
    def yipi_followers(handle):
        user = find_user(handle)
        if user is None or user.suspended:
            return fail("not_found", 404)
        return people_page(YipiFollow.query.filter_by(followee_id=user.id).order_by(YipiFollow.id.desc()), current_user(), "follower_id")

    @route("/api/yipi/users/<handle>/following")
    def yipi_following(handle):
        user = find_user(handle)
        if user is None or user.suspended:
            return fail("not_found", 404)
        return people_page(YipiFollow.query.filter_by(follower_id=user.id).order_by(YipiFollow.id.desc()), current_user(), "followee_id")

    @route("/api/yipi/users/<handle>/follow", methods=["POST"], endpoint="yipi_follow")
    def yipi_follow(handle):
        user, problem = need_user()
        if problem:
            return problem
        target = find_user(handle)
        if target is None or target.suspended:
            return fail("not_found", 404)
        if target.id == user.id:
            return fail("self", 400)
        if target.id in hidden_user_ids(user) - {r.muted_id for r in YipiMute.query.filter_by(muter_id=user.id)}:
            return fail("blocked", 403)
        if limiter.too_many("follow", str(user.id)):
            return fail("too_many", 429)
        if YipiFollow.query.filter_by(follower_id=user.id, followee_id=target.id).first() is None:
            db.session.add(YipiFollow(follower_id=user.id, followee_id=target.id))
            bump(YipiUser, target.id, YipiUser.followers_count, 1)
            bump(YipiUser, user.id, YipiUser.following_count, 1)
            notify(target.id, user, "follow")
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
        db.session.refresh(target)
        return jsonify({"ok": True, "user": user_dict(target, user)})

    @route("/api/yipi/users/<handle>/follow", methods=["DELETE"], endpoint="yipi_unfollow")
    def yipi_unfollow(handle):
        user, problem = need_user()
        if problem:
            return problem
        target = find_user(handle)
        if target is None:
            return fail("not_found", 404)
        follow = YipiFollow.query.filter_by(follower_id=user.id, followee_id=target.id).first()
        if follow is not None:
            db.session.delete(follow)
            bump(YipiUser, target.id, YipiUser.followers_count, -1)
            bump(YipiUser, user.id, YipiUser.following_count, -1)
            db.session.commit()
        db.session.refresh(target)
        return jsonify({"ok": True, "user": user_dict(target, user)})

    def drop_follows(a, b):
        """Blocking ends the following in both directions."""
        for follower, followee in ((a, b), (b, a)):
            follow = YipiFollow.query.filter_by(follower_id=follower, followee_id=followee).first()
            if follow is not None:
                db.session.delete(follow)
                bump(YipiUser, followee, YipiUser.followers_count, -1)
                bump(YipiUser, follower, YipiUser.following_count, -1)

    def relation_change(handle, model, mine, theirs, add):
        user, problem = need_user()
        if problem:
            return problem
        target = find_user(handle)
        if target is None:
            return fail("not_found", 404)
        if target.id == user.id:
            return fail("self", 400)
        if limiter.too_many("block", str(user.id)):
            return fail("too_many", 429)
        existing = model.query.filter_by(**{mine.key: user.id, theirs.key: target.id}).first()
        if add and existing is None:
            db.session.add(model(**{mine.key: user.id, theirs.key: target.id}))
            if model is YipiBlock:
                drop_follows(user.id, target.id)
        elif not add and existing is not None:
            db.session.delete(existing)
        db.session.commit()
        return jsonify({"ok": True, "user": user_dict(target, user)})

    @route("/api/yipi/users/<handle>/block", methods=["POST"], endpoint="yipi_block")
    def yipi_block(handle):
        return relation_change(handle, YipiBlock, YipiBlock.blocker_id, YipiBlock.blocked_id, True)

    @route("/api/yipi/users/<handle>/block", methods=["DELETE"], endpoint="yipi_unblock")
    def yipi_unblock(handle):
        return relation_change(handle, YipiBlock, YipiBlock.blocker_id, YipiBlock.blocked_id, False)

    @route("/api/yipi/users/<handle>/mute", methods=["POST"], endpoint="yipi_mute")
    def yipi_mute(handle):
        return relation_change(handle, YipiMute, YipiMute.muter_id, YipiMute.muted_id, True)

    @route("/api/yipi/users/<handle>/mute", methods=["DELETE"], endpoint="yipi_unmute")
    def yipi_unmute(handle):
        return relation_change(handle, YipiMute, YipiMute.muter_id, YipiMute.muted_id, False)

    @route("/api/yipi/settings/blocked")
    def yipi_blocked_list():
        user, problem = need_user()
        if problem:
            return problem
        return people_page(YipiBlock.query.filter_by(blocker_id=user.id).order_by(YipiBlock.id.desc()), user, "blocked_id")

    @route("/api/yipi/settings/muted")
    def yipi_muted_list():
        user, problem = need_user()
        if problem:
            return problem
        return people_page(YipiMute.query.filter_by(muter_id=user.id).order_by(YipiMute.id.desc()), user, "muted_id")

    # ------------------------------------------------------------------------- search and discovery
    @route("/api/yipi/search")
    def yipi_search():
        viewer = current_user()
        query_text = clean_text(request.args.get("q", ""), 100, keep_newlines=False) or ""
        kind = request.args.get("type", "posts")
        if len(query_text.lstrip("#@")) < 2:
            return jsonify({"ok": True, "items": [], "users": [], "next": None})
        key = str(viewer.id) if viewer else client_addresses()[0]
        if limiter.too_many("search", key):
            return fail("too_many", 429)
        if kind == "people":
            term = query_text.lstrip("@")
            banned = hidden_user_ids(viewer)
            found = YipiUser.query.filter(YipiUser.suspended.is_(False), or_(YipiUser.handle.ilike(like_pattern(term), escape="\\"), YipiUser.name.ilike(like_pattern(term), escape="\\")))
            if banned:
                found = found.filter(~YipiUser.id.in_(banned))
            found = found.order_by(YipiUser.followers_count.desc(), YipiUser.id).limit(PEOPLE_PAGE).all()
            relations = relations_to(viewer, [u.id for u in found])
            return jsonify({"ok": True, "users": [user_dict(u, viewer, relations) for u in found], "items": [], "next": None})
        query = visible_posts(viewer).filter(YipiPost.repost_of_id.is_(None))
        if query_text.startswith("#"):
            tag = query_text[1:].lower()
            query = query.filter(YipiPost.id.in_(select(YipiTag.post_id).where(YipiTag.tag == tag)))
        else:
            query = query.filter(YipiPost.text.ilike(like_pattern(query_text), escape="\\"))
        if kind == "media":
            query = query.filter(YipiPost.id.in_(select(YipiMedia.post_id).where(YipiMedia.post_id.isnot(None))))
        cursor = clamp_cursor(request.args.get("cursor"))
        if request.args.get("sort") == "top":                      # "Top": by what people did with it; the cursor is a place in that list
            start = min(cursor or 0, 1000)
            rows = query.order_by((YipiPost.like_count + 2 * YipiPost.repost_count + 2 * YipiPost.quote_count + YipiPost.reply_count).desc(), YipiPost.id.desc()).offset(start).limit(PAGE + 1).all()
            more = len(rows) > PAGE and start + PAGE < 1000
            return jsonify({"ok": True, "items": feed_items(rows[:PAGE], viewer), "users": [], "next": start + PAGE if more else None})
        if cursor:
            query = query.filter(YipiPost.id < cursor)
        page = feed_page(query, viewer)
        page["users"] = []
        return jsonify(page)

    @route("/api/yipi/trends")
    def yipi_trends():
        since = utcnow() - timedelta(hours=24)
        rows = (db.session.query(YipiTag.tag, func.count(func.distinct(YipiTag.post_id)).label("n"), func.count(func.distinct(YipiTag.user_id)).label("people"))
                .join(YipiPost, YipiPost.id == YipiTag.post_id).filter(YipiTag.created_at > since, YipiPost.deleted.is_(False))
                .group_by(YipiTag.tag).order_by(func.count(func.distinct(YipiTag.post_id)).desc(), YipiTag.tag).limit(min(max(clamp_cursor(request.args.get("limit")) or 8, 1), 30)).all())
        return jsonify({"ok": True, "trends": [{"tag": tag, "posts": n, "people": people} for tag, n, people in rows]})

    @route("/api/yipi/suggestions")
    def yipi_suggestions():
        viewer = current_user()
        query = YipiUser.query.filter(YipiUser.suspended.is_(False))
        if viewer:
            skip = {viewer.id} | {r.followee_id for r in YipiFollow.query.filter_by(follower_id=viewer.id)} | hidden_user_ids(viewer)
            query = query.filter(~YipiUser.id.in_(skip))
        people = query.order_by(YipiUser.followers_count.desc(), YipiUser.posts_count.desc(), YipiUser.id.desc()).limit(min(max(clamp_cursor(request.args.get("limit")) or 3, 1), 20)).all()
        relations = relations_to(viewer, [u.id for u in people])
        return jsonify({"ok": True, "users": [user_dict(u, viewer, relations) for u in people]})

    @route("/api/yipi/bookmarks", methods=["DELETE"], endpoint="yipi_bookmarks_clear")
    def yipi_bookmarks_clear():
        user, problem = need_user()
        if problem:
            return problem
        removed = YipiBookmark.query.filter_by(user_id=user.id).delete()
        db.session.commit()
        return jsonify({"ok": True, "removed": removed})

    @route("/api/yipi/bookmarks")
    def yipi_bookmarks():
        user, problem = need_user()
        if problem:
            return problem
        cursor = clamp_cursor(request.args.get("cursor"))
        marks = YipiBookmark.query.filter_by(user_id=user.id)
        if cursor:
            marks = marks.filter(YipiBookmark.id < cursor)
        marks = marks.order_by(YipiBookmark.id.desc()).limit(PAGE + 1).all()
        more = len(marks) > PAGE
        marks = marks[:PAGE]
        posts = {p.id: p for p in YipiPost.query.filter(YipiPost.id.in_([m.post_id for m in marks]), YipiPost.deleted.is_(False))}
        banned = suspended_ids() | hidden_user_ids(user)
        keep = [m for m in marks if m.post_id in posts and posts[m.post_id].user_id not in banned]
        items = feed_items([posts[m.post_id] for m in keep], user)
        for item, mark in zip(items, keep):
            item["cursor"] = mark.id
        return jsonify({"ok": True, "items": items, "next": marks[-1].id if more and marks else None})

    # ---------------------------------------------------------------------------------- notifications
    @route("/api/yipi/notifications")
    def yipi_notifications():
        user, problem = need_user()
        if problem:
            return problem
        cursor = clamp_cursor(request.args.get("cursor"))
        query = YipiNotification.query.filter_by(user_id=user.id)
        if request.args.get("filter") == "mentions":              # the "Erwähnungen" tab: mentions, replies and quotes
            query = query.filter(YipiNotification.kind.in_(("mention", "reply", "quote")))
        hidden = hidden_user_ids(user) | suspended_ids()
        if hidden:
            query = query.filter(~YipiNotification.actor_id.in_(hidden))
        if cursor:
            query = query.filter(YipiNotification.id < cursor)
        rows = query.order_by(YipiNotification.id.desc()).limit(PAGE + 1).all()
        more = len(rows) > PAGE
        rows = rows[:PAGE]
        actors = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_({r.actor_id for r in rows}))}
        post_ids = {r.post_id for r in rows if r.post_id}
        posts = {p.id: p for p in YipiPost.query.filter(YipiPost.id.in_(post_ids))} if post_ids else {}
        shown = {}
        for item in feed_items([p for p in posts.values() if not p.deleted], user):
            shown[item["id"]] = item
        relations = relations_to(user, [r.actor_id for r in rows if r.kind == "follow"])
        items = []
        for row in rows:
            actor = actors.get(row.actor_id)
            if actor is None:
                continue
            entry = {"id": row.id, "kind": row.kind, "createdAt": iso(row.created_at), "read": row.read, "actor": {**user_brief(actor), "bio": actor.bio, "followedByMe": actor.id in relations["following"]}}
            if row.post_id:
                entry["post"] = shown.get(row.post_id)
                if entry["post"] is None:
                    continue
            items.append(entry)
        return jsonify({"ok": True, "items": items, "next": rows[-1].id if more and rows else None})

    @route("/api/yipi/notifications/read", methods=["POST"])
    def yipi_notifications_read():
        user, problem = need_user()
        if problem:
            return problem
        YipiNotification.query.filter_by(user_id=user.id, read=False).update({"read": True})
        db.session.commit()
        return jsonify({"ok": True})

    # --------------------------------------------------------------------------------------- messages
    def message_json(row, gifs, mine, starred=()):
        gif = gifs.get(row.gif_id) if row.gif_id else None
        return {"id": row.id, "text": row.text, "createdAt": iso(row.created_at), "mine": mine,
                "gif": gif_json(gif, None, starred) if gif else ({"gone": True} if row.gif_id else None)}

    def may_message(sender, target):
        """Somebody may start a conversation with a person who follows them, or answer one who wrote to them first."""
        if YipiFollow.query.filter_by(follower_id=target.id, followee_id=sender.id).first() is not None:
            return True
        return YipiMessage.query.filter_by(sender_id=target.id, recipient_id=sender.id).first() is not None

    def dm_items(user):
        recent = (YipiMessage.query.filter(or_(YipiMessage.sender_id == user.id, YipiMessage.recipient_id == user.id))
                  .order_by(YipiMessage.id.desc()).limit(500).all())
        rows, seen = [], set()
        for row in recent:                               # the newest message of each conversation
            other_id = row.recipient_id if row.sender_id == user.id else row.sender_id
            if other_id not in seen:
                seen.add(other_id)
                rows.append(row)
        rows = rows[:50]
        hidden = hidden_user_ids(user)
        others = {(r.recipient_id if r.sender_id == user.id else r.sender_id) for r in rows}
        users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_(others))}
        unread = dict(db.session.query(YipiMessage.sender_id, func.count(YipiMessage.id)).filter(YipiMessage.recipient_id == user.id, YipiMessage.read.is_(False)).group_by(YipiMessage.sender_id).all())
        items = []
        for row in rows:
            other_id = row.recipient_id if row.sender_id == user.id else row.sender_id
            other = users.get(other_id)
            if other is None or other.suspended or other_id in hidden:
                continue
            items.append({"user": user_brief(other), "last": {"text": row.text or ("GIF" if row.gif_id else ""), "gif": bool(row.gif_id), "createdAt": iso(row.created_at), "mine": row.sender_id == user.id},
                          "unread": unread.get(other_id, 0)})
        return items

    @route("/api/yipi/messages")
    def yipi_conversations():
        user, problem = need_user()
        if problem:
            return problem
        return jsonify({"ok": True, "items": dm_items(user)})

    @route("/api/yipi/visitor")
    def yipi_visitor():
        """What this site sees of the person who asks: the notice for computers shows it to that same person, nothing of it is stored or logged."""
        first, last = client_addresses()
        chain = [part.strip() for part in request.headers.get("X-Forwarded-For", "").split(",") if part.strip()]
        header = request.headers.get
        return jsonify({"ok": True, "visitor": {
            "ip": first, "forwardedFor": ", ".join(chain)[:300], "via": last if last != first else "",
            "protocol": header("X-Forwarded-Proto", request.scheme).split(",")[0].strip()[:10], "host": request.host[:100],
            "time": iso(utcnow()), "userAgent": header("User-Agent", "")[:400], "acceptLanguage": header("Accept-Language", "")[:200], "doNotTrack": header("DNT", "")[:3]}})

    @route("/api/yipi/chats")
    def yipi_chats():
        """The list of the chats page: conversations with one person and group chats together, the newest first."""
        user, problem = need_user()
        if problem:
            return problem
        items = [{**item, "kind": "dm", "at": item["last"]["createdAt"]} for item in dm_items(user)]
        memberships = YipiGroupMember.query.filter_by(user_id=user.id).all()
        ids = [m.group_id for m in memberships]
        if ids:
            groups = {g.id: g for g in YipiGroup.query.filter(YipiGroup.id.in_(ids))}
            newest = dict(db.session.query(YipiGroupMessage.group_id, func.max(YipiGroupMessage.id)).filter(YipiGroupMessage.group_id.in_(ids)).group_by(YipiGroupMessage.group_id).all())
            rows = {row.id: row for row in YipiGroupMessage.query.filter(YipiGroupMessage.id.in_(list(newest.values())))} if newest else {}
            senders = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_({row.sender_id for row in rows.values()}))} if rows else {}
            sizes = dict(db.session.query(YipiGroupMember.group_id, func.count(YipiGroupMember.id)).filter(YipiGroupMember.group_id.in_(ids)).group_by(YipiGroupMember.group_id).all())
            unread = group_unread(user)
            for group_id, group in groups.items():
                row = rows.get(newest.get(group_id))
                sender = senders.get(row.sender_id) if row else None
                last = {"text": row.text or ("GIF" if row.gif_id else ""), "gif": bool(row.gif_id), "createdAt": iso(row.created_at), "mine": row.sender_id == user.id, "sender": sender.handle if sender else None} if row else None
                items.append({"kind": "group", "group": {"id": group.id, "name": group.name, "count": sizes.get(group_id, 1)}, "last": last, "unread": unread.get(group_id, 0), "at": last["createdAt"] if last else iso(group.created_at)})
        items.sort(key=lambda item: item["at"], reverse=True)
        return jsonify({"ok": True, "items": items[:60]})

    # ---------------------------------------------------------------------------------------- group chats
    def friends_among(user, ids):
        """Those of `ids` that follow the user and are followed back: only friends can be put into a group (nobody is pulled into a chat by a stranger)."""
        ids = list(ids)
        if not ids:
            return set()
        following = {r.followee_id for r in YipiFollow.query.filter(YipiFollow.follower_id == user.id, YipiFollow.followee_id.in_(ids))}
        followers = {r.follower_id for r in YipiFollow.query.filter(YipiFollow.followee_id == user.id, YipiFollow.follower_id.in_(ids))}
        return following & followers

    def group_json(group, viewer):
        members = YipiGroupMember.query.filter_by(group_id=group.id).order_by(YipiGroupMember.id).all()
        users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_([m.user_id for m in members]))}
        owner = users.get(group.owner_id)
        return {"id": group.id, "name": group.name, "owner": owner.handle if owner else None, "isOwner": group.owner_id == viewer.id, "count": len(members),
                "members": [{**user_brief(users[m.user_id]), "isOwner": m.user_id == group.owner_id} for m in members if m.user_id in users]}

    def group_message_json(row, users, gifs, viewer):
        sender = users.get(row.sender_id)
        gif = gifs.get(row.gif_id) if row.gif_id else None
        return {"id": row.id, "text": row.text, "createdAt": iso(row.created_at), "mine": row.sender_id == viewer.id, "sender": user_brief(sender) if sender else None,
                "gif": gif_json(gif) if gif else ({"gone": True} if row.gif_id else None)}

    def group_of(user, group_id):
        """(group, the user's membership) or (None, None) when the group is not there or the user is not in it."""
        member = YipiGroupMember.query.filter_by(group_id=group_id, user_id=user.id).first()
        group = db.session.get(YipiGroup, group_id) if member else None
        return (group, member) if group else (None, None)

    def friends_from_handles(user, handles):
        """The users behind a list of handles, who all must be friends of the user: (users, None) or (None, an error response)."""
        if not isinstance(handles, list) or not all(isinstance(name, str) for name in handles):
            return None, fail("bad_request")
        found = []
        for name in dict.fromkeys(name.lower() for name in handles):
            other = find_user(name)
            if other is None or other.suspended:
                return None, fail("not_found", 404)
            if other.id != user.id:
                found.append(other)
        hidden = hidden_user_ids(user)
        friends = friends_among(user, [u.id for u in found])
        for other in found:
            if other.id in hidden or other.id not in friends:
                return None, fail("not_friends", 403, handle=other.handle)
        return found, None

    @route("/api/yipi/friends")
    def yipi_friends():
        user, problem = need_user()
        if problem:
            return problem
        following = {r.followee_id for r in YipiFollow.query.filter_by(follower_id=user.id)}
        followers = {r.follower_id for r in YipiFollow.query.filter_by(followee_id=user.id)}
        mutual = (following & followers) - hidden_user_ids(user)
        people = YipiUser.query.filter(YipiUser.id.in_(mutual), YipiUser.suspended.is_(False)).order_by(YipiUser.name).limit(200).all() if mutual else []
        return jsonify({"ok": True, "users": [user_brief(u) for u in people]})

    @route("/api/yipi/groups", methods=["POST"], endpoint="yipi_group_create")
    def yipi_group_create():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("group", str(user.id)):
            return fail("too_many", 429)
        name = clean_text(data.get("name", ""), MAX_GROUP_NAME, keep_newlines=False)
        if not name:
            return fail("bad_group_name")
        others, problem = friends_from_handles(user, data.get("members"))
        if problem:
            return problem
        if not others or len(others) + 1 > MAX_GROUP_MEMBERS:
            return fail("bad_request")
        group = YipiGroup(name=name, owner_id=user.id)
        db.session.add(group)
        db.session.flush()
        for member in [user] + others:
            db.session.add(YipiGroupMember(group_id=group.id, user_id=member.id))
        db.session.commit()
        return jsonify({"ok": True, "group": group_json(group, user)}), 201

    @route("/api/yipi/groups/<int(min=1, max=2147483647):group_id>")
    def yipi_group_get(group_id):
        user, problem = need_user()
        if problem:
            return problem
        group, member = group_of(user, group_id)
        if group is None:
            return fail("not_found", 404)
        query = YipiGroupMessage.query.filter_by(group_id=group.id)
        cursor = clamp_cursor(request.args.get("cursor"))
        if cursor:
            query = query.filter(YipiGroupMessage.id < cursor)
        rows = query.order_by(YipiGroupMessage.id.desc()).limit(PAGE * 2 + 1).all()
        more = len(rows) > PAGE * 2
        rows = rows[:PAGE * 2]
        if rows and not cursor and rows[0].id > member.last_read:
            member.last_read = rows[0].id
            db.session.commit()
        users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_({row.sender_id for row in rows}))} if rows else {}
        gifs = gifs_by_id(row.gif_id for row in rows)
        return jsonify({"ok": True, "group": group_json(group, user), "messages": [group_message_json(row, users, gifs, user) for row in reversed(rows)], "next": rows[-1].id if more and rows else None})

    @route("/api/yipi/groups/<int(min=1, max=2147483647):group_id>/messages", methods=["POST"], endpoint="yipi_group_send")
    def yipi_group_send(group_id):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        group, member = group_of(user, group_id)
        if group is None:
            return fail("not_found", 404)
        text = clean_text(data.get("text", ""), MAX_DM)
        if text is None:
            return fail("too_long")
        gif_id = data.get("gifId")
        gifs = {}
        if gif_id is not None:
            gifs = gifs_by_id([gif_id])
            if not isinstance(gif_id, str) or gif_id not in gifs:
                return fail("gif_gone", 404)
        if not text and not gif_id:
            return fail("empty")
        if limiter.too_many("dm", str(user.id)):
            return fail("too_many", 429)
        row = YipiGroupMessage(group_id=group.id, sender_id=user.id, text=text, gif_id=gif_id)
        db.session.add(row)
        db.session.flush()
        member.last_read = row.id
        if gif_id:
            bump(PulseGif, gif_id, PulseGif.uses, 1)
        db.session.commit()
        return jsonify({"ok": True, "message": group_message_json(row, {user.id: user}, gifs, user)}), 201

    @route("/api/yipi/groups/<int(min=1, max=2147483647):group_id>/poll")
    def yipi_group_poll(group_id):
        user, problem = need_user()
        if problem:
            return problem
        group, member = group_of(user, group_id)
        if group is None:
            return fail("not_found", 404)
        after = clamp_cursor(request.args.get("after")) or 0
        rows = YipiGroupMessage.query.filter(YipiGroupMessage.group_id == group.id, YipiGroupMessage.id > after, YipiGroupMessage.sender_id != user.id).order_by(YipiGroupMessage.id).limit(50).all()
        if rows:
            member.last_read = max(member.last_read, rows[-1].id)
            db.session.commit()
        users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_({row.sender_id for row in rows}))} if rows else {}
        gifs = gifs_by_id(row.gif_id for row in rows)
        return jsonify({"ok": True, "messages": [group_message_json(row, users, gifs, user) for row in rows]})

    @route("/api/yipi/groups/<int(min=1, max=2147483647):group_id>/leave", methods=["POST"], endpoint="yipi_group_leave")
    def yipi_group_leave(group_id):
        user, problem = need_user()
        if problem:
            return problem
        group, member = group_of(user, group_id)
        if group is None:
            return fail("not_found", 404)
        leave_group(group.id, user.id)
        db.session.commit()
        return jsonify({"ok": True})

    @route("/api/yipi/groups/<int(min=1, max=2147483647):group_id>", methods=["PATCH"], endpoint="yipi_group_rename")
    def yipi_group_rename(group_id):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        group, member = group_of(user, group_id)
        if group is None:
            return fail("not_found", 404)
        if group.owner_id != user.id:
            return fail("forbidden", 403)
        name = clean_text(data.get("name", ""), MAX_GROUP_NAME, keep_newlines=False)
        if not name:
            return fail("bad_group_name")
        group.name = name
        db.session.commit()
        return jsonify({"ok": True, "group": group_json(group, user)})

    @route("/api/yipi/groups/<int(min=1, max=2147483647):group_id>/members", methods=["POST"], endpoint="yipi_group_add")
    def yipi_group_add(group_id):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        group, member = group_of(user, group_id)
        if group is None:
            return fail("not_found", 404)
        if group.owner_id != user.id:
            return fail("forbidden", 403)
        others, problem = friends_from_handles(user, [data.get("handle")] if isinstance(data.get("handle"), str) else None)
        if problem:
            return problem
        present = {m.user_id for m in YipiGroupMember.query.filter_by(group_id=group.id)}
        fresh = [other for other in others if other.id not in present]
        if len(present) + len(fresh) > MAX_GROUP_MEMBERS:
            return fail("group_full", 409)
        for other in fresh:
            db.session.add(YipiGroupMember(group_id=group.id, user_id=other.id, last_read=db.session.query(func.coalesce(func.max(YipiGroupMessage.id), 0)).filter(YipiGroupMessage.group_id == group.id).scalar()))
        db.session.commit()
        return jsonify({"ok": True, "group": group_json(group, user)})

    @route("/api/yipi/messages/<handle>")
    def yipi_thread(handle):
        user, problem = need_user()
        if problem:
            return problem
        other = find_user(handle)
        if other is None or other.suspended:
            return fail("not_found", 404)
        if other.id in hidden_user_ids(user):
            return fail("blocked", 403)
        query = YipiMessage.query.filter(or_(and_(YipiMessage.sender_id == user.id, YipiMessage.recipient_id == other.id), and_(YipiMessage.sender_id == other.id, YipiMessage.recipient_id == user.id)))
        cursor = clamp_cursor(request.args.get("cursor"))
        if cursor:
            query = query.filter(YipiMessage.id < cursor)
        rows = query.order_by(YipiMessage.id.desc()).limit(PAGE * 2 + 1).all()
        more = len(rows) > PAGE * 2
        rows = rows[:PAGE * 2]
        YipiMessage.query.filter_by(sender_id=other.id, recipient_id=user.id, read=False).update({"read": True})
        db.session.commit()
        gifs = gifs_by_id(r.gif_id for r in rows)
        starred = favorite_ids(user, [r.gif_id for r in rows if r.gif_id])
        messages = [message_json(r, gifs, r.sender_id == user.id, starred) for r in reversed(rows)]
        return jsonify({"ok": True, "user": user_dict(other, user), "messages": messages, "next": rows[-1].id if more and rows else None, "canWrite": may_message(user, other)})

    @route("/api/yipi/messages/<handle>", methods=["POST"], endpoint="yipi_send")
    def yipi_send(handle):
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        other = find_user(handle)
        if other is None or other.suspended:
            return fail("not_found", 404)
        if other.id == user.id:
            return fail("self", 400)
        if other.id in hidden_user_ids(user):
            return fail("blocked", 403)
        text = clean_text(data.get("text", ""), MAX_DM)
        if text is None:
            return fail("too_long")
        gif_id = data.get("gifId")
        gifs = {}
        if gif_id is not None:
            gifs = gifs_by_id([gif_id])
            if not isinstance(gif_id, str) or gif_id not in gifs:
                return fail("gif_gone", 404)
        if not text and not gif_id:
            return fail("empty")
        if not may_message(user, other):
            return fail("dm_closed", 403)
        if limiter.too_many("dm", str(user.id)):
            return fail("too_many", 429)
        message = YipiMessage(sender_id=user.id, recipient_id=other.id, text=text, gif_id=gif_id)
        db.session.add(message)
        if gif_id:
            bump(PulseGif, gif_id, PulseGif.uses, 1)
        db.session.commit()
        return jsonify({"ok": True, "message": message_json(message, gifs, True, favorite_ids(user, [gif_id]))}), 201

    @route("/api/yipi/messages/<handle>/poll")
    def yipi_thread_poll(handle):
        user, problem = need_user()
        if problem:
            return problem
        other = find_user(handle)
        if other is None or other.suspended or other.id in hidden_user_ids(user):
            return fail("not_found", 404)
        after = clamp_cursor(request.args.get("after")) or 0
        rows = YipiMessage.query.filter(YipiMessage.sender_id == other.id, YipiMessage.recipient_id == user.id, YipiMessage.id > after).order_by(YipiMessage.id).limit(50).all()
        for row in rows:
            row.read = True
        db.session.commit()
        gifs = gifs_by_id(r.gif_id for r in rows)
        starred = favorite_ids(user, [r.gif_id for r in rows if r.gif_id])
        return jsonify({"ok": True, "messages": [message_json(r, gifs, False, starred) for r in rows]})

    # -------------------------------------------------------------------------------------------- GIFs
    def library_gif(gif_id, viewer=None):
        """The GIF with this id (without its bytes) unless it is gone or its maker is hidden from the viewer, else None."""
        gif = gifs_by_id([gif_id]).get(gif_id) if isinstance(gif_id, str) else None
        if gif is None:
            return None
        if gif.owner_id is not None:
            owner = db.session.get(YipiUser, gif.owner_id)
            if owner is None or owner.suspended or (viewer is not None and owner.id in hidden_user_ids(viewer)):
                return None
        return gif

    @route("/api/yipi/gifs")
    def pulse_gifs():
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("gif-list", str(user.id)):
            return fail("too_many", 429)
        ensure_starters()
        tab = request.args.get("tab", "trending")
        if tab not in ("trending", "new", "favorites", "mine"):
            return fail("bad_request")
        term = clean_text(request.args.get("q", ""), 40, keep_newlines=False) or ""
        offset = clamp_cursor(request.args.get("offset")) or 0
        offset = min(offset, 5000)
        query = PulseGif.query.options(defer(PulseGif.data))
        if tab == "favorites":
            query = query.join(PulseGifFav, and_(PulseGifFav.gif_id == PulseGif.id, PulseGifFav.user_id == user.id)).order_by(PulseGifFav.id.desc())
        elif tab == "mine":
            query = query.filter(PulseGif.owner_id == user.id).order_by(PulseGif.created_at.desc(), PulseGif.id)
        elif tab == "new":
            query = query.order_by(PulseGif.created_at.desc(), PulseGif.id)
        else:
            query = query.order_by((PulseGif.uses + 3 * PulseGif.favorites).desc(), PulseGif.created_at.desc(), PulseGif.id)
        hidden = hidden_user_ids(user) | suspended_ids()
        if hidden and tab != "mine":                              # a GIF of somebody who is blocked, muted or suspended is not shown (not even as a favourite)
            query = query.filter(or_(PulseGif.owner_id.is_(None), ~PulseGif.owner_id.in_(hidden)))
        if term:
            query = query.filter(PulseGif.title.ilike(like_pattern(term), escape="\\"))
        rows = query.offset(offset).limit(GIF_PAGE + 1).all()
        more = len(rows) > GIF_PAGE
        rows = rows[:GIF_PAGE]
        favorites = {row.gif_id for row in PulseGifFav.query.filter(PulseGifFav.user_id == user.id, PulseGifFav.gif_id.in_([g.id for g in rows]))} if rows else set()
        return jsonify({"ok": True, "items": [gif_json(g, user.id, favorites) for g in rows], "next": offset + GIF_PAGE if more else None})

    @route("/api/yipi/gifs", methods=["POST"], endpoint="pulse_gif_create")
    def pulse_gif_create():
        """A GIF made in the browser (or a GIF file) goes into the library, where everybody who is signed in can find it."""
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("gif-make", str(user.id)):
            return fail("too_many", 429)
        upload = request.files.get("file")
        if upload is None:
            return fail("no_file")
        data = upload.read(MAX_GIF_BYTES + 1)
        if looks_like_video(data, upload.filename, upload.mimetype):
            return fail("no_video", 415)
        if len(data) > MAX_GIF_BYTES:
            return fail("gif_too_big", 413)
        info = gif_info(data)
        if info is None:
            return fail("bad_gif", 415)
        title = clean_text(request.form.get("title", ""), MAX_GIF_TITLE, keep_newlines=False)
        if title is None:
            return fail("gif_title_long")
        gif = PulseGif(id=uuid.uuid4().hex, owner_id=user.id, title=title, data=data, size=len(data), width=info[0], height=info[1], frames=info[2])
        db.session.add(gif)
        db.session.commit()
        return jsonify({"ok": True, "gif": gif_json(gif, user.id)}), 201

    @route("/pulse-gif/<gif_id>")
    def pulse_gif_file(gif_id):
        gif = db.session.get(PulseGif, gif_id) if GIF_ID_RE.fullmatch(gif_id) else None
        if gif is None:
            abort(404)
        response = Response(gif.data, mimetype="image/gif")
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        response.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self'; sandbox"
        response.headers["Content-Disposition"] = "inline"
        response.set_etag(gif.id)
        return response.make_conditional(request)

    def set_favorite(gif_id, on):
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("gif-fav", str(user.id)):
            return fail("too_many", 429)
        gif = library_gif(gif_id, user)
        if gif is None:
            return fail("gif_gone", 404)
        existing = PulseGifFav.query.filter_by(user_id=user.id, gif_id=gif.id).first()
        try:
            if on and existing is None:
                db.session.add(PulseGifFav(user_id=user.id, gif_id=gif.id))
                bump(PulseGif, gif.id, PulseGif.favorites, 1)
                db.session.commit()
            elif not on and existing is not None:
                db.session.delete(existing)
                bump(PulseGif, gif.id, PulseGif.favorites, -1)
                db.session.commit()
        except IntegrityError:                                    # a second tap at the same moment: it is a favourite either way
            db.session.rollback()
        fresh = gifs_by_id([gif.id]).get(gif.id)
        return jsonify({"ok": True, "favorite": on, "favorites": fresh.favorites if fresh else 0})

    @route("/api/yipi/gifs/<gif_id>/favorite", methods=["POST"], endpoint="pulse_gif_favorite")
    def pulse_gif_favorite(gif_id):
        return set_favorite(gif_id, True)

    @route("/api/yipi/gifs/<gif_id>/favorite", methods=["DELETE"], endpoint="pulse_gif_unfavorite")
    def pulse_gif_unfavorite(gif_id):
        return set_favorite(gif_id, False)

    @route("/api/yipi/gifs/<gif_id>/use", methods=["POST"])
    def pulse_gif_use(gif_id):
        """Picks a GIF for a post: its bytes are copied into a fresh picture of the user, which the post then takes like any photo."""
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("gif-use", str(user.id)):
            return fail("too_many", 429)
        gif = library_gif(gif_id, user)
        if gif is None:
            return fail("gif_gone", 404)
        data = db.session.query(PulseGif.data).filter(PulseGif.id == gif.id).scalar()
        cleanup_orphans(user)
        item = YipiMedia(id=uuid.uuid4().hex, owner_id=user.id, content_type="image/gif", data=data, size=gif.size, width=gif.width, height=gif.height, alt=gif.title or "GIF", gif_id=gif.id)
        db.session.add(item)
        bump(PulseGif, gif.id, PulseGif.uses, 1)
        db.session.commit()
        return jsonify({"ok": True, "media": media_json(item)}), 201

    @route("/api/yipi/gifs/<gif_id>", methods=["DELETE"], endpoint="pulse_gif_delete")
    def pulse_gif_delete(gif_id):
        user, problem = need_user()
        if problem:
            return problem
        gif = gifs_by_id([gif_id]).get(gif_id) if isinstance(gif_id, str) else None
        if gif is None:
            return fail("gif_gone", 404)
        if gif.owner_id is None or (gif.owner_id != user.id and not is_admin(user)):
            return fail("forbidden", 403)
        remove_gif(gif.id)
        db.session.commit()
        return jsonify({"ok": True})

    def remove_gif(gif_id):
        """The GIF and its stars go; a message that carried it stays and shows "this GIF is gone" (its id is kept on purpose)."""
        PulseGifFav.query.filter_by(gif_id=gif_id).delete()
        PulseGif.query.filter_by(id=gif_id).delete()

    # ------------------------------------------------------------------------------------------------ Nex
    @route("/api/yipi/nex", methods=["POST"])
    def pulse_nex():
        """One answer of Nex, streamed as plain text.  The page sends the last turns of the conversation (it keeps them in the
        browser; nothing is stored here); `postId` hands over a post to explain."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("nex", str(user.id)) or limiter.too_many("nex-flood", "all"):
            return fail("too_many", 429)
        raw = data.get("messages") if isinstance(data.get("messages"), list) else []
        turns = []
        for item in raw[-NEX_TURNS:]:
            if isinstance(item, dict) and item.get("role") in ("user", "assistant") and isinstance(item.get("content"), str):
                content = clean_text(item["content"], 20000)
                if content:
                    turns.append((item["role"], content[:MAX_NEX_MESSAGE]))
        if not turns or turns[-1][0] != "user":
            return fail("bad_request")
        lines = []
        if data.get("postId") is not None:
            post = get_post_or_none(clamp_cursor(data["postId"]) or 0, user)
            if post is not None and not post.deleted and post.user_id not in hidden_user_ids(user):
                author = db.session.get(YipiUser, post.user_id)
                lines.append(f"Der Nutzer zeigt dir diesen Beitrag von @{author.handle if author else '?'}: „{post.text}“")
        for role, content in turns:
            lines.append(("Nutzer: " if role == "user" else "Nex: ") + content)
        transcript = "\n\n".join(lines)
        while len(transcript) > 7500 and len(lines) > 1:           # the model takes about 8000 characters: drop the oldest turns first
            lines.pop(1 if len(lines) > 2 and lines[0].startswith("Der Nutzer zeigt") else 0)
            transcript = "\n\n".join(lines)

        def generate():
            try:
                yield from ai_assistant.generate_custom_stream(NEX_PROMPT, transcript, max_tokens=NEX_MAX_TOKENS)
            except Exception:
                logger.exception("Nex konnte nicht antworten")

        return Response(stream_with_context(generate()), mimetype="text/plain")

    # ----------------------------------------------------------------------------- reports, moderation
    @route("/api/yipi/reports", methods=["POST"])
    def yipi_report():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("report", str(user.id)):
            return fail("too_many", 429)
        reason = data.get("reason")
        if reason not in REPORT_REASONS:
            return fail("bad_reason")
        note = clean_text(data.get("note", ""), 300) or ""
        post_id = user_id = gif_id = None
        if data.get("gifId") is not None:
            gif = library_gif(data["gifId"], user)
            if gif is None or gif.owner_id is None:
                return fail("not_found", 404)
            gif_id, user_id = gif.id, gif.owner_id
        elif data.get("postId") is not None:
            post = db.session.get(YipiPost, clamp_cursor(data["postId"]) or 0)
            if post is None:
                return fail("not_found", 404)
            post_id, user_id = post.id, post.user_id
        elif isinstance(data.get("handle"), str):
            target = find_user(data["handle"])
            if target is None:
                return fail("not_found", 404)
            user_id = target.id
        else:
            return fail("bad_request")
        db.session.add(YipiReport(reporter_id=user.id, post_id=post_id, gif_id=gif_id, user_id=user_id, reason=reason, note=note))
        db.session.commit()
        return jsonify({"ok": True}), 201

    def need_admin():
        user, problem = need_user()
        if problem:
            return None, problem
        if not is_admin(user):
            return None, fail("forbidden", 403)
        return user, None

    @route("/api/yipi/moderation/reports")
    def yipi_admin_reports():
        admin, problem = need_admin()
        if problem:
            return problem
        reports = YipiReport.query.filter_by(handled=False).order_by(YipiReport.id).limit(50).all()
        users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_({r.reporter_id for r in reports} | {r.user_id for r in reports if r.user_id}))}
        posts = {p.id: p for p in YipiPost.query.filter(YipiPost.id.in_({r.post_id for r in reports if r.post_id}))}
        gifs = gifs_by_id(r.gif_id for r in reports)
        items = []
        for r in reports:
            post = posts.get(r.post_id)
            target = users.get(r.user_id)
            items.append({"id": r.id, "reason": r.reason, "note": r.note, "createdAt": iso(r.created_at), "reporter": users[r.reporter_id].handle if r.reporter_id in users else None,
                          "handle": target.handle if target else None, "suspended": bool(target and target.suspended), "postId": r.post_id,
                          "text": post.text if post and not post.deleted else None, "postGone": bool(r.post_id and (post is None or post.deleted)),
                          "gifId": r.gif_id, "gif": gif_json(gifs[r.gif_id]) if r.gif_id in gifs else None, "gifGone": bool(r.gif_id and r.gif_id not in gifs)})
        return jsonify({"ok": True, "items": items})

    @route("/api/yipi/moderation/reports/<int(min=1, max=4611686018427387904):report_id>", methods=["POST"])
    def yipi_admin_act(report_id):
        admin, problem = need_admin()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        report = db.session.get(YipiReport, report_id)
        if report is None:
            return fail("not_found", 404)
        action = data.get("action")
        if action == "delete_post" and report.post_id:
            post = db.session.get(YipiPost, report.post_id)
            if post is not None:
                remove_post(post, by_admin=True)
        elif action == "delete_gif" and report.gif_id:
            remove_gif(report.gif_id)
        elif action == "suspend" and report.user_id:
            target = db.session.get(YipiUser, report.user_id)
            if target is not None and not is_admin(target):
                target.suspended = True
                target.session_gen += 1
        elif action == "restore" and report.user_id:
            target = db.session.get(YipiUser, report.user_id)
            if target is not None:
                target.suspended = False
        elif action != "dismiss":
            return fail("bad_action")
        for same in YipiReport.query.filter_by(handled=False, post_id=report.post_id, gif_id=report.gif_id, user_id=report.user_id).all():
            same.handled = True
        report.handled = True
        db.session.commit()
        return jsonify({"ok": True})

    # ---------------------------------------------------------------------------------- the pages
    @route("/", endpoint="pl_home")
    def yipi_home():
        return render_shell("/")

    @route(OLD_HOME, endpoint="yipi_old_home")
    def yipi_old_home():
        return redirect("/", code=301)                           # the earlier address of this app (it was an archive for a few days)

    def render_shell(path):
        user = current_user()
        title, description = page_meta(path)
        boot = {"me": me_dict(user) if user else None}
        private = path.startswith(PRIVATE_PATHS)                  # pages that only mean something to the person who is signed in
        return page_headers(make_response(render_template("yipi.html", boot=boot, title=title, description=description, base=base_url(), path=path, private=private)))

    for page in ("/explore", "/notifications", "/messages", "/bookmarks", "/settings", "/search", "/moderation", "/i/login", "/i/signup", "/i/nex", "/games", "/videos"):
        route(page, endpoint="yipi_shell_" + page.strip("/").replace("/", "_"))(lambda page=page: render_shell(page))

    @route("/g/<int(min=1, max=2147483647):group_id>")
    def yipi_page_group(group_id):
        return render_shell(f"/g/{group_id}")

    @route("/messages/<handle>")
    def yipi_page_thread(handle):
        return render_shell(f"/messages/{handle}")

    @route("/settings/<section>")
    def yipi_page_settings(section):
        return render_shell(f"/settings/{section}")

    # ---------------------------------------------------------------------- legal pages, files for browsers and crawlers
    def legal(page):
        return page_headers(make_response(render_template("legal.html", page=page, imprint=ysound.imprint())))

    @route("/nutzungsbedingungen")
    def yipi_terms():
        return legal("terms")

    @route("/datenschutz")
    def yipi_privacy():
        return legal("privacy")

    @route("/impressum")
    def yipi_imprint():
        return legal("imprint")

    @route("/manifest.webmanifest")
    def yipi_manifest():
        return Response(json.dumps(manifest(), ensure_ascii=False), mimetype="application/manifest+json")

    @route("/robots.txt")
    def yipi_robots():
        private = ("/api/", "/pulse-gif/") + PRIVATE_PATHS
        lines = ["User-agent: *", "Allow: /"] + [f"Disallow: {path}" for path in private + ARCHIVE_PATHS]
        lines += ["", f"Sitemap: {base_url()}/sitemap.xml", ""]
        return Response("\n".join(lines), mimetype="text/plain")

    @route("/sitemap.xml")
    def yipi_sitemap():
        root = base_url()
        urls = "".join(f"  <url><loc>{root}{path}</loc></url>\n" for path in ("/", "/datenschutz", "/impressum", "/nutzungsbedingungen"))
        return Response(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n', mimetype="application/xml")

    @app.errorhandler(404)
    def yipi_not_found(error):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "error": "not_found"}), 404
        return error_page(404, "Diese Seite gibt es nicht", "Vielleicht ist der Link falsch, oder die Seite wurde entfernt.")

    @route("/<handle>")
    def yipi_page_profile(handle):
        if not HANDLE_RE.fullmatch(handle) or find_user(handle) is None:
            abort(404)
        return render_shell(f"/{handle}")

    @route("/<handle>/status/<int(min=1, max=4611686018427387904):post_id>")
    def yipi_page_post(handle, post_id):
        post = db.session.get(YipiPost, post_id)
        user = find_user(handle)
        if user is None or post is None or post.user_id != user.id or post.repost_of_id:
            abort(404)
        return render_shell(f"/{user.handle}/status/{post_id}")

    @route("/<handle>/followers")
    def yipi_page_followers(handle):
        if find_user(handle) is None:
            abort(404)
        return render_shell(f"/{handle}/followers")

    @route("/<handle>/following")
    def yipi_page_following(handle):
        if find_user(handle) is None:
            abort(404)
        return render_shell(f"/{handle}/following")
