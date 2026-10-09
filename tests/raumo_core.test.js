"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/raumo-core.js");

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} != ${b}`);
const nearV = (a, b, eps = 1e-6) => a.forEach((x, i) => near(x, b[i], eps, `component ${i} of [${a}] vs [${b}]`));

const RECT = [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]];

// ------------------------------------------------------------------------------------------------ orientation
test("the phone held upright and looking north looks along -z, with east on its right", () => {
  const v = C.viewFromOrientation(0, 90, 0);
  nearV(v.forward, [0, 0, -1]);
  nearV(v.right, [1, 0, 0]);
  nearV(v.up, [0, 1, 0]);
});

test("tilting the phone forward looks down, turning it counter-clockwise looks west", () => {
  const down = C.viewFromOrientation(0, 45, 0);
  near(down.forward[1], -Math.SQRT1_2);
  near(C.pitchDeg(down.forward), -45, 1e-6);
  const west = C.viewFromOrientation(90, 90, 0);
  nearV(west.forward, [-1, 0, 0]);
  const flat = C.viewFromOrientation(0, 0, 0);                 // lying on its back: the camera looks at the floor
  nearV(flat.forward, [0, -1, 0]);
});

test("right is always forward x up, and the three are at right angles, for any angles", () => {
  for (const [a, b, g, s] of [[10, 80, 5, 0], [200, 100, -20, 0], [321, 60, 30, 90], [45, 95, -45, 270], [90, 90, 90, 180]]) {
    const v = C.viewFromOrientation(a, b, g, s);
    nearV(C.cross(v.forward, v.up), v.right, 1e-9);
    near(C.dot(v.forward, v.up), 0, 1e-9);
    near(C.length(v.forward), 1, 1e-9);
  }
});

test("a page turned to landscape turns what is up in the picture", () => {
  const upright = C.viewFromOrientation(0, 90, 0, 0);
  const landscape = C.viewFromOrientation(0, 90, 0, 90);
  nearV(landscape.forward, upright.forward);
  nearV(landscape.up, upright.right);                            // the phone's x axis is up on the page
  nearV(C.cross(landscape.forward, landscape.up), landscape.right, 1e-9);
});

test("yaw and pitch give the same views as the angles do", () => {
  nearV(C.viewFromYawPitch(0, 0).forward, [0, 0, -1]);
  nearV(C.viewFromYawPitch(90, 0).forward, [1, 0, 0]);
  nearV(C.viewFromYawPitch(0, 30).forward, [0, 0.5, -Math.cos(Math.PI / 6)]);
  for (const [y, p] of [[10, -20], [-100, 40], [170, 0]]) {
    const v = C.viewFromYawPitch(y, p);
    near(C.yawDeg(v.forward), y, 1e-6);
    near(C.pitchDeg(v.forward), p, 1e-6);
    nearV(C.cross(v.forward, v.up), v.right, 1e-9);
  }
  const rolled = C.viewFromYawPitch(0, 0, 90);
  nearV(rolled.up, [-1, 0, 0], 1e-9);
});

test("averaging views smooths a shaky hand", () => {
  const views = [-1, 0, 1].map((d) => C.viewFromYawPitch(30 + d, -20));
  const mean = C.averageViews(views);
  near(C.yawDeg(mean.forward), 30, 0.01);
  near(C.pitchDeg(mean.forward), -20, 0.05);
  assert.equal(C.averageViews([]), null);
});

// ---------------------------------------------------------------------------------------------------- aiming
test("a floor point is h / tan(angle) away", () => {
  const f45 = C.viewFromYawPitch(0, -45).forward;
  const p = C.floorPoint(f45, 1.4);
  near(p.distance, 1.4, 1e-9);
  near(p.x, 0, 1e-9);
  near(p.z, -1.4, 1e-9);
  const f30 = C.viewFromYawPitch(90, -30).forward;
  const q = C.floorPoint(f30, 1.5);
  near(q.distance, 1.5 / Math.tan(Math.PI / 6), 1e-9);
  near(q.x, q.distance, 1e-9);
  assert.equal(C.floorPoint(C.viewFromYawPitch(0, -1).forward, 1.4), null);
  assert.equal(C.floorPoint(C.viewFromYawPitch(0, 20).forward, 1.4), null);
});

test("the error figure grows toward the horizon", () => {
  const near45 = C.floorPoint(C.viewFromYawPitch(0, -45).forward, 1.4).error;
  const near10 = C.floorPoint(C.viewFromYawPitch(0, -10).forward, 1.4).error;
  assert.ok(near10 > 2 * near45 && near45 < 2);
});

test("the height of a room from an aim at the edge between wall and ceiling", () => {
  const forward = C.viewFromYawPitch(0, 30).forward;
  near(C.heightFromAim(forward, 3, 1.4), 1.4 + 3 * Math.tan(Math.PI / 6), 1e-9);
  assert.equal(C.heightFromAim(C.viewFromYawPitch(0, -5).forward, 3, 1.4), null);
});

// ----------------------------------------------------------------------------------------------- polygons
test("area, orientation, centroid, bounds", () => {
  near(C.signedArea(RECT), 12);
  near(C.signedArea(RECT.slice().reverse()), -12);
  assert.ok(C.signedArea(C.positive(RECT.slice().reverse())) > 0);
  near(C.perimeter(RECT), 14);
  nearV(C.centroid(RECT), [0, 0]);
  const L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  near(C.polygonArea(L), 12);
  nearV(C.centroid(L), [20 / 12, 20 / 12]);
  assert.deepEqual(Object.values(C.bounds(L)).slice(0, 4), [0, 0, 4, 4]);
});

test("a polygon that crosses itself is not simple", () => {
  assert.ok(C.isSimple(RECT));
  assert.ok(!C.isSimple([[0, 0], [2, 2], [2, 0], [0, 2]]));
  assert.ok(!C.isSimple([[0, 0], [1, 0]]));
});

test("point in polygon", () => {
  assert.ok(C.pointInPolygon([0, 0], RECT));
  assert.ok(!C.pointInPolygon([3, 0], RECT));
});

test("points on a straight line and doubled points are dropped", () => {
  const out = C.simplify([[0, 0], [2, 0.005], [4, 0], [4, 3], [4.001, 3], [0, 3]], 0.02);
  assert.equal(out.length, 4);
});

test("a noisy rectangle becomes a true rectangle", () => {
  const noisy = [[-2.03, -1.48], [2.05, -1.52], [1.96, 1.55], [-2.02, 1.44]];
  const { polygon, snapped } = C.orthogonalize(noisy, 12);
  assert.equal(snapped, 4);
  for (let i = 0; i < 4; i++) {
    const a = polygon[i], b = polygon[(i + 1) % 4], c = polygon[(i + 2) % 4];
    near((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]), 0, 1e-9, "corner is a right angle");
  }
  const w = C.bounds(polygon);
  assert.ok(Math.abs(Math.hypot(...[polygon[1][0] - polygon[0][0], polygon[1][1] - polygon[0][1]]) - 4.05) < 0.2);
  assert.ok(Math.abs(C.polygonArea(polygon) - 12.2) < 0.4 && w.width > 3.8);
});

test("a turned and noisy L shape keeps its shape and a 45 degree wall stays", () => {
  const turn = (p, deg) => [p[0] * Math.cos(deg * C.DEG) - p[1] * Math.sin(deg * C.DEG), p[0] * Math.sin(deg * C.DEG) + p[1] * Math.cos(deg * C.DEG)];
  const L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]].map((p, i) => turn([p[0] + (i % 2 ? 0.03 : -0.02), p[1] + (i % 3 ? 0.02 : -0.03)], 23));
  const out = C.orthogonalize(L, 12);
  assert.equal(out.snapped, 6);
  assert.ok(Math.abs(C.polygonArea(out.polygon) - 12) < 0.4);
  const cut = [[0, 0], [4, 0], [4, 2], [2, 4], [0, 4]];           // the corner at (4,4) is cut off by a 45 degree wall
  const out2 = C.orthogonalize(cut, 12);
  assert.equal(out2.snapped, 4);
  assert.ok(Math.abs(C.polygonArea(out2.polygon) - C.polygonArea(cut)) < 0.3);
});

test("triangulation covers the polygon exactly, convex or not", () => {
  const L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  for (const poly of [RECT, L, L.slice().reverse(), [[0, 0], [5, 0], [5, 1], [1, 1], [1, 3], [5, 3], [5, 4], [0, 4]]]) {
    const tri = C.triangulate(poly);
    assert.equal(tri.length, poly.length - 2);
    const total = tri.reduce((s, t) => s + C.polygonArea(t.map((i) => poly[i])), 0);
    near(total, C.polygonArea(poly), 1e-9);
    for (const t of tri) assert.ok(C.signedArea(t.map((i) => poly[i])) > 0, "counter-clockwise");
  }
});

test("a polygon moved outward grows by the distance on every side", () => {
  const out = C.offsetPolygon(RECT, 0.1);
  near(C.polygonArea(out), 4.2 * 3.2, 1e-9);
  const L = [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]];
  const grown = C.offsetPolygon(L, 0.1);
  assert.ok(C.polygonArea(grown) > C.polygonArea(L) + 0.1 * C.perimeter(L) - 0.1 && C.isSimple(grown));
});

// ---------------------------------------------------------------------------------------------------- rooms
test("a room is made positive, gets sensible limits and keeps only openings that fit", () => {
  const room = C.makeRoom({ polygon: RECT.slice().reverse(), height: 2.5, phoneHeight: 1.4, openings: [
    { wall: 0, u0: 1, u1: 2, v0: 0, v1: 2, kind: "door" },
    { wall: 0, u0: 1.5, u1: 2.5, v0: 0, v1: 2, kind: "door" },       // overlaps the first
    { wall: 1, u0: 0.5, u1: 0.55, v0: 1, v1: 2, kind: "window" },    // far too narrow
    { wall: 9, u0: 0, u1: 1, v0: 0, v1: 1, kind: "door" },           // no such wall
    { wall: 2, u0: 1, u1: 2.2, v0: 0.9, v1: 2.1, kind: "window" },
  ] });
  assert.ok(C.signedArea(room.polygon) > 0);
  assert.equal(room.openings.length, 2);
  assert.equal(room.openings[0].kind, "door");
  const clipped = C.makeRoom({ polygon: RECT, height: 99, phoneHeight: 0, openings: [] });
  assert.equal(clipped.height, 10);
  assert.ok(clipped.phoneHeight >= 0.3);
});

test("a window keeps its sill, a door always starts at the floor", () => {
  const room = C.makeRoom({ polygon: RECT, height: 2.5, openings: [{ wall: 0, u0: 0.5, u1: 1.5, v0: 0.4, v1: 2, kind: "door" }, { wall: 1, u0: 0.5, u1: 1.5, v0: 0.9, v1: 2, kind: "window" }] });
  assert.equal(room.openings.find((o) => o.kind === "door").v0, 0);
  assert.equal(room.openings.find((o) => o.kind === "window").v0, 0.9);
});

test("numbers of a room", () => {
  const room = C.makeRoom({ polygon: RECT, height: 2.5, openings: [{ wall: 0, u0: 1, u1: 2, v0: 0, v1: 2, kind: "door" }, { wall: 1, u0: 1, u1: 2, v0: 1, v1: 2, kind: "window" }] });
  const s = C.roomStats(room);
  near(s.area, 12);
  near(s.volume, 30);
  near(s.perimeter, 14);
  near(s.wallArea, 14 * 2.5 - 2 - 1);
  assert.deepEqual([s.doors, s.windows], [1, 1]);
});

test("scaling a room scales every length and keeps the openings in place", () => {
  const room = C.makeRoom({ polygon: RECT, height: 2.5, phoneHeight: 1.4, openings: [{ wall: 0, u0: 1, u1: 2, v0: 0, v1: 2, kind: "door" }] });
  const big = C.scaleRoom(room, 1.1);
  near(C.polygonArea(big.polygon), 12 * 1.21, 1e-9);
  near(big.height, 2.75);
  near(big.phoneHeight, 1.54);
  near(big.openings[0].u0, 1.1, 1e-9);
  near(big.openings[0].v1, 2.2, 1e-9);
});

test("the sight line meets the right wall at the right place", () => {
  const room = C.makeRoom({ polygon: RECT, height: 2.5, phoneHeight: 1.4, openings: [] });
  const hit = C.wallHit(room, [0, 1.4, 0], C.viewFromYawPitch(90, 0).forward);       // looking east
  assert.equal(room.polygon[hit.wall + 1 > 3 ? 0 : hit.wall + 1][0], 2);
  near(hit.t, 2, 1e-9);
  near(hit.v, 1.4, 1e-9);
  assert.equal(C.wallHit(room, [0, 1.4, 0], [0, 1, 0]), null);                        // straight up: ceiling, no wall
  assert.equal(C.wallHit(room, [0, 1.4, 0], C.viewFromYawPitch(0, 80).forward), null);
});

// ---------------------------------------------------------------------- a whole scan, as a phone would see it
function station(sx, sz, h) {
  return { origin: [sx, h, sz] };
}

test("scanning the corners from a spot that is not the middle rebuilds the room", () => {
  const truth = [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]];
  const sx = 0.7, sz = -0.4, h = 1.45;
  const corners = truth.map(([x, z]) => {
    const d = C.normalize([x - sx, 0 - h, z - sz]);
    const p = C.floorPoint(d, h);
    return { x: p.x, z: p.z };
  });
  const height = C.heightFromAim(C.normalize([truth[1][0] - sx, 2.55 - h, truth[1][1] - sz]), Math.hypot(truth[1][0] - sx, truth[1][1] - sz), h);
  near(height, 2.55, 1e-9);
  const room = C.roomFromScan({ phoneHeight: h, height, corners });
  near(C.polygonArea(room.polygon), 12, 1e-9);
  near(C.perimeter(room.polygon), 14, 1e-9);
  near(room.height, 2.55, 1e-9);
});

test("scanning the corners clockwise gives the same room", () => {
  const h = 1.4;
  const corners = RECT.slice().reverse().map(([x, z]) => {
    const p = C.floorPoint(C.normalize([x, -h, z]), h);
    return { x: p.x, z: p.z };
  });
  const room = C.roomFromScan({ phoneHeight: h, height: 2.5, corners });
  near(C.signedArea(room.polygon), 12, 1e-9);
});

test("a door and a window marked by aiming at their corners land on the right wall", () => {
  const h = 1.4;
  const corners = RECT.map(([x, z]) => { const p = C.floorPoint(C.normalize([x, -h, z]), h); return { x: p.x, z: p.z }; });
  const aim = (x, y, z) => C.normalize([x, y - h, z]);
  // the north wall (z = -1.5) is wall 0, running east; a door from x = 0.5 to 1.5, 2.0 m high; a window on the east wall (wall 1)
  const room = C.roomFromScan({ phoneHeight: h, height: 2.5, corners, openings: [
    { kind: "door", from: aim(0.5, 0, -1.5), to: aim(1.5, 2, -1.5) },
    { kind: "window", from: aim(2, 0.9, -0.5), to: aim(2, 2.1, 0.7) },
    { kind: "window", from: aim(0.5, 1, -1.5), to: aim(2, 2, -0.5) },        // two different walls: dropped
  ] });
  assert.equal(room.openings.length, 2);
  const door = room.openings.find((o) => o.kind === "door");
  assert.equal(door.wall, 0);
  near(door.u0, 2.5, 1e-9); near(door.u1, 3.5, 1e-9); near(door.v1, 2, 1e-9);
  const win = room.openings.find((o) => o.kind === "window");
  assert.equal(win.wall, 1);
  near(win.u0, 1, 1e-9); near(win.u1, 2.2, 1e-9); near(win.v0, 0.9, 1e-9); near(win.v1, 2.1, 1e-9);
});

// ---------------------------------------------------------------------------------------------------- meshes
function triangles(surface) {
  const out = [];
  for (let i = 0; i < surface.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => { const j = surface.indices[i + k] * 3; return surface.positions.slice(j, j + 3); });
    const n = C.cross(C.sub(b, a), C.sub(c, a));
    out.push({ a, b, c, normal: C.normalize(n), area: C.length(n) / 2 });
  }
  return out;
}

const ROOM = C.makeRoom({ polygon: RECT, height: 2.5, phoneHeight: 1.4, openings: [
  { wall: 0, u0: 1, u1: 2, v0: 0, v1: 2.05, kind: "door" }, { wall: 1, u0: 0.8, u1: 2.2, v0: 0.9, v1: 2.1, kind: "window" }] });

test("every triangle faces the way its normal says and all indices are valid", () => {
  for (const surface of C.buildRoomSurfaces(ROOM, { outer: true })) {
    const count = surface.positions.length / 3;
    assert.equal(surface.normals.length, surface.positions.length);
    assert.equal(surface.uvs.length / 2, count);
    for (const i of surface.indices) assert.ok(i >= 0 && i < count);
    for (const t of triangles(surface)) {
      assert.ok(t.area > 1e-9, `${surface.id} has a flat triangle`);
      const stored = surface.normals.slice(surface.indices[0] * 3, surface.indices[0] * 3 + 3);
      assert.ok(C.dot(t.normal, stored) > 0.999 || surface.kind !== "wall", `${surface.id} winding`);
      assert.ok(C.dot(t.normal, stored) > 0.999 || surface.kind !== "floor" && surface.kind !== "ceiling", `${surface.id} winding`);
    }
  }
});

test("the walls face the inside of the room, floor up, ceiling down", () => {
  const center = [0, 1.25, 0];
  for (const surface of C.buildRoomSurfaces(ROOM)) {
    for (const t of triangles(surface)) {
      const mid = C.mul(C.add(C.add(t.a, t.b), t.c), 1 / 3);
      if (surface.kind === "wall") assert.ok(C.dot(t.normal, C.sub(center, mid)) > 0, `${surface.id} faces out`);
      if (surface.kind === "floor") near(t.normal[1], 1, 1e-9);
      if (surface.kind === "ceiling") near(t.normal[1], -1, 1e-9);
    }
  }
});

test("the areas of the surfaces add up", () => {
  const surfaces = C.buildRoomSurfaces(ROOM);
  const area = (kind) => surfaces.filter((s) => s.kind === kind).reduce((sum, s) => sum + triangles(s).reduce((a, t) => a + t.area, 0), 0);
  near(area("floor"), 12, 1e-9);
  near(area("ceiling"), 12, 1e-9);
  const stats = C.roomStats(ROOM);
  near(area("wall"), stats.wallArea, 1e-9);
  assert.ok(area("reveal") > 0 && area("cap") > 0);
  const withOuter = C.buildRoomSurfaces(ROOM, { outer: true });
  assert.ok(withOuter.some((s) => s.kind === "outer"));
  assert.ok(!surfaces.some((s) => s.kind === "outer"));
});

test("the openings leave holes: no triangle of a wall lies inside an opening", () => {
  const walls = C.wallsOf(ROOM.polygon);
  for (const surface of C.buildRoomSurfaces(ROOM).filter((s) => s.kind === "wall")) {
    const wall = walls[surface.wall];
    for (const t of triangles(surface)) {
      const mid = C.mul(C.add(C.add(t.a, t.b), t.c), 1 / 3);
      const u = (mid[0] - wall.a[0]) * wall.dir[0] + (mid[2] - wall.a[1]) * wall.dir[1];
      for (const o of ROOM.openings.filter((o) => o.wall === wall.index)) {
        assert.ok(!(u > o.u0 + 1e-6 && u < o.u1 - 1e-6 && mid[1] > o.v0 + 1e-6 && mid[1] < o.v1 - 1e-6), "triangle inside an opening");
      }
    }
  }
});

test("wall tiling covers the wall minus the holes exactly", () => {
  const rects = C.tileWall(0, 4, 2.5, [{ u0: 1, u1: 2, v0: 0, v1: 2 }, { u0: 2.5, u1: 3.5, v0: 0.9, v1: 2.1 }]);
  near(rects.reduce((s, r) => s + (r.u1 - r.u0) * (r.v1 - r.v0), 0), 10 - 2 - 1.2, 1e-9);
  assert.equal(C.tileWall(0, 4, 2.5, []).length, 1);
});

test("the texture coordinates of a wall run from 0 to 1 with the top of the picture at the top of the wall", () => {
  const s = C.buildRoomSurfaces(C.rectangleRoom(4, 3, 2.5)).find((x) => x.id === "wall:0");
  const tops = [];
  for (let i = 0; i < s.positions.length / 3; i++) tops.push([s.positions[i * 3 + 1], s.uvs[i * 2 + 1]]);
  for (const [y, v] of tops) near(v, 1 - y / 2.5, 1e-9);
});

// -------------------------------------------------------------------------------------------------- textures
const checker = (u, v) => (Math.floor(u * 4) + Math.floor(v * 4)) % 2 === 0 ? [220, 40, 40] : [40, 40, 220];

/* A photo of the room as a camera at the phone's spot would take it: every pixel looks along its ray and sees a checker on the wall. */
function fakePhoto(room, yaw, pitch, width = 160, height = 120, fov = 70) {
  const view = C.viewFromYawPitch(yaw, pitch);
  const photo = { width, height, forward: view.forward, up: view.up, position: [0, room.phoneHeight, 0], pixels: new Uint8ClampedArray(width * height * 4) };
  const cam = C.makeCamera(photo, fov);
  const walls = C.wallsOf(room.polygon);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const nx = ((i + 0.5) / width) * 2 - 1, ny = 1 - ((j + 0.5) / height) * 2;
      const dir = C.normalize(C.add(C.add(cam.forward, C.mul(cam.right, nx * cam.tanX)), C.mul(cam.up, ny * cam.tanY)));
      const hit = C.wallHit(room, photo.position, dir);
      const o = (j * width + i) * 4;
      const color = hit ? checker(hit.u / walls[hit.wall].len + hit.wall * 0.13, hit.v / room.height) : [0, 0, 0];
      photo.pixels[o] = color[0]; photo.pixels[o + 1] = color[1]; photo.pixels[o + 2] = color[2]; photo.pixels[o + 3] = 255;
    }
  }
  return photo;
}

test("baking a wall from photos gives back what the wall looks like", () => {
  const room = C.rectangleRoom(4, 3, 2.5);
  const cameras = [];
  for (let yaw = 0; yaw < 360; yaw += 30) for (const pitch of [-20, 0, 20]) cameras.push(C.makeCamera(fakePhoto(room, yaw, pitch), 70));
  const plane = C.wallPlane(room, 1);                                  // the east wall
  const [w, h] = C.textureSize(plane.size, 40);
  const job = C.newBake(plane, cameras, w, h);
  C.bakeRows(job, 0, h);
  const share = C.fillGaps(job);
  assert.ok(share > 0.9, `photographed share ${share}`);
  const walls = C.wallsOf(room.polygon);
  let bad = 0, total = 0;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w, v = 1 - (j + 0.5) / h;
      const edge = Math.abs(((u * 4) % 1) - 0.5) > 0.42 || Math.abs(((v * 4) % 1) - 0.5) > 0.42;       // near a checker edge the blend is allowed to differ
      if (edge) continue;
      const want = checker(u + 1 * 0.13, v);
      const o = (j * w + i) * 4;
      total += 1;
      if (Math.abs(job.rgba[o] - want[0]) + Math.abs(job.rgba[o + 2] - want[2]) > 120) bad += 1;
    }
  }
  assert.ok(bad / total < 0.03, `${bad} of ${total} texels differ`);
});

test("a wall nobody photographed is filled with the fallback colour, a half photographed one without holes", () => {
  const room = C.rectangleRoom(4, 3, 2.5);
  const only = [C.makeCamera(fakePhoto(room, 90, 0), 70)];            // looks east only
  const west = C.wallPlane(room, 3);
  const jobWest = C.newBake(west, only, 40, 20);
  C.bakeRows(jobWest, 0, 20);
  const share = C.fillGaps(jobWest, [10, 20, 30]);
  assert.equal(share, 0);
  assert.deepEqual([...jobWest.rgba.slice(0, 4)], [10, 20, 30, 255]);
  const east = C.wallPlane(room, 1);
  const jobEast = C.newBake(east, only, 48, 24);
  C.bakeRows(jobEast, 0, 24);
  C.fillGaps(jobEast, [10, 20, 30]);
  for (let o = 0; o < jobEast.rgba.length; o += 4) assert.equal(jobEast.rgba[o + 3], 255);
  assert.ok(!(jobEast.rgba[0] === 10 && jobEast.rgba[1] === 20), "the gaps next to the photographed part are filled from it");
});

test("only the cameras that see a plane are used for it", () => {
  const room = C.rectangleRoom(4, 3, 2.5);
  const cams = [0, 90, 180, 270].map((yaw) => C.makeCamera(fakePhoto(room, yaw, 0, 40, 30), 70));
  const east = C.camerasForPlane(C.wallPlane(room, 1), cams);
  assert.equal(east.length, 1);
  assert.ok(C.dot(east[0].forward, [1, 0, 0]) > 0.99);
});

test("the size of a texture follows the size of the surface and has a limit", () => {
  assert.deepEqual(C.textureSize([4, 2.5], 100), [400, 250]);
  const [w, h] = C.textureSize([40, 2.5], 160, 2048);
  assert.ok(w <= 2048 && h >= 8);
});

// ------------------------------------------------------------------------------------------- several rooms
test("rooms are joined at their doors: the walls lie against each other and the rooms do not overlap", () => {
  const a = C.makeRoom({ polygon: RECT, height: 2.5, thickness: 0.1, openings: [{ wall: 1, u0: 1, u1: 2, v0: 0, v1: 2, kind: "door" }] });
  const b = C.makeRoom({ polygon: [[0, 0], [3, 0], [3, 2], [0, 2]], height: 2.5, thickness: 0.1, openings: [{ wall: 2, u0: 0.5, u1: 1.5, v0: 0, v1: 2, kind: "door" }] });
  const la = { x: 1, z: 2, rot: 30 };
  const lb = C.alignByOpenings(a, la, a.openings[0], b, b.openings[0]);
  const wa = C.wallsOf(a.polygon)[1], wb = C.wallsOf(b.polygon)[0 + 2];
  const centre = (room, layout, wall, o) => C.placePoint(layout, [wall.a[0] + wall.dir[0] * (o.u0 + o.u1) / 2, wall.a[1] + wall.dir[1] * (o.u0 + o.u1) / 2]);
  const ca = centre(a, la, wa, a.openings[0]), cb = centre(b, lb, wb, b.openings[0]);
  near(Math.hypot(ca[0] - cb[0], ca[1] - cb[1]), 0.1, 1e-6, "door centres are one wall thickness apart");
  const pa = C.placedPolygon(a, la), pb = C.placedPolygon(b, lb);
  assert.ok(!C.pointInPolygon(C.centroid(pb), pa) && !C.pointInPolygon(C.centroid(pa), pb));
  assert.ok(pb.every((p) => !C.pointInPolygon(p, pa)), "no corner of B lies inside A");
});

test("a first arrangement puts the rooms side by side without overlap", () => {
  const rooms = [C.rectangleRoom(4, 3, 2.5), C.rectangleRoom(2, 5, 2.5), C.rectangleRoom(3, 3, 2.5)];
  const layouts = C.autoLayout(rooms);
  const polys = rooms.map((r, i) => C.placedPolygon(r, layouts[i]));
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    assert.ok(C.bounds(polys[i]).maxX < C.bounds(polys[j]).minX, "left to right, with a gap");
  }
});

test("changing the floor plan moves the openings to the nearest wall of the new plan", () => {
  const room = C.makeRoom({ polygon: RECT, height: 2.5, openings: [{ wall: 0, u0: 1, u1: 2, v0: 0, v1: 2, kind: "door" }, { wall: 2, u0: 1, u1: 2.2, v0: 0.9, v1: 2.1, kind: "window" }] });
  // one more corner in the middle of the first wall: the wall is cut in two, the door is on the second half
  const more = C.reshapeRoom(room, [[-2, -1.5], [0, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]]);
  assert.equal(more.openings.length, 2);
  const door = more.openings.find((o) => o.kind === "door");
  assert.equal(door.wall, 0);                                       // the door (x from -1 to 0) lies on the first half
  near(door.u0, 1, 1e-9); near(door.u1, 1.98, 1e-9);                  // its edge is where the new wall ends: held 2 cm away from the corner
  const win = more.openings.find((o) => o.kind === "window");
  assert.equal(win.wall, 3);                                           // the south wall is now the fourth
  near(win.u0, 1, 1e-9); near(win.u1, 2.2, 1e-9);
  // a corner moved far away: the opening has no wall any more
  const gone = C.reshapeRoom(room, [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, -5]]);
  assert.ok(gone.openings.length < 2);
  // the same plan changes nothing
  const same = C.reshapeRoom(room, RECT);
  assert.deepEqual(same.openings, room.openings);
});
