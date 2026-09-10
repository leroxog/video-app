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


class PasswordResetCode(db.Model):
    """A 6-digit, 15-minute, single-use code for the "forgot password or
    username" flow -- issued either by /forgot-password/send-code (emailed
    to the address the user has on file) or by an admin approving an
    AccountRecoveryRequest (shown to the admin to relay manually, for
    accounts with no email on file). Requesting a fresh code doesn't
    delete the old row, it's simply superseded -- the redemption lookup
    always takes the newest unused, unexpired code for a user."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    code = db.Column(db.String(6), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = db.Column(db.DateTime, nullable=False)
    used = db.Column(db.Boolean, nullable=False, default=False)
    user = db.relationship("User")


class AccountRecoveryRequest(db.Model):
    """A manual account-recovery request from someone who has no email on
    file (so the automated emailed-code flow isn't possible) -- shown in
    the admin dashboard for a human to approve or deny. Approving issues a
    PasswordResetCode the admin relays to the person themselves, through
    whatever channel they used to verify who they are; NexAI's own
    systems never contact anyone on the requester's behalf here."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    submitted_username = db.Column(db.String(50), nullable=True)
    message = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(20), nullable=False, default="pending")
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    resolved_at = db.Column(db.DateTime, nullable=True)
    user = db.relationship("User")


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
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    viewed_at = db.Column(db.DateTime, nullable=True)
    sender = db.relationship("User", foreign_keys=[sender_id])


class StudioProject(db.Model):
    """A user-built project from NexAI studio -- either a 2D game
    (project_type "game", publishing makes it show up in the games list) or
    a Web-in-Web-App (project_type "webapp", publishing makes it reachable
    at /w/<web_slug>, sandboxed, see api_report_studio_project for its
    shared report flow). script_code is the single, project-wide DSL
    program for games -- each rule inside it names the block it applies
    to, rather than every block carrying its own script. web_code is the
    freeform HTML/CSS/JS a webapp project's owner writes from scratch."""
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    published = db.Column(db.Boolean, nullable=False, default=False)
    project_type = db.Column(db.String(20), nullable=False, default="game")
    script_code = db.Column(db.Text, nullable=True)
    web_code = db.Column(db.Text, nullable=True)
    web_slug = db.Column(db.String(50), nullable=True, unique=True)
    # The web_code value right before the most recent AI-driven change was
    # applied -- lets the editor's "letzten KI-Schritt zurücksetzen" button
    # undo exactly one step, no matter what that step touched. Overwritten
    # (not stacked) on every new AI change, so it only ever holds one level.
    previous_web_code = db.Column(db.Text, nullable=True)
    # App-store-style icon for a Web-in-Web-App -- shown on its card instead
    # of the generic globe placeholder, wherever project cards are listed.
    icon_image = db.Column(db.String(255), nullable=True)
    # Creator-set age rating shown on the app-store-style card ("+N"),
    # 0-17 -- an honest self-declared estimate like a real app store's,
    # not moderated/verified by anyone.
    age_rating = db.Column(db.Integer, nullable=False, default=0)
    # Which syntax dialect script_code is written in -- "timeskipcode" (our
    # own, recommended) or one of the HTML/Python/C#-flavored alternatives.
    # All dialects compile to the exact same rule engine, see studio-dialects.js.
    language = db.Column(db.String(20), nullable=False, default="python")
    # Set only for the legacy built-in games, re-listed as normal gallery
    # entries "uploaded by" the LEROX account -- points at the game's own
    # route (e.g. "fruitmerge") instead of the studio block runtime.
    builtin_endpoint = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    owner = db.relationship("User", backref="studio_projects")
    blocks = db.relationship(
        "StudioBlock", backref="project", lazy=True, cascade="all, delete-orphan",
        order_by="StudioBlock.id",
    )
    likes = db.relationship("StudioProjectLike", backref="project", lazy=True, cascade="all, delete-orphan")
    comments = db.relationship(
        "StudioProjectComment", backref="project", lazy=True, cascade="all, delete-orphan",
        order_by="StudioProjectComment.created_at",
    )
    reports = db.relationship(
        "StudioProjectReport", backref="project", lazy=True, cascade="all, delete-orphan",
        order_by="StudioProjectReport.created_at",
    )


class StudioProjectLike(db.Model):
    """No points are awarded for liking/publishing a game -- this is a
    plain popularity signal, used to sort the homepage's "Beliebteste" tab."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey("studio_project.id"), nullable=False)
    __table_args__ = (db.UniqueConstraint("user_id", "project_id", name="uq_studioprojectlike_user_project"),)


class StudioProjectComment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey("studio_project.id"), nullable=False)
    text = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    author = db.relationship("User")


class StudioProjectReport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    project_id = db.Column(db.Integer, db.ForeignKey("studio_project.id"), nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    reporter = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("project_id", "reporter_id", name="uq_studioprojectreport_project_reporter"),)


class NailProject(db.Model):
    """A Scratch-style, block-programmed project in NAIL (Nex AI Learning)
    -- the replacement for NexAI studio's old manual/AI code editors.
    project_json holds the whole program as one JSON blob: sprite state
    (position/costume/etc.), custom variables, and a list of scripts, each
    a chain of block nodes (nested "body" arrays for C-shaped blocks like
    repeat/if) -- executed client-side by static/js/nail-runtime.js, the
    same shape a real Scratch .sb3's block tree takes conceptually, just
    JSON instead of Scratch's own format."""
    id = db.Column(db.Integer, primary_key=True)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    published = db.Column(db.Boolean, nullable=False, default=False)
    project_json = db.Column(db.Text, nullable=False, default="{}")
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    owner = db.relationship("User")
    likes = db.relationship("NailProjectLike", backref="project", lazy=True, cascade="all, delete-orphan")


class NailProjectLike(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey("nail_project.id"), nullable=False)
    __table_args__ = (db.UniqueConstraint("user_id", "project_id", name="uq_nailprojectlike_user_project"),)


class HumanSpotterImage(db.Model):
    """One photo in the NexAI/erkenne.den.menschen game's pool -- every
    logged-in user can contribute one, shown at random to everyone else who
    plays. HumanSpotterClick rows are the actual crowdsourced "where is the
    human in this photo" answers; see that model's docstring for what
    honestly happens with them (spoiler: they're stored, not fed into a
    live-trained vision model -- this app has no ML training pipeline)."""
    id = db.Column(db.Integer, primary_key=True)
    filename = db.Column(db.String(255), nullable=False)
    uploader_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    uploader = db.relationship("User")
    clicks = db.relationship("HumanSpotterClick", backref="image", lazy=True, cascade="all, delete-orphan")
    reports = db.relationship("HumanSpotterReport", backref="image", lazy=True, cascade="all, delete-orphan")


class HumanSpotterClick(db.Model):
    """One player's answer for one photo: where they clicked, as a
    fraction (0-1) of the image's width/height so it stays meaningful
    regardless of how large the photo was shown. user_id is nullable --
    playing doesn't require an account, only uploading a photo does."""
    id = db.Column(db.Integer, primary_key=True)
    image_id = db.Column(db.Integer, db.ForeignKey("human_spotter_image.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    x_fraction = db.Column(db.Float, nullable=False)
    y_fraction = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class HumanSpotterReport(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    image_id = db.Column(db.Integer, db.ForeignKey("human_spotter_image.id"), nullable=False)
    reporter_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    reporter = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("image_id", "reporter_id", name="uq_humanspotterreport_image_reporter"),)


class AiVoiceProfile(db.Model):
    """The AI's spoken voice for voice chat, per gender bucket ("male" or
    "female") -- a real, single-person voice actually cloned through
    ElevenLabs (see app.py's elevenlabs_* helpers), not something trained
    from everyone's samples blended together (that's not how voice cloning
    works, and this app has no ML pipeline of its own regardless). Each new
    contribution replaces the previous clone for that gender outright,
    so the AI always speaks with whoever contributed most recently.
    elevenlabs_voice_id is None until someone has contributed a sample --
    voice chat falls back to the browser's own built-in TTS until then."""
    id = db.Column(db.Integer, primary_key=True)
    gender = db.Column(db.String(10), nullable=False, unique=True)
    elevenlabs_voice_id = db.Column(db.String(100), nullable=True)
    contributor_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    contributor = db.relationship("User")


class AiChatFeedback(db.Model):
    """A thumbs up/down on one AI chat reply. Purely a record for human
    review -- the hosted model isn't retrained from this automatically."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    message = db.Column(db.Text, nullable=False)
    reply = db.Column(db.Text, nullable=False)
    rating = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")


class AiChat(db.Model):
    """One saved conversation with the AI assistant. Only ever read back
    for the same user who owns it -- never used to influence another
    user's replies."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    title = db.Column(db.String(100), nullable=True)
    # "general" chats never send Studio code context automatically; "code"
    # chats do (after the user accepts the "Chat auf Code spezialisieren"
    # suggestion, or by starting the chat from inside the Studio editor).
    mode = db.Column(db.String(20), nullable=False, default="general")
    # Which AI character this chat belongs to -- "nex" (default, NexAI) or
    # "sevenai" (7Ai, a separate, deliberately blunter/sassier character,
    # see ai_assistant.py's SEVENAI_SYSTEM_PROMPT). Orthogonal to `mode`
    # above (which is Nex-specific code-context bookkeeping) -- this only
    # decides which persona/system-prompt/chat-list a chat belongs to.
    # api_ai_list_chats() filters by this so a user's Nex and 7Ai chats
    # never mix in either product's own sidebar.
    character = db.Column(db.String(20), nullable=False, default="nex")
    specialize_prompted = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")
    messages = db.relationship(
        "AiChatMessage", backref="chat", lazy=True, cascade="all, delete-orphan",
        order_by="AiChatMessage.created_at",
    )


class AiChatMessage(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    chat_id = db.Column(db.Integer, db.ForeignKey("ai_chat.id"), nullable=False)
    role = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class AiGeneratedMedia(db.Model):
    """One image or audio clip the assistant generated for a user via the
    generate_image / generate_audio tools (see ai_assistant.py) -- kept as
    its own record (in addition to being embedded inline in the
    AiChatMessage that produced it) purely so the "Galerie" page can list
    everything a user has ever had the AI create, without having to scan
    and re-parse every chat message. url is the same URL embedded in the
    chat reply (a Pollinations.ai URL for images; a stored file URL via
    media_url() for audio)."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    kind = db.Column(db.String(10), nullable=False)  # "image" or "audio"
    url = db.Column(db.String(500), nullable=False)
    prompt = db.Column(db.Text, nullable=True)
    # Liking an item here feeds a remember_user_fact-style row back into
    # this same user's AI profile (see app.py's api_ai_gallery_like), so
    # future generations can lean toward what they've actually liked.
    liked = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")


class AiAdminFact(db.Model):
    """A fact an admin has told the AI assistant through the admin
    dashboard's dedicated "KI-Wissen" chat -- unlike every other AI chat in
    this app, these are deliberately global: the assistant treats them as
    confirmed truth in its replies to every user, not just the admin who
    stated them. Only messages sent through that specific chat become a
    fact (see app.py's api_ai_chat's save_as_fact handling); an admin's own
    ordinary chats elsewhere are not treated any differently from anyone
    else's."""
    id = db.Column(db.Integer, primary_key=True)
    admin_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))


class AiLearnedFact(db.Model):
    """A lightweight, no-retraining way of "teaching" the assistant new
    things -- distinct from AiTrainingExample/AiTrainingRun below, which
    are real fine-tuning (actually changes the model's weights). In
    general (non-code) chats, three kinds of things get remembered for
    future conversations: source="wikipedia" is the
    takeaway from a successful search_wikipedia lookup, shared with every
    user since it's independently verifiable; source="python_docs" is the
    same for search_docs lookups of Python's official docs; source="user"
    is a per-user row -- every small thing the assistant picks up about
    this one person across all their chats (self-reported facts, but also
    inferred patterns like "types very fast when stressed", see
    api_ai_chat's typing_avg_interval_ms handling), scoped to user_id,
    unbounded in count (see app.py's USER_FACTS_PROMPT_LIMIT), and always
    framed to the model as an unverified, self-reported/inferred claim --
    never treated as confirmed truth the way an AiAdminFact is. Together
    a user's own source="user" rows form the private per-user profile
    described in the Nutzungsbedingungen ("NexAI AI und Ihr
    persönliches Nutzerprofil") -- read only by the AI system itself for
    that same user's own future chats, never rendered in any admin or
    user-facing view (the admin dashboard only ever shows an aggregate
    count, see admin.html's "Von Nutzern gemerkte Angaben")."""
    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(20), nullable=False)
    content = db.Column(db.Text, nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    admin = db.relationship("User")


class AiTrainingExample(db.Model):
    """One instruction/response pair an admin has curated as real
    fine-tuning data for the local chat model (see fine_tune.py) --
    unlike AiLearnedFact, these actually change the model's weights when
    a training run (AiTrainingRun) uses them, rather than just being
    read back into the prompt. Admin-only, not shown to or writable by
    regular users."""
    id = db.Column(db.Integer, primary_key=True)
    instruction = db.Column(db.Text, nullable=False)
    response = db.Column(db.Text, nullable=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    created_by = db.relationship("User")


class AiTrainingRun(db.Model):
    """One real fine-tuning run of the local chat model (see
    fine_tune.py's run_training_job) -- status/status_message are polled
    by the admin training page while it's running. Only one run is ever
    allowed to be "running" at a time (enforced in app.py before starting
    a new one), since training saturates the same CPU the live app runs
    on."""
    id = db.Column(db.Integer, primary_key=True)
    status = db.Column(db.String(20), nullable=False, default="running")  # running, done, error
    status_message = db.Column(db.String(300), nullable=True)
    example_count = db.Column(db.Integer, nullable=False, default=0)
    error = db.Column(db.Text, nullable=True)
    started_by_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    started_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at = db.Column(db.DateTime, nullable=True)
    started_by = db.relationship("User")


class AiPersonality(db.Model):
    """A per-user "character dial" for the assistant's general-mode tone --
    four 0-100 traits (see ai_assistant.py's _personality_addendum for how
    each is translated into actual writing guidance for the model).
    Everyone starts at the same defaults; the AI can nudge a trait for one
    specific user over time via the adjust_personality_trait tool (see
    api_ai_chat's personality_adjustments handling), the same "learned
    over many chats, private to this one user" pattern as AiLearnedFact.
    Not a claim that the model actually has stable character traits
    between requests (it doesn't -- each reply is a fresh, stateless call,
    see ai_assistant.py's module docstring) -- this is prompt-level
    roleplay/personalization, same honesty framing as everything else
    under "the honest version of training"."""
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    intelligence = db.Column(db.Integer, nullable=False, default=89)
    humor = db.Column(db.Integer, nullable=False, default=68)
    caution = db.Column(db.Integer, nullable=False, default=89)
    arrogance = db.Column(db.Integer, nullable=False, default=12)
    # "Buddy" mode (see base.html's sidebar button + confirm dialog): once a
    # user explicitly opts in, general-mode replies are nudged to mirror
    # this user's own writing style (word choice, sentence length, tone),
    # inferred live from their own message history already sent with every
    # request -- not a separate stored writing sample.
    mimic_user_style = db.Column(db.Boolean, nullable=False, default=False)
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    user = db.relationship("User")


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


# ==========================================================================
# pinklemon social feed (2026-09-10) -- Home tab: text posts with a heading
# + optional body, double-tap likes, long-press comments (nested one level,
# each likeable), a share counter, and exactly one "P.S." the author can
# append later. Deliberately NOT named `post` -- a legacy `post` photo-feed
# table (dropped from the app, rows may still exist in prod) has an
# incompatible schema, so these get their own `feed_*` tables.
# ==========================================================================

class FeedPost(db.Model):
    __tablename__ = "feed_post"
    id = db.Column(db.Integer, primary_key=True)
    author_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    heading = db.Column(db.String(140), nullable=False)
    body = db.Column(db.Text, nullable=True)
    share_count = db.Column(db.Integer, nullable=False, default=0)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    # optional attachment shown under the text: "image" / "video" -> att_value
    # is the stored filename; "game" -> att_value is a game slug.
    att_kind = db.Column(db.String(12), nullable=True)
    att_value = db.Column(db.String(255), nullable=True)
    # extra feed features
    edited_at = db.Column(db.DateTime, nullable=True)
    pinned_at = db.Column(db.DateTime, nullable=True)          # pinned to the author's profile
    view_count = db.Column(db.Integer, nullable=False, default=0)
    is_sensitive = db.Column(db.Boolean, nullable=False, default=False)
    poll_json = db.Column(db.Text, nullable=True)              # JSON list of option strings

    author = db.relationship("User")
    likes = db.relationship("FeedLike", backref="post", lazy=True, cascade="all, delete-orphan")
    comments = db.relationship("FeedComment", backref="post", lazy=True, cascade="all, delete-orphan")
    ps = db.relationship("FeedPS", backref="post", uselist=False, cascade="all, delete-orphan")
    reposts = db.relationship("FeedRepost", backref="post", lazy=True, cascade="all, delete-orphan")
    bookmarks = db.relationship("FeedBookmark", backref="post", lazy=True, cascade="all, delete-orphan")
    poll_votes = db.relationship("FeedPollVote", backref="post", lazy=True, cascade="all, delete-orphan")


class FeedRepost(db.Model):
    __tablename__ = "feed_repost"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("feed_post.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    quote = db.Column(db.Text, nullable=True)                 # set -> it's a quote-post
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    user = db.relationship("User")
    __table_args__ = (db.UniqueConstraint("post_id", "user_id", name="uq_feedrepost_post_user"),)


class FeedBookmark(db.Model):
    __tablename__ = "feed_bookmark"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("feed_post.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    __table_args__ = (db.UniqueConstraint("post_id", "user_id", name="uq_feedbookmark_post_user"),)


class FeedReport(db.Model):
    __tablename__ = "feed_report"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("feed_post.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    reason = db.Column(db.String(200), nullable=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class FeedPollVote(db.Model):
    __tablename__ = "feed_poll_vote"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("feed_post.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    choice = db.Column(db.Integer, nullable=False)
    __table_args__ = (db.UniqueConstraint("post_id", "user_id", name="uq_feedpollvote_post_user"),)


class FeedLike(db.Model):
    __tablename__ = "feed_like"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("feed_post.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    __table_args__ = (db.UniqueConstraint("post_id", "user_id", name="uq_feedlike_post_user"),)


class FeedComment(db.Model):
    __tablename__ = "feed_comment"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("feed_post.id"), nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    # One level of nesting only: a reply has parent_id set; a reply to a
    # reply is collapsed onto the same top-level thread (app.py enforces).
    parent_id = db.Column(db.Integer, db.ForeignKey("feed_comment.id"), nullable=True)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    att_kind = db.Column(db.String(12), nullable=True)
    att_value = db.Column(db.String(255), nullable=True)

    author = db.relationship("User")
    likes = db.relationship("FeedCommentLike", backref="comment", lazy=True, cascade="all, delete-orphan")
    replies = db.relationship(
        "FeedComment", backref=db.backref("parent", remote_side=[id]),
        lazy=True, cascade="all, delete-orphan",
    )


class FeedCommentLike(db.Model):
    __tablename__ = "feed_comment_like"
    id = db.Column(db.Integer, primary_key=True)
    comment_id = db.Column(db.Integer, db.ForeignKey("feed_comment.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    __table_args__ = (db.UniqueConstraint("comment_id", "user_id", name="uq_feedcommentlike_comment_user"),)


class FeedPS(db.Model):
    __tablename__ = "feed_ps"
    id = db.Column(db.Integer, primary_key=True)
    post_id = db.Column(db.Integer, db.ForeignKey("feed_post.id"), nullable=False, unique=True)
    body = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)
    att_kind = db.Column(db.String(12), nullable=True)
    att_value = db.Column(db.String(255), nullable=True)


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

    members = db.relationship("PlChatMember", backref="chat", lazy=True, cascade="all, delete-orphan")
    messages = db.relationship(
        "PlMessage", backref="chat", lazy=True, cascade="all, delete-orphan",
        order_by="PlMessage.created_at",
    )


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

