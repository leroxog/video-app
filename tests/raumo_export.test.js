"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/raumo-core.js");
const X = require("../static/js/raumo-export.js");

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ""} ${a} != ${b}`);

const room = C.makeRoom({ polygon: [[-2, -1.5], [2, -1.5], [2, 1.5], [-2, 1.5]], height: 2.5, phoneHeight: 1.4, openings: [
  { wall: 0, u0: 1, u1: 2, v0: 0, v1: 2.05, kind: "door" }, { wall: 1, u0: 0.8, u1: 2.2, v0: 0.9, v1: 2.1, kind: "window" }] });
const second = C.makeRoom({ polygon: [[0, 0], [3, 0], [3, 2], [0, 2]], height: 2.4, openings: [] });
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);

const SCENE = [
  { name: "Wohnzimmer", room, layout: { x: 1, z: 2, rot: 0 }, textures: { "wall:0": { mime: "image/jpeg", bytes: JPEG }, "wall:2": { mime: "image/jpeg", bytes: JPEG }, floor: { mime: "image/jpeg", bytes: JPEG } } },
  { name: "Küche", room: second, layout: { x: 6, z: -1, rot: 90 }, textures: {} },
];

function readGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x46546c67, "magic");
  assert.equal(dv.getUint32(4, true), 2);
  assert.equal(dv.getUint32(8, true), bytes.length, "length in the header");
  const jsonLength = dv.getUint32(12, true);
  assert.equal(dv.getUint32(16, true), 0x4e4f534a);
  assert.equal(jsonLength % 4, 0);
  const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)));
  const at = 20 + jsonLength;
  const binLength = dv.getUint32(at, true);
  assert.equal(dv.getUint32(at + 4, true), 0x004e4942);
  assert.equal(binLength % 4, 0);
  assert.equal(at + 8 + binLength, bytes.length);
  return { json, bin: bytes.slice(at + 8, at + 8 + binLength) };
}

test("the CRC-32 of the standard test string", () => {
  assert.equal(X.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  assert.equal(X.crc32(new Uint8Array(0)), 0);
});

test("a ZIP has the right structure: entries, sizes, checksums, directory", () => {
  const files = [{ name: "a.txt", data: "hallo" }, { name: "b/ü.bin", data: new Uint8Array([1, 2, 3, 4]) }];
  const out = X.zip(files, new Date(2026, 9, 4, 12, 30, 20));
  const dv = new DataView(out.buffer);
  const end = out.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 2);
  const dirSize = dv.getUint32(end + 12, true), dirAt = dv.getUint32(end + 16, true);
  assert.equal(dirAt + dirSize, end);
  let at = dirAt;
  const seen = [];
  for (let i = 0; i < 2; i++) {
    assert.equal(dv.getUint32(at, true), 0x02014b50);
    const crc = dv.getUint32(at + 16, true), size = dv.getUint32(at + 20, true), nameLength = dv.getUint16(at + 28, true), local = dv.getUint32(at + 42, true);
    const name = new TextDecoder().decode(out.slice(at + 46, at + 46 + nameLength));
    assert.equal(dv.getUint32(local, true), 0x04034b50);
    const dataAt = local + 30 + dv.getUint16(local + 26, true);
    assert.equal(X.crc32(out.slice(dataAt, dataAt + size)), crc);
    seen.push([name, size]);
    at += 46 + nameLength;
  }
  assert.deepEqual(seen, [["a.txt", 5], ["b/ü.bin", 4]]);
});

test("the GLB is a well formed glTF 2.0 file", () => {
  const { json, bin } = readGLB(X.toGLB(SCENE));
  assert.equal(json.asset.version, "2.0");
  assert.equal(json.scenes[0].nodes.length, 2);
  assert.equal(json.meshes.length, 2);
  assert.equal(json.buffers[0].byteLength, bin.length);
  for (const view of json.bufferViews) {
    assert.ok(view.byteOffset + view.byteLength <= bin.length, "buffer view inside the buffer");
    assert.equal(view.byteOffset % 4, 0, "aligned");
  }
  for (const a of json.accessors) {
    const view = json.bufferViews[a.bufferView];
    const bytes = { 5126: 4, 5123: 2, 5125: 4 }[a.componentType] * { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type] * a.count;
    assert.equal(bytes, view.byteLength, "accessor size");
  }
  for (const mesh of json.meshes) {
    for (const p of mesh.primitives) {
      const count = json.accessors[p.attributes.POSITION].count;
      assert.equal(json.accessors[p.attributes.NORMAL].count, count);
      assert.equal(json.accessors[p.attributes.TEXCOORD_0].count, count);
      const index = json.accessors[p.indices];
      assert.equal(index.count % 3, 0);
      const view = json.bufferViews[index.bufferView];
      const typed = index.componentType === 5123 ? new Uint16Array(bin.buffer, bin.byteOffset + view.byteOffset, index.count) : new Uint32Array(bin.buffer, bin.byteOffset + view.byteOffset, index.count);
      for (const i of typed) assert.ok(i < count);
      assert.ok(json.materials[p.material]);
    }
  }
});

test("positions are in metres, bounds are right, rooms are moved and turned into place", () => {
  const { json, bin } = readGLB(X.toGLB(SCENE));
  const mesh = json.meshes[0];
  const pos = json.accessors[mesh.primitives[0].attributes.POSITION];
  const view = json.bufferViews[pos.bufferView];
  const floats = new Float32Array(bin.buffer.slice(bin.byteOffset + view.byteOffset, bin.byteOffset + view.byteOffset + view.byteLength));
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < floats.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], floats[i + k]); hi[k] = Math.max(hi[k], floats[i + k]); }
  pos.min.forEach((m, k) => near(m, lo[k], 1e-5));
  pos.max.forEach((m, k) => near(m, hi[k], 1e-5));
  const node0 = json.nodes[0], node1 = json.nodes[1];
  assert.deepEqual(node0.translation, [1, 0, 2]);
  near(node1.rotation[1], Math.sin(-Math.PI / 4), 1e-9);
  near(node1.rotation[3], Math.cos(-Math.PI / 4), 1e-9);
  // a point of the second room, turned 90 degrees the way raumo turns it, must be where the node's quaternion puts it
  const q = node1.rotation, p = [3, 0, 0];
  const theta = 2 * Math.atan2(q[1], q[3]);
  const gl = [p[0] * Math.cos(theta) + p[2] * Math.sin(theta), p[1], -p[0] * Math.sin(theta) + p[2] * Math.cos(theta)];
  const ours = C.placePoint({ x: 0, z: 0, rot: 90 }, [p[0], p[2]]);
  near(gl[0], ours[0], 1e-9); near(gl[2], ours[1], 1e-9);
});

test("the pictures go into the file and only the surfaces that have one use them", () => {
  const { json, bin } = readGLB(X.toGLB(SCENE));
  assert.equal(json.images.length, 3);
  assert.equal(json.textures.length, 3);
  for (const image of json.images) {
    assert.equal(image.mimeType, "image/jpeg");
    const view = json.bufferViews[image.bufferView];
    assert.deepEqual([...bin.slice(view.byteOffset, view.byteOffset + 4)], [0xff, 0xd8, 0xff, 0xe0]);
    assert.equal(view.byteLength, JPEG.length);
  }
  const textured = json.materials.filter((m) => m.pbrMetallicRoughness.baseColorTexture);
  assert.equal(textured.length, 3);
  const plain = readGLB(X.toGLB([{ name: "x", room, layout: { x: 0, z: 0, rot: 0 } }]));
  assert.equal(plain.json.images, undefined);
});

test("without a closed outside the model has fewer parts", () => {
  const withOuter = readGLB(X.toGLB(SCENE)).json.meshes[0].primitives.length;
  const without = readGLB(X.toGLB(SCENE, { outer: false })).json.meshes[0].primitives.length;
  assert.ok(withOuter > without);
});

test("the OBJ model has matching counts, valid faces and its material file", () => {
  const model = X.toOBJ(SCENE);
  const lines = model.obj.split("\n");
  const count = (prefix) => lines.filter((l) => l.startsWith(prefix + " ")).length;
  const v = count("v"), vt = count("vt"), vn = count("vn");
  assert.equal(v, vt);
  assert.equal(v, vn);
  assert.ok(lines.includes("mtllib raumo.mtl"));
  for (const l of lines.filter((l) => l.startsWith("f "))) {
    for (const part of l.slice(2).split(" ")) {
      const [a, b, c] = part.split("/").map(Number);
      assert.ok(a >= 1 && a <= v && b >= 1 && b <= vt && c >= 1 && c <= vn, l);
    }
  }
  const used = new Set(lines.filter((l) => l.startsWith("usemtl ")).map((l) => l.slice(7)));
  for (const name of used) assert.ok(model.mtl.includes(`newmtl ${name}\n`), name);
  assert.equal(model.files.length, 3);
  assert.ok(model.mtl.includes("map_Kd Wohnzimmer_1_wall_0.jpg") && model.files.some((f) => f.name === "Wohnzimmer_1_floor.jpg"));
  assert.ok(/^[\x20-\x7e\n]*$/.test(model.obj + model.mtl), "plain ASCII, whatever the rooms are called");
  const archive = X.toOBJZip(SCENE);
  assert.equal(new DataView(archive.buffer).getUint16(archive.length - 22 + 10, true), 2 + model.files.length);
});

test("the floor plan is an SVG with the rooms, the walls, the openings and the numbers", () => {
  const svg = X.planSVG(SCENE, { title: "Test <&>" });
  assert.ok(svg.startsWith("<svg xmlns=") && svg.endsWith("</svg>"));
  assert.ok(svg.includes("<title>Test &lt;&amp;&gt;</title>"));
  assert.ok(svg.includes("Wohnzimmer") && svg.includes("Küche"));
  assert.ok(svg.includes("12,0 m²") && svg.includes("6,0 m²"));
  assert.ok(svg.includes("4,00 m") && svg.includes("3,00 m"));
  assert.equal((svg.match(/data-opening=/g) || []).length, 2);
  assert.ok(svg.includes('fill-rule="evenodd"'));
  assert.ok(!svg.includes("NaN") && !svg.includes("undefined") && !svg.includes("Infinity"));
  const bare = X.planSVG(SCENE, { dimensions: false, names: false });
  assert.ok(!bare.includes(">Wohnzimmer<") && !bare.includes(">4,00 m<"));
  assert.ok(X.planSVG([]).includes("viewBox"));
});

test("room names cannot break out of the drawing", () => {
  const evil = [{ name: '"><script>alert(1)</script>', room, layout: { x: 0, z: 0, rot: 0 } }];
  const svg = X.planSVG(evil);
  assert.ok(!svg.includes("<script>"));
  assert.ok(!X.toOBJ(evil).obj.includes("<"));
});

test("a ZIP can be read back, and damaged or foreign ones are refused", () => {
  const files = [{ name: "a.txt", data: "hallo" }, { name: "ü/b.bin", data: new Uint8Array([9, 8, 7]) }, { name: "leer", data: "" }];
  const back = X.unzip(X.zip(files));
  assert.deepEqual(back.map((f) => f.name), ["a.txt", "ü/b.bin", "leer"]);
  assert.equal(new TextDecoder().decode(back[0].data), "hallo");
  assert.deepEqual([...back[1].data], [9, 8, 7]);
  const bad = X.zip(files);
  bad[36] ^= 0xff;                                                  // flip a byte inside the data
  assert.throws(() => X.unzip(bad));
  assert.throws(() => X.unzip(new Uint8Array(10)));
  assert.throws(() => X.unzip(new TextEncoder().encode("PK this is not a zip file at all, but long enough to try")));
  const truncated = X.zip(files).slice(0, 60);
  assert.throws(() => X.unzip(truncated));
  const evil = X.unzip(X.zip([{ name: "../outside.txt", data: "x" }, { name: "ok.txt", data: "y" }]));
  assert.deepEqual(evil.map((f) => f.name), ["ok.txt"]);
});
