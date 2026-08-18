"""Pure game logic for PCwar (see LEROX Games / /games/pcwar) -- a fully
fake hacking simulation styled after real pentesting-training sites like
TryHackMe: the player types actual-looking recon/exploit commands
(nmap/hydra/ssh) into a terminal, not clicking icons. Every "target" is a
fictional codename, and every IP address/open port/username/password/
victim profile is randomly invented per attempt -- this module never
makes a real network connection to anything, it only generates the fake
data a fake terminal (see app.py's /games/pcwar routes and
static/js/pcwar.js) displays as if a real scan/crack/login had happened.
"""
import random

TARGETS = [
    {"key": "shadowcore", "name": "SHADOWCORE", "difficulty": "leicht"},
    {"key": "ghostx", "name": "GHOST_SERVER_X", "difficulty": "leicht"},
    {"key": "rednode", "name": "RED_NODE_17", "difficulty": "leicht"},
    {"key": "blackice", "name": "BLACK_ICE", "difficulty": "mittel"},
    {"key": "nightfall9", "name": "NIGHTFALL-9", "difficulty": "mittel"},
    {"key": "voidgate", "name": "VOIDGATE_RELAY", "difficulty": "mittel"},
    {"key": "obsidian", "name": "OBSIDIAN_VAULT", "difficulty": "schwer"},
    {"key": "cerberus", "name": "CERBERUS_MAINFRAME", "difficulty": "schwer"},
    {"key": "wraith", "name": "WRAITH_CLUSTER_0", "difficulty": "schwer"},
]
TARGETS_BY_KEY = {t["key"]: t for t in TARGETS}

DIFFICULTY_LABELS = {"leicht": "Leicht", "mittel": "Mittel", "schwer": "Schwer"}
DIFFICULTY_PORT_COUNT = {"leicht": 2, "mittel": 3, "schwer": 4}
DIFFICULTY_PASSWORD_LENGTH = {"leicht": 6, "mittel": 9, "schwer": 13}

SSH_PORT = 22
DECOY_PORTS = [21, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 8080]
PORT_SERVICES = {
    21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "domain", 80: "http",
    110: "pop3", 143: "imap", 443: "https", 445: "microsoft-ds", 3306: "mysql",
    3389: "ms-wbt-server", 8080: "http-proxy",
}

USERNAMES = ["admin", "root", "backup", "operator", "sysadmin", "service"]
FIRST_NAMES = ["Max", "Lena", "Jonas", "Mia", "Finn", "Emma", "Leon", "Hannah", "Paul", "Sophie"]
LAST_NAMES = ["Mustermann", "Schmidt", "Weber", "Fischer", "Wagner", "Becker", "Hoffmann", "Klein"]
NOTES = [
    "Letzter Login vor 3 Tagen.",
    "Zwei-Faktor-Authentifizierung war deaktiviert.",
    "Passwort seit über einem Jahr nicht geändert.",
    "Mehrere fehlgeschlagene Login-Versuche in den Logs.",
    "Backup-Server unter der gleichen Adresse erreichbar.",
]
PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$"


def generate_attempt(target_key):
    """A fresh, fully-invented attempt for one target -- new IP, ports,
    username, password and victim profile every time, so replaying a
    target doesn't just mean re-typing the same memorized answer. The IP
    is handed back immediately by /start (real engagements start from a
    known target IP, that's not itself something to "hack") -- ports,
    username+password, and the final file contents are what the player
    actually has to work for, via nmap/hydra/ssh/cat."""
    target = TARGETS_BY_KEY[target_key]
    difficulty = target["difficulty"]

    ip = ".".join(str(random.randint(1, 254)) for _ in range(4))

    decoy_count = DIFFICULTY_PORT_COUNT[difficulty] - 1
    decoys = random.sample(DECOY_PORTS, decoy_count)
    ports = sorted([SSH_PORT] + decoys)

    username = random.choice(USERNAMES)
    password = "".join(random.choices(PASSWORD_ALPHABET, k=DIFFICULTY_PASSWORD_LENGTH[difficulty]))

    profile = {
        "name": f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
        "age": random.randint(19, 67),
        "email": f"{username}@{target_key}.fake",
        "note": random.choice(NOTES),
    }

    return {
        "target": target,
        "ip": ip,
        "ports": [{"port": p, "service": PORT_SERVICES.get(p, "unknown")} for p in ports],
        "username": username,
        "password": password,
        "profile": profile,
        "revealed": {"ports": False, "password": False},
        "logged_in": False,
    }
