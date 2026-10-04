// Tests for the daily chest and for the rules that decide which progress wins when a device and an account differ.
// Run with: node --test tests/gomat_core3.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../static/js/gomat-core.js");

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const onboarded = (changes = {}) => ({ ...core.defaultState(at(2026, 10, 5)), onboarded: true, ...changes });
const withLessons = (n, extra = {}) => {
  const state = onboarded(extra);
  for (let i = 1; i <= n; i++) state.lessons[`1-${i}`] = { done: true, best: 100, times: 1 };
  return state;
};

// ----------------------------------------------------------------------------------------- the chest
test("the daily chest opens once a day and holds between 5 and 20 gems", () => {
  const s = onboarded();
  const now = at(2026, 10, 5, 9);
  assert.equal(core.chestReady(s, now), true);
  const gems = core.claimChest(s, now, 0.5);
  assert.ok(gems >= core.CHEST_MIN && gems <= core.CHEST_MAX, String(gems));
  assert.equal(s.gems, gems);
  assert.equal(s.gemsEarned, gems);
  assert.equal(core.chestReady(s, at(2026, 10, 5, 23, 59)), false);
  assert.equal(core.claimChest(s, at(2026, 10, 5, 23), 0.9), 0);
  assert.equal(s.gems, gems);
  assert.equal(core.chestReady(s, at(2026, 10, 6, 0, 1)), true);
});

test("the chest's gems cover the whole range and never leave it", () => {
  const seen = new Set();
  for (let i = 0; i <= 1000; i++) {
    const s = onboarded();
    seen.add(core.claimChest(s, at(2026, 10, 5), i / 1000));
  }
  for (const odd of [-5, 1, 1.5, NaN, undefined, Infinity]) seen.add(core.claimChest(onboarded(), at(2026, 10, 5), odd));
  assert.equal(Math.min(...seen), core.CHEST_MIN);
  assert.equal(Math.max(...seen), core.CHEST_MAX);
  assert.equal(seen.size, core.CHEST_MAX - core.CHEST_MIN + 1);
});

test("there is no chest before the onboarding is done, and the day is saved and cleaned", () => {
  const s = core.defaultState(at(2026, 10, 5));
  assert.equal(core.chestReady(s, at(2026, 10, 5)), false);
  assert.equal(core.claimChest(s, at(2026, 10, 5), 0.5), 0);
  const done = onboarded({ chestDay: "2026-10-05" });
  assert.equal(core.sanitize(JSON.parse(JSON.stringify(done)), at(2026, 10, 5)).chestDay, "2026-10-05");
  assert.equal(core.sanitize({ ...JSON.parse(JSON.stringify(done)), chestDay: "gestern" }, at(2026, 10, 5)).chestDay, null);
  assert.equal(core.sanitize({ ...JSON.parse(JSON.stringify(done)), chestDay: 5 }, at(2026, 10, 5)).chestDay, null);
});

// ---------------------------------------------------------------------------------- progress score
test("the progress score only goes up", () => {
  const s = withLessons(0);
  const scores = [core.progressScore(s)];
  core.addXp(s, 10, at(2026, 10, 5));
  scores.push(core.progressScore(s));
  core.addGems(s, 10);
  scores.push(core.progressScore(s));
  s.lessons["1-1"] = { done: true, best: 90, times: 1 };
  scores.push(core.progressScore(s));
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b));
  assert.ok(new Set(scores).size === scores.length);
  core.buyFreeze(Object.assign(s, { gems: 500 }));
  assert.equal(core.progressScore(s) >= scores[scores.length - 1], true);       // spending gems does not lower it
});

test("having progress means XP or a finished lesson, not only the welcome gems", () => {
  assert.equal(core.hasProgress(onboarded({ gems: 20, gemsEarned: 20 })), false);
  assert.equal(core.hasProgress(onboarded({ xp: 5 })), true);
  assert.equal(core.hasProgress(withLessons(1)), true);
});

// ------------------------------------------------------------------------------------------ reconcile
const account = { email: "mia@example.com" };

test("no saved progress in the account: the device's progress is kept (and saved)", () => {
  assert.equal(core.reconcile({ local: withLessons(2), remote: null, remoteRev: 0, meta: null, email: account.email }), "local");
  assert.equal(core.reconcile({ local: withLessons(2), remote: { v: 1, onboarded: false }, remoteRev: 1, meta: null, email: account.email }), "local");
});

test("a new device takes the account's progress", () => {
  const fresh = core.defaultState(at(2026, 10, 5));
  assert.equal(core.reconcile({ local: fresh, remote: withLessons(4), remoteRev: 3, meta: null, email: account.email }), "remote");
  assert.equal(core.reconcile({ local: fresh, remote: null, remoteRev: 0, meta: null, email: account.email }), "remote");
});

test("a device that was up to date takes whatever the account has now", () => {
  const meta = { email: account.email, rev: 3, dirty: false };
  assert.equal(core.reconcile({ local: withLessons(2), remote: withLessons(5), remoteRev: 4, meta, email: account.email }), "remote");
  assert.equal(core.reconcile({ local: withLessons(5), remote: withLessons(5), remoteRev: 3, meta, email: account.email }), "remote");
});

test("only this device changed: it keeps its progress; both changed: the learner chooses", () => {
  const dirty = { email: account.email, rev: 3, dirty: true };
  assert.equal(core.reconcile({ local: withLessons(5), remote: withLessons(2), remoteRev: 3, meta: dirty, email: account.email }), "local");
  assert.equal(core.reconcile({ local: withLessons(5), remote: withLessons(2), remoteRev: 4, meta: dirty, email: account.email }), "ask");
});

test("signing in with another account's leftovers on the device: the bigger progress is not thrown away silently", () => {
  const other = { email: "other@example.com", rev: 7, dirty: false };
  assert.equal(core.reconcile({ local: withLessons(3), remote: withLessons(6), remoteRev: 2, meta: other, email: account.email }), "ask");
  assert.equal(core.reconcile({ local: withLessons(0), remote: withLessons(6), remoteRev: 2, meta: other, email: account.email }), "remote");
  assert.equal(core.reconcile({ local: withLessons(3), remote: withLessons(0), remoteRev: 2, meta: null, email: account.email }), "local");
  assert.equal(core.reconcile({ local: withLessons(3), remote: withLessons(3), remoteRev: 2, meta: null, email: account.email }), "remote");
});
