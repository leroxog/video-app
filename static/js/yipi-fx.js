/* Nex effects (yipi-fx.js): the small things that make the page feel alive. Sounds (made in the browser with the Web Audio API, no files; they can
   be switched off in the settings), the heart that bursts out where a finger or the mouse just was, double tap / double click, the loading
   animation (the heartbeat of the Nex logo, like a heart monitor: beats of any height, up or down, but smooth), the page that slides in from the
   right when something is opened and slides back with a swipe to the right. Nothing here needs the network. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const { h, icon } = Y;
  const reduced = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ------------------------------------------------------------------------------------------------ sounds
  const PREF = "yipi.sound";
  let on = true;
  try { on = localStorage.getItem(PREF) !== "off"; } catch (error) { on = true; }
  let audio = null;
  let lastTick = 0;

  function context() {
    if (!audio) {
      const Maker = window.AudioContext || window.webkitAudioContext;
      if (!Maker) return null;
      try { audio = new Maker(); } catch (error) { return null; }
    }
    if (audio.state === "suspended") audio.resume().catch(() => {});
    return audio;
  }
  /* One note: frequency (and where it slides to), start (seconds from now), length, loudness, wave. */
  function note(ctx, { f, to, at = 0, dur = 0.08, gain = 0.05, type = "sine" }) {
    const start = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.012, dur / 3));
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }
  const SOUNDS = {
    tap: [{ f: 620, dur: 0.045, gain: 0.035 }],
    type: [{ f: 1500, to: 1100, dur: 0.022, gain: 0.014, type: "square" }],
    like: [{ f: 659, dur: 0.07, gain: 0.06 }, { f: 880, at: 0.06, dur: 0.07, gain: 0.06 }, { f: 1175, at: 0.12, dur: 0.12, gain: 0.05 }],
    unlike: [{ f: 520, to: 380, dur: 0.1, gain: 0.04 }],
    send: [{ f: 420, to: 980, dur: 0.14, gain: 0.05, type: "triangle" }],
    receive: [{ f: 880, dur: 0.08, gain: 0.06 }, { f: 1320, at: 0.09, dur: 0.14, gain: 0.05 }],
    open: [{ f: 480, to: 760, dur: 0.07, gain: 0.03, type: "triangle" }],
    follow: [{ f: 660, to: 990, dur: 0.12, gain: 0.05 }],
    success: [{ f: 523, dur: 0.08, gain: 0.055 }, { f: 659, at: 0.08, dur: 0.08, gain: 0.055 }, { f: 784, at: 0.16, dur: 0.14, gain: 0.055 }],
    error: [{ f: 220, dur: 0.12, gain: 0.05, type: "square" }, { f: 170, at: 0.1, dur: 0.16, gain: 0.05, type: "square" }],
    unlock: [{ f: 392, dur: 0.07, gain: 0.05 }, { f: 587, at: 0.07, dur: 0.12, gain: 0.05 }],
    level: [{ f: 523, dur: 0.1, gain: 0.06 }, { f: 659, at: 0.1, dur: 0.1, gain: 0.06 }, { f: 784, at: 0.2, dur: 0.1, gain: 0.06 }, { f: 1047, at: 0.3, dur: 0.28, gain: 0.06 }],
  };
  const quiet = () => { const cam = document.getElementById("app")?.dataset.cam; return cam === "playing" || cam === "over" || cam === "starting"; };   // (the microphone is recording then)
  const sound = {
    get enabled() { return on; },
    set(value) { on = !!value; try { if (on) localStorage.removeItem(PREF); else localStorage.setItem(PREF, "off"); } catch (error) { /* storage blocked */ } if (on) sound.play("success"); },
    play(name) {
      if (!on || document.hidden || quiet()) return;
      const ctx = context();
      const parts = SOUNDS[name];
      if (!ctx || !parts) return;
      const pitch = name === "type" ? 0.9 + Math.random() * 0.25 : 1;
      for (const part of parts) note(ctx, { ...part, f: part.f * pitch, to: part.to ? part.to * pitch : undefined });
    },
  };
  // typing makes a very quiet click (not in password fields, and not more often than every 45 ms)
  document.addEventListener("input", (event) => {
    const el = event.target;
    if (!el || !(el.matches && el.matches("textarea, input:not([type=password]):not([type=range]):not([type=file]):not([type=checkbox]):not([type=radio])"))) return;
    if (event.inputType && /^delete/.test(event.inputType) && Math.random() < 0.4) return;
    const now = performance.now();
    if (now - lastTick < 45) return;
    lastTick = now;
    sound.play("type");
  }, true);
  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (target && target.closest && target.closest(".tab-item, .btn, .icon-btn, .chip, .tab, .menu-item")) sound.play("tap");
  }, true);

  // ------------------------------------------------------------------------------------------------ the heart that bursts
  /* A big heart pops up where the finger (or the mouse) is, small ones fly out of it. */
  function likeBurst(x, y, { size = 84 } = {}) {
    if (reduced()) return;
    const layer = h("div", { class: "like-burst", "aria-hidden": "true", style: `left:${Math.round(x)}px;top:${Math.round(y)}px` });
    const big = h("span", { class: "burst-heart", style: `width:${size}px;height:${size}px` }, icon("heartFill"));
    layer.append(big);
    for (let k = 0; k < 7; k++) {
      const angle = (k / 7) * Math.PI * 2 + Math.random() * 0.5;
      const distance = size * (0.7 + Math.random() * 0.6);
      layer.append(h("span", { class: "burst-bit", style: `--dx:${Math.round(Math.cos(angle) * distance)}px;--dy:${Math.round(Math.sin(angle) * distance - 20)}px;animation-delay:${Math.round(Math.random() * 80)}ms` }, icon("heartFill")));
    }
    document.body.append(layer);
    setTimeout(() => layer.remove(), 950);
  }

  /* Calls `handler(x, y)` when somebody taps (or clicks) twice quickly on `element`; `ignore` is a selector of things inside that keep their own taps. */
  function onDoubleTap(element, handler, { ignore = "a, button, input, textarea, select, .menu" } = {}) {
    let last = null;
    element.addEventListener("pointerup", (event) => {
      if (event.button > 0 || (ignore && event.target.closest && event.target.closest(ignore))) { last = null; return; }
      const now = performance.now();
      if (last && now - last.t < 320 && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 36) { last = null; handler(event.clientX, event.clientY, event); return; }
      last = { t: now, x: event.clientX, y: event.clientY };
    });
  }

  // ------------------------------------------------------------------------------------------------ the heartbeat
  const gauss = (x, s) => Math.exp(-(x * x) / (2 * s * s));
  const beatShape = (dt, a) => a * (0.12 * gauss(dt + 0.17, 0.04) - 0.1 * gauss(dt + 0.045, 0.012) + gauss(dt, 0.014) - 0.22 * gauss(dt - 0.04, 0.016) + 0.2 * gauss(dt - 0.27, 0.06));

  /* The loading animation: a line runs from left to right like on a heart monitor; every now and then a beat, each one as high or low as the dice say
     (mostly up, sometimes down). `compact` is a small one for a line of text, `strip` a long thin one (the top of Home). */
  function pulseLoader({ width = 150, height = 52, label = "Lädt …", compact = false } = {}) {
    const w = compact ? 64 : width;
    const hh = compact ? 26 : height;
    const canvas = h("canvas", { class: "pulse-canvas", "aria-hidden": "true" });
    const wrap = h("span", { class: `pulse-loader${compact ? " compact" : ""}`, role: "status", "aria-label": label }, canvas);
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hh}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const WINDOW = 2.6;
    const beats = [];
    let clock = 0;
    let nextBeat = 0.25;
    let seen = false;
    let born = performance.now();
    let last = 0;
    let color = "";
    function addBeats(until) {
      while (nextBeat < until + 0.5) {
        beats.push({ at: nextBeat, a: (0.45 + Math.random() * 0.55) * (Math.random() < 0.2 ? -0.75 : 1) });
        nextBeat += 0.55 + Math.random() * 0.75;
      }
      while (beats.length && beats[0].at < until - WINDOW - 0.6) beats.shift();
    }
    const valueAt = (t) => { let v = 0; for (const b of beats) { const dt = t - b.at; if (dt > -0.4 && dt < 0.7) v += beatShape(dt, b.a); } return v; };
    function paint() {
      if (!color) color = getComputedStyle(canvas).color || "#fff";
      ctx.clearRect(0, 0, w, hh);
      const mid = hh * 0.58;
      const gradient = ctx.createLinearGradient(0, 0, w, 0);
      gradient.addColorStop(0, "rgba(128,128,128,0)");
      gradient.addColorStop(0.55, color);
      gradient.addColorStop(1, color);
      ctx.strokeStyle = gradient;
      ctx.lineWidth = compact ? 2 : 2.6;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      let endY = mid;
      for (let x = 0; x <= w; x += 1.5) {
        const t = clock - ((w - x) / w) * WINDOW;
        const y = mid - valueAt(t) * (hh * 0.46);
        endY = y;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(w - 2, endY, compact ? 2.4 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    function frame(now) {
      if (canvas.isConnected) seen = true;
      if ((seen && !canvas.isConnected) || (!seen && now - born > 4000)) return;
      clock += Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      addBeats(clock);
      paint();
      requestAnimationFrame(frame);
    }
    if (reduced()) { addBeats(1); clock = 0.9; paint(); } else requestAnimationFrame((now) => { born = now; frame(now); });
    return wrap;
  }

  // ------------------------------------------------------------------------------------------------ swipe to the right: back
  const NO_SWIPE = new Set(["home", "messages", "nex", "camera", "videos", "login", "signup", "explore", "notifications"]);
  function enableEdgeSwipe() {
    let start = null;
    document.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      const route = document.getElementById("app")?.dataset.route || "";
      if (event.touches.length !== 1 || NO_SWIPE.has(route) || !(history.state && history.state.inApp) || document.body.classList.contains("modal-open") || (event.target.closest && event.target.closest("video, canvas, input[type=range], .wheel, [data-no-swipe]"))) { start = null; return; }
      start = touch.clientX < 34 ? { x: touch.clientX, y: touch.clientY, t: performance.now() } : null;
    }, { passive: true });
    document.addEventListener("touchend", (event) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - start.x, dy = touch.clientY - start.y;
      const quick = performance.now() - start.t < 900;
      start = null;
      if (dx > 80 && Math.abs(dy) < dx * 0.6 && quick) { sound.play("open"); Y.back(Y.HOME); }
    }, { passive: true });
  }

  Object.assign(Y, { sound, likeBurst, onDoubleTap, pulseLoader });
  enableEdgeSwipe();
})();
