/* Satürn (the file keeps the name yipi.js): the frame around everything -- the router (the address bar changes without reloading the page),
   the floating bar at the bottom with five tabs (Home, Chats, Satürn in the middle, Games, Videos), the menu from the left, the badges for new
   messages and the themes. The pages themselves are in yipi-views.js, yipi-chats.js, yipi-pages.js and yipi-nex.js. The app is made for a phone
   held upright. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const Icons = window.YipiIcons;
  const { fill, h, icon, link, avatar, toast, dialog } = Y;

  const app = document.getElementById("app");
  let boot = {};
  try { boot = JSON.parse(document.getElementById("yipiBoot").textContent) || {}; } catch (error) { boot = {}; }
  Y.me = boot.me || null;
  Y.googleReady = !!boot.google;                                // the server has the keys for the sign-in with Google

  // Addresses of the site that are not part of this page: a click on them loads the page from the server.
  const OUTSIDE = new Set(["datenschutz", "impressum", "bildnachweise", "nutzungsbedingungen", "regeln", "hilfe", "gomat-archiv", "nex-agenten-archiv", "nex-ai-archiv", "nstl-archiv", "yipi-archiv", "robots.txt", "sitemap.xml", "manifest.webmanifest", "static", "yipi-media", "yipi-files", "pulse-gif", "api"]);
  const BARE = new Set(["login", "signup"]);

  // ------------------------------------------------------------------------------------------------ theme
  const THEME_COLOR = { light: "#ffffff", dim: "#1a1a1a", dark: "#000000" };
  function applyTheme() {
    let choice = "light";
    try { const saved = localStorage.getItem("yipi.theme"); if (saved === "dark" || saved === "dim" || saved === "light" || saved === "auto") choice = saved; } catch (error) { /* storage blocked */ }
    const theme = choice === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  }
  Y.setTheme = (choice) => {
    try { localStorage.setItem("yipi.theme", choice); } catch (error) { /* storage blocked */ }
    applyTheme();
  };
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);

  // ----------------------------------------------------------------------------------------------- shell
  const TABS = [
    { id: "home", label: "Home", path: () => Y.HOME, icon: "home", on: "homeFill" },
    { id: "messages", label: "Chats", path: () => "/messages", icon: "plane", on: "planeFill", badge: "messages" },
    { id: "plus", label: "Neu", icon: "plusCircle", on: "plusCircle", center: true, action: (event) => Y.newPost({ anchor: event.currentTarget }) },
    { id: "camera", label: "Kamera", path: () => "/camera", icon: "camera", on: "cameraFill" },
    { id: "videos", label: "Videos", path: () => "/videos", icon: "playCircle", on: "videoFill" },
  ];

  let main = null;
  let announcer = null;
  let shellKey = "";
  let appbar = null;

  /* A little number badge that Y.updateBadges keeps up to date (`kind` is "notifications" or "messages"). */
  Y.badge = (kind) => h("span", { class: "badge", "data-badge": kind, hidden: true });

  function tabItem(entry) {
    const box = h("span", { class: "tab-ic" }, icon(entry.icon));
    if (entry.badge) box.append(Y.badge(entry.badge));
    const label = h("span", { class: "tab-label" }, entry.label);
    const el = entry.action
      ? h("button", { class: "tab-item plus-tab", type: "button", "data-nav": entry.id, "aria-label": "Neu: Beitrag, Video oder Story", "aria-haspopup": "menu", onclick: entry.action }, box, label)
      : link(entry.path(), { class: "tab-item", "data-nav": entry.id, "aria-label": entry.label }, box, label);
    el._icon = box;
    return el;
  }

  /* An entry of the folded-out side bar below the four pages (only there): notifications, bookmarks, settings. `nav` names it for the entry that is marked as the open page. */
  function extraItem(path, name, label, badge, nav = "") {
    const box = h("span", { class: "tab-ic" }, icon(name));
    if (badge) box.append(Y.badge(badge));
    return link(path, { class: "tab-extra", "data-nav": nav || name, "aria-label": label }, box, h("span", { class: "tab-label" }, label));
  }

  function buildShell(bare) {
    app.replaceChildren();
    app.classList.toggle("bare", bare);
    announcer = h("div", { class: "sr-only", "aria-live": "polite", role: "status" });
    main = h("main", { id: "main", class: "main", tabindex: "-1" });
    if (bare) { app.append(main, announcer); return; }
    const me = Y.me;
    appbar = Y.appBar();
    const extras = h("div", { class: "tab-extras" }, extraItem("/notifications", "bell", "Mitteilungen", "notifications", "notifications"),
      extraItem("/explore", "search", "Suche", "", "explore"), me.isAdmin ? extraItem("/moderation", "shield", "Moderation", "", "moderation") : null);
    const more = h("button", { class: "rail-more", type: "button", "aria-label": "Mehr zu deinem Konto", "aria-haspopup": "menu", onclick: (event) => {
      event.preventDefault();
      event.stopPropagation();
      Y.menu(event.currentTarget, [{ label: "Dein Profil", icon: "user", run: () => Y.navigate(`/${me.handle}`) }, { label: `@${me.handle} abmelden`, icon: "logout", danger: true, run: () => Y.logout() }]);
    } }, icon("more"));
    const legal = h("div", { class: "rail-links" }, h("a", { href: "/datenschutz" }, "Datenschutz"), h("a", { href: "/nutzungsbedingungen" }, "Nutzungsbedingungen"), h("a", { href: "/bildnachweise" }, "Bildnachweise"), h("a", { href: "/impressum" }, "Impressum"), h("small", {}, "© 2026 Satürn"));
    const foot = h("div", { class: "side-foot" }, Y.sponsored("slot"),
      h("button", { class: "rail-post", type: "button", "aria-label": "Neu: Beitrag, Video oder Story", "aria-haspopup": "menu", onclick: (event) => Y.newPost({ anchor: event.currentTarget }) }, icon("plus"), h("span", {}, "Neu")),
      h("div", { class: "rail-me" }, link(`/${me.handle}`, { class: "side-me", "aria-label": `Dein Profil, @${me.handle}` }, avatar(me, "md"), h("span", { class: "side-me-text" }, h("b", {}, me.name), h("small", {}, `@${me.handle}`))), more), legal);
    const top = h("div", { class: "rail-top" }, link(Y.HOME, { class: "rail-brand", "aria-label": "Satürn, zur Startseite" }, Icons.logo(), Icons.wordmark()));
    const tabbar = h("nav", { class: "tabbar", "aria-label": "Hauptmenü" }, top, TABS.map(tabItem), extras, foot);       // (on a phone held upright only the five tabs show, at the bottom)
    Y.put(app, appbar.element, main, tabbar, announcer);
  }

  function activeTab(route) {
    if (route.name === "messages" || route.name === "thread" || route.name === "group") return "messages";
    if (route.name === "nex") return "messages";                  // Satürn is a contact in the chats now
    if (route.name === "camera" || route.name === "videos") return route.name;
    return "home";
  }

  /* The entry of the wide side bar that stands for the open page (besides the four tabs: search, notifications, your profile, bookmarks, settings, moderation). */
  function extraActive(route) {
    if (["explore", "search"].includes(route.name)) return "explore";
    if (["notifications", "moderation"].includes(route.name)) return route.name;
    if (["bookmarks", "settings"].includes(route.name)) return "profile";            // (the bookmarks and the settings are reached from the profile)
    if (route.name === "profile" && Y.me && String(route.handle || "").toLowerCase() === Y.me.handle.toLowerCase()) return "profile";
    return "";
  }

  function updateNav(route) {
    const active = activeTab(route);
    const extra = extraActive(route);
    for (const el of app.querySelectorAll(".tab-extra")) {
      const on = el.dataset.nav === extra;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
    }
    for (const el of app.querySelectorAll(".tab-item")) {
      const entry = TABS.find((item) => item.id === el.dataset.nav);
      const on = el.dataset.nav === active && entry.id !== "plus" && !extra;
      el.classList.toggle("active", on);
      if (on) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current");
      const old = el._icon.querySelector("svg");
      if (old) old.replaceWith(icon(on ? entry.on : entry.icon));
    }
  }

  // ---------------------------------------------------------------------------------------------- badges
  const unreadTotal = () => (Y.me ? (Y.me.unreadNotifications || 0) + (Y.me.unreadMessages || 0) : 0);
  let pageTitle = "Satürn";

  function updateTitle() {
    const count = unreadTotal();
    document.title = `${count ? `(${count > 99 ? "99+" : count}) ` : ""}${pageTitle === "Satürn" ? "Satürn: was gerade passiert" : `${pageTitle} / Satürn`}`;
  }

  Y.updateBadges = () => {
    const counts = { notifications: Y.me ? Y.me.unreadNotifications || 0 : 0, messages: Y.me ? Y.me.unreadMessages || 0 : 0 };
    for (const badge of document.querySelectorAll("[data-badge]")) {
      const n = counts[badge.dataset.badge] || 0;
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
    const before = unreadTotal();
    Y.me.unreadNotifications = reply.data.me.unreadNotifications;
    Y.me.unreadMessages = reply.data.me.unreadMessages;
    if (unreadTotal() > before) Y.sound?.play("receive");
    Y.updateBadges();
  };
  setInterval(() => { if (!document.hidden) Y.refreshBadges(); }, 45000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) Y.refreshBadges(); });

  // ---------------------------------------------------------------------------------------------- router
  let current = null;                 // {key, route, view, ctx}
  let enterTimer = 0;
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
    const bare = BARE.has(route.name) || !Y.me;                  // nobody who is not signed in sees anything but the page to sign in
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
      if (!Y.me && route.name === "post") view = Y.views.share(route, ctx);            // the one page without an account: a post that was sent to somebody
      else if (!Y.me && !BARE.has(route.name)) view = Y.views.login(route, ctx);       // the page to sign in takes the place of every other page
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
    Y.chatLock?.seen(route.name);                                  // the chat lock asks again at every entry from another page
    const lockedChat = !!(Y.chatLock && Y.chatLock.locked() && ["messages", "thread", "group"].includes(route.name));
    if (restore && cache.has(key) && !lockedChat) {
      view = cache.get(key);
      cache.delete(key);
      ctx = view.ctx;
    } else {
      if (cache.has(key)) { cache.get(key).destroy?.(); cache.delete(key); }
      ({ view, ctx } = build(route, key));
      view.ctx = ctx;
    }
    current = { key, route, view, ctx };
    const tabRoute = ["home", "messages", "nex", "camera", "videos", "login", "signup"].includes(route.name);
    main.dataset.enter = initial ? "" : tabRoute ? "fade" : restore ? "back" : "forward";       // a page that is opened slides in from the right, "back" from the left
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { main.dataset.enter = ""; }, 380);
    main.replaceChildren(view.element);
    app.dataset.route = route.name;
    pageTitle = view.title || "Satürn";
    updateTitle();
    updateNav(route);
    appbar?.route(route.name);
    Y.toggleRail?.(false);
    Y.updateBadges();
    if (announcer) announcer.textContent = pageTitle;
    window.scrollTo(0, restore ? view.scrollY || 0 : 0);
    view.onShow?.();
    if (!initial && !restore) main.focus({ preventScroll: true });
  }

  Y.navigate = (href, options = {}) => {
    let url;
    try { url = new URL(href, location.href); } catch (error) { return; }
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
    Y.chatLock?.forget();
    clearCache();
    Y.updateBadges();
  };

  Y.logout = async () => {
    await Api.post("/logout");
    Y.setMe(null);
    Y.navigate(Y.HOME, { replace: true });
    toast("Du wurdest abgemeldet.");
  };

  Y.rerender = () => render();                                  // the page of this address is built again (the chats after they were locked)

  /* The page that is shown is asked to load itself again (after a post was pinned, for instance). */
  Y.refreshView = () => { current?.view.refresh?.(); };

  /* A panel that slides in from the left over the page (the menu of Home, the list of conversations of Satürn). `build(panel, close)` puts its
     content in; it closes with the button, a tap next to it, Escape, or a tap on a link inside. Returns `close`. */
  Y.sidePanel = (label, build, extraClass = "") => {
    const old = document.querySelector(".drawer-back");
    if (old) return null;
    const back = h("div", { class: "drawer-back" });
    const panel = h("aside", { class: `drawer ${extraClass}`.trim(), role: "dialog", "aria-modal": "true", "aria-label": label });
    const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    function close() {
      document.removeEventListener("keydown", onKey, true);
      back.classList.add("closing");
      document.body.classList.remove("modal-open");
      setTimeout(() => back.remove(), 200);
    }
    build(panel, close);
    panel.addEventListener("click", (event) => { if (event.target.closest("a")) close(); });
    back.addEventListener("click", (event) => { if (event.target === back) close(); });
    back.append(panel);
    document.body.append(back);
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onKey, true);
    Y.updateBadges();
    panel.querySelector("a, button")?.focus();
    return close;
  };

  /* The menu from the left (the round button at the top of Home opens it): profile, notifications, bookmarks, settings and the rest. */
  Y.openDrawer = () => Y.sidePanel("Menü", (panel, close) => {
    const me = Y.me;
    const entry = (path, name, label, badge) => link(path, { class: "drawer-item" }, icon(name), h("span", {}, label), badge ? Y.badge(badge) : null);
    const common = [entry("/explore", "search", "Entdecken"), entry("/settings/about", "help", "Hilfe und Rechtliches")];
    panel.append(h("div", { class: "drawer-head" },
      me ? link(`/${me.handle}`, { class: "dr-av", "aria-label": "Zum Profil" }, avatar(me, "lg")) : h("span", { class: "hero-logo" }, Icons.logo()),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Menü schließen", onclick: close }, icon("close"))));
    if (me) {
      panel.append(
        link(`/${me.handle}`, { class: "dr-name" }, h("b", {}, me.name), h("span", { class: "handle" }, `@${me.handle}`)),
        h("div", { class: "dr-counts" }, link(`/${me.handle}/following`, {}, h("b", {}, Core.formatCount(me.following)), " Folge ich"), link(`/${me.handle}/followers`, {}, h("b", {}, Core.formatCount(me.followers)), " Follower")),
        h("nav", { class: "drawer-nav", "aria-label": "Menü" },
          entry(`/${me.handle}`, "user", "Profil"), entry("/notifications", "bell", "Benachrichtigungen", "notifications"), ...common,
          me.isAdmin ? entry("/moderation", "shield", "Moderation") : null),
        h("button", { class: "drawer-item logout", type: "button", onclick: () => { close(); Y.logout(); } }, icon("logout"), h("span", {}, `@${me.handle} abmelden`)));
    } else {
      panel.append(
        h("div", { class: "dr-name" }, h("b", {}, "Satürn"), h("span", { class: "handle" }, "Was gerade passiert.")),
        h("nav", { class: "drawer-nav", "aria-label": "Menü" }, entry("/i/login", "user", "Anmelden"), entry("/i/signup", "feather", "Konto erstellen"), ...common));
    }
  });

  Y.requireLogin = (message) => {
    if (Y.me) return true;
    let entry = null;
    const go = (path) => () => { entry.close(); Y.navigate(path); };
    entry = dialog({ label: "Anmelden", title: "", body: h("div", { class: "auth-prompt" },
      h("span", { class: "hero-logo" }, Icons.logo()), h("h2", {}, "Mach mit bei Satürn"), h("p", { class: "dialog-text" }, message || "Melde dich an, um das zu tun."),
      h("div", { class: "hero-actions" }, h("button", { class: "btn primary", type: "button", onclick: go("/i/signup") }, "Konto erstellen"), h("button", { class: "btn ghost", type: "button", onclick: go("/i/login") }, "Anmelden"))) });
    return false;
  };

  Y.onPosted = (post, info) => { Y.sound?.play("success"); if (current) current.view.onPosted?.(post, info || {}); };

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
