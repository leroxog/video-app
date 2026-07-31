// Site-wide UI sound effects -- synthesized live with the Web Audio API
// (short oscillator "blips" with a fast attack/decay envelope) rather than
// shipped as audio files, so there's nothing to host or download and every
// click/keystroke gets a slightly different pitch instead of one identical
// sample playing over and over. Runs on every page (included from
// base.html), listening at the document level so it covers every button,
// link and text field site-wide without each page needing its own wiring.
(function () {
    let audioCtx = null;
    function getAudioContext() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!audioCtx) audioCtx = new Ctx();
        // Browsers start a fresh AudioContext "suspended" until a real user
        // gesture -- every call site here already runs from inside a click/
        // keydown handler, so resuming is always safe and never blocked.
        if (audioCtx.state === "suspended") audioCtx.resume();
        return audioCtx;
    }

    function playTone(freq, duration, type, peakGain, delay) {
        const ctx = getAudioContext();
        if (!ctx) return;
        const start = ctx.currentTime + (delay || 0);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        // Fast linear attack then an exponential decay -- the shape that
        // reads as a crisp, satisfying "tick"/"pop" rather than a flat beep.
        gain.gain.linearRampToValueAtTime(peakGain, start + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + duration + 0.02);
    }

    // A light, round "pop" -- a fundamental tone plus a quiet higher
    // harmonic layered on top for crispness. Pitch is randomized a little
    // each time so a burst of clicks doesn't sound like one sample on loop.
    function playClickSound() {
        const freq = 600 + Math.random() * 90;
        playTone(freq, 0.1, "sine", 0.14);
        playTone(freq * 2.5, 0.05, "triangle", 0.045, 0.003);
    }

    // A short, soft mechanical-keyboard-ish tick, pitched per keystroke.
    function playKeySound() {
        const freq = 360 + Math.random() * 160;
        playTone(freq, 0.045, "square", 0.045);
    }

    window.__nexaiPlayClickSound = playClickSound;
    window.__nexaiPlayKeySound = playKeySound;

    const CLICKABLE_SELECTOR =
        "button, a[href], [role='button'], input[type='submit'], input[type='button'], " +
        "input[type='checkbox'], input[type='radio'], select";

    document.addEventListener("click", (event) => {
        const el = event.target.closest(CLICKABLE_SELECTOR);
        if (!el || el.disabled) return;
        playClickSound();
    }, true);

    const TEXT_INPUT_TYPES = ["text", "search", "email", "password", "number", "tel", "url"];
    function isTypedInto(el) {
        if (!el) return false;
        if (el.tagName === "TEXTAREA") return true;
        if (el.isContentEditable) return true;
        return el.tagName === "INPUT" && TEXT_INPUT_TYPES.includes(el.type);
    }

    document.addEventListener("keydown", (event) => {
        if (!isTypedInto(event.target)) return;
        // Only sound for keys that actually change the text (real
        // characters, plus backspace/space/enter) -- not for every
        // modifier/arrow/navigation key press.
        if (event.key.length !== 1 && !["Backspace", "Enter", " ", "Spacebar"].includes(event.key)) return;
        playKeySound();
    }, true);
})();
