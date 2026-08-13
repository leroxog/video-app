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
    # "Cheaper" fields -- city is free-text (e.g. "München-Pasing"), used to
    # bias which offers a user sees first (see home_page's sort_offers)
    # before/without live browser geolocation. is_company marks a business
    # account, which manages its own Offer rows from /firma/angebote
    # instead of browsing as a customer; company_address is required for
    # such accounts (see register_company), everyone else leaves it empty.
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


OFFER_CATEGORIES = ["essen", "unterhaltung", "freizeit", "sport", "bildung", "sonstiges"]
OFFER_CATEGORY_LABELS = {
    "essen": "Essen",
    "unterhaltung": "Unterhaltung",
    "freizeit": "Freizeit",
    "sport": "Sport",
    "bildung": "Bildung",
    "sonstiges": "Sonstiges",
}


class Offer(db.Model):
    """One buyable thing shown on the Cheaper homepage/search -- prices are
    entered by hand (by an admin seeding examples, or by a company account
    from its own dashboard), never scraped live, see the app's own
    module-level notes on why. discount_max_age nullable means "no age
    discount"; when set, a logged-in user whose age (from birthdate) is at
    or under it sees discount_price_cents instead of normal_price_cents.
    company_id is null for admin-seeded example offers."""
    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    provider_name = db.Column(db.String(150), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(20), nullable=False, default="sonstiges")
    description = db.Column(db.Text, nullable=True)
    image_url = db.Column(db.String(500), nullable=True)
    link_url = db.Column(db.String(500), nullable=False)
    normal_price_cents = db.Column(db.Integer, nullable=False)
    discount_price_cents = db.Column(db.Integer, nullable=True)
    discount_max_age = db.Column(db.Integer, nullable=True)
    discount_label = db.Column(db.String(100), nullable=True)
    city = db.Column(db.String(100), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    company = db.relationship("User")

    def price_for(self, age):
        """Returns (price_cents, is_discounted) for a viewer of the given
        age (None if unknown/logged out -- always the normal price)."""
        if age is not None and self.discount_price_cents is not None and self.discount_max_age is not None and age <= self.discount_max_age:
            return self.discount_price_cents, True
        return self.normal_price_cents, False
