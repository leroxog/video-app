/* raumo sim: a make-believe camera for a make-believe room.  It looks into a room (walls, floor, ceiling, doors and windows, and a few
   pieces of furniture) from any place and says, for every pixel, how far away what it sees is and what colour it has -- exactly what a
   phone with a depth sensor delivers while somebody walks through a room.  It is used to test the scan of walking through a room
   without a phone, and to let anybody try the walk-through scan on a computer.  Pure functions (browser and Node). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./raumo-core.js"));
  else root.RaumoSim = factory(root.RaumoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  const DEG = Core.DEG;

  /* A scene: the room, pictures for its surfaces ({surfaceId: {width, height, data: RGBA}}) and boxes (furniture):
     [{min: [x, y, z], max: [x, y, z], color: [r, g, b]}]. */
  function makeScene(room, options = {}) {
    return { room, walls: Core.wallsOf(room.polygon), pictures: options.pictures || {}, boxes: options.boxes || [], box: Core.bounds(room.polygon) };
  }

  const sample = (picture, fu, fv, fallback) => {
    if (!picture) return fallback;
    const x = Math.min(picture.width - 1, Math.max(0, Math.floor(fu * picture.width))), y = Math.min(picture.height - 1, Math.max(0, Math.floor(fv * picture.height)));
    const i = (y * picture.width + x) * 4;
    return [picture.data[i], picture.data[i + 1], picture.data[i + 2]];
  };

  /* The first thing the ray from `origin` along `dir` hits: {t, color} or null (when it leaves through an opening, or sees nothing).
     `dir` need not be of length one: t is then the distance in units of dir. */
  function cast(scene, origin, dir) {
    const { room, walls, pictures, boxes, box } = scene;
    let best = null;
    const take = (t, color) => { if (t > 1e-6 && (!best || t < best.t)) best = { t, color }; };

    if (dir[1] < -1e-9) {
      const t = -origin[1] / dir[1];
      const x = origin[0] + dir[0] * t, z = origin[2] + dir[2] * t;
      if (Core.pointInPolygon([x, z], room.polygon)) take(t, sample(pictures.floor, (x - box.minX) / box.width, (z - box.minZ) / box.depth, [189, 165, 135]));
    }
    if (dir[1] > 1e-9) {
      const t = (room.height - origin[1]) / dir[1];
      const x = origin[0] + dir[0] * t, z = origin[2] + dir[2] * t;
      if (Core.pointInPolygon([x, z], room.polygon)) take(t, sample(pictures.ceiling, (x - box.minX) / box.width, (z - box.minZ) / box.depth, [247, 247, 244]));
    }
    for (const wall of walls) {
      const nx = wall.inward[0], nz = wall.inward[1];
      const denom = dir[0] * nx + dir[2] * nz;
      if (denom >= -1e-9) continue;
      const t = ((wall.a[0] - origin[0]) * nx + (wall.a[1] - origin[2]) * nz) / denom;
      if (t <= 1e-6 || (best && t >= best.t)) continue;
      const hx = origin[0] + dir[0] * t, hy = origin[1] + dir[1] * t, hz = origin[2] + dir[2] * t;
      const u = (hx - wall.a[0]) * wall.dir[0] + (hz - wall.a[1]) * wall.dir[1];
      if (u < 0 || u > wall.len || hy < 0 || hy > room.height) continue;
      if (room.openings.some((o) => o.wall === wall.index && u > o.u0 && u < o.u1 && hy > o.v0 && hy < o.v1)) continue;      // out through a door or window
      take(t, sample(pictures[`wall:${wall.index}`], u / wall.len, 1 - hy / room.height, [236, 233, 226]));
    }
    for (const b of boxes) {
      let t0 = 0, t1 = Infinity, face = -1;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(dir[a]) < 1e-12) { if (origin[a] < b.min[a] || origin[a] > b.max[a]) { t1 = -1; break; } continue; }
        let ta = (b.min[a] - origin[a]) / dir[a], tb = (b.max[a] - origin[a]) / dir[a];
        if (ta > tb) [ta, tb] = [tb, ta];
        if (ta > t0) { t0 = ta; face = a; }
        t1 = Math.min(t1, tb);
        if (t0 > t1) break;
      }
      if (t0 <= t1 && t1 > 0 && face >= 0 && t0 > 1e-6) {
        const shade = [0.8, 1.0, 0.65][face];                                            // sides are darker than the top
        take(t0, b.color.map((c) => c * shade));
      }
    }
    return best;
  }

  /* What a camera standing at `position` and looking along `forward` (up is `up`) sees. `fov` is the angle along the longer side of
     the picture in degrees. Returns the frame that Cloud.unproject takes, with a depth picture of depthSize [width, height] and a colour
     picture of colorSize.  `noise` is the relative error of the depth readings (a fraction, for example 0.01); `random` a function
     that gives numbers between 0 and 1 (so tests are repeatable). */
  function renderFrame(scene, position, forward, up, options = {}) {
    const fov = options.fov || 70;
    const [dw, dh] = options.depthSize || [64, 36];
    const [cw, ch] = options.colorSize || [dw * 2, dh * 2];
    const wide = dw >= dh;
    const longTan = Math.tan(fov * DEG / 2);
    const tanX = wide ? longTan : longTan * dw / dh, tanY = wide ? longTan * dh / dw : longTan;
    const right = Core.normalize(Core.cross(forward, up));
    const upv = Core.cross(right, forward);
    const random = options.random || Math.random;
    const noise = options.noise || 0;
    const depth = new Float32Array(dw * dh);
    const color = new Uint8ClampedArray(cw * ch * 4);
    const ray = (nx, ny) => [forward[0] + right[0] * nx * tanX + upv[0] * ny * tanY, forward[1] + right[1] * nx * tanX + upv[1] * ny * tanY, forward[2] + right[2] * nx * tanX + upv[2] * ny * tanY];
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const hit = cast(scene, position, ray(((x + 0.5) / dw) * 2 - 1, 1 - ((y + 0.5) / dh) * 2));
        let z = hit ? hit.t : 0;
        if (z && noise) z *= 1 + noise * (random() + random() + random() - 1.5) * 1.1547;               // roughly normal, standard deviation `noise`
        depth[y * dw + x] = z;
      }
    }
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const hit = cast(scene, position, ray(((x + 0.5) / cw) * 2 - 1, 1 - ((y + 0.5) / ch) * 2));
        const o = (y * cw + x) * 4;
        const c = hit ? hit.color : [30, 30, 36];
        color[o] = c[0]; color[o + 1] = c[1]; color[o + 2] = c[2]; color[o + 3] = 255;
      }
    }
    return { camera: { position, forward, up: upv, right, tanX, tanY }, depth: { width: dw, height: dh, data: depth }, color: { width: cw, height: ch, data: color } };
  }

  /* A walk through the room: `steps` camera places along a loop (nearly) around the middle, looking about the way somebody does who is
     scanning (turning, tipping the phone down to the floor and up to the ceiling). Returns [{position, forward, up}]. */
  function walkPath(room, steps = 120, eye = 1.4) {
    const b = Core.bounds(room.polygon);
    const c = Core.centroid(room.polygon);
    const out = [];
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const angle = t * Math.PI * 2;
      const position = [c[0] + Math.cos(angle) * b.width * 0.22, eye, c[1] + Math.sin(angle) * b.depth * 0.22];
      const yaw = t * 360 * 3 + 20;
      const pitch = 28 * Math.sin(t * Math.PI * 2 * 7);
      const view = Core.viewFromYawPitch(yaw, pitch);
      out.push({ position, forward: view.forward, up: view.up });
    }
    return out;
  }

  /* A few pieces of furniture inside a room (a sofa, a table), placed relative to its middle. */
  function furniture(room) {
    const b = Core.bounds(room.polygon);
    const c = Core.centroid(room.polygon);
    return [
      { min: [c[0] - b.width * 0.1, 0, c[1] - b.depth * 0.38], max: [c[0] + b.width * 0.28, 0.85, c[1] - b.depth * 0.22], color: [120, 70, 60] },                // a sofa near the north wall
      { min: [c[0] + b.width * 0.02, 0, c[1] + b.depth * 0.02], max: [c[0] + b.width * 0.16, 0.72, c[1] + b.depth * 0.14], color: [200, 190, 160] },            // a table
    ];
  }

  return { makeScene, cast, renderFrame, walkPath, furniture };
});
