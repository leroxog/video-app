"""Nex games of the community (yipi_games.py): what a person builds in the camera tab ("Erstellen") and publishes. There are two kinds:

* "platformer": a level of a jump-and-run, made with the builder. It is only data (a grid of letters, a theme, a figure), checked here against what the game of the camera
  (static/js/pg-community.js) understands, so it can never be more than a level.
* "code": a game somebody wrote in JavaScript. It never runs on the page of Nex. The browser starts it in a Web Worker whose script comes from `worker_script()` below with a
  header that forbids every connection (Content-Security-Policy: default-src 'none'); the worker has no page, no cookies and no network, it only gets the input of the finger and
  gives back pictures (OffscreenCanvas), points and "game over" with postMessage. A game that hangs is stopped by the page (the worker is terminated).

The checks here are about the form and about words nobody may use; the safety of the code comes from the worker and its header."""
import json
import re

PLATFORMER_ROWS = 9
PLATFORMER_COLS = (30, 120)
TILES = ".#^oesF"
THEMES = ("day", "night", "sunset", "cave", "candy")
MAX_CODE = 20000
KINDS = ("platformer", "code")
HERO_DEFAULT = "🐱"

# the pieces of a level and what they are called in the builder
TILE_NAMES = {"#": "Block", "^": "Stacheln", "o": "Münze", "e": "Gegner", "s": "Sprungfeder", "F": "Ziel"}


def clean_platformer(raw):
    """The level as a JSON text in its one form, or None if it is not a level the game understands."""
    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    rows = data.get("map")
    if not isinstance(rows, list) or len(rows) != PLATFORMER_ROWS or not all(isinstance(row, str) for row in rows):
        return None
    cols = len(rows[0])
    if not PLATFORMER_COLS[0] <= cols <= PLATFORMER_COLS[1] or any(len(row) != cols for row in rows):
        return None
    if any(ch not in TILES for row in rows for ch in row):
        return None
    if sum(row.count("F") for row in rows) > 1 or sum(row.count("o") for row in rows) > 400 or sum(row.count("e") for row in rows) > 80:
        return None
    theme = data.get("theme") if data.get("theme") in THEMES else "day"
    hero = data.get("hero") if isinstance(data.get("hero"), str) and 0 < len(data["hero"].strip()) <= 8 and not re.search(r"[A-Za-z0-9<>&\"']", data["hero"]) else HERO_DEFAULT
    speed = data.get("speed") if data.get("speed") in (1, 2, 3) else 2
    return json.dumps({"v": 1, "map": rows, "theme": theme, "hero": hero.strip(), "speed": speed}, ensure_ascii=False, separators=(",", ":"))


# what code may not even mention (the worker could not do it anyway; this keeps the games honest and the page of the game free of surprises)
BLOCKED_CODE = re.compile(r"importScripts|postMessage|XMLHttpRequest|WebSocket|\bfetch\s*\(|EventSource|indexedDB|localStorage|sessionStorage|navigator|\bclose\s*\(|\beval\s*\(|new\s+Function|Function\s*\(|self\s*\.\s*on|"
                          r"\bimport\s*\(|\bimport\s+[\w{*]", re.I)


def clean_code(raw):
    """The code of a game as it is, or (None, the reason in German)."""
    if not isinstance(raw, str) or not raw.strip():
        return None, "Schreib erst deinen Code."
    code = raw.replace("\r\n", "\n").replace("\r", "\n")
    if len(code) > MAX_CODE:
        return None, f"Der Code ist zu lang (höchstens {MAX_CODE} Zeichen)."
    if "\x00" in code:
        return None, "Im Code steht ein ungültiges Zeichen."
    if not re.search(r"\bfunction\s+draw\s*\(|\bdraw\s*=\s*(function|\()|\bconst\s+draw\s*=|\blet\s+draw\s*=", code):
        return None, "Dein Spiel braucht eine Funktion draw(g), die das Bild malt."
    found = BLOCKED_CODE.search(code)
    if found:
        return None, f"„{found.group(0).strip()}“ darf im Code nicht vorkommen (das Spiel läuft abgeschottet und hat kein Netz)."
    return code, ""


HARNESS = r'''"use strict";
/* The harness of a game of the community (yipi_games.py): everything the game gets. The code of the person follows below the line. */
const WIDTH = 360, HEIGHT = 640;
const __canvas = new OffscreenCanvas(WIDTH, HEIGHT);
const g = __canvas.getContext("2d");
const __post = self.postMessage.bind(self);
const game = {
  width: WIDTH, height: HEIGHT,
  score(n) { __post({ t: "score", n: Math.max(0, Math.min(1e9, Math.floor(Number(n)) || 0)) }); },
  over() { __post({ t: "over" }); },
  random: Math.random,
};
const input = { x: WIDTH / 2, y: HEIGHT / 2, down: false, pressed: false, tap: false, released: false, swipe: null };
let __last = 0;
self.onmessage = (event) => {
  const m = event.data || {};
  if (m.t === "input") { Object.assign(input, m.input); return; }
  if (m.t !== "step") return;
  try {
    if (!__started) { __started = true; if (typeof start === "function") start(); }
    if (typeof update === "function") update(Math.min(0.05, Math.max(0, Number(m.dt) || 0.016)), input);
    g.save(); g.clearRect(0, 0, WIDTH, HEIGHT);
    draw(g);
    g.restore();
    const bitmap = __canvas.transferToImageBitmap();
    __post({ t: "frame", bitmap }, [bitmap]);
  } catch (error) {
    __post({ t: "error", message: String(error && error.message || error).slice(0, 200) });
  }
};
let __started = false;
__post({ t: "ready" });
/* ---- the game of the person starts here ---- */
'''


def worker_script(code):
    """The script of the worker: the harness and the code of the person."""
    return HARNESS + code + "\n"


WORKER_CSP = "default-src 'none'; frame-ancestors 'none'"
SAMPLE_CODE = '''// Dein Spiel: tippe, damit der Ball springt, und weiche den Balken aus.
let y = 400, vy = 0, t = 0, bars = [], points = 0, dead = false;

function start() { bars = [{ x: 420, gap: 260 }]; }

function update(dt, input) {
  t += dt;
  if (input.pressed && !dead) vy = -460;
  vy += 1400 * dt;
  y += vy * dt;
  for (const bar of bars) bar.x -= 170 * dt;
  if (bars[bars.length - 1].x < 200) bars.push({ x: 420, gap: 160 + game.random() * 300 });
  if (bars[0].x < -60) { bars.shift(); points += 1; game.score(points); }
  for (const bar of bars) if (bar.x < 200 && bar.x > 120 && (y < bar.gap - 80 || y > bar.gap + 80)) dead = true;
  if (y > 640 || y < 0) dead = true;
  if (dead) game.over();
}

function draw(g) {
  g.fillStyle = "rgba(20, 20, 60, 0.35)";
  g.fillRect(0, 0, 360, 640);
  g.fillStyle = "#7cf";
  for (const bar of bars) { g.fillRect(bar.x, 0, 56, bar.gap - 80); g.fillRect(bar.x, bar.gap + 80, 56, 640); }
  g.font = "44px sans-serif";
  g.fillText("🟡", 140, y);
}
'''
