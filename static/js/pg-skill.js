/* Pulse games: skill and timing (pg-skill.js): Stop the Bar, Plinko, Basketball, Darts, Mini Golf, Archery, Bowling, Cannon, Keepy Uppy, Jump Rope, Faller,
   Swing and High Striker. Every game is registered in the kit (pg-kit.js); the field is 360 x 640. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const go = (i) => i.pressed || i.keyPressed(" ") || i.keyPressed("Enter");

  /* ------------------------------------------------------------------------------------------------ Stop the Bar */
  R({ id: "stop-bar", name: "Stopp den Balken", emoji: "🎚️", cat: "Geschick", color: "#3ddc84", hint: "Tippe, wenn der Balken im grünen Feld ist. Das Feld wird kleiner", create(e) {
    let x = 0, dir = 1, speed = 300, zone = 120, zx = 120, level = 0, flash = 0, hitText = "";
    const fresh = () => { zone = Math.max(22, 120 - level * 8); zx = e.rand(20, W - 20 - zone); speed = 260 + level * 40; };
    fresh();
    return {
      update(dt) {
        flash = Math.max(0, flash - dt);
        x += dir * speed * dt; if (x > W - 20) { x = W - 20; dir = -1; } if (x < 20) { x = 20; dir = 1; }
        if (go(e.input)) {
          if (x >= zx && x <= zx + zone) { level += 1; const perfect = Math.abs(x - (zx + zone / 2)) < zone * 0.15; e.addScore(perfect ? 3 : 1); hitText = perfect ? "Volltreffer!" : "Treffer!"; flash = 0.5; fresh(); } else e.over();
        }
      },
      draw() {
        e.text(hitText && flash > 0 ? hitText : "Tippe im grünen Feld", W / 2, 190, { size: 28 });
        e.rect(20, 300, W - 40, 40, "rgba(0,0,0,0.5)", 20); e.rect(zx, 300, zone, 40, "#3ddc84", 12);
        e.rect(x - 5, 285, 10, 70, "#fff", 5);
        e.text(`Stufe ${level + 1}`, W / 2, 440, { size: 22 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Plinko */
  R({ id: "plinko", name: "Plinko", emoji: "🔮", cat: "Geschick", color: "#b46bff", hint: "Tippe oben, wo die Kugel fallen soll. Sechs Kugeln: sammle Punkte!", create(e) {
    const pegs = []; for (let r = 0; r < 9; r++) for (let c = 0; c < (r % 2 ? 7 : 8); c++) pegs.push({ x: 28 + c * 44 + (r % 2 ? 22 : 0), y: 190 + r * 40 });
    const VAL = [50, 10, 5, 0, 0, 5, 10, 50];
    let balls = 6, ball = null, aim = W / 2, points = 0, msg = "", t = 0;
    return {
      update(dt) {
        const i = e.input; t += dt;
        if (!ball) {
          if (i.down || i.pressed) aim = e.clamp(i.x, 20, W - 20);
          if (i.keys.has("ArrowLeft")) aim = Math.max(20, aim - 200 * dt); if (i.keys.has("ArrowRight")) aim = Math.min(W - 20, aim + 200 * dt);
          if ((i.released || i.keyPressed(" ")) && balls > 0) { ball = { x: aim, y: 120, vx: e.rand(-8, 8), vy: 0 }; balls -= 1; }
          else if (balls <= 0) e.over();
          return;
        }
        for (let s = 0; s < 3; s++) {
          const d = dt / 3;
          ball.vy += 900 * d; ball.x += ball.vx * d; ball.y += ball.vy * d;
          if (ball.x < 10) { ball.x = 10; ball.vx = Math.abs(ball.vx) * 0.6; } if (ball.x > W - 10) { ball.x = W - 10; ball.vx = -Math.abs(ball.vx) * 0.6; }
          for (const p of pegs) { const dx = ball.x - p.x, dy = ball.y - p.y, dist = Math.hypot(dx, dy); if (dist < 15 && dist > 0.01) { const nx = dx / dist, ny = dy / dist; ball.x = p.x + nx * 15; ball.y = p.y + ny * 15; const dot = ball.vx * nx + ball.vy * ny; ball.vx = (ball.vx - 1.6 * dot * nx) * 0.82 + e.rand(-14, 14); ball.vy = (ball.vy - 1.6 * dot * ny) * 0.82; } }
        }
        if (ball.y > 560) { const slot = e.clamp(Math.floor(ball.x / (W / 8)), 0, 7); points += VAL[slot]; e.score(points); msg = VAL[slot] ? `+${VAL[slot]}` : "0"; ball = null; }
      },
      draw() {
        e.text(`Kugeln: ${balls}`, W / 2, 80, { size: 24 });
        if (!ball && balls > 0) { e.line(aim, 105, aim, 180, "rgba(255,255,255,0.4)", 2); e.circle(aim, 120, 11, "#ffe66d", "#fff", 2); }
        for (const p of pegs) e.circle(p.x, p.y, 5, "#fff");
        VAL.forEach((v, k) => { e.rect(k * (W / 8) + 2, 570, W / 8 - 4, 50, v >= 50 ? "#ffd23f" : v >= 10 ? "#ff9f43" : v >= 5 ? "#4cc9ff" : "rgba(255,255,255,0.35)", 8); e.text(v, k * (W / 8) + W / 16, 595, { size: 16, color: "#111", stroke: false }); });
        if (ball) e.circle(ball.x, ball.y, 10, "#ffe66d", "#fff", 2);
        if (msg) e.text(msg, W / 2, 530, { size: 26, color: "#9dff7a" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Basketball */
  R({ id: "basketball", name: "Korbwurf", emoji: "🏀", cat: "Geschick", color: "#ff8a3d", hint: "Wische vom Ball nach oben: Länge und Richtung bestimmen den Wurf", create(e) {
    let ball = { x: W / 2, y: 540, vx: 0, vy: 0, fly: false, scored: false, passed: false }, hoop = { x: W / 2, y: 190, w: 70 }, misses = 0, points = 0, t = 0, dragFrom = null, msg = "";
    const reset = () => { ball = { x: W / 2, y: 540, vx: 0, vy: 0, fly: false, scored: false, passed: false }; };
    return {
      update(dt) {
        const i = e.input; t += dt;
        hoop.x = W / 2 + Math.sin(t * (0.8 + points * 0.05)) * Math.min(120, points * 12);
        if (!ball.fly) {
          if (i.pressed) dragFrom = { x: i.x, y: i.y };
          if (i.released && dragFrom) { const dx = i.x - dragFrom.x, dy = dragFrom.y - i.y; dragFrom = null; if (dy > 40) { ball.vx = dx * 3.2; ball.vy = -Math.min(1100, dy * 6.2 + 300); ball.fly = true; } }
          if (i.keyPressed(" ")) { ball.vx = (hoop.x - ball.x) * 0.9; ball.vy = -900; ball.fly = true; }
          return;
        }
        ball.vy += 1500 * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.vy > 0 && !ball.scored && ball.y >= hoop.y && ball.y - ball.vy * dt < hoop.y) { if (Math.abs(ball.x - hoop.x) < hoop.w / 2 - 6) { ball.scored = true; points += 2; e.score(points); msg = "Treffer!"; } }
        if (ball.x < 12 || ball.x > W - 12) ball.vx *= -0.6;
        if (ball.y > H + 30) { if (!ball.scored) { misses += 1; msg = "Daneben"; if (misses >= 3) e.over(); } reset(); }
      },
      draw() {
        e.rect(hoop.x - 4, hoop.y - 70, 8, 70, "rgba(255,255,255,0.0)"); e.rect(hoop.x - hoop.w / 2 - 6, hoop.y - 60, hoop.w + 12, 60, "rgba(255,255,255,0.85)", 8);
        e.rect(hoop.x - hoop.w / 2, hoop.y - 4, hoop.w, 8, "#ff5d3d", 4);
        for (let k = 0; k < 5; k++) e.line(hoop.x - hoop.w / 2 + 6 + k * (hoop.w - 12) / 4, hoop.y + 4, hoop.x - hoop.w / 2 + 16 + k * (hoop.w - 32) / 4, hoop.y + 40, "rgba(255,255,255,0.8)", 2);
        e.emoji("🏀", ball.x, ball.y, 56, ball.y * 0.05);
        e.text("✕".repeat(misses), W - 24, 60, { size: 22, align: "right", color: "#ff7a7a" });
        e.text(msg, W / 2, 110, { size: 28 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Darts */
  R({ id: "darts", name: "Darts", emoji: "🎯", cat: "Geschick", color: "#ff5d5d", hint: "Tippe, wenn das Fadenkreuz auf der Mitte ist. Sechs Pfeile", create(e) {
    const CX = W / 2, CY = 300;
    let t = 0, darts = 6, hits = [], points = 0, msg = "", wait = 0;
    const cross = () => ({ x: CX + Math.sin(t * (2.2 + hits.length * 0.25)) * 120, y: CY + Math.sin(t * (1.7 + hits.length * 0.2) + 1) * 110 });
    const ringPoints = (d) => (d < 12 ? 50 : d < 30 ? 25 : d < 70 ? 10 : d < 110 ? 5 : d < 140 ? 2 : 0);
    return {
      update(dt) {
        t += dt;
        if (wait > 0) { wait -= dt; if (wait <= 0 && darts <= 0) e.over(); return; }
        if (go(e.input) && darts > 0) { const c = cross(); const d = Math.hypot(c.x - CX, c.y - CY); const p = ringPoints(d); points += p; darts -= 1; hits.push({ x: c.x, y: c.y }); e.score(points / 2); msg = p ? `+${p}` : "Daneben"; wait = darts <= 0 ? 1.2 : 0.35; }
      },
      draw() {
        e.circle(CX, CY, 140, "#222", "#fff", 4); e.circle(CX, CY, 110, "#f4f4f4"); e.circle(CX, CY, 70, "#e0334a"); e.circle(CX, CY, 30, "#3ddc84"); e.circle(CX, CY, 12, "#ffd23f");
        for (const h of hits) { e.line(h.x, h.y, h.x + 18, h.y - 26, "#4cc9ff", 4); e.circle(h.x, h.y, 4, "#111"); }
        if (darts > 0) { const c = cross(); e.line(c.x - 20, c.y, c.x + 20, c.y, "#fff", 3); e.line(c.x, c.y - 20, c.x, c.y + 20, "#fff", 3); e.circle(c.x, c.y, 14, null, "#fff", 3); }
        e.text(`Pfeile: ${darts}   Punkte: ${points}`, W / 2, 110, { size: 24 });
        e.text(msg, W / 2, 500, { size: 30, color: "#ffe66d" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Mini Golf */
  const HOLES = [
    { ball: [180, 540], cup: [180, 120], walls: [], par: 2 },
    { ball: [90, 540], cup: [270, 130], walls: [[120, 300, 160, 16]], par: 3 },
    { ball: [180, 550], cup: [180, 110], walls: [[40, 380, 170, 16], [190, 250, 130, 16]], par: 4 },
    { ball: [60, 540], cup: [300, 540], walls: [[160, 380, 16, 240], [200, 120, 16, 200]], par: 4 },
    { ball: [180, 560], cup: [180, 100], walls: [[80, 420, 200, 16], [30, 300, 150, 16], [180, 300, 16, 60], [190, 200, 140, 16]], par: 5 },
  ];
  R({ id: "mini-golf", name: "Minigolf", emoji: "⛳", cat: "Geschick", color: "#3ddc84", hint: "Zieh vom Ball weg und lass los: je weiter, desto fester der Schlag", create(e) {
    let hole = 0, ball, strokes = 0, vx = 0, vy = 0, drag = null, total = 0, msg = "", wait = 0;
    const cfg = () => HOLES[hole % HOLES.length];
    const place = () => { const [x, y] = cfg().ball; ball = { x, y }; vx = vy = 0; strokes = 0; };
    place();
    const moving = () => Math.hypot(vx, vy) > 6;
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (strokes >= 9 && msg === "Zu viele Schläge") { e.over(); return; } hole += 1; place(); msg = ""; } return; }
        if (!moving()) {
          if (i.pressed && e.dist(i.x, i.y, ball.x, ball.y) < 60) drag = { x: i.x, y: i.y };
          if (i.down && drag) { drag.x = i.x; drag.y = i.y; }
          if (i.released && drag) { const dx = ball.x - drag.x, dy = ball.y - drag.y, len = Math.min(160, Math.hypot(dx, dy)); if (len > 12) { const a = Math.atan2(dy, dx); vx = Math.cos(a) * len * 5.4; vy = Math.sin(a) * len * 5.4; strokes += 1; } drag = null; }
        }
        if (moving()) {
          for (let s = 0; s < 4; s++) {
            const d = dt / 4; ball.x += vx * d; ball.y += vy * d;
            if (ball.x < 18) { ball.x = 18; vx = Math.abs(vx); } if (ball.x > W - 18) { ball.x = W - 18; vx = -Math.abs(vx); } if (ball.y < 60) { ball.y = 60; vy = Math.abs(vy); } if (ball.y > H - 20) { ball.y = H - 20; vy = -Math.abs(vy); }
            for (const [wx, wy, ww, wh] of cfg().walls) {
              const cx = e.clamp(ball.x, wx, wx + ww), cy = e.clamp(ball.y, wy, wy + wh), dx = ball.x - cx, dy = ball.y - cy, dist = Math.hypot(dx, dy);
              if (dist < 8) { const nx = dist > 0.001 ? dx / dist : 0, ny = dist > 0.001 ? dy / dist : -1; ball.x = cx + nx * 8; ball.y = cy + ny * 8; const dot = vx * nx + vy * ny; vx -= 2 * dot * nx; vy -= 2 * dot * ny; vx *= 0.9; vy *= 0.9; }
            }
          }
          const f = Math.pow(0.35, dt); vx *= f; vy *= f;
          const [cx, cy] = cfg().cup;
          if (e.dist(ball.x, ball.y, cx, cy) < 14 && Math.hypot(vx, vy) < 360) { const diff = strokes - cfg().par; total += 1; e.addScore(Math.max(1, 10 - strokes * 2 + (diff < 0 ? 3 : 0))); msg = strokes === 1 ? "Hole in one!" : diff <= 0 ? "Birdie!" : "Eingelocht"; wait = 1.2; vx = vy = 0; ball.x = cx; ball.y = cy; }
          if (strokes >= 9 && !moving()) { msg = "Zu viele Schläge"; wait = 1.2; }
        } else if (strokes >= 9 && !wait) { msg = "Zu viele Schläge"; wait = 1.2; }
      },
      draw() {
        const c = cfg();
        e.panel(14, 56, W - 28, H - 76, 22, 0.42, "30,110,50");
        for (const [wx, wy, ww, wh] of c.walls) e.rect(wx, wy, ww, wh, "#8b5a2b", 6);
        e.circle(c.cup[0], c.cup[1], 14, "#111", "#fff", 3); e.line(c.cup[0], c.cup[1], c.cup[0], c.cup[1] - 46, "#fff", 3); e.rect(c.cup[0], c.cup[1] - 46, 22, 14, "#ff5d5d");
        if (drag && !moving()) { e.line(ball.x, ball.y, ball.x + (ball.x - drag.x) * 0.6, ball.y + (ball.y - drag.y) * 0.6, "rgba(255,255,255,0.8)", 4); e.line(ball.x, ball.y, drag.x, drag.y, "rgba(255,255,255,0.3)", 3); }
        e.circle(ball.x, ball.y, 8, "#fff", "#555", 2);
        e.text(`Loch ${hole + 1} · Par ${c.par} · Schläge ${strokes}`, W / 2, 34, { size: 18 });
        if (msg) e.text(msg, W / 2, 330, { size: 30, color: "#ffe66d" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Archery */
  R({ id: "archery", name: "Bogenschießen", emoji: "🏹", cat: "Geschick", color: "#c49a6c", hint: "Tippe im richtigen Moment: der Pfeil fliegt geradeaus, die Scheibe wandert", create(e) {
    const BOW_Y = 320;
    let t = 0, arrows = 8, flying = null, stuck = [], points = 0, msg = "", wait = 0;
    const targetY = () => BOW_Y + Math.sin(t * (1.4 + stuck.length * 0.12)) * 190;
    return {
      update(dt) {
        t += dt;
        if (flying) {
          flying.x += 900 * dt;
          if (flying.x >= 280) {
            const d = Math.abs(BOW_Y - targetY());
            const p = d < 14 ? 10 : d < 40 ? 6 : d < 70 ? 3 : d < 98 ? 1 : 0;
            points += p; e.score(points);
            if (p) stuck.push({ offset: BOW_Y - targetY(), at: t });
            msg = p ? `+${p}` : "Daneben";
            flying = null; wait = 0.4;
          }
          return;
        }
        if (wait > 0) { wait -= dt; if (wait <= 0 && arrows <= 0) e.over(); return; }
        if (go(e.input) && arrows > 0) { arrows -= 1; flying = { x: 70 }; }
      },
      draw() {
        const ty = targetY();
        e.circle(280, ty, 98, "#fff", "#222", 4); e.circle(280, ty, 70, "#222"); e.circle(280, ty, 40, "#4cc9ff"); e.circle(280, ty, 14, "#e0334a");
        for (const a of stuck) e.line(262, ty + a.offset, 300, ty + a.offset, "#ffe66d", 4);
        e.emoji("🏹", 50, BOW_Y, 60);
        if (flying) e.line(flying.x - 34, BOW_Y, flying.x, BOW_Y, "#fff", 4);
        e.text(`Pfeile: ${arrows}   Punkte: ${points}`, W / 2, 110, { size: 24 });
        e.text(msg, W / 2, 560, { size: 28, color: "#ffe66d" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Bowling */
  R({ id: "bowling", name: "Bowling", emoji: "🎳", cat: "Geschick", color: "#4d8dff", hint: "Tippe einmal für die Richtung, einmal für die Kraft. Fünf Durchgänge", create(e) {
    let phase = "aim", pos = 0, dir = 1, aim = 0, frame = 1, roll = 1, pins = Array(10).fill(true), total = 0, msg = "", wait = 0, ballY = 0, t = 0;
    const pinPos = (k) => { const rows = [4, 3, 2, 1]; let n = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < rows[r]; c++) { if (n === k) return [180 + (c - (rows[r] - 1) / 2) * 34, 170 + r * 30]; n += 1; } return [180, 170]; };
    function knock(power) {
      const accuracy = 1 - Math.abs(aim), strength = Math.max(0, 1 - Math.abs(power - 0.78) * 1.8);
      const quality = e.clamp(accuracy * 0.55 + strength * 0.5 + e.rand(-0.1, 0.1), 0, 1);
      const standing = pins.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
      const hits = Math.min(standing.length, Math.round(standing.length * quality * (0.6 + 0.45 * accuracy) + (quality > 0.85 ? 2 : 0)));
      for (const k of e.shuffle(standing).slice(0, hits)) pins[k] = false;
      total += hits;
      const left = pins.filter(Boolean).length;
      msg = left === 0 ? (roll === 1 ? "Strike!" : "Spare!") : hits ? `${hits} Kegel` : "Daneben";
      if (left === 0) total += roll === 1 ? 5 : 3;
      e.score(total);
    }
    function next() {
      const left = pins.filter(Boolean).length;
      if (left === 0 || roll === 2) { frame += 1; roll = 1; pins = Array(10).fill(true); if (frame > 5) { e.over(); return; } } else roll = 2;
      phase = "aim"; pos = 0; dir = 1; msg = "";
    }
    return {
      update(dt) {
        t += dt;
        if (phase === "aim") { pos += dir * 1.7 * dt; if (pos > 1) { pos = 1; dir = -1; } if (pos < -1) { pos = -1; dir = 1; } }
        else if (phase === "power") pos = Math.sin(t * 4.5);
        if (wait > 0) { wait -= dt; if (wait <= 0) next(); return; }
        if (go(e.input)) {
          if (phase === "aim") { aim = pos; phase = "power"; }
          else if (phase === "power") { phase = "roll"; ballY = 0; knock.power = (pos + 1) / 2; }
        }
        if (phase === "roll") { ballY += 520 * dt; if (ballY >= 420) { knock(knock.power); phase = "result"; wait = 1.1; } }
      },
      draw() {
        e.panel(60, 120, 240, 440, 18, 0.35, "150,100,50");
        for (let k = 0; k < 10; k++) { const [x, y] = pinPos(k); if (pins[k]) e.circle(x, y, 9, "#fff", "#e0334a", 3); else e.circle(x, y, 4, "rgba(255,255,255,0.15)"); }
        const thrown = phase === "roll" || phase === "result";
        e.circle(180 + (thrown ? aim * 70 * Math.min(1, ballY / 420) : 0), thrown ? 540 - Math.min(ballY, 420) : 540, 15, "#222", "#fff", 3);
        e.text(`Durchgang ${Math.min(frame, 5)} von 5 · Wurf ${roll}`, W / 2, 90, { size: 20 });
        if (phase === "aim" || phase === "power") {
          e.rect(60, 590, 240, 18, "rgba(0,0,0,0.5)", 9);
          if (phase === "power") e.rect(60 + 240 * 0.78 - 5, 590, 10, 18, "#3ddc84");
          e.rect(60 + 120 + pos * 120 - 6, 584, 12, 30, "#fff", 6);
          e.text(phase === "aim" ? "Tippe für die Richtung" : "Tippe für die Kraft (grün ist gut)", W / 2, 626, { size: 14, weight: 700 });
        }
        if (phase === "result") e.text(msg, W / 2, 360, { size: 34, color: "#ffe66d" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Cannon */
  R({ id: "cannon", name: "Kanone", emoji: "💣", cat: "Geschick", color: "#8a5cff", hint: "Zieh zurück und lass los: Richtung und Kraft. Triff die Ziele (8 Schüsse)", create(e) {
    let shots = 8, ball = null, drag = null, targets = [], points = 0, msg = "", wind = 0;
    const place = () => { targets = Array.from({ length: 3 }, () => ({ x: e.rand(150, 330), y: e.rand(240, 520), r: 24, hit: false })); wind = e.rand(-40, 40); };
    place();
    return {
      update(dt) {
        const i = e.input;
        if (!ball) {
          if (i.pressed) drag = { x: i.x, y: i.y };
          if (i.down && drag) { drag.x = i.x; drag.y = i.y; }
          if (i.released && drag) { const dx = 50 - drag.x, dy = 560 - drag.y, len = Math.min(180, Math.hypot(dx, dy)); if (len > 15 && shots > 0) { const a = Math.atan2(dy, dx); ball = { x: 50, y: 560, vx: Math.cos(a) * len * 5, vy: Math.sin(a) * len * 5 }; shots -= 1; } drag = null; }
          return;
        }
        ball.vy += 700 * dt; ball.vx += wind * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        for (const t of targets) if (!t.hit && e.dist(ball.x, ball.y, t.x, t.y) < t.r + 8) { t.hit = true; points += 5; e.score(points); msg = "Treffer!"; }
        if (ball.y > 600 || ball.x > W + 40 || ball.x < -40) { ball = null; if (targets.every((t) => t.hit)) { points += shots * 2; e.score(points); place(); msg = "Alle getroffen!"; } else if (shots <= 0) e.over(); }
      },
      draw() {
        e.emoji("💣", 40, 575, 54); e.rect(14, 590, 70, 30, "rgba(60,40,20,0.9)", 8);
        for (const t of targets) if (!t.hit) { e.circle(t.x, t.y, t.r, "#fff", "#e0334a", 4); e.circle(t.x, t.y, t.r * 0.5, "#e0334a"); }
        if (drag && !ball) e.line(50, 560, 50 + (50 - drag.x) * 0.7, 560 + (560 - drag.y) * 0.7, "rgba(255,255,255,0.7)", 4);
        if (ball) e.circle(ball.x, ball.y, 8, "#333", "#fff", 2);
        e.text(`Schüsse: ${shots}   Punkte: ${points}`, W / 2, 80, { size: 22 });
        e.text(`Wind ${wind > 0 ? "→" : "←"} ${Math.abs(Math.round(wind))}`, W / 2, 112, { size: 16, weight: 700 });
        if (msg) e.text(msg, W / 2, 180, { size: 26, color: "#ffe66d" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Keepy Uppy */
  R({ id: "keepy-uppy", name: "Jonglieren", emoji: "⚽", cat: "Geschick", color: "#3ddc84", hint: "Tippe den Ball, damit er nicht auf den Boden fällt. Wo du tippst, fliegt er hin", create(e) {
    let x = W / 2, y = 300, vx = 0, vy = 0, kicks = 0, spin = 0;
    return {
      update(dt) {
        const i = e.input;
        vy += 1100 * dt; x += vx * dt; y += vy * dt; spin += vx * dt * 0.02;
        if (x < 30) { x = 30; vx = Math.abs(vx) * 0.8; } if (x > W - 30) { x = W - 30; vx = -Math.abs(vx) * 0.8; }
        if (i.pressed && e.dist(i.x, i.y, x, y) < 70) { vy = -Math.min(900, 560 + kicks * 4); vx = (x - i.x) * 5; kicks += 1; e.score(kicks); }
        if (i.keyPressed("ArrowLeft") || i.keyPressed(" ")) { vy = -600; vx = -90; kicks += 1; e.score(kicks); }
        if (i.keyPressed("ArrowRight")) { vy = -600; vx = 90; kicks += 1; e.score(kicks); }
        if (y > H - 50) e.over();
      },
      draw() { e.rect(0, H - 40, W, 40, "rgba(60,150,70,0.8)"); e.emoji("⚽", x, y, 64, spin); e.text(String(kicks), W / 2, 90, { size: 54 }); },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Jump Rope */
  R({ id: "jump-rope", name: "Seilspringen", emoji: "🪢", cat: "Geschick", color: "#ff6bb5", hint: "Tippe zum Springen, wenn das Seil unten ankommt", create(e) {
    const FLOOR = 470;
    let phase = Math.PI * 0.5, speed = 3.2, y = 0, vy = 0, jumps = 0;
    return {
      update(dt) {
        const before = phase;
        phase += speed * dt;
        if (phase >= Math.PI * 2) phase -= Math.PI * 2;
        if (go(e.input) && y <= 0) vy = 560;
        vy -= 1900 * dt; y += vy * dt;
        if (y < 0) { y = 0; vy = 0; }
        if (Math.cos(phase) < -0.72 && y < 24) { e.over(); return; }           // the rope is under the feet and the feet are on the ground
        if (before > phase) { jumps += 1; e.score(jumps); speed = Math.min(6.2, 3.2 + jumps * 0.09); }
      },
      draw() {
        const cx = W / 2, hy = FLOOR - 60;
        const mid = FLOOR - 90 - 100 * Math.cos(phase);
        e.line(cx - 110, hy, cx - 110, FLOOR, "#fff", 6); e.line(cx + 110, hy, cx + 110, FLOOR, "#fff", 6);
        e.g.strokeStyle = "#ffe66d"; e.g.lineWidth = 6; e.g.lineCap = "round"; e.g.beginPath(); e.g.moveTo(cx - 110, hy); e.g.quadraticCurveTo(cx, 2 * mid - hy, cx + 110, hy); e.g.stroke();
        e.line(0, FLOOR + 10, W, FLOOR + 10, "rgba(255,255,255,0.9)", 4);
        e.emoji("🧍", cx, FLOOR - 30 - y, 64);
        e.text(String(jumps), W / 2, 110, { size: 54 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Faller */
  R({ id: "faller", name: "Durchfallen", emoji: "⚪", cat: "Geschick", color: "#59a7ff", hint: "Bewege den Finger links und rechts: fall durch die Lücken, bevor es dich nach oben schiebt", create(e) {
    let x = W / 2, y = 150, vy = 0, rows = [], spawn = 0, dist = 0, floor = 0;
    for (let k = 0; k < 6; k++) rows.push({ y: 260 + k * 110, gap: e.rand(30, W - 90), w: 74 });
    return {
      update(dt) {
        const i = e.input;
        if (i.down) x += (i.x - x) * Math.min(1, dt * 14);
        if (i.keys.has("ArrowLeft")) x -= 260 * dt; if (i.keys.has("ArrowRight")) x += 260 * dt;
        x = e.clamp(x, 12, W - 12);
        const scroll = 70 + Math.min(110, dist / 60);
        for (const r of rows) r.y -= scroll * dt; dist += scroll * dt;
        if (rows[0].y < -20) { rows.shift(); }
        while (rows[rows.length - 1].y < H) rows.push({ y: rows[rows.length - 1].y + 110, gap: e.rand(20, W - 100), w: Math.max(54, 80 - dist / 400) });
        vy += 900 * dt; vy = Math.min(vy, 420); y += vy * dt;
        let standing = false;
        for (const r of rows) { const inGap = x - 8 > r.gap && x + 8 < r.gap + r.w; if (!inGap && y + 12 >= r.y && y + 12 <= r.y + 18 && vy >= 0) { y = r.y - 12; vy = 0; standing = true; } }
        e.score(dist / 50);
        if (y < 10 || y > H + 20) e.over();
      },
      draw() {
        for (const r of rows) { e.rect(0, r.y, r.gap, 16, "#ff6b6b", 6); e.rect(r.gap + r.w, r.y, W - r.gap - r.w, 16, "#ff6b6b", 6); }
        e.circle(x, y, 12, "#ffe66d", "#fff", 3);
        e.rect(0, 0, W, 8, "rgba(255,80,80,0.8)");
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Swing */
  R({ id: "swing", name: "Schwingen", emoji: "🤸", cat: "Geschick", color: "#ff9f43", hint: "Tippe, um dich loszulassen, und lande auf der grünen Plattform", create(e) {
    const FLOOR = 480;
    let pivot, ang, angV, ball = null, plat, home, points = 0;
    function setup() {                                          // the swinger hangs from a hook above the platform he stands on; the next platform is to the right
      home = { x: 60, w: 80 };
      pivot = { x: 175, y: 160 };
      const width = Math.max(46, 84 - points * 3);
      plat = { x: e.rand(215, W - 16 - width), w: width };
      ang = -0.9; angV = 0; ball = null;
    }
    setup();
    const LEN = 170;
    const bpos = () => ({ x: pivot.x + Math.sin(ang) * LEN, y: pivot.y + Math.cos(ang) * LEN });
    return {
      update(dt) {
        const i = e.input;
        if (!ball) {
          angV += -9 * Math.sin(ang) * dt; ang += angV * dt;
          if (go(i)) { const p = bpos(); const tangent = LEN * angV; ball = { x: p.x, y: p.y, vx: Math.cos(ang) * tangent, vy: -Math.sin(ang) * tangent }; }
          return;
        }
        ball.vy += 900 * dt; ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.vy > 0 && ball.y >= FLOOR - 10 && ball.y <= FLOOR + 30 && ball.x >= plat.x && ball.x <= plat.x + plat.w) {
          points += 1; e.score(points); setup(); return;
        }
        if (ball.y > H + 30 || ball.x < -40 || ball.x > W + 40) e.over();
      },
      draw() {
        e.rect(home.x, FLOOR, home.w, 16, "#4cc9ff", 6);
        e.rect(plat.x, FLOOR, plat.w, 16, "#3ddc84", 6);
        if (!ball) { const p = bpos(); e.line(pivot.x, pivot.y, p.x, p.y, "#fff", 3); e.circle(pivot.x, pivot.y, 7, "#fff"); e.emoji("🤸", p.x, p.y, 42, ang * 0.5); }
        else e.emoji("🤸", ball.x, ball.y, 42, ball.x * 0.03);
        e.text(String(points), W / 2, 90, { size: 48 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ High Striker */
  R({ id: "high-striker", name: "Hau den Lukas", emoji: "🔨", cat: "Geschick", color: "#ff5d73", hint: "Tippe, wenn die Anzeige ganz oben ist: je höher, desto mehr Punkte (fünf Schläge)", create(e) {
    let v = 0, dir = 1, speed = 1.6, hits = 5, phase = "swing", rise = 0, target = 0, points = 0, msg = "", wait = 0;
    return {
      update(dt) {
        if (phase === "swing") {
          v += dir * speed * dt; if (v > 1) { v = 1; dir = -1; } if (v < 0) { v = 0; dir = 1; }
          if (go(e.input)) { target = v; phase = "rise"; rise = 0; hits -= 1; }
        } else if (phase === "rise") {
          rise += dt * 2.4; if (rise >= target) { rise = target; const p = Math.round(target * target * 100); points += p; e.score(points); msg = target > 0.92 ? "Volltreffer!" : target > 0.6 ? "Stark!" : "Schwach"; phase = "show"; wait = 1.0; }
        } else { wait -= dt; if (wait <= 0) { if (hits <= 0) e.over(); else { phase = "swing"; speed = Math.min(3.6, speed + 0.3); v = 0; dir = 1; msg = ""; } } }
      },
      draw() {
        e.text(`Schläge: ${hits}   Punkte: ${points}`, W / 2, 100, { size: 24 });
        e.rect(150, 160, 60, 380, "rgba(0,0,0,0.5)", 30);
        const level = phase === "swing" ? v : rise;
        e.rect(156, 534 - level * 368, 48, level * 368 + 0, phase === "swing" ? "rgba(255,255,255,0.45)" : level > 0.9 ? "#ffd23f" : "#ff5d73", 24);
        e.circle(180, 160 + 8, 20, "#ffd23f", "#fff", 3); e.text("🔔", 180, 168, { size: 26, stroke: false });
        e.emoji("🔨", 80, 480, 70, -0.5);
        if (msg) e.text(msg, W / 2, 590, { size: 30, color: "#ffe66d" });
      },
    };
  } });
})();
