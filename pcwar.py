"""Pure game logic for PCwar (see LEROX Games / /games/pcwar) -- a fully
fake hacking simulation. Every "target" is a fictional codename, every IP
address/open port/password/personal profile is randomly invented per
attempt and never touches a real network in any way; this module exists
purely to generate that fake data and never makes an HTTP/socket
connection anywhere. See app.py's /games/pcwar routes for how an attempt
is stepped through (scan IP -> scan ports -> crack password -> log in).
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

COMMON_PORTS = [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 3306, 3389, 8080]
PORT_SERVICES = {
    21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS", 80: "HTTP",
    110: "POP3", 143: "IMAP", 443: "HTTPS", 445: "SMB", 3306: "MySQL",
    3389: "RDP", 8080: "HTTP-Proxy",
}
LOGIN_SERVICE_PORTS = (22, 3389, 21, 23)  # ports that plausibly need a password

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
    password and victim profile every time, so replaying a target doesn't
    just mean re-typing the same memorized answer."""
    target = TARGETS_BY_KEY[target_key]
    difficulty = target["difficulty"]

    ip = ".".join(str(random.randint(1, 254)) for _ in range(4))

    port_count = DIFFICULTY_PORT_COUNT[difficulty]
    login_port = random.choice(LOGIN_SERVICE_PORTS)
    other_ports = random.sample([p for p in COMMON_PORTS if p != login_port], port_count - 1)
    ports = sorted([login_port] + other_ports)

    password = "".join(random.choices(PASSWORD_ALPHABET, k=DIFFICULTY_PASSWORD_LENGTH[difficulty]))

    profile = {
        "name": f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
        "age": random.randint(19, 67),
        "email": f"user{random.randint(100, 999)}@{target_key}.fake",
        "note": random.choice(NOTES),
    }

    return {
        "target": target,
        "ip": ip,
        "ports": [{"port": p, "service": PORT_SERVICES.get(p, "unbekannt")} for p in ports],
        "login_port": login_port,
        "password": password,
        "profile": profile,
        "revealed": {"ip": False, "ports": False, "password": False},
    }
