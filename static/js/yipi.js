/* yipi: the frame around everything -- the router (the address bar changes without reloading the page), the side bar, the bottom bar
   on phones, the right column, the badges for new messages, the themes and the keyboard shortcuts. The pages themselves are in
   yipi-views.js and yipi-pages.js. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const Icons = window.YipiIcons;
  const { fill, h, icon, link, avatar, toast, dialog, menu } = Y;

  const app = document.getElementById("app");
  let boot = {};
  try { boot = JSON.parse(document.getElementById("yipiBoot").textContent) || {}; } catch (error) { boot = {}; }
  Y.me = boot.me || null;

  // Addresses of the site that are not part of this page: a click on them loads the page from the server.
  const OUTSIDE = new Set(["datenschutz", "impressum", "nutzungsbedingungen", "regeln", "hilfe", "gomat-archiv", "robots.txt", "sitemap.xml", "manifest.webmanifest", "static", "yipi-media", "api"]);
  const NEEDS_LOGIN = new Set(["notifications", "messages", "thread", "bookmarks"]);
  const BARE = new Set(["login", "signup"]);

  // ------------------------------------------------------------------------------------------------ theme
  const THEME_COLOR = { light: "#ffffff", dim: "#15202b", dark: "#000000" };
  function applyTheme() {
    let choice = "auto";
    try { const saved = localStorage.getItem("yipi.theme"); if (saved === "dark" || saved === "dim" || saved === "light") choice = saved; } catch (error) { /* storage blocked */ }
    const theme = choice === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  }
  Y.setTheme = (choice) => {
    try { if (choice === "auto") localStorage.removeItem("yipi.theme"); else localStorage.setItem("yipi.theme", choice); } catch (error) { /* storage blocked */ }
    applyTheme();
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);

  // ----------------------------------------------------------------------------------------------- shell
  const NAV = [
    { id: "home", label: "Startseite", path: () => Y.HOME, icon: "home", on: "homeFill" },
    { id: "explore", label: "Entdecken", path: () => "/explore", icon: "search", on: "searchBold" },
    { id: "notifications", label: "Benachrichtigungen", path: () => "/notifications", icon: "bell", on: "bellFill", auth: true, badge: true },
    { id: "messages", label: "Nachrichten", path: () => "/messages", icon: "mail", on: "mailFill", auth: true, badge: true },
    { id: "bookmarks", label: "Lesezeichen", path: () => "/bookmarks", icon: "bookmark", on: "bookmarkFill", auth: true },
    { id: "profile", label: "Profil", path: () => `/${Y.me.handle}`, icon: "user", on: "userFill", auth: true },
    { id: "settings", label: "Einstellungen", path: () => "/settings", icon: "settings", on: "settings" },
  ];
  const TABBAR = ["home", "explore", "notifications", "messages"];

  let main = null;
  let announcer = null;
  let railBox = null;
  let railLoaded = 0;
  let shellKey = "";

  function navItem(entry, bar) {
    const iconBox = h("span", { class: "nav-ic" }, icon(entry.icon));
    const badge = entry.badge ? h("span", { class: "badge", hidden: true }) : null;
    if (badge) iconBox.append(badge);
    const el = link(entry.path(), { class: "nav-item", "data-nav": entry.id, "aria-label": entry.label }, iconBox, bar ? null : h("span", { class: "nav-label" }, entry.label));
    el._icon = iconBox;
    return el;
  }

  function accountChip() {
    const chip = h("button", { class: "account-chip", type: "button", "aria-haspopup": "menu", "aria-label": `Konto von ${Y.me.name}` },
      avatar(Y.me, "sm"), h("span", { class: "chip-text" }, h("b", {}, Y.me.name), h("small", {}, `@${Y.me.handle}`)), h("span", { class: "chip-more" }, icon("more")));
    chip.addEventListener("click", () => Y.accountMenu(chip));
    return chip;
  }

  function buildRail() {
    const box = h("aside", { class: "rail", "aria-label": "Mehr auf yipi" });
    box.append(h("div", { class: "rail-search" }, Y.searchForm("")));
    if (!Y.me) {
      box.append(h("section", { class: "card join" }, h("h2", {}, "Neu bei yipi?"), h("p", { class: "muted" }, "Erstelle ein Konto, folge Leuten und sag, was du denkst."),
        link("/i/signup", { class: "btn primary wide" }, "Konto erstellen"), link("/i/login", { class: "btn ghost wide" }, "Anmelden")));
    }
    box.append(h("section", { class: "card", "data-rail": "trends" }, h("h2", {}, "Im Trend"), Y.skeleton(2)),
      h("section", { class: "card", "data-rail": "people" }, h("h2", {}, "Wem folgen"), Y.skeleton(2)),
      h("footer", { class: "rail-foot" },
        h("a", { href: "/nutzungsbedingungen" }, "Nutzungsbedingungen"), h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/impressum" }, "Impressum"),
        h("button", { class: "linklike", type: "button", onclick: () => Y.shortcutsDialog() }, "Tastenkürzel"), h("span", {}, "© yipi")));
    return box;
  }

  function railCard(name) {
    let card = railBox.querySelector(`[data-rail="${name}"]`);
    if (!card) {
      card = h("section", { class: "card", "data-rail": name });
      railBox.insertBefore(card, railBox.querySelector(".rail-foot"));
    }
    return card;
  }

  async function fillRail() {
    if (!railBox) return;
    railLoaded = Date.now();
    const [trends, people] = await Promise.all([Api.get("/trends"), Api.get("/suggestions")]);
    if (!railBox) return;
    if (trends.ok && trends.data.trends.length) {
      fill(railCard("trends"), h("h2", {}, "Im Trend"), trends.data.trends.slice(0, 5).map((trend) => link(`/search?q=${encodeURIComponent(`#${trend.tag}`)}`, { class: "trend" },
        h("span", { class: "t-kicker" }, "Trend"), h("b", {}, `#${trend.tag}`), h("span", { class: "t-count" }, `${Core.formatCount(trend.posts)} ${trend.posts === 1 ? "Yip" : "Yips"}`))));
    } else railBox.querySelector('[data-rail="trends"]')?.remove();
    if (people.ok && people.data.users.length) fill(railCard("people"), h("h2", {}, "Wem folgen"), people.data.users.map((user) => Y.userRow(user, { bio: false })));
    else railBox.querySelector('[data-rail="people"]')?.remove();
  }

  /* Somebody was followed or unfollowed: the suggestions in the right column are asked for again (not when the click was in that
     column itself, so the list does not change under the mouse). */
  Y.followChanged = (fromRail) => { if (!fromRail) setTimeout(fillRail, 300); };

  function buildShell(bare) {
    app.replaceChildren();
    app.classList.toggle("bare", bare);
    railBox = null;
    announcer = h("div", { class: "sr-only", "aria-live": "polite", role: "status" });
    main = h("main", { id: "main", class: "main", tabindex: "-1" });
    if (bare) { app.append(main, announcer); return; }
    const items = NAV.filter((entry) => (!entry.auth || Y.me));
    if (Y.me && Y.me.isAdmin) items.push({ id: "moderation", label: "Moderation", path: () => "/moderation", icon: "shield", on: "shield" });
    const side = h("header", { class: "side" },
      h("div", { class: "side-inner" },
        link(Y.HOME, { class: "brand", "aria-label": "yipi, zur Startseite" }, Icons.logo(), h("span", { class: "brand-name" }, "yipi")),
        h("nav", { class: "nav", "aria-label": "Hauptmenü" }, items.map((entry) => navItem(entry, false))),
        Y.me ? h("button", { class: "btn primary compose-btn", type: "button", "aria-label": "Neuer Yip", onclick: () => Y.compose() }, h("span", { class: "cb-text" }, "Yippen"), h("span", { class: "cb-icon" }, icon("feather")))
             : h("div", { class: "side-guest" }, link("/i/signup", { class: "btn primary" }, "Registrieren"), link("/i/login", { class: "btn ghost" }, "Anmelden")),
        h("div", { class: "side-spacer" }),
        Y.me ? accountChip() : null));
    const tabbar = h("nav", { class: "tabbar", "aria-label": "Hauptmenü" },
      NAV.filter((entry) => TABBAR.includes(entry.id) && (!entry.auth || Y.me)).map((entry) => navItem(entry, true)),
      Y.me ? null : link("/i/login", { class: "nav-item", "aria-label": "Anmelden" }, h("span", { class: "nav-ic" }, icon("user"))));
    railBox = buildRail();
    Y.put(app, side, h("div", { class: "center" }, main), railBox, tabbar, announcer,
      Y.me ? h("button", { class: "fab", type: "button", "aria-label": "Neuer Yip", onclick: () => Y.compose() }, icon("feather")) : null);
    fillRail();
  }

  function updateNav(route) {
    const active = { home: "home", explore: "explore", search: "explore", notifications: "notifications", messages: "messages", thread: "messages", bookmarks: "bookmarks", settings: "settings", moderation: "moderation" }[route.name]
      || (route.name === "profile" && Y.me && route.handle.toLowerCase() === Y.me.handle.toLowerCase() ? "profile" : "");
    for (const el of app.querySelectorAll("[data-nav]")) {
      const entry = NAV.find((item) => item.id === el.dataset.nav) || { icon: "shield", on: "shield" };
      const on = el.dataset.nav === active;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
      const old = el._icon.querySelector("svg");
      if (old) old.replaceWith(icon(on ? entry.on : entry.icon));
    }
  }

  // ---------------------------------------------------------------------------------------------- badges
  const unreadTotal = () => (Y.me ? (Y.me.unreadNotifications || 0) + (Y.me.unreadMessages || 0) : 0);
  let pageTitle = "yipi";

  function updateTitle() {
    const count = unreadTotal();
    document.title = `${count ? `(${count > 99 ? "99+" : count}) ` : ""}${pageTitle === "yipi" ? "yipi" : `${pageTitle} / yipi`}`;
  }

  Y.updateBadges = () => {
    const counts = { notifications: Y.me ? Y.me.unreadNotifications || 0 : 0, messages: Y.me ? Y.me.unreadMessages || 0 : 0 };
    for (const el of app.querySelectorAll("[data-nav]")) {
      const badge = el.querySelector(".badge");
      if (!badge) continue;
      const n = counts[el.dataset.nav] || 0;
      badge.hidden = !n;
      badge.textContent = n > 99 ? "99+" : String(n);
    }
    updateTitle();
  };

  Y.refreshBadges = async () => {
    if (!Y.me) return;
    const reply = await Api.get("/me");
    if (!reply.ok) return;
    if (!reply.data.me) {
      Y.setMe(null);
      toast("Du wurdest abgemeldet.");
      render();
      return;
    }
    Y.me.unreadNotifications = reply.data.me.unreadNotifications;
    Y.me.unreadMessages = reply.data.me.unreadMessages;
    Y.updateBadges();
  };
  setInterval(() => { if (!document.hidden) Y.refreshBadges(); }, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) Y.refreshBadges(); });

  // ---------------------------------------------------------------------------------------------- router
  let current = null;                 // {key, route, view, ctx}
  const cache = new Map();            // pages that were left but are kept (so "back" is instant and keeps the scroll position)

  function release(forceDestroy) {
    if (!current) return;
    const { view, key } = current;
    view.scrollY = window.scrollY;
    view.onHide?.();
    view.element.remove();
    current = null;
    if (view.keep && !forceDestroy) {
      cache.delete(key);
      cache.set(key, view);
      while (cache.size > 8) {
        const [oldest, stale] = cache.entries().next().value;
        stale.destroy?.();
        cache.delete(oldest);
      }
    } else view.destroy?.();
  }

  function clearCache() {
    for (const view of cache.values()) view.destroy?.();
    cache.clear();
  }

  function ensureShell(route) {
    const bare = BARE.has(route.name);
    const key = `${bare ? "bare" : "full"}:${Y.me ? Y.me.handle : ""}`;
    if (key === shellKey) return;
    release(true);
    clearCache();
    shellKey = key;
    buildShell(bare);
  }

  function build(route, key) {
    const ctx = { route, key, view: null,
      setTitle(text) { if (ctx.view) ctx.view.title = text; if (current && current.ctx === ctx) { pageTitle = text; updateTitle(); } },
      reload() { cache.delete(key); render(); } };
    let view;
    try {
      if (NEEDS_LOGIN.has(route.name) && !Y.me) view = Y.views.needLogin(route);
      else view = (Y.views[route.name] || Y.views.notfound)(route, ctx);
    } catch (error) {
      console.error(error);
      view = { element: h("div", { class: "view" }, Y.errorState({ status: 500, data: {} }, () => ctx.reload())), title: "Fehler" };
    }
    ctx.view = view;
    return { view, ctx };
  }

  function render({ restore = false, initial = false } = {}) {
    const route = Core.parsePath(location.pathname, location.search);
    ensureShell(route);
    release(false);
    const key = location.pathname + location.search;
    let view = null;
    let ctx = null;
    if (restore && cache.has(key)) {
      view = cache.get(key);
      cache.delete(key);
      ctx = view.ctx;
    } else {
      if (cache.has(key)) { cache.get(key).destroy?.(); cache.delete(key); }
      ({ view, ctx } = build(route, key));
      view.ctx = ctx;
    }
    current = { key, route, view, ctx };
    main.replaceChildren(view.element);
    app.dataset.route = route.name;
    pageTitle = view.title || "yipi";
    updateTitle();
    updateNav(route);
    if (announcer) announcer.textContent = pageTitle;
    window.scrollTo(0, restore ? view.scrollY || 0 : 0);
    view.onShow?.();
    if (!initial && !restore) main.focus({ preventScroll: true });
    if (railBox && Date.now() - railLoaded > 120000) fillRail();
  }

  Y.navigate = (href, options = {}) => {
    let url;
    try { url = new URL(href, location.href); } catch (error) { return; }
    if (url.pathname === "/") url = new URL(Y.HOME, location.href);                  // "/" is the page of the site, yipi's own home is elsewhere
    if (url.origin !== location.origin || OUTSIDE.has(url.pathname.split("/")[1])) { location.assign(url.href); return; }
    const target = url.pathname + url.search;
    if (target === location.pathname + location.search && !options.replace) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      current?.view.refresh?.();
      return;
    }
    if (options.replace) history.replaceState(history.state, "", target);
    else history.pushState({ inApp: true }, "", target);
    render();
  };

  Y.back = (fallback = Y.HOME) => {
    if (history.state && history.state.inApp) history.back();
    else Y.navigate(fallback);
  };

  window.addEventListener("popstate", () => render({ restore: true }));
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  // ----------------------------------------------------------------------------------------------- account
  Y.setMe = (me) => {
    Y.me = me;
    clearCache();
    const chip = app.querySelector(".account-chip");
    if (chip && me) chip.replaceWith(accountChip());                  // name or picture may have changed
    Y.updateBadges();
  };

  Y.logout = async () => {
    await Api.post("/logout");
    Y.setMe(null);
    Y.navigate(Y.HOME, { replace: true });
    toast("Du wurdest abgemeldet.");
  };

  Y.accountMenu = (anchor) => {
    if (!Y.me) return;
    menu(anchor, [
      { label: "Profil", icon: "user", run: () => Y.navigate(`/${Y.me.handle}`) },
      { label: "Lesezeichen", icon: "bookmark", run: () => Y.navigate("/bookmarks") },
      { label: "Einstellungen", icon: "settings", run: () => Y.navigate("/settings") },
      Y.me.isAdmin ? { label: "Moderation", icon: "shield", run: () => Y.navigate("/moderation") } : null,
      { label: `@${Y.me.handle} abmelden`, icon: "logout", run: () => Y.logout() },
    ]);
  };

  Y.requireLogin = (message) => {
    if (Y.me) return true;
    let entry = null;
    const go = (path) => () => { entry.close(); Y.navigate(path); };
    entry = dialog({ label: "Anmelden", title: "", body: h("div", { class: "auth-prompt" },
      h("span", { class: "hero-logo" }, Icons.logo()), h("h2", {}, "Mach mit bei yipi"), h("p", { class: "dialog-text" }, message || "Melde dich an, um das zu tun."),
      h("div", { class: "hero-actions" }, h("button", { class: "btn primary", type: "button", onclick: go("/i/signup") }, "Konto erstellen"), h("button", { class: "btn ghost", type: "button", onclick: go("/i/login") }, "Anmelden"))) });
    return false;
  };

  Y.onPosted = (post, info) => { if (current) current.view.onPosted?.(post, info || {}); };

  // ------------------------------------------------------------------------------------------- shortcuts
  // "j|k" means one key or the other, "g>h" means one key after the other.
  const SHORTCUTS = [["n", "Neuer Yip"], ["/", "Suche"], ["j|k", "Nächster / voriger Yip"], ["l", "Yip mögen"], ["r", "Auf einen Yip antworten"], ["g>h", "Startseite"], ["g>e", "Entdecken"],
    ["g>n", "Benachrichtigungen"], ["g>m", "Nachrichten"], ["g>b", "Lesezeichen"], ["g>p", "Dein Profil"], ["g>s", "Einstellungen"], ["?", "Diese Hilfe"]];

  const keyCaps = (spec) => spec.split(/([|>])/).map((part) => (part === "|" ? " oder " : part === ">" ? " dann " : h("kbd", {}, part)));

  Y.shortcutsDialog = () => dialog({ title: "Tastenkürzel", body: h("dl", { class: "shortcuts" }, SHORTCUTS.flatMap(([keys, text]) => [h("dt", {}, keyCaps(keys)), h("dd", {}, text)])) });

  let goPending = false;
  let goTimer = null;
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
    const target = event.target;
    if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
    if (document.querySelector(".dialog-back") && event.key !== "?") return;
    const key = event.key;
    if (goPending) {
      goPending = false;
      clearTimeout(goTimer);
      const places = { h: Y.HOME, e: "/explore", n: "/notifications", m: "/messages", b: "/bookmarks", s: "/settings", p: Y.me ? `/${Y.me.handle}` : "/i/login" };
      if (places[key]) { event.preventDefault(); Y.navigate(places[key]); }
      return;
    }
    if (key === "g") { goPending = true; goTimer = setTimeout(() => { goPending = false; }, 1200); return; }
    if (key === "?") { event.preventDefault(); Y.shortcutsDialog(); return; }
    if (key === "/") { const input = document.querySelector(".view .search-input") || document.querySelector(".rail .search-input"); if (input) { event.preventDefault(); input.focus(); } else { event.preventDefault(); Y.navigate("/search"); } return; }
    if (key === "n") { if (Y.me) { event.preventDefault(); Y.compose(); } return; }
    if (key === "j" || key === "k") {
      const posts = [...document.querySelectorAll(".view .post:not(.gone)")];
      if (!posts.length) return;
      const at = posts.indexOf(document.activeElement ? document.activeElement.closest(".post") : null);
      const next = posts[Math.max(0, Math.min(posts.length - 1, at + (key === "j" ? 1 : -1)))];
      event.preventDefault();
      next.focus({ preventScroll: true });
      const box = next.getBoundingClientRect();
      const bar = document.querySelector(".view .topbar");
      const top = bar ? bar.getBoundingClientRect().bottom : 0;
      if (box.top < top + 8 || box.bottom > window.innerHeight - 8) window.scrollBy({ top: box.top - top - 24, behavior: "smooth" });
      return;
    }
    if (key === "l" || key === "r") {
      const card = document.activeElement ? document.activeElement.closest(".post") : null;
      if (card && card.act) { event.preventDefault(); card.act[key === "l" ? "like" : "reply"](); }
    }
  });

  // ----------------------------------------------------------------------------------------- connection
  // A safety net: something that fails on its own (a bug, a broken answer) at least says so instead of doing nothing.
  window.addEventListener("unhandledrejection", (event) => { console.error(event.reason); toast("Etwas ist schiefgelaufen. Bitte versuche es noch einmal."); });
  window.addEventListener("offline", () => toast("Du bist offline."));
  window.addEventListener("online", () => toast("Wieder online."));

  // ---------------------------------------------------------------------------------------------- start
  applyTheme();
  render({ initial: true });
  Y.updateBadges();
})();
