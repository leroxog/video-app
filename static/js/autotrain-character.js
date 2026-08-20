// Builds AutoTrain's two low-poly, smooth-shaded character models (one
// per gender) out of plain Three.js primitives -- capsules/spheres/
// cylinders, no external 3D assets or model files. This is a deliberate
// stylized-low-poly art direction (think a simplified, smooth-shaded
// "chibi-adjacent but proportioned" look), not an attempt at
// photorealistic character art -- that's simply not achievable with
// hand-written geometry in code, and claiming otherwise would be
// dishonest. Shared between autotrain-home.js (character-creation
// preview) and autotrain-game.js (in-world players), so both always stay
// visually identical.
import * as THREE from "./vendor/three.module.js";

const PALETTE = {
  m: { skin: 0xe8b48a, hair: 0x3b2a1a, shirt: 0x3b6ea5, pants: 0x2b2f3a, shoe: 0x1c1c22, beard: 0x2c2013 },
  f: { skin: 0xf0c19c, hair: 0x7a3b2e, shirt: 0xb5507a, pants: 0x33324a, shoe: 0x232028, hairAccent: 0x9c5142 },
};

function smoothMat(color, roughness = 0.62, metalness = 0.04) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geometry, material, x, y, z) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Returns a THREE.Group, feet at local y=0, roughly 1.75 world units tall. */
export function buildCharacter(gender) {
  const g = gender === "f" ? "f" : "m";
  const c = PALETTE[g];
  const group = new THREE.Group();
  group.name = "autotrain-character";

  const skinMat = smoothMat(c.skin, 0.55, 0.02);
  const hairMat = smoothMat(c.hair, 0.5, 0.02);
  const shirtMat = smoothMat(c.shirt, 0.68);
  const pantsMat = smoothMat(c.pants, 0.7);
  const shoeMat = smoothMat(c.shoe, 0.55, 0.1);

  // Legs
  const legRadius = 0.11, legLen = 0.62;
  for (const side of [-1, 1]) {
    group.add(mesh(new THREE.CapsuleGeometry(legRadius, legLen, 4, 8), pantsMat, side * 0.13, legLen / 2 + legRadius, 0));
    group.add(mesh(new THREE.BoxGeometry(0.16, 0.09, 0.24), shoeMat, side * 0.13, 0.045, 0.03));
  }
  const hipY = legLen + legRadius * 2;

  // Torso (capsule reads as a soft, rounded chest/waist shape)
  const torsoH = g === "f" ? 0.5 : 0.56;
  const torsoR = g === "f" ? 0.19 : 0.22;
  const torso = mesh(new THREE.CapsuleGeometry(torsoR, torsoH, 4, 10), shirtMat, 0, hipY + torsoH / 2 + torsoR, 0);
  group.add(torso);
  const shoulderY = hipY + torsoH + torsoR * 1.5;

  // Arms
  const armR = 0.075, armLen = 0.5;
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.CapsuleGeometry(armR, armLen, 4, 8), shirtMat, side * (torsoR + armR + 0.02), shoulderY - armLen / 2 - 0.05, 0);
    arm.rotation.z = side * 0.12;
    group.add(arm);
    group.add(mesh(new THREE.SphereGeometry(0.085, 10, 10), skinMat, side * (torsoR + armR + 0.02 + Math.sin(0.12) * armLen), shoulderY - armLen - 0.12, 0));
  }

  // Neck + head
  const neckY = shoulderY + 0.05;
  group.add(mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.12, 10), skinMat, 0, neckY + 0.06, 0));
  const headY = neckY + 0.12 + 0.17;
  const head = mesh(new THREE.SphereGeometry(0.19, 16, 14), skinMat, 0, headY, 0);
  head.scale.set(0.92, 1.05, 0.96);
  group.add(head);

  if (g === "m") {
    // Short hair cap: a flattened sphere sitting on the upper half of the head.
    const cap = mesh(new THREE.SphereGeometry(0.195, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), hairMat, 0, headY + 0.02, 0);
    group.add(cap);
    // Beard: a rounded box hugging the jaw/chin.
    const beardMat = smoothMat(c.beard, 0.6, 0.02);
    const beard = mesh(new THREE.SphereGeometry(0.145, 12, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.55), beardMat, 0, headY - 0.1, 0.04);
    beard.scale.set(1.0, 0.85, 0.95);
    group.add(beard);
  } else {
    // Hair cap (fringe/top) + a teardrop "flow" down the back for length.
    const cap = mesh(new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.7), hairMat, 0, headY + 0.015, 0);
    group.add(cap);
    const flow = mesh(new THREE.ConeGeometry(0.16, 0.55, 12), hairMat, 0, headY - 0.24, -0.06);
    flow.rotation.x = Math.PI;
    flow.scale.set(1, 1, 0.7);
    group.add(flow);
    const accentMat = smoothMat(c.hairAccent, 0.5, 0.02);
    group.add(mesh(new THREE.TorusGeometry(0.02, 0.012, 6, 12), accentMat, 0, headY - 0.02, 0.19));
  }

  // Simple facial detail: two small dark spheres for eyes, always readable
  // from the game's overhead camera angle even without a face texture.
  const eyeMat = smoothMat(0x1a1a1f, 0.3, 0);
  for (const side of [-1, 1]) {
    group.add(mesh(new THREE.SphereGeometry(0.02, 8, 8), eyeMat, side * 0.065, headY + 0.02, 0.175));
  }

  group.userData.gender = g;
  group.userData.totalHeight = headY + 0.19;
  return group;
}

window.AutoTrainCharacter = { buildCharacter };
