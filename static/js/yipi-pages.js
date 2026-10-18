/* Pulse views, part 2 (the file keeps the name yipi-pages.js): messages, settings, moderation, the pages to sign in and sign up, and the
   pages for "not found" and "please sign in". Same shape as part 1: each view is a function (route, ctx) answering {element, title, ...}. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, toast, dialog, confirmBox, pager } = Y;
  const { qs, listLoader, emptyState, errorState, topbar, snippet } = Y;
  const views = Y.views;

  const button = (label, kind, onclick, extra = {}) => h("button", { class: `btn ${kind}`, type: "button", onclick, ...extra }, label);
  const field = (label, input, hint) => h("label", { class: "field-label" }, h("span", {}, label), input, hint ? h("small", { class: "hint" }, hint) : null);
  const formError = () => h("p", { class: "form-error", role: "alert", hidden: true });
  const showError = (box, text) => { box.textContent = text; box.hidden = !text; };

  // ------------------------------------------------------------------------------------ small views
  views.notfound = function notfound() {
    return { element: h("div", { class: "view" }, topbar({ title: "Nicht gefunden" }),
      h("div", { class: "empty big" }, h("div", { class: "empty-logo" }, window.YipiIcons.logo()), h("h2", {}, "Diese Seite gibt es nicht"), h("p", {}, "Vielleicht ist der Link falsch, oder das Konto oder der Beitrag wurde gelöscht."),
        link(Y.HOME, { class: "btn primary" }, "Zur Startseite"))), title: "Nicht gefunden" };
  };

  // ---------------------------------------------------------------------------------------- settings
  const THEMES = [["auto", "Wie das Gerät", "Folgt der Einstellung deines Geräts."], ["light", "Hell", "Weiß mit schwarzer Schrift."], ["dim", "Gedimmt", "Dunkelgrau, schonend für die Augen."], ["dark", "Schwarz", "Tiefschwarz, spart Strom auf OLED-Bildschirmen."]];

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
        h("p", { class: "muted small" }, "Pulse verschickt keine E-Mails. Ein vergessenes Passwort lässt sich deshalb nicht zurücksetzen. Bewahre es sicher auf.")),
      h("section", { class: "card danger-zone" }, h("h2", {}, "Konto löschen"),
        h("p", { class: "muted" }, "Dabei werden dein Profil, alle deine Beiträge, Fotos, GIFs, Nachrichten und Likes endgültig gelöscht. Das lässt sich nicht rückgängig machen."),
        button("Konto löschen …", "danger", () => {
          const confirmPassword = h("input", { class: "field", type: "password", autocomplete: "current-password", "aria-label": "Passwort zur Bestätigung", maxlength: 200 });
          const error = formError();
          dialog({ title: "Konto wirklich löschen?", body: h("div", {}, h("p", { class: "dialog-text" }, "Gib zur Bestätigung dein Passwort ein."), confirmPassword, error), actions: [{ label: "Endgültig löschen", kind: "danger", run: async () => {
            const reply = await Api.post("/delete", { password: confirmPassword.value });
            if (!reply.ok) { showError(error, Api.message(reply)); return false; }
            Y.setMe(null);
            Y.navigate(Y.HOME, { replace: true });
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
      empty: emptyState(`Niemand ${kind === "muted" ? "stummgeschaltet" : "blockiert"}`, kind === "muted" ? "Stummgeschaltete Konten tauchen nicht mehr in deinen Listen und Benachrichtigungen auf, merken es aber nicht." : "Blockierte Konten können dir nicht folgen oder schreiben und deine Beiträge nicht sehen."),
    });
    listPager.title = label;
    return listPager;
  }

  function aboutSection() {
    return h("div", { class: "settings-body" },
      h("section", { class: "card" }, h("h2", {}, "Rechtliches"),
        h("ul", { class: "plain-links" }, ["nutzungsbedingungen|Nutzungsbedingungen und Regeln", "datenschutz|Datenschutzerklärung", "impressum|Impressum", "bildnachweise|Bildnachweise (freie GIFs)"].map((entry) => { const [path, text] = entry.split("|"); return h("li", {}, h("a", { href: `/${path}` }, text, icon("chevron"))); }))),
      h("section", { class: "card" }, h("h2", {}, "Hilfe"),
        h("p", { class: "muted small" }, "Beiträge sind öffentlich. Nachrichten sind nur für die Beteiligten sichtbar (zwei Personen oder die Mitglieder einer Gruppe), aber nicht Ende-zu-Ende-verschlüsselt. Etwas Unpassendes siehst du? Tippe beim Beitrag, beim GIF oder beim Profil auf „Melden“. In einem Beitrag gehen bis zu 3 Fotos, ein GIF oder eine Umfrage. Games und Videos kommen bald.")),
      h("section", { class: "card" }, h("h2", {}, "Über Pulse"),
        h("p", { class: "muted" }, "Pulse ist ein unabhängiges, kostenloses Projekt, ohne Werbung und ohne Tracking. Es speichert nur ein Anmelde-Cookie, wenn du dich anmeldest, und deine Einstellungen im Browser. Nex, die KI, antwortet mit Hilfe eines KI-Dienstes (Groq): was du Nex schreibst, wird dafür an den Server und von dort an den Dienst geschickt, aber nicht gespeichert.")));
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
      return { element: h("div", { class: "view" }, topbar({ back: true, title: "Einstellungen" }), h("div", { class: "settings-list" }, rows)), title: "Einstellungen" };
    }
    const entry = SECTIONS.find(([id]) => id === section);
    if (!entry) return views.notfound();
    const el = h("div", { class: "view" }, topbar({ back: "/settings", title: entry[1] }));
    let destroy = null;
    if (section === "account") put(el, accountSection());
    else if (section === "display") put(el, displaySection());
    else if (section === "about") put(el, aboutSection());
    else { const listPager = relationSection(section); put(el, listPager.element); destroy = () => listPager.destroy(); }
    return { element: el, title: entry[1], destroy };
  };

  // -------------------------------------------------------------------------------------- moderation
  const REASON_LABEL = { spam: "Spam", abuse: "Belästigung", hate: "Hass", violence: "Gewalt", illegal: "Illegal", self_harm: "Selbstverletzung", factcheck: "Fact Check falsch", other: "Sonstiges" };

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
      const target = report.gifId ? (report.gif ? `GIF von @${report.handle}` : "GIF (gelöscht)") : report.postId ? (report.text ? `Beitrag von @${report.handle}` : "Beitrag (gelöscht)") : `Profil @${report.handle}`;
      const element = h("article", { class: "report-card" },
        h("div", { class: "report-top" }, h("span", { class: "tag" }, REASON_LABEL[report.reason] || report.reason), h("b", {}, target), Y.timeEl(report.createdAt)),
        report.text ? h("blockquote", {}, report.text) : null,
        report.gif ? h("img", { class: "report-gif", src: report.gif.url, alt: report.gif.title || "gemeldetes GIF", width: report.gif.width, height: report.gif.height }) : null,
        report.gif && report.gif.title ? h("p", { class: "muted small" }, `Name: ${report.gif.title}`) : null,
        report.note ? h("p", { class: "muted" }, `Anmerkung: ${report.note}`) : null,
        h("p", { class: "muted small" }, `Gemeldet von @${report.reporter || "?"}`),
        h("div", { class: "report-actions" },
          report.handle ? link(`/${report.handle}`, { class: "btn ghost small" }, "Profil ansehen") : null,
          report.postId && !report.postGone ? button("Beitrag löschen", "danger small", () => act(report, "delete_post", element)) : null,
          report.gifId && !report.gifGone ? button("GIF löschen", "danger small", () => act(report, "delete_gif", element)) : null,
          report.reason === "factcheck" && report.postId && !report.postGone ? button("Fact Check entfernen", "primary small", () => act(report, "clear_factcheck", element)) : null,
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
    return h("div", { class: "auth-page" },
      h("aside", { class: "auth-hero" },
        h("span", { class: "auth-hero-logo" }, window.YipiIcons.logo()),
        h("h2", {}, "Was gerade passiert."),
        h("ul", { class: "auth-points" },
          h("li", {}, icon("feather"), h("span", {}, "Kurze Beiträge, Fotos, GIFs und Videos")),
          h("li", {}, icon("playCircle"), h("span", {}, "Videos zum Scrollen, wie bei TikTok")),
          h("li", {}, icon("users"), h("span", {}, "Chats und Gruppen mit deinen Freunden")),
          h("li", {}, icon("gamepad"), h("span", {}, "Spiele, direkt hier")),
          h("li", {}, icon("nexmark"), h("span", {}, "Nex, die KI, hilft dir weiter")))),
      h("div", { class: "auth-card" },
        link(Y.HOME, { class: "auth-logo", "aria-label": "Pulse" }, window.YipiIcons.logo(), h("span", {}, "Pulse")),
        h("h1", {}, title), subtitle ? h("p", { class: "muted" }, subtitle) : null, content, h("p", { class: "auth-switch" }, footer),
        h("p", { class: "auth-legal" }, h("a", { href: "/nutzungsbedingungen" }, "Nutzungsbedingungen"), h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"))));
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

  /* Where a successful sign-in goes: to the address that was asked for (the page to sign in is shown in place of it), or to Home. */
  const afterSignIn = (route) => (route && route.name !== "login" && route.name !== "signup" ? location.pathname + location.search : Y.HOME);

  views.login = function login(route) {
    if (Y.me) { setTimeout(() => Y.navigate(Y.HOME, { replace: true }), 0); return { element: h("div"), title: "Pulse" }; }
    const target = afterSignIn(route);
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
      Y.navigate(target, { replace: true });
    } }, field("Nutzername oder E-Mail", name), password.element, error, submit);
    setTimeout(() => name.focus(), 0);
    return { element: authFrame("Anmelden bei Pulse", "Melde dich an, um Pulse zu sehen.", form, ["Noch kein Konto? ", link("/i/signup", {}, "Registrieren")]), title: "Anmelden", bare: true };
  };

  views.signup = function signup() {
    if (Y.me) { setTimeout(() => Y.navigate(Y.HOME, { replace: true }), 0); return { element: h("div"), title: "Pulse" }; }
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
      Y.navigate(Y.HOME, { replace: true });
      toast("Willkommen bei Pulse!");
    } },
      field("Nutzername", h("div", { class: "with-prefix" }, h("span", {}, "@"), handle), null), state,
      field("Name", name), field("E-Mail", email, "Freiwillig. Du kannst dich damit anmelden. Pulse verschickt keine E-Mails."),
      password.element, h("small", { class: "hint" }, "Mindestens 8 Zeichen. Ein vergessenes Passwort kann nicht zurückgesetzt werden."),
      h("label", { class: "check" }, adult, h("span", {}, "Ich bin mindestens 16 Jahre alt (oder habe die Erlaubnis meiner Eltern) und akzeptiere die ", h("a", { href: "/nutzungsbedingungen", target: "_blank", rel: "noopener" }, "Nutzungsbedingungen"), " sowie die ", h("a", { href: "/datenschutz", target: "_blank", rel: "noopener" }, "Datenschutzerklärung"), ".")),
      error, submit);
    setTimeout(() => handle.focus(), 0);
    return { element: authFrame("Konto erstellen", "Kostenlos, ohne Werbung und ohne Tracking.", form, ["Schon dabei? ", link("/i/login", {}, "Anmelden")]), title: "Registrieren", bare: true };
  };
})();
