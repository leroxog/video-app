const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/regal-chat-core.js");

const model = (over = {}) => ({ id: "onnx-community/Gemma", name: "Gemma", tag: "Gut auf Deutsch", german: "gut", dtypes: { q4f16: 784e6, q4: 880e6 }, ...over });

test("a model runs on the graphics card with the small variant, or else on the processor", () => {
  assert.deepEqual(C.chooseRuntime({ webgpu: true, f16: true }, model()), { ok: true, device: "webgpu", dtype: "q4f16", bytes: 784e6, speed: "fast", reason: "" });
  const noF16 = C.chooseRuntime({ webgpu: true, f16: false }, model());
  assert.equal(noF16.device, "webgpu"); assert.equal(noF16.dtype, "q4"); assert.equal(noF16.bytes, 880e6);
  const full = model({ dtypes: { q4f16: 3e8, q4: 3.5e8, fp32: 1.16e9 } });
  const cpu = C.chooseRuntime({ webgpu: false, f16: false }, full);
  assert.equal(cpu.device, "wasm"); assert.equal(cpu.dtype, "fp32"); assert.equal(cpu.speed, "slow"); assert.match(cpu.reason, /langsamer/);
  assert.equal(C.chooseRuntime(null, full).device, "wasm");
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
  assert.match(C.friendlyError("Failed to allocate a buffer of size 123"), /speicher/i);
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

test("a model counts as loaded only when all its big files are in the cache", () => {
  assert.deepEqual(C.cacheUrls(model(), "q4f16"), ["https://huggingface.co/onnx-community/Gemma/resolve/main/onnx/model_q4f16.onnx"]);
  const split = model({ files: { q4f16: ["onnx/model_q4f16.onnx", "onnx/model_q4f16.onnx_data", "onnx/model_q4f16.onnx_data_1"] } });
  assert.equal(C.cacheUrls(split, "q4f16").length, 3);
  assert.equal(C.cacheUrls(split, "q4f16")[1], "https://huggingface.co/onnx-community/Gemma/resolve/main/onnx/model_q4f16.onnx_data");
  assert.equal(C.SUGGESTIONS.length, 4);
  assert.ok(C.SUGGESTIONS.every((text) => text.length > 20 && text.length < 80));
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

test("the AI is the best model (the list is best first) that this computer can run, fits and is fast enough for", () => {
  const strong = model({ id: "c/strong", cpu: false, dtypes: { q4f16: 2.9e9 }, minBuffer: 1e9, minMemory: 8 });
  const good = model({ id: "b/good", cpu: false, minBuffer: 7e8, minMemory: 4 });
  const small = model({ id: "a/small", cpu: true, dtypes: { q4f16: 3e8, q4: 3.5e8, fp32: 1.2e9 } });
  const list = [strong, good, small];
  const hw = (over = {}) => ({ webgpu: true, f16: true, bandwidth: 38, maxBuffer: 2147483644, deviceMemory: 16, ...over });
  assert.equal(C.bestModel(list, hw()).id, "b/good");                                              // a graphics card of 38 GB/s: the middle one is fast enough, the strong one is not
  assert.equal(C.bestModel(list, hw({ bandwidth: 300 })).id, "c/strong");                          // a strong graphics card: the best one
  assert.equal(C.bestModel(list, hw({ bandwidth: 15 })).id, "a/small");                            // a weak one: only the small one is fast enough
  assert.equal(C.bestModel(list, hw({ bandwidth: 300, deviceMemory: 4 })).id, "b/good");           // not enough RAM for the strong one
  assert.equal(C.bestModel(list, hw({ bandwidth: 300, maxBuffer: 268435456 })).id, "a/small");     // the pieces of the others do not fit into the graphics memory
  assert.equal(C.bestModel(list, hw({ bandwidth: 300, f16: false })).id, "b/good");                // the strong one only comes in the 16-bit variant
  assert.equal(C.bestModel(list, hw({ bandwidth: null })).id, "b/good");                           // not measured: the middle one
  assert.equal(C.bestModel(list, { webgpu: false, f16: false }).id, "a/small");                    // no graphics card: the one that may run on the processor
  assert.equal(C.bestModel(list, hw({ bandwidth: 300 }), ["c/strong"]).id, "b/good");              // it did not load here before
  assert.equal(C.bestModel(list, hw({ bandwidth: 300 }), ["c/strong", "b/good", "a/small"]), null);
  assert.equal(C.bestModel([strong], hw({ bandwidth: 5 })).id, "c/strong");                         // none is fast enough: the smallest that can run, better than nothing
  assert.equal(C.bestModel([], hw()), null);
  assert.match(C.SYSTEM_PROMPT, /Nex Ai/);
});

test("the speed of an AI is predicted from the memory speed of the graphics card and the size of the model", () => {
  const near = (value, low, high) => assert.ok(value >= low && value <= high, `${value} is not between ${low} and ${high}`);
  near(C.predictedSpeed({ bandwidth: 38 }, 0.298e9), 15, 25);                                       // measured on a real computer (38 GB/s): Gemma 3 270M 17 to 24 tokens a second
  near(C.predictedSpeed({ bandwidth: 38 }, 0.784e9), 8, 10);                                        // Gemma 3 1B 9
  near(C.predictedSpeed({ bandwidth: 38 }, 2.9e9), 3.5, 4.8);                                       // Qwen3 4B 3.7 to 4.7
  assert.equal(C.speedFactor(10), 0.3);
  assert.ok(C.predictedSpeed({ bandwidth: 300 }, 2.9e9) > C.MIN_SPEED);
  assert.ok(C.predictedSpeed({ bandwidth: 38 }, 2.9e9) < C.MIN_SPEED);
  assert.equal(C.predictedSpeed({}, 1e9), C.predictedSpeed({ bandwidth: 30 }, 1e9));              // not measured: a middle value
  assert.equal(C.fits({ webgpu: true, maxBuffer: 5e8, deviceMemory: 16 }, { minBuffer: 7e8 }), false);
  assert.equal(C.fits({ webgpu: true, maxBuffer: 0, deviceMemory: 0 }, { minBuffer: 7e8, minMemory: 8 }), true);   // unknown is not a reason to say no
  assert.equal(C.fits({ webgpu: false, deviceMemory: 2 }, { minMemory: 4 }), false);
});

test("a model that is too big for a computer without a graphics card is not run there, and the others only in full size", () => {
  const big = model({ cpu: false });
  const small = model({ id: "x/small", cpu: true, dtypes: { q4f16: 3e8, q4: 3.5e8, fp32: 1.16e9 } });
  assert.equal(C.chooseRuntime({ webgpu: true, f16: true }, big).ok, true);
  const r = C.chooseRuntime({ webgpu: false, f16: false }, big);
  assert.equal(r.ok, false); assert.match(r.reason, /WebGPU/);
  const cpu = C.chooseRuntime({ webgpu: false, f16: false }, small);
  assert.equal(cpu.ok, true); assert.equal(cpu.device, "wasm"); assert.equal(cpu.dtype, "fp32"); assert.equal(cpu.bytes, 1.16e9); assert.equal(cpu.speed, "slow");
  assert.equal(C.chooseRuntime({ webgpu: false, f16: false }, model()).ok, false, "the 4-bit variants cannot run on a processor");
  assert.equal(C.chooseRuntime({ webgpu: true, f16: false }, small).dtype, "q4", "on a graphics card without 16-bit numbers the 4-bit variant");
});

test("when the best model did not load here the next one is taken, and nothing is left when all failed", () => {
  const big = model({ id: "a/big", cpu: false });
  const small = model({ id: "a/small", cpu: true, dtypes: { q4f16: 3e8, q4: 3.5e8, fp32: 1.2e9 } });
  const gpu = { webgpu: true, f16: true }, cpu = { webgpu: false, f16: false };
  const fast = { ...gpu, bandwidth: 100 };
  assert.equal(C.bestModel([big, small], fast, []).id, "a/big");
  assert.equal(C.bestModel([big, small], fast, ["a/big"]).id, "a/small");
  assert.equal(C.bestModel([big, small], cpu, []).id, "a/small");
  assert.equal(C.bestModel([big, small], fast, ["a/big", "a/small"]), null);
});

test("failures are remembered for two weeks and a damaged note is ignored", () => {
  const now = 1_000_000_000_000, day = 86400000;
  assert.deepEqual(C.activeSkips(JSON.stringify({ "a/big": now - 3 * day, "a/old": now - 20 * day, "a/future": now + 5 * day, "a/bad": "x" }), now), { "a/big": now - 3 * day });
  for (const junk of [undefined, null, "", "{bad", "[]", "5", '"text"']) assert.deepEqual(C.activeSkips(junk, now), {});
  assert.equal(C.SKIP_DAYS, 14);
});

test("only a matter of the computer is a reason for the smaller model, not the connection", () => {
  for (const message of ["Failed to allocate memory", "Aborted(OOM)", "RangeError: Array buffer allocation failed", "Buffer size (900) exceeds the max buffer size limit", "WebGPU device lost", "no available backend found. ERR: wasm RuntimeError: unreachable"]) {
    assert.equal(C.isDeviceTrouble(message), true, message);
  }
  for (const message of ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource", "HTTP 503", "", undefined]) {
    assert.equal(C.isDeviceTrouble(message), false, String(message));
  }
});

test("the note of a file in parts has the address the worker writes", () => {
  assert.equal(C.chunkMetaUrl("https://huggingface.co/a/b/resolve/main/onnx/model.onnx_data"), "https://huggingface.co/a/b/resolve/main/onnx/model.onnx_data?nex-meta");
});

test("memory that ran out is told from a graphics card that does not work at all", () => {
  for (const message of ["Failed to allocate memory", "Aborted(OOM)", "RangeError: Array buffer allocation failed", "Buffer size (900) exceeds the max buffer size limit"]) {
    assert.equal(C.isMemoryTrouble(message), true, message);
    assert.equal(C.isDeviceTrouble(message), true, message);
  }
  for (const message of ["WebGPU is not available in the worker: no graphics card adapter", "Failed to get GPU adapter. You may need to enable flag --enable-unsafe-webgpu", "GPUDevice lost", undefined, ""]) {
    assert.equal(C.isMemoryTrouble(message), false, String(message));
  }
  assert.equal(C.isDeviceTrouble("WebGPU is not available in the worker: no graphics card adapter"), true);
  assert.equal(C.isDeviceTrouble("Failed to get GPU adapter"), true);
});
