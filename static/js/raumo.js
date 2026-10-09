/* raumo: the app -- opens the store, shows the screen for the address (#/ the buildings, #/p/ID a building, #/p/ID/r/ID a measured room,
   #/hilfe), and does the things the buttons ask for: start a scan, open a point cloud, keep a backup, delete. */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const Cloud = window.RaumoCloud;
  const Store = window.RaumoStore;
  const R = (window.Raumo = window.Raumo || {});
  const { h, put, fill, icon, toast, dialog, confirmBox, promptBox, segmented, num, metres, saveFile } = R;

  const app = { store: null };
  let current = null;
  const root = () => document.getElementById("app");

  // ---------------------------------------------------------------------------------------------- practice room
  /* The practice room with everything the scans of it need: the room, its pictures as pixels, furniture, things behind the openings. */
  let demoCache = null;
  function demoPackage() {
    if (demoCache) return demoCache;
    const demo = window.RaumoDemo.rooms()[0];
    const textures = window.RaumoDemo.textures(demo.room, document);
    const pictures = {};
    for (const [id, canvas] of Object.entries(textures)) pictures[id] = R.pictureData(canvas);
    demoCache = { name: demo.name, room: demo.room, textures, pictures, boxes: window.RaumoSim.furniture(demo.room), props: window.RaumoDemo.props(demo.room) };
    return demoCache;
  }

  // ------------------------------------------------------------------------------------------------ router
  const ID = "[0-9a-f]{16}";
  function parse(hash) {
    const [path, query] = (hash.replace(/^#/, "") || "/").split("?");
    const params = new URLSearchParams(query || "");
    let m;
    if (path === "/" || path === "") return { name: "home", params };
    if (path === "/hilfe") return { name: "help", params };
    if ((m = new RegExp(`^/p/(${ID})$`).exec(path))) return { name: "project", id: m[1], tab: params.get("t") || "", params };
    if ((m = new RegExp(`^/p/(${ID})/r/(${ID})$`).exec(path))) return { name: "room", id: m[1], room: m[2], params };
    return { name: "notfound", params };
  }

  async function render() {
    const route = parse(location.hash);
    const token = (render.token = (render.token || 0) + 1);
    current?.destroy?.();
    current = null;
    const host = root();
    fill(host, h("div", { class: "screen loading" }, h("div", { class: "spinner" })));
    let view;
    try {
      if (route.name === "home") view = await R.homeView(app);
      else if (route.name === "help") view = R.helpView(app);
      else if (route.name === "project") view = await R.projectView(app, route.id, route.tab);
      else if (route.name === "room") view = await R.roomView(app, route.id, route.room, route.params);
      else view = { element: h("div", { class: "screen" }, R.notFoundView(app)), destroy() {} };
    } catch (error) {
      console.error(error);
      view = { element: h("div", { class: "screen" }, h("div", { class: "empty" }, h("h3", {}, "Das hat nicht geklappt"), h("p", {}, "Beim Laden ist etwas schiefgegangen."), h("a", { class: "btn primary", href: "#/" }, "Zur Übersicht"))), destroy() {} };
    }
    if (token !== render.token) { view.destroy?.(); return; }
    current = view;
    fill(host, view.element);
    window.scrollTo(0, 0);
    document.title = { home: "raumo", help: "Hilfe | raumo" }[route.name] || "raumo";
    if (route.name === "project" || route.name === "room") app.store.getProject(route.id).then((p) => { if (p && token === render.token) document.title = `${p.name} | raumo`; });
  }

  app.go = (path, force) => {
    const target = `#${path}`;
    if (location.hash === target || (!location.hash && path === "/")) { if (force) render(); else window.scrollTo(0, 0); } else location.hash = target;
  };

  app.notFound = (text) => R.notFoundView(app, text);
  app.emptyScans = (project) => R.emptyScans(app, project);

  // ---------------------------------------------------------------------------------------------- helpers
  async function projectFor(projectId, name) {
    let project = projectId ? await app.store.getProject(projectId) : null;
    if (!project) {
      const n = (await app.store.listProjects()).length;
      project = Store.newProject(name || (n ? `Gebäude ${n + 1}` : "Mein Gebäude"));
    }
    return project;
  }

  /* A place for something new in a building: to the right of what is there. */
  function nextLayout(project) {
    let right = null;
    for (const { room, layout } of R.placedRooms(project)) { const b = Core.bounds(Core.placedPolygon(room, layout)); right = right == null ? b.maxX : Math.max(right, b.maxX); }
    for (const c of project.clouds || []) { const l = project.layouts[c.id] || { x: 0, z: 0 }; const x = l.x + c.bounds.max[0]; right = right == null ? x : Math.max(right, x); }
    return { x: right == null ? 0 : right + 1, z: 0, rot: 0 };
  }

  async function persist() { try { await navigator.storage?.persist?.(); } catch (error) { /* not allowed: fine */ } }

  const busy = (text) => { const el = R.busyBox(text); el.classList.add("overlay"); document.body.append(el); return el; };

  // --------------------------------------------------------------------------------------------- new scan
  app.newRoom = function newRoom(projectId) {
    let entry;
    const choice = (iconName, title, text, run, extra) => h("button", { class: "choice-card", type: "button", onclick: () => { entry.close(); run(); }, ...extra }, h("span", { class: "cc-ic" }, icon(iconName)), h("span", { class: "cc-text" }, h("b", {}, title), h("small", {}, text)), icon("chevron"));
    const walkText = h("small", {}, "Mit Tiefenmessung: etwa alle 5 cm ein Punkt in der gescannten Farbe. Android mit Chrome.");
    const walk = choice("walk", "Durch den Raum gehen", "", () => app.walk("xr", projectId));
    walk.querySelector(".cc-text small").replaceWith(walkText);
    R.walkSupport().then((s) => { if (!s.ok) { walk.classList.add("off"); walkText.textContent = s.reason; } });
    entry = dialog({ title: "Neuer Scan", body: h("div", { class: "choices-list" },
      walk,
      choice("scan", "Raum im Stehen messen", "Funktioniert mit jedem Handy: Ecken anzeigen, beim Drehen werden Fotos gemacht.", () => app.scan("real", projectId)),
      choice("points", "Punktwolke öffnen", "Eine Datei aus einer anderen Scan-App (PLY, LAS oder XYZ).", () => app.importCloud(projectId)),
      choice("cube", "Übungsrundgang am Bildschirm", "Ausprobieren, ohne das Handy zu bewegen.", () => app.walk("sim", projectId)),
      choice("ruler", "Maße eingeben", "Einen rechteckigen Raum von Hand anlegen.", () => app.addManualRoom(projectId))) });
  };

  // -------------------------------------------------------------------------------------------- walking
  app.walk = async function walk(mode, projectId) {
    if (mode === "xr") {
      const support = await R.walkSupport();
      if (!support.ok) {
        dialog({ title: "Das geht auf diesem Gerät nicht", body: h("div", {}, h("p", { class: "dialog-text" }, support.reason), h("p", { class: "muted small" }, "Du kannst stattdessen einen Raum im Stehen messen oder den Übungsrundgang ausprobieren.")),
          actions: [{ label: "Raum im Stehen messen", kind: "primary", run: () => { app.scan("real", projectId); } }, { label: "Übungsrundgang", kind: "ghost", run: () => { app.walk("sim", projectId); } }] });
        return;
      }
    }
    R.openWalk({
      mode, demo: mode === "sim" ? demoPackage() : null,
      onDone: (cloud, info) => app.addCloud(cloud, { projectId, source: mode === "sim" ? "demo" : "walk", info }),
      onCancel() {},
    });
  };

  /* Keeps a finished cloud in a building (a new one, or `projectId`). */
  app.addCloud = async function addCloud(cloud, { projectId, source = "walk", name, info } = {}) {
    if (!cloud || cloud.count < 50) { toast("Es wurden zu wenige Punkte gefunden."); return; }
    const project = await projectFor(projectId);
    const existing = (project.clouds || []).length + 1;
    const title = await promptBox({ title: "Wie heißt dieser Scan?", value: name || (source === "demo" ? "Übungsraum" : `Rundgang ${existing}`), yes: "Speichern" });
    if (title == null) { toast("Der Scan wurde nicht gespeichert."); return; }
    let points = cloud;
    if (points.count > Store.MAX_CLOUD_POINTS) points = Cloud.voxelize(points, 0.07);
    const meta = Store.newCloud(title, points, source);
    try {
      await app.store.putCloud(meta.id, points);
    } catch (error) { console.error(error); toast("Der Speicher des Browsers ist voll. Lösche alte Scans."); return; }
    project.clouds = project.clouds || [];
    project.clouds.push(meta);
    project.layouts[meta.id] = projectId ? nextLayout(project) : { x: 0, z: 0, rot: 0 };
    project.thumb = null;
    await app.store.saveProject(project);
    persist();
    toast(`${points.count.toLocaleString("de-DE")} Punkte gespeichert.${info && info.mode === "xr" && !info.color ? " Ohne Farbe: die Punkte sind nach Höhe gefärbt." : ""}`);
    app.go(`/p/${project.id}`, true);
  };

  // ------------------------------------------------------------------------------------- opening a file
  app.importCloud = function importCloud(projectId) {
    const input = h("input", { type: "file", accept: ".ply,.las,.xyz,.txt,.csv,.pts", hidden: true });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      if (file.size > 400 * 1024 * 1024) { toast("Die Datei ist zu groß (höchstens 400 MB)."); return; }
      const wait = busy(`${file.name} wird gelesen …`);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        wait.set(0.3);
        await R.nextFrame();
        const { cloud, format } = Cloud.readCloud(bytes, Store.MAX_CLOUD_POINTS);
        wait.set(0.6, "Punkte werden vorbereitet …");
        await R.nextFrame();
        let points = cloud;
        if (format !== "las") {                                                   // LAS has a fixed "up"; for the others it is guessed: the room is lower than it is wide
          const b = Cloud.boundsOf(points);
          const ext = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
          if (ext[2] < ext[1] * 0.8 && ext[2] < ext[0] * 0.8) points = Cloud.zUpToYUp(points);
        }
        points = Cloud.recentre(points).cloud;
        if (points.count > 2500000) points = Cloud.voxelize(points, 0.05);
        wait.remove();
        const name = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Punktwolke";
        await app.addCloud(points, { projectId, source: "import", name });
      } catch (error) {
        wait.remove();
        console.error(error);
        toast(error.message || "Die Datei konnte nicht gelesen werden.");
      }
    });
    document.body.append(input);
    input.click();
  };

  // ------------------------------------------------------------------------------------ measuring a room
  app.scan = function scan(mode, projectId) {
    const wizard = R.openScan({
      mode, demo: mode === "demo" ? { room: demoPackage().room, textures: demoPackage().textures, props: demoPackage().props } : null,
      onSwitchToDemo: () => { wizard.close(); app.scan("demo", projectId); },
      onDone: (result) => app.addRoomFromScan(result, projectId),
      onCancel() {},
    });
  };

  app.addRoomFromScan = async function addRoomFromScan(result, projectId) {
    let room;
    try { room = Core.roomFromScan(result); } catch (error) { toast("Aus den Ecken konnte kein Raum gebaut werden."); return; }
    const squared = Core.orthogonalize(room.polygon, 10);
    if (squared.snapped === room.polygon.length) room = Core.reshapeRoom(room, squared.polygon);
    const project = await projectFor(projectId);
    const name = await promptBox({ title: "Wie heißt der Raum?", value: result.mode === "demo" ? "Übungsraum" : `Raum ${project.rooms.length + 1}`, yes: "Speichern" });
    if (name == null) { toast("Der Raum wurde nicht gespeichert."); return; }
    const stored = Store.newRoom(name, room, { source: "scan", fov: result.fov, photoCount: result.photos.length });
    stored.photoStamp = Date.now();
    await app.store.putPhotos(stored.id, result.photos);
    project.rooms.push(stored);
    project.layouts[stored.id] = projectId ? nextLayout(project) : { x: 0, z: 0, rot: 0 };
    project.thumb = null;
    await app.store.saveProject(project);
    persist();
    app.go(`/p/${project.id}/r/${stored.id}?new=1`);
  };

  app.addManualRoom = async function addManualRoom(projectId) {
    const fields = {};
    const field = (key, label, value) => {
      const input = h("input", { class: "field", type: "text", inputmode: "decimal", "aria-label": label, autocomplete: "off", maxlength: 6 });
      input.value = value;
      fields[key] = input;
      return h("label", { class: "field-label" }, h("span", {}, label), h("div", { class: "with-unit" }, input, h("span", { class: "unit" }, "m")));
    };
    const name = h("input", { class: "field", type: "text", "aria-label": "Name", maxlength: 60, autocomplete: "off" });
    name.value = "Raum 1";
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    dialog({ title: "Raum von Hand anlegen", body: h("div", {}, h("label", { class: "field-label" }, h("span", {}, "Name"), name), field("length", "Länge", "4,50"), field("width", "Breite", "3,50"), field("height", "Höhe", "2,50"), error),
      actions: [{ label: "Anlegen", kind: "primary", run: async () => {
        const read = (k) => Number(fields[k].value.trim().replace(",", "."));
        const [l, w, hgt] = [read("length"), read("width"), read("height")];
        if (![l, w].every((v) => v >= 1 && v <= 40) || !(hgt >= 1.8 && hgt <= 10)) { error.textContent = "Länge und Breite brauchen 1 bis 40 m, die Höhe 1,8 bis 10 m."; error.hidden = false; return false; }
        const project = await projectFor(projectId);
        const stored = Store.newRoom(name.value.trim() || "Raum", Core.rectangleRoom(l, w, hgt), { source: "manual" });
        project.rooms.push(stored);
        project.layouts[stored.id] = nextLayout(project);
        project.thumb = null;
        await app.store.saveProject(project);
        app.go(`/p/${project.id}/r/${stored.id}`);
        return true;
      } }] });
  };

  app.correctScale = async function correctScale(project, stored, wallIndex, save) {
    const room = Store.roomOf(stored);
    const wall = Core.wallsOf(room.polygon)[wallIndex];
    const value = await promptBox({ title: `Wand ${wallIndex + 1} nachmessen`, label: "Echte Länge der Wand", value: num(wall.len), type: "number", unit: "m", min: 0.3, max: 40, yes: "Maße anpassen", help: `raumo hat ${metres(wall.len)} gemessen. Alle Längen im Raum werden im gleichen Verhältnis angepasst.` });
    if (value == null) return;
    const factor = value / wall.len;
    if (factor < 0.5 || factor > 2) { toast("Das passt nicht: der Unterschied ist zu groß."); return; }
    await save(Core.scaleRoom(room, factor));
    toast(`Alle Maße wurden um ${num(Math.abs(factor - 1) * 100, 1)} % ${factor >= 1 ? "größer" : "kleiner"} gemacht.`);
  };

  // ------------------------------------------------------------------------------------------ the example
  app.openExample = async function openExample() {
    const existing = (await app.store.listProjects()).find((p) => p.example);
    if (existing) { app.go(`/p/${existing.id}`); return; }
    const wait = busy("Das Beispiel wird gescannt …");
    try {
      const demo = demoPackage();
      const scene = window.RaumoSim.makeScene(demo.room, { pictures: demo.pictures, boxes: demo.boxes });
      const capture = new Cloud.WalkCapture({ size: Cloud.SPACING, minHits: 2, near: 0.35, far: 4.5, stride: 1, edge: 0.08 });
      const path = window.RaumoSim.walkPath(demo.room, 220, 1.4);
      let seed = 11;
      const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        capture.addFrame(window.RaumoSim.renderFrame(scene, p.position, p.forward, p.up, { fov: 70, depthSize: [48, 64], colorSize: [96, 128], noise: 0.008, random }));
        if (i % 12 === 0) { wait.set(i / path.length); await R.nextFrame(); }
      }
      const cloud = capture.toCloud();
      const project = Store.newProject("Beispielgebäude");
      project.example = true;
      const meta = Store.newCloud("Wohnzimmer (Rundgang)", cloud, "demo");
      await app.store.putCloud(meta.id, cloud);
      project.clouds.push(meta);
      project.layouts[meta.id] = { x: 0, z: 0, rot: 0 };
      const hall = window.RaumoDemo.rooms()[1];
      const stored = Store.newRoom("Flur", hall.room, { source: "demo" });
      project.rooms.push(stored);
      project.layouts[stored.id] = { x: 5.4, z: 0, rot: 0 };
      await app.store.saveProject(project);
      await R.keepPictures(app.store, stored, window.RaumoDemo.textures(hall.room, document));
      wait.remove();
      app.go(`/p/${project.id}`);
    } catch (error) {
      wait.remove();
      console.error(error);
      toast("Das Beispiel konnte nicht angelegt werden.");
    }
  };

  // ------------------------------------------------------------------------------------- thumbnails
  app.saveThumb = async function saveThumb(project, viewer) {
    try {
      const blob = await viewer.snapshot(420, "image/jpeg", 0.8);
      if (!blob) return;
      const data = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
      if (typeof data === "string" && data.length < 90000) { project.thumb = data; await app.store.saveProject(project); }
    } catch (error) { /* a missing thumbnail is no harm */ }
  };

  // ------------------------------------------------------------------------------ deleting and renaming
  app.renameProject = async function renameProject(project) {
    const name = await promptBox({ title: "Gebäude umbenennen", value: project.name, yes: "Speichern" });
    if (name) { project.name = Store.cleanName(name, project.name); await app.store.saveProject(project); app.go("/", true); }
  };

  app.deleteProject = async function deleteProject(project) {
    if (!(await confirmBox({ title: `„${project.name}“ löschen?`, text: "Das Gebäude mit allen Scans, Punkten und Fotos wird von diesem Gerät gelöscht. Das lässt sich nicht rückgängig machen.", yes: "Löschen", danger: true }))) return;
    await app.store.deleteProject(project.id);
    app.go("/", true);
  };

  app.deleteRoom = async function deleteRoom(project, stored) {
    if (!(await confirmBox({ title: `„${stored.name}“ löschen?`, text: "Der Raum mit seinen Fotos wird gelöscht.", yes: "Löschen", danger: true }))) return;
    await app.store.deleteRoomData(stored.id);
    project.rooms = project.rooms.filter((r) => r.id !== stored.id);
    delete project.layouts[stored.id];
    project.thumb = null;
    await app.store.saveProject(project);
    app.go(`/p/${project.id}?t=scans`, true);
  };

  app.deleteCloud = async function deleteCloud(project, meta) {
    if (!(await confirmBox({ title: `„${meta.name}“ löschen?`, text: "Die Punkte dieses Scans werden gelöscht.", yes: "Löschen", danger: true }))) return;
    await app.store.deleteCloud(meta.id);
    project.clouds = project.clouds.filter((c) => c.id !== meta.id);
    delete project.layouts[meta.id];
    project.thumb = null;
    await app.store.saveProject(project);
    app.go(`/p/${project.id}?t=scans`, true);
  };

  /* Moves and turns a cloud inside its building (for example to put two walks next to each other). */
  app.moveCloud = function moveCloud(project, meta) {
    const layout = project.layouts[meta.id] || { x: 0, z: 0, rot: 0 };
    const make = (label, value, unit) => { const input = h("input", { class: "field", type: "text", inputmode: "decimal", "aria-label": label, autocomplete: "off", maxlength: 8 }); input.value = num(value); return { input, el: h("label", { class: "field-label" }, h("span", {}, label), h("div", { class: "with-unit" }, input, h("span", { class: "unit" }, unit))) }; };
    const x = make("Nach rechts", layout.x, "m"), z = make("Nach hinten", layout.z, "m"), r = make("Drehen", layout.rot, "°");
    dialog({ title: "Scan verschieben und drehen", body: h("div", {}, x.el, z.el, r.el),
      actions: [{ label: "Übernehmen", kind: "primary", run: async () => {
        const v = [x, z, r].map((f) => Number(f.input.value.trim().replace(",", ".")));
        if (!v.every(Number.isFinite) || Math.abs(v[0]) > 500 || Math.abs(v[1]) > 500) { toast("Das sind keine gültigen Zahlen."); return false; }
        project.layouts[meta.id] = { x: v[0], z: v[1], rot: ((v[2] % 360) + 360) % 360 };
        project.thumb = null;
        await app.store.saveProject(project);
        app.go(`/p/${project.id}?t=3d`, true);
        return true;
      } }] });
  };

  // ------------------------------------------------------------------------------------------- backups
  app.saveBackup = async function saveBackup(project) {
    const wait = busy("Sicherung wird gebaut …");
    try {
      const bytes = await app.store.exportBackup(project.id);
      saveFile(`${window.RaumoExport.safe(project.name)}.raumo`, bytes, "application/zip");
      toast(`Sicherung gespeichert (${R.sizeText(bytes.length)}).`);
    } catch (error) { console.error(error); toast(error.message || "Die Sicherung ist fehlgeschlagen."); } finally { wait.remove(); }
  };

  app.pickBackup = function pickBackup() {
    const input = h("input", { type: "file", accept: ".raumo,.zip,application/zip", hidden: true });
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      const wait = busy("Sicherung wird geladen …");
      try {
        const project = await app.store.importBackup(new Uint8Array(await file.arrayBuffer()));
        wait.remove();
        persist();
        toast(`„${project.name}“ wurde geladen.`);
        app.go(`/p/${project.id}`);
      } catch (error) { wait.remove(); toast(error.message || "Die Sicherung konnte nicht geladen werden."); }
    });
    document.body.append(input);
    input.click();
  };

  // --------------------------------------------------------------------------------------------- start
  async function boot() {
    let backend;
    try { backend = Store.indexedBackend(); await backend.ready; } catch (error) { backend = Store.memoryBackend(); }
    app.store = Store.createStore(backend);
    R.app = app;
    window.addEventListener("hashchange", render);
    document.querySelector(".skip")?.addEventListener("click", (event) => {       // the address of the page is its hash, so the link must not change it
      event.preventDefault();
      const main = document.getElementById("main");
      if (main) { main.setAttribute("tabindex", "-1"); main.focus(); }
    });
    window.addEventListener("unhandledrejection", (e) => { console.error(e.reason); toast("Etwas ist schiefgelaufen. Bitte versuche es noch einmal."); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    await render();
  }

  boot();
})();
