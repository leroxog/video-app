"""Nex Ai's earlier home page, now at /modelle-archiv: the list of free AI models (more than a thousand, with their files and sizes), the
page that serves it, and the pages around it.  The searching and filtering is tested in regal_core.test.js, the files of the page in
test_regal_frontend.py; the chat that was the home page after it (now archived at /nex-ai-archiv) is tested in test_regal_chat.py; the
current home page (NSTL) is tested in test_nstl.py."""
import json
import os
import re
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import regal  # noqa: E402
import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CATALOG = os.path.join(ROOT, "static", "data", "models.json")
ID_RE = re.compile(r"^[A-Za-z0-9][\w.-]*/[A-Za-z0-9][\w.-]*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FORMATS = {"gguf", "safetensors", "onnx", "tflite"}
BANNED = re.compile(r"\b(nsfw|uncensored|abliterated|porn\w*|hentai|lewd|erotic\w*|nude|undress\w*|deepfake\w*|jailbreak\w*|lolita|loli|sexy|waifu)\b", re.I)


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


@pytest.fixture(scope="module")
def catalog():
    with open(CATALOG, encoding="utf-8") as handle:
        return json.load(handle)


# ------------------------------------------------------------------------------------------------ the list
def test_the_list_has_more_than_a_thousand_models_and_says_so_itself(catalog):
    models = catalog["models"]
    assert len(models) > 1000, f"only {len(models)} models"
    assert catalog["count"] == len(models) and DATE_RE.match(catalog["generated"]) and catalog["source"] == "huggingface.co"
    assert os.path.getsize(CATALOG) < 3 * 1024 * 1024, "the list is loaded by every visitor: it has to stay small"


def test_every_kind_that_was_asked_for_is_there_and_has_plenty(catalog):
    counts = {}
    for m in catalog["models"]:
        counts[m["k"]] = counts.get(m["k"], 0) + 1
    for kind, least in (("chat", 150), ("image", 100), ("video", 40), ("music", 40), ("speech", 40), ("listen", 30), ("code", 15)):
        assert counts.get(kind, 0) >= least, (kind, counts.get(kind, 0))
    assert set(counts) <= set(catalog["labels"]), "every kind has its name"


def test_every_model_is_described_completely_and_safely(catalog):
    seen = set()
    for m in catalog["models"]:
        assert ID_RE.match(m["id"]) and m["id"] not in seen, m["id"]
        seen.add(m["id"])
        assert not BANNED.search(m["id"]), f"{m['id']} is not for this list"
        assert m["k"] in catalog["labels"] and isinstance(m["d"], int) and m["d"] >= 0 and isinstance(m["l"], int) and m["l"] >= 0
        assert m["fmt"] and set(m["fmt"]) <= FORMATS, (m["id"], m["fmt"])
        assert isinstance(m["s"], int) and 1_000_000 <= m["s"] < 5 * 10 ** 12 and m["lo"] <= m["s"] <= m["hi"] * 1.0001, (m["id"], m["s"], m["lo"], m["hi"])
        assert m["c"] == "" or DATE_RE.match(m["c"]), m["id"]
        assert isinstance(m["lic"], str) and isinstance(m["lib"], str) and isinstance(m["task"], str)
        assert m["p"] is None or (isinstance(m["p"], int) and m["p"] > 0)
        assert m["f"], f"{m['id']} has no files"
        for path, size, parts in m["f"]:
            assert path and not path.startswith("/") and ".." not in path.split("/") and "\\" not in path and len(path) < 300, (m["id"], path)
            assert path.lower().endswith(tuple("." + f for f in FORMATS)), (m["id"], path)
            assert isinstance(size, int) and size > 0 and isinstance(parts, int) and parts >= 1


def test_the_models_are_the_ones_that_may_be_downloaded_without_a_login_and_nothing_old_and_risky(catalog):
    for m in catalog["models"]:
        for path, _, _ in m["f"]:
            assert not path.lower().endswith((".bin", ".pt", ".pth", ".ckpt", ".pkl", ".pickle")), f"{m['id']}: {path} is an old format that can run code"


def test_the_most_wanted_models_are_in_the_list(catalog):
    ids = {m["id"].lower() for m in catalog["models"]}
    # whatever else changes from one day to the next, a list like this has the well-known families
    families = {"whisper": any("whisper" in i for i in ids), "llama": any("llama" in i for i in ids), "qwen": any("qwen" in i for i in ids),
                "stable diffusion / flux": any(("stable-diffusion" in i or "flux" in i) for i in ids), "musicgen": any("musicgen" in i for i in ids)}
    assert all(families.values()), families


# ------------------------------------------------------------------------------------------------- the page
def test_the_list_of_models_is_an_archive_page_and_a_visitor_gets_no_cookie(client, catalog):
    response = client.get("/modelle-archiv")
    text = response.get_data(as_text=True)
    assert response.status_code == 200 and 'id="app"' in text and 'data-models="/static/data/models.json?v=' in text and "regal-core.js" in text
    assert f"über {(len(catalog['models']) // 100) * 100} kostenlose KI-Modelle" in text and "yipiBoot" not in text
    assert 'name="robots" content="noindex"' in text and 'rel="canonical" href="http://localhost/modelle-archiv"' in text
    assert "Set-Cookie" not in response.headers
    assert client.get("/static/data/models.json").status_code == 200
    assert "Disallow: /modelle-archiv" in client.get("/robots.txt").get_data(as_text=True)


def test_the_archived_chat_may_talk_to_hugging_face_for_the_downloads_and_to_nobody_else(client):
    response = client.get("/nex-ai-archiv")
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "'unsafe-inline'" not in csp.split("style-src")[0] and "frame-ancestors 'none'" in csp
    assert "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co;" in csp
    assert response.headers["X-Frame-Options"] == "DENY" and response.headers["Permissions-Policy"].startswith("camera=()")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get("/nex-ai-archiv", headers={"X-Forwarded-Proto": "https"}).headers["Strict-Transport-Security"].startswith("max-age=")


def test_the_archived_agents_page_talks_only_to_its_own_server_the_browser_never_reaches_groq(client):
    response = client.get("/nex-agenten-archiv")
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert "connect-src 'self';" in csp and "huggingface" not in csp and "worker-src" not in csp
    assert response.headers["X-Frame-Options"] == "DENY" and response.headers["Permissions-Policy"].startswith("camera=()")
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_the_archived_swarm_page_may_talk_to_wikipedia_and_to_nobody_else(client):
    response = client.get("/nstl-archiv")
    csp = response.headers["Content-Security-Policy"]
    assert "connect-src 'self' https://de.wikipedia.org https://en.wikipedia.org;" in csp


def test_the_manifest_and_the_images_exist(client):
    data = client.get("/nex-agenten-archiv/manifest.webmanifest").get_json()
    assert data["short_name"] == "Nex Ai" and data["start_url"] == "/nex-agenten-archiv" and data["display"] == "standalone" and "KI-Agenten" in data["name"]
    assert {icon["purpose"] for icon in data["icons"]} == {"any", "maskable"}
    for icon in data["icons"]:
        assert client.get(icon["src"]).status_code == 200, icon["src"]
    for name in ("nex-icon.svg", "nex-180.png", "nex-og.png"):
        assert client.get(f"/static/img/{name}").status_code == 200, name

    archived = client.get("/nex-ai-archiv/manifest.webmanifest").get_json()
    assert archived["short_name"] == "Nex Ai" and archived["start_url"] == "/nex-ai-archiv" and "KI-Chat" in archived["name"]
    for icon in archived["icons"]:
        assert client.get(icon["src"]).status_code == 200, icon["src"]

    swarm = client.get("/nstl-archiv/manifest.webmanifest").get_json()
    assert swarm["short_name"] == "NSTL" and swarm["start_url"] == "/nstl-archiv" and "Agentenschwarm" in swarm["name"]
    for name in ("nstl-icon.svg", "nstl-180.png", "nstl-og.png"):
        assert client.get(f"/static/img/{name}").status_code == 200, name


def test_the_old_home_pages_are_still_there_and_the_site_pages_are_those_of_pulse(client):
    assert b"yipiBoot" in client.get("/").data and b"gomatData" in client.get("/gomat-archiv").data
    assert b"regal-agents.js" in client.get("/nex-agenten-archiv").data
    assert b"regal-core.js" in client.get("/nex-ai-archiv").data
    assert b"nstl-swarm-worker.js" in client.get("/nstl-archiv").data
    for path, words in (("/datenschutz", ("Nex Ai", "regal.fav", "regal.chats", "Hugging Face", "keine Cookies", "yipi_session")), ("/impressum", ("§ 5 DDG", "Rechtswidrige Inhalte melden")),
                        ("/nutzungsbedingungen", ("Lizenz", "Hugging Face", "16 Jahren", "yipi"))):
        page = client.get(path)
        text = page.get_data(as_text=True)
        assert page.status_code == 200 and "| Pulse</title>" in text and "Set-Cookie" not in page.headers, path
        for word in words:
            assert word in text, (path, word)
    error_page = client.get("/gibt-es-nicht-1234")
    assert error_page.status_code == 404 and "Pulse" in error_page.get_data(as_text=True)
    assert "Sitemap:" in client.get("/robots.txt").get_data(as_text=True)
