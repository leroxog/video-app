"""KI-Regal's chat: the page, the list of models that can run in the browser, the program that runs them (third-party files that are
copied as they are and must stay as they are), and what the server says about all that (types and security policies).  The chat logic
is tested in regal_chat_core.test.js, the files of the page in test_regal_frontend.py."""
import gzip
import hashlib
import json
import os
import re
import sys
import tempfile
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import regal  # noqa: E402
import siteauth  # noqa: E402
import yipi  # noqa: E402
from app import app as flask_app, db  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VENDOR = os.path.join(ROOT, "static", "vendor", "transformers")
MODELS = os.path.join(ROOT, "static", "data", "browser-models.json")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


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
def models():
    with open(MODELS, encoding="utf-8") as handle:
        return json.load(handle)


# ------------------------------------------------------------------------------------------- the list of models
def test_the_list_has_models_for_every_kind_of_computer(models):
    assert DATE_RE.match(models["generated"]) and models["library"]["name"] == "Transformers.js"
    ids = [m["id"] for m in models["models"]]
    assert len(ids) == len(set(ids)) and len(ids) >= 5
    assert any("q4" in m["dtypes"] for m in models["models"]), "at least one model must run without a graphics card"
    assert any("q4f16" in m["dtypes"] and "q4" in m["dtypes"] for m in models["models"])
    assert any(re.search(r"coder|code", m["id"] + m["tag"], re.I) for m in models["models"]), "one to program with"
    assert any(m["german"] == "gut" for m in models["models"]), "one that speaks German well"


def test_every_model_is_described_completely_and_has_a_download_a_normal_computer_can_take(models):
    for m in models["models"]:
        assert re.fullmatch(r"onnx-community/[\w.-]+", m["id"]), m["id"]
        for key in ("name", "maker", "params", "tag", "note", "license"):
            assert isinstance(m[key], str) and m[key].strip(), (m["id"], key)
        assert m["german"] in ("gut", "ok", "einfach") and isinstance(m["commercial"], bool)
        assert m["dtypes"] and set(m["dtypes"]) <= {"q4f16", "q4"}, m["id"]
        assert set(m["files"]) == set(m["dtypes"]), "the big files of every variant are named (the page uses them to see that a model is in the browser)"
        for dtype, size in m["dtypes"].items():
            assert 100e6 < size < 5e9, (m["id"], dtype, size)
            assert m["files"][dtype][0] == f"onnx/model_{dtype}.onnx" and all(re.fullmatch(rf"onnx/model_{dtype}\.onnx(_data(_\d+)?)?", name) for name in m["files"][dtype]), (m["id"], dtype)
        if "q4" in m["dtypes"] and "q4f16" in m["dtypes"]:
            assert m["dtypes"]["q4f16"] < m["dtypes"]["q4"], "the small variant is the smaller one"
        assert (not m.get("gpu")) == ("q4" in m["dtypes"]), f"{m['id']}: `gpu` must say that there is no variant for the processor"


def test_the_list_is_small_enough_to_load_at_once():
    assert os.path.getsize(MODELS) < 40 * 1024


# --------------------------------------------------------------------------------------- the runtime (third party)
def test_the_runtime_files_are_the_ones_the_notice_names_and_are_unchanged():
    with open(os.path.join(VENDOR, "NOTICE.txt"), encoding="utf-8") as handle:
        notice = handle.read()
    names = ("transformers.min.js", "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm")
    for name in names:
        big = name.endswith((".wasm", ".min.js"))
        with open(os.path.join(VENDOR, name + (".gz" if big else "")), "rb") as handle:
            data = handle.read()
        if big:
            data = gzip.decompress(data)                        # the big files are kept compressed; what they unpack to is what was checked
        assert f"{hashlib.sha256(data).hexdigest()}  {name}" in notice, f"{name} is not the file that was checked and noted"
    for big in ("ort-wasm-simd-threaded.asyncify.wasm", "transformers.min.js"):
        assert not os.path.exists(os.path.join(VENDOR, big)), f"only the compressed copy of {big} belongs in the repository"
    for text in ("Apache License 2.0", "MIT License", "4.3.0", "1.31.0-dev.20260914-8d85527a0"):
        assert text in notice
    assert os.path.exists(os.path.join(VENDOR, "LICENSE-transformers.js.txt"))


def test_the_runtime_does_not_reach_for_other_servers_by_itself():
    """The default of Transformers.js is to get its WebAssembly from a CDN; the worker sets the path to our own server.  The CDN name may
    still be in the library's text (it is the default that is overridden), but the worker has to override it."""
    with open(os.path.join(ROOT, "static", "js", "regal-chat-worker.js"), encoding="utf-8") as handle:
        worker = handle.read()
    assert "wasmPaths = { mjs:" in worker and "ort-wasm-simd-threaded.asyncify.wasm" in worker and "import.meta.url" in worker
    assert "allowLocalModels = false" in worker and "useWasmCache = false" in worker
    assert "cdn.jsdelivr" not in worker and "from \"https://" not in worker and "from 'https://" not in worker


# ---------------------------------------------------------------------------------------------------- the server
def test_the_chat_page_is_there_and_a_visitor_gets_no_cookie(client):
    response = client.get("/chat")
    text = response.get_data(as_text=True)
    assert response.status_code == 200 and "Chat im Browser" in text and "Set-Cookie" not in response.headers
    assert 'data-models="/static/data/browser-models.json?v=' in text and 'data-worker="/static/js/regal-chat-worker.js?v=' in text
    assert 'rel="canonical" href="http://localhost/chat"' in text
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "worker-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert client.get("/static/data/browser-models.json").status_code == 200


def test_the_worker_has_its_own_policy_it_may_run_webassembly_and_load_the_model_and_nothing_else(client):
    response = client.get("/static/js/regal-chat-worker.js")
    csp = response.headers["Content-Security-Policy"]
    assert response.status_code == 200 and csp.startswith("default-src 'none'")
    assert "script-src 'self' 'wasm-unsafe-eval'" in csp and "'unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", "")
    assert "connect-src 'self' https://huggingface.co https://*.huggingface.co https://*.hf.co" in csp
    other = client.get("/static/js/regal-chat.js")
    assert "Content-Security-Policy" not in other.headers, "only the worker gets this policy"


def test_the_runtime_is_served_with_the_types_a_module_script_and_webassembly_need(client):
    for name, kind in (("transformers.min.js", "text/javascript"), ("ort-wasm-simd-threaded.asyncify.mjs", "text/javascript"),
                       ("ort-wasm-simd-threaded.asyncify.wasm", "application/wasm"), ("NOTICE.txt", "text/plain")):
        response = client.get(f"/static/vendor/transformers/{name}", headers={"Accept-Encoding": "gzip"}, buffered=False)
        assert response.status_code == 200, name
        assert response.headers["Content-Type"].startswith(kind), (name, response.headers["Content-Type"])
        assert response.headers["X-Content-Type-Options"] == "nosniff"
        assert "Set-Cookie" not in response.headers
        response.close()


def test_the_big_runtime_files_are_sent_compressed_to_browsers_and_unpacked_for_a_client_that_cannot():
    with flask_app.test_client() as client:
        for name, start, limit in (("ort-wasm-simd-threaded.asyncify.wasm", b"\x00asm", 8_000_000), ("transformers.min.js", b"var ", 300_000)):
            url = f"/static/vendor/transformers/{name}"
            packed = client.get(url, headers={"Accept-Encoding": "gzip, deflate, br"})
            assert packed.status_code == 200 and packed.headers["Content-Encoding"] == "gzip" and "Accept-Encoding" in packed.headers["Vary"], name
            assert len(packed.data) < limit, "that is the compressed size: the browser unpacks it"
            plain = client.get(url, headers={"Accept-Encoding": "identity"})
            assert plain.status_code == 200 and "Content-Encoding" not in plain.headers and plain.data[:4] == start, name
            assert gzip.decompress(packed.data) == plain.data
            again = client.get(url, headers={"Accept-Encoding": "gzip", "If-None-Match": packed.headers["ETag"]})
            assert again.status_code == 304
        assert client.get("/static/vendor/transformers/nothing-here.wasm").status_code == 404
        assert client.get("/static/vendor/transformers/..%2Fregal.wasm").status_code == 404
        assert client.get("/static/vendor/transformers/../../../app.py").status_code == 404
        plain_file = client.get("/static/vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs")
        assert plain_file.status_code == 200 and plain_file.headers["Content-Type"].startswith("text/javascript") and "Content-Encoding" not in plain_file.headers


def test_the_home_page_points_to_the_chat_and_the_sitemap_lists_it(client):
    with open(os.path.join(ROOT, "static", "js", "regal.js"), encoding="utf-8") as handle:
        home = handle.read()
    assert 'href: "/chat"' in home and "Chat im Browser" in home
    sitemap = ET.fromstring(client.get("/sitemap.xml", headers={"Host": "regal.example"}).data)
    urls = [e.text for e in sitemap.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    assert "http://regal.example/chat" in urls


def test_the_legal_pages_say_where_the_chat_runs_and_what_it_keeps(client):
    privacy = client.get("/datenschutz").get_data(as_text=True)
    for word in ("auf deinem Gerät", "transformers-cache", "regal.chat.model", "regal.chats", "Transformers.js", "nicht an uns und nicht an Dritte"):
        assert word in privacy, word
    terms = client.get("/nutzungsbedingungen").get_data(as_text=True)
    for word in ("Der Chat im Browser", "falsch, unvollständig oder unpassend", "NOTICE.txt"):
        assert word in terms, word
