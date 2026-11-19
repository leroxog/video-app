/* Satürn 3D figures (gift3d-figures.mjs): the 16 figures of the Samojis, each one built from shapes in three.js and alive: a comet with a burning tail, a panda that waves, a dancing robot, a storm cloud
   with lightning, a rocket that blasts off, a butterfly, a rose that opens, a crown with orbiting jewels, a firework, a spiral galaxy, a UFO with a beam, a roaring lion, a diamond ring, a sports car
   that drifts, a whale and a fire-breathing dragon. A figure is a function (look) => group; `group.userData.update(t, dt)` moves it, `group.userData.bounds` says how big it is with its effects.
   The list has the same order as the names in yipi_samojis.py. */
import { THREE, TAU, rnd, pick, material, plain, glow, additive, mesh, at, sphere, cyl, cone, torus, capsule, solid, roundedBox, lathe, batWingShape, wingShape, Particles, flare, palette } from "/static/js/gift3d-kit.mjs";

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const box = (min, max) => ({ min, max });

// 0 ------------------------------------------------------------------------------------------------- Komet
function komet(look) {
  const g = new THREE.Group();
  const geometry = new THREE.IcosahedronGeometry(0.62, 2);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) { v.fromBufferAttribute(pos, i); v.multiplyScalar(1 + (Math.sin(v.x * 7) + Math.sin(v.y * 9) + Math.sin(v.z * 8)) * 0.07); pos.setXYZ(i, v.x, v.y, v.z); }
  geometry.computeVertexNormals();
  const rock = mesh(geometry, material(look, "main", { flatShading: true, emissive: new THREE.Color(0xff5a1f), emissiveIntensity: 0.45 }));
  const halo = flare(0xffa040, 2.8, 0.9);
  const fx = new Particles({ max: 280, grow: 2.4 });
  g.add(rock, halo, fx.object);
  g.userData.bounds = box([-2.6, -0.9, -0.9], [0.9, 0.9, 0.9]);
  g.userData.update = (t, dt) => {
    rock.rotation.x = t * 1.2; rock.rotation.y = t * 0.8;
    halo.material.opacity = 0.75 + Math.sin(t * 9) * 0.2;
    for (let i = 0; i < 4; i += 1) fx.emit(-0.35, rnd(-0.18, 0.18), rnd(-0.18, 0.18), rnd(-2.8, -1.5), rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(0.7, 1.3), rnd(0.4, 0.7), pick([0xffd24a, 0xff8a2a, 0xff4a1f, look.main]), 0.9);
    fx.update(dt);
    g.rotation.z = 0.25 + Math.sin(t * 1.3) * 0.06;
  };
  return g;
}

// 1 -------------------------------------------------------------------------------------------------- Panda
function panda(look) {
  const g = new THREE.Group();
  const white = material(look);
  const dark = material(look, "accent");
  const body = sphere(0.78, white, 1, 1.05, 0.95); at(body, 0, -0.62, 0);
  const belly = sphere(0.55, plain(0xffffff, { roughness: 0.6 }), 1, 1, 0.5); at(belly, 0, -0.6, 0.5);
  const head = new THREE.Group(); at(head, 0, 0.5, 0);
  head.add(sphere(0.72, white, 1.08, 0.95, 0.98));
  for (const s of [-1, 1]) {
    head.add(at(sphere(0.24, dark), s * 0.55, 0.62, -0.05));
    head.add(at(sphere(0.13, plain(0xffb3c7)), s * 0.55, 0.62, 0.1));
    const patch = at(sphere(0.2, dark, 0.8, 1.15, 0.5), s * 0.29, 0.1, 0.62); patch.rotation.z = s * 0.35; head.add(patch);
    head.add(at(sphere(0.085, plain(0xffffff)), s * 0.29, 0.14, 0.7));
    head.add(at(sphere(0.045, plain(0x101018)), s * 0.29, 0.14, 0.77));
    head.add(at(sphere(0.12, plain(0xff8fb0, { transparent: true, opacity: 0.55 }), 1, 0.7, 0.4), s * 0.5, -0.2, 0.55));
  }
  head.add(at(sphere(0.12, dark, 1.3, 0.85, 0.8), 0, -0.04, 0.76));
  const smile = at(torus(0.1, 0.018, plain(0x2a2a30), Math.PI), 0, -0.2, 0.7); smile.rotation.z = Math.PI; head.add(smile);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); at(arm, s * 0.82, -0.3, 0.05);
    arm.add(at(capsule(0.2, 0.55, dark), 0, -0.3, 0)); arm.add(at(sphere(0.22, dark), 0, -0.68, 0));
    arms.push(arm); g.add(arm);
    g.add(at(sphere(0.3, dark, 1, 0.9, 1.1), s * 0.45, -1.3, 0.25));
  }
  const bamboo = new THREE.Group(); at(bamboo, 0.4, -0.55, 0.65);
  for (let i = 0; i < 3; i += 1) bamboo.add(at(cyl(0.05, 0.05, 0.5, plain(0x6bbf59)), 0, i * 0.5 - 0.2, 0));
  for (let i = 0; i < 3; i += 1) { bamboo.add(at(torus(0.055, 0.015, plain(0x3f8f3a)), 0, i * 0.5 + 0.05, 0).rotateX(Math.PI / 2)); }
  for (const [y, s] of [[1.1, 1], [0.9, -1]]) { const leaf = at(sphere(0.2, plain(0x3fae4a), 1.7, 0.18, 0.7), s * 0.2, y, 0); leaf.rotation.z = s * 0.5; bamboo.add(leaf); }
  g.add(body, belly, head, bamboo);
  g.userData.update = (t) => {
    g.position.y = Math.abs(Math.sin(t * 3)) * 0.12;
    head.rotation.z = Math.sin(t * 2) * 0.12; head.rotation.y = Math.sin(t * 1.4) * 0.25;
    arms[1].rotation.z = -0.4 - Math.abs(Math.sin(t * 5)) * 1.0;
    arms[0].rotation.z = 0.2 + Math.sin(t * 3) * 0.1;
    bamboo.rotation.z = Math.sin(t * 3) * 0.1;
    const blink = Math.sin(t * 1.7) > 0.96 ? 0.15 : 1;
    head.children.forEach((c) => { if (c.userData.eye) c.scale.y = blink; });
  };
  return g;
}

// 2 ------------------------------------------------------------------------------------------------- Roboter
function roboter(look) {
  const g = new THREE.Group();
  const shell = material(look);
  const trim = material(look, "accent");
  const cyan = glow(0x39f0ff, 1.6);
  const body = roundedBox(1.15, 1.05, 0.8, 0.24, shell); at(body, 0, -0.55, 0);
  const chest = at(sphere(0.16, glow(0xff4d8d, 1.6), 1, 1, 0.4), 0, -0.5, 0.42);
  const panel = at(roundedBox(0.6, 0.2, 0.06, 0.05, trim), 0, -0.82, 0.41);
  const head = new THREE.Group(); at(head, 0, 0.55, 0);
  head.add(roundedBox(1.35, 1.0, 0.95, 0.3, shell));
  const visor = at(roundedBox(1.05, 0.5, 0.1, 0.2, plain(0x0e1020, { roughness: 0.2, metalness: 0.8 })), 0, 0.02, 0.48); head.add(visor);
  const eyes = [];
  for (const s of [-1, 1]) { const e = at(sphere(0.13, cyan, 1, 1.15, 0.5), s * 0.27, 0.04, 0.55); eyes.push(e); head.add(e); head.add(at(cyl(0.12, 0.12, 0.3, trim), s * 0.72, 0, 0).rotateZ(Math.PI / 2)); }
  head.add(at(cyl(0.035, 0.035, 0.45, plain(0xcfd3dc)), 0, 0.72, 0));
  const bulb = at(sphere(0.12, glow(0xff4d8d, 1.8)), 0, 1.0, 0); head.add(bulb);
  const arms = [];
  for (const s of [-1, 1]) { const a = new THREE.Group(); at(a, s * 0.78, -0.35, 0); a.add(at(capsule(0.12, 0.5, trim), 0, -0.3, 0)); a.add(at(sphere(0.17, shell), 0, -0.65, 0)); arms.push(a); g.add(a); g.add(at(cyl(0.14, 0.17, 0.5, trim), s * 0.32, -1.35, 0)); g.add(at(roundedBox(0.4, 0.18, 0.55, 0.08, shell), s * 0.32, -1.65, 0.08)); }
  const fx = new Particles({ max: 80 });
  g.add(body, chest, panel, head, fx.object);
  g.userData.bounds = box([-1.2, -1.8, -0.9], [1.2, 1.5, 0.9]);
  g.userData.update = (t, dt) => {
    g.position.y = Math.abs(Math.sin(t * 4)) * 0.1; g.rotation.y = Math.sin(t * 2) * 0.35;
    head.rotation.z = Math.sin(t * 4) * 0.1;
    arms[0].rotation.z = 0.7 + Math.sin(t * 8) * 0.5; arms[1].rotation.z = -0.7 - Math.sin(t * 8 + 1) * 0.5;
    const blink = Math.sin(t * 1.3) > 0.95 ? 0.1 : 1; eyes.forEach((e) => { e.scale.y = 1.15 * blink; });
    bulb.material.emissiveIntensity = 1.2 + Math.sin(t * 6) * 0.8; chest.material.emissiveIntensity = 1.2 + Math.sin(t * 5) * 0.8;
    if (Math.random() < 0.3) fx.emit(rnd(-0.2, 0.2), 1.1, 0, rnd(-0.6, 0.6), rnd(0.5, 1.2), rnd(-0.4, 0.4), 0.7, 0.18, pick([0x39f0ff, 0xffffff, 0xff4d8d]), 1);
    fx.update(dt);
  };
  return g;
}

// 3 ------------------------------------------------------------------------------------------------ Gewitter
function gewitter(look) {
  const g = new THREE.Group();
  const cloudMaterial = material(look, "main", { roughness: 0.9 });
  const cloud = new THREE.Group();
  for (const [x, y, z, r] of [[-0.8, -0.1, 0, 0.6], [-0.3, 0.3, 0.1, 0.75], [0.35, 0.35, 0, 0.8], [0.9, -0.05, 0.05, 0.6], [0, -0.2, 0.3, 0.7], [-0.4, -0.2, -0.3, 0.6], [0.5, -0.2, -0.3, 0.6]]) cloud.add(at(sphere(r, cloudMaterial), x, y, z));
  at(cloud, 0, 0.55, 0);
  const bolts = [];
  for (let b = 0; b < 3; b += 1) {
    const points = [V(rnd(-0.4, 0.4), -0.1, 0.2)];
    for (let i = 1; i <= 6; i += 1) points.push(V(points[i - 1].x + rnd(-0.28, 0.28), -0.1 - i * 0.28, 0.2 + rnd(-0.05, 0.05)));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.1), 40, 0.055, 6), new THREE.MeshBasicMaterial({ color: 0xfff4a8 }));
    tube.visible = false; bolts.push(tube); g.add(tube);
  }
  const flash = new THREE.PointLight(0xfff4a8, 0, 8); at(flash, 0, 0, 1.2);
  const rain = new Particles({ max: 160, additive: false });
  g.add(cloud, flash, rain.object);
  g.userData.bounds = box([-1.6, -1.8, -0.9], [1.6, 1.3, 0.9]);
  let nextFlash = 1.42; let flashUntil = 0; let bolt = 0;
  g.userData.update = (t, dt) => {
    cloud.position.y = 0.55 + Math.sin(t * 1.4) * 0.05;
    if (t > nextFlash) { nextFlash = t + rnd(0.9, 1.8); flashUntil = t + 0.28; bolt = Math.floor(rnd(0, 3)); }
    const on = t < flashUntil && Math.floor(t * 30) % 3 !== 0;
    bolts.forEach((b, i) => { b.visible = on && i === bolt; });
    flash.intensity = on ? 30 : 0;
    cloudMaterial.emissive = new THREE.Color(on ? 0xfff4a8 : 0x000000); cloudMaterial.emissiveIntensity = on ? 0.9 : 0;
    for (let i = 0; i < 4; i += 1) rain.emit(rnd(-1.1, 1.1), 0.1, rnd(-0.3, 0.3), 0, rnd(-3.4, -2.6), 0, 0.55, 0.1, pick([0x7ec8ff, 0xb8e2ff]), 0.9);
    rain.update(dt);
  };
  return g;
}

// 4 -------------------------------------------------------------------------------------------------- Rakete
function rakete(look) {
  const g = new THREE.Group();
  const shell = material(look); const trim = material(look, "accent");
  const rocket = new THREE.Group();
  rocket.add(lathe([[0, -1], [0.38, -0.95], [0.52, -0.2], [0.46, 0.55], [0.3, 1.0], [0.12, 1.3], [0, 1.45]], shell));
  rocket.add(at(lathe([[0, 0.9], [0.24, 0.9], [0.14, 1.34], [0, 1.45]], trim), 0, 0.02, 0));
  for (const y of [-0.55, 0.25]) rocket.add(at(torus(0.5 - (y > 0 ? 0.03 : 0), 0.035, plain(0xdadae6)), 0, y, 0).rotateX(Math.PI / 2));
  for (const y of [0.3, -0.25]) { rocket.add(at(torus(0.17, 0.045, plain(0xe6e6f0)), 0, y + 0.1, 0.47)); rocket.add(at(sphere(0.15, plain(0x9bd7ff, { emissive: 0x2a7fb0, emissiveIntensity: 0.7 }), 1, 1, 0.3), 0, y + 0.1, 0.48)); }
  for (let i = 0; i < 3; i += 1) { const a = (i / 3) * TAU; const fin = mesh(new THREE.ConeGeometry(0.3, 0.9, 4), trim); fin.scale.set(1, 1, 0.22); fin.position.set(Math.cos(a) * 0.52, -0.78, Math.sin(a) * 0.52); fin.rotation.y = -a; rocket.add(fin); }
  rocket.add(at(cyl(0.22, 0.3, 0.18, plain(0x555a66)), 0, -1.05, 0));
  const fire = new Particles({ max: 320, grow: 1.8 });
  const smoke = new Particles({ max: 160, additive: false, grow: 3 });
  g.add(rocket, fire.object, smoke.object);
  g.userData.bounds = box([-1.0, -3.0, -1.0], [1.0, 1.5, 1.0]);
  g.userData.update = (t, dt) => {
    rocket.position.set(Math.sin(t * 40) * 0.012, Math.sin(t * 2.2) * 0.12, 0);
    for (let i = 0; i < 5; i += 1) fire.emit(rnd(-0.12, 0.12), -1.15, rnd(-0.12, 0.12), rnd(-0.25, 0.25), rnd(-3.4, -2.2), rnd(-0.25, 0.25), rnd(0.35, 0.7), rnd(0.35, 0.65), pick([0xffe27a, 0xffa23a, 0xff5a1f]), 0.95);
    if (Math.random() < 0.6) smoke.emit(rnd(-0.2, 0.2), -1.5, rnd(-0.2, 0.2), rnd(-0.4, 0.4), rnd(-1.4, -0.8), rnd(-0.3, 0.3), rnd(0.9, 1.5), rnd(0.35, 0.5), 0x9a9aa6, 0.35);
    fire.update(dt); smoke.update(dt);
    g.rotation.z = -0.55;
  };
  return g;
}

// 5 ------------------------------------------------------------------------------------------- Schmetterling
function schmetterling(look) {
  const g = new THREE.Group();
  const wings = [];
  const make = (big, side) => {
    const w = solid(wingShape(big), 0.05, 0.035, material(look, big ? "main" : "accent")); w.geometry.translate(0.7, 0, 0);
    const spot = at(sphere(big ? 0.16 : 0.1, glow(0xffffff, 0.8), 1, 1, 0.3), 0.85, big ? 0.5 : -0.5, 0.06); const holder = new THREE.Group(); holder.add(w, spot);
    holder.scale.set(side, 1.25, 1); g.add(holder); wings.push([holder, side]);
  };
  for (const side of [-1, 1]) { make(true, side); make(false, side); }
  g.add(at(capsule(0.1, 0.95, plain(0x2a2a30)), 0, -0.05, 0), at(sphere(0.13, plain(0x2a2a30)), 0, 0.62, 0));
  for (const side of [-1, 1]) { g.add(at(cyl(0.014, 0.014, 0.55, plain(0x2a2a30), 6), side * 0.14, 0.95, 0).rotateZ(-side * 0.4)); g.add(at(sphere(0.04, glow(0xffd84a, 1)), side * 0.26, 1.2, 0)); }
  const dust = new Particles({ max: 200, gravity: 0.6 });
  g.add(dust.object);
  g.userData.bounds = box([-1.7, -1.2, -0.6], [1.7, 1.4, 0.6]);
  g.userData.update = (t, dt) => {
    const flap = Math.abs(Math.sin(t * 4.5)) * 0.8 + 0.2;
    for (const [holder, side] of wings) holder.scale.x = side * flap;
    g.position.y = Math.sin(t * 2) * 0.15; g.rotation.x = -0.15 + Math.sin(t * 1.3) * 0.08;
    for (let i = 0; i < 3; i += 1) { const side = Math.random() < 0.5 ? -1 : 1; dust.emit(side * rnd(0.7, 1.6) * flap, rnd(-0.8, 0.9), rnd(-0.1, 0.1), rnd(-0.2, 0.2), rnd(-0.2, 0.3), 0, rnd(0.9, 1.5), rnd(0.07, 0.15), pick(palette(look)), 0.9); }
    dust.update(dt);
  };
  return g;
}

// 6 ------------------------------------------------------------------------------------------------- Rose
/* A bowl with a wavy rim: a piece of a sphere with the opening up, its rim lifted and lowered in waves (one petal layer of the rose). */
function petalBowl(radius, cap, waves, wave, mat) {
  const geometry = new THREE.SphereGeometry(radius, 48, 20, 0, TAU, 0, cap);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const polar = Math.acos(Math.min(1, Math.max(-1, v.y / radius)));
    const near = Math.max(0, (polar - cap * 0.55) / (cap * 0.45));          // 0 at the bottom of the bowl, 1 at the rim
    const phi = Math.atan2(v.z, v.x);
    v.y += Math.sin(phi * waves) * wave * near * near;
    v.x *= 1 + Math.sin(phi * waves + 1) * 0.05 * near; v.z *= 1 + Math.sin(phi * waves + 1) * 0.05 * near;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  const m = new THREE.Mesh(geometry, mat);
  m.rotation.x = Math.PI;                                       // the opening up
  return m;
}
function rose(look) {
  const g = new THREE.Group();
  g.add(at(cyl(0.07, 0.09, 1.3, plain(0x2f9e4f)), 0, -0.95, 0));
  for (const s of [-1, 1]) { const leaf = at(sphere(0.3, plain(0x37b35c), 1.4, 0.16, 0.7), s * 0.32, -0.85 + s * 0.1, 0); leaf.rotation.z = s * 0.7; g.add(leaf); }
  for (const y of [-0.6, -1.05, -1.4]) g.add(at(cone(0.05, 0.16, plain(0x2a8a45), 8), 0.08, y, 0.07).rotateZ(-1.2));
  g.add(at(sphere(0.28, plain(0x2f9e4f), 1, 0.8, 1), 0, -0.2, 0));
  for (let i = 0; i < 5; i += 1) { const a = (i / 5) * TAU; g.add(at(cone(0.09, 0.5, plain(0x2f9e4f), 8), Math.cos(a) * 0.3, -0.05, Math.sin(a) * 0.3).rotateZ(-Math.cos(a) * 0.9).rotateX(Math.sin(a) * 0.9)); }
  const bloom = new THREE.Group();
  const main = material(look); main.side = THREE.DoubleSide;
  const deep = material(look, "accent"); deep.side = THREE.DoubleSide;
  const layers = [];
  [[0.3, 0.52, 3, 0.02, deep, 0.62], [0.44, 0.56, 5, 0.04, main, 0.5], [0.6, 0.6, 5, 0.06, deep, 0.36], [0.78, 0.62, 6, 0.08, main, 0.22], [0.98, 0.66, 7, 0.1, main, 0.06]].forEach(([r, cap, waves, wave, mat, y], i) => {
    const layer = petalBowl(r, Math.PI * cap, waves, wave, mat);
    layer.position.y = y; layer.rotation.y = i * 0.7; layer.userData = { y, i };
    bloom.add(layer); layers.push(layer);
  });
  bloom.add(at(sphere(0.16, deep, 1, 1.5, 1), 0, 0.62, 0));
  at(bloom, 0, 0.2, 0);
  const sparkles = new Particles({ max: 200, gravity: 0.15 });
  const fall = new Particles({ max: 60, gravity: 0.5, additive: false });
  g.add(bloom, sparkles.object, fall.object);
  g.userData.bounds = box([-1.25, -1.7, -1.25], [1.25, 1.4, 1.25]);
  g.userData.update = (t, dt) => {
    const open = 0.5 + 0.5 * Math.sin(t * 1.6);
    layers.forEach((l) => { l.scale.setScalar(1 + open * 0.05 * l.userData.i); l.rotation.y = l.userData.i * 0.7 + t * 0.12 * (l.userData.i % 2 ? 1 : -1); l.position.y = l.userData.y + open * 0.03 * l.userData.i; });
    for (let i = 0; i < 2; i += 1) { const a = rnd(0, TAU); sparkles.emit(Math.cos(a) * rnd(0.3, 1.1), rnd(0.2, 1.4), Math.sin(a) * rnd(0.3, 1.1), rnd(-0.15, 0.15), rnd(0.15, 0.5), rnd(-0.15, 0.15), rnd(0.8, 1.6), rnd(0.07, 0.16), pick([0xffffff, 0xffd8e8, 0xffe6a8]), 1); }
    if (Math.random() < 0.05) fall.emit(rnd(-0.4, 0.4), 0.7, rnd(-0.4, 0.4), rnd(-0.2, 0.2), -0.3, rnd(-0.2, 0.2), 2.2, 0.2, look.main, 0.9);
    sparkles.update(dt); fall.update(dt);
    g.rotation.z = Math.sin(t * 1.2) * 0.04; g.rotation.x = 0.35;
  };
  return g;
}

// 7 ------------------------------------------------------------------------------------------------- Krone
function krone(look) {
  const g = new THREE.Group();
  const gold = material(look); gold.side = THREE.DoubleSide;
  const velvet = plain(0xc2193f, { roughness: 0.9 });
  g.add(at(lathe([[0, -0.1], [0.78, -0.05], [0.84, 0.35], [0.5, 0.55], [0, 0.6]], velvet), 0, -0.1, 0));
  g.add(at(mesh(new THREE.CylinderGeometry(0.95, 0.82, 0.55, 48, 1, true), gold), 0, -0.4, 0));
  g.add(at(torus(0.88, 0.07, gold), 0, -0.68, 0).rotateX(Math.PI / 2), at(torus(0.97, 0.06, gold), 0, -0.14, 0).rotateX(Math.PI / 2));
  const gems = [];
  const gemColors = [0xff2d55, 0x3d8bff, 0x43d17a, 0xffd60a, 0xc86bff];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * TAU; const x = Math.cos(a) * 0.9; const z = Math.sin(a) * 0.9;
    g.add(at(cone(0.22, 1.0, gold, 4), x, 0.25, z));
    const gem = at(new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), glow(gemColors[i], 1.4)), x, 0.82, z); gem.userData.i = i; gems.push(gem); g.add(gem);
  }
  for (const [x, c] of [[-0.42, 0xff2d55], [0, 0x3d8bff], [0.42, 0x43d17a]]) g.add(at(new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 0), glow(c, 1.3)), x, -0.4, 0.88 - Math.abs(x) * 0.25));
  const orbit = [];
  for (let i = 0; i < 4; i += 1) { const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), glow(gemColors[i], 1.5)); orbit.push(o); g.add(o); }
  const fx = new Particles({ max: 160 }); g.add(fx.object);
  const star = flare(0xfff2a8, 1.6, 0.9); at(star, 0.55, 0.9, 0.7); g.add(star);
  g.userData.bounds = box([-1.4, -1, -1.4], [1.4, 1.5, 1.4]);
  g.userData.update = (t, dt) => {
    gems.forEach((gm, i) => { gm.rotation.y = t * 2 + i; gm.material.emissiveIntensity = 1.1 + Math.sin(t * 4 + i) * 0.5; });
    orbit.forEach((o, i) => { const a = t * 1.6 + (i / 4) * TAU; o.position.set(Math.cos(a) * 1.35, 0.6 + Math.sin(t * 2 + i) * 0.25, Math.sin(a) * 1.35); o.rotation.y = t * 3; });
    star.scale.setScalar(1.2 + Math.abs(Math.sin(t * 3)) * 1.1); star.material.rotation = t;
    if (Math.random() < 0.5) fx.emit(rnd(-1, 1), rnd(0, 1.2), rnd(-1, 1), 0, rnd(0.2, 0.6), 0, rnd(0.6, 1.2), rnd(0.07, 0.16), pick([0xfff2a8, 0xffffff]), 1);
    fx.update(dt);
    g.position.y = Math.sin(t * 2) * 0.08;
  };
  return g;
}

// 8 ---------------------------------------------------------------------------------------------- Feuerwerk
function feuerwerk(look) {
  const g = new THREE.Group();
  g.add(at(cyl(0.18, 0.26, 0.9, plain(0x30303a)), 0, -1.15, 0), at(torus(0.2, 0.04, material(look, "accent")), 0, -0.7, 0).rotateX(Math.PI / 2), at(cyl(0.3, 0.3, 0.12, material(look)), 0, -1.65, 0));
  const fx = new Particles({ max: 700, gravity: 1.1, drag: 0.5, grow: 0.7 });
  const trail = new Particles({ max: 200, gravity: 0 });
  g.add(fx.object, trail.object);
  g.userData.bounds = box([-1.4, -1.8, -1.4], [1.4, 1.4, 1.4]);
  const colors = [look.main, look.accent, 0xffffff, 0xffd84a, 0xff4d8d, 0x3df0ff];
  const burst = (cx, cy, size) => {
    const palette2 = [pick(colors), pick(colors)];
    for (let i = 0; i < 160; i += 1) { const a = rnd(0, TAU); const b = Math.acos(rnd(-1, 1)); const sp = rnd(0.6, 1.0) * size; fx.emit(cx, cy, 0, Math.sin(b) * Math.cos(a) * sp, Math.cos(b) * sp, Math.sin(b) * Math.sin(a) * sp, rnd(1.0, 1.7), rnd(0.13, 0.24), palette2[i % 2], 1); }
  };
  let phase = 0; let launched = false; let exploded = false; let second = false;
  g.userData.update = (t, dt) => {
    const c = t % 3.0;
    if (c < 0.05) { launched = false; exploded = false; second = false; }
    if (c < 1.0) { const y = -0.8 + c * c * 2.2; trail.emit(rnd(-0.03, 0.03), y, 0, 0, -0.5, 0, 0.5, 0.2, 0xffd84a, 1); trail.emit(0, y, 0, rnd(-0.2, 0.2), rnd(-0.6, -0.2), 0, 0.4, 0.12, 0xffffff, 1); phase = y; }
    if (c >= 1.0 && !exploded) { exploded = true; burst(0, phase, 2.6); }
    if (c >= 1.55 && !second) { second = true; burst(rnd(-0.7, 0.7), phase + rnd(-0.4, 0.5), 1.8); burst(rnd(-0.7, 0.7), phase + rnd(-0.5, 0.2), 1.4); }
    if (Math.random() < 0.5) trail.emit(rnd(-0.1, 0.1), -0.7, 0, rnd(-0.5, 0.5), rnd(0.6, 1.4), rnd(-0.3, 0.3), 0.5, 0.1, 0xffd84a, 1);
    fx.update(dt); trail.update(dt);
  };
  return g;
}

// 9 -------------------------------------------------------------------------------------------------- Galaxie
function galaxie(look) {
  const g = new THREE.Group();
  const planet = new THREE.Group();
  planet.add(sphere(0.55, material(look)));
  const ring = torus(0.95, 0.07, material(look, "accent")); ring.scale.set(1, 1, 0.3); ring.rotation.x = 1.2; planet.add(ring);
  const core = flare(0xfff0c0, 2.6, 0.6); planet.add(core);
  const dust = new Particles({ max: 900, additive: true });
  for (let i = 0; i < 850; i += 1) {
    const arm = i % 3; const r = Math.pow(Math.random(), 0.7) * 1.9 + 0.2; const a = r * 1.7 + (arm / 3) * TAU + rnd(-0.25, 0.25);
    const c = new THREE.Color(0xfff0c0).lerp(new THREE.Color(look.accent), Math.min(1, r / 1.8)).lerp(new THREE.Color(0xffffff), Math.random() * 0.3);
    dust.live.push({ x: Math.cos(a) * r, y: rnd(-0.08, 0.08) * (1 + r * 0.3), z: Math.sin(a) * r, vx: 0, vy: 0, vz: 0, life: 1e9, age: 1e9 * 0.5, size: rnd(0.04, 0.1), r: c.r, g: c.g, b: c.b, alpha: rnd(0.6, 1) });
  }
  const spin = new THREE.Group(); spin.add(dust.object); spin.rotation.x = 0.35;
  const moons = [];
  for (let i = 0; i < 2; i += 1) { const m = sphere(0.14 + i * 0.05, i ? plain(0xdde6ff) : material(look, "accent")); moons.push(m); g.add(m); }
  const comet = new Particles({ max: 80 }); g.add(comet.object);
  g.add(planet, spin);
  g.userData.bounds = box([-1.7, -1.0, -1.7], [1.7, 1.0, 1.7]);
  let nextComet = 1;
  g.userData.update = (t, dt) => {
    dust.update(0); spin.rotation.y = t * 0.35; planet.rotation.y = t * 0.6; core.material.opacity = 0.5 + Math.sin(t * 3) * 0.15;
    moons.forEach((m, i) => { const a = t * (1.5 - i * 0.5) + i * 2; const r = 1.3 + i * 0.5; m.position.set(Math.cos(a) * r, Math.sin(a * 0.8) * 0.35, Math.sin(a) * r); });
    if (t > nextComet) { nextComet = t + rnd(1.5, 3); for (let i = 0; i < 30; i += 1) comet.emit(-2 + i * 0.03, 1.2 - i * 0.03, 0.5, 2.2, -1.6, 0, 0.6, 0.12, 0xffffff, 1); }
    comet.update(dt);
  };
  return g;
}

// 10 ---------------------------------------------------------------------------------------------------- UFO
function ufo(look) {
  const g = new THREE.Group();
  const hull = lathe([[0, -0.32], [0.55, -0.28], [1.25, -0.02], [1.35, 0.06], [1.1, 0.18], [0.55, 0.3], [0, 0.32]], plain(0xc9ced8, { metalness: 0.9, roughness: 0.25 }), 64);
  const rim = at(torus(1.18, 0.06, material(look, "accent")), 0, 0.03, 0).rotateX(Math.PI / 2);
  const dome = at(new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 20, 0, TAU, 0, Math.PI / 2), material(look, "main", { transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1 })), 0, 0.3, 0);
  const alien = new THREE.Group(); at(alien, 0, 0.35, 0);
  alien.add(sphere(0.3, plain(0x6bdc5a), 1, 1.15, 1)); alien.add(at(sphere(0.12, plain(0x0a0a14), 1, 1.5, 0.5), -0.13, 0.05, 0.25).rotateZ(0.4)); alien.add(at(sphere(0.12, plain(0x0a0a14), 1, 1.5, 0.5), 0.13, 0.05, 0.25).rotateZ(-0.4));
  const lamps = [];
  for (let i = 0; i < 12; i += 1) { const a = (i / 12) * TAU; const l = at(sphere(0.07, glow(pick([0xff4d8d, 0x39f0ff, 0xffd84a, 0x7aff7a]), 1.8)), Math.cos(a) * 1.2, 0.04, Math.sin(a) * 1.2); lamps.push(l); g.add(l); }
  const beam = at(new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.6, 40, 1, true), additive(0x9bffb0, 0.22)), 0, -1.6, 0);
  const beamCore = at(new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.5, 30, 1, true), additive(0xffffff, 0.18)), 0, -1.55, 0);
  const fx = new Particles({ max: 160 });
  g.add(hull, rim, dome, alien, beam, beamCore, fx.object);
  g.userData.bounds = box([-1.5, -2.9, -1.5], [1.5, 1.0, 1.5]);
  g.userData.update = (t, dt) => {
    g.position.y = Math.sin(t * 1.8) * 0.12; g.rotation.z = Math.sin(t * 1.3) * 0.1; hull.rotation.y = t * 2;
    lamps.forEach((l, i) => { const a = t * 3 + (i / 12) * TAU; l.position.set(Math.cos(a) * 1.2, 0.04, Math.sin(a) * 1.2); l.material.emissiveIntensity = 1 + Math.sin(t * 8 + i) * 1; });
    alien.rotation.y = Math.sin(t * 2) * 0.6; alien.position.y = 0.35 + Math.sin(t * 5) * 0.03;
    beam.material.opacity = 0.18 + Math.sin(t * 6) * 0.06; beam.scale.x = beam.scale.z = 1 + Math.sin(t * 3) * 0.05;
    for (let i = 0; i < 2; i += 1) { const a = rnd(0, TAU); const r = rnd(0, 0.9); fx.emit(Math.cos(a) * r, -0.3 - rnd(0, 0.4), Math.sin(a) * r, 0, rnd(-1.2, -0.5), 0, rnd(1, 1.6), rnd(0.07, 0.14), pick([0x9bffb0, 0xffffff]), 0.9); }
    fx.update(dt);
  };
  return g;
}

// 11 ------------------------------------------------------------------------------------------------- Löwe
function loewe(look) {
  const g = new THREE.Group();
  const fur = material(look); const mane = material(look, "accent");
  const maneParts = [];
  for (let i = 0; i < 22; i += 1) {
    const a = (i / 22) * TAU; const ring = i % 2;
    const m = at(sphere(0.34, mane, 1, 1.3, 0.8), Math.cos(a) * (0.95 - ring * 0.12), Math.sin(a) * (0.95 - ring * 0.12), -0.15 - ring * 0.1); m.rotation.z = a - Math.PI / 2; m.userData.a = a; maneParts.push(m); g.add(m);
  }
  g.add(at(sphere(0.9, mane, 1, 1, 0.55), 0, 0, -0.25));
  const face = new THREE.Group(); face.add(sphere(0.72, fur, 1, 1, 0.92));
  for (const s of [-1, 1]) {
    face.add(at(sphere(0.2, fur), s * 0.55, 0.62, -0.1), at(sphere(0.11, plain(0xffb3a7)), s * 0.55, 0.62, 0.02));
    face.add(at(sphere(0.11, plain(0xffe9a8, { emissive: 0xffc800, emissiveIntensity: 0.4 }), 1, 1, 0.5), s * 0.27, 0.17, 0.64));
    face.add(at(sphere(0.05, plain(0x101018), 0.6, 1.2, 0.5), s * 0.27, 0.17, 0.71));
    face.add(at(capsule(0.025, 0.2, plain(0x3a2a1a)), s * 0.28, 0.33, 0.62).rotateZ(Math.PI / 2 + s * 0.35));
    for (const k of [-1, 0, 1]) face.add(at(cyl(0.008, 0.008, 0.55, plain(0xf4f4f4), 6), s * 0.55, -0.22 + k * 0.06, 0.55).rotateZ(Math.PI / 2 + s * k * 0.12));
  }
  face.add(at(sphere(0.34, plain(0xfff1d6), 1.15, 0.8, 0.8), 0, -0.22, 0.52));
  face.add(at(sphere(0.12, plain(0x3a1a1a), 1.3, 0.8, 0.8), 0, -0.02, 0.8));
  const mouth = at(sphere(0.2, plain(0x6a0d1d), 1.1, 0.01, 0.6), 0, -0.34, 0.72);
  const jaw = at(sphere(0.2, plain(0xfff1d6), 1.2, 0.55, 0.9), 0, -0.4, 0.62);
  face.add(mouth, jaw);
  const fx = new Particles({ max: 120, additive: true });
  g.add(face, fx.object);
  g.userData.bounds = box([-1.4, -1.3, -1.0], [1.4, 1.3, 1.1]);
  g.userData.update = (t, dt) => {
    const roar = Math.max(0, Math.sin(t * 1.8)) ** 3;
    jaw.position.y = -0.4 - roar * 0.28; jaw.rotation.x = roar * 0.2; mouth.scale.y = 0.01 + roar * 1.2; mouth.position.y = -0.34 - roar * 0.1;
    face.scale.setScalar(1 + roar * 0.06); face.rotation.y = Math.sin(t * 1.1) * 0.15; face.rotation.x = -roar * 0.08;
    maneParts.forEach((m, i) => { const w = 1 + Math.sin(t * 3 + i) * 0.06 + roar * 0.12; m.scale.set(w, w * 1.1, 1); });
    if (roar > 0.5) for (let i = 0; i < 3; i += 1) fx.emit(rnd(-0.3, 0.3), -0.3, 0.9, rnd(-0.6, 0.6), rnd(-0.3, 0.5), rnd(1.2, 2.2), 0.8, rnd(0.12, 0.25), pick([0xffe6a8, 0xffffff, 0xffb347]), 0.7);
    fx.update(dt);
  };
  return g;
}

// 12 --------------------------------------------------------------------------------------------- Diamantring
function ring(look) {
  const g = new THREE.Group();
  const gold = plain(0xffc83d, { metalness: 1, roughness: 0.2 }); gold.transparent = true;
  const band = torus(0.78, 0.13, look.finish === "gloss" || look.finish === "neon" ? material(look, "accent", { metalness: 1, roughness: 0.2 }) : material(look)); at(band, 0, -0.35, 0);
  g.add(band, at(sphere(0.2, gold), 0, 0.42, 0), at(cyl(0.1, 0.18, 0.4, gold), 0, 0.3, 0));
  const gem = new THREE.Group(); at(gem, 0, 0.9, 0);
  const m = material(look, "main", { flatShading: true });
  gem.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.62, 0.34, 8), material(look, "accent", { flatShading: true })), 0, 0.16, 0), at(new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 8), m), 0, 0.34, 0), at(new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.78, 8), m), 0, -0.39, 0).rotateX(Math.PI));
  for (let i = 0; i < 4; i += 1) { const a = (i / 4) * TAU + Math.PI / 4; g.add(at(cone(0.06, 0.34, gold, 8), Math.cos(a) * 0.5, 0.6, Math.sin(a) * 0.5).rotateZ(-Math.cos(a) * 0.3).rotateX(Math.sin(a) * 0.3)); }
  const rays = [];
  for (let i = 0; i < 7; i += 1) { const r = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 2.6), additive(0xffffff, 0.35)); r.position.set(0, 1.25, 0); r.rotation.z = (i / 7) * Math.PI; rays.push(r); }
  const raysGroup = new THREE.Group(); rays.forEach((r) => raysGroup.add(r)); at(raysGroup, 0, 0.9, 0.2);
  const stars = []; for (let i = 0; i < 3; i += 1) { const f = flare(0xffffff, 0.8, 1); stars.push(f); g.add(f); }
  const fx = new Particles({ max: 120 });
  g.add(gem, raysGroup, fx.object);
  g.userData.bounds = box([-1.6, -1.3, -1.2], [1.6, 2.4, 1.2]);
  g.userData.update = (t, dt) => {
    gem.rotation.y = t * 1.2; raysGroup.rotation.z = t * 0.6; rays.forEach((r, i) => { r.material.opacity = 0.18 + Math.abs(Math.sin(t * 3 + i)) * 0.22; });
    stars.forEach((f, i) => { const a = t * 2 + i * 2.1; f.position.set(Math.cos(a) * 0.5, 0.9 + Math.sin(a * 1.3) * 0.3, 0.55 * Math.sin(a)); f.scale.setScalar(0.5 + Math.abs(Math.sin(t * 5 + i * 2)) * 1.3); });
    if (Math.random() < 0.6) fx.emit(rnd(-0.6, 0.6), rnd(0.5, 1.4), rnd(-0.6, 0.6), rnd(-0.2, 0.2), rnd(0.2, 0.7), 0, rnd(0.6, 1.1), rnd(0.06, 0.14), pick([0xffffff, 0xcfe6ff, 0xffe6f2]), 1);
    fx.update(dt);
    g.rotation.z = Math.sin(t * 1.5) * 0.06;
  };
  return g;
}

// 13 ------------------------------------------------------------------------------------------ Sportwagen
function sportwagen(look) {
  const g = new THREE.Group();
  const car = new THREE.Group();
  const paint = material(look, "main", { clearcoat: 1, clearcoatRoughness: 0.06, metalness: 0.35, roughness: 0.2 });
  const trim = material(look, "accent");
  // the side view of the body: a long low nose, a short cabin, a rear that falls away
  const P = new THREE.Shape();
  P.moveTo(-1.75, 0.12); P.lineTo(-1.8, 0.5); P.quadraticCurveTo(-1.7, 0.7, -1.3, 0.74); P.lineTo(-0.7, 0.8); P.quadraticCurveTo(-0.35, 1.3, 0.2, 1.36); P.lineTo(0.55, 1.32); P.quadraticCurveTo(0.9, 0.98, 1.35, 0.72);
  P.lineTo(1.75, 0.62); P.quadraticCurveTo(1.92, 0.5, 1.9, 0.3); P.lineTo(1.84, 0.12); P.lineTo(-1.75, 0.12);
  const body = solid(P, 1.1, 0.1, paint); body.scale.set(1, 1, 1);
  car.add(body);
  const G = new THREE.Shape();
  G.moveTo(-0.62, 0.82); G.quadraticCurveTo(-0.33, 1.24, 0.2, 1.3); G.lineTo(0.5, 1.27); G.quadraticCurveTo(0.8, 0.98, 1.1, 0.8); G.lineTo(-0.62, 0.82);
  const glass = solid(G, 1.16, 0.015, plain(0x0e1226, { metalness: 0.95, roughness: 0.08 })); glass.position.set(0.02, 0.0, 0); car.add(glass);
  car.add(at(new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.05, 0.22), trim), 0.02, 0.9, 0), at(new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.04, 0.12), trim), 0.02, 0.62, 0.6));
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 1.5), trim); wing.position.set(-1.78, 1.12, 0); car.add(wing);
  for (const z of [-0.45, 0.45]) car.add(at(cyl(0.05, 0.05, 0.38, plain(0x222228)), -1.7, 0.9, z));
  for (const s of [-1, 1]) { car.add(at(sphere(0.14, glow(0xfff2c0, 2.4), 1.7, 0.6, 1.2), 1.86, 0.5, s * 0.38), at(sphere(0.1, glow(0xff2020, 1.8), 0.7, 0.7, 1.6), -1.82, 0.55, s * 0.42)); }
  const wheels = [];
  for (const [x, z] of [[-1.15, 0.62], [-1.15, -0.62], [1.2, 0.62], [1.2, -0.62]]) {
    const w = new THREE.Group(); at(w, x, 0.12, z); w.rotation.x = Math.PI / 2;
    w.add(cyl(0.42, 0.42, 0.34, plain(0x15151a, { roughness: 0.85 }), 32), at(cyl(0.3, 0.3, 0.36, plain(0xe6e8f0, { metalness: 1, roughness: 0.18 }), 28), 0, 0, 0), at(cyl(0.1, 0.1, 0.4, glow(0x39f0ff, 1), 16), 0, 0, 0));
    for (let i = 0; i < 6; i += 1) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.4, 0.38), plain(0x9aa0b4, { metalness: 1 })); sp.rotation.y = (i / 6) * Math.PI; w.add(sp); }
    wheels.push(w); car.add(w);
  }
  const under = at(new THREE.Mesh(new THREE.PlaneGeometry(4.0, 1.7), additive(look.accent === "#000000" ? 0x39f0ff : look.accent, 0.55)), 0, -0.3, 0); under.rotation.x = -Math.PI / 2;
  const flames = new Particles({ max: 180, grow: 1.5 }); const smoke = new Particles({ max: 180, additive: false, grow: 3 });
  g.add(car, under, flames.object, smoke.object);
  g.userData.bounds = box([-3.4, -0.5, -1.3], [2.3, 1.6, 1.3]);
  g.userData.update = (t, dt) => {
    wheels.forEach((w) => { w.rotation.y -= dt * 20; });
    car.position.y = Math.sin(t * 9) * 0.02; car.rotation.z = Math.sin(t * 2.3) * 0.02; g.rotation.y = Math.sin(t * 1.1) * 0.3; car.rotation.x = Math.sin(t * 3) * 0.01;
    under.material.opacity = 0.45 + Math.sin(t * 5) * 0.14;
    for (let i = 0; i < 3; i += 1) flames.emit(-2.0, 0.34, (i % 2 ? 1 : -1) * 0.3, rnd(-3.4, -2.2), rnd(-0.1, 0.3), rnd(-0.2, 0.2), 0.3, 0.26, pick([0xffd84a, 0xff7a1f, 0x39a8ff]), 0.9);
    for (const z of [-0.7, 0.7]) if (Math.random() < 0.8) smoke.emit(-1.3, 0.1, z, rnd(-1.8, -0.9), rnd(0.2, 0.8), rnd(-0.3, 0.3) * z, rnd(0.8, 1.4), rnd(0.36, 0.52), 0xd0d0da, 0.5);
    flames.update(dt); smoke.update(dt);
  };
  return g;
}

// 14 ----------------------------------------------------------------------------------------------------- Wal
function wal(look) {
  const g = new THREE.Group();
  const skin = material(look);
  const belly = look.finish === "gloss" ? plain(0xf2f6ff, { roughness: 0.4 }) : material(look, "accent");
  const whale = new THREE.Group();
  whale.add(sphere(1, skin, 1.55, 0.92, 0.88));
  const under = at(mesh(new THREE.SphereGeometry(1.02, 40, 20, 0, TAU, Math.PI * 0.6, Math.PI * 0.4), belly), 0, -0.02, 0); under.scale.set(1.55, 0.92, 0.88); whale.add(under);
  for (let i = 0; i < 7; i += 1) { const l = at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.015, 0.02), plain(0xdfe8f4)), 0.85 - i * 0.18, -0.55, 0.78 - i * 0.0); l.rotation.z = 0.05; whale.add(l); }
  const tail = new THREE.Group(); at(tail, -1.45, 0.05, 0); tail.add(at(cone(0.5, 1.2, skin, 24), -0.5, 0, 0).rotateZ(Math.PI / 2));
  const flukes = new THREE.Group(); at(flukes, -1.15, 0, 0);
  for (const s of [-1, 1]) { const f = sphere(0.5, skin, 0.4, 0.09, 1); f.position.set(0, 0, s * 0.45); f.rotation.x = s * 0.45; flukes.add(f); }
  flukes.rotation.z = 0; tail.add(flukes);
  whale.add(tail);
  for (const s of [-1, 1]) {
    whale.add(at(sphere(0.095, plain(0x101018)), 1.05, 0.22, s * 0.62), at(sphere(0.035, plain(0xffffff)), 1.1, 0.26, s * 0.64));
    const fin = at(sphere(0.42, skin, 0.9, 0.12, 0.38), 0.3, -0.5, s * 0.85); fin.rotation.z = -0.5; fin.rotation.x = s * 0.5; whale.add(fin);
  }
  const spout = new Particles({ max: 200, gravity: 2.2, grow: 1.4 });
  const splash = new Particles({ max: 160, gravity: 3, additive: false });
  g.add(whale, spout.object, splash.object);
  g.userData.bounds = box([-3.2, -1.4, -1.2], [1.9, 2.4, 1.2]);
  g.userData.update = (t, dt) => {
    const breach = Math.sin(t * 1.4);
    whale.position.y = breach * 0.35; whale.rotation.z = breach * 0.12 + 0.03; tail.rotation.z = Math.sin(t * 3.2) * 0.22; flukes.rotation.z = Math.sin(t * 3.2 - 0.6) * 0.3;
    for (let i = 0; i < 3; i += 1) spout.emit(0.55 + rnd(-0.05, 0.05), whale.position.y + 0.85, rnd(-0.05, 0.05), rnd(-0.3, 0.3), rnd(2.4, 3.4), rnd(-0.3, 0.3), rnd(0.7, 1.0), rnd(0.12, 0.2), pick([0x9bdcff, 0xdff3ff, 0xffffff]), 0.9);
    if (breach > 0.9) for (let i = 0; i < 10; i += 1) splash.emit(rnd(-1.8, 1.4), -0.9, rnd(-0.8, 0.8), rnd(-1, 1), rnd(1.5, 3.5), rnd(-1, 1), rnd(0.6, 1), rnd(0.1, 0.18), pick([0xcfeaff, 0xffffff]), 0.8);
    spout.update(dt); splash.update(dt);
  };
  return g;
}

// 15 ---------------------------------------------------------------------------------------------- Drache
function drache(look) {
  const g = new THREE.Group();
  const scales = material(look, "main", { flatShading: true, roughness: 0.4 });
  const accent = material(look, "accent", { flatShading: true });
  const horn = plain(0xf5ecd8, { roughness: 0.4 });
  // the body: an S of balls that gets thinner towards the tail, alive with a wave
  const N = 14; const segments = []; const spikes = [];
  for (let i = 0; i < N; i += 1) {
    const r = 0.52 * (1 - (i / N) * 0.86);
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 2), i < 3 ? accent : scales); segments.push(s); g.add(s);
    if (i > 0 && i < N - 1) { const sp = cone(r * 0.5, r * 1.3, accent, 5); spikes.push([sp, i, r]); g.add(sp); }
  }
  // the head: skull, snout, jaw, teeth, horns, glowing eyes
  const head = new THREE.Group();
  head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.58, 2), scales));
  head.add(at(sphere(0.4, scales, 1.5, 0.78, 0.85), 0.55, -0.12, 0));
  const jaw = new THREE.Group(); at(jaw, 0.2, -0.3, 0);
  jaw.add(at(sphere(0.34, scales, 1.5, 0.4, 0.78), 0.34, 0, 0), at(sphere(0.24, plain(0x6a0810), 1.4, 0.3, 0.7), 0.4, 0.07, 0));
  for (let i = 0; i < 4; i += 1) jaw.add(at(cone(0.035, 0.12, plain(0xffffff), 6), 0.35 + i * 0.12, 0.1, i % 2 ? 0.1 : -0.1));
  head.add(jaw);
  for (let i = 0; i < 4; i += 1) head.add(at(cone(0.035, 0.12, plain(0xffffff), 6), 0.55 + i * 0.1, -0.2, i % 2 ? 0.1 : -0.1).rotateX(Math.PI));
  for (const s of [-1, 1]) {
    head.add(at(sphere(0.12, glow(0xffd400, 2.6)), 0.22, 0.24, s * 0.36), at(sphere(0.045, plain(0x101010), 0.5, 1.6, 0.6), 0.29, 0.24, s * 0.42), at(sphere(0.045, plain(0x201010)), 0.98, -0.04, s * 0.14));
    head.add(at(cone(0.12, 0.95, horn, 14), -0.22, 0.55, s * 0.3).rotateZ(1.15).rotateX(s * 0.25), at(cone(0.06, 0.34, horn, 8), 0.38, 0.28, s * 0.26).rotateZ(-0.35));
    head.add(at(sphere(0.07, accent, 1, 1, 0.3), 0.0, 0.42, s * 0.5));
  }
  g.add(head);
  // the wings: a bat wing on each side, spread wide, with bones
  const wings = [];
  const membrane = material(look, "accent", { side: THREE.DoubleSide, opacity: 0.92 });
  for (const side of [-1, 1]) {
    const w = new THREE.Group();
    const wing = solid(batWingShape(), 0.04, 0.025, membrane); wing.geometry.translate(0.95, 0.1, 0); w.add(wing);
    for (const [x, y] of [[1.0, 0.95], [1.55, 0.7], [1.7, 0.1], [1.45, -0.45]]) { const len = Math.hypot(x, y); const bone = cyl(0.03, 0.03, len, plain(0x2a1a1a), 6); bone.position.set(x / 2, y / 2, 0); bone.rotation.z = Math.atan2(y, x) - Math.PI / 2; w.add(bone); }
    w.scale.set(side * 1.15, 1.15, 1.15); wings.push([w, side]); g.add(w);
  }
  const fire = new Particles({ max: 560, grow: 3.4 });
  const embers = new Particles({ max: 140, gravity: -0.3 });
  g.add(fire.object, embers.object);
  g.userData.bounds = box([-2.6, -1.9, -1.2], [3.0, 1.7, 1.2]);
  g.userData.update = (t, dt) => {
    const pts = [];
    for (let i = 0; i < N; i += 1) {
      const k = i / (N - 1);
      const a = 1.1 + k * 3.2;                                   // the body winds down from the neck in an S and the tail curls out to the left
      pts.push(V(0.35 - Math.sin(a) * 0.9 * (0.6 + k * 0.6) + Math.sin(t * 2.2 - i * 0.6) * 0.05 * i, 0.15 - k * 1.55 + Math.sin(t * 2.6 - i * 0.55) * 0.07 * (1 + k), Math.sin(t * 1.7 - i * 0.4) * 0.12 * k));
    }
    pts.forEach((p, i) => { segments[i].position.copy(p); });
    spikes.forEach(([sp, i, r]) => { sp.position.copy(pts[i]).add(V(-0.05, r * 0.85, 0)); sp.rotation.z = 0.2; });
    const neck = pts[0];
    head.position.set(neck.x + 0.55, neck.y + 0.45 + Math.sin(t * 2.6) * 0.05, 0.1); head.rotation.set(0, -0.45, 0.12 + Math.sin(t * 2.2) * 0.07);
    const breath = Math.max(0, Math.sin(t * 1.5)) ** 2; jaw.rotation.z = -breath * 0.6;
    wings.forEach(([w, side]) => { const flap = Math.sin(t * 4.5); w.position.set(pts[2].x + side * 0.1, pts[2].y + 0.6, -0.15); w.rotation.set(0, side * (0.15 + flap * 0.35), (0.25 + flap * 0.3) * side); });
    const mouth = V(head.position.x + 0.95 * Math.cos(-0.45), head.position.y - 0.12, head.position.z - 0.95 * Math.sin(-0.45));
    if (breath > 0.1) for (let i = 0; i < 10; i += 1) fire.emit(mouth.x, mouth.y, mouth.z, rnd(2.0, 3.6), rnd(-0.2, 0.7), rnd(0.8, 1.8) + rnd(-0.5, 0.5), rnd(0.5, 0.95), rnd(0.3, 0.55), pick([0xfff2a8, 0xffb23a, 0xff6a1f, 0xff3a1a]), 0.95);
    if (Math.random() < 0.3) embers.emit(mouth.x + rnd(0, 1.5), mouth.y + rnd(-0.2, 0.4), mouth.z + rnd(0, 1), rnd(0.3, 1), rnd(0.3, 1), 0, rnd(0.8, 1.4), 0.09, 0xffc04a, 1);
    fire.update(dt); embers.update(dt);
    g.rotation.z = Math.sin(t * 1.3) * 0.03;
  };
  return g;
}

export const FIGURES = [komet, panda, roboter, gewitter, rakete, schmetterling, rose, krone, feuerwerk, galaxie, ufo, loewe, ring, sportwagen, wal, drache];
