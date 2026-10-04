/* gomat core: every rule that doesn't need a screen -- progress, XP, streak, hearts, daily goal, unlocking,
   achievements, answer checking -- as plain functions. The page (gomat.js) draws; this decides.
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
  const XP_PERFECT_BONUS = 5;
  const XP_PRACTICE = 5;
  const HISTORY_DAYS = 14;
  const LESSON_ID = /^[1-9]-[1-9]$/;

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

  // ---------------------------------------------------------------- state
  function defaultState(now) {
    return {
      v: 1, onboarded: false, startUnit: 1, goal: 20, sound: true,
      xp: 0, xpToday: 0, xpDay: dayKey(now), streak: 0, bestStreak: 0, lastDay: null,
      hearts: MAX_HEARTS, heartsAt: now.getTime(),
      lessons: {}, history: {},
      stats: { lessons: 0, perfect: 0, correct: 0, wrong: 0, practice: 0 },
    };
  }

  const int = (value, low, high, fallback) =>
    Number.isFinite(value) ? Math.max(low, Math.min(high, Math.floor(value))) : fallback;
  const isDayKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

  /* Whatever comes out of storage is cleaned before it is trusted (a corrupt or hand-edited entry must not
     crash the page or give 500 hearts). */
  function sanitize(raw, now) {
    const state = defaultState(now);
    if (!raw || typeof raw !== "object" || raw.v !== 1) return state;
    state.onboarded = raw.onboarded === true;
    state.startUnit = int(raw.startUnit, 1, 9, 1);
    state.goal = GOALS.includes(raw.goal) ? raw.goal : 20;
    state.sound = raw.sound !== false;
    state.xp = int(raw.xp, 0, 10000000, 0);
    state.xpToday = int(raw.xpToday, 0, 100000, 0);
    state.xpDay = isDayKey(raw.xpDay) ? raw.xpDay : state.xpDay;
    state.streak = int(raw.streak, 0, 100000, 0);
    state.bestStreak = Math.max(state.streak, int(raw.bestStreak, 0, 100000, 0));
    state.lastDay = isDayKey(raw.lastDay) ? raw.lastDay : null;
    state.hearts = int(raw.hearts, 0, MAX_HEARTS, MAX_HEARTS);
    state.heartsAt = Number.isFinite(raw.heartsAt) ? raw.heartsAt : now.getTime();
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
    rollover(state, now);
    regenHearts(state, now);
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
  function rollover(state, now) {
    const today = dayKey(now);
    if (state.xpDay !== today) {
      state.xpDay = today;
      state.xpToday = 0;
    }
    if (state.lastDay && daysBetween(state.lastDay, today) > 1) state.streak = 0;
    return state;
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

  /* "done", "current" (the next one to do) or "locked". Lessons open one after the other. */
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

  function allDone(units, state) {
    return currentLessonId(units, state) === null;
  }

  // ------------------------------------------------------------- finishing
  const accuracyOf = (correct, mistakes) => Math.round((100 * correct) / Math.max(1, correct + mistakes));

  function completeLesson(state, lessonId, result, now) {
    rollover(state, now);
    const perfect = result.mistakes === 0;
    const xp = XP_LESSON + (perfect ? XP_PERFECT_BONUS : 0);
    const accuracy = accuracyOf(result.correct, result.mistakes);
    const entry = state.lessons[lessonId] || { done: false, best: 0, times: 0 };
    const firstTime = !entry.done;
    entry.done = true;
    entry.best = Math.max(entry.best, accuracy);
    entry.times += 1;
    state.lessons[lessonId] = entry;
    state.stats.lessons += 1;
    state.stats.perfect += perfect ? 1 : 0;
    state.stats.correct += result.correct;
    state.stats.wrong += result.mistakes;
    const goalReached = addXp(state, xp, now);
    const streakExtended = touchStreak(state, now);
    return { xp, perfect, accuracy, firstTime, goalReached, streakExtended, streak: state.streak };
  }

  function completePractice(state, result, now) {
    rollover(state, now);
    const accuracy = accuracyOf(result.correct, result.mistakes);
    state.stats.practice += 1;
    state.stats.correct += result.correct;
    state.stats.wrong += result.mistakes;
    const goalReached = addXp(state, XP_PRACTICE, now);
    const streakExtended = touchStreak(state, now);
    let heartWon = false;
    if (accuracy >= 80 && state.hearts < MAX_HEARTS) {
      addHeart(state, now);
      heartWon = true;
    }
    return { xp: XP_PRACTICE, accuracy, goalReached, streakExtended, streak: state.streak, heartWon };
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

  return {
    STORAGE_KEY, MAX_HEARTS, HEART_MS, GOALS, XP_LESSON, XP_PERFECT_BONUS, XP_PRACTICE,
    dayKey, daysBetween, defaultState, sanitize, memoryStorage, load, save, rollover, streakActiveToday, touchStreak,
    addXp, lastDays, regenHearts, loseHeart, addHeart, heartsEta, formatWait, flatten, unitOf, isDone,
    currentLessonId, lessonStatus, unitProgress, allDone, accuracyOf, completeLesson, completePractice,
    achievements, parseNumber, answersMatch, sameOrder,
  };
});
