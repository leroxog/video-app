/* Pulse games: reflexes and tapping (pg-reflex.js): Reaction Test, Speed Tap, Tap Tiles, Stroop, Target Practice, Simon, Green Light, Beat Tap, Quick Draw,
   Follow the Dot, Odd Colour, Tap Count, Shape Match and Pop It. Every game is registered in the kit (pg-kit.js); the field is 360 x 640. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const tapped = (i) => i.pressed || i.keyPressed(" ") || i.keyPressed("Enter");

  /* ------------------------------------------------------------------------------------------------ Reaction Test */
  R({ id: "reaction-test", name: "Reaktionstest", emoji: "⚡", cat: "Reaktion", color: "#3ddc84", hint: "Tippe, sobald der Bildschirm grün wird. Nicht vorher!", create(e) {
    const ROUNDS = 5;
    let phase = "wait", wait = e.rand(1.5, 4), ms = 0, round = 0, points = 0, show = 0, msg = "Warte auf Grün …";
    return {
      update(dt) {
        const i = e.input;
        if (phase === "wait") {
          wait -= dt;
          if (tapped(i)) { phase = "result"; show = 1.2; msg = "Zu früh!"; round += 1; }
          else if (wait <= 0) { phase = "go"; ms = 0; msg = "JETZT!"; }
        } else if (phase === "go") {
          ms += dt * 1000;
          if (tapped(i)) { phase = "result"; show = 1.2; points += Math.max(0, Math.round((600 - ms) / 6)); e.score(points); msg = `${Math.round(ms)} ms`; round += 1; }
          else if (ms > 2000) { phase = "result"; show = 1; msg = "Zu langsam"; round += 1; }
        } else {
          show -= dt;
          if (show <= 0) { if (round >= ROUNDS) e.over(); else { phase = "wait"; wait = e.rand(1.5, 4); msg = "Warte auf Grün …"; } }
        }
      },
      draw() {
        const colors = { wait: "200,50,60", go: "40,190,90", result: "60,110,220" };
        e.panel(30, 140, W - 60, 360, 28, 0.62, colors[phase]);
        e.text(msg, W / 2, 320, { size: 30 });
        e.text(`Runde ${Math.min(round + (phase === "result" ? 0 : 1), ROUNDS)} von ${ROUNDS}`, W / 2, 110, { size: 22 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Speed Tap */
  R({ id: "speed-tap", name: "Speed Tap", emoji: "👆", cat: "Reaktion", color: "#ff9f43", hint: "Tippe so schnell du kannst, zehn Sekunden lang", create(e) {
    let taps = 0, time = 10, started = false, idle = 5, pulse = 0;
    return {
      update(dt) {
        const i = e.input;
        pulse = Math.max(0, pulse - dt * 6);
        if (!started) { idle -= dt; if (idle <= 0) e.over(); }
        if (tapped(i)) { if (!started) started = true; taps += 1; pulse = 1; e.score(taps); }
        if (started) { time -= dt; if (time <= 0) e.over(); }
      },
      draw() {
        e.text(started ? `${Math.max(0, time).toFixed(1)} s` : "Tippe zum Start", W / 2, 120, { size: 32 });
        e.circle(W / 2, 340, 110 + pulse * 14, "rgba(255,159,67,0.85)", "#fff", 6);
        e.text(String(taps), W / 2, 340, { size: 72 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Tap Tiles */
  R({ id: "tap-tiles", name: "Tap Tiles", emoji: "🎹", cat: "Reaktion", color: "#444", hint: "Tippe nur die schwarzen Felder, von unten nach oben", create(e) {
    const TH = 140;
    let rows = [], speed = 240, points = 0, next = 0;
    for (let k = 0; k < 6; k++) rows.push({ y: H - 160 - k * TH, col: e.randInt(0, 3), done: false });
    return {
      update(dt) {
        const i = e.input;
        speed = Math.min(620, 240 + points * 6);
        for (const r of rows) r.y += speed * dt;
        while (rows[rows.length - 1].y > -TH) rows.push({ y: rows[rows.length - 1].y - TH, col: e.randInt(0, 3), done: false });
        if (i.pressed) {
          const col = Math.floor(i.x / 90);
          const low = rows.filter((r) => !r.done).sort((a, b) => b.y - a.y)[0];
          if (low && col === low.col && i.y >= low.y && i.y <= low.y + TH + 40) { low.done = true; points += 1; e.score(points); } else e.over();
        }
        for (const r of rows) if (!r.done && r.y > H - 20) e.over();
        rows = rows.filter((r) => r.y < H + TH);
      },
      draw() {
        for (const r of rows) {
          for (let c = 0; c < 4; c++) e.rect(c * 90 + 2, r.y + 2, 86, TH - 4, c === r.col ? (r.done ? "rgba(120,120,120,0.35)" : "#111") : "rgba(255,255,255,0.78)", 6);
        }
        e.text(String(points), W / 2, 60, { size: 40 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Stroop */
  R({ id: "stroop", name: "Farb-Chaos", emoji: "🎨", cat: "Reaktion", color: "#b46bff", hint: "Tippe die FARBE der Schrift, nicht das Wort", create(e) {
    const NAMES = ["ROT", "BLAU", "GRÜN", "GELB"], INK = ["#ff4d5e", "#4d8dff", "#3ddc84", "#ffd23f"];
    let word = 0, ink = 0, time = 3, lives = 3, points = 0, flash = 0;
    const ask = () => { word = e.randInt(0, 3); ink = e.rand() < 0.75 ? (word + e.randInt(1, 3)) % 4 : word; time = Math.max(1.2, 3 - points * 0.06); };
    ask();
    return {
      update(dt) {
        const i = e.input;
        flash = Math.max(0, flash - dt);
        time -= dt;
        if (time <= 0) { lives -= 1; flash = 0.3; if (lives <= 0) e.over(); else ask(); }
        if (i.pressed) for (let k = 0; k < 4; k++) if (e.inside(i.x, i.y, 30 + (k % 2) * 155, 380 + Math.floor(k / 2) * 90, 145, 78)) {
          if (k === ink) { points += 1; e.score(points); ask(); } else { lives -= 1; flash = 0.3; if (lives <= 0) e.over(); else ask(); }
        }
        const key = ["1", "2", "3", "4"].findIndex((c) => i.keyPressed(c));
        if (key >= 0) { if (key === ink) { points += 1; e.score(points); ask(); } else { lives -= 1; if (lives <= 0) e.over(); else ask(); } }
      },
      draw() {
        e.panel(30, 150, W - 60, 190, 26, flash > 0 ? 0.75 : 0.55, flash > 0 ? "160,30,40" : "0,0,0");
        e.text(NAMES[word], W / 2, 245, { size: 76, color: INK[ink] });
        e.rect(30, 140, (W - 60) * Math.max(0, time / Math.max(1.2, 3 - points * 0.06)), 8, "#fff", 4);
        for (let k = 0; k < 4; k++) e.button(NAMES[k], 30 + (k % 2) * 155, 380 + Math.floor(k / 2) * 90, 145, 78, { size: 26 });
        e.text("♥".repeat(lives), 20, 70, { size: 22, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Target Practice */
  R({ id: "target-practice", name: "Zielscheiben", emoji: "🎯", cat: "Reaktion", color: "#ff5d5d", hint: "Tippe die Zielscheiben, bevor sie schrumpfen und verschwinden", create(e) {
    let targets = [], spawn = 0.3, lives = 3, t = 0, hits = [];
    return {
      update(dt) {
        const i = e.input; t += dt;
        spawn -= dt;
        if (spawn <= 0) { spawn = Math.max(0.35, 0.95 - t * 0.012); targets.push({ x: e.rand(50, W - 50), y: e.rand(140, H - 120), r: 42, life: Math.max(0.9, 2.1 - t * 0.02), max: 0 }); targets[targets.length - 1].max = targets[targets.length - 1].life; }
        for (const g of targets) { g.life -= dt; g.r = 14 + 30 * Math.max(0, g.life / g.max); if (g.life <= 0 && !g.dead) { g.dead = true; lives -= 1; if (lives <= 0) e.over(); } }
        if (i.pressed) { for (let k = targets.length - 1; k >= 0; k--) { const g = targets[k]; if (!g.dead && e.dist(i.x, i.y, g.x, g.y) < g.r + 12) { g.dead = true; const bull = e.dist(i.x, i.y, g.x, g.y) < g.r * 0.35; e.addScore(bull ? 3 : 1); hits.push({ x: g.x, y: g.y, t: 0.5, txt: bull ? "+3" : "+1" }); break; } } }
        for (const h of hits) h.t -= dt; hits = hits.filter((h) => h.t > 0);
        targets = targets.filter((g) => !g.dead);
      },
      draw() {
        for (const g of targets) { e.circle(g.x, g.y, g.r, "#fff", "#e0334a", 4); e.circle(g.x, g.y, g.r * 0.66, "#e0334a"); e.circle(g.x, g.y, g.r * 0.33, "#fff"); }
        for (const h of hits) e.text(h.txt, h.x, h.y - (0.5 - h.t) * 60, { size: 24, color: "#ffe66d" });
        e.text("♥".repeat(Math.max(0, lives)), 20, 100, { size: 22, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Simon */
  R({ id: "simon", name: "Simon sagt", emoji: "🔴", cat: "Reaktion", color: "#4d8dff", hint: "Merk dir die Reihenfolge der Farben und tippe sie nach", create(e) {
    const COLORS = ["#ff4d5e", "#4d8dff", "#3ddc84", "#ffd23f"];
    const pads = [[40, 180], [190, 180], [40, 330], [190, 330]];
    let seq = [e.randInt(0, 3)], phase = "show", idx = 0, timer = 0.8, lit = -1, litT = 0, rounds = 0;
    return {
      update(dt) {
        const i = e.input;
        litT = Math.max(0, litT - dt); if (litT === 0) lit = -1;
        if (phase === "show") {
          timer -= dt;
          if (timer <= 0) { if (idx < seq.length) { lit = seq[idx]; litT = 0.42; idx += 1; timer = 0.65; } else { phase = "input"; idx = 0; } }
        } else if (phase === "input") {
          let hit = -1;
          if (i.pressed) pads.forEach(([x, y], k) => { if (e.inside(i.x, i.y, x, y, 130, 130)) hit = k; });
          ["1", "2", "3", "4"].forEach((key, k) => { if (i.keyPressed(key)) hit = k; });
          if (hit >= 0) {
            lit = hit; litT = 0.25;
            if (hit !== seq[idx]) { phase = "dead"; e.over(); return; }
            idx += 1;
            if (idx >= seq.length) { rounds += 1; e.score(rounds); seq.push(e.randInt(0, 3)); phase = "show"; idx = 0; timer = 0.9; }
          }
        }
      },
      draw() {
        e.text(phase === "show" ? "Schau genau hin …" : phase === "input" ? "Du bist dran!" : "Falsch!", W / 2, 130, { size: 26 });
        pads.forEach(([x, y], k) => e.rect(x, y, 130, 130, COLORS[k], 28), 0);
        pads.forEach(([x, y], k) => { if (lit !== k) e.rect(x, y, 130, 130, "rgba(0,0,0,0.38)", 28); else e.rect(x - 4, y - 4, 138, 138, "rgba(255,255,255,0.35)", 32); });
        e.text(`Runde ${seq.length}`, W / 2, 520, { size: 22 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Green Light */
  R({ id: "green-light", name: "Rot-Grün-Licht", emoji: "🚦", cat: "Reaktion", color: "#3ddc84", hint: "Halte gedrückt zum Rennen, bei Rot sofort loslassen!", create(e) {
    let light = "green", t = e.rand(1.5, 3), dist = 0, grace = 0, warn = 0;
    return {
      update(dt) {
        const i = e.input;
        const going = i.down || i.keys.has(" ") || i.keys.has("ArrowUp");
        t -= dt;
        if (light === "green" && t <= 0.6 && warn === 0) warn = 1;
        if (t <= 0) {
          if (light === "green") { light = "red"; t = e.rand(1.2, 2.6); grace = 0.28; } else { light = "green"; t = e.rand(1.4, 3.2) - Math.min(0.8, dist / 3000); warn = 0; }
        }
        if (light === "red") { grace -= dt; if (going && grace < 0) { e.over(); return; } }
        if (going) { dist += 160 * dt; e.score(dist / 8); }
      },
      draw() {
        e.circle(W / 2, 140, 44, light === "green" ? "#3ddc84" : "#4a2a2a", "#fff", 5);
        e.circle(W / 2, 250, 44, light === "red" ? "#ff4d5e" : "#4a2a2a", "#fff", 5);
        e.text(light === "green" ? (warn ? "Gleich Rot!" : "LOS!") : "STOPP!", W / 2, 340, { size: 34 });
        e.emoji("🏃", W / 2, 520 - ((dist * 1.2) % 24) * 0.0, 70);
        for (let k = 0; k < 8; k++) e.rect(W / 2 - 4, ((k * 90 + dist * 4) % 720) - 40 + 360, 8, 40, "rgba(255,255,255,0.55)");
        e.text("Halten = rennen", W / 2, 622, { size: 18 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Beat Tap */
  R({ id: "beat-tap", name: "Beat Tap", emoji: "🎵", cat: "Reaktion", color: "#ff6bb5", hint: "Tippe die Spur, wenn die Note auf der Linie ist", create(e) {
    const LINE = 520, colors = ["#ff5d73", "#4cc9ff", "#6bd45f", "#ffd23f"];
    let notes = [], spawn = 0.5, speed = 280, misses = 0, combo = 0, points = 0, say = "", sayT = 0, t = 0;
    const judge = (lane) => {
      let best = null;
      for (const n of notes) if (!n.dead && n.lane === lane && (!best || Math.abs(n.y - LINE) < Math.abs(best.y - LINE))) best = n;
      if (best && Math.abs(best.y - LINE) < 55) { best.dead = true; const perfect = Math.abs(best.y - LINE) < 20; combo += 1; points += (perfect ? 2 : 1) * (1 + Math.floor(combo / 10)); e.score(points); say = perfect ? "Perfekt!" : "Gut"; sayT = 0.4; }
      else { misses += 1; combo = 0; say = "Daneben"; sayT = 0.4; if (misses >= 5) e.over(); }
    };
    return {
      update(dt) {
        const i = e.input; t += dt; sayT -= dt; speed = Math.min(520, 280 + t * 4);
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.28, 0.62 - t * 0.006) * e.rand(0.8, 1.3); notes.push({ lane: e.randInt(0, 3), y: -30, dead: false }); }
        for (const n of notes) { n.y += speed * dt; if (!n.dead && n.y > LINE + 60) { n.dead = true; misses += 1; combo = 0; say = "Verpasst"; sayT = 0.4; if (misses >= 5) e.over(); } }
        if (i.pressed) judge(Math.max(0, Math.min(3, Math.floor(i.x / 90))));
        ["1", "2", "3", "4"].forEach((key, k) => { if (i.keyPressed(key)) judge(k); });
        ["a", "s", "d", "f"].forEach((key, k) => { if (i.keyPressed(key)) judge(k); });
        notes = notes.filter((n) => !n.dead);
      },
      draw() {
        for (let k = 0; k < 4; k++) e.rect(k * 90 + 4, 0, 82, H, "rgba(0,0,0,0.3)", 10);
        e.rect(0, LINE - 6, W, 12, "rgba(255,255,255,0.85)", 6);
        for (const n of notes) e.circle(n.lane * 90 + 45, n.y, 30, colors[n.lane], "#fff", 4);
        if (sayT > 0) e.text(say, W / 2, 420, { size: 34 });
        e.text(combo > 1 ? `${combo}er Serie` : "", W / 2, 90, { size: 24, color: "#ffe66d" });
        e.text("✕".repeat(misses), W - 20, 60, { size: 20, align: "right", color: "#ff7a7a" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Quick Draw */
  R({ id: "quick-draw", name: "Duell", emoji: "🤠", cat: "Reaktion", color: "#e8a05c", hint: "Tippe bei „ZIEH!“ schneller als dein Gegner. Nicht zu früh!", create(e) {
    let phase = "wait", t = e.rand(1.2, 3), ms = 0, wins = 0, ai = 650, text = "Warte …", show = 0;
    return {
      update(dt) {
        const i = e.input;
        if (phase === "wait") {
          t -= dt;
          if (tapped(i)) { phase = "lost"; text = "Zu früh geschossen!"; show = 1.3; }
          else if (t <= 0) { phase = "draw"; ms = 0; text = "ZIEH!"; }
        } else if (phase === "draw") {
          ms += dt * 1000;
          if (tapped(i)) { phase = "won"; wins += 1; e.score(wins); text = `Getroffen! ${Math.round(ms)} ms`; show = 1.1; ai = Math.max(260, ai - 40); }
          else if (ms >= ai) { phase = "lost"; text = "Zu langsam!"; show = 1.3; }
        } else {
          show -= dt;
          if (show <= 0) { if (phase === "lost") e.over(); else { phase = "wait"; t = e.rand(1.2, 3); text = "Warte …"; } }
        }
      },
      draw() {
        e.emoji("🤠", 90, 330, 100, 0, true); e.emoji(phase === "lost" ? "😎" : "🥸", 270, 330, 100);
        if (phase === "draw") e.emoji("💥", 180, 240, 80);
        e.text(text, W / 2, 180, { size: 34 });
        e.text(`Siege: ${wins}`, W / 2, 500, { size: 24 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Follow the Dot */
  R({ id: "follow-dot", name: "Folge dem Punkt", emoji: "🔵", cat: "Reaktion", color: "#4d8dff", hint: "Halte den Finger auf dem Punkt, auch wenn er wandert", create(e) {
    let x = W / 2, y = 320, tx = x, ty = y, away = 0, on = 0, t = 0;
    return {
      update(dt) {
        const i = e.input; t += dt;
        const speed = 90 + Math.min(260, t * 7);
        if (e.dist(x, y, tx, ty) < 6) { tx = e.rand(50, W - 50); ty = e.rand(130, H - 130); }
        const d = e.dist(x, y, tx, ty); x += ((tx - x) / d) * speed * dt; y += ((ty - y) / d) * speed * dt;
        const onDot = (i.down || i.pressed) && e.dist(i.x, i.y, x, y) < 40;
        if (onDot) { away = 0; on += dt; e.score(on * 10); } else { away += dt; if (away > 1.1) e.over(); }
      },
      draw() {
        e.circle(x, y, 34, "#4d8dff", "#fff", 5);
        e.circle(x, y, 10, "#fff");
        e.rect(30, 70, (W - 60) * Math.max(0, 1 - away / 1.1), 8, away > 0.5 ? "#ff7a7a" : "#9dff7a", 4);
        e.text("Auf dem Punkt bleiben", W / 2, 110, { size: 18 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Odd Colour */
  R({ id: "odd-color", name: "Andere Farbe", emoji: "🟪", cat: "Reaktion", color: "#9b6bff", hint: "Eine Kachel hat eine etwas andere Farbe: tippe sie (20 Sekunden)", create(e) {
    let time = 20, level = 0, hue = 0, odd = 0, n = 2, delta = 22, flash = 0, hit = 0;
    const next = () => { n = Math.min(7, 2 + Math.floor(level / 2)); hue = e.randInt(0, 359); odd = e.randInt(0, n * n - 1); delta = Math.max(4, 22 - level * 1.5); };
    next();
    return {
      update(dt) {
        const i = e.input; time -= dt; flash = Math.max(0, flash - dt);
        if (time <= 0) { e.over(); return; }
        if (i.pressed) {
          const size = 300 / n;
          const cx = Math.floor((i.x - 30) / size), cy = Math.floor((i.y - 190) / size);
          if (cx >= 0 && cy >= 0 && cx < n && cy < n) { if (cy * n + cx === odd) { level += 1; e.score(level); time = Math.min(25, time + 0.6); next(); } else { time -= 2; flash = 0.3; } }
        }
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(1)} s`, W / 2, 130, { size: 34, color: flash > 0 ? "#ff7a7a" : "#fff" });
        const size = 300 / n;
        for (let k = 0; k < n * n; k++) e.rect(30 + (k % n) * size + 2, 190 + Math.floor(k / n) * size + 2, size - 4, size - 4, `hsl(${hue},62%,${k === odd ? 50 + (level % 2 ? delta : -delta) : 50}%)`, 8);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Tap Count */
  R({ id: "tap-count", name: "Genau so oft", emoji: "🔢", cat: "Reaktion", color: "#ffb347", hint: "Tippe genau so oft, wie die Zahl sagt, bevor die Zeit abläuft", create(e) {
    let target = e.randInt(2, 5), count = 0, started = false, time = 3, rounds = 0, result = "", resT = 0;
    return {
      update(dt) {
        const i = e.input;
        if (resT > 0) { resT -= dt; if (resT <= 0) { if (result === "Falsch!") e.over(); else { target = e.randInt(2, Math.min(12, 4 + rounds)); count = 0; started = false; time = 3; result = ""; } } return; }
        if (tapped(i)) { if (!started) started = true; count += 1; }
        if (started) { time -= dt; if (time <= 0) { if (count === target) { rounds += 1; e.score(rounds); result = "Richtig!"; } else result = "Falsch!"; resT = 1.1; } }
      },
      draw() {
        e.text("Tippe genau", W / 2, 160, { size: 26 });
        e.text(String(target), W / 2, 270, { size: 110 });
        e.text("mal", W / 2, 350, { size: 26 });
        e.circle(W / 2, 470, 70, "rgba(255,179,71,0.85)", "#fff", 6);
        e.text(String(count), W / 2, 470, { size: 56 });
        if (started && resT <= 0) e.rect(40, 570, (W - 80) * Math.max(0, time / 3), 10, "#fff", 5);
        if (result) e.text(result, W / 2, 570, { size: 32, color: result === "Richtig!" ? "#9dff7a" : "#ff7a7a" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Shape Match */
  R({ id: "shape-match", name: "Finde das Gleiche", emoji: "🔍", cat: "Reaktion", color: "#59c9ff", hint: "Tippe das Bild, das oben gezeigt wird, bevor die Zeit abläuft", create(e) {
    const SET = ["🍎", "🍌", "🐶", "🐱", "🚗", "⚽", "🌵", "🎸", "🍕", "⭐", "🦊", "🐢", "🎈", "🚀", "🍩", "🌙"];
    let target = "", items = [], time = 3, points = 0;
    function round() {
      const pool = e.shuffle(SET).slice(0, Math.min(10, 5 + Math.floor(points / 4)));
      target = pool[0];
      items = pool.map((emoji, k) => ({ emoji, x: e.rand(40, W - 40), y: e.rand(220, 560), vx: e.rand(-40, 40) * (1 + points * 0.03), vy: e.rand(-40, 40) * (1 + points * 0.03) }));
      time = Math.max(1.4, 3.2 - points * 0.05);
    }
    round();
    return {
      update(dt) {
        const i = e.input; time -= dt;
        for (const it of items) { it.x += it.vx * dt; it.y += it.vy * dt; if (it.x < 30 || it.x > W - 30) it.vx *= -1; if (it.y < 200 || it.y > 580) it.vy *= -1; }
        if (time <= 0) { e.over(); return; }
        if (i.pressed) { const hit = items.find((it) => e.dist(i.x, i.y, it.x, it.y) < 30); if (hit) { if (hit.emoji === target) { points += 1; e.score(points); round(); } else e.over(); } }
      },
      draw() {
        e.panel(110, 80, 140, 100, 24, 0.55);
        e.emoji(target, W / 2, 130, 64);
        e.rect(40, 190, (W - 80) * Math.max(0, time / Math.max(1.4, 3.2 - points * 0.05)), 6, "#fff", 3);
        for (const it of items) e.emoji(it.emoji, it.x, it.y, 46);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Pop It */
  R({ id: "pop-it", name: "Pop It", emoji: "🫧", cat: "Reaktion", color: "#ff6bb5", hint: "Tippe oder wische über die Blasen: poppen, poppen, poppen (25 Sekunden)", create(e) {
    const COLS = 5, ROWS = 7, colors = ["#ff6bb5", "#ffb347", "#ffe66d", "#6bd45f", "#4cc9ff", "#b46bff", "#ff5d73"];
    let cells = Array.from({ length: COLS * ROWS }, () => false), time = 25, pops = 0, rounds = 0;
    const cell = (x, y) => { const cx = Math.floor((x - 24) / 62), cy = Math.floor((y - 150) / 62); return cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS ? cy * COLS + cx : -1; };
    return {
      update(dt) {
        const i = e.input; time -= dt;
        if (time <= 0) { e.over(); return; }
        if (i.down || i.pressed) { const k = cell(i.x, i.y); if (k >= 0 && !cells[k]) { cells[k] = true; pops += 1; e.score(pops); } }
        if (cells.every(Boolean)) { cells = cells.map(() => false); rounds += 1; time = Math.min(25, time + 4); }
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(1)} s`, W / 2, 110, { size: 30 });
        e.panel(14, 140, W - 28, ROWS * 62 + 20, 24, 0.4);
        cells.forEach((popped, k) => { const x = 24 + (k % COLS) * 62 + 31, y = 150 + Math.floor(k / COLS) * 62 + 31; e.circle(x, y, popped ? 20 : 26, popped ? "rgba(255,255,255,0.18)" : colors[(k + rounds) % colors.length], "rgba(255,255,255,0.85)", 3); if (!popped) e.circle(x - 8, y - 8, 5, "rgba(255,255,255,0.6)"); });
      },
    };
  } });
})();
