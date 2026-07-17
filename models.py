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
    birthdate = db.Column(db.Date, nullable=True)
    gender = db.Column(db.String(20), nullable=True)
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
    posts = db.relationship("Post", backref="uploader", lazy=True, cascade="all, delete-orphan")
    post_likes_given = db.relationship("PostLike", backref="liker", lazy=True, cascade="all, delete-orphan")
    post_comments_made = db.relationship("PostComment", backref="author", lazy=True, cascade="all, delete-orphan")
    sounds_uploaded = db.relationship("Sound", backref="uploader", lazy=True, cascade="all, delete-orphan")
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


class Post(db.Model):
    """A photo post -- can have one or many photos, swipeable in the feed."""
    id = db.Column(db.Integer, primary_key=True)
    caption = db.Column(db.Text, nullable=True)
    hashtags = db.Column(db.Text, nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    photos = db.relationship(
        "PostPhoto", backref="post", lazy=True, cascade="all, delete-orphan",
        order_by="PostPhoto.position",
    )
    likes = db.relationship("PostLike", backref="post", lazy=True, cascade="all, delete-orphan")
    comments = db.relationship(
        "PostComment", backref="post", lazy=True, cascade="all, delete-orphan",
        order_by="PostComment.created_at",
    )
    reports = db.relationship(
        "PostReport", backref="post", lazy=True, cascade="all, delete-orphan",
        order_by="PostReport.created_at",
    )


class PostPhoto(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    position = db.Column(db.Integer, nullable=False, default=0)
    content_hash = db.Column(db.String(64), nullable=True, index=True)


class PostReport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    reporter = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("post_id", "reporter_id", name="uq_postreport_post_reporter"),)


class PostLike(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    points_awarded = db.Column(db.Integer, nullable=False, default=0)
    __table_args__ = (db.UniqueConstraint("user_id", "post_id", name="uq_postlike_user_post"),)


class PostComment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=False)
    text = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class Subscription(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    subscriber_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    channel_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    __table_args__ = (db.UniqueConstraint("subscriber_id", "channel_id", name="uq_sub_subscriber_channel"),)


class CoinflipDeposit(db.Model):
    """The "offline"/idle coin.flip gadget: stake points for a chosen
    duration; once matured, a random 1.1x-1.6x payout can be collected
    within a 15-minute window, after which it's forfeited."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    staked_amount = db.Column(db.Integer, nullable=False)
    started_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    matures_at = db.Column(db.DateTime, nullable=False)
    collected = db.Column(db.Boolean, nullable=False, default=False)
    user = db.relationship("User")


class MemeTemplate(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    active = db.Column(db.Boolean, nullable=False, default=True)


class MemeLobby(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(6), unique=True, nullable=False, index=True)
    leader_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    max_players = db.Column(db.Integer, nullable=False, default=11)
    round_seconds = db.Column(db.Integer, nullable=False, default=70)
    template_cost = db.Column(db.Integer, nullable=False, default=100)
    # waiting -> round -> voting -> results -> (round again on rematch)
    status = db.Column(db.String(20), nullable=False, default="waiting")
    round_number = db.Column(db.Integer, nullable=False, default=0)
    round_started_at = db.Column(db.DateTime, nullable=True)
    voting_started_at = db.Column(db.DateTime, nullable=True)
    results_awarded = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    leader = db.relationship("User")
    players = db.relationship(
        "MemeLobbyPlayer", backref="lobby", lazy=True, cascade="all, delete-orphan",
        order_by="MemeLobbyPlayer.joined_at",
    )
    creations = db.relationship("MemeCreation", backref="lobby", lazy=True, cascade="all, delete-orphan")


class MemeLobbyPlayer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey("meme_lobby.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    joined_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    current_template_id = db.Column(db.Integer, db.ForeignKey("meme_template.id"), nullable=True)
    wants_rematch = db.Column(db.Boolean, nullable=False, default=False)
    user = db.relationship("User")
    current_template = db.relationship("MemeTemplate")
    __table_args__ = (db.UniqueConstraint("lobby_id", "user_id", name="uq_memelobbyplayer_lobby_user"),)


class MemeCreation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    lobby_id = db.Column(db.Integer, db.ForeignKey("meme_lobby.id"), nullable=False)
    round_number = db.Column(db.Integer, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")
    votes = db.relationship("MemeVote", backref="creation", lazy=True, cascade="all, delete-orphan")
    __table_args__ = (
        db.UniqueConstraint("lobby_id", "round_number", "user_id", name="uq_memecreation_lobby_round_user"),
    )


class MemeVote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    creation_id = db.Column(db.Integer, db.ForeignKey("meme_creation.id"), nullable=False)
    voter_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    value = db.Column(db.Boolean, nullable=False)
    __table_args__ = (db.UniqueConstraint("creation_id", "voter_id", name="uq_memevote_creation_voter"),)


class Pixel(db.Model):
    x = db.Column(db.Integer, primary_key=True)
    y = db.Column(db.Integer, primary_key=True)
    color = db.Column(db.String(7), nullable=False, default="#ffffff")
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class RedeemedCode(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    code = db.Column(db.String(64), nullable=False)
    redeemed_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    __table_args__ = (db.UniqueConstraint("user_id", "code", name="uq_redeemed_user_code"),)


class UserCreatedCode(db.Model):
    """A player-created gift code. Single-use across the whole site (not
    per-account like the static promo codes) -- once redeemed_by_id is
    set, the code is spent for good. Never expose creator_id publicly;
    codes are meant to be anonymous."""
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), unique=True, nullable=False, index=True)
    original_points = db.Column(db.Integer, nullable=False)
    points_value = db.Column(db.Integer, nullable=False)
    creator_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    redeemed_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    redeemed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class GamePlayCount(db.Model):
    game_key = db.Column(db.String(30), primary_key=True)
    count = db.Column(db.Integer, nullable=False, default=0)


class Sound(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class Conversation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    is_group = db.Column(db.Boolean, nullable=False, default=False)
    group_name = db.Column(db.String(100), nullable=True)
    created_by = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    members = db.relationship(
        "ConversationMember", backref="conversation", lazy=True, cascade="all, delete-orphan",
    )
    messages = db.relationship(
        "Message", backref="conversation", lazy=True, cascade="all, delete-orphan",
        order_by="Message.created_at",
    )


class ConversationMember(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey("conversation.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    user = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("conversation_id", "user_id", name="uq_conv_member"),)


class Message(db.Model):
    """Messages self-delete 15 seconds after first being viewed by a
    recipient (viewed_at set on read, row purged lazily on next fetch)."""
    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, db.ForeignKey("conversation.id"), nullable=False)
    sender_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    text = db.Column(db.Text, nullable=True)
    shared_post_id = db.Column(db.Integer, db.ForeignKey("post.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    viewed_at = db.Column(db.DateTime, nullable=True)
    sender = db.relationship("User", foreign_keys=[sender_id])


class StudioProject(db.Model):
    """A user-built 2D game from timeskip studio. Publishing makes it show
    up as a normal game in the games list. script_code is the single,
    project-wide DSL program -- each rule inside it names the block it
    applies to, rather than every block carrying its own script."""
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    published = db.Column(db.Boolean, nullable=False, default=False)
    script_code = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    owner = db.relationship("User")
    blocks = db.relationship(
        "StudioBlock", backref="project", lazy=True, cascade="all, delete-orphan",
        order_by="StudioBlock.id",
    )


class StudioBlock(db.Model):
    """A rectangular game object on a studio project's 2D canvas. x/y/width
    /height are its design-time (spawn) placement. kind is "normal",
    "spawn" (the always-present, non-deletable player spawn point -- looks
    like a normal block), or "checkpoint" (touching it moves the player's
    respawn point there)."""
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey("studio_project.id"), nullable=False)
    name = db.Column(db.String(50), nullable=False)
    is_default = db.Column(db.Boolean, nullable=False, default=False)
    kind = db.Column(db.String(20), nullable=False, default="normal")
    x = db.Column(db.Integer, nullable=False, default=40)
    y = db.Column(db.Integer, nullable=False, default=40)
    width = db.Column(db.Integer, nullable=False, default=140)
    height = db.Column(db.Integer, nullable=False, default=40)
    color = db.Column(db.String(20), nullable=False, default="#3ea6ff")
    __table_args__ = (db.UniqueConstraint("project_id", "name", name="uq_studioblock_project_name"),)
