/* Nex games: the motorbike (pg-racing.js). A motorbike that rides over hills and ramps, does flips in the air and crashes when it lands badly. It draws only the ground, the bike and the
   dashboard, on a see-through picture: the player (the camera of the phone) is the background. It shows its scenery and its buttons before the first touch (the camera tab draws the
   first picture and waits). The car race is in pg-race3d.js. */
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

  /* ======================================================================================================================================== Motorrad */
  const norm = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  /* the bike and its rider, drawn at 25 pixels per half wheelbase and shown 20 % bigger */
  function drawBike(g, o) {
    // o: {x, y (centre), ang, rot (wheel turning), lean}
    const L = 25, RW = 12.5;
    const RED = "#e1352c";
    g.save();
    g.translate(o.x, o.y);
    g.rotate(o.ang);
    g.scale(1.2, 1.2);
    g.lineCap = "round";
    g.lineJoin = "round";
    const wheel = (wx, wy) => {
      g.save(); g.translate(wx, wy);
      g.fillStyle = "#0f1115"; g.beginPath(); g.arc(0, 0, RW, 0, TAU); g.fill();
      g.strokeStyle = "#2b2e36"; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, RW - 1.6, 0, TAU); g.stroke();
      g.strokeStyle = "#cdd3dc"; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, RW - 4.2, 0, TAU); g.stroke();
      g.strokeStyle = "rgba(205,211,220,0.8)"; g.lineWidth = 1;
      for (let k = 0; k < 8; k++) { const a = o.rot + k * TAU / 8; g.beginPath(); g.moveTo(Math.cos(a) * 2.4, Math.sin(a) * 2.4); g.lineTo(Math.cos(a) * (RW - 4.4), Math.sin(a) * (RW - 4.4)); g.stroke(); }
      g.fillStyle = "rgba(125,131,142,0.6)"; g.beginPath(); g.arc(0, 0, 5.2, 0, TAU); g.fill();
      g.fillStyle = "#eef0f4"; g.beginPath(); g.arc(0, 0, 2.2, 0, TAU); g.fill();
      g.restore();
    };
    wheel(-L, 10);
    wheel(L, 10);
    // swing arm, shock, fork
    g.strokeStyle = "#3a3e47"; g.lineWidth = 4.6; g.beginPath(); g.moveTo(-L, 10); g.lineTo(-8, 3); g.stroke();
    g.strokeStyle = "#f0b81f"; g.lineWidth = 2.6; g.beginPath(); g.moveTo(-18, 7); g.lineTo(-13, -5); g.stroke();
    g.strokeStyle = "#cfd4dc"; g.lineWidth = 3.6; g.beginPath(); g.moveTo(L, 10); g.lineTo(L - 8, -13); g.stroke();
    g.strokeStyle = "#8c93a0"; g.lineWidth = 1.1; g.beginPath(); g.moveTo(L - 1, 9); g.lineTo(L - 8.8, -12); g.stroke();
    // exhaust and engine
    const pipe = g.createLinearGradient(0, 2, 0, 8); pipe.addColorStop(0, "#e9edf2"); pipe.addColorStop(1, "#7d838e");
    g.fillStyle = pipe; rr(g, -33, 3.4, 27, 4.6, 2.3); g.fill();
    g.fillStyle = "#2a2c33"; rr(g, -35, 3.4, 5, 4.6, 2.2); g.fill();
    g.fillStyle = "#2c2f37"; rr(g, -13, -2, 24, 15, 4); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(-11, 2 + k * 3.2); g.lineTo(9, 2 + k * 3.2); g.stroke(); }
    g.fillStyle = "#5d636e"; rr(g, -8, 1, 12, 8, 3); g.fill();
    // tail, seat, tank and fairing
    const paint = g.createLinearGradient(0, -20, 0, 4); paint.addColorStop(0, "#ff6a5c"); paint.addColorStop(0.45, RED); paint.addColorStop(1, "#9b1d17");
    g.fillStyle = paint;
    g.beginPath(); g.moveTo(-12, -12); g.lineTo(-30, -13.5); g.quadraticCurveTo(-37, -12.5, -33, -7); g.lineTo(-14, -3.5); g.closePath(); g.fill();
    g.fillStyle = "#16181d"; rr(g, -27, -15, 17, 3.8, 1.9); g.fill();
    g.fillStyle = paint;
    g.beginPath(); g.moveTo(-13, -11.5); g.quadraticCurveTo(-4, -20, 8, -17.5); g.lineTo(L - 7, -14.5); g.quadraticCurveTo(L + 4, -11.5, L + 3.4, -5); g.lineTo(L - 4, 2.5); g.lineTo(6, 3); g.lineTo(-6, -1); g.closePath(); g.fill();
    g.fillStyle = "rgba(255,255,255,0.32)"; g.beginPath(); g.moveTo(-6, -14); g.quadraticCurveTo(2, -18, 10, -15.5); g.quadraticCurveTo(2, -14.5, -6, -12); g.closePath(); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 1.3; g.beginPath(); g.moveTo(8, -3); g.quadraticCurveTo(L - 8, -4, L + 1, -7); g.stroke();
    g.fillStyle = "rgba(190,226,255,0.5)"; g.beginPath(); g.moveTo(L - 10, -15.5); g.lineTo(L - 3.5, -23); g.lineTo(L - 0.8, -14); g.closePath(); g.fill();
    g.fillStyle = "#fff4c2"; g.beginPath(); g.ellipse(L + 1.4, -8.2, 3.3, 2.3, 0.4, 0, TAU); g.fill();
    g.strokeStyle = "#1e2026"; g.lineWidth = 2.6; g.beginPath(); g.moveTo(L - 8, -15); g.lineTo(L - 12, -19.5); g.stroke();
    // the rider: boots, legs, back, arm, gloves, helmet with a visor
    const lean = o.lean || 0;
    const hipX = -13, hipY = -9;
    const shX = hipX + 14 + lean * 8, shY = hipY - 19 + Math.abs(lean) * 2;
    g.strokeStyle = "#1a1d26"; g.lineWidth = 5.4; g.beginPath(); g.moveTo(-3, 11); g.lineTo(0, 12); g.stroke();
    g.strokeStyle = "#1c2f78"; g.lineWidth = 5.2; g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(2, 3); g.lineTo(-3, 10); g.stroke();
    const jacket = g.createLinearGradient(hipX, hipY, shX, shY); jacket.addColorStop(0, "#1f358f"); jacket.addColorStop(1, "#3b5fd9");
    g.strokeStyle = jacket; g.lineWidth = 7; g.beginPath(); g.moveTo(hipX, hipY); g.lineTo(shX, shY); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.75)"; g.lineWidth = 1.2; g.beginPath(); g.moveTo(hipX + 2, hipY - 3); g.lineTo(shX - 2, shY + 4); g.stroke();
    g.strokeStyle = "#2f4fc4"; g.lineWidth = 4.2; g.beginPath(); g.moveTo(shX, shY + 1); g.lineTo(shX + 8, shY + 8); g.lineTo(L - 12, -18); g.stroke();
    g.fillStyle = "#15171c"; g.beginPath(); g.arc(L - 12, -18, 2.7, 0, TAU); g.fill();
    const hx = shX + 4.5, hy = shY - 7;
    g.fillStyle = "#f4f5f8"; g.beginPath(); g.arc(hx, hy, 7.3, 0, TAU); g.fill();
    g.fillStyle = RED; g.beginPath(); g.arc(hx, hy, 7.3, Math.PI * 1.05, Math.PI * 1.85); g.lineTo(hx, hy); g.fill();
    const visor = g.createLinearGradient(hx + 4, hy - 3, hx + 12, hy + 2); visor.addColorStop(0, "#1a2433"); visor.addColorStop(1, "#4a6a96");
    g.fillStyle = visor; rr(g, hx + 3.6, hy - 3.8, 8.4, 5.6, 2.6); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.55)"; g.lineWidth = 1; g.beginPath(); g.moveTo(hx + 5.4, hy - 2.4); g.lineTo(hx + 10, hy - 2.4); g.stroke();
    g.restore();
  }

  R({ id: "moto", name: "Motorrad", emoji: "🏍️", cat: "Rennen", featured: true, bubble: false, backdrop: false, order: 2, color: "#2a6fdb", hint: "Gas rechts · Bremse links · in der Luft neigen", create(e) {
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
    let gravel = null;
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
        // no sky, no hills: the player is the background. Only the ground, with a lit edge, marker posts and a pattern of tiny stones that slides along
        const surface = g.createLinearGradient(0, 0, 0, H);
        surface.addColorStop(0, "rgba(58,63,76,0.97)"); surface.addColorStop(0.6, "rgba(30,33,41,0.98)"); surface.addColorStop(1, "rgba(18,20,26,0.99)");
        g.beginPath();
        g.moveTo(-4, H + 4);
        for (let x = -4; x <= W + 8; x += 6) g.lineTo(x, ground(x + camX) - camY);
        g.lineTo(W + 8, H + 4); g.closePath();
        g.fillStyle = surface; g.fill();
        if (!gravel && typeof document.createElement === "function") {
          gravel = document.createElement("canvas"); gravel.width = gravel.height = 96;
          const gc = gravel.getContext("2d");
          for (let n = 0; n < 150; n++) { gc.fillStyle = n % 3 ? `rgba(255,255,255,${0.04 + e.rand() * 0.07})` : `rgba(0,0,0,${0.1 + e.rand() * 0.14})`; gc.fillRect(e.rand(96), e.rand(96), 1 + e.rand(2.4), 1 + e.rand(2)); }
        }
        if (gravel) {
          g.save();
          g.clip();
          g.translate(-(camX % 96), -(camY % 96));
          g.fillStyle = g.createPattern(gravel, "repeat");
          g.fillRect(0, 0, W + 96, H + 96);
          g.restore();
        }
        g.lineJoin = "round";
        const edge = (off, color, width, dash) => {
          g.strokeStyle = color; g.lineWidth = width;
          g.setLineDash(dash || []);
          g.beginPath();
          for (let x = -4; x <= W + 8; x += 6) { const y = ground(x + camX) - camY + off; if (x === -4) g.moveTo(x, y); else g.lineTo(x, y); }
          g.stroke();
          g.setLineDash([]);
        };
        edge(2, "rgba(110,190,255,0.22)", 12);                                 // a soft glow, then the lit edge and a coloured line under it
        edge(0, "#eaf5ff", 3.4);
        edge(5, "#3f9bff", 1.8);
        g.lineDashOffset = camX % 36;
        edge(30, "rgba(255,255,255,0.2)", 3, [18, 18]);                        // dashes along the ground
        g.lineDashOffset = 0;
        // posts every 100 m with the distance
        for (let m = Math.max(1, Math.floor((camX - 20 - startX) / 1600)); m * 1600 + startX - camX < W + 40; m++) {
          const px = m * 1600 + startX - camX;
          if (px < -30) continue;
          const py = ground(px + camX) - camY;
          g.fillStyle = "rgba(255,255,255,0.9)"; rr(g, px - 1.5, py - 30, 3, 30, 1.5); g.fill();
          g.fillStyle = "#3f9bff"; rr(g, px - 18, py - 50, 36, 22, 6); g.fill();
          e.text(`${m * 100}`, px, py - 39, { size: 12, stroke: false });
        }
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
