"""The official accounts of Nex (2026-10-30). Two accounts belong to Nex itself and nobody can get one: "Nex-Web" (everything new about the website) and "Nex-AI" (everything new
about the AI). They are marked "Offiziell" next to their name, nobody can sign in as them (their password fits nothing), their handles are reserved, they read no messages, and
everybody follows them (a new account at the start, the accounts that exist already once).

Every new feature gets a post on one of them: whoever adds something to Nex adds a line to ANNOUNCEMENTS (below). The first request to the API after a start of the site makes the
accounts if they are missing and publishes the announcements that were not published yet (each id once; the table `yipi_announcement` remembers). So a release posts itself.

Rules for the texts: German, friendly, at most 280 characters, what the person can do now (not how it was built), at most two hashtags."""
import logging
import threading

from flask import request
from sqlalchemy.exc import IntegrityError

import yipi

log = logging.getLogger("nex.company")

ACCOUNTS = {
    "web": {"handle": "nexweb", "name": "Nex-Web", "bio": "Das offizielle Konto von Nex. Hier stehen alle Neuerungen der Webseite."},
    "ai": {"handle": "nexai", "name": "Nex-AI", "bio": "Das offizielle Konto von Nex AI. Hier stehen alle Neuerungen der KI."},
}
PASSWORD_HASH = "!"                          # fits no password: nobody can sign in as an official account

# (id, account, text): add new lines at the END; an id is never reused. The text is posted once, the first time the site runs with the line.
ANNOUNCEMENTS = [
    ("2026-10-30-web", "web", "Neu auf Nex: Links zeigen eine Vorschau und öffnen sich direkt hier, ohne dass du Nex verlässt. Videos im Feed laufen stumm von allein, und nach den ersten Beiträgen kommen fünf Shorts. Dazu ein neuer Start mit Bedingungen, einfachem Anmelden und bunten Standardbildern. #neu"),
    ("2026-10-30-ai", "ai", "Neu: Nex AI hat jetzt vier Modi. Normal, Superintelligent (längere, gründlichere Antworten), Human (locker und direkt) und Code (für gute Programme). Du wählst sie oben im Chat. #nexai"),
]

_state = {"started": False}
_lock = threading.Lock()


# ------------------------------------------------------------------------------------------------------------------ the accounts
def official(kind):
    """The account of the kind "web" or "ai", made when it is missing."""
    spec = ACCOUNTS[kind]
    user = yipi.YipiUser.query.filter_by(handle_lc=spec["handle"]).first()
    if user is None:
        user = yipi.YipiUser(handle=spec["handle"], handle_lc=spec["handle"], name=spec["name"], bio=spec["bio"], password_hash=PASSWORD_HASH, company=True, last_seen_at=yipi.utcnow())
        yipi.db.session.add(user)
        try:
            yipi.db.session.commit()
        except IntegrityError:
            yipi.db.session.rollback()
            user = yipi.YipiUser.query.filter_by(handle_lc=spec["handle"]).first()
    elif not user.company or user.password_hash != PASSWORD_HASH:
        user.company = True
        user.password_hash = PASSWORD_HASH
        yipi.db.session.commit()
    return user


def official_ids():
    return [official(kind).id for kind in ACCOUNTS]


def follow_official(user):
    """The person follows both official accounts (no notification to them: they have no inbox)."""
    if user is None or user.company:
        return 0
    added = 0
    for official_id in official_ids():
        if yipi.YipiFollow.query.filter_by(follower_id=user.id, followee_id=official_id).first() is None:
            yipi.db.session.add(yipi.YipiFollow(follower_id=user.id, followee_id=official_id))
            yipi.bump(yipi.YipiUser, official_id, yipi.YipiUser.followers_count, 1)
            yipi.bump(yipi.YipiUser, user.id, yipi.YipiUser.following_count, 1)
            added += 1
    if added:
        yipi.db.session.commit()
    return added


# ------------------------------------------------------------------------------------------------------------------ the announcements
def post_as(user, text):
    post = yipi.YipiPost(user_id=user.id, text=text)
    yipi.db.session.add(post)
    yipi.db.session.flush()
    for tag in yipi.extract_tags(text):
        yipi.db.session.add(yipi.YipiTag(tag=tag, post_id=post.id, user_id=user.id))
    yipi.bump(yipi.YipiUser, user.id, yipi.YipiUser.posts_count, 1)
    return post


def publish_pending(announcements=None):
    """Posts what was not posted yet; returns how many posts were made."""
    made = 0
    for key, kind, text in (ANNOUNCEMENTS if announcements is None else announcements):
        if yipi.db.session.get(yipi.YipiAnnouncement, key) is not None:
            continue
        if len(text) > yipi.MAX_POST:
            log.error("announcement %s is too long", key)
            continue
        user = official(kind)
        post = post_as(user, text)
        yipi.db.session.add(yipi.YipiAnnouncement(id=key, post_id=post.id))
        try:
            yipi.db.session.commit()
            made += 1
        except IntegrityError:                       # another process was faster
            yipi.db.session.rollback()
    return made


def follow_everybody():
    """Once: everybody who has an account follows the official accounts (new accounts do it at signup)."""
    key = "_follow_everybody_1"
    if yipi.db.session.get(yipi.YipiAnnouncement, key) is not None:
        return 0
    ids = official_ids()
    count = 0
    start = 0
    while True:
        users = yipi.YipiUser.query.filter(yipi.YipiUser.id > start, yipi.YipiUser.company.is_(False)).order_by(yipi.YipiUser.id).limit(200).all()
        if not users:
            break
        for user in users:
            have = {row.followee_id for row in yipi.YipiFollow.query.filter(yipi.YipiFollow.follower_id == user.id, yipi.YipiFollow.followee_id.in_(ids))}
            for official_id in ids:
                if official_id not in have:
                    yipi.db.session.add(yipi.YipiFollow(follower_id=user.id, followee_id=official_id))
                    yipi.bump(yipi.YipiUser, official_id, yipi.YipiUser.followers_count, 1)
                    yipi.bump(yipi.YipiUser, user.id, yipi.YipiUser.following_count, 1)
                    count += 1
        start = users[-1].id
        yipi.db.session.commit()
    yipi.db.session.add(yipi.YipiAnnouncement(id=key, post_id=None))
    try:
        yipi.db.session.commit()
    except IntegrityError:
        yipi.db.session.rollback()
    return count


def start_up(app):
    with app.app_context():
        official_ids()
        follow_everybody()
        publish_pending()


def _work(app):
    try:
        start_up(app)
    except Exception:  # noqa: BLE001
        log.exception("the official accounts could not be set up")
        try:
            with app.app_context():
                yipi.db.session.rollback()
        except Exception:  # noqa: BLE001
            pass


def attach(app):
    """The first request to the API after a start makes the accounts and posts the new announcements (in a thread, never in the request)."""
    def wake():
        if _state["started"] or not request.path.startswith("/api/yipi/"):
            return
        if app.config.get("TESTING") and not app.config.get("YIPI_COMPANY_IN_TESTS"):
            return
        with _lock:
            if _state["started"]:
                return
            _state["started"] = True
        threading.Thread(target=_work, args=(app,), name="nex-company", daemon=True).start()

    app.before_request(wake)
