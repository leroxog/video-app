/* Nex views, part 2 (the file keeps the name yipi-pages.js): messages, settings, moderation, the pages to sign in and sign up, and the
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
        h("p", { class: "muted small" }, "Nex verschickt keine E-Mails. Ein vergessenes Passwort lässt sich deshalb nicht zurücksetzen. Bewahre es sicher auf.")),
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
    let current = "light";
    try { current = localStorage.getItem("yipi.theme") || "light"; } catch (error) { /* storage blocked */ }
    const group = h("div", { class: "choices big", role: "radiogroup", "aria-label": "Darstellung" });
    for (const [id, label, text] of THEMES) {
      const input = h("input", { type: "radio", name: "theme", value: id, onchange: () => Y.setTheme(id) });
      input.checked = id === current;
      put(group, h("label", { class: `choice theme-${id}` }, input, h("span", { class: "choice-text" }, h("b", {}, label), h("small", {}, text))));
    }
    const tones = h("input", { type: "checkbox", id: "tones", "aria-label": "Töne" });
    tones.checked = Y.sound.enabled;
    tones.addEventListener("change", () => Y.sound.set(tones.checked));
    return h("div", { class: "settings-body" }, h("section", { class: "card" }, h("h2", {}, "Darstellung"), group),
      h("section", { class: "card" }, h("h2", {}, "Töne"), h("label", { class: "toggle-row", for: "tones" }, h("span", {}, "Kleine Töne beim Tippen, Liken und Senden"), tones),
        h("p", { class: "muted small" }, "Die Töne werden auf deinem Gerät erzeugt. Beim Aufnehmen in der Kamera sind sie aus.")));
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

  function aiSection() {
    const box = h("input", { type: "checkbox", id: "hide-ai", "aria-label": "KI-Konten ausblenden" });
    box.checked = !!(Y.me && Y.me.hideAi);
    box.addEventListener("change", async () => {
      const reply = await Api.post("/settings/ai", { hide: box.checked });
      if (!reply.ok) { box.checked = !box.checked; toast(Api.message(reply)); return; }
      Y.me.hideAi = reply.data.hideAi;
      toast(reply.data.hideAi ? "KI-Konten sind für dich ausgeblendet." : "KI-Konten sind wieder da.");
    });
    return h("div", { class: "settings-body" },
      h("section", { class: "card" }, h("h2", {}, "KI-Konten"),
        h("p", { class: "muted" }, "Auf Nex gibt es etwa tausend Konten, die eine KI betreibt. Sie schreiben, antworten, liken und stimmen in Umfragen ab, damit hier etwas los ist. Sie sind überall mit „KI“ gekennzeichnet und keine Menschen."),
        h("label", { class: "toggle-row", for: "hide-ai" }, h("span", {}, "KI-Konten für mich ausblenden"), box),
        h("p", { class: "muted small" }, "Ausgeblendet siehst du keine Beiträge, Antworten und Likes von KI-Konten mehr, und sie schreiben dir nicht. Einzelne Konten kannst du auch blockieren oder stummschalten.")));
  }

  function aboutSection() {
    return h("div", { class: "settings-body" },
      h("section", { class: "card" }, h("h2", {}, "Rechtliches"),
        h("ul", { class: "plain-links" }, ["nutzungsbedingungen|Nutzungsbedingungen und Regeln", "datenschutz|Datenschutzerklärung", "impressum|Impressum", "bildnachweise|Bildnachweise (freie GIFs)"].map((entry) => { const [path, text] = entry.split("|"); return h("li", {}, h("a", { href: `/${path}` }, text, icon("chevron"))); }))),
      h("section", { class: "card" }, h("h2", {}, "Hilfe"),
        h("p", { class: "muted small" }, "Beiträge sind öffentlich. Nachrichten sind nur für die Beteiligten sichtbar (zwei Personen oder die Mitglieder einer Gruppe), aber nicht Ende-zu-Ende-verschlüsselt. Etwas Unpassendes siehst du? Tippe beim Beitrag, beim GIF oder beim Profil auf „Melden“. In einem Beitrag gehen bis zu 3 Fotos, ein GIF, eine Umfrage oder ein Video (bis 30 Sekunden). Mit einem Doppeltipp gibst du einem Beitrag oder Video ein Like und einer Nachricht ein Herz. Ein Video speicherst du über „Teilen“, dann bekommt es ein Nex-Wasserzeichen mit dem Namen der Person, die es gemacht hat. In der Kamera spielst du Spiele und nimmst sie auf, dort gibt es auch die Bestenlisten. Mit der Chat-Sperre (Einstellungen) kommst du in deine Chats nur mit deiner Wisch-Kombination.")),
      h("section", { class: "card" }, h("h2", {}, "Nex weitersagen"),
        h("p", { class: "muted" }, "Zeig den QR-Code von Nex: Wer ihn scannt, kommt direkt hierher."),
        h("button", { class: "btn primary", type: "button", onclick: () => Y.qr.dialog({ path: "/", title: "Nex weitersagen", subtitle: "Scannen öffnet Nex." }) }, icon("qr"), "QR-Code von Nex")),
      h("section", { class: "card" }, h("h2", {}, "Über Nex"),
        h("p", { class: "muted" }, "Nex ist ein unabhängiges, kostenloses Projekt, ohne Werbung und ohne Tracking. Es speichert nur ein Anmelde-Cookie, wenn du dich anmeldest, und deine Einstellungen im Browser. Nex AI, die KI, antwortet mit Hilfe eines KI-Dienstes (Groq): was du Nex AI schreibst, wird dafür an den Server und von dort an den Dienst geschickt, aber nicht gespeichert.")));
  }

  views.settings = function settings(route, ctx) {
    const section = route.section;
    const SECTIONS = [
      ["account", "Dein Konto", "Passwort, E-Mail und Konto löschen", "user", true],
      ["display", "Darstellung", "Hell, gedimmt oder dunkel", "sun", false],
      ["push", "Mitteilungen", "Auf diesem Gerät bei Likes, Nachrichten und neuen Followern", "bell", true],
      ["chatlock", "Chat-Sperre", "Chats nur mit deiner Wisch-Kombination öffnen", "lock", true],
      ["ai", "KI-Konten", "Konten von KI auf Nex ein- oder ausblenden", "sparkle", true],
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
    else if (section === "chatlock") put(el, Y.chatLockSettings());
    else if (section === "push") put(el, Y.pushSettings());
    else if (section === "ai") put(el, aiSection());
    else if (section === "about") put(el, aboutSection());
    else { const listPager = relationSection(section); put(el, listPager.element); destroy = () => listPager.destroy(); }
    return { element: el, title: entry[1], destroy };
  };

  // -------------------------------------------------------------------------------------- moderation
  const REASON_LABEL = { spam: "Spam", abuse: "Belästigung", hate: "Hass", violence: "Gewalt", illegal: "Illegal", self_harm: "Selbstverletzung", factcheck: "Fact Check falsch", other: "Sonstiges" };

  /* The card of the admins: how much room the files take (in the database and in R2) and the two buttons that move the files to R2 and give the room back. */
  function storageCard() {
    const size = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2).replace(".", ",")} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e5) / 10} MB`.replace(".", ",") : `${Math.round(bytes / 1e3)} KB`);
    const NAMES = { media: "Fotos und Videos von Beiträgen", file: "Dateien in Chats", gif: "GIFs" };
    const info = h("div", { class: "storage-info" }, h("p", { class: "muted small" }, "Wird geladen …"));
    const status = h("p", { class: "muted small", role: "status" });
    const move = button("Alles nach R2 verschieben", "primary small", () => moveAll());
    const tidy = button("Datenbank aufräumen", "ghost small", () => compact());
    const card = h("section", { class: "card storage-card" }, h("h2", {}, "Speicher"), info, status, h("div", { class: "report-actions" }, move, tidy));
    async function load() {
      const reply = await Api.get("/admin/storage");
      if (!reply.ok) { fill(info, h("p", { class: "muted small" }, Api.message(reply))); return null; }
      const data = reply.data;
      const rows = data.tables.map((table) => h("li", {}, h("b", {}, NAMES[table.name] || table.name), `: ${table.inDatabase} in der Datenbank (${size(table.bytesInDatabase)}), ${table.inR2} in R2 (${size(table.bytesInR2)})`));
      fill(info,
        h("p", {}, data.r2 ? "R2 ist eingerichtet: neue Dateien gehen dorthin." : "R2 ist noch nicht eingerichtet: alle Dateien liegen in der Datenbank."),
        data.databaseBytes != null ? h("p", {}, `Die Datenbank ist ${size(data.databaseBytes)} groß.`) : null,
        h("ul", { class: "plain-list" }, rows));
      move.disabled = !data.r2 || !data.tables.some((table) => table.inDatabase > 0);
      return data;
    }
    async function moveAll() {
      move.disabled = true;
      let total = 0;
      for (let round = 0; round < 400; round += 1) {
        const reply = await Api.post("/admin/storage/move");
        if (!reply.ok) { status.textContent = Api.message(reply); break; }
        total += reply.data.moved;
        status.textContent = `${total} Dateien verschoben, noch ${reply.data.remaining} übrig${reply.data.failed ? `, ${reply.data.failed} Fehler` : ""} …`;
        if (reply.data.remaining === 0 || (reply.data.moved === 0 && reply.data.failed > 0)) break;
      }
      await load();
      if (!status.textContent.includes("Fehler") && status.textContent.includes("noch 0")) status.textContent = `Fertig: ${total} Dateien liegen jetzt in R2. Mit „Datenbank aufräumen“ gibst du den Platz frei.`;
    }
    async function compact() {
      if (!(await confirmBox({ title: "Datenbank aufräumen?", text: "Die Tabellen mit den Dateien werden für kurze Zeit gesperrt (Uploads dauern dann einen Moment). Mach das am besten, wenn wenig los ist.", yes: "Aufräumen" }))) return;
      tidy.disabled = true;
      status.textContent = "Räume auf …";
      const reply = await Api.post("/admin/storage/compact");
      status.textContent = reply.ok ? `Fertig. Die Datenbank ist jetzt ${size(reply.data.databaseBytes)} groß.` : Api.message(reply);
      tidy.disabled = false;
      load();
    }
    load();
    return card;
  }

  /* The card of the admins for the AI accounts: how many there are, what they did, on and off, and how lively they are. */
  function agentCard() {
    const info = h("p", { class: "muted small" }, "Wird geladen …");
    const on = h("input", { type: "checkbox", id: "agents-on", "aria-label": "KI-Konten aktiv" });
    const pace = h("select", { class: "field", "aria-label": "Wie lebhaft" }, ["ruhig", "normal", "lebhaft"].map((name) => h("option", { value: name }, name[0].toUpperCase() + name.slice(1))));
    const status = h("p", { class: "muted small", role: "status" });
    const card = h("section", { class: "card" }, h("h2", {}, "KI-Konten"), info,
      h("label", { class: "toggle-row", for: "agents-on" }, h("span", {}, "Aktiv (schreiben, antworten, liken)"), on),
      h("label", { class: "toggle-row" }, h("span", {}, "Wie lebhaft"), pace), status);
    function show(data) {
      fill(info, `${data.accounts} von ${data.target} Konten · ${data.posts24h} Beiträge und Antworten in 24 Stunden · ${data.llm ? "Texte von der KI" : "Texte aus Vorlagen (kein KI-Dienst)"}${data.envOn ? "" : " · per Umgebungsvariable ausgeschaltet"}${data.lastTurn ? ` · zuletzt aktiv um ${new Date(data.lastTurn).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr` : ""}`);
      on.checked = data.enabled;
      pace.value = data.activity;
    }
    async function send(change) {
      const reply = await Api.post("/admin/agents", change);
      status.textContent = reply.ok ? "Gespeichert." : Api.message(reply);
      if (reply.ok) show(reply.data);
    }
    on.addEventListener("change", () => send({ enabled: on.checked }));
    pace.addEventListener("change", () => send({ activity: pace.value }));
    Api.get("/admin/agents").then((reply) => { if (reply.ok) show(reply.data); else fill(info, Api.message(reply)); });
    return card;
  }

  views.moderation = function moderation() {
    if (!Y.me || !Y.me.isAdmin) return views.notfound();
    const box = h("div", { class: "reports" });
    const el = h("div", { class: "view" }, topbar({ title: "Moderation", sub: "Offene Meldungen" }), agentCard(), storageCard(), box);
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

  // ------------------------------------------------------------------------------------------- sign in and sign up
  /* The frame of both pages: at the left (above, on a phone) the text of Nex with a few playful lines, at the right (below) the card. */
  function authFrame(title, subtitle, content, footer) {
    const points = [["📹", "Videos zum Scrollen, wie bei TikTok"], ["💬", "Chats und Gruppen mit deinen Freunden"], ["🎮", "Spiele vor deiner Selfie-Kamera, als Clip posten"], ["✨", "Nex, die KI, hilft dir weiter"]];
    return h("div", { class: "auth-page" },
      h("aside", { class: "auth-hero" },
        h("span", { class: "auth-hero-logo" }, window.YipiIcons.logo()),
        h("h2", {}, "Was gerade passiert."),
        h("p", { class: "auth-lead" }, "Beiträge, Videos, Chats und Spiele an einem Ort. Kostenlos, ohne Werbung."),
        h("ul", { class: "auth-points" }, points.map(([face, text], k) => h("li", { style: `animation-delay:${0.15 + k * 0.12}s` }, h("span", { class: "auth-face", "aria-hidden": "true" }, face), h("span", {}, text))))),
      h("div", { class: "auth-card" },
        link(Y.HOME, { class: "auth-logo", "aria-label": "Nex" }, window.YipiIcons.logo(), h("span", {}, "Nex")),
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

  const PREFIXES = [["+49", "Deutschland"], ["+43", "Österreich"], ["+41", "Schweiz"], ["+352", "Luxemburg"], ["+31", "Niederlande"], ["+32", "Belgien"], ["+33", "Frankreich"], ["+39", "Italien"], ["+34", "Spanien"], ["+44", "Großbritannien"], ["+48", "Polen"], ["+90", "Türkei"], ["+7", "Russland"], ["+380", "Ukraine"], ["+1", "USA, Kanada"]];

  /* A phone number in two parts: the country code and the rest (without the 0 at the front); .value() is "+491511234567" (or "" when empty). */
  function phoneField() {
    const prefix = h("select", { class: "field prefix", "aria-label": "Landesvorwahl" }, PREFIXES.map(([code, name]) => h("option", { value: code }, `${code} ${name}`)));
    const number = h("input", { class: "field", type: "tel", inputmode: "tel", autocomplete: "tel-national", "aria-label": "Telefonnummer", maxlength: 18, placeholder: "151 12345678" });
    return { element: h("label", { class: "field-label" }, h("span", {}, "Telefonnummer"), h("div", { class: "phone-row" }, prefix, number)), input: number,
      value: () => { const rest = number.value.replace(/[^\d]/g, "").replace(/^0+/, ""); return rest ? `${prefix.value}${rest}` : ""; } };
  }

  /* One of the three wheels of the birthday (day, month, year), turned with a finger like the date of TikTok. */
  const ITEM = 44;
  function wheel(label, items, start, onChange) {
    let index = start;
    let list = null;
    const element = h("div", { class: "wheel" });
    function build(values, at) {
      index = Math.max(0, Math.min(values.length - 1, at));
      list = h("div", { class: "wheel-list", role: "listbox", tabindex: "0", "aria-label": label }, values.map((text, k) => h("div", { class: "wheel-item", role: "option", "aria-selected": String(k === index), onclick: () => list.scrollTo({ top: k * ITEM, behavior: "smooth" }) }, text)));
      let frame = 0;
      list.addEventListener("scroll", () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const next = Math.max(0, Math.min(values.length - 1, Math.round(list.scrollTop / ITEM)));
          if (next !== index) { index = next; paint(); onChange?.(index); }
        });
      }, { passive: true });
      list.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); list.scrollTo({ top: (index + (event.key === "ArrowDown" ? 1 : -1)) * ITEM, behavior: "smooth" }); }
      });
      fill(element, list, h("span", { class: "wheel-glass", "aria-hidden": "true" }));
      paint();
      setTimeout(() => { list.scrollTop = index * ITEM; }, 0);
    }
    function paint() { [...list.children].forEach((child, k) => { child.classList.toggle("on", k === index); child.setAttribute("aria-selected", String(k === index)); }); }
    build(items, start);
    return { element, get index() { return index; }, replace: build, sync() { setTimeout(() => { if (list) list.scrollTop = index * ITEM; }, 0); } };
  }

  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const daysIn = (month, year) => new Date(year, month + 1, 0).getDate();

  /* The three wheels together: .date() gives {year, month (1-12), day}, .age() the age in years. */
  function birthdayWheels(onChange) {
    const now = new Date();
    const years = Array.from({ length: 101 }, (_, k) => now.getFullYear() - k);
    const state = { year: now.getFullYear() - 18, month: 5, day: 15 };
    const dayWheel = wheel("Tag", Array.from({ length: daysIn(state.month, state.year) }, (_, k) => String(k + 1)), state.day - 1, (k) => { state.day = k + 1; changed(); });
    const monthWheel = wheel("Monat", MONTHS, state.month, (k) => { state.month = k; fixDays(); changed(); });
    const yearWheel = wheel("Jahr", years.map(String), years.indexOf(state.year), (k) => { state.year = years[k]; fixDays(); changed(); });
    function fixDays() {
      const count = daysIn(state.month, state.year);
      if (dayWheel.element.querySelector(".wheel-list").children.length !== count) { state.day = Math.min(state.day, count); dayWheel.replace(Array.from({ length: count }, (_, k) => String(k + 1)), state.day - 1); }
    }
    function changed() { onChange?.(); }
    const age = () => {
      const today = new Date();
      return today.getFullYear() - state.year - ((today.getMonth() < state.month || (today.getMonth() === state.month && today.getDate() < state.day)) ? 1 : 0);
    };
    return { element: h("div", { class: "wheels", role: "group", "aria-label": "Geburtstag" }, dayWheel.element, monthWheel.element, yearWheel.element),
      date: () => ({ year: state.year, month: state.month + 1, day: state.day }), age, sync() { dayWheel.sync(); monthWheel.sync(); yearWheel.sync(); },
      iso: () => `${String(state.year).padStart(4, "0")}-${String(state.month + 1).padStart(2, "0")}-${String(state.day).padStart(2, "0")}` };
  }

  const GOOGLE_NOTES = { off: "Die Anmeldung mit Google ist hier noch nicht eingerichtet. Nimm einen anderen Weg.", error: "Das hat mit Google nicht geklappt. Versuch es noch einmal oder nimm einen anderen Weg.", busy: "Gerade zu viele Versuche. Warte einen Moment.", suspended: "Dieses Konto ist gesperrt." };
  function googleStart() {
    if (Y.googleReady) { location.assign("/api/yipi/google/start"); return; }
    dialog({ title: "Mit Google", body: h("div", {}, h("p", { class: "dialog-text" }, "Die Anmeldung mit Google ist hier noch nicht eingerichtet: dafür muss die Seite erst bei Google als App angemeldet werden. Bis dahin geht es mit Nutzername, E-Mail oder Telefonnummer.")) });
  }

  views.login = function login(route) {
    if (Y.me) { setTimeout(() => Y.navigate(Y.HOME, { replace: true }), 0); return { element: h("div"), title: "Nex" }; }
    const target = afterSignIn(route);
    const note = GOOGLE_NOTES[new URLSearchParams(location.search).get("google")] || "";
    const holder = h("div", { class: "auth-swap" });
    let method = "name";                                         // "name", "phone" or "email"

    const LABELS = { name: ["Nutzername", "Mit Nutzername anmelden", "at"], phone: ["Telefonnummer", "Mit Telefonnummer anmelden", "phone"], email: ["E-Mail", "Mit E-Mail anmelden", "mail"] };
    function draw() {
      const error = formError();
      if (note && method === "name" && !draw.shown) { showError(error, note); draw.shown = true; }
      const password = passwordField("Passwort", "current-password");
      const phone = method === "phone" ? phoneField() : null;
      const name = method === "phone" ? null : h("input", { class: "field", type: method === "email" ? "email" : "text", autocomplete: method === "email" ? "email" : "username", "aria-label": method === "email" ? "E-Mail-Adresse" : "Nutzername", maxlength: 254, required: true, autocapitalize: "none", spellcheck: "false", placeholder: method === "email" ? "du@beispiel.de" : "@nutzername" });
      const submit = h("button", { class: "btn primary wide", type: "submit" }, "Anmelden");
      const form = h("form", { class: "auth-form", novalidate: true, onsubmit: async (event) => {
        event.preventDefault();
        showError(error, "");
        const who = phone ? phone.value() : name.value.trim();
        if (!who || !password.input.value) { showError(error, method === "phone" ? "Gib deine Telefonnummer und das Passwort ein." : method === "email" ? "Gib deine E-Mail und das Passwort ein." : "Gib Nutzername und Passwort ein."); return; }
        submit.disabled = true;
        const reply = await Api.post("/login", { login: who, password: password.input.value });
        submit.disabled = false;
        if (!reply.ok) { showError(error, Api.message(reply)); return; }
        Y.setMe(reply.data.me);
        Y.navigate(target, { replace: true });
      } }, phone ? phone.element : field(LABELS[method][0], name), password.element, error, submit);
      const others = Object.keys(LABELS).filter((key) => key !== method).map((key) => h("button", { class: "alt-btn", type: "button", onclick: () => { method = key; draw(); } }, icon(LABELS[key][2]), h("span", {}, LABELS[key][1])));
      fill(holder, form, h("div", { class: "auth-or" }, h("span", {}, "oder")),
        h("div", { class: "alt-list" }, ...others, h("button", { class: "alt-btn google", type: "button", onclick: googleStart }, icon("google"), h("span", {}, "Mit Google anmelden"))));
      setTimeout(() => (phone ? phone.input : name).focus(), 0);
    }
    draw();
    return { element: authFrame("Willkommen zurück", "Melde dich an und mach dort weiter, wo du aufgehört hast.", holder, ["Noch kein Konto? ", link("/i/signup", {}, "Registrieren")]), title: "Anmelden", bare: true };
  };

  views.signup = function signup(route) {
    if (Y.me) { setTimeout(() => Y.navigate(Y.HOME, { replace: true }), 0); return { element: h("div"), title: "Nex" }; }
    const google = !!route.google;
    const flow = google ? ["birthday", "form"] : ["birthday", "method", "form"];
    const answers = { method: google ? "google" : "name", parents: false, name: "", email: "" };
    const holder = h("div", { class: "auth-swap" });
    const dots = h("div", { class: "steps", "aria-hidden": "true" });
    let at = 0;
    let wheels = null;

    function drawDots() { fill(dots, ...flow.map((_, k) => h("span", { class: `step${k <= at ? " on" : ""}` }))); }
    function go(step) { at = Math.max(0, Math.min(flow.length - 1, step)); drawDots(); draw(); }

    function birthdayStep() {
      wheels = wheels || birthdayWheels(() => update());
      const text = h("p", { class: "age-line", "aria-live": "polite" });
      const parents = h("input", { type: "checkbox", id: "parents" });
      parents.checked = answers.parents;
      const parentsBox = h("label", { class: "check", hidden: true }, parents, h("span", {}, "Meine Eltern erlauben mir, Nex zu benutzen."));
      const next = h("button", { class: "btn primary wide", type: "button" }, "Weiter");
      function update() {
        const age = wheels.age();
        answers.parents = parents.checked;
        if (age < 13) { text.textContent = age < 0 ? "Dieses Datum liegt in der Zukunft." : `Du bist ${age}. Nex gibt es erst ab 13 Jahren.`; text.className = "age-line bad"; }
        else { text.textContent = `Du bist ${age} Jahre alt.`; text.className = "age-line"; }
        parentsBox.hidden = !(age >= 13 && age < 16);
        next.disabled = age < 13 || (age < 16 && !parents.checked);
      }
      parents.addEventListener("change", update);
      next.addEventListener("click", () => { update(); if (!next.disabled) go(at + 1); });
      fill(holder, h("h2", { class: "step-title" }, "Wann hast du Geburtstag?"), h("p", { class: "muted" }, "Dein Geburtstag wird nicht gespeichert und nicht gezeigt. Wir prüfen damit nur dein Alter."),
        wheels.element, text, parentsBox, next);
      wheels.sync();                                              // (a wheel that was taken out of the page and put in again starts at the top)
      update();
    }

    function methodStep() {
      const choose = (method) => { answers.method = method; go(at + 1); };
      const tile = (symbol, title, text, run) => h("button", { class: "method", type: "button", onclick: run }, h("span", { class: "method-ic" }, icon(symbol)), h("span", { class: "method-text" }, h("b", {}, title), h("small", {}, text)), icon("chevron"));
      fill(holder, h("h2", { class: "step-title" }, "Wie möchtest du dich anmelden?"), h("p", { class: "muted" }, "Du kannst dich später auch mit Nutzername und Passwort anmelden."),
        h("div", { class: "method-list" },
          tile("phone", "Telefonnummer", "Es wird keine SMS verschickt", () => choose("phone")),
          tile("mail", "E-Mail", "Auch dafür kommt keine Nachricht", () => choose("email")),
          tile("google", "Google", Y.googleReady ? "Mit deinem Google-Konto" : "Noch nicht eingerichtet", () => { if (Y.googleReady) location.assign("/api/yipi/google/start"); else googleStart(); }),
          tile("at", "Nur Nutzername", "Ohne Telefonnummer und E-Mail", () => choose("name"))),
        h("button", { class: "linklike back-link", type: "button", onclick: () => go(at - 1) }, "← Zurück"));
    }

    function formStep() {
      const handle = h("input", { class: "field", autocomplete: "username", "aria-label": "Nutzername", maxlength: 15, required: true, autocapitalize: "none", spellcheck: "false", "aria-describedby": "handleState" });
      const state = h("small", { class: "hint", id: "handleState", "aria-live": "polite" }, "3 bis 15 Zeichen: Buchstaben, Zahlen und _.");
      const name = h("input", { class: "field", autocomplete: "name", "aria-label": "Anzeigename", maxlength: 50, placeholder: "So sehen dich andere (optional)" });
      name.value = answers.name;
      const phone = answers.method === "phone" ? phoneField() : null;
      const email = answers.method === "email" ? h("input", { class: "field", type: "email", autocomplete: "email", "aria-label": "E-Mail", maxlength: 254, placeholder: "du@beispiel.de" }) : null;
      const password = google ? null : passwordField("Passwort", "new-password");
      const terms = h("input", { type: "checkbox", id: "terms" });
      const error = formError();
      const submit = h("button", { class: "btn primary wide", type: "submit" }, "Konto erstellen");
      let timer = null;
      let token = 0;
      if (google) Api.get("/google/pending").then((reply) => { if (!reply.ok) { toast(Api.message(reply)); Y.navigate("/i/login", { replace: true }); return; } if (!name.value) name.value = reply.data.name || ""; answers.email = reply.data.email || ""; });
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
        if (!terms.checked) { showError(error, "Bitte akzeptiere die Nutzungsbedingungen und die Datenschutzerklärung."); return; }
        const body = { handle: handle.value.trim(), name: name.value, birthday: wheels.iso(), parents: answers.parents };
        if (google) body.google = true;
        else { body.password = password.input.value; if (phone && phone.value()) body.phone = phone.value(); if (email && email.value.trim()) body.email = email.value.trim(); }
        if (phone && !phone.value()) { showError(error, "Gib deine Telefonnummer ein (oder geh zurück und wähle einen anderen Weg)."); return; }
        if (email && !email.value.trim()) { showError(error, "Gib deine E-Mail ein (oder geh zurück und wähle einen anderen Weg)."); return; }
        submit.disabled = true;
        const reply = await Api.post("/signup", body);
        submit.disabled = false;
        if (!reply.ok) { showError(error, Api.message(reply)); return; }
        Y.setMe(reply.data.me);
        toast("Willkommen bei Nex!");
        flow.push("profile");                                   // the account exists: now (if wanted) a banner and a picture
        drawDots();
        go(flow.length - 1);
      } },
        field("Nutzername", h("div", { class: "with-prefix" }, h("span", {}, "@"), handle), null), state,
        field("Name", name),
        phone ? phone.element : null,
        email ? field("E-Mail", email, "Damit kannst du dich anmelden. Nex verschickt keine E-Mails.") : null,
        phone ? h("small", { class: "hint" }, "Die Nummer wird nicht bestätigt, es wird keine SMS verschickt. Sie dient nur zum Anmelden.") : null,
        password ? password.element : null, password ? h("small", { class: "hint" }, "Mindestens 8 Zeichen. Ein vergessenes Passwort kann nicht zurückgesetzt werden.") : null,
        h("label", { class: "check" }, terms, h("span", {}, "Ich akzeptiere die ", h("a", { href: "/nutzungsbedingungen", target: "_blank", rel: "noopener" }, "Nutzungsbedingungen"), " und die ", h("a", { href: "/datenschutz", target: "_blank", rel: "noopener" }, "Datenschutzerklärung"), ".")),
        error, submit);
      fill(holder, h("h2", { class: "step-title" }, google ? "Fast geschafft" : "Dein Konto"), form, h("button", { class: "linklike back-link", type: "button", onclick: () => go(at - 1) }, "← Zurück"));
      setTimeout(() => handle.focus(), 0);
    }

    /* The last step: a banner and a profile picture, both optional; "Überspringen" leaves it out. */
    function profileStep() {
      const me = Y.me;
      const draft = { avatar: null, banner: null };
      const banner = h("div", { class: "edit-banner" });
      const face = h("div", { class: "edit-avatar" });
      const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true, "aria-hidden": "true", tabindex: "-1" });
      const error = formError();
      const next = h("button", { class: "btn primary wide", type: "button", disabled: true }, "Speichern und loslegen");
      let picking = null;
      const finish = () => { for (const kind of ["avatar", "banner"]) if (draft[kind]) URL.revokeObjectURL(draft[kind].url); Y.navigate(Y.HOME, { replace: true }); };
      function drawPics() {
        banner.style.setProperty("--hue", Core.avatarHue(me.handle));
        fill(banner, draft.banner ? h("img", { src: draft.banner.url, alt: "" }) : h("span", { class: "edit-hint" }, "Titelbild"),
          h("div", { class: "edit-tools" }, h("button", { class: "icon-btn glass", type: "button", "aria-label": "Titelbild wählen", onclick: () => { picking = "banner"; picker.click(); } }, icon("image"))));
        fill(face, avatar({ ...me, avatar: draft.avatar ? draft.avatar.url : null }, "xl"),
          h("button", { class: "icon-btn glass", type: "button", "aria-label": "Profilbild wählen", onclick: () => { picking = "avatar"; picker.click(); } }, icon("camera")));
        next.disabled = !draft.avatar && !draft.banner;
      }
      picker.addEventListener("change", async () => {
        const file = picker.files[0];
        picker.value = "";
        if (!file || !picking) return;
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { showError(error, "Das ist kein Foto, das Nex kennt (JPEG, PNG, GIF oder WebP)."); return; }
        showError(error, "");
        try {
          const blob = await Y.prepareImage(file, { crop: picking === "avatar" ? { width: 400, height: 400 } : { width: 1500, height: 500 } });
          if (draft[picking]) URL.revokeObjectURL(draft[picking].url);
          draft[picking] = { blob, url: URL.createObjectURL(blob) };
          drawPics();
        } catch (problem) { showError(error, "Dieses Bild konnte nicht gelesen werden."); }
      });
      next.addEventListener("click", async () => {
        next.disabled = true;
        const payload = {};
        for (const kind of ["avatar", "banner"]) {
          if (!draft[kind]) continue;
          const up = await Api.upload(draft[kind].blob, { alt: "" });
          if (!up.ok) { showError(error, Api.message(up)); next.disabled = false; return; }
          payload[kind] = up.data.media.id;
        }
        const reply = await Api.patch("/profile", payload);
        if (!reply.ok) { showError(error, Api.message(reply)); next.disabled = false; return; }
        Y.setMe({ ...Y.me, ...reply.data.me });
        finish();
      });
      drawPics();
      fill(holder, h("h2", { class: "step-title" }, "Zeig dich"), h("p", { class: "muted" }, "Ein Titelbild und ein Profilbild machen dein Profil persönlicher. Das geht auch später."),
        h("div", { class: "edit-profile signup-pics" }, banner, face), picker, error, next,
        h("button", { class: "linklike back-link skip", type: "button", onclick: finish }, "Überspringen"));
    }

    function draw() { ({ birthday: birthdayStep, method: methodStep, form: formStep, profile: profileStep })[flow[at]](); }
    drawDots();
    draw();
    const content = h("div", {}, dots, holder);
    return { element: authFrame("Konto erstellen", null, content, ["Schon dabei? ", link("/i/login", {}, "Anmelden")]), title: "Registrieren", bare: true };
  };
})();
