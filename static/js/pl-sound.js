/* pinklemon -- UI sound. Every press and most things that happen make a
   short synthesised sound (Web Audio, no files). window.plSound.play(name)
   for explicit cues; a global listener covers taps and typing.
   Persisted mute via localStorage("pl_sound_off"); a small 🔊 toggle
   sits bottom-left. */
(function () {
  "use strict";

  var KEY = "pl_sound_off";
  var ctx = null;
  var muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) {}

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  function tone(o) {
    var c = ac();
    if (!c || muted) return;
    var t = c.currentTime;
    var dur = o.dur || 0.12;
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f0 || 440, t);
    if (o.f1) {
      try { osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + dur); }
      catch (e) { osc.frequency.linearRampToValueAtTime(o.f1, t + dur); }
    }
    var vol = o.vol == null ? 0.05 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + dur + 0.03);
  }

  function noise(dur, vol, freq) {
    var c = ac();
    if (!c || muted) return;
    var t = c.currentTime;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq || 1400; bp.Q.value = 0.8;
    var g = c.createGain();
    g.gain.setValueAtTime(vol == null ? 0.04 : vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(c.destination);
    src.start(t); src.stop(t + dur + 0.02);
  }

  var SOUNDS = {
    tap: function () { noise(0.045, 0.035, 1700); tone({ type: "triangle", f0: 170, f1: 110, dur: 0.045, vol: 0.025 }); },
    key: function () { noise(0.018, 0.02, 2600); },
    open: function () { tone({ type: "sine", f0: 300, f1: 640, dur: 0.16, vol: 0.045 }); },
    close: function () { tone({ type: "sine", f0: 560, f1: 240, dur: 0.14, vol: 0.04 }); },
    send: function () { tone({ type: "sine", f0: 480, f1: 900, dur: 0.13, vol: 0.055 }); },
    success: function () { tone({ type: "sine", f0: 640, dur: 0.08, vol: 0.045 }); setTimeout(function () { tone({ type: "sine", f0: 970, dur: 0.13, vol: 0.05 }); }, 65); },
    error: function () { tone({ type: "sawtooth", f0: 210, f1: 120, dur: 0.22, vol: 0.045 }); },
    like: function () { tone({ type: "sine", f0: 780, f1: 1500, dur: 0.14, vol: 0.055 }); },
    receive: function () { tone({ type: "sine", f0: 940, f1: 640, dur: 0.13, vol: 0.045 }); },
    nav: function () { tone({ type: "triangle", f0: 440, f1: 680, dur: 0.08, vol: 0.04 }); },
    toggle: function () { tone({ type: "square", f0: 520, dur: 0.05, vol: 0.04 }); }
  };

  function play(name) {
    if (muted) return;
    (SOUNDS[name] || SOUNDS.tap)();
  }

  // --- global: a sound for anything you press ---
  document.addEventListener("pointerdown", function (e) {
    if (muted || !e.isPrimary) return;
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable='']")) return;
    if (t.closest(".pl-soundtoggle")) return;
    if (t.closest("button, a, [role='button'], label, .pl-post, .pl-post-group, .pl-chatrow, .pl-userrow, .pl-comment, .pl-checkrow, .pl-game, .pl-nav a, .nx-row, .pl-att-game")) {
      play("tap");
    }
  }, true);

  // typing clicks + Enter-to-send
  document.addEventListener("keydown", function (e) {
    if (muted || e.metaKey || e.ctrlKey || e.altKey) return;
    var el = e.target;
    if (!el) return;
    var typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
    if (!typing) return;
    if (e.key === "Enter" && !e.shiftKey) play("send");
    else if (e.key === "Backspace" || (e.key && e.key.length === 1)) play("key");
  }, true);

  // any toast = something happened -> success or error tone
  var prevToast = window.plToast;
  window.plToast = function (msg) {
    if (typeof prevToast === "function") prevToast.apply(this, arguments);
    var m = String(msg || "").toLowerCase();
    play(/nicht|fehler|ging|warten|kein|leider|schon|müsst|nochmal/.test(m) ? "error" : "success");
  };

  window.plSound = {
    play: play,
    isOn: function () { return !muted; },
    toggle: function () {
      muted = !muted;
      try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch (e) {}
      if (!muted) { ac(); play("toggle"); }
      if (btn) btn.textContent = muted ? "🔇" : "🔊";
      return !muted;
    }
  };

  // --- small floating mute toggle ---
  var btn = null;
  function mkBtn() {
    if (btn || !document.body) return;
    btn = document.createElement("button");
    btn.className = "pl-soundtoggle";
    btn.type = "button";
    btn.setAttribute("aria-label", "Ton an/aus");
    btn.textContent = muted ? "🔇" : "🔊";
    btn.addEventListener("click", function (e) { e.stopPropagation(); window.plSound.toggle(); });
    document.body.appendChild(btn);
  }
  if (document.readyState !== "loading") mkBtn();
  else document.addEventListener("DOMContentLoaded", mkBtn);
})();
