/* raumo scan: the steps of scanning a room -- permission, the phone's height, the corners on the floor, the height of the room, doors and
   windows, and the photos that become the walls' pictures.  It shows the camera (or the practice room), draws the cross hair and what
   was marked so far over it, and hands back everything that was measured.

   What is measured is explained in raumo-core.js. */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const R = (window.Raumo = window.Raumo || {});
  const { h, put, fill, icon, toast, dialog, confirmBox, metres, num } = R;

  const STEPS = [["intro", "Start"], ["height", "Handyhöhe"], ["corners", "Ecken"], ["ceiling", "Höhe"], ["openings", "Türen & Fenster"], ["photos", "Fotos"]];
  const ROWS = [
    { id: "mid", pitch: 0, tolerance: 14, step: 24, label: "Wände" },
    { id: "down", pitch: -48, tolerance: 14, step: 45, label: "Boden" },
    { id: "up", pitch: 42, tolerance: 14, step: 45, label: "Decke" },
  ];
  const DEFAULT_FOV = 70;
  const KIND_LABEL = { door: "Tür", window: "Fenster", passage: "Durchgang" };
  const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
  const setClass = (el, name) => { if (el.className !== name) el.className = name; };
  const levelOf = (error) => (error < 4 ? "good" : error < 8 ? "mid" : "bad");
  const sectorOf = (row, yaw) => Math.round((((yaw % 360) + 360) % 360) / row.step) % Math.round(360 / row.step);
  const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

  class ScanWizard {
    /* options: {mode: "real" | "demo", demo: RaumoDemo room data (for the practice room), onDone(scan), onCancel()} */
    constructor(options) {
      this.options = options;
      this.mode = options.mode || "real";
      this.state = { phoneHeight: 1.4, corners: [], height: null, openings: [], photos: [], fov: DEFAULT_FOV, openingKind: "door", pending: null };
      this.step = "intro";
      this.orientation = this.mode === "demo" ? new R.DemoOrientation() : new R.Orientation();
      this.feed = null;
      this.viewer = null;
      this.busy = false;
      this.captured = new Map();
      this.lastFast = performance.now();
      this.release = () => {};
      this.build();
    }

    // ------------------------------------------------------------------------------------------------ layout
    build() {
      this.stageBox = h("div", { class: "scan-stage" });
      this.overlay = h("canvas", { class: "scan-overlay", "aria-hidden": "true" });
      this.map = h("canvas", { class: "scan-map", width: 132, height: 132, "aria-hidden": "true" });
      this.chip = h("div", { class: "scan-chip", "aria-live": "polite" });
      this.flash = h("div", { class: "scan-flash", "aria-hidden": "true" });
      this.stepsBar = h("ol", { class: "scan-steps", "aria-label": "Schritte" }, STEPS.map(([id, name]) => h("li", { "data-step": id, "aria-label": name })));
      this.panel = h("div", { class: "scan-panel" });
      this.root = h("div", { class: "scan", role: "dialog", "aria-modal": "true", "aria-label": "Raum scannen" },
        this.stageBox, this.overlay, this.flash,
        h("div", { class: "scan-top" }, this.stepsBar, h("button", { class: "icon-btn glass", type: "button", "aria-label": "Scan abbrechen", onclick: () => this.cancel() }, icon("close"))),
        this.chip, this.map, this.panel);
      document.body.append(this.root);
      document.body.classList.add("modal-open");
      this.showStep("intro");
      this.loop();
      this.onKey = (e) => { if (e.key === "Escape" && !document.querySelector(".dialog-back")) this.cancel(); };
      document.addEventListener("keydown", this.onKey);
    }

    async cancel() {
      if (this.step !== "intro" && (this.state.corners.length || this.state.photos.length)) {
        if (!(await confirmBox({ title: "Scan abbrechen?", text: "Was du bisher gemessen hast, geht verloren.", yes: "Abbrechen", no: "Weiter scannen", danger: true }))) return;
      }
      this.close();
      this.options.onCancel?.();
    }

    close() {
      this.closed = true;
      document.removeEventListener("keydown", this.onKey);
      this.orientation.stop();
      this.feed?.stop();
      this.viewer?.destroy();
      this.release();
      this.root.remove();
      if (!document.querySelector(".dialog-back")) document.body.classList.remove("modal-open");
    }

    showStep(step) {
      this.step = step;
      const index = STEPS.findIndex(([id]) => id === step);
      this.stepsBar.querySelectorAll("li").forEach((li, i) => { li.className = i < index ? "done" : i === index ? "on" : ""; });
      this.root.dataset.step = step;
      setText(this.chip, "");
      setClass(this.chip, "scan-chip");
      this[`render_${step}`]();
    }

    button(label, kind, onclick, extra = {}) { return h("button", { class: `btn ${kind}`, type: "button", onclick, ...extra }, label); }

    // ------------------------------------------------------------------------------------------- the feed
    async startFeed() {
      if (this.mode === "demo") {
        const canvas = h("canvas", { class: "scan-virtual" });
        this.stageBox.replaceChildren(canvas);
        this.viewer = new window.RaumoGL.Viewer(canvas, { fixed: true });
        const entry = this.options.demo;
        this.viewer.setItems([{ id: "demo", room: entry.room, layout: { x: 0, z: 0, rot: 0 }, textures: entry.textures, props: entry.props }]);
        this.viewer.setMode("pose");
        this.viewer.pose.fov = this.state.fov;
        this.feed = new R.VirtualFeed(this.viewer);
        let last = null;
        const turn = (e) => {
          if (e.buttons || e.pointerType === "touch") {
            if (last) this.orientation.turn(-(e.clientX - last[0]) * 0.18, -(e.clientY - last[1]) * 0.18);
            last = [e.clientX, e.clientY];
          } else last = null;
        };
        canvas.addEventListener("pointerdown", (e) => { last = [e.clientX, e.clientY]; canvas.setPointerCapture?.(e.pointerId); });
        canvas.addEventListener("pointermove", turn);
        canvas.addEventListener("pointerup", () => { last = null; });
        canvas.addEventListener("pointercancel", () => { last = null; });
        canvas.addEventListener("wheel", (e) => { e.preventDefault(); this.orientation.turn(e.deltaX * 0.05, -e.deltaY * 0.05); }, { passive: false });
        return;
      }
      const video = h("video", { class: "scan-video", playsinline: "", muted: "", autoplay: "" });
      this.stageBox.replaceChildren(video);
      this.feed = new R.CameraFeed(video);
      await this.feed.start();
    }

    /* The camera of the current moment: where the phone is and where it looks. */
    currentCamera(width, height) {
      const view = this.orientation.last;
      if (!view) return null;
      return Core.makeCamera({ position: [0, this.state.phoneHeight, 0], forward: view.forward, up: view.up, width, height, pixels: null }, this.state.fov);
    }

    /* A point of the room on the screen (or null if it is behind the camera). The picture is the whole frame of the camera, shown
       "cover" -- cut at its sides or above and below to fill the stage. */
    toStage(point) {
      const size = this.feed && this.feed.size();
      const W = this.overlay.clientWidth, H = this.overlay.clientHeight;
      if (!size || !size.width || !W) return null;
      const cam = this.currentCamera(size.width, size.height);
      if (!cam) return null;
      const q = Core.project(cam, point);
      if (!q) return null;
      const s = Math.max(W / size.width, H / size.height);
      return [((q[0] + 1) / 2 * size.width - size.width / 2) * s + W / 2, ((1 - q[1]) / 2 * size.height - size.height / 2) * s + H / 2];
    }

    /* A line between two points of the room, cut at the camera so that it can be drawn when one end is behind it. */
    lineToStage(a, b) {
      const size = this.feed && this.feed.size();
      const view = this.orientation.last;
      if (!size || !view) return null;
      const eye = [0, this.state.phoneHeight, 0];
      const near = 0.12;
      const local = (p) => { const d = Core.sub(p, eye); return [Core.dot(d, Core.cross(view.forward, view.up)), Core.dot(d, view.up), Core.dot(d, view.forward)]; };
      let ca = local(a), cb = local(b);
      if (ca[2] < near && cb[2] < near) return null;
      if (ca[2] < near) ca = lerp3(ca, cb, (near - ca[2]) / (cb[2] - ca[2]));
      if (cb[2] < near) cb = lerp3(cb, ca, (near - cb[2]) / (ca[2] - cb[2]));
      const toWorld = (c) => Core.add(eye, Core.add(Core.mul(Core.cross(view.forward, view.up), c[0]), Core.add(Core.mul(view.up, c[1]), Core.mul(view.forward, c[2]))));
      const p = this.toStage(toWorld(ca)), q = this.toStage(toWorld(cb));
      return p && q ? [p, q] : null;
    }

    // ------------------------------------------------------------------------------------------- drawing
    loop() {
      if (this.closed) return;
      this.frame();
      let ran = false;
      const next = () => { if (ran || this.closed) return; ran = true; this.loop(); };
      requestAnimationFrame(next);
      setTimeout(next, 80);
    }

    frame() {
      const canvas = this.overlay;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (!W || !H) return;
      if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) { canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio); }
      const g = canvas.getContext("2d");
      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, W, H);
      if (this.viewer && this.orientation.last) {
        const view = this.orientation.last;
        this.viewer.pose.position = [0, this.state.phoneHeight, 0];
        this.viewer.pose.forward = view.forward;
        this.viewer.pose.up = view.up;
        this.viewer.pose.fov = this.state.fov;
        this.viewer.render();
      }
      if (!this.feed || !this.orientation.last) return;
      const view = this.orientation.last;
      const aim = Core.floorPoint(view.forward, this.state.phoneHeight);
      this.aim = aim;
      if (["corners", "ceiling", "openings", "photos"].includes(this.step)) {
        this.drawMarks(g, W, H);
        this.drawCross(g, W / 2, H / 2, aim);
      }
      this.updateHud(aim);
      this.drawMap();
      if (this.step === "photos") this.autoCapture();
    }

    drawMarks(g, W, H) {
      const s = this.state;
      const corners = s.corners.map((c) => [c.x, 0, c.z]);
      g.lineWidth = 3;
      g.strokeStyle = "rgba(255,190,60,0.95)";
      g.fillStyle = "rgba(255,190,60,0.95)";
      g.lineJoin = "round";
      const count = corners.length;
      for (let i = 0; i < count; i++) {
        const a = corners[i], b = corners[(i + 1) % count];
        if (i === count - 1 && count < 3) break;
        const seg = this.lineToStage(a, b);
        if (seg) { g.beginPath(); g.moveTo(...seg[0]); g.lineTo(...seg[1]); g.stroke(); }
        const up = this.lineToStage(a, [a[0], this.step === "photos" ? 0.001 : Math.min(2.2, s.height || 1.4), a[2]]);
        if (up && this.step !== "photos") { g.save(); g.globalAlpha = 0.55; g.beginPath(); g.moveTo(...up[0]); g.lineTo(...up[1]); g.stroke(); g.restore(); }
      }
      g.font = "700 13px system-ui, sans-serif";
      g.textAlign = "center";
      corners.forEach((p, i) => {
        const q = this.toStage(p);
        if (!q) return;
        g.fillStyle = "rgba(20,14,4,0.85)"; g.beginPath(); g.arc(q[0], q[1], 11, 0, Math.PI * 2); g.fill();
        g.strokeStyle = "rgba(255,190,60,0.95)"; g.lineWidth = 2; g.beginPath(); g.arc(q[0], q[1], 11, 0, Math.PI * 2); g.stroke();
        g.fillStyle = "#ffd36a"; g.fillText(String(i + 1), q[0], q[1] + 4.5);
      });
      if (this.step === "ceiling" && this.ceilingCorner != null) {
        const c = s.corners[this.ceilingCorner];
        const seg = c && this.lineToStage([c.x, 0, c.z], [c.x, 2.8, c.z]);
        if (seg) { g.strokeStyle = "rgba(120,220,255,0.95)"; g.lineWidth = 3; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(...seg[0]); g.lineTo(...seg[1]); g.stroke(); g.setLineDash([]); }
      }
      if (this.step === "openings") {
        const room = this.tentativeRoom();
        if (room) {
          g.strokeStyle = "rgba(120,220,255,0.9)"; g.lineWidth = 2.5;
          for (const o of room.openings) {
            const w = Core.wallsOf(room.polygon)[o.wall];
            const at = (u, v) => [w.a[0] + w.dir[0] * u, v, w.a[1] + w.dir[1] * u];
            const pts = [at(o.u0, o.v0), at(o.u1, o.v0), at(o.u1, o.v1), at(o.u0, o.v1)];
            for (let i = 0; i < 4; i++) { const seg = this.lineToStage(pts[i], pts[(i + 1) % 4]); if (seg) { g.beginPath(); g.moveTo(...seg[0]); g.lineTo(...seg[1]); g.stroke(); } }
          }
        }
        if (s.pending) {
          const q = this.toStage(s.pending.point);
          if (q) { g.fillStyle = "rgba(120,220,255,0.95)"; g.beginPath(); g.arc(q[0], q[1], 7, 0, Math.PI * 2); g.fill(); }
        }
      }
    }

    drawCross(g, x, y, aim) {
      const level = this.step === "corners" && aim ? levelOf(aim.error) : "none";
      const color = { good: "#7dffa8", mid: "#ffd36a", bad: "#ff7a7a", none: "#ffffff" }[level];
      g.strokeStyle = color; g.lineWidth = 2.5; g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 4;
      g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.moveTo(x - 30, y); g.lineTo(x - 8, y); g.moveTo(x + 8, y); g.lineTo(x + 30, y); g.moveTo(x, y - 30); g.lineTo(x, y - 8); g.moveTo(x, y + 8); g.lineTo(x, y + 30); g.stroke();
      g.shadowBlur = 0;
    }

    updateHud(aim) {
      if (this.step === "corners") {
        if (aim) {
          const level = levelOf(aim.error);
          const hint = level === "bad" ? " · zu flach, ungenau" : level === "mid" ? " · etwas ungenau" : "";
          setText(this.chip, `≈ ${metres(aim.distance)} entfernt · ±${num(aim.error, 0)} %${hint}`);
          setClass(this.chip, `scan-chip ${level}`);
        } else {
          setText(this.chip, "Kippe das Handy nach unten zum Boden");
          setClass(this.chip, "scan-chip bad");
        }
        this.updateCornerButtons(!!aim);
      } else if (this.step === "ceiling") this.updateCeiling();
      else if (this.step === "openings") this.updateOpeningsHud();
      else if (this.step === "photos") this.updatePhotoHud();
    }

    drawMap() {
      const g = this.map.getContext("2d");
      g.clearRect(0, 0, 132, 132);
      const s = this.state;
      if (!["corners", "ceiling", "openings", "photos"].includes(this.step)) { this.map.style.display = "none"; return; }
      this.map.style.display = "";
      g.fillStyle = "rgba(10,10,14,0.62)"; g.beginPath(); g.roundRect ? g.roundRect(0, 0, 132, 132, 14) : g.rect(0, 0, 132, 132); g.fill();
      const pts = s.corners.map((c) => [c.x, c.z]);
      if (this.aim) pts.push([this.aim.x, this.aim.z]);
      pts.push([0, 0]);
      const b = Core.bounds(pts);
      const size = Math.max(b.width, b.depth, 2);
      const k = 100 / size;
      const ox = 66 - ((b.minX + b.maxX) / 2) * k, oz = 66 - ((b.minZ + b.maxZ) / 2) * k;
      const at = ([x, z]) => [ox + x * k, oz + z * k];
      if (s.corners.length >= 2) {
        g.strokeStyle = "#ffbe3c"; g.lineWidth = 2; g.beginPath();
        s.corners.forEach((c, i) => { const [px, pz] = at([c.x, c.z]); if (i) g.lineTo(px, pz); else g.moveTo(px, pz); });
        if (s.corners.length >= 3) g.closePath();
        g.stroke();
        if (s.corners.length >= 3) { g.fillStyle = "rgba(255,190,60,0.16)"; g.fill(); }
      }
      g.fillStyle = "#ffd36a";
      for (const c of s.corners) { const [px, pz] = at([c.x, c.z]); g.beginPath(); g.arc(px, pz, 3, 0, Math.PI * 2); g.fill(); }
      const view = this.orientation.last;
      const [sx, sz] = at([0, 0]);
      if (view) {
        const flat = Math.hypot(view.forward[0], view.forward[2]) || 1;
        const dx = view.forward[0] / flat, dz = view.forward[2] / flat;
        g.fillStyle = "rgba(125,220,255,0.28)";
        g.beginPath(); g.moveTo(sx, sz); g.arc(sx, sz, 30, Math.atan2(dz, dx) - 0.62, Math.atan2(dz, dx) + 0.62); g.closePath(); g.fill();
      }
      g.fillStyle = "#7ddcff"; g.beginPath(); g.arc(sx, sz, 4.5, 0, Math.PI * 2); g.fill();
      if (this.aim && this.step === "corners") { const [px, pz] = at([this.aim.x, this.aim.z]); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.arc(px, pz, 4, 0, Math.PI * 2); g.stroke(); }
    }

    // ---------------------------------------------------------------------------------------------- steps
    render_intro() {
      const sensors = typeof DeviceOrientationEvent !== "undefined";
      const secure = window.isSecureContext !== false;
      const problem = this.mode === "demo" ? null : !secure ? "Die Kamera funktioniert nur, wenn die Seite über https geöffnet ist."
        : !R.CameraFeed.supported() ? "Dieser Browser kann die Kamera nicht benutzen." : !sensors ? "Dieses Gerät meldet keine Lagesensoren (zum Beispiel ein Computer)." : null;
      this.error = h("p", { class: "form-error", role: "alert", hidden: true });
      fill(this.panel, h("div", { class: "scan-card intro" },
        h("h2", {}, this.mode === "demo" ? "Übungsraum" : "Raum scannen"),
        this.mode === "demo"
          ? h("p", {}, "Du stehst in einem Übungsraum auf dem Bildschirm. Ziehe mit der Maus (oder dem Finger), um dich umzusehen, und miss ihn genau so wie einen echten Raum.")
          : h("p", {}, "Stell dich in die Mitte des Raums und halte das Handy aufrecht. Du zeigst nacheinander auf die Ecken am Boden, die App berechnet daraus den Grundriss und baut das 3D-Modell."),
        h("ul", { class: "ticks" }, h("li", {}, "Bleib an einer Stelle stehen und dreh dich nur."), h("li", {}, "Von dort müssen alle Ecken zu sehen sein."), h("li", {}, "Alles bleibt auf deinem Gerät, nichts wird hochgeladen.")),
        problem ? h("p", { class: "notice" }, problem) : null, this.error,
        h("div", { class: "scan-actions" },
          this.mode === "demo" || !problem ? this.button(this.mode === "demo" ? "Los geht's" : "Kamera und Sensoren erlauben", "primary", (e) => this.begin(e.currentTarget)) : null,
          this.mode !== "demo" ? this.button("Übungsraum am Bildschirm", "ghost", () => this.options.onSwitchToDemo?.()) : null,
          this.button("Abbrechen", "ghost", () => this.cancel()))));
    }

    async begin(button) {
      button.disabled = true;
      this.error.hidden = true;
      try {
        if (this.mode !== "demo") {
          const result = await this.orientation.request();
          if (!result.ok) {
            throw new Error(result.reason === "denied" ? "Der Zugriff auf die Bewegungssensoren wurde nicht erlaubt. Erlaube ihn in den Einstellungen deines Browsers und lade die Seite neu." : "Dieses Gerät meldet keine Lagesensoren. Probiere den Übungsraum oder gib die Maße ein.");
          }
        } else await this.orientation.request();
        await this.startFeed();
        this.release = await R.keepAwake();
        this.showStep("height");
      } catch (error) {
        this.error.textContent = error.message || "Das hat nicht geklappt.";
        this.error.hidden = false;
        button.disabled = false;
      }
    }

    render_height() {
      const s = this.state;
      const value = h("output", { class: "big-number" }, metres(s.phoneHeight));
      const slider = h("input", { type: "range", min: "0.9", max: "1.9", step: "0.01", value: String(s.phoneHeight), "aria-label": "Höhe des Handys über dem Boden", oninput: (e) => { s.phoneHeight = Number(e.target.value); value.textContent = metres(s.phoneHeight); } });
      const preset = (label, v) => this.button(label, "chip", () => { s.phoneHeight = v; slider.value = String(v); value.textContent = metres(v); });
      fill(this.panel, h("div", { class: "scan-card" },
        h("h2", {}, "Wie hoch hältst du das Handy?"), value, slider,
        h("div", { class: "chips" }, preset("Brusthöhe 1,30 m", 1.3), preset("Kinnhöhe 1,45 m", 1.45), preset("Augenhöhe 1,60 m", 1.6)),
        h("p", { class: "muted small" }, "Der Abstand vom Handy zum Boden. Halte es beim ganzen Scan gleich hoch, mit beiden Händen und die Ellbogen am Körper. Ist die Zahl etwas falsch, korrigierst du am Ende mit einem gemessenen Maß alles auf einmal."),
        h("div", { class: "scan-actions" }, this.button("Weiter", "primary", () => this.showStep("corners")))));
    }

    render_corners() {
      this.cornerHint = h("p", { class: "scan-hint" });
      this.setBtn = h("button", { class: "capture", type: "button", "aria-label": "Ecke setzen" }, h("span", {}));
      this.undoBtn = h("button", { class: "icon-btn glass", type: "button", "aria-label": "Letzte Ecke zurücknehmen", onclick: () => this.undoCorner() }, icon("undo"));
      this.doneBtn = this.button("Fertig", "primary small", () => this.finishCorners());
      this.armCapture(this.setBtn, (view) => this.addCorner(view));
      fill(this.panel, h("div", { class: "scan-bar" }, this.cornerHint, h("div", { class: "scan-controls" }, this.undoBtn, this.setBtn, this.doneBtn)));
      this.updateCornerButtons(false);
    }

    updateCornerButtons(aiming) {
      const n = this.state.corners.length;
      this.undoBtn.disabled = n === 0;
      this.doneBtn.hidden = n < 3;
      this.setBtn.disabled = !aiming;
      setText(this.cornerHint, n === 0 ? "Zeige auf die erste Ecke am Boden, dort wo zwei Wände zusammenstoßen, und tippe auf den Knopf."
        : n < 3 ? `Ecke ${n} gesetzt. Weiter zur nächsten Ecke im Kreis, in welche Richtung ist egal.`
        : `${n} Ecken. Weiter zur nächsten, oder tippe auf „Fertig“, wenn du alle hast.`);
    }

    /* A button that remembers where the phone pointed just *before* the finger came down, and then acts on that. */
    armCapture(button, action) {
      let armed = null;
      button.addEventListener("pointerdown", () => { armed = this.orientation.window(500, 100); });
      button.addEventListener("click", () => { const view = armed || this.orientation.window(500, 100); armed = null; action(view); });
    }

    addCorner(view) {
      const s = this.state;
      const fp = view && Core.floorPoint(view.forward, s.phoneHeight);
      if (!fp) { toast("Zeige zuerst auf den Boden."); return; }
      const first = s.corners[0];
      if (s.corners.length >= 3 && Math.hypot(fp.x - first.x, fp.z - first.z) < 0.4) { toast("Das ist wieder die erste Ecke: der Raum ist geschlossen."); this.finishCorners(); return; }
      const previous = s.corners[s.corners.length - 1];
      if (previous && Math.hypot(fp.x - previous.x, fp.z - previous.z) < 0.15) { toast("Diese Ecke hast du schon gesetzt."); return; }
      const next = [...s.corners.map((c) => [c.x, c.z]), [fp.x, fp.z]];
      if (next.length >= 4 && !Core.isSimple(next)) { toast("Die Wände würden sich kreuzen. Setze die Ecken der Reihe nach, einmal um den Raum."); return; }
      s.corners.push({ x: fp.x, z: fp.z, error: fp.error });
      navigator.vibrate?.(30);
      this.pulse();
    }

    undoCorner() { this.state.corners.pop(); }

    finishCorners() {
      const poly = this.state.corners.map((c) => [c.x, c.z]);
      if (poly.length < 3 || Core.polygonArea(poly) < 1) { toast("Das ist noch kein Raum: setze mindestens drei Ecken."); return; }
      if (!Core.isSimple(poly)) { toast("Die Wände kreuzen sich. Nimm die letzten Ecken zurück."); return; }
      this.showStep("ceiling");
    }

    pulse() { this.flash.classList.remove("on"); void this.flash.offsetWidth; this.flash.classList.add("on"); }

    // ------------------------------------------------------------------------------------------ ceiling
    render_ceiling() {
      const s = this.state;
      if (s.height == null) s.height = 2.5;
      this.heightOut = h("output", { class: "big-number" }, metres(s.height));
      this.measureBtn = h("button", { class: "capture ceiling", type: "button", "aria-label": "Höhe messen" }, h("span", {}));
      this.armCapture(this.measureBtn, (view) => this.measureHeight(view));
      const step = (d) => { s.height = Core.clamp(Math.round((s.height + d) * 100) / 100, 1.8, 6); this.heightOut.textContent = metres(s.height); };
      this.ceilingHint = h("p", { class: "scan-hint" }, "Zeige auf die Kante, wo eine Wand oben an die Decke stößt, über einer gesetzten Ecke.");
      fill(this.panel, h("div", { class: "scan-bar tall" },
        h("div", { class: "height-row" }, this.button("−", "chip round", () => step(-0.01)), this.heightOut, this.button("+", "chip round", () => step(0.01))), this.ceilingHint,
        h("div", { class: "scan-controls" }, this.button("2,50 m", "ghost small", () => { s.height = 2.5; this.heightOut.textContent = metres(2.5); }), this.measureBtn, this.button("Weiter", "primary small", () => this.showStep("openings")))));
    }

    /* The corner whose direction is closest to where the phone points (within 35 degrees). */
    nearestCorner(view) {
      const yaw = Core.yawDeg(view.forward);
      let best = null;
      this.state.corners.forEach((c, i) => {
        const d = angleDiff(yaw, Core.yawDeg([c.x, 0, c.z]));
        if (d < 35 && (!best || d < best.d)) best = { i, d, distance: Math.hypot(c.x, c.z) };
      });
      return best;
    }

    updateCeiling() {
      const view = this.orientation.last;
      const near = view && this.nearestCorner(view);
      this.ceilingCorner = near ? near.i : null;
      const up = view && view.forward[1] > 0.1;
      this.measureBtn.disabled = !(near && up);
      setText(this.chip, !up ? "Kippe das Handy nach oben zur Decke" : near ? `Über Ecke ${near.i + 1}` : "Dreh dich zu einer gesetzten Ecke");
      setClass(this.chip, `scan-chip ${near && up ? "good" : "bad"}`);
    }

    measureHeight(view) {
      const near = view && this.nearestCorner(view);
      const value = near && Core.heightFromAim(view.forward, near.distance, this.state.phoneHeight);
      if (!value) { toast("Zeige auf die Kante zwischen Wand und Decke über einer Ecke."); return; }
      this.state.height = Core.clamp(Math.round(value * 100) / 100, 1.8, 6);
      this.heightOut.textContent = metres(this.state.height);
      navigator.vibrate?.(30);
      this.pulse();
    }

    // ----------------------------------------------------------------------------------------- openings
    tentativeRoom() {
      const s = this.state;
      if (s.corners.length < 3) return null;
      try {
        return Core.roomFromScan({ phoneHeight: s.phoneHeight, height: s.height || 2.5, corners: s.corners, openings: s.openings });
      } catch (error) { return null; }
    }

    render_openings() {
      const s = this.state;
      this.openingList = h("ul", { class: "opening-list" });
      this.openingHint = h("p", { class: "scan-hint" });
      this.pointBtn = h("button", { class: "capture small", type: "button", "aria-label": "Punkt setzen" }, h("span", {}));
      this.armCapture(this.pointBtn, (view) => this.addOpeningPoint(view));
      this.kindBar = R.segmented([["door", "Tür"], ["window", "Fenster"], ["passage", "Durchgang"]], s.openingKind, (v) => { s.openingKind = v; s.pending = null; this.refreshOpenings(); }, "Art der Öffnung");
      fill(this.panel, h("div", { class: "scan-bar tall" }, this.kindBar, this.openingHint, this.openingList,
        h("div", { class: "scan-controls" }, this.pointBtn, this.button(s.openings.length ? "Weiter" : "Überspringen", "primary small", () => { s.pending = null; this.showStep("photos"); }))));
      this.refreshOpenings();
    }

    refreshOpenings() {
      const s = this.state;
      this.openingHint.textContent = s.pending
        ? "Zeige jetzt auf die gegenüberliegende Ecke (zum Beispiel oben rechts) und tippe noch einmal."
        : `${KIND_LABEL[s.openingKind]} markieren: Zeige auf eine Ecke (zum Beispiel unten links) und tippe auf den Knopf. Das ist freiwillig.`;
      fill(this.openingList, s.openings.map((raw) => {
        const found = this.describeOpening(raw);
        return h("li", {}, h("span", {}, found ? `${KIND_LABEL[raw.kind]} · ${num(found.u1 - found.u0)} × ${num(found.v1 - found.v0)} m · Wand ${found.wall + 1}` : `${KIND_LABEL[raw.kind]} · passt zu keiner Wand`),
          h("button", { class: "icon-btn small", type: "button", "aria-label": `${KIND_LABEL[raw.kind]} entfernen`, onclick: () => { s.openings = s.openings.filter((x) => x !== raw); this.refreshOpenings(); } }, icon("trash")));
      }));
    }

    /* What one marked opening turns into (its wall and size), or null when its two corners do not lie on one wall. */
    describeOpening(raw) {
      const s = this.state;
      if (s.corners.length < 3) return null;
      const room = Core.roomFromScan({ phoneHeight: s.phoneHeight, height: s.height || 2.5, corners: s.corners, openings: [raw] });
      return room.openings[0] || null;
    }

    updateOpeningsHud() {
      const view = this.orientation.last;
      const room = this.tentativeRoom();
      const hit = view && room && Core.wallHit(room, [0, this.state.phoneHeight, 0], view.forward);
      this.pointBtn.disabled = !hit;
      setText(this.chip, hit ? `Wand ${hit.wall + 1} · ${num(hit.u)} m von links · ${num(hit.v)} m hoch` : "Zeige auf eine Wand");
      setClass(this.chip, `scan-chip ${hit ? "good" : "bad"}`);
    }

    addOpeningPoint(view) {
      const s = this.state;
      const room = this.tentativeRoom();
      const origin = [0, s.phoneHeight, 0];
      const hit = view && room && Core.wallHit(room, origin, view.forward);
      if (!hit) { toast("Zeige auf eine Wand."); return; }
      const point = Core.add(origin, Core.mul(view.forward, hit.t));
      if (!s.pending) { s.pending = { dir: view.forward, hit, point }; navigator.vibrate?.(30); this.pulse(); this.refreshOpenings(); return; }
      const first = s.pending;
      if (first.hit.wall !== hit.wall) { toast("Beide Punkte müssen auf derselben Wand liegen."); s.pending = null; this.refreshOpenings(); return; }
      if (Math.abs(first.hit.u - hit.u) < 0.2 || Math.abs(first.hit.v - hit.v) < 0.2) { toast("Die Öffnung ist zu klein. Zeige auf zwei gegenüberliegende Ecken."); s.pending = null; this.refreshOpenings(); return; }
      s.openings.push({ kind: s.openingKind, from: first.dir, to: view.forward });
      s.pending = null;
      navigator.vibrate?.(60);
      this.pulse();
      this.refreshOpenings();
    }

    // -------------------------------------------------------------------------------------------- photos
    render_photos() {
      this.rowChips = ROWS.map((row) => h("li", { "data-row": row.id }, h("b", {}, row.label), h("span", {})));
      this.photoHint = h("p", { class: "scan-hint" }, "Jetzt die Fotos für die Wände: Drehe dich langsam einmal im Kreis. Die App löst von selbst aus, sobald du ruhig zielst. Danach kippe das Handy zum Boden und zur Decke.");
      this.photoDone = this.button("Fertig", "primary small", () => this.finishPhotos());
      this.manualBtn = h("button", { class: "capture small", type: "button", "aria-label": "Foto machen", onclick: () => this.capturePhoto(true) }, h("span", {}));
      fill(this.panel, h("div", { class: "scan-bar tall" }, h("ul", { class: "row-chips" }, this.rowChips), this.photoHint,
        h("div", { class: "scan-controls" }, this.manualBtn, this.photoDone)));
      this.updatePhotoHud();
    }

    updatePhotoHud() {
      const counts = ROWS.map((row) => [...this.captured.keys()].filter((k) => k.startsWith(`${row.id}:`)).length);
      this.rowChips.forEach((chip, i) => {
        const total = Math.round(360 / ROWS[i].step);
        setText(chip.lastChild, `${counts[i]}/${total}`);
        chip.classList.toggle("full", counts[i] >= total);
      });
      const view = this.orientation.last;
      const row = view && this.rowFor(view);
      setText(this.chip, this.busy ? "Foto …" : row ? `${row.label}: drehe dich weiter` : "Halte das Handy waagerecht, oder kippe es zum Boden oder zur Decke");
      setClass(this.chip, `scan-chip ${row ? "good" : "mid"}`);
      setText(this.photoDone, this.state.photos.length ? `Fertig (${this.state.photos.length})` : "Ohne Fotos fertig");
    }

    rowFor(view) {
      const pitch = Core.pitchDeg(view.forward);
      return ROWS.find((r) => Math.abs(pitch - r.pitch) <= r.tolerance) || null;
    }

    autoCapture() {
      const now = performance.now();
      if (this.orientation.speed(220) > 14) this.lastFast = now;
      if (this.busy || now - this.lastFast < 260) return;
      const view = this.orientation.last;
      const row = view && this.rowFor(view);
      if (!row) return;
      const yaw = Core.yawDeg(view.forward);
      const sector = sectorOf(row, yaw);
      if (this.captured.has(`${row.id}:${sector}`)) return;
      if (angleDiff(yaw, sector * row.step) > Math.min(8, row.step / 3)) return;
      this.capturePhoto(false, row, sector);
    }

    async capturePhoto(manual, row, sector) {
      if (this.busy || this.state.photos.length >= 120) return;
      const view = this.orientation.window(200, 0) || this.orientation.last;
      if (!view) return;
      row = row || this.rowFor(view);
      sector = sector != null ? sector : row ? sectorOf(row, Core.yawDeg(view.forward)) : null;
      this.busy = true;
      try {
        const shot = await this.feed.grab(800, 0.8);
        if (!shot) { if (manual) toast("Die Kamera liefert noch kein Bild."); return; }
        this.state.photos.push({ blob: shot.blob, width: shot.width, height: shot.height, forward: view.forward, up: view.up, position: [0, this.state.phoneHeight, 0] });
        if (row && sector != null) this.captured.set(`${row.id}:${sector}`, true);
        navigator.vibrate?.(15);
        this.pulse();
      } finally {
        this.busy = false;
        this.lastFast = performance.now() - 100;
      }
    }

    async finishPhotos() {
      const n = this.state.photos.length;
      if (n > 0 && n < 8) {
        if (!(await confirmBox({ title: "Nur wenige Fotos", text: `Mit ${n} Fotos bleiben viele Wandstücke ohne Bild. Du kannst weiter fotografieren oder so fertig werden.`, yes: "Fertig", no: "Weiter fotografieren" }))) return;
      }
      this.finish();
    }

    // ------------------------------------------------------------------------------------------ finish
    finish() {
      const s = this.state;
      const result = { mode: this.mode, phoneHeight: s.phoneHeight, height: s.height || 2.5, corners: s.corners.map((c) => ({ x: c.x, z: c.z })), openings: s.openings, photos: s.photos, fov: s.fov, error: Math.max(0, ...s.corners.map((c) => c.error)) };
      this.close();
      this.options.onDone(result);
    }
  }

  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  R.ScanWizard = ScanWizard;
  R.openScan = (options) => new ScanWizard(options);
  R.SCAN_ROWS = ROWS;
})();
