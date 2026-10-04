/* gomat sound: every sound is made on the fly with the Web Audio API (no sound files to load). There is a
   sound for taps, menus, answers, hearts, gems, streaks, tests, the microphone and the shop. */
(function () {
  "use strict";

  let ctx = null;
  let out = null;
  let enabled = true;

  function audio() {
    if (!enabled) return null;
    try {
      if (!ctx) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) { enabled = false; return null; }
        ctx = new Context();
        const compressor = ctx.createDynamicsCompressor();
        out = ctx.createGain();
        out.gain.value = 0.9;
        out.connect(compressor).connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
      return ctx;
    } catch (error) {
      enabled = false;
      return null;
    }
  }

  /* One note: frequency (and an optional slide `to`), start offset and length in seconds. */
  function tone(freq, start, length, { type = "sine", volume = 0.1, to = null, attack = 0.012 } = {}) {
    const c = audio();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    const t0 = c.currentTime + start;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + length);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    osc.connect(gain).connect(out);
    osc.start(t0);
    osc.stop(t0 + length + 0.05);
  }

  /* A swish: filtered noise whose pitch sweeps from `from` to `to`. */
  function whoosh(start, length, { volume = 0.08, from = 400, to = 2400 } = {}) {
    const c = audio();
    if (!c) return;
    const frames = Math.max(1, Math.floor(c.sampleRate * length));
    const buffer = c.createBuffer(1, frames, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const source = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    const t0 = c.currentTime + start;
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + length);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + length * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    source.connect(filter).connect(gain).connect(out);
    source.start(t0);
  }

  const notes = (list, gap, length, options) => list.forEach((f, i) => tone(f, i * gap, length, options));

  const SOUNDS = {
    tap: () => tone(560, 0, 0.05, { type: "triangle", volume: 0.06 }),
    nav: () => { tone(420, 0, 0.07, { volume: 0.07 }); tone(630, 0.05, 0.09, { volume: 0.07 }); },
    node: () => tone(260, 0, 0.14, { type: "sine", volume: 0.11, to: 720 }),
    select: () => tone(740, 0, 0.06, { type: "triangle", volume: 0.07 }),
    key: () => tone(900, 0, 0.03, { type: "square", volume: 0.025 }),
    tile: () => tone(500, 0, 0.05, { type: "triangle", volume: 0.07, to: 640 }),
    open: () => { tone(380, 0, 0.08, { volume: 0.07 }); tone(570, 0.06, 0.1, { volume: 0.07 }); },
    close: () => { tone(570, 0, 0.07, { volume: 0.06 }); tone(380, 0.05, 0.09, { volume: 0.06 }); },
    right: () => notes([660, 880, 1175], 0.09, 0.2, { volume: 0.1 }),
    wrong: () => { tone(220, 0, 0.18, { type: "sawtooth", volume: 0.07 }); tone(165, 0.13, 0.28, { type: "sawtooth", volume: 0.07 }); },
    heart: () => { tone(520, 0, 0.35, { type: "triangle", volume: 0.1, to: 140 }); whoosh(0, 0.25, { volume: 0.05, from: 900, to: 200 }); },
    gem: () => notes([1319, 1760, 2093, 2637], 0.07, 0.22, { volume: 0.07 }),
    streak: () => { whoosh(0, 0.45, { volume: 0.07, from: 300, to: 1800 }); notes([523, 659, 784], 0.13, 0.25, { volume: 0.09 }); },
    finish: () => notes([523, 659, 784, 1047, 1319], 0.1, 0.32, { volume: 0.1 }),
    pass: () => { notes([392, 523, 659, 784, 1047], 0.11, 0.35, { volume: 0.11 }); tone(1568, 0.62, 0.7, { volume: 0.07 }); },
    fail: () => notes([392, 349, 311, 262], 0.2, 0.32, { type: "triangle", volume: 0.1 }),
    unlock: () => { tone(330, 0, 0.5, { type: "triangle", volume: 0.1, to: 1320 }); notes([1319, 1760], 0.4, 0.3, { volume: 0.07 }); },
    buy: () => { tone(988, 0, 0.1, { volume: 0.09 }); tone(1319, 0.09, 0.28, { volume: 0.09 }); },
    deny: () => { tone(200, 0, 0.12, { type: "square", volume: 0.05 }); tone(200, 0.16, 0.12, { type: "square", volume: 0.05 }); },
    micOn: () => notes([520, 780], 0.09, 0.14, { volume: 0.09 }),
    micOff: () => notes([780, 520], 0.09, 0.14, { volume: 0.08 }),
    whoosh: () => whoosh(0, 0.28, { volume: 0.06 }),
    goal: () => { notes([784, 988, 1175, 1568], 0.08, 0.3, { volume: 0.1 }); whoosh(0.1, 0.4, { volume: 0.04, from: 1000, to: 3000 }); },
  };

  window.GomatSound = {
    play(name) {
      const sound = SOUNDS[name];
      if (sound) sound();
    },
    setEnabled(value) { enabled = !!value; if (enabled) audio(); },
    isEnabled: () => enabled,
    names: Object.keys(SOUNDS),
  };
})();
