// The pieces the games draw their worlds with (static/js/pg-art.js) and the backdrop of the kit (pg-kit.js), without a browser.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = global;
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { getElementById: () => null };
global.addEventListener = () => {};
const dir = path.join(__dirname, "..", "static", "js");
require(path.join(dir, "pg-kit.js"));
require(path.join(dir, "pg-art.js"));
require(path.join(dir, "pg-runners.js"));
const PG = global.PulseGames;
const Art = global.PulseArt;

const noop = () => {};
function context() {
  const calls = {};
  const ctx = new Proxy({}, {
    get(target, name) {
      if (name === "__calls") return calls;
      if (name === "measureText") return (text) => ({ width: String(text).length * 8 });
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop: noop });
      if (name in target) return target[name];
      return (...args) => { calls[name] = (calls[name] || 0) + 1; return args; };
    },
    set(target, name, value) { target[name] = value; return true; },
  });
  return ctx;
}

test("every palette has the colours the scenes ask for", () => {
  for (const [name, palette] of Object.entries(Art.PALETTES)) {
    for (const key of ["top", "bottom", "hill1", "hill2", "sun", "cloud", "ground", "cap"]) assert.ok(typeof palette[key] === "string" && palette[key], `${name}.${key}`);
    assert.equal(typeof palette.night, "boolean", `${name}.night`);
  }
});

test("a scene can be drawn with every helper and every palette", () => {
  const g = context();
  for (const palette of Object.values(Art.PALETTES)) {
    Art.sky(g, palette, 1.5);
    Art.clouds(g, palette, 300);
    Art.hills(g, palette.hill1, 400, 120);
    Art.ground(g, palette, 520, 77);
    Art.shadow(g, 100, 500, 40);
    Art.cloud(g, 20, 30, 1, palette.cloud);
  }
  Art.sprite(g, "🐸", 50, 50, 40, { angle: 0.3, flip: true, sx: 1.1, sy: 0.9 });
  Art.block(g, 10, 10, 60, 30, "#f00");
  Art.chip(g, "HI 00000", 300, 30, { align: "right" });
  assert.ok(g.__calls.fill > 20 && g.__calls.fillRect > 5, "something was drawn");
});

test("the puffs live for a while, drift with the world and are gone afterwards", () => {
  const g = context();
  const fx = Art.fx();
  fx.burst(100, 100, "#fff", 10, 100, 0.5);
  fx.trail(10, 10);
  fx.update(0.1);
  fx.drift(-5, 2);
  fx.draw(g);
  const drawn = g.__calls.arc;
  assert.ok(drawn >= 11, `${drawn} puffs`);
  for (let k = 0; k < 20; k++) fx.update(0.1);
  const after = context();
  fx.draw(after);
  assert.ok(!after.__calls.arc, "nothing is left after two seconds");
  fx.burst(1, 1);
  fx.clear();
  fx.draw(after);
  assert.ok(!after.__calls.arc);
});

test("the backdrop of the kit is drawn for the games without a scene and has to cope with odd colours", () => {
  const g = context();
  for (const color of ["#ff8a4c", "", undefined, "red", "#abc"]) PG.backdrop(g, { id: "some-game", color }, 3.2);
  assert.ok(g.__calls.fillRect >= 5 * 4, "gradient, two lights and the edge for each");
});

test("the games that draw a whole scene say so, because the camera is hidden behind them (the face goes into a bubble)", () => {
  for (const id of ["dino", "flappy", "copter", "cube-dash", "gravity-flip", "lane-runner", "doodle-jump", "zigzag", "dodge-blocks", "crossy-hop", "slalom"]) {
    assert.equal(PG.get(id).bubble, true, id);
  }
});
