import uuid
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

db = SQLAlchemy()


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    public_id = db.Column(db.String(36), unique=True, nullable=False, default=lambda: str(uuid.uuid4()))
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=True)
    # Set only for accounts created/linked via "Mit Google fortfahren" --
    # Google's stable per-user id (the id_token/userinfo "sub" claim), used
    # to recognize a returning Google sign-in independent of the email
    # address (which a user could change on Google's side).
    google_sub = db.Column(db.String(64), unique=True, nullable=True)
    birthdate = db.Column(db.Date, nullable=True)
    gender = db.Column(db.String(20), nullable=True)
    purpose_of_use = db.Column(db.String(20), nullable=True)
    country = db.Column(db.String(100), nullable=True)
    region = db.Column(db.String(100), nullable=True)
    region_skipped = db.Column(db.Boolean, nullable=False, default=False)
    guardian_email = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_pixel_at = db.Column(db.DateTime, nullable=True)
    last_app_share_at = db.Column(db.DateTime, nullable=True)
    profile_image = db.Column(db.String(255), nullable=True)
    total_score = db.Column(db.BigInteger, nullable=False, default=0)
    is_admin = db.Column(db.Boolean, nullable=False, default=False)
    last_seen = db.Column(db.DateTime, nullable=True)
    current_streak = db.Column(db.Integer, nullable=False, default=0)
    best_streak = db.Column(db.Integer, nullable=False, default=0)
    last_streak_date = db.Column(db.Date, nullable=True)
    points_earned_today = db.Column(db.BigInteger, nullable=False, default=0)
    points_today_date = db.Column(db.Date, nullable=True)
    organic_points_earned = db.Column(db.BigInteger, nullable=False, default=0)
    ever_rank_one = db.Column(db.Boolean, nullable=False, default=False)
    coinflip_coins = db.Column(db.Integer, nullable=False, default=1)
    coinflip_worker_count = db.Column(db.Integer, nullable=False, default=0)
    coinflip_rebirths = db.Column(db.Integer, nullable=False, default=0)
    terms_accepted_at = db.Column(db.DateTime, nullable=True)
    # Which version of the terms (see app.py's TERMS_VERSION) this user last
    # accepted -- the terms gate re-triggers for EVERY registered account,
    # not just new ones, whenever TERMS_VERSION is bumped after a real
    # content change, since accepting an old version isn't the same as
    # accepting the current one.
    terms_accepted_version = db.Column(db.Integer, nullable=True)
    # Rolling average of ms between keystrokes across this user's own past
    # chat messages -- lets the AI notice when a single message was typed
    # unusually fast/slow *for this specific person*.
    avg_typing_interval_ms = db.Column(db.Float, nullable=True)
    typing_sample_count = db.Column(db.Integer, nullable=False, default=0)
    # AI tokens -- shown as a cosmetic balance in the Nex sidebar; no route
    # currently deducts from it (see app.py's user_has_unlimited_ai_tokens),
    # kept only so the number stays meaningful if gating is ever reinstated.
    ai_tokens = db.Column(db.Integer, nullable=True)
    ai_tokens_last_award_date = db.Column(db.Date, nullable=True)
    # Vestigial -- from when Nex had multiple switchable personas. Nothing
    # reads or writes these anymore (single blunt "Nex" persona today), kept
    # only because dropping a column means a migration, not because they're
    # used. See ai_assistant.py's single SYSTEM_PROMPT for the real behavior.
    nex7_persona = db.Column(db.String(20), nullable=True)
    nex_custom_name = db.Column(db.String(40), nullable=True)
    nex_custom_personality = db.Column(db.Text, nullable=True)
    nex_custom_act = db.Column(db.Text, nullable=True)
    nex_plugins = db.Column(db.Text, nullable=True)
    # Free-text short bio -- vestigial now that there's no profile page.
    bio = db.Column(db.String(300), nullable=True)
    # Editable display name ("Spitzname") + avatar image (filename under
    # static/uploads/pl, or a PlMedia row name -- see app.py's
    # _pl_media_url). pl_banner_image is vestigial (no profile page shows
    # it anymore) but kept so existing rows aren't silently orphaned.
    pl_display_name = db.Column(db.String(50), nullable=True)
    pl_avatar_image = db.Column(db.String(255), nullable=True)
    pl_banner_image = db.Column(db.String(255), nullable=True)
    # city is free-text (e.g. "München-Pasing"). is_company/company_name/
    # company_address are legacy: the last real consumer (Chepal's company
    # offer-management, and briefly Mini Job's company job-postings) was
    # deleted 2026-09-06 along with register_company() itself, but existing
    # accounts that were created as a company still have is_company=True in
    # the database (never proactively dropped, see app.py's
    # user_needs_onboarding for the one remaining reader) -- kept purely
    # for that backward compatibility, not writable by anything anymore.
    city = db.Column(db.String(100), nullable=True)
    is_company = db.Column(db.Boolean, nullable=False, default=False)
    company_name = db.Column(db.String(200), nullable=True)
    company_address = db.Column(db.String(300), nullable=True)
    # ychat "live" status (see app.py's /api/ychat/live routes). This app
    # has no streaming infrastructure of its own (no RTMP ingest, no
    # transcoding, no CDN -- building that is a project on its own, not
    # a feature) -- ychat_live_video_id is instead the video id of a
    # REAL live broadcast the user is running on YouTube Live (free,
    # no API key needed), extracted server-side from the youtube.com/
    # watch or youtu.be URL they paste in. Embedding it uses the exact
    # same official youtube.com/embed/<id> player NRS already uses for
    # regular videos -- a live broadcast is just a video that happens to
    # be live, same embed mechanism, genuinely real video either way.
    ychat_is_live = db.Column(db.Boolean, nullable=False, default=False)
    ychat_live_title = db.Column(db.String(100), nullable=True)
    ychat_live_video_id = db.Column(db.String(20), nullable=True)
    subscriptions_made = db.relationship(
        "Subscription",
        foreign_keys="Subscription.subscriber_id",
        backref="subscriber",
        lazy=True,
        cascade="all, delete-orphan",
    )
    subscribers = db.relationship(
        "Subscription",
        foreign_keys="Subscription.channel_id",
        backref="channel",
        lazy=True,
        cascade="all, delete-orphan",
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class ErrorLog(db.Model):
    """One unhandled exception the live site hit -- caught by app.py's
    global error handler and shown in the admin dashboard, so problems
    (including things like a Groq outage/rate limit breaking the AI chat)
    are visible instead of only living in server logs nobody is watching."""
    id = db.Column(db.Integer, primary_key=True)
    path = db.Column(db.String(255), nullable=True)
    method = db.Column(db.String(10), nullable=True)
    message = db.Column(db.Text, nullable=False)
    traceback = db.Column(db.Text, nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")


class Subscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    subscriber_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    channel_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    __table_args__ = (db.UniqueConstraint("subscriber_id", "channel_id", name="uq_sub_subscriber_channel"),)


class PlMedia(db.Model):
    """Persistent store for HEXAGONUM avatars / attachments when Cloudflare
    R2 is NOT configured. Railway's local disk is wiped on every deploy, so
    without this the images vanish on each push; Postgres survives. When R2
    *is* configured, uploads go there instead and this table stays empty."""
    __tablename__ = "pl_media"
    name = db.Column(db.String(64), primary_key=True)      # "<uuid>.<ext>"
    content_type = db.Column(db.String(90), nullable=False)
    data = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


# ==========================================================================
# Nex -- the app's single AI chat (ChatGPT-style: a sidebar of saved
# conversations per user, each holding an ordered list of user/assistant
# turns). See ai_assistant.py for the actual Groq call.
# ==========================================================================

class AiChat(db.Model):
    """One saved conversation with Nex. Only ever read back for the same
    user who owns it -- never used to influence another user's replies."""
    __tablename__ = "ai_chat"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    title = db.Column(db.String(100), nullable=True)
    # `mode` is vestigial (from an earlier code-chat setup that no longer
    # exists) -- kept with a DB-level default only so inserts against the
    # still-existing production column keep succeeding, nothing reads or
    # writes it anymore. `character` is live again: the persona key this
    # chat talks to (see ai_assistant.PERSONAS), set on chat creation and
    # switchable via PATCH /api/ai/chats/<id>.
    mode = db.Column(db.String(20), nullable=False, default="general")
    character = db.Column(db.String(20), nullable=False, default="nex")
    # AI-generated guess at what the user will probably type next, re-
    # generated after every turn (see ai_assistant.generate_next_suggestion)
    # -- shown as ghost text in the empty compose line instead of a random
    # static example once a chat actually has content to read.
    next_suggestion = db.Column(db.String(200), nullable=True)
    specialize_prompted = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")
    messages = db.relationship(
        "AiChatMessage", backref="chat", lazy=True, cascade="all, delete-orphan",
        order_by="AiChatMessage.created_at",
    )


class AiChatMessage(db.Model):
    __tablename__ = "ai_chat_message"
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("ai_chat.id"), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


# ==========================================================================
# Teams -- a shared space where several people write together, with Nex
# joining in whenever someone @-mentions it (see app.py's /api/teams
# routes). Kept live in sync across members by short polling
# (GET .../messages?after=<id>) rather than websockets -- simple, and
# safe on Railway's default multi-worker gunicorn setup without needing
# a shared message broker for cross-worker pub/sub.
# ==========================================================================

class Team(db.Model):
    __tablename__ = "team"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(60), nullable=False)
    invite_code = db.Column(db.String(16), unique=True, nullable=False)
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class TeamMember(db.Model):
    __tablename__ = "team_member"
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey("team.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    joined_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    # Bumped by POST /api/teams/<id>/typing while this member has text in
    # the compose box; a poll response reports a member as "typing" only
    # while this is within the last few seconds (see app.py's
    # _TYPING_WINDOW_SECONDS) -- naive UTC like integrations.py's
    # token_expires_at, for the same SQLite-vs-aware-datetime reason.
    typing_at = db.Column(db.DateTime, nullable=True)
    __table_args__ = (db.UniqueConstraint("team_id", "user_id", name="uq_team_member_team_user"),)


class TeamMessage(db.Model):
    __tablename__ = "team_message"
    id = db.Column(db.Integer, primary_key=True)
    team_id = db.Column(db.Integer, db.ForeignKey("team.id"), nullable=False)
    # NULL for a Nex/assistant message (role="assistant" marks those too --
    # both together so a serializer can tell the author without a join).
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    role = db.Column(db.String(20), nullable=False, default="user")
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class UserIntegration(db.Model):
    """One third-party account a user has connected via OAuth (see
    app.py's /plugins/<service>/... routes) -- Nex can read from it (a
    Google Calendar lookup, for now) when the user's message plausibly
    calls for it. `service` is a short key ("google" for now, room for
    more once a user provides credentials for another provider's OAuth
    app -- see ai_assistant.py/app.py for why those can't be added
    without that). Tokens sit in the same trust boundary as the rest of
    this DB (password hashes, session data) -- never serialized back to
    any API response, only used server-side, and dropped entirely on
    disconnect."""
    __tablename__ = "user_integration"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    service = db.Column(db.String(30), nullable=False)
    access_token = db.Column(db.Text, nullable=False)
    refresh_token = db.Column(db.Text, nullable=True)
    token_expires_at = db.Column(db.DateTime, nullable=True)
    scopes = db.Column(db.Text, nullable=True)
    connected_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    __table_args__ = (db.UniqueConstraint("user_id", "service", name="uq_user_integration_user_service"),)


class NrsHistoryEntry(db.Model):
    """One page visited in NRS (see app.py's /api/nrs/history routes and
    static/js/pinklemon-nrs.js) -- written on every real navigation (not
    on a back/forward replay, which revisits a URL already in the list).
    Purely a per-user visited-pages log; NRS itself never reads or
    relays the traffic those visits represent, only records the URL the
    user's own browser already went to directly."""
    __tablename__ = "nrs_history_entry"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    url = db.Column(db.Text, nullable=False)
    title = db.Column(db.String(255), nullable=True)
    visited_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class NrsSite(db.Model):
    """A user-made mini "site" -- a saved, self-contained HTML/CSS/JS
    snippet (same idea as Nex's own nexpreview artifacts) addressable by
    typing its made-up "<slug>.nrs" address into NRS's own address bar
    (see app.py's /api/nrs/sites routes and static/js/pinklemon-nrs.js).
    .nrs is not a real TLD and this never touches the real internet --
    it's a small closed "build and visit your own site" feature, and it
    renders via iframe.srcdoc (not .src, there's no real URL involved)
    sandboxed WITHOUT allow-same-origin, same as nexpreview, so one
    user's saved code can never read another's cookies/storage/session
    even though (unlike nexpreview) any logged-in user can visit any
    slug, not just its owner."""
    __tablename__ = "nrs_site"
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    slug = db.Column(db.String(63), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    html_code = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


# ==========================================================================
# ychat -- a shared post feed, every logged-in user's own design/branding
# (not a copy of any real platform's look), replacing NRS as the site's
# main page (2026-09-19). See app.py's /api/ychat/... routes.
# ==========================================================================

class YchatPost(db.Model):
    __tablename__ = "ychat_post"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    content = db.Column(db.String(280), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class YchatLike(db.Model):
    __tablename__ = "ychat_like"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("ychat_post.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    __table_args__ = (db.UniqueConstraint("post_id", "user_id", name="uq_ychat_like_post_user"),)


class YlibItem(db.Model):
    """One item in a user's personal ylib library (see app.py's
    /api/ylib/items and /api/ylib/youtube routes), shown in a
    YouTube-style grid. Private to its owner, not a shared feed. Two
    sources:
    - "upload": a file the owner chose explicitly, stored via the same
      _pl_store_media/PlMedia mechanism as avatars (media_name/
      content_type set, youtube_video_id empty).
    - "youtube": a reference to a real YouTube video the owner linked --
      NOT a downloaded copy. Actually downloading and rehosting YouTube
      videos would mean redistributing other creators' copyrighted work,
      which violates YouTube's Terms of Service and copyright law, so
      this app never fetches or stores the video itself. Instead it
      keeps the video id and renders it through YouTube's own official
      embed player/thumbnail CDN (media_name/content_type empty)."""
    __tablename__ = "ylib_item"
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    source = db.Column(db.String(10), nullable=False, default="upload")  # "upload" or "youtube"
    media_name = db.Column(db.String(64), nullable=False, default="")    # PlMedia.name / R2 key -- upload only
    content_type = db.Column(db.String(90), nullable=False, default="")  # upload only
    kind = db.Column(db.String(10), nullable=False)         # "image" or "video"
    youtube_video_id = db.Column(db.String(20), nullable=True)  # youtube only
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
