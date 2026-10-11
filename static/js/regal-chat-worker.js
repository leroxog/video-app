/* Nex Ai chat worker: loads one AI model and lets it write answers, inside the visitor's browser (on their graphics card, or else
   on their processor).  It runs in its own thread so that the page stays smooth.  The program that runs the model is Transformers.js
   with ONNX Runtime Web (static/vendor/transformers, from this server, never from a CDN).  The only thing this worker fetches from
   outside is the model itself, from Hugging Face; what people write goes to the model on their own computer and nowhere else.

   Messages from the page: {type: "load", id, device, dtype} | {type: "generate", messages, maxNewTokens, settings?} | {type: "stop"} | {type: "unload"}
   Messages to the page:   {type: "progress", files} | {type: "ready"} | {type: "token", text} | {type: "done", tokens, seconds, stopped} | {type: "error", stage, message} */
import { env, pipeline, TextStreamer, InterruptableStoppingCriteria } from "../vendor/transformers/transformers.min.js";

const BASE = new URL("../vendor/transformers/", import.meta.url).href;

/* The browser's cache for the files of the model, in pieces.  A browser refuses to put a big file into its Cache Storage in one piece (the
   limit is a fraction of the free space, often only about 250 MB, and the model has files of 300 to 800 MB), so the model would be loaded
   again at every visit.  This cache keeps each file as parts of 48 MB (`?nex-part=0`, `?nex-part=1` ...) and, written last, a note
   (`?nex-meta`) with the number of parts and the size: a file is only there when the note is.  The page looks for the same note
   (chunkMetaUrl in regal-chat-core.js) to know whether a model is in the browser. */
const PART = 48 * 1024 * 1024;

class PartsCache {
  constructor(name) { this.name = name; this.opened = null; }
  cache() { return (this.opened ||= caches.open(this.name)); }

  async match(key) {
    const cache = await this.cache();
    const whole = await cache.match(key);
    if (whole) return whole;
    const note = await cache.match(`${key}?nex-meta`);
    if (!note) return undefined;
    let meta = null;
    try { meta = await note.json(); } catch (error) { return undefined; }
    if (!meta || !(meta.parts >= 1) || !(meta.size >= 0)) return undefined;
    const parts = [];
    for (let i = 0; i < meta.parts; i++) {
      const part = await cache.match(`${key}?nex-part=${i}`);
      if (!part) return undefined;                  // a part is missing (the browser threw it away): then the file is not there
      parts.push(part);
    }
    let next = 0, reader = null;
    const body = new ReadableStream({
      async pull(controller) {
        for (;;) {
          if (!reader) {
            if (next >= parts.length) { controller.close(); return; }
            reader = parts[next++].body.getReader();
          }
          const { done, value } = await reader.read();
          if (done) { reader = null; continue; }
          controller.enqueue(value);
          return;
        }
      },
      cancel() { return reader ? reader.cancel() : undefined; },
    });
    return new Response(body, { headers: { "content-length": String(meta.size), "content-type": meta.type || "application/octet-stream" } });
  }

  async put(key, response, progress) {
    const cache = await this.cache();
    const type = response.headers.get("content-type") || "application/octet-stream";
    const total = Number(response.headers.get("content-length")) || 0;
    const written = [];
    let parts = 0, size = 0, filled = 0;
    const buffer = new Uint8Array(PART);
    const flush = async (length) => {
      const name = `${key}?nex-part=${parts}`;
      await cache.put(name, new Response(buffer.subarray(0, length)));
      written.push(name);
      parts++;
      filled = 0;
    };
    try {
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (let offset = 0; offset < value.length;) {
            const count = Math.min(PART - filled, value.length - offset);
            buffer.set(value.subarray(offset, offset + count), filled);
            filled += count;
            offset += count;
            size += count;
            if (filled === PART) await flush(PART);
          }
          if (progress) progress({ progress: total ? (size / total) * 100 : 0, loaded: size, total });
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        for (let offset = 0; offset < bytes.length; offset += PART) {
          const piece = bytes.subarray(offset, offset + PART);
          buffer.set(piece, 0);
          filled = piece.length;
          size += piece.length;
          if (filled === PART) await flush(PART);
        }
      }
      if (filled > 0 || parts === 0) await flush(filled);
      await cache.put(`${key}?nex-meta`, new Response(JSON.stringify({ parts, size, type }), { headers: { "content-type": "application/json" } }));
    } catch (error) {
      for (const name of written) { try { await cache.delete(name); } catch (ignored) { /* it is gone anyway */ } }
      throw error;
    }
  }

  async delete(key) {
    const cache = await this.cache();
    let found = await cache.delete(key);
    const note = await cache.match(`${key}?nex-meta`);
    if (note) {
      try { const meta = await note.json(); for (let i = 0; i < meta.parts; i++) await cache.delete(`${key}?nex-part=${i}`); } catch (error) { /* a damaged note */ }
      found = (await cache.delete(`${key}?nex-meta`)) || found;
    }
    return found;
  }
}

env.allowLocalModels = false;                     // only Hugging Face, never files of this server
env.allowRemoteModels = true;
env.useBrowserCache = false;                      // not the plain Cache Storage: its limit for one file is too small (see PartsCache)
env.useCustomCache = true;                        // a model that was loaded once stays in the browser
env.customCache = new PartsCache("transformers-cache");
env.useWasmCache = false;                         // the runtime comes from this server and the browser's own cache keeps it
env.backends.onnx.wasm.wasmPaths = { mjs: `${BASE}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${BASE}ort-wasm-simd-threaded.asyncify.wasm` };
env.backends.onnx.wasm.proxy = false;

let generator = null;
let stopper = null;
let working = false;

const post = (message) => self.postMessage(message);

async function unload() {
  if (!generator) return;
  const old = generator;
  generator = null;
  try { await old.dispose?.(); } catch (error) { /* it is gone anyway */ }
}

async function load({ id, device, dtype }) {
  await unload();
  if (device === "webgpu") {                         // the page found a graphics card, but a worker may not be allowed to use it (some browsers): say so clearly
    let adapter = null;
    try { adapter = self.navigator && navigator.gpu ? await navigator.gpu.requestAdapter() : null; } catch (error) { adapter = null; }
    if (!adapter) throw new Error("WebGPU is not available in the worker: no graphics card adapter");
  }
  let last = 0;
  generator = await pipeline("text-generation", id, {
    device,
    dtype,
    progress_callback: (info) => {
      if (info.status !== "progress_total") return;
      const now = performance.now();
      if (now - last < 120 && info.progress < 99.9) return;       // not every chunk: the page needs no more than a few updates a second
      last = now;
      post({ type: "progress", files: info.files });
    },
  });
  // the first answer would otherwise be slow (the graphics card prepares its programs on first use), and a model that does not work
  // at all shows it now
  stopper = new InterruptableStoppingCriteria();
  await generator([{ role: "user", content: "Hi" }], { max_new_tokens: 1, do_sample: false });
  post({ type: "ready" });
}

const SETTINGS = { do_sample: true, temperature: 0.7, top_p: 0.9, repetition_penalty: 1.1 };

async function generate({ messages, maxNewTokens, settings }) {
  if (!generator) throw new Error("Es ist kein Modell geladen.");
  if (working) throw new Error("Das Modell schreibt gerade noch.");
  working = true;
  stopper = new InterruptableStoppingCriteria();
  let tokens = 0;
  const started = performance.now();
  try {
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (text) => { if (text) post({ type: "token", text }); },
      token_callback_function: () => { tokens++; },
    });
    await generator(messages, {
      max_new_tokens: Math.max(16, Math.min(Number(maxNewTokens) || 512, 2048)),
      ...SETTINGS,
      ...(settings && typeof settings === "object" ? settings : {}),
      streamer,
      stopping_criteria: stopper,
    });
    post({ type: "done", tokens, seconds: (performance.now() - started) / 1000, stopped: stopper.interrupted });
  } finally {
    working = false;
  }
}

self.addEventListener("message", async (event) => {
  const message = event.data || {};
  try {
    if (message.type === "load") await load(message);
    else if (message.type === "generate") await generate(message);
    else if (message.type === "stop") stopper?.interrupt();
    else if (message.type === "unload") await unload();
  } catch (error) {
    post({ type: "error", stage: message.type, message: String(error?.message || error) });
  }
});
