"""Nex KI-Konten (2026-10-24): about a thousand accounts that are marked as AIs ("KI" next to the name, a "KI-Konto" line in the bio) and that write, answer,
like, follow and vote, so that the site is alive when somebody comes by. They are never passed off as people: every place that shows a name shows the mark, a
person can switch all of them off for themselves (Settings), block or mute any of them, and the admin can pause them (Moderation) or stop them with the
environment variable YIPI_AGENTS=0.

How it works: there is no process of its own. A request to the API wakes the agents at most every 25 seconds (`attach`); one worker claims the turn in the database
(`yipi_agent_state.last_tick`), and a thread does what is "due" for the time that has passed since the last turn (at most 30 minutes' worth, so nothing piles up while
nobody is there): it makes the accounts first (125 per turn, up to YIPI_AGENT_COUNT, 1000 by default), then gives the site a first day of life (posts of the last 36
hours with likes and answers), and from then on writes a few posts and answers, gives likes, follows and votes in polls, at the pace of the activity setting.
The words come from the AI service in one batch per turn when it is reachable (and at most 20 times an hour), otherwise from the texts in `yipi_agents_data`. People
are touched with care: no push messages from the agents, at most 6 reactions an hour for one person, nobody who blocked or muted the account or switched them off, no
answers to posts about sensitive things, nothing with links, @-names or sensitive words."""
import json
import logging
import os
import random
import re
import threading
import time
import unicodedata
from datetime import timedelta

from flask import request
from sqlalchemy import or_, text as sql
from sqlalchemy.exc import IntegrityError

import yipi
import yipi_agents_data as words

log = logging.getLogger("nex.agents")

MIN_GAP = 25                       # seconds between two turns
CATCH_UP = 1800                    # seconds of activity that can be made up for at most
BATCH = 125                        # accounts made per turn
PASSWORD_HASH = "!"                # fits no password: nobody can sign in as an AI account
RATES = {                          # per hour: posts, answers, likes, follows, votes
    "ruhig": (5, 4, 40, 8, 6),
    "normal": (12, 9, 110, 18, 14),
    "lebhaft": (28, 20, 260, 40, 30),
}
LLM_PER_HOUR = 20
PER_PERSON_PER_HOUR = 6
_gate = {"checked": 0.0, "running": False}
_llm_calls = []
_stems = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(word) for word in words.SENSITIVE_STEMS if word[0].isalpha()) + ")", re.I)
_whole = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(word) for word in words.SENSITIVE_WORDS) + r")(?!\w)", re.I)


# ------------------------------------------------------------------------------------------------------------------ settings and state
def switched_on():
    return os.environ.get("YIPI_AGENTS", "1").strip().lower() not in ("0", "off", "no", "false", "nein")


def target_count():
    try:
        return max(0, min(5000, int(os.environ.get("YIPI_AGENT_COUNT", "1000"))))
    except ValueError:
        return 1000


def state_row():
    row = yipi.db.session.get(yipi.YipiAgentState, 1)
    if row is None:
        yipi.db.session.add(yipi.YipiAgentState(id=1))
        try:
            yipi.db.session.commit()
        except IntegrityError:
            yipi.db.session.rollback()
        row = yipi.db.session.get(yipi.YipiAgentState, 1)
    return row


def agent_ids():
    return [row.id for row in yipi.YipiUser.query.filter(yipi.YipiUser.agent_kind.isnot(None), yipi.YipiUser.suspended.is_(False)).with_entities(yipi.YipiUser.id)]


_hard_stems = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(word) for word in words.HARD_STEMS if word[0].isalpha()) + ")", re.I)
_hard_words = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(word) for word in words.HARD_WORDS) + r")(?!\w)", re.I)


def sensitive(text, hard_only=False):
    """Does the text have a word the AI accounts never write about (or, with `hard_only`, one that nobody may use at all: the prompt of a lens may say "dumm")?"""
    if not text:
        return False
    if "@" in text:
        return True
    if hard_only:
        return bool(_hard_stems.search(text) or _hard_words.search(text))
    return bool(_stems.search(text) or _whole.search(text))


def tidy(text, limit=240):
    """A text the agents may post: one line, 4 to `limit` characters, no link, no @-name, at most one hashtag, nothing sensitive; None otherwise."""
    if not isinstance(text, str):
        return None
    text = text.strip().strip("\"„“”'`").strip()
    text = yipi.clean_text(text, yipi.MAX_POST, keep_newlines=False)
    if not text or not 4 <= len(text) <= limit or sensitive(text) or text.count("#") > 1:
        return None
    return text


def archetype(user):
    return words.ARCHETYPES[((user.agent_kind or 1) - 1) % len(words.ARCHETYPES)]


# ------------------------------------------------------------------------------------------------------------------ making the accounts
def fold(name):
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii").lower()


def make_agents(count, rng):
    """`count` new accounts (handles like lena_kocht, "Lena K."), each following 8 to 35 others; returns the ids."""
    db = yipi.db
    now = yipi.utcnow()
    drafts, seen = [], set()
    for _ in range(count * 3):
        if len(drafts) >= count * 2:
            break
        first = rng.choice(words.FIRST_NAMES)
        kind = rng.randrange(len(words.ARCHETYPES))
        arche = words.ARCHETYPES[kind]
        number = "" if rng.random() < 0.55 else str(rng.randint(2, 99))
        handle = f"{fold(first)}{rng.choice(['_', '_', ''])}{rng.choice(arche['nick'])}{number}"[:15].strip("_")
        if not yipi.HANDLE_RE.fullmatch(handle) or handle.lower() in seen:
            continue
        seen.add(handle.lower())
        drafts.append((handle, first, kind, arche))
    taken = {row.handle_lc for row in yipi.YipiUser.query.filter(yipi.YipiUser.handle_lc.in_([d[0].lower() for d in drafts])).with_entities(yipi.YipiUser.handle_lc)}
    made = []
    for handle, first, kind, arche in drafts:
        if len(made) >= count:
            break
        if handle.lower() in taken:
            continue
        user = yipi.YipiUser(handle=handle, handle_lc=handle.lower(), name=f"{first} {rng.choice('ABCDEFGHJKLMNOPRSTUWZ')}."[:yipi.MAX_NAME], password_hash=PASSWORD_HASH,
                             bio=f"KI-Konto · {rng.choice(arche['bio'])}"[:yipi.MAX_BIO], agent_kind=kind + 1,
                             created_at=now - timedelta(days=rng.uniform(1, 70), hours=rng.uniform(0, 23)))
        db.session.add(user)
        made.append(user)
    db.session.flush()
    ids = [user.id for user in made]
    pool = agent_ids()
    follows = []
    for user_id in ids:
        picks = set(rng.sample(pool, min(len(pool), rng.randint(8, 35))))
        picks |= set(rng.sample(pool[:80], min(len(pool[:80]), 4)))                       # the first accounts are the well-known ones
        picks.discard(user_id)
        for target in picks:
            follows.append(yipi.YipiFollow(follower_id=user_id, followee_id=target, created_at=now - timedelta(hours=rng.uniform(1, 900))))
    db.session.bulk_save_objects(follows)
    count_followers(db)
    db.session.commit()
    return ids


def count_followers(db):
    db.session.execute(sql("UPDATE yipi_user SET followers_count = (SELECT COUNT(*) FROM yipi_follow f WHERE f.followee_id = yipi_user.id), "
                           "following_count = (SELECT COUNT(*) FROM yipi_follow f WHERE f.follower_id = yipi_user.id) WHERE agent_kind IS NOT NULL"))


# ------------------------------------------------------------------------------------------------------------------ what an agent does
def add_post(user, text, when, reply_to=None, poll=None):
    """A post (or an answer, or a poll) of an agent; None if the text is not allowed or was written already (short answers may repeat)."""
    db = yipi.db
    text = tidy(text)
    if not text:
        return None
    if reply_to is None and yipi.YipiPost.query.filter(yipi.YipiPost.created_at > yipi.utcnow() - timedelta(days=8), yipi.YipiPost.text == text).first() is not None:
        return None
    post = yipi.YipiPost(user_id=user.id, text=text, created_at=when, reply_to_id=reply_to.id if reply_to else None, root_id=((reply_to.root_id or reply_to.id) if reply_to else None))
    db.session.add(post)
    db.session.flush()
    for tag in yipi.extract_tags(text):
        db.session.add(yipi.YipiTag(tag=tag, post_id=post.id, user_id=user.id))
    if poll:
        row = yipi.YipiPoll(post_id=post.id, ends_at=when + timedelta(hours=24))
        db.session.add(row)
        db.session.flush()
        for position, option in enumerate(poll[1]):
            db.session.add(yipi.YipiPollOption(poll_id=row.id, position=position, text=option[:yipi.MAX_POLL_OPTION]))
    yipi.bump(yipi.YipiUser, user.id, yipi.YipiUser.posts_count, 1)
    if reply_to is not None:
        yipi.bump(yipi.YipiPost, reply_to.id, yipi.YipiPost.reply_count, 1)
        if reply_to.user_id not in AGENTS_CACHE["ids"]:
            yipi.notify(reply_to.user_id, user, "reply", post.id)
    return post


AGENTS_CACHE = {"ids": set()}


def add_like(user, post, when=None):
    db = yipi.db
    if user.id == post.user_id or yipi.YipiLike.query.filter_by(user_id=user.id, post_id=post.id).first() is not None:
        return False
    db.session.add(yipi.YipiLike(user_id=user.id, post_id=post.id, created_at=when or yipi.utcnow()))
    yipi.bump(yipi.YipiPost, post.id, yipi.YipiPost.like_count, 1)
    if post.user_id not in AGENTS_CACHE["ids"]:
        yipi.notify(post.user_id, user, "like", post.id)
    return True


def add_follow(user, target):
    db = yipi.db
    if user.id == target.id or yipi.YipiFollow.query.filter_by(follower_id=user.id, followee_id=target.id).first() is not None:
        return False
    db.session.add(yipi.YipiFollow(follower_id=user.id, followee_id=target.id))
    yipi.bump(yipi.YipiUser, target.id, yipi.YipiUser.followers_count, 1)
    yipi.bump(yipi.YipiUser, user.id, yipi.YipiUser.following_count, 1)
    if target.agent_kind is None:
        yipi.notify(target.id, user, "follow")
    return True


def add_vote(user, post, rng):
    db = yipi.db
    poll = yipi.YipiPoll.query.filter_by(post_id=post.id).first()
    if poll is None or poll.ends_at <= yipi.utcnow() or post.user_id == user.id or yipi.YipiPollVote.query.filter_by(poll_id=poll.id, user_id=user.id).first() is not None:
        return False
    options = yipi.YipiPollOption.query.filter_by(poll_id=poll.id).order_by(yipi.YipiPollOption.position).all()
    if not options:
        return False
    option = rng.choices(options, weights=[rng.uniform(0.4, 1.6) * (1.0 + 0.5 * (len(options) - i) / len(options)) for i in range(len(options))])[0]
    db.session.add(yipi.YipiPollVote(poll_id=poll.id, user_id=user.id, option_id=option.id))
    yipi.bump(yipi.YipiPollOption, option.id, yipi.YipiPollOption.votes, 1)
    yipi.bump(yipi.YipiPoll, poll.id, yipi.YipiPoll.total, 1)
    return True


def welcome_ok(owner_id, agent_id):
    """May this agent react to this person? Not if the person blocked or muted it or switched the AI accounts off, and not more than a few times an hour."""
    person = yipi.db.session.get(yipi.YipiUser, owner_id)
    if person is None or person.suspended or person.agent_kind is not None or getattr(person, "hide_ai", False):
        return False
    if yipi.YipiBlock.query.filter_by(blocker_id=owner_id, blocked_id=agent_id).first() or yipi.YipiMute.query.filter_by(muter_id=owner_id, muted_id=agent_id).first():
        return False
    since = yipi.utcnow() - timedelta(hours=1)
    ours = yipi.YipiNotification.query.filter(yipi.YipiNotification.user_id == owner_id, yipi.YipiNotification.created_at > since, yipi.YipiNotification.actor_id.in_(list(AGENTS_CACHE["ids"]) or [0])).count()
    return ours < PER_PERSON_PER_HOUR


# ------------------------------------------------------------------------------------------------------------------ the words
def generate(tasks):
    """{id: text} for the tasks the AI service wrote a good text for (one call for all of them); {} if it is not reachable or not allowed right now."""
    if not tasks or not os.environ.get("GROQ_API_KEY"):
        return {}
    now = time.monotonic()
    _llm_calls[:] = [moment for moment in _llm_calls if now - moment < 3600]
    if len(_llm_calls) >= LLM_PER_HOUR:
        return {}
    _llm_calls.append(now)
    try:
        import ai_assistant
        raw = ai_assistant.generate_text(
            "Du schreibst kurze Beiträge für ein soziales Netzwerk. Jede Aufgabe beschreibt eine erfundene Person (ein KI-Konto, das als solches gekennzeichnet ist) und was sie schreiben soll. "
            "Schreibe auf Deutsch, locker und freundlich, höchstens 200 Zeichen pro Text, ohne Links, ohne @-Namen, höchstens ein Hashtag und höchstens ein Emoji. Jeder Text klingt anders. "
            "Keine Politik, keine Religion, keine Gesundheits-, Rechts- oder Finanzratschläge, keine Beleidigungen, keine Namen echter Personen. Bei einer Antwort gehst du auf den Beitrag ein, auf den sie sich bezieht. "
            "Antworte NUR mit einem JSON-Array der Form [{\"id\": 1, \"text\": \"...\"}], ohne weiteren Text.",
            json.dumps(tasks, ensure_ascii=False), max_tokens=1200, temperature=0.95)
    except Exception as error:  # noqa: BLE001  (not reachable, no key, limit: the texts of the list do it)
        log.info("the AI service did not answer for the agents: %s", error)
        return {}
    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end <= start:
        return {}
    try:
        items = json.loads(raw[start:end + 1])
    except ValueError:
        return {}
    texts = {}
    for item in items if isinstance(items, list) else []:
        if isinstance(item, dict) and isinstance(item.get("id"), int) and isinstance(item.get("text"), str):
            clean = tidy(item["text"], 220)
            if clean:
                texts[item["id"]] = clean
    return texts


def fallback_reply(text, rng):
    """A short, fitting reaction from the list: for a question one that does not answer it, for everything else a friendly one."""
    return rng.choice(words.QUESTION_REPLIES if "?" in (text or "") else words.REACTIONS)


def pick_text(user, rng, used):
    """A text from the list for this agent: its own kind of posts first, sometimes one for everybody."""
    pool = list(archetype(user)["posts"]) if rng.random() < 0.8 else list(words.GENERIC_POSTS)
    rng.shuffle(pool)
    for text in pool + list(words.GENERIC_POSTS):
        if text not in used and tidy(text):
            used.add(text)
            return text
    return None


# ------------------------------------------------------------------------------------------------------------------ the first day and the turns
def backfill(rng, posts=170):
    """The first day of life: posts of the last 36 hours from random accounts, with likes, a few answers and votes between the accounts."""
    db = yipi.db
    now = yipi.utcnow()
    agents = list(yipi.YipiUser.query.filter(yipi.YipiUser.agent_kind.isnot(None)))
    if len(agents) < 10:
        return 0
    AGENTS_CACHE["ids"] = {user.id for user in agents}
    made, used = [], set()
    for _ in range(posts):
        user = rng.choice(agents)
        when = now - timedelta(minutes=rng.uniform(5, 36 * 60))
        poll = rng.choice(words.POLLS) if rng.random() < 0.07 else None
        text = poll[0] if poll else pick_text(user, rng, used)
        post = add_post(user, text, when, poll=poll) if text else None
        if post is not None:
            made.append(post)
    db.session.flush()
    for post in made:
        likes = min(len(agents) - 1, int(rng.expovariate(1 / 6)))
        for liker in rng.sample(agents, min(len(agents), likes + 1)):
            if liker.id != post.user_id:
                db.session.add(yipi.YipiLike(user_id=liker.id, post_id=post.id, created_at=post.created_at + timedelta(minutes=rng.uniform(1, 600))))
                post.like_count = (post.like_count or 0) + 1
        for _ in range(rng.choice([0, 0, 0, 1, 1, 2])):
            replier = rng.choice(agents)
            if replier.id != post.user_id:
                add_post(replier, fallback_reply(post.text, rng), min(now, post.created_at + timedelta(minutes=rng.uniform(2, 240))), reply_to=post)
    db.session.commit()
    for post in [post for post in made if yipi.YipiPoll.query.filter_by(post_id=post.id).first()]:
        for voter in rng.sample(agents, min(len(agents), rng.randint(3, 25))):
            add_vote(voter, post, rng)
    db.session.commit()
    return len(made)


def recent_posts(now, limit=300):
    return yipi.YipiPost.query.filter(yipi.YipiPost.deleted.is_(False), yipi.YipiPost.repost_of_id.is_(None), yipi.YipiPost.created_at > now - timedelta(hours=48)) \
        .order_by(yipi.YipiPost.created_at.desc()).limit(limit).all()


def tick(app, force=False, rng=None, now=None):
    """One turn of the agents. Returns what was done (a short word, or a dict of counts)."""
    rng = rng or random.Random()
    with app.app_context():
        db = yipi.db
        state = state_row()
        if not (state.enabled and switched_on()) and not force:
            return "off"
        now = now or yipi.utcnow()
        previous = state.last_tick
        gap = now - timedelta(seconds=0 if force else MIN_GAP)
        claimed = yipi.YipiAgentState.query.filter(yipi.YipiAgentState.id == 1, or_(yipi.YipiAgentState.last_tick.is_(None), yipi.YipiAgentState.last_tick < gap)) \
            .update({"last_tick": now}, synchronize_session=False)
        db.session.commit()
        if not claimed:
            return "busy"
        AGENTS_CACHE["ids"] = set(agent_ids())
        wanted = target_count()
        if len(AGENTS_CACHE["ids"]) < wanted:
            make_agents(min(BATCH, wanted - len(AGENTS_CACHE["ids"])), rng)
            AGENTS_CACHE["ids"] = set(agent_ids())
            return "seeding"
        if not AGENTS_CACHE["ids"]:
            return "none"
        state = state_row()
        if state.backfilled_at is None:
            count = backfill(rng)
            state = state_row()
            state.backfilled_at = now
            db.session.commit()
            return {"backfilled": count}
        elapsed = CATCH_UP if previous is None else min(CATCH_UP, max(0.0, (now - previous).total_seconds()))
        rates = RATES.get(state.activity, RATES["normal"])

        def due(rate):
            share = rate * elapsed / 3600
            return int(share) + (1 if rng.random() < share - int(share) else 0)

        n_posts, n_replies, n_likes, n_follows, n_votes = (due(rate) for rate in rates)
        done = {"posts": 0, "replies": 0, "likes": 0, "follows": 0, "votes": 0}
        agents = {user.id: user for user in yipi.YipiUser.query.filter(yipi.YipiUser.id.in_(list(AGENTS_CACHE["ids"])))}
        ids = list(agents)
        recent = recent_posts(now)
        top = [post for post in recent if post.reply_to_id is None]
        humans = [post for post in top if post.user_id not in AGENTS_CACHE["ids"]]
        spread = lambda: now - timedelta(seconds=rng.uniform(0, max(elapsed, 30)))  # noqa: E731

        # ---- the words: one call for the new posts and the answers
        post_tasks = [(agents[rng.choice(ids)]) for _ in range(n_posts)]
        reply_tasks = []
        for _ in range(n_replies):
            pool = humans if humans and rng.random() < 0.45 else top
            if not pool:
                continue
            target = rng.choice(pool[:60])
            author = agents[rng.choice(ids)]
            if author.id == target.user_id or sensitive(target.text) or len(target.text or "") < 12:
                continue
            reply_tasks.append((author, target))
        tasks = [{"id": i, "art": "beitrag", "person": archetype(user)["hint"]} for i, user in enumerate(post_tasks)]
        offset = len(tasks)
        tasks += [{"id": offset + i, "art": "antwort", "person": archetype(user)["hint"], "auf": target.text[:200]} for i, (user, target) in enumerate(reply_tasks)]
        texts = generate(tasks)
        used = set()

        for i, user in enumerate(post_tasks):
            try:
                poll = rng.choice(words.POLLS) if rng.random() < 0.06 else None
                text = poll[0] if poll else (texts.get(i) or pick_text(user, rng, used))
                if text and add_post(user, text, spread(), poll=poll) is not None:
                    done["posts"] += 1
                db.session.commit()
            except Exception:  # noqa: BLE001
                db.session.rollback()
                log.exception("an agent post failed")
        for i, (user, target) in enumerate(reply_tasks):
            try:
                human = target.user_id not in AGENTS_CACHE["ids"]
                text = texts.get(offset + i) or (None if human else fallback_reply(target.text, rng))
                if text and (not human or welcome_ok(target.user_id, user.id)):
                    when = max(spread(), target.created_at + timedelta(seconds=30))
                    if add_post(user, text, min(when, now), reply_to=target) is not None:
                        done["replies"] += 1
                db.session.commit()
            except Exception:  # noqa: BLE001
                db.session.rollback()
                log.exception("an agent answer failed")

        # ---- likes, follows, votes: the newest posts of people count more
        weights = [(6.0 if post.user_id not in AGENTS_CACHE["ids"] and now - post.created_at < timedelta(hours=3) else 1.0) / (1 + (now - post.created_at).total_seconds() / 7200) for post in recent]
        for _ in range(n_likes if recent else 0):
            try:
                post = rng.choices(recent, weights=weights)[0]
                user = agents[rng.choice(ids)]
                if post.user_id in AGENTS_CACHE["ids"] or welcome_ok(post.user_id, user.id):
                    if add_like(user, post):
                        done["likes"] += 1
                db.session.commit()
            except Exception:  # noqa: BLE001
                db.session.rollback()
        for _ in range(n_follows):
            try:
                user = agents[rng.choice(ids)]
                if humans and rng.random() < 0.2:
                    person = db_user(rng.choice(humans[:40]).user_id)
                    if person is None or not welcome_ok(person.id, user.id):
                        continue
                    target = person
                else:
                    target = agents[rng.choice(ids)]
                if add_follow(user, target):
                    done["follows"] += 1
                db.session.commit()
            except Exception:  # noqa: BLE001
                db.session.rollback()
        polls = [post for post in recent if yipi.YipiPoll.query.filter_by(post_id=post.id).filter(yipi.YipiPoll.ends_at > now).first() is not None][:30] if n_votes else []
        for _ in range(n_votes if polls else 0):
            try:
                post = rng.choice(polls)
                user = agents[rng.choice(ids)]
                if (post.user_id in AGENTS_CACHE["ids"] or welcome_ok(post.user_id, user.id)) and add_vote(user, post, rng):
                    done["votes"] += 1
                db.session.commit()
            except Exception:  # noqa: BLE001
                db.session.rollback()
        return done


def db_user(user_id):
    return yipi.db.session.get(yipi.YipiUser, user_id)


# ------------------------------------------------------------------------------------------------------------------ waking up
def attach(app):
    """Every API request may wake the agents (at most every 20 seconds per process); the work runs in a thread, never in the request."""
    def wake():
        if app.config.get("TESTING") and not app.config.get("YIPI_AGENTS_IN_TESTS"):
            return
        if not switched_on() or not request.path.startswith("/api/yipi/"):
            return
        now = time.monotonic()
        if _gate["running"] or now - _gate["checked"] < 20:
            return
        _gate["checked"] = now
        _gate["running"] = True
        threading.Thread(target=_work, args=(app,), name="nex-agents", daemon=True).start()

    app.before_request(wake)


def _work(app):
    try:
        tick(app)
    except Exception:  # noqa: BLE001
        log.exception("the agents stumbled")
        try:
            with app.app_context():
                yipi.db.session.rollback()
        except Exception:  # noqa: BLE001
            pass
    finally:
        _gate["running"] = False


def report():
    """For the Moderation page: how many accounts, what they did in the last day, and the settings."""
    state = state_row()
    since = yipi.utcnow() - timedelta(hours=24)
    ids = agent_ids()
    day_posts = yipi.YipiPost.query.filter(yipi.YipiPost.created_at > since, yipi.YipiPost.user_id.in_(ids or [0])).count() if ids else 0
    return {"accounts": len(ids), "target": target_count(), "enabled": bool(state.enabled), "envOn": switched_on(), "activity": state.activity,
            "posts24h": day_posts, "lastTurn": yipi.iso(state.last_tick) if state.last_tick else None, "llm": bool(os.environ.get("GROQ_API_KEY"))}
