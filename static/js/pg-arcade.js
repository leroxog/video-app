/* Pulse games: the arcade classics (pg-arcade.js): Snake, Breakout, Pong, Air Hockey, Space Shooter, Invaders, Catch, Whack-a-Mole, Fruit Slice, Balloons,
   Stack Tower, Tetris and Bubble Shooter. Every game is registered in the kit (pg-kit.js); the field is 360 x 640. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const left = (i) => i.swipe === "left" || i.keyPressed("ArrowLeft") || i.keyPressed("a");
  const right = (i) => i.swipe === "right" || i.keyPressed("ArrowRight") || i.keyPressed("d");
  const up = (i) => i.swipe === "up" || i.keyPressed("ArrowUp") || i.keyPressed("w");
  const downKey = (i) => i.swipe === "down" || i.keyPressed("ArrowDown") || i.keyPressed("s");

  /* ------------------------------------------------------------------------------------------------ Snake */
  R({ id: "snake", name: "Snake", emoji: "🐍", cat: "Arcade", color: "#4cc38a", hint: "Wischen oder tippen (links/rechts) zum Drehen", create(e) {
    const C = 20, COLS = 16, ROWS = 24, OX = 20, OY = 90;
    let body = [{ x: 8, y: 12 }, { x: 7, y: 12 }, { x: 6, y: 12 }], dir = { x: 1, y: 0 }, next = { x: 1, y: 0 }, food = null, timer = 0, speed = 0.17, grow = 0;
    const place = () => { do { food = { x: e.randInt(0, COLS - 1), y: e.randInt(0, ROWS - 1) }; } while (body.some((b) => b.x === food.x && b.y === food.y)); };
    place();
    const turn = (dx, dy) => { if (dx !== -dir.x || dy !== -dir.y) next = { x: dx, y: dy }; };
    return {
      update(dt) {
        const i = e.input;
        if (left(i)) turn(-1, 0); else if (right(i)) turn(1, 0); else if (up(i)) turn(0, -1); else if (downKey(i)) turn(0, 1);
        else if (i.tap) { if (i.x < W / 2) turn(dir.y, -dir.x); else turn(-dir.y, dir.x); }
        timer += dt;
        if (timer < speed) return;
        timer -= speed;
        dir = next;
        const head = { x: body[0].x + dir.x, y: body[0].y + dir.y };
        if (head.x < 0 || head.y < 0 || head.x >= COLS || head.y >= ROWS || body.some((b, k) => k < body.length - 1 && b.x === head.x && b.y === head.y)) { e.over(); return; }
        body.unshift(head);
        if (head.x === food.x && head.y === food.y) { e.score(body.length - 3); place(); speed = Math.max(0.07, speed - 0.004); } else body.pop();
      },
      draw() {
        e.panel(OX - 4, OY - 4, COLS * C + 8, ROWS * C + 8, 14, 0.4);
        e.emoji("🍎", OX + food.x * C + C / 2, OY + food.y * C + C / 2 + 1, C + 2);
        body.forEach((b, k) => e.rect(OX + b.x * C + 1, OY + b.y * C + 1, C - 2, C - 2, k === 0 ? "#b6ff7a" : "#3fbf6a", 6));
        const h = body[0]; e.circle(OX + h.x * C + 6, OY + h.y * C + 7, 2, "#111"); e.circle(OX + h.x * C + 14, OY + h.y * C + 7, 2, "#111");
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Breakout */
  R({ id: "breakout", name: "Breakout", emoji: "🧱", cat: "Arcade", color: "#ff7a59", hint: "Finger bewegen: Schläger links und rechts", create(e) {
    const PW = 72;
    let px = W / 2, ball = { x: W / 2, y: 520, vx: 0, vy: 0, stuck: true }, bricks = [], lives = 3, level = 0, points = 0;
    const colors = ["#ff5d5d", "#ff9f43", "#ffd93d", "#6bd45f", "#4cc9ff", "#b46bff"];
    function fill() { bricks = []; for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) bricks.push({ x: 12 + c * 42, y: 90 + r * 24, w: 38, h: 18, color: colors[r], pts: (6 - r) * 5 }); }
    fill();
    const launch = () => { const a = e.rand(-0.5, 0.5); const s = 330 + level * 30; ball.vx = Math.sin(a) * s; ball.vy = -Math.cos(a) * s; ball.stuck = false; };
    return {
      update(dt) {
        const i = e.input;
        if (i.down) px += (i.x - px) * Math.min(1, dt * 20);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) px -= 420 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) px += 420 * dt;
        px = e.clamp(px, PW / 2, W - PW / 2);
        if (ball.stuck) { ball.x = px; ball.y = 560 - 10; if (i.pressed || i.released || i.keyPressed(" ")) launch(); return; }
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.x < 8) { ball.x = 8; ball.vx = Math.abs(ball.vx); } if (ball.x > W - 8) { ball.x = W - 8; ball.vx = -Math.abs(ball.vx); }
        if (ball.y < 8) { ball.y = 8; ball.vy = Math.abs(ball.vy); }
        if (ball.vy > 0 && ball.y > 548 && ball.y < 566 && Math.abs(ball.x - px) < PW / 2 + 8) {
          const off = (ball.x - px) / (PW / 2); const speed = Math.min(620, Math.hypot(ball.vx, ball.vy) * 1.01);
          ball.vx = Math.sin(off * 1.05) * speed; ball.vy = -Math.cos(off * 1.05) * speed; ball.y = 548;
        }
        for (let k = bricks.length - 1; k >= 0; k--) {
          const b = bricks[k];
          if (ball.x + 7 > b.x && ball.x - 7 < b.x + b.w && ball.y + 7 > b.y && ball.y - 7 < b.y + b.h) {
            const fromSide = Math.min(ball.x + 7 - b.x, b.x + b.w - (ball.x - 7)) < Math.min(ball.y + 7 - b.y, b.y + b.h - (ball.y - 7));
            if (fromSide) ball.vx *= -1; else ball.vy *= -1;
            bricks.splice(k, 1); points += b.pts; e.score(points); break;
          }
        }
        if (!bricks.length) { level += 1; fill(); ball.stuck = true; }
        if (ball.y > H + 20) { lives -= 1; if (lives <= 0) e.over(); else ball.stuck = true; }
      },
      draw() {
        for (const b of bricks) e.rect(b.x, b.y, b.w, b.h, b.color, 5);
        e.rect(px - PW / 2, 556, PW, 12, "#fff", 6);
        e.circle(ball.x, ball.y, 7, "#ffe66d", "#fff", 2);
        e.text("♥".repeat(lives), 20, 40, { size: 20, align: "left", color: "#ff5d73" });
        if (ball.stuck) e.text("Tippen zum Starten", W / 2, 400, { size: 20 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Pong */
  R({ id: "pong", name: "Pong", emoji: "🏓", cat: "Arcade", color: "#59a7ff", hint: "Finger bewegen: Schläger links und rechts. Drei Fehler und es ist vorbei", create(e) {
    const PW = 80;
    let px = W / 2, ax = W / 2, ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 }, misses = 0, wins = 0, wait = 0.8;
    const serve = (dir) => { ball = { x: W / 2, y: H / 2, vx: e.rand(-120, 120), vy: dir * (260 + wins * 14) }; wait = 0.8; };
    serve(1);
    return {
      update(dt) {
        const i = e.input;
        if (i.down) px += (i.x - px) * Math.min(1, dt * 18);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) px -= 400 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) px += 400 * dt;
        px = e.clamp(px, PW / 2, W - PW / 2);
        const aiSpeed = Math.min(320, 150 + wins * 14);
        ax += e.clamp(ball.x - ax, -aiSpeed * dt, aiSpeed * dt); ax = e.clamp(ax, PW / 2, W - PW / 2);
        if (wait > 0) { wait -= dt; return; }
        ball.x += ball.vx * dt; ball.y += ball.vy * dt;
        if (ball.x < 8 || ball.x > W - 8) { ball.vx *= -1; ball.x = e.clamp(ball.x, 8, W - 8); }
        if (ball.vy > 0 && ball.y > 566 && ball.y < 590 && Math.abs(ball.x - px) < PW / 2 + 8) { ball.vy = -Math.abs(ball.vy) * 1.04; ball.vx += ((ball.x - px) / (PW / 2)) * 160; ball.y = 566; }
        if (ball.vy < 0 && ball.y < 74 && ball.y > 50 && Math.abs(ball.x - ax) < PW / 2 + 8) { ball.vy = Math.abs(ball.vy) * 1.04; ball.vx += ((ball.x - ax) / (PW / 2)) * 120; ball.y = 74; }
        ball.vx = e.clamp(ball.vx, -380, 380);
        if (ball.y > H + 10) { misses += 1; if (misses >= 3) e.over(); else serve(-1); }
        if (ball.y < -10) { wins += 1; e.score(wins); serve(1); }
      },
      draw() {
        e.rect(ax - PW / 2, 56, PW, 12, "#ff7a7a", 6); e.rect(px - PW / 2, 572, PW, 12, "#fff", 6);
        for (let k = 0; k < 12; k++) e.rect(8 + k * 30, H / 2 - 2, 16, 4, "rgba(255,255,255,0.5)");
        e.circle(ball.x, ball.y, 8, "#ffe66d", "#fff", 2);
        e.text("♥".repeat(3 - misses), 20, H - 28, { size: 18, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Air Hockey */
  R({ id: "air-hockey", name: "Air Hockey", emoji: "🏒", cat: "Arcade", color: "#4cd1ff", hint: "Bewege deinen Schläger (unten) und schieß den Puck ins Tor", create(e) {
    const R_M = 30, R_P = 18, GOAL = 130;
    let me = { x: W / 2, y: 540, px: W / 2, py: 540 }, ai = { x: W / 2, y: 100 }, puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 }, my = 0, theirs = 0, wait = 0.6;
    const reset = (toward) => { puck = { x: W / 2, y: H / 2, vx: 0, vy: toward * 120 }; wait = 0.7; };
    function bounce(m, mvx, mvy, r) {
      const dx = puck.x - m.x, dy = puck.y - m.y, d = Math.hypot(dx, dy);
      if (d < r + R_P && d > 0.001) {
        const nx = dx / d, ny = dy / d; puck.x = m.x + nx * (r + R_P); puck.y = m.y + ny * (r + R_P);
        const rel = (puck.vx - mvx) * nx + (puck.vy - mvy) * ny;
        if (rel < 0) { puck.vx -= 1.9 * rel * nx; puck.vy -= 1.9 * rel * ny; }
        const sp = Math.hypot(puck.vx, puck.vy); if (sp > 700) { puck.vx *= 700 / sp; puck.vy *= 700 / sp; }
      }
    }
    return {
      update(dt) {
        const i = e.input;
        const px = me.x, py = me.y;
        if (i.down) { me.x += e.clamp(i.x - me.x, -900 * dt, 900 * dt); me.y += e.clamp(i.y - me.y, -900 * dt, 900 * dt); }
        if (i.keys.has("ArrowLeft")) me.x -= 400 * dt; if (i.keys.has("ArrowRight")) me.x += 400 * dt; if (i.keys.has("ArrowUp")) me.y -= 400 * dt; if (i.keys.has("ArrowDown")) me.y += 400 * dt;
        me.x = e.clamp(me.x, R_M, W - R_M); me.y = e.clamp(me.y, H / 2 + R_M, H - R_M - 10);
        const mvx = (me.x - px) / dt, mvy = (me.y - py) / dt;
        const ax0 = ai.x, ay0 = ai.y;
        const target = puck.y < H / 2 ? { x: puck.x, y: Math.max(60, puck.y - 30) } : { x: W / 2, y: 90 };
        const sp = 190 + my * 8 + theirs * 0;
        ai.x += e.clamp(target.x - ai.x, -sp * dt, sp * dt); ai.y += e.clamp(target.y - ai.y, -sp * dt, sp * dt);
        ai.x = e.clamp(ai.x, R_M, W - R_M); ai.y = e.clamp(ai.y, 50, H / 2 - R_M);
        if (wait > 0) { wait -= dt; return; }
        puck.x += puck.vx * dt; puck.y += puck.vy * dt; puck.vx *= 0.9985; puck.vy *= 0.9985;
        if (puck.x < R_P) { puck.x = R_P; puck.vx = Math.abs(puck.vx); } if (puck.x > W - R_P) { puck.x = W - R_P; puck.vx = -Math.abs(puck.vx); }
        const inGoal = Math.abs(puck.x - W / 2) < GOAL / 2;
        if (puck.y < R_P && !inGoal) { puck.y = R_P; puck.vy = Math.abs(puck.vy); }
        if (puck.y > H - R_P && !inGoal) { puck.y = H - R_P; puck.vy = -Math.abs(puck.vy); }
        bounce(me, mvx, mvy, R_M); bounce(ai, (ai.x - ax0) / dt, (ai.y - ay0) / dt, R_M);
        if (puck.y < -R_P) { my += 1; e.score(my * 10); if (my >= 5) { e.addScore(20); e.over(); } else reset(-1); }
        if (puck.y > H + R_P) { theirs += 1; if (theirs >= 5) e.over(); else reset(1); }
      },
      draw() {
        e.line(0, H / 2, W, H / 2, "rgba(255,255,255,0.6)", 3); e.circle(W / 2, H / 2, 46, null, "rgba(255,255,255,0.5)", 3);
        e.rect(W / 2 - GOAL / 2, 0, GOAL, 8, "#ff7a7a"); e.rect(W / 2 - GOAL / 2, H - 8, GOAL, 8, "#7ad7ff");
        e.circle(ai.x, ai.y, R_M, "#ff6b6b", "#fff", 4); e.circle(me.x, me.y, R_M, "#4cc9ff", "#fff", 4);
        e.circle(puck.x, puck.y, R_P, "#222", "#fff", 3);
        e.text(`${my} : ${theirs}`, W - 40, H / 2, { size: 24 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Space Shooter */
  R({ id: "shooter", name: "Space Shooter", emoji: "🚀", cat: "Arcade", color: "#6c7bff", hint: "Finger bewegen: das Schiff schießt von selbst", create(e) {
    let x = W / 2, lives = 3, fire = 0, shots = [], foes = [], spawn = 1, t = 0, inv = 0, stars = Array.from({ length: 30 }, () => ({ x: e.rand(0, W), y: e.rand(0, H), s: e.rand(40, 120) })), power = 0;
    return {
      update(dt) {
        const i = e.input; t += dt; inv = Math.max(0, inv - dt);
        if (i.down) x += (i.x - x) * Math.min(1, dt * 14);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 360 * dt; if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 360 * dt;
        x = e.clamp(x, 20, W - 20);
        fire -= dt; if (fire <= 0) { fire = 0.24 - power * 0.03; shots.push({ x, y: 540 }); if (power >= 1) { shots.push({ x: x - 14, y: 548 }); shots.push({ x: x + 14, y: 548 }); } }
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.3, 1 - t * 0.012); foes.push({ x: e.rand(20, W - 20), y: -30, vy: e.rand(70, 130) + t * 2, hp: e.rand() < 0.2 ? 3 : 1, kind: e.rand() < 0.1 ? "up" : "foe", wob: e.rand(0, 6) }); }
        for (const s of shots) s.y -= 560 * dt;
        for (const f of foes) { f.y += f.vy * dt; f.x += Math.sin(t * 2 + f.wob) * 30 * dt; }
        for (const f of foes) for (const s of shots) if (!s.dead && !f.dead && Math.abs(f.x - s.x) < 20 && Math.abs(f.y - s.y) < 22) { s.dead = true; if (f.kind === "up") { f.dead = true; power = Math.min(2, power + 1); } else { f.hp -= 1; if (f.hp <= 0) { f.dead = true; e.addScore(f.hp < 0 ? 1 : 10); } } }
        for (const f of foes) if (!f.dead && inv <= 0 && Math.abs(f.x - x) < 24 && Math.abs(f.y - 545) < 26) { f.dead = true; if (f.kind === "up") power = Math.min(2, power + 1); else { lives -= 1; inv = 1.5; power = 0; if (lives <= 0) e.over(); } }
        for (const f of foes) if (!f.dead && f.y > H + 30) { f.dead = true; if (f.kind === "foe") { lives -= 1; if (lives <= 0) e.over(); } }
        shots = shots.filter((s) => !s.dead && s.y > -20); foes = foes.filter((f) => !f.dead);
        for (const s of stars) { s.y += s.s * dt; if (s.y > H) { s.y = 0; s.x = e.rand(0, W); } }
      },
      draw() {
        for (const s of stars) e.rect(s.x, s.y, 2, 2, "rgba(255,255,255,0.7)");
        for (const s of shots) e.rect(s.x - 2, s.y - 8, 4, 14, "#ffe66d", 2);
        for (const f of foes) e.emoji(f.kind === "up" ? "⭐" : f.hp > 1 ? "👾" : "👽", f.x, f.y, 40);
        if (inv <= 0 || Math.floor(t * 12) % 2 === 0) e.emoji("🚀", x, 548, 44, 0);
        e.text("♥".repeat(Math.max(0, lives)), 20, 100, { size: 20, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Invaders */
  R({ id: "invaders", name: "Invaders", emoji: "👾", cat: "Arcade", color: "#a06bff", hint: "Finger bewegen: das Schiff schießt von selbst", create(e) {
    let x = W / 2, lives = 3, fire = 0, shots = [], bombs = [], aliens = [], dir = 1, step = 0, wave = 0, drop = 0, inv = 0, bombT = 1.2;
    function spawn() { aliens = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) aliens.push({ x: 40 + c * 40, y: 100 + r * 38, kind: ["👾", "👽", "🛸", "🤖"][r] }); dir = 1; }
    spawn();
    return {
      update(dt) {
        const i = e.input; inv = Math.max(0, inv - dt);
        if (i.down) x += (i.x - x) * Math.min(1, dt * 14);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 330 * dt; if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 330 * dt;
        x = e.clamp(x, 20, W - 20);
        fire -= dt; if (fire <= 0) { fire = 0.45; shots.push({ x, y: 548 }); }
        for (const s of shots) s.y -= 520 * dt;
        const speed = 28 + wave * 8 + (28 - aliens.length) * 2.4;
        let edge = false;
        for (const a of aliens) { a.x += dir * speed * dt; if (a.x < 18 || a.x > W - 18) edge = true; }
        if (edge) { dir *= -1; for (const a of aliens) { a.y += 16; a.x += dir * 4; } }
        bombT -= dt; if (bombT <= 0 && aliens.length) { bombT = Math.max(0.35, 1.1 - wave * 0.08); const a = e.pick(aliens); bombs.push({ x: a.x, y: a.y + 14 }); }
        for (const b of bombs) b.y += 190 * dt;
        for (const a of aliens) for (const s of shots) if (!s.dead && !a.dead && Math.abs(a.x - s.x) < 18 && Math.abs(a.y - s.y) < 18) { a.dead = true; s.dead = true; e.addScore(10 + wave * 2); }
        for (const b of bombs) if (inv <= 0 && Math.abs(b.x - x) < 20 && Math.abs(b.y - 548) < 20) { b.dead = true; lives -= 1; inv = 1.4; if (lives <= 0) e.over(); }
        aliens = aliens.filter((a) => !a.dead); shots = shots.filter((s) => !s.dead && s.y > -20); bombs = bombs.filter((b) => !b.dead && b.y < H + 20);
        if (!aliens.length) { wave += 1; spawn(); }
        if (aliens.some((a) => a.y > 510)) e.over();
      },
      draw() {
        for (const a of aliens) e.emoji(a.kind, a.x, a.y, 30);
        for (const s of shots) e.rect(s.x - 2, s.y - 8, 4, 14, "#ffe66d", 2);
        for (const b of bombs) e.rect(b.x - 3, b.y - 7, 6, 14, "#ff6b6b", 3);
        e.line(0, 520, W, 520, "rgba(255,90,90,0.5)", 2);
        if (inv <= 0 || Math.floor(inv * 10) % 2 === 0) e.emoji("🚀", x, 548, 40);
        e.text("♥".repeat(Math.max(0, lives)), 20, 60, { size: 20, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Catch */
  R({ id: "catch-fruit", name: "Fang das Obst", emoji: "🧺", cat: "Arcade", color: "#ffb347", hint: "Finger bewegen: fang das Obst, nicht die Bomben", create(e) {
    let x = W / 2, lives = 3, items = [], spawn = 0.5, t = 0;
    return {
      update(dt) {
        const i = e.input; t += dt;
        if (i.down) x += (i.x - x) * Math.min(1, dt * 16);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 360 * dt; if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 360 * dt;
        x = e.clamp(x, 36, W - 36);
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.28, 0.8 - t * 0.01); items.push({ x: e.rand(20, W - 20), y: -30, v: e.rand(150, 220) + t * 3, kind: e.rand() < 0.16 ? "💣" : e.pick(["🍎", "🍌", "🍇", "🍊", "🍓", "🍉", "🍐"]) }); }
        for (const it of items) {
          it.y += it.v * dt;
          if (!it.dead && Math.abs(it.x - x) < 40 && it.y > 540 && it.y < 580) { it.dead = true; if (it.kind === "💣") e.over(); else e.addScore(1); }
          else if (!it.dead && it.y > H + 20) { it.dead = true; if (it.kind !== "💣") { lives -= 1; if (lives <= 0) e.over(); } }
        }
        items = items.filter((it) => !it.dead);
      },
      draw() {
        for (const it of items) e.emoji(it.kind, it.x, it.y, 38);
        e.emoji("🧺", x, 566, 66);
        e.text("♥".repeat(Math.max(0, lives)), 20, 100, { size: 20, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Whack-a-Mole */
  R({ id: "whack-mole", name: "Hau den Maulwurf", emoji: "🐹", cat: "Arcade", color: "#c49a6c", hint: "Tippe die Maulwürfe, bevor sie weg sind (25 Sekunden)", create(e) {
    const holes = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) holes.push({ x: 70 + c * 110, y: 190 + r * 105, t: 0, life: 0, hit: 0 });
    let time = 25, spawn = 0.4, hits = 0;
    return {
      update(dt) {
        const i = e.input; time -= dt;
        if (time <= 0) { e.over(); return; }
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.22, 0.7 - (25 - time) * 0.02); const free = holes.filter((h) => h.life <= 0); if (free.length) { const h = e.pick(free); h.life = e.rand(0.7, 1.3) - (25 - time) * 0.012; h.t = 0; h.bomb = e.rand() < 0.14; h.hit = 0; } }
        for (const h of holes) { if (h.life > 0) { h.life -= dt; h.t += dt; } if (h.hit > 0) h.hit -= dt; }
        if (i.pressed) for (const h of holes) if (h.life > 0 && !h.hit && Math.abs(i.x - h.x) < 42 && Math.abs(i.y - (h.y - 10)) < 42) { if (h.bomb) { time -= 3; } else { hits += 1; e.score(hits); } h.life = 0; h.hit = 0.25; }
      },
      draw() {
        e.text(`${Math.max(0, Math.ceil(time))} s`, W / 2, 110, { size: 30 });
        for (const h of holes) {
          e.g.fillStyle = "rgba(60,35,15,0.9)"; e.g.beginPath(); e.g.ellipse(h.x, h.y + 22, 40, 16, 0, 0, 7); e.g.fill();
          if (h.life > 0) { const up = Math.min(1, h.t * 8); e.emoji(h.bomb ? "💣" : "🐹", h.x, h.y + 22 - 34 * up, 52); }
          if (h.hit > 0) e.text(h.bomb ? "-3 s" : "+1", h.x, h.y - 30 - (0.25 - h.hit) * 80, { size: 22, color: h.bomb ? "#ff7a7a" : "#9dff7a" });
        }
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Fruit Slice */
  R({ id: "fruit-slice", name: "Fruit Slice", emoji: "🍉", cat: "Arcade", color: "#ff5d73", hint: "Wische über das Obst. Keine Bomben berühren!", create(e) {
    let fruits = [], halves = [], trail = [], lives = 3, spawn = 0.6, t = 0, last = null;
    return {
      update(dt) {
        const i = e.input; t += dt;
        spawn -= dt;
        if (spawn <= 0) { spawn = Math.max(0.5, 1.2 - t * 0.012); const n = e.randInt(1, t > 15 ? 3 : 2); for (let k = 0; k < n; k++) fruits.push({ x: e.rand(60, W - 60), y: H + 30, vx: e.rand(-70, 70), vy: -e.rand(640, 800), kind: e.rand() < 0.13 ? "💣" : e.pick(["🍉", "🍎", "🍊", "🍋", "🍍", "🥝", "🍓"]), a: 0, w: e.rand(-3, 3) }); }
        for (const f of fruits) { f.vy += 900 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.a += f.w * dt; }
        if (i.down) {
          if (last) for (const f of fruits) if (!f.dead) {
            const dx = i.x - last.x, dy = i.y - last.y, len = Math.hypot(dx, dy);
            if (len > 3) { const tproj = e.clamp(((f.x - last.x) * dx + (f.y - last.y) * dy) / (len * len), 0, 1); if (e.dist(f.x, f.y, last.x + dx * tproj, last.y + dy * tproj) < 30) {
              f.dead = true;
              if (f.kind === "💣") e.over(); else { e.addScore(1); halves.push({ x: f.x, y: f.y, vx: f.vx - 80, vy: f.vy, kind: f.kind, d: -1, life: 0.8 }, { x: f.x, y: f.y, vx: f.vx + 80, vy: f.vy, kind: f.kind, d: 1, life: 0.8 }); }
            } }
          }
          trail.push({ x: i.x, y: i.y, t: 0.25 }); last = { x: i.x, y: i.y };
        } else last = null;
        for (const p of trail) p.t -= dt; trail = trail.filter((p) => p.t > 0);
        for (const h of halves) { h.vy += 900 * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.life -= dt; } halves = halves.filter((h) => h.life > 0);
        for (const f of fruits) if (!f.dead && f.y > H + 50 && f.vy > 0) { f.dead = true; if (f.kind !== "💣") { lives -= 1; if (lives <= 0) e.over(); } }
        fruits = fruits.filter((f) => !f.dead);
      },
      draw() {
        for (const f of fruits) e.emoji(f.kind, f.x, f.y, 52, f.a);
        for (const h of halves) { e.g.save(); e.g.globalAlpha = Math.max(0, h.life / 0.8); e.emoji(h.kind, h.x + h.d * 8, h.y, 40, h.d * 0.5); e.g.restore(); }
        if (trail.length > 1) for (let k = 1; k < trail.length; k++) e.line(trail[k - 1].x, trail[k - 1].y, trail[k].x, trail[k].y, `rgba(255,255,255,${Math.max(0, trail[k].t * 3)})`, 6);
        e.text("♥".repeat(Math.max(0, lives)), 20, 100, { size: 20, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Balloons */
  R({ id: "balloon-pop", name: "Ballons platzen", emoji: "🎈", cat: "Arcade", color: "#ff6bb5", hint: "Tippe die Ballons, bevor sie oben entwischen", create(e) {
    let balls = [], lives = 5, spawn = 0.4, t = 0, bursts = [];
    return {
      update(dt) {
        const i = e.input; t += dt;
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.3, 0.9 - t * 0.012); balls.push({ x: e.rand(40, W - 40), y: H + 40, v: e.rand(70, 120) + t * 2.5, r: e.rand(24, 36), color: e.pick(["#ff5d73", "#ffb347", "#ffe66d", "#6bd45f", "#4cc9ff", "#b46bff"]), sway: e.rand(0, 6) }); }
        for (const b of balls) { b.y -= b.v * dt; b.x += Math.sin(t * 2 + b.sway) * 20 * dt; if (b.y < -50 && !b.dead) { b.dead = true; lives -= 1; if (lives <= 0) e.over(); } }
        if (i.pressed) { for (let k = balls.length - 1; k >= 0; k--) { const b = balls[k]; if (!b.dead && e.dist(i.x, i.y, b.x, b.y) < b.r + 14) { b.dead = true; e.addScore(1); bursts.push({ x: b.x, y: b.y, t: 0.3, c: b.color }); break; } } }
        for (const s of bursts) s.t -= dt; bursts = bursts.filter((s) => s.t > 0);
        balls = balls.filter((b) => !b.dead);
      },
      draw() {
        for (const b of balls) { e.line(b.x, b.y + b.r, b.x + Math.sin(b.y / 20) * 6, b.y + b.r + 28, "rgba(255,255,255,0.7)", 2); e.g.fillStyle = b.color; e.g.beginPath(); e.g.ellipse(b.x, b.y, b.r * 0.85, b.r, 0, 0, 7); e.g.fill(); e.circle(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.18, "rgba(255,255,255,0.7)"); }
        for (const s of bursts) e.circle(s.x, s.y, 50 * (1 - s.t / 0.3) + 10, null, s.c, 4);
        e.text("♥".repeat(Math.max(0, lives)), 20, 100, { size: 20, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Stack Tower */
  R({ id: "stack-tower", name: "Stack Tower", emoji: "🏗️", cat: "Arcade", color: "#ffa94d", hint: "Tippe, um den Block fallen zu lassen: baue den höchsten Turm", create(e) {
    const H_B = 26;
    let blocks = [{ x: 100, w: 160, hue: 200 }], cur = { x: 0, w: 160, dir: 1, hue: 220 }, speed = 160, camera = 0, perfects = 0, fall = null;
    return {
      update(dt) {
        const i = e.input;
        cur.x += cur.dir * speed * dt;
        if (cur.x < 0) { cur.x = 0; cur.dir = 1; } if (cur.x + cur.w > W) { cur.x = W - cur.w; cur.dir = -1; }
        const target = Math.max(0, (blocks.length - 8) * H_B);
        camera += (target - camera) * Math.min(1, dt * 6);
        if (fall) { fall.y += 500 * dt; fall.t -= dt; if (fall.t <= 0) fall = null; }
        if (i.pressed || i.keyPressed(" ")) {
          const top = blocks[blocks.length - 1];
          const lo = Math.max(cur.x, top.x), hi = Math.min(cur.x + cur.w, top.x + top.w), overlap = hi - lo;
          if (overlap <= 0) { fall = { x: cur.x, w: cur.w, y: 0, t: 1, hue: cur.hue, lvl: blocks.length }; e.over(); return; }
          if (Math.abs(cur.x - top.x) < 4) { cur.x = top.x; perfects += 1; e.addScore(2); } else { perfects = 0; e.addScore(1); fall = { x: cur.x < top.x ? cur.x : hi, w: cur.w - overlap, y: 0, t: 0.8, hue: cur.hue, lvl: blocks.length }; }
          const w = perfects ? cur.w : overlap, x = perfects ? cur.x : lo;
          blocks.push({ x, w, hue: cur.hue });
          cur = { x: cur.dir > 0 ? 0 : W - w, w, dir: cur.dir, hue: (cur.hue + 14) % 360 };
          speed = Math.min(420, speed + 6);
        }
      },
      draw() {
        const base = 560 + camera;
        blocks.forEach((b, k) => e.rect(b.x, base - (k + 1) * H_B, b.w, H_B - 2, `hsl(${b.hue},70%,58%)`, 4));
        e.rect(cur.x, base - (blocks.length + 1) * H_B, cur.w, H_B - 2, `hsl(${cur.hue},75%,62%)`, 4);
        if (fall) e.rect(fall.x, base - (fall.lvl + 1) * H_B + fall.y, fall.w, H_B - 2, `hsla(${fall.hue},70%,58%,${Math.max(0, fall.t)})`, 4);
        if (perfects > 1) e.text(`Perfekt x${perfects}`, W / 2, 110, { size: 24, color: "#ffe66d" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Tetris */
  const SHAPES = [
    [[1, 1, 1, 1]], [[1, 1], [1, 1]], [[0, 1, 0], [1, 1, 1]], [[1, 0, 0], [1, 1, 1]], [[0, 0, 1], [1, 1, 1]], [[0, 1, 1], [1, 1, 0]], [[1, 1, 0], [0, 1, 1]],
  ];
  const TCOLORS = ["#4cc9ff", "#ffe66d", "#b46bff", "#4d7cff", "#ffa94d", "#6bd45f", "#ff5d73"];
  R({ id: "tetris", name: "Tetris", emoji: "🧩", cat: "Arcade", color: "#59a7ff", hint: "Wischen: links/rechts bewegen, nach unten fallen lassen · Tippen: drehen", create(e) {
    const C = 24, COLS = 10, ROWS = 20, OX = 60, OY = 90;
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    let piece = null, timer = 0, lines = 0, level = 0, points = 0, bag = [];
    const spawn = () => {
      if (!bag.length) bag = e.shuffle([0, 1, 2, 3, 4, 5, 6]);
      const k = bag.pop();
      piece = { shape: SHAPES[k].map((r) => r.slice()), color: k + 1, x: Math.floor((COLS - SHAPES[k][0].length) / 2), y: 0 };
      if (collide(piece.shape, piece.x, piece.y)) e.over();
    };
    function collide(shape, px, py) { for (let y = 0; y < shape.length; y++) for (let x = 0; x < shape[y].length; x++) if (shape[y][x]) { const gx = px + x, gy = py + y; if (gx < 0 || gx >= COLS || gy >= ROWS || (gy >= 0 && grid[gy][gx])) return true; } return false; }
    function rotate(shape) { return shape[0].map((_, x) => shape.map((row) => row[x]).reverse()); }
    function lock() {
      piece.shape.forEach((row, y) => row.forEach((v, x) => { if (v && piece.y + y >= 0) grid[piece.y + y][piece.x + x] = piece.color; }));
      let cleared = 0;
      for (let y = ROWS - 1; y >= 0; y--) if (grid[y].every(Boolean)) { grid.splice(y, 1); grid.unshift(Array(COLS).fill(0)); cleared += 1; y += 1; }
      if (cleared) { lines += cleared; level = Math.floor(lines / 8); points += [0, 100, 300, 500, 800][cleared] * (level + 1); }
      points += 4; e.score(points / 10);
      spawn();
    }
    spawn();
    const move = (dx) => { if (!collide(piece.shape, piece.x + dx, piece.y)) piece.x += dx; };
    const turn = () => { const r = rotate(piece.shape); for (const kick of [0, -1, 1, -2, 2]) if (!collide(r, piece.x + kick, piece.y)) { piece.shape = r; piece.x += kick; return; } };
    const hard = () => { while (!collide(piece.shape, piece.x, piece.y + 1)) piece.y += 1; lock(); timer = 0; };
    return {
      update(dt) {
        const i = e.input;
        if (left(i)) move(-1); if (right(i)) move(1);
        if (i.tap || up(i)) turn();
        if (i.swipe === "down" || i.keyPressed(" ")) hard();
        const soft = i.keys.has("ArrowDown") || i.keys.has("s");
        timer += dt;
        const every = soft ? 0.05 : Math.max(0.08, 0.6 - level * 0.05);
        if (timer >= every) { timer = 0; if (!collide(piece.shape, piece.x, piece.y + 1)) piece.y += 1; else lock(); }
      },
      draw() {
        e.panel(OX - 6, OY - 6, COLS * C + 12, ROWS * C + 12, 12, 0.45);
        for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { if (grid[y][x]) e.rect(OX + x * C + 1, OY + y * C + 1, C - 2, C - 2, TCOLORS[grid[y][x] - 1], 4); else e.rect(OX + x * C + 10, OY + y * C + 10, 3, 3, "rgba(255,255,255,0.12)"); }
        let ghostY = piece.y; while (!collide(piece.shape, piece.x, ghostY + 1)) ghostY += 1;
        piece.shape.forEach((row, y) => row.forEach((v, x) => { if (v) { e.rect(OX + (piece.x + x) * C + 2, OY + (ghostY + y) * C + 2, C - 4, C - 4, "rgba(255,255,255,0.22)", 4); e.rect(OX + (piece.x + x) * C + 1, OY + (piece.y + y) * C + 1, C - 2, C - 2, TCOLORS[piece.color - 1], 4); } }));
        e.text(`Zeilen ${lines}`, W / 2, 62, { size: 20 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Bubble Shooter */
  R({ id: "bubble-shooter", name: "Bubble Shooter", emoji: "🫧", cat: "Arcade", color: "#6bd1ff", hint: "Zielen mit dem Finger, loslassen zum Schießen: drei gleiche Farben platzen", create(e) {
    const RAD = 17, COLS = 10, ROWSMAX = 15, TOP = 70;
    const colors = ["#ff5d73", "#ffb347", "#ffe66d", "#6bd45f", "#4cc9ff", "#b46bff"];
    const grid = Array.from({ length: ROWSMAX + 2 }, () => Array(COLS).fill(-1));
    const pos = (r, c) => ({ x: 20 + c * RAD * 2 + (r % 2 ? RAD : 0) + RAD, y: TOP + r * RAD * 1.78 + RAD });
    const inRow = (r) => (r % 2 ? COLS - 1 : COLS);
    for (let r = 0; r < 5; r++) for (let c = 0; c < inRow(r); c++) grid[r][c] = e.randInt(0, 3 + Math.min(2, 1));
    let shot = null, nextColor = e.randInt(0, 3), loadColor = e.randInt(0, 3), angle = -Math.PI / 2, shots = 0, pops = [];
    const neighbors = (r, c) => { const odd = r % 2; const list = [[r, c - 1], [r, c + 1], [r - 1, c - 1 + odd], [r - 1, c + odd], [r + 1, c - 1 + odd], [r + 1, c + odd]]; return list.filter(([rr, cc]) => rr >= 0 && rr < grid.length && cc >= 0 && cc < inRow(rr)); };
    function flood(r, c, same) { const seen = new Set([r * 20 + c]); const stack = [[r, c]]; while (stack.length) { const [rr, cc] = stack.pop(); for (const [nr, nc] of neighbors(rr, cc)) { const key = nr * 20 + nc; if (seen.has(key) || grid[nr][nc] < 0) continue; if (same && grid[nr][nc] !== grid[r][c]) continue; seen.add(key); stack.push([nr, nc]); } } return seen; }
    function settle(r, c, color) {
      grid[r][c] = color;
      const group = flood(r, c, true);
      if (group.size >= 3) {
        for (const key of group) { const gr = Math.floor(key / 20), gc = key % 20; const p = pos(gr, gc); pops.push({ x: p.x, y: p.y, t: 0.3, c: colors[grid[gr][gc]] }); grid[gr][gc] = -1; }
        e.addScore(group.size * 2);
        const connected = new Set();
        for (let cc = 0; cc < COLS; cc++) if (grid[0][cc] >= 0) for (const key of flood(0, cc, false)) connected.add(key);
        for (let rr = 0; rr < grid.length; rr++) for (let cc = 0; cc < inRow(rr); cc++) if (grid[rr][cc] >= 0 && !connected.has(rr * 20 + cc)) { const p = pos(rr, cc); pops.push({ x: p.x, y: p.y + 10, t: 0.4, c: colors[grid[rr][cc]] }); grid[rr][cc] = -1; e.addScore(3); }
      } else {
        shots += 1;
        if (shots % 6 === 0) { grid.pop(); grid.unshift(Array(COLS).fill(-1)); for (let cc = 0; cc < inRow(0); cc++) grid[0][cc] = e.randInt(0, 4); }
      }
      if (grid.some((row, rr) => rr >= ROWSMAX - 1 && row.some((v) => v >= 0))) e.over();
    }
    return {
      update(dt) {
        const i = e.input;
        if (!shot) {
          if (i.down || i.released) { const dx = i.x - W / 2, dy = i.y - 590; angle = Math.atan2(Math.min(dy, -40), dx); angle = e.clamp(angle, -Math.PI + 0.2, -0.2); }
          if (i.keys.has("ArrowLeft")) angle = Math.max(-Math.PI + 0.2, angle - 1.4 * dt); if (i.keys.has("ArrowRight")) angle = Math.min(-0.2, angle + 1.4 * dt);
          if (i.released || i.keyPressed(" ")) { shot = { x: W / 2, y: 590, vx: Math.cos(angle) * 760, vy: Math.sin(angle) * 760, color: loadColor }; loadColor = nextColor; nextColor = e.randInt(0, 3 + Math.min(2, Math.floor(shots / 8))); }
        } else {
          shot.x += shot.vx * dt; shot.y += shot.vy * dt;
          if (shot.x < RAD + 4) { shot.x = RAD + 4; shot.vx = Math.abs(shot.vx); } if (shot.x > W - RAD - 4) { shot.x = W - RAD - 4; shot.vx = -Math.abs(shot.vx); }
          let stick = shot.y < TOP + RAD;
          if (!stick) for (let r = 0; r < grid.length && !stick; r++) for (let c = 0; c < inRow(r); c++) if (grid[r][c] >= 0) { const p = pos(r, c); if (e.dist(p.x, p.y, shot.x, shot.y) < RAD * 1.8) { stick = true; break; } }
          if (stick) {
            let best = null, bestD = 1e9;
            for (let r = 0; r < grid.length; r++) for (let c = 0; c < inRow(r); c++) if (grid[r][c] < 0) { const p = pos(r, c); const d = e.dist(p.x, p.y, shot.x, shot.y); if (d < bestD) { bestD = d; best = [r, c]; } }
            const color = shot.color; shot = null;
            if (best) settle(best[0], best[1], color);
          }
        }
        for (const p of pops) p.t -= dt; pops = pops.filter((p) => p.t > 0);
      },
      draw() {
        for (let r = 0; r < grid.length; r++) for (let c = 0; c < inRow(r); c++) if (grid[r][c] >= 0) { const p = pos(r, c); e.circle(p.x, p.y, RAD - 1, colors[grid[r][c]], "rgba(255,255,255,0.8)", 2); e.circle(p.x - 5, p.y - 5, 3, "rgba(255,255,255,0.7)"); }
        for (const p of pops) e.circle(p.x, p.y, 30 * (1 - p.t / 0.4) + 6, null, p.c, 3);
        e.line(0, 590 - 80, W, 590 - 80, "rgba(255,90,90,0.0)", 1);
        if (!shot) e.line(W / 2, 590, W / 2 + Math.cos(angle) * 70, 590 + Math.sin(angle) * 70, "rgba(255,255,255,0.7)", 3);
        e.circle(W / 2, 590, RAD - 1, colors[loadColor], "#fff", 2);
        e.circle(W / 2 - 70, 612, 11, colors[nextColor], "#fff", 2);
        if (shot) e.circle(shot.x, shot.y, RAD - 1, colors[shot.color], "#fff", 2);
        e.line(0, 70 + 14 * RAD * 1.78 + RAD * 2 - 6, W, 70 + 14 * RAD * 1.78 + RAD * 2 - 6, "rgba(255,90,90,0.5)", 2);
      },
    };
  } });
})();
