/* Pulse game: Fruit Merge (fruit-merge.js). Drop fruits; two of the same kind that touch melt into the next bigger one; when the heap grows over the
   dashed line the game is over. The same game as in the earlier version of this site (the physics is the library Matter.js, MIT licence, in
   static/vendor/), without points to spend: every round brings one shake, one deletion and one bomb. `FruitMerge.create(canvas, hooks)` draws into
   the canvas and calls hooks.onScore(score), hooks.onOver(score) and hooks.onPower(state) ({shake, remove, bomb, removing, armed} -> what is left). */
(function () {
  "use strict";

  const WIDTH = 460;
  const HEIGHT = 560;
  const WALL = 16;
  const DANGER_LINE_Y = 70;
  const DROP_Y = 40;
  const BOMB_RADIUS = 22;
  const EXPLOSION_RADIUS = 105;
  const EXPLOSION_ANIM_MS = 400;
  const FRUIT_DEATH_ANIM_MS = 300;
  const EDGE_MARGIN = 24;
  const POWERS = { shake: 1, remove: 1, bomb: 1 };                 // what a round brings

  const TIERS = [
      { radius: 13, color: "#e74c3c", kind: "cherry", topper: "leaf" },
      { radius: 19, color: "#ff5c77", kind: "strawberry", topper: "leaf" },
      { radius: 25, color: "#8e44ad", kind: "grape", topper: "leaf" },
      { radius: 32, color: "#e67e22", kind: "orange", topper: "leaf" },
      { radius: 40, color: "#c0392b", kind: "apple", topper: "leaf" },
      { radius: 48, color: "#b5d94c", kind: "pear", topper: "leaf" },
      { radius: 56, color: "#ffb28a", kind: "peach", topper: "leaf" },
      { radius: 65, color: "#f2c230", kind: "pineapple", topper: "crown" },
      { radius: 75, color: "#c7e06a", kind: "melon", topper: null },
      { radius: 88, color: "#2fa84f", kind: "watermelon", topper: null },
      { radius: 97, color: "#ffa733", kind: "mango", topper: "leaf" },
      { radius: 106, color: "#a9744f", kind: "coconut", topper: null },
      { radius: 115, color: "#f08a1e", kind: "pumpkin", topper: "leaf" },
      { radius: 124, color: "#e0452c", kind: "tomato", topper: "calyx" },
      { radius: 133, color: "#6fbf4a", kind: "giantmelon", topper: null },
  ];
  const SPAWN_WEIGHTS = [0, 0, 0, 0, 1, 1, 1, 2, 2, 3];

  const HITBOX_SCALE = {
      apple: 0.92,
      pear: 0.82,
      strawberry: 0.85,
      mango: 0.85,
      pineapple: 0.8,
  };

  function hitboxRadius(tier) {
      return tier.radius * (HITBOX_SCALE[tier.kind] || 1);
  }

  function shade(hex, percent) {
      const num = parseInt(hex.slice(1), 16);
      const amt = Math.round((255 * percent) / 100);
      let r = (num >> 16) + amt;
      let g = ((num >> 8) & 0xff) + amt;
      let b = (num & 0xff) + amt;
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      return `rgb(${r},${g},${b})`;
  }

  function create(canvas, hooks = {}) {
    const { Engine, Runner, Bodies, Body, Composite, Events } = window.Matter;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    function fruitPath(kind, x, y, r) {
        ctx.beginPath();
        switch (kind) {
            case "apple":
                ctx.moveTo(x, y - r * 0.95);
                ctx.bezierCurveTo(x + r * 0.55, y - r * 1.05, x + r * 1.05, y - r * 0.55, x + r * 1.0, y + r * 0.05);
                ctx.bezierCurveTo(x + r * 0.95, y + r * 0.75, x + r * 0.5, y + r * 1.05, x, y + r * 1.0);
                ctx.bezierCurveTo(x - r * 0.5, y + r * 1.05, x - r * 0.95, y + r * 0.75, x - r * 1.0, y + r * 0.05);
                ctx.bezierCurveTo(x - r * 1.05, y - r * 0.55, x - r * 0.55, y - r * 1.05, x, y - r * 0.95);
                break;
            case "pear":
                ctx.moveTo(x - r * 0.28, y - r * 0.55);
                ctx.bezierCurveTo(x - r * 0.35, y - r * 0.85, x - r * 0.15, y - r * 1.05, x, y - r * 1.05);
                ctx.bezierCurveTo(x + r * 0.15, y - r * 1.05, x + r * 0.35, y - r * 0.85, x + r * 0.28, y - r * 0.55);
                ctx.bezierCurveTo(x + r * 0.55, y - r * 0.15, x + r * 1.05, y + r * 0.15, x + r * 0.85, y + r * 0.65);
                ctx.bezierCurveTo(x + r * 0.7, y + r * 1.05, x + r * 0.3, y + r * 1.15, x, y + r * 1.15);
                ctx.bezierCurveTo(x - r * 0.3, y + r * 1.15, x - r * 0.7, y + r * 1.05, x - r * 0.85, y + r * 0.65);
                ctx.bezierCurveTo(x - r * 1.05, y + r * 0.15, x - r * 0.55, y - r * 0.15, x - r * 0.28, y - r * 0.55);
                break;
            case "strawberry":
                ctx.moveTo(x, y + r * 1.05);
                ctx.bezierCurveTo(x + r * 0.7, y + r * 0.6, x + r * 1.05, y - r * 0.1, x + r * 0.85, y - r * 0.55);
                ctx.bezierCurveTo(x + r * 0.6, y - r * 1.05, x, y - r * 0.85, x, y - r * 0.55);
                ctx.bezierCurveTo(x, y - r * 0.85, x - r * 0.6, y - r * 1.05, x - r * 0.85, y - r * 0.55);
                ctx.bezierCurveTo(x - r * 1.05, y - r * 0.1, x - r * 0.7, y + r * 0.6, x, y + r * 1.05);
                break;
            case "mango":
                ctx.moveTo(x, y - r * 0.9);
                ctx.bezierCurveTo(x + r * 0.75, y - r * 0.85, x + r * 1.05, y - r * 0.1, x + r * 0.7, y + r * 0.55);
                ctx.bezierCurveTo(x + r * 0.45, y + r * 1.0, x - r * 0.35, y + r * 1.05, x - r * 0.75, y + r * 0.55);
                ctx.bezierCurveTo(x - r * 1.05, y + r * 0.05, x - r * 0.7, y - r * 0.7, x, y - r * 0.9);
                break;
            case "pineapple":
                ctx.ellipse(x, y, r * 0.72, r * 1.12, 0, 0, Math.PI * 2);
                break;
            default:
                ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.closePath();
    }

    function drawFruitBase(kind, r, color) {
        const grad = ctx.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r * 1.05);
        grad.addColorStop(0, shade(color, 35));
        grad.addColorStop(0.6, color);
        grad.addColorStop(1, shade(color, -30));
        fruitPath(kind, 0, 0, r);
        ctx.fillStyle = grad;
        ctx.fill();
    }

    function drawHighlight(x, y, r) {
        ctx.beginPath();
        ctx.ellipse(x - r * 0.32, y - r * 0.38, r * 0.26, r * 0.15, -0.6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fill();
    }

    function drawStem(x, y, r) {
        ctx.strokeStyle = "#6b4423";
        ctx.lineWidth = Math.max(1.5, r * 0.05);
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.94);
        ctx.lineTo(x + r * 0.08, y - r * 1.18);
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(x + r * 0.26, y - r * 1.08, r * 0.24, r * 0.13, -0.7, 0, Math.PI * 2);
        ctx.fillStyle = "#4caf50";
        ctx.fill();
    }

    function drawPineappleCrown(x, y, r) {
        ctx.fillStyle = "#2e7d32";
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * r * 0.16, y - r * 0.9);
            ctx.lineTo(x + i * r * 0.16 - r * 0.08, y - r * 1.35 - Math.abs(i) * r * 0.1);
            ctx.lineTo(x + i * r * 0.16 + r * 0.08, y - r * 1.35 - Math.abs(i) * r * 0.1);
            ctx.closePath();
            ctx.fill();
        }
    }

    function drawTomatoCalyx(x, y, r) {
        ctx.fillStyle = "#4caf50";
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2 - Math.PI / 2;
            ctx.beginPath();
            ctx.ellipse(
                x + Math.cos(angle) * r * 0.12,
                y - r * 0.95 + Math.sin(angle) * r * 0.12,
                r * 0.16, r * 0.08, angle, 0, Math.PI * 2
            );
            ctx.fill();
        }
    }

    function drawSeeds(x, y, r, color, count) {
        ctx.fillStyle = color;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.15;
            const dist = r * (0.35 + (0.45 * ((i * 37) % 10)) / 10);
            const sx = x + Math.cos(angle) * dist;
            const sy = y + Math.sin(angle) * dist * 0.9;
            ctx.beginPath();
            ctx.ellipse(sx, sy, r * 0.05, r * 0.08, angle, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawDimples(x, y, r) {
        ctx.fillStyle = "rgba(0,0,0,0.1)";
        for (let i = 0; i < 24; i++) {
            const angle = (i * 2.4) % (Math.PI * 2);
            const dist = r * (0.2 + (0.6 * ((i * 53) % 10)) / 10);
            const sx = x + Math.cos(angle) * dist;
            const sy = y + Math.sin(angle) * dist;
            ctx.beginPath();
            ctx.arc(sx, sy, r * 0.035, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawStripes(x, y, r, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = r * 0.14;
        for (let i = -2; i <= 2; i++) {
            ctx.beginPath();
            ctx.moveTo(x + i * r * 0.32, y - r);
            ctx.quadraticCurveTo(x + i * r * 0.32 + r * 0.15, y, x + i * r * 0.32, y + r);
            ctx.stroke();
        }
    }

    function drawNet(x, y, r) {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        for (let i = -3; i <= 3; i++) {
            ctx.beginPath();
            ctx.moveTo(x - r, y + i * r * 0.28);
            ctx.lineTo(x + r, y + i * r * 0.28 + r * 0.3);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - r, y + i * r * 0.28 + r * 0.3);
            ctx.lineTo(x + r, y + i * r * 0.28);
            ctx.stroke();
        }
    }

    function drawCrosshatch(x, y, r) {
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = Math.max(1, r * 0.03);
        for (let i = -4; i <= 4; i++) {
            ctx.beginPath();
            ctx.moveTo(x - r, y + i * r * 0.25);
            ctx.lineTo(x + r, y + i * r * 0.25 + r * 0.9);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x - r, y + i * r * 0.25 + r * 0.9);
            ctx.lineTo(x + r, y + i * r * 0.25);
            ctx.stroke();
        }
    }

    function drawCoconutFace(x, y, r) {
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        const positions = [[-0.2, -0.3], [0.2, -0.3], [0, 0.05]];
        for (const [ox, oy] of positions) {
            ctx.beginPath();
            ctx.arc(x + ox * r, y + oy * r, r * 0.09, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawRibs(x, y, r) {
        ctx.strokeStyle = "rgba(0,0,0,0.18)";
        ctx.lineWidth = Math.max(1.5, r * 0.05);
        for (let i = -3; i <= 3; i++) {
            const ox = i * r * 0.28;
            ctx.beginPath();
            ctx.moveTo(x + ox, y - r * 0.95);
            ctx.quadraticCurveTo(x + ox * 1.2, y, x + ox, y + r * 0.95);
            ctx.stroke();
        }
    }

    function drawCrease(x, y, r) {
        ctx.strokeStyle = "rgba(0,0,0,0.15)";
        ctx.lineWidth = Math.max(1.5, r * 0.05);
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.8);
        ctx.quadraticCurveTo(x + r * 0.1, y, x, y + r * 0.8);
        ctx.stroke();
    }

    function drawFruitTexture(tier, x, y, r) {
        switch (tier.kind) {
            case "strawberry": drawSeeds(x, y, r, "#ffe066", 14); break;
            case "orange": drawDimples(x, y, r); break;
            case "watermelon": drawStripes(x, y, r, "#1b5e20"); break;
            case "melon": case "giantmelon": drawNet(x, y, r); break;
            case "pineapple": drawCrosshatch(x, y, r); break;
            case "coconut": drawCoconutFace(x, y, r); break;
            case "pumpkin": drawRibs(x, y, r); break;
            case "peach": drawCrease(x, y, r); break;
            default: break;
        }
    }

    function drawFruit(tier, x, y, angle) {
        const r = tier.radius;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle || 0);

        drawFruitBase(tier.kind, r, tier.color);

        ctx.save();
        fruitPath(tier.kind, 0, 0, r);
        ctx.clip();
        drawFruitTexture(tier, 0, 0, r);
        ctx.restore();

        drawHighlight(0, 0, r);

        if (tier.topper === "leaf") {
            drawStem(0, 0, r);
        } else if (tier.topper === "crown") {
            drawPineappleCrown(0, 0, r);
        } else if (tier.topper === "calyx") {
            drawTomatoCalyx(0, 0, r);
        }

        ctx.restore();
    }

    const engine = Engine.create();
    engine.gravity.y = 1.1;
    const runner = Runner.create();
    Runner.run(runner, engine);
    Composite.add(engine.world, [
      Bodies.rectangle(WIDTH / 2, HEIGHT + WALL / 2, WIDTH, WALL, { isStatic: true }),
      Bodies.rectangle(-WALL / 2, HEIGHT / 2, WALL, HEIGHT * 2, { isStatic: true }),
      Bodies.rectangle(WIDTH + WALL / 2, HEIGHT / 2, WALL, HEIGHT * 2, { isStatic: true }),
    ]);

    let score = 0;
    let gameOver = false;
    let dropCooldown = false;
    let overLineSince = null;
    let currentTierIndex = randomSpawnTier();
    let previewX = WIDTH / 2;
    let removing = false;
    let armed = false;
    let explosions = [];
    let floatingTexts = [];
    let power = { ...POWERS };
    let frame = 0;
    let dead = false;
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };

    function randomSpawnTier() {
      return SPAWN_WEIGHTS[Math.floor(Math.random() * SPAWN_WEIGHTS.length)];
    }

    const announce = () => hooks.onPower && hooks.onPower({ ...power, removing, armed, over: gameOver });

    function createFruit(tierIndex, x, y) {
      const tier = TIERS[tierIndex];
      const body = Bodies.circle(x, y, hitboxRadius(tier), { restitution: 0.38, friction: 0.5, frictionAir: 0.0035, density: 0.0015 });
      body.tierIndex = tierIndex;
      body.mergeLock = false;
      return body;
    }

    function createBomb(x, y) {
      const body = Bodies.circle(x, y, BOMB_RADIUS, { restitution: 0.2, friction: 0.5, frictionAir: 0.0035, density: 0.002 });
      body.isBomb = true;
      body.exploded = false;
      return body;
    }

    function drawBomb(x, y) {
      ctx.beginPath();
      ctx.arc(x, y, BOMB_RADIUS, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, BOMB_RADIUS);
      grad.addColorStop(0, "#666");
      grad.addColorStop(1, "#111");
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = "#a9744f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, y - BOMB_RADIUS);
      ctx.lineTo(x + 6, y - BOMB_RADIUS - 10);
      ctx.stroke();
      ctx.fillStyle = "#ff8c1a";
      ctx.beginPath();
      ctx.arc(x + 7, y - BOMB_RADIUS - 12, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    function explodeBomb(bomb) {
      bomb.exploded = true;
      const cx = bomb.position.x;
      const cy = bomb.position.y;
      Composite.remove(engine.world, bomb);
      explosions.push({ x: cx, y: cy, start: performance.now() });
      for (const b of Composite.allBodies(engine.world).filter((body) => body.tierIndex !== undefined && !body.dying)) {
        const dx = b.position.x - cx;
        const dy = b.position.y - cy;
        if (dx * dx + dy * dy <= EXPLOSION_RADIUS * EXPLOSION_RADIUS) {
          b.dying = true;
          b.dyingStart = performance.now();
          later(() => Composite.remove(engine.world, b), FRUIT_DEATH_ANIM_MS);
        }
      }
    }

    function drawExplosions() {
      const now = performance.now();
      explosions = explosions.filter((e) => now - e.start < EXPLOSION_ANIM_MS);
      for (const e of explosions) {
        const progress = (now - e.start) / EXPLOSION_ANIM_MS;
        ctx.save();
        ctx.globalAlpha = 1 - progress;
        ctx.strokeStyle = "#ff8c1a";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(e.x, e.y, EXPLOSION_RADIUS * progress, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    function addScore(delta, x, y) {
      score += delta;
      floatingTexts.push({ x, y, text: `+${delta}`, start: performance.now() });
      if (hooks.onScore) hooks.onScore(score);
    }

    function drawFloatingTexts() {
      const now = performance.now();
      floatingTexts = floatingTexts.filter((t) => now - t.start < 900);
      for (const t of floatingTexts) {
        const progress = (now - t.start) / 900;
        const riseY = t.y - progress * 40;
        ctx.save();
        ctx.globalAlpha = 1 - progress;
        ctx.font = "bold 22px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const grad = ctx.createLinearGradient(t.x, riseY - 12, t.x, riseY + 12);
        grad.addColorStop(0, "#ffe066");
        grad.addColorStop(1, "#ff8c1a");
        ctx.fillStyle = grad;
        ctx.fillText(t.text, t.x, riseY);
        ctx.restore();
      }
    }

    function clampPreviewX() {
      const r = armed ? BOMB_RADIUS : TIERS[currentTierIndex].radius;
      previewX = Math.max(WALL + r + EDGE_MARGIN, Math.min(WIDTH - WALL - r - EDGE_MARGIN, previewX));
    }

    function toCanvas(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return { x: ((clientX - rect.left) * WIDTH) / rect.width, y: ((clientY - rect.top) * HEIGHT) / rect.height };
    }

    function aim(clientX) {
      previewX = toCanvas(clientX, 0).x;
      clampPreviewX();
    }

    function removeAt(clientX, clientY) {
      const point = toCanvas(clientX, clientY);
      for (const b of Composite.allBodies(engine.world).filter((body) => body.tierIndex !== undefined && !body.dying)) {
        const dx = b.position.x - point.x;
        const dy = b.position.y - point.y;
        const r = TIERS[b.tierIndex].radius;
        if (dx * dx + dy * dy <= r * r) {
          Composite.remove(engine.world, b);
          power.remove -= 1;
          break;
        }
      }
      removing = false;
      announce();
    }

    function drop() {
      if (gameOver || dropCooldown || dead) return;
      clampPreviewX();
      let body;
      if (armed) {
        body = createBomb(previewX, DROP_Y);
        armed = false;
        power.bomb -= 1;
        announce();
      } else {
        body = createFruit(currentTierIndex, previewX, DROP_Y);
      }
      Composite.add(engine.world, body);
      dropCooldown = true;
      later(() => { dropCooldown = false; }, 350);
      currentTierIndex = randomSpawnTier();
    }

    // ---- input: the mouse aims and a click drops, a finger aims while it is down and drops when it lets go
    const on = (target, type, handler, options) => { target.addEventListener(type, handler, options); return () => target.removeEventListener(type, handler, options); };
    const off = [
      on(canvas, "pointermove", (event) => aim(event.clientX)),
      on(canvas, "pointerdown", (event) => { aim(event.clientX); if (event.pointerType !== "mouse") canvas.setPointerCapture?.(event.pointerId); }),
      on(canvas, "pointerup", (event) => {
        if (removing) { removeAt(event.clientX, event.clientY); return; }
        aim(event.clientX);
        drop();
      }),
      on(window, "keydown", (event) => {
        if (event.target && /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
        if (event.key === "ArrowLeft") { previewX -= 18; clampPreviewX(); event.preventDefault(); }
        if (event.key === "ArrowRight") { previewX += 18; clampPreviewX(); event.preventDefault(); }
        if (event.key === " " || event.key === "ArrowDown") { drop(); event.preventDefault(); }
      }),
    ];

    Events.on(engine, "collisionStart", (event) => {
      for (const pair of event.pairs) {
        const a = pair.bodyA;
        const b = pair.bodyB;
        const bomb = a.isBomb ? a : (b.isBomb ? b : null);
        if (bomb && !bomb.exploded) { explodeBomb(bomb); continue; }
        if (a.tierIndex === undefined || b.tierIndex === undefined || a.dying || b.dying || a.mergeLock || b.mergeLock || a.tierIndex !== b.tierIndex) continue;
        const tierIndex = a.tierIndex;
        a.mergeLock = true;
        b.mergeLock = true;
        const midX = (a.position.x + b.position.x) / 2;
        const midY = (a.position.y + b.position.y) / 2;
        Composite.remove(engine.world, [a, b]);
        addScore(tierIndex + 1, midX, midY);
        if (tierIndex < TIERS.length - 1) Composite.add(engine.world, createFruit(tierIndex + 1, midX, midY));
      }
    });

    function triggerGameOver() {
      gameOver = true;
      removing = false;
      armed = false;
      announce();
      if (hooks.onOver) hooks.onOver(score);
    }

    function restart() {
      Composite.remove(engine.world, Composite.allBodies(engine.world).filter((b) => b.tierIndex !== undefined || b.isBomb));
      score = 0;
      gameOver = false;
      overLineSince = null;
      floatingTexts = [];
      explosions = [];
      removing = false;
      armed = false;
      power = { ...POWERS };
      currentTierIndex = randomSpawnTier();
      if (hooks.onScore) hooks.onScore(0);
      announce();
    }

    function render() {
      if (dead) return;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = "rgba(255, 80, 80, 0.5)";
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(0, DANGER_LINE_Y);
      ctx.lineTo(WIDTH, DANGER_LINE_Y);
      ctx.stroke();
      ctx.setLineDash([]);
      let overLine = false;
      for (const body of Composite.allBodies(engine.world).filter((b) => b.tierIndex !== undefined || b.isBomb)) {
        if (body.isBomb) { drawBomb(body.position.x, body.position.y); continue; }
        const tier = TIERS[body.tierIndex];
        if (body.dying) {
          ctx.save();
          ctx.globalAlpha = 1 - Math.min(1, (performance.now() - body.dyingStart) / FRUIT_DEATH_ANIM_MS);
          drawFruit(tier, body.position.x, body.position.y, body.angle);
          ctx.restore();
          continue;
        }
        drawFruit(tier, body.position.x, body.position.y, body.angle);
        if (!gameOver && body.position.y - tier.radius < DANGER_LINE_Y && Math.abs(body.velocity.y) < 0.5) overLine = true;
      }
      if (!gameOver) {
        if (overLine) {
          if (overLineSince === null) overLineSince = performance.now();
          else if (performance.now() - overLineSince > 1500) triggerGameOver();
        } else overLineSince = null;
        clampPreviewX();
        ctx.globalAlpha = 0.85;
        if (armed) drawBomb(previewX, DROP_Y); else drawFruit(TIERS[currentTierIndex], previewX, DROP_Y);
        ctx.globalAlpha = 1;
      }
      drawFloatingTexts();
      drawExplosions();
      frame = requestAnimationFrame(render);
    }
    frame = requestAnimationFrame(render);
    announce();

    return {
      restart,
      shake() {
        if (gameOver || power.shake < 1) return;
        power.shake -= 1;
        for (const b of Composite.allBodies(engine.world).filter((body) => body.tierIndex !== undefined && !body.dying)) Body.setVelocity(b, { x: (Math.random() - 0.5) * 8, y: -Math.random() * 4 });
        announce();
      },
      toggleRemove() { if (gameOver || power.remove < 1) return; removing = !removing; armed = false; announce(); },
      toggleBomb() { if (gameOver || power.bomb < 1) return; armed = !armed; removing = false; announce(); },
      destroy() {
        dead = true;
        cancelAnimationFrame(frame);
        Runner.stop(runner);
        Events.off(engine);
        off.forEach((undo) => undo());
        timers.forEach((id) => clearTimeout(id));
        Composite.clear(engine.world, false);
        Engine.clear(engine);
      },
    };
  }

  window.FruitMerge = { create, WIDTH, HEIGHT, TIERS };
})();
