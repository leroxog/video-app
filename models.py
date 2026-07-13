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
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_pixel_at = db.Column(db.DateTime, nullable=True)
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
    videos = db.relationship("Video", backref="uploader", lazy=True, cascade="all, delete-orphan")
    likes_given = db.relationship("Like", backref="liker", lazy=True, cascade="all, delete-orphan")
    comments_made = db.relationship("Comment", backref="author", lazy=True, cascade="all, delete-orphan")
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


class Video(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    filename = db.Column(db.String(255), nullable=False)
    orientation = db.Column(db.String(10), nullable=False, default="landscape")
    content_hash = db.Column(db.String(64), nullable=True, index=True)
    duplicate_penalty_applied = db.Column(db.Boolean, nullable=False, default=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    likes = db.relationship("Like", backref="video", lazy=True, cascade="all, delete-orphan")
    comments = db.relationship(
        "Comment", backref="video", lazy=True, cascade="all, delete-orphan",
        order_by="Comment.created_at",
    )
    reports = db.relationship(
        "VideoReport", backref="video", lazy=True, cascade="all, delete-orphan",
        order_by="VideoReport.created_at",
    )


class VideoReport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    video_id = db.Column(db.Integer, db.ForeignKey("video.id"), nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    reporter = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("video_id", "reporter_id", name="uq_report_video_reporter"),)


class Like(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    video_id = db.Column(db.Integer, db.ForeignKey("video.id"), nullable=False)
    points_awarded = db.Column(db.Integer, nullable=False, default=0)
    __table_args__ = (db.UniqueConstraint("user_id", "video_id", name="uq_like_user_video"),)


class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    video_id = db.Column(db.Integer, db.ForeignKey("video.id"), nullable=False)
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
    shared_video_id = db.Column(db.Integer, db.ForeignKey("video.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    viewed_at = db.Column(db.DateTime, nullable=True)
    sender = db.relationship("User", foreign_keys=[sender_id])
