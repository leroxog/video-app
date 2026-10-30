/* Nex chats (yipi-chats.js): the Chats tab, made like the messages of Instagram -- one list with the conversations with a person and the group
   chats (tabs "Nachrichten" and "Anfragen", a search line), the conversation itself (a person: /messages/<name>, a group: /g/<number>) and
   the dialogs to start a new message or a new group. On a wide screen the list and the conversation are side by side.
   A message to somebody who follows you back lands in their main chats; to somebody who does not follow you it is a request they have to accept
   first (and you learn nothing about reading until then), and between strangers it is a request in the folder "Allgemein" further back.
   A group can only be made with friends (people who follow you and whom you follow); only the one who made it can rename it or add somebody. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, toast, dialog, confirmBox, menu, tabs } = Y;
  const { qs, emptyState, errorState, topbar, snippet } = Y;
  const views = Y.views;

  const GROUP_NAME_MAX = 40;
  const GROUP_MEMBERS_MAX = 20;
  const split = () => matchMedia("(min-width: 1000px)").matches;          // list and conversation side by side (the style sheet switches at the same width)

  const groupFace = (size = "md") => h("span", { class: `avatar ${size} group`, "aria-hidden": "true" }, icon("usersFill"));
  const formError = () => h("p", { class: "form-error", role: "alert", hidden: true });
  const showError = (box, text) => { box.textContent = text; box.hidden = !text; };

  // ------------------------------------------------------------------------------------------ new message
  function newMessage() {
    const input = h("input", { class: "field", type: "search", placeholder: "Nach Namen oder @Nutzernamen suchen", "aria-label": "Person suchen", autocomplete: "off", maxlength: 50 });
    const results = h("div", { class: "pick-list" }, h("p", { class: "muted" }, "Tippe mindestens zwei Zeichen."));
    let timer = null;
    let token = 0;
    let entry = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const term = Core.cleanText(input.value).replace(/^@/, "");
      if (term.length < 2) { fill(results, h("p", { class: "muted" }, "Tippe mindestens zwei Zeichen.")); return; }
      const mine = ++token;
      timer = setTimeout(async () => {
        const reply = await Api.get(qs("/search", { q: term, type: "people" }));
        if (mine !== token) return;
        if (!reply.ok) { fill(results, h("p", { class: "muted" }, Api.message(reply))); return; }
        const people = reply.data.users.filter((user) => !user.isMe);
        fill(results, ...(people.length ? people.map((user) => h("button", { class: "pick", type: "button", onclick: () => { entry.close(); Y.navigate(`/messages/${user.handle}`); } },
          avatar(user, "md"), h("span", { class: "pick-main" }, h("b", {}, user.name), h("span", { class: "handle" }, `@${user.handle}`)))) : [h("p", { class: "muted" }, "Niemanden gefunden.")]));
      }, 280);
    });
    entry = dialog({ title: "Neue Nachricht", body: h("div", {}, input, h("p", { class: "hint" }, "Folgt dir die Person nicht, ist deine Nachricht eine Anfrage: sie muss sie erst annehmen."), results), initialFocus: input });
  }

  // -------------------------------------------------------------------------------------------- new group
  /* The friends of the person (those who follow each other), as checkboxes; `skip` is a set of handles that are not offered. */
  function friendPicker({ skip = new Set(), max, onChange }) {
    const chosen = new Set();
    const list = h("div", { class: "pick-list" }, Y.skeleton(1));
    (async () => {
      const reply = await Api.get("/friends");
      if (!reply.ok) { fill(list, h("p", { class: "muted" }, Api.message(reply))); return; }
      const people = reply.data.users.filter((user) => !skip.has(user.handle.toLowerCase()));
      if (!people.length) { fill(list, h("p", { class: "muted" }, "Freunde sind Leute, denen du folgst und die dir folgen. Du hast gerade niemanden, den du hinzufügen kannst.")); return; }
      fill(list, ...people.map((user) => {
        const box = h("input", { type: "checkbox", "aria-label": `@${user.handle} auswählen` });
        box.addEventListener("change", () => {
          if (box.checked && chosen.size >= max) { box.checked = false; toast(`Mehr als ${max} Leute gehen nicht.`); return; }
          if (box.checked) chosen.add(user.handle); else chosen.delete(user.handle);
          onChange?.(chosen);
        });
        return h("label", { class: "pick" }, avatar(user, "md"), h("span", { class: "pick-main" }, h("b", {}, user.name), h("span", { class: "handle" }, `@${user.handle}`)), box);
      }));
    })();
    return { element: list, chosen };
  }

  function newGroup() {
    const name = h("input", { class: "field", maxlength: GROUP_NAME_MAX, placeholder: "Name der Gruppe", "aria-label": "Name der Gruppe", autocomplete: "off" });
    const error = formError();
    const picker = friendPicker({ max: GROUP_MEMBERS_MAX - 1 });
    dialog({ title: "Neue Gruppe", body: h("div", {}, h("label", { class: "field-label" }, h("span", {}, "Name"), name), h("p", { class: "hint" }, "Du kannst nur Freunde hinzufügen: Leute, die dir folgen und denen du folgst."),
      h("div", { class: "field-label" }, h("span", {}, "Wer soll dabei sein?"), picker.element), error), initialFocus: name,
    actions: [{ label: "Gruppe erstellen", kind: "primary", run: async () => {
      showError(error, "");
      if (!Core.cleanText(name.value)) { showError(error, Api.MESSAGES.bad_group_name); return false; }
      if (!picker.chosen.size) { showError(error, "Wähle mindestens eine Person aus."); return false; }
      const reply = await Api.post("/groups", { name: name.value, members: [...picker.chosen] });
      if (!reply.ok) { showError(error, Api.message(reply)); return false; }
      Y.navigate(`/g/${reply.data.group.id}`);
      return true;
    } }] });
  }

  // ---------------------------------------------------------------------------------------------- the list
  /* The list of all chats with its title, search line and the tabs "Nachrichten" / "Anfragen". `active` is the key of the open conversation
     ("d<handle>" or "g<number>"), `tab` the tab to start on. Returns {element, destroy, refresh, showTab}. */
  function chatListPane({ active = "", tab = "main" } = {}) {
    let items = [];
    let requests = 0;
    let term = "";
    let current = tab;
    let general = false;                                              // the folder "Allgemein" is open
    let dead = false;
    let loaded = false;

    const plus = h("button", { class: "icon-btn round", type: "button", "aria-label": "Neuer Chat", "aria-haspopup": "menu" }, icon("plus"));
    plus.addEventListener("click", () => menu(plus, [
      { label: "Neue Nachricht", icon: "mail", run: newMessage },
      { label: "Neue Gruppe", icon: "users", run: newGroup },
      Y.chatLock && Y.chatLock.enabled() ? { label: "Chats sperren", icon: "lock", run: () => { Y.chatLock.lockNow(); Y.rerender(); } } : null,
    ]));
    const search = h("input", { class: "search-input", type: "search", placeholder: "Suchen", "aria-label": "Chats durchsuchen", autocomplete: "off", maxlength: 60 });
    const tabBox = h("div", { class: "chat-tabs" });
    const body = h("div", { class: "chats-body" });
    const element = h("div", { class: "chat-pane" }, topbar({ title: "Chats", className: "big", right: plus }), h("label", { class: "search-box chat-search" }, icon("search"), search), tabBox, body);

    const keyOf = (item) => (item.kind === "group" ? `g${item.group.id}` : `d${item.user.handle.toLowerCase()}`);

    function row(item) {
      const group = item.kind === "group";
      const last = item.last;
      const who = last ? (last.mine ? "Du: " : last.sender ? `${last.sender}: ` : "") : "";
      const status = !last ? ["new", "Neuer Chat", "reply"] : item.unread ? ["unread", "Neue Nachricht", "reply"] : last.mine ? ["sent", "Gesendet", "planeFill"] : ["got", "Empfangen", "reply"];
      const preview = last ? `${who}${snippet((last.text || "").replace(/\s+/g, " "), 80)}` : "Noch keine Nachrichten";
      return link(group ? `/g/${item.group.id}` : `/messages/${item.user.handle}`, { class: `convo${item.unread ? " unread" : ""}${keyOf(item) === active ? " active" : ""}` },
        group ? groupFace() : avatar(item.user, "md"),
        h("div", { class: "convo-main" },
          h("div", { class: "convo-top" }, h("b", { class: "convo-name" }, group ? item.group.name : item.user.name), group ? null : Y.aiTag(item.user)),
          h("p", { class: `convo-last convo-status ${status[0]}`, title: preview }, h("span", { class: "convo-ic" }, icon(status[2])), h("span", {}, status[1]), h("span", { class: "dot" }, "·"), Y.timeEl(item.at))),
        item.streak >= 2 ? h("span", { class: "convo-streak", title: `${item.streak} Tage in Folge`, "aria-label": `${item.streak} Tage in Folge geschrieben` }, String(item.streak), icon("flame")) : null,
        item.unread ? h("span", { class: "unread-dot", "aria-label": `${item.unread} ungelesen` }, item.unread > 99 ? "99+" : String(item.unread)) : null);
    }

    /* Nex, the assistant, is in everybody's list like a contact. */
    function nexRow() {
      return link("/i/nex", { class: `convo convo-nex${active === "nex" ? " active" : ""}` },
        h("span", { class: "avatar md nex-face", "aria-hidden": "true" }, icon("nexmark")),
        h("div", { class: "convo-main" },
          h("div", { class: "convo-top" }, h("b", { class: "convo-name" }, "Nex AI"), h("span", { class: "ai-badge" }, "KI")),
          h("p", { class: "convo-last" }, "Frag mich alles. Ich bin immer für dich da.")));
    }

    const matches = (item) => {
      if (!term) return true;
      const text = item.kind === "group" ? item.group.name : `${item.user.name} ${item.user.handle}`;
      return text.toLowerCase().includes(term) || (item.last && (item.last.text || "").toLowerCase().includes(term));
    };

    function drawTabs() {
      fill(tabBox, tabs([["main", "Nachrichten"], ["requests", requests ? `Anfragen (${requests})` : "Anfragen"]], current, (id) => { current = id; drawTabs(); draw(); }, "Chats"));
    }

    function draw() {
      if (!loaded) return;
      const found = items.filter(matches);
      if (current === "requests") {
        const asked = found.filter((item) => item.box === "request");
        const other = found.filter((item) => item.box === "general");
        const parts = [];
        if (asked.length) parts.push(h("div", { class: "chat-list" }, asked.map(row)));
        if (other.length) {
          parts.push(h("button", { class: "chat-folder", type: "button", "aria-expanded": String(general), onclick: () => { general = !general; draw(); } },
            h("span", { class: "chat-folder-text" }, h("b", {}, "Allgemein"), h("small", {}, `${other.length} ${other.length === 1 ? "Anfrage" : "Anfragen"} von Leuten, mit denen du keine Verbindung hast`)), icon("chevron")));
          if (general) parts.push(h("div", { class: "chat-list" }, other.map(row)));
        }
        fill(body, ...(parts.length ? parts : [h("div", { class: "chat-list" }, emptyState("Keine Anfragen", term ? "Dazu gibt es nichts." : "Nachrichten von Leuten, denen du nicht folgst, erscheinen hier. Du entscheidest, ob du sie annimmst."))]));
        return;
      }
      const main = found.filter((item) => item.kind === "group" || item.box === "primary");
      const banner = requests && !term ? h("button", { class: "chat-requests", type: "button", onclick: () => { current = "requests"; drawTabs(); draw(); } },
        h("span", { class: "chat-requests-ic" }, icon("mail")), h("span", { class: "chat-requests-text" }, h("b", {}, "Anfragen"), h("small", {}, `${requests} ${requests === 1 ? "Person möchte" : "Personen möchten"} dir schreiben`)), icon("chevron")) : null;
      const showNex = !term || "nex ki ai assistent".includes(term);
      const rows = [showNex ? nexRow() : null, ...main.map(row)].filter(Boolean);
      const blank = main.length ? null : term ? (showNex ? null : emptyState("Nichts gefunden", "Probier einen anderen Namen."))
        : emptyState("Noch keine Chats", "Schreib mit deinen Freunden oder gründe eine Gruppe.",
          h("div", { class: "hero-actions" }, h("button", { class: "btn primary", type: "button", onclick: newMessage }, "Nachricht schreiben"), h("button", { class: "btn ghost", type: "button", onclick: newGroup }, "Gruppe gründen")));
      fill(body, banner, rows.length ? h("div", { class: "chat-list" }, rows) : null, blank ? h("div", { class: "chat-blank" }, blank) : null, term ? null : Y.sponsored("row"));
    }

    async function load(first) {
      const reply = await Api.get("/chats");
      if (dead) return;
      if (!reply.ok) { if (first) fill(body, errorState(reply, () => load(true))); return; }
      items = reply.data.items;
      requests = reply.data.requests || 0;
      loaded = true;
      drawTabs();
      draw();
    }

    search.addEventListener("input", () => { term = Core.cleanText(search.value).toLowerCase(); draw(); });
    drawTabs();
    put(body, Y.skeleton(3));
    load(true);
    const timer = setInterval(() => { if (!document.hidden) load(false); }, 15000);
    return {
      element,
      destroy() { dead = true; clearInterval(timer); },
      refresh: () => load(false),
      showTab(id) { if (id !== current) { current = id; drawTabs(); draw(); } },
    };
  }

  views.messages = function messages() {
    const pane = chatListPane();
    const empty = h("div", { class: "chat-empty" }, h("span", { class: "chat-empty-ic" }, icon("mail")), h("h2", {}, "Deine Nachrichten"),
      h("p", {}, "Schick einem Freund oder einer Gruppe eine Nachricht."), h("button", { class: "btn primary", type: "button", onclick: newMessage }, "Nachricht schreiben"));
    return { element: h("div", { class: "view chats-view chats-split" }, pane.element, empty), title: "Chats", destroy: pane.destroy, refresh: pane.refresh };
  };

  // ------------------------------------------------------------------------------------- a conversation
  const dayLabel = (iso) => {
    const date = new Date(iso);
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86400000);
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(date, today)) return "Heute";
    if (same(date, yesterday)) return "Gestern";
    return Core.fullTime(iso).split(" · ")[1];
  };
  const clock = (iso) => Core.fullTime(iso).split(" · ")[0];

  const formatSize = (bytes) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`);

  /* A photo, a video or a document inside a bubble. */
  function fileBubble(file) {
    if (file.kind === "image") {
      return h("button", { class: "bubble-img", type: "button", "aria-label": `Foto vergrößern${file.name ? `: ${file.name}` : ""}`, onclick: () => Y.viewer([{ url: file.url, alt: file.name || "Foto" }], 0) },
        h("img", { src: file.url, alt: file.name || "Foto", width: file.width || undefined, height: file.height || undefined, loading: "lazy", decoding: "async" }));
    }
    if (file.kind === "video") {                                          // (like every video: one click stops or plays it, nothing to wind, nothing to make big)
      const video = h("video", { class: "bubble-video", src: `${file.url}#t=0.001`, playsinline: true, preload: "metadata", "aria-label": file.name || "Video" });
      const box = h("div", { class: "bubble-video-box" }, video);
      Y.plainVideo?.(video, box);
      return box;
    }
    return h("a", { class: "bubble-doc", href: file.url, download: file.name, target: "_blank", rel: "noopener", "aria-label": `Dokument herunterladen: ${file.name}` },
      h("span", { class: "bubble-doc-ic" }, icon("file")), h("span", { class: "bubble-doc-main" }, h("b", {}, file.name), h("small", {}, `${(file.name.split(".").pop() || "").toUpperCase()} · ${formatSize(file.size)}`)), h("span", { class: "bubble-doc-dl" }, icon("download")));
  }

  /* The page of one conversation. kind "dm": a person (route.handle), kind "group": a group chat (route.id). */
  function conversation(route, ctx, kind) {
    const group = kind === "group";
    const base = group ? `/groups/${route.id}` : `/messages/${route.handle}`;
    const sendPath = group ? `${base}/messages` : base;
    const state = { list: [], next: null, other: null, group: null, dead: false, sending: false, staged: null };
    const side = split();                                                // list and conversation side by side: the conversation scrolls inside its own box
    const pane = side ? chatListPane({ active: group ? `g${route.id}` : `d${route.handle.toLowerCase()}` }) : null;

    const headText = h("div", { class: "chat-head-text" }, h("b", {}, group ? "Gruppe" : `@${route.handle}`), h("small", {}));
    const headMain = h("div", { class: "chat-head-main" }, headText);
    const more = h("button", { class: "icon-btn round", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu", hidden: true }, icon("more"));
    const head = h("div", { class: "chat-head" }, h("button", { class: "icon-btn round chat-back", type: "button", "aria-label": "Zurück", onclick: () => Y.back("/messages") }, icon("back")), headMain, more);
    const older = h("button", { class: "btn ghost small older", type: "button", hidden: true }, "Frühere Nachrichten laden");
    const bubbles = h("div", { class: "bubbles", role: "log", "aria-live": "polite", "aria-label": "Nachrichten" });
    const input = h("textarea", { class: "dm-input", rows: 1, maxlength: 1000, placeholder: "Nachricht …", "aria-label": "Nachricht" });
    const sendButton = h("button", { class: "icon-btn send-btn", type: "button", "aria-label": "Senden", disabled: true }, icon("arrowUp"));
    const plusButton = h("button", { class: "icon-btn tool dm-plus", type: "button", "aria-label": "Anhang hinzufügen", "aria-haspopup": "menu" }, icon("plus"));
    const picker = h("input", { type: "file", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const staged = h("div", { class: "dm-staged", hidden: true });
    const note = h("p", { class: "notice", hidden: true });
    const composeBar = h("div", { class: "dm-compose", hidden: true }, staged, h("div", { class: "dm-box" }, plusButton, input, sendButton, picker));
    const requestBar = h("div", { class: "request-bar", hidden: true });
    const body = h("div", { class: "thread" }, h("div", { class: "thread-intro" }), older, bubbles);
    const threadEl = h("div", { class: "view thread-view" }, head, body, note, requestBar, composeBar);
    const el = side ? h("div", { class: "chats-split" }, pane.element, threadEl) : threadEl;

    const lastTheirs = () => state.list.reduce((max, m) => (m.mine ? max : Math.max(max, m.id)), 0);
    const nearBottom = () => (side ? body.scrollHeight - body.scrollTop - body.clientHeight < 160 : document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160);
    const toBottom = () => { if (side) body.scrollTop = body.scrollHeight; else window.scrollTo(0, document.documentElement.scrollHeight); };

    function draw() {
      const nodes = [];
      let day = "";
      let previous = null;
      let lastMine = -1;
      state.list.forEach((message, index) => { if (message.mine) lastMine = index; });
      state.list.forEach((message, index) => {
        const label = dayLabel(message.createdAt);
        if (label !== day) { day = label; nodes.push(h("div", { class: "day" }, h("span", {}, label))); previous = null; }
        const next = state.list[index + 1];
        const sameSender = (a, b) => a.mine === b.mine && (!group || a.mine || (a.sender && b.sender && a.sender.handle === b.sender.handle));
        const seen = !group && index === lastMine && message.read;
        const endOfGroup = seen || !next || !sameSender(next, message) || dayLabel(next.createdAt) !== day || clock(next.createdAt) !== clock(message.createdAt);
        const gif = message.gif && !message.gif.gone ? message.gif : null;
        const file = message.file && !message.file.gone ? message.file : null;
        const showName = !previous || !sameSender(previous, message);
        nodes.push(h("div", { class: `bubble ${message.mine ? "mine" : "theirs"}${message.hearts ? " loved" : ""}`, "data-id": String(message.id) },
          showName ? h("span", { class: "bubble-name" }, message.mine ? "Ich" : message.sender ? message.sender.name : (state.other && state.other.name) || (group ? "Gelöschtes Konto" : `@${route.handle}`)) : null,
          gif ? h("div", { class: "bubble-gif-wrap" },
            h("button", { class: "bubble-gif", type: "button", "aria-label": `GIF vergrößern${gif.title ? `: ${gif.title}` : ""}`, onclick: () => Y.viewer([{ url: gif.url, alt: gif.title || "GIF" }], 0) }, h("img", { src: gif.url, alt: gif.title || "GIF", width: gif.width, height: gif.height, loading: "lazy" })),
            Y.gifStar(gif)) : null,
          message.gif && message.gif.gone ? h("div", { class: "bubble-text gone" }, "Dieses GIF gibt es nicht mehr.") : null,
          file ? fileBubble(file) : null,
          message.file && message.file.gone ? h("div", { class: "bubble-text gone" }, "Diese Datei gibt es nicht mehr.") : null,
          message.text ? h("div", { class: "bubble-text" }, richText(message.text)) : null,
          message.text && !gif && !file && Y.linkCardFor ? Y.linkCardFor(message.text, { compact: true }) : null,
          message.hearts ? h("button", { class: `bubble-hearts${message.hearted ? " on" : ""}`, type: "button", "aria-pressed": String(!!message.hearted), "aria-label": `${message.hearts} ${message.hearts === 1 ? "Herz" : "Herzen"}${message.hearted ? ", von dir" : ""}`, onclick: (event) => toggleHeart(message, event.clientX, event.clientY) },
            icon("heartFill"), message.hearts > 1 ? h("span", {}, String(message.hearts)) : null) : null,
          endOfGroup ? h("span", { class: "bubble-time" }, seen ? `${clock(message.createdAt)} · Gelesen` : clock(message.createdAt)) : null));
        previous = message;
      });
      fill(bubbles, ...nodes);
    }

    /* A double tap on a message puts a heart on it (another one takes it off again); the heart under the bubble shows how many there are. */
    async function toggleHeart(message, x, y) {
      if (!message.id) return;
      const wanted = !message.hearted;
      message.hearted = wanted;
      message.hearts = Math.max(0, (message.hearts || 0) + (wanted ? 1 : -1));
      if (wanted) { Y.likeBurst(x, y, { size: 90 }); Y.sound?.play("like"); } else Y.sound?.play("unlike");
      draw();
      const path = group ? `${base}/messages/${message.id}/heart` : `${base}/${message.id}/heart`;
      const reply = wanted ? await Api.post(path) : await Api.del(path);
      if (state.dead) return;
      if (!reply.ok) { message.hearted = !wanted; message.hearts = Math.max(0, message.hearts + (wanted ? -1 : 1)); draw(); toast(Api.message(reply)); return; }
      message.hearts = reply.data.hearts;
      message.hearted = reply.data.hearted;
      draw();
    }
    Y.onDoubleTap(bubbles, (x, y, event) => {
      const node = event.target.closest(".bubble");
      const message = node && state.list.find((entry) => String(entry.id) === node.dataset.id);
      if (message) toggleHeart(message, x, y);
    }, { ignore: "a, button, input, textarea, select, video, .menu" });

    // ---- the header: who or what this is
    function drawHead() {
      if (group) {
        const g = state.group;
        fill(headMain, groupFace("sm"), h("div", { class: "chat-head-text" }, h("b", {}, g.name), h("small", {}, `${g.count} ${g.count === 1 ? "Mitglied" : "Mitglieder"}`)));
        ctx.setTitle(`Gruppe ${g.name}`);
      } else {
        const u = state.other;
        fill(headMain, link(`/${u.handle}`, { class: "chat-head-link", "aria-label": `Profil von ${u.name}` }, avatar(u, "sm")), h("div", { class: "chat-head-text" }, h("b", {}, u.name), h("small", {}, `@${u.handle}`)));
        ctx.setTitle(`Nachrichten mit ${u.name}`);
      }
      more.hidden = false;
    }

    function intro(user) {
      fill(body.querySelector(".thread-intro"), link(`/${user.handle}`, { class: "intro-card" }, avatar(user, "lg"), h("b", {}, user.name), h("span", { class: "handle" }, `@${user.handle}`),
        user.bio ? h("p", {}, snippet(user.bio, 120)) : null, h("small", {}, `${Core.formatCount(user.followers)} Follower · ${Core.joinedLabel(user.createdAt)}`)));
    }

    // ---- a message request: the bar to accept or delete it
    async function decide(answer) {
      requestBar.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      const reply = await Api.post(`${base}/${answer}`);
      if (!reply.ok) { toast(Api.message(reply)); requestBar.querySelectorAll("button").forEach((button) => { button.disabled = false; }); return; }
      if (answer === "decline") { toast("Die Anfrage wurde gelöscht."); Y.refreshBadges(); Y.navigate("/messages", { replace: true }); return; }
      toast(`Du hast ${state.other.name} angenommen.`);
      await load(true);
      pane?.refresh();
      pane?.showTab("main");
    }
    function drawRequestBar() {
      const name = state.other.name;
      fill(requestBar, h("p", { class: "request-text" }, h("b", {}, `${name} möchte dir schreiben.`), " Wenn du annimmst, sieht die Person, dass du ihre Nachrichten liest, und ihr könnt euch schreiben."),
        h("div", { class: "request-actions" }, h("button", { class: "btn primary", type: "button", onclick: () => decide("accept") }, "Annehmen"), h("button", { class: "btn ghost", type: "button", onclick: () => decide("decline") }, "Löschen")));
      requestBar.hidden = false;
    }

    // ---- the menu behind the three dots
    function membersDialog() {
      const g = state.group;
      dialog({ title: g.name, body: h("div", { class: "member-list" }, g.members.map((member) => Y.userRow(member, { bio: false, action: member.isOwner ? h("span", { class: "tag" }, "Gründer") : null }))) });
    }
    function renameDialog() {
      const name = h("input", { class: "field", maxlength: GROUP_NAME_MAX, "aria-label": "Name der Gruppe", autocomplete: "off" });
      name.value = state.group.name;
      const error = formError();
      dialog({ title: "Gruppe umbenennen", body: h("div", {}, name, error), initialFocus: name, actions: [{ label: "Speichern", kind: "primary", run: async () => {
        showError(error, "");
        const reply = await Api.patch(`/groups/${route.id}`, { name: name.value });
        if (!reply.ok) { showError(error, Api.message(reply)); return false; }
        state.group = reply.data.group;
        drawHead();
        pane?.refresh();
        return true;
      } }] });
    }
    function addDialog() {
      const present = new Set(state.group.members.map((member) => member.handle.toLowerCase()));
      const picker = friendPicker({ skip: present, max: GROUP_MEMBERS_MAX - state.group.count });
      dialog({ title: "Person hinzufügen", body: h("div", {}, h("p", { class: "hint" }, "Nur Freunde: Leute, die dir folgen und denen du folgst."), picker.element), actions: [{ label: "Hinzufügen", kind: "primary", run: async () => {
        if (!picker.chosen.size) { toast("Wähle mindestens eine Person aus."); return false; }
        for (const handle of picker.chosen) {
          const reply = await Api.post(`/groups/${route.id}/members`, { handle });
          if (!reply.ok) { toast(Api.message(reply)); return false; }
          state.group = reply.data.group;
        }
        drawHead();
        toast("Hinzugefügt.");
        return true;
      } }] });
    }
    more.addEventListener("click", () => {
      if (group && state.group) {
        menu(more, [
          { label: "Mitglieder anzeigen", icon: "users", run: membersDialog },
          state.group.isOwner ? { label: "Gruppe umbenennen", icon: "pencil", run: renameDialog } : null,
          state.group.isOwner && state.group.count < GROUP_MEMBERS_MAX ? { label: "Person hinzufügen", icon: "plus", run: addDialog } : null,
          { label: "Gruppe verlassen", icon: "logout", danger: true, run: async () => {
            if (!(await confirmBox({ title: "Gruppe verlassen?", text: state.group.isOwner && state.group.count > 1 ? "Du bist der Gründer. Danach gehört die Gruppe dem Nächsten." : "Du bekommst keine Nachrichten mehr aus dieser Gruppe.", yes: "Verlassen", danger: true }))) return;
            const reply = await Api.post(`/groups/${route.id}/leave`);
            if (!reply.ok) { toast(Api.message(reply)); return; }
            toast("Du hast die Gruppe verlassen.");
            Y.navigate("/messages", { replace: true });
          } },
        ]);
      } else if (state.other) {
        menu(more, [
          { label: "Profil ansehen", icon: "user", run: () => Y.navigate(`/${state.other.handle}`) },
          { label: `@${state.other.handle} melden`, icon: "flag", danger: true, run: () => Y.reportDialog({ handle: state.other.handle }) },
        ]);
      }
    });

    // ---- loading and sending
    async function load(again) {
      const reply = await Api.get(base);
      if (state.dead) return;
      if (!reply.ok) { fill(body, errorState(reply, () => ctx.reload())); return; }
      state.list = reply.data.messages;
      state.next = reply.data.next;
      older.hidden = !state.next;
      composeBar.hidden = true;
      requestBar.hidden = true;
      note.hidden = true;
      if (group) {
        state.group = reply.data.group;
        composeBar.hidden = false;
        if (!state.list.length) fill(body.querySelector(".thread-intro"), h("p", { class: "notice" }, "Schreib die erste Nachricht an die Gruppe."));
      } else {
        state.other = reply.data.user;
        if (state.other.isMe) { fill(body, emptyState("Das geht nicht", "Du kannst dir nicht selbst schreiben.", link("/messages", { class: "btn primary" }, "Zurück"))); return; }
        intro(state.other);
        pane?.showTab(reply.data.box === "primary" ? "main" : "requests");
        if (reply.data.request) drawRequestBar();
        else if (reply.data.canWrite) composeBar.hidden = false;
        else { note.textContent = Api.MESSAGES[reply.data.gate] || Api.MESSAGES.request_pending; note.hidden = false; }
      }
      drawHead();
      draw();
      if (!again) requestAnimationFrame(toBottom);
      else toBottom();
      Y.refreshBadges();
    }

    older.addEventListener("click", async () => {
      older.disabled = true;
      const reply = await Api.get(qs(base, { cursor: state.next }));
      older.disabled = false;
      if (!reply.ok) { toast(Api.message(reply)); return; }
      const before = side ? body.scrollHeight : document.documentElement.scrollHeight;
      state.list = [...reply.data.messages, ...state.list];
      state.next = reply.data.next;
      older.hidden = !state.next;
      draw();
      if (side) body.scrollTop += body.scrollHeight - before; else window.scrollTo(0, window.scrollY + document.documentElement.scrollHeight - before);
    });

    function update() {
      const ready = state.staged && state.staged.id;
      sendButton.disabled = state.sending || (state.staged && !state.staged.id) || (!Core.cleanText(input.value) && !ready);
      plusButton.disabled = state.sending;
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    }

    /* ---- the "+" : a photo, a video, a document or a GIF. A file is checked here, sent to the server (private) with a bar that shows how far it has come,
       and waits above the box until "Senden" puts it into a message. */
    function drawStaged() {
      const item = state.staged;
      staged.hidden = !item;
      if (!item) { fill(staged); return; }
      const thumb = item.kind === "image" ? h("img", { class: "dm-staged-thumb", src: item.url, alt: "" })
        : item.kind === "video" ? h("video", { class: "dm-staged-thumb", src: item.url, muted: true, playsinline: true, preload: "metadata" })
          : h("span", { class: "dm-staged-thumb doc" }, icon("file"));
      fill(staged, h("div", { class: `dm-chip${item.problem ? " bad" : ""}` }, thumb,
        h("span", { class: "dm-chip-main" }, h("b", {}, item.name), h("small", {}, item.problem || (item.id ? `${formatSize(item.size)} · bereit` : `${Math.round(item.progress * 100)} % hochgeladen …`)),
          item.id || item.problem ? null : h("span", { class: "dm-chip-bar" }, h("span", { class: "dm-chip-fill", style: `width:${Math.round(item.progress * 100)}%` }))),
        h("button", { class: "icon-btn tiny", type: "button", "aria-label": "Anhang entfernen", onclick: () => { if (item.url) URL.revokeObjectURL(item.url); state.staged = null; drawStaged(); update(); } }, icon("close"))));
    }
    async function stage(file, kind) {
      if (state.staged && state.staged.url) URL.revokeObjectURL(state.staged.url);
      const item = { name: file.name || (kind === "image" ? "Foto" : kind === "video" ? "Video" : "Datei"), size: file.size, kind, url: "", progress: 0, id: null, problem: "" };
      state.staged = item;
      drawStaged();
      update();
      try {
        let blob = file;
        if (kind === "image" && file.type !== "image/gif") blob = await Y.prepareImage(file);
        item.size = blob.size;
        if (kind === "video" && blob.size > Core.MAX_VIDEO_BYTES) throw new Error("video_too_big");
        item.url = kind === "document" ? "" : URL.createObjectURL(blob);
        drawStaged();
        const form = blob === file ? file : new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
        const reply = await Api.attach(form, (fraction) => { if (state.staged === item) { item.progress = fraction; drawStaged(); } });
        if (state.staged !== item) return;
        if (!reply.ok) { item.problem = Api.message(reply); item.progress = 0; } else { item.id = reply.data.file.id; item.name = reply.data.file.name || item.name; item.size = reply.data.file.size; }
      } catch (error) {
        item.problem = error && error.message === "video_too_big" ? Api.MESSAGES.video_too_big : "Diese Datei konnte nicht gelesen werden.";
      }
      if (state.staged === item) { drawStaged(); update(); }
    }
    const pick = (accept, kind) => { picker.accept = accept; picker.dataset.kind = kind; picker.click(); };
    picker.addEventListener("change", () => { const file = picker.files[0]; const kind = picker.dataset.kind; picker.value = ""; if (file) stage(file, kind); });
    plusButton.addEventListener("click", () => menu(plusButton, [
      { label: "Foto", icon: "image", run: () => pick("image/jpeg,image/png,image/gif,image/webp", "image") },
      { label: "Video", icon: "film", run: () => pick("video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm", "video") },
      { label: "Dokument", icon: "file", run: () => pick(".pdf,.txt,.md,.csv,.rtf,.docx,.xlsx,.pptx,.odt,.ods,.odp", "document") },
      { label: "GIF", icon: "gif", run: () => Y.gifPicker({ onPick: (gif) => deliver({ gifId: gif.id }, false) }) },
    ]));

    async function deliver(payload, clearInput) {
      if (state.sending) return;
      state.sending = true;
      update();
      const reply = await Api.post(sendPath, payload);
      state.sending = false;
      if (!reply.ok) { toast(Api.message(reply)); update(); return; }
      if (clearInput) input.value = "";
      if (payload.fileId && state.staged) { if (state.staged.url) URL.revokeObjectURL(state.staged.url); state.staged = null; drawStaged(); }
      state.list.push(reply.data.message);
      draw();
      update();
      toBottom();
      if (!group && reply.data.gate) {                   // the one message a request allows is sent: from now on the other one has to answer
        composeBar.hidden = true;
        note.textContent = Api.MESSAGES[reply.data.gate] || Api.MESSAGES.request_pending;
        note.hidden = false;
      }
      pane?.refresh();
    }
    function send() {
      const text = Core.cleanText(input.value);
      if (state.staged && !state.staged.id) return;
      const payload = {};
      if (text) payload.text = text;
      if (state.staged && state.staged.id) payload.fileId = state.staged.id;
      if (payload.text || payload.fileId) deliver(payload, true);
    }
    input.addEventListener("input", update);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && matchMedia("(pointer: fine)").matches) { event.preventDefault(); send(); } });
    sendButton.addEventListener("click", send);

    async function poll() {
      if (state.dead || document.hidden || !(group ? state.group : state.other) || (state.other && state.other.isMe) || !requestBar.hidden) return;
      const reply = await Api.get(qs(`${base}/poll`, { after: lastTheirs() }));
      if (state.dead || !reply.ok) return;
      let changed = false;
      if (!group && reply.data.readUpTo) {
        for (const message of state.list) if (message.mine && !message.read && message.id <= reply.data.readUpTo) { message.read = true; changed = true; }
      }
      for (const message of state.list) {
        const known = reply.data.hearts && reply.data.hearts[String(message.id)];
        if (known && (known[0] !== message.hearts || known[1] !== !!message.hearted)) { message.hearts = known[0]; message.hearted = known[1]; changed = true; }
      }
      if (reply.data.messages.length) {
        const stick = nearBottom();
        state.list.push(...reply.data.messages);
        changed = true;
        draw();
        if (stick) toBottom();
        composeBar.hidden = false;                       // somebody who wrote to you can always be answered
        note.hidden = true;
        Y.refreshBadges();
      } else if (changed) draw();
    }
    const timer = setInterval(poll, 4000);
    put(body, h("div", { class: "thread-skeleton" }, Y.skeleton(2)));
    load(false).then(() => body.querySelector(".thread-skeleton")?.remove());
    return { element: el, title: group ? "Gruppe" : `Nachrichten mit @${route.handle}`, destroy() { state.dead = true; clearInterval(timer); pane?.destroy(); } };
  }

  Y.chatSplit = split;                                                    // Nex AI is a chat too: it takes the same panes, the same list at the side and the same times
  Y.chatListPane = chatListPane;
  Y.chatTime = { dayLabel, clock };
  views.thread = (route, ctx) => conversation(route, ctx, "dm");
  views.group = (route, ctx) => conversation(route, ctx, "group");
})();
