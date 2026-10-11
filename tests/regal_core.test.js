const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../static/js/regal-core.js");

const model = (over = {}) => ({ id: "bartowski/Llama-3.2-3B-Instruct-GGUF", k: "chat", d: 1000, l: 10, lic: "llama3.2", lib: "", c: "2026-01-02", u: "2026-02-03", task: "text-generation", fmt: ["gguf"], s: 2.0e9, lo: 1.1e9, hi: 6.4e9, p: 3.2e9,
  f: [["Llama-3.2-3B-Instruct-Q8_0.gguf", 3.4e9, 1], ["Llama-3.2-3B-Instruct-Q4_K_M.gguf", 2.0e9, 1], ["Llama-3.2-3B-Instruct-Q2_K.gguf", 1.3e9, 1], ["mmproj-F16.gguf", 5e8, 1]], ...over });

test("sizes and numbers are said the German way", () => {
  assert.equal(R.formatBytes(4.6e9), "4,6 GB");
  assert.equal(R.formatBytes(820e6), "820 MB");
  assert.equal(R.formatBytes(1.2e12), "1,2 TB");
  assert.equal(R.formatBytes(15e9), "15 GB");
  assert.equal(R.formatBytes(0), "–");
  assert.equal(R.formatCount(812), "812");
  assert.equal(R.formatCount(34500), "35 Tsd.");
  assert.equal(R.formatCount(1234567), "1,2 Mio.");
  assert.equal(R.formatCount(3.4e9), "3,4 Mrd.");
  assert.equal(R.formatParams(7.6e9), "7,6 Mrd.");
  assert.equal(R.formatParams(335e6), "335 Mio.");
  assert.equal(R.formatParams(null), "");
  assert.equal(R.formatMonth("2026-10-09"), "Okt. 2026");
  assert.equal(R.formatMonth(""), "");
});

test("a licence says whether a model may be used for money, as a hint", () => {
  assert.deepEqual(R.licenseInfo("apache-2.0"), { label: "Apache 2.0", commercial: "yes" });
  assert.equal(R.licenseInfo("mit").commercial, "yes");
  assert.equal(R.licenseInfo("llama3.1").commercial, "conditions");
  assert.equal(R.licenseInfo("creativeml-openrail-m").commercial, "conditions");
  assert.equal(R.licenseInfo("cc-by-nc-4.0").commercial, "no");
  assert.equal(R.licenseInfo("cc-by-nc-sa-4.0").commercial, "no");
  assert.equal(R.licenseInfo("research-only").commercial, "no");
  assert.equal(R.licenseInfo("other").commercial, "unknown");
  assert.equal(R.licenseInfo("").commercial, "unknown");
  assert.equal(R.licenseInfo("something-new").label, "SOMETHING-NEW");
  assert.ok(R.COMMERCIAL_TEXT.yes && R.COMMERCIAL_TEXT.no && R.COMMERCIAL_TEXT.unknown && R.COMMERCIAL_TEXT.conditions);
});

test("the address of a file is made so that it downloads, and each part of the path is made safe", () => {
  assert.equal(R.fileUrl("org/name", "model.safetensors"), "https://huggingface.co/org/name/resolve/main/model.safetensors?download=true");
  assert.equal(R.fileUrl("org/name", "unet/diffusion pytorch#1.safetensors", false), "https://huggingface.co/org/name/resolve/main/unet/diffusion%20pytorch%231.safetensors");
  assert.equal(R.repoUrl("org/name"), "https://huggingface.co/org/name");
  for (const m of [model(), model({ id: "a/b" })]) for (const f of R.filesOf(m)) assert.match(R.fileUrl(m.id, f.path), /^https:\/\/huggingface\.co\/[\w.-]+\/[\w.-]+\/resolve\/main\/[^\s?#]+\?download=true$/);
});

test("a model that comes in pieces lists every piece", () => {
  assert.deepEqual(R.shardPaths("model-00001-of-00003.safetensors", 3), ["model-00001-of-00003.safetensors", "model-00002-of-00003.safetensors", "model-00003-of-00003.safetensors"]);
  assert.deepEqual(R.shardPaths("unet/x-01-of-02.safetensors", 2), ["unet/x-01-of-02.safetensors", "unet/x-02-of-02.safetensors"]);
  assert.deepEqual(R.shardPaths("one.safetensors", 1), ["one.safetensors"]);
  assert.equal(R.shardPaths("a-00001-of-00012.gguf", 12).length, 12);
});

test("the quality of a quantised file is read from its name", () => {
  assert.equal(R.quantOf("Llama-3.2-3B-Instruct-Q4_K_M.gguf"), "Q4_K_M");
  assert.equal(R.quantOf("model-IQ4_XS.gguf"), "IQ4_XS");
  assert.equal(R.quantOf("sub/dir/model.Q8_0.gguf"), "Q8_0");
  assert.equal(R.quantOf("model-f16.gguf"), "F16");
  assert.equal(R.quantOf("model.safetensors"), "");
});

test("the usual file to start with: a medium quality for quantised models, the whole model for the others", () => {
  assert.deepEqual(R.recommended(model()).map((f) => f.path), ["Llama-3.2-3B-Instruct-Q4_K_M.gguf"]);
  const noMedium = model({ f: [["a-Q8_0.gguf", 8e9, 1], ["a-Q2_K.gguf", 2e9, 1], ["mmproj-f16.gguf", 1e8, 1]] });
  assert.equal(R.recommended(noMedium)[0].path, "a-Q8_0.gguf");
  const other = model({ fmt: ["gguf"], f: [["x-Q3_K_S.gguf", 3e9, 1], ["mmproj-F16.gguf", 1e8, 1], ["x-IQ1_S.gguf", 1e9, 1]] });
  assert.equal(R.recommended(other)[0].path, "x-IQ1_S.gguf", "otherwise the smallest, and never the helper file for pictures");
  const image = model({ k: "image", fmt: ["safetensors"], f: [["unet/model.safetensors", 5e9, 1], ["unet/model.fp16.safetensors", 2.5e9, 1], ["vae/model.safetensors", 3e8, 1]] });
  assert.deepEqual(R.recommended(image).map((f) => f.path), ["unet/model.safetensors", "vae/model.safetensors"]);
});

test("the commands to get a model", () => {
  const c = R.commands(model());
  assert.equal(c.ollama, "ollama run hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M");
  assert.equal(c.hf, "huggingface-cli download bartowski/Llama-3.2-3B-Instruct-GGUF Llama-3.2-3B-Instruct-Q4_K_M.gguf");
  const image = R.commands(model({ id: "a/flux", k: "image", fmt: ["safetensors"], f: [["flux.safetensors", 1e10, 1]] }));
  assert.equal(image.ollama, undefined, "Ollama is only for chat models");
  assert.equal(image.hf, "huggingface-cli download a/flux");
});

test("programs that fit a kind of model", () => {
  const names = (m) => R.toolsFor(m).map((t) => t.name);
  assert.deepEqual(names(model()), ["LM Studio", "Ollama", "llama.cpp"]);
  assert.ok(names(model({ k: "image", fmt: ["safetensors"] })).includes("ComfyUI"));
  assert.ok(names(model({ k: "listen", fmt: ["safetensors"] })).includes("Buzz"));
  for (const c of R.CATEGORIES) for (const t of R.toolsFor(model({ k: c.key, fmt: ["safetensors"] }))) assert.match(t.url, /^https:\/\/(github\.com|huggingface\.co|lmstudio\.ai|ollama\.com)(\/|$)/);
  assert.ok(R.folderHint(model()).includes("LM Studio") && R.folderHint(model({ k: "image", fmt: ["safetensors"] })).includes("ComfyUI"));
});

const LIST = [
  model({ id: "bartowski/Llama-3.2-3B-Instruct-GGUF", d: 5000, l: 40, s: 2.0e9, c: "2025-05-01" }),
  model({ id: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", k: "code", d: 9000, l: 90, s: 4.7e9, lic: "apache-2.0", c: "2025-09-01", p: 7.6e9 }),
  model({ id: "black-forest-labs/FLUX.1-schnell", k: "image", task: "text-to-image", fmt: ["safetensors"], d: 20000, l: 3000, s: 23e9, lic: "apache-2.0", c: "2024-08-01", p: null }),
  model({ id: "openai/whisper-tiny", k: "listen", task: "automatic-speech-recognition", fmt: ["safetensors"], d: 7e6, l: 500, s: 151e6, lic: "apache-2.0", c: "2022-09-01", p: 39e6 }),
  model({ id: "someone/MusicGen-Fun", k: "music", task: "text-to-audio", fmt: ["safetensors"], d: 100, l: 1, s: 3e9, lic: "cc-by-nc-4.0", c: "2026-03-01", p: null }),
  model({ id: "x/onnx-thing", k: "detect", task: "object-detection", fmt: ["onnx"], d: 50, l: 2, s: 60e6, lic: "", c: "2023-01-01", p: null }),
];

test("searching finds words in any order, in the name, the kind, the licence and the format; umlauts and capitals do not matter", () => {
  const ids = (f) => R.filterModels(LIST, f).map((m) => m.id);
  assert.deepEqual(ids({ q: "qwen coder" }), ["Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"]);
  assert.deepEqual(ids({ q: "CODER qwen" }), ["Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"]);
  assert.deepEqual(ids({ q: "programmieren" }), ["Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"], "the name of the kind counts");
  assert.deepEqual(ids({ q: "text-to-image" }), ["black-forest-labs/FLUX.1-schnell"]);
  assert.deepEqual(ids({ q: "onnx" }), ["x/onnx-thing"]);
  assert.deepEqual(ids({ q: "7.6b" }).length, 1, "the size of the model in billions");
  assert.deepEqual(ids({ q: "gibtesnicht" }), []);
  assert.equal(ids({ q: "" }).length, 6);
  assert.equal(ids({ q: "   " }).length, 6);
});

test("filtering by kind, memory, licence and format", () => {
  const ids = (f) => R.filterModels(LIST, f).map((m) => m.id);
  assert.deepEqual(ids({ k: "listen" }), ["openai/whisper-tiny"]);
  assert.deepEqual(ids({ gb: 8 }).sort(), ["Qwen/Qwen2.5-Coder-7B-Instruct-GGUF", "bartowski/Llama-3.2-3B-Instruct-GGUF", "openai/whisper-tiny", "someone/MusicGen-Fun", "x/onnx-thing"].sort(), "what is bigger than 85 % of the memory is left out");
  assert.deepEqual(ids({ gb: 4 }).sort(), ["bartowski/Llama-3.2-3B-Instruct-GGUF", "openai/whisper-tiny", "someone/MusicGen-Fun", "x/onnx-thing"].sort());
  assert.equal(ids({ gb: 0 }).length, 6);
  assert.deepEqual(ids({ commercial: true }).length, 4, "no non-commercial and no unknown licence");
  assert.deepEqual(ids({ fmt: "gguf" }).length, 2);
  assert.deepEqual(ids({ fav: new Set(["openai/whisper-tiny"]) }), ["openai/whisper-tiny"]);
  assert.deepEqual(ids({ k: "chat", q: "llama", gb: 4, fmt: "gguf" }), ["bartowski/Llama-3.2-3B-Instruct-GGUF"]);
});

test("sorting", () => {
  const first = (how) => R.sortModels(LIST, how)[0].id;
  assert.equal(first("popular"), "openai/whisper-tiny");
  assert.equal(first("likes"), "black-forest-labs/FLUX.1-schnell");
  assert.equal(first("new"), "someone/MusicGen-Fun");
  assert.equal(first("small"), "x/onnx-thing");
  assert.equal(first("big"), "black-forest-labs/FLUX.1-schnell");
  assert.equal(first("name"), "black-forest-labs/FLUX.1-schnell");
  assert.equal(first("nonsense"), "openai/whisper-tiny");
  const before = LIST.map((m) => m.id).join();
  R.sortModels(LIST, "small");
  assert.equal(LIST.map((m) => m.id).join(), before, "the list itself is not changed");
  assert.equal(R.countByKind(LIST).chat, 1);
});

test("the state of the page goes into the address and back, and a wrong address is made harmless", () => {
  const state = { ...R.DEFAULTS, q: "flux", k: "image", sort: "small", gb: 12, fmt: "safetensors", commercial: true, m: "a/b" };
  const query = R.queryFromState(state);
  assert.equal(query, "?q=flux&k=image&sort=small&gb=12&fmt=safetensors&com=1&m=a%2Fb");
  assert.deepEqual(R.stateFromQuery(query), { ...state, fav: false });
  assert.equal(R.queryFromState(R.DEFAULTS), "");
  const bad = R.stateFromQuery("?k=%3Cscript%3E&sort=evil&gb=999&fmt=exe&m=..%2F..%2Fetc&q=" + "x".repeat(500));
  assert.deepEqual([bad.k, bad.sort, bad.gb, bad.fmt, bad.m, bad.q.length], ["", "popular", 0, "", "", 80]);
});

test("the kinds of models are what the page promises: music, video, chat, images and more", () => {
  const keys = R.CATEGORIES.map((c) => c.key);
  for (const wanted of ["chat", "image", "video", "music", "speech", "listen", "code"]) assert.ok(keys.includes(wanted), wanted);
  assert.equal(new Set(keys).size, keys.length);
  for (const c of R.CATEGORIES) assert.ok(c.label && c.hint && c.icon);
  assert.ok(!R.CATEGORIES.some((c) => /^Ai /.test(c.label)), "plain words, not product names");
});
