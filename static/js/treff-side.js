/* Treff side: the list of all groups (with a search and three ways to sort), the welcome page, the dialog to start a group, and the page
   for the person who looks after the site (reports). */
(function () {
  "use strict";

  const Core = window.TreffCore;
  const T = (window.Treff = window.Treff || {});
  const { h, put, fill, icon, logo, avatar, person, toast, formDialog, segmented, count, api, identity, ensure, renderText, store } = T;

  // ------------------------------------------------------------------------------------------- new group
  function createGroup(app) {
    return formDialog({ title: "Neue Gruppe", text: "Eine Gruppe ist ein Platz für ein Thema. Alle können mitlesen und mitschreiben, ohne Konto.",
      fields: [
        { name: "name", label: "Name der Gruppe", max: 40, placeholder: "zum Beispiel: Minecraft Server" },
        { name: "description", label: "Worum geht es? (freiwillig)", type: "area", rows: 3, max: 300, placeholder: "Ein, zwei Sätze für alle, die neu dazukommen" },
        { name: "factsOpen", label: "Alle dürfen Fakten hinzufügen", help: "Unter „Fakten!“ stehen die Dinge, die alle wissen sollten. Ohne Haken darfst nur du sie hinzufügen.", type: "check", value: true },
      ], yes: "Gruppe erstellen",
      run: async (v) => {
        await ensure();
        app.paintMe();
        const data = await api.post("/groups", { name: v.name, description: v.description, factsOpen: v.factsOpen });
        app.go(Core.groupPath(data.group));
        app.refreshSide();
        toast("Die Gruppe ist da. Schreibe die erste Nachricht!");
        return data.group;
      } });
  }

  // ---------------------------------------------------------------------------------------------- the list
  class Sidebar {
    constructor(app) {
      this.app = app;
      this.sort = "active";
      this.query = "";
      this.groups = [];
      this.active = null;
      this.loaded = false;
      this.list = h("div", { class: "group-list", role: "list", "aria-label": "Alle Gruppen" });
      this.search = h("input", { class: "search-input", type: "search", placeholder: "Gruppen suchen", "aria-label": "Gruppen suchen", autocomplete: "off", maxlength: "60" });
      let timer = null;
      this.search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { this.query = this.search.value.trim(); this.refresh(); }, 250); });
      this.me = h("button", { class: "me-chip", type: "button", onclick: () => this.explain() });
      this.intro = h("div", { class: "intro-card", hidden: !!store.get("treff.intro") });
      fill(this.intro, h("h2", {}, "Hier reden alle mit"), h("p", {}, "Such dir eine Gruppe oder starte eine. Du brauchst kein Konto: wenn du schreibst, bist du „user“ mit einer Nummer aus sechs Ziffern."), h("div", { class: "intro-actions" }, h("button", { class: "btn primary small", type: "button", onclick: () => createGroup(app) }, icon("plus"), "Gruppe starten"), h("button", { class: "btn ghost small", type: "button", onclick: () => { store.set("treff.intro", "1"); this.intro.hidden = true; } }, "Verstanden")));
      this.element = h("aside", { class: "side", "aria-label": "Gruppen" },
        h("header", { class: "side-head" }, h("a", { class: "brand", href: "/", onclick: (e) => { e.preventDefault(); app.go("/"); } }, logo(), h("span", {}, "Treff")), h("span", { class: "grow" }), h("button", { class: "btn primary small new-group", type: "button", onclick: () => createGroup(app) }, icon("plus"), h("span", {}, "Gruppe"))),
        h("div", { class: "side-tools" }, h("label", { class: "search" }, icon("search"), this.search), segmented(Core.SORTS, this.sort, (s) => { this.sort = s; this.refresh(); }, "Sortieren")),
        this.intro, this.list,
        h("footer", { class: "side-foot" }, this.me, h("nav", { "aria-label": "Mehr" }, h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"))));
      this.paintMe();
    }

    paintMe() {
      const n = identity.number;
      fill(this.me, icon("users"), h("span", {}, n == null ? "Anonym, ohne Nummer" : `Du bist ${Core.userName(n)}`));
    }

    explain() {
      const n = identity.number;
      toast(n == null ? "Eine Nummer bekommst du automatisch, sobald du das erste Mal etwas schreibst." : `Dein Name hier ist ${Core.userName(n)}. Er gehört zu diesem Browser. Lösche die Browserdaten, und du bekommst eine neue Nummer.`);
    }

    async refresh() {
      try {
        const data = await api.get(`/groups?sort=${this.sort}&q=${encodeURIComponent(this.query)}`);
        this.groups = data.groups;
        this.loaded = true;
        this.paint();
      } catch (error) {
        if (!this.loaded) fill(this.list, h("div", { class: "empty small" }, h("p", {}, error.message), h("button", { class: "btn ghost small", type: "button", onclick: () => this.refresh() }, "Noch einmal")));
      }
    }

    setActive(id) { this.active = id; this.paint(); }

    paint() {
      const seen = this.app.seen;
      if (!this.groups.length) {
        fill(this.list, h("div", { class: "empty small" }, icon("chat"), h("h2", {}, this.query ? "Nichts gefunden" : "Noch keine Gruppen"), h("p", {}, this.query ? "Versuche ein anderes Wort oder starte die Gruppe selbst." : "Starte die erste!"), h("button", { class: "btn primary small", type: "button", onclick: () => createGroup(this.app) }, icon("plus"), "Gruppe starten")));
        return;
      }
      fill(this.list, this.groups.map((g) => {
        const unread = seen[g.id] != null && g.lastMessageId > seen[g.id] && g.id !== this.active;
        const last = g.last;
        const preview = last ? [last.important ? icon("flag") : null, h("span", {}, `${Core.userName(last.user)}: ${last.text}`)] : [h("span", { class: "muted" }, g.description || "Noch keine Nachrichten")];
        return h("a", { class: `group-row${g.id === this.active ? " active" : ""}${unread ? " unread" : ""}`, role: "listitem", href: Core.groupPath(g), onclick: (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); this.app.go(Core.groupPath(g)); } },
          avatar(g.name, Core.initials(g.name)),
          h("span", { class: "row-main" },
            h("span", { class: "row-top" }, h("strong", {}, g.name), h("time", { class: "row-time" }, Core.listTime(last ? last.time : g.createdAt))),
            h("span", { class: "row-bottom" }, h("span", { class: `row-preview${last && last.important ? " important" : ""}` }, preview),
              g.factCount ? h("span", { class: "row-facts", title: `${g.factCount} Fakten` }, icon("idea"), String(g.factCount)) : null, unread ? h("span", { class: "dot", "aria-label": "Neue Nachrichten" }) : null)));
      }));
    }
  }

  // ------------------------------------------------------------------------------------------------ welcome
  function welcome(app) {
    const el = h("section", { class: "welcome scroll" });
    const important = h("div", { class: "welcome-block", hidden: true });
    const cards = h("div", { class: "welcome-block", hidden: true });
    const feature = (ic, title, text) => h("li", {}, h("span", { class: "feature-ic" }, icon(ic)), h("div", {}, h("b", {}, title), h("span", {}, text)));
    put(el, h("div", { class: "welcome-hero" }, h("div", { class: "hero-logo" }, logo()), h("h1", {}, "Treff"), h("p", { class: "lead" }, "Gruppen zu jedem Thema. Alle können mitlesen und mitschreiben, ohne Konto. Du bist einfach „user“ mit einer Nummer."),
      h("div", { class: "hero-actions" }, h("button", { class: "btn primary big", type: "button", onclick: () => createGroup(app) }, icon("plus"), "Gruppe erstellen"))),
      h("ul", { class: "features" },
        feature("users", "Ohne Konto", "Schreib einfach los. Deine Nummer bekommst du automatisch."),
        feature("idea", "Fakten!", "Die Dinge, die alle wissen sollten: Server-Adresse, Links, Regeln."),
        feature("flag", "Wichtig!", "Wichtiges markieren: es steht oben und auf der Startseite."),
        feature("copy", "Alles zum Kopieren", "Server-Adressen und Code kopierst du mit einem Tipp.")),
      important, cards);
    const paintCards = () => {
      const top = [...app.sidebar.groups].sort((a, b) => b.messageCount - a.messageCount).slice(0, 6);
      if (!top.length) { cards.hidden = true; return; }
      cards.hidden = false;
      fill(cards, h("h2", {}, "Beliebte Gruppen"), h("div", { class: "card-grid" }, top.map((g) => h("a", { class: "group-card-link", href: Core.groupPath(g), onclick: (e) => { e.preventDefault(); app.go(Core.groupPath(g)); } }, avatar(g.name, Core.initials(g.name), "big"), h("strong", {}, g.name), h("small", {}, g.description || `${count(g.messageCount)} Nachrichten`), h("span", { class: "muted small" }, `${count(g.messageCount)} Nachrichten${g.factCount ? ` · ${g.factCount} Fakten` : ""}`)))));
    };
    paintCards();
    el.refresh = paintCards;
    api.get("/important").then((data) => {
      if (!data.messages.length) return;
      important.hidden = false;
      fill(important, h("h2", {}, h("span", { class: "tag-important inline" }, icon("flag"), "Wichtig jetzt")),
        h("div", { class: "important-list" }, data.messages.map((m) => h("a", { class: "important-item", href: Core.groupPath(m.group), onclick: (e) => { e.preventDefault(); app.go(Core.groupPath(m.group), { jump: m.id }); } },
          h("span", { class: "important-group" }, m.group.name), h("span", { class: "important-text" }, m.text.replace(/\s+/g, " ").slice(0, 160)), h("span", { class: "muted small" }, `${Core.userName(m.user)} · ${Core.listTime(m.time)}`)))));
    }).catch(() => {});
    return el;
  }

  // -------------------------------------------------------------------------------------------------- admin
  function adminView(app) {
    const el = h("section", { class: "admin scroll" });
    const token = h("input", { class: "field", type: "password", placeholder: "Zugangswort", autocomplete: "current-password", "aria-label": "Zugangswort" });
    const out = h("div", { class: "admin-list" });
    let saved = null;
    try { saved = window.sessionStorage.getItem("treff.admin"); } catch (error) { saved = null; }
    const load = async () => {
      const t = token.value || saved;
      if (!t) return;
      try {
        const data = await api.admin("GET", "/admin/reports", t);
        try { window.sessionStorage.setItem("treff.admin", t); } catch (error) { /* not kept */ }
        saved = t;
        fill(out, data.reports.length ? data.reports.map((r) => h("article", { class: "fact-card" },
          h("h3", {}, `${{ message: "Nachricht", fact: "Fakt", group: "Gruppe" }[r.kind]} · ${Core.userName(r.user)}${r.deleted ? " (gelöscht)" : ""}`), h("div", { class: "fact-value" }, r.text), r.reason ? h("p", { class: "muted small" }, `Grund: ${r.reason}`) : null,
          h("div", { class: "fact-foot" }, h("a", { class: "link", href: `/g/${r.group}` }, "Gruppe öffnen"), h("span", { class: "fact-actions" },
            h("button", { class: "btn small danger", type: "button", onclick: async () => { await api.admin("POST", `/admin/reports/${r.id}`, saved, { action: "delete" }); load(); } }, "Löschen"),
            h("button", { class: "btn small ghost", type: "button", onclick: async () => { await api.admin("POST", `/admin/reports/${r.id}`, saved, { action: "dismiss" }); load(); } }, "In Ordnung"))))) : h("p", { class: "muted" }, "Keine offenen Meldungen."));
      } catch (error) { fill(out, h("p", { class: "form-error" }, error.code === "not_found" ? "Die Verwaltung ist nicht eingeschaltet (TREFF_ADMIN_TOKEN fehlt)." : error.code === "forbidden" ? "Das Zugangswort stimmt nicht." : error.message)); }
    };
    put(el, h("header", { class: "admin-head" }, h("button", { class: "icon-btn", type: "button", "aria-label": "Zurück", onclick: () => app.go("/") }, icon("back")), h("h1", {}, "Meldungen")),
      h("form", { class: "admin-form", onsubmit: (e) => { e.preventDefault(); load(); } }, token, h("button", { class: "btn primary", type: "submit" }, "Anzeigen")), out);
    if (saved) load();
    return el;
  }

  Object.assign(T, { Sidebar, welcome, adminView, createGroup });
})();
