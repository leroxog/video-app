/* yipi theme: sets the look (dark, dim or light) before the page is drawn, so there is no flash. The choice is kept in the
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
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", { light: "#ffffff", dim: "#15202b", dark: "#000000" }[theme]);
})();
