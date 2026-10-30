"""Nex games of the community (yipi_games.py): what a person builds in the camera tab ("Erstellen") and publishes: a game written as code (a person, or the AI, wrote it).

A game never runs on the page of Nex. The browser starts it in a Web Worker whose script comes from `worker_script()` below with a header that forbids every connection
(Content-Security-Policy: default-src 'none'); the worker has no page, no cookies and no network, it only gets the input of the finger and gives back pictures
(OffscreenCanvas), points and "game over" with postMessage. A game that hangs is stopped by the page (the worker is terminated).

The checks here are about the form and about words nobody may use; the safety of the code comes from the worker and its header. (Earlier there were also levels of a
jump-and-run builder; they are gone, `purge_levels` removes the rows that are left.)"""
import re

MAX_CODE = 20000
KINDS = ("code", "ranking")                     # a game written as code, or a ranking that somebody made (yipi_ranking.py)


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


# ------------------------------------------------------------------------------------------------------------------ a game written by the AI
GAME_AI_SYSTEM = (
    "Du bist ein erfahrener Spiele-Entwickler und schreibst ein kleines, richtig gut aussehendes Handyspiel in JavaScript für das Spielformat von Nex.\n\n"
    "Das Format:\n"
    "- Das Spielfeld ist 360 mal 640 Pixel groß (hochkant). Es ist durchsichtig: dahinter sieht der Spieler seine Kamera mit seinem Gesicht. Male deshalb nur das Spiel selbst "
    "(Figuren, Hindernisse, Boden, Punkte), keinen vollflächigen Hintergrund, und lass in der Mitte oben Platz, damit das Gesicht zu sehen bleibt.\n"
    "- Du schreibst die Funktionen update(dt, input) und draw(g), und wenn nötig start() (läuft einmal am Anfang).\n"
    "- dt sind Sekunden seit dem letzten Bild (höchstens 0.05). input hat x und y (der Finger in Spielkoordinaten), down (der Finger liegt auf), pressed (gerade aufgesetzt), "
    "tap, released und swipe (\"left\", \"right\", \"up\", \"down\" oder null).\n"
    "- draw(g): g ist ein Canvas-2D-Kontext. Male in jedem Bild alles neu. Es soll professionell aussehen: kräftige Farben, Verläufe, runde Formen, weiche Schatten, kleine "
    "Animationen, große Emojis als Figuren (zum Beispiel g.font = \"48px sans-serif\"; g.fillText(\"🚗\", x, y)).\n"
    "- game.score(n) setzt die Punkte (eine ganze Zahl, die nur steigt), game.over() beendet die Runde, game.random() gibt eine Zufallszahl von 0 bis 1.\n"
    "- Verboten sind fetch, Netzwerk, import, eval, localStorage, navigator, setTimeout und alles, was nicht reines Rechnen und Malen ist.\n"
    "- Es soll mit einem Finger spielbar sein, langsam schwerer werden und enden (game.over()), wenn man verliert. Zeige die Punkte im Bild.\n\n"
    "Antworte genau so und sonst mit nichts:\n"
    "TITEL: <der Name des Spiels, höchstens 24 Zeichen>\n"
    "SYMBOL: <ein einzelnes Emoji, das zum Spiel passt>\n"
    "```javascript\n<der komplette Code>\n```"
)


def parse_ai_game(answer):
    """(title, emoji, code) out of the answer of the AI, or None when it does not have the form."""
    if not isinstance(answer, str):
        return None
    block = re.search(r"```(?:javascript|js)?\s*\n(.*?)```", answer, re.S) or re.search(r"```(?:javascript|js)?\s*\n(.*)\Z", answer, re.S)
    if block is None:
        return None
    title = re.search(r"^\s*TITEL:\s*(.+)$", answer, re.M)
    symbol = re.search(r"^\s*SYMBOL:\s*(.+)$", answer, re.M)
    title = (title.group(1).strip().strip("\"„“ ")[:24] if title else "") or "Mein Spiel"
    emoji = symbol.group(1).strip() if symbol else ""
    emoji = emoji if 0 < len(emoji) <= 8 and not re.search(r"[A-Za-z0-9<>&\"']", emoji) else "🎮"
    return title, emoji, block.group(1).strip("\n")


def ai_game(prompt, generate, model=None, tries=2):
    """A game for a description: asks `generate(system, message, ...)` (the AI service), checks the code like the code of a person, and asks once more with the complaint when it is
    not right. Returns {title, emoji, code}; raises ValueError when no good game came out."""
    message = f"Das Spiel, das ich mir wünsche: {prompt}"
    reason = "keine Antwort"
    for _ in range(max(1, tries)):
        answer = generate(GAME_AI_SYSTEM, message, max_tokens=7000, temperature=0.5, model=model)
        parsed = parse_ai_game(answer)
        if parsed is None:
            reason = "Der Code stand nicht in einem Block."
        else:
            title, emoji, code = parsed
            checked, reason = clean_code(code)
            if checked is not None:
                return {"title": title, "emoji": emoji, "code": checked}
        message = f"Das Spiel, das ich mir wünsche: {prompt}\n\nDeine letzte Antwort ging nicht: {reason} Schreib das ganze Spiel noch einmal im richtigen Format."
    raise ValueError(reason)


NEX_GAME_FORMAT = (
    "Wenn der Nutzer ein Spiel für Nex bauen will, schreib es im Spielformat von Nex in genau einem Codeblock (```javascript): Das Spielfeld ist 360 mal 640 Pixel, durchsichtig (dahinter ist "
    "die Kamera des Spielers). Du schreibst update(dt, input) und draw(g) und, wenn nötig, start(). dt sind Sekunden, input hat x, y, down, pressed, tap, released und swipe. g ist ein "
    "Canvas-2D-Kontext und malt jedes Bild neu, mit kräftigen Farben und Emojis. game.score(n) setzt die Punkte, game.over() beendet die Runde, game.random() gibt Zufall. Kein fetch, "
    "import, eval, localStorage, navigator oder setTimeout. Unter dem Code steht ein Satz, dass man das Spiel unter dem Code mit dem Knopf „Als Spiel hochladen“ auf Nex stellen kann."
)
