/* Pulse Nex: the page of the assistant (/i/nex), made like the ChatGPT app -- a round button for the list of conversations at the top left, a
   round "..." button at the top right, your questions as grey bubbles on the right, the answers as plain text, a floating input at the bottom.
   You can have many conversations; they stay in this browser (localStorage, for the signed-in person only). The server gets the last turns of the
   one you are in, passes them to the AI service and keeps nothing. "Mit Nex erklären" on a post opens a fresh conversation with that post
   (/i/nex?post=ID). What Nex writes is put on the page as text (richText makes the links), never as HTML. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, toast, confirmBox, menu } = Y;

  const KEY = "yipi.nex";
  const SUGGESTIONS = [
    "Schreib mir einen lustigen Beitrag über Montage",
    "Erkläre mir in zwei Sätzen, wie ein Akku funktioniert",
    "Gib mir drei Ideen für einen Beitrag über Fotografie",
    "Was kann ich heute Abend kochen?",
    "Übersetze „Guten Morgen“ ins Spanische",
  ];
  const EXPLAIN = "Erkläre diesen Beitrag kurz und verständlich: Worum geht es, und was könnte gemeint sein?";

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
    let store = Core.nexStore(Y.readJson(KEY, null), me.handle);
    const blank = () => ({ id: Core.newChatId(), title: "", at: Date.now(), messages: [] });
    let chat = store.chats.find((entry) => entry.id === store.current) || blank();
    let controller = null;
    let busy = false;

    const thread = h("div", { class: "nex-thread", role: "log", "aria-live": "polite", "aria-label": "Gespräch mit Nex" });
    const intro = h("div", { class: "nex-intro" },
      h("span", { class: "nex-hero" }, icon("nexmark")),
      h("h2", {}, "Wobei kann ich helfen?"),
      h("p", {}, "Frag mich etwas, lass dir einen Beitrag erklären oder hol dir Hilfe beim Schreiben."));
    const chips = h("div", { class: "nex-chips" }, SUGGESTIONS.map((text) => h("button", { class: "nex-suggestion", type: "button", onclick: () => ask(text) }, text)));
    const input = h("textarea", { class: "nex-input", rows: 1, maxlength: 1500, placeholder: "Frag Nex etwas", "aria-label": "Nachricht an Nex" });
    const plus = h("button", { class: "icon-btn nex-plus", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, icon("plus"));
    const sendButton = h("button", { class: "icon-btn send-btn", type: "button", "aria-label": "Senden", disabled: true }, icon("arrowUp"));
    const stopButton = h("button", { class: "icon-btn send-btn stop", type: "button", "aria-label": "Antwort stoppen", hidden: true }, icon("stop"));
    const composeBar = h("div", { class: "nex-compose" },
      chips,
      h("div", { class: "nex-box" }, plus, input, sendButton, stopButton),
      h("p", { class: "nex-note" }, "Nex kann Fehler machen. Prüfe Wichtiges nach."));
    const historyButton = h("button", { class: "icon-btn round", type: "button", "aria-label": "Gespräche und Menü", "aria-haspopup": "dialog", onclick: () => openHistory() }, icon("menuLines"));
    const moreButton = h("button", { class: "icon-btn round", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, icon("more"));
    const postBox = h("div", { class: "nex-post-box", hidden: true });
    const head = h("div", { class: "nex-head" }, historyButton, h("span", { class: "nex-title" }, "Nex"), moreButton);
    const scroller = h("div", { class: "nex-scroll" }, intro, thread);
    const side = h("aside", { class: "nex-side", "aria-label": "Gespräche mit Nex" });         // the list of conversations, always there on a wide screen
    const el = h("div", { class: "view nex-view" }, side, h("div", { class: "nex-main" }, head, postBox, scroller, composeBar));

    /* On a wide screen the conversation scrolls inside its own box, on a phone the whole page scrolls (the style sheet switches at 1000 px). */
    const wide = () => matchMedia("(min-width: 1000px)").matches;
    const toBottom = () => { if (wide()) scroller.scrollTop = scroller.scrollHeight; else window.scrollTo({ top: document.documentElement.scrollHeight }); };
    const nearBottom = () => (wide() ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 220 : document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 220);

    /* The conversation is kept (and put first in the list) as soon as it has a message. */
    function save() {
      if (!chat.messages.length) return;
      const first = chat.messages.find((message) => message.role === "user");
      chat = { ...chat, title: chat.title || Core.nexTitle(first ? first.content : ""), at: Date.now(), messages: Core.nexMessages(chat.messages, Core.NEX_KEEP) };
      store = Core.nexUpsert(store, chat);
      Y.writeJson(KEY, store);
      redrawHistory();
    }

    function blocksOf(text, into) {
      fill(into, ...Core.nexBlocks(text).map((block) => (block.type === "list"
        ? h("ul", { class: "nex-list" }, block.items.map((item) => h("li", {}, richText(item))))
        : h("p", { class: "nex-p" }, richText(block.text)))));
    }

    function actions(message, index) {
      const copy = h("button", { class: "nex-act", type: "button", onclick: async () => {
        try { await navigator.clipboard.writeText(message.content); toast("Text kopiert"); } catch (error) { window.prompt("Diesen Text kannst du kopieren:", message.content); }
      } }, "Kopieren");
      const asPost = h("button", { class: "nex-act", type: "button", onclick: () => Y.compose({ text: message.content.slice(0, Core.MAX_POST) }) }, "Als Beitrag");
      const again = h("button", { class: "nex-act", type: "button", onclick: () => regenerate(index) }, "Neu antworten");
      return h("div", { class: "nex-actions" }, copy, asPost, index === chat.messages.length - 1 ? again : null);
    }

    function row(message, index) {
      if (message.role === "user") return h("div", { class: "nex-msg user" }, h("div", { class: "nex-bubble" }, h("p", { class: "nex-p" }, message.content)));
      const bubble = h("div", { class: "nex-bubble" });
      blocksOf(message.content, bubble);
      return h("div", { class: "nex-msg assistant" }, h("div", { class: "nex-col" }, bubble, actions(message, index)));
    }

    function draw() {
      const empty = chat.messages.length === 0 && !postBox.children.length;
      intro.hidden = !empty;
      chips.hidden = !empty;
      fill(thread, ...chat.messages.map(row));
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

    /* Asks Nex: the question goes into the conversation, the answer streams in below it. `extra` (postId) is sent along. */
    async function ask(text, extra = {}) {
      const question = Core.cleanText(text);
      if (!question || busy) return;
      chat.messages.push({ role: "user", content: question });
      input.value = "";
      save();
      draw();
      await answer(extra);
    }

    async function answer(extra = {}) {
      setBusy(true);
      intro.hidden = true;
      chips.hidden = true;
      const bubble = h("div", { class: "nex-bubble" }, h("span", { class: "nex-typing", "aria-label": "Nex schreibt" }, h("i"), h("i"), h("i")));
      const holder = h("div", { class: "nex-msg assistant" }, h("div", { class: "nex-col" }, bubble));
      put(thread, holder);
      toBottom();
      controller = new AbortController();
      const mine = chat.id;
      const result = await stream({ messages: Core.nexMessages(chat.messages), ...extra }, (soFar) => {
        if (chat.id !== mine) return;
        const stick = nearBottom();
        blocksOf(soFar, bubble);
        if (stick) toBottom();
      }, controller.signal);
      controller = null;
      setBusy(false);
      if (chat.id !== mine) return;                      // another conversation was opened meanwhile
      const written = Core.cleanText(result.text || "");
      if (written) {
        chat.messages.push({ role: "assistant", content: written });
        save();
        draw();
      } else if (result.aborted) {
        holder.remove();
      } else {
        fill(bubble, h("p", { class: "nex-p nex-problem" }, problem(result)));
      }
      if (result.error && written) toast(problem(result));
    }

    function regenerate(index) {
      if (busy || index !== chat.messages.length - 1) return;
      chat.messages.pop();
      save();
      draw();
      answer();
    }

    // ---- conversations
    function open(next) {
      if (busy) controller?.abort();
      chat = next;
      postBox.hidden = true;
      fill(postBox);
      draw();
      redrawHistory();
      if (!wide()) window.scrollTo(0, 0);
      if (chat.messages.length) requestAnimationFrame(toBottom);
    }

    function newChat() {
      if (!chat.messages.length) { input.focus(); return; }
      open(blank());
      input.focus();
    }

    async function removeChat(entry) {
      if (!(await confirmBox({ title: "Gespräch löschen?", text: `„${entry.title}“ wird in diesem Browser gelöscht.`, yes: "Löschen", danger: true }))) return false;
      store = Core.nexRemove(store, entry.id);
      Y.writeJson(KEY, store);
      if (entry.id === chat.id) open(blank());
      redrawHistory();
      return true;
    }

    /* The content of the list of conversations: in a panel from the left on a phone, permanently at the side on a wide screen. */
    const redraws = new Set();
    function redrawHistory() { for (const redraw of redraws) redraw(); }
    function historyContent(close, onGone) {
      const list = h("div", { class: "nx-list" });
      const page = (path, name, label) => link(path, { class: "drawer-item" }, icon(name), h("span", {}, label));
      function drawList(first) {
        if (!first && onGone && !list.isConnected) { onGone(redraw); return; }            // the panel was closed meanwhile
        fill(list, ...(store.chats.length ? store.chats.map((entry) => h("div", { class: `nx-item${entry.id === chat.id ? " on" : ""}` },
          h("button", { class: "nx-open", type: "button", onclick: () => { close(); open(entry); } }, entry.title),
          h("button", { class: "icon-btn small nx-del", type: "button", "aria-label": `Gespräch „${entry.title}“ löschen`, onclick: () => { removeChat(entry); } }, icon("trash"))))
          : [h("p", { class: "nx-empty" }, "Noch keine Gespräche.")]));
      }
      const redraw = () => drawList(false);
      drawList(true);
      redraws.add(redraw);
      return [
        h("div", { class: "nx-top" }, h("b", {}, "Nex"), close === noClose ? null : h("button", { class: "icon-btn", type: "button", "aria-label": "Schließen", onclick: close }, icon("close"))),
        h("button", { class: "nx-new", type: "button", onclick: () => { close(); newChat(); } }, icon("pencil"), h("span", {}, "Neues Gespräch")),
        h("div", { class: "nx-label" }, "Gespräche"), list,
        close === noClose ? null : h("nav", { class: "nx-links drawer-nav", "aria-label": "Pulse" }, page(Y.HOME, "home", "Home"), page("/messages", "users", "Chats"), page("/games", "gamepad", "Games"), page("/videos", "playCircle", "Videos"))];
    }
    const noClose = () => {};
    fill(side, ...historyContent(noClose));

    function openHistory() {
      Y.sidePanel("Nex: Gespräche", (panel, close) => {
        panel.append(...historyContent(close, (redraw) => redraws.delete(redraw)));
      }, "nex-drawer");
    }

    plus.addEventListener("click", () => menu(plus, [
      { label: "Neues Gespräch", icon: "pencil", run: newChat },
      { label: "Gespräche anzeigen", icon: "list", run: openHistory },
    ]));
    moreButton.addEventListener("click", () => menu(moreButton, [
      { label: "Neues Gespräch", icon: "pencil", run: newChat },
      { label: "Gespräche anzeigen", icon: "list", run: openHistory },
      chat.messages.length ? { label: "Dieses Gespräch löschen", icon: "trash", danger: true, run: () => removeChat(chat) } : null,
      store.chats.length ? { label: "Alle Gespräche löschen", icon: "trash", danger: true, run: async () => {
        if (!(await confirmBox({ title: "Alle Gespräche löschen?", text: "Alle Gespräche mit Nex werden in diesem Browser gelöscht.", yes: "Alle löschen", danger: true }))) return;
        store = { ...store, chats: [], current: "" };
        Y.writeJson(KEY, store);
        open(blank());
      } } : null,
    ]));

    input.addEventListener("input", update);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && matchMedia("(pointer: fine)").matches) { event.preventDefault(); ask(input.value); } });
    sendButton.addEventListener("click", () => ask(input.value));
    stopButton.addEventListener("click", () => controller?.abort());

    // ---- a post to explain, or a question from the address (?q=)
    function startFromRoute() {
      const marker = `${KEY}.start.${route.post || route.q}`;
      let done = false;
      try { done = sessionStorage.getItem(marker) === "1"; sessionStorage.setItem(marker, "1"); } catch (error) { /* storage blocked */ }
      if (done) return;
      if (route.post) {
        Api.get(`/posts/${route.post}`).then((reply) => {
          if (!reply.ok || reply.data.post.deleted || !reply.data.post.user) return;
          const post = reply.data.post;
          if (chat.messages.length) chat = blank();
          postBox.hidden = false;
          fill(postBox, h("div", { class: "nex-post" }, h("div", { class: "nex-post-head" }, avatar(post.user, "sm"), h("b", {}, post.user.name), h("span", { class: "handle" }, `@${post.user.handle}`)),
            post.text ? h("p", { class: "nex-post-text" }, richText(post.text)) : null, link(Y.postPath(post), { class: "tok" }, "Zum Beitrag")));
          chat.messages.push({ role: "user", content: EXPLAIN });
          save();
          draw();
          answer({ postId: post.id });
        });
      } else if (route.q) {
        if (chat.messages.length) chat = blank();
        ask(route.q);
      }
    }

    draw();
    update();
    startFromRoute();
    setTimeout(() => { if (chat.messages.length) toBottom(); }, 0);
    return { element: el, title: "Nex", destroy() { controller?.abort(); } };
  };
})();
