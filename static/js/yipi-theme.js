/* Pulse theme (the file keeps the name yipi-theme.js): sets the look (dark, dim or light) before the page is drawn, so there is no flash. The choice is kept in the
   browser; without a choice the look follows the device. */
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
    if (accent === "pink" || accent === "green" || accent === "orange" || accent === "violet") document.documentElement.setAttribute("data-accent", accent);
  } catch (error) { /* storage blocked: the standard colour */ }
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", { light: "#eef1f8", dim: "#0c1220", dark: "#07080d" }[theme]);
})();
