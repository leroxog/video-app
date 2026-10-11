"""Nex Ai's chat: the page, the list of models that can run in the browser, the program that runs them (third-party files that are
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
def test_the_list_has_a_model_for_every_kind_of_computer_best_first(models):
    assert DATE_RE.match(models["generated"]) and models["library"]["name"] == "Transformers.js"
    ml = models["models"]
    ids = [m["id"] for m in ml]
    assert len(ids) == len(set(ids)) and len(ml) >= 2
    sizes = [m["dtypes"]["q4f16"] for m in ml]
    assert sizes == sorted(sizes, reverse=True) and len(set(sizes)) == len(sizes), "best first: the bigger a model, the earlier"
    assert ml[-1]["cpu"] is True and ml[-1]["dtypes"]["q4"] < 400e6 and ml[-1]["dtypes"]["q4f16"] < 350e6, "the last one is for any computer: small enough for the memory and the processor"
    assert all(m["cpu"] is False for m in ml[:-1]), "only the last one may run on a processor alone"
    assert ids[0] == "onnx-community/Qwen3-4B-Instruct-2507-ONNX" and "onnx-community/gemma-3-1b-it-ONNX" in ids and "onnx-community/gemma-3-270m-it-ONNX" == ids[-1]
    assert ml[0]["minBuffer"] >= 1e9 and ml[0]["minMemory"] >= 8 and list(ml[0]["dtypes"]) == ["q4f16"] and ml[0]["gpu"] is True
    for m in ml:
        assert m["license_url"].startswith(("https://ai.google.dev/gemma/", "https://www.apache.org/licenses/"))


def test_every_model_is_described_completely_and_has_a_download_a_normal_computer_can_take(models):
    for m in models["models"]:
        assert re.fullmatch(r"onnx-community/[\w.-]+", m["id"]), m["id"]
        for key in ("name", "maker", "params", "license"):
            assert isinstance(m[key], str) and m[key].strip(), (m["id"], key)
        assert isinstance(m["commercial"], bool)
        assert m["dtypes"] and set(m["dtypes"]) <= {"q4f16", "q4"}, m["id"]
        assert set(m["files"]) == set(m["dtypes"]), "the big files of every variant are named (the page uses them to see that a model is in the browser)"
        for dtype, size in m["dtypes"].items():
            assert 100e6 < size < 3.2e9, (m["id"], dtype, size)
            assert m["files"][dtype][0] == f"onnx/model_{dtype}.onnx" and all(re.fullmatch(rf"onnx/model_{dtype}\.onnx(_data(_\d+)?)?", name) for name in m["files"][dtype]), (m["id"], dtype)
        if "q4" in m["dtypes"] and "q4f16" in m["dtypes"]:
            assert m["dtypes"]["q4f16"] < m["dtypes"]["q4"], "the small variant is the smaller one"
        assert m.get("minBuffer", 0) < 2e9 and m.get("minMemory", 0) <= 8, "what a model asks of the computer must be possible at all"
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
def test_the_home_page_is_the_chat_and_a_visitor_gets_no_cookie(client):
    response = client.get("/")
    text = response.get_data(as_text=True)
    assert response.status_code == 200 and "Chat mit einer KI" in text and "Set-Cookie" not in response.headers
    assert 'data-models="/static/data/browser-models.json?v=' in text and 'data-worker="/static/js/regal-chat-worker.js?v=' in text
    assert 'rel="canonical" href="http://localhost/"' in text and "regal-chat.js" in text and "models.json?v" not in text.replace("browser-models.json?v", "")
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "worker-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert client.get("/static/data/browser-models.json").status_code == 200


def test_the_old_address_of_the_chat_leads_to_the_home_page(client):
    response = client.get("/chat")
    assert response.status_code == 301 and response.headers["Location"].endswith("/")


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


def test_the_archived_list_points_to_the_chat_and_the_sitemap_has_only_the_pages_to_find(client):
    with open(os.path.join(ROOT, "static", "js", "regal.js"), encoding="utf-8") as handle:
        archive = handle.read()
    assert 'href: "/"' in archive and "KI-Chat im Browser" in archive and 'href: "/chat"' not in archive
    sitemap = ET.fromstring(client.get("/sitemap.xml", headers={"Host": "regal.example"}).data)
    urls = [e.text for e in sitemap.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]
    assert "http://regal.example/" in urls and not any("archiv" in url or url.endswith("/chat") for url in urls)


def test_the_legal_pages_say_where_the_chat_runs_and_what_it_keeps(client):
    privacy = client.get("/datenschutz").get_data(as_text=True)
    for word in ("auf deinem Gerät", "transformers-cache", "regal.chats", "regal.skip", "Transformers.js", "nicht an uns und nicht an Dritte", "Gemma 3", "Qwen3", "Grafikkarte"):
        assert word in privacy, word
    terms = client.get("/nutzungsbedingungen").get_data(as_text=True)
    for word in ("Gemma-Nutzungsbedingungen", "ai.google.dev/gemma/terms", "Qwen3", "Apache", "falsch, unvollständig oder unpassend", "NOTICE.txt"):
        assert word in terms, word


def test_the_font_of_the_site_is_served_as_a_font(client):
    response = client.get("/static/fonts/inter-latin-wght-normal.woff2")
    assert response.status_code == 200 and response.headers["Content-Type"] == "font/woff2" and "Set-Cookie" not in response.headers
    assert response.data[:4] == b"wOF2"


def test_the_page_and_the_worker_agree_on_how_a_model_in_parts_is_noted():
    """The worker writes the files of the model into the browser in parts of 48 MB and a note after the last part, because the browser
    refuses a big file in one piece; the page looks for the note to know whether the model is there."""
    with open(os.path.join(ROOT, "static", "js", "regal-chat-worker.js"), encoding="utf-8") as handle:
        worker = handle.read()
    with open(os.path.join(ROOT, "static", "js", "regal-chat-core.js"), encoding="utf-8") as handle:
        core = handle.read()
    assert "`${key}?nex-meta`" in worker and "`${key}?nex-part=${" in worker and "`${url}?nex-meta`" in core
    assert "const PART = 48 * 1024 * 1024;" in worker and "env.customCache = new PartsCache(" in worker and "env.useBrowserCache = false" in worker
    assert worker.index("await flush(filled)") < worker.index("`${key}?nex-meta`, new Response"), "the note is written last: a file is only there when the note is"
