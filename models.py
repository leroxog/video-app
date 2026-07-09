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
    total_score = db.Column(db.Integer, nullable=False, default=0)
    is_admin = db.Column(db.Boolean, nullable=False, default=False)
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


class Like(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    video_id = db.Column(db.Integer, db.ForeignKey("video.id"), nullable=False)
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


class GamePlayCount(db.Model):
    game_key = db.Column(db.String(30), primary_key=True)
    count = db.Column(db.Integer, nullable=False, default=0)


class Sound(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
