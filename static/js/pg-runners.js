/* Pulse games: running, jumping and dodging (pg-runners.js). Dino Run (the little dinosaur of the offline page, made again), Flappy, Copter, Cube Dash,
   Gravity Flip, Lane Runner, Doodle Jump, Zig-Zag, Dodge Blocks, Crossy Hop and Slalom. Every game is registered in the kit (pg-kit.js) and draws a whole little
   world with the pieces of pg-art.js (sky, hills, ground, shadows, puffs); the face of the player sits in a bubble (bubble: true) because the scene covers the camera. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const Art = window.PulseArt;
  const PAL = Art.PALETTES;
  const W = 360;
  const H = 640;
  const TAU = Math.PI * 2;
  const mod = (a, n) => ((a % n) + n) % n;

  /* ------------------------------------------------------------------------------------------------ Dino Run (pixels, like the dinosaur of the offline page, but in a desert) */
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

  R({ id: "dino", name: "Dino Run", emoji: "🦖", cat: "Laufen", color: "#4caf50", bubble: true, hint: "Tippen zum Springen · nach unten wischen zum Ducken", create(e) {
    const P = 3, GY = 430, G = 2600, J = 800, g = e.g;
    let y = 0, vy = 0, duck = false, dist = 0, speed = 250, spawn = 1.1, step = 0, dead = false, night = 0, hi = 0, flash = 0, lastHundred = 0, clock = 0;
    const obs = [];
    const fx = Art.fx();
    const clouds = Array.from({ length: 4 }, () => ({ x: e.rand(0, W), y: e.rand(60, 230), s: e.rand(0.7, 1.2) }));
    const bumps = Array.from({ length: 14 }, () => ({ x: e.rand(0, W), w: e.randInt(2, 7), dy: e.randInt(14, 90) }));
    function sprite(rows, x, y0, color, scale = P) {
      g.fillStyle = "rgba(0,0,0,0.22)";
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === "#") g.fillRect(Math.round(x + c * scale) + 2, Math.round(y0 + r * scale) + 3, scale, scale);
      g.fillStyle = color;
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === "#") g.fillRect(Math.round(x + c * scale), Math.round(y0 + r * scale), scale, scale);
    }
    return {
      update(dt) {
        const i = e.input;
        clock += dt;
        fx.update(dt);
        if (dead) return;
        speed = Math.min(620, 250 + dist * 0.045);
        dist += speed * dt;
        const points = Math.floor(dist / 14);
        e.score(points);
        if (Math.floor(points / 100) > lastHundred) { lastHundred = Math.floor(points / 100); flash = 0.6; }
        flash = Math.max(0, flash - dt);
        night += ((Math.floor(points / 500) % 2 ? 1 : 0) - night) * Math.min(1, dt * 2);
        const onGround = y <= 0;
        if ((i.pressed || i.keyPressed(" ") || i.keyPressed("ArrowUp")) && onGround && !duck) { vy = J; y = 0.01; fx.burst(70, GY, "rgba(255,230,180,0.9)", 6, 70, 0.4, 200); }
        duck = (i.keys.has("ArrowDown") || i.swipe === "down" || (i.down && i.y > GY + 30)) && onGround;
        if (i.swipe === "down" && !onGround) vy = -J;
        const wasAir = y > 0;
        vy -= G * dt; y += vy * dt;
        if (y <= 0) { if (wasAir && y < 0) fx.burst(80, GY, "rgba(255,230,180,0.9)", 5, 60, 0.35, 160); y = 0; vy = 0; }
        step += dt * speed / 22;
        if (y <= 0 && !dead && Math.floor(step * 2) !== Math.floor((step - dt * speed / 22) * 2)) fx.burst(62, GY, "rgba(255,230,180,0.6)", 1, 30, 0.3, 80);
        spawn -= dt;
        if (spawn <= 0) {
          if (dist > 2200 && e.rand() < 0.28) obs.push({ kind: "bird", x: W + 30, lift: e.pick([8, 44, 84]), w: 18 * P, h: 12 * P });
          else { const n = e.randInt(1, 3), tall = e.rand() < 0.4; obs.push({ kind: "cactus", x: W + 30, n, tall, lift: 0, w: n * 9 * P - (n - 1) * 3, h: (tall ? 18 : 13) * P }); }
          spawn = 1.05 + e.rand(0, 1.0);
        }
        for (const o of obs) o.x -= (speed + (o.kind === "bird" ? 70 : 0)) * dt;
        while (obs.length && obs[0].x < -90) obs.shift();
        for (const c of clouds) { c.x -= speed * 0.12 * dt; if (c.x < -90) { c.x = W + 40; c.y = e.rand(60, 230); } }
        for (const b of bumps) { b.x -= speed * dt; if (b.x < -10) { b.x = W + e.rand(0, 40); b.w = e.randInt(2, 7); b.dy = e.randInt(14, 90); } }
        const me = duck ? { x: 52 + 6, y: GY - y - 13 * P + 6, w: 24 * P - 14, h: 13 * P - 8 } : { x: 52 + 12, y: GY - y - 20 * P + 4, w: 14 * P, h: 20 * P - 8 };
        for (const o of obs) {
          const box = o.kind === "bird" ? { x: o.x + 6, y: GY - o.lift - o.h + 8, w: o.w - 12, h: o.h - 14 } : { x: o.x + 6, y: GY - o.h + 4, w: o.w - 12, h: o.h - 4 };
          if (e.hit(me, box)) { dead = true; hi = Math.max(hi, points); fx.burst(me.x + me.w / 2, me.y + me.h / 2, "#fff", 14, 220, 0.6, 500); e.over(); }
        }
      },
      draw() {
        const both = (paint) => { paint(PAL.desert); if (night > 0.02) { g.globalAlpha = Math.min(1, night); paint(PAL.night); g.globalAlpha = 1; } };
        Art.sky(g, PAL.desert, clock, { alpha: 1, sunX: 285, sunY: 120 });
        if (night > 0.02) Art.sky(g, PAL.night, clock, { alpha: night, sunX: 75, sunY: 130 });
        for (const c of clouds) Art.cloud(g, c.x, c.y, c.s, night > 0.5 ? "rgba(150,160,255,0.25)" : "rgba(255,255,255,0.75)");
        both((pal) => { Art.hills(g, pal.hill1, GY - 40, dist, { amp: 60, length: 90, speed: 0.12 }); Art.hills(g, pal.hill2, GY - 10, dist, { amp: 34, length: 55, phase: 2, speed: 0.3 }); });
        both((pal) => Art.ground(g, pal, GY, dist, { stripe: false }));
        for (const b of bumps) if (b.x > -8 && b.x < W) { g.fillStyle = "rgba(0,0,0,0.16)"; g.fillRect(b.x, GY + b.dy / 2, b.w * 3, 3); }
        const cactus = night > 0.5 ? "#5fd07a" : "#2f9a47";
        const pteraColor = night > 0.5 ? "#c4a8ff" : "#8a55e8";
        const dino = night > 0.5 ? "#8ef0a0" : "#43b04f";
        for (const o of obs) {
          if (o.kind === "cactus") { Art.shadow(g, o.x + o.w / 2, GY + 3, o.w + 8, 0.22); for (let n = 0; n < o.n; n++) sprite(o.tall ? CACTUS_TALL : CACTUS, o.x + n * (9 * P - 3), GY - o.h, cactus); }
          else { Art.shadow(g, o.x + o.w / 2, GY + 3, 26, 0.12); sprite(PTERA[Math.floor(step * 0.7) % 2], o.x, GY - o.lift - o.h, pteraColor); }
        }
        Art.shadow(g, 52 + 28, GY + 3, Math.max(20, 56 - y * 0.12), Math.max(0.06, 0.26 - y * 0.0006));
        if (dead) sprite([...DINO_BODY, ...DINO_LEGS[0]], 52, GY - y - 20 * P, dino);
        else if (duck) sprite(DUCK[Math.floor(step) % 2], 52, GY - y - 13 * P, dino);
        else if (y > 0) sprite([...DINO_BODY, ...DINO_LEGS[0]], 52, GY - y - 20 * P, dino);
        else sprite([...DINO_BODY, ...DINO_LEGS[Math.floor(step) % 2]], 52, GY - y - 20 * P, dino);
        fx.draw(g);
        const pad = (n) => String(n).padStart(5, "0");
        Art.chip(g, `HI ${pad(hi)}   ${pad(Math.floor(dist / 14))}`, W - 14, 34, { size: 16, align: "right", color: flash > 0 && Math.floor(flash * 10) % 2 ? "#ffe066" : "#fff" });
        if (dead) e.text("GAME OVER", W / 2, 200, { size: 34 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Flappy */
  R({ id: "flappy", name: "Flappy", emoji: "🐤", cat: "Laufen", color: "#f6c945", bubble: true, hint: "Tippen, damit der Vogel flattert", create(e) {
    const GAP = 150, g = e.g, GROUND = H - 50;
    let y = H / 2, vy = 0, t = 0, spawn = 0.4, pipes = [], passed = 0, started = false, scroll = 0, flap = 0;
    const fx = Art.fx();
    function pipe(x, from, to, capAtBottom) {
      const body = g.createLinearGradient(x - 28, 0, x + 28, 0);
      body.addColorStop(0, "#2b8a37"); body.addColorStop(0.3, "#79e06a"); body.addColorStop(0.6, "#4fc24a"); body.addColorStop(1, "#27782f");
      g.fillStyle = body; g.fillRect(x - 26, from, 52, to - from);
      const capY = capAtBottom ? to - 24 : from;
      g.fillStyle = body; g.beginPath(); g.roundRect ? g.roundRect(x - 33, capY, 66, 24, 7) : g.rect(x - 33, capY, 66, 24); g.fill();
      g.lineWidth = 2.5; g.strokeStyle = "#1d5e26"; g.beginPath(); g.roundRect ? g.roundRect(x - 33, capY, 66, 24, 7) : g.rect(x - 33, capY, 66, 24); g.stroke();
      g.strokeRect(x - 26, from, 52, to - from);
    }
    function bird(x, yy, angle, wing) {
      g.save(); g.translate(x, yy); g.rotate(angle);
      g.fillStyle = "#e08a00"; g.beginPath(); g.ellipse(0, 1, 19, 16, 0, 0, TAU); g.fill();
      const body = g.createRadialGradient(-4, -6, 3, 0, 0, 20);
      body.addColorStop(0, "#fff08a"); body.addColorStop(1, "#ffc928");
      g.fillStyle = body; g.beginPath(); g.ellipse(0, 0, 17.5, 14.5, 0, 0, TAU); g.fill();
      g.fillStyle = "#fff5c4"; g.beginPath(); g.ellipse(2, 7, 11, 6, 0, 0, TAU); g.fill();
      g.save(); g.translate(-5, 2); g.rotate(-0.5 + Math.sin(wing) * 0.9);
      g.fillStyle = "#ffb703"; g.beginPath(); g.ellipse(-5, 0, 10, 6, 0, 0, TAU); g.fill(); g.strokeStyle = "#e08a00"; g.lineWidth = 2; g.stroke();
      g.restore();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(8, -5, 6, 0, TAU); g.fill();
      g.fillStyle = "#222"; g.beginPath(); g.arc(10, -5, 3, 0, TAU); g.fill();
      g.fillStyle = "#ff7a1a"; g.beginPath(); g.moveTo(14, -1); g.lineTo(28, 3); g.lineTo(14, 8); g.closePath(); g.fill();
      g.restore();
    }
    return {
      update(dt) {
        const i = e.input;
        fx.update(dt);
        flap = Math.max(0, flap - dt);
        if (i.pressed || i.keyPressed(" ") || i.keyPressed("ArrowUp")) { vy = -420; started = true; flap = 0.3; fx.burst(80, y + 8, "rgba(255,255,255,0.8)", 4, 60, 0.35, 120); }
        if (!started) { y = H / 2 + Math.sin(t * 4) * 10; t += dt; scroll += 40 * dt; return; }
        t += dt;
        scroll += 150 * dt;
        vy += 1250 * dt; y += vy * dt;
        spawn -= dt;
        if (spawn <= 0) { pipes.push({ x: W + 30, gap: e.rand(170, H - 170), scored: false }); spawn = 1.55; }
        for (const p of pipes) {
          p.x -= 150 * dt;
          if (!p.scored && p.x + 30 < 90) { p.scored = true; passed += 1; e.score(passed); }
          if (90 + 14 > p.x - 28 && 90 - 14 < p.x + 28 && (y - 14 < p.gap - GAP / 2 || y + 14 > p.gap + GAP / 2)) { fx.burst(90, y, "#ffd23f", 10, 200, 0.6, 500); e.over(); }
        }
        while (pipes.length && pipes[0].x < -60) pipes.shift();
        fx.drift(-150 * dt);
        if (y > H - 60 || y < -20) e.over();
      },
      draw() {
        Art.sky(g, PAL.day, t, { alpha: 1, sunX: 290, sunY: 110 });
        Art.clouds(g, PAL.day, scroll, { y: 70, rows: 3 });
        Art.hills(g, PAL.day.hill1, GROUND - 30, scroll, { amp: 70, length: 80, speed: 0.15 });
        Art.hills(g, PAL.day.hill2, GROUND - 4, scroll, { amp: 40, length: 50, phase: 1.7, speed: 0.4 });
        for (const p of pipes) { pipe(p.x, -4, p.gap - GAP / 2, true); pipe(p.x, p.gap + GAP / 2, GROUND + 4, false); }
        Art.ground(g, PAL.day, GROUND, scroll, { height: 50 });
        fx.draw(g);
        bird(90, y, Math.max(-0.5, Math.min(1.1, vy / 650)), flap > 0 || !started ? t * 24 : 0);
        if (!started) {
          e.text("Tippen!", W / 2, 210, { size: 38 });
          Art.sprite(g, "👆", W / 2, 270 + Math.sin(t * 6) * 8, 40);
        } else {
          e.text(String(passed), W / 2, 70, { size: 52 });
        }
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Copter */
  R({ id: "copter", name: "Copter", emoji: "🚁", cat: "Laufen", color: "#59a7ff", bubble: true, hint: "Halten zum Steigen, loslassen zum Sinken", create(e) {
    const g = e.g;
    let y = H / 2, vy = 0, dist = 0, spawn = 0, blocks = [], clock = 0, smoke = 0;
    const fx = Art.fx();
    return {
      update(dt) {
        const up = e.input.down || e.input.keys.has(" ") || e.input.keys.has("ArrowUp");
        clock += dt;
        fx.update(dt);
        vy += (up ? -900 : 800) * dt; vy = Math.max(-340, Math.min(380, vy)); y += vy * dt;
        const speed = 170 + Math.min(150, dist * 0.02);
        dist += speed * dt; e.score(dist / 10);
        smoke -= dt;
        if (smoke <= 0) { smoke = 0.05; fx.trail(78, y + 4, "rgba(220,225,255,0.55)", 5 + Math.random() * 3, 0.5); }
        spawn -= dt;
        if (spawn <= 0) { const h = e.rand(70, 160); blocks.push({ x: W + 20, y: e.rand(90, H - 90 - h), w: 36, h, tint: e.randInt(0, 2) }); spawn = e.rand(0.9, 1.5); }
        for (const b of blocks) { b.x -= speed * dt; if (e.hit({ x: 80, y: y - 12, w: 40, h: 24 }, { x: b.x, y: b.y, w: b.w, h: b.h })) { fx.burst(100, y, "#ffb347", 14, 220, 0.6, 400); e.over(); } }
        while (blocks.length && blocks[0].x < -60) blocks.shift();
        if (y < 40 || y > H - 40) e.over();
        fx.drift(-speed * dt);                                       // the puffs of smoke stay in the cave and move to the left with it
      },
      draw() {
        Art.sky(g, PAL.cave, clock, { alpha: 1, sun: false, stars: false });
        Art.hills(g, PAL.cave.hill1, 380, dist, { amp: 140, length: 90, speed: 0.15 });
        Art.hills(g, PAL.cave.hill2, 560, dist, { amp: 120, length: 60, phase: 2, speed: 0.35 });
        // glowing crystals in the far wall
        g.fillStyle = "rgba(150,120,255,0.35)";
        for (let k = 0; k < 6; k++) { const cx = mod(k * 137 - dist * 0.25, W + 80) - 40, cy = 130 + (k * 83) % 380; g.beginPath(); g.moveTo(cx, cy + 20); g.lineTo(cx + 7, cy - 14); g.lineTo(cx + 14, cy + 20); g.closePath(); g.fill(); }
        const stone = ["#8a6bd0", "#6f86e8", "#c0629f"];
        for (const b of blocks) {
          Art.block(g, b.x, b.y, b.w, b.h, stone[b.tint], { radius: 9 });
          g.fillStyle = "rgba(255,255,255,0.18)";
          for (let r = b.y + 22; r < b.y + b.h - 10; r += 22) g.fillRect(b.x + 6, r, b.w - 12, 2);
        }
        // ceiling and floor of the cave with teeth
        g.fillStyle = "#1c1428"; g.fillRect(0, 0, W, 26); g.fillRect(0, H - 26, W, 26);
        g.fillStyle = "#2d2140";
        for (let x = -mod(dist, 36); x < W + 36; x += 36) {
          const jag = 8 + ((Math.floor((x + dist) / 36) * 7) % 5) * 1.6;
          g.beginPath(); g.moveTo(x, 26); g.lineTo(x + 18, 26 + jag); g.lineTo(x + 36, 26); g.closePath(); g.fill();
          g.beginPath(); g.moveTo(x, H - 26); g.lineTo(x + 18, H - 26 - jag); g.lineTo(x + 36, H - 26); g.closePath(); g.fill();
        }
        g.fillStyle = "rgba(180,150,255,0.35)"; g.fillRect(0, 25, W, 2); g.fillRect(0, H - 27, W, 2);
        fx.draw(g);
        Art.sprite(g, "🚁", 100, y, 46, { angle: vy / 900 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Cube Dash */
  R({ id: "cube-dash", name: "Cube Dash", emoji: "🟦", cat: "Laufen", color: "#6c7bff", bubble: true, hint: "Tippen zum Springen über die Spitzen", create(e) {
    const GY = 500, g = e.g;
    let y = 0, vy = 0, rot = 0, dist = 0, obs = [], spawn = 0.8, speed = 280, clock = 0, trail = [], trailT = 0, wasAir = false;
    const fx = Art.fx();
    return {
      update(dt) {
        const i = e.input;
        clock += dt;
        fx.update(dt);
        speed = Math.min(520, 280 + dist * 0.03);
        dist += speed * dt; e.score(dist / 20);
        if ((i.down || i.keys.has(" ") || i.keys.has("ArrowUp")) && y <= 0) { vy = 760; y = 0.01; fx.burst(87, GY, "#4cc9ff", 6, 90, 0.4, 250); }
        vy -= 2600 * dt; y += vy * dt;
        if (y > 0) { rot += dt * 7; wasAir = true; } else { y = 0; vy = 0; rot = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2); if (wasAir) { wasAir = false; fx.burst(87, GY, "#ffffff", 6, 90, 0.35, 250); } }
        trailT -= dt;
        if (trailT <= 0) { trailT = 0.035; trail.push({ x: 87, y, rot }); if (trail.length > 7) trail.shift(); }
        for (const t of trail) t.x -= speed * dt;
        spawn -= dt;
        if (spawn <= 0) { const n = e.randInt(1, 3); obs.push({ x: W + 30, n, block: e.rand() < 0.25 }); spawn = 0.85 + e.rand(0, 0.8) + (n - 1) * 0.15; }
        for (const o of obs) o.x -= speed * dt;
        while (obs.length && obs[0].x < -120) obs.shift();
        const me = { x: 70, y: GY - y - 34, w: 34, h: 34 };
        for (const o of obs) {
          if (o.block) { if (e.hit({ x: me.x + 3, y: me.y + 3, w: me.w - 6, h: me.h - 6 }, { x: o.x, y: GY - 34, w: 34, h: 34 })) { fx.burst(87, GY - y - 17, "#4cc9ff", 16, 260, 0.6, 500); e.over(); } }
          else for (let k = 0; k < o.n; k++) if (e.hit({ x: me.x + 6, y: me.y + 6, w: me.w - 12, h: me.h - 10 }, { x: o.x + k * 28 + 8, y: GY - 28, w: 16, h: 28 })) { fx.burst(87, GY - y - 17, "#4cc9ff", 16, 260, 0.6, 500); e.over(); }
        }
      },
      draw() {
        const beat = 0.5 + 0.5 * Math.sin(clock * 6);
        Art.sky(g, PAL.neon, clock, { alpha: 1, sun: false, stars: true });
        const glow = g.createRadialGradient(W / 2, GY - 120, 10, W / 2, GY - 120, 260);
        glow.addColorStop(0, `rgba(255,106,213,${0.18 + beat * 0.12})`); glow.addColorStop(1, "rgba(255,106,213,0)");
        g.fillStyle = glow; g.fillRect(0, 0, W, H);
        // far towers
        for (let k = 0; k < 9; k++) {
          const tw = 46 + (k * 29) % 38, tx = mod(k * 71 - dist * 0.12, W + 120) - 60, th = 90 + (k * 53) % 150;
          g.fillStyle = "rgba(20,8,60,0.85)"; g.fillRect(tx, GY - th, tw, th);
          g.fillStyle = `rgba(55,230,255,${0.2 + 0.25 * ((k + Math.floor(clock * 2)) % 2)})`;
          for (let r = GY - th + 10; r < GY - 14; r += 22) g.fillRect(tx + 8, r, 6, 8);
        }
        // the floor with a grid that runs towards the cube
        const floor = g.createLinearGradient(0, GY, 0, H);
        floor.addColorStop(0, "#2a0f66"); floor.addColorStop(1, "#0e0526");
        g.fillStyle = floor; g.fillRect(0, GY, W, H - GY);
        g.strokeStyle = "rgba(55,230,255,0.22)"; g.lineWidth = 1.5;
        for (let x = -mod(dist, 48); x < W + 48; x += 48) { g.beginPath(); g.moveTo(x, GY); g.lineTo(x + (x - W / 2) * 0.5, H); g.stroke(); }
        for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(0, GY + k * k * 5); g.lineTo(W, GY + k * k * 5); g.stroke(); }
        g.fillStyle = "rgba(55,230,255,0.28)"; g.fillRect(0, GY - 3, W, 9);
        g.fillStyle = "#7df3ff"; g.fillRect(0, GY - 1, W, 3);
        for (const o of obs) {
          if (o.block) {
            Art.block(g, o.x, GY - 34, 34, 34, "#3b4cc0", { radius: 5 });
            g.strokeStyle = "#9db0ff"; g.lineWidth = 2; g.strokeRect(o.x + 6, GY - 28, 22, 22);
          } else for (let k = 0; k < o.n; k++) {
            const x0 = o.x + k * 28;
            g.fillStyle = "rgba(255,77,109,0.28)"; g.beginPath(); g.moveTo(x0 - 5, GY); g.lineTo(x0 + 14, GY - 42); g.lineTo(x0 + 33, GY); g.closePath(); g.fill();
            const spike = g.createLinearGradient(0, GY - 32, 0, GY);
            spike.addColorStop(0, "#ffb199"); spike.addColorStop(1, "#ff2d62");
            g.fillStyle = spike; g.beginPath(); g.moveTo(x0, GY); g.lineTo(x0 + 14, GY - 32); g.lineTo(x0 + 28, GY); g.closePath(); g.fill();
            g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = 1.5; g.stroke();
          }
        }
        for (const [k, t] of trail.entries()) {
          g.save(); g.translate(t.x, GY - t.y - 17); g.rotate(t.rot); g.globalAlpha = (k + 1) / (trail.length + 3) * 0.35;
          g.fillStyle = "#4cc9ff"; g.fillRect(-15, -15, 30, 30); g.restore();
        }
        fx.draw(g);
        g.save(); g.translate(87, GY - y - 17); g.rotate(rot);
        const body = g.createLinearGradient(-17, -17, 17, 17);
        body.addColorStop(0, "#8ae6ff"); body.addColorStop(1, "#2f7dff");
        g.fillStyle = body; g.beginPath(); g.roundRect ? g.roundRect(-17, -17, 34, 34, 6) : g.rect(-17, -17, 34, 34); g.fill();
        g.lineWidth = 2.5; g.strokeStyle = "#ffffff"; g.stroke();
        g.fillStyle = "#fff"; g.fillRect(-8, -8, 7, 10); g.fillRect(3, -8, 7, 10);
        g.fillStyle = "#12072e"; g.fillRect(-5, -4, 4, 6); g.fillRect(6, -4, 4, 6);
        g.fillRect(-8, 8, 18, 3);
        g.restore();
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Gravity Flip */
  R({ id: "gravity-flip", name: "Gravity Flip", emoji: "🔃", cat: "Laufen", color: "#b46bff", bubble: true, hint: "Tippen kehrt die Schwerkraft um", create(e) {
    const TOP = 150, BOT = 490, g = e.g;
    let dir = 1, y = BOT - 30, vy = 0, dist = 0, spikes = [], spawn = 0.9, clock = 0, flip = 0;
    const fx = Art.fx();
    return {
      update(dt) {
        clock += dt;
        flip = Math.max(0, flip - dt);
        fx.update(dt);
        const speed = 230 + Math.min(180, dist * 0.02);
        dist += speed * dt; e.score(dist / 15);
        if (e.input.pressed || e.input.keyPressed(" ") || e.input.keyPressed("ArrowUp")) { dir *= -1; flip = 0.25; fx.burst(64, y, "#d9b8ff", 8, 120, 0.4, 0); }
        vy += dir * 2600 * dt; vy = Math.max(-900, Math.min(900, vy)); y += vy * dt;
        if (y > BOT - 22) { y = BOT - 22; vy = 0; } if (y < TOP + 22) { y = TOP + 22; vy = 0; }
        fx.trail(64, y, "rgba(255,210,63,0.55)", 8, 0.3);
        spawn -= dt;
        if (spawn <= 0) { spawn = 0.8 + e.rand(0, 0.8); spikes.push({ x: W + 30, top: e.rand() < 0.5 }); }
        for (const s of spikes) {
          s.x -= speed * dt;
          const box = { x: s.x + 6, y: s.top ? TOP : BOT - 40, w: 24, h: 40 };
          if (e.hit({ x: 64, y: y - 14, w: 28, h: 28 }, box)) { fx.burst(78, y, "#ffd23f", 14, 240, 0.6, 400); e.over(); }
        }
        while (spikes.length && spikes[0].x < -50) spikes.shift();
        fx.drift(-speed * dt);
      },
      draw() {
        Art.sky(g, PAL.space, clock, { alpha: 1, sun: false, stars: false });
        g.fillStyle = "#fff";
        for (let k = 0; k < 46; k++) {
          const par = 0.08 + (k % 4) * 0.07;
          g.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(clock * 1.5 + k));
          g.beginPath(); g.arc(mod(k * 83 - dist * par, W), (k * 47) % H, 0.8 + (k % 3) * 0.5, 0, TAU); g.fill();
        }
        g.globalAlpha = 1;
        // a planet and its ring
        const planet = g.createRadialGradient(250, 250, 6, 260, 270, 70);
        planet.addColorStop(0, "#ffb88a"); planet.addColorStop(0.6, "#c4528f"); planet.addColorStop(1, "#4a1d6e");
        g.fillStyle = planet; g.beginPath(); g.arc(mod(260 - dist * 0.05, W + 200) - 40, 300, 62, 0, TAU); g.fill();
        // the walls
        for (const [from, to] of [[0, TOP - 14], [BOT + 14, H]]) {
          const wall = g.createLinearGradient(0, from, 0, to);
          wall.addColorStop(0, from === 0 ? "#10122e" : "#2b3170"); wall.addColorStop(1, from === 0 ? "#2b3170" : "#10122e");
          g.fillStyle = wall; g.fillRect(0, from, W, to - from);
          g.fillStyle = "rgba(160,175,255,0.14)";
          for (let x = -mod(dist, 60); x < W + 60; x += 60) g.fillRect(x, from + 10, 40, 6);
        }
        for (const [yy, up] of [[TOP - 14, false], [BOT, true]]) {
          g.fillStyle = "#4a56b8"; g.fillRect(0, yy, W, 14);
          g.fillStyle = "#9aa7ff"; g.fillRect(0, up ? yy : yy + 11, W, 3);
          g.fillStyle = "rgba(255,210,63,0.9)";
          for (let x = -mod(dist * 1.2, 40); x < W + 40; x += 40) g.fillRect(x, yy + 5, 16, 4);
        }
        for (const s of spikes) {
          const crystal = g.createLinearGradient(0, s.top ? TOP : BOT - 40, 0, s.top ? TOP + 40 : BOT);
          crystal.addColorStop(0, s.top ? "#ff2d62" : "#ffb2c8"); crystal.addColorStop(1, s.top ? "#ffb2c8" : "#ff2d62");
          g.fillStyle = crystal; g.beginPath();
          if (s.top) { g.moveTo(s.x, TOP); g.lineTo(s.x + 18, TOP + 40); g.lineTo(s.x + 36, TOP); } else { g.moveTo(s.x, BOT); g.lineTo(s.x + 18, BOT - 40); g.lineTo(s.x + 36, BOT); }
          g.closePath(); g.fill(); g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 1.5; g.stroke();
        }
        fx.draw(g);
        g.save(); g.translate(64, y); g.scale(1 + flip * 0.5, 1 - flip * 0.5);
        const body = g.createLinearGradient(-14, -14, 14, 14);
        body.addColorStop(0, "#fff08a"); body.addColorStop(1, "#ff9f1c");
        g.fillStyle = body; g.beginPath(); g.roundRect ? g.roundRect(-14, -14, 28, 28, 8) : g.rect(-14, -14, 28, 28); g.fill();
        g.lineWidth = 2.5; g.strokeStyle = "#fff"; g.stroke();
        g.fillStyle = "#222"; g.fillRect(-7, dir > 0 ? 1 : -9, 5, 8); g.fillRect(3, dir > 0 ? 1 : -9, 5, 8);
        g.restore();
        Art.sprite(g, dir > 0 ? "⬇️" : "⬆️", 64, y + (dir > 0 ? 32 : -32), 18, { alpha: 0.7 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Lane Runner */
  R({ id: "lane-runner", name: "Lane Runner", emoji: "🏃", cat: "Laufen", color: "#ff8a4c", bubble: true, hint: "Nach links oder rechts wischen, Hindernissen ausweichen", create(e) {
    const X = [90, 180, 270], g = e.g;
    let lane = 1, px = 180, dist = 0, items = [], spawn = 0.5, coins = 0, clock = 0, runs = 0;
    const fx = Art.fx();
    return {
      update(dt) {
        const i = e.input;
        clock += dt;
        fx.update(dt);
        if (i.swipe === "left" || i.keyPressed("ArrowLeft") || i.keyPressed("a")) lane = Math.max(0, lane - 1);
        if (i.swipe === "right" || i.keyPressed("ArrowRight") || i.keyPressed("d")) lane = Math.min(2, lane + 1);
        if (i.tap) lane = i.x < px ? Math.max(0, lane - 1) : Math.min(2, lane + 1);
        px += (X[lane] - px) * Math.min(1, dt * 14);
        const speed = 260 + Math.min(260, dist * 0.02);
        dist += speed * dt; e.score(dist / 20 + coins * 5);
        runs -= dt;
        if (runs <= 0) { runs = 0.09; fx.trail(px, 530, "rgba(255,255,255,0.35)", 4, 0.35); }
        spawn -= dt;
        if (spawn <= 0) {
          spawn = Math.max(0.35, 0.8 - dist * 0.00006) + e.rand(0, 0.3);
          const l = e.randInt(0, 2);
          items.push({ lane: l, y: -40, kind: e.rand() < 0.28 ? "coin" : e.pick(["rock", "cone"]), phase: e.rand(0, TAU) });
        }
        for (const it of items) it.y += speed * dt;
        for (const it of items) {
          if (it.dead) continue;
          if (Math.abs(X[it.lane] - px) < 30 && Math.abs(it.y - 500) < 30) { if (it.kind === "coin") { coins += 1; it.dead = true; fx.burst(X[it.lane], it.y, "#ffd23f", 8, 140, 0.5, 200); } else { fx.burst(px, 500, "#ff8a4c", 14, 240, 0.6, 400); e.over(); } }
        }
        for (let k = items.length - 1; k >= 0; k--) if (items[k].dead || items[k].y > H + 40) items.splice(k, 1);
        fx.drift(0, speed * dt);
      },
      draw() {
        // meadow with stripes
        for (let n = -1; n < 9; n++) { g.fillStyle = (n & 1) ? "#5cbd52" : "#66c95b"; g.fillRect(0, mod(n * 80 + dist * 0.9, 720) - 80, W, 80); }
        for (let n = 0; n < 7; n++) {
          const ty = mod(n * 110 + dist * 0.9, 770) - 60;
          Art.shadow(g, 22, ty + 18, 34, 0.18); Art.sprite(g, n % 2 ? "🌳" : "🌲", 22, ty, 48);
          Art.shadow(g, 338, ty + 58, 34, 0.18); Art.sprite(g, n % 2 ? "🌲" : "🌳", 338, ty + 40, 48);
        }
        // road with kerbs
        const road = g.createLinearGradient(45, 0, 315, 0);
        road.addColorStop(0, "#3a3d4a"); road.addColorStop(0.5, "#4a4e5e"); road.addColorStop(1, "#3a3d4a");
        g.fillStyle = road; g.fillRect(45, 0, 270, H);
        for (let n = 0; n < 24; n++) {
          const ky = mod(n * 36 + dist * 0.9, 864) - 40;
          g.fillStyle = n % 2 ? "#ffffff" : "#e8403a";
          g.fillRect(37, ky, 8, 36); g.fillRect(315, ky, 8, 36);
        }
        g.fillStyle = "rgba(255,255,255,0.75)";
        for (let k = 0; k < 2; k++) for (let n = 0; n < 12; n++) g.fillRect(133 + k * 90, mod(n * 70 + dist * 0.9, 840) - 40, 4, 34);
        for (const it of items) {
          Art.shadow(g, X[it.lane], it.y + 20, it.kind === "coin" ? 22 : 36, 0.28);
          if (it.kind === "coin") Art.sprite(g, "🪙", X[it.lane], it.y + Math.sin(clock * 5 + it.phase) * 4, 40, { sx: Math.max(0.15, Math.abs(Math.cos(clock * 5 + it.phase))) });
          else Art.sprite(g, it.kind === "rock" ? "🪨" : "🚧", X[it.lane], it.y, 46);
        }
        fx.draw(g);
        Art.shadow(g, px, 530, 38, 0.3);
        Art.sprite(g, "🏃", px, 500 + Math.sin(clock * 16) * 3, 56, { angle: (X[lane] - px) * -0.004 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Doodle Jump */
  R({ id: "doodle-jump", name: "Doodle Jump", emoji: "🐸", cat: "Laufen", color: "#7ed957", bubble: true, hint: "Finger oder Maus bewegen: der Frosch springt von selbst", create(e) {
    const g = e.g;
    let x = W / 2, y = 480, vy = -700, top = 0, plats = [], clock = 0, face = 1;
    const fx = Art.fx();
    for (let k = 0; k < 9; k++) plats.push({ x: e.rand(20, W - 80), y: H - 40 - k * 75, w: 64, moving: false });
    plats[0] = { x: W / 2 - 32, y: 520, w: 64, moving: false };
    return {
      update(dt) {
        const i = e.input;
        clock += dt;
        fx.update(dt);
        const startX = x;
        if (i.down) x += (i.x - x) * Math.min(1, dt * 12);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 300 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 300 * dt;
        if (Math.abs(x - startX) > 0.4) face = x > startX ? 1 : -1;
        x = (x + W) % W;
        const before = y;
        vy += 1400 * dt; y += vy * dt;
        if (vy > 0) for (const p of plats) if (x > p.x - 8 && x < p.x + p.w + 8 && before + 22 <= p.y + 2 && y + 22 >= p.y) { vy = -700; y = p.y - 22; fx.burst(x, p.y, p.moving ? "#bfe9ff" : "#9be37f", 6, 90, 0.4, 260); }
        if (y < 340) { const d = 340 - y; y = 340; top += d; for (const p of plats) p.y += d; e.score(top / 8); fx.drift(0, d); }
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
        const high = Math.min(1, top / 9000);
        Art.sky(g, high > 0.5 ? PAL.sunset : PAL.day, clock, { alpha: 1, sunX: 290, sunY: 100 - Math.min(80, top * 0.01) });
        if (high > 0.2) { g.globalAlpha = Math.min(1, (high - 0.2) * 2); Art.sky(g, PAL.night, clock, { alpha: Math.min(0.9, (high - 0.2) * 1.4), sun: false }); g.globalAlpha = 1; }
        for (let k = 0; k < 6; k++) Art.cloud(g, mod(k * 173 + 40, 460) - 70, mod(k * 131 + top * 0.25, H + 120) - 60, 0.8 + (k % 3) * 0.3, "rgba(255,255,255,0.7)");
        if (top < 700) Art.hills(g, PAL.day.hill2, 600 + top * 0.5, 0, { amp: 40, length: 70 });
        for (const p of plats) {
          Art.shadow(g, p.x + p.w / 2, p.y + 16, p.w + 6, 0.12);
          g.fillStyle = p.moving ? "#2a86c8" : "#8a5a2b"; g.beginPath(); g.roundRect ? g.roundRect(p.x, p.y, p.w, 14, 7) : g.rect(p.x, p.y, p.w, 14); g.fill();
          g.fillStyle = p.moving ? "#74d0ff" : "#6bd45f"; g.beginPath(); g.roundRect ? g.roundRect(p.x, p.y - 1, p.w, 8, 5) : g.rect(p.x, p.y - 1, p.w, 8); g.fill();
          g.fillStyle = "rgba(255,255,255,0.4)"; g.fillRect(p.x + 8, p.y + 1, p.w - 16, 2);
        }
        fx.draw(g);
        const stretch = Math.min(0.28, Math.abs(vy) / 2800);
        Art.sprite(g, "🐸", x, y, 46, { sx: 1 - stretch * 0.6, sy: 1 + stretch, flip: face < 0 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Zig-Zag */
  R({ id: "zigzag", name: "Zig-Zag", emoji: "↯", cat: "Laufen", color: "#ff5c9a", bubble: true, hint: "Tippen wechselt die Richtung. Bleib auf dem Weg!", create(e) {
    // the road is a chain of diagonal pieces (always 45 degrees); the ball runs at 45 degrees too and turns with every tap
    const pts = [{ x: 180, y: 560 }], g = e.g;
    let turn = 1;
    function extend() {
      const last = pts[pts.length - 1];
      const room = turn > 0 ? 300 - last.x : last.x - 60;
      const step = e.rand(80, Math.max(80, Math.min(160, room)));
      pts.push({ x: last.x + turn * step, y: last.y - step });
      turn *= -1;
    }
    for (let k = 0; k < 14; k++) extend();
    let t = 0, bx = 180, by = 560, bdir = 1, trailT = 0;
    const fx = Art.fx();
    const road = (yy) => {                                          // x of the middle of the road at height yy
      for (let k = 0; k < pts.length - 1; k++) { const a = pts[k], b = pts[k + 1]; if (yy <= a.y && yy >= b.y) return a.x + (b.x - a.x) * ((a.y - yy) / (a.y - b.y)); }
      return null;
    };
    const path = () => { g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
    return {
      update(dt) {
        t += dt;
        fx.update(dt);
        if (e.input.pressed || e.input.keyPressed(" ") || e.input.keyPressed("ArrowLeft") || e.input.keyPressed("ArrowRight")) { bdir *= -1; fx.burst(bx, by, "#fff", 6, 110, 0.35, 0); }
        const speed = 170 + Math.min(130, t * 3.5);
        bx += bdir * speed * dt;
        by -= speed * dt;
        trailT -= dt;
        if (trailT <= 0) { trailT = 0.03; fx.trail(bx, by, "rgba(255,210,63,0.6)", 8, 0.45); }
        e.score(t * 2 + (560 - by) / 40);
        while (pts[pts.length - 1].y > by - 700) extend();
        while (pts.length > 3 && pts[2].y > by + 340) pts.shift();
        const middle = road(by);
        if (middle === null || Math.abs(bx - middle) > 28) { fx.burst(bx, by, "#ffd23f", 16, 240, 0.7, 500); e.over(); }
      },
      draw() {
        Art.sky(g, PAL.sunset, t, { alpha: 1, sunX: 280, sunY: 120 });
        Art.clouds(g, PAL.sunset, t * 30, { y: 50, rows: 3 });
        Art.hills(g, PAL.sunset.hill1, 520 + (by - 560) * -0.05, 560 - by, { amp: 70, length: 90, speed: 0.3 });
        Art.hills(g, PAL.sunset.hill2, 620, 560 - by, { amp: 50, length: 60, phase: 1, speed: 0.6 });
        g.save();
        g.translate(0, 440 - by);
        g.lineCap = "round"; g.lineJoin = "round";
        g.lineWidth = 68; g.strokeStyle = "rgba(0,0,0,0.25)"; g.save(); g.translate(0, 8); path(); g.stroke(); g.restore();
        g.lineWidth = 66; g.strokeStyle = "#ffd166"; path(); g.stroke();
        g.lineWidth = 58; g.strokeStyle = "#3a3358"; path(); g.stroke();
        g.lineWidth = 4; g.strokeStyle = "rgba(255,255,255,0.65)"; g.setLineDash([16, 18]); path(); g.stroke(); g.setLineDash([]);
        fx.draw(g);
        Art.shadow(g, bx, by + 14, 30, 0.35);
        const ball = g.createRadialGradient(bx - 4, by - 5, 2, bx, by, 15);
        ball.addColorStop(0, "#fff7b0"); ball.addColorStop(1, "#ffb703");
        g.fillStyle = ball; g.beginPath(); g.arc(bx, by, 14, 0, TAU); g.fill();
        g.lineWidth = 3; g.strokeStyle = "#fff"; g.stroke();
        g.restore();
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Dodge Blocks */
  R({ id: "dodge-blocks", name: "Ausweichen", emoji: "🧱", cat: "Laufen", color: "#ff7a59", bubble: true, hint: "Bewege den Finger links und rechts: weich den Blöcken aus", create(e) {
    const g = e.g, GROUND = 592;
    let x = W / 2, t = 0, blocks = [], spawn = 0.3, face = 1;
    const fx = Art.fx();
    return {
      update(dt) {
        const i = e.input;
        t += dt; e.score(t * 5);
        fx.update(dt);
        const startX = x;
        if (i.down) x += (i.x - x) * Math.min(1, dt * 16);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 320 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 320 * dt;
        x = e.clamp(x, 20, W - 20);
        if (Math.abs(x - startX) > 0.4) face = x > startX ? 1 : -1;
        spawn -= dt;
        if (spawn <= 0) { spawn = Math.max(0.18, 0.55 - t * 0.006); const w = e.rand(34, 80); blocks.push({ x: e.rand(0, W - w), y: -30, w, h: 26, v: e.rand(200, 260) + t * 4 }); }
        for (const b of blocks) {
          b.y += b.v * dt;
          if (e.hit({ x: x - 14, y: 560, w: 28, h: 30 }, { x: b.x, y: b.y, w: b.w, h: b.h })) { fx.burst(x, 570, "#ffcf99", 14, 240, 0.6, 500); e.over(); }
          if (!b.landed && b.y + b.h >= GROUND) { b.landed = true; fx.burst(b.x + b.w / 2, GROUND, "rgba(230,205,170,0.8)", 4, 70, 0.4, 200); }
        }
        while (blocks.length && blocks[0].y > H + 40) blocks.shift();
        blocks.sort((a, b) => a.y - b.y);
      },
      draw() {
        Art.sky(g, PAL.sunset, t, { alpha: 1, sunX: 70, sunY: 150 });
        Art.clouds(g, PAL.sunset, t * 25, { y: 40, rows: 3 });
        Art.hills(g, PAL.sunset.hill1, GROUND - 40, t * 30, { amp: 70, length: 90, speed: 0.2 });
        Art.hills(g, PAL.sunset.hill2, GROUND - 6, t * 30, { amp: 40, length: 55, phase: 1.3, speed: 0.5 });
        Art.ground(g, PAL.sunset, GROUND, t * 20, { height: H - GROUND, stripe: false });
        for (const b of blocks) {
          if (b.y + b.h < GROUND - 2) {
            g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(b.x + 4, GROUND - 3, b.w - 8, 3);        // the warning on the ground
            g.fillStyle = "rgba(255,255,255,0.18)"; g.fillRect(b.x + 6, Math.max(-40, b.y - 22), b.w - 12, 22);   // a streak of speed above
          }
          const topY = b.y;
          g.save(); g.beginPath(); g.rect(0, 0, W, GROUND + 6); g.clip();
          Art.block(g, b.x, topY, b.w, b.h, "#d9532f", { radius: 5 });
          g.fillStyle = "rgba(255,230,200,0.38)";
          g.fillRect(b.x + 4, topY + b.h / 2 - 1, b.w - 8, 2);
          for (let bx = b.x + 20; bx < b.x + b.w - 6; bx += 22) { g.fillRect(bx, topY + 5, 2, b.h / 2 - 6); g.fillRect(bx - 11, topY + b.h / 2 + 1, 2, b.h / 2 - 6); }
          g.restore();
        }
        fx.draw(g);
        Art.shadow(g, x, 592, 34, 0.3);
        Art.sprite(g, "🤠", x, 574, 42, { flip: face < 0 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Crossy Hop */
  R({ id: "crossy-hop", name: "Crossy Hop", emoji: "🐔", cat: "Laufen", color: "#ffd24c", bubble: true, hint: "Tippen: vor · Wischen: zur Seite · Weich den Autos aus", create(e) {
    const CELL = 50, g = e.g;
    const COLORS = ["#ff5d5d", "#4c9bff", "#ffc83d", "#7ed957", "#b36bff", "#ff8a4c", "#ffffff"];
    let gx = 3, gy = 0, best = 0, rows = [], moveTimer = 0, idle = 0, hop = 0, clock = 0;
    const fx = Art.fx();
    function makeRow(n) {
      if (n < 2) return { n, type: "grass", cars: [] };
      const road = e.rand() < 0.65;
      return { n, type: road ? "road" : "grass", dir: e.rand() < 0.5 ? -1 : 1, speed: e.rand(60, 150) + Math.min(120, n * 2), cars: road ? Array.from({ length: e.randInt(2, 3) }, (_, k) => ({ x: k * e.rand(120, 190), w: e.rand(44, 70), color: e.pick(COLORS) })) : [] };
    }
    for (let n = 0; n < 16; n++) rows.push(makeRow(n));
    const rowAt = (n) => { while (rows.length <= n + 14) rows.push(makeRow(rows.length)); return rows[n]; };
    function car(c, dir, y) {
      const h = CELL - 18, top = y - CELL + 10;
      Art.shadow(g, c.x + c.w / 2, top + h + 2, c.w, 0.25);
      g.fillStyle = c.color; g.beginPath(); g.roundRect ? g.roundRect(c.x, top, c.w, h, 9) : g.rect(c.x, top, c.w, h); g.fill();
      g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(c.x + 4, top + h - 8, c.w - 8, 4);
      const cabinX = dir > 0 ? c.x + c.w * 0.22 : c.x + c.w * 0.3;
      g.fillStyle = "rgba(25,35,60,0.85)"; g.beginPath(); g.roundRect ? g.roundRect(cabinX, top + 4, c.w * 0.48, h - 12, 5) : g.rect(cabinX, top + 4, c.w * 0.48, h - 12); g.fill();
      g.fillStyle = "#fff6b0"; g.fillRect(dir > 0 ? c.x + c.w - 5 : c.x, top + 5, 5, 6); g.fillRect(dir > 0 ? c.x + c.w - 5 : c.x, top + h - 12, 5, 6);
      g.fillStyle = "#e84a4a"; g.fillRect(dir > 0 ? c.x : c.x + c.w - 4, top + 5, 4, 5); g.fillRect(dir > 0 ? c.x : c.x + c.w - 4, top + h - 11, 4, 5);
      g.fillStyle = "#1c1c24"; g.beginPath(); g.arc(c.x + c.w * 0.25, top + h, 5, 0, TAU); g.arc(c.x + c.w * 0.75, top + h, 5, 0, TAU); g.fill();
    }
    return {
      update(dt) {
        const i = e.input;
        clock += dt;
        fx.update(dt);
        hop = Math.max(0, hop - dt);
        moveTimer -= dt;
        if (moveTimer <= 0) {
          let mx = 0, my = 0;
          if (i.tap || i.keyPressed("ArrowUp") || i.keyPressed("w")) my = 1;
          else if (i.swipe === "left" || i.keyPressed("ArrowLeft")) mx = -1;
          else if (i.swipe === "right" || i.keyPressed("ArrowRight")) mx = 1;
          else if (i.swipe === "down" || i.keyPressed("ArrowDown")) my = -1;
          if (mx || my) { gx = e.clamp(gx + mx, 0, 6); gy = Math.max(0, gy + my); moveTimer = 0.08; hop = 0.16; fx.burst(gx * CELL + CELL / 2, 540 - CELL / 2 + 14, "rgba(255,255,255,0.7)", 3, 40, 0.3, 80); if (gy > best) { best = gy; idle = 0; e.score(best); } }
        }
        for (let n = Math.max(0, gy - 5); n <= gy + 12; n++) { const r = rowAt(n); for (const c of r.cars) { c.x += r.dir * r.speed * dt; if (r.dir > 0 && c.x > 420) c.x = -c.w - e.rand(0, 120); if (r.dir < 0 && c.x + c.w < -60) c.x = 420 + e.rand(0, 120); } }
        const row = rowAt(gy);
        for (const c of row.cars) if (gx * CELL + 5 < c.x + c.w && gx * CELL + CELL - 5 > c.x) { fx.burst(gx * CELL + CELL / 2, 540 - CELL / 2, "#fff", 14, 220, 0.6, 400); e.over(); }
        idle += dt;
        if (best - gy > 3 || idle > 7) e.over();                      // whoever waits too long is picked up by the eagle
      },
      draw() {
        const baseY = 540;
        for (let n = Math.max(0, gy - 6); n <= gy + 12; n++) {
          const r = rowAt(n);
          const y = baseY - (n - gy) * CELL;
          if (r.type === "road") {
            g.fillStyle = "#3c4150"; g.fillRect(0, y - CELL + 2, W + 20, CELL - 2);
            g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(0, y - CELL + 2, W + 20, 3);
            if (rowAt(n + 1).type === "road") { g.fillStyle = "rgba(255,255,255,0.55)"; for (let x = 6; x < W; x += 44) g.fillRect(x, y - CELL - 1, 24, 3); }
          } else {
            g.fillStyle = n % 2 ? "#6fcf62" : "#7ad96c"; g.fillRect(0, y - CELL + 2, W + 20, CELL - 2);
            const h = (n * 2654435761) >>> 0;
            for (let k = 0; k < 3; k++) if (((h >> (k * 4)) & 7) < 4) {
              const fxp = ((h >> (k * 5 + 3)) % 330) + 10, fyp = y - CELL + 14 + ((h >> (k * 3)) % 22);
              g.fillStyle = k === 1 ? "#ffe066" : "#ffffff"; g.beginPath(); g.arc(fxp, fyp, 3.2, 0, TAU); g.fill();
              g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(fxp - 4, fyp + 6, 8, 2);
            }
            if (n > 1 && ((h >> 11) & 3) === 0) { const tx = (h >> 14) % 2 ? 22 : W - 22; Art.shadow(g, tx, y - 6, 34, 0.2); Art.sprite(g, "🌳", tx, y - CELL / 2 - 4, 46); }
          }
          for (const c of r.cars) car(c, r.dir, y);
        }
        const cx = gx * CELL + CELL / 2, jump = Math.sin(Math.PI * (1 - hop / 0.16)) * 14 * (hop > 0 ? 1 : 0);
        Art.shadow(g, cx, baseY - 8, 28 - jump * 0.6, 0.3);
        fx.draw(g);
        Art.sprite(g, "🐔", cx, baseY - CELL / 2 - jump, 42, { sx: 1 + (hop > 0 ? 0.05 : 0), sy: 1 + (hop > 0 ? -0.05 : 0) });
        if (idle > 4.5) { Art.shadow(g, cx, baseY - 8, 50, 0.3); Art.sprite(g, "🦅", cx, baseY - CELL / 2 - (7 - idle) * 40, 56); }
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Slalom */
  R({ id: "slalom", name: "Slalom", emoji: "⛷️", cat: "Laufen", color: "#7ad7ff", bubble: true, hint: "Finger links/rechts bewegen: fahr zwischen den Bäumen durch", create(e) {
    const g = e.g;
    let x = W / 2, dist = 0, trees = [], spawn = 0, track = [], trackT = 0, clock = 0, lean = 0;
    const fx = Art.fx();
    return {
      update(dt) {
        const i = e.input;
        clock += dt;
        fx.update(dt);
        const speed = 240 + Math.min(260, dist * 0.015);
        dist += speed * dt; e.score(dist / 25);
        const startX = x;
        if (i.down) x += (i.x - x) * Math.min(1, dt * 8);
        if (i.keys.has("ArrowLeft") || i.keys.has("a")) x -= 260 * dt;
        if (i.keys.has("ArrowRight") || i.keys.has("d")) x += 260 * dt;
        x = e.clamp(x, 16, W - 16);
        lean += ((x - startX) * 0.05 - lean) * Math.min(1, dt * 10);
        trackT -= dt;
        if (trackT <= 0) { trackT = 0.03; track.push({ x, y: 200 }); }
        for (const p of track) p.y -= speed * dt;
        while (track.length && track[0].y < -20) track.shift();
        if (Math.abs(x - startX) > 1.5) fx.trail(x, 205, "rgba(255,255,255,0.9)", 3, 0.35);
        spawn -= dt;
        if (spawn <= 0) { spawn = Math.max(0.14, 0.45 - dist * 0.00002); trees.push({ x: e.rand(10, W - 10), y: H + 30, kind: e.rand() < 0.2 ? "🪨" : "🌲" }); }
        for (const t of trees) { t.y -= speed * dt; if (Math.abs(t.x - x) < 20 && Math.abs(t.y - 190) < 22) { fx.burst(x, 190, "#fff", 18, 260, 0.7, 500); e.over(); } }
        while (trees.length && trees[0].y < -50) trees.shift();
        fx.drift(0, -speed * dt);
      },
      draw() {
        Art.sky(g, PAL.snow, clock, { alpha: 1, sun: false });
        const snow = g.createLinearGradient(0, 0, 0, H);
        snow.addColorStop(0, "#e9f6ff"); snow.addColorStop(1, "#ffffff");
        g.fillStyle = snow; g.fillRect(0, 0, W, H);
        g.fillStyle = "rgba(120,160,200,0.18)";
        for (let k = 0; k < 16; k++) { const bx = (k * 97) % W, by = mod(k * 83 - dist * 0.9, 760) - 60; g.beginPath(); g.ellipse(bx, by, 26 + (k % 3) * 10, 7 + (k % 2) * 3, 0, 0, TAU); g.fill(); }
        g.lineCap = "round"; g.lineWidth = 3; g.strokeStyle = "rgba(90,130,180,0.4)";
        for (const side of [-4, 4]) { g.beginPath(); track.forEach((p, k) => (k ? g.lineTo(p.x + side, p.y) : g.moveTo(p.x + side, p.y))); g.stroke(); }
        for (const t of trees) {
          Art.shadow(g, t.x + 8, t.y + 22, 34, 0.12);
          Art.sprite(g, t.kind, t.x, t.y, 46);
        }
        fx.draw(g);
        Art.shadow(g, x + 6, 212, 30, 0.14);
        Art.sprite(g, "⛷️", x, 190, 48, { angle: lean });
      },
    };
  } });
})();
