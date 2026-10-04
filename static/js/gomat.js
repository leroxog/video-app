/* gomat: the screens. The rules (progress, XP, gems, streak, hearts, answer checking) are in gomat-core.js, the
   pictures and characters in gomat-art.js, the sounds in gomat-sound.js, the account calls in gomat-account.js;
   the exercises come from the server (/api/gomat/...). Text from the server is put on the page with textContent and DOM nodes only. The only
   innerHTML is for our own fixed SVG pictures (the characters from gomat-art.js). */
(() => {
  "use strict";

  const Core = window.GomatCore;
  const Art = window.GomatArt;
  const Sound = window.GomatSound || { play() {}, setEnabled() {} };
  const Account = window.GomatAccount;
  const DATA = JSON.parse(document.getElementById("gomatData").textContent);
  const UNITS = DATA.units;
  const PASS_MISTAKES = DATA.passMistakes;
  const root = document.getElementById("app");
  const overlay = document.createElement("div");
  document.body.append(overlay);
  const REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ---------------------------------------------------------------- helpers
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key === "style") el.style.cssText = value;
      else if (key === "snd") el.dataset.snd = value;
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

  const icon = (name) => Art.icon(name);

  function characterEl(name, mood = "happy", cls = "", scene = "") {
    const holder = document.createElement("div");
    holder.className = `char ${cls}`.trim();
    holder.dataset.who = name;
    holder.innerHTML = Art.character(name, mood, scene);
    return holder;
  }

  function portraitEl(name, mood = "happy", cls = "") {
    const holder = document.createElement("span");
    holder.className = `portrait ${cls}`.trim();
    holder.innerHTML = Art.portrait(name, mood);
    return holder;
  }

  function chestEl() {
    const holder = document.createElement("button");
    holder.type = "button";
    holder.className = "chest-wrap";
    holder.innerHTML = Art.chest();
    return holder;
  }

  const castName = (name) => (Art.CAST[name] || Art.CAST.gomi).name;

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
  const plural = (n, one, many) => (n === 1 ? one : many);

  /* A number that counts up to its new value (with a "+" in front or a "%" behind it if asked). */
  function countUp(el, from, to, prefix = "", suffix = "") {
    const show = (n) => { el.textContent = `${prefix}${n}${suffix}`; };
    if (REDUCED || from === to) { show(to); return; }
    const start = performance.now();
    const length = 650;
    (function frame(time) {
      const t = Math.min(1, (time - start) / length);
      show(Math.round(from + (to - from) * (1 - Math.pow(1 - t, 3))));
      if (t < 1 && el.isConnected) requestAnimationFrame(frame);
      else show(to);
    })(start);
    setTimeout(() => show(to), length + 150);       // a page in a background tab does not animate: it still ends on the right number
  }

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

  const SCREENS = ["learn", "practice", "achievements", "profile"];
  const store = openStorage();
  let state = Core.load(store, now());
  const freezeUsed = state.freezeUsed || 0;
  if (freezeUsed) Core.save(store, state);           // the protection is used up for good, not again on every visit

  // ------------------------------------------------------- the account and saving
  /* What the page knows about the account: who is signed in, which version of the progress the server has (rev) and
     whether something has not been saved yet (dirty). Without an account none of this does anything. */
  const sync = { user: null, rev: 0, dirty: false, version: 0, saving: false, timer: null, status: "off" };
  const SYNC_TEXT = { saved: "Gespeichert", saving: "Wird gespeichert …", error: "Nicht gespeichert (offline)", off: "" };

  function paintSync(el) {
    el.className = `sync ${sync.status}`;
    el.replaceChildren(icon("cloud"), SYNC_TEXT[sync.status] || "");
  }

  function setSyncStatus(status) {
    sync.status = status;
    for (const el of document.querySelectorAll(".sync")) paintSync(el);
  }

  function syncBadge() {
    const el = h("span", { class: "sync", role: "status" });
    paintSync(el);
    return el;
  }

  function markDirty() {
    sync.dirty = true;
    sync.version += 1;
    Account.writeMeta(store, { email: sync.user.email, rev: sync.rev, dirty: true });
    setSyncStatus("saving");
  }

  function markSaved(rev) {
    sync.rev = rev;
    sync.dirty = false;
    Account.writeMeta(store, { email: sync.user.email, rev, dirty: false });
    setSyncStatus("saved");
  }

  /* Keeps the progress in the browser and, with an account, sends it to the server a moment later. */
  function persist() {
    Core.save(store, state);
    if (sync.user) {
      markDirty();
      clearTimeout(sync.timer);
      sync.timer = setTimeout(() => saveNow(false), 1200);
    }
  }

  /* Sends the progress to the account. True when the server has it. */
  async function saveNow(keepalive) {
    clearTimeout(sync.timer);
    if (!sync.user || !sync.dirty) return true;
    if (sync.saving) return false;
    sync.saving = true;
    const version = sync.version;
    const reply = await Account.save(JSON.parse(JSON.stringify(state)), sync.rev, keepalive);
    sync.saving = false;
    if (reply.ok) {
      if (sync.version === version) { markSaved(reply.data.rev); return true; }
      sync.rev = reply.data.rev;                       // changed again while saving: save once more
      Account.writeMeta(store, { email: sync.user.email, rev: sync.rev, dirty: true });
      sync.timer = setTimeout(() => saveNow(false), 300);
      return false;
    }
    if (reply.status === 401) {                        // the sign-in is over (cookie gone, or the password was changed elsewhere)
      sync.user = null;
      setSyncStatus("off");
      toast("Du wurdest abgemeldet. Melde dich wieder an, damit dein Fortschritt gespeichert wird.");
      if (state.onboarded && !ui.session && !overlay.firstChild) render();
      return false;
    }
    if (reply.status === 409 && reply.data.state) {    // another device saved first
      await meetRemote(reply.data.state, reply.data.rev);
      return false;
    }
    setSyncStatus("error");
    sync.timer = setTimeout(() => saveNow(false), 30000);
    return false;
  }

  /* The account has progress, too: keep the device's, take the account's, or let the learner choose. */
  async function meetRemote(remoteRaw, remoteRev) {
    const remote = remoteRaw ? Core.sanitize(remoteRaw, now()) : null;
    const verdict = Core.reconcile({ local: state, remote, remoteRev, meta: Account.readMeta(store), email: sync.user.email });
    if (verdict === "remote") adoptRemote(remote, remoteRev);
    else if (verdict === "local") { sync.rev = remoteRev; markDirty(); saveNow(false); }
    else askWhichProgress(remote, remoteRev);
  }

  function adoptRemote(remote, rev) {
    state = remote;
    const used = Core.rollover(state, now());
    Core.regenHearts(state, now());
    Core.save(store, state);
    Sound.setEnabled(state.sound);
    sync.rev = rev;
    sync.dirty = false;
    Account.writeMeta(store, { email: sync.user.email, rev, dirty: false });
    setSyncStatus("saved");
    ui.seen = null;
    ui.scrolled = false;
    if (!ui.session) renderFresh();
    if (used) { persist(); toast("Dein Serien-Schutz hat deine Serie gerettet."); }
  }

  function askWhichProgress(remote, remoteRev) {
    const lessonsDone = (progress) => Core.flatten(UNITS).filter((l) => Core.isDone(progress, l.id)).length;
    const summary = (progress) => `${progress.xp} XP, ${lessonsDone(progress)} Lektionen`;
    const better = Core.progressScore(remote) > Core.progressScore(state) ? "remote" : "local";
    modal({
      mood: "happy", sticky: true, title: "Welchen Fortschritt behalten?",
      text: "Auf diesem Gerät und in deinem Konto gibt es unterschiedlichen Fortschritt. Du kannst nur einen behalten.",
      buttons: [
        { label: `Konto: ${summary(remote)}`, kind: better === "remote" ? "btn-primary" : "btn-secondary", run: () => adoptRemote(remote, remoteRev) },
        { label: `Dieses Gerät: ${summary(state)}`, kind: better === "local" ? "btn-primary" : "btn-secondary", run: () => { sync.rev = remoteRev; markDirty(); saveNow(false); toast("Der Fortschritt von diesem Gerät ist jetzt in deinem Konto."); } },
      ],
    });
  }

  /* When the page opens: is somebody signed in? Then compare the account's progress with the device's. */
  async function bootAccount() {
    const reply = await Account.me();
    if (!reply.ok || !reply.data.user) return;
    sync.user = reply.data.user;
    sync.rev = reply.data.rev;
    setSyncStatus(Account.readMeta(store) && Account.readMeta(store).dirty ? "saving" : "saved");
    await meetRemote(reply.data.state, reply.data.rev);
    if (!ui.session && !overlay.firstChild && !document.querySelector(".modal-back")) render();
    if (sync.dirty) saveNow(false);
  }

  /* Leaves the account on this device: the device forgets the progress (it stays in the account). */
  function forgetDevice() {
    try { store.removeItem(Core.STORAGE_KEY); } catch (error) { /* nothing to remove */ }
    Account.writeMeta(store, null);
    sync.user = null;
    sync.dirty = false;
    sync.rev = 0;
    setSyncStatus("off");
    state = Core.defaultState(now());
    Sound.setEnabled(true);
    ui.onb = freshOnboarding();
    ui.seen = null;
    ui.screen = "learn";
    history.replaceState(null, "", "#learn");
    clearOverlay();
    render();
  }

  const freshOnboarding = () => ({ landing: !sync.user, step: 0, self: null, grade: null, goal: 20, placement: null, startUnit: null });
  const ui = { screen: location.hash.slice(1) || "learn", openNode: null, onb: freshOnboarding(), session: null, scrolled: false, seen: null, fresh: null };
  if (!SCREENS.includes(ui.screen)) ui.screen = "learn";

  function refresh() {
    Core.rollover(state, now());
    Core.regenHearts(state, now());
  }

  // ------------------------------------------------------------------ sounds
  Sound.setEnabled(state.sound);
  const sfx = (name) => { if (state.sound) Sound.play(name); };

  /* Every button makes a small sound; a button can ask for another one (data-snd) or for none ("none"). */
  document.addEventListener("click", (event) => {
    const button = event.target.closest && event.target.closest("button, a.btn, a.navitem");
    if (!button || button.disabled) return;
    const name = button.dataset.snd;
    if (name !== "none") sfx(name || "tap");
  }, true);

  /* Cards tilt a little towards the pointer (not on touch screens and not with reduced motion). */
  if (!REDUCED) {
    document.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch") return;
      const el = event.target.closest && event.target.closest(".tilt");
      if (!el) return;
      const box = el.getBoundingClientRect();
      el.style.setProperty("--ry", `${((event.clientX - box.left) / box.width - 0.5) * 10}deg`);
      el.style.setProperty("--rx", `${(0.5 - (event.clientY - box.top) / box.height) * 8}deg`);
    });
    document.addEventListener("pointerout", (event) => {
      const el = event.target.closest && event.target.closest(".tilt");
      if (el && !el.contains(event.relatedTarget)) { el.style.removeProperty("--rx"); el.style.removeProperty("--ry"); }
    });
  }

  function showOverlay(node) {
    overlay.replaceChildren(node);
    root.inert = true;
    document.body.classList.add("has-overlay");
  }

  function clearOverlay() {
    overlay.replaceChildren();
    root.inert = false;
    document.body.classList.remove("has-overlay");
  }

  // ------------------------------------------------- the characters come alive
  /* What each companion says: after a right answer, after a wrong one, and when somebody pokes them. */
  const LINES = {
    gomi: { right: ["Ooh-ooh, richtig!", "Bananastark!", "Super gemacht!", "Du bist ein Mathe-Affe!", "Perfekt!"], wrong: ["Nicht ganz", "Ups, das war knifflig!", "Nicht ganz, aber gleich!"], poke: ["Ooh-ooh!", "Hihi!", "Hast du Bananen?", "Kitzelt!"] },
    otto: { right: ["Wunderbar!", "Sehr schön gemacht!", "Das hast du fein gemacht!", "Genau so, weiter so!", "Richtig, richtig!"], wrong: ["Nicht ganz, das kennt jeder.", "Nicht ganz, aber Übung macht klug.", "Nicht ganz, wir haben Zeit."], poke: ["Na sowas!", "Hehe, das kitzelt!", "Ich lese gerade …", "Hast du Tee dabei?"] },
    ben: { right: ["Yes! Mega!", "Läuft bei dir!", "Stark, weiter so!", "Easy!", "Boom, richtig!"], wrong: ["Nicht ganz, passiert den Besten.", "Nicht ganz, nächster Versuch!", "Nicht ganz, Kopf hoch!"], poke: ["Hey!", "Was geht?", "Los, weiter!", "Ball gefällig?"] },
    robi: { right: ["Berechnung korrekt!", "Ergebnis: perfekt.", "Bip bop, richtig!", "Fehlerfrei erkannt!", "Systeme jubeln!"], wrong: ["Nicht ganz: neu berechnen!", "Nicht ganz. Bip …", "Nicht ganz: Neuer Versuch gestartet."], poke: ["Bip!", "Bzzzt!", "Alle Systeme laufen.", "Antenne kitzelt!"] },
  };

  /* A click on a character makes it jump and say something. */
  function poke(svg) {
    const holder = svg.parentElement;
    const who = [...svg.classList].map((name) => name.replace("ch-", "")).find((name) => LINES[name]) || "gomi";
    svg.classList.remove("poked");
    void svg.getBoundingClientRect();
    svg.classList.add("poked");
    setTimeout(() => svg.classList.remove("poked"), 700);
    sfx("poke");
    holder.querySelector(".say")?.remove();
    const bubble = h("div", { class: "say" }, pick(LINES[who].poke));
    holder.append(bubble);
    setTimeout(() => bubble.remove(), 1900);
  }

  document.addEventListener("click", (event) => {
    const svg = event.target.closest && event.target.closest(".char .ch");
    if (svg && !svg.closest("button")) poke(svg);
  });

  /* Their eyes follow the pointer (or the finger). */
  function lookAt(x, y) {
    for (const svg of document.querySelectorAll(".ch")) {
      const box = svg.getBoundingClientRect();
      if (!box.width || box.bottom < 0 || box.top > innerHeight) continue;
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height * 0.4);
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, distance / 160);
      svg.style.setProperty("--lx", ((dx / distance) * reach).toFixed(2));
      svg.style.setProperty("--ly", ((dy / distance) * reach).toFixed(2));
    }
  }

  if (!REDUCED) {
    let waiting = false;
    let spot = null;
    const follow = (x, y) => {
      spot = { x, y };
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(() => { waiting = false; lookAt(spot.x, spot.y); });
    };
    document.addEventListener("pointermove", (event) => follow(event.clientX, event.clientY));
    document.addEventListener("touchstart", (event) => { const t = event.touches[0]; if (t) follow(t.clientX, t.clientY); }, { passive: true });
  }

  /* Gems fly from a spot to the gem counter in the top bar. */
  function flyGems(from, count) {
    const target = document.querySelector('[data-stat="gems"]');
    if (!target || REDUCED) return;
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const startX = a.left + a.width / 2;
    const startY = a.top + a.height / 3;
    for (let i = 0; i < count; i++) {
      const gem = h("div", { class: "flygem", "aria-hidden": "true" }, icon("gem"));
      gem.style.left = `${startX - 14}px`;
      gem.style.top = `${startY - 14}px`;
      document.body.append(gem);
      const spread = (Math.random() - 0.5) * 140;
      const animation = gem.animate([
        { transform: "translate(0, 0) scale(.5)", opacity: 0 },
        { transform: `translate(${spread}px, -70px) scale(1.1)`, opacity: 1, offset: 0.3 },
        { transform: `translate(${b.left + b.width / 2 - startX}px, ${b.top + b.height / 2 - startY}px) scale(.6)`, opacity: 0.9 },
      ], { duration: 900 + i * 60, delay: i * 70, easing: "cubic-bezier(.5, 0, .3, 1)", fill: "both" });
      animation.onfinish = () => gem.remove();
      setTimeout(() => gem.remove(), 2800);
    }
  }

  // ------------------------------------------------------------------ toast
  let toastTimer = null;
  function toast(message) {
    document.querySelector(".toast")?.remove();
    const el = h("div", { class: "toast", role: "status" }, message);
    document.body.append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2800);
  }

  // ---------------------------------------------------------------- dialogs
  let closeTop = null;

  /* A dialog over the page. `sticky` ones cannot be dismissed by a click beside them or by Escape (the learner must choose). */
  function openDialog(box, label, sticky) {
    const back = h("div", { class: "modal-back", role: "dialog", "aria-modal": "true", "aria-label": label });
    const opener = document.activeElement;
    const close = () => {
      back.remove();
      if (closeTop === close) closeTop = null;
      if (opener && opener.isConnected) opener.focus();
    };
    back.addEventListener("keydown", (event) => {      // Tab stays inside the dialog
      if (event.key !== "Tab") return;
      const items = [...back.querySelectorAll("button:not([disabled])")];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    back.append(box);
    if (!sticky) back.addEventListener("click", (event) => { if (event.target === back) close(); });
    document.body.append(back);
    closeTop = sticky ? null : close;
    sfx("open");
    box.querySelector("button:not([disabled])")?.focus();
    return close;
  }

  function modal({ mood, who, title, text, body, buttons, sticky }) {
    let close;
    const box = h("div", { class: "modal" },
      mood ? characterEl(who || state.companion, mood, "m-char") : null,
      h("h2", {}, title), text ? h("p", {}, text) : null, body || null,
      h("div", { class: "btns" }, buttons.map((b) => h("button", { class: `btn ${b.kind || "btn-secondary"} btn-block`, type: "button", disabled: b.disabled, snd: "none", onclick: () => { sfx("close"); if (!b.stay) close(); if (b.run) b.run(); } }, b.label))));
    close = openDialog(box, title, sticky);
    return close;
  }

  /* A dialog with one or more input fields (for the password changes). `run` gets the values and answers with an
     error text, or nothing when it worked. */
  function formDialog({ title, text, fields, submit, danger, run }) {
    const inputs = fields.map((f) => h("input", { type: "password", name: f.name, placeholder: f.placeholder, autocomplete: f.autocomplete, maxlength: "200", "aria-label": f.placeholder }));
    const error = h("p", { class: "auth-error", role: "alert" });
    const go = h("button", { class: `btn ${danger ? "btn-danger" : "btn-primary"} btn-block`, type: "submit", disabled: true, snd: "none" }, submit);
    let close;
    const update = () => { go.disabled = inputs.some((input) => !input.value); };
    inputs.forEach((input) => input.addEventListener("input", update));
    const box = h("form", { class: "modal", novalidate: true, onsubmit: async (event) => {
      event.preventDefault();
      if (go.disabled) return;
      go.disabled = true;
      error.textContent = "";
      const problem = await run(inputs.map((input) => input.value));
      if (problem) { error.textContent = problem; sfx("deny"); update(); return; }
      close();
    } },
    h("h2", {}, title), text ? h("p", {}, text) : null,
    h("div", { class: "field-group" }, inputs.map((input) => h("label", { class: "field" }, input))), error,
    h("div", { class: "btns" }, go, h("button", { class: "btn btn-secondary btn-block", type: "button", onclick: () => close() }, "Abbrechen")));
    close = openDialog(box, title);
    inputs[0].focus();
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
    renderFresh();
    window.scrollTo(0, 0);
  }

  function navItem(item) {
    return h("button", { class: `navitem${ui.screen === item.id ? " on" : ""}`, type: "button", snd: "nav", "aria-label": item.label, "aria-current": ui.screen === item.id ? "page" : null, onclick: () => go(item.id) },
      icon(item.icon), h("span", { class: "label" }, item.label));
  }

  function gradeLabel() {
    if (state.grade === 0) return "Vorschule";
    if (state.grade === 99) return "Schulende";
    return state.grade ? `Klasse ${state.grade}` : "Mathe";
  }

  function chip(kind, iconName, value, label, onclick, dim) {
    return h("button", { class: `chip ${kind}${dim ? " dim" : ""}`, type: "button", "data-stat": kind, "aria-label": label, snd: "none", onclick },
      icon(iconName), h("span", { class: "num" }, String(value)));
  }

  /* The bar at the top, always there: the course, the streak, the gems and the hearts. */
  function topbar() {
    const streakOn = Core.streakActiveToday(state, now());
    return h("header", { class: "topbar" }, h("div", { class: "topbar-in" },
      h("button", { class: "course", type: "button", snd: "nav", "aria-label": `Profil, ${gradeLabel()}`, onclick: () => go("profile") }, portraitEl(state.companion, "happy"), h("span", { class: "lbl" }, gradeLabel())),
      h("div", { class: "chips" },
        chip("streak", "flame", state.streak, `${state.streak} ${plural(state.streak, "Tag", "Tage")} in Folge`, streakInfo, !streakOn),
        chip("gems", "gem", state.gems, `${state.gems} Edelsteine`, shopModal, false),
        chip("hearts", "heart", state.hearts, `${state.hearts} Herzen`, heartsInfo, state.hearts === 0))));
  }

  /* Chips that changed since the last drawing pop (and the gems count up). */
  function popChanged() {
    const current = { streak: state.streak, gems: state.gems, hearts: state.hearts };
    if (ui.seen) {
      for (const key of Object.keys(current)) {
        if (current[key] === ui.seen[key]) continue;
        for (const el of document.querySelectorAll(`[data-stat="${key}"]`)) {
          el.classList.add("bump");
          const num = el.querySelector(".num");
          if (key === "gems" && current.gems > ui.seen.gems && num) countUp(num, ui.seen.gems, current.gems);
        }
      }
    }
    ui.seen = current;
  }

  function goalCard() {
    const pct = Math.min(100, Math.round((100 * state.xpToday) / state.goal));
    return h("div", { class: "card goal" }, h("h3", {}, "Tagesziel"),
      h("div", { class: "meta" }, h("span", {}, `${Math.min(state.xpToday, state.goal)} / ${state.goal} XP`), h("span", {}, pct >= 100 ? "Geschafft!" : "")),
      h("div", { class: "bar gold", style: `--w:${pct}%` }, h("i")));
  }

  function rail() {
    return h("aside", { class: "rail" },
      goalCard(),
      h("div", { class: "card tip" }, portraitEl(state.companion, "happy", "p-md"), h("div", {}, h("h3", {}, `Tipp von ${castName(state.companion)}`), h("p", {}, tipOfTheDay()))),
      h("div", { class: "links" }, h("a", { href: "/gomat-archiv/datenschutz" }, "Datenschutz"), h("a", { href: "/gomat-archiv/impressum" }, "Impressum")));
  }

  function tipOfTheDay() {
    const tips = [
      "Jeden Tag ein bisschen üben bringt mehr als einmal ganz viel.",
      "Fehler sind in Ordnung: Aus ihnen lernst du am meisten.",
      "Rechne erst im Kopf und tippe dann. Das trainiert dein Gedächtnis!",
      "Das Einmaleins sitzt am besten, wenn du es jeden Tag kurz wiederholst.",
      "Bei Textaufgaben hilft eine Frage: Was ist gesucht?",
      "Mit dem Meistertest kannst du eine ganze Einheit überspringen.",
    ];
    return tips[Math.floor(Date.now() / 86400000) % tips.length];
  }

  /* Draws the page with its entrance animations (cards and road come in one after the other). */
  function renderFresh() {
    ui.fade = true;
    render();
    ui.fade = false;
  }

  function render() {
    refresh();
    jumpObserver?.disconnect();
    document.querySelector(".jump")?.remove();
    root.replaceChildren();
    if (!state.onboarded) {
      root.append(onboarding());
      return;
    }
    const pages = { learn: learnPage, practice: practicePage, achievements: achievementsPage, profile: profilePage };
    root.append(h("div", { class: "shell" },
      h("nav", { class: "side", "aria-label": "Hauptmenü" }, h("a", { class: "logo", href: "/gomat-archiv", "aria-label": "gomat" }, icon("logo"), h("span", { class: "word" }, "gomat")), NAV.map(navItem)),
      h("main", { class: "main", id: "main", tabindex: "-1" },
        topbar(),
        h("div", { class: `col${ui.fade ? " fade" : ""}` }, pages[ui.screen]())),
      rail(),
      h("nav", { class: "bottomnav", "aria-label": "Hauptmenü" }, NAV.map(navItem))));
    popChanged();
    if (ui.screen === "learn") afterLearnRender();
  }

  // ------------------------------------------------- streak, shop and hearts
  function streakInfo() {
    refresh();
    const week = Core.lastDays(state, now(), 7);
    const days = plural(state.streak, "Tag", "Tage");
    const on = Core.streakActiveToday(state, now());
    const text = state.streak === 0
      ? "Schaffe heute eine Lektion, dann beginnt deine Serie."
      : on ? `Deine Serie: ${state.streak} ${days} in Folge. Weiter so!` : `Deine Serie: ${state.streak} ${days} in Folge. Schaffe heute eine Lektion, damit sie nicht abreißt.`;
    modal({
      title: `${state.streak} ${days} in Folge`, text,
      body: h("div", { class: "streak-body" },
        h("div", { class: `flame-big${on ? " on" : ""}` }, icon("flame")),
        h("div", { class: "daydots" }, week.map((d) => h("span", { class: d.xp ? "on" : "" }, d.label[0]))),
        h("p", { class: "freeze-line" }, icon("snow"), state.freezes > 0 ? `${state.freezes} ${plural(state.freezes, "Serien-Schutz", "Serien-Schütze")} bereit: Er rettet deine Serie, wenn du einen Tag verpasst.` : "Kein Serien-Schutz. Im Shop kannst du dir einen kaufen.")),
      buttons: [{ label: "Weiterlernen", kind: "btn-primary" }, { label: "Zum Shop", run: shopModal }],
    });
  }

  function shopModal() {
    let close;
    const box = h("div", { class: "modal shop" });

    function item(iconName, title, text, price, reason, buy) {
      return h("div", { class: `shop-item ${iconName}` },
        h("div", { class: "si-ic" }, icon(iconName)),
        h("div", { class: "si-t" }, h("h3", {}, title), h("p", {}, text)),
        h("button", { class: "btn btn-primary btn-sm", type: "button", snd: "none", disabled: !!reason || state.gems < price, onclick: buy }, reason || [String(price), icon("gem")]));
    }

    function fill() {
      refresh();
      box.replaceChildren(
        h("h2", {}, "Shop"),
        h("div", { class: "shop-gems" }, icon("gem"), h("span", {}, String(state.gems)), h("small", {}, "Edelsteine")),
        item("heart", "Herzen auffüllen", `Alle ${Core.MAX_HEARTS} Herzen sofort zurück. Du hast ${state.hearts}.`, Core.PRICES.hearts, state.hearts >= Core.MAX_HEARTS ? "Voll" : null, () => buy(Core.buyHearts(state, now()), "Herzen aufgefüllt.")),
        item("snow", "Serien-Schutz", `Rettet deine Serie an einem verpassten Tag. Du hast ${state.freezes} von ${Core.MAX_FREEZES}.`, Core.PRICES.freeze, state.freezes >= Core.MAX_FREEZES ? "Max." : null, () => buy(Core.buyFreeze(state), "Serien-Schutz gekauft.")),
        h("p", { class: "shop-note" }, `Edelsteine bekommst du für Lektionen (${Core.GEMS.lesson}), Meistertests (${Core.GEMS.test}) und dein Tagesziel (${Core.GEMS.goal}).`),
        h("button", { class: "btn btn-secondary btn-block", type: "button", onclick: () => close() }, "Schließen"));
      box.querySelector(".btn-secondary")?.focus();
    }

    function buy(result, message) {
      if (!result.ok) { sfx("deny"); return; }
      persist();
      sfx("buy");
      fill();
      render();
      toast(message);
    }

    fill();
    close = openDialog(box, "Shop");
  }

  function heartsText() {
    const wait = Core.heartsEta(state, now());
    return wait === null
      ? "Alle Herzen sind voll. Pro Fehler in einer Lektion verlierst du eins."
      : `Das nächste Herz bekommst du in etwa ${Core.formatWait(wait)} zurück. Alle 20 Minuten kommt eins dazu.`;
  }

  function heartsInfo() {
    refresh();
    const full = state.hearts >= Core.MAX_HEARTS;
    const poor = state.gems < Core.PRICES.hearts;
    modal({
      mood: state.hearts === 0 ? "sad" : "happy", title: state.hearts === 0 ? "Keine Herzen mehr" : `${state.hearts} von ${Core.MAX_HEARTS} Herzen`,
      text: heartsText(),
      buttons: [
        full ? null : { label: [`Für ${Core.PRICES.hearts} `, icon("gem"), " auffüllen"], kind: poor ? "btn-secondary" : "btn-primary", disabled: poor, run: () => { const r = Core.buyHearts(state, now()); if (r.ok) { persist(); sfx("buy"); render(); toast("Herzen aufgefüllt."); } } },
        { label: "Üben und Herz verdienen", kind: full || !poor ? "btn-secondary" : "btn-primary", run: () => go("practice") },
        { label: "Verstanden" },
      ].filter(Boolean),
    });
  }

  // ------------------------------------------------------------- learn path
  const OFFSETS = [0, 44, 72, 44, 0, -44, -72, -44];

  function lockedText(unit, lesson, index) {
    if (index === 0 && unit.id > 1) {
      const before = UNITS.find((u) => u.id === unit.id - 1);
      if (before && Core.currentLessonId(UNITS, state) === before.lessons[before.lessons.length - 1].id) return `Bestehe zuerst den Meistertest von Einheit ${before.id}.`;
    }
    return lesson.test ? "Schließe zuerst alle Lektionen dieser Einheit ab." : "Schließe zuerst die vorherigen Lektionen ab.";
  }

  function popCard(unit, lesson, index, status) {
    if (status === "locked") {
      return h("div", { class: "pop locked-pop" }, h("h3", {}, lesson.title), h("p", {}, lockedText(unit, lesson, index)), h("button", { class: "btn btn-block", type: "button", disabled: true }, "Gesperrt"));
    }
    const last = unit.id === UNITS.length;
    const text = lesson.test
      ? `Bestehe ihn mit höchstens ${PASS_MISTAKES} Fehlern, ${last ? "um den Kurs abzuschließen." : "um die nächste Einheit freizuschalten."}`
      : `Lektion ${index + 1} von ${unit.lessons.length - 1}`;
    return h("div", { class: "pop" }, h("h3", {}, lesson.title), h("p", {}, text),
      h("button", { class: "btn btn-block", type: "button", onclick: () => startLesson(lesson.id) }, status === "done" ? "Wiederholen" : `Start +${lesson.test ? Core.XP_TEST : Core.XP_LESSON} XP`));
  }

  function nodeButton(unit, lesson, index, order, withChest) {
    const status = Core.lessonStatus(UNITS, state, lesson.id);
    const number = index + 1;
    const label = lesson.test ? `${lesson.title} der Einheit ${unit.id}` : `Lektion ${number}: ${lesson.title}`;
    const kind = status === "locked" ? "lock" : lesson.test ? "trophy" : status === "done" ? "check" : lesson.icon;
    const stars = status === "done" ? Core.starsFor(state, lesson.id) : 0;
    const wrap = h("div", { class: `node-wrap${status === "done" ? " has-stars" : ""}${status === "current" ? " cur" : ""}`, style: `--dx: calc(${OFFSETS[index % OFFSETS.length]}px * var(--k, 1)); --i: ${order}`, "data-lesson": lesson.id },
      status === "current" ? h("div", { class: "bubble" }, state.hearts === 0 ? "Pause" : "Start") : null,
      h("button", { class: `node ${status}${lesson.test ? " test" : ""}`, type: "button", snd: "node", "aria-label": `${label}${status === "locked" ? " (gesperrt)" : status === "done" ? ` (geschafft, ${stars} von 3 Sternen)` : ""}`,
        onclick: (event) => { event.stopPropagation(); ui.openNode = ui.openNode === lesson.id ? null : lesson.id; render(); } },
        icon(kind)),
      status === "done" ? h("div", { class: "stars", "aria-hidden": "true" }, [1, 2, 3].map((n) => h("span", { class: n <= stars ? "on" : "", style: `--s:${n}` }, icon("star")))) : null);
    if (withChest) wrap.append(chestSide(index));
    if (ui.openNode === lesson.id) wrap.append(popCard(unit, lesson, index, status));
    return wrap;
  }

  /* The animals beside the path: each one is doing something (eating a banana, reading, playing ball, tinkering). */
  function sideChar(unit, nodes, position, who) {
    const node = nodes[position];
    if (!node) return;
    const side = OFFSETS[position % OFFSETS.length] > 0 ? "left" : "right";
    const done = Core.unitStatus(UNITS, state, unit.id) === "done";
    node.append(h("div", { class: `side-char ${side}`, "aria-hidden": "true" }, characterEl(who, done ? "cheer" : "happy", "", Art.CAST[who].scene)));
  }

  function learnPage() {
    const current = Core.currentLessonId(UNITS, state);
    const skippable = Core.skippableUnit(UNITS, state);
    let order = 0;
    const chest = Core.chestReady(state, now());
    const sections = UNITS.map((unit) => {
      const progress = Core.unitProgress(UNITS, state, unit.id);
      const lessonNodes = unit.lessons.map((lesson, index) => nodeButton(unit, lesson, index, order++, chest && lesson.id === current));
      const second = Core.COMPANIONS[(Core.COMPANIONS.indexOf(unit.character) + 1) % Core.COMPANIONS.length];
      sideChar(unit, lessonNodes, 1, unit.character);
      sideChar(unit, lessonNodes, Math.min(5, lessonNodes.length - 2), second);
      return h("section", { class: `unit${ui.fresh === unit.id ? " fresh" : ""}`, "data-color": unit.color, "aria-label": `Einheit ${unit.id}: ${unit.title}` },
        h("div", { class: "unit-banner" },
          h("div", { class: "ub-text" }, h("div", { class: "kicker" }, `Einheit ${unit.id}`), h("h2", {}, unit.title), h("p", {}, unit.desc)),
          h("div", { class: "ub-side" },
            h("div", { class: "count" }, `${progress.done}/${progress.total}`),
            skippable === unit.id ? h("button", { class: "skip-btn", type: "button", snd: "tap", onclick: () => confirmSkip(unit) }, icon("skip"), "Überspringen") : null)),
        h("div", { class: "path" }, lessonNodes));
    });
    const end = current === null ? h("div", { class: "course-end" }, characterEl(state.companion, "cheer", "big"), h("h2", {}, "Du hast alles geschafft!"), h("p", {}, "Wiederhole Lektionen oder übe gemischt, damit alles sitzt.")) : null;
    return h("div", { onclick: () => { if (ui.openNode) { ui.openNode = null; render(); } } }, current === null ? chestCard() : null, sections, end);
  }

  /* One chest a day with a few gems in it: it stands beside the lesson that is next (or, when the whole course is done, on top). */
  function chestSide(index) {
    const wrap = chestEl();
    wrap.classList.add("chest-side", OFFSETS[index % OFFSETS.length] >= 0 ? "right" : "left");
    wrap.setAttribute("aria-label", "Tagesgeschenk öffnen");
    wrap.dataset.snd = "none";
    wrap.append(h("span", { class: "chest-tag" }, "Geschenk"));
    wrap.addEventListener("click", (event) => { event.stopPropagation(); openChest(wrap); });
    return wrap;
  }

  function chestCard() {
    if (!Core.chestReady(state, now())) return null;
    const wrap = chestEl();
    wrap.setAttribute("aria-label", "Tagesgeschenk öffnen");
    wrap.dataset.snd = "none";
    const open = h("button", { class: "btn btn-gold btn-sm", type: "button", snd: "none" }, "Öffnen");
    const card = h("div", { class: "chest-card" }, wrap, h("div", {}, h("h3", {}, "Tagesgeschenk"), h("p", {}, "Heute wartet eine Kiste voller Edelsteine auf dich.")), open);
    wrap.addEventListener("click", () => openChest(wrap, card));
    open.addEventListener("click", () => openChest(wrap, card));
    return card;
  }

  function openChest(wrap, card) {
    if (wrap.classList.contains("open")) return;
    const gems = Core.claimChest(state, now(), Math.random());
    if (!gems) return;
    persist();
    wrap.classList.add("open");
    sfx("chest");
    const tag = wrap.querySelector(".chest-tag");
    if (tag) tag.textContent = `+${gems}`;
    if (card) {
      card.querySelector("h3").textContent = `+${gems} Edelsteine!`;
      card.querySelector("p").textContent = "Komm morgen wieder für das nächste Geschenk.";
      card.querySelector(".btn")?.remove();
    }
    flyGems(wrap, Math.min(10, gems));
    setTimeout(() => { sfx("gem"); render(); }, REDUCED ? 100 : 1500);
  }

  let jumpObserver = null;
  function afterLearnRender() {
    const target = document.querySelector(".node.current");
    jumpObserver?.disconnect();
    if (!target) return;
    if (!ui.scrolled) {
      ui.scrolled = true;
      target.scrollIntoView({ block: "center" });
    }
    jumpObserver = new IntersectionObserver(([entry]) => {
      document.querySelector(".jump")?.remove();
      if (!entry.isIntersecting && ui.screen === "learn" && !ui.session) {
        document.body.append(h("button", { class: "jump", type: "button", onclick: () => { target.scrollIntoView({ behavior: "smooth", block: "center" }); } }, icon("arrow"), "Zur nächsten Lektion"));
      }
    });
    jumpObserver.observe(target);
  }

  function confirmSkip(unit) {
    refresh();
    const testId = unit.lessons[unit.lessons.length - 1].id;
    modal({
      mood: "happy", who: unit.character, title: `Einheit ${unit.id} überspringen?`,
      text: `Mach den Meistertest sofort. Mit höchstens ${PASS_MISTAKES} Fehlern gilt die ganze Einheit als geschafft. Herzen verlierst du dabei nicht. Sonst lernst du ganz normal weiter.`,
      buttons: [{ label: "Meistertest starten", kind: "btn-primary", run: () => startLesson(testId, "skip") }, { label: "Abbrechen" }],
    });
  }

  // ---------------------------------------------------------------- practice
  function practicePage() {
    const current = Core.currentLessonId(UNITS, state);
    const maxUnit = current ? Core.unitOf(current) : UNITS.length;
    return h("div", {}, h("h1", { class: "page-title" }, "Üben"),
      h("p", { class: "page-sub" }, "Gemischte Aufgaben aus allem, was du schon gelernt hast. Fehler kosten hier kein Herz."),
      h("div", { class: "hero tilt" }, characterEl(state.companion, "happy", "hero-char"),
        h("div", {}, h("h2", {}, "Gemischte Übung"), h("p", {}, `10 Aufgaben aus ${maxUnit === 1 ? "Einheit 1" : `den Einheiten 1 bis ${maxUnit}`}. Mit mindestens 80 % richtig bekommst du ein Herz zurück.`),
          h("button", { class: "btn", type: "button", onclick: () => startPractice(maxUnit) }, `Start +${Core.XP_PRACTICE} XP`))),
      h("div", { class: "card", style: "margin-top:16px" }, h("div", { class: "row" }, h("h3", {}, "Deine Herzen"), h("div", { class: "chip hearts static" }, icon("heart"), h("span", { class: "num" }, `${state.hearts} / ${Core.MAX_HEARTS}`))),
        h("p", { style: "margin:6px 0 0;color:var(--muted)" }, heartsText())));
  }

  // ------------------------------------------------------------ achievements
  function achievementsPage() {
    const list = Core.achievements(UNITS, state);
    const done = list.filter((a) => a.unlocked).length;
    return h("div", {}, h("h1", { class: "page-title" }, "Erfolge"), h("p", { class: "page-sub" }, `${done} von ${list.length} geschafft`),
      h("div", { class: "stack" }, list.map((a) => h("div", { class: `ach tilt${a.unlocked ? " on" : ""}` }, h("div", { class: "badge" }, icon(a.icon)),
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
    const lessons = Core.flatten(UNITS);
    const stat = (iconName, value, label, color) => h("div", { class: "statcard tilt" }, h("div", { class: "v", style: `color:${color}` }, icon(iconName), String(value)), h("div", { class: "k" }, label));
    const who = Art.CAST[state.companion];
    return h("div", {}, h("h1", { class: "page-title" }, "Dein Profil"),
      accountCard(),
      h("div", { class: "card me", style: "margin-top:16px" }, characterEl(state.companion, "happy", "me-char"),
        h("div", {}, h("h2", {}, "Mathe-Fan"), h("p", { style: "margin:4px 0 0;color:var(--muted)" }, `${lessons.filter((l) => Core.isDone(state, l.id)).length} von ${lessons.length} Lektionen geschafft`),
          h("p", { style: "margin:2px 0 0;color:var(--muted)" }, `${gradeLabel()} · ${who.name} begleitet dich`))),
      h("h2", { class: "page-title", style: "font-size:20px" }, "Dein Begleiter"),
      h("div", { class: "cast", role: "group", "aria-label": "Begleiter wählen" }, Core.COMPANIONS.map((name) => h("button", { class: `cast-b tilt${state.companion === name ? " on" : ""}`, type: "button", snd: "select", "aria-pressed": String(state.companion === name),
        onclick: () => { state.companion = name; persist(); render(); } },
        characterEl(name, "happy", "cast-char"), h("b", {}, Art.CAST[name].name), h("small", {}, Art.CAST[name].role)))),
      h("h2", { class: "page-title", style: "font-size:20px" }, "Statistik"),
      h("div", { class: "grid2" },
        stat("flame", state.streak, "Tage in Folge", "var(--orange)"), stat("gem", state.gems, "Edelsteine", "var(--blue-t)"),
        stat("bolt", state.xp, "XP gesamt", "var(--gold-d)"), stat("target", `${accuracy} %`, "Genauigkeit", "var(--blue)"),
        stat("crown", state.stats.perfect, "Fehlerfreie Lektionen", "var(--gold-d)"), stat("trophy", state.stats.testsPassed, "Meistertests bestanden", "var(--gold-d)"),
        stat("flame", state.bestStreak, "Längste Serie", "var(--orange)"), stat("book", state.stats.lessons + state.stats.practice, "Lektionen und Übungen", "var(--blue)")),
      h("h2", { class: "page-title", style: "font-size:20px" }, "Diese Woche"),
      h("div", { class: "card" }, h("div", { class: "week" }, week.map((d, i) => h("div", { class: `d${d.xp ? " on" : ""}${i === 6 ? " today" : ""}` }, d.xp ? String(d.xp) : "", h("i", { style: `--h:${Math.max(6, Math.round((88 * d.xp) / top))}px` }), d.label)))),
      h("h2", { class: "page-title", style: "font-size:20px" }, "Einstellungen"),
      h("div", { class: "card" },
        h("div", { class: "setting", style: "flex-direction:column;align-items:stretch" }, h("div", {}, "Tagesziel"),
          h("div", { class: "seg" }, Core.GOALS.map((g) => h("button", { class: g === state.goal ? "on" : "", type: "button", onclick: () => { state.goal = g; persist(); render(); } }, `${g} XP`)))),
        h("div", { class: "setting" }, h("div", {}, "Töne"), h("button", { class: "switch", type: "button", role: "switch", snd: "none", "aria-checked": String(state.sound), "aria-label": "Töne", onclick: () => { state.sound = !state.sound; Sound.setEnabled(state.sound); persist(); render(); sfx("right"); } })),
        h("div", { class: "setting" }, h("div", {}, h("div", {}, "Sprechaufgaben"), h("small", { style: "color:var(--muted)" }, speakingNote())),
          Core.canSpeakNow(state, now()) ? null : h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => { state.noSpeakUntil = 0; persist(); render(); toast("Sprechaufgaben sind wieder an."); } }, "Wieder an")),
        h("div", { class: "setting" }, h("div", {}, h("div", {}, "Fortschritt zurücksetzen"), h("small", { style: "color:var(--muted)" }, sync.user ? "Setzt den Fortschritt in diesem Browser und in deinem Konto zurück." : "Löscht alle Daten in diesem Browser.")),
          h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: confirmReset }, "Zurücksetzen"))),
      h("p", { style: "color:var(--muted);font-size:14px;margin-top:16px" }, sync.user ? "Dein Fortschritt wird in deinem Konto gespeichert und ist auf jedem Gerät da." : "Ohne Konto wird dein Fortschritt nur in diesem Browser gespeichert. Mit einem Konto geht er nicht verloren."),
      h("div", { class: "links" }, h("a", { href: "/gomat-archiv/datenschutz" }, "Datenschutz"), h("a", { href: "/gomat-archiv/impressum" }, "Impressum")));
  }

  function speakingNote() {
    if (!speechApi()) return "Dein Browser kann nicht zuhören. Es gibt nur Aufgaben zum Tippen.";
    return Core.canSpeakNow(state, now()) ? "Manche Aufgaben sprichst du ins Mikrofon." : "Gerade aus: Du hattest gesagt, dass du nicht sprechen kannst.";
  }

  function confirmReset() {
    modal({ mood: "sad", title: "Wirklich alles löschen?", text: sync.user ? "Dein Fortschritt, deine XP, deine Edelsteine und deine Serie gehen auf diesem Gerät und in deinem Konto unwiderruflich verloren." : "Dein Fortschritt, deine XP, deine Edelsteine und deine Serie gehen unwiderruflich verloren.",
      buttons: [{ label: "Nein, behalten", kind: "btn-primary" }, { label: "Ja, zurücksetzen", kind: "btn-danger", run: () => { state = Core.defaultState(now()); persist(); ui.onb = freshOnboarding(); ui.seen = null; go("learn"); } }] });
  }

  // ---------------------------------------------------------------- the account
  const AUTH_ERRORS = {
    bad_email: "Das sieht nicht wie eine E-Mail-Adresse aus.",
    bad_password: "Das Passwort braucht mindestens 8 Zeichen.",
    email_taken: "Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.",
    wrong_login: "E-Mail oder Passwort stimmt nicht.",
    wrong_password: "Das Passwort stimmt nicht.",
    too_many: "Zu viele Versuche. Bitte warte ein paar Minuten.",
    network: "Keine Verbindung. Prüfe dein Internet und versuche es noch einmal.",
  };
  const authError = (reply) => AUTH_ERRORS[reply.data && reply.data.error] || "Das hat nicht geklappt. Bitte versuche es noch einmal.";

  function accountCard() {
    const button = (label, kind, iconName, run) => h("button", { class: `btn ${kind} btn-sm`, type: "button", onclick: run }, iconName ? icon(iconName) : null, label);
    if (sync.user) {
      return h("div", { class: "card" },
        h("div", { class: "acct" }, portraitEl(state.companion, "happy"), h("div", {}, h("h2", {}, sync.user.name), h("small", {}, sync.user.email), syncBadge())),
        h("div", { class: "acct-btns" }, button("Passwort ändern", "btn-secondary", "lock", changePasswordDialog), button("Abmelden", "btn-secondary", "logout", confirmLogout)),
        h("div", { class: "acct-btns" }, button("Konto löschen", "btn-ghost", "trash", deleteAccountDialog)));
    }
    return h("div", { class: "card save-prompt" }, icon("cloud"),
      h("div", {}, h("h3", {}, "Fortschritt sichern"), h("p", {}, "Mit einem kostenlosen Konto ist dein Fortschritt auf jedem Gerät da und geht nicht verloren."),
        h("div", { class: "acct-btns" }, button("Konto erstellen", "btn-primary", null, () => showAuth("signup", false)), button("Anmelden", "btn-secondary", null, () => showAuth("login", false)))));
  }

  function confirmLogout() {
    modal({
      mood: "happy", title: "Abmelden?", text: "Dein Fortschritt bleibt in deinem Konto gespeichert. Auf diesem Gerät wird er entfernt.",
      buttons: [
        { label: "Abmelden", kind: "btn-danger", run: async () => {
          const saved = await saveNow(false);
          if (!saved && sync.dirty) {
            modal({ mood: "sad", title: "Nicht alles gespeichert", text: "Dein letzter Fortschritt konnte nicht in dein Konto gespeichert werden (kein Internet?). Wenn du dich jetzt abmeldest, geht er verloren.",
              buttons: [{ label: "Angemeldet bleiben", kind: "btn-primary" }, { label: "Trotzdem abmelden", kind: "btn-danger", run: async () => { await Account.logout(); forgetDevice(); } }] });
            return;
          }
          await Account.logout();
          forgetDevice();
          toast("Du bist abgemeldet. Bis bald!");
        } },
        { label: "Abbrechen" },
      ],
    });
  }

  function changePasswordDialog() {
    formDialog({
      title: "Passwort ändern", text: "Auf allen anderen Geräten musst du dich danach neu anmelden.",
      fields: [{ name: "old", placeholder: "Altes Passwort", autocomplete: "current-password" }, { name: "new", placeholder: "Neues Passwort (mindestens 8 Zeichen)", autocomplete: "new-password" }],
      submit: "Passwort ändern",
      run: async ([oldPassword, newPassword]) => {
        if (newPassword.length < 8) return AUTH_ERRORS.bad_password;
        const reply = await Account.changePassword(oldPassword, newPassword);
        if (!reply.ok) return reply.data && reply.data.error === "wrong_password" ? "Das alte Passwort stimmt nicht." : authError(reply);
        toast("Dein Passwort ist geändert.");
        return null;
      },
    });
  }

  function deleteAccountDialog() {
    formDialog({
      title: "Konto löschen?", text: "Dein Konto und der gespeicherte Fortschritt werden sofort und endgültig gelöscht. Zur Sicherheit brauchen wir dein Passwort.",
      fields: [{ name: "password", placeholder: "Passwort", autocomplete: "current-password" }], submit: "Konto endgültig löschen", danger: true,
      run: async ([password]) => {
        const reply = await Account.remove(password);
        if (!reply.ok) return authError(reply);
        forgetDevice();
        toast("Dein Konto wurde gelöscht.");
        return null;
      },
    });
  }

  function passwordField(placeholder, autocomplete) {
    const input = h("input", { type: "password", name: "password", placeholder, autocomplete, maxlength: "200", required: true, "aria-label": placeholder });
    const eye = h("button", { class: "eye", type: "button", "aria-label": "Passwort anzeigen", snd: "tap" }, icon("eye"));
    eye.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.replaceChildren(icon(show ? "eyeoff" : "eye"));
      eye.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
    });
    return { input, row: h("label", { class: "field" }, input, eye) };
  }

  function showAuth(mode, afterOnboarding) {
    showOverlay(authScreen(mode, afterOnboarding));
    overlay.querySelector("input")?.focus();
  }

  /* Sign up ("Erstelle dein Profil") and sign in: one screen, same look as the questions before it. */
  function authScreen(mode, afterOnboarding) {
    const signup = mode === "signup";
    let busy = false;
    const name = h("input", { type: "text", name: "name", placeholder: "Name (zum Beispiel dein Vorname)", autocomplete: "given-name", maxlength: "30", "aria-label": "Name" });
    const email = h("input", { type: "email", name: "email", placeholder: "E-Mail", autocomplete: "email", inputmode: "email", maxlength: "254", required: true, "aria-label": "E-Mail" });
    const pass = passwordField(signup ? "Passwort (mindestens 8 Zeichen)" : "Passwort", signup ? "new-password" : "current-password");
    const error = h("p", { class: "auth-error", role: "alert" });
    const label = signup ? "Konto erstellen" : "Anmelden";
    const submit = h("button", { class: "btn btn-primary btn-block", type: "submit", disabled: true, snd: "none" }, label);
    const valid = () => /^[^@\s]+@[^@\s]+\.[^@\s.]{2,}$/.test(email.value.trim()) && pass.input.value.length >= (signup ? 8 : 1);
    const update = () => { submit.disabled = busy || !valid(); };
    for (const input of [email, pass.input]) input.addEventListener("input", () => { error.textContent = ""; update(); });

    const leave = () => { clearOverlay(); if (afterOnboarding) renderFresh(); else render(); };
    const switchTo = () => {
      if (signup) { showAuth("login", afterOnboarding); return; }
      if (!state.onboarded) { clearOverlay(); ui.onb.landing = false; render(); return; }
      showAuth("signup", false);
    };

    async function send(event) {
      event.preventDefault();
      if (busy || !valid()) return;
      busy = true;
      update();
      error.textContent = "";
      submit.textContent = "Einen Moment …";
      const reply = signup
        ? await Account.signup(name.value, email.value.trim(), pass.input.value, JSON.parse(JSON.stringify(state)))
        : await Account.login(email.value.trim(), pass.input.value);
      busy = false;
      submit.textContent = label;
      if (!reply.ok) { error.textContent = authError(reply); sfx("deny"); update(); return; }
      sync.user = reply.data.user;
      sync.rev = reply.data.rev;
      clearOverlay();
      sfx("goal");
      if (signup) {
        sync.dirty = false;
        Account.writeMeta(store, { email: sync.user.email, rev: sync.rev, dirty: false });
        setSyncStatus("saved");
        if (reply.data.rev === 0) { markDirty(); saveNow(false); }
        renderFresh();
        toast(`Willkommen, ${sync.user.name}! Dein Fortschritt wird jetzt gespeichert.`);
      } else {
        await meetRemote(reply.data.state, reply.data.rev);
        if (!document.querySelector(".modal-back")) renderFresh();
        toast(`Willkommen zurück, ${sync.user.name}!`);
      }
    }

    return h("div", { class: "screen auth", role: "dialog", "aria-modal": "true", "aria-label": signup ? "Konto erstellen" : "Anmelden" },
      h("div", { class: "ob-top" },
        h("button", { class: "ob-back", type: "button", "aria-label": afterOnboarding ? "Jetzt nicht" : "Schließen", onclick: leave }, icon(afterOnboarding ? "back" : "close")),
        afterOnboarding ? h("div", { class: "ob-bar bar", role: "progressbar", "aria-valuenow": "100", "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: "width:100%" })) : null),
      h("form", { class: "body auth-form", novalidate: true, onsubmit: send },
        characterEl(state.companion, "happy", "mid"),
        h("h1", {}, signup ? "Erstelle dein Profil, um deinen Fortschritt zu speichern!" : "Willkommen zurück!"),
        signup ? null : h("p", {}, "Melde dich an und mach dort weiter, wo du aufgehört hast."),
        h("div", { class: "field-group" }, signup ? h("label", { class: "field" }, name) : null, h("label", { class: "field" }, email), pass.row),
        error, submit,
        signup
          ? h("p", { class: "auth-note" }, "Mit einem Konto stimmst du der ", h("a", { href: "/gomat-archiv/datenschutz", target: "_blank", rel: "noopener" }, "Datenschutzerklärung"), " zu. Kinder unter 16 fragen bitte vorher ihre Eltern.")
          : h("p", { class: "auth-note" }, "Passwort vergessen? Dafür gibt es noch keine E-Mail-Funktion. Du kannst jederzeit ein neues Konto erstellen."),
        h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: switchTo }, signup ? "Ich habe bereits ein Konto" : "Neu hier? Konto erstellen"),
        afterOnboarding ? h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: leave }, "Jetzt nicht") : null));
  }

  // -------------------------------------------------------------- onboarding
  const SELF_OPTIONS = [
    [0, "Ich fange ganz neu an", "Zahlen und Zählen"],
    [1, "Plus und Minus kann ich schon", "Rechnen bis 100"],
    [2, "Einmaleins und Brüche kenne ich", "Schon ziemlich fit"],
    [3, "Ich bin richtig gut in Mathe", "Gleichungen und mehr"],
  ];
  const GOAL_OPTIONS = [[10, "Entspannt", "10 XP, etwa eine Lektion"], [20, "Normal", "20 XP, etwa zwei Lektionen"], [30, "Ehrgeizig", "30 XP, etwa drei Lektionen"], [50, "Intensiv", "50 XP, etwa fünf Lektionen"]];
  const ONB_STEPS = 6;          // companion, level, class, test, result, goal

  const links = () => h("div", { class: "links" }, h("a", { href: "/gomat-archiv/datenschutz" }, "Datenschutz"), h("a", { href: "/gomat-archiv/impressum" }, "Impressum"));

  /* The first screen: the name, a big friendly character and two buttons. */
  function landing() {
    const start = () => { ui.onb.landing = false; render(); };
    const login = () => showAuth("login", false);
    return h("div", { class: "screen landing" },
      h("header", { class: "ld-top" }, h("span", { class: "logo" }, icon("logo"), h("span", { class: "word" }, "gomat")),
        h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: login }, "Ich habe bereits ein Konto")),
      h("main", { class: "ld-main" },
        h("div", { class: "ld-stage tilt" }, characterEl("gomi", "cheer", "", "banana"), ["+", "−", "×", "÷"].map((sign) => h("span", { class: "sym", "aria-hidden": "true" }, sign))),
        h("div", { class: "ld-copy" },
          h("h1", {}, "Mathe lernen: kostenlos, spielerisch und wirksam"),
          h("p", {}, "Kurze Lektionen, Meistertests und vier Begleiter, die mit dir lernen."),
          h("button", { class: "btn btn-primary btn-block", type: "button", onclick: start }, "Jetzt starten"),
          h("button", { class: "btn btn-secondary btn-block", type: "button", onclick: login }, "Ich habe bereits ein Konto"),
          h("div", { class: "ld-cast", "aria-hidden": "true" }, Core.COMPANIONS.map((name) => portraitEl(name, "happy"))))),
      h("footer", { class: "ld-foot" }, links()));
  }

  function onboarding() {
    const o = ui.onb;
    if (o.landing) return landing();
    const go1 = (step) => { o.step = step; render(); };
    const choose = (key, value) => { o[key] = value; render(); };
    const primary = (label, run, disabled) => h("button", { class: "btn btn-primary btn-block", type: "button", disabled, onclick: run }, label);
    const gradeBtn = (value, label, wide) => h("button", { class: `opt grade${wide ? " wide" : ""}${o.grade === value ? " sel" : ""}`, type: "button", snd: "select", onclick: () => choose("grade", value) }, label);
    const startUnit = o.startUnit || Core.recommendedStart(o.grade, o.self);
    const unit = UNITS.find((u) => u.id === startUnit) || UNITS[0];
    const placement = o.placement;

    /* choosing the companion changes the guide on this very screen, so it is done without drawing everything again */
    const guide = h("div", { class: "guide" });
    const drawGuide = (text, mood) => guide.replaceChildren(characterEl(state.companion, mood, "big"), h("div", { class: "speech beside" }, text));
    const castPick = () => h("div", { class: "cast-pick", role: "group", "aria-label": "Begleiter wählen" }, Core.COMPANIONS.map((name) => {
      const card = h("button", { class: `cast-b${state.companion === name ? " on" : ""}`, type: "button", snd: "select", "aria-pressed": String(state.companion === name),
        onclick: () => {
          state.companion = name;
          persist();
          drawGuide("Wer soll dich beim Lernen begleiten?", "cheer");
          for (const other of document.querySelectorAll(".cast-pick .cast-b")) other.classList.toggle("on", other === card);
        } },
      characterEl(name, "happy", "cast-char"), h("b", {}, Art.CAST[name].name), h("small", {}, Art.CAST[name].role));
      return card;
    }));

    const screens = [
      () => ({ mood: "cheer", text: "Wer soll dich beim Lernen begleiten?", body: castPick(), action: primary("Weiter", () => go1(1)) }),
      () => ({ mood: "happy", text: "Wie gut kannst du schon rechnen?",
        body: h("div", { class: "options" }, SELF_OPTIONS.map(([value, label, small]) => h("button", { class: `opt${o.self === value ? " sel" : ""}`, type: "button", snd: "select", onclick: () => choose("self", value) }, h("span", {}, label, h("small", {}, small))))),
        action: primary("Weiter", () => go1(2), o.self === null) }),
      () => ({ mood: "happy", text: "In welcher Klassenstufe bist du?",
        body: h("div", { class: "grades" }, gradeBtn(0, "Noch nicht in der Schule", true), Array.from({ length: 13 }, (_, i) => gradeBtn(i + 1, `Klasse ${i + 1}`, i === 12)), gradeBtn(99, "Schon aus der Schule raus", true)),
        action: primary("Weiter", () => go1(3), o.grade === null) }),
      () => ({ mood: "happy", text: "Ich messe kurz, wie fit du bist. Das ist der Einstufungstest.",
        sub: `${DATA.placementQuestions} Fragen, die langsam schwerer oder leichter werden. Du verlierst keine Herzen und bekommst keine Note. Rate nicht wild: Wenn du etwas nicht weißt, tippe auf „Weiß ich nicht“.`,
        action: primary("Test starten", startPlacement), extra: h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: () => { o.placement = null; o.startUnit = Core.recommendedStart(o.grade, o.self); go1(5); } }, "Ohne Test starten") }),
      () => ({ mood: placement && placement.correct * 10 >= placement.total * 7 ? "cheer" : "happy", text: placement ? `${placement.correct} von ${placement.total} richtig! Du startest bei Einheit ${unit.id}: ${unit.title}.` : `Du startest bei Einheit ${unit.id}: ${unit.title}.`,
        body: placement ? h("div", { class: "placed" }, placement.details.map((d) => {
          const u = UNITS.find((x) => x.id === d.unit);
          return h("div", { class: `prow ${d.passed ? "ok" : "no"}` }, h("div", { class: "pi" }, icon(d.passed ? "check" : "close")), h("div", { class: "pt" }, h("b", {}, `Einheit ${d.unit}`), h("small", {}, u ? u.title : "")), h("div", { class: "ps" }, `${d.ok}/${d.total}`));
        })) : null,
        action: primary("Weiter", () => go1(5)) }),
      () => ({ mood: "happy", text: "Wie viel möchtest du täglich üben?",
        body: h("div", { class: "options" }, GOAL_OPTIONS.map(([goal, label, small]) => h("button", { class: `opt${o.goal === goal ? " sel" : ""}`, type: "button", snd: "select", onclick: () => choose("goal", goal) }, h("span", {}, label, h("small", {}, small))))),
        action: primary("Los geht’s", finishOnboarding) }),
    ];
    const s = screens[o.step]();
    drawGuide(s.text, s.mood);
    const back = () => {
      if (o.step === 0) { o.landing = true; render(); return; }
      go1(o.step === 5 && !o.placement ? 3 : o.step - 1);
    };
    const pct = Math.round((100 * (o.step + 1)) / (ONB_STEPS + 1));
    return h("div", { class: "screen onb" },
      h("div", { class: "ob-top" },
        h("button", { class: "ob-back", type: "button", "aria-label": "Zurück", onclick: back }, icon("back")),
        h("div", { class: "ob-bar bar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: `width:${pct}%` }))),
      h("div", { class: "body" }, guide, s.sub ? h("p", { class: "sub" }, s.sub) : null, s.body || null),
      h("div", { class: "foot" }, h("div", { class: "inner" }, s.action, s.extra || null)));
  }

  /* The questions are answered: the progress starts. Without an account the learner is asked to create one now. */
  function finishOnboarding() {
    const o = ui.onb;
    Core.finishOnboarding(state, { grade: o.grade, selfLevel: o.self, startUnit: o.startUnit || Core.recommendedStart(o.grade, o.self), goal: o.goal, placement: o.placement }, now());
    persist();
    ui.scrolled = false;
    ui.seen = { streak: 0, gems: 0, hearts: state.hearts };
    sfx("goal");
    if (sync.user) {
      renderFresh();
      toast(`Willkommen! ${Core.GEMS.welcome} Edelsteine als Geschenk.`);
      return;
    }
    render();
    showAuth("signup", true);
  }

  // --------------------------------------------------------------- starting
  const speechApi = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;
  const speakFlag = () => (speechApi() && Core.canSpeakNow(state, now()) ? 1 : 0);

  function startLesson(lessonId, kind) {
    refresh();
    const unitId = Core.unitOf(lessonId);
    const lesson = UNITS.find((u) => u.id === unitId).lessons.find((l) => l.id === lessonId);
    if (!lesson.test && state.hearts === 0) return heartsInfo();
    ui.openNode = null;
    runSession({ kind: kind || (lesson.test ? "test" : "lesson"), id: lessonId, unitId, url: () => `/api/gomat/lesson/${lessonId}?speak=${speakFlag()}` });
  }

  function startPractice(maxUnit) {
    runSession({ kind: "practice", id: null, unitId: null, url: () => `/api/gomat/practice?max_unit=${maxUnit}&n=10&speak=${speakFlag()}` });
  }

  function loadingScreen() {
    showOverlay(h("div", { class: "lesson" }, h("div", { class: "loading", style: "flex:1" }, characterEl(state.companion, "happy", "load"), h("div", {}, "Einen Moment …"))));
  }

  function connectionError(retry) {
    clearOverlay();
    modal({ mood: "sad", title: "Keine Verbindung", text: "Die Aufgaben konnten nicht geladen werden. Prüfe dein Internet und versuche es noch einmal.", buttons: [{ label: "Nochmal versuchen", kind: "btn-primary", run: retry }, { label: "Abbrechen" }] });
  }

  async function runSession(spec) {
    loadingScreen();
    let exercises;
    try {
      const response = await fetch(spec.url(), { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.exercises) || !data.exercises.length) throw new Error("bad answer");
      exercises = data.exercises;
    } catch (error) {
      connectionError(() => runSession(spec));
      return;
    }
    ui.session = {
      spec, kind: spec.kind, total: exercises.length, done: 0, mistakes: 0, combo: 0, startedAt: Date.now(), queue: exercises.map((e) => ({ e })), current: null, failed: false,
      unitBefore: spec.unitId ? Core.unitProgress(UNITS, state, spec.unitId) : null,
    };
    nextExercise();
  }

  async function startPlacement() {
    const o = ui.onb;
    loadingScreen();
    let units;
    try {
      const response = await fetch("/api/gomat/placement", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.units)) throw new Error("bad answer");
      units = data.units;
    } catch (error) {
      connectionError(startPlacement);
      return;
    }
    ui.session = {
      spec: { kind: "placement" }, kind: "placement", total: DATA.placementQuestions, done: 0, mistakes: 0, startedAt: Date.now(), queue: [], current: null, failed: false,
      pools: new Map(units.map((u) => [u.unit, u.exercises.slice()])), target: Core.recommendedStart(o.grade, o.self), steps: [], lastOk: true,
    };
    nextExercise();
  }

  /* The next placement question: from the target unit, or the nearest unit that still has questions. */
  function takePlacement(s) {
    for (let distance = 0; distance < Core.UNIT_COUNT; distance++) {
      const order = distance === 0 ? [0] : s.lastOk ? [distance, -distance] : [-distance, distance];
      for (const step of order) {
        const unit = s.target + step;
        const pool = s.pools.get(unit);
        if (pool && pool.length) return { unit, e: pool.shift() };
      }
    }
    return null;
  }

  // ------------------------------------------------------------ the lesson
  const linesOf = () => LINES[state.companion] || LINES.gomi;
  const EXPR = /^[\d\s+−×÷=?▢()²³⁴x,./-]+$/;
  const KIND_LABEL = { choice: "Wähle die richtige Antwort", input: "Schreibe die Antwort", match: "Finde die Paare", build: "Bring es in die richtige Reihenfolge", speak: "Sag es laut" };

  const usesHearts = (s) => s.kind === "lesson";            // tests have their own limit: at most PASS_MISTAKES mistakes
  const isTest = (s) => s.kind === "test" || s.kind === "skip";

  function endView() {
    const view = ui.session && ui.session.view;
    if (view && view.ctl.cleanup) view.ctl.cleanup();
  }

  function nextExercise() {
    const s = ui.session;
    endView();
    if (s.kind === "placement") {
      if (s.steps.length >= s.total) return finishPlacement();
      const next = takePlacement(s);
      if (!next) return finishPlacement();
      s.current = { e: next.e, unit: next.unit };
      return drawExercise();
    }
    if (!s.queue.length) return finish();
    s.current = s.queue.shift();
    drawExercise();
  }

  function sideInfo(lost) {
    const s = ui.session;
    if (s.kind === "practice") return [];
    if (s.kind === "placement") return [h("div", { class: "l-badge" }, `${Math.min(s.steps.length + 1, s.total)} / ${s.total}`)];
    const hearts = h("div", { class: `l-hearts${state.hearts === 0 ? " empty" : ""}${lost ? " lose" : ""}`, "aria-label": `${state.hearts} Herzen` }, icon("heart"), h("span", {}, String(state.hearts)));
    if (isTest(s)) return [h("div", { class: `l-badge test${s.mistakes > 0 ? " warn" : ""}` }, icon("trophy"), `${s.mistakes} / ${PASS_MISTAKES} Fehler`)];
    return [hearts];
  }

  function updateSide(lost) {
    document.querySelector(".l-side")?.replaceChildren(...sideInfo(lost));
  }

  function updateProgress() {
    const s = ui.session;
    const count = s.kind === "placement" ? s.steps.length : s.done;
    const pct = Math.round((100 * count) / Math.max(1, s.total));
    const bar = document.querySelector(".l-bar > i");
    if (bar) bar.style.width = `${pct}%`;
    document.querySelector(".l-bar")?.setAttribute("aria-valuenow", String(pct));
  }

  function lessonFrame(bodyNodes, footNode) {
    const s = ui.session;
    const count = s.kind === "placement" ? s.steps.length : s.done;
    const pct = Math.round((100 * count) / Math.max(1, s.total));
    return h("div", { class: `lesson k-${s.kind}`, role: "dialog", "aria-modal": "true", "aria-label": s.kind === "placement" ? "Einstufungstest" : isTest(s) ? "Meistertest" : "Lektion" },
      h("div", { class: "l-top" },
        h("button", { class: "l-x", type: "button", "aria-label": "Beenden", onclick: confirmQuit }, icon("close")),
        h("div", { class: "l-bar bar", role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100" }, h("i", { style: `width:${pct}%` })),
        h("div", { class: "l-side" }, sideInfo(false))),
      bodyNodes, footNode);
  }

  function confirmQuit() {
    const s = ui.session;
    const placement = s.kind === "placement";
    modal({ mood: "sad", title: placement ? "Test abbrechen?" : isTest(s) ? "Meistertest abbrechen?" : "Willst du wirklich aufhören?",
      text: placement ? "Du kannst den Einstufungstest später nicht mehr wiederholen, aber du kannst ohne Test starten." : "Wenn du jetzt aufhörst, geht dein Fortschritt in dieser Lektion verloren.",
      buttons: [{ label: "Weiterlernen", kind: "btn-primary" }, { label: "Aufhören", kind: "btn-secondary", run: () => { endView(); ui.session = null; clearOverlay(); render(); } }] });
  }

  function skipperButton(e) {
    const s = ui.session;
    if (e.type === "speak") return h("button", { class: "skipper", type: "button", onclick: cantSpeak }, "Ich kann gerade nicht sprechen");
    if (s.kind === "placement") return h("button", { class: "skipper", type: "button", onclick: () => { if (!s.view.answered) { s.view.answered = true; s.view.ctl.cleanup?.(); placementAnswer(false); } } }, "Weiß ich nicht");
    return h("span", {});
  }

  function drawExercise() {
    const s = ui.session;
    const e = s.current.e;
    const ctl = buildExercise(e);
    const check = h("button", { class: "btn btn-primary", type: "button", disabled: true, snd: "none", onclick: () => submit() }, "Prüfen");
    const foot = h("div", { class: "l-foot", "aria-live": "polite" }, h("div", { class: "inner" }, skipperButton(e), check));
    const body = h("div", { class: "l-body" }, ctl.nodes);
    s.view = { ctl, check, foot, body, answered: false };
    ctl.onChange = () => { check.disabled = !ctl.ready(); };
    if (e.type === "match") check.style.visibility = "hidden";      // a match exercise ends by itself
    showOverlay(lessonFrame(body, foot));
    body.classList.add("entering");                  // no scroll bars while the parts fly in
    setTimeout(() => body.classList.remove("entering"), 850);
    ctl.focus?.();
  }

  function submit() {
    const s = ui.session;
    if (!s || !s.view) return;
    const v = s.view;
    if (v.answered || !v.ctl.ready()) return;
    v.answered = true;
    v.ctl.cleanup?.();
    if (s.kind === "placement") return placementAnswer(v.ctl.check().correct);
    feedback(v.ctl.check());
  }

  /* The placement test says nothing about right or wrong: it only notes the answer and goes on. */
  function placementAnswer(ok) {
    const s = ui.session;
    const v = s.view;
    s.steps.push({ unit: s.current.unit, ok });
    s.lastOk = ok;
    s.target = Core.nextPlacementUnit(s.current.unit, ok);
    updateProgress();
    sfx("select");
    v.foot.className = "l-foot neutral";
    const cont = h("button", { class: "btn btn-primary", type: "button", onclick: () => nextExercise() }, s.steps.length >= s.total ? "Fertig" : "Weiter");
    v.foot.replaceChildren(h("div", { class: "inner" }, h("div", { class: "fb" }, h("div", { class: "face" }, portraitEl("robi", "happy")), h("div", {}, h("h3", {}, "Antwort gespeichert"))), cont));
    v.cont = cont;
    cont.focus();
  }

  function faceNode(ok) {
    return h("div", { class: "face" }, portraitEl(state.companion, ok ? "cheer" : "sad"), h("span", { class: "badge" }, icon(ok ? "check" : "close")));
  }

  function showFooter(ok, title, detail) {
    const s = ui.session;
    const v = s.view;
    const outOfHearts = !ok && usesHearts(s) && state.hearts === 0;
    const cont = h("button", { class: "btn", type: "button", onclick: () => { s.failed ? finish() : outOfHearts ? noHearts() : nextExercise(); } }, s.failed ? "Ergebnis" : "Weiter");
    v.foot.className = `l-foot ${ok ? "right" : "bad"}`;
    v.foot.replaceChildren(h("div", { class: "inner" }, h("div", { class: "fb" }, faceNode(ok), h("div", {}, h("h3", {}, title), detail)), cont));
    v.cont = cont;
    cont.focus();
    updateProgress();
    updateSide(false);
  }

  function loseHeartNow() {
    Core.loseHeart(state, now());
    persist();
    sfx("heart");
    updateSide(true);
  }

  function feedback(result) {
    const s = ui.session;
    const v = s.view;
    const e = s.current.e;
    const ok = result.correct;
    if (ok) {
      s.done += 1;
      sfx("right");
      rightInARow(s);
    } else {
      s.combo = 0;
      s.mistakes += 1;
      if (usesHearts(s)) Core.loseHeart(state, now());
      persist();
      sfx("wrong");
      if (usesHearts(s)) setTimeout(() => sfx("heart"), 220);
      if (isTest(s)) s.done += 1;
      else if (e.type !== "match") s.queue.push({ e });
    }
    s.failed = isTest(s) && s.mistakes > PASS_MISTAKES;
    refresh();
    const detail = ok ? null : h("div", {}, result.answerText ? h("p", {}, "Richtige Lösung: ", rich(result.answerText)) : null, e.explain ? h("p", {}, rich(e.explain)) : null,
      s.failed ? h("p", {}, `Das waren mehr als ${PASS_MISTAKES} Fehler.`) : null);
    showFooter(ok, pick(ok ? linesOf().right : linesOf().wrong), detail);
    updateSide(!ok && usesHearts(s));
    if (!ok) { v.body.classList.add("shake"); setTimeout(() => v.body.classList.remove("shake"), 400); }
  }

  /* Three or more right answers in a row: a little flame bubble. */
  function rightInARow(s) {
    s.combo = (s.combo || 0) + 1;
    if (s.combo < 3) return;
    const frame = overlay.querySelector(".lesson");
    if (!frame) return;
    frame.querySelector(".combo")?.remove();
    frame.append(h("div", { class: "combo", role: "status" }, icon("flame"), `${s.combo} in Folge!`));
    setTimeout(() => sfx("combo"), 260);
  }

  function noHearts() {
    endView();
    ui.session = null;
    clearOverlay();
    render();
    heartsInfo();
  }

  /* "I can't speak right now": the exercise is dropped without a penalty, speaking exercises are off for an hour,
     and the ones still to come become typing exercises. */
  function cantSpeak() {
    const s = ui.session;
    if (!s || !s.view || s.view.answered) return;
    Core.muteSpeaking(state, now());
    persist();
    s.total -= 1;
    for (const item of s.queue) {
      if (item.e.type === "speak") item.e = { ...item.e, type: "input", prompt: item.e.prompt.replace(/^Sag (die Lösung laut: |deine Antwort laut\. )/, "") };
    }
    toast("Okay, dann ohne Sprechen. Sprechaufgaben sind eine Stunde aus.");
    nextExercise();
  }

  // --------------------------------------------------------- exercise types
  function buildExercise(e) {
    const nodes = [];
    const isExpr = e.prompt.length <= 24 && EXPR.test(e.prompt);
    nodes.push(h("div", { class: "ex-kind" }, KIND_LABEL[e.type] || ""));
    nodes.push(h("h1", { class: `ex-title${isExpr ? " expr" : ""}` }, rich(e.prompt)));
    if (e.visual) nodes.push(h("div", { class: "visual" }, drawVisual(e.visual)));
    const build = { choice: choiceView, input: inputView, match: matchView, build: tilesView, speak: speakView }[e.type] || inputView;
    const ctl = build(e, nodes);
    ctl.nodes = nodes;
    return ctl;
  }

  function choiceView(e, nodes) {
    let selected = null;
    let locked = false;
    const short = e.options.every((o) => o.length <= 9);
    const buttons = e.options.map((text, i) => h("button", { class: "opt", type: "button", snd: "select", style: `--i:${i}`, onclick: () => choose(i) }, h("span", { class: "key" }, String(i + 1)), h("span", {}, rich(text))));
    const ctl = { ready: () => selected !== null, onChange() {} };
    function choose(i) {
      if (locked) return;
      selected = i;
      buttons.forEach((b, j) => b.classList.toggle("sel", j === i));
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

  /* The keypad shared by typing exercises; `text` is what has been typed so far. */
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
      if (key === "back") text = text.slice(0, -1);
      else if (key === "−") { if (!text) text = "−"; else if (text === "−") text = ""; }
      else if (key === ",") { if (text && text !== "−" && !text.includes(",")) text += ","; }
      else if (/^\d$/.test(key) && text.length < 8) text += key;
      show();
    }
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "−", "0", ","].map((k) => h("button", { class: "key-btn", type: "button", snd: "key", onclick: () => press(k), "aria-label": k === "," ? "Komma" : k === "−" ? "Minus" : k }, k));
    const back = h("button", { class: "key-btn wide", type: "button", snd: "key", onclick: () => press("back"), style: "grid-column:1 / -1", "aria-label": "Löschen" }, "Löschen");
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
      sfx("key");
      return true;
    };
    show();
    nodes.push(box, h("div", { class: "keypad" }, keys, back));
    return ctl;
  }

  /* Speaking: the answer is said into the microphone (the browser's own speech recognition, German). */
  function speakView(e, nodes) {
    const Recognition = speechApi();
    const suffix = e.unit && !e.unit.endsWith("=") ? e.unit : "";
    let heard = [];
    let listening = false;
    let locked = false;
    let rec = null;
    const hint = h("p", { class: "mic-hint", "aria-live": "polite" }, "Tippe auf das Mikrofon und sag die Antwort.");
    const said = h("div", { class: "said empty" }, "…");
    const mic = h("button", { class: "mic", type: "button", snd: "none", "aria-label": "Mikrofon an oder aus", onclick: toggle }, icon("mic"));
    const wrap = h("div", { class: "mic-wrap" }, h("i", { class: "ring r1" }), h("i", { class: "ring r2" }), mic);
    const ctl = { ready: () => heard.length > 0 && !listening, onChange() {} };

    function paint() {
      mic.classList.toggle("on", listening);
      wrap.classList.toggle("on", listening);
      const best = heard[0];
      const number = best ? Core.parseSpokenNumber(best) : NaN;
      said.classList.toggle("empty", !best);
      said.replaceChildren(...(best ? [h("span", { class: "q" }, `„${best}“`), Number.isFinite(number) ? h("small", {}, `Verstanden: ${String(number).replace(".", ",")}`) : h("small", {}, "Das war keine Zahl. Versuche es noch einmal.")] : ["…"]));
      ctl.onChange();
    }

    function stop() {
      if (rec) { try { rec.stop(); } catch (error) { /* already stopped */ } }
    }

    function start() {
      if (!Recognition) { hint.textContent = "Dein Browser kann nicht zuhören. Tippe unten auf „Ich kann gerade nicht sprechen“."; return; }
      try {
        rec = new Recognition();
      } catch (error) {
        hint.textContent = "Das Mikrofon lässt sich nicht starten. Tippe unten auf „Ich kann gerade nicht sprechen“.";
        return;
      }
      rec.lang = "de-DE";
      rec.interimResults = true;
      rec.maxAlternatives = 5;
      rec.continuous = false;
      rec.onstart = () => { listening = true; hint.textContent = "Ich höre zu …"; sfx("micOn"); paint(); };
      rec.onresult = (event) => {
        const last = event.results[event.results.length - 1];
        heard = Array.from(last).map((alt) => alt.transcript).filter(Boolean);
        paint();
      };
      rec.onerror = (event) => {
        listening = false;
        hint.textContent = event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Das Mikrofon ist nicht erlaubt. Erlaube es im Browser oder tippe unten auf „Ich kann gerade nicht sprechen“."
          : event.error === "no-speech" ? "Ich habe nichts gehört. Tippe auf das Mikrofon und versuche es noch einmal." : "Das hat nicht geklappt. Versuche es noch einmal.";
        paint();
      };
      rec.onend = () => {
        if (listening) sfx("micOff");
        listening = false;
        if (heard.length && !locked) hint.textContent = "Stimmt das? Dann tippe auf „Prüfen“, sonst sprich noch einmal.";
        paint();
      };
      heard = [];
      try { rec.start(); } catch (error) { listening = false; paint(); }
    }

    function toggle() {
      if (locked) return;
      if (listening) stop(); else start();
    }

    ctl.cleanup = () => {
      locked = true;
      if (rec) { rec.onresult = rec.onend = rec.onerror = rec.onstart = null; try { rec.abort(); } catch (error) { /* already stopped */ } }
    };
    ctl.check = () => {
      locked = true;
      const correct = Core.spokenMatches(e.answer, heard);
      said.classList.add(correct ? "right" : "bad");
      mic.disabled = true;
      hint.textContent = "";
      return { correct, answerText: `${e.answer}${suffix ? " " + suffix : ""}` };
    };
    nodes.push(h("div", { class: "speak" }, wrap, hint, said));
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
    const leftButtons = lefts.map((text, i) => h("button", { class: "tile", type: "button", snd: "tile", style: `--i:${i}`, onclick: () => { left = i; paint(); tryPair(); } }, rich(text)));
    const rightButtons = rights.map((text, i) => h("button", { class: "tile", type: "button", snd: "tile", style: `--i:${i}`, onclick: () => { right = i; paint(); tryPair(); } }, rich(text)));
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
        sfx("right");
        if (matched.size === lefts.length) setTimeout(complete, 250);
        return;
      }
      for (const b of [leftButtons[l], rightButtons[r]]) { b.classList.remove("sel"); b.classList.add("wrong"); setTimeout(() => b.classList.remove("wrong"), 400); }
      sfx("wrong");
      if (!hurt) {
        hurt = true;
        const s = ui.session;
        s.mistakes += 1;
        if (usesHearts(s)) loseHeartNow();
        persist();
        updateSide(usesHearts(s));
      }
    }
    nodes.push(h("div", { class: "tiles" }, h("div", { class: "col-t" }, leftButtons), h("div", { class: "col-t" }, rightButtons)));
    // A match exercise ends by itself; a slip costs one heart (once) but the exercise is not repeated.
    function complete() {
      const s = ui.session;
      if (!s || !s.view || s.view.answered) return;
      s.done += 1;
      s.view.answered = true;
      sfx("right");
      if (hurt) s.combo = 0; else rightInARow(s);
      s.failed = isTest(s) && s.mistakes > PASS_MISTAKES;
      refresh();
      showFooter(true, pick(linesOf().right), null);
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
      slots.replaceChildren(...(chosen.length ? chosen.map((t) => h("button", { class: "token", type: "button", snd: "tile", onclick: () => { t.used = false; chosen.splice(chosen.indexOf(t), 1); paint(); } }, rich(t.text))) : [h("span", { class: "hint" }, "Tippe die Kärtchen in der richtigen Reihenfolge an.")]));
      bank.replaceChildren(...tokens.map((t) => h("button", { class: `token${t.used ? " used" : ""}`, type: "button", snd: "tile", onclick: () => { t.used = true; chosen.push(t); paint(); } }, rich(t.text))));
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
  function finishPlacement() {
    const s = ui.session;
    const outcome = Core.placementOutcome(s.steps);
    ui.onb.placement = outcome;
    ui.onb.startUnit = outcome.unit;
    ui.onb.step = 4;
    ui.session = null;
    clearOverlay();
    sfx("finish");
    render();
  }

  /* Hands the result to the rules, then shows the result screen. */
  function finish() {
    const s = ui.session;
    endView();
    const seconds = Math.max(1, Math.round((Date.now() - s.startedAt) / 1000));
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
    const wrong = s.mistakes;
    const right = isTest(s) ? Math.max(0, s.done - s.mistakes) : s.total;
    const input = { correct: right, mistakes: wrong };
    let result;
    if (s.kind === "practice") result = Core.completePractice(state, input, now());
    else if (s.kind === "lesson") result = Core.completeLesson(state, s.spec.id, input, now());
    else if (s.kind === "test") result = Core.completeLesson(state, s.spec.id, { ...input, test: true }, now());
    else result = Core.completeSkip(state, UNITS, s.spec.unitId, input, now());
    const passed = result.passed !== false;
    let unitDone = null;
    let unlocked = null;
    if (s.spec.unitId && passed) {
      const after = Core.unitProgress(UNITS, state, s.spec.unitId);
      if (s.unitBefore.done < s.unitBefore.total && after.done === after.total) {
        unitDone = UNITS.find((u) => u.id === s.spec.unitId);
        unlocked = UNITS.find((u) => u.id === s.spec.unitId + 1) || null;
      }
    }
    persist();
    ui.session = null;
    ui.fresh = unlocked ? unlocked.id : null;
    const stars = s.spec.id && passed ? Core.starsFor(state, s.spec.id) : 0;
    resultScreen({ s, result, passed, time, unitDone, unlocked, stars, mistakes: wrong });
  }

  function resultScreen({ s, result, passed, time, unitDone, unlocked, stars, mistakes }) {
    const week = Core.lastDays(state, now(), 7);
    const test = isTest(s);
    let notesDelay = 0;
    const note = (kind, iconName, title, text, extra) => h("div", { class: `note ${kind}`, style: `--d:${notesDelay++}` }, icon(iconName), h("div", {}, h("h3", {}, title), text ? h("p", {}, text) : null, extra));
    const notes = passed ? [
      unitDone ? note("unit", "trophy", `Einheit ${unitDone.id} geschafft!`, s.kind === "skip" ? `Du hast „${unitDone.title}“ übersprungen.` : `Du hast „${unitDone.title}“ abgeschlossen.`) : null,
      unlocked ? note("unlock", "lock", `Einheit ${unlocked.id} ist offen!`, `Als Nächstes: ${unlocked.title}`) : null,
      result.streakExtended ? note("streak", "flame", `${result.streak} ${plural(result.streak, "Tag", "Tage")} in Folge!`, "Komm morgen wieder, damit deine Serie weiterwächst.",
        h("div", { class: "daydots" }, week.map((d) => h("span", { class: d.xp ? "on" : "" }, d.label[0])))) : null,
      result.goalReached ? note("goal", "target", "Tagesziel geschafft!", `Du hast heute ${state.goal} XP gesammelt.`) : null,
      result.heartWon ? note("heart", "heart", "Ein Herz zurück!", "Gut geübt! Du hast ein Herz zurückbekommen.") : null,
      !sync.user && [1, 3, 6, 10, 20].includes(state.stats.lessons) ? note("save", "cloud", "Fortschritt sichern", "Mit einem Konto ist dein Fortschritt auf jedem Gerät da.",
        h("button", { class: "btn btn-primary btn-sm", type: "button", onclick: () => { clearOverlay(); render(); showAuth("signup", false); } }, "Konto erstellen")) : null,
    ] : [
      note("fail", "close", `${mistakes} Fehler sind zu viel`, `Für den Meistertest sind höchstens ${PASS_MISTAKES} Fehler erlaubt.${s.kind === "skip" ? " Du kannst die Einheit ganz normal lernen." : " Wiederhole die Lektionen und versuche es dann noch einmal."}`),
    ];
    /* A tile with a number that counts up ({to, prefix, suffix}) or a plain text. */
    const tile = (cls, title, iconName, value) => h("div", { class: `res tilt ${cls}` }, h("div", { class: "t" }, title),
      h("div", { class: "v" }, icon(iconName), h("span", { class: "n", "data-to": value.to ?? null, "data-prefix": value.prefix || null, "data-suffix": value.suffix || null }, `${value.prefix || ""}${value.to ?? value.text}${value.suffix || ""}`)));
    const accuracy = tile("acc", "Genauigkeit", "target", { to: result.accuracy, suffix: " %" });
    const tiles = passed ? [
      tile("xp", "XP", "bolt", { to: result.xp, prefix: "+" }),
      tile("gems", "Edelsteine", "gem", { to: result.gems, prefix: "+" }),
      accuracy,
      tile("time", "Zeit", "clock", { text: time }),
    ] : [accuracy, tile("time", "Zeit", "clock", { text: time })];
    const title = !passed ? (s.kind === "skip" ? "Das hat nicht gereicht" : "Meistertest nicht bestanden") : s.kind === "practice" ? "Übung geschafft!" : s.kind === "test" ? "Meistertest bestanden!" : s.kind === "skip" ? "Einheit übersprungen!" : "Lektion geschafft!";
    const retry = () => { clearOverlay(); startLesson(s.spec.id, s.kind); };
    const done = () => { clearOverlay(); ui.scrolled = false; renderFresh(); ui.fresh = null; };
    const buttons = passed
      ? [h("button", { class: "btn btn-primary btn-block", type: "button", onclick: done }, "Weiter")]
      : [h("button", { class: "btn btn-primary btn-block", type: "button", onclick: retry }, "Nochmal versuchen"), h("button", { class: "btn btn-ghost btn-block", type: "button", onclick: done }, "Zurück zum Weg")];
    showOverlay(h("div", { class: `screen result ${passed ? "pass" : "fail"}`, role: "dialog", "aria-modal": "true", "aria-label": "Ergebnis" },
      h("div", { class: "body" },
        characterEl(state.companion, passed ? "cheer" : "sad", "big"),
        h("h1", {}, title),
        stars ? h("div", { class: "big-stars", "aria-label": `${stars} von 3 Sternen` }, [1, 2, 3].map((n) => h("span", { class: n <= stars ? "on" : "", style: `--s:${n}` }, icon("star")))) : null,
        h("div", { class: "results" }, tiles),
        notes),
      h("div", { class: "foot" }, h("div", { class: "inner" }, buttons))));
    for (const el of overlay.querySelectorAll(".res .n[data-to]")) countUp(el, 0, Number(el.dataset.to), el.dataset.prefix || "", el.dataset.suffix || "");
    sfx(passed ? (test ? "pass" : "finish") : "fail");
    if (passed && result.gems) setTimeout(() => sfx("gem"), 650);
    if (passed && result.streakExtended) setTimeout(() => sfx("streak"), 1200);
    if (passed && unlocked) setTimeout(() => sfx("unlock"), 1700);
    if (passed) confetti();
    overlay.querySelector(".foot .btn")?.focus();
  }

  function confetti() {
    if (REDUCED) return;
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
      if (closeTop) { closeTop(); return; }
      const auth = overlay.querySelector(".screen.auth .ob-back");
      if (auth) { auth.click(); return; }
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
    if (SCREENS.includes(next) && next !== ui.screen && !ui.session && state.onboarded) go(next);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { saveNow(true); return; }
    if (!ui.session && !overlay.firstChild && !document.querySelector(".modal-back")) { refresh(); render(); }
  });
  window.addEventListener("pagehide", () => { saveNow(true); });
  window.addEventListener("online", () => { if (sync.dirty) saveNow(false); });

  renderFresh();
  bootAccount();
  if (freezeUsed) toast(`Dein Serien-Schutz hat deine Serie gerettet${freezeUsed > 1 ? ` (${freezeUsed} Tage)` : ""}.`);
})();
