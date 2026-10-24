/* Nex GIF core: makes a GIF file out of pictures, in plain functions that need no screen (so Node can test them). The page draws the
   frames (photos, text) on a canvas and hands their pixels over; this file picks the colours (one shared palette of up to 256, by
   median cut), turns every pixel into a colour number (optionally spreading the rounding error to its neighbours, which makes photos
   look smooth), squeezes the numbers with the LZW method GIF uses, and writes the file: header, looping note, one block per frame. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.YipiGifCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_BYTES = 3 * 1024 * 1024;                    // what the server takes for a GIF of the library (yipi.py: MAX_GIF_BYTES)
  const MAX_FRAMES = 200;
  const MAX_TITLE = 40;

  // -------------------------------------------------------------------------------------------------- palette
  /* The colours of all frames together: `frames` are RGBA pixel arrays; the answer is a flat [r, g, b, r, g, b, ...] of 2, 4, 8, ...
     256 colours (a power of two, as the GIF format wants it). */
  function buildPalette(frames, maxColors = 128) {
    const limit = Math.max(2, Math.min(256, maxColors | 0));
    let total = 0;
    for (const frame of frames) total += frame.length >> 2;
    const step = Math.max(1, Math.floor(total / 40000));
    const samples = [];
    let seen = 0;
    for (const frame of frames) {
      for (let i = 0; i < frame.length; i += 4, seen += 1) {
        if (seen % step === 0) samples.push((frame[i] << 16) | (frame[i + 1] << 8) | frame[i + 2]);
      }
    }
    if (!samples.length) samples.push(0);
    const channel = (value, which) => (value >> (16 - 8 * which)) & 255;
    const describe = (box) => {
      const low = [255, 255, 255];
      const high = [0, 0, 0];
      for (const value of box) {
        for (let c = 0; c < 3; c += 1) {
          const part = channel(value, c);
          if (part < low[c]) low[c] = part;
          if (part > high[c]) high[c] = part;
        }
      }
      const ranges = [high[0] - low[0], high[1] - low[1], high[2] - low[2]];
      const widest = ranges.indexOf(Math.max(...ranges));
      return { box, widest, range: ranges[widest] };
    };
    let boxes = [describe(samples)];
    while (boxes.length < limit) {
      let pick = -1;
      let best = 0;
      boxes.forEach((entry, index) => {
        const score = entry.range * Math.sqrt(entry.box.length);
        if (entry.box.length > 1 && entry.range > 0 && score > best) { best = score; pick = index; }
      });
      if (pick < 0) break;
      const { box, widest } = boxes[pick];
      box.sort((a, b) => channel(a, widest) - channel(b, widest));
      // cut near the middle, but only where the value changes, so equal colours are never torn apart (that would waste a box)
      const middle = box.length >> 1;
      let cut = middle;
      for (let d = 0; d < box.length; d += 1) {
        const low = middle - d;
        const high = middle + d;
        if (low > 0 && channel(box[low - 1], widest) !== channel(box[low], widest)) { cut = low; break; }
        if (high > 0 && high < box.length && channel(box[high - 1], widest) !== channel(box[high], widest)) { cut = high; break; }
      }
      boxes.splice(pick, 1, describe(box.slice(0, cut)), describe(box.slice(cut)));
    }
    const colours = boxes.map(({ box }) => {
      let r = 0, g = 0, b = 0;
      for (const value of box) { r += channel(value, 0); g += channel(value, 1); b += channel(value, 2); }
      const n = box.length;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
    let size = 2;
    while (size < colours.length) size *= 2;
    while (colours.length < size) colours.push([0, 0, 0]);
    return Uint8Array.from(colours.flat());
  }

  /* A table with the closest palette colour for every colour in 5 bits per channel, so a pixel is mapped by a single lookup. */
  function buildLookup(palette) {
    const table = new Uint8Array(32768);
    const count = palette.length / 3;
    for (let cell = 0; cell < 32768; cell += 1) {
      const r = ((cell >> 10) << 3) + 4;
      const g = (((cell >> 5) & 31) << 3) + 4;
      const b = ((cell & 31) << 3) + 4;
      let best = 0;
      let bestDistance = Infinity;
      for (let k = 0; k < count; k += 1) {
        const dr = palette[k * 3] - r, dg = palette[k * 3 + 1] - g, db = palette[k * 3 + 2] - b;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) { bestDistance = distance; best = k; }
      }
      table[cell] = best;
    }
    return table;
  }

  /* The colour numbers of one frame. With `dither` the rounding error of every pixel is passed on to the pixels right of it and below
     it (Floyd and Steinberg). */
  function indexFrame(pixels, width, height, palette, lookup, dither) {
    const out = new Uint8Array(width * height);
    if (!dither) {
      for (let i = 0, o = 0; o < out.length; i += 4, o += 1) out[o] = lookup[((pixels[i] >> 3) << 10) | ((pixels[i + 1] >> 3) << 5) | (pixels[i + 2] >> 3)];
      return out;
    }
    const buffer = new Float32Array(width * height * 3);
    for (let i = 0, o = 0; o < out.length; i += 4, o += 1) { buffer[o * 3] = pixels[i]; buffer[o * 3 + 1] = pixels[i + 1]; buffer[o * 3 + 2] = pixels[i + 2]; }
    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    const spread = (x, y, er, eg, eb, weight) => {
      if (x < 0 || x >= width || y >= height) return;
      const at = (y * width + x) * 3;
      buffer[at] += er * weight; buffer[at + 1] += eg * weight; buffer[at + 2] += eb * weight;
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = y * width + x;
        const r = clamp(buffer[at * 3]), g = clamp(buffer[at * 3 + 1]), b = clamp(buffer[at * 3 + 2]);
        const k = lookup[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
        out[at] = k;
        const er = r - palette[k * 3], eg = g - palette[k * 3 + 1], eb = b - palette[k * 3 + 2];
        spread(x + 1, y, er, eg, eb, 7 / 16);
        spread(x - 1, y + 1, er, eg, eb, 3 / 16);
        spread(x, y + 1, er, eg, eb, 5 / 16);
        spread(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------------------ LZW
  /* The pixels squeezed the way GIF does it (the code width grows from minCode + 1 up to 12 bits, a "clear" starts the table anew when
     it is full). Answers the bytes without the block lengths. */
  function lzw(indices, minCode) {
    const clear = 1 << minCode;
    const end = clear + 1;
    const bytes = [];
    let nextCode = end + 1;
    let size = minCode + 1;
    let shift = 0;
    let current = 0;
    let table = new Map();
    const put = (code) => {
      current |= code << shift;
      shift += size;
      while (shift >= 8) { bytes.push(current & 255); current >>>= 8; shift -= 8; }
    };
    put(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i += 1) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = table.get(key);
      if (found !== undefined) { prefix = found; continue; }
      put(prefix);
      if (nextCode === 4096) {
        put(clear);
        nextCode = end + 1;
        size = minCode + 1;
        table = new Map();
      } else {
        if (nextCode >= (1 << size)) size += 1;
        table.set(key, nextCode);
        nextCode += 1;
      }
      prefix = k;
    }
    put(prefix);
    put(end);
    if (shift > 0) bytes.push(current & 255);
    return bytes;
  }

  // ---------------------------------------------------------------------------------------------------- file
  const word = (value) => [value & 255, (value >> 8) & 255];

  /* The GIF file for these frames. `frames`: RGBA pixel arrays, all `width` x `height`. Options: `delay` (milliseconds per frame, or a
     list with one per frame), `colors` (palette size, default 128), `dither`, `loop` (0 = forever). Answers a Uint8Array. */
  function encode(frames, width, height, options = {}) {
    if (!frames.length || frames.length > MAX_FRAMES) throw new Error("frames");
    if (!(width > 0 && height > 0 && width < 65536 && height < 65536)) throw new Error("size");
    const palette = buildPalette(frames, options.colors || 128);
    const bits = Math.max(1, Math.log2(palette.length / 3));
    const minCode = Math.max(2, bits);
    const lookup = buildLookup(palette);
    const out = [];
    const push = (list) => { for (let i = 0; i < list.length; i += 1) out.push(list[i]); };
    push([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);                                        // GIF89a
    push([...word(width), ...word(height), 0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0]);
    push(palette);
    push([0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (ch) => ch.charCodeAt(0)), 0x03, 0x01, ...word(options.loop || 0), 0x00]);
    frames.forEach((pixels, number) => {
      const wanted = Array.isArray(options.delay) ? options.delay[number] : options.delay;
      const delay = Math.max(2, Math.round((wanted || 100) / 10));
      push([0x21, 0xf9, 0x04, 0x04, ...word(delay), 0x00, 0x00]);                         // timing of this frame, left in place afterwards
      push([0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0x00]);
      const data = lzw(indexFrame(pixels, width, height, palette, lookup, !!options.dither), minCode);
      out.push(minCode);
      for (let at = 0; at < data.length; at += 255) {
        const chunk = data.slice(at, at + 255);
        out.push(chunk.length);
        push(chunk);
      }
      out.push(0x00);
    });
    out.push(0x3b);
    return Uint8Array.from(out);
  }

  /* Reads the structure of a GIF the way the server does: {width, height, frames} or null when it is broken. */
  function inspect(bytes) {
    try {
      const head = String.fromCharCode(...bytes.slice(0, 6));
      if (head !== "GIF87a" && head !== "GIF89a") return null;
      const width = bytes[6] | (bytes[7] << 8);
      const height = bytes[8] | (bytes[9] << 8);
      let at = 13;
      if (bytes[10] & 0x80) at += 3 * (2 << (bytes[10] & 7));
      let frames = 0;
      while (at < bytes.length) {
        const marker = bytes[at];
        if (marker === 0x3b) return frames ? { width, height, frames } : null;
        if (marker === 0x21) at += 2;
        else if (marker === 0x2c) {
          frames += 1;
          const local = bytes[at + 9];
          at += 10;
          if (local & 0x80) at += 3 * (2 << (local & 7));
          at += 1;
        } else return null;
        for (;;) {
          if (at >= bytes.length) return null;
          const length = bytes[at];
          at += 1 + length;
          if (!length) break;
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  // ------------------------------------------------------------------------------------------- the pictures
  /* A frame order that goes forward and then back again (1 2 3 4 3 2), for a GIF that does not jump at the end of the loop. */
  function pingPong(count) {
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = count - 2; i >= 1; i -= 1) order.push(i);
    return order;
  }

  /* The size of the picture for a GIF: as wide as `maxWidth` allows, never larger than the source, both sides at least 16, and
     all of it within `maxPixels` (what the server takes). */
  function frameSize(width, height, maxWidth = 360, maxPixels = 2000000) {
    const scale = Math.min(1, maxWidth / width, Math.sqrt(maxPixels / (width * height)));
    return { width: Math.max(16, Math.round(width * scale)), height: Math.max(16, Math.round(height * scale)) };
  }

  /* The name a GIF is found by: tidy, one line, at most 40 characters. */
  function cleanTitle(text) {
    return Array.from(String(text == null ? "" : text).normalize("NFC").replace(/\s+/g, " ").trim()).slice(0, MAX_TITLE).join("");
  }

  return { MAX_BYTES, MAX_FRAMES, MAX_TITLE, buildPalette, buildLookup, indexFrame, lzw, encode, inspect, pingPong, frameSize, cleanTitle };
});
