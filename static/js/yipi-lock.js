/* Pulse chat lock (yipi-lock.js): an option from the settings. When it is on, the chats open only with a combination: one stroke of the finger across
   the screen, with the right shape and at the right pace (static/js/yipi-core.js says how well a stroke fits; 82 percent opens the chats). The page
   of the chats is then a dark field of grey dots that says "Chats sind gesperrt". Wrong tries lock it for longer and longer (3 in a row: a minute, then
   1, 5, 10, 15, 30, 60, 120, 240 minutes and so on); a right try wipes the record. The combination and the record stay in this browser only (a screen
   lock against curious eyes, not a vault). The chats are locked again after the app was out of sight for a minute. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const { fill, put, h, icon, toast } = Y;

  const COMBO_KEY = (handle) => `yipi.lock.${handle}`;
  const FAIL_KEY = (handle) => `yipi.lockfails.${handle}`;
  const handle = () => (Y.me ? Y.me.handle : "");
  const stored = () => { const value = Y.readJson(COMBO_KEY(handle()), null); return value && value.template && Array.isArray(value.template.shape) ? value : null; };
  const record = () => { const value = Y.readJson(FAIL_KEY(handle()), null); return value && typeof value === "object" ? { fails: value.fails | 0, level: value.level | 0, until: Number(value.until) || 0 } : { fails: 0, level: 0, until: 0 }; };
  let open = false;                                             // the chats were opened with the combination (until the app has been out of sight for a minute)
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hiddenAt && Date.now() - hiddenAt > 60000) open = false;
  });

  /* The pad: a canvas over its parent that draws the stroke of the finger and gives it back when the finger leaves the screen. */
  function pad(onStroke) {
    const canvas = h("canvas", { class: "pad-canvas", "aria-label": "Fläche für die Wisch-Kombination" });
    let points = [];
    let drawing = false;
    let fade = 0;
    let color = "#fff";
    const ctx = canvas.getContext("2d");
    function fit() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(box.width * dpr));
      canvas.height = Math.max(1, Math.round(box.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function paint() {
      const box = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, box.width, box.height);
      if (points.length > 1) {
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 8; ctx.strokeStyle = color; ctx.globalAlpha = drawing ? 0.95 : Math.max(0, fade);
        ctx.beginPath(); points.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    let frame = 0;
    function loop() {
      paint();
      if (!drawing && fade > 0) fade -= 0.035;
      if (drawing || fade > 0) frame = requestAnimationFrame(loop); else { frame = 0; points = []; paint(); }
    }
    const at = (event) => { const box = canvas.getBoundingClientRect(); return { x: event.clientX - box.left, y: event.clientY - box.top, t: performance.now() }; };
    canvas.addEventListener("pointerdown", (event) => {
      drawing = true; fade = 1; color = "#fff"; points = [at(event)];
      try { canvas.setPointerCapture(event.pointerId); } catch (error) { /* a mouse may not have one */ }
      event.preventDefault();
      if (!frame) frame = requestAnimationFrame(loop);
    });
    canvas.addEventListener("pointermove", (event) => { if (drawing) points.push(at(event)); });
    const end = (event) => {
      if (!drawing) return;
      drawing = false;
      points.push(at(event));
      fade = 1;
      if (!frame) frame = requestAnimationFrame(loop);
      onStroke(points.slice());
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    if (window.ResizeObserver) new ResizeObserver(fit).observe(canvas); else window.addEventListener("resize", fit);
    setTimeout(fit, 0);
    return { element: canvas, flash(ok) { color = ok ? "#6bff9a" : "#ff6b7a"; }, destroy() { cancelAnimationFrame(frame); } };
  }

  const waitText = (until) => {
    const seconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return seconds >= 3600 ? `${Math.floor(seconds / 3600)} Std. ${Math.floor((seconds % 3600) / 60)} Min.` : seconds >= 60 ? `${Math.floor(seconds / 60)} Min. ${seconds % 60} Sek.` : `${seconds} Sek.`;
  };

  /* Checks a stroke against the saved combination, keeps the record of wrong tries: {ok} or {ok: false, message}. */
  function check(points) {
    const saved = stored();
    if (!saved) return { ok: true };
    const state = record();
    if (state.until > Date.now()) return { ok: false, locked: state.until, message: `Gesperrt für ${waitText(state.until)}` };
    if (!Core.gestureTemplate(points)) return { ok: false, message: "Wisch in einem Zug über den Bildschirm." };
    if (Core.gestureScore(saved.template, points) >= Core.GESTURE_PASS) { Y.writeJson(FAIL_KEY(handle()), { fails: 0, level: 0, until: 0 }); return { ok: true }; }
    const next = Core.lockAfterWrong(state, Date.now());
    Y.writeJson(FAIL_KEY(handle()), next);
    if (next.until > Date.now()) return { ok: false, locked: next.until, message: `Zu oft falsch: gesperrt für ${waitText(next.until)}` };
    return { ok: false, message: next.fails === 2 ? "Nicht richtig. Noch ein Versuch." : `Nicht richtig. Noch ${3 - next.fails} Versuche.` };
  }

  /* The dark screen of dots with the pad on it. `onStroke(points)` gets every stroke; `.say(text, bad)` writes under the title. */
  function lockScreen({ title, sub, onStroke, extra }) {
    const message = h("p", { class: "lock-message", "aria-live": "polite" });
    const surface = pad((points) => onStroke(points, api));
    const api = { say(text, bad) { message.textContent = text; message.classList.toggle("bad", !!bad); }, flash: surface.flash, pad: surface, open() { el.classList.add("opened"); } };
    const el = h("div", { class: "lockscreen" }, surface.element, h("div", { class: "lock-text" }, h("span", { class: "lock-ic" }, icon("lock")), h("h1", {}, title), h("p", { class: "lock-sub" }, sub), message), extra || null);
    return { element: el, api };
  }

  /* The page of the chats while they are locked. */
  Y.chatLockView = function chatLockView(route, ctx) {
    let timer = null;
    const screen = lockScreen({ title: "Chats sind gesperrt", sub: "Kombination eingeben", onStroke(points, api) {
      const result = check(points);
      api.flash(result.ok);
      if (result.ok) { open = true; api.say("Entsperrt", false); api.open(); setTimeout(() => ctx.reload(), 380); return; }
      api.say(result.message, true);
      if (result.locked) countdown();
    } });
    function countdown() {
      clearInterval(timer);
      const state = record();
      if (state.until <= Date.now()) return;
      const tick = () => { const left = record().until; if (left <= Date.now()) { clearInterval(timer); screen.api.say("Du kannst es wieder versuchen.", false); return; } screen.api.say(`Gesperrt für ${waitText(left)}`, true); };
      tick();
      timer = setInterval(tick, 1000);
    }
    countdown();
    return { element: h("div", { class: "view lock-view" }, screen.element), title: "Chats gesperrt", destroy() { clearInterval(timer); screen.api.pad.destroy(); } };
  };

  /* A full-screen overlay to draw one stroke on (for the settings); resolves with the points or null when it is closed. */
  function ask(title, sub, { verify = false } = {}) {
    return new Promise((resolve) => {
      let timer = null;
      const done = (value) => { clearInterval(timer); screen.api.pad.destroy(); overlay.remove(); document.body.classList.remove("modal-open"); resolve(value); };
      const screen = lockScreen({ title, sub, onStroke(points, api) {
        if (verify) {
          const result = check(points);
          api.flash(result.ok);
          if (result.ok) { done(points); return; }
          api.say(result.message, true);
          if (result.locked) startCountdown();
          return;
        }
        if (!Core.gestureTemplate(points)) { api.flash(false); api.say("Wisch in einem Zug, nicht zu kurz und nicht zu schnell.", true); return; }
        api.flash(true);
        done(points);
      }, extra: h("button", { class: "lock-cancel", type: "button", "aria-label": "Abbrechen", onclick: () => done(null) }, icon("close")) });
      function startCountdown() {
        clearInterval(timer);
        const tick = () => { const left = record().until; if (left <= Date.now()) { clearInterval(timer); screen.api.say("Du kannst es wieder versuchen.", false); return; } screen.api.say(`Gesperrt für ${waitText(left)}`, true); };
        tick();
        timer = setInterval(tick, 1000);
      }
      const overlay = h("div", { class: "lock-overlay", role: "dialog", "aria-modal": "true", "aria-label": title }, screen.element);
      document.body.append(overlay);
      document.body.classList.add("modal-open");
      if (verify && record().until > Date.now()) startCountdown();
    });
  }

  /* The section "Chat-Sperre" of the settings. */
  Y.chatLockSettings = function chatLockSettings() {
    const box = h("div", { class: "settings-body" });
    function draw() {
      const on = !!stored();
      const status = h("p", { class: "muted" }, on
        ? "Die Chat-Sperre ist an: die Chats öffnen sich nur mit deiner Wisch-Kombination."
        : "Aus. Mit der Chat-Sperre öffnen sich die Chats nur, wenn du die richtige Kombination wischst: eine Bewegung des Fingers über den Bildschirm, mit der richtigen Form und im richtigen Tempo.");
      const rules = h("ul", { class: "plain-points" },
        h("li", {}, "Du wischst einmal; sobald der Finger den Bildschirm verlässt, ist die Kombination fertig."),
        h("li", {}, "Zu 82 Prozent richtig genügt, Form und Geschwindigkeit zählen."),
        h("li", {}, "Dreimal falsch hintereinander: eine Minute Sperre, danach wird sie länger (1, 5, 10, 15, 30, 60, 120, 240 Minuten …). Einmal richtig, und alles ist wieder frisch."),
        h("li", {}, "Die Kombination bleibt nur in diesem Browser. Das ist ein Sichtschutz gegen neugierige Blicke, kein Tresor."));
      const buttons = on ? [
        h("button", { class: "btn primary", type: "button", onclick: async () => { if (!(await ask("Aktuelle Kombination", "Wische sie, um etwas zu ändern", { verify: true }))) return; await setup(); draw(); } }, "Kombination ändern"),
        h("button", { class: "btn ghost", type: "button", onclick: async () => { if (!(await ask("Sperre ausschalten", "Wische deine Kombination", { verify: true }))) return; try { localStorage.removeItem(COMBO_KEY(handle())); localStorage.removeItem(FAIL_KEY(handle())); } catch (error) { /* storage blocked */ } open = false; toast("Die Chat-Sperre ist aus."); draw(); } }, "Sperre ausschalten"),
      ] : [h("button", { class: "btn primary", type: "button", onclick: async () => { await setup(); draw(); } }, "Kombination festlegen")];
      fill(box, h("section", { class: "card" }, h("h2", {}, "Chat-Sperre"), status, rules, h("div", { class: "lock-buttons" }, buttons)));
    }
    async function setup() {
      for (;;) {
        const first = await ask("Neue Kombination", "Wische sie einmal. Nicht zu lang.");
        if (!first) return;
        const template = Core.gestureTemplate(first);
        const again = await ask("Noch einmal", "Wische dieselbe Kombination zur Bestätigung");
        if (!again) return;
        if (Core.gestureScore(template, again) >= Core.GESTURE_PASS) {
          Y.writeJson(COMBO_KEY(handle()), { template, at: Date.now() });
          Y.writeJson(FAIL_KEY(handle()), { fails: 0, level: 0, until: 0 });
          open = true;
          toast("Die Kombination ist gespeichert. Die Chat-Sperre ist an.");
          return;
        }
        toast("Das war anders als vorher. Versuch es noch einmal.");
      }
    }
    draw();
    return box;
  };

  Y.chatLock = {
    enabled: () => !!(Y.me && stored()),
    locked: () => !!(Y.me && stored()) && !open,
    lockNow() { open = false; },
    forget() { open = false; },
  };

  /* The three pages that show chats are replaced by the lock while it is on. */
  for (const name of ["messages", "thread", "group"]) {
    const original = Y.views[name];
    if (!original) continue;
    Y.views[name] = (route, ctx) => (Y.chatLock.locked() ? Y.chatLockView(route, ctx) : original(route, ctx));
  }
})();
