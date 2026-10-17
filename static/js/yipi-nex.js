/* Pulse Nex: the page of the assistant (/i/nex). A simple chat: you write, Nex answers word by word. The conversation stays in this
   browser (localStorage, for the signed-in person only); the server gets the last turns, passes them to the AI service and keeps
   nothing. "Mit Nex erklären" on a post opens this page with the post (/i/nex?post=ID), the search of the right column with a question
   (/i/nex?q=...). What Nex writes is put on the page as text (richText makes the links), never as HTML. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, toast, confirmBox } = Y;

  const KEY = "yipi.nex";
  const SUGGESTIONS = [
    "Schreib mir einen lustigen Beitrag über Montage",
    "Erkläre mir in zwei Sätzen, wie ein Akku funktioniert",
    "Gib mir drei Ideen für einen Beitrag über Fotografie",
    "Was kann ich heute Abend kochen?",
    "Übersetze „Guten Morgen“ ins Spanische",
  ];
  const EXPLAIN = "Erkläre diesen Beitrag kurz und verständlich: Worum geht es, und was könnte gemeint sein?";

  const orb = () => h("span", { class: "nex-orb", "aria-hidden": "true" }, icon("sparkleFill"));

  /* One answer of the server as a stream of text: onText(textSoFar) after every piece. Resolves {text, error?, status?, aborted?}. */
  async function stream(payload, onText, signal) {
    let response;
    try {
      response = await fetch("/api/yipi/nex", { method: "POST", credentials: "same-origin", signal, headers: { "Content-Type": "application/json", Accept: "text/plain" }, body: JSON.stringify(payload) });
    } catch (error) {
      return error && error.name === "AbortError" ? { text: "", aborted: true } : { text: "", error: "network" };
    }
    if (!response.ok) {
      let data = {};
      try { data = await response.json(); } catch (error) { data = {}; }
      return { text: "", error: data.error || "bad_request", status: response.status };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        onText(text);
      }
      text += decoder.decode();
    } catch (error) {
      return { text, aborted: !!(error && error.name === "AbortError"), error: error && error.name === "AbortError" ? undefined : "network" };
    }
    return { text };
  }

  Y.views.nex = function nex(route, ctx) {
    const me = Y.me;
    const read = () => {
      const saved = Y.readJson(KEY, null);
      return saved && me && saved.handle === me.handle ? Core.nexMessages(saved.messages, Core.NEX_KEEP) : [];
    };
    let messages = read();
    let controller = null;
    let busy = false;

    const thread = h("div", { class: "nex-thread", role: "log", "aria-live": "polite", "aria-label": "Gespräch mit Nex" });
    const intro = h("div", { class: "nex-intro" },
      h("span", { class: "nex-hero" }, icon("sparkleFill")),
      h("h2", {}, "Hi, ich bin Nex."),
      h("p", {}, "Frag mich etwas, lass dir einen Beitrag erklären oder hol dir Hilfe beim Schreiben."),
      h("div", { class: "nex-suggestions" }, SUGGESTIONS.map((text) => h("button", { class: "nex-suggestion", type: "button", onclick: () => ask(text) }, text))));
    const input = h("textarea", { class: "nex-input", rows: 1, maxlength: 1500, placeholder: "Frag Nex etwas", "aria-label": "Nachricht an Nex" });
    const sendButton = h("button", { class: "icon-btn send-btn", type: "button", "aria-label": "Senden", disabled: true }, icon("send"));
    const stopButton = h("button", { class: "icon-btn send-btn stop", type: "button", "aria-label": "Antwort stoppen", hidden: true }, icon("stop"));
    const composeBar = h("div", { class: "nex-compose" },
      h("div", { class: "nex-compose-box" }, input, sendButton, stopButton),
      h("p", { class: "nex-note" }, "Nex kann Fehler machen. Prüfe Wichtiges nach. Das Gespräch bleibt nur in diesem Browser."));
    const fresh = h("button", { class: "icon-btn", type: "button", "aria-label": "Neues Gespräch", onclick: () => newChat() }, icon("pencil"));
    const postBox = h("div", { class: "nex-post-box", hidden: true });
    const el = h("div", { class: "view nex-view" }, Y.topbar({ title: "Nex", sub: "Die KI von Pulse", right: fresh }), postBox, h("div", { class: "nex-scroll" }, intro, thread), composeBar);

    const save = () => Y.writeJson(KEY, { handle: me.handle, messages: Core.nexMessages(messages, Core.NEX_KEEP) });
    const toBottom = () => window.scrollTo({ top: document.documentElement.scrollHeight });
    const nearBottom = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 220;

    function blocksOf(text, into) {
      fill(into, ...Core.nexBlocks(text).map((block) => (block.type === "list"
        ? h("ul", { class: "nex-list" }, block.items.map((item) => h("li", {}, richText(item))))
        : h("p", { class: "nex-p" }, richText(block.text)))));
    }

    function actions(message, bubble, index) {
      const copy = h("button", { class: "nex-act", type: "button", onclick: async () => {
        try { await navigator.clipboard.writeText(message.content); toast("Text kopiert"); } catch (error) { window.prompt("Diesen Text kannst du kopieren:", message.content); }
      } }, "Kopieren");
      const asPost = h("button", { class: "nex-act", type: "button", onclick: () => Y.compose({ text: message.content.slice(0, Core.MAX_POST) }) }, "Als Beitrag verwenden");
      const again = h("button", { class: "nex-act", type: "button", onclick: () => regenerate(index) }, "Neu antworten");
      return h("div", { class: "nex-actions" }, copy, asPost, index === messages.length - 1 ? again : null);
    }

    function row(message, index) {
      if (message.role === "user") return h("div", { class: "nex-msg user" }, h("div", { class: "nex-bubble" }, h("p", { class: "nex-p" }, message.content)));
      const bubble = h("div", { class: "nex-bubble" });
      blocksOf(message.content, bubble);
      return h("div", { class: "nex-msg assistant" }, orb(), h("div", { class: "nex-col" }, bubble, actions(message, bubble, index)));
    }

    function draw() {
      intro.hidden = messages.length > 0 || !!postBox.children.length;
      fill(thread, ...messages.map(row));
    }

    function update() {
      sendButton.disabled = busy || !Core.cleanText(input.value);
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
    }

    function setBusy(on) {
      busy = on;
      sendButton.hidden = on;
      stopButton.hidden = !on;
      input.disabled = on;
      update();
    }

    const problem = (result) => (result.status === 429 || result.error === "too_many" ? "Du hast Nex gerade viel gefragt. Warte einen Moment und versuch es dann noch einmal."
      : result.error === "network" ? Api.MESSAGES.network : result.status === 401 ? Api.MESSAGES.not_logged_in : "Nex konnte gerade nicht antworten. Versuch es gleich noch einmal.");

    /* Asks Nex: the question goes into the conversation, the answer streams into a new bubble. `extra` (postId) is sent along. */
    async function ask(text, extra = {}) {
      const question = Core.cleanText(text);
      if (!question || busy) return;
      messages.push({ role: "user", content: question });
      input.value = "";
      save();
      draw();
      await answer(extra);
    }

    async function answer(extra = {}) {
      setBusy(true);
      intro.hidden = true;
      const bubble = h("div", { class: "nex-bubble" }, h("span", { class: "nex-typing", "aria-label": "Nex schreibt" }, h("i"), h("i"), h("i")));
      const holder = h("div", { class: "nex-msg assistant" }, orb(), h("div", { class: "nex-col" }, bubble));
      put(thread, holder);
      toBottom();
      controller = new AbortController();
      const result = await stream({ messages: Core.nexMessages(messages), ...extra }, (soFar) => {
        const stick = nearBottom();
        blocksOf(soFar, bubble);
        if (stick) toBottom();
      }, controller.signal);
      controller = null;
      setBusy(false);
      const written = Core.cleanText(result.text || "");
      if (written) {
        messages.push({ role: "assistant", content: written });
        save();
        draw();
      } else if (result.aborted) {
        holder.remove();
      } else {
        fill(bubble, h("p", { class: "nex-p nex-problem" }, problem(result)));
      }
      if (result.error && written) toast(problem(result));
      input.focus();
    }

    function regenerate(index) {
      if (busy || index !== messages.length - 1) return;
      messages.pop();
      save();
      draw();
      answer();
    }

    async function newChat() {
      if (busy) controller?.abort();
      if (messages.length && !(await confirmBox({ title: "Neues Gespräch?", text: "Das aktuelle Gespräch wird in diesem Browser gelöscht.", yes: "Neu beginnen", danger: true }))) return;
      messages = [];
      save();
      postBox.hidden = true;
      fill(postBox);
      draw();
      input.focus();
    }

    input.addEventListener("input", update);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && matchMedia("(pointer: fine)").matches) { event.preventDefault(); ask(input.value); } });
    sendButton.addEventListener("click", () => ask(input.value));
    stopButton.addEventListener("click", () => controller?.abort());

    // ---- a post to explain, or a question from the search box
    function startFromRoute() {
      const marker = `${KEY}.start.${route.post || route.q}`;
      let done = false;
      try { done = sessionStorage.getItem(marker) === "1"; sessionStorage.setItem(marker, "1"); } catch (error) { /* storage blocked */ }
      if (route.post) {
        Api.get(`/posts/${route.post}`).then((reply) => {
          if (!reply.ok || reply.data.post.deleted || !reply.data.post.user) return;
          const post = reply.data.post;
          postBox.hidden = false;
          fill(postBox, h("div", { class: "nex-post" }, h("div", { class: "nex-post-head" }, avatar(post.user, "sm"), h("b", {}, post.user.name), h("span", { class: "handle" }, `@${post.user.handle}`)),
            post.text ? h("p", { class: "nex-post-text" }, richText(post.text)) : null, link(Y.postPath(post), { class: "tok" }, "Zum Beitrag")));
          intro.hidden = true;
          if (!done) { messages.push({ role: "user", content: EXPLAIN }); save(); draw(); answer({ postId: post.id }); }
        });
      } else if (route.q && !done) {
        ask(route.q);
      }
    }

    draw();
    update();
    startFromRoute();
    setTimeout(() => { if (!route.post && !route.q) input.focus({ preventScroll: true }); if (messages.length) toBottom(); }, 0);
    return { element: el, title: "Nex", destroy() { controller?.abort(); } };
  };

  /* Opens Nex with a question that is asked at once (even if the same one was asked before in this session). */
  Y.nexAsk = (question) => {
    const text = Core.cleanText(question).slice(0, 500);
    if (!text) { Y.navigate("/i/nex"); return; }
    try { sessionStorage.removeItem(`${KEY}.start.${text}`); } catch (error) { /* storage blocked */ }
    Y.navigate(Core.buildPath({ name: "nex", q: text }));
  };
})();
