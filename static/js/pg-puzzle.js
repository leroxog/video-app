/* Pulse games: puzzles and brain teasers (pg-puzzle.js): Memory, Slide Puzzle, Lights Out, Flood It, Minesweeper, Tower of Hanoi, Number Memory, Pattern Grid,
   Colour Sort, Maze, Word Scramble, Hangman, Mini Sudoku and 2048. Every game is registered in the kit (pg-kit.js); the field is 360 x 640. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const WORDS = ["BANANE", "SCHULE", "FREUND", "WOLKE", "GITARRE", "KATZE", "SOMMER", "FENSTER", "COMPUTER", "SCHOKOLADE", "FUSSBALL", "ABENTEUER", "REGENBOGEN", "TELEFON", "FAMILIE",
    "STRASSE", "BLUME", "WASSER", "MUSIK", "PIZZA", "TORTE", "INSEL", "DRACHE", "LAMPE", "STERN", "RAKETE", "BIBLIOTHEK", "FLUGZEUG", "SCHMETTERLING", "ELEFANT", "PINGUIN", "ZITRONE",
    "KARTOFFEL", "GEBURTSTAG", "WINTER", "KAFFEE", "BRILLE", "SPIEGEL", "TASCHE", "KUCHEN", "LEUCHTTURM", "SONNE", "MONDLICHT", "FAHRRAD", "GARTEN", "KISSEN", "HANDY", "KLAVIER", "ZIRKUS", "PIRAT"];

  /* ------------------------------------------------------------------------------------------------ Memory */
  R({ id: "memory-match", name: "Memory", emoji: "🃏", cat: "Denken", color: "#ff9f43", hint: "Finde alle Paare, bevor die 45 Sekunden um sind", create(e) {
    const EMOJI = ["🍎", "🐶", "🚗", "⭐", "🎈", "🐱", "🍕", "⚽", "🌵", "🦊", "🎸", "🍩"];
    const COLS = 4, CW = 76, CH = 92, GAP = 10, OX = (W - COLS * CW - (COLS - 1) * GAP) / 2, OY = 140;
    let cards, open = [], wait = 0, time = 45, pairs = 0, round = 0;
    function deal() { const faces = e.shuffle(EMOJI).slice(0, 8); cards = e.shuffle([...faces, ...faces]).map((f) => ({ f, up: false, done: false })); open = []; }
    deal();
    return {
      update(dt) {
        const i = e.input; time -= dt;
        if (time <= 0) { e.over(); return; }
        if (wait > 0) { wait -= dt; if (wait <= 0) { for (const k of open) cards[k].up = false; open = []; } return; }
        if (i.pressed) {
          const cx = Math.floor((i.x - OX) / (CW + GAP)), cy = Math.floor((i.y - OY) / (CH + GAP));
          const k = cy * COLS + cx;
          if (cx >= 0 && cx < COLS && cy >= 0 && cy * COLS + cx < cards.length && !cards[k].up && !cards[k].done && e.inside(i.x, i.y, OX + cx * (CW + GAP), OY + cy * (CH + GAP), CW, CH)) {
            cards[k].up = true; open.push(k);
            if (open.length === 2) {
              if (cards[open[0]].f === cards[open[1]].f) { cards[open[0]].done = cards[open[1]].done = true; open = []; pairs += 1; e.score(pairs * 10); if (cards.every((c) => c.done)) { round += 1; e.addScore(Math.round(time)); time = Math.min(45, time + 10); deal(); } }
              else wait = 0.7;
            }
          }
        }
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(0)} s`, W / 2, 100, { size: 30 });
        cards.forEach((c, k) => {
          const x = OX + (k % COLS) * (CW + GAP), y = OY + Math.floor(k / COLS) * (CH + GAP);
          if (c.up || c.done) { e.rect(x, y, CW, CH, c.done ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.92)", 14); e.emoji(c.f, x + CW / 2, y + CH / 2, 42); }
          else { e.rect(x, y, CW, CH, "#ff9f43", 14); e.text("?", x + CW / 2, y + CH / 2, { size: 36 }); }
        });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Slide Puzzle */
  R({ id: "slide-puzzle", name: "Schiebepuzzle", emoji: "🔢", cat: "Denken", color: "#4cc9ff", hint: "Tippe eine Kachel neben der Lücke, um sie zu verschieben", create(e) {
    let n = 3, tiles, moves = 0, level = 0, won = 0;
    function shuffle() {
      tiles = Array.from({ length: n * n }, (_, k) => (k + 1) % (n * n));
      let hole = n * n - 1, last = -1;
      for (let k = 0; k < 40 * n; k++) { const options = []; const x = hole % n, y = Math.floor(hole / n); if (x > 0) options.push(hole - 1); if (x < n - 1) options.push(hole + 1); if (y > 0) options.push(hole - n); if (y < n - 1) options.push(hole + n); const pick = e.pick(options.filter((o) => o !== last).length ? options.filter((o) => o !== last) : options); tiles[hole] = tiles[pick]; tiles[pick] = 0; last = hole; hole = pick; }
      moves = 0;
    }
    shuffle();
    const size = () => 320 / n;
    const solved = () => tiles.every((t, k) => (k === n * n - 1 ? t === 0 : t === k + 1));
    function press(k) {
      const hole = tiles.indexOf(0), hx = hole % n, hy = Math.floor(hole / n), x = k % n, y = Math.floor(k / n);
      if (Math.abs(hx - x) + Math.abs(hy - y) !== 1) return;
      tiles[hole] = tiles[k]; tiles[k] = 0; moves += 1;
      if (solved()) { won += 1; e.addScore(Math.max(10, 150 - moves * 2)); level += 1; n = level % 2 ? 4 : 3; shuffle(); }
    }
    return {
      update() {
        const i = e.input;
        if (i.pressed) { const cx = Math.floor((i.x - 20) / size()), cy = Math.floor((i.y - 170) / size()); if (cx >= 0 && cy >= 0 && cx < n && cy < n) press(cy * n + cx); }
        const hole = tiles.indexOf(0), hx = hole % n, hy = Math.floor(hole / n);
        if (i.keyPressed("ArrowLeft") && hx < n - 1) press(hole + 1); if (i.keyPressed("ArrowRight") && hx > 0) press(hole - 1); if (i.keyPressed("ArrowUp") && hy < n - 1) press(hole + n); if (i.keyPressed("ArrowDown") && hy > 0) press(hole - n);
        if (i.swipe) { const map = { left: [1, 0], right: [-1, 0], up: [0, 1], down: [0, -1] }[i.swipe]; const tx = hx + map[0], ty = hy + map[1]; if (tx >= 0 && ty >= 0 && tx < n && ty < n) press(ty * n + tx); }
      },
      draw() {
        e.text(`Züge: ${moves}`, W / 2, 120, { size: 26 });
        const s = size();
        tiles.forEach((t, k) => { if (!t) return; const x = 20 + (k % n) * s, y = 170 + Math.floor(k / n) * s; e.rect(x + 3, y + 3, s - 6, s - 6, `hsl(${(t * 360) / (n * n)},65%,52%)`, 14); e.text(t, x + s / 2, y + s / 2, { size: n === 3 ? 48 : 38 }); });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Lights Out */
  R({ id: "lights-out", name: "Lights Out", emoji: "💡", cat: "Denken", color: "#ffe66d", hint: "Tippe ein Licht: es schaltet sich und seine Nachbarn um. Mach alle aus!", create(e) {
    const N = 5, S = 62;
    let g = Array(N * N).fill(false), moves = 0, level = 0;
    const toggle = (k) => { const x = k % N, y = Math.floor(k / N); for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < N && ny < N) g[ny * N + nx] = !g[ny * N + nx]; } };
    function fresh() { g = Array(N * N).fill(false); const presses = 4 + Math.min(8, level * 2); for (let k = 0; k < presses; k++) toggle(e.randInt(0, N * N - 1)); if (g.every((v) => !v)) toggle(12); moves = 0; }
    fresh();
    return {
      update() {
        const i = e.input;
        if (i.pressed) { const cx = Math.floor((i.x - 25) / S), cy = Math.floor((i.y - 170) / S); if (cx >= 0 && cy >= 0 && cx < N && cy < N) { toggle(cy * N + cx); moves += 1; if (g.every((v) => !v)) { level += 1; e.addScore(Math.max(5, 40 - moves)); fresh(); } } }
      },
      draw() {
        e.text(`Stufe ${level + 1} · Züge ${moves}`, W / 2, 120, { size: 24 });
        g.forEach((on, k) => { const x = 25 + (k % N) * S, y = 170 + Math.floor(k / N) * S; e.rect(x + 3, y + 3, S - 6, S - 6, on ? "#ffe66d" : "rgba(20,20,40,0.75)", 14); if (on) e.circle(x + S / 2, y + S / 2, 10, "#fff"); });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Flood It */
  R({ id: "flood-it", name: "Flood It", emoji: "🌊", cat: "Denken", color: "#4d8dff", hint: "Tippe eine Farbe: die Fläche oben links wächst. Alles in einer Farbe, bevor die Züge ausgehen!", create(e) {
    const N = 9, S = 34, COLORS = ["#ff5d73", "#ffb347", "#ffe66d", "#6bd45f", "#4cc9ff", "#b46bff"];
    let g, left = 18, level = 0;
    function fresh() { g = Array.from({ length: N * N }, () => e.randInt(0, 5)); left = 17 + Math.min(4, level); }
    fresh();
    function flood(color) {
      const old = g[0]; if (old === color) return false;
      const stack = [0], seen = new Set([0]);
      while (stack.length) { const k = stack.pop(); g[k] = color; const x = k % N, y = Math.floor(k / N); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, nk = ny * N + nx; if (nx >= 0 && ny >= 0 && nx < N && ny < N && !seen.has(nk) && g[nk] === old) { seen.add(nk); stack.push(nk); } } }
      return true;
    }
    return {
      update() {
        const i = e.input;
        let pick = -1;
        if (i.pressed) COLORS.forEach((c, k) => { if (e.dist(i.x, i.y, 42 + k * 55, 500) < 26) pick = k; });
        ["1", "2", "3", "4", "5", "6"].forEach((key, k) => { if (i.keyPressed(key)) pick = k; });
        if (pick >= 0 && flood(pick)) {
          left -= 1;
          if (g.every((v) => v === g[0])) { level += 1; e.addScore(20 + left * 3); fresh(); }
          else if (left <= 0) e.over();
        }
      },
      draw() {
        e.text(`Züge übrig: ${left}`, W / 2, 110, { size: 26 });
        g.forEach((c, k) => e.rect(27 + (k % N) * S, 150 + Math.floor(k / N) * S, S - 1, S - 1, COLORS[c], 5));
        COLORS.forEach((c, k) => e.circle(42 + k * 55, 500, 24, c, "#fff", 4));
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Minesweeper */
  R({ id: "minesweeper", name: "Minesweeper", emoji: "💣", cat: "Denken", color: "#8aa4b8", hint: "Tippe Felder auf. Mit dem Flaggen-Knopf markierst du Minen.", create(e) {
    const COLS = 8, ROWS = 10, S = 40, OX = 20, OY = 120, NUM = ["", "#4d8dff", "#3ddc84", "#ff5d73", "#8a5cff", "#ff9f43", "#22d3ee", "#fff", "#aaa"];
    let mines = 10, field, first, flagMode = false, dead = false, level = 0, shown = 0;
    function fresh() { field = Array.from({ length: COLS * ROWS }, () => ({ mine: false, open: false, flag: false, n: 0 })); first = true; dead = false; }
    fresh();
    const around = (k) => { const x = k % COLS, y = Math.floor(k / COLS), out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS) out.push(ny * COLS + nx); } return out; };
    function plant(safe) { let placed = 0; while (placed < mines) { const k = e.randInt(0, COLS * ROWS - 1); if (k !== safe && !around(safe).includes(k) && !field[k].mine) { field[k].mine = true; placed += 1; } } field.forEach((c, k) => { c.n = around(k).filter((a) => field[a].mine).length; }); }
    function reveal(k) {
      const stack = [k];
      while (stack.length) { const c = stack.pop(); if (field[c].open || field[c].flag) continue; field[c].open = true; if (!field[c].mine) { shown += 1; e.score(shown); if (field[c].n === 0) stack.push(...around(c)); } }
    }
    return {
      update() {
        const i = e.input;
        if (dead) return;
        if (i.tap && e.inside(i.x, i.y, 20, 560, 150, 50)) { flagMode = !flagMode; return; }
        if (i.tap) {
          const cx = Math.floor((i.x - OX) / S), cy = Math.floor((i.y - OY) / S);
          if (cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS) {
            const k = cy * COLS + cx;
            if (flagMode) { if (!field[k].open) field[k].flag = !field[k].flag; }
            else if (!field[k].flag) {
              if (first) { plant(k); first = false; }
              if (field[k].mine) { dead = true; field.forEach((c) => { if (c.mine) c.open = true; }); e.over(); return; }
              if (field[k].open && field[k].n > 0) { const flags = around(k).filter((a) => field[a].flag).length; if (flags === field[k].n) for (const a of around(k)) { if (!field[a].flag && field[a].mine) { dead = true; field.forEach((c) => { if (c.mine) c.open = true; }); e.over(); return; } reveal(a); } }
              else reveal(k);
            }
            if (!dead && field.every((c) => c.mine || c.open)) { level += 1; mines = Math.min(18, mines + 2); e.addScore(30); fresh(); }
          }
        }
      },
      draw() {
        e.text(`Minen: ${mines - field.filter((c) => c.flag).length}`, W / 2, 90, { size: 24 });
        field.forEach((c, k) => {
          const x = OX + (k % COLS) * S, y = OY + Math.floor(k / COLS) * S;
          e.rect(x + 1, y + 1, S - 2, S - 2, c.open ? (c.mine ? "#ff5d73" : "rgba(255,255,255,0.78)") : "rgba(110,130,150,0.92)", 6);
          if (c.open && c.mine) e.emoji("💣", x + S / 2, y + S / 2, 24);
          else if (c.open && c.n) e.text(c.n, x + S / 2, y + S / 2, { size: 24, color: NUM[c.n], stroke: false });
          else if (!c.open && c.flag) e.emoji("🚩", x + S / 2, y + S / 2, 24);
        });
        e.rect(20, 560, 150, 50, flagMode ? "#ffe66d" : "rgba(255,255,255,0.88)", 16);
        e.text(flagMode ? "🚩 Flagge an" : "🚩 Flagge", 95, 585, { size: 18, color: "#111", stroke: false });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Tower of Hanoi */
  R({ id: "hanoi", name: "Turm von Hanoi", emoji: "🗼", cat: "Denken", color: "#b46bff", hint: "Bring alle Scheiben auf die rechte Stange. Nie eine große auf eine kleine!", create(e) {
    let n = 3, pegs, from = -1, moves = 0, level = 0;
    const colors = ["#ff5d73", "#ffb347", "#ffe66d", "#6bd45f", "#4cc9ff", "#b46bff", "#ff6bb5"];
    function fresh() { pegs = [Array.from({ length: n }, (_, k) => n - k), [], []]; from = -1; moves = 0; }
    fresh();
    function press(p) {
      if (from < 0) { if (pegs[p].length) from = p; return; }
      if (p === from) { from = -1; return; }
      const disc = pegs[from][pegs[from].length - 1], top = pegs[p][pegs[p].length - 1];
      if (top === undefined || top > disc) { pegs[p].push(pegs[from].pop()); moves += 1; from = -1; if (pegs[2].length === n) { level += 1; e.addScore(n * 10); n = Math.min(7, n + 1); fresh(); } } else from = -1;
    }
    return {
      update() {
        const i = e.input;
        if (i.pressed && i.y > 180 && i.y < 540) press(Math.max(0, Math.min(2, Math.floor(i.x / 120))));
        ["1", "2", "3"].forEach((key, k) => { if (i.keyPressed(key)) press(k); });
      },
      draw() {
        e.text(`Scheiben ${n} · Züge ${moves}`, W / 2, 120, { size: 24 });
        pegs.forEach((stack, p) => {
          const cx = 60 + p * 120;
          e.rect(cx - 5, 230, 10, 290, from === p ? "#fff" : "rgba(255,255,255,0.6)", 5); e.rect(cx - 52, 516, 104, 10, "rgba(255,255,255,0.8)", 5);
          stack.forEach((d, k) => { const w = 28 + d * 13; e.rect(cx - w / 2, 500 - k * 26 - (from === p && k === stack.length - 1 ? 30 : 0), w, 22, colors[d - 1], 8); });
        });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Number Memory */
  R({ id: "number-memory", name: "Zahlen merken", emoji: "🧠", cat: "Denken", color: "#ff7a9c", hint: "Merk dir die Zahl, sie verschwindet gleich. Tippe sie dann ein.", create(e) {
    let digits = 3, number = "", phase = "show", timer = 0, typed = "", level = 0, msg = "";
    const start = () => { number = Array.from({ length: digits }, () => e.randInt(0, 9)).join(""); typed = ""; phase = "show"; timer = 1.4 + digits * 0.55; msg = ""; };
    start();
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
    return {
      update(dt) {
        const i = e.input;
        if (phase === "show") { timer -= dt; if (timer <= 0) phase = "type"; return; }
        if (phase === "result") { timer -= dt; if (timer <= 0) { if (msg === "Richtig!") start(); else e.over(); } return; }
        const press = (k) => { if (k === "⌫") typed = typed.slice(0, -1); else if (k === "OK") submit(); else if (typed.length < digits) { typed += k; if (typed.length === digits) submit(); } };
        if (i.pressed) keys.forEach((k, idx) => { if (e.inside(i.x, i.y, 40 + (idx % 3) * 90, 330 + Math.floor(idx / 3) * 70, 80, 60)) press(k); });
        for (let d = 0; d <= 9; d++) if (i.keyPressed(String(d))) press(String(d));
        if (i.keyPressed("Backspace")) press("⌫");
        if (i.keyPressed("Enter")) submit();
        function submit() { if (typed === number) { level += 1; e.score(digits - 2); digits += 1; msg = "Richtig!"; } else msg = `Falsch: ${number}`; phase = "result"; timer = 1.3; }
      },
      draw() {
        e.text(`${digits} Ziffern`, W / 2, 100, { size: 24 });
        e.panel(30, 140, W - 60, 120, 24, 0.55);
        e.text(phase === "show" ? number : typed || "…", W / 2, 200, { size: 56 });
        if (phase === "show") e.rect(40, 270, (W - 80) * Math.max(0, timer / (1.4 + digits * 0.55)), 6, "#fff", 3);
        if (phase !== "show") keys.forEach((k, idx) => e.button(k, 40 + (idx % 3) * 90, 330 + Math.floor(idx / 3) * 70, 80, 60, { size: 26 }));
        if (msg) e.text(msg, W / 2, 300, { size: 28, color: msg === "Richtig!" ? "#9dff7a" : "#ff7a7a" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Pattern Grid */
  R({ id: "pattern-grid", name: "Muster merken", emoji: "🔲", cat: "Denken", color: "#59a7ff", hint: "Merk dir die leuchtenden Felder und tippe sie danach an", create(e) {
    const N = 4, S = 76;
    let lit = [], phase = "show", timer = 1.3, found = new Set(), round = 0, bad = -1, flash = 0;
    const start = () => { const count = Math.min(10, 3 + Math.floor(round / 2)); lit = e.shuffle(Array.from({ length: N * N }, (_, k) => k)).slice(0, count); found = new Set(); phase = "show"; timer = 1.0 + count * 0.15; bad = -1; };
    start();
    return {
      update(dt) {
        const i = e.input; flash = Math.max(0, flash - dt);
        if (phase === "show") { timer -= dt; if (timer <= 0) phase = "input"; return; }
        if (phase === "dead") { timer -= dt; if (timer <= 0) e.over(); return; }
        if (phase === "next") { timer -= dt; if (timer <= 0) start(); return; }
        if (i.pressed) {
          const cx = Math.floor((i.x - 28) / S), cy = Math.floor((i.y - 190) / S);
          if (cx >= 0 && cy >= 0 && cx < N && cy < N) {
            const k = cy * N + cx;
            if (lit.includes(k)) { found.add(k); if (found.size === lit.length) { round += 1; e.score(round); phase = "next"; timer = 0.7; } } else { bad = k; phase = "dead"; timer = 1.1; }
          }
        }
      },
      draw() {
        e.text(phase === "show" ? "Merken!" : phase === "input" ? "Tippe die Felder" : phase === "dead" ? "Falsch" : "Richtig!", W / 2, 130, { size: 28 });
        for (let k = 0; k < N * N; k++) {
          const x = 28 + (k % N) * S, y = 190 + Math.floor(k / N) * S;
          const on = (phase === "show" && lit.includes(k)) || found.has(k) || (phase === "dead" && lit.includes(k) && !found.has(k));
          e.rect(x + 3, y + 3, S - 6, S - 6, k === bad ? "#ff4d5e" : on ? (phase === "dead" ? "#ffb347" : "#4cc9ff") : "rgba(20,20,40,0.7)", 12);
        }
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Colour Sort */
  R({ id: "color-sort", name: "Farben sortieren", emoji: "🧪", cat: "Denken", color: "#6bd45f", hint: "Tippe ein Glas und dann ein anderes: gieße gleiche Farben zusammen", create(e) {
    const COLORS = ["#ff5d73", "#4cc9ff", "#ffe66d", "#6bd45f", "#b46bff", "#ffa94d", "#ff6bb5"];
    let tubes, sel = -1, level = 0;
    function fresh() {
      const n = Math.min(7, 3 + Math.floor(level / 2));
      for (let attempt = 0; attempt < 20; attempt++) {
        const bag = e.shuffle(Array.from({ length: n * 4 }, (_, k) => Math.floor(k / 4)));
        tubes = Array.from({ length: n + 2 }, (_, t) => (t < n ? bag.slice(t * 4, t * 4 + 4) : []));
        if (!tubes.some((t) => t.length === 4 && t.every((c) => c === t[0]))) break;
      }
      sel = -1;
    }
    fresh();
    const rect = (t) => { const per = Math.ceil(tubes.length / 2), col = t % per, row = Math.floor(t / per), gap = Math.min(70, (W - 40) / per); return { x: 20 + col * gap + (gap - 50) / 2 + (W - 40 - per * gap) / 2, y: 170 + row * 210, w: 50, h: 176 }; };
    const done = () => tubes.every((t) => t.length === 0 || (t.length === 4 && t.every((c) => c === t[0])));
    function pour(a, b) {
      const from = tubes[a], to = tubes[b]; if (!from.length || a === b) return;
      const c = from[from.length - 1]; if (to.length && to[to.length - 1] !== c) return;
      while (from.length && from[from.length - 1] === c && to.length < 4) to.push(from.pop());
    }
    return {
      update() {
        const i = e.input;
        if (i.pressed) {
          if (e.inside(i.x, i.y, 130, 590, 100, 40)) { fresh(); return; }
          tubes.forEach((_, t) => { const r = rect(t); if (e.inside(i.x, i.y, r.x - 6, r.y - 10, r.w + 12, r.h + 20)) { if (sel < 0) { if (tubes[t].length) sel = t; } else { pour(sel, t); sel = -1; if (done()) { level += 1; e.addScore(10 + level * 2); fresh(); } } } });
        }
      },
      draw() {
        e.text(`Stufe ${level + 1}`, W / 2, 110, { size: 24 });
        tubes.forEach((t, k) => {
          const r = rect(k), lift = sel === k ? -16 : 0;
          e.rect(r.x, r.y + lift, r.w, r.h, "rgba(255,255,255,0.15)", 14);
          t.forEach((c, s) => e.rect(r.x + 4, r.y + lift + r.h - 6 - (s + 1) * 41, r.w - 8, 38, COLORS[c], 8));
          e.g.strokeStyle = sel === k ? "#fff" : "rgba(255,255,255,0.7)"; e.g.lineWidth = 3; e.g.beginPath(); if (e.g.roundRect) e.g.roundRect(r.x, r.y + lift, r.w, r.h, 14); else e.g.rect(r.x, r.y + lift, r.w, r.h); e.g.stroke();
        });
        e.button("Neu mischen", 100, 590, 160, 40, { size: 16 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Maze */
  R({ id: "maze-run", name: "Labyrinth", emoji: "🌀", cat: "Denken", color: "#59a7ff", hint: "Wische in eine Richtung: du läufst bis zur nächsten Kreuzung. Finde den Ausgang!", create(e) {
    const COLS = 9, ROWS = 13, S = 36, OX = 18, OY = 110;
    let cells, px = 0, py = 0, path = [], stepT = 0, solved = 0, level = 0;
    function build() {
      cells = Array.from({ length: COLS * ROWS }, () => ({ n: true, e: true, s: true, w: true, seen: false }));
      const stack = [[0, 0]]; cells[0].seen = true;
      while (stack.length) {
        const [x, y] = stack[stack.length - 1];
        const options = [];
        if (y > 0 && !cells[(y - 1) * COLS + x].seen) options.push(["n", x, y - 1]); if (x < COLS - 1 && !cells[y * COLS + x + 1].seen) options.push(["e", x + 1, y]);
        if (y < ROWS - 1 && !cells[(y + 1) * COLS + x].seen) options.push(["s", x, y + 1]); if (x > 0 && !cells[y * COLS + x - 1].seen) options.push(["w", x - 1, y]);
        if (!options.length) { stack.pop(); continue; }
        const [dir, nx, ny] = e.pick(options); const opp = { n: "s", e: "w", s: "n", w: "e" }[dir];
        cells[y * COLS + x][dir] = false; cells[ny * COLS + nx][opp] = false; cells[ny * COLS + nx].seen = true; stack.push([nx, ny]);
      }
      px = 0; py = 0; path = [];
    }
    build();
    const DIRS = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
    const OPP = { n: "s", e: "w", s: "n", w: "e" };
    function plan(dir) {                                           // the cells you run through: straight on, round bends, until a crossing, a dead end or the exit
      let x = px, y = py;
      const list = [];
      if (cells[y * COLS + x][dir]) return list;
      for (let guard = 0; guard < 300; guard++) {
        x += DIRS[dir][0]; y += DIRS[dir][1];
        list.push([x, y]);
        if (x === COLS - 1 && y === ROWS - 1) break;
        const open = ["n", "e", "s", "w"].filter((d) => d !== OPP[dir] && !cells[y * COLS + x][d]);
        if (open.length !== 1) break;
        dir = open[0];
      }
      return list;
    }
    return {
      update(dt) {
        const i = e.input;
        if (path.length) { stepT -= dt; if (stepT <= 0) { [px, py] = path.shift(); stepT = 0.04; if (px === COLS - 1 && py === ROWS - 1) { solved += 1; e.addScore(10); build(); } } return; }
        let dir = null;
        if (i.swipe) dir = { up: "n", right: "e", down: "s", left: "w" }[i.swipe];
        if (i.keyPressed("ArrowUp")) dir = "n"; if (i.keyPressed("ArrowRight")) dir = "e"; if (i.keyPressed("ArrowDown")) dir = "s"; if (i.keyPressed("ArrowLeft")) dir = "w";
        if (i.tap) { const dx = i.x - (OX + px * S + S / 2), dy = i.y - (OY + py * S + S / 2); dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "e" : "w") : dy > 0 ? "s" : "n"; }
        if (dir) { path = plan(dir); stepT = 0; }
      },
      draw() {
        e.panel(OX - 4, OY - 4, COLS * S + 8, ROWS * S + 8, 10, 0.4);
        cells.forEach((c, k) => { const x = OX + (k % COLS) * S, y = OY + Math.floor(k / COLS) * S; if (c.n) e.line(x, y, x + S, y, "#fff", 3); if (c.w) e.line(x, y, x, y + S, "#fff", 3); if (c.s && k >= COLS * (ROWS - 1)) e.line(x, y + S, x + S, y + S, "#fff", 3); if (c.e && k % COLS === COLS - 1) e.line(x + S, y, x + S, y + S, "#fff", 3); });
        e.emoji("🏁", OX + (COLS - 1) * S + S / 2, OY + (ROWS - 1) * S + S / 2, 26);
        e.circle(OX + px * S + S / 2, OY + py * S + S / 2, 11, "#ffe66d", "#fff", 3);
        e.text(`Labyrinthe: ${solved}`, W / 2, 80, { size: 22 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Word Scramble */
  R({ id: "word-scramble", name: "Wörter-Salat", emoji: "🔤", cat: "Denken", color: "#ffb347", hint: "Bring die Buchstaben in die richtige Reihenfolge (15 Sekunden pro Wort)", create(e) {
    let word = "", pool = [], answer = [], time = 15, points = 0, shake = 0, order = e.shuffle(WORDS.map((_, k) => k)), at = 0;
    function next() {
      word = WORDS[order[at % order.length]]; at += 1;
      let letters; do { letters = e.shuffle(word.split("")); } while (letters.join("") === word);
      pool = letters.map((ch, k) => ({ ch, k, used: false })); answer = []; time = 15 + Math.min(10, Math.floor(word.length / 3));
    }
    next();
    const place = (cell) => { const x = 20 + (cell % 6) * 52, y = 400 + Math.floor(cell / 6) * 60; return { x, y }; };
    return {
      update(dt) {
        const i = e.input; time -= dt; shake = Math.max(0, shake - dt);
        if (time <= 0) { e.over(); return; }
        const take = (idx) => { if (pool[idx] && !pool[idx].used) { pool[idx].used = true; answer.push(idx); check(); } };
        if (i.pressed) {
          pool.forEach((p, idx) => { const { x, y } = place(idx); if (e.inside(i.x, i.y, x, y, 46, 50)) take(idx); });
          answer.forEach((idx, pos) => { if (e.inside(i.x, i.y, 20 + pos * 33, 250, 31, 50)) { if (pos === answer.length - 1) { pool[idx].used = false; answer.pop(); } else { for (const a of answer.splice(pos)) pool[a].used = false; } } });
          if (e.inside(i.x, i.y, 130, 592, 100, 40)) { for (const a of answer.splice(0)) pool[a].used = false; }
        }
        for (const ch of "abcdefghijklmnopqrstuvwxyz") if (i.keyPressed(ch)) { const idx = pool.findIndex((p) => !p.used && p.ch === ch.toUpperCase()); if (idx >= 0) take(idx); }
        if (i.keyPressed("Backspace") && answer.length) pool[answer.pop()].used = false;
        function check() {
          if (answer.length === word.length) { if (answer.map((a) => pool[a].ch).join("") === word) { points += 1; e.score(points); next(); } else { shake = 0.4; for (const a of answer.splice(0)) pool[a].used = false; } }
        }
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(0)} s`, W / 2, 110, { size: 28 });
        const dx = shake > 0 ? Math.sin(shake * 60) * 6 : 0;
        for (let k = 0; k < word.length; k++) { e.rect(20 + k * 33 + dx, 250, 31, 50, "rgba(0,0,0,0.5)", 8); if (answer[k] !== undefined) e.text(pool[answer[k]].ch, 20 + k * 33 + 15 + dx, 276, { size: 24 }); }
        pool.forEach((p, idx) => { const { x, y } = place(idx); e.rect(x, y, 46, 50, p.used ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.92)", 12); if (!p.used) e.text(p.ch, x + 23, y + 26, { size: 26, color: "#111", stroke: false }); });
        e.button("Leeren", 130, 592, 100, 40, { size: 16 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Hangman */
  R({ id: "hangman", name: "Galgenmännchen", emoji: "🪢", cat: "Denken", color: "#9aa4b2", hint: "Rate das Wort Buchstabe für Buchstabe. Sieben Fehler und es ist vorbei", create(e) {
    let word = "", got = new Set(), wrong = new Set(), points = 0, order = e.shuffle(WORDS.map((_, k) => k)), at = 0, msg = "", msgT = 0;
    const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const next = () => { word = WORDS[order[at % order.length]]; at += 1; got = new Set(); wrong = new Set(); };
    next();
    function guess(ch) {
      if (got.has(ch) || wrong.has(ch)) return;
      if (word.includes(ch)) { got.add(ch); if (word.split("").every((c) => got.has(c))) { points += 1; e.score(points); msg = "Richtig!"; msgT = 0.8; next(); } }
      else { wrong.add(ch); if (wrong.size >= 7) { msg = word; msgT = 3; e.over(); } }
    }
    return {
      update(dt) {
        const i = e.input; msgT -= dt;
        if (e.finished) return;
        if (i.pressed) LETTERS.forEach((ch, k) => { if (e.inside(i.x, i.y, 12 + (k % 7) * 48, 400 + Math.floor(k / 7) * 54, 44, 48)) guess(ch); });
        for (const c of LETTERS) if (i.keyPressed(c.toLowerCase())) guess(c);
      },
      draw() {
        const parts = wrong.size;
        e.line(70, 300, 160, 300, "#fff", 5); e.line(115, 300, 115, 120, "#fff", 5); e.line(115, 120, 200, 120, "#fff", 5); e.line(200, 120, 200, 148, "#fff", 4);
        if (parts > 0) e.circle(200, 168, 20, null, "#fff", 4); if (parts > 1) e.line(200, 188, 200, 240, "#fff", 4); if (parts > 2) e.line(200, 200, 176, 226, "#fff", 4);
        if (parts > 3) e.line(200, 200, 224, 226, "#fff", 4); if (parts > 4) e.line(200, 240, 180, 275, "#fff", 4); if (parts > 5) e.line(200, 240, 220, 275, "#fff", 4); if (parts > 6) e.text("✕ ✕", 200, 166, { size: 14 });
        const shown = word.split("").map((c) => (got.has(c) || e.finished ? c : "_")).join(" ");
        e.text(shown, W / 2, 340, { size: word.length > 9 ? 22 : 30 });
        LETTERS.forEach((ch, k) => { const x = 12 + (k % 7) * 48, y = 400 + Math.floor(k / 7) * 54; const used = got.has(ch) || wrong.has(ch); e.rect(x, y, 44, 48, used ? (got.has(ch) ? "rgba(100,220,120,0.5)" : "rgba(220,80,90,0.5)") : "rgba(255,255,255,0.9)", 10); e.text(ch, x + 22, y + 25, { size: 22, color: used ? "#fff" : "#111", stroke: false }); });
        if (msgT > 0) e.text(msg, W / 2, 90, { size: 26 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Mini Sudoku */
  R({ id: "sudoku-4", name: "Mini-Sudoku", emoji: "🔟", cat: "Denken", color: "#59c9ff", hint: "In jeder Zeile, Spalte und jedem 2x2-Kasten steht jede Zahl 1 bis 4 genau einmal", create(e) {
    let grid, fixed, selected = -1, solved = 0;
    function fill(g, k) { if (k === 16) return true; const r = Math.floor(k / 4), c = k % 4; for (const v of e.shuffle([1, 2, 3, 4])) { if (ok(g, r, c, v)) { g[k] = v; if (fill(g, k + 1)) return true; g[k] = 0; } } return false; }
    function ok(g, r, c, v) { for (let i = 0; i < 4; i++) { if (g[r * 4 + i] === v || g[i * 4 + c] === v) return false; } const br = r - (r % 2), bc = c - (c % 2); for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) if (g[(br + y) * 4 + bc + x] === v) return false; return true; }
    function fresh() { grid = Array(16).fill(0); fill(grid, 0); const holes = e.shuffle(Array.from({ length: 16 }, (_, k) => k)).slice(0, Math.min(11, 7 + solved)); fixed = grid.map((v, k) => !holes.includes(k)); for (const k of holes) grid[k] = 0; selected = -1; }
    fresh();
    const conflict = (k) => { const v = grid[k]; if (!v) return false; const r = Math.floor(k / 4), c = k % 4; for (let i = 0; i < 4; i++) { if (i !== c && grid[r * 4 + i] === v) return true; if (i !== r && grid[i * 4 + c] === v) return true; } const br = r - (r % 2), bc = c - (c % 2); for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const o = (br + y) * 4 + bc + x; if (o !== k && grid[o] === v) return true; } return false; };
    function set(v) { if (selected >= 0 && !fixed[selected]) { grid[selected] = v; if (grid.every((x, k) => x && !conflict(k))) { solved += 1; e.addScore(10); fresh(); } } }
    return {
      update() {
        const i = e.input;
        if (i.pressed) {
          const cx = Math.floor((i.x - 40) / 70), cy = Math.floor((i.y - 150) / 70);
          if (cx >= 0 && cy >= 0 && cx < 4 && cy < 4) selected = cy * 4 + cx;
          for (let v = 0; v <= 4; v++) if (e.inside(i.x, i.y, 40 + v * 56, 480, 50, 56)) set(v);
        }
        for (let v = 1; v <= 4; v++) if (i.keyPressed(String(v))) set(v);
        if (i.keyPressed("Backspace") || i.keyPressed("0")) set(0);
      },
      draw() {
        e.text(`Gelöst: ${solved}`, W / 2, 110, { size: 24 });
        for (let k = 0; k < 16; k++) {
          const x = 40 + (k % 4) * 70, y = 150 + Math.floor(k / 4) * 70;
          e.rect(x + 2, y + 2, 66, 66, k === selected ? "rgba(255,230,109,0.9)" : fixed[k] ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.88)", 10);
          if (grid[k]) e.text(grid[k], x + 35, y + 36, { size: 34, color: conflict(k) ? "#ff4d5e" : fixed[k] ? "#fff" : "#111", stroke: fixed[k] });
        }
        e.line(40, 150 + 140, 320, 150 + 140, "#fff", 4); e.line(40 + 140, 150, 40 + 140, 430, "#fff", 4);
        for (let v = 0; v <= 4; v++) e.button(v === 0 ? "✕" : String(v), 40 + v * 56, 480, 50, 56, { size: 24 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ 2048 */
  R({ id: "game-2048", name: "2048", emoji: "🔶", cat: "Denken", color: "#f2b179", hint: "Wische in eine Richtung: gleiche Zahlen verschmelzen. Erreiche 2048!", create(e) {
    const N = 4, S = 76, GAP = 8, OX = 8, OY = 150;
    let g = Array(16).fill(0), points = 0, dead = false;
    const add = () => { const free = g.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0); if (free.length) g[e.pick(free)] = e.rand() < 0.9 ? 2 : 4; };
    add(); add();
    const color = (v) => ({ 2: "#eee4da", 4: "#ede0c8", 8: "#f2b179", 16: "#f59563", 32: "#f67c5f", 64: "#f65e3b", 128: "#edcf72", 256: "#edcc61", 512: "#edc850", 1024: "#edc53f", 2048: "#edc22e" }[v] || "#3c3a32");
    function line(arr) { const a = arr.filter(Boolean); const out = []; let gain = 0; for (let k = 0; k < a.length; k++) { if (a[k] === a[k + 1]) { out.push(a[k] * 2); gain += a[k] * 2; k += 1; } else out.push(a[k]); } while (out.length < N) out.push(0); return [out, gain]; }
    function move(dir) {
      let moved = false, gain = 0; const next = g.slice();
      for (let a = 0; a < N; a++) {
        const idx = Array.from({ length: N }, (_, b) => (dir === "left" ? a * N + b : dir === "right" ? a * N + (N - 1 - b) : dir === "up" ? b * N + a : (N - 1 - b) * N + a));
        const [res, gn] = line(idx.map((k) => g[k])); gain += gn; idx.forEach((k, b) => { if (next[k] !== res[b]) moved = true; next[k] = res[b]; });
      }
      if (!moved) return; g = next; points += gain; e.score(points / 4 + Math.max(...g) / 16); add();
      const stuck = !g.includes(0) && ["left", "right", "up", "down"].every((d) => { const copy = g.slice(); let any = false; for (let a = 0; a < N; a++) { const idx = Array.from({ length: N }, (_, b) => (d === "left" ? a * N + b : d === "right" ? a * N + (N - 1 - b) : d === "up" ? b * N + a : (N - 1 - b) * N + a)); const [res] = line(idx.map((k) => copy[k])); idx.forEach((k, b) => { if (copy[k] !== res[b]) any = true; }); } return !any; });
      if (stuck) { dead = true; e.over(); }
    }
    return {
      update() {
        const i = e.input;
        if (i.swipe) move(i.swipe); else if (i.keyPressed("ArrowLeft")) move("left"); else if (i.keyPressed("ArrowRight")) move("right"); else if (i.keyPressed("ArrowUp")) move("up"); else if (i.keyPressed("ArrowDown")) move("down");
      },
      draw() {
        e.text(String(points), W / 2, 110, { size: 38 });
        e.panel(OX - 4, OY - 4, N * S + (N + 1) * GAP - 8 + 8, N * S + (N + 1) * GAP - 8 + 8, 16, 0.5);
        g.forEach((v, k) => { const x = OX + GAP + (k % N) * (S + GAP), y = OY + GAP + Math.floor(k / N) * (S + GAP) - 4; e.rect(x, y, S, S, v ? color(v) : "rgba(255,255,255,0.12)", 10); if (v) e.text(v, x + S / 2, y + S / 2, { size: v > 999 ? 24 : v > 99 ? 30 : 36, color: v <= 4 ? "#776e65" : "#fff", stroke: false }); });
      },
    };
  } });
})();
