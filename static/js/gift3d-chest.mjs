/* Satürn 3D chest (gift3d-chest.mjs): the Satürn Chest. A chunky, candy-glossy purple chest with fat gold trim, a big domed lid, large faceted gems, a medallion with a glowing planet and a gold lock.
   Three moods: "locked" (deep and dark with a padlock: pressing does nothing yet), "ready" (it lights up, bounces and pulses with a rim light and sparkles: tap now!) and "open" (the lid swings up,
   a bright core of light with soft rays, a flash with a ring of light, and a fountain of coins, jewels, stars and confetti). The renderer adds bloom (gift3d.mjs), so everything bright glows.
   `buildChest()` gives {group, update(t, dt), setMood(name, t), open(), mood(), dispose()}. */
import { THREE, TAU, rnd, pick, plain, glow, additive, at, sphere, cyl, cone, torus, roundedBox, Particles, flare } from "/static/js/gift3d-kit.mjs";

const lerp = (a, b, k) => a + (b - a) * k;
/* Marks an object (and everything in it) as glowing: the renderer blurs it into a soft glow (the second layer is the one of the bloom). */
const bloom = (object) => { object.traverse((node) => node.layers.enable(1)); return object; };
const back = (x) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

const texture = (draw) => { const c = document.createElement("canvas"); c.width = c.height = 128; draw(c.getContext("2d")); return new THREE.CanvasTexture(c); };
/* A soft dark spot on the floor under the chest (the contact shadow). */
const shadowTexture = () => texture((g) => { const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64); grad.addColorStop(0, "rgba(0,0,0,0.95)"); grad.addColorStop(0.5, "rgba(0,0,0,0.55)"); grad.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grad; g.fillRect(0, 0, 128, 128); });
/* A soft glow on the floor in the colour of the brand (no hard edges). */
const floorTexture = () => texture((g) => { const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64); grad.addColorStop(0, "rgba(255,255,255,0.95)"); grad.addColorStop(0.45, "rgba(255,255,255,0.45)"); grad.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = grad; g.fillRect(0, 0, 128, 128); });
/* A tall soft ray of light: bright in the middle, fading to all sides and to the top. */
const rayTexture = () => texture((g) => { const h = g.createLinearGradient(0, 0, 0, 128); h.addColorStop(0, "rgba(255,255,255,0)"); h.addColorStop(0.6, "rgba(255,255,255,0.5)"); h.addColorStop(1, "rgba(255,255,255,0.9)"); g.fillStyle = h; g.fillRect(0, 0, 128, 128); g.globalCompositeOperation = "destination-in"; const w = g.createLinearGradient(0, 0, 128, 0); w.addColorStop(0, "rgba(0,0,0,0)"); w.addColorStop(0.5, "rgba(0,0,0,1)"); w.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = w; g.fillRect(0, 0, 128, 128); });
/* A four-pointed star flare. */
const starTexture = () => texture((g) => { g.translate(64, 64); const arm = (len, w) => { g.beginPath(); g.moveTo(0, -len); g.quadraticCurveTo(w, -w, len, 0); g.quadraticCurveTo(w, w, 0, len); g.quadraticCurveTo(-w, w, -len, 0); g.quadraticCurveTo(-w, -w, 0, -len); g.fill(); }; g.fillStyle = "rgba(255,255,255,0.95)"; arm(62, 7); const grad = g.createRadialGradient(0, 0, 0, 0, 0, 22); grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = grad; g.beginPath(); g.arc(0, 0, 22, 0, TAU); g.fill(); });

/* A coin you can read: a gold disc with a raised rim and a star in the middle. */
function coinGeometryAndMaterials() {
  const disc = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 36);
  const rim = new THREE.TorusGeometry(0.27, 0.035, 8, 36); rim.rotateX(Math.PI / 2);
  return { disc, rim };
}

export function buildChest(options = {}) {
  const root = new THREE.Group();
  const chest = new THREE.Group();
  root.add(chest);
  const purple = new THREE.MeshPhysicalMaterial({ color: 0x6b22c8, roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.1, emissive: 0x3a0a90, emissiveIntensity: 0.1, envMapIntensity: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb98a2e, metalness: 0.55, roughness: 0.36, emissive: 0x4a3008, emissiveIntensity: 0.1, envMapIntensity: 1.0 });
  const darkGold = new THREE.MeshStandardMaterial({ color: 0xa27622, metalness: 0.6, roughness: 0.4, emissive: 0x3a2406, emissiveIntensity: 0.1, envMapIntensity: 0.9 });
  const rune = new THREE.MeshBasicMaterial({ color: 0x39f0ff, transparent: true, opacity: 0.25 });
  const gems = [];
  const gemMaterial = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.3, roughness: 0.03, metalness: 0.1, clearcoat: 1 });
  const glowing = (m) => bloom(m);

  // Built to the measurements of the reference sheet (100 px = 1 unit): 2.68 high in all; body 2.97 wide, 2.02 deep, 1.55 high with a slight taper; two gold bands (1.55-1.76 and 1.78-1.98) 3.22 wide and
  // 2.17 deep with square blocks on the corners; a barrel lid 0.7 high over the bands (3.02 wide, 1.94 deep, top corners round with r 0.55); four lilac lines at x = -1.13, -0.51, 0.51, 1.13.
  const M = new THREE.Group(); M.position.y = -0.98; chest.add(M);
  const inlay = new THREE.MeshStandardMaterial({ color: 0xe2bcff, emissive: 0xc79bff, emissiveIntensity: 0.15, roughness: 0.3, metalness: 0 });
  const dark = plain(0x120a24);
  const lines = [];
  const lineMesh = (geometry) => { const m = new THREE.Mesh(geometry, inlay); lines.push(m); return m; };
  /* A box whose edges are all round (radius b); the sizes are the outer ones. */
  const rbox = (w, h, d, b, mat) => {
    const sh = new THREE.Shape(); const x = -(w - 2 * b) / 2; const y = -(h - 2 * b) / 2; const ww = w - 2 * b; const hh = h - 2 * b;
    sh.moveTo(x, y); sh.lineTo(x + ww, y); sh.lineTo(x + ww, y + hh); sh.lineTo(x, y + hh); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 4, curveSegments: 6 });
    g.translate(0, 0, -(d - 2 * b) / 2);
    return new THREE.Mesh(g, mat);
  };
  const dome = (w, h, r) => { const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h - r); sh.absarc(w / 2 - r, h - r, r, 0, Math.PI / 2, false); sh.lineTo(-w / 2 + r, h); sh.absarc(-w / 2 + r, h - r, r, Math.PI / 2, Math.PI, false); sh.lineTo(-w / 2, 0); return sh; };
  const rivet = (r, mat, x, y, z, nx = 0, ny = 0, nz = 1) => { const m = at(sphere(r, mat, 1, 1, 0.6), x, y, z); if (nx) m.rotation.y = Math.sign(nx) * Math.PI / 2; return m; };
  /* A thin line (a row of little bars) along the points [[z, y], ...] on the side of the chest at x. */
  const trace = (group, pts, x, dz = 0, dy = 0, thick = 0.05) => {
    for (let i = 0; i < pts.length - 1; i += 1) {
      const [z1, y1] = pts[i]; const [z2, y2] = pts[i + 1]; const len = Math.hypot(z2 - z1, y2 - y1);
      const bar = lineMesh(new THREE.BoxGeometry(0.03, thick, len + thick * 0.6)); bar.position.set(x, (y1 + y2) / 2 - dy, (z1 + z2) / 2 - dz); bar.rotation.x = -Math.atan2(y2 - y1, z2 - z1); group.add(bar);
    }
  };

  // the body: 2.97 x 1.55 x 2.02, a little narrower at the foot
  const bodyGeometry = rbox(2.98, 1.55, 1.97, 0.12, purple).geometry;
  { const pos = bodyGeometry.attributes.position; for (let i = 0; i < pos.count; i += 1) { const f = (pos.getY(i) + 0.775) / 1.55; const k = 0.99 + 0.01 * f; pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k); } pos.needsUpdate = true; }
  M.add(at(new THREE.Mesh(bodyGeometry, purple), 0, 0.775, 0));
  const inside = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.75), new THREE.MeshBasicMaterial({ color: 0x8a4bff })); inside.rotation.x = -Math.PI / 2; at(inside, 0, 1.775, 0); M.add(inside);
  // the lilac lines: front and back, from the foot to the lid (the bands run over them); the outer ones lean a little with the body
  for (const x of [-1.13, -0.51, 0.51, 1.13]) for (const zs of [-1, 1]) {
    const m = at(lineMesh(new THREE.BoxGeometry(0.065, 1.46, 0.03)), x, 0.8, zs * 0.998);
    if (Math.abs(x) > 1) m.rotation.z = Math.sign(x) * -0.04;
    M.add(m);
  }
  // the framed panel on each side of the body (an upside-down trapezoid with cut corners)
  const bodyFrame = [[-0.68, 1.6], [-0.61, 0.47], [-0.48, 0.33], [0.48, 0.33], [0.61, 0.47], [0.68, 1.6]];
  for (const side of [-1, 1]) trace(M, bodyFrame, side * 1.455);

  // the two gold bands, each a flat bar with a square block on every corner
  const BW = 3.27; const BD = 2.22;
  for (const [yc, h] of [[1.655, 0.21], [1.88, 0.2]]) if (h === 0.21) {
    M.add(at(rbox(3.14, h, 2.09, 0.04, gold), 0, yc, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) { M.add(at(rbox(0.44, h, 0.44, 0.05, gold), x * (BW / 2 - 0.22), yc, z * (BD / 2 - 0.22))); M.add(at(sphere(0.045, darkGold, 1, 1, 0.6), x * (BW / 2 - 0.22), yc, z * BD / 2 + 0.005)); }
  }
  // the four caps on the foot corners
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    M.add(at(rbox(0.53, 0.37, 0.53, 0.09, gold), x * 1.25, 0.185, z * 0.775));
    M.add(at(sphere(0.04, darkGold, 1, 1, 0.6), x * 1.19, 0.2, z * 1.04));
  }
  // the two handles (a rectangular loop on two small plates under the lower band)
  for (const side of [-1, 1]) {
    for (const z of [-0.28, 0.28]) M.add(at(rbox(0.07, 0.29, 0.19, 0.025, gold), side * 1.495, 1.37, z));
    for (const z of [-0.385, 0.385]) M.add(at(rbox(0.11, 0.46, 0.14, 0.04, gold), side * 1.535, 1.16, z));
    M.add(at(rbox(0.11, 0.13, 0.92, 0.04, gold), side * 1.535, 1.0, 0));
    for (const z of [-0.28, 0.28]) M.add(at(sphere(0.03, darkGold, 0.6, 1, 1), side * 1.54, 1.42, z));
  }
  // the three latches on the front: a plate on the lid with a tongue, and under it on the body a U-shaped hook (the two outer ones); in the middle two shields
  const FZ = 1.09;
  for (const x of [-0.88, 0.88]) {
    M.add(at(rbox(0.35, 0.43, 0.07, 0.03, gold), x, 1.915, FZ));
    M.add(at(rbox(0.15, 0.3, 0.06, 0.025, darkGold), x, 1.87, FZ + 0.05));
    for (const [dx, dy] of [[-0.11, 0.17], [0.11, 0.17]]) M.add(at(sphere(0.03, darkGold, 1, 1, 0.6), x + dx, 1.915 + dy, FZ + 0.04));
    M.add(at(rbox(0.35, 0.16, 0.07, 0.03, gold), x, 1.65, FZ));
    for (const dx of [-0.13, 0.13]) M.add(at(rbox(0.09, 0.28, 0.07, 0.03, gold), x + dx, 1.46, FZ));
    M.add(at(rbox(0.35, 0.1, 0.07, 0.03, gold), x, 1.37, FZ));
    M.add(at(rbox(0.13, 0.2, 0.06, 0.025, darkGold), x, 1.6, FZ + 0.05));
  }
  const shield = (pts, depth) => { const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 }); return new THREE.Mesh(g, gold); };
  M.add(at(shield([[-0.215, 1.82], [0.215, 1.82], [0.215, 2.11], [0, 2.2], [-0.215, 2.11]], 0.04), 0, 0, FZ - 0.02));
  M.add(at(rbox(0.13, 0.26, 0.05, 0.02, darkGold), 0, 1.97, FZ + 0.06));
  M.add(at(shield([[-0.215, 1.73], [0.215, 1.73], [0.215, 1.37], [0.11, 1.26], [-0.11, 1.26], [-0.215, 1.37]], 0.04), 0, 0, FZ - 0.02));
  M.add(at(rbox(0.13, 0.26, 0.05, 0.02, darkGold), 0, 1.52, FZ + 0.06));
  for (const [x, y] of [[-0.15, 2.07], [0.15, 2.07], [-0.15, 1.86], [0.15, 1.86], [-0.15, 1.67], [0.15, 1.67], [-0.15, 1.38], [0.15, 1.38]]) M.add(at(sphere(0.03, darkGold, 1, 1, 0.6), x, y, FZ + 0.045));
  // a padlock hangs on the middle shield while the chest is locked
  const padlock = new THREE.Group(); at(padlock, 0, 1.5, FZ + 0.16);
  padlock.add(rbox(0.46, 0.38, 0.22, 0.08, gold), at(torus(0.15, 0.045, darkGold, Math.PI), 0, 0.2, 0), at(sphere(0.05, dark, 1, 1, 0.5), 0, 0.0, 0.11));
  M.add(padlock);
  // rivets: gold ones low on the front and back and on the sides, round purple heads along the edges
  for (const zs of [-1, 1]) {
    for (const x of [-0.9, 0.9]) M.add(at(sphere(0.06, darkGold, 1, 1, 0.6), x, 0.44, zs * 1.0));
    for (const [x, y] of [[-1.34, 2.17], [1.34, 2.17], [-1.34, 1.4], [1.34, 1.4], [-1.27, 0.49], [1.27, 0.49]]) M.add(at(sphere(0.065, purple, 1, 1, 0.7), x, y, zs * 0.99));
  }
  for (const side of [-1, 1]) {
    for (const [z, y] of [[-0.8, 2.12], [0.8, 2.12], [-0.81, 1.37], [0.81, 1.37], [-0.75, 0.49], [0.75, 0.49], [-0.4, 0.49], [0.4, 0.49]]) M.add(at(sphere(0.065, purple, 0.6, 1, 1), side * 1.46, y, z));
    for (const z of [-0.44, 0.44]) M.add(at(sphere(0.06, darkGold, 0.6, 1, 1), side * 1.5, 2.12, z));
  }
  const runes = [];

  // the lid: a barrel (3.02 wide, 1.94 deep, 0.9 high from the lower edge of the upper band to the top), the upper band with its corner blocks, the lines, the framed ends
  const hinge = new THREE.Group(); at(hinge, 0, 1.78, -BD / 2);
  const bt = 0.16; const bs = 0.08;
  const lidGeometry = new THREE.ExtrudeGeometry(dome(1.94 - 2 * bs, 0.9 - 2 * bs, 0.55 - bs), { depth: 3.02 - 2 * bt, bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: 8, curveSegments: 28 });
  lidGeometry.translate(0, bs, -(3.02 - 2 * bt) / 2);
  const lid = new THREE.Mesh(lidGeometry, purple); lid.rotation.y = Math.PI / 2; lid.position.set(0, 0, BD / 2); hinge.add(lid);
  hinge.add(at(rbox(3.14, 0.2, 2.09, 0.04, gold), 0, 0.1, BD / 2));
  for (const x of [-1, 1]) for (const z of [-1, 1]) { hinge.add(at(rbox(0.44, 0.2, 0.44, 0.05, gold), x * (BW / 2 - 0.22), 0.1, BD / 2 + z * (BD / 2 - 0.22))); hinge.add(at(sphere(0.045, darkGold, 1, 1, 0.6), x * (BW / 2 - 0.22), 0.1, BD / 2 + z * BD / 2 + z * 0.005)); }
  for (const x of [-1.13, -0.51, 0.51, 1.13]) {
    const g = new THREE.ExtrudeGeometry(dome(1.94 - 2 * bs, 0.9 - 2 * bs, 0.55 - bs), { depth: 0.045, bevelEnabled: true, bevelThickness: 0.01, bevelSize: bs + 0.014, bevelSegments: 3, curveSegments: 28 });
    g.translate(0, bs, -0.0225);
    const m = lineMesh(g); m.rotation.y = Math.PI / 2; m.position.set(x, 0, BD / 2); hinge.add(m);
  }
  const arch = []; { const r = 0.4; const cz = 0.71 - r; for (let a = 180; a >= 90; a -= 15) arch.push([-cz + r * Math.cos(a * Math.PI / 180), 2.06 + r * Math.sin(a * Math.PI / 180)]); for (let a = 90; a >= 0; a -= 15) arch.push([cz + r * Math.cos(a * Math.PI / 180), 2.06 + r * Math.sin(a * Math.PI / 180)]); arch.unshift([-0.71, 1.98]); arch.push([0.71, 1.98]); }
  for (const side of [-1, 1]) trace(hinge, arch, side * 1.515, -BD / 2, 1.78);
  for (const x of [-0.9, 0.9]) for (const z of [-0.57, 0.57]) hinge.add(at(sphere(0.06, darkGold, 1, 0.6, 1), x, 0.9, BD / 2 + z));
  M.add(hinge);
  // two small hinge plates at the back
  for (const x of [-0.85, 0, 0.85]) M.add(at(rbox(0.4, 0.3, 0.1, 0.04, gold), x, 1.88, -BD / 2 + 0.01));

  // light: a glow behind, a soft glow on the floor, a contact shadow, soft rays, the core and the flash of the opening
  const aura = flare(0xb06bff, 3.6, 0); at(aura, 0, 0.4, -1.4); root.add(aura);
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: floorTexture(), color: 0x9b5cff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); floorGlow.rotation.x = -Math.PI / 2; floorGlow.scale.set(5.6, 4.2, 1); at(floorGlow, 0, -1.0, 0.1); root.add(floorGlow);
  const floorGold = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: floorTexture(), color: 0xffc84a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); floorGold.rotation.x = -Math.PI / 2; floorGold.scale.set(3.4, 2.4, 1); at(floorGold, 0, -0.99, 0.1); root.add(floorGold);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.scale.set(4.6, 3.0, 1); at(shadow, 0, -0.98, 0.1); root.add(shadow);
  const rayMap = rayTexture();
  const rays = [];
  for (let i = 0; i < 7; i += 1) { const r = new THREE.Mesh(new THREE.PlaneGeometry(1.3 + (i % 3) * 0.6, 4.4), new THREE.MeshBasicMaterial({ map: rayMap, color: pick([0xc9a2ff, 0xe3d0ff, 0xffd0f2]), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); r.position.set((i - 3) * 0.26, 3.0, 0.3 + i * 0.02); r.rotation.z = (i - 3) * 0.14; rays.push(r); root.add(r); }
  const core = flare(0xdcc0ff, 1, 0); at(core, 0, 0.95, 0.3); root.add(core);
  const burst = flare(0xf0e2ff, 1, 0); at(burst, 0, 0.9, 0.5); root.add(burst);
  const shock = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64), additive(0xffffff, 0)); at(shock, 0, 0.85, 0.5); root.add(shock);
  const key = new THREE.PointLight(0xffd36a, 0, 12); at(key, 0, 1.3, 0.8); root.add(key);
  const front = new THREE.PointLight(0x9b5cff, 0, 10); at(front, 0, 2.2, 3.4); root.add(front);
  const rimPink = new THREE.PointLight(0xff5fd0, 0, 12); at(rimPink, -2.8, 1.4, -1.2); root.add(rimPink);
  const rimCyan = new THREE.PointLight(0x39f0ff, 0, 12); at(rimCyan, 2.8, 1.2, -1.2); root.add(rimCyan);
  const sparkles = new Particles({ max: 260, gravity: -0.05 });
  const fountain = new Particles({ max: 320, gravity: 5.5, grow: 0.9 });
  const confetti = new Particles({ max: 240, gravity: 2.4, additive: false, grow: 1 });
  root.add(sparkles.object, bloom(fountain.object), confetti.object);
  const stars = [];
  const starMap = starTexture();
  for (let i = 0; i < 7; i += 1) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starMap, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); sp.scale.setScalar(0.5); stars.push(sp); root.add(sp); }
  const gemStars = gems.map(() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: starMap, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); root.add(sp); return sp; });
  const coins = [];
  const { disc, rim: rimGeometry } = coinGeometryAndMaterials();
  const coinMaterial = new THREE.MeshStandardMaterial({ color: 0xffd54a, metalness: 1, roughness: 0.16, emissive: 0xa06a00, emissiveIntensity: 0.55, envMapIntensity: 2 });
  const coinFace = new THREE.MeshStandardMaterial({ color: 0xffeaa0, metalness: 1, roughness: 0.25, emissive: 0xb07a10, emissiveIntensity: 0.5 });
  const jewelGeometry = new THREE.SphereGeometry(0.2, 18, 14);
  const makeCoin = () => { const c = new THREE.Group(); c.add(new THREE.Mesh(disc, coinMaterial), new THREE.Mesh(rimGeometry, coinFace)); const star = new THREE.Mesh(new THREE.CircleGeometry(0.12, 5), coinFace); star.rotation.x = -Math.PI / 2; star.position.y = 0.045; c.add(star); return c; };
  const pile = new THREE.Group(); at(pile, 0, 0.66, 0);
  for (let i = 0; i < 6; i += 1) { const c = makeCoin(); c.position.set(-0.7 + i * 0.28, rnd(0, 0.1), rnd(-0.3, 0.3)); c.rotation.set(rnd(-0.6, 0.6), rnd(0, TAU), rnd(-0.6, 0.6)); c.scale.setScalar(1.1); pile.add(c); }
  pile.visible = false; root.add(bloom(pile));

  let mood = "locked";
  let moodAt = 0; let dim = 0;
  const setMood = (name, t = 0) => { mood = name; moodAt = t; };
  let lastT = 0;
  const update = (t, dt) => {
    lastT = t;
    dim = lerp(dim, mood === "locked" ? 0 : 1, 0.08);                          // how lit the chest is (0 dull, 1 shining)
    const ready = mood === "ready";
    if (options.still) { chest.rotation.set(options.x || 0, options.y || 0, 0); chest.position.y = 0; } else {
      chest.rotation.y = Math.sin(t * 0.8) * 0.1 + 0.5;
      chest.position.y = ready ? Math.abs(Math.sin(t * 7)) * 0.16 : Math.sin(t * 1.6) * 0.06;
      chest.rotation.z = ready ? Math.sin(t * 30) * 0.03 : 0;
    }
    purple.emissiveIntensity = 0.1 + dim * (0.3 + (ready ? Math.sin(t * 8) * 0.15 : 0));
    gold.emissiveIntensity = 0.3 + dim * 0.25;
    purple.color.setHex(mood === "locked" ? 0x3a2a8a : 0x7a2cff);
    purple.emissive.setHex(mood === "locked" ? 0x1a1050 : 0x4a10c0);
    purple.sheenColor.setHex(mood === "locked" ? 0x7a6cd0 : 0xff9bff);
    padlock.visible = mood === "locked";
    inlay.emissiveIntensity = 0.12 + dim * (0.25 + (ready ? Math.sin(t * 9) * 0.15 : Math.sin(t * 2) * 0.05));
    gems.forEach((g, i) => { g.material.emissiveIntensity = 0.3 + dim * (1.2 + Math.sin(t * 5 + i) * 0.5); g.rotation.y = t * 2; });
    gemStars.forEach((sp, i) => { const g = gems[i]; const v = dim * Math.max(0, Math.sin(t * 4 + i * 2)) ** 2; sp.material.opacity = v; sp.scale.setScalar(0.5 + v * 0.9); sp.position.set(g.position.x * 1.0, g.position.y + 0.72 + (ready ? Math.abs(Math.sin(t * 7)) * 0.16 : 0), g.position.z + 0.06); sp.material.rotation = t; });
    runes.forEach((r, i) => { r.material.opacity = 0.15 + dim * (0.55 + Math.sin(t * 4 + i) * 0.3); });
    aura.material.opacity = dim * (0.22 + (ready ? Math.sin(t * 8) * 0.08 : 0.03)); aura.scale.setScalar(3.6 + Math.sin(t * 3) * 0.2 + (ready ? 0.5 : 0));
    floorGlow.material.opacity = 0.2 + dim * 0.65 + (ready ? Math.sin(t * 8) * 0.12 : 0); floorGold.material.opacity = dim * 0.5;
    front.intensity = dim * (2 + (ready ? Math.sin(t * 8) * 0.8 : 0)); rimPink.intensity = 1 + dim * 4; rimCyan.intensity = 0.8 + dim * 3.5;
    inside.visible = mood === "open"; pile.visible = mood === "open";
    stars.forEach((sp, i) => { const a = t * 1.3 + i * 0.9; const on = dim > 0.4 ? Math.max(0, Math.sin(t * 3 + i * 1.7)) ** 3 : 0; sp.material.opacity = on; sp.scale.setScalar(0.3 + on * 0.5); sp.position.set(Math.cos(a) * 2.3, 0.4 + Math.sin(a * 1.3 + i) * 1.1, -1.4 - Math.abs(Math.sin(a)) * 0.6); sp.material.rotation = t * 0.5; });
    if (mood !== "open") hinge.rotation.x = 0;
    if (dim > 0.4 && Math.random() < 0.45 + (ready ? 0.4 : 0)) sparkles.emit(rnd(-1.8, 1.8), rnd(-0.7, 1.3), rnd(-0.6, 1.5), rnd(-0.2, 0.2), rnd(0.4, 1.1), 0, rnd(0.8, 1.5), rnd(0.1, 0.22), pick([0xffffff, 0xffe9a6, 0xc79bff, 0x9ffbff, 0xff9bd5]), 0.95);
    if (mood === "open") {
      const k = Math.min(1, (t - moodAt) / 0.7);
      hinge.rotation.x = -back(k) * 2.1;
      const f = Math.max(0, 1 - (t - moodAt) / 0.5);
      burst.material.opacity = f; burst.scale.setScalar(2.2 + (1 - f) * 5);
      core.material.opacity = Math.min(1, (t - moodAt) * 3) * (0.8 + Math.sin(t * 10) * 0.15); core.scale.setScalar(2.4 + Math.sin(t * 6) * 0.2);
      shock.material.opacity = Math.max(0, 0.95 - (t - moodAt) * 1.5); shock.scale.setScalar(1 + (t - moodAt) * 8);
      rays.forEach((r, i) => { r.material.opacity = Math.min(0.4, (t - moodAt) * 0.9) * (0.65 + Math.sin(t * 6 + i * 1.3) * 0.35); r.rotation.z = (i - 3) * 0.14 + Math.sin(t * 0.9 + i) * 0.05; });
      key.intensity = 8 * f + 3;
      if (t - moodAt < 1.8 && Math.random() < 0.9) fountain.emit(rnd(-0.5, 0.5), 0.95, rnd(-0.3, 0.5), rnd(-1.8, 1.8), rnd(3.4, 7), rnd(0, 1.6), rnd(0.9, 1.6), rnd(0.2, 0.36), pick([0xffd54a, 0xfff2a8, 0xff9bd5, 0x9ffbff]), 1);
      if (t - moodAt < 1.4) for (let i = 0; i < 3; i += 1) confetti.emit(rnd(-0.6, 0.6), 1.0, rnd(-0.3, 0.6), rnd(-2.6, 2.6), rnd(3, 6.5), rnd(0, 2), rnd(1.2, 2.2), rnd(0.12, 0.2), pick([0xff2d95, 0x39f0ff, 0xffd84a, 0x43d17a, 0xc86bff]), 1);
    } else { burst.material.opacity = 0; core.material.opacity = 0; shock.material.opacity = 0; rays.forEach((r) => { r.material.opacity = 0; }); key.intensity = ready ? 3 + Math.sin(t * 9) * 1.2 : 0; }
    for (const c of coins) {
      c.userData.vy -= 10 * dt; c.position.x += c.userData.vx * dt; c.position.y += c.userData.vy * dt; c.position.z += c.userData.vz * dt;
      c.rotation.x += c.userData.spin; c.rotation.z += c.userData.spin * 0.7;
      if (c.position.y < -0.7 && c.userData.vy < 0) { c.userData.vy *= -0.36; c.userData.vx *= 0.7; c.userData.vz *= 0.7; if (Math.abs(c.userData.vy) < 0.7) { c.userData.vy = 0; c.userData.vx = 0; c.userData.vz = 0; c.userData.spin = 0; } }
    }
    sparkles.update(dt); fountain.update(dt); confetti.update(dt);
  };
  const open = () => {
    mood = "open"; moodAt = lastT;
    for (let i = 0; i < 16; i += 1) {                                           // few coins, but big and readable
      const gem = i % 5 === 0;
      const c = gem ? new THREE.Mesh(jewelGeometry, new THREE.MeshPhysicalMaterial({ color: pick([0xff2d95, 0x39f0ff, 0x43d17a, 0xffd84a]), emissive: 0x333333, roughness: 0.05, metalness: 0.2, clearcoat: 1 })) : makeCoin();
      c.position.set(rnd(-0.9, 0.9), 0.95, rnd(-0.4, 0.7));
      const fan = (i / 16 - 0.5) * 2; c.userData = { vx: fan * 3.2 + rnd(-0.4, 0.4), vy: rnd(4.2, 7.4), vz: rnd(0.2, 2.2), spin: rnd(-0.3, 0.3) };
      c.scale.setScalar(rnd(1.0, 1.5));
      root.add(bloom(c)); coins.push(c);
    }
  };
  const dispose = () => root.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); }); });
  return { group: root, update, setMood, open, dispose, mood: () => mood };
}
