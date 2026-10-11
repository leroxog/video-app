/* Nex Ai chat: a chat like ChatGPT whose AI runs inside the visitor's browser.  There is one AI and nothing to choose: the page takes
   the best model that this computer can run, loads it once (from Hugging Face, kept in the browser afterwards), and then every question
   is answered by the visitor's own graphics card or processor, in a worker (regal-chat-worker.js).  A side bar with the earlier chats,
   the talk in the middle, the message field below.  What is written here never leaves the computer: this script sends nothing
   anywhere, the earlier chats are kept in this browser only, and the worker fetches only the model.  Everything that the model writes
   is put on the page as text, never as HTML. */
(function () {
  "use strict";

  const { h, put, fill, icon, logo, copyText, toast, confirmBox } = window.Regal;
  const Chat = window.RegalChatCore;
  const CHATS_KEY = "regal.chats";
  const SKIP_KEY = "regal.skip";                            // the models that did not load on this computer ({id: time})
  const CACHE_NAME = "transformers-cache";                  // where Transformers.js keeps the files of a model in the browser

  const app = {
    models: [], gpu: { webgpu: false, f16: false }, cached: false, model: null, runtime: null,
    worker: null, ready: false, loading: false, problem: "", files: {}, started: 0, lastProgress: 0, watch: 0, pending: "",
    chats: [], activeId: "", busy: false, current: null, savedNote: false,
    skips: {}, detail: "", downgraded: false,
  };
  const el = {};                                            // the parts of the page that are painted again and again
  let root = null;
  let frame = 0;

  // ---------------------------------------------------------------------------------------------------- storage
  function loadChats() {
    try {
      app.chats = Chat.sanitizeStore(localStorage.getItem(CHATS_KEY)).chats;
      app.activeId = "";                                    // a visit starts with a new chat; the old ones are in the side bar
    } catch (error) { app.chats = []; }
  }
  function saveChats() {
    app.chats = Chat.trimChats(app.chats);
    const write = () => localStorage.setItem(CHATS_KEY, JSON.stringify({ chats: app.chats, active: app.activeId }));
    try { write(); } catch (error) {
      try { app.chats = app.chats.slice(0, Math.max(1, Math.floor(app.chats.length / 2))); write(); } catch (again) { /* storage is full or not allowed: the chat still works, it is just not kept */ }
    }
  }
  function loadSkips() {
    try { app.skips = Chat.activeSkips(localStorage.getItem(SKIP_KEY)); } catch (error) { app.skips = {}; }
  }
  function saveSkips() {
    try { if (Object.keys(app.skips).length) localStorage.setItem(SKIP_KEY, JSON.stringify(app.skips)); else localStorage.removeItem(SKIP_KEY); } catch (error) { /* not allowed: then it is not remembered */ }
  }
  const activeChat = () => app.chats.find((chat) => chat.id === app.activeId) || null;

  // ------------------------------------------------------------------------------------------------ the computer
  /* How fast the graphics card reads its memory (GB/s): a program that reads a buffer of 128 MB again and again.  That speed decides how
     fast an AI can write, so the page uses it to take the best AI that is still fast enough on this computer.  Takes about half a second;
     null when it cannot be measured. */
  async function measureBandwidth(adapter) {
    let device = null;
    try {
      device = await adapter.requestDevice();
      const bytes = 128 * 1024 * 1024;                                    // exactly the default limit of one buffer
      const threads = 1 << 19;                                             // each of them reads 16 values of 16 bytes: 128 MB together
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
      await run(2);                                                        // the first runs prepare the program
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

  /* Is the model already in the browser (so that starting is quick and needs no download)? */
  async function findCached() {
    try {
      if (!app.model || !("caches" in window) || !(await caches.has(CACHE_NAME))) return false;
      const cache = await caches.open(CACHE_NAME);
      const hits = await Promise.all(Chat.cacheUrls(app.model, app.runtime.dtype).map(async (url) => (await cache.match(url)) || (await cache.match(Chat.chunkMetaUrl(url)))));
      return hits.every(Boolean);
    } catch (error) { return false; }                        // storage is not available: then it does not count as loaded
  }

  /* After loading: did the browser keep the model?  (With little free space it may not: then it has to be loaded again next time.) */
  async function checkSaved() {
    app.cached = await findCached();
    app.savedNote = !app.cached;
    renderBottom();
  }

  function supported() { return typeof Worker !== "undefined" && typeof WebAssembly === "object" && "fetch" in window; }

  // ------------------------------------------------------------------------------------------------- the frame
  function buildShell() {
    el.history = h("nav", { class: "history", "aria-label": "Frühere Chats" });
    el.side = h("aside", { class: "side", id: "side", "aria-label": "Seitenleiste" },
      h("button", { class: "new-chat", type: "button", onclick: newChat }, icon("edit"), "Neuer Chat"),
      el.history,
      h("div", { class: "side-foot" },
        h("button", { class: "side-link", type: "button", onclick: freeSpace }, icon("trash"), "Gespeicherte KI löschen"),
        h("button", { class: "side-link", type: "button", onclick: deleteAll }, icon("close"), "Alle Chats löschen"),
        (el.sideModel = h("p", { class: "side-model" })),
        h("nav", { class: "legal-mini", "aria-label": "Mehr" }, h("a", { href: "/nutzungsbedingungen" }, "Bedingungen"), h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"))));
    paintSideModel();
    el.top = h("header", { class: "topbar" });
    el.thread = h("main", { class: "thread", id: "main", tabindex: "-1" });
    el.bottom = h("div", { class: "bottom" });
    el.stage = h("div", { class: "stage" }, el.thread, el.bottom);
    el.shell = h("div", { class: "shell" }, el.side, h("div", { class: "backdrop", onclick: closeDrawer }), h("div", { class: "main-col" }, el.top, el.stage));
    fill(root, el.shell);
    buildComposer();
  }

  function paintSideModel() {
    const m = app.model;
    fill(el.sideModel, icon("pc"), `Nex Ai ist ${m ? m.name : "ein Sprachmodell"}${m && m.maker ? ` von ${m.maker}` : ""} und läuft auf deinem Gerät.`);
  }

  /* On a phone the side bar is a drawer: choosing something in it closes it (on a computer it stays). */
  function closeDrawer() { el.shell.classList.remove("side-open"); }

  /* The menu button (only on a phone): the side bar slides in over the page.  On a computer it is always there. */
  function toggleSide() { el.shell.classList.toggle("side-open"); }

  // ---------------------------------------------------------------------------------------------------- top bar
  function renderTop() {
    const state = app.ready ? "ready" : app.loading ? "loading" : "idle";
    const status = app.ready ? "bereit" : app.loading ? "startet …" : app.problem ? "läuft nicht" : "";
    fill(el.top,
      h("button", { class: "icon-btn menu-btn", type: "button", "aria-label": "Chats", "aria-controls": "side", onclick: toggleSide }, icon("menu")),
      h("span", { class: "top-mark" }, logo()),
      h("b", { class: "top-name" }, "Nex Ai"),
      h("span", { class: "top-status", title: status }, h("span", { class: `dot ${state}`, "aria-hidden": "true" }), status ? h("span", {}, status) : null),
      h("span", { class: "grow" }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Neuer Chat", title: "Neuer Chat", onclick: newChat }, icon("edit")));
  }

  // ------------------------------------------------------------------------------------------------- side bar
  function renderSidebar() {
    const groups = Chat.groupChats(app.chats);
    fill(el.history, groups.length ? groups.map((group) => h("section", { class: "hist-group" }, h("h3", {}, group.label),
      group.chats.map((chat) => h("div", { class: `hist${chat.id === app.activeId ? " on" : ""}` },
        h("button", { class: "hist-open", type: "button", title: chat.title, onclick: () => openChat(chat.id) }, h("span", {}, chat.title)),
        h("button", { class: "hist-del", type: "button", "aria-label": `Chat „${chat.title}“ löschen`, onclick: () => deleteChat(chat.id) }, icon("trash"))))))
      : h("p", { class: "hist-empty" }, "Deine Chats erscheinen hier. Sie bleiben nur auf diesem Gerät."));
  }

  function busyNow() {
    if (!app.busy) return false;
    toast("Warte, bis die Antwort fertig ist, oder drücke Stopp.");
    return true;
  }

  function newChat() {
    if (busyNow()) return;
    app.activeId = "";
    closeDrawer();
    renderAll();
    app.input?.focus({ preventScroll: true });
  }
  function openChat(id) {
    if (busyNow()) return;
    closeDrawer();
    if (id === app.activeId) return;
    app.activeId = id;
    renderAll();
  }
  async function deleteChat(id) {
    if (busyNow()) return;
    const chat = app.chats.find((c) => c.id === id);
    if (!chat || !(await confirmBox({ title: "Chat löschen?", text: `„${chat.title}“ wird von diesem Gerät gelöscht.`, yes: "Löschen", danger: true }))) return;
    app.chats = app.chats.filter((c) => c.id !== id);
    if (app.activeId === id) app.activeId = "";
    saveChats();
    renderAll();
  }
  async function deleteAll() {
    if (busyNow()) return;
    if (!app.chats.length) { toast("Es gibt keine gespeicherten Chats."); return; }
    if (!(await confirmBox({ title: "Alle Chats löschen?", text: "Alle gespeicherten Chats werden von diesem Gerät gelöscht. Das kannst du nicht rückgängig machen.", yes: "Alle löschen", danger: true }))) return;
    app.chats = [];
    app.activeId = "";
    saveChats();
    renderAll();
  }
  async function freeSpace() {
    if (busyNow()) return;
    if (!(await confirmBox({ title: "Gespeicherte KI löschen?", text: "Die KI wird aus deinem Browser gelöscht und gibt Speicherplatz frei. Beim nächsten Mal wird sie noch einmal geladen.", yes: "Löschen", danger: true }))) return;
    stopWorker();
    try { await caches.delete(CACHE_NAME); app.cached = false; app.skips = {}; saveSkips(); toast("Gelöscht."); } catch (error) { toast("Das Löschen hat nicht geklappt."); }
    renderAll();
  }

  // --------------------------------------------------------------------------------------------------- the worker
  function stopWorker() {
    clearInterval(app.watch);
    app.watch = 0;
    if (app.worker) { app.worker.terminate(); app.worker = null; }        // ends it and frees the memory of the graphics card
    app.busy = false;
    app.current = null;
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
    app.savedNote = false;
    app.files = {};
    app.started = performance.now();
    app.lastProgress = app.started;
    app.watch = setInterval(checkStall, 5000);
    renderAll();
    startWorker().postMessage({ type: "load", id: app.model.id, device: app.runtime.device, dtype: app.runtime.dtype });
  }

  /* A bigger version failed here before (maybe only because the memory was full at that moment): try again from the top. */
  function tryBigger() {
    if (busyNow()) return;
    retry();
  }

  /* "Noch einmal versuchen": from the top again, with the best model (what failed before is forgotten). */
  function retry() {
    stopWorker();
    app.skips = {};
    saveSkips();
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
      const pending = app.pending;
      app.pending = "";
      if (pending) submit(pending); else app.input?.focus({ preventScroll: true });
    }
    else if (message.type === "token") onToken(message.text);
    else if (message.type === "done") onDone(message);
    else if (message.type === "error") {
      if (message.stage === "load") onLoadError(message.message);
      else onGenerateError(Chat.friendlyError(message.message));
    }
  }

  function fail(text, raw) {
    stopWorker();
    app.problem = text;
    app.detail = details(raw);
    renderAll();
  }

  /* What a person can send us when it does not work: the model, how it was run, the computer and the error itself. */
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

  /* The model did not load.  When it is a matter of the computer (memory, graphics card), the next smaller model is tried, and the
     failure is remembered for two weeks so that the next visit does not try the big one again.  A matter of the connection is only shown. */
  function onLoadError(raw) {
    if (Chat.isDeviceTrouble(raw) && app.model) {
      app.skips[app.model.id] = Date.now();
      saveSkips();
      const next = Chat.bestModel(app.models, app.gpu, Object.keys(app.skips));
      if (next) {
        stopWorker();
        app.model = next;
        app.runtime = Chat.chooseRuntime(app.gpu, next);
        app.downgraded = true;
        app.detail = details(raw);
        findCached().then((cached) => { app.cached = cached; startLoading(); });
        return;
      }
    }
    fail(Chat.friendlyError(raw), raw);
  }

  /* Loading was cancelled: the message that was waiting goes back into the field. */
  function cancelLoading() {
    stopWorker();
    if (app.pending) { app.input.value = app.pending; grow(); }
    app.pending = "";
    renderAll();
  }

  // --------------------------------------------------------------------------------------------------- loading
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
      app.pending ? h("p", { class: "pending" }, h("span", {}, "Deine Nachricht:"), app.pending) : null,
      h("button", { class: "btn ghost", type: "button", onclick: cancelLoading }, "Abbrechen"));
  }

  /* Nothing has been loaded for 40 seconds (a connection that hangs): say so, and offer to start again.  Not when the download is done and the
     computer is only preparing the AI, which can take a while. */
  function checkStall() {
    if (!app.loading || !el.stall) return;
    const progress = Chat.progressOf(app.files, app.runtime ? app.runtime.bytes : 0);
    el.stall.hidden = !(performance.now() - app.lastProgress > 40000 && progress.fraction < 0.995);
  }

  function restartLoading() {
    stopWorker();
    startLoading();
  }

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
      app.runtime && app.runtime.ok ? h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: retry }, "Noch einmal versuchen")) : null,
      app.detail ? h("details", { class: "tech" }, h("summary", {}, "Technische Angaben"), h("pre", {}, app.detail),
        h("button", { class: "btn ghost small", type: "button", onclick: async () => toast((await copyText(app.detail)) ? "Kopiert." : "Kopieren hat nicht geklappt.") }, icon("copy"), "Angaben kopieren")) : null);
  }

  // ------------------------------------------------------------------------------------------------------ chat
  function greeting() {
    const hour = new Date().getHours();
    return hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : hour < 23 ? "Guten Abend" : "Gute Nacht";
  }

  function welcome() {
    return h("div", { class: "thread-inner welcome" },
      h("div", { class: "welcome-logo" }, logo()),
      h("h1", {}, greeting()),
      h("div", { class: "suggestions" }, Chat.SUGGESTIONS.map((text) => h("button", { class: "suggestion", type: "button", onclick: () => submit(text) }, text))));
  }

  function buildComposer() {
    app.input = h("textarea", { class: "composer-input", rows: "1", maxlength: String(Chat.MAX_INPUT), placeholder: "Schreib eine Nachricht …", "aria-label": "Deine Nachricht", enterkeyhint: "send",
      oninput: () => { grow(); paintSend(); },
      onkeydown: (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } } });
    el.send = h("button", { class: "send", type: "button", onclick: () => (app.busy ? app.worker?.postMessage({ type: "stop" }) : submit()) });
    el.composer = h("div", { class: "composer" },
      h("div", { class: "composer-box" }, app.input, el.send),
      h("p", { class: "composer-note" }, "Nex Ai läuft auf deinem Gerät, nichts wird gesendet. Nex kann Fehler machen. Wichtiges überprüfen."));
    paintSend();
  }

  function grow() { app.input.style.height = "auto"; app.input.style.height = `${Math.min(app.input.scrollHeight, 200)}px`; }
  function paintSend() {
    const empty = !app.input.value.trim();
    el.send.disabled = !app.busy && empty;
    el.send.setAttribute("aria-label", app.busy ? "Antwort stoppen" : "Senden");
    el.send.classList.toggle("stop", app.busy);
    fill(el.send, icon(app.busy ? "stop" : "send"));
  }

  /* Below the message field: what a person should know before the first message (a one-time download, a slow computer) or after it. */
  function renderBottom() {
    const notes = [];
    if (app.runtime && app.runtime.ok && !app.ready && !app.loading && !app.cached && !app.problem) {
      notes.push(h("p", { class: "notice" }, icon("download"), `Beim ersten Mal lädt Nex Ai sich einmalig auf dein Gerät (${Chat.formatBytes(app.runtime.bytes)}${app.runtime.bytes > 1.5e9 ? ", das dauert etwas" : ""}), am besten im WLAN. Danach geht es schnell.`));
    }
    if (app.runtime && app.runtime.ok && app.runtime.speed === "slow") notes.push(h("p", { class: "notice" }, icon("warn"), app.runtime.reason));
    if (app.ready && app.models.length > 1 && app.model && app.model.id === app.models[app.models.length - 1].id) {
      notes.push(h("p", { class: "notice" }, icon("info"), h("span", {}, "Du nutzt gerade die kleine Version von Nex Ai: Sie ist schnell, aber ungenauer, weil dein Gerät die größeren nicht schafft. ",
        Object.keys(app.skips).length ? h("button", { class: "linklike", type: "button", onclick: tryBigger }, "Größere Version noch einmal probieren") : null)));
    }
    if (app.ready && app.savedNote) notes.push(h("p", { class: "notice save-note" }, icon("info"), "Dein Browser hat die KI nicht gespeichert (vielleicht ist zu wenig Platz frei). Beim nächsten Mal muss sie noch einmal geladen werden."));
    fill(el.bottom, notes, app.runtime && app.runtime.ok && !app.problem ? el.composer : null);
  }

  function renderThread() {
    const chat = activeChat();
    let empty = false;
    if (app.loading) { fill(el.thread, loadingCard()); paintProgress(); }
    else if (app.problem || !app.runtime || !app.runtime.ok) {
      if (!app.problem) app.problem = (app.runtime && app.runtime.reason) || "Dieses Gerät kann die KI nicht ausführen.";
      fill(el.thread, problemCard());
    } else if (chat && chat.messages.length) paintMessages(chat);
    else { fill(el.thread, welcome()); empty = true; }
    el.stage.classList.toggle("is-empty", empty);
  }

  function renderAll() {
    paintSideModel();
    renderTop();
    renderSidebar();
    renderThread();
    renderBottom();
  }

  // ---------------------------------------------------------------------------------------------------- messages
  function atBottom() { return el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 140; }
  function follow(stick) { if (stick) el.thread.scrollTop = el.thread.scrollHeight; }

  function actions(text, last) {
    return [h("button", { class: "act", type: "button", "aria-label": "Antwort kopieren", title: "Kopieren", onclick: async () => toast((await copyText(text)) ? "Kopiert." : "Kopieren hat nicht geklappt.") }, icon("copy")),
      last ? h("button", { class: "act regen", type: "button", "aria-label": "Antwort neu schreiben", title: "Neu schreiben", onclick: regenerate }, icon("refresh")) : null];
  }

  function messageNode(message, last) {
    if (message.role === "user") return h("div", { class: "msg user" }, h("div", { class: "bubble" }, message.content));
    return h("div", { class: "msg bot" }, h("div", { class: "avatar" }, logo()),
      h("div", { class: "bot-main" }, h("div", { class: "answer" }, Chat.parseBlocks(message.content).map(blockNode)), h("div", { class: "msg-meta" }, actions(message.content, last))));
  }

  function paintMessages(chat) {
    el.list = h("div", { class: "msgs", role: "log", "aria-live": "polite", "aria-label": "Unterhaltung" },
      chat.messages.map((message, index) => messageNode(message, message.role === "assistant" && index === chat.messages.length - 1)));
    fill(el.thread, h("div", { class: "thread-inner" }, el.list));
    el.stage.classList.remove("is-empty");
    follow(true);
  }

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

  /* Sends a message.  When the AI is not started yet this starts it and the message waits until it is ready (one message at a time). */
  function submit(text) {
    const message = (text == null ? app.input.value : text).trim();
    if (!message || app.busy || !app.runtime || !app.runtime.ok || app.problem) return;
    if (!app.ready) {
      if (app.pending) { toast("Die KI startet noch. Deine erste Nachricht wartet schon."); return; }
      app.pending = message;
      if (text == null) { app.input.value = ""; grow(); paintSend(); }
      startLoading();
      return;
    }
    let chat = activeChat();
    const fresh = !chat;
    if (!chat) {
      chat = { id: Chat.newChatId(), title: Chat.titleFrom(message), updated: Date.now(), messages: [] };
      app.chats.unshift(chat);
      app.activeId = chat.id;
    }
    chat.messages.push({ role: "user", content: message });
    chat.updated = Date.now();
    if (text == null) { app.input.value = ""; grow(); }
    saveChats();
    renderSidebar();
    if (fresh || !el.list || !el.list.isConnected) paintMessages(chat); else { put(el.list, messageNode(chat.messages[chat.messages.length - 1], false)); follow(true); }
    answer(chat);
  }

  /* The AI starts writing the next answer of `chat` (its last message is the question). */
  function answer(chat) {
    el.list.querySelectorAll(".regen").forEach((button) => button.remove());                // only the newest answer can be written again
    const body = h("div", { class: "answer streaming" }, h("span", { class: "typing", "aria-label": "Nex schreibt" }, h("i"), h("i"), h("i")));
    const meta = h("div", { class: "msg-meta" });
    put(el.list, h("div", { class: "msg bot" }, h("div", { class: "avatar" }, logo()), h("div", { class: "bot-main" }, body, meta)));
    app.current = { chat, text: "", body, meta };
    app.busy = true;
    paintSend();
    follow(true);
    app.worker.postMessage({ type: "generate", messages: Chat.buildMessages(chat.messages), maxNewTokens: Chat.MAX_NEW_TOKENS });
  }

  function regenerate() {
    const chat = activeChat();
    if (!chat || app.busy || !app.ready || chat.messages[chat.messages.length - 1]?.role !== "assistant") return;
    chat.messages.pop();
    el.list.lastElementChild?.remove();
    saveChats();
    answer(chat);
  }

  function paintAnswer() {
    frame = 0;
    const current = app.current;
    if (!current || !current.body.isConnected) return;
    const stick = atBottom();
    fill(current.body, Chat.parseBlocks(current.text).map(blockNode));
    follow(stick);
  }

  function onToken(text) {
    if (!app.current) return;
    app.current.text += text;
    if (!frame) frame = requestAnimationFrame(paintAnswer);                    // not for every word: at most once per picture
  }

  function onDone(message) {
    const current = app.current;
    if (!current) { app.busy = false; paintSend(); return; }
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    const text = current.text.trim();
    if (text) {
      current.chat.messages.push({ role: "assistant", content: text });
      current.chat.updated = Date.now();
      saveChats();
    }
    app.current = null;
    app.busy = false;
    if (current.body.isConnected) {
      current.body.classList.remove("streaming");
      if (text) fill(current.body, Chat.parseBlocks(text).map(blockNode));
      else fill(current.body, h("p", { class: "muted" }, message.stopped ? "Gestoppt." : "Dazu ist mir nichts eingefallen. Frag mich noch einmal, vielleicht anders."));
      const speed = Chat.speedText(message.tokens, message.seconds);
      fill(current.meta, text ? actions(text, true) : null, message.stopped && text ? h("span", { class: "meta-note" }, "Gestoppt") : null, speed ? h("span", { class: "meta-note" }, speed) : null);
      follow(true);
    }
    renderSidebar();
    paintSend();
  }

  function onGenerateError(text) {
    const current = app.current;
    if (current && current.body.isConnected) { current.body.classList.remove("streaming"); fill(current.body, h("p", { class: "bad" }, icon("warn"), text)); }
    app.current = null;
    app.busy = false;
    paintSend();
  }

  // ------------------------------------------------------------------------------------------------------ start
  async function boot() {
    root = document.getElementById("app");
    fill(root, h("div", { class: "page loading" }, h("div", { class: "spinner" }), h("p", {}, "Nex Ai wird vorbereitet …")));
    try {
      if (!supported()) throw new Error("unsupported");
      const response = await fetch(root.dataset.models, { credentials: "omit" });
      if (!response.ok) throw new Error(`Fehler ${response.status}`);
      app.models = (await response.json()).models;
      app.gpu = await probeGpu();
      loadSkips();
      const wished = new URLSearchParams(location.search).get("ai");              // not offered on the page: ?ai=qwen takes the first model whose name contains it
      const chosen = wished ? app.models.find((m) => m.id.toLowerCase().includes(wished.toLowerCase()) && Chat.chooseRuntime(app.gpu, m).ok) : null;
      app.model = chosen || Chat.bestModel(app.models, app.gpu, Object.keys(app.skips)) || Chat.bestModel(app.models, app.gpu);      // when everything failed before, from the top again
      app.runtime = Chat.chooseRuntime(app.gpu, app.model || app.models[0]);
      app.downgraded = !!app.model && app.model.id !== (Chat.bestModel(app.models, app.gpu) || {}).id;
      app.cached = await findCached();
      loadChats();
      buildShell();
      renderAll();
      if (app.cached && app.runtime.ok) startLoading();                          // already in the browser: no download, so it just starts
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
