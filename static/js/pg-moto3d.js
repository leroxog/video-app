/* Satürn games: the 3D motorbike (pg-moto3d.js). A sports bike with a rider rides along a track of hills, bumps and ramps, seen from the side and a bit from the front (three.js, loaded when the game
   is opened first, like the car race). Only the track and the bike are drawn: the player (the camera of the phone) is the background. Gas on the right, brake on the left, and in the air the
   same buttons turn the bike (gas: nose down, brake: nose up). The bike is a real rigid body in the plane: its mass and its turning weight, two tyres that are springs with damping and that
   push on the ground along its normal, an engine that pushes at the back tyre (so the front goes up when it speeds up on a slope: wheelies come by themselves), brakes that grip as much as the
   tyre can, air drag, and gravity. It crashes when the head or the tail touches the ground. The rules are plain numbers and run without a browser in the tests. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const BASE = "/static/js/vendor/three";

  // ------------------------------------------------------------------------------------------------------------------ the numbers of the bike (metres, kilograms, seconds)
  const G = 17;                                                // a little more than the pull of the Earth: more fun
  const SAMPLE = 0.2;                                          // the ground is a line with a point every 20 cm
  const REAR = { x: -0.72, y: -0.22, drive: true }, FRONT = { x: 0.74, y: -0.22, drive: false };      // the hubs, seen from the centre of mass (x forward, y up)
  const RW = 0.34;                                             // the radius of a wheel
  const MASS = 170, INERTIA = 88;
  const K_TIRE = 46000, C_TIRE = 2100, MU = 1.2;               // the tyre is a spring (N per metre) with a damper and a grip
  const ENGINE = 2300, BRAKE = 2400, VMAX = 25;
  const AIR_TORQUE = 430;

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
  function paintTexture(T, w, h, paint, rx = 1, ry = 1) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"), w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 4;
    return t;
  }
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
  const slab = (T, shape, width, bevel = 0.04) => { const g = new T.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 }); g.translate(0, 0, -width / 2); return g; };

  // ------------------------------------------------------------------------------------------------------------------ the bike made of shapes (x forward, y up, z across), wheels at the hubs
  function buildBike(T, env) {
    const group = new T.Group();
    const paint = new T.MeshPhysicalMaterial({ color: 0xe1352c, roughness: 0.3, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    const dark = new T.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.55, metalness: 0.4 });
    const steel = new T.MeshStandardMaterial({ color: 0xc9cfd8, roughness: 0.25, metalness: 1 });
    const tire = new T.MeshStandardMaterial({ color: 0x121317, roughness: 0.9 });
    const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new T.Mesh(geo, mat); m.position.set(x, y, z); group.add(m); return m; };
    const wheels = [REAR, FRONT].map((hub) => {
      const w = new T.Group();
      const spin = new T.Group();
      spin.add(new T.Mesh(new T.TorusGeometry(0.27, 0.075, 14, 32), tire), new T.Mesh(new T.TorusGeometry(0.2, 0.022, 8, 28), steel));
      for (let i = 0; i < 8; i += 1) { const sp = new T.Mesh(new T.BoxGeometry(0.4, 0.012, 0.012), steel); sp.rotation.z = (i / 8) * Math.PI; spin.add(sp); }
      spin.add(new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.12, 12).rotateX(Math.PI / 2), steel));
      w.add(spin);
      w.userData.spin = spin;
      group.add(w);
      return { group: w, spin };
    });
    // frame, engine, swing arm, fork
    add(slab(T, outline(T, [[-0.45, -0.28], [0.35, -0.28], [0.42, 0.1], [-0.4, 0.18]], 0.08), 0.3), dark);
    for (let i = 0; i < 4; i += 1) add(new T.BoxGeometry(0.62, 0.02, 0.34), steel, -0.05, -0.2 + i * 0.07, 0);
    const swing = add(new T.BoxGeometry(0.8, 0.07, 0.34), dark, REAR.x * 0.55 - 0.12, REAR.y + 0.1, 0);
    swing.rotation.z = 0.12;
    add(new T.CylinderGeometry(0.035, 0.035, 0.34, 10).rotateX(Math.PI / 2), new T.MeshStandardMaterial({ color: 0xf0b81f, roughness: 0.4, metalness: 0.5 }), -0.38, 0.0, 0.12);
    const fork = new T.Mesh(new T.CylinderGeometry(0.035, 0.04, 0.9, 10), steel);
    fork.position.set(FRONT.x - 0.17, FRONT.y + 0.43, 0.1); fork.rotation.z = 0.36; group.add(fork);
    const fork2 = fork.clone(); fork2.position.z = -0.1; group.add(fork2);
    // tank and fairing, tail, seat
    add(slab(T, outline(T, [[-0.35, 0.05], [-0.1, 0.46], [0.42, 0.52], [0.88, 0.32], [0.92, 0.08], [0.42, -0.14], [-0.1, -0.12]], 0.14), 0.4), paint);
    add(slab(T, outline(T, [[-0.35, 0.18], [-0.95, 0.4], [-1.08, 0.3], [-0.9, 0.12], [-0.3, 0.04]], 0.07), 0.3), paint);
    add(slab(T, outline(T, [[-0.8, 0.43], [-0.2, 0.46], [-0.05, 0.4], [-0.8, 0.38]], 0.03), 0.28), dark);
    add(new T.CylinderGeometry(0.05, 0.065, 0.95, 12).rotateZ(Math.PI / 2), steel, -0.62, -0.18, -0.2).rotation.z = 0.07;
    add(new T.SphereGeometry(0.1, 14, 10), new T.MeshStandardMaterial({ color: 0xfff3cc, emissive: 0xfff3cc, emissiveIntensity: 0.9 }), 0.92, 0.22, 0).scale.set(0.7, 1, 1.4);
    const screen = add(slab(T, outline(T, [[0.5, 0.5], [0.78, 0.84], [0.84, 0.5]], 0.03), 0.22, 0.01), new T.MeshPhysicalMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.45, roughness: 0.1 }));
    screen.position.z = 0;
    // the rider: legs, back, arms, helmet with a visor
    const suit = new T.MeshStandardMaterial({ color: 0x2f4fc4, roughness: 0.7 });
    const rider = new T.Group();
    const limb = (ax, ay, bx, by, r, mat) => {
      const len = Math.hypot(bx - ax, by - ay);
      const m = new T.Mesh(new T.CapsuleGeometry(r, Math.max(0.01, len - r * 2), 4, 10), mat);
      m.position.set((ax + bx) / 2, (ay + by) / 2, 0);
      m.rotation.z = Math.atan2(by - ay, bx - ax) - Math.PI / 2;
      return m;
    };
    const legs = [-0.14, 0.14].map((z) => { const leg = new T.Group(); leg.add(limb(-0.45, 0.62, 0.25, 0.28, 0.095, suit), limb(0.25, 0.28, -0.1, -0.06, 0.08, dark)); leg.position.z = z; rider.add(leg); return leg; });
    const torso = new T.Group();
    torso.add(limb(0, 0, 0.42, 0.52, 0.17, suit));
    const stripe = new T.Mesh(new T.BoxGeometry(0.5, 0.03, 0.36), new T.MeshStandardMaterial({ color: 0xf4f5f8, roughness: 0.6 }));
    stripe.position.set(0.2, 0.26, 0); stripe.rotation.z = 0.88; torso.add(stripe);
    const arms = [-0.19, 0.19].map((z) => { const arm = new T.Group(); arm.add(limb(0.38, 0.5, 0.62, 0.34, 0.065, suit), limb(0.62, 0.34, 0.86, 0.5, 0.06, suit)); arm.position.z = z; torso.add(arm); return arm; });
    const helmet = new T.Group();
    helmet.add(new T.Mesh(new T.SphereGeometry(0.2, 24, 18), new T.MeshPhysicalMaterial({ color: 0xf4f5f8, roughness: 0.25, clearcoat: 1 })));
    const visor = new T.Mesh(new T.SphereGeometry(0.205, 20, 14, -0.9, 1.8, 0.95, 0.9), new T.MeshPhysicalMaterial({ color: 0x142235, roughness: 0.05, metalness: 0.6, clearcoat: 1 }));
    visor.rotation.y = Math.PI / 2 - 0.2;
    helmet.add(visor);
    helmet.position.set(0.5, 0.74, 0);
    torso.add(helmet);
    torso.position.set(-0.4, 0.5, 0);
    rider.add(torso);
    group.add(rider);
    return { group, wheels, rider, torso, legs, arms, helmet, T };
  }

  // ------------------------------------------------------------------------------------------------------------------ the game
  R({ id: "moto", name: "Motorrad", emoji: "🏍️", cat: "Rennen", featured: true, bubble: false, backdrop: false, order: 2, color: "#2a6fdb", hint: "Gas rechts · Bremse links · in der Luft neigen", create(e) {
    const g = e.g;
    // ---- the ground: heights every SAMPLE metres, made as far as it is needed
    const hs = [0];
    let genY = 0, difficulty = 0;
    const coins = [];
    const lay = (length, delta, ease = true) => {
      const n = Math.max(1, Math.round(length / SAMPLE));
      const base = genY;
      for (let k = 1; k <= n; k += 1) { const u = k / n; hs.push(base + delta * (ease ? (1 - Math.cos(u * Math.PI)) / 2 : u)); }
      genY = base + delta;
    };
    const arc = (x0, x1, y, n = 5) => { for (let k = 0; k < n; k += 1) { const u = k / Math.max(1, n - 1); coins.push({ x: x0 + (x1 - x0) * u, y: y + Math.sin(u * Math.PI) * 1.3, taken: false, obj: null }); } };
    function extend(untilX) {
      while ((hs.length - 1) * SAMPLE < untilX) {
        const start = (hs.length - 1) * SAMPLE;
        const d = Math.min(1, difficulty);
        const roll = e.rand();
        if (start < 14) lay(8, 0);
        else if (roll < 0.26) lay(e.rand(6, 12), 0);
        else if (roll < 0.6) lay(e.rand(10, 17), e.rand(1.4, 3.2 + 2.2 * d) * (e.rand() < 0.5 ? -1 : 1));
        else if (roll < 0.72) { const n = e.randInt(2, 4); for (let k = 0; k < n; k += 1) { lay(1.6, -(0.2 + 0.16 * d)); lay(1.6, 0.2 + 0.16 * d); } }
        else {                                                                       // a ramp: a steep rise, a short flat piece, then the ground falls away
          const rise = e.rand(1.1, 1.7 + 1.1 * d);
          lay(e.rand(3, 4), rise, false);
          lay(e.rand(1, 1.8), 0, false);
          arc(start + 3.4, start + 9, genY + 2.1, 5);
          lay(e.rand(8, 12), -rise * e.rand(0.6, 1.2));
        }
        if (genY > 7) lay(4, -3);                                                    // the track stays between a ceiling and a floor
        if (genY < -7) lay(4, 3);
        if ((hs.length - 1) * SAMPLE > 16 && e.rand() < 0.5) { const x0 = start + e.rand(3, 6); arc(x0, x0 + 5, heightAt(x0) + 1.1, 4); }
      }
    }
    function sample(i) { return i <= 0 ? hs[0] : i >= hs.length ? hs[hs.length - 1] : hs[i]; }
    function heightAt(x) {
      if (x <= 0) return hs[0];
      extend(x + 40);
      const f = x / SAMPLE, i = Math.floor(f);
      return lerp(sample(i), sample(i + 1), f - i);
    }
    lay(12, 0);
    extend(60);

    // ---- the bike as a body in the plane
    const b = { x: 4, y: 0, th: 0, vx: 0, vy: 0, w: 0, rot: 0 };
    const hubs = [{ ...REAR, ct: null, spin: 0 }, { ...FRONT, ct: null, spin: 0 }];
    { const gy = heightAt(b.x); b.y = gy + RW + 0.22 + 0.02; }
    const st = { t: 0, best: 0, coinsGot: 0, bonus: 0, flips: 0, crash: 0, air: 0, airRot: 0, wasAir: false, shake: 0, gas: 0, brake: 0, lean: 0 };
    const startX = b.x;
    const rider = { x: 0, y: 0, vx: 0, vy: 0, rot: 0, spin: 0, free: false };
    const pops = [];
    const BL = { x: 12, y: 548, w: 104, h: 70 }, BR = { x: 244, y: 548, w: 104, h: 70 };
    let three = null, loading = false, failed = false;
    const say = (text, color = "#fff") => { pops.push({ text, age: 0, color }); while (pops.length > 3) pops.shift(); };

    function contact(px, py) {
      let best = null;
      const i0 = Math.floor((px - RW) / SAMPLE), i1 = Math.ceil((px + RW) / SAMPLE);
      for (let i = i0; i < i1; i += 1) {
        const ax = i * SAMPLE, ay = sample(i), bx = ax + SAMPLE, by = sample(i + 1);
        const dx = bx - ax, dy = by - ay;
        const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
        const qx = ax + dx * t, qy = ay + dy * t;
        const ex = px - qx, ey = py - qy;
        const dist = Math.hypot(ex, ey);
        if (dist < RW && (!best || dist < best.dist)) best = { dist, qx, qy, ex, ey };
      }
      if (!best) return null;
      const nx = best.dist > 1e-4 ? best.ex / best.dist : 0, ny = best.dist > 1e-4 ? best.ey / best.dist : 1;
      return { pen: RW - best.dist, nx, ny, qx: best.qx, qy: best.qy };
    }
    const toWorld = (lx, ly) => { const c = Math.cos(b.th), s = Math.sin(b.th); return { x: lx * c - ly * s, y: lx * s + ly * c }; };

    function crashNow(why) {
      if (st.crash) return;
      st.crash = 0.001;
      st.shake = 0.5;
      const o = toWorld(0.15, 1.0);
      Object.assign(rider, { x: b.x + o.x, y: b.y + o.y, vx: b.vx * 0.9, vy: b.vy + 3, rot: b.th, spin: (b.vx >= 0 ? -1 : 1) * 6.5, free: true });
      say(why || "AUA!", "#ff5a4d");
      navigator.vibrate?.(60);
    }

    /* one small step of the physics */
    function physics(dt) {
      let fx = 0, fy = -MASS * G, torque = 0;
      const gas = st.crash ? 0 : st.gas, brake = st.crash ? 0 : st.brake;
      let grounded = 0;
      for (const hub of hubs) {
        const o = toWorld(hub.x, hub.y);
        const px = b.x + o.x, py = b.y + o.y;
        const ct = contact(px, py);
        hub.ct = ct;
        if (!ct) continue;
        grounded += 1;
        const vx = b.vx - b.w * o.y, vy = b.vy + b.w * o.x;                       // the speed of the hub: the body moves and turns
        const vn = vx * ct.nx + vy * ct.ny;
        const N = Math.max(0, K_TIRE * ct.pen - C_TIRE * vn);                       // the tyre pushes out of the ground, and the damper takes the energy of a landing
        const tx = ct.ny, ty = -ct.nx;                                             // along the ground, forward
        const vt = vx * tx + vy * ty;
        let Ft = -vt * 10;                                                         // rolling resistance
        if (hub.drive && gas) Ft += ENGINE * Math.max(0, 1 - Math.max(0, vt) / VMAX);
        if (brake) Ft -= clamp(vt * 4, -1, 1) * BRAKE * 0.5;
        Ft = clamp(Ft, -MU * N, MU * N);                                           // a tyre cannot grip more than it is pressed
        const Fx = N * ct.nx + Ft * tx, Fy = N * ct.ny + Ft * ty;
        fx += Fx; fy += Fy;
        torque += (ct.qx - b.x) * Fy - (ct.qy - b.y) * Fx;                         // the push at the ground turns the bike round its centre
        hub.spin = vt / RW;
      }
      fx -= 0.3 * b.vx * Math.abs(b.vx); fy -= 0.3 * b.vy * Math.abs(b.vy);       // air drag
      if (!grounded && !st.crash) torque += ((st.gas ? -1 : 0) + (st.brake ? 1 : 0)) * AIR_TORQUE;       // in the air the buttons turn the bike (gas: nose down)
      torque -= b.w * (grounded ? 16 : 7);
      b.vx += (fx / MASS) * dt; b.vy += (fy / MASS) * dt; b.w += (torque / INERTIA) * dt;
      b.vx = clamp(b.vx, -30, 36); b.vy = clamp(b.vy, -45, 45); b.w = clamp(b.w, -14, 14);
      b.x += b.vx * dt; b.y += b.vy * dt; b.th += b.w * dt;
      return grounded;
    }

    function step(dt) {
      const i = e.input;
      st.t += dt;
      st.shake = Math.max(0, st.shake - dt);
      for (const p of pops) p.age += dt;
      while (pops.length && pops[0].age > 1) pops.shift();
      st.gas = (i.down && e.inside(i.x, i.y, BR.x, BR.y, BR.w, BR.h)) || i.keys.has("ArrowRight") || i.keys.has("d") || i.keys.has("D") || i.keys.has("ArrowUp") ? 1 : 0;
      st.brake = (i.down && e.inside(i.x, i.y, BL.x, BL.y, BL.w, BL.h)) || i.keys.has("ArrowLeft") || i.keys.has("a") || i.keys.has("A") || i.keys.has("ArrowDown") ? 1 : 0;
      difficulty = Math.min(1.4, (b.x - startX) / 600);
      extend(b.x + 45);
      let grounded = 0;
      for (let k = 0; k < 4; k += 1) grounded = Math.max(grounded, physics(dt / 4));
      if (![b.x, b.y, b.th, b.vx, b.vy, b.w].every(Number.isFinite)) { b.vx = b.vy = b.w = 0; b.y = heightAt(b.x) + 1; b.th = 0; crashNow("AUA!"); }
      st.lean += ((st.gas ? 0.5 : st.brake ? -0.25 : 0) - st.lean) * Math.min(1, dt * 6);
      // ---- the rider flies on his own after a crash
      if (rider.free) {
        rider.vy -= G * dt; rider.x += rider.vx * dt; rider.y += rider.vy * dt; rider.rot += rider.spin * dt;
        const gy = heightAt(rider.x) + 0.25;
        if (rider.y < gy) { rider.y = gy; rider.vy = Math.abs(rider.vy) * 0.25; rider.vx *= 0.7; rider.spin *= 0.6; }
      }
      if (st.crash) { st.crash += dt; if (st.crash > 1.5) e.over(); return; }
      // ---- air time, flips, landings
      if (!grounded) { st.air += dt; if (st.air > 0.12) { if (!st.wasAir) { st.wasAir = true; st.airRot = 0; } st.airRot += b.w * dt; } }
      else {
        if (st.wasAir) {
          const turns = Math.round(Math.abs(st.airRot) / TAU - 0.18);
          if (st.air > 0.45 && turns >= 1) { st.flips += turns; st.bonus += 60 * turns; say(turns > 1 ? `${turns}x FLIP! +${60 * turns}` : "FLIP! +60", "#ffe45c"); navigator.vibrate?.(25); }
          else if (st.air > 1.1) { st.bonus += 15; say("WEIT! +15", "#9fe8ff"); }
          st.shake = Math.max(st.shake, st.air > 0.6 ? 0.12 : 0);
        }
        st.air = 0; st.wasAir = false;
      }
      // ---- crashes: the head or the tail on the ground, or upside down
      const head = toWorld(0.15, 1.0), tail = toWorld(-1.05, 0.2), nose = toWorld(1.0, 0.3);
      if (b.y + head.y < heightAt(b.x + head.x) + 0.1 || b.y + tail.y < heightAt(b.x + tail.x) + 0.02 || b.y + nose.y < heightAt(b.x + nose.x) + 0.02) { crashNow("AUA!"); return; }
      if (grounded && Math.abs(Math.atan2(Math.sin(b.th), Math.cos(b.th))) > 1.9) { crashNow("AUA!"); return; }
      // ---- coins and the score
      for (const c of coins) if (!c.taken && Math.hypot(c.x - b.x, c.y - b.y - 0.4) < 0.9) { c.taken = true; st.coinsGot += 1; st.bonus += 3; say("+3", "#ffd34d"); }
      while (coins.length && coins[0].x < b.x - 14) { const old = coins.shift(); if (old.obj && three) three.scene.remove(old.obj); }
      st.best = Math.max(st.best, Math.floor((b.x - startX) * 1.2));
      e.score(st.best + st.bonus);
    }

    // ---- the pictures
    const TRACK_SEGS = 130, TRACK_STEP = 0.4, TRACK_HALF = 0.95;
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
      scene.add(new T.HemisphereLight(0xd6e8ff, 0x3a4252, 0.9));
      const sun = new T.DirectionalLight(0xfff0d6, 1.5);
      sun.position.set(-12, 24, 20);
      scene.add(sun);
      const camera = new T.PerspectiveCamera(50, W / H, 0.1, 300);
      // the track: a strip with a top, a front side and a lit edge, rebuilt from the heights every picture
      const verts = TRACK_SEGS + 1;
      const makeStrip = (perVert, indexOf) => {
        const geo = new T.BufferGeometry();
        geo.setAttribute("position", new T.BufferAttribute(new Float32Array(verts * perVert * 3), 3));
        geo.setAttribute("uv", new T.BufferAttribute(new Float32Array(verts * perVert * 2), 2));
        geo.setAttribute("normal", new T.BufferAttribute(new Float32Array(verts * perVert * 3), 3));
        geo.setAttribute("color", new T.BufferAttribute(new Float32Array(verts * perVert * 3).fill(1), 3));
        const idx = [];
        for (let i = 0; i < TRACK_SEGS; i += 1) indexOf(idx, i * perVert, (i + 1) * perVert);
        geo.setIndex(idx);
        return geo;
      };
      const topGeo = makeStrip(2, (idx, a, c) => idx.push(a, a + 1, c, c, a + 1, c + 1));
      const frontGeo = makeStrip(2, (idx, a, c) => idx.push(a, a + 1, c, c, a + 1, c + 1));
      const edgeGeo = makeStrip(2, (idx, a, c) => idx.push(a, a + 1, c, c, a + 1, c + 1));
      const asphalt = paintTexture(T, 256, 128, (c, w, h) => {
        c.fillStyle = "#636a7a"; c.fillRect(0, 0, w, h);
        let s = 7; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
        for (let n = 0; n < 900; n += 1) { c.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${0.04 + rnd() * 0.06})` : `rgba(0,0,0,${0.08 + rnd() * 0.12})`; c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
        c.fillStyle = "rgba(255,255,255,0.55)"; c.fillRect(0, h / 2 - 3, w * 0.45, 6);
      });
      const top = new T.Mesh(topGeo, new T.MeshBasicMaterial({ map: asphalt, color: 0xd5dae6, side: T.DoubleSide }));
      const shade = frontGeo.attributes.color.array;
      for (let i = 0; i <= TRACK_SEGS; i += 1) shade.set([0.2, 0.23, 0.3, 0.05, 0.06, 0.08], i * 6);             // the side of the track gets darker towards the bottom
      const front = new T.Mesh(frontGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: T.DoubleSide }));
      const edge = new T.Mesh(edgeGeo, new T.MeshStandardMaterial({ color: 0xeaf5ff, emissive: 0x6fb6ff, emissiveIntensity: 1.2, side: T.DoubleSide }));
      for (const m of [top, front, edge]) { m.frustumCulled = false; scene.add(m); }
      const bike = buildBike(T, envMap);
      scene.add(bike.group);
      const shadow = new T.Mesh(new T.PlaneGeometry(3.4, 1.3), new T.MeshBasicMaterial({ map: paintTexture(T, 64, 64, (c) => { const k = c.createRadialGradient(32, 32, 2, 32, 32, 31); k.addColorStop(0, "rgba(0,0,0,0.7)"); k.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = k; c.fillRect(0, 0, 64, 64); }), transparent: true, depthWrite: false }));
      shadow.rotation.order = "ZXY";                      // (first lie flat, then follow the slope of the ground)
      shadow.rotation.x = -Math.PI / 2;
      scene.add(shadow);
      const riderBody = new T.Group();
      riderBody.add(new T.Mesh(new T.CapsuleGeometry(0.17, 0.5, 4, 10), new T.MeshStandardMaterial({ color: 0x2f4fc4, roughness: 0.7 })));
      const head = new T.Mesh(new T.SphereGeometry(0.2, 20, 14), new T.MeshPhysicalMaterial({ color: 0xf4f5f8, roughness: 0.25, clearcoat: 1 }));
      head.position.y = 0.5;
      riderBody.add(head);
      riderBody.visible = false;
      scene.add(riderBody);
      const coinGeo = new T.CylinderGeometry(0.34, 0.34, 0.09, 24).rotateX(Math.PI / 2);
      const coinMat = new T.MeshStandardMaterial({ color: 0xffc820, metalness: 0.9, roughness: 0.25, emissive: 0xffa800, emissiveIntensity: 0.55 });
      three = { T, renderer, scene, camera, top, front, edge, topGeo, frontGeo, edgeGeo, bike, shadow, riderBody, coinGeo, coinMat, canvas, dpr, camX: b.x + 3, camY: b.y, asphalt };
    }

    function updateTrack(t3, x0) {
      const first = Math.floor(x0 / TRACK_STEP) * TRACK_STEP;
      const set = (geo, fn, flat) => {
        const pos = geo.attributes.position.array, uv = geo.attributes.uv.array, nor = geo.attributes.normal.array;
        for (let i = 0; i <= TRACK_SEGS; i += 1) {
          const x = first + i * TRACK_STEP;
          fn(pos, uv, i, x, heightAt(x));
          const slope = (heightAt(x + 0.2) - heightAt(x - 0.2)) / 0.4, len = Math.hypot(slope, 1);
          const n = flat ? [0, 0, 1] : [-slope / len, 1 / len, 0];                   // the lit side: the top looks up, the front looks at the camera
          nor.set([...n, ...n], i * 6);
        }
        geo.attributes.position.needsUpdate = true; geo.attributes.uv.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
      };
      set(t3.topGeo, (p, uv, i, x, y) => { p.set([x, y, TRACK_HALF, x, y, -TRACK_HALF], i * 6); uv.set([x / 12, 0, x / 12, 1], i * 4); });
      set(t3.frontGeo, (p, uv, i, x, y) => { p.set([x, y, TRACK_HALF, x, -14, TRACK_HALF], i * 6); uv.set([0, 0, 0, 1], i * 4); }, true);
      set(t3.edgeGeo, (p, uv, i, x, y) => { p.set([x, y + 0.025, TRACK_HALF - 0.16, x, y + 0.025, TRACK_HALF + 0.02], i * 6); uv.set([0, 0, 0, 1], i * 4); });
      t3.asphalt.offset.x = 0;
    }

    function render() {
      const t3 = three;
      const { camera, bike } = t3;
      // the camera: a bit ahead of the bike, from the side and a bit from the front, farther away when it is fast
      const speed = clamp(b.vx / VMAX, 0, 1.2);
      t3.camX += (b.x + 1.9 + clamp(b.vx, 0, 30) * 0.075 - t3.camX) * 0.2;
      t3.camY += (b.y + 0.9 - t3.camY) * 0.12;
      const shake = st.shake * 0.25;
      camera.fov = 50 + speed * 4;
      camera.updateProjectionMatrix();
      camera.position.set(t3.camX + 2.6 + (Math.random() - 0.5) * shake, t3.camY + 1.5 + (Math.random() - 0.5) * shake, 10.5 + speed * 3);
      camera.lookAt(t3.camX + 0.2, t3.camY - 0.2, 0);
      updateTrack(t3, t3.camX - 12);
      // the bike stands on the front half of the track, and a soft shadow lies on the ground under it
      bike.group.position.set(b.x, b.y, 0.25);
      bike.group.rotation.z = b.th;
      const under = heightAt(b.x), slope = (heightAt(b.x + 0.5) - heightAt(b.x - 0.5)) / 1;
      t3.shadow.position.set(b.x, under + 0.04, 0.25);
      t3.shadow.rotation.set(-Math.PI / 2, 0, Math.atan(slope));
      t3.shadow.material.opacity = clamp(1 - (b.y - under - 0.6) / 4, 0, 1);
      hubs.forEach((hub, k) => {
        const w = bike.wheels[k];
        const compress = hub.ct ? Math.min(0.08, hub.ct.pen) : 0;
        w.group.position.set(hub.x, hub.y + compress * 0.6, 0);
        w.spin.rotation.z -= (hub.ct ? hub.spin : b.vx / RW * 0.6) * (1 / 60);
      });
      const lean = st.lean;
      bike.torso.rotation.z = -0.08 - lean * 0.3;
      bike.helmet.position.set(0.5 + lean * 0.12, 0.74 - lean * 0.06, 0);
      bike.rider.visible = !rider.free;
      t3.riderBody.visible = rider.free;
      if (rider.free) { t3.riderBody.position.set(rider.x, rider.y, 0); t3.riderBody.rotation.z = rider.rot; }
      for (const c of coins) {
        if (c.taken) { if (c.obj) { t3.scene.remove(c.obj); c.obj = null; } continue; }
        if (c.x < t3.camX - 9 || c.x > t3.camX + 20) { if (c.obj) { t3.scene.remove(c.obj); c.obj = null; } continue; }
        if (!c.obj) { c.obj = new t3.T.Mesh(t3.coinGeo, t3.coinMat); t3.scene.add(c.obj); }
        c.obj.position.set(c.x, c.y, 0);
        c.obj.rotation.y = st.t * 5 + c.x;
      }
      t3.renderer.render(t3.scene, camera);
      g.drawImage(t3.canvas, 0, 0, W, H);
    }

    function hud() {
      e.panel(10, 70, 112, 46, 16, 0.5);
      e.text(`${st.best} m`, 66, 93, { size: 24, stroke: false });
      e.panel(W - 114, 70, 104, 46, 16, 0.5);
      g.fillStyle = "#ffcc1f"; g.beginPath(); g.arc(W - 92, 93, 9, 0, TAU); g.fill(); g.fillStyle = "#ffe98a"; g.beginPath(); g.arc(W - 93, 92, 5, 0, TAU); g.fill();
      e.text(String(st.coinsGot), W - 58, 93, { size: 24, stroke: false });
      if (st.flips) e.text(`Flips ${st.flips}`, W / 2, 138, { size: 16 });
      pops.forEach((o, n) => { g.globalAlpha = Math.max(0, 1 - o.age); e.text(o.text, W / 2, 172 + n * 26 - o.age * 30, { size: 22, color: o.color }); });
      g.globalAlpha = 1;
      const i = e.input;
      const hotL = i.down && e.inside(i.x, i.y, BL.x, BL.y, BL.w, BL.h), hotR = i.down && e.inside(i.x, i.y, BR.x, BR.y, BR.w, BR.h);
      for (const [bt, hot, label, sub] of [[BL, hotL, "BREMSE", "in der Luft: zurück"], [BR, hotR, "GAS", "in der Luft: vor"]]) {
        g.fillStyle = hot ? "rgba(255,255,255,0.8)" : "rgba(20,22,28,0.5)"; e.panel(bt.x, bt.y + (hot ? 2 : 0), bt.w, bt.h, 24, hot ? 0.8 : 0.5, hot ? "255,255,255" : "20,22,28");
        g.lineWidth = 3; g.strokeStyle = hot ? "#fff" : "rgba(255,255,255,0.55)"; g.beginPath(); if (g.roundRect) g.roundRect(bt.x + 1.5, bt.y + 1.5 + (hot ? 2 : 0), bt.w - 3, bt.h - 3, 22); else g.rect(bt.x + 1.5, bt.y + 1.5, bt.w - 3, bt.h - 3); g.stroke();
        e.text(label, bt.x + bt.w / 2, bt.y + 27 + (hot ? 2 : 0), { size: 22, color: hot ? "#111" : "#fff", stroke: false });
        e.text(sub, bt.x + bt.w / 2, bt.y + 51 + (hot ? 2 : 0), { size: 11, weight: 700, color: hot ? "#333" : "#d8dbe2", stroke: false });
      }
    }

    const game = {
      update(dt) {
        if (!three && typeof document !== "undefined" && typeof document.createElement === "function") return;
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
