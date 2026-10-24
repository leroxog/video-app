/* Nex games: racing (pg-racing.js). Two games that are made with more care than the small ones: a car race on a busy motorway seen from above (lanes, traffic of cars, vans and
   lorries that change lanes, coins, nitro, a landscape of grass, trees and rocks that rushes past) and a motorbike that rides over hills and ramps and does flips in the air.
   Both show their scenery and their buttons before the first touch (the camera tab draws the first picture and waits), and both end when somebody crashes. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const TAU = Math.PI * 2;

  const rr = (g, x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };
  const mix = (a, b, k) => Math.round(a + (b - a) * k);
  /* a colour "#rrggbb" made lighter (amount > 0) or darker (amount < 0) */
  function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, gr = (n >> 8) & 255, b = n & 255;
    const t = amount < 0 ? 0 : 255;
    const k = Math.abs(amount);
    return `rgb(${mix(r, t, k)},${mix(gr, t, k)},${mix(b, t, k)})`;
  }
  const clampf = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ======================================================================================================================================== Auto-Rennen */
  /* A car seen from above, its nose up. kind: "sedan", "sport", "taxi", "van", "truck". */
  function drawCar(g, cx, cy, w, h, color, kind, angle = 0, o = {}) {
    g.save();
    g.translate(cx, cy);
    if (angle) g.rotate(angle);
    g.fillStyle = "rgba(0,0,0,0.30)";
    rr(g, -w / 2 + 4, -h / 2 + 6, w, h, 10);
    g.fill();
    g.fillStyle = "#15161a";                                                  // wheels
    for (const wy of [-h * 0.3, h * 0.3]) for (const sx of [-1, 1]) { rr(g, sx < 0 ? -w / 2 - 1 : w / 2 - 6, wy - 8, 7, 16, 3); g.fill(); }
    const body = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    body.addColorStop(0, shade(color, -0.28));
    body.addColorStop(0.28, shade(color, 0.14));
    body.addColorStop(0.55, color);
    body.addColorStop(1, shade(color, -0.3));
    if (kind === "truck") {
      g.fillStyle = shade(color, -0.1);                                       // cab
      rr(g, -w / 2 + 2, -h / 2, w - 4, h * 0.27, 8); g.fill();
      g.fillStyle = "rgba(150,200,235,0.9)";
      rr(g, -w / 2 + 6, -h / 2 + 4, w - 12, h * 0.08, 3); g.fill();
      g.fillStyle = "#e9ecef";                                                // the load
      rr(g, -w / 2, -h / 2 + h * 0.29, w, h * 0.71, 5); g.fill();
      g.fillStyle = "rgba(0,0,0,0.12)";
      for (let k = 1; k < 6; k++) g.fillRect(-w / 2 + 2, -h / 2 + h * 0.29 + k * h * 0.118, w - 4, 2);
      g.fillStyle = color;
      g.fillRect(-w / 2 + 3, -h / 2 + h * 0.34, w - 6, 6);
    } else {
      g.fillStyle = body;
      rr(g, -w / 2, -h / 2, w, h, kind === "van" ? 9 : 12); g.fill();
      g.fillStyle = "rgba(255,255,255,0.14)";                                 // hood and boot
      rr(g, -w / 2 + 5, -h / 2 + 3, w - 10, h * 0.2, 7); g.fill();
      g.fillStyle = "rgba(0,0,0,0.12)";
      rr(g, -w / 2 + 5, h / 2 - h * 0.17, w - 10, h * 0.14, 6); g.fill();
      const glass = "rgba(28,40,56,0.94)";
      g.fillStyle = glass;                                                    // windscreen, roof, rear window
      g.beginPath();
      g.moveTo(-w / 2 + 5, -h * 0.17); g.lineTo(w / 2 - 5, -h * 0.17); g.lineTo(w / 2 - 3, -h * 0.03); g.lineTo(-w / 2 + 3, -h * 0.03); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(-w / 2 + 3, h * 0.22); g.lineTo(w / 2 - 3, h * 0.22); g.lineTo(w / 2 - 5, h * 0.3); g.lineTo(-w / 2 + 5, h * 0.3); g.closePath(); g.fill();
      g.fillStyle = shade(color, kind === "van" ? 0.05 : 0.18);
      rr(g, -w / 2 + 3, -h * 0.03, w - 6, h * 0.25, 6); g.fill();
      if (kind === "sport") {
        g.fillStyle = "rgba(255,255,255,0.85)";                               // two stripes
        g.fillRect(-4, -h / 2 + 2, 3, h - 4); g.fillRect(1, -h / 2 + 2, 3, h - 4);
      }
      if (kind === "taxi") {
        g.fillStyle = "#fff";
        rr(g, -8, -h * 0.01, 16, 7, 2); g.fill();
        g.fillStyle = "#111";
        g.fillRect(-5, h * 0.01, 10, 2);
      }
      if (kind === "van") {
        g.fillStyle = "rgba(255,255,255,0.2)";
        g.fillRect(-w / 2 + 4, h * 0.05, w - 8, 2); g.fillRect(-w / 2 + 4, h * 0.14, w - 8, 2);
      }
    }
    g.fillStyle = o.lights ? "#fff7c2" : "#ffe9a3";                           // headlights
    for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(sx * (w / 2 - 7), -h / 2 + 3.5, 4, 2.6, 0, 0, TAU); g.fill(); }
    g.fillStyle = o.brake ? "#ff2f2f" : "#b01818";                            // tail lights
    for (const sx of [-1, 1]) rr(g, sx * (w / 2 - 8) - 4, h / 2 - 5, 8, 3.6, 1.5), g.fill();
    if (o.brake) { g.fillStyle = "rgba(255,40,40,0.35)"; g.fillRect(-w / 2 + 2, h / 2, w - 4, 7); }
    if (o.blink) {
      g.fillStyle = "#ffb11c";
      const x = o.blink * (w / 2 - 1.5);
      g.beginPath(); g.arc(x, -h / 2 + 4, 2.6, 0, TAU); g.arc(x, h / 2 - 4, 2.6, 0, TAU); g.fill();
    }
    g.restore();
  }

  function drawTree(g, x, y, s, big) {
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath(); g.ellipse(x + 5 * s, y + 7 * s, 15 * s, 11 * s, 0, 0, TAU); g.fill();
    const tones = big ? ["#1f6b34", "#2a8a43", "#38a655"] : ["#2c7d3e", "#3b9a52", "#58b86e"];
    g.fillStyle = tones[0]; g.beginPath(); g.arc(x, y, 15 * s, 0, TAU); g.fill();
    g.fillStyle = tones[1]; g.beginPath(); g.arc(x - 2 * s, y - 2 * s, 11 * s, 0, TAU); g.fill();
    g.fillStyle = tones[2]; g.beginPath(); g.arc(x - 4 * s, y - 4 * s, 6 * s, 0, TAU); g.fill();
  }
  function drawRock(g, x, y, s) {
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.beginPath(); g.ellipse(x + 3 * s, y + 4 * s, 11 * s, 7 * s, 0, 0, TAU); g.fill();
    g.fillStyle = "#8d9096"; g.beginPath(); g.ellipse(x, y, 10 * s, 7 * s, 0.3, 0, TAU); g.fill();
    g.fillStyle = "#b5b8bd"; g.beginPath(); g.ellipse(x - 2 * s, y - 2 * s, 6 * s, 3.5 * s, 0.3, 0, TAU); g.fill();
  }
  function drawSign(g, x, y, s, left) {
    g.fillStyle = "rgba(0,0,0,0.25)"; g.fillRect(x - 2 * s + 3, y - 2 + 3, 5 * s, 16 * s);
    g.fillStyle = "#cfd3d8"; g.fillRect(x - 1.5 * s, y, 3 * s, 14 * s);
    g.fillStyle = "#1c62c4"; rr(g, x - 9 * s, y - 14 * s, 18 * s, 14 * s, 3); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.moveTo(x + (left ? -4 : 4) * s, y - 7 * s); g.lineTo(x + (left ? 4 : -4) * s, y - 11 * s); g.lineTo(x + (left ? 4 : -4) * s, y - 3 * s); g.closePath(); g.fill();
  }

  function drawButton(e, x, y, w, h, label, active) {
    const g = e.g;
    g.fillStyle = active ? "rgba(255,255,255,0.78)" : "rgba(20,22,28,0.5)";
    rr(g, x, y + (active ? 2 : 0), w, h, 24); g.fill();
    g.lineWidth = 3; g.strokeStyle = active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.55)";
    rr(g, x + 1.5, y + 1.5 + (active ? 2 : 0), w - 3, h - 3, 22); g.stroke();
    g.fillStyle = active ? "#111" : "#fff";
    g.beginPath();
    const cx = x + w / 2, cy = y + h / 2 + (active ? 2 : 0);
    if (label === "left") { g.moveTo(cx + 10, cy - 15); g.lineTo(cx - 12, cy); g.lineTo(cx + 10, cy + 15); g.lineTo(cx + 3, cy); }
    else if (label === "right") { g.moveTo(cx - 10, cy - 15); g.lineTo(cx + 12, cy); g.lineTo(cx - 10, cy + 15); g.lineTo(cx - 3, cy); }
    g.closePath(); g.fill();
  }

  R({ id: "car-race", name: "Auto-Rennen", emoji: "🏎️", cat: "Rennen", featured: true, bubble: true, order: 1, color: "#d63a2f", hint: "Lenke mit den Pfeilen oder dem Finger · sammle Münzen und Nitro", create(e) {
    const g = e.g;
    const ROAD0 = 52, ROAD1 = 308, LANES = 4, LW = (ROAD1 - ROAD0) / LANES, PY = 468;
    const laneX = (i) => ROAD0 + LW * (i + 0.5);
    const KINDS = [
      { kind: "sedan", w: 34, h: 62, colors: ["#2b6fd6", "#e8e8ec", "#1f9d73", "#7b4cc4", "#d98a1f"], weight: 5 },
      { kind: "sport", w: 33, h: 58, colors: ["#e23b3b", "#f0c419", "#25b5c9", "#e0489b"], weight: 3 },
      { kind: "taxi", w: 34, h: 62, colors: ["#f4c20d"], weight: 2 },
      { kind: "van", w: 38, h: 74, colors: ["#e8e8ec", "#4a5568", "#c8d1dc"], weight: 2 },
      { kind: "truck", w: 42, h: 120, colors: ["#d2452c", "#2f6fb5", "#3d3f46"], weight: 1 },
    ];
    let t = 0, scroll = 0, speed = 300, dist = 0, px = laneX(1) + LW / 2, pvx = 0, tilt = 0, crash = 0, spin = 0, turbo = 0, coins = 0, near = 0, shake = 0;
    let nextCar = 0.5, nextCoin = 1.6, nextNitro = 7, stripe = 0, steer = 0, braking = 0;
    const cars = [], picks = [], popups = [], parts = [], scenery = [];
    const BL = { x: 12, y: 552, w: 96, h: 66 }, BR = { x: 252, y: 552, w: 96, h: 66 };

    for (let k = 0; k < 16; k++) {
      const left = k % 2 === 0;
      scenery.push({ x: left ? e.rand(6, 40) : e.rand(320, 354), y: (k / 16) * 760 - 60, kind: e.pick(["tree", "tree", "tree", "rock", "sign"]), s: e.rand(0.8, 1.3), left });
    }
    function addCar(lane, y, relVel, ahead) {
      const spec = (() => { let r = e.rand(0, KINDS.reduce((a, k) => a + k.weight, 0)); for (const k of KINDS) { r -= k.weight; if (r <= 0) return k; } return KINDS[0]; })();
      cars.push({ spec, color: e.pick(spec.colors), lane, x: laneX(lane), y, v: relVel, change: e.rand(2, 6), blink: 0, target: lane, near: false, ahead });
    }
    addCar(1, 150, 190, true);
    addCar(3, 300, 150, true);
    addCar(0, 40, 210, true);
    picks.push(...[0, 1, 2, 3, 4].map((k) => ({ kind: "coin", x: laneX(2), y: 220 - k * 44, spin: k * 0.5 })));

    function puff(x, y, n, color, speedMul = 1) {
      for (let k = 0; k < n; k++) parts.push({ x, y, vx: e.rand(-60, 60) * speedMul, vy: e.rand(-40, 120) * speedMul, life: e.rand(0.35, 0.8), age: 0, r: e.rand(2, 6), color });
    }
    const say = (text, x, y, color = "#fff") => popups.push({ text, x, y, age: 0, color });

    function freeLane() {
      const blocked = new Set(cars.filter((c) => c.y < 190 && c.y > -260).map((c) => c.target));
      const options = [0, 1, 2, 3].filter((l) => !blocked.has(l));
      return options.length >= 2 ? e.pick(options) : -1;                      // never close the whole motorway
    }

    function crashNow() {
      crash = 0.001;
      speed *= 0.4;
      shake = 0.5;
      puff(px, PY, 26, "#ffcf5a", 2.2);
      puff(px, PY, 18, "#888", 1.4);
      say("CRASH!", px, PY - 50, "#ff5a4d");
      navigator.vibrate?.(60);
    }

    return {
      canStart() { return true; },
      update(dt) {
        const i = e.input;
        t += dt;
        shake = Math.max(0, shake - dt);
        if (crash) {
          crash += dt;
          speed = Math.max(0, speed - 520 * dt);
          scroll += speed * dt;
          spin += (6 + crash * 5) * dt;
          px += pvx * dt; pvx *= 0.97;
          if (e.rand() < 0.5) puff(px, PY + 10, 1, "#666", 0.6);
          for (const c of cars) c.y += (speed - c.v) * dt;
          for (const p of parts) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
          for (let k = parts.length - 1; k >= 0; k--) if (parts[k].age > parts[k].life) parts.splice(k, 1);
          if (crash > 1.15) e.over();
          return;
        }
        // ---- steering: the arrows (held), the keys, or the finger anywhere above the arrows
        steer = 0;
        if (i.down && e.inside(i.x, i.y, BL.x, BL.y, BL.w, BL.h)) steer = -1;
        else if (i.down && e.inside(i.x, i.y, BR.x, BR.y, BR.w, BR.h)) steer = 1;
        else if (i.down && i.y < 540) steer = clampf((i.x - px) / 16, -1, 1);
        if (i.keys.has("ArrowLeft") || i.keys.has("a") || i.keys.has("A")) steer = -1;
        if (i.keys.has("ArrowRight") || i.keys.has("d") || i.keys.has("D")) steer = 1;
        pvx += (steer * 470 - pvx) * Math.min(1, dt * 8);
        px += pvx * dt;
        if (px < ROAD0 + 18) { px = ROAD0 + 18; pvx = Math.abs(pvx) * 0.2; }
        if (px > ROAD1 - 18) { px = ROAD1 - 18; pvx = -Math.abs(pvx) * 0.2; }
        tilt += (clampf(pvx / 700, -0.2, 0.2) - tilt) * Math.min(1, dt * 12);
        // ---- speed
        const goal = Math.min(580, 300 + t * 5.2) * (turbo > 0 ? 1.45 : 1);
        speed += (goal - speed) * Math.min(1, dt * 1.7);
        turbo = Math.max(0, turbo - dt);
        scroll += speed * dt;
        dist += speed * dt;
        stripe = (stripe + speed * dt) % 96;
        e.score(Math.floor(dist / 80) + coins * 5 + near * 3);
        // ---- traffic
        nextCar -= dt;
        if (nextCar <= 0) {
          const lane = freeLane();
          if (lane >= 0) addCar(lane, -140, e.rand(120, 235), false);
          nextCar = Math.max(0.34, 1.0 - t * 0.011) * e.rand(0.7, 1.3);
        }
        braking = 0;
        for (const c of cars) {
          c.y += (speed - c.v) * dt;
          c.change -= dt;
          if (c.change <= 0 && c.blink === 0 && c.y > -80 && c.y < 420) {      // a car that wants to change lanes shows it first
            const side = e.pick([-1, 1]);
            const lane = c.lane + side;
            if (lane >= 0 && lane < LANES && !cars.some((o) => o !== c && o.target === lane && Math.abs(o.y - c.y) < 130)) { c.blink = side; c.target = lane; c.blinkAt = 0.7; }
            c.change = e.rand(3, 7);
          }
          if (c.blink) {
            c.blinkAt -= dt;
            if (c.blinkAt <= 0) { c.lane = c.target; c.blink = 0; }
          }
          c.x += (laneX(c.lane) - c.x) * Math.min(1, dt * 4);
          // crash?
          const hw = c.spec.w / 2 - 1, hh = c.spec.h / 2 - 3;
          if (Math.abs(c.x - px) < hw + 17 && Math.abs(c.y - PY) < hh + 27) { crashNow(); return; }
          // close shave
          if (!c.near && c.y > PY - 30 && c.y < PY + 30) {
            const gap = Math.abs(c.x - px) - hw - 17;
            if (gap > 0 && gap < 12) { c.near = true; near += 1; say("KNAPP! +3", c.x, PY - 56, "#ffe45c"); }
          }
        }
        for (let k = cars.length - 1; k >= 0; k--) if (cars[k].y > 780) cars.splice(k, 1);
        // ---- coins and nitro
        nextCoin -= dt;
        if (nextCoin <= 0) {
          const lane = e.randInt(0, LANES - 1), n = e.randInt(4, 7);
          for (let k = 0; k < n; k++) picks.push({ kind: "coin", x: laneX(lane), y: -30 - k * 42, spin: k * 0.5 });
          nextCoin = e.rand(3.2, 5.5);
        }
        nextNitro -= dt;
        if (nextNitro <= 0) { picks.push({ kind: "nitro", x: laneX(e.randInt(0, LANES - 1)), y: -40, spin: 0 }); nextNitro = e.rand(11, 17); }
        for (const p of picks) {
          p.y += speed * dt;
          p.spin += dt * 7;
          if (!p.gone && Math.abs(p.x - px) < 26 && Math.abs(p.y - PY) < 38) {
            p.gone = true;
            if (p.kind === "coin") { coins += 1; say("+5", p.x, p.y - 12, "#ffd34d"); puff(p.x, p.y, 5, "#ffd34d", 0.8); }
            else { turbo = 3.2; say("TURBO!", p.x, p.y - 20, "#7fe3ff"); puff(p.x, p.y, 14, "#7fe3ff", 1.4); navigator.vibrate?.(20); }
          }
        }
        for (let k = picks.length - 1; k >= 0; k--) if (picks[k].gone || picks[k].y > 760) picks.splice(k, 1);
        // ---- landscape
        for (const s of scenery) {
          s.y += speed * dt;
          if (s.y > 700) { s.y -= 780 + e.rand(0, 120); s.x = s.left ? e.rand(6, 40) : e.rand(320, 354); s.kind = e.pick(["tree", "tree", "tree", "rock", "sign"]); s.s = e.rand(0.8, 1.3); }
        }
        // ---- smoke and flames
        if (turbo > 0) puff(px + e.rand(-6, 6), PY + 34, 1, "#7fe3ff", 0.8);
        else if (e.rand() < 0.25) puff(px + e.rand(-8, 8), PY + 34, 1, "rgba(200,200,200,0.8)", 0.4);
        for (const p of parts) { p.age += dt; p.x += p.vx * dt; p.y += (p.vy + speed * 0.9) * dt; }
        for (let k = parts.length - 1; k >= 0; k--) if (parts[k].age > parts[k].life) parts.splice(k, 1);
        for (const p of popups) { p.age += dt; p.y -= 34 * dt; }
        for (let k = popups.length - 1; k >= 0; k--) if (popups[k].age > 0.9) popups.splice(k, 1);
      },

      draw() {
        g.save();
        if (shake > 0) g.translate(e.rand(-5, 5) * shake * 2, e.rand(-5, 5) * shake * 2);
        // grass in two kinds of green that run past, the road, the kerbs and the lane lines
        for (let y = -96 + (scroll % 96); y < H + 96; y += 96) {
          g.fillStyle = "rgba(48,140,62,0.66)"; g.fillRect(0, y, ROAD0 - 7, 48); g.fillRect(ROAD1 + 7, y, W - ROAD1 - 7, 48);
          g.fillStyle = "rgba(40,124,54,0.7)"; g.fillRect(0, y + 48, ROAD0 - 7, 48); g.fillRect(ROAD1 + 7, y + 48, W - ROAD1 - 7, 48);
        }
        g.fillStyle = "rgba(38,40,47,0.86)"; g.fillRect(ROAD0, 0, ROAD1 - ROAD0, H);
        g.fillStyle = "rgba(255,255,255,0.05)"; for (let k = 0; k < LANES; k += 2) g.fillRect(ROAD0 + k * LW, 0, LW, H);
        for (let y = -48 + (scroll % 48); y < H + 48; y += 48) {
          g.fillStyle = "#d6342a"; g.fillRect(ROAD0 - 7, y, 7, 24); g.fillRect(ROAD1, y, 7, 24);
          g.fillStyle = "#f5f5f5"; g.fillRect(ROAD0 - 7, y + 24, 7, 24); g.fillRect(ROAD1, y + 24, 7, 24);
        }
        g.fillStyle = "rgba(255,255,255,0.9)"; g.fillRect(ROAD0 + 2, 0, 3, H); g.fillRect(ROAD1 - 5, 0, 3, H);
        for (let lane = 1; lane < LANES; lane++) for (let y = -56 + (stripe % 56); y < H + 56; y += 56) { g.fillStyle = lane === 2 ? "rgba(255,214,64,0.9)" : "rgba(255,255,255,0.78)"; g.fillRect(ROAD0 + lane * LW - 1.5, y, 3, 28); }
        for (const s of scenery) { if (s.kind === "tree") drawTree(g, s.x, s.y, s.s, s.s > 1.1); else if (s.kind === "rock") drawRock(g, s.x, s.y, s.s); else drawSign(g, s.x, s.y, s.s, s.left); }
        // pickups
        for (const p of picks) {
          if (p.kind === "coin") {
            const squeeze = Math.abs(Math.cos(p.spin));
            g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(p.x + 3, p.y + 5, 9 * squeeze + 1, 8, 0, 0, TAU); g.fill();
            g.fillStyle = "#ffcc1f"; g.beginPath(); g.ellipse(p.x, p.y, 10 * squeeze + 1.5, 10, 0, 0, TAU); g.fill();
            g.fillStyle = "#ffe98a"; g.beginPath(); g.ellipse(p.x - 1, p.y - 1, 6 * squeeze + 1, 6.5, 0, 0, TAU); g.fill();
          } else {
            g.fillStyle = "rgba(0,0,0,0.25)"; rr(g, p.x - 9, p.y - 12, 22, 28, 6); g.fill();
            g.fillStyle = "#1a8de0"; rr(g, p.x - 11, p.y - 15, 22, 28, 6); g.fill();
            g.fillStyle = "#cdeeff"; rr(g, p.x - 5, p.y - 19, 10, 6, 2); g.fill();
            g.fillStyle = "#fff"; g.beginPath(); g.moveTo(p.x + 2, p.y - 9); g.lineTo(p.x - 5, p.y + 2); g.lineTo(p.x, p.y + 2); g.lineTo(p.x - 2, p.y + 10); g.lineTo(p.x + 6, p.y - 2); g.lineTo(p.x + 1, p.y - 2); g.closePath(); g.fill();
          }
        }
        // the cars of the others, then yours
        for (const c of cars) drawCar(g, c.x, c.y, c.spec.w, c.spec.h, c.color, c.spec.kind, 0, { blink: c.blink && Math.floor(t * 6) % 2 ? c.blink : 0, brake: c.v < 150, lights: true });
        for (const p of parts) { const k = 1 - p.age / p.life; g.fillStyle = p.color; g.globalAlpha = Math.max(0, k); g.beginPath(); g.arc(p.x, p.y, p.r * (0.6 + k * 0.6), 0, TAU); g.fill(); }
        g.globalAlpha = 1;
        if (turbo > 0) {                                                       // flames and speed lines
          g.fillStyle = "rgba(127,227,255,0.85)"; g.beginPath(); g.moveTo(px - 8, PY + 31); g.lineTo(px, PY + 31 + 30 + e.rand(0, 12)); g.lineTo(px + 8, PY + 31); g.closePath(); g.fill();
          g.fillStyle = "#fff"; g.beginPath(); g.moveTo(px - 4, PY + 31); g.lineTo(px, PY + 31 + 16 + e.rand(0, 6)); g.lineTo(px + 4, PY + 31); g.closePath(); g.fill();
          g.strokeStyle = "rgba(255,255,255,0.5)"; g.lineWidth = 2;
          for (let k = 0; k < 8; k++) { const x = (k * 53 + t * 40) % W, y = (k * 97 + t * 900) % H; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 46); g.stroke(); }
        }
        drawCar(g, px, PY, 34, 62, "#e6322d", "sport", crash ? spin : tilt, { brake: !!crash, lights: true });
        for (const p of popups) { const k = Math.max(0, 1 - p.age / 0.9); g.globalAlpha = k; e.text(p.text, p.x, p.y, { size: 20, color: p.color }); }
        g.globalAlpha = 1;
        g.restore();
        // ---- the dashboard
        const kmh = Math.round(speed * 0.36);
        e.panel(10, 70, 104, 46, 16, 0.5);
        e.text(String(kmh), 52, 93, { size: 26, stroke: false });
        e.text("km/h", 92, 97, { size: 12, weight: 700, stroke: false, color: "#d8dbe2" });
        e.panel(W - 114, 70, 104, 46, 16, 0.5);
        g.fillStyle = "#ffcc1f"; g.beginPath(); g.arc(W - 92, 93, 9, 0, TAU); g.fill(); g.fillStyle = "#ffe98a"; g.beginPath(); g.arc(W - 93, 92, 5, 0, TAU); g.fill();
        e.text(String(coins), W - 58, 93, { size: 24, stroke: false });
        if (turbo > 0) { e.panel(W / 2 - 62, 126, 124, 14, 7, 0.5); e.rect(W / 2 - 60, 128, 120 * (turbo / 3.2), 10, "#7fe3ff", 5); }
        // ---- the arrows to steer with
        const i = e.input;
        drawButton(e, BL.x, BL.y, BL.w, BL.h, "left", i.down && e.inside(i.x, i.y, BL.x, BL.y, BL.w, BL.h));
        drawButton(e, BR.x, BR.y, BR.w, BR.h, "right", i.down && e.inside(i.x, i.y, BR.x, BR.y, BR.w, BR.h));
      },
    };
  } });

  /* ======================================================================================================================================== Motorrad */
  const norm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  function drawBike(g, o) {
    // o: {x, y (centre), ang, rot (wheel turning), lean}
    const L = 25, RW = 12.5;
    g.save();
    g.translate(o.x, o.y);
    g.rotate(o.ang);
    g.scale(1.2, 1.2);                                                          // the bike is drawn at 25 pixels per half wheelbase and shown 20 % bigger
    const wheel = (wx, wy) => {
      g.save(); g.translate(wx, wy);
      g.fillStyle = "#191a1f"; g.beginPath(); g.arc(0, 0, RW, 0, TAU); g.fill();
      g.fillStyle = "#4d515a"; g.beginPath(); g.arc(0, 0, RW - 3.2, 0, TAU); g.fill();
      g.strokeStyle = "#d5d9e0"; g.lineWidth = 1.6;
      for (let k = 0; k < 6; k++) { const a = o.rot + k * TAU / 6; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * (RW - 3.6), Math.sin(a) * (RW - 3.6)); g.stroke(); }
      g.fillStyle = "#eef0f4"; g.beginPath(); g.arc(0, 0, 2.6, 0, TAU); g.fill();
      g.restore();
    };
    wheel(-L, 10);
    wheel(L, 10);
    // swing arm and fork
    g.lineCap = "round";
    g.strokeStyle = "#8c929c"; g.lineWidth = 4;
    g.beginPath(); g.moveTo(-L, 10); g.lineTo(-6, 4); g.stroke();
    g.strokeStyle = "#c7ccd4"; g.lineWidth = 3.4;
    g.beginPath(); g.moveTo(L, 10); g.lineTo(L - 7, -14); g.stroke();
    // engine, exhaust, tank, seat
    g.fillStyle = "#3a3e47"; rr(g, -14, -2, 22, 14, 4); g.fill();
    g.fillStyle = "#6b717c"; rr(g, -9, 1, 12, 8, 3); g.fill();
    g.fillStyle = "#b9bec7"; rr(g, -29, 4, 20, 4.4, 2.2); g.fill();
    g.fillStyle = "#e1352c";
    g.beginPath(); g.moveTo(-10, -8); g.quadraticCurveTo(2, -17, 16, -9); g.lineTo(14, -2); g.lineTo(-8, -1); g.closePath(); g.fill();
    g.fillStyle = "#f5655a"; g.beginPath(); g.moveTo(-4, -10); g.quadraticCurveTo(3, -14, 10, -10); g.lineTo(3, -8); g.closePath(); g.fill();
    g.fillStyle = "#1d1f26"; rr(g, -26, -8, 19, 6, 3); g.fill();
    g.fillStyle = "#e1352c"; g.beginPath(); g.moveTo(-26, -5); g.lineTo(-33, -9); g.lineTo(-24, -9); g.closePath(); g.fill();
    // handlebar and light
    g.strokeStyle = "#2a2d34"; g.lineWidth = 3; g.beginPath(); g.moveTo(L - 7, -14); g.lineTo(L - 12, -19); g.stroke();
    g.fillStyle = "#fff6c4"; g.beginPath(); g.arc(L + 1, -9, 3.2, 0, TAU); g.fill();
    // the rider
    const lean = o.lean || 0;
    const hipX = -13, hipY = -9;
    const shX = hipX + 14 + lean * 8, shY = hipY - 19 + Math.abs(lean) * 2;
    g.strokeStyle = "#233a8f"; g.lineWidth = 6.2;
    g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(shX, shY); g.stroke();
    g.strokeStyle = "#1c2f78"; g.lineWidth = 5;
    g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(2, 4); g.lineTo(-3, 11); g.stroke();
    g.strokeStyle = "#2d49b5"; g.lineWidth = 4.2;
    g.beginPath(); g.moveTo(shX, shY + 1); g.lineTo(shX + 8, shY + 8); g.lineTo(L - 12, -18); g.stroke();
    g.fillStyle = "#f2f2f5"; g.beginPath(); g.arc(shX + 4.5, shY - 7, 7.2, 0, TAU); g.fill();
    g.fillStyle = "#e1352c"; g.beginPath(); g.arc(shX + 4.5, shY - 7, 7.2, Math.PI * 1.05, Math.PI * 1.9); g.lineTo(shX + 4.5, shY - 7); g.fill();
    g.fillStyle = "#17202c"; rr(g, shX + 5, shY - 10, 7.6, 5.2, 2.4); g.fill();
    g.restore();
  }

  R({ id: "moto", name: "Motorrad", emoji: "🏍️", cat: "Rennen", featured: true, bubble: true, order: 2, color: "#2a6fdb", hint: "Gas rechts · Bremse links · in der Luft neigen", create(e) {
    const g = e.g;
    const G = 1500, STEPX = 8, L = 30, RW = 15, OFF = 12, BIKE_X = 108;
    const heights = [];                                                         // the ground every 8 pixels, from x = 0
    let genY = 400, genX = 0, difficulty = 0;
    const coinsList = [];
    function lay(length, delta, easing = true) {                                // lays `length` pixels of ground that rise (or fall) by `delta`
      const n = Math.max(1, Math.round(length / STEPX));
      const base = genY;
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        const eased = easing ? (1 - Math.cos(u * Math.PI)) / 2 : u;
        heights.push(base + delta * eased);
      }
      genY = base + delta;
      genX += n * STEPX;
    }
    function bumps(count, h) { for (let k = 0; k < count; k++) { lay(30, -h); lay(30, h); } }
    function coinArc(x0, x1, yTop, n = 5) { for (let k = 0; k < n; k++) { const u = k / Math.max(1, n - 1); coinsList.push({ x: x0 + (x1 - x0) * u, y: yTop - Math.sin(u * Math.PI) * 26, taken: false }); } }
    function extend(untilX) {
      while (genX < untilX) {
        const d = Math.min(1, difficulty);
        const roll = e.rand();
        const start = genX;
        if (genX < 320) lay(160, 0);
        else if (roll < 0.28) lay(e.rand(120, 240), 0);
        else if (roll < 0.62) { const hill = e.rand(30, 70 + 70 * d) * (e.rand() < 0.5 ? -1 : 1); lay(e.rand(200, 340), hill); }
        else if (roll < 0.74) bumps(e.randInt(2, 4), 7 + 5 * d);
        else {                                                                   // a ramp: steep up, a short flat piece, then the ground falls away
          const rise = e.rand(42, 64 + 40 * d);
          lay(e.rand(58, 80), -rise, false);
          lay(e.rand(20, 36), 0, false);
          coinArc(start + 70, start + 190, genY - 70, 5);
          lay(e.rand(150, 230), rise * e.rand(0.6, 1.25));
        }
        if (genY < 300) lay(80, 60);                                            // the track stays between a ceiling and a floor
        if (genY > 520) lay(80, -60);
        if (genX > 320 && e.rand() < 0.5) { const x0 = start + e.rand(60, 120); coinArc(x0, x0 + 110, ground(x0) - 36, 4); }
      }
    }
    function ground(x) {
      if (x <= 0) return 400;
      extend(x + 900);
      const f = x / STEPX;
      const i = Math.floor(f);
      const a = i === 0 ? 400 : heights[i - 1], b = heights[i];
      return a + (b - a) * (f - i);
    }
    const slopeAt = (x) => (ground(x + 5) - ground(x - 5)) / 10;
    lay(200, 0);                                                                // the start: a long flat piece
    extend(1400);

    const bike = { x: BIKE_X + 60, y: 0, vx: 0, vy: 0, s: 0, ang: 0, angVel: 0, rot: 0, air: false, flip: 0, airTime: 0, lean: 0, crash: 0, tumble: null };
    const startX = bike.x;
    let t = 0, best = 0, coins = 0, flips = 0, bonus = 0, camX = 0, camY = 0, shake = 0, gas = 0, brake = 0;
    const dust = [], pops = [];
    const BL = { x: 12, y: 548, w: 104, h: 70 }, BR = { x: 244, y: 548, w: 104, h: 70 };
    function wheels() {
      const c = Math.cos(bike.ang), s = Math.sin(bike.ang);
      return { r: { x: bike.x - L * c - OFF * s, y: bike.y - L * s + OFF * c }, f: { x: bike.x + L * c - OFF * s, y: bike.y + L * s + OFF * c } };
    }
    function groundY(x) { const sl = (ground(x + 3) - ground(x - 3)) / 6; return ground(x) - RW * Math.sqrt(1 + sl * sl); }   // the height of a wheel centre that rests at x
    function place() {                                                          // height and angle of a bike that rolls on the ground
      const yr = groundY(bike.x - L), yf = groundY(bike.x + L);
      return { yc: (yr + yf) / 2 - OFF, ang: Math.atan2(yf - yr, 2 * L) };
    }
    { const p = place(); bike.y = p.yc; bike.ang = p.ang; }
    camX = bike.x - BIKE_X;
    camY = bike.y - 340;
    const say = (text, x, y, color = "#fff") => pops.push({ text, x, y, age: 0, color });
    function puffDust(x, y, n, color = "rgba(214,184,140,0.9)") { for (let k = 0; k < n; k++) dust.push({ x, y, vx: e.rand(-70, 30), vy: e.rand(-70, -10), age: 0, life: e.rand(0.3, 0.7), r: e.rand(2, 5), color }); }
    function crashNow(why) {
      if (bike.crash) return;
      bike.crash = 0.001;
      shake = 0.5;
      bike.tumble = { x: bike.x, y: bike.y - 20, vx: bike.air ? bike.vx : bike.s * 0.8, vy: -240, rot: 0, spin: 7 };
      puffDust(bike.x, bike.y + 12, 18, "rgba(214,184,140,0.95)");
      say(why || "AUA!", bike.x, bike.y - 50, "#ff5a4d");
      navigator.vibrate?.(60);
    }

    return {
      update(dt) {
        t += dt;
        const i = e.input;
        shake = Math.max(0, shake - dt);
        for (const d of dust) { d.age += dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 90 * dt; }
        for (let k = dust.length - 1; k >= 0; k--) if (dust[k].age > dust[k].life) dust.splice(k, 1);
        for (const p of pops) { p.age += dt; p.y -= 30 * dt; }
        for (let k = pops.length - 1; k >= 0; k--) if (pops[k].age > 1) pops.splice(k, 1);
        if (bike.crash) {
          bike.crash += dt;
          const tm = bike.tumble;
          tm.vy += G * dt; tm.x += tm.vx * dt; tm.y += tm.vy * dt; tm.rot += tm.spin * dt;
          const gy = ground(tm.x) - 10;
          if (tm.y > gy) { tm.y = gy; tm.vy *= -0.3; tm.vx *= 0.7; tm.spin *= 0.6; if (Math.abs(tm.vy) > 60) puffDust(tm.x, gy, 4); }
          bike.s *= 0.96; bike.x += bike.s * dt;
          camX += (tm.x - BIKE_X - camX) * Math.min(1, dt * 3);
          if (bike.crash > 1.3) e.over();
          return;
        }
        gas = (i.down && e.inside(i.x, i.y, BR.x, BR.y, BR.w, BR.h)) || i.keys.has("ArrowRight") || i.keys.has("d") || i.keys.has("D") || i.keys.has("ArrowUp") ? 1 : 0;
        brake = (i.down && e.inside(i.x, i.y, BL.x, BL.y, BL.w, BL.h)) || i.keys.has("ArrowLeft") || i.keys.has("a") || i.keys.has("A") || i.keys.has("ArrowDown") ? 1 : 0;
        difficulty = Math.min(1.4, bike.x / 9000);
        extend(bike.x + 900);
        if (!bike.air) {
          // ---- on the ground: gas, brake and the pull of the slope; the bike follows the ground
          const sl = Math.atan(slopeAt(bike.x));
          bike.s += (gas ? 620 * Math.max(0.12, 1 - bike.s / 640) : 0) * dt - (brake ? 1100 * dt : 0) + 880 * Math.sin(sl) * dt - bike.s * 0.12 * dt - (gas || brake ? 0 : Math.sign(bike.s) * 26 * dt);
          bike.s = clampf(bike.s, -160, 650);
          const yc0 = bike.y;
          const lastAng = bike.ang;
          bike.x += bike.s * Math.cos(sl) * dt;
          bike.x = Math.max(bike.x, 40);
          const p = place();
          const ball = yc0 + bike.vy * dt + 0.5 * G * dt * dt;
          if (p.yc > ball + 0.6 && bike.s > 90) {                               // the ground drops away faster than gravity pulls: the bike takes off
            bike.air = true;
            bike.vx = bike.s * Math.cos(sl);
            bike.vy = bike.vy + G * dt;
            bike.y = ball;
            bike.angVel = clampf(norm(bike.ang - lastAng) / dt, -2.5, 2.5) * 0.5;
            bike.flip = 0; bike.airTime = 0;
            puffDust(bike.x - 24, bike.y + 26, 6);
          } else {
            bike.vy = clampf((p.yc - yc0) / dt, -900, 900);
            bike.y = p.yc;
            const want = p.ang - (gas ? 0.2 * Math.max(0, 1 - bike.s / 560) : 0) + (brake ? 0.1 : 0);
            bike.ang += norm(want - bike.ang) * Math.min(1, dt * 16);
            bike.lean += ((gas ? 0.5 : brake ? -0.2 : 0) - bike.lean) * Math.min(1, dt * 6);
            bike.rot += bike.s / RW * dt;
            if (gas && bike.s > 40 && e.rand() < 0.5) puffDust(bike.x - L, bike.y + 26, 1);
          }
        } else {
          // ---- in the air: the bike turns with the buttons, comes down, and lands (or crashes)
          bike.airTime += dt;
          bike.vy += G * dt;
          bike.x += bike.vx * dt;
          bike.y += bike.vy * dt;
          bike.angVel += ((gas ? 1 : 0) - (brake ? 1 : 0)) * 11 * dt;
          bike.angVel = clampf(bike.angVel * (1 - 0.35 * dt), -6.4, 6.4);
          bike.ang += bike.angVel * dt;
          bike.flip += bike.angVel * dt;
          bike.rot += bike.vx / RW * dt * 0.3;
          bike.lean += ((bike.angVel > 0 ? 0.35 : -0.35) - bike.lean) * Math.min(1, dt * 5);
          const w = wheels();
          const gr = ground(w.r.x) - RW, gf = ground(w.f.x) - RW;
          const head = { x: bike.x + 17 * Math.cos(bike.ang) + 41 * Math.sin(bike.ang), y: bike.y + 17 * Math.sin(bike.ang) - 41 * Math.cos(bike.ang) };
          if (w.r.y >= gr || w.f.y >= gf) {
            const sl = Math.atan(slopeAt(bike.x));
            const diff = Math.abs(norm(bike.ang - sl));
            if (diff > 1.0) { crashNow("AUA!"); return; }
            bike.air = false;
            const turns = Math.round(Math.abs(bike.flip) / TAU - 0.18);
            const hop = bike.airTime < 0.4;                                    // a small jump over a bump: no fuss
            if (hop) { /* nothing to show */ }
            else if (turns >= 1 && diff < 0.75) { flips += turns; bonus += 60 * turns; say(turns > 1 ? `${turns}x FLIP! +${60 * turns}` : "FLIP! +60", bike.x, bike.y - 60, "#ffe45c"); navigator.vibrate?.(25); }
            else if (bike.airTime > 1.1 && diff < 0.6) { bonus += 15; say("WEIT! +15", bike.x, bike.y - 60, "#9fe8ff"); }
            if (!hop && diff < 0.35) say("Perfekt!", bike.x, bike.y - 38, "#fff");
            bike.s = clampf((bike.vx * Math.cos(sl) + bike.vy * Math.sin(sl)) * (1 - 0.4 * Math.min(1, diff / 1.0)), 0, 650);
            const p = place(); bike.y = p.yc; bike.vy = 0; bike.angVel = 0;
            if (!hop) { puffDust(bike.x, bike.y + 24, 10); shake = 0.12; }
          } else if (head.y >= ground(head.x) - 3) { crashNow("AUA!"); return; }
        }
        if (!bike.air && Math.abs(norm(bike.ang - place().ang)) > 1.2) { crashNow("AUA!"); return; }
        // ---- coins and the score
        for (const c of coinsList) if (!c.taken && Math.hypot(c.x - bike.x, c.y - bike.y) < 30) { c.taken = true; coins += 1; bonus += 3; say("+3", c.x, c.y - 8, "#ffd34d"); }
        while (coinsList.length && coinsList[0].x < bike.x - 200) coinsList.shift();
        best = Math.max(best, Math.floor((bike.x - startX) / 16));
        e.score(best + bonus);
        camX += (bike.x - BIKE_X - camX) * Math.min(1, dt * 7);
        camY += ((bike.y - 340) - camY) * Math.min(1, dt * 3.2);
      },

      draw() {
        g.save();
        if (shake > 0) g.translate(e.rand(-4, 4) * shake * 2, e.rand(-4, 4) * shake * 2);
        // the far hills (they move slower than the ground) and clouds
        for (const [k, par, base, amp, col] of [[0, 0.18, 330, 56, "rgba(46,86,128,0.34)"], [1, 0.34, 392, 44, "rgba(36,72,104,0.42)"]]) {
          g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
          for (let x = 0; x <= W + 12; x += 12) { const wx = x + camX * par; g.lineTo(x, base - camY * 0.18 + Math.sin(wx / (90 + k * 50)) * amp + Math.sin(wx / 37 + k) * amp * 0.25); }
          g.lineTo(W, H); g.closePath(); g.fill();
        }
        g.fillStyle = "rgba(255,255,255,0.55)";
        for (let k = 0; k < 4; k++) { const cx = ((k * 211 - camX * 0.08) % 520 + 520) % 520 - 80, cy = 120 + k * 34; g.beginPath(); g.arc(cx, cy, 15, 0, TAU); g.arc(cx + 20, cy - 6, 19, 0, TAU); g.arc(cx + 42, cy, 14, 0, TAU); g.fill(); }
        // the ground
        g.beginPath();
        g.moveTo(-4, H + 4);
        for (let x = -4; x <= W + 8; x += 6) g.lineTo(x, ground(x + camX) - camY);
        g.lineTo(W + 8, H + 4); g.closePath();
        const dirt = g.createLinearGradient(0, 0, 0, H);
        dirt.addColorStop(0, "rgba(120,84,48,0.96)"); dirt.addColorStop(1, "rgba(70,48,30,0.97)");
        g.fillStyle = dirt; g.fill();
        g.lineJoin = "round";
        const edge = (off, color, width) => {
          g.strokeStyle = color; g.lineWidth = width;
          g.beginPath();
          for (let x = -4; x <= W + 8; x += 6) { const y = ground(x + camX) - camY + off; if (x === -4) g.moveTo(x, y); else g.lineTo(x, y); }
          g.stroke();
        };
        edge(0, "#5fc04d", 8);
        edge(-3, "#8ee070", 2.4);
        for (const off of [26, 58, 96]) edge(off, "rgba(0,0,0,0.12)", 2);
        // coins
        for (const c of coinsList) {
          if (c.taken) continue;
          const sx = c.x - camX, sy = c.y - camY;
          if (sx < -20 || sx > W + 20) continue;
          const sq = Math.abs(Math.cos(t * 6 + c.x * 0.05));
          g.fillStyle = "#ffcc1f"; g.beginPath(); g.ellipse(sx, sy, 8 * sq + 2, 9, 0, 0, TAU); g.fill();
          g.fillStyle = "#ffe98a"; g.beginPath(); g.ellipse(sx - 1, sy - 1, 4 * sq + 1, 5, 0, 0, TAU); g.fill();
        }
        for (const d of dust) { const k = 1 - d.age / d.life; g.globalAlpha = Math.max(0, k); g.fillStyle = d.color; g.beginPath(); g.arc(d.x - camX, d.y - camY, d.r * (0.5 + k), 0, TAU); g.fill(); }
        g.globalAlpha = 1;
        // the bike (after a crash the rider flies on his own)
        if (bike.crash) {
          const tm = bike.tumble;
          drawBike(g, { x: bike.x - camX, y: bike.y - camY, ang: bike.ang + Math.min(1.2, bike.crash * 2), rot: bike.rot, lean: 0 });
          g.save(); g.translate(tm.x - camX, tm.y - camY); g.rotate(tm.rot);
          g.fillStyle = "#233a8f"; rr(g, -5, -4, 10, 22, 4); g.fill();
          g.fillStyle = "#f2f2f5"; g.beginPath(); g.arc(0, -10, 8, 0, TAU); g.fill();
          g.fillStyle = "#e1352c"; g.beginPath(); g.arc(0, -10, 8, Math.PI, Math.PI * 1.9); g.lineTo(0, -10); g.fill();
          g.restore();
        } else drawBike(g, { x: bike.x - camX, y: bike.y - camY, ang: bike.ang, rot: bike.rot, lean: bike.lean });
        for (const p of pops) { g.globalAlpha = Math.max(0, 1 - p.age); e.text(p.text, p.x - camX, p.y - camY, { size: 20, color: p.color }); }
        g.globalAlpha = 1;
        g.restore();
        // ---- the dashboard
        e.panel(10, 70, 112, 46, 16, 0.5);
        e.text(`${best} m`, 66, 93, { size: 24, stroke: false });
        e.panel(W - 114, 70, 104, 46, 16, 0.5);
        g.fillStyle = "#ffcc1f"; g.beginPath(); g.arc(W - 92, 93, 9, 0, TAU); g.fill(); g.fillStyle = "#ffe98a"; g.beginPath(); g.arc(W - 93, 92, 5, 0, TAU); g.fill();
        e.text(String(coins), W - 58, 93, { size: 24, stroke: false });
        if (flips) e.text(`Flips ${flips}`, W / 2, 138, { size: 16 });
        // ---- the two buttons
        const i = e.input;
        const hotL = i.down && e.inside(i.x, i.y, BL.x, BL.y, BL.w, BL.h), hotR = i.down && e.inside(i.x, i.y, BR.x, BR.y, BR.w, BR.h);
        for (const [b, hot, label, sub] of [[BL, hotL, "BREMSE", "in der Luft: zurück"], [BR, hotR, "GAS", "in der Luft: vor"]]) {
          g.fillStyle = hot ? "rgba(255,255,255,0.8)" : "rgba(20,22,28,0.5)"; rr(g, b.x, b.y + (hot ? 2 : 0), b.w, b.h, 24); g.fill();
          g.lineWidth = 3; g.strokeStyle = hot ? "#fff" : "rgba(255,255,255,0.55)"; rr(g, b.x + 1.5, b.y + 1.5 + (hot ? 2 : 0), b.w - 3, b.h - 3, 22); g.stroke();
          e.text(label, b.x + b.w / 2, b.y + 27 + (hot ? 2 : 0), { size: 22, color: hot ? "#111" : "#fff", stroke: false });
          e.text(sub, b.x + b.w / 2, b.y + 51 + (hot ? 2 : 0), { size: 11, weight: 700, color: hot ? "#333" : "#d8dbe2", stroke: false });
        }
      },
    };
  } });
})();
