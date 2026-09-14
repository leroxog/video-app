"""Third-party services a user has connected via OAuth (see app.py's
/plugins/<service>/... routes and models.UserIntegration) -- Nex reads
from these when a user's message plausibly calls for it (see app.py's
_maybe_google_calendar_context). Currently just Google Calendar,
read-only. Adding another provider means the user registers an OAuth
app for it and hands over its client id/secret -- see UserIntegration's
docstring for why that step can't be skipped.

token_expires_at is stored and compared as a naive UTC datetime
(datetime.utcnow(), not datetime.now(timezone.utc)) throughout this
module, deliberately -- SQLite (used locally/in tests) drops tzinfo on
round-trip, and comparing a naive value read back from the DB against
an aware "now" raises TypeError. Naive-vs-naive throughout sidesteps
that on both SQLite and Postgres.
"""
import logging
from datetime import datetime, timedelta

import requests

from models import db, UserIntegration

logger = logging.getLogger(__name__)

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"


def _refresh_google_access_token(integration, client_id, client_secret):
    """Google access tokens expire after ~1h; use the stored refresh
    token to get a new one. Returns True and updates+commits the row on
    success; False if the refresh itself failed (most likely the user
    revoked access on Google's side) -- callers should treat that as
    "not usable right now" rather than raise."""
    if not integration.refresh_token:
        return False
    try:
        res = requests.post(GOOGLE_TOKEN_URL, data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": integration.refresh_token,
            "grant_type": "refresh_token",
        }, timeout=10)
        res.raise_for_status()
        data = res.json()
    except Exception:
        logger.exception("Google-Token-Refresh fehlgeschlagen (user_id=%s)", integration.user_id)
        return False
    integration.access_token = data["access_token"]
    integration.token_expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 3600))
    db.session.commit()
    return True


def get_upcoming_google_events(user, client_id, client_secret, max_results=5):
    """This user's next `max_results` Google Calendar events (each a
    {"summary", "start"} dict), soonest first. None if the user hasn't
    connected Google Calendar, or the lookup failed for any reason
    (expired/revoked access, Google outage, ...) -- callers should just
    skip offering calendar context in that case, never surface the
    failure to the chat itself."""
    integration = UserIntegration.query.filter_by(user_id=user.id, service="google").first()
    if integration is None:
        return None
    expires_at = integration.token_expires_at
    if expires_at is None or expires_at <= datetime.utcnow() + timedelta(seconds=60):
        if not _refresh_google_access_token(integration, client_id, client_secret):
            return None
    try:
        res = requests.get(
            GOOGLE_CALENDAR_EVENTS_URL,
            headers={"Authorization": f"Bearer {integration.access_token}"},
            params={
                "timeMin": datetime.utcnow().isoformat() + "Z",
                "maxResults": max_results,
                "singleEvents": "true",
                "orderBy": "startTime",
            },
            timeout=10,
        )
        res.raise_for_status()
        items = res.json().get("items", [])
    except Exception:
        logger.exception("Google-Kalender-Abfrage fehlgeschlagen (user_id=%s)", user.id)
        return None
    events = []
    for item in items:
        start = (item.get("start") or {}).get("dateTime") or (item.get("start") or {}).get("date")
        events.append({"summary": item.get("summary") or "(ohne Titel)", "start": start})
    return events
