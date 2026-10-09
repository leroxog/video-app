/* raumo sensors: what the phone knows -- which way it points (the orientation sensors), what it sees (the camera) -- and a stand-in for
   both on a computer: a virtual camera that looks into a practice room, turned with the mouse.

   Orientation keeps the last few seconds of readings so that a corner can be taken from the moment *before* the finger touched the
   screen (pressing the button moves the phone a little). */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const R = (window.Raumo = window.Raumo || {});

  const KEEP_MS = 3000;

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
    return typeof window.orientation === "number" ? ((window.orientation % 360) + 360) % 360 : 0;
  }

  // ---------------------------------------------------------------------------------------- orientation
  class Orientation {
    constructor() {
      this.samples = [];
      this.last = null;
      this.available = false;
      this.running = false;
      this.listeners = [];
      this.handler = (event) => this.read(event);
      this.demo = false;
    }

    static needsPermission() {
      return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function";
    }

    /* Asks for the sensors (on iPhones this must happen in a tap) and waits until readings arrive.
       Resolves to {ok: true} or {ok: false, reason: "unsupported" | "denied" | "silent"}. */
    async request() {
      if (typeof DeviceOrientationEvent === "undefined") return { ok: false, reason: "unsupported" };
      if (Orientation.needsPermission()) {
        try {
          if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return { ok: false, reason: "denied" };
        } catch (error) { return { ok: false, reason: "denied" }; }
      }
      this.start();
      const until = performance.now() + 1800;
      while (!this.available && performance.now() < until) await R.wait(60);
      if (!this.available) { this.stop(); return { ok: false, reason: "silent" }; }
      return { ok: true };
    }

    start() {
      if (this.running) return;
      this.running = true;
      window.addEventListener("deviceorientation", this.handler, true);
      window.addEventListener("deviceorientationabsolute", this.handler, true);
    }

    stop() {
      this.running = false;
      window.removeEventListener("deviceorientation", this.handler, true);
      window.removeEventListener("deviceorientationabsolute", this.handler, true);
    }

    read(event) {
      if (event.alpha == null || event.beta == null || event.gamma == null) return;
      if (event.type === "deviceorientationabsolute" && this.relativeSeen) return;         // the relative reading is steadier
      if (event.type === "deviceorientation") this.relativeSeen = true;
      const view = Core.viewFromOrientation(event.alpha, event.beta, event.gamma, screenAngle());
      this.push(view);
    }

    push(view) {
      const t = performance.now();
      this.samples.push({ t, view });
      while (this.samples.length && t - this.samples[0].t > KEEP_MS) this.samples.shift();
      this.last = view;
      this.available = true;
      for (const l of this.listeners) l(view);
    }

    onUpdate(listener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter((l) => l !== listener); }; }

    /* The average view of the readings between `fromMs` and `toMs` milliseconds ago (the newest one if there are none). */
    window(fromMs = 450, toMs = 120) {
      const now = performance.now();
      const picked = this.samples.filter((s) => now - s.t <= fromMs && now - s.t >= toMs).map((s) => s.view);
      return picked.length ? Core.averageViews(picked) : this.last;
    }

    /* How fast the phone is turning, in degrees per second, over the last `ms` milliseconds. */
    speed(ms = 250) {
      const now = performance.now();
      const recent = this.samples.filter((s) => now - s.t <= ms);
      if (recent.length < 2) return 0;
      const a = recent[0], b = recent[recent.length - 1];
      const dot = Core.clamp(Core.dot(a.view.forward, b.view.forward), -1, 1);
      const dt = (b.t - a.t) / 1000;
      return dt > 0 ? Math.acos(dot) / Core.DEG / dt : 0;
    }
  }

  /* The same thing for the practice room: the view comes from yaw and pitch that the mouse (or a finger) sets. */
  class DemoOrientation extends Orientation {
    constructor() {
      super();
      this.demo = true;
      this.yaw = 20;
      this.pitch = -25;
      this.set(this.yaw, this.pitch);
    }

    request() { this.available = true; return Promise.resolve({ ok: true }); }
    start() { this.running = true; }
    stop() { this.running = false; }

    set(yaw, pitch) {
      this.yaw = ((yaw + 540) % 360) - 180;
      this.pitch = Core.clamp(pitch, -89, 89);
      this.push(Core.viewFromYawPitch(this.yaw, this.pitch));
    }

    turn(dx, dy) { this.set(this.yaw + dx, this.pitch + dy); }
  }

  // --------------------------------------------------------------------------------------------- camera
  const CAMERA_ERRORS = {
    NotAllowedError: "Der Zugriff auf die Kamera wurde nicht erlaubt. Erlaube ihn in den Einstellungen deines Browsers für diese Seite und versuche es noch einmal.",
    SecurityError: "Der Browser erlaubt die Kamera hier nicht. Die Seite muss über https geöffnet sein.",
    NotFoundError: "Es wurde keine Kamera gefunden.",
    NotReadableError: "Die Kamera wird gerade von einer anderen App benutzt.",
    OverconstrainedError: "Die Kamera kann nicht so eingestellt werden.",
  };

  class CameraFeed {
    constructor(video) {
      this.video = video;
      this.stream = null;
    }

    static supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia); }

    async start() {
      if (!CameraFeed.supported()) throw new Error("Dieser Browser kann die Kamera nicht benutzen.");
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (error) {
        throw new Error(CAMERA_ERRORS[error && error.name] || "Die Kamera konnte nicht gestartet werden.");
      }
      const video = this.video;
      video.muted = true;
      video.setAttribute("playsinline", "");
      video.srcObject = this.stream;
      await new Promise((resolve) => { if (video.readyState >= 1) resolve(); else video.addEventListener("loadedmetadata", resolve, { once: true }); });
      try { await video.play(); } catch (error) { /* it starts on the first tap */ }
      return this.size();
    }

    stop() {
      if (this.stream) for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
      this.video.srcObject = null;
    }

    size() { return { width: this.video.videoWidth || 0, height: this.video.videoHeight || 0 }; }

    /* A JPEG of the picture now, at most `maxSide` pixels on the long side: {blob, width, height}. */
    async grab(maxSide = 800, quality = 0.82) {
      const { width, height } = this.size();
      if (!width || !height) return null;
      const scale = Math.min(1, maxSide / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext("2d").drawImage(this.video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      return blob ? { blob, width: canvas.width, height: canvas.height } : null;
    }
  }

  /* The practice room as a camera: the picture is what the viewer draws on its canvas. */
  class VirtualFeed {
    constructor(viewer) { this.viewer = viewer; }
    size() { return { width: this.viewer.canvas.width, height: this.viewer.canvas.height }; }
    stop() {}

    async grab(maxSide = 800, quality = 0.82) {
      this.viewer.render();
      const source = this.viewer.canvas;
      const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(source.width * scale);
      canvas.height = Math.round(source.height * scale);
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      return blob ? { blob, width: canvas.width, height: canvas.height } : null;
    }
  }

  /* Keeps the screen on while scanning (where the browser knows how). Returns a function that lets go. */
  async function keepAwake() {
    try {
      if (navigator.wakeLock) {
        let lock = await navigator.wakeLock.request("screen");
        const again = async () => { if (document.visibilityState === "visible" && lock && lock.released) { try { lock = await navigator.wakeLock.request("screen"); } catch (error) { /* not allowed now */ } } };
        document.addEventListener("visibilitychange", again);
        return () => { document.removeEventListener("visibilitychange", again); const l = lock; lock = null; l && l.release().catch(() => {}); };
      }
    } catch (error) { /* the screen may go dark: nothing to do */ }
    return () => {};
  }

  Object.assign(R, { Orientation, DemoOrientation, CameraFeed, VirtualFeed, keepAwake, screenAngle });
})();
