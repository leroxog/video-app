/* gomat core: every rule that doesn't need a screen -- progress, XP, gems, streak (with streak protection),
   hearts, daily goal, unlocking behind master tests, placement test, achievements, answer checking
   (typed and spoken) -- as plain functions. The page (gomat.js) draws; this decides.
   It runs in the browser and in Node (that is how the tests run it). Everything is kept in the learner's
   own browser (localStorage); nothing is sent anywhere. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GomatCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY = "gomat.v1";
  const MAX_HEARTS = 5;
  const HEART_MS = 20 * 60 * 1000;          // one heart comes back every 20 minutes
  const GOALS = [10, 20, 30, 50];
  const XP_LESSON = 10;
  const XP_TEST = 20;
  const XP_PERFECT_BONUS = 5;
  const XP_PRACTICE = 5;
  const XP_SKIP = 15;
  const GEMS = { lesson: 10, perfect: 5, test: 30, goal: 15, practice: 3, skip: 15, welcome: 20 };
  const PRICES = { hearts: 80, freeze: 120 };
  const MAX_FREEZES = 2;
  const TEST_MAX_MISTAKES = 3;              // a master test is passed with at most this many mistakes
  const NO_SPEAK_MS = 60 * 60 * 1000;       // "I can't speak right now" switches speaking exercises off for an hour
  const HISTORY_DAYS = 14;
  const UNIT_COUNT = 9;
  const PLACEMENT_QUESTIONS = 10;
  const LESSON_ID = /^[1-9]-[1-9]$/;
  const COMPANIONS = ["gomi", "otto", "ben", "robi"];
  const GRADE_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 99];   // 0: not in school yet, 99: finished school
  const SELF_LEVELS = [0, 1, 2, 3];

  // ----------------------------------------------------------------- days
  const pad2 = (n) => String(n).padStart(2, "0");

  function dayKey(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function dayNumber(key) {
    const [y, m, d] = key.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }

  function daysBetween(fromKey, toKey) {
    return dayNumber(toKey) - dayNumber(fromKey);
  }

  function dayBefore(key) {
    const date = new Date(Date.UTC(2000, 0, 1));
    date.setUTCFullYear(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) - 1);
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
  }

  // ---------------------------------------------------------------- state
  function defaultState(now) {
    return {
      v: 1, onboarded: false, startUnit: 1, goal: 20, sound: true, companion: "gomi", grade: null, selfLevel: null,
      xp: 0, xpToday: 0, xpDay: dayKey(now), streak: 0, bestStreak: 0, lastDay: null,
      gems: 0, gemsEarned: 0, freezes: 0, noSpeakUntil: 0,
      hearts: MAX_HEARTS, heartsAt: now.getTime(),
      lessons: {}, history: {}, placement: null,
      stats: { lessons: 0, perfect: 0, correct: 0, wrong: 0, practice: 0, testsPassed: 0, testsFailed: 0 },
    };
  }

  const int = (value, low, high, fallback) =>
    Number.isFinite(value) ? Math.max(low, Math.min(high, Math.floor(value))) : fallback;
  const isDayKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  function sanitizePlacement(raw) {
    if (!raw || typeof raw !== "object") return null;
    const details = (Array.isArray(raw.details) ? raw.details : []).slice(0, UNIT_COUNT).map((d) => ({
      unit: int(d && d.unit, 1, UNIT_COUNT, 1), ok: int(d && d.ok, 0, 50, 0), total: int(d && d.total, 0, 50, 0), passed: !!(d && d.passed),
    }));
    return { unit: int(raw.unit, 1, UNIT_COUNT, 1), correct: int(raw.correct, 0, 50, 0), total: int(raw.total, 0, 50, 0), details };
  }

  /* Whatever comes out of storage is cleaned before it is trusted (a corrupt or hand-edited entry must not
     crash the page or give 500 hearts). */
  function sanitize(raw, now) {
    const state = defaultState(now);
    if (!raw || typeof raw !== "object" || raw.v !== 1) return state;
    state.onboarded = raw.onboarded === true;
    state.startUnit = int(raw.startUnit, 1, 9, 1);
    state.goal = GOALS.includes(raw.goal) ? raw.goal : 20;
    state.sound = raw.sound !== false;
    state.companion = COMPANIONS.includes(raw.companion) ? raw.companion : "gomi";
    state.grade = GRADE_IDS.includes(raw.grade) ? raw.grade : null;
    state.selfLevel = SELF_LEVELS.includes(raw.selfLevel) ? raw.selfLevel : null;
    state.xp = int(raw.xp, 0, 10000000, 0);
    state.xpToday = int(raw.xpToday, 0, 100000, 0);
    state.xpDay = isDayKey(raw.xpDay) ? raw.xpDay : state.xpDay;
    state.streak = int(raw.streak, 0, 100000, 0);
    state.bestStreak = Math.max(state.streak, int(raw.bestStreak, 0, 100000, 0));
    state.lastDay = isDayKey(raw.lastDay) ? raw.lastDay : null;
    state.gems = int(raw.gems, 0, 10000000, 0);
    state.gemsEarned = Math.max(state.gems, int(raw.gemsEarned, 0, 100000000, 0));
    state.freezes = int(raw.freezes, 0, MAX_FREEZES, 0);
    state.noSpeakUntil = Number.isFinite(raw.noSpeakUntil) && raw.noSpeakUntil > 0 ? raw.noSpeakUntil : 0;
    state.hearts = int(raw.hearts, 0, MAX_HEARTS, MAX_HEARTS);
    state.heartsAt = Number.isFinite(raw.heartsAt) ? raw.heartsAt : now.getTime();
    state.placement = sanitizePlacement(raw.placement);
    for (const [id, entry] of Object.entries(raw.lessons && typeof raw.lessons === "object" ? raw.lessons : {})) {
      if (LESSON_ID.test(id) && entry && typeof entry === "object") {
        state.lessons[id] = { done: entry.done === true, best: int(entry.best, 0, 100, 0), times: int(entry.times, 0, 100000, 0) };
      }
    }
    for (const [day, value] of Object.entries(raw.history && typeof raw.history === "object" ? raw.history : {})) {
      if (isDayKey(day)) state.history[day] = int(value, 0, 100000, 0);
    }
    for (const key of Object.keys(state.stats)) state.stats[key] = int(raw.stats && raw.stats[key], 0, 10000000, 0);
    return state;
  }

  function memoryStorage() {
    const data = new Map();
    return {
      getItem: (key) => (data.has(key) ? data.get(key) : null),
      setItem: (key, value) => { data.set(key, String(value)); },
      removeItem: (key) => { data.delete(key); },
    };
  }

  function load(storage, now) {
    let raw = null;
    try {
      const text = storage.getItem(STORAGE_KEY);
      raw = text ? JSON.parse(text) : null;
    } catch (error) {
      raw = null;
    }
    const state = sanitize(raw, now);
    const used = rollover(state, now);
    regenHearts(state, now);
    if (used) Object.defineProperty(state, "freezeUsed", { value: used, enumerable: false, configurable: true });
    return state;
  }

  function save(storage, state) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }

  // ------------------------------------------------------- days, streak, XP
  /* A new day starts today's XP again. Missed days end the streak -- unless streak protection (bought with
     gems) covers them, one protection per missed day. Returns how many protections were used. */
  function rollover(state, now) {
    const today = dayKey(now);
    if (state.xpDay !== today) {
      state.xpDay = today;
      state.xpToday = 0;
    }
    let used = 0;
    if (state.lastDay) {
      const missed = daysBetween(state.lastDay, today) - 1;
      if (missed > 0) {
        if (state.streak > 0 && state.freezes >= missed) {
          state.freezes -= missed;
          state.lastDay = dayBefore(today);
          used = missed;
        } else {
          state.streak = 0;
        }
      }
    }
    return used;
  }

  function streakActiveToday(state, now) {
    return state.lastDay === dayKey(now);
  }

  function touchStreak(state, now) {
    const today = dayKey(now);
    if (state.lastDay === today) return false;
    state.streak = state.lastDay && daysBetween(state.lastDay, today) === 1 ? state.streak + 1 : 1;
    state.lastDay = today;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    return true;
  }

  function addXp(state, amount, now) {
    rollover(state, now);
    const before = state.xpToday;
    state.xp += amount;
    state.xpToday += amount;
    const today = dayKey(now);
    state.history[today] = (state.history[today] || 0) + amount;
    const days = Object.keys(state.history).sort();
    for (const old of days.slice(0, Math.max(0, days.length - HISTORY_DAYS))) delete state.history[old];
    return before < state.goal && state.xpToday >= state.goal;
  }

  function addGems(state, amount) {
    state.gems += amount;
    state.gemsEarned += amount;
    return amount;
  }

  function lastDays(state, now, count) {
    const out = [];
    for (let back = count - 1; back >= 0; back--) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
      const key = dayKey(date);
      out.push({ key, label: ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][date.getDay()], xp: state.history[key] || 0 });
    }
    return out;
  }

  // ----------------------------------------------------------------- hearts
  function regenHearts(state, now) {
    const t = now.getTime();
    if (state.hearts >= MAX_HEARTS) {
      state.hearts = MAX_HEARTS;
      state.heartsAt = t;
      return state;
    }
    const elapsed = t - state.heartsAt;
    if (elapsed < 0) {                      // the clock went backwards: start counting again from now
      state.heartsAt = t;
      return state;
    }
    const gained = Math.floor(elapsed / HEART_MS);
    if (gained > 0) {
      state.hearts = Math.min(MAX_HEARTS, state.hearts + gained);
      state.heartsAt = state.hearts >= MAX_HEARTS ? t : state.heartsAt + gained * HEART_MS;
    }
    return state;
  }

  function loseHeart(state, now) {
    regenHearts(state, now);
    if (state.hearts >= MAX_HEARTS) state.heartsAt = now.getTime();   // the first lost heart starts the timer
    state.hearts = Math.max(0, state.hearts - 1);
    return state.hearts;
  }

  function addHeart(state, now) {
    regenHearts(state, now);
    state.hearts = Math.min(MAX_HEARTS, state.hearts + 1);
    if (state.hearts >= MAX_HEARTS) state.heartsAt = now.getTime();
    return state.hearts;
  }

  function heartsEta(state, now) {
    regenHearts(state, now);
    return state.hearts >= MAX_HEARTS ? null : Math.max(0, state.heartsAt + HEART_MS - now.getTime());
  }

  function formatWait(ms) {
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} Std. ${minutes % 60} Min.` : `${minutes} Min.`;
  }

  // ------------------------------------------------------------------- shop
  /* Returns {ok: true} or {ok: false, reason: "full" | "poor"}. */
  function buyHearts(state, now) {
    regenHearts(state, now);
    if (state.hearts >= MAX_HEARTS) return { ok: false, reason: "full" };
    if (state.gems < PRICES.hearts) return { ok: false, reason: "poor" };
    state.gems -= PRICES.hearts;
    state.hearts = MAX_HEARTS;
    state.heartsAt = now.getTime();
    return { ok: true };
  }

  function buyFreeze(state) {
    if (state.freezes >= MAX_FREEZES) return { ok: false, reason: "full" };
    if (state.gems < PRICES.freeze) return { ok: false, reason: "poor" };
    state.gems -= PRICES.freeze;
    state.freezes += 1;
    return { ok: true };
  }

  // --------------------------------------------------------------- speaking
  const canSpeakNow = (state, now) => now.getTime() >= state.noSpeakUntil;

  function muteSpeaking(state, now) {
    state.noSpeakUntil = now.getTime() + NO_SPEAK_MS;
    return state.noSpeakUntil;
  }

  // -------------------------------------------------------------- the path
  function flatten(units) {
    return units.flatMap((unit) => unit.lessons.map((lesson) => ({ id: lesson.id, unit: unit.id, test: !!lesson.test })));
  }

  function unitOf(lessonId) {
    return Number(String(lessonId).split("-")[0]);
  }

  function isDone(state, lessonId) {
    return unitOf(lessonId) < state.startUnit || !!(state.lessons[lessonId] && state.lessons[lessonId].done);
  }

  function currentLessonId(units, state) {
    const next = flatten(units).find((lesson) => !isDone(state, lesson.id));
    return next ? next.id : null;
  }

  /* "done", "current" (the next one to do) or "locked". Lessons open one after the other, and the next unit
     only opens once the master test (the last lesson) of the unit before is passed. */
  function lessonStatus(units, state, lessonId) {
    if (isDone(state, lessonId)) return "done";
    return currentLessonId(units, state) === lessonId ? "current" : "locked";
  }

  function unitProgress(units, state, unitId) {
    const unit = units.find((u) => u.id === unitId);
    if (!unit) return { done: 0, total: 0 };
    const total = unit.lessons.length;
    return { done: unit.lessons.filter((lesson) => isDone(state, lesson.id)).length, total };
  }

  function unitStatus(units, state, unitId) {
    const progress = unitProgress(units, state, unitId);
    if (progress.total > 0 && progress.done === progress.total) return "done";
    const current = currentLessonId(units, state);
    return current !== null && unitOf(current) === unitId ? "current" : "locked";
  }

  function allDone(units, state) {
    return currentLessonId(units, state) === null;
  }

  /* The unit that can be skipped with its master test: the one the learner is in right now. */
  function skippableUnit(units, state) {
    const current = currentLessonId(units, state);
    return current === null ? null : unitOf(current);
  }

  /* 1 to 3 stars for a finished lesson, by the best accuracy so far. */
  function starsFor(state, lessonId) {
    const entry = state.lessons[lessonId];
    if (!isDone(state, lessonId)) return 0;
    const best = entry ? entry.best : 100;
    return best >= 95 ? 3 : best >= 80 ? 2 : 1;
  }

  // ------------------------------------------------------------- finishing
  const accuracyOf = (correct, mistakes) => Math.round((100 * correct) / Math.max(1, correct + mistakes));

  /* A normal lesson counts when it is finished. A master test (result.test) counts only if it is passed: at most
     TEST_MAX_MISTAKES mistakes. Either way the learner studied today, so the streak counts. */
  function completeLesson(state, lessonId, result, now) {
    rollover(state, now);
    const isTest = result.test === true;
    const perfect = result.mistakes === 0;
    const passed = !isTest || result.mistakes <= TEST_MAX_MISTAKES;
    const accuracy = accuracyOf(result.correct, result.mistakes);
    state.stats.correct += result.correct;
    state.stats.wrong += result.mistakes;
    if (!passed) {
      state.stats.testsFailed += 1;
      return { xp: 0, gems: 0, perfect: false, passed: false, accuracy, firstTime: false, goalReached: false, streakExtended: touchStreak(state, now), streak: state.streak, test: true };
    }
    const entry = state.lessons[lessonId] || { done: false, best: 0, times: 0 };
    const firstTime = !entry.done;
    entry.done = true;
    entry.best = Math.max(entry.best, accuracy);
    entry.times += 1;
    state.lessons[lessonId] = entry;
    state.stats.lessons += 1;
    state.stats.perfect += perfect ? 1 : 0;
    if (isTest) state.stats.testsPassed += 1;
    const xp = (isTest ? XP_TEST : XP_LESSON) + (perfect ? XP_PERFECT_BONUS : 0);
    const gems = addGems(state, (isTest ? GEMS.test : GEMS.lesson) + (perfect ? GEMS.perfect : 0));
    const goalReached = addXp(state, xp, now);
    const goalGems = goalReached ? addGems(state, GEMS.goal) : 0;
    const streakExtended = touchStreak(state, now);
    return { xp, gems: gems + goalGems, perfect, passed: true, accuracy, firstTime, goalReached, streakExtended, streak: state.streak, test: isTest };
  }

  /* Skipping a unit: the learner took its master test straight away. Passed = every lesson of the unit counts as done. */
  function completeSkip(state, units, unitId, result, now) {
    rollover(state, now);
    const accuracy = accuracyOf(result.correct, result.mistakes);
    const passed = result.mistakes <= TEST_MAX_MISTAKES;
    state.stats.correct += result.correct;
    state.stats.wrong += result.mistakes;
    if (!passed) {
      state.stats.testsFailed += 1;
      return { xp: 0, gems: 0, passed: false, accuracy, goalReached: false, streakExtended: touchStreak(state, now), streak: state.streak, skipped: unitId };
    }
    const unit = units.find((u) => u.id === unitId);
    for (const lesson of unit ? unit.lessons : []) {
      const entry = state.lessons[lesson.id] || { done: false, best: 0, times: 0 };
      entry.done = true;
      entry.best = Math.max(entry.best, accuracy);
      state.lessons[lesson.id] = entry;
    }
    state.stats.testsPassed += 1;
    const gems = addGems(state, GEMS.skip);
    const goalReached = addXp(state, XP_SKIP, now);
    const goalGems = goalReached ? addGems(state, GEMS.goal) : 0;
    const streakExtended = touchStreak(state, now);
    return { xp: XP_SKIP, gems: gems + goalGems, passed: true, accuracy, goalReached, streakExtended, streak: state.streak, skipped: unitId };
  }

  function completePractice(state, result, now) {
    rollover(state, now);
    const accuracy = accuracyOf(result.correct, result.mistakes);
    state.stats.practice += 1;
    state.stats.correct += result.correct;
    state.stats.wrong += result.mistakes;
    const gems = addGems(state, GEMS.practice);
    const goalReached = addXp(state, XP_PRACTICE, now);
    const goalGems = goalReached ? addGems(state, GEMS.goal) : 0;
    const streakExtended = touchStreak(state, now);
    let heartWon = false;
    if (accuracy >= 80 && state.hearts < MAX_HEARTS) {
      addHeart(state, now);
      heartWon = true;
    }
    return { xp: XP_PRACTICE, gems: gems + goalGems, accuracy, goalReached, streakExtended, streak: state.streak, heartWon };
  }

  // ------------------------------------------------- placement ("Einstufung")
  /* Where to begin, from how good the learner says they are (0-3) and the school year. The placement test
     then corrects this. */
  function unitForGrade(grade) {
    if (grade === 99) return 6;                       // finished school: much is forgotten, start in the middle
    if (!Number.isFinite(grade) || grade <= 1) return 1;
    return Math.min(UNIT_COUNT, grade);
  }

  function unitForSelf(level) {
    return [1, 2, 4, 6][level] || 1;
  }

  function recommendedStart(grade, selfLevel) {
    return Math.max(1, Math.min(UNIT_COUNT, Math.round((unitForGrade(grade) + unitForSelf(selfLevel)) / 2)));
  }

  /* The staircase: a right answer moves the next question up one unit, a wrong one down. */
  function nextPlacementUnit(unit, ok) {
    return Math.max(1, Math.min(UNIT_COUNT, unit + (ok ? 1 : -1)));
  }

  /* steps: [{unit, ok}]. A unit counts as passed if at least half of its questions were right. The start unit is the
     lowest unit that was not passed; if every unit was passed it is the highest one that was asked. */
  function placementOutcome(steps) {
    const byUnit = new Map();
    let correct = 0;
    for (const step of steps) {
      const entry = byUnit.get(step.unit) || { unit: step.unit, ok: 0, total: 0 };
      entry.total += 1;
      if (step.ok) { entry.ok += 1; correct += 1; }
      byUnit.set(step.unit, entry);
    }
    const details = [...byUnit.values()].sort((a, b) => a.unit - b.unit).map((d) => ({ ...d, passed: d.ok * 2 >= d.total }));
    const failed = details.find((d) => !d.passed);
    const highest = details.length ? details[details.length - 1].unit : 1;
    return { unit: failed ? failed.unit : highest, correct, total: steps.length, details };
  }

  function finishOnboarding(state, choice, now) {
    state.onboarded = true;
    state.grade = GRADE_IDS.includes(choice.grade) ? choice.grade : null;
    state.selfLevel = SELF_LEVELS.includes(choice.selfLevel) ? choice.selfLevel : null;
    state.startUnit = int(choice.startUnit, 1, UNIT_COUNT, 1);
    state.goal = GOALS.includes(choice.goal) ? choice.goal : 20;
    state.placement = sanitizePlacement(choice.placement);
    if (state.gemsEarned === 0) addGems(state, GEMS.welcome);
    state.heartsAt = now.getTime();
    return state;
  }

  // ---------------------------------------------------------- achievements
  function achievements(units, state) {
    const unitDone = (id) => {
      const progress = unitProgress(units, state, id);
      return progress.total > 0 && progress.done === progress.total;
    };
    const totalLessons = flatten(units).length;
    const doneLessons = flatten(units).filter((lesson) => isDone(state, lesson.id)).length;
    const list = [
      ["first", "Erste Lektion", "Schließe deine erste Lektion ab.", "star", state.stats.lessons, 1],
      ["ten", "Fleißig", "Schließe 10 Lektionen ab.", "book", state.stats.lessons, 10],
      ["thirty", "Rechenprofi", "Schließe 30 Lektionen ab.", "medal", state.stats.lessons, 30],
      ["perfect", "Fehlerfrei", "Schaffe eine Lektion ohne Fehler.", "check", state.stats.perfect, 1],
      ["perfect5", "Perfektionist", "Schaffe 5 Lektionen ohne Fehler.", "crown", state.stats.perfect, 5],
      ["streak3", "Drei Tage in Folge", "Lerne 3 Tage in Folge.", "flame", state.bestStreak, 3],
      ["streak7", "Wochenserie", "Lerne 7 Tage in Folge.", "flame", state.bestStreak, 7],
      ["streak30", "Monatsserie", "Lerne 30 Tage in Folge.", "flame", state.bestStreak, 30],
      ["xp100", "100 XP", "Sammle 100 XP.", "bolt", state.xp, 100],
      ["xp500", "500 XP", "Sammle 500 XP.", "bolt", state.xp, 500],
      ["xp1000", "1000 XP", "Sammle 1000 XP.", "bolt", state.xp, 1000],
      ["gems500", "Juwelensammler", "Sammle insgesamt 500 Juwelen.", "gem", state.gemsEarned, 500],
      ["master1", "Meistertest bestanden", "Bestehe deinen ersten Meistertest.", "trophy", state.stats.testsPassed, 1],
      ["master5", "Meister der Einheiten", "Bestehe 5 Meistertests.", "trophy", state.stats.testsPassed, 5],
      ["times", "Einmaleins-Meister", "Schließe die Einheit „Das Einmaleins“ ab.", "times", unitDone(3) ? 1 : 0, 1],
      ["fractions", "Bruchkönig", "Schließe die Einheit „Brüche“ ab.", "pie", unitDone(5) ? 1 : 0, 1],
      ["equations", "Gleichungs-Held", "Schließe die Einheit „Gleichungen“ ab.", "x", unitDone(8) ? 1 : 0, 1],
      ["all", "Mathe-Champion", "Schließe alle Lektionen ab.", "trophy", doneLessons, totalLessons],
    ];
    return list.map(([id, title, desc, icon, value, target]) =>
      ({ id, title, desc, icon, target, progress: Math.min(value, target), unlocked: value >= target }));
  }

  // --------------------------------------------------------------- answers
  /* A typed number: "3,5" and "3.5" are the same, "−3" and "-3" are the same, spaces don't matter.
     Anything that isn't plainly a number is rejected (no "1e3", no "12abc"). */
  function parseNumber(text) {
    if (typeof text !== "string") return NaN;
    const t = text.replace(/\s+/g, "").replace(/−/g, "-").replace(",", ".");
    return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
  }

  function answersMatch(expected, given) {
    const a = parseNumber(String(expected));
    const b = parseNumber(String(given));
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  }

  function sameOrder(expected, given) {
    return Array.isArray(expected) && Array.isArray(given) && expected.length === given.length && expected.every((t, i) => t === given[i]);
  }

  // ---------------------------------------------------------- spoken numbers
  const WORDS = {
    null: 0, ein: 1, eins: 1, eine: 1, einen: 1, einem: 1, einer: 1, zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
    zehn: 10, elf: 11, zwoelf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
    zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90,
  };
  const LEXICON = Object.keys(WORDS).sort((a, b) => b.length - a.length);
  const FILLER = /\b(gleich|ist|das|ergebnis|loesung|die|der|lautet|antwort|euro|grad|prozent|x|also|ja)\b/g;

  const plain = (text) => text.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

  /* "einhundertdreiundzwanzig" (letters only, no spaces) -> 123, or NaN */
  function germanInteger(compact) {
    let i = 0;
    let total = 0;
    let current = 0;
    let any = false;
    while (i < compact.length) {
      if (compact.startsWith("und", i)) { i += 3; continue; }
      if (compact.startsWith("hundert", i)) { current = (current || 1) * 100; i += 7; any = true; continue; }
      if (compact.startsWith("tausend", i)) { total += (current || 1) * 1000; current = 0; i += 7; any = true; continue; }
      const hit = LEXICON.find((word) => compact.startsWith(word, i));
      if (!hit) return NaN;
      current += WORDS[hit];
      i += hit.length;
      any = true;
    }
    return any ? total + current : NaN;
  }

  /* What a speech recognizer heard ("42", "zweiundvierzig", "minus drei", "zwei Komma fünf", "1.000") as a number, or NaN. */
  function parseSpokenNumber(text) {
    if (typeof text !== "string") return NaN;
    const t = plain(text).trim();
    const negative = /(^|\s)(minus|negativ)(\s|$)/.test(t) || /(^|\s)-\s*\d/.test(t) || /−\s*\d/.test(t);
    const digits = t.match(/\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/);
    if (digits) {
      const token = digits[0];
      const value = /^\d{1,3}(\.\d{3})+/.test(token) ? Number(token.replace(/\./g, "").replace(",", ".")) : Number(token.replace(",", "."));
      return negative ? -value : value;
    }
    const words = t.replace(/(^|\s)(minus|negativ)(?=\s|$)/g, " ").replace(FILLER, " ").replace(/[^a-z\s]/g, " ");
    const [left, right] = words.split(/\bkomma\b/);
    const leftCompact = (left || "").replace(/\s+/g, "");
    const whole = leftCompact === "" && right !== undefined ? 0 : germanInteger(leftCompact);
    if (!Number.isFinite(whole)) return NaN;
    let value = whole;
    if (right !== undefined) {
      let fraction = "";
      for (const part of right.trim().split(/\s+/)) {
        const n = germanInteger(part);
        if (!Number.isInteger(n) || n < 0 || n > 9) return NaN;
        fraction += String(n);
      }
      if (!fraction) return NaN;
      value = Number(`${whole}.${fraction}`);
    }
    return negative ? -value : value;
  }

  /* True if any of the things the recognizer thought it heard is the expected number. */
  function spokenMatches(expected, heard) {
    const want = parseNumber(String(expected));
    const list = Array.isArray(heard) ? heard : [heard];
    return Number.isFinite(want) && list.some((text) => {
      const got = parseSpokenNumber(text);
      return Number.isFinite(got) && Math.abs(got - want) < 1e-9;
    });
  }

  return {
    STORAGE_KEY, MAX_HEARTS, HEART_MS, GOALS, XP_LESSON, XP_TEST, XP_PERFECT_BONUS, XP_PRACTICE, XP_SKIP, GEMS, PRICES, MAX_FREEZES,
    TEST_MAX_MISTAKES, NO_SPEAK_MS, UNIT_COUNT, PLACEMENT_QUESTIONS, COMPANIONS, GRADE_IDS, SELF_LEVELS,
    dayKey, dayBefore, daysBetween, defaultState, sanitize, memoryStorage, load, save, rollover, streakActiveToday, touchStreak,
    addXp, addGems, lastDays, regenHearts, loseHeart, addHeart, heartsEta, formatWait, buyHearts, buyFreeze,
    canSpeakNow, muteSpeaking, flatten, unitOf, isDone, currentLessonId, lessonStatus, unitProgress, unitStatus, allDone,
    skippableUnit, starsFor, accuracyOf, completeLesson, completeSkip, completePractice,
    unitForGrade, unitForSelf, recommendedStart, nextPlacementUnit, placementOutcome, finishOnboarding,
    achievements, parseNumber, answersMatch, sameOrder, parseSpokenNumber, spokenMatches,
  };
});
