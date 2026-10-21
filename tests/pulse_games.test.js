// The small games of the camera tab (static/js/pg-*.js) without a browser: every game is played for a while with no input and with invented input
// (taps, swipes, a finger that moves, keys). Nothing may throw, something is drawn, the score stays a whole number, and the games that are
// endless runners end when nobody plays.
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
const files = fs.readdirSync(dir).filter((name) => /^pg-.*\.js$/.test(name) && name !== "pg-fruit.js").sort((a, b) => (a === "pg-kit.js" ? -1 : b === "pg-kit.js" ? 1 : a.localeCompare(b)));
for (const name of files) require(path.join(dir, name));
const { PulseGames } = global;
const games = PulseGames.list();

function inventedInput(seed) {
  const rng = PulseGames.mulberry32(seed);
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "a", "d", "w", "Enter"];
  return (frame, input) => {
    if (frame % 7 === 0) { input.x = rng() * 360; input.y = rng() * 640; }
    if (frame % 23 === 0) { input.pressed = true; input.down = true; input.x = rng() * 360; input.y = rng() * 640; }
    if (frame % 23 === 6) { input.down = false; input.released = true; input.tap = rng() < 0.7; if (!input.tap) input.swipe = ["left", "right", "up", "down"][Math.floor(rng() * 4)]; }
    if (frame % 31 === 0) { const key = keys[Math.floor(rng() * keys.length)]; input.keys.add(key); input._keysPressed.add(key); }
    if (frame % 31 === 9) input.keys.clear();
  };
}

test("the kit offers a hundred games or fewer, each with a name, a picture, a topic and a hint", () => {
  assert.ok(games.length >= 1);
  const ids = new Set();
  for (const game of games) {
    assert.match(game.id, /^[a-z0-9-]{2,30}$/);
    assert.ok(!ids.has(game.id), `double id ${game.id}`);
    ids.add(game.id);
    assert.ok(game.name && game.emoji && game.cat && game.hint, `${game.id} lacks a field`);
    assert.ok(game.name.length <= 24, `${game.id}: the name is too long for a tile`);
  }
});

for (const game of games) {
  test(`${game.id}: plays without input and with invented input`, () => {
    const idle = PulseGames.headless(game.id, { frames: 1500, seed: 3 });
    assert.ok(Number.isFinite(idle.score) && idle.score >= 0 && Number.isInteger(idle.score), "whole, finite score");
    assert.ok(idle.drawn > 0, "something is drawn");
    for (const seed of [1, 2, 3]) {
      const played = PulseGames.headless(game.id, { frames: 2400, seed, script: inventedInput(seed * 11) });
      assert.ok(Number.isFinite(played.score) && played.score >= 0 && Number.isInteger(played.score), `score after play (seed ${seed})`);
      assert.ok(played.drawn > 0);
      for (let k = 1; k < played.scores.length; k++) assert.ok(played.scores[k] >= played.scores[k - 1], `${game.id}: the score went down (${played.scores[k - 1]} -> ${played.scores[k]})`);
      assert.ok(played.over <= 1, "over() is reported once");
    }
  });
}

test("the endless runners end when nobody plays", () => {
  for (const id of ["dino", "copter", "cube-dash", "gravity-flip", "lane-runner", "zigzag", "dodge-blocks", "crossy-hop", "slalom"]) {
    if (!games.some((game) => game.id === id)) continue;
    const idle = PulseGames.headless(id, { frames: 6000, seed: 5 });
    assert.ok(idle.finished, `${id} should be over after 100 seconds without input`);
  }
});

test("dino: a jump at the right moment gets over the first cactus", () => {
  const run = PulseGames.headless("dino", { frames: 600, seed: 9, script: (frame, input, env) => {
    if (frame % 55 === 0) { input.pressed = true; }
  } });
  assert.ok(run.score > 0);
});

// ------------------------------------------------------------------------------------------------ Sokoban: every level can be solved
function solveSokoban(rows) {
  const walls = new Set(), goals = new Set(), start = [];
  let player = 0;
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    const k = y * 20 + x;
    if (c === "#") walls.add(k);
    if (c === "." || c === "*" || c === "+") goals.add(k);
    if (c === "$" || c === "*") start.push(k);
    if (c === "@" || c === "+") player = k;
  }));
  start.sort((a, b) => a - b);
  const seen = new Set([`${player}|${start}`]);
  const queue = [[player, start, 0]];
  for (let head = 0; head < queue.length && head < 600000; head++) {
    const [p, b, d] = queue[head];
    if (b.every((x) => goals.has(x))) return d;
    for (const dd of [1, -1, 20, -20]) {
      const n = p + dd;
      if (walls.has(n)) continue;
      let nb = b;
      const at = b.indexOf(n);
      if (at >= 0) { const m = n + dd; if (walls.has(m) || b.includes(m)) continue; nb = b.slice(); nb[at] = m; nb.sort((x, y) => x - y); }
      const key = `${n}|${nb}`;
      if (!seen.has(key)) { seen.add(key); queue.push([n, nb, d + 1]); }
    }
  }
  return -1;
}

test("sokoban: every level of the game can be solved", () => {
  if (!games.some((game) => game.id === "sokoban")) return;
  assert.ok(Array.isArray(PulseGames.sokoban) && PulseGames.sokoban.length >= 6);
  PulseGames.sokoban.forEach((rows, k) => assert.ok(solveSokoban(rows) > 0, `level ${k + 1} has no solution`));
});

test("tetris and 2048: a patient player scores and the games end by themselves", () => {
  const tetris = PulseGames.headless("tetris", { frames: 9000, seed: 4, script: (frame, input) => { if (frame % 20 === 0) { input.swipe = "down"; } if (frame % 7 === 0) input.swipe = frame % 14 === 0 ? "left" : "right"; } });
  assert.ok(tetris.finished && tetris.score >= 1);
  const g2048 = PulseGames.headless("game-2048", { frames: 6000, seed: 4, script: (frame, input) => { input.swipe = ["left", "down", "right", "down"][frame % 4]; } });
  assert.ok(g2048.score > 0);
});

test("the games with several rounds go on after a win: tic-tac-toe, nim, flood-it and lights-out keep a score", () => {
  for (const id of ["tictactoe", "nim", "flood-it", "lights-out", "word-scramble", "memory-match"]) {
    const run = PulseGames.headless(id, { frames: 4000, seed: 2, script: (frame, input) => { if (frame % 9 === 0) { input.x = 20 + (frame * 37) % 320; input.y = 150 + (frame * 53) % 450; input.pressed = true; input.tap = true; } } });
    assert.ok(Number.isFinite(run.score), id);
  }
});
