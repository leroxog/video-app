/* Nex Ai, mehrere Agenten: one question, answered by real passes of the one AI model that runs in the visitor's browser -- not three
   different AIs (this computer could not hold that), the same model playing three roles one after another, each one reading what the
   one before it wrote: a first answer, a check of that answer, then the final answer for the visitor.  Every word a role writes is put
   on the page as it is written, exactly like the regular chat (static/js/regal-chat.js), which this script borrows its model loading
   and hardware code from.  Nothing a visitor writes leaves their computer: the worker (regal-chat-worker.js) only fetches the model
   itself, from Hugging Face. */
(function () {
  "use strict";

  const { h, fill, icon, logo, copyText, toast } = window.Regal;
  const Chat = window.RegalChatCore;
  const SKIP_KEY = "regal.skip";                            // shared with regal-chat.js: a model or "webgpu" that failed stays skipped on both pages
  const NO_GPU = "webgpu";
  const CACHE_NAME = "transformers-cache";

  /* The three passes.  Each reads the question and everything the earlier passes wrote; only the text of the last one is offered as
     "the answer", but all three stay visible, because the point is to see the AI actually think it through, not to hide the steps. */
  const AGENTS = [
    { label: "Agent 1 · erste Antwort", system: "Du bist ein KI-Agent von Nex Ai. Beantworte die folgende Frage direkt, klar und so genau du kannst. Antworte auf Deutsch, außer die Frage ist in einer anderen Sprache. Sag ehrlich, wenn du etwas nicht sicher weißt." },
    { label: "Agent 2 · prüft nach", system: "Du bist ein zweiter KI-Agent von Nex Ai. Du bekommst eine Frage und die Antwort eines anderen Agenten darauf. Prüfe sie kurz: Was stimmt, was fehlt, was könnte falsch sein? Schreibe nur deine Ergänzungen oder Korrekturen in ein paar Sätzen, wiederhole die erste Antwort nicht." },
    { label: "Antwort", system: "Du bist ein dritter KI-Agent von Nex Ai. Du bekommst eine Frage, eine erste Antwort und eine Prüfung dazu. Schreibe daraus die beste, klare Antwort für den Nutzer, in normaler Sprache, ohne die anderen Agenten zu erwähnen." },
  ];
  const AGENT_MAX_TOKENS = [420, 320, 480];

  const app = {
    models: [], gpu: { webgpu: false, f16: false }, realGpu: null, skips: {},
    model: null, runtime: null, worker: null,
    ready: false, loading: false, problem: "", files: {}, started: 0, lastProgress: 0, watch: 0,
    downgraded: false, detail: "", rawError: "", cached: false,
    question: "", agents: [], step: -1, busy: false,
  };
  const el = {};
  let root = null;
  let frame = 0;

  function loadSkips() { try { app.skips = Chat.activeSkips(localStorage.getItem(SKIP_KEY)); } catch (error) { app.skips = {}; } }
  function saveSkips() { try { if (Object.keys(app.skips).length) localStorage.setItem(SKIP_KEY, JSON.stringify(app.skips)); else localStorage.removeItem(SKIP_KEY); } catch (error) { /* not allowed: then it is not remembered */ } }

  // ------------------------------------------------------------------------------------------------ the computer (identical measurement to regal-chat.js)
  async function measureBandwidth(adapter) {
    let device = null;
    try {
      device = await adapter.requestDevice();
      const bytes = 128 * 1024 * 1024;
      const threads = 1 << 19;
      const data = device.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE });
      const out = device.createBuffer({ size: threads * 4, usage: GPUBufferUsage.STORAGE });
      const module = device.createShaderModule({ code: `
        @group(0) @binding(0) var<storage, read> data: array<vec4<u32>>;
        @group(0) @binding(1) var<storage, read_write> out: array<u32>;
        @compute @workgroup_size(256)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
          var acc = vec4<u32>(0u);
          for (var j = 0u; j < 16u; j = j + 1u) { acc = acc ^ data[j * ${threads}u + id.x]; }
          out[id.x] = acc.x ^ acc.y ^ acc.z ^ acc.w;
        }` });
      const pipeline = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
      const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: data } }, { binding: 1, resource: { buffer: out } }] });
      const run = async (rounds) => {
        const encoder = device.createCommandEncoder();
        for (let r = 0; r < rounds; r++) { const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(threads / 256); pass.end(); }
        const start = performance.now();
        device.queue.submit([encoder.finish()]);
        await device.queue.onSubmittedWorkDone();
        return performance.now() - start;
      };
      await run(2);
      let best = 0;
      for (let k = 0; k < 3; k++) best = Math.max(best, (bytes * 24) / ((await run(24)) / 1000) / 1e9);
      return best > 0 && isFinite(best) ? Math.round(best * 10) / 10 : null;
    } catch (error) {
      return null;
    } finally {
      try { device && device.destroy(); } catch (ignored) { /* it is gone anyway */ }
    }
  }

  async function probeGpu() {
    const gpu = { webgpu: false, f16: false, bandwidth: null, maxBuffer: 0, deviceMemory: navigator.deviceMemory || 0, name: "" };
    try {
      const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
      if (adapter) {
        gpu.webgpu = true;
        gpu.f16 = adapter.features.has("shader-f16");
        const info = adapter.info || {};
        gpu.name = [info.vendor, info.architecture, info.device].filter(Boolean).join(" ");
        const limits = adapter.limits || {};
        gpu.maxBuffer = Math.min(limits.maxBufferSize || Infinity, limits.maxStorageBufferBindingSize || Infinity);
        if (!isFinite(gpu.maxBuffer)) gpu.maxBuffer = 0;
        gpu.bandwidth = await measureBandwidth(adapter);
      }
    } catch (error) { /* no graphics card for the browser */ }
    return gpu;
  }

  async function findCached() {
    try {
      if (!app.model || !("caches" in window) || !(await caches.has(CACHE_NAME))) return false;
      const cache = await caches.open(CACHE_NAME);
      const hits = await Promise.all(Chat.cacheUrls(app.model, app.runtime.dtype).map(async (url) => (await cache.match(url)) || (await cache.match(Chat.chunkMetaUrl(url)))));
      return hits.every(Boolean);
    } catch (error) { return false; }
  }

  function supported() { return typeof Worker !== "undefined" && typeof WebAssembly === "object" && "fetch" in window; }

  // --------------------------------------------------------------------------------------------------- the worker
  function stopWorker() {
    clearInterval(app.watch);
    app.watch = 0;
    if (app.worker) { app.worker.terminate(); app.worker = null; }
    app.busy = false;
    app.step = -1;
    app.ready = false;
    app.loading = false;
  }

  function startWorker() {
    const worker = new Worker(root.dataset.worker, { type: "module" });
    worker.addEventListener("message", (event) => onWorker(event.data || {}));
    worker.addEventListener("error", (event) => fail("Das Programm für die KI konnte nicht gestartet werden. Nutze einen aktuellen Browser (Chrome, Edge, Firefox oder Safari).", event && event.message));
    app.worker = worker;
    return worker;
  }

  function startLoading() {
    if (!app.runtime || !app.runtime.ok || app.loading || app.ready) return;
    app.loading = true;
    app.problem = "";
    app.files = {};
    app.started = performance.now();
    app.lastProgress = app.started;
    app.watch = setInterval(checkStall, 5000);
    renderAll();
    startWorker().postMessage({ type: "load", id: app.model.id, device: app.runtime.device, dtype: app.runtime.dtype });
  }

  function retry() {
    stopWorker();
    app.skips = {};
    saveSkips();
    if (app.realGpu) app.gpu = app.realGpu;
    app.downgraded = false;
    app.model = Chat.bestModel(app.models, app.gpu) || app.model;
    app.runtime = Chat.chooseRuntime(app.gpu, app.model);
    findCached().then((cached) => { app.cached = cached; startLoading(); });
  }

  function onWorker(message) {
    if (message.type === "progress") { app.files = message.files || {}; app.lastProgress = performance.now(); if (app.loading) paintProgress(); }
    else if (message.type === "ready") {
      clearInterval(app.watch);
      app.watch = 0;
      app.loading = false;
      app.ready = true;
      renderAll();
      checkSaved();
      if (app.question && app.step === 0 && !app.agents[0].done) runStep();         // a question was asked before the model finished loading
    }
    else if (message.type === "token") onToken(message.text);
    else if (message.type === "done") onDone(message);
    else if (message.type === "error") {
      if (message.stage === "load") onLoadError(message.message);
      else onGenerateError(Chat.friendlyError(message.message));
    }
  }

  async function checkSaved() {
    app.cached = await findCached();
    renderBottom();
  }

  function fail(text, raw) {
    stopWorker();
    app.problem = text;
    app.rawError = String(raw || "").replace(/\s+/g, " ").slice(0, 220);
    app.detail = details(raw);
    renderAll();
  }

  function details(raw) {
    const g = app.gpu || {};
    return [
      `Modell: ${app.model ? app.model.id : "-"}`,
      `Ausgeführt auf: ${app.runtime && app.runtime.ok ? `${app.runtime.device} (${app.runtime.dtype})` : "-"}`,
      `Grafikkarte: ${g.webgpu ? `ja${g.f16 ? ", 16 Bit" : ""}${g.name ? `, ${g.name}` : ""}${g.maxBuffer ? `, größter Puffer ${Chat.formatBytes(g.maxBuffer)}` : ""}${g.bandwidth ? `, Speichertempo ${g.bandwidth} GB/s` : ""}` : "nein (kein WebGPU)"}`,
      `Arbeitsspeicher laut Browser: ${navigator.deviceMemory ? `${navigator.deviceMemory} GB` : "unbekannt"}`,
      `Browser: ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 140)}`,
      `Fehler: ${String(raw || "-").slice(0, 400)}`,
    ].join("\n");
  }

  function onLoadError(raw) {
    const onGpu = app.runtime && app.runtime.ok && app.runtime.device === "webgpu";
    if (onGpu && Chat.isDeviceTrouble(raw) && !Chat.isMemoryTrouble(raw)) {
      app.skips[NO_GPU] = Date.now();
      saveSkips();
      app.gpu = { ...app.gpu, webgpu: false, f16: false, bandwidth: null };
      if (switchTo(Chat.bestModel(app.models, app.gpu, Object.keys(app.skips)), raw)) return;
    } else if (Chat.isDeviceTrouble(raw) && app.model) {
      app.skips[app.model.id] = Date.now();
      saveSkips();
      if (switchTo(Chat.bestModel(app.models, app.gpu, Object.keys(app.skips)), raw)) return;
    }
    fail(Chat.friendlyError(raw), raw);
  }

  function switchTo(next, raw) {
    if (!next) return false;
    stopWorker();
    app.model = next;
    app.runtime = Chat.chooseRuntime(app.gpu, next);
    app.downgraded = true;
    app.detail = details(raw);
    findCached().then((cached) => { app.cached = cached; startLoading(); });
    return true;
  }

  function cancelLoading() {
    stopWorker();
    if (app.question) { app.input.value = app.question; grow(); }
    app.question = "";
    app.agents = [];
    renderAll();
    paintSend();
  }

  // --------------------------------------------------------------------------------------------------- loading / problem cards
  function loadingCard() {
    el.barFill = h("div", { class: "bar-fill" });
    el.barBox = h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-label": "Fortschritt des Ladens" }, el.barFill);
    el.barText = h("p", { class: "loading-text", "aria-live": "polite" }, "Es geht los …");
    return h("div", { class: "thread-inner center-card" },
      h("div", { class: "spinner" }),
      h("h2", {}, app.cached ? "Nex Ai wird gestartet" : "Nex Ai wird auf dein Gerät geladen"),
      el.barBox, el.barText,
      h("p", { class: "muted small" }, app.cached ? "Das dauert nur einen Moment." : "Das passiert nur beim ersten Mal. Du kannst dieses Fenster offen lassen und etwas anderes machen."),
      app.downgraded ? h("p", { class: "notice" }, icon("info"), "Die größere Version hat auf deinem Gerät nicht funktioniert (zu wenig Speicher). Nex Ai nimmt deshalb eine kleinere.") : null,
      (el.stall = h("p", { class: "notice", hidden: true }, icon("warn"), h("span", {}, "Es geht gerade nicht weiter. Prüfe deine Verbindung. ", h("button", { class: "linklike", type: "button", onclick: restartLoading }, "Neu starten"), " (schon geladene Teile bleiben erhalten)"))),
      app.question ? h("p", { class: "pending" }, h("span", {}, "Deine Frage:"), app.question) : null,
      h("button", { class: "btn ghost", type: "button", onclick: cancelLoading }, "Abbrechen"));
  }

  function checkStall() {
    if (!app.loading || !el.stall) return;
    const progress = Chat.progressOf(app.files, app.runtime ? app.runtime.bytes : 0);
    el.stall.hidden = !(performance.now() - app.lastProgress > 40000 && progress.fraction < 0.995);
  }

  function restartLoading() { stopWorker(); startLoading(); }

  function paintProgress() {
    if (!el.barFill) return;
    if (el.stall) el.stall.hidden = true;
    const progress = Chat.progressOf(app.files, app.runtime.bytes);
    const percent = Math.round(progress.fraction * 100);
    el.barFill.style.width = `${percent}%`;
    el.barBox.setAttribute("aria-valuenow", String(percent));
    if (progress.fraction >= 0.995) { el.barText.textContent = "Fast fertig: Nex Ai wird gestartet. Beim ersten Mal dauert das einen Moment."; return; }
    const left = Chat.remaining(progress.loaded, progress.total, (performance.now() - app.started) / 1000);
    el.barText.textContent = `${Chat.formatBytes(progress.loaded)} von ${Chat.formatBytes(progress.total)} (${percent} %)${left ? ` · ${left}` : ""}`;
  }

  function problemCard() {
    return h("div", { class: "thread-inner center-card" }, icon("warn"), h("h2", {}, "Nex Ai läuft nicht"), h("p", { class: "muted" }, app.problem),
      app.rawError ? h("p", { class: "raw-error" }, app.rawError) : null,
      app.runtime && app.runtime.ok ? h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: retry }, "Noch einmal versuchen")) : null,
      app.detail ? h("details", { class: "tech" }, h("summary", {}, "Technische Angaben"), h("pre", {}, app.detail),
        h("button", { class: "btn ghost small", type: "button", onclick: async () => toast((await copyText(app.detail)) ? "Kopiert." : "Kopieren hat nicht geklappt.") }, icon("copy"), "Angaben kopieren")) : null);
  }

  // ------------------------------------------------------------------------------------------------------ the frame
  function suggestionRow() {
    if (!el.suggest) el.suggest = h("div", { class: "suggestions" }, Chat.SUGGESTIONS.map((text) => h("button", { class: "suggestion", type: "button", onclick: () => ask(text) }, text)));
    return el.suggest;
  }

  function buildComposer() {
    app.input = h("textarea", { class: "composer-input", rows: "1", maxlength: String(Chat.MAX_INPUT), placeholder: "Frag die Agenten etwas", "aria-label": "Deine Frage", enterkeyhint: "send",
      oninput: () => { grow(); paintSend(); },
      onkeydown: (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(); } } });
    el.send = h("button", { class: "send", type: "button", onclick: () => (app.busy ? app.worker?.postMessage({ type: "stop" }) : ask()) });
    el.composer = h("div", { class: "composer" },
      h("div", { class: "composer-box" }, app.input, el.send),
      h("p", { class: "composer-note" }, "Drei echte Durchgänge derselben KI prüfen sich gegenseitig, bevor du die Antwort bekommst. Alles läuft auf deinem Gerät, nichts wird gesendet."));
    paintSend();
  }

  function grow() { app.input.style.height = "auto"; app.input.style.height = `${Math.min(app.input.scrollHeight, 200)}px`; }
  function paintSend() {
    const empty = !app.input.value.trim();
    el.send.disabled = !app.busy && empty;
    el.send.setAttribute("aria-label", app.busy ? "Antwort stoppen" : "Fragen");
    el.send.classList.toggle("stop", app.busy);
    fill(el.send, icon(app.busy ? "stop" : "send"));
  }

  function renderTop() {
    const state = app.ready ? "ready" : app.loading ? "loading" : "idle";
    const status = app.ready ? "bereit" : app.loading ? "startet …" : app.problem ? "läuft nicht" : "";
    fill(el.top, h("a", { class: "side-logo", href: "/", "aria-label": "Nex Ai, Startseite" }, logo()),
      h("b", { class: "top-name" }, "Nex Ai"),
      h("span", { class: "top-status", title: status }, h("span", { class: `dot ${state}`, "aria-hidden": "true" }), status ? h("span", {}, status) : null),
      h("span", { class: "grow" }),
      app.question ? h("button", { class: "icon-btn", type: "button", "aria-label": "Neue Frage", title: "Neue Frage", onclick: newQuestion }, icon("plus")) : null);
  }

  function renderBottom() {
    const notes = [];
    if (app.runtime && app.runtime.ok && !app.ready && !app.loading && !app.cached && !app.problem) {
      notes.push(h("p", { class: "notice" }, icon("download"), `Beim ersten Mal lädt Nex Ai sich einmalig auf dein Gerät (${Chat.formatBytes(app.runtime.bytes)}${app.runtime.bytes > 1.5e9 ? ", das dauert etwas" : ""}), am besten im WLAN. Danach geht es schnell.`));
    }
    if (app.runtime && app.runtime.ok && app.runtime.speed === "slow") notes.push(h("p", { class: "notice" }, icon("warn"), app.runtime.reason));
    if (app.ready && app.models.length > 1 && app.model && app.model.id === app.models[app.models.length - 1].id) {
      notes.push(h("p", { class: "notice" }, icon("info"), h("span", {}, "Du nutzt gerade die kleine Version von Nex Ai: Sie ist schnell, aber ungenauer, weil dein Gerät die größeren nicht schafft. ",
        Object.keys(app.skips).length ? h("button", { class: "linklike", type: "button", onclick: () => { if (!app.busy) retry(); } }, "Größere Version noch einmal probieren") : null)));
    }
    const usable = app.runtime && app.runtime.ok && !app.problem;
    fill(el.bottom, notes, usable ? el.composer : null, usable && !app.question ? suggestionRow() : null);
  }

  function welcome() {
    return h("div", { class: "thread-inner welcome" }, h("h1", {}, "Was sollen die Agenten klären?"),
      h("p", { class: "muted" }, "Eine Frage, drei echte Durchgänge der KI, die sich gegenseitig prüfen – alles auf deinem Gerät, alles sichtbar."));
  }

  function agentNode(index) {
    const agent = app.agents[index];
    const final = index === AGENTS.length - 1;
    const body = h("div", { class: `answer${agent.done ? "" : " streaming"}` }, agent.text ? Chat.parseBlocks(agent.text).map(blockNode) : h("span", { class: "typing", "aria-label": `${AGENTS[index].label} schreibt` }, h("i")));
    const meta = h("div", { class: "msg-meta" }, agent.done && agent.text ? [
      h("button", { class: "act", type: "button", "aria-label": "Text kopieren", title: "Kopieren", onclick: async () => toast((await copyText(agent.text)) ? "Kopiert." : "Kopieren hat nicht geklappt.") }, icon("copy")),
      agent.speed ? h("span", { class: "meta-note" }, agent.speed) : null,
    ] : null);
    agent.body = body; agent.metaEl = meta;
    return h("div", { class: `msg bot agent-turn${final ? " agent-final" : ""}` },
      h("div", { class: "bot-main" }, h("p", { class: "agent-label" }, AGENTS[index].label), body, meta));
  }

  function renderThread() {
    let empty = false;
    if (app.loading) { fill(el.thread, loadingCard()); paintProgress(); }
    else if (app.problem || !app.runtime || !app.runtime.ok) {
      if (!app.problem) app.problem = (app.runtime && app.runtime.reason) || "Dieses Gerät kann die KI nicht ausführen.";
      fill(el.thread, problemCard());
    } else if (app.question) {
      el.list = h("div", { class: "msgs", role: "log", "aria-live": "polite", "aria-label": "Die Agenten" },
        h("div", { class: "msg user" }, h("div", { class: "bubble" }, app.question)),
        app.agents.map((agent, index) => agentNode(index)));
      fill(el.thread, h("div", { class: "thread-inner" }, el.list));
      if (app.step >= 0) follow(true);
    } else { fill(el.thread, welcome()); empty = true; }
    el.stage.classList.toggle("is-empty", empty);
  }

  function renderAll() { renderTop(); renderThread(); renderBottom(); }

  function atBottom() { return el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 140; }
  function follow(stick) { if (stick) el.thread.scrollTop = el.thread.scrollHeight; }

  function inline(text) {
    return Chat.parseInline(text).map((part) => (part.t === "code" ? h("code", { class: "ic" }, part.s) : part.t === "bold" ? h("strong", {}, part.s) : part.s));
  }
  function codeBlock(block) {
    return h("div", { class: "code-block" },
      h("div", { class: "code-head" }, h("span", {}, block.lang || "Code"), h("button", { class: "copy-btn", type: "button", onclick: async () => toast((await copyText(block.text)) ? "Kopiert." : "Kopieren hat nicht geklappt.") }, icon("copy"), "Kopieren")),
      h("pre", {}, h("code", {}, block.text)));
  }
  function blockNode(block) {
    if (block.type === "p") return h("p", {}, inline(block.text));
    if (block.type === "h") return h(`h${Math.min(block.level + 2, 6)}`, { class: "ans-h" }, inline(block.text));
    if (block.type === "ul") return h("ul", { class: "ans-list" }, block.items.map((item) => h("li", {}, inline(item))));
    if (block.type === "ol") return h("ol", { class: "ans-list", start: block.start > 1 ? String(block.start) : null }, block.items.map((item) => h("li", {}, inline(item))));
    return codeBlock(block);
  }

  // ------------------------------------------------------------------------------------------------ the three passes
  function newQuestion() {
    if (app.busy) { toast("Warte, bis die Agenten fertig sind, oder drücke Stopp."); return; }
    app.question = "";
    app.agents = [];
    app.step = -1;
    renderAll();
    app.input?.focus({ preventScroll: true });
  }

  function ask(text) {
    const question = (text == null ? app.input.value : text).trim();
    if (!question || app.busy || !app.runtime || !app.runtime.ok || app.problem) return;
    app.question = question;
    app.agents = AGENTS.map(() => ({ text: "", done: false, speed: "" }));
    app.step = 0;
    if (text == null) { app.input.value = ""; grow(); }
    paintSend();
    if (!app.ready) { startLoading(); return; }
    renderThread();
    runStep();
  }

  function runStep() {
    const index = app.step;
    if (index < 0 || index >= AGENTS.length) return;
    const parts = [`Frage: ${app.question}`];
    for (let i = 0; i < index; i++) parts.push(`${AGENTS[i].label.replace(/^Agent \d+ · /, "")} (Agent ${i + 1}):\n${app.agents[i].text}`);
    const messages = [{ role: "system", content: AGENTS[index].system }, { role: "user", content: parts.join("\n\n") }];
    app.busy = true;
    paintSend();
    app.worker.postMessage({ type: "generate", messages, maxNewTokens: AGENT_MAX_TOKENS[index] });
  }

  function onToken(text) {
    const agent = app.agents[app.step];
    if (!agent) return;
    agent.text += text;
    if (!frame) frame = requestAnimationFrame(paintStreaming);
  }

  function paintStreaming() {
    frame = 0;
    const agent = app.agents[app.step];
    if (!agent || !agent.body || !agent.body.isConnected) return;
    const stick = atBottom();
    fill(agent.body, Chat.parseBlocks(agent.text).map(blockNode));
    follow(stick);
  }

  function onDone(message) {
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    const agent = app.agents[app.step];
    app.busy = false;
    if (agent) {
      agent.text = agent.text.trim();
      agent.done = true;
      agent.speed = Chat.speedText(message.tokens, message.seconds);
      if (agent.body && agent.body.isConnected) {
        agent.body.classList.remove("streaming");
        if (agent.text) fill(agent.body, Chat.parseBlocks(agent.text).map(blockNode));
        else fill(agent.body, h("p", { class: "muted" }, message.stopped ? "Gestoppt." : "Dazu ist mir nichts eingefallen."));
      }
      if (agent.metaEl) fill(agent.metaEl, agent.text ? [
        h("button", { class: "act", type: "button", "aria-label": "Text kopieren", title: "Kopieren", onclick: async () => toast((await copyText(agent.text)) ? "Kopiert." : "Kopieren hat nicht geklappt.") }, icon("copy")),
        agent.speed ? h("span", { class: "meta-note" }, agent.speed) : null,
      ] : null);
    }
    paintSend();
    if (message.stopped || !agent || !agent.text) { app.step = -1; return; }           // stopped, or nothing written: do not chain further passes on an empty answer
    app.step++;
    if (app.step < AGENTS.length) {
      renderThread();
      runStep();
    } else {
      app.step = -1;
    }
  }

  function onGenerateError(text) {
    const agent = app.agents[app.step];
    app.busy = false;
    app.step = -1;
    if (agent && agent.body && agent.body.isConnected) { agent.body.classList.remove("streaming"); fill(agent.body, h("p", { class: "bad" }, icon("warn"), text)); }
    paintSend();
  }

  // ------------------------------------------------------------------------------------------------------ start
  function buildShell() {
    el.top = h("header", { class: "topbar" });
    el.thread = h("main", { class: "thread", id: "main", tabindex: "-1" });
    el.bottom = h("div", { class: "bottom" });
    el.stage = h("div", { class: "stage" }, el.thread, el.bottom);
    fill(root, h("div", { class: "shell" }, h("div", { class: "main-col" }, el.top, el.stage)));
    buildComposer();
  }

  async function boot() {
    root = document.getElementById("app");
    fill(root, h("div", { class: "page loading" }, h("div", { class: "spinner" }), h("p", {}, "Nex Ai wird vorbereitet …")));
    try {
      if (!supported()) throw new Error("unsupported");
      const response = await fetch(root.dataset.models, { credentials: "omit" });
      if (!response.ok) throw new Error(`Fehler ${response.status}`);
      app.models = (await response.json()).models;
      app.gpu = await probeGpu();
      app.realGpu = app.gpu;
      loadSkips();
      if (app.skips[NO_GPU]) app.gpu = { ...app.gpu, webgpu: false, f16: false, bandwidth: null };
      const wished = new URLSearchParams(location.search).get("ai");
      const chosen = wished ? app.models.find((m) => m.id.toLowerCase().includes(wished.toLowerCase()) && Chat.chooseRuntime(app.gpu, m).ok) : null;
      app.model = chosen || Chat.bestModel(app.models, app.gpu, Object.keys(app.skips)) || Chat.bestModel(app.models, app.gpu);
      app.runtime = Chat.chooseRuntime(app.gpu, app.model || app.models[0]);
      app.downgraded = !!app.model && (app.model.id !== (Chat.bestModel(app.models, app.gpu) || {}).id || !!app.skips[NO_GPU]);
      app.cached = await findCached();
      buildShell();
      renderAll();
    } catch (error) {
      console.error(error);
      const old = error && error.message === "unsupported";
      fill(root, h("div", { class: "page loading" }, icon("warn"), h("h2", {}, old ? "Dein Browser ist zu alt" : "Die Seite konnte nicht geladen werden"),
        h("p", {}, old ? "Für Nex Ai brauchst du einen aktuellen Browser, zum Beispiel Chrome, Edge, Firefox oder Safari." : "Prüfe deine Verbindung und versuche es noch einmal."),
        old ? null : h("button", { class: "btn primary", type: "button", onclick: boot }, "Noch einmal")));
    }
    document.querySelector(".skip")?.addEventListener("click", (event) => { event.preventDefault(); el.thread?.focus(); });
  }

  boot();
})();
