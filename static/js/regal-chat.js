/* KI-Regal chat: a chat like ChatGPT, Claude or Grok whose model runs inside the visitor's browser.  A side bar with the earlier chats, a
   model picker on top, the talk in the middle, the message field below.  The page picks a small model that suits this computer, loads
   it once (from Hugging Face, kept in the browser afterwards), and then every question is answered by the visitor's own graphics card
   or processor, in a worker (regal-chat-worker.js).  What is written here never leaves the computer: this script sends nothing
   anywhere, the earlier chats are kept in this browser only, and the worker fetches only the model.  Everything that the model writes
   is put on the page as text, never as HTML. */
(function () {
  "use strict";

  const { h, put, fill, icon, logo, copyText, toast, confirmBox } = window.Regal;
  const Chat = window.RegalChatCore;
  const MODEL_KEY = "regal.chat.model";
  const CHATS_KEY = "regal.chats";
  const CACHE_NAME = "transformers-cache";                  // where Transformers.js keeps the files of a model in the browser

  const app = {
    models: [], gpu: { webgpu: false, f16: false }, cached: {}, model: null, runtime: null,
    worker: null, ready: false, loading: false, problem: "", files: {}, started: 0,
    chats: [], activeId: "", busy: false, current: null, savedNote: false,
  };
  const el = {};                                            // the parts of the page that are painted again and again
  let root = null;
  let frame = 0;

  // ---------------------------------------------------------------------------------------------------- storage
  function remembered() { try { return localStorage.getItem(MODEL_KEY) || ""; } catch (error) { return ""; } }
  function remember(id) { try { localStorage.setItem(MODEL_KEY, id); } catch (error) { /* not allowed: then it is not remembered */ } }

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
  const activeChat = () => app.chats.find((chat) => chat.id === app.activeId) || null;

  // ------------------------------------------------------------------------------------------------ the computer
  async function probeGpu() {
    const gpu = { webgpu: false, f16: false };
    try {
      const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null;
      if (adapter) { gpu.webgpu = true; gpu.f16 = adapter.features.has("shader-f16"); }
    } catch (error) { /* no graphics card for the browser */ }
    return gpu;
  }

  /* Which models are already in the browser (so that starting is quick). */
  async function findCached() {
    const found = {};
    try {
      if (!("caches" in window) || !(await caches.has(CACHE_NAME))) return found;
      const cache = await caches.open(CACHE_NAME);
      for (const model of app.models) {
        const runtime = Chat.chooseRuntime(app.gpu, model);
        if (!runtime.ok) continue;
        const hits = await Promise.all(Chat.cacheUrls(model, runtime.dtype).map((url) => cache.match(url)));
        if (hits.every(Boolean)) found[model.id] = true;
      }
    } catch (error) { /* storage is not available: then nothing counts as loaded */ }
    return found;
  }

  /* After loading: did the browser keep the model?  (With little free space it may not: then it has to be loaded again next time.) */
  async function checkSaved() {
    app.cached = await findCached();
    app.savedNote = !app.cached[app.model.id];
    renderBottom();
  }

  function supported() { return typeof Worker !== "undefined" && typeof WebAssembly === "object" && "fetch" in window; }

  // ------------------------------------------------------------------------------------------------- the frame
  function buildShell() {
    el.history = h("nav", { class: "history", "aria-label": "Frühere Chats" });
    el.side = h("aside", { class: "side", id: "side", "aria-label": "Seitenleiste" },
      h("div", { class: "side-top" },
        h("a", { class: "brand", href: "/", "aria-label": "KI-Regal, Startseite" }, logo(), h("span", {}, "KI-Regal")),
        h("button", { class: "icon-btn side-close", type: "button", "aria-label": "Seitenleiste schließen", onclick: closeDrawer }, icon("close"))),
      h("button", { class: "new-chat", type: "button", onclick: newChat }, icon("edit"), "Neuer Chat"),
      el.history,
      h("div", { class: "side-foot" },
        h("a", { class: "side-link", href: "/" }, icon("cube"), "Alle Modelle ansehen"),
        h("button", { class: "side-link", type: "button", onclick: freeSpace }, icon("trash"), "Gespeicherte Modelle löschen"),
        h("button", { class: "side-link", type: "button", onclick: deleteAll }, icon("close"), "Alle Chats löschen"),
        h("nav", { class: "legal-mini", "aria-label": "Mehr" }, h("a", { href: "/nutzungsbedingungen" }, "Bedingungen"), h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"))));
    el.top = h("header", { class: "topbar" });
    el.thread = h("main", { class: "thread", id: "main", tabindex: "-1" });
    el.bottom = h("div", { class: "bottom" });
    el.shell = h("div", { class: "shell" }, el.side, h("div", { class: "backdrop", onclick: closeDrawer }),
      h("div", { class: "main-col" }, el.top, el.thread, el.bottom));
    fill(root, el.shell);
    buildComposer();
  }

  /* On a phone the side bar is a drawer: choosing something in it closes it (on a computer it stays). */
  function closeDrawer() { el.shell.classList.remove("side-open"); }

  /* The side bar: on a phone it slides in over the page, on a computer it can be hidden. */
  function toggleSide(open) {
    const small = window.matchMedia("(max-width: 860px)").matches;
    const shown = small ? el.shell.classList.contains("side-open") : !el.shell.classList.contains("side-hidden");
    const next = typeof open === "boolean" ? open : !shown;
    if (small) el.shell.classList.toggle("side-open", next); else el.shell.classList.toggle("side-hidden", !next);
  }

  // ---------------------------------------------------------------------------------------------------- top bar
  let pop = null;
  function closeMenu() {
    if (!pop) return;
    pop.remove();
    pop = null;
    el.modelButton?.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", escape, true);
  }
  function outside(event) { if (pop && !pop.contains(event.target) && !event.target.closest(".model-btn")) closeMenu(); }
  function escape(event) { if (event.key === "Escape") { closeMenu(); el.modelButton?.focus(); } }

  function openMenu() {
    if (pop) { closeMenu(); return; }
    pop = h("div", { class: "model-pop", role: "listbox", "aria-label": "Modell wählen" },
      app.models.map((model) => {
        const runtime = Chat.chooseRuntime(app.gpu, model);
        const on = app.model && app.model.id === model.id;
        return h("button", { class: `pop-row${on ? " on" : ""}`, type: "button", role: "option", "aria-selected": on ? "true" : "false", disabled: !runtime.ok, onclick: () => { closeMenu(); chooseModel(model); } },
          h("span", { class: "pop-main" }, h("b", {}, model.name), h("span", { class: "pop-tag" }, model.tag)),
          h("span", { class: "pop-size" }, runtime.ok ? [app.cached[model.id] ? h("span", { class: "pop-cached" }, icon("check"), "geladen") : null, Chat.formatBytes(runtime.bytes)] : "nicht möglich"));
      }),
      h("a", { class: "pop-link", href: "/" }, icon("cube"), "Alle Modelle im Regal ansehen"));
    el.modelWrap.append(pop);
    el.modelButton.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
  }

  function renderTop() {
    closeMenu();
    const state = app.ready ? "ready" : app.loading ? "loading" : "idle";
    el.modelButton = h("button", { class: "model-btn", type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", onclick: openMenu },
      h("span", { class: `dot ${state}`, "aria-hidden": "true" }), h("b", {}, app.model ? app.model.name : "Modell wählen"), icon("down"));
    el.modelWrap = h("div", { class: "model-wrap" }, el.modelButton);
    const status = app.ready ? (app.runtime.device === "webgpu" ? "auf deiner Grafikkarte" : "auf deinem Prozessor") : app.loading ? "wird geladen …" : "nicht gestartet";
    fill(el.top,
      h("button", { class: "icon-btn", type: "button", "aria-label": "Seitenleiste ein- oder ausblenden", "aria-controls": "side", onclick: () => toggleSide() }, icon("menu")),
      el.modelWrap,
      h("span", { class: "top-status" }, status),
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
    if (!(await confirmBox({ title: "Gespeicherte Modelle löschen?", text: "Die Modelle werden aus deinem Browser gelöscht und geben Speicherplatz frei. Beim nächsten Mal musst du sie wieder laden.", yes: "Löschen", danger: true }))) return;
    try { await caches.delete(CACHE_NAME); app.cached = {}; toast("Gelöscht."); } catch (error) { toast("Das Löschen hat nicht geklappt."); }
    renderAll();
  }

  // ------------------------------------------------------------------------------------------ choosing a model
  function chooseModel(model) {
    const runtime = Chat.chooseRuntime(app.gpu, model);
    if (!runtime.ok || (app.ready && app.model.id === model.id)) return;
    if (busyNow()) return;
    const change = app.ready || app.loading;
    app.model = model;
    app.runtime = runtime;
    remember(model.id);
    if (change) startLoading(); else { renderTop(); renderThread(); }
  }

  function setupCard() {
    const runtime = app.runtime;
    const rows = app.models.map((model) => {
      const r = Chat.chooseRuntime(app.gpu, model);
      const on = app.model && app.model.id === model.id;
      return h("label", { class: `pick${on ? " on" : ""}${r.ok ? "" : " off"}` },
        h("input", { type: "radio", name: "model", value: model.id, checked: on, disabled: !r.ok, onchange: () => chooseModel(model) }),
        h("span", { class: "pick-main" },
          h("span", { class: "pick-head" }, h("b", {}, model.name), h("span", { class: "pick-tag" }, model.tag)),
          h("span", { class: "pick-note" }, model.note),
          h("span", { class: "pick-facts" }, `${model.maker} · ${model.params} Parameter · ${model.license}`),
          r.ok ? null : h("span", { class: "pick-problem" }, icon("warn"), r.reason)),
        h("span", { class: "pick-size" }, h("b", {}, r.ok ? Chat.formatBytes(r.bytes) : "–"), app.cached[model.id] ? h("span", { class: "pick-cached" }, icon("check"), "schon geladen") : h("span", {}, "Download")));
    });
    return h("div", { class: "thread-inner setup" },
      h("div", { class: "setup-logo" }, logo()),
      h("h1", {}, "Chat mit einer KI auf deinem Computer"),
      h("p", { class: "lead" }, "Wie ChatGPT, nur ohne App, ohne Konto und ohne Server: Du lädst ein kleines Modell einmal in deinen Browser. Danach rechnet dein eigener Computer die Antworten aus. Deine Fragen verlassen ihn nie."),
      h("ul", { class: "points" },
        h("li", {}, icon("shield"), "Privat: nichts wird gesendet"),
        h("li", {}, icon("download"), "Einmal laden, dann gespeichert"),
        h("li", {}, icon("pc"), "Nutzt deine Grafikkarte")),
      h("h2", {}, "Modell wählen"),
      h("div", { class: "picks" }, rows),
      h("div", { class: "start" },
        runtime && runtime.ok
          ? [h("button", { class: "btn primary big", type: "button", onclick: startLoading }, app.cached[app.model.id] ? "Starten" : `Laden und starten (${Chat.formatBytes(runtime.bytes)})`),
            h("p", { class: "muted small" }, app.cached[app.model.id] ? "Das Modell ist schon in deinem Browser und startet in ein paar Sekunden." : "Der erste Download ist groß: am besten im WLAN. Danach bleibt das Modell in deinem Browser.")]
          : h("p", { class: "pick-problem" }, icon("warn"), runtime ? runtime.reason : "Kein Modell verfügbar."),
        runtime && runtime.ok && runtime.speed === "slow" ? h("p", { class: "notice" }, icon("warn"), runtime.reason) : null,
        h("p", { class: "muted small device" }, icon("pc"), app.gpu.webgpu ? "Dein Browser kann die Grafikkarte benutzen (WebGPU): das ist am schnellsten." : "Dein Browser hat keine Grafikkarten-Beschleunigung (WebGPU). Es geht trotzdem, aber langsamer.")));
  }

  // --------------------------------------------------------------------------------------------------- the worker
  function stopWorker() {
    if (app.worker) { app.worker.terminate(); app.worker = null; }        // ends it and frees the memory of the graphics card
    app.busy = false;
    app.current = null;
    app.ready = false;
  }

  function startWorker() {
    const worker = new Worker(root.dataset.worker, { type: "module" });
    worker.addEventListener("message", (event) => onWorker(event.data || {}));
    worker.addEventListener("error", () => fail("Das Programm für das Modell konnte nicht gestartet werden. Nutze einen aktuellen Browser (Chrome, Edge, Firefox oder Safari)."));
    app.worker = worker;
    return worker;
  }

  function startLoading() {
    if (!app.runtime || !app.runtime.ok) return;
    remember(app.model.id);
    stopWorker();
    app.loading = true;
    app.problem = "";
    app.savedNote = false;
    app.files = {};
    app.started = performance.now();
    renderAll();
    startWorker().postMessage({ type: "load", id: app.model.id, device: app.runtime.device, dtype: app.runtime.dtype });
  }

  function onWorker(message) {
    if (message.type === "progress") { app.files = message.files || {}; if (app.loading) paintProgress(); }
    else if (message.type === "ready") { app.loading = false; app.ready = true; renderAll(); checkSaved(); app.input?.focus({ preventScroll: true }); }
    else if (message.type === "token") onToken(message.text);
    else if (message.type === "done") onDone(message);
    else if (message.type === "error") {
      if (message.stage === "load") fail(Chat.friendlyError(message.message));
      else onGenerateError(Chat.friendlyError(message.message));
    }
  }

  function fail(text) {
    stopWorker();
    app.loading = false;
    app.problem = text;
    renderAll();
  }

  // --------------------------------------------------------------------------------------------------- loading
  function loadingCard() {
    el.barFill = h("div", { class: "bar-fill" });
    el.barBox = h("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-label": "Fortschritt des Ladens" }, el.barFill);
    el.barText = h("p", { class: "loading-text", "aria-live": "polite" }, "Es geht los …");
    return h("div", { class: "thread-inner center-card" },
      h("div", { class: "spinner" }),
      h("h2", {}, `${app.model.name} wird geladen`),
      el.barBox, el.barText,
      h("p", { class: "muted small" }, "Du kannst dieses Fenster offen lassen und etwas anderes machen. Schon geladene Teile bleiben erhalten."),
      h("button", { class: "btn ghost", type: "button", onclick: () => { stopWorker(); app.loading = false; renderAll(); } }, "Abbrechen"));
  }

  function paintProgress() {
    if (!el.barFill) return;
    const progress = Chat.progressOf(app.files, app.runtime.bytes);
    const percent = Math.round(progress.fraction * 100);
    el.barFill.style.width = `${percent}%`;
    el.barBox.setAttribute("aria-valuenow", String(percent));
    if (progress.fraction >= 0.995) { el.barText.textContent = "Fast fertig: das Modell wird gestartet. Beim ersten Mal dauert das einen Moment."; return; }
    const left = Chat.remaining(progress.loaded, progress.total, (performance.now() - app.started) / 1000);
    el.barText.textContent = `${Chat.formatBytes(progress.loaded)} von ${Chat.formatBytes(progress.total)} (${percent} %)${left ? ` · ${left}` : ""}`;
  }

  function problemCard() {
    return h("div", { class: "thread-inner center-card" }, icon("warn"), h("h2", {}, "Das Modell läuft nicht"), h("p", { class: "muted" }, app.problem),
      h("div", { class: "row" }, h("button", { class: "btn primary", type: "button", onclick: startLoading }, "Noch einmal versuchen"),
        h("button", { class: "btn ghost", type: "button", onclick: () => { app.problem = ""; renderAll(); } }, "Anderes Modell wählen")));
  }

  // ------------------------------------------------------------------------------------------------------ chat
  function welcome() {
    return h("div", { class: "thread-inner welcome" },
      h("div", { class: "welcome-logo" }, logo()),
      h("h1", {}, "Womit kann ich helfen?"),
      h("div", { class: "suggestions" }, Chat.suggestionsFor(app.model).map((text) => h("button", { class: "suggestion", type: "button", onclick: () => submit(text) }, text))));
  }

  function buildComposer() {
    app.input = h("textarea", { class: "composer-input", rows: "1", maxlength: String(Chat.MAX_INPUT), placeholder: "Schreib eine Nachricht …", "aria-label": "Deine Nachricht", enterkeyhint: "send",
      oninput: () => { grow(); paintSend(); },
      onkeydown: (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } } });
    el.send = h("button", { class: "send", type: "button", onclick: () => (app.busy ? app.worker?.postMessage({ type: "stop" }) : submit()) });
    el.composer = h("div", { class: "composer" },
      h("div", { class: "composer-box" }, app.input, el.send),
      h("p", { class: "composer-note" }, "KI-Regal läuft auf deinem Gerät, nichts wird gesendet. KI kann Fehler machen."));
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

  function renderBottom() {
    const chat = activeChat();
    if (app.ready) {
      fill(el.bottom, app.savedNote ? h("p", { class: "notice save-note" }, icon("info"), "Dein Browser hat das Modell nicht gespeichert (vielleicht ist zu wenig Platz frei). Beim nächsten Mal muss es noch einmal geladen werden.") : null, el.composer);
    } else if (chat && chat.messages.length && !app.loading && !app.problem) {
      fill(el.bottom, h("div", { class: "loadbar" }, h("span", {}, "Starte ein Modell, um in diesem Chat weiterzuschreiben."), h("button", { class: "btn primary small", type: "button", onclick: startLoading }, "Modell starten")));
    } else {
      fill(el.bottom);
    }
  }

  function renderThread() {
    const chat = activeChat();
    if (app.loading) { fill(el.thread, loadingCard()); paintProgress(); return; }
    if (app.problem) { fill(el.thread, problemCard()); return; }
    if (chat && chat.messages.length) { paintMessages(chat); return; }
    fill(el.thread, app.ready ? welcome() : setupCard());
  }

  function renderAll() {
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

  function submit(text) {
    const message = (text == null ? app.input.value : text).trim();
    if (!message || app.busy || !app.ready || !app.worker) return;
    let chat = activeChat();
    const fresh = !chat;
    if (!chat) {
      chat = { id: Chat.newChatId(), title: Chat.titleFrom(message), updated: Date.now(), messages: [] };
      app.chats.unshift(chat);
      app.activeId = chat.id;
    }
    chat.messages.push({ role: "user", content: message });
    chat.updated = Date.now();
    app.input.value = "";
    grow();
    saveChats();
    renderSidebar();
    if (fresh || !el.list || !el.list.isConnected) paintMessages(chat); else { put(el.list, messageNode(chat.messages[chat.messages.length - 1], false)); follow(true); }
    answer(chat);
  }

  /* The model starts writing the next answer of `chat` (its last message is the question). */
  function answer(chat) {
    el.list.querySelectorAll(".regen").forEach((button) => button.remove());                // only the newest answer can be written again
    const body = h("div", { class: "answer streaming" }, h("span", { class: "typing", "aria-label": "Die KI schreibt" }, h("i"), h("i"), h("i")));
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
    fill(root, h("div", { class: "page loading" }, h("div", { class: "spinner" }), h("p", {}, "Die Seite wird vorbereitet …")));
    try {
      if (!supported()) throw new Error("unsupported");
      const response = await fetch(root.dataset.models, { credentials: "omit" });
      if (!response.ok) throw new Error(`Fehler ${response.status}`);
      app.models = (await response.json()).models;
      app.gpu = await probeGpu();
      app.cached = await findCached();
      app.model = Chat.defaultModel(app.models, app.gpu, remembered());
      app.runtime = Chat.chooseRuntime(app.gpu, app.model);
      loadChats();
      buildShell();
      renderAll();
    } catch (error) {
      console.error(error);
      const old = error && error.message === "unsupported";
      fill(root, h("div", { class: "page loading" }, icon("warn"), h("h2", {}, old ? "Dein Browser ist zu alt" : "Die Seite konnte nicht geladen werden"),
        h("p", {}, old ? "Für den Chat brauchst du einen aktuellen Browser, zum Beispiel Chrome, Edge, Firefox oder Safari." : "Prüfe deine Verbindung und versuche es noch einmal."),
        old ? null : h("button", { class: "btn primary", type: "button", onclick: boot }, "Noch einmal")));
    }
    document.querySelector(".skip")?.addEventListener("click", (event) => { event.preventDefault(); el.thread?.focus(); });
  }

  boot();
})();
