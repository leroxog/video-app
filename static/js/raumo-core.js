/* raumo core: the geometry of the room scanner, as plain functions that run in the browser and in Node (that is how the tests run
   them).  Nothing here touches the screen, the camera or the sensors.

   The idea of the scan: the phone stays on one spot, held upright at a known height h above the floor, and is turned on the spot.
   Whatever lies on the floor (the foot of a wall, a corner) is seen under a downward angle p, so it is h / tan(p) away: that is all
   it takes to draw the floor plan. Aiming at the place where a wall meets the ceiling gives the height of the room; aiming at the
   edge of a door or a window on a wall gives where it is (the aim line is cut with the wall). The photos taken while turning are
   laid over the walls afterwards.

   World: metres; x to the east, y up, z to the south (a right-handed system); the phone's spot is (0, h, 0), the floor is y = 0.
   Plans: a point is [x, z]; a polygon is a list of them.  A polygon is "positive" when signedArea > 0, and then the room lies to
   the left of every edge a -> b, so the inward normal of an edge with direction (dx, dz) is (-dz, dx). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RaumoCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEG = Math.PI / 180;
  const EPS = 1e-9;

  // ------------------------------------------------------------------------------------------------ vectors
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a) => Math.hypot(a[0], a[1], a[2]);
  const normalize = (a) => {
    const l = length(a);
    return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
  };
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // ------------------------------------------------------------------------------------------- orientation
  /* The phone reports three angles in degrees (the W3C "device orientation": alpha about the vertical, beta about the phone's x axis,
     gamma about its y axis; the matrix is Rz(alpha) Rx(beta) Ry(gamma) in an east-north-up frame).  This gives the phone's three
     axes in our world (x east, y up, z south).  Held upright and looking north: alpha = 0, beta = 90, gamma = 0. */
  function deviceAxes(alpha, beta, gamma) {
    const a = alpha * DEG, b = beta * DEG, g = gamma * DEG;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
    // columns of R = Rz(a) Rx(b) Ry(g), as east-north-up vectors
    const xe = [ca * cg - sa * sb * sg, sa * cg + ca * sb * sg, -cb * sg];
    const ye = [-sa * cb, ca * cb, sb];
    const ze = [ca * sg + sa * sb * cg, sa * sg - ca * sb * cg, cb * cg];
    const toWorld = (v) => [v[0], v[2], -v[1]];                    // east, north, up  ->  x, y, z
    return { x: toWorld(xe), y: toWorld(ye), z: toWorld(ze) };
  }

  /* Where the back camera looks (forward), what is up in the picture and what is right, for the angles above.
     `screenAngle` is the rotation of the page (0 upright, 90, 180, 270): the picture follows the page, not the phone. */
  function viewFromOrientation(alpha, beta, gamma, screenAngle = 0) {
    const d = deviceAxes(alpha, beta, gamma);
    const s = screenAngle * DEG;
    const up = add(mul(d.x, Math.sin(s)), mul(d.y, Math.cos(s)));
    const right = sub(mul(d.x, Math.cos(s)), mul(d.y, Math.sin(s)));
    return { forward: normalize(mul(d.z, -1)), up: normalize(up), right: normalize(right) };
  }

  /* A view from where somebody looks (degrees): yaw 0 looks along -z, positive yaw turns to the right; positive pitch looks up. */
  function viewFromYawPitch(yaw, pitch, roll = 0) {
    const y = yaw * DEG, p = pitch * DEG, r = roll * DEG;
    const forward = [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
    const right0 = normalize(cross(forward, [0, 1, 0]));
    const up0 = normalize(cross(right0, forward));
    const right = add(mul(right0, Math.cos(r)), mul(up0, Math.sin(r)));
    const up = sub(mul(up0, Math.cos(r)), mul(right0, Math.sin(r)));
    return { forward, up, right };
  }

  /* The average of several views (the phone shakes a little in the hand). */
  function averageViews(views) {
    if (!views.length) return null;
    let f = [0, 0, 0], u = [0, 0, 0];
    for (const v of views) { f = add(f, v.forward); u = add(u, v.up); }
    const forward = normalize(f);
    const right = normalize(cross(forward, normalize(u)));
    const up = normalize(cross(right, forward));
    return { forward, up, right };
  }

  const pitchDeg = (forward) => Math.asin(clamp(forward[1], -1, 1)) / DEG;           // above the horizon: positive
  const yawDeg = (forward) => Math.atan2(forward[0], -forward[2]) / DEG;             // like viewFromYawPitch

  // ------------------------------------------------------------------------------------------------- aiming
  /* The spot on the floor under the cross hair, seen from a phone at height h, or null when the cross hair is not pointing
     clearly downward (less than `minPitch` degrees below the horizon).  `error` is how many percent the distance is off when the
     angle is off by half a degree: it grows quickly toward the horizon, so far-away corners are not trusted blindly. */
  function floorPoint(forward, h, minPitch = 3) {
    const down = -forward[1];
    if (down <= Math.sin(minPitch * DEG)) return null;
    const t = h / down;
    const x = forward[0] * t, z = forward[2] * t;
    const p = Math.asin(down);
    const error = (0.5 * DEG) / (Math.sin(p) * Math.cos(p)) * 100;
    return { x, z, distance: Math.hypot(x, z), pitch: p / DEG, error };
  }

  /* The height of the room from an aim at the edge between wall and ceiling, above a floor point that is `distance` away. */
  function heightFromAim(forward, distance, h) {
    const flat = Math.hypot(forward[0], forward[2]);
    if (forward[1] <= 0 || flat < 1e-6) return null;
    return h + distance * forward[1] / flat;
  }

  // ------------------------------------------------------------------------------------------------ polygons
  function signedArea(poly) {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }

  const polygonArea = (poly) => Math.abs(signedArea(poly));
  const perimeter = (poly) => poly.reduce((sum, a, i) => sum + Math.hypot(poly[(i + 1) % poly.length][0] - a[0], poly[(i + 1) % poly.length][1] - a[1]), 0);

  /* The same polygon, going around the other way if needed so that its signed area is positive. */
  function positive(poly) {
    return signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice();
  }

  function centroid(poly) {
    const area = signedArea(poly);
    if (Math.abs(area) < EPS) {
      const n = poly.length || 1;
      return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
    }
    let cx = 0, cz = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const f = a[0] * b[1] - b[0] * a[1];
      cx += (a[0] + b[0]) * f;
      cz += (a[1] + b[1]) * f;
    }
    return [cx / (6 * area), cz / (6 * area)];
  }

  function bounds(poly) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    return { minX, minZ, maxX, maxZ, width: maxX - minX, depth: maxZ - minZ };
  }

  function segmentsCross(p, q, r, s) {
    const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = o(p, q, r), d2 = o(p, q, s), d3 = o(r, s, p), d4 = o(r, s, q);
    return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
  }

  /* No two edges cross (a room must not cut through itself). */
  function isSimple(poly) {
    const n = poly.length;
    if (n < 3) return false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
      }
    }
    return true;
  }

  function pointInPolygon(point, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  /* Drops points that lie (almost) on the line between their neighbours and points that sit on top of each other. */
  function simplify(poly, tolerance = 0.02) {
    let out = poly.map((p) => p.slice());
    let changed = true;
    while (changed && out.length > 3) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const a = out[(i + out.length - 1) % out.length], b = out[i], c = out[(i + 1) % out.length];
        const base = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const off = base < EPS ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / base;
        if (off < tolerance || Math.hypot(b[0] - a[0], b[1] - a[1]) < tolerance) { out.splice(i, 1); changed = true; break; }
      }
    }
    return out;
  }

  /* Rooms are mostly right-angled.  The walls whose direction is within `tolerance` degrees of the room's main directions (found from
     the long walls) are straightened to them, and the corners are put where the straightened walls meet.  Other walls stay as they are. */
  function orthogonalize(poly, tolerance = 12) {
    const n = poly.length;
    if (n < 3) return { polygon: poly.map((p) => p.slice()), snapped: 0 };
    const edges = poly.map((a, i) => {
      const b = poly[(i + 1) % n];
      return { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    });
    let sx = 0, sz = 0;
    for (const e of edges) { sx += e.len * Math.cos(4 * e.angle); sz += e.len * Math.sin(4 * e.angle); }
    const main = Math.atan2(sz, sx) / 4;
    const lines = edges.map((e) => {
      const k = Math.round((e.angle - main) / (Math.PI / 2));
      const target = main + k * Math.PI / 2;
      let diff = e.angle - target;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const snap = Math.abs(diff) <= tolerance * DEG;
      const angle = snap ? target : e.angle;
      const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
      return { point: mid, dir: [Math.cos(angle), Math.sin(angle)], snap };
    });
    const out = [];
    let snapped = 0;
    for (let i = 0; i < n; i++) {
      const prev = lines[(i + n - 1) % n], next = lines[i];
      const det = prev.dir[0] * next.dir[1] - prev.dir[1] * next.dir[0];
      if (Math.abs(det) < 1e-6) {                                  // parallel: keep the corner, put it onto the next wall
        const p = poly[i], d = next.dir;
        const t = (p[0] - next.point[0]) * d[0] + (p[1] - next.point[1]) * d[1];
        out.push([next.point[0] + d[0] * t, next.point[1] + d[1] * t]);
      } else {
        const dx = next.point[0] - prev.point[0], dz = next.point[1] - prev.point[1];
        const t = (dx * next.dir[1] - dz * next.dir[0]) / det;
        out.push([prev.point[0] + prev.dir[0] * t, prev.point[1] + prev.dir[1] * t]);
      }
      if (next.snap) snapped += 1;
    }
    return { polygon: out, snapped };
  }

  /* Cuts a simple polygon (any orientation) into triangles (index triples, counter-clockwise in the plan). */
  function triangulate(poly) {
    const n = poly.length;
    if (n < 3) return [];
    const idx = poly.map((_, i) => i);
    if (signedArea(poly) < 0) idx.reverse();
    const tri = [];
    const cross2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cross2(a, b, p) >= -1e-12 && cross2(b, c, p) >= -1e-12 && cross2(c, a, p) >= -1e-12;
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let k = 0; k < idx.length; k++) {
        const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
        const a = poly[ia], b = poly[ib], c = poly[ic];
        if (cross2(a, b, c) <= 1e-12) continue;                    // a reflex (or flat) corner is no ear
        let ear = true;
        for (const j of idx) {
          if (j === ia || j === ib || j === ic) continue;
          if (inside(poly[j], a, b, c)) { ear = false; break; }
        }
        if (!ear) continue;
        tri.push([ia, ib, ic]);
        idx.splice(k, 1);
        cut = true;
        break;
      }
      if (!cut) break;                                              // not a simple polygon: stop with what we have
    }
    if (idx.length === 3) tri.push([idx[0], idx[1], idx[2]]);
    return tri;
  }

  /* The polygon moved outward by `distance` (corners are mitred; very sharp corners are cut short). */
  function offsetPolygon(poly, distance) {
    const p = positive(poly);
    const n = p.length;
    const walls = wallsOf(p);
    const out = [];
    for (let i = 0; i < n; i++) {
      const w1 = walls[(i + n - 1) % n], w2 = walls[i];
      const n1 = [-w1.inward[0], -w1.inward[1]], n2 = [-w2.inward[0], -w2.inward[1]];
      const det = n1[0] * n2[1] - n1[1] * n2[0];
      let m;
      if (Math.abs(det) < 1e-6) m = [n1[0] * distance, n1[1] * distance];
      else m = [distance * (n2[1] - n1[1]) / det, distance * (n1[0] - n2[0]) / det];
      const l = Math.hypot(m[0], m[1]);
      if (l > 3 * Math.abs(distance)) m = [m[0] * 3 * Math.abs(distance) / l, m[1] * 3 * Math.abs(distance) / l];
      out.push([p[i][0] + m[0], p[i][1] + m[1]]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- the room
  /* The walls of a positive polygon: start a, end b, length, direction and the normal that points into the room. */
  function wallsOf(poly) {
    const n = poly.length;
    return poly.map((a, i) => {
      const b = poly[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const dir = len < EPS ? [1, 0] : [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
      return { index: i, a, b, len, dir, inward: [-dir[1], dir[0]] };
    });
  }

  const OPENING_KINDS = { door: "Tür", window: "Fenster", passage: "Durchgang" };
  const MIN_OPENING = 0.2;
  const MAX_ROOM = 60;

  /* A room as the rest of the code wants it: a positive polygon, a height, the phone's height and openings that fit their walls. */
  function makeRoom(data) {
    const polygon = positive(data.polygon.map((p) => [Number(p[0]), Number(p[1])]));
    const height = clamp(Number(data.height) || 2.5, 1.5, 10);
    const room = {
      polygon, height,
      phoneHeight: clamp(Number(data.phoneHeight) || 1.4, 0.3, 3),
      thickness: clamp(data.thickness == null ? 0.12 : Number(data.thickness), 0.02, 0.6),
      openings: [],
    };
    const walls = wallsOf(polygon);
    for (const o of data.openings || []) {
      const fixed = fitOpening(o, walls, height);
      if (fixed && !room.openings.some((other) => openingsOverlap(other, fixed))) room.openings.push(fixed);
    }
    return room;
  }

  /* An opening cut to its wall: u along the wall from its start, v above the floor (metres); null if nothing sensible is left. */
  function fitOpening(o, walls, height) {
    const wall = walls[o.wall];
    if (!wall) return null;
    const u0 = clamp(Math.min(o.u0, o.u1), 0.02, wall.len - 0.02);
    const u1 = clamp(Math.max(o.u0, o.u1), 0.02, wall.len - 0.02);
    const v0 = clamp(Math.min(o.v0, o.v1), 0, height - 0.05);
    const v1 = clamp(Math.max(o.v0, o.v1), 0, height - 0.05);
    if (u1 - u0 < MIN_OPENING || v1 - v0 < MIN_OPENING) return null;
    const kind = OPENING_KINDS[o.kind] ? o.kind : "window";
    return { wall: o.wall, u0, u1, v0: kind === "window" ? v0 : 0, v1, kind };
  }

  function openingsOverlap(a, b) {
    return a.wall === b.wall && a.u0 < b.u1 && b.u0 < a.u1 && a.v0 < b.v1 && b.v0 < a.v1;
  }

  /* The first wall (and the point on it) that a line of sight from `origin` along `dir` meets, or null.  Returns the wall, the
     position along it (u), the height (v) and the distance (t). */
  function wallHit(room, origin, dir) {
    let best = null;
    for (const wall of wallsOf(room.polygon)) {
      const n3 = [wall.inward[0], 0, wall.inward[1]];
      const denom = dot(dir, n3);
      if (denom >= -1e-9) continue;                                  // looking away from this wall's inside
      const t = dot(sub([wall.a[0], 0, wall.a[1]], origin), n3) / denom;
      if (t <= 0) continue;
      const hit = add(origin, mul(dir, t));
      const u = (hit[0] - wall.a[0]) * wall.dir[0] + (hit[2] - wall.a[1]) * wall.dir[1];
      const v = hit[1];
      if (u < -1e-6 || u > wall.len + 1e-6 || v < -1e-6 || v > room.height + 1e-6) continue;
      if (!best || t < best.t) best = { wall: wall.index, u: clamp(u, 0, wall.len), v: clamp(v, 0, room.height), t };
    }
    return best;
  }

  const wallOf = (room, i) => wallsOf(room.polygon)[i];

  /* Numbers for the room (square metres, cubic metres ...). */
  function roomStats(room) {
    const walls = wallsOf(room.polygon);
    const wallArea = walls.reduce((s, w) => s + w.len * room.height, 0);
    const holes = room.openings.reduce((s, o) => s + (o.u1 - o.u0) * (o.v1 - o.v0), 0);
    const area = polygonArea(room.polygon);
    return {
      area, perimeter: perimeter(room.polygon), height: room.height, volume: area * room.height,
      wallArea: wallArea - holes, openings: room.openings.length,
      doors: room.openings.filter((o) => o.kind === "door").length, windows: room.openings.filter((o) => o.kind === "window").length,
    };
  }

  /* All lengths (the plan, the height, the openings, the phone's height) multiplied by one factor: used when somebody measured one
     real length and the scan was off by a few percent. */
  function scaleRoom(room, factor) {
    return makeRoom({
      polygon: room.polygon.map(([x, z]) => [x * factor, z * factor]), height: room.height * factor, phoneHeight: room.phoneHeight * factor,
      thickness: room.thickness, openings: room.openings.map((o) => ({ ...o, u0: o.u0 * factor, u1: o.u1 * factor, v0: o.v0 * factor, v1: o.v1 * factor })),
    });
  }

  /* A room that is a plain rectangle, as the quick way to start without scanning. */
  function rectangleRoom(width, depth, height) {
    return makeRoom({ polygon: [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]], height, phoneHeight: 1.4, openings: [] });
  }

  /* A room with another floor plan (a corner was moved, one was added, the walls were straightened): every opening goes to the wall of
     the new plan that is nearest to where it was, and keeps its width, its height and its place along the wall as far as possible.
     Openings that are further than `reach` metres from every wall are dropped. */
  function reshapeRoom(room, polygon, reach = 0.4) {
    const next = positive(polygon);
    const oldWalls = wallsOf(room.polygon), newWalls = wallsOf(next);
    const openings = [];
    for (const o of room.openings) {
      const w = oldWalls[o.wall];
      if (!w) continue;
      const mid = (o.u0 + o.u1) / 2;
      const center = [w.a[0] + w.dir[0] * mid, w.a[1] + w.dir[1] * mid];
      let best = null;
      for (const n of newWalls) {
        const t = clamp((center[0] - n.a[0]) * n.dir[0] + (center[1] - n.a[1]) * n.dir[1], 0, n.len);
        const d = Math.hypot(center[0] - (n.a[0] + n.dir[0] * t), center[1] - (n.a[1] + n.dir[1] * t));
        if (!best || d < best.d) best = { wall: n.index, d, t };
      }
      if (!best || best.d > reach) continue;
      const half = (o.u1 - o.u0) / 2;
      openings.push({ ...o, wall: best.wall, u0: best.t - half, u1: best.t + half });
    }
    return makeRoom({ ...room, polygon: next, openings });
  }

  // ----------------------------------------------------------------------------------------------- scanning
  /* Builds a room from what the scan collected: the floor points (in the order they were set), the height and the openings, each
     given as the two aim directions of its corners.  `phoneHeight` is where the phone was held. */
  function roomFromScan(scan) {
    const h = scan.phoneHeight;
    const points = scan.corners.map((c) => [c.x, c.z]);
    const ordered = positive(points);
    let room = makeRoom({ polygon: ordered, height: scan.height, phoneHeight: h, openings: [] });
    const openings = [];
    for (const o of scan.openings || []) {
      const origin = [0, h, 0];
      const p = wallHit(room, origin, o.from), q = wallHit(room, origin, o.to);
      if (!p || !q || p.wall !== q.wall) continue;
      openings.push({ wall: p.wall, u0: Math.min(p.u, q.u), u1: Math.max(p.u, q.u), v0: Math.min(p.v, q.v), v1: Math.max(p.v, q.v), kind: o.kind });
    }
    return makeRoom({ ...room, openings });
  }

  // -------------------------------------------------------------------------------------------------- meshes
  /* A flat piece of the model: `kind` says what it is, `wall` which wall (for the pieces of walls), the arrays are ready for WebGL
     and glTF (positions and normals in threes, uvs in twos, triangles as index triples). */
  function newSurface(id, kind, wall) {
    return { id, kind, wall: wall == null ? -1 : wall, positions: [], normals: [], uvs: [], indices: [] };
  }

  /* Adds a quad (four points around, in any direction) facing `normal`; the triangles are wound so that they are front faces. */
  function pushQuad(surface, points, uvs, normal) {
    const [a, b, c] = points;
    const facing = dot(cross(sub(b, a), sub(c, a)), normal);
    const order = facing >= 0 ? [0, 1, 2, 3] : [0, 3, 2, 1];
    const base = surface.positions.length / 3;
    for (const k of order) {
      surface.positions.push(...points[k]);
      surface.normals.push(...normal);
      surface.uvs.push(...uvs[k]);
    }
    surface.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /* The rectangles of a wall (from u0 to u1, 0 to height) that are left when the openings are cut out. */
  function tileWall(u0, u1, height, openings) {
    const cuts = new Set([u0, u1]);
    for (const o of openings) { if (o.u0 > u0 + 1e-6 && o.u0 < u1 - 1e-6) cuts.add(o.u0); if (o.u1 > u0 + 1e-6 && o.u1 < u1 - 1e-6) cuts.add(o.u1); }
    const xs = [...cuts].sort((a, b) => a - b);
    const rects = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i], x1 = xs[i + 1];
      if (x1 - x0 < 1e-6) continue;
      const mid = (x0 + x1) / 2;
      const gaps = openings.filter((o) => o.u0 <= mid && o.u1 >= mid).map((o) => [o.v0, o.v1]).sort((a, b) => a[0] - b[0]);
      let y = 0;
      for (const [g0, g1] of gaps) {
        if (g0 > y + 1e-6) rects.push({ u0: x0, u1: x1, v0: y, v1: g0 });
        y = Math.max(y, g1);
      }
      if (y < height - 1e-6) rects.push({ u0: x0, u1: x1, v0: y, v1: height });
    }
    return rects;
  }

  /* The 3D shape of a room as a list of surfaces:
       wall:N   the inside of wall N (the part that gets the photo), with the openings cut out,
       floor, ceiling, reveal (the sides of the openings), cap (the top of the walls) and, if asked for, outer (the outside of the walls).
     Looked at from outside the building, the walls are see-through (only their insides are drawn), which is what a doll's house view needs. */
  function buildRoomSurfaces(room, options = {}) {
    const outer = !!options.outer;
    const t = room.thickness, H = room.height;
    const poly = room.polygon;
    const walls = wallsOf(poly);
    const out = offsetPolygon(poly, t);
    const surfaces = [];
    const y = (v) => v;

    for (const wall of walls) {
      const s = newSurface(`wall:${wall.index}`, "wall", wall.index);
      const n3 = [wall.inward[0], 0, wall.inward[1]];
      const at = (u, v) => [wall.a[0] + wall.dir[0] * u, y(v), wall.a[1] + wall.dir[1] * u];
      const mine = room.openings.filter((o) => o.wall === wall.index);
      for (const r of tileWall(0, wall.len, H, mine)) {
        pushQuad(s, [at(r.u0, r.v0), at(r.u1, r.v0), at(r.u1, r.v1), at(r.u0, r.v1)],
          [[r.u0 / wall.len, 1 - r.v0 / H], [r.u1 / wall.len, 1 - r.v0 / H], [r.u1 / wall.len, 1 - r.v1 / H], [r.u0 / wall.len, 1 - r.v1 / H]], n3);
      }
      surfaces.push(s);
    }

    const floor = newSurface("floor", "floor");
    const ceiling = newSurface("ceiling", "ceiling");
    const box = bounds(poly);
    const uv = ([x, z]) => [(x - box.minX) / (box.width || 1), (z - box.minZ) / (box.depth || 1)];
    for (const [a, b, c] of triangulate(poly)) {
      const p = [poly[a], poly[b], poly[c]];
      pushTriangle(floor, p.map(([x, z]) => [x, 0, z]), p.map(uv), [0, 1, 0]);
      pushTriangle(ceiling, p.map(([x, z]) => [x, H, z]), p.map(uv), [0, -1, 0]);
    }
    surfaces.push(floor, ceiling);

    const reveal = newSurface("reveal", "reveal");
    for (const o of room.openings) {
      const wall = walls[o.wall];
      const out3 = [-wall.inward[0], 0, -wall.inward[1]];
      const d3 = [wall.dir[0], 0, wall.dir[1]];
      const p = (u, v, depth) => [wall.a[0] + wall.dir[0] * u + out3[0] * depth, v, wall.a[1] + wall.dir[1] * u + out3[2] * depth];
      const flat = [[0, 0], [1, 0], [1, 1], [0, 1]];
      pushQuad(reveal, [p(o.u0, o.v0, 0), p(o.u0, o.v1, 0), p(o.u0, o.v1, t), p(o.u0, o.v0, t)], flat, d3);                  // left side, faces to the right
      pushQuad(reveal, [p(o.u1, o.v0, 0), p(o.u1, o.v1, 0), p(o.u1, o.v1, t), p(o.u1, o.v0, t)], flat, mul(d3, -1));         // right side
      pushQuad(reveal, [p(o.u0, o.v1, 0), p(o.u1, o.v1, 0), p(o.u1, o.v1, t), p(o.u0, o.v1, t)], flat, [0, -1, 0]);          // top (the lintel)
      if (o.v0 > 0.01) pushQuad(reveal, [p(o.u0, o.v0, 0), p(o.u1, o.v0, 0), p(o.u1, o.v0, t), p(o.u0, o.v0, t)], flat, [0, 1, 0]); // sill
    }
    surfaces.push(reveal);

    const cap = newSurface("cap", "cap");
    for (const wall of walls) {
      const i = wall.index, j = (i + 1) % walls.length;
      pushQuad(cap, [[poly[i][0], H, poly[i][1]], [poly[j][0], H, poly[j][1]], [out[j][0], H, out[j][1]], [out[i][0], H, out[i][1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0]);
    }
    surfaces.push(cap);

    if (outer) {
      const shell = newSurface("outer", "outer");
      for (const wall of walls) {
        const i = wall.index, j = (i + 1) % walls.length;
        const out3 = [-wall.inward[0], 0, -wall.inward[1]];
        const mine = room.openings.filter((o) => o.wall === wall.index);
        const proj = (q) => (q[0] - wall.a[0]) * wall.dir[0] + (q[1] - wall.a[1]) * wall.dir[1];
        const u0 = proj(out[i]), u1 = proj(out[j]);
        const base = (u, v) => [wall.a[0] + wall.dir[0] * u + out3[0] * t, v, wall.a[1] + wall.dir[1] * u + out3[2] * t];
        for (const r of tileWall(u0, u1, H, mine)) {
          pushQuad(shell, [base(r.u0, r.v0), base(r.u1, r.v0), base(r.u1, r.v1), base(r.u0, r.v1)], [[0, 0], [1, 0], [1, 1], [0, 1]], out3);
        }
      }
      surfaces.push(shell);
    }
    return surfaces.filter((s) => s.indices.length);
  }

  function pushTriangle(surface, points, uvs, normal) {
    const facing = dot(cross(sub(points[1], points[0]), sub(points[2], points[0])), normal);
    const order = facing >= 0 ? [0, 1, 2] : [0, 2, 1];
    const base = surface.positions.length / 3;
    for (const k of order) {
      surface.positions.push(...points[k]);
      surface.normals.push(...normal);
      surface.uvs.push(...uvs[k]);
    }
    surface.indices.push(base, base + 1, base + 2);
  }

  // ----------------------------------------------------------------------------------------------- textures
  /* The plane of a surface whose photo is baked: a texel (column i, row j of an image `width` x `height`) lies at
     origin + uAxis * (i + 0.5) / width + vAxis * (j + 0.5) / height. */
  function wallPlane(room, index) {
    const w = wallsOf(room.polygon)[index];
    return { origin: [w.a[0], room.height, w.a[1]], uAxis: [w.dir[0] * w.len, 0, w.dir[1] * w.len], vAxis: [0, -room.height, 0], size: [w.len, room.height] };
  }

  function floorPlane(room) {
    const b = bounds(room.polygon);
    return { origin: [b.minX, 0, b.minZ], uAxis: [b.width, 0, 0], vAxis: [0, 0, b.depth], size: [b.width, b.depth] };
  }

  function ceilingPlane(room) {
    const b = bounds(room.polygon);
    return { origin: [b.minX, room.height, b.minZ], uAxis: [b.width, 0, 0], vAxis: [0, 0, b.depth], size: [b.width, b.depth] };
  }

  /* A photo's camera: where it stood, where it looked and how wide it sees.  `fov` is the angle (degrees) along the longer side of
     the picture. */
  function makeCamera(photo, fov) {
    const longTan = Math.tan(fov * DEG / 2);
    const wide = photo.width >= photo.height;
    return {
      position: photo.position || [0, 1.4, 0], forward: photo.forward, up: photo.up, right: normalize(cross(photo.forward, photo.up)),
      tanX: wide ? longTan : longTan * photo.width / photo.height, tanY: wide ? longTan * photo.height / photo.width : longTan,
      width: photo.width, height: photo.height, pixels: photo.pixels,
    };
  }

  /* Where a point lies in a camera's picture, as (-1..1, -1..1) from the middle, or null when it is behind the camera. */
  function project(camera, point) {
    const d = sub(point, camera.position);
    const z = dot(d, camera.forward);
    if (z < 0.01) return null;
    return [dot(d, camera.right) / z / camera.tanX, dot(d, camera.up) / z / camera.tanY, z];
  }

  /* Which cameras can see anything of a plane (a quick look at a grid of points on it). */
  function camerasForPlane(plane, cameras, margin = 0.02) {
    const picked = [];
    for (const camera of cameras) {
      let seen = false;
      for (let a = 0; a <= 8 && !seen; a++) {
        for (let b = 0; b <= 6 && !seen; b++) {
          const point = add(add(plane.origin, mul(plane.uAxis, a / 8)), mul(plane.vAxis, b / 6));
          const q = project(camera, point);
          if (q && Math.abs(q[0]) < 1 - margin && Math.abs(q[1]) < 1 - margin) seen = true;
        }
      }
      if (seen) picked.push(camera);
    }
    return picked;
  }

  /* Starts a bake: the picture is blended from every photo that shows the texel, the ones that show it near their middle count most. */
  function newBake(plane, cameras, width, height) {
    return { plane, cameras: camerasForPlane(plane, cameras), width, height, rgba: new Uint8ClampedArray(width * height * 4), covered: 0 };
  }

  /* Bakes rows y0 .. y1 - 1 (so that a long job can be cut into pieces). */
  function bakeRows(job, y0, y1) {
    const { plane, cameras, width, height, rgba } = job;
    const { origin, uAxis, vAxis } = plane;
    for (let j = y0; j < y1; j++) {
      const fv = (j + 0.5) / height;
      const rowX = origin[0] + vAxis[0] * fv, rowY = origin[1] + vAxis[1] * fv, rowZ = origin[2] + vAxis[2] * fv;
      for (let i = 0; i < width; i++) {
        const fu = (i + 0.5) / width;
        const px = rowX + uAxis[0] * fu, py = rowY + uAxis[1] * fu, pz = rowZ + uAxis[2] * fu;
        let r = 0, g = 0, b = 0, sum = 0;
        for (let c = 0; c < cameras.length; c++) {
          const cam = cameras[c];
          const dx = px - cam.position[0], dy = py - cam.position[1], dz = pz - cam.position[2];
          const z = dx * cam.forward[0] + dy * cam.forward[1] + dz * cam.forward[2];
          if (z < 0.01) continue;
          const nx = (dx * cam.right[0] + dy * cam.right[1] + dz * cam.right[2]) / z / cam.tanX;
          const ny = (dx * cam.up[0] + dy * cam.up[1] + dz * cam.up[2]) / z / cam.tanY;
          if (nx <= -0.98 || nx >= 0.98 || ny <= -0.98 || ny >= 0.98) continue;
          const wgt = (1 - nx * nx) * (1 - ny * ny);
          const sx = (nx + 1) / 2 * cam.width - 0.5, sy = (1 - ny) / 2 * cam.height - 0.5;
          const x0 = Math.max(0, Math.floor(sx)), y0p = Math.max(0, Math.floor(sy));
          const x1 = Math.min(cam.width - 1, x0 + 1), y1p = Math.min(cam.height - 1, y0p + 1);
          const fx = Math.min(1, Math.max(0, sx - x0)), fy = Math.min(1, Math.max(0, sy - y0p));
          const p = cam.pixels;
          const i00 = (y0p * cam.width + x0) * 4, i10 = (y0p * cam.width + x1) * 4, i01 = (y1p * cam.width + x0) * 4, i11 = (y1p * cam.width + x1) * 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r += wgt * (p[i00] * w00 + p[i10] * w10 + p[i01] * w01 + p[i11] * w11);
          g += wgt * (p[i00 + 1] * w00 + p[i10 + 1] * w10 + p[i01 + 1] * w01 + p[i11 + 1] * w11);
          b += wgt * (p[i00 + 2] * w00 + p[i10 + 2] * w10 + p[i01 + 2] * w01 + p[i11 + 2] * w11);
          sum += wgt;
        }
        const o = (j * width + i) * 4;
        if (sum > 1e-6) { rgba[o] = r / sum; rgba[o + 1] = g / sum; rgba[o + 2] = b / sum; rgba[o + 3] = 255; job.covered += 1; }
        else rgba[o + 3] = 0;
      }
    }
  }

  /* Fills the texels no photo reached from the nearest photographed ones (along the row, then along the column), so that the parts of a
     wall nobody photographed do not show as holes.  Whatever is still empty gets `fallback`.  Returns the share of the surface that
     really was photographed. */
  function fillGaps(job, fallback = [222, 220, 214]) {
    const { rgba, width, height } = job;
    const has = (o) => rgba[o + 3] !== 0;
    const mix = (to, from, next, f) => {
      for (let c = 0; c < 3; c++) rgba[to + c] = next < 0 ? rgba[from + c] : from < 0 ? rgba[next + c] : rgba[from + c] * (1 - f) + rgba[next + c] * f;
      rgba[to + 3] = 254;
    };
    const fillLine = (count, offset) => {                           // offset(k) is the byte offset of the k-th texel of the line
      let last = -1;
      for (let k = 0; k < count; k++) {
        if (!has(offset(k))) continue;
        if (last < k - 1) for (let m = last + 1; m < k; m++) mix(offset(m), last < 0 ? -1 : offset(last), offset(k), last < 0 ? 1 : (m - last) / (k - last));
        last = k;
      }
      if (last >= 0) for (let m = last + 1; m < count; m++) mix(offset(m), offset(last), -1, 0);
    };
    for (let j = 0; j < height; j++) fillLine(width, (i) => (j * width + i) * 4);
    for (let i = 0; i < width; i++) fillLine(height, (j) => (j * width + i) * 4);
    for (let o = 0; o < rgba.length; o += 4) {
      if (rgba[o + 3] === 0) { rgba[o] = fallback[0]; rgba[o + 1] = fallback[1]; rgba[o + 2] = fallback[2]; }
      rgba[o + 3] = 255;
    }
    return job.covered / (width * height);
  }

  /* The size of a baked picture for a surface: about `pxPerMeter` pixels for each metre, at most `max` on the long side. */
  function textureSize(size, pxPerMeter = 160, max = 2048) {
    const s = Math.min(pxPerMeter, max / Math.max(size[0], size[1], 0.01));
    return [Math.max(8, Math.round(size[0] * s)), Math.max(8, Math.round(size[1] * s))];
  }

  // ------------------------------------------------------------------------------------- several rooms
  /* A room's place in a building: moved by (x, z) and turned by `rot` degrees about the vertical (clockwise seen from above). */
  function placePoint(layout, [x, z]) {
    const r = (layout.rot || 0) * DEG, c = Math.cos(r), s = Math.sin(r);
    return [layout.x + x * c - z * s, layout.z + x * s + z * c];
  }

  function placedPolygon(room, layout) {
    return room.polygon.map((p) => placePoint(layout, p));
  }

  /* The place for room B so that its opening `ob` is exactly where room A's opening `oa` is (A's place is `la`): the walls then
     lie against each other.  Returns the layout of B. */
  function alignByOpenings(roomA, la, oa, roomB, ob) {
    const wa = wallsOf(roomA.polygon)[oa.wall], wb = wallsOf(roomB.polygon)[ob.wall];
    const dirA = [wa.dir[0] * Math.cos(la.rot * DEG) - wa.dir[1] * Math.sin(la.rot * DEG), wa.dir[0] * Math.sin(la.rot * DEG) + wa.dir[1] * Math.cos(la.rot * DEG)];
    // B's wall must run the other way along the same line: its direction is minus A's direction
    const target = Math.atan2(-dirA[1], -dirA[0]);
    const own = Math.atan2(wb.dir[1], wb.dir[0]);
    const rot = ((target - own) / DEG + 360) % 360;
    const centerA = placePoint(la, [wa.a[0] + wa.dir[0] * (oa.u0 + oa.u1) / 2, wa.a[1] + wa.dir[1] * (oa.u0 + oa.u1) / 2]);
    const local = [wb.a[0] + wb.dir[0] * (ob.u0 + ob.u1) / 2, wb.a[1] + wb.dir[1] * (ob.u0 + ob.u1) / 2];
    const turned = placePoint({ x: 0, z: 0, rot }, local);
    // push B away from A by the thickness of the wall between the rooms (the rooms are on both sides of one wall)
    const outA = [-wa.inward[0], -wa.inward[1]];
    const push = [outA[0] * Math.cos(la.rot * DEG) - outA[1] * Math.sin(la.rot * DEG), outA[0] * Math.sin(la.rot * DEG) + outA[1] * Math.cos(la.rot * DEG)];
    const gap = roomA.thickness;
    return { x: centerA[0] + push[0] * gap - turned[0], z: centerA[1] + push[1] * gap - turned[1], rot };
  }

  /* A first arrangement of rooms: side by side, each at `gap` metres from the one before. */
  function autoLayout(rooms, gap = 0.6) {
    let x = 0;
    return rooms.map((room) => {
      const b = bounds(room.polygon);
      const layout = { x: x - b.minX, z: -(b.minZ + b.maxZ) / 2, rot: 0 };
      x += b.width + gap;
      return layout;
    });
  }

  return {
    DEG, OPENING_KINDS, MAX_ROOM,
    add, sub, mul, dot, cross, length, normalize, clamp,
    deviceAxes, viewFromOrientation, viewFromYawPitch, averageViews, pitchDeg, yawDeg, floorPoint, heightFromAim,
    signedArea, polygonArea, perimeter, positive, centroid, bounds, isSimple, pointInPolygon, simplify, orthogonalize, triangulate, offsetPolygon,
    wallsOf, makeRoom, fitOpening, openingsOverlap, wallHit, wallOf, roomStats, scaleRoom, rectangleRoom, reshapeRoom, roomFromScan,
    newSurface, pushQuad, tileWall, buildRoomSurfaces,
    wallPlane, floorPlane, ceilingPlane, makeCamera, project, camerasForPlane, newBake, bakeRows, fillGaps, textureSize,
    placePoint, placedPolygon, alignByOpenings, autoLayout,
  };
});
