// LEROX Games' UI sounds -- synthesized on the fly with the Web Audio API
// (oscillator + gain envelope), no audio file assets, same approach as
// LEROX Browser's sounds.js / LEROX Mail's mail-sounds.js. AudioContext
// needs a real user gesture before it can produce sound (autoplay
// policy), so init() runs on the page's first click and is a no-op after.
(function () {
  function LeroxGamesSounds() {
    this.ctx = null;
  }

  LeroxGamesSounds.prototype.init = function () {
    if (this.ctx) return;
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
  };

  LeroxGamesSounds.prototype._tone = function (opts) {
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

  LeroxGamesSounds.prototype.click = function () {
    this._tone({ freq: 620, duration: 0.05, gain: 0.04 });
  };

  LeroxGamesSounds.prototype.ready = function () {
    this._tone({ freq: 500, endFreq: 780, duration: 0.1, type: "triangle", gain: 0.05 });
  };

  LeroxGamesSounds.prototype.unready = function () {
    this._tone({ freq: 620, endFreq: 420, duration: 0.09, type: "triangle", gain: 0.045 });
  };

  LeroxGamesSounds.prototype.start = function () {
    this._tone({ freq: 300, endFreq: 900, duration: 0.35, type: "sawtooth", gain: 0.05 });
    this._tone({ freq: 900, duration: 0.15, gain: 0.04, delay: 0.3 });
  };

  LeroxGamesSounds.prototype.keyFlash = function () {
    this._tone({ freq: 900, duration: 0.04, type: "square", gain: 0.03 });
  };

  LeroxGamesSounds.prototype.aiAnswer = function () {
    this._tone({ freq: 660, duration: 0.06, gain: 0.03 });
    this._tone({ freq: 880, duration: 0.07, gain: 0.03, delay: 0.07 });
  };

  LeroxGamesSounds.prototype.wrong = function () {
    this._tone({ freq: 280, endFreq: 150, duration: 0.22, type: "sawtooth", gain: 0.06 });
  };

  LeroxGamesSounds.prototype.solved = function () {
    this._tone({ freq: 523, duration: 0.12, gain: 0.05 });
    this._tone({ freq: 659, duration: 0.12, gain: 0.05, delay: 0.11 });
    this._tone({ freq: 784, duration: 0.22, gain: 0.05, delay: 0.22 });
  };

  window.leroxGamesSounds = new LeroxGamesSounds();
  document.addEventListener("click", function once() {
    window.leroxGamesSounds.init();
    document.removeEventListener("click", once);
  });
})();
