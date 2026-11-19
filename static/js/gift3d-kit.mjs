/* Satürn 3D kit (gift3d-kit.mjs): the small tools the 3D presents are built from -- materials for the looks (colours, gold, silver, neon, glass, a rainbow shimmer), shorthand for meshes,
   rounded boxes and extruded shapes, and a particle system (fire, smoke, sparks, confetti) that is drawn with one shader so that hundreds of glowing particles cost almost nothing. */
import * as THREE from "/static/js/vendor/three/three.module.min.js";

export { THREE };
export const TAU = Math.PI * 2;
export const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ----------------------------------------------------------------------------------------------------- materials
/* The material of a look ({main, accent, finish}); role "accent" gives the second colour. Every material may fade (transparent). */
export function material(look, role = "main", extra = {}) {
  const color = new THREE.Color(role === "accent" ? look.accent : look.main);
  let made;
  switch (look.finish) {
    case "gold": made = new THREE.MeshStandardMaterial({ color: role === "accent" ? 0xb8860b : 0xffc83d, metalness: 1, roughness: 0.24, ...extra }); break;
    case "silver": made = new THREE.MeshStandardMaterial({ color: role === "accent" ? 0x9aa0b0 : 0xe8e8f0, metalness: 1, roughness: 0.2, ...extra }); break;
    case "neon": made = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: role === "accent" ? 0.5 : 0.95, roughness: 0.4, ...extra }); break;
    case "glass": made = new THREE.MeshPhysicalMaterial({ color, transparent: true, opacity: role === "accent" ? 0.85 : 0.62, roughness: 0.06, metalness: 0, clearcoat: 1, ...extra }); break;
    case "holo": made = new THREE.MeshPhysicalMaterial({ color: role === "accent" ? 0xffb3e6 : 0xffffff, metalness: 0.55, roughness: 0.16, iridescence: 1, iridescenceIOR: 1.7, clearcoat: 0.6, ...extra }); break;
    default: made = new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.05, clearcoat: 0.5, clearcoatRoughness: 0.25, ...extra });
  }
  made.transparent = true;
  return made;
}
export const plain = (hex, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.45, metalness: 0.05, ...extra }); m.transparent = true; return m; };
export const glow = (hex, intensity = 1) => { const m = new THREE.MeshStandardMaterial({ color: hex, emissive: hex, emissiveIntensity: intensity, roughness: 0.5 }); m.transparent = true; return m; };
export const additive = (hex, opacity = 0.4) => new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

// ------------------------------------------------------------------------------------------------------ shorthand
export const mesh = (geometry, mat) => new THREE.Mesh(geometry, mat);
export const at = (object, x = 0, y = 0, z = 0) => { object.position.set(x, y, z); return object; };
export const sphere = (r, mat, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 22), mat); m.scale.set(sx, sy, sz); return m; };
export const cyl = (rt, rb, h, mat, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
export const cone = (r, h, mat, seg = 24) => new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat);
export const torus = (R, r, mat, arc = TAU) => new THREE.Mesh(new THREE.TorusGeometry(R, r, 16, 64, arc), mat);
export const capsule = (r, len, mat) => new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 16), mat);

/* A flat shape (a Shape, or points) pushed out and rounded at the edges. */
export function solid(shapeOrPoints, depth, bevel, mat) {
  const shape = shapeOrPoints instanceof THREE.Shape ? shapeOrPoints : new THREE.Shape(shapeOrPoints);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 24 });
  geometry.center();
  return new THREE.Mesh(geometry, mat);
}
/* A box with round corners (w, h, d, radius of the corners). */
export function roundedBox(w, h, d, r, mat) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const bevel = Math.min(r * 0.5, d * 0.3);
  const geometry = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.01, d - bevel * 2), bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4, curveSegments: 10 });
  geometry.center();
  return new THREE.Mesh(geometry, mat);
}
export const lathe = (points, mat, seg = 40) => new THREE.Mesh(new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), seg), mat);
export const heartShape = () => {
  const s = new THREE.Shape();
  s.moveTo(0.25, 0.25); s.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0); s.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35); s.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95);
  s.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35); s.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0); s.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);
  return s;
};
export const wingShape = (upper) => {
  const w = new THREE.Shape();
  if (upper) { w.moveTo(0, 0); w.bezierCurveTo(0.15, 0.95, 0.95, 1.3, 1.35, 0.78); w.bezierCurveTo(1.6, 0.4, 1.0, -0.08, 0, 0); }
  else { w.moveTo(0, 0); w.bezierCurveTo(0.85, -0.08, 1.15, -0.7, 0.72, -1.02); w.bezierCurveTo(0.3, -1.22, 0.04, -0.6, 0, 0); }
  return w;
};
/* A bat wing with a spread of fingers: a membrane between the arm and the finger tips. */
export const batWingShape = () => {
  const w = new THREE.Shape();
  w.moveTo(0, 0); w.lineTo(1.0, 0.95); w.lineTo(1.55, 0.7); w.quadraticCurveTo(1.35, 0.4, 1.7, 0.1); w.quadraticCurveTo(1.35, -0.05, 1.45, -0.45); w.quadraticCurveTo(1.0, -0.3, 0.95, -0.75); w.quadraticCurveTo(0.55, -0.4, 0.1, -0.5); w.lineTo(0, 0);
  return w;
};

// ----------------------------------------------------------------------------------------------------- particles
let glowTexture = null;
export function glowMap() {
  if (!glowTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.35, "rgba(255,255,255,0.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(c);
  }
  return glowTexture;
}

/* Glowing particles with their own size, colour and fade (fire, smoke, sparks, confetti). Positions are in the space of the group the system is added to. `uniform.uWorld` is the pixels per
   world unit at one unit of distance: 1 for the flat overlay (units are pixels), and set by the renderer for a perspective camera (the renderer sets it with `setScale`). */
export class Particles {
  constructor({ max = 300, additive: add = true, gravity = 0, drag = 0, grow = 1 } = {}) {
    this.max = max; this.gravity = gravity; this.drag = drag; this.grow = grow;
    this.live = [];
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: glowMap() }, uPersp: { value: 1 }, uScale: { value: 420 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vColor; varying float vAlpha; uniform float uPersp; uniform float uScale;
        void main() { vColor = color; vAlpha = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); float k = length(modelMatrix[0].xyz);
          gl_PointSize = uPersp > 0.5 ? aSize * k * uScale / max(0.1, -mv.z) : aSize * k * uScale; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha; void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vColor, 1.0) * vec4(1.0, 1.0, 1.0, t.a * vAlpha); }`,
      transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, vertexColors: true,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.object = this.points;
  }
  /* One particle: position, velocity, life in seconds, size (in world units), colour (hex), start opacity. */
  emit(x, y, z, vx, vy, vz, life, size, hex = 0xffffff, alpha = 1) {
    if (this.live.length >= this.max) this.live.shift();
    const c = new THREE.Color(hex);
    this.live.push({ x, y, z, vx, vy, vz, life, age: 0, size, r: c.r, g: c.g, b: c.b, alpha });
  }
  update(dt) {
    const p = this.live;
    for (let i = p.length - 1; i >= 0; i -= 1) {
      const q = p[i];
      q.age += dt;
      if (q.age >= q.life) { p.splice(i, 1); continue; }
      q.vy -= this.gravity * dt;
      if (this.drag) { const d = Math.max(0, 1 - this.drag * dt); q.vx *= d; q.vy *= d; q.vz *= d; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    }
    for (let i = 0; i < this.max; i += 1) {
      const q = p[i];
      if (!q) { this.alphas[i] = 0; this.sizes[i] = 0; continue; }
      const k = q.age / q.life;
      this.positions[i * 3] = q.x; this.positions[i * 3 + 1] = q.y; this.positions[i * 3 + 2] = q.z;
      this.colors[i * 3] = q.r; this.colors[i * 3 + 1] = q.g; this.colors[i * 3 + 2] = q.b;
      this.sizes[i] = q.size * (1 + k * (this.grow - 1));
      this.alphas[i] = q.alpha * Math.sin(Math.min(1, k) * Math.PI) ** 0.6 * (k < 0.1 ? 1 : 1);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.aSize.needsUpdate = true; g.attributes.aAlpha.needsUpdate = true;
  }
  clear() { this.live.length = 0; }
}
/* A flare: a soft glowing disc that always faces the camera (a sprite), for sparkles and light. */
export function flare(hex = 0xffffff, size = 1, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowMap(), color: hex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size);
  return s;
}
export const palette = (look) => [look.main, look.accent, 0xffffff, 0xffd84a];
