#!/usr/bin/env python3
"""NRS Server host agent -- lets your computer run Minecraft servers for NRS Server.

What this program does, and nothing else:
  * every few seconds it asks the NRS website whether a server should start or stop
    (outbound only -- the website never connects to you);
  * it starts / stops OFFICIAL vanilla Minecraft server jars, downloaded from Mojang and
    checked against Mojang's own checksum, in its own folder (--dir).
It never runs commands, mods, plugins or files sent by the website. Stop it any time with
Ctrl+C: running servers are shut down cleanly. This file is short, plain Python -- read it.

You need: Python 3.8+, and Java 17 or newer for real servers (not for --simulate).
Players reach your server directly at your address and port, so your router must forward the
port (default 25565) to this computer. That shares your IP address with the players.

Minecraft's EULA (https://aka.ms/MinecraftEULA) must be accepted by YOU, the person running the
server: start with --accept-eula only after reading it.

Example:
  python nrs_host_agent.py --site https://nexai.up.railway.app --token YOUR_TOKEN --accept-eula
"""
import argparse
import collections
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request

MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
ALLOWED_DOWNLOAD_HOSTS = {"piston-meta.mojang.com", "piston-data.mojang.com", "launcher.mojang.com"}
VERSION_RE = re.compile(r"^[0-9]+(\.[0-9]+){1,2}$")
MAX_PLAYERS_CAP = 20
LOG_LINES_PER_SYNC = 50
STOP_GRACE_SECONDS = 45


def clean_version(value):
    return value if isinstance(value, str) and VERSION_RE.fullmatch(value) else None


def check_download_url(url):
    parts = urllib.parse.urlparse(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_DOWNLOAD_HOSTS:
        raise ValueError("Download-Adresse nicht erlaubt: " + url)
    return url


def build_properties(port, max_players):
    """The few settings this agent sets; everything else keeps Minecraft's own defaults."""
    return {
        "server-port": str(port), "max-players": str(max(1, min(MAX_PLAYERS_CAP, int(max_players)))),
        "online-mode": "true", "motd": "NRS Server", "view-distance": "8", "simulation-distance": "6",
        "enable-command-block": "false", "enable-rcon": "false", "enable-query": "false",
    }


def write_properties(path, props):
    existing = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if "=" in line and not line.startswith("#"):
                    key, _, value = line.rstrip("\n").partition("=")
                    existing[key] = value
    existing.update(props)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("".join(f"{k}={v}\n" for k, v in existing.items()))


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))  # no packet is sent; just picks the outgoing interface
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def public_ip():
    with urllib.request.urlopen("https://api.ipify.org", timeout=6) as resp:
        return resp.read().decode().strip()


def http_json(url, data=None, headers=None, timeout=20):
    body = json.dumps(data).encode() if data is not None else None
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(request, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# --------------------------------------------------------------- instances

class SimulatedInstance:
    """Pretends to run a server (no Java, no download) -- for trying the whole flow out."""

    def __init__(self, server_id, address):
        self.server_id, self.address = server_id, address
        self.status, self.players, self.steps = "starting", 0, 0
        self.log = collections.deque(["[Simulation] Server wird gestartet ..."], maxlen=500)

    def tick(self):
        self.steps += 1
        if self.status == "starting" and self.steps >= 2:
            self.status = "online"
            self.log.append("[Simulation] Fertig! Der Server ist bereit.")
        elif self.status == "online" and self.steps == 5:
            self.players = 1
            self.log.append("[Simulation] Testspieler ist beigetreten.")
        elif self.status == "stopping":
            self.status, self.players = "offline", 0
            self.log.append("[Simulation] Server gestoppt.")

    def stop(self):
        if self.status in ("starting", "online"):
            self.status = "stopping"
            self.log.append("[Simulation] Stoppe ...")


class JavaInstance:
    """One real Minecraft server process."""

    def __init__(self, server_id, proc, address):
        self.server_id, self.proc, self.address = server_id, proc, address
        self.status, self.players, self.stop_at = "starting", 0, None
        self.log = collections.deque(maxlen=500)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            line = line.rstrip()
            self.log.append(line)
            if "Done (" in line and self.status == "starting":
                self.status = "online"
            elif "joined the game" in line:
                self.players += 1
            elif "left the game" in line:
                self.players = max(0, self.players - 1)

    def tick(self):
        if self.proc.poll() is not None:
            self.status, self.players = "offline", 0
        elif self.stop_at and time.time() > self.stop_at:
            self.proc.terminate()

    def stop(self):
        if self.status in ("starting", "online") and self.proc.poll() is None:
            self.status = "stopping"
            self.stop_at = time.time() + STOP_GRACE_SECONDS
            try:
                self.proc.stdin.write("stop\n")
                self.proc.stdin.flush()
            except OSError:
                self.proc.terminate()


class FailedInstance:
    """A start that couldn't happen (no Java, EULA not accepted, ...): reports the reason once."""

    def __init__(self, server_id, reason):
        self.server_id, self.status, self.players, self.address = server_id, "error", 0, None
        self.log = collections.deque(["Fehler: " + reason], maxlen=5)

    def tick(self):
        pass

    def stop(self):
        pass


def report_of(instance):
    lines = [instance.log.popleft() for _ in range(min(LOG_LINES_PER_SYNC, len(instance.log)))]
    return {"id": instance.server_id, "status": instance.status, "players": instance.players,
            "address": instance.address, "log": lines}


# ------------------------------------------------------------------ agent

class Agent:
    def __init__(self, config, transport):
        self.config, self.transport = config, transport
        self.instances = {}

    def address_for(self, port):
        return f"{self.config.advertise_host}:{port}"

    def free_port(self):
        used = {int(i.address.rsplit(":", 1)[1]) for i in self.instances.values() if i.address}
        port = self.config.port
        while port in used:
            port += 1
        return port

    def start_server(self, job):
        server_id = job.get("server_id")
        if not isinstance(server_id, int) or server_id in self.instances:
            return
        if len(self.instances) >= self.config.max_servers:
            return
        version = clean_version(job.get("version"))
        max_players = job.get("max_players") if isinstance(job.get("max_players"), int) else 10
        port = self.free_port()
        address = self.address_for(port)
        try:
            if version is None:
                raise ValueError("Ungültige Version.")
            if self.config.simulate:
                self.instances[server_id] = SimulatedInstance(server_id, address)
            else:
                self.instances[server_id] = self.launch_java(server_id, version, max_players, port, address)
        except Exception as exc:  # reported to the panel, never crashes the agent
            self.instances[server_id] = FailedInstance(server_id, str(exc))

    def launch_java(self, server_id, version, max_players, port, address):
        if not self.config.accept_eula:
            raise RuntimeError("Die Minecraft-EULA wurde nicht akzeptiert (Agent mit --accept-eula starten).")
        java = shutil.which("java")
        if java is None:
            raise RuntimeError("Java wurde nicht gefunden. Installiere Java 17 oder neuer.")
        jar = self.ensure_jar(version)
        folder = os.path.join(self.config.dir, "servers", str(server_id))
        os.makedirs(folder, exist_ok=True)
        shutil.copyfile(jar, os.path.join(folder, "server.jar"))
        with open(os.path.join(folder, "eula.txt"), "w", encoding="utf-8") as fh:
            fh.write("eula=true\n")
        write_properties(os.path.join(folder, "server.properties"), build_properties(port, max_players))
        ram = self.config.ram
        proc = subprocess.Popen(
            [java, f"-Xms{max(256, ram // 2)}M", f"-Xmx{ram}M", "-jar", "server.jar", "nogui"],
            cwd=folder, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace", bufsize=1,
        )
        return JavaInstance(server_id, proc, address)

    def ensure_jar(self, version):
        """The official server jar for a release version, taken from Mojang and checked against their SHA-1."""
        target = os.path.join(self.config.dir, "jars", version, "server.jar")
        if os.path.exists(target):
            return target
        manifest = http_json(check_download_url(MANIFEST_URL))
        entry = next((v for v in manifest["versions"] if v["id"] == version and v.get("type") == "release"), None)
        if entry is None:
            raise ValueError(f"Version {version} ist keine offizielle Minecraft-Version.")
        info = http_json(check_download_url(entry["url"]))["downloads"]["server"]
        url, sha1 = check_download_url(info["url"]), info["sha1"]
        os.makedirs(os.path.dirname(target), exist_ok=True)
        temp = target + ".part"
        digest = hashlib.sha1()
        with urllib.request.urlopen(url, timeout=60) as resp, open(temp, "wb") as out:
            for chunk in iter(lambda: resp.read(1 << 16), b""):
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != sha1:
            os.remove(temp)
            raise ValueError("Die Prüfsumme der heruntergeladenen Server-Datei stimmt nicht.")
        os.replace(temp, target)
        return target

    def handle(self, job):
        if not isinstance(job, dict):
            return
        if job.get("action") == "start":
            self.start_server(job)
        elif job.get("action") == "stop":
            instance = self.instances.get(job.get("server_id"))
            if instance is not None:
                instance.stop()

    def step(self):
        """One round: advance servers, report them, do what the site asks. Returns False if the site was unreachable."""
        for instance in self.instances.values():
            instance.tick()
        payload = {"address": self.config.advertise_host, "max_servers": self.config.max_servers,
                   "servers": [report_of(i) for i in self.instances.values()]}
        try:
            response = self.transport(payload)
        except Exception as exc:
            print("Keine Verbindung zu NRS:", exc)
            return False
        self.instances = {k: v for k, v in self.instances.items() if v.status not in ("offline", "error")}
        for job in response.get("jobs") or []:
            self.handle(job)
        return True

    def shutdown(self):
        for instance in self.instances.values():
            instance.stop()
        deadline = time.time() + STOP_GRACE_SECONDS
        while self.instances and time.time() < deadline:
            self.step()
            time.sleep(1)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="NRS Server host agent")
    parser.add_argument("--site", required=True, help="Adresse der NRS-Seite, z.B. https://nexai.up.railway.app")
    parser.add_argument("--token", default=os.environ.get("NRS_TOKEN"), help="Dein geheimer Computer-Token (oder Umgebungsvariable NRS_TOKEN)")
    parser.add_argument("--dir", default=os.path.join(os.path.expanduser("~"), "nrs-host"), help="Ordner für Server-Dateien")
    parser.add_argument("--ram", type=int, default=2048, help="Maximaler Arbeitsspeicher pro Server in MB")
    parser.add_argument("--port", type=int, default=25565, help="Erster Server-Port")
    parser.add_argument("--max-servers", type=int, default=1, help="Wie viele Server gleichzeitig laufen dürfen")
    parser.add_argument("--public-address", help="Adresse, unter der Spieler dich erreichen (Domain oder IP)")
    parser.add_argument("--share-public-ip", action="store_true", help="Öffentliche IP automatisch ermitteln und teilen")
    parser.add_argument("--accept-eula", action="store_true", help="Ich habe die Minecraft-EULA gelesen und akzeptiere sie")
    parser.add_argument("--simulate", action="store_true", help="Nur ausprobieren: keine echten Server, kein Java")
    args = parser.parse_args(argv)
    if not args.token:
        parser.error("--token fehlt")
    args.max_servers = max(1, min(4, args.max_servers))
    if args.public_address:
        args.advertise_host = args.public_address
    elif args.share_public_ip:
        args.advertise_host = public_ip()
    else:
        args.advertise_host = local_ip()
    return args


def main(argv=None):
    config = parse_args(argv)
    site = config.site.rstrip("/")

    def transport(payload):
        return http_json(site + "/api/agent/sync", payload, {"Authorization": "Bearer " + config.token})

    agent = Agent(config, transport)
    mode = "SIMULATION (keine echten Server)" if config.simulate else "echte Minecraft-Server"
    print(f"NRS Host-Agent gestartet -- {mode}")
    print(f"  Seite: {site}  Adresse für Spieler: {config.advertise_host}:{config.port}  RAM: {config.ram} MB  Server gleichzeitig: {config.max_servers}")
    print("  Beenden mit Strg+C.")
    try:
        while True:
            agent.step()
            time.sleep(3)
    except KeyboardInterrupt:
        print("Beende ... laufende Server werden gestoppt.")
        agent.shutdown()


if __name__ == "__main__":
    sys.exit(main())
