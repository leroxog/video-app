(function () {
  "use strict";
  // Inside the NRS browser these pages run in an iframe: forms and links to other NRS pages are
  // handed to the browser (so its address bar, tab title and history follow along) instead of
  // navigating the frame on their own. Opened directly, they behave like normal pages.
  if (window.parent === window) return;

  function go(url, title) {
    window.parent.postMessage({ nrs: "go", url: url, title: title || "" }, location.origin);
  }

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if ((form.method || "get").toLowerCase() !== "get") return;
    var url = new URL(form.action, location.href);
    if (url.origin !== location.origin) return;
    new FormData(form).forEach(function (value, key) { url.searchParams.set(key, value); });
    e.preventDefault();
    var q = url.searchParams.get("q");
    go(url.href, q ? q + " – NRS Suche" : "NRS Suche");
  });

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    var link = e.target.closest("a[href]");
    if (!link || link.target === "_blank") return;
    var url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    e.preventDefault();
    go(url.href, link.dataset.title ? link.dataset.title + " – NRS Suche" : "");
  });
})();
