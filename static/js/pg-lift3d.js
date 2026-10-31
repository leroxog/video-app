/* Satürn games: the 3D lift (pg-lift3d.js). Every small game of the camera tab draws its picture with a few canvas calls (rectangles, circles, paths, emoji, text). Instead of rewriting a hundred games, the kit
   gives each game a RECORDER in place of the canvas: the game draws as before, the recorder writes down what it was asked to draw (every shape with its colour, gradient and transparency, in the order of
   drawing), and this file turns that list into a real 3D scene made with three.js: solid shapes with a bevel (circles become domes like balls and coins, everything else a block with a chamfered edge) that
   stand on what was drawn below them (what is painted over another thing lies on top of it, like layers of a model), soft shadows, light from the upper left, translucent things as flat decals, text and
   emoji as quads that float above their surface with a shadow under them. The camera looks down at the field with a gentle slant; the finger is mapped back onto the field through the camera, so
   a tap lands where the game expects it. Three parts: 1. the recorder (pure, runs in the tests without a browser), 2. the layout and the building of the solids (pure: plain numbers in typed arrays), 3. the
   view (three.js, only in a browser; the games without a browser or without WebGL keep drawing flat). Games that make their own 3D (the car race, the moto ride) are not lifted (`lift: false`). */
(function () {
  "use strict";

  const W = 360;
  const H = 640;
  const TAU = Math.PI * 2;
  const CELL = 12;
  const GX = Math.ceil(W / CELL);
  const GY = Math.ceil(H / CELL);
  const MAX_TOP = 84;                                   // the highest a stack of shapes may grow (in pixels of the field)
  const OUTSIDE = 90;                                   // shapes further than this outside the field are not drawn
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ======================================================================================================== 1. colours */
  const NAMED = {
    white: [255, 255, 255], black: [0, 0, 0], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], yellow: [255, 255, 0], orange: [255, 165, 0], purple: [128, 0, 128], pink: [255, 192, 203],
    gray: [128, 128, 128], grey: [128, 128, 128], cyan: [0, 255, 255], magenta: [255, 0, 255], brown: [165, 42, 42], gold: [255, 215, 0], silver: [192, 192, 192], lime: [0, 255, 0], navy: [0, 0, 128],
    transparent: [0, 0, 0, 0],
  };
  const colorCache = new Map();
  function hsl(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
  /* "#rgb", "#rrggbb", "rgb()", "rgba()", "hsl()", "hsla()" or a plain name -> [r, g, b, a] (a from 0 to 1) */
  function parseColor(text) {
    if (Array.isArray(text)) return text;
    const key = String(text);
    const hit = colorCache.get(key);
    if (hit) return hit;
    let out = [136, 136, 136, 1];
    const s = key.trim().toLowerCase();
    let m;
    if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
      const t = m[1];
      if (t.length === 3 || t.length === 4) out = [parseInt(t[0] + t[0], 16), parseInt(t[1] + t[1], 16), parseInt(t[2] + t[2], 16), t.length === 4 ? parseInt(t[3] + t[3], 16) / 255 : 1];
      else if (t.length === 6 || t.length === 8) out = [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16), t.length === 8 ? parseInt(t.slice(6, 8), 16) / 255 : 1];
    } else if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map((v) => (v.endsWith("%") ? parseFloat(v) * 2.55 : parseFloat(v)));
      out = [clamp(p[0] || 0, 0, 255), clamp(p[1] || 0, 0, 255), clamp(p[2] || 0, 0, 255), p.length > 3 ? clamp(m[1].includes("%") && /%\s*$/.test(m[1]) ? p[3] / 2.55 : p[3], 0, 1) : 1];
    } else if ((m = /^hsla?\(([^)]+)\)$/.exec(s))) {
      const p = m[1].split(/[ ,/]+/).filter(Boolean).map((v) => parseFloat(v));
      out = [...hsl(((p[0] || 0) % 360 + 360) % 360, clamp((p[1] || 0) / 100, 0, 1), clamp((p[2] || 0) / 100, 0, 1)), p.length > 3 ? clamp(p[3], 0, 1) : 1];
    } else if (NAMED[s]) {
      out = [NAMED[s][0], NAMED[s][1], NAMED[s][2], NAMED[s].length > 3 ? NAMED[s][3] : 1];
    }
    if (colorCache.size > 600) colorCache.clear();
    colorCache.set(key, out);
    return out;
  }

  /* a colour at the place `t` (0 to 1) of the stops [[offset, [r, g, b, a]], ...] (sorted) */
  function sampleStops(stops, t) {
    if (!stops.length) return [136, 136, 136, 1];
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i += 1) {
      if (t <= stops[i][0]) {
        const a = stops[i - 1], b = stops[i];
        const k = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]);
        return [a[1][0] + (b[1][0] - a[1][0]) * k, a[1][1] + (b[1][1] - a[1][1]) * k, a[1][2] + (b[1][2] - a[1][2]) * k, a[1][3] + (b[1][3] - a[1][3]) * k];
      }
    }
    return stops[stops.length - 1][1];
  }
  /* the colour of a paint (a plain colour or a gradient, already moved into field coordinates) at the point (x, y) */
  function paintAt(paint, x, y) {
    const grad = paint.grad;
    if (!grad) return paint.rgba;
    if (grad.kind === "linear") {
      const dx = grad.p1[0] - grad.p0[0], dy = grad.p1[1] - grad.p0[1];
      const len = dx * dx + dy * dy;
      return sampleStops(grad.stops, len < 1e-9 ? 0 : clamp(((x - grad.p0[0]) * dx + (y - grad.p0[1]) * dy) / len, 0, 1));
    }
    const d = Math.hypot(x - grad.c1[0], y - grad.c1[1]);
    const r0 = grad.r0, r1 = Math.max(1e-6, grad.r1);
    return sampleStops(grad.stops, clamp((d - r0) / Math.max(1e-6, r1 - r0), 0, 1));
  }
  const alphaOf = (paint) => (paint.grad ? Math.min(...paint.grad.stops.map((s) => s[1][3])) : paint.rgba[3]);

  /* ======================================================================================================== 2. the recorder */
  class Gradient {
    constructor(kind, args) { this.kind = kind; this.a = args; this.stops = []; }
    addColorStop(offset, color) { this.stops.push([clamp(Number(offset) || 0, 0, 1), parseColor(color)]); this.stops.sort((p, q) => p[0] - q[0]); }
  }

  function sizeOfFont(font) {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(font));
    return m ? parseFloat(m[1]) : 16;
  }
  const isEmoji = (text) => /[←-⯿\u{1F000}-\u{1FAFF}☀-➿️]/u.test(text);

  function makeRecorder() {
    let items = [];
    let group = 0;
    let st = { m: [1, 0, 0, 1, 0, 0], fill: "#000", stroke: "#000", lw: 1, alpha: 1, font: "10px sans-serif", align: "start", baseline: "alphabetic", cap: "butt" };
    const stack = [];
    let subs = [];
    let cur = null;
    let lastStart = null;                                  // after closePath the next line starts again where the shape began
    let measure = null;                                  // a real canvas for measureText (in a browser)
    const pt = (x, y) => [st.m[0] * x + st.m[2] * y + st.m[4], st.m[1] * x + st.m[3] * y + st.m[5]];
    const scaleOf = () => Math.sqrt(Math.abs(st.m[0] * st.m[3] - st.m[1] * st.m[2])) || 1;
    const finite = (...v) => v.every(Number.isFinite);

    function startSub(x, y) { cur = { pts: [x, y], closed: false, round: false }; subs.push(cur); }
    function addPoint(x, y) { if (!cur) { if (lastStart) startSub(lastStart[0], lastStart[1]); else startSub(x, y); } cur.pts.push(x, y); lastStart = null; }
    function segments(radiusDevice, sweep) {
      const full = clamp(Math.round(6 + Math.sqrt(Math.max(0, radiusDevice)) * 2.4), 10, 28);
      return Math.max(2, Math.ceil(full * Math.abs(sweep) / TAU));
    }
    function ellipsePath(cx, cy, rx, ry, rot, a0, a1, ccw) {
      if (!finite(cx, cy, rx, ry, rot, a0, a1)) return;
      let sweep = a1 - a0;
      if (!ccw) { if (sweep >= TAU) sweep = TAU; else while (sweep < 0) sweep += TAU; }
      else { if (sweep <= -TAU) sweep = -TAU; else while (sweep > 0) sweep -= TAU; }
      const fullCircle = Math.abs(sweep) >= TAU - 1e-6;
      const n = segments(Math.max(rx, ry) * scaleOf(), sweep);
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const at = (t) => pt(cx + rx * Math.cos(t) * cr - ry * Math.sin(t) * sr, cy + rx * Math.cos(t) * sr + ry * Math.sin(t) * cr);
      const first = at(a0);
      lastStart = null;
      if (fullCircle) startSub(first[0], first[1]);                     // a whole circle is a shape of its own (several circles of one path are joined by a fill, not by lines)
      else if (cur) cur.pts.push(first[0], first[1]);
      else startSub(first[0], first[1]);
      for (let i = 1; i <= n; i += 1) { const p = at(a0 + sweep * i / n); cur.pts.push(p[0], p[1]); }
      if (fullCircle) { cur.round = true; cur.closed = true; cur.pts.length -= 2; lastStart = [first[0], first[1]]; cur = null; }      // (the last point is the first)
    }
    function roundedPath(x, y, w, h, radii) {
      if (!finite(x, y, w, h)) return;
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      let r = Array.isArray(radii) ? radii[0] : radii && typeof radii === "object" ? radii.x : radii;
      r = clamp(Number(r) || 0, 0, Math.min(w, h) / 2);
      const local = [];
      if (r < 0.5) local.push(x, y, x + w, y, x + w, y + h, x, y + h);
      else {
        const n = clamp(Math.round(2 + r * scaleOf() * 0.5), 3, 7);
        for (const [cx, cy, a0] of [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]]) {
          for (let i = 0; i <= n; i += 1) { const a = a0 + (Math.PI / 2) * i / n; local.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
        }
      }
      const out = [];
      for (let i = 0; i < local.length; i += 2) out.push(...pt(local[i], local[i + 1]));
      subs.push({ pts: out, closed: true, round: false });
      cur = null;
      lastStart = [out[0], out[1]];
    }

    function paint(style) {
      if (style && style.stops) {
        const m = st.m, s = scaleOf();
        const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
        const mid = sampleStops(style.stops, 0.5);
        const rgba = [mid[0], mid[1], mid[2], style.stops.length ? Math.min(1, style.stops.reduce((sum, c) => sum + c[1][3], 0) / style.stops.length) : 1];
        if (style.kind === "linear") return { rgba, grad: { kind: "linear", p0: at(style.a[0], style.a[1]), p1: at(style.a[2], style.a[3]), stops: style.stops } };
        return { rgba, grad: { kind: "radial", c0: at(style.a[0], style.a[1]), r0: style.a[2] * s, c1: at(style.a[3], style.a[4]), r1: style.a[5] * s, stops: style.stops } };
      }
      return { rgba: parseColor(style), grad: null };
    }

    function emitPoly(points, round, paintObj, alpha, wire) {
      if (points.length < 6) return;
      for (const v of points) if (!Number.isFinite(v)) return;
      items.push({ k: "poly", pts: points, round, paint: paintObj, alpha, wire: wire || 0, group });
    }
    function fillPath() {
      if (st.alpha <= 0.002) return;
      const p = paint(st.fill);
      if (p.rgba[3] * st.alpha <= 0.002 && !p.grad) return;
      group += 1;
      for (const sub of subs) if (sub.pts.length >= 6) emitPoly(sub.pts.slice(), sub.round, p, st.alpha, 0);
    }
    function strokePath(closeAll) {
      if (st.alpha <= 0.002) return;
      const p = paint(st.stroke);
      const hw = Math.max(0.4, st.lw * scaleOf() / 2);
      group += 1;
      for (const sub of subs) {
        const n = sub.pts.length / 2;
        if (n < 2) continue;
        const last = sub.closed || closeAll ? n : n - 1;
        for (let i = 0; i < last; i += 1) {
          const a = [sub.pts[i * 2], sub.pts[i * 2 + 1]], b = [sub.pts[((i + 1) % n) * 2], sub.pts[((i + 1) % n) * 2 + 1]];
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const len = Math.hypot(dx, dy);
          if (len < 0.01) continue;
          const ux = dx / len, uy = dy / len, nx = -uy * hw, ny = ux * hw, ex = ux * hw * 0.9, ey = uy * hw * 0.9;
          emitPoly([a[0] - ex + nx, a[1] - ey + ny, b[0] + ex + nx, b[1] + ey + ny, b[0] + ex - nx, b[1] + ey - ny, a[0] - ex - nx, a[1] - ey - ny], false, p, st.alpha, hw * 2);
        }
      }
    }
    function text(str, x, y, stroke) {
      const s = String(str);
      if (!s || !finite(x, y) || st.alpha <= 0.002) return;
      const p = paint(stroke ? st.stroke : st.fill);
      const last = items[items.length - 1];
      if (!stroke && last && last.k === "text" && last.outlineOnly && last.text === s && last.x === x && last.y === y && last.font === st.font) {     // strokeText + fillText of the same text: one picture
        last.outlineOnly = false; last.fill = p.rgba; last.alpha = st.alpha;
        return;
      }
      group += 1;
      items.push({ k: "text", text: s, x, y, m: st.m.slice(), font: st.font, size: sizeOfFont(st.font), align: st.align, baseline: st.baseline, fill: stroke ? null : p.rgba, outline: stroke ? p.rgba : null, outlineOnly: !!stroke,
        lw: st.lw, alpha: st.alpha, emoji: isEmoji(s), group });
    }

    const api = {
      canvas: { width: W, height: H },
      save() { stack.push({ ...st, m: st.m.slice() }); },
      restore() { if (stack.length) st = stack.pop(); },
      translate(x, y) { if (!finite(x, y)) return; const m = st.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
      scale(x, y) { if (!finite(x, y)) return; const m = st.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; },
      rotate(r) { if (!finite(r)) return; const m = st.m, c = Math.cos(r), s = Math.sin(r); const a = m[0] * c + m[2] * s, b = m[1] * c + m[3] * s, cc = -m[0] * s + m[2] * c, d = -m[1] * s + m[3] * c; m[0] = a; m[1] = b; m[2] = cc; m[3] = d; },
      transform(a, b, c, d, e, f) { if (!finite(a, b, c, d, e, f)) return; const m = st.m; st.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]]; },
      setTransform(a, b, c, d, e, f) {
        if (a && typeof a === "object") { st.m = [a.a, a.b, a.c, a.d, a.e, a.f]; return; }
        if (finite(a, b, c, d, e, f)) st.m = [1, 0, 0, 1, 0, 0].map((v, i) => [a, b, c, d, e, f][i]);
      },
      resetTransform() { st.m = [1, 0, 0, 1, 0, 0]; },
      getTransform() { const m = st.m; return { a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5] }; },
      beginPath() { subs = []; cur = null; lastStart = null; },
      closePath() { if (cur) { cur.closed = true; lastStart = [cur.pts[0], cur.pts[1]]; cur = null; } },
      moveTo(x, y) { if (!finite(x, y)) return; const p = pt(x, y); startSub(p[0], p[1]); lastStart = null; },
      lineTo(x, y) { if (!finite(x, y)) return; const p = pt(x, y); addPoint(p[0], p[1]); },
      rect(x, y, w, h) { roundedPath(x, y, w, h, 0); },
      roundRect(x, y, w, h, r) { roundedPath(x, y, w, h, r); },
      arc(x, y, r, a0, a1, ccw) { if (r >= 0) ellipsePath(x, y, r, r, 0, a0, a1, !!ccw); },
      ellipse(x, y, rx, ry, rot, a0, a1, ccw) { if (rx >= 0 && ry >= 0) ellipsePath(x, y, rx, ry, rot, a0, a1, !!ccw); },
      arcTo(x1, y1, x2, y2) { api.lineTo(x1, y1); api.lineTo(x2, y2); },
      quadraticCurveTo(cx, cy, x, y) {
        if (!finite(cx, cy, x, y)) return;
        if (!cur) { api.moveTo(cx, cy); }
        const n = cur.pts.length, x0 = cur.pts[n - 2], y0 = cur.pts[n - 1];
        const c = pt(cx, cy), e = pt(x, y);
        for (let i = 1; i <= 6; i += 1) { const t = i / 6, u = 1 - t; cur.pts.push(u * u * x0 + 2 * u * t * c[0] + t * t * e[0], u * u * y0 + 2 * u * t * c[1] + t * t * e[1]); }
      },
      bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
        if (!finite(c1x, c1y, c2x, c2y, x, y)) return;
        if (!cur) { api.moveTo(c1x, c1y); }
        const n = cur.pts.length, x0 = cur.pts[n - 2], y0 = cur.pts[n - 1];
        const a = pt(c1x, c1y), b = pt(c2x, c2y), e = pt(x, y);
        for (let i = 1; i <= 8; i += 1) { const t = i / 8, u = 1 - t; cur.pts.push(u * u * u * x0 + 3 * u * u * t * a[0] + 3 * u * t * t * b[0] + t * t * t * e[0], u * u * u * y0 + 3 * u * u * t * a[1] + 3 * u * t * t * b[1] + t * t * t * e[1]); }
      },
      fill() { fillPath(); },
      stroke() { strokePath(false); },
      clip() { /* the lift does not cut shapes: what a game clips is drawn whole */ },
      fillRect(x, y, w, h) {
        if (!finite(x, y, w, h)) return;
        const keep = [subs, cur, lastStart]; subs = []; cur = null;
        roundedPath(x, y, w, h, 0); fillPath();
        subs = keep[0]; cur = keep[1]; lastStart = keep[2];
      },
      strokeRect(x, y, w, h) {
        if (!finite(x, y, w, h)) return;
        const keep = [subs, cur, lastStart]; subs = []; cur = null;
        roundedPath(x, y, w, h, 0); strokePath(true);
        subs = keep[0]; cur = keep[1]; lastStart = keep[2];
      },
      clearRect(x, y, w, h) { if (w >= W - 1 && h >= H - 1 && x <= 1 && y <= 1) items = []; },
      fillText(s, x, y) { text(s, x, y, false); },
      strokeText(s, x, y) { text(s, x, y, true); },
      measureText(s) {
        if (measure) { measure.font = st.font; return measure.measureText(String(s)); }
        return { width: String(s).length * sizeOfFont(st.font) * 0.56 };
      },
      drawImage(src, a, b, c, d, e, f, g2, h2) {
        if (!src) return;
        let sx = null, sy = 0, sw = 0, sh = 0, dx, dy, dw, dh;
        const natural = (v) => v.naturalWidth || v.videoWidth || v.width || 0;
        const naturalH = (v) => v.naturalHeight || v.videoHeight || v.height || 0;
        if (arguments.length >= 9) { sx = a; sy = b; sw = c; sh = d; dx = e; dy = f; dw = g2; dh = h2; }
        else if (arguments.length >= 5) { dx = a; dy = b; dw = c; dh = d; }
        else { dx = a; dy = b; dw = natural(src); dh = naturalH(src); }
        if (!finite(dx, dy, dw, dh) || st.alpha <= 0.002) return;
        group += 1;
        items.push({ k: "image", src, sx, sy, sw, sh, x: dx, y: dy, w: dw, h: dh, m: st.m.slice(), alpha: st.alpha, group });
      },
      createLinearGradient(x0, y0, x1, y1) { return new Gradient("linear", [x0, y0, x1, y1]); },
      createRadialGradient(x0, y0, r0, x1, y1, r1) { return new Gradient("radial", [x0, y0, r0, x1, y1, r1]); },
      createPattern() { return "#888"; },
      setLineDash() {}, getLineDash() { return []; }, isPointInPath() { return false; }, putImageData() {}, getImageData() { return { data: new Uint8ClampedArray(4) }; },
      /* ---- the side of the lift */
      begin() { items = []; group = 0; subs = []; cur = null; lastStart = null; stack.length = 0; st = { m: [1, 0, 0, 1, 0, 0], fill: "#000", stroke: "#000", lw: 1, alpha: 1, font: "10px sans-serif", align: "start", baseline: "alphabetic", cap: "butt" }; },
      items() { return items; },
      useMeasure(ctx2d) { measure = ctx2d; },
    };
    const props = {
      fillStyle: ["fill"], strokeStyle: ["stroke"], lineWidth: ["lw"], globalAlpha: ["alpha"], font: ["font"], textAlign: ["align"], textBaseline: ["baseline"], lineCap: ["cap"],
    };
    for (const [name, [field]] of Object.entries(props)) {
      Object.defineProperty(api, name, { get() { return st[field]; }, set(v) { if (name === "globalAlpha" || name === "lineWidth") { if (Number.isFinite(v)) st[field] = v; } else st[field] = v; }, enumerable: true });
    }
    return new Proxy(api, {
      get(target, name) { if (name in target) return target[name]; if (typeof name === "symbol") return undefined; return () => undefined; },
      set(target, name, value) { if (name in target) { target[name] = value; } return true; },
    });
  }

  /* ======================================================================================================== 3. the layout: where does every shape stand? */
  const bboxOf = (points) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < points.length; i += 2) { const x = points[i], y = points[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  };
  const quadBox = (m, x, y, w, h) => {
    const c = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
    return { corners: c, box: bboxOf(c.flat()) };
  };

  /* Where the shapes go. `items` (the list of the recorder, in the order of drawing) -> {prisms, decals, quads, glows, dropped}. A shape stands on the highest thing that was drawn under it (a grid of
     12 pixel cells keeps the height of every place), so the pieces of a game lie in layers like a model; what is see-through is a flat decal on top of what is under it. */
  function layout(items) {
    const top = new Float32Array(GX * GY);
    const out = { prisms: [], decals: [], quads: [], glows: [], dropped: 0, height: 0 };
    let i = 0;
    while (i < items.length) {
      let j = i;
      const gid = items[i].group;
      while (j < items.length && items[j].group === gid) j += 1;
      // the box of the whole group (one call of fill, stroke, text or drawImage)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const boxes = [];
      for (let n = i; n < j; n += 1) {
        const it = items[n];
        let b;
        if (it.k === "poly") b = bboxOf(it.pts);
        else if (it.k === "text") {
          const w = it.text.length * it.size * (it.emoji ? 1.15 : 0.58);
          const q = quadBox(it.m, it.x - (it.align === "center" ? w / 2 : it.align === "right" || it.align === "end" ? w : 0), it.y - it.size * 0.75, w, it.size * 1.5);
          b = q.box;
        } else b = quadBox(it.m, it.x, it.y, it.w, it.h).box;
        boxes[n - i] = b;
        if (b[0] < x0) x0 = b[0]; if (b[1] < y0) y0 = b[1]; if (b[2] > x1) x1 = b[2]; if (b[3] > y1) y1 = b[3];
      }
      if (!(x1 > -OUTSIDE && y1 > -OUTSIDE && x0 < W + OUTSIDE && y0 < H + OUTSIDE) || !Number.isFinite(x0 + y0 + x1 + y1)) { out.dropped += j - i; i = j; continue; }
      const cx0 = clamp(Math.floor(x0 / CELL), 0, GX - 1), cx1 = clamp(Math.floor(x1 / CELL), 0, GX - 1), cy0 = clamp(Math.floor(y0 / CELL), 0, GY - 1), cy1 = clamp(Math.floor(y1 / CELL), 0, GY - 1);
      let base = 0;
      for (let cy = cy0; cy <= cy1; cy += 1) for (let cx = cx0; cx <= cx1; cx += 1) if (top[cy * GX + cx] > base) base = top[cy * GX + cx];
      let raise = 0.05;
      for (let n = i; n < j; n += 1) {
        const it = items[n];
        const b = boxes[n - i];
        if (it.k === "poly") {
          const a = it.alpha * alphaOf(it.paint);
          const bw = b[2] - b[0], bh = b[3] - b[1];
          const radial = it.paint.grad && it.paint.grad.kind === "radial" && alphaOf(it.paint) < 0.97;
          if (radial) { out.glows.push({ box: b, z: base + 0.15, paint: it.paint, alpha: it.alpha }); continue; }
          const floor = base < 0.5 && bw >= W * 0.9 && bh >= H * 0.55;
          if (a >= 0.97 && !floor) {
            const min = Math.min(bw, bh);
            let thick, bevel;
            if (it.wire) { thick = clamp(it.wire * 0.8, 1.2, 5); bevel = Math.min(0.5, thick * 0.3); }
            else if (it.round && min > 0) { thick = clamp(min * 0.5, 2.2, 15); bevel = 0; }
            else { thick = clamp(min * 0.5, 1.8, 8); bevel = Math.min(2, min * 0.2, thick * 0.4); }
            let z0 = base;
            if (z0 + thick > MAX_TOP) z0 = Math.max(0, MAX_TOP - thick);
            out.prisms.push({ pts: it.pts, z0, thick, bevel, round: it.round, paint: it.paint, alpha: 1 });
            if (z0 + thick > raise) raise = z0 + thick;
            if (z0 + thick > out.height) out.height = z0 + thick;
          } else {
            let pts = it.pts;
            if (floor && pts.length === 8) {                         // a floor reaches past the edges of the field, so that the slanted camera sees no gap beside it
              const e = bboxOf(pts), ex = 170, ey = 150;
              const nx0 = e[0] <= 4 ? -ex : e[0], ny0 = e[1] <= 4 ? -ey : e[1], nx1 = e[2] >= W - 4 ? W + ex : e[2], ny1 = e[3] >= H - 4 ? H + ey : e[3];
              pts = [nx0, ny0, nx1, ny0, nx1, ny1, nx0, ny1];
            }
            out.decals.push({ pts, z: floor ? 0.08 : Math.min(MAX_TOP + 2, base + 0.12), paint: it.paint, alpha: it.alpha });
          }
        } else if (it.k === "text") {
          const hover = it.emoji ? 5 : 0.5;
          const z = Math.min(MAX_TOP + 4, base + hover);
          out.quads.push({ kind: "text", item: it, z, base });
          if (z + 0.4 > raise) raise = z + 0.4;
        } else {
          out.quads.push({ kind: "image", item: it, z: Math.min(MAX_TOP + 3, base + 0.3), base });
          if (base + 0.4 > raise) raise = base + 0.4;
        }
      }
      for (let cy = cy0; cy <= cy1; cy += 1) for (let cx = cx0; cx <= cx1; cx += 1) top[cy * GX + cx] = Math.max(top[cy * GX + cx], raise);
      i = j;
    }
    return out;
  }

  /* ======================================================================================================== 4. the building of the solids */
  const shapeArea = (p) => { let s = 0; const n = p.length / 2; for (let i = 0; i < n; i += 1) { const j = (i + 1) % n; s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1]; } return s / 2; };
  function isConvex(p) {
    const n = p.length / 2;
    let sign = 0;
    for (let i = 0; i < n; i += 1) {
      const a = i, b = (i + 1) % n, c = (i + 2) % n;
      const cross = (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[b * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[b * 2]);
      if (Math.abs(cross) < 1e-9) continue;
      if (!sign) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false;
    }
    return true;
  }
  /* triangles of a polygon (any direction; the triangles turn the same way as the polygon): a fan when it is convex, else ears cut off one by one (a polygon that is too tangled falls back to a fan) */
  function triangulate(p) {
    const n = p.length / 2;
    const out = [];
    if (n < 3) return out;
    if (n === 3 || isConvex(p)) { for (let i = 1; i < n - 1; i += 1) out.push(0, i, i + 1); return out; }
    const idx = Array.from({ length: n }, (_, i) => i);
    const sign = shapeArea(p) >= 0 ? 1 : -1;
    const cross = (a, b, c) => sign * ((p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[a * 2]));
    const inside = (a, b, c, q) => cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0;
    let guard = n * n + 10;
    while (idx.length > 3 && guard-- > 0) {
      let cut = false;
      for (let k = 0; k < idx.length; k += 1) {
        const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
        if (cross(a, b, c) <= 1e-9) continue;
        let ear = true;
        for (const q of idx) if (q !== a && q !== b && q !== c && inside(a, b, c, q)) { ear = false; break; }
        if (!ear) continue;
        out.push(a, b, c);
        idx.splice(k, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
    else if (idx.length > 3) for (let i = 1; i < idx.length - 1; i += 1) out.push(idx[0], idx[i], idx[i + 1]);
    return out;
  }
  /* the corners of a convex counter-clockwise polygon moved inwards by d (a mitre, never further than 3 d) */
  function inset(p, d) {
    const n = p.length / 2;
    const q = new Array(p.length);
    for (let i = 0; i < n; i += 1) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      let e1x = p[i * 2] - p[a * 2], e1y = p[i * 2 + 1] - p[a * 2 + 1], e2x = p[b * 2] - p[i * 2], e2y = p[b * 2 + 1] - p[i * 2 + 1];
      const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
      e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
      const n1x = e1y, n1y = -e1x, n2x = e2y, n2y = -e2x;               // (inwards: the polygon runs clockwise in pixels, so the inside is on the right of an edge)
      const k = 1 + n1x * n2x + n1y * n2y;
      let mx = (n1x + n2x) / Math.max(0.35, k) * d, my = (n1y + n2y) / Math.max(0.35, k) * d;
      const len = Math.hypot(mx, my);
      if (len > d * 3) { mx *= d * 3 / len; my *= d * 3 / len; }
      q[i * 2] = p[i * 2] + mx; q[i * 2 + 1] = p[i * 2 + 1] + my;
    }
    return q;
  }

  /* A sink with room for `cap` corners: positions, normals and colours (and, for flat decals, the transparency in the fourth colour byte). */
  function makeSink(cap) {
    return { cap, n: 0, pos: new Float32Array(cap * 3), nor: new Float32Array(cap * 3), col: new Uint8Array(cap * 4), full: false };
  }
  function vertex(s, x, y, z, nx, ny, nz, c) {
    const i = s.n++;
    s.pos[i * 3] = x - W / 2; s.pos[i * 3 + 1] = H / 2 - y; s.pos[i * 3 + 2] = z;
    s.nor[i * 3] = nx; s.nor[i * 3 + 1] = -ny; s.nor[i * 3 + 2] = nz;
    s.col[i * 4] = c[0]; s.col[i * 4 + 1] = c[1]; s.col[i * 4 + 2] = c[2]; s.col[i * 4 + 3] = c[3] === undefined ? 255 : c[3];
  }
  const tone = (rgba, a = 1) => [clamp(Math.round(rgba[0]), 0, 255), clamp(Math.round(rgba[1]), 0, 255), clamp(Math.round(rgba[2]), 0, 255), clamp(Math.round(rgba[3] * a * 255), 0, 255)];

  /* a solid: walls, a chamfer (or, for something round, a dome in four rings) and a top; `p` is in the pixels of the field (y down) */
  function addPrism(s, prism) {
    let p = prism.pts;
    // clean: no doubled points
    const clean = [];
    for (let i = 0; i < p.length; i += 2) {
      const l = clean.length;
      if (l >= 2 && Math.abs(clean[l - 2] - p[i]) < 0.02 && Math.abs(clean[l - 1] - p[i + 1]) < 0.02) continue;
      clean.push(p[i], p[i + 1]);
    }
    if (clean.length > 4 && Math.abs(clean[0] - clean[clean.length - 2]) < 0.02 && Math.abs(clean[1] - clean[clean.length - 1]) < 0.02) clean.length -= 2;
    p = clean;
    const n = p.length / 2;
    if (n < 3) return false;
    // counter-clockwise as seen from above (the field has y down, the scene y up: the area has the other sign)
    if (shapeArea(p) > 0) { const r = []; for (let i = n - 1; i >= 0; i -= 1) r.push(p[i * 2], p[i * 2 + 1]); p = r; }
    const budget = prism.round ? n * 21 : n * 12 + (n - 2) * 3;
    if (s.n + budget > s.cap) { s.full = true; return false; }
    const { z0, thick, paint } = prism;
    const col = (x, y) => tone(paintAt(paint, x, y));
    // in the pixel space y is down: the polygon p is clockwise there, so "outwards" is the left of an edge direction
    const outward = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
    if (prism.round) {
      let cx = 0, cy = 0;
      for (let i = 0; i < n; i += 1) { cx += p[i * 2]; cy += p[i * 2 + 1]; }
      cx /= n; cy /= n;
      const rings = [0, 32, 60, 82].map((deg) => deg * Math.PI / 180);
      const at = (i, phi) => [cx + (p[i * 2] - cx) * Math.cos(phi), cy + (p[i * 2 + 1] - cy) * Math.cos(phi), z0 + thick * Math.sin(phi)];
      const nor = (i, phi) => {
        const a = (i + n - 1) % n, b = (i + 1) % n;
        const n1 = outward(p[a * 2], p[a * 2 + 1], p[i * 2], p[i * 2 + 1]), n2 = outward(p[i * 2], p[i * 2 + 1], p[b * 2], p[b * 2 + 1]);
        let nx = n1[0] + n2[0], ny = n1[1] + n2[1];
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        return [nx * Math.cos(phi), ny * Math.cos(phi), Math.sin(phi)];
      };
      for (let r = 0; r < rings.length; r += 1) {
        const phiA = rings[r], phiB = r + 1 < rings.length ? rings[r + 1] : Math.PI / 2;
        for (let i = 0; i < n; i += 1) {
          const j = (i + 1) % n;
          const A = at(i, phiA), B = at(j, phiA), C = at(j, phiB), D = at(i, phiB);
          const nA = nor(i, phiA), nB = nor(j, phiA), nC = nor(j, phiB), nD = nor(i, phiB);
          const cA = col(A[0], A[1]), cB = col(B[0], B[1]), cC = col(C[0], C[1]), cD = col(D[0], D[1]);
          if (r + 1 < rings.length) {
            vertex(s, A[0], A[1], A[2], nA[0], nA[1], nA[2], cA); vertex(s, B[0], B[1], B[2], nB[0], nB[1], nB[2], cB); vertex(s, C[0], C[1], C[2], nC[0], nC[1], nC[2], cC);
            vertex(s, A[0], A[1], A[2], nA[0], nA[1], nA[2], cA); vertex(s, C[0], C[1], C[2], nC[0], nC[1], nC[2], cC); vertex(s, D[0], D[1], D[2], nD[0], nD[1], nD[2], cD);
          } else {
            const top = [cx, cy, z0 + thick], cT = col(cx, cy);
            vertex(s, A[0], A[1], A[2], nA[0], nA[1], nA[2], cA); vertex(s, B[0], B[1], B[2], nB[0], nB[1], nB[2], cB); vertex(s, top[0], top[1], top[2], 0, 0, 1, cT);
          }
        }
      }
      return true;
    }
    const b = Math.min(prism.bevel || 0, thick * 0.45);
    const convex = isConvex(p);
    const q = b > 0.05 && convex ? inset(p, b) : p;
    const hasBevel = q !== p;
    const zWall = z0 + (hasBevel ? thick - b : thick);
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const ax = p[i * 2], ay = p[i * 2 + 1], bx = p[j * 2], by = p[j * 2 + 1];
      const nn = outward(ax, ay, bx, by);
      const cA = col(ax, ay), cB = col(bx, by);
      vertex(s, ax, ay, z0, nn[0], nn[1], 0, cA); vertex(s, bx, by, z0, nn[0], nn[1], 0, cB); vertex(s, bx, by, zWall, nn[0], nn[1], 0, cB);
      vertex(s, ax, ay, z0, nn[0], nn[1], 0, cA); vertex(s, bx, by, zWall, nn[0], nn[1], 0, cB); vertex(s, ax, ay, zWall, nn[0], nn[1], 0, cA);
      if (hasBevel) {
        const qa = [q[i * 2], q[i * 2 + 1]], qb = [q[j * 2], q[j * 2 + 1]];
        const slant = [nn[0] * 0.72, nn[1] * 0.72, 0.69];
        vertex(s, ax, ay, zWall, slant[0], slant[1], slant[2], cA); vertex(s, bx, by, zWall, slant[0], slant[1], slant[2], cB); vertex(s, qb[0], qb[1], z0 + thick, slant[0], slant[1], slant[2], cB);
        vertex(s, ax, ay, zWall, slant[0], slant[1], slant[2], cA); vertex(s, qb[0], qb[1], z0 + thick, slant[0], slant[1], slant[2], cB); vertex(s, qa[0], qa[1], z0 + thick, slant[0], slant[1], slant[2], cA);
      }
    }
    // the top (the polygon runs clockwise in pixels = counter-clockwise in the scene, whose y points up)
    const tri = triangulate(q);
    for (let t = 0; t < tri.length; t += 3) {
      for (const k of [tri[t], tri[t + 1], tri[t + 2]]) vertex(s, q[k * 2], q[k * 2 + 1], z0 + thick, 0, 0, 1, col(q[k * 2], q[k * 2 + 1]));
    }
    return true;
  }

  /* a flat shape (a decal): only the top, `a` is the transparency (0 to 1) that comes on top of the colours of the corners */
  function addFlat(s, pts, z, paint, a) {
    let p = pts;
    const n = p.length / 2;
    if (n < 3 || s.n + (n - 2) * 3 > s.cap) { if (n >= 3) s.full = true; return false; }
    if (shapeArea(p) > 0) { const r = []; for (let i = n - 1; i >= 0; i -= 1) r.push(p[i * 2], p[i * 2 + 1]); p = r; }
    const tri = triangulate(p);
    for (let t = 0; t < tri.length; t += 3) {
      for (const k of [tri[t], tri[t + 1], tri[t + 2]]) vertex(s, p[k * 2], p[k * 2 + 1], z, 0, 0, 1, tone(paintAt(paint, p[k * 2], p[k * 2 + 1]), a));
    }
    return true;
  }

  /* ======================================================================================================== 5. what the view takes from here */
  const CAP_PRISMS = 90000;
  const CAP_DECALS = 24000;
  function build(plan, sinks) {
    const prisms = sinks && sinks.prisms || makeSink(CAP_PRISMS);
    const decals = sinks && sinks.decals || makeSink(CAP_DECALS);
    prisms.n = 0; decals.n = 0; prisms.full = false; decals.full = false;
    for (const it of plan.prisms) addPrism(prisms, it);
    for (const it of plan.decals) addFlat(decals, it.pts, it.z, it.paint, it.alpha);
    return { prisms, decals };
  }

  /* ======================================================================================================== 6. the view (three.js, only in a browser) */
  const BASE = "/static/js/vendor/three";
  const TILT = 11 * Math.PI / 180;                      // how far the camera leans back from looking straight down
  let libs = null;
  let shared = null;                                     // one renderer for all games (a page may only hold so many WebGL contexts)
  let webgl = null;

  function wanted() {
    if (typeof document === "undefined" || typeof document.createElement !== "function") return false;
    try { if (window.localStorage && window.localStorage.getItem("saturn.lift3d") === "off") return false; } catch (error) { /* no storage */ }
    if (webgl === null) {
      try { const c = document.createElement("canvas"); webgl = !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (error) { webgl = false; }
    }
    return webgl;
  }
  function loadThree() {
    if (!libs) {
      libs = (async () => {
        const [T, room] = await Promise.all([import(`${BASE}/three.module.min.js`), import(`${BASE}/RoomEnvironment.js`)]);
        T.ColorManagement.enabled = false;
        return { T, RoomEnvironment: room.RoomEnvironment };
      })().catch(() => { libs = null; return null; });
    }
    return libs;
  }
  function sharedRenderer(L, dpr) {
    if (shared && shared.renderer && !shared.lost) { shared.renderer.setPixelRatio(dpr); shared.renderer.setSize(W, H, false); return shared; }
    const { T, RoomEnvironment } = L;
    const canvas = document.createElement("canvas");
    const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = T.LinearSRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    const pmrem = new T.PMREMGenerator(renderer);
    const envMap = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
    pmrem.dispose();
    canvas.addEventListener("webglcontextlost", (event) => { event.preventDefault(); if (shared) shared.lost = true; });
    shared = { T, canvas, renderer, envMap, lost: false };
    return shared;
  }

  const rgbaKey = (c) => (c ? `${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${Math.round(c[3] * 100)}` : "-");

  /* view(realContext, dpr): the recorder for the game plus everything to show it in 3D. `ctx` is what the game draws on; `ready` turns true when three.js is loaded; `render(t)` draws the recorded
     frame into the real canvas; `unproject(clientX, clientY, box)` answers where the finger is on the field; `failed` says that the games must go on in 2D. */
  function view(realCtx, dpr = 1) {
    const rec = makeRecorder();
    const v = { ctx: rec, ready: false, failed: false, onFail: null, onReady: null, stats: { frames: 0, spent: 0 } };
    try { rec.useMeasure(document.createElement("canvas").getContext("2d")); } catch (error) { /* approximate widths */ }
    let S = null, scene = null, camera = null, parts = null;
    const sinkP = makeSink(CAP_PRISMS), sinkD = makeSink(CAP_DECALS);
    const texCache = new Map();
    const quadPool = [];
    let quadUsed = 0;
    let blobTex = null;
    let dist = 900;
    const imageTex = new WeakMap();
    const UV_FULL = [0, 1, 1, 1, 1, 0, 0, 0];

    function fail() { if (v.failed) return; v.failed = true; v.destroy(); if (v.onFail) v.onFail(); }

    function setup(L) {
      const { T } = L;
      S = sharedRenderer(L, dpr);
      scene = new T.Scene();
      scene.environment = S.envMap;
      scene.add(new T.HemisphereLight(0xffffff, 0xb4b9c6, 2.3));            // (lights count in physical units: about three times what the flat colours need)
      const sun = new T.DirectionalLight(0xfff3df, 1.7);
      sun.position.set(-120, 210, 330);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1536);
      Object.assign(sun.shadow.camera, { left: -330, right: 330, top: 430, bottom: -430, near: 20, far: 900 });
      sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.7; sun.shadow.radius = 3;
      scene.add(sun);
      const dyn = (arr, size, norm) => { const a = new T.BufferAttribute(arr, size, norm); a.setUsage(T.DynamicDrawUsage); return a; };
      const prismGeo = new T.BufferGeometry();
      prismGeo.setAttribute("position", dyn(sinkP.pos, 3)); prismGeo.setAttribute("normal", dyn(sinkP.nor, 3)); prismGeo.setAttribute("color", dyn(sinkP.col, 4, true));
      prismGeo.setDrawRange(0, 0);
      const prismMat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, envMapIntensity: 0.28 });
      const prisms = new T.Mesh(prismGeo, prismMat);
      prisms.frustumCulled = false; prisms.castShadow = true; prisms.receiveShadow = true;
      scene.add(prisms);
      const decalGeo = new T.BufferGeometry();
      decalGeo.setAttribute("position", dyn(sinkD.pos, 3)); decalGeo.setAttribute("normal", dyn(sinkD.nor, 3)); decalGeo.setAttribute("color", dyn(sinkD.col, 4, true));
      decalGeo.setDrawRange(0, 0);
      const decalMat = new T.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const decals = new T.Mesh(decalGeo, decalMat);
      decals.frustumCulled = false; decals.renderOrder = 1;
      scene.add(decals);
      const floor = new T.Mesh(new T.PlaneGeometry(W + 600, H + 800), new T.ShadowMaterial({ opacity: 0.34 }));
      floor.position.z = 0.02; floor.receiveShadow = true; floor.renderOrder = 0;
      scene.add(floor);
      camera = new T.PerspectiveCamera(38, W / H, 20, 4000);
      parts = { prismGeo, decalGeo, prismMat, decalMat, floor };
      fitCamera();
    }

    /* the camera: leaning back by TILT, as near as it can be with the whole field in the picture */
    function place(sway, t) {
      const x = sway * Math.sin(t * 0.55) * 24, lean = TILT + sway * Math.sin(t * 0.4) * 0.045;
      camera.position.set(x, -Math.sin(lean) * dist, Math.cos(lean) * dist);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
    }
    function fitCamera() {
      for (let d = 500; d < 3400; d += 20) {
        dist = d;
        place(0, 0);
        camera.updateProjectionMatrix();
        let ok = true;
        for (const [x, y] of [[-W / 2, -H / 2], [W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2]]) {
          const p = new S.T.Vector3(x, y, 0).project(camera);
          if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) { ok = false; break; }
        }
        if (ok) return;
      }
    }

    function quad() {
      if (quadUsed === quadPool.length) {
        const { T } = S;
        const geo = new T.BufferGeometry();
        const position = new T.BufferAttribute(new Float32Array(12), 3); position.setUsage(T.DynamicDrawUsage);
        const uv = new T.BufferAttribute(new Float32Array(UV_FULL), 2); uv.setUsage(T.DynamicDrawUsage);
        geo.setAttribute("position", position); geo.setAttribute("uv", uv);
        geo.setIndex([0, 1, 2, 0, 2, 3]);
        const mat = new T.MeshBasicMaterial({ transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
        const mesh = new T.Mesh(geo, mat);
        mesh.frustumCulled = false;
        scene.add(mesh);
        quadPool.push(mesh);
      }
      const mesh = quadPool[quadUsed++];
      mesh.visible = true;
      mesh.renderOrder = 2 + quadUsed;
      return mesh;
    }
    function setQuad(mesh, corners, z, tex, alpha, uv) {
      const a = mesh.geometry.attributes.position.array;
      for (let i = 0; i < 4; i += 1) { a[i * 3] = corners[i][0] - W / 2; a[i * 3 + 1] = H / 2 - corners[i][1]; a[i * 3 + 2] = z; }
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.attributes.uv.array.set(uv);
      mesh.geometry.attributes.uv.needsUpdate = true;
      if (mesh.material.map !== tex) { mesh.material.map = tex; mesh.material.needsUpdate = true; }
      mesh.material.opacity = Math.max(0, Math.min(1, alpha));
    }

    function remember(key, make) {
      let hit = texCache.get(key);
      if (hit) { texCache.delete(key); texCache.set(key, hit); return hit; }
      hit = make();
      texCache.set(key, hit);
      if (texCache.size > 260) { const old = texCache.keys().next().value; texCache.get(old).tex.dispose(); texCache.delete(old); }
      return hit;
    }
    const rgbaText = (c) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3]})`;
    function textPicture(it) {
      const key = `${it.font}|${it.text}|${rgbaKey(it.fill)}|${rgbaKey(it.outline)}|${it.outline ? it.lw : 0}|${it.align}|${it.baseline}`;
      return remember(key, () => {
        const k = 2;
        const c = document.createElement("canvas");
        const g = c.getContext("2d");
        const font = it.font.replace(/(\d+(?:\.\d+)?)px/, (m, n) => `${parseFloat(n) * k}px`);
        g.font = font;
        const w = g.measureText(it.text).width;
        const pad = Math.ceil(it.size * 0.35 * k + (it.outline ? it.lw * k : 0));
        c.width = Math.min(1024, Math.max(8, Math.ceil(w + pad * 2)));
        c.height = Math.min(1024, Math.max(8, Math.ceil(it.size * k * 2.6)));
        g.font = font;
        g.textAlign = it.align;
        g.textBaseline = it.baseline;
        g.lineJoin = "round";
        const ax = it.align === "center" ? c.width / 2 : it.align === "right" || it.align === "end" ? c.width - pad : pad, ay = c.height / 2;
        if (it.outline) { g.lineWidth = it.lw * k; g.strokeStyle = rgbaText(it.outline); g.strokeText(it.text, ax, ay); }
        if (it.fill) { g.fillStyle = rgbaText(it.fill); g.fillText(it.text, ax, ay); }
        const tex = new S.T.CanvasTexture(c);
        tex.generateMipmaps = false; tex.minFilter = S.T.LinearFilter;
        return { tex, cw: c.width, ch: c.height, k, ax, ay };
      });
    }
    function glowPicture(gl) {
      const [x0, y0, x1, y1] = gl.box;
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0), grad = gl.paint.grad;
      const rel = [(grad.c0[0] - x0) / w, (grad.c0[1] - y0) / h, (grad.c1[0] - x0) / w, (grad.c1[1] - y0) / h, grad.r0 / w, grad.r1 / w];
      const key = `glow|${Math.round(w)}x${Math.round(h)}|${rel.map((n) => n.toFixed(2)).join(",")}|${grad.stops.map((s) => `${s[0].toFixed(2)}:${rgbaKey(s[1])}`).join(";")}`;
      return remember(key, () => {
        const c = document.createElement("canvas");
        c.width = Math.max(8, Math.min(128, Math.round(w / 2))); c.height = Math.max(8, Math.min(128, Math.round(h / 2)));
        const g = c.getContext("2d");
        g.scale(c.width / w, c.height / h);
        const r = g.createRadialGradient(grad.c0[0] - x0, grad.c0[1] - y0, grad.r0, grad.c1[0] - x0, grad.c1[1] - y0, Math.max(0.01, grad.r1));
        for (const [o, col] of grad.stops) r.addColorStop(o, rgbaText(col));
        g.fillStyle = r; g.fillRect(0, 0, w, h);
        const tex = new S.T.CanvasTexture(c);
        tex.generateMipmaps = false; tex.minFilter = S.T.LinearFilter;
        return { tex };
      });
    }
    function blob() {
      if (blobTex) return blobTex;
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d");
      const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      r.addColorStop(0, "rgba(0,0,0,0.55)"); r.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = r; g.fillRect(0, 0, 64, 64);
      blobTex = new S.T.CanvasTexture(c);
      return blobTex;
    }
    function imagePicture(src) {
      let pic = imageTex.get(src);
      if (!pic) {
        const live = !((typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) || (typeof ImageBitmap !== "undefined" && src instanceof ImageBitmap));
        const tex = live ? new S.T.CanvasTexture(src) : new S.T.Texture(src);
        tex.generateMipmaps = false; tex.minFilter = S.T.LinearFilter;
        pic = { tex, live };
        imageTex.set(src, pic);
        tex.needsUpdate = true;
      } else if (pic.live) pic.tex.needsUpdate = true;
      return pic;
    }
    const cornersOf = (m, x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
    function upload(sink, geo) {
      geo.setDrawRange(0, sink.n);
      for (const name of ["position", "normal", "color"]) {
        const a = geo.attributes[name];
        a.clearUpdateRanges();
        a.addUpdateRange(0, sink.n * a.itemSize);
        a.needsUpdate = true;
      }
    }

    v.render = (t) => {
      if (!v.ready || v.failed) return;
      const start = performance.now();
      try {
        const plan = layout(rec.items());
        build(plan, { prisms: sinkP, decals: sinkD });
        upload(sinkP, parts.prismGeo);
        upload(sinkD, parts.decalGeo);
        quadUsed = 0;
        for (const gl of plan.glows) {
          const [x0, y0, x1, y1] = gl.box;
          setQuad(quad(), [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], gl.z, glowPicture(gl).tex, gl.alpha, UV_FULL);
        }
        for (const q of plan.quads) {
          const it = q.item;
          if (q.kind === "text") {
            const pic = textPicture(it);
            if (it.emoji) {                                // a soft shadow on the ground under a figure that floats above it
              const s = it.size, m = it.m, px = m[0] * it.x + m[2] * (it.y + s * 0.34) + m[4] + 3.5, py = m[1] * it.x + m[3] * (it.y + s * 0.34) + m[5] + 5;
              setQuad(quad(), [[px - s * 0.5, py - s * 0.17], [px + s * 0.5, py - s * 0.17], [px + s * 0.5, py + s * 0.17], [px - s * 0.5, py + s * 0.17]], q.base + 0.1, blob(), it.alpha * 0.8, UV_FULL);
            }
            setQuad(quad(), cornersOf(it.m, it.x - pic.ax / pic.k, it.y - pic.ay / pic.k, pic.cw / pic.k, pic.ch / pic.k), q.z, pic.tex, it.alpha, UV_FULL);
          } else {
            const pic = imagePicture(it.src);
            const sw = it.src.naturalWidth || it.src.videoWidth || it.src.width || 1, sh = it.src.naturalHeight || it.src.videoHeight || it.src.height || 1;
            const part = it.sx !== null;
            const u0 = part ? it.sx / sw : 0, u1 = part ? (it.sx + it.sw) / sw : 1, v0 = part ? 1 - it.sy / sh : 1, v1 = part ? 1 - (it.sy + it.sh) / sh : 0;
            setQuad(quad(), cornersOf(it.m, it.x, it.y, it.w, it.h), q.z, pic.tex, it.alpha, [u0, v0, u1, v0, u1, v1, u0, v1]);
          }
        }
        for (let i = quadUsed; i < quadPool.length; i += 1) quadPool[i].visible = false;
        place(1, t);
        S.renderer.render(scene, camera);
        realCtx.drawImage(S.canvas, 0, 0, W, H);
      } catch (error) {
        fail();
        return;
      }
      v.stats.frames += 1;
      v.stats.spent += performance.now() - start;
      if (v.stats.frames === 150 && v.stats.spent / v.stats.frames > 24) fail();       // too slow for this device: the games go on flat
    };

    /* where the finger is on the field (the pixels of the field, 0..360 by 0..640), or null when the camera is not there yet */
    v.unproject = (clientX, clientY, box) => {
      if (!v.ready || !camera || !box || !box.width || !box.height) return null;
      const vec = new S.T.Vector3(((clientX - box.left) / box.width) * 2 - 1, 1 - ((clientY - box.top) / box.height) * 2, 0.5).unproject(camera);
      const o = camera.position;
      const dz = vec.z - o.z;
      if (Math.abs(dz) < 1e-6) return null;
      const k = (4 - o.z) / dz;                           // the plane 4 pixels above the floor: where the tops of the things are
      return [o.x + (vec.x - o.x) * k + W / 2, H / 2 - (o.y + (vec.y - o.y) * k)];
    };
    v.begin = () => rec.begin();
    v.destroy = () => {
      for (const entry of texCache.values()) entry.tex.dispose();
      texCache.clear();
      if (blobTex) blobTex.dispose();
      blobTex = null;
      if (parts) {
        parts.prismGeo.dispose(); parts.decalGeo.dispose(); parts.prismMat.dispose(); parts.decalMat.dispose(); parts.floor.geometry.dispose(); parts.floor.material.dispose();
        for (const m of quadPool) { m.geometry.dispose(); m.material.dispose(); }
        parts = null;
      }
      quadPool.length = 0;
      v.ready = false;
    };
    loadThree().then((L) => {
      if (v.failed) return;
      if (!L) { fail(); return; }
      try { setup(L); v.ready = true; if (v.onReady) v.onReady(); } catch (error) { fail(); }
    });
    return v;
  }

  const lift = { W, H, parseColor, paintAt, makeRecorder, layout, build, makeSink, triangulate, addPrism, addFlat, CAP_PRISMS, CAP_DECALS, CELL, MAX_TOP, isEmoji, wanted, view, TILT };
  if (typeof window !== "undefined") { window.PulseGames = window.PulseGames || {}; window.PulseGames.lift = lift; }
  if (typeof module !== "undefined" && module.exports) module.exports = lift;
})();
