/* gomat: the screens. The rules (progress, XP, streak, hearts, answer checking) are in gomat-core.js; the
   exercises come from the server (/api/gomat/...). Text from the server is put on the page with textContent
   and DOM nodes only. The only innerHTML is for our own fixed SVG pictures (ICON, mascot). */
(() => {
  "use strict";

  const Core = window.GomatCore;
  const DATA = JSON.parse(document.getElementById("gomatData").textContent);
  const UNITS = DATA.units;
  const root = document.getElementById("app");
  const overlay = document.createElement("div");
  document.body.append(overlay);

  // ------------------------------------------------------------------ icons
  const S = (inner, extra = "") => `<svg viewBox="0 0 24 24" ${extra} aria-hidden="true">${inner}</svg>`;
  const STROKE = 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
  const ICON = {
    star: S('<path d="M12 2.6l2.8 5.9 6.4.9-4.7 4.5 1.2 6.4L12 17.2 6.3 20.3l1.2-6.4L2.8 9.4l6.4-.9z"/>', 'fill="currentColor"'),
    check: S('<path d="M5 12.5l4.6 4.6L19 7.4"/>', 'fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"'),
    close: S('<path d="M6 6l12 12M18 6L6 18"/>', 'fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"'),
    lock: S('<rect x="5" y="10.5" width="14" height="10" rx="3" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
    trophy: S('<path d="M7 3.5h10v6a5 5 0 01-10 0zM7 5.5H4.2c0 3 1.2 4.6 3.3 5M17 5.5h2.8c0 3-1.2 4.6-3.3 5M12 14.5v3.5M8 20.5h8M9 18h6" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
    flame: S('<path d="M12.4 2.2c.6 3.2-1.6 4.6-3.2 6.6C7.6 10.800 6.500 12.500 6.500 14.800A5.500 5.500 0 0012 20.500a5.500 5.500 0 005.500-5.700c0-2.100-.9-3.500-1.900-4.700-.4 1.200-1.100 2-2 2.300.5-3.200-.2-7-1.200-10.200z" fill="currentColor"/>'),
    heart: S('<path d="M12 20.600s-7.600-4.600-9.700-9.300C.8 7.900 3 4.200 6.600 4.200c2 0 3.500 1 5.400 3 1.900-2 3.400-3 5.400-3 3.600 0 5.800 3.700 4.300 7.100-2.100 4.700-9.700 9.300-9.700 9.300z" fill="currentColor"/>'),
    bolt: S('<path d="M13.500 2L4.500 13.500H10L9 22l9.500-12H13z" fill="currentColor"/>'),
    plus: S('<path d="M12 5v14M5 12h14"/>', STROKE.replace("2.6", "3.4")),
    minus: S('<path d="M5 12h14"/>', STROKE.replace("2.6", "3.4")),
    plusminus: S('<path d="M12 4v9M7.500 8.500h9M7 20h10"/>', STROKE.replace("2.6", "3.2")),
    times: S('<path d="M6 6l12 12M18 6L6 18"/>', STROKE.replace("2.6", "3.4")),
    divide: S('<path d="M5 12h14"/><circle cx="12" cy="5.600" r="1.800" fill="currentColor" stroke="none"/><circle cx="12" cy="18.400" r="1.800" fill="currentColor" stroke="none"/>', STROKE.replace("2.6", "3.2")),
    pie: S('<path d="M12 12V3.500A8.500 8.500 0 1120.500 12z" fill="currentColor"/><path d="M12 12L5.800 18" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".0"/>'),
    decimal: S('<circle cx="8" cy="17" r="2.600" fill="currentColor"/><path d="M14 6.500c3-2 6.500 0 4.500 3.200L14 17h6" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round"/>'),
    percent: S('<path d="M18.500 5.500l-13 13" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/><circle cx="7" cy="7" r="2.800" fill="currentColor"/><circle cx="17" cy="17" r="2.800" fill="currentColor"/>'),
    x: S('<text x="12" y="18" font-size="18" font-weight="900" text-anchor="middle" fill="currentColor" font-family="Nunito, sans-serif">x</text>'),
    ruler: S('<rect x="2.500" y="8" width="19" height="8" rx="2" transform="rotate(-35 12 12)" fill="currentColor"/><path d="M8 10.600l1.500 1.200M11 8.500l1 1.400M14 6.400l1.500 1.200" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity=".8"/>'),
    book: S('<path d="M12 6.500C10.500 5 8 4.500 4.500 4.800V18c3.500-.3 6 .2 7.500 1.700 1.500-1.500 4-2 7.500-1.700V4.800C16 4.500 13.500 5 12 6.500z"/><path d="M12 6.500v13"/>', STROKE),
    home: S('<path d="M3.500 11.200L12 3.800l8.500 7.400M5.800 9.800V20h12.400V9.800"/><path d="M10 20v-5h4v5"/>', STROKE),
    dumbbell: S('<path d="M6.500 8v8M17.500 8v8M3.500 10v4M20.500 10v4M6.500 12h11"/>', STROKE),
    medal: S('<circle cx="12" cy="14.500" r="5.500" fill="currentColor"/><path d="M8.500 3l3.500 6 3.500-6" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/>'),
    crown: S('<path d="M3.500 8.500l4.500 4 4-7 4 7 4.500-4-1.600 10H5.100z" fill="currentColor"/>'),
    shield: S('<path d="M12 3l7.500 2.800v5.700c0 4.600-3.100 8.100-7.500 9.700-4.400-1.600-7.500-5.100-7.500-9.700V5.800z"/><path d="M8.500 12l2.600 2.600 4.600-5"/>', STROKE),
    user: S('<circle cx="12" cy="8" r="4"/><path d="M4.500 20.500c.8-4 3.700-6 7.500-6s6.700 2 7.500 6"/>', STROKE),
    sound: S('<path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" fill="currentColor"/><path d="M15.500 9a4 4 0 010 6M18 6.500a7.500 7.500 0 010 11" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    mute: S('<path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" fill="currentColor"/><path d="M16 9.500l5 5M21 9.500l-5 5" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    target: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><circle cx="12" cy="12" r="4.500" fill="none" stroke="currentColor" stroke-width="2.600"/><circle cx="12" cy="12" r="1.500" fill="currentColor"/>'),
    clock: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><path d="M12 7v5.500l3.500 2" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/>'),
    arrow: S('<path d="M12 5v13M6.500 12.500L12 18l5.500-5.500"/>', STROKE),
    logo: S('<rect x="1.500" y="1.500" width="21" height="21" rx="6.500" fill="#1cb0f6"/><path d="M12 5.500v9.500M7.200 10.200h9.600" stroke="#fff" stroke-width="3.200" stroke-linecap="round"/><circle cx="9" cy="18.300" r="1.400" fill="#fff"/><circle cx="15" cy="18.300" r="1.400" fill="#fff"/>'),
  };

  /* Gomi, the mascot: original artwork. */
  function mascot(mood = "happy") {
    const mouth = {
      happy: '<path d="M47 76q13 13 26 0" fill="none" stroke="#1f3a4d" stroke-width="4.500" stroke-linecap="round"/>',
      sad: '<path d="M49 84q11-11 22 0" fill="none" stroke="#1f3a4d" stroke-width="4.500" stroke-linecap="round"/>',
      cheer: '<path d="M44 74q16 22 32 0z" fill="#1f3a4d" stroke="#1f3a4d" stroke-width="3" stroke-linejoin="round"/><path d="M52 84q8-6 16 0" fill="#ff7a8a"/>',
    }[mood] || "";
    const arms = mood === "cheer"
      ? '<ellipse cx="17" cy="52" rx="9" ry="14" transform="rotate(25 17 52)" fill="#1cb0f6"/><ellipse cx="103" cy="52" rx="9" ry="14" transform="rotate(-25 103 52)" fill="#1cb0f6"/>'
      : '<ellipse cx="18" cy="76" rx="9" ry="14" transform="rotate(12 18 76)" fill="#1899d6"/><ellipse cx="102" cy="76" rx="9" ry="14" transform="rotate(-12 102 76)" fill="#1899d6"/>';
    return `<svg viewBox="0 0 120 120" aria-hidden="true">
      <ellipse cx="60" cy="110" rx="34" ry="6" fill="#000" opacity=".12"/>
      ${arms}
      <rect x="40" y="94" width="14" height="14" rx="6" fill="#1899d6"/><rect x="66" y="94" width="14" height="14" rx="6" fill="#1899d6"/>
      <line x1="60" y1="26" x2="60" y2="12" stroke="#1899d6" stroke-width="4" stroke-linecap="round"/>
      <circle cx="60" cy="10" r="6" fill="#ffc800"/>
      <rect x="22" y="24" width="76" height="76" rx="32" fill="#1899d6"/>
      <rect x="22" y="22" width="76" height="74" rx="32" fill="#1cb0f6"/>
      <ellipse cx="60" cy="82" rx="26" ry="15" fill="#84d8ff" opacity=".55"/>
      <circle cx="46" cy="55" r="12.500" fill="#fff"/><circle cx="74" cy="55" r="12.500" fill="#fff"/>
      <circle cx="48" cy="57" r="6" fill="#1f3a4d"/><circle cx="72" cy="57" r="6" fill="#1f3a4d"/>
      <circle cx="50" cy="55" r="2.200" fill="#fff"/><circle cx="74" cy="55" r="2.200" fill="#fff"/>
      <ellipse cx="34" cy="72" rx="6" ry="4.500" fill="#ff8fa3" opacity=".6"/><ellipse cx="86" cy="72" rx="6" ry="4.500" fill="#ff8fa3" opacity=".6"/>
      ${mouth}
      <path d="M60 90v8M56 94h8" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".85"/>
    </svg>`;
  }

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "style") el.style.cssText = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? "" : value);
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const child of children) {
      if (child == null || child === false) continue;
      if (Array.isArray(child)) append(el, child);
      else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  function icon(name) {
    const holder = document.createElement("span");
    holder.style.display = "contents";
    holder.innerHTML = ICON[name] || ICON.star;
    return holder.firstElementChild;
  }

  function mascotEl(mood, cls = "") {
    const holder = document.createElement("div");
    holder.className = `mascot ${cls}`.trim();
    holder.innerHTML = mascot(mood);
    return holder;
  }

  function fractionNode(top, bottom) {
    const part = (x) => (x === "▢" ? h("span", { class: "blank" }) : x);
    return h("span", { class: "frac" }, h("span", {}, part(top)), h("span", {}, part(bottom)));
  }

  /* "3/8" becomes a stacked fraction and "▢" an empty box -- built from DOM nodes, never from HTML. */
  function rich(text) {
    const out = document.createDocumentFragment();
    const pattern = /(\d+|▢)\/(\d+|▢)|▢/g;
    let last = 0;
    let match;
    while ((match = pattern.exec(text))) {
      if (match.index > last) out.append(text.slice(last, match.index));
      out.append(match[0] === "▢" ? h("span", { class: "blank" }) : fractionNode(match[1], match[2]));
      last = match.index + match[0].length;
    }
    if (last < text.length) out.append(text.slice(last));
    return out;
  }

  const shuffle = (list) => {
    const copy = list.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const now = () => new Date();
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // ------------------------------------------------------------------ state
  function openStorage() {
    try {
      const probe = "gomat.probe";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (error) {
      return Core.memoryStorage();
    }
  }

  const store = openStorage();
  let state = Core.load(store, now());
  const ui = { screen: location.hash.slice(1) || "learn", openNode: null, onb: { step: 0, level: 1, goal: 20 }, session: null, scrolled: false };
  if (!["learn", "practice", "achievements", "profile"].includes(ui.screen)) ui.screen = "learn";

  function persist() {
    Core.save(store, state);
  }

  function refresh() {
    Core.rollover(state, now());
    Core.regenHearts(state, now());
  }

  // ------------------------------------------------------------------ sounds
  const Sfx = (() => {
    let ctx = null;
    function audio() {
      if (!state.sound) return null;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === "suspended") ctx.resume();
        return ctx;
      } catch (error) {
        return null;
      }
    }
    function tone(freq, start, length, type = "sine", volume = 0.12) {
      const c = audio();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      const t0 = c.currentTime + start;
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
      osc.connect(gain).connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + length + 0.05);
    }
    return {
      tap: () => tone(520, 0, 0.06, "triangle", 0.06),
      right: () => { tone(660, 0, 0.14); tone(880, 0.1, 0.22); },
      wrong: () => { tone(220, 0, 0.18, "sawtooth", 0.07); tone(165, 0.12, 0.25, "sawtooth", 0.07); },
      finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3)),
    };
  })();

  // ------------------------------------------------------------------ toast
  let toastTimer = null;
  function toast(message) {
    document.querySelector(".toast")?.remove();
    const el = h("div", { class: "toast", role: "status" }, message);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  // ---------------------------------------------------------------- modal
  function modal({ mood, title, text, buttons }) {
    const back = h("div", { class: "modal-back", role: "dialog", "aria-modal": "true", "aria-label": title });
    const close = () => back.remove();
    const box = h("div", { class: "modal" }, mood ? mascotEl(mood) : null, h("h2", {}, title), text ? h("p", {}, text) : null,
      h("div", { class: "btns" }, buttons.map((b) => h("button", { class: `btn ${b.kind || "btn-secondary"} btn-block`, type: "button", onclick: () => { close(); if (b.run) b.run(); } }, b.label))));
    back.append(box);
    back.addEventListener("click", (event) => { if (event.target === back) close(); });
    document.body.append(back);
    box.querySelector("button")?.focus();
    return close;
  }

  // ------------------------------------------------------------ the shell
  const NAV = [
    { id: "learn", label: "Lernen", icon: "home" },
    { id: "practice", label: "Üben", icon: "dumbbell" },
    { id: "achievements", label: "Erfolge", icon: "shield" },
    { id: "profile", label: "Profil", icon: "user" },
  ];

  function go(screen) {
    ui.screen = screen;
    ui.openNode = null;
    if (location.hash !== `#${screen}`) history.replaceState(null, "", `#${screen}`);
    ui.scrolled = false;
    render();
    window.scrollTo(0, 0);
  }

  function navItem(item) {
    return h("button", { class: `navitem${ui.screen === item.id ? " on" : ""}`, type: "button", "aria-label": item.label, "aria-current": ui.screen === item.id ? "page" : null, onclick: () => go(item.id) },
      icon(item.icon), h("span", { class: "label" }, item.label));
  }

  function chips() {
    const streakOn = Core.streakActiveToday(state, now());
    return [
      h("button", { class: `chip streak${streakOn ? "" : " dim"}`, type: "button", "aria-label": `${state.streak} Tage in Folge`, onclick: () => toast(streakOn ? `Streak: ${state.streak} Tage in Folge. Weiter so!` : "Löse heute eine Lektion, damit deine Streak bleibt.") }, icon("flame"), String(state.streak)),
      h("button", { class: "chip xp", type: "button", "aria-label": `${state.xp} XP`, onclick: () => toast(`Du hast insgesamt ${state.xp} XP gesammelt.`) }, icon("bolt"), String(state.xp)),
      h("button", { class: `chip hearts${state.hearts === 0 ? " dim" : ""}`, type: "button", "aria-label": `${state.hearts} Herzen`, onclick: heartsInfo }, icon("heart"), String(state.hearts)),
    ];
  }

  function goalCard() {
    const pct = Math.min(100, Math.round((100 * state.xpToday) / state.goal));
    return h("div", { class: "card goal" }, h("h3", {}, "Tagesziel"),
      h("div", { class: "meta" }, h("span", {}, `${Math.min(state.xpToday, state.goal)} / ${state.goal} XP`), h("span", {}, pct >= 100 ? "Geschafft!" : "")),
      h("div", { class: "bar gold", style: `--w:${pct}%` }, h("i")));
  }

  function rail() {
    return h("aside", { class: "rail" },
      h("div", { class: "card" }, h("div", { class: "stat-row" }, chips())),
      goalCard(),
      h("div", { class: "card tip" }, mascotEl("happy"), h("p", {}, tipOfTheDay())),
      h("div", { class: "links" }, h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum")));
  }

  function tipOfTheDay() {
    const tips = [
      "Kleine Schritte jeden Tag bringen mehr als ein langer Marathon.",
      "Ein Fehler ist okay: Aus Fehlern lernst du am meisten.",
      "Rechne im Kopf, bevor du antwortest. Das trainiert dein Gehirn!",
      "Das Einmaleins sitzt am besten, wenn du es jeden Tag ein bisschen übst.",
      "Bei Textaufgaben hilft es, zuerst zu überlegen: Was ist gesucht?",
    ];
    return tips[Math.floor(Date.now() / 86400000) % tips.length];
  }

  function render() {
    refresh();
    root.replaceChildren();
    if (!state.onboarded) {
      root.append(onboarding());
      return;
    }
    const pages = { learn: learnPage, practice: practicePage, achievements: achievementsPage, profile: profilePage };
    root.append(h("div", { class: "shell" },
      h("nav", { class: "side", "aria-label": "Hauptmenü" }, h("a", { class: "logo", href: "/", "aria-label": "gomat" }, icon("logo"), h("span", { class: "word" }, "gomat")), NAV.map(navItem)),
      h("main", { class: "main" },
        h("div", { class: "topbar" }, h("span", { class: "brand" }, "gomat"), h("div", { class: "chips" }, chips())),
        h("div", { class: "col" }, pages[ui.screen]())),
      rail(),
      h("nav", { class: "bottomnav", "aria-label": "Hauptmenü" }, NAV.map(navItem))));
    if (ui.screen === "learn") afterLearnRender();
  }

  // ------------------------------------------------------------- learn path
  const OFFSETS = [0, 44, 72, 44, 0, -44, -72, -44];

  function nodeButton(unit, lesson, index) {
    const status = Core.lessonStatus(UNITS, state, lesson.id);
    const number = index + 1;
    const label = `${lesson.test ? "Einheitstest" : `Lektion ${number}`}: ${lesson.title}`;
    const kind = status === "locked" ? "lock" : status === "done" && !lesson.test ? "check" : lesson.icon;
    const wrap = h("div", { class: "node-wrap", style: `--dx: calc(${OFFSETS[index % OFFSETS.length]}px * var(--k, 1))`, "data-lesson": lesson.id },
      status === "current" ? h("div", { class: "bubble" }, state.hearts === 0 ? "Pause" : "Start") : null,
      h("button", { class: `node ${status}${lesson.test ? " test" : ""}`, type: "button", "aria-label": `${label}${status === "locked" ? " (gesperrt)" : status === "done" ? " (geschafft)" : ""}`, onclick: (event) => { event.stopPropagation(); ui.openNode = ui.openNode === lesson.id ? null : lesson.id; render(); } },
        icon(kind)));
    if (ui.openNode === lesson.id) {
      wrap.append(status === "locked"
        ? h("div", { class: "pop locked-pop" }, h("h3", {}, lesson.title), h("p", {}, "Schließe zuerst die Lektionen davor ab."), h("button", { class: "btn btn-block", type: "button", disabled: true }, "Gesperrt"))
        : h("div", { class: "pop" }, h("h3", {}, lesson.title),
          h("p", {}, lesson.test ? "Zeig, was du in dieser Einheit gelernt hast." : `Lektion ${number} von ${unit.lessons.length - 1}`),
          h("button", { class: "btn btn-block", type: "button", onclick: () => startLesson(lesson.id) }, status === "done" ? "Nochmal üben" : `Start +${Core.XP_LESSON} XP`)));
    }
    return wrap;
  }

  function learnPage() {
    const current = Core.currentLessonId(UNITS, state);
    const sections = UNITS.map((unit) => {
      const progress = Core.unitProgress(UNITS, state, unit.id);
      const lessonNodes = unit.lessons.map((lesson, index) => nodeButton(unit, lesson, index));
      return h("section", { class: "unit", "data-color": unit.color, "aria-label": `Einheit ${unit.id}: ${unit.title}` },
        h("div", { class: "unit-banner" },
          h("div", {}, h("div", { class: "kicker" }, `Einheit ${unit.id}`), h("h2", {}, unit.title), h("p", {}, unit.desc)),
          h("div", { class: "count" }, `${progress.done}/${progress.total}`)),
        h("div", { class: "path" }, lessonNodes));
    });
    const end = current === null ? h("div", { class: "course-end" }, mascotEl("cheer", "bounce"), h("h2", {}, "Du hast alles geschafft!"), h("p", {}, "Wiederhole Lektionen oder geh zum Üben, damit alles sitzt.")) : null;
    return h("div", { onclick: () => { if (ui.openNode) { ui.openNode = null; render(); } } }, sections, end);
  }

  let jumpObserver = null;
  function afterLearnRender() {
    const target = document.querySelector(".node.current");
    jumpObserver?.disconnect();
    if (!target) return;
    if (!ui.scrolled) {
      ui.scrolled = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: "center" }));
    }
    jumpObserver = new IntersectionObserver(([entry]) => {
      document.querySelector(".jump")?.remove();
      if (!entry.isIntersecting && ui.screen === "learn" && !ui.session) {
        document.body.append(h("button", { class: "jump", type: "button", onclick: () => { target.scrollIntoView({ behavior: "smooth", block: "center" }); } }, icon("arrow"), "Weiter geht’s hier"));
      }
    });
    jumpObserver.observe(target);
  }

  // ---------------------------------------------------------------- practice
  function practicePage() {
    const current = Core.currentLessonId(UNITS, state);
    const maxUnit = current ? Core.unitOf(current) : UNITS.length;
    return h("div", {}, h("h1", { class: "page-title" }, "Üben"),
      h("p", { class: "page-sub" }, "Gemischte Aufgaben aus allem, was du schon gelernt hast. Hier kostet ein Fehler kein Herz."),
      h("div", { class: "hero" }, mascotEl("happy"),
        h("div", {}, h("h2", {}, "Gemischte Übung"), h("p", {}, `10 Aufgaben aus den Einheiten 1 bis ${maxUnit}. Ab 80 % richtig gibt es ein Herz zurück.`),
          h("button", { class: "btn", type: "button", onclick: () => startPractice(maxUnit) }, `Start +${Core.XP_PRACTICE} XP`))),
      h("div", { class: "card", style: "margin-top:16px" }, h("div", { class: "row" }, h("h3", {}, "Deine Herzen"), h("div", { class: "chip hearts" }, icon("heart"), `${state.hearts} / ${Core.MAX_HEARTS}`)),
        h("p", { style: "margin:6px 0 0;color:var(--muted)" }, heartsText())));
  }

  function heartsText() {
    const wait = Core.heartsEta(state, now());
    return wait === null
      ? "Alle Herzen sind voll. Pro Fehler in einer Lektion verlierst du eins."
      : `Das nächste Herz kommt in etwa ${Core.formatWait(wait)}. Alle 20 Minuten kommt eins zurück.`;
  }

  function heartsInfo() {
    refresh();
    modal({ mood: state.hearts === 0 ? "sad" : "happy", title: state.hearts === 0 ? "Keine Herzen mehr" : `${state.hearts} von ${Core.MAX_HEARTS} Herzen`, text: heartsText(),
      buttons: [{ label: "Üben, um ein Herz zu holen", kind: "btn-primary", run: () => go("practice") }, { label: "Okay" }] });
  }

  // ------------------------------------------------------------ achievements
  function achievementsPage() {
    const list = Core.achievements(UNITS, state);
    const done = list.filter((a) => a.unlocked).length;
    return h("div", {}, h("h1", { class: "page-title" }, "Erfolge"), h("p", { class: "page-sub" }, `${done} von ${list.length} geschafft`),
      h("div", { class: "stack" }, list.map((a) => h("div", { class: `ach${a.unlocked ? " on" : ""}` }, h("div", { class: "badge" }, icon(a.icon)),
        h("div", { style: "flex:1" }, h("h3", {}, a.title), h("p", {}, a.desc),
          h("div", { class: `bar${a.unlocked ? " gold" : ""}`, style: `--w:${Math.round((100 * a.progress) / a.target)}%` }, h("i")),
          h("div", { class: "num" }, `${a.progress} / ${a.target}`))))));
  }

  // ----------------------------------------------------------------- profile
  function profilePage() {
    const total = state.stats.correct + state.stats.wrong;
    const accuracy = total ? Math.round((100 * state.stats.correct) / total) : 0;
    const week = Core.lastDays(state, now(), 7);
    const top = Math.max(20, ...week.map((d) => d.xp));
    const stat = (iconName, value, label, color) => h("div", { class: "statcard" }, h("div", { class: "v", style: `color:${color}` }, icon(iconName), String(value)), h("div", { class: "k" }, label));
    return h("div", {}, h("h1", { class: "page-title" }, "Dein Profil"),
      h("div", { class: "card", style: "display:flex;align-items:center;gap:16px" }, mascotEl("happy"),
        h("div", {}, h("h2", {}, "Mathe-Lerner"), h("p", { style: "margin:4px 0 0;color:var(--muted)" }, `${Core.flatten(UNITS).filter((l) => Core.isDone(state, l.id)).length} von ${Core.flatten(UNITS).length} Lektionen geschafft`))),
      h("h2", { class: "page-title", style: "font-size:20px" }, "Statistik"),
      h("div", { class: "grid2" },
        stat("flame", state.streak, "Tage in Folge", "var(--orange)"), stat("bolt", state.xp, "XP gesamt", "var(--gold-d)"),
        stat("target", `${accuracy} %`, "Genauigkeit", "var(--blue)"), stat("crown", state.stats.perfect, "Fehlerfreie Lektionen", "var(--gold-d)"),
        stat("flame", state.bestStreak, "Längste Serie", "var(--orange)"), stat("book", state.stats.lessons + state.stats.practice, "Lektionen und Übungen", "var(--blue)")),
      h("h2", { class: "page-title", style: "font-size:20px" }, "Diese Woche"),
      h("div", { class: "card" }, h("div", { class: "week" }, week.map((d, i) => h("div", { class: `d${d.xp ? " on" : ""}${i === 6 ? " today" : ""}` }, d.xp ? String(d.xp) : "", h("i", { style: `--h:${Math.max(6, Math.round((88 * d.xp) / top))}px` }), d.label)))),
      h("h2", { class: "page-title", style: "font-size:20px" }, "Einstellungen"),
      h("div", { class: "card" },
        h("div", { class: "setting", style: "flex-direction:column;align-items:stretch" }, h("div", {}, "Tagesziel"),
          h("div", { class: "seg" }, Core.GOALS.map((g) => h("button", { class: g === state.goal ? "on" : "", type: "button", onclick: () => { state.goal = g; persist(); render(); } }, `${g} XP`)))),
        h("div", { class: "setting" }, h("div", {}, "Töne"), h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(state.sound), "aria-label": "Töne", onclick: () => { state.sound = !state.sound; persist(); render(); if (state.sound) Sfx.right(); } })),
        h("div", { class: "setting" }, h("div", {}, h("div", {}, "Fortschritt zurücksetzen"), h("small", { style: "color:var(--muted)" }, "Löscht alles in diesem Browser.")),
          h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: confirmReset }, "Zurücksetzen"))),
      h("p", { style: "color:var(--muted);font-size:14px;margin-top:16px" }, "Dein Fortschritt wird nur in diesem Browser gespeichert. Es gibt keine Konten und keine Cookies."),
      h("div", { class: "links" }, h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum")));
  }

  function confirmReset() {
    modal({ mood: "sad", title: "Wirklich alles löschen?", text: "Dein ganzer Fortschritt, deine XP und deine Streak gehen verloren.",
      buttons: [{ label: "Nein, behalten", kind: "btn-primary" }, { label: "Ja, zurücksetzen", kind: "btn-danger", run: () => { state = Core.defaultState(now()); persist(); ui.onb = { step: 0, level: 1, goal: 20 }; go("learn"); } }] });
  }

  // -------------------------------------------------------------- onboarding
  function onboarding() {
    const o = ui.onb;
    const next = () => { o.step += 1; render(); };
    const dots = h("div", { class: "dots" }, [0, 1, 2].map((i) => h("i", { class: i <= o.step ? "on" : "" })));
    const screens = [
      () => ({ mood: "cheer", speech: "Hallo! Ich bin Gomi.", title: "Mathe lernen macht mit gomat Spaß", text: "Kurze Lektionen, Sterne sammeln und jeden Tag ein Stück besser werden.", body: null, action: h("button", { class: "btn btn-primary btn-block", type: "button", onclick: next }, "Los geht’s") }),
      () => ({ mood: "happy", speech: "Wo fangen wir an?", title: "Wie gut kannst du schon rechnen?", text: null,
        body: h("div", { class: "options" }, [
          [1, "Ich fange ganz neu an", "Zahlen bis 20"], [2, "Ich kann schon bis 20 rechnen", "Rechnen bis 100"], [3, "Ich kann bis 100 rechnen", "Das Einmaleins"],
          [5, "Ich kenne Mal und Geteilt", "Brüche"], [7, "Ich bin schon weit", "Negative Zahlen und Gleichungen"],
        ].map(([unit, label, small]) => h("button", { class: `opt${o.level === unit ? " sel" : ""}`, type: "button", onclick: () => { o.level = unit; render(); } }, h("span", {}, label, h("small", {}, `Start bei: ${small}`))))),
        action: h("button", { class: "btn btn-primary btn-block", type: "button", onclick: next }, "Weiter") }),
      () => ({ mood: "happy", speech: "Jeden Tag ein bisschen!", title: "Wie viel willst du pro Tag üben?", text: null,
        body: h("div", { class: "options" }, [[10, "Locker", "10 XP, etwa eine Lektion"], [20, "Normal", "20 XP, etwa zwei Lektionen"], [30, "Ernsthaft", "30 XP, etwa drei Lektionen"], [50, "Intensiv", "50 XP, etwa fünf Lektionen"]]
          .map(([goal, label, small]) => h("button", { class: `opt${o.goal === goal ? " sel" : ""}`, type: "button", onclick: () => { o.goal = goal; render(); } }, h("span", {}, label, h("small", {}, small))))),
        action: h("button", { class: "btn btn-primary btn-block", type: "button", onclick: () => { state.onboarded = true; state.startUnit = o.level; state.goal = o.goal; persist(); ui.scrolled = false; render(); } }, "Fertig") }),
    ];
    const s = screens[o.step]();
    return h("div", { class: "screen" }, h("div", { class: "body" }, dots, h("div", { class: "speech" }, s.speech), mascotEl(s.mood, "big"), h("h1", {}, s.title), s.text ? h("p", {}, s.text) : null, s.body),
      h("div", { class: "foot" }, h("div", { class: "inner" }, s.action, o.step > 0 ? h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: () => { o.step -= 1; render(); } }, "Zurück") : null)));
  }

  // --------------------------------------------------------------- starting
  function startLesson(lessonId) {
    refresh();
    if (state.hearts === 0) return heartsInfo();
    ui.openNode = null;
    runSession({ id: lessonId, practice: false, url: `/api/gomat/lesson/${lessonId}` });
  }

  function startPractice(maxUnit) {
    runSession({ id: null, practice: true, url: `/api/gomat/practice?max_unit=${maxUnit}&n=10` });
  }

  async function runSession(spec) {
    overlay.replaceChildren(h("div", { class: "lesson" }, h("div", { class: "loading", style: "flex:1" }, mascotEl("happy"), h("div", {}, "Einen Moment …"))));
    let exercises;
    try {
      const response = await fetch(spec.url, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.exercises) || !data.exercises.length) throw new Error("bad answer");
      exercises = data.exercises;
    } catch (error) {
      overlay.replaceChildren();
      modal({ mood: "sad", title: "Keine Verbindung", text: "Die Aufgaben konnten nicht geladen werden. Prüfe dein Internet und versuche es noch einmal.", buttons: [{ label: "Nochmal versuchen", kind: "btn-primary", run: () => runSession(spec) }, { label: "Abbrechen" }] });
      return;
    }
    ui.session = {
      spec, total: exercises.length, done: 0, mistakes: 0, startedAt: Date.now(), queue: exercises.map((e) => ({ e })), current: null,
      unitBefore: spec.practice ? null : Core.unitProgress(UNITS, state, Core.unitOf(spec.id)),
    };
    nextExercise();
  }

  // ------------------------------------------------------------ the lesson
  const PRAISE = ["Super!", "Richtig!", "Stark!", "Genau!", "Perfekt!", "Klasse!", "Toll gemacht!"];
  const EXPR = /^[\d\s+−×÷=?▢()²³⁴x,./-]+$/;

  function nextExercise() {
    const s = ui.session;
    if (!s.queue.length) return finish();
    s.current = s.queue.shift();
    drawExercise();
  }

  function heartsView() {
    return h("div", { class: `l-hearts${state.hearts === 0 ? " empty" : ""}`, "aria-label": `${state.hearts} Herzen` }, icon("heart"), String(state.hearts));
  }

  function lessonFrame(bodyNodes, footNode) {
    const s = ui.session;
    const pct = Math.round((100 * s.done) / s.total);
    return h("div", { class: "lesson", role: "dialog", "aria-modal": "true", "aria-label": "Lektion" },
      h("div", { class: "l-top" },
        h("button", { class: "l-x", type: "button", "aria-label": "Lektion beenden", onclick: confirmQuit }, icon("close")),
        h("div", { class: "l-bar bar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: `width:${pct}%` })),
        s.spec.practice ? null : heartsView()),
      bodyNodes, footNode);
  }

  function confirmQuit() {
    modal({ mood: "sad", title: "Willst du wirklich aufhören?", text: "Wenn du jetzt gehst, geht der Fortschritt in dieser Lektion verloren.",
      buttons: [{ label: "Weiterlernen", kind: "btn-primary" }, { label: "Aufhören", kind: "btn-secondary", run: () => { ui.session = null; overlay.replaceChildren(); render(); } }] });
  }

  function drawExercise() {
    const s = ui.session;
    const e = s.current.e;
    const ctl = buildExercise(e);
    const check = h("button", { class: "btn btn-primary", type: "button", disabled: true, onclick: () => submit() }, "Prüfen");
    const foot = h("div", { class: "l-foot" }, h("div", { class: "inner" }, h("span", {}), check));
    const body = h("div", { class: "l-body" }, ctl.nodes);
    s.view = { ctl, check, foot, body, answered: false };
    ctl.onChange = () => { check.disabled = !ctl.ready(); };
    if (e.type === "match") check.style.visibility = "hidden";      // a match exercise ends by itself
    overlay.replaceChildren(lessonFrame(body, foot));
    ctl.focus?.();
  }

  function submit() {
    const s = ui.session;
    if (!s || !s.view) return;
    const v = s.view;
    if (v.answered || !v.ctl.ready()) return;
    v.answered = true;
    feedback(v.ctl.check());
  }

  function feedback(result) {
    const s = ui.session;
    const v = s.view;
    v.answered = true;
    const e = s.current.e;
    const ok = result.correct;
    if (ok) {
      s.done += 1;
      Sfx.right();
    } else {
      s.mistakes += 1;
      Core.loseHeart(state, now());
      persist();
      Sfx.wrong();
      if (e.type !== "match") s.queue.push({ e });
    }
    refresh();
    const title = ok ? pick(PRAISE) : "Leider falsch";
    const outOfHearts = !ok && !s.spec.practice && state.hearts === 0;
    const detail = ok ? null : h("div", {}, result.answerText ? h("p", {}, "Richtig: ", rich(result.answerText)) : null, e.explain ? h("p", {}, rich(e.explain)) : null);
    const cont = h("button", { class: "btn", type: "button", onclick: () => { Sfx.tap(); outOfHearts ? noHearts() : nextExercise(); } }, "Weiter");
    v.foot.className = `l-foot ${ok ? "right" : "bad"}`;
    v.foot.replaceChildren(h("div", { class: "inner" }, h("div", { class: "fb" }, h("div", { class: "ic" }, icon(ok ? "check" : "close")), h("div", {}, h("h3", {}, title), detail)), cont));
    cont.focus();
    v.cont = cont;
    document.querySelector(".l-bar > i")?.style.setProperty("width", `${Math.round((100 * s.done) / s.total)}%`);
    document.querySelector(".l-hearts")?.replaceWith(s.spec.practice ? document.createComment("") : heartsView());
    if (!ok) { v.body.classList.add("shake"); setTimeout(() => v.body.classList.remove("shake"), 400); }
  }

  function noHearts() {
    ui.session = null;
    overlay.replaceChildren();
    render();
    heartsInfo();
  }

  // --------------------------------------------------------- exercise types
  function buildExercise(e) {
    const nodes = [];
    const isExpr = e.prompt.length <= 24 && EXPR.test(e.prompt);
    nodes.push(h("h1", { class: `ex-title${isExpr ? " expr" : ""}` }, rich(e.prompt)));
    if (e.visual) nodes.push(h("div", { class: "visual" }, drawVisual(e.visual)));
    const build = { choice: choiceView, input: inputView, match: matchView, build: tilesView }[e.type];
    const ctl = build(e, nodes);
    ctl.nodes = nodes;
    return ctl;
  }

  function choiceView(e, nodes) {
    let selected = null;
    let locked = false;
    const short = e.options.every((o) => o.length <= 9);
    const buttons = e.options.map((text, i) => h("button", { class: "opt", type: "button", onclick: () => choose(i) }, h("span", { class: "key" }, String(i + 1)), h("span", {}, rich(text))));
    const ctl = { ready: () => selected !== null, onChange() {} };
    function choose(i) {
      if (locked) return;
      selected = i;
      buttons.forEach((b, j) => b.classList.toggle("sel", j === i));
      Sfx.tap();
      ctl.onChange();
    }
    ctl.check = () => {
      locked = true;
      buttons.forEach((b, j) => { b.disabled = true; b.classList.remove("sel"); if (j === e.answer) b.classList.add("right"); else if (j === selected) b.classList.add("bad"); });
      return { correct: selected === e.answer, answerText: e.options[e.answer] };
    };
    ctl.key = (event) => {
      const n = Number(event.key);
      if (n >= 1 && n <= buttons.length) { choose(n - 1); return true; }
      return false;
    };
    nodes.push(h("div", { class: `opts${short ? " two" : ""}` }, buttons));
    return ctl;
  }

  function inputView(e, nodes) {
    let text = "";
    let locked = false;
    const prefix = e.unit && e.unit.endsWith("=") ? e.unit : "";
    const suffix = e.unit && !prefix ? e.unit : "";
    const box = h("div", { class: "ans", "aria-live": "polite" });
    const ctl = { ready: () => Number.isFinite(Core.parseNumber(text)), onChange() {} };
    function show() {
      box.replaceChildren(...[prefix ? h("span", { class: "u" }, prefix) : null, text ? h("span", {}, text) : null, locked ? null : h("span", { class: "caret" }), suffix ? h("span", { class: "u" }, suffix) : null].filter(Boolean));
      ctl.onChange();
    }
    function press(key) {
      if (locked) return;
      Sfx.tap();
      if (key === "back") text = text.slice(0, -1);
      else if (key === "−") { if (!text) text = "−"; else if (text === "−") text = ""; }
      else if (key === ",") { if (text && text !== "−" && !text.includes(",")) text += ","; }
      else if (/^\d$/.test(key) && text.length < 8) text += key;
      show();
    }
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "−", "0", ","].map((k) => h("button", { class: "key-btn", type: "button", onclick: () => press(k), "aria-label": k === "," ? "Komma" : k === "−" ? "Minus" : k }, k));
    const back = h("button", { class: "key-btn wide", type: "button", onclick: () => press("back"), style: "grid-column:1 / -1", "aria-label": "Löschen" }, "Löschen");
    ctl.check = () => {
      locked = true;
      const correct = Core.answersMatch(e.answer, text);
      box.classList.add(correct ? "right" : "bad");
      show();
      return { correct, answerText: `${e.answer}${suffix ? " " + suffix : ""}` };
    };
    ctl.key = (event) => {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === "," || event.key === ".") press(",");
      else if (event.key === "-" || event.key === "−") press("−");
      else if (event.key === "Backspace") press("back");
      else return false;
      return true;
    };
    show();
    nodes.push(box, h("div", { class: "keypad" }, keys, back));
    return ctl;
  }

  function matchView(e, nodes) {
    const lefts = e.pairs.map((p) => p[0]);
    const rights = shuffle(e.pairs.map((p) => p[1]));
    const matched = new Set();
    let left = null;
    let right = null;
    let hurt = false;
    const ctl = { ready: () => false, onChange() {} };
    const leftButtons = lefts.map((text, i) => h("button", { class: "tile", type: "button", onclick: () => { Sfx.tap(); left = i; paint(); tryPair(); } }, rich(text)));
    const rightButtons = rights.map((text, i) => h("button", { class: "tile", type: "button", onclick: () => { Sfx.tap(); right = i; paint(); tryPair(); } }, rich(text)));
    function paint() {
      leftButtons.forEach((b, i) => b.classList.toggle("sel", left === i));
      rightButtons.forEach((b, i) => b.classList.toggle("sel", right === i));
    }
    function tryPair() {
      if (left === null || right === null) return;
      const l = left;
      const r = right;
      left = right = null;
      if (e.pairs[l][1] === rights[r]) {
        matched.add(l);
        leftButtons[l].classList.remove("sel");
        leftButtons[l].classList.add("done");
        rightButtons[r].classList.remove("sel");
        rightButtons[r].classList.add("done");
        Sfx.right();
        if (matched.size === lefts.length) setTimeout(complete, 250);
        return;
      }
      for (const b of [leftButtons[l], rightButtons[r]]) { b.classList.remove("sel"); b.classList.add("wrong"); setTimeout(() => b.classList.remove("wrong"), 400); }
      Sfx.wrong();
      if (!hurt) {
        hurt = true;
        ui.session.mistakes += 1;
        Core.loseHeart(state, now());
        persist();
        document.querySelector(".l-hearts")?.replaceWith(ui.session.spec.practice ? document.createComment("") : heartsView());
      }
    }
    nodes.push(h("div", { class: "tiles" }, h("div", { class: "col-t" }, leftButtons), h("div", { class: "col-t" }, rightButtons)));
    // A match exercise ends by itself; a slip costs one heart (once) but the exercise is not repeated.
    function complete() {
      const s = ui.session;
      if (!s || !s.view || s.view.answered) return;
      s.done += 1;
      s.view.answered = true;
      Sfx.right();
      refresh();
      const cont = h("button", { class: "btn", type: "button", onclick: () => { Sfx.tap(); !s.spec.practice && state.hearts === 0 && hurt ? noHearts() : nextExercise(); } }, "Weiter");
      s.view.foot.className = "l-foot right";
      s.view.foot.replaceChildren(h("div", { class: "inner" }, h("div", { class: "fb" }, h("div", { class: "ic" }, icon("check")), h("div", {}, h("h3", {}, pick(PRAISE)))), cont));
      cont.focus();
      s.view.cont = cont;
      document.querySelector(".l-bar > i")?.style.setProperty("width", `${Math.round((100 * s.done) / s.total)}%`);
    }
    return ctl;
  }

  function tilesView(e, nodes) {
    const chosen = [];
    const tokens = e.tokens.map((text, i) => ({ text, i, used: false }));
    const slots = h("div", { class: "slots" });
    const bank = h("div", { class: "bank" });
    const ctl = { ready: () => chosen.length === e.answer.length, onChange() {} };
    function paint() {
      slots.replaceChildren(...(chosen.length ? chosen.map((t) => h("button", { class: "token", type: "button", onclick: () => { t.used = false; chosen.splice(chosen.indexOf(t), 1); Sfx.tap(); paint(); } }, rich(t.text))) : [h("span", { class: "hint" }, "Tippe die Kärtchen in der richtigen Reihenfolge an.")]));
      bank.replaceChildren(...tokens.map((t) => h("button", { class: `token${t.used ? " used" : ""}`, type: "button", onclick: () => { t.used = true; chosen.push(t); Sfx.tap(); paint(); } }, rich(t.text))));
      ctl.onChange();
    }
    ctl.check = () => {
      slots.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      bank.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      return { correct: Core.sameOrder(e.answer, chosen.map((t) => t.text)), answerText: e.answer.join(",  ") };
    };
    paint();
    nodes.push(slots, bank);
    return ctl;
  }

  // ---------------------------------------------------------------- visuals
  const NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...children) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, value);
    for (const child of children) if (child) el.append(child);
    return el;
  }

  function arc(cx, cy, r, from, to) {
    const point = (a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    return `M${cx} ${cy} L${point(from)} A${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${point(to)} Z`;
  }

  function drawVisual(v) {
    const blue = "var(--blue)";
    const line = "var(--line-d)";
    if (v.kind === "dots" || v.kind === "array") {
      const rows = v.kind === "array" ? v.rows : Math.ceil(v.n / 5);
      const cols = v.kind === "array" ? v.cols : Math.min(5, v.n);
      const circles = [];
      for (let i = 0; i < (v.kind === "array" ? rows * cols : v.n); i++) {
        circles.push(svg("circle", { cx: 20 + (i % cols) * 34, cy: 20 + Math.floor(i / cols) * 34, r: 13, fill: blue }));
      }
      return svg("svg", { viewBox: `0 0 ${cols * 34 + 6} ${rows * 34 + 6}`, width: cols * 34 + 6, height: rows * 34 + 6, role: "img", "aria-label": "Punkte" }, ...circles);
    }
    if (v.kind === "pie") {
      const parts = [];
      for (let i = 0; i < v.den; i++) {
        const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / v.den;
        const a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / v.den;
        parts.push(svg("path", { d: arc(70, 70, 64, a0, a1 - (v.den === 1 ? 0.001 : 0)), fill: i < v.num ? blue : "var(--bg)", stroke: "var(--bg)", "stroke-width": 3 }));
      }
      return svg("svg", { viewBox: "0 0 140 140", width: 160, height: 160, role: "img", "aria-label": "Kreis in gleiche Teile" }, svg("circle", { cx: 70, cy: 70, r: 66, fill: "none", stroke: line, "stroke-width": 3 }), ...parts);
    }
    if (v.kind === "bar") {
      const w = 280 / v.den;
      const cells = [];
      for (let i = 0; i < v.den; i++) cells.push(svg("rect", { x: 4 + i * w, y: 4, width: w, height: 56, fill: i < v.num ? blue : "var(--bg)", stroke: line, "stroke-width": 3 }));
      return svg("svg", { viewBox: "0 0 288 64", width: 288, height: 64, role: "img", "aria-label": "Streifen in gleiche Teile" }, ...cells);
    }
    const text = (x, y, str, anchor = "middle") => svg("text", { x, y, "text-anchor": anchor, "font-size": 18, "font-weight": 900, fill: "var(--text)", "font-family": "Nunito, sans-serif" }, document.createTextNode(str));
    if (v.kind === "rect") {
      const scale = Math.min(230 / v.w, 130 / v.h);
      const w = v.w * scale;
      const h2 = v.h * scale;
      return svg("svg", { viewBox: "0 0 300 190", width: 300, height: 190, role: "img", "aria-label": `Rechteck ${v.w} mal ${v.h}` },
        svg("rect", { x: 20, y: 34, width: w, height: h2, rx: 6, fill: "var(--blue-l)", stroke: blue, "stroke-width": 4 }),
        text(20 + w / 2, 24, `${v.w} cm`), text(28 + w, 34 + h2 / 2 + 6, `${v.h} cm`, "start"));
    }
    const scale = Math.min(230 / v.base, 130 / v.height);
    const b = v.base * scale;
    const t = v.height * scale;
    return svg("svg", { viewBox: "0 0 300 200", width: 300, height: 200, role: "img", "aria-label": `Dreieck mit Grundseite ${v.base} und Höhe ${v.height}` },
      svg("path", { d: `M20 ${30 + t} L${20 + b} ${30 + t} L${20 + b * 0.35} 30 Z`, fill: "var(--blue-l)", stroke: blue, "stroke-width": 4, "stroke-linejoin": "round" }),
      svg("path", { d: `M${20 + b * 0.35} 30 L${20 + b * 0.35} ${30 + t}`, stroke: line, "stroke-width": 3, "stroke-dasharray": "6 6" }),
      text(20 + b / 2, 54 + t, `Grundseite ${v.base} cm`), text(26 + b * 0.35, 30 + t / 2, `${v.height} cm`, "start"));
  }

  // ----------------------------------------------------------------- finish
  function finish() {
    const s = ui.session;
    const seconds = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const input = { correct: s.total, mistakes: s.mistakes };
    const result = s.spec.practice ? Core.completePractice(state, input, now()) : Core.completeLesson(state, s.spec.id, input, now());
    let unitDone = null;
    if (!s.spec.practice) {
      const after = Core.unitProgress(UNITS, state, Core.unitOf(s.spec.id));
      if (s.unitBefore.done < s.unitBefore.total && after.done === after.total) unitDone = UNITS.find((u) => u.id === Core.unitOf(s.spec.id));
    }
    persist();
    ui.session = null;
    Sfx.finish();
    const week = Core.lastDays(state, now(), 7);
    const note = (kind, iconName, title, text, extra) => h("div", { class: `note ${kind}` }, icon(iconName), h("div", {}, h("h3", {}, title), text ? h("p", {}, text) : null, extra));
    const notes = [
      unitDone ? note("unit", "trophy", `Einheit ${unitDone.id} geschafft!`, `Du hast „${unitDone.title}“ abgeschlossen.`) : null,
      result.streakExtended ? note("streak", "flame", `${result.streak} ${result.streak === 1 ? "Tag" : "Tage"} in Folge!`, "Komm morgen wieder, damit deine Streak weiterwächst.",
        h("div", { class: "daydots" }, week.map((d) => h("span", { class: d.xp ? "on" : "" }, d.label[0])))) : null,
      result.goalReached ? note("goal", "target", "Tagesziel geschafft!", `Du hast heute ${state.goal} XP gesammelt.`) : null,
      result.heartWon ? note("heart", "heart", "Ein Herz zurück!", "Gut geübt. Jetzt hast du wieder ein Herz mehr.") : null,
    ];
    const res = (cls, title, iconName, value) => h("div", { class: `res ${cls}` }, h("div", { class: "t" }, title), h("div", { class: "v" }, icon(iconName), value));
    const done = () => { overlay.replaceChildren(); ui.scrolled = false; render(); };
    overlay.replaceChildren(h("div", { class: "screen" },
      h("div", { class: "body" }, mascotEl("cheer", "big bounce"), h("h1", {}, s.spec.practice ? "Übung geschafft!" : "Lektion geschafft!"),
        h("div", { class: "results" }, res("xp", "XP", "bolt", `+${result.xp}`), res("acc", "Genauigkeit", "target", `${result.accuracy} %`), res("time", "Zeit", "clock", time)),
        notes),
      h("div", { class: "foot" }, h("div", { class: "inner" }, h("button", { class: "btn btn-primary btn-block", type: "button", onclick: done }, "Weiter")))));
    confetti();
    overlay.querySelector(".foot .btn")?.focus();
  }

  function confetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = h("canvas", { class: "confetti", "aria-hidden": "true" });
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    const resize = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
    resize();
    const colors = ["#1cb0f6", "#84d8ff", "#ffc800", "#ff86d0", "#ce82ff", "#ff9600", "#ffffff"];
    const bits = Array.from({ length: 130 }, () => ({ x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height * 0.5, w: 6 + Math.random() * 8, h: 8 + Math.random() * 10, vx: -2 + Math.random() * 4, vy: 2 + Math.random() * 4, a: Math.random() * 6, va: -0.2 + Math.random() * 0.4, c: pick(colors) }));
    const end = Date.now() + 2800;
    (function frame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.a += b.va; b.vy += 0.04;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (Date.now() < end) requestAnimationFrame(frame); else canvas.remove();
    })();
  }

  // --------------------------------------------------------------- keyboard
  document.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Escape") {
      const back = document.querySelector(".modal-back");
      if (back) { back.remove(); return; }
      if (ui.openNode) { ui.openNode = null; render(); }
      return;
    }
    const s = ui.session;
    if (!s || !s.view || document.querySelector(".modal-back")) return;
    const v = s.view;
    if (event.key === "Enter") {
      event.preventDefault();
      if (v.answered) v.cont?.click(); else if (v.ctl.ready()) submit();
      return;
    }
    if (!v.answered && v.ctl.key && v.ctl.key(event)) event.preventDefault();
  });

  window.addEventListener("hashchange", () => {
    const next = location.hash.slice(1);
    if (["learn", "practice", "achievements", "profile"].includes(next) && next !== ui.screen && !ui.session) go(next);
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !ui.session) { refresh(); render(); } });

  render();
})();
