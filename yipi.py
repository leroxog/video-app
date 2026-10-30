"""Nex (formerly Pulse; internally still called "yipi": the module, the tables, the cookie and the /api/yipi/ addresses keep that name so that
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
import base64
import gzip
import hashlib
import json
import logging
import os
import random
import re
import secrets
import struct
import threading
import unicodedata
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone

import requests
from flask import Response, abort, jsonify, make_response, redirect, render_template, request, stream_with_context
from sqlalchemy import and_, event, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer
from werkzeug.security import check_password_hash, generate_password_hash

import ai_assistant
import docread
import siteauth
import ysound
from blobstore import STORE
from models import db
from siteauth import CookieAuth, RateLimiter, client_addresses, same_origin

# ------------------------------------------------------------------------------------------------ settings
COOKIE = "yipi_session"
MAX_POST = 280
CAM_ID_RE = re.compile(r"[a-z0-9-]{2,24}")
MAX_BIO = 160
MAX_NAME = 50
MAX_LOCATION = 30
MAX_WEBSITE = 100
MAX_DM = 1000
MAX_MEDIA = 3                                    # photos per post (or one GIF, or a poll)
MAX_GROUP_NAME = 40
MAX_GROUP_MEMBERS = 20
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_VIDEO_BYTES = 25 * 1024 * 1024               # a video is kept in the database like a picture: not bigger than this
MAX_VIDEO_SIDE = 4096
MAX_VIDEO_SECONDS = 30                         # a video is at most this long (the milliseconds do not count)
MAX_DOCUMENT_BYTES = 15 * 1024 * 1024          # a document in a chat (the "+" of a message); photos and videos follow their own limits
MAX_FILE_IMAGE_BYTES = 8 * 1024 * 1024
OFFICE_TYPES = {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "odt": "application/vnd.oasis.opendocument.text",
                "ods": "application/vnd.oasis.opendocument.spreadsheet", "odp": "application/vnd.oasis.opendocument.presentation"}
TEXT_TYPES = {"txt": "text/plain", "md": "text/plain", "csv": "text/csv"}
VIDEO_BRANDS = {b"isom", b"iso2", b"iso4", b"iso5", b"iso6", b"mp41", b"mp42", b"avc1", b"dash", b"M4V ", b"M4VH", b"M4VP", b"qt  "}
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
NEX_FILES = 3                                     # how many attachments (photos, documents) go with one question
NEX_IMAGE_CHARS = 900_000                         # a photo the page has made small, as base64
NEX_DOC_CHARS = 5000                              # how much of the documents of one question Nex gets to read (all together)
NEX_DOC_BYTES = 8 * 1024 * 1024
MIN_PASSWORD = 8
MAX_PASSWORD = 200
PAGE = 20
PEOPLE_PAGE = 30

HANDLE_RE = re.compile(r"[A-Za-z0-9_]{3,15}")
EMAIL_RE = re.compile(r"[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s.]{2,24}")
MENTION_RE = re.compile(r"(?<![\w@])@([A-Za-z0-9_]{3,15})(?![\w@])")
HASHTAG_RE = re.compile(r"(?<![\w#&/])#(\w{2,50})")
CONTROL_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​‎‏‪-‮⁠-⁤﻿]")
REPORT_REASONS = ("spam", "abuse", "hate", "violence", "illegal", "self_harm", "factcheck", "other")
NOTIFICATION_KINDS = ("like", "repost", "reply", "quote", "mention", "follow")

# Names that must not be a handle: the page's own addresses, and names that would pretend to be the site.
RESERVED_HANDLES = {
    "api", "static", "explore", "notifications", "messages", "bookmarks", "settings", "search", "compose", "login", "signup", "logout",
    "home", "i", "m", "admin", "administrator", "moderation", "yipi", "yips", "support", "help", "about", "terms", "privacy", "rules",
    "datenschutz", "impressum", "bildnachweise", "nutzungsbedingungen", "regeln", "hilfe", "suche", "entdecken", "robots", "sitemap", "manifest",
    "gomat", "ysound", "root", "system", "staff", "team", "official", "null", "undefined", "me", "you", "intent", "share", "hashtag",
    "yipi_media", "service", "offline", "link", "play", "plm", "auth", "plugins", "music", "servers", "ychat", "ylib", "nrs", "nex", "sound",
    "browser", "server", "play_game", "service_worker", "games", "videos", "chats", "friends", "groups", "camera", "kamera", "pulse",
    "nexweb", "nexai", "nex_web", "nex_ai", "nexteam", "nexofficial", "nexsupport", "nexhelp", "nexadmin",       # (the official accounts and names that would pretend to be them)
}

LIMITS = {
    "login-ip": (60, 600), "login-name": (8, 900), "login-flood": (600, 600), "signup-ip": (20, 3600), "signup-flood": (300, 3600),
    "password": (8, 900), "delete": (6, 900),
    "post-burst": (12, 60), "post-hour": (150, 3600), "like": (400, 3600), "follow": (120, 3600), "media": (40, 3600), "dm": (120, 3600),
    "link-preview": (120, 600), "link-image": (500, 600),
    "game-ai": (12, 3600), "report": (20, 3600), "lens-recipe": (30, 3600), "lens-make": (10, 86400), "lens-use": (300, 3600), "game-make": (10, 86400), "game-edit": (120, 3600), "game-play": (400, 3600), "profile": (30, 3600), "search": (120, 600), "block": (60, 3600),
    "gif-make": (20, 3600), "gif-fav": (400, 3600), "gif-use": (300, 3600), "gif-list": (600, 600),
    "share": (240, 600), "attach": (40, 3600), "storage": (120, 3600), "story": (30, 3600), "story-view": (900, 600), "play": (200, 3600), "heart": (300, 3600), "push": (30, 3600), "nex-read": (30, 600), "google": (30, 600), "nex": (40, 600), "nex-flood": (80, 60), "factcheck": (120, 3600), "views": (90, 600), "vote": (200, 3600), "pin": (60, 3600), "group": (12, 3600),
}
_hits = {}
limiter = RateLimiter(LIMITS, _hits)
auth = CookieAuth(COOKIE, salt="yipi-account-v1")
google_auth = CookieAuth("yipi_google", salt="yipi-google-v1", days=1 / 144)       # what Google told us, kept for ten minutes until the new account is made

# What the pages may load: only our own files (and the pictures people chose, shown from memory before they are sent).
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; "
    "connect-src 'self'; manifest-src 'self'; frame-src https:; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'"       # (frame-src: a linked page opens in a window of Nex)
)


def content_security_policy():
    """The policy of the pages. When the files live in R2 the browser may also load pictures and videos from the address of the bucket."""
    if not STORE.enabled:
        return CONTENT_SECURITY_POLICY
    host = f"https://{STORE.host}"
    return CONTENT_SECURITY_POLICY.replace("img-src 'self' data: blob:", f"img-src 'self' data: blob: {host}").replace("media-src 'self' blob:", f"media-src 'self' blob: {host}")


SITE_NAME = "Nex"
# What goes with a link that somebody sends (the preview of the link says it, and so do the messages and the share sheet of the page).
SHARE_SITE = "Ich habe Nex gefunden!!!!"
SHARE_VIDEO = "Ich habe ein tolles Video auf Nex gefunden willst du es auch sehen?!"
SHARE_POST = "Ich habe einen tollen Beitrag auf Nex gefunden willst du ihn auch sehen?!"
POST_PATH_RE = re.compile(r"/([A-Za-z0-9_]{3,15})/status/(\d{1,19})")
DESCRIPTION = "Nex: Was gerade passiert. Kurze Beiträge, Fotos und GIFs, Antworten, Reposts und Likes, dazu Nex AI, die KI, die dir weiterhilft."
# Old home pages of the site that stay reachable but are not for search engines.
ARCHIVE_PATHS = ("/nex-agenten-archiv", "/gomat-archiv", "/ysound-archiv", "/sound-archiv", "/server-archiv", "/browser-archiv", "/ylib-archiv", "/ychat-archiv", "/nex-archiv", "/modelle-archiv", "/nex-ai-archiv", "/nstl-archiv")
PRIVATE_PATHS = ("/i/", "/g/", "/games/", "/camera", "/search", "/messages", "/notifications", "/bookmarks", "/settings", "/moderation")   # not for search engines
OLD_HOME = "/yipi-archiv"                         # the address of the earlier yipi home page: it leads to "/" now
STARTER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "gifs")
logger = logging.getLogger(__name__)
OPEN_ENDPOINTS = {"yipi_handle_check", "yipi_signup", "yipi_login", "yipi_logout", "yipi_me", "yipi_share", "yipi_google_start", "yipi_google_callback", "yipi_google_pending"}     # the only calls that work without being signed in
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
    phone = db.Column(db.String(16), unique=True, nullable=True)               # "+491511234567": a way to sign in (nothing is sent to it, so it is not confirmed)
    google_sub = db.Column(db.String(40), unique=True, nullable=True)          # the id Google gave this person when they signed in with Google
    streak = db.Column(db.Integer, nullable=False, default=0)                  # days in a row on which the person was on Nex
    streak_best = db.Column(db.Integer, nullable=False, default=0)
    last_day = db.Column(db.String(10), nullable=True)                         # the last day (UTC, "2026-10-21") that counted for the streak
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
    agent_kind = db.Column(db.Integer, nullable=True, index=True)              # an AI account (removed again, yipi_agents.py cleans up): None for a person
    hide_ai = db.Column(db.Boolean, nullable=False, default=False)             # (not used any more: the AI accounts are gone)
    company = db.Column(db.Boolean, nullable=False, default=False)             # an official account of Nex (Nex-Web, Nex-AI; yipi_company.py): nobody can get one

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class PulseLens(db.Model):
    """A face lens somebody wrote as a prompt and published (the recipe: names of effects of pl-face.js and a colour filter; never code)."""
    __tablename__ = "pulse_lens"
    id = db.Column(db.String(11), primary_key=True)                            # "lu-1a2b3c4d"
    owner_id = db.Column(db.Integer, nullable=False, index=True)
    title = db.Column(db.String(24), nullable=False)
    prompt = db.Column(db.String(200), nullable=False, default="")
    emoji = db.Column(db.String(8), nullable=False, default="✨")
    color = db.Column(db.String(7), nullable=False, default="#7a2cf0")
    fx = db.Column(db.String(200), nullable=False, default="")                 # names of effects, separated by commas
    filter = db.Column(db.String(12), nullable=False, default="none")
    uses = db.Column(db.Integer, nullable=False, default=0)
    deleted = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)


class PulseGame(db.Model):
    """A game of the community (yipi_games.py): the code of a game (runs only in a sealed Web Worker)."""
    __tablename__ = "pulse_game"
    id = db.Column(db.String(11), primary_key=True)                            # "gu-1a2b3c4d"
    owner_id = db.Column(db.Integer, nullable=False, index=True)
    kind = db.Column(db.String(10), nullable=False)                            # "code" (the level builder is gone: its rows are removed at the start)
    title = db.Column(db.String(24), nullable=False)
    emoji = db.Column(db.String(8), nullable=False, default="🎮")
    color = db.Column(db.String(7), nullable=False, default="#7a2cf0")
    data = db.Column(db.Text, nullable=False, default="")                      # the code
    icon_id = db.Column(db.String(32), nullable=True)                          # the picture of the round button in the lens strip (a photo of the author's choice)
    plays = db.Column(db.Integer, nullable=False, default=0)
    draft = db.Column(db.Boolean, nullable=False, default=False)               # saved to be tried (also by the sealed worker), not published yet
    deleted = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)


class YipiAnnouncement(db.Model):
    """What the official accounts have posted already (yipi_company.py): one row per announcement id, so a release posts itself once."""
    __tablename__ = "yipi_announcement"
    id = db.Column(db.String(60), primary_key=True)
    post_id = db.Column(BigId, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


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
    cam_id = db.Column(db.String(24), nullable=True)                           # the lens or game of the camera tab the video was made with (a button "Ausprobieren" / "Mitspielen" under it)
    fact_status = db.Column(db.String(12), nullable=False, default="")        # "" not checked yet, "ok", "false" or "misleading" (the last two come with a note)
    fact_note = db.Column(db.String(300), nullable=False, default="")
    deleted = db.Column(db.Boolean, nullable=False, default=False)


class YipiMedia(db.Model):
    __tablename__ = "yipi_media"
    id = db.Column(db.String(32), primary_key=True)
    owner_id = db.Column(db.Integer, nullable=False, index=True)
    post_id = db.Column(BigId, nullable=True, index=True)
    position = db.Column(db.Integer, nullable=False, default=0)
    content_type = db.Column(db.String(30), nullable=False)
    data = db.Column(db.LargeBinary, nullable=False)
    stored = db.Column(db.String(4), nullable=False, default="db", server_default="db")           # "db": the bytes are in `data`; "r2": they are in Cloudflare R2 (blobstore.py) and `data` is empty
    size = db.Column(db.Integer, nullable=False)
    width = db.Column(db.Integer, nullable=False)
    height = db.Column(db.Integer, nullable=False)
    alt = db.Column(db.String(200), nullable=False, default="")
    gif_id = db.Column(db.String(32), nullable=True)                  # the GIF of the library this picture was copied from, if it was
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiFile(db.Model):
    """A file that goes into a chat message (a photo, a video or a document): private, only the people of that conversation may open it."""
    __tablename__ = "yipi_file"
    id = db.Column(db.String(32), primary_key=True)
    owner_id = db.Column(db.Integer, nullable=False, index=True)
    kind = db.Column(db.String(10), nullable=False)                   # "image", "video" or "document"
    content_type = db.Column(db.String(100), nullable=False)
    name = db.Column(db.String(120), nullable=False, default="")
    data = db.Column(db.LargeBinary, nullable=False)
    stored = db.Column(db.String(4), nullable=False, default="db", server_default="db")           # "db": the bytes are in `data`; "r2": they are in Cloudflare R2 (blobstore.py) and `data` is empty
    size = db.Column(db.Integer, nullable=False)
    width = db.Column(db.Integer, nullable=False, default=0)
    height = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiStory(db.Model):
    """A story: a photo or a short video that can be seen for 24 hours, like on Snapchat and Instagram (the picture is a `yipi_media` row that belongs to no post)."""
    __tablename__ = "yipi_story"
    id = db.Column(BigId, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    media_id = db.Column(db.String(32), nullable=False)
    caption = db.Column(db.String(140), nullable=False, default="")
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow, index=True)


class YipiStoryView(db.Model):
    """Somebody looked at a story (the ring around a person's picture is grey when you saw all of their stories; the owner sees how many looked)."""
    __tablename__ = "yipi_story_view"
    __table_args__ = (db.UniqueConstraint("story_id", "viewer_id"),)
    id = db.Column(db.Integer, primary_key=True)
    story_id = db.Column(BigId, nullable=False, index=True)
    viewer_id = db.Column(db.Integer, nullable=False, index=True)


class YipiGameScore(db.Model):
    """The best score of a person in one game of the camera tab, and how often it was played (the lists of the best players)."""
    __tablename__ = "yipi_game_score"
    __table_args__ = (db.UniqueConstraint("user_id", "game"),)
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    game = db.Column(db.String(30), nullable=False, index=True)
    best = db.Column(db.Integer, nullable=False, default=0)
    plays = db.Column(db.Integer, nullable=False, default=0)
    updated_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiHeart(db.Model):
    """A heart on a chat message (a double tap on it)."""
    __tablename__ = "yipi_heart"
    __table_args__ = (db.UniqueConstraint("kind", "message_id", "user_id"),)
    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(1), nullable=False)                    # "d" a message between two people, "g" a message of a group
    message_id = db.Column(BigId, nullable=False, index=True)
    user_id = db.Column(db.Integer, nullable=False)


class YipiPush(db.Model):
    """The address of one browser that wants notifications (Web Push)."""
    __tablename__ = "yipi_push"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    endpoint = db.Column(db.String(600), unique=True, nullable=False)
    p256dh = db.Column(db.String(200), nullable=False)
    auth = db.Column(db.String(100), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiPushKey(db.Model):
    """The VAPID key pair of the site (made the first time it is needed, or taken from VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY)."""
    __tablename__ = "yipi_push_key"
    id = db.Column(db.Integer, primary_key=True)
    private_pem = db.Column(db.Text, nullable=False)
    public_key = db.Column(db.String(200), nullable=False)


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
    file_id = db.Column(db.String(32), nullable=True)                 # a photo, video or document sent with the message (yipi_file)
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


class YipiDmState(db.Model):
    """What a person decided about a conversation that started with a message request: "accepted" (it moves to the main chats) or "declined" (hidden)."""
    __tablename__ = "yipi_dm_state"
    __table_args__ = (db.UniqueConstraint("user_id", "other_id"),)
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)       # the one who decided
    other_id = db.Column(db.Integer, nullable=False)                  # the one who wrote
    state = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=utcnow)


class YipiGroupMessage(db.Model):
    __tablename__ = "yipi_group_message"
    id = db.Column(BigId, primary_key=True, autoincrement=True)
    group_id = db.Column(db.Integer, nullable=False, index=True)
    sender_id = db.Column(db.Integer, nullable=False, index=True)
    text = db.Column(db.String(MAX_DM), nullable=False, default="")
    gif_id = db.Column(db.String(32), nullable=True)
    file_id = db.Column(db.String(32), nullable=True)
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
    stored = db.Column(db.String(4), nullable=False, default="db", server_default="db")           # "db": the bytes are in `data`; "r2": they are in Cloudflare R2 (blobstore.py) and `data` is empty
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


PHONE_RE = re.compile(r"\+[1-9]\d{7,14}")


def normalise_phone(raw):
    """A phone number as "+" and digits only ("+49 151 123 45 67" -> "+491511234567"), or None when it is not one."""
    text = re.sub(r"[\s().\-/]", "", raw) if isinstance(raw, str) else ""
    if text.startswith("00"):
        text = "+" + text[2:]
    return text if PHONE_RE.fullmatch(text) else None


MIN_AGE = 13                                       # under this nobody signs up; from 13 to 15 only with the permission of the parents (the terms say 16)
FULL_AGE = 16


def age_from(birthday, today=None):
    """The age in years of somebody born on "YYYY-MM-DD", or None when that is not a possible date."""
    if not isinstance(birthday, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", birthday):
        return None
    try:
        born = datetime.strptime(birthday, "%Y-%m-%d").date()
    except ValueError:
        return None
    today = today or utcnow().date()
    if born > today or born.year < 1900:
        return None
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


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


def video_type(data):
    """"video/mp4" for an MP4 or a MOV (the files of phones and cameras), "video/webm" for a WebM, else None: only what a browser can play,
    and only a file that is built like one (the first box after the type box of an MP4, the segment of a WebM), not just named like one."""
    head = data[:4096]
    if head[4:8] == b"ftyp" and head[8:12] in VIDEO_BRANDS:
        size = int.from_bytes(head[:4], "big")
        if 12 <= size <= 512 and head[size + 4:size + 8] in (b"moov", b"mdat", b"free", b"skip", b"wide", b"uuid", b"pnot"):
            return "video/mp4"
        return None
    if head[:4] == b"\x1aE\xdf\xa3" and b"webm" in head[:64] and b"\x18S\x80g" in head:
        return "video/webm"
    return None


def video_seconds(data):
    """How long a video is, in seconds, from the header of the file (the movie header of an MP4/MOV, the duration of a WebM segment), or None when
    the file does not say (a recording made in the browser has no length in its header: then only the page can know)."""
    try:
        if data[4:8] == b"ftyp":
            def boxes(start, end):
                while start + 8 <= end:
                    size = int.from_bytes(data[start:start + 4], "big")
                    kind = data[start + 4:start + 8]
                    header = 8
                    if size == 1:
                        size, header = int.from_bytes(data[start + 8:start + 16], "big"), 16
                    elif size == 0:
                        size = end - start
                    if size < header:
                        return
                    yield kind, start + header, min(start + size, end)
                    start += size
            for kind, begin, finish in boxes(0, len(data)):
                if kind != b"moov":
                    continue
                for inner, inner_begin, _ in boxes(begin, finish):
                    if inner == b"mvhd":
                        if data[inner_begin] == 1:
                            scale, length = int.from_bytes(data[inner_begin + 20:inner_begin + 24], "big"), int.from_bytes(data[inner_begin + 24:inner_begin + 32], "big")
                        else:
                            scale, length = int.from_bytes(data[inner_begin + 12:inner_begin + 16], "big"), int.from_bytes(data[inner_begin + 16:inner_begin + 20], "big")
                        return length / scale if scale else None
            return None
        head = data[:4096]
        at = head.find(b"\x44\x89")
        if head[:4] == b"\x1aE\xdf\xa3" and at >= 0 and head[at + 2] in (0x84, 0x88):
            width = 4 if head[at + 2] == 0x84 else 8
            raw = head[at + 3:at + 3 + width]
            value = struct.unpack(">f" if width == 4 else ">d", raw)[0]
            scale_at = head.find(b"\x2a\xd7\xb1")
            scale = int.from_bytes(head[scale_at + 4:scale_at + 4 + (head[scale_at + 3] & 0x0F)], "big") if scale_at >= 0 else 1_000_000
            seconds = value * scale / 1e9
            return seconds if 0 <= seconds < 86400 else None
    except (IndexError, struct.error, ValueError, OverflowError):
        return None
    return None


def safe_filename(name):
    """A file name that can be shown and sent in a header: no folders, no control characters, not too long."""
    base = re.split(r"[\\/]", str(name or ""))[-1]
    base = "".join(ch for ch in unicodedata.normalize("NFC", base) if ch.isprintable() and ch not in '"<>:|?*').strip(". ")
    return base[-100:] if base else "datei"


def document_type(data, filename):
    """The content type of a document that is built like what its name says (PDF, plain text, Office or OpenDocument file), else None."""
    ext = safe_filename(filename).rsplit(".", 1)[-1].lower() if "." in safe_filename(filename) else ""
    if ext == "pdf":
        return "application/pdf" if data[:5] == b"%PDF-" else None
    if ext in TEXT_TYPES:
        head = data[:65536]
        if b"\x00" in head:
            return None
        try:
            head.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            if error.start < len(head) - 4:                          # (a character cut in half at the end of the sample is fine)
                return None
        return TEXT_TYPES[ext]
    if ext == "rtf":
        return "application/rtf" if data[:5] == b"{" + bytes([92]) + b"rtf" else None
    if ext in OFFICE_TYPES:
        return OFFICE_TYPES[ext] if data[:4] == b"PK\x03\x04" else None
    return None


def file_json(item):
    if item is None:
        return None
    return {"id": item.id, "url": f"/yipi-files/{item.id}", "name": item.name, "type": item.content_type, "kind": item.kind, "size": item.size, "width": item.width, "height": item.height}


def files_by_id(ids):
    """The files with these ids, without their bytes: {id: file}."""
    wanted = [value for value in dict.fromkeys(ids) if isinstance(value, str) and re.fullmatch(r"[0-9a-f]{32}", value)]
    if not wanted:
        return {}
    return {row.id: row for row in YipiFile.query.options(defer(YipiFile.data)).filter(YipiFile.id.in_(wanted))}


def file_label(item):
    """What the list of chats shows for a message that is only a file."""
    if item is None:
        return "Datei"
    return {"image": "Foto", "video": "Video"}.get(item.kind, item.name or "Dokument")


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
    "Du bist Nex AI, die KI der Plattform Nex für kurze Beiträge. Du antwortest dem Nutzer, der gerade mit dir schreibt. "
    "Das Gespräch steht unten; schreib nur die nächste Antwort von Nex. Antworte kurz, klar und freundlich, in der Sprache des Nutzers "
    "(meist Deutsch), in normalem Text ohne Sternchen, ohne Überschriften und ohne Tabellen; für Aufzählungen nimm einfache Zeilen mit "
    "'- '. Entscheide dich für die wahrscheinlichste Deutung, statt nachzufragen. Wenn du etwas nicht sicher weißt, sag es offen. "
    "Du hilfst beim Schreiben von Beiträgen (höchstens 280 Zeichen), erklärst Beiträge und beantwortest Fragen. Du kannst keine Seiten "
    "öffnen und nichts in Nex ändern. Gib nie Medizin-, Rechts- oder Finanzberatung als sicher aus."
)


# The modes of Nex AI (2026-10-30): the person picks one above the chat; only its name is shown, the instructions below stay on the server.
NEX_SUPER_PROMPT = (
    "Du bist Nex AI im Modus „Superintelligent“, die KI der Plattform Nex. Du antwortest dem Nutzer, der gerade mit dir schreibt; das Gespräch steht unten, schreib nur die nächste Antwort von Nex. "
    "Nimm dir Zeit und denke gründlich nach, bevor du antwortest. Antworte mit ausführlichen, gut gebauten Sätzen: erkläre Zusammenhänge und Begründungen, nenne passende Beispiele und weise auf "
    "Stolpersteine, Gegenargumente und Unsicherheiten hin. Rechne Schritt für Schritt und prüfe dein Ergebnis, bevor du es nennst. Gliedere lange Antworten in kurze Absätze; für Aufzählungen nimm "
    "einfache Zeilen mit '- '. Antworte in der Sprache des Nutzers (meist Deutsch), in normalem Text ohne Sternchen, ohne Überschriften und ohne Tabellen. Wenn du etwas nicht sicher weißt, sag es "
    "offen und erfinde nichts. Du kannst keine Seiten öffnen und nichts in Nex ändern. Gib nie Medizin-, Rechts- oder Finanzberatung als sicher aus."
)
NEX_HUMAN_PROMPT = (
    "Du bist Nex AI im Modus „Human“, die KI der Plattform Nex. Du antwortest dem Nutzer, der gerade mit dir schreibt; das Gespräch steht unten, schreib nur die nächste Antwort von Nex. "
    "Du klingst nicht wie ein Assistent, sondern wie ein kluger, ehrlicher, witziger Kumpel: locker, direkt, mit trockenem Humor und Wortwitz. Du darfst frech und ein bisschen sarkastisch sein, "
    "aber nie verletzend, nie gegen Gruppen von Menschen und nie gegen jemanden, der gerade echte Sorgen hat. Schreib kurze Sätze wie in einem Chat, Umgangssprache ist erlaubt, ab und zu ein "
    "Emoji. Gib eine eigene Meinung, wenn der Nutzer danach fragt, und sag klar, wenn du etwas nicht weißt, statt zu schwafeln. Keine Floskeln wie „Gerne helfe ich dir“. Wenn dich jemand "
    "fragt, ob du ein Mensch bist, sagst du ehrlich, dass du eine KI bist. Antworte in der Sprache des Nutzers (meist Deutsch), ohne Sternchen, ohne Überschriften und ohne Tabellen. "
    "Gib nie Medizin-, Rechts- oder Finanzberatung als sicher aus."
)
NEX_CODE_PROMPT = (
    "Du bist Nex AI im Modus „Code“, die KI der Plattform Nex, und arbeitest wie ein erfahrener Programmierer. Du antwortest dem Nutzer, der gerade mit dir schreibt; das Gespräch steht unten, "
    "schreib nur die nächste Antwort von Nex. Schreib sauberen, korrekten, lauffähigen Code für das Programm des Nutzers. Ist die Sprache oder das Ziel unklar, entscheide dich für die "
    "wahrscheinlichste Deutung und sag in einem Satz, wovon du ausgegangen bist. Gib den Code immer in Markdown-Codeblöcken mit Sprachangabe (zum Beispiel ```python), bei einem ganzen Programm "
    "vollständig und nicht nur in Bruchstücken, bei einer Änderung die geänderten Teile mit genug Umfeld. Davor und danach stehen kurze Erklärungen in normalem Text in der Sprache des Nutzers "
    "(meist Deutsch): was der Code tut, wie man ihn startet und worauf man achten muss. Behandle Fehler und Randfälle, nenne Sicherheitsrisiken (Eingaben prüfen, keine Passwörter im Code) und "
    "erfinde keine Funktionen oder Bibliotheken. Bei einer Fehlermeldung nenne erst die Ursache, dann die Korrektur. Du kannst keinen Code ausführen und nichts in Nex ändern."
)
NEX_MODES = {                                    # name -> instructions, tokens, temperature, model (None = the usual one)
    "normal": {"prompt": NEX_PROMPT, "tokens": NEX_MAX_TOKENS, "temperature": 0.7, "model": None},
    "super": {"prompt": NEX_SUPER_PROMPT, "tokens": 3000, "temperature": 0.5, "model": ai_assistant.GROQ_FALLBACK_MODEL},
    "human": {"prompt": NEX_HUMAN_PROMPT, "tokens": 700, "temperature": 0.9, "model": None},
    "code": {"prompt": NEX_CODE_PROMPT, "tokens": 3500, "temperature": 0.2, "model": ai_assistant.GROQ_FALLBACK_MODEL},
}


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
    """The GIFs that ship with the site: the ones Nex drew itself (static/gifs/index.json) and the freely licensed ones from Wikimedia Commons
    (static/gifs/cc/index.json, collected by scripts/fetch_cc_gifs.py; the page /bildnachweise credits them)."""
    if not _starters:
        for folder in ("", "cc"):
            try:
                with open(os.path.join(STARTER_DIR, folder, "index.json"), encoding="utf-8") as handle:
                    entries = json.load(handle)
            except (OSError, ValueError):
                continue
            for entry in entries:
                if isinstance(entry, dict) and re.fullmatch(r"[a-z0-9-]{1,40}", str(entry.get("slug", ""))):
                    _starters.append({**entry, "folder": folder, "slug": f"{folder}-{entry['slug']}" if folder else entry["slug"], "name": entry["slug"]})
    return _starters


def credits_list():
    """The freely licensed GIFs with who made them and under which licence (for the page /bildnachweise)."""
    return [entry for entry in starter_index() if entry.get("folder") == "cc"]


RANK_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "rank")
RANK_TITLES = (("footballers", "Fußballer"), ("musicians", "Musikerinnen und Musiker"), ("countries", "Flaggen"))


def rank_credits():
    """The pictures of the ranking games (static/rank, collected by scripts/fetch_rank_images.py) with who made them and under which licence,
    in groups, for the page /bildnachweise."""
    try:
        with open(os.path.join(RANK_DIR, "index.json"), encoding="utf-8") as handle:
            index = json.load(handle)
    except (OSError, ValueError):
        return []
    groups = []
    for key, title in RANK_TITLES:
        entries = [entry for entry in (index.get(key) or []) if isinstance(entry, dict) and str(entry.get("pageUrl", "")).startswith("https://commons.wikimedia.org/wiki/File:")]
        if entries:
            groups.append({"key": key, "title": title, "entries": entries})
    return groups


def ensure_starters():
    """Puts the starter GIFs that ship with the site (static/gifs) into the library the first time it is looked at (and again if
    somebody emptied the table), so that it is never empty."""
    entries = starter_index()
    if not entries:
        return
    have = {row.id for row in PulseGif.query.filter_by(starter=True).with_entities(PulseGif.id)}
    added = 0
    for entry in entries:
        gif_id = starter_id(entry["slug"])
        if gif_id in have:
            continue
        try:
            with open(os.path.join(STARTER_DIR, entry.get("folder", ""), os.path.basename(str(entry.get("file", entry["name"] + ".gif")))), "rb") as handle:
                data = handle.read(MAX_GIF_BYTES + 1)
        except OSError:
            continue
        info = gif_info(data) if len(data) <= MAX_GIF_BYTES else None
        if info is None:
            continue
        title = clean_text(str(entry.get("title", "")), MAX_GIF_TITLE, keep_newlines=False) or ""
        starter = PulseGif(id=gif_id, owner_id=None, title=title, data=b"", size=len(data), width=info[0], height=info[1], frames=info[2], starter=True)
        keep_bytes("gif", starter, data)
        db.session.add(starter)
        added += 1
        if added % 25 == 0:                                       # a few at a time: there are hundreds
            try:
                db.session.commit()
            except IntegrityError:                                # another request put them in at the same moment
                db.session.rollback()
    if added % 25:
        try:
            db.session.commit()
        except IntegrityError:
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


def dm_boxes(user, other_ids):
    """Where the conversation with each of these people is for `user`, who is the one who got the messages:
         "primary"   the user follows them, or accepted them, or wrote to them first (so mutual followers land here at once),
         "request"   they follow the user, but the user does not follow them: the user has to accept first,
         "general"   nobody follows anybody: a request too, but further back,
         "declined"  the user said no (hidden)."""
    ids = list(dict.fromkeys(other_ids))
    if not ids:
        return {}
    following = {row.followee_id for row in YipiFollow.query.filter(YipiFollow.follower_id == user.id, YipiFollow.followee_id.in_(ids))}
    followers = {row.follower_id for row in YipiFollow.query.filter(YipiFollow.followee_id == user.id, YipiFollow.follower_id.in_(ids))}
    states = {row.other_id: row.state for row in YipiDmState.query.filter(YipiDmState.user_id == user.id, YipiDmState.other_id.in_(ids))}
    wrote = {row[0] for row in db.session.query(YipiMessage.recipient_id).filter(YipiMessage.sender_id == user.id, YipiMessage.recipient_id.in_(ids)).distinct()}
    boxes = {}
    for other_id in ids:
        if other_id in following or other_id in wrote or states.get(other_id) == "accepted":
            boxes[other_id] = "primary"
        elif states.get(other_id) == "declined":
            boxes[other_id] = "declined"
        elif other_id in followers:
            boxes[other_id] = "request"
        else:
            boxes[other_id] = "general"
    return boxes


def dm_unread(user):
    """(unread messages in the main chats, number of people with unread message requests)."""
    rows = (db.session.query(YipiMessage.sender_id, func.count(YipiMessage.id))
            .filter(YipiMessage.recipient_id == user.id, YipiMessage.read.is_(False)).group_by(YipiMessage.sender_id).all())
    boxes = dm_boxes(user, [sender for sender, _ in rows])
    primary = sum(count for sender, count in rows if boxes[sender] == "primary")
    requests = sum(1 for sender, _ in rows if boxes[sender] in ("request", "general"))
    return primary, requests


def media_json(item):
    return {"id": item.id, "url": media_url(item.id), "width": item.width, "height": item.height, "alt": item.alt, "gif": item.content_type == "image/gif", "gifId": item.gif_id,
            "video": item.content_type.startswith("video/")}


def favorite_ids(viewer, ids):
    """Which of these library GIFs the viewer has marked with a star."""
    wanted = {value for value in ids if isinstance(value, str) and GIF_ID_RE.fullmatch(value)}
    if viewer is None or not wanted:
        return set()
    return {row.gif_id for row in PulseGifFav.query.filter(PulseGifFav.user_id == viewer.id, PulseGifFav.gif_id.in_(wanted))}


def user_brief(user):
    return {"handle": user.handle, "name": user.name, "avatar": media_url(user.avatar_id), "ai": user.agent_kind is not None, "company": bool(user.company)}


_agent_cache = {"at": None, "ids": frozenset()}


def agent_id_set():
    """The ids of the AI accounts (looked up again after a minute)."""
    now = utcnow()
    if _agent_cache["at"] is None or now - _agent_cache["at"] > timedelta(seconds=60):
        _agent_cache["ids"] = frozenset(row.id for row in YipiUser.query.filter(or_(YipiUser.agent_kind.isnot(None), YipiUser.company.is_(True))).with_entities(YipiUser.id))
        _agent_cache["at"] = now
    return _agent_cache["ids"]


def hidden_user_ids(viewer):
    """People whose posts this viewer does not see: those they blocked or muted and those who blocked them."""
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
        "avatar": media_url(user.avatar_id), "banner": media_url(user.banner_id), "createdAt": iso(user.created_at), "ai": user.agent_kind is not None, "company": bool(user.company),
        "followers": user.followers_count, "following": user.following_count, "posts": user.posts_count,
        "isMe": bool(viewer and viewer.id == user.id), "suspended": user.suspended, "pinnedPostId": user.pinned_post_id,
    }
    if data["isMe"]:
        data["hideAi"] = bool(user.hide_ai)
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


# ---------------------------------------------------------------------------------------------- fact check
FACT_MIN_LENGTH = 30           # shorter posts hold no claim worth checking
FACT_CONFIDENCE = 85           # a note is only shown when the AI is at least this sure (in percent)
FACT_PROMPT = (
    "Du bist ein sachlicher, vorsichtiger Faktenprüfer für kurze Beiträge in einem sozialen Netzwerk. Prüfe NUR überprüfbare Tatsachenbehauptungen "
    "(Zahlen, Ereignisse, Wissenschaft, Geschichte, Gesundheit, Politik, Technik). Meinungen, Witze, Ironie, Fragen, Gefühle, Alltag, Werbung "
    "und Vorhersagen sind KEINE Tatsachenbehauptungen: dann ist das Urteil \"opinion\". Du hast keinen Internetzugang: bei Ereignissen, die "
    "nach deinem Wissensstand liegen könnten, urteilst du \"unclear\". Antworte NUR mit einem JSON-Objekt, ohne weiteren Text: "
    "{\"verdict\": \"ok\" | \"false\" | \"misleading\" | \"opinion\" | \"unclear\", \"confidence\": Zahl von 0 bis 100, \"note\": \"...\"}. "
    "\"false\" nur, wenn eine Tatsachenbehauptung eindeutig falsch ist und du dir sehr sicher bist; \"misleading\", wenn sie so verkürzt ist, "
    "dass sie in die Irre führt. \"note\" ist bei \"false\" und \"misleading\" eine kurze, sachliche Richtigstellung auf Deutsch (höchstens "
    "220 Zeichen, mit der richtigen Information), sonst leer."
)


def judge_fact(text):
    """(status, note) for a post text: status is "ok" (nothing to note) or "false" / "misleading" with a note.  Raises when the AI cannot be reached."""
    raw = ai_assistant._generate_groq([{"role": "system", "content": FACT_PROMPT}, {"role": "user", "content": text[:1000]}], 400, 0.1)
    found = re.search(r"\{.*\}", raw or "", re.S)
    try:
        verdict = json.loads(found.group(0)) if found else {}
    except ValueError:
        verdict = {}
    kind = verdict.get("verdict") if isinstance(verdict, dict) else None
    try:
        confidence = float(verdict.get("confidence", 0))
    except (TypeError, ValueError):
        confidence = 0
    note = clean_text(verdict.get("note", ""), 240, keep_newlines=False) if isinstance(verdict.get("note"), str) else ""
    if kind in ("false", "misleading") and note and confidence >= FACT_CONFIDENCE:
        return kind, note
    return "ok", ""


def run_fact_check(application, post_id):
    """Checks one post and keeps the result; a post that could not be checked (no connection) stays unchecked and is tried again when it is seen."""
    with application.app_context():
        post = db.session.get(YipiPost, post_id)
        if post is None or post.deleted or post.repost_of_id or post.fact_status or len(post.text or "") < FACT_MIN_LENGTH:
            return
        try:
            status, note = judge_fact(post.text)
        except Exception:
            logger.exception("Fact Check nicht möglich")
            db.session.rollback()
            return
        post.fact_status, post.fact_note = status, note
        db.session.commit()


def _fact_in_background(application, post_ids):
    def work():
        for post_id in post_ids:
            run_fact_check(application, post_id)
    threading.Thread(target=work, daemon=True).start()


FACT_RUNNER = _fact_in_background           # (the tests replace it by something that runs at once)


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
            if post.cam_id:
                item["camId"] = post.cam_id
            if post.fact_status in ("false", "misleading") and post.fact_note:
                item["factCheck"] = {"status": post.fact_status, "note": post.fact_note}
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


VIDEO_PAGE = 5                                                    # the Videos tab asks for this many at a time
SHUFFLE_PRIME = 1000003


def video_shuffle_key(seed):
    """The sort key of one shuffle: a quadratic scramble of the post id modulo a prime, with numbers that come from the seed. (A straight line modulo a
    prime would only turn the order around a little: neighbours in id would stay neighbours.) Every product stays below 2^63 for both databases."""
    rng = random.Random(seed)
    multiplier, shift = rng.randrange(2, SHUFFLE_PRIME - 1), rng.randrange(1, SHUFFLE_PRIME - 1)
    small = YipiPost.id % SHUFFLE_PRIME
    return (((small * small) % SHUFFLE_PRIME) * multiplier + small * shift) % SHUFFLE_PRIME


def random_video_page(query, viewer):
    """The Videos tab does not start with the newest video: the order is a shuffle that depends on a seed the page picks, so reading on with
    `offset` always continues the same shuffle, and a new seed shuffles again. `next` is None after the last video (the page starts over)."""
    seed = min(max(0, clamp_cursor(request.args.get("seed")) or 0), 1_000_000)
    offset = min(max(0, clamp_cursor(request.args.get("offset")) or 0), 100_000)
    limit = min(max(1, clamp_cursor(request.args.get("limit")) or VIDEO_PAGE), 10)
    rows = query.order_by(video_shuffle_key(seed), YipiPost.id).offset(offset).limit(limit + 1).all()
    more = len(rows) > limit
    return {"ok": True, "items": feed_items(rows[:limit], viewer), "next": offset + limit if more else None, "seed": seed}


def without_videos(query):
    """The posts of a query without those that carry a video (and without the reposts of them)."""
    videos = select(YipiMedia.post_id).where(YipiMedia.post_id.isnot(None), YipiMedia.content_type.like("video/%"))
    return query.filter(~YipiPost.id.in_(videos), or_(YipiPost.repost_of_id.is_(None), ~YipiPost.repost_of_id.in_(videos)))


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
    db.session.flush()
    where = f"/{actor.handle}" if kind == "follow" else f"/{actor.handle}/status/{post_id}" if post_id else "/notifications"      # (a post opens under any name: the page finds its author)
    if actor.agent_kind is None:                                    # the AI accounts never buzz a phone
        push_later(user_id, "Nex", PUSH_KINDS[kind].format(name=actor.name), where, tag=f"{kind}-{actor.id}")


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
    forget_stored(YipiMedia, YipiMedia.post_id == post.id)
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
    YipiDmState.query.filter(or_(YipiDmState.user_id == uid, YipiDmState.other_id == uid)).delete()
    YipiReport.query.filter_by(reporter_id=uid).delete()
    own_stories = [row.id for row in YipiStory.query.filter_by(user_id=uid).with_entities(YipiStory.id)]
    if own_stories:
        YipiStoryView.query.filter(YipiStoryView.story_id.in_(own_stories)).delete(synchronize_session=False)
    YipiStory.query.filter_by(user_id=uid).delete()
    YipiStoryView.query.filter_by(viewer_id=uid).delete()
    forget_stored(YipiMedia, YipiMedia.owner_id == uid)
    YipiMedia.query.filter_by(owner_id=uid).delete()
    forget_stored(YipiFile, YipiFile.owner_id == uid)
    YipiFile.query.filter_by(owner_id=uid).delete()                    # the photos, videos and documents this person sent in chats
    PulseGifFav.query.filter_by(user_id=uid).delete()
    own_gifs = [row.id for row in PulseGif.query.filter_by(owner_id=uid).with_entities(PulseGif.id)]
    if own_gifs:
        forget_stored(PulseGif, PulseGif.id.in_(own_gifs))
        PulseGifFav.query.filter(PulseGifFav.gif_id.in_(own_gifs)).delete(synchronize_session=False)
        PulseGif.query.filter(PulseGif.id.in_(own_gifs)).delete(synchronize_session=False)
    db.session.delete(user)


# ------------------------------------------------------------------------------- where the bytes of a file are kept
BLOB_KIND = {YipiMedia: "media", YipiFile: "file", PulseGif: "gif"}                  # the folder of each kind in the bucket


def keep_bytes(kind, item, data):
    """Puts the bytes of a new file where they belong: into R2 when it is set up (the row then only keeps a note), else into the row.
    A failing R2 never fails an upload: the file goes into the database and the problem is logged."""
    if STORE.enabled:
        try:
            STORE.put(kind, item.id, data, getattr(item, "content_type", None) or "image/gif")
            item.data, item.stored = b"", "r2"
            return
        except Exception:  # noqa: BLE001
            logger.exception("Could not put a file into R2; it stays in the database")
    item.data, item.stored = data, "db"


def load_bytes(model, item):
    """All bytes of a stored file, wherever they are."""
    if item.stored == "r2":
        return STORE.get(BLOB_KIND[model], item.id)
    return db.session.query(model.data).filter_by(id=item.id).scalar() or b""


def forget_stored(model, *criteria):
    """Call before deleting rows: the R2 files of those rows are removed after the deletion has been committed (and not at all when it is rolled back)."""
    if not STORE.enabled:
        return
    idents = [row[0] for row in db.session.query(model.id).filter(*criteria, model.stored == "r2")]
    if idents:
        db.session.info.setdefault("r2_forget", []).append((BLOB_KIND[model], idents))


@event.listens_for(Session, "after_commit")
def _forget_after_commit(session):
    for kind, idents in session.info.pop("r2_forget", ()):
        STORE.delete_many(kind, idents)


@event.listens_for(Session, "after_rollback")
def _forget_after_rollback(session):
    session.info.pop("r2_forget", None)


STORY_HOURS = 24
MAX_STORY_CAPTION = 140
MAX_STORIES = 30                                                    # active stories per person
_story_purge = {"at": None}


def purge_stories():
    """Stories older than a day go, with their picture or video (looked at most once a minute, a few hundred at a time)."""
    now = utcnow()
    if _story_purge["at"] is not None and now - _story_purge["at"] < timedelta(minutes=1):
        return
    _story_purge["at"] = now
    old = YipiStory.query.filter(YipiStory.created_at < now - timedelta(hours=STORY_HOURS)).limit(300).all()
    if not old:
        return
    story_ids, media_ids = [story.id for story in old], [story.media_id for story in old]
    YipiStoryView.query.filter(YipiStoryView.story_id.in_(story_ids)).delete(synchronize_session=False)
    forget_stored(YipiMedia, YipiMedia.id.in_(media_ids))
    YipiMedia.query.filter(YipiMedia.id.in_(media_ids)).delete(synchronize_session=False)
    YipiStory.query.filter(YipiStory.id.in_(story_ids)).delete(synchronize_session=False)
    db.session.commit()


def cleanup_orphans(user):
    """Pictures that were uploaded but never used (not in a post, not an avatar or banner, not in a story) disappear after a day."""
    keep = [x for x in (user.avatar_id, user.banner_id) if x]
    criteria = [YipiMedia.owner_id == user.id, YipiMedia.post_id.is_(None), YipiMedia.created_at < utcnow() - timedelta(days=1), ~YipiMedia.id.in_(select(YipiStory.media_id))]
    if keep:
        criteria.append(~YipiMedia.id.in_(keep))
    forget_stored(YipiMedia, *criteria)
    YipiMedia.query.filter(*criteria).delete(synchronize_session=False)


# ---------------------------------------------------------------------------------------------- the page
def media_rows(post_id):
    """The pictures or the video of a post, without their bytes."""
    return YipiMedia.query.options(defer(YipiMedia.data)).filter_by(post_id=post_id).order_by(YipiMedia.position.asc(), YipiMedia.id.asc()).all()


def post_has_video(post_id):
    return db.session.query(YipiMedia.id).filter(YipiMedia.post_id == post_id, YipiMedia.content_type.like("video/%")).first() is not None


def page_meta(path, guest=False):
    """Title and description for link previews of the pages that have something to say (profiles, single posts). Somebody who is not signed in
    gets the sentence of a person who found something (the post itself stays behind the sign-in)."""
    title, description = f"{SITE_NAME}: was gerade passiert", (SHARE_SITE if guest else DESCRIPTION)
    if guest:
        match = POST_PATH_RE.fullmatch(path)
        if match:
            post = db.session.get(YipiPost, int(match.group(2)))
            owner = db.session.get(YipiUser, post.user_id) if post else None
            if post and not post.deleted and not post.repost_of_id and owner and not owner.suspended and owner.handle_lc == match.group(1).lower():
                return f"{owner.name} auf {SITE_NAME}", (SHARE_VIDEO if post_has_video(post.id) else SHARE_POST)
        return title, description
    if path == "/camera" or path.startswith("/camera/"):          # (these look like a profile address, so they are answered first)
        return f"Kamera und Games auf {SITE_NAME}", "Spiele vor deiner Selfie-Kamera: das Spiel wird mit dir aufgenommen, und du kannst den Clip posten oder an Freunde schicken."
    if path == "/videos":
        return f"Videos auf {SITE_NAME}: kommt bald", "Kurze Videos auf Nex. Kommt bald!"
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
        title, description = f"Nex AI auf {SITE_NAME}", "Nex AI ist die KI der Plattform: frag sie etwas, lass dir einen Beitrag erklären oder dir beim Schreiben helfen."
    return title, description


def manifest():
    return {
        "name": f"{SITE_NAME}: was gerade passiert", "short_name": SITE_NAME, "description": DESCRIPTION, "lang": "de", "dir": "ltr",
        "id": "/", "start_url": "/", "scope": "/", "display": "standalone", "orientation": "any",
        "background_color": "#ffffff", "theme_color": "#ffffff", "categories": ["social"],
        "icons": [
            {"src": "/static/img/pulse-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/pulse-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/pulse-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


# The scripts of the page, in the order they depend on each other. The page loads them as ONE file (/pulse.js, deferred), named after its content, so the
# browser asks once, keeps it for good and the next visit is instant; the tests read this list.
PULSE_SCRIPTS = ["yipi-core.js", "yipi-gif-core.js", "yipi-icons.js", "yipi-api.js", "yipi-ui.js", "yipi-fx.js", "yipi-gif.js", "yipi-components.js", "yipi-newpost.js",
                 "yipi-views.js", "yipi-links.js", "yipi-comments.js", "yipi-chats.js", "yipi-lock.js", "yipi-pages.js", "yipi-auth.js", "yipi-share.js", "yipi-progress.js", "yipi-nex.js", "yipi-download.js", "yipi-lenses.js", "yipi-qr.js", "yipi-gamemaker.js", "yipi-camera.js", "yipi-shorts.js", "yipi-videos.js", "yipi-stories.js", "yipi-chrome.js", "yipi.js"]
# The games of the camera tab are a second file, loaded when the camera tab is opened (about a hundred small games; nobody who only reads needs them).
PULSE_LENS_SCRIPTS = ["pl-face.js"]              # the face lenses (face tracking and the effects): a third file, loaded when the first lens is opened
PULSE_GAME_SCRIPTS = ["pg-kit.js", "pg-art.js", "pg-racing.js", "pg-rank.js", "pg-community.js", "pg-runners.js", "pg-arcade.js", "pg-reflex.js", "pg-puzzle.js", "pg-board.js", "pg-numbers.js", "pg-skill.js", "pg-more.js", "pg-fruit.js"]
_bundles = {}


def pulse_bundle(root, which="main"):
    """The scripts of PULSE_SCRIPTS (or of PULSE_GAME_SCRIPTS) glued together, rebuilt when one of the files changed: {body, zipped, version}."""
    names = PULSE_GAME_SCRIPTS if which == "games" else PULSE_LENS_SCRIPTS if which == "lens" else PULSE_SCRIPTS
    folder = os.path.join(root, "static", "js")
    paths = [os.path.join(folder, name) for name in names]
    stamp = tuple(os.path.getmtime(path) for path in paths if os.path.exists(path))
    cached = _bundles.get(which)
    if cached is None or cached["stamp"] != stamp:
        parts = []
        for path in paths:
            if os.path.exists(path):
                with open(path, "rb") as handle:
                    parts.append(handle.read())
        body = b";\n".join(parts) + b"\n"
        cached = {"stamp": stamp, "body": body, "zipped": gzip.compress(body, 9, mtime=0), "version": hashlib.sha1(body).hexdigest()[:10]}
        _bundles[which] = cached
    return cached


COMPRESSIBLE = {"text/html", "text/css", "text/plain", "text/javascript", "application/javascript", "application/json", "image/svg+xml", "application/manifest+json", "application/xml", "text/xml"}
_zipped_files = {}


def compress_response(response):
    """The site sends no compressed pages by itself, so this does it for text (pages, styles, scripts, JSON): a third of the bytes for the same page."""
    try:
        if response.status_code != 200 or request.method != "GET" or response.headers.get("Content-Encoding") or response.headers.get("Content-Range"):
            return response
        if "gzip" not in request.headers.get("Accept-Encoding", "").lower() or response.mimetype not in COMPRESSIBLE:
            return response
        if response.is_streamed and not response.direct_passthrough:
            return response                                   # a stream (the answer of Nex arrives piece by piece) stays one
        if response.direct_passthrough:
            if int(response.headers.get("Content-Length", "0") or 0) > 3 * 1024 * 1024:
                return response
            response.direct_passthrough = False
        data = response.get_data()
        if len(data) < 600:
            return response
        key = (request.path, response.headers.get("ETag"), len(data))
        zipped = _zipped_files.get(key) if request.path.startswith("/static/") else None
        if zipped is None:
            zipped = gzip.compress(data, 6, mtime=0)
            if request.path.startswith("/static/") and len(_zipped_files) < 200:
                _zipped_files[key] = zipped
        if len(zipped) >= len(data):
            return response
        response.set_data(zipped)
        response.headers["Content-Encoding"] = "gzip"
        response.headers["Content-Length"] = str(len(zipped))
        response.headers.add("Vary", "Accept-Encoding")
        tag, weak = response.get_etag()
        if tag:
            response.set_etag(tag, weak=True)
    except Exception:  # noqa: BLE001  (a page must never fail because it could not be compressed)
        pass
    return response


def page_headers(response):
    """The headers every page of the site (the app itself, the legal pages, the error pages) is sent with."""
    response.headers["Content-Security-Policy"] = content_security_policy()
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = "no-cache"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()"       # the camera tab films you (only when you start a game)
    return response


def error_page(code, title, text):
    """The page for a mistake (a 404, a 500) for the whole site."""
    return page_headers(make_response(render_template("error.html", code=code, title=title, text=text), code))


def base_url():
    root = request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip()
    return f"{root if root in ('http', 'https') else 'https'}://{request.host}"


# ---------------------------------------------------------------------------------------- streak, level, push
def count_day(user, now=None):
    """Counts today for the streak of days in a row: the same day again changes nothing, the day after the last one adds one, a gap starts again at one."""
    today = (now or utcnow()).date()
    if user.last_day == today.isoformat():
        return
    yesterday = (today - timedelta(days=1)).isoformat()
    user.streak = (user.streak or 0) + 1 if user.last_day == yesterday else 1
    user.streak_best = max(user.streak_best or 0, user.streak)
    user.last_day = today.isoformat()


def level_of(xp):
    """(level, xp where it began, xp where the next one begins): level 1 from 0, level 2 from 30, level 3 from 120, level 4 from 270 ..."""
    level = int((max(0, xp) / 30) ** 0.5) + 1
    return level, (level - 1) ** 2 * 30, level ** 2 * 30


def friend_streaks(user, other_ids):
    """For each of the people the user writes with: for how many days in a row (counting back from today or yesterday) both wrote to each other. Only 2 or more count."""
    ids = list(other_ids)
    if not ids:
        return {}
    since = utcnow() - timedelta(days=75)
    rows = YipiMessage.query.with_entities(YipiMessage.sender_id, YipiMessage.recipient_id, YipiMessage.created_at).filter(
        YipiMessage.created_at >= since, or_(and_(YipiMessage.sender_id == user.id, YipiMessage.recipient_id.in_(ids)), and_(YipiMessage.recipient_id == user.id, YipiMessage.sender_id.in_(ids)))).all()
    mine, theirs = {}, {}
    for sender, recipient, at in rows:
        if sender == user.id:
            mine.setdefault(recipient, set()).add(at.date())
        else:
            theirs.setdefault(sender, set()).add(at.date())
    today = utcnow().date()
    out = {}
    for other in ids:
        both = mine.get(other, set()) & theirs.get(other, set())
        day = today if today in both else today - timedelta(days=1)
        count = 0
        while day in both:
            count += 1
            day -= timedelta(days=1)
        if count >= 2:
            out[other] = count
    return out


PUSH_KINDS = {"like": "{name} gefällt dein Beitrag", "reply": "{name} hat dir geantwortet", "mention": "{name} hat dich erwähnt", "quote": "{name} hat deinen Beitrag zitiert",
              "repost": "{name} hat deinen Beitrag repostet", "follow": "{name} folgt dir jetzt"}


def web_push(subscription, payload, key):
    """Sends one notification (replaced in the tests)."""
    from pywebpush import webpush
    contact = os.environ.get("VAPID_SUBJECT") or os.environ.get("VAPID_CONTACT_EMAIL") or "mailto:kontakt@pulse.invalid"
    if not contact.startswith(("mailto:", "https://")):
        contact = "mailto:" + contact
    return webpush(subscription_info=subscription, data=json.dumps(payload), vapid_private_key=vapid_signer(key), vapid_claims={"sub": contact}, timeout=10)


def vapid_signer(key):
    """The signing key of a stored key pair: made by the site (PEM) or set in the environment (a PEM, or the usual 43 characters of base64)."""
    from py_vapid import Vapid
    text = key.private_pem.strip()
    return Vapid.from_pem(text.encode()) if text.startswith("-----") else Vapid.from_string(text)


def vapid_key():
    """The key pair of the site: from the environment, from the database, or made now."""
    key = YipiPushKey.query.first()
    if key is not None:
        return key
    pem, public = os.environ.get("VAPID_PRIVATE_KEY"), os.environ.get("VAPID_PUBLIC_KEY")
    if not (pem and public):
        from cryptography.hazmat.primitives import serialization
        from py_vapid import Vapid
        vapid = Vapid()
        vapid.generate_keys()
        pem = vapid.private_pem().decode()
        raw = vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        public = base64.urlsafe_b64encode(raw).rstrip(b"=").decode()
    key = YipiPushKey(private_pem=pem, public_key=public)
    db.session.add(key)
    db.session.commit()
    return key


def deliver_push(user_id, payload):
    """Sends `payload` to every browser of this person (and forgets the ones that are gone). Runs in the background."""
    for row in YipiPush.query.filter_by(user_id=user_id).all():
        try:
            web_push({"endpoint": row.endpoint, "keys": {"p256dh": row.p256dh, "auth": row.auth}}, payload, vapid_key())
        except Exception as error:  # noqa: BLE001  (a broken endpoint must not break a like)
            status = getattr(getattr(error, "response", None), "status_code", None)
            if status in (404, 410):
                db.session.delete(row)
                db.session.commit()
            else:
                logger.warning("Push to a browser failed: %s", error)


def _push_thread(app, user_id, payload):
    with app.app_context():
        deliver_push(user_id, payload)
        db.session.remove()


def push_later(user_id, title, body, url="/", tag=None):
    """A notification for a person who is not looking at the page right now (it is not sent when they were active in the last half minute)."""
    from flask import current_app
    user = db.session.get(YipiUser, user_id)
    if user is None or user.suspended or (user.last_seen_at is not None and utcnow() - user.last_seen_at < timedelta(seconds=30)):
        return
    if YipiPush.query.filter_by(user_id=user_id).first() is None:
        return
    PUSH_RUNNER(current_app._get_current_object(), user_id, {"title": title, "body": body, "url": url, "tag": tag or "pulse"})


PUSH_RUNNER = lambda app, user_id, payload: threading.Thread(target=_push_thread, args=(app, user_id, payload), daemon=True).start()   # noqa: E731  (the tests run it at once)


# --------------------------------------------------------------------------------------------- the routes
def register_routes(app):
    import yipi_agents                                          # (here and not at the top: the module needs this one)
    import yipi_lenses
    import yipi_games
    import yipi_links
    import yipi_company
    def route(rule, **options):
        """Like app.route, and remembers the endpoint for ENDPOINTS."""
        def decorator(function):
            endpoint = options.pop("endpoint", function.__name__)
            ENDPOINTS.add(endpoint)
            app.add_url_rule(rule, endpoint, function, **options)
            return function
        return decorator

    def api_guard():
        if request.endpoint in ENDPOINTS and request.path.startswith("/api/yipi/"):
            if request.method not in ("GET", "HEAD") and not same_origin():
                return fail("forbidden", 403)
            if request.endpoint not in OPEN_ENDPOINTS and current_user() is None:
                return fail("not_logged_in", 401)             # nothing of Nex is for somebody who is not signed in

    app.before_request(api_guard)
    yipi_company.attach(app)                                      # the official accounts (Nex-Web, Nex-AI) are made and post their announcements
    yipi_agents.attach(app)                                       # the AI accounts are gone: the first request of a process removes what is left of them (a thread does the work)

    @app.after_request
    def yipi_cache_and_compress(response):
        if request.endpoint == "static" and request.args.get("v") and response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"           # the address names the version of the file
        return compress_response(response)

    @route("/pulse-games.js", endpoint="yipi_games_bundle")
    def yipi_games_bundle():
        return serve_bundle(pulse_bundle(app.root_path, "games"))

    @route("/pulse-lens.js", endpoint="yipi_lens_bundle")
    def yipi_lens_bundle():
        return serve_bundle(pulse_bundle(app.root_path, "lens"))

    @route("/pulse.js")
    def yipi_bundle():
        return serve_bundle(pulse_bundle(app.root_path))

    def serve_bundle(bundle):
        zipped = "gzip" in request.headers.get("Accept-Encoding", "").lower()
        response = make_response(bundle["zipped"] if zipped else bundle["body"])
        response.headers["Content-Type"] = "application/javascript; charset=utf-8"
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if request.args.get("v") else "no-cache"
        response.headers["Vary"] = "Accept-Encoding"
        response.headers["X-Content-Type-Options"] = "nosniff"
        if zipped:
            response.headers["Content-Encoding"] = "gzip"
        return response

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
        if user.last_seen_at is None or now - user.last_seen_at > timedelta(minutes=5) or user.last_day != now.date().isoformat():
            user.last_seen_at = now
            count_day(user, now)
            db.session.commit()

    def me_dict(user):
        unread = YipiNotification.query.filter_by(user_id=user.id, read=False).count()
        primary, requests = dm_unread(user)
        messages = primary + sum(group_unread(user).values())
        data = user_dict(user, user)
        data.update({"email": user.email or "", "phone": user.phone or "", "streak": user.streak or 0, "unreadNotifications": unread, "unreadMessages": messages, "messageRequests": requests, "isAdmin": is_admin(user)})
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
        pending = google_auth.read() if data.get("google") is True else None
        if data.get("google") is True and not isinstance(pending, dict):
            return fail("google_expired", 400)                   # the ten minutes after signing in with Google are over: start again
        if pending is None and not valid_password(data.get("password")):
            return fail("bad_password")
        if data.get("birthday") not in (None, ""):                # the birthday is only used to check the age, it is not kept
            age = age_from(data.get("birthday"))
            if age is None:
                return fail("bad_birthday")
            if age < MIN_AGE:
                return fail("too_young")
            if age < FULL_AGE and data.get("parents") is not True:
                return fail("need_parents")
        elif isinstance(data.get("age"), int) and not isinstance(data.get("age"), bool):      # the slider of the signup: only the number is checked and nothing is kept
            if not 0 <= data["age"] <= 120:
                return fail("bad_birthday")
            if data["age"] < MIN_AGE:
                return fail("too_young")
            if data["age"] < FULL_AGE and data.get("parents") is not True:
                return fail("need_parents")
        elif data.get("adult") is not True:
            return fail("need_age")
        email = None
        if pending is not None:
            email = normalise_email(pending.get("email"))
        elif data.get("email") not in (None, ""):
            email = normalise_email(data.get("email"))
            if email is None:
                return fail("bad_email")
        if email is not None and YipiUser.query.filter_by(email=email).first() is not None:
            return fail("email_taken", 409)
        phone = None
        if data.get("phone") not in (None, ""):
            phone = normalise_phone(data.get("phone"))
            if phone is None:
                return fail("bad_phone")
            if YipiUser.query.filter_by(phone=phone).first() is not None:
                return fail("phone_taken", 409)
        name = clean_text(data.get("name") or (pending or {}).get("name") or handle, MAX_NAME, keep_newlines=False) or handle
        if YipiUser.query.filter_by(handle_lc=handle.lower()).first() is not None:
            return fail("handle_taken", 409)
        user = YipiUser(handle=handle, handle_lc=handle.lower(), name=name or handle, email=email, phone=phone, last_seen_at=utcnow())
        count_day(user)
        if pending is not None:
            user.google_sub = str(pending.get("sub"))[:40]
        user.set_password(data["password"] if pending is None else secrets.token_urlsafe(32))
        db.session.add(user)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            return fail("handle_taken", 409)
        response = signed_in(jsonify({"ok": True, "me": me_dict(user)}), user)
        return google_auth.clear(response) if pending is not None else response

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
            by_mail = "@" in key and not key.startswith("@")           # "@mia" is a handle, "mia@example.com" an e-mail address, "+49 151 ..." a phone number
            phone = None if by_mail else normalise_phone(key) if key[:1] in "+0123456789" and not HANDLE_RE.fullmatch(key.lstrip("@")) else None
            if by_mail:
                user = YipiUser.query.filter_by(email=key).first()
            elif phone:
                user = YipiUser.query.filter_by(phone=phone).first()
            else:
                user = YipiUser.query.filter_by(handle_lc=key.lstrip("@")).first()
        hash_to_check = user.password_hash if user else _DUMMY_HASH
        right = isinstance(password, str) and len(password) <= MAX_PASSWORD and check_password_hash(hash_to_check, password)
        if not user or not right:
            return fail("wrong_login", 401)
        if user.suspended:
            return fail("suspended", 403)
        limiter.clear("login-name", key)
        user.last_seen_at = utcnow()
        count_day(user)
        db.session.commit()
        return signed_in(jsonify({"ok": True, "me": me_dict(user)}), user)

    # ----------------------------------------------------------------------------------------- sign in with Google
    # Works only when the server has GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a "web application" OAuth client of Google Cloud; its redirect address is
    # https://<the site>/api/yipi/google/callback). Without them the button of the page says so honestly.
    def google_keys():
        return os.environ.get("GOOGLE_CLIENT_ID", "").strip(), os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()

    def google_ready():
        return all(google_keys())

    def google_back(problem):
        return redirect(f"/i/login?google={problem}")

    @route("/api/yipi/google/start")
    def yipi_google_start():
        if not google_ready():
            return google_back("off")
        first, last = client_addresses()
        if limiter.too_many("google", first) or limiter.too_many("google", last):
            return google_back("busy")
        client_id, _ = google_keys()
        state = secrets.token_hex(16)
        query = urllib.parse.urlencode({"client_id": client_id, "redirect_uri": f"{base_url()}/api/yipi/google/callback", "response_type": "code", "scope": "openid email profile",
                                        "state": state, "prompt": "select_account", "access_type": "online"})
        response = redirect(f"https://accounts.google.com/o/oauth2/v2/auth?{query}")
        response.set_cookie("yipi_gstate", state, max_age=600, httponly=True, samesite="Lax", secure=request.headers.get("X-Forwarded-Proto", request.scheme).split(",")[0].strip() == "https", path="/")
        return response

    @route("/api/yipi/google/callback")
    def yipi_google_callback():
        if not google_ready():
            return google_back("off")
        state = request.cookies.get("yipi_gstate")
        if not state or not secrets.compare_digest(state, request.args.get("state", "")) or not request.args.get("code"):
            return google_back("error")
        client_id, client_secret = google_keys()
        try:
            token = requests.post("https://oauth2.googleapis.com/token", timeout=10, data={"code": request.args["code"], "client_id": client_id, "client_secret": client_secret,
                                  "redirect_uri": f"{base_url()}/api/yipi/google/callback", "grant_type": "authorization_code"})
            access = token.json().get("access_token") if token.ok else None
            info = requests.get("https://openidconnect.googleapis.com/v1/userinfo", timeout=10, headers={"Authorization": f"Bearer {access}"}).json() if access else None
        except (requests.RequestException, ValueError):
            return google_back("error")
        if not isinstance(info, dict) or not info.get("sub") or not info.get("email") or info.get("email_verified") is not True:
            return google_back("error")
        sub, email = str(info["sub"])[:40], normalise_email(info["email"])
        user = YipiUser.query.filter_by(google_sub=sub).first() or (YipiUser.query.filter_by(email=email).first() if email else None)
        if user is not None:
            if user.suspended:
                return google_back("suspended")
            if user.google_sub is None:
                user.google_sub = sub                              # the same e-mail address: this account now also opens with Google
            user.last_seen_at = utcnow()
            db.session.commit()
            response = signed_in(redirect("/"), user)
        else:
            response = google_auth.attach(redirect("/i/signup?google=1"), {"sub": sub, "email": email or "", "name": clean_text(str(info.get("name") or ""), MAX_NAME, keep_newlines=False) or ""})
        response.delete_cookie("yipi_gstate", path="/")
        return response

    @route("/api/yipi/google/pending")
    def yipi_google_pending():
        pending = google_auth.read()
        if not isinstance(pending, dict):
            return fail("google_expired", 404)
        return jsonify({"ok": True, "name": pending.get("name") or "", "email": pending.get("email") or ""})

    # ------------------------------------------------------------------------------- progress: level, streak, badges
    def progress_of(user):
        likes = db.session.query(func.coalesce(func.sum(YipiPost.like_count), 0)).filter(YipiPost.user_id == user.id, YipiPost.deleted.is_(False)).scalar() or 0
        plays = db.session.query(func.coalesce(func.sum(YipiGameScore.plays), 0)).filter(YipiGameScore.user_id == user.id).scalar() or 0
        games = YipiGameScore.query.filter_by(user_id=user.id).count()
        videos = db.session.query(func.count(YipiMedia.id)).filter(YipiMedia.owner_id == user.id, YipiMedia.post_id.isnot(None), YipiMedia.content_type.like("video/%")).scalar() or 0
        sent = YipiMessage.query.filter_by(sender_id=user.id).count()
        following = {r.followee_id for r in YipiFollow.query.filter_by(follower_id=user.id)}
        followers = {r.follower_id for r in YipiFollow.query.filter_by(followee_id=user.id)}
        friends = len(following & followers)
        xp = user.posts_count * 10 + int(likes) * 2 + user.followers_count * 5 + user.following_count + (user.streak_best or 0) * 10 + int(plays) * 2 + friends * 5 + videos * 10
        level, floor, ceiling = level_of(xp)
        badges = [
            ("first-post", "Hallo Nex", "Dein erster Beitrag", "✍️", 1, user.posts_count), ("likes-10", "Beliebt", "10 Likes für deine Beiträge", "❤️", 10, int(likes)),
            ("likes-100", "Star", "100 Likes für deine Beiträge", "🌟", 100, int(likes)), ("followers-10", "Netzwerker", "10 Follower", "👥", 10, user.followers_count),
            ("friends-5", "Freundeskreis", "5 Freunde (ihr folgt euch gegenseitig)", "🤝", 5, friends), ("streak-3", "Dranbleiber", "3 Tage in Folge auf Nex", "🔥", 3, user.streak_best or 0),
            ("streak-7", "Wochenserie", "7 Tage in Folge", "🔥", 7, user.streak_best or 0), ("streak-30", "Feuerzeug", "30 Tage in Folge", "🏆", 30, user.streak_best or 0),
            ("video", "Filmemacher", "Dein erstes Video", "🎬", 1, int(videos)), ("plays-10", "Spieler", "10 Runden in der Kamera gespielt", "🎮", 10, int(plays)),
            ("games-5", "Allrounder", "5 verschiedene Spiele probiert", "🎯", 5, games), ("chatter", "Plauderer", "50 Nachrichten geschickt", "💬", 50, sent),
        ]
        return {"xp": xp, "level": level, "from": floor, "to": ceiling, "streak": user.streak or 0, "streakBest": user.streak_best or 0, "today": user.last_day == utcnow().date().isoformat(),
                "badges": [{"id": i, "name": n, "text": t, "emoji": e, "goal": g, "value": min(v, g), "done": v >= g} for i, n, t, e, g, v in badges]}

    @route("/api/yipi/progress")
    def yipi_progress():
        user, problem = need_user()
        if problem:
            return problem
        touch(user)
        return jsonify({"ok": True, **progress_of(user)})

    @route("/api/yipi/play", methods=["POST"])
    def yipi_play():
        """A round of a game of the camera tab is over: the score goes into the lists of the best players."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("play", str(user.id)):
            return fail("too_many", 429)
        game, score = data.get("game"), data.get("score")
        if not isinstance(game, str) or not re.fullmatch(r"[a-z0-9-]{2,30}", game) or isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 1_000_000:
            return fail("bad_request")
        score = int(score)
        row = YipiGameScore.query.filter_by(user_id=user.id, game=game).first()
        if row is None:
            row = YipiGameScore(user_id=user.id, game=game, best=0, plays=0)
            db.session.add(row)
        record = score > row.best
        row.best = max(row.best, score)
        row.plays += 1
        row.updated_at = utcnow()
        count_day(user)
        db.session.commit()
        better = YipiGameScore.query.filter(YipiGameScore.game == game, YipiGameScore.best > row.best).count()
        return jsonify({"ok": True, "best": row.best, "plays": row.plays, "record": record, "rank": better + 1})

    @route("/api/yipi/games/<game>/top")
    def yipi_game_top(game):
        user, problem = need_user()
        if problem:
            return problem
        if not re.fullmatch(r"[a-z0-9-]{2,30}", game):
            return fail("not_found", 404)
        query = YipiGameScore.query.filter(YipiGameScore.game == game, YipiGameScore.best > 0)
        if request.args.get("scope") == "friends":
            following = {r.followee_id for r in YipiFollow.query.filter_by(follower_id=user.id)}
            followers = {r.follower_id for r in YipiFollow.query.filter_by(followee_id=user.id)}
            query = query.filter(YipiGameScore.user_id.in_((following & followers) | {user.id}))
        banned = suspended_ids() | hidden_user_ids(user)
        if banned:
            query = query.filter(~YipiGameScore.user_id.in_(banned))
        rows = query.order_by(YipiGameScore.best.desc(), YipiGameScore.updated_at.asc()).limit(10).all()
        users = {u.id: u for u in YipiUser.query.filter(YipiUser.id.in_([r.user_id for r in rows]))}
        mine = YipiGameScore.query.filter_by(user_id=user.id, game=game).first()
        return jsonify({"ok": True, "items": [{"rank": k + 1, "user": user_brief(users[r.user_id]), "best": r.best, "isMe": r.user_id == user.id} for k, r in enumerate(rows) if r.user_id in users],
                        "me": {"best": mine.best, "plays": mine.plays} if mine else None})

    # ---------------------------------------------------------------------------------------- hearts on chat messages
    def heart_target(user, kind, message_id, handle=None, group_id=None):
        """The message a heart is meant for, when the person is in that conversation: (row, None) or (None, an error)."""
        if kind == "d":
            row = db.session.get(YipiMessage, message_id)
            other = find_user(handle) if handle else None
            if row is None or other is None or {row.sender_id, row.recipient_id} != {user.id, other.id}:
                return None, fail("not_found", 404)
            return row, None
        group, member = group_of(user, group_id)
        row = db.session.get(YipiGroupMessage, message_id) if group else None
        if row is None or row.group_id != group.id:
            return None, fail("not_found", 404)
        return row, None

    def heart_answer(kind, message_id, user):
        count = YipiHeart.query.filter_by(kind=kind, message_id=message_id).count()
        return jsonify({"ok": True, "hearts": count, "hearted": YipiHeart.query.filter_by(kind=kind, message_id=message_id, user_id=user.id).first() is not None})

    def set_heart(kind, message_id, user, on):
        if limiter.too_many("heart", str(user.id)):
            return fail("too_many", 429)
        mine = YipiHeart.query.filter_by(kind=kind, message_id=message_id, user_id=user.id).first()
        if on and mine is None:
            db.session.add(YipiHeart(kind=kind, message_id=message_id, user_id=user.id))
        elif not on and mine is not None:
            db.session.delete(mine)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        return heart_answer(kind, message_id, user)

    def hearts_of(kind, ids, viewer_id):
        """{message id: (count, mine)} for the messages with at least one heart."""
        ids = [i for i in ids if i]
        if not ids:
            return {}
        rows = YipiHeart.query.filter(YipiHeart.kind == kind, YipiHeart.message_id.in_(ids)).all()
        out = {}
        for r in rows:
            count, mine = out.get(r.message_id, (0, False))
            out[r.message_id] = (count + 1, mine or r.user_id == viewer_id)
        return out

    @route("/api/yipi/messages/<handle>/<int(min=1, max=4611686018427387904):message_id>/heart", methods=["POST", "DELETE"], endpoint="yipi_dm_heart")
    def yipi_dm_heart(handle, message_id):
        user, problem = need_user()
        if problem:
            return problem
        row, problem = heart_target(user, "d", message_id, handle=handle)
        if problem:
            return problem
        return set_heart("d", row.id, user, request.method == "POST")

    @route("/api/yipi/groups/<int(min=1, max=2147483647):group_id>/messages/<int(min=1, max=4611686018427387904):message_id>/heart", methods=["POST", "DELETE"], endpoint="yipi_group_heart")
    def yipi_group_heart(group_id, message_id):
        user, problem = need_user()
        if problem:
            return problem
        row, problem = heart_target(user, "g", message_id, group_id=group_id)
        if problem:
            return problem
        return set_heart("g", row.id, user, request.method == "POST")

    # --------------------------------------------------------------------------------------------- notifications on the device
    @route("/api/yipi/push/key")
    def yipi_push_key():
        user, problem = need_user()
        if problem:
            return problem
        return jsonify({"ok": True, "key": vapid_key().public_key, "subscribed": YipiPush.query.filter_by(user_id=user.id).count()})

    @route("/api/yipi/push/subscribe", methods=["POST"])
    def yipi_push_subscribe():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("push", str(user.id)):
            return fail("too_many", 429)
        sub = data.get("subscription") if isinstance(data.get("subscription"), dict) else {}
        keys = sub.get("keys") if isinstance(sub.get("keys"), dict) else {}
        endpoint, p256dh, auth_key = sub.get("endpoint"), keys.get("p256dh"), keys.get("auth")
        if not (isinstance(endpoint, str) and endpoint.startswith("https://") and len(endpoint) <= 600 and isinstance(p256dh, str) and len(p256dh) <= 200 and isinstance(auth_key, str) and len(auth_key) <= 100):
            return fail("bad_request")
        row = YipiPush.query.filter_by(endpoint=endpoint).first()
        if row is None:
            if YipiPush.query.filter_by(user_id=user.id).count() >= 5:
                oldest = YipiPush.query.filter_by(user_id=user.id).order_by(YipiPush.id.asc()).first()
                db.session.delete(oldest)
            row = YipiPush(user_id=user.id, endpoint=endpoint, p256dh=p256dh, auth=auth_key)
            db.session.add(row)
        row.user_id, row.p256dh, row.auth = user.id, p256dh, auth_key
        db.session.commit()
        return jsonify({"ok": True})

    @route("/api/yipi/push/unsubscribe", methods=["POST"])
    def yipi_push_unsubscribe():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        endpoint = data.get("endpoint")
        query = YipiPush.query.filter_by(user_id=user.id)
        if isinstance(endpoint, str):
            query = query.filter_by(endpoint=endpoint)
        query.delete(synchronize_session=False)
        db.session.commit()
        return jsonify({"ok": True})

    @route("/pulse-sw.js", endpoint="yipi_service_worker")
    def yipi_service_worker():
        """The small program that shows a notification when the page is closed. It has to be served from the root so that it may work for the whole site."""
        path = os.path.join(app.root_path, "static", "js", "pulse-sw.js")
        with open(path, "rb") as handle:
            data = handle.read()
        response = make_response(data)
        response.headers["Content-Type"] = "application/javascript; charset=utf-8"
        response.headers["Cache-Control"] = "no-cache"
        response.headers["Service-Worker-Allowed"] = "/"
        return response

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
        data = upload.read(MAX_VIDEO_BYTES + 1)
        if looks_like_video(data, upload.filename, upload.mimetype):
            kind = video_type(data)
            if kind is None:
                return fail("bad_video", 415)                        # a video, but not one a browser plays (MP4, MOV, WebM only)
            if len(data) > MAX_VIDEO_BYTES:
                return fail("video_too_big", 413)
            seconds = video_seconds(data)
            if seconds is not None and int(seconds) > MAX_VIDEO_SECONDS:
                return fail("video_too_long", 413)
            sides = []
            for name in ("width", "height"):
                try:
                    value = int(request.form.get(name, 0))
                except (TypeError, ValueError):
                    value = 0
                sides.append(value if 16 <= value <= MAX_VIDEO_SIDE else (720 if name == "width" else 1280))
            cleanup_orphans(user)
            item = YipiMedia(id=uuid.uuid4().hex, owner_id=user.id, content_type=kind, data=b"", size=len(data), width=sides[0], height=sides[1], alt=clean_text(request.form.get("alt", ""), 200, keep_newlines=False) or "")
            keep_bytes("media", item, data)
            db.session.add(item)
            db.session.commit()
            return jsonify({"ok": True, "media": media_json(item)})
        if len(data) > MAX_IMAGE_BYTES:
            return fail("too_big", 413)
        info = image_info(data)
        if info is None or info[1] < 1 or info[2] < 1 or info[1] * info[2] > MAX_PIXELS:
            return fail("bad_image", 415)
        alt = clean_text(request.form.get("alt", ""), 200, keep_newlines=False) or ""
        cleanup_orphans(user)
        item = YipiMedia(id=uuid.uuid4().hex, owner_id=user.id, content_type=info[0], data=b"", size=len(data), width=info[1], height=info[2], alt=alt)
        keep_bytes("media", item, data)
        db.session.add(item)
        db.session.commit()
        return jsonify({"ok": True, "media": media_json(item)})

    def r2_redirect(model, item, headers, content_type):
        """The file is in R2: the browser is sent there with a signed address that works for an hour (video players ask for pieces themselves)."""
        disposition = headers.get("Content-Disposition", "")
        try:
            address = STORE.url(BLOB_KIND[model], item.id, content_type, disposition if disposition.startswith("attachment") else None, expires=3600)
        except Exception:  # noqa: BLE001
            logger.exception("Could not sign an R2 address")
            abort(503)
        response = redirect(address, code=302)
        response.headers["Cache-Control"] = "private, max-age=300"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    def blob_response(model, item, headers):
        """The bytes of a stored file (a picture, a video, a document): whole, or one piece of it for a video that is being played (Range)."""
        if item.stored == "r2":
            return r2_redirect(model, item, headers, item.content_type)
        if not item.content_type.startswith("video/"):
            response = Response(db.session.query(model.data).filter_by(id=item.id).scalar(), mimetype=item.content_type, headers=headers)
            response.set_etag(item.id)
            return response.make_conditional(request)
        size = item.size
        start, end, partial = 0, size - 1, False
        wanted = re.fullmatch(r"bytes=(\d*)-(\d*)", request.headers.get("Range", "").strip())
        if wanted and (wanted.group(1) or wanted.group(2)):
            if wanted.group(1):
                start = int(wanted.group(1))
                end = min(int(wanted.group(2)), size - 1) if wanted.group(2) else size - 1
            else:                                                     # "the last N bytes"
                start = max(0, size - int(wanted.group(2)))
            if start >= size or start > end:
                return Response(status=416, headers={"Content-Range": f"bytes */{size}"})
            partial = True
        length = end - start + 1
        chunk = db.session.query(func.substr(model.data, start + 1, length)).filter(model.id == item.id).scalar() or b""
        response = Response(bytes(chunk), status=206 if partial else 200, mimetype=item.content_type, headers=headers)
        response.headers["Accept-Ranges"] = "bytes"
        response.headers["Content-Length"] = str(len(chunk))
        if partial:
            response.headers["Content-Range"] = f"bytes {start}-{start + len(chunk) - 1}/{size}"
        return response

    @route("/yipi-media/<media_id>")
    def yipi_media_file(media_id):
        item = YipiMedia.query.options(defer(YipiMedia.data)).filter_by(id=media_id).first() if re.fullmatch(r"[0-9a-f]{32}", media_id) else None
        if item is None:
            abort(404)
        headers = {"Cache-Control": "public, max-age=31536000, immutable", "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox", "Content-Disposition": "inline"}
        return blob_response(YipiMedia, item, headers)

    # -------------------------------------------------------------------------------- files in chats (private)
    def may_open_file(user, item):
        """The owner, and the people of the conversation the file was sent in (a message between two people, or a group the person is in)."""
        if user is None:
            return False
        if item.owner_id == user.id:
            return True
        if YipiMessage.query.filter(YipiMessage.file_id == item.id, or_(YipiMessage.sender_id == user.id, YipiMessage.recipient_id == user.id)).first() is not None:
            return True
        groups = [row.group_id for row in YipiGroupMessage.query.filter(YipiGroupMessage.file_id == item.id)]
        return bool(groups) and YipiGroupMember.query.filter(YipiGroupMember.user_id == user.id, YipiGroupMember.group_id.in_(groups)).first() is not None

    @route("/yipi-files/<file_id>")
    def yipi_file(file_id):
        item = YipiFile.query.options(defer(YipiFile.data)).filter_by(id=file_id).first() if re.fullmatch(r"[0-9a-f]{32}", file_id) else None
        if item is None or not may_open_file(current_user(), item):
            abort(404)
        quoted = item.name.replace("\\", "_").replace('"', "")
        disposition = "inline" if item.kind in ("image", "video") else f"attachment; filename=\"{quoted.encode('ascii', 'replace').decode()}\"; filename*=UTF-8''{urllib.parse.quote(item.name)}"
        headers = {"Cache-Control": "private, max-age=86400", "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; sandbox",
                   "Content-Disposition": disposition, "X-Content-Type-Options": "nosniff"}
        return blob_response(YipiFile, item, headers)

    @route("/api/yipi/attachments", methods=["POST"])
    def yipi_attach():
        """A photo, a video or a document for a chat message: checked, stored privately, and the answer says how to send it."""
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("attach", str(user.id)):
            return fail("too_many", 429)
        upload = request.files.get("file")
        if upload is None:
            return fail("no_file")
        data = upload.read(MAX_VIDEO_BYTES + 1)
        name = safe_filename(upload.filename)
        width = height = 0
        if looks_like_video(data, upload.filename, upload.mimetype):
            content_type, kind = video_type(data), "video"
            if content_type is None:
                return fail("bad_video", 415)
            if len(data) > MAX_VIDEO_BYTES:
                return fail("video_too_big", 413)
            seconds = video_seconds(data)
            if seconds is not None and int(seconds) > 600:
                return fail("attachment_too_big", 413)
            for field in ("width", "height"):
                try:
                    value = int(request.form.get(field, 0))
                except (TypeError, ValueError):
                    value = 0
                if field == "width":
                    width = value if 16 <= value <= MAX_VIDEO_SIDE else 0
                else:
                    height = value if 16 <= value <= MAX_VIDEO_SIDE else 0
        else:
            info = image_info(data)
            if info is not None and info[1] >= 1 and info[2] >= 1 and info[1] * info[2] <= MAX_PIXELS:
                if len(data) > MAX_FILE_IMAGE_BYTES:
                    return fail("too_big", 413)
                content_type, kind, width, height = info[0], "image", info[1], info[2]
            else:
                content_type, kind = document_type(data, upload.filename), "document"
                if content_type is None:
                    return fail("bad_attachment", 415)
                if len(data) > MAX_DOCUMENT_BYTES:
                    return fail("attachment_too_big", 413)
        cutoff = utcnow() - timedelta(hours=6)
        stale = YipiFile.query.options(defer(YipiFile.data)).filter(YipiFile.owner_id == user.id, YipiFile.created_at < cutoff).all()
        for old in stale:                                       # earlier files of this person that never went into a message
            if YipiMessage.query.filter_by(file_id=old.id).first() is None and YipiGroupMessage.query.filter_by(file_id=old.id).first() is None:
                forget_stored(YipiFile, YipiFile.id == old.id)
                db.session.delete(old)
        item = YipiFile(id=uuid.uuid4().hex, owner_id=user.id, kind=kind, content_type=content_type, name=name, data=b"", size=len(data), width=width, height=height)
        keep_bytes("file", item, data)
        db.session.add(item)
        db.session.commit()
        return jsonify({"ok": True, "file": file_json(item)}), 201

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
        if any(item.content_type.startswith("video/") for _, item in items):
            if len(items) > 1:
                return None, fail("video_alone")                     # a video stands alone: no photos next to it
            if reply_to is not None or quote_of is not None:
                return None, fail("video_top")                       # and it is a post of its own, not an answer or a quote
        cam_id = data.get("camId")
        if not (isinstance(cam_id, str) and CAM_ID_RE.fullmatch(cam_id) and any(item.content_type.startswith("video/") for _, item in items)):
            cam_id = None                                                      # only a video can say which lens or game of the camera it was made with
        post = YipiPost(user_id=user.id, text=text, reply_to_id=reply_to.id if reply_to else None, quote_of_id=quote_of.id if quote_of else None,
                        root_id=(reply_to.root_id or reply_to.id) if reply_to else None, cam_id=cam_id)
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
        schedule_fact_check([post])
        return jsonify({"ok": True, "post": feed_items([post], user)[0]}), 201

    def schedule_fact_check(posts):
        """Posts with something to check that nobody has checked yet go to the AI in the background (at most as often as the limit allows)."""
        if not os.environ.get("GROQ_API_KEY"):
            return
        wanted = [post.id for post in posts if not post.fact_status and not post.deleted and not post.repost_of_id and len(post.text or "") >= FACT_MIN_LENGTH][:5]
        wanted = [post_id for post_id in wanted if not limiter.too_many("factcheck", "all")]
        if wanted:
            FACT_RUNNER(app, wanted)

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

    @route("/api/yipi/share/<int(min=1, max=4611686018427387904):post_id>")
    def yipi_share(post_id):
        """What somebody who is not signed in may see of a post that was sent to them: the post (a video, a photo, a few words) and one other video
        from the Videos tab, which the page shows blurred behind the invitation to sign up. Nothing else (no counts, no comments, no lists)."""
        first, last = client_addresses()
        if limiter.too_many("share", first) or limiter.too_many("share", last):
            return fail("too_many", 429)
        post = db.session.get(YipiPost, post_id)
        owner = db.session.get(YipiUser, post.user_id) if post else None
        if post is None or post.deleted or post.repost_of_id or owner is None or owner.suspended:
            return fail("not_found", 404)
        media = media_rows(post.id)

        def pack(row, owner_row, rows):
            return {"id": row.id, "text": row.text, "createdAt": iso(row.created_at), "user": user_brief(owner_row), "media": [media_json(m) for m in rows[:MAX_MEDIA]]}

        other = None
        candidates = visible_posts(None).filter(YipiPost.reply_to_id.is_(None), YipiPost.repost_of_id.is_(None), YipiPost.id != post.id,
                                                YipiPost.id.in_(select(YipiMedia.post_id).where(YipiMedia.post_id.isnot(None), YipiMedia.content_type.like("video/%")))).order_by(func.random()).first()
        if candidates is not None:
            other_owner = db.session.get(YipiUser, candidates.user_id)
            other_media = media_rows(candidates.id)
            if other_owner is not None and other_media:
                other = pack(candidates, other_owner, other_media)
        return jsonify({"ok": True, "post": pack(post, owner, media), "next": other, "text": SHARE_VIDEO if any(m.content_type.startswith("video/") for m in media) else SHARE_POST})

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
            seen = list(YipiPost.query.filter(YipiPost.id.in_(ids), YipiPost.deleted.is_(False), YipiPost.repost_of_id.is_(None), YipiPost.user_id != user.id))
            for post in seen:
                bump(YipiPost, post.id, YipiPost.view_count, 1)
                counted += 1
            db.session.commit()
            schedule_fact_check(seen)
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
            if feed == "media":                                   # Explore, "Medien": posts with photos, a GIF or a video
                query = query.filter(YipiPost.id.in_(select(YipiMedia.post_id).where(YipiMedia.post_id.isnot(None))))
            elif feed == "videos":                                # the Videos tab: posts with a video
                query = query.filter(YipiPost.id.in_(select(YipiMedia.post_id).where(YipiMedia.post_id.isnot(None), YipiMedia.content_type.like("video/%"))))
                if request.args.get("scope") == "following" and viewer:        # "Folge ich": only people the viewer follows
                    query = query.filter(YipiPost.user_id.in_([r.followee_id for r in YipiFollow.query.filter_by(follower_id=viewer.id)]))
        if feed == "videos" and request.args.get("order") == "random":
            return jsonify(random_video_page(query, viewer))
        if request.args.get("novideo") == "1" and feed in ("foryou", "following"):
            query = without_videos(query)                         # Home on a phone held upright: no videos in the feed (they are in the Videos tab)
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
        if request.args.get("novideo") == "1":
            query = without_videos(query)
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

    @route("/api/yipi/link-preview")
    def yipi_link_preview():
        """The card of a link (title, text, picture, site) for a post, a video or a chat. The fetching is done here (see yipi_links.py), the pictures of the card are served by us."""
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("link-preview", str(user.id)):
            return fail("too_many", 429)
        try:
            card = dict(yipi_links.preview(request.args.get("url", ""), request.host_url.rstrip("/")))
        except yipi_links.LinkError as error:
            return fail(error.code, 502 if error.code == "link_unreachable" else 400)
        for key in ("image", "favicon"):
            if card.get(key):
                card[key] = "/yipi-linkimg?u=" + urllib.parse.quote(card[key], safe="")
        return jsonify({"ok": True, **card})

    @route("/yipi-linkimg")
    def yipi_link_image():
        """A picture of a link card, fetched by the server (the reader's browser never talks to the linked site) and shown for a few hours."""
        user = current_user()
        if user is None:
            abort(401)
        if limiter.too_many("link-image", str(user.id)):
            abort(429)
        try:
            data, kind = yipi_links.image(request.args.get("u", ""))
        except yipi_links.LinkError:
            abort(404)
        response = Response(data, mimetype=kind)
        response.headers["Cache-Control"] = "private, max-age=21600"
        response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

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
    def message_json(row, gifs, mine, starred=(), files=None, hearts=None):
        gif = gifs.get(row.gif_id) if row.gif_id else None
        stored = (files or {}).get(row.file_id) if row.file_id else None
        count, hearted = (hearts or {}).get(row.id, (0, False))
        return {"id": row.id, "text": row.text, "createdAt": iso(row.created_at), "mine": mine, "read": bool(row.read), "hearts": count, "hearted": hearted,
                "gif": gif_json(gif, None, starred) if gif else ({"gone": True} if row.gif_id else None),
                "file": file_json(stored) if stored else ({"gone": True} if row.file_id else None)}

    def file_for_message(user, data):
        """(file, None) for the `fileId` of a message the person wants to send, (None, None) when there is none, (None, an error) when it is not theirs."""
        file_id = data.get("fileId")
        if file_id is None:
            return None, None
        item = files_by_id([file_id]).get(file_id) if isinstance(file_id, str) else None
        if item is None or item.owner_id != user.id:
            return None, fail("bad_attachment", 404)
        return item, None                                           # (the same file may go to several friends: it is only ever opened by the people of those chats)

    def dm_gate(sender, target):
        """None when `sender` may write to `target` now, else why not:
             "accept_first"     target wrote first, and the sender has not accepted that request yet,
             "request_pending"  target has not accepted the sender's request: one message is allowed, then it is the other one's turn."""
        if dm_boxes(sender, [target.id])[target.id] != "primary" and YipiMessage.query.filter_by(sender_id=target.id, recipient_id=sender.id).first() is not None:
            return "accept_first"
        if dm_boxes(target, [sender.id])[sender.id] != "primary" and YipiMessage.query.filter_by(sender_id=sender.id, recipient_id=target.id).first() is not None:
            return "request_pending"
        return None

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
        boxes = dm_boxes(user, others)
        last_files = files_by_id(row.file_id for row in rows)
        streaks = friend_streaks(user, others)
        items = []
        for row in rows:
            other_id = row.recipient_id if row.sender_id == user.id else row.sender_id
            other = users.get(other_id)
            if other is None or other.suspended or other_id in hidden or boxes.get(other_id) == "declined":
                continue
            items.append({"user": user_brief(other), "box": boxes.get(other_id, "primary"), "streak": streaks.get(other_id, 0),
                          "last": {"text": row.text or ("GIF" if row.gif_id else file_label(last_files.get(row.file_id)) if row.file_id else ""), "gif": bool(row.gif_id), "createdAt": iso(row.created_at), "mine": row.sender_id == user.id, "read": bool(row.read)},
                          "unread": unread.get(other_id, 0)})
        return items

    @route("/api/yipi/messages")
    def yipi_conversations():
        user, problem = need_user()
        if problem:
            return problem
        return jsonify({"ok": True, "items": dm_items(user)})

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
            group_files = files_by_id(row.file_id for row in rows.values())
            for group_id, group in groups.items():
                row = rows.get(newest.get(group_id))
                sender = senders.get(row.sender_id) if row else None
                last = {"text": row.text or ("GIF" if row.gif_id else file_label(group_files.get(row.file_id)) if row.file_id else ""), "gif": bool(row.gif_id), "createdAt": iso(row.created_at), "mine": row.sender_id == user.id, "sender": sender.handle if sender else None} if row else None
                items.append({"kind": "group", "group": {"id": group.id, "name": group.name, "count": sizes.get(group_id, 1)}, "last": last, "unread": unread.get(group_id, 0), "at": last["createdAt"] if last else iso(group.created_at)})
        items.sort(key=lambda item: item["at"], reverse=True)
        return jsonify({"ok": True, "items": items[:60], "requests": sum(1 for item in items if item.get("box") in ("request", "general"))})

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

    def group_message_json(row, users, gifs, viewer, files=None, hearts=None):
        sender = users.get(row.sender_id)
        gif = gifs.get(row.gif_id) if row.gif_id else None
        stored = (files or {}).get(row.file_id) if row.file_id else None
        count, hearted = (hearts or {}).get(row.id, (0, False))
        return {"id": row.id, "text": row.text, "createdAt": iso(row.created_at), "mine": row.sender_id == viewer.id, "sender": user_brief(sender) if sender else None, "hearts": count, "hearted": hearted,
                "gif": gif_json(gif) if gif else ({"gone": True} if row.gif_id else None),
                "file": file_json(stored) if stored else ({"gone": True} if row.file_id else None)}

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
        mutual = (following & followers) - hidden_user_ids(user) - agent_id_set()               # (the AI accounts do not chat)
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
        files = files_by_id(row.file_id for row in rows)
        return jsonify({"ok": True, "group": group_json(group, user), "messages": [group_message_json(row, users, gifs, user, files, hearts_of("g", [r.id for r in rows], user.id)) for row in reversed(rows)], "next": rows[-1].id if more and rows else None})

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
        stored, problem = file_for_message(user, data)
        if problem:
            return problem
        if not text and not gif_id and stored is None:
            return fail("empty")
        if limiter.too_many("dm", str(user.id)):
            return fail("too_many", 429)
        row = YipiGroupMessage(group_id=group.id, sender_id=user.id, text=text, gif_id=gif_id, file_id=stored.id if stored else None)
        db.session.add(row)
        db.session.flush()
        member.last_read = row.id
        if gif_id:
            bump(PulseGif, gif_id, PulseGif.uses, 1)
        db.session.commit()
        for other_member in YipiGroupMember.query.filter(YipiGroupMember.group_id == group.id, YipiGroupMember.user_id != user.id).all():
            push_later(other_member.user_id, "Nex", f"{user.name} in „{group.name}“", f"/g/{group.id}", tag=f"group-{group.id}")
        return jsonify({"ok": True, "message": group_message_json(row, {user.id: user}, gifs, user, {stored.id: stored} if stored else None)}), 201

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
        files = files_by_id(row.file_id for row in rows)
        recent = [r.id for r in YipiGroupMessage.query.filter_by(group_id=group.id).order_by(YipiGroupMessage.id.desc()).limit(40)]
        return jsonify({"ok": True, "messages": [group_message_json(row, users, gifs, user, files) for row in rows], "hearts": {str(k): [c, m] for k, (c, m) in hearts_of("g", recent, user.id).items()}})

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
        box = dm_boxes(user, [other.id])[other.id]
        received = YipiMessage.query.filter_by(sender_id=other.id, recipient_id=user.id).first() is not None
        if box == "primary":                                  # a message request is not "seen" until it is accepted: the sender does not learn that it was read
            YipiMessage.query.filter_by(sender_id=other.id, recipient_id=user.id, read=False).update({"read": True})
            db.session.commit()
        gifs = gifs_by_id(r.gif_id for r in rows)
        starred = favorite_ids(user, [r.gif_id for r in rows if r.gif_id])
        files = files_by_id(r.file_id for r in rows)
        beats = hearts_of("d", [r.id for r in rows], user.id)
        messages = [message_json(r, gifs, r.sender_id == user.id, starred, files, beats) for r in reversed(rows)]
        gate = dm_gate(user, other)
        return jsonify({"ok": True, "user": user_dict(other, user), "messages": messages, "next": rows[-1].id if more and rows else None, "canWrite": gate is None, "gate": gate,
                        "request": received and box in ("request", "general", "declined"), "box": box})

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
        if other.company:
            return fail("official_account", 403)                        # an official account of Nex has no inbox
        if other.agent_kind is not None:
            return fail("ai_account", 403)                              # an AI account does not read or answer messages
        text = clean_text(data.get("text", ""), MAX_DM)
        if text is None:
            return fail("too_long")
        gif_id = data.get("gifId")
        gifs = {}
        if gif_id is not None:
            gifs = gifs_by_id([gif_id])
            if not isinstance(gif_id, str) or gif_id not in gifs:
                return fail("gif_gone", 404)
        stored, problem = file_for_message(user, data)
        if problem:
            return problem
        if not text and not gif_id and stored is None:
            return fail("empty")
        gate = dm_gate(user, other)
        if gate:
            return fail(gate, 403)
        if limiter.too_many("dm", str(user.id)):
            return fail("too_many", 429)
        message = YipiMessage(sender_id=user.id, recipient_id=other.id, text=text, gif_id=gif_id, file_id=stored.id if stored else None)
        db.session.add(message)
        if gif_id:
            bump(PulseGif, gif_id, PulseGif.uses, 1)
        db.session.commit()
        push_later(other.id, "Nex", f"{user.name} hat dir geschrieben", f"/messages/{user.handle}", tag=f"dm-{user.id}")
        return jsonify({"ok": True, "message": message_json(message, gifs, True, favorite_ids(user, [gif_id]), {stored.id: stored} if stored else None), "gate": dm_gate(user, other)}), 201

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
        if rows and dm_boxes(user, [other.id])[other.id] == "primary":
            for row in rows:
                row.read = True
            db.session.commit()
        gifs = gifs_by_id(r.gif_id for r in rows)
        starred = favorite_ids(user, [r.gif_id for r in rows if r.gif_id])
        seen = db.session.query(func.max(YipiMessage.id)).filter(YipiMessage.sender_id == user.id, YipiMessage.recipient_id == other.id, YipiMessage.read.is_(True)).scalar()
        files = files_by_id(r.file_id for r in rows)
        conversation = or_(and_(YipiMessage.sender_id == user.id, YipiMessage.recipient_id == other.id), and_(YipiMessage.sender_id == other.id, YipiMessage.recipient_id == user.id))
        recent = [r.id for r in YipiMessage.query.filter(conversation).order_by(YipiMessage.id.desc()).limit(40)]
        return jsonify({"ok": True, "messages": [message_json(r, gifs, False, starred, files) for r in rows], "readUpTo": seen or 0, "hearts": {str(k): [c, m] for k, (c, m) in hearts_of("d", recent, user.id).items()}})

    def dm_decide(handle, state):
        user, problem = need_user()
        if problem:
            return problem
        other = find_user(handle)
        if other is None or other.suspended or other.id == user.id:
            return fail("not_found", 404)
        row = YipiDmState.query.filter_by(user_id=user.id, other_id=other.id).first()
        if row is None:
            row = YipiDmState(user_id=user.id, other_id=other.id, state=state)
            db.session.add(row)
        row.state = state
        db.session.commit()
        return jsonify({"ok": True, "box": dm_boxes(user, [other.id])[other.id]})

    @route("/api/yipi/messages/<handle>/accept", methods=["POST"], endpoint="yipi_dm_accept")
    def yipi_dm_accept(handle):
        return dm_decide(handle, "accepted")

    @route("/api/yipi/messages/<handle>/decline", methods=["POST"], endpoint="yipi_dm_decline")
    def yipi_dm_decline(handle):
        return dm_decide(handle, "declined")

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
        gif = PulseGif(id=uuid.uuid4().hex, owner_id=user.id, title=title, data=b"", size=len(data), width=info[0], height=info[1], frames=info[2])
        keep_bytes("gif", gif, data)
        db.session.add(gif)
        db.session.commit()
        return jsonify({"ok": True, "gif": gif_json(gif, user.id)}), 201

    @route("/pulse-gif/<gif_id>")
    def pulse_gif_file(gif_id):
        gif = db.session.get(PulseGif, gif_id) if GIF_ID_RE.fullmatch(gif_id) else None
        if gif is None:
            abort(404)
        if gif.stored == "r2":
            return r2_redirect(PulseGif, gif, {}, "image/gif")
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
        cleanup_orphans(user)
        item = YipiMedia(id=uuid.uuid4().hex, owner_id=user.id, content_type="image/gif", data=b"", size=gif.size, width=gif.width, height=gif.height, alt=gif.title or "GIF", gif_id=gif.id)
        if gif.stored == "r2":
            try:
                STORE.copy("gif", gif.id, "media", item.id)
                item.stored = "r2"
            except Exception:  # noqa: BLE001
                logger.exception("Could not copy a GIF inside R2")
                return fail("gif_gone", 404)
        else:
            keep_bytes("media", item, load_bytes(PulseGif, gif))
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
        forget_stored(PulseGif, PulseGif.id == gif_id)
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
        pictures, attached, documents = [], [], []
        raw_files = data.get("files") if isinstance(data.get("files"), list) else []
        for entry in raw_files[:NEX_FILES]:                                  # what the person attached to the last question
            if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
                continue
            label = safe_filename(entry["name"])
            if entry.get("kind") == "image" and isinstance(entry.get("data"), str):
                raw_picture = entry["data"][:NEX_IMAGE_CHARS + 1]
                try:
                    picture = base64.b64decode(raw_picture, validate=True) if len(raw_picture) <= NEX_IMAGE_CHARS else b""
                except ValueError:
                    picture = b""
                info = image_info(picture) if picture else None
                if info is None or info[0] not in ("image/jpeg", "image/png", "image/webp"):
                    return fail("bad_image", 415)
                pictures.append(f"data:{info[0]};base64,{raw_picture}")
                attached.append(f"ein Foto („{label}“)")
            elif entry.get("kind") == "document" and isinstance(entry.get("text"), str):
                text = clean_text(entry["text"], NEX_DOC_CHARS)
                if text:
                    documents.append(f"Der Nutzer hängt das Dokument „{label}“ an. Sein Text:\n{text}")
                    attached.append(f"das Dokument „{label}“")
        if data.get("postId") is not None:
            post = get_post_or_none(clamp_cursor(data["postId"]) or 0, user)
            if post is not None and not post.deleted and post.user_id not in hidden_user_ids(user):
                author = db.session.get(YipiUser, post.user_id)
                lines.append(f"Der Nutzer zeigt dir diesen Beitrag von @{author.handle if author else '?'}: „{post.text}“")
        for role, content in turns:
            lines.append(("Nutzer: " if role == "user" else "Nex: ") + content)
        transcript = "\n\n".join(lines)
        if documents:
            share = NEX_DOC_CHARS // len(documents)
            documents = [entry[:share + 120] for entry in documents]          # (the first line names the file)
        room = max(1500, 7600 - sum(len(entry) for entry in documents))
        while len(transcript) > room and len(lines) > 1:           # the model takes about 8000 characters: drop the oldest turns first
            lines.pop(1 if len(lines) > 2 and lines[0].startswith("Der Nutzer zeigt") else 0)
            transcript = "\n\n".join(lines)
        if documents:                                              # the documents belong to the last question and are never dropped
            transcript = "\n\n".join([*documents, transcript])
        elif pictures:
            transcript = f"(Der Nutzer hat {len(pictures)} {'Foto' if len(pictures) == 1 else 'Fotos'} angehängt.)\n\n{transcript}"

        mode = NEX_MODES.get(data.get("mode")) if isinstance(data.get("mode"), str) else None
        mode = mode or NEX_MODES["normal"]                          # (an unknown name is the normal mode; the instructions of a mode never come from the page)
        if re.search(r"spiel|game|jump|runner|flappy|arcade", turns[-1][1], re.I):
            mode = {**mode, "prompt": mode["prompt"] + " " + yipi_games.NEX_GAME_FORMAT}      # (somebody who talks about a game: the AI knows the format of the games of Nex)

        def generate():
            try:
                if pictures:
                    yield from ai_assistant.generate_vision_stream(mode["prompt"], transcript, pictures, max_tokens=mode["tokens"], temperature=min(0.7, mode["temperature"]))
                else:
                    extra = {"model": mode["model"]} if mode["model"] else {}
                    yield from ai_assistant.generate_custom_stream(mode["prompt"], transcript, max_tokens=mode["tokens"], temperature=mode["temperature"], **extra)
            except Exception:
                logger.exception("Nex konnte nicht antworten")

        return Response(stream_with_context(generate()), mimetype="text/plain")

    @route("/api/yipi/nex/read", methods=["POST"])
    def pulse_nex_read():
        """The text of a document that somebody wants to ask Nex about (nothing is stored): {name, text, cut}."""
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("nex-read", str(user.id)):
            return fail("too_many", 429)
        upload = request.files.get("file")
        if upload is None:
            return fail("no_file")
        data = upload.read(NEX_DOC_BYTES + 1)
        if len(data) > NEX_DOC_BYTES:
            return fail("attachment_too_big", 413)
        try:
            text, cut = docread.extract(data, upload.filename or "", NEX_DOC_CHARS)
        except docread.Unreadable as error:
            code = {"empty": "doc_empty", "too_big": "doc_too_big", "encrypted": "doc_encrypted", "no_pdf_reader": "doc_no_pdf_reader"}.get(str(error), "doc_bad")
            return fail(code, 415)
        return jsonify({"ok": True, "name": safe_filename(upload.filename), "text": text, "cut": cut})

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

    # ------------------------------------------------------------------------------------------------ stories
    def story_json(story, media, viewer, seen, views=None):
        item = {"id": story.id, "media": media_json(media) if media is not None else None, "caption": story.caption, "createdAt": iso(story.created_at),
                "seen": story.user_id == viewer.id or story.id in seen, "mine": story.user_id == viewer.id}
        if story.user_id == viewer.id:
            item["views"] = (views or {}).get(story.id, 0)
        return item

    def visible_story_owner(viewer, handle):
        target = find_user(handle) if isinstance(handle, str) else None
        if target is None or target.suspended or (target.id != viewer.id and target.id in hidden_user_ids(viewer)):
            return None
        return target

    @route("/api/yipi/stories")
    def yipi_stories():
        """The row at the top of Home: yourself first, then the people you follow who have a story from the last 24 hours (the ones you have not seen yet first)."""
        user, problem = need_user()
        if problem:
            return problem
        purge_stories()
        following = {row.followee_id for row in YipiFollow.query.filter_by(follower_id=user.id)}
        wanted = (following | {user.id}) - ((suspended_ids() | hidden_user_ids(user)) - {user.id})
        rows = YipiStory.query.filter(YipiStory.user_id.in_(wanted), YipiStory.created_at >= utcnow() - timedelta(hours=STORY_HOURS)).order_by(YipiStory.created_at.asc()).all() if wanted else []
        seen = {row.story_id for row in YipiStoryView.query.filter(YipiStoryView.viewer_id == user.id, YipiStoryView.story_id.in_([story.id for story in rows]))} if rows else set()
        rings = {}
        for story in rows:
            ring = rings.setdefault(story.user_id, {"count": 0, "unseen": 0, "latest": story.created_at})
            ring["count"] += 1
            ring["latest"] = max(ring["latest"], story.created_at)
            if story.user_id != user.id and story.id not in seen:
                ring["unseen"] += 1
        people = {row.id: row for row in YipiUser.query.filter(YipiUser.id.in_(list(rings)))} if rings else {}
        items = [{"user": user_brief(people[uid]), "isMe": uid == user.id, "count": ring["count"], "unseen": ring["unseen"], "latest": iso(ring["latest"])} for uid, ring in rings.items() if uid in people]
        items.sort(key=lambda entry: (not entry["isMe"], entry["unseen"] == 0, -datetime.fromisoformat(entry["latest"].replace("Z", "+00:00")).timestamp()))
        return jsonify({"ok": True, "items": items, "me": user.id in rings})

    @route("/api/yipi/stories/<handle>")
    def yipi_story_list(handle):
        user, problem = need_user()
        if problem:
            return problem
        target = visible_story_owner(user, handle)
        if target is None:
            return fail("not_found", 404)
        rows = YipiStory.query.filter(YipiStory.user_id == target.id, YipiStory.created_at >= utcnow() - timedelta(hours=STORY_HOURS)).order_by(YipiStory.created_at.asc()).all()
        media = {row.id: row for row in YipiMedia.query.options(defer(YipiMedia.data)).filter(YipiMedia.id.in_([story.media_id for story in rows]))} if rows else {}
        seen = {row.story_id for row in YipiStoryView.query.filter(YipiStoryView.viewer_id == user.id, YipiStoryView.story_id.in_([story.id for story in rows]))} if rows else set()
        views = {}
        if target.id == user.id and rows:
            views = dict(db.session.query(YipiStoryView.story_id, func.count(YipiStoryView.id)).filter(YipiStoryView.story_id.in_([story.id for story in rows])).group_by(YipiStoryView.story_id).all())
        return jsonify({"ok": True, "user": user_brief(target), "items": [story_json(story, media.get(story.media_id), user, seen, views) for story in rows]})

    @route("/api/yipi/stories", methods=["POST"])
    def yipi_story_create():
        """A photo or video that was just uploaded (the usual upload) becomes a story."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("story", str(user.id)):
            return fail("too_many", 429)
        media_id = data.get("media")
        caption = clean_text(data.get("caption", ""), MAX_STORY_CAPTION, keep_newlines=False)
        if not isinstance(media_id, str) or caption is None:
            return fail("bad_request")
        media = db.session.get(YipiMedia, media_id) if re.fullmatch(r"[0-9a-f]{32}", media_id) else None
        if media is None or media.owner_id != user.id or media.post_id is not None or media_id in (user.avatar_id, user.banner_id):
            return fail("bad_media")
        if YipiStory.query.filter_by(media_id=media_id).first() is not None:
            return fail("bad_media")
        if YipiStory.query.filter(YipiStory.user_id == user.id, YipiStory.created_at >= utcnow() - timedelta(hours=STORY_HOURS)).count() >= MAX_STORIES:
            return fail("too_many_stories", 409)
        story = YipiStory(user_id=user.id, media_id=media.id, caption=caption)
        db.session.add(story)
        count_day(user)
        db.session.commit()
        return jsonify({"ok": True, "story": story_json(story, media, user, set())}), 201

    @route("/api/yipi/stories/<int(min=1, max=4611686018427387904):story_id>/seen", methods=["POST"])
    def yipi_story_seen(story_id):
        user, problem = need_user()
        if problem:
            return problem
        story = db.session.get(YipiStory, story_id)
        if story is None or story.created_at < utcnow() - timedelta(hours=STORY_HOURS) or visible_story_owner(user, (db.session.get(YipiUser, story.user_id) or YipiUser(handle="")).handle) is None:
            return fail("not_found", 404)
        if story.user_id != user.id and not limiter.too_many("story-view", str(user.id)) and YipiStoryView.query.filter_by(story_id=story.id, viewer_id=user.id).first() is None:
            db.session.add(YipiStoryView(story_id=story.id, viewer_id=user.id))
            try:
                db.session.commit()
            except IntegrityError:
                db.session.rollback()
        return jsonify({"ok": True})

    @route("/api/yipi/stories/<int(min=1, max=4611686018427387904):story_id>", methods=["DELETE"])
    def yipi_story_delete(story_id):
        user, problem = need_user()
        if problem:
            return problem
        story = db.session.get(YipiStory, story_id)
        if story is None:
            return fail("not_found", 404)
        if story.user_id != user.id and not is_admin(user):
            return fail("forbidden", 403)
        YipiStoryView.query.filter_by(story_id=story.id).delete()
        forget_stored(YipiMedia, YipiMedia.id == story.media_id)
        YipiMedia.query.filter_by(id=story.media_id).delete()
        db.session.delete(story)
        db.session.commit()
        return jsonify({"ok": True})

    # ----------------------------------------------------------------------------- storage (admins): the database and R2
    STORAGE_MODELS = (("media", YipiMedia), ("file", YipiFile), ("gif", PulseGif))
    STORAGE_TABLES = ("yipi_media", "yipi_file", "pulse_gif", "yipi_post", "yipi_message", "yipi_group_message")
    MOVE_BUDGET = 30 * 1024 * 1024                                  # bytes moved to R2 per call, so that one call stays short

    def in_database(model):
        return (model.stored == "db", func.length(model.data) > 0)

    # ------------------------------------------------------------------------------------------------ face lenses that people write as prompts
    LENS_ID_RE = re.compile(r"lu-[0-9a-f]{8}")

    def lens_json(row, viewer, owners=None):
        owner = (owners or {}).get(row.owner_id) or db.session.get(YipiUser, row.owner_id)
        return {"id": row.id, "title": row.title, "prompt": row.prompt, "emoji": row.emoji, "color": row.color, "fx": [name for name in row.fx.split(",") if name], "filter": row.filter,
                "uses": row.uses, "user": user_brief(owner) if owner else None, "mine": bool(viewer and viewer.id == row.owner_id), "createdAt": iso(row.created_at)}

    @route("/api/yipi/lenses")
    def yipi_lenses_list():
        """The lenses other people published: the most used first ("popular"), the newest ("new") or yours ("mine")."""
        user, problem = need_user()
        if problem:
            return problem
        sort = request.args.get("sort", "popular")
        try:
            limit = max(1, min(60, int(request.args.get("limit", "40"))))
        except ValueError:
            limit = 40
        query = PulseLens.query.filter(PulseLens.deleted.is_(False))
        hidden = hidden_user_ids(user) | suspended_ids()
        if hidden:
            query = query.filter(~PulseLens.owner_id.in_(hidden))
        if sort == "mine":
            query = query.filter(PulseLens.owner_id == user.id)
        rows = (query.order_by(PulseLens.created_at.desc()) if sort in ("new", "mine") else query.order_by(PulseLens.uses.desc(), PulseLens.created_at.desc())).limit(limit).all()
        owners = {row.id: row for row in YipiUser.query.filter(YipiUser.id.in_({lens.owner_id for lens in rows}))} if rows else {}
        return jsonify({"ok": True, "items": [lens_json(row, user, owners) for row in rows]})

    @route("/api/yipi/lenses/<lens_id>")
    def yipi_lens_get(lens_id):
        user, problem = need_user()
        if problem:
            return problem
        row = PulseLens.query.filter_by(id=lens_id, deleted=False).first() if LENS_ID_RE.fullmatch(lens_id) else None
        if row is None or row.owner_id in suspended_ids():
            return fail("not_found", 404)
        return jsonify({"ok": True, "lens": lens_json(row, user)})

    @route("/api/yipi/lenses/recipe", methods=["POST"], endpoint="yipi_lens_recipe")
    def yipi_lens_recipe():
        """What a prompt becomes: {title, emoji, color, fx, filter, source}, not saved (the person tries it first, then publishes it)."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if user.agent_kind is not None or limiter.too_many("lens-recipe", str(user.id)):
            return fail("too_many", 429)
        prompt = clean_text(data.get("prompt", ""), 200, keep_newlines=False)
        if not prompt or len(prompt) < 3:
            return fail("empty")
        if yipi_agents.sensitive(prompt, hard_only=True):
            return fail("not_allowed", 422)
        return jsonify({"ok": True, "recipe": yipi_lenses.make_recipe(prompt)})

    @route("/api/yipi/lenses", methods=["POST"], endpoint="yipi_lens_create")
    def yipi_lens_create():
        """Publishes a lens: a title, the prompt and a recipe (checked against the list of the effects); everybody on Nex can use it afterwards."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if user.agent_kind is not None or limiter.too_many("lens-make", str(user.id)):
            return fail("too_many", 429)
        title = clean_text(data.get("title", ""), 24, keep_newlines=False)
        prompt = clean_text(data.get("prompt", ""), 200, keep_newlines=False)
        fx, filter_name = yipi_lenses.clean_recipe(data.get("fx"), data.get("filter"))
        if not title or len(title) < 2 or not prompt or not fx:
            return fail("empty")
        if yipi_agents.sensitive(title, hard_only=True) or yipi_agents.sensitive(prompt, hard_only=True):
            return fail("not_allowed", 422)
        emoji = data.get("emoji") if isinstance(data.get("emoji"), str) else ""
        emoji = emoji.strip() if 0 < len(emoji.strip()) <= 8 and not re.search(r"[A-Za-z0-9]", emoji) else "✨"
        color = data.get("color") if isinstance(data.get("color"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", data["color"]) else "#7a2cf0"
        row = PulseLens(id="lu-" + secrets.token_hex(4), owner_id=user.id, title=title, prompt=prompt, emoji=emoji, color=color.lower(), fx=",".join(fx), filter=filter_name)
        db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True, "lens": lens_json(row, user)}), 201

    @route("/api/yipi/lenses/<lens_id>/use", methods=["POST"], endpoint="yipi_lens_use")
    def yipi_lens_use(lens_id):
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("lens-use", str(user.id)):
            return fail("too_many", 429)
        if LENS_ID_RE.fullmatch(lens_id):
            bump(PulseLens, lens_id, PulseLens.uses, 1)
            db.session.commit()
        return jsonify({"ok": True})

    @route("/api/yipi/lenses/<lens_id>", methods=["DELETE"], endpoint="yipi_lens_delete")
    def yipi_lens_delete(lens_id):
        user, problem = need_user()
        if problem:
            return problem
        row = PulseLens.query.filter_by(id=lens_id, deleted=False).first() if LENS_ID_RE.fullmatch(lens_id) else None
        if row is None:
            return fail("not_found", 404)
        if row.owner_id != user.id and not is_admin(user):
            return fail("forbidden", 403)
        row.deleted = True
        db.session.commit()
        return jsonify({"ok": True})

    # ------------------------------------------------------------------------------------------------ games of the community (levels and code)
    GAME_ID_RE = re.compile(r"gu-[0-9a-f]{8}")

    def game_json(row, viewer, owners=None, with_data=False):
        owner = (owners or {}).get(row.owner_id) or db.session.get(YipiUser, row.owner_id)
        item = {"id": row.id, "kind": row.kind, "title": row.title, "emoji": row.emoji, "color": row.color, "plays": row.plays, "user": user_brief(owner) if owner else None,
                "mine": bool(viewer and viewer.id == row.owner_id), "draft": row.draft, "createdAt": iso(row.created_at), "icon": media_url(row.icon_id)}
        if with_data:
            item["data"] = row.data
        return item

    def game_row(game_id):
        return PulseGame.query.filter(PulseGame.id == game_id, PulseGame.deleted.is_(False), PulseGame.kind.in_(yipi_games.KINDS)).first() if GAME_ID_RE.fullmatch(game_id) else None

    @route("/api/yipi/community-games")
    def yipi_games_list():
        user, problem = need_user()
        if problem:
            return problem
        sort = request.args.get("sort", "popular")
        try:
            limit = max(1, min(60, int(request.args.get("limit", "40"))))
        except ValueError:
            limit = 40
        query = PulseGame.query.filter(PulseGame.deleted.is_(False), PulseGame.draft.is_(False), PulseGame.kind.in_(yipi_games.KINDS))
        hidden = hidden_user_ids(user) | suspended_ids()
        if hidden:
            query = query.filter(~PulseGame.owner_id.in_(hidden))
        if sort == "mine":
            query = query.filter(PulseGame.owner_id == user.id)
        rows = (query.order_by(PulseGame.created_at.desc()) if sort in ("new", "mine") else query.order_by(PulseGame.plays.desc(), PulseGame.created_at.desc())).limit(limit).all()
        owners = {row.id: row for row in YipiUser.query.filter(YipiUser.id.in_({game.owner_id for game in rows}))} if rows else {}
        return jsonify({"ok": True, "items": [game_json(row, user, owners) for row in rows]})

    @route("/api/yipi/community-games/<game_id>")
    def yipi_game_get(game_id):
        user, problem = need_user()
        if problem:
            return problem
        row = game_row(game_id)
        if row is None or row.owner_id in suspended_ids() or (row.draft and row.owner_id != user.id):
            return fail("not_found", 404)
        return jsonify({"ok": True, "game": game_json(row, user, with_data=True)})

    def game_fields(data, user, kind=None):
        """((kind, title, stored, emoji, color, icon), None) from what the form sent, or (None, the answer that says what is wrong)."""
        kind = kind or data.get("kind")
        title = clean_text(data.get("title", ""), 24, keep_newlines=False)
        if kind not in yipi_games.KINDS or not title or len(title) < 2:
            return None, fail("empty")
        if yipi_agents.sensitive(title, hard_only=True):
            return None, fail("not_allowed", 422)
        stored, reason = yipi_games.clean_code(data.get("code"))
        if stored is None:
            return None, (jsonify({"ok": False, "error": "bad_code", "message": reason}), 422)
        emoji = data.get("emoji") if isinstance(data.get("emoji"), str) else ""
        emoji = emoji.strip() if 0 < len(emoji.strip()) <= 8 and not re.search(r"[A-Za-z0-9<>&\"']", emoji) else "🎮"
        color = data.get("color") if isinstance(data.get("color"), str) and re.fullmatch(r"#[0-9a-fA-F]{6}", data["color"]) else "#7a2cf0"
        icon = data.get("icon") if isinstance(data.get("icon"), str) and re.fullmatch(r"[0-9a-f]{32}", data["icon"]) else None
        if icon and YipiMedia.query.filter_by(id=icon, owner_id=user.id).first() is None:
            icon = None                                                # (only a picture that the author uploaded)
        return (kind, title, stored, emoji, color.lower(), icon), None

    @route("/api/yipi/community-games", methods=["POST"], endpoint="yipi_game_create")
    def yipi_game_create():
        """Saves a game: {kind: "code", title, emoji, code, icon}. With "draft": true it is only saved to be tried (the sealed worker serves it to its author); "publish" makes it public."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if user.agent_kind is not None or limiter.too_many("game-make", str(user.id)):
            return fail("too_many", 429)
        fields, answer = game_fields(data, user)
        if answer is not None:
            return answer
        kind, title, stored, emoji, color, icon = fields
        row = PulseGame(id="gu-" + secrets.token_hex(4), owner_id=user.id, kind=kind, title=title, emoji=emoji, color=color, data=stored, icon_id=icon, draft=data.get("draft") is True)
        db.session.add(row)
        db.session.commit()
        return jsonify({"ok": True, "game": game_json(row, user)}), 201

    @route("/api/yipi/community-games/<game_id>", methods=["PUT"], endpoint="yipi_game_update")
    def yipi_game_update(game_id):
        """The author changes a game (the builder saves the draft again before it is tried)."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        row = game_row(game_id)
        if row is None or row.owner_id != user.id:
            return fail("not_found", 404)
        if limiter.too_many("game-edit", str(user.id)):
            return fail("too_many", 429)
        fields, answer = game_fields(data, user, kind=row.kind)
        if answer is not None:
            return answer
        _kind, row.title, row.data, row.emoji, row.color, icon = fields
        if icon or data.get("icon") is None:
            row.icon_id = icon or row.icon_id
        db.session.commit()
        return jsonify({"ok": True, "game": game_json(row, user)})

    @route("/api/yipi/community-games/<game_id>/publish", methods=["POST"], endpoint="yipi_game_publish")
    def yipi_game_publish(game_id):
        user, problem = need_user()
        if problem:
            return problem
        row = game_row(game_id)
        if row is None or row.owner_id != user.id:
            return fail("not_found", 404)
        row.draft = False
        db.session.commit()
        return jsonify({"ok": True, "game": game_json(row, user)})

    @route("/api/yipi/community-games/<game_id>/play", methods=["POST"], endpoint="yipi_game_play")
    def yipi_game_play(game_id):
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("game-play", str(user.id)):
            return fail("too_many", 429)
        if GAME_ID_RE.fullmatch(game_id):
            bump(PulseGame, game_id, PulseGame.plays, 1)
            db.session.commit()
        return jsonify({"ok": True})

    @route("/api/yipi/community-games/<game_id>", methods=["DELETE"], endpoint="yipi_game_delete")
    def yipi_game_delete(game_id):
        user, problem = need_user()
        if problem:
            return problem
        row = game_row(game_id)
        if row is None:
            return fail("not_found", 404)
        if row.owner_id != user.id and not is_admin(user):
            return fail("forbidden", 403)
        row.deleted = True
        db.session.commit()
        return jsonify({"ok": True})

    @route("/api/yipi/games/ai", methods=["POST"], endpoint="yipi_game_ai")
    def yipi_game_ai():
        """The AI writes a game for a description: {prompt} -> {title, emoji, code} (the person looks at it, tries it and publishes it from the form for code)."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        prompt = clean_text(data.get("prompt", ""), 400, keep_newlines=False) if isinstance(data.get("prompt"), str) else ""
        if len(prompt) < 4:
            return fail("empty")
        if yipi_agents.sensitive(prompt, hard_only=True):
            return fail("not_allowed", 422)
        if limiter.too_many("game-ai", str(user.id)):
            return fail("too_many", 429)
        try:
            return jsonify({"ok": True, **yipi_games.ai_game(prompt, ai_assistant.generate_text, model=ai_assistant.GROQ_FALLBACK_MODEL)})
        except Exception:  # noqa: BLE001  (no key, no answer, or no game that passes the checks)
            logger.exception("The AI could not write a game")
            return fail("ai_failed", 502)

    @route("/api/yipi/game-worker/<game_id>", endpoint="yipi_game_worker")
    def yipi_game_worker(game_id):
        """The script of the sealed worker of a code game: the harness and the code. The header forbids every connection; the browser runs it in a worker without a page."""
        user, problem = need_user()
        if problem:
            return problem
        row = game_row(game_id)
        if row is None or row.kind != "code" or row.owner_id in suspended_ids() or (row.draft and row.owner_id != user.id):
            return fail("not_found", 404)
        response = make_response(yipi_games.worker_script(row.data))
        response.headers["Content-Type"] = "application/javascript; charset=utf-8"
        response.headers["Content-Security-Policy"] = yipi_games.WORKER_CSP
        response.headers["Cache-Control"] = "private, no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @route("/api/yipi/admin/storage")
    def yipi_admin_storage():
        """What takes the room: files in the database, files in R2, and (PostgreSQL) the size of the biggest tables."""
        admin, problem = need_admin()
        if problem:
            return problem
        tables = []
        for name, model in STORAGE_MODELS:
            tables.append({"name": name,
                           "inDatabase": model.query.filter(*in_database(model)).count(),
                           "bytesInDatabase": int(db.session.query(func.coalesce(func.sum(model.size), 0)).filter(*in_database(model)).scalar() or 0),
                           "inR2": model.query.filter(model.stored == "r2").count(),
                           "bytesInR2": int(db.session.query(func.coalesce(func.sum(model.size), 0)).filter(model.stored == "r2").scalar() or 0)})
        report = {"ok": True, "r2": STORE.enabled, "tables": tables, "databaseBytes": None, "tableBytes": {}}
        if db.engine.dialect.name == "postgresql":
            report["databaseBytes"] = int(db.session.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0)
            for table in STORAGE_TABLES:
                report["tableBytes"][table] = int(db.session.execute(text(f"SELECT pg_total_relation_size('{table}')")).scalar() or 0)
        return jsonify(report)

    @route("/api/yipi/admin/storage/move", methods=["POST"])
    def yipi_admin_storage_move():
        """Moves files that still sit in the database to R2, a few megabytes per call (the page calls again until nothing is left).
        Every file is read back (its size) before it is taken out of the database."""
        admin, problem = need_admin()
        if problem:
            return problem
        if not STORE.enabled:
            return fail("r2_off", 409)
        if limiter.too_many("storage", str(admin.id)):
            return fail("too_many", 429)
        budget, moved, failed = MOVE_BUDGET, 0, 0
        for name, model in STORAGE_MODELS:
            rows = model.query.options(defer(model.data)).filter(*in_database(model)).order_by(model.created_at.asc(), model.id.asc()).limit(300).all()
            for row in rows:
                if budget <= 0:
                    break
                data = db.session.query(model.data).filter_by(id=row.id).scalar() or b""
                try:
                    STORE.put(name, row.id, data, getattr(row, "content_type", None) or "image/gif")
                    if STORE.size(name, row.id) != len(data):
                        raise OSError("the file in R2 has another size")
                except Exception:  # noqa: BLE001
                    logger.exception("Could not move %s %s to R2", name, row.id)
                    failed += 1
                    continue
                model.query.filter_by(id=row.id).update({"data": b"", "stored": "r2"}, synchronize_session=False)
                budget -= len(data)
                moved += 1
            db.session.commit()
        remaining = sum(model.query.filter(*in_database(model)).count() for _name, model in STORAGE_MODELS)
        return jsonify({"ok": True, "moved": moved, "failed": failed, "remaining": remaining})

    @route("/api/yipi/admin/storage/compact", methods=["POST"])
    def yipi_admin_storage_compact():
        """Gives the room of files that were moved to R2 back to the disk (PostgreSQL: VACUUM FULL of the three file tables; they are locked for a moment)."""
        admin, problem = need_admin()
        if problem:
            return problem
        if db.engine.dialect.name != "postgresql":
            return fail("not_postgres", 409)
        if limiter.too_many("storage", str(admin.id)):
            return fail("too_many", 429)
        db.session.rollback()
        with db.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as connection:
            for table in STORAGE_TABLES[:3]:
                connection.execute(text(f"VACUUM FULL {table}"))
        return jsonify({"ok": True, "databaseBytes": int(db.session.execute(text("SELECT pg_database_size(current_database())")).scalar() or 0)})

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
        elif action == "clear_factcheck" and report.post_id:
            post = db.session.get(YipiPost, report.post_id)
            if post is not None:
                post.fact_status, post.fact_note = "ok", ""                      # "ok" so that nobody asks the AI about this post again
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
        shown = path if user or POST_PATH_RE.fullmatch(path) else "/"       # somebody who is not signed in only gets the page to sign in (or the page of a post that was sent to them)
        title, description = page_meta(shown, guest=user is None)
        boot = {"me": me_dict(user) if user else None, "google": google_ready()}
        private = path.startswith(PRIVATE_PATHS) or (user is None and path != "/")        # pages that only mean something to the person who is signed in
        bundle = pulse_bundle(app.root_path)
        games = pulse_bundle(app.root_path, "games")
        lens = pulse_bundle(app.root_path, "lens")
        return page_headers(make_response(render_template("yipi.html", boot=boot, title=title, description=description, base=base_url(), path=shown, private=private,
                                                          bundle=f"/pulse.js?v={bundle['version']}", games=f"/pulse-games.js?v={games['version']}", lens=f"/pulse-lens.js?v={lens['version']}")))

    for page in ("/explore", "/notifications", "/messages", "/bookmarks", "/settings", "/search", "/moderation", "/i/login", "/i/signup", "/i/nex", "/camera", "/videos"):
        route(page, endpoint="yipi_shell_" + page.strip("/").replace("/", "_"))(lambda page=page: render_shell(page))

    @route("/camera/<slug>")
    def yipi_page_camera_game(slug):
        if not re.fullmatch(r"[a-z0-9-]{2,30}", slug):
            abort(404)
        return render_shell(f"/camera/{slug}")

    @route("/games", endpoint="yipi_old_games")
    def yipi_old_games():
        return redirect("/camera", code=301)                      # the Games tab became the camera tab

    @route("/games/<slug>", endpoint="yipi_old_game")
    def yipi_old_game(slug):
        return redirect(f"/camera/{slug}" if re.fullmatch(r"[a-z0-9-]{2,30}", slug) else "/camera", code=301)

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
        return page_headers(make_response(render_template("legal.html", page=page, imprint=ysound.imprint(), credits=credits_list() if page == "credits" else (), rank_credits=rank_credits() if page == "credits" else ())))

    @route("/nutzungsbedingungen")
    def yipi_terms():
        return legal("terms")

    @route("/datenschutz")
    def yipi_privacy():
        return legal("privacy")

    @route("/impressum")
    def yipi_imprint():
        return legal("imprint")

    @route("/bildnachweise")
    def yipi_credits():
        return legal("credits")

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
