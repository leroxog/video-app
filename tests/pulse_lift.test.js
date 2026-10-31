// The 3D lift of the small games (static/js/pg-lift3d.js) without a browser: the recorder takes the place of the canvas, every game is played for a while and drawn through it, and what it wrote down is turned
// into the solids (typed arrays) the way the view would take them. Nothing may throw, every number must be finite, the arrays must have room, and a frame must not take long.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.window = global;
global.performance = global.performance || { now: () => Date.now() };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};
global.document = { getElementById: () => null };
global.addEventListener = () => {};

const dir = path.join(__dirname, "..", "static", "js");
const files = fs.readdirSync(dir).filter((name) => /^pg-.*\.js$/.test(name) && name !== "pg-fruit.js").sort((a, b) => (a === "pg-kit.js" ? -1 : b === "pg-kit.js" ? 1 : a.localeCompare(b)));
for (const name of files) require(path.join(dir, name));
const { PulseGames } = global;
const lift = PulseGames.lift;

test("colours of every kind are read", () => {
  assert.deepEqual(lift.parseColor("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(lift.parseColor("#1e90ff"), [30, 144, 255, 1]);
  assert.deepEqual(lift.parseColor("rgba(0,0,0,0.5)"), [0, 0, 0, 0.5]);
  assert.deepEqual(lift.parseColor("rgb(10, 20, 30)"), [10, 20, 30, 1]);
  assert.deepEqual(lift.parseColor("hsl(120, 100%, 50%)").map(Math.round), [0, 255, 0, 1]);
  assert.equal(lift.parseColor("transparent")[3], 0);
  assert.equal(lift.parseColor("white")[0], 255);
  assert.equal(lift.parseColor("not a colour")[3], 1, "an unknown colour is a grey, not an error");
});

test("the recorder writes down what was drawn, with the transform and the order", () => {
  const rec = lift.makeRecorder();
  rec.begin();
  rec.fillStyle = "#ff0000";
  rec.save();
  rec.translate(100, 200);
  rec.rotate(Math.PI / 2);
  rec.fillRect(0, 0, 20, 10);
  rec.restore();
  rec.fillStyle = "rgba(0,0,255,0.5)";
  rec.beginPath(); rec.arc(50, 50, 10, 0, Math.PI * 2); rec.fill();
  rec.font = "20px sans-serif"; rec.textAlign = "center"; rec.textBaseline = "middle";
  rec.strokeStyle = "#000"; rec.lineWidth = 4; rec.strokeText("Hi", 10, 10);
  rec.fillStyle = "#fff"; rec.fillText("Hi", 10, 10);
  rec.drawImage({ width: 8, height: 8 }, 1, 2, 30, 40);
  const items = rec.items();
  assert.equal(items.length, 4, "a rectangle, a circle, one text (the outline and the fill are one picture), an image");
  assert.equal(items[0].k, "poly");
  const xs = [0, 2, 4, 6].map((i) => items[0].pts[i]);
  assert.ok(Math.abs(Math.min(...xs) - 90) < 1e-6 && Math.abs(Math.max(...xs) - 100) < 1e-6, "turned by a quarter: 10 wide, 20 high from (100, 200)");
  assert.equal(items[1].round, true);
  assert.ok(items[1].alpha === 1 && items[1].paint.rgba[3] === 0.5);
  assert.equal(items[2].k, "text");
  assert.deepEqual([items[2].fill, items[2].outline].map((c) => c && c[0]), [255, 0], "the text has a white fill and a black outline");
  assert.equal(items[3].k, "image");
  rec.clearRect(0, 0, 360, 640);
  assert.equal(rec.items().length, 0, "a clear of the whole field starts again");
  rec.moveTo(1, 2); rec.setLineDash([2, 2]); rec.imageSmoothingEnabled = false; rec.somethingNew(1, 2);   // (what it does not know does nothing and does not throw)
});

test("a shape lies on the highest thing that was drawn under it, and see-through shapes are flat", () => {
  const rec = lift.makeRecorder();
  rec.begin();
  rec.fillStyle = "#336699"; rec.fillRect(0, 0, 360, 640);                        // the whole field: the floor
  rec.fillStyle = "#cc3333"; rec.fillRect(40, 40, 100, 100);                       // on the floor
  rec.fillStyle = "#33cc33"; rec.fillRect(60, 60, 40, 40);                         // on the red one
  rec.fillStyle = "#cccc33"; rec.fillRect(200, 300, 40, 40);                       // somewhere else on the floor
  rec.fillStyle = "rgba(0,0,0,0.4)"; rec.fillRect(20, 20, 50, 50);                 // glass
  const plan = lift.layout(rec.items());
  assert.equal(plan.decals.length, 2, "the floor and the glass");
  assert.equal(plan.prisms.length, 3);
  const [red, green, yellow] = plan.prisms;
  assert.ok(red.z0 < 0.1, "on the floor (a hair above it, so that the two do not flicker)");
  assert.ok(Math.abs(green.z0 - (red.z0 + red.thick)) < 1e-6, "the green one stands on the red one");
  assert.ok(yellow.z0 < 0.1, "a shape that touches nothing stands on the floor");
  assert.ok(plan.decals[1].z > green.z0, "the glass lies above what it covers");
  assert.ok(plan.height > 0 && plan.height <= lift.MAX_TOP);
});

test("a stack of a hundred layers does not grow into the sky", () => {
  const rec = lift.makeRecorder();
  rec.begin();
  for (let i = 0; i < 100; i += 1) { rec.fillStyle = `hsl(${i * 7},70%,50%)`; rec.fillRect(100, 100, 80, 80); }
  const plan = lift.layout(rec.items());
  assert.ok(plan.prisms.every((p) => p.z0 + p.thick <= lift.MAX_TOP + 1e-6));
});

test("the polygons are cut into triangles that fill them", () => {
  const area = (p, tri) => { let s = 0; for (let t = 0; t < tri.length; t += 3) { const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]]; s += Math.abs((p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[a * 2])) / 2; } return s; };
  const square = [0, 0, 10, 0, 10, 10, 0, 10];
  assert.equal(lift.triangulate(square).length, 6);
  assert.ok(Math.abs(area(square, lift.triangulate(square)) - 100) < 1e-6);
  const arrow = [0, 0, 10, 0, 10, 4, 6, 4, 6, 10, 0, 10];                           // an L: not convex
  assert.ok(Math.abs(area(arrow, lift.triangulate(arrow)) - 76) < 1e-6, "the L is cut into ears");
  const reversed = [];
  for (let i = arrow.length / 2 - 1; i >= 0; i -= 1) reversed.push(arrow[i * 2], arrow[i * 2 + 1]);
  assert.ok(Math.abs(area(reversed, lift.triangulate(reversed)) - 76) < 1e-6, "the direction does not matter");
});

test("a solid has walls, a chamfer and a top, a ball is a dome, and the normals look outwards", () => {
  const sink = lift.makeSink(5000);
  const paint = { rgba: [200, 100, 50, 1], grad: null };
  assert.ok(lift.addPrism(sink, { pts: [10, 10, 60, 10, 60, 40, 10, 40], z0: 0, thick: 5, bevel: 1.5, round: false, paint }));
  assert.equal(sink.n % 3, 0);
  let topZ = 0;
  for (let i = 0; i < sink.n; i += 1) { assert.ok(Number.isFinite(sink.pos[i * 3] + sink.pos[i * 3 + 1] + sink.pos[i * 3 + 2])); topZ = Math.max(topZ, sink.pos[i * 3 + 2]); }
  assert.equal(topZ, 5, "the top is as high as the thickness");
  for (let i = 0; i < sink.n; i += 1) assert.ok(Math.abs(Math.hypot(sink.nor[i * 3], sink.nor[i * 3 + 1], sink.nor[i * 3 + 2]) - 1) < 0.03, "unit normals");
  // the normals of the walls on the right side look to the right (x grows) and the ones of the top look up
  let right = 0, up = 0;
  for (let i = 0; i < sink.n; i += 1) { if (sink.nor[i * 3] > 0.9) right += 1; if (sink.nor[i * 3 + 2] > 0.99) up += 1; }
  assert.ok(right >= 6 && up >= 6, "walls on the right and a top");
  const ball = lift.makeSink(5000);
  const pts = [];
  for (let i = 0; i < 16; i += 1) pts.push(100 + 20 * Math.cos(i / 16 * Math.PI * 2), 100 + 20 * Math.sin(i / 16 * Math.PI * 2));
  assert.ok(lift.addPrism(ball, { pts, z0: 3, thick: 12, bevel: 0, round: true, paint }));
  let high = 0;
  for (let i = 0; i < ball.n; i += 1) high = Math.max(high, ball.pos[i * 3 + 2]);
  assert.ok(Math.abs(high - 15) < 1e-6, "a dome rises to z0 + thickness");
  const full = lift.makeSink(10);
  assert.equal(lift.addPrism(full, { pts, z0: 0, thick: 5, bevel: 1, round: true, paint }), false);
  assert.equal(full.full, true, "when there is no more room, the sink says so");
});

test("the mitre of the chamfer goes inwards", () => {
  const sink = lift.makeSink(2000);
  lift.addPrism(sink, { pts: [0, 0, 100, 0, 100, 100, 0, 100], z0: 0, thick: 6, bevel: 2, round: false, paint: { rgba: [1, 2, 3, 1], grad: null } });
  let top = [];
  for (let i = 0; i < sink.n; i += 1) if (sink.pos[i * 3 + 2] === 6) top.push(sink.pos[i * 3], sink.pos[i * 3 + 1]);
  const xs = top.filter((_, i) => i % 2 === 0);                                      // (the scene is centred: x - 180)
  assert.ok(Math.abs(Math.min(...xs) - (-180 + 2)) < 1e-6 && Math.abs(Math.max(...xs) - (-180 + 98)) < 1e-6, "the top is smaller than the base by the chamfer on every side");
});

function inventedInput(seed) {
  const rng = PulseGames.mulberry32(seed);
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "a", "d", "w", "Enter"];
  return (frame, input) => {
    if (frame % 7 === 0) { input.x = rng() * 360; input.y = rng() * 640; }
    if (frame % 23 === 0) { input.pressed = true; input.down = true; input.x = rng() * 360; input.y = rng() * 640; }
    if (frame % 23 === 6) { input.down = false; input.released = true; input.tap = rng() < 0.7; if (!input.tap) input.swipe = ["left", "right", "up", "down"][Math.floor(rng() * 4)]; }
    if (frame % 31 === 0) { const key = keys[Math.floor(rng() * keys.length)]; input.keys.add(key); input._keysPressed.add(key); }
    if (frame % 31 === 9) input.keys.clear();
  };
}

const sinks = { prisms: lift.makeSink(lift.CAP_PRISMS), decals: lift.makeSink(lift.CAP_DECALS) };
for (const entry of PulseGames.list()) {
  const def = PulseGames.get(entry.id);
  if (def.lift === false) continue;
  test(`${entry.id}: drawn through the recorder, turned into solids, with finite numbers and room to spare`, () => {
    const rec = lift.makeRecorder();
    const events = { over: 0 };
    const env = PulseGames.createEnv(rec, { onOver() { events.over += 1; }, onScore() {} }, 5);
    const game = def.create(env);
    const script = inventedInput(11);
    let frames = 0, spent = 0, worst = 0, most = 0, prismsMax = 0, quadsMax = 0;
    for (let frame = 0; frame < 900; frame += 1) {
      script(frame, env.input);
      if (!env.finished) game.update?.(1 / 60);
      env.input.endTick();
      if (frame % 15 !== 0) continue;
      const t0 = performance.now();
      rec.begin();
      if (!def.bubble && def.backdrop !== false) PulseGames.backdrop(rec, def, frame / 60);
      game.draw?.();
      const items = rec.items();
      const plan = lift.layout(items);
      const out = lift.build(plan, sinks);
      const took = performance.now() - t0;
      spent += took; frames += 1; worst = Math.max(worst, took);
      most = Math.max(most, items.length); prismsMax = Math.max(prismsMax, plan.prisms.length); quadsMax = Math.max(quadsMax, plan.quads.length);
      assert.equal(out.prisms.n % 3, 0, "whole triangles");
      assert.equal(out.decals.n % 3, 0);
      assert.ok(!out.prisms.full && !out.decals.full, `the room of the solids was enough at frame ${frame} (${plan.prisms.length} solids, ${plan.decals.length} decals)`);
      for (const sink of [out.prisms, out.decals]) {
        for (let i = 0; i < sink.n * 3; i += 1) { if (!Number.isFinite(sink.pos[i]) || !Number.isFinite(sink.nor[i])) assert.fail(`not a number at ${i}`); }
      }
      for (const q of plan.quads) assert.ok(Number.isFinite(q.z));
    }
    assert.ok(most > 0, "something is drawn");
    assert.ok(spent / frames < 25, `a frame of the lift takes ${(spent / frames).toFixed(1)} ms on average (${most} shapes at most)`);
    void worst; void prismsMax; void quadsMax;
  });
}
