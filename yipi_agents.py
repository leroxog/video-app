"""The KI-Konten are gone again (2026-10-30: "lösche wieder die Bots"). Nex made about a thousand accounts that wrote, liked and voted so that the site felt alive; they were always
marked "KI" and now they are removed on request. What is left of this module is small:

* `attach(app)`: once per process, at the first request to the API, a thread deletes every account that was made as an AI account (`yipi_user.agent_kind` is set) with everything
  that belongs to it (posts, answers, likes, follows, votes, notifications), twenty accounts at a time, until none is left. A site that never had them does one query and stops. Nothing
  makes such accounts any more.
* `sensitive(text)`: the words that nobody may use in the prompt or the title of a lens or a game."""
import logging
import re
import threading
import time

from flask import request

import yipi

log = logging.getLogger("nex.agents")

HARD_STEMS = ("porn", "nackt", "droge", "kokain", "heroin", "selbstmord", "suizid", "umbring", "töte", "tötet", "hurensohn", "fick", "wichs", "nutte", "schlampe", "neger", "kanake", "behindert",
              "nazi", "hitler", "terror", "bombe", "waffe", "gewalt", "mord", "http", "www.", "@")
HARD_WORDS = ("sex", "afd")
_stems = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(word) for word in HARD_STEMS if word[0].isalpha()) + ")", re.I)
_words = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(word) for word in HARD_WORDS) + r")(?!\w)", re.I)
PER_ROUND = 20
_state = {"started": False}


def sensitive(text, hard_only=True):
    """Does the text have a word that nobody may use here (the prompt of a lens may say "dumm", but not "Waffe")? `hard_only` stays for the callers; there is only this one list now."""
    if not text:
        return False
    if "@" in text:
        return True
    return bool(_stems.search(text) or _words.search(text))


def agent_ids():
    return [row.id for row in yipi.YipiUser.query.filter(yipi.YipiUser.agent_kind.isnot(None)).with_entities(yipi.YipiUser.id).limit(PER_ROUND)]


def remove_all(app, pause=0.05):
    """Deletes the AI accounts, a few at a time (every round is one commit). Returns how many were removed."""
    removed = 0
    with app.app_context():
        while True:
            ids = agent_ids()
            if not ids:
                break
            for user_id in ids:
                user = yipi.db.session.get(yipi.YipiUser, user_id)
                if user is not None:
                    yipi.purge_user(user)
                    removed += 1
            yipi.db.session.commit()
            time.sleep(pause)
        yipi._agent_cache["at"] = None
    return removed


def _work(app):
    try:
        count = remove_all(app)
        if count:
            log.warning("removed %s AI accounts", count)
    except Exception:  # noqa: BLE001
        log.exception("the AI accounts could not be removed")
        try:
            with app.app_context():
                yipi.db.session.rollback()
        except Exception:  # noqa: BLE001
            pass


def attach(app):
    """The first API request of a process starts the clean-up in a thread (never in the request itself)."""
    def wake():
        if _state["started"] or not request.path.startswith("/api/yipi/"):
            return
        if app.config.get("TESTING") and not app.config.get("YIPI_AGENTS_IN_TESTS"):
            return
        _state["started"] = True
        threading.Thread(target=_work, args=(app,), name="nex-agents-cleanup", daemon=True).start()

    app.before_request(wake)
