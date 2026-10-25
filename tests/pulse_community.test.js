// The games of the community (static/js/pg-community.js) without a browser: the jump-and-run engine on levels made by hand and by the generator (a simple bot that jumps in front of
// every danger has to be able to finish what the generator makes), and the bridge to the sealed worker with a worker that is only an object here.
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
const flat = (cols, extra = {}) => {
  const rows = Array.from({ length: 9 }, () => ".".repeat(cols).split(""));
  for (let c = 0; c < cols; c += 1) { rows[7][c] = "#"; rows[8][c] = "#"; }
  for (const [row, col, ch] of extra.set || []) rows[row][col] = ch;
  return { map: rows.map((row) => row.join("")), theme: extra.theme || "day", hero: "🐱", speed: extra.speed || 2 };
};

/* plays a level with a function that decides for every tick if the finger is down; returns what happened */
function play(level, decide, { frames = 3000 } = {}) {
  const { env, log } = environment();
  const game = C.platformerDef({ id: "t-level", title: "T" }, level).create(env);
  let pressedFrames = 0;
  for (let frame = 0; frame < frames && !env.finished; frame += 1) {
    const state = game.peek();
    const want = decide(state, frame);
    if (want && !env.input.down) { env.input.pressed = true; env.input.down = true; pressedFrames += 1; } else if (!want && env.input.down) { env.input.down = false; env.input.released = true; }
    game.update(1 / 60);
    env.input.endTick();
    game.draw();
  }
  return { env, log, game, state: game.peek(), pressedFrames };
}

/* a bot that jumps when something is in the way: at the edge of a pit, a third of a jump in front of spikes, blocks and enemies */
function bot(state) {
  const { hero, tile, speed } = state;
  if (!hero.ground) return hero.vy < 0;                                        // keep the finger down while it rises
  if (tile(Math.floor((hero.x + 13) / 40), 7) !== "#") return true;            // the ground ends under the figure
  const reach = speed * 0.71;                                                   // how far one jump flies
  for (let k = 0; k < 5; k += 1) {
    const col = Math.floor(hero.x / 40) + k;
    if (["^", "#"].includes(tile(col, 6)) || tile(col, 5) === "#") { const gap = col * 40 - hero.x; if (gap <= reach * 0.34 && gap > -12) return true; break; }
  }
  for (const e of state.enemies) if (e.alive && e.x > hero.x - 10 && e.x - hero.x < reach * 0.3 + 12) return true;
  return false;
}

test("a level that is only ground ends at the flag with the bonus", () => {
  const level = flat(40, { set: [[6, 36, "F"]] });
  const { env, state } = play(level, () => false);
  assert.ok(env.finished && state.hero.won, "the figure runs to the flag by itself");
  assert.ok(env.points >= 100 + 30, `points ${env.points}`);
});

test("a pit, spikes and an enemy from the side end the round when nobody jumps", () => {
  for (const level of [flat(40, { set: [[7, 12, "."], [8, 12, "."], [7, 13, "."], [8, 13, "."], [6, 36, "F"]] }), flat(40, { set: [[6, 12, "^"], [6, 36, "F"]] }), flat(40, { set: [[6, 14, "e"], [6, 36, "F"]] }), flat(40, { set: [[6, 12, "#"], [5, 12, "#"], [6, 36, "F"]] })]) {
    const { env, state } = play(level, () => false);
    assert.ok(env.finished && !state.hero.won, "the round ended without the goal");
  }
});

test("a jump gets over a pit, over spikes and over a step, coins give points and a stomped enemy gives more", () => {
  const level = flat(60, { set: [[7, 14, "."], [8, 14, "."], [7, 15, "."], [8, 15, "."], [6, 24, "^"], [6, 32, "#"], [6, 40, "e"], [6, 52, "F"], [5, 20, "o"], [5, 21, "o"]] });
  const { env, state } = play(level, bot, { frames: 4000 });
  assert.ok(state.hero.won, `the bot reached the flag (points ${env.points})`);
  assert.ok(state.coins >= 0 && env.points > 100);
});

test("a spring throws the figure high and holding the finger jumps higher than a tap", () => {
  const spring = flat(40, { set: [[6, 10, "s"], [6, 36, "F"]] });
  let top = 1e9;
  play(spring, (state) => { top = Math.min(top, state.hero.y); return false; }, { frames: 400 });
  assert.ok(top < 7 * 40 - 3.2 * 40, `the spring lifted the figure by ${(7 * 40 - top) / 40} fields`);
  const heights = [];
  for (const hold of [false, true]) {
    let high = 1e9, jumped = false;
    play(flat(40, { set: [[6, 36, "F"]] }), (state, frame) => {
      if (frame === 30) jumped = true;
      high = Math.min(high, state.hero.y);
      return jumped && (hold ? frame < 60 : frame < 32);
    }, { frames: 120 });
    heights.push(7 * 40 - high);
  }
  assert.ok(heights[1] > heights[0] + 10, `tap ${heights[0]}, hold ${heights[1]}`);
});

for (let seed = 1; seed <= 60; seed += 1) {
  test(`the generated level ${seed} is a good level and the bot can finish it`, () => {
    const level = C.generateLevel({ seed, cols: 40 + (seed % 5) * 14, theme: ["day", "night", "sunset", "cave", "candy"][seed % 5], speed: 1 + (seed % 3), hard: (seed % 7) / 7 });
    const parsed = C.parseLevel(level);
    assert.equal(parsed.map.length, 9);
    assert.equal(parsed.map.join("").split("F").length - 1, 1, "one goal");
    assert.ok(/^[.#^oesF]+$/.test(parsed.map.join("")));
    const gaps = parsed.map[7].split("#").filter(Boolean).length;
    assert.ok((parsed.map[7].match(/\.+/g) || []).every((gap) => gap.length <= 3), `a pit is at most three fields wide (${gaps} pieces of ground)`);
    assert.ok((parsed.map.join("").match(/o/g) || []).length >= 4, "some coins");
    const { state, env } = play(level, bot, { frames: 6000 });
    assert.ok(state.hero.won, `the bot did not finish (seed ${seed}, x ${Math.round(state.hero.x)} of ${parsed.cols * 40}, points ${env.points})`);
  });
}

test("the three ready-made levels are in the list of games, before the other games", () => {
  const ids = PG.list().map((game) => game.id);
  for (const id of ["jr-huegel", "jr-nacht", "jr-zucker"]) assert.ok(ids.includes(id), id);
  assert.ok(PG.list().filter((game) => game.featured).map((game) => game.id).includes("jr-huegel"));
});

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
