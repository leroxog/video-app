/* Pulse games: more classics (pg-more.js): Match 3, Missile Command, Pac Maze, Tron, Wordle, Sokoban, Cookie Clicker, Asteroids, Squash and Lunar Lander.
   Every game is registered in the kit (pg-kit.js); the field is 360 x 640. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const left = (i) => i.swipe === "left" || i.keyPressed("ArrowLeft") || i.keyPressed("a");
  const right = (i) => i.swipe === "right" || i.keyPressed("ArrowRight") || i.keyPressed("d");
  const upK = (i) => i.swipe === "up" || i.keyPressed("ArrowUp") || i.keyPressed("w");
  const downK = (i) => i.swipe === "down" || i.keyPressed("ArrowDown") || i.keyPressed("s");

  /* ------------------------------------------------------------------------------------------------ Match 3 */
  R({ id: "match-3", name: "Drei gleiche", emoji: "💎", cat: "Denken", color: "#ff6bb5", hint: "Tausche zwei Nachbarn (wischen oder nacheinander tippen): drei gleiche in einer Reihe verschwinden. 25 Züge", create(e) {
    const N = 7, S = 48, OX = 12, OY = 150, GEMS = ["💎", "🍒", "🍋", "🍏", "🔮", "🍊"], TINT = ["#4cc9ff", "#ff5d73", "#ffe66d", "#6bd45f", "#b46bff", "#ff9f43"];
    let g, sel = -1, moves = 25, phase = "idle", timer = 0, swapped = null, combo = 0, points = 0, pops = [];
    const kind = (k) => g[k];
    function matches() {
      const out = new Set();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const k = y * N + x, v = g[k]; if (v < 0) continue;
        if (x < N - 2 && g[k + 1] === v && g[k + 2] === v) { let n = x; while (n < N && g[y * N + n] === v) { out.add(y * N + n); n += 1; } }
        if (y < N - 2 && g[k + N] === v && g[k + 2 * N] === v) { let n = y; while (n < N && g[n * N + x] === v) { out.add(n * N + x); n += 1; } }
      }
      return out;
    }
    function fresh() { do { g = Array.from({ length: N * N }, () => e.randInt(0, 5)); } while (matches().size || !hasMove()); }
    function hasMove() { for (let k = 0; k < N * N; k++) for (const d of [1, N]) { const o = k + d; if (d === 1 && k % N === N - 1) continue; if (o >= N * N) continue; [g[k], g[o]] = [g[o], g[k]]; const ok = matches().size > 0; [g[k], g[o]] = [g[o], g[k]]; if (ok) return true; } return false; }
    function settle() {
      for (let x = 0; x < N; x++) { const col = []; for (let y = N - 1; y >= 0; y--) if (g[y * N + x] >= 0) col.push(g[y * N + x]); while (col.length < N) col.push(e.randInt(0, 5)); for (let y = N - 1, k = 0; y >= 0; y--, k++) g[y * N + x] = col[k]; }
    }
    fresh();
    const adjacent = (a, b) => (Math.abs(a - b) === N) || (Math.abs(a - b) === 1 && Math.floor(a / N) === Math.floor(b / N));
    function swap(a, b) { [g[a], g[b]] = [g[b], g[a]]; swapped = [a, b]; phase = "swap"; timer = 0.16; sel = -1; }
    const cellAt = (x, y) => { const cx = Math.floor((x - OX) / S), cy = Math.floor((y - OY) / S); return cx >= 0 && cy >= 0 && cx < N && cy < N ? cy * N + cx : -1; };
    return {
      update(dt) {
        const i = e.input;
        for (const p of pops) p.t -= dt; pops = pops.filter((p) => p.t > 0);
        if (phase === "idle") {
          if (moves <= 0) { e.over(); return; }
          if (i.swipe) { const a = cellAt(i.downX, i.downY); if (a >= 0) { const d = { left: -1, right: 1, up: -N, down: N }[i.swipe]; const b = a + d; if (b >= 0 && b < N * N && adjacent(a, b)) swap(a, b); } }
          else if (i.tap) { const k = cellAt(i.x, i.y); if (k >= 0) { if (sel < 0) sel = k; else if (sel === k) sel = -1; else if (adjacent(sel, k)) swap(sel, k); else sel = k; } }
          return;
        }
        timer -= dt;
        if (timer > 0) return;
        if (phase === "swap") { const m = matches(); if (m.size) { moves -= 1; combo = 0; phase = "clear"; clearNow(m); } else { swap(swapped[0], swapped[1]); phase = "back"; timer = 0.16; } }
        else if (phase === "back") { phase = "idle"; }
        else if (phase === "clear") { settle(); phase = "fall"; timer = 0.2; }
        else if (phase === "fall") { const m = matches(); if (m.size) { combo += 1; phase = "clear"; clearNow(m); } else { if (!hasMove()) fresh(); phase = "idle"; } }
      },
      draw() {
        e.text(`Züge: ${moves}`, W / 2, 100, { size: 28 });
        e.panel(OX - 4, OY - 4, N * S + 8, N * S + 8, 16, 0.5);
        g.forEach((v, k) => {
          const x = OX + (k % N) * S, y = OY + Math.floor(k / N) * S;
          e.rect(x + 2, y + 2, S - 4, S - 4, k === sel ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.14)", 12);
          if (v >= 0) e.emoji(GEMS[v], x + S / 2, y + S / 2 + 1, 34);
        });
        for (const p of pops) e.circle(p.x, p.y, 34 * (1 - p.t / 0.25) + 8, null, p.c, 3);
        if (combo > 0) e.text(`Kombo x${combo + 1}`, W / 2, 530, { size: 26, color: "#ffe66d" });
      },
    };
    function clearNow(m) {
      for (const k of m) { pops.push({ x: OX + (k % N) * S + S / 2, y: OY + Math.floor(k / N) * S + S / 2, t: 0.25, c: TINT[g[k]] }); g[k] = -1; }
      points += m.size * 10 * (1 + combo); e.score(points / 5); phase = "clear"; timer = 0.25;
    }
  } });

  /* ------------------------------------------------------------------------------------------------ Missile Command */
  R({ id: "missile-command", name: "Raketenabwehr", emoji: "🛡️", cat: "Arcade", color: "#ff5d5d", hint: "Tippe dorthin, wo deine Abwehr explodieren soll: schütze die Häuser", create(e) {
    const CITY_Y = 560, cities = [50, 130, 230, 310].map((x) => ({ x, alive: true }));
    let foes = [], blasts = [], shots = [], spawn = 1, t = 0, cool = 0;
    return {
      update(dt) {
        const i = e.input; t += dt; cool -= dt;
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.5, 1.5 - t * 0.02); const targets = cities.filter((c) => c.alive); if (targets.length) { const tg = e.pick(targets), sx = e.rand(10, W - 10), dx = tg.x - sx, dy = CITY_Y - 0, len = Math.hypot(dx, dy), sp = 50 + Math.min(70, t * 1.3); foes.push({ x: sx, y: 0, sx, tx: tg.x, vx: (dx / len) * sp, vy: (dy / len) * sp, city: tg }); } }
        if ((i.pressed || i.keyPressed(" ")) && cool <= 0 && i.y < CITY_Y - 30) { cool = 0.3; shots.push({ x: W / 2, y: 600, tx: i.x, ty: i.y, vx: 0, vy: 0 }); const s = shots[shots.length - 1]; const d = Math.hypot(s.tx - s.x, s.ty - s.y) || 1; s.vx = ((s.tx - s.x) / d) * 520; s.vy = ((s.ty - s.y) / d) * 520; s.dist = d; s.run = 0; }
        for (const s of shots) { s.x += s.vx * dt; s.y += s.vy * dt; s.run += 520 * dt; if (s.run >= s.dist) { s.done = true; blasts.push({ x: s.tx, y: s.ty, t: 0, max: 0.9 }); } }
        shots = shots.filter((s) => !s.done);
        for (const b of blasts) b.t += dt; blasts = blasts.filter((b) => b.t < b.max);
        for (const f of foes) {
          f.x += f.vx * dt; f.y += f.vy * dt;
          for (const b of blasts) { const r = 46 * Math.sin((b.t / b.max) * Math.PI); if (!f.dead && e.dist(f.x, f.y, b.x, b.y) < r + 4) { f.dead = true; e.addScore(5); blasts.push({ x: f.x, y: f.y, t: 0.5, max: 0.9 }); } }
          if (!f.dead && f.y >= CITY_Y) { f.dead = true; f.city.alive = false; blasts.push({ x: f.x, y: f.y, t: 0, max: 0.9 }); }
        }
        foes = foes.filter((f) => !f.dead);
        if (cities.every((c) => !c.alive)) e.over();
      },
      draw() {
        for (const f of foes) { e.line(f.sx, 0, f.x, f.y, "rgba(255,120,120,0.55)", 2); e.circle(f.x, f.y, 4, "#ffdd57"); }
        for (const s of shots) { e.line(W / 2, 600, s.x, s.y, "rgba(120,220,255,0.7)", 2); e.circle(s.x, s.y, 3, "#fff"); }
        for (const b of blasts) { const r = 46 * Math.sin((b.t / b.max) * Math.PI); e.circle(b.x, b.y, r, "rgba(255,200,80,0.55)", "#fff", 2); }
        for (const c of cities) e.emoji(c.alive ? "🏠" : "💥", c.x, CITY_Y + 20, 36);
        e.rect(0, 590, W, 50, "rgba(60,60,80,0.8)"); e.emoji("🛡️", W / 2, 604, 34);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Pac Maze */
  R({ id: "pac-maze", name: "Pac Maze", emoji: "🟡", cat: "Arcade", color: "#ffd23f", hint: "Wische, um abzubiegen: friss alle Punkte, aber lass dich nicht von den Geistern fangen", create(e) {
    const TW = 15, TH = 19, T = 22, OX = 15, OY = 130;
    let wall, dots, pac, ghosts, want = { x: 0, y: 0 }, lives = 3, level = 0, left_ = 0, inv = 0, mouth = 0;
    const key = (x, y) => y * TW + x;
    const solid = (x, y) => x < 0 || y < 0 || x >= TW || y >= TH || wall[key(x, y)];
    function build() {
      wall = Array(TW * TH).fill(true);
      const stack = [[1, 1]]; wall[key(1, 1)] = false;
      while (stack.length) {
        const [x, y] = stack[stack.length - 1];
        const opts = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dy]) => x + dx > 0 && y + dy > 0 && x + dx < TW - 1 && y + dy < TH - 1 && wall[key(x + dx, y + dy)]);
        if (!opts.length) { stack.pop(); continue; }
        const [dx, dy] = e.pick(opts); wall[key(x + dx / 2, y + dy / 2)] = false; wall[key(x + dx, y + dy)] = false; stack.push([x + dx, y + dy]);
      }
      for (let k = 0; k < 18; k++) { const x = e.randInt(1, TW - 2), y = e.randInt(1, TH - 2); if (wall[key(x, y)] && ((!solid(x - 1, y) && !solid(x + 1, y)) || (!solid(x, y - 1) && !solid(x, y + 1)))) wall[key(x, y)] = false; }
      dots = wall.map((w) => !w); dots[key(1, 1)] = false;
      left_ = dots.filter(Boolean).length;
      pac = { tx: 1, ty: 1, p: 0, d: { x: 0, y: 0 } };
      ghosts = Array.from({ length: Math.min(4, 2 + Math.floor(level / 2)) }, (_, k) => ({ tx: TW - 2, ty: TH - 2 - (k % 2) * 2, p: 0, d: { x: -1, y: 0 }, sx: TW - 2, sy: TH - 2 - (k % 2) * 2 }));
      want = { x: 0, y: 0 }; inv = 1.2;
    }
    build();
    function advance(a, dt, speed, choose) {
      let move = speed * dt;
      while (move > 0) {
        if (a.p === 0) { choose(a); if (!a.d.x && !a.d.y) return; if (solid(a.tx + a.d.x, a.ty + a.d.y)) { a.d = { x: 0, y: 0 }; return; } }
        const step = Math.min(move, 1 - a.p); a.p += step; move -= step;
        if (a.p >= 1 - 1e-9) { a.tx += a.d.x; a.ty += a.d.y; a.p = 0; }
      }
    }
    const chosePac = (a) => { if ((want.x || want.y) && !solid(a.tx + want.x, a.ty + want.y)) a.d = { ...want }; };
    const choseGhost = (a) => {
      const dirs = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }].filter((d) => !solid(a.tx + d.x, a.ty + d.y));
      let opts = dirs.filter((d) => !(d.x === -a.d.x && d.y === -a.d.y));
      if (!opts.length) opts = dirs;
      if (!opts.length) { a.d = { x: 0, y: 0 }; return; }
      if (e.rand() < 0.6) { opts.sort((p, q) => Math.abs(a.tx + p.x - pac.tx) + Math.abs(a.ty + p.y - pac.ty) - (Math.abs(a.tx + q.x - pac.tx) + Math.abs(a.ty + q.y - pac.ty))); a.d = opts[0]; } else a.d = e.pick(opts);
    };
    const pos = (a) => [a.tx + a.d.x * a.p, a.ty + a.d.y * a.p];
    return {
      update(dt) {
        const i = e.input; inv = Math.max(0, inv - dt); mouth += dt * 10;
        let d = null; if (left(i)) d = { x: -1, y: 0 }; else if (right(i)) d = { x: 1, y: 0 }; else if (upK(i)) d = { x: 0, y: -1 }; else if (downK(i)) d = { x: 0, y: 1 };
        if (i.tap) { const [px, py] = pos(pac); const dx = i.x - (OX + px * T + T / 2), dy = i.y - (OY + py * T + T / 2); d = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }; }
        if (d) { want = d; if (pac.p > 0 && d.x === -pac.d.x && d.y === -pac.d.y && (d.x || d.y)) { pac.tx += pac.d.x; pac.ty += pac.d.y; pac.p = 1 - pac.p; pac.d = d; } }
        advance(pac, dt, 6, chosePac);
        if (dots[key(pac.tx, pac.ty)]) { dots[key(pac.tx, pac.ty)] = false; left_ -= 1; e.addScore(1); if (left_ <= 0) { level += 1; e.addScore(20); build(); return; } }
        for (const gh of ghosts) advance(gh, dt, 4.2 + level * 0.35, choseGhost);
        if (inv <= 0) for (const gh of ghosts) { const [gx, gy] = pos(gh), [px, py] = pos(pac); if (Math.hypot(gx - px, gy - py) < 0.65) { lives -= 1; if (lives <= 0) { e.over(); return; } pac = { tx: 1, ty: 1, p: 0, d: { x: 0, y: 0 } }; want = { x: 0, y: 0 }; ghosts.forEach((g2) => { g2.tx = g2.sx; g2.ty = g2.sy; g2.p = 0; g2.d = { x: -1, y: 0 }; }); inv = 1.5; break; } }
      },
      draw() {
        e.text("♥".repeat(Math.max(0, lives)), 20, 90, { size: 22, align: "left", color: "#ff5d73" });
        e.panel(OX - 4, OY - 4, TW * T + 8, TH * T + 8, 12, 0.5);
        for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) { const k = key(x, y); if (wall[k]) e.rect(OX + x * T + 1, OY + y * T + 1, T - 2, T - 2, "#3a5cff", 5); else if (dots[k]) e.circle(OX + x * T + T / 2, OY + y * T + T / 2, 2.5, "#ffe9a8"); }
        for (const gh of ghosts) { const [gx, gy] = pos(gh); e.emoji("👻", OX + gx * T + T / 2, OY + gy * T + T / 2, 22); }
        const [px, py] = pos(pac);
        if (inv <= 0 || Math.floor(inv * 8) % 2 === 0) { const a = Math.abs(Math.sin(mouth)) * 0.6, cx = OX + px * T + T / 2, cy = OY + py * T + T / 2, dir = Math.atan2(pac.d.y || (want.y && !pac.d.x ? want.y : 0), pac.d.x || (want.x && !pac.d.y ? want.x : (pac.d.y ? 0 : 1))); e.g.fillStyle = "#ffd23f"; e.g.beginPath(); e.g.moveTo(cx, cy); e.g.arc(cx, cy, T / 2 - 1, dir + a, dir + Math.PI * 2 - a); e.g.closePath(); e.g.fill(); }
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Tron */
  R({ id: "tron", name: "Lichtspur", emoji: "🏍️", cat: "Arcade", color: "#4cc9ff", hint: "Wische oder tippe links/rechts zum Abbiegen. Lauf nicht in Spuren oder Wände", create(e) {
    const C = 12, COLS = 28, ROWS = 40, OX = 12, OY = 110;
    let grid, me, ai, timer = 0, round = 0, msg = "", wait = 0, over = false;
    function fresh() { grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0)); me = { x: 6, y: 20, dx: 1, dy: 0 }; ai = { x: COLS - 7, y: 20, dx: -1, dy: 0 }; grid[me.y][me.x] = 1; grid[ai.y][ai.x] = 2; timer = 0; msg = ""; wait = 0.6; }
    fresh();
    const free = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && !grid[y][x];
    const turn = (p, side) => { const dx = side < 0 ? p.dy : -p.dy, dy = side < 0 ? -p.dx : p.dx; p.dx = dx; p.dy = dy; };
    function thinkAI() {
      const ahead = (n) => { let c = 0, x = ai.x, y = ai.y; while (c < n && free(x + ai.dx, y + ai.dy)) { x += ai.dx; y += ai.dy; c += 1; } return c; };
      const dist = ahead(6);
      if (dist < 4 || e.rand() < 0.04) {
        const l = { dx: ai.dy, dy: -ai.dx }, r = { dx: -ai.dy, dy: ai.dx };
        const open = (d) => { let c = 0, x = ai.x, y = ai.y; while (c < 12 && free(x + d.dx, y + d.dy)) { x += d.dx; y += d.dy; c += 1; } return c; };
        const options = [[l, open(l)], [r, open(r)]].sort((a, b) => b[1] - a[1]);
        if (options[0][1] > dist || dist < 2) { ai.dx = options[0][0].dx; ai.dy = options[0][0].dy; }
      }
    }
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0 && over) { e.over(); return; } if (wait <= 0 && msg) { round += 1; fresh(); } return; }
        if (left(i)) turn(me, -1); else if (right(i)) turn(me, 1);
        if (i.tap) turn(me, i.x < W / 2 ? -1 : 1);
        if (upK(i) && me.dy === 0) { me.dx = 0; me.dy = -1; } if (downK(i) && me.dy === 0) { me.dx = 0; me.dy = 1; }
        timer += dt;
        const every = Math.max(0.06, 0.12 - round * 0.01);
        if (timer < every) return;
        timer -= every;
        thinkAI();
        const nm = { x: me.x + me.dx, y: me.y + me.dy }, na = { x: ai.x + ai.dx, y: ai.y + ai.dy };
        const mDead = !free(nm.x, nm.y), aDead = !free(na.x, na.y) || (nm.x === na.x && nm.y === na.y);
        if (!mDead) { me.x = nm.x; me.y = nm.y; grid[me.y][me.x] = 1; }
        if (!aDead) { ai.x = na.x; ai.y = na.y; grid[ai.y][ai.x] = 2; }
        if (mDead && aDead) { msg = "Unentschieden"; e.addScore(2); wait = 1.1; }
        else if (aDead) { msg = "Gewonnen!"; e.addScore(10 + round * 2); wait = 1.1; }
        else if (mDead) { msg = "Verloren"; over = true; wait = 1.2; }
      },
      draw() {
        e.panel(OX - 4, OY - 4, COLS * C + 8, ROWS * C + 8, 10, 0.55, "0,10,30");
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (grid[y][x]) e.rect(OX + x * C, OY + y * C, C - 1, C - 1, grid[y][x] === 1 ? "#4cc9ff" : "#ff9f43", 2);
        e.circle(OX + me.x * C + C / 2, OY + me.y * C + C / 2, 6, "#fff"); e.circle(OX + ai.x * C + C / 2, OY + ai.y * C + C / 2, 6, "#fff");
        e.text(msg || `Runde ${round + 1}`, W / 2, 70, { size: 26 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Wordle */
  const FIVE = ["APFEL", "BIRNE", "BLUME", "BRIEF", "BAUCH", "BERGE", "BLATT", "BLITZ", "BRAUN", "BRUST", "DANKE", "DECKE", "ENGEL", "FERNE", "FEUER", "FILME", "FLUSS", "FRAGE", "GABEL", "GEIST", "GRUND", "HAFEN",
    "HEUTE", "HONIG", "HUNDE", "INSEL", "JAHRE", "KATZE", "KERZE", "KLEID", "KRAFT", "KREIS", "LAMPE", "LEBEN", "LICHT", "LINSE", "MAGEN", "MILCH", "MUSIK", "NACHT", "NADEL", "NEBEL", "OTTER", "PILZE", "PUNKT",
    "RADIO", "REGEN", "REISE", "ROSEN", "SCHAF", "SEIDE", "SONNE", "SPIEL", "STEIN", "STERN", "STIFT", "STROM", "STUHL", "TASSE", "TIGER", "TISCH", "TRAUM", "VOGEL", "WELLE", "WOLKE", "WURST", "ZEBRA", "ZIEGE",
    "ZUNGE", "ZWERG", "FARBE", "KRONE", "MAUER", "PFERD", "RUHIG", "SCHUH", "WIESE"].filter((w) => w.length === 5);
  R({ id: "wordle", name: "Wörter raten", emoji: "🔡", cat: "Denken", color: "#6bd45f", hint: "Errate das Wort mit fünf Buchstaben in sechs Versuchen. Grün = richtiger Platz, gelb = falscher Platz", create(e) {
    const ROWS_ = ["QWERTZUIOP", "ASDFGHJKL", "YXCVBNM"];
    let word, guesses, cur, states, msg, wait = 0, solved = 0, order = e.shuffle(FIVE.map((_, k) => k)), at = 0, lost = false;
    function fresh() { word = FIVE[order[at % order.length]]; at += 1; guesses = []; cur = ""; states = {}; msg = ""; }
    fresh();
    function rate(g) { const res = Array(5).fill("x"), used = Array(5).fill(false); for (let k = 0; k < 5; k++) if (g[k] === word[k]) { res[k] = "g"; used[k] = true; } for (let k = 0; k < 5; k++) if (res[k] !== "g") { const j = word.split("").findIndex((c, n) => c === g[k] && !used[n] && res[n] !== "g"); if (j >= 0) { res[k] = "y"; used[j] = true; } } return res; }
    function submit() {
      if (cur.length < 5) { msg = "Fünf Buchstaben"; return; }
      const r = rate(cur); guesses.push({ g: cur, r });
      r.forEach((s, k) => { const ch = cur[k]; const old = states[ch]; if (s === "g" || (s === "y" && old !== "g") || (s === "x" && !old)) states[ch] = s; });
      if (cur === word) { solved += 1; e.addScore(Math.max(5, 30 - guesses.length * 4)); msg = "Richtig!"; wait = 1.1; }
      else if (guesses.length >= 6) { msg = word; lost = true; wait = 1.8; }
      cur = "";
    }
    const keyRect = (r, k) => { const n = ROWS_[r].length, w = 32, gap = 4, x0 = (W - (n * w + (n - 1) * gap)) / 2; return [x0 + k * (w + gap), 450 + r * 50, w, 44]; };
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (lost) e.over(); else fresh(); } return; }
        const type = (c) => { if (cur.length < 5) cur += c; msg = ""; };
        if (i.pressed) {
          ROWS_.forEach((row, r) => [...row].forEach((c, k) => { const [x, y, w, h] = keyRect(r, k); if (e.inside(i.x, i.y, x, y, w, h)) type(c); }));
          if (e.inside(i.x, i.y, 20, 600, 100, 36) && cur.length) cur = cur.slice(0, -1);
          if (e.inside(i.x, i.y, 240, 600, 100, 36)) submit();
        }
        for (const c of "abcdefghijklmnopqrstuvwxyz") if (i.keyPressed(c)) type(c.toUpperCase());
        if (i.keyPressed("Backspace") && cur.length) cur = cur.slice(0, -1);
        if (i.keyPressed("Enter")) submit();
      },
      draw() {
        e.text(msg || `Gelöst: ${solved}`, W / 2, 80, { size: 24 });
        const COLORS = { g: "#3fb950", y: "#d4a72c", x: "rgba(70,70,80,0.9)" };
        for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
          const x = 50 + c * 52, y = 105 + r * 52, row = guesses[r];
          const ch = row ? row.g[c] : r === guesses.length ? cur[c] : "";
          e.rect(x, y, 46, 46, row ? COLORS[row.r[c]] : "rgba(255,255,255,0.14)", 8);
          if (ch) e.text(ch, x + 23, y + 24, { size: 26 });
        }
        ROWS_.forEach((row, r) => [...row].forEach((c, k) => { const [x, y, w, h] = keyRect(r, k); e.rect(x, y, w, h, states[c] ? COLORS[states[c]] : "rgba(255,255,255,0.88)", 8); e.text(c, x + w / 2, y + h / 2, { size: 18, color: states[c] ? "#fff" : "#111", stroke: !!states[c] }); }));
        e.button("⌫", 20, 600, 100, 36, { size: 18 }); e.button("Enter", 240, 600, 100, 36, { size: 16 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Sokoban */
  const SOKOBAN = [["#####", "#@$.#", "#####"], ["#######", "#@  $.#", "#  #  #", "#######"], [" ####", "##  ##", "#  $ #", "# .#@#", "#    #", "######"], ["######", "#    #", "# $$ #", "# .. #", "#  @ #", "######"],
    ["#######", "#     #", "# .$. #", "#  $  #", "# .$@ #", "#     #", "#######"], ["#######", "#  .  #", "# $$$ #", "#  @  #", "# ... #", "#     #", "#######"],
    ["#######", "#.  # #", "#   $ #", "# #$  #", "# . @ #", "#######"], ["########", "#      #", "# .**$@#", "#      #", "#####  #", "    ####"]];
  window.PulseGames.sokoban = SOKOBAN;
  R({ id: "sokoban", name: "Kisten schieben", emoji: "📦", cat: "Denken", color: "#c49a6c", hint: "Schiebe alle Kisten auf die Zielpunkte. Du kannst nur schieben, nicht ziehen", create(e) {
    let level = 0, map, goals, boxes, floor, px, py, moves = 0, history = [], done = 0;
    function load() {
      const rows = SOKOBAN[level % SOKOBAN.length]; map = rows.map((r) => r.split("")); goals = new Set(); boxes = new Set(); floor = new Set();
      rows.forEach((row, y) => [...row].forEach((c, x) => { if (c === "." || c === "*" || c === "+") goals.add(y * 10 + x); if (c === "$" || c === "*") boxes.add(y * 10 + x); if (c === "@" || c === "+") { px = x; py = y; } }));
      const stack = [[px, py]]; floor.add(py * 10 + px);                          // the floor is everything the player can walk to (the rest outside the walls stays empty)
      while (stack.length) { const [x, y] = stack.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (map[ny] && map[ny][nx] !== undefined && map[ny][nx] !== "#" && !floor.has(ny * 10 + nx)) { floor.add(ny * 10 + nx); stack.push([nx, ny]); } } }
      moves = 0; history = [];
    }
    load();
    const blocked = (x, y) => !floor.has(y * 10 + x);
    function move(dx, dy) {
      const nx = px + dx, ny = py + dy;
      if (blocked(nx, ny)) return;
      const k = ny * 10 + nx;
      const snapshot = { px, py, boxes: new Set(boxes) };
      if (boxes.has(k)) { const bx = nx + dx, by = ny + dy, bk = by * 10 + bx; if (blocked(bx, by) || boxes.has(bk)) return; boxes.delete(k); boxes.add(bk); }
      history.push(snapshot); px = nx; py = ny; moves += 1;
      if ([...boxes].every((b) => goals.has(b))) { done += 1; e.addScore(10 + Math.max(0, 30 - Math.floor(moves / 3))); level += 1; load(); }
    }
    const undo = () => { const s = history.pop(); if (s) { px = s.px; py = s.py; boxes = s.boxes; moves = Math.max(0, moves - 1); } };
    const cell = () => { const rows = SOKOBAN[level % SOKOBAN.length]; const w = Math.max(...rows.map((r) => r.length)), h = rows.length; const s = Math.min(48, Math.floor(320 / w), Math.floor(380 / h)); return { s, ox: (W - w * s) / 2, oy: 150 + (380 - h * s) / 2 }; };
    return {
      update() {
        const i = e.input;
        if (left(i)) move(-1, 0); else if (right(i)) move(1, 0); else if (upK(i)) move(0, -1); else if (downK(i)) move(0, 1);
        else if (i.tap) {
          if (e.inside(i.x, i.y, 40, 570, 130, 44)) { undo(); return; }
          if (e.inside(i.x, i.y, 190, 570, 130, 44)) { load(); return; }
          const { s, ox, oy } = cell(); const dx = i.x - (ox + px * s + s / 2), dy = i.y - (oy + py * s + s / 2);
          if (Math.hypot(dx, dy) > s * 0.4) { if (Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx), 0); else move(0, Math.sign(dy)); }
        }
        if (i.keyPressed("z") || i.keyPressed("u")) undo(); if (i.keyPressed("r")) load();
      },
      draw() {
        e.text(`Stufe ${level % SOKOBAN.length + 1} · Züge ${moves}`, W / 2, 100, { size: 22 });
        const { s, ox, oy } = cell();
        map.forEach((row, y) => row.forEach((c, x) => {
          const k = y * 10 + x, X = ox + x * s, Y = oy + y * s;
          if (c === "#") e.rect(X, Y, s, s, "#7a5230", 6);
          else if (floor.has(k)) e.rect(X + 1, Y + 1, s - 2, s - 2, "rgba(255,255,255,0.14)", 6);
          if (goals.has(k)) e.circle(X + s / 2, Y + s / 2, s * 0.14, "#ffe66d");
          if (boxes.has(k)) e.rect(X + 4, Y + 4, s - 8, s - 8, goals.has(k) ? "#6bd45f" : "#e8a05c", 8);
        }));
        e.emoji("🧑", ox + px * s + s / 2, oy + py * s + s / 2, s * 0.75);
        e.button("↶ Zurück", 40, 570, 130, 44, { size: 18 }); e.button("Neustart", 190, 570, 130, 44, { size: 18 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Cookie Clicker */
  R({ id: "cookie-clicker", name: "Keks-Klicker", emoji: "🍪", cat: "Reaktion", color: "#c49a6c", hint: "Tippe den Keks und kauf Verbesserungen: so viele Kekse wie möglich in 30 Sekunden", create(e) {
    let cookies = 0, total = 0, per = 1, auto = 0, time = 30, pulse = 0, bumps = [], buys = { click: 0, cursor: 0, grandma: 0 };
    const price = { click: () => 25 * 2 ** buys.click, cursor: () => 15 * 1.5 ** buys.cursor | 0, grandma: () => 120 * 1.6 ** buys.grandma | 0 };
    const items = [["click", "Doppelklick", "+1 pro Tipp", () => { per += 1; }], ["cursor", "Zeiger", "+1 pro Sekunde", () => { auto += 1; }], ["grandma", "Oma", "+6 pro Sekunde", () => { auto += 6; }]];
    return {
      update(dt) {
        const i = e.input; time -= dt; pulse = Math.max(0, pulse - dt * 6);
        if (time <= 0) { e.over(); return; }
        cookies += auto * dt; total += auto * dt; e.score(total);
        for (const b of bumps) b.t -= dt; bumps = bumps.filter((b) => b.t > 0);
        if (i.pressed) {
          if (e.dist(i.x, i.y, W / 2, 240) < 110) { cookies += per; total += per; pulse = 1; bumps.push({ x: i.x + e.rand(-20, 20), y: i.y, t: 0.5, v: per }); e.score(total); }
          items.forEach(([id, , , fn], k) => { if (e.inside(i.x, i.y, 20, 420 + k * 66, W - 40, 58) && cookies >= price[id]()) { cookies -= price[id](); buys[id] += 1; fn(); } });
        }
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(1)} s`, W / 2, 80, { size: 26 });
        e.text(`${Math.floor(cookies)} Kekse`, W / 2, 125, { size: 34 });
        e.text(auto ? `${auto} pro Sekunde` : "Tippe den Keks!", W / 2, 158, { size: 16, weight: 700 });
        e.emoji("🍪", W / 2, 240, 190 + pulse * 18);
        for (const b of bumps) e.text(`+${b.v}`, b.x, b.y - (0.5 - b.t) * 80, { size: 22, color: "#ffe66d" });
        items.forEach(([id, name, desc], k) => { const ok = cookies >= price[id](); e.rect(20, 420 + k * 66, W - 40, 58, ok ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)", 16); e.text(name, 36, 438 + k * 66, { size: 20, align: "left", color: ok ? "#111" : "#eee", stroke: false }); e.text(desc, 36, 460 + k * 66, { size: 14, align: "left", color: ok ? "#555" : "#ddd", stroke: false, weight: 600 }); e.text(`${price[id]()} 🍪`, W - 36, 449 + k * 66, { size: 20, align: "right", color: ok ? "#111" : "#eee", stroke: false }); });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Asteroids */
  R({ id: "asteroids", name: "Asteroiden", emoji: "☄️", cat: "Arcade", color: "#8a5cff", hint: "Halte den Finger gedrückt: das Schiff dreht sich dorthin und fliegt. Es schießt von selbst", create(e) {
    let ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0 }, shots = [], rocks = [], fire = 0, lives = 3, inv = 2, wave = 0, bits = [];
    const spawn = () => { wave += 1; for (let k = 0; k < 2 + wave; k++) { const edge = e.randInt(0, 3); rocks.push({ x: edge < 2 ? (edge ? W : 0) : e.rand(0, W), y: edge >= 2 ? (edge === 2 ? 0 : H) : e.rand(0, H), vx: e.rand(-50, 50), vy: e.rand(-50, 50), size: 3, spin: e.rand(-1, 1), a: 0 }); } };
    spawn();
    const radius = (s) => s * 11;
    const wrap = (o) => { if (o.x < -20) o.x = W + 20; if (o.x > W + 20) o.x = -20; if (o.y < -20) o.y = H + 20; if (o.y > H + 20) o.y = -20; };
    return {
      update(dt) {
        const i = e.input; inv = Math.max(0, inv - dt);
        let thrust = false, target = null;
        if (i.down) { target = Math.atan2(i.y - ship.y, i.x - ship.x); thrust = true; }
        if (i.keys.has("ArrowLeft")) ship.a -= 3.5 * dt; if (i.keys.has("ArrowRight")) ship.a += 3.5 * dt; if (i.keys.has("ArrowUp")) thrust = true;
        if (target !== null) { let d = target - ship.a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; ship.a += e.clamp(d, -4.5 * dt, 4.5 * dt); }
        if (thrust) { ship.vx += Math.cos(ship.a) * 160 * dt; ship.vy += Math.sin(ship.a) * 160 * dt; }
        ship.vx *= 0.995; ship.vy *= 0.995; const sp = Math.hypot(ship.vx, ship.vy); if (sp > 220) { ship.vx *= 220 / sp; ship.vy *= 220 / sp; }
        ship.x += ship.vx * dt; ship.y += ship.vy * dt; wrap(ship);
        fire -= dt; if (fire <= 0) { fire = 0.28; shots.push({ x: ship.x + Math.cos(ship.a) * 14, y: ship.y + Math.sin(ship.a) * 14, vx: Math.cos(ship.a) * 420 + ship.vx * 0.3, vy: Math.sin(ship.a) * 420 + ship.vy * 0.3, life: 1.1 }); }
        for (const s of shots) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; wrap(s); }
        for (const r of rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.a += r.spin * dt; wrap(r); }
        for (const r of rocks) for (const s of shots) if (!s.dead && !r.dead && e.dist(r.x, r.y, s.x, s.y) < radius(r.size)) {
          s.dead = true; r.dead = true; e.addScore(r.size === 3 ? 2 : r.size === 2 ? 4 : 8);
          bits.push({ x: r.x, y: r.y, t: 0.3 });
          if (r.size > 1) for (let k = 0; k < 2; k++) rocks.push({ x: r.x, y: r.y, vx: r.vx + e.rand(-70, 70), vy: r.vy + e.rand(-70, 70), size: r.size - 1, spin: e.rand(-2, 2), a: 0 });
        }
        if (inv <= 0) for (const r of rocks) if (!r.dead && e.dist(r.x, r.y, ship.x, ship.y) < radius(r.size) + 8) { r.dead = true; lives -= 1; inv = 2; ship = { x: W / 2, y: H / 2, a: -Math.PI / 2, vx: 0, vy: 0 }; if (lives <= 0) e.over(); break; }
        rocks = rocks.filter((r) => !r.dead); shots = shots.filter((s) => !s.dead && s.life > 0);
        for (const b of bits) b.t -= dt; bits = bits.filter((b) => b.t > 0);
        if (!rocks.length) spawn();
      },
      draw() {
        for (const r of rocks) { e.emoji("☄️", r.x, r.y, radius(r.size) * 2.1, r.a); }
        for (const s of shots) e.circle(s.x, s.y, 3, "#fff");
        for (const b of bits) e.circle(b.x, b.y, 30 * (1 - b.t / 0.3) + 6, null, "#ffb347", 3);
        if (inv <= 0 || Math.floor(inv * 10) % 2 === 0) { e.g.save(); e.g.translate(ship.x, ship.y); e.g.rotate(ship.a); e.g.fillStyle = "#fff"; e.g.strokeStyle = "#4cc9ff"; e.g.lineWidth = 3; e.g.beginPath(); e.g.moveTo(16, 0); e.g.lineTo(-11, -10); e.g.lineTo(-6, 0); e.g.lineTo(-11, 10); e.g.closePath(); e.g.fill(); e.g.stroke(); e.g.restore(); }
        e.text("♥".repeat(Math.max(0, lives)), 20, 60, { size: 22, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Squash */
  R({ id: "squash", name: "Squash", emoji: "🎾", cat: "Arcade", color: "#d4e157", hint: "Schlag den Ball mit dem Schläger zurück an die Wände: wie lange hältst du durch?", create(e) {
    const PW = 80;
    let px = W / 2, ball = { x: W / 2, y: 200, vx: 140, vy: 220 }, hits = 0;
    return {
      update(dt) {
        const i = e.input;
        if (i.down) px += (i.x - px) * Math.min(1, dt * 20);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) px -= 420 * dt; if (i.keys.has("ArrowRight") || i.keys.has("d")) px += 420 * dt;
        px = e.clamp(px, PW / 2, W - PW / 2);
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.x < 10) { ball.x = 10; ball.vx = Math.abs(ball.vx); } if (ball.x > W - 10) { ball.x = W - 10; ball.vx = -Math.abs(ball.vx); } if (ball.y < 70) { ball.y = 70; ball.vy = Math.abs(ball.vy); }
        if (ball.vy > 0 && ball.y > 566 && ball.y < 590 && Math.abs(ball.x - px) < PW / 2 + 10) { hits += 1; e.score(hits); const sp = Math.min(640, Math.hypot(ball.vx, ball.vy) * 1.035); const off = (ball.x - px) / (PW / 2); ball.vx = Math.sin(off * 1.0) * sp; ball.vy = -Math.sqrt(Math.max(1, sp * sp - ball.vx * ball.vx)); ball.y = 566; }
        if (ball.y > H + 20) e.over();
      },
      draw() { e.line(8, 70, 8, H, "rgba(255,255,255,0.7)", 4); e.line(W - 8, 70, W - 8, H, "rgba(255,255,255,0.7)", 4); e.line(8, 70, W - 8, 70, "rgba(255,255,255,0.7)", 4); e.rect(px - PW / 2, 572, PW, 12, "#fff", 6); e.emoji("🎾", ball.x, ball.y, 28); e.text(String(hits), W / 2, 40, { size: 32 }); },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Lunar Lander */
  R({ id: "lander", name: "Mondlandung", emoji: "🛰️", cat: "Geschick", color: "#9aa4b2", hint: "Finger halten: Schub. Der Finger links oder rechts vom Schiff lenkt. Lande sanft auf dem Feld", create(e) {
    const GROUND = 560;
    let x, y, vx, vy, fuel, pad, level = 0, state = "fly", wait = 0, msg = "";
    function reset() { x = e.rand(60, W - 60); y = 100; vx = e.rand(-30, 30); vy = 0; fuel = 100; pad = { x: e.rand(50, W - 50 - Math.max(46, 90 - level * 8)), w: Math.max(46, 90 - level * 8) }; state = "fly"; msg = ""; }
    reset();
    return {
      update(dt) {
        const i = e.input;
        if (state !== "fly") { wait -= dt; if (wait <= 0) { if (state === "crash") e.over(); else reset(); } return; }
        const g = 70 + level * 8;
        vy += g * dt;
        const thrust = (i.down || i.keys.has(" ") || i.keys.has("ArrowUp")) && fuel > 0;
        if (thrust) { vy -= 180 * dt; fuel -= 22 * dt; if (i.down) { if (i.x < x - 18) vx -= 80 * dt; else if (i.x > x + 18) vx += 80 * dt; } }
        if (i.keys.has("ArrowLeft") && fuel > 0) { vx -= 80 * dt; fuel -= 8 * dt; } if (i.keys.has("ArrowRight") && fuel > 0) { vx += 80 * dt; fuel -= 8 * dt; }
        x += vx * dt; y += vy * dt;
        if (x < 10) { x = 10; vx = Math.abs(vx) * 0.4; } if (x > W - 10) { x = W - 10; vx = -Math.abs(vx) * 0.4; } if (y < 60) { y = 60; vy = Math.max(0, vy); }
        if (y >= GROUND - 12) {
          const onPad = x > pad.x && x < pad.x + pad.w;
          if (onPad && Math.abs(vy) < 60 && Math.abs(vx) < 40) { level += 1; e.addScore(10 + Math.round(fuel / 5)); state = "land"; msg = "Gelandet!"; wait = 1.2; y = GROUND - 12; }
          else { state = "crash"; msg = onPad ? "Zu schnell!" : "Daneben!"; wait = 1.4; y = GROUND - 12; }
        }
      },
      draw() {
        e.rect(0, GROUND, W, H - GROUND, "rgba(150,150,160,0.85)"); e.rect(pad.x, GROUND - 4, pad.w, 8, "#3ddc84", 3);
        e.emoji(state === "crash" ? "💥" : "🛰️", x, y, 34);
        if (state === "fly" && (e.input.down) && fuel > 0) e.emoji("🔥", x, y + 24, 20);
        e.rect(20, 70, 120, 10, "rgba(0,0,0,0.5)", 5); e.rect(20, 70, 120 * Math.max(0, fuel / 100), 10, fuel < 25 ? "#ff7a7a" : "#ffe66d", 5);
        e.text(`Tempo ${Math.round(Math.abs(vy))} / ${Math.round(Math.abs(vx))}`, W - 20, 76, { size: 14, align: "right", weight: 700, color: Math.abs(vy) < 60 && Math.abs(vx) < 40 ? "#9dff7a" : "#fff" });
        if (msg) e.text(msg, W / 2, 300, { size: 34 });
      },
    };
  } });
})();
