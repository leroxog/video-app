/* raumo store: everything a scan produces stays on the device, in the browser's own database (IndexedDB): projects (a building with its
   rooms, its point clouds and where they stand), the points of the clouds, the photos taken while scanning a room, and the pictures
   baked for the walls.  Nothing is sent anywhere.
   Because the browser can throw its data away, a project can be saved to a backup file (a ZIP) and loaded again.

   The database sits behind a small "backend" (get, put, delete, all, clear for named tables), so that the same code runs on IndexedDB
   in the page and on a plain Map in the tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./raumo-core.js"), require("./raumo-export.js"), require("./raumo-cloud.js"));
  else root.RaumoStore = factory(root.RaumoCore, root.RaumoExport, root.RaumoCloud);
})(typeof self !== "undefined" ? self : this, function (Core, Export, Cloud) {
  "use strict";

  const VERSION = 1;
  const MAX_ROOMS = 40, MAX_CLOUDS = 20, MAX_PHOTOS = 200, MAX_PHOTO_BYTES = 800 * 1024, MAX_NAME = 80, MAX_CLOUD_POINTS = 4000000;
  const TABLES = ["projects", "photos", "textures", "clouds"];
  const KEYS = { projects: "id", photos: "key", textures: "key", clouds: "id" };

  const uid = () => {
    const bytes = new Uint8Array(8);
    (typeof crypto !== "undefined" && crypto.getRandomValues ? crypto : { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  // ----------------------------------------------------------------------------------------------- backends
  /* A database in memory (for the tests, and for browsers that do not allow IndexedDB: nothing survives a reload then). */
  function memoryBackend() {
    const tables = Object.fromEntries(TABLES.map((t) => [t, new Map()]));
    return {
      persistent: false,
      async get(table, key) { const v = tables[table].get(key); return v === undefined ? undefined : structuredCloneSafe(v); },
      async put(table, value) { tables[table].set(value[KEYS[table]], structuredCloneSafe(value)); },
      async delete(table, key) { tables[table].delete(key); },
      async all(table) { return [...tables[table].values()].map(structuredCloneSafe); },
      async deleteWhere(table, test) { for (const [k, v] of [...tables[table]]) if (test(v)) tables[table].delete(k); },
      async clear() { for (const t of TABLES) tables[t].clear(); },
    };
  }

  function structuredCloneSafe(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  /* The browser's IndexedDB; rejects when it is not available (a private window in some browsers). */
  function indexedBackend(name = "raumo") {
    const opened = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("no indexeddb")); return; }
      const request = indexedDB.open(name, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const t of TABLES) if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: KEYS[t] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexeddb failed"));
      request.onblocked = () => reject(new Error("indexeddb blocked"));
    });
    const run = async (table, mode, work) => {
      const db = await opened;
      return new Promise((resolve, reject) => {
        const tx = db.transaction(table, mode);
        const result = work(tx.objectStore(table));
        tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("aborted"));
      });
    };
    return {
      persistent: true, ready: opened,
      get: (table, key) => run(table, "readonly", (s) => s.get(key)),
      put: (table, value) => run(table, "readwrite", (s) => { s.put(value); }),
      delete: (table, key) => run(table, "readwrite", (s) => { s.delete(key); }),
      all: (table) => run(table, "readonly", (s) => s.getAll()),
      async deleteWhere(table, test) {
        const db = await opened;
        return new Promise((resolve, reject) => {
          const tx = db.transaction(table, "readwrite");
          const request = tx.objectStore(table).openCursor();
          request.onsuccess = () => { const c = request.result; if (c) { if (test(c.value)) c.delete(); c.continue(); } };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
      async clear() { for (const t of TABLES) await run(t, "readwrite", (s) => { s.clear(); }); },
    };
  }

  // ----------------------------------------------------------------------------------------------- helpers
  const finite = (x, fallback = 0) => (Number.isFinite(Number(x)) ? Number(x) : fallback);
  const cleanName = (name, fallback) => String(name == null ? "" : name).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁠-⁤﻿]/g, "").trim().slice(0, MAX_NAME) || fallback;

  async function bytesOf(data) {
    if (data instanceof Uint8Array) return data;
    if (data && typeof data.arrayBuffer === "function") return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new Error("not bytes");
  }

  /* A project as it is kept: only plain data (no pictures). */
  function newProject(name = "Mein Gebäude") {
    const now = Date.now();
    return { v: VERSION, id: uid(), name: cleanName(name, "Mein Gebäude"), created: now, updated: now, thumb: null, rooms: [], clouds: [], layouts: {} };
  }

  /* The description of a point cloud as the project keeps it (the points themselves are in the store under the same id). */
  function newCloud(name, cloud, source = "walk") {
    const b = Cloud.boundsOf(cloud);
    return { id: uid(), name: cleanName(name, "Punktwolke"), source, count: cloud.count, created: Date.now(), bounds: { min: b.min.map((x) => Math.round(x * 100) / 100), max: b.max.map((x) => Math.round(x * 100) / 100) } };
  }

  /* A room as it is kept. `room` is a Core room; the rest is what the scan knew. */
  function newRoom(name, room, extra = {}) {
    const now = Date.now();
    return {
      id: uid(), name: cleanName(name, "Raum"), created: now, updated: now,
      polygon: room.polygon.map((p) => [p[0], p[1]]), height: room.height, phoneHeight: room.phoneHeight, thickness: room.thickness,
      openings: room.openings.map((o) => ({ ...o })), source: extra.source || "scan", fov: extra.fov || 70, photoCount: extra.photoCount || 0, scale: 1,
    };
  }

  const roomOf = (stored) => Core.makeRoom({ polygon: stored.polygon, height: stored.height, phoneHeight: stored.phoneHeight, thickness: stored.thickness, openings: stored.openings });

  /* A stored room after a change of its geometry: the baked pictures no longer fit, and the room says when it changed. */
  function withRoom(stored, room, changes = {}) {
    return { ...stored, polygon: room.polygon.map((p) => [p[0], p[1]]), height: room.height, phoneHeight: room.phoneHeight, thickness: room.thickness, openings: room.openings.map((o) => ({ ...o })), updated: Date.now(), ...changes };
  }

  /* Checks and cleans a project that came from a file. Returns a project with new ids, or throws. */
  function sanitizeProject(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.rooms)) throw new Error("Das ist keine raumo-Sicherung.");
    const rawClouds = Array.isArray(raw.clouds) ? raw.clouds.slice(0, MAX_CLOUDS) : [];
    const project = newProject(cleanName(raw.name, "Importiertes Gebäude"));
    const idMap = {};
    for (const r of raw.rooms.slice(0, MAX_ROOMS)) {
      if (!r || !Array.isArray(r.polygon) || r.polygon.length < 3 || r.polygon.length > 200) continue;
      if (!r.polygon.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) continue;      // numbers only, nothing is guessed
      const polygon = r.polygon.map((p) => [p[0], p[1]]);
      if (polygon.some(([x, z]) => Math.abs(x) > Core.MAX_ROOM || Math.abs(z) > Core.MAX_ROOM) || !Core.isSimple(polygon)) continue;
      const room = Core.makeRoom({ polygon, height: finite(r.height, 2.5), phoneHeight: finite(r.phoneHeight, 1.4), thickness: r.thickness, openings: Array.isArray(r.openings) ? r.openings.slice(0, 60).map((o) => ({ wall: Math.round(finite(o && o.wall, -1)), u0: finite(o && o.u0), u1: finite(o && o.u1), v0: finite(o && o.v0), v1: finite(o && o.v1), kind: o && o.kind })) : [] });
      const stored = newRoom(cleanName(r.name, "Raum"), room, { source: ["scan", "manual", "demo"].includes(r.source) ? r.source : "scan", fov: Core.clamp(finite(r.fov, 70), 40, 110), photoCount: 0 });
      idMap[r.id] = stored.id;
      project.rooms.push(stored);
    }
    for (const c of rawClouds) {
      if (!c || typeof c.id !== "string") continue;
      const id = uid();
      idMap[c.id] = id;
      const bounds = c.bounds && Array.isArray(c.bounds.min) && Array.isArray(c.bounds.max) && c.bounds.min.length === 3 && c.bounds.max.length === 3 && [...c.bounds.min, ...c.bounds.max].every(Number.isFinite) ? c.bounds : { min: [0, 0, 0], max: [0, 0, 0] };
      project.clouds.push({ id, name: cleanName(c.name, "Punktwolke"), source: ["walk", "room", "import", "demo"].includes(c.source) ? c.source : "import", count: 0, created: Date.now(), bounds });
    }
    if (!project.rooms.length && !project.clouds.length) throw new Error("In der Sicherung steckt kein Raum.");
    const layouts = Core.autoLayout(project.rooms.map(roomOf));
    project.rooms.forEach((stored, i) => { project.layouts[stored.id] = layouts[i]; });
    project.clouds.forEach((c) => { project.layouts[c.id] = { x: 0, z: 0, rot: 0 }; });
    for (const [oldId, layout] of Object.entries(raw.layouts || {})) {
      const id = idMap[oldId];
      const place = (v) => (typeof v === "number" && Number.isFinite(v) ? Core.clamp(v, -1000, 1000) : 0);
      if (id && layout) project.layouts[id] = { x: place(layout.x), z: place(layout.z), rot: ((place(layout.rot) % 360) + 360) % 360 };
    }
    return { project, idMap };
  }

  // ----------------------------------------------------------------------------------------------- the store
  function createStore(backend) {
    const photoKey = (roomId, n) => `${roomId}:${n}`;
    const store = {
      backend, get persistent() { return backend.persistent; },

      async listProjects() {
        const all = await backend.all("projects");
        return all.sort((a, b) => b.updated - a.updated);
      },
      async getProject(id) { return (await backend.get("projects", id)) || null; },
      async saveProject(project) { project.updated = Date.now(); await backend.put("projects", project); return project; },

      async deleteProject(id) {
        const project = await store.getProject(id);
        if (project) {
          for (const room of project.rooms) await store.deleteRoomData(room.id);
          for (const c of project.clouds || []) await backend.delete("clouds", c.id);
        }
        await backend.delete("projects", id);
      },

      /* The points of a cloud: {count, positions: Float32Array, colors: Uint8Array}. */
      async putCloud(id, cloud) { await backend.put("clouds", { id, count: cloud.count, positions: cloud.positions.slice(0, cloud.count * 3), colors: cloud.colors.slice(0, cloud.count * 3) }); },
      async getCloud(id) {
        const r = await backend.get("clouds", id);
        return r ? { count: r.count, positions: new Float32Array(r.positions), colors: new Uint8Array(r.colors) } : null;
      },
      async deleteCloud(id) { await backend.delete("clouds", id); },
      async deleteRoomData(roomId) {
        await backend.deleteWhere("photos", (p) => p.roomId === roomId);
        await backend.deleteWhere("textures", (t) => t.roomId === roomId);
      },

      /* The photos of a room: [{width, height, forward, up, position, blob}] in the order they were taken. */
      async putPhotos(roomId, photos) {
        await backend.deleteWhere("photos", (p) => p.roomId === roomId);
        let n = 0;
        for (const photo of photos.slice(0, MAX_PHOTOS)) await backend.put("photos", { key: photoKey(roomId, n), roomId, n: n++, ...photo });
      },
      async getPhotos(roomId) {
        const all = (await backend.all("photos")).filter((p) => p.roomId === roomId);
        return all.sort((a, b) => a.n - b.n);
      },

      /* Baked pictures: {blob, version} for a surface of a room; `version` says what they were baked from. */
      async putTexture(roomId, surfaceId, blob, version) { await backend.put("textures", { key: `${roomId}:${surfaceId}`, roomId, surfaceId, blob, version }); },
      async getTexture(roomId, surfaceId) { return (await backend.get("textures", `${roomId}:${surfaceId}`)) || null; },
      async clearTextures(roomId) { await backend.deleteWhere("textures", (t) => t.roomId === roomId); },

      /* A backup of one project as a ZIP file (bytes): the project, its photos with the angles they were taken at. */
      async exportBackup(projectId) {
        const project = await store.getProject(projectId);
        if (!project) throw new Error("Das Projekt gibt es nicht.");
        const files = [];
        const photoIndex = {};
        for (const room of project.rooms) {
          const list = [];
          for (const photo of await store.getPhotos(room.id)) {
            const name = `photos/${room.id}_${photo.n}.jpg`;
            files.push({ name, data: await bytesOf(photo.blob) });
            list.push({ file: name, width: photo.width, height: photo.height, forward: photo.forward, up: photo.up, position: photo.position });
          }
          photoIndex[room.id] = list;
        }
        for (const c of project.clouds || []) {
          const points = await store.getCloud(c.id);
          if (points) files.push({ name: `clouds/${c.id}.ply`, data: Cloud.toPLY(points) });
        }
        const meta = { app: "raumo", v: VERSION, exported: new Date().toISOString(), project: { ...project, thumb: null }, photos: photoIndex };
        return Export.zip([{ name: "raumo.json", data: JSON.stringify(meta) }, ...files]);
      },

      /* Loads a backup: the project is stored under new ids and returned. */
      async importBackup(bytes) {
        let entries;
        try { entries = Export.unzip(bytes); } catch (error) { throw new Error("Die Datei ist keine raumo-Sicherung."); }
        const byName = Object.fromEntries(entries.map((e) => [e.name, e.data]));
        if (!byName["raumo.json"]) throw new Error("Die Datei ist keine raumo-Sicherung.");
        let meta;
        try { meta = JSON.parse(new TextDecoder().decode(byName["raumo.json"])); } catch (error) { throw new Error("Die Sicherung ist beschädigt."); }
        if (!meta || meta.app !== "raumo" || meta.v > VERSION) throw new Error("Diese Sicherung stammt von einer neueren Version von raumo.");
        const { project, idMap } = sanitizeProject(meta.project);
        for (const [oldId, newId] of Object.entries(idMap)) {
          if (!project.rooms.some((r) => r.id === newId)) continue;                            // (the ids of clouds are dealt with below)
          const photos = [];
          for (const p of ((meta.photos || {})[oldId] || []).slice(0, MAX_PHOTOS)) {
            const data = byName[p.file];
            if (!data || data.length > MAX_PHOTO_BYTES || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) continue;
            const vec = (v) => (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x)) ? Core.normalize(v) : null);
            const forward = vec(p.forward), up = vec(p.up);
            if (!forward || !up || !(p.width > 0 && p.width <= 4096 && p.height > 0 && p.height <= 4096)) continue;
            photos.push({ width: Math.round(p.width), height: Math.round(p.height), forward, up, position: vec3(p.position), blob: data });
          }
          await store.putPhotos(newId, photos);
          const stored = project.rooms.find((r) => r.id === newId);
          stored.photoCount = photos.length;
        }
        for (const [oldId, newId] of Object.entries(idMap)) {
          const stored = project.clouds.find((c) => c.id === newId);
          if (!stored) continue;
          const data = byName[`clouds/${oldId}.ply`];
          if (!data) { project.clouds = project.clouds.filter((c) => c !== stored); delete project.layouts[newId]; continue; }
          try {
            const cloud = Cloud.fromPLY(data, MAX_CLOUD_POINTS);
            await store.putCloud(newId, cloud);
            stored.count = cloud.count;
          } catch (error) { project.clouds = project.clouds.filter((c) => c !== stored); delete project.layouts[newId]; }
        }
        if (!project.rooms.length && !project.clouds.length) throw new Error("In der Sicherung steckt kein Raum.");
        await store.saveProject(project);
        return project;
      },
    };
    return store;
  }

  const vec3 = (v) => (Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x) && Math.abs(x) < 100) ? v : [0, 1.4, 0]);

  return { VERSION, MAX_ROOMS, MAX_CLOUDS, MAX_PHOTOS, MAX_CLOUD_POINTS, uid, memoryBackend, indexedBackend, createStore, newProject, newRoom, newCloud, roomOf, withRoom, sanitizeProject, cleanName, bytesOf };
});
