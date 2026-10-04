// More tests for static/js/gomat-core.js: gems and the shop, streak protection, master tests, skipping a unit,
// the placement test, onboarding, speaking. Run with: node --test tests/gomat_core2.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../static/js/gomat-core.js");

const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const UNITS = [
  { id: 1, lessons: [{ id: "1-1" }, { id: "1-2" }, { id: "1-3", test: true }] },
  { id: 2, lessons: [{ id: "2-1" }, { id: "2-2" }, { id: "2-3", test: true }] },
  { id: 3, lessons: [{ id: "3-1" }, { id: "3-2", test: true }] },
];
const fresh = (now = at(2026, 10, 5)) => core.defaultState(now);
const done = (s, id, mistakes = 0, now = at(2026, 10, 5), test = false) => core.completeLesson(s, id, { correct: 10, mistakes, test }, now);

// ------------------------------------------------------------------ gems and the shop
test("gems: a lesson 10, perfect +5, a passed master test 30 (+5), the daily goal +15 once, practice 3", () => {
  const s = fresh();
  s.goal = 20;
  assert.equal(done(s, "1-1", 2).gems, 10);
  assert.equal(done(s, "1-2", 0).gems, 15 + 15);                         // perfect lesson, and this one reaches the goal (10 + 15 XP)
  assert.equal(s.gems, 40);
  assert.equal(done(s, "1-3", 0, at(2026, 10, 5), true).gems, 35);
  assert.equal(core.completePractice(s, { correct: 9, mistakes: 1 }, at(2026, 10, 5)).gems, 3);
  assert.equal(s.gemsEarned, s.gems);
});

test("hearts can be bought with gems: refuses when full or too poor, refills everything otherwise", () => {
  const s = fresh();
  assert.deepEqual(core.buyHearts(s, at(2026, 10, 5)), { ok: false, reason: "full" });
  core.loseHeart(s, at(2026, 10, 5));
  core.loseHeart(s, at(2026, 10, 5));
  s.gems = core.PRICES.hearts - 1;
  assert.deepEqual(core.buyHearts(s, at(2026, 10, 5)), { ok: false, reason: "poor" });
  s.gems = core.PRICES.hearts + 7;
  assert.deepEqual(core.buyHearts(s, at(2026, 10, 5)), { ok: true });
  assert.deepEqual([s.hearts, s.gems], [5, 7]);
});

test("streak protection can be bought twice at most", () => {
  const s = fresh();
  s.gems = 1000;
  assert.deepEqual(core.buyFreeze(s), { ok: true });
  assert.deepEqual(core.buyFreeze(s), { ok: true });
  assert.deepEqual(core.buyFreeze(s), { ok: false, reason: "full" });
  assert.deepEqual([s.freezes, s.gems], [2, 1000 - 2 * core.PRICES.freeze]);
  const poor = fresh();
  poor.gems = core.PRICES.freeze - 1;
  assert.deepEqual(core.buyFreeze(poor), { ok: false, reason: "poor" });
});

// ---------------------------------------------------------------- streak protection
test("a protection covers one missed day and keeps the streak", () => {
  const s = fresh();
  done(s, "1-1", 0, at(2026, 10, 5));
  done(s, "1-2", 0, at(2026, 10, 6));
  s.freezes = 1;
  assert.equal(core.rollover(s, at(2026, 10, 8)), 1);                    // the 7th was missed
  assert.deepEqual([s.streak, s.freezes, s.lastDay], [2, 0, "2026-10-07"]);
  assert.equal(core.rollover(s, at(2026, 10, 8)), 0);                    // checking again changes nothing
  assert.equal(s.streak, 2);
  done(s, "1-3", 0, at(2026, 10, 8));
  assert.equal(s.streak, 3);
});

test("two missed days need two protections, otherwise the streak ends and nothing is used up", () => {
  const s = fresh();
  done(s, "1-1", 0, at(2026, 10, 5));
  s.freezes = 1;
  assert.equal(core.rollover(s, at(2026, 10, 8)), 0);
  assert.deepEqual([s.streak, s.freezes], [0, 1]);
  const t = fresh();
  done(t, "1-1", 0, at(2026, 10, 5));
  t.freezes = 2;
  assert.equal(core.rollover(t, at(2026, 10, 8)), 2);
  assert.deepEqual([t.streak, t.freezes], [1, 0]);
});

test("no protection is wasted when there is no streak, and loading reports what was used", () => {
  const s = fresh();
  s.freezes = 2;
  s.lastDay = "2026-10-01";
  core.rollover(s, at(2026, 10, 9));
  assert.deepEqual([s.streak, s.freezes], [0, 2]);
  const storage = core.memoryStorage();
  const t = core.load(storage, at(2026, 10, 5));
  done(t, "1-1", 0, at(2026, 10, 5));
  t.freezes = 1;
  core.save(storage, t);
  const back = core.load(storage, at(2026, 10, 7));
  assert.equal(back.freezeUsed, 1);
  assert.equal(JSON.parse(storage.getItem(core.STORAGE_KEY)).freezeUsed, undefined);
  core.save(storage, back);
  assert.equal(JSON.parse(storage.getItem(core.STORAGE_KEY)).freezeUsed, undefined);
});

test("dayBefore works across month and year ends", () => {
  assert.equal(core.dayBefore("2026-03-01"), "2026-02-28");
  assert.equal(core.dayBefore("2024-03-01"), "2024-02-29");
  assert.equal(core.dayBefore("2026-01-01"), "2025-12-31");
  assert.equal(core.dayBefore("2026-10-05"), "2026-10-04");
});

// ------------------------------------------------------------------- master tests
test("a master test counts only with at most 3 mistakes", () => {
  const s = fresh();
  done(s, "1-1");
  done(s, "1-2");
  const failed = done(s, "1-3", core.TEST_MAX_MISTAKES + 1, at(2026, 10, 5), true);
  assert.deepEqual([failed.passed, failed.xp, failed.gems, failed.test], [false, 0, 0, true]);
  assert.equal(s.lessons["1-3"], undefined);
  assert.equal(core.lessonStatus(UNITS, s, "1-3"), "current");
  assert.equal(core.lessonStatus(UNITS, s, "2-1"), "locked");             // the next unit stays closed
  assert.deepEqual([s.stats.testsFailed, s.stats.testsPassed, s.stats.lessons], [1, 0, 2]);
  const passed = done(s, "1-3", core.TEST_MAX_MISTAKES, at(2026, 10, 5), true);
  assert.deepEqual([passed.passed, passed.xp, passed.test], [true, core.XP_TEST, true]);
  assert.equal(core.lessonStatus(UNITS, s, "2-1"), "current");            // now the next unit opens
  assert.equal(core.currentLessonId(UNITS, s), "2-1");
  assert.deepEqual([s.stats.testsPassed, s.stats.lessons], [1, 3]);
});

test("a perfect master test earns the bonus, a failed one still keeps today's streak", () => {
  const s = fresh();
  assert.equal(done(s, "1-3", 0, at(2026, 10, 5), true).xp, core.XP_TEST + core.XP_PERFECT_BONUS);
  const t = fresh();
  const failed = done(t, "1-3", 9, at(2026, 10, 5), true);
  assert.deepEqual([failed.streakExtended, t.streak], [true, 1]);
});

test("unit status and the skippable unit", () => {
  const s = fresh();
  assert.deepEqual([1, 2, 3].map((id) => core.unitStatus(UNITS, s, id)), ["current", "locked", "locked"]);
  assert.equal(core.skippableUnit(UNITS, s), 1);
  for (const id of ["1-1", "1-2"]) done(s, id);
  assert.equal(core.unitStatus(UNITS, s, 1), "current");
  done(s, "1-3", 0, at(2026, 10, 5), true);
  assert.deepEqual([1, 2, 3].map((id) => core.unitStatus(UNITS, s, id)), ["done", "current", "locked"]);
  assert.equal(core.skippableUnit(UNITS, s), 2);
  s.startUnit = 4;
  assert.equal(core.skippableUnit(UNITS, s), null);
});

test("skipping a unit with its test: passed marks every lesson of the unit done, failed changes nothing", () => {
  const s = fresh();
  const failed = core.completeSkip(s, UNITS, 1, { correct: 12, mistakes: 4 }, at(2026, 10, 5));
  assert.deepEqual([failed.passed, failed.xp, failed.gems], [false, 0, 0]);
  assert.equal(core.currentLessonId(UNITS, s), "1-1");
  const passed = core.completeSkip(s, UNITS, 1, { correct: 12, mistakes: 1 }, at(2026, 10, 5));
  assert.deepEqual([passed.passed, passed.xp, passed.gems, passed.skipped], [true, core.XP_SKIP, core.GEMS.skip, 1]);
  assert.equal(core.currentLessonId(UNITS, s), "2-1");
  assert.deepEqual(core.unitProgress(UNITS, s, 1), { done: 3, total: 3 });
  assert.equal(s.stats.testsPassed, 1);
  assert.equal(core.completeSkip(s, UNITS, 99, { correct: 12, mistakes: 0 }, at(2026, 10, 5)).passed, true);   // an unknown unit does no harm
});

test("stars: 1 to 3 by the best accuracy, 0 for lessons that are not done", () => {
  const s = fresh();
  assert.equal(core.starsFor(s, "1-1"), 0);
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 10 }, at(2026, 10, 5));
  assert.equal(core.starsFor(s, "1-1"), 1);
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 2 }, at(2026, 10, 5));
  assert.equal(core.starsFor(s, "1-1"), 2);
  core.completeLesson(s, "1-1", { correct: 10, mistakes: 0 }, at(2026, 10, 5));
  assert.equal(core.starsFor(s, "1-1"), 3);
  s.startUnit = 2;
  assert.equal(core.starsFor(s, "1-2"), 3);                              // skipped by the placement: full stars
});

// ----------------------------------------------------------- placement and onboarding
test("where to begin: school year and self-assessment", () => {
  assert.deepEqual([0, 1, 2, 3, 5, 9, 13, 99].map(core.unitForGrade), [1, 1, 2, 3, 5, 9, 9, 6]);
  assert.deepEqual([0, 1, 2, 3, 7].map(core.unitForSelf), [1, 2, 4, 6, 1]);
  assert.equal(core.recommendedStart(1, 0), 1);
  assert.equal(core.recommendedStart(5, 2), 5 - 0);                      // (5 + 4) / 2 = 4.5, rounded up
  assert.equal(core.recommendedStart(13, 3), 8);
  assert.equal(core.recommendedStart(99, 0), 4);
  assert.equal(core.recommendedStart(null, null), 1);
  for (const g of core.GRADE_IDS) for (const l of core.SELF_LEVELS) {
    const unit = core.recommendedStart(g, l);
    assert.ok(unit >= 1 && unit <= 9, `${g}/${l}`);
  }
});

test("the placement staircase goes up on right answers and down on wrong ones, within 1 to 9", () => {
  assert.equal(core.nextPlacementUnit(4, true), 5);
  assert.equal(core.nextPlacementUnit(4, false), 3);
  assert.equal(core.nextPlacementUnit(9, true), 9);
  assert.equal(core.nextPlacementUnit(1, false), 1);
});

test("placement outcome: the lowest unit that was not passed, otherwise the highest asked", () => {
  const up = core.placementOutcome([4, 5, 6, 7, 8, 9, 9].map((unit) => ({ unit, ok: true })));
  assert.deepEqual([up.unit, up.correct, up.total], [9, 7, 7]);
  const mixed = core.placementOutcome([{ unit: 4, ok: true }, { unit: 5, ok: true }, { unit: 6, ok: false }, { unit: 5, ok: true }, { unit: 6, ok: false }]);
  assert.deepEqual([mixed.unit, mixed.correct, mixed.total], [6, 3, 5]);
  assert.deepEqual(mixed.details.map((d) => [d.unit, d.ok, d.total, d.passed]), [[4, 1, 1, true], [5, 2, 2, true], [6, 0, 2, false]]);
  const slip = core.placementOutcome([{ unit: 3, ok: false }, { unit: 2, ok: true }, { unit: 3, ok: true }]);   // a tie passes
  assert.equal(slip.unit, 3);
  assert.equal(slip.details[1].passed, true);
  const low = core.placementOutcome([{ unit: 2, ok: false }, { unit: 1, ok: false }]);
  assert.equal(low.unit, 1);
  const empty = core.placementOutcome([]);
  assert.deepEqual([empty.unit, empty.correct, empty.total, empty.details], [1, 0, 0, []]);
});

test("finishing the onboarding stores the choices and gives the welcome gems once", () => {
  const s = fresh();
  const placement = core.placementOutcome([{ unit: 3, ok: true }, { unit: 4, ok: false }]);
  core.finishOnboarding(s, { grade: 5, selfLevel: 2, startUnit: 4, goal: 30, placement }, at(2026, 10, 5));
  assert.deepEqual([s.onboarded, s.grade, s.selfLevel, s.startUnit, s.goal, s.gems], [true, 5, 2, 4, 30, core.GEMS.welcome]);
  assert.equal(s.placement.unit, 4);
  assert.equal(core.currentLessonId(UNITS, s), null);                     // units 1-3 are behind the learner (this fixture only has three)
  core.finishOnboarding(s, { grade: 99, selfLevel: 0, startUnit: 1, goal: 10 }, at(2026, 10, 5));
  assert.deepEqual([s.gems, s.grade, s.placement], [core.GEMS.welcome, 99, null]);
  const odd = fresh();
  core.finishOnboarding(odd, { grade: 77, selfLevel: 9, startUnit: 99, goal: 7 }, at(2026, 10, 5));
  assert.deepEqual([odd.grade, odd.selfLevel, odd.startUnit, odd.goal], [null, null, 9, 20]);
});

test("new fields are cleaned when read back", () => {
  const now = at(2026, 10, 5);
  const s = core.sanitize({
    v: 1, grade: 77, selfLevel: 9, companion: "dragon", gems: -4, gemsEarned: 1, freezes: 99, noSpeakUntil: "soon",
    placement: { unit: 40, correct: -3, total: 1e9, details: [{ unit: 0, ok: "x", total: 3, passed: 1 }, null] },
    stats: { testsPassed: 3, testsFailed: "x" },
  }, now);
  assert.deepEqual([s.grade, s.selfLevel, s.companion, s.gems, s.freezes, s.noSpeakUntil], [null, null, "gomi", 0, 2, 0]);
  assert.deepEqual([s.placement.unit, s.placement.correct, s.placement.total], [9, 0, 50]);
  assert.deepEqual(s.placement.details.map((d) => [d.unit, d.ok, d.total, d.passed]), [[1, 0, 3, true], [1, 0, 0, false]]);
  assert.deepEqual([s.stats.testsPassed, s.stats.testsFailed], [3, 0]);
  const good = core.sanitize({ v: 1, grade: 5, selfLevel: 2, companion: "otto", gems: 40, gemsEarned: 90, freezes: 1, noSpeakUntil: 123, placement: null }, now);
  assert.deepEqual([good.grade, good.selfLevel, good.companion, good.gems, good.gemsEarned, good.freezes, good.noSpeakUntil], [5, 2, "otto", 40, 90, 1, 123]);
  assert.equal(core.sanitize({ v: 1, grade: 0 }, now).grade, 0);          // "not in school yet" is a real answer
});

// ------------------------------------------------------------------------- speaking
test("'I can't speak right now' switches speaking exercises off for an hour", () => {
  const s = fresh();
  assert.equal(core.canSpeakNow(s, at(2026, 10, 5, 12)), true);
  core.muteSpeaking(s, at(2026, 10, 5, 12));
  assert.equal(core.canSpeakNow(s, at(2026, 10, 5, 12, 59)), false);
  assert.equal(core.canSpeakNow(s, at(2026, 10, 5, 13, 0)), true);
});

test("spoken numbers: digits, German number words, minus and Komma", () => {
  const cases = [
    ["42", 42], ["zweiundvierzig", 42], ["Zweiundvierzig.", 42], ["null", 0], ["eins", 1], ["ein", 1], ["zwölf", 12], ["zwoelf", 12], ["sechzehn", 16],
    ["siebzehn", 17], ["dreißig", 30], ["dreissig", 30], ["einundzwanzig", 21], ["neunundneunzig", 99], ["hundert", 100], ["einhundert", 100],
    ["einhundertdreiundzwanzig", 123], ["hundert dreiundzwanzig", 123], ["zweihundert", 200], ["vierhundertzwei", 402], ["tausend", 1000],
    ["eintausendzweihundert", 1200], ["zweitausendfünfhundert", 2500], ["dreitausendvierhundertsiebenundfünfzig", 3457], ["zwei und vierzig", 42],
    ["minus drei", -3], ["Minus drei", -3], ["negativ fünf", -5], ["-7", -7], ["−7", -7], ["minus 12", -12],
    ["zwei Komma fünf", 2.5], ["drei komma eins vier", 3.14], ["null Komma fünf", 0.5], ["komma fünf", 0.5], ["3,5", 3.5], ["3.5", 3.5], ["1.000", 1000],
    ["1.250,5", 1250.5], ["das Ergebnis ist 42", 42], ["x gleich fünf", 5], ["das ist zwanzig", 20], ["12 Euro", 12], ["achtzehn Grad", 18],
    ["sieben", 7], ["acht", 8], ["achtzig", 80], ["siebzig", 70], ["sechzig", 60], ["fünfzehn", 15],
  ];
  for (const [text, value] of cases) assert.equal(core.parseSpokenNumber(text), value, text);
  for (const text of ["", "hallo", "blau", "zweiundquatsch", "komma", "zwei Komma", "zwei Komma elf", "zwei Komma x", null, undefined, 5, "und"]) {
    assert.ok(Number.isNaN(core.parseSpokenNumber(text)), String(text));
  }
});

test("spoken answers: any of the recognizer's guesses may be the right number", () => {
  assert.equal(core.spokenMatches("42", "zweiundvierzig"), true);
  assert.equal(core.spokenMatches("42", ["dreiundvierzig", "42"]), true);
  assert.equal(core.spokenMatches("42", ["dreiundvierzig", "vierundvierzig"]), false);
  assert.equal(core.spokenMatches("3,5", "drei Komma fünf"), true);
  assert.equal(core.spokenMatches("−3", "minus drei"), true);
  assert.equal(core.spokenMatches("−3", "drei"), false);
  assert.equal(core.spokenMatches("12", ""), false);
  assert.equal(core.spokenMatches("zwölf", "12"), false);                // the expected value is a typed number, not a word
  assert.equal(core.spokenMatches("0", "null"), true);
});

// ------------------------------------------------------------------- achievements
test("master tests and gems have their own achievements", () => {
  const s = fresh();
  s.stats.testsPassed = 1;
  s.gemsEarned = 500;
  const list = Object.fromEntries(core.achievements(UNITS, s).map((a) => [a.id, a]));
  assert.equal(list.master1.unlocked, true);
  assert.equal(list.master5.unlocked, false);
  assert.deepEqual([list.master5.progress, list.master5.target], [1, 5]);
  assert.equal(list.gems500.unlocked, true);
});
