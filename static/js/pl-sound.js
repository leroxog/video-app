/* HEXAGONUM -- UI sound.
   A small synth engine: filtered-noise transients + detuned tonal bodies,
   eased envelopes, gentle stereo, a whisper of algorithmic reverb, and a
   master limiter. Taps are drawn from a pentatonic set with light
   velocity jitter so nothing sounds looped.
   window.plSound.play(name) for explicit cues; a global listener covers
   taps and typing. Persisted mute via localStorage("pl_sound_off"). */
(function () {
  "use strict";

  var KEY = "pl_sound_off";
  var ctx = null, master = null, verb = null;
  var muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) {}

  function makeImpulse(c, seconds, decay) {
    var n = Math.max(1, Math.floor(c.sampleRate * seconds));
    var buf = c.createBuffer(2, n, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }

      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -13; comp.knee.value = 14;
      comp.ratio.value = 9; comp.attack.value = 0.002; comp.release.value = 0.14;
      comp.connect(ctx.destination);

      master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(comp);

      // whisper of room -- makes cues feel placed, not dry
      try {
        var cv = ctx.createConvolver();
        cv.buffer = makeImpulse(ctx, 0.55, 3.2);
        verb = ctx.createGain();
        verb.gain.value = 0.9;
        verb.connect(cv); cv.connect(comp);
      } catch (e) { verb = null; }
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  function panNode(c, p) {
    if (p == null) return null;
    if (c.createStereoPanner) { var n = c.createStereoPanner(); n.pan.value = p; return n; }
    return null;
  }

  // eased gain envelope: fast attack, smooth exponential-ish release
  function envGain(c, t, dur, peak) {
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.setTargetAtTime(0.0001, t + Math.min(0.03, dur * 0.4), dur * 0.32);
    return g;
  }

  // one tonal event: optional detuned unison + a soft upper partial,
  // lowpass, envelope, pan, reverb send.
  function voice(o) {
    var c = ac(); if (!c || muted) return;
    var t = (o.at || 0) + c.currentTime;
    var dur = o.dur || 0.12;
    var vj = 1 + (Math.random() - 0.5) * (o.jit == null ? 0.04 : o.jit);   // pitch jitter
    var f0 = o.f0 * vj, f1 = o.f1 ? o.f1 * vj : 0;

    var lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(o.lp || 6000, t);
    if (o.lp1) lp.frequency.exponentialRampToValueAtTime(Math.max(200, o.lp1), t + dur);
    lp.Q.value = o.q || 0.5;

    var det = o.det || 0;                    // unison detune, cents
    var voices = det ? [-det, det] : [0];
    for (var k = 0; k < voices.length; k++) {
      var osc = c.createOscillator();
      osc.type = o.type || "sine";
      osc.detune.value = voices[k];
      osc.frequency.setValueAtTime(f0, t);
      if (f1) {
        try { osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + (o.gl || dur)); }
        catch (e) { osc.frequency.linearRampToValueAtTime(f1, t + (o.gl || dur)); }
      }
      osc.connect(lp);
      osc.start(t); osc.stop(t + dur + 0.08);
    }
    if (o.harm) {                            // soft shimmer partial
      var h = c.createOscillator();
      h.type = "sine";
      h.frequency.setValueAtTime(f0 * o.harm, t);
      if (f1) { try { h.frequency.exponentialRampToValueAtTime(Math.max(1, f1 * o.harm), t + (o.gl || dur)); } catch (e) {} }
      var hg = c.createGain(); hg.gain.value = 0.32;
      h.connect(hg); hg.connect(lp);
      h.start(t); h.stop(t + dur + 0.08);
    }

    var peak = (o.vol == null ? 0.06 : o.vol) * (1 + (Math.random() - 0.5) * 0.12);  // velocity jitter
    var g = envGain(c, t, dur, peak);
    var p = panNode(c, o.pan);
    lp.connect(g);
    if (p) { g.connect(p); p.connect(master); if (verb && o.rev) { var s = c.createGain(); s.gain.value = o.rev; p.connect(s); s.connect(verb); } }
    else { g.connect(master); if (verb && o.rev) { var s2 = c.createGain(); s2.gain.value = o.rev; g.connect(s2); s2.connect(verb); } }
  }

  // filtered-noise transient -- the tactile "tick"
  function tick(o) {
    var c = ac(); if (!c || muted) return;
    var t = (o.at || 0) + c.currentTime;
    var dur = o.dur || 0.018;
    var n = Math.max(1, Math.floor(c.sampleRate * dur));
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.2);
    var src = c.createBufferSource(); src.buffer = buf;
    var bp = c.createBiquadFilter();
    bp.type = o.type || "bandpass";
    bp.frequency.value = o.freq || 2800; bp.Q.value = o.q || 1.0;
    var g = c.createGain();
    g.gain.setValueAtTime(o.vol == null ? 0.045 : o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var p = panNode(c, o.pan);
    src.connect(bp); bp.connect(g);
    if (p) { g.connect(p); p.connect(master); } else { g.connect(master); }
    src.start(t); src.stop(t + dur + 0.02);
  }

  // noise sweep -- swipes / whooshes
  function sweep(o) {
    var c = ac(); if (!c || muted) return;
    var t = c.currentTime;
    var dur = o.dur || 0.16;
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
    var src = c.createBufferSource(); src.buffer = buf;
    var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = o.q || 3;
    bp.frequency.setValueAtTime(o.f0 || 500, t);
    bp.frequency.exponentialRampToValueAtTime(o.f1 || 3500, t + dur);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol == null ? 0.03 : o.vol, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(master);
    if (verb) { var s = c.createGain(); s.gain.value = 0.18; g.connect(s); s.connect(verb); }
    src.start(t); src.stop(t + dur + 0.02);
  }

  // pentatonic (C major pentatonic across two octaves) for taps
  var PENTA = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];
  var pentaIdx = 0;
  function nextTapNote() {
    // gentle random walk so a burst of taps sounds like a phrase
    pentaIdx += (Math.random() < 0.5 ? -1 : 1) * (1 + (Math.random() < 0.3 ? 1 : 0));
    if (pentaIdx < 0) pentaIdx = 1;
    if (pentaIdx >= PENTA.length) pentaIdx = PENTA.length - 2;
    return PENTA[pentaIdx];
  }
  function rpan() { return (Math.random() - 0.5) * 0.5; }

  var SOUNDS = {
    tap: function () {
      var p = rpan();
      tick({ dur: 0.012, freq: 3200, vol: 0.022, pan: p });
      voice({ type: "sine", f0: nextTapNote(), dur: 0.055, vol: 0.028, lp: 6500, harm: 2, pan: p, rev: 0.06, jit: 0.02 });
    },
    key: function () { tick({ dur: 0.009, freq: 3600, vol: 0.016, pan: rpan() }); },
    pop: function () {
      var p = rpan();
      tick({ dur: 0.011, freq: 2600, vol: 0.026, pan: p });
      voice({ type: "sine", f0: 320, f1: 1050, dur: 0.09, gl: 0.06, vol: 0.055, lp: 4600, pan: p, rev: 0.1 });
    },
    open: function () {
      sweep({ f0: 380, f1: 2600, dur: 0.14, vol: 0.022 });
      voice({ type: "triangle", f0: 523, f1: 1046, dur: 0.16, gl: 0.13, vol: 0.04, lp: 5400, det: 6, harm: 2, rev: 0.14 });
    },
    close: function () {
      sweep({ f0: 2600, f1: 380, dur: 0.13, vol: 0.02 });
      voice({ type: "triangle", f0: 1046, f1: 523, dur: 0.14, gl: 0.12, vol: 0.038, lp: 4200, det: 6, rev: 0.1 });
    },
    // bright rising three-note swoosh
    send: function () {
      sweep({ f0: 600, f1: 4200, dur: 0.13, vol: 0.02 });
      voice({ type: "sine", f0: 587.33, dur: 0.06, vol: 0.04, lp: 6500, harm: 2, pan: -0.15, rev: 0.1 });
      voice({ type: "sine", f0: 880, dur: 0.06, vol: 0.045, lp: 7000, harm: 2, pan: 0.05, rev: 0.12, at: 0.04 });
      voice({ type: "sine", f0: 1318.51, dur: 0.11, vol: 0.05, lp: 8000, harm: 2, pan: 0.2, rev: 0.16, at: 0.08 });
    },
    // consonant major arpeggio with a shimmer tail
    success: function () {
      voice({ type: "sine", f0: 659.25, dur: 0.10, vol: 0.04, lp: 6500, harm: 2, det: 5, pan: -0.12, rev: 0.14 });
      voice({ type: "sine", f0: 987.77, dur: 0.11, vol: 0.045, lp: 7000, harm: 2, det: 5, pan: 0.05, rev: 0.16, at: 0.07 });
      voice({ type: "sine", f0: 1318.51, dur: 0.20, vol: 0.05, lp: 8000, harm: 3, det: 6, pan: 0.18, rev: 0.24, at: 0.14 });
    },
    // soft, warm "no" -- muted, low, never harsh
    error: function () {
      voice({ type: "sine", f0: 392, f1: 330, dur: 0.11, gl: 0.09, vol: 0.05, lp: 1500, lp1: 700, det: 8, rev: 0.1 });
      voice({ type: "sine", f0: 294, f1: 233, dur: 0.20, gl: 0.16, vol: 0.05, lp: 1200, lp1: 500, det: 8, rev: 0.14, at: 0.11 });
    },
    // sparkle up
    like: function () {
      tick({ dur: 0.008, freq: 6000, vol: 0.016, pan: 0.1 });
      voice({ type: "sine", f0: 880, f1: 1400, dur: 0.06, gl: 0.06, vol: 0.045, lp: 9000, harm: 2, pan: -0.1, rev: 0.12 });
      voice({ type: "sine", f0: 1318, f1: 2100, dur: 0.10, gl: 0.09, vol: 0.04, lp: 10000, harm: 2, pan: 0.15, rev: 0.2, at: 0.045 });
      voice({ type: "sine", f0: 1976, f1: 2960, dur: 0.14, gl: 0.11, vol: 0.03, lp: 12000, pan: 0.3, rev: 0.28, at: 0.09 });
    },
    // gentle two-tone bell for anything incoming
    receive: function () {
      voice({ type: "sine", f0: 1244.51, dur: 0.12, vol: 0.04, lp: 7500, harm: 2.01, det: 4, pan: -0.1, rev: 0.2 });
      voice({ type: "sine", f0: 1661.22, dur: 0.28, vol: 0.045, lp: 8500, harm: 2.01, det: 4, pan: 0.12, rev: 0.3, at: 0.09 });
    },
    nav: function () {
      sweep({ f0: 500, f1: 2200, dur: 0.09, vol: 0.02 });
      voice({ type: "triangle", f0: 587, f1: 880, dur: 0.08, gl: 0.06, vol: 0.035, lp: 5200, harm: 2, rev: 0.1 });
    },
    toggle: function () {
      voice({ type: "sine", f0: 784, dur: 0.06, vol: 0.045, lp: 6500, harm: 2, det: 5, rev: 0.12 });
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

  // no visible toggle button -- mute via window.plSound.toggle()
  var btn = null;
})();
