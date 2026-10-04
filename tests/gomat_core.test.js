// Tests for static/js/gomat-core.js. Run with: node --test tests/gomat_core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../static/js/gomat-core.js");

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const UNITS = [
  { id: 1, lessons: [{ id: "1-1" }, { id: "1-2" }, { id: "1-3", test: true }] },
  { id: 2, lessons: [{ id: "2-1" }, { id: "2-2" }, { id: "2-3", test: true }] },
  { id: 3, lessons: [{ id: "3-1" }, { id: "3-2" }] },
];
const fresh = (now = at(2026, 10, 5)) => core.defaultState(now);

test("days: keys, differences across month and year ends", () => {
  assert.equal(core.dayKey(at(2026, 1, 5)), "2026-01-05");
  assert.equal(core.daysBetween("2026-01-31", "2026-02-01"), 1);
  assert.equal(core.daysBetween("2025-12-31", "2026-01-01"), 1);
  assert.equal(core.daysBetween("2026-03-01", "2026-03-01"), 0);
  assert.equal(core.daysBetween("2024-02-28", "2024-03-01"), 2);           // a leap year
  assert.equal(core.daysBetween("2026-03-28", "2026-03-30"), 2);           // across the clock change
});

test("a new learner starts with full hearts, no streak and nothing done", () => {
  const s = fresh();
  assert.deepEqual([s.hearts, s.streak, s.xp, s.goal, s.startUnit, s.onboarded], [5, 0, 0, 20, 1, false]);
  assert.equal(core.currentLessonId(UNITS, s), "1-1");
});

test("lessons open one after the other", () => {
  const s = fresh();
  assert.deepEqual(["1-1", "1-2", "3-2"].map((id) => core.lessonStatus(UNITS, s, id)), ["current", "locked", "locked"]);
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5));
  assert.deepEqual(["1-1", "1-2", "1-3"].map((id) => core.lessonStatus(UNITS, s, id)), ["done", "current", "locked"]);
  assert.equal(core.currentLessonId(UNITS, s), "1-2");
});

test("starting at a later unit counts the earlier units as done", () => {
  const s = fresh();
  s.startUnit = 2;
  assert.equal(core.lessonStatus(UNITS, s, "1-3"), "done");
  assert.equal(core.currentLessonId(UNITS, s), "2-1");
  assert.deepEqual(core.unitProgress(UNITS, s, 1), { done: 3, total: 3 });
  s.startUnit = 4;                                            // beyond the course: everything is done
  assert.equal(core.allDone(UNITS, s), true);
});

test("XP: 10 for a lesson, 15 when perfect; the daily goal is reached exactly once", () => {
  const s = fresh();
  s.goal = 20;
  const first = core.completeLesson(s, "1-1", { correct: 10, mistakes: 2 }, at(2026, 10, 5, 9));
  assert.deepEqual([first.xp, first.perfect, first.goalReached, s.xp, s.xpToday], [10, false, false, 10, 10]);
  const second = core.completeLesson(s, "1-2", { correct: 10, mistakes: 0 }, at(2026, 10, 5, 10));
  assert.deepEqual([second.xp, second.perfect, second.goalReached, s.xpToday], [15, true, true, 25]);
  const third = core.completeLesson(s, "1-3", { correct: 12, mistakes: 0 }, at(2026, 10, 5, 11));
  assert.equal(third.goalReached, false);
});

test("today's XP starts again every day, the total stays", () => {
  const s = fresh();
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5));
  core.rollover(s, at(2026, 10, 6, 8));
  assert.deepEqual([s.xp, s.xpToday], [15, 0]);
});

test("streak: grows day by day, stays on the same day, resets after a missed day", () => {
  const s = fresh();
  const done = (day, hour = 12) => core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, day, hour));
  assert.equal(done(5).streakExtended, true);
  assert.equal(s.streak, 1);
  assert.equal(done(5, 20).streakExtended, false);
  assert.equal(s.streak, 1);
  done(6);
  done(7);
  assert.deepEqual([s.streak, s.bestStreak], [3, 3]);
  core.rollover(s, at(2026, 10, 8, 9));                       // the next morning the streak is still alive
  assert.equal(s.streak, 3);
  core.rollover(s, at(2026, 10, 9, 9));                       // a whole day without learning: gone
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 3);
  done(9);
  assert.equal(s.streak, 1);
});

test("streak across a month end and a year end", () => {
  const s = fresh(at(2026, 12, 30));
  for (const day of [at(2026, 12, 30), at(2026, 12, 31), at(2027, 1, 1)]) core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, day);
  assert.equal(s.streak, 3);
});

test("streakActiveToday", () => {
  const s = fresh();
  assert.equal(core.streakActiveToday(s, at(2026, 10, 5)), false);
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5));
  assert.equal(core.streakActiveToday(s, at(2026, 10, 5, 23, 59)), true);
  assert.equal(core.streakActiveToday(s, at(2026, 10, 6)), false);
});

test("hearts: losing starts the timer, one comes back every 20 minutes, never more than 5", () => {
  const s = fresh();
  const t0 = at(2026, 10, 5, 12, 0);
  assert.equal(core.loseHeart(s, t0), 4);
  assert.equal(core.loseHeart(s, at(2026, 10, 5, 12, 1)), 3);
  assert.equal(core.heartsEta(s, at(2026, 10, 5, 12, 10)), 10 * 60 * 1000);
  core.regenHearts(s, at(2026, 10, 5, 12, 19));
  assert.equal(s.hearts, 3);
  core.regenHearts(s, at(2026, 10, 5, 12, 20));
  assert.equal(s.hearts, 4);
  core.regenHearts(s, at(2026, 10, 5, 13, 0));                // 40 more minutes: two more, capped at 5
  assert.equal(s.hearts, 5);
  assert.equal(core.heartsEta(s, at(2026, 10, 5, 13, 0)), null);
});

test("hearts: the timer keeps its rhythm when checked in between", () => {
  const s = fresh();
  core.loseHeart(s, at(2026, 10, 5, 12, 0));
  core.loseHeart(s, at(2026, 10, 5, 12, 0));
  core.loseHeart(s, at(2026, 10, 5, 12, 0));
  assert.equal(s.hearts, 2);
  core.regenHearts(s, at(2026, 10, 5, 12, 25));               // +1 at :20, next at :40
  assert.equal(s.hearts, 3);
  assert.equal(core.heartsEta(s, at(2026, 10, 5, 12, 25)), 15 * 60 * 1000);
});

test("hearts can run out, and a clock that went backwards doesn't hand out hearts", () => {
  const s = fresh();
  for (let i = 0; i < 7; i++) core.loseHeart(s, at(2026, 10, 5, 12, 0));
  assert.equal(s.hearts, 0);
  core.regenHearts(s, at(2026, 10, 5, 11, 0));
  assert.equal(s.hearts, 0);
  assert.equal(core.heartsEta(s, at(2026, 10, 5, 11, 0)), 20 * 60 * 1000);
});

test("addHeart gives one back, up to 5", () => {
  const s = fresh();
  core.loseHeart(s, at(2026, 10, 5));
  core.loseHeart(s, at(2026, 10, 5));
  assert.equal(core.addHeart(s, at(2026, 10, 5)), 4);
  assert.equal(core.addHeart(s, at(2026, 10, 5)), 5);
  assert.equal(core.addHeart(s, at(2026, 10, 5)), 5);
});

test("waiting times read well", () => {
  assert.equal(core.formatWait(30 * 1000), "1 Min.");
  assert.equal(core.formatWait(12 * 60000), "12 Min.");
  assert.equal(core.formatWait(65 * 60000), "1 Std. 5 Min.");
});

test("practice: 5 XP, counts for the streak, wins a heart at 80 % or better", () => {
  const s = fresh();
  core.loseHeart(s, at(2026, 10, 5));
  const good = core.completePractice(s, { correct: 9, mistakes: 1 }, at(2026, 10, 5));
  assert.deepEqual([good.xp, good.heartWon, s.hearts, s.streak, s.stats.practice], [5, true, 5, 1, 1]);
  core.loseHeart(s, at(2026, 10, 5));
  const bad = core.completePractice(s, { correct: 5, mistakes: 5 }, at(2026, 10, 5));
  assert.deepEqual([bad.heartWon, s.hearts], [false, 4]);
  assert.equal(core.completePractice(s, { correct: 10, mistakes: 0 }, at(2026, 10, 5)).heartWon, true);
  assert.equal(core.completePractice(s, { correct: 10, mistakes: 0 }, at(2026, 10, 5)).heartWon, false);   // already full
});

test("repeating a lesson keeps it done and keeps the best accuracy", () => {
  const s = fresh();
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 5 }, at(2026, 10, 5));
  const again = core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5));
  assert.equal(again.firstTime, false);
  assert.deepEqual(s.lessons["1-1"], { done: true, best: 100, times: 2 });
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 9 }, at(2026, 10, 5));
  assert.equal(s.lessons["1-1"].best, 100);
});

test("history keeps the last 14 days and lastDays lists a week", () => {
  const s = fresh();
  for (let d = 1; d <= 20; d++) core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 9, d));
  assert.equal(Object.keys(s.history).length, 14);
  const week = core.lastDays(s, at(2026, 9, 20), 7);
  assert.equal(week.length, 7);
  assert.equal(week[6].key, "2026-09-20");
  assert.deepEqual(week.map((d) => d.xp), [15, 15, 15, 15, 15, 15, 15]);
  assert.equal(core.lastDays(s, at(2026, 10, 30), 3).every((d) => d.xp === 0), true);
});

test("storage round trip and the fallback when storage is missing", () => {
  const storage = core.memoryStorage();
  const s = core.load(storage, at(2026, 10, 5));
  s.goal = 30;
  s.onboarded = true;
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5));
  assert.equal(core.save(storage, s), true);
  const back = core.load(storage, at(2026, 10, 5, 13));
  assert.deepEqual([back.goal, back.onboarded, back.xp, back.lessons["1-1"].done], [30, true, 15, true]);
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
  assert.equal(core.load(broken, at(2026, 10, 5)).hearts, 5);
  assert.equal(core.save(broken, s), false);
});

test("load applies the new day and regenerates hearts", () => {
  const storage = core.memoryStorage();
  const s = core.load(storage, at(2026, 10, 5, 12));
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5, 12));
  core.loseHeart(s, at(2026, 10, 5, 12));
  core.save(storage, s);
  const later = core.load(storage, at(2026, 10, 5, 13));
  assert.equal(later.hearts, 5);
  const nextWeek = core.load(storage, at(2026, 10, 12));
  assert.deepEqual([nextWeek.streak, nextWeek.xpToday, nextWeek.xp], [0, 0, 15]);
});

test("damaged or hand-edited storage is cleaned, never trusted", () => {
  const now = at(2026, 10, 5);
  for (const bad of [null, "text", 5, [], { v: 2 }, { v: 1, hearts: "many", xp: -5, goal: 999, lessons: "x" }]) {
    const s = core.sanitize(bad, now);
    assert.equal(s.hearts >= 0 && s.hearts <= 5, true);
    assert.equal(s.xp >= 0, true);
    assert.equal(core.GOALS.includes(s.goal), true);
    assert.equal(typeof s.lessons, "object");
  }
  const s = core.sanitize({
    v: 1, hearts: 500, xp: 1e30, xpToday: NaN, streak: -3, bestStreak: 2, goal: 30, startUnit: 99,
    lastDay: "yesterday", xpDay: "x", heartsAt: "later",
    lessons: { "1-1": { done: true, best: 5000, times: -1 }, "evil": { done: true }, "10-1": { done: true }, "2-2": null, "__proto__": { done: true } },
    history: { "2026-10-01": 50, "nope": 5 }, stats: { lessons: 3, perfect: "x" },
  }, now);
  assert.deepEqual([s.hearts, s.streak, s.goal, s.startUnit, s.lastDay], [5, 0, 30, 9, null]);
  assert.equal(s.xp <= 10000000 && s.xp >= 0, true);
  assert.deepEqual(Object.keys(s.lessons), ["1-1"]);
  assert.deepEqual(s.lessons["1-1"], { done: true, best: 100, times: 0 });
  assert.deepEqual(s.history, { "2026-10-01": 50 });
  assert.deepEqual([s.stats.lessons, s.stats.perfect], [3, 0]);
  assert.equal(Number.isFinite(s.heartsAt), true);
});

test("achievements unlock and show progress", () => {
  const s = fresh();
  let list = core.achievements(UNITS, s);
  assert.equal(list.every((a) => !a.unlocked), true);
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5));
  list = Object.fromEntries(core.achievements(UNITS, s).map((a) => [a.id, a]));
  assert.equal(list.first.unlocked, true);
  assert.equal(list.perfect.unlocked, true);
  assert.deepEqual([list.ten.unlocked, list.ten.progress, list.ten.target], [false, 1, 10]);
  assert.equal(list.xp100.progress, 15);
  assert.equal(list.all.target, 8);
});

test("unit achievements and the champion need the whole unit / course", () => {
  const s = fresh();
  s.startUnit = 4;
  const list = Object.fromEntries(core.achievements(UNITS, s).map((a) => [a.id, a]));
  assert.equal(list.all.unlocked, true);
  assert.equal(list.times.unlocked, true);
});

test("typed answers: comma or dot, minus sign variants, spaces; everything else is wrong", () => {
  assert.equal(core.answersMatch("12", " 12 "), true);
  assert.equal(core.answersMatch("3,5", "3.5"), true);
  assert.equal(core.answersMatch("3,5", "3,50"), true);
  assert.equal(core.answersMatch("−3", "-3"), true);
  assert.equal(core.answersMatch("-3", "−3"), true);
  assert.equal(core.answersMatch("12", "13"), false);
  assert.equal(core.answersMatch("12", ""), false);
  assert.equal(core.answersMatch("12", "12abc"), false);
  assert.equal(core.answersMatch("1000", "1e3"), false);
  assert.equal(core.answersMatch("12", "1 2"), true);                       // spaces are ignored, as in "1 200"
  assert.equal(core.answersMatch("12", "--12"), false);
  assert.equal(core.answersMatch("12", null), false);
  assert.equal(core.answersMatch("0,5", ".5"), false);
  assert.equal(Number.isNaN(core.parseNumber("1.2.3")), true);
});

test("tiles: the order has to match exactly", () => {
  assert.equal(core.sameOrder(["1", "2", "3"], ["1", "2", "3"]), true);
  assert.equal(core.sameOrder(["1", "2", "3"], ["1", "3", "2"]), false);
  assert.equal(core.sameOrder(["1", "2"], ["1"]), false);
  assert.equal(core.sameOrder(["1"], null), false);
});

test("accuracy rounds and survives zero answers", () => {
  assert.equal(core.accuracyOf(10, 0), 100);
  assert.equal(core.accuracyOf(10, 5), 67);
  assert.equal(core.accuracyOf(0, 0), 0);
});
