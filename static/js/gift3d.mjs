/* Satürn 3D presents (gift3d.mjs): the core of everything that is drawn in 3D for the Samojis and the Satürn Chest, with three.js (MIT, static/js/vendor/three), loaded only when it is needed.
   - `thumb(item)`: a picture (data URL) of a Samoji, rendered once and kept; `live(item, size)`: a small canvas where the Samoji turns and lives (for the bill in the sheet).
   - `fly(item, from)`: the Samoji comes out of the present button like smoke -- first to the left, then up -- turning in 3D, with a flash, a ring of light and a trail of glowing puffs.
   - `chest(host, size)` and `chestThumb()`: the Satürn Chest (gift3d-chest.mjs).
   A Samoji is built from the numbers of the catalogue (yipi_samojis.py): a figure (16, in gift3d-figures.mjs), a look (15: colours, gold, silver, neon, glass, a rainbow shimmer) and an extra
   (sparkles, halo, wings, aura). */
import { THREE, TAU, rnd, pick, material, plain, glow, additive, mesh, at, solid, wingShape, Particles, flare } from "/static/js/gift3d-kit.mjs";
import { FIGURES } from "/static/js/gift3d-figures.mjs?v=3";
import { buildChest } from "/static/js/gift3d-chest.mjs?v=12";
import { RoomEnvironment } from "/static/js/vendor/three/RoomEnvironment.js";
import { EffectComposer } from "/static/js/vendor/three/postprocessing/EffectComposer.js";
import { RenderPass } from "/static/js/vendor/three/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "/static/js/vendor/three/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "/static/js/vendor/three/postprocessing/OutputPass.js";

let catalogue = null;                                           // {shapes, palettes, badges}
export const setCatalogue = (data) => { catalogue = data; };

// ------------------------------------------------------------------------------------------------------ extras
function extra(kind, look) {
  const g = new THREE.Group();
  if (kind === 1) {                                              // sparkles that orbit
    const parts = [];
    for (let i = 0; i < 9; i += 1) { const s = mesh(new THREE.OctahedronGeometry(0.09 + (i % 3) * 0.03, 0), glow(i % 2 ? 0xfff2a8 : 0xffffff, 1.6)); parts.push(s); g.add(s); }
    const fx = new Particles({ max: 100 }); g.add(fx.object);
    g.userData.update = (t, dt) => { parts.forEach((s, i) => { const a = t * (1 + (i % 3) * 0.3) + (i / 9) * TAU; const r = 1.1 + (i % 3) * 0.12; s.position.set(Math.cos(a) * r, Math.sin(t * 2 + i) * 0.55, Math.sin(a) * r); s.scale.setScalar(0.6 + Math.abs(Math.sin(t * 4 + i)) * 0.8); s.rotation.y = t * 3; if (Math.random() < 0.15) fx.emit(s.position.x, s.position.y, s.position.z, 0, -0.3, 0, 0.7, 0.1, 0xfff2a8, 1); }); fx.update(dt); };
  } else if (kind === 2) {                                       // a halo above
    const ring = mesh(new THREE.TorusGeometry(0.62, 0.055, 12, 60), glow(0xffd84a, 1.4)); ring.rotation.x = Math.PI / 2; at(ring, 0, 1.55, 0); g.add(ring);
    const glowDisc = flare(0xffe38a, 2.2, 0.5); at(glowDisc, 0, 1.55, 0); g.add(glowDisc);
    g.userData.update = (t) => { ring.position.y = glowDisc.position.y = 1.55 + Math.sin(t * 2.2) * 0.06; ring.material.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.5; glowDisc.material.opacity = 0.4 + Math.sin(t * 4) * 0.15; };
  } else if (kind === 3) {                                       // wings at the sides
    const wings = [];
    for (const side of [-1, 1]) { const w = solid(wingShape(true), 0.04, 0.03, plain(0xffffff, { emissive: 0xdde8ff, emissiveIntensity: 0.4 })); w.geometry.translate(0.55, 0.15, 0); const holder = new THREE.Group(); holder.add(w); holder.position.set(side * 0.5, 0.1, -0.15); holder.scale.set(side * 0.78, 0.78, 0.78); wings.push([holder, side]); g.add(holder); }
    const fx = new Particles({ max: 120, gravity: 0.4 }); g.add(fx.object);
    g.userData.update = (t, dt) => { wings.forEach(([holder, side]) => { holder.rotation.z = Math.sin(t * 4) * 0.26 * side; if (Math.random() < 0.3) fx.emit(side * rnd(0.9, 1.8), rnd(0, 0.9), -0.1, 0, -0.1, 0, 1.2, 0.09, 0xffffff, 0.9); }); fx.update(dt); };
  } else if (kind === 4) {                                       // a glowing aura
    const aura = mesh(new THREE.SphereGeometry(1.25, 32, 20), new THREE.MeshBasicMaterial({ color: look.main === "#ffffff" ? 0xbfd9ff : look.main, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide })); g.add(aura);
    const ring = mesh(new THREE.TorusGeometry(1.3, 0.025, 8, 80), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })); g.add(ring);
    g.userData.update = (t) => { aura.scale.setScalar(1 + Math.sin(t * 3) * 0.07); ring.rotation.x = t * 0.8; ring.rotation.y = t * 0.5; };
  }
  return g;
}

/* One Samoji: {group, frame, update(t), dispose()}; `item` is a row of the catalogue [id, shape, look, badge, price]. */
export function build(item) {
  const [, shape, lookIndex, badge] = item;
  const [, main, accent, finish] = catalogue.palettes[lookIndex];
  const look = { main, accent, finish };
  const root = new THREE.Group();
  const body = FIGURES[shape](look);
  const decoration = extra(badge, look);
  const holder = new THREE.Group();
  holder.add(body);
  let box = new THREE.Box3().setFromObject(holder);
  if (body.userData.bounds) box = new THREE.Box3(new THREE.Vector3(...body.userData.bounds.min), new THREE.Vector3(...body.userData.bounds.max));   // (with its fire and sparks it is bigger than its shapes)
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const fit = 2.2 / Math.max(size.x, size.y * 1.05, size.z * 1.4, 0.001);
  holder.position.sub(centre);
  const frame = new THREE.Group();
  frame.add(holder);
  frame.scale.setScalar(fit * (badge === 2 ? 0.82 : 1));
  if (badge === 2) frame.position.y = -0.18;
  root.add(frame);
  if (badge) root.add(decoration);
  let last = 0;
  const update = (t) => {
    const dt = Math.min(0.05, Math.max(0, t - last)); last = t;
    body.userData.update?.(t, dt);
    decoration.userData.update?.(t, dt);
  };
  const dispose = () => root.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
  return { group: root, frame, update, dispose };
}

// --------------------------------------------------------------------------------------------- shared rendering
function lights(scene, renderer) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a8, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(2.5, 4, 5); scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9bb8ff, 0.8); rim.position.set(-4, 1, -3); scene.add(rim);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
}
const newRenderer = (canvas, size) => { const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); if (size) r.setSize(size, size, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05; r.outputColorSpace = THREE.SRGBColorSpace; return r; };
/* The particles need to know how big a pixel is: for a perspective camera from the height of the picture and the angle, for the flat overlay it is the pixel ratio. */
function particleScale(scene, camera, renderer) {
  const persp = camera.isPerspectiveCamera;
  const scale = persp ? renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360)) : renderer.getPixelRatio();
  scene.traverse((o) => { const u = o.material && o.material.uniforms; if (u && u.uScale) { u.uPersp.value = persp ? 1 : 0; u.uScale.value = scale; } });
}

let thumbKit = null;
function kit() {
  if (!thumbKit) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const renderer = newRenderer(canvas, 0);
    renderer.setPixelRatio(1);
    renderer.setSize(192, 192, false);
    const scene = new THREE.Scene();
    lights(scene, renderer);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0.35, 6.2);
    camera.lookAt(0, 0, 0);
    thumbKit = { canvas, renderer, scene, camera, queue: Promise.resolve() };
  }
  return thumbKit;
}
const thumbs = new Map();
/* A still picture (data URL) of a Samoji, turned a little so that it looks 3D, after a moment of life (so that fire, smoke and sparks are in the picture); made one after the other and kept. */
export function thumb(item) {
  if (thumbs.has(item[0])) return thumbs.get(item[0]);
  const k = kit();
  const made = k.queue.then(() => new Promise((resolve) => setTimeout(() => {
    const sam = build(item);
    sam.group.rotation.y = -0.5;
    sam.group.rotation.x = 0.1;
    k.scene.add(sam.group);
    for (let i = 0; i < 48; i += 1) sam.update(0.2 + i * 0.03);
    particleScale(k.scene, k.camera, k.renderer);
    k.renderer.render(k.scene, k.camera);
    const url = k.canvas.toDataURL("image/png");
    k.scene.remove(sam.group);
    sam.dispose();
    resolve(url);
  }, 0)));
  k.queue = made.catch(() => {});
  thumbs.set(item[0], made);
  return made;
}

/* A small canvas where the Samoji turns and lives (the preview in the bill); returns {canvas, stop()}. */
export function live(item, size = 150) {
  const canvas = document.createElement("canvas");
  const renderer = newRenderer(canvas, size);
  const scene = new THREE.Scene();
  lights(scene, renderer);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
  camera.position.set(0, 0.3, 6);
  camera.lookAt(0, 0, 0);
  const sam = build(item);
  scene.add(sam.group);
  particleScale(scene, camera, renderer);
  let frame = 0;
  const clock = new THREE.Clock();
  const head = 1.3;                                               // (it starts a moment into its life, so that fire and sparks are there at once)
  for (let i = 0; i < 40; i += 1) sam.update(i * head / 40);
  const tick = () => { const t = head + clock.getElapsedTime(); sam.group.rotation.y = Math.sin(t * 0.9) * 0.7 - 0.2; sam.update(t); renderer.render(scene, camera); frame = requestAnimationFrame(tick); };
  tick();
  return { canvas, stop() { cancelAnimationFrame(frame); sam.dispose(); renderer.dispose(); } };
}

// ------------------------------------------------------------------------------------------------------- flight
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const smooth = (x) => x * x * (3 - 2 * x);
let overlay = null;
function flightLayer() {
  if (overlay) return overlay;
  const canvas = document.createElement("canvas");
  canvas.className = "gift-layer";
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:3000;pointer-events:none";
  document.body.append(canvas);
  const renderer = newRenderer(canvas, 0);
  const scene = new THREE.Scene();
  lights(scene, renderer);
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -2000, 2000);
  const sparks = new Particles({ max: 500, gravity: 0, drag: 1.2 });
  const smoke = new Particles({ max: 400, grow: 2.2 });
  scene.add(sparks.object, smoke.object);
  overlay = { canvas, renderer, scene, camera, flights: [], rings: [], sparks, smoke, running: false, w: 0, h: 0, last: 0 };
  return overlay;
}
function resizeLayer(o) {
  const w = window.innerWidth, h = window.innerHeight;
  if (o.w === w && o.h === h) return;
  o.w = w; o.h = h;
  o.renderer.setSize(w, h, false);
  o.camera.left = 0; o.camera.right = w; o.camera.top = h; o.camera.bottom = 0; o.camera.updateProjectionMatrix();
}

/* A ring of light that grows and fades (a shock wave). */
function shock(o, x, y, color, from, to, ms) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), additive(color, 0.8));
  ring.position.set(x, y, -100); ring.scale.setScalar(from);
  o.scene.add(ring);
  o.rings.push({ ring, born: performance.now(), ms, from, to });
}

/* The Samoji comes out of the present at `from` ({x, y} on the screen) like smoke: a flash and a ring of light, then it drifts to the left, rises in a soft curve, growing and turning with its
   own life, and ends at the top in a burst of sparks. */
export function fly(item, from, { delay = 0, duration = 3600, size = 170 } = {}) {
  const o = flightLayer();
  resizeLayer(o);
  const sam = build(item);
  const W = o.w, H = o.h;
  const start = new THREE.Vector3(from.x, H - from.y, 0);
  const path = new THREE.CatmullRomCurve3([
    start.clone(),
    new THREE.Vector3(start.x - W * 0.2, start.y + H * 0.01, 0),
    new THREE.Vector3(start.x - W * 0.42, start.y + H * 0.12, 0),
    new THREE.Vector3(W * 0.3, start.y + H * 0.3, 0),
    new THREE.Vector3(W * 0.46, H * 0.62, 0),
    new THREE.Vector3(W * 0.52, H * 0.8, 0),
  ], false, "catmullrom", 0.5);
  sam.group.visible = false;
  o.scene.add(sam.group);
  const flight = { sam, path, born: performance.now() + delay, duration, size, done: false, started: false, ended: false };
  o.flights.push(flight);
  if (!o.running) { o.running = true; o.last = performance.now(); requestAnimationFrame(frame); }
  return new Promise((resolve) => { flight.resolve = resolve; });
}
function frame(now) {
  const o = overlay;
  if (!o) return;
  resizeLayer(o);
  const dt = Math.min(0.05, (now - o.last) / 1000); o.last = now;
  for (const f of o.flights) {
    const age = now - f.born;
    if (age < 0) continue;
    const k = Math.min(1, age / f.duration);
    if (!f.started) {                                              // the flash at the present button: a ring of light and a spray of sparks
      f.started = true;
      const p0 = f.path.getPoint(0);
      shock(o, p0.x, p0.y, 0xffffff, 10, 150, 700); shock(o, p0.x, p0.y, 0xc79bff, 4, 90, 900);
      for (let i = 0; i < 40; i += 1) { const a = rnd(0, TAU); const sp = rnd(60, 260); o.sparks.emit(p0.x, p0.y, -80, Math.cos(a) * sp, Math.sin(a) * sp, 0, rnd(0.5, 1.0), rnd(10, 22), pick([0xffffff, 0xffe29a, 0xc79bff, 0x9ffbff]), 1); }
    }
    const u = ease(k * 0.96 + 0.02);
    const point = f.path.getPoint(Math.min(1, u));
    const sway = Math.sin(age / 260) * 12 * (1 - k);
    f.sam.group.visible = true;
    f.sam.group.position.set(point.x + sway, point.y, 0);
    const grow = smooth(Math.min(1, k / 0.18)) * (1 + 0.4 * Math.sin(Math.min(1, k) * Math.PI));
    f.sam.group.scale.setScalar(Math.max(0.01, grow) * f.size * 0.5);
    f.sam.group.rotation.set(0.22 + Math.sin(age / 500) * 0.15, age / 520, Math.sin(age / 700) * 0.12);
    f.sam.update(age / 1000);
    const fade = k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1;
    f.sam.group.traverse((m) => { if (m.material && m.material.transparent && !m.material.uniforms) m.material.opacity = Math.min(m.material.userData.keep ?? (m.material.userData.keep = m.material.opacity), 1) * fade; });
    for (let i = 0; i < 3 && k < 0.92; i += 1) o.smoke.emit(point.x + sway + rnd(-14, 14), point.y + rnd(-14, 14), -60, rnd(-25, 25), rnd(15, 45), 0, rnd(0.7, 1.3), rnd(18, 34), new THREE.Color().setHSL(rnd(0.05, 0.95), 0.8, 0.78).getHex(), 0.5);
    if (k >= 1 && !f.ended) {                                      // the end at the top: a burst of sparks
      f.ended = true; f.done = true;
      for (let i = 0; i < 60; i += 1) { const a = rnd(0, TAU); const sp = rnd(80, 340); o.sparks.emit(point.x, point.y, -80, Math.cos(a) * sp, Math.sin(a) * sp, 0, rnd(0.6, 1.3), rnd(10, 24), pick([0xffffff, 0xffe29a, 0xc79bff, 0x9ffbff, 0xff9bd5]), 1); }
      shock(o, point.x, point.y, 0xffe29a, 20, 190, 800);
      o.scene.remove(f.sam.group); f.sam.dispose(); f.resolve?.();
    }
  }
  o.flights = o.flights.filter((f) => !f.done);
  o.rings = o.rings.filter((r) => { const a = (now - r.born) / r.ms; if (a >= 1) { o.scene.remove(r.ring); r.ring.geometry.dispose(); r.ring.material.dispose(); return false; } r.ring.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - a) ** 2)); r.ring.material.opacity = 0.8 * (1 - a); return true; });
  o.sparks.update(dt); o.smoke.update(dt);
  particleScale(o.scene, o.camera, o.renderer);
  o.renderer.render(o.scene, o.camera);
  if (o.flights.length || o.rings.length || o.sparks.live.length || o.smoke.live.length) requestAnimationFrame(frame);
  else { o.running = false; o.renderer.dispose(); o.canvas.remove(); overlay = null; }
}

// ---------------------------------------------------------------------------------------------------- the chest
let chestThumbUrl = null;
/* A picture of the chest, lit up (for the small chest at the side of the videos). */
export function chestThumb() {
  if (chestThumbUrl) return chestThumbUrl;
  chestThumbUrl = new Promise((resolve) => setTimeout(() => {
    const k = kit();
    const c = buildChest();
    c.setMood("ready", 0);
    c.group.rotation.y = 0;
    k.scene.add(c.group);
    for (let i = 0; i < 40; i += 1) c.update(1 + i * 0.03, 0.03);
    k.camera.position.set(0, 1.5, 7.2); k.camera.lookAt(0, 0.1, 0);
    particleScale(k.scene, k.camera, k.renderer);
    k.renderer.render(k.scene, k.camera);
    const url = k.canvas.toDataURL("image/png");
    k.scene.remove(c.group); c.dispose();
    k.camera.position.set(0, 0.35, 6.2); k.camera.lookAt(0, 0, 0);
    resolve(url);
  }, 0));
  return chestThumbUrl;
}

/* The Satürn Chest in a canvas inside `host`. `controller.mood("locked" | "ready")`, `controller.open()` (the show) and `controller.stop()`. */
export function chest(host, size = 240, { bloom = 0 } = {}) {
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const renderer = newRenderer(canvas, size);
  const scene = new THREE.Scene();
  const bg = document.createElement("canvas"); bg.width = 4; bg.height = 256;
  const bgc = bg.getContext("2d"); const grad = bgc.createLinearGradient(0, 0, 0, 256); grad.addColorStop(0, "#2c1b5c"); grad.addColorStop(0.55, "#170d33"); grad.addColorStop(1, "#0b0620"); bgc.fillStyle = grad; bgc.fillRect(0, 0, 4, 256);
  scene.background = new THREE.CanvasTexture(bg);                                 // (a dark stage: bloom needs a background it can glow against)
  lights(scene, renderer);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  camera.position.set(0, 1.8, 6.3);
  camera.lookAt(0, 0.35, 0);
  const c = buildChest();
  scene.add(c.group);
  particleScale(scene, camera, renderer);
  let composer = null;                                            // (an optional glow over everything bright: off by default, it veils the shiny gold)
  if (bloom > 0) { composer = new EffectComposer(renderer); composer.setSize(size, size); composer.addPass(new RenderPass(scene, camera)); composer.addPass(new UnrealBloomPass(new THREE.Vector2(size, size), bloom, 0.3, 1.0)); composer.addPass(new OutputPass()); }
  let frame = 0;
  const clock = new THREE.Clock();
  let last = 0;
  const tick = () => { const t = clock.getElapsedTime(); const dt = Math.min(0.05, t - last); last = t; c.update(t, dt); if (composer) composer.render(); else renderer.render(scene, camera); frame = requestAnimationFrame(tick); };
  tick();
  return {
    canvas,
    mood(name) { if (c.mood() !== name && c.mood() !== "open") c.setMood(name, last); },
    open() { c.open(); },
    stop() { cancelAnimationFrame(frame); c.dispose(); composer?.dispose?.(); renderer.dispose(); canvas.remove(); },
  };
}
