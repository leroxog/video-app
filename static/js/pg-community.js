/* Nex games of the community (pg-community.js): the engine of the jump-and-run levels that people build in the camera tab (and three ready-made levels), and the bridge to the sealed
   worker in which a game written as code runs. A level is data (rows of letters: # block, ^ spikes, o coin, e enemy, s spring, F goal, . nothing); the engine is the one in this file, so a
   level can never do more than a level can. The figure runs by itself, a tap jumps (holding the finger jumps higher), coins and stomped enemies give points, spikes, pits and
   enemies from the side end the round, the flag at the end gives a bonus. Code games: see codeDef() -- the code runs in a worker (static script with header "default-src 'none'",
   served by the server) that gets the finger and gives back pictures, points and "over". */
(function () {
  "use strict";

  const PG = window.PulseGames;
  const W = 360;
  const H = 640;
  const TILE = 40;
  const ROWS = 9;
  const Y0 = 212;                                       // where the top of the level is on the play field
  const SPEEDS = [165, 215, 270];
  const GRAVITY = 1750;
  const JUMP = 625;
  const SPRING = 930;
  const TAU = Math.PI * 2;

  const THEMES = {
    day: { name: "Tag", top: "#5fbcff", bottom: "#e4f6ff", far: "#a6dcae", near: "#78c882", cap: "#58cf56", capDark: "#3f9f3f", dirt: "#a06c3a", dirt2: "#855a2f", cloud: "rgba(255,255,255,0.95)", stars: false, sun: "#ffe066" },
    night: { name: "Nacht", top: "#080b2a", bottom: "#3b3d92", far: "#2c3070", near: "#232662", cap: "#7fb0ff", capDark: "#4f7fd8", dirt: "#363b78", dirt2: "#2a2e62", cloud: "rgba(150,160,255,0.28)", stars: true, sun: "#f4f1c8" },
    sunset: { name: "Abend", top: "#ff7b54", bottom: "#ffd9a8", far: "#dc7592", near: "#b35c80", cap: "#ffb347", capDark: "#e08a1f", dirt: "#8c4d3b", dirt2: "#703d2f", cloud: "rgba(255,232,205,0.8)", stars: false, sun: "#fff1b0" },
    cave: { name: "Höhle", top: "#17121f", bottom: "#41314d", far: "#2b2236", near: "#241c2d", cap: "#9a85c4", capDark: "#6f5c99", dirt: "#4d3b5c", dirt2: "#3b2d48", cloud: "rgba(120,100,170,0.22)", stars: false, sun: "#8e7bb5" },
    candy: { name: "Zucker", top: "#ffa8e0", bottom: "#fff1fb", far: "#ffcff0", near: "#ff9ed6", cap: "#ff5db1", capDark: "#d63d90", dirt: "#c24cff", dirt2: "#a438e0", cloud: "rgba(255,255,255,0.9)", stars: false, sun: "#fff59a" },
  };

  // ------------------------------------------------------------------------------------------------------------------ a level
  /* {map: [9 rows of letters], theme, hero, speed} as the engine wants it (the server has checked the same rules). */
  function parseLevel(data) {
    const level = typeof data === "string" ? JSON.parse(data) : data;
    const rows = level.map;
    if (!Array.isArray(rows) || rows.length !== ROWS) throw new Error("level");
    const cols = rows[0].length;
    if (rows.some((row) => typeof row !== "string" || row.length !== cols)) throw new Error("level");
    return { map: rows, cols, theme: THEMES[level.theme] ? level.theme : "day", hero: level.hero || "🐱", speed: [1, 2, 3].includes(level.speed) ? level.speed : 2 };
  }

  /* A level that can be finished, made from a number (the builder offers it as a start, three of them are ready-made): ground with pits, steps, spikes, enemies, coins, springs, the goal. */
  function generateLevel({ seed = 1, cols = 90, theme = "day", hero = "🐱", speed = 2, hard = 0.5 } = {}) {
    const rand = PG.mulberry32(seed);
    const space = [4, 6, 7][speed - 1] || 6;                          // the room between two dangers: the faster the figure, the farther it flies in one jump
    const maxPit = [2, 3, 3][speed - 1] || 3;
    const maxSpikes = [1, 2, 3][speed - 1] || 2;
    const grid = Array.from({ length: ROWS }, () => Array(cols).fill("."));
    const ground = (c, on) => { grid[7][c] = on ? "#" : "."; grid[8][c] = on ? "#" : "."; };
    for (let c = 0; c < cols; c += 1) ground(c, true);
    let c = 8;
    while (c < cols - 14) {
      const roll = rand();
      if (roll < 0.17 + hard * 0.1) {                                   // a pit with coins over it
        const width = 2 + (rand() < 0.4 && maxPit > 2 ? 1 : 0);
        for (let k = 0; k < width; k += 1) ground(c + k, false);
        for (let k = -1; k <= width; k += 1) if (rand() < 0.9) grid[4][c + k] = "o";
        c += width + space;
      } else if (roll < 0.34) {                                         // a step (one or two blocks high) with a coin on it
        const high = rand() < 0.5 ? 1 : 2;
        const width = 2 + Math.floor(rand() * 3);
        for (let k = 0; k < width; k += 1) for (let h = 1; h <= high; h += 1) grid[7 - h][c + k] = "#";
        for (let k = 0; k < width; k += 1) grid[7 - high - 1][c + k] = "o";
        c += width + space;
      } else if (roll < 0.50) {                                         // spikes
        const width = 1 + (rand() < 0.35 + hard * 0.2 && maxSpikes > 1 ? 1 : 0);
        for (let k = 0; k < width; k += 1) grid[6][c + k] = "^";
        grid[4][c] = "o"; if (width > 1) grid[4][c + 1] = "o";
        c += width + space;
      } else if (roll < 0.64) {                                         // an enemy that walks
        grid[6][c] = "e";
        grid[4][c + 1] = "o";
        c += space + 2;
      } else if (roll < 0.76) {                                         // a spring and coins high up
        grid[6][c] = "s";
        for (let k = 0; k < 3; k += 1) grid[1][c + 2 + k] = "o";
        c += Math.round(6 + speed * 2.6);                                  // a spring flies far (and farther when the finger stays down): nothing dangerous where it lands
      } else if (roll < 0.88) {                                         // a floating row of blocks with coins
        const width = 3 + Math.floor(rand() * 3);
        for (let k = 0; k < width; k += 1) { grid[4][c + k] = "#"; grid[3][c + k] = "o"; }
        c += width + 3;
      } else {                                                          // a little arc of coins on the way
        for (let k = 0; k < 5; k += 1) grid[6 - Math.round(Math.sin((k / 4) * Math.PI) * 2)][c + k] = "o";
        c += 7;
      }
    }
    grid[6][cols - 6] = "F";
    return { map: grid.map((row) => row.join("")), theme, hero, speed };
  }

  // ------------------------------------------------------------------------------------------------------------------ the engine of a level
  function platformerCreate(rawLevel) {
    const level = parseLevel(rawLevel);
    const palette = THEMES[level.theme];
    const WORLD_W = level.cols * TILE;
    return function create(env) {
      const g = env.g;
      const map = level.map;
      const tile = (col, row) => (col < 0 ? "#" : col >= level.cols || row < 0 ? "." : row >= ROWS ? "." : map[row][col]);
      const solid = (col, row) => tile(col, row) === "#";
      const hero = { x: 2.5 * TILE, y: 0, vx: 0, vy: 0, ground: false, coyote: 0, buffer: 0, sx: 1, sy: 1, dead: false, deadT: 0, spin: 0, won: false, wonT: 0, stuck: 0 };
      for (let row = 0; row < ROWS; row += 1) if (solid(2, row)) { hero.y = row * TILE; break; }
      const HW = 13;
      const HH = 34;
      const taken = new Set();
      const enemies = [];
      const springs = new Map();
      let goalX = -1;
      for (let row = 0; row < ROWS; row += 1) {
        for (let col = 0; col < level.cols; col += 1) {
          const ch = map[row][col];
          if (ch === "e") enemies.push({ x: (col + 0.5) * TILE, y: (row + 1) * TILE, base: (col + 0.5) * TILE, dir: -1, alive: true, squash: 0 });
          if (ch === "F") goalX = (col + 0.5) * TILE;
          if (ch === "s") springs.set(`${col},${row}`, 0);
        }
      }
      const coinsTotal = map.reduce((sum, row) => sum + (row.match(/o/g) || []).length, 0);
      let coins = 0;
      let stomps = 0;
      let bonus = 0;
      let camX = 0;
      let t = 0;
      let started = false;
      let particles = [];
      const stars = Array.from({ length: 36 }, (_, i) => ({ x: (i * 97) % 360, y: 10 + ((i * 53) % 180), r: 0.8 + (i % 3) * 0.5 }));

      const burst = (x, y, color, n = 8, speed = 120, life = 0.5) => {
        for (let i = 0; i < n; i += 1) { const a = env.rand() * TAU, s = speed * (0.4 + env.rand() * 0.8); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life, max: life, color, size: 2 + env.rand() * 3 }); }
      };
      function die() {
        if (hero.dead || hero.won) return;
        hero.dead = true; hero.deadT = 0; hero.vy = -480; hero.vx = 0;
        burst(hero.x, hero.y - 20, "#fff", 14, 200, 0.7);
        navigator.vibrate?.(60);
      }
      function jump(power = JUMP) { hero.vy = -power; hero.ground = false; hero.coyote = 0; hero.buffer = 0; hero.sy = 1.28; hero.sx = 0.82; burst(hero.x, hero.y, "rgba(255,255,255,0.8)", 5, 60, 0.3); }

      function moveX(dx) {
        let x = hero.x + dx;
        const top = Math.floor((hero.y - HH + 1) / TILE);
        const bottom = Math.floor((hero.y - 1) / TILE);
        const col = Math.floor((x + (dx > 0 ? HW : -HW)) / TILE);
        for (let row = top; row <= bottom; row += 1) {
          if (solid(col, row)) { x = dx > 0 ? col * TILE - HW - 0.01 : (col + 1) * TILE + HW + 0.01; hero.stuck += 1; break; }
        }
        if (x === hero.x + dx) hero.stuck = 0;
        hero.x = x;
      }
      function moveY(dy) {
        const y = hero.y + dy;
        const left = Math.floor((hero.x - HW + 1) / TILE);
        const right = Math.floor((hero.x + HW - 1) / TILE);
        if (dy >= 0) {
          const row = Math.floor(y / TILE);
          for (let col = left; col <= right; col += 1) {
            if (solid(col, row) && hero.y <= row * TILE + 0.5) {
              hero.y = row * TILE; hero.vy = 0;
              if (!hero.ground) { hero.sy = 0.72; hero.sx = 1.25; burst(hero.x, hero.y, "rgba(255,255,255,0.7)", 4, 50, 0.25); }
              hero.ground = true;
              return;
            }
          }
          hero.y = y; hero.ground = false;
        } else {
          const row = Math.floor((y - HH) / TILE);
          for (let col = left; col <= right; col += 1) if (solid(col, row)) { hero.y = (row + 1) * TILE + HH; hero.vy = 0; return; }
          hero.y = y; hero.ground = false;
        }
      }

      function update(dt) {
        started = true;
        t += dt;
        const input = env.input;
        for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 500 * dt; p.life -= dt; }
        particles = particles.filter((p) => p.life > 0);
        hero.sx += (1 - hero.sx) * Math.min(1, dt * 12);
        hero.sy += (1 - hero.sy) * Math.min(1, dt * 12);
        if (hero.dead) {
          hero.deadT += dt; hero.vy += 1500 * dt; hero.y += hero.vy * dt; hero.spin += dt * 9;
          if (hero.deadT > 1) env.over();
          return;
        }
        if (hero.won) {
          hero.wonT += dt;
          if (hero.wonT < 0.6) burst(hero.x + (env.rand() - 0.5) * 120, hero.y - 80 - env.rand() * 60, ["#ffd23a", "#ff5db1", "#5fbcff", "#58cf56"][Math.floor(env.rand() * 4)], 2, 140, 0.9);
          if (hero.wonT > 1.4) env.over();
          return;
        }
        const speed = SPEEDS[level.speed - 1];
        if (input.pressed || input.keyPressed(" ") || input.keyPressed("ArrowUp")) hero.buffer = 0.13;
        hero.buffer -= dt;
        hero.coyote = hero.ground ? 0.09 : hero.coyote - dt;
        if (hero.buffer > 0 && hero.coyote > 0) jump();
        const holding = input.down || input.keys.has(" ") || input.keys.has("ArrowUp");
        hero.vy += GRAVITY * (hero.vy < 0 && holding ? 0.62 : 1) * dt;
        if (hero.vy > 1100) hero.vy = 1100;
        moveX(speed * dt);
        moveY(hero.vy * dt);
        // ---- the things on the way
        const hx0 = Math.floor((hero.x - HW) / TILE), hx1 = Math.floor((hero.x + HW) / TILE);
        const hy0 = Math.floor((hero.y - HH) / TILE), hy1 = Math.floor((hero.y - 1) / TILE);
        for (let row = hy0; row <= hy1; row += 1) {
          for (let col = hx0; col <= hx1; col += 1) {
            const ch = tile(col, row);
            if (ch === "o" && !taken.has(`${col},${row}`)) {
              const cx = (col + 0.5) * TILE, cy = (row + 0.5) * TILE;
              if (Math.abs(hero.x - cx) < 24 && Math.abs(hero.y - 17 - cy) < 26) { taken.add(`${col},${row}`); coins += 1; burst(cx, cy, "#ffd23a", 7, 110, 0.45); }
            } else if (ch === "^") {
              const x0 = col * TILE + 8, x1 = (col + 1) * TILE - 8, y0 = row * TILE + 16;
              if (hero.x + HW - 3 > x0 && hero.x - HW + 3 < x1 && hero.y > y0) die();
            } else if (ch === "s" && hero.vy >= 0) {
              const x0 = col * TILE + 4, x1 = (col + 1) * TILE - 4;
              if (hero.x + HW > x0 && hero.x - HW < x1 && hero.y >= row * TILE + 20) { springs.set(`${col},${row}`, 0.35); jump(SPRING); hero.y = row * TILE + 22; }
            }
          }
        }
        for (const e of enemies) {
          if (!e.alive) { e.squash += dt; continue; }
          e.x += e.dir * 46 * dt;
          if (Math.abs(e.x - e.base) > TILE * 1.4) e.dir *= -1;
          const dx = Math.abs(hero.x - e.x);
          if (dx < HW + 13 && hero.y > e.y - 30 && hero.y - HH < e.y) {
            if (hero.vy > 80 && hero.y - 10 < e.y - 12) { e.alive = false; stomps += 1; hero.vy = -430; hero.ground = false; burst(e.x, e.y - 14, "#ff6b6b", 9, 130, 0.5); } else die();
          }
        }
        if (goalX >= 0 && hero.x >= goalX && !hero.won) { hero.won = true; bonus = 100; hero.wonT = 0; navigator.vibrate?.([30, 40, 90]); }
        if (hero.y > ROWS * TILE + 90) die();
        if (hero.stuck > 90) die();                                         // pushed against a wall for one and a half seconds: the round is over
        camX = Math.max(0, Math.min(WORLD_W - W, hero.x - 112));
        env.score(Math.floor(hero.x / TILE) + coins * 10 + stomps * 20 + bonus);
      }

      // ------------------------------------------------------------------------------------------ the picture
      function sky() {
        const grad = g.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, palette.top);
        grad.addColorStop(1, palette.bottom);
        g.globalAlpha = 0.9;
        g.fillStyle = grad;
        g.fillRect(0, 0, W, H);
        g.globalAlpha = 1;
        if (palette.stars) { g.fillStyle = "rgba(255,255,255,0.85)"; for (const s of stars) { g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + s.x); g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill(); } g.globalAlpha = 1; }
        g.fillStyle = palette.sun; g.beginPath(); g.arc(285, 130, 30, 0, TAU); g.fill();
        // clouds and two rows of hills that move slower than the ground
        g.fillStyle = palette.cloud;
        for (let i = 0; i < 6; i += 1) {
          const x = ((i * 190 - camX * 0.25 + 5000 * 360) % 1140) - 150, y = 90 + ((i * 47) % 90);
          g.beginPath(); g.arc(x, y, 22, 0, TAU); g.arc(x + 26, y - 10, 28, 0, TAU); g.arc(x + 58, y, 21, 0, TAU); g.rect(x, y, 58, 21); g.fill();
        }
        for (const [color, speed, amp, base] of [[palette.far, 0.3, 36, 0], [palette.near, 0.55, 28, 26]]) {
          g.fillStyle = color;
          g.beginPath(); g.moveTo(0, H);
          for (let x = 0; x <= W; x += 12) g.lineTo(x, Y0 + 120 + base - amp * (0.5 + 0.5 * Math.sin((x + camX * speed) / 58 + base)));
          g.lineTo(W, H); g.closePath(); g.fill();
        }
      }
      function block(col, row, sx) {
        const x = sx, y = Y0 + row * TILE;
        const above = solid(col, row - 1);
        g.fillStyle = (col + row) % 2 ? palette.dirt : palette.dirt2;
        g.fillRect(x, y, TILE + 0.5, TILE + 0.5);
        g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(x + 6, y + 14, 8, 5); g.fillRect(x + 24, y + 26, 9, 5);
        if (!above) {
          g.fillStyle = palette.cap; g.fillRect(x, y, TILE + 0.5, 11);
          g.fillStyle = palette.capDark; g.fillRect(x, y + 9, TILE + 0.5, 3);
          g.fillStyle = palette.cap;
          for (let k = 0; k < 4; k += 1) { g.beginPath(); g.moveTo(x + k * 10 + 1, y + 11); g.lineTo(x + k * 10 + 5, y + 18); g.lineTo(x + k * 10 + 9, y + 11); g.fill(); }
        }
      }
      function draw() {
        sky();
        const c0 = Math.max(0, Math.floor(camX / TILE)), c1 = Math.min(level.cols - 1, c0 + Math.ceil(W / TILE) + 1);
        g.fillStyle = palette.dirt2; g.fillRect(0, Y0 + ROWS * TILE, W, H - Y0 - ROWS * TILE);
        for (let col = c0; col <= c1; col += 1) {
          const sx = Math.round(col * TILE - camX);
          for (let row = 0; row < ROWS; row += 1) {
            const ch = map[row][col];
            if (ch === "#") block(col, row, sx);
            else if (ch === "^") {
              const y = Y0 + row * TILE;
              g.fillStyle = "#dfe6ee";
              for (let k = 0; k < 3; k += 1) { g.beginPath(); g.moveTo(sx + 2 + k * 12.5, y + TILE); g.lineTo(sx + 8.5 + k * 12.5, y + 14); g.lineTo(sx + 15 + k * 12.5, y + TILE); g.fill(); }
              g.fillStyle = "rgba(0,0,0,0.25)"; for (let k = 0; k < 3; k += 1) { g.beginPath(); g.moveTo(sx + 8.5 + k * 12.5, y + 14); g.lineTo(sx + 15 + k * 12.5, y + TILE); g.lineTo(sx + 9 + k * 12.5, y + TILE); g.fill(); }
            } else if (ch === "o" && !taken.has(`${col},${row}`)) {
              const cx = sx + TILE / 2, cy = Y0 + row * TILE + TILE / 2 + Math.sin(t * 3 + col) * 2, w = Math.abs(Math.cos(t * 4 + col * 0.6)) * 10 + 3;
              g.fillStyle = "#c98a00"; g.beginPath(); g.ellipse(cx, cy, w + 1.5, 11.5, 0, 0, TAU); g.fill();
              g.fillStyle = "#ffd23a"; g.beginPath(); g.ellipse(cx, cy, w, 10, 0, 0, TAU); g.fill();
              g.fillStyle = "rgba(255,255,255,0.6)"; g.beginPath(); g.ellipse(cx - w * 0.3, cy - 3, w * 0.25, 4, 0, 0, TAU); g.fill();
            } else if (ch === "s") {
              const press = springs.get(`${col},${row}`) || 0;
              springs.set(`${col},${row}`, Math.max(0, press - 1 / 60));
              const y = Y0 + (row + 1) * TILE, h = 22 - press * 30;
              g.strokeStyle = "#b9c2cc"; g.lineWidth = 4;
              g.beginPath(); for (let k = 0; k <= 4; k += 1) { const yy = y - (h * k) / 4; g.lineTo(sx + 20 + (k % 2 ? 9 : -9), yy); } g.stroke();
              env.rect(sx + 6, y - h - 7, 28, 9, "#ff4d5e", 4);
            } else if (ch === "F") {
              const y = Y0 + (row + 1) * TILE;
              env.rect(sx + 18, y - 110, 4, 110, "#e8e8ee", 2);
              g.fillStyle = "#ff4d5e"; g.beginPath(); g.moveTo(sx + 22, y - 108);
              for (let k = 0; k <= 8; k += 1) g.lineTo(sx + 22 + k * 4.5, y - 108 + Math.sin(t * 6 + k * 0.7) * 3 + (k / 8) * 2);
              for (let k = 8; k >= 0; k -= 1) g.lineTo(sx + 22 + k * 4.5, y - 78 + Math.sin(t * 6 + k * 0.7) * 3);
              g.closePath(); g.fill();
              env.circle(sx + 20, y - 112, 5, "#ffd23a");
            }
          }
        }
        for (const e of enemies) {
          const sx = e.x - camX, y = Y0 + e.y;
          if (sx < -40 || sx > W + 40) continue;
          if (!e.alive) { if (e.squash < 0.4) { g.globalAlpha = 1 - e.squash / 0.4; env.rect(sx - 15, y - 8, 30, 8, "#ff6b6b", 4); g.globalAlpha = 1; } continue; }
          const bob = Math.abs(Math.sin(t * 8 + e.base)) * 3;
          g.fillStyle = "#ff5a5f"; g.beginPath(); g.ellipse(sx, y - 13 - bob, 15, 13, 0, 0, TAU); g.fill();
          g.fillStyle = "rgba(0,0,0,0.18)"; g.beginPath(); g.ellipse(sx, y - 5 - bob, 15, 6, 0, 0, Math.PI); g.fill();
          env.circle(sx - 5, y - 16 - bob, 4.2, "#fff"); env.circle(sx + 5, y - 16 - bob, 4.2, "#fff");
          env.circle(sx - 5 + e.dir * 1.5, y - 16 - bob, 2, "#111"); env.circle(sx + 5 + e.dir * 1.5, y - 16 - bob, 2, "#111");
          env.line(sx - 9, y - 24 - bob, sx - 2, y - 21 - bob, "#7a1d22", 2.5); env.line(sx + 9, y - 24 - bob, sx + 2, y - 21 - bob, "#7a1d22", 2.5);
        }
        for (const p of particles) { g.globalAlpha = Math.max(0, p.life / p.max); g.fillStyle = p.color; g.beginPath(); g.arc(p.x - camX, Y0 + p.y, p.size, 0, TAU); g.fill(); }
        g.globalAlpha = 1;
        // the figure: it leans into the run, squashes when it lands and stretches when it jumps
        const hx = hero.x - camX, hy = Y0 + hero.y;
        if (!hero.dead) { g.fillStyle = "rgba(0,0,0,0.2)"; g.beginPath(); g.ellipse(hx, hy + 1, 15 * hero.sx, 4, 0, 0, TAU); g.fill(); }
        g.save();
        g.translate(hx, hy - 18);
        g.rotate(hero.dead ? hero.spin : Math.max(-0.35, Math.min(0.35, hero.vy / 1800)) + (hero.ground ? Math.sin(t * 22) * 0.07 : 0));
        g.scale(hero.sx, hero.sy);
        g.font = '38px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(level.hero, 0, 2);
        g.restore();
        // the strip at the top: how far, and the coins
        const bar = Math.min(1, hero.x / Math.max(1, goalX > 0 ? goalX : WORLD_W));
        env.panel(16, 100, 328, 14, 7, 0.4);
        env.rect(16, 100, Math.max(14, 328 * bar), 14, palette.cap, 7);
        env.text(`🪙 ${coins}/${coinsTotal}`, 24, 126, { size: 16, align: "left" });
        if (!started || t < 3.5) {
          env.panel(40, 520, 280, 64, 22, 0.55);
          env.text("Tippen: springen", W / 2, 544, { size: 20 });
          env.text("Halten: höher springen", W / 2, 570, { size: 15, color: "rgba(255,255,255,0.8)", weight: 700, stroke: false });
        }
        if (hero.won) env.text("Geschafft!", W / 2, 300, { size: 46, color: "#ffe066" });
      }
      return { update, draw, peek: () => ({ hero, coins, stomps, bonus, camX, tile, speed: SPEEDS[level.speed - 1], enemies }), destroy() { particles = []; } };         // (peek: for the tests)
    };
  }

  // ------------------------------------------------------------------------------------------------------------------ a game that is code (in a sealed worker)
  function codeDef(meta) {
    return { id: meta.id, name: meta.title, emoji: meta.emoji, cat: "Community", hint: meta.hint || `Spiel von @${meta.user ? meta.user.handle : "?"}`, color: meta.color, bubble: true, community: true,
      create(env) {
        let worker = null;
        let frame = null;
        let ready = false;
        let waiting = false;
        let sentAt = 0;
        let problem = "";
        try { worker = new Worker(`/api/yipi/game-worker/${meta.id}`); } catch (error) { problem = "Dieses Spiel kann nicht starten."; }
        if (worker) {
          worker.onmessage = (event) => {
            const m = event.data || {};
            if (m.t === "ready") ready = true;
            else if (m.t === "frame" && m.bitmap && m.bitmap.width === W && m.bitmap.height === H) { if (frame && frame.close) frame.close(); frame = m.bitmap; waiting = false; }
            else if (m.t === "score" && Number.isFinite(m.n)) env.score(m.n);
            else if (m.t === "over") env.over();
            else if (m.t === "error") { problem = `Fehler im Spiel: ${String(m.message || "").slice(0, 80)}`; waiting = false; }
          };
          worker.onerror = (event) => { problem = `Fehler im Code: ${String(event.message || "").slice(0, 80)}`; if (event.preventDefault) event.preventDefault(); };
        }
        return {
          update(dt) {
            if (!worker || problem) return;
            const now = performance.now();
            if (ready && !waiting) {
              const i = env.input;
              worker.postMessage({ t: "input", input: { x: i.x, y: i.y, down: i.down, pressed: i.pressed, tap: i.tap, released: i.released, swipe: i.swipe } });
              worker.postMessage({ t: "step", dt });
              waiting = true;
              sentAt = now;
            } else if (waiting && now - sentAt > 2500) { problem = "Das Spiel hängt: es wurde angehalten."; worker.terminate(); }
          },
          draw() {
            if (frame) env.g.drawImage(frame, 0, 0, W, H);
            if (problem) { env.panel(24, 250, 312, 110, 22, 0.75); env.text(problem, W / 2, 305, { size: 16, weight: 700, stroke: false }); }
          },
          destroy() { if (worker) worker.terminate(); if (frame && frame.close) frame.close(); frame = null; },
        };
      } };
  }

  function platformerDef(meta, data) {
    const level = parseLevel(data);
    return { id: meta.id, name: meta.title, emoji: meta.emoji || level.hero, cat: "Community", hint: meta.hint || `Level von @${meta.user ? meta.user.handle : "?"} · Tippen zum Springen`, color: meta.color, bubble: true, community: true, create: platformerCreate(level) };
  }

  /* Used by the camera tab for a game of the community: the definition of the game made from what the server sent. */
  function communityDef(row) {
    return row.kind === "code" ? codeDef(row) : platformerDef(row, row.data);
  }

  // three ready-made levels (the builder starts from the same maker)
  for (const [id, name, emoji, color, order, options] of [
    ["jr-huegel", "Hügelland", "🐱", "#58cf56", 6, { seed: 11, theme: "day", hero: "🐱", speed: 2, hard: 0.35 }],
    ["jr-nacht", "Nachtlauf", "🦊", "#3b3d92", 7, { seed: 23, theme: "night", hero: "🦊", speed: 2, hard: 0.6 }],
    ["jr-zucker", "Zuckerwelt", "🐸", "#ff5db1", 8, { seed: 37, theme: "candy", hero: "🐸", speed: 3, hard: 0.5 }],
  ]) {
    PG.register({ id, name, emoji, cat: "Jump & Run", featured: true, order, color, bubble: true, hint: "Tippen zum Springen · Halten für höher · sammle Münzen und erreiche die Flagge", create: platformerCreate(generateLevel({ cols: 96, ...options })) });
  }

  PG.community = { communityDef, platformerDef, codeDef, generateLevel, parseLevel, THEMES, TILE, ROWS };
})();
