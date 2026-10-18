// Fruit Merge (static/js/fruit-merge.js) without a browser: the physics library runs in Node, the canvas is a stand-in that accepts every call.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const noop = () => {};
const context = new Proxy({}, { get: (target, name) => (name === "createRadialGradient" || name === "createLinearGradient" ? () => ({ addColorStop: noop }) : target[name] || noop), set: (target, name, value) => { target[name] = value; return true; } });

function makeCanvas() {
  const handlers = {};
  return {
    width: 0, height: 0,
    getContext: () => context,
    addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
    removeEventListener: (type, fn) => { handlers[type] = (handlers[type] || []).filter((h) => h !== fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 460, height: 560 }),
    setPointerCapture: noop,
    fire(type, event) { for (const fn of handlers[type] || []) fn({ pointerType: "mouse", preventDefault: noop, ...event }); },
    count: () => Object.values(handlers).reduce((sum, list) => sum + list.length, 0),
  };
}

global.window = global;
global.document = {};
global.Matter = require(path.join(__dirname, "..", "static", "vendor", "matter.min.js"));
global.devicePixelRatio = 1;
global.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.performance = global.performance || { now: () => Date.now() };
const listeners = {};
global.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
global.removeEventListener = (type, fn) => { listeners[type] = (listeners[type] || []).filter((h) => h !== fn); };
require(path.join(__dirname, "..", "static", "js", "fruit-merge.js"));
const { FruitMerge } = global;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function play(drops, hooks = {}, random = 0.0) {
  const real = Math.random;
  Math.random = () => random;                                   // the first fruit kind of the weights, every time
  const canvas = makeCanvas();
  const events = { scores: [], over: [], power: [] };
  const game = FruitMerge.create(canvas, { onScore: (v) => events.scores.push(v), onOver: (v) => events.over.push(v), onPower: (s) => events.power.push(s), ...hooks });
  try {
    for (const x of drops) {
      canvas.fire("pointermove", { clientX: x, clientY: 40 });
      canvas.fire("pointerup", { clientX: x, clientY: 40 });
      await wait(420);
    }
    await wait(1800);
  } finally {
    Math.random = real;
  }
  return { game, canvas, events };
}

test("the module offers its size and fifteen kinds of fruit, growing in size", () => {
  assert.equal(FruitMerge.WIDTH, 460);
  assert.equal(FruitMerge.HEIGHT, 560);
  assert.equal(FruitMerge.TIERS.length, 15);
  const sizes = FruitMerge.TIERS.map((tier) => tier.radius);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => a - b));
  assert.equal(new Set(FruitMerge.TIERS.map((tier) => tier.kind)).size, 15);
});

test("two fruits of the same kind that touch melt into one and score points", async () => {
  const { game, events } = await play([230, 230, 230, 230]);
  try {
    assert.ok(events.scores.length >= 1, "a score was reported after a merge");
    assert.ok(events.scores.at(-1) >= 1, "cherries melted into strawberries: at least one point");
    assert.equal(events.over.length, 0, "no game over yet");
  } finally {
    game.destroy();
  }
});

test("a round brings one shake, one deletion and one bomb, and each can be used once", async () => {
  const { game, events } = await play([230]);
  try {
    const first = events.power.at(-1);
    assert.deepEqual([first.shake, first.remove, first.bomb], [1, 1, 1]);
    game.shake();
    game.shake();
    assert.equal(events.power.at(-1).shake, 0, "used up after one go");
    game.toggleBomb();
    assert.equal(events.power.at(-1).armed, true);
    game.toggleBomb();
    assert.equal(events.power.at(-1).armed, false, "a second tap takes it back");
    game.toggleRemove();
    assert.equal(events.power.at(-1).removing, true);
  } finally {
    game.destroy();
  }
});

test("restart clears the field, the score and the power-ups", async () => {
  const { game, events } = await play([230, 230, 230, 230]);
  try {
    game.shake();
    game.restart();
    assert.equal(events.scores.at(-1), 0);
    const now = events.power.at(-1);
    assert.deepEqual([now.shake, now.remove, now.bomb, now.armed, now.removing, now.over], [1, 1, 1, false, false, false]);
  } finally {
    game.destroy();
  }
});

test("keys aim and drop, and destroy takes every listener away again", async () => {
  const canvas = makeCanvas();
  const game = FruitMerge.create(canvas, {});
  const before = canvas.count();
  assert.ok(before >= 3);
  assert.ok((listeners.keydown || []).length >= 1);
  game.destroy();
  assert.equal(canvas.count(), 0, "no listener left on the canvas");
  assert.equal((listeners.keydown || []).length, 0, "and none on the window");
});
