import io
import os
import shutil
import sys
import tempfile
from datetime import date

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from app import app as flask_app, db
from models import (
    User, Conversation, Message,
    AiAdminFact, AiLearnedFact, PasswordResetCode, AccountRecoveryRequest, ErrorLog,
    AiVoiceProfile,
)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"

    upload_dir = tempfile.mkdtemp()
    flask_app.config["UPLOAD_FOLDER"] = upload_dir
    profile_pic_dir = tempfile.mkdtemp()
    flask_app.config["PROFILE_PIC_FOLDER"] = profile_pic_dir
    sound_dir = tempfile.mkdtemp()
    flask_app.config["SOUND_FOLDER"] = sound_dir

    with flask_app.app_context():
        db.create_all()
        test_client = flask_app.test_client()
        # Nearly every existing test predates the terms-of-service gate and
        # assumes gate-free browsing, mirroring a returning visitor who has
        # already accepted. Tests that specifically exercise the gate itself
        # use raw_client below instead.
        with test_client.session_transaction() as sess:
            sess["terms_accepted"] = True
        yield test_client
        db.drop_all()

    shutil.rmtree(upload_dir, ignore_errors=True)
    shutil.rmtree(profile_pic_dir, ignore_errors=True)
    shutil.rmtree(sound_dir, ignore_errors=True)


@pytest.fixture
def raw_client(client):
    """A client fixture without the pre-accepted terms-of-service session
    flag, for tests that exercise the gate itself."""
    with client.session_transaction() as sess:
        sess.pop("terms_accepted", None)
    return client


def register(client, username="alice", password="secret123", birthdate="2005-01-01", extra=None):
    client.post("/terms/accept")
    data = {
        "username": username,
        "password": password,
        "password2": password,
        "birthdate": birthdate,
        "gender": "keine_angabe",
        "purpose_of_use": "private",
        "country": "Deutschland",
        "region_skipped": "1",
    }
    if extra:
        data.update(extra)
    response = client.post("/register", data=data)
    if response.status_code in (301, 302, 303, 307, 308):
        client.post("/terms/accept")
        response = client.get(response.headers["Location"], follow_redirects=True)
    return response


def make_admin(username):
    user = User.query.filter_by(username=username).first()
    user.is_admin = True
    db.session.commit()


def test_register_and_login(client):
    response = register(client)
    assert response.status_code == 200

    client.post("/logout")
    response = client.post(
        "/login",
        data={"username": "alice", "password": "secret123"},
        follow_redirects=True,
    )
    assert response.status_code == 200
    # "/" is the download page for logged-in users now (see index()) --
    # anonymous visitors get redirected to /login instead of ever reaching
    # it, so its logout form is proof the login actually landed logged in.
    assert b"download-logout-btn" in response.data


def test_register_stores_birthdate_and_gender(client):
    register(client, username="alice")
    from datetime import date
    user = User.query.filter_by(username="alice").first()
    assert user.birthdate == date(2005, 1, 1)
    assert user.gender == "keine_angabe"


def test_register_rejects_mismatched_passwords(client):
    response = client.post(
        "/register",
        data={
            "username": "alice",
            "password": "secret123",
            "password2": "different123",
            "birthdate": "2005-01-01",
            "gender": "keine_angabe",
        },
        follow_redirects=True,
    )
    assert "stimmen nicht".encode() in response.data
    assert User.query.filter_by(username="alice").first() is None


def test_register_requires_birthdate_and_gender(client):
    response = client.post(
        "/register",
        data={"username": "alice", "password": "secret123", "password2": "secret123"},
        follow_redirects=True,
    )
    assert "alle Felder".encode() in response.data
    assert User.query.filter_by(username="alice").first() is None


def test_register_blocks_under_10(client):
    too_young = date.today().replace(year=date.today().year - 8)
    response = register(client, username="young", birthdate=too_young.isoformat())
    assert "mindestens 10 Jahre".encode() in response.data
    assert User.query.filter_by(username="young").first() is None


def test_register_teen_guardian_email_is_optional(client):
    # Guardian e-mail is recommended but never required, at any age --
    # a teen can register without one.
    teen_birthdate = date.today().replace(year=date.today().year - 15)
    response = register(client, username="teen", birthdate=teen_birthdate.isoformat())
    assert response.status_code == 200
    user = User.query.filter_by(username="teen").first()
    assert user is not None
    assert user.guardian_email is None

    client.post("/logout")
    register(
        client, username="teen2", birthdate=teen_birthdate.isoformat(),
        extra={"guardian_email": "parent@example.com"},
    )
    user2 = User.query.filter_by(username="teen2").first()
    assert user2 is not None
    assert user2.guardian_email == "parent@example.com"


def test_register_adult_guardian_email_optional(client):
    register(client, username="adult")
    user = User.query.filter_by(username="adult").first()
    assert user is not None
    assert user.guardian_email is None


def test_register_requires_purpose_and_country(client):
    response = client.post(
        "/register",
        data={
            "username": "nopurpose", "password": "secret123", "password2": "secret123",
            "birthdate": "2000-01-01", "gender": "keine_angabe",
        },
        follow_redirects=True,
    )
    assert "wofür du den Account nutzt".encode() in response.data
    assert User.query.filter_by(username="nopurpose").first() is None


def test_register_region_can_be_skipped(client):
    register(client, username="skipregion")
    user = User.query.filter_by(username="skipregion").first()
    assert user.region is None
    assert user.region_skipped is True


def test_register_country_and_region_both_skippable_together(client):
    # "Diese letzten beiden Fragen möchte ich nicht beantworten" covers
    # country AND region -- omitting country too (not just region) must
    # not block registration when the skip checkbox is set.
    response = client.post(
        "/register",
        data={
            "username": "skipboth", "password": "secret123", "password2": "secret123",
            "birthdate": "2000-01-01", "gender": "keine_angabe", "purpose_of_use": "private",
            "region_skipped": "1",
        },
        follow_redirects=True,
    )
    assert response.status_code == 200
    user = User.query.filter_by(username="skipboth").first()
    assert user is not None
    assert user.country is None
    assert user.region is None
    assert user.region_skipped is True


def test_register_requires_country_without_skip(client):
    response = client.post(
        "/register",
        data={
            "username": "nocountry", "password": "secret123", "password2": "secret123",
            "birthdate": "2000-01-01", "gender": "keine_angabe", "purpose_of_use": "private",
        },
        follow_redirects=True,
    )
    assert "Land angeben".encode() in response.data
    assert User.query.filter_by(username="nocountry").first() is None


def test_existing_account_gated_until_onboarding_completed(client):
    register(client, username="oldtimer")
    user = User.query.filter_by(username="oldtimer").first()
    user.purpose_of_use = None
    user.country = None
    db.session.commit()

    response = client.get("/", follow_redirects=False)
    assert response.status_code == 302
    assert "/complete-profile" in response.headers["Location"]

    complete_res = client.post(
        "/complete-profile",
        data={"purpose_of_use": "private", "country": "Deutschland", "region_skipped": "1"},
        follow_redirects=True,
    )
    assert complete_res.status_code == 200

    response2 = client.get("/")
    assert response2.status_code == 200


def test_complete_profile_asks_for_missing_birthdate_on_ancient_accounts(client):
    register(client, username="prehistoric")
    user = User.query.filter_by(username="prehistoric").first()
    user.purpose_of_use = None
    user.birthdate = None
    db.session.commit()

    response = client.get("/complete-profile")
    assert response.status_code == 200
    assert b'name="birthdate"' in response.data


def test_api_endpoints_not_blocked_by_onboarding_gate(client):
    register(client, username="apiuser")
    user = User.query.filter_by(username="apiuser").first()
    user.purpose_of_use = None
    db.session.commit()

    response = client.get("/api/my-stats")
    assert response.status_code != 302


def test_login_wrong_password(client):
    register(client)
    client.post("/logout")
    response = client.post(
        "/login",
        data={"username": "alice", "password": "wrong"},
        follow_redirects=True,
    )
    assert "falsch".encode() in response.data


def test_brand_wordmark_present_on_every_page(client):
    # "/" now requires login (see require_login_everywhere) and redirects
    # anonymous visitors to /login -- only /login and /register are
    # reachable without an account.
    for path in ["/login", "/register"]:
        response = client.get(path)
        assert b"NexAI" in response.data
        assert b"headerSearchInput" not in response.data
        assert b"bottom-nav" not in response.data


def test_service_worker_served_from_root_for_full_scope(client):
    response = client.get("/service-worker.js")
    assert response.status_code == 200
    assert response.content_type.startswith("application/javascript")
    assert b"CACHE_NAME" in response.data


def test_offline_page_accessible(client):
    response = client.get("/offline")
    assert response.status_code == 200
    assert "Du bist offline".encode() in response.data


def test_manifest_and_service_worker_referenced_in_every_page(client):
    register(client)
    response = client.get("/")
    assert b'rel="manifest"' in response.data
    assert b"/service-worker.js" in response.data




def test_profile_page_shows_username(client):
    register(client, username="bob")
    response = client.get("/user/bob")
    assert response.status_code == 200
    assert b"bob" in response.data


def test_profile_page_404_for_unknown_user(client):
    register(client)
    response = client.get("/user/doesnotexist")
    assert response.status_code == 404


def test_subscribe_toggle(client):
    register(client, username="alice", password="secret123")
    client.post("/logout")
    register(client, username="bob", password="secret123")
    client.post("/logout")
    client.post("/login", data={"username": "alice", "password": "secret123"})

    response = client.post("/user/bob/subscribe", follow_redirects=True)
    assert response.status_code == 200
    assert b"Gefolgt" in response.data

    response = client.post("/user/bob/subscribe", follow_redirects=True)
    assert b"Folgen" in response.data


def test_subscribe_to_self_is_rejected(client):
    register(client, username="alice")
    response = client.post("/user/alice/subscribe")
    assert response.status_code == 400


def test_profile_picture_upload(client):
    register(client, username="alice")
    data = {"profile_image": (io.BytesIO(b"fake image bytes"), "avatar.png")}
    response = client.post(
        "/profile/picture", data=data, content_type="multipart/form-data", follow_redirects=True
    )
    assert response.status_code == 200
    assert b"profile_pics/" in response.data


def test_profile_picture_upload_rejects_bad_extension(client):
    register(client, username="alice")
    data = {"profile_image": (io.BytesIO(b"not an image"), "avatar.exe")}
    response = client.post(
        "/profile/picture", data=data, content_type="multipart/form-data", follow_redirects=True
    )
    assert "erlaubt".encode() in response.data


def test_admin_dashboard_requires_admin(client):
    register(client, username="regular")
    response = client.get("/admin")
    assert response.status_code == 403


def test_admin_dashboard_accessible_for_admin(client):
    register(client, username="boss")
    make_admin("boss")
    response = client.get("/admin")
    assert response.status_code == 200
    assert b"Neuen Account erstellen" in response.data


def test_admin_can_create_fake_account(client):
    register(client, username="boss")
    make_admin("boss")

    response = client.post(
        "/admin/users", data={"username": "fakeuser", "password": "secret123"}, follow_redirects=True
    )
    assert response.status_code == 200
    assert b"fakeuser" in response.data

    client.post("/logout")
    response = client.post(
        "/login", data={"username": "fakeuser", "password": "secret123"}, follow_redirects=True
    )
    assert response.status_code == 200
    # An account created via /admin/users has never accepted terms and never
    # completed onboarding, so both gates trigger for its first real login.
    client.post("/terms/accept")
    client.post("/complete-profile", data={
        "purpose_of_use": "private", "country": "Deutschland", "region_skipped": "1",
        "birthdate": "1990-01-01", "gender": "keine_angabe",
    })
    profile_response = client.get("/user/fakeuser")
    assert b"fakeuser" in profile_response.data


def test_non_admin_cannot_create_account_via_admin_route(client):
    register(client, username="regular")
    response = client.post("/admin/users", data={"username": "sneaky", "password": "secret123"})
    assert response.status_code == 403


def test_admin_can_delete_other_account(client):
    register(client, username="boss")
    make_admin("boss")
    client.post("/admin/users", data={"username": "throwaway", "password": "secret123"})

    target = User.query.filter_by(username="throwaway").first()
    response = client.post(f"/admin/users/{target.id}/delete", follow_redirects=True)
    assert response.status_code == 200
    assert User.query.filter_by(username="throwaway").first() is None


def test_admin_cannot_delete_self(client):
    register(client, username="boss")
    make_admin("boss")
    admin = User.query.filter_by(username="boss").first()
    response = client.post(f"/admin/users/{admin.id}/delete")
    assert response.status_code == 400


def test_admin_can_set_any_users_points(client):
    register(client, username="boss")
    make_admin("boss")
    register(client, username="regular")
    client.post("/logout")
    client.post("/login", data={"username": "boss", "password": "secret123"})

    target = User.query.filter_by(username="regular").first()
    response = client.post(f"/admin/users/{target.id}/set-points", data={"total_score": "12345"}, follow_redirects=True)
    assert response.status_code == 200

    target = User.query.filter_by(username="regular").first()
    assert target.total_score == 12345


def test_admin_set_points_requires_admin(client):
    register(client, username="alice")
    response = client.post(f"/admin/users/1/set-points", data={"total_score": "999"})
    assert response.status_code == 403


def test_admin_set_points_clamps_negative_to_zero(client):
    register(client, username="boss")
    make_admin("boss")
    target = User.query.filter_by(username="boss").first()

    client.post(f"/admin/users/{target.id}/set-points", data={"total_score": "-50"})
    target = User.query.filter_by(username="boss").first()
    assert target.total_score == 0


def test_api_subscribe_toggle(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    client.post("/login", data={"username": "alice", "password": "secret123"})

    response = client.post("/api/user/bob/subscribe")
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["subscribed"] is True
    assert data["subscriber_count"] == 1

    response = client.post("/api/user/bob/subscribe")
    assert response.get_json()["subscribed"] is False


def test_api_subscribe_to_self_rejected(client):
    register(client, username="alice")
    response = client.post("/api/user/alice/subscribe")
    assert response.status_code == 400


def test_user_has_unique_public_id(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")

    alice = User.query.filter_by(username="alice").first()
    bob = User.query.filter_by(username="bob").first()
    assert alice.public_id is not None
    assert bob.public_id is not None
    assert alice.public_id != bob.public_id


def test_account_settings_requires_login(client):
    response = client.get("/account/settings", follow_redirects=True)
    assert b"Login" in response.data


def test_username_change_blocked_without_email(client):
    register(client, username="alice")
    response = client.post("/account/username", data={"username": "newname"})
    assert response.status_code == 400


def test_password_change_blocked_without_email(client):
    register(client, username="alice")
    response = client.post(
        "/account/password", data={"current_password": "secret123", "new_password": "newpass123"}
    )
    assert response.status_code == 400


def test_add_email_unlocks_username_and_password_change(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "alice@example.com"}, follow_redirects=True)

    response = client.post("/account/username", data={"username": "newalice"}, follow_redirects=True)
    assert response.status_code == 200
    assert User.query.filter_by(username="newalice").first() is not None

    response = client.post(
        "/account/password",
        data={"current_password": "secret123", "new_password": "newpass123"},
        follow_redirects=True,
    )
    assert response.status_code == 200

    client.post("/logout")
    response = client.post(
        "/login", data={"username": "newalice", "password": "newpass123"}, follow_redirects=True
    )
    # See test_register_and_login -- "/" is the download page for logged-in
    # users now and doesn't show the username, so confirm login via its
    # logout form instead.
    assert b"download-logout-btn" in response.data


def test_password_change_rejects_wrong_current_password(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "alice@example.com"})
    response = client.post(
        "/account/password",
        data={"current_password": "wrongpass", "new_password": "newpass123"},
        follow_redirects=True,
    )
    assert "falsch".encode() in response.data


def test_email_must_be_unique(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "shared@example.com"})
    client.post("/logout")

    register(client, username="bob")
    response = client.post(
        "/account/email", data={"email": "shared@example.com"}, follow_redirects=True
    )
    assert "verwendet".encode() in response.data


def test_email_not_shown_on_public_profile(client):
    register(client, username="alice")
    client.post("/account/email", data={"email": "secret@example.com"})
    client.post("/logout")

    response = client.get("/user/alice")
    assert b"secret@example.com" not in response.data


def test_last_seen_updated_on_request_and_shown_as_online_in_admin(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice")
    make_admin("alice")

    register(client, username="bob")
    client.get("/")  # updates bob's last_seen via before_request
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})

    response = client.get("/admin")
    assert b"Online" in response.data

    bob = User.query.filter_by(username="bob").first()
    assert bob.last_seen is not None

    # Simulate bob having been gone for a long time -> should show Offline
    bob.last_seen = datetime.now(timezone.utc) - timedelta(hours=1)
    db.session.commit()

    response = client.get("/admin")
    assert b"Offline" in response.data


def test_streak_starts_at_one_after_earning_100_points_in_a_day(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    assert user.current_streak == 0

    app_module.adjust_points(user, 100)
    db.session.commit()

    assert user.current_streak == 1
    assert user.best_streak == 1
    assert app_module.effective_streak(user) == 1


def test_streak_multiplier_boosts_points_earned(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 3
    user.best_streak = 3
    user.last_streak_date = app_module.streak_today()  # active streak, counted by effective_streak
    db.session.commit()

    assert app_module.streak_points_multiplier(user) == 1.3  # 1 + 3*0.1

    before = user.total_score
    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.total_score == before + 130  # 100 * 1.3


def test_streak_multiplier_caps_at_30_percent(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 25  # way past the 3-day cap point
    user.best_streak = 25
    user.last_streak_date = app_module.streak_today()
    db.session.commit()

    assert app_module.streak_points_multiplier(user) == 1.3  # capped at +30%

    before = user.total_score
    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.total_score == before + 130


def test_no_streak_means_no_multiplier_bonus(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    assert app_module.streak_points_multiplier(user) == 1.0

    before = user.total_score
    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.total_score == before + 100


def test_streak_continues_on_consecutive_day_and_resets_after_gap(client):
    import app as app_module
    from datetime import timedelta

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    yesterday = app_module.streak_today() - timedelta(days=1)
    user.current_streak = 3
    user.best_streak = 3
    user.last_streak_date = yesterday
    user.points_today_date = yesterday
    user.points_earned_today = 0
    db.session.commit()

    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.current_streak == 4
    assert user.best_streak == 4

    # Now simulate a missed day (streak was 4, two days ago) -> should reset to 1
    two_days_ago = app_module.streak_today() - timedelta(days=2)
    user.current_streak = 4
    user.last_streak_date = two_days_ago
    user.points_today_date = two_days_ago
    user.points_earned_today = 0
    db.session.commit()

    app_module.adjust_points(user, 100)
    db.session.commit()
    assert user.current_streak == 1
    assert user.best_streak == 4  # best streak is preserved even after a reset


def test_streak_below_100_points_does_not_count(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()

    app_module.adjust_points(user, 99)
    db.session.commit()
    assert user.current_streak == 0


def test_badges_include_streak_milestones_and_rank_one(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.best_streak = 3
    user.ever_rank_one = True
    db.session.commit()

    badges = app_module.user_badges(user)
    assert badges == ["1", "2", "3", "Platz 1"]


def test_profile_shows_streak_and_badge_for_owner(client):
    import app as app_module

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 2
    user.best_streak = 2
    user.last_streak_date = app_module.streak_today()
    db.session.commit()

    response = client.get("/user/alice")
    assert b"Tage Streak" in response.data
    assert b"badgeModalOpenBtn" in response.data


def test_streak_day_rolls_over_at_11am_berlin(client, monkeypatch):
    import app as app_module
    from datetime import datetime, timezone, timedelta
    from zoneinfo import ZoneInfo

    berlin = ZoneInfo("Europe/Berlin")
    just_before = datetime(2025, 6, 15, 10, 59, tzinfo=berlin).astimezone(timezone.utc)
    just_after = datetime(2025, 6, 15, 11, 1, tzinfo=berlin).astimezone(timezone.utc)

    class FakeDateTime(datetime):
        fixed_now = just_before

        @classmethod
        def now(cls, tz=None):
            return cls.fixed_now

    monkeypatch.setattr(app_module, "datetime", FakeDateTime)

    day_before = app_module.streak_today()
    FakeDateTime.fixed_now = just_after
    day_after = app_module.streak_today()

    assert day_after == day_before + timedelta(days=1)


def test_streak_display_hidden_until_secured_today(client):
    import app as app_module
    from datetime import timedelta

    register(client, username="alice")
    user = User.query.filter_by(username="alice").first()
    user.current_streak = 3
    user.best_streak = 3
    # streak is still alive (yesterday), but not yet secured for today
    user.last_streak_date = app_module.streak_today() - timedelta(days=1)
    db.session.commit()

    assert app_module.effective_streak(user) == 3  # still counts for the multiplier
    assert app_module.is_streak_secured_today(user) is False  # but not shown yet

    response = client.get("/user/alice")
    assert b"Tage Streak" not in response.data

    user.last_streak_date = app_module.streak_today()
    db.session.commit()
    assert app_module.is_streak_secured_today(user) is True

    response = client.get("/user/alice")
    assert b"Tage Streak" in response.data


def make_eligible_for_code_creation(username, total_score=1000):
    user = User.query.filter_by(username=username).first()
    user.organic_points_earned = 500
    user.total_score = total_score
    db.session.commit()
    return user


def mutual_follow(client, user_a, user_b):
    """Log in as each user in turn and subscribe to the other, making them mutual followers."""
    client.post("/login", data={"username": user_a, "password": "secret123"})
    a = User.query.filter_by(username=user_a).first()
    b = User.query.filter_by(username=user_b).first()
    client.post(f"/api/user/{user_b}/subscribe")
    client.post("/logout")
    client.post("/login", data={"username": user_b, "password": "secret123"})
    client.post(f"/api/user/{user_a}/subscribe")
    client.post("/logout")


def test_cannot_start_dm_without_mutual_follow(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")

    response = client.post("/api/messages/start-dm", json={"username": "alice"})
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "not_mutual_follow"


def test_start_dm_with_mutual_follow_and_reuses_existing_conversation(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")

    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    response = client.post("/api/messages/start-dm", json={"username": "bob"})
    data = response.get_json()
    assert data["ok"] is True
    conv_id = data["conversation_id"]

    # Calling again returns the same conversation, doesn't create a second one
    response2 = client.post("/api/messages/start-dm", json={"username": "bob"})
    assert response2.get_json()["conversation_id"] == conv_id


def test_send_and_receive_message_in_dm(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    client.post(f"/api/messages/{conv_id}/send", json={"text": "Hallo Bob!"})
    client.post("/logout")

    client.post("/login", data={"username": "bob", "password": "secret123"})
    response = client.get(f"/api/messages/{conv_id}")
    data = response.get_json()
    assert data["ok"] is True
    assert len(data["messages"]) == 1
    assert data["messages"][0]["text"] == "Hallo Bob!"
    assert data["messages"][0]["is_mine"] is False


def test_non_member_cannot_access_conversation(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    client.post("/logout")

    register(client, username="carol")
    response = client.get(f"/api/messages/{conv_id}")
    assert response.get_json()["ok"] is False


def test_message_self_deletes_15_seconds_after_being_viewed(client):
    from datetime import datetime, timedelta, timezone

    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    conv_id = client.post("/api/messages/start-dm", json={"username": "bob"}).get_json()["conversation_id"]
    client.post(f"/api/messages/{conv_id}/send", json={"text": "Hallo Bob!"})
    client.post("/logout")

    client.post("/login", data={"username": "bob", "password": "secret123"})
    client.get(f"/api/messages/{conv_id}")  # marks it viewed
    message = Message.query.filter_by(conversation_id=conv_id).first()
    assert message is not None
    assert message.viewed_at is not None

    # Simulate 16 seconds having passed since it was viewed
    message.viewed_at = datetime.now(timezone.utc) - timedelta(seconds=16)
    db.session.commit()

    response = client.get(f"/api/messages/{conv_id}")
    assert response.get_json()["messages"] == []
    assert Message.query.filter_by(conversation_id=conv_id).first() is None


def test_messages_page_shows_prominent_group_button_once(client):
    register(client, username="alice")
    response = client.get("/messages")
    assert response.data.count(b'id="createGroupToggleBtn"') == 1
    assert b"Gruppe" in response.data


def test_create_group_requires_2_to_99_mutual_follow_members(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    mutual_follow(client, "alice", "bob")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    response = client.post("/api/messages/create-group", json={"name": "Team", "usernames": ["bob"]})
    data = response.get_json()
    assert data["ok"] is True

    conv = db.session.get(Conversation, data["conversation_id"])
    assert conv.is_group is True
    assert len(conv.members) == 2


def test_create_group_rejects_non_mutual_follow_member(client):
    register(client, username="alice")
    client.post("/logout")
    register(client, username="bob")
    client.post("/logout")
    register(client, username="carol")  # not mutually followed by alice
    client.post("/logout")

    client.post("/login", data={"username": "alice", "password": "secret123"})
    response = client.post("/api/messages/create-group", json={"name": "Team", "usernames": ["carol"]})
    assert response.get_json()["ok"] is False


def test_r2_cors_left_alone_when_already_configured(client, monkeypatch):
    import app as app_module
    from unittest.mock import MagicMock

    fake_r2 = MagicMock()
    fake_r2.get_bucket_cors.return_value = {"CORSRules": [{"AllowedOrigins": ["*"]}]}
    monkeypatch.setattr(app_module, "USE_R2", True)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)
    monkeypatch.setattr(app_module, "R2_BUCKET_NAME", "test-bucket")

    app_module.ensure_r2_cors_configured()
    fake_r2.put_bucket_cors.assert_not_called()


def test_r2_cors_applied_when_missing(client, monkeypatch):
    import app as app_module
    from unittest.mock import MagicMock
    from botocore.exceptions import ClientError

    fake_r2 = MagicMock()
    fake_r2.get_bucket_cors.side_effect = ClientError(
        {"Error": {"Code": "NoSuchCORSConfiguration"}}, "GetBucketCors"
    )
    monkeypatch.setattr(app_module, "USE_R2", True)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)
    monkeypatch.setattr(app_module, "R2_BUCKET_NAME", "test-bucket")

    app_module.ensure_r2_cors_configured()

    fake_r2.put_bucket_cors.assert_called_once()
    call_kwargs = fake_r2.put_bucket_cors.call_args.kwargs
    assert call_kwargs["Bucket"] == "test-bucket"
    rule = call_kwargs["CORSConfiguration"]["CORSRules"][0]
    assert rule["AllowedOrigins"] == ["*"]
    assert "GET" in rule["AllowedMethods"]


def test_r2_cors_skipped_when_r2_not_in_use(client, monkeypatch):
    import app as app_module
    from unittest.mock import MagicMock

    fake_r2 = MagicMock()
    monkeypatch.setattr(app_module, "USE_R2", False)
    monkeypatch.setattr(app_module, "r2_client", fake_r2)

    app_module.ensure_r2_cors_configured()
    fake_r2.get_bucket_cors.assert_not_called()


def test_ai_chat_requires_login(client):
    response = client.post("/api/ai/chat", json={"message": "Hallo"})
    assert response.status_code == 401


def test_guest_chat_rejects_logged_in_users(client):
    register(client)
    response = client.post("/api/ai/guest-chat", json={"message": "Hallo"})
    assert response.status_code == 400


def test_buddy_mode_sets_mimic_flag_for_current_user(client):
    from models import AiPersonality

    register(client, username="buddyuser")
    user = User.query.filter_by(username="buddyuser").first()
    assert AiPersonality.query.filter_by(user_id=user.id).first() is None

    response = client.post("/api/ai/buddy-mode")
    assert response.status_code == 200
    assert response.get_json()["ok"] is True

    personality = AiPersonality.query.filter_by(user_id=user.id).first()
    assert personality is not None
    assert personality.mimic_user_style is True


def test_buddy_mode_requires_login(client):
    response = client.post("/api/ai/buddy-mode")
    assert response.status_code == 401


def test_ai_chat_rejects_empty_message(client):
    register(client)
    response = client.post("/api/ai/chat", json={"message": "  "})
    assert response.status_code == 400


def test_ai_chat_starts_job_and_reports_status(client, monkeypatch):
    import ai_assistant

    monkeypatch.setattr(
        ai_assistant, "generate_reply",
        lambda message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None, behavior_note=None, personality=None, available_tokens=None, synthesize_audio_fn=None: (f"Antwort auf: {message}", None),
    )
    register(client)

    start_res = client.post("/api/ai/chat", json={"message": "Wie geht KILL?"})
    data = start_res.get_json()
    assert data["ok"] is True
    job_id = data["job_id"]

    # the background thread runs generate_reply almost immediately since it's
    # stubbed above, but poll a couple of times to avoid a flaky race.
    import time
    status_data = None
    for _ in range(20):
        status_res = client.get(f"/api/ai/chat/{job_id}")
        status_data = status_res.get_json()
        if status_data["status"] != "running":
            break
        time.sleep(0.05)

    assert status_data["status"] == "done"
    assert status_data["reply"] == "Antwort auf: Wie geht KILL?"


def test_ai_chat_code_project_type_persists_chat_mode(client, monkeypatch):
    import ai_assistant

    monkeypatch.setattr(
        ai_assistant, "generate_reply",
        lambda message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None, behavior_note=None, personality=None, available_tokens=None: ("Antwort", None),
    )
    register(client)

    start_res = client.post("/api/ai/chat", json={"message": "Wie geht ein Dictionary?", "project_type": "code"})
    data = start_res.get_json()
    assert data["ok"] is True

    from models import AiChat
    chat = db.session.get(AiChat, data["chat_id"])
    assert chat.mode == "code"


def test_registration_grants_starting_ai_tokens(client):
    import app as app_module

    register(client)
    user = User.query.filter_by(username="alice").first()
    assert user.ai_tokens == app_module.STARTING_AI_TOKENS


def test_ai_chat_deducts_base_token_cost(client, monkeypatch):
    import ai_assistant
    import app as app_module

    monkeypatch.setattr(
        ai_assistant, "generate_reply",
        lambda message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None, behavior_note=None, personality=None, available_tokens=None: ("Antwort", None),
    )
    register(client)
    user = User.query.filter_by(username="alice").first()
    before = user.ai_tokens

    start_res = client.post("/api/ai/chat", json={"message": "Hallo"})
    data = start_res.get_json()
    assert data["ok"] is True
    assert data["tokens_remaining"] == before - app_module.TOKEN_COST_MESSAGE_BASE

    user = User.query.filter_by(username="alice").first()
    assert user.ai_tokens == before - app_module.TOKEN_COST_MESSAGE_BASE


def test_ai_chat_via_voice_deducts_voice_token_cost(client, monkeypatch):
    import ai_assistant
    import app as app_module

    monkeypatch.setattr(
        ai_assistant, "generate_reply",
        lambda message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None, behavior_note=None, personality=None, available_tokens=None: ("Antwort", None),
    )
    register(client)
    user = User.query.filter_by(username="alice").first()
    before = user.ai_tokens

    start_res = client.post("/api/ai/chat", json={"message": "Hallo", "via_voice": True})
    data = start_res.get_json()
    assert data["tokens_remaining"] == before - app_module.TOKEN_COST_VOICE_BASE


def test_ai_chat_was_interrupted_passes_behavior_note(client, monkeypatch):
    import ai_assistant

    captured = {}

    def fake_generate_reply(message, context=None, history=None, project_type=None, facts=None,
                             learned_facts=None, captured_out=None, behavior_note=None, personality=None,
                             available_tokens=None, synthesize_audio_fn=None):
        captured["behavior_note"] = behavior_note
        return "Antwort", None

    monkeypatch.setattr(ai_assistant, "generate_reply", fake_generate_reply)
    register(client)

    client.post("/api/ai/chat", json={"message": "Hallo", "via_voice": True, "was_interrupted": True})

    import time
    for _ in range(20):
        if "behavior_note" in captured:
            break
        time.sleep(0.05)

    assert captured["behavior_note"] is not None
    assert "unterbrochen" in captured["behavior_note"]


def test_unlimited_tokens_account_never_blocked_or_deducted(client, monkeypatch):
    import ai_assistant
    import app as app_module

    monkeypatch.setattr(
        ai_assistant, "generate_reply",
        lambda message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None, behavior_note=None, personality=None, available_tokens=None: ("Antwort", None),
    )
    register(client, username="LEROX")
    user = User.query.filter_by(username="LEROX").first()
    user.ai_tokens = 0
    db.session.commit()

    response = client.post("/api/ai/chat", json={"message": "Hallo", "via_voice": True})
    assert response.status_code == 200
    data = response.get_json()
    assert data["ok"] is True
    assert data["tokens_remaining"] == 0

    user = User.query.filter_by(username="LEROX").first()
    assert user.ai_tokens == 0


def test_ai_chat_rejects_when_tokens_insufficient(client):
    import app as app_module

    register(client)
    user = User.query.filter_by(username="alice").first()
    user.ai_tokens = app_module.TOKEN_COST_MESSAGE_BASE - 1
    db.session.commit()

    response = client.post("/api/ai/chat", json={"message": "Hallo"})
    assert response.status_code == 402
    data = response.get_json()
    assert data["ok"] is False
    assert data["error"] == "insufficient_tokens"

    from models import AiChat
    assert AiChat.query.count() == 0
    user = User.query.filter_by(username="alice").first()
    assert user.ai_tokens == app_module.TOKEN_COST_MESSAGE_BASE - 1


def test_daily_ai_tokens_granted_once_per_day(client):
    import app as app_module

    register(client)
    user = User.query.filter_by(username="alice").first()
    user.ai_tokens = 50
    user.ai_tokens_last_award_date = date(2000, 1, 1)
    db.session.commit()

    client.get("/")

    user = User.query.filter_by(username="alice").first()
    assert user.ai_tokens == 50 + app_module.DAILY_AI_TOKENS
    assert user.ai_tokens_last_award_date == date.today()

    client.get("/")
    user = User.query.filter_by(username="alice").first()
    assert user.ai_tokens == 50 + app_module.DAILY_AI_TOKENS


def test_ai_chat_status_requires_login(client):
    # The anonymous guest chat this route used to support is gone -- the
    # whole site is login-only now (see require_login_everywhere), so an
    # anonymous request is rejected before it ever reaches the job lookup.
    response = client.get("/api/ai/chat/doesnotexist")
    assert response.status_code == 401


def test_ai_chat_status_unknown_job_404s(client):
    register(client)
    response = client.get("/api/ai/chat/doesnotexist")
    assert response.status_code == 404


def test_ai_chat_reports_error_when_local_model_fails_to_load(client, monkeypatch):
    import ai_assistant
    import local_ai

    def boom(*args, **kwargs):
        raise RuntimeError("Modell konnte nicht geladen werden.")

    monkeypatch.setattr(local_ai, "generate_chat", boom)
    register(client)

    start_res = client.post("/api/ai/chat", json={"message": "Hallo"})
    job_id = start_res.get_json()["job_id"]

    import time
    status_data = None
    for _ in range(20):
        status_data = client.get(f"/api/ai/chat/{job_id}").get_json()
        if status_data["status"] != "running":
            break
        time.sleep(0.05)

    assert status_data["status"] == "error"
    assert "Modell konnte nicht geladen werden." in status_data["error"]


def test_ai_chats_requires_login(client):
    assert client.get("/api/ai/chats").status_code == 401
    assert client.post("/api/ai/chats").status_code == 401


def test_ai_chats_create_list_rename_delete(client):
    register(client)

    create_res = client.post("/api/ai/chats")
    chat = create_res.get_json()["chat"]
    assert chat["title"] == "Neuer Chat"
    assert chat["mode"] == "general"

    list_res = client.get("/api/ai/chats")
    chats = list_res.get_json()["chats"]
    assert len(chats) == 1
    assert chats[0]["id"] == chat["id"]

    rename_res = client.patch(f"/api/ai/chats/{chat['id']}", json={"title": "Meine Frage"})
    assert rename_res.get_json()["chat"]["title"] == "Meine Frage"

    mode_res = client.patch(f"/api/ai/chats/{chat['id']}", json={"mode": "code", "specialize_prompted": True})
    updated = mode_res.get_json()["chat"]
    assert updated["mode"] == "code"
    assert updated["specialize_prompted"] is True

    delete_res = client.post(f"/api/ai/chats/{chat['id']}/delete")
    assert delete_res.get_json()["ok"] is True
    assert client.get("/api/ai/chats").get_json()["chats"] == []


def test_ai_chats_scoped_to_owner(client):
    register(client, username="alice")
    chat = client.post("/api/ai/chats").get_json()["chat"]
    client.post("/logout")

    register(client, username="bob")
    assert client.get(f"/api/ai/chats/{chat['id']}/messages").status_code == 404
    assert client.patch(f"/api/ai/chats/{chat['id']}", json={"title": "x"}).status_code == 404
    assert client.post(f"/api/ai/chats/{chat['id']}/delete").status_code == 404


def test_ai_chat_persists_messages_and_generates_title(client, monkeypatch):
    import ai_assistant

    monkeypatch.setattr(
        ai_assistant, "generate_reply",
        lambda message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None, behavior_note=None, personality=None, available_tokens=None, synthesize_audio_fn=None: ("Klar, gerne!", None),
    )
    monkeypatch.setattr(ai_assistant, "generate_title", lambda first_message: "Frage zu Punkten")
    register(client)

    start_res = client.post("/api/ai/chat", json={"message": "Wie bekomme ich Punkte?"})
    data = start_res.get_json()
    chat_id = data["chat_id"]

    import time
    for _ in range(20):
        status = client.get(f"/api/ai/chat/{data['job_id']}").get_json()
        if status["status"] != "running":
            break
        time.sleep(0.05)

    messages_res = client.get(f"/api/ai/chats/{chat_id}/messages")
    messages_data = messages_res.get_json()
    assert messages_data["messages"] == [
        {"role": "user", "content": "Wie bekomme ich Punkte?"},
        {"role": "assistant", "content": "Klar, gerne!"},
    ]
    assert messages_data["chat"]["title"] == "Frage zu Punkten"


def test_ai_feedback_requires_login(client):
    response = client.post("/api/ai/feedback", json={"message": "Hi", "reply": "Hallo", "rating": 1})
    assert response.status_code == 401


def test_ai_feedback_rejects_invalid_rating(client):
    register(client)
    response = client.post("/api/ai/feedback", json={"message": "Hi", "reply": "Hallo", "rating": 0})
    assert response.status_code == 400


def test_ai_feedback_stores_rating_and_shows_in_admin(client):
    register(client, username="alice")
    make_admin("alice")
    res = client.post("/api/ai/feedback", json={"message": "Wie geht KILL?", "reply": "So: KILL", "rating": 1})
    assert res.get_json()["ok"] is True

    admin_response = client.get("/admin")
    assert b"Wie geht KILL?" in admin_response.data
    assert "👍".encode() in admin_response.data


class _FakeResponse:
    def __init__(self, json_data=None, text_data="", status_code=200):
        self._json_data = json_data or {}
        self.text = text_data
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise Exception(f"HTTP {self.status_code}")

    def json(self):
        return self._json_data


def test_tool_search_wikipedia_returns_summary(monkeypatch):
    import ai_assistant

    def fake_get(url, params=None, headers=None, timeout=None):
        if "action" in (params or {}):
            return _FakeResponse({"query": {"search": [{"title": "Katze"}]}})
        return _FakeResponse({"extract": "Die Katze ist ein Haustier."})

    monkeypatch.setattr(ai_assistant.requests, "get", fake_get)
    result = ai_assistant._tool_search_wikipedia("Katze")
    assert "Katze" in result
    assert "Haustier" in result


def test_tool_get_weather_returns_current_conditions(monkeypatch):
    import ai_assistant

    def fake_get(url, params=None, headers=None, timeout=None):
        if "geocoding" in url:
            return _FakeResponse({"results": [{"name": "Berlin", "latitude": 52.5, "longitude": 13.4}]})
        return _FakeResponse({"current": {"temperature_2m": 21.5, "wind_speed_10m": 10, "weather_code": 1}})

    monkeypatch.setattr(ai_assistant.requests, "get", fake_get)
    result = ai_assistant._tool_get_weather("Berlin")
    assert "Berlin" in result
    assert "21.5" in result


def test_tool_search_docs_respects_robots_disallow(monkeypatch):
    import ai_assistant

    monkeypatch.setattr(ai_assistant, "_docs_allowed", lambda url: False)
    result = ai_assistant._tool_search_docs("python", "print")
    assert "erlaubt kein automatisches Abrufen" in result


def test_general_tools_vs_project_change_tools_by_mode(monkeypatch):
    import ai_assistant

    captured = {}

    def fake_call_model(messages, max_tokens, tools=None, **kwargs):
        captured["tools"] = tools
        return "ok", None

    def fake_call_model_with_router(messages, user_message, max_tokens, tools, *args, **kwargs):
        captured["tools"] = tools
        return "ok", None

    monkeypatch.setattr(ai_assistant, "_call_model", fake_call_model)
    monkeypatch.setattr(ai_assistant, "_call_model_with_router", fake_call_model_with_router)

    # Code context without an explicit project_type defaults to "game" --
    # it must never fall through to general mode (that would enable
    # Wikipedia/weather/docs tools alongside Studio DSL code). game mode
    # only gets propose_project_change, no doc lookups (protects the
    # flat-DSL prompt from real-language contamination); webapp mode also
    # gets search_docs since it's real, unrestricted code already.
    ai_assistant.generate_reply("Wie geht KILL?", context="Erlaubte Befehle: ...")
    assert captured["tools"] == ai_assistant.PROJECT_CHANGE_TOOLS

    ai_assistant.generate_reply("Ändere die Farbe.", context="Aktueller Code: ...", project_type="webapp")
    assert captured["tools"] == ai_assistant.WEBAPP_TOOLS
    assert ai_assistant.SEARCH_DOCS_TOOL in ai_assistant.WEBAPP_TOOLS
    assert ai_assistant.SEARCH_DOCS_TOOL not in ai_assistant.PROJECT_CHANGE_TOOLS

    ai_assistant.generate_reply("Wie alt ist die Erde?")
    assert captured["tools"] == ai_assistant.AI_TOOLS

    # "Neuesten Code-Chat erstellen" (no attached Studio project/file, so no
    # `context`) must route to the standalone code-help prompt, not fall
    # back to general mode and not the game-mode DSL fallback either.
    ai_assistant.generate_reply("Wie kehre ich eine Liste in Python um?", project_type="code")
    assert captured["tools"] == ai_assistant.CODE_CHAT_TOOLS
    assert ai_assistant.SEARCH_DOCS_TOOL in ai_assistant.CODE_CHAT_TOOLS
    assert ai_assistant.PROPOSE_PROJECT_CHANGE_TOOL not in ai_assistant.CODE_CHAT_TOOLS


def test_code_project_type_uses_base_system_prompt(monkeypatch):
    import ai_assistant

    captured = {}

    def fake_call_model(messages, max_tokens, tools=None, **kwargs):
        captured["system_prompt"] = messages[0]["content"]
        return "ok", None

    monkeypatch.setattr(ai_assistant, "_call_model", fake_call_model)

    ai_assistant.generate_reply("Erklär mir Rekursion.", project_type="code")
    assert captured["system_prompt"] == (
        ai_assistant.BASE_SYSTEM_PROMPT + ai_assistant.CODE_CHAT_ADDENDUM + ai_assistant.FORMATTING_ADDENDUM
        + ai_assistant._tools_instructions(ai_assistant.CODE_CHAT_TOOLS)
    )


def test_call_model_executes_tool_call_then_returns_final_reply(monkeypatch):
    import ai_assistant

    calls = []

    def fake_call_local_model_message(messages, max_tokens, tools=None, tool_choice="auto", temperature=None):
        calls.append(messages)
        if len(calls) == 1:
            return {
                "content": "",
                "tool_calls": [{"id": "call1", "function": {"name": "get_weather", "arguments": '{"location": "Berlin"}'}}],
            }
        return {"content": "In Berlin sind es 21.5°C."}

    monkeypatch.setattr(ai_assistant, "_call_local_model_message", fake_call_local_model_message)
    monkeypatch.setattr(ai_assistant, "_tool_get_weather", lambda location: "Aktuelles Wetter in Berlin: 21.5°C.")

    reply, proposed_change = ai_assistant._call_model(
        [{"role": "user", "content": "Wie ist das Wetter in Berlin?"}], 200, tools=ai_assistant.AI_TOOLS,
    )
    assert reply == "In Berlin sind es 21.5°C."
    assert proposed_change is None
    assert len(calls) == 2


def test_call_model_returns_proposed_change_from_propose_project_change(monkeypatch):
    import ai_assistant

    calls = []

    def fake_call_local_model_message(messages, max_tokens, tools=None, tool_choice="auto", temperature=None):
        calls.append(messages)
        if len(calls) == 1:
            return {
                "content": "",
                "tool_calls": [{
                    "id": "call1",
                    "function": {
                        "name": "propose_project_change",
                        "arguments": '{"new_code": "WENN\\nBlock\\nberührt\\nVERSTECKEN\\nfest", "summary": "Block verschwindet bei Berührung"}',
                    },
                }],
            }
        return {"content": "Ich habe eine Änderung vorgeschlagen!"}

    monkeypatch.setattr(ai_assistant, "_call_local_model_message", fake_call_local_model_message)

    reply, proposed_change = ai_assistant._call_model(
        [{"role": "user", "content": "Lass den Block verschwinden, wenn man ihn berührt."}],
        200, tools=ai_assistant.PROJECT_CHANGE_TOOLS,
    )
    assert reply == "Ich habe eine Änderung vorgeschlagen!"
    assert proposed_change == {
        "new_code": "WENN\nBlock\nberührt\nVERSTECKEN\nfest",
        "summary": "Block verschwindet bei Berührung",
    }


def test_facts_addendum_included_for_every_mode(monkeypatch):
    import ai_assistant

    captured = {}

    def fake_call_model(messages, max_tokens, tools=None, **kwargs):
        captured["system"] = messages[0]["content"]
        return "ok", None

    def fake_call_model_with_router(messages, user_message, max_tokens, tools, *args, **kwargs):
        captured["system"] = messages[0]["content"]
        return "ok", None

    monkeypatch.setattr(ai_assistant, "_call_model", fake_call_model)
    monkeypatch.setattr(ai_assistant, "_call_model_with_router", fake_call_model_with_router)

    ai_assistant.generate_reply("Hallo!", facts=["NexAI wurde 2024 gegründet."])
    assert "NexAI wurde 2024 gegründet." in captured["system"]

    ai_assistant.generate_reply("Ändere etwas.", context="Code: ...", project_type="webapp", facts=["Fakt X"])
    assert "Fakt X" in captured["system"]


def test_learned_facts_addendum_only_applied_in_general_mode(monkeypatch):
    import ai_assistant

    captured = {}

    def fake_call_model(messages, max_tokens, tools=None, **kwargs):
        captured["system"] = messages[0]["content"]
        return "ok", None

    def fake_call_model_with_router(messages, user_message, max_tokens, tools, *args, **kwargs):
        captured["system"] = messages[0]["content"]
        return "ok", None

    monkeypatch.setattr(ai_assistant, "_call_model", fake_call_model)
    monkeypatch.setattr(ai_assistant, "_call_model_with_router", fake_call_model_with_router)
    learned = {"wikipedia": ["Paris ist die Hauptstadt von Frankreich."], "user": ["Der Nutzer heißt Timo."]}

    ai_assistant.generate_reply("Hallo!", learned_facts=learned)
    assert "Paris ist die Hauptstadt von Frankreich." in captured["system"]
    assert "Der Nutzer heißt Timo." in captured["system"]

    ai_assistant.generate_reply("Ändere etwas.", context="Code: ...", project_type="webapp", learned_facts=learned)
    assert "Paris ist die Hauptstadt von Frankreich." not in captured["system"]
    assert "Der Nutzer heißt Timo." not in captured["system"]


def test_run_tool_calls_captures_wikipedia_result_and_user_fact():
    import ai_assistant

    captured = {"proposed_change": None, "wikipedia_facts": [], "user_facts": []}
    tool_calls = [
        {"id": "c1", "function": {"name": "search_wikipedia", "arguments": '{"query": "Paris"}'}},
        {"id": "c2", "function": {"name": "remember_user_fact", "arguments": '{"fact": "Der Nutzer heißt Timo."}'}},
    ]
    original = ai_assistant.TOOL_IMPLEMENTATIONS["search_wikipedia"]
    ai_assistant.TOOL_IMPLEMENTATIONS["search_wikipedia"] = lambda args: 'Wikipedia-Artikel "Paris": Paris ist die Hauptstadt von Frankreich.'
    try:
        outputs = ai_assistant._run_tool_calls(tool_calls, captured)
    finally:
        ai_assistant.TOOL_IMPLEMENTATIONS["search_wikipedia"] = original

    assert len(outputs) == 2
    assert captured["wikipedia_facts"] == ['Wikipedia-Artikel "Paris": Paris ist die Hauptstadt von Frankreich.']
    assert captured["user_facts"] == ["Der Nutzer heißt Timo."]


def test_learned_facts_persisted_after_general_chat(client, monkeypatch):
    import ai_assistant

    def fake_generate_reply(message, context=None, history=None, project_type=None, facts=None,
                             learned_facts=None, captured=None, behavior_note=None, personality=None,
                             available_tokens=None, synthesize_audio_fn=None):
        if captured is not None:
            captured["wikipedia_facts"] = ["Paris ist die Hauptstadt von Frankreich."]
            captured["user_facts"] = ["Der Nutzer heißt Timo."]
        return "Alles klar!", None

    monkeypatch.setattr(ai_assistant, "generate_reply", fake_generate_reply)
    register(client, username="learner")

    start_res = client.post("/api/ai/chat", json={"message": "Ich heiße Timo."})
    job_id = start_res.get_json()["job_id"]

    import time
    for _ in range(20):
        status = client.get(f"/api/ai/chat/{job_id}").get_json()
        if status["status"] != "running":
            break
        time.sleep(0.05)

    wiki_facts = AiLearnedFact.query.filter_by(source="wikipedia").all()
    user_facts = AiLearnedFact.query.filter_by(source="user").all()
    assert len(wiki_facts) == 1
    assert wiki_facts[0].content == "Paris ist die Hauptstadt von Frankreich."
    assert wiki_facts[0].user_id is None
    assert len(user_facts) == 1
    assert user_facts[0].content == "Der Nutzer heißt Timo."
    assert user_facts[0].user_id == User.query.filter_by(username="learner").first().id


def test_only_admin_can_save_a_fact(client, monkeypatch):
    import ai_assistant

    monkeypatch.setattr(
        ai_assistant, "generate_reply",
        lambda message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None: ("ok", None),
    )
    register(client, username="notadmin")
    client.post("/api/ai/chat", json={"message": "Die Sonne ist aus Käse.", "save_as_fact": True})
    assert AiAdminFact.query.count() == 0

    client.post("/logout")
    register(client, username="admin1")
    make_admin("admin1")
    client.post("/api/ai/chat", json={"message": "NexAI ist kostenlos.", "save_as_fact": True})
    assert AiAdminFact.query.count() == 1
    assert AiAdminFact.query.first().content == "NexAI ist kostenlos."


def test_admin_can_delete_a_fact(client):
    register(client, username="admin2")
    make_admin("admin2")
    fact = AiAdminFact(admin_id=User.query.filter_by(username="admin2").first().id, content="Testfakt")
    db.session.add(fact)
    db.session.commit()
    fact_id = fact.id

    response = client.post(f"/admin/facts/{fact_id}/delete", follow_redirects=True)
    assert response.status_code == 200
    assert AiAdminFact.query.count() == 0


def set_email(username, email):
    user = User.query.filter_by(username=username).first()
    user.email = email
    db.session.commit()


def test_login_page_shows_forgot_password_link(client):
    response = client.get("/login")
    assert "Ich habe mein Passwort oder Benutzername vergessen.".encode() in response.data


def test_forgot_password_choice_page(client):
    response = client.get("/forgot-password")
    assert response.status_code == 200
    assert b">Ja<" in response.data
    assert b">Nein<" in response.data


def test_forgot_password_email_flow_full_cycle(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append((to, subject, body)))

    register(client, username="recoveryuser")
    set_email("recoveryuser", "recoveryuser@example.com")

    response = client.post("/forgot-password/email", data={"email": "recoveryuser@example.com"}, follow_redirects=True)
    assert response.status_code == 200
    assert len(sent) == 1
    assert sent[0][0] == "recoveryuser@example.com"

    code_row = PasswordResetCode.query.filter_by(
        user_id=User.query.filter_by(username="recoveryuser").first().id
    ).first()
    assert code_row is not None
    code = sent[0][2].split("Dein Code lautet: ")[1].split("\n")[0]
    assert code == code_row.code

    bad = client.post("/forgot-password/verify", data={
        "code": "000000", "new_password": "NeuesPasswort123!", "new_password2": "NeuesPasswort123!",
    }, follow_redirects=True)
    assert "ungültig oder abgelaufen".encode() in bad.data

    good = client.post("/forgot-password/verify", data={
        "code": code, "new_password": "NeuesPasswort123!", "new_password2": "NeuesPasswort123!",
    }, follow_redirects=True)
    assert good.status_code == 200

    updated_user = User.query.filter_by(username="recoveryuser").first()
    assert updated_user.check_password("NeuesPasswort123!")
    assert db.session.get(PasswordResetCode, code_row.id).used is True


def test_forgot_password_email_does_not_reveal_unknown_address(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append(to))

    response = client.post(
        "/forgot-password/email", data={"email": "nobody-here@example.com"}, follow_redirects=True,
    )
    assert response.status_code == 200
    assert len(sent) == 0
    assert PasswordResetCode.query.count() == 0


def test_forgot_password_resend_issues_a_new_code(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append((to, subject, body)))

    register(client, username="resenduser")
    set_email("resenduser", "resend@example.com")
    client.post("/forgot-password/email", data={"email": "resend@example.com"})

    client.post("/forgot-password/verify", data={"action": "resend"})
    assert len(sent) == 2
    second_code = sent[1][2].split("Dein neuer Code lautet: ")[1].split("\n")[0]

    response = client.post("/forgot-password/verify", data={
        "code": second_code, "new_password": "AnderesPasswort123!", "new_password2": "AnderesPasswort123!",
    }, follow_redirects=True)
    assert response.status_code == 200
    assert User.query.filter_by(username="resenduser").first().check_password("AnderesPasswort123!")


def test_forgot_password_help_creates_recovery_request(client):
    register(client, username="helpuser")
    response = client.post("/forgot-password/help", data={
        "username": "helpuser", "message": "Ich komme nicht mehr rein.",
    }, follow_redirects=True)
    assert response.status_code == 200
    request_row = AccountRecoveryRequest.query.first()
    assert request_row is not None
    assert request_row.user_id == User.query.filter_by(username="helpuser").first().id
    assert request_row.status == "pending"


def test_forgot_password_help_with_unknown_username_has_no_match(client):
    client.post("/forgot-password/help", data={"username": "existiertnicht", "message": "Hilfe"})
    request_row = AccountRecoveryRequest.query.first()
    assert request_row.user_id is None


def test_admin_approve_recovery_issues_code(client):
    register(client, username="recoveredme")
    client.post("/forgot-password/help", data={"username": "recoveredme", "message": "Bitte helfen"})
    request_row = AccountRecoveryRequest.query.first()

    client.post("/logout")
    register(client, username="adminrecov")
    make_admin("adminrecov")

    response = client.post(f"/admin/recovery/{request_row.id}/approve", follow_redirects=True)
    assert response.status_code == 200
    updated = db.session.get(AccountRecoveryRequest, request_row.id)
    assert updated.status == "approved"
    assert PasswordResetCode.query.filter_by(
        user_id=User.query.filter_by(username="recoveredme").first().id
    ).count() == 1


def test_admin_issued_code_redeemable_via_username_in_a_different_session(client):
    # Simulates the real gap this caught: the person redeeming an admin-
    # approved code never went through /forgot-password/email in their
    # browser, so there's no session state tying them to their account --
    # they must be able to identify themselves by username instead.
    register(client, username="recoveredme2")
    client.post("/forgot-password/help", data={"username": "recoveredme2", "message": "Bitte helfen"})
    request_row = AccountRecoveryRequest.query.first()

    client.post("/logout")
    register(client, username="adminrecov3")
    make_admin("adminrecov3")
    client.post(f"/admin/recovery/{request_row.id}/approve")
    code_row = PasswordResetCode.query.filter_by(
        user_id=User.query.filter_by(username="recoveredme2").first().id
    ).first()

    client.post("/logout")
    response = client.post("/forgot-password/verify", data={
        "username": "recoveredme2", "code": code_row.code,
        "new_password": "FreshPassword123!", "new_password2": "FreshPassword123!",
    }, follow_redirects=True)
    assert response.status_code == 200
    assert User.query.filter_by(username="recoveredme2").first().check_password("FreshPassword123!")


def test_admin_deny_recovery(client):
    register(client, username="denyme")
    client.post("/forgot-password/help", data={"username": "denyme", "message": "Bitte"})
    request_row = AccountRecoveryRequest.query.first()

    client.post("/logout")
    register(client, username="adminrecov2")
    make_admin("adminrecov2")

    client.post(f"/admin/recovery/{request_row.id}/deny", follow_redirects=True)
    updated = db.session.get(AccountRecoveryRequest, request_row.id)
    assert updated.status == "denied"
    assert PasswordResetCode.query.count() == 0


def test_non_admin_cannot_approve_recovery(client):
    register(client, username="victim")
    client.post("/forgot-password/help", data={"username": "victim", "message": "Hilfe"})
    request_row = AccountRecoveryRequest.query.first()

    client.post("/logout")
    register(client, username="notadmin2")
    response = client.post(f"/admin/recovery/{request_row.id}/approve")
    assert response.status_code == 403


def test_unhandled_exception_is_logged_and_shows_friendly_page(client, monkeypatch):
    import app as app_module

    def boom(user):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(app_module, "is_user_online", boom)

    register(client, username="admintester")
    make_admin("admintester")

    flask_app.config["PROPAGATE_EXCEPTIONS"] = False
    try:
        response = client.get("/admin")
    finally:
        flask_app.config["PROPAGATE_EXCEPTIONS"] = None

    assert response.status_code == 500
    assert "schiefgelaufen".encode() in response.data
    assert ErrorLog.query.count() == 1
    error_row = ErrorLog.query.first()
    assert error_row.path == "/admin"
    assert "kaboom" in error_row.message
    assert error_row.user.username == "admintester"


def test_http_exceptions_are_not_logged_as_errors(client):
    register(client, username="notadmin")
    response = client.post("/admin/errors/clear")
    assert response.status_code == 403
    assert ErrorLog.query.count() == 0


def test_admin_can_view_and_clear_error_log(client):
    db.session.add(ErrorLog(path="/somewhere", method="GET", message="Testfehler"))
    db.session.commit()

    register(client, username="clearadmin")
    make_admin("clearadmin")

    response = client.get("/admin")
    assert "Testfehler".encode() in response.data

    clear_response = client.post("/admin/errors/clear", follow_redirects=True)
    assert clear_response.status_code == 200
    assert ErrorLog.query.count() == 0


def test_non_admin_cannot_clear_error_log(client):
    register(client, username="notadmin3")
    response = client.post("/admin/errors/clear")
    assert response.status_code == 403


def test_ai_job_failure_is_logged_to_error_log(client, monkeypatch):
    import ai_assistant

    def failing_generate_reply(message, context=None, history=None, project_type=None, facts=None, learned_facts=None, captured=None, behavior_note=None, personality=None, available_tokens=None, synthesize_audio_fn=None):
        raise RuntimeError("Groq ist down")

    monkeypatch.setattr(ai_assistant, "generate_reply", failing_generate_reply)
    register(client, username="aierroruser")

    start_res = client.post("/api/ai/chat", json={"message": "Hallo"})
    job_id = start_res.get_json()["job_id"]

    import time
    status_data = None
    for _ in range(20):
        status_data = client.get(f"/api/ai/chat/{job_id}").get_json()
        if status_data["status"] != "running":
            break
        time.sleep(0.05)

    assert status_data["status"] == "error"
    assert ErrorLog.query.count() == 1
    assert "Groq ist down" in ErrorLog.query.first().message


def test_anonymous_visitor_is_gated_by_terms_before_anything_else(raw_client):
    response = raw_client.get("/", follow_redirects=False)
    assert response.status_code == 302
    assert "/terms" in response.headers["Location"]

    response2 = raw_client.get("/register", follow_redirects=False)
    assert response2.status_code == 302
    assert "/terms" in response2.headers["Location"]


def test_terms_page_itself_is_reachable_without_accepting(raw_client):
    response = raw_client.get("/terms")
    assert response.status_code == 200
    assert "Nutzungsbedingungen".encode() in response.data


def test_terms_accept_unblocks_anonymous_session(raw_client):
    accept_res = raw_client.post("/terms/accept", follow_redirects=True)
    assert accept_res.status_code == 200

    # Terms are cleared, but the site-wide login gate still applies to an
    # anonymous visitor (see require_login_everywhere) -- "/" now redirects
    # to /login instead of /terms.
    response = raw_client.get("/", follow_redirects=False)
    assert response.status_code == 302
    assert "/login" in response.headers["Location"]


def test_api_endpoints_not_blocked_by_terms_gate(raw_client):
    response = raw_client.get("/api/voice-profile/status")
    assert response.status_code != 302


def test_register_sets_terms_accepted_at_for_new_account(client):
    register(client, username="termsuser")
    user = User.query.filter_by(username="termsuser").first()
    assert user.terms_accepted_at is not None


def test_fresh_registration_does_not_immediately_re_gate_on_terms(raw_client):
    raw_client.post("/terms/accept")
    params = {
        "username": "nogateloop", "password": "secret123", "password2": "secret123",
        "birthdate": "1990-01-01", "gender": "keine_angabe", "purpose_of_use": "private",
        "country": "Deutschland", "region_skipped": "1",
    }
    register_res = raw_client.post("/register", data=params)
    assert register_res.status_code == 302
    assert "/terms" not in register_res.headers["Location"]

    response = raw_client.get("/", follow_redirects=False)
    assert response.status_code == 200


def test_terms_decline_logs_out_and_redirects_to_declined_page(client):
    register(client, username="declineuser")

    response = client.post("/terms/decline", follow_redirects=False)
    assert response.status_code == 302
    assert "/terms/declined" in response.headers["Location"]

    declined_page = client.get(response.headers["Location"])
    assert declined_page.status_code == 200
    assert "timeskip_support@gmail.com".encode() in declined_page.data

    stats_res = client.get("/api/voice-profile/status")
    assert stats_res.status_code == 401


def test_existing_account_without_terms_accepted_is_gated_on_next_visit(client):
    register(client, username="legacyuser")
    user = User.query.filter_by(username="legacyuser").first()
    user.terms_accepted_at = None
    db.session.commit()

    response = client.get("/", follow_redirects=False)
    assert response.status_code == 302
    assert "/terms" in response.headers["Location"]

    client.post("/terms/accept")
    response2 = client.get("/")
    assert response2.status_code == 200


def test_terms_version_bump_re_gates_already_accepted_account(client):
    import app as app_module

    register(client, username="oldversionuser")
    user = User.query.filter_by(username="oldversionuser").first()
    assert user.terms_accepted_version == app_module.TERMS_VERSION
    # Simulate this account having accepted an older version of the terms.
    user.terms_accepted_version = app_module.TERMS_VERSION - 1
    db.session.commit()

    response = client.get("/", follow_redirects=False)
    assert response.status_code == 302
    assert "/terms" in response.headers["Location"]

    client.post("/terms/accept")
    user_after = User.query.filter_by(username="oldversionuser").first()
    assert user_after.terms_accepted_version == app_module.TERMS_VERSION
    response2 = client.get("/")
    assert response2.status_code == 200


def test_agb_redirects_to_terms_page(client):
    response = client.get("/agb", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/terms")


def test_registration_with_guardian_email_sends_welcome_notice(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append((to, subject, body)))

    register(client, username="kiduser", extra={"guardian_email": "parent@example.com"})

    assert len(sent) == 1
    assert sent[0][0] == "parent@example.com"
    assert "Willkommen" in sent[0][1]


def test_registration_without_guardian_email_sends_no_welcome_notice(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append((to, subject, body)))

    register(client, username="noguardianuser")

    assert len(sent) == 0


def test_saving_account_email_sends_confirmation_notice(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append((to, subject, body)))

    register(client, username="emailsaver")
    response = client.post(
        "/account/email", data={"email": "emailsaver@example.com"}, follow_redirects=True,
    )
    assert response.status_code == 200
    assert User.query.filter_by(username="emailsaver").first().email == "emailsaver@example.com"

    assert len(sent) == 1
    assert sent[0][0] == "emailsaver@example.com"
    assert "hinterlegt" in sent[0][1]


def test_admin_deleting_account_notifies_the_users_email(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append((to, subject, body)))

    register(client, username="boss")
    make_admin("boss")
    client.post("/admin/users", data={"username": "throwaway", "password": "secret123"})
    target = User.query.filter_by(username="throwaway").first()
    target.email = "throwaway@example.com"
    db.session.commit()

    response = client.post(f"/admin/users/{target.id}/delete", follow_redirects=True)
    assert response.status_code == 200
    assert User.query.filter_by(username="throwaway").first() is None

    assert len(sent) == 1
    assert sent[0][0] == "throwaway@example.com"
    assert "geschlossen" in sent[0][1]


def test_admin_deleting_account_without_email_sends_no_notification(client, monkeypatch):
    import app as app_module

    sent = []
    monkeypatch.setattr(app_module, "send_email", lambda to, subject, body: sent.append((to, subject, body)))

    register(client, username="boss2")
    make_admin("boss2")
    client.post("/admin/users", data={"username": "noemailuser", "password": "secret123"})
    target = User.query.filter_by(username="noemailuser").first()

    response = client.post(f"/admin/users/{target.id}/delete", follow_redirects=True)
    assert response.status_code == 200
    assert len(sent) == 0


def test_voice_chat_widget_absent_when_logged_out(client):
    response = client.get("/terms")
    assert b'id="aiVoiceOverlay"' not in response.data


def test_voice_profile_status_starts_empty(client):
    register(client, username="voiceuser")
    response = client.get("/api/voice-profile/status")
    data = response.get_json()
    assert data["ok"] is True
    assert data["profiles"] == {}


def test_voice_profile_contribute_requires_login(client):
    data = {"sample": (io.BytesIO(b"fake audio bytes"), "sample.webm")}
    response = client.post(
        "/api/voice-profile/male/contribute", data=data, content_type="multipart/form-data",
    )
    assert response.status_code == 401


def test_voice_profile_contribute_invalid_gender(client):
    register(client, username="voicecontributor")
    data = {"sample": (io.BytesIO(b"fake audio bytes"), "sample.webm")}
    response = client.post(
        "/api/voice-profile/other/contribute", data=data, content_type="multipart/form-data",
    )
    assert response.status_code == 400


def test_voice_profile_contribute_when_not_configured(client):
    register(client, username="voicecontributor2")
    data = {"sample": (io.BytesIO(b"fake audio bytes"), "sample.webm")}
    response = client.post(
        "/api/voice-profile/male/contribute", data=data, content_type="multipart/form-data",
    )
    assert response.status_code == 400
    assert response.get_json()["error"] == "not_configured"


def test_voice_profile_contribute_success_replaces_previous_clone(client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "USE_ELEVENLABS", True)
    clone_calls = []
    deleted_ids = []
    monkeypatch.setattr(
        app_module, "elevenlabs_clone_voice",
        lambda name, audio_bytes, content_type: (clone_calls.append(name), f"voice-{len(clone_calls)}")[1],
    )
    monkeypatch.setattr(app_module, "elevenlabs_delete_voice", lambda voice_id: deleted_ids.append(voice_id))

    register(client, username="voicecontributor3")
    data = {"sample": (io.BytesIO(b"fake audio bytes"), "sample.webm")}
    first = client.post("/api/voice-profile/male/contribute", data=data, content_type="multipart/form-data")
    assert first.status_code == 200
    assert first.get_json()["ok"] is True

    profile = AiVoiceProfile.query.filter_by(gender="male").first()
    assert profile is not None
    assert profile.elevenlabs_voice_id == "voice-1"
    assert profile.contributor.username == "voicecontributor3"

    data2 = {"sample": (io.BytesIO(b"more fake audio bytes"), "sample.webm")}
    second = client.post("/api/voice-profile/male/contribute", data=data2, content_type="multipart/form-data")
    assert second.status_code == 200
    assert deleted_ids == ["voice-1"]
    assert db.session.get(AiVoiceProfile, profile.id).elevenlabs_voice_id == "voice-2"


def test_voice_profile_speak_requires_login(client):
    response = client.post("/api/voice-profile/male/speak", json={"text": "Hallo"})
    assert response.status_code == 401


def test_voice_profile_speak_without_cloned_voice_404s(client):
    register(client, username="voicespeaker")
    response = client.post("/api/voice-profile/male/speak", json={"text": "Hallo"})
    assert response.status_code == 404


def test_voice_profile_speak_returns_audio_when_cloned(client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "USE_ELEVENLABS", True)
    monkeypatch.setattr(app_module, "elevenlabs_clone_voice", lambda name, audio_bytes, content_type: "voice-x")
    monkeypatch.setattr(app_module, "elevenlabs_text_to_speech", lambda voice_id, text: b"fake-mp3-bytes")

    register(client, username="voicespeaker2")
    upload = client.post(
        "/api/voice-profile/male/contribute",
        data={"sample": (io.BytesIO(b"fake audio bytes"), "sample.webm")},
        content_type="multipart/form-data",
    )
    assert upload.status_code == 200

    response = client.post("/api/voice-profile/male/speak", json={"text": "Hallo Stimme"})
    assert response.status_code == 200
    assert response.mimetype == "audio/mpeg"
    assert response.data == b"fake-mp3-bytes"


def test_admin_can_reset_voice_profile(client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(app_module, "USE_ELEVENLABS", True)
    monkeypatch.setattr(app_module, "elevenlabs_clone_voice", lambda name, audio_bytes, content_type: "voice-y")
    deleted_ids = []
    monkeypatch.setattr(app_module, "elevenlabs_delete_voice", lambda voice_id: deleted_ids.append(voice_id))

    register(client, username="voicecontributor4")
    client.post(
        "/api/voice-profile/female/contribute",
        data={"sample": (io.BytesIO(b"fake audio bytes"), "sample.webm")},
        content_type="multipart/form-data",
    )
    client.post("/logout")

    register(client, username="voiceadmin")
    make_admin("voiceadmin")

    dashboard = client.get("/admin")
    assert "KI-Sprachchat".encode() in dashboard.data

    reset_res = client.post("/admin/voice-profile/female/reset", follow_redirects=True)
    assert reset_res.status_code == 200
    assert deleted_ids == ["voice-y"]
    assert AiVoiceProfile.query.filter_by(gender="female").first() is None


def test_seed_ai_knowledge_requires_admin(client):
    register(client, username="notanadmin")
    response = client.post("/admin/ai/seed-knowledge")
    assert response.status_code == 403


def test_seed_ai_knowledge_bulk_imports_wikipedia_and_python_docs(client, monkeypatch):
    import app as app_module

    monkeypatch.setattr(
        app_module.ai_assistant, "_tool_search_wikipedia",
        lambda topic: f'Wikipedia-Artikel "{topic}": Ein Testartikel über {topic}.',
    )
    monkeypatch.setattr(
        app_module, "_fetch_python_doc_page",
        lambda topic, url: f"Aus der offiziellen python-Dokumentation ({url}): Infos zu {topic}.",
    )
    monkeypatch.setattr(app_module, "WIKIPEDIA_SEED_TOPICS", ["Testthema1", "Testthema2"])
    monkeypatch.setattr(app_module, "PYTHON_SEED_DOC_URLS", {"list": "https://example.com/list", "function": "https://example.com/function"})

    register(client, username="knowledgeadmin")
    make_admin("knowledgeadmin")

    response = client.post("/admin/ai/seed-knowledge", follow_redirects=True)
    assert response.status_code == 200
    assert AiLearnedFact.query.filter_by(source="wikipedia").count() == 2
    assert AiLearnedFact.query.filter_by(source="python_docs").count() == 2

    # Re-running skips topics already seeded instead of duplicating them.
    client.post("/admin/ai/seed-knowledge")
    assert AiLearnedFact.query.filter_by(source="wikipedia").count() == 2
    assert AiLearnedFact.query.filter_by(source="python_docs").count() == 2


def test_seeded_knowledge_reaches_general_chat_prompt(monkeypatch):
    import ai_assistant

    captured = {}

    def fake_call_model_with_router(messages, user_message, max_tokens, tools, *args, **kwargs):
        captured["system"] = messages[0]["content"]
        return "ok", None

    monkeypatch.setattr(ai_assistant, "_call_model_with_router", fake_call_model_with_router)
    ai_assistant.generate_reply(
        "Hallo!",
        learned_facts={"wikipedia": ["Wiki-Fakt X"], "docs": ["Python-Doku-Fakt Y"], "user": ["Nutzer-Fakt Z"]},
    )
    assert "Wiki-Fakt X" in captured["system"]
    assert "Python-Doku-Fakt Y" in captured["system"]
    assert "Nutzer-Fakt Z" in captured["system"]


