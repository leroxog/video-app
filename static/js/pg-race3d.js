/* Satürn games: the 3D car race (pg-race3d.js). A real 3D road made with three.js (the same files as the 3D lenses, loaded when the game is opened first): a sports car with paint, glass and
   reflections drives on a motorway behind other cars, vans and lorries, the camera floats behind it. The road fills only the lower part of the picture and fades out at the horizon, so
   the player (the camera of the phone) is seen above it, with no bubble. Steer with the finger (the car drives to where the finger is) or the arrow keys; coins give points, the blue
   lightning gives nitro. The car has a spring-damper suspension (it rolls in the curves of the steering, dips when it brakes, rises when it speeds up) and crashes with a tumble.
   The rules (speed, traffic, collisions, score) are plain numbers and run without a browser in the tests; the drawing waits until three.js is there. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const BASE = "/static/js/vendor/three";
  const LANES = [-2.8, 0, 2.8];
  const ROAD = 4.4;                                            // half of the road in metres (a narrow road: a phone is a tall, thin picture)
  const KINDS = [
    { kind: "sedan", hl: 2.2, hw: 0.95, colors: [0x2b6fd6, 0xe8e8ec, 0x1f9d73, 0x7b4cc4, 0xd98a1f, 0x2d3036], weight: 5 },
    { kind: "sport", hl: 2.2, hw: 0.95, colors: [0xe23b3b, 0xf0c419, 0x25b5c9, 0xe0489b], weight: 3 },
    { kind: "taxi", hl: 2.2, hw: 0.95, colors: [0xf5c518], weight: 1 },
    { kind: "van", hl: 2.4, hw: 1.0, colors: [0xf2f2f2, 0x3f7fd6, 0xc9482f], weight: 2 },
    { kind: "truck", hl: 5.2, hw: 1.15, colors: [0xd9531e, 0x2d6cc0, 0x3a9b5a], weight: 1.6 },
  ];

  // ------------------------------------------------------------------------------------------------------------------ three.js (loaded once, and only in a browser)
  let libs = null;
  function load3d() {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
    if (!libs) {
      libs = (async () => {
        const [T, room] = await Promise.all([import(`${BASE}/three.module.min.js`), import(`${BASE}/RoomEnvironment.js`)]);
        T.ColorManagement.enabled = false;
        return { T, RoomEnvironment: room.RoomEnvironment };
      })().catch(() => { libs = null; return null; });
    }
    return libs;
  }

  // ------------------------------------------------------------------------------------------------------------------ pictures (textures) painted with the canvas
  function paintTexture(T, w, h, paint, repeatX = 1, repeatY = 1) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 4;
    return t;
  }
  function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  function asphalt(T) {                                         // as wide as the road, 24 m long
    return paintTexture(T, 256, 512, (g, w, h) => {
      const rnd = seeded(5);
      g.fillStyle = "#383b42"; g.fillRect(0, 0, w, h);
      for (let n = 0; n < 4200; n += 1) { const l = rnd(); g.fillStyle = l > 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.05})` : `rgba(0,0,0,${0.06 + rnd() * 0.1})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
      for (const x of LANES) { const cx = w * (0.5 + x / (ROAD * 2)); const k = g.createLinearGradient(cx - 22, 0, cx + 22, 0); k.addColorStop(0, "rgba(0,0,0,0)"); k.addColorStop(0.5, "rgba(0,0,0,0.16)"); k.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = k; g.fillRect(cx - 22, 0, 44, h); }
      g.fillStyle = "#f4f4f0";
      for (const x of [-ROAD + 0.2, ROAD - 0.2]) g.fillRect(w * (0.5 + x / (ROAD * 2)) - 4, 0, 8, h);            // the edge lines
      for (const x of [-1.4, 1.4]) for (let k = 0; k < 2; k += 1) g.fillRect(w * (0.5 + x / (ROAD * 2)) - 3.5, k * h / 2 + 8, 7, h / 2 * 0.28);     // dashes
    });
  }
  function grass(T) {
    return paintTexture(T, 256, 256, (g, w, h) => {
      const rnd = seeded(11);
      g.fillStyle = "#3d7a3c"; g.fillRect(0, 0, w, h);
      for (let n = 0; n < 3000; n += 1) { g.fillStyle = rnd() > 0.5 ? `rgba(120,190,90,${0.08 + rnd() * 0.12})` : `rgba(20,60,30,${0.1 + rnd() * 0.15})`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 2 + rnd() * 4); }
    }, 4, 20);
  }
  function curb(T) {
    return paintTexture(T, 16, 64, (g, w, h) => { g.fillStyle = "#d9d9d9"; g.fillRect(0, 0, w, h); g.fillStyle = "#d3342b"; g.fillRect(0, 0, w, h / 2); });
  }
  function rail(T) {
    return paintTexture(T, 256, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const k = g.createLinearGradient(0, 8, 0, 36); k.addColorStop(0, "#e9edf2"); k.addColorStop(0.5, "#a9b2bd"); k.addColorStop(1, "#6f7782");
      g.fillStyle = k; g.fillRect(0, 8, w, 28);
      g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(0, 36, w, 3);
      g.fillStyle = "#59606b"; for (let x = 24; x < w; x += 128) g.fillRect(x, 36, 10, 28);
    }, 40, 1);
  }
  function blob(T) {
    return paintTexture(T, 64, 64, (g) => { const k = g.createRadialGradient(32, 32, 2, 32, 32, 31); k.addColorStop(0, "rgba(0,0,0,0.62)"); k.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = k; g.fillRect(0, 0, 64, 64); });
  }

  // ------------------------------------------------------------------------------------------------------------------ cars made of extruded shapes
  /* a closed outline with rounded corners (points [u, y]) as a Shape */
  function outline(T, points, radius) {
    const s = new T.Shape();
    const n = points.length;
    for (let i = 0; i < n; i += 1) {
      const p = points[i], a = points[(i + n - 1) % n], b = points[(i + 1) % n];
      const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const ra = Math.min(radius, da * 0.45) / da, rb = Math.min(radius, db * 0.45) / db;
      const p1 = [p[0] + (a[0] - p[0]) * ra, p[1] + (a[1] - p[1]) * ra], p2 = [p[0] + (b[0] - p[0]) * rb, p[1] + (b[1] - p[1]) * rb];
      if (i) s.lineTo(p1[0], p1[1]); else s.moveTo(p1[0], p1[1]);
      s.quadraticCurveTo(p[0], p[1], p2[0], p2[1]);
    }
    s.closePath();
    return s;
  }
  /* the shape is in (length, height); it is pulled out across the width and turned so that the front looks to -z */
  function pulled(T, shape, width, bevel = 0.1) {
    const g = new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10 });
    g.translate(0, 0, -width / 2);
    g.rotateY(Math.PI / 2);
    return g;
  }

  const shapes = new Map();
  function model(T, kind) {
    if (shapes.has(kind)) return shapes.get(kind);
    let m;
    if (kind === "truck") {
      m = {
        cab: pulled(T, outline(T, [[-1.1, 0.5], [1.2, 0.5], [1.2, 1.7], [0.9, 2.5], [-1.1, 2.6]], 0.2), 2.3, 0.08),
        box: pulled(T, outline(T, [[-3.4, 0.7], [3.4, 0.7], [3.4, 3.1], [-3.4, 3.1]], 0.12), 2.45, 0.06),
      };
    } else if (kind === "van") {
      m = {
        body: pulled(T, outline(T, [[-2.3, 0.42], [2.2, 0.42], [2.35, 0.9], [2.0, 1.45], [1.5, 2.0], [-2.3, 2.05]], 0.28), 1.9, 0.1),
        glass: pulled(T, outline(T, [[0.95, 1.45], [1.45, 1.95], [1.5, 2.0], [0.9, 1.96]], 0.05), 1.74, 0.02),
      };
    } else {
      const sport = kind === "sport";
      m = {
        body: pulled(T, outline(T, sport ? [[-2.2, 0.4], [2.15, 0.4], [2.3, 0.62], [1.5, 0.86], [0.7, 0.98], [-1.4, 0.98], [-2.15, 0.9], [-2.3, 0.66]] : [[-2.2, 0.4], [2.2, 0.4], [2.32, 0.7], [1.7, 0.93], [0.9, 1.02], [-1.3, 1.02], [-2.1, 0.96], [-2.3, 0.7]], 0.3), 1.88, 0.1),
        glass: pulled(T, outline(T, sport ? [[-1.2, 0.94], [-0.7, 1.36], [0.3, 1.38], [0.95, 0.94]] : [[-1.28, 0.98], [-0.82, 1.5], [0.5, 1.5], [1.05, 0.98]], 0.2), 1.66, 0.04),
        roof: pulled(T, outline(T, sport ? [[-0.62, 1.34], [0.34, 1.36], [0.3, 1.42], [-0.6, 1.4]] : [[-0.75, 1.46], [0.5, 1.46], [0.46, 1.54], [-0.72, 1.54]], 0.03), 1.5, 0.02),
      };
    }
    shapes.set(kind, m);
    return m;
  }

  function makeKit(T, env) {
    const paints = new Map();
    const paint = (color) => { if (!paints.has(color)) paints.set(color, new T.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.9 })); return paints.get(color); };
    return {
      T, paint,
      glass: new T.MeshPhysicalMaterial({ color: 0x0f1620, roughness: 0.06, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.2 }),
      tire: new T.MeshStandardMaterial({ color: 0x15161a, roughness: 0.85 }),
      rim: new T.MeshStandardMaterial({ color: 0xc8ced6, roughness: 0.25, metalness: 1 }),
      dark: new T.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.6, metalness: 0.2 }),
      white: new T.MeshStandardMaterial({ color: 0xf0f0f2, roughness: 0.5 }),
      tail: new T.MeshStandardMaterial({ color: 0x7a0a0a, emissive: 0xff1a1a, emissiveIntensity: 0.55, roughness: 0.3 }),
      head: new T.MeshStandardMaterial({ color: 0xfff3cc, emissive: 0xfff3cc, emissiveIntensity: 0.7, roughness: 0.2 }),
      shadow: new T.MeshBasicMaterial({ map: blob(T), transparent: true, depthWrite: false }),
      tireGeo: new T.CylinderGeometry(0.36, 0.36, 0.28, 24).rotateZ(Math.PI / 2),
      rimGeo: new T.CylinderGeometry(0.22, 0.22, 0.3, 18).rotateZ(Math.PI / 2),
      env,
    };
  }

  /* a car: {group, wheels, tails, (body)} with its front to -z and the wheels on the ground (y = 0) */
  function buildCar(k, kind, color) {
    const { T } = k;
    const g = new T.Group();
    const m = model(T, kind);
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const o = new T.Mesh(geo, mat); o.position.set(x, y, z); g.add(o); return o; };
    const wheels = [];
    let hl = 2.2, hw = 0.92, track = 0.84, axles = [-1.35, 1.35], tailZ = 2.3, tailY = 0.78, tailW = 0.62;
    if (kind === "truck") {
      hl = 5.2; hw = 1.12; track = 1.0; axles = [-4.2, -3.1, 2.2, 3.4]; tailZ = 5.1; tailY = 0.95; tailW = 0.8;
      mesh(m.cab, k.paint(color), 0, 0, -3.9);
      mesh(m.box, k.white, 0, 0, 1.2);
      mesh(new T.BoxGeometry(2.0, 0.28, 8.6), k.dark, 0, 0.62, 0.45);
      mesh(new T.BoxGeometry(1.7, 0.7, 0.14), k.glass, 0, 1.9, -5.13);
      mesh(new T.BoxGeometry(2.46, 0.2, 7), k.paint(color), 0, 2.2, 1.2).scale.set(1, 0.4, 1);
    } else if (kind === "van") {
      hl = 2.4; hw = 0.98; track = 0.88;
      mesh(m.body, k.paint(color));
      mesh(m.glass, k.glass, 0, 0, 0);
      mesh(new T.BoxGeometry(1.7, 0.5, 0.1), k.glass, 0, 1.55, -2.35).rotation.x = -0.45;
      mesh(new T.BoxGeometry(1.92, 0.14, 0.18), k.dark, 0, 0.62, 2.42);
    } else {
      mesh(m.body, k.paint(color));
      mesh(m.glass, k.glass);
      mesh(m.roof, k.paint(color));
      mesh(new T.BoxGeometry(1.5, 0.1, 0.16), k.dark, 0, 0.52, 2.32);
      mesh(new T.BoxGeometry(0.36, 0.16, 0.06), k.head, -0.62, 0.78, -2.32);
      mesh(new T.BoxGeometry(0.36, 0.16, 0.06), k.head, 0.62, 0.78, -2.32);
      if (kind === "sport") {
        const wing = new T.Group();
        wing.add(mesh(new T.BoxGeometry(1.7, 0.06, 0.36), k.dark, 0, 0, 0), mesh(new T.BoxGeometry(0.06, 0.26, 0.2), k.dark, -0.55, -0.14, 0), mesh(new T.BoxGeometry(0.06, 0.26, 0.2), k.dark, 0.55, -0.14, 0));
        for (const c of wing.children) { g.remove(c); wing.add(c); }
        wing.position.set(0, 1.12, 1.95);
        g.add(wing);
      }
      if (kind === "taxi") { mesh(new T.BoxGeometry(0.62, 0.2, 0.26), k.white, 0, 1.64, 0.1); }
    }
    for (const az of axles) for (const side of [-1, 1]) {
      const w = new T.Group();
      w.add(new T.Mesh(k.tireGeo, k.tire), new T.Mesh(k.rimGeo, k.rim));
      w.position.set(side * track, 0.36, az);
      g.add(w);
      wheels.push(w);
    }
    const tails = [-1, 1].map((side) => mesh(new T.BoxGeometry(tailW, 0.16, 0.06), k.tail.clone(), side * (hw - tailW / 2 - 0.1), tailY, tailZ));
    const shadow = new T.Mesh(new T.PlaneGeometry(hw * 2 + 0.9, hl * 2 + 0.9), k.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    const holder = new T.Group();
    const body = new T.Group();
    body.add(g);
    holder.add(shadow, body);
    return { group: holder, body, wheels, tails, shadow, hl, hw };
  }

  // ------------------------------------------------------------------------------------------------------------------ scenery
  function makeTree(k, seed) {
    const { T } = k;
    const rnd = seeded(seed);
    const g = new T.Group();
    const h = 3 + rnd() * 3;
    g.add(new T.Mesh(new T.CylinderGeometry(0.16, 0.24, h * 0.45, 7), new T.MeshStandardMaterial({ color: 0x5a3e28, roughness: 1 })).translateY(h * 0.22));
    const leaf = new T.MeshStandardMaterial({ color: new T.Color().setHSL(0.3 + rnd() * 0.06, 0.5, 0.28 + rnd() * 0.08), roughness: 0.9, flatShading: true });
    for (let i = 0; i < 3; i += 1) g.add(new T.Mesh(new T.ConeGeometry(1.5 - i * 0.32, h * 0.5, 8), leaf).translateY(h * 0.45 + i * h * 0.2));
    return g;
  }
  function makePole(k) {
    const { T } = k;
    const g = new T.Group();
    const steel = new T.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.8 });
    g.add(new T.Mesh(new T.CylinderGeometry(0.07, 0.1, 7, 8), steel).translateY(3.5));
    g.add(new T.Mesh(new T.BoxGeometry(2.4, 0.08, 0.1), steel).translateY(7).translateX(-1.1));
    g.add(new T.Mesh(new T.BoxGeometry(0.7, 0.12, 0.3), new T.MeshStandardMaterial({ color: 0xfff1c9, emissive: 0xfff1c9, emissiveIntensity: 0.8 })).translateY(6.92).translateX(-2.2));
    return g;
  }
  function makeSign(k) {
    const { T } = k;
    const g = new T.Group();
    const steel = new T.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.4, metalness: 0.8 });
    g.add(new T.Mesh(new T.CylinderGeometry(0.07, 0.07, 4.2, 8), steel).translateY(2.1));
    const face = paintTexture(T, 128, 96, (c, w, h) => { c.fillStyle = "#1c62c4"; c.fillRect(0, 0, w, h); c.strokeStyle = "#fff"; c.lineWidth = 5; c.strokeRect(5, 5, w - 10, h - 10); c.fillStyle = "#fff"; c.beginPath(); c.moveTo(34, 48); c.lineTo(64, 20); c.lineTo(64, 38); c.lineTo(94, 38); c.lineTo(94, 58); c.lineTo(64, 58); c.lineTo(64, 76); c.closePath(); c.fill(); });
    g.add(new T.Mesh(new T.BoxGeometry(2.2, 1.6, 0.08), new T.MeshStandardMaterial({ map: face, roughness: 0.5 })).translateY(4.4));
    return g;
  }

  // ------------------------------------------------------------------------------------------------------------------ the game
  R({ id: "car-race", name: "Auto-Rennen", emoji: "🏎️", cat: "Rennen", featured: true, bubble: false, backdrop: false, order: 1, color: "#d63a2f", hint: "Zieh den Finger nach links oder rechts · sammle Münzen und Nitro", create(e) {
    const g = e.g;
    const state = { speed: 26, dist: 0, bonus: 0, coins: 0, nitro: 0, t: 0, crash: 0, shake: 0, banner: null, hint: 3.2, bestPass: 0 };
    const p = { x: 0, vx: 0, target: 0, yaw: 0, roll: 0, bob: 0, bobV: 0, pitch: 0, pitchV: 0, speedPrev: 26 };
    const traffic = [];
    const pickups = [];
    const pops = [];
    let spawn = 0.6, coinTimer = 3, nitroTimer = 11;
    let three = null;                                              // {T, renderer, scene, camera, car, ...} when the pictures are ready
    let loading = false;
    let failed = false;

    // ---- the rules (plain numbers)
    function laneFree(x, z0) { return !traffic.some((c) => Math.abs(c.x - x) < 2.5 && Math.abs(c.z - z0) < 26); }
    function pickKind() { let total = 0; for (const k of KINDS) total += k.weight; let r = e.rand() * total; for (const k of KINDS) { r -= k.weight; if (r <= 0) return k; } return KINDS[0]; }
    function addCar(z, laneIndex) {
      const info = pickKind();
      const lane = laneIndex == null ? e.randInt(0, 2) : laneIndex;
      const car = { x: LANES[lane], lane, z, info, color: e.pick(info.colors), speed: state.speed * e.rand(0.32, 0.62), obj: null, change: e.rand(2, 7), passed: false, braking: 0, blink: 0, tx: LANES[lane], vx: 0 };
      traffic.push(car);
      if (three) attach(car);
      return car;
    }
    function addPickup(kind, x, z) { const item = { kind, x, z, spin: e.rand(TAU), obj: null }; pickups.push(item); if (three) attachPickup(item); }
    for (const [z, lane] of [[-42, 0], [-70, 2], [-100, 0], [-132, 1], [-160, 2]]) addCar(z, lane);
    for (let k = 0; k < 5; k += 1) addPickup("coin", 0, -46 - k * 5);

    function say(text, color = "#fff") { pops.push({ text, age: 0, color }); }
    function crashNow() {
      if (state.crash) return;
      state.crash = 0.001;
      state.shake = 0.8;
      p.crashV = { vy: 6.5, vx: p.vx * 0.5 + (p.x > 0 ? -1.5 : 1.5), spin: (p.vx >= 0 ? 1 : -1) * 6.2, roll: (p.x > 0 ? -1 : 1) * 4.6, y: 0, rx: 0 };
      navigator.vibrate?.(60);
    }
    function step(dt) {
      const i = e.input;
      state.t += dt;
      state.hint = Math.max(0, state.hint - dt);
      state.shake = Math.max(0, state.shake - dt);
      for (const o of pops) o.age += dt;
      while (pops.length && pops[0].age > 1.1) pops.shift();
      if (state.crash) {
        state.crash += dt;
        const c = p.crashV;
        c.vy -= 22 * dt; c.y += c.vy * dt; c.rx += 2.5 * dt;
        if (c.y < 0) { c.y = 0; c.vy = Math.abs(c.vy) * 0.35; c.spin *= 0.7; }
        p.x += c.vx * dt; p.yaw += c.spin * dt; p.roll += c.roll * dt; state.speed = Math.max(0, state.speed - 38 * dt);
        for (const car of traffic) car.z += (state.speed - car.speed) * dt;
        state.dist += state.speed * dt;
        if (state.crash > 1.5) e.over();
        return;
      }
      // ---- steering: the car drives to the place of the finger (or the keys), with the weight of a car
      const left = i.keys.has("ArrowLeft") || i.keys.has("a") || i.keys.has("A"), right = i.keys.has("ArrowRight") || i.keys.has("d") || i.keys.has("D");
      if (i.down) p.target = clamp((i.x / W - 0.5) * 8.6, -3.3, 3.3);
      else if (left || right) p.target = clamp(p.target + (right ? 1 : 0) * 7 * dt - (left ? 1 : 0) * 7 * dt, -3.3, 3.3);
      const ax = (p.target - p.x) * 36 - p.vx * 8.5;
      p.vx += ax * dt;
      p.x += p.vx * dt;
      if (Math.abs(p.x) > 3.45) { p.x = Math.sign(p.x) * 3.45; if (Math.abs(p.vx) > 2) { state.speed *= 0.94; state.shake = 0.25; } p.vx = -p.vx * 0.3; }
      p.yaw = lerp(p.yaw, clamp(-p.vx * 0.05, -0.28, 0.28), Math.min(1, dt * 12));
      // ---- speed: it grows by itself, nitro adds a lot
      state.nitro = Math.max(0, state.nitro - dt);
      const cruise = Math.min(60, 26 + state.dist / 90);
      const want = state.nitro > 0 ? cruise * 1.38 : cruise;
      state.speed += (want - state.speed) * Math.min(1, dt * (state.nitro > 0 ? 1.6 : 0.5));
      state.dist += state.speed * dt;
      // ---- the springs of the car: pitch follows the acceleration, roll follows the steering, the body bobs on the bumps
      const accel = (state.speed - p.speedPrev) / Math.max(dt, 1e-4);
      p.speedPrev = state.speed;
      const wantPitch = clamp(-accel * 0.012, -0.05, 0.05), wantRoll = clamp(-ax * 0.0035 - p.vx * 0.012, -0.12, 0.12);
      p.pitchV += ((wantPitch - p.pitch) * 90 - p.pitchV * 11) * dt; p.pitch += p.pitchV * dt;
      p.roll += (wantRoll - p.roll) * Math.min(1, dt * 8);
      p.bobV += ((Math.sin(state.t * 31) * 0.012 * state.speed / 40 - p.bob) * 160 - p.bobV * 14) * dt; p.bob += p.bobV * dt;
      // ---- traffic
      for (const c of traffic) {
        c.z += (state.speed - c.speed) * dt;
        c.change -= dt;
        if (c.change < 0 && c.z < -30 && c.z > -150) {                                        // some cars change the lane with a blinker
          const to = clamp(c.lane + (e.rand() < 0.5 ? -1 : 1), 0, 2);
          if (to !== c.lane && laneFree(LANES[to], c.z)) { c.blink = 0.9; c.lane = to; c.tx = LANES[to]; }
          c.change = e.rand(3, 8);
        }
        if (c.blink > 0) c.blink -= dt;
        c.vx += ((c.tx - c.x) * 12 - c.vx * 5) * dt; c.x += c.vx * dt;
        if (!c.passed && c.z > 3) {
          c.passed = true;
          if (Math.abs(c.x - p.x) < 2.7) { state.bonus += 5; say("KNAPP! +5", "#9fe8ff"); }
        }
        const dx = Math.abs(c.x - p.x), dz = Math.abs(c.z);
        if (dx < 0.92 + c.info.hw * 0.94 && dz < 2.1 + c.info.hl - 0.35) crashNow();
      }
      for (let k = traffic.length - 1; k >= 0; k -= 1) if (traffic[k].z > 14) { detach(traffic[k]); traffic.splice(k, 1); }
      spawn -= dt;
      if (spawn <= 0) {
        spawn = e.rand(0.55, 1.2) * (1.25 - Math.min(0.6, state.dist / 4000));
        const lane = e.randInt(0, 2);
        if (laneFree(LANES[lane], -170) && traffic.length < 14) addCar(-170, lane);
      }
      // ---- coins and nitro
      coinTimer -= dt; nitroTimer -= dt;
      if (coinTimer <= 0) { coinTimer = e.rand(4, 7); const x = LANES[e.randInt(0, 2)]; for (let k = 0; k < 6; k += 1) addPickup("coin", x, -160 - k * 5); }
      if (nitroTimer <= 0) { nitroTimer = e.rand(14, 22); addPickup("nitro", LANES[e.randInt(0, 2)], -160); }
      for (const it of pickups) { it.z += state.speed * dt; it.spin += dt * 5; }
      for (let k = pickups.length - 1; k >= 0; k -= 1) {
        const it = pickups[k];
        if (Math.abs(it.x - p.x) < 1.3 && Math.abs(it.z) < 2.2) {
          if (it.kind === "coin") { state.coins += 1; state.bonus += 10; } else { state.nitro = 3.6; say("NITRO!", "#7fd0ff"); navigator.vibrate?.(30); }
          detachPickup(it); pickups.splice(k, 1);
        } else if (it.z > 10) { detachPickup(it); pickups.splice(k, 1); }
      }
      e.score(Math.floor(state.dist / 8) + state.bonus);
    }

    // ---- the pictures (made when three.js is there)
    function attach(c) { if (!three) return; c.obj = buildCar(three.kit, c.info.kind, c.color); three.scene.add(c.obj.group); }
    function detach(c) { if (c.obj) { three.scene.remove(c.obj.group); c.obj = null; } }
    function attachPickup(it) {
      if (!three) return;
      const { T } = three;
      it.obj = it.kind === "coin" ? new T.Mesh(three.coinGeo, three.coinMat) : new T.Mesh(three.nitroGeo, three.nitroMat);
      three.scene.add(it.obj);
    }
    function detachPickup(it) { if (it.obj) { three.scene.remove(it.obj); it.obj = null; } }

    function build({ T, RoomEnvironment }) {
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const canvas = document.createElement("canvas");
      const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(dpr);
      renderer.setSize(W, H, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.LinearSRGBColorSpace;
      const pmrem = new T.PMREMGenerator(renderer);
      const envMap = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
      pmrem.dispose();
      const scene = new T.Scene();
      scene.environment = envMap;
      scene.fog = new T.Fog(0xa9c3d8, 70, 210);
      scene.add(new T.HemisphereLight(0xd6e8ff, 0x4a5a3c, 0.85));
      const sun = new T.DirectionalLight(0xfff0d6, 1.5);
      sun.position.set(-25, 40, 30);
      scene.add(sun);
      const camera = new T.PerspectiveCamera(50, W / H, 0.1, 500);
      const kit = makeKit(T, envMap);
      // the ground: road, curbs, rails, grass (they scroll by moving their pictures)
      const roadTex = asphalt(T), grassTex = grass(T), curbTex = curb(T), railTex = rail(T);
      const length = 480;
      roadTex.repeat.set(1, length / 24);
      curbTex.repeat.set(1, length / 6);
      railTex.repeat.set(length / 10, 1);
      const flat = (w, l, tex, x, y) => { const m = new T.Mesh(new T.PlaneGeometry(w, l), new T.MeshStandardMaterial({ map: tex, roughness: 0.92 })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, -l / 2 + 40); scene.add(m); return m; };
      flat(ROAD * 2, length, roadTex, 0, 0);
      flat(0.7, length, curbTex, -ROAD - 0.35, 0.01);
      flat(0.7, length, curbTex, ROAD + 0.35, 0.01);
      grassTex.repeat.set(8, length / 12);
      const gl = flat(60, length, grassTex, -36, -0.02), gr = flat(60, length, grassTex, 36, -0.02);
      for (const side of [-1, 1]) {
        const r = new T.Mesh(new T.PlaneGeometry(length, 0.9), new T.MeshStandardMaterial({ map: railTex, transparent: true, alphaTest: 0.4, roughness: 0.4, metalness: 0.5, side: T.DoubleSide }));
        r.rotation.y = Math.PI / 2; r.position.set(side * (ROAD + 1.05), 0.55, -length / 2 + 40);
        scene.add(r);
      }
      // the things beside the road: trees, lamp poles, signs (they come on the road ahead and go behind the camera)
      const side = [];
      const spacing = 16, count = 26;
      for (let n = 0; n < count; n += 1) {
        for (const sx of [-1, 1]) {
          const rnd = seeded(n * 7 + (sx > 0 ? 3 : 0));
          const kind = n % 5 === 2 ? "pole" : n % 11 === 4 ? "sign" : "tree";
          const obj = kind === "pole" ? makePole(kit) : kind === "sign" ? makeSign(kit) : makeTree(kit, n * 13 + (sx > 0 ? 1 : 0));
          const off = kind === "tree" ? 7 + rnd() * 14 : ROAD + 1.9;
          if (kind === "pole" && sx > 0) obj.rotation.y = Math.PI;
          obj.userData = { off: sx * off, z: -n * spacing + 20 + rnd() * 6 };
          obj.position.set(obj.userData.off, 0, obj.userData.z);
          scene.add(obj);
          side.push(obj);
        }
      }
      const player = buildCar(kit, "sport", 0xd8281f);
      scene.add(player.group);
      const flames = [-0.5, 0.5].map((x) => { const f = new T.Mesh(new T.ConeGeometry(0.2, 1.6, 10), new T.MeshBasicMaterial({ color: 0x66c8ff, transparent: true, opacity: 0.85 })); f.rotation.x = Math.PI / 2; f.position.set(x, 0.55, 3.0); f.visible = false; player.body.add(f); return f; });
      const coinGeo = new T.CylinderGeometry(0.5, 0.5, 0.12, 24).rotateX(Math.PI / 2);
      const coinMat = new T.MeshStandardMaterial({ color: 0xffc820, metalness: 0.9, roughness: 0.25, emissive: 0xffa800, emissiveIntensity: 0.55 });
      const nitroGeo = new T.CapsuleGeometry(0.34, 0.9, 6, 14);
      const nitroMat = new T.MeshStandardMaterial({ color: 0x3aa8ff, emissive: 0x2a8cff, emissiveIntensity: 1.1, roughness: 0.3 });
      // the mask of the horizon: what the 3D picture shows is faded out at the far end of the road, the camera picture stays above
      const mask = document.createElement("canvas");
      mask.width = Math.round(W * dpr); mask.height = Math.round(H * dpr);
      three = { T, renderer, scene, camera, kit, roadTex, curbTex, railTex, grassTex, side, player, flames, coinGeo, coinMat, nitroGeo, nitroMat, canvas, mask, mctx: mask.getContext("2d"), dpr, horizon: 0 };
      camera.position.set(0, 4.6, 13);
      camera.lookAt(0, 3.3, -14);
      camera.updateMatrixWorld();
      const far = new T.Vector3(0, 0, -300).project(camera);
      three.horizon = (1 - far.y) / 2 * H;
      for (const c of traffic) attach(c);
      for (const it of pickups) attachPickup(it);
    }

    function render() {
      const t3 = three;
      const { T, camera, player } = t3;
      // scroll the road and move the things
      const adv = state.speed * (1 / 60);
      t3.roadTex.offset.y += adv / 24;
      t3.curbTex.offset.y += adv / 6;
      t3.railTex.offset.x -= adv / 10;
      t3.grassTex.offset.y += adv / 12;
      for (const o of t3.side) { o.userData.z += adv; if (o.userData.z > 14) o.userData.z -= 26 * 16; o.position.z = o.userData.z; }
      // the player's car
      const c = p.crashV;
      player.group.position.set(p.x, c ? c.y : 0, 0);
      player.body.position.y = p.bob;
      player.body.rotation.set(p.pitch + (state.crash ? p.crashV.rx : 0), p.yaw, p.roll);
      const spin = state.speed / 0.36 * (1 / 60);
      for (const w of player.wheels) w.rotation.x -= spin;
      for (const t of player.tails) t.material.emissiveIntensity = state.speed < p.speedPrev - 0.01 ? 1.6 : 0.55;
      for (const f of t3.flames) { f.visible = state.nitro > 0 && !state.crash; f.scale.set(1, 0.7 + Math.random() * 0.7, 1); }
      for (const car of traffic) {
        if (!car.obj) continue;
        car.obj.group.position.set(car.x, 0, car.z);
        car.obj.body.rotation.y = clamp(-car.vx * 0.05, -0.2, 0.2);
        for (const w of car.obj.wheels) w.rotation.x -= car.speed / 0.36 * (1 / 60);
        const lit = car.blink > 0 && Math.floor(state.t * 6) % 2 === 0;
        for (const t of car.obj.tails) t.material.emissiveIntensity = lit ? 2 : 0.55;
      }
      for (const it of pickups) if (it.obj) { it.obj.position.set(it.x, it.kind === "coin" ? 1.0 : 1.2, it.z); it.obj.rotation.y = it.spin; if (it.kind === "nitro") it.obj.rotation.z = Math.PI / 2; }
      // the camera floats behind and above the car, looks a bit ahead, shakes and widens with speed
      const ratio = clamp((state.speed - 24) / 52, 0, 1.4);
      camera.fov = 54 + ratio * 7 + (state.nitro > 0 ? 6 : 0);
      camera.updateProjectionMatrix();
      const sh = state.shake * 0.35 + (state.nitro > 0 ? 0.04 : 0);
      camera.position.set(p.x * 0.6 + (Math.random() - 0.5) * sh, 4.6 + p.bob + p.pitch * 4 + (Math.random() - 0.5) * sh, 13 + ratio * 0.8);
      camera.lookAt(p.x * 0.5, 3.3, -14);
      t3.renderer.render(t3.scene, camera);
      // the road fades into the picture of the camera at the horizon
      const m = t3.mctx, mw = t3.mask.width, mh = t3.mask.height;
      m.globalCompositeOperation = "copy";
      m.drawImage(t3.canvas, 0, 0, mw, mh);
      m.globalCompositeOperation = "destination-in";
      const hz = t3.horizon * t3.dpr;
      const k = m.createLinearGradient(0, hz - 6 * t3.dpr, 0, hz + 70 * t3.dpr);
      k.addColorStop(0, "rgba(0,0,0,0)");
      k.addColorStop(1, "rgba(0,0,0,1)");
      m.fillStyle = k;
      m.fillRect(0, 0, mw, mh);
      g.drawImage(t3.mask, 0, 0, W, H);
    }

    function hud() {
      const kmh = Math.round(state.speed * 3.6);
      e.panel(10, 70, 116, 46, 16, 0.5);
      e.text(String(kmh), 52, 93, { size: 26, stroke: false });
      e.text("km/h", 98, 96, { size: 12, weight: 700, color: "#d8dbe2", stroke: false });
      e.panel(W - 114, 70, 104, 46, 16, 0.5);
      g.fillStyle = "#ffcc1f"; g.beginPath(); g.arc(W - 92, 93, 9, 0, TAU); g.fill();
      g.fillStyle = "#ffe98a"; g.beginPath(); g.arc(W - 93, 92, 5, 0, TAU); g.fill();
      e.text(String(state.coins), W - 58, 93, { size: 24, stroke: false });
      if (state.nitro > 0) { e.panel(W / 2 - 60, 122, 120, 12, 6, 0.45); e.rect(W / 2 - 58, 124, 116 * Math.min(1, state.nitro / 3.6), 8, "#3aa8ff", 4); }
      pops.forEach((o, n) => { g.globalAlpha = Math.max(0, 1 - o.age / 1.1); e.text(o.text, W / 2, 168 + n * 26 - o.age * 26, { size: 22, color: o.color }); });
      g.globalAlpha = 1;
      if (state.hint > 0 && !state.crash) { g.globalAlpha = Math.min(1, state.hint); e.text("◀  Finger nach links / rechts  ▶", W / 2, 420, { size: 15 }); g.globalAlpha = 1; }
    }

    const game = {
      update(dt) {
        if (!three && typeof document !== "undefined" && typeof document.createElement === "function") return;      // wait for the pictures (the first touch has already started the game)
        step(dt);
      },
      draw() {
        if (!three && !loading && !failed) {
          const wait = load3d();
          if (wait) { loading = true; wait.then((l) => { loading = false; if (l && !game.dead) { try { build(l); } catch (error) { failed = true; } } else if (!l) failed = true; }); }
        }
        if (three) render();
        else if (typeof document !== "undefined" && typeof document.createElement === "function") e.text(failed ? "3D geht auf diesem Gerät nicht" : "3D wird geladen …", W / 2, 400, { size: 18 });
        hud();
      },
      destroy() {
        game.dead = true;
        if (three) { three.renderer.dispose(); const lose = three.renderer.getContext().getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); three = null; }
      },
    };
    return game;
  } });
})();
