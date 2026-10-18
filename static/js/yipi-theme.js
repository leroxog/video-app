/* Pulse theme (the file keeps the name yipi-theme.js): sets the look (dark, dim or light) before the page is drawn, so there is no flash. The choice is kept in the
   browser; without a choice the look follows the device. It also keeps the way to look at the app on a computer: the address ending in ?ansicht=app shows the
   app instead of the notice for computers (for as long as the tab is open). */
(function () {
  "use strict";
  var choice = "auto";
  try {
    var saved = window.localStorage.getItem("yipi.theme");
    if (saved === "dark" || saved === "dim" || saved === "light") choice = saved;
  } catch (error) { /* storage blocked: follow the device */ }
  var theme = choice;
  if (choice === "auto") theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  try {
    var accent = window.localStorage.getItem("yipi.accent");
    if (accent === "indigo" || accent === "orchid" || accent === "lilac") document.documentElement.setAttribute("data-accent", accent);
  } catch (error) { /* storage blocked: the standard colour */ }
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", { light: "#ffffff", dim: "#1a1a1a", dark: "#000000" }[theme]);
  try {
    if (/[?&]ansicht=app(&|$)/.test(window.location.search)) window.sessionStorage.setItem("yipi.force", "1");
    if (window.sessionStorage.getItem("yipi.force") === "1") document.documentElement.classList.add("force-app");
  } catch (error) { /* storage blocked: the notice stays */ }
})();
