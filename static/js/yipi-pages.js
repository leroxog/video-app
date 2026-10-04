/* yipi views, part 2: messages, settings, moderation, the pages to sign in and sign up, and the pages for "not found" and "please
   sign in". Same shape as part 1: each view is a function (route, ctx) answering {element, title, ...}. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, toast, dialog, confirmBox, pager } = Y;
  const { qs, listLoader, emptyState, errorState, topbar, snippet } = Y;
  const views = Y.views;

  const button = (label, kind, onclick, extra = {}) => h("button", { class: `btn ${kind}`, type: "button", onclick, ...extra }, label);
  const field = (label, input, hint) => h("label", { class: "field-label" }, h("span", {}, label), input, hint ? h("small", { class: "hint" }, hint) : null);
  const formError = () => h("p", { class: "form-error", role: "alert", hidden: true });
  const showError = (box, text) => { box.textContent = text; box.hidden = !text; };

  // ------------------------------------------------------------------------------------ small views
  views.notfound = function notfound() {
    return { element: h("div", { class: "view" }, topbar({ title: "Nicht gefunden" }),
      h("div", { class: "empty big" }, h("div", { class: "empty-logo" }, window.YipiIcons.logo()), h("h2", {}, "Diese Seite gibt es nicht"), h("p", {}, "Vielleicht ist der Link falsch, oder das Konto oder der Yip wurde gelöscht."),
        link("/", { class: "btn primary" }, "Zur Startseite"))), title: "Nicht gefunden" };
  };

  views.needLogin = function needLogin(route) {
    const what = { notifications: "Benachrichtigungen", messages: "Nachrichten", thread: "Nachrichten", bookmarks: "Lesezeichen", moderation: "Moderation", settings: "Einstellungen" }[route.name] || "Das";
    return { element: h("div", { class: "view" }, topbar({ title: what }),
      h("div", { class: "empty big" }, h("div", { class: "empty-logo" }, window.YipiIcons.logo()), h("h2", {}, "Melde dich an"), h("p", {}, `Für ${what} brauchst du ein yipi-Konto.`),
        h("div", { class: "hero-actions" }, link("/i/signup", { class: "btn primary" }, "Konto erstellen"), link("/i/login", { class: "btn ghost" }, "Anmelden")))), title: what };
  };

  // ---------------------------------------------------------------------------------------- messages
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

  views.messages = function messages(route, ctx) {
    const box = h("div", { class: "convos" });
    const el = h("div", { class: "view" }, topbar({ title: "Nachrichten", right: h("button", { class: "icon-btn", type: "button", "aria-label": "Neue Nachricht", onclick: newMessage }, icon("pencil")) }), box);
    let dead = false;

    function row(item) {
      const last = item.last;
      return link(`/messages/${item.user.handle}`, { class: `convo${item.unread ? " unread" : ""}` }, avatar(item.user, "md"),
        h("div", { class: "convo-main" },
          h("div", { class: "convo-top" }, h("b", {}, item.user.name), h("span", { class: "handle" }, `@${item.user.handle}`), h("span", { class: "dot" }, "·"), Y.timeEl(last.createdAt)),
          h("p", { class: "convo-last" }, `${last.mine ? "Du: " : ""}${snippet(last.text.replace(/\s+/g, " "), 90)}`)),
        item.unread ? h("span", { class: "unread-dot", "aria-label": `${item.unread} ungelesen` }) : null);
    }

    async function load(first) {
      const reply = await Api.get("/messages");
      if (dead) return;
      if (!reply.ok) { if (first) fill(box, errorState(reply, () => load(true))); return; }
      fill(box, ...(reply.data.items.length ? reply.data.items.map(row)
        : [emptyState("Willkommen im Posteingang", "Schreibe privat mit Leuten, die dir folgen. Wähle oben rechts eine Person aus.", button("Nachricht schreiben", "primary", newMessage))]));
    }
    put(box, Y.skeleton(3));
    load(true);
    const timer = setInterval(() => { if (!document.hidden) load(false); }, 15000);
    return { element: el, title: "Nachrichten", destroy() { dead = true; clearInterval(timer); } };
  };

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

  views.thread = function thread(route, ctx) {
    const handle = route.handle;
    const bar = topbar({ back: "/messages", title: `@${handle}` });
    const older = h("button", { class: "btn ghost small older", type: "button", hidden: true }, "Frühere Nachrichten laden");
    const bubbles = h("div", { class: "bubbles", role: "log", "aria-live": "polite", "aria-label": "Nachrichten" });
    const input = h("textarea", { class: "dm-input", rows: 1, maxlength: 1000, placeholder: "Neue Nachricht", "aria-label": "Nachricht" });
    const sendButton = h("button", { class: "icon-btn send-btn", type: "button", "aria-label": "Senden", disabled: true }, icon("send"));
    const note = h("p", { class: "notice", hidden: true });
    const composeBar = h("div", { class: "dm-compose", hidden: true }, input, sendButton);
    const body = h("div", { class: "thread" }, h("div", { class: "thread-intro" }), older, bubbles);
    const el = h("div", { class: "view thread-view" }, bar, body, note, composeBar);
    const state = { list: [], next: null, other: null, dead: false, sending: false };

    const lastTheirs = () => state.list.reduce((max, m) => (m.mine ? max : Math.max(max, m.id)), 0);
    const nearBottom = () => document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 160;
    const toBottom = () => window.scrollTo(0, document.documentElement.scrollHeight);

    function draw() {
      const nodes = [];
      let day = "";
      let previous = null;
      for (const message of state.list) {
        const label = dayLabel(message.createdAt);
        if (label !== day) { day = label; nodes.push(h("div", { class: "day" }, h("span", {}, label))); previous = null; }
        const next = state.list[state.list.indexOf(message) + 1];
        const endOfGroup = !next || next.mine !== message.mine || dayLabel(next.createdAt) !== day || clock(next.createdAt) !== clock(message.createdAt);
        nodes.push(h("div", { class: `bubble ${message.mine ? "mine" : "theirs"}${previous && previous.mine === message.mine ? " joined" : ""}` },
          h("div", { class: "bubble-text" }, message.text), endOfGroup ? h("span", { class: "bubble-time" }, clock(message.createdAt)) : null));
        previous = message;
      }
      fill(bubbles, ...nodes);
    }

    function intro(user) {
      fill(body.querySelector(".thread-intro"), link(`/${user.handle}`, { class: "intro-card" }, avatar(user, "lg"), h("b", {}, user.name), h("span", { class: "handle" }, `@${user.handle}`),
        user.bio ? h("p", {}, snippet(user.bio, 120)) : null, h("small", {}, `${Core.formatCount(user.followers)} Follower · ${Core.joinedLabel(user.createdAt)}`)));
    }

    async function load() {
      const reply = await Api.get(`/messages/${handle}`);
      if (state.dead) return;
      if (!reply.ok) { fill(body, errorState(reply, () => ctx.reload())); return; }
      state.other = reply.data.user;
      if (state.other.isMe) { fill(body, emptyState("Das geht nicht", "Du kannst dir nicht selbst schreiben.", link("/messages", { class: "btn primary" }, "Zurück"))); return; }
      bar.set(state.other.name, `@${state.other.handle}`);
      ctx.setTitle(`Nachrichten mit ${state.other.name}`);
      state.list = reply.data.messages;
      state.next = reply.data.next;
      older.hidden = !state.next;
      intro(state.other);
      draw();
      if (reply.data.canWrite) composeBar.hidden = false;
      else { note.textContent = `Du kannst ${state.other.name} erst schreiben, wenn ${state.other.name} dir folgt oder dir zuerst geschrieben hat.`; note.hidden = false; }
      requestAnimationFrame(toBottom);
      Y.refreshBadges();
    }

    older.addEventListener("click", async () => {
      older.disabled = true;
      const reply = await Api.get(qs(`/messages/${handle}`, { cursor: state.next }));
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
    async function send() {
      const text = Core.cleanText(input.value);
      if (!text || state.sending) return;
      state.sending = true;
      update();
      const reply = await Api.post(`/messages/${handle}`, { text });
      state.sending = false;
      if (!reply.ok) { toast(Api.message(reply)); update(); return; }
      input.value = "";
      state.list.push(reply.data.message);
      draw();
      update();
      toBottom();
    }
    input.addEventListener("input", update);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.shiftKey && matchMedia("(pointer: fine)").matches) { event.preventDefault(); send(); } });
    sendButton.addEventListener("click", send);

    async function poll() {
      if (state.dead || document.hidden || !state.other || state.other.isMe) return;
      const reply = await Api.get(qs(`/messages/${handle}/poll`, { after: lastTheirs() }));
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
    return { element: el, title: `Nachrichten mit @${handle}`, destroy() { state.dead = true; clearInterval(timer); } };
  };

  // ---------------------------------------------------------------------------------------- settings
  const THEMES = [["auto", "Wie das Gerät", "Folgt der Einstellung deines Geräts."], ["light", "Hell", "Weißer Hintergrund."], ["dim", "Gedimmt", "Dunkelblau, schonend für die Augen."], ["dark", "Dunkel", "Tiefschwarz, spart Strom auf OLED-Bildschirmen."]];

  function accountSection() {
    const box = h("div", { class: "settings-body" });
    const me = Y.me;
    const oldPassword = h("input", { class: "field", type: "password", autocomplete: "current-password", "aria-label": "Aktuelles Passwort", maxlength: 200 });
    const newPassword = h("input", { class: "field", type: "password", autocomplete: "new-password", "aria-label": "Neues Passwort", maxlength: 200 });
    const passwordError = formError();
    const changePassword = button("Passwort ändern", "primary", async (event) => {
      showError(passwordError, "");
      if (newPassword.value.length < 8) { showError(passwordError, Api.MESSAGES.bad_password); return; }
      const self = event.currentTarget;                    // (gone after the first await)
      self.disabled = true;
      const reply = await Api.post("/password", { oldPassword: oldPassword.value, newPassword: newPassword.value });
      self.disabled = false;
      if (!reply.ok) { showError(passwordError, Api.message(reply)); return; }
      oldPassword.value = newPassword.value = "";
      toast("Dein Passwort wurde geändert. Andere Geräte sind abgemeldet.");
    });
    put(box, 
      h("section", { class: "card" }, h("h2", {}, "Dein Konto"),
        h("dl", { class: "facts" }, h("dt", {}, "Nutzername"), h("dd", {}, `@${me.handle}`), h("dt", {}, "E-Mail"), h("dd", {}, me.email || "nicht angegeben"), h("dt", {}, "Dabei seit"), h("dd", {}, Core.joinedLabel(me.createdAt).replace("Beigetreten ", "")))),
      h("section", { class: "card" }, h("h2", {}, "Passwort ändern"), field("Aktuelles Passwort", oldPassword), field("Neues Passwort", newPassword, "Mindestens 8 Zeichen."), passwordError, changePassword,
        h("p", { class: "muted small" }, "yipi verschickt keine E-Mails. Ein vergessenes Passwort lässt sich deshalb nicht zurücksetzen. Bewahre es sicher auf.")),
      h("section", { class: "card danger-zone" }, h("h2", {}, "Konto löschen"),
        h("p", { class: "muted" }, "Dabei werden dein Profil, alle deine Yips, Bilder, Nachrichten und Likes endgültig gelöscht. Das lässt sich nicht rückgängig machen."),
        button("Konto löschen …", "danger", () => {
          const confirmPassword = h("input", { class: "field", type: "password", autocomplete: "current-password", "aria-label": "Passwort zur Bestätigung", maxlength: 200 });
          const error = formError();
          dialog({ title: "Konto wirklich löschen?", body: h("div", {}, h("p", { class: "dialog-text" }, "Gib zur Bestätigung dein Passwort ein."), confirmPassword, error), actions: [{ label: "Endgültig löschen", kind: "danger", run: async () => {
            const reply = await Api.post("/delete", { password: confirmPassword.value });
            if (!reply.ok) { showError(error, Api.message(reply)); return false; }
            Y.setMe(null);
            Y.navigate("/", { replace: true });
            toast("Dein Konto wurde gelöscht.");
            return true;
          } }] });
        })));
    return box;
  }

  function displaySection() {
    let current = "auto";
    try { current = localStorage.getItem("yipi.theme") || "auto"; } catch (error) { /* storage blocked */ }
    const group = h("div", { class: "choices big", role: "radiogroup", "aria-label": "Darstellung" });
    for (const [id, label, text] of THEMES) {
      const input = h("input", { type: "radio", name: "theme", value: id, onchange: () => Y.setTheme(id) });
      input.checked = id === current;
      put(group, h("label", { class: `choice theme-${id}` }, input, h("span", { class: "choice-text" }, h("b", {}, label), h("small", {}, text))));
    }
    return h("div", { class: "settings-body" }, h("section", { class: "card" }, h("h2", {}, "Darstellung"), group));
  }

  function relationSection(kind) {
    const label = kind === "muted" ? "Stummgeschaltet" : "Blockiert";
    const verb = kind === "muted" ? "Aufheben" : "Entsperren";
    const listPager = pager({
      load: listLoader((cursor) => qs(`/settings/${kind}`, { page: cursor || 1 }), "users"),
      render: (user) => {
        const row = Y.userRow(user, { action: button(verb, "ghost small", async (event) => {
          const self = event.currentTarget;
          self.disabled = true;
          const reply = await Api.del(`/users/${user.handle}/${kind === "muted" ? "mute" : "block"}`);
          if (!reply.ok) { self.disabled = false; toast(Api.message(reply)); return; }
          row.remove();
          toast(kind === "muted" ? "Stummschaltung aufgehoben." : "Blockierung aufgehoben.");
        }) });
        return row;
      },
      empty: emptyState(`Niemand ${kind === "muted" ? "stummgeschaltet" : "blockiert"}`, kind === "muted" ? "Stummgeschaltete Konten tauchen nicht mehr in deinen Listen und Benachrichtigungen auf, merken es aber nicht." : "Blockierte Konten können dir nicht folgen oder schreiben und deine Yips nicht sehen."),
    });
    listPager.title = label;
    return listPager;
  }

  function aboutSection() {
    return h("div", { class: "settings-body" },
      h("section", { class: "card" }, h("h2", {}, "Rechtliches"),
        h("ul", { class: "plain-links" }, ["nutzungsbedingungen|Nutzungsbedingungen und Regeln", "datenschutz|Datenschutzerklärung", "impressum|Impressum"].map((entry) => { const [path, text] = entry.split("|"); return h("li", {}, h("a", { href: `/${path}` }, text, icon("chevron"))); }))),
      h("section", { class: "card" }, h("h2", {}, "Hilfe"),
        button("Tastenkürzel anzeigen", "ghost", () => Y.shortcutsDialog()),
        h("p", { class: "muted small" }, "Yips sind öffentlich. Nachrichten sind nur für die beiden Beteiligten sichtbar, aber nicht Ende-zu-Ende-verschlüsselt. Etwas Unpassendes siehst du? Tippe beim Yip oder Profil auf „Melden“.")),
      h("section", { class: "card" }, h("h2", {}, "Über yipi"),
        h("p", { class: "muted" }, "yipi ist ein unabhängiges, kostenloses Projekt, ohne Werbung und ohne Tracking. Es speichert nur ein Anmelde-Cookie, wenn du dich anmeldest, und deine Einstellungen im Browser.")));
  }

  views.settings = function settings(route, ctx) {
    const section = route.section;
    const SECTIONS = [
      ["account", "Dein Konto", "Passwort, E-Mail und Konto löschen", "user", true],
      ["display", "Darstellung", "Hell, gedimmt oder dunkel", "sun", false],
      ["muted", "Stummgeschaltet", "Konten, die du nicht sehen willst", "mute", true],
      ["blocked", "Blockiert", "Konten, die dir nicht schreiben dürfen", "block", true],
      ["about", "Hilfe und Rechtliches", "Regeln, Datenschutz, Impressum", "shield", false],
    ];
    if (!section) {
      const rows = SECTIONS.filter(([, , , , needs]) => !needs || Y.me).map(([id, title, text, iconName]) => link(`/settings/${id}`, { class: "setting-row" }, h("span", { class: "setting-ic" }, icon(iconName)), h("span", { class: "setting-text" }, h("b", {}, title), h("small", {}, text)), icon("chevron")));
      if (Y.me) rows.push(h("button", { class: "setting-row logout", type: "button", onclick: () => Y.logout() }, h("span", { class: "setting-ic" }, icon("logout")), h("span", { class: "setting-text" }, h("b", {}, "Abmelden"), h("small", {}, `@${Y.me.handle}`))));
      return { element: h("div", { class: "view" }, topbar({ title: "Einstellungen" }), h("div", { class: "settings-list" }, rows)), title: "Einstellungen" };
    }
    const entry = SECTIONS.find(([id]) => id === section);
    if (!entry) return views.notfound();
    if (entry[4] && !Y.me) return views.needLogin({ name: "settings" });
    const el = h("div", { class: "view" }, topbar({ back: "/settings", title: entry[1] }));
    let destroy = null;
    if (section === "account") put(el, accountSection());
    else if (section === "display") put(el, displaySection());
    else if (section === "about") put(el, aboutSection());
    else { const listPager = relationSection(section); put(el, listPager.element); destroy = () => listPager.destroy(); }
    return { element: el, title: entry[1], destroy };
  };

  // -------------------------------------------------------------------------------------- moderation
  const REASON_LABEL = { spam: "Spam", abuse: "Belästigung", hate: "Hass", violence: "Gewalt", illegal: "Illegal", self_harm: "Selbstverletzung", other: "Sonstiges" };

  views.moderation = function moderation() {
    if (!Y.me || !Y.me.isAdmin) return views.notfound();
    const box = h("div", { class: "reports" });
    const el = h("div", { class: "view" }, topbar({ title: "Moderation", sub: "Offene Meldungen" }), box);
    let dead = false;

    async function act(report, action, card) {
      const reply = await Api.post(`/moderation/reports/${report.id}`, { action });
      if (!reply.ok) { toast(Api.message(reply)); return; }
      card.remove();
      if (!box.children.length) put(box, emptyState("Alles erledigt", "Es gibt keine offenen Meldungen."));
    }

    function card(report) {
      const target = report.postId ? (report.text ? `Yip von @${report.handle}` : "Yip (gelöscht)") : `Profil @${report.handle}`;
      const element = h("article", { class: "report-card" },
        h("div", { class: "report-top" }, h("span", { class: "tag" }, REASON_LABEL[report.reason] || report.reason), h("b", {}, target), Y.timeEl(report.createdAt)),
        report.text ? h("blockquote", {}, report.text) : null,
        report.note ? h("p", { class: "muted" }, `Anmerkung: ${report.note}`) : null,
        h("p", { class: "muted small" }, `Gemeldet von @${report.reporter || "?"}`),
        h("div", { class: "report-actions" },
          report.handle ? link(`/${report.handle}`, { class: "btn ghost small" }, "Profil ansehen") : null,
          report.postId && !report.postGone ? button("Yip löschen", "danger small", () => act(report, "delete_post", element)) : null,
          report.handle && !report.suspended ? button("Konto sperren", "danger small", async () => { if (await confirmBox({ title: `@${report.handle} sperren?`, text: "Das Konto wird abgemeldet und kann sich nicht mehr anmelden.", yes: "Sperren", danger: true })) act(report, "suspend", element); }) : null,
          report.handle && report.suspended ? button("Sperre aufheben", "ghost small", () => act(report, "restore", element)) : null,
          button("Verwerfen", "ghost small", () => act(report, "dismiss", element))));
      return element;
    }

    (async () => {
      put(box, Y.skeleton(2));
      const reply = await Api.get("/moderation/reports");
      if (dead) return;
      fill(box, );
      if (!reply.ok) { put(box, errorState(reply)); return; }
      if (!reply.data.items.length) put(box, emptyState("Alles erledigt", "Es gibt keine offenen Meldungen."));
      else put(box, ...reply.data.items.map(card));
    })();
    return { element: el, title: "Moderation", destroy() { dead = true; } };
  };

  // ------------------------------------------------------------------------------------------- sign in
  function authFrame(title, subtitle, content, footer) {
    return h("div", { class: "auth-page" }, h("div", { class: "auth-card" },
      link("/", { class: "auth-logo", "aria-label": "yipi" }, window.YipiIcons.logo(), h("span", {}, "yipi")),
      h("h1", {}, title), subtitle ? h("p", { class: "muted" }, subtitle) : null, content, h("p", { class: "auth-switch" }, footer)));
  }

  function passwordField(label, autocomplete) {
    const input = h("input", { class: "field", type: "password", autocomplete, "aria-label": label, maxlength: 200, required: true });
    const toggle = h("button", { class: "icon-btn tiny", type: "button", "aria-label": "Passwort anzeigen", "aria-pressed": "false", onclick: () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("aria-label", show ? "Passwort verbergen" : "Passwort anzeigen");
    } }, icon("lock"));
    return { input, element: h("label", { class: "field-label" }, h("span", {}, label), h("div", { class: "with-action" }, input, toggle)) };
  }

  views.login = function login() {
    if (Y.me) { setTimeout(() => Y.navigate("/", { replace: true }), 0); return { element: h("div"), title: "yipi" }; }
    const name = h("input", { class: "field", autocomplete: "username", "aria-label": "Nutzername oder E-Mail", maxlength: 254, required: true, autocapitalize: "none", spellcheck: "false" });
    const password = passwordField("Passwort", "current-password");
    const error = formError();
    const submit = h("button", { class: "btn primary wide", type: "submit" }, "Anmelden");
    const form = h("form", { class: "auth-form", novalidate: true, onsubmit: async (event) => {
      event.preventDefault();
      showError(error, "");
      if (!name.value.trim() || !password.input.value) { showError(error, "Gib Nutzername und Passwort ein."); return; }
      submit.disabled = true;
      const reply = await Api.post("/login", { login: name.value.trim(), password: password.input.value });
      submit.disabled = false;
      if (!reply.ok) { showError(error, Api.message(reply)); return; }
      Y.setMe(reply.data.me);
      Y.navigate("/", { replace: true });
    } }, field("Nutzername oder E-Mail", name), password.element, error, submit);
    setTimeout(() => name.focus(), 0);
    return { element: authFrame("Anmelden bei yipi", "", form, ["Noch kein Konto? ", link("/i/signup", {}, "Registrieren")]), title: "Anmelden", bare: true };
  };

  views.signup = function signup() {
    if (Y.me) { setTimeout(() => Y.navigate("/", { replace: true }), 0); return { element: h("div"), title: "yipi" }; }
    const handle = h("input", { class: "field", autocomplete: "username", "aria-label": "Nutzername", maxlength: 15, required: true, autocapitalize: "none", spellcheck: "false", "aria-describedby": "handleState" });
    const state = h("small", { class: "hint", id: "handleState", "aria-live": "polite" }, "3 bis 15 Zeichen: Buchstaben, Zahlen und _.");
    const name = h("input", { class: "field", autocomplete: "name", "aria-label": "Anzeigename", maxlength: 50, placeholder: "So sehen dich andere (optional)" });
    const email = h("input", { class: "field", type: "email", autocomplete: "email", "aria-label": "E-Mail", maxlength: 254, placeholder: "Optional" });
    const password = passwordField("Passwort", "new-password");
    const adult = h("input", { type: "checkbox", id: "adult" });
    const error = formError();
    const submit = h("button", { class: "btn primary wide", type: "submit" }, "Konto erstellen");
    let timer = null;
    let token = 0;
    handle.addEventListener("input", () => {
      clearTimeout(timer);
      const value = handle.value;
      state.className = "hint";
      if (!value) { state.textContent = "3 bis 15 Zeichen: Buchstaben, Zahlen und _."; return; }
      if (!/^[A-Za-z0-9_]{3,15}$/.test(value)) { state.textContent = "3 bis 15 Zeichen: Buchstaben, Zahlen und _."; state.classList.add("bad"); return; }
      const mine = ++token;
      state.textContent = "Wird geprüft …";
      timer = setTimeout(async () => {
        const reply = await Api.get(qs("/handle", { handle: value }));
        if (mine !== token || !reply.ok) return;
        state.className = `hint ${reply.data.available ? "good" : "bad"}`;
        state.textContent = reply.data.available ? `@${value} ist frei.` : reply.data.reason === "reserved" ? "Diesen Nutzernamen kannst du nicht nehmen." : "Diesen Nutzernamen gibt es schon.";
      }, 350);
    });
    const form = h("form", { class: "auth-form", novalidate: true, onsubmit: async (event) => {
      event.preventDefault();
      showError(error, "");
      if (!adult.checked) { showError(error, Api.MESSAGES.need_age); return; }
      submit.disabled = true;
      const reply = await Api.post("/signup", { handle: handle.value.trim(), name: name.value, email: email.value.trim(), password: password.input.value, adult: true });
      submit.disabled = false;
      if (!reply.ok) { showError(error, Api.message(reply)); return; }
      Y.setMe(reply.data.me);
      Y.navigate("/", { replace: true });
      toast("Willkommen bei yipi!");
    } },
      field("Nutzername", h("div", { class: "with-prefix" }, h("span", {}, "@"), handle), null), state,
      field("Name", name), field("E-Mail", email, "Freiwillig. Du kannst dich damit anmelden. yipi verschickt keine E-Mails."),
      password.element, h("small", { class: "hint" }, "Mindestens 8 Zeichen. Ein vergessenes Passwort kann nicht zurückgesetzt werden."),
      h("label", { class: "check" }, adult, h("span", {}, "Ich bin mindestens 16 Jahre alt (oder habe die Erlaubnis meiner Eltern) und akzeptiere die ", h("a", { href: "/nutzungsbedingungen", target: "_blank", rel: "noopener" }, "Nutzungsbedingungen"), " sowie die ", h("a", { href: "/datenschutz", target: "_blank", rel: "noopener" }, "Datenschutzerklärung"), ".")),
      error, submit);
    setTimeout(() => handle.focus(), 0);
    return { element: authFrame("Konto erstellen", "Kostenlos, ohne Werbung und ohne Tracking.", form, ["Schon dabei? ", link("/i/login", {}, "Anmelden")]), title: "Registrieren", bare: true };
  };
})();
