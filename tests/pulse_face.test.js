// The face lenses (static/js/pl-face.js) without a browser: every effect is drawn on a face made of real points (a face the model of MediaPipe found in a photo, saved in
// tests/fixtures/face_landmarks.json), once with the camera picture mirrored and once not, with the mouth open and closed. Nothing may throw, something is drawn, and a face
// that is turned or small must not break anything either.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const noop = () => {};
function fakeContext(stats) {
  return new Proxy({ canvas: null }, {
    get(target, name) {
      if (name === "canvas") return fakeCanvas(stats);
      if (name === "measureText") return (text) => ({ width: String(text).length * 8 });
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop: noop });
      if (name in target) return target[name];
      return (...args) => { stats.calls += 1; return args; };
    },
    set(target, name, value) { target[name] = value; return true; },
  });
}
function fakeCanvas(stats, width = 540, height = 960) {
  const canvas = { width, height, getBoundingClientRect: () => ({ width, height, left: 0, top: 0 }), getContext: () => context };
  const context = fakeContext(stats);
  return canvas;
}

global.window = global;
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
const stats = { calls: 0 };
global.document = { createElement: () => fakeCanvas(stats) };
require(path.join(__dirname, "..", "static", "js", "pl-face.js"));
const { PulseFace } = global;
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "face_landmarks.json"), "utf-8"));

function faceLens({ mirror, open = 0.6, smile = 0.7, W = 540, H = 960, scale = 1, roll = 0 }) {
  stats.calls = 0;
  const canvas = fakeCanvas(stats, W, H);
  const video = { videoWidth: fixture.vw, videoHeight: fixture.vh, readyState: 4, currentTime: 1 };
  const lens = new PulseFace.FaceLens({ video, canvas, mirror, recipe: { fx: [], filter: "none" } });
  const k = Math.max(W / fixture.vw, H / fixture.vh);
  const ox = (W - fixture.vw * k) / 2, oy = (H - fixture.vh * k) / 2;
  lens.map = { W, H, k, ox, oy };
  const cx = W / 2, cy = H / 2;
  for (let i = 0; i < 478; i += 1) {
    let x = fixture.pts[i * 2] * fixture.vw * k + ox;
    let y = fixture.pts[i * 2 + 1] * fixture.vh * k + oy;
    x = cx + (x - cx) * scale; y = cy + (y - cy) * scale;
    if (roll) { const dx = x - cx, dy = y - cy; x = cx + dx * Math.cos(roll) - dy * Math.sin(roll); y = cy + dx * Math.sin(roll) + dy * Math.cos(roll); }
    if (mirror) x = W - x;
    lens.xs[i] = x; lens.ys[i] = y;
  }
  lens.have = true;
  lens.blend = { jawOpen: open, mouthSmileLeft: smile, mouthSmileRight: smile };
  return lens;
}

test("the list of effects has what the ready-made lenses and the server name", () => {
  const ids = Object.keys(PulseFace.effects);
  assert.ok(ids.length >= 45, `there are ${ids.length} effects`);
  for (const id of ids) {
    const fx = PulseFace.effects[id];
    assert.ok(fx.label && fx.emoji && typeof fx.draw === "function" && /^[a-zA-Z]{3,20}$/.test(fx.id), id);
  }
  assert.ok(Object.keys(PulseFace.filters).includes("none") && Object.keys(PulseFace.filters).length >= 6);
});

for (const mirror of [true, false]) {
  for (const id of Object.keys(PulseFace.effects)) {
    test(`${id}: is drawn on a real face (${mirror ? "mirrored" : "not mirrored"}), mouth open and closed, near and far, tilted`, () => {
      for (const options of [{ open: 0.7 }, { open: 0 }, { open: 0.5, scale: 0.4, roll: 0.5 }, { open: 0.3, scale: 1.6, roll: -0.4 }, { open: 0.9, W: 360, H: 640, scale: 0.8 }]) {
        const lens = faceLens({ mirror, ...options });
        const c = lens.canvas.getContext("2d");
        for (let step = 0; step < 4; step += 1) {
          const f = lens.frame(0.033, 0.5 + step * 0.2);
          PulseFace.effects[id].draw(c, f);
        }
        if (id !== "tongue" && id !== "rainbow" && id !== "hearts") assert.ok(stats.calls > 0, `${id} drew nothing`);
      }
    });
  }
}

test("a face of a different size gives the effects a sensible unit, and the roll follows the head", () => {
  const near = faceLens({ mirror: false }).frame(0.03, 0);
  const far = faceLens({ mirror: false, scale: 0.5 }).frame(0.03, 0);
  assert.ok(near.s > far.s * 1.8 && near.s < far.s * 2.2, "half the size, half the width");
  assert.ok(Math.abs(near.roll) < 0.4, "a face that looks into the camera is not rolled much");
  const tilted = faceLens({ mirror: false, roll: 0.5 }).frame(0.03, 0);
  assert.ok(Math.abs(tilted.roll - near.roll - 0.5) < 0.05, "the head turned by half a radian");
  assert.ok(near.mouth.open > 0.2, "the open mouth is noticed (the model says the jaw is open)");
  assert.ok(faceLens({ mirror: false, open: 0 }).frame(0.03, 0).mouth.open < 0.35);
  const mirrored = faceLens({ mirror: true }).frame(0.03, 0);
  assert.ok(mirrored.eyeA.x < mirrored.eyeB.x, "the first eye is always the one on the left of the screen");
});
