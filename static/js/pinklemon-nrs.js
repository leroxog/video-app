(function () {
  "use strict";
  var form = document.getElementById("nrsForm");
  var address = document.getElementById("nrsAddress");
  var frame = document.getElementById("nrsFrame");
  var home = document.getElementById("nrsHome");
  var openNewTab = document.getElementById("nrsOpenNewTab");
  var backBtn = document.getElementById("nrsBack");
  var forwardBtn = document.getElementById("nrsForward");
  var reloadBtn = document.getElementById("nrsReload");

  // Our own visited-URL stack -- the only way to do back/forward here.
  // A cross-origin iframe's own navigation history isn't something this
  // page is allowed to read or drive from the outside.
  var history_ = [];
  var historyIndex = -1;

  function normalizeUrl(raw) {
    var v = raw.trim();
    if (!v) return null;
    var hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
    // No scheme, has a space, or no dot anywhere -- reads like a search
    // phrase rather than a host, so send it to a search engine instead
    // of trying (and failing) to resolve it as one.
    var looksLikeHost = hasScheme || (/\./.test(v) && !/\s/.test(v));
    if (!looksLikeHost) return "https://duckduckgo.com/?q=" + encodeURIComponent(v);
    return hasScheme ? v : "https://" + v;
  }

  function updateNavButtons() {
    backBtn.disabled = historyIndex <= 0;
    forwardBtn.disabled = historyIndex >= history_.length - 1;
  }

  function load(url, pushToHistory) {
    home.hidden = true;
    frame.hidden = false;
    address.value = url;
    frame.src = url;
    openNewTab.hidden = false;
    openNewTab.href = url;
    if (pushToHistory) {
      history_ = history_.slice(0, historyIndex + 1);
      history_.push(url);
      historyIndex = history_.length - 1;
    }
    updateNavButtons();
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var url = normalizeUrl(address.value);
    if (url) load(url, true);
  });

  backBtn.addEventListener("click", function () {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    load(history_[historyIndex], false);
  });
  forwardBtn.addEventListener("click", function () {
    if (historyIndex >= history_.length - 1) return;
    historyIndex += 1;
    load(history_[historyIndex], false);
  });
  reloadBtn.addEventListener("click", function () {
    if (history_[historyIndex]) load(history_[historyIndex], false);
  });
})();
