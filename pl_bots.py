"""pinklemon -- fake community.

Seeds ~1000 bot accounts with real-looking names that post, comment and
argue in the feed, plus a background daemon that keeps them writing so the
app never looks empty. Bots are marked with User.purpose_of_use == "bot".

Everything here is best-effort: any failure is logged and swallowed so a
bad tick can never take the web process down. Bots are OFF by default --
set env PL_BOTS=1 to enable them; while off, bootstrap() purges any that
already exist.
"""

import logging
import os
import random
import threading
import time
from datetime import datetime, timedelta, timezone

from models import (
    db, User, Subscription,
    FeedPost, FeedComment, FeedLike, FeedCommentLike,
    PlChat, PlChatMember, PlMessage,
)

logger = logging.getLogger("pl_bots")

BOT_MARK = "bot"
TARGET_BOTS = int(os.environ.get("PL_BOT_COUNT", "1000"))
MIN_SEED_POSTS = 140

# --------------------------------------------------------------------------
# names
# --------------------------------------------------------------------------
_FIRST = [
    "lena", "max", "mia", "finn", "emma", "jonas", "hanna", "leon", "lea", "paul",
    "marie", "luca", "sophie", "elias", "clara", "noah", "lisa", "tim", "nele", "ben",
    "julia", "felix", "sarah", "moritz", "laura", "david", "anna", "jan", "nina", "tom",
    "katja", "erik", "mara", "nico", "pia", "kevin", "amelie", "phil", "carla", "jannik",
    "svenja", "toni", "greta", "milan", "romy", "nils", "frieda", "aaron", "isa", "malte",
    "yara", "juri", "lotta", "flo", "vroni", "sami", "tessa", "bela", "kira", "matteo",
    "linn", "ole", "juna", "resi", "dario", "maja", "levi", "smilla", "jasper", "elli",
    "theo", "fenja", "bruno", "alina", "collin", "thea", "arne", "nora", "keno", "ida",
    "raffi", "leni", "cem", "aylin", "deniz", "melike", "kaan", "elif", "emre", "derya",
    "mert", "zeynep", "baran", "ela", "onur", "asli", "chris", "vero", "steffi", "basti",
]
_SUFFIX = [
    "", "_", ".", "23", "01", "99", "_x", "xo", "_official", "_hd", "07", "2k4",
    "_de", "42", "_yt", "88", "s", "_777", "_real", "3000", "_", "._", "_09", "17",
]
_MID = ["", "", "", "_", ".", "_die_", "_", ""]


def _make_names(n, rng):
    out, seen = [], set()
    tries = 0
    while len(out) < n and tries < n * 40:
        tries += 1
        a = rng.choice(_FIRST)
        style = rng.random()
        if style < 0.4:
            name = a + rng.choice(_SUFFIX)
        elif style < 0.7:
            name = a + rng.choice(_MID) + rng.choice(_FIRST)[:rng.randint(1, 4)] + rng.choice(_SUFFIX)
        elif style < 0.85:
            name = a + str(rng.randint(1985, 2009))
        else:
            name = a + rng.choice(_SUFFIX) + str(rng.randint(1, 99))
        name = name.strip("._")[:30]
        if len(name) < 3 or not name[0].isalnum():
            continue
        low = name.lower()
        if low in seen:
            continue
        seen.add(low)
        out.append(name)
    return out


# --------------------------------------------------------------------------
# content
# --------------------------------------------------------------------------
_POSTS = [
    ("Wieso hat eig niemand mehr Bock rauszugehen?", "Ernst gemeinte Frage. Jedes Wochenende sagen alle ab und dann liegt man wieder allein auf der Couch."),
    ("Kaffee > Tee. Ende der Debatte", "Kommt jetzt bitte nicht mit euren 12 Teesorten an."),
    ("Hab heute mit dem Laufen angefangen", "3 km, fast gestorben, aber stolz. Wer macht mit?"),
    ("Unpopular opinion: Winter ist die beste Jahreszeit", "Decke, Kakao, keiner erwartet dass du was unternimmst. Perfekt."),
    ("Warum ist Wohnung finden so brutal geworden", "40 Bewerbungen, 2 Besichtigungen, 0 Zusagen. Ich kann nicht mehr."),
    ("Neues Handy oder Reparatur?", "Akku hält 4 Stunden. Lohnt sich Reparatur noch bei nem 4 Jahre alten Gerät?"),
    ("Playlist-Empfehlungen bitte", "Brauche was zum Konzentrieren, am besten ohne Text."),
    ("Ich glaube ich mag meinen Job doch", "Nach 2 Jahren Meckern ist mir aufgefallen: könnte schlimmer sein."),
    ("Sonntags-Frage: kochen oder bestellen", "Ich bin schwach geworden und hab bestellt. Zum dritten Mal diese Woche."),
    ("Hab endlich das Buch fertig gelesen", "6 Monate für 300 Seiten. Aber hey, fertig ist fertig."),
    ("Wer schaut noch lineares Fernsehen?", "Meine Eltern schon. Ich hab seit Jahren keinen Sender mehr eingeschaltet."),
    ("Zu teuer geworden: einfach alles", "Der Wocheneinkauf kostet das Doppelte von vor zwei Jahren, kommt mir nicht normal vor."),
    ("Motivation für Montag gesucht", "Bitte was Nettes in die Kommentare, ich brauch das gerade."),
    ("Fitnessstudio kündigen oder durchziehen", "War 3x im Januar da. Jetzt ist März. Ihr wisst wie das läuft."),
    ("Bester Ort in der Stadt für Leute die niemanden kennen?", "Neu hergezogen, kenne exakt 0 Menschen hier."),
    ("Katze oder Hund fürs erste Haustier", "Wohnung, Vollzeitjob, aber der Wunsch ist groß. Vernünftig oder nicht?"),
    ("Ich hasse Telefonate", "Schreibt mir. Ruft mich nicht an. Danke."),
    ("Update: der Kaktus lebt noch", "Drei Monate. Persönlicher Rekord. Es gibt Hoffnung für mich."),
    ("Frühaufsteher, wie macht ihr das", "5 Uhr klingt so gesund und produktiv und trotzdem drücke ich 4x Snooze."),
    ("Serienempfehlung, aber kurz", "Keine 8 Staffeln. Etwas das man an einem Wochenende schafft."),
    ("Bin ich der einzige der Meetings mag", "Ehrlich. Lieber 30 Min reden als 20 Mails hin und her."),
    ("Wie viele Tabs sind zu viele", "Frag für einen Freund (der Freund bin ich, es sind 60)."),
    ("Endlich mal wieder früh im Bett", "22 Uhr. Fühlt sich an wie ein kleiner Sieg gegen mich selbst."),
    ("Diskussion: Pizza mit Ananas", "Ich bin dafür und ich stehe dazu. Kommt an."),
    ("Öffis vs Fahrrad im Winter", "Fahrrad-Leute, wie überlebt ihr das bei -2 Grad und Wind?"),
    ("Habt ihr einen Plan B falls alles schiefgeht", "Ich frag mich das gerade oft und hab keine Antwort."),
    ("Kleiner Erfolg: Steuererklärung abgegeben", "Nur 9 Monate zu spät. Trotzdem stolz."),
    ("Was hört ihr auf Repeat gerade", "Ich schäme mich fast, aber es ist ein Song von 2009."),
    ("Homeoffice macht mich einsam", "Produktiver ja, aber ich rede manche Tage mit niemandem. Wie geht ihr damit um?"),
    ("Ungewollt zum Morgenmensch geworden", "Neuer Job, frühe Schicht. Nach 3 Wochen wache ich am Wochenende um 6 auf. Hilfe."),
]

_COMMENTS_AGREE = [
    "Genau so ist es.", "Fühl ich zu 100%.", "Danke dass es mal jemand sagt.",
    "Same. Dachte schon ich bin allein damit.", "Unterschreibe ich sofort.",
    "Real. Kenne ich viel zu gut.", "Wollte gerade das Gleiche schreiben.",
    "Endlich sagt es mal wer.", "Zu wahr.", "Bin komplett bei dir.",
]
_COMMENTS_DISAGREE = [
    "Sehe ich komplett anders, ehrlich gesagt.", "Naja, kommt halt stark drauf an.",
    "Da muss ich widersprechen.", "Bei mir ist es genau umgekehrt.",
    "Also das würde ich so nicht stehen lassen.", "Hmm, überzeugt mich nicht ganz.",
    "Kann ich null nachvollziehen sorry.", "Gegenmeinung: das liegt eher an einem selbst.",
    "Ne, das ist mir zu pauschal.", "Klingt gut, funktioniert im Alltag aber nicht.",
]
_COMMENTS_NEUTRAL = [
    "Wie lange machst du das schon?", "Hast du dazu einen Tipp?",
    "Update bitte wenn du weiterweißt.", "Was hat am Ende geholfen?",
    "Wie ist es ausgegangen?", "Woher hast du die Idee?",
    "Erzähl mehr.", "Interessant, dranbleiben.", "Viel Erfolg dir dabei!",
    "Push, gute Frage.", "Haha der letzte Satz.", "Kannst du das verlinken?",
]
_REPLIES = [
    "Fair, so hab ich das noch nicht gesehen.", "Okay der Punkt zieht.",
    "Trotzdem bleibe ich bei meiner Meinung, aber verständlich.",
    "Ja genau das meinte ich.", "Danke, probier ich aus.",
    "Sehe ich auch so, aber es ist eben nicht für jeden.",
    "Da hast du wahrscheinlich recht.", "Bei dir vielleicht, bei mir nicht.",
    "Guter Einwand ehrlich gesagt.", "Kann beides stimmen finde ich.",
]
_DM_LINES = [
    "hey, cooler post vorhin", "moin! wie läufts?", "sag mal, warst du auch auf dem konzert?",
    "hab deinen kommentar gesehen, sehe ich genauso", "hast du morgen zeit?",
    "lange nichts gehört, alles gut bei dir?", "wollte nur hallo sagen :)",
    "kurze frage, kennst du ein gutes café in der nähe?", "danke für den tipp neulich!",
    "wie war dein wochenende?",
]


def _is_bot(u):
    return getattr(u, "purpose_of_use", None) == BOT_MARK


def _rand_past(rng, max_days=12):
    secs = int(rng.random() ** 1.8 * max_days * 86400)  # weighted toward recent
    return datetime.now(timezone.utc) - timedelta(seconds=secs)


# --------------------------------------------------------------------------
# seeding
# --------------------------------------------------------------------------
def _seed_users(rng):
    have = User.query.filter_by(purpose_of_use=BOT_MARK).count()
    if have >= TARGET_BOTS - 20:
        return have
    existing_lower = {u.lower() for (u,) in db.session.query(User.username).all()}
    names = [n for n in _make_names(TARGET_BOTS * 2, rng) if n.lower() not in existing_lower]
    created = 0
    from werkzeug.security import generate_password_hash
    shared_hash = generate_password_hash("bot-" + os.urandom(6).hex())
    for name in names:
        if have + created >= TARGET_BOTS:
            break
        u = User(username=name, purpose_of_use=BOT_MARK)
        u.password_hash = shared_hash
        u.created_at = _rand_past(rng, 60)
        db.session.add(u)
        created += 1
        if created % 200 == 0:
            db.session.commit()
    db.session.commit()
    logger.info("pl_bots: created %d bot users (now %d)", created, have + created)
    return have + created


def _seed_content(rng):
    bots = User.query.filter_by(purpose_of_use=BOT_MARK).all()
    if not bots:
        return
    bot_posts = (
        db.session.query(FeedPost.id)
        .join(User, User.id == FeedPost.author_id)
        .filter(User.purpose_of_use == BOT_MARK).count()
    )
    if bot_posts >= MIN_SEED_POSTS:
        return

    want = MIN_SEED_POSTS - bot_posts
    new_posts = []
    for _ in range(want):
        heading, body = rng.choice(_POSTS)
        author = rng.choice(bots)
        p = FeedPost(
            author_id=author.id, heading=heading,
            body=body if rng.random() < 0.85 else None,
            share_count=rng.randint(0, 40),
        )
        p.created_at = _rand_past(rng, 12)
        db.session.add(p)
        new_posts.append(p)
    db.session.flush()

    # likes + a threaded discussion under most posts
    for p in new_posts:
        for liker in rng.sample(bots, k=min(len(bots), rng.randint(0, 25))):
            db.session.add(FeedLike(post_id=p.id, user_id=liker.id))
        n_top = rng.randint(0, 5)
        for _ in range(n_top):
            ca = rng.choice(bots)
            pool = rng.choice([_COMMENTS_AGREE, _COMMENTS_DISAGREE, _COMMENTS_NEUTRAL, _COMMENTS_NEUTRAL])
            top = FeedComment(post_id=p.id, author_id=ca.id, body=rng.choice(pool))
            top.created_at = p.created_at + timedelta(minutes=rng.randint(2, 3000))
            db.session.add(top)
            db.session.flush()
            for _ in range(rng.randint(0, 3)):
                ra = rng.choice(bots)
                rep = FeedComment(
                    post_id=p.id, author_id=ra.id, parent_id=top.id,
                    body=rng.choice(_REPLIES),
                )
                rep.created_at = top.created_at + timedelta(minutes=rng.randint(1, 800))
                db.session.add(rep)
        db.session.commit()
    logger.info("pl_bots: seeded %d posts with discussion", len(new_posts))


# --------------------------------------------------------------------------
# per (real) user: make ~30 bots mutuals + open DM chats
# --------------------------------------------------------------------------
_SOCIALIZED = set()
_SOC_LOCK = threading.Lock()


def ensure_social(user, n=30):
    """Give a real user a populated Freunde tab: ~n bots who follow them
    back, with an open DM chat each and a couple of recent messages."""
    if user is None or _is_bot(user):
        return
    if user.id in _SOCIALIZED:
        return
    with _SOC_LOCK:
        if user.id in _SOCIALIZED:
            return
        try:
            already = (
                db.session.query(Subscription.channel_id)
                .join(User, User.id == Subscription.channel_id)
                .filter(Subscription.subscriber_id == user.id, User.purpose_of_use == BOT_MARK)
                .count()
            )
            if already >= 5:
                _SOCIALIZED.add(user.id)
                return
            rng = random.Random()
            bots = User.query.filter_by(purpose_of_use=BOT_MARK).order_by(db.func.random()).limit(n).all()
            for b in bots:
                if not Subscription.query.filter_by(subscriber_id=user.id, channel_id=b.id).first():
                    db.session.add(Subscription(subscriber_id=user.id, channel_id=b.id))
                if not Subscription.query.filter_by(subscriber_id=b.id, channel_id=user.id).first():
                    db.session.add(Subscription(subscriber_id=b.id, channel_id=user.id))
            db.session.flush()

            existing_dm_with = set()
            for m in PlChatMember.query.filter_by(user_id=user.id).all():
                ch = db.session.get(PlChat, m.chat_id)
                if ch and not ch.is_group and len(ch.members) == 2:
                    for mm in ch.members:
                        if mm.user_id != user.id:
                            existing_dm_with.add(mm.user_id)

            for b in bots:
                if b.id in existing_dm_with:
                    continue
                chat = PlChat(is_group=False, created_by=b.id)
                db.session.add(chat)
                db.session.flush()
                db.session.add(PlChatMember(chat_id=chat.id, user_id=user.id))
                db.session.add(PlChatMember(chat_id=chat.id, user_id=b.id))
                last_at = datetime.now(timezone.utc) - timedelta(hours=rng.randint(1, 240))
                for _ in range(rng.randint(1, 3)):
                    msg = PlMessage(chat_id=chat.id, sender_id=b.id, text=rng.choice(_DM_LINES))
                    msg.created_at = last_at
                    db.session.add(msg)
                    last_at += timedelta(minutes=rng.randint(2, 90))
                chat.last_activity = last_at
            db.session.commit()
            _SOCIALIZED.add(user.id)
            logger.info("pl_bots: socialised user %s with %d bots", user.id, len(bots))
        except Exception:
            db.session.rollback()
            logger.exception("pl_bots.ensure_social failed")


# --------------------------------------------------------------------------
# live activity daemon
# --------------------------------------------------------------------------
def tick(app):
    with app.app_context():
        try:
            rng = random.Random()
            bots = User.query.filter_by(purpose_of_use=BOT_MARK).order_by(db.func.random()).limit(40).all()
            if not bots:
                return
            roll = rng.random()
            if roll < 0.34:
                heading, body = rng.choice(_POSTS)
                p = FeedPost(author_id=rng.choice(bots).id, heading=heading,
                             body=body if rng.random() < 0.8 else None)
                db.session.add(p)
                db.session.commit()
            elif roll < 0.9:
                recent = (
                    FeedPost.query.order_by(FeedPost.created_at.desc()).limit(40).all()
                )
                if recent:
                    target = rng.choice(recent)
                    pool = rng.choice([_COMMENTS_AGREE, _COMMENTS_DISAGREE, _COMMENTS_NEUTRAL])
                    parent = None
                    tops = [c for c in target.comments if c.parent_id is None]
                    if tops and rng.random() < 0.5:
                        parent = rng.choice(tops)
                        body = rng.choice(_REPLIES)
                    else:
                        body = rng.choice(pool)
                    db.session.add(FeedComment(
                        post_id=target.id, author_id=rng.choice(bots).id,
                        parent_id=parent.id if parent else None, body=body,
                    ))
                    db.session.commit()
            else:
                # keep a DM alive
                chats = (
                    PlChat.query.filter_by(is_group=False)
                    .order_by(PlChat.last_activity.asc()).limit(30).all()
                )
                rng.shuffle(chats)
                for ch in chats:
                    members = ch.members
                    if len(members) != 2:
                        continue
                    bot_m = next((m for m in members if _is_bot(m.user)), None)
                    human_m = next((m for m in members if not _is_bot(m.user)), None)
                    if not (bot_m and human_m):
                        continue
                    msg = PlMessage(chat_id=ch.id, sender_id=bot_m.user_id, text=random.choice(_DM_LINES))
                    db.session.add(msg)
                    ch.last_activity = datetime.now(timezone.utc)
                    db.session.commit()
                    break
        except Exception:
            db.session.rollback()
            logger.exception("pl_bots.tick failed")


def _daemon(app):
    # Seed in the background so the web process can bind its port and pass
    # Railway's healthcheck immediately, even on a fresh (wiped) database.
    time.sleep(3)
    try:
        with app.app_context():
            rng = random.Random(20240501)
            _seed_users(rng)
            _seed_content(rng)
    except Exception:
        logger.exception("pl_bots seeding failed")

    if os.environ.get("PL_BOTS_ACTIVE", "1") == "0":
        return
    while True:
        time.sleep(random.randint(45, 120))
        tick(app)


def purge(app):
    """Delete every bot account and everything it created -- posts,
    comments, likes, chats/DMs, follows. Safe to run repeatedly."""
    try:
        with app.app_context():
            bot_ids = [u.id for u in User.query.filter_by(purpose_of_use=BOT_MARK).all()]
            if not bot_ids:
                return
            # feed posts by bots -> ORM delete cascades their likes/comments/ps
            for p in FeedPost.query.filter(FeedPost.author_id.in_(bot_ids)).all():
                db.session.delete(p)
            db.session.commit()
            # bot comments / likes left on humans' posts
            for c in FeedComment.query.filter(FeedComment.author_id.in_(bot_ids)).all():
                db.session.delete(c)
            db.session.commit()
            FeedLike.query.filter(FeedLike.user_id.in_(bot_ids)).delete(synchronize_session=False)
            FeedCommentLike.query.filter(FeedCommentLike.user_id.in_(bot_ids)).delete(synchronize_session=False)
            db.session.commit()
            # any chat a bot is in -> drop the whole chat (cascades members + messages)
            chat_ids = {m.chat_id for m in PlChatMember.query.filter(PlChatMember.user_id.in_(bot_ids)).all()}
            for cid in chat_ids:
                ch = db.session.get(PlChat, cid)
                if ch:
                    db.session.delete(ch)
            db.session.commit()
            Subscription.query.filter(
                db.or_(Subscription.subscriber_id.in_(bot_ids), Subscription.channel_id.in_(bot_ids))
            ).delete(synchronize_session=False)
            db.session.commit()
            User.query.filter(User.id.in_(bot_ids)).delete(synchronize_session=False)
            db.session.commit()
            _SOCIALIZED.clear()
            logger.info("pl_bots: purged %d bot accounts", len(bot_ids))
    except Exception:
        db.session.rollback()
        logger.exception("pl_bots.purge failed")


_STARTED = False


def bootstrap(app):
    """Called once at startup from app.py. Bots are OFF unless PL_BOTS=1;
    when off, any leftover bots are purged."""
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    if os.environ.get("PL_BOTS") == "1":
        t = threading.Thread(target=_daemon, args=(app,), daemon=True, name="pl-bots")
        t.start()
        logger.info("pl_bots: worker thread started")
    else:
        threading.Thread(target=purge, args=(app,), daemon=True, name="pl-bots-purge").start()
        logger.info("pl_bots: disabled -- purging any leftover bots")
