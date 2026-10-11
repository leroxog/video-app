/* KI-Regal chat worker: loads one AI model and lets it write answers, inside the visitor's browser (on their graphics card, or else
   on their processor).  It runs in its own thread so that the page stays smooth.  The program that runs the model is Transformers.js
   with ONNX Runtime Web (static/vendor/transformers, from this server, never from a CDN).  The only thing this worker fetches from
   outside is the model itself, from Hugging Face; what people write goes to the model on their own computer and nowhere else.

   Messages from the page: {type: "load", id, device, dtype} | {type: "generate", messages, maxNewTokens, settings?} | {type: "stop"} | {type: "unload"}
   Messages to the page:   {type: "progress", files} | {type: "ready"} | {type: "token", text} | {type: "done", tokens, seconds, stopped} | {type: "error", stage, message} */
import { env, pipeline, TextStreamer, InterruptableStoppingCriteria } from "../vendor/transformers/transformers.min.js";

const BASE = new URL("../vendor/transformers/", import.meta.url).href;

env.allowLocalModels = false;                     // only Hugging Face, never files of this server
env.allowRemoteModels = true;
env.useBrowserCache = true;                       // a model that was loaded once stays in the browser (Cache Storage)
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
