"""Satürn calls (2026-10-31): a call with a friend or with a group, live, from the chat.

How it works: the caller taps the handset in the head of a chat. The people called get a notification (a window with a ringing sound in the page, and a push on a phone that is
locked), one of them answers, and from then on every browser sends its microphone in short pieces (half a second of 16 kHz sound, one byte per sample) and asks for the pieces of the
others in the same breath (`sync`). The voice is never written anywhere: it lives in the memory of this process (see CALLS), it is never recorded and never logged. A piece is deleted
KEEP_AFTER_PLAY seconds after the person it was for has played it (the browser says so with the next `sync`), and at the latest MAX_AGE seconds after it came in (when nobody asked for it).
Who is in which call, and who rings whom, is kept the same way and forgotten a minute after the call ends. The chat gets one line when it is over ("📞 Anruf · 2:31" or "📞 Verpasster Anruf").

Rules: you can only ring people who count you as a chat partner (the conversation is in their main chats: they follow you, accepted you or wrote to you first) and who did not block you,
never an AI or an official account; one call at a time per person; a group call rings the members of the group (up to MAX_PEOPLE people); a call ends when fewer than two people are in it.
The site runs one process with several threads (see Procfile), so one lock guards the table. With several processes the people of a call would have to reach the same one."""
import base64
import secrets
import threading
import time

from flask import jsonify, request

import yipi

RING_SECONDS = 45             # how long a call rings
KEEP_AFTER_PLAY = 10          # a piece of voice is deleted this many seconds after the person it was for has played it
MAX_AGE = 30                  # ... and in any case this many seconds after it came in
SILENCE_SECONDS = 15          # somebody who has not been heard of for this long has left the call (a closed tab, a lost connection)
MAX_CALL_SECONDS = 2 * 3600
KEEP_ENDED = 60               # how long the table remembers a call that is over (so the others learn that it ended)
MAX_PEOPLE = 8
MAX_CHUNK = 48_000            # bytes of one piece: three seconds of the sound the page sends
MAX_PER_SYNC = 24             # pieces answered at once

clock = time.monotonic        # the tests replace it
CALLS = {}                    # call id -> Call
LOCK = threading.RLock()


class Person:
    __slots__ = ("user_id", "state", "seen", "brief")

    def __init__(self, user_id, state, brief):
        self.user_id = user_id
        self.state = state            # "invited" | "joined" | "declined" | "left"
        self.seen = clock()
        self.brief = brief            # {"handle", "name", "avatar"}


class Chunk:
    __slots__ = ("seq", "sender", "data", "made", "to", "played")

    def __init__(self, seq, sender, data, made, to):
        self.seq = seq
        self.sender = sender
        self.data = data              # base64 text, made once for all who fetch it
        self.made = made
        self.to = to                  # the ids of the people who are in the call and have to hear it
        self.played = {}              # id -> when that person said it was played


class Call:
    def __init__(self, kind, caller, group=None):
        self.id = secrets.token_urlsafe(12)
        self.kind = kind              # "dm" | "group"
        self.caller_id = caller.id
        self.group_id = group.id if group else None
        self.group_name = group.name if group else ""
        self.people = {}
        self.status = "ringing"       # "ringing" until a second person joins, then "active", at last "ended"
        self.reason = ""              # why it ended: "ended" | "missed" | "cancelled" | "declined" | "timeout"
        self.made = clock()
        self.answered = None
        self.ended = None
        self.seq = 0
        self.chunks = []
        self.logged = False

    def joined(self):
        return [p for p in self.people.values() if p.state == "joined"]


def busy_call(user_id):
    """The call this person is in (joined), or None."""
    for call in CALLS.values():
        if call.status != "ended" and call.people.get(user_id) is not None and call.people[user_id].state == "joined":
            return call
    return None


def call_json(call, viewer_id):
    me = call.people.get(viewer_id)
    now = clock()
    return {"id": call.id, "kind": call.kind, "status": call.status, "reason": call.reason, "group": {"id": call.group_id, "name": call.group_name} if call.group_id else None,
            "me": me.state if me else None, "seq": call.seq, "seconds": int(now - call.answered) if call.answered and call.status == "active" else 0,
            "ringLeft": max(0, int(RING_SECONDS - (now - call.made))) if call.status == "ringing" else 0, "caller": call.people[call.caller_id].brief,
            "people": [{"id": p.user_id, "handle": p.brief["handle"], "name": p.brief["name"], "avatar": p.brief["avatar"], "state": p.state} for p in call.people.values()]}


def minutes(seconds):
    return f"{seconds // 60}:{seconds % 60:02d}"


def log_line(call):
    """One line in the chat of the call when it is over (not for a call that nobody ever answered and that was only cancelled: that is a missed call)."""
    if call.logged:
        return
    call.logged = True
    heard = call.answered is not None
    seconds = int((call.ended or clock()) - call.answered) if heard else 0
    if call.kind == "dm":
        callee = next((p for p in call.people.values() if p.user_id != call.caller_id), None)
        if callee is None:
            return
        text = f"📞 Anruf · {minutes(seconds)}" if heard else "📞 Anruf abgelehnt" if call.reason == "declined" else "📞 Verpasster Anruf"
        yipi.db.session.add(yipi.YipiMessage(sender_id=call.caller_id, recipient_id=callee.user_id, text=text, read=heard or call.reason == "declined"))
        yipi.db.session.commit()
        if not heard and call.reason != "declined":
            yipi.push_later(callee.user_id, "Satürn", f"Verpasster Anruf von {call.people[call.caller_id].brief['name']}", f"/messages/{call.people[call.caller_id].brief['handle']}", tag=f"call-{call.id}", urgent=True)
    else:
        text = f"📞 Gruppenanruf · {minutes(seconds)}" if heard else "📞 Verpasster Gruppenanruf"
        yipi.db.session.add(yipi.YipiGroupMessage(group_id=call.group_id, sender_id=call.caller_id, text=text))
        yipi.db.session.commit()


def end(call, reason):
    if call.status == "ended":
        return
    call.status = "ended"
    call.reason = reason
    call.ended = clock()
    for person in call.people.values():
        if person.state in ("joined", "invited"):
            person.state = "left"
    try:
        log_line(call)
    except Exception:                      # noqa: BLE001  (a call that is over must end even when the line in the chat fails)
        yipi.db.session.rollback()
        yipi.logger.exception("Could not write the line of a call")


def sweep():
    """Moves every call on: people who went quiet leave, calls that rang for too long are missed, voice that was played or is old is deleted, old calls are forgotten. (Called by every request.)"""
    now = clock()
    with LOCK:
        for call in list(CALLS.values()):
            if call.status != "ended":
                for person in call.joined():
                    if now - person.seen > SILENCE_SECONDS:
                        person.state = "left"
                joined = call.joined()
                if call.status == "ringing":
                    if call.caller_id not in {p.user_id for p in joined}:
                        end(call, "cancelled")
                    elif len(joined) >= 2:
                        call.status = "active"
                        call.answered = call.answered or now
                    elif now - call.made > RING_SECONDS:
                        end(call, "missed")
                    elif not any(p.state == "invited" for p in call.people.values()):
                        end(call, "declined")
                elif len(joined) < 2:
                    end(call, "ended")
                elif now - call.made > MAX_CALL_SECONDS:
                    end(call, "timeout")
            if call.status == "ended":
                if now - call.ended > KEEP_ENDED:
                    del CALLS[call.id]
                else:
                    call.chunks = [c for c in call.chunks if now - (call.ended or now) < KEEP_AFTER_PLAY]
                continue
            kept = []
            for chunk in call.chunks:
                everybody = chunk.to and all(user_id in chunk.played for user_id in chunk.to)
                if everybody and now - max(chunk.played.values()) >= KEEP_AFTER_PLAY:
                    continue
                if now - chunk.made >= MAX_AGE:
                    continue
                kept.append(chunk)
            call.chunks = kept


def reset():
    with LOCK:
        CALLS.clear()


def register(route, need_user, body, find_user):
    """The routes (called by yipi.register_routes with its own helpers)."""
    fail = yipi.fail
    limiter = yipi.limiter

    def mine(user, call_id):
        call = CALLS.get(str(call_id))
        if call is None or user.id not in call.people:
            return None
        return call

    def brief(user):
        return {"handle": user.handle, "name": user.name, "avatar": yipi.media_url(user.avatar_id)}

    def forbidden(user, other):
        hidden = yipi.hidden_user_ids(user)
        if other.id in hidden or user.id in yipi.hidden_user_ids(other):
            return "blocked"
        if other.company:
            return "official_account"
        if other.agent_kind is not None:
            return "ai_account"
        if yipi.dm_boxes(other, [user.id])[user.id] != "primary":
            return "call_not_allowed"
        return None

    def ring(call, caller, targets):
        title = "Satürn"
        for target in targets:
            text = f"{caller.name} ruft dich an" if call.kind == "dm" else f"{caller.name} ruft in „{call.group_name}“ an"
            url = f"/messages/{caller.handle}" if call.kind == "dm" else f"/g/{call.group_id}"
            yipi.push_later(target.id, title, text, url, tag=f"call-{call.id}", urgent=True)

    @route("/api/yipi/calls", methods=["POST"], endpoint="yipi_call_start")
    def yipi_call_start():
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        if limiter.too_many("call-start", str(user.id)):
            return fail("too_many", 429)
        sweep()
        handle, group_id = data.get("handle"), data.get("groupId")
        with LOCK:
            current = busy_call(user.id)
            if current is not None:
                return fail("in_call", 409, call=call_json(current, user.id))
            if isinstance(handle, str):
                other = find_user(handle)
                if other is None or other.suspended:
                    return fail("not_found", 404)
                if other.id == user.id:
                    return fail("self", 400)
                why = forbidden(user, other)
                if why:
                    return fail(why, 403)
                if busy_call(other.id) is not None:
                    return fail("busy", 409)
                call = Call("dm", user)
                call.people[user.id] = Person(user.id, "joined", brief(user))
                call.people[other.id] = Person(other.id, "invited", brief(other))
                CALLS[call.id] = call
                ring(call, user, [other])
                return jsonify({"ok": True, "call": call_json(call, user.id)}), 201
            if isinstance(group_id, int) and not isinstance(group_id, bool):
                group = yipi.db.session.get(yipi.YipiGroup, group_id)
                if group is None or yipi.YipiGroupMember.query.filter_by(group_id=group_id, user_id=user.id).first() is None:
                    return fail("not_found", 404)
                running = next((c for c in CALLS.values() if c.group_id == group_id and c.status != "ended"), None)
                if running is not None:                                  # the group is already talking: this joins them
                    person = running.people.get(user.id)
                    if person is None:
                        if len(running.people) >= MAX_PEOPLE:
                            return fail("call_full", 409)
                        person = running.people[user.id] = Person(user.id, "joined", brief(user))
                    person.state, person.seen = "joined", clock()
                    sweep()
                    return jsonify({"ok": True, "call": call_json(running, user.id)}), 201
                member_ids = [row.user_id for row in yipi.YipiGroupMember.query.filter_by(group_id=group_id).all() if row.user_id != user.id]
                hidden = yipi.hidden_user_ids(user)
                members = [m for m in yipi.YipiUser.query.filter(yipi.YipiUser.id.in_(member_ids)).all()
                           if not m.suspended and m.id not in hidden and m.company is not True and m.agent_kind is None and user.id not in yipi.hidden_user_ids(m)]
                members = members[:MAX_PEOPLE - 1]
                if not members:
                    return fail("call_nobody", 409)
                call = Call("group", user, group)
                call.people[user.id] = Person(user.id, "joined", brief(user))
                for member in members:
                    call.people[member.id] = Person(member.id, "invited", brief(member))
                CALLS[call.id] = call
                ring(call, user, members)
                return jsonify({"ok": True, "call": call_json(call, user.id)}), 201
        return fail("bad_request", 400)

    @route("/api/yipi/calls/incoming")
    def yipi_call_incoming():
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("call-poll", str(user.id)):
            return fail("too_many", 429)
        sweep()
        with LOCK:
            ringing = None
            for call in CALLS.values():
                person = call.people.get(user.id)
                if call.status == "ringing" and person is not None and person.state == "invited":
                    if ringing is None or call.made > ringing.made:
                        ringing = call
            active = busy_call(user.id)
            return jsonify({"ok": True, "call": call_json(ringing, user.id) if ringing else None, "active": call_json(active, user.id) if active else None})

    @route("/api/yipi/calls/active")
    def yipi_call_active():
        """Is there a call going on in this group (so that its chat can offer "Beitreten")?"""
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("call-poll", str(user.id)):
            return fail("too_many", 429)
        sweep()
        group_id = request.args.get("groupId", type=int)
        with LOCK:
            running = next((c for c in CALLS.values() if group_id and c.group_id == group_id and c.status != "ended"), None)
            if running is None or yipi.YipiGroupMember.query.filter_by(group_id=group_id, user_id=user.id).first() is None:
                return jsonify({"ok": True, "call": None})
            return jsonify({"ok": True, "call": call_json(running, user.id)})

    def act(call_id, what):
        user, problem = need_user()
        if problem:
            return None, problem
        if limiter.too_many("call-act", str(user.id)):
            return None, fail("too_many", 429)
        sweep()
        with LOCK:
            call = mine(user, call_id)
            if call is None:
                return None, fail("not_found", 404)
            return (user, call), None

    @route("/api/yipi/calls/<call_id>/answer", methods=["POST"], endpoint="yipi_call_answer")
    def yipi_call_answer(call_id):
        got, problem = act(call_id, "answer")
        if problem:
            return problem
        user, call = got
        with LOCK:
            if call.status == "ended":
                return fail("call_over", 410)
            other = busy_call(user.id)
            if other is not None and other is not call:
                return fail("in_call", 409)
            person = call.people[user.id]
            person.state, person.seen = "joined", clock()
            sweep()
            return jsonify({"ok": True, "call": call_json(call, user.id)})

    @route("/api/yipi/calls/<call_id>/decline", methods=["POST"], endpoint="yipi_call_decline")
    def yipi_call_decline(call_id):
        got, problem = act(call_id, "decline")
        if problem:
            return problem
        user, call = got
        with LOCK:
            person = call.people[user.id]
            if person.state == "invited":
                person.state = "declined"
            sweep()
            return jsonify({"ok": True, "call": call_json(call, user.id)})

    @route("/api/yipi/calls/<call_id>/hangup", methods=["POST"], endpoint="yipi_call_hangup")
    def yipi_call_hangup(call_id):
        got, problem = act(call_id, "hangup")
        if problem:
            return problem
        user, call = got
        with LOCK:
            person = call.people[user.id]
            if person.state == "joined":
                person.state = "left"
            elif person.state == "invited":
                person.state = "declined"
            sweep()
            return jsonify({"ok": True, "call": call_json(call, user.id)})

    @route("/api/yipi/calls/<call_id>/sync", methods=["POST"], endpoint="yipi_call_sync")
    def yipi_call_sync(call_id):
        user, problem = need_user()
        if problem:
            return problem
        if limiter.too_many("call-sync", str(user.id)):
            return fail("too_many", 429)
        if request.content_length is not None and request.content_length > MAX_CHUNK:
            return fail("attachment_too_big", 413)
        data = request.get_data(cache=False)
        if len(data) > MAX_CHUNK:
            return fail("attachment_too_big", 413)
        after = request.args.get("after", 0, type=int) or 0
        played = request.args.get("played", 0, type=int) or 0
        sweep()
        with LOCK:
            call = mine(user, call_id)
            if call is None:
                return fail("not_found", 404)
            person = call.people[user.id]
            if call.status == "ended":
                return jsonify({"ok": True, "call": call_json(call, user.id), "chunks": []})
            if person.state != "joined":
                return fail("not_joined", 409)
            now = clock()
            person.seen = now
            if data and call.status == "active":
                call.seq += 1
                to = {p.user_id for p in call.joined() if p.user_id != user.id}
                call.chunks.append(Chunk(call.seq, user.id, base64.b64encode(data).decode("ascii"), now, to))
            if played:
                for chunk in call.chunks:
                    if chunk.seq <= played and user.id in chunk.to and user.id not in chunk.played:
                        chunk.played[user.id] = now
            out = [{"seq": c.seq, "from": c.sender, "data": c.data} for c in call.chunks if c.seq > after and c.sender != user.id and user.id in c.to][:MAX_PER_SYNC]
            return jsonify({"ok": True, "call": call_json(call, user.id), "chunks": out})
