/* Treff: the app -- the list of groups on one side, the open group (or the welcome page) on the other (on a phone one at a time),
   the address of the page (/ and /g/12/name), and which messages the person has already seen. */
(function () {
  "use strict";

  const Core = window.TreffCore;
  const T = (window.Treff = window.Treff || {});
  const { h, fill, put, icon, toast, api, identity, loadIdentity, store, Sidebar, welcome, adminView } = T;

  const app = { seen: {}, sidebar: null, chat: null, welcomeEl: null, main: null, root: null, route: null };
  try { app.seen = JSON.parse(store.get("treff.seen")) || {}; } catch (error) { app.seen = {}; }

  app.title = (text) => { document.title = text ? `${text} | Treff` : "Treff: Gruppen ohne Konto"; };
  app.paintMe = () => app.sidebar && app.sidebar.paintMe();
  app.refreshSide = () => { app.sidebar && app.sidebar.refresh().then(() => app.welcomeEl && app.welcomeEl.refresh && app.welcomeEl.refresh()); };

  /* The person has seen the messages of a group up to `id`. */
  app.markSeen = (group, id) => {
    if (!id || (app.seen[group] || 0) >= id) return;
    app.seen[group] = id;
    store.set("treff.seen", JSON.stringify(app.seen));
    app.sidebar && app.sidebar.paint();
  };

  app.go = (path, options = {}) => {
    if (location.pathname !== path) history.pushState({}, "", path);
    show(options);
    window.scrollTo(0, 0);
  };

  function setPane(name) { app.root.dataset.pane = name; }

  function notFound() {
    return h("section", { class: "chat" }, h("div", { class: "empty" }, icon("chat"), h("h2", {}, "Diese Seite gibt es nicht"), h("p", {}, "Der Link ist falsch oder die Seite wurde entfernt."), h("a", { class: "btn primary", href: "/", onclick: (e) => { e.preventDefault(); app.go("/"); } }, "Zu allen Gruppen")));
  }

  function show(options = {}) {
    const route = Core.parsePath(location.pathname);
    if (app.chat && !(route.name === "group" && app.chat.id === route.id)) { app.chat.destroy(); app.chat = null; }
    app.welcomeEl = null;
    if (route.name === "group") {
      if (!app.chat) {
        app.chat = new T.Chat(app, route.id);
        fill(app.main, app.chat.element);
        app.chat.load().then(() => { if (options.jump && app.chat) app.chat.jump(options.jump); });
      } else if (options.jump) app.chat.jump(options.jump);
      app.sidebar.setActive(route.id);
      setPane("chat");
    } else if (route.name === "admin") {
      app.sidebar.setActive(null);
      fill(app.main, adminView(app));
      app.title("Verwaltung");
      setPane("chat");
    } else if (route.name === "home") {
      app.sidebar.setActive(null);
      app.welcomeEl = welcome(app);
      fill(app.main, app.welcomeEl);
      app.title("");
      setPane("list");
    } else {
      app.sidebar.setActive(null);
      fill(app.main, notFound());
      app.title("Nicht gefunden");
      setPane("chat");
    }
  }

  function boot() {
    app.root = document.getElementById("app");
    app.sidebar = new Sidebar(app);
    app.main = h("main", { class: "main", id: "main" });
    fill(app.root, h("div", { class: "app" }, app.sidebar.element, app.main));
    app.root = app.root.firstChild;
    window.addEventListener("popstate", () => show());
    window.addEventListener("unhandledrejection", (e) => { console.error(e.reason); });
    document.querySelector(".skip")?.addEventListener("click", (event) => { event.preventDefault(); app.main.setAttribute("tabindex", "-1"); app.main.focus(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
    loadIdentity().then(() => app.paintMe());
    app.sidebar.refresh().then(() => app.welcomeEl && app.welcomeEl.refresh && app.welcomeEl.refresh());
    setInterval(() => { if (!document.hidden) app.refreshSide(); }, 15000);
    show();
  }

  T.app = app;
  boot();
})();
