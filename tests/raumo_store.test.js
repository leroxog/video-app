"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/raumo-core.js");
const X = require("../static/js/raumo-export.js");
const S = require("../static/js/raumo-store.js");
const P = require("../static/js/raumo-cloud.js");

const JPEG = (n) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 2, 3, 0xff, 0xd9]);

async function sample(store) {
  const project = S.newProject("Haus <b>Nord</b>");
  const a = S.newRoom("Wohnzimmer", C.makeRoom({ polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]], height: 2.5, phoneHeight: 1.4, openings: [{ wall: 0, u0: 1, u1: 2, v0: 0, v1: 2, kind: "door" }] }), { fov: 66 });
  const b = S.newRoom("Küche", C.rectangleRoom(3, 2, 2.4));
  project.rooms.push(a, b);
  project.layouts[a.id] = { x: 1, z: 2, rot: 0 };
  project.layouts[b.id] = { x: 5, z: 2, rot: 90 };
  await store.saveProject(project);
  await store.putPhotos(a.id, [0, 1, 2].map((n) => ({ width: 640, height: 480, forward: [0, 0, -1], up: [0, 1, 0], position: [0, 1.4, 0], blob: JPEG(n) })));
  await store.putPhotos(b.id, [{ width: 320, height: 240, forward: [1, 0, 0], up: [0, 1, 0], position: [0, 1.4, 0], blob: JPEG(9) }]);
  return { project, a, b };
}

test("projects are saved, listed newest first, read back and deleted with their photos", async () => {
  const store = S.createStore(S.memoryBackend());
  const { project, a } = await sample(store);
  const other = S.newProject("Zweites");
  other.updated = 1;
  await store.backend.put("projects", other);
  const list = await store.listProjects();
  assert.deepEqual(list.map((p) => p.name), ["Haus <b>Nord</b>", "Zweites"]);
  const back = await store.getProject(project.id);
  assert.equal(back.rooms.length, 2);
  assert.equal((await store.getPhotos(a.id)).length, 3);
  await store.deleteProject(project.id);
  assert.equal(await store.getProject(project.id), null);
  assert.equal((await store.getPhotos(a.id)).length, 0);
  assert.equal((await store.listProjects()).length, 1);
});

test("photos keep their order and are replaced as a whole", async () => {
  const store = S.createStore(S.memoryBackend());
  await store.putPhotos("r1", [1, 2, 3].map((n) => ({ width: 1, height: 1, forward: [0, 0, -1], up: [0, 1, 0], blob: JPEG(n) })));
  assert.deepEqual((await store.getPhotos("r1")).map((p) => p.blob[4]), [1, 2, 3]);
  await store.putPhotos("r1", [{ width: 1, height: 1, forward: [0, 0, -1], up: [0, 1, 0], blob: JPEG(7) }]);
  assert.equal((await store.getPhotos("r1")).length, 1);
  await store.putPhotos("r2", [{ width: 1, height: 1, forward: [0, 0, -1], up: [0, 1, 0], blob: JPEG(8) }]);
  assert.equal((await store.getPhotos("r1")).length, 1);
});

test("baked pictures are kept per surface and can be cleared", async () => {
  const store = S.createStore(S.memoryBackend());
  await store.putTexture("r1", "wall:0", JPEG(1), "v1");
  await store.putTexture("r1", "floor", JPEG(2), "v1");
  await store.putTexture("r2", "floor", JPEG(3), "v1");
  assert.equal((await store.getTexture("r1", "wall:0")).version, "v1");
  await store.clearTextures("r1");
  assert.equal(await store.getTexture("r1", "wall:0"), null);
  assert.ok(await store.getTexture("r2", "floor"));
});

test("a backup file brings back the project, the layout and the photos, under new ids", async () => {
  const store = S.createStore(S.memoryBackend());
  const { project } = await sample(store);
  const file = await store.exportBackup(project.id);
  const other = S.createStore(S.memoryBackend());
  const loaded = await other.importBackup(file);
  assert.notEqual(loaded.id, project.id);
  assert.equal(loaded.name, "Haus <b>Nord</b>");
  assert.deepEqual(loaded.rooms.map((r) => r.name), ["Wohnzimmer", "Küche"]);
  assert.ok(loaded.rooms.every((r, i) => r.id !== project.rooms[i].id));
  const [la, lb] = loaded.rooms;
  assert.deepEqual(loaded.layouts[la.id], { x: 1, z: 2, rot: 0 });
  assert.deepEqual(loaded.layouts[lb.id], { x: 5, z: 2, rot: 90 });
  assert.equal(la.openings.length, 1);
  assert.equal(la.fov, 66);
  assert.equal(la.photoCount, 3);
  const photos = await other.getPhotos(la.id);
  assert.equal(photos.length, 3);
  assert.deepEqual([...photos[2].blob], [...JPEG(2)]);
  assert.deepEqual(photos[0].forward, [0, 0, -1]);
  assert.equal((await other.listProjects()).length, 1);
  assert.equal(C.polygonArea(S.roomOf(la).polygon), 12);
});

test("files that are not backups, or are damaged, are refused with a message", async () => {
  const store = S.createStore(S.memoryBackend());
  await assert.rejects(store.importBackup(new Uint8Array([1, 2, 3])), /keine raumo-Sicherung/);
  await assert.rejects(store.importBackup(X.zip([{ name: "other.txt", data: "x" }])), /keine raumo-Sicherung/);
  await assert.rejects(store.importBackup(X.zip([{ name: "raumo.json", data: "{not json" }])), /beschädigt/);
  await assert.rejects(store.importBackup(X.zip([{ name: "raumo.json", data: JSON.stringify({ app: "raumo", v: 99, project: {} }) }])), /neueren Version/);
  await assert.rejects(store.importBackup(X.zip([{ name: "raumo.json", data: JSON.stringify({ app: "raumo", v: 1, project: { rooms: [] } }) }])), /kein Raum/);
  assert.equal((await store.listProjects()).length, 0);
});

test("a backup from somebody else cannot smuggle in bad data", async () => {
  const store = S.createStore(S.memoryBackend());
  const bad = {
    app: "raumo", v: 1,
    project: {
      name: "x".repeat(500) + "‮\u0000", rooms: [
        { id: "a", name: "ok", polygon: [[0, 0], [4, 0], [4, 3], [0, 3]], height: 99, phoneHeight: -4, openings: [{ wall: 0, u0: -5, u1: 99, v0: 0, v1: 99, kind: "<script>" }, { wall: 77, u0: 0, u1: 1, v0: 0, v1: 1, kind: "door" }] },
        { id: "b", name: "bow tie", polygon: [[0, 0], [2, 2], [2, 0], [0, 2]], height: 2.5 },
        { id: "c", name: "far away", polygon: [[0, 0], [1e9, 0], [1e9, 5], [0, 5]], height: 2.5 },
        { id: "d", name: "NaN", polygon: [["x", "y"], [1, 0], [1, 1]], height: "high" },
        { id: "e", name: "two points", polygon: [[0, 0], [1, 0]], height: 2.5 },
      ],
      layouts: { a: { x: "1e9", z: 5, rot: -90 }, zzz: { x: 1, z: 1, rot: 1 } },
    },
    photos: { a: [
      { file: "photos/a_0.jpg", width: 100, height: 100, forward: [0, 0, -1], up: [0, 1, 0], position: [0, 1.4, 0] },
      { file: "photos/a_1.jpg", width: 100, height: 100, forward: [0, 0, -1], up: [0, 1, 0] },
      { file: "photos/a_2.jpg", width: 100, height: 100, forward: ["x", 0, 0], up: [0, 1, 0] },
      { file: "photos/missing.jpg", width: 100, height: 100, forward: [0, 0, -1], up: [0, 1, 0] },
      { file: "photos/a_4.jpg", width: 99999, height: 100, forward: [0, 0, -1], up: [0, 1, 0] },
    ] },
  };
  const file = X.zip([{ name: "raumo.json", data: JSON.stringify(bad) }, { name: "photos/a_0.jpg", data: JPEG(1) }, { name: "photos/a_1.jpg", data: new Uint8Array([1, 2, 3, 4]) },
    { name: "photos/a_2.jpg", data: JPEG(2) }, { name: "photos/a_4.jpg", data: JPEG(4) }]);
  const project = await store.importBackup(file);
  assert.equal(project.rooms.length, 1);
  assert.ok(project.name.length <= 80 && !/[‮\u0000]/.test(project.name));
  const room = project.rooms[0];
  assert.equal(room.height, 10);
  assert.ok(room.phoneHeight >= 0.3);
  assert.equal(room.openings.length, 1);
  assert.equal(room.openings[0].kind, "window");
  assert.equal(project.layouts[room.id].rot, 270);
  assert.equal(project.layouts[room.id].x, 0, "a layout that is not a number becomes 0");
  assert.equal(Object.keys(project.layouts).length, 1);
  assert.equal((await store.getPhotos(room.id)).length, 1);
});

test("names are cleaned and kept short", () => {
  assert.equal(S.cleanName("  Küche​\n", "x"), "Küche");
  assert.equal(S.cleanName("", "Raum"), "Raum");
  assert.equal(S.cleanName(null, "Raum"), "Raum");
  assert.equal(S.cleanName("y".repeat(200), "x").length, 80);
});

test("changing a room keeps its identity and marks it as changed", () => {
  const stored = S.newRoom("A", C.rectangleRoom(4, 3, 2.5));
  const bigger = S.withRoom(stored, C.scaleRoom(S.roomOf(stored), 1.1), { photoCount: 4 });
  assert.equal(bigger.id, stored.id);
  assert.equal(bigger.photoCount, 4);
  assert.ok(Math.abs(C.polygonArea(bigger.polygon) - 12 * 1.21) < 1e-9);
  assert.ok(bigger.updated >= stored.updated);
});

function someCloud(n = 300) {
  const positions = new Float32Array(n * 3), colors = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { positions[i * 3] = Math.sin(i); positions[i * 3 + 1] = (i % 20) * 0.1; positions[i * 3 + 2] = Math.cos(i); colors[i * 3] = i % 256; colors[i * 3 + 1] = 90; colors[i * 3 + 2] = 255 - (i % 256); }
  return { count: n, positions, colors };
}

test("a point cloud is kept by its id and comes back unchanged, and goes when its project goes", async () => {
  const store = S.createStore(S.memoryBackend());
  const project = S.newProject("Rundgang");
  const cloud = someCloud();
  const meta = S.newCloud("Wohnung", cloud, "walk");
  assert.equal(meta.count, 300);
  assert.equal(meta.source, "walk");
  assert.ok(meta.bounds.max[1] > meta.bounds.min[1]);
  project.clouds.push(meta);
  project.layouts[meta.id] = { x: 0, z: 0, rot: 0 };
  await store.saveProject(project);
  await store.putCloud(meta.id, cloud);
  const back = await store.getCloud(meta.id);
  assert.equal(back.count, 300);
  assert.deepEqual([...back.positions], [...cloud.positions]);
  assert.deepEqual([...back.colors], [...cloud.colors]);
  assert.equal(await store.getCloud("nothing"), null);
  await store.deleteProject(project.id);
  assert.equal(await store.getCloud(meta.id), null);
});

test("a backup with a point cloud brings it back in a new project", async () => {
  const store = S.createStore(S.memoryBackend());
  const project = S.newProject("Rundgang");
  const cloud = someCloud(500);
  const meta = S.newCloud("Wohnung", cloud, "walk");
  project.clouds.push(meta);
  project.layouts[meta.id] = { x: 2, z: 3, rot: 90 };
  const room = S.newRoom("Bad", C.rectangleRoom(2, 2, 2.4));
  project.rooms.push(room);
  project.layouts[room.id] = { x: 5, z: 0, rot: 0 };
  await store.saveProject(project);
  await store.putCloud(meta.id, cloud);
  const file = await store.exportBackup(project.id);
  const other = S.createStore(S.memoryBackend());
  const loaded = await other.importBackup(file);
  assert.equal(loaded.clouds.length, 1);
  assert.notEqual(loaded.clouds[0].id, meta.id);
  assert.equal(loaded.clouds[0].name, "Wohnung");
  assert.equal(loaded.clouds[0].count, 500);
  assert.deepEqual(loaded.layouts[loaded.clouds[0].id], { x: 2, z: 3, rot: 90 });
  const points = await other.getCloud(loaded.clouds[0].id);
  assert.equal(points.count, 500);
  for (let i = 0; i < 1500; i++) assert.ok(Math.abs(points.positions[i] - cloud.positions[i]) < 1e-6);
  assert.deepEqual([...points.colors], [...cloud.colors]);
  assert.equal(loaded.rooms.length, 1);
});

test("a project that is only a point cloud is a valid backup, and a missing or broken cloud file is dropped", async () => {
  const store = S.createStore(S.memoryBackend());
  const meta = { id: "c1", name: "Nur Wolke", source: "walk", count: 10, bounds: { min: [0, 0, 0], max: [1, 1, 1] } };
  const good = X.zip([{ name: "raumo.json", data: JSON.stringify({ app: "raumo", v: 1, project: { name: "x", rooms: [], clouds: [meta] } }) }, { name: "clouds/c1.ply", data: P.toPLY(someCloud(10)) }]);
  const project = await store.importBackup(good);
  assert.equal(project.clouds.length, 1);
  assert.equal(project.rooms.length, 0);
  const missing = X.zip([{ name: "raumo.json", data: JSON.stringify({ app: "raumo", v: 1, project: { name: "x", rooms: [], clouds: [meta] } }) }]);
  await assert.rejects(store.importBackup(missing), /kein Raum/);
  const broken = X.zip([{ name: "raumo.json", data: JSON.stringify({ app: "raumo", v: 1, project: { name: "x", rooms: [], clouds: [meta, { id: "c2", name: "<b>", source: "evil", bounds: "no" }] } }) }, { name: "clouds/c1.ply", data: new Uint8Array([1, 2, 3]) }]);
  await assert.rejects(store.importBackup(broken), /kein Raum/);
  const mixed = X.zip([{ name: "raumo.json", data: JSON.stringify({ app: "raumo", v: 1, project: { name: "x", rooms: [], clouds: [meta, { id: "c2", name: "<b>Zwei</b>", source: "evil", bounds: "no" }] } }) }, { name: "clouds/c1.ply", data: P.toPLY(someCloud(10)) }, { name: "clouds/c2.ply", data: P.toPLY(someCloud(20)) }]);
  const loaded = await store.importBackup(mixed);
  assert.equal(loaded.clouds.length, 2);
  assert.equal(loaded.clouds[1].source, "import");
  assert.deepEqual(loaded.clouds[1].bounds, { min: [0, 0, 0], max: [0, 0, 0] });
  assert.equal(loaded.clouds[1].name, "<b>Zwei</b>");
});
