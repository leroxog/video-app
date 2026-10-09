/* yipi views, part 1: the pages that show Yips -- home, explore, search, notifications, bookmarks, profiles, a single Yip, and the
   lists of followers. Each view is a function (route, ctx) that answers at once with {element, title, ...} and fills itself when
   the data arrives. `keep: true` lets the router keep the page (and its scroll position) when you go on to a Yip and come back. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, toast, dialog, confirmBox, menu, tabs, pager } = Y;

  const views = (Y.views = {});

  // ------------------------------------------------------------------------------------------ helpers
  function qs(path, params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) if (value != null && value !== "") query.set(key, String(value));
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  }

  /* Wraps an API list for `pager`: build(cursor) gives the path, `key` is the name of the list in the answer. */
  function listLoader(build, key = "items") {
    return async (cursor) => {
      const reply = await Api.get(build(cursor));
      return { ok: reply.ok, offline: reply.offline, items: reply.ok ? reply.data[key] || [] : [], next: reply.ok ? reply.data.next || null : null, data: reply.data };
    };
  }

  const emptyState = (title, text, action) => h("div", { class: "empty" }, h("h3", {}, title), text ? h("p", {}, text) : null, action || null);

  function errorState(reply, retry) {
    const title = reply.offline ? "Keine Verbindung" : reply.status === 404 ? "Das gibt es nicht" : "Das hat nicht geklappt";
    return h("div", { class: "empty error" }, h("h3", {}, title), h("p", {}, Api.message(reply)),
      retry && reply.status !== 404 ? h("button", { class: "btn primary", type: "button", onclick: retry }, "Noch einmal versuchen") : link(Y.HOME, { class: "btn primary" }, "Zur Startseite"));
  }

  /* The bar at the top of a view. `back` is true or the address to go to when there is no page to go back to. */
  function topbar({ title, sub, back, right, extra, className = "" } = {}) {
    const heading = h("h1", {}, title || "");
    const subline = h("span", { class: "sub" }, sub || "");
    subline.hidden = !sub;
    const bar = h("div", { class: `topbar ${className}`.trim() },
      h("div", { class: "topbar-row" },
        back ? h("button", { class: "icon-btn", type: "button", "aria-label": "Zurück", onclick: () => Y.back(typeof back === "string" ? back : Y.HOME) }, icon("back")) : null,
        h("div", { class: "topbar-title" }, heading, subline), right || null),
      extra || null);
    bar.set = (text, more) => { heading.textContent = text; subline.textContent = more || ""; subline.hidden = !more; };
    return bar;
  }

  const searchForm = (value = "", { autofocus = false, type = "posts" } = {}) => {
    const input = h("input", { class: "search-input", type: "search", name: "q", placeholder: "Suchen", "aria-label": "Suchen", autocomplete: "off", maxlength: 100, enterkeyhint: "search" });
    input.value = value;
    const form = h("form", { class: "search-box", role: "search", onsubmit: (event) => {
      event.preventDefault();
      const text = Core.cleanText(input.value);
      if (text) Y.navigate(Core.buildPath({ name: "search", q: text, type }));
    } }, icon("search"), input);
    if (autofocus) setTimeout(() => input.focus(), 0);
    form.input = input;
    return form;
  };

  const peopleLine = (actors) => {
    const link1 = (actor) => link(`/${actor.handle}`, { class: "who" }, actor.name);
    if (actors.length === 1) return [link1(actors[0])];
    if (actors.length === 2) return [link1(actors[0]), " und ", link1(actors[1])];
    return [link1(actors[0]), ", ", link1(actors[1]), ` und ${actors.length - 2} weitere`];
  };

  const snippet = (text, limit = 140) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text);

  const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (error) { return fallback; } };
  const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* storage blocked */ } };

  Object.assign(Y, { qs, listLoader, emptyState, errorState, topbar, searchForm, peopleLine, snippet, readJson, writeJson });

  // ------------------------------------------------------------------------------------------- guest card
  function welcomeCard() {
    return h("section", { class: "hero" },
      h("span", { class: "hero-logo" }, window.YipiIcons.logo()),
      h("h2", {}, "Sag, was dich bewegt."),
      h("p", {}, "Auf yipi teilst du kurze Yips, antwortest, reposts und folgst Leuten, die dich interessieren. Ohne Werbung und ohne Tracking."),
      h("div", { class: "hero-actions" },
        link("/i/signup", { class: "btn primary" }, "Konto erstellen"),
        link("/i/login", { class: "btn ghost" }, "Anmelden")));
  }
  Y.welcomeCard = welcomeCard;

  // ------------------------------------------------------------------------------------------------ home
  views.home = function home(route, ctx) {
    const signedIn = !!Y.me;
    let feed = signedIn && Y.readJson("yipi.feed", "foryou") === "following" ? "following" : "foryou";
    let feedPager = null;
    let firstCursor = 0;
    let visible = true;
    let timer = null;

    const pill = h("button", { class: "new-pill", type: "button", hidden: true, onclick: () => { feedPager.reload(); window.scrollTo(0, 0); pill.hidden = true; } });
    const feedBox = h("div", { class: "feed" });
    const tabBox = h("div", { class: "home-tabs" });
    const mobileRow = h("div", { class: "mobile-head" },
      signedIn ? h("button", { class: "avatar-btn", type: "button", "aria-label": "Konto-Menü", onclick: (event) => Y.accountMenu(event.currentTarget) }, avatar(Y.me, "sm"))
               : link("/i/login", { class: "btn ghost small" }, "Anmelden"),
      h("span", { class: "mobile-logo" }, window.YipiIcons.logo()),
      link("/settings", { class: "icon-btn", "aria-label": "Einstellungen" }, icon("settings")));
    const bar = h("div", { class: "topbar home" }, mobileRow, tabBox);
    const el = h("div", { class: "view home-view" }, bar, pill);

    function drawTabs() {
      if (!signedIn) { fill(tabBox, h("div", { class: "tabs single" }, h("span", { class: "tab on" }, h("span", {}, "Neueste Yips")))); return; }
      fill(tabBox, tabs([["foryou", "Für dich"], ["following", "Folge ich"]], feed, (id) => {
        if (id === feed) { feedPager.reload(); window.scrollTo(0, 0); return; }
        feed = id;
        Y.writeJson("yipi.feed", id);
        drawTabs();
        mountFeed();
      }, "Startseite"));
    }

    function mountFeed() {
      feedPager?.destroy();
      firstCursor = 0;
      pill.hidden = true;
      feedPager = pager({
        load: listLoader((cursor) => qs("/timeline", { feed, cursor })),
        render: (item) => Y.postCard(item),
        first: (reply) => { firstCursor = reply.items.length ? Math.max(...reply.items.map((item) => item.cursor || 0)) : 0; },
        empty: feed === "following"
          ? emptyState("Hier ist noch nichts los", "Folge Leuten, um ihre Yips hier zu sehen.", link("/explore", { class: "btn primary" }, "Leute entdecken"))
          : emptyState("Noch keine Yips", signedIn ? "Schreib den ersten." : "Erstelle ein Konto und schreib den ersten.", null),
      });
      fill(feedBox, feedPager.element);
    }

    async function check() {
      if (!visible || document.hidden || !firstCursor) return;
      const reply = await Api.get(qs("/timeline/new", { feed, after: firstCursor }));
      if (!reply.ok || !visible || !reply.data.count) return;
      pill.textContent = reply.data.count === 1 ? "1 neuer Yip" : `${reply.data.count} neue Yips`;
      pill.hidden = false;
    }

    drawTabs();
    if (signedIn) {
      put(el, Y.composer({ draftKey: "home", onPosted: (post) => {
        firstCursor = Math.max(firstCursor, post.cursor || 0);
        feedPager.prepend(Y.postCard(post));
        Y.toast("Dein Yip wurde gesendet.", { label: "Anzeigen", run: () => Y.navigate(Y.postPath(post)) });
      } }));
    } else {
      put(el, welcomeCard());
    }
    put(el, feedBox);
    mountFeed();
    timer = setInterval(check, 30000);

    return {
      element: el, title: "Startseite", keep: true,
      onShow() { visible = true; check(); },
      onHide() { visible = false; },
      refresh() { feedPager.reload(); },
      onPosted(post, info) {
        if (info.replyTo) return;
        firstCursor = Math.max(firstCursor, post.cursor || 0);
        feedPager.prepend(Y.postCard(post));
      },
      destroy() { clearInterval(timer); feedPager.destroy(); },
    };
  };

  // --------------------------------------------------------------------------------------------- explore
  views.explore = function explore(route, ctx) {
    const trendBox = h("section", { class: "card" }, h("h2", {}, "Im Trend"), Y.skeleton(2));
    const peopleBox = h("section", { class: "card" }, h("h2", {}, "Wem folgen"), Y.skeleton(2));
    const feedPager = pager({ load: listLoader((cursor) => qs("/timeline", { feed: "foryou", cursor })), render: (item) => Y.postCard(item), empty: emptyState("Noch keine Yips", Y.me ? "Schreib den ersten." : "Erstelle ein Konto und schreib den ersten.") });
    const el = h("div", { class: "view" },
      topbar({ title: "Entdecken", className: "search-bar", extra: h("div", { class: "topbar-search" }, searchForm("")) }),
      h("div", { class: "explore-cards" }, trendBox, peopleBox),
      h("h2", { class: "section-title" }, "Neueste Yips"), feedPager.element);

    (async () => {
      const [trends, people] = await Promise.all([Api.get("/trends"), Api.get("/suggestions")]);
      if (trends.ok) {
        fill(trendBox, h("h2", {}, "Im Trend"), trends.data.trends.length
          ? h("ol", { class: "trend-list" }, trends.data.trends.map((trend, index) => h("li", {}, link(`/search?q=${encodeURIComponent(`#${trend.tag}`)}`, { class: "trend" },
              h("span", { class: "t-kicker" }, `${index + 1} · Trend der letzten 24 Std.`), h("b", {}, `#${trend.tag}`),
              h("span", { class: "t-count" }, `${Core.formatCount(trend.posts)} ${trend.posts === 1 ? "Yip" : "Yips"}`)))))
          : h("p", { class: "muted" }, "Gerade gibt es keine Trends. Probier einen #Hashtag aus."));
      } else fill(trendBox, h("h2", {}, "Im Trend"), h("p", { class: "muted" }, Api.message(trends)));
      if (people.ok && people.data.users.length) fill(peopleBox, h("h2", {}, "Wem folgen"), people.data.users.map((user) => Y.userRow(user, { bio: false })));
      else peopleBox.remove();
    })();

    return { element: el, title: "Entdecken", keep: true, refresh() { feedPager.reload(); }, destroy() { feedPager.destroy(); } };
  };

  // ---------------------------------------------------------------------------------------------- search
  views.search = function search(route, ctx) {
    const query = Core.cleanText(route.q || "");
    const type = route.type;
    const form = searchForm(query, { autofocus: !query, type });
    const body = h("div", { class: "search-body" });
    const switcher = tabs([["posts", "Yips"], ["people", "Personen"]], type, (id) => Y.navigate(Core.buildPath({ name: "search", q: query, type: id }), { replace: true }), "Suchergebnisse");
    const el = h("div", { class: "view" }, topbar({ back: true, title: "Suche", className: "search-bar", extra: h("div", {}, h("div", { class: "topbar-search" }, form), query ? switcher : null) }), body);
    let listPager = null;

    function recent() {
      const entries = Y.readJson("yipi.recent", []);
      if (!entries.length) { fill(body, emptyState("Suche nach Yips, Leuten und #Hashtags", "Gib mindestens zwei Zeichen ein.")); return; }
      fill(body, h("div", { class: "recent" },
        h("div", { class: "recent-head" }, h("h2", {}, "Zuletzt gesucht"), h("button", { class: "btn ghost small", type: "button", onclick: () => { Y.writeJson("yipi.recent", []); recent(); } }, "Löschen")),
        entries.map((entry) => link(Core.buildPath({ name: "search", q: entry }), { class: "recent-item" }, icon("search"), h("span", {}, entry)))));
    }

    if (!query) { recent(); return { element: el, title: "Suche", keep: true }; }
    if (Core.charCount(query.replace(/^[#@]/, "")) < 2) {
      fill(body, emptyState("Etwas länger bitte", "Suchbegriffe brauchen mindestens zwei Zeichen."));
      return { element: el, title: "Suche", keep: true };
    }
    Y.writeJson("yipi.recent", [query, ...Y.readJson("yipi.recent", []).filter((entry) => entry !== query)].slice(0, 8));
    if (type === "people") {
      listPager = pager({ load: listLoader(() => qs("/search", { q: query, type: "people" }), "users"), render: (user) => Y.userRow(user), empty: emptyState(`Keine Personen für „${query}“`, "Probier einen anderen Namen.") });
    } else {
      listPager = pager({ load: listLoader((cursor) => qs("/search", { q: query, type: "posts", cursor })), render: (item) => Y.postCard(item), empty: emptyState(`Keine Yips für „${query}“`, "Probier andere Wörter oder einen #Hashtag.") });
    }
    fill(body, listPager.element);
    return { element: el, title: `${query} – Suche`, keep: true, destroy() { listPager.destroy(); } };
  };

  // ---------------------------------------------------------------------------------------- notifications
  const NOTE_ICON = { like: ["heartFill", "n-like"], repost: ["repost", "n-repost"], follow: ["userFill", "n-follow"], reply: ["reply", "n-reply"], mention: ["reply", "n-reply"], quote: ["repost", "n-reply"] };

  function notificationRow(group) {
    const [iconName, tone] = NOTE_ICON[group.kind] || ["bell", ""];
    const row = h("article", { class: `note ${tone}${group.read ? "" : " unread"}` });
    const side = h("div", { class: "note-ic" }, icon(iconName));
    const main = h("div", { class: "note-main" });
    const faces = h("div", { class: "note-faces" }, group.actors.slice(0, 7).map((actor) => link(`/${actor.handle}`, { "aria-label": actor.name }, avatar(actor, "sm"))));
    if (group.kind === "reply" || group.kind === "mention" || group.kind === "quote") {
      const verb = { reply: "hat dir geantwortet", mention: "hat dich erwähnt", quote: "hat deinen Yip zitiert" }[group.kind];
      put(main, h("p", { class: "note-text" }, peopleLine(group.actors), ` ${verb}`), Y.postCard(group.post, { noReplyLine: true }));
      row.classList.add("with-post");
    } else {
      const text = {
        like: group.actors.length === 1 ? " gefällt dein Yip" : " gefällt dein Yip",
        repost: group.actors.length === 1 ? " hat deinen Yip repostet" : " haben deinen Yip repostet",
        follow: group.actors.length === 1 ? " folgt dir jetzt" : " folgen dir jetzt",
      }[group.kind] || "";
      put(main, faces, h("p", { class: "note-text" }, peopleLine(group.actors), text, h("span", { class: "dot" }, " · "), Y.timeEl(group.createdAt)));
      if (group.post) put(main, link(Y.postPath(group.post), { class: "note-snippet" }, group.post.text ? snippet(group.post.text) : "Yip mit Bild"));
      if (group.kind === "follow" && group.actors.length === 1 && group.actors[0].bio) put(main, h("p", { class: "note-snippet plain" }, snippet(group.actors[0].bio, 100)));
    }
    put(row, side, main);
    return row;
  }

  views.notifications = function notifications(route, ctx) {
    let marked = false;
    const feedPager = pager({
      load: async (cursor) => {
        const reply = await listLoader((c) => qs("/notifications", { cursor: c }))(cursor);
        if (reply.ok) reply.items = Core.groupNotifications(reply.items);
        return reply;
      },
      render: notificationRow,
      first: () => {
        if (marked) return;
        marked = true;
        if (Y.me && (Y.me.unreadNotifications || 0) > 0) {
          Api.post("/notifications/read");
          Y.me.unreadNotifications = 0;
          Y.updateBadges();
        }
      },
      empty: emptyState("Noch nichts passiert", "Wenn dir jemand folgt, antwortet oder deine Yips mag, siehst du es hier."),
    });
    const el = h("div", { class: "view" }, topbar({ title: "Benachrichtigungen" }), feedPager.element);
    return { element: el, title: "Benachrichtigungen", refresh() { marked = false; feedPager.reload(); }, destroy() { feedPager.destroy(); } };
  };

  // ------------------------------------------------------------------------------------------- bookmarks
  views.bookmarks = function bookmarks(route, ctx) {
    const feedPager = pager({
      load: listLoader((cursor) => qs("/bookmarks", { cursor })),
      render: (item) => Y.postCard(item, { onBookmark: (on, card) => { if (!on) card.classList.add("faded"); } }),
      empty: emptyState("Speichere Yips für später", "Tippe bei einem Yip auf das Lesezeichen, dann findest du ihn hier wieder."),
    });
    const el = h("div", { class: "view" }, topbar({ title: "Lesezeichen", sub: Y.me ? `@${Y.me.handle}` : "" }), feedPager.element);
    return { element: el, title: "Lesezeichen", keep: true, refresh() { feedPager.reload(); }, destroy() { feedPager.destroy(); } };
  };

  // -------------------------------------------------------------------------------------------- profile
  function editProfile(user, onSaved) {
    const draft = { avatar: undefined, banner: undefined };           // undefined: unchanged, null: remove, {blob, url}: new picture
    const name = h("input", { class: "field", maxlength: 50, "aria-label": "Name", autocomplete: "off" });
    const bio = h("textarea", { class: "field-area", maxlength: 160, rows: 3, "aria-label": "Über dich" });
    const place = h("input", { class: "field", maxlength: 30, "aria-label": "Ort", autocomplete: "off" });
    const site = h("input", { class: "field", maxlength: 100, "aria-label": "Webseite", placeholder: "https://", autocomplete: "off", inputmode: "url" });
    name.value = user.name; bio.value = user.bio || ""; place.value = user.location || ""; site.value = user.website || "";
    const count = h("span", { class: "field-count" });
    const error = h("p", { class: "form-error", role: "alert", hidden: true });
    const banner = h("div", { class: "edit-banner" });
    const face = h("div", { class: "edit-avatar" });
    const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    let picking = null;

    const current = (kind) => (draft[kind] === undefined ? user[kind] : draft[kind] ? draft[kind].url : null);
    function draw() {
      const bannerUrl = current("banner");
      fill(banner, bannerUrl ? h("img", { src: bannerUrl, alt: "" }) : null,
        h("div", { class: "edit-tools" },
          h("button", { class: "icon-btn glass", type: "button", "aria-label": "Titelbild ändern", onclick: () => choose("banner") }, icon("image")),
          bannerUrl ? h("button", { class: "icon-btn glass", type: "button", "aria-label": "Titelbild entfernen", onclick: () => { draft.banner = null; draw(); } }, icon("close")) : null));
      banner.style.setProperty("--hue", Core.avatarHue(user.handle));
      const faceUrl = current("avatar");
      fill(face, avatar({ ...user, avatar: faceUrl }, "xl"),
        h("button", { class: "icon-btn glass", type: "button", "aria-label": "Profilbild ändern", onclick: () => choose("avatar") }, icon("image")),
        faceUrl ? h("button", { class: "icon-btn glass remove", type: "button", "aria-label": "Profilbild entfernen", onclick: () => { draft.avatar = null; draw(); } }, icon("close")) : null);
      count.textContent = `${Core.charCount(bio.value)}/160`;
    }
    function choose(kind) { picking = kind; picker.click(); }
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      picker.value = "";
      if (!file || !picking) return;
      if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { toast("Das ist kein Bild, das yipi kennt (JPEG, PNG, GIF oder WebP)."); return; }
      try {
        const blob = await Y.prepareImage(file, { crop: picking === "avatar" ? { width: 400, height: 400 } : { width: 1500, height: 500 } });
        const old = draft[picking];
        if (old) URL.revokeObjectURL(old.url);
        draft[picking] = { blob, url: URL.createObjectURL(blob) };
        draw();
      } catch (error) { toast("Dieses Bild konnte nicht gelesen werden."); }
    });
    bio.addEventListener("input", draw);

    const fail = (text) => { error.textContent = text; error.hidden = false; return false; };
    const body = h("div", { class: "edit-profile" }, banner, face,
      h("label", { class: "field-label" }, h("span", {}, "Name"), name),
      h("label", { class: "field-label" }, h("span", {}, "Über dich"), bio, count),
      h("label", { class: "field-label" }, h("span", {}, "Ort"), place),
      h("label", { class: "field-label" }, h("span", {}, "Webseite"), site), picker, error);
    draw();
    dialog({ title: "Profil bearbeiten", body, actions: [{ label: "Speichern", kind: "primary", run: async () => {
      error.hidden = true;
      if (!Core.cleanText(name.value)) return fail("Gib einen Namen an.");
      const payload = { name: name.value, bio: bio.value, location: place.value, website: site.value.trim() };
      for (const kind of ["avatar", "banner"]) {
        if (draft[kind] === null) payload[kind] = "";
        else if (draft[kind]) {
          const up = await Api.upload(draft[kind].blob, { alt: "" });
          if (!up.ok) return fail(Api.message(up));
          payload[kind] = up.data.media.id;
        }
      }
      const reply = await Api.patch("/profile", payload);
      if (!reply.ok) return fail(Api.message(reply));
      for (const kind of ["avatar", "banner"]) if (draft[kind]) URL.revokeObjectURL(draft[kind].url);
      Y.setMe({ ...Y.me, ...reply.data.me });
      onSaved(reply.data.me);
      toast("Dein Profil wurde gespeichert.");
      return true;
    } }] });
  }

  views.profile = function profile(route, ctx) {
    const handle = route.handle;
    const head = h("div", { class: "profile-head" });
    const tabBox = h("div", { class: "profile-tabs" });
    const listBox = h("div", { class: "profile-list" });
    const bar = topbar({ back: true, title: `@${handle}` });
    const el = h("div", { class: "view profile" }, bar, head, tabBox, listBox);
    let user = null;
    let tab = "posts";
    let listPager = null;
    let shownState = "";                                  // blocked or not, as the tabs and the list were drawn
    const relationState = () => `${!!user.blockedByMe}|${!!user.blockedMe}`;
    /* The relation to this person changed (followed, blocked, ...): the header is drawn again, and the list only when blocking changed. */
    function relationChanged() {
      drawHead();
      if (relationState() !== shownState) { shownState = relationState(); drawTabs(); mountList(); }
    }
    const result = { element: el, title: `@${handle}`, keep: true, destroy() { listPager?.destroy(); } };

    function mountList() {
      listPager?.destroy();
      if (user.blockedByMe || user.blockedMe) { fill(listBox); return; }
      const labels = { posts: ["Noch keine Yips", user.isMe ? "Wenn du etwas yippst, erscheint es hier." : `@${user.handle} hat noch nichts geyippt.`],
        replies: ["Noch keine Antworten", "Antworten erscheinen hier."], media: ["Noch keine Bilder", "Yips mit Bildern erscheinen hier."], likes: ["Noch nichts gemocht", "Yips, die dir gefallen, erscheinen hier. Nur du siehst diese Liste."] };
      listPager = pager({ load: listLoader((cursor) => qs(`/users/${handle}/posts`, { tab, cursor })), render: (item) => Y.postCard(item), empty: emptyState(...labels[tab]) });
      fill(listBox, listPager.element);
    }

    function drawTabs() {
      if (user.blockedByMe || user.blockedMe) { fill(tabBox); return; }
      const entries = [["posts", "Yips"], ["replies", "Antworten"], ["media", "Medien"]];
      if (user.isMe) entries.push(["likes", "Gefällt mir"]);
      fill(tabBox, tabs(entries, tab, (id) => { tab = id; drawTabs(); mountList(); }, "Profil"));
    }

    function drawHead() {
      const banner = h("div", { class: "banner" }, user.banner ? h("a", { href: user.banner, onclick: (event) => { event.preventDefault(); Y.viewer([{ url: user.banner, alt: "Titelbild" }], 0); } }, h("img", { src: user.banner, alt: "" })) : null);
      banner.style.setProperty("--hue", Core.avatarHue(user.handle));
      const actions = h("div", { class: "ph-actions" });
      if (user.isMe) {
        put(actions, h("button", { class: "btn ghost", type: "button", onclick: () => editProfile(user, (me) => { Object.assign(user, { name: me.name, bio: me.bio, location: me.location, website: me.website, avatar: me.avatar, banner: me.banner }); drawHead(); bar.set(user.name, `${Core.formatCount(user.posts)} Yips`); result.title = `${user.name} (@${user.handle})`; ctx.setTitle(result.title); }) }, "Profil bearbeiten"));
      } else {
        const more = h("button", { class: "icon-btn outlined", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, icon("more"));
        more.addEventListener("click", () => menu(more, [
          { label: "Link kopieren", icon: "link", run: () => Y.copyLink(`/${user.handle}`) },
          Y.me ? { label: user.mutedByMe ? `Stummschaltung von @${user.handle} aufheben` : `@${user.handle} stummschalten`, icon: "mute", run: async () => {
            const reply = user.mutedByMe ? await Api.del(`/users/${user.handle}/mute`) : await Api.post(`/users/${user.handle}/mute`);
            if (reply.ok) { Object.assign(user, reply.data.user); drawHead(); toast(user.mutedByMe ? `@${user.handle} ist stummgeschaltet.` : "Stummschaltung aufgehoben."); } else toast(Api.message(reply));
          } } : null,
          Y.me ? { label: user.blockedByMe ? `@${user.handle} nicht mehr blockieren` : `@${user.handle} blockieren`, icon: "block", danger: !user.blockedByMe, run: async () => {
            if (!user.blockedByMe && !(await confirmBox({ title: `@${user.handle} blockieren?`, text: "Ihr seht die Yips des anderen nicht mehr und könnt euch nicht mehr folgen oder schreiben.", yes: "Blockieren", danger: true }))) return;
            const reply = user.blockedByMe ? await Api.del(`/users/${user.handle}/block`) : await Api.post(`/users/${user.handle}/block`);
            if (reply.ok) { Object.assign(user, reply.data.user); relationChanged(); toast(user.blockedByMe ? `@${user.handle} ist blockiert.` : "Blockierung aufgehoben."); } else toast(Api.message(reply));
          } } : null,
          { label: `@${user.handle} melden`, icon: "flag", danger: true, run: () => Y.reportDialog({ handle: user.handle }) },
        ]));
        put(actions, more);
        if (Y.me && !user.blockedByMe && !user.blockedMe) put(actions, link(`/messages/${user.handle}`, { class: "icon-btn outlined", "aria-label": `Nachricht an @${user.handle}` }, icon("mail")));
        const follow = Y.followButton(user, { onChange: relationChanged });
        if (follow) put(actions, follow);
      }
      const meta = h("div", { class: "ph-meta" },
        user.location ? h("span", {}, icon("pin"), user.location) : null,
        user.website ? h("span", {}, icon("link"), h("a", { href: user.website, target: "_blank", rel: "noopener noreferrer nofollow ugc" }, Core.shortUrl(user.website))) : null,
        h("span", {}, icon("calendar"), Core.joinedLabel(user.createdAt)));
      fill(head, banner,
        h("div", { class: "ph-body" },
          h("div", { class: "ph-top" }, h("button", { class: "ph-avatar", type: "button", "aria-label": user.avatar ? "Profilbild vergrößern" : "Profilbild", onclick: () => { if (user.avatar) Y.viewer([{ url: user.avatar, alt: `Profilbild von ${user.name}` }], 0); } }, avatar(user, "xl")), actions),
          h("div", { class: "ph-name" }, h("h2", {}, user.name), h("span", { class: "handle" }, `@${user.handle}`), user.followsMe ? h("span", { class: "tag" }, "Folgt dir") : null, user.mutedByMe ? h("span", { class: "tag" }, "Stummgeschaltet") : null),
          user.bio ? h("p", { class: "ph-bio" }, richText(user.bio)) : null, meta,
          h("div", { class: "ph-counts" },
            link(`/${user.handle}/following`, {}, h("b", {}, Core.formatCount(user.following)), " Folge ich"),
            link(`/${user.handle}/followers`, {}, h("b", {}, Core.formatCount(user.followers)), user.followers === 1 ? " Follower" : " Follower")),
          user.blockedMe ? h("p", { class: "notice" }, `@${user.handle} hat dich blockiert. Du kannst die Yips nicht sehen und @${user.handle} nicht folgen.`) : null,
          user.blockedByMe ? h("p", { class: "notice" }, `Du hast @${user.handle} blockiert. Du siehst die Yips nicht.`) : null));
    }

    (async () => {
      const reply = await Api.get(`/users/${handle}`);
      if (!reply.ok) { fill(head, errorState(reply, () => ctx.reload())); return; }
      user = reply.data.user;
      if (user.suspended && !user.createdAt) {
        bar.set(`@${user.handle}`);
        fill(head, emptyState("Dieses Konto ist gesperrt", `@${user.handle} hat gegen die Regeln von yipi verstoßen.`));
        return;
      }
      result.title = `${user.name} (@${user.handle})`;
      ctx.setTitle(result.title);
      bar.set(user.name, `${Core.formatCount(user.posts)} ${user.posts === 1 ? "Yip" : "Yips"}`);
      drawHead();
      shownState = relationState();
      drawTabs();
      mountList();
    })();

    result.onPosted = (post, info) => { if (user && user.isMe && tab === "posts" && !info.replyTo) { user.posts += 1; listPager.prepend(Y.postCard(post)); bar.set(user.name, `${Core.formatCount(user.posts)} Yips`); } };
    return result;
  };

  // ---------------------------------------------------------------------------------------- single Yip
  views.post = function postView(route, ctx) {
    const above = h("div", { class: "thread-above" });
    const main = h("div", { class: "thread-main" }, Y.skeleton(1));
    const replyBox = h("div", { class: "reply-box" });
    const repliesBox = h("div", { class: "replies" });
    const el = h("div", { class: "view" }, topbar({ back: true, title: "Yip" }), above, main, replyBox, repliesBox);
    let replies = null;
    let detail = null;
    const result = { element: el, title: "Yip", keep: true, destroy() { replies?.destroy(); } };

    async function load() {
      const reply = await Api.get(`/posts/${route.id}`);
      if (!reply.ok) { fill(main, errorState(reply, () => { fill(main, Y.skeleton(1)); load(); })); return; }
      const item = reply.data.post;
      if (item.user && item.user.handle.toLowerCase() !== route.handle.toLowerCase()) { Y.navigate(`/${item.user.handle}/status/${item.id}`, { replace: true }); return; }
      fill(above, ...reply.data.ancestors.map((ancestor) => { const card = Y.postCard(ancestor); card.classList.add("line"); return card; }));
      detail = Y.postCard(item, { detail: true, onDelete: () => Y.back(Y.HOME), onReply: (post) => { replies.prepend(Y.postCard(post, { noReplyLine: true })); } });
      fill(main, detail);
      if (item.user) {
        result.title = `${item.user.name} auf yipi: „${snippet(item.text || "Yip mit Bild", 60)}“`;
        ctx.setTitle(result.title);
      }
      if (!item.deleted) {
        if (Y.me) {
          fill(replyBox, Y.composer({ replyTo: item, compact: true, placeholder: "Schreibe deine Antwort", label: "Antworten", onPosted: (post) => {
            replies.prepend(Y.postCard(post, { noReplyLine: true }));
            detail.bumpReplies();
            toast("Deine Antwort wurde gesendet.");
          } }));
        } else {
          fill(replyBox, h("div", { class: "reply-login" }, h("p", {}, "Melde dich an, um zu antworten."), link("/i/login", { class: "btn primary" }, "Anmelden")));
        }
      }
      replies = pager({ load: listLoader((cursor) => qs(`/posts/${route.id}/replies`, { cursor })), render: (post) => Y.postCard(post, { noReplyLine: true }), empty: item.deleted ? null : h("p", { class: "muted pad" }, "Noch keine Antworten.") });
      fill(repliesBox, replies.element);
      requestAnimationFrame(() => {
        const bar = el.querySelector(".topbar");
        if (reply.data.ancestors.length) window.scrollTo(0, detail.getBoundingClientRect().top + window.scrollY - (bar ? bar.offsetHeight : 0) - 4);
      });
    }
    load();
    return result;
  };

  // --------------------------------------------------------------------------------- followers, following
  function peopleView(kind) {
    return function people(route, ctx) {
      const handle = route.handle;
      const bar = topbar({ back: `/${handle}`, title: `@${handle}`, extra: tabs([["followers", "Follower"], ["following", "Folge ich"]], kind, (id) => Y.navigate(`/${handle}/${id}`, { replace: true }), "Personen") });
      const listPager = pager({
        load: listLoader((cursor) => qs(`/users/${handle}/${kind}`, { page: cursor || 1 }), "users"),
        render: (user) => Y.userRow(user),
        empty: emptyState(kind === "followers" ? "Noch keine Follower" : "Folgt noch niemandem", ""),
      });
      Api.get(`/users/${handle}`).then((reply) => { if (reply.ok && reply.data.user.createdAt) bar.set(reply.data.user.name, `@${reply.data.user.handle}`); });
      return { element: h("div", { class: "view" }, bar, listPager.element), title: `${kind === "followers" ? "Follower" : "Folge ich"} von @${handle}`, keep: true, destroy() { listPager.destroy(); } };
    };
  }
  views.followers = peopleView("followers");
  views.following = peopleView("following");
})();
