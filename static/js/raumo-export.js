/* raumo export: turns scanned rooms into files other programs read -- a 3D model as GLB (one file, with the photos inside; opens in
   Windows 3D Viewer, Blender, Apple Quick Look, most web viewers), a model as OBJ with its pictures in a ZIP, and the floor plan as an
   SVG drawing.  Pure functions that run in the browser and in Node.

   A "scene" is a list of {name, room, layout, textures}: the room (see raumo-core), where it stands in the building (x, z, rot) and the
   baked pictures by surface name ("wall:0", "floor", ...) as {mime, bytes}. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./raumo-core.js"));
  else root.RaumoExport = factory(root.RaumoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  const encoder = new TextEncoder();
  const DEG = Math.PI / 180;

  // The colours of the parts that have no photo (red, green, blue, alpha, 0..1).
  const COLORS = {
    wall: [0.93, 0.92, 0.89, 1], floor: [0.74, 0.66, 0.55, 1], ceiling: [0.97, 0.97, 0.96, 1],
    reveal: [0.86, 0.85, 0.82, 1], cap: [0.55, 0.55, 0.56, 1], outer: [0.72, 0.72, 0.73, 1],
  };
  const KIND_NAMES = { wall: "Wand", floor: "Boden", ceiling: "Decke", reveal: "Laibung", cap: "Wandkopf", outer: "Außenseite" };

  const rotate = (layout, [x, y, z]) => {
    const p = Core.placePoint(layout, [x, z]);
    return [p[0], y, p[1]];
  };

  /* Everything a room is made of, with the building's place already applied: [{surface, positions, normals}] where
     surface.id is the picture's name. */
  function placedSurfaces(entry, outer = true) {
    return Core.buildRoomSurfaces(entry.room, { outer }).map((surface) => {
      const layout = entry.layout || { x: 0, z: 0, rot: 0 };
      const positions = [], normals = [];
      for (let i = 0; i < surface.positions.length; i += 3) {
        positions.push(...rotate(layout, surface.positions.slice(i, i + 3)));
        const n = Core.placePoint({ x: 0, z: 0, rot: layout.rot || 0 }, [surface.normals[i], surface.normals[i + 2]]);
        normals.push(n[0], surface.normals[i + 1], n[1]);
      }
      return { surface, positions, normals };
    });
  }

  // ------------------------------------------------------------------------------------------------ binary
  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc32.table[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crc32.table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const toBytes = (data) => (typeof data === "string" ? encoder.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data));

  /* A ZIP archive without compression (the pictures are JPEGs already).  `files` is [{name, data}], data a string or bytes. */
  function zip(files, when = new Date()) {
    const time = ((when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1)) & 0xffff;
    const day = (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate()) & 0xffff;
    const parts = [], central = [];
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = toBytes(file.data);
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
      lv.setUint16(10, time, true); lv.setUint16(12, day, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      local.set(name, 30);
      parts.push(local, data);
      const entry = new Uint8Array(46 + name.length);
      const cv = new DataView(entry.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, time, true); cv.setUint16(14, day, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      entry.set(name, 46);
      central.push(entry);
      offset += local.length + data.length;
    }
    const size = central.reduce((s, e) => s + e.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
    return concat([...parts, ...central, end]);
  }

  /* Reads a ZIP made by `zip` above (stored, not compressed): [{name, data}].  Throws on anything else or on a damaged file. */
  function unzip(bytes, limit = 400 * 1024 * 1024) {
    if (bytes.length < 22 || bytes.length > limit) throw new Error("zip: size");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = -1;
    for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 65535); at--) if (dv.getUint32(at, true) === 0x06054b50) { end = at; break; }
    if (end < 0) throw new Error("zip: no directory");
    const count = dv.getUint16(end + 10, true), dirAt = dv.getUint32(end + 16, true);
    const out = [];
    let at = dirAt, total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > bytes.length || dv.getUint32(at, true) !== 0x02014b50) throw new Error("zip: directory");
      const method = dv.getUint16(at + 10, true), crc = dv.getUint32(at + 16, true), packed = dv.getUint32(at + 20, true), size = dv.getUint32(at + 24, true);
      const nameLength = dv.getUint16(at + 28, true), extraLength = dv.getUint16(at + 30, true), commentLength = dv.getUint16(at + 32, true), local = dv.getUint32(at + 42, true);
      if (method !== 0 || packed !== size) throw new Error("zip: compressed");
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      if (local + 30 > bytes.length || dv.getUint32(local, true) !== 0x04034b50) throw new Error("zip: entry");
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      if (start + size > bytes.length) throw new Error("zip: truncated");
      total += size;
      if (total > limit) throw new Error("zip: size");
      const data = bytes.slice(start, start + size);
      if (crc32(data) !== crc) throw new Error("zip: checksum");
      if (!name.endsWith("/") && !name.includes("..") && !name.startsWith("/") && !name.includes("\\")) out.push({ name, data });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return out;
  }

  function concat(chunks) {
    const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  // -------------------------------------------------------------------------------------------------- glTF
  /* A GLB (binary glTF 2.0) file for the scene. Units are metres, y is up. */
  function toGLB(scene, options = {}) {
    const json = {
      asset: { version: "2.0", generator: "raumo" },
      scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [],
      textures: [], images: [], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }], buffers: [],
    };
    const chunks = [];
    let size = 0;
    const view = (bytes, target) => {
      const pad = (4 - (size % 4)) % 4;
      if (pad) { chunks.push(new Uint8Array(pad)); size += pad; }
      json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: bytes.length, ...(target ? { target } : {}) });
      chunks.push(bytes);
      size += bytes.length;
      return json.bufferViews.length - 1;
    };
    const accessor = (typed, componentType, type, target, withBounds) => {
      const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
      const entry = { bufferView: view(bytes, target), componentType, count: typed.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3 }[type]), type };
      if (withBounds) {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < typed.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], typed[i + k]); max[k] = Math.max(max[k], typed[i + k]); }
        entry.min = min; entry.max = max;
      }
      json.accessors.push(entry);
      return json.accessors.length - 1;
    };
    const shared = {};
    const material = (key, make) => {
      if (shared[key] === undefined) { json.materials.push(make()); shared[key] = json.materials.length - 1; }
      return shared[key];
    };
    const flat = (kind) => material(kind, () => ({ name: KIND_NAMES[kind], pbrMetallicRoughness: { baseColorFactor: COLORS[kind], metallicFactor: 0, roughnessFactor: 0.9 } }));
    const textured = (label, texture) => {
      json.images.push({ bufferView: view(toBytes(texture.bytes)), mimeType: texture.mime });
      json.textures.push({ sampler: 0, source: json.images.length - 1 });
      json.materials.push({ name: label, pbrMetallicRoughness: { baseColorTexture: { index: json.textures.length - 1 }, metallicFactor: 0, roughnessFactor: 0.9 } });
      return json.materials.length - 1;
    };

    for (const entry of scene) {
      const primitives = [];
      for (const { surface, positions, normals } of placedSurfaces({ ...entry, layout: { x: 0, z: 0, rot: 0 } }, options.outer !== false)) {
        const count = positions.length / 3;
        const indices = count > 65535 ? new Uint32Array(surface.indices) : new Uint16Array(surface.indices);
        const picture = entry.textures && entry.textures[surface.id];
        primitives.push({
          attributes: {
            POSITION: accessor(new Float32Array(positions), 5126, "VEC3", 34962, true),
            NORMAL: accessor(new Float32Array(normals), 5126, "VEC3", 34962, false),
            TEXCOORD_0: accessor(new Float32Array(surface.uvs), 5126, "VEC2", 34962, false),
          },
          indices: accessor(indices, count > 65535 ? 5125 : 5123, "SCALAR", 34963, false),
          material: picture && surface.kind !== "outer" ? textured(`${entry.name} ${surface.id}`, picture) : flat(surface.kind),
        });
      }
      json.meshes.push({ name: entry.name, primitives });
      const layout = entry.layout || { x: 0, z: 0, rot: 0 };
      const angle = -(layout.rot || 0) * DEG;                         // our turn is clockwise seen from above, glTF's is counter-clockwise
      json.nodes.push({ name: entry.name, mesh: json.meshes.length - 1, translation: [layout.x || 0, 0, layout.z || 0], rotation: [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)] });
      json.scenes[0].nodes.push(json.nodes.length - 1);
    }
    if (!json.images.length) { delete json.images; delete json.textures; delete json.samplers; }
    const pad = (4 - (size % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); size += pad; }
    json.buffers.push({ byteLength: size });
    const bin = concat(chunks);

    const text = encoder.encode(JSON.stringify(json));
    const jsonPad = (4 - (text.length % 4)) % 4;
    const jsonChunk = new Uint8Array(text.length + jsonPad).fill(0x20);
    jsonChunk.set(text);
    const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonChunk.length, true); dv.setUint32(16, 0x4e4f534a, true);
    out.set(jsonChunk, 20);
    const at = 20 + jsonChunk.length;
    dv.setUint32(at, bin.length, true); dv.setUint32(at + 4, 0x004e4942, true);
    out.set(bin, at + 8);
    return out;
  }

  // --------------------------------------------------------------------------------------------------- OBJ
  const UMLAUTS = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };
  const safe = (text) => String(text).replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c]).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "raum";

  /* The OBJ model with its material file and the pictures: {obj, mtl, files: [{name, data}]}.  Put all of them in one folder. */
  function toOBJ(scene, options = {}) {
    const lines = ["# raumo", "mtllib raumo.mtl"], mtl = [];
    const files = [];
    const made = new Set();
    let v = 0;
    scene.forEach((entry, e) => {
      const label = `${safe(entry.name)}_${e + 1}`;
      lines.push(`o ${label}`);
      for (const { surface, positions, normals } of placedSurfaces(entry, options.outer !== false)) {
        const name = `${label}_${safe(surface.id)}`;
        const picture = entry.textures && entry.textures[surface.id];
        if (!made.has(name)) {
          made.add(name);
          const color = COLORS[surface.kind];
          mtl.push(`newmtl ${name}`, `Kd ${color[0].toFixed(3)} ${color[1].toFixed(3)} ${color[2].toFixed(3)}`, "Ka 0 0 0", "Ks 0 0 0", "illum 1");
          if (picture && surface.kind !== "outer") {
            const file = `${name}.${picture.mime === "image/png" ? "png" : "jpg"}`;
            files.push({ name: file, data: toBytes(picture.bytes) });
            mtl.push(`map_Kd ${file}`);
          }
          mtl.push("");
        }
        lines.push(`g ${name}`, `usemtl ${name}`);
        for (let i = 0; i < positions.length; i += 3) lines.push(`v ${positions[i].toFixed(5)} ${positions[i + 1].toFixed(5)} ${positions[i + 2].toFixed(5)}`);
        for (let i = 0; i < normals.length; i += 3) lines.push(`vn ${normals[i].toFixed(5)} ${normals[i + 1].toFixed(5)} ${normals[i + 2].toFixed(5)}`);
        for (let i = 0; i < surface.uvs.length; i += 2) lines.push(`vt ${surface.uvs[i].toFixed(5)} ${(1 - surface.uvs[i + 1]).toFixed(5)}`);
        for (let i = 0; i < surface.indices.length; i += 3) {
          const f = [0, 1, 2].map((k) => { const n = surface.indices[i + k] + 1 + v; return `${n}/${n}/${n}`; });
          lines.push(`f ${f.join(" ")}`);
        }
        v += positions.length / 3;
      }
    });
    return { obj: lines.join("\n") + "\n", mtl: mtl.join("\n"), files };
  }

  /* The OBJ model and everything it needs in one ZIP file. */
  function toOBJZip(scene, options = {}) {
    const model = toOBJ(scene, options);
    return zip([{ name: "raumo.obj", data: model.obj }, { name: "raumo.mtl", data: model.mtl }, ...model.files]);
  }

  // --------------------------------------------------------------------------------------------- floor plan
  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (x) => (Math.round(x * 1000) / 1000).toString();
  const metres = (x) => `${(Math.round(x * 100) / 100).toFixed(2).replace(".", ",")} m`;
  const pathOf = (poly) => `M${poly.map((p) => `${num(p[0])} ${num(p[1])}`).join("L")}Z`;

  /* The floor plan as an SVG drawing (one unit is one metre).  Walls have their thickness; doors show their swing, windows three
     lines; every wall has its length, every room its name and its area.  Options: dimensions (true), names (true), theme "light" | "dark". */
  function planSVG(scene, options = {}) {
    const dark = options.theme === "dark";
    const ink = dark ? "#e8e8ea" : "#1c1c1e", paper = dark ? "#17171a" : "#ffffff", floor = dark ? "#26262b" : "#f3f1ec", wallColor = dark ? "#d8d8dc" : "#2a2a2e", faint = dark ? "#8a8a92" : "#8a8a8f";
    const dimensions = options.dimensions !== false, names = options.names !== false;
    const parts = [];
    let box = null;
    const grow = (poly) => {
      const b = Core.bounds(poly);
      box = box ? { minX: Math.min(box.minX, b.minX), minZ: Math.min(box.minZ, b.minZ), maxX: Math.max(box.maxX, b.maxX), maxZ: Math.max(box.maxZ, b.maxZ) } : b;
    };
    for (const entry of scene) {
      const layout = entry.layout || { x: 0, z: 0, rot: 0 };
      const room = entry.room;
      const at = (p) => Core.placePoint(layout, p);
      const inner = room.polygon.map(at);
      const outer = Core.offsetPolygon(room.polygon, room.thickness).map(at);
      grow(outer);
      parts.push(`<g data-room="${esc(entry.name)}"${entry.id ? ` data-id="${esc(entry.id)}"` : ""}>`);
      parts.push(`<path d="${pathOf(inner)}" fill="${floor}"/>`);
      const walls = Core.wallsOf(room.polygon);
      for (const o of room.openings) {
        const w = walls[o.wall];
        const out = [-w.inward[0], -w.inward[1]];
        const pt = (u, depth) => at([w.a[0] + w.dir[0] * u + out[0] * depth, w.a[1] + w.dir[1] * u + out[1] * depth]);
        const gap = [pt(o.u0, -0.01), pt(o.u1, -0.01), pt(o.u1, room.thickness + 0.01), pt(o.u0, room.thickness + 0.01)];
        parts.push(`<path d="${pathOf(gap)}" fill="${paper}" data-opening="${o.kind}"/>`);
      }
      parts.push(`<path d="${pathOf(inner)}${pathOf(outer)}" fill="${wallColor}" fill-rule="evenodd"/>`);
      for (const o of room.openings) {
        const w = walls[o.wall];
        const out = [-w.inward[0], -w.inward[1]];
        const pt = (u, depth) => at([w.a[0] + w.dir[0] * u + out[0] * depth, w.a[1] + w.dir[1] * u + out[1] * depth]);
        if (o.kind === "window") {
          for (const d of [0, room.thickness / 2, room.thickness]) {
            const a = pt(o.u0, d), b = pt(o.u1, d);
            parts.push(`<path d="M${num(a[0])} ${num(a[1])}L${num(b[0])} ${num(b[1])}" stroke="${ink}" stroke-width="0.02" fill="none"/>`);
          }
        } else if (o.kind === "door") {
          const width = o.u1 - o.u0;
          const hinge = pt(o.u0, 0), closed = pt(o.u1, 0);
          const leaf = at([w.a[0] + w.dir[0] * o.u0 + w.inward[0] * width, w.a[1] + w.dir[1] * o.u0 + w.inward[1] * width]);
          parts.push(`<path d="M${num(hinge[0])} ${num(hinge[1])}L${num(leaf[0])} ${num(leaf[1])}M${num(closed[0])} ${num(closed[1])}A${num(width)} ${num(width)} 0 0 1 ${num(leaf[0])} ${num(leaf[1])}" stroke="${ink}" stroke-width="0.02" fill="none"/>`);
        }
      }
      if (dimensions) {
        for (const w of walls) {
          if (w.len < 0.6) continue;
          const mid = at([w.a[0] + w.dir[0] * w.len / 2 + w.inward[0] * 0.2, w.a[1] + w.dir[1] * w.len / 2 + w.inward[1] * 0.2]);
          const from = at(w.a), to = at(w.b);
          const angle = Math.atan2(to[1] - from[1], to[0] - from[0]) / DEG;
          const flip = angle > 90 || angle < -90 ? angle + 180 : angle;
          parts.push(`<text x="${num(mid[0])}" y="${num(mid[1])}" transform="rotate(${num(flip)} ${num(mid[0])} ${num(mid[1])})" font-size="0.17" text-anchor="middle" dominant-baseline="middle" fill="${faint}" font-family="sans-serif">${esc(metres(w.len))}</text>`);
        }
      }
      if (names) {
        const c = at(Core.centroid(room.polygon));
        parts.push(`<text x="${num(c[0])}" y="${num(c[1] - 0.05)}" font-size="0.28" font-weight="700" text-anchor="middle" fill="${ink}" font-family="sans-serif">${esc(entry.name)}</text>`);
        parts.push(`<text x="${num(c[0])}" y="${num(c[1] + 0.3)}" font-size="0.2" text-anchor="middle" fill="${faint}" font-family="sans-serif">${esc(`${(Math.round(Core.polygonArea(room.polygon) * 10) / 10).toFixed(1).replace(".", ",")} m²`)}</text>`);
      }
      if (entry.selected) parts.push(`<path d="${pathOf(outer)}" fill="none" stroke="#ffb347" stroke-width="0.07" stroke-linejoin="round" data-selected="1"/>`);
      parts.push("</g>");
    }
    if (!box) box = { minX: 0, minZ: 0, maxX: 4, maxZ: 3 };
    const margin = 0.8;
    const x = box.minX - margin, y = box.minZ - margin, w = box.maxX - box.minX + 2 * margin, h = box.maxZ - box.minZ + 2 * margin + 0.6;
    const bar = `<g><path d="M${num(x + margin)} ${num(y + h - 0.45)}h1" stroke="${ink}" stroke-width="0.04"/><path d="M${num(x + margin)} ${num(y + h - 0.52)}v0.14M${num(x + margin + 1)} ${num(y + h - 0.52)}v0.14" stroke="${ink}" stroke-width="0.03"/><text x="${num(x + margin + 1.1)}" y="${num(y + h - 0.4)}" font-size="0.17" fill="${faint}" font-family="sans-serif">1 m</text></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x)} ${num(y)} ${num(w)} ${num(h)}" width="${Math.round(w * 100)}" height="${Math.round(h * 100)}" role="img"><title>${esc(options.title || "Grundriss")}</title><rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" fill="${paper}"/>${parts.join("")}${bar}</svg>`;
  }

  return { COLORS, crc32, zip, unzip, concat, toGLB, toOBJ, toOBJZip, planSVG, placedSurfaces, safe, metres };
});
