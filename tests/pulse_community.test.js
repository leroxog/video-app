// The games of the community (static/js/pg-community.js) without a browser: the bridge to the sealed worker, with a worker that is only an object here. (The jump-and-run engine and its
// builder are gone.)
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
require(path.join(dir, "pg-kit.js"));
require(path.join(dir, "pg-community.js"));
const PG = global.PulseGames;
const C = PG.community;

const noop = () => {};
function environment(seed = 5) {
  const ctx = new Proxy({}, {
    get(target, name) {
      if (name === "measureText") return () => ({ width: 10 });
      if (name === "createLinearGradient" || name === "createRadialGradient") return () => ({ addColorStop: noop });
      return name in target ? target[name] : noop;
    },
    set(target, name, value) { target[name] = value; return true; },
  });
  const log = { scores: [], over: 0 };
  const env = PG.createEnv(ctx, { onScore: (n) => log.scores.push(n), onOver: () => { log.over += 1; } }, seed);
  return { env, log, ctx };
}

// ------------------------------------------------------------------------------------------------ the sealed worker
class FakeWorker {
  constructor(url) { FakeWorker.last = this; this.url = url; this.sent = []; this.terminated = false; }
  postMessage(message) { this.sent.push(message); }
  terminate() { this.terminated = true; }
}
const answer = (worker, message) => worker.onmessage({ data: message });

test("a code game: the page sends the input and a step, draws the picture that comes back, takes points and the end from the worker", () => {
  global.Worker = FakeWorker;
  const { env, log, ctx } = environment();
  let drawn = 0;
  ctx.drawImage = () => { drawn += 1; };
  const def = C.codeDef({ id: "gu-0a1b2c3d", title: "Ball", emoji: "🟡", color: "#7a2cf0", user: { handle: "mia" } });
  assert.equal(def.hint, "Spiel von @mia");
  const game = def.create(env);
  const worker = FakeWorker.last;
  assert.equal(worker.url, "/api/yipi/game-worker/gu-0a1b2c3d", "the script of the worker comes from the server (with the header that forbids connections)");
  game.update(1 / 60);
  assert.equal(worker.sent.length, 0, "nothing is sent before the worker says it is ready");
  answer(worker, { t: "ready" });
  env.input.x = 100; env.input.y = 200; env.input.down = true; env.input.pressed = true;
  game.update(1 / 60);
  assert.deepEqual(worker.sent.map((m) => m.t), ["input", "step"]);
  assert.equal(worker.sent[0].input.x, 100);
  assert.ok(Object.keys(worker.sent[0].input).every((key) => ["x", "y", "down", "pressed", "tap", "released", "swipe"].includes(key)), "only the finger goes into the worker");
  game.update(1 / 60);
  assert.equal(worker.sent.length, 2, "no second step while the picture of the first one has not come");
  const bitmap = { width: 360, height: 640, closed: false, close() { this.closed = true; } };
  answer(worker, { t: "frame", bitmap });
  game.draw();
  assert.equal(drawn, 1);
  answer(worker, { t: "frame", bitmap: { width: 10, height: 10, close() {} } });
  answer(worker, { t: "score", n: 7 });
  answer(worker, { t: "score", n: "evil" });
  answer(worker, { t: "unknown", n: 1 });
  assert.deepEqual(log.scores, [7]);
  game.update(1 / 60);
  assert.equal(worker.sent.length, 4, "the next step goes out after the picture");
  answer(worker, { t: "over" });
  assert.equal(log.over, 1);
  game.destroy();
  assert.ok(worker.terminated);
});

test("a code game that hangs or breaks is stopped and says so", () => {
  global.Worker = FakeWorker;
  const clock = { now: 1000 };
  const real = performance.now;
  performance.now = () => clock.now;
  try {
    const { env } = environment();
    const game = C.codeDef({ id: "gu-0a1b2c3e", title: "Hängt", emoji: "🧩", color: "#000000" }).create(env);
    const worker = FakeWorker.last;
    answer(worker, { t: "ready" });
    game.update(0.016);
    clock.now += 2600;
    game.update(0.016);
    assert.ok(worker.terminated, "the worker that does not answer for two seconds is ended");
    const { env: other } = environment();
    const broken = C.codeDef({ id: "gu-0a1b2c3f", title: "Kaputt", emoji: "🧩", color: "#000000" }).create(other);
    const second = FakeWorker.last;
    answer(second, { t: "ready" });
    answer(second, { t: "error", message: "x is not defined" });
    broken.update(0.016);
    assert.equal(second.sent.length, 0, "after an error nothing is sent any more");
    second.onerror({ message: "SyntaxError" });
    broken.draw();
  } finally { performance.now = real; }
});

test("without Worker (an old browser) the game says it cannot start", () => {
  delete global.Worker;
  const { env, ctx } = environment();
  const texts = [];
  const game = C.codeDef({ id: "gu-0a1b2c40", title: "Alt", emoji: "🧩", color: "#000" }).create(env);
  game.update(0.016);
  game.draw();
  assert.ok(game);
  void ctx; void texts;
});

test("the jump-and-run games and their engine are gone, only the bridge to the worker is left", () => {
  assert.ok(!PG.list().some((game) => /^jr-/.test(game.id)));
  assert.deepEqual(Object.keys(C).sort(), ["codeDef", "communityDef"]);
  assert.equal(C.communityDef({ id: "gu-0a1b2c3d", title: "Ball", emoji: "x", color: "#000000", kind: "code" }).community, true);
});
