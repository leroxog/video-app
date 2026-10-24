/* Nex frame (yipi-chrome.js): the parts around the pages -- the bar at the top (on a phone held upright your picture on the left that opens your profile and the lettering
   "Nex" in a slightly darker grey row; sideways or on a computer the three lines that fold the side bar out, the lettering, the search, the bell and the "+" at the right
   edge), the side bar (always folded in to its symbols until the three lines are pressed) and the small boxes marked "¡ Gesponsert": the places where advertisements will
   go one day (the end of the side bar, every fifth video, every seventh post, the end of the chat list, the top of the videos on a phone). Nothing is sold or shown yet. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Icons = window.YipiIcons;
  const { h, icon, link, avatar } = Y;

  /* A box that says "Gesponsert" with the "¡" sign (an upside down exclamation mark in a rounded square). `kind`: "slot" (thin, at the foot of the side bar), "bar" (a slim
     strip), "card" (like a post), "row" (like a chat in the list), "reel" (a whole video page). */
  function sponsored(kind = "card") {
    const text = h("span", { class: "sp-text" }, h("b", {}, "Gesponsert"), h("small", {}, kind === "reel" ? "Hier erscheint bald Werbung. Wische weiter zum nächsten Video." : "Hier erscheint später Werbung."));
    return h("aside", { class: `sponsored sp-${kind}`, "aria-label": "Gesponsert" }, h("span", { class: "sp-mark", "aria-hidden": "true" }, icon("sponsor")), text);
  }

  /* The bar at the top. `route(name)` tells it which page is open (the heartbeat line runs on Home only). */
  function appBar() {
    const me = Y.me;
    const menu = h("button", { class: "appbar-btn appbar-menu", type: "button", "aria-label": "Seitenleiste ein- oder ausklappen", "aria-expanded": "false", onclick: () => Y.toggleRail() }, icon("menuLines"));
    const mine = link(`/${me.handle}`, { class: "appbar-me", "aria-label": "Dein Profil" }, avatar(me, "md"));
    const brand = link(Y.HOME, { class: "appbar-brand", "aria-label": "Nex, zur Startseite" }, Icons.wordmark());
    const pulse = h("span", { class: "appbar-pulse", "aria-hidden": "true" });
    const search = h("div", { class: "appbar-search" }, Y.searchForm(""));
    const find = link("/explore", { class: "appbar-btn appbar-find", "aria-label": "Suchen" }, icon("search"));
    const bell = link("/notifications", { class: "appbar-btn appbar-bell", "aria-label": "Benachrichtigungen" }, icon("bell"), Y.badge("notifications"));
    const plus = h("button", { class: "appbar-plus", type: "button", "aria-label": "Neu: Beitrag, Video oder Story", "aria-haspopup": "menu", onclick: (event) => Y.newPost({ anchor: event.currentTarget }) }, icon("plus"));
    const right = h("div", { class: "appbar-right" }, Y.streakChip ? Y.streakChip() : null, find, bell, plus);
    const element = h("header", { class: "appbar" }, menu, mine, brand, pulse, search, right);
    return { element, route() { /* the bar is the same on every page */ } };
  }

  /* The side bar is folded in (only symbols) until the three lines are pressed; it folds in again with Escape, a click next to it or when a page is opened. */
  Y.toggleRail = (force) => {
    const app = document.getElementById("app");
    if (!app) return;
    const open = force === undefined ? !app.classList.contains("rail-open") : !!force;
    app.classList.toggle("rail-open", open);
    app.querySelector(".appbar-menu")?.setAttribute("aria-expanded", String(open));
  };
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") Y.toggleRail(false); });
  document.addEventListener("click", (event) => {
    const app = document.getElementById("app");
    if (app && app.classList.contains("rail-open") && !event.target.closest(".tabbar, .appbar-menu")) Y.toggleRail(false);
  });

  Object.assign(Y, { sponsored, appBar });
})();
