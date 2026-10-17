// Tests for static/js/yipi-gif-core.js: the palette, the colour numbers, the LZW squeezing and the GIF file. A GIF written by the encoder is read
// back here with a decoder of its own (written from the format description, not from the encoder), so a mistake on one side cannot hide on the other.
// Run with: node --test tests/yipi_gif_core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const gif = require("../static/js/yipi-gif-core.js");

// ------------------------------------------------------------------------------- an independent decoder
function lzwDecode(data, minCode, expected) {
  const clear = 1 << minCode;
  const end = clear + 1;
  let size = minCode + 1;
  let table = [];
  const reset = () => { table = []; for (let i = 0; i < clear; i += 1) table.push([i]); table.push(null, null); size = minCode + 1; };
  reset();
  const out = [];
  let bits = 0, buffer = 0, at = 0, previous = null;
  while (out.length < expected) {
    while (bits < size && at < data.length) { buffer |= data[at] << bits; at += 1; bits += 8; }
    if (bits < size) break;
    const code = buffer & ((1 << size) - 1);
    buffer >>>= size;
    bits -= size;
    if (code === clear) { reset(); previous = null; continue; }
    if (code === end) break;
    let entry;
    if (code < table.length) entry = table[code];
    else if (code === table.length && previous) entry = [...previous, previous[0]];
    else throw new Error(`bad code ${code}`);
    out.push(...entry);
    if (previous && table.length < 4096) table.push([...previous, entry[0]]);
    previous = entry;
    if (table.length === (1 << size) && size < 12) size += 1;
  }
  return out;
}

/* Reads a whole GIF: {width, height, palette: [[r,g,b]...], frames: [{pixels: [index...], delay}], loop} */
function decode(bytes) {
  const width = bytes[6] | (bytes[7] << 8), height = bytes[8] | (bytes[9] << 8), flags = bytes[10];
  let at = 13;
  const palette = [];
  if (flags & 0x80) {
    const count = 2 << (flags & 7);
    for (let i = 0; i < count; i += 1) palette.push([bytes[at + i * 3], bytes[at + i * 3 + 1], bytes[at + i * 3 + 2]]);
    at += count * 3;
  }
  const frames = [];
  let delay = 0, loop = null;
  while (bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      const label = bytes[at + 1];
      at += 2;
      const blocks = [];
      while (bytes[at]) { blocks.push(bytes.slice(at + 1, at + 1 + bytes[at])); at += 1 + bytes[at]; }
      at += 1;
      if (label === 0xf9) delay = (blocks[0][1] | (blocks[0][2] << 8)) * 10;
      if (label === 0xff && String.fromCharCode(...blocks[0]) === "NETSCAPE2.0") loop = blocks[1][1] | (blocks[1][2] << 8);
    } else if (bytes[at] === 0x2c) {
      const w = bytes[at + 5] | (bytes[at + 6] << 8), h = bytes[at + 7] | (bytes[at + 8] << 8);
      assert.deepEqual([w, h], [width, height]);
      at += 10;
      const minCode = bytes[at];
      at += 1;
      const packed = [];
      while (bytes[at]) { packed.push(...bytes.slice(at + 1, at + 1 + bytes[at])); at += 1 + bytes[at]; }
      at += 1;
      frames.push({ pixels: lzwDecode(packed, minCode, width * height), delay });
    } else throw new Error(`unknown block ${bytes[at]}`);
  }
  return { width, height, palette, frames, loop };
}

const frameOf = (width, height, pixel) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set([...pixel(x, y), 255], (y * width + x) * 4);
  return data;
};
const colourAt = (decoded, frame, x, y) => decoded.palette[decoded.frames[frame].pixels[y * decoded.width + x]];
const near = (a, b, tolerance = 12) => a.every((value, i) => Math.abs(value - b[i]) <= tolerance);

// ------------------------------------------------------------------------------------------------ LZW
test("the squeezed pixels come back exactly, whatever they are", () => {
  const cases = [
    [0], [1, 1, 1, 1, 1, 1, 1, 1], [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3],
    Array.from({ length: 3000 }, (_, i) => (i * 7 + (i >> 3)) % 4), Array.from({ length: 9000 }, (_, i) => ((i * 2654435761) >>> 28) & 3),
    Array.from({ length: 500 }, () => 2),
  ];
  for (const pixels of cases) {
    const bytes = gif.lzw(Uint8Array.from(pixels), 2);
    assert.deepEqual(lzwDecode(bytes, 2, pixels.length), pixels, `${pixels.length} pixels`);
  }
});

test("a long run of different pictures fills the code table, starts it anew, and still comes back exactly", () => {
  let seed = 12345;
  const noise = Array.from({ length: 60000 }, () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 16) & 255; });
  const bytes = gif.lzw(Uint8Array.from(noise), 8);
  assert.deepEqual(lzwDecode(bytes, 8, noise.length), noise);
  const flat = new Array(100000).fill(5);
  const small = gif.lzw(Uint8Array.from(flat), 3);
  assert.ok(small.length < 1500, "a flat picture squeezes to almost nothing");
  assert.deepEqual(lzwDecode(small, 3, flat.length), flat);
});

// ---------------------------------------------------------------------------------------------- palette
test("the palette has a power of two of colours and finds the colours that are there", () => {
  const red = frameOf(4, 4, () => [255, 0, 0]);
  const blue = frameOf(4, 4, () => [0, 0, 255]);
  const palette = gif.buildPalette([red, blue], 16);
  assert.equal(palette.length % 3, 0);
  const count = palette.length / 3;
  assert.ok(count >= 2 && (count & (count - 1)) === 0 && count <= 16, String(count));
  const colours = Array.from({ length: count }, (_, i) => [palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]]);
  assert.ok(colours.some((c) => near(c, [255, 0, 0], 2)) && colours.some((c) => near(c, [0, 0, 255], 2)));
  assert.equal(gif.buildPalette([red], 1).length, 6, "never fewer than two colours");
  assert.equal(gif.buildPalette([frameOf(32, 32, (x, y) => [x * 8, y * 8, (x + y) * 4])], 999).length / 3, 256, "never more than 256");
  assert.equal(gif.buildPalette([new Uint8ClampedArray(0)], 8).length, 6);
});

test("every colour is mapped to the closest one of the palette", () => {
  const palette = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 255]);
  const lookup = gif.buildLookup(palette);
  const at = (r, g, b) => lookup[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
  assert.deepEqual([at(10, 10, 10), at(250, 250, 250), at(240, 20, 10), at(10, 20, 230)], [0, 1, 2, 3]);
  const pixels = frameOf(2, 1, (x) => (x ? [250, 5, 5] : [5, 5, 250]));
  assert.deepEqual([...gif.indexFrame(pixels, 2, 1, palette, lookup, false)], [3, 2]);
  assert.deepEqual([...gif.indexFrame(pixels, 2, 1, palette, lookup, true)].length, 2);
});

test("spreading the rounding error makes a smooth ramp out of few colours", () => {
  const palette = Uint8Array.from([0, 0, 0, 255, 255, 255]);
  const lookup = gif.buildLookup(palette);
  const width = 64;
  const ramp = frameOf(width, 8, (x) => [x * 4, x * 4, x * 4]);
  const plain = [...gif.indexFrame(ramp, width, 8, palette, lookup, false)];
  const dithered = [...gif.indexFrame(ramp, width, 8, palette, lookup, true)];
  const share = (list, from, to) => list.filter((_, i) => i % width >= from && i % width < to).reduce((a, b) => a + b, 0) / (8 * (to - from));
  assert.ok(share(plain, 0, 16) === 0 && share(plain, 48, 64) === 1, "without it: only black and white, with a hard edge");
  assert.ok(share(dithered, 16, 48) > 0.2 && share(dithered, 16, 48) < 0.8, "with it: the middle is a mixture");
  assert.ok(share(dithered, 0, 16) < share(dithered, 24, 40) && share(dithered, 24, 40) < share(dithered, 48, 64), "and it gets lighter from left to right");
});

// ------------------------------------------------------------------------------------------------- file
test("a GIF that is written can be read back: size, frames, timing, loop and colours", () => {
  const width = 24, height = 16;
  const frames = [
    frameOf(width, height, (x) => (x < 12 ? [250, 20, 20] : [20, 20, 250])),
    frameOf(width, height, (x, y) => (y < 8 ? [20, 200, 20] : [240, 240, 20])),
    frameOf(width, height, () => [30, 30, 30]),
  ];
  const bytes = gif.encode(frames, width, height, { delay: [100, 250, 70], colors: 8 });
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), "GIF89a");
  assert.equal(bytes[bytes.length - 1], 0x3b);
  assert.deepEqual(gif.inspect(bytes), { width, height, frames: 3 });
  const decoded = decode(bytes);
  assert.deepEqual([decoded.width, decoded.height, decoded.frames.length, decoded.loop], [width, height, 3, 0]);
  assert.deepEqual(decoded.frames.map((f) => f.delay), [100, 250, 70]);
  assert.ok(near(colourAt(decoded, 0, 2, 2), [250, 20, 20]) && near(colourAt(decoded, 0, 20, 2), [20, 20, 250]));
  assert.ok(near(colourAt(decoded, 1, 5, 2), [20, 200, 20]) && near(colourAt(decoded, 1, 5, 12), [240, 240, 20]));
  assert.ok(near(colourAt(decoded, 2, 7, 7), [30, 30, 30]));
});

test("a photograph-like picture survives with and without smoothing", () => {
  const width = 80, height = 60;
  const picture = (shift) => frameOf(width, height, (x, y) => [(x * 3 + shift) % 256, (y * 4) % 256, ((x + y) * 2) % 256]);
  for (const dither of [false, true]) {
    const frames = [picture(0), picture(90)];
    const bytes = gif.encode(frames, width, height, { delay: 120, colors: 128, dither });
    const decoded = decode(bytes);
    assert.equal(decoded.frames.length, 2);
    let worst = 0, total = 0;
    for (let f = 0; f < 2; f += 1) {
      for (let i = 0; i < width * height; i += 1) {
        const colour = decoded.palette[decoded.frames[f].pixels[i]];
        const real = [frames[f][i * 4], frames[f][i * 4 + 1], frames[f][i * 4 + 2]];
        const distance = Math.max(...colour.map((value, k) => Math.abs(value - real[k])));
        worst = Math.max(worst, distance);
        total += distance;
      }
    }
    assert.ok(total / (2 * width * height) < (dither ? 25 : 14), `average error with dither=${dither}: ${total / (2 * width * height)}`);
    if (!dither) assert.ok(worst < 110, `worst error ${worst}`);      // (smoothing trades a larger error of single pixels for a better look of the whole)
  }
});

test("the file has the shape the server expects and is a sensible size", () => {
  const frames = Array.from({ length: 10 }, (_, k) => frameOf(120, 90, (x, y) => [(x + k * 10) % 256, y * 2, 128]));
  const bytes = gif.encode(frames, 120, 90, { delay: 200, colors: 64, dither: true });
  assert.ok(bytes.length < 120 * 90 * 10, "smaller than the raw pixels");
  assert.ok(bytes.length < gif.MAX_BYTES);
  assert.equal(gif.inspect(bytes).frames, 10);
  assert.equal(gif.MAX_BYTES, 3 * 1024 * 1024);
  assert.equal(gif.MAX_FRAMES, 200);
  assert.equal(gif.inspect(Uint8Array.from([1, 2, 3])), null);
  assert.equal(gif.inspect(bytes.slice(0, bytes.length - 1)), null, "cut off");
  assert.equal(gif.inspect(bytes.slice(0, 40)), null);
  const small = gif.encode([frameOf(2, 2, () => [0, 0, 0])], 2, 2, {});
  assert.deepEqual(gif.inspect(small), { width: 2, height: 2, frames: 1 });
  assert.equal(decode(small).frames[0].delay, 100, "the default is a tenth of a second per frame");
});

test("what cannot be a GIF is refused before anything is written", () => {
  assert.throws(() => gif.encode([], 4, 4), /frames/);
  assert.throws(() => gif.encode(Array.from({ length: 201 }, () => frameOf(1, 1, () => [0, 0, 0])), 1, 1), /frames/);
  assert.throws(() => gif.encode([frameOf(1, 1, () => [0, 0, 0])], 0, 1), /size/);
  assert.throws(() => gif.encode([frameOf(1, 1, () => [0, 0, 0])], 70000, 1), /size/);
});

// -------------------------------------------------------------------------------------------- the pictures
test("a back-and-forth order does not jump at the end", () => {
  assert.deepEqual(gif.pingPong(4), [0, 1, 2, 3, 2, 1]);
  assert.deepEqual(gif.pingPong(2), [0, 1]);
  assert.deepEqual(gif.pingPong(3), [0, 1, 2, 1]);
  assert.deepEqual(gif.pingPong(1), [0]);
});

test("the size of the pictures respects the width and the number of pixels the server takes", () => {
  assert.deepEqual(gif.frameSize(1000, 500, 360), { width: 360, height: 180 });
  assert.deepEqual(gif.frameSize(200, 100, 360), { width: 200, height: 100 }, "never larger than the photo");
  assert.deepEqual(gif.frameSize(100, 4000, 360), { width: 100, height: 4000 });
  const huge = gif.frameSize(100000, 100000, 100000, 2000000);
  assert.ok(huge.width * huge.height <= 2000000 + huge.width + huge.height, "within two million pixels");
  const tiny = gif.frameSize(1, 1, 360);
  assert.deepEqual(tiny, { width: 16, height: 16 }, "both sides at least 16");
});

test("the name of a GIF is tidy and at most 40 characters", () => {
  assert.equal(gif.cleanTitle("  Hallo \n  Welt "), "Hallo Welt");
  assert.equal(gif.cleanTitle("x".repeat(80)).length, 40);
  assert.equal(gif.cleanTitle(null), "");
  assert.equal(Array.from(gif.cleanTitle("😀".repeat(50))).length, 40, "characters, not code units");
  assert.equal(gif.MAX_TITLE, 40);
});
