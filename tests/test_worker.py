"""Tests for the ysound song computer (ysound_worker/): config, job checking, talking to the website and to
the local model server (both faked with tiny local HTTP servers), and the network guard."""
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

WORKER_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ysound_worker"))
sys.path.insert(0, WORKER_DIR)
import netguard  # noqa: E402
import worker  # noqa: E402

REAL_SLEEP = time.sleep
TOKEN = "t" * 40
MP3 = b"\xff\xfb\x90\x00" + b"\x00" * 200


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    monkeypatch.setattr(worker.time, "sleep", lambda s: None)


class FakeServer:
    """A tiny HTTP server; `routes` maps (METHOD, path-without-query) to a function(handler, body) returning
    (status, content-type, bytes) and `seen` records every request as (METHOD, path, headers, body)."""

    def __init__(self, routes):
        self.routes, self.seen = routes, []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                outer.seen.append((self.command, self.path, dict(self.headers), body))
                route = outer.routes.get((self.command, self.path.split("?")[0]))
                status, ctype, data = route(self, body) if route else (404, "text/plain", b"nope")
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                for name, value in getattr(self, "extra_headers", {}).items():
                    self.send_header(name, value)
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = _handle

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture
def serve():
    servers = []

    def make(routes):
        servers.append(FakeServer(routes))
        return servers[-1]

    yield make
    for server in servers:
        server.close()


def jsonreply(payload, status=200):
    return lambda handler, body: (status, "application/json", json.dumps(payload).encode())


# ------------------------------------------------------------------ config

def write_config(tmp_path, **changes):
    data = {"site": "https://nexai.up.railway.app", "token": TOKEN, "model_api": "http://127.0.0.1:8001", "model_api_key": "k"}
    data.update(changes)
    path = tmp_path / "worker.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_a_good_config_loads_with_defaults(tmp_path):
    config = worker.load_config(write_config(tmp_path))
    assert config["site"] == "https://nexai.up.railway.app" and config["inference_steps"] == 8
    assert config["poll_seconds"] == 4 and config["job_timeout_seconds"] == 1500 and config["cooldown_seconds"] == 5
    assert worker.load_config(write_config(tmp_path, site="https://nexai.up.railway.app/"))["site"] == "https://nexai.up.railway.app"


@pytest.mark.parametrize("changes", [
    {"surprise": 1},                                           # typos and unknown fields are refused
    {"site": "http://nexai.up.railway.app"},                   # no plain http to the internet
    {"site": "ftp://nexai.up.railway.app"}, {"site": "nexai.up.railway.app"}, {"site": "https://x.example/path"},
    {"token": "short"}, {"token": 12345678901234567890123456789012345},
    {"model_api": "http://192.168.1.5:8001"}, {"model_api": "http://evil.example:8001"},
    {"model_api": "https://127.0.0.1:8001"},
    {"poll_seconds": 0}, {"poll_seconds": True}, {"inference_steps": 99}, {"job_timeout_seconds": "x"},
])
def test_unsafe_or_broken_configs_are_refused(tmp_path, changes):
    with pytest.raises(worker.WorkerError):
        worker.load_config(write_config(tmp_path, **changes))


def test_plain_http_is_allowed_for_localhost_only_for_testing(tmp_path):
    assert worker.load_config(write_config(tmp_path, site="http://localhost:5000"))["site"] == "http://localhost:5000"
    assert worker.load_config(write_config(tmp_path, site="http://127.0.0.1:5000"))


def test_missing_or_broken_config_files_give_a_clear_error(tmp_path):
    with pytest.raises(worker.WorkerError):
        worker.load_config(tmp_path / "nope.json")
    (tmp_path / "bad.json").write_text("{not json")
    with pytest.raises(worker.WorkerError):
        worker.load_config(tmp_path / "bad.json")
    (tmp_path / "list.json").write_text("[1]")
    with pytest.raises(worker.WorkerError):
        worker.load_config(tmp_path / "list.json")


def test_init_creates_fresh_secrets_and_returns_only_the_hash_for_the_website(tmp_path, capsys):
    path = tmp_path / "sub" / "worker.json"
    token_hash = worker.init_config(path, "https://nexai.up.railway.app/")
    config = json.loads(path.read_text())
    assert len(token_hash) == 64 and hashlib.sha256(config["token"].encode()).hexdigest() == token_hash
    assert len(config["token"]) >= 48 and len(config["model_api_key"]) >= 32 and token_hash != config["token"]
    assert worker.load_config(path)["token"] == config["token"]
    with pytest.raises(worker.WorkerError):
        worker.init_config(path, "https://nexai.up.railway.app")          # never overwrites existing secrets
    assert json.loads(path.read_text()) == config
    with pytest.raises(worker.WorkerError):
        worker.init_config(tmp_path / "other.json", "http://nexai.up.railway.app")
    assert not (tmp_path / "other.json").exists()
    assert worker.main(["--init", "--site", "https://x.example", "--config", str(tmp_path / "third.json")]) == 0
    out = capsys.readouterr().out
    assert "YSOUND_WORKER_TOKEN_SHA256=" in out and json.loads((tmp_path / "third.json").read_text())["token"] not in out


# --------------------------------------------------------------------- jobs

def good_job(**changes):
    job = {"id": 7, "tags": "lo-fi hip hop, calm piano", "lyrics": "[verse]\nHallo Welt", "duration": 150, "language": "de"}
    job.update(changes)
    return job


def test_a_valid_job_passes_and_only_known_fields_survive():
    clean = worker.clean_job(good_job(path="C:/Windows/system32", model="evil", url="http://x"))
    assert clean == good_job()


def test_job_text_is_cleaned_and_cut_to_size():
    clean = worker.clean_job(good_job(tags="  pop\x00\x1b[31m, rock\r\n\t", lyrics="[verse]\r\nZeile\x07 eins\n\n\x00 zwei  "))
    assert clean["tags"] == "pop[31m, rock" and "\x00" not in clean["lyrics"] and "\r" not in clean["lyrics"]
    assert clean["lyrics"] == "[verse]\nZeile eins\n\n zwei"
    assert len(worker.clean_job(good_job(tags="x" * 5000, lyrics="y" * 9000))["tags"]) == worker.TAGS_MAX
    assert len(worker.clean_job(good_job(lyrics="y" * 9000))["lyrics"]) == worker.LYRICS_MAX
    assert worker.clean_job(good_job(language="klingon"))["language"] == "unknown"
    assert worker.clean_job(good_job(language=None))["language"] == "unknown"


@pytest.mark.parametrize("changes", [
    {"id": 0}, {"id": -3}, {"id": True}, {"id": "7"}, {"id": 2 ** 40}, {"id": None},
    {"duration": 5}, {"duration": 9999}, {"duration": "150"}, {"duration": 150.5}, {"duration": True},
    {"tags": ""}, {"tags": "   "}, {"tags": None}, {"tags": 5}, {"lyrics": ""}, {"lyrics": None}, {"lyrics": ["x"]},
])
def test_invalid_jobs_are_refused(changes):
    with pytest.raises(worker.WorkerError):
        worker.clean_job(good_job(**changes))
    for raw in (None, [], "job", 5):
        with pytest.raises(worker.WorkerError):
            worker.clean_job(raw)


# ----------------------------------------------------------------------- http

def test_redirects_are_never_followed_so_the_token_cannot_leak(serve):
    elsewhere = serve({("POST", "/steal"): jsonreply({"ok": True})})

    def redirect(handler, body):
        handler.extra_headers = {"Location": elsewhere.url + "/steal"}
        return 302, "text/plain", b""

    site = serve({("POST", "/api/ysound/worker/claim"): redirect})
    with pytest.raises(worker.WorkerError):
        worker.Site(site.url, TOKEN).claim()
    assert elsewhere.seen == []


def test_connection_errors_become_worker_errors():
    with pytest.raises(worker.WorkerError):
        worker.http("GET", "http://127.0.0.1:9/never", timeout=2)


def test_responses_are_size_limited(serve):
    server = serve({("GET", "/big"): lambda h, b: (200, "text/plain", b"x" * 5000)})
    status, body = worker.http("GET", server.url + "/big", max_bytes=100)
    assert status == 200 and len(body) == 101


# ----------------------------------------------------------------------- site

def site_routes(job=None, claim_status=200):
    return {
        ("POST", "/api/ysound/worker/ping"): jsonreply({"ok": True, "waiting": 2}),
        ("POST", "/api/ysound/worker/claim"): jsonreply({"ok": True, "job": job}, claim_status),
        ("POST", "/api/ysound/worker/jobs/7/audio"): jsonreply({"ok": True}),
        ("POST", "/api/ysound/worker/jobs/7/fail"): jsonreply({"ok": True}),
    }


def test_the_site_client_sends_the_token_and_returns_the_job(serve):
    server = serve(site_routes(job=good_job()))
    site = worker.Site(server.url, TOKEN)
    assert site.claim() == good_job() and site.ping() == {"ok": True, "waiting": 2}
    assert all(req[2].get("Authorization") == f"Bearer {TOKEN}" for req in server.seen)
    server.routes[("POST", "/api/ysound/worker/claim")] = jsonreply({"ok": True, "job": None})
    assert site.claim() is None


def test_the_site_client_uploads_raw_audio_and_reports_failures(serve):
    server = serve(site_routes())
    site = worker.Site(server.url, TOKEN)
    site.upload(7, MP3)
    method, path, headers, body = server.seen[-1]
    assert (method, path, body) == ("POST", "/api/ysound/worker/jobs/7/audio", MP3)
    assert headers["Content-Type"] == "application/octet-stream"
    site.fail(7)
    assert server.seen[-1][1] == "/api/ysound/worker/jobs/7/fail"


def test_a_rejected_upload_is_not_retried_but_a_dead_connection_is(serve):
    server = serve({("POST", "/api/ysound/worker/jobs/7/audio"): jsonreply({"ok": False}, 400)})
    with pytest.raises(worker.Rejected):
        worker.Site(server.url, TOKEN).upload(7, MP3)
    assert len(server.seen) == 1
    with pytest.raises(worker.WorkerError):
        worker.Site("http://127.0.0.1:9", TOKEN).upload(7, MP3)


def test_a_wrong_token_or_missing_feature_gets_a_helpful_message(serve):
    wrong = serve({("POST", "/api/ysound/worker/claim"): jsonreply({"error": "unauthorized"}, 401),
                   ("POST", "/api/ysound/worker/ping"): jsonreply({"error": "unauthorized"}, 401)})
    with pytest.raises(worker.WorkerError, match="lehnt das Token ab"):
        worker.Site(wrong.url, TOKEN).claim()
    missing = serve({("POST", "/api/ysound/worker/claim"): jsonreply({"error": "not_found"}, 404),
                     ("POST", "/api/ysound/worker/ping"): jsonreply({"error": "not_found"}, 404)})
    with pytest.raises(worker.WorkerError, match="kennt den Song-Rechner nicht"):
        worker.Site(missing.url, TOKEN).claim()
    garbage = serve({("POST", "/api/ysound/worker/claim"): lambda h, b: (200, "text/html", b"<html>")})
    with pytest.raises(worker.WorkerError, match="kein JSON"):
        worker.Site(garbage.url, TOKEN).claim()


# ---------------------------------------------------------------------- model

def model_routes(statuses=(0, 1), file_path="/v1/audio?path=%2Ftmp%2Fa.mp3", audio=MP3, accept=True):
    state = {"polls": 0}

    def release(handler, body):
        return (200, "application/json", json.dumps({"data": {"task_id": "11111111-2222-3333-4444-555555555555", "status": "queued"}, "code": 200}).encode()) if accept \
            else (500, "application/json", b'{"error": "boom"}')

    def query(handler, body):
        status = statuses[min(state["polls"], len(statuses) - 1)]
        state["polls"] += 1
        result = json.dumps([{"file": file_path, "status": status}]) if status == 1 else ""
        return 200, "application/json", json.dumps({"data": [{"task_id": "11111111-2222-3333-4444-555555555555", "status": status, "result": result}], "code": 200}).encode()

    return {
        ("GET", "/health"): jsonreply({"data": {"status": "ok"}, "code": 200}),
        ("POST", "/release_task"): release, ("POST", "/query_result"): query,
        ("GET", "/v1/audio"): lambda h, b: (200, "audio/mpeg", audio),
    }


def make_model(server, timeout=30):
    return worker.Model(server.url, "model-key", 8, timeout)


def test_the_model_client_runs_a_job_and_sends_exactly_the_checked_fields(serve):
    server = serve(model_routes())
    model = make_model(server)
    assert model.health() is True
    assert model.generate(worker.clean_job(good_job())) == MP3
    body = json.loads(next(req[3] for req in server.seen if req[1] == "/release_task"))
    assert body == {"prompt": "lo-fi hip hop, calm piano", "lyrics": "[verse]\nHallo Welt", "audio_duration": 150,
                    "vocal_language": "de", "audio_format": "mp3", "inference_steps": 8, "thinking": False,
                    "use_format": False, "batch_size": 1}
    assert all(req[2].get("Authorization") == "Bearer model-key" for req in server.seen)


@pytest.mark.parametrize("routes, message", [
    (dict(accept=False), "nicht angenommen"),
    (dict(statuses=(0, 2)), "Fehler bei der Erzeugung"),
    (dict(file_path="/etc/passwd"), "unerwarteten Dateipfad"),
    (dict(file_path="http://evil.example/x.mp3"), "unerwarteten Dateipfad"),
    (dict(audio=b"<html>not audio</html>"), "keine brauchbare MP3"),
    (dict(audio=b""), "keine brauchbare MP3"),
])
def test_model_problems_become_clear_worker_errors(serve, routes, message):
    with pytest.raises(worker.WorkerError, match=message):
        make_model(serve(model_routes(**routes))).generate(worker.clean_job(good_job()))


def test_a_model_that_never_finishes_runs_into_the_time_limit(serve, monkeypatch):
    monkeypatch.setattr(worker.time, "sleep", lambda s: REAL_SLEEP(0.02))
    with pytest.raises(worker.WorkerError, match="Zeitlimit"):
        make_model(serve(model_routes(statuses=(0,))), timeout=0.3).generate(worker.clean_job(good_job()))


def test_a_down_model_server_is_reported():
    with pytest.raises(worker.WorkerError):
        worker.Model("http://127.0.0.1:9", "k", 8, 5).health()


# ----------------------------------------------------------------------- loop

def test_one_job_goes_from_the_site_through_the_model_and_back(serve):
    site_server = serve(site_routes(job=good_job()))
    model_server = serve(model_routes())
    assert worker.run_once(worker.Site(site_server.url, TOKEN), make_model(model_server)) is True
    assert [req[1] for req in site_server.seen] == ["/api/ysound/worker/claim", "/api/ysound/worker/jobs/7/audio"]
    assert site_server.seen[-1][3] == MP3


def test_no_job_means_no_model_call(serve):
    site_server = serve(site_routes(job=None))
    model_server = serve(model_routes())
    assert worker.run_once(worker.Site(site_server.url, TOKEN), make_model(model_server)) is False
    assert model_server.seen == []


def test_a_failing_model_reports_the_failure_to_the_site(serve):
    site_server = serve(site_routes(job=good_job()))
    model_server = serve(model_routes(statuses=(2,)))
    assert worker.run_once(worker.Site(site_server.url, TOKEN), make_model(model_server)) is True
    assert site_server.seen[-1][1] == "/api/ysound/worker/jobs/7/fail"


def test_an_invalid_job_is_reported_failed_and_never_reaches_the_model(serve):
    site_server = serve(site_routes(job=good_job(duration=99999)))
    model_server = serve(model_routes())
    assert worker.run_once(worker.Site(site_server.url, TOKEN), make_model(model_server)) is True
    assert model_server.seen == [] and site_server.seen[-1][1] == "/api/ysound/worker/jobs/7/fail"


def test_main_loop_once_surfaces_connection_problems(tmp_path):
    config = worker.load_config(write_config(tmp_path, site="http://127.0.0.1:9"))
    with pytest.raises(worker.WorkerError):
        worker.main_loop(config, once=True)


def test_check_reports_each_side(tmp_path, serve, capsys):
    site_server = serve(site_routes())
    model_server = serve(model_routes())
    config = worker.load_config(write_config(tmp_path, site=site_server.url, model_api=model_server.url))
    assert worker.check(config) is True
    assert "bereit" in capsys.readouterr().out
    broken = worker.load_config(write_config(tmp_path, site="http://127.0.0.1:9", model_api="http://127.0.0.1:9"))
    assert worker.check(broken) is False
    assert capsys.readouterr().out.count("PROBLEM") == 2


# ------------------------------------------------------------------ netguard

def test_netguard_knows_what_is_local():
    for host in ("127.0.0.1", "::1", "localhost", "127.5.5.5", b"127.0.0.1", "::1%lo"):
        assert netguard.is_local(host), host
    for host in ("example.com", "8.8.8.8", "192.168.1.5", "10.0.0.1", "0.0.0.0", "", "fe80::1"):
        assert not netguard.is_local(host), host


def test_netguard_blocks_the_internet_but_allows_this_computer():
    """Runs in a separate process: the guard patches the socket module for good."""
    code = (
        "import socket, threading, netguard\n"
        "assert netguard.install() is True and netguard.install() is False\n"
        "server = socket.socket(); server.bind(('127.0.0.1', 0)); server.listen(1); port = server.getsockname()[1]\n"
        "threading.Thread(target=lambda: server.accept(), daemon=True).start()\n"
        "socket.create_connection(('127.0.0.1', port), timeout=3).close()\n"
        "blocked = []\n"
        "for attempt in (lambda: socket.create_connection(('93.184.216.34', 80), timeout=3),\n"
        "                lambda: socket.getaddrinfo('example.com', 80),\n"
        "                lambda: socket.socket().connect(('93.184.216.34', 80)),\n"
        "                lambda: socket.socket().connect_ex(('93.184.216.34', 80)),\n"
        "                lambda: __import__('urllib.request').request.urlopen('http://example.com', timeout=3)):\n"
        "    try:\n        attempt()\n    except OSError as exc:\n        blocked.append('ysound netguard' in str(exc) or isinstance(exc.__cause__, netguard.BlockedNetworkError) or 'netguard' in repr(exc))\n"
        "print(blocked)\n"
    )
    result = subprocess.run([sys.executable, "-c", code], cwd=WORKER_DIR, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "[True, True, True, True, True]"


# ------------------------------------------------------------- source hygiene

@pytest.mark.parametrize("name", ["worker.py", "netguard.py", "serve_model.py", "run_all.py"])
def test_the_song_computer_code_has_no_dynamic_code_execution(name):
    source = open(os.path.join(WORKER_DIR, name), encoding="utf-8").read()
    for forbidden in ("eval(", "exec(", "os.system", "shell=True", "pickle", "marshal", "__import__", "importlib", "compile("):
        assert forbidden not in source, (name, forbidden)


def test_the_worker_uses_only_the_standard_library():
    source = open(os.path.join(WORKER_DIR, "worker.py"), encoding="utf-8").read()
    imports = {line.split()[1].split(".")[0] for line in source.splitlines() if line.startswith(("import ", "from "))}
    assert imports <= set(sys.stdlib_module_names), imports - set(sys.stdlib_module_names)


# ------------------------------------------------------------ model download

import download_model  # noqa: E402


def test_the_manifest_pins_one_revision_and_every_file_can_be_verified():
    manifest = json.loads(open(os.path.join(WORKER_DIR, "model_manifest.json"), encoding="utf-8").read())
    assert manifest["repo"] == "ACE-Step/Ace-Step1.5" and manifest["license"] == "MIT"
    assert len(manifest["revision"]) == 40 and set(manifest["revision"]) <= set("0123456789abcdef")
    names = set(manifest["files"])
    assert {"acestep-v15-turbo/model.safetensors", "vae/diffusion_pytorch_model.safetensors",
            "Qwen3-Embedding-0.6B/model.safetensors", "acestep-v15-turbo/silence_latent.pt"} <= names
    assert not any("5Hz-lm" in name for name in names)                   # the language model is deliberately left out
    for name, info in manifest["files"].items():
        assert info["size"] > 0 and (info["sha256"] or info["git_blob"]), name
        assert not name.startswith(("/", "..")) and ".." not in name, name
        if name.endswith(".safetensors") or name.endswith(".pt"):
            assert len(info["sha256"]) == 64, name


def test_downloaded_files_are_verified_by_sha256_or_git_blob_id(tmp_path):
    data = b"hello ace-step\n" * 100
    path = tmp_path / "f.bin"
    path.write_bytes(data)
    git = subprocess.run(["git", "hash-object", str(path)], capture_output=True, text=True).stdout.strip()
    assert download_model.git_blob_id(path) == git
    sha = hashlib.sha256(data).hexdigest()
    assert download_model.verify(path, {"size": len(data), "sha256": sha})
    assert download_model.verify(path, {"size": len(data), "sha256": None, "git_blob": git})
    assert not download_model.verify(path, {"size": len(data), "sha256": "0" * 64})
    assert not download_model.verify(path, {"size": len(data) + 1, "sha256": sha})
    assert not download_model.verify(path, {"size": len(data), "sha256": None, "git_blob": None})
    assert not download_model.verify(tmp_path / "missing", {"size": 1, "sha256": sha})


def test_the_download_resumes_a_part_file_and_refuses_plain_http_redirects(tmp_path, serve):
    data = bytes(range(256)) * 40

    def blob(handler, body):
        header = handler.headers.get("Range")
        if header:
            start = int(header.split("=")[1].split("-")[0])
            handler.extra_headers = {"Content-Range": f"bytes {start}-{len(data) - 1}/{len(data)}"}
            return 206, "application/octet-stream", data[start:]
        return 200, "application/octet-stream", data

    server = serve({("GET", "/f"): blob})
    part = tmp_path / "f.part"
    part.write_bytes(data[:1000])
    download_model.fetch(server.url + "/f", part, len(data))
    assert part.read_bytes() == data and server.seen[0][2].get("Range") == "bytes=1000-"
    fresh = tmp_path / "g.part"
    download_model.fetch(server.url + "/f", fresh, len(data))
    assert fresh.read_bytes() == data
    with pytest.raises(OSError):
        download_model.fetch(server.url + "/f", tmp_path / "h.part", len(data) - 5)      # more bytes than the manifest allows

    redirecting = serve({("GET", "/r"): lambda h, b: (h.__setattr__("extra_headers", {"Location": "http://evil.example/x"}) or 302, "text/plain", b"")})
    with pytest.raises(OSError):
        download_model.fetch(redirecting.url + "/r", tmp_path / "r.part", 10)


def test_the_firewall_script_is_reviewable_and_only_touches_its_own_rules():
    script = open(os.path.join(WORKER_DIR, "harden.ps1"), encoding="utf-8").read()
    assert "#Requires -RunAsAdministrator" in script and "ysound-model-no-network" in script
    assert "-Action Block" in script and "-Direction Outbound" in script and "127." not in script.split("$remote =")[1].split("\n")[0].replace("126.255.255.255", "")
    for forbidden in ("Set-NetFirewallProfile", "Disable-NetFirewall", "netsh advfirewall set", "Invoke-Expression", "iex ", "DownloadString", "Set-ExecutionPolicy", "reg add", "Add-MpPreference"):
        assert forbidden not in script, forbidden
