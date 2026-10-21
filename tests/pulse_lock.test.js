// The lock of the chats: a stroke of the finger (its shape and its pace) is the key; wrong tries lock the chats for longer and longer.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const core = require(path.join(__dirname, "..", "static", "js", "yipi-core.js"));

let seed = 11;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) * 1.7;
const ease = (u) => u * u * (3 - 2 * u);
const SHAPES = {
  circle: (u) => [200 + Math.cos(u * 6.28) * 100, 300 + Math.sin(u * 6.28) * 100],
  line: (u) => [50 + u * 260, 300],
  check: (u) => (u < 0.3 ? [100 + u * 150, 300 + u * 200] : [145 + (u - 0.3) * 400, 360 - (u - 0.3) * 330]),
  s: (u) => [200 + Math.sin(u * 6.28) * 90, 100 + u * 400],
  l: (u) => (u < 0.6 ? [100, 100 + u * 500] : [100 + (u - 0.6) * 450, 400]),
};
function stroke(name, { pace = 1, size = 1, dx = 0, dy = 0, jitter = 3 } = {}) {
  const n = 60 + Math.floor(rnd() * 20), total = 900 * pace * (1 + gauss() * 0.06), points = [];
  for (let k = 0; k < n; k++) { const u = k / (n - 1); const [x, y] = SHAPES[name](ease(u)); points.push({ x: dx + x * size + gauss() * jitter, y: dy + y * size + gauss() * jitter, t: Math.max(0, total * (u + gauss() * 0.01)) }); }
  points.sort((a, b) => a.t - b.t);
  points[0].t = 0;
  return points;
}

test("the same stroke drawn again (a bit bigger, smaller, moved, a bit faster or slower) opens the chats", () => {
  for (const name of Object.keys(SHAPES)) {
    const template = core.gestureTemplate(stroke(name));
    assert.ok(template && template.shape.length === core.GESTURE_POINTS && template.duration > 600);
    let ok = 0;
    for (let k = 0; k < 60; k++) if (core.gestureScore(template, stroke(name, { size: 0.85 + rnd() * 0.3, dx: rnd() * 60 - 30, dy: rnd() * 60 - 30, pace: 0.88 + rnd() * 0.24, jitter: 3 + rnd() * 3 })) >= core.GESTURE_PASS) ok += 1;
    assert.ok(ok >= 48, `${name}: ${ok} of 60 passed`);
  }
});

test("another shape, or the same shape at double speed or half speed, does not open them", () => {
  const names = Object.keys(SHAPES);
  for (const name of names) {
    const template = core.gestureTemplate(stroke(name));
    for (const other of names.filter((n) => n !== name)) {
      let pass = 0;
      for (let k = 0; k < 20; k++) if (core.gestureScore(template, stroke(other)) >= core.GESTURE_PASS) pass += 1;
      assert.ok(pass <= 3, `${other} against ${name}: ${pass} of 20 passed`);
    }
    for (const pace of [0.4, 2.4]) {
      let pass = 0;
      for (let k = 0; k < 20; k++) if (core.gestureScore(template, stroke(name, { pace })) >= core.GESTURE_PASS) pass += 1;
      assert.ok(pass <= 1, `${name} at pace ${pace}: ${pass} of 20 passed`);
    }
  }
});

test("a tap, a tiny dot or a stroke with nothing in it is no combination", () => {
  assert.equal(core.gestureTemplate([]), null);
  assert.equal(core.gestureTemplate([{ x: 5, y: 5, t: 0 }, { x: 6, y: 5, t: 30 }]), null);
  assert.equal(core.gestureTemplate(Array.from({ length: 20 }, (_, k) => ({ x: 100 + (k % 2), y: 100, t: k * 20 }))), null, "too short a way");
  assert.equal(core.gestureTemplate(Array.from({ length: 30 }, (_, k) => ({ x: k * 10, y: 0, t: k * 2 }))), null, "too quick to be a stroke of a finger");
  assert.equal(core.gestureTemplate([{ x: "a", y: 1, t: 1 }, null, undefined]), null);
  const template = core.gestureTemplate(stroke("line"));
  assert.equal(core.gestureScore(template, []), 0);
  assert.equal(core.gestureScore(null, stroke("line")), 0);
  assert.equal(core.gestureScore({ shape: [[0, 0]], clock: [0], duration: 1 }, stroke("line")), 0);
});

test("the locks get longer: 3 wrong tries give a minute, then 1, 5, 10, 15, 30, 60, 120, 240 minutes and then twice as much", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(core.lockMinutes), [1, 1, 5, 10, 15, 30, 60, 120, 240, 480, 960]);
  const now = 1_000_000;
  let state = { fails: 0, level: 0, until: 0 };
  state = core.lockAfterWrong(state, now); assert.equal(state.until, 0);
  state = core.lockAfterWrong(state, now); assert.equal(state.until, 0, "two wrong tries: no lock yet");
  state = core.lockAfterWrong(state, now); assert.equal(state.until, now + 60_000, "the third one: one minute");
  const minutes = [];
  for (let k = 0; k < 8; k++) { state = core.lockAfterWrong(state, now); minutes.push((state.until - now) / 60_000); }
  assert.deepEqual(minutes, [1, 5, 10, 15, 30, 60, 120, 240], "every further wrong try locks for longer");
  assert.equal((core.lockAfterWrong(state, now).until - now) / 60_000, 480);
});
