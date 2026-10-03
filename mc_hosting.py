"""NRS Server: an Aternos-style panel for Minecraft (Java, vanilla) servers that run on
volunteers' computers instead of our own hardware.

A volunteer joins with a one-time invite from an admin and runs host_agent/nrs_host_agent.py.
The agent only ever talks to us (outbound polling, no open ports for us), and the only
things we can ask it to do are "start" / "stop" a server of an official release version.
It never receives commands, files or mods from us, and it checks the version against
Mojang's own manifest itself.
"""
import hashlib
import re
import secrets
import time
from datetime import datetime, timedelta, timezone

import requests
from flask import jsonify, request, send_file

from models import db, McHost, McHostInvite, McServer, User

HOST_ONLINE_SECONDS = 30
INVITE_VALID_DAYS = 7
MAX_SERVERS_PER_USER = 2
MAX_PLAYERS_CAP = 20
MAX_HOST_SERVERS = 4
CONSOLE_MAX_CHARS = 8000
MAX_LOG_LINES_PER_SYNC = 50
MAX_LOG_LINE_CHARS = 300
POLL_SECONDS = 3
ACTIVE_STATES = ("starting", "online", "stopping")
ADDRESS_RE = re.compile(r"^[A-Za-z0-9.\-:\[\]]{3,120}$")
MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
FALLBACK_VERSIONS = ["1.21.4", "1.21.1", "1.20.6", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5"]

_versions_cache = {"at": 0.0, "ids": None}


def _now():
    """Naive UTC, like the DateTime columns read back from the database."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def valid_versions():
    """Release versions Mojang currently lists (cached for an hour); a short fallback list
    if Mojang's manifest can't be reached."""
    if _versions_cache["ids"] and time.time() - _versions_cache["at"] < 3600:
        return _versions_cache["ids"]
    try:
        r = requests.get(MANIFEST_URL, timeout=8)
        ids = [v["id"] for v in r.json()["versions"] if v.get("type") == "release"][:15]
        if ids:
            _versions_cache.update(at=time.time(), ids=ids)
            return ids
    except (requests.RequestException, ValueError, KeyError, TypeError):
        pass
    return _versions_cache["ids"] or FALLBACK_VERSIONS


def host_is_online(host):
    return host.last_seen is not None and (_now() - host.last_seen).total_seconds() <= HOST_ONLINE_SECONDS


def _clamp(value, low, high):
    try:
        return max(low, min(high, int(value)))
    except (TypeError, ValueError):
        return low


def _clean_address(value):
    return value if isinstance(value, str) and ADDRESS_RE.fullmatch(value) else None


def _append_console(server, lines):
    clean = [str(line)[:MAX_LOG_LINE_CHARS] for line in lines[:MAX_LOG_LINES_PER_SYNC] if isinstance(line, str)]
    if clean:
        server.console = (server.console + "\n".join(clean) + "\n")[-CONSOLE_MAX_CHARS:]


def _release(server):
    """The server is no longer on any host."""
    server.status = "offline"
    server.host_id = None
    server.players = 0
    server.address = None
    server.desired = "stop"


def serialize_server(server):
    host = db.session.get(McHost, server.host_id) if server.host_id else None
    return {
        "id": server.id, "name": server.name, "version": server.version, "status": server.status,
        "desired": server.desired, "players": server.players, "max_players": server.max_players,
        "auto_start": server.auto_start, "address": server.address,
        "host": host.name if host else None, "console": server.console[-3000:],
    }


def serialize_host(host):
    running = McServer.query.filter(McServer.host_id == host.id, McServer.status.in_(ACTIVE_STATES)).count()
    owner = db.session.get(User, host.owner_id)
    return {
        "id": host.id, "name": host.name, "online": host_is_online(host), "address": host.address,
        "max_servers": host.max_servers, "running": running, "owner": owner.username if owner else None,
    }


def process_sync(host, payload):
    """Apply one agent report to the database and return the jobs it should do next.
    The agent reports every server it is running; anything it asks about that isn't
    legitimately assigned to this host is told to stop."""
    host.last_seen = _now()
    address = _clean_address(payload.get("address"))
    if address:
        host.address = address
    host.max_servers = _clamp(payload.get("max_servers", host.max_servers), 1, MAX_HOST_SERVERS)

    reported = {}
    for item in payload.get("servers") or []:
        if isinstance(item, dict) and isinstance(item.get("id"), int):
            reported[item["id"]] = item

    jobs = []
    for server_id, item in reported.items():
        server = db.session.get(McServer, server_id)
        if server is None or server.host_id != host.id:
            jobs.append({"action": "stop", "server_id": server_id})
            continue
        _append_console(server, item.get("log") if isinstance(item.get("log"), list) else [])
        state = item.get("status")
        if state in ("offline", "error"):
            _release(server)
        elif state in ("starting", "online"):
            server.players = _clamp(item.get("players"), 0, server.max_players)
            server.address = _clean_address(item.get("address")) or server.address
            if server.desired == "stop":
                server.status = "stopping"
                jobs.append({"action": "stop", "server_id": server.id})
            else:
                server.status = state

    mine = McServer.query.filter(McServer.host_id == host.id).all()
    for server in mine:
        if server.id in reported:
            continue
        if server.desired == "stop":
            _release(server)
        elif server.status in ("starting", "online"):
            server.status = "starting"
            jobs.append({"action": "start", "server_id": server.id, "version": server.version,
                         "max_players": server.max_players})

    active = McServer.query.filter(McServer.host_id == host.id, McServer.status.in_(ACTIVE_STATES)).count()
    queued = McServer.query.filter_by(status="queued", desired="start", host_id=None).order_by(McServer.id).all()
    for server in queued:
        if active >= host.max_servers:
            break
        server.host_id = host.id
        server.status = "starting"
        active += 1
        jobs.append({"action": "start", "server_id": server.id, "version": server.version,
                     "max_players": server.max_players})

    db.session.commit()
    return jobs


def register_routes(app, current_user, is_guest):
    def _fail(error, status=400):
        return jsonify({"ok": False, "error": error}), status

    def _own_server(me, server_id):
        return McServer.query.filter_by(id=server_id, owner_id=me.id).first()

    # ------------------------------------------------------------ servers

    @app.route("/api/mc/versions")
    def api_mc_versions():
        return jsonify({"ok": True, "versions": valid_versions()})

    @app.route("/api/mc/servers")
    def api_mc_servers_list():
        me = current_user()
        servers = McServer.query.filter_by(owner_id=me.id).order_by(McServer.id).all()
        online_hosts = sum(1 for h in McHost.query.all() if host_is_online(h))
        return jsonify({"ok": True, "servers": [serialize_server(s) for s in servers], "hosts_online": online_hosts})

    @app.route("/api/mc/servers", methods=["POST"])
    def api_mc_servers_create():
        me = current_user()
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()[:40]
        version = data.get("version")
        if not name:
            return _fail("empty_name")
        if version not in valid_versions():
            return _fail("bad_version")
        if McServer.query.filter_by(owner_id=me.id).count() >= MAX_SERVERS_PER_USER:
            return _fail("limit_reached")
        server = McServer(owner_id=me.id, name=name, version=version,
                          max_players=_clamp(data.get("max_players", 10), 1, MAX_PLAYERS_CAP))
        db.session.add(server)
        db.session.commit()
        return jsonify({"ok": True, "server": serialize_server(server)})

    @app.route("/api/mc/servers/<int:server_id>/start", methods=["POST"])
    def api_mc_server_start(server_id):
        server = _own_server(current_user(), server_id)
        if server is None:
            return _fail("not_found", 404)
        if server.status == "stopping":
            return _fail("stopping", 409)
        if server.status == "offline":
            server.desired = "start"
            server.status = "queued"
            server.console = ""
            db.session.commit()
        return jsonify({"ok": True, "server": serialize_server(server)})

    @app.route("/api/mc/servers/<int:server_id>/stop", methods=["POST"])
    def api_mc_server_stop(server_id):
        server = _own_server(current_user(), server_id)
        if server is None:
            return _fail("not_found", 404)
        if server.status == "queued":
            _release(server)
        elif server.status in ("starting", "online"):
            server.desired = "stop"
            server.status = "stopping"
        db.session.commit()
        return jsonify({"ok": True, "server": serialize_server(server)})

    @app.route("/api/mc/servers/<int:server_id>/auto-start", methods=["POST"])
    def api_mc_server_auto_start(server_id):
        server = _own_server(current_user(), server_id)
        if server is None:
            return _fail("not_found", 404)
        server.auto_start = bool((request.get_json(silent=True) or {}).get("enabled"))
        db.session.commit()
        return jsonify({"ok": True, "server": serialize_server(server)})

    @app.route("/api/mc/auto-start", methods=["POST"])
    def api_mc_auto_start():
        """Called when the owner opens the panel: servers marked "auto-start" that are offline get queued."""
        me = current_user()
        started = McServer.query.filter_by(owner_id=me.id, auto_start=True, status="offline").all()
        for server in started:
            server.desired = "start"
            server.status = "queued"
            server.console = ""
        db.session.commit()
        return jsonify({"ok": True, "queued": len(started)})

    @app.route("/api/mc/servers/<int:server_id>", methods=["DELETE"])
    def api_mc_server_delete(server_id):
        server = _own_server(current_user(), server_id)
        if server is None:
            return _fail("not_found", 404)
        if server.status != "offline":
            return _fail("running", 409)
        db.session.delete(server)
        db.session.commit()
        return jsonify({"ok": True})

    # ------------------------------------------------- hosts and invites

    @app.route("/api/mc/hosts")
    def api_mc_hosts_list():
        me = current_user()
        query = McHost.query if me.is_admin else McHost.query.filter_by(owner_id=me.id)
        return jsonify({"ok": True, "is_admin": bool(me.is_admin),
                        "hosts": [serialize_host(h) for h in query.order_by(McHost.id).all()]})

    @app.route("/api/mc/hosts", methods=["POST"])
    def api_mc_hosts_create():
        """Add a computer: redeem an invite, get the agent's secret token (shown once)."""
        me = current_user()
        data = request.get_json(silent=True) or {}
        code = re.sub(r"[\s-]", "", str(data.get("invite") or "")).upper()
        name = (data.get("name") or "").strip()[:60]
        if not name:
            return _fail("empty_name")
        invite = McHostInvite.query.filter_by(code=code).first() if code else None
        if invite is None or invite.used_at is not None or invite.expires_at < _now():
            return _fail("bad_invite", 403)
        token = secrets.token_urlsafe(32)
        host = McHost(owner_id=me.id, name=name, token_hash=hash_token(token))
        db.session.add(host)
        db.session.flush()
        invite.used_at = _now()
        invite.used_host_id = host.id
        db.session.commit()
        return jsonify({"ok": True, "token": token, "host": serialize_host(host)})

    @app.route("/api/mc/hosts/<int:host_id>", methods=["DELETE"])
    def api_mc_host_delete(host_id):
        me = current_user()
        host = db.session.get(McHost, host_id)
        if host is None or (host.owner_id != me.id and not me.is_admin):
            return _fail("not_found", 404)
        for server in McServer.query.filter_by(host_id=host.id).all():
            _release(server)
        McHostInvite.query.filter_by(used_host_id=host.id).update({"used_host_id": None})
        db.session.delete(host)
        db.session.commit()
        return jsonify({"ok": True})

    @app.route("/api/mc/invites", methods=["POST"])
    def api_mc_invites_create():
        me = current_user()
        if not me.is_admin:
            return _fail("forbidden", 403)
        code = secrets.token_hex(8).upper()
        expires = _now() + timedelta(days=INVITE_VALID_DAYS)
        db.session.add(McHostInvite(code=code, created_by=me.id, expires_at=expires))
        db.session.commit()
        return jsonify({"ok": True, "code": "-".join(code[i:i + 4] for i in range(0, 16, 4)),
                        "expires_at": expires.isoformat() + "Z"})

    # ------------------------------------------------------------- agent

    @app.route("/api/agent/sync", methods=["POST"])
    def api_agent_sync():
        auth = request.headers.get("Authorization", "")
        token = auth[7:].strip() if auth.startswith("Bearer ") else ""
        host = McHost.query.filter_by(token_hash=hash_token(token)).first() if token else None
        if host is None:
            return _fail("bad_token", 401)
        payload = request.get_json(silent=True)
        jobs = process_sync(host, payload if isinstance(payload, dict) else {})
        return jsonify({"ok": True, "jobs": jobs, "poll_seconds": POLL_SECONDS})

    @app.route("/host-agent.py")
    def download_host_agent():
        import os
        path = os.path.join(app.root_path, "host_agent", "nrs_host_agent.py")
        return send_file(path, mimetype="text/x-python", as_attachment=True, download_name="nrs_host_agent.py")
