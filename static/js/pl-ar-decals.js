/* Nex 3D lenses, the paint (pl-ar-decals.js): pictures painted on the map of the face (see pl-ar.js). `decal(g, d)` paints on a canvas of 1024 x 1024 whose places are the places of the 468
   points of the face: d.at(i) is the place of point i, d.poly(ids, grow) makes a path through points, d.region(test) makes a mask of the triangles of the face whose points pass the test
   (the points are given as {x, y, z} of the canonical face in centimetres: y < -2.5 is the lower face). What is painted sticks to the skin and follows every expression. The knitted
   hood of the balaclava is a `hood`: a piece of knitted cloth around the head, drawn behind the face. */
(function () {
  "use strict";

  const AR = window.PulseAR;
  if (!AR) return;
  const { add } = AR;
  const PI = Math.PI;
  const FACE = () => window.PulseFace;

  const blob = (g, x, y, r, rgb, alpha = 1, sx = 1, sy = 1) => {
    g.save();
    g.translate(x, y);
    g.scale(sx, sy);
    const gradient = g.createRadialGradient(0, 0, 0, 0, 0, r);
    gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gradient;
    g.beginPath(); g.arc(0, 0, r, 0, PI * 2); g.fill();
    g.restore();
  };
  const center = (d, ids) => { const pts = ids.map(d.at); return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length }; };
  const bounds = (d, ids) => { const pts = ids.map(d.at); const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };

  /* a mask (a canvas) of the triangles of the face whose three points pass `test`, softened at the edge */
  function region(d, test, blur = 6) {
    const c = document.createElement("canvas");
    c.width = c.height = d.DECAL;
    const g = c.getContext("2d");
    const { v, f } = d.data;
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    g.lineWidth = 2;
    for (let t = 0; t < f.length; t += 3) {
      const ids = [f[t], f[t + 1], f[t + 2]];
      if (!ids.every((i) => test({ x: v[i * 3], y: v[i * 3 + 1], z: v[i * 3 + 2] }, i))) continue;
      g.beginPath();
      ids.forEach((i, n) => (n ? g.lineTo(d.uvx(i), d.uvy(i)) : g.moveTo(d.uvx(i), d.uvy(i))));
      g.closePath(); g.fill(); g.stroke();
    }
    if (!blur) return c;
    const out = document.createElement("canvas");
    out.width = out.height = d.DECAL;
    const o = out.getContext("2d");
    o.filter = `blur(${blur}px)`;
    o.drawImage(c, 0, 0);
    return out;
  }
  /* the whole skin of the face (a soft mask) without the eyes and the inside of the mouth, for paint that covers the face */
  function skinMask(d, blur = 10) {
    const F = FACE();
    const c = region(d, () => true, 0);
    const g = c.getContext("2d");
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "#000";
    for (const ids of [F.EYE_A, F.EYE_B]) { trace(g, d, ids, 1.22); g.fill(); }
    trace(g, d, F.LIPS_INNER, 1.0); g.fill();
    const out = document.createElement("canvas");
    out.width = out.height = d.DECAL;
    const o = out.getContext("2d");
    o.filter = `blur(${blur}px)`;
    o.drawImage(c, 0, 0);
    return out;
  }
  /* paints `paint(h)` on a scratch picture, keeps only what lies inside the mask, and puts it on g */
  function through(g, d, mask, paint, alpha = 1) {
    const c = document.createElement("canvas");
    c.width = c.height = d.DECAL;
    const h = c.getContext("2d");
    paint(h);
    h.globalCompositeOperation = "destination-in";
    h.drawImage(mask, 0, 0);
    g.save();
    g.globalAlpha = alpha;
    g.drawImage(c, 0, 0);
    g.restore();
  }

  // ------------------------------------------------------------------------------------------------------------------ small things on the skin
  add("blush", { decal: (g, d) => {
    for (const i of [205, 425]) { const p = d.at(i); blob(g, p.x, p.y + 4, 96, "255,72,104", 0.5, 1.15, 0.85); }
  } });

  add("freckles", { decal: (g, d) => {
    for (const i of [205, 425, 6]) {
      const p = d.at(i);
      const n = i === 6 ? 16 : 30;
      for (let k = 0; k < n; k += 1) {
        const a = d.rand() * PI * 2, r = Math.sqrt(d.rand()) * (i === 6 ? 40 : 82);
        const x = p.x + Math.cos(a) * r * 1.2, y = p.y + Math.sin(a) * r * 0.7 - (i === 6 ? 0 : 10);
        g.fillStyle = `rgba(143,84,45,${0.35 + d.rand() * 0.35})`;
        g.beginPath(); g.ellipse(x, y, 2.2 + d.rand() * 3, 2 + d.rand() * 2.4, d.rand() * PI, 0, PI * 2); g.fill();
      }
    }
  } });

  add("whiskers", { decal: (g, d) => {
    g.strokeStyle = "rgba(30,24,24,0.75)";
    g.lineCap = "round";
    g.lineWidth = 3.2;
    for (const [from, side] of [[205, -1], [425, 1]]) {
      const p = d.at(from);
      for (let n = -1; n <= 1; n += 1) {
        g.beginPath();
        g.moveTo(p.x - side * 52, p.y + n * 18);
        g.quadraticCurveTo(p.x + side * 30, p.y + n * 30 - 12, p.x + side * 120, p.y + n * 52 - 22);
        g.stroke();
      }
    }
  } });

  // ------------------------------------------------------------------------------------------------------------------ hair: moustache area, beard
  function beard(g, d, color, grey) {
    const mask = region(d, (p) => p.y < -2.0 && p.z > -1.2, 9);
    through(g, d, mask, (h) => {
      h.fillStyle = color;
      h.fillRect(0, 0, d.DECAL, d.DECAL);
      for (let n = 0; n < 5200; n += 1) {                            // strokes of hair, all pointing down and a little out
        const x = d.rand() * d.DECAL, y = d.rand() * d.DECAL;
        const len = 8 + d.rand() * 13;
        const light = d.rand();
        h.strokeStyle = grey ? (light > 0.45 ? "rgba(235,235,235,0.55)" : "rgba(160,160,160,0.5)") : (light > 0.5 ? "rgba(92,60,34,0.5)" : "rgba(20,12,6,0.5)");
        h.lineWidth = 1.5 + d.rand() * 1.4;
        h.beginPath(); h.moveTo(x, y); h.quadraticCurveTo(x + (x - 512) * 0.02, y + len * 0.5, x + (x - 512) * 0.04, y + len); h.stroke();
      }
    }, 0.95);
    // the mouth stays free
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.filter = "blur(3px)";
    d.poly(FACE().LIPS_OUTER, 1.22);
    g.fill();
    g.restore();
  }
  add("beard", { decal: (g, d) => beard(g, d, "rgba(46,30,18,1)", false) });
  add("greyBeard", { decal: (g, d) => beard(g, d, "rgba(150,150,150,1)", true) });

  // ------------------------------------------------------------------------------------------------------------------ the knitted hood (the balaclava)
  const STITCH = 0.0294;                                          // the size of one stitch, as a part of the width of the face (about 4.5 mm)
  /* rows of V-shaped stitches: n x n stitches of `cell` x `high` pixels, lit from the top left */
  function knitting(g, cell, n, high = cell) {
    g.fillStyle = "#141417";
    g.fillRect(0, 0, cell * n, high * n);
    g.lineCap = "round";
    g.lineWidth = cell * 0.3;
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        const ox = x * cell, oy = y * high;
        for (const side of [-1, 1]) {
          const grad = g.createLinearGradient(ox + cell * 0.2, oy, ox + cell * 0.8, oy + high);
          grad.addColorStop(0, side < 0 ? "#8d8d99" : "#6a6a75");
          grad.addColorStop(0.5, "#3a3a41");
          grad.addColorStop(1, "#131316");
          g.strokeStyle = grad;
          g.beginPath();
          g.moveTo(ox + cell * (0.5 + side * 0.4), oy + high * 0.04);
          g.quadraticCurveTo(ox + cell * (0.5 + side * 0.26), oy + high * 0.55, ox + cell * 0.5, oy + high * 0.98);
          g.stroke();
        }
      }
    }
  }
  /* what is drawn on g is a path along the points `ids` of the face, made bigger around their middle */
  function trace(g, d, ids, grow) {
    const pts = ids.map(d.at);
    const c = center(d, ids);
    g.beginPath();
    pts.forEach((p, n) => { const x = c.x + (p.x - c.x) * grow, y = c.y + (p.y - c.y) * grow; if (n) g.lineTo(x, y); else g.moveTo(x, y); });
    g.closePath();
  }

  add("balaclava", {
    decal: (g, d) => {
      const F = FACE();
      const c = document.createElement("canvas");
      c.width = c.height = d.DECAL;
      const h = c.getContext("2d");
      const tile = document.createElement("canvas");
      tile.width = 30 * 8;
      tile.height = 22 * 8;                                          // (the map of the face is a bit more stretched across than up: stitches of 4.5 mm both ways)
      knitting(tile.getContext("2d"), 30, 8, 22);
      h.fillStyle = h.createPattern(tile, "repeat");
      h.fillRect(0, 0, d.DECAL, d.DECAL);
      // the wool is a bit darker where the face turns away
      const mid = center(d, [10, 152, 234, 454]);
      const shade = h.createRadialGradient(mid.x, mid.y, 150, mid.x, mid.y, 560);
      shade.addColorStop(0, "rgba(0,0,0,0)");
      shade.addColorStop(1, "rgba(0,0,0,0.45)");
      h.fillStyle = shade;
      h.fillRect(0, 0, d.DECAL, d.DECAL);
      // the holes: both eyes (with the brows) and the mouth. A dark soft rim first (the wool turns in), then the hole itself
      h.save();
      h.shadowColor = "rgba(0,0,0,0.95)";
      h.shadowBlur = 20;
      h.fillStyle = "#000";
      const holes = [];
      for (const ids of [F.EYE_A, F.EYE_B]) {
        const c0 = center(d, ids), b = bounds(d, ids);
        const w = b.x1 - b.x0;
        holes.push({ x: c0.x, y: c0.y - w * 0.12, rx: w * 0.95, ry: w * 0.62 });
      }
      for (const e of holes) { h.beginPath(); h.ellipse(e.x, e.y, e.rx * 1.1, e.ry * 1.18, 0, 0, PI * 2); h.fill(); }
      trace(h, d, F.LIPS_OUTER, 1.42); h.fill();
      h.restore();
      h.globalCompositeOperation = "destination-out";
      h.fillStyle = "#000";
      for (const e of holes) { h.beginPath(); h.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, PI * 2); h.fill(); }
      trace(h, d, F.LIPS_OUTER, 1.3); h.fill();
      g.drawImage(c, 0, 0);
    },
    hood: (k, group, d) => {
      const { T } = k;
      const F = FACE();
      const n = F.OVAL.length;
      const positions = new Float32Array(n * 2 * 3);
      const colors = new Float32Array(n * 2 * 3);
      const uvs = new Float32Array(n * 2 * 2);
      const index = [];
      for (let i = 0; i < n; i += 1) {                              // a ring of cloth around the face: inner edge on the oval of the face, outer edge round the head and down to the neck
        const a = i * 2, b = ((i + 1) % n) * 2;
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
      geometry.setAttribute("uv", new T.BufferAttribute(uvs, 2));
      geometry.setIndex(index);
      const texture = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 16 * 8;
        knitting(c.getContext("2d"), 16, 8);
        const t = new T.CanvasTexture(c);
        t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
      })();
      const material = new T.MeshBasicMaterial({ map: texture, vertexColors: true, side: T.DoubleSide, depthTest: false, depthWrite: false });
      const mesh = new T.Mesh(geometry, material);
      mesh.frustumCulled = false;
      group.add(mesh);
      return {
        update(f, H) {
          const inner = F.OVAL.map((i) => f.scr(i));
          const c = { x: inner.reduce((a, p) => a + p.x, 0) / n, y: inner.reduce((a, p) => a + p.y, 0) / n };
          const size = f.s * f.k;
          const top = f.scr(10), chin = f.scr(152);
          let ux = top.x - chin.x, uy = top.y - chin.y;               // "up" of the head on the screen
          const ul = Math.hypot(ux, uy) || 1;
          ux /= ul; uy /= ul;
          const rep = size * STITCH * 8;                               // a repeat of the texture = 8 stitches
          inner.forEach((p, i) => {
            const dx = p.x - c.x, dy = p.y - c.y;
            const len = Math.hypot(dx, dy) || 1;
            const along = (dx * ux + dy * uy) / len;                   // 1 at the top of the head, -1 at the chin
            const grow = 1.27 + Math.max(0, along) * 0.5;
            const down = Math.max(0, -along) * size * 0.5;             // under the chin the cloth goes on like a neck
            const o = { x: c.x + dx * grow - ux * down, y: c.y + dy * grow - uy * down };
            const e = { x: c.x + dx * 0.965, y: c.y + dy * 0.965 };
            const rim = 0.95 - Math.min(1, Math.hypot(o.x - e.x, o.y - e.y) / (size * 0.9)) * 0.45;
            const writes = [[i * 2, e, 0.95], [i * 2 + 1, o, rim]];
            for (const [j, q, tone] of writes) {
              positions[j * 3] = q.x; positions[j * 3 + 1] = H - q.y; positions[j * 3 + 2] = 0;
              colors[j * 3] = colors[j * 3 + 1] = colors[j * 3 + 2] = tone;
              uvs[j * 2] = q.x / rep; uvs[j * 2 + 1] = q.y / rep;
            }
          });
          geometry.attributes.position.needsUpdate = true;
          geometry.attributes.color.needsUpdate = true;
          geometry.attributes.uv.needsUpdate = true;
        },
        dispose() { texture.dispose(); },
      };
    },
  });

  // ------------------------------------------------------------------------------------------------------------------ zombie, clown, robot, angry
  add("zombie", { decal: (g, d) => {
    const F = FACE();
    const skin = skinMask(d, 12);
    through(g, d, skin, (h) => { h.fillStyle = "rgba(112,168,86,0.62)"; h.fillRect(0, 0, d.DECAL, d.DECAL); });
    for (const ids of [F.EYE_A, F.EYE_B]) { const c = center(d, ids); blob(g, c.x, c.y + 14, 76, "46,22,62", 0.7, 1.2, 0.8); }
    for (const i of [205, 425]) { const p = d.at(i); blob(g, p.x, p.y + 20, 90, "40,50,30", 0.3); }
    g.save();
    g.filter = "blur(2px)";
    d.poly(F.LIPS_OUTER, 1.08);
    g.fillStyle = "rgba(78,34,52,0.65)"; g.fill();
    g.restore();
    // a scar with stitches across the cheek and a wound on the forehead
    const a = d.at(205), b = d.at(116);
    g.strokeStyle = "rgba(112,26,34,0.85)"; g.lineWidth = 7; g.lineCap = "round";
    g.beginPath(); g.moveTo(a.x - 30, a.y - 70); g.quadraticCurveTo(a.x + 10, a.y - 20, b.x + 30, b.y + 40); g.stroke();
    g.strokeStyle = "rgba(30,18,22,0.9)"; g.lineWidth = 3;
    for (let n = 0; n < 6; n += 1) { const t = n / 5; const x = a.x - 30 + (b.x + 60 - a.x) * t, y = a.y - 70 + (b.y + 110 - a.y) * t; g.beginPath(); g.moveTo(x - 12, y - 10); g.lineTo(x + 12, y + 10); g.stroke(); }
    const w = d.at(151);
    blob(g, w.x + 60, w.y - 10, 44, "120,20,30", 0.65, 1.4, 0.8);
    g.strokeStyle = "rgba(95,58,120,0.5)"; g.lineWidth = 2.4;
    for (const side of [-1, 1]) { const t = d.at(side < 0 ? 127 : 356); for (let n = 0; n < 4; n += 1) { g.beginPath(); g.moveTo(t.x, t.y - 60 + n * 22); g.bezierCurveTo(t.x + side * 30, t.y - 40 + n * 22, t.x + side * 10, t.y - 20 + n * 22, t.x + side * 44, t.y - 6 + n * 22); g.stroke(); } }
  } });

  add("clownFace", { decal: (g, d) => {
    const F = FACE();
    const skin = skinMask(d, 8);
    through(g, d, skin, (h) => { h.fillStyle = "rgba(255,255,255,0.96)"; h.fillRect(0, 0, d.DECAL, d.DECAL); });
    g.save();
    g.filter = "blur(1.5px)";
    d.poly(F.LIPS_OUTER, 1.7);
    g.fillStyle = "rgba(224,18,38,0.95)"; g.fill();
    g.restore();
    for (const [ids, side] of [[F.EYE_A, -1], [F.EYE_B, 1]]) {
      const c = center(d, ids), b = bounds(d, ids);
      const w = b.x1 - b.x0;
      g.fillStyle = "rgba(33,120,255,0.92)";
      g.beginPath(); g.moveTo(c.x - w * 0.55, c.y - w * 0.78); g.lineTo(c.x + w * 0.55, c.y - w * 0.78); g.lineTo(c.x, c.y - w * 1.42); g.closePath(); g.fill();
      g.fillStyle = "rgba(20,20,26,0.9)"; g.beginPath(); g.ellipse(c.x, c.y - w * 0.55, w * 0.5, w * 0.08, side * 0.12, 0, PI * 2); g.fill();
      g.strokeStyle = "rgba(20,20,26,0.9)"; g.lineWidth = 5; g.beginPath(); g.moveTo(c.x, c.y + w * 0.6); g.lineTo(c.x, c.y + w * 1.3); g.stroke();
    }
    for (const i of [205, 425]) { const p = d.at(i); blob(g, p.x, p.y, 70, "255,60,90", 0.65); }
  } });

  add("robotFace", { decal: (g, d) => {
    const F = FACE();
    const mask = region(d, () => true, 5);
    through(g, d, mask, (h) => {
      const grad = h.createLinearGradient(0, 0, d.DECAL, d.DECAL);
      grad.addColorStop(0, "#e3e7ec"); grad.addColorStop(0.5, "#9aa3ad"); grad.addColorStop(1, "#d3d8de");
      h.fillStyle = grad; h.fillRect(0, 0, d.DECAL, d.DECAL);
      h.strokeStyle = "rgba(55,62,70,0.55)"; h.lineWidth = 2;
      for (let x = 0; x < d.DECAL; x += 88) { h.beginPath(); h.moveTo(x, 0); h.lineTo(x, d.DECAL); h.stroke(); }
      for (let y = 0; y < d.DECAL; y += 88) { h.beginPath(); h.moveTo(0, y); h.lineTo(d.DECAL, y); h.stroke(); }
      h.fillStyle = "rgba(60,66,74,0.8)";
      for (let x = 44; x < d.DECAL; x += 88) for (let y = 44; y < d.DECAL; y += 88) { h.beginPath(); h.arc(x, y, 3.4, 0, PI * 2); h.fill(); }
    }, 0.94);
    for (const ids of [F.EYE_A, F.EYE_B]) {
      const c = center(d, ids), b = bounds(d, ids);
      const w = (b.x1 - b.x0) * 1.5;
      g.save();
      g.globalCompositeOperation = "destination-out";
      g.filter = "blur(3px)";
      g.fillRect(c.x - w * 0.62, c.y - w * 0.28, w * 1.24, w * 0.56);
      g.restore();
      g.fillStyle = "rgba(60,255,200,0.9)";
      g.shadowColor = "#3cffc8"; g.shadowBlur = 24;
      g.fillRect(c.x - w * 0.5, c.y - w * 0.14, w, w * 0.28);
      g.shadowBlur = 0;
    }
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.filter = "blur(2px)";
    d.poly(F.LIPS_OUTER, 1.2);
    g.fill();
    g.restore();
    g.strokeStyle = "rgba(40,46,54,0.9)"; g.lineWidth = 4;
    const m = center(d, F.LIPS_OUTER);
    for (let n = -4; n <= 4; n += 1) { g.beginPath(); g.moveTo(m.x + n * 22, m.y - 26); g.lineTo(m.x + n * 22, m.y + 26); g.stroke(); }
  } });

  add("angry", { decal: (g, d) => {
    const mask = region(d, () => true, 12);
    through(g, d, mask, (h) => { h.fillStyle = "rgba(255,40,40,0.2)"; h.fillRect(0, 0, d.DECAL, d.DECAL); });
    for (const [ids, side] of [[[70, 63, 105, 66, 107], -1], [[300, 293, 334, 296, 336], 1]]) {
      const pts = ids.map(d.at);
      g.save();
      g.lineCap = "round"; g.lineJoin = "round";
      g.strokeStyle = "rgba(24,16,14,0.96)";
      g.lineWidth = 30;
      g.beginPath();
      pts.forEach((p, n) => { const x = p.x, y = p.y + (side < 0 ? (4 - n) : n) * 6 + 4; if (n) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      g.restore();
    }
  } });

  window.PulseAR.region = region;
})();
