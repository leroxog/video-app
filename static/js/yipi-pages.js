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
        h("p", { class: "muted" }, "Dabei werden dein Profil, alle deine Beiträge, Fotos, Sticker, Nachrichten und Likes endgültig gelöscht. Das lässt sich nicht rückgängig machen."),
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

  function aboutSection() {
    return h("div", { class: "settings-body" },
      h("section", { class: "card" }, h("h2", {}, "Rechtliches"),
        h("ul", { class: "plain-links" }, ["nutzungsbedingungen|Nutzungsbedingungen und Regeln", "datenschutz|Datenschutzerklärung", "impressum|Impressum", "bildnachweise|Bildnachweise (freie Sticker)"].map((entry) => { const [path, text] = entry.split("|"); return h("li", {}, h("a", { href: `/${path}` }, text, icon("chevron"))); }))),
      h("section", { class: "card" }, h("h2", {}, "Hilfe"),
        h("p", { class: "muted small" }, "Beiträge sind öffentlich. Nachrichten sind nur für die Beteiligten sichtbar (zwei Personen oder die Mitglieder einer Gruppe), aber nicht Ende-zu-Ende-verschlüsselt. Etwas Unpassendes siehst du? Tippe beim Beitrag, beim Sticker oder beim Profil auf „Melden“. In einem Beitrag gehen bis zu 3 Fotos, ein Sticker, eine Umfrage oder ein Video (bis 30 Sekunden). Mit einem Doppeltipp gibst du einem Beitrag oder Video ein Like und einer Nachricht ein Herz. Ein Video speicherst du über „Teilen“, dann bekommt es ein Nex-Wasserzeichen mit dem Namen der Person, die es gemacht hat. In der Kamera spielst du Spiele und nimmst sie auf, dort gibt es auch die Bestenlisten. Mit der Chat-Sperre (Einstellungen) kommst du in deine Chats nur mit deiner Wisch-Kombination.")),
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
    else if (section === "about") put(el, aboutSection());
    else { const listPager = relationSection(section); put(el, listPager.element); destroy = () => listPager.destroy(); }
    return { element: el, title: entry[1], destroy };
  };

  // -------------------------------------------------------------------------------------- moderation
  const REASON_LABEL = { spam: "Spam", abuse: "Belästigung", hate: "Hass", violence: "Gewalt", illegal: "Illegal", self_harm: "Selbstverletzung", factcheck: "Fact Check falsch", other: "Sonstiges" };

  /* The card of the admins: how much room the files take (in the database and in R2) and the two buttons that move the files to R2 and give the room back. */
  function storageCard() {
    const size = (bytes) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2).replace(".", ",")} GB` : bytes >= 1e6 ? `${Math.round(bytes / 1e5) / 10} MB`.replace(".", ",") : `${Math.round(bytes / 1e3)} KB`);
    const NAMES = { media: "Fotos und Videos von Beiträgen", file: "Dateien in Chats", gif: "Sticker" };
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

  views.moderation = function moderation() {
    if (!Y.me || !Y.me.isAdmin) return views.notfound();
    const box = h("div", { class: "reports" });
    const el = h("div", { class: "view" }, topbar({ title: "Moderation", sub: "Offene Meldungen" }), storageCard(), box);
    let dead = false;

    async function act(report, action, card) {
      const reply = await Api.post(`/moderation/reports/${report.id}`, { action });
      if (!reply.ok) { toast(Api.message(reply)); return; }
      card.remove();
      if (!box.children.length) put(box, emptyState("Alles erledigt", "Es gibt keine offenen Meldungen."));
    }

    function card(report) {
      const target = report.gifId ? (report.gif ? `Sticker von @${report.handle}` : "Sticker (gelöscht)") : report.postId ? (report.text ? `Beitrag von @${report.handle}` : "Beitrag (gelöscht)") : `Profil @${report.handle}`;
      const element = h("article", { class: "report-card" },
        h("div", { class: "report-top" }, h("span", { class: "tag" }, REASON_LABEL[report.reason] || report.reason), h("b", {}, target), Y.timeEl(report.createdAt)),
        report.text ? h("blockquote", {}, report.text) : null,
        report.gif ? h("img", { class: "report-gif", src: report.gif.url, alt: report.gif.title || "gemeldeter Sticker", width: report.gif.width, height: report.gif.height }) : null,
        report.gif && report.gif.title ? h("p", { class: "muted small" }, `Name: ${report.gif.title}`) : null,
        report.note ? h("p", { class: "muted" }, `Anmerkung: ${report.note}`) : null,
        h("p", { class: "muted small" }, `Gemeldet von @${report.reporter || "?"}`),
        h("div", { class: "report-actions" },
          report.handle ? link(`/${report.handle}`, { class: "btn ghost small" }, "Profil ansehen") : null,
          report.postId && !report.postGone ? button("Beitrag löschen", "danger small", () => act(report, "delete_post", element)) : null,
          report.gifId && !report.gifGone ? button("Sticker löschen", "danger small", () => act(report, "delete_gif", element)) : null,
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

  const PREFIXES = [["+49", "Deutschland"], ["+43", "Österreich"], ["+41", "Schweiz"], ["+352", "Luxemburg"], ["+31", "Niederlande"], ["+32", "Belgien"], ["+33", "Frankreich"], ["+39", "Italien"], ["+34", "Spanien"], ["+44", "Großbritannien"], ["+48", "Polen"], ["+90", "Türkei"], ["+7", "Russland"], ["+380", "Ukraine"], ["+1", "USA, Kanada"]];

  /* A phone number in two parts: the country code and the rest (without the 0 at the front); .value() is "+491511234567" (or "" when empty). */
  function phoneField() {
    const prefix = h("select", { class: "field prefix", "aria-label": "Landesvorwahl" }, PREFIXES.map(([code, name]) => h("option", { value: code }, `${code} ${name}`)));
    const number = h("input", { class: "field", type: "tel", inputmode: "tel", autocomplete: "tel-national", "aria-label": "Telefonnummer", maxlength: 18, placeholder: "151 12345678" });
    return { element: h("label", { class: "field-label" }, h("span", {}, "Telefonnummer"), h("div", { class: "phone-row" }, prefix, number)), input: number,
      value: () => { const rest = number.value.replace(/[^\d]/g, "").replace(/^0+/, ""); return rest ? `${prefix.value}${rest}` : ""; } };
  }

  const GOOGLE_NOTES = { off: "Die Anmeldung mit Google ist hier noch nicht eingerichtet. Nimm einen anderen Weg.", error: "Das hat mit Google nicht geklappt. Versuch es noch einmal oder nimm einen anderen Weg.", busy: "Gerade zu viele Versuche. Warte einen Moment.", suspended: "Dieses Konto ist gesperrt." };
  function googleStart() {
    if (Y.googleReady) { location.assign("/api/yipi/google/start"); return; }
    dialog({ title: "Mit Google", body: h("div", {}, h("p", { class: "dialog-text" }, "Die Anmeldung mit Google ist hier noch nicht eingerichtet: dafür muss die Seite erst bei Google als App angemeldet werden. Bis dahin geht es mit Nutzername, E-Mail oder Telefonnummer.")) });
  }

  // the pages to sign in and to sign up are in yipi-auth.js; they use these parts
  Y.authParts = { passwordField, phoneField, googleStart, GOOGLE_NOTES, field, formError, showError };
})();
