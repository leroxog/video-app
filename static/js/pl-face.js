/* Nex face lenses (pl-face.js): masks and funny faces that follow your face live, like the lenses of Snapchat. A model of Google (MediaPipe Face Landmarker, Apache 2.0,
   static/js/vendor/mediapipe) finds 478 points of the face in every picture of the camera, on your own device (nothing is sent anywhere); the effects below are drawn with
   them on a canvas that lies over the camera picture (and goes into the recording like a game does). A lens is a recipe: a list of effect names and a colour filter
   (yipi-lenses.js has the recipes of the ready-made lenses; a lens somebody wrote as a prompt is turned into such a recipe by the server). The file is loaded when the
   first lens is opened. `PulseFace.effects` is the list of the effects (the server has the same names in yipi_lenses.py; a test keeps both in step). */
(function () {
  "use strict";

  const BASE = "/static/js/vendor/mediapipe";
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;

  // ------------------------------------------------------------------------------------------------------------------ the points of the face (MediaPipe numbering)
  /* "A" is the side that is on the left of the camera picture (it is the person's right eye), "B" the other one; with the mirrored front camera the sides swap on the screen. */
  const SIDE_A = { eyeOuter: 33, eyeInner: 133, eyeTop: 159, eyeBottom: 145, iris: 468, brow: 105, browOuter: 70, cheek: 234, cheekC: 205, mouth: 61, temple: 127, jaw: 172 };
  const SIDE_B = { eyeOuter: 263, eyeInner: 362, eyeTop: 386, eyeBottom: 374, iris: 473, brow: 334, browOuter: 300, cheek: 454, cheekC: 425, mouth: 291, temple: 356, jaw: 397 };
  const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
  const LIPS_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
  const EYE_A = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
  const EYE_B = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];

  // ------------------------------------------------------------------------------------------------------------------ the model
  const engine = { landmarker: null, loading: null, delegate: "" };
  function load() {
    if (engine.landmarker) return Promise.resolve(engine.landmarker);
    if (!engine.loading) {
      engine.loading = (async () => {
        const vision = await import(`${BASE}/vision_bundle.js?v=1`);
        const files = await vision.FilesetResolver.forVisionTasks(BASE);
        const options = (delegate) => ({ baseOptions: { modelAssetPath: `${BASE}/face_landmarker.task`, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.4, minFacePresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
        try {
          engine.landmarker = await vision.FaceLandmarker.createFromOptions(files, options("GPU"));
          engine.delegate = "GPU";
        } catch (error) {
          engine.landmarker = await vision.FaceLandmarker.createFromOptions(files, options("CPU"));
          engine.delegate = "CPU";
        }
        return engine.landmarker;
      })().catch((error) => { engine.loading = null; throw error; });
    }
    return engine.loading;
  }

  // ------------------------------------------------------------------------------------------------------------------ small drawing helpers
  function rr(c, x, y, w, h, r) { c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, r); else c.rect(x, y, w, h); }
  function poly(c, points, close = true) { c.beginPath(); points.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); if (close) c.closePath(); }
  function heart(c, x, y, size) {
    c.beginPath();
    c.moveTo(x, y + size * 0.35);
    c.bezierCurveTo(x - size * 0.6, y - size * 0.1, x - size * 0.35, y - size * 0.6, x, y - size * 0.25);
    c.bezierCurveTo(x + size * 0.35, y - size * 0.6, x + size * 0.6, y - size * 0.1, x, y + size * 0.35);
    c.closePath();
  }
  function star(c, x, y, r, points = 5, inner = 0.45, rot = -Math.PI / 2) {
    c.beginPath();
    for (let i = 0; i < points * 2; i += 1) {
      const a = rot + (i * Math.PI) / points;
      const rad = i % 2 ? r * inner : r;
      c.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    c.closePath();
  }
  /* draws in the head's own frame: (0,0) at the point, x to the right of the head, y down, one unit = one hundredth of the width of the face */
  function local(c, f, x, y, draw, extra = 0) {
    c.save();
    c.translate(x, y);
    c.rotate(f.roll + extra);
    c.scale(f.u, f.u);
    draw();
    c.restore();
  }
  const shade = (c, blur = 6, color = "rgba(0,0,0,0.35)", dy = 2) => { c.shadowColor = color; c.shadowBlur = blur; c.shadowOffsetY = dy; };
  const noShade = (c) => { c.shadowColor = "transparent"; c.shadowBlur = 0; c.shadowOffsetY = 0; };

  /* a round piece of the camera picture, magnified (for the big eyes, big head ...); (x, y) is the middle on the screen, r the radius on the screen */
  function magnify(c, f, x, y, r, zoom, soft = true) {
    const v = f.video;
    if (!v || !v.videoWidth) return;
    const srcR = r / zoom / f.k;
    const vx = (f.mirror ? f.W - x : x) - f.ox;
    const sx = vx / f.k, sy = (y - f.oy) / f.k;
    c.save();
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.clip();
    c.translate(x, y);
    if (f.mirror) c.scale(-1, 1);
    c.drawImage(v, sx - srcR, sy - srcR, srcR * 2, srcR * 2, -r, -r, r * 2, r * 2);
    c.restore();
    if (soft) {
      c.save();
      c.strokeStyle = "rgba(255,255,255,0.35)";
      c.lineWidth = Math.max(2, r * 0.05);
      c.beginPath();
      c.arc(x, y, r - c.lineWidth / 2, 0, TAU);
      c.stroke();
      c.restore();
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ the effects
  /* Every effect is draw(c, f): c the canvas context, f the face of this moment (see FaceLens.frame). */
  const FX = {};
  const add = (id, label, emoji, draw, about = "") => { FX[id] = { id, label, emoji, draw, about }; };

  const glassesBase = (c, f, style) => {
    const e = f.eyeDist / f.u;
    local(c, f, f.mid.x, f.mid.y, () => {
      for (const sx of [-1, 1]) {
        const x = (sx * e) / 2;
        c.save();
        c.translate(x, 0);
        style(c, sx);
        c.restore();
      }
    });
  };
  add("sunglasses", "Sonnenbrille", "🕶️", (c, f) => {
    const e = f.eyeDist / f.u;
    local(c, f, f.mid.x, f.mid.y, () => {
      shade(c, 8);
      c.fillStyle = "#111";
      c.strokeStyle = "#111";
      c.lineWidth = 3.5;
      c.lineJoin = "round";
      for (const sx of [-1, 1]) { rr(c, (sx * e) / 2 - 20, -13, 40, 29, 11); c.fill(); }
      c.beginPath(); c.moveTo(-e / 2 + 18, -3); c.quadraticCurveTo(0, -9, e / 2 - 18, -3); c.stroke();
      c.beginPath(); c.moveTo(-e / 2 - 20, -5); c.lineTo(-e / 2 - 42, -9); c.moveTo(e / 2 + 20, -5); c.lineTo(e / 2 + 42, -9); c.stroke();
      noShade(c);
      c.fillStyle = "rgba(255,255,255,0.22)";
      for (const sx of [-1, 1]) { c.beginPath(); c.moveTo((sx * e) / 2 - 15, -9); c.lineTo((sx * e) / 2 - 4, -9); c.lineTo((sx * e) / 2 - 14, 10); c.lineTo((sx * e) / 2 - 22, 10); c.closePath(); c.fill(); }
    });
  }, "schwarze Sonnenbrille");
  add("heartGlasses", "Herzbrille", "😍", (c, f) => {
    const e = f.eyeDist / f.u;
    local(c, f, f.mid.x, f.mid.y, () => {
      shade(c, 8, "rgba(120,0,40,0.4)");
      for (const sx of [-1, 1]) {
        const g = c.createLinearGradient(0, -20, 0, 24);
        g.addColorStop(0, "#ff7aa8");
        g.addColorStop(1, "#e0245e");
        c.fillStyle = g;
        heart(c, (sx * e) / 2, 4, 52);
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = "#ffd1e0";
        c.stroke();
      }
      noShade(c);
      c.strokeStyle = "#e0245e";
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(-e / 2 + 14, 0); c.lineTo(e / 2 - 14, 0); c.stroke();
      c.fillStyle = "rgba(255,255,255,0.5)";
      for (const sx of [-1, 1]) { c.beginPath(); c.ellipse((sx * e) / 2 - 10, -8, 5, 3, -0.6, 0, TAU); c.fill(); }
    });
  }, "pinke Herz-Brille");
  add("roundGlasses", "Runde Brille", "👓", (c, f) => {
    const e = f.eyeDist / f.u;
    local(c, f, f.mid.x, f.mid.y, () => {
      c.strokeStyle = "#d9a520";
      c.lineWidth = 3.2;
      c.fillStyle = "rgba(180,220,255,0.16)";
      for (const sx of [-1, 1]) { c.beginPath(); c.arc((sx * e) / 2, 2, 19, 0, TAU); c.fill(); c.stroke(); }
      c.beginPath(); c.moveTo(-e / 2 + 19, -2); c.quadraticCurveTo(0, -9, e / 2 - 19, -2); c.stroke();
      c.beginPath(); c.moveTo(-e / 2 - 19, 0); c.lineTo(-e / 2 - 40, -4); c.moveTo(e / 2 + 19, 0); c.lineTo(e / 2 + 40, -4); c.stroke();
    });
  }, "runde goldene Brille");
  add("nerdGlasses", "Nerd-Brille", "🤓", (c, f) => {
    const e = f.eyeDist / f.u;
    local(c, f, f.mid.x, f.mid.y, () => {
      c.strokeStyle = "#1a1a1a";
      c.lineWidth = 6;
      c.lineJoin = "round";
      c.fillStyle = "rgba(190,225,255,0.18)";
      for (const sx of [-1, 1]) { rr(c, (sx * e) / 2 - 21, -14, 42, 32, 8); c.fill(); c.stroke(); }
      c.beginPath(); c.moveTo(-e / 2 + 21, -3); c.lineTo(e / 2 - 21, -3); c.stroke();
      c.fillStyle = "#f3f0e8";
      c.fillRect(-4, -9, 8, 11);
      c.strokeStyle = "#999";
      c.lineWidth = 1;
      c.strokeRect(-4, -9, 8, 11);
    });
  }, "dicke schwarze Brille mit Pflaster");
  add("starGlasses", "Sternbrille", "🤩", (c, f) => {
    const e = f.eyeDist / f.u;
    local(c, f, f.mid.x, f.mid.y, () => {
      shade(c, 8, "rgba(120,80,0,0.4)");
      for (const sx of [-1, 1]) {
        c.fillStyle = "#ffd23a";
        star(c, (sx * e) / 2, 2, 31, 5, 0.5, -Math.PI / 2 + f.t * 0.6 * sx);
        c.fill();
        c.lineWidth = 3;
        c.strokeStyle = "#ff9b00";
        c.stroke();
      }
    });
  }, "gelbe Sterne statt Augen");

  const earBase = (c, f, color, inner, kind) => {
    const tilt = kind === "cat" ? 0.25 : 0.4;
    for (const sx of [-1, 1]) {
      local(c, f, f.top.x + sx * f.s * 0.3 * Math.cos(f.roll), f.top.y + sx * f.s * 0.3 * Math.sin(f.roll), () => {
        c.save();
        c.rotate(sx * tilt);
        if (kind === "cat") {
          c.fillStyle = color; c.beginPath(); c.moveTo(-14, 6); c.lineTo(0, -48); c.lineTo(20, 4); c.closePath(); c.fill();
          c.fillStyle = inner; c.beginPath(); c.moveTo(-6, 2); c.lineTo(1, -30); c.lineTo(12, 1); c.closePath(); c.fill();
        } else if (kind === "dog") {
          const g = c.createLinearGradient(0, -10, 0, 52);
          g.addColorStop(0, color); g.addColorStop(1, inner);
          c.fillStyle = g;
          c.beginPath(); c.moveTo(-10, -6); c.bezierCurveTo(-26, 4, -26, 44, -8, 52); c.bezierCurveTo(8, 56, 18, 30, 14, -4); c.closePath(); c.fill();
        } else {
          c.fillStyle = color; rr(c, -11, -92, 22, 100, 11); c.fill();
          c.fillStyle = inner; rr(c, -5, -80, 10, 76, 5); c.fill();
        }
        c.restore();
      });
    }
  };
  add("catEars", "Katzenohren", "🐱", (c, f) => {
    earBase(c, f, "#3a3a44", "#ff9db8", "cat");
    local(c, f, f.nose.x, f.nose.y + f.s * 0.02, () => {
      c.fillStyle = "#ff8fb0"; c.beginPath(); c.moveTo(-7, -3); c.lineTo(7, -3); c.lineTo(0, 6); c.closePath(); c.fill();
      c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 1.8; c.lineCap = "round";
      for (const sx of [-1, 1]) for (const dy of [-5, 2, 9]) { c.beginPath(); c.moveTo(sx * 18, dy); c.lineTo(sx * 52, dy + (dy - 2) * 1.2); c.stroke(); }
    });
  }, "Katzenohren, Nase und Schnurrhaare");
  add("dogEars", "Hundeohren", "🐶", (c, f) => {
    earBase(c, f, "#9a6a3a", "#5e3b1c", "dog");
    local(c, f, f.nose.x, f.nose.y, () => {
      const g = c.createRadialGradient(-3, -3, 1, 0, 0, 14);
      g.addColorStop(0, "#555"); g.addColorStop(1, "#111");
      c.fillStyle = g; c.beginPath(); c.ellipse(0, 0, 14, 10, 0, 0, TAU); c.fill();
      c.fillStyle = "rgba(255,255,255,0.4)"; c.beginPath(); c.ellipse(-4, -3, 4, 2, -0.4, 0, TAU); c.fill();
    });
    FX.tongue.draw(c, f);
  }, "Hundeohren, Nase und Zunge");
  add("bunnyEars", "Hasenohren", "🐰", (c, f) => {
    earBase(c, f, "#f5f0f2", "#ffb3c7", "bunny");
  }, "lange Hasenohren");
  add("devilHorns", "Teufelshörner", "😈", (c, f) => {
    for (const sx of [-1, 1]) {
      local(c, f, f.top.x + sx * f.s * 0.28 * Math.cos(f.roll), f.top.y + sx * f.s * 0.28 * Math.sin(f.roll) + f.s * 0.04, () => {
        const g = c.createLinearGradient(0, 0, 0, -50);
        g.addColorStop(0, "#8e0f1f"); g.addColorStop(1, "#ff3b3b");
        c.fillStyle = g;
        c.beginPath(); c.moveTo(-11 * sx, 4); c.quadraticCurveTo(-14 * sx, -34, 10 * sx, -50); c.quadraticCurveTo(8 * sx, -24, 12 * sx, 4); c.closePath(); c.fill();
      });
    }
  }, "rote Hörner");
  add("halo", "Heiligenschein", "😇", (c, f) => {
    local(c, f, f.top.x, f.top.y - f.s * 0.18, () => {
      const bob = Math.sin(f.t * 2.2) * 3;
      c.shadowColor = "rgba(255,220,80,0.9)"; c.shadowBlur = 16;
      c.strokeStyle = "#ffe066"; c.lineWidth = 7;
      c.beginPath(); c.ellipse(0, bob, 36, 10, 0, 0, TAU); c.stroke();
      noShade(c);
      c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 2;
      c.beginPath(); c.ellipse(0, bob - 1.5, 36, 10, 0, Math.PI * 1.1, Math.PI * 1.7); c.stroke();
    });
  }, "goldener Ring über dem Kopf");
  add("crown", "Krone", "👑", (c, f) => {
    local(c, f, f.top.x, f.top.y - f.s * 0.02, () => {
      shade(c, 6);
      const g = c.createLinearGradient(0, -52, 0, 0);
      g.addColorStop(0, "#ffe27a"); g.addColorStop(1, "#d99a00");
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(-40, 0); c.lineTo(-44, -44); c.lineTo(-22, -22); c.lineTo(0, -54); c.lineTo(22, -22); c.lineTo(44, -44); c.lineTo(40, 0); c.closePath(); c.fill();
      noShade(c);
      c.fillStyle = "#e0245e"; c.beginPath(); c.arc(0, -16, 6, 0, TAU); c.fill();
      c.fillStyle = "#2a8cff"; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * 24, -10, 4.5, 0, TAU); c.fill(); }
      c.fillStyle = "#fff"; for (const [x, y] of [[-44, -44], [0, -54], [44, -44]]) { c.beginPath(); c.arc(x, y, 4, 0, TAU); c.fill(); }
    });
  }, "goldene Krone");
  add("clownNose", "Clownsnase", "🤡", (c, f) => {
    local(c, f, f.nose.x, f.nose.y, () => {
      shade(c, 6, "rgba(0,0,0,0.3)");
      const g = c.createRadialGradient(-5, -6, 2, 0, 0, 22);
      g.addColorStop(0, "#ff7b7b"); g.addColorStop(1, "#d10f1f");
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 21, 0, TAU); c.fill();
      noShade(c);
      c.fillStyle = "rgba(255,255,255,0.55)"; c.beginPath(); c.ellipse(-7, -8, 6, 4, -0.6, 0, TAU); c.fill();
    });
  }, "rote Clownsnase");
  add("clownWig", "Clownsperücke", "🌈", (c, f) => {
    const colors = ["#ff3b3b", "#ff9b00", "#ffd23a", "#2fd05a", "#2a8cff", "#a24bf0"];
    for (const sx of [-1, 1]) {
      local(c, f, f.top.x + sx * f.s * 0.42 * Math.cos(f.roll), f.top.y + sx * f.s * 0.42 * Math.sin(f.roll) + f.s * 0.12, () => {
        for (let i = 0; i < 5; i += 1) { c.fillStyle = colors[(i + (sx > 0 ? 2 : 0)) % colors.length]; c.beginPath(); c.arc(sx * (i % 2) * 14, i * 17 - 18, 21, 0, TAU); c.fill(); }
      });
    }
    local(c, f, f.top.x, f.top.y - f.s * 0.05, () => { for (let i = -2; i <= 2; i += 1) { c.fillStyle = colors[(i + 2) % colors.length]; c.beginPath(); c.arc(i * 17, -Math.abs(i) * 5 - 8, 19, 0, TAU); c.fill(); } });
  }, "bunte Perücke");
  add("mustache", "Schnurrbart", "🥸", (c, f) => {
    local(c, f, f.nose.x, (f.nose.y + f.mouth.y) / 2 - f.s * 0.01, () => {
      c.fillStyle = "#2b1a10";
      shade(c, 3);
      for (const sx of [-1, 1]) {
        c.save(); c.scale(sx, 1);
        c.beginPath(); c.moveTo(0, -6); c.bezierCurveTo(14, -16, 36, -8, 46, 6); c.bezierCurveTo(48, 12, 42, 14, 38, 9); c.bezierCurveTo(30, 2, 14, 6, 0, 8); c.closePath(); c.fill();
        c.restore();
      }
    });
  }, "großer Schnurrbart");
  add("beard", "Vollbart", "🧔", (c, f) => {
    const g = f.scratch();
    const jaw = [234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454].map((i) => f.p(i));
    const grow = f.s * 0.08;
    const gradient = g.createLinearGradient(0, f.mouth.y, 0, f.chin.y + grow * 3);
    gradient.addColorStop(0, "#4a2d18");
    gradient.addColorStop(1, "#2a190d");
    g.fillStyle = gradient;
    g.beginPath();
    jaw.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.lineTo(f.p(454).x, f.mouth.y - f.s * 0.05);
    g.lineTo(f.p(291).x, f.p(291).y - f.s * 0.04); g.lineTo(f.p(0).x, f.p(0).y - f.s * 0.07); g.lineTo(f.p(61).x, f.p(61).y - f.s * 0.04);
    g.lineTo(f.p(234).x, f.mouth.y - f.s * 0.05);
    g.closePath();
    g.fill();
    g.save();
    g.translate(f.chin.x, f.chin.y);
    g.rotate(f.roll);
    g.beginPath(); g.ellipse(0, grow * 0.6, f.s * 0.3, grow * 2.4, 0, 0, TAU); g.fill();
    g.restore();
    g.globalCompositeOperation = "destination-out";
    poly(g, LIPS_OUTER.map((i) => f.p(i)));
    g.fill();
    g.globalCompositeOperation = "source-over";
    c.drawImage(g.canvas, 0, 0);
  }, "dunkler Vollbart");
  add("blush", "Rote Wangen", "😊", (c, f) => {
    for (const side of [f.A, f.B]) {
      const p = f.p(side.cheekC);
      const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, f.s * 0.17);
      g.addColorStop(0, "rgba(255,70,120,0.55)"); g.addColorStop(1, "rgba(255,70,120,0)");
      c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, f.s * 0.17, 0, TAU); c.fill();
    }
  }, "rosa Wangen");
  add("freckles", "Sommersprossen", "🌞", (c, f) => {
    c.fillStyle = "rgba(140,80,40,0.55)";
    const seed = [[-0.5, 0.0], [-0.2, -0.1], [-0.35, 0.12], [-0.12, 0.1], [-0.45, -0.12], [-0.28, 0.02]];
    for (const side of [-1, 1]) for (const [x, y] of seed) { local(c, f, f.nose.x, f.nose.y, () => { c.beginPath(); c.arc(side * -x * 100 * 0.95, y * 100 * 0.7 + 4, 2.3, 0, TAU); c.fill(); }); }
  }, "Sommersprossen");
  add("bigTeeth", "Große Zähne", "😁", (c, f) => {
    const w = f.mouth.w / f.u;
    local(c, f, f.mouth.x, f.mouth.y - f.mouth.open * 0.0, () => {
      const upperY = -f.mouth.open * f.s * 0.0 / f.u - 3;
      c.save();
      shade(c, 4, "rgba(0,0,0,0.3)", 2);
      const tw = w * 0.7, th = 20 + w * 0.17 + f.mouth.open * 6;
      c.fillStyle = "#fffdf6";
      c.strokeStyle = "#c9c4b5";
      c.lineWidth = 1.6;
      rr(c, -tw / 2, upperY, tw, th, 9);
      c.fill(); c.stroke();
      noShade(c);
      c.beginPath(); c.moveTo(0, upperY + 3); c.lineTo(0, upperY + th - 2); c.stroke();
      for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * tw * 0.25, upperY + 4); c.lineTo(sx * tw * 0.25, upperY + th * 0.7); c.stroke(); }
      c.restore();
    });
  }, "riesige Zähne am Mund");
  add("buckTeeth", "Hasenzähne", "🐰", (c, f) => {
    local(c, f, f.mouth.x, f.mouth.y, () => {
      shade(c, 3, "rgba(0,0,0,0.3)", 2);
      c.fillStyle = "#fffdf6"; c.strokeStyle = "#c9c4b5"; c.lineWidth = 1.5;
      for (const sx of [-1, 1]) { rr(c, sx > 0 ? 0.5 : -17.5, -2, 17, 30 + f.mouth.open * 6, 5); c.fill(); c.stroke(); }
    });
  }, "zwei große Vorderzähne");
  add("tongue", "Zunge raus", "😛", (c, f) => {
    const o = clamp((f.mouth.open - 0.15) / 0.5, 0, 1);
    if (o <= 0.02) return;
    local(c, f, f.mouth.x, f.mouth.y + f.mouth.h * 0.35, () => {
      const wag = Math.sin(f.t * 7) * 3;
      const len = 14 + o * 38;
      const g = c.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, "#ff6f91"); g.addColorStop(1, "#e0386a");
      c.fillStyle = g;
      c.beginPath(); c.moveTo(-16, 0); c.quadraticCurveTo(-18 + wag, len * 0.9, wag * 0.5, len + 6); c.quadraticCurveTo(18 + wag, len * 0.9, 16, 0); c.closePath(); c.fill();
      c.strokeStyle = "rgba(160,20,60,0.5)"; c.lineWidth = 2; c.beginPath(); c.moveTo(wag * 0.2, 4); c.lineTo(wag * 0.5, len * 0.7); c.stroke();
    });
  }, "Zunge, wenn du den Mund aufmachst");
  add("drool", "Sabber", "🤤", (c, f) => {
    local(c, f, f.mouth.x - f.mouth.w * 0.28, f.mouth.y + f.mouth.h * 0.55, () => {
      const len = 16 + (Math.sin(f.t * 2.3) + 1) * 14;
      c.fillStyle = "rgba(190,230,255,0.75)";
      c.beginPath(); c.moveTo(-3, 0); c.lineTo(3, 0); c.lineTo(2, len); c.arc(0, len + 3, 4.5, 0, Math.PI); c.lineTo(-2, len); c.closePath(); c.fill();
    });
  }, "Sabberfaden");
  add("crossEyes", "Schielen", "🥴", (c, f) => {
    for (const eye of [f.eyeA, f.eyeB]) {
      const r = f.s * 0.095;
      c.save();
      c.shadowColor = "rgba(0,0,0,0.3)"; c.shadowBlur = 4;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(eye.x, eye.y, r, 0, TAU); c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = "rgba(0,0,0,0.5)"; c.lineWidth = 1.5; c.stroke();
      const toward = eye === f.eyeA ? 1 : -1;
      const px = eye.x + Math.cos(f.roll) * toward * r * 0.5, py = eye.y + Math.sin(f.roll) * toward * r * 0.5;
      c.fillStyle = "#1a1a1a"; c.beginPath(); c.arc(px, py, r * 0.45, 0, TAU); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(px - r * 0.12, py - r * 0.14, r * 0.13, 0, TAU); c.fill();
      c.restore();
    }
  }, "schielende Augen");
  add("googlyEyes", "Wackelaugen", "🤪", (c, f) => {
    f.fx.googly = f.fx.googly || { x: 0, y: 0, vx: 0, vy: 0 };
    const g = f.fx.googly;
    const ax = Math.sin(f.roll) * 90 + (f.head.vx || 0) * 0.02, ay = 140 + (f.head.vy || 0) * 0.02;
    g.vx = (g.vx + ax * f.dt) * 0.93; g.vy = (g.vy + ay * f.dt) * 0.93;
    g.x = clamp(g.x + g.vx * f.dt, -1, 1); g.y = clamp(g.y + g.vy * f.dt, -1, 1);
    if (Math.abs(g.x) >= 1) g.vx *= -0.5;
    if (Math.abs(g.y) >= 1) g.vy *= -0.5;
    for (const eye of [f.eyeA, f.eyeB]) {
      const r = f.s * 0.13;
      c.save();
      c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 6; c.shadowOffsetY = 2;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(eye.x, eye.y, r, 0, TAU); c.fill();
      c.shadowColor = "transparent";
      c.strokeStyle = "#222"; c.lineWidth = 2.5; c.stroke();
      c.fillStyle = "#111"; c.beginPath(); c.arc(eye.x + g.x * r * 0.42, eye.y + g.y * r * 0.42, r * 0.5, 0, TAU); c.fill();
      c.restore();
    }
  }, "große Wackelaugen");
  add("bigEyes", "Riesenaugen", "👀", (c, f) => {
    for (const eye of [f.eyeA, f.eyeB]) magnify(c, f, eye.x, eye.y, f.s * 0.17, 1.9);
  }, "stark vergrößerte Augen");
  add("bigHead", "Dicker Kopf", "🎈", (c, f) => {
    magnify(c, f, f.mid.x * 0.5 + f.nose.x * 0.5, (f.eyeA.y + f.chin.y) / 2, f.s * 0.62, 1.3, false);
  }, "aufgeblasener Kopf");
  add("bigNose", "Riesennase", "👃", (c, f) => { magnify(c, f, f.nose.x, f.nose.y, f.s * 0.2, 1.9); }, "dicke Nase");
  add("bigMouth", "Riesenmund", "👄", (c, f) => { magnify(c, f, f.mouth.x, f.mouth.y, f.s * 0.28, 1.7); }, "großer Mund");
  add("hearts", "Herzen", "💕", (c, f) => {
    const p = f.fx.hearts = f.fx.hearts || [];
    if (f.smile > 0.35 && Math.random() < 0.28 + f.smile * 0.2) p.push({ x: f.top.x + (Math.random() - 0.5) * f.s * 0.9, y: f.top.y, vy: -(40 + Math.random() * 60), r: 10 + Math.random() * 14, life: 1, hue: 340 + Math.random() * 20 });
    for (let i = p.length - 1; i >= 0; i -= 1) {
      const h = p[i];
      h.y += h.vy * f.dt; h.x += Math.sin(f.t * 3 + i) * 12 * f.dt; h.life -= f.dt * 0.55;
      if (h.life <= 0) { p.splice(i, 1); continue; }
      c.globalAlpha = Math.min(1, h.life * 1.6);
      c.fillStyle = `hsl(${h.hue} 90% 60%)`;
      heart(c, h.x, h.y, h.r * 2); c.fill();
    }
    c.globalAlpha = 1;
  }, "Herzchen steigen auf, wenn du lächelst");
  add("sparkles", "Funkeln", "✨", (c, f) => {
    const n = 9;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * TAU + f.t * 0.8;
      const rad = f.s * (0.72 + 0.1 * Math.sin(f.t * 2 + i));
      const x = f.mid.x + Math.cos(a) * rad, y = (f.eyeA.y + f.chin.y) / 2 + Math.sin(a) * rad * 0.9;
      const k = 0.55 + 0.45 * Math.sin(f.t * 4 + i * 1.7);
      c.fillStyle = `rgba(255,236,150,${0.5 + 0.5 * k})`;
      star(c, x, y, f.s * 0.05 * (0.6 + k), 4, 0.25, f.t);
      c.fill();
    }
  }, "funkelnde Sterne um den Kopf");
  add("tears", "Tränen", "😭", (c, f) => {
    for (const eye of [f.eyeA, f.eyeB]) {
      for (let i = 0; i < 3; i += 1) {
        const k = ((f.t * 0.9 + i / 3 + (eye === f.eyeA ? 0 : 0.17)) % 1);
        const x = eye.x + (eye === f.eyeA ? -1 : 1) * f.s * 0.02, y = eye.y + f.s * 0.05 + k * f.s * 0.45;
        c.globalAlpha = 1 - k * k;
        const g = c.createLinearGradient(x, y - 8, x, y + 8);
        g.addColorStop(0, "#9fd8ff"); g.addColorStop(1, "#2a8cff");
        c.fillStyle = g;
        c.beginPath(); c.moveTo(x, y - f.s * 0.05); c.quadraticCurveTo(x + f.s * 0.04, y + f.s * 0.01, x, y + f.s * 0.035); c.quadraticCurveTo(x - f.s * 0.04, y + f.s * 0.01, x, y - f.s * 0.05); c.fill();
      }
    }
    c.globalAlpha = 1;
  }, "Tränen laufen die Wangen runter");
  add("fireEyes", "Feuer-Augen", "🔥", (c, f) => {
    for (const eye of [f.eyeA, f.eyeB]) {
      for (let i = 0; i < 4; i += 1) {
        const wob = Math.sin(f.t * 12 + i * 2 + eye.x) * 0.25;
        const h = f.s * (0.16 + 0.07 * Math.sin(f.t * 9 + i * 3));
        local(c, f, eye.x + (i - 1.5) * f.s * 0.028, eye.y - f.s * 0.03, () => {
          c.rotate(wob);
          const g = c.createLinearGradient(0, 0, 0, -h / f.u);
          g.addColorStop(0, "#ffe27a"); g.addColorStop(0.5, "#ff8a1f"); g.addColorStop(1, "rgba(255,40,0,0)");
          c.fillStyle = g;
          c.beginPath(); c.moveTo(-5, 0); c.quadraticCurveTo(-7, -h / f.u * 0.6, 0, -h / f.u); c.quadraticCurveTo(7, -h / f.u * 0.6, 5, 0); c.closePath(); c.fill();
        });
      }
    }
  }, "brennende Augen");
  add("propellerHat", "Propellermütze", "🧢", (c, f) => {
    local(c, f, f.top.x, f.top.y + f.s * 0.02, () => {
      shade(c, 5);
      const panels = ["#ff3b3b", "#ffd23a", "#2a8cff", "#2fd05a"];
      for (let i = 0; i < 4; i += 1) {
        c.fillStyle = panels[i];
        c.beginPath(); c.moveTo(0, 2); c.arc(0, 2, 44, Math.PI + (i * Math.PI) / 4, Math.PI + ((i + 1) * Math.PI) / 4); c.closePath(); c.fill();
      }
      noShade(c);
      c.fillStyle = "#222"; rr(c, -46, -2, 92, 7, 3.5); c.fill();
      c.fillStyle = "#555"; c.fillRect(-2, -62, 4, 20);
      c.save(); c.translate(0, -62); c.scale(Math.cos(f.t * 18), 1);
      c.fillStyle = "#e0245e"; c.beginPath(); c.ellipse(-22, 0, 24, 5, 0, 0, TAU); c.fill();
      c.fillStyle = "#2a8cff"; c.beginPath(); c.ellipse(22, 0, 24, 5, 0, 0, TAU); c.fill();
      c.restore();
      c.fillStyle = "#222"; c.beginPath(); c.arc(0, -62, 5, 0, TAU); c.fill();
    });
  }, "bunte Mütze mit Propeller");
  add("dunceHat", "Narrenkappe", "🎓", (c, f) => {
    local(c, f, f.top.x, f.top.y + f.s * 0.03, () => {
      shade(c, 5);
      const g = c.createLinearGradient(-30, 0, 30, -80);
      g.addColorStop(0, "#f5e9c4"); g.addColorStop(1, "#e4cf92");
      c.fillStyle = g;
      c.beginPath(); c.moveTo(-34, 0); c.lineTo(0, -92); c.lineTo(34, 0); c.closePath(); c.fill();
      noShade(c);
      c.fillStyle = "#e0245e"; c.font = "800 34px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("D", 0, -34);
      c.fillStyle = "#e0245e"; c.beginPath(); c.arc(0, -92, 6, 0, TAU); c.fill();
    });
  }, "spitze Mütze mit einem D");
  add("balaclava", "Sturmhaube", "🥷", (c, f) => {
    const g = f.scratch();
    const cx = f.mid.x * 0.5 + f.nose.x * 0.5, cy = (f.top.y + f.chin.y) / 2;
    const rx = f.s * 0.66, ry = (f.chin.y - f.top.y) * 0.78;
    g.save();
    g.translate(cx, cy);
    g.rotate(f.roll);
    g.fillStyle = "#121212";
    g.beginPath();                                                         // the hood: the head ...
    g.ellipse(0, -ry * 0.12, rx, ry * 0.9, 0, 0, TAU);
    g.fill();
    g.beginPath();                                                         // ... and the neck
    g.moveTo(-rx * 0.8, ry * 0.5); g.lineTo(-rx * 1.1, ry * 1.6); g.lineTo(rx * 1.1, ry * 1.6); g.lineTo(rx * 0.8, ry * 0.5);
    g.closePath();
    g.fill();
    g.restore();
    // the knit
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.strokeStyle = "rgba(255,255,255,0.07)";
    g.lineWidth = 1;
    const step = Math.max(5, f.s * 0.035);
    for (let x = cx - rx * 1.3; x < cx + rx * 1.3; x += step) { g.beginPath(); g.moveTo(x, cy - ry * 1.2); g.lineTo(x + step * 0.4, cy + ry * 1.8); g.stroke(); }
    for (let y = cy - ry; y < cy + ry * 1.8; y += step * 1.4) { g.beginPath(); g.moveTo(cx - rx * 1.3, y); g.lineTo(cx + rx * 1.3, y); g.stroke(); }
    g.restore();
    // the holes for the eyes and the mouth, cut with the real shapes of the face (a little bigger than the eye)
    g.globalCompositeOperation = "destination-out";
    for (const pts of [EYE_A, EYE_B]) {
      const eye = pts.map((i) => f.p(i));
      const mid = eye.reduce((a, p) => ({ x: a.x + p.x / eye.length, y: a.y + p.y / eye.length }), { x: 0, y: 0 });
      poly(g, eye.map((p) => ({ x: mid.x + (p.x - mid.x) * 1.75, y: mid.y + (p.y - mid.y) * 2.4 })));
      g.fill();
    }
    const lips = LIPS_OUTER.map((i) => f.p(i));
    const mm = lips.reduce((a, p) => ({ x: a.x + p.x / lips.length, y: a.y + p.y / lips.length }), { x: 0, y: 0 });
    poly(g, lips.map((p) => ({ x: mm.x + (p.x - mm.x) * 1.55, y: mm.y + (p.y - mm.y) * 1.9 })));
    g.fill();
    g.globalCompositeOperation = "source-over";
    c.drawImage(g.canvas, 0, 0);
  }, "schwarze Strickmaske mit Löchern für Augen und Mund");
  add("pirate", "Pirat", "🏴‍☠️", (c, f) => {
    local(c, f, f.eyeB.x, f.eyeB.y, () => {
      c.fillStyle = "#111"; c.beginPath(); c.ellipse(0, 0, 22, 18, -0.2, 0, TAU); c.fill();
    });
    c.save();
    c.strokeStyle = "#111"; c.lineWidth = Math.max(2, f.s * 0.018); c.beginPath();
    const a = f.p(f.mirror ? SIDE_B.cheek : SIDE_A.cheek); const b = f.eyeB;
    c.moveTo(b.x, b.y); c.lineTo(f.top.x, f.top.y + f.s * 0.12); c.moveTo(b.x, b.y); c.lineTo(a.x + (b.x - a.x) * 0.9, a.y); c.stroke();
    c.restore();
    local(c, f, f.top.x, f.top.y + f.s * 0.08, () => {
      c.fillStyle = "#c01c28"; c.beginPath(); c.moveTo(-50, 0); c.quadraticCurveTo(0, -46, 50, 0); c.lineTo(46, 12); c.quadraticCurveTo(0, -20, -46, 12); c.closePath(); c.fill();
      c.fillStyle = "#fff"; for (const x of [-26, -6, 14, 32]) { c.beginPath(); c.arc(x, -9 - Math.abs(x) * 0.08, 2.4, 0, TAU); c.fill(); }
    });
  }, "Augenklappe und rotes Kopftuch");
  add("robot", "Roboter", "🤖", (c, f) => {
    for (const side of [f.A, f.B]) {
      const p = f.p(side.cheekC);
      local(c, f, p.x, p.y, () => {
        const g = c.createLinearGradient(-14, -14, 14, 14);
        g.addColorStop(0, "#d9dde2"); g.addColorStop(1, "#7d868f");
        c.fillStyle = g; rr(c, -15, -13, 30, 26, 5); c.fill();
        c.strokeStyle = "#4b535b"; c.lineWidth = 2; c.stroke();
        c.fillStyle = "#4b535b"; for (const [x, y] of [[-9, -7], [9, -7], [-9, 7], [9, 7]]) { c.beginPath(); c.arc(x, y, 1.8, 0, TAU); c.fill(); }
      });
    }
    local(c, f, f.top.x, f.top.y - f.s * 0.04, () => {
      c.strokeStyle = "#8a939c"; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 8); c.lineTo(0, -38); c.stroke();
      c.fillStyle = Math.sin(f.t * 5) > 0 ? "#ff3b3b" : "#7a1b1b"; c.beginPath(); c.arc(0, -42, 8, 0, TAU); c.fill();
    });
    for (const eye of [f.eyeA, f.eyeB]) {
      c.fillStyle = "rgba(60,255,200,0.75)"; c.shadowColor = "#3cffc8"; c.shadowBlur = 12;
      rr(c, eye.x - f.s * 0.08, eye.y - f.s * 0.035, f.s * 0.16, f.s * 0.07, 4); c.fill();
      c.shadowBlur = 0;
    }
  }, "Metallplatten, Antenne und leuchtende Augen");
  add("rainbow", "Regenbogen", "🌈", (c, f) => {
    const o = clamp((f.mouth.open - 0.18) / 0.4, 0, 1);
    if (o <= 0.03) return;
    const colors = ["#ff3b3b", "#ff9b00", "#ffd23a", "#2fd05a", "#2a8cff", "#a24bf0"];
    const len = f.H * 0.5 * o;
    c.save();
    c.translate(f.mouth.x, f.mouth.y + f.mouth.h * 0.4);
    c.rotate(f.roll);
    colors.forEach((col, i) => {
      c.strokeStyle = col; c.lineWidth = f.s * 0.07; c.lineCap = "round";
      const off = (i - 2.5) * f.s * 0.065;
      c.beginPath(); c.moveTo(off, 0);
      c.bezierCurveTo(off + Math.sin(f.t * 3) * 14, len * 0.35, off - Math.sin(f.t * 3) * 14, len * 0.7, off, len);
      c.stroke();
    });
    c.restore();
  }, "ein Regenbogen kommt aus deinem Mund");
  add("swirlEyes", "Hypnose", "😵‍💫", (c, f) => {
    for (const eye of [f.eyeA, f.eyeB]) {
      const r = f.s * 0.1;
      c.save();
      c.translate(eye.x, eye.y);
      c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
      c.strokeStyle = "#7a2cf0"; c.lineWidth = Math.max(2, r * 0.18); c.lineCap = "round";
      c.beginPath();
      for (let a = 0; a < 18; a += 0.2) { const rad = (a / 18) * r * 0.86; const ang = a + f.t * 6; c.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad); }
      c.stroke();
      c.restore();
    }
  }, "kreisende Spiralen in den Augen");
  add("moneyEyes", "Geld-Augen", "🤑", (c, f) => {
    for (const eye of [f.eyeA, f.eyeB]) {
      const r = f.s * 0.1;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(eye.x, eye.y, r, 0, TAU); c.fill();
      c.fillStyle = "#1c9a3a"; c.font = `800 ${Math.round(r * 1.8)}px system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("$", eye.x, eye.y + r * 0.08);
    }
  }, "Dollarzeichen als Augen");
  add("heartEyes", "Herz-Augen", "😍", (c, f) => {
    for (const eye of [f.eyeA, f.eyeB]) {
      const pulse = 1 + Math.sin(f.t * 8) * 0.12;
      c.fillStyle = "#ff2f6b"; shade(c, 6, "rgba(120,0,40,0.4)");
      heart(c, eye.x, eye.y + f.s * 0.01, f.s * 0.24 * pulse); c.fill();
      noShade(c);
    }
  }, "pochende Herzen als Augen");
  add("monocle", "Monokel", "🧐", (c, f) => {
    const eye = f.eyeB;
    c.save();
    c.strokeStyle = "#d9a520"; c.lineWidth = Math.max(2, f.s * 0.02);
    c.fillStyle = "rgba(190,225,255,0.18)";
    c.beginPath(); c.arc(eye.x, eye.y, f.s * 0.13, 0, TAU); c.fill(); c.stroke();
    c.lineWidth = 1.6; c.beginPath(); c.moveTo(eye.x + f.s * 0.09, eye.y + f.s * 0.09);
    c.quadraticCurveTo(eye.x + f.s * 0.2, eye.y + f.s * 0.3, eye.x + f.s * 0.12, eye.y + f.s * 0.55); c.stroke();
    c.restore();
  }, "Monokel mit Kette");
  add("topHat", "Zylinder", "🎩", (c, f) => {
    local(c, f, f.top.x, f.top.y + f.s * 0.04, () => {
      shade(c, 6);
      c.fillStyle = "#151515"; rr(c, -26, -64, 52, 66, 6); c.fill();
      c.fillStyle = "#1d1d1d"; c.beginPath(); c.ellipse(0, 2, 50, 10, 0, 0, TAU); c.fill();
      noShade(c);
      c.fillStyle = "#b3202e"; c.fillRect(-26, -22, 52, 10);
    });
  }, "schwarzer Zylinder");
  add("zombie", "Zombie", "🧟", (c, f) => {
    const oval = OVAL.map((i) => f.p(i));
    c.save();
    c.fillStyle = "rgba(110,170,90,0.42)";
    poly(c, oval); c.fill();
    c.restore();
    for (const eye of [f.eyeA, f.eyeB]) {
      const g = c.createRadialGradient(eye.x, eye.y + f.s * 0.03, 0, eye.x, eye.y + f.s * 0.03, f.s * 0.13);
      g.addColorStop(0, "rgba(40,20,60,0.6)"); g.addColorStop(1, "rgba(40,20,60,0)");
      c.fillStyle = g; c.beginPath(); c.arc(eye.x, eye.y + f.s * 0.03, f.s * 0.13, 0, TAU); c.fill();
    }
    const m1 = f.p(61), m2 = f.p(291);
    c.strokeStyle = "rgba(120,20,30,0.8)"; c.lineWidth = Math.max(2, f.s * 0.015);
    c.beginPath(); c.moveTo(f.p(70).x, f.p(70).y); c.lineTo(f.p(105).x, f.p(105).y + f.s * 0.05); c.stroke();
    for (let i = 0; i < 4; i += 1) { c.beginPath(); c.moveTo(f.p(70).x - f.s * 0.02, f.p(70).y + f.s * (0.01 + i * 0.02)); c.lineTo(f.p(70).x + f.s * 0.05, f.p(70).y + f.s * (0.03 + i * 0.02)); c.stroke(); }
    void m1; void m2;
  }, "grüne Haut, dunkle Augenringe und Narben");
  add("confetti", "Konfetti", "🎉", (c, f) => {
    const p = f.fx.confetti = f.fx.confetti || [];
    while (p.length < 70) p.push({ x: Math.random() * f.W, y: Math.random() * f.H - f.H, vy: 80 + Math.random() * 140, vx: (Math.random() - 0.5) * 40, r: 3 + Math.random() * 5, hue: Math.random() * 360, rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 8 });
    for (const q of p) {
      q.y += q.vy * f.dt; q.x += q.vx * f.dt; q.rot += q.vr * f.dt;
      if (q.y > f.H + 10) { q.y = -10; q.x = Math.random() * f.W; }
      c.save(); c.translate(q.x, q.y); c.rotate(q.rot); c.fillStyle = `hsl(${q.hue} 90% 58%)`; c.fillRect(-q.r, -q.r * 0.5, q.r * 2, q.r); c.restore();
    }
  }, "Konfetti fällt vom Himmel");
  add("snow", "Schnee", "❄️", (c, f) => {
    const p = f.fx.snow = f.fx.snow || [];
    while (p.length < 60) p.push({ x: Math.random() * f.W, y: Math.random() * f.H, vy: 30 + Math.random() * 60, r: 1.5 + Math.random() * 3.5, ph: Math.random() * TAU });
    c.fillStyle = "rgba(255,255,255,0.9)";
    for (const q of p) {
      q.y += q.vy * f.dt; q.x += Math.sin(f.t + q.ph) * 14 * f.dt;
      if (q.y > f.H + 6) { q.y = -6; q.x = Math.random() * f.W; }
      c.beginPath(); c.arc(q.x, q.y, q.r, 0, TAU); c.fill();
    }
  }, "es schneit");
  add("angry", "Wütend", "😠", (c, f) => {
    for (const sx of [-1, 1]) {
      const p = f.p((sx > 0) === f.mirror ? SIDE_A.brow : SIDE_B.brow);
      local(c, f, p.x, p.y - f.s * 0.01, () => {
        c.fillStyle = "#222"; c.save(); c.rotate(sx * -0.0); c.rotate(sx * 0.42); rr(c, -22, -4, 44, 9, 4); c.fill(); c.restore();
      });
    }
    const t = (Math.sin(f.t * 14) + 1) / 2;
    c.fillStyle = `rgba(255,60,60,${0.12 + 0.1 * t})`;
    poly(c, OVAL.map((i) => f.p(i))); c.fill();
  }, "dicke Augenbrauen und ein roter Kopf");
  add("tophatCane", "Gentleman", "🎩", (c, f) => { FX.topHat.draw(c, f); FX.mustache.draw(c, f); FX.monocle.draw(c, f); }, "Zylinder, Schnurrbart und Monokel");

  // ------------------------------------------------------------------------------------------------------------------ colour filters of the whole picture (CSS filter for the camera picture)
  const FILTERS = {
    none: { label: "Normal", css: "" },
    warm: { label: "Warm", css: "saturate(1.25) sepia(0.22) contrast(1.05)" },
    cool: { label: "Kühl", css: "saturate(1.1) hue-rotate(-12deg) brightness(1.03)" },
    noir: { label: "Schwarzweiß", css: "grayscale(1) contrast(1.2)" },
    vivid: { label: "Knallig", css: "saturate(1.9) contrast(1.12)" },
    retro: { label: "Retro", css: "sepia(0.55) saturate(1.3) contrast(0.95) hue-rotate(-8deg)" },
    dream: { label: "Traum", css: "saturate(1.4) brightness(1.1) contrast(0.92) blur(0.4px)" },
    night: { label: "Nacht", css: "brightness(0.82) contrast(1.15) hue-rotate(190deg) saturate(1.3)" },
  };

  // ------------------------------------------------------------------------------------------------------------------ the lens in the camera
  /* new FaceLens({video, canvas, mirror, recipe}): looks at the camera picture, draws the effects of the recipe on the canvas. start() / stop(); setRecipe(); status()
     is "loading", "ready", "noface" or "error". */
  class FaceLens {
    constructor({ video, canvas, mirror, recipe, onStatus }) {
      this.video = video;
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.mirror = !!mirror;
      this.recipe = recipe || { fx: [], filter: "none" };
      this.onStatus = onStatus || (() => {});
      this.state = "loading";
      this.raf = 0;
      this.dead = false;
      this.xs = new Float32Array(478);
      this.ys = new Float32Array(478);
      this.have = false;
      this.fx = {};
      this.last = 0;
      this.lastVideoTime = -1;
      this.lostAt = 0;
      this.t0 = performance.now();
      this.blend = {};
      this.head = { x: 0, y: 0, vx: 0, vy: 0 };
      this.layer = null;                                 // the 3D layer of pl-ar.js (made when the recipe has an effect that belongs to it)
      this.glCanvas = null;
      this.arPoints = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
      this.matrix = null;
      this.tick = this.tick.bind(this);
    }
    setStatus(state) { if (state !== this.state) { this.state = state; this.onStatus(state); } }
    setRecipe(recipe) { this.recipe = recipe || { fx: [], filter: "none" }; this.fx = {}; this.syncLayer(); }
    setMirror(on) { this.mirror = !!on; if (this.layer) this.layer.setMirror(this.mirror); }
    /* The 3D layer exists while the recipe has an effect of pl-ar.js (it draws the picture of the camera itself when something has to be warped). */
    syncLayer() {
      const AR = window.PulseAR;
      const needs = !!(AR && (this.recipe.fx || []).some((id) => AR.has(id)));
      if (needs && !this.layer) {
        this.glCanvas = document.createElement("canvas");
        this.glCanvas.className = this.canvas.className + " gl";
        this.glCanvas.setAttribute("aria-hidden", "true");
        this.canvas.parentNode.insertBefore(this.glCanvas, this.canvas);
        this.layer = new AR.Layer({ video: this.video, canvas: this.glCanvas, mirror: this.mirror });
      }
      if (this.layer) {
        if (needs) this.layer.setRecipe(this.recipe);
        else { this.layer.destroy(); this.glCanvas.remove(); this.layer = null; this.glCanvas = null; }
      }
    }
    start() {
      this.syncLayer();
      load().then((landmarker) => { this.landmarker = landmarker; this.setStatus("noface"); }).catch((error) => { this.error = error; this.setStatus("error"); });
      this.raf = requestAnimationFrame(this.tick);
    }
    stop() {
      this.dead = true;
      cancelAnimationFrame(this.raf);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (this.layer) { this.layer.destroy(); this.glCanvas.remove(); this.layer = null; this.glCanvas = null; }
    }
    size() {
      const box = this.canvas.getBoundingClientRect();
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.round(box.width * dpr)), h = Math.max(2, Math.round(box.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      return { w, h };
    }
    detect(now) {
      const v = this.video;
      if (!this.landmarker || !v || v.readyState < 2 || !v.videoWidth || v.currentTime === this.lastVideoTime) return;
      this.lastVideoTime = v.currentTime;
      let result = null;
      try { result = this.landmarker.detectForVideo(v, now); } catch (error) { result = null; }
      const face = result && result.faceLandmarks && result.faceLandmarks[0];
      if (!face) { if (this.have && now - this.lostAt > 400) this.have = false; if (!this.lostAt) this.lostAt = now; return; }
      this.lostAt = 0;
      const { w, h } = this.size();
      const vw = v.videoWidth, vh = v.videoHeight;
      const smoothAr = this.have ? 0.6 : 1;
      for (let i = 0; i < Math.min(478, face.length); i += 1) {                            // the points for the 3D layer (in 0..1 of the camera picture)
        const q = this.arPoints[i];
        q.x = lerp(q.x, face[i].x, smoothAr); q.y = lerp(q.y, face[i].y, smoothAr); q.z = lerp(q.z, face[i].z, smoothAr);
      }
      const pose = result.facialTransformationMatrixes && result.facialTransformationMatrixes[0];
      this.matrix = pose ? pose.data : this.matrix;
      const k = Math.max(w / vw, h / vh);
      const ox = (w - vw * k) / 2, oy = (h - vh * k) / 2;
      this.map = { W: w, H: h, k, ox, oy };
      const smooth = this.have ? 0.62 : 1;
      for (let i = 0; i < Math.min(478, face.length); i += 1) {
        let x = face[i].x * vw * k + ox;
        const y = face[i].y * vh * k + oy;
        if (this.mirror) x = w - x;
        this.xs[i] = this.have ? lerp(this.xs[i], x, smooth) : x;
        this.ys[i] = this.have ? lerp(this.ys[i], y, smooth) : y;
      }
      this.have = true;
      const shapes = result.faceBlendshapes && result.faceBlendshapes[0] && result.faceBlendshapes[0].categories;
      if (shapes) for (const s of shapes) this.blend[s.categoryName] = s.score;
    }
    /* the face of this moment, with everything the effects need */
    frame(dt, t) {
      const m = this.map;
      const xs = this.xs, ys = this.ys;
      const p = (i) => ({ x: xs[i], y: ys[i] });
      const A = this.mirror ? SIDE_B : SIDE_A;           // screen left
      const B = this.mirror ? SIDE_A : SIDE_B;           // screen right
      const mid2 = (a, b) => ({ x: (xs[a] + xs[b]) / 2, y: (ys[a] + ys[b]) / 2 });
      const eyeA = mid2(A.eyeOuter, A.eyeInner), eyeB = mid2(B.eyeOuter, B.eyeInner);
      const eyeDist = Math.hypot(eyeB.x - eyeA.x, eyeB.y - eyeA.y);
      const cheekA = p(A.cheek), cheekB = p(B.cheek);
      const s = Math.hypot(cheekB.x - cheekA.x, cheekB.y - cheekA.y);
      const roll = Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x);
      const mouthL = p(A.mouth), mouthR = p(B.mouth);
      const mouthW = Math.hypot(mouthR.x - mouthL.x, mouthR.y - mouthL.y);
      const gap = Math.hypot(xs[14] - xs[13], ys[14] - ys[13]);
      const jaw = this.blend.jawOpen || 0;
      const open = clamp(Math.max(gap / (s * 0.3), jaw * 1.4), 0, 1);
      const smile = clamp(((this.blend.mouthSmileLeft || 0) + (this.blend.mouthSmileRight || 0)) / 1.2, 0, 1);
      const top = p(10), chin = p(152);
      const up = { x: top.x - chin.x, y: top.y - chin.y };
      const upLen = Math.hypot(up.x, up.y) || 1;
      const headTop = { x: top.x + (up.x / upLen) * s * 0.12, y: top.y + (up.y / upLen) * s * 0.12 };
      const mouth = { x: (mouthL.x + mouthR.x) / 2, y: (ys[13] + ys[14]) / 2, w: mouthW, h: gap, open };
      const nose = p(1);
      const dx = nose.x - this.head.x, dy = nose.y - this.head.y;
      this.head = { x: nose.x, y: nose.y, vx: dt ? dx / dt : 0, vy: dt ? dy / dt : 0 };
      const scratch = () => this.scratch();
      return { scratch, W: m.W, H: m.H, k: m.k, ox: m.ox, oy: m.oy, mirror: this.mirror, video: this.video, dt, t, fx: this.fx, head: this.head, p, A, B, eyeA, eyeB, eyeDist, mid: { x: (eyeA.x + eyeB.x) / 2, y: (eyeA.y + eyeB.y) / 2 },
        cheekA, cheekB, s, u: s / 100, roll, mouth, nose, top: headTop, chin, open, smile, brow: { left: p(A.brow), right: p(B.brow) } };
    }
    /* an empty canvas of the same size to draw a shape with holes on, before it is put on the picture */
    scratch() {
      if (!this.sheet) this.sheet = document.createElement("canvas");
      if (this.sheet.width !== this.canvas.width || this.sheet.height !== this.canvas.height) { this.sheet.width = this.canvas.width; this.sheet.height = this.canvas.height; }
      const g = this.sheet.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, this.sheet.width, this.sheet.height);
      return g;
    }
    tick(now) {
      if (this.dead) return;
      this.raf = requestAnimationFrame(this.tick);
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      const { w, h } = this.size();
      this.detect(now);
      const c = this.ctx;
      c.clearRect(0, 0, w, h);
      const time = (now - this.t0) / 1000;
      if (this.layer) {
        const ok = this.have && this.map;
        this.layer.update({ lm: ok ? this.arPoints : null, matrix: ok ? this.matrix : null, blend: this.blend, dt, t: time });
      }
      if (!this.have || !this.map) return;
      const f = this.frame(dt, time);
      if (this.map.W !== w || this.map.H !== h) return;
      c.save();
      for (const id of this.recipe.fx || []) {
        const fx = FX[id];
        if (!fx || (this.layer && !this.layer.failed && window.PulseAR && window.PulseAR.has(id))) continue;           // (what the 3D layer draws is not drawn here too; without WebGL the flat versions stay)
        try { fx.draw(c, f); } catch (error) { /* a broken effect must not stop the others */ }
        c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; noShade(c);
      }
      c.restore();
      this.setStatus("ready");
    }
  }

  // for the tests (and the server's list): the points a face has (the names) and a face of invented points
  window.PulseFace = {
    effects: FX, filters: FILTERS, FaceLens, load, engine, SIDE_A, SIDE_B, OVAL, LIPS_OUTER, LIPS_INNER, EYE_A, EYE_B,
    describe: () => Object.values(FX).map(({ id, label, emoji, about }) => ({ id, label, emoji, about })),
  };
})();
