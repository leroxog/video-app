// LEROX Mail's UI sounds -- synthesized on the fly with the Web Audio API
// (oscillator + gain envelope), no audio file assets, same approach as
// LEROX Browser's sounds.js. AudioContext needs a real user gesture
// before it can produce sound (browser autoplay policy), so init() runs
// on the page's first click and is a no-op after that.
(function () {
  function LeroxMailSounds() {
    this.ctx = null;
  }

  LeroxMailSounds.prototype.init = function () {
    if (this.ctx) return;
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
  };

  LeroxMailSounds.prototype._tone = function (opts) {
    if (!this.ctx) return;
    var t0 = this.ctx.currentTime + (opts.delay || 0);
    var osc = this.ctx.createOscillator();
    var amp = this.ctx.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(opts.freq, t0);
    if (opts.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(opts.endFreq, 1), t0 + opts.duration);
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(opts.gain || 0.05, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);
    osc.connect(amp).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + opts.duration + 0.02);
  };

  LeroxMailSounds.prototype.click = function () {
    this._tone({ freq: 600, duration: 0.05, gain: 0.04 });
  };

  LeroxMailSounds.prototype.send = function () {
    this._tone({ freq: 520, endFreq: 900, duration: 0.12, type: "triangle", gain: 0.05 });
    this._tone({ freq: 900, duration: 0.1, gain: 0.03, delay: 0.1 });
  };

  LeroxMailSounds.prototype.delete = function () {
    this._tone({ freq: 500, endFreq: 220, duration: 0.14, type: "sawtooth", gain: 0.04 });
  };

  LeroxMailSounds.prototype.restore = function () {
    this._tone({ freq: 400, endFreq: 620, duration: 0.1, type: "triangle", gain: 0.045 });
  };

  LeroxMailSounds.prototype.error = function () {
    this._tone({ freq: 260, endFreq: 160, duration: 0.18, type: "sawtooth", gain: 0.05 });
  };

  window.leroxMailSounds = new LeroxMailSounds();
  document.addEventListener("click", function once() {
    window.leroxMailSounds.init();
    document.removeEventListener("click", once);
  });
})();
