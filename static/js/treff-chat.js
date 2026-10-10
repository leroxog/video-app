/* Treff chat: one group -- the messages (new ones arrive by themselves), the strip with the facts, the banner for what is important, the
   box to write in, and the panel with "Fakten!", the important messages and the settings of the group. */
(function () {
  "use strict";

  const Core = window.TreffCore;
  const T = (window.Treff = window.Treff || {});
  const { h, fill, icon, avatar, person, toast, confirmBox, formDialog, menu, segmented, count, api, ensure, copy, renderText, messageEl, store } = T;

  const EMOJIS = ["😀", "😂", "😍", "👍", "🙏", "🎉", "🔥", "😮", "😢", "😡", "🤔", "👀", "✅", "❌", "⭐", "💡", "📌", "⚠️", "❤️", "🎮", "⛏️", "🌍", "📅", "🔗"];
  const GAP = 4 * 60 * 1000;                                  // messages of one person within 4 minutes belong together
  const coarse = () => !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

  const readJSON = (key, fallback) => { try { return JSON.parse(store.get(key)) || fallback; } catch (error) { return fallback; } };

  class Chat {
    constructor(app, id) {
      this.app = app;
      this.id = id;
      this.messages = new Map();                          // id -> message data
      this.order = [];                                    // ids in the order they are shown
      this.nodes = new Map();
      this.facts = [];
      this.group = null;
      this.hasMore = false;
      this.replyTo = null;
      this.important = false;
      this.panelTab = null;
      this.timers = [];
      this.dead = false;
      this.element = h("section", { class: "chat", "aria-label": "Gruppe" }, h("div", { class: "chat-loading" }, h("div", { class: "spinner" })));
    }

    // ------------------------------------------------------------------------------------------------ loading
    async load() {
      let info, list;
      try {
        [info, list] = await Promise.all([api.get(`/groups/${this.id}`), api.get(`/groups/${this.id}/messages`)]);
      } catch (error) {
        if (this.dead) return;
        fill(this.element, h("div", { class: "empty" }, icon("chat"), h("h2", {}, error.code === "not_found" ? "Diese Gruppe gibt es nicht (mehr)" : "Die Gruppe konnte nicht geladen werden"), h("p", {}, error.code === "not_found" ? "Vielleicht wurde sie gelöscht oder der Link ist falsch." : error.message), h("a", { class: "btn primary", href: "/", onclick: (e) => { e.preventDefault(); this.app.go("/"); } }, "Zu allen Gruppen")));
        this.app.title("Nicht gefunden");
        return;
      }
      if (this.dead) return;
      this.group = info.group; this.facts = info.facts;
      for (const m of list.messages) { this.messages.set(m.id, m); }
      this.order = list.messages.map((m) => m.id);
      this.hasMore = list.hasMore;
      this.build();
      this.renderList();
      this.scrollDown(false);
      this.markSeen();
      this.app.title(this.group.name);
      this.timers.push(setInterval(() => this.poll(), 3000), setInterval(() => this.refresh(), 15000));
      this.onVisible = () => { if (!document.hidden) this.poll(); };
      document.addEventListener("visibilitychange", this.onVisible);
    }

    destroy() {
      this.dead = true;
      for (const t of this.timers) clearInterval(t);
      document.removeEventListener("visibilitychange", this.onVisible);
      this.closePanelNow?.();
    }

    // ------------------------------------------------------------------------------------------------- the frame
    build() {
      const g = this.group;
      this.title = h("h1", {}, g.name);
      this.sub = h("p", {});
      this.factsButton = h("button", { class: "btn facts-button", type: "button", onclick: () => this.openPanel("facts") }, icon("idea"), h("span", {}, "Fakten!"), h("b", { class: "badge" }));
      this.head = h("header", { class: "chat-head" },
        h("button", { class: "icon-btn only-small", type: "button", "aria-label": "Zurück zu den Gruppen", onclick: () => this.app.go("/") }, icon("back")),
        h("button", { class: "head-main", type: "button", onclick: () => this.openPanel("group"), "aria-label": "Infos zur Gruppe" }, avatar(g.name, Core.initials(g.name)), h("span", { class: "head-text" }, this.title, this.sub)),
        this.factsButton,
        h("button", { class: "icon-btn hide-small", type: "button", "aria-label": "Gruppe teilen", onclick: () => this.share() }, icon("share")),
        h("button", { class: "icon-btn", type: "button", "aria-label": "Mehr", onclick: (e) => this.groupMenu(e.currentTarget) }, icon("more")));
      this.factsBar = h("div", { class: "facts-bar", hidden: true });
      this.banner = h("div", { class: "important-banner", hidden: true });
      this.scroller = h("div", { class: "messages", role: "log", "aria-live": "polite", "aria-label": "Nachrichten", tabindex: "0" });
      this.scroller.addEventListener("scroll", () => { if (this.atBottom()) this.jumpButton.hidden = true; }, { passive: true });
      this.jumpButton = h("button", { class: "jump-new", type: "button", hidden: true, onclick: () => this.scrollDown(true) }, icon("down"), h("span", {}, "Neue Nachrichten"));
      this.composer = this.buildComposer();
      fill(this.element, this.head, this.factsBar, this.banner, h("div", { class: "messages-wrap" }, this.scroller, this.jumpButton), this.composer);
      this.paintHead();
      this.paintFacts();
      this.paintBanner();
    }

    paintHead() {
      const g = this.group;
      this.title.textContent = g.name;
      this.sub.textContent = `${count(g.messageCount)} ${g.messageCount === 1 ? "Nachricht" : "Nachrichten"} · gegründet von ${Core.userName(g.creator)}${g.lastActivityAt ? ` · aktiv ${Core.listTime(g.lastActivityAt)}` : ""}`;
      const badge = this.factsButton.querySelector(".badge");
      badge.textContent = this.facts.length ? String(this.facts.length) : "";
      badge.hidden = !this.facts.length;
    }

    paintFacts() {
      const chips = this.facts.slice(0, 6).map((f) => {
        const kind = Core.factKind(f.value);
        const body = [h("small", {}, f.title), h("span", {}, f.value)];
        if (kind === "link") return h("a", { class: "fact-chip link", href: Core.safeUrl(f.value), target: "_blank", rel: "noopener noreferrer nofollow ugc", title: f.value }, body, icon("external"));
        return h("button", { class: "fact-chip", type: "button", title: "Kopieren", onclick: () => copy(f.value, f.title) }, body, icon("copy"));
      });
      fill(this.factsBar, chips, h("button", { class: "fact-chip all", type: "button", onclick: () => this.openPanel("facts") }, icon("idea"), h("span", {}, this.facts.length > 6 ? `Alle ${this.facts.length}` : "Fakten!")));
      this.factsBar.hidden = !this.facts.length;
    }

    paintBanner() {
      const dismissed = readJSON("treff.dismissed", {});
      const latest = [...this.order].reverse().map((id) => this.messages.get(id)).find((m) => m && m.important && !m.deleted);
      if (!latest || dismissed[this.id] === latest.id) { this.banner.hidden = true; return; }
      fill(this.banner, icon("flag"), h("button", { class: "banner-main", type: "button", onclick: () => this.jump(latest.id) }, h("b", {}, "Wichtig! "), h("span", {}, `${Core.userName(latest.user)}: ${latest.text.replace(/\s+/g, " ").slice(0, 140)}`)),
        h("button", { class: "icon-btn small", type: "button", "aria-label": "Hinweis ausblenden", onclick: () => { dismissed[this.id] = latest.id; store.set("treff.dismissed", JSON.stringify(dismissed)); this.banner.hidden = true; } }, icon("close")));
      this.banner.hidden = false;
    }

    // --------------------------------------------------------------------------------------------- the messages
    ctx() {
      return this._ctx || (this._ctx = { open: (anchor, m) => this.messageMenu(anchor, m), jump: (id) => this.jump(id), react: (m, e) => this.react(m, e) });
    }

    atBottom() { return this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight < 90; }
    scrollDown(smooth) { this.scroller.scrollTo({ top: this.scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" }); this.jumpButton.hidden = true; }

    continued(prev, m) {
      return !!prev && prev.user === m.user && !prev.deleted && Core.dayLabel(prev.time) === Core.dayLabel(m.time) && new Date(m.time) - new Date(prev.time) < GAP && !m.important && !prev.important && !m.replyTo;
    }

    /* Draws all the messages again (after older ones were loaded or something changed in the middle). */
    renderList() {
      const keep = this.scroller.scrollHeight - this.scroller.scrollTop;
      const parts = [];
      if (this.hasMore) parts.push(h("button", { class: "load-older", type: "button", onclick: () => this.loadOlder() }, "Ältere Nachrichten laden"));
      if (!this.order.length) parts.push(h("div", { class: "empty small" }, icon("chat"), h("h2", {}, "Noch nichts geschrieben"), h("p", {}, "Schreibe die erste Nachricht. Du brauchst kein Konto: du bist dann „user“ mit einer Nummer.")));
      this.nodes.clear();
      let prev = null, day = null;
      for (const id of this.order) {
        const m = this.messages.get(id);
        const label = Core.dayLabel(m.time);
        if (label !== day) { parts.push(h("div", { class: "day", role: "separator" }, h("span", {}, label))); day = label; }
        const el = messageEl(m, this.ctx(), this.continued(prev, m));
        el._data = JSON.stringify(m);
        this.nodes.set(id, el);
        parts.push(el);
        prev = m;
      }
      fill(this.scroller, parts);
      this.scroller.scrollTop = this.scroller.scrollHeight - keep;
      this.lastDay = day;
      this.lastMessage = prev;
    }

    /* Puts new messages at the end. */
    append(list, { scroll } = {}) {
      const stick = scroll || this.atBottom();
      let added = 0;
      for (const m of list) {
        if (this.messages.has(m.id)) continue;
        this.messages.set(m.id, m);
        this.order.push(m.id);
        if (this.order.length === 1) this.scroller.querySelector(".empty")?.remove();
        const label = Core.dayLabel(m.time);
        if (label !== this.lastDay) { this.scroller.append(h("div", { class: "day", role: "separator" }, h("span", {}, label))); this.lastDay = label; }
        const el = messageEl(m, this.ctx(), this.continued(this.lastMessage, m));
        el._data = JSON.stringify(m);
        this.nodes.set(m.id, el);
        this.scroller.append(el);
        this.lastMessage = m;
        added++;
      }
      if (added) {
        this.paintBanner();
        if (stick) this.scrollDown(false); else { this.jumpButton.hidden = false; }
        this.markSeen();
      }
      return added;
    }

    /* A message that changed (a reaction, deleted, marked important) is drawn again in its place. */
    upsert(m) {
      const old = this.messages.get(m.id);
      if (!old) { this.append([m]); return; }
      const now = JSON.stringify(m);
      const el = this.nodes.get(m.id);
      this.messages.set(m.id, m);
      if (!el || el._data === now) return;
      const prevId = this.order[this.order.indexOf(m.id) - 1];
      const fresh = messageEl(m, this.ctx(), this.continued(prevId ? this.messages.get(prevId) : null, m));
      fresh._data = now;
      el.replaceWith(fresh);
      this.nodes.set(m.id, fresh);
      this.paintBanner();
    }

    async poll() {
      if (this.dead || document.hidden || this.polling) return;
      this.polling = true;
      try {
        const last = this.order.length ? this.order[this.order.length - 1] : 0;
        const data = await api.get(`/groups/${this.id}/messages?after=${last}`);
        if (!this.dead && data.messages.length) {
          this.append(data.messages);
          if (this.group) { this.group.messageCount += data.messages.length; this.paintHead(); }
        }
      } catch (error) { /* offline for a moment: the next try */ } finally { this.polling = false; }
    }

    /* Every so often: the newest messages again (reactions, deleted ones), the facts, the numbers. */
    async refresh() {
      if (this.dead || document.hidden) return;
      try {
        const [info, list] = await Promise.all([api.get(`/groups/${this.id}`), api.get(`/groups/${this.id}/messages`)]);
        if (this.dead) return;
        this.group = info.group;
        const factsChanged = JSON.stringify(info.facts) !== JSON.stringify(this.facts);
        this.facts = info.facts;
        for (const m of list.messages) this.upsert(m);
        this.paintHead();
        if (factsChanged) { this.paintFacts(); if (this.panelTab === "facts") this.paintPanel(); }
      } catch (error) { /* try again later */ }
    }

    async loadOlder() {
      const first = this.order[0];
      if (first == null) return;
      try {
        const data = await api.get(`/groups/${this.id}/messages?before=${first}`);
        for (const m of data.messages) this.messages.set(m.id, m);
        this.order = [...data.messages.map((m) => m.id), ...this.order];
        this.hasMore = data.hasMore;
        this.renderList();
      } catch (error) { toast(error.message); }
    }

    async jump(id) {
      let el = this.nodes.get(id);
      for (let tries = 0; !el && this.hasMore && tries < 5; tries++) { await this.loadOlder(); el = this.nodes.get(id); }
      if (!el) { toast("Diese Nachricht ist zu weit oben."); return; }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1600);
    }

    markSeen() { if (this.group) this.app.markSeen(this.id, this.order.length ? this.order[this.order.length - 1] : this.group.lastMessageId); }

    // ------------------------------------------------------------------------------------------------ the composer
    buildComposer() {
      this.input = h("textarea", { class: "compose-input", rows: "1", maxlength: "2000", placeholder: "Nachricht schreiben …", "aria-label": "Deine Nachricht", enterkeyhint: "send" });
      this.input.addEventListener("input", () => this.fit());
      this.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !coarse()) { e.preventDefault(); this.send(); } });
      this.replyBar = h("div", { class: "reply-bar", hidden: true });
      this.flagButton = h("button", { class: "icon-btn", type: "button", "aria-pressed": "false", "aria-label": "Als wichtig markieren", title: "Als „Wichtig!“ markieren: wird oben in der Gruppe und auf der Startseite gezeigt", onclick: () => this.toggleImportant() }, icon("flag"));
      this.emojiButton = h("button", { class: "icon-btn", type: "button", "aria-label": "Emoji einfügen", onclick: (e) => this.emojiMenu(e.currentTarget) }, icon("smile"));
      this.sendButton = h("button", { class: "send-btn", type: "submit", "aria-label": "Senden" }, icon("send"));
      this.counter = h("span", { class: "counter", hidden: true });
      const form = h("form", { class: "composer", novalidate: true }, this.replyBar, h("div", { class: "compose-row" }, this.emojiButton, this.flagButton, h("div", { class: "compose-field" }, this.input, this.counter), this.sendButton));
      form.addEventListener("submit", (e) => { e.preventDefault(); this.send(); });
      return form;
    }

    fit() {
      this.input.style.height = "auto";
      this.input.style.height = `${Math.min(this.input.scrollHeight, 150)}px`;
      const n = this.input.value.length;
      this.counter.hidden = n < 1700;
      this.counter.textContent = `${n}/2000`;
    }

    toggleImportant() {
      this.important = !this.important;
      this.flagButton.setAttribute("aria-pressed", String(this.important));
      this.composer.classList.toggle("is-important", this.important);
      this.input.placeholder = this.important ? "Wichtige Nachricht an alle …" : "Nachricht schreiben …";
      this.input.focus();
    }

    setReply(message) {
      this.replyTo = message;
      if (!message) { this.replyBar.hidden = true; return; }
      fill(this.replyBar, icon("reply"), h("div", { class: "reply-text" }, person(message.user), h("span", {}, message.text.replace(/\s+/g, " ").slice(0, 120))), h("button", { class: "icon-btn small", type: "button", "aria-label": "Antwort abbrechen", onclick: () => this.setReply(null) }, icon("close")));
      this.replyBar.hidden = false;
      this.input.focus();
    }

    emojiMenu(anchor) {
      let entry;
      const box = h("div", { class: "emoji-grid" }, EMOJIS.map((e) => h("button", { type: "button", "aria-label": e, onclick: () => { entry.close(); const at = this.input.selectionStart ?? this.input.value.length; this.input.setRangeText(e, at, this.input.selectionEnd ?? at, "end"); this.input.focus(); this.fit(); } }, e)));
      entry = menu(anchor, [{ node: box }]);
    }

    async send() {
      const text = this.input.value.trim();
      if (!text || this.sending) return;
      this.sending = true;
      this.sendButton.disabled = true;
      try {
        await ensure();
        this.app.paintMe();
        const data = await api.post(`/groups/${this.id}/messages`, { text, replyTo: this.replyTo ? this.replyTo.id : null, important: this.important });
        this.input.value = "";
        this.fit();
        this.setReply(null);
        if (this.important) this.toggleImportant();
        this.append([data.message], { scroll: true });
        this.group.messageCount += 1;
        this.group.lastActivityAt = data.message.time;
        this.paintHead();
        this.app.refreshSide();
      } catch (error) { toast(error.message); } finally { this.sending = false; this.sendButton.disabled = false; this.input.focus(); }
    }

    // ------------------------------------------------------------------------------------------------ actions
    async need() { await ensure(); this.app.paintMe(); }

    async react(message, emoji) {
      try { await this.need(); const data = await api.post(`/messages/${message.id}/react`, { emoji }); this.upsert(data.message); } catch (error) { toast(error.message); }
    }

    messageMenu(anchor, m) {
      const mineOrCreator = m.mine || this.group.mine;
      menu(anchor, [
        { emojis: Core.REACTIONS, marked: m.reactions.filter((r) => r.mine).map((r) => r.emoji), run: (e) => this.react(m, e) },
        { label: "Antworten", icon: "reply", run: () => this.setReply(m) },
        { label: "Als Fakt speichern", icon: "idea", run: () => this.saveAsFact(m) },
        { label: "Text kopieren", icon: "copy", run: () => copy(m.text, "Kopiert") },
        mineOrCreator ? { label: m.important ? "„Wichtig!“ entfernen" : "Als „Wichtig!“ markieren", icon: "flag", run: () => this.markImportant(m, !m.important) } : null,
        !m.mine ? { label: "Melden", icon: "warn", run: () => this.report("message", m.id, "Nachricht melden") } : null,
        mineOrCreator ? { label: "Löschen", icon: "trash", danger: true, run: () => this.deleteMessage(m) } : null,
      ]);
    }

    async markImportant(m, on) {
      try { const data = await api.post(`/messages/${m.id}/important`, { on }); this.upsert(data.message); this.paintBanner(); } catch (error) { toast(error.message); }
    }

    async deleteMessage(m) {
      if (!(await confirmBox({ title: "Nachricht löschen?", text: "Sie verschwindet für alle. Das lässt sich nicht rückgängig machen.", yes: "Löschen", danger: true }))) return;
      try { const data = await api.del(`/messages/${m.id}`); this.upsert(data.message); this.paintBanner(); } catch (error) { toast(error.message); }
    }

    report(kind, id, title) {
      return formDialog({ title, text: "Was stimmt nicht? Eine Person prüft die Meldung und löscht, was nicht in Ordnung ist (zum Beispiel Beleidigungen, Betrug oder rechtswidrige Inhalte).", fields: [{ name: "reason", label: "Grund (freiwillig)", type: "area", rows: 3, max: 200 }], yes: "Melden",
        run: async (v) => { await this.need(); await api.post("/report", { kind, id, reason: v.reason }); toast("Danke, die Meldung ist angekommen."); return true; } });
    }

    saveAsFact(m) {
      const flat = m.text.replace(/\s+/g, " ").trim();
      const guess = Core.factKind(flat) === "link" ? "Link" : Core.factKind(flat) === "address" ? "Adresse" : flat.split(" ").slice(0, 5).join(" ").slice(0, 40);
      return this.factDialog({ title: guess, value: m.text.slice(0, 600) }, "Als Fakt speichern");
    }

    /* The dialog to add (or change) a fact; `fact` has title and value (and an id when it is changed). */
    factDialog(fact, heading = "Fakt hinzufügen") {
      if (!this.group.factsOpen && !this.group.mine) { toast("In dieser Gruppe darf nur die Person, die sie gemacht hat, Fakten hinzufügen."); return null; }
      return formDialog({ title: fact.id ? "Fakt ändern" : heading, text: fact.id ? null : "Ein Fakt steht für alle in der Gruppe unter „Fakten!“: zum Beispiel die Adresse eines Servers, ein Link oder eine Regel.",
        fields: [{ name: "title", label: "Titel", value: fact.title, max: 60, placeholder: "zum Beispiel: Server-Adresse" }, { name: "value", label: "Inhalt", type: "area", rows: 3, value: fact.value, max: 600, placeholder: "zum Beispiel: play.example.net" }], yes: fact.id ? "Speichern" : "Als Fakt speichern",
        run: async (v) => {
          await this.need();
          const data = fact.id ? await api.patch(`/facts/${fact.id}`, { title: v.title, value: v.value }) : await api.post(`/groups/${this.id}/facts`, { title: v.title, value: v.value });
          this.facts = fact.id ? this.facts.map((f) => (f.id === fact.id ? data.fact : f)) : [...this.facts, data.fact];
          this.paintHead(); this.paintFacts();
          if (this.panelTab === "facts") this.paintPanel();
          toast(fact.id ? "Der Fakt wurde geändert." : "Gespeichert unter „Fakten!“.", fact.id ? null : { label: "Ansehen", run: () => this.openPanel("facts") });
          return data.fact;
        } });
    }

    async deleteFact(f) {
      if (!(await confirmBox({ title: "Fakt löschen?", text: `„${f.title}“ wird für alle gelöscht.`, yes: "Löschen", danger: true }))) return;
      try { await api.del(`/facts/${f.id}`); this.facts = this.facts.filter((x) => x.id !== f.id); this.paintHead(); this.paintFacts(); this.paintPanel(); } catch (error) { toast(error.message); }
    }

    async share() {
      const url = `${location.origin}${Core.groupPath(this.group)}`;
      if (navigator.share) { try { await navigator.share({ title: `${this.group.name} auf Treff`, text: this.group.description || `Komm in die Gruppe „${this.group.name}“`, url }); return; } catch (error) { if (error && error.name === "AbortError") return; } }
      toast((await T.copyText(url)) ? "Link zur Gruppe kopiert." : url);
    }

    groupMenu(anchor) {
      menu(anchor, [
        { label: "Fakten!", icon: "idea", run: () => this.openPanel("facts") },
        { label: "Wichtige Nachrichten", icon: "flag", run: () => this.openPanel("important") },
        { label: "Infos und Einstellungen", icon: "gear", run: () => this.openPanel("group") },
        { label: "Link kopieren", icon: "share", run: () => this.share() },
        !this.group.mine ? { label: "Gruppe melden", icon: "warn", run: () => this.report("group", this.id, "Gruppe melden") } : null,
      ]);
    }

    // -------------------------------------------------------------------------------------------------- the panel
    openPanel(tab) {
      this.panelTab = tab;
      if (!this.panel) {
        this.panelBody = h("div", { class: "panel-body" });
        this.tabs = segmented([["facts", "Fakten!"], ["important", "Wichtig"], ["group", "Gruppe"]], tab, (t) => { this.panelTab = t; this.paintPanel(); }, "Bereich");
        this.panel = h("aside", { class: "panel", "aria-label": "Fakten und Einstellungen" },
          h("div", { class: "panel-top" }, this.tabs, h("button", { class: "icon-btn", type: "button", "aria-label": "Schließen", onclick: () => this.closePanel() }, icon("close"))), this.panelBody);
        this.panelKeys = (e) => { if (e.key === "Escape" && !document.querySelector(".dialog-back, .menu")) this.closePanel(); };
        document.addEventListener("keydown", this.panelKeys);
        this.element.append(this.panel);
        requestAnimationFrame(() => this.panel.classList.add("open"));
      }
      this.tabs.set(tab);
      this.paintPanel();
    }

    closePanel() { if (!this.panel) return; this.panel.classList.remove("open"); setTimeout(() => this.closePanelNow(), 180); }
    closePanelNow() { if (!this.panel) return; document.removeEventListener("keydown", this.panelKeys); this.panel.remove(); this.panel = null; this.panelTab = null; }

    paintPanel() {
      if (!this.panel) return;
      const tab = this.panelTab;
      if (tab === "facts") this.paintFactsTab();
      else if (tab === "important") this.paintImportantTab();
      else this.paintGroupTab();
    }

    paintFactsTab() {
      const g = this.group;
      const canAdd = g.factsOpen || g.mine;
      const cards = this.facts.map((f) => {
        const kind = Core.factKind(f.value);
        return h("article", { class: "fact-card" },
          h("h3", {}, f.title),
          h("div", { class: "fact-value" }, renderText(f.value)),
          h("div", { class: "fact-foot" }, h("span", { class: "muted" }, `${Core.userName(f.user)} · ${Core.listTime(f.time)}`),
            h("span", { class: "fact-actions" },
              h("button", { class: "icon-btn small", type: "button", "aria-label": "Kopieren", title: "Kopieren", onclick: () => copy(f.value, f.title) }, icon("copy")),
              kind === "link" ? h("a", { class: "icon-btn small", href: Core.safeUrl(f.value), target: "_blank", rel: "noopener noreferrer nofollow ugc", "aria-label": "Link öffnen", title: "Link öffnen" }, icon("external")) : null,
              f.canDelete ? h("button", { class: "icon-btn small", type: "button", "aria-label": "Fakt ändern", title: "Ändern", onclick: () => this.factDialog(f) }, icon("edit")) : null,
              f.canDelete ? h("button", { class: "icon-btn small", type: "button", "aria-label": "Fakt löschen", title: "Löschen", onclick: () => this.deleteFact(f) }, icon("trash")) : null,
              !f.mine ? h("button", { class: "icon-btn small", type: "button", "aria-label": "Fakt melden", title: "Melden", onclick: () => this.report("fact", f.id, "Fakt melden") }, icon("warn")) : null)));
      });
      fill(this.panelBody,
        h("p", { class: "panel-lead" }, "Was alle in dieser Gruppe wissen sollten: zum Beispiel die Adresse eines Servers, ein Link oder eine Regel. Tippe auf das Symbol, um etwas zu kopieren."),
        cards.length ? h("div", { class: "fact-list" }, cards) : h("div", { class: "empty small" }, icon("idea"), h("h2", {}, "Noch keine Fakten"), h("p", {}, canAdd ? "Füge den ersten hinzu, zum Beispiel die Server-Adresse." : "Nur die Person, die die Gruppe gemacht hat, darf Fakten hinzufügen.")),
        canAdd ? h("button", { class: "btn primary wide", type: "button", onclick: () => this.factDialog({ title: "", value: "" }) }, icon("plus"), "Fakt hinzufügen") : h("p", { class: "muted small" }, "Nur die Person, die die Gruppe gemacht hat, darf Fakten hinzufügen."));
    }

    async paintImportantTab() {
      fill(this.panelBody, h("div", { class: "chat-loading" }, h("div", { class: "spinner" })));
      let list = [];
      try { list = (await api.get(`/groups/${this.id}/messages?important=1&limit=50`)).messages.reverse(); } catch (error) { toast(error.message); }
      if (this.panelTab !== "important" || !this.panel) return;
      fill(this.panelBody,
        h("p", { class: "panel-lead" }, "Nachrichten, die jemand als „Wichtig!“ markiert hat. Markiere deine mit der Flagge neben dem Schreibfeld."),
        list.length ? h("div", { class: "fact-list" }, list.map((m) => h("article", { class: "fact-card important" }, h("div", { class: "fact-value" }, renderText(m.text)),
          h("div", { class: "fact-foot" }, h("span", { class: "muted" }, `${Core.userName(m.user)} · ${Core.listTime(m.time)}`), h("button", { class: "btn small ghost", type: "button", onclick: () => { this.closePanel(); this.jump(m.id); } }, "Anzeigen"))))) : h("div", { class: "empty small" }, icon("flag"), h("h2", {}, "Nichts Wichtiges"), h("p", {}, "Hier erscheinen Nachrichten, die als „Wichtig!“ markiert sind.")));
    }

    paintGroupTab() {
      const g = this.group;
      const rows = [
        ["Gegründet von", Core.userName(g.creator)], ["Gegründet", Core.dayLabel(g.createdAt)], ["Nachrichten", count(g.messageCount)], ["Fakten", String(g.factCount)],
        ["Fakten hinzufügen", g.factsOpen ? "alle" : "nur die Person, die die Gruppe gemacht hat"],
      ];
      fill(this.panelBody,
        h("div", { class: "group-card" }, avatar(g.name, Core.initials(g.name), "big"), h("h2", {}, g.name), g.description ? h("p", {}, renderText(g.description)) : h("p", { class: "muted" }, "Keine Beschreibung.")),
        h("dl", { class: "facts-list" }, rows.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
        h("div", { class: "button-column" },
          h("button", { class: "btn primary", type: "button", onclick: () => this.share() }, icon("share"), "Link teilen"),
          g.mine ? h("button", { class: "btn ghost", type: "button", onclick: () => this.editGroup() }, icon("gear"), "Gruppe bearbeiten") : null,
          g.mine ? h("button", { class: "btn danger", type: "button", onclick: () => this.deleteGroup() }, icon("trash"), "Gruppe löschen") : h("button", { class: "btn ghost", type: "button", onclick: () => this.report("group", this.id, "Gruppe melden") }, icon("warn"), "Gruppe melden")));
    }

    editGroup() {
      const g = this.group;
      return formDialog({ title: "Gruppe bearbeiten", fields: [{ name: "name", label: "Name", value: g.name, max: 40 }, { name: "description", label: "Beschreibung", type: "area", rows: 3, value: g.description, max: 300 }, { name: "factsOpen", label: "Alle dürfen Fakten hinzufügen", help: "Sonst darfst nur du Fakten hinzufügen.", type: "check", value: g.factsOpen }], yes: "Speichern",
        run: async (v) => {
          const data = await api.patch(`/groups/${this.id}`, { name: v.name, description: v.description, factsOpen: v.factsOpen });
          this.group = data.group;
          this.paintHead(); this.paintFacts(); this.paintPanel();
          this.head.querySelector(".avatar").replaceWith(avatar(this.group.name, Core.initials(this.group.name)));
          history.replaceState({}, "", Core.groupPath(this.group));
          this.app.title(this.group.name);
          this.app.refreshSide();
          return true;
        } });
    }

    async deleteGroup() {
      if (!(await confirmBox({ title: "Gruppe löschen?", text: `„${this.group.name}“ mit allen Nachrichten und Fakten wird für alle gelöscht. Das lässt sich nicht rückgängig machen.`, yes: "Gruppe löschen", danger: true }))) return;
      try { await api.del(`/groups/${this.id}`); toast("Die Gruppe wurde gelöscht."); this.app.go("/"); this.app.refreshSide(); } catch (error) { toast(error.message); }
    }
  }

  T.Chat = Chat;
})();
