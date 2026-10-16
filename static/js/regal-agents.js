/* Nex Ai, five agents: one question runs through five short, real passes of an AI on this site's own server (Groq, see ai_assistant.py)
   -- four agents each write their own independent answer, in a terse notation only they (and the fifth) are meant to read, then a
   fifth reads all four and writes the one the visitor sees -- and every word of every pass streams to the page exactly as it is
   written. Nothing runs on the visitor's own computer any more and there is nothing to download; the question itself does leave the
   device this time (to this server, and from there to Groq), which is said plainly on the page and in the privacy notice. The agents
   are collapsed behind an "In Bearbeitung" row by default; a visitor who wants to watch them work opens it. Five is the real, honest
   count -- not the "10 Millionen" the idea first asked for, which no server could actually run for every question.

   Earlier chats are kept (only in this browser, like the archived chat before it) so a visitor can come back to them; each one's
   title is a short AI-written summary that is asked for again after every answer, so it keeps matching where the chat ended up. */
(function () {
  "use strict";

  const { h, fill, icon, logo, copyText, toast, confirmBox } = window.Regal;
  const Chat = window.RegalChatCore;
  const ASK_URL = "/api/agents/ask";
  const TITLE_URL = "/api/agents/title";
  const CHATS_KEY = "regal.agents.chats";
  const ORDER = ["direkt", "gruendlich", "kritisch", "praktisch"];
  const LABELS = { direkt: "Agent · direkt", gruendlich: "Agent · gründlich", kritisch: "Agent · kritisch", praktisch: "Agent · praktisch" };

  const app = {
    chats: [], activeId: "",
    question: "", agents: {}, final: "", liveSaved: false,
    busy: false, done: false, expanded: false, error: "", controller: null, currentRole: null,
  };
  const el = {};
  let root = null;
  let frame = 0;

  function supported() { return "fetch" in window && typeof ReadableStream !== "undefined"; }

  // ---------------------------------------------------------------------------------------------------- storage
  function loadChats() {
    try { app.chats = Chat.sanitizeStore(localStorage.getItem(CHATS_KEY)).chats; } catch (error) { app.chats = []; }
  }
  function saveChats() {
    app.chats = Chat.trimChats(app.chats);
    const write = () => localStorage.setItem(CHATS_KEY, JSON.stringify({ chats: app.chats, active: app.activeId }));
    try { write(); } catch (error) {
      try { app.chats = app.chats.slice(0, Math.max(1, Math.floor(app.chats.length / 2))); write(); } catch (again) { /* storage full or not allowed: the chat still works, it just is not kept */ }
    }
  }
  const activeChat = () => app.chats.find((chat) => chat.id === app.activeId) || null;

  // ------------------------------------------------------------------------------------------------------ the frame
  function buildShell() {
    el.history = h("nav", { class: "history", "aria-label": "Frühere Chats" });
    el.side = h("aside", { class: "side", id: "side", "aria-label": "Seitenleiste" },
      h("div", { class: "side-head" },
        h("a", { class: "side-logo", href: "/", "aria-label": "Nex Ai, Startseite" }, logo()),
        h("button", { class: "icon-btn side-close", type: "button", "aria-label": "Seitenleiste schließen", onclick: closeDrawer }, icon("close"))),
      h("button", { class: "side-item new-chat", type: "button", onclick: newChat }, icon("edit"), "Neuer Chat"),
      el.history,
      h("div", { class: "side-foot" },
        h("button", { class: "side-link", type: "button", onclick: deleteAll }, icon("trash"), "Alle Chats löschen"),
        h("nav", { class: "legal-mini", "aria-label": "Mehr" }, h("a", { href: "/nutzungsbedingungen" }, "Bedingungen"), h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"))));
    el.top = h("header", { class: "topbar" });
    el.thread = h("main", { class: "thread", id: "main", tabindex: "-1" });
    el.bottom = h("div", { class: "bottom" });
    el.stage = h("div", { class: "stage" }, el.thread, el.bottom);
    el.shell = h("div", { class: "shell" }, el.side, h("div", { class: "backdrop", onclick: closeDrawer }), h("div", { class: "main-col" }, el.top, el.stage));
    fill(root, el.shell);
    buildComposer();
    loadChats();
    renderAll();
  }

  /* On a phone the side bar is a drawer: choosing something in it closes it (on a computer it stays). */
  function closeDrawer() { el.shell.classList.remove("side-open"); }
  function toggleSide() { el.shell.classList.toggle("side-open"); }

  function buildComposer() {
    app.input = h("textarea", { class: "composer-input", rows: "1", maxlength: String(Chat.MAX_INPUT), placeholder: "Frag die Agenten etwas", "aria-label": "Deine Frage", enterkeyhint: "send",
      oninput: () => { grow(); paintSend(); },
      onkeydown: (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); ask(); } } });
    el.send = h("button", { class: "send", type: "button", onclick: () => (app.busy ? stop() : ask()) });
    el.composer = h("div", { class: "composer" },
      h("div", { class: "composer-box" }, app.input, el.send),
      h("p", { class: "composer-note" }, "Fünf echte KI-Durchgänge arbeiten nacheinander an deiner Frage. Sie laufen auf unserem Server, nicht auf deinem Gerät: deine Frage wird dafür an Groq (siehe Datenschutz) gesendet."));
    paintSend();
  }

  function grow() { app.input.style.height = "auto"; app.input.style.height = `${Math.min(app.input.scrollHeight, 200)}px`; }
  function paintSend() {
    const empty = !app.input.value.trim();
    el.send.disabled = !app.busy && empty;
    el.send.setAttribute("aria-label", app.busy ? "Stoppen" : "Fragen");
    el.send.classList.toggle("stop", app.busy);
    fill(el.send, icon(app.busy ? "stop" : "send"));
  }

  function renderTop() {
    const state = app.busy ? "loading" : app.error ? "" : "ready";
    const status = app.busy ? "In Bearbeitung …" : app.error ? "" : "bereit";
    fill(el.top,
      h("button", { class: "icon-btn menu-btn", type: "button", "aria-label": "Chats", "aria-controls": "side", onclick: toggleSide }, icon("menu")),
      h("b", { class: "top-name" }, "Nex Ai"),
      h("span", { class: "top-status", title: status }, h("span", { class: `dot ${state}`, "aria-hidden": "true" }), status ? h("span", {}, status) : null),
      h("span", { class: "grow" }),
      app.question ? h("button", { class: "icon-btn", type: "button", "aria-label": "Neue Frage", title: "Neue Frage", onclick: newQuestion }, icon("plus")) : null);
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
    toast("Warte, bis die Agenten fertig sind, oder drücke Stopp.");
    return true;
  }

  function resetLive() { app.question = ""; app.agents = {}; app.final = ""; app.liveSaved = false; app.done = false; app.expanded = false; app.error = ""; }

  function newChat() {
    if (busyNow()) return;
    app.activeId = "";
    resetLive();
    closeDrawer();
    renderAll();
    app.input?.focus({ preventScroll: true });
  }
  function openChat(id) {
    if (busyNow()) return;
    closeDrawer();
    if (id === app.activeId) return;
    app.activeId = id;
    resetLive();
    renderAll();
  }
  async function deleteChat(id) {
    if (busyNow()) return;
    const chat = app.chats.find((c) => c.id === id);
    if (!chat || !(await confirmBox({ title: "Chat löschen?", text: `„${chat.title}“ wird von diesem Gerät gelöscht.`, yes: "Löschen", danger: true }))) return;
    app.chats = app.chats.filter((c) => c.id !== id);
    if (app.activeId === id) { app.activeId = ""; resetLive(); }
    saveChats();
    renderAll();
  }
  async function deleteAll() {
    if (busyNow()) return;
    if (!app.chats.length) { toast("Es gibt keine gespeicherten Chats."); return; }
    if (!(await confirmBox({ title: "Alle Chats löschen?", text: "Alle gespeicherten Chats werden von diesem Gerät gelöscht. Das kannst du nicht rückgängig machen.", yes: "Alle löschen", danger: true }))) return;
    app.chats = [];
    app.activeId = "";
    resetLive();
    saveChats();
    renderAll();
  }

  function suggestionRow() {
    if (!el.suggest) el.suggest = h("div", { class: "suggestions" }, Chat.SUGGESTIONS.map((text) => h("button", { class: "suggestion", type: "button", onclick: () => ask(text) }, text)));
    return el.suggest;
  }

  function renderBottom() {
    fill(el.bottom, el.composer, !app.question && !activeChat() ? suggestionRow() : null);
  }

  function welcome() {
    return h("div", { class: "thread-inner welcome" }, h("h1", {}, "Was sollen die Agenten klären?"),
      h("p", { class: "muted" }, "Fünf echte KI-Durchgänge arbeiten nacheinander daran und einigen sich auf die beste Antwort. Ohne Download, ohne Konto."));
  }

  // ------------------------------------------------------------------------------------------------------- the status row + transcript
  function toggleExpanded() {
    app.expanded = !app.expanded;
    renderThread();
  }

  function statusRow() {
    const label = app.busy ? "In Bearbeitung …" : app.error ? "Fehlgeschlagen" : "So haben die Agenten gearbeitet";
    return h("button", { class: "status-row", type: "button", "aria-expanded": String(app.expanded), onclick: toggleExpanded },
      app.busy ? h("span", { class: "spinner small", "aria-hidden": "true" }) : icon(app.error ? "warn" : "check"),
      h("span", { class: "status-label" }, label),
      h("span", { class: `chevron${app.expanded ? " open" : ""}`, "aria-hidden": "true" }, icon("down")));
  }

  /* An agent's content right now: its finished or still-growing text, a typing dot while it is the one currently writing, or
     "wartet …" for one whose turn has not come yet. */
  function agentContent(key) {
    const text = app.agents[key] || "";
    if (text) return Chat.parseBlocks(text).map(blockNode);
    if (key in app.agents) return h("span", { class: "typing", "aria-label": `${LABELS[key]} schreibt` }, h("i"));
    return h("span", { class: "muted small" }, "wartet …");
  }

  function agentNode(key) {
    const streaming = app.busy && app.currentRole === key;
    const body = h("div", { class: `answer${streaming ? " streaming" : ""}` }, agentContent(key));
    const node = h("div", { class: "msg bot agent-turn" }, h("div", { class: "bot-main" }, h("p", { class: "agent-label" }, LABELS[key]), body));
    el.agentBodies[key] = body;
    return node;
  }

  function finalNode() {
    const body = h("div", { class: `answer${app.busy ? " streaming" : ""}` }, app.final ? Chat.parseBlocks(app.final).map(blockNode) : h("span", { class: "typing", "aria-label": "Antwort wird geschrieben" }, h("i")));
    const meta = h("div", { class: "msg-meta" }, app.final && !app.busy ? h("button", { class: "act", type: "button", "aria-label": "Antwort kopieren", title: "Kopieren", onclick: async () => toast((await copyText(app.final)) ? "Kopiert." : "Kopieren hat nicht geklappt.") }, icon("copy")) : null);
    el.finalBody = body;
    return h("div", { class: "msg bot agent-turn agent-final" }, h("div", { class: "bot-main" }, h("p", { class: "agent-label" }, "Antwort"), body, meta));
  }

  /* A past, already-saved turn of the active chat (just the question and the plain final answer -- the four agents' notation is not
     kept, only the live, in-progress turn ever shows it). */
  function pastTurnNodes(question, answer) {
    return [
      h("div", { class: "msg user" }, h("div", { class: "bubble" }, question)),
      h("div", { class: "msg bot agent-turn agent-final" }, h("div", { class: "bot-main" }, h("p", { class: "agent-label" }, "Antwort"), h("div", { class: "answer" }, Chat.parseBlocks(answer).map(blockNode)))),
    ];
  }

  function renderThread() {
    const chat = activeChat();
    if (!app.question && !chat) { fill(el.thread, welcome()); el.stage.classList.add("is-empty"); return; }
    el.stage.classList.remove("is-empty");
    el.agentBodies = {};
    const past = [];
    if (chat) {
      const msgs = chat.messages;
      const upto = app.question && app.liveSaved ? msgs.length - 2 : msgs.length;     // the live turn below repeats the last pair once it is saved
      for (let i = 0; i + 1 < upto; i += 2) past.push(...pastTurnNodes(msgs[i].content, msgs[i + 1].content));
    }
    const live = [];
    if (app.question) {
      const started = ORDER.some((key) => key in app.agents);
      const showFinal = app.final || app.done || app.currentRole === "final";
      live.push(h("div", { class: "msg user" }, h("div", { class: "bubble" }, app.question)));
      if (started || app.busy) live.push(statusRow());
      if (app.expanded) live.push(h("div", { class: "transcript" },
        h("p", { class: "muted small notation-note" }, "Die vier Agenten schreiben sich in einer knappen Notiz-Sprache (Symbole statt Sätze) – effizienter, aber nicht auf Anhieb lesbar. Der fünfte übersetzt alles in die normale Antwort unten."),
        ORDER.map((key) => agentNode(key))));
      if (app.error) live.push(h("p", { class: "bad" }, icon("warn"), app.error));
      if (showFinal) live.push(finalNode());
    }
    el.list = h("div", { class: "msgs", role: "log", "aria-live": "polite", "aria-label": "Die Agenten" }, past, live);
    fill(el.thread, h("div", { class: "thread-inner" }, el.list));
    follow(true);
  }

  function renderAll() { renderTop(); renderSidebar(); renderThread(); renderBottom(); }

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

  // ------------------------------------------------------------------------------------------------ the five passes
  function newQuestion() { newChat(); }

  function stop() {
    app.controller?.abort();
  }

  async function streamInto(role, message, agents, onChunk) {
    const response = await fetch(ASK_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", signal: app.controller.signal,
      body: JSON.stringify({ role, message, agents }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error === "rate_limited" ? "Zu viele Fragen in kurzer Zeit. Versuch es gleich noch einmal." : `Fehler ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  }

  function paintStreaming() {
    frame = 0;
    const stick = atBottom();
    for (const key of ORDER) {
      const body = el.agentBodies && el.agentBodies[key];
      if (body && body.isConnected) fill(body, agentContent(key));
    }
    if (el.finalBody && el.finalBody.isConnected) fill(el.finalBody, app.final ? Chat.parseBlocks(app.final).map(blockNode) : h("span", { class: "typing", "aria-label": "Antwort wird geschrieben" }, h("i")));
    follow(stick);
  }

  function schedulePaint() { if (!frame) frame = requestAnimationFrame(paintStreaming); }

  /* Saves the just-finished turn into the open chat (making a new one if none is open yet) and asks for a fresh, short title -- the
     title is re-asked after every answer, not only the first one, so it keeps matching where the conversation ended up. */
  function saveTurn(question, answer) {
    let chat = activeChat();
    if (!chat) {
      chat = { id: Chat.newChatId(), title: Chat.titleFrom(question), updated: Date.now(), messages: [] };
      app.chats.unshift(chat);
      app.activeId = chat.id;
    }
    chat.messages.push({ role: "user", content: question }, { role: "assistant", content: answer });
    chat.updated = Date.now();
    app.liveSaved = true;
    saveChats();
    renderSidebar();
    regenerateTitle(chat);
  }

  async function regenerateTitle(chat) {
    try {
      const response = await fetch(TITLE_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "omit", body: JSON.stringify({ messages: chat.messages }) });
      if (!response.ok) return;
      const data = await response.json();
      if (data && data.title && activeChat() === chat) {
        chat.title = data.title;
        saveChats();
        renderSidebar();
      }
    } catch (error) { /* keeps the previous title -- a missing new one is never shown as an error */ }
  }

  async function ask(text) {
    const question = (text == null ? app.input.value : text).trim();
    if (!question || app.busy) return;
    app.question = question; app.agents = {}; app.final = ""; app.liveSaved = false; app.done = false; app.expanded = false; app.error = "";
    app.busy = true; app.controller = new AbortController();
    if (text == null) { app.input.value = ""; grow(); }
    paintSend();
    renderAll();
    try {
      for (const role of ORDER) {
        app.currentRole = role;
        app.agents[role] = "";
        renderThread();
        await streamInto(role, question, null, (chunk) => { app.agents[role] += chunk; schedulePaint(); });
        app.agents[role] = app.agents[role].trim();
      }
      app.currentRole = "final";
      renderThread();
      await streamInto("final", question, app.agents, (chunk) => { app.final += chunk; schedulePaint(); });
      app.final = app.final.trim();
      app.done = true;
      if (!app.final) app.error = "Dazu ist den Agenten nichts eingefallen. Frag noch einmal, vielleicht anders.";
      else saveTurn(question, app.final);
    } catch (error) {
      if (error && error.name === "AbortError") { /* the visitor stopped it on purpose: nothing left to say */ }
      else app.error = error && error.message ? error.message : "Das hat nicht geklappt. Versuch es noch einmal.";
    } finally {
      app.busy = false; app.currentRole = null; app.controller = null;
      paintSend();
      renderTop();
      renderThread();
      renderBottom();
    }
  }

  // ------------------------------------------------------------------------------------------------------ start
  function boot() {
    root = document.getElementById("app");
    if (!supported()) {
      fill(root, h("div", { class: "page loading" }, icon("warn"), h("h2", {}, "Dein Browser ist zu alt"), h("p", {}, "Für Nex Ai brauchst du einen aktuellen Browser, zum Beispiel Chrome, Edge, Firefox oder Safari.")));
      return;
    }
    buildShell();
    document.querySelector(".skip")?.addEventListener("click", (event) => { event.preventDefault(); el.thread?.focus(); });
  }

  boot();
})();
