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
  const LINE = 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"';
  const BOLD = LINE.replace("2.6", "3.4");
  const FILL = 'fill="currentColor"';
  const ICON = {
    star: S('<path d="M12 2.6l2.8 5.9 6.4.9-4.7 4.5 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.9z"/>', 'fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"'),
    check: S('<path d="M5 12.5l4.6 4.6L19 7.4"/>', LINE.replace("2.6", "3.6")),
    close: S('<path d="M6 6l12 12M18 6L6 18"/>', LINE.replace("2.6", "3")),
    lock: S('<rect x="5" y="10.5" width="14" height="10" rx="3" fill="currentColor"/><path d="M8.2 10.5V8a3.8 3.8 0 017.6 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'),
    trophy: S('<path d="M7.5 3.5h9v5.500a4.500 4.500 0 01-9 0z" fill="currentColor"/><path d="M7.500 5.500H4.500V7c0 2 1.300 3.300 3 3.500M16.500 5.500h3V7c0 2-1.300 3.300-3 3.500M12 13.500v4M9.500 17.500h5M8.500 20.500h7" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/>'),
    flame: S('<path d="M12 2.500c.4 3-1.600 4.400-3.100 6.200C7.500 10.400 6.500 12 6.500 14.300a5.500 5.500 0 0011 0c0-2-.9-3.400-1.800-4.400-.3 1.100-1 1.900-1.900 2.200.4-3-.2-6.600-1.900-9.600z"/>', FILL),
    heart: S('<path d="M12 20.600s-7.600-4.600-9.700-9.300C.8 7.900 3 4.200 6.600 4.200c2 0 3.500 1 5.400 3 1.900-2 3.400-3 5.400-3 3.600 0 5.800 3.700 4.300 7.100-2.100 4.700-9.700 9.300-9.700 9.300z"/>', FILL),
    bolt: S('<path d="M13.500 2L4.500 13.500H10L9 22l9.500-12H13z"/>', FILL),
    plus: S('<path d="M12 5v14M5 12h14"/>', BOLD),
    minus: S('<path d="M5 12h14"/>', BOLD),
    plusminus: S('<path d="M12 4v9M7.500 8.500h9M7 20h10"/>', LINE.replace("2.6", "3.2")),
    times: S('<path d="M6 6l12 12M18 6L6 18"/>', BOLD),
    divide: S('<path d="M5 12h14"/><circle cx="12" cy="5.600" r="1.800" fill="currentColor" stroke="none"/><circle cx="12" cy="18.400" r="1.800" fill="currentColor" stroke="none"/>', LINE.replace("2.6", "3.2")),
    pie: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><path d="M12 12V3.500A8.500 8.500 0 0120.500 12z"/>', FILL),
    decimal: S('<text x="12" y="17" font-size="13" font-weight="900" text-anchor="middle" fill="currentColor" font-family="Nunito, sans-serif">0,5</text>'),
    percent: S('<path d="M18.500 5.500l-13 13" fill="none" stroke="currentColor" stroke-width="2.800" stroke-linecap="round"/><circle cx="7" cy="7" r="2.800" fill="currentColor"/><circle cx="17" cy="17" r="2.800" fill="currentColor"/>'),
    x: S('<text x="12" y="18" font-size="19" font-weight="900" text-anchor="middle" fill="currentColor" font-family="Nunito, sans-serif">x</text>'),
    ruler: S('<rect x="2.500" y="8" width="19" height="8" rx="2" transform="rotate(-35 12 12)" fill="currentColor"/><path d="M8 10.600l1.500 1.200M11 8.500l1 1.400M14 6.400l1.500 1.200" stroke="#fff" stroke-width="1.300" stroke-linecap="round" opacity=".8"/>'),
    book: S('<path d="M12 6.500C10.500 5 8 4.500 4.500 4.800V18c3.500-.3 6 .2 7.500 1.700 1.500-1.500 4-2 7.500-1.700V4.800C16 4.500 13.500 5 12 6.500z"/><path d="M12 6.500v13"/>', LINE),
    home: S('<path d="M3.500 11.200L12 3.800l8.500 7.400M5.800 9.800V20h12.400V9.800"/><path d="M10 20v-5h4v5"/>', LINE),
    dumbbell: S('<path d="M6.500 8v8M17.500 8v8M3.500 10v4M20.500 10v4M6.500 12h11"/>', LINE),
    medal: S('<circle cx="12" cy="14.500" r="5.500"/><path d="M8.500 3l3.500 6 3.500-6" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round" stroke-linejoin="round"/>', FILL),
    crown: S('<path d="M3.500 8.500l4.500 4 4-7 4 7 4.500-4-1.600 10H5.100z"/>', FILL),
    shield: S('<path d="M12 3l7.500 2.800v5.700c0 4.600-3.100 8.100-7.500 9.700-4.400-1.600-7.500-5.100-7.500-9.700V5.800z"/><path d="M8.500 12l2.600 2.600 4.600-5"/>', LINE),
    user: S('<circle cx="12" cy="8" r="4"/><path d="M4.500 20.500c.8-4 3.700-6 7.500-6s6.700 2 7.500 6"/>', LINE),
    sound: S('<path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" fill="currentColor"/><path d="M15.500 9a4 4 0 010 6M18 6.500a7.500 7.500 0 010 11" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    mute: S('<path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" fill="currentColor"/><path d="M16 9.500l5 5M21 9.500l-5 5" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round"/>'),
    target: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><circle cx="12" cy="12" r="4.500" fill="none" stroke="currentColor" stroke-width="2.600"/><circle cx="12" cy="12" r="1.500" fill="currentColor"/>'),
    clock: S('<circle cx="12" cy="12" r="8.500" fill="none" stroke="currentColor" stroke-width="2.600"/><path d="M12 7v5.500l3.500 2" fill="none" stroke="currentColor" stroke-width="2.600" stroke-linecap="round"/>'),
    arrow: S('<path d="M12 5v13M6.500 12.500L12 18l5.500-5.500"/>', LINE),
    /* The app's emblem: a monkey face on a blue tile (the same drawing as the app icons). */
    logo: S('<rect x="1.500" y="1.500" width="21" height="21" rx="6.500" fill="#1cb0f6"/><circle cx="6" cy="11.200" r="2.700" fill="#fff"/><circle cx="18" cy="11.200" r="2.700" fill="#fff"/><circle cx="12" cy="12.400" r="6.400" fill="#fff"/><ellipse cx="12" cy="14.200" rx="4.200" ry="3.600" fill="#cdeeff"/><circle cx="9.900" cy="11.200" r="1" fill="#1f3a4d"/><circle cx="14.100" cy="11.200" r="1" fill="#1f3a4d"/><path d="M10.200 15.700q1.800 1.500 3.600 0" fill="none" stroke="#1f3a4d" stroke-width="1" stroke-linecap="round"/>'),
  };

  /* Gomi, the maths monkey: original artwork (brown fur, blue shirt with a plus). Moods: happy, cheer, sad. */
  function mascot(mood = "happy") {
    const fur = "#8a5a3b";
    const skin = "#f6d2ad";
    const ink = "#2b1d14";
    const shirt = "#1cb0f6";
    const raised = mood === "cheer";
    const arms = raised
      ? `<ellipse cx="25" cy="70" rx="8" ry="14" transform="rotate(-32 25 70)" fill="${fur}"/><ellipse cx="95" cy="70" rx="8" ry="14" transform="rotate(32 95 70)" fill="${fur}"/>
         <circle cx="17" cy="58" r="7" fill="${skin}"/><circle cx="103" cy="58" r="7" fill="${skin}"/>`
      : `<ellipse cx="31" cy="95" rx="8" ry="13" transform="rotate(14 31 95)" fill="${fur}"/><ellipse cx="89" cy="95" rx="8" ry="13" transform="rotate(-14 89 95)" fill="${fur}"/>
         <circle cx="27" cy="106" r="6.500" fill="${skin}"/><circle cx="93" cy="106" r="6.500" fill="${skin}"/>`;
    const eyes = raised
      ? `<path d="M43 51q6-8 12 0M65 51q6-8 12 0" fill="none" stroke="${ink}" stroke-width="3.600" stroke-linecap="round"/>`
      : `<circle cx="49" cy="50" r="5.500" fill="${ink}"/><circle cx="71" cy="50" r="5.500" fill="${ink}"/><circle cx="50.800" cy="48.200" r="2" fill="#fff"/><circle cx="72.800" cy="48.200" r="2" fill="#fff"/>`;
    const brows = mood === "sad" ? `<path d="M41 44l13-4M79 44l-13-4" stroke="${ink}" stroke-width="3.200" stroke-linecap="round"/>` : "";
    const tear = mood === "sad" ? '<path d="M40 58c-3 4-3 7 0 8 3-1 3-4 0-8z" fill="#7fd3ff"/>' : "";
    const mouth = {
      happy: `<path d="M50 74q10 8 20 0" fill="none" stroke="${ink}" stroke-width="3.400" stroke-linecap="round"/>`,
      cheer: `<path d="M47 72q13 20 26 0z" fill="${ink}"/><path d="M53 81q7-5 14 0q-7 5-14 0z" fill="#ff7a8a"/>`,
      sad: `<path d="M51 80q9-8 18 0" fill="none" stroke="${ink}" stroke-width="3.400" stroke-linecap="round"/>`,
    }[mood] || "";
    return `<svg viewBox="0 0 120 120" aria-hidden="true">
      <ellipse cx="60" cy="116" rx="30" ry="4" fill="#000" opacity=".12"/>
      <path d="M84 104c24 5 28-20 15-27" fill="none" stroke="${fur}" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="47" cy="112" rx="10" ry="5" fill="${skin}"/><ellipse cx="73" cy="112" rx="10" ry="5" fill="${skin}"/>
      ${arms}
      <path d="M34 93q0-13 13-13h26q13 0 13 13v13q0 6-6 6H40q-6 0-6-6z" fill="${shirt}"/>
      <path d="M34 104h52v2q0 6-6 6H40q-6 0-6-6z" fill="#1899d6"/>
      <path d="M60 89v14M53 96h14" stroke="#fff" stroke-width="3.400" stroke-linecap="round"/>
      <path d="M55 20q1-11 10-10" fill="none" stroke="${fur}" stroke-width="5" stroke-linecap="round"/>
      <circle cx="27" cy="50" r="12" fill="${fur}"/><circle cx="93" cy="50" r="12" fill="${fur}"/>
      <circle cx="27" cy="50" r="7" fill="#e9a97f"/><circle cx="93" cy="50" r="7" fill="#e9a97f"/>
      <circle cx="60" cy="50" r="33" fill="${fur}"/>
      <circle cx="49" cy="53" r="17" fill="${skin}"/><circle cx="71" cy="53" r="17" fill="${skin}"/><ellipse cx="60" cy="68" rx="21" ry="15" fill="${skin}"/>
      <ellipse cx="60" cy="71" rx="13" ry="9" fill="#ffe6cf"/>
      <circle cx="38" cy="66" r="4.500" fill="#ff9aa8" opacity=".5"/><circle cx="82" cy="66" r="4.500" fill="#ff9aa8" opacity=".5"/>
      ${eyes}${brows}${tear}
      <circle cx="56" cy="66" r="1.600" fill="${ink}"/><circle cx="64" cy="66" r="1.600" fill="${ink}"/>
      ${mouth}
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

  function showOverlay(node) {
    overlay.replaceChildren(node);
    root.inert = true;
  }

  function clearOverlay() {
    overlay.replaceChildren();
    root.inert = false;
  }

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
    const opener = document.activeElement;
    const close = () => { back.remove(); if (opener && opener.isConnected) opener.focus(); };
    back.addEventListener("keydown", (event) => {      // Tab stays inside the dialog
      if (event.key !== "Tab") return;
      const items = [...back.querySelectorAll("button:not([disabled])")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
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
    ui.fade = true;
    render();
    ui.fade = false;
    window.scrollTo(0, 0);
  }

  function navItem(item) {
    return h("button", { class: `navitem${ui.screen === item.id ? " on" : ""}`, type: "button", "aria-label": item.label, "aria-current": ui.screen === item.id ? "page" : null, onclick: () => go(item.id) },
      icon(item.icon), h("span", { class: "label" }, item.label));
  }

  function chips() {
    const streakOn = Core.streakActiveToday(state, now());
    return [
      h("button", { class: `chip streak${streakOn ? "" : " dim"}`, type: "button", "aria-label": `${state.streak} Tage in Folge`, onclick: () => toast(streakOn ? `Deine Serie: ${state.streak} ${state.streak === 1 ? "Tag" : "Tage"} in Folge. Weiter so!` : "Schaffe heute eine Lektion, damit deine Serie nicht abreißt.") }, icon("flame"), String(state.streak)),
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
      "Jeden Tag ein bisschen üben bringt mehr als einmal ganz viel.",
      "Fehler sind in Ordnung: Aus ihnen lernst du am meisten.",
      "Rechne erst im Kopf und tippe dann. Das trainiert dein Gedächtnis!",
      "Das Einmaleins sitzt am besten, wenn du es jeden Tag kurz wiederholst.",
      "Bei Textaufgaben hilft eine Frage: Was ist gesucht?",
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
      h("main", { class: "main", id: "main", tabindex: "-1" },
        h("div", { class: "topbar" }, h("span", { class: "brand" }, "gomat"), h("div", { class: "chips" }, chips())),
        h("div", { class: `col${ui.fade ? " fade" : ""}` }, pages[ui.screen]())),
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
        ? h("div", { class: "pop locked-pop" }, h("h3", {}, lesson.title), h("p", {}, "Schließe zuerst die vorherigen Lektionen ab."), h("button", { class: "btn btn-block", type: "button", disabled: true }, "Gesperrt"))
        : h("div", { class: "pop" }, h("h3", {}, lesson.title),
          h("p", {}, lesson.test ? "Zeig, was du in dieser Einheit gelernt hast." : `Lektion ${number} von ${unit.lessons.length - 1}`),
          h("button", { class: "btn btn-block", type: "button", onclick: () => startLesson(lesson.id) }, status === "done" ? "Wiederholen" : `Start +${Core.XP_LESSON} XP`)));
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
    const end = current === null ? h("div", { class: "course-end" }, mascotEl("cheer", "bounce"), h("h2", {}, "Du hast alles geschafft!"), h("p", {}, "Wiederhole Lektionen oder übe gemischt, damit alles sitzt.")) : null;
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
        document.body.append(h("button", { class: "jump", type: "button", onclick: () => { target.scrollIntoView({ behavior: "smooth", block: "center" }); } }, icon("arrow"), "Zur nächsten Lektion"));
      }
    });
    jumpObserver.observe(target);
  }

  // ---------------------------------------------------------------- practice
  function practicePage() {
    const current = Core.currentLessonId(UNITS, state);
    const maxUnit = current ? Core.unitOf(current) : UNITS.length;
    return h("div", {}, h("h1", { class: "page-title" }, "Üben"),
      h("p", { class: "page-sub" }, "Gemischte Aufgaben aus allem, was du schon gelernt hast. Fehler kosten hier kein Herz."),
      h("div", { class: "hero" }, mascotEl("happy"),
        h("div", {}, h("h2", {}, "Gemischte Übung"), h("p", {}, `10 Aufgaben aus ${maxUnit === 1 ? "Einheit 1" : `den Einheiten 1 bis ${maxUnit}`}. Mit mindestens 80 % richtig bekommst du ein Herz zurück.`),
          h("button", { class: "btn", type: "button", onclick: () => startPractice(maxUnit) }, `Start +${Core.XP_PRACTICE} XP`))),
      h("div", { class: "card", style: "margin-top:16px" }, h("div", { class: "row" }, h("h3", {}, "Deine Herzen"), h("div", { class: "chip hearts" }, icon("heart"), `${state.hearts} / ${Core.MAX_HEARTS}`)),
        h("p", { style: "margin:6px 0 0;color:var(--muted)" }, heartsText())));
  }

  function heartsText() {
    const wait = Core.heartsEta(state, now());
    return wait === null
      ? "Alle Herzen sind voll. Pro Fehler in einer Lektion verlierst du eins."
      : `Das nächste Herz bekommst du in etwa ${Core.formatWait(wait)} zurück. Alle 20 Minuten kommt eins dazu.`;
  }

  function heartsInfo() {
    refresh();
    modal({ mood: state.hearts === 0 ? "sad" : "happy", title: state.hearts === 0 ? "Keine Herzen mehr" : `${state.hearts} von ${Core.MAX_HEARTS} Herzen`, text: heartsText(),
      buttons: [{ label: "Üben und Herz verdienen", kind: "btn-primary", run: () => go("practice") }, { label: "Verstanden" }] });
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
        h("div", {}, h("h2", {}, "Mathe-Fan"), h("p", { style: "margin:4px 0 0;color:var(--muted)" }, `${Core.flatten(UNITS).filter((l) => Core.isDone(state, l.id)).length} von ${Core.flatten(UNITS).length} Lektionen geschafft`))),
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
        h("div", { class: "setting" }, h("div", {}, h("div", {}, "Fortschritt zurücksetzen"), h("small", { style: "color:var(--muted)" }, "Löscht alle Daten in diesem Browser.")),
          h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: confirmReset }, "Zurücksetzen"))),
      h("p", { style: "color:var(--muted);font-size:14px;margin-top:16px" }, "Dein Fortschritt wird nur in diesem Browser gespeichert. Es gibt keine Konten und keine Cookies."),
      h("div", { class: "links" }, h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum")));
  }

  function confirmReset() {
    modal({ mood: "sad", title: "Wirklich alles löschen?", text: "Dein Fortschritt, deine XP und deine Serie gehen unwiderruflich verloren.",
      buttons: [{ label: "Nein, behalten", kind: "btn-primary" }, { label: "Ja, zurücksetzen", kind: "btn-danger", run: () => { state = Core.defaultState(now()); persist(); ui.onb = { step: 0, level: 1, goal: 20 }; go("learn"); } }] });
  }

  // -------------------------------------------------------------- onboarding
  function onboarding() {
    const o = ui.onb;
    const next = () => { o.step += 1; render(); };
    const dots = h("div", { class: "dots" }, [0, 1, 2].map((i) => h("i", { class: i <= o.step ? "on" : "" })));
    const screens = [
      () => ({ mood: "cheer", speech: "Hallo, ich bin Gomi, dein Mathe-Affe!", title: "Mathe lernen mit gomat", text: "Kurze Lektionen, kleine Erfolge und jeden Tag ein Stück besser rechnen.", body: null, action: h("button", { class: "btn btn-primary btn-block", type: "button", onclick: next }, "Los geht’s") }),
      () => ({ mood: "happy", speech: "Wo sollen wir anfangen?", title: "Wie gut kannst du schon rechnen?", text: null,
        body: h("div", { class: "options" }, [
          [1, "Ich fange ganz neu an", "Zahlen bis 20"], [2, "Ich kann schon bis 20 rechnen", "Rechnen bis 100"], [3, "Ich kann schon bis 100 rechnen", "Das Einmaleins"],
          [5, "Malnehmen und Teilen kann ich schon", "Brüche"], [7, "Ich kann schon deutlich mehr", "Negative Zahlen und Rechenregeln"],
        ].map(([unit, label, small]) => h("button", { class: `opt${o.level === unit ? " sel" : ""}`, type: "button", onclick: () => { o.level = unit; render(); } }, h("span", {}, label, h("small", {}, `Start bei: ${small}`))))),
        action: h("button", { class: "btn btn-primary btn-block", type: "button", onclick: next }, "Weiter") }),
      () => ({ mood: "happy", speech: "Jeden Tag ein bisschen!", title: "Wie viel möchtest du täglich üben?", text: null,
        body: h("div", { class: "options" }, [[10, "Entspannt", "10 XP, etwa eine Lektion"], [20, "Normal", "20 XP, etwa zwei Lektionen"], [30, "Ehrgeizig", "30 XP, etwa drei Lektionen"], [50, "Intensiv", "50 XP, etwa fünf Lektionen"]]
          .map(([goal, label, small]) => h("button", { class: `opt${o.goal === goal ? " sel" : ""}`, type: "button", onclick: () => { o.goal = goal; render(); } }, h("span", {}, label, h("small", {}, small))))),
        action: h("button", { class: "btn btn-primary btn-block", type: "button", onclick: () => { state.onboarded = true; state.startUnit = o.level; state.goal = o.goal; persist(); ui.scrolled = false; render(); } }, "Lernen starten") }),
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
    showOverlay(h("div", { class: "lesson" }, h("div", { class: "loading", style: "flex:1" }, mascotEl("happy"), h("div", {}, "Einen Moment …"))));
    let exercises;
    try {
      const response = await fetch(spec.url, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.exercises) || !data.exercises.length) throw new Error("bad answer");
      exercises = data.exercises;
    } catch (error) {
      clearOverlay();
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
    modal({ mood: "sad", title: "Willst du wirklich aufhören?", text: "Wenn du jetzt aufhörst, geht dein Fortschritt in dieser Lektion verloren.",
      buttons: [{ label: "Weiterlernen", kind: "btn-primary" }, { label: "Aufhören", kind: "btn-secondary", run: () => { ui.session = null; clearOverlay(); render(); } }] });
  }

  function drawExercise() {
    const s = ui.session;
    const e = s.current.e;
    const ctl = buildExercise(e);
    const check = h("button", { class: "btn btn-primary", type: "button", disabled: true, onclick: () => submit() }, "Prüfen");
    const foot = h("div", { class: "l-foot", "aria-live": "polite" }, h("div", { class: "inner" }, h("span", {}), check));
    const body = h("div", { class: "l-body" }, ctl.nodes);
    s.view = { ctl, check, foot, body, answered: false };
    ctl.onChange = () => { check.disabled = !ctl.ready(); };
    if (e.type === "match") check.style.visibility = "hidden";      // a match exercise ends by itself
    showOverlay(lessonFrame(body, foot));
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
    const title = ok ? pick(PRAISE) : "Nicht ganz";
    const outOfHearts = !ok && !s.spec.practice && state.hearts === 0;
    const detail = ok ? null : h("div", {}, result.answerText ? h("p", {}, "Richtige Lösung: ", rich(result.answerText)) : null, e.explain ? h("p", {}, rich(e.explain)) : null);
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
    clearOverlay();
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
      result.streakExtended ? note("streak", "flame", `${result.streak} ${result.streak === 1 ? "Tag" : "Tage"} in Folge!`, "Komm morgen wieder, damit deine Serie weiterwächst.",
        h("div", { class: "daydots" }, week.map((d) => h("span", { class: d.xp ? "on" : "" }, d.label[0])))) : null,
      result.goalReached ? note("goal", "target", "Tagesziel geschafft!", `Du hast heute ${state.goal} XP gesammelt.`) : null,
      result.heartWon ? note("heart", "heart", "Ein Herz zurück!", "Gut geübt! Du hast ein Herz zurückbekommen.") : null,
    ];
    const res = (cls, title, iconName, value) => h("div", { class: `res ${cls}` }, h("div", { class: "t" }, title), h("div", { class: "v" }, icon(iconName), value));
    const done = () => { clearOverlay(); ui.scrolled = false; render(); };
    showOverlay(h("div", { class: "screen", role: "dialog", "aria-modal": "true", "aria-label": "Ergebnis" },
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
