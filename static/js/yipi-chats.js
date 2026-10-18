/* Pulse chats (yipi-chats.js): the Chats tab -- one list with the conversations with a person and the group chats, the conversation itself
   (a person: /messages/<name>, a group: /g/<number>), and the dialogs to start a new message or a new group. A group can only be made with
   friends (people who follow you and whom you follow); only the one who made it can rename it or add somebody; everybody can leave. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, toast, dialog, confirmBox, menu } = Y;
  const { qs, emptyState, errorState, topbar, snippet } = Y;
  const views = Y.views;

  const GROUP_NAME_MAX = 40;
  const GROUP_MEMBERS_MAX = 20;

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
    entry = dialog({ title: "Neue Nachricht", body: h("div", {}, input, results), initialFocus: input });
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
  views.messages = function messages(route, ctx) {
    const box = h("div", { class: "chats-body" });
    const plus = h("button", { class: "icon-btn round", type: "button", "aria-label": "Neuer Chat", "aria-haspopup": "menu" }, icon("plus"));
    plus.addEventListener("click", () => menu(plus, [
      { label: "Neue Nachricht", icon: "mail", run: newMessage },
      { label: "Neue Gruppe", icon: "users", run: newGroup },
    ]));
    const el = h("div", { class: "view chats-view" }, topbar({ title: "Chats", className: "big", right: plus }), box);
    let dead = false;

    function row(item) {
      const group = item.kind === "group";
      const last = item.last;
      const who = last ? (last.mine ? "Du: " : last.sender ? `${last.sender}: ` : "") : "";
      const preview = last ? `${who}${snippet((last.text || "").replace(/\s+/g, " "), 80)}` : "Noch keine Nachrichten";
      return link(group ? `/g/${item.group.id}` : `/messages/${item.user.handle}`, { class: `convo${item.unread ? " unread" : ""}` },
        group ? groupFace() : avatar(item.user, "md"),
        h("div", { class: "convo-main" },
          h("div", { class: "convo-top" }, h("b", { class: "convo-name" }, group ? item.group.name : item.user.name), h("span", { class: "convo-time" }, Y.timeEl(item.at))),
          h("p", { class: "convo-last" }, preview)),
        item.unread ? h("span", { class: "unread-dot", "aria-label": `${item.unread} ungelesen` }, item.unread > 99 ? "99+" : String(item.unread)) : null);
    }

    async function load(first) {
      const reply = await Api.get("/chats");
      if (dead) return;
      if (!reply.ok) { if (first) fill(box, errorState(reply, () => load(true))); return; }
      fill(box, h("div", { class: "chat-list" }, ...(reply.data.items.length ? reply.data.items.map(row)
        : [emptyState("Noch keine Chats", "Schreib privat mit Leuten, die dir folgen, oder gründe eine Gruppe mit Freunden.",
          h("div", { class: "hero-actions" }, h("button", { class: "btn primary", type: "button", onclick: newMessage }, "Nachricht schreiben"), h("button", { class: "btn ghost", type: "button", onclick: newGroup }, "Gruppe gründen")))])));
    }
    put(box, Y.skeleton(3));
    load(true);
    const timer = setInterval(() => { if (!document.hidden) load(false); }, 15000);
    return { element: el, title: "Chats", destroy() { dead = true; clearInterval(timer); }, refresh() { load(false); } };
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

  /* The page of one conversation. kind "dm": a person (route.handle), kind "group": a group chat (route.id). */
  function conversation(route, ctx, kind) {
    const group = kind === "group";
    const base = group ? `/groups/${route.id}` : `/messages/${route.handle}`;
    const sendPath = group ? `${base}/messages` : base;
    const state = { list: [], next: null, other: null, group: null, dead: false, sending: false };

    const headText = h("div", { class: "chat-head-text" }, h("b", {}, group ? "Gruppe" : `@${route.handle}`), h("small", {}));
    const headMain = h("div", { class: "chat-head-main" }, headText);
    const more = h("button", { class: "icon-btn round", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu", hidden: true }, icon("more"));
    const head = h("div", { class: "chat-head" }, h("button", { class: "icon-btn round", type: "button", "aria-label": "Zurück", onclick: () => Y.back("/messages") }, icon("back")), headMain, more);
    const older = h("button", { class: "btn ghost small older", type: "button", hidden: true }, "Frühere Nachrichten laden");
    const bubbles = h("div", { class: "bubbles", role: "log", "aria-live": "polite", "aria-label": "Nachrichten" });
    const input = h("textarea", { class: "dm-input", rows: 1, maxlength: 1000, placeholder: "Neue Nachricht", "aria-label": "Nachricht" });
    const sendButton = h("button", { class: "icon-btn send-btn", type: "button", "aria-label": "Senden", disabled: true }, icon("arrowUp"));
    const gifButton = h("button", { class: "icon-btn tool", type: "button", "aria-label": "GIF senden", "aria-haspopup": "dialog" }, icon("gif"));
    const note = h("p", { class: "notice", hidden: true });
    const composeBar = h("div", { class: "dm-compose", hidden: true }, h("div", { class: "dm-box" }, gifButton, input, sendButton));
    const body = h("div", { class: "thread" }, h("div", { class: "thread-intro" }), older, bubbles);
    const el = h("div", { class: "view thread-view" }, head, body, note, composeBar);

    const lastTheirs = () => state.list.reduce((max, m) => (m.mine ? max : Math.max(max, m.id)), 0);
    const nearBottom = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160;
    const toBottom = () => window.scrollTo(0, document.documentElement.scrollHeight);

    function draw() {
      const nodes = [];
      let day = "";
      let previous = null;
      state.list.forEach((message, index) => {
        const label = dayLabel(message.createdAt);
        if (label !== day) { day = label; nodes.push(h("div", { class: "day" }, h("span", {}, label))); previous = null; }
        const next = state.list[index + 1];
        const sameSender = (a, b) => a.mine === b.mine && (!group || a.mine || (a.sender && b.sender && a.sender.handle === b.sender.handle));
        const endOfGroup = !next || !sameSender(next, message) || dayLabel(next.createdAt) !== day || clock(next.createdAt) !== clock(message.createdAt);
        const gif = message.gif && !message.gif.gone ? message.gif : null;
        const showName = group && !message.mine && (!previous || !sameSender(previous, message));
        nodes.push(h("div", { class: `bubble ${message.mine ? "mine" : "theirs"}` },
          showName ? h("span", { class: "bubble-name" }, message.sender ? message.sender.name : "Gelöschtes Konto") : null,
          gif ? h("div", { class: "bubble-gif-wrap" },
            h("button", { class: "bubble-gif", type: "button", "aria-label": `GIF vergrößern${gif.title ? `: ${gif.title}` : ""}`, onclick: () => Y.viewer([{ url: gif.url, alt: gif.title || "GIF" }], 0) }, h("img", { src: gif.url, alt: gif.title || "GIF", width: gif.width, height: gif.height, loading: "lazy" })),
            Y.gifStar(gif)) : null,
          message.gif && message.gif.gone ? h("div", { class: "bubble-text gone" }, "Dieses GIF gibt es nicht mehr.") : null,
          message.text ? h("div", { class: "bubble-text" }, richText(message.text)) : null,
          endOfGroup ? h("span", { class: "bubble-time" }, clock(message.createdAt)) : null));
        previous = message;
      });
      fill(bubbles, ...nodes);
    }

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
        return true;
      } }] });
    }
    function addDialog() {
      let entry = null;
      const present = new Set(state.group.members.map((member) => member.handle.toLowerCase()));
      const picker = friendPicker({ skip: present, max: GROUP_MEMBERS_MAX - state.group.count });
      entry = dialog({ title: "Person hinzufügen", body: h("div", {}, h("p", { class: "hint" }, "Nur Freunde: Leute, die dir folgen und denen du folgst."), picker.element), actions: [{ label: "Hinzufügen", kind: "primary", run: async () => {
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
      return entry;
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
    async function load() {
      const reply = await Api.get(base);
      if (state.dead) return;
      if (!reply.ok) { fill(body, errorState(reply, () => ctx.reload())); return; }
      state.list = reply.data.messages;
      state.next = reply.data.next;
      older.hidden = !state.next;
      if (group) {
        state.group = reply.data.group;
        composeBar.hidden = false;
        if (!state.list.length) fill(body.querySelector(".thread-intro"), h("p", { class: "notice" }, "Schreib die erste Nachricht an die Gruppe."));
      } else {
        state.other = reply.data.user;
        if (state.other.isMe) { fill(body, emptyState("Das geht nicht", "Du kannst dir nicht selbst schreiben.", link("/messages", { class: "btn primary" }, "Zurück"))); return; }
        intro(state.other);
        if (reply.data.canWrite) composeBar.hidden = false;
        else { note.textContent = `Du kannst ${state.other.name} erst schreiben, wenn ${state.other.name} dir folgt oder dir zuerst geschrieben hat.`; note.hidden = false; }
      }
      drawHead();
      draw();
      requestAnimationFrame(toBottom);
      Y.refreshBadges();
    }

    older.addEventListener("click", async () => {
      older.disabled = true;
      const reply = await Api.get(qs(base, { cursor: state.next }));
      older.disabled = false;
      if (!reply.ok) { toast(Api.message(reply)); return; }
      const before = document.documentElement.scrollHeight;
      state.list = [...reply.data.messages, ...state.list];
      state.next = reply.data.next;
      older.hidden = !state.next;
      draw();
      window.scrollTo(0, window.scrollY + document.documentElement.scrollHeight - before);
    });

    function update() {
      sendButton.disabled = state.sending || !Core.cleanText(input.value);
      input.style.height = "auto";
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
    }
    async function deliver(payload, clearInput) {
      if (state.sending) return;
      state.sending = true;
      update();
      const reply = await Api.post(sendPath, payload);
      state.sending = false;
      if (!reply.ok) { toast(Api.message(reply)); update(); return; }
      if (clearInput) input.value = "";
      state.list.push(reply.data.message);
      draw();
      update();
      toBottom();
    }
    function send() {
      const text = Core.cleanText(input.value);
      if (text) deliver({ text }, true);
    }
    gifButton.addEventListener("click", () => Y.gifPicker({ onPick: (gif) => deliver({ gifId: gif.id }, false) }));
    input.addEventListener("input", update);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && matchMedia("(pointer: fine)").matches) { event.preventDefault(); send(); } });
    sendButton.addEventListener("click", send);

    async function poll() {
      if (state.dead || document.hidden || !(group ? state.group : state.other) || (state.other && state.other.isMe)) return;
      const reply = await Api.get(qs(`${base}/poll`, { after: lastTheirs() }));
      if (state.dead || !reply.ok || !reply.data.messages.length) return;
      const stick = nearBottom();
      state.list.push(...reply.data.messages);
      draw();
      if (stick) toBottom();
      composeBar.hidden = false;                       // somebody who wrote to you can always be answered
      note.hidden = true;
      Y.refreshBadges();
    }
    const timer = setInterval(poll, 4000);
    put(body, h("div", { class: "thread-skeleton" }, Y.skeleton(2)));
    load().then(() => body.querySelector(".thread-skeleton")?.remove());
    return { element: el, title: group ? "Gruppe" : `Nachrichten mit @${route.handle}`, destroy() { state.dead = true; clearInterval(timer); } };
  }

  views.thread = (route, ctx) => conversation(route, ctx, "dm");
  views.group = (route, ctx) => conversation(route, ctx, "group");
})();
