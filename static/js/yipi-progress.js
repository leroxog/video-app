/* Satürn progress (yipi-progress.js): what makes you come back tomorrow -- the streak of days in a row (the flame on Home), the level with its
   bar and the badges (one tap on the flame), a toast when you reach a new level or when your streak grows, the lists of the best players of a
   game (with a tab for friends), and notifications on the device (Web Push, switched on in the settings). The numbers come from the server
   (/api/yipi/progress); the page only remembers the last level and the last day it announced (localStorage "yipi.progress"). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { h, fill, icon, toast, dialog, avatar } = Y;

  const STORE = "yipi.progress";
  const today = () => new Date().toISOString().slice(0, 10);
  const days = (n) => `${n} ${n === 1 ? "Tag" : "Tage"}`;

  async function loadProgress() {
    if (!Y.me) return null;
    const reply = await Api.get("/progress");
    return reply.ok ? reply.data : null;
  }

  // ------------------------------------------------------------------------------------------------ the flame on Home
  const chips = new Set();
  function drawChip(chip) {
    const n = (Y.me && Y.me.streak) || 0;
    chip.hidden = !Y.me;
    chip.classList.toggle("cold", n < 2);
    chip.setAttribute("aria-label", n ? `${days(n)} in Folge. Dein Fortschritt` : "Dein Fortschritt");
    fill(chip, icon("flame"), h("span", {}, String(n)));
  }
  function streakChip() {
    const chip = h("button", { class: "streak-chip", type: "button", "aria-haspopup": "dialog", onclick: () => progressDialog() });
    drawChip(chip);
    chips.add(chip);
    return chip;
  }
  const redrawChips = () => { for (const chip of chips) { if (!chip.isConnected) chips.delete(chip); else drawChip(chip); } };

  /* Looks at the numbers (after signing in, after a game, after a post): a new level or a longer streak gets a short, happy message. */
  async function checkProgress() {
    const data = await loadProgress();
    if (!data) return null;
    if (Y.me) Y.me.streak = data.streak;
    redrawChips();
    let saved = Y.readJson(STORE, {});
    if (!saved || typeof saved !== "object") saved = {};
    if (saved.level && data.level > saved.level) { toast(`Level ${data.level} erreicht!`); Y.sound?.play("level"); }
    else if (saved.day !== today() && data.streak >= 2) { toast(`${days(data.streak)} in Folge. Weiter so!`); Y.sound?.play("success"); }
    Y.writeJson(STORE, { level: data.level, day: today() });
    return data;
  }

  // ------------------------------------------------------------------------------------------------ level and badges
  function progressBody(data) {
    const span = Math.max(1, data.to - data.from);
    const share = Math.max(0, Math.min(1, (data.xp - data.from) / span));
    const bar = h("span", { class: "prog-fill" });
    bar.style.width = `${Math.round(share * 100)}%`;
    return [
      h("div", { class: "prog-top" },
        h("div", { class: "prog-level", "aria-label": `Level ${data.level}` }, h("small", {}, "Level"), h("b", {}, String(data.level))),
        h("div", { class: "prog-main" },
          h("b", {}, `${data.xp} XP`),
          h("span", { class: "prog-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(span), "aria-valuenow": String(data.xp - data.from), "aria-label": "Weg bis zum nächsten Level" }, bar),
          h("small", {}, `Noch ${data.to - data.xp} XP bis Level ${data.level + 1}`))),
      h("div", { class: "prog-streak" }, icon("flame"),
        h("div", {}, h("b", {}, data.streak ? `${days(data.streak)} in Folge` : "Noch keine Serie"),
          h("small", {}, data.today ? `Heute bist du dabei. Dein Rekord: ${days(Math.max(data.streakBest, data.streak))}.` : "Komm heute noch vorbei, damit deine Serie weitergeht."))),
      h("h3", { class: "prog-head" }, `Abzeichen ${data.badges.filter((badge) => badge.done).length} / ${data.badges.length}`),
      h("div", { class: "awards" }, data.badges.map((badge) => h("div", { class: `award${badge.done ? " done" : ""}`, role: "group", "aria-label": `${badge.name}: ${badge.text}${badge.done ? ", geschafft" : `, ${badge.value} von ${badge.goal}`}` },
        h("span", { class: "award-emoji", "aria-hidden": "true" }, badge.emoji), h("b", {}, badge.name), h("small", {}, badge.done ? badge.text : `${badge.value} / ${badge.goal}`)))),
      h("p", { class: "muted small" }, "XP bekommst du für Beiträge, Likes, Follower, Freunde, Videos, Spiele und für jeden Tag in Folge."),
    ];
  }

  function progressDialog() {
    if (!Y.requireLogin("Melde dich an, um dein Level zu sehen.")) return;
    const body = h("div", { class: "progress" }, Y.skeleton(2));
    dialog({ title: "Dein Fortschritt", body });
    loadProgress().then((data) => {
      if (!body.isConnected) return;
      if (!data) { fill(body, h("p", { class: "muted" }, "Das ließ sich gerade nicht laden.")); return; }
      if (Y.me) Y.me.streak = data.streak;
      redrawChips();
      fill(body, ...progressBody(data));
    });
  }

  // ------------------------------------------------------------------------------------------------ the best players of a game
  /* A round is over: the score goes to the server (it keeps the best one of each person); the answer says how good it was. */
  async function reportPlay(game, score) {
    if (!Y.me || !game || !(score > 0)) return null;
    const reply = await Api.post("/play", { game, score: Math.floor(score) });
    if (!reply.ok) return null;
    checkProgress();
    return reply.data;
  }

  function leaderboard(game) {
    if (!Y.requireLogin("Melde dich an, um die Bestenliste zu sehen.")) return;
    let scope = "all";
    const list = h("div", { class: "board" });
    const tabsBox = h("div", { class: "board-tabs" });
    async function draw() {
      fill(tabsBox, Y.tabs([["all", "Alle"], ["friends", "Freunde"]], scope, (id) => { scope = id; draw(); }, "Bestenliste"));
      fill(list, Y.skeleton(2));
      const mine = scope;
      const reply = await Api.get(Y.qs(`/games/${game.id}/top`, { scope: scope === "friends" ? "friends" : undefined }));
      if (mine !== scope || !list.isConnected) return;
      if (!reply.ok) { fill(list, h("p", { class: "muted" }, Api.message(reply))); return; }
      const rows = reply.data.items.map((entry) => h("div", { class: `board-row${entry.isMe ? " me" : ""}` },
        h("span", { class: "board-rank" }, String(entry.rank)), avatar(entry.user, "sm"),
        h("span", { class: "board-name" }, h("b", {}, entry.user.name), h("small", {}, `@${entry.user.handle}`)), h("b", { class: "board-score" }, Core.formatCount(entry.best))));
      fill(list, ...(rows.length ? rows : [h("p", { class: "muted" }, scope === "friends" ? "Noch hat keiner deiner Freunde dieses Spiel gespielt." : "Noch hat niemand dieses Spiel gespielt. Sei der Erste!")]),
        reply.data.me ? h("p", { class: "muted small" }, `Dein Bestwert: ${Core.formatCount(reply.data.me.best)} · ${reply.data.me.plays} ${reply.data.me.plays === 1 ? "Runde" : "Runden"}`) : null);
    }
    dialog({ title: `Bestenliste: ${game.name}`, body: h("div", { class: "board-box" }, tabsBox, list) });
    draw();
  }

  // ------------------------------------------------------------------------------------------------ notifications on the device
  const push = {
    supported: () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window,
    /* An iPhone or iPad (iPadOS says "Mac" but has a touch screen) and Satürn is open in Safari, not as an app of the home screen: only the app of the home screen can show notifications. */
    needsInstall: () => (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) && !(window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches)),
    /* "unsupported", "blocked" (the person said no in the browser), "on" or "off" */
    async state() {
      if (!push.supported()) return "unsupported";
      if (Notification.permission === "denied") return "blocked";
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return registration && (await registration.pushManager.getSubscription()) ? "on" : "off";
      } catch (error) { return "off"; }
    },
    async enable() {
      if (!push.supported()) return { ok: false, message: "Dieser Browser kann keine Mitteilungen anzeigen." };
      if ((await Notification.requestPermission()) !== "granted") return { ok: false, message: "Du hast Mitteilungen nicht erlaubt." };
      const key = await Api.get("/push/key");
      if (!key.ok) return { ok: false, message: Api.message(key) };
      try {
        const registration = await navigator.serviceWorker.register("/pulse-sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const subscription = (await registration.pushManager.getSubscription()) || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Core.base64UrlBytes(key.data.key) });
        const reply = await Api.post("/push/subscribe", { subscription: subscription.toJSON() });
        return reply.ok ? { ok: true } : { ok: false, message: Api.message(reply) };
      } catch (error) { return { ok: false, message: "Mitteilungen ließen sich auf diesem Gerät nicht einschalten." }; }
    },
    async disable() {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const subscription = registration && await registration.pushManager.getSubscription();
        if (subscription) { await Api.post("/push/unsubscribe", { endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
        return { ok: true };
      } catch (error) { return { ok: false, message: "Mitteilungen ließen sich nicht ausschalten." }; }
    },
  };

  /* The steps that make Satürn an app on the home screen of an iPhone or iPad (the notifications come to that app). */
  function installSteps() {
    return h("div", { class: "push-install" }, h("b", {}, "So bekommst du Mitteilungen auf dem iPhone oder iPad"),
      h("ol", {}, h("li", {}, "Öffne Satürn in Safari."), h("li", {}, "Tippe unten auf das Teilen-Symbol (das Quadrat mit dem Pfeil)."), h("li", {}, "Wähle „Zum Home-Bildschirm“ und tippe auf „Hinzufügen“."),
        h("li", {}, "Öffne Satürn jetzt vom Home-Bildschirm und schalte hier die Mitteilungen ein.")));
  }

  /* The page /settings/push. */
  function pushSettings() {
    const toggle = h("input", { type: "checkbox", id: "push-on", "aria-label": "Mitteilungen auf diesem Gerät" });
    const note = h("p", { class: "muted small" });
    const row = h("label", { class: "toggle-row", for: "push-on" }, h("span", {}, "Mitteilungen auf diesem Gerät"), toggle);
    async function show() {
      const state = await push.state();
      toggle.checked = state === "on";
      toggle.disabled = state === "unsupported" || state === "blocked";
      note.textContent = state === "unsupported" ? "Dieser Browser kann keine Mitteilungen anzeigen. Auf dem iPhone geht es erst, wenn du Satürn zum Home-Bildschirm hinzugefügt hast."
        : state === "blocked" ? "Du hast Mitteilungen für diese Seite im Browser blockiert. Erlaube sie in den Einstellungen der Seite."
          : "Du bekommst eine Mitteilung bei Likes, Antworten, neuen Followern und Nachrichten und wenn jemand, dem du folgst, etwas Neues postet, auch wenn Satürn zu ist. Den Text einer Nachricht enthält sie nie.";
    }
    toggle.addEventListener("change", async () => {
      toggle.disabled = true;
      const result = toggle.checked ? await push.enable() : await push.disable();
      if (!result.ok) toast(result.message);
      else if (toggle.checked) { toast("Mitteilungen sind an."); Y.sound?.play("success"); }
      await show();
    });
    show();
    return h("div", { class: "settings-body" }, h("section", { class: "card" }, h("h2", {}, "Mitteilungen"), push.needsInstall() ? installSteps() : null, row, note));
  }

  /* A card on the notifications page that asks once, while the browser has not been asked yet. */
  async function pushInvite() {
    if (Y.me && push.needsInstall()) return installSteps();                      // (on an iPhone the page cannot ask before it is an app of the home screen)
    if (!Y.me || !push.supported() || Notification.permission !== "default") return null;
    const card = h("div", { class: "push-invite" }, icon("bell"), h("div", {}, h("b", {}, "Nichts mehr verpassen"), h("small", {}, "Mitteilungen auf dieses Gerät, auch wenn Satürn zu ist.")));
    const go = h("button", { class: "btn primary small", type: "button" }, "Einschalten");
    go.addEventListener("click", async () => {
      go.disabled = true;
      const result = await push.enable();
      if (result.ok) { card.remove(); toast("Mitteilungen sind an."); Y.sound?.play("success"); } else { go.disabled = false; toast(result.message); }
    });
    card.append(go);
    return card;
  }

  Object.assign(Y, { streakChip, checkProgress, progressDialog, reportPlay, leaderboard, push, pushSettings, pushInvite });
  if (Y.me) setTimeout(checkProgress, 1200);
})();
