/* raumo viewer: shows scanned rooms in 3D with WebGL (no libraries).  Three ways to look: "orbit" (walk around the building as if it
   were a doll's house -- the walls you look through are see-through), "walk" (stand in the room and look around, tap the floor to go
   there) and "pose" (a camera somebody else controls: the scan screen uses it to show the practice room).

   Items are {id, room, layout: {x, z, rot}, textures: {surfaceId: picture}, props: [{positions, normals, uvs, indices, color}]}; a
   picture is anything WebGL takes as a texture (canvas, ImageBitmap, image).  Clouds are {id, count, positions, colors, layout}: every
   point is drawn as a small disc of a size in metres (so that points 5 cm apart touch), in the colour that was scanned. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./raumo-core.js"));
  else root.RaumoGL = factory(root.RaumoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------------------------------- 4x4 matrices (column major)
  const M4 = {
    identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    multiply(a, b) {
      const out = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return out;
    },
    perspective(fovY, aspect, near, far) {
      const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(eye, target, upHint) {
      const f = Core.normalize(Core.sub(target, eye));
      const s = Core.normalize(Core.cross(f, upHint));
      const u = Core.cross(s, f);
      return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -Core.dot(s, eye), -Core.dot(u, eye), Core.dot(f, eye), 1]);
    },
    /* A room's place: turned by `rot` degrees the way Core.placePoint does and moved by (x, z). */
    place(layout) {
      const r = (layout.rot || 0) * DEG, c = Math.cos(r), s = Math.sin(r);
      return new Float32Array([c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, layout.x || 0, 0, layout.z || 0, 1]);
    },
  };

  const VERTEX = `
    attribute vec3 aPos; attribute vec3 aNormal; attribute vec2 aUv;
    uniform mat4 uViewProj; uniform mat4 uModel;
    varying vec3 vNormal; varying vec2 vUv; varying vec3 vWorld;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      vWorld = w.xyz; vNormal = mat3(uModel) * aNormal; vUv = aUv;
      gl_Position = uViewProj * w;
    }`;
  const FRAGMENT = `
    precision mediump float;
    uniform sampler2D uTex; uniform vec4 uColor; uniform float uUseTex; uniform float uClip; uniform float uUnlit; uniform float uFade;
    varying vec3 vNormal; varying vec2 vUv; varying vec3 vWorld;
    void main() {
      if (vWorld.y > uClip) discard;
      vec4 base = uUseTex > 0.5 ? texture2D(uTex, vUv) : uColor;
      vec3 n = normalize(vNormal);
      float key = max(dot(n, normalize(vec3(0.35, 0.9, 0.25))), 0.0);
      float fill = max(dot(n, normalize(vec3(-0.5, 0.3, -0.6))), 0.0);
      float lit = 0.46 + 0.42 * key + 0.16 * fill;
      float l = mix(lit, 1.0, uUnlit);
      gl_FragColor = vec4(base.rgb * l, base.a * uFade);
    }`;

  const POINT_VERTEX = `
    attribute vec3 aPos; attribute vec4 aColor;
    uniform mat4 uViewProj; uniform mat4 uModel;
    uniform float uSize; uniform float uScale; uniform float uClip; uniform float uMode; uniform float uMaxY; uniform vec4 uTint;
    varying vec3 vColor; varying float vKeep;
    void main() {
      vec4 w = uModel * vec4(aPos, 1.0);
      vKeep = w.y > uClip ? 0.0 : 1.0;
      gl_Position = uViewProj * w;
      gl_PointSize = clamp(uSize * uScale / max(gl_Position.w, 0.1), 2.0, 48.0);
      gl_Position.z -= uSize * 2.0;                                  // a little in front of a surface it lies on, so that a slanted wall does not cut the round points in half
      vec3 c = aColor.rgb;
      if (uMode > 0.5) {
        float t = clamp(w.y / uMaxY, 0.0, 1.0);
        c = mix(vec3(0.15, 0.35, 1.0), vec3(0.2, 0.9, 0.5), smoothstep(0.0, 0.5, t));
        c = mix(c, vec3(1.0, 0.85, 0.2), smoothstep(0.5, 1.0, t));
      }
      vColor = mix(c, uTint.rgb, uTint.a);
    }`;
  const POINT_FRAGMENT = `
    precision mediump float;
    varying vec3 vColor; varying float vKeep;
    void main() {
      if (vKeep < 0.5) discard;
      vec2 d = gl_PointCoord - vec2(0.5);
      if (dot(d, d) > 0.25) discard;
      gl_FragColor = vec4(vColor, 1.0);
    }`;
  const CHUNK = 400000;                                              // points per buffer

  const isPow2 = (n) => (n & (n - 1)) === 0;

  class Viewer {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.options = options;
      this.items = [];
      this.clouds = [];
      this.pointSize = 0.05;
      this.colorMode = 0;                                            // 0: the colours that were scanned, 1: by height
      this.showSurfaces = true;
      this.showPoints = true;
      this.mode = "orbit";
      this.orbit = { yaw: 35, pitch: 38, distance: 8, target: [0, 1, 0] };
      this.walk = { position: [0, 1.6, 0], yaw: 0, pitch: 0, fov: 70 };
      this.pose = { position: [0, 1.4, 0], forward: [0, 0, -1], up: [0, 1, 0], fov: 70 };
      this.clip = 100;
      this.background = options.background || [0.055, 0.06, 0.07, 1];
      this.dirty = true;
      this.scheduled = false;
      this.listeners = [];
      this.destroyed = false;
      const attributes = options.xr ? { antialias: false, alpha: true, xrCompatible: true, preserveDrawingBuffer: false } : { antialias: true, alpha: false, preserveDrawingBuffer: true };
      this.gl = canvas.getContext("webgl", attributes) || canvas.getContext("experimental-webgl");
      if (!this.gl) throw new Error("no webgl");
      this.build();
      if (!options.fixed) this.attachControls();
      canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.lost = true; });
      canvas.addEventListener("webglcontextrestored", () => { this.lost = false; this.build(); this.rebuildItems(); this.invalidate(); });
    }

    // ------------------------------------------------------------------------------------------------- setup
    build() {
      const gl = this.gl;
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      this.program = program;
      this.loc = {};
      for (const name of ["uViewProj", "uModel", "uTex", "uColor", "uUseTex", "uClip", "uUnlit", "uFade"]) this.loc[name] = gl.getUniformLocation(program, name);
      for (const name of ["aPos", "aNormal", "aUv"]) this.loc[name] = gl.getAttribLocation(program, name);
      const pointProgram = gl.createProgram();
      gl.attachShader(pointProgram, compile(gl.VERTEX_SHADER, POINT_VERTEX));
      gl.attachShader(pointProgram, compile(gl.FRAGMENT_SHADER, POINT_FRAGMENT));
      gl.linkProgram(pointProgram);
      if (!gl.getProgramParameter(pointProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pointProgram));
      this.pointProgram = pointProgram;
      this.ploc = {};
      for (const name of ["uViewProj", "uModel", "uSize", "uScale", "uClip", "uMode", "uMaxY", "uTint"]) this.ploc[name] = gl.getUniformLocation(pointProgram, name);
      for (const name of ["aPos", "aColor"]) this.ploc[name] = gl.getAttribLocation(pointProgram, name);
      this.aniso = gl.getExtension("EXT_texture_filter_anisotropic");
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    on(listener) { this.listeners.push(listener); }
    emit(type, detail) { for (const l of this.listeners) l(type, this, detail); }

    // ------------------------------------------------------------------------------------------------- scene
    /* Replaces everything that is shown. */
    setItems(items) {
      this.disposeItems();
      this.source = items;
      this.items = items.map((item) => this.makeItem(item));
      this.invalidate();
    }

    rebuildItems() {
      if (this.source) { this.items = this.source.map((item) => this.makeItem(item)); }
      if (this.cloudSource) this.setClouds(this.cloudSource);
    }

    /* Replaces the clouds that are shown. A cloud is {id, count, positions: Float32Array, colors: Uint8Array, layout?}. */
    setClouds(clouds) {
      this.disposeClouds();
      this.cloudSource = clouds;
      for (const cloud of clouds) this.clouds.push(this.makeCloud(cloud));
      this.invalidate();
    }

    makeCloud(cloud) {
      const chunks = [];
      for (let from = 0; from < cloud.count; from += CHUNK) chunks.push(this.uploadPoints(cloud, from, Math.min(cloud.count, from + CHUNK)));
      const layout = cloud.layout || { x: 0, z: 0, rot: 0 };
      return { id: cloud.id, cloud, chunks, layout, model: M4.place(layout), count: cloud.count };
    }

    uploadPoints(cloud, from, to) {
      const gl = this.gl;
      const n = to - from;
      const buffer = new ArrayBuffer(n * 16);
      const f = new Float32Array(buffer), u = new Uint8Array(buffer);
      for (let i = 0; i < n; i++) {
        const j = from + i;
        f[i * 4] = cloud.positions[j * 3]; f[i * 4 + 1] = cloud.positions[j * 3 + 1]; f[i * 4 + 2] = cloud.positions[j * 3 + 2];
        u[i * 16 + 12] = cloud.colors[j * 3]; u[i * 16 + 13] = cloud.colors[j * 3 + 1]; u[i * 16 + 14] = cloud.colors[j * 3 + 2]; u[i * 16 + 15] = 255;
      }
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW);
      return { vbo, count: n };
    }

    /* Adds points to a growing cloud while it is being scanned: `points` is [{x, y, z, r, g, b}]. */
    appendPoints(id, points, layout) {
      let entry = this.clouds.find((c) => c.id === id);
      if (!entry) {
        const placed = layout || { x: 0, z: 0, rot: 0 };
        entry = { id, cloud: null, chunks: [], layout: placed, model: M4.place(placed), count: 0, live: true };
        this.clouds.push(entry);
      }
      const gl = this.gl;
      let at = 0;
      while (at < points.length) {
        let last = entry.chunks[entry.chunks.length - 1];
        if (!last || last.count >= CHUNK || !last.buffer) {
          const buffer = new ArrayBuffer(CHUNK * 16);
          const vbo = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.bufferData(gl.ARRAY_BUFFER, buffer.byteLength, gl.DYNAMIC_DRAW);
          last = { vbo, count: 0, buffer, f: new Float32Array(buffer), u: new Uint8Array(buffer) };
          entry.chunks.push(last);
        }
        const room = Math.min(CHUNK - last.count, points.length - at);
        for (let i = 0; i < room; i++) {
          const p = points[at + i], k = last.count + i;
          last.f[k * 4] = p.x; last.f[k * 4 + 1] = p.y; last.f[k * 4 + 2] = p.z;
          last.u[k * 16 + 12] = p.r; last.u[k * 16 + 13] = p.g; last.u[k * 16 + 14] = p.b; last.u[k * 16 + 15] = 255;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, last.vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, last.count * 16, new Uint8Array(last.buffer, last.count * 16, room * 16));
        last.count += room;
        entry.count += room;
        at += room;
      }
      this.invalidate();
    }

    disposeClouds() {
      const gl = this.gl;
      for (const c of this.clouds) for (const ch of c.chunks) gl.deleteBuffer(ch.vbo);
      this.clouds = [];
    }

    makeItem(item) {
      const surfaces = Core.buildRoomSurfaces(item.room, { outer: false }).map((surface) => this.upload(surface));
      for (const prop of item.props || []) surfaces.push(this.upload({ ...prop, kind: "prop", id: prop.id || "prop" }, prop.color));
      const made = { id: item.id, room: item.room, layout: item.layout || { x: 0, z: 0, rot: 0 }, model: M4.place(item.layout || { x: 0, z: 0, rot: 0 }), surfaces, textures: {} };
      for (const surface of surfaces) {
        const picture = item.textures && item.textures[surface.id];
        if (picture) surface.texture = this.texture(picture);
      }
      return made;
    }

    upload(surface, color) {
      const gl = this.gl;
      const count = surface.positions.length / 3;
      const data = new Float32Array(count * 8);
      for (let i = 0; i < count; i++) {
        data.set(surface.positions.slice(i * 3, i * 3 + 3), i * 8);
        data.set(surface.normals.slice(i * 3, i * 3 + 3), i * 8 + 3);
        data.set(surface.uvs.slice(i * 2, i * 2 + 2), i * 8 + 6);
      }
      const vbo = gl.createBuffer(), ibo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(surface.indices), gl.STATIC_DRAW);
      return { id: surface.id, kind: surface.kind, vbo, ibo, count: surface.indices.length, color: color || Viewer.COLORS[surface.kind] || [0.8, 0.8, 0.8, 1], texture: null };
    }

    texture(source) {
      const gl = this.gl;
      let picture = source;
      const width = source.width || source.videoWidth, height = source.height || source.videoHeight;
      const pow2 = isPow2(width) && isPow2(height);
      if (!pow2) {                                                    // WebGL 1 wants powers of two for mipmaps
        const size = (n) => Math.min(2048, 2 ** Math.round(Math.log2(Math.max(2, n))));
        picture = document.createElement("canvas");
        picture.width = size(width); picture.height = size(height);
        picture.getContext("2d").drawImage(source, 0, 0, picture.width, picture.height);
      }
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (this.aniso) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return tex;
    }

    /* Gives one surface of one item a picture (after it was baked). */
    setTexture(itemId, surfaceId, source) {
      const item = this.items.find((i) => i.id === itemId);
      const surface = item && item.surfaces.find((s) => s.id === surfaceId);
      if (!surface) return;
      if (surface.texture) this.gl.deleteTexture(surface.texture);
      surface.texture = source ? this.texture(source) : null;
      if (this.source) {
        const entry = this.source.find((i) => i.id === itemId);
        if (entry) { entry.textures = entry.textures || {}; if (source) entry.textures[surfaceId] = source; else delete entry.textures[surfaceId]; }
      }
      this.invalidate();
    }

    disposeItems() {
      const gl = this.gl;
      for (const item of this.items) for (const s of item.surfaces) {
        gl.deleteBuffer(s.vbo); gl.deleteBuffer(s.ibo);
        if (s.texture) gl.deleteTexture(s.texture);
      }
      this.items = [];
    }

    destroy() {
      this.destroyed = true;
      this.disposeItems();
      this.disposeClouds();
      if (this.cleanup) this.cleanup();
    }

    // ------------------------------------------------------------------------------------------------- views
    /* The extent of everything shown, in world coordinates. */
    extent() {
      let box = null;
      for (const item of this.items) {
        const placed = Core.placedPolygon(item.room, item.layout);
        const b = Core.bounds(placed);
        box = box ? { minX: Math.min(box.minX, b.minX), maxX: Math.max(box.maxX, b.maxX), minZ: Math.min(box.minZ, b.minZ), maxZ: Math.max(box.maxZ, b.maxZ), height: Math.max(box.height, item.room.height) }
          : { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, height: item.room.height };
      }
      for (const c of this.clouds) {
        const b = c.bounds || (c.bounds = this.cloudBounds(c));
        if (!b) continue;
        box = box ? { minX: Math.min(box.minX, b.minX), maxX: Math.max(box.maxX, b.maxX), minZ: Math.min(box.minZ, b.minZ), maxZ: Math.max(box.maxZ, b.maxZ), height: Math.max(box.height, b.maxY) }
          : { minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ, height: Math.max(2, b.maxY) };
      }
      return box || { minX: -2, maxX: 2, minZ: -2, maxZ: 2, height: 2.5 };
    }

    /* The box around a cloud as it stands in the world (null for an empty one). */
    cloudBounds(entry) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
      const visit = (x, y, z) => {
        const p = Core.placePoint(entry.layout, [x, z]);
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1]; if (y > maxY) maxY = y;
      };
      if (entry.cloud) { const a = entry.cloud.positions; const step = Math.max(1, Math.floor(entry.cloud.count / 20000)); for (let i = 0; i < entry.cloud.count; i += step) visit(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); }
      else for (const ch of entry.chunks) if (ch.f) for (let i = 0; i < ch.count; i += 8) visit(ch.f[i * 4], ch.f[i * 4 + 1], ch.f[i * 4 + 2]);
      return Number.isFinite(minX) ? { minX, maxX, minZ, maxZ, maxY } : null;
    }

    /* Looks at everything from outside. */
    frame() {
      const b = this.extent();
      const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, b.height);
      this.orbit.target = [(b.minX + b.maxX) / 2, b.height * 0.35, (b.minZ + b.maxZ) / 2];
      this.orbit.distance = size * 1.5 + 2;
      this.invalidate();
    }

    setMode(mode) {
      this.mode = mode;
      if (mode === "walk") {
        const first = this.items[0];
        if (first && !this.walkPlaced) {
          const c = Core.placePoint(first.layout, Core.centroid(first.room.polygon));
          this.walk.position = [c[0], Math.min(1.6, first.room.height - 0.3), c[1]];
          this.walkPlaced = true;
        } else if (!first && this.clouds.length && !this.walkPlaced) {
          const e = this.extent();
          this.walk.position = [(e.minX + e.maxX) / 2, 1.5, (e.minZ + e.maxZ) / 2];
          this.walkPlaced = true;
        }
      }
      this.invalidate();
    }

    cameraState() {
      if (this.mode === "pose") {
        const p = this.pose;
        return { eye: p.position, forward: Core.normalize(p.forward), up: Core.normalize(p.up), fov: p.fov };
      }
      if (this.mode === "walk") {
        const v = Core.viewFromYawPitch(this.walk.yaw, this.walk.pitch);
        return { eye: this.walk.position, forward: v.forward, up: [0, 1, 0], fov: this.walk.fov };
      }
      const o = this.orbit, yaw = o.yaw * DEG, pitch = o.pitch * DEG;
      const eye = [o.target[0] + o.distance * Math.sin(yaw) * Math.cos(pitch), o.target[1] + o.distance * Math.sin(pitch), o.target[2] + o.distance * Math.cos(yaw) * Math.cos(pitch)];
      return { eye, forward: Core.normalize(Core.sub(o.target, eye)), up: [0, 1, 0], fov: 45 };
    }

    // ------------------------------------------------------------------------------------------------ drawing
    resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio)), h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.invalidate(); }
    }

    invalidate() {
      this.dirty = true;
      if (this.scheduled || this.destroyed) return;
      this.scheduled = true;
      const run = () => {
        if (!this.scheduled) return;
        this.scheduled = false;
        if (this.destroyed) return;
        this.render();
      };
      requestAnimationFrame(run);
      setTimeout(run, 60);                                           // a hidden or throttled page still draws
    }

    /* One picture of a WebXR session: the points, seen the way the phone sees them (view and layer come from the XR frame). */
    drawXR(view, layer) {
      if (this.lost || this.destroyed) return;
      const gl = this.gl;
      this.xrActive = true;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const p = view.projectionMatrix;
      if (this.showPoints && this.clouds.length) this.drawPoints(M4.multiply(p, view.transform.inverse.matrix), 2 * Math.atan(1 / p[5]), vp.height);
    }

    render() {
      if (this.lost || this.destroyed || this.xrActive) return;
      this.resize();
      const gl = this.gl;
      const { width, height } = this.canvas;
      gl.viewport(0, 0, width, height);
      const bg = this.background;
      gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const cam = this.cameraState();
      const aspect = width / height;
      // the field of view of the camera and walk views is the angle along the longer side of the picture (like the photos' in Core.makeCamera)
      const fovY = this.mode === "orbit" ? cam.fov * DEG : aspect >= 1 ? 2 * Math.atan(Math.tan(cam.fov * DEG / 2) / aspect) : cam.fov * DEG;
      const proj = M4.perspective(fovY, aspect, 0.05, 200);
      const view = M4.lookAt(cam.eye, Core.add(cam.eye, cam.forward), cam.up);
      this.last = { cam, aspect, fovY, viewProj: M4.multiply(proj, view) };
      gl.useProgram(this.program);
      gl.uniformMatrix4fv(this.loc.uViewProj, false, M4.multiply(proj, view));
      gl.uniform1f(this.loc.uClip, this.clip);
      gl.uniform1i(this.loc.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      for (const item of this.showSurfaces ? this.items : []) {
        gl.uniformMatrix4fv(this.loc.uModel, false, item.model);
        for (const s of item.surfaces) {
          gl.bindBuffer(gl.ARRAY_BUFFER, s.vbo);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.ibo);
          gl.enableVertexAttribArray(this.loc.aPos); gl.vertexAttribPointer(this.loc.aPos, 3, gl.FLOAT, false, 32, 0);
          gl.enableVertexAttribArray(this.loc.aNormal); gl.vertexAttribPointer(this.loc.aNormal, 3, gl.FLOAT, false, 32, 12);
          gl.enableVertexAttribArray(this.loc.aUv); gl.vertexAttribPointer(this.loc.aUv, 2, gl.FLOAT, false, 32, 24);
          if (s.texture) { gl.bindTexture(gl.TEXTURE_2D, s.texture); gl.uniform1f(this.loc.uUseTex, 1); gl.uniform1f(this.loc.uUnlit, 0.92); }
          else { gl.uniform1f(this.loc.uUseTex, 0); gl.uniform4fv(this.loc.uColor, s.color); gl.uniform1f(this.loc.uUnlit, s.kind === "prop" ? 0.9 : 0); }
          gl.uniform1f(this.loc.uFade, 1);
          gl.drawElements(gl.TRIANGLES, s.count, gl.UNSIGNED_SHORT, 0);
        }
      }
      if (this.showPoints && this.clouds.length) this.drawPoints(M4.multiply(proj, view), fovY, height);
      this.dirty = false;
      this.emit("render");
    }

    drawPoints(viewProj, fovY, pixelsHigh) {
      const gl = this.gl, loc = this.ploc;
      gl.useProgram(this.pointProgram);
      gl.disable(gl.CULL_FACE);
      gl.uniformMatrix4fv(loc.uViewProj, false, viewProj);
      gl.uniform1f(loc.uSize, this.pointSize);
      gl.uniform1f(loc.uScale, pixelsHigh / (2 * Math.tan(fovY / 2)));
      gl.uniform1f(loc.uClip, this.clip);
      gl.uniform1f(loc.uMode, this.colorMode);
      gl.uniform1f(loc.uMaxY, Math.max(1.5, this.extent().height));
      gl.uniform4fv(loc.uTint, this.pointTint || [0, 0, 0, 0]);
      for (const name of ["aPos", "aNormal", "aUv"]) gl.disableVertexAttribArray(this.loc[name]);       // (the two programs may use the same slots)
      gl.enableVertexAttribArray(loc.aPos);
      gl.enableVertexAttribArray(loc.aColor);
      for (const entry of this.clouds) {
        gl.uniformMatrix4fv(loc.uModel, false, entry.model);
        for (const ch of entry.chunks) {
          if (!ch.count) continue;
          gl.bindBuffer(gl.ARRAY_BUFFER, ch.vbo);
          gl.vertexAttribPointer(loc.aPos, 3, gl.FLOAT, false, 16, 0);
          gl.vertexAttribPointer(loc.aColor, 4, gl.UNSIGNED_BYTE, true, 16, 12);
          gl.drawArrays(gl.POINTS, 0, ch.count);
        }
      }
      gl.disableVertexAttribArray(loc.aColor);
      gl.disableVertexAttribArray(loc.aPos);
      gl.enable(gl.CULL_FACE);
      gl.useProgram(this.program);
    }

    /* The point nearest to the line of sight through a spot of the screen (within a few centimetres of it), in world coordinates, or null. */
    pickPoint(x, y) {
      const ray = this.rayAt(x, y);
      let best = null;
      for (const entry of this.clouds) {
        const r = (entry.layout.rot || 0) * Core.DEG, c = Math.cos(r), s = Math.sin(r);
        const visit = (px, py, pz) => {
          const wx = entry.layout.x + px * c - pz * s, wz = entry.layout.z + px * s + pz * c;
          const dx = wx - ray.origin[0], dy = py - ray.origin[1], dz = wz - ray.origin[2];
          const t = dx * ray.dir[0] + dy * ray.dir[1] + dz * ray.dir[2];
          if (t < 0.2) return;
          const ex = dx - ray.dir[0] * t, ey = dy - ray.dir[1] * t, ez = dz - ray.dir[2] * t;
          const off = Math.hypot(ex, ey, ez);
          if (off > 0.025 + 0.012 * t) return;
          if (!best || t < best.t - 0.05 || (Math.abs(t - best.t) <= 0.05 && off < best.off)) best = { t, off, point: [wx, py, wz] };
        };
        if (entry.cloud) { const a = entry.cloud.positions; for (let i = 0; i < entry.cloud.count; i++) visit(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); }
        else for (const ch of entry.chunks) if (ch.f) for (let i = 0; i < ch.count; i++) visit(ch.f[i * 4], ch.f[i * 4 + 1], ch.f[i * 4 + 2]);
      }
      return best ? best.point : null;
    }

    /* A PNG or JPEG of what is shown, `width` pixels wide (the shape of the screen is kept). */
    snapshot(width = 640, type = "image/jpeg", quality = 0.85) {
      this.render();
      const source = this.canvas;
      const out = document.createElement("canvas");
      out.width = width;
      out.height = Math.max(1, Math.round(width * source.height / source.width));
      out.getContext("2d").drawImage(source, 0, 0, out.width, out.height);
      return new Promise((resolve) => out.toBlob(resolve, type, quality));
    }

    // -------------------------------------------------------------------------------------------- controls
    /* The line of sight through a point of the screen (x, y in pixels of the canvas box). */
    rayAt(x, y) {
      const rect = this.canvas.getBoundingClientRect();
      const nx = ((x - rect.left) / rect.width) * 2 - 1, ny = 1 - ((y - rect.top) / rect.height) * 2;
      const { cam, aspect, fovY } = this.last || (this.render(), this.last);
      const right = Core.normalize(Core.cross(cam.forward, cam.up));
      const up = Core.cross(right, cam.forward);
      const ty = Math.tan(fovY / 2), tx = ty * aspect;
      return { origin: cam.eye, dir: Core.normalize(Core.add(cam.forward, Core.add(Core.mul(right, nx * tx), Core.mul(up, ny * ty)))) };
    }

    /* Where a place of the world is on the screen (pixels from the top left of the canvas box), or null if it is behind the camera. */
    toScreen(p) {
      if (!this.last) return null;
      const m = this.last.viewProj;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= 0.01) return null;
      return [(x / w * 0.5 + 0.5) * this.canvas.clientWidth, (1 - (y / w * 0.5 + 0.5)) * this.canvas.clientHeight];
    }

    /* Where a click lands on the floor of one of the rooms, or null. */
    floorAt(x, y) {
      const ray = this.rayAt(x, y);
      if (ray.dir[1] >= -1e-4) return null;
      const t = -ray.origin[1] / ray.dir[1];
      const p = [ray.origin[0] + ray.dir[0] * t, ray.origin[2] + ray.dir[2] * t];
      for (const item of this.items) if (Core.pointInPolygon(p, Core.placedPolygon(item.room, item.layout))) return p;
      return null;
    }

    attachControls() {
      const canvas = this.canvas;
      const pointers = new Map();
      let last = null, moved = 0, downAt = 0, pinch = 0;
      const down = (e) => {
        canvas.setPointerCapture?.(e.pointerId);
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        if (pointers.size === 1) { moved = 0; downAt = performance.now(); }
        last = [...pointers.values()];
        pinch = pointers.size === 2 ? dist(last) : 0;
      };
      const dist = (pts) => Math.hypot(pts[0][0] - pts[1][0], pts[0][1] - pts[1][1]);
      const move = (e) => {
        if (!pointers.has(e.pointerId)) return;
        const before = [...pointers.values()];
        pointers.set(e.pointerId, [e.clientX, e.clientY]);
        const now = [...pointers.values()];
        if (now.length === 1) {
          const dx = now[0][0] - before[0][0], dy = now[0][1] - before[0][1];
          moved += Math.abs(dx) + Math.abs(dy);
          this.drag(dx, dy);
        } else if (now.length === 2) {
          const d = dist(now);
          if (pinch) this.zoom(pinch / d);
          pinch = d;
          const cx = (now[0][0] + now[1][0]) / 2 - (before[0][0] + before[1][0]) / 2, cy = (now[0][1] + now[1][1]) / 2 - (before[0][1] + before[1][1]) / 2;
          this.pan(cx, cy);
          moved += 10;
        }
      };
      const up = (e) => {
        if (pointers.size === 1 && moved < 8 && performance.now() - downAt < 350) this.tap(e.clientX, e.clientY);
        pointers.delete(e.pointerId);
        pinch = 0;
      };
      const wheel = (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); };
      const keys = (e) => {
        if (!this.options.keys || this.mode !== "walk") return;
        const step = 0.25, v = Core.viewFromYawPitch(this.walk.yaw, 0);
        const move2 = { ArrowUp: v.forward, ArrowDown: Core.mul(v.forward, -1), ArrowLeft: Core.mul(v.right, -1), ArrowRight: v.right }[e.key];
        if (move2) { e.preventDefault(); this.walk.position = Core.add(this.walk.position, Core.mul(move2, step)); this.invalidate(); }
      };
      canvas.addEventListener("pointerdown", down);
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("wheel", wheel, { passive: false });
      window.addEventListener("keydown", keys);
      const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.invalidate()) : null;
      observer?.observe(canvas);
      this.cleanup = () => { window.removeEventListener("keydown", keys); observer?.disconnect(); };
    }

    drag(dx, dy) {
      if (this.mode === "orbit") {
        this.orbit.yaw -= dx * 0.4;
        this.orbit.pitch = Core.clamp(this.orbit.pitch + dy * 0.35, 3, 88);
      } else if (this.mode === "walk") {
        this.walk.yaw -= dx * 0.18 * (this.walk.fov / 70);
        this.walk.pitch = Core.clamp(this.walk.pitch + dy * 0.18 * (this.walk.fov / 70), -85, 85);
      } else if (this.options.onPoseDrag) this.options.onPoseDrag(dx, dy);
      this.invalidate();
      this.emit("move");
    }

    zoom(factor) {
      if (this.mode === "orbit") this.orbit.distance = Core.clamp(this.orbit.distance * factor, 1.2, 80);
      else if (this.mode === "walk") this.walk.fov = Core.clamp(this.walk.fov * factor, 30, 100);
      this.invalidate();
    }

    pan(dx, dy) {
      if (this.mode !== "orbit") return;
      const cam = this.cameraState();
      const right = Core.normalize(Core.cross(cam.forward, [0, 1, 0]));
      const k = this.orbit.distance * 0.0016;
      this.orbit.target = Core.add(this.orbit.target, Core.add(Core.mul(right, -dx * k), [0, dy * k, 0]));
      this.invalidate();
    }

    tap(x, y) {
      if (this.mode === "walk" && !this.measuring) {
        const p = this.floorAt(x, y);
        if (p) this.walkTo([p[0], this.walk.position[1], p[1]]);
      }
      this.emit("tap", { x, y });
    }

    walkTo(position) {
      const from = this.walk.position.slice(), start = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / 450);
        const e = t * t * (3 - 2 * t);
        this.walk.position = [0, 1, 2].map((k) => from[k] + (position[k] - from[k]) * e);
        this.invalidate();
        if (t < 1 && !this.destroyed) setTimeout(step, 16);
      };
      step();
    }
  }

  Viewer.COLORS = { wall: [0.93, 0.92, 0.89, 1], floor: [0.72, 0.64, 0.53, 1], ceiling: [0.97, 0.97, 0.96, 1], reveal: [0.82, 0.8, 0.76, 1], cap: [0.42, 0.43, 0.46, 1], outer: [0.7, 0.7, 0.72, 1] };

  return { Viewer, M4 };
});
