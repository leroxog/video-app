/* Pulse games, the kit (pg-kit.js): what every small game of the camera tab is built from. A game is registered with PulseGames.register({id, name, emoji,
   cat, hint, create(env)}); create() returns {update(dt), draw()}. The game gets an `env` with the size of the play field (360 x 640, upright),
   the drawing helpers, the input of the finger or mouse (one pressed/released/tap/swipe per tick, plus the keys), a seeded random number generator
   and score()/over(). Nothing is drawn behind the game: the canvas is see-through, so the picture of the camera shows behind it (and the recording
   of the camera tab captures both). The same code runs without a browser in the tests (PulseGames.headless). No sound: the recording takes the
   voice of the player, not the game. */
(function () {
  "use strict";

  const W = 360;
  const H = 640;
  const STEP = 1 / 60;
  const games = [];
  const byId = new Map();

  function register(def) {
    if (!def || !/^[a-z0-9-]{2,30}$/.test(def.id) || byId.has(def.id) || (typeof def.create !== "function" && !(def.external && typeof def.run === "function"))) throw new Error(`game ${def && def.id}`);
    games.push(def);
    byId.set(def.id, def);
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------------------------------------ the environment of one game */
  function createEnv(ctx, hooks, seed) {
    const random = mulberry32(seed == null ? (Math.random() * 4294967296) >>> 0 : seed);
    let points = 0;
    let finished = false;
    const input = {
      x: W / 2, y: H / 2, down: false, pressed: false, released: false, tap: false, swipe: null, keys: new Set(), _keysPressed: new Set(), downAt: 0, downX: 0, downY: 0, now: 0,
      keyPressed(name) { return this._keysPressed.has(name); },
      endTick() { this.pressed = false; this.released = false; this.tap = false; this.swipe = null; this._keysPressed.clear(); },
    };
    const env = {
      W, H, g: ctx, input, hooks,
      get points() { return points; },
      get finished() { return finished; },
      score(value) { const next = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)); if (next !== points) { points = next; hooks.onScore?.(points); } },
      addScore(value) { env.score(points + value); },
      over() { if (finished) return; finished = true; hooks.onOver?.(points); },
      rand(a, b) { return b === undefined ? (a === undefined ? random() : random() * a) : a + random() * (b - a); },
      randInt(a, b) { return Math.floor(a + random() * (b - a + 1)); },
      pick(list) { return list[Math.floor(random() * list.length)]; },
      shuffle(list) { const copy = list.slice(); for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; } return copy; },
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      dist: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by),
      hit: (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y,
      inside: (px, py, x, y, w, h) => px >= x && px <= x + w && py >= y && py <= y + h,
      // ---- drawing
      clear() { ctx.clearRect(0, 0, W, H); },
      panel(x, y, w, h, radius = 18, alpha = 0.5, color = "0,0,0") {
        ctx.fillStyle = `rgba(${color},${alpha})`;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h);
        ctx.fill();
      },
      rect(x, y, w, h, fill, radius = 0) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        if (radius && ctx.roundRect) ctx.roundRect(x, y, w, h, radius); else ctx.rect(x, y, w, h);
        ctx.fill();
      },
      circle(x, y, r, fill, stroke, width = 3) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; ctx.stroke(); }
      },
      line(x1, y1, x2, y2, color = "#fff", width = 3) {
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineWidth = width; ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.stroke();
      },
      text(str, x, y, o = {}) {
        const { size = 24, color = "#fff", align = "center", weight = 800, stroke = true, baseline = "middle" } = o;
        ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
        ctx.textAlign = align;
        ctx.textBaseline = baseline;
        if (stroke) { ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.lineJoin = "round"; ctx.strokeText(String(str), x, y); }
        ctx.fillStyle = color;
        ctx.fillText(String(str), x, y);
      },
      emoji(ch, x, y, size = 40, angle = 0, flip = false) {
        ctx.save();
        ctx.translate(x, y);
        if (angle) ctx.rotate(angle);
        if (flip) ctx.scale(-1, 1);
        ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      },
      /* a round button of the play field: returns true on the tick it is tapped */
      button(label, x, y, w, h, o = {}) {
        const { fill = "rgba(255,255,255,0.88)", color = "#111", size = 20, radius = 16 } = o;
        const hot = input.down && env.inside(input.x, input.y, x, y, w, h);
        env.rect(x, y + (hot ? 2 : 0), w, h, fill, radius);
        env.text(label, x + w / 2, y + h / 2 + (hot ? 2 : 0), { size, color, stroke: false });
        return input.tap && env.inside(input.x, input.y, x, y, w, h);
      },
    };
    return env;
  }

  /* ------------------------------------------------------------------------------------------------ the loop around a game */
  /* run(def, canvas, hooks): plays the game on the canvas of the page. hooks: onScore, onOver. Returns {restart, destroy, env}. */
  function run(def, canvas, hooks = {}) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let env = null;
    let game = null;
    let raf = 0;
    let last = 0;
    let acc = 0;
    let dead = false;
    let paused = false;

    function start() {
      env = createEnv(ctx, hooks);
      game = def.create(env);
      acc = 0;
      last = 0;
    }
    function point(event) {
      const box = canvas.getBoundingClientRect();
      return [((event.clientX - box.left) / Math.max(1, box.width)) * W, ((event.clientY - box.top) / Math.max(1, box.height)) * H];
    }
    const down = (event) => {
      if (!env) return;
      const [x, y] = point(event);
      const i = env.input;
      i.x = x; i.y = y; i.downX = x; i.downY = y; i.down = true; i.pressed = true; i.downAt = performance.now();
      try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* a mouse may not have one */ }
      event.preventDefault();
    };
    const move = (event) => {
      if (!env) return;
      const [x, y] = point(event);
      env.input.x = x; env.input.y = y;
    };
    const up = (event) => {
      if (!env || !env.input.down) return;
      const i = env.input;
      const [x, y] = point(event);
      i.x = x; i.y = y; i.down = false; i.released = true;
      const dx = x - i.downX;
      const dy = y - i.downY;
      const span = performance.now() - i.downAt;
      if (Math.hypot(dx, dy) < 14 && span < 450) i.tap = true;
      else if (Math.hypot(dx, dy) >= 28 && span < 600) i.swipe = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
    };
    const keyDown = (event) => {
      if (!env || event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^(Arrow|Page)/.test(event.key) || event.key === " ") event.preventDefault();
      if (!env.input.keys.has(event.key)) env.input._keysPressed.add(event.key);
      env.input.keys.add(event.key);
    };
    const keyUp = (event) => { env?.input.keys.delete(event.key); };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    function frame(now) {
      if (dead) return;
      raf = requestAnimationFrame(frame);
      if (!last) last = now;
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!paused) {
        while (acc >= STEP) {
          if (!env.finished) game.update?.(STEP);
          env.input.endTick();
          acc -= STEP;
        }
      } else acc = 0;
      ctx.clearRect(0, 0, W, H);
      game.draw?.();
    }
    start();
    raf = requestAnimationFrame(frame);
    return {
      env: () => env,
      restart() { start(); },
      pause(on) { paused = !!on; },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        canvas.removeEventListener("pointerdown", down);
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", up);
        window.removeEventListener("keydown", keyDown);
        window.removeEventListener("keyup", keyUp);
        game?.destroy?.();
      },
    };
  }

  /* ------------------------------------------------------------------------------------------------ the same without a browser (tests) */
  const noop = () => {};
  function fakeContext() {
    const calls = { n: 0 };
    const ctx = new Proxy({ canvas: { width: W, height: H } }, {
      get(target, name) {
        if (name === "__calls") return calls;
        if (name === "measureText") return (text) => ({ width: String(text).length * 8 });
        if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop: noop });
        if (name in target) return target[name];
        return (...args) => { calls.n += 1; return args; };
      },
      set(target, name, value) { target[name] = value; return true; },
    });
    return ctx;
  }

  /* headless(id, {frames, seed, script(frame, input, env)}): plays a game for some frames with an invented input; returns {score, over, frames, drawn}. */
  function headless(id, options = {}) {
    const def = byId.get(id);
    if (!def) throw new Error(`no game ${id}`);
    const ctx = fakeContext();
    const events = { over: 0 };
    const scores = [];
    const env = createEnv(ctx, { onOver() { events.over += 1; }, onScore(value) { scores.push(value); } }, options.seed == null ? 7 : options.seed);
    const game = def.create(env);
    const frames = options.frames || 600;
    for (let frame = 0; frame < frames; frame++) {
      options.script?.(frame, env.input, env);
      if (!env.finished) game.update?.(STEP);
      env.input.endTick();
      if (frame % 3 === 0) { ctx.clearRect(0, 0, W, H); game.draw?.(); }
    }
    return { score: env.points, scores, over: events.over, finished: env.finished, drawn: ctx.__calls.n, env, game };
  }

  window.PulseGames = {
    W, H, register, headless, run, createEnv, mulberry32,
    list: () => games.map(({ id, name, emoji, cat, hint, color, external }) => ({ id, name, emoji, cat, hint, color: color || "", external: !!external })),
    get: (id) => byId.get(id) || null,
    count: () => games.length,
  };
})();
