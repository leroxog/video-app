/* Nex Ai, five agents: one question runs through five short, real passes of an AI on this site's own server (Groq, see ai_assistant.py)
   -- four agents each write their own independent answer, a fifth reads all four and writes the one the visitor sees -- and every
   word of every pass streams to the page exactly as it is written. Nothing runs on the visitor's own computer any more and there is
   nothing to download; the question itself does leave the device this time (to this server, and from there to Groq), which is new
   and is said plainly on the page and in the privacy notice. The agents are collapsed behind an "In Bearbeitung" row by default; a
   visitor who wants to watch them work opens it. Five is the real, honest count -- not the "10 Millionen" the idea first asked for,
   which no server could actually run for every question; the page says so. */
(function () {
  "use strict";

  const { h, fill, icon, logo, copyText, toast } = window.Regal;
  const Chat = window.RegalChatCore;
  const ASK_URL = "/api/agents/ask";
  const ORDER = ["direkt", "gruendlich", "kritisch", "praktisch"];
  const LABELS = { direkt: "Agent · direkt", gruendlich: "Agent · gründlich", kritisch: "Agent · kritisch", praktisch: "Agent · praktisch" };

  const app = { question: "", agents: {}, final: "", busy: false, done: false, expanded: false, error: "", controller: null };
  const el = {};
  let root = null;
  let frame = 0;

  function supported() { return "fetch" in window && typeof ReadableStream !== "undefined"; }

  // ------------------------------------------------------------------------------------------------------ the frame
  function buildShell() {
    el.top = h("header", { class: "topbar" });
    el.thread = h("main", { class: "thread", id: "main", tabindex: "-1" });
    el.bottom = h("div", { class: "bottom" });
    el.stage = h("div", { class: "stage" }, el.thread, el.bottom);
    fill(root, h("div", { class: "shell" }, h("div", { class: "main-col" }, el.top, el.stage)));
    buildComposer();
    renderAll();
  }

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
    fill(el.top, h("a", { class: "side-logo", href: "/", "aria-label": "Nex Ai, Startseite" }, logo()),
      h("b", { class: "top-name" }, "Nex Ai"),
      h("span", { class: "top-status", title: status }, h("span", { class: `dot ${state}`, "aria-hidden": "true" }), status ? h("span", {}, status) : null),
      h("span", { class: "grow" }),
      app.question ? h("button", { class: "icon-btn", type: "button", "aria-label": "Neue Frage", title: "Neue Frage", onclick: newQuestion }, icon("plus")) : null);
  }

  function suggestionRow() {
    if (!el.suggest) el.suggest = h("div", { class: "suggestions" }, Chat.SUGGESTIONS.map((text) => h("button", { class: "suggestion", type: "button", onclick: () => ask(text) }, text)));
    return el.suggest;
  }

  function renderBottom() {
    fill(el.bottom, el.composer, !app.question ? suggestionRow() : null);
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

  function renderThread() {
    if (!app.question) { fill(el.thread, welcome()); el.stage.classList.add("is-empty"); return; }
    el.stage.classList.remove("is-empty");
    el.agentBodies = {};
    const started = ORDER.some((key) => key in app.agents);
    const showFinal = app.final || app.done || app.currentRole === "final";
    el.list = h("div", { class: "msgs", role: "log", "aria-live": "polite", "aria-label": "Die Agenten" },
      h("div", { class: "msg user" }, h("div", { class: "bubble" }, app.question)),
      started || app.busy ? statusRow() : null,
      app.expanded ? h("div", { class: "transcript" },
        h("p", { class: "muted small notation-note" }, "Die vier Agenten schreiben sich in einer knappen Notiz-Sprache (Symbole statt Sätze) – effizienter, aber nicht auf Anhieb lesbar. Der fünfte übersetzt alles in die normale Antwort unten."),
        ORDER.map((key) => agentNode(key))) : null,
      app.error ? h("p", { class: "bad" }, icon("warn"), app.error) : null,
      showFinal ? finalNode() : null);
    fill(el.thread, h("div", { class: "thread-inner" }, el.list));
    follow(true);
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

  // ------------------------------------------------------------------------------------------------ the five passes
  function newQuestion() {
    if (app.busy) { toast("Warte, bis die Agenten fertig sind, oder drücke Stopp."); return; }
    app.question = ""; app.agents = {}; app.final = ""; app.done = false; app.expanded = false; app.error = "";
    renderAll();
    app.input?.focus({ preventScroll: true });
  }

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

  async function ask(text) {
    const question = (text == null ? app.input.value : text).trim();
    if (!question || app.busy) return;
    app.question = question; app.agents = {}; app.final = ""; app.done = false; app.expanded = false; app.error = "";
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
    } catch (error) {
      if (error && error.name === "AbortError") { /* the visitor stopped it on purpose: nothing left to say */ }
      else app.error = error && error.message ? error.message : "Das hat nicht geklappt. Versuch es noch einmal.";
    } finally {
      app.busy = false; app.currentRole = null; app.controller = null;
      paintSend();
      renderTop();
      renderThread();
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
