/* raumo walk: the screen for scanning by walking.  On a phone with WebXR depth (Android, Chrome) it opens the camera, follows the phone as
   you walk and draws the points that were found over the camera picture.  On every other device it offers the same walk through a
   practice room on the screen (drag to look, hold the arrow to walk, or let it walk by itself) so that the scan can be tried anywhere.

   The points come from raumo-xr.js (real) or raumo-sim.js (practice) and are collected by raumo-cloud.js. */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const Cloud = window.RaumoCloud;
  const R = (window.Raumo = window.Raumo || {});
  const { h, put, fill, icon, toast, confirmBox, num } = R;

  const EYE = 1.4;
  const count = (n) => n.toLocaleString("de-DE");

  /* Can this device scan by walking? Resolves to {ok: true} or {ok: false, reason}. */
  R.walkSupport = async function walkSupport() {
    if (window.isSecureContext === false) return { ok: false, reason: "Dafür muss die Seite über https geöffnet sein." };
    if (!navigator.xr) return { ok: false, reason: /iPhone|iPad|iPod/.test(navigator.userAgent) ? "Safari auf dem iPhone erlaubt Webseiten keine Tiefenmessung und keine Positionsverfolgung. Durchlaufen-Scannen geht dort im Browser nicht." : "Dieser Browser bietet kein WebXR. Auf Android funktioniert es mit Chrome." };
    if (!(await window.RaumoXR.XRWalk.supported())) return { ok: false, reason: "Dieses Gerät oder dieser Browser unterstützt kein Augmented-Reality-Scannen (WebXR). Du brauchst ein Android-Handy mit ARCore und Chrome." };
    return { ok: true };
  };

  class WalkScan {
    /* options: {mode: "xr" | "sim", demo: {room, pictures, boxes} (for "sim"), onDone(cloud, info), onCancel()} */
    constructor(options) {
      this.options = options;
      this.mode = options.mode;
      this.points = 0;
      this.closed = false;
      this.build();
    }

    build() {
      this.canvas = h("canvas", { class: "walk-canvas", "aria-label": this.mode === "sim" ? "Übungsraum" : "Kamerabild" });
      this.chip = h("div", { class: "scan-chip", role: "status", "aria-live": "polite" });
      this.hint = h("p", { class: "scan-hint walk-hint" });
      this.panel = h("div", { class: "scan-panel" });
      this.root = h("div", { class: `scan walk walk-${this.mode}`, role: "dialog", "aria-modal": "true", "aria-label": "Durch den Raum gehen und scannen" },
        this.canvas, h("div", { class: "scan-top" }, h("span", { class: "grow" }), h("button", { class: "icon-btn glass", type: "button", "aria-label": "Scan abbrechen", onclick: () => this.cancel() }, icon("close"))),
        this.chip, this.panel);
      document.body.append(this.root);
      document.body.classList.add("modal-open");
      this.intro();
      this.onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".dialog-back")) this.cancel(); };
      document.addEventListener("keydown", this.onKey);
    }

    async cancel() {
      if (this.running && this.points > 200) {
        if (!(await confirmBox({ title: "Scan abbrechen?", text: "Die bisher gefundenen Punkte gehen verloren.", yes: "Abbrechen", no: "Weiter scannen", danger: true }))) return;
      }
      this.teardown();
      this.options.onCancel?.();
    }

    teardown() {
      this.closed = true;
      document.removeEventListener("keydown", this.onKey);
      clearInterval(this.timer);
      if (this.xr) { this.xr.onEnd = () => {}; try { this.xr.stop(); } catch (error) { /* already over */ } }
      window.removeEventListener("keydown", this.keyDown);
      window.removeEventListener("keyup", this.keyUp);
      this.viewer?.destroy();
      this.release?.();
      this.root.remove();
      if (!document.querySelector(".dialog-back")) document.body.classList.remove("modal-open");
    }

    intro() {
      const sim = this.mode === "sim";
      this.error = h("p", { class: "form-error", role: "alert", hidden: true });
      fill(this.panel, h("div", { class: "scan-card intro" },
        h("h2", {}, sim ? "Übungsrundgang" : "Durch den Raum gehen"),
        sim
          ? h("p", {}, "Du gehst durch einen Übungsraum auf dem Bildschirm. Ziehe mit der Maus oder dem Finger, um dich umzusehen, und halte den Pfeil gedrückt, um zu gehen. Oder lass die App von selbst laufen. Die Punkte erscheinen, während du gehst.")
          : h("p", {}, "Gehe langsam durch den Raum und richte das Handy auf Wände, Boden und Möbel. Dein Handy misst, wie weit alles weg ist, und die App setzt etwa alle 5 cm einen Punkt in der Farbe, die die Kamera sieht."),
        h("ul", { class: "ticks" }, h("li", {}, sim ? "So sieht ein echter Scan später aus: Punkt für Punkt." : "Halte 0,5 bis 4 Meter Abstand zu den Flächen."), h("li", {}, "Gehe langsam und schwenke das Handy ruhig."), h("li", {}, "Alles bleibt auf deinem Gerät.")),
        this.error,
        h("div", { class: "scan-actions" },
          h("button", { class: "btn primary", type: "button", onclick: (e) => this.begin(e.currentTarget) }, sim ? "Los geht's" : "Scan starten"),
          h("button", { class: "btn ghost", type: "button", onclick: () => this.cancel() }, "Abbrechen"))));
    }

    async begin(button) {
      button.disabled = true;
      this.error.hidden = true;
      try {
        if (this.mode === "sim") await this.startSim();
        else await this.startXR();
        this.running = true;
        this.release = await R.keepAwake();
      } catch (error) {
        console.error(error);
        this.error.textContent = error.message || "Das hat nicht geklappt.";
        this.error.hidden = false;
        button.disabled = false;
      }
    }

    // ---------------------------------------------------------------------------------------------- real walk
    async startXR() {
      this.viewer = new window.RaumoGL.Viewer(this.canvas, { fixed: true, xr: true });
      this.viewer.setItems([]);
      this.viewer.setClouds([]);
      this.xr = new window.RaumoXR.XRWalk({
        viewer: this.viewer, overlay: this.root,
        flipDepthY: false, flipColorY: false,
        onUpdate: (s) => this.update(s.points, s.color),
        onProblem: (text) => { this.chip.textContent = text; this.chip.className = "scan-chip bad"; },
        onEnd: (cloud, info) => { if (!this.closed) this.done(cloud, { ...info, mode: "xr" }); },
      });
      await this.xr.start();
      this.panelForScan();
      this.root.classList.add("scanning");
    }

    // ------------------------------------------------------------------------------------------ practice walk
    async startSim() {
      const demo = this.options.demo;
      this.scene = window.RaumoSim.makeScene(demo.room, { pictures: demo.pictures, boxes: demo.boxes });
      this.viewer = new window.RaumoGL.Viewer(this.canvas, { fixed: true });
      this.viewer.setItems([{ id: "demo", room: demo.room, layout: { x: 0, z: 0, rot: 0 }, textures: demo.textures, props: demo.props }]);
      this.viewer.setMode("pose");
      this.viewer.setClouds([]);
      this.viewer.pointTint = [0.2, 0.9, 1.0, 0.45];
      this.capture = new Cloud.WalkCapture({ size: Cloud.SPACING, minHits: 2, near: 0.35, far: 4.5, stride: 1, edge: 0.08 });
      this.sim = { x: 0.9, z: 0.9, yaw: 200, pitch: -10, keys: {}, auto: false, step: 0, path: window.RaumoSim.walkPath(demo.room, 260, EYE) };
      this.noiseSeed = 7;
      this.attachSimControls();
      this.panelForScan();
      this.root.classList.add("scanning");
      this.last = performance.now();
      this.timer = setInterval(() => this.simTick(), 100);
      this.simTick();
    }

    attachSimControls() {
      const canvas = this.canvas;
      let drag = null;
      canvas.addEventListener("pointerdown", (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture?.(e.pointerId); });
      canvas.addEventListener("pointermove", (e) => {
        if (!drag) return;
        this.sim.yaw -= (e.clientX - drag[0]) * 0.25; this.sim.pitch = Core.clamp(this.sim.pitch + (e.clientY - drag[1]) * 0.2, -80, 80);
        drag = [e.clientX, e.clientY];
        this.sim.auto = false;
        this.syncAuto();
      });
      canvas.addEventListener("pointerup", () => { drag = null; });
      canvas.addEventListener("pointercancel", () => { drag = null; });
      this.keyDown = (e) => { const k = e.key.toLowerCase(); if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { this.sim.keys[k] = true; this.sim.auto = false; this.syncAuto(); e.preventDefault(); } };
      this.keyUp = (e) => { delete this.sim.keys[e.key.toLowerCase()]; };
      window.addEventListener("keydown", this.keyDown);
      window.addEventListener("keyup", this.keyUp);
    }

    syncAuto() { if (this.autoBtn) this.autoBtn.setAttribute("aria-pressed", String(this.sim.auto)); }

    simTick() {
      if (this.closed || !this.sim) return;
      const s = this.sim;
      const dt = Math.min(0.25, (performance.now() - this.last) / 1000);
      this.last = performance.now();
      let eye = EYE;
      if (s.auto) {
        const p = s.path[s.step % s.path.length];
        s.step += 1;
        const yaw = Core.yawDeg(p.forward), pitch = Core.pitchDeg(p.forward);
        s.x = p.position[0]; s.z = p.position[2]; s.yaw = yaw; s.pitch = pitch;
        eye = p.position[1];
      } else {
        const v = Core.viewFromYawPitch(s.yaw, 0);
        const go = (s.keys.w || s.keys.arrowup || s.forward ? 1 : 0) - (s.keys.s || s.keys.arrowdown || s.back ? 1 : 0);
        const side = (s.keys.d ? 1 : 0) - (s.keys.a ? 1 : 0);
        if (s.keys.arrowleft) s.yaw -= 70 * dt; if (s.keys.arrowright) s.yaw += 70 * dt;
        const nx = s.x + (v.forward[0] * go + v.right[0] * side) * 0.9 * dt, nz = s.z + (v.forward[2] * go + v.right[2] * side) * 0.9 * dt;
        if (this.canStand(nx, nz)) { s.x = nx; s.z = nz; }
      }
      const view = Core.viewFromYawPitch(s.yaw, s.pitch);
      const position = [s.x, eye, s.z];
      this.viewer.pose.position = position; this.viewer.pose.forward = view.forward; this.viewer.pose.up = view.up; this.viewer.pose.fov = 70;
      this.viewer.resize();
      const W = this.canvas.width || 400, H = this.canvas.height || 700;
      const dims = W >= H ? [64, Math.max(8, Math.round(64 * H / W))] : [Math.max(8, Math.round(64 * W / H)), 64];
      let seed = (this.noiseSeed = (this.noiseSeed * 16807) % 2147483647);
      const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const frame = window.RaumoSim.renderFrame(this.scene, position, view.forward, view.up, { fov: 70, depthSize: dims, colorSize: [dims[0] * 2, dims[1] * 2], noise: 0.008, random });
      this.capture.addFrame(frame);
      const fresh = this.capture.takeNew();
      if (fresh.length) this.viewer.appendPoints("walk", fresh);
      else this.viewer.invalidate();
      this.update(this.capture.count, true);
    }

    canStand(x, z) {
      const room = this.options.demo.room, m = 0.3;
      for (const [dx, dz] of [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m]]) if (!Core.pointInPolygon([x + dx, z + dz], room.polygon)) return false;
      return !this.scene.boxes.some((b) => x > b.min[0] - m && x < b.max[0] + m && z > b.min[2] - m && z < b.max[2] + m);
    }

    // ----------------------------------------------------------------------------------------------- screen
    panelForScan() {
      const sim = this.mode === "sim";
      this.stop = h("button", { class: "btn primary big", type: "button", onclick: () => this.finish() }, icon("check"), h("span", {}, "Fertig"));
      const hold = (label, name, ic) => {
        const b = h("button", { class: "hold", type: "button", "aria-label": label }, icon(ic));
        const on = () => { this.sim[name] = true; this.sim.auto = false; this.syncAuto(); };
        const off = () => { this.sim[name] = false; };
        b.addEventListener("pointerdown", (e) => { b.setPointerCapture?.(e.pointerId); on(); });
        for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, off);
        return b;
      };
      if (sim) {
        this.autoBtn = h("button", { class: "btn ghost", type: "button", "aria-pressed": "false", onclick: () => { this.sim.auto = !this.sim.auto; this.syncAuto(); } }, "Automatisch gehen");
        fill(this.panel, h("div", { class: "scan-bar" }, this.hint, h("div", { class: "scan-controls" }, hold("Vorwärts gehen", "forward", "up"), hold("Rückwärts gehen", "back", "down"), this.autoBtn, this.stop)));
        this.hint.textContent = "Ziehe zum Umsehen, halte den Pfeil zum Gehen. Je mehr Wände, Boden und Möbel du ansiehst, desto mehr Punkte.";
      } else {
        fill(this.panel, h("div", { class: "scan-bar" }, this.hint, h("div", { class: "scan-controls" }, this.stop)));
        this.hint.textContent = "Gehe langsam durch den Raum und schwenke das Handy über Wände, Boden und Möbel. Tippe auf „Fertig“, wenn du alles gesehen hast.";
      }
    }

    update(points, color) {
      this.points = points;
      this.chip.textContent = `${count(points)} Punkte${color ? "" : " (ohne Farbe)"}`;
      this.chip.className = `scan-chip ${points > 3000 ? "good" : "mid"}`;
    }

    finish() {
      if (this.mode === "sim") {
        const cloud = this.capture.toCloud();
        if (cloud.count < 100) { toast("Es sind noch kaum Punkte da. Gehe weiter und sieh dich um."); return; }
        this.done(cloud, { mode: "sim", floorKnown: true, color: true });
      } else this.xr.stop();
    }

    done(cloud, info) {
      this.teardown();
      this.options.onDone(cloud, info);
    }
  }

  R.WalkScan = WalkScan;
  R.openWalk = (options) => new WalkScan(options);
})();
