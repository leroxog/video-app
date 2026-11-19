/* Satürn 3D presents (gift3d.mjs): everything that is drawn in 3D for the Samojis and the Satürn Chest, with three.js (MIT, static/js/vendor/three), loaded only when it is needed.
   - `thumb(item)`: a picture (data URL) of a Samoji, rendered once and kept; `live(item, size)`: a small canvas where the Samoji turns (for the sheet).
   - `fly(item, from)`: the Samoji comes out of the present button like smoke -- first to the left, then up -- turning in 3D, with a trail of glowing puffs, smooth all the way.
   - `chest(host)`: the Satürn Chest (wood, gold bands, a planet on the lock): it bobs, glows when it can be opened and opens with a flash and a burst of coins.
   A Samoji is built from the numbers of the catalogue (yipi_samojis.py): a figure (16), a look (15: colours, gold, silver, neon, glass, a rainbow shimmer) and an extra (sparkles, halo, wings, aura). */
import * as THREE from "/static/js/vendor/three/three.module.min.js";
import { RoomEnvironment } from "/static/js/vendor/three/RoomEnvironment.js";

const TAU = Math.PI * 2;
let catalogue = null;                                           // {shapes, palettes, badges}
export const setCatalogue = (data) => { catalogue = data; };

// ----------------------------------------------------------------------------------------------------- materials
function material(look, role = "main", extra = {}) {
  const main = new THREE.Color(look.main);
  const accent = new THREE.Color(look.accent);
  const color = role === "accent" ? accent : main;
  let made;
  switch (look.finish) {
    case "gold": made = new THREE.MeshStandardMaterial({ color: role === "accent" ? 0xb8860b : 0xffc83d, metalness: 1, roughness: 0.24, ...extra }); break;
    case "silver": made = new THREE.MeshStandardMaterial({ color: role === "accent" ? 0x9aa0b0 : 0xe8e8f0, metalness: 1, roughness: 0.2, ...extra }); break;
    case "neon": made = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: role === "accent" ? 0.5 : 0.95, roughness: 0.4, ...extra }); break;
    case "glass": made = new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: role === "accent" ? 0.85 : 0.6, roughness: 0.06, metalness: 0, clearcoat: 1, ...extra }); break;
    case "holo": made = new THREE.MeshPhysicalMaterial({ color: role === "accent" ? 0xffb3e6 : 0xffffff, metalness: 0.55, roughness: 0.16, iridescence: 1, iridescenceIOR: 1.7, clearcoat: 0.6, ...extra }); break;
    default: made = new THREE.MeshStandardMaterial({ color, roughness: 0.34, metalness: 0.06, ...extra });
  }
  made.transparent = true;                                        // (so that a Samoji can fade out at the end of its flight)
  return made;
}
const plain = (hex, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0.05, ...extra }); m.transparent = true; return m; };
const glow = (hex, intensity = 1) => { const m = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.5 }); m.transparent = true; return m; };

const mesh = (geometry, mat, set = (m) => m) => set(new THREE.Mesh(geometry, mat));
const at = (object, x = 0, y = 0, z = 0) => { object.position.set(x, y, z); return object; };
const scaled = (object, x, y = x, z = x) => { object.scale.set(x, y, z); return object; };
const sphere = (r, mat, sx = 1, sy = 1, sz = 1) => scaled(mesh(new THREE.SphereGeometry(r, 32, 22), mat), sx, sy, sz);

/* A flat shape pushed out and rounded at the edges (hearts, stars, bolts, wings). */
function solid(points, depth, bevel, mat) {
  const shape = points instanceof THREE.Shape ? points : new THREE.Shape(points);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 24 });
  geometry.center();
  return new THREE.Mesh(geometry, mat);
}
function wingShape(upper) {
  const w = new THREE.Shape();
  if (upper) { w.moveTo(0, 0); w.bezierCurveTo(0.15, 0.95, 0.95, 1.3, 1.35, 0.78); w.bezierCurveTo(1.6, 0.4, 1.0, -0.08, 0, 0); }
  else { w.moveTo(0, 0); w.bezierCurveTo(0.85, -0.08, 1.15, -0.7, 0.72, -1.02); w.bezierCurveTo(0.3, -1.22, 0.04, -0.6, 0, 0); }
  return w;
}
function heartShape() {
  const s = new THREE.Shape();
  s.moveTo(0.25, 0.25); s.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0); s.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35); s.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95);
  s.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35); s.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0); s.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);
  return s;
}
function heart(mat, size = 1) {
  const geometry = new THREE.ExtrudeGeometry(heartShape(), { depth: 0.32, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.09, bevelSegments: 6, curveSegments: 28 });
  geometry.translate(-0.25, -0.5, -0.16);
  const m = new THREE.Mesh(geometry, mat);
  m.scale.setScalar(1.5 * size);
  return m;
}
const starPoints = (outer, inner, n = 5) => Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? inner : outer; const a = (i / (n * 2)) * TAU + Math.PI / 2; return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r); });

// ------------------------------------------------------------------------------------------------------ figures
const FIGURES = [
  /* 0 Herz */ (look) => { const g = new THREE.Group(); g.add(heart(material(look))); g.userData.update = (t) => { g.scale.setScalar(1 + Math.sin(t * 5) * 0.05 * (Math.sin(t * 1.3) > 0.4 ? 1 : 0.2)); }; return g; },
  /* 1 Stern */ (look) => { const g = new THREE.Group(); g.add(solid(starPoints(1, 0.48), 0.28, 0.12, material(look))); g.add(at(sphere(0.12, material(look, "accent")), 0, 0, 0.3)); return g; },
  /* 2 Blitz */ (look) => { const g = new THREE.Group(); g.add(solid([[0.25, 1], [-0.5, -0.1], [-0.02, -0.1], [-0.3, -1], [0.55, 0.15], [0.05, 0.15], [0.5, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 0.22, 0.09, material(look))); g.userData.update = (t) => { g.children[0].material.emissive = new THREE.Color(look.main); g.children[0].material.emissiveIntensity = 0.25 + Math.abs(Math.sin(t * 6)) * 0.5; }; return g; },
  /* 3 Eis */ (look) => { const g = new THREE.Group(); g.add(at(mesh(new THREE.ConeGeometry(0.55, 1.5, 28), plain(0xe8b36a)), 0, -0.55, 0).rotateZ(Math.PI)); g.add(at(sphere(0.66, material(look)), 0, 0.5, 0)); g.add(at(sphere(0.5, material(look, "accent")), 0, 1.05, 0)); g.add(at(sphere(0.13, plain(0xff2244)), 0, 1.55, 0)); return g; },
  /* 4 Donut */ (look) => { const g = new THREE.Group(); g.add(mesh(new THREE.TorusGeometry(0.72, 0.36, 28, 56), plain(0xe0a867))); g.add(at(scaled(mesh(new THREE.TorusGeometry(0.72, 0.37, 28, 56), material(look)), 1, 1, 0.62), 0, 0, 0.12)); const colors = [0xffffff, 0xff4d8d, 0x3d8bff, 0xffd60a, 0x43d17a]; for (let i = 0; i < 18; i += 1) { const a = (i / 18) * TAU * 1.3 + i; const r = 0.72 + Math.cos(i * 1.7) * 0.18; const c = at(mesh(new THREE.CapsuleGeometry(0.035, 0.12, 4, 8), plain(colors[i % 5])), Math.cos(a) * r, Math.sin(a) * r, 0.34); c.rotation.z = a + (i % 3); g.add(c); } g.rotation.x = 0.5; return g; },
  /* 5 Planet */ (look) => { const g = new THREE.Group(); g.add(sphere(0.78, material(look))); const ring = mesh(new THREE.TorusGeometry(1.2, 0.09, 16, 80), material(look, "accent")); ring.scale.set(1, 1, 0.35); ring.rotation.x = 1.25; ring.rotation.y = -0.3; g.add(ring); g.add(at(sphere(0.13, material(look, "accent")), 1.2, 0.25, 0.3)); return g; },
  /* 6 Katze */ (look) => { const g = new THREE.Group(); const fur = material(look); g.add(sphere(0.85, fur, 1.12, 0.95, 1)); for (const s of [-1, 1]) { const ear = at(mesh(new THREE.ConeGeometry(0.3, 0.55, 4), fur), s * 0.6, 0.78, 0); ear.rotation.z = -s * 0.35; g.add(ear); g.add(at(mesh(new THREE.ConeGeometry(0.17, 0.32, 4), material(look, "accent")), s * 0.6, 0.76, 0.12).rotateZ(-s * 0.35)); g.add(at(sphere(0.12, plain(0x15151a)), s * 0.36, 0.1, 0.8)); g.add(at(sphere(0.04, plain(0xffffff)), s * 0.33, 0.14, 0.9)); for (const k of [-1, 0, 1]) { const w = at(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.7, 6), plain(0xf4f4f4)), s * 0.85, -0.2 + k * 0.09, 0.55); w.rotation.z = Math.PI / 2 + s * k * 0.14; g.add(w); } } g.add(at(sphere(0.1, material(look, "accent"), 1.3, 0.8, 0.8), 0, -0.1, 0.9)); const tail = at(mesh(new THREE.TorusGeometry(0.4, 0.07, 10, 24, Math.PI * 1.2), fur), 1.1, -0.45, -0.2); tail.rotation.z = 2.4; g.add(tail); return g; },
  /* 7 Geist */ (look) => { const g = new THREE.Group(); const m = material(look); g.add(at(sphere(0.78, m, 1, 1.05, 0.95), 0, 0.3, 0)); g.add(at(mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.9, 32, 1, true), m), 0, -0.2, 0)); for (let i = 0; i < 6; i += 1) { const a = (i / 6) * TAU; g.add(at(sphere(0.27, m), Math.cos(a) * 0.55, -0.68, Math.sin(a) * 0.55)); } g.add(at(sphere(0.12, plain(0x15151a), 1, 1.4, 0.6), -0.28, 0.4, 0.76), at(sphere(0.12, plain(0x15151a), 1, 1.4, 0.6), 0.28, 0.4, 0.76)); g.add(at(sphere(0.11, plain(0x15151a), 1.2, 0.8, 0.5), 0, 0.12, 0.8)); g.userData.update = (t) => { g.position.y = Math.sin(t * 2.4) * 0.08; }; return g; },
  /* 8 Kleeblatt */ (look) => { const g = new THREE.Group(); for (let i = 0; i < 4; i += 1) { const h = heart(material(look), 0.66); h.rotation.z = (i / 4) * TAU + Math.PI; h.position.set(Math.cos((i / 4) * TAU + Math.PI / 2) * 0.55, Math.sin((i / 4) * TAU + Math.PI / 2) * 0.55 + 0.1, 0); g.add(h); } const stem = at(mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.1, 10), material(look, "accent")), 0.2, -0.85, 0); stem.rotation.z = 0.35; g.add(stem); return g; },
  /* 9 Rakete */ (look) => { const g = new THREE.Group(); const body = mesh(new THREE.LatheGeometry([[0, -1], [0.38, -0.95], [0.5, -0.2], [0.44, 0.6], [0.2, 1.15], [0, 1.4]].map(([x, y]) => new THREE.Vector2(x, y)), 36), material(look)); g.add(body); g.add(at(mesh(new THREE.TorusGeometry(0.2, 0.05, 12, 30), plain(0xd8d8e0)), 0, 0.3, 0.46)); g.add(at(sphere(0.18, plain(0x9bd7ff, { emissive: 0x2a7fb0, emissiveIntensity: 0.5 }), 1, 1, 0.35), 0, 0.3, 0.47)); for (let i = 0; i < 3; i += 1) { const a = (i / 3) * TAU; const fin = mesh(new THREE.ConeGeometry(0.28, 0.8, 4), material(look, "accent")); fin.scale.set(1, 1, 0.25); fin.position.set(Math.cos(a) * 0.5, -0.75, Math.sin(a) * 0.5); fin.rotation.y = -a; fin.rotation.z = Math.cos(a) * 0.0; g.add(fin); } const flame = at(mesh(new THREE.ConeGeometry(0.28, 0.9, 16), glow(0xff8a1f, 1.4)), 0, -1.45, 0); flame.rotation.x = Math.PI; g.add(flame); g.userData.update = (t) => { flame.scale.set(1, 0.8 + Math.sin(t * 24) * 0.25, 1); }; g.rotation.z = -0.5; return g; },
  /* 10 Krone */ (look) => { const g = new THREE.Group(); const gold = material(look); g.add(at(mesh(new THREE.CylinderGeometry(0.85, 0.7, 0.55, 40, 1, true), gold), 0, -0.3, 0)); g.children[0].material.side = THREE.DoubleSide; for (let i = 0; i < 5; i += 1) { const a = (i / 5) * TAU; g.add(at(mesh(new THREE.ConeGeometry(0.2, 0.75, 16), gold), Math.cos(a) * 0.78, 0.3, Math.sin(a) * 0.78)); g.add(at(sphere(0.12, material(look, "accent")), Math.cos(a) * 0.78, 0.72, Math.sin(a) * 0.78)); } g.add(at(mesh(new THREE.TorusGeometry(0.78, 0.07, 10, 40), gold).rotateX(Math.PI / 2), 0, -0.58, 0)); for (const [x, c] of [[-0.35, 0xff2d55], [0, 0x3d8bff], [0.35, 0x43d17a]]) g.add(at(sphere(0.1, plain(c, { emissive: c, emissiveIntensity: 0.4 })), x, -0.3, 0.8 - Math.abs(x) * 0.3)); return g; },
  /* 11 Pokal */ (look) => { const g = new THREE.Group(); g.add(mesh(new THREE.LatheGeometry([[0, -1], [0.5, -1], [0.55, -0.85], [0.14, -0.7], [0.12, -0.2], [0.35, 0.0], [0.7, 0.4], [0.72, 0.95], [0.6, 1], [0.58, 0.45], [0.3, 0.1], [0, 0.05]].map(([x, y]) => new THREE.Vector2(x, y)), 40), material(look))); for (const s of [-1, 1]) g.add(at(mesh(new THREE.TorusGeometry(0.3, 0.06, 10, 24, Math.PI), material(look, "accent")), s * 0.72, 0.62, 0).rotateZ(s > 0 ? -Math.PI / 2 : Math.PI / 2)); g.add(at(solid(starPoints(0.26, 0.12), 0.06, 0.03, material(look, "accent")), 0, 0.55, 0.7)); return g; },
  /* 12 Diamant */ (look) => { const g = new THREE.Group(); const m = material(look, "main", { flatShading: true }); const crown = at(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.98, 0.42, 8, 1), material(look, "accent", { flatShading: true })), 0, 0.3, 0); const table = at(new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.02, 8), m), 0, 0.52, 0); const pavilion = at(new THREE.Mesh(new THREE.ConeGeometry(0.98, 1.15, 8, 1), m), 0, -0.48, 0); pavilion.rotation.x = Math.PI; g.add(crown, table, pavilion, at(sphere(0.05, plain(0xffffff, { emissive: 0xffffff, emissiveIntensity: 1 })), 0.4, 0.58, 0.45)); g.userData.update = (t) => { g.children[3].scale.setScalar(0.6 + Math.abs(Math.sin(t * 4)) * 1.4); }; return g; },
  /* 13 Rose */ (look) => { const g = new THREE.Group(); const stem = at(mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.2, 12), plain(0x2f9e4f)), 0, -0.75, 0); g.add(stem); for (const side of [-1, 1]) { const leaf = at(sphere(0.3, plain(0x37b35c), 1.4, 0.18, 0.7), side * 0.3, -0.8 + side * 0.1, 0); leaf.rotation.z = side * 0.7; g.add(leaf); } const bloom = new THREE.Group(); const petalMaterial = material(look); petalMaterial.side = THREE.DoubleSide; for (let i = 0; i < 30; i += 1) { const angle = i * 2.399; const k = i / 29; const radius = 0.05 + k * 0.5; const height = 0.55 - k * 0.45; const petal = sphere(0.5, i % 5 === 4 ? material(look, "accent") : petalMaterial, 0.34 + k * 0.5, 0.42 + k * 0.45, 0.1); petal.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius); petal.rotation.order = "YXZ"; petal.rotation.y = Math.PI / 2 - angle; petal.rotation.x = -0.15 - k * 0.7; bloom.add(petal); } bloom.scale.setScalar(1.45); at(bloom, 0, 0.55, 0); g.add(bloom); g.userData.update = (t) => { bloom.scale.setScalar(1.45 + Math.sin(t * 2) * 0.03); }; return g; },
  /* 14 Schmetterling */ (look) => { const g = new THREE.Group(); const wings = []; const make = (big, side) => { const w = solid(wingShape(big), 0.05, 0.035, material(look, big ? "main" : "accent")); w.geometry.translate(0.7, 0, 0); const holder = new THREE.Group(); holder.add(w); holder.scale.set(side, 1.25, 1); g.add(holder); wings.push([holder, side]); }; for (const side of [-1, 1]) { make(true, side); make(false, side); } g.add(at(mesh(new THREE.CapsuleGeometry(0.1, 0.95, 6, 12), plain(0x2a2a30)), 0, -0.05, 0)); g.add(at(sphere(0.13, plain(0x2a2a30)), 0, 0.62, 0)); for (const side of [-1, 1]) g.add(at(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.55, 6), plain(0x2a2a30)), side * 0.14, 0.95, 0).rotateZ(-side * 0.4)); g.userData.update = (t) => { const flap = Math.abs(Math.sin(t * 4.5)) * 0.8 + 0.2; for (const [holder, side] of wings) holder.scale.x = side * flap; }; g.rotation.x = -0.15; return g; },
  /* 15 Wal */ (look) => { const g = new THREE.Group(); const skin = material(look); const belly = look.finish === "gloss" ? plain(0xf2f6ff, { roughness: 0.4 }) : material(look, "accent"); g.add(sphere(1, skin, 1.5, 0.9, 0.85)); const under = at(mesh(new THREE.SphereGeometry(1.02, 36, 18, 0, TAU, Math.PI * 0.62, Math.PI * 0.38), belly), 0, -0.02, 0); under.scale.set(1.5, 0.9, 0.85); g.add(under); const stalk = at(mesh(new THREE.ConeGeometry(0.5, 1.1, 20), skin), -1.6, 0.1, 0); stalk.rotation.z = Math.PI / 2 + 0.2; g.add(stalk); const flukes = new THREE.Group(); for (const s of [-1, 1]) { const f = sphere(0.5, skin, 0.35, 0.09, 1); f.position.set(0, s * 0.42, 0); f.rotation.z = s * 0.55; flukes.add(f); } at(flukes, -2.1, 0.35, 0); g.add(flukes); for (const s of [-1, 1]) { g.add(at(sphere(0.085, plain(0x101018)), 1.05, 0.2, s * 0.5)); g.add(at(sphere(0.03, plain(0xffffff)), 1.1, 0.24, s * 0.51)); const fin = at(sphere(0.4, skin, 0.9, 0.12, 0.35), 0.3, -0.5, s * 0.78); fin.rotation.z = -0.5; fin.rotation.x = s * 0.5; g.add(fin); } const drops = []; for (let i = 0; i < 6; i += 1) { const d = sphere(0.07 + (i % 3) * 0.02, glow(0x9bdcff, 0.6)); drops.push(d); g.add(d); } g.userData.update = (t) => { flukes.rotation.z = Math.sin(t * 3) * 0.22; g.rotation.z = Math.sin(t * 1.5) * 0.05; drops.forEach((d, i) => { const k = (t * 0.9 + i / 6) % 1; d.position.set(0.55 + Math.sin(i * 2.1) * 0.12, 0.9 + k * 1.1, Math.cos(i * 2.1) * 0.1); d.scale.setScalar(Math.sin(k * Math.PI)); }); }; g.scale.setScalar(0.82); return g; },
];

// ----------------------------------------------------------------------------------------------------- extras
function extra(kind, look) {
  const g = new THREE.Group();
  if (kind === 1) {                                              // sparkles that orbit
    const parts = [];
    for (let i = 0; i < 9; i += 1) { const s = mesh(new THREE.OctahedronGeometry(0.09 + (i % 3) * 0.03, 0), glow(i % 2 ? 0xfff2a8 : 0xffffff, 1.4)); parts.push(s); g.add(s); }
    g.userData.update = (t) => parts.forEach((s, i) => { const a = t * (1 + (i % 3) * 0.3) + (i / 9) * TAU; const r = 1.05 + (i % 3) * 0.12; s.position.set(Math.cos(a) * r, Math.sin(t * 2 + i) * 0.55, Math.sin(a) * r); s.scale.setScalar(0.6 + Math.abs(Math.sin(t * 4 + i)) * 0.8); s.rotation.y = t * 3; });
  } else if (kind === 2) {                                       // a halo above
    const ring = mesh(new THREE.TorusGeometry(0.62, 0.055, 12, 60), glow(0xffd84a, 1.2)); ring.rotation.x = Math.PI / 2; at(ring, 0, 1.55, 0); g.add(ring);
    g.userData.update = (t) => { ring.position.y = 1.55 + Math.sin(t * 2.2) * 0.06; ring.material.emissiveIntensity = 1 + Math.sin(t * 4) * 0.4; };
  } else if (kind === 3) {                                       // wings at the sides
    const wings = [];
    for (const side of [-1, 1]) { const w = solid(wingShape(true), 0.04, 0.03, plain(0xffffff, { emissive: 0xdde8ff, emissiveIntensity: 0.35 })); w.geometry.translate(0.55, 0.15, 0); const holder = new THREE.Group(); holder.add(w); holder.position.set(side * 0.5, 0.1, -0.15); holder.scale.set(side * 0.78, 0.78, 0.78); wings.push([holder, side]); g.add(holder); }
    g.userData.update = (t) => wings.forEach(([holder, side]) => { holder.rotation.z = Math.sin(t * 4) * 0.26 * side; });
  } else if (kind === 4) {                                       // a glowing aura
    const aura = mesh(new THREE.SphereGeometry(1.25, 32, 20), new THREE.MeshBasicMaterial({ color: look.main === "#ffffff" ? 0xbfd9ff : look.main, transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide })); g.add(aura);
    const ring = mesh(new THREE.TorusGeometry(1.3, 0.025, 8, 80), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 })); g.add(ring);
    g.userData.update = (t) => { aura.scale.setScalar(1 + Math.sin(t * 3) * 0.07); ring.rotation.x = t * 0.8; ring.rotation.y = t * 0.5; };
  }
  return g;
}

/* One Samoji: {group, update(t), dispose()}; `item` is a row of the catalogue [id, shape, look, badge, price]. */
export function build(item) {
  const [, shape, lookIndex, badge] = item;
  const [, main, accent, finish] = catalogue.palettes[lookIndex];
  const look = { main, accent, finish };
  const root = new THREE.Group();
  const body = FIGURES[shape](look);
  const decoration = extra(badge, look);
  const holder = new THREE.Group();
  holder.add(body);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const fit = 2.0 / Math.max(size.x, size.y, size.z, 0.001);
  holder.position.sub(centre);
  const frame = new THREE.Group();
  frame.add(holder);
  frame.scale.setScalar(fit * (badge === 2 ? 0.8 : 1));
  if (badge === 2) frame.position.y = -0.18;                     // (room above for the halo)
  root.add(frame);
  if (badge) { decoration.scale.setScalar(1); root.add(decoration); }
  const update = (t) => { body.userData.update?.(t); decoration.userData.update?.(t); };
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
/* A still picture (data URL) of a Samoji, turned a little so that it looks 3D; made one after the other and kept. */
export function thumb(item) {
  if (thumbs.has(item[0])) return thumbs.get(item[0]);
  const k = kit();
  const made = k.queue.then(() => new Promise((resolve) => requestAnimationFrame(() => {
    const sam = build(item);
    sam.group.rotation.y = -0.55;
    sam.group.rotation.x = 0.12;
    sam.update(0.35);
    k.scene.add(sam.group);
    k.renderer.render(k.scene, k.camera);
    const url = k.canvas.toDataURL("image/png");
    k.scene.remove(sam.group);
    sam.dispose();
    resolve(url);
  })));
  k.queue = made.catch(() => {});
  thumbs.set(item[0], made);
  return made;
}

/* A small canvas where the Samoji turns (the preview in the sheet); returns {canvas, stop()}. */
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
  let frame = 0;
  const clock = new THREE.Clock();
  const tick = () => { const t = clock.getElapsedTime(); sam.group.rotation.y = t * 1.1; sam.group.position.y = Math.sin(t * 2) * 0.06; sam.update(t); renderer.render(scene, camera); frame = requestAnimationFrame(tick); };
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
  overlay = { canvas, renderer, scene, camera, flights: [], puffs: [], running: false, w: 0, h: 0 };
  return overlay;
}
function resizeLayer(o) {
  const w = window.innerWidth, h = window.innerHeight;
  if (o.w === w && o.h === h) return;
  o.w = w; o.h = h;
  o.renderer.setSize(w, h, false);
  o.camera.left = 0; o.camera.right = w; o.camera.top = h; o.camera.bottom = 0; o.camera.updateProjectionMatrix();
}
const puffGeometry = () => (puffGeometry.g ||= new THREE.IcosahedronGeometry(1, 1));

/* The Samoji comes out of the present at `from` ({x, y} on the screen) like smoke: first it drifts to the left, then it rises in a soft curve, growing and turning, and fades at the top. */
export function fly(item, from, { delay = 0, duration = 3300, size = 150 } = {}) {
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
    new THREE.Vector3(W * 0.52, H * 0.82, 0),
  ], false, "catmullrom", 0.5);
  sam.group.visible = false;
  o.scene.add(sam.group);
  const flight = { sam, path, born: performance.now() + delay, duration, size, done: false };
  o.flights.push(flight);
  if (!o.running) { o.running = true; requestAnimationFrame(frame); }
  return new Promise((resolve) => { flight.resolve = resolve; });
}
function frame(now) {
  const o = overlay;
  if (!o) return;
  resizeLayer(o);
  const t = now / 1000;
  for (const f of o.flights) {
    const age = now - f.born;
    if (age < 0) continue;
    const k = Math.min(1, age / f.duration);
    const u = ease(k * 0.96 + 0.02);
    const point = f.path.getPoint(Math.min(1, u));
    const sway = Math.sin(age / 260) * 12 * (1 - k);
    f.sam.group.visible = true;
    f.sam.group.position.set(point.x + sway, point.y, 0);
    const grow = smooth(Math.min(1, k / 0.22)) * (1 + 0.35 * Math.sin(Math.min(1, k) * Math.PI));
    f.sam.group.scale.setScalar(Math.max(0.01, grow) * f.size * 0.5);
    f.sam.group.rotation.set(0.25 + Math.sin(age / 500) * 0.15, age / 380, Math.sin(age / 700) * 0.12);
    f.sam.update(age / 1000);
    const fade = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
    f.sam.group.traverse((m) => { if (m.material && m.material.transparent) m.material.opacity = Math.min(m.material.userData.keep ?? (m.material.userData.keep = m.material.opacity), 1) * fade; });
    if (Math.random() < 0.8 && k < 0.92) {                       // a puff of smoke that glows and drifts away
      const puff = new THREE.Mesh(puffGeometry(), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(0.1 + Math.random() * 0.8, 0.8, 0.8), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
      puff.position.set(point.x + sway + (Math.random() - 0.5) * 24, point.y + (Math.random() - 0.5) * 24, -50);
      puff.userData = { born: now, life: 900 + Math.random() * 500, vx: (Math.random() - 0.5) * 30, vy: 20 + Math.random() * 30, size: 5 + Math.random() * 9 };
      o.scene.add(puff);
      o.puffs.push(puff);
    }
    if (k >= 1 && !f.done) { f.done = true; o.scene.remove(f.sam.group); f.sam.dispose(); f.resolve?.(); }
  }
  o.flights = o.flights.filter((f) => !f.done);
  for (const p of o.puffs) {
    const a = (now - p.userData.born) / p.userData.life;
    p.position.x += p.userData.vx / 60; p.position.y += p.userData.vy / 60;
    p.scale.setScalar(p.userData.size * (1 + a * 1.6));
    p.material.opacity = Math.max(0, 0.45 * (1 - a));
  }
  o.puffs = o.puffs.filter((p) => { if ((now - p.userData.born) / p.userData.life >= 1) { o.scene.remove(p); p.material.dispose(); return false; } return true; });
  o.renderer.render(o.scene, o.camera);
  if (o.flights.length || o.puffs.length) requestAnimationFrame(frame);
  else { o.running = false; o.renderer.dispose(); o.canvas.remove(); overlay = null; }
}

// ---------------------------------------------------------------------------------------------------- the chest
/* The Satürn Chest in a small canvas inside `host`: wood with gold bands and a planet on the lock. States: "closed" (it bobs), "ready" (it shakes and glows: tap it), "open" (the lid flies up,
   light and coins). `controller.state(name)`, `controller.open()` (the show), `controller.stop()`. */
export function chest(host, size = 150) {
  const canvas = document.createElement("canvas");
  host.append(canvas);
  const renderer = newRenderer(canvas, size);
  const scene = new THREE.Scene();
  lights(scene, renderer);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 2.2, 7.2);
  camera.lookAt(0, 0.35, 0);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a4b1f, roughness: 0.7, metalness: 0.05 });
  const goldM = new THREE.MeshStandardMaterial({ color: 0xffc83d, metalness: 1, roughness: 0.25 });
  const root = new THREE.Group();
  scene.add(root);
  const base = at(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 1.7), wood), 0, 0.05, 0);
  root.add(base);
  const inside = at(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.4), new THREE.MeshBasicMaterial({ color: 0xffe9a6 })), 0, 0.72, 0);
  root.add(inside);
  const lidPivot = new THREE.Group();
  at(lidPivot, 0, 0.7, -0.85);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 2.6, 28, 1, false, 0, Math.PI), wood);
  lid.rotation.z = Math.PI / 2;                                   // (a half cylinder lying along the chest, round side up)
  lid.position.set(0, 0, 0.85);
  lidPivot.add(lid);
  root.add(lidPivot);
  for (const x of [-0.95, 0.95]) {
    root.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.36, 1.78), goldM), x, 0.05, 0));
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 0.88, 0.2, 28, 1, false, 0, Math.PI), goldM);
    strap.rotation.z = Math.PI / 2; strap.position.set(x, 0, 0.85);
    lidPivot.add(strap);
  }
  root.add(at(new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.14, 1.72), goldM), 0, -0.55, 0));
  const lockPlate = at(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.12), goldM), 0, 0.5, 0.9);
  root.add(lockPlate);
  const planet = new THREE.Group();
  planet.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), new THREE.MeshStandardMaterial({ color: 0x8e44f2, roughness: 0.3 })));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 8, 30), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
  ring.rotation.x = 1.2; planet.add(ring);
  at(planet, 0, 0.5, 1.0);
  root.add(planet);
  const light = new THREE.PointLight(0xffd36a, 0, 9);
  at(light, 0, 1.1, 0.4);
  root.add(light);
  const rays = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.2, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe29a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  at(rays, 0, 2.2, 0.1); rays.rotation.x = Math.PI; root.add(rays);
  const coins = [];
  const coinGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.05, 20);
  const coinMaterial = new THREE.MeshStandardMaterial({ color: 0xffd54a, metalness: 1, roughness: 0.22, emissive: 0x6a4a00, emissiveIntensity: 0.4 });

  let mode = "closed";
  let openedAt = 0;
  let frameId = 0;
  const clock = new THREE.Clock();
  const tick = () => {
    const t = clock.getElapsedTime();
    const wobble = mode === "ready" ? Math.sin(t * 28) * 0.07 : 0;
    root.rotation.z = wobble;
    root.rotation.y = Math.sin(t * 0.8) * 0.25;
    root.position.y = mode === "ready" ? Math.abs(Math.sin(t * 7)) * 0.1 : Math.sin(t * 1.6) * 0.07;
    planet.rotation.y = t * 1.5;
    light.intensity = mode === "ready" ? 12 + Math.sin(t * 9) * 5 : mode === "open" ? 18 : 0;
    inside.material.opacity = 1;
    if (mode === "open") {
      const k = Math.min(1, (t - openedAt) / 0.7);
      lidPivot.rotation.x = -smooth(k) * 2.0 - Math.sin(k * Math.PI) * 0.25;
      rays.material.opacity = Math.min(0.55, k * 0.7) * (0.8 + Math.sin(t * 10) * 0.2);
    }
    for (const c of coins) {
      c.userData.vy -= 9 * 0.016; c.position.x += c.userData.vx * 0.016; c.position.y += c.userData.vy * 0.016; c.position.z += c.userData.vz * 0.016;
      c.rotation.x += c.userData.spin; c.rotation.z += c.userData.spin * 0.7;
      if (c.position.y < -0.4 && c.userData.vy < 0) { c.userData.vy *= -0.4; c.userData.vx *= 0.7; if (Math.abs(c.userData.vy) < 0.5) c.userData.vy = 0; }
    }
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(tick);
  };
  tick();
  return {
    canvas,
    state(name) { mode = name; },
    open() {
      mode = "open";
      openedAt = clock.getElapsedTime();
      for (let i = 0; i < 34; i += 1) {
        const c = new THREE.Mesh(coinGeometry, coinMaterial);
        c.position.set((Math.random() - 0.5) * 1.4, 0.9, (Math.random() - 0.2) * 0.8);
        c.userData = { vx: (Math.random() - 0.5) * 2.4, vy: 2.2 + Math.random() * 2.2, vz: Math.random() * 1.6, spin: (Math.random() - 0.5) * 0.4 };
        root.add(c);
        coins.push(c);
      }
    },
    stop() { cancelAnimationFrame(frameId); renderer.dispose(); canvas.remove(); },
  };
}
