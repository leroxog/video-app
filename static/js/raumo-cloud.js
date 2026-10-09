/* raumo cloud: point clouds.  A cloud is a list of points, each with a place (metres) and the colour that was seen there.  This file makes
   them from scans, keeps one point for every 5 cm cube of space (a "voxel grid"), and reads and writes the common file formats (PLY, XYZ,
   LAS).  It also turns the depth pictures of a walk through a room into points, and a measured room (walls, floor, ceiling) into points.
   Pure functions that run in the browser and in Node.

   A cloud in memory: {count, positions: Float32Array(3 * count), colors: Uint8Array(3 * count)}.  World: x east, y up, z south. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./raumo-core.js"));
  else root.RaumoCloud = factory(root.RaumoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  const SPACING = 0.05;                                  // one point for every 5 cm
  const MAX_POINTS = 6000000;

  // ------------------------------------------------------------------------------------------- voxel grid
  /* Keeps one point per cube of side `size`: the average place and colour of everything seen in that cube.  A point is only handed out
     once it was seen `minHits` times, which throws away the single wrong readings that depth sensors make now and then. */
  class VoxelGrid {
    constructor(size = SPACING, minHits = 2) {
      this.size = size;
      this.shift = [0.0137 * size / SPACING, 0.0211 * size / SPACING, 0.0089 * size / SPACING];   // walls often lie exactly on multiples of 5 cm: keep the cube edges off them
      this.minHits = minHits;
      this.cells = new Map();
      this.visible = 0;
      this.added = [];                                   // cells that just became visible (for drawing while scanning)
    }

    /* The cube a place is in, as one number (which is also the key of `cells`). */
    cellKey(x, y, z) {
      const s = this.size, sh = this.shift;
      return this.key(Math.floor((x + sh[0]) / s), Math.floor((y + sh[1]) / s), Math.floor((z + sh[2]) / s));
    }

    key(ix, iy, iz) { return (ix + 32768) * 4294967296 + (iy + 2048) * 65536 + (iz + 32768); }      // fits in a double: x 16 bit, y 12 bit, z 16 bit

    /* One reading: place and colour (0..255), optionally how much to trust it (weight: it counts that much in the average, but is always
       one sighting for `minHits`). */
    add(x, y, z, r, g, b, weight = 1) {
      const s = this.size, sh = this.shift;
      const ix = Math.floor((x + sh[0]) / s), iy = Math.floor((y + sh[1]) / s), iz = Math.floor((z + sh[2]) / s);
      if (ix < -32768 || ix > 32767 || iy < -2048 || iy > 2047 || iz < -32768 || iz > 32767) return false;
      const k = this.key(ix, iy, iz);
      let c = this.cells.get(k);
      if (!c) { c = { n: 0, hits: 0, x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, shown: false }; this.cells.set(k, c); }
      c.n += weight; c.hits += 1; c.x += x * weight; c.y += y * weight; c.z += z * weight; c.r += r * weight; c.g += g * weight; c.b += b * weight;
      if (!c.shown && c.hits >= this.minHits) { c.shown = true; this.visible += 1; this.added.push(c); }
      return true;
    }

    /* The points that became visible since the last call: [{x, y, z, r, g, b}] */
    takeNew() {
      const out = this.added.map((c) => ({ x: c.x / c.n, y: c.y / c.n, z: c.z / c.n, r: c.r / c.n, g: c.g / c.n, b: c.b / c.n }));
      this.added = [];
      return out;
    }

    toCloud() {
      const n = this.visible;
      const positions = new Float32Array(n * 3), colors = new Uint8Array(n * 3);
      let i = 0;
      for (const c of this.cells.values()) {
        if (!c.shown) continue;
        positions[i * 3] = c.x / c.n; positions[i * 3 + 1] = c.y / c.n; positions[i * 3 + 2] = c.z / c.n;
        colors[i * 3] = c.r / c.n; colors[i * 3 + 1] = c.g / c.n; colors[i * 3 + 2] = c.b / c.n;
        i++;
      }
      return { count: n, positions, colors };
    }
  }

  // ------------------------------------------------------------------------------------------------ clouds
  function emptyCloud() { return { count: 0, positions: new Float32Array(0), colors: new Uint8Array(0) }; }

  function boundsOf(cloud) {
    if (!cloud.count) return { min: [0, 0, 0], max: [0, 0, 0] };
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const p = cloud.positions;
    for (let i = 0; i < cloud.count; i++) for (let k = 0; k < 3; k++) { const v = p[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    return { min, max };
  }

  /* Several clouds as one; `layouts[i]` ({x, z, rot}) moves and turns cloud i (like a room in a building) if given. */
  function mergeClouds(clouds, layouts) {
    const total = clouds.reduce((s, c) => s + c.count, 0);
    const positions = new Float32Array(total * 3), colors = new Uint8Array(total * 3);
    let at = 0;
    clouds.forEach((c, i) => {
      const layout = layouts && layouts[i];
      const r = layout ? (layout.rot || 0) * Core.DEG : 0, cs = Math.cos(r), sn = Math.sin(r);
      for (let j = 0; j < c.count; j++) {
        const x = c.positions[j * 3], y = c.positions[j * 3 + 1], z = c.positions[j * 3 + 2];
        if (layout) { positions[(at + j) * 3] = layout.x + x * cs - z * sn; positions[(at + j) * 3 + 1] = y; positions[(at + j) * 3 + 2] = layout.z + x * sn + z * cs; }
        else { positions[(at + j) * 3] = x; positions[(at + j) * 3 + 1] = y; positions[(at + j) * 3 + 2] = z; }
      }
      colors.set(c.colors.subarray(0, c.count * 3), at * 3);
      at += c.count;
    });
    return { count: total, positions, colors };
  }

  /* One point for every cube of side `size` (the average of those inside), for clouds that are denser than that. */
  function voxelize(cloud, size = SPACING, minHits = 1) {
    const grid = new VoxelGrid(size, minHits);
    for (let i = 0; i < cloud.count; i++) grid.add(cloud.positions[i * 3], cloud.positions[i * 3 + 1], cloud.positions[i * 3 + 2], cloud.colors[i * 3], cloud.colors[i * 3 + 1], cloud.colors[i * 3 + 2]);
    return grid.toCloud();
  }

  // --------------------------------------------------------------------------------------- from a depth picture
  /* A walk through a room gives, many times a second, a camera (where it is, which way it looks, how wide it sees), a picture of
     distances and a picture of colours.  This turns them into points.

     frame = {
       camera: {position, forward, up, right, tanX, tanY},      // as Core.makeCamera: the lens looks along forward, tanX/tanY = tan of half the field of view
       depth: {width, height, data: Float32Array in metres},     // distance along `forward`, row 0 at the top; 0 or NaN = unknown
       color: {width, height, data: Uint8ClampedArray RGBA} | null
     } */
  const DEFAULTS = { stride: 2, near: 0.3, far: 5, edge: 0.1 };

  function unproject(frame, options = {}) {
    const o = { ...DEFAULTS, ...options };
    const { camera, depth, color } = frame;
    const out = [];
    const W = depth.width, H = depth.height, d = depth.data;
    for (let y = o.stride; y < H - o.stride; y += o.stride) {
      for (let x = o.stride; x < W - o.stride; x += o.stride) {
        const z = d[y * W + x];
        if (!(z > o.near && z < o.far)) continue;
        // a jump in distance next to this pixel means an edge, where depth sensors smear: skip it
        const l = d[y * W + x - o.stride], r = d[y * W + x + o.stride], u = d[(y - o.stride) * W + x], dn = d[(y + o.stride) * W + x];
        if (!(Math.abs(l - z) < o.edge * z && Math.abs(r - z) < o.edge * z && Math.abs(u - z) < o.edge * z && Math.abs(dn - z) < o.edge * z)) continue;
        const nx = ((x + 0.5) / W) * 2 - 1, ny = 1 - ((y + 0.5) / H) * 2;
        const px = (nx + (camera.cx || 0)) * camera.tanX, py = (ny + (camera.cy || 0)) * camera.tanY;      // (cx, cy: the middle of the lens is not always the middle of the picture)
        const ray = [camera.forward[0] + camera.right[0] * px + camera.up[0] * py, camera.forward[1] + camera.right[1] * px + camera.up[1] * py, camera.forward[2] + camera.right[2] * px + camera.up[2] * py];
        let rgb = [128, 128, 128];
        if (color) {
          const cx = Math.min(color.width - 1, Math.floor((x + 0.5) / W * color.width)), cy = Math.min(color.height - 1, Math.floor((y + 0.5) / H * color.height));
          const i = (cy * color.width + cx) * 4;
          rgb = [color.data[i], color.data[i + 1], color.data[i + 2]];
        }
        out.push([camera.position[0] + ray[0] * z, camera.position[1] + ray[1] * z, camera.position[2] + ray[2] * z, rgb[0], rgb[1], rgb[2], z]);
      }
    }
    return out;
  }

  /* A walk: feeds frames into a voxel grid.  Far readings are less exact, so they count less. */
  class WalkCapture {
    constructor(options = {}) {
      this.grid = new VoxelGrid(options.size || SPACING, options.minHits || 2);
      this.options = options;
      this.frames = 0;
      this.used = 0;
    }

    addFrame(frame) {
      const points = unproject(frame, this.options);
      for (const [x, y, z, r, g, b, depth] of points) this.grid.add(x, y, z, r, g, b, 1 / (1 + depth * depth * 0.15));
      this.frames += 1;
      this.used += points.length;
      return points.length;
    }

    get count() { return this.grid.visible; }
    takeNew() { return this.grid.takeNew(); }
    toCloud() { return this.grid.toCloud(); }
  }

  // ------------------------------------------------------------------------------------------ from a room
  /* Points on the walls, the floor and the ceiling of a measured room, one for every 5 cm square.  `pictures` gives the colour of every
     surface: {surfaceId: {width, height, data: RGBA}} as baked (see raumo-bake); a surface without a picture gets a plain colour. */
  const PLAIN = { wall: [236, 233, 226], floor: [189, 165, 135], ceiling: [247, 247, 244] };

  function sampleRoom(room, pictures = {}, spacing = SPACING) {
    const grid = new VoxelGrid(spacing, 1);
    const pick = (picture, fu, fv, fallback) => {
      if (!picture) return fallback;
      const x = Math.min(picture.width - 1, Math.max(0, Math.floor(fu * picture.width))), y = Math.min(picture.height - 1, Math.max(0, Math.floor(fv * picture.height)));
      const i = (y * picture.width + x) * 4;
      return [picture.data[i], picture.data[i + 1], picture.data[i + 2]];
    };
    const walls = Core.wallsOf(room.polygon);
    for (const wall of walls) {
      const picture = pictures[`wall:${wall.index}`];
      const holes = room.openings.filter((o) => o.wall === wall.index);
      const nu = Math.max(1, Math.round(wall.len / spacing)), nv = Math.max(1, Math.round(room.height / spacing));
      for (let j = 0; j < nv; j++) {
        const v = (j + 0.5) / nv * room.height;
        for (let i = 0; i < nu; i++) {
          const u = (i + 0.5) / nu * wall.len;
          if (holes.some((o) => u > o.u0 && u < o.u1 && v > o.v0 && v < o.v1)) continue;
          const [r, g, b] = pick(picture, u / wall.len, 1 - v / room.height, PLAIN.wall);
          grid.add(wall.a[0] + wall.dir[0] * u, v, wall.a[1] + wall.dir[1] * u, r, g, b);
        }
      }
    }
    const box = Core.bounds(room.polygon);
    const nx = Math.max(1, Math.round(box.width / spacing)), nz = Math.max(1, Math.round(box.depth / spacing));
    for (const [id, y, plain] of [["floor", 0, PLAIN.floor], ["ceiling", room.height, PLAIN.ceiling]]) {
      const picture = pictures[id];
      for (let j = 0; j < nz; j++) {
        const z = box.minZ + (j + 0.5) / nz * box.depth;
        for (let i = 0; i < nx; i++) {
          const x = box.minX + (i + 0.5) / nx * box.width;
          if (!Core.pointInPolygon([x, z], room.polygon)) continue;
          const [r, g, b] = pick(picture, (x - box.minX) / box.width, (z - box.minZ) / box.depth, plain);
          grid.add(x, y, z, r, g, b);
        }
      }
    }
    return grid.toCloud();
  }

  // -------------------------------------------------------------------------------------------- file formats
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  /* PLY, binary little endian: x y z as floats and red green blue as bytes.  Opens in CloudCompare, MeshLab, Blender and most others. */
  function toPLY(cloud) {
    const header = `ply\nformat binary_little_endian 1.0\ncomment made with raumo\nelement vertex ${cloud.count}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
    const head = encoder.encode(header);
    const out = new Uint8Array(head.length + cloud.count * 15);
    out.set(head);
    const dv = new DataView(out.buffer);
    let at = head.length;
    for (let i = 0; i < cloud.count; i++) {
      dv.setFloat32(at, cloud.positions[i * 3], true); dv.setFloat32(at + 4, cloud.positions[i * 3 + 1], true); dv.setFloat32(at + 8, cloud.positions[i * 3 + 2], true);
      out[at + 12] = cloud.colors[i * 3]; out[at + 13] = cloud.colors[i * 3 + 1]; out[at + 14] = cloud.colors[i * 3 + 2];
      at += 15;
    }
    return out;
  }

  /* XYZ as text: "x y z r g b" per line. */
  function toXYZ(cloud) {
    const lines = new Array(cloud.count);
    for (let i = 0; i < cloud.count; i++) lines[i] = `${cloud.positions[i * 3].toFixed(3)} ${cloud.positions[i * 3 + 1].toFixed(3)} ${cloud.positions[i * 3 + 2].toFixed(3)} ${cloud.colors[i * 3]} ${cloud.colors[i * 3 + 1]} ${cloud.colors[i * 3 + 2]}`;
    return encoder.encode(lines.join("\n") + (cloud.count ? "\n" : ""));
  }

  /* LAS 1.2, point format 2 (place and colour), in millimetres. LAS has z up and y to the north, so our y becomes z and our z becomes -y. */
  function toLAS(cloud) {
    const scale = 0.001;
    const b = boundsOf(cloud);
    const lasMin = [b.min[0], -b.max[2], b.min[1]], lasMax = [b.max[0], -b.min[2], b.max[1]];
    const headerSize = 227, recordSize = 26;
    const out = new Uint8Array(headerSize + cloud.count * recordSize);
    const dv = new DataView(out.buffer);
    out.set(encoder.encode("LASF"), 0);
    out[24] = 1; out[25] = 2;
    out.set(encoder.encode("raumo"), 26);
    out.set(encoder.encode("raumo"), 58);
    dv.setUint16(90, 1, true); dv.setUint16(92, 2026, true);
    dv.setUint16(94, headerSize, true); dv.setUint32(96, headerSize, true); dv.setUint32(100, 0, true);
    out[104] = 2; dv.setUint16(105, recordSize, true); dv.setUint32(107, cloud.count, true); dv.setUint32(111, cloud.count, true);
    const off = lasMin.map((v) => Math.floor(v));
    for (let k = 0; k < 3; k++) { dv.setFloat64(131 + k * 8, scale, true); dv.setFloat64(155 + k * 8, off[k], true); }
    dv.setFloat64(179, lasMax[0], true); dv.setFloat64(187, lasMin[0], true); dv.setFloat64(195, lasMax[1], true); dv.setFloat64(203, lasMin[1], true); dv.setFloat64(211, lasMax[2], true); dv.setFloat64(219, lasMin[2], true);
    let at = headerSize;
    for (let i = 0; i < cloud.count; i++) {
      dv.setInt32(at, Math.round((cloud.positions[i * 3] - off[0]) / scale), true);
      dv.setInt32(at + 4, Math.round((-cloud.positions[i * 3 + 2] - off[1]) / scale), true);
      dv.setInt32(at + 8, Math.round((cloud.positions[i * 3 + 1] - off[2]) / scale), true);
      out[at + 14] = 0x11;                                                                  // return 1 of 1
      dv.setUint16(at + 20, cloud.colors[i * 3] * 257, true); dv.setUint16(at + 22, cloud.colors[i * 3 + 1] * 257, true); dv.setUint16(at + 24, cloud.colors[i * 3 + 2] * 257, true);
      at += recordSize;
    }
    return out;
  }

  const PLY_TYPES = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };

  function readPLYValue(dv, at, type, little) {
    switch (type) {
      case "char": case "int8": return dv.getInt8(at);
      case "uchar": case "uint8": return dv.getUint8(at);
      case "short": case "int16": return dv.getInt16(at, little);
      case "ushort": case "uint16": return dv.getUint16(at, little);
      case "int": case "int32": return dv.getInt32(at, little);
      case "uint": case "uint32": return dv.getUint32(at, little);
      case "float": case "float32": return dv.getFloat32(at, little);
      default: return dv.getFloat64(at, little);
    }
  }

  /* Reads a PLY file (binary little or big endian, or text) with x y z and optionally red green blue; other fields are skipped. */
  function fromPLY(bytes, limit = MAX_POINTS) {
    const head = decoder.decode(bytes.subarray(0, Math.min(bytes.length, 4096)));
    const end = head.indexOf("end_header");
    if (!head.startsWith("ply") || end < 0) throw new Error("Das ist keine PLY-Datei.");
    const headerLength = end + "end_header".length + (head[end + 10] === "\r" ? 2 : 1);
    const lines = head.slice(0, end).split(/\r?\n/);
    const format = (lines.find((l) => l.startsWith("format ")) || "").split(/\s+/)[1];
    if (!["ascii", "binary_little_endian", "binary_big_endian"].includes(format)) throw new Error("Dieses PLY-Format wird nicht gelesen.");
    let count = 0, inVertex = false;
    const props = [];
    for (const l of lines) {
      const p = l.trim().split(/\s+/);
      if (p[0] === "element") { inVertex = p[1] === "vertex"; if (inVertex) count = Number(p[2]); else if (count && !inVertex && props.length) break; }
      else if (p[0] === "property" && inVertex) { if (p[1] === "list") throw new Error("Dieses PLY enthält Listen im Punktteil."); props.push({ type: p[1], name: p[2] }); }
    }
    if (!(count > 0) || count > limit) throw new Error(count > limit ? "Die Datei hat zu viele Punkte." : "Die Datei enthält keine Punkte.");
    const index = (names) => props.findIndex((p) => names.includes(p.name));
    const ix = index(["x"]), iy = index(["y"]), iz = index(["z"]);
    if (ix < 0 || iy < 0 || iz < 0) throw new Error("In der Datei fehlen die Koordinaten.");
    const ir = index(["red", "r"]), ig = index(["green", "g"]), ib = index(["blue", "b"]);
    const positions = new Float32Array(count * 3), colors = new Uint8Array(count * 3).fill(200);
    if (format === "ascii") {
      const rows = decoder.decode(bytes.subarray(headerLength)).split(/\r?\n/);
      let n = 0;
      for (const row of rows) {
        if (!row.trim()) continue;
        const v = row.trim().split(/\s+/).map(Number);
        if (v.length < props.length || n >= count) continue;
        positions[n * 3] = v[ix]; positions[n * 3 + 1] = v[iy]; positions[n * 3 + 2] = v[iz];
        if (ir >= 0) { colors[n * 3] = v[ir]; colors[n * 3 + 1] = v[ig]; colors[n * 3 + 2] = v[ib]; }
        n++;
      }
      return { count: n, positions: positions.slice(0, n * 3), colors: colors.slice(0, n * 3) };
    }
    const little = format === "binary_little_endian";
    const sizes = props.map((p) => { if (!PLY_TYPES[p.type]) throw new Error("Unbekannter Datentyp im PLY."); return PLY_TYPES[p.type]; });
    const stride = sizes.reduce((a, b) => a + b, 0);
    if (headerLength + count * stride > bytes.length) throw new Error("Die PLY-Datei ist abgeschnitten.");
    const offsets = []; let o = 0; for (const s of sizes) { offsets.push(o); o += s; }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const scaleColor = (p) => (p && (p.type === "float" || p.type === "float32" || p.type === "double" || p.type === "float64") ? 255 : 1);
    const cs = ir >= 0 ? scaleColor(props[ir]) : 1;
    for (let n = 0; n < count; n++) {
      const at = headerLength + n * stride;
      positions[n * 3] = readPLYValue(dv, at + offsets[ix], props[ix].type, little);
      positions[n * 3 + 1] = readPLYValue(dv, at + offsets[iy], props[iy].type, little);
      positions[n * 3 + 2] = readPLYValue(dv, at + offsets[iz], props[iz].type, little);
      if (ir >= 0) {
        colors[n * 3] = readPLYValue(dv, at + offsets[ir], props[ir].type, little) * cs; colors[n * 3 + 1] = readPLYValue(dv, at + offsets[ig], props[ig].type, little) * cs; colors[n * 3 + 2] = readPLYValue(dv, at + offsets[ib], props[ib].type, little) * cs;
      }
    }
    return { count, positions, colors };
  }

  /* Reads "x y z" or "x y z r g b" lines (spaces, commas or semicolons; # comments).  Colours may be 0..255 or 0..1. */
  function fromXYZ(bytes, limit = MAX_POINTS) {
    const rows = decoder.decode(bytes).split(/\r?\n/);
    const positions = [], colors = [], given = [];
    let unit = false;
    for (const row of rows) {
      const t = row.trim();
      if (!t || t.startsWith("#") || t.startsWith("//")) continue;
      const v = t.split(/[\s,;]+/).map(Number);
      if (v.length < 3 || v.slice(0, 3).some((x) => !Number.isFinite(x))) continue;
      positions.push(v[0], v[1], v[2]);
      if (v.length >= 6 && v.slice(3, 6).every(Number.isFinite)) {
        colors.push(v[3], v[4], v[5]);
        given.push(true);
        if (v[3] <= 1 && v[4] <= 1 && v[5] <= 1 && !(Number.isInteger(v[3]) && Number.isInteger(v[4]) && Number.isInteger(v[5]))) unit = true;
      } else { colors.push(200, 200, 200); given.push(false); }
      if (positions.length / 3 > limit) throw new Error("Die Datei hat zu viele Punkte.");
    }
    if (!positions.length) throw new Error("In der Datei stehen keine Punkte.");
    const out = new Uint8Array(colors.length);
    for (let i = 0; i < colors.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(colors[i] * (unit && given[(i / 3) | 0] ? 255 : 1))));
    return { count: positions.length / 3, positions: new Float32Array(positions), colors: out };
  }

  /* Reads a LAS file (1.0 to 1.4, point formats 0 to 10) with its colours if it has some. LAZ (compressed) cannot be read. */
  function fromLAS(bytes, limit = MAX_POINTS) {
    if (bytes.length < 227 || decoder.decode(bytes.subarray(0, 4)) !== "LASF") throw new Error("Das ist keine LAS-Datei.");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const offset = dv.getUint32(96, true), format = dv.getUint8(104) & 0x3f, compressed = (dv.getUint8(104) & 0x80) !== 0 || (dv.getUint8(104) & 0x40) !== 0;
    const size = dv.getUint16(105, true);
    const minor = dv.getUint8(25);
    let count = dv.getUint32(107, true);
    if (minor >= 4 && bytes.length >= 375) { const big = Number(dv.getBigUint64(247, true)); if (big > 0) count = big; }
    if (compressed) throw new Error("Komprimierte LAZ-Dateien kann raumo nicht lesen. Speichere die Datei als LAS.");
    if (!(count > 0) || count > limit) throw new Error(count > limit ? "Die Datei hat zu viele Punkte." : "Die Datei enthält keine Punkte.");
    if (offset + count * size > bytes.length) throw new Error("Die LAS-Datei ist abgeschnitten.");
    const scale = [dv.getFloat64(131, true), dv.getFloat64(139, true), dv.getFloat64(147, true)], off = [dv.getFloat64(155, true), dv.getFloat64(163, true), dv.getFloat64(171, true)];
    const colorAt = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 }[format];
    const positions = new Float32Array(count * 3), colors = new Uint8Array(count * 3).fill(200);
    let wide = false;
    const raw = [];
    for (let i = 0; i < count; i++) {
      const at = offset + i * size;
      const x = dv.getInt32(at, true) * scale[0] + off[0], y = dv.getInt32(at + 4, true) * scale[1] + off[1], z = dv.getInt32(at + 8, true) * scale[2] + off[2];
      positions[i * 3] = x; positions[i * 3 + 1] = z; positions[i * 3 + 2] = -y;                  // LAS: z up, y north  ->  ours: y up, z south
      if (colorAt) {
        const r = dv.getUint16(at + colorAt, true), g = dv.getUint16(at + colorAt + 2, true), b = dv.getUint16(at + colorAt + 4, true);
        raw.push(r, g, b);
        if (r > 255 || g > 255 || b > 255) wide = true;
      }
    }
    if (colorAt) for (let i = 0; i < count * 3; i++) colors[i] = wide ? raw[i] >> 8 : raw[i];
    return { count, positions, colors };
  }

  /* Reads a file by what is inside it: {cloud, format}. */
  function readCloud(bytes, limit = MAX_POINTS) {
    if (bytes.length > 4 && decoder.decode(bytes.subarray(0, 4)) === "LASF") return { cloud: fromLAS(bytes, limit), format: "las" };
    if (decoder.decode(bytes.subarray(0, 3)) === "ply") return { cloud: fromPLY(bytes, limit), format: "ply" };
    return { cloud: fromXYZ(bytes, limit), format: "xyz" };
  }

  /* Moves a cloud so that its middle (in x and z) is at the origin and its lowest point is the floor: files from other programs often use
     far-away coordinates (surveys) that a single-precision viewer cannot show exactly. */
  function recentre(cloud) {
    const b = boundsOf(cloud);
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, cy = b.min[1];
    const positions = new Float32Array(cloud.positions.length);
    for (let i = 0; i < cloud.count; i++) { positions[i * 3] = cloud.positions[i * 3] - cx; positions[i * 3 + 1] = cloud.positions[i * 3 + 1] - cy; positions[i * 3 + 2] = cloud.positions[i * 3 + 2] - cz; }
    return { cloud: { count: cloud.count, positions, colors: cloud.colors }, shift: [cx, cy, cz] };
  }

  /* A cloud whose z axis points up (surveys, many scanners) turned so that y points up: (x, y, z) becomes (x, z, -y). */
  function zUpToYUp(cloud) {
    const positions = new Float32Array(cloud.positions.length);
    for (let i = 0; i < cloud.count; i++) { positions[i * 3] = cloud.positions[i * 3]; positions[i * 3 + 1] = cloud.positions[i * 3 + 2]; positions[i * 3 + 2] = -cloud.positions[i * 3 + 1]; }
    return { count: cloud.count, positions, colors: cloud.colors };
  }

  /* The height of the floor in a cloud: the lowest layer that holds a good share of all points (single points below it, from windows or
     bad readings, do not count).  Scans in phone coordinates often put the floor at -1.4 m: this finds it. Returns the y value or null. */
  function floorLevel(cloud, bin = 0.02, share = 0.012) {
    if (cloud.count < 50) return null;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < cloud.count; i++) { const y = cloud.positions[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
    const span = Math.min(hi - lo, 8);
    const bins = Math.max(1, Math.ceil(span / bin));
    const hist = new Uint32Array(bins + 1);
    for (let i = 0; i < cloud.count; i++) { const k = Math.floor((cloud.positions[i * 3 + 1] - lo) / bin); if (k <= bins) hist[k] += 1; }
    const need = Math.max(20, cloud.count * share);
    for (let k = 0; k <= bins; k++) {
      const layer = hist[k] + (hist[k + 1] || 0) + (k ? hist[k - 1] : 0);                // a layer is a bin and its neighbours (the floor is never perfectly flat)
      if (layer >= need) {
        let best = k;
        for (let j = Math.max(0, k - 1); j <= Math.min(bins, k + 1); j++) if (hist[j] > hist[best]) best = j;
        let sum = 0, n = 0;                                                               // the average height of the points of that layer
        const from = lo + (best - 1) * bin, to = lo + (best + 2) * bin;
        for (let i = 0; i < cloud.count; i++) { const y = cloud.positions[i * 3 + 1]; if (y >= from && y < to) { sum += y; n += 1; } }
        return n ? sum / n : lo + (best + 0.5) * bin;
      }
    }
    return null;
  }

  /* The cloud moved up or down so that its floor is at height 0. Returns {cloud, shift} (shift is what was added to y). */
  function alignFloor(cloud) {
    const level = floorLevel(cloud);
    if (level == null || Math.abs(level) < 0.02) return { cloud, shift: 0 };
    const positions = new Float32Array(cloud.positions);
    for (let i = 0; i < cloud.count; i++) positions[i * 3 + 1] -= level;
    return { cloud: { count: cloud.count, positions, colors: cloud.colors }, shift: -level };
  }

  return { SPACING, MAX_POINTS, zUpToYUp, floorLevel, alignFloor, VoxelGrid, emptyCloud, boundsOf, mergeClouds, voxelize, unproject, WalkCapture, sampleRoom, toPLY, toXYZ, toLAS, fromPLY, fromXYZ, fromLAS, readCloud, recentre, PLAIN };
});
