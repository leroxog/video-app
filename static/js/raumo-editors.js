/* raumo editors: two small editors for what a scan got slightly wrong -- the floor plan of a room (drag the corners, add and remove
   them) and one door or window (which wall, where, how big).  Each opens a dialog and answers with the changed room, or null. */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const R = (window.Raumo = window.Raumo || {});
  const { h, put, fill, dialog, segmented, num, metres, svgElement } = R;

  const KIND = Core.OPENING_KINDS;
  const NS = "http://www.w3.org/2000/svg";
  const f = (x) => (Math.round(x * 1000) / 1000).toString();

  // ----------------------------------------------------------------------------------------------- openings
  /* A door, window or passage: `index` is the opening to change, or -1 for a new one. Answers with the changed room or null. */
  R.editOpening = function editOpening(room, index) {
    return new Promise((resolve) => {
      const walls = Core.wallsOf(room.polygon);
      const old = index >= 0 ? room.openings[index] : null;
      const first = old || { kind: "door", wall: 0, u0: Math.max(0.3, (walls[0].len - 0.9) / 2), u1: 0, v0: 0, v1: 2.0 };
      const state = { kind: first.kind, wall: first.wall, left: first.u0, width: old ? first.u1 - first.u0 : 0.9, height: old ? first.v1 - first.v0 : 2.0, sill: old && first.kind === "window" ? first.v0 : 0.9 };
      let answered = false;
      const field = (label, key, unit, extra = {}) => {
        const input = h("input", { class: "field", type: "text", inputmode: "decimal", "aria-label": label, autocomplete: "off", maxlength: 8 });
        input.value = num(state[key]);
        input.addEventListener("input", () => { const v = Number(input.value.replace(",", ".")); if (Number.isFinite(v)) { state[key] = v; preview(); } });
        return h("label", { class: `field-label ${extra.class || ""}` }, h("span", {}, label), h("div", { class: "with-unit" }, input, h("span", { class: "unit" }, unit)));
      };
      const kindBar = segmented(Object.entries(KIND).map(([k, v]) => [k, v]), state.kind, (k) => {
        state.kind = k;
        if (!old) { state.width = k === "window" ? 1.2 : 0.9; state.height = k === "window" ? 1.2 : 2.0; }
        sillField.hidden = k !== "window";
        preview();
      }, "Art");
      const wallSelect = h("select", { class: "field", "aria-label": "Wand" }, walls.map((w) => h("option", { value: String(w.index) }, `Wand ${w.index + 1} (${metres(w.len)})`)));
      wallSelect.value = String(state.wall);
      wallSelect.addEventListener("change", () => { state.wall = Number(wallSelect.value); preview(); });
      const sillField = field("Brüstungshöhe", "sill", "m");
      sillField.hidden = state.kind !== "window";
      const message = h("p", { class: "form-error", role: "alert", hidden: true });
      const drawing = h("div", { class: "opening-preview", "aria-hidden": "true" });

      const candidate = () => {
        const wall = walls[state.wall];
        const v0 = state.kind === "window" ? state.sill : 0;
        return Core.fitOpening({ wall: state.wall, u0: state.left, u1: state.left + state.width, v0, v1: v0 + state.height, kind: state.kind }, walls, room.height);
      };
      const others = () => room.openings.filter((_, i) => i !== index);
      const problem = () => {
        const o = candidate();
        if (!o) return "Die Öffnung passt so nicht auf die Wand. Sie muss mindestens 20 cm breit und hoch sein und auf der Wand liegen.";
        if (Math.abs(o.u1 - o.u0 - state.width) > 0.011 || (state.kind === "window" ? Math.abs(o.v1 - o.v0 - state.height) > 0.011 : false)) return "Die Öffnung ragt über die Wand hinaus. Verkleinere sie oder schiebe sie.";
        if (others().some((x) => Core.openingsOverlap(x, o))) return "An dieser Stelle ist schon eine andere Öffnung.";
        return null;
      };
      function preview() {
        const wall = walls[state.wall];
        const W = wall.len, H = room.height;
        const rect = (o, cls) => `<rect class="${cls}" x="${f(o.u0)}" y="${f(H - o.v1)}" width="${f(o.u1 - o.u0)}" height="${f(o.v1 - o.v0)}"/>`;
        const mine = candidate();
        const svg = `<svg xmlns="${NS}" viewBox="-0.1 -0.1 ${f(W + 0.2)} ${f(H + 0.2)}" preserveAspectRatio="xMidYMid meet" role="img"><rect class="wall" x="0" y="0" width="${f(W)}" height="${f(H)}"/>${room.openings.filter((o, i) => o.wall === state.wall && i !== index).map((o) => rect(o, "other")).join("")}${mine ? rect(mine, "mine") : ""}</svg>`;
        fill(drawing, svgElement(svg));
        const text = problem();
        message.textContent = text || "";
        message.hidden = !text;
      }

      const body = h("div", { class: "opening-editor" }, kindBar, drawing, h("label", { class: "field-label" }, h("span", {}, "Wand"), wallSelect),
        field("Abstand von der linken Seite der Wand", "left", "m"), field("Breite", "width", "m"), field("Höhe der Öffnung", "height", "m"), sillField, message);
      dialog({ title: old ? "Öffnung bearbeiten" : "Tür oder Fenster hinzufügen", body, wide: true, onClose: () => { if (!answered) resolve(null); },
        actions: [{ label: "Übernehmen", kind: "primary", run: () => {
          const text = problem();
          if (text) { message.textContent = text; message.hidden = false; return false; }
          const o = candidate();
          const openings = room.openings.filter((_, i) => i !== index).concat([o]);
          answered = true;
          resolve(Core.makeRoom({ ...room, openings }));
          return true;
        } }] });
      preview();
    });
  };

  // --------------------------------------------------------------------------------------------- floor plan
  /* The floor plan of a room: drag the corners, tap a "+" on a wall to add a corner, delete a selected corner, straighten the angles. */
  R.editPlan = function editPlan(room) {
    return new Promise((resolve) => {
      const original = room.polygon.map((p) => p.slice());
      let poly = original.map((p) => p.slice());
      let selected = -1, dragging = -1, keyboard = false, answered = false;
      const b0 = Core.bounds(original);
      const pad = 1.5;
      const view = { x: b0.minX - pad, z: b0.minZ - pad, w: b0.width + 2 * pad, h: b0.depth + 2 * pad };
      const host = h("div", { class: "plan-editor", tabindex: "-1" });
      const message = h("p", { class: "form-error", role: "alert", hidden: true });
      const info = h("p", { class: "muted small plan-info" });
      const del = h("button", { class: "btn ghost small", type: "button", onclick: () => { if (selected >= 0 && poly.length > 3) { poly.splice(selected, 1); selected = -1; render(); } } }, "Ecke löschen");
      const square = h("button", { class: "btn ghost small", type: "button", onclick: () => { const { polygon, snapped } = Core.orthogonalize(poly, 14); if (snapped) { poly = polygon; render(); } else message.textContent = "Keine Wand ist annähernd rechtwinklig."; } }, "Rechte Winkel");
      const reset = h("button", { class: "btn ghost small", type: "button", onclick: () => { poly = original.map((p) => p.slice()); selected = -1; render(); } }, "Zurücksetzen");

      const scale = () => (host.clientWidth || 360) / view.w;
      const problem = () => {
        if (!Core.isSimple(poly)) return "Die Wände kreuzen sich. Schiebe die Ecken so, dass sie sich nicht schneiden.";
        if (Core.polygonArea(poly) < 1) return "Der Raum ist zu klein.";
        const walls = Core.wallsOf(Core.positive(poly));
        if (walls.some((w) => w.len < 0.2)) return "Eine Wand ist kürzer als 20 cm.";
        return null;
      };

      function render() {
        const k = scale();
        const r = 15 / k, rm = 9 / k, fs = 12 / k;
        const ok = !problem();
        let g = "";
        const lo = Math.floor(view.x), hi = Math.ceil(view.x + view.w), lz = Math.floor(view.z), hz = Math.ceil(view.z + view.h);
        for (let x = lo; x <= hi; x++) g += `<line class="grid${x % 5 === 0 ? " major" : ""}" x1="${x}" y1="${lz}" x2="${x}" y2="${hz}"/>`;
        for (let z = lz; z <= hz; z++) g += `<line class="grid${z % 5 === 0 ? " major" : ""}" x1="${lo}" y1="${z}" x2="${hi}" y2="${z}"/>`;
        g += `<path class="shape${ok ? "" : " bad"}" d="M${poly.map((p) => `${f(p[0])} ${f(p[1])}`).join("L")}Z"/>`;
        poly.forEach((p, i) => {
          const q = poly[(i + 1) % poly.length];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
          g += `<text class="len" x="${f(mx)}" y="${f(mz - 14 / k)}" font-size="${f(fs)}" text-anchor="middle">${num(len)} m</text>`;
          g += `<circle class="mid" data-mid="${i}" cx="${f(mx)}" cy="${f(mz)}" r="${f(rm)}" role="button" aria-label="Ecke zwischen ${i + 1} und ${((i + 1) % poly.length) + 1} einfügen"/><path class="plus" d="M${f(mx - rm * 0.5)} ${f(mz)}h${f(rm)}M${f(mx)} ${f(mz - rm * 0.5)}v${f(rm)}"/>`;
        });
        poly.forEach((p, i) => {
          g += `<circle class="vertex${i === selected ? " on" : ""}" data-vertex="${i}" cx="${f(p[0])}" cy="${f(p[1])}" r="${f(r)}" tabindex="0" role="button" aria-label="Ecke ${i + 1}. Mit den Pfeiltasten verschieben."/>`;
          g += `<text class="num" x="${f(p[0])}" y="${f(p[1] + fs * 0.35)}" font-size="${f(fs)}" text-anchor="middle">${i + 1}</text>`;
        });
        const svg = svgElement(`<svg xmlns="${NS}" viewBox="${f(view.x)} ${f(view.z)} ${f(view.w)} ${f(view.h)}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Grundriss des Raums">${g}</svg>`);
        host.replaceChildren(svg);
        message.textContent = problem() || "";
        message.hidden = !message.textContent;
        del.disabled = !(selected >= 0 && poly.length > 3);
        info.textContent = `${num(Core.polygonArea(Core.positive(poly)), 1)} m² · ${poly.length} Ecken`;
        if (keyboard && selected >= 0) host.querySelector(`[data-vertex="${selected}"]`)?.focus();
      }

      const toWorld = (e) => {
        const svg = host.firstElementChild;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX; pt.y = e.clientY;
        const p = pt.matrixTransform(svg.getScreenCTM().inverse());
        return [p.x, p.y];
      };
      host.addEventListener("pointerdown", (e) => {
        keyboard = false;
        const v = e.target.closest("[data-vertex]"), m = e.target.closest("[data-mid]");
        if (v) { selected = Number(v.dataset.vertex); dragging = selected; }
        else if (m) { const i = Number(m.dataset.mid); const a = poly[i], b = poly[(i + 1) % poly.length]; poly.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); selected = i + 1; dragging = selected; }
        else { selected = -1; render(); return; }
        host.setPointerCapture?.(e.pointerId);
        render();
      });
      host.addEventListener("pointermove", (e) => {
        if (dragging < 0) return;
        let [x, z] = toWorld(e);
        x = Math.round(x * 20) / 20; z = Math.round(z * 20) / 20;
        for (const [i, p] of poly.entries()) {                                // line up with the other corners
          if (i === dragging) continue;
          if (Math.abs(p[0] - x) < 0.07) x = p[0];
          if (Math.abs(p[1] - z) < 0.07) z = p[1];
        }
        poly[dragging] = [x, z];
        render();
      });
      const stop = () => { dragging = -1; };
      host.addEventListener("pointerup", stop);
      host.addEventListener("pointercancel", stop);
      host.addEventListener("keydown", (e) => {
        const v = e.target.closest && e.target.closest("[data-vertex]");
        if (!v) return;
        const i = Number(v.dataset.vertex);
        const step = e.shiftKey ? 0.25 : 0.05;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (poly.length > 3) { poly.splice(i, 1); selected = -1; keyboard = false; render(); } return; }
        if (!d) return;
        e.preventDefault();
        poly[i] = [Math.round((poly[i][0] + d[0]) * 100) / 100, Math.round((poly[i][1] + d[1]) * 100) / 100];
        selected = i; keyboard = true;
        render();
      });

      const body = h("div", { class: "plan-editor-wrap" }, h("p", { class: "muted small" }, "Ziehe die Ecken. Tippe auf ein „+“ an einer Wand, um eine Ecke einzufügen. Türen und Fenster bleiben an ihrer Wand."),
        host, info, h("div", { class: "button-row" }, del, square, reset), message);
      dialog({ title: "Grundriss bearbeiten", body, wide: true, onClose: () => { if (!answered) resolve(null); },
        actions: [{ label: "Übernehmen", kind: "primary", run: () => {
          const text = problem();
          if (text) { message.textContent = text; message.hidden = false; return false; }
          answered = true;
          resolve(Core.reshapeRoom(room, poly));
          return true;
        } }] });
      requestAnimationFrame(render);
      setTimeout(() => { if (!host.firstElementChild) render(); }, 60);
    });
  };
})();
