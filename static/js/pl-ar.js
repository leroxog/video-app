/* Nex 3D lenses (pl-ar.js): the part of the lenses that is really three-dimensional, drawn with three.js (MIT, static/js/vendor/three) on a canvas of its own that lies under the 2D canvas
   of pl-face.js. It does three things with the face that the Face Landmarker of MediaPipe finds in every picture of the camera (on the device of the person, nothing is sent anywhere):
   1. WARPS: the picture of the camera is drawn by a shader, and big eyes, a big head, a big nose or a big mouth are real distortions of that picture around the points of the face
      (the eye is magnified where the eye is, not in a circle somewhere near it).
   2. DECALS: paint on the skin. The 468 points of the face are a mesh with a fixed map (the canonical face model of MediaPipe, static/js/vendor/mediapipe/face_mesh.json), so a picture
      painted on that map (knitted wool with holes for the eyes, a beard, blush, freckles, a zombie skin, a clown face) sticks to the face and follows every expression.
   3. MODELS: things made of real 3D shapes with light and reflections (glasses, hats, ears, horns, a crown, a nose, teeth, a tongue) that sit on the head in the position and the turn that
      the model gives as a matrix, and that are hidden by the head where the head is in front of them.
   `PulseAR.Layer` is made by FaceLens (pl-face.js) when the recipe of a lens has one of the effects of this file (`PulseAR.has(id)`); the other effects stay 2D. */
(function () {
  "use strict";

  const BASE = "/static/js/vendor/three";
  const MESH = "/static/js/vendor/mediapipe/face_mesh.json";
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const FOV = 63;                                              // the vertical angle of view that the matrices of MediaPipe are made for

  let libs = null;
  /* three.js, its room of lights (for the reflections) and the map of the face, loaded once. */
  function load() {
    if (!libs) {
      libs = (async () => {
        const [three, room, mesh] = await Promise.all([import(`${BASE}/three.module.min.js`), import(`${BASE}/RoomEnvironment.js`), fetch(`${MESH}?v=1`).then((r) => r.json())]);
        three.ColorManagement.enabled = false;                  // the picture of the camera goes through the shader as it is
        return { T: three, RoomEnvironment: room.RoomEnvironment, mesh };
      })().catch((error) => { libs = null; throw error; });
    }
    return libs;
  }

  // ------------------------------------------------------------------------------------------------------------------ colour grading in the shader (the filters of the lenses)
  const GRADES = {
    none: { b: 1, c: 1, s: 1, hue: 0, sepia: 0, gray: 0 },
    warm: { b: 1, c: 1.05, s: 1.25, hue: 0, sepia: 0.22, gray: 0 },
    cool: { b: 1.03, c: 1, s: 1.1, hue: -12, sepia: 0, gray: 0 },
    noir: { b: 1, c: 1.2, s: 1, hue: 0, sepia: 0, gray: 1 },
    vivid: { b: 1, c: 1.12, s: 1.9, hue: 0, sepia: 0, gray: 0 },
    retro: { b: 1, c: 0.95, s: 1.3, hue: -8, sepia: 0.55, gray: 0 },
    dream: { b: 1.1, c: 0.92, s: 1.4, hue: 0, sepia: 0, gray: 0 },
    night: { b: 0.82, c: 1.15, s: 1.3, hue: 190, sepia: 0, gray: 0 },
  };

  const VERTEX = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";
  const FRAGMENT = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uVideo;
    uniform vec2 uScale;
    uniform vec2 uVideoSize;
    uniform float uMirror;
    uniform int uWarps;
    uniform vec4 uWarpA[6];
    uniform vec4 uWarpB[6];
    uniform vec4 uGrade;
    uniform vec2 uGrade2;
    vec3 hueRotate(vec3 c, float deg) {
      float a = radians(deg); float cs = cos(a); float sn = sin(a);
      mat3 m = mat3(0.213 + cs * 0.787 - sn * 0.213, 0.213 - cs * 0.213 + sn * 0.143, 0.213 - cs * 0.213 - sn * 0.787,
                    0.715 - cs * 0.715 - sn * 0.715, 0.715 + cs * 0.285 + sn * 0.140, 0.715 - cs * 0.715 + sn * 0.715,
                    0.072 - cs * 0.072 + sn * 0.928, 0.072 - cs * 0.072 - sn * 0.283, 0.072 + cs * 0.928 + sn * 0.072);
      return clamp(m * c, 0.0, 1.0);
    }
    void main() {
      vec2 uv = 0.5 + (vUv - 0.5) * uScale;
      if (uMirror > 0.5) uv.x = 1.0 - uv.x;
      vec2 p = uv * uVideoSize;
      for (int i = 0; i < 6; i++) {
        if (i >= uWarps) break;
        vec4 A = uWarpA[i];
        vec4 B = uWarpB[i];
        vec2 d = p - A.xy;
        float cs = cos(B.x); float sn = sin(B.x);
        vec2 q = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y) / A.zw;
        float r2 = dot(q, q);
        if (r2 < 1.0) { float k = 1.0 - B.y * (1.0 - r2) * (1.0 - r2); p = A.xy + d * k; }
      }
      vec3 col = texture2D(uVideo, p / uVideoSize).rgb;
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, uGrade.z);
      col = (col - 0.5) * uGrade.y + 0.5;
      col *= uGrade.x;
      if (abs(uGrade.w) > 0.5) col = hueRotate(col, uGrade.w);
      if (uGrade2.x > 0.0) { vec3 sep = vec3(dot(col, vec3(0.393, 0.769, 0.189)), dot(col, vec3(0.349, 0.686, 0.168)), dot(col, vec3(0.272, 0.534, 0.131))); col = mix(col, sep, uGrade2.x); }
      if (uGrade2.y > 0.0) col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), uGrade2.y);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`;

  // ------------------------------------------------------------------------------------------------------------------ the effects
  /* Every effect is one of: {warp(f)} -> a list of [centre x, centre y, radius x, radius y, angle, strength] in pixels of the camera picture;
     {decal(g, d)}: paints on the map of the face (g: 2D context of 1024 x 1024, d: helpers); {model(k)}: a three.js object in the space of the face (k: kit of materials and shapes),
     with an optional update(object, f, k) every picture; {hood(g, f)} for the knitted hood. A recipe may have any of them together. */
  const EFFECTS = {};
  const add = (id, spec) => { EFFECTS[id] = { id, ...spec }; };
  const has = (id) => !!EFFECTS[id];

  // -------- the warps
  const eyeBox = (f, A, B) => {                                // an eye: its middle and its size in pixels of the camera picture
    const a = f.px(A.eyeOuter), b = f.px(A.eyeInner), t = f.px(A.eyeTop), u = f.px(A.eyeBottom);
    const w = Math.hypot(a.x - b.x, a.y - b.y);
    return { x: (a.x + b.x) / 2, y: (t.y + u.y) / 2 * 0.5 + (a.y + b.y) / 4, w, h: Math.hypot(t.x - u.x, t.y - u.y) };
  };
  add("bigEyes", { warp: (f) => [f.A, f.B].map((side) => { const e = eyeBox(f, side); return [e.x, e.y, e.w * 1.45, e.w * 1.05, f.roll, 0.72]; }) });
  add("bigHead", { warp: (f) => [[f.center.x, f.center.y + f.s * 0.02, f.s * 1.05, f.s * 1.0, f.roll, 0.42]] });
  add("bigNose", { warp: (f) => { const n = f.px(1); return [[n.x, n.y, f.s * 0.26, f.s * 0.28, f.roll, 0.82]]; } });
  add("bigMouth", { warp: (f) => [[f.mouth.x, f.mouth.y, Math.max(f.mouth.w * 0.8, f.s * 0.2), Math.max(f.mouth.w * 0.62, f.s * 0.16), f.roll, 0.75]] });

  // ------------------------------------------------------------------------------------------------------------------ the layer: one canvas, three passes
  const DECAL = 1024;                                          // the size of the picture painted on the map of the face
  const SIDE_A = { eyeOuter: 33, eyeInner: 133, eyeTop: 159, eyeBottom: 145 };
  const SIDE_B = { eyeOuter: 263, eyeInner: 362, eyeTop: 386, eyeBottom: 374 };

  class Layer {
    constructor({ video, canvas, mirror }) {
      this.video = video;
      this.canvas = canvas;
      this.mirror = !!mirror;
      this.recipe = { fx: [], filter: "none" };
      this.ready = false;
      this.failed = false;
      this.parts = { warps: [], decals: [], models: [], hoods: [] };
      this.models = [];
      this.hoods = [];
      this.needsVideo = false;
      this.W = 0;
      this.H = 0;
      this.init().catch((error) => { this.failed = true; this.error = error; });
    }

    async init() {
      const { T, RoomEnvironment, mesh } = await load();
      this.T = T;
      this.data = mesh;
      const r = this.renderer = new T.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
      r.autoClear = false;
      r.outputColorSpace = T.LinearSRGBColorSpace;
      r.setClearColor(0x000000, 0);
      const pmrem = new T.PMREMGenerator(r);
      this.env = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
      pmrem.dispose();

      // pass 1: the picture of the camera, through the shader (warps and colours)
      this.bgScene = new T.Scene();
      this.bgCam = new T.Camera();
      this.videoTexture = new T.VideoTexture(this.video);
      this.videoTexture.minFilter = T.LinearFilter;
      this.videoTexture.magFilter = T.LinearFilter;
      this.videoTexture.generateMipmaps = false;
      const warpA = Array.from({ length: 6 }, () => new T.Vector4());
      const warpB = Array.from({ length: 6 }, () => new T.Vector4());
      this.uniforms = { uVideo: { value: this.videoTexture }, uScale: { value: new T.Vector2(1, 1) }, uVideoSize: { value: new T.Vector2(1, 1) }, uMirror: { value: 0 }, uWarps: { value: 0 }, uWarpA: { value: warpA },
        uWarpB: { value: warpB }, uGrade: { value: new T.Vector4(1, 1, 1, 0) }, uGrade2: { value: new T.Vector2(0, 0) } };
      this.bgMaterial = new T.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms: this.uniforms, depthTest: false, depthWrite: false });
      this.bgScene.add(new T.Mesh(new T.PlaneGeometry(2, 2), this.bgMaterial));

      // pass 2: paint on the skin (the 468 points as a mesh in pixels of the screen)
      this.skinScene = new T.Scene();
      this.skinCam = new T.OrthographicCamera(0, 1, 1, 0, -1000, 1000);
      const count = mesh.v.length / 3;
      this.skinPositions = new Float32Array(count * 3);
      const skin = new T.BufferGeometry();
      skin.setAttribute("position", new T.BufferAttribute(this.skinPositions, 3));
      skin.setAttribute("uv", new T.BufferAttribute(new Float32Array(mesh.uv), 2));
      skin.setIndex(new T.BufferAttribute(new Uint16Array(mesh.f), 1));
      this.decalCanvas = document.createElement("canvas");
      this.decalCanvas.width = this.decalCanvas.height = DECAL;
      this.decalTexture = new T.CanvasTexture(this.decalCanvas);
      this.decalTexture.minFilter = T.LinearFilter;
      this.decalTexture.generateMipmaps = false;
      this.skinMesh = new T.Mesh(skin, new T.MeshBasicMaterial({ map: this.decalTexture, transparent: true, depthTest: false, depthWrite: false, side: T.DoubleSide }));
      this.skinMesh.frustumCulled = false;
      this.skinMesh.renderOrder = 2;
      this.skinScene.add(this.skinMesh);
      this.hoodGroup = new T.Group();
      this.hoodGroup.renderOrder = 1;
      this.skinScene.add(this.hoodGroup);

      // pass 3: things in the space of the head
      this.arScene = new T.Scene();
      this.arScene.environment = this.env;
      this.arScene.add(new T.HemisphereLight(0xffffff, 0x8a8f99, 0.9));
      const sun = new T.DirectionalLight(0xffffff, 1.1);
      sun.position.set(-20, 40, 60);
      this.arScene.add(sun);
      this.persp = new T.PerspectiveCamera(FOV, 1, 1, 5000);
      this.head = new T.Group();
      this.head.matrixAutoUpdate = false;
      this.arScene.add(this.head);
      const hide = new T.MeshBasicMaterial({ colorWrite: false, depthWrite: true });         // the head hides what is behind it
      const occluder = new T.BufferGeometry();
      occluder.setAttribute("position", new T.BufferAttribute(new Float32Array(mesh.v), 3));
      occluder.setIndex(new T.BufferAttribute(new Uint16Array(mesh.f), 1));
      const face = new T.Mesh(occluder, hide);
      face.renderOrder = -2;
      const skull = new T.Mesh(new T.SphereGeometry(1, 28, 20), hide);
      skull.scale.set(7.7, 9.4, 8.2);
      skull.position.set(0, 1.4, -3.4);
      skull.renderOrder = -2;
      this.head.add(face, skull);
      this.pose = { pos: new T.Vector3(), quat: new T.Quaternion(), scale: new T.Vector3(1, 1, 1), have: false };
      this.tmp = { m: new T.Matrix4(), pos: new T.Vector3(), quat: new T.Quaternion(), scale: new T.Vector3() };
      this.kit = makeKit(T, this.env);
      this.ready = true;
      this.build();
    }

    setRecipe(recipe) {
      this.recipe = recipe || { fx: [], filter: "none" };
      this.build();
    }
    setMirror(on) { this.mirror = !!on; }

    /* the effects of the recipe that belong to this layer, made ready */
    build() {
      if (!this.ready) return;
      const ids = (this.recipe.fx || []).filter(has);
      const specs = ids.map((id) => EFFECTS[id]);
      this.parts = { warps: specs.filter((s) => s.warp), decals: specs.filter((s) => s.decal), hoods: specs.filter((s) => s.hood), models: specs.filter((s) => s.model) };
      this.needsVideo = this.parts.warps.length > 0;
      for (const entry of this.models) { this.head.remove(entry.object); this.kit.dispose(entry.object); }
      this.models = [];
      for (const spec of this.parts.models) {
        let object = null;
        try { object = spec.model(this.kit); } catch (error) { object = null; }
        if (!object) continue;
        this.head.add(object);
        this.models.push({ spec, object });
      }
      const g = this.decalCanvas.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, DECAL, DECAL);
      const helpers = decalHelpers(this.data, g);
      for (const spec of this.parts.decals) { g.save(); try { spec.decal(g, helpers); } catch (error) { /* one broken decal must not stop the others */ } g.restore(); }
      this.decalTexture.needsUpdate = true;
      this.skinMesh.visible = this.parts.decals.length > 0;
      for (const child of [...this.hoodGroup.children]) { this.hoodGroup.remove(child); child.geometry?.dispose(); child.material?.dispose(); }
      this.hoods = this.parts.hoods.map((spec) => spec.hood(this.kit, this.hoodGroup, helpers)).filter(Boolean);
    }

    resize() {
      const box = this.canvas.getBoundingClientRect();
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const w = Math.max(2, Math.round(box.width * dpr)), h = Math.max(2, Math.round(box.height * dpr));
      if (w !== this.W || h !== this.H) { this.W = w; this.H = h; this.renderer.setSize(w, h, false); }
    }

    /* The face of this moment for the effects: points in pixels of the camera picture (`px`) and of the screen (`scr`), the size, the turn of the head, the mouth. */
    face(frame) {
      const v = this.video;
      const vw = v.videoWidth, vh = v.videoHeight;
      const W = this.W, H = this.H;
      const k = Math.max(W / vw, H / vh);
      const ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;
      const lm = frame.lm;
      const px = (i) => ({ x: lm[i].x * vw, y: lm[i].y * vh });
      const scr = (i) => { const x = lm[i].x * vw * k + ox; return { x: this.mirror ? W - x : x, y: lm[i].y * vh * k + oy }; };
      const a = px(33), b = px(263);
      const roll = Math.atan2(b.y - a.y, b.x - a.x);
      const c1 = px(234), c2 = px(454);
      const s = Math.hypot(c2.x - c1.x, c2.y - c1.y);
      const m1 = px(61), m2 = px(291), l1 = px(13), l2 = px(14);
      const mouth = { x: (m1.x + m2.x) / 2, y: (l1.y + l2.y) / 2, w: Math.hypot(m2.x - m1.x, m2.y - m1.y), h: Math.hypot(l2.x - l1.x, l2.y - l1.y) };
      const top = px(10), chin = px(152);
      return { vw, vh, W, H, k, ox, oy, lm, px, scr, A: SIDE_A, B: SIDE_B, roll, s, mouth, center: { x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2 }, blend: frame.blend || {}, dt: frame.dt, t: frame.t };
    }

    /* one picture: frame = {lm (the 478 points, 0..1), matrix (the pose of the head), blend (the blendshapes), dt, t} or without lm when no face is seen */
    update(frame) {
      if (!this.ready || this.failed) return;
      const v = this.video;
      if (!v.videoWidth || v.readyState < 2) return;
      this.resize();
      const r = this.renderer;
      const W = this.W, H = this.H;
      r.clear(true, true, true);
      const have = !!(frame && frame.lm && frame.lm.length >= 468);
      const uni = this.uniforms;
      if (this.needsVideo) {
        this.videoTexture.needsUpdate = true;                    // (the texture would wait for the callback of the video, which some browsers do not call while the page is in the background)
        const k = Math.max(W / v.videoWidth, H / v.videoHeight);
        uni.uScale.value.set(W / (v.videoWidth * k), H / (v.videoHeight * k));
        uni.uVideoSize.value.set(v.videoWidth, v.videoHeight);
        uni.uMirror.value = this.mirror ? 1 : 0;
        const grade = GRADES[this.recipe.filter] || GRADES.none;
        uni.uGrade.value.set(grade.b, grade.c, grade.s, grade.hue);
        uni.uGrade2.value.set(grade.sepia, grade.gray);
      }
      const f = have ? this.face(frame) : null;
      if (this.needsVideo) {
        let n = 0;
        if (f) {
          for (const spec of this.parts.warps) {
            for (const w of spec.warp(f)) {
              if (n >= 6) break;
              uni.uWarpA.value[n].set(w[0], w[1], Math.max(1, w[2]), Math.max(1, w[3]));
              uni.uWarpB.value[n].set(w[4], w[5], 0, 0);
              n += 1;
            }
          }
        }
        uni.uWarps.value = n;
        r.render(this.bgScene, this.bgCam);
      }
      if (!f) return;
      // the paint on the skin follows the points
      if (this.skinMesh.visible || this.hoods.length) {
        const pos = this.skinPositions;
        for (let i = 0; i < 468; i += 1) { const p = f.scr(i); pos[i * 3] = p.x; pos[i * 3 + 1] = H - p.y; pos[i * 3 + 2] = 0; }
        this.skinMesh.geometry.attributes.position.needsUpdate = true;
        this.skinCam.left = 0; this.skinCam.right = W; this.skinCam.top = H; this.skinCam.bottom = 0;
        this.skinCam.updateProjectionMatrix();
        for (const hood of this.hoods) hood.update?.(f, H);
        r.render(this.skinScene, this.skinCam);
      }
      // the things in the space of the head
      if (this.models.length && frame.matrix) {
        const t = this.tmp;
        t.m.fromArray(frame.matrix);
        t.m.decompose(t.pos, t.quat, t.scale);
        const pose = this.pose;
        const kk = pose.have ? 0.55 : 1;
        pose.pos.lerp(t.pos, kk); pose.quat.slerp(t.quat, kk); pose.scale.lerp(t.scale, kk);
        pose.have = true;
        this.head.matrix.compose(pose.pos, pose.quat, pose.scale);
        this.head.matrixWorldNeedsUpdate = true;
        this.arScene.scale.x = this.mirror ? -1 : 1;
        const fracV = (H / f.k) / f.vh;
        this.persp.fov = (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) * fracV) * 180) / Math.PI;
        this.persp.aspect = W / H;
        this.persp.updateProjectionMatrix();
        for (const entry of this.models) entry.spec.update?.(entry.object, f, this.kit, frame);
        r.clearDepth();
        r.render(this.arScene, this.persp);
      }
    }

    destroy() {
      if (!this.ready) return;
      this.renderer.dispose();
      this.videoTexture.dispose();
      this.decalTexture.dispose();
      this.env.dispose();
      const lose = this.renderer.getContext().getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ helpers for the decals and the models
  /* the map of the face as painting helpers: the places of the points on the picture (u, v) and shapes made of them */
  function decalHelpers(data, g) {
    const uvx = (i) => data.uv[i * 2] * DECAL;
    const uvy = (i) => (1 - data.uv[i * 2 + 1]) * DECAL;
    const at = (i) => ({ x: uvx(i), y: uvy(i) });
    /* a path through points, made bigger (`grow`) around their middle */
    const poly = (ids, grow = 1, about = null) => {
      const pts = ids.map(at);
      const c = about || { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
      g.beginPath();
      pts.forEach((p, n) => { const x = c.x + (p.x - c.x) * grow, y = c.y + (p.y - c.y) * grow; if (n) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath();
      return c;
    };
    let seed = 12345;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    return { DECAL, uvx, uvy, at, poly, rand, size: DECAL, data };
  }

  /* materials and shapes for the models (one set for the lens, cleaned up with it) */
  function makeKit(T, env) {
    const cache = new Map();
    const mat = (color, { rough = 0.5, metal = 0, clear = 0, clearRough = 0.1, emissive = 0, emissiveIntensity = 1, side = T.FrontSide, flat = false, opacity = 1 } = {}) => {
      const key = [color, rough, metal, clear, emissive, side, flat, opacity].join("|");
      if (!cache.has(key)) {
        const m = clear || opacity < 1 ? new T.MeshPhysicalMaterial({ color, roughness: rough, metalness: metal, clearcoat: clear, clearcoatRoughness: clearRough, emissive, emissiveIntensity, side, transparent: opacity < 1, opacity })
          : new T.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity, side, flatShading: flat });
        m.envMapIntensity = 1;
        cache.set(key, m);
      }
      return cache.get(key);
    };
    const mesh = (geometry, material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new T.Mesh(geometry, material); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); return m; };
    /* a rounded rectangle as a shape of three.js */
    const roundedRect = (w, h, r) => {
      const s = new T.Shape();
      const x = -w / 2, y = -h / 2;
      s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
      return s;
    };
    const extrude = (shape, depth, bevel = 0.12) => { const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 18 }); g.translate(0, 0, -depth / 2); return g; };
    const heartShape = (size) => {
      const s = new T.Shape();
      s.moveTo(0, -size * 0.55);
      s.bezierCurveTo(-size * 0.2, -size * 0.35, -size * 0.62, -size * 0.1, -size * 0.62, size * 0.2);
      s.bezierCurveTo(-size * 0.62, size * 0.55, -size * 0.15, size * 0.62, 0, size * 0.3);
      s.bezierCurveTo(size * 0.15, size * 0.62, size * 0.62, size * 0.55, size * 0.62, size * 0.2);
      s.bezierCurveTo(size * 0.62, -size * 0.1, size * 0.2, -size * 0.35, 0, -size * 0.55);
      return s;
    };
    const starShape = (outer, inner, points = 5) => {
      const s = new T.Shape();
      for (let i = 0; i < points * 2; i += 1) { const a = -Math.PI / 2 + (i * Math.PI) / points; const r = i % 2 ? inner : outer; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      s.closePath();
      return s;
    };
    const dispose = (object) => object.traverse((o) => { o.geometry?.dispose(); });
    return { T, env, mat, mesh, roundedRect, extrude, heartShape, starShape, dispose, TAU };
  }

  window.PulseAR = { has, EFFECTS, GRADES, load, FOV, clamp, lerp, TAU, add, Layer, makeKit };
})();
