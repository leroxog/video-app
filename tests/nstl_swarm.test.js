const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../static/js/nstl-swarm-core.js");

// Five made-up candidates with clearly different properties, so that one of them is the obvious best answer for the test's tastes.
const FEATURES = [
  [0.1, 0.1, 0.1, 0.1, 0.1],
  [0.2, 0.2, 0.2, 0.2, 0.2],
  [0.95, 0.9, 0.85, 0.9, 0.8],     // candidate 2: clearly the best on every property
  [0.3, 0.3, 0.3, 0.3, 0.3],
  [0.4, 0.4, 0.4, 0.4, 0.4],
];

test("words are one or two made-up syllables, and every id has exactly one text", () => {
  assert.equal(S.SINGLE, 12);
  assert.equal(S.WORDS, 12 + 12 * 12);
  assert.equal(S.wordLength(0), 1);
  assert.equal(S.wordLength(11), 1);
  assert.equal(S.wordLength(12), 2);
  assert.equal(S.wordLength(S.WORDS - 1), 2);
  const texts = new Set();
  for (let id = 0; id < S.WORDS; id++) texts.add(S.wordText(id));
  assert.equal(texts.size, S.WORDS, "every word id has its own text");
});

test("a seeded run is exactly repeatable", () => {
  const a = S.create({ width: 40, height: 30, features: FEATURES, types: 32, radius: 6, seed: 42 });
  const b = S.create({ width: 40, height: 30, features: FEATURES, types: 32, radius: 6, seed: 42 });
  for (let i = 0; i < 10; i++) { S.step(a); S.step(b); }
  assert.deepEqual(Array.from(a.opinion), Array.from(b.opinion));
  assert.deepEqual(Array.from(a.words), Array.from(b.words));
});

test("taste scores favour the candidate whose properties are best for most kinds of agents", () => {
  const sw = S.create({ width: 50, height: 50, features: FEATURES, types: 64, radius: 8, seed: 3 });
  const counts = new Array(5).fill(0);
  for (let i = 0; i < sw.n; i++) counts[sw.opinion[i]]++;
  assert.equal(counts.indexOf(Math.max(...counts)), 2, "most agents start out favouring the clearly best candidate");
});

test("a small swarm reaches a shared opinion and a shared short word for it", () => {
  const sw = S.create({ width: 90, height: 60, features: FEATURES, types: 128, radius: 10, longDistance: 48, seed: 7 });
  let m = S.measure(sw);
  let agreedAt = -1;
  for (let round = 0; round < 400 && agreedAt < 0; round++) {
    S.step(sw);
    m = S.measure(sw);
    if (S.agreed(m)) agreedAt = round + 1;
  }
  assert.ok(agreedAt > 0, "the swarm settles within a generous number of rounds");
  assert.equal(m.top, 2, "and it settles on the candidate that is actually the best one");
  assert.ok(m.length <= 1.3, `the shared word shrank towards one syllable (length ${m.length})`);
  assert.ok(m.dialects <= 8, `almost everyone uses the same word for the winner (${m.dialects} left)`);
});

test("step() samples real talks, each between two different neighbours, never invented", () => {
  const sw = S.create({ width: 60, height: 40, features: FEATURES, types: 32, radius: 6, seed: 11 });
  const { events } = S.step(sw, { keep: 40 });
  assert.ok(events.length > 0);
  for (const e of events) {
    assert.notEqual(e.from, e.to);
    assert.ok(e.concept >= 0 && e.concept < FEATURES.length);
    assert.ok(Number.isInteger(e.word) && Number.isInteger(e.heard));
    assert.equal(e.ok, e.word === e.heard);
  }
});

test("measure() counts are consistent with each other", () => {
  const sw = S.create({ width: 70, height: 50, features: FEATURES, types: 64, radius: 8, seed: 5 });
  for (let i = 0; i < 20; i++) S.step(sw);
  const m = S.measure(sw);
  const total = m.shares.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, "the shares of every candidate add up to the whole swarm");
  assert.ok(m.understanding >= 0 && m.understanding <= 1);
  assert.ok(m.dialects >= 1);
  assert.equal(m.lexicon.length, FEATURES.length);
});

test("paint() fills every pixel of the requested map without touching anything outside it", () => {
  const sw = S.create({ width: 30, height: 20, features: FEATURES, types: 16, radius: 4, seed: 2 });
  S.step(sw);
  const columns = 12, rows = 8;
  const image = { data: new Uint8ClampedArray(columns * rows * 4) };
  S.paint(sw, image, columns, rows, "opinion");
  for (let i = 0; i < columns * rows; i++) assert.equal(image.data[i * 4 + 3], 255, "every pixel got an alpha of 255, so none was left blank");
  S.paint(sw, image, columns, rows, "word");    // the other mode must not throw either
});

test("create() refuses fewer than two or more than eight candidates", () => {
  assert.throws(() => S.create({ width: 10, height: 10, features: [[1]], seed: 1 }));
  assert.throws(() => S.create({ width: 10, height: 10, features: new Array(9).fill([1, 1]), seed: 1 }));
});
