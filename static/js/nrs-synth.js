/* NRS Synth -- turns a small song "plan" (tempo, key, scale, chords, seed ...) into real music with the
   Web Audio API. Nothing is sampled or downloaded: drums, bass, chords and lead are built from oscillators
   and noise, arranged into sections (intro, verse, chorus ...) and rendered once into an AudioBuffer. */
(function (root) {
  "use strict";

  var SR = 44100;
  var NOTE = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
  var SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], pentatonic: [0, 2, 4, 7, 9] };
  var CHORDS = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], sus2: [0, 2, 7] };

  // ---- voices: oscillator type, detune stack, filter, envelope (a/d/s/r), level, reverb send
  var VOICES = {
    pad:      { type: "sawtooth", detune: [-9, 9], cutoff: 1300, q: 0.6, a: 0.5, d: 0.6, s: 0.7, r: 1.2, g: 0.075, send: 0.5 },
    strings:  { type: "sawtooth", detune: [-12, 0, 12], cutoff: 1700, q: 0.5, a: 1.0, d: 0.5, s: 0.85, r: 1.6, g: 0.06, send: 0.65 },
    ep:       { type: "sine", detune: [0, 3], partial: [2, 0.4], cutoff: 3400, q: 0.3, a: 0.008, d: 1.1, s: 0.0, r: 0.5, g: 0.13, send: 0.4 },
    stab:     { type: "sawtooth", detune: [-6, 6], cutoff: 2300, q: 1.2, a: 0.004, d: 0.2, s: 0.05, r: 0.1, g: 0.075, send: 0.25 },
    pluck:    { type: "triangle", detune: [0], cutoff: 3200, q: 0.4, a: 0.003, d: 0.4, s: 0, r: 0.12, g: 0.17, send: 0.3 },
    saw:      { type: "sawtooth", detune: [-7, 7], cutoff: 3100, q: 0.8, a: 0.012, d: 0.25, s: 0.55, r: 0.28, g: 0.07, send: 0.35, vib: 5 },
    sine:     { type: "sine", detune: [0, 4], cutoff: 4200, q: 0.3, a: 0.02, d: 0.3, s: 0.6, r: 0.35, g: 0.16, send: 0.4, vib: 4.5 },
    bell:     { type: "sine", detune: [0], partial: [3.01, 0.3], cutoff: 6000, q: 0.3, a: 0.004, d: 1.6, s: 0, r: 1.0, g: 0.12, send: 0.7 },
    guitar:   { type: "sawtooth", detune: [-5, 5], cutoff: 2600, q: 0.9, a: 0.004, d: 0.3, s: 0.35, r: 0.12, g: 0.06, send: 0.15, drive: true },
    gtrlead:  { type: "sawtooth", detune: [-4, 4], cutoff: 3600, q: 1.0, a: 0.01, d: 0.3, s: 0.6, r: 0.2, g: 0.055, send: 0.25, drive: true, vib: 5.5 },
    pulse25:  { type: "pulse", duty: 0.25, detune: [0], cutoff: 9000, q: 0.2, a: 0.002, d: 0.1, s: 0.5, r: 0.04, g: 0.07, send: 0.05 },
    pulse50:  { type: "pulse", duty: 0.5, detune: [0], cutoff: 9000, q: 0.2, a: 0.002, d: 0.15, s: 0.55, r: 0.05, g: 0.07, send: 0.05 },
    tri:      { type: "triangle", detune: [0], cutoff: 5000, q: 0.2, a: 0.002, d: 0.1, s: 0.8, r: 0.04, g: 0.2, send: 0 },
    bass:     { type: "sawtooth", detune: [0], sub: true, cutoff: 650, q: 1.0, a: 0.006, d: 0.18, s: 0.55, r: 0.08, g: 0.15, send: 0 },
    bassSoft: { type: "triangle", detune: [0], sub: true, cutoff: 500, q: 0.6, a: 0.01, d: 0.25, s: 0.6, r: 0.12, g: 0.2, send: 0 },
    sub:      { type: "sine", detune: [0], glide: 1.5, cutoff: 400, q: 0.3, a: 0.004, d: 0.5, s: 0.7, r: 0.3, g: 0.34, send: 0 },
  };

  // ---- genre styles: 16-step drum patterns (digit = loudness), bass/chord/lead behavior, space
  var STYLES = {
    pop: { kick: "9000000090100000", snare: "0000900000009000", hat: "7050705070507050", kit: { k0: 150, k1: 48, kd: 0.32, sf: 2100, st: 190, hf: 7600 },
           bass: { voice: "bass", pat: [[0, 3, 0], [4, 2, 0], [6, 2, 7], [8, 3, 0], [12, 2, 0], [14, 2, 12]] },
           chord: { voice: "pad", rhythm: [[0, 16]], bars: 1 }, stab: { voice: "stab", rhythm: [[0, 2], [6, 2], [10, 2]] },
           lead: { voice: "saw", dens: 0.9, oct: 12, rhythms: [[[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]]] }, verb: 0.28 },
    lofi: { kick: "9000000000900000", snare: "0000800000008000", hat: "5030503050305030", kit: { k0: 120, k1: 42, kd: 0.28, sf: 1500, st: 170, hf: 5200, soft: true }, crackle: true,
            bass: { voice: "bassSoft", pat: [[0, 5, 0], [6, 4, 7], [10, 4, 0]] },
            chord: { voice: "ep", rhythm: [[0, 6], [6, 4], [10, 6]], bars: 1 },
            lead: { voice: "sine", dens: 0.62, oct: 12, rhythms: [[[0, 3], [4, 2], [8, 4], [12, 3]], [[2, 3], [6, 3], [10, 2], [12, 4]]] }, verb: 0.36 },
    hiphop: { kick: "9000000090900000", snare: "0000900000009000", hat: "6466646664666466", kit: { k0: 110, k1: 38, kd: 0.5, sf: 1900, st: 180, hf: 6800 },
              bass: { voice: "sub", pat: [[0, 6, 0], [8, 4, 0], [12, 4, 7]] },
              chord: { voice: "pad", rhythm: [[0, 16]], bars: 1 },
              lead: { voice: "pluck", dens: 0.55, oct: 12, rhythms: [[[0, 3], [6, 2], [8, 3], [14, 2]], [[2, 2], [6, 3], [10, 2], [12, 3]]] }, verb: 0.25 },
    house: { kick: "9000900090009000", clap: "0000900000009000", hat: "3030303030303030", ohat: "0050005000500050", kit: { k0: 140, k1: 46, kd: 0.3, sf: 2300, st: 200, hf: 8000 }, duck: true,
             bass: { voice: "bass", pat: [[2, 2, 0], [6, 2, 0], [10, 2, 0], [14, 2, 12]] },
             chord: { voice: "pad", rhythm: [[0, 16]], bars: 1 }, stab: { voice: "stab", rhythm: [[3, 2], [7, 2], [10, 2], [14, 2]] },
             lead: { voice: "saw", dens: 0.6, oct: 12, rhythms: [[[0, 2], [3, 2], [6, 2], [10, 2], [12, 2]], [[2, 2], [6, 2], [8, 2], [14, 2]]] }, verb: 0.3 },
    rock: { kick: "9000009000900000", snare: "0000900000009000", hat: "7060706070607060", kit: { k0: 130, k1: 50, kd: 0.28, sf: 2400, st: 210, hf: 7000 },
            bass: { voice: "bass", pat: [[0, 2, 0], [2, 2, 0], [4, 2, 0], [6, 2, 0], [8, 2, 0], [10, 2, 0], [12, 2, 0], [14, 2, 0]] },
            chord: { voice: "guitar", rhythm: [[0, 4], [4, 4], [8, 4], [12, 4]], bars: 1, power: true },
            lead: { voice: "gtrlead", dens: 0.75, oct: 12, rhythms: [[[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 6], [14, 2]]] }, verb: 0.18 },
    ambient: { chord: { voice: "strings", rhythm: [[0, 16]], bars: 2 }, bass: { voice: "sub", pat: [[0, 16, 0]] },
               lead: { voice: "bell", dens: 0.4, oct: 24, rhythms: [[[0, 4], [8, 4]], [[4, 4], [12, 4]], [[2, 4], [10, 4]]] }, verb: 0.75, hat: "0000000000000000" },
    cinematic: { kick: "9000000000000000", kickLoud: "9000000090000000", kit: { k0: 90, k1: 34, kd: 0.8, sf: 1000, st: 120, hf: 6000 },
                 bass: { voice: "sub", pat: [[0, 16, 0]] }, chord: { voice: "strings", rhythm: [[0, 16]], bars: 1 },
                 arp: { voice: "pluck", div: 2 },
                 lead: { voice: "strings", dens: 0.5, oct: 12, rhythms: [[[0, 8], [8, 8]], [[0, 6], [8, 8]]] }, verb: 0.6 },
    chiptune: { kick: "9000000090000000", snare: "0000900000009000", hat: "5050505050505050", kit: { k0: 160, k1: 50, kd: 0.18, sf: 3200, st: 220, hf: 9000, chip: true },
                bass: { voice: "tri", pat: [[0, 2, 0], [2, 2, 12], [4, 2, 0], [6, 2, 12], [8, 2, 0], [10, 2, 12], [12, 2, 0], [14, 2, 12]] },
                chord: { voice: "pulse25", rhythm: [], bars: 1 }, arp: { voice: "pulse25", div: 1 },
                lead: { voice: "pulse50", dens: 0.88, oct: 12, rhythms: [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]]] }, verb: 0.05 },
  };

  var FULL = [["Intro", 1, 0], ["Strophe", 2, 1], ["Refrain", 2, 2], ["Strophe", 1.5, 1], ["Refrain", 2, 2], ["Outro", 1, 0]];
  var SHORT = [["Strophe", 1, 1], ["Refrain", 1.4, 2], ["Outro", 0.6, 0]];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  /* ---------------------------------------------------------------- layout */

  function layout(plan) {
    var barSec = 4 * 60 / plan.bpm;
    var total = Math.max(4, Math.ceil(plan.duration / barSec));
    var template = total < 12 ? SHORT : FULL;
    var weightSum = template.reduce(function (s, t) { return s + t[1]; }, 0);
    var bars = template.map(function (t) { return Math.max(1, Math.floor(total * t[1] / weightSum)); });
    var left = total - bars.reduce(function (s, b) { return s + b; }, 0);
    for (var i = 0; left > 0; i = (i + 1) % bars.length) { bars[i]++; left--; }
    for (i = bars.length - 1; left < 0; i = (i - 1 + bars.length) % bars.length) { if (bars[i] > 1) { bars[i]--; left++; } }
    var start = 0;
    return {
      barSec: barSec, total: total,
      sections: template.map(function (t, k) { var s = { name: t[0], i: t[2], start: start, bars: bars[k] }; start += bars[k]; return s; }),
    };
  }

  /* ------------------------------------------------------------ sound blocks */

  function noiseBuffer(c) {
    var b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
    var rng = mulberry32(99);
    for (var i = 0; i < d.length; i++) d[i] = rng() * 2 - 1;
    return b;
  }

  function impulse(c, seconds) {
    var len = Math.floor(c.sampleRate * seconds), b = c.createBuffer(2, len, c.sampleRate), rng = mulberry32(7);
    for (var ch = 0; ch < 2; ch++) {
      var d = b.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (rng() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return b;
  }

  function driveCurve() {
    var n = 1024, curve = new Float32Array(n);
    for (var i = 0; i < n; i++) { var x = i * 2 / (n - 1) - 1; curve[i] = Math.tanh(x * 4) * 0.7; }
    return curve;
  }

  function pulseWave(c, duty) {
    var n = 64, real = new Float32Array(n), imag = new Float32Array(n);
    for (var k = 1; k < n; k++) {
      real[k] = Math.sin(2 * Math.PI * k * duty) / (Math.PI * k);
      imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (Math.PI * k);
    }
    return c.createPeriodicWave(real, imag);
  }

  function makeRig(c, style, duration) {
    var rig = { c: c, noise: noiseBuffer(c), waves: {}, shaper: null };
    var master = c.createGain();
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.008; comp.release.value = 0.22; comp.knee.value = 8;
    master.connect(comp); comp.connect(c.destination);
    var fade = Math.min(3, Math.max(1, duration * 0.08));
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(0.8, 0.04);
    master.gain.setValueAtTime(0.8, Math.max(0.05, duration - fade));
    master.gain.linearRampToValueAtTime(0, duration);
    var verb = c.createConvolver();
    verb.buffer = impulse(c, 0.6 + style.verb * 2.4);
    var verbGain = c.createGain();
    verbGain.gain.value = style.verb;
    verb.connect(verbGain); verbGain.connect(master);
    rig.verb = verb;
    ["drums", "bass", "chords", "lead"].forEach(function (name) {
      var g = c.createGain();
      g.gain.value = { drums: 1, bass: 1, chords: 1, lead: 1 }[name];
      g.connect(master);
      rig[name] = g;
    });
    return rig;
  }

  function noiseHit(rig, dest, t, dur, type, freq, q, peak) {
    var c = rig.c, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = rig.noise;
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, (t * 7.31) % 1.5); src.stop(t + dur + 0.02);
  }

  function kick(rig, t, vel, K) {
    var c = rig.c, o = c.createOscillator(), g = c.createGain();
    o.type = K.chip ? "triangle" : "sine";
    o.frequency.setValueAtTime(K.k0, t);
    o.frequency.exponentialRampToValueAtTime(K.k1, t + 0.11);
    g.gain.setValueAtTime(0.95 * vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + K.kd);
    o.connect(g); g.connect(rig.drums);
    o.start(t); o.stop(t + K.kd + 0.03);
  }

  function snare(rig, t, vel, K) {
    var c = rig.c;
    noiseHit(rig, rig.drums, t, K.chip ? 0.09 : (K.soft ? 0.2 : 0.17), "bandpass", K.sf, 0.8, 0.5 * vel);
    if (!K.chip) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(K.st, t); o.frequency.exponentialRampToValueAtTime(K.st * 0.6, t + 0.08);
      g.gain.setValueAtTime(0.4 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      o.connect(g); g.connect(rig.drums); o.start(t); o.stop(t + 0.12);
    }
  }

  function clap(rig, t, vel, K) {
    for (var i = 0; i < 3; i++) noiseHit(rig, rig.drums, t + i * 0.011, i === 2 ? 0.16 : 0.03, "bandpass", 1500, 1.1, 0.35 * vel);
  }

  function hat(rig, t, vel, open, K) {
    noiseHit(rig, rig.drums, t, open ? 0.24 : 0.045, "highpass", K.hf, 0.7, 0.26 * vel);
  }

  function voiceNote(rig, bus, t, dur, midi, name, vel) {
    var c = rig.c, v = VOICES[name], freq = mtof(midi);
    var f = c.createBiquadFilter(), g = c.createGain(), end = t + dur + v.r;
    f.type = "lowpass"; f.frequency.value = v.cutoff; f.Q.value = v.q;
    var peak = v.g * vel, hold = Math.max(dur, v.a + 0.01);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + v.a);
    g.gain.linearRampToValueAtTime(Math.max(0.0001, peak * v.s), t + v.a + v.d);
    g.gain.setValueAtTime(Math.max(0.0001, peak * v.s), t + hold);
    g.gain.linearRampToValueAtTime(0.0001, t + hold + v.r);
    var chain = f;
    if (v.drive) {
      if (!rig.shaper) { rig.shaper = c.createWaveShaper(); rig.shaper.curve = driveCurve(); rig.shaper.oversample = "2x"; rig.shaper.connect(rig.lead); }
      // distortion happens per note through a shared shaper; the filter feeds it
      g.connect(rig.shaper);
    } else {
      g.connect(bus);
    }
    f.connect(g);
    if (v.send) { var s = c.createGain(); s.gain.value = v.send; g.connect(s); s.connect(rig.verb); }
    var oscs = [];
    v.detune.forEach(function (det) {
      var o = c.createOscillator();
      if (v.type === "pulse") { if (!rig.waves[v.duty]) rig.waves[v.duty] = pulseWave(c, v.duty); o.setPeriodicWave(rig.waves[v.duty]); }
      else o.type = v.type;
      o.detune.value = det;
      if (v.glide) { o.frequency.setValueAtTime(freq * v.glide, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.06); }
      else o.frequency.value = freq;
      if (v.vib) { // gentle vibrato once the note has settled
        var lfo = c.createOscillator(), depth = c.createGain();
        lfo.frequency.value = v.vib; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(10, t + 0.4);
        lfo.connect(depth); depth.connect(o.detune); lfo.start(t); lfo.stop(end);
      }
      o.connect(chain); o.start(t); o.stop(end + 0.05); oscs.push(o);
    });
    if (v.partial) {
      var p = c.createOscillator(), pg = c.createGain();
      p.type = "sine"; p.frequency.value = freq * v.partial[0]; pg.gain.value = v.partial[1];
      p.connect(pg); pg.connect(chain); p.start(t); p.stop(end + 0.05);
    }
    if (v.sub) {
      var sb = c.createOscillator(), sg = c.createGain();
      sb.type = "sine"; sb.frequency.value = freq; sg.gain.value = 0.7;
      sb.connect(sg); sg.connect(chain); sb.start(t); sb.stop(end + 0.05);
    }
  }

  /* ------------------------------------------------------------ composing */

  function patterns(str) { return str ? str.split("").map(function (ch) { return Number(ch) / 9; }) : null; }

  function chordMidis(rootMidi, quality, power) {
    var iv = power ? [0, 7, 12] : CHORDS[quality];
    var notes = iv.map(function (i) { return rootMidi + i; });
    var avg = notes.reduce(function (s, n) { return s + n; }, 0) / notes.length;
    var shift = Math.round((60 - avg) / 12) * 12;
    return notes.map(function (n) { return n + shift; });
  }

  function motif(rng, style, scaleNotes, lo, hi, bars) {
    var tpl = style.lead.rhythms, events = [], idx = Math.floor(scaleNotes.length / 2);
    for (var b = 0; b < bars; b++) {
      var rhythm = tpl[(b % 2 === 1 && b === bars - 1 ? 0 : b) % tpl.length];
      rhythm.forEach(function (r, n) {
        var move = [-2, -1, -1, 0, 1, 1, 2][Math.floor(rng() * 7)];
        if (b === bars - 1 && n === rhythm.length - 1) move = -idx + Math.floor(scaleNotes.length / 3); // land low at the end
        idx = clamp(idx + move, 0, scaleNotes.length - 1);
        events.push({ bar: b, step: r[0], len: r[1], midi: scaleNotes[idx], rest: rng() > style.lead.dens });
      });
    }
    return events;
  }

  function compose(plan) {
    var style = STYLES[plan.genre] || STYLES.pop;
    var rng = mulberry32(plan.seed);
    var keyPc = NOTE[plan.key] || 0;
    var scaleIv = SCALES[plan.scale] || SCALES.major;
    var harmonyIv = plan.scale === "pentatonic" ? SCALES.major : scaleIv;
    var lay = layout(plan);
    var leadBase = 60 + keyPc + style.lead.oct - (keyPc > 6 ? 12 : 0);
    var scaleNotes = [];
    for (var o = -1; o <= 2; o++) scaleIv.forEach(function (iv) { scaleNotes.push(leadBase + o * 12 + iv); });
    scaleNotes = scaleNotes.filter(function (n) { return n >= leadBase - 5 && n <= leadBase + 15; });
    return { style: style, rng: rng, keyPc: keyPc, harmonyIv: harmonyIv, lay: lay, scaleNotes: scaleNotes,
             hook: motif(rng, style, scaleNotes, 0, 0, 4), verse: motif(rng, style, scaleNotes, 0, 0, 4) };
  }

  function chordForBar(plan, comp, bar) {
    var style = comp.style, span = style.chord ? style.chord.bars : 1;
    var item = plan.progression[Math.floor(bar / span) % plan.progression.length];
    var degreeIdx = (item[0] - 1) % comp.harmonyIv.length;
    var rootPc = (comp.keyPc + comp.harmonyIv[degreeIdx]) % 12;
    return { pc: rootPc, quality: item[1] };
  }

  function schedule(plan, rig, comp) {
    var style = comp.style, K = style.kit || {}, lay = comp.lay;
    var spb = 60 / plan.bpm, step = spb / 4, barSec = lay.barSec, swing = plan.swing || 0;
    var kickP = patterns(style.kick), snareP = patterns(style.snare), hatP = patterns(style.hat), ohatP = patterns(style.ohat), clapP = patterns(style.clap);
    var rng = comp.rng;

    function stepTime(bar, s, humanize) {
      var t = bar * barSec + s * step + (s % 2 === 1 ? swing * step : 0);
      return Math.max(0, t + (humanize ? (rng() - 0.5) * 0.008 : 0));
    }

    lay.sections.forEach(function (sec, si) {
      for (var b = 0; b < sec.bars; b++) {
        var bar = sec.start + b, t0 = bar * barSec, last = b === sec.bars - 1;
        if (t0 >= plan.duration) return;
        var chord = chordForBar(plan, comp, bar), isOutro = sec.name === "Outro", isIntro = sec.name === "Intro";
        var drums = sec.i >= 1;

        // drums
        for (var s = 0; s < 16; s++) {
          var t = stepTime(bar, s, !K.chip);
          if (drums || (isIntro && hatP) || (isOutro && s === 0)) {
            var kv = drums || (isOutro && s === 0) ? (kickP && kickP[s]) : 0;
            if (style.kickLoud && sec.i >= 2) kv = Math.max(kv, patterns(style.kickLoud)[s]);
            if (kv) { kick(rig, t, kv * (0.85 + rng() * 0.15), K); if (style.duck) duck(rig, t); }
          }
          if (!drums && !(isIntro && hatP)) continue;
          if (drums && snareP && snareP[s]) snare(rig, t, snareP[s] * (0.85 + rng() * 0.15), K);
          if (drums && clapP && clapP[s]) clap(rig, t, clapP[s], K);
          if (hatP && hatP[s] && (drums || isIntro)) hat(rig, t, hatP[s] * (isIntro ? 0.6 : 1) * (0.8 + rng() * 0.2), false, K);
          if (drums && ohatP && ohatP[s]) hat(rig, t, ohatP[s], true, K);
          if (drums && last && s >= 12 && snareP) snare(rig, t, 0.25 + (s - 12) * 0.18, K);
        }

        // bass
        if (style.bass && (sec.i >= 1 || isOutro)) {
          var bassRoot = 36 + (chord.pc > 6 ? chord.pc - 12 : chord.pc);
          style.bass.pat.forEach(function (p) {
            voiceNote(rig, rig.bass, stepTime(bar, p[0], false), Math.max(0.08, p[1] * step * 0.92), bassRoot + p[2], style.bass.voice, 0.9);
          });
        }

        // chords
        if (style.chord) {
          var cm = chordMidis(48 + chord.pc, chord.quality, style.chord.power);
          var spanBars = style.chord.bars;
          if (style.chord.rhythm.length && (spanBars === 1 || bar % spanBars === 0) && !(isOutro && sec.i === 0 && b > 0 && false)) {
            style.chord.rhythm.forEach(function (r) {
              var dur = r[1] * step * spanBars * 0.98;
              cm.forEach(function (n, k) { voiceNote(rig, rig.chords, stepTime(bar, r[0], false) + k * 0.006, dur, n, style.chord.voice, isIntro ? 0.7 : 0.9); });
            });
          }
          if (style.stab && sec.i >= 2) {
            style.stab.rhythm.forEach(function (r) {
              cm.forEach(function (n) { voiceNote(rig, rig.chords, stepTime(bar, r[0], false), r[1] * step * 0.8, n + 12, style.stab.voice, 0.8); });
            });
          }
          if (style.arp && sec.i >= 1) {
            for (var a = 0; a < 16; a += style.arp.div * 1) {
              if (style.arp.div === 2 && a % 2) continue;
              var an = cm[(a / style.arp.div) % cm.length] + 12 * (Math.floor((a / style.arp.div) / cm.length) % 2);
              voiceNote(rig, rig.chords, stepTime(bar, a, false), step * style.arp.div * 0.85, an + (plan.genre === "chiptune" ? 12 : 0), style.arp.voice, 0.6);
            }
          }
        }

        // lead melody: the hook in choruses, a thinner verse motif in verses
        var notes = sec.i >= 2 ? comp.hook : (sec.i === 1 ? comp.verse : null);
        if (notes && (!isOutro)) {
          var pb = b % 4, strong = [0, 4, 8, 12];
          notes.filter(function (e) { return e.bar === pb && !(sec.i === 1 && e.rest) && !(sec.i >= 2 && e.rest && rng() < 0.7); }).forEach(function (e) {
            var m = e.midi;
            if (strong.indexOf(e.step) !== -1) { // land on a chord tone on strong beats
              var tones = chordMidis(0, chord.quality, false).map(function (n) { return (n + chord.pc + 120) % 12; });
              var best = m, bd = 99;
              comp.scaleNotes.forEach(function (n) { var d = Math.abs(n - m); if (tones.indexOf(n % 12) !== -1 && d < bd) { bd = d; best = n; } });
              m = best;
            }
            voiceNote(rig, rig.lead, stepTime(bar, e.step, false), e.len * step * 0.95, m, style.lead.voice, sec.i >= 2 ? 0.95 : 0.65);
          });
        }
      }
    });

    if (style.crackle) crackle(rig, plan.duration);
  }

  function duck(rig, t) {
    var g = rig.chords.gain;
    g.setValueAtTime(0.3, t);
    g.linearRampToValueAtTime(1, t + 0.2);
  }

  function crackle(rig, duration) {
    var c = rig.c, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = rig.noise; src.loop = true;
    f.type = "highpass"; f.frequency.value = 4500;
    g.gain.value = 0.012;
    src.connect(f); f.connect(g); g.connect(rig.lead);
    src.start(0); src.stop(duration);
  }

  /* --------------------------------------------------------------- public */

  // Renders the whole song to an AudioBuffer. onProgress(0..1) is called while it renders.
  function render(plan, onProgress) {
    var OfflineCtx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    var duration = clamp(plan.duration, 5, 160);
    var c = new OfflineCtx(2, Math.round(duration * SR), SR);
    var comp = compose(plan);
    var rig = makeRig(c, comp.style, duration);
    schedule(plan, rig, comp);
    if (onProgress) {
      for (var i = 1; i < 10; i++) {
        (function (k) { c.suspend(k * duration / 10).then(function () { onProgress(k / 10); c.resume(); }); })(i);
      }
    }
    return c.startRendering();
  }

  // Which lyric line is sung when: spread over the verses and choruses.
  function lyricCues(plan, lyrics) {
    var lines = String(lyrics || "").split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return [];
    var lay = layout(plan);
    var ranges = lay.sections.filter(function (s) { return s.i >= 1; }).map(function (s) { return [s.start * lay.barSec, (s.start + s.bars) * lay.barSec]; });
    var span = ranges.reduce(function (sum, r) { return sum + (r[1] - r[0]); }, 0);
    var slot = Math.min(2 * lay.barSec, span / lines.length);
    var cues = [], ri = 0, cursor = ranges[0][0];
    lines.forEach(function (text) {
      while (ri < ranges.length - 1 && cursor + 0.01 >= ranges[ri][1]) { ri++; cursor = ranges[ri][0]; }
      cues.push({ t: cursor, d: Math.min(slot, plan.duration - cursor), text: text });
      cursor += slot;
    });
    return cues.filter(function (c) { return c.d > 0.5; });
  }

  function toWav(buffer) {
    var ch = buffer.numberOfChannels, len = buffer.length, data = [];
    for (var c = 0; c < ch; c++) data.push(buffer.getChannelData(c));
    var out = new DataView(new ArrayBuffer(44 + len * ch * 2));
    function str(off, s) { for (var i = 0; i < s.length; i++) out.setUint8(off + i, s.charCodeAt(i)); }
    str(0, "RIFF"); out.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, buffer.sampleRate, true); out.setUint32(28, buffer.sampleRate * ch * 2, true);
    out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, len * ch * 2, true);
    var pos = 44;
    for (var i = 0; i < len; i++) {
      for (c = 0; c < ch; c++) { var s = clamp(data[c][i], -1, 1); out.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7FFF, true); pos += 2; }
    }
    return new Blob([out], { type: "audio/wav" });
  }

  root.NRSSynth = { render: render, layout: layout, lyricCues: lyricCues, toWav: toWav, STYLES: STYLES };
})(window);
