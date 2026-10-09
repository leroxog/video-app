"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/raumo-core.js");
const P = require("../static/js/raumo-cloud.js");
const Sim = require("../static/js/raumo-sim.js");

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} != ${b}`);

const ROOM = C.makeRoom({ polygon: [[-2.3, -1.85], [2.3, -1.85], [2.3, 1.85], [-2.3, 1.85]], height: 2.6, phoneHeight: 1.4, openings: [
  { wall: 0, u0: 2.4, u1: 3.3, v0: 0, v1: 2.05, kind: "door" }, { wall: 1, u0: 0.8, u1: 2.6, v0: 0.9, v1: 2.1, kind: "window" }] });

/* Pictures with a recognisable pattern: the colour tells where on the surface a point is. */
function picture(width, height, color) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = (y * width + x) * 4, c = color(x / width, y / height);
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { width, height, data };
}
const PICTURES = { "wall:0": picture(64, 32, (u) => [255 * u, 40, 40]), "wall:1": picture(64, 32, () => [40, 200, 40]), "wall:2": picture(64, 32, () => [40, 40, 220]), "wall:3": picture(64, 32, () => [200, 200, 40]), floor: picture(32, 32, () => [150, 100, 60]), ceiling: picture(8, 8, () => [250, 250, 250]) };

// ----------------------------------------------------------------------------------------------- voxel grid
test("one point for every cube: readings in the same 5 cm cube are averaged", () => {
  const g = new P.VoxelGrid(0.05, 2);
  g.add(0.011, 0.011, 0.011, 100, 0, 0);
  assert.equal(g.visible, 0, "one reading is not enough");
  g.add(0.019, 0.013, 0.012, 200, 0, 0);
  assert.equal(g.visible, 1);
  g.add(0.2, 0.2, 0.2, 0, 255, 0);
  const cloud = g.toCloud();
  assert.equal(cloud.count, 1);
  near(cloud.positions[0], 0.015, 1e-6);
  near(cloud.colors[0], 150, 1);
  assert.equal(g.takeNew().length, 1);
  assert.equal(g.takeNew().length, 0);
  g.add(0.2, 0.2, 0.2, 0, 255, 0);
  assert.equal(g.takeNew().length, 1);
});

test("cubes at the edges of the world are told apart, and far away readings are refused", () => {
  const g = new P.VoxelGrid(0.05, 1);
  for (const [x, y, z] of [[0, 0, 0], [-0.06, 0, 0], [0, -0.06, 0], [0, 0, -0.06], [100, 5, 100], [-100, -5, -100]]) assert.ok(g.add(x, y, z, 1, 2, 3));
  assert.equal(g.visible, 6);
  assert.equal(g.add(1e6, 0, 0, 1, 2, 3), false);
  assert.equal(g.add(0, 1e6, 0, 1, 2, 3), false);
});

test("clouds are merged and moved like rooms in a building", () => {
  const a = { count: 1, positions: new Float32Array([1, 2, 0]), colors: new Uint8Array([10, 20, 30]) };
  const b = { count: 1, positions: new Float32Array([1, 0, 0]), colors: new Uint8Array([1, 2, 3]) };
  const m = P.mergeClouds([a, b], [{ x: 5, z: 7, rot: 90 }, { x: 0, z: 0, rot: 0 }]);
  assert.equal(m.count, 2);
  const placed = C.placePoint({ x: 5, z: 7, rot: 90 }, [1, 0]);
  near(m.positions[0], placed[0], 1e-5); near(m.positions[1], 2); near(m.positions[2], placed[1], 1e-5);
  assert.deepEqual([...m.colors], [10, 20, 30, 1, 2, 3]);
  assert.equal(P.mergeClouds([a, b]).count, 2);
});

test("a dense cloud is thinned to one point per cube", () => {
  const n = 1000, positions = new Float32Array(n * 3), colors = new Uint8Array(n * 3).fill(9);
  for (let i = 0; i < n; i++) { positions[i * 3] = (i % 10) * 0.001; positions[i * 3 + 1] = Math.floor(i / 100) * 0.001; positions[i * 3 + 2] = ((i / 10) % 10 | 0) * 0.001; }
  assert.equal(P.voxelize({ count: n, positions, colors }).count, 1);
});

// ------------------------------------------------------------------------------------------------ rooms
test("a measured room becomes points every 5 cm on its walls, floor and ceiling, with the colours of its pictures", () => {
  const cloud = P.sampleRoom(ROOM, PICTURES);
  const walls = C.wallsOf(ROOM.polygon);
  const wallArea = walls.reduce((s, w) => s + w.len * ROOM.height, 0) - 0.9 * 2.05 - 1.8 * 1.2;
  const expected = (wallArea + 2 * C.polygonArea(ROOM.polygon)) / 0.0025;
  assert.ok(Math.abs(cloud.count - expected) / expected < 0.05, `${cloud.count} points, about ${Math.round(expected)} expected`);
  let off = 0, hole = 0;
  for (let i = 0; i < cloud.count; i++) {
    const x = cloud.positions[i * 3], y = cloud.positions[i * 3 + 1], z = cloud.positions[i * 3 + 2];
    const onFloor = Math.abs(y) < 0.026, onCeiling = Math.abs(y - 2.6) < 0.026;
    const onWall = walls.some((w) => Math.abs((x - w.a[0]) * w.inward[0] + (z - w.a[1]) * w.inward[1]) < 0.026);
    if (!(onFloor || onCeiling || onWall)) off += 1;
    const w0 = walls[0], u = (x - w0.a[0]) * w0.dir[0] + (z - w0.a[1]) * w0.dir[1];
    if (Math.abs(z - -1.85) < 0.026 && u > 2.45 && u < 3.25 && y > 0.06 && y < 2.0) hole += 1;
  }
  assert.equal(off, 0, "every point is on a surface");
  assert.equal(hole, 0, "no points in the doorway");
  // colours: the east wall (wall 1) is green, the south wall blue
  let green = 0, blue = 0;
  for (let i = 0; i < cloud.count; i++) {
    const c = [cloud.colors[i * 3], cloud.colors[i * 3 + 1], cloud.colors[i * 3 + 2]];
    if (Math.abs(cloud.positions[i * 3] - 2.3) < 0.026 && Math.abs(cloud.positions[i * 3 + 2]) < 1.8 && cloud.positions[i * 3 + 1] > 0.1 && cloud.positions[i * 3 + 1] < 2.5) { assert.deepEqual(c, [40, 200, 40]); green += 1; }
    if (Math.abs(cloud.positions[i * 3 + 2] - 1.85) < 0.026 && cloud.positions[i * 3 + 1] > 0.1 && cloud.positions[i * 3 + 1] < 2.5 && Math.abs(cloud.positions[i * 3]) < 2.2) { assert.deepEqual(c, [40, 40, 220]); blue += 1; }
  }
  assert.ok(green > 500 && blue > 500);
  const plain = P.sampleRoom(ROOM);
  assert.equal(plain.count, cloud.count);
});

// -------------------------------------------------------------------------------------------------- files
function sampleCloud() {
  const n = 500, positions = new Float32Array(n * 3), colors = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { positions[i * 3] = Math.sin(i) * 3; positions[i * 3 + 1] = (i % 50) * 0.05; positions[i * 3 + 2] = Math.cos(i * 1.7) * 2 - 1; colors[i * 3] = i % 256; colors[i * 3 + 1] = (i * 3) % 256; colors[i * 3 + 2] = 255 - (i % 256); }
  return { count: n, positions, colors };
}
const sameCloud = (a, b, eps) => {
  assert.equal(a.count, b.count);
  for (let i = 0; i < a.count * 3; i++) { assert.ok(Math.abs(a.positions[i] - b.positions[i]) <= eps, `position ${i}: ${a.positions[i]} vs ${b.positions[i]}`); assert.equal(a.colors[i], b.colors[i], `colour ${i}`); }
};

test("PLY: writing and reading give back the same cloud", () => {
  const cloud = sampleCloud();
  const bytes = P.toPLY(cloud);
  assert.ok(new TextDecoder().decode(bytes.subarray(0, 60)).startsWith("ply\nformat binary_little_endian 1.0"));
  sameCloud(P.fromPLY(bytes), cloud, 0);
  assert.equal(P.readCloud(bytes).format, "ply");
});

test("PLY: text files, big endian files and files with more fields are read", () => {
  const ascii = new TextEncoder().encode("ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n1 2 3 0 10 20 30\n4 5 6 0 40 50 60\n");
  const a = P.fromPLY(ascii);
  assert.deepEqual([...a.positions], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...a.colors], [10, 20, 30, 40, 50, 60]);
  const header = new TextEncoder().encode("ply\nformat binary_big_endian 1.0\nelement vertex 1\nproperty double x\nproperty double y\nproperty double z\nproperty float intensity\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n");
  const body = new Uint8Array(8 * 3 + 4 + 3);
  const dv = new DataView(body.buffer);
  dv.setFloat64(0, 1.5); dv.setFloat64(8, -2.5); dv.setFloat64(16, 9); dv.setFloat32(24, 7); body.set([11, 22, 33], 28);
  const big = new Uint8Array(header.length + body.length);
  big.set(header); big.set(body, header.length);
  const b = P.fromPLY(big);
  assert.deepEqual([...b.positions], [1.5, -2.5, 9]);
  assert.deepEqual([...b.colors], [11, 22, 33]);
  const noColour = new TextEncoder().encode("ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n1 2 3\n");
  assert.deepEqual([...P.fromPLY(noColour).colors], [200, 200, 200]);
});

test("PLY: damaged and foreign files are refused with a message", () => {
  const good = P.toPLY(sampleCloud());
  assert.throws(() => P.fromPLY(good.subarray(0, good.length - 100)), /abgeschnitten/);
  assert.throws(() => P.fromPLY(new TextEncoder().encode("hello")), /keine PLY/);
  assert.throws(() => P.fromPLY(new TextEncoder().encode("ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n1\n")), /Koordinaten/);
  assert.throws(() => P.fromPLY(new TextEncoder().encode("ply\nformat ascii 1.0\nelement vertex 99999999\nproperty float x\nproperty float y\nproperty float z\nend_header\n"), 1000), /zu viele/);
  assert.throws(() => P.fromPLY(new TextEncoder().encode("ply\nformat ascii 1.0\nelement vertex 1\nproperty list uchar int x\nend_header\n")), /Listen/);
});

test("XYZ: writing and reading, other separators and colours between 0 and 1", () => {
  const cloud = sampleCloud();
  const back = P.fromXYZ(P.toXYZ(cloud));
  sameCloud(back, cloud, 0.0006);
  const odd = P.fromXYZ(new TextEncoder().encode("# comment\n1,2,3,0.5,0.25,1\n\n4;5;6;0.1;0.2;0.3\nnot a point\n7 8 9\n"));
  assert.equal(odd.count, 3);
  assert.deepEqual([...odd.colors.slice(0, 6)], [128, 64, 255, 26, 51, 77]);
  assert.deepEqual([...odd.colors.slice(6)], [200, 200, 200]);
  assert.throws(() => P.fromXYZ(new TextEncoder().encode("nothing here\n")), /keine Punkte/);
});

test("LAS: writing and reading give back the points to a millimetre, with colours, and a correct header", () => {
  const cloud = sampleCloud();
  const bytes = P.toLAS(cloud);
  const dv = new DataView(bytes.buffer);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), "LASF");
  assert.equal(dv.getUint16(94, true), 227);
  assert.equal(dv.getUint32(96, true), 227);
  assert.equal(dv.getUint8(104), 2);
  assert.equal(dv.getUint16(105, true), 26);
  assert.equal(dv.getUint32(107, true), cloud.count);
  assert.equal(bytes.length, 227 + 26 * cloud.count);
  const back = P.fromLAS(bytes);
  sameCloud(back, cloud, 0.0011);
  // the bounding box in the header holds (x, y north, z up)
  let maxX = -Infinity, minZ = Infinity;
  for (let i = 0; i < cloud.count; i++) { maxX = Math.max(maxX, cloud.positions[i * 3]); minZ = Math.min(minZ, cloud.positions[i * 3 + 1]); }
  near(dv.getFloat64(179, true), maxX, 1e-6);
  near(dv.getFloat64(219, true), minZ, 1e-6);
  assert.equal(P.readCloud(bytes).format, "las");
  assert.throws(() => P.fromLAS(bytes.subarray(0, 300)), /abgeschnitten/);
  assert.throws(() => P.fromLAS(new Uint8Array(300)), /keine LAS/);
  const laz = bytes.slice(); laz[104] |= 0x80;
  assert.throws(() => P.fromLAS(laz), /LAZ/);
});

test("far away coordinates are moved to the origin so that they can be shown exactly", () => {
  const cloud = { count: 2, positions: new Float32Array([500000, 100, 5400000, 500004, 103, 5400002]), colors: new Uint8Array(6) };
  const { cloud: moved, shift } = P.recentre(cloud);
  assert.deepEqual([...moved.positions], [-2, 0, -1, 2, 3, 1]);
  assert.deepEqual(shift, [500002, 100, 5400001]);
});

// ----------------------------------------------------------------------------- a walk through a make-believe room
const SCENE = Sim.makeScene(ROOM, { pictures: PICTURES, boxes: Sim.furniture(ROOM) });

function distanceToScene(p) {
  const { room, walls, boxes } = SCENE;
  let d = Math.min(Math.abs(p[1]), Math.abs(p[1] - room.height));
  for (const w of walls) d = Math.min(d, Math.abs((p[0] - w.a[0]) * w.inward[0] + (p[2] - w.a[1]) * w.inward[1]));
  for (const b of boxes) {
    const dx = Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]), dy = Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]), dz = Math.max(b.min[2] - p[2], 0, p[2] - b.max[2]);
    d = Math.min(d, Math.hypot(dx, dy, dz));
  }
  return d;
}

function walk(options = {}) {
  const capture = new P.WalkCapture({ minHits: 2, ...(options.capture || {}) });
  let seed = 1;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const pose of Sim.walkPath(ROOM, options.steps || 90)) capture.addFrame(Sim.renderFrame(SCENE, pose.position, pose.forward, pose.up, { depthSize: [64, 36], colorSize: [96, 54], noise: options.noise || 0, random }));
  return capture;
}

test("walking through the room gives points that lie on its surfaces and on the furniture", () => {
  const capture = walk();
  const cloud = capture.toCloud();
  assert.ok(cloud.count > 8000, `${cloud.count} points`);
  let far = 0;
  for (let i = 0; i < cloud.count; i++) if (distanceToScene([cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]]) > 0.04) far += 1;
  assert.ok(far / cloud.count < 0.01, `${far} of ${cloud.count} points are more than 4 cm from anything`);
});

test("the points keep their distance: no two readings in one 5 cm cube", () => {
  const cloud = walk().toCloud();
  const grid = new P.VoxelGrid(0.05, 1);
  const seen = new Set();
  let doubles = 0;
  for (let i = 0; i < cloud.count; i++) {
    const k = grid.cellKey(cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]);
    if (seen.has(k)) doubles += 1;
    seen.add(k);
  }
  assert.ok(doubles / cloud.count < 0.002, `${doubles} double cubes`);
});

test("the walk covers most of the room, and the points have the colours of what was seen", () => {
  const cloud = walk().toCloud();
  const truth = P.sampleRoom(ROOM, PICTURES);
  const grid = new P.VoxelGrid(0.12, 1);
  for (let i = 0; i < cloud.count; i++) grid.add(cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2], 0, 0, 0);
  let covered = 0;
  for (let i = 0; i < truth.count; i++) {
    const k = [0, 1, 2].map((a) => Math.floor(truth.positions[i * 3 + a] / 0.12));
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) for (let dz = -1; dz <= 1 && !hit; dz++) if (grid.cells.has(grid.key(k[0] + dx, k[1] + dy, k[2] + dz))) hit = true;
    if (hit) covered += 1;
  }
  assert.ok(covered / truth.count > 0.8, `${Math.round(100 * covered / truth.count)} % of the surface is covered`);
  // colour: points on the east wall (green) really are green, points on the blue south wall are blue
  let green = 0, greenOk = 0, blue = 0, blueOk = 0;
  for (let i = 0; i < cloud.count; i++) {
    const x = cloud.positions[i * 3], y = cloud.positions[i * 3 + 1], z = cloud.positions[i * 3 + 2];
    const c = [cloud.colors[i * 3], cloud.colors[i * 3 + 1], cloud.colors[i * 3 + 2]];
    if (Math.abs(x - 2.3) < 0.02 && y > 0.2 && y < 2.4) { green += 1; if (c[1] > 150 && c[0] < 90) greenOk += 1; }
    if (Math.abs(z - 1.85) < 0.02 && y > 0.2 && y < 2.4 && Math.abs(x) < 2.1) { blue += 1; if (c[2] > 150 && c[0] < 90) blueOk += 1; }
  }
  assert.ok(green > 100 && blue > 100, `green ${green}, blue ${blue}`);
  assert.ok(greenOk / green > 0.95 && blueOk / blue > 0.95, `green ok ${greenOk}/${green}, blue ok ${blueOk}/${blue}`);
});

test("a sensor that is off by one percent still gives points within a few centimetres", () => {
  const cloud = walk({ noise: 0.01, steps: 120 }).toCloud();
  let far = 0, bad = 0;
  for (let i = 0; i < cloud.count; i++) {
    const d = distanceToScene([cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]]);
    if (d > 0.05) far += 1;
    if (d > 0.1) bad += 1;
  }
  assert.ok(cloud.count > 6000);
  assert.ok(far / cloud.count < 0.05, `${far} of ${cloud.count} more than 5 cm off`);
  assert.ok(bad / cloud.count < 0.01, `${bad} more than 10 cm off`);
});

test("single wrong readings are thrown away: a point needs two sightings", () => {
  const cap = new P.WalkCapture({ minHits: 2 });
  const depth = { width: 16, height: 16, data: new Float32Array(256).fill(2) };
  depth.data[8 * 16 + 8] = 0.5;                                      // one reading far off its neighbours: an edge, skipped
  const frame = { camera: { position: [0, 1, 0], forward: [0, 0, -1], up: [0, 1, 0], right: [1, 0, 0], tanX: 0.7, tanY: 0.7 }, depth, color: null };
  cap.addFrame(frame);
  assert.equal(cap.count, 0, "one sighting is not enough");
  cap.addFrame(frame);
  assert.ok(cap.count > 10);
  const cloud = cap.toCloud();
  for (let i = 0; i < cloud.count; i++) near(cloud.positions[i * 3 + 2], -2, 1e-4);
});

test("readings that are too near, too far or unknown make no points", () => {
  const frame = (value) => ({ camera: { position: [0, 1, 0], forward: [0, 0, -1], up: [0, 1, 0], right: [1, 0, 0], tanX: 0.7, tanY: 0.7 }, depth: { width: 8, height: 8, data: new Float32Array(64).fill(value) }, color: null });
  for (const value of [0, NaN, 0.1, 9, -1]) assert.equal(P.unproject(frame(value)).length, 0, String(value));
  assert.ok(P.unproject(frame(1)).length > 0);
});

test("the unprojection puts a pixel where its ray goes: the picture's corners reach the corners of the field of view", () => {
  const cam = { position: [1, 1.5, 2], forward: [0, 0, -1], up: [0, 1, 0], right: [1, 0, 0], tanX: 1, tanY: 0.5 };
  const depth = { width: 40, height: 20, data: new Float32Array(800).fill(2) };
  const points = P.unproject({ camera: cam, depth, color: null }, { stride: 1 });
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  // the first usable pixel column is the second one (the border is skipped because its neighbours are missing): its middle is at -0.925 of the half width
  near(Math.min(...xs), 1 + 2 * 1 * -0.925, 1e-9);                    // x = position + depth * tanX * (that)
  near(Math.max(...xs), 1 + 2 * 1 * 0.925, 1e-9);
  near(Math.max(...ys), 1.5 + 2 * 0.5 * 0.85, 1e-9);                  // the top of the picture is up
  for (const p of points) near(p[2], 0, 1e-9);
});

test("the floor is found and moved to height zero, whatever is below it", () => {
  const room = P.sampleRoom(ROOM, PICTURES);
  const down = new Float32Array(room.positions);
  for (let i = 0; i < room.count; i++) down[i * 3 + 1] -= 1.4;
  const outliers = 40;
  const positions = new Float32Array(down.length + outliers * 3), colors = new Uint8Array((room.count + outliers) * 3);
  positions.set(down); colors.set(room.colors);
  for (let i = 0; i < outliers; i++) { positions[down.length + i * 3 + 1] = -4 - i * 0.1; positions[down.length + i * 3] = i * 0.01; }
  const cloud = { count: room.count + outliers, positions, colors };
  near(P.floorLevel(cloud), -1.4, 0.03);
  const { cloud: levelled, shift } = P.alignFloor(cloud);
  near(shift, 1.4, 0.03);
  let onFloor = 0;
  for (let i = 0; i < room.count; i++) if (Math.abs(levelled.positions[i * 3 + 1]) < 0.04) onFloor += 1;
  assert.ok(onFloor > room.count * 0.2, "the floor is where height zero is");
  assert.equal(P.alignFloor(P.sampleRoom(ROOM)).shift, 0, "a cloud that stands on the floor is not moved");
  assert.equal(P.floorLevel({ count: 3, positions: new Float32Array(9), colors: new Uint8Array(9) }), null);
});

test("a cloud with z up is turned so that y is up", () => {
  const cloud = { count: 1, positions: new Float32Array([1, 2, 3]), colors: new Uint8Array([9, 9, 9]) };
  const turned = P.zUpToYUp(cloud);
  assert.deepEqual([...turned.positions], [1, 3, -2]);
  assert.deepEqual([...turned.colors], [9, 9, 9]);
});
