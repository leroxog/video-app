"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/raumo-core.js");
const P = require("../static/js/raumo-cloud.js");
const Sim = require("../static/js/raumo-sim.js");
const X = require("../static/js/raumo-xr.js");

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} != ${b}`);

const ROOM = C.makeRoom({ polygon: [[-2.3, -1.85], [2.3, -1.85], [2.3, 1.85], [-2.3, 1.85]], height: 2.6, phoneHeight: 1.4, openings: [{ wall: 0, u0: 2.4, u1: 3.3, v0: 0, v1: 2.05, kind: "door" }] });
const SCENE = Sim.makeScene(ROOM, { boxes: Sim.furniture(ROOM) });

// ---- what a WebXR view looks like (OpenGL conventions), built independently of the code under test
function projection(tanX, tanY, cx = 0, cy = 0, near = 0.05, far = 100) {
  // x_ndc = (x / d) / tanX - cx,  d = -z  ->  column major: [0] = 1/tanX, [8] = -cx ... (OpenGL: ndc = P * v / -z)
  return new Float32Array([1 / tanX, 0, 0, 0, 0, 1 / tanY, 0, 0, cx, cy, -(far + near) / (far - near), -1, 0, 0, -2 * far * near / (far - near), 0]);
}

function viewAt(position, forward, up, tanX, tanY, cx = 0, cy = 0) {
  const right = C.normalize(C.cross(forward, up));
  const u = C.cross(right, forward);
  const matrix = new Float32Array([right[0], right[1], right[2], 0, u[0], u[1], u[2], 0, -forward[0], -forward[1], -forward[2], 0, position[0], position[1], position[2], 1]);
  return { transform: { matrix }, projectionMatrix: projection(tanX, tanY, cx, cy), basis: { right, up: u, forward, position } };
}

/* The distance a depth sensor would report at a place (u, v) of the view (0..1 from the top left), by casting a ray the way OpenGL
   defines the view: a point of the screen (ndc) is a direction (x, y, -1) with x = (ndc_x + P[8]) / P[0]. */
function depthInfoFor(view, scene, { bottomOrigin = false } = {}) {
  const P_ = view.projectionMatrix, b = view.basis;
  return {
    getDepthInMeters(u, v) {
      const vv = bottomOrigin ? 1 - v : v;
      const ndcX = 2 * u - 1, ndcY = 1 - 2 * vv;
      const x = (ndcX + P_[8]) / P_[0], y = (ndcY + P_[9]) / P_[5];
      const dir = [b.forward[0] + b.right[0] * x + b.up[0] * y, b.forward[1] + b.right[1] * x + b.up[1] * y, b.forward[2] + b.right[2] * x + b.up[2] * y];
      const hit = Sim.cast(scene, b.position, dir);
      return hit ? hit.t : 0;
    },
  };
}

function distanceToScene(p) {
  const { room, walls, boxes } = SCENE;
  let d = Math.min(Math.abs(p[1]), Math.abs(p[1] - room.height));
  for (const w of walls) d = Math.min(d, Math.abs((p[0] - w.a[0]) * w.inward[0] + (p[2] - w.a[1]) * w.inward[1]));
  for (const b of boxes) d = Math.min(d, Math.hypot(Math.max(b.min[0] - p[0], 0, p[0] - b.max[0]), Math.max(b.min[1] - p[1], 0, p[1] - b.max[1]), Math.max(b.min[2] - p[2], 0, p[2] - b.max[2])));
  return d;
}

test("the camera of a view: place, direction, and the width of its field of view", () => {
  const forward = C.viewFromYawPitch(35, -12).forward, up = C.viewFromYawPitch(35, -12).up;
  const view = viewAt([1, 1.5, -2], forward, up, 0.6, 0.35, 0.02, -0.01);
  const cam = X.cameraFromView(view);
  assert.deepEqual(cam.position.map((x) => Math.round(x * 1000) / 1000), [1, 1.5, -2]);
  for (let k = 0; k < 3; k++) { near(cam.forward[k], forward[k], 1e-6); near(cam.up[k], view.basis.up[k], 1e-6); near(cam.right[k], view.basis.right[k], 1e-6); }
  near(cam.tanX, 0.6, 1e-6); near(cam.tanY, 0.35, 1e-6); near(cam.cx, 0.02, 1e-6); near(cam.cy, -0.01, 1e-6);
});

test("a depth picture is read from the view's own coordinates, row 0 at the top, unknown readings are 0", () => {
  const calls = [];
  const info = { getDepthInMeters: (u, v) => { calls.push([u, v]); return u > 0.9 ? NaN : u > 0.8 ? -1 : u > 0.7 ? 0 : 1 + v; } };
  const grid = X.depthGrid(info, 4, 2);
  assert.equal(grid.width, 4); assert.equal(grid.height, 2);
  assert.deepEqual(calls[0], [0.125, 0.25]);
  assert.deepEqual(calls[4], [0.125, 0.75]);
  assert.deepEqual([...grid.data], [1.25, 1.25, 1.25, 0, 1.75, 1.75, 1.75, 0]);
  const flipped = X.depthGrid(info, 4, 2, true);
  assert.equal(flipped.data[0], 1.75);
  const failing = X.depthGrid({ getDepthInMeters() { throw new Error("no"); } }, 2, 2);
  assert.deepEqual([...failing.data], [0, 0, 0, 0]);
});

function walkThrough(options = {}) {
  const processor = new X.FrameProcessor({ ...(options.processor || {}) });
  const tanX = options.tanX || 0.5, tanY = options.tanY || 0.875;                  // portrait: the long side is the vertical one
  for (const pose of Sim.walkPath(ROOM, options.steps || 110)) {
    const view = viewAt(pose.position, pose.forward, pose.up, tanX, tanY, options.cx || 0, options.cy || 0);
    processor.process(view, depthInfoFor(view, SCENE, options), null);
  }
  return processor;
}

test("walking through with a phone held upright gives points on the walls, the floor and the furniture", () => {
  const processor = walkThrough();
  const cloud = processor.finish();
  assert.ok(cloud.count > 6000, `${cloud.count} points`);
  let far = 0;
  for (let i = 0; i < cloud.count; i++) if (distanceToScene([cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]]) > 0.04) far += 1;
  assert.ok(far / cloud.count < 0.01, `${far} of ${cloud.count} off`);
});

test("a lens whose middle is not the middle of the picture is handled", () => {
  const cloud = walkThrough({ cx: 0.04, cy: -0.03 }).finish();
  let far = 0;
  for (let i = 0; i < cloud.count; i++) if (distanceToScene([cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]]) > 0.04) far += 1;
  assert.ok(cloud.count > 5000 && far / cloud.count < 0.01, `${far} of ${cloud.count}`);
});

test("a device that counts the rows of its depth picture from the bottom works with the flip option and is visibly wrong without it", () => {
  const wrong = walkThrough({ bottomOrigin: true, steps: 70 }).finish();
  const right = walkThrough({ bottomOrigin: true, flipDepthY: true, processor: { flipDepthY: true }, steps: 70 }).finish();
  const off = (cloud) => { let n = 0; for (let i = 0; i < cloud.count; i++) if (distanceToScene([cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2]]) > 0.1) n += 1; return n / Math.max(1, cloud.count); };
  assert.ok(off(right) < 0.01, `with the flip: ${off(right)}`);
  assert.ok(off(wrong) > 0.2, `without the flip: ${off(wrong)}`);
});

test("without depth information nothing is made up", () => {
  const processor = new X.FrameProcessor();
  const view = viewAt([0, 1.4, 0], [0, 0, -1], [0, 1, 0], 0.5, 0.875);
  for (let i = 0; i < 5; i++) assert.equal(processor.process(view, null, null), 0);
  assert.equal(processor.count, 0);
  assert.equal(processor.withoutDepth, 5);
  assert.equal(processor.finish().count, 0);
});

test("the colours of the camera picture go onto the points: the top of the picture is red, the bottom blue", () => {
  const processor = new X.FrameProcessor({ minHits: 1 });
  const view = viewAt([0, 1.4, 0], [0, 0, -1], [0, 1, 0], 0.5, 0.875);
  const color = { width: 4, height: 4, data: new Uint8ClampedArray(64) };
  for (let i = 0; i < 16; i++) { color.data[i * 4] = i < 8 ? 250 : 10; color.data[i * 4 + 1] = 100; color.data[i * 4 + 2] = i < 8 ? 10 : 250; color.data[i * 4 + 3] = 255; }
  processor.process(view, { getDepthInMeters: () => 2 }, color);
  const cloud = processor.capture.toCloud();                         // before the floor is moved to zero
  assert.ok(cloud.count > 100);
  let top = 0, topRed = 0, bottom = 0, bottomBlue = 0;
  for (let i = 0; i < cloud.count; i++) {
    if (cloud.positions[i * 3 + 1] > 1.4) { top += 1; if (cloud.colors[i * 3] > 200) topRed += 1; }
    else { bottom += 1; if (cloud.colors[i * 3 + 2] > 200) bottomBlue += 1; }
  }
  assert.ok(top > 20 && bottom > 20);
  assert.equal(topRed, top);
  assert.equal(bottomBlue, bottom);
});
