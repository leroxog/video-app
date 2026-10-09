/* raumo project: the screens of one building -- the 3D view of its point clouds and rooms, the floor plan with its rooms to move around,
   the list of scans and the export -- and of one measured room (its numbers, openings and pictures).  The editors for a room's floor
   plan and for its doors and windows are in raumo-editors.js. */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const Cloud = window.RaumoCloud;
  const Export = window.RaumoExport;
  const Store = window.RaumoStore;
  const R = (window.Raumo = window.Raumo || {});
  const { h, put, fill, icon, toast, dialog, confirmBox, promptBox, menu, segmented, num, metres, area, saveFile, svgElement } = R;

  const KIND = Core.OPENING_KINDS;
  const TABS = [["3d", "3D", "cube"], ["plan", "Grundriss", "plan"], ["scans", "Scans", "rooms"], ["export", "Export", "download"]];
  const MAX_SHOWN = 2500000;                              // points the phone is asked to draw at most
  const count = (n) => n.toLocaleString("de-DE");

  // ---------------------------------------------------------------------------------------------- helpers
  const placedRooms = (project) => project.rooms.map((stored) => ({ stored, room: Store.roomOf(stored), layout: project.layouts[stored.id] || { x: 0, z: 0, rot: 0 } }));
  const cloudMetas = (project) => project.clouds || [];
  const sizeText = (bytes) => (bytes > 1048576 ? `${num(bytes / 1048576, 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`);
  const isEmpty = (project) => !project.rooms.length && !cloudMetas(project).length;

  function totals(project) {
    const list = placedRooms(project);
    return { rooms: list.length, clouds: cloudMetas(project).length, area: list.reduce((s, r) => s + Core.polygonArea(r.room.polygon), 0), volume: list.reduce((s, r) => s + Core.roomStats(r.room).volume, 0), points: cloudMetas(project).reduce((s, c) => s + (c.count || 0), 0) };
  }

  /* The pixels of a picture (canvas, image bitmap): {width, height, data}. */
  function pictureData(source) {
    const canvas = document.createElement("canvas");
    canvas.width = source.width; canvas.height = source.height;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    g.drawImage(source, 0, 0);
    const d = g.getImageData(0, 0, canvas.width, canvas.height);
    return { width: d.width, height: d.height, data: d.data };
  }

  /* The points of a measured room (one every 5 cm on its walls, floor and ceiling, in the colours of its pictures). */
  function roomCloud(stored, room, textures) {
    const pictures = {};
    for (const [id, source] of Object.entries(textures || {})) pictures[id] = pictureData(source);
    return Cloud.sampleRoom(room, pictures);
  }

  /* The clouds of a project for the viewer: the stored ones, and the points of its measured rooms. */
  async function loadClouds(app, project, textures, onProgress, isDead) {
    const out = [];
    const metas = cloudMetas(project);
    const total = metas.length + project.rooms.length || 1;
    let done = 0;
    for (const meta of metas) {
      if (isDead && isDead()) return out;
      let points = await app.store.getCloud(meta.id);
      if (points) {
        if (points.count > MAX_SHOWN) points = Cloud.voxelize(points, 0.08);
        out.push({ id: meta.id, name: meta.name, ...points, layout: project.layouts[meta.id] || { x: 0, z: 0, rot: 0 } });
      }
      onProgress?.(++done / total);
    }
    for (const { stored, room, layout } of placedRooms(project)) {
      if (isDead && isDead()) return out;
      const points = roomCloud(stored, room, textures && textures[stored.id]);
      out.push({ id: `room:${stored.id}`, name: stored.name, ...points, layout });
      onProgress?.(++done / total);
      await R.nextFrame();
    }
    return out;
  }

  /* Pictures for all rooms of a project (baked now if they are not yet): {roomId: {surfaceId: picture}}. */
  async function loadTextures(app, project, onProgress, isDead) {
    const out = {};
    const todo = project.rooms;
    for (let i = 0; i < todo.length; i++) {
      if (isDead && isDead()) return out;
      out[todo[i].id] = await R.roomTextures(app.store, todo[i], { onProgress: (p) => onProgress && onProgress((i + p) / todo.length) });
    }
    return out;
  }

  const viewerItems = (project, textures) => placedRooms(project).map(({ stored, room, layout }) => ({ id: stored.id, room, layout, textures: (textures && textures[stored.id]) || {} }));

  function busyBox(text) {
    const label = h("p", {}, text);
    const bar = h("div", { class: "progress" }, h("i", {}));
    const el = h("div", { class: "busy", role: "status" }, h("div", { class: "spinner" }), label, bar);
    el.set = (p, t) => { if (t) label.textContent = t; bar.firstChild.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`; };
    return el;
  }

  /* The 3D picture with its tools: turn or walk, points or surfaces, size and colour of the points, cut off the top, measure, take a picture.
     options: {items (rooms), clouds, surfaces: show the walls as surfaces at first}. */
  function makeStage(options) {
    const { items = [], clouds = [] } = options;
    const canvas = h("canvas", { class: "stage-canvas", "aria-label": "3D-Ansicht", tabindex: "0" });
    const layer = svgElement('<svg xmlns="http://www.w3.org/2000/svg" class="measure-layer" aria-hidden="true"></svg>');
    const el = h("div", { class: "stage" }, canvas, layer);
    let viewer;
    try { viewer = new window.RaumoGL.Viewer(canvas, { keys: true }); } catch (error) {
      put(el, h("div", { class: "empty" }, h("h3", {}, "3D geht hier nicht"), h("p", {}, "Dein Browser kann WebGL nicht benutzen. Den Grundriss und den Export gibt es trotzdem.")));
      return { element: el, viewer: null, destroy() {} };
    }
    viewer.setItems(items);
    viewer.setClouds(clouds);
    const hasPoints = clouds.some((c) => c.count), hasSurfaces = items.length > 0;
    viewer.showPoints = hasPoints;
    viewer.showSurfaces = hasSurfaces && (!hasPoints || !!options.surfaces);
    viewer.frame();

    // top: how to move
    const mode = segmented([["orbit", "Außen"], ["walk", "Rundgang"]], "orbit", (m) => { viewer.setMode(m); hint.hidden = m !== "walk"; if (m === "orbit") viewer.frame(); sliceBox.hidden = m !== "orbit"; }, "Ansicht");
    mode.classList.add("stage-mode");
    const hint = h("p", { class: "stage-hint", hidden: true }, "Ziehe zum Umsehen, tippe auf den Boden, um dorthin zu gehen.");

    // measuring
    const readout = h("div", { class: "stage-readout", hidden: true, role: "status" });
    const measure = { on: false, a: null, b: null };
    const draw = () => {
      layer.replaceChildren();
      const pts = [measure.a, measure.b].filter(Boolean).map((p) => ({ p, s: viewer.toScreen(p) }));
      const ns = "http://www.w3.org/2000/svg";
      const add = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); layer.append(n); return n; };
      if (pts.length === 2 && pts[0].s && pts[1].s) add("line", { x1: pts[0].s[0], y1: pts[0].s[1], x2: pts[1].s[0], y2: pts[1].s[1], class: "ml" });
      for (const { s } of pts) if (s) add("circle", { cx: s[0], cy: s[1], r: 6, class: "mp" });
    };
    viewer.on((type, v, detail) => {
      if (type === "render") draw();
      if (type !== "tap" || !measure.on) return;
      const p = viewer.pickPoint(detail.x, detail.y);
      if (!p) { readout.textContent = "Dort ist kein Punkt. Tippe auf eine Fläche mit Punkten."; return; }
      if (measure.a && !measure.b) {
        measure.b = p;
        const d = Math.hypot(p[0] - measure.a[0], p[1] - measure.a[1], p[2] - measure.a[2]);
        const flat = Math.hypot(p[0] - measure.a[0], p[2] - measure.a[2]);
        readout.textContent = `${metres(d)} (waagerecht ${metres(flat)}, Höhenunterschied ${metres(Math.abs(p[1] - measure.a[1]))})`;
      } else { measure.a = p; measure.b = null; readout.textContent = "Tippe auf den zweiten Punkt."; }
      viewer.invalidate();
    });
    const toggleMeasure = () => {
      measure.on = !measure.on; measure.a = measure.b = null; viewer.measuring = measure.on;
      readout.hidden = !measure.on;
      readout.textContent = "Tippe auf zwei Punkte, um ihren Abstand zu messen.";
      measureButton.setAttribute("aria-pressed", String(measure.on));
      viewer.invalidate();
    };

    // the panel with the settings
    const maxHeight = Math.max(2.5, viewer.extent().height);
    const sliceOut = h("output", {}, "aus");
    const slice = h("input", { type: "range", min: "0.4", max: String(maxHeight + 0.2), step: "0.05", value: String(maxHeight + 0.2), "aria-label": "Schnitthöhe", oninput: (e) => {
      const v = Number(e.target.value);
      viewer.clip = v > maxHeight + 0.05 ? 100 : v;
      sliceOut.textContent = v > maxHeight + 0.05 ? "aus" : metres(v);
      viewer.invalidate();
    } });
    const sliceBox = h("label", { class: "stage-row" }, h("span", {}, "Schnitt von oben"), slice, sliceOut);
    const sizeOut = h("output", {}, `${Math.round(viewer.pointSize * 100)} cm`);
    const size = h("input", { type: "range", min: "0.02", max: "0.15", step: "0.005", value: String(viewer.pointSize), "aria-label": "Punktgröße", oninput: (e) => { viewer.pointSize = Number(e.target.value); sizeOut.textContent = `${Math.round(viewer.pointSize * 100)} cm`; viewer.invalidate(); } });
    const rows = [];
    if (hasPoints && hasSurfaces) {
      rows.push(h("div", { class: "stage-row" }, h("span", {}, "Zeigen"), segmented([["points", "Punkte"], ["surfaces", "Flächen"], ["both", "Beides"]], viewer.showSurfaces && viewer.showPoints ? "both" : viewer.showSurfaces ? "surfaces" : "points", (v) => { viewer.showPoints = v !== "surfaces"; viewer.showSurfaces = v !== "points"; viewer.invalidate(); }, "Was gezeigt wird")));
    }
    if (hasPoints) {
      rows.push(h("label", { class: "stage-row" }, h("span", {}, "Punktgröße"), size, sizeOut));
      rows.push(h("div", { class: "stage-row" }, h("span", {}, "Farbe"), segmented([["0", "Gescannt"], ["1", "Höhe"]], "0", (v) => { viewer.colorMode = Number(v); viewer.invalidate(); }, "Farbe der Punkte")));
    }
    rows.push(sliceBox);
    const panel = h("div", { class: "stage-panel", hidden: true }, rows);

    const measureButton = h("button", { class: "icon-btn glass", type: "button", "aria-label": "Abstand messen", "aria-pressed": "false", onclick: toggleMeasure }, icon("ruler"));
    const reset = h("button", { class: "icon-btn glass", type: "button", "aria-label": "Ansicht zurücksetzen", onclick: () => { viewer.setMode("orbit"); mode.set("orbit"); hint.hidden = true; sliceBox.hidden = false; viewer.orbit.yaw = 35; viewer.orbit.pitch = 38; viewer.frame(); } }, icon("rotate"));
    const shot = h("button", { class: "icon-btn glass", type: "button", "aria-label": "Bild speichern", onclick: async () => { const blob = await viewer.snapshot(1600, "image/jpeg", 0.9); saveFile("raumo-ansicht.jpg", blob); } }, icon("download"));
    const settings = h("button", { class: "icon-btn glass", type: "button", "aria-label": "Darstellung einstellen", "aria-expanded": "false", onclick: (e) => { panel.hidden = !panel.hidden; e.currentTarget.setAttribute("aria-expanded", String(!panel.hidden)); } }, icon("palette"));
    put(el, mode, h("div", { class: "stage-tools" }, settings, measureButton, reset, shot), hint, readout, panel);
    if (hasPoints) put(el, h("p", { class: "stage-count" }, `${count(clouds.reduce((s, c) => s + c.count, 0))} Punkte`));
    return { element: el, viewer, destroy() { viewer.destroy(); } };
  }

  // ------------------------------------------------------------------------------------------ project
  R.projectView = async function projectView(app, id, tab) {
    const project = await app.store.getProject(id);
    const view = { dead: false, element: h("div", { class: "screen project" }), destroy() { view.dead = true; for (const f of view.cleanup) f(); }, cleanup: [] };
    if (!project) { fill(view.element, app.notFound("Dieses Gebäude gibt es nicht (mehr).")); return view; }
    const ctx = { app, project, textures: null, selected: project.rooms[0] ? project.rooms[0].id : null, view };
    const content = h("div", { class: "tab-content" });
    const shown = TABS.filter(([key]) => key !== "plan" || project.rooms.length);
    const tabButtons = shown.map(([key, label, ic]) => h("button", { class: "tab", type: "button", role: "tab", "data-tab": key, onclick: () => app.go(`/p/${project.id}?t=${key}`) }, icon(ic), h("span", {}, label)));
    const title = h("h1", { class: "title" }, project.name);
    const rename = async () => {
      const name = await promptBox({ title: "Gebäude umbenennen", value: project.name, yes: "Speichern" });
      if (name) { project.name = Store.cleanName(name, project.name); await app.store.saveProject(project); title.textContent = project.name; }
    };
    const more = h("button", { class: "icon-btn", type: "button", "aria-label": "Mehr", onclick: (e) => menu(e.currentTarget, [
      { label: "Umbenennen", icon: "edit", run: rename },
      { label: "Sicherung speichern", icon: "download", run: () => app.saveBackup(project) },
      { label: "Gebäude löschen", icon: "trash", danger: true, run: () => app.deleteProject(project) },
    ]) }, icon("more"));
    put(view.element,
      h("header", { class: "bar" }, h("button", { class: "icon-btn", type: "button", "aria-label": "Zurück zur Übersicht", onclick: () => app.go("/") }, icon("back")), h("button", { class: "title-button", type: "button", onclick: rename }, title), more),
      content, h("nav", { class: "tabs", role: "tablist", "aria-label": "Ansicht" }, tabButtons));
    const active = shown.some(([k]) => k === tab) ? tab : isEmpty(project) ? "scans" : "3d";
    tabButtons.forEach((b) => { b.setAttribute("aria-selected", String(b.dataset.tab === active)); b.classList.toggle("on", b.dataset.tab === active); });
    const builders = { "3d": tab3d, plan: tabPlan, scans: tabScans, export: tabExport };
    const built = await builders[active](ctx);
    if (view.dead) { built.destroy?.(); return view; }
    content.append(built.element);
    view.cleanup.push(() => built.destroy?.());
    return view;
  };

  // -------------------------------------------------------------------------------------------- 3D tab
  async function tab3d(ctx) {
    const { app, project, view } = ctx;
    const box = h("div", { class: "tab-3d" });
    if (isEmpty(project)) return { element: put(box, app.emptyScans(project)) };
    const busy = busyBox("Punkte werden geladen …");
    put(box, busy);
    let stage = null;
    (async () => {
      const textures = project.rooms.length ? await loadTextures(app, project, (p) => busy.set(p * 0.5, "Bilder werden berechnet …"), () => view.dead) : {};
      if (view.dead) return;
      ctx.textures = textures;
      const clouds = await loadClouds(app, project, textures, (p) => busy.set(0.5 + p * 0.5, "Punkte werden geladen …"), () => view.dead);
      if (view.dead) return;
      stage = makeStage({ items: viewerItems(project, textures), clouds });
      busy.remove();
      box.prepend(stage.element);
      put(box, scanChips(ctx, stage, clouds));
      if (stage.viewer && !project.thumb) app.saveThumb(project, stage.viewer);
    })().catch((error) => { console.error(error); busy.remove(); put(box, h("div", { class: "empty" }, h("h3", {}, "Das Modell konnte nicht aufgebaut werden"), h("p", {}, "Versuche es noch einmal oder öffne einen einzelnen Scan."))); });
    return { element: box, destroy() { stage && stage.destroy(); } };
  }

  /* A row of buttons to look at one scan out of several. */
  function scanChips(ctx, stage, clouds) {
    const { project } = ctx;
    const names = [...project.rooms.map((r) => [r.id, r.name]), ...cloudMetas(project).map((c) => [c.id, c.name])];
    if (!stage.viewer || names.length < 2) return h("span", { hidden: true });
    const bar = segmented([["", "Alle"], ...names], "", (id) => {
      if (!id) { stage.viewer.frame(); return; }
      const item = stage.viewer.items.find((i) => i.id === id);
      const cloud = clouds.find((c) => c.id === id);
      let target;
      if (item) { const c = Core.placePoint(item.layout, Core.centroid(item.room.polygon)); target = [c[0], item.room.height * 0.35, c[1], Math.max(4, Core.bounds(item.room.polygon).width * 1.6)]; }
      else if (cloud) {
        const entry = stage.viewer.clouds.find((c) => c.id === id);
        const b = stage.viewer.cloudBounds(entry);
        if (b) target = [(b.minX + b.maxX) / 2, b.maxY * 0.35, (b.minZ + b.maxZ) / 2, Math.max(4, Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 1.2)];
      }
      if (!target) return;
      stage.viewer.orbit.target = target.slice(0, 3);
      stage.viewer.orbit.distance = target[3];
      stage.viewer.invalidate();
    }, "Scan anschauen");
    bar.classList.add("room-chips");
    return bar;
  }

  // ------------------------------------------------------------------------------------------- plan tab
  function tabPlan(ctx) {
    const { app, project } = ctx;
    const box = h("div", { class: "tab-plan" });
    if (!project.rooms.length) return { element: put(box, app.emptyScans(project)) };
    const state = { dimensions: true, names: true, selected: ctx.selected, cx: 0, cz: 0, scale: 0, fitted: false };
    const host = h("div", { class: "plan-host", tabindex: "0", "aria-label": "Grundriss. Ziehe die Räume, um sie zu verschieben." });
    const label = h("span", { class: "plan-label" });
    const buttons = {
      left: h("button", { class: "icon-btn", type: "button", "aria-label": "90 Grad nach links drehen", onclick: () => turn(-90) }, icon("rotate")),
      right: h("button", { class: "icon-btn flip", type: "button", "aria-label": "90 Grad nach rechts drehen", onclick: () => turn(90) }, icon("rotate")),
      fineL: h("button", { class: "btn ghost small", type: "button", "aria-label": "5 Grad nach links", onclick: () => turn(-5) }, "−5°"),
      fineR: h("button", { class: "btn ghost small", type: "button", "aria-label": "5 Grad nach rechts", onclick: () => turn(5) }, "+5°"),
      join: h("button", { class: "btn ghost small", type: "button", onclick: () => joinDialog() }, icon("link"), h("span", {}, "Türen verbinden")),
      dims: h("button", { class: "btn ghost small", type: "button", "aria-pressed": "true", onclick: (e) => { state.dimensions = !state.dimensions; e.currentTarget.setAttribute("aria-pressed", String(state.dimensions)); render(); } }, "Maße"),
    };
    put(box, host, h("div", { class: "plan-tools" }, label, buttons.left, buttons.right, buttons.fineL, buttons.fineR, buttons.dims, buttons.join));

    const entries = () => placedRooms(project).map(({ stored, room, layout }) => ({ id: stored.id, name: stored.name, room, layout, selected: stored.id === state.selected }));
    const bounds = () => Core.bounds(entries().map((e) => Core.offsetPolygon(e.room.polygon, e.room.thickness).map((p) => Core.placePoint(e.layout, p))).flat());
    function fit() {
      const b = bounds();
      const w = host.clientWidth || 600, hgt = host.clientHeight || 400;
      state.scale = Math.min(w / (b.width + 2), hgt / (b.depth + 2));
      state.cx = (b.minX + b.maxX) / 2; state.cz = (b.minZ + b.maxZ) / 2;
      state.fitted = true;
    }
    function render() {
      if (ctx.view.dead) return;
      if (!state.fitted) fit();
      const svg = svgElement(Export.planSVG(entries(), { theme: "dark", dimensions: state.dimensions, names: state.names, title: project.name }));
      const w = host.clientWidth || 600, hgt = host.clientHeight || 400;
      svg.setAttribute("viewBox", `${state.cx - w / state.scale / 2} ${state.cz - hgt / state.scale / 2} ${w / state.scale} ${hgt / state.scale}`);
      svg.removeAttribute("width"); svg.removeAttribute("height");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svg.querySelector("rect")?.remove();
      host.replaceChildren(svg);
      const sel = project.rooms.find((r) => r.id === state.selected);
      label.textContent = sel ? sel.name : "Tippe einen Raum an";
      for (const b of [buttons.left, buttons.right, buttons.fineL, buttons.fineR]) b.disabled = !sel;
      buttons.join.disabled = !(project.rooms.length > 1 && project.rooms.some((r) => r.openings.length));
    }

    const toWorld = (event) => {
      const svg = host.firstElementChild;
      const point = svg.createSVGPoint();
      point.x = event.clientX; point.y = event.clientY;
      const p = point.matrixTransform(svg.getScreenCTM().inverse());
      return [p.x, p.y];
    };
    const roomAt = (p) => {
      for (const e of entries().reverse()) {
        const outer = Core.offsetPolygon(e.room.polygon, e.room.thickness).map((q) => Core.placePoint(e.layout, q));
        if (Core.pointInPolygon(p, outer)) return e.id;
      }
      return null;
    };
    let drag = null, scheduled = false;
    const later = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; render(); }); setTimeout(() => { if (scheduled) { scheduled = false; render(); } }, 60); };
    const pointers = new Map();
    const pinchDistance = () => { const pts = [...pointers.values()]; return Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]); };
    host.addEventListener("pointerdown", (e) => {
      host.setPointerCapture?.(e.pointerId);
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pointers.size > 1) { drag = { type: "pinch", d: pinchDistance() }; return; }
      const p = toWorld(e);
      const id = roomAt(p);
      if (id) {
        state.selected = id; ctx.selected = id;
        const layout = project.layouts[id];
        drag = { type: "room", id, start: p, origin: { x: layout.x, z: layout.z }, moved: false };
      } else drag = { type: "pan", x: e.clientX, y: e.clientY };
      later();
    });
    host.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (!drag) return;
      if (drag.type === "pinch" && pointers.size > 1) { const d = pinchDistance(); state.scale = Core.clamp(state.scale * d / drag.d, 8, 400); drag.d = d; later(); return; }
      if (drag.type === "room") {
        const p = toWorld(e);
        const layout = project.layouts[drag.id];
        let x = drag.origin.x + p[0] - drag.start[0], z = drag.origin.z + p[1] - drag.start[1];
        x = Math.round(x * 20) / 20; z = Math.round(z * 20) / 20;
        if (x !== layout.x || z !== layout.z) { layout.x = x; layout.z = z; drag.moved = true; later(); }
      } else if (drag.type === "pan") {
        state.cx -= (e.clientX - drag.x) / state.scale; state.cz -= (e.clientY - drag.y) / state.scale;
        drag.x = e.clientX; drag.y = e.clientY; later();
      }
    });
    const end = async (e) => {
      pointers.delete(e.pointerId);
      if (drag && drag.type === "room" && drag.moved && pointers.size === 0) { project.thumb = null; await app.store.saveProject(project); }
      if (!pointers.size) drag = null;
    };
    host.addEventListener("pointerup", end);
    host.addEventListener("pointercancel", end);
    host.addEventListener("wheel", (e) => { e.preventDefault(); state.scale = Core.clamp(state.scale * Math.exp(-e.deltaY * 0.0015), 8, 400); later(); }, { passive: false });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => { if (host.clientWidth) later(); }) : null;
    observer?.observe(host);

    async function turn(degrees) {
      const layout = project.layouts[state.selected];
      const stored = project.rooms.find((r) => r.id === state.selected);
      if (!layout || !stored) return;
      const room = Store.roomOf(stored);                              // turn about the middle of the room, so that it stays where it is
      const c = Core.placePoint(layout, Core.centroid(room.polygon));
      layout.rot = (((layout.rot + degrees) % 360) + 360) % 360;
      const c2 = Core.placePoint(layout, Core.centroid(room.polygon));
      layout.x += c[0] - c2[0]; layout.z += c[1] - c2[1];
      project.thumb = null;
      await app.store.saveProject(project);
      render();
    }

    function joinDialog() {
      const options = [];
      for (const stored of project.rooms) stored.openings.forEach((o, i) => options.push({ roomId: stored.id, index: i, text: `${stored.name} · ${KIND[o.kind] || "Öffnung"} an Wand ${o.wall + 1} (${metres(o.u1 - o.u0)} breit)` }));
      const pick = () => h("select", { class: "field" }, options.map((o, i) => h("option", { value: String(i) }, o.text)));
      const a = pick(), b = pick();
      a.value = String(Math.max(0, options.findIndex((o) => o.roomId === state.selected)));
      b.value = String(Math.max(0, options.findIndex((o) => o.roomId !== options[Number(a.value)].roomId)));
      const error = h("p", { class: "form-error", role: "alert", hidden: true });
      dialog({ title: "Räume an der Tür verbinden", body: h("div", {},
        h("p", { class: "muted" }, "Wähle die Tür oder den Durchgang, die zwei Räume gemeinsam haben. Der zweite Raum wird so gedreht und verschoben, dass beide Öffnungen aufeinanderliegen."),
        h("label", { class: "field-label" }, h("span", {}, "Dieser Raum bleibt stehen"), a), h("label", { class: "field-label" }, h("span", {}, "Dieser Raum wird verschoben"), b), error),
        actions: [{ label: "Verbinden", kind: "primary", run: async () => {
          const oa = options[Number(a.value)], ob = options[Number(b.value)];
          if (oa.roomId === ob.roomId) { error.textContent = "Wähle zwei verschiedene Räume."; error.hidden = false; return false; }
          const ra = project.rooms.find((r) => r.id === oa.roomId), rb = project.rooms.find((r) => r.id === ob.roomId);
          const roomA = Store.roomOf(ra), roomB = Store.roomOf(rb);
          project.layouts[rb.id] = Core.alignByOpenings(roomA, project.layouts[ra.id], roomA.openings[oa.index], roomB, roomB.openings[ob.index]);
          state.selected = rb.id; ctx.selected = rb.id;
          project.thumb = null;
          await app.store.saveProject(project);
          state.fitted = false;
          render();
          return true;
        } }] });
    }

    requestAnimationFrame(() => render());
    setTimeout(() => { if (!host.firstElementChild) render(); }, 80);
    return { element: box, destroy() { observer?.disconnect(); } };
  }

  // ----------------------------------------------------------------------------------------- scans tab
  function tabScans(ctx) {
    const { app, project } = ctx;
    const t = totals(project);
    const box = h("div", { class: "tab-rooms scroll" });
    put(box, h("div", { class: "summary" }, h("b", {}, `${t.clouds + t.rooms} ${t.clouds + t.rooms === 1 ? "Scan" : "Scans"}`), h("span", {}, [t.points ? `${count(t.points)} Punkte` : null, t.rooms ? `${area(t.area)} gemessen` : null].filter(Boolean).join(" · "))));
    if (isEmpty(project)) put(box, app.emptyScans(project));
    const list = h("ul", { class: "room-list" });

    for (const meta of cloudMetas(project)) {
      const size = meta.bounds ? [meta.bounds.max[0] - meta.bounds.min[0], meta.bounds.max[1] - meta.bounds.min[1], meta.bounds.max[2] - meta.bounds.min[2]] : [0, 0, 0];
      const sourceText = { walk: "Durchgelaufen", import: "Datei", demo: "Beispiel", room: "Raum" }[meta.source] || "Scan";
      list.append(h("li", { class: "room-card" },
        h("div", { class: "room-open static" }, h("span", { class: "room-thumb cloud" }, icon("points")),
          h("span", { class: "room-text" }, h("b", {}, meta.name), h("small", {}, `${count(meta.count || 0)} Punkte · ${num(size[0], 1)} × ${num(size[2], 1)} m, ${num(size[1], 1)} m hoch`), h("small", { class: "muted" }, sourceText))),
        h("button", { class: "icon-btn", type: "button", "aria-label": `Mehr zu ${meta.name}`, onclick: (e) => menu(e.currentTarget, [
          { label: "Umbenennen", icon: "edit", run: async () => { const name = await promptBox({ title: "Scan umbenennen", value: meta.name, yes: "Speichern" }); if (name) { meta.name = Store.cleanName(name, meta.name); await app.store.saveProject(project); app.go(`/p/${project.id}?t=scans`, true); } } },
          { label: "Drehen und verschieben …", icon: "rotate", run: () => app.moveCloud(project, meta) },
          { label: "Löschen", icon: "trash", danger: true, run: () => app.deleteCloud(project, meta) },
        ]) }, icon("more"))));
    }

    for (const { stored, room } of placedRooms(project)) {
      const s = Core.roomStats(room);
      const thumb = svgElement(Export.planSVG([{ name: stored.name, room, layout: { x: 0, z: 0, rot: 0 } }], { theme: "dark", dimensions: false, names: false }));
      thumb.removeAttribute("width"); thumb.removeAttribute("height"); thumb.querySelector("rect")?.remove();
      list.append(h("li", { class: "room-card" },
        h("button", { class: "room-open", type: "button", onclick: () => app.go(`/p/${project.id}/r/${stored.id}`) },
          h("span", { class: "room-thumb" }, thumb), h("span", { class: "room-text" }, h("b", {}, stored.name), h("small", {}, `${area(s.area)} · ${metres(s.height)} hoch · ${s.doors} ${s.doors === 1 ? "Tür" : "Türen"}, ${s.windows} Fenster`),
            h("small", { class: "muted" }, stored.photoCount ? `Raum im Stehen gemessen · ${stored.photoCount} Fotos` : stored.source === "manual" ? "Maße eingegeben" : stored.source === "demo" ? "Beispiel" : "Raum im Stehen gemessen"))),
        h("button", { class: "icon-btn", type: "button", "aria-label": `Mehr zu ${stored.name}`, onclick: (e) => menu(e.currentTarget, [
          { label: "Öffnen und bearbeiten", icon: "cube", run: () => app.go(`/p/${project.id}/r/${stored.id}`) },
          { label: "Umbenennen", icon: "edit", run: async () => { const name = await promptBox({ title: "Raum umbenennen", value: stored.name, yes: "Speichern" }); if (name) { stored.name = Store.cleanName(name, stored.name); await app.store.saveProject(project); app.go(`/p/${project.id}?t=scans`, true); } } },
          { label: "Raum löschen", icon: "trash", danger: true, run: () => app.deleteRoom(project, stored) },
        ]) }, icon("more"))));
    }
    put(box, list, h("div", { class: "add-room" }, h("button", { class: "btn primary", type: "button", onclick: () => app.newRoom(project.id) }, icon("plus"), h("span", {}, "Scan hinzufügen"))));
    return { element: box };
  }

  // ------------------------------------------------------------------------------------------ export tab
  /* The rooms of a project for export: with the baked pictures (as JPEG bytes) when `textures` is asked for. */
  async function sceneFor(app, project, { textures = true, progress } = {}) {
    const scene = [];
    const list = placedRooms(project);
    for (let i = 0; i < list.length; i++) {
      const { stored, room, layout } = list[i];
      const entry = { id: stored.id, name: stored.name, room, layout, textures: {} };
      if (textures) {
        await R.roomTextures(app.store, stored, { onProgress: (p) => progress && progress((i + p) / list.length) });
        for (const id of Core.buildRoomSurfaces(room).map((s) => s.id)) {
          const found = await app.store.getTexture(stored.id, id);
          if (found) entry.textures[id] = { mime: "image/jpeg", bytes: await Store.bytesOf(found.blob) };
        }
      }
      scene.push(entry);
      progress && progress((i + 1) / list.length);
    }
    return scene;
  }

  /* All points of a project as one cloud in building coordinates: the stored clouds and the points of the measured rooms. */
  async function allPoints(app, project, progress) {
    const textures = project.rooms.length ? await loadTextures(app, project, (p) => progress && progress(p * 0.5)) : {};
    const clouds = await loadClouds(app, project, textures, (p) => progress && progress(0.5 + p * 0.5));
    return Cloud.mergeClouds(clouds, clouds.map((c) => c.layout));
  }

  async function svgToPng(svgText, width) {
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = Math.round(width * (img.naturalHeight || 1) / (img.naturalWidth || 1));
      const g = canvas.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally { URL.revokeObjectURL(url); }
  }

  function tabExport(ctx) {
    const { app, project } = ctx;
    const box = h("div", { class: "tab-export scroll" });
    if (isEmpty(project)) return { element: put(box, app.emptyScans(project)) };
    const name = Export.safe(project.name);
    const options = { textures: true, outer: true };
    const run = (task) => async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      const busy = busyBox("Wird vorbereitet …");
      busy.classList.add("overlay");
      document.body.append(busy);
      try { await task((p, t) => busy.set(p, t)); } catch (error) { console.error(error); toast(error.message || "Das hat nicht geklappt."); } finally { busy.remove(); button.disabled = false; }
    };
    const item = (title, text, ic, task) => h("li", { class: "export-item" }, h("span", { class: "ei-ic" }, icon(ic)), h("span", { class: "ei-text" }, h("b", {}, title), h("small", {}, text)), h("button", { class: "btn ghost small", type: "button", onclick: run(task) }, "Laden"));
    const check = (key, label, text) => {
      const input = h("input", { type: "checkbox", onchange: (e) => { options[key] = e.target.checked; } });
      input.checked = options[key];
      return h("label", { class: "check" }, input, h("span", {}, h("b", {}, label), h("small", {}, text)));
    };
    const pointItems = [
      item("Punktwolke (PLY)", "Alle Punkte mit Farben. Öffnet in CloudCompare, MeshLab, Blender.", "points", async (p) => { const cloud = await allPoints(app, project, (v) => p(v * 0.9, "Punkte werden gesammelt …")); const bytes = Cloud.toPLY(cloud); saveFile(`${name}.ply`, bytes, "application/octet-stream"); toast(`${name}.ply · ${count(cloud.count)} Punkte · ${sizeText(bytes.length)}`); }),
      item("Punktwolke (LAS)", "Das übliche Austauschformat für Vermessung und Laserscanner (z. B. für ReCap, Potree, QGIS).", "points", async (p) => { const cloud = await allPoints(app, project, (v) => p(v * 0.9, "Punkte werden gesammelt …")); const bytes = Cloud.toLAS(cloud); saveFile(`${name}.las`, bytes, "application/octet-stream"); toast(`${name}.las · ${sizeText(bytes.length)}`); }),
      item("Punktwolke (XYZ-Text)", "Eine Zeile je Punkt: x y z r g b. Für Skripte und Tabellen.", "points", async (p) => { const cloud = await allPoints(app, project, (v) => p(v * 0.9, "Punkte werden gesammelt …")); const bytes = Cloud.toXYZ(cloud); saveFile(`${name}.xyz`, bytes, "text/plain"); toast(`${name}.xyz · ${sizeText(bytes.length)}`); }),
    ];
    const roomItems = project.rooms.length ? [
      item("3D-Modell (GLB)", "Wände, Boden und Decke der gemessenen Räume als Flächen mit Fotos. Öffnet in Windows 3D-Viewer, Blender, Apple Vorschau.", "cube", async (p) => {
        const scene = await sceneFor(app, project, { textures: options.textures, progress: (v) => p(v * 0.8, "Bilder werden berechnet …") });
        p(0.9, "Datei wird gebaut …");
        const bytes = Export.toGLB(scene, { outer: options.outer });
        saveFile(`${name}.glb`, bytes, "model/gltf-binary");
        toast(`${name}.glb · ${sizeText(bytes.length)}`);
      }),
      item("3D-Modell (OBJ in ZIP)", "Für Programme, die kein GLB lesen. Mit Material und Bildern.", "layers", async (p) => {
        const scene = await sceneFor(app, project, { textures: options.textures, progress: (v) => p(v * 0.8, "Bilder werden berechnet …") });
        const bytes = Export.toOBJZip(scene, { outer: options.outer });
        saveFile(`${name}-obj.zip`, bytes, "application/zip");
        toast(`${name}-obj.zip · ${sizeText(bytes.length)}`);
      }),
      item("Grundriss (SVG)", "Zeichnung mit Wandstärken, Türen, Fenstern und Maßen. Skalierbar, für CAD und Druck.", "plan", async () => {
        const svg = Export.planSVG(placedRooms(project).map(({ stored, room, layout }) => ({ name: stored.name, room, layout })), { title: project.name });
        saveFile(`${name}-grundriss.svg`, svg, "image/svg+xml");
      }),
      item("Grundriss (PNG)", "Als Bild mit weißem Hintergrund, zum Einfügen in Dokumente.", "download", async () => {
        const svg = Export.planSVG(placedRooms(project).map(({ stored, room, layout }) => ({ name: stored.name, room, layout })), { title: project.name });
        saveFile(`${name}-grundriss.png`, await svgToPng(svg, 2400), "image/png");
      }),
    ] : [];
    put(box,
      h("p", { class: "lead" }, "Nimm deine Scans mit: in andere Programme oder zum Teilen. Alles wird auf deinem Gerät erzeugt."),
      project.rooms.length ? h("div", { class: "options" }, check("textures", "Mit Fotos", "Die Wände des Modells bekommen die Bilder vom Scan."), check("outer", "Außenwände", "Das Modell wird geschlossen (mit Außenseite), sonst sind die Wände von außen durchsichtig.")) : null,
      h("h2", { class: "section-title small" }, "Punktwolke"), h("ul", { class: "export-list" }, pointItems),
      roomItems.length ? h("h2", { class: "section-title small" }, "Modell und Grundriss") : null, roomItems.length ? h("ul", { class: "export-list" }, roomItems) : null,
      h("h2", { class: "section-title small" }, "Sicherung"),
      h("ul", { class: "export-list" }, item("Sicherung (.raumo)", "Das ganze Gebäude mit allen Scans, um es später oder auf einem anderen Gerät wieder zu laden.", "upload", async () => { await app.saveBackup(project); })));
    return { element: box };
  }

  // -------------------------------------------------------------------------------------------- room view
  R.roomView = async function roomView(app, projectId, roomId, params) {
    const project = await app.store.getProject(projectId);
    const view = { dead: false, element: h("div", { class: "screen roomscreen" }), cleanup: [], destroy() { view.dead = true; for (const f of view.cleanup) f(); } };
    const stored = project && project.rooms.find((r) => r.id === roomId);
    if (!stored) { fill(view.element, app.notFound("Diesen Raum gibt es nicht (mehr).")); return view; }
    const room = Store.roomOf(stored);
    const stats = Core.roomStats(room);
    const content = h("div", { class: "room-body scroll" });
    const stageHost = h("div", { class: "room-stage" });
    const title = h("h1", { class: "title" }, stored.name);
    const rename = async () => { const name = await promptBox({ title: "Raum umbenennen", value: stored.name, yes: "Speichern" }); if (name) { stored.name = Store.cleanName(name, stored.name); await app.store.saveProject(project); title.textContent = stored.name; } };
    put(view.element,
      h("header", { class: "bar" }, h("button", { class: "icon-btn", type: "button", "aria-label": "Zurück zum Gebäude", onclick: () => app.go(`/p/${project.id}?t=scans`) }, icon("back")), h("button", { class: "title-button", type: "button", onclick: rename }, title),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Mehr", onclick: (e) => menu(e.currentTarget, [
          { label: "Umbenennen", icon: "edit", run: rename },
          { label: "Raum löschen", icon: "trash", danger: true, run: () => app.deleteRoom(project, stored) },
        ]) }, icon("more"))),
      stageHost, content);

    const reload = () => app.go(`/p/${project.id}/r/${stored.id}`, true);
    const save = async (next, extra = {}) => {
      Object.assign(stored, Store.withRoom(stored, next, extra));
      await app.store.saveProject(project);
      await app.store.clearTextures(stored.id);
      project.thumb = null;
      reload();
    };

    const busy = busyBox("Bilder werden berechnet …");
    stageHost.append(busy);
    (async () => {
      const textures = await R.roomTextures(app.store, stored, { onProgress: (p) => busy.set(p) });
      if (view.dead) return;
      const points = roomCloud(stored, room, textures);
      const stage = makeStage({ items: [{ id: stored.id, room, layout: { x: 0, z: 0, rot: 0 }, textures }], clouds: [{ id: stored.id, name: stored.name, ...points, layout: { x: 0, z: 0, rot: 0 } }], surfaces: true });
      busy.remove();
      stageHost.prepend(stage.element);
      view.cleanup.push(() => stage.destroy());
      if (stage.viewer) { stage.viewer.showPoints = false; stage.viewer.showSurfaces = true; stage.viewer.invalidate(); }
    })().catch((error) => { console.error(error); busy.remove(); });

    const grid = h("dl", { class: "facts" },
      ...[["Fläche", area(stats.area)], ["Höhe", metres(stats.height)], ["Umfang", metres(stats.perimeter)], ["Volumen", `${num(stats.volume, 1)} m³`], ["Wandfläche", area(stats.wallArea)], ["Öffnungen", String(stats.openings)]].flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
    const walls = Core.wallsOf(room.polygon);
    const wallList = h("ul", { class: "wall-list" }, walls.map((w) => h("li", {}, h("span", {}, `Wand ${w.index + 1}`), h("b", {}, metres(w.len)),
      h("button", { class: "btn ghost small", type: "button", onclick: () => app.correctScale(project, stored, w.index, save) }, icon("ruler"), h("span", {}, "Nachmessen")))));

    const note = params.get("new") ? h("div", { class: "notice good" }, h("b", {}, "Scan gespeichert."), h("span", {}, stored.photoCount ? ` ${stored.photoCount} Fotos sind auf den Wänden. ` : " "), "Miss eine Wand mit dem Zollstock nach und tippe bei ihr auf „Nachmessen“: Dann stimmen alle Maße.") : null;
    const openingsList = h("ul", { class: "opening-edit" }, room.openings.map((o, i) => h("li", {},
      h("span", { class: "oe-ic" }, icon(o.kind === "window" ? "window" : "door")),
      h("span", { class: "oe-text" }, h("b", {}, KIND[o.kind] || "Öffnung"), h("small", {}, `Wand ${o.wall + 1} · ${metres(o.u1 - o.u0)} breit, ${metres(o.v1 - o.v0)} hoch${o.v0 > 0.01 ? `, Brüstung ${metres(o.v0)}` : ""}`)),
      h("button", { class: "icon-btn small", type: "button", "aria-label": "Bearbeiten", onclick: async () => { const next = await R.editOpening(room, i); if (next) await save(next); } }, icon("edit")),
      h("button", { class: "icon-btn small", type: "button", "aria-label": "Entfernen", onclick: async () => { const rest = room.openings.filter((_, k) => k !== i); await save(Core.makeRoom({ ...room, openings: rest })); } }, icon("trash")))));

    const fovValue = h("output", {}, `${Math.round(stored.fov)}°`);
    const fov = h("input", { type: "range", min: "50", max: "95", step: "1", value: String(stored.fov), "aria-label": "Bildwinkel der Kamera", oninput: (e) => { fovValue.textContent = `${e.target.value}°`; } });
    const photosBox = stored.photoCount
      ? h("div", { class: "card" }, h("h2", {}, "Bilder auf den Wänden"), h("p", { class: "muted small" }, `${stored.photoCount} Fotos wurden beim Scan gemacht. Wenn die Bilder an den Ecken nicht zusammenpassen, stimmt der Bildwinkel der Kamera nicht ganz. Verändere ihn, bis die Kanten passen.`),
          h("label", { class: "field-label" }, h("span", {}, "Bildwinkel der Kamera"), h("div", { class: "slider-row" }, fov, fovValue)),
          h("button", { class: "btn ghost small", type: "button", onclick: async () => { stored.fov = Number(fov.value); stored.updated = Date.now(); await app.store.saveProject(project); await app.store.clearTextures(stored.id); reload(); } }, "Bilder neu berechnen"))
      : null;

    put(content, note,
      h("div", { class: "card" }, h("h2", {}, "Maße"), grid),
      h("div", { class: "card" }, h("h2", {}, "Wände"), wallList, h("p", { class: "muted small" }, "Tippe auf „Nachmessen“ und gib die echte Länge einer Wand ein, die du mit einem Zollstock oder Laser gemessen hast. Alle Maße werden dann darauf angepasst."),
        h("div", { class: "button-row" },
          h("button", { class: "btn ghost small", type: "button", onclick: async () => { const next = await R.editPlan(room); if (next) await save(next); } }, icon("plan"), h("span", {}, "Grundriss bearbeiten")),
          h("button", { class: "btn ghost small", type: "button", onclick: async () => {
            const { polygon, snapped } = Core.orthogonalize(room.polygon, 12);
            if (!snapped) { toast("Keine Wand ist annähernd rechtwinklig."); return; }
            await save(Core.reshapeRoom(room, polygon));
            toast(`${snapped} von ${walls.length} Wänden wurden gerade gezogen.`);
          } }, h("span", {}, "Rechte Winkel")),
          h("button", { class: "btn ghost small", type: "button", onclick: async () => { const v = await promptBox({ title: "Raumhöhe", label: "Höhe", value: String(num(room.height)).replace(".", ","), type: "number", unit: "m", min: 1.8, max: 10, yes: "Speichern" }); if (v) await save(Core.makeRoom({ ...room, height: v })); } }, h("span", {}, "Höhe ändern")))),
      h("div", { class: "card" }, h("h2", {}, "Türen und Fenster"), room.openings.length ? openingsList : h("p", { class: "muted" }, "Noch keine eingetragen."),
        h("button", { class: "btn ghost small", type: "button", onclick: async () => { const next = await R.editOpening(room, -1); if (next) await save(next); } }, icon("plus"), h("span", {}, "Hinzufügen"))),
      photosBox);
    return view;
  };

  Object.assign(R, { placedRooms, totals, sceneFor, allPoints, svgToPng, sizeText, busyBox, loadClouds, pictureData });
})();
