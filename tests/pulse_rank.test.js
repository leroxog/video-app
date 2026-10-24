// The ranking games with the pictures arriving late (like in a browser): the person that comes out of the machine has to have its picture,
// whether the list of pictures came before the first touch or only after it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = global;
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { getElementById: () => null };
global.addEventListener = () => {};

const dir = path.join(__dirname, "..", "static", "js");
const index = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "static", "rank", "index.json"), "utf-8"));

global.fetch = async () => ({ ok: true, json: async () => index });
global.Image = class {
  set src(value) { this._src = value; Promise.resolve().then(() => { this.naturalWidth = 256; this.naturalHeight = 256; if (this.onload) this.onload(); }); }
  get src() { return this._src; }
};

require(path.join(dir, "pg-kit.js"));
require(path.join(dir, "pg-rank.js"));
const { PulseGames } = global;

function environment(seed) {
  const noop = () => {};
  const ctx = new Proxy({}, {
    get(target, name) {
      if (name === "measureText") return () => ({ width: 10 });
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop: noop });
      return name in target ? target[name] : noop;
    },
    set(target, name, value) { target[name] = value; return true; },
  });
  return PulseGames.createEnv(ctx, { onScore: noop, onOver: noop }, seed);
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

for (const id of ["rank-footballers", "rank-musicians", "rank-countries"]) {
  test(`${id}: the person that comes out has a picture, also when the list of pictures is late`, async () => {
    const env = environment(5);
    const game = PulseGames.get(id).create(env);
    await flush();
    const first = game.peek();
    assert.ok(first.ready && first.items.length >= 30, "the list with the pictures replaced the names only");
    assert.ok(first.pool.every((item) => item.pic), "the pool of the round was made from the list with the pictures");
    for (let k = 0; k < 400; k++) { game.update(1 / 60); env.input.endTick(); }       // the machine spins and stops
    const now = game.peek();
    assert.ok(now.current && now.current.pic && now.current.pic.ok, `${now.current && now.current.name} has a picture`);
    assert.ok(now.items.includes(now.current), "it comes from the list with the pictures, not from the one with the names only");
  });
}

test("the list of pictures that arrives after the first touch still gives the round its pictures", async () => {
  const id = "rank-musicians";
  // the answer of the fetch is only handled after the code that created the game has finished, so the first touches come before it
  const env = environment(9);
  const game = PulseGames.get(id).create(env);
  for (let k = 0; k < 30; k++) { game.update(1 / 60); env.input.endTick(); }           // the first touch has happened, the list is not there yet
  assert.equal(game.peek().current, null, "the machine waits for the pictures");
  await flush();
  for (let k = 0; k < 400; k++) { game.update(1 / 60); env.input.endTick(); }
  const now = game.peek();
  assert.ok(now.current && now.current.pic && now.current.pic.ok, "the person has its picture");
});
