/* Nex Nex: the page of the assistant (/i/nex), made like the ChatGPT app -- a round button for the list of conversations at the top left, a
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
  /* The suggestions under the empty page: five out of this pool, picked again every time a new conversation starts (and with the round arrow),
     never the same five twice in a row. */
  const POOL = [
    "Schreib mir einen lustigen Beitrag über Montage", "Erkläre mir in zwei Sätzen, wie ein Akku funktioniert", "Gib mir drei Ideen für einen Beitrag über Fotografie",
    "Was kann ich heute Abend kochen?", "Übersetze „Guten Morgen“ ins Spanische", "Erkläre mir, was ein schwarzes Loch ist, als wäre ich zehn",
    "Gib mir einen Plan für 20 Minuten Sport zu Hause", "Schreib eine kurze Bio für mein Profil: freundlich und witzig", "Wie lerne ich schneller Vokabeln?",
    "Erfinde einen Namen für einen Podcast über Technik", "Was ist der Unterschied zwischen Wetter und Klima?", "Schreib mir ein kurzes Gedicht über den Regen",
    "Gib mir fünf Fragen für ein Quiz über Geografie", "Wie funktioniert ein Elektromotor?", "Hilf mir, eine höfliche Absage zu formulieren",
    "Was sollte ich vor einem Vorstellungsgespräch üben?", "Erkläre mir den Satz des Pythagoras mit einem Beispiel", "Schlag mir drei Filme für einen Abend mit Freunden vor",
    "Wie schreibe ich einen guten ersten Satz für einen Beitrag?", "Fasse die Geschichte der Pizza in drei Sätzen zusammen", "Gib mir Tipps für besseren Schlaf",
    "Was ist Inflation, und warum steigen Preise?", "Schreib mir einen Witz über Katzen", "Erkläre mir, wie das Internet funktioniert",
    "Wie bleibe ich beim Lernen konzentriert?", "Übersetze „Wie geht es dir?“ ins Französische und Italienische", "Gib mir ein Rezept ohne Backofen",
    "Was sind gute Hashtags für einen Beitrag über Reisen?", "Erkläre mir künstliche Intelligenz in einem Absatz", "Schreib eine Geburtstagsnachricht für einen Freund",
    "Wie plane ich einen Tag in einer fremden Stadt?", "Was ist der Unterschied zwischen „das“ und „dass“?", "Gib mir drei Ideen für ein Hobby, das wenig kostet",
    "Wie funktioniert ein Regenbogen?", "Schreib eine kurze Geschichte über einen Roboter, der Kaffee liebt", "Erkläre mir, wie man ein Passwort sicher macht",
    "Hilf mir, mich für einen Streit zu entschuldigen", "Welche Fragen kann ich bei einem ersten Treffen stellen?", "Was passiert beim Blitz und Donner?",
    "Gib mir eine Einkaufsliste für eine Woche gesund essen", "Erkläre mir den Unterschied zwischen Bit und Byte", "Schreib mir eine Idee für ein Video in 30 Sekunden",
    "Wie funktioniert ein Flugzeug?", "Zähl mir fünf spannende Fakten über den Ozean auf", "Übersetze „Danke für alles“ ins Englische, Spanische und Türkische",
    "Wie baue ich eine gute Morgenroutine auf?", "Was ist ein Primzahl-Zwilling?", "Gib mir drei Tipps, um besser zu schreiben",
    "Schreib einen Beitrag über meinen Lieblingssport: ich nenne ihn dir", "Erkläre mir, wie Impfstoffe wirken", "Wie spare ich als Schüler Geld?",
    "Was bedeutet „Work-Life-Balance“?", "Gib mir ein kurzes Workout für den Rücken", "Welche Sehenswürdigkeiten gibt es in Berlin?",
    "Schreib einen kurzen Dialog zwischen zwei Aliens", "Erkläre mir den Unterschied zwischen Strom und Spannung", "Wie schreibe ich eine gute Zusammenfassung?",
    "Hilf mir, ein Thema für eine Präsentation zu finden", "Was ist ein guter Name für einen Hund?", "Wie lange darf man Eier aufbewahren?",
    "Erkläre mir Zinseszins an einem Beispiel", "Gib mir fünf Ideen für ein Geschenk unter 20 Euro", "Wie erkenne ich Fake News?",
    "Schreib einen motivierenden Satz für Montagmorgen", "Was ist der Unterschied zwischen Virus und Bakterie?", "Erkläre mir, wie ein Kompass funktioniert",
    "Schlag mir ein Rätsel vor, das ich meinen Freunden stellen kann", "Wie rechne ich Prozente im Kopf?", "Was sind die Planeten unseres Sonnensystems?",
    "Gib mir Tipps für ein gutes Foto mit dem Handy", "Schreib mir eine Antwort auf eine freundliche Kritik", "Wie funktioniert Bluetooth?",
    "Erkläre mir die Regeln von Schach in fünf Punkten", "Hilf mir, einen Reim auf „Nex“ zu finden", "Was ist der Unterschied zwischen Wal und Fisch?",
    "Wie schreibe ich eine E-Mail an meine Lehrerin?", "Gib mir drei Fragen, um jemanden besser kennenzulernen", "Was ist ein Algorithmus? Erkläre es mit Kuchenbacken",
  ];
  let lastShown = [];
  function suggest(count = 5) {
    const fresh = POOL.filter((text) => !lastShown.includes(text));
    const bag = fresh.length >= count ? fresh : POOL.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    lastShown = bag.slice(0, count);
    return lastShown.slice();
  }
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
    const chips = h("div", { class: "nex-chips" });
    function drawChips() {
      fill(chips, ...suggest().map((text) => h("button", { class: "nex-suggestion", type: "button", onclick: () => ask(text) }, text)),
        h("button", { class: "icon-btn nex-reroll", type: "button", "aria-label": "Neue Vorschläge", onclick: drawChips }, icon("refresh")));
    }
    drawChips();
    const staged = h("div", { class: "nex-staged", hidden: true });
    const picker = h("input", { type: "file", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const input = h("textarea", { class: "nex-input", rows: 1, maxlength: 1500, placeholder: "Frag Nex etwas", "aria-label": "Nachricht an Nex" });
    const plus = h("button", { class: "icon-btn nex-plus", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, icon("plus"));
    const sendButton = h("button", { class: "icon-btn send-btn", type: "button", "aria-label": "Senden", disabled: true }, icon("arrowUp"));
    const stopButton = h("button", { class: "icon-btn send-btn stop", type: "button", "aria-label": "Antwort stoppen", hidden: true }, icon("stop"));
    const composeBar = h("div", { class: "nex-compose" },
      chips, staged,
      h("div", { class: "nex-box" }, plus, input, sendButton, stopButton, picker),
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
      if (message.role === "user") {
        const things = (message.attachments || []).map((entry) => h("span", { class: "nex-attached" }, icon(entry.kind === "image" ? "image" : "file"), entry.name));
        return h("div", { class: "nex-msg user" }, h("div", { class: "nex-bubble" }, things.length ? h("div", { class: "nex-attachments" }, things) : null, h("p", { class: "nex-p" }, message.content)));
      }
      const bubble = h("div", { class: "nex-bubble" });
      blocksOf(message.content, bubble);
      return h("div", { class: "nex-msg assistant" }, h("div", { class: "nex-col" }, bubble, actions(message, index)));
    }

    function draw() {
      const empty = chat.messages.length === 0 && !postBox.children.length;
      if (empty && intro.hidden) drawChips();                                 // a new conversation: new suggestions
      intro.hidden = !empty;
      chips.hidden = !empty;
      fill(thread, ...chat.messages.map(row));
    }

    function update() {
      sendButton.disabled = busy || (!Core.cleanText(input.value) && !(attachments.length && attachments.every((entry) => entry.ready)));
      if (attachments.some((entry) => !entry.ready && !entry.problem)) sendButton.disabled = true;
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
      let question = Core.cleanText(text);
      const things = attachments.filter((entry) => entry.ready);
      if (attachments.some((entry) => !entry.ready && !entry.problem)) return;                  // a file is still on its way
      if (!question && things.length) question = things.some((entry) => entry.kind === "image") ? "Was siehst du auf diesem Foto?" : "Fasse dieses Dokument kurz zusammen.";
      if (!question || busy) return;
      const message = { role: "user", content: question };
      if (things.length) {
        message.attachments = things.map((entry) => ({ kind: entry.kind, name: entry.name }));
        extra = { ...extra, files: things.map((entry) => (entry.kind === "image" ? { kind: "image", name: entry.name, data: entry.data } : { kind: "document", name: entry.name, text: entry.text })) };
      }
      chat.messages.push(message);
      input.value = "";
      for (const entry of attachments.splice(0)) if (entry.url) URL.revokeObjectURL(entry.url);
      drawStaged();
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

    // ---- photos and documents ("+"): a photo is made small here and sent along as it is, a document is read by the server (its text, not stored)
    const attachments = [];                                // {kind, name, url?, data? (photo as base64), text? (document), ready, problem}
    const toBase64 = (blob) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] || ""); reader.onerror = reject; reader.readAsDataURL(blob); });
    function drawStaged() {
      staged.hidden = !attachments.length;
      fill(staged, ...attachments.map((entry) => h("div", { class: `nex-chip${entry.problem ? " bad" : ""}` },
        entry.kind === "image" && entry.url ? h("img", { class: "nex-chip-thumb", src: entry.url, alt: "" }) : h("span", { class: "nex-chip-thumb doc" }, icon(entry.kind === "image" ? "image" : "file")),
        h("span", { class: "nex-chip-main" }, h("b", {}, entry.name), h("small", {}, entry.problem || (entry.ready ? (entry.kind === "image" ? "Foto bereit" : `${entry.cut ? "Anfang des Dokuments" : "Dokument"} gelesen`) : "wird vorbereitet …"))),
        h("button", { class: "icon-btn tiny", type: "button", "aria-label": `${entry.name} entfernen`, onclick: () => { if (entry.url) URL.revokeObjectURL(entry.url); attachments.splice(attachments.indexOf(entry), 1); drawStaged(); update(); } }, icon("close")))));
    }
    async function attach(file, kind) {
      if (attachments.length >= 3) { toast("Mehr als 3 Anhänge gehen nicht."); return; }
      const entry = { kind, name: file.name || (kind === "image" ? "Foto" : "Dokument"), ready: false, problem: "" };
      attachments.push(entry);
      drawStaged();
      update();
      try {
        if (kind === "image") {
          let data = "";
          for (const max of [1024, 768, 512]) {
            const blob = await Y.prepareImage(file, { max });
            data = await toBase64(blob);
            if (data.length <= 800000) { if (entry.url) URL.revokeObjectURL(entry.url); entry.url = URL.createObjectURL(blob); break; }
            data = "";
          }
          if (!data) throw new Error("big");
          entry.data = data;
        } else {
          const reply = await Api.readDocument(file);
          if (!reply.ok) entry.problem = Api.message(reply);
          else { entry.text = reply.data.text; entry.cut = !!reply.data.cut; entry.name = reply.data.name || entry.name; }
        }
        entry.ready = !entry.problem;
      } catch (error) {
        entry.problem = "Diese Datei konnte nicht gelesen werden.";
      }
      drawStaged();
      update();
    }
    picker.addEventListener("change", () => { const file = picker.files[0]; const kind = picker.dataset.kind; picker.value = ""; if (file) attach(file, kind); });
    const pick = (accept, kind) => { picker.accept = accept; picker.dataset.kind = kind; picker.click(); };

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
        close === noClose ? null : h("nav", { class: "nx-links drawer-nav", "aria-label": "Nex" }, page(Y.HOME, "home", "Home"), page("/messages", "users", "Chats"), page("/camera", "camera", "Kamera"), page("/videos", "playCircle", "Videos"))];
    }
    const noClose = () => {};
    fill(side, ...historyContent(noClose));

    function openHistory() {
      Y.sidePanel("Nex: Gespräche", (panel, close) => {
        panel.append(...historyContent(close, (redraw) => redraws.delete(redraw)));
      }, "nex-drawer");
    }

    plus.addEventListener("click", () => menu(plus, [
      { label: "Foto hinzufügen", icon: "image", run: () => pick("image/jpeg,image/png,image/webp", "image") },
      { label: "Dokument hinzufügen", icon: "file", run: () => pick(".pdf,.txt,.md,.csv,.rtf,.docx,.xlsx,.pptx,.odt,.ods,.odp", "document") },
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
