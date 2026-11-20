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

export function buildChest() {
  const root = new THREE.Group();
  const chest = new THREE.Group();
  root.add(chest);
  const purple = new THREE.MeshPhysicalMaterial({ color: 0x7a2cff, roughness: 0.12, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 1, sheenColor: new THREE.Color(0xff9bff), sheenRoughness: 0.3, emissive: 0x4a10c0, emissiveIntensity: 0.15, envMapIntensity: 1.3 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xffe08a, metalness: 0.85, roughness: 0.18, emissive: 0xd9a020, emissiveIntensity: 0.3, envMapIntensity: 1.7 });
  const darkGold = new THREE.MeshStandardMaterial({ color: 0xe0a830, metalness: 0.9, roughness: 0.25, emissive: 0x8a5a10, emissiveIntensity: 0.25, envMapIntensity: 1.6 });
  const rune = new THREE.MeshBasicMaterial({ color: 0x39f0ff, transparent: true, opacity: 0.25 });
  const gems = [];
  const gemMaterial = (hex) => new THREE.MeshPhysicalMaterial({ color: hex, emissive: hex, emissiveIntensity: 0.3, roughness: 0.03, metalness: 0.1, clearcoat: 1 });
  const glowing = (m) => bloom(m);

  // everything is round and bubbly: a chubby body with huge rounded corners, soft pill-shaped bands of gold, big ball feet, round gems, a round lock
  chest.add(roundedBox(3.0, 1.55, 2.1, 0.7, purple));
  const inside = at(roundedBox(2.5, 0.2, 1.6, 0.1, new THREE.MeshBasicMaterial({ color: 0xfff0b0 })), 0, 0.68, 0); chest.add(inside);
  for (const y of [-0.66, 0.66]) chest.add(at(roundedBox(3.12, 0.34, 2.22, 0.17, gold), 0, y, 0));
  for (const x of [-1.12, 1.12]) chest.add(at(roundedBox(0.5, 1.64, 2.22, 0.24, gold), x, 0, 0));
  for (const x of [-1.12, 1.12]) for (const y of [-0.3, 0.3]) chest.add(at(sphere(0.12, darkGold), x, y, 1.12));
  for (const x of [-1.42, 1.42]) for (const z of [-0.86, 0.86]) chest.add(at(sphere(0.37, gold), x, -0.78, z));
  const runes = [];
  for (const [x, w] of [[-0.62, 0.5], [0.62, 0.5]]) { const r = at(new THREE.Mesh(new THREE.CapsuleGeometry(0.03, w, 4, 8), rune), x, -0.4, 1.07); r.rotation.z = Math.PI / 2; runes.push(bloom(r)); chest.add(r); }
  for (const x of [-0.9, -0.5, 0.5, 0.9]) { const r = at(sphere(0.045, rune), x, -0.26, 1.07); runes.push(bloom(r)); chest.add(r); }

  // the lid: a big soft dome with fat round ribs of gold and round gems on the front
  const hinge = new THREE.Group(); at(hinge, 0, 0.78, -1.05);
  const domeShape = new THREE.Shape(); domeShape.absarc(0, 0, 1, 0, Math.PI, false);
  const lidGeometry = new THREE.ExtrudeGeometry(domeShape, { depth: 2.6, bevelEnabled: true, bevelThickness: 0.24, bevelSize: 0.2, bevelSegments: 10, curveSegments: 56 });
  lidGeometry.translate(0, 0, -1.3);
  const lid = new THREE.Mesh(lidGeometry, purple); lid.rotation.y = Math.PI / 2; lid.scale.set(1, 1.1, 1.0); lid.position.set(0, 0, 1.05); hinge.add(lid);
  const rib = (x, depth) => { const g = new THREE.ExtrudeGeometry(domeShape, { depth, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 8, curveSegments: 56 }); g.translate(0, 0, -depth / 2); const m = new THREE.Mesh(g, gold); m.rotation.y = Math.PI / 2; m.scale.set(1.17, 1.26, 1.14); m.position.set(x, 0, 1.05); hinge.add(m); };
  rib(-1.12, 0.3); rib(1.12, 0.3); rib(0, 0.1);
  for (const [x, hex] of [[-0.72, 0xff2d95], [0.72, 0x39f0ff]]) {
    const socket = at(torus(0.3, 0.09, gold), x, 0.62, 1.98); socket.rotation.x = 0.95; hinge.add(socket);
    const g = at(sphere(0.27, gemMaterial(hex), 1, 1.1, 0.8), x, 0.66, 2.04); gems.push(bloom(g)); hinge.add(g);
  }
  // the medallion on top of the lid: a round gold button with the glowing planet
  const medal = new THREE.Group(); at(medal, 0, 1.46, 1.05);
  medal.add(sphere(0.5, gold, 1, 0.34, 1));
  const planetMat = new THREE.MeshStandardMaterial({ color: 0xa86bff, emissive: 0xa86bff, emissiveIntensity: 0.4, roughness: 0.15 });
  const planet = bloom(new THREE.Group()); planet.add(sphere(0.27, planetMat)); planet.position.y = 0.2;
  const planetRing = torus(0.46, 0.05, plain(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.4 })); planetRing.rotation.x = 1.1; planet.add(planetRing);
  medal.add(planet); hinge.add(medal);
  chest.add(hinge);

  // the lock: a round gold plate with a big round keyhole; a round padlock hangs on it while the chest is locked
  const lock = new THREE.Group(); at(lock, 0, 0.42, 1.1);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.2, 40), new THREE.MeshStandardMaterial({ color: 0xffd25a, metalness: 0.9, roughness: 0.28, envMapIntensity: 1.4 })); plate.rotation.x = Math.PI / 2; lock.add(plate);
  const rimRing = at(torus(0.5, 0.06, gold), 0, 0, 0.1); lock.add(rimRing);
  lock.add(at(sphere(0.13, plain(0x120a24), 1, 1, 0.4), 0, 0.1, 0.13), at(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.2, 4, 12), plain(0x120a24)), 0, -0.1, 0.12));
  const padlock = new THREE.Group(); at(padlock, 0, -0.02, 0.3);
  padlock.add(roundedBox(0.68, 0.56, 0.34, 0.26, gold), at(torus(0.22, 0.07, darkGold, Math.PI), 0, 0.3, 0), at(sphere(0.07, plain(0x120a24), 1, 1, 0.5), 0, 0.02, 0.17));
  lock.add(padlock);
  chest.add(lock);

  // light: a glow behind, a soft glow on the floor, a contact shadow, soft rays, the core and the flash of the opening
  const aura = flare(0xb06bff, 3.6, 0); at(aura, 0, 0.4, -1.4); root.add(aura);
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: floorTexture(), color: 0x9b5cff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); floorGlow.rotation.x = -Math.PI / 2; floorGlow.scale.set(5.6, 4.2, 1); at(floorGlow, 0, -1.0, 0.1); root.add(floorGlow);
  const floorGold = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: floorTexture(), color: 0xffc84a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })); floorGold.rotation.x = -Math.PI / 2; floorGold.scale.set(3.4, 2.4, 1); at(floorGold, 0, -0.99, 0.1); root.add(floorGold);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; shadow.scale.set(4.6, 3.0, 1); at(shadow, 0, -0.98, 0.1); root.add(shadow);
  const rayMap = rayTexture();
  const rays = [];
  for (let i = 0; i < 7; i += 1) { const r = new THREE.Mesh(new THREE.PlaneGeometry(1.3 + (i % 3) * 0.6, 4.4), new THREE.MeshBasicMaterial({ map: rayMap, color: pick([0xffe29a, 0xfff2c4, 0xffd0f2]), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); r.position.set((i - 3) * 0.26, 3.0, 0.3 + i * 0.02); r.rotation.z = (i - 3) * 0.14; rays.push(r); root.add(r); }
  const core = flare(0xfff2c4, 1, 0); at(core, 0, 0.95, 0.3); root.add(core);
  const burst = flare(0xffffff, 1, 0); at(burst, 0, 0.9, 0.5); root.add(burst);
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
    chest.rotation.y = Math.sin(t * 0.8) * 0.1 - 0.32;
    chest.position.y = ready ? Math.abs(Math.sin(t * 7)) * 0.16 : Math.sin(t * 1.6) * 0.06;
    chest.rotation.z = ready ? Math.sin(t * 30) * 0.03 : 0;
    purple.emissiveIntensity = 0.1 + dim * (0.3 + (ready ? Math.sin(t * 8) * 0.15 : 0));
    gold.emissiveIntensity = 0.3 + dim * 0.25;
    purple.color.setHex(mood === "locked" ? 0x3a2a8a : 0x7a2cff);
    purple.emissive.setHex(mood === "locked" ? 0x1a1050 : 0x4a10c0);
    purple.sheenColor.setHex(mood === "locked" ? 0x7a6cd0 : 0xff9bff);
    padlock.visible = mood === "locked";
    planetMat.emissiveIntensity = 0.3 + dim * (0.9 + (ready ? Math.sin(t * 9) * 0.6 : Math.sin(t * 2) * 0.2));
    planetRing.material.emissiveIntensity = 0.3 + dim * 0.8;
    planet.rotation.y = t * 1.6;
    gems.forEach((g, i) => { g.material.emissiveIntensity = 0.3 + dim * (1.2 + Math.sin(t * 5 + i) * 0.5); g.rotation.y = t * 2; });
    gemStars.forEach((sp, i) => { const g = gems[i]; const v = dim * Math.max(0, Math.sin(t * 4 + i * 2)) ** 2; sp.material.opacity = v; sp.scale.setScalar(0.5 + v * 0.9); sp.position.set(g.position.x * 1.0, g.position.y + 0.72 + (ready ? Math.abs(Math.sin(t * 7)) * 0.16 : 0), g.position.z + 0.06); sp.material.rotation = t; });
    runes.forEach((r, i) => { r.material.opacity = 0.15 + dim * (0.55 + Math.sin(t * 4 + i) * 0.3); });
    aura.material.opacity = dim * (0.22 + (ready ? Math.sin(t * 8) * 0.08 : 0.03)); aura.scale.setScalar(3.6 + Math.sin(t * 3) * 0.2 + (ready ? 0.5 : 0));
    floorGlow.material.opacity = 0.2 + dim * 0.65 + (ready ? Math.sin(t * 8) * 0.12 : 0); floorGold.material.opacity = dim * 0.5;
    front.intensity = dim * (2 + (ready ? Math.sin(t * 8) * 0.8 : 0)); rimPink.intensity = 1 + dim * 4; rimCyan.intensity = 0.8 + dim * 3.5;
    inside.visible = mood === "open"; pile.visible = mood === "open";
    stars.forEach((sp, i) => { const a = t * 1.3 + i * 0.9; const on = dim > 0.4 ? Math.max(0, Math.sin(t * 3 + i * 1.7)) ** 3 : 0; sp.material.opacity = on; sp.scale.setScalar(0.35 + on * 0.8); sp.position.set(Math.cos(a) * 1.9, 0.4 + Math.sin(a * 1.3 + i) * 0.9, Math.sin(a) * 0.9 + 1.2); sp.material.rotation = t * 0.5; });
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
