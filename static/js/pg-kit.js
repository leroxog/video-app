/* Pulse games, the kit (pg-kit.js): what every small game of the camera tab is built from. A game is registered with PulseGames.register({id, name, emoji,
   cat, hint, create(env)}); create() returns {update(dt), draw()}. The game gets an `env` with the size of the play field (360 x 640, upright),
   the drawing helpers, the input of the finger or mouse (one pressed/released/tap/swipe per tick, plus the keys), a seeded random number generator
   and score()/over(). The canvas is see-through where the game draws nothing, so the picture of the camera shows behind it (and the recording
   of the camera tab captures both); a game that does not draw a whole scene of its own gets a backdrop in its colour (see `backdrop`), a game with `bubble: true` draws its scene itself. The same code runs without a browser in the tests (PulseGames.headless). No sound: the recording takes the
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

  /* A game that is known (so that `get(id)` finds it and a run can start) but is not in the list of the strip: the games of the community, which the server lists. */
  function define(def) {
    byId.set(def.id, def);
    return def;
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
        if (alpha >= 0.12 && w > 24 && h > 24) { ctx.lineWidth = 1.2; ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.stroke(); }     // a fine light edge, like glass
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
        const dy = hot ? 3 : 0;
        if (!hot) env.rect(x, y + 4, w, h, "rgba(0,0,0,0.3)", radius);                          // the thickness of the button
        env.rect(x, y + dy, w, h, fill, radius);
        env.rect(x + 3, y + dy + 2, Math.max(0, w - 6), Math.max(0, h * 0.42), "rgba(255,255,255,0.22)", Math.max(2, radius - 3));
        env.text(label, x + w / 2, y + h / 2 + dy, { size, color, stroke: false });
        return input.tap && env.inside(input.x, input.y, x, y, w, h);
      },
    };
    return env;
  }

  /* ------------------------------------------------------------------------------------------------ the backdrop */
  /* The games that do not draw a whole scene of their own get a backdrop in the colour of the game: a gradient, two soft lights, floating lights and a dark edge. It is not quite
     opaque, so the camera still shines through a little. */
  function mix(hex, to, amount) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || "");
    const n = m ? parseInt(m[1], 16) : 0x6c7bff;
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return c.map((v, i) => Math.round(v + (to[i] - v) * amount));
  }
  function backdrop(ctx, def, time) {
    const color = def.color || "#6c7bff";
    const top = mix(color, [0, 0, 0], 0.4);
    const bottom = mix(color, [0, 0, 0], 0.78);
    const light = mix(color, [255, 255, 255], 0.35);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, `rgba(${top},0.66)`);
    sky.addColorStop(1, `rgba(${bottom},0.86)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (const [cx, cy, r, a] of [[W * 0.15, H * 0.2, 260, 0.34], [W * 0.9, H * 0.82, 300, 0.26]]) {
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, `rgba(${light},${a})`);
      glow.addColorStop(1, `rgba(${light},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
    let seed = 7;
    for (let i = 0; i < def.id.length; i++) seed = (seed * 31 + def.id.charCodeAt(i)) >>> 0;
    ctx.fillStyle = "#fff";
    for (let k = 0; k < 9; k++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const bx = (seed % 1000) / 1000 * W;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const by = (seed % 1000) / 1000 * H;
      ctx.globalAlpha = 0.05 + (k % 3) * 0.025;
      ctx.beginPath();
      ctx.arc(bx + Math.sin(time * 0.35 + k) * 14, by + Math.cos(time * 0.3 + k * 1.3) * 18, 14 + (k % 4) * 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const edge = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
    edge.addColorStop(0, "rgba(0,0,0,0)");
    edge.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, W, H);
  }
  const wantsBackdrop = (def) => !def.bubble && def.backdrop !== false;

  /* ------------------------------------------------------------------------------------------------ the loop around a game */
  /* run(def, canvas, hooks): plays the game on the canvas of the page. hooks: onScore, onOver. Returns {restart, destroy, env}. */
  function run(def, canvas, hooks = {}, options = {}) {
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
    let armed = !!options.armed;                       // the first picture is drawn and then the game waits: the first touch (or key) starts it, and hooks.onStart() is called
    const arm = () => { if (!armed) return; armed = false; hooks.onStart?.(); };

    function start() {
      game?.destroy?.();                                 // (a game that restarts lets go of what it holds, like a 3D scene)
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
      if (!(game && game.canStart && game.canStart(x, y) === false)) arm();       // the touch that starts the game is also its first input (a game can keep some places for itself, like a switch)
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
      if (/^(Arrow|Page)|^[ \n\rwasdWASD]$|^Enter$/.test(event.key)) arm();
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
      if (!paused && !armed) {
        while (acc >= STEP) {
          if (!env.finished) game.update?.(STEP);
          env.input.endTick();
          acc -= STEP;
        }
      } else {
        acc = 0;
        if (armed && game.idle) { game.idle(env.input); env.input.endTick(); }     // while the game waits for the first touch it may still answer a touch on its own switches
      }
      ctx.clearRect(0, 0, W, H);
      if (wantsBackdrop(def)) backdrop(ctx, def, now / 1000);
      game.draw?.();
    }
    start();
    raf = requestAnimationFrame(frame);
    return {
      env: () => env,
      restart() { start(); },
      pause(on) { paused = !!on; },
      go() { arm(); },                                 // start by hand (the round button of the lens strip)
      isArmed: () => armed,
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
      if (frame % 3 === 0) { ctx.clearRect(0, 0, W, H); if (wantsBackdrop(def)) backdrop(ctx, def, frame / 60); game.draw?.(); }
    }
    return { score: env.points, scores, over: events.over, finished: env.finished, drawn: ctx.__calls.n, env, game };
  }

  window.PulseGames = {
    W, H, register, define, headless, run, createEnv, mulberry32, backdrop,
    list: () => games.map((def, index) => ({ def, index })).sort((a, b) => (b.def.featured ? 1000 - (b.def.order || 0) : 0) - (a.def.featured ? 1000 - (a.def.order || 0) : 0) || a.index - b.index)
      .map(({ def: { id, name, emoji, cat, hint, color, external, featured } }) => ({ id, name, emoji, cat, hint, color: color || "", external: !!external, featured: !!featured })),
    get: (id) => byId.get(id) || null,
    count: () => games.length,
  };
})();
