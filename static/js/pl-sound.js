/* HEXAGONUM -- UI sound. Short, bright, modern synth cues (Web Audio, no
   files) for every press and most things that happen. window.plSound.play(name)
   for explicit cues; a global listener covers taps and typing.
   Persisted mute via localStorage("pl_sound_off"); a small toggle sits in
   a corner. */
(function () {
  "use strict";

  var KEY = "pl_sound_off";
  var ctx = null, master = null;
  var muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) {}

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
      // gentle limiter so layered cues stay clean and even
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 12;
      comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.12;
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // one tonal partial with an attack/decay envelope + optional lowpass
  function voice(o) {
    var c = ac(); if (!c || muted) return;
    var t = (o.at || 0) + c.currentTime;
    var dur = o.dur || 0.12;
    var osc = c.createOscillator();
    osc.type = o.type || "sine";
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) {
      try { osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.gl || dur)); }
      catch (e) { osc.frequency.linearRampToValueAtTime(o.f1, t + (o.gl || dur)); }
    }
    var node = osc;
    if (o.lp) {
      var f = c.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = o.lp; f.Q.value = o.q || 0.6;
      osc.connect(f); node = f;
    }
    var g = c.createGain();
    var peak = o.vol == null ? 0.06 : o.vol;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.a || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.03);
  }

  // short filtered noise transient -- the "tick" that makes a cue feel tactile
  function tick(o) {
    var c = ac(); if (!c || muted) return;
    var t = (o.at || 0) + c.currentTime;
    var dur = o.dur || 0.02;
    var n = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    var src = c.createBufferSource(); src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = o.freq || 2600; bp.Q.value = o.q || 1.1;
    var g = c.createGain();
    g.gain.setValueAtTime(o.vol == null ? 0.05 : o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  var SOUNDS = {
    // crisp, near-subliminal press
    tap: function () {
      tick({ dur: 0.014, freq: 3000, vol: 0.028 });
      voice({ type: "sine", f0: 1050, f1: 760, dur: 0.05, gl: 0.05, vol: 0.03, lp: 5000 });
    },
    key: function () { tick({ dur: 0.01, freq: 3400, vol: 0.02 }); },
    // bubbly upward "pop"
    pop: function () {
      tick({ dur: 0.012, freq: 2400, vol: 0.03 });
      voice({ type: "sine", f0: 300, f1: 1000, dur: 0.09, gl: 0.07, vol: 0.06, lp: 4200 });
    },
    // airy rise / fall for panels
    open: function () {
      voice({ type: "triangle", f0: 520, f1: 1040, dur: 0.14, gl: 0.12, vol: 0.045, lp: 5200 });
      voice({ type: "sine", f0: 780, f1: 1560, dur: 0.14, gl: 0.12, vol: 0.03, lp: 6000, at: 0.01 });
    },
    close: function () {
      voice({ type: "triangle", f0: 900, f1: 440, dur: 0.13, gl: 0.11, vol: 0.04, lp: 4200 });
    },
    // quick 3-step swoosh up
    send: function () {
      voice({ type: "sine", f0: 523, dur: 0.05, vol: 0.045, lp: 6000 });
      voice({ type: "sine", f0: 784, dur: 0.05, vol: 0.05, lp: 6000, at: 0.035 });
      voice({ type: "sine", f0: 1175, dur: 0.09, vol: 0.055, lp: 7000, at: 0.07 });
    },
    // pleasant major arpeggio
    success: function () {
      voice({ type: "sine", f0: 659, dur: 0.09, vol: 0.045, lp: 6000 });
      voice({ type: "sine", f0: 988, dur: 0.10, vol: 0.05, lp: 6500, at: 0.06 });
      voice({ type: "sine", f0: 1319, dur: 0.16, vol: 0.05, lp: 7000, at: 0.12 });
    },
    // soft, non-harsh "no"
    error: function () {
      voice({ type: "sine", f0: 360, f1: 300, dur: 0.10, gl: 0.09, vol: 0.05, lp: 1400 });
      voice({ type: "sine", f0: 300, f1: 232, dur: 0.16, gl: 0.14, vol: 0.05, lp: 1200, at: 0.10 });
    },
    // sparkle
    like: function () {
      tick({ dur: 0.01, freq: 5200, vol: 0.02 });
      voice({ type: "sine", f0: 880, f1: 1400, dur: 0.06, gl: 0.06, vol: 0.05, lp: 8000 });
      voice({ type: "sine", f0: 1320, f1: 2100, dur: 0.10, gl: 0.09, vol: 0.045, lp: 9000, at: 0.05 });
    },
    // gentle two-tone bell for anything incoming
    receive: function () {
      voice({ type: "sine", f0: 1245, dur: 0.10, vol: 0.045, lp: 7000 });
      voice({ type: "sine", f0: 1661, dur: 0.20, vol: 0.05, lp: 8000, at: 0.08 });
    },
    nav: function () {
      voice({ type: "triangle", f0: 540, f1: 820, dur: 0.07, gl: 0.06, vol: 0.04, lp: 5000 });
    },
    toggle: function () {
      voice({ type: "sine", f0: 720, dur: 0.05, vol: 0.045, lp: 6000 });
    }
  };

  function play(name) {
    if (muted) return;
    (SOUNDS[name] || SOUNDS.tap)();
  }

  // --- global: a sound for anything you press ---
  document.addEventListener("pointerdown", function (e) {
    if (muted || (e.isPrimary === false)) return;
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
