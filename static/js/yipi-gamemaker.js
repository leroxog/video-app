/* Nex game maker (yipi-gamemaker.js): what the small "create" lens of the camera offers besides lenses -- build a jump-and-run level with a few taps and publish it, or upload a game
   written as code (it runs in a sealed Web Worker, see yipi_games.py). The games of other people come into the strip of the camera as "Community" games. The engine of the levels
   and the bridge to the worker are in pg-community.js (loaded with the games of the camera). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { fill, h, icon, toast, dialog } = Y;

  const ED = 30;                                          // pixels of a field of the builder
  const COLS = [["Kurz", 42], ["Mittel", 72], ["Lang", 104]];
  const HEROES = ["🐱", "🐶", "🦊", "🐸", "🐼", "🐵", "🦄", "🤖", "👻", "🐧", "🐯", "😎"];
  const TOOLS = [["move", "✋", "Bewegen"], ["#", "🟫", "Block"], ["^", "🔺", "Stacheln"], ["o", "🪙", "Münze"], ["e", "👾", "Gegner"], ["s", "⤴️", "Feder"], ["F", "🏁", "Ziel"], [".", "🧽", "Radierer"]];
  const SPEEDS = [[1, "Gemütlich"], [2, "Normal"], [3, "Schnell"]];
  const SAMPLE_CODE = `// Dein Spiel: tippe, damit der Ball springt, und weiche den Balken aus.
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
`;

  // ------------------------------------------------------------------------------------------------------------------ the games of the community in the strip of the camera
  const known = new Map();
  function toItem(row) {
    const who = row.user ? `@${row.user.handle}` : "";
    return { id: row.id, kind: "game", community: true, communityKind: row.kind, name: row.title, emoji: row.emoji, color: row.color, cat: "Community", mine: !!row.mine, by: row.user,
      hint: row.kind === "code" ? `Spiel von ${who}` : `Level von ${who} · Tippen zum Springen`, plays: row.plays, user: row.user };
  }
  async function list() {
    const reply = await Api.get("/community-games?sort=popular&limit=40");
    return reply.ok ? reply.data.items.map(toItem) : [];
  }
  async function fetchRow(id) {
    if (known.has(id)) return known.get(id);
    const reply = await Api.get(`/community-games/${id}`);
    if (!reply.ok) return null;
    known.set(id, reply.data.game);
    return reply.data.game;
  }
  async function find(id) {
    const row = await fetchRow(id);
    return row ? toItem(row) : null;
  }
  const played = (id) => { Api.post(`/community-games/${id}/play`).catch(() => {}); };

  // ------------------------------------------------------------------------------------------------------------------ the builder of a jump-and-run level
  function platformer(camera) {
    const PG = window.PulseGames;
    if (!PG || !PG.community) { toast("Die Spiele sind noch nicht geladen. Versuch es gleich noch einmal."); return; }
    const { THEMES, ROWS, generateLevel } = PG.community;
    let level = generateLevel({ seed: 1 + Math.floor(Math.random() * 100000), cols: 60, theme: "day", hero: "🐱", speed: 2, hard: 0.4 });
    let grid = level.map.map((row) => row.split(""));
    let theme = level.theme;
    let hero = level.hero;
    let speed = level.speed;
    let tool = "move";
    let entry = null;
    let busy = false;

    const name = h("input", { class: "field", type: "text", maxlength: 24, placeholder: "Wie heißt dein Level?", "aria-label": "Name des Levels" });
    const canvas = h("canvas", { class: "gm-canvas", "aria-label": "Dein Level: tippe auf ein Feld, um es zu setzen" });
    const board = h("div", { class: "gm-board" }, canvas);
    const toolbar = h("div", { class: "gm-tools", role: "toolbar", "aria-label": "Werkzeuge" });
    const themes = h("div", { class: "gm-chips", role: "group", "aria-label": "Thema" });
    const heroes = h("div", { class: "gm-chips", role: "group", "aria-label": "Figur" });
    const tempo = h("div", { class: "gm-chips", role: "group", "aria-label": "Tempo" });
    const length = h("div", { class: "gm-chips", role: "group", "aria-label": "Länge" });
    const status = h("p", { class: "muted small", role: "status" });

    const cols = () => grid[0].length;
    const chars = () => grid.map((row) => row.join(""));
    const levelData = () => ({ map: chars(), theme, hero, speed });
    function paint() {
      const n = cols();
      canvas.width = n * ED;
      canvas.height = ROWS * ED;
      const g = canvas.getContext("2d");
      const palette = THEMES[theme];
      const sky = g.createLinearGradient(0, 0, 0, canvas.height);
      sky.addColorStop(0, palette.top); sky.addColorStop(1, palette.bottom);
      g.fillStyle = sky; g.fillRect(0, 0, canvas.width, canvas.height);
      g.strokeStyle = "rgba(0,0,0,0.08)"; g.lineWidth = 1;
      for (let c = 0; c <= n; c += 1) { g.beginPath(); g.moveTo(c * ED + 0.5, 0); g.lineTo(c * ED + 0.5, canvas.height); g.stroke(); }
      for (let r = 0; r <= ROWS; r += 1) { g.beginPath(); g.moveTo(0, r * ED + 0.5); g.lineTo(canvas.width, r * ED + 0.5); g.stroke(); }
      g.textAlign = "center"; g.textBaseline = "middle";
      for (let r = 0; r < ROWS; r += 1) {
        for (let c = 0; c < n; c += 1) {
          const ch = grid[r][c];
          const x = c * ED, y = r * ED;
          if (ch === "#") {
            g.fillStyle = (c + r) % 2 ? palette.dirt : palette.dirt2; g.fillRect(x, y, ED, ED);
            if (r === 0 || grid[r - 1][c] !== "#") { g.fillStyle = palette.cap; g.fillRect(x, y, ED, 8); }
          } else if (ch === "^") {
            g.fillStyle = "#dfe6ee"; for (let k = 0; k < 3; k += 1) { g.beginPath(); g.moveTo(x + 1 + k * 9.5, y + ED); g.lineTo(x + 5.8 + k * 9.5, y + 10); g.lineTo(x + 10.5 + k * 9.5, y + ED); g.fill(); }
          } else if (ch === "o") { g.fillStyle = "#ffd23a"; g.beginPath(); g.arc(x + ED / 2, y + ED / 2, 8, 0, Math.PI * 2); g.fill(); g.strokeStyle = "#c98a00"; g.lineWidth = 2; g.stroke(); }
          else if (ch === "e") { g.fillStyle = "#ff5a5f"; g.beginPath(); g.ellipse(x + ED / 2, y + ED / 2 + 3, 11, 10, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "#fff"; g.beginPath(); g.arc(x + ED / 2 - 4, y + ED / 2, 3, 0, Math.PI * 2); g.arc(x + ED / 2 + 4, y + ED / 2, 3, 0, Math.PI * 2); g.fill(); }
          else if (ch === "s") { g.fillStyle = "#ff4d5e"; g.fillRect(x + 5, y + ED - 12, ED - 10, 7); g.strokeStyle = "#b9c2cc"; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 9, y + ED - 5); g.lineTo(x + ED - 9, y + ED - 5); g.stroke(); }
          else if (ch === "F") { g.fillStyle = "#e8e8ee"; g.fillRect(x + ED / 2 - 1.5, y, 3, ED); g.fillStyle = "#ff4d5e"; g.beginPath(); g.moveTo(x + ED / 2 + 1, y + 2); g.lineTo(x + ED - 3, y + 8); g.lineTo(x + ED / 2 + 1, y + 14); g.fill(); }
        }
      }
      g.font = `${ED - 4}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.fillText(hero, 2.5 * ED, 6.5 * ED);
      g.fillStyle = "rgba(255,255,255,0.55)"; g.font = "700 11px system-ui, sans-serif"; g.fillText("Start", 2.5 * ED, 5.4 * ED);
    }
    function put(col, row) {
      if (col < 0 || row < 0 || col >= cols() || row >= ROWS || tool === "move") return;
      if (col < 4 && tool !== "." && row < 7) return;                                     // the place where the figure starts stays free
      if (col < 4 && tool === "." && row >= 7) return;
      if (tool === "F") for (const line of grid) for (let c = 0; c < line.length; c += 1) if (line[c] === "F") line[c] = ".";
      grid[row][col] = tool;
    }
    function at(event) {
      const box = canvas.getBoundingClientRect();
      return [Math.floor(((event.clientX - box.left) / box.width) * cols()), Math.floor(((event.clientY - box.top) / box.height) * ROWS)];
    }
    let painting = false;
    canvas.addEventListener("pointerdown", (event) => {
      if (tool === "move") return;
      painting = true;
      try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* a mouse may not have one */ }
      const [c, r] = at(event);
      put(c, r); paint(); event.preventDefault();
    });
    canvas.addEventListener("pointermove", (event) => { if (!painting) return; const [c, r] = at(event); put(c, r); paint(); });
    const stop = () => { painting = false; };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);

    function drawTools() {
      fill(toolbar, ...TOOLS.map(([key, symbol, label]) => h("button", { class: `gm-tool${tool === key ? " on" : ""}`, type: "button", "aria-pressed": String(tool === key), "aria-label": label,
        onclick: () => { tool = key; canvas.classList.toggle("painting", key !== "move"); drawTools(); } }, h("span", {}, symbol), h("small", {}, label))));
    }
    function chips(box, items, current, set) {
      fill(box, ...items.map(([value, label]) => h("button", { class: `chip${current() === value ? " on" : ""}`, type: "button", onclick: () => { set(value); drawOptions(); paint(); } }, label)));
    }
    function resize(next) {
      const now = cols();
      if (next === now) return;
      grid = grid.map((row, r) => {
        if (next < now) return row.slice(0, next);
        return [...row, ...Array(next - now).fill(r >= 7 ? "#" : ".")];
      });
      if (!grid.some((row) => row.includes("F"))) grid[6][Math.max(8, next - 6)] = "F";
    }
    function drawOptions() {
      chips(themes, Object.entries(THEMES).map(([key, value]) => [key, value.name]), () => theme, (value) => { theme = value; });
      fill(heroes, ...HEROES.map((emoji) => h("button", { class: `chip emoji${hero === emoji ? " on" : ""}`, type: "button", "aria-label": `Figur ${emoji}`, onclick: () => { hero = emoji; drawOptions(); paint(); } }, emoji)));
      chips(tempo, SPEEDS, () => speed, (value) => { speed = value; });
      chips(length, COLS, () => Math.abs(cols() - 42) < 15 ? 42 : Math.abs(cols() - 72) < 15 ? 72 : 104, (value) => { resize(value); });
    }

    function test() {
      const title = name.value.trim() || "Mein Level";
      const def = PG.community.platformerDef({ id: "gm-test", title, emoji: hero, color: "#7a2cf0", user: Y.me }, levelData());
      const canvas2 = h("canvas", { class: "gm-test-canvas", "aria-label": "Dein Level zum Ausprobieren" });
      const result = h("div", { class: "gm-test-result", hidden: true });
      let runner = null;
      const close = () => { runner?.destroy(); overlay.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
      function run() {
        runner?.destroy();
        result.hidden = true;
        runner = PG.run(def, canvas2, { onScore() {}, onOver(points) {
          fill(result, h("b", {}, `${points} Punkte`), h("div", { class: "gm-test-buttons" }, h("button", { class: "btn primary", type: "button", onclick: run }, "Nochmal"), h("button", { class: "btn ghost", type: "button", onclick: close }, "Weiter bauen")));
          result.hidden = false;
        } }, { armed: false });
      }
      const overlay = h("div", { class: "gm-test", role: "dialog", "aria-modal": "true", "aria-label": "Level ausprobieren" }, h("div", { class: "gm-test-frame" }, canvas2, result),
        h("button", { class: "gm-test-close", type: "button", "aria-label": "Schließen", onclick: close }, icon("close")));
      document.body.append(overlay);
      document.addEventListener("keydown", onKey);
      run();
    }

    async function publish() {
      const title = name.value.trim();
      if (busy) return;
      if (title.length < 2) { status.textContent = "Gib deinem Level einen Namen."; name.focus(); return; }
      if (!grid.some((row) => row.includes("F"))) { status.textContent = "Setz noch ein Ziel (🏁) ans Ende."; return; }
      busy = true;
      status.textContent = "Dein Level wird veröffentlicht …";
      const reply = await Api.post("/community-games", { kind: "platformer", title, emoji: hero, color: THEMES[theme].cap, level: levelData() });
      busy = false;
      if (!reply.ok) { status.textContent = reply.data && reply.data.error === "not_allowed" ? "Dieser Name passt nicht." : Api.message(reply); return; }
      const item = toItem({ ...reply.data.game, user: Y.me });
      known.set(item.id, { ...reply.data.game, data: JSON.stringify(levelData()) });
      entry.close();
      camera.add(item);
      toast("Dein Level ist online. Alle können es spielen.");
    }

    drawTools();
    drawOptions();
    paint();
    const random = h("button", { class: "btn ghost small", type: "button", onclick: () => {
      level = generateLevel({ seed: 1 + Math.floor(Math.random() * 1e6), cols: cols(), theme, hero, speed, hard: 0.2 + Math.random() * 0.6 });
      grid = level.map.map((row) => row.split(""));
      paint();
    } }, "Zufälliges Level");
    entry = dialog({ title: "Jump & Run bauen", wide: true, body: h("div", { class: "game-maker" },
      h("p", { class: "muted" }, "Wähle ein Werkzeug und tippe oder male auf das Level. Mit ✋ kannst du es zur Seite schieben. Die Figur läuft von allein, ein Tippen lässt sie springen."),
      name, toolbar, board,
      h("div", { class: "gm-row" }, h("b", {}, "Thema"), themes), h("div", { class: "gm-row" }, h("b", {}, "Figur"), heroes), h("div", { class: "gm-row" }, h("b", {}, "Tempo"), tempo), h("div", { class: "gm-row" }, h("b", {}, "Länge"), length),
      status, h("div", { class: "gm-actions" }, random, h("button", { class: "btn ghost", type: "button", onclick: test }, "Testen"), h("button", { class: "btn primary", type: "button", onclick: publish }, "Veröffentlichen"))), initialFocus: name });
  }

  // ------------------------------------------------------------------------------------------------------------------ a game as code
  function code(camera) {
    const PG = window.PulseGames;
    if (!PG || !PG.community) { toast("Die Spiele sind noch nicht geladen. Versuch es gleich noch einmal."); return; }
    let entry = null;
    let draftId = "";
    let busy = false;
    const name = h("input", { class: "field", type: "text", maxlength: 24, placeholder: "Wie heißt dein Spiel?", "aria-label": "Name des Spiels" });
    const source = h("textarea", { class: "field gm-code", rows: 14, spellcheck: false, autocapitalize: "off", autocomplete: "off", "aria-label": "Code deines Spiels" });
    source.value = SAMPLE_CODE;
    const picker = h("input", { type: "file", accept: ".js,.txt,text/javascript,text/plain", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const status = h("p", { class: "muted small", role: "status" });
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      picker.value = "";
      if (!file) return;
      if (file.size > 40000) { status.textContent = "Die Datei ist zu groß (höchstens 20 000 Zeichen)."; return; }
      source.value = await file.text();
    });

    /* Saves the code as a draft (the sealed worker serves drafts to their author) and answers the row, or says what is wrong with the code. */
    async function save() {
      const title = name.value.trim() || "Mein Spiel";
      const body = { kind: "code", title, emoji: "🧩", color: "#7a2cf0", code: source.value, draft: true };
      const reply = draftId ? await Api.put(`/community-games/${draftId}`, body) : await Api.post("/community-games", body);
      if (!reply.ok) { status.textContent = (reply.data && reply.data.message) || (reply.data && reply.data.error === "not_allowed" ? "Dieser Name passt nicht." : Api.message(reply)); return null; }
      draftId = reply.data.game.id;
      return reply.data.game;
    }
    async function test() {
      if (busy) return;
      busy = true;
      status.textContent = "Dein Spiel wird gespeichert …";
      const row = await save();
      busy = false;
      if (!row) return;
      status.textContent = "";
      const def = PG.community.codeDef({ ...row, user: Y.me, hint: "Dein Spiel" });
      const canvas = h("canvas", { class: "gm-test-canvas", "aria-label": "Dein Spiel zum Ausprobieren" });
      const result = h("div", { class: "gm-test-result", hidden: true });
      let runner = null;
      const close = () => { runner?.destroy(); overlay.remove(); document.removeEventListener("keydown", onKey); };
      const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
      function run() {
        runner?.destroy();
        result.hidden = true;
        runner = PG.run(def, canvas, { onScore() {}, onOver(points) {
          fill(result, h("b", {}, `${points} Punkte`), h("div", { class: "gm-test-buttons" }, h("button", { class: "btn primary", type: "button", onclick: run }, "Nochmal"), h("button", { class: "btn ghost", type: "button", onclick: close }, "Zurück zum Code")));
          result.hidden = false;
        } }, { armed: false });
      }
      const overlay = h("div", { class: "gm-test", role: "dialog", "aria-modal": "true", "aria-label": "Spiel ausprobieren" }, h("div", { class: "gm-test-frame" }, canvas, result),
        h("button", { class: "gm-test-close", type: "button", "aria-label": "Schließen", onclick: close }, icon("close")));
      document.body.append(overlay);
      document.addEventListener("keydown", onKey);
      run();
    }
    async function publish() {
      if (busy) return;
      if (name.value.trim().length < 2) { status.textContent = "Gib deinem Spiel einen Namen."; name.focus(); return; }
      busy = true;
      status.textContent = "Dein Spiel wird veröffentlicht …";
      const row = await save();
      if (!row) { busy = false; return; }
      const done = await Api.post(`/community-games/${row.id}/publish`);
      busy = false;
      if (!done.ok) { status.textContent = Api.message(done); return; }
      const item = toItem({ ...done.data.game, user: Y.me });
      known.set(item.id, { ...done.data.game, data: source.value });
      entry.close();
      camera.add(item);
      toast("Dein Spiel ist online. Alle können es spielen.");
    }
    entry = dialog({ title: "Spiel-Code hochladen", wide: true, body: h("div", { class: "game-maker" },
      h("p", { class: "muted" }, "Schreib dein Spiel in JavaScript. Es läuft abgeschottet: ohne Internet, ohne Zugriff auf Nex, nur mit dem Finger als Eingabe und einer Fläche von 360 × 640."),
      h("ul", { class: "gm-api" },
        h("li", {}, h("code", {}, "function start()"), " läuft einmal am Anfang."),
        h("li", {}, h("code", {}, "function update(dt, input)"), ": ", h("code", {}, "dt"), " sind Sekunden, ", h("code", {}, "input"), " hat x, y, down, pressed, tap, released, swipe."),
        h("li", {}, h("code", {}, "function draw(g)"), " malt das Bild (", h("code", {}, "g"), " ist ein Canvas-2D-Kontext, durchsichtig: dahinter ist deine Kamera)."),
        h("li", {}, h("code", {}, "game.score(n)"), " setzt die Punkte, ", h("code", {}, "game.over()"), " beendet das Spiel, ", h("code", {}, "game.random()"), " gibt Zufall.")),
      name, source, picker, status,
      h("div", { class: "gm-actions" }, h("button", { class: "btn ghost small", type: "button", onclick: () => picker.click() }, "Datei laden"), h("button", { class: "btn ghost", type: "button", onclick: test }, "Testen"), h("button", { class: "btn primary", type: "button", onclick: publish }, "Veröffentlichen"))), initialFocus: name });
  }

  Y.communityGames = { list, find, fetch: fetchRow, toItem, played, known, SAMPLE_CODE };
  Y.gameMaker = { platformer, code };
})();
