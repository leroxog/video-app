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
    # unusually fast/slow *for this specific person*, see api_ai_chat's
    # typing_avg_interval_ms handling and AiLearnedFact's module docstring.
    avg_typing_interval_ms = db.Column(db.Float, nullable=True)
    typing_sample_count = db.Column(db.Integer, nullable=False, default=0)
    # AI tokens (see app.py's TOKEN_COST_* / _grant_daily_tokens) -- a
    # completely separate currency from total_score ("Punkte"): spent on
    # AI actions (chat, voice, image generation), topped up +900 for every
    # day the account is used, nullable so an existing account's first
    # visit after this shipped can be told apart from someone who's
    # genuinely already spent down to 0.
    ai_tokens = db.Column(db.Integer, nullable=True)
    ai_tokens_last_award_date = db.Column(db.Date, nullable=True)
    # Which of the 5 Nex7 personalities this user's AI is currently set to
    # (see app.py NEX7_PERSONAS): "nex", "seven", "ehrgeizig", "ruhig",
    # "chaos". None == not chosen yet == treated as "nex".
    nex7_persona = db.Column(db.String(20), nullable=True)
    # Free-text short bio shown on the profile / next to posts.
    bio = db.Column(db.String(300), nullable=True)
    # HEXAGONUM profile: editable display name ("Spitzname", shown big
    # everywhere instead of @username) + own avatar / banner images
    # (filenames under static/uploads/pl).
    pl_display_name = db.Column(db.String(50), nullable=True)
    pl_avatar_image = db.Column(db.String(255), nullable=True)
    pl_banner_image = db.Column(db.String(255), nullable=True)
    # Nex slash commands (/name, /personality, /act) -- per-user overrides
    # spliced into Nex's prompt context, see _pl_nex_overrides_block.
    nex_custom_name = db.Column(db.String(40), nullable=True)
    nex_custom_personality = db.Column(db.Text, nullable=True)
    nex_custom_act = db.Column(db.Text, nullable=True)
    # JSON list of NEX_PLUGIN_CATALOG keys (see ai_assistant.py) this user
    # has switched on -- see app.py's /api/pl/nex/plugins.
    nex_plugins = db.Column(db.Text, nullable=True)
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


# ==========================================================================
# pinklemon "Freunde" -- WhatsApp-style chats. You can only DM someone once
# you follow each other (Subscription both ways). Groups have no such rule
# but members must be picked from your mutual follows. Own `pl_*` tables --
# the legacy conversation/message tables carried disappearing-message
# behaviour we don't want here.
# ==========================================================================

class PlChat(db.Model):
    __tablename__ = "pl_chat"
    id = db.Column(db.Integer, primary_key=True)
    is_group = db.Column(db.Boolean, nullable=False, default=False)
    name = db.Column(db.String(80), nullable=True)          # groups only
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_activity = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    # A PlChat doubles as a server *channel* when server_id is set (2026-09-11)
    # -- reuses every existing message feature (reactions, replies, edit,
    # pins, typing) for free instead of building a parallel system. Access
    # still goes through PlChatMember like any other chat: joining a server
    # (or a channel being created) adds one PlChatMember row per member, see
    # _pl_server_sync_channel_membership.
    server_id = db.Column(db.Integer, db.ForeignKey("pl_server.id"), nullable=True)
    topic = db.Column(db.String(300), nullable=True)
    position = db.Column(db.Integer, nullable=False, default=0)

    members = db.relationship("PlChatMember", backref="chat", lazy=True, cascade="all, delete-orphan")
    messages = db.relationship(
        "PlMessage", backref="chat", lazy=True, cascade="all, delete-orphan",
        order_by="PlMessage.created_at",
    )


class PlServer(db.Model):
    """A Discord-style "server"/guild: a persistent community with its own
    channels (see PlChat.server_id), roles and members. Kept deliberately
    simple next to real Discord: server-wide role permissions only, no
    per-channel permission overwrites -- that's a whole further layer of
    complexity real Discord has that isn't attempted here."""
    __tablename__ = "pl_server"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
    icon_image = db.Column(db.String(255), nullable=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    invite_code = db.Column(db.String(12), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    # Discoverable in the "Könntest du kennen?!" onboarding step (see
    # app.py's /api/pl/servers/suggested) -- off by default, an owner opts
    # a server in via /api/pl/servers/<id>/visibility.
    is_public = db.Column(db.Boolean, nullable=False, default=False)

    channels = db.relationship(
        "PlChat", backref="server", lazy=True,
        order_by="PlChat.position", primaryjoin="PlServer.id == PlChat.server_id",
    )
    roles = db.relationship(
        "PlRole", backref="server", lazy=True, cascade="all, delete-orphan",
        order_by="PlRole.position",
    )
    members = db.relationship("PlServerMember", backref="server", lazy=True, cascade="all, delete-orphan")
    owner = db.relationship("User")


# All permissions a role can grant. The server owner implicitly has every
# permission regardless of roles, same as Discord.
PL_SERVER_PERMISSIONS = (
    "manage_server", "manage_channels", "manage_roles",
    "manage_messages", "kick_members", "ban_members", "create_invite",
)


class PlRole(db.Model):
    __tablename__ = "pl_role"
    id = db.Column(db.Integer, primary_key=True)
    server_id = db.Column(db.Integer, db.ForeignKey("pl_server.id"), nullable=False)
    name = db.Column(db.String(50), nullable=False)
    color = db.Column(db.String(7), nullable=False, default="#99aab5")
    permissions = db.Column(db.Text, nullable=False, default="[]")  # JSON list of PL_SERVER_PERMISSIONS
    position = db.Column(db.Integer, nullable=False, default=0)
    # The auto-created role every member gets on joining (like @everyone) --
    # exactly one per server, never deletable.
    is_default = db.Column(db.Boolean, nullable=False, default=False)


class PlServerMember(db.Model):
    __tablename__ = "pl_server_member"
    id = db.Column(db.Integer, primary_key=True)
    server_id = db.Column(db.Integer, db.ForeignKey("pl_server.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    nickname = db.Column(db.String(50), nullable=True)
    joined_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")
    roles = db.relationship("PlRole", secondary="pl_server_member_role", lazy=True)
    __table_args__ = (db.UniqueConstraint("server_id", "user_id", name="uq_plservermember"),)


pl_server_member_role = db.Table(
    "pl_server_member_role",
    db.Column("member_id", db.Integer, db.ForeignKey("pl_server_member.id"), primary_key=True),
    db.Column("role_id", db.Integer, db.ForeignKey("pl_role.id"), primary_key=True),
)


class PlServerBan(db.Model):
    __tablename__ = "pl_server_ban"
    id = db.Column(db.Integer, primary_key=True)
    server_id = db.Column(db.Integer, db.ForeignKey("pl_server.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    banned_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    __table_args__ = (db.UniqueConstraint("server_id", "user_id", name="uq_plserverban"),)


class PlChatMember(db.Model):
    __tablename__ = "pl_chat_member"
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("pl_chat.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    joined_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_read_id = db.Column(db.Integer, nullable=False, default=0)
    user = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("chat_id", "user_id", name="uq_plchatmember"),)


class PlMessage(db.Model):
    __tablename__ = "pl_message"
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("pl_chat.id"), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    text = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    att_kind = db.Column(db.String(12), nullable=True)
    att_value = db.Column(db.String(255), nullable=True)
    sender = db.relationship("User")
    # Discord-style extras (2026-09-11): reply-to, edit/delete, pinning.
    # reply_to_id has no FK ondelete cascade -- a reply survives its parent
    # being deleted, see _pl_serialize_message's "deleted" fallback text.
    reply_to_id = db.Column(db.Integer, db.ForeignKey("pl_message.id"), nullable=True)
    reply_to = db.relationship("PlMessage", remote_side=[id])
    edited_at = db.Column(db.DateTime, nullable=True)
    pinned_at = db.Column(db.DateTime, nullable=True)
    reactions = db.relationship("PlMessageReaction", backref="message", lazy=True, cascade="all, delete-orphan")


class PlMessageReaction(db.Model):
    __tablename__ = "pl_message_reaction"
    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("pl_message.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    emoji = db.Column(db.String(16), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("message_id", "user_id", "emoji", name="uq_plmsgreaction"),)


class PlMedia(db.Model):
    """Persistent store for HEXAGONUM avatars / banners / attachments when
    Cloudflare R2 is NOT configured. Railway's local disk is wiped on
    every deploy, so without this the images vanish on each push; Postgres
    survives. When R2 *is* configured, uploads go there instead and this
    table stays empty."""
    __tablename__ = "pl_media"
    name = db.Column(db.String(64), primary_key=True)      # "<uuid>.<ext>"
    content_type = db.Column(db.String(90), nullable=False)
    data = db.Column(db.LargeBinary, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


# ==========================================================================
# pinklemon "Stories" -- Snapchat-style: one photo, visible to your mutual
# follows for 24h, then simply excluded from queries (no cron needed).
# ==========================================================================

class PlStory(db.Model):
    __tablename__ = "pl_story"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    media_name = db.Column(db.String(64), nullable=False)
    media_kind = db.Column(db.String(10), nullable=False, default="image")
    caption = db.Column(db.String(300), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    user = db.relationship("User")
    views = db.relationship("PlStoryView", backref="story", cascade="all, delete-orphan")


class PlStoryView(db.Model):
    __tablename__ = "pl_story_view"
    id = db.Column(db.Integer, primary_key=True)
    story_id = db.Column(db.Integer, db.ForeignKey("pl_story.id"), nullable=False)
    viewer_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    viewed_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    viewer = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("story_id", "viewer_id", name="uq_plstoryview_story_viewer"),)

