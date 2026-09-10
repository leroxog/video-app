import io
import os
import sys
import shutil
import tempfile
import time

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Must be set before importing app.py (it binds the DB engine at import time).
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"

import pytest
from app import app as flask_app, db
from models import User, AiChat, AiChatMessage, AiChatFeedback, AiPersonality, AiAdminFact, ErrorLog, AiVoiceProfile


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    upload_dir = tempfile.mkdtemp()
    flask_app.config["UPLOAD_FOLDER"] = upload_dir
    flask_app.config["PROFILE_PIC_FOLDER"] = tempfile.mkdtemp()
    flask_app.config["SOUND_FOLDER"] = tempfile.mkdtemp()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()
    shutil.rmtree(upload_dir, ignore_errors=True)


def _stub_reply(monkeypatch, text="Antwort", title="Ein Titel"):
    import ai_assistant
    monkeypatch.setattr(ai_assistant, "generate_reply", lambda *a, **k: (text, None))
    monkeypatch.setattr(ai_assistant, "generate_title", lambda first_message: title)


def _drain_job(client, job_id):
    for _ in range(40):
        status = client.get(f"/api/ai/chat/{job_id}").get_json()
        if status["status"] != "running":
            return status
        time.sleep(0.05)
    return status


# --------------------------------------------------------------------------
# The site is now just the two hidden AI chats -- everything else is gone.
# --------------------------------------------------------------------------

def test_homepage_is_a_blank_page_with_no_hints(client):
    response = client.get("/")
    assert response.status_code == 200
    body = response.data.decode().lower()
    assert "assistant" not in body
    assert "7ai" not in body
    assert "nex" not in body
    assert "<a" not in body  # no links pointing anywhere


@pytest.mark.parametrize("path", [
    "/login", "/register", "/logout", "/terms", "/agb", "/account/settings",
    "/admin", "/admin/ai-training", "/galerie", "/forgot-password", "/unlock",
    "/complete-profile", "/api/ai/guest-chat",
])
def test_removed_routes_are_gone(client, path):
    assert client.get(path).status_code == 404
    assert client.post(path).status_code in (404, 405)


def test_assistant_and_sevenai_pages_load_without_login(client):
    assert client.get("/assistant").status_code == 200
    assert client.get("/7ai").status_code == 200


def test_offline_page_and_service_worker_still_served(client):
    assert client.get("/offline").status_code == 200
    sw = client.get("/service-worker.js")
    assert sw.status_code == 200
    assert "javascript" in sw.headers["Content-Type"]


# --------------------------------------------------------------------------
# AI chat works fully anonymously (an invisible throwaway account is minted
# per browser session -- see app.current_user / _create_anon_user).
# --------------------------------------------------------------------------

def test_visiting_a_chat_page_mints_one_anon_user_reused_afterwards(client):
    assert User.query.count() == 0
    client.get("/assistant")
    assert User.query.count() == 1
    client.get("/assistant")
    client.get("/7ai")
    assert User.query.count() == 1  # session cookie carries the identity


def test_ai_chat_round_trip_persists_history_anonymously(client, monkeypatch):
    _stub_reply(monkeypatch, text="Hallo zurück!", title="Begrüßung")
    start = client.post("/api/ai/chat", json={"message": "Sag Hallo"})
    data = start.get_json()
    assert data["ok"] is True
    status = _drain_job(client, data["job_id"])
    assert status["status"] == "done"
    assert status["reply"] == "Hallo zurück!"

    msgs = client.get(f"/api/ai/chats/{data['chat_id']}/messages").get_json()
    assert msgs["messages"] == [
        {"role": "user", "content": "Sag Hallo"},
        {"role": "assistant", "content": "Hallo zurück!"},
    ]
    assert msgs["chat"]["title"] == "Begrüßung"


def test_ai_chat_rejects_empty_message(client):
    assert client.post("/api/ai/chat", json={"message": "   "}).status_code == 400


def test_ai_chat_code_project_type_persists_chat_mode(client, monkeypatch):
    _stub_reply(monkeypatch)
    data = client.post("/api/ai/chat", json={"message": "Wie geht ein dict?", "project_type": "code"}).get_json()
    assert db.session.get(AiChat, data["chat_id"]).mode == "code"


def test_ai_chat_status_unknown_job_404s(client):
    assert client.get("/api/ai/chat/does-not-exist").status_code == 404


def test_ai_job_failure_is_logged(client, monkeypatch):
    import ai_assistant

    def boom(*a, **k):
        raise RuntimeError("Groq ist down")

    monkeypatch.setattr(ai_assistant, "generate_reply", boom)
    job_id = client.post("/api/ai/chat", json={"message": "Hallo"}).get_json()["job_id"]
    status = _drain_job(client, job_id)
    assert status["status"] == "error"
    assert ErrorLog.query.count() == 1
    assert "Groq ist down" in ErrorLog.query.first().message


def test_ai_chats_create_list_rename_delete(client, monkeypatch):
    _stub_reply(monkeypatch)
    created = client.post("/api/ai/chats", json={}).get_json()["chat"]
    chat_id = created["id"]

    listing = client.get("/api/ai/chats").get_json()["chats"]
    assert [c["id"] for c in listing] == [chat_id]

    client.patch(f"/api/ai/chats/{chat_id}", json={"title": "Mein Chat"})
    assert db.session.get(AiChat, chat_id).title == "Mein Chat"

    client.post(f"/api/ai/chats/{chat_id}/delete")
    assert client.get("/api/ai/chats").get_json()["chats"] == []


def test_ai_chats_scoped_by_character(client, monkeypatch):
    _stub_reply(monkeypatch)
    nex_id = client.post("/api/ai/chat", json={"message": "Hi Nex"}).get_json()["chat_id"]
    seven_id = client.post(
        "/api/ai/chat", json={"message": "Hi 7Ai", "project_type": "sevenai", "character": "sevenai"},
    ).get_json()["chat_id"]
    assert nex_id != seven_id
    assert db.session.get(AiChat, nex_id).character == "nex"
    assert db.session.get(AiChat, seven_id).character == "sevenai"
    assert [c["id"] for c in client.get("/api/ai/chats?character=nex").get_json()["chats"]] == [nex_id]
    assert [c["id"] for c in client.get("/api/ai/chats?character=sevenai").get_json()["chats"]] == [seven_id]
    assert [c["id"] for c in client.get("/api/ai/chats").get_json()["chats"]] == [nex_id]


def test_ai_chats_are_scoped_to_the_session(client, monkeypatch):
    _stub_reply(monkeypatch)
    chat_id = client.post("/api/ai/chat", json={"message": "Hallo"}).get_json()["chat_id"]
    # A fresh client == a fresh browser session == a different anon user.
    other = flask_app.test_client()
    assert other.get("/api/ai/chats").get_json()["chats"] == []
    assert other.get(f"/api/ai/chats/{chat_id}/messages").status_code == 404


def test_token_economy_is_off_everyone_chats_freely(client, monkeypatch):
    _stub_reply(monkeypatch)
    # A huge message that would have blown any old token budget.
    data = client.post("/api/ai/chat", json={"message": "x" * 5000}).get_json()
    assert data["ok"] is True


def test_ai_feedback_is_stored(client):
    client.get("/assistant")  # mint the anon user
    res = client.post("/api/ai/feedback", json={"message": "Hi", "reply": "Hallo", "rating": 1})
    assert res.get_json()["ok"] is True
    assert AiChatFeedback.query.count() == 1


def test_ai_feedback_rejects_invalid_rating(client):
    client.get("/assistant")
    assert client.post("/api/ai/feedback", json={"message": "Hi", "reply": "Hallo", "rating": 0}).status_code == 400


def test_buddy_mode_sets_mimic_flag(client):
    client.get("/assistant")
    assert client.post("/api/ai/buddy-mode").get_json()["ok"] is True
    user = User.query.first()
    assert AiPersonality.query.filter_by(user_id=user.id).first().mimic_user_style is True


# --------------------------------------------------------------------------
# 7Ai keeps its own persona/tools (pure ai_assistant, no request needed).
# --------------------------------------------------------------------------

def test_sevenai_uses_its_own_system_prompt_and_tools(monkeypatch):
    import ai_assistant
    captured = {}

    def fake_router(messages, user_message, max_tokens, tools, *a, **k):
        captured["system_prompt"] = messages[0]["content"]
        captured["tools"] = tools
        return "ok", None

    monkeypatch.setattr(ai_assistant, "_call_model_with_router", fake_router)
    monkeypatch.setattr(ai_assistant, "_call_model", lambda *a, **k: captured.setdefault("direct", True) or ("ok", None))

    ai_assistant.generate_reply("Hallo?", project_type="sevenai")

    assert "direct" not in captured
    assert captured["tools"] == ai_assistant.SEVENAI_TOOLS
    assert ai_assistant.REMEMBER_USER_FACT_TOOL not in captured["tools"]
    assert captured["system_prompt"] == (
        ai_assistant.SEVENAI_SYSTEM_PROMPT + ai_assistant.SEVENAI_TOOLS_ADDENDUM + ai_assistant.FORMATTING_ADDENDUM
    )
    assert "7Ai" in ai_assistant.SEVENAI_SYSTEM_PROMPT


# --------------------------------------------------------------------------
# Voice-profile endpoints (used by the chat's "Mit der KI reden" mode).
# --------------------------------------------------------------------------

def test_voice_profile_status_starts_empty(client):
    assert client.get("/api/voice-profile/status").get_json() == {"ok": True, "profiles": {}}


def test_voice_profile_contribute_rejects_invalid_gender(client):
    client.get("/assistant")
    res = client.post("/api/voice-profile/other/contribute", data={"sample": (io.BytesIO(b"x"), "a.webm")})
    assert res.status_code == 400


def test_voice_profile_speak_without_cloned_voice_404s(client):
    client.get("/assistant")
    assert client.post("/api/voice-profile/male/speak", json={"text": "Hallo"}).status_code == 404
