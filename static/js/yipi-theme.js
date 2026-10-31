/* Satürn theme (the file keeps the name yipi-theme.js): sets the look (dark, dim or light) before the page is drawn, so there is no flash. The choice is kept in the
   browser; without a choice it is the white look ("auto" follows the device). */
(function () {
  "use strict";
  var choice = "light";
  try {
    var saved = window.localStorage.getItem("yipi.theme");
    if (saved === "dark" || saved === "dim" || saved === "light" || saved === "auto") choice = saved;
  } catch (error) { /* storage blocked: the white look */ }
  var theme = choice;
  if (choice === "auto") theme = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", theme);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", { light: "#ffffff", dim: "#1a1a1a", dark: "#000000" }[theme]);
})();
