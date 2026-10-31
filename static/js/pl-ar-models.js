/* Satürn 3D lenses, the models (pl-ar-models.js): glasses, hats, ears, horns, a crown, a nose, teeth and a tongue made of three.js shapes (see pl-ar.js). Everything is in the space of the
   canonical face of MediaPipe, in centimetres: x to the right, y up, z out of the face; the tip of the nose is at (0, -0.5, 7.6), the eyes at (+-3.1, 2.6, 3.5), the top of the forehead at
   (0, 8.3, 4.5), the corners of the mouth at (+-2.5, -4.3, 4.3), the ears at about (+-7.6, 0.5, -2.4). A model is `(k) => object` (k: kit with the materials and shapes), and may have
   `update(object, f, k, frame)` that moves parts every picture (f: the face, frame.blend: the blendshapes). */
(function () {
  "use strict";

  const AR = window.PulseAR;
  if (!AR) return;
  const { add } = AR;
  const PI = Math.PI;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const set = (o, x, y, z, rx = 0, ry = 0, rz = 0) => { o.position.set(x, y, z); o.rotation.set(rx, ry, rz); return o; };
  const blendOf = (frame, name) => (frame && frame.blend && frame.blend[name]) || 0;

  // ------------------------------------------------------------------------------------------------------------------ glasses
  /* two lenses with a frame, a bridge and the arms that go back to the ears; `outline(size)` makes the outline of one lens (centre at 0, 0) */
  function glasses(k, { outline, lensMat, frameMat, size = 5.4, arms = true, bridge = true, thick = 0.55, z = 5.3, lensDepth = 0.14, rim = 0.9, wire = false, tilt = 0 }) {
    const { T, mesh, extrude } = k;
    const g = new T.Group();
    g.userData.lenses = [];
    for (const side of [-1, 1]) {
      const x = side * 3.15;
      const holder = new T.Group();
      set(holder, x, 2.55, z, 0, 0, side * tilt);
      if (wire) {
        const ring = new T.Shape();
        ring.absarc(0, 0, size / 2, 0, PI * 2, false);
        holder.add(mesh(new T.TorusGeometry(size / 2, 0.2, 14, 48), frameMat));
        holder.add(mesh(new T.CircleGeometry(size / 2 - 0.05, 40), lensMat, 0, 0, -0.05));
      } else {
        const outer = outline(size);
        outer.holes.push(new T.Path(outline(size - rim).getPoints(40)));
        holder.add(mesh(extrude(outer, thick, 0.1), frameMat));
        holder.add(mesh(extrude(outline(size - rim + 0.1), lensDepth, 0.04), lensMat, 0, 0, -0.05));
      }
      g.add(holder);
      g.userData.lenses.push(holder);
      if (arms) {
        const from = new T.Vector3(x + side * size * 0.5, 2.9, z - 0.2);
        const to = new T.Vector3(side * 7.5, 2.4, -1.2);
        const arm = mesh(new T.CylinderGeometry(0.22, 0.22, from.distanceTo(to), 10), frameMat);
        arm.position.copy(from).add(to).multiplyScalar(0.5);
        arm.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.clone().sub(from).normalize());
        g.add(arm);
      }
    }
    if (bridge) g.add(mesh(new T.TorusGeometry(1.15, 0.22, 10, 24, PI), frameMat, 0, 3.15, z - 0.05));
    return g;
  }

  add("sunglasses", { model: (k) => glasses(k, {
    outline: (s) => k.roundedRect(s, s * 0.74, s * 0.3),
    lensMat: k.mat(0x1d2a38, { rough: 0.04, metal: 0.55, clear: 1, clearRough: 0.03 }),
    frameMat: k.mat(0x0e0e11, { rough: 0.22, clear: 0.9 }),
    size: 5.5,
  }) });

  add("roundGlasses", { model: (k) => glasses(k, {
    wire: true, size: 5.0, outline: () => null,
    lensMat: k.mat(0xb9dcff, { rough: 0.05, metal: 0.1, clear: 1, opacity: 0.18 }),
    frameMat: k.mat(0xd9a520, { rough: 0.25, metal: 1 }),
  }) });

  add("nerdGlasses", { model: (k) => {
    const g = glasses(k, {
      outline: (s) => k.roundedRect(s, s * 0.78, s * 0.2), size: 5.7, rim: 1.1, thick: 0.7,
      lensMat: k.mat(0xc7e6ff, { rough: 0.05, clear: 1, opacity: 0.12 }),
      frameMat: k.mat(0x15151a, { rough: 0.28, clear: 0.7 }),
    });
    g.add(k.mesh(new k.T.BoxGeometry(1.5, 1.1, 0.5), k.mat(0xf1ede2, { rough: 0.6 }), 0, 3.0, 5.7, 0, 0, 0.12));            // the tape on the bridge
    return g;
  } });

  add("heartGlasses", { model: (k) => glasses(k, {
    outline: (s) => k.heartShape(s), size: 6.2, rim: 1.4, thick: 0.7, bridge: true,
    lensMat: k.mat(0xff7aa8, { rough: 0.08, clear: 1, opacity: 0.45 }),
    frameMat: k.mat(0xe0245e, { rough: 0.18, clear: 1 }),
  }) });

  add("starGlasses", { model: (k) => {
    const g = glasses(k, {
      outline: (s) => k.starShape(s * 0.55, s * 0.26), size: 6.3, rim: 1.2, thick: 0.7,
      lensMat: k.mat(0xffe27a, { rough: 0.08, clear: 1, opacity: 0.5 }),
      frameMat: k.mat(0xffb400, { rough: 0.15, metal: 0.7, clear: 1 }),
    });
    return g;
  }, update: (o, f) => { o.userData.lenses.forEach((holder, i) => { holder.rotation.z = (i ? -1 : 1) * f.t * 0.5; }); } });

  add("monocle", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const gold = mat(0xd9a520, { rough: 0.25, metal: 1 });
    g.add(mesh(new T.TorusGeometry(2.5, 0.2, 14, 48), gold, 3.15, 2.6, 5.3));
    g.add(mesh(new T.CircleGeometry(2.45, 36), mat(0xc7e6ff, { opacity: 0.14, clear: 1 }), 3.15, 2.6, 5.25));
    const chain = new T.CatmullRomCurve3([new T.Vector3(3.9, 0.5, 5.4), new T.Vector3(5.2, -2.5, 5.0), new T.Vector3(5.6, -6.5, 3.6), new T.Vector3(4.6, -10, 2.8)]);
    g.add(mesh(new T.TubeGeometry(chain, 24, 0.09, 6), gold));
    return g;
  } });

  // ------------------------------------------------------------------------------------------------------------------ hats
  add("topHat", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const profile = [[0, 0], [10.2, 0], [10.6, 0.25], [10.5, 0.55], [6.9, 0.7], [6.6, 3], [6.5, 12.2], [6.2, 12.9], [5.2, 13.1], [0, 13.1]].map(([r, y]) => new T.Vector2(r, y));
    g.add(mesh(new T.LatheGeometry(profile, 64), mat(0x141417, { rough: 0.3, clear: 0.6, clearRough: 0.25 })));
    g.add(mesh(new T.CylinderGeometry(6.72, 6.72, 2.3, 64, 1, true), mat(0xb3202e, { rough: 0.4, clear: 0.5, side: T.DoubleSide }), 0, 1.9, 0));
    return set(g, 0, 7.9, 0.4, -0.12, 0, 0);
  } });

  add("crown", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const gold = mat(0xf5b800, { rough: 0.2, metal: 1, clear: 0.6 });
    g.add(mesh(new T.CylinderGeometry(6.6, 6.2, 2.6, 48, 1, true), mat(0xf5b800, { rough: 0.2, metal: 1, clear: 0.6, side: T.DoubleSide }), 0, 1.3, 0));
    g.add(mesh(new T.TorusGeometry(6.4, 0.38, 12, 48), gold, 0, 0.1, 0, PI / 2));
    g.add(mesh(new T.TorusGeometry(6.55, 0.3, 12, 48), gold, 0, 2.6, 0, PI / 2));
    const gems = [0xe0245e, 0x2f7dff, 0x2fd05a, 0x2f7dff, 0xe0245e];
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * PI * 2;
      const x = Math.sin(a) * 6.2, z = Math.cos(a) * 6.2;
      const spike = mesh(new T.ConeGeometry(1.5, 5.2, 4), gold, x, 5.0, z, 0, -a, 0);
      spike.scale.set(1, 1, 0.55);
      const tip = mesh(new T.SphereGeometry(0.62, 16, 12), gold, x, 7.8, z);
      g.add(spike, tip, mesh(new T.OctahedronGeometry(0.62), mat(gems[i], { rough: 0.05, metal: 0.2, clear: 1, emissive: gems[i], emissiveIntensity: 0.25 }), Math.sin(a) * 6.7, 1.3, Math.cos(a) * 6.7));
    }
    return set(g, 0, 9.0, 0.6, -0.1, 0, 0);
  } });

  add("propellerHat", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const colors = [0xe83a3a, 0xffd23a, 0x2f7dff, 0x2fd05a, 0xe83a3a, 0xffd23a];
    colors.forEach((c, i) => {
      const part = mesh(new T.SphereGeometry(8.4, 20, 16, (i * PI) / 3, PI / 3, 0, PI / 2), mat(c, { rough: 0.5, clear: 0.3, side: T.DoubleSide }));
      part.scale.y = 0.82;
      g.add(part);
    });
    g.add(mesh(new T.TorusGeometry(8.35, 0.42, 12, 48), mat(0xf4f4f4, { rough: 0.5 }), 0, 0, 0, PI / 2));
    g.add(mesh(new T.SphereGeometry(0.95, 16, 12), mat(0xe83a3a, { rough: 0.3, clear: 0.6 }), 0, 6.95, 0));
    g.add(mesh(new T.CylinderGeometry(0.22, 0.22, 1.6, 10), mat(0xc9ccd2, { rough: 0.3, metal: 1 }), 0, 7.6, 0));
    const prop = new T.Group();
    prop.add(mesh(new T.BoxGeometry(8.4, 0.18, 1.6), mat(0xe83a3a, { rough: 0.4, clear: 0.5 })), mesh(new T.BoxGeometry(1.6, 0.18, 8.4), mat(0x2f7dff, { rough: 0.4, clear: 0.5 })));
    prop.position.y = 8.5;
    g.userData.prop = prop;
    g.add(prop);
    return set(g, 0, 7.2, 0.5, -0.14, 0, 0);
  }, update: (o, f) => { o.userData.prop.rotation.y = f.t * 14; } });

  add("pirate", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    // the red cloth with white dots lies on the head like a cap (a bit bigger than the skull) and is tied at the back
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const c = cv.getContext("2d");
    c.fillStyle = "#c01c28"; c.fillRect(0, 0, 256, 256);
    c.fillStyle = "rgba(255,255,255,0.92)";
    for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) { c.beginPath(); c.arc(x * 32 + (y % 2) * 16 + 8, y * 32 + 12, 4.4, 0, PI * 2); c.fill(); }
    const tex = new T.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.repeat.set(3, 1.5);
    const rx = 8.4, ry = 10.1, rz = 8.9, limit = 1.34;
    const cap = new T.Group();
    cap.add(mesh(new T.SphereGeometry(1, 48, 28, 0, PI * 2, 0, limit), new T.MeshStandardMaterial({ map: tex, roughness: 0.82, side: T.DoubleSide })));
    cap.scale.set(rx, ry, rz);
    const rim = [];
    for (let i = 0; i <= 48; i += 1) { const a = (i / 48) * PI * 2; rim.push(new T.Vector3(Math.sin(limit) * Math.cos(a) * rx, Math.cos(limit) * ry, Math.sin(limit) * Math.sin(a) * rz)); }
    const band = mesh(new T.TubeGeometry(new T.CatmullRomCurve3(rim, true), 96, 0.42, 8, true), mat(0x8e1019, { rough: 0.8 }));
    const holder = new T.Group();
    holder.add(cap, band);
    set(holder, 0, 2.7, -3.2, 0.25, 0, 0);
    g.add(holder);
    for (let i = 0; i < 2; i += 1) g.add(mesh(new T.ConeGeometry(1.2, 4.4, 10), mat(0xc01c28, { rough: 0.8 }), -1.8 + i * 3.6, 1.4, -11.6, -PI / 2 - 0.25, 0, i ? -0.45 : 0.45));
    // the patch on the right eye with its strap
    const patch = mesh(new T.SphereGeometry(2.7, 28, 18), mat(0x0c0c0e, { rough: 0.35, clear: 0.6 }), 3.15, 2.4, 4.7);
    patch.scale.set(1, 0.86, 0.38);
    const strap = new T.CatmullRomCurve3([new T.Vector3(0.6, 3.6, 5.0), new T.Vector3(-2.6, 7.4, 5.0), new T.Vector3(-7.4, 6.2, 0.6), new T.Vector3(-3.5, 6.2, -8.0), new T.Vector3(4.5, 6.2, -7.4), new T.Vector3(7.8, 3.8, -0.4), new T.Vector3(5.8, 1.4, 4.4)]);
    g.add(patch, mesh(new T.TubeGeometry(strap, 80, 0.16, 6), mat(0x0c0c0e, { rough: 0.6 })));
    g.add(mesh(new T.TorusGeometry(0.75, 0.16, 10, 20), mat(0xf5b800, { rough: 0.2, metal: 1 }), 7.9, -1.4, -1.6, 0, PI / 2, 0));
    return g;
  } });

  add("clownWig", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const palette = [0xff6a00, 0xff3b6b, 0x2fd05a, 0x2f7dff, 0xffd23a];
    let n = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 7) * 1.5 - 0.1;
        const r = 2.3 + (i % 3) * 0.55;
        g.add(mesh(new T.SphereGeometry(r, 18, 14), mat(palette[(n += 1) % palette.length], { rough: 0.55, clear: 0.2 }), side * (8.6 + Math.sin(a) * 1.8), 8.6 - i * 1.2 + Math.cos(a) * 0.6, -1.4 + (i % 2) * 1.6));
      }
    }
    for (let i = 0; i < 6; i += 1) g.add(mesh(new T.SphereGeometry(2.5 + (i % 2) * 0.5, 18, 14), mat(palette[(n += 1) % palette.length], { rough: 0.55, clear: 0.2 }), (i - 2.5) * 2.3, 11.2 + (i % 2) * 0.8, -0.8 - Math.abs(i - 2.5) * 0.5));
    return g;
  } });

  // ------------------------------------------------------------------------------------------------------------------ ears, horns, a halo
  add("catEars", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    for (const side of [-1, 1]) {
      const ear = new T.Group();
      const outer = mesh(new T.ConeGeometry(2.8, 5.6, 4), mat(0x8c8c99, { rough: 0.9 }));
      outer.scale.z = 0.45;
      const inner = mesh(new T.ConeGeometry(1.8, 4.2, 4), mat(0xffa6c2, { rough: 0.85 }), 0, -0.3, 0.6);
      inner.scale.z = 0.3;
      ear.add(outer, inner);
      g.add(set(ear, side * 4.8, 10.6, 0.3, 0, side * 0.2, -side * 0.38));
    }
    return g;
  } });

  add("dogEars", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    g.userData.ears = [];
    for (const side of [-1, 1]) {
      const pivot = new T.Group();
      const outer = mesh(new T.SphereGeometry(1, 24, 18), mat(0x8a5a2c, { rough: 0.9 }), 0, -3.6, 0);
      outer.scale.set(2.5, 4.6, 1.05);
      const inner = mesh(new T.SphereGeometry(1, 20, 14), mat(0x5e3a1c, { rough: 0.9 }), 0, -3.5, 0.5);
      inner.scale.set(1.9, 3.7, 0.5);
      pivot.add(outer, inner);
      set(pivot, side * 7.0, 8.2, -0.2, 0, 0, side * 0.32);
      pivot.userData.base = side * 0.32;
      g.add(pivot);
      g.userData.ears.push(pivot);
    }
    return g;
  }, update: (o, f) => { o.userData.ears.forEach((p, i) => { p.rotation.z = p.userData.base + Math.sin(f.t * 2.2 + i) * 0.05 + Math.sin(f.roll * 2) * 0.12; }); } });

  add("bunnyEars", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    g.userData.ears = [];
    for (const side of [-1, 1]) {
      const pivot = new T.Group();
      const outer = mesh(new T.CapsuleGeometry(1.55, 9.5, 8, 20), mat(0xf3f0ee, { rough: 0.9 }), 0, 5.6, 0);
      outer.scale.z = 0.5;
      const inner = mesh(new T.CapsuleGeometry(0.95, 8.4, 8, 16), mat(0xffa6c2, { rough: 0.85 }), 0, 5.4, 0.45);
      inner.scale.z = 0.35;
      pivot.add(outer, inner);
      set(pivot, side * 3.3, 8.8, -0.6, 0, 0, -side * 0.2);
      pivot.userData.base = -side * 0.2;
      g.add(pivot);
      g.userData.ears.push(pivot);
    }
    return g;
  }, update: (o, f) => { o.userData.ears.forEach((p, i) => { p.rotation.z = p.userData.base + Math.sin(f.t * 1.6 + i * 1.7) * 0.05; p.rotation.x = Math.sin(f.t * 1.3 + i) * 0.04; }); } });

  add("devilHorns", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const red = mat(0xc4161c, { rough: 0.22, clear: 1, clearRough: 0.12 });
    const dark = mat(0x7a0b10, { rough: 0.4, clear: 0.5 });
    for (const side of [-1, 1]) {
      const horn = new T.Group();
      const steps = 14, R = 7.2, sweep = 1.25;
      const spot = (t) => new T.Vector3(side * R * (1 - Math.cos(t * sweep)), R * Math.sin(t * sweep), 0);
      for (let i = 0; i < steps; i += 1) {                                  // a curved, pointed horn made of short tapering pieces
        const a = spot(i / steps), b = spot((i + 1) / steps);
        const r0 = 1.5 * (1 - i / steps) + 0.08, r1 = 1.5 * (1 - (i + 1) / steps) + 0.08;
        const len = a.distanceTo(b);
        const seg = mesh(new T.CylinderGeometry(r1, r0, len * 1.04, 16), i < 2 ? dark : red);
        seg.position.copy(a).add(b).multiplyScalar(0.5);
        seg.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        horn.add(seg);
        if (i) horn.add(mesh(new T.SphereGeometry(r0, 14, 10), red, a.x, a.y, a.z));
      }
      g.add(set(horn, side * 3.9, 7.9, 1.9, -0.3, 0, 0));
    }
    return g;
  } });

  add("halo", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    g.add(mesh(new T.TorusGeometry(4.7, 0.5, 18, 56), mat(0xffd45a, { rough: 0.2, metal: 0.6, emissive: 0xffc933, emissiveIntensity: 1.1 })));
    g.add(mesh(new T.TorusGeometry(4.7, 0.95, 12, 56), mat(0xffe28a, { rough: 0.5, emissive: 0xffd45a, emissiveIntensity: 0.6, opacity: 0.22 })));
    return set(g, 0, 15, 0.8, PI / 2 + 0.2, 0, 0);
  }, update: (o, f) => { o.position.y = 15 + Math.sin(f.t * 2.2) * 0.5; o.rotation.z = Math.sin(f.t * 1.5) * 0.06; } });

  // ------------------------------------------------------------------------------------------------------------------ nose, moustache, teeth, tongue
  add("clownNose", { model: (k) => {
    const { T, mesh, mat } = k;
    return mesh(new T.SphereGeometry(2.0, 28, 20), mat(0xe0121e, { rough: 0.12, clear: 1, clearRough: 0.05 }), 0, -0.2, 8.5);
  } });

  add("mustache", { model: (k) => {
    const { T, mesh, mat, extrude } = k;
    const half = new T.Shape();
    half.moveTo(0, 0.5);
    half.bezierCurveTo(1.4, 1.5, 3.0, 1.7, 4.1, 0.9);
    half.bezierCurveTo(4.9, 0.4, 5.1, 1.5, 4.6, 2.2);
    half.bezierCurveTo(5.5, 1.6, 5.9, 0.2, 4.7, -0.5);
    half.bezierCurveTo(3.0, -1.6, 1.2, -0.8, 0, -0.9);
    half.closePath();
    const left = new T.Shape();
    left.moveTo(0, 0.5);
    left.bezierCurveTo(-1.4, 1.5, -3.0, 1.7, -4.1, 0.9);
    left.bezierCurveTo(-4.9, 0.4, -5.1, 1.5, -4.6, 2.2);
    left.bezierCurveTo(-5.5, 1.6, -5.9, 0.2, -4.7, -0.5);
    left.bezierCurveTo(-3.0, -1.6, -1.2, -0.8, 0, -0.9);
    left.closePath();
    const hair = mat(0x35210f, { rough: 0.85 });
    const g = new T.Group();
    g.add(mesh(extrude(half, 1.1, 0.25), hair), mesh(extrude(left, 1.1, 0.25), hair));
    return set(g, 0, -2.75, 6.5, 0.15, 0, 0);
  } });

  /* the teeth: rounded, white, glossy. The upper row hangs from the upper lip, the lower row (if there is one) stands on the lower lip and goes down with the jaw. */
  function teeth(k, { count, w, h, d, rows = 1, top = -3.55, spread = 1.1 }) {
    const { T, mesh, mat, roundedRect, extrude } = k;
    const g = new T.Group();
    const white = mat(0xfbfaf4, { rough: 0.22, clear: 0.8, clearRough: 0.1 });
    const geo = extrude(roundedRect(w, h, w * 0.36), d, 0.1);
    g.userData.rows = [];
    for (let r = 0; r < rows; r += 1) {
      const row = new T.Group();
      for (let i = 0; i < count; i += 1) {
        const x = (i - (count - 1) / 2) * spread;
        row.add(mesh(geo, white, x, r ? h * 0.5 : -h * 0.5, 6.0 - 0.09 * x * x));
      }
      row.position.y = r ? top - h - 0.1 : top;
      g.add(row);
      g.userData.rows.push(row);
    }
    return g;
  }
  add("bigTeeth", { model: (k) => teeth(k, { count: 5, w: 1.0, h: 1.9, d: 0.7, rows: 2, spread: 1.0 }),
    update: (o, f, k, frame) => { const jaw = blendOf(frame, "jawOpen"); o.userData.rows[1].position.y = -5.65 - jaw * 3.6; } });
  add("buckTeeth", { model: (k) => teeth(k, { count: 2, w: 1.3, h: 2.1, d: 0.7, rows: 1, spread: 1.34, top: -3.6 }) });

  add("tongue", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const pink = mat(0xe2566e, { rough: 0.32, clear: 0.5 });
    const body = mesh(new T.CapsuleGeometry(1.7, 5.2, 8, 20), pink);
    body.rotation.x = PI / 2;
    body.scale.set(1, 1, 0.5);
    const groove = mesh(new T.CapsuleGeometry(0.16, 4.4, 4, 8), mat(0xb83a50, { rough: 0.5 }), 0, 0.5, 0.85);
    groove.rotation.x = PI / 2;
    const holder = new T.Group();
    holder.add(body, groove);
    holder.position.set(0, 0, 3.4);
    g.add(holder);
    return set(g, 0, -4.7, 4.9, 0.55, 0, 0);
  }, update: (o, f, k, frame) => {
    const jaw = blendOf(frame, "jawOpen");
    const out = smooth(0.06, 0.42, jaw);
    o.visible = out > 0.02;
    o.position.y = -4.6 - jaw * 3.0;
    o.scale.setScalar(0.6 + out * 0.5);
    o.rotation.x = 0.45 + Math.sin(f.t * 5) * 0.03;
  } });

  // ------------------------------------------------------------------------------------------------------------------ robot, animal noses
  add("robot", { model: (k) => {
    const { T, mesh, mat } = k;
    const g = new T.Group();
    const steel = mat(0xb9c0c8, { rough: 0.3, metal: 1 });
    for (const side of [-1, 1]) {
      const disc = mesh(new T.CylinderGeometry(2.4, 2.4, 1.2, 30), steel, side * 8.0, 0.4, -1.4, 0, 0, PI / 2);
      g.add(disc, mesh(new T.CylinderGeometry(1.2, 1.2, 1.4, 20), mat(0x4b535b, { rough: 0.4, metal: 1 }), side * 8.15, 0.4, -1.4, 0, 0, PI / 2));
    }
    g.add(mesh(new T.CylinderGeometry(0.28, 0.28, 4.2, 10), steel, 0, 11.4, 0.4));
    const bulb = mesh(new T.SphereGeometry(0.95, 18, 14), mat(0xff3b3b, { rough: 0.15, clear: 1, emissive: 0xff2020, emissiveIntensity: 0.8 }), 0, 13.7, 0.4);
    g.userData.bulb = bulb;
    g.add(bulb);
    return g;
  }, update: (o, f) => { o.userData.bulb.material.emissiveIntensity = Math.sin(f.t * 5) > 0 ? 1.6 : 0.15; } });

  add("dogNose", { model: (k) => {
    const { T, mesh, mat } = k;
    const nose = mesh(new T.SphereGeometry(1.7, 24, 18), mat(0x141416, { rough: 0.12, clear: 1, clearRough: 0.04 }), 0, 0.1, 8.1);
    nose.scale.set(1.2, 0.85, 0.9);
    return nose;
  } });
  add("catNose", { model: (k) => {
    const { T, mesh, mat } = k;
    const nose = mesh(new T.ConeGeometry(1.25, 1.2, 3), mat(0xff8aa8, { rough: 0.3, clear: 0.8 }), 0, 0.2, 8.2, PI, 0, 0);
    nose.scale.z = 0.7;
    return nose;
  } });
  add("bunnyNose", { model: (k) => k.mesh(new k.T.SphereGeometry(0.95, 20, 14), k.mat(0xff8aa8, { rough: 0.3, clear: 0.8 }), 0, 0.1, 8.0) });

  window.PulseAR.glasses = glasses;
})();
