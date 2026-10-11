const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/regal-chat-core.js");

const model = (over = {}) => ({ id: "onnx-community/Gemma", name: "Gemma", tag: "Gut auf Deutsch", german: "gut", dtypes: { q4f16: 784e6, q4: 880e6 }, ...over });

test("a model runs on the graphics card with the small variant, or else on the processor", () => {
  assert.deepEqual(C.chooseRuntime({ webgpu: true, f16: true }, model()), { ok: true, device: "webgpu", dtype: "q4f16", bytes: 784e6, speed: "fast", reason: "" });
  const noF16 = C.chooseRuntime({ webgpu: true, f16: false }, model());
  assert.equal(noF16.device, "webgpu"); assert.equal(noF16.dtype, "q4"); assert.equal(noF16.bytes, 880e6);
  const cpu = C.chooseRuntime({ webgpu: false, f16: false }, model());
  assert.equal(cpu.device, "wasm"); assert.equal(cpu.dtype, "q4"); assert.equal(cpu.speed, "slow"); assert.match(cpu.reason, /langsamer/);
  assert.equal(C.chooseRuntime(null, model()).device, "wasm");
});

test("a model that only has the small variant cannot run without the graphics card", () => {
  const only = model({ dtypes: { q4f16: 2.3e9 } });
  assert.equal(C.chooseRuntime({ webgpu: true, f16: true }, only).ok, true);
  for (const gpu of [{ webgpu: true, f16: false }, { webgpu: false, f16: false }]) {
    const r = C.chooseRuntime(gpu, only);
    assert.equal(r.ok, false); assert.match(r.reason, /WebGPU/);
  }
});

test("the model gets the instruction first and then as much of the talk as fits, newest last", () => {
  const talk = [{ role: "user", content: "eins" }, { role: "assistant", content: "zwei" }, { role: "user", content: "drei" }];
  const all = C.buildMessages(talk);
  assert.equal(all[0].role, "system"); assert.equal(all[0].content, C.SYSTEM_PROMPT);
  assert.deepEqual(all.slice(1), talk);
  const long = "x".repeat(3000);
  const cut = C.buildMessages([{ role: "user", content: long }, { role: "assistant", content: long }, { role: "user", content: "neu" }], C.SYSTEM_PROMPT.length + 3100);
  assert.deepEqual(cut.map((m) => m.role), ["system", "user"]);       // the older turns do not fit, and a talk may not start with an answer
  assert.equal(cut[1].content, "neu");
  const alone = C.buildMessages([{ role: "user", content: "y".repeat(20000) }], 1000);
  assert.equal(alone.length, 2); assert.ok(alone[1].content.length <= 1000);
});

test("things that are not part of the talk are not sent to the model", () => {
  const messages = C.buildMessages([{ role: "system", content: "geheim" }, { role: "user", content: "  " }, { role: "assistant", content: "Antwort ohne Frage" }, { role: "user", content: "Hallo" }, { role: "tool", content: "x" }]);
  assert.deepEqual(messages.map((m) => m.role), ["system", "user"]);
  assert.equal(messages[1].content, "Hallo");
});

test("the answer is cut into paragraphs, lists, headings and code", () => {
  const blocks = C.parseBlocks("Hier ist es:\n\n## Schritte\n1. Erst\n2. Dann\n\n- a\n- b\n\n```python\nprint('hi')\n\nx = 1\n```\nFertig.");
  assert.deepEqual(blocks.map((b) => b.type), ["p", "h", "ol", "ul", "code", "p"]);
  assert.deepEqual(blocks[2].items, ["Erst", "Dann"]);
  assert.equal(blocks[2].start, 1);
  assert.deepEqual(blocks[3].items, ["a", "b"]);
  assert.equal(blocks[4].lang, "python"); assert.equal(blocks[4].text, "print('hi')\n\nx = 1");
  assert.equal(blocks[5].text, "Fertig.");
});

test("an answer that is still being written shows its open code block as far as it goes", () => {
  const blocks = C.parseBlocks("Probier das:\n```js\nconst a = 1;\nconst b");
  assert.deepEqual(blocks.map((b) => b.type), ["p", "code"]);
  assert.equal(blocks[1].text, "const a = 1;\nconst b");
  assert.deepEqual(C.parseBlocks(""), []);
});

test("html in an answer stays text: the parser never makes tags", () => {
  const blocks = C.parseBlocks("<img src=x onerror=alert(1)>\n\n**fett** und `code` <b>x</b>");
  assert.equal(blocks[0].text, "<img src=x onerror=alert(1)>");
  const parts = C.parseInline(blocks[1].text);
  assert.deepEqual(parts.map((p) => p.t), ["bold", "text", "code", "text"]);
  assert.equal(parts[3].s, " <b>x</b>");
});

test("the loading bar counts files that have not started yet", () => {
  const files = { "a.onnx": { loaded: 100, total: 400 }, "b.json": { loaded: 10, total: 10 } };
  const p = C.progressOf(files, 1000);
  assert.equal(p.loaded, 110); assert.equal(p.total, 1000); assert.equal(Math.round(p.fraction * 100), 11);
  assert.equal(C.progressOf({}, 0).fraction, 0);
  assert.equal(C.progressOf({ x: { loaded: 500, total: 400 } }, 0).fraction, 1);
  assert.equal(C.progressOf(undefined, 5).fraction, 0);
});

test("the time left is only said when it can be known", () => {
  assert.equal(C.remaining(10, 1000, 1), "");
  assert.equal(C.remaining(0, 1000, 10), "");
  assert.equal(C.remaining(900, 1000, 10), "noch unter einer Minute");
  assert.equal(C.remaining(100e6, 500e6, 20), "noch etwa 1 Min.");
  assert.equal(C.remaining(100e6, 5e9, 20), "noch etwa 16 Min.");
  assert.match(C.remaining(1e6, 5e9, 20), /Std\./);
});

test("an error is explained in plain words", () => {
  assert.match(C.friendlyError("Failed to allocate a buffer of size 123"), /Speicher/);
  assert.match(C.friendlyError("QuotaExceededError: storage"), /Platz/);
  assert.match(C.friendlyError("no WebGPU adapter"), /Grafikkarte/);
  assert.match(C.friendlyError("TypeError: Failed to fetch"), /Verbindung/);
  assert.match(C.friendlyError("something odd"), /Das hat nicht geklappt/);
  assert.match(C.friendlyError(undefined), /Das hat nicht geklappt/);
});

test("the speed is said in words per second, and not before there is anything to say", () => {
  assert.equal(C.speedText(1, 0.2), "");
  assert.equal(C.speedText(30, 2), "10 Wörter pro Sekunde");
  assert.equal(C.speedText(12, 4), "2 Wörter pro Sekunde");
  assert.equal(C.speedText(10, 4), "1,7 Wörter pro Sekunde");
});

test("a model counts as loaded only when all its big files are in the cache, and the suggestions suit the model", () => {
  assert.deepEqual(C.cacheUrls(model(), "q4f16"), ["https://huggingface.co/onnx-community/Gemma/resolve/main/onnx/model_q4f16.onnx"]);
  const split = model({ files: { q4f16: ["onnx/model_q4f16.onnx", "onnx/model_q4f16.onnx_data", "onnx/model_q4f16.onnx_data_1"] } });
  assert.equal(C.cacheUrls(split, "q4f16").length, 3);
  assert.equal(C.cacheUrls(split, "q4f16")[1], "https://huggingface.co/onnx-community/Gemma/resolve/main/onnx/model_q4f16.onnx_data");
  assert.equal(C.suggestionsFor(model({ id: "onnx-community/Qwen2.5-Coder-1.5B-Instruct", tag: "Zum Programmieren" })), C.CODE_SUGGESTIONS);
  assert.equal(C.suggestionsFor(model()), C.SUGGESTIONS);
  assert.equal(C.suggestionsFor(null), C.SUGGESTIONS);
});

test("a chat gets its title from the first question", () => {
  assert.equal(C.titleFrom("  Wie   geht" + String.fromCharCode(10) + " das?  "), "Wie geht das?");
  assert.equal(C.titleFrom(""), "Neuer Chat");
  assert.equal(C.titleFrom("x".repeat(100)).length, 44);
  assert.ok(C.titleFrom("x".repeat(100)).endsWith("…"));
  assert.match(C.newChatId(), /^[a-z0-9]{8,}$/);
  assert.notEqual(C.newChatId(), C.newChatId());
});

test("saved chats are read back safely: nothing damaged or foreign is trusted", () => {
  const good = { id: "abc-1", title: "Erste", updated: 5, messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hallo" }] };
  const store = C.sanitizeStore(JSON.stringify({ chats: [good, { ...good, id: "abc-1" }, { id: "../x", messages: [{ role: "user", content: "a" }] }, { id: "empty", messages: [] },
    { id: "bad-roles", title: 5, updated: "x", messages: [{ role: "system", content: "geheim" }, { role: "user", content: "  " }, { role: "user", content: 7 }] },
    { id: "ok-2", messages: [{ role: "tool", content: "x" }, { role: "user", content: "Frage" }], updated: 9 }, null, 5], active: "ok-2" }));
  assert.deepEqual(store.chats.map((c) => c.id), ["ok-2", "abc-1"]);                        // newest first, duplicates and damaged ones gone
  assert.equal(store.chats[0].title, "Frage");                                              // a missing title is made from the first message
  assert.deepEqual(store.chats[0].messages, [{ role: "user", content: "Frage" }]);
  assert.equal(store.active, "ok-2");
  for (const junk of [undefined, null, "", "{bad", "[]", "5", JSON.stringify({ chats: "x" })]) assert.deepEqual(C.sanitizeStore(junk), { chats: [], active: "" });
  assert.equal(C.sanitizeStore({ chats: [good], active: "gone" }).active, "");
  assert.equal(C.sanitizeStore({ chats: [{ ...good, messages: [{ role: "user", content: "x".repeat(50000) }] }] }).chats[0].messages[0].content.length, 20000);
});

test("only as many chats are kept as a browser should be asked to store", () => {
  const chat = (n, size) => ({ id: `c${n}`, title: `t${n}`, updated: n, messages: [{ role: "user", content: "x".repeat(size) }] });
  assert.equal(C.trimChats(Array.from({ length: 60 }, (_, n) => chat(n, 10))).length, C.MAX_CHATS);
  assert.equal(C.trimChats(Array.from({ length: 60 }, (_, n) => chat(n, 10)))[0].id, "c59");
  const big = C.trimChats([chat(1, 700000), chat(2, 700000), chat(3, 700000)]);
  assert.deepEqual(big.map((c) => c.id), ["c3"]);                                          // the newest one stays, the rest does not fit
  assert.equal(C.trimChats([chat(1, 2000000)]).length, 1);                                  // a chat that is too big alone is still kept
  const long = C.sanitizeStore({ chats: [{ id: "long", updated: 1, messages: Array.from({ length: 200 }, (_, n) => ({ role: n % 2 ? "assistant" : "user", content: `m${n}` })) }] });
  assert.equal(long.chats[0].messages.length, C.MAX_MESSAGES);
  assert.equal(long.chats[0].messages[long.chats[0].messages.length - 1].content, "m199");
});

test("the chats are grouped by day for the side bar", () => {
  const now = new Date(2026, 9, 11, 15, 0).getTime();
  const at = (days, hour = 12) => new Date(2026, 9, 11 - days, hour).getTime();
  const chats = [{ id: "a", updated: at(0, 9) }, { id: "b", updated: at(0, 14) }, { id: "c", updated: at(1, 23) }, { id: "d", updated: at(3) }, { id: "e", updated: at(7) }, { id: "f", updated: at(8) }, { id: "g", updated: at(90) }];
  const groups = C.groupChats(chats, now);
  assert.deepEqual(groups.map((g) => g.label), ["Heute", "Gestern", "Letzte 7 Tage", "Älter"]);
  assert.deepEqual(groups[0].chats.map((c) => c.id), ["b", "a"]);                           // newest first inside a group
  assert.deepEqual(groups[2].chats.map((c) => c.id), ["d", "e"]);
  assert.deepEqual(groups[3].chats.map((c) => c.id), ["f", "g"]);
  assert.deepEqual(C.groupChats([{ id: "x", updated: at(2) }], now).map((g) => g.label), ["Letzte 7 Tage"]);
  assert.deepEqual(C.groupChats([], now), []);
});

test("the model to start with is the remembered one, else a small one that speaks German, and never one that cannot run", () => {
  const small = model({ id: "a/small", german: "einfach", dtypes: { q4f16: 4e8, q4: 7e8 } });
  const good = model({ id: "b/good" });
  const big = model({ id: "c/big", german: "gut", dtypes: { q4f16: 2.3e9 } });
  const gpu = { webgpu: true, f16: true };
  assert.equal(C.defaultModel([small, good, big], gpu, "").id, "b/good");
  assert.equal(C.defaultModel([small, good, big], gpu, "c/big").id, "c/big");
  assert.equal(C.defaultModel([small, good, big], { webgpu: false, f16: false }, "c/big").id, "b/good");
  assert.equal(C.defaultModel([big], { webgpu: false, f16: false }, "").id, "c/big");
});
