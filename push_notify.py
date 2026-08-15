"""Real Web Push notifications for followed brands (see models.py's
BrandFollow/PushSubscription docstrings) -- delivered via the browser's own
Push API, not a fake/simulated notification. Requires VAPID_PUBLIC_KEY /
VAPID_PRIVATE_KEY to be set in the environment (generated once with
py_vapid, see this repo's README/commit history for how); without them,
notify_followers() logs a warning and does nothing rather than crashing
the request that triggered it (e.g. a company creating a new offer).

Import note: kept as its own module (not inside app.py) specifically so
seed_data.py can call notify_followers() too, when a brand-new
DiscountCode is inserted, without creating an app.py <-> seed_data.py
circular import.
"""
import os
import json
import logging

from pywebpush import webpush, WebPushException

from models import db, BrandFollow, PushSubscription

logger = logging.getLogger(__name__)

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY")
VAPID_CONTACT_EMAIL = os.environ.get("VAPID_CONTACT_EMAIL", "mailto:support@example.com")

_warned_missing_keys = False


def push_configured():
    return bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)


def notify_followers(brand_name, kind, title, body, url):
    """kind is "offer" or "code" -- only followers whose notify_mode allows
    that kind get a push. Expired/invalid subscriptions (the browser drops
    them over time) are removed on a failed send instead of retried."""
    global _warned_missing_keys
    if not push_configured():
        if not _warned_missing_keys:
            logger.warning("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY nicht gesetzt -- Push-Benachrichtigungen sind deaktiviert.")
            _warned_missing_keys = True
        return

    kind_mode = "offers" if kind == "offer" else "codes"
    wanted_modes = {"all", kind_mode}
    follows = BrandFollow.query.filter(
        BrandFollow.brand_name == brand_name, BrandFollow.notify_mode.in_(wanted_modes),
    ).all()
    if not follows:
        return

    payload = json.dumps({"title": title, "body": body, "url": url})
    for follow in follows:
        subs = PushSubscription.query.filter_by(user_id=follow.user_id).all()
        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=payload,
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": VAPID_CONTACT_EMAIL},
                )
            except WebPushException as exc:
                status = getattr(exc.response, "status_code", None)
                if status in (404, 410):
                    db.session.delete(sub)
                else:
                    logger.warning("Web Push fehlgeschlagen fuer Subscription %s: %s", sub.id, exc)
    db.session.commit()
