/* Pulse games: running, jumping and dodging (pg-runners.js). Dino Run (the little dinosaur of the offline page, made again), Flappy, Copter, Cube Dash,
   Gravity Flip, Lane Runner, Doodle Jump, Zig-Zag, Dodge Blocks, Crossy Hop and Slalom. Every game is registered in the kit (pg-kit.js). */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;

  /* ------------------------------------------------------------------------------------------------ Dino Run (pixels, grey on white, like the dinosaur of the offline page) */
  const norm = (rows) => { const width = Math.max(...rows.map((r) => r.length)); return rows.map((r) => r.padEnd(width, ".")); };
  const DINO_BODY = norm([
    "..........########..", "..........##.#####..", "..........########..", "..........########..", "..........####......", "..........#######...", "#........####.......", "#.......#####.#.....",
    "##.....########.#...", "###...###########...", ".###.############...", "..###############...", "...#############....", "....###########.....", ".....##########.....",
  ]);
  const DINO_LEGS = [norm([".....####..###......", ".....###...##.......", ".....##....#........", "...........##......."]), norm([".....####..###......", ".....###...##.......", ".....#.....##.......", ".....##............."])];
  const DUCK = [norm([
    "..................#########.", "..................##.#########", "..................###########", "..................####........", "#.................#######.....", "##.....##########.####........",
    "###...#############.#.......", ".################.#.........", "..###############...........", "...##############...........", ".....#####.#####............", ".....###...###..............", ".....##....##...............",
  ]), norm([
    "..................#########.", "..................##.#########", "..................###########", "..................####........", "#.................#######.....", "##.....##########.####........",
    "###...#############.#.......", ".################.#.........", "..###############...........", "...##############...........", ".....#####.#####............", ".....###...###..............", ".....##....###..............",
  ])];
  const CACTUS = norm(["....##...", "....##..#", "#...##..#", "#...##..#", "##..##.##", ".##.#####", "..#####..", "....##...", "....##...", "....##...", "....##...", "....##...", "....##..."]);
  const CACTUS_TALL = norm(["...##...", "...##..#", "#..##..#", "#..##..#", "#..##..#", "##.##.##", ".#####.#", "..#####.", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "...##..."]);
  const PTERA = [norm([".............#......", "............##......", "...........###......", "..........####......", ".........#####......", "####....######.##...", ".###########.####...", "..###########.###...", "....########........", "......######........", ".......####.........", "........##.........."]),
    norm(["....................", "....................", "..###...............", "..####.....#........", "..#####...##........", "..######.####.##....", "...###########.###..", "....###########.##..", ".....########.......", "......######........", "......#####.........", "................"])];
  const CLOUD = norm(["......####......", "...########.....", "##############.#", "################"]);

  R({ id: "dino", name: "Dino Run", emoji: "🦖", cat: "Laufen", color: "#9a9a9a", hint: "Tippen zum Springen · nach unten wischen zum Ducken", create(e) {
    const P = 3, GY = 430, TOP = 215, G = 2600, J = 800, GREY = "#535353";
    let y = 0, vy = 0, duck = false, dist = 0, speed = 250, spawn = 1.1, step = 0, dead = false, night = 0, hi = 0, flash = 0, lastHundred = 0;
    const obs = [];
    const clouds = Array.from({ length: 3 }, () => ({ x: e.rand(0, W), y: e.rand(TOP + 22, TOP + 90) }));
    const bumps = Array.from({ length: 12 }, () => ({ x: e.rand(0, W), w: e.randInt(2, 7), dy: e.randInt(8, 18) }));
    function sprite(rows, x, y0, color, scale = P) {
      e.g.fillStyle = color;
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === "#") e.g.fillRect(Math.round(x + c * scale), Math.round(y0 + r * scale), scale, scale);
    }
    return {
      update(dt) {
        const i = e.input;
        if (dead) return;
        speed = Math.min(620, 250 + dist * 0.045);
        dist += speed * dt;
        const points = Math.floor(dist / 14);
        e.score(points);
        if (Math.floor(points / 100) > lastHundred) { lastHundred = Math.floor(points / 100); flash = 0.6; }
        flash = Math.max(0, flash - dt);
        night += ((Math.floor(points / 500) % 2 ? 1 : 0) - night) * Math.min(1, dt * 2);
        const onGround = y <= 0;
        if ((i.pressed || i.keyPressed(" ") || i.keyPressed("ArrowUp")) && onGround && !duck) { vy = J; y = 0.01; }
        duck = (i.keys.has("ArrowDown") || i.swipe === "down" || (i.down && i.y > GY + 30)) && onGround;
        if (i.swipe === "down" && !onGround) vy = -J;
        vy -= G * dt; y += vy * dt;
        if (y <= 0) { y = 0; vy = 0; }
        step += dt * speed / 22;
        spawn -= dt;
        if (spawn <= 0) {
          if (dist > 2200 && e.rand() < 0.28) obs.push({ kind: "bird", x: W + 30, lift: e.pick([8, 44, 84]), w: 18 * P, h: 12 * P });
          else { const n = e.randInt(1, 3), tall = e.rand() < 0.4; obs.push({ kind: "cactus", x: W + 30, n, tall, lift: 0, w: n * 9 * P - (n - 1) * 3, h: (tall ? 18 : 13) * P }); }
          spawn = 1.05 + e.rand(0, 1.0);
        }
        for (const o of obs) o.x -= (speed + (o.kind === "bird" ? 70 : 0)) * dt;
        while (obs.length && obs[0].x < -90) obs.shift();
        for (const c of clouds) { c.x -= speed * 0.12 * dt; if (c.x < -60) { c.x = W + 40; c.y = e.rand(TOP + 22, TOP + 90); } }
        for (const b of bumps) { b.x -= speed * dt; if (b.x < -10) { b.x = W + e.rand(0, 40); b.w = e.randInt(2, 7); b.dy = e.randInt(8, 18); } }
        const me = duck ? { x: 52 + 6, y: GY - y - 13 * P + 6, w: 24 * P - 14, h: 13 * P - 8 } : { x: 52 + 12, y: GY - y - 20 * P + 4, w: 14 * P, h: 20 * P - 8 };
        for (const o of obs) {
          const box = o.kind === "bird" ? { x: o.x + 6, y: GY - o.lift - o.h + 8, w: o.w - 12, h: o.h - 14 } : { x: o.x + 6, y: GY - o.h + 4, w: o.w - 12, h: o.h - 4 };
          if (e.hit(me, box)) { dead = true; hi = Math.max(hi, points); e.over(); }
        }
      },
      draw() {
        const ink = night > 0.5 ? "#f2f2f2" : GREY;
        e.panel(8, TOP, W - 16, 255, 14, 0.9, night > 0.5 ? "32,32,32" : "255,255,255");
        const pad = (n) => String(n).padStart(5, "0");
        e.text(`HI ${pad(hi)}  ${pad(Math.floor(dist / 14))}`, W - 22, TOP + 24, { size: 17, align: "right", color: flash > 0 && Math.floor(flash * 10) % 2 ? night > 0.5 ? "#202020" : "#fff" : ink, stroke: false, weight: 700 });
        for (const c of clouds) sprite(CLOUD, c.x, c.y, night > 0.5 ? "#6a6a6a" : "#c9c9c9", 3);
        e.rect(8, GY + 1, W - 16, 2, ink);
        for (const b of bumps) if (b.x > 8 && b.x < W - 12) e.rect(b.x, GY + b.dy, b.w, 2, night > 0.5 ? "#808080" : "#9c9c9c");
        for (const o of obs) {
          if (o.kind === "cactus") for (let n = 0; n < o.n; n++) sprite(o.tall ? CACTUS_TALL : CACTUS, o.x + n * (9 * P - 3), GY - o.h, ink);
          else sprite(PTERA[Math.floor(step * 0.7) % 2], o.x, GY - o.lift - o.h, ink);
        }
        if (dead) sprite([...DINO_BODY, ...DINO_LEGS[0]], 52, GY - y - 20 * P, ink);
        else if (duck) sprite(DUCK[Math.floor(step) % 2], 52, GY - y - 13 * P, ink);
        else if (y > 0) sprite([...DINO_BODY, ...DINO_LEGS[0]], 52, GY - y - 20 * P, ink);
        else sprite([...DINO_BODY, ...DINO_LEGS[Math.floor(step) % 2]], 52, GY - y - 20 * P, ink);
        if (dead) { e.text("G A M E   O V E R", W / 2, TOP + 95, { size: 22, color: ink, stroke: false, weight: 800 }); }
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Flappy */
  R({ id: "flappy", name: "Flappy", emoji: "🐤", cat: "Laufen", color: "#f6c945", hint: "Tippen, damit der Vogel flattert", create(e) {
    const GAP = 150;
    let y = H / 2, vy = 0, t = 0, spawn = 0.4, pipes = [], passed = 0, started = false;
    return {
      update(dt) {
        const i = e.input;
        if (i.pressed || i.keyPressed(" ") || i.keyPressed("ArrowUp")) { vy = -420; started = true; }
        if (!started) { y = H / 2 + Math.sin(t * 4) * 10; t += dt; return; }
        t += dt;
        vy += 1250 * dt; y += vy * dt;
        spawn -= dt;
        if (spawn <= 0) { pipes.push({ x: W + 30, gap: e.rand(170, H - 170), scored: false }); spawn = 1.55; }
        for (const p of pipes) {
          p.x -= 150 * dt;
          if (!p.scored && p.x + 30 < 90) { p.scored = true; passed += 1; e.score(passed); }
          if (90 + 14 > p.x - 28 && 90 - 14 < p.x + 28 && (y - 14 < p.gap - GAP / 2 || y + 14 > p.gap + GAP / 2)) e.over();
        }
        while (pipes.length && pipes[0].x < -60) pipes.shift();
        if (y > H - 60 || y < -20) e.over();
      },
      draw() {
        for (const p of pipes) {
          e.rect(p.x - 28, 0, 56, p.gap - GAP / 2, "#3bb54a", 8); e.rect(p.x - 34, p.gap - GAP / 2 - 22, 68, 22, "#2d9a3b", 6);
          e.rect(p.x - 28, p.gap + GAP / 2, 56, H, "#3bb54a", 8); e.rect(p.x - 34, p.gap + GAP / 2, 68, 22, "#2d9a3b", 6);
        }
        e.rect(0, H - 50, W, 50, "rgba(150,110,50,0.9)");
        e.emoji("🐤", 90, y, 40, Math.max(-0.5, Math.min(0.9, vy / 700)));
        if (!started) e.text("Tippen!", W / 2, 200, { size: 34 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Copter */
  R({ id: "copter", name: "Copter", emoji: "🚁", cat: "Laufen", color: "#59a7ff", hint: "Halten zum Steigen, loslassen zum Sinken", create(e) {
    let y = H / 2, vy = 0, dist = 0, spawn = 0, blocks = [];
    return {
      update(dt) {
        const up = e.input.down || e.input.keys.has(" ") || e.input.keys.has("ArrowUp");
        vy += (up ? -900 : 800) * dt; vy = Math.max(-340, Math.min(380, vy)); y += vy * dt;
        const speed = 170 + Math.min(150, dist * 0.02);
        dist += speed * dt; e.score(dist / 10);
        spawn -= dt;
        if (spawn <= 0) { const h = e.rand(70, 160); blocks.push({ x: W + 20, y: e.rand(90, H - 90 - h), w: 36, h }); spawn = e.rand(0.9, 1.5); }
        for (const b of blocks) { b.x -= speed * dt; if (e.hit({ x: 80, y: y - 12, w: 40, h: 24 }, { x: b.x, y: b.y, w: b.w, h: b.h })) e.over(); }
        while (blocks.length && blocks[0].x < -60) blocks.shift();
        if (y < 40 || y > H - 40) e.over();
      },
      draw() {
        e.rect(0, 0, W, 34, "rgba(0,0,0,0.45)"); e.rect(0, H - 34, W, 34, "rgba(0,0,0,0.45)");
        for (const b of blocks) e.rect(b.x, b.y, b.w, b.h, "#ff6b6b", 8);
        e.emoji("🚁", 100, y, 44, vy / 900);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Cube Dash */
  R({ id: "cube-dash", name: "Cube Dash", emoji: "🟦", cat: "Laufen", color: "#6c7bff", hint: "Tippen zum Springen über die Spitzen", create(e) {
    const GY = 500;
    let y = 0, vy = 0, rot = 0, dist = 0, obs = [], spawn = 0.8, speed = 280;
    return {
      update(dt) {
        const i = e.input;
        speed = Math.min(520, 280 + dist * 0.03);
        dist += speed * dt; e.score(dist / 20);
        if ((i.down || i.keys.has(" ") || i.keys.has("ArrowUp")) && y <= 0) { vy = 760; y = 0.01; }
        vy -= 2600 * dt; y += vy * dt;
        if (y > 0) rot += dt * 7; else { y = 0; vy = 0; rot = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2); }
        spawn -= dt;
        if (spawn <= 0) { const n = e.randInt(1, 3); obs.push({ x: W + 30, n, block: e.rand() < 0.25 }); spawn = 0.85 + e.rand(0, 0.8) + (n - 1) * 0.15; }
        for (const o of obs) o.x -= speed * dt;
        while (obs.length && obs[0].x < -120) obs.shift();
        const me = { x: 70, y: GY - y - 34, w: 34, h: 34 };
        for (const o of obs) {
          if (o.block) { if (e.hit({ x: me.x + 3, y: me.y + 3, w: me.w - 6, h: me.h - 6 }, { x: o.x, y: GY - 34, w: 34, h: 34 })) e.over(); }
          else for (let k = 0; k < o.n; k++) if (e.hit({ x: me.x + 6, y: me.y + 6, w: me.w - 12, h: me.h - 10 }, { x: o.x + k * 28 + 8, y: GY - 28, w: 16, h: 28 })) e.over();
        }
      },
      draw() {
        e.rect(0, GY, W, 8, "rgba(255,255,255,0.9)");
        for (const o of obs) {
          if (o.block) e.rect(o.x, GY - 34, 34, 34, "#2d3a7a", 4);
          else for (let k = 0; k < o.n; k++) { e.g.fillStyle = "#ff4d6d"; e.g.beginPath(); e.g.moveTo(o.x + k * 28, GY); e.g.lineTo(o.x + k * 28 + 14, GY - 32); e.g.lineTo(o.x + k * 28 + 28, GY); e.g.closePath(); e.g.fill(); }
        }
        e.g.save(); e.g.translate(87, GY - y - 17); e.g.rotate(rot); e.rect(-17, -17, 34, 34, "#4cc9ff", 6); e.rect(-8, -8, 6, 8, "#fff"); e.rect(4, -8, 6, 8, "#fff"); e.g.restore();
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Gravity Flip */
  R({ id: "gravity-flip", name: "Gravity Flip", emoji: "🔃", cat: "Laufen", color: "#b46bff", hint: "Tippen kehrt die Schwerkraft um", create(e) {
    const TOP = 150, BOT = 490;
    let dir = 1, y = BOT - 30, vy = 0, dist = 0, spikes = [], spawn = 0.9;
    return {
      update(dt) {
        const speed = 230 + Math.min(180, dist * 0.02);
        dist += speed * dt; e.score(dist / 15);
        if (e.input.pressed || e.input.keyPressed(" ") || e.input.keyPressed("ArrowUp")) { dir *= -1; }
        vy += dir * 2600 * dt; vy = Math.max(-900, Math.min(900, vy)); y += vy * dt;
        if (y > BOT - 22) { y = BOT - 22; vy = 0; } if (y < TOP + 22) { y = TOP + 22; vy = 0; }
        spawn -= dt;
        if (spawn <= 0) { spawn = 0.8 + e.rand(0, 0.8); spikes.push({ x: W + 30, top: e.rand() < 0.5 }); }
        for (const s of spikes) {
          s.x -= speed * dt;
          const box = { x: s.x + 6, y: s.top ? TOP : BOT - 40, w: 24, h: 40 };
          if (e.hit({ x: 64, y: y - 14, w: 28, h: 28 }, box)) e.over();
        }
        while (spikes.length && spikes[0].x < -50) spikes.shift();
      },
      draw() {
        e.rect(0, TOP - 14, W, 14, "rgba(255,255,255,0.9)"); e.rect(0, BOT, W, 14, "rgba(255,255,255,0.9)");
        for (const s of spikes) {
          e.g.fillStyle = "#ff5c8a"; e.g.beginPath();
          if (s.top) { e.g.moveTo(s.x, TOP); e.g.lineTo(s.x + 18, TOP + 40); e.g.lineTo(s.x + 36, TOP); } else { e.g.moveTo(s.x, BOT); e.g.lineTo(s.x + 18, BOT - 40); e.g.lineTo(s.x + 36, BOT); }
          e.g.closePath(); e.g.fill();
        }
        e.rect(50, y - 14, 28, 28, "#ffd23f", 7);
        e.text(dir > 0 ? "▼" : "▲", 64, y, { size: 14, color: "#333", stroke: false });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Lane Runner */
  R({ id: "lane-runner", name: "Lane Runner", emoji: "🏃", cat: "Laufen", color: "#ff8a4c", hint: "Nach links oder rechts wischen, Hindernissen ausweichen", create(e) {
    const X = [90, 180, 270];
    let lane = 1, px = 180, dist = 0, items = [], spawn = 0.5, coins = 0;
    return {
      update(dt) {
        const i = e.input;
        if (i.swipe === "left" || i.keyPressed("ArrowLeft") || i.keyPressed("a")) lane = Math.max(0, lane - 1);
        if (i.swipe === "right" || i.keyPressed("ArrowRight") || i.keyPressed("d")) lane = Math.min(2, lane + 1);
        if (i.tap) lane = i.x < px ? Math.max(0, lane - 1) : Math.min(2, lane + 1);
        px += (X[lane] - px) * Math.min(1, dt * 14);
        const speed = 260 + Math.min(260, dist * 0.02);
        dist += speed * dt; e.score(dist / 20 + coins * 5);
        spawn -= dt;
        if (spawn <= 0) {
          spawn = Math.max(0.35, 0.8 - dist * 0.00006) + e.rand(0, 0.3);
          const l = e.randInt(0, 2);
          items.push({ lane: l, y: -40, kind: e.rand() < 0.28 ? "coin" : e.pick(["rock", "cone"]) });
        }
        for (const it of items) it.y += speed * dt;
        for (const it of items) {
          if (it.dead) continue;
          if (Math.abs(X[it.lane] - px) < 30 && Math.abs(it.y - 500) < 30) { if (it.kind === "coin") { coins += 1; it.dead = true; } else e.over(); }
        }
        for (let k = items.length - 1; k >= 0; k--) if (items[k].dead || items[k].y > H + 40) items.splice(k, 1);
      },
      draw() {
        e.panel(40, 0, 280, H, 0, 0.35);
        for (let k = 0; k < 2; k++) for (let n = 0; n < 12; n++) e.rect(135 + k * 90, ((n * 70 + dist * 0.9) % 840) - 40, 4, 34, "rgba(255,255,255,0.6)");
        for (const it of items) e.emoji(it.kind === "coin" ? "🪙" : it.kind === "rock" ? "🪨" : "🚧", X[it.lane], it.y, 44);
        e.emoji("🏃", px, 500, 54);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Doodle Jump */
  R({ id: "doodle-jump", name: "Doodle Jump", emoji: "🐸", cat: "Laufen", color: "#7ed957", hint: "Finger oder Maus bewegen: der Frosch springt von selbst", create(e) {
    let x = W / 2, y = 480, vy = -700, top = 0, plats = [];
    for (let k = 0; k < 9; k++) plats.push({ x: e.rand(20, W - 80), y: H - 40 - k * 75, w: 64, moving: false });
    plats[0] = { x: W / 2 - 32, y: 520, w: 64, moving: false };
    return {
      update(dt) {
        const i = e.input;
        if (i.down) x += (i.x - x) * Math.min(1, dt * 12);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 300 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 300 * dt;
        x = (x + W) % W;
        const before = y;
        vy += 1400 * dt; y += vy * dt;
        if (vy > 0) for (const p of plats) if (x > p.x - 8 && x < p.x + p.w + 8 && before + 22 <= p.y + 2 && y + 22 >= p.y) { vy = -700; y = p.y - 22; }
        if (y < 340) { const d = 340 - y; y = 340; top += d; for (const p of plats) p.y += d; e.score(top / 8); }
        for (const p of plats) if (p.moving) { p.x += p.dir * 60 * dt; if (p.x < 0 || p.x + p.w > W) p.dir *= -1; }
        while (plats.length && plats[0].y > H + 20) plats.shift();
        while (plats.length < 10) {
          const last = plats[plats.length - 1];
          const gap = Math.min(125, 62 + top / 400);
          const moving = top > 600 && e.rand() < 0.25;
          plats.push({ x: e.rand(10, W - 74), y: last.y - e.rand(55, gap), w: 64, moving, dir: e.rand() < 0.5 ? -1 : 1 });
        }
        if (y > H + 40) e.over();
      },
      draw() {
        for (const p of plats) e.rect(p.x, p.y, p.w, 12, p.moving ? "#4cc9ff" : "#6bd45f", 6);
        e.emoji("🐸", x, y, 44);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Zig-Zag */
  R({ id: "zigzag", name: "Zig-Zag", emoji: "↯", cat: "Laufen", color: "#ff5c9a", hint: "Tippen wechselt die Richtung. Bleib auf dem Weg!", create(e) {
    // the road is a chain of diagonal pieces (always 45 degrees); the ball runs at 45 degrees too and turns with every tap
    const pts = [{ x: 180, y: 560 }];
    let turn = 1;
    function extend() {
      const last = pts[pts.length - 1];
      const room = turn > 0 ? 300 - last.x : last.x - 60;
      const step = e.rand(80, Math.max(80, Math.min(160, room)));
      pts.push({ x: last.x + turn * step, y: last.y - step });
      turn *= -1;
    }
    for (let k = 0; k < 14; k++) extend();
    let t = 0, bx = 180, by = 560, bdir = 1;
    const road = (yy) => {                                          // x of the middle of the road at height yy
      for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; if (yy <= a.y && yy >= b.y) return a.x + (b.x - a.x) * ((a.y - yy) / (a.y - b.y)); }
      return null;
    };
    return {
      update(dt) {
        t += dt;
        if (e.input.pressed || e.input.keyPressed(" ") || e.input.keyPressed("ArrowLeft") || e.input.keyPressed("ArrowRight")) bdir *= -1;
        const speed = 170 + Math.min(130, t * 3.5);
        bx += bdir * speed * dt;
        by -= speed * dt;
        e.score(t * 2 + (560 - by) / 40);
        while (pts[pts.length - 1].y > by - 700) extend();
        const middle = road(by);
        if (middle === null || Math.abs(bx - middle) > 28) e.over();
      },
      draw() {
        e.g.save();
        e.g.translate(0, 440 - by);
        e.g.lineCap = "round"; e.g.lineJoin = "round";
        e.g.lineWidth = 56; e.g.strokeStyle = "rgba(40,40,60,0.75)";
        e.g.beginPath(); pts.forEach((p, k) => (k ? e.g.lineTo(p.x, p.y) : e.g.moveTo(p.x, p.y))); e.g.stroke();
        e.g.lineWidth = 3; e.g.strokeStyle = "rgba(255,255,255,0.5)";
        e.g.beginPath(); pts.forEach((p, k) => (k ? e.g.lineTo(p.x, p.y) : e.g.moveTo(p.x, p.y))); e.g.stroke();
        e.circle(bx, by, 13, "#ffd23f", "#fff", 3);
        e.g.restore();
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Dodge Blocks */
  R({ id: "dodge-blocks", name: "Ausweichen", emoji: "🧱", cat: "Laufen", color: "#ff7a59", hint: "Bewege den Finger links und rechts: weich den Blöcken aus", create(e) {
    let x = W / 2, t = 0, blocks = [], spawn = 0.3;
    return {
      update(dt) {
        const i = e.input;
        t += dt; e.score(t * 5);
        if (i.down) x += (i.x - x) * Math.min(1, dt * 16);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 320 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 320 * dt;
        x = e.clamp(x, 20, W - 20);
        spawn -= dt;
        if (spawn <= 0) { spawn = Math.max(0.18, 0.55 - t * 0.006); const w = e.rand(34, 80); blocks.push({ x: e.rand(0, W - w), y: -30, w, h: 26, v: e.rand(200, 260) + t * 4 }); }
        for (const b of blocks) { b.y += b.v * dt; if (e.hit({ x: x - 14, y: 560, w: 28, h: 30 }, { x: b.x, y: b.y, w: b.w, h: b.h })) e.over(); }
        while (blocks.length && blocks[0].y > H + 40) blocks.shift();
        blocks.sort((a, b) => a.y - b.y);
      },
      draw() {
        for (const b of blocks) e.rect(b.x, b.y, b.w, b.h, "#ff6b4a", 6);
        e.emoji("🤠", x, 574, 40);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Crossy Hop */
  R({ id: "crossy-hop", name: "Crossy Hop", emoji: "🐔", cat: "Laufen", color: "#ffd24c", hint: "Tippen: vor · Wischen: zur Seite · Weich den Autos aus", create(e) {
    const CELL = 50;
    let gx = 3, gy = 0, best = 0, rows = [], moveTimer = 0, idle = 0;
    function makeRow(n) { if (n < 2) return { n, type: "grass", cars: [] }; const road = e.rand() < 0.65; return { n, type: road ? "road" : "grass", dir: e.rand() < 0.5 ? -1 : 1, speed: e.rand(60, 150) + Math.min(120, n * 2), cars: road ? Array.from({ length: e.randInt(2, 3) }, (_, k) => ({ x: k * e.rand(120, 190), w: e.rand(44, 70) })) : [] }; }
    for (let n = 0; n < 16; n++) rows.push(makeRow(n));
    const rowAt = (n) => { while (rows.length <= n + 14) rows.push(makeRow(rows.length)); return rows[n]; };
    return {
      update(dt) {
        const i = e.input;
        moveTimer -= dt;
        if (moveTimer <= 0) {
          let mx = 0, my = 0;
          if (i.tap || i.keyPressed("ArrowUp") || i.keyPressed("w")) my = 1;
          else if (i.swipe === "left" || i.keyPressed("ArrowLeft")) mx = -1;
          else if (i.swipe === "right" || i.keyPressed("ArrowRight")) mx = 1;
          else if (i.swipe === "down" || i.keyPressed("ArrowDown")) my = -1;
          if (mx || my) { gx = e.clamp(gx + mx, 0, 6); gy = Math.max(0, gy + my); moveTimer = 0.08; if (gy > best) { best = gy; idle = 0; e.score(best); } }
        }
        for (let n = Math.max(0, gy - 5); n <= gy + 12; n++) { const r = rowAt(n); for (const c of r.cars) { c.x += r.dir * r.speed * dt; if (r.dir > 0 && c.x > 420) c.x = -c.w - e.rand(0, 120); if (r.dir < 0 && c.x + c.w < -60) c.x = 420 + e.rand(0, 120); } }
        const row = rowAt(gy);
        for (const c of row.cars) if (gx * CELL + 5 < c.x + c.w && gx * CELL + CELL - 5 > c.x) e.over();
        idle += dt;
        if (best - gy > 3 || idle > 7) e.over();                      // whoever waits too long is picked up by the eagle
      },
      draw() {
        const baseY = 540;
        for (let n = Math.max(0, gy - 6); n <= gy + 12; n++) {
          const r = rowAt(n);
          const y = baseY - (n - gy) * CELL;
          e.rect(0, y - CELL + 2, W + 20, CELL - 2, r.type === "road" ? "rgba(50,50,60,0.8)" : n % 2 ? "rgba(70,160,70,0.7)" : "rgba(86,180,86,0.7)");
          for (const c of r.cars) e.rect(c.x, y - CELL + 10, c.w, CELL - 18, "#ff5d5d", 8);
        }
        e.emoji("🐔", gx * CELL + CELL / 2, baseY - CELL / 2, 40);
        if (idle > 4.5) e.emoji("🦅", gx * CELL + CELL / 2, baseY - CELL / 2 - (7 - idle) * 40, 52);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Slalom */
  R({ id: "slalom", name: "Slalom", emoji: "⛷️", cat: "Laufen", color: "#7ad7ff", hint: "Finger links/rechts bewegen: fahr zwischen den Bäumen durch", create(e) {
    let x = W / 2, dist = 0, trees = [], spawn = 0;
    return {
      update(dt) {
        const i = e.input;
        const speed = 240 + Math.min(260, dist * 0.015);
        dist += speed * dt; e.score(dist / 25);
        if (i.down) x += (i.x - x) * Math.min(1, dt * 8);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 260 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 260 * dt;
        x = e.clamp(x, 16, W - 16);
        spawn -= dt;
        if (spawn <= 0) { spawn = Math.max(0.14, 0.45 - dist * 0.00002); trees.push({ x: e.rand(10, W - 10), y: H + 30, kind: e.rand() < 0.2 ? "🪨" : "🌲" }); }
        for (const t of trees) { t.y -= speed * dt; if (Math.abs(t.x - x) < 20 && Math.abs(t.y - 190) < 22) e.over(); }
        while (trees.length && trees[0].y < -50) trees.shift();
      },
      draw() {
        for (const t of trees) e.emoji(t.kind, t.x, t.y, 44);
        e.emoji("⛷️", x, 190, 46);
      },
    };
  } });
})();
