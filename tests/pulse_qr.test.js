// The QR codes (static/js/yipi-qr.js) without a browser: the library that makes the code and the one that reads it (both vendored) agree on the addresses of Nex, and the picture
// drawing leaves the three corners and the middle alone and puts a soft square on every other dark module. (The finished picture was read back with jsQR in a real browser.)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const js = path.join(__dirname, "..", "static", "js");
vm.runInThisContext(fs.readFileSync(path.join(js, "vendor", "qrcode.js"), "utf-8"));          // defines the global `qrcode`
const jsQR = require(path.join(js, "vendor", "jsqr.js"));

const calls = { roundRect: 0, arc: 0, fill: 0 };
const context = new Proxy({}, {
  get(target, name) {
    if (name === "createLinearGradient") return () => ({ addColorStop() {} });
    if (name === "roundRect") return () => { calls.roundRect += 1; };
    if (name === "arc") return () => { calls.arc += 1; };
    if (name === "fill") return () => { calls.fill += 1; };
    return name in target ? target[name] : () => {};
  },
  set(target, name, value) { target[name] = value; return true; },
});
global.window = global;
global.document = {
  getElementById: () => ({ textContent: JSON.stringify({ qr: "/static/js/vendor/qrcode.js", jsqr: "/static/js/vendor/jsqr.js" }) }),
  createElement: (tag) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => context } : { set src(value) { this._src = value; setTimeout(() => this.onload && this.onload(), 0); }, remove() {} }),
  head: { append() {} },
};
global.Yipi = { h: () => ({}), fill() {}, icon: () => ({}), toast() {}, dialog() {}, copyLink() {} };
require(path.join(js, "yipi-qr.js"));
const Y = global.Yipi;

const ADDRESSES = ["https://nexai.up.railway.app/", "https://nexai.up.railway.app/mia_chat", "https://nexai.up.railway.app/mia_chat/status/1234567890", "https://nexai.up.railway.app/camera/lu-1a2b3c4d",
  "https://nexai.up.railway.app/camera/l-sturmhaube", "http://localhost:5000/camera/rank-footballers"];

for (const address of ADDRESSES) {
  test(`the code of ${address} is read back as the same address`, async () => {
    const m = await Y.qr.matrix(address);
    const quiet = 4, cell = 8, size = (m.count + quiet * 2) * cell;
    const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let row = 0; row < m.count; row += 1) {
      for (let col = 0; col < m.count; col += 1) {
        if (!m.dark(row, col)) continue;
        for (let y = 0; y < cell; y += 1) for (let x = 0; x < cell; x += 1) { const at = (((row + quiet) * cell + y) * size + (col + quiet) * cell + x) * 4; rgba[at] = rgba[at + 1] = rgba[at + 2] = 0; }
      }
    }
    const found = jsQR(rgba, size, size);
    assert.ok(found && found.data === address, `${address} was read as ${found && found.data}`);
  });
}

test("the picture has the three finder squares, the logo, and a soft square for the other dark modules", async () => {
  calls.roundRect = calls.arc = calls.fill = 0;
  const address = ADDRESSES[2];
  const m = await Y.qr.matrix(address);
  await Y.qr.make(address, { size: 720 });
  let dark = 0;
  const half = Math.ceil(m.count * 0.115) + 1;
  for (let row = 0; row < m.count; row += 1) {
    for (let col = 0; col < m.count; col += 1) {
      const finder = (row < 8 && col < 8) || (row < 8 && col >= m.count - 8) || (row >= m.count - 8 && col < 8);
      const logo = Math.abs(row + 0.5 - m.count / 2) < half && Math.abs(col + 0.5 - m.count / 2) < half;
      if (m.dark(row, col) && !finder && !logo) dark += 1;
    }
  }
  assert.ok(dark > 100);
  // the card (1) + a soft square per module + 3 x 3 for the finders + the white plate and the black tile of the logo (2)
  assert.equal(calls.roundRect, 1 + dark + 9 + 2);
  assert.equal(calls.arc, 0, "no round dots: some readers cannot read them");
});

test("the error correction is the highest, so that the logo in the middle may cover some of the code", async () => {
  const m = await Y.qr.matrix(ADDRESSES[2]);
  const middle = Math.floor(m.count / 2);
  const hole = Math.ceil(m.count * 0.115) + 1;
  assert.ok(hole * hole * 4 < m.count * m.count * 0.16, "the logo covers less than the 30 percent the level H can lose");
  assert.ok(middle > hole + 8);
});
