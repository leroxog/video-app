(function () {
  "use strict";
  var tabstrip = document.getElementById("nrsTabstrip");
  var tabAddBtn = document.getElementById("nrsTabAdd");
  var body = document.getElementById("nrsBody");
  var form = document.getElementById("nrsForm");
  var address = document.getElementById("nrsAddress");
  var openNewTab = document.getElementById("nrsOpenNewTab");
  var backBtn = document.getElementById("nrsBack");
  var forwardBtn = document.getElementById("nrsForward");
  var reloadBtn = document.getElementById("nrsReload");
  var homeTemplateHtml = document.getElementById("nrsHomeTemplate").textContent;
  var historyBtn = document.getElementById("nrsHistoryBtn");
  var historyPanel = document.getElementById("nrsHistoryPanel");
  var historyBackdrop = document.getElementById("nrsHistoryBackdrop");
  var historyClose = document.getElementById("nrsHistoryClose");
  var historyList = document.getElementById("nrsHistoryList");
  var historyClearBtn = document.getElementById("nrsHistoryClear");
  var createFab = document.getElementById("nrsCreateFab");
  var createBackdrop = document.getElementById("nrsCreateBackdrop");
  var createModal = document.getElementById("nrsCreateModal");
  var createClose = document.getElementById("nrsCreateClose");
  var createName = document.getElementById("nrsCreateName");
  var createSlug = document.getElementById("nrsCreateSlug");
  var createCode = document.getElementById("nrsCreateCode");
  var createError = document.getElementById("nrsCreateError");
  var createSubmit = document.getElementById("nrsCreateSubmit");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // A normal browsed page needs allow-same-origin (most real sites don't
  // function at all without it -- cookies, storage, same-origin API
  // calls). A user-authored .nrs mini-site is the opposite case: it's
  // rendered via srcdoc, and a sandboxed srcdoc frame WITH allow-same-
  // origin inherits the PARENT page's own origin -- i.e. arbitrary
  // user-submitted JS would run as this app's own origin, with the
  // viewer's real cookies/session. That's a stored-XSS-shaped hole (one
  // user's saved site reading/acting as whoever else views it), so .nrs
  // sites use the same stricter sandbox as Nex's own nexpreview
  // artifacts instead: scripts still run, but with no origin to steal.
  var SANDBOX_URL = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";
  var SANDBOX_NRS_SITE = "allow-scripts allow-modals allow-forms allow-downloads";
  var NRS_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

  // Each tab keeps its own visited-stack for back/forward -- a cross-
  // origin iframe's own navigation history isn't something this page is
  // allowed to read or drive from the outside, so this is the only way
  // to do back/forward at all. Every tab's pane (home state + iframe)
  // stays in the DOM the whole time it's open, just hidden when not the
  // active one, so switching tabs never reloads anything. Each history
  // entry is {kind: "url", value: <absolute URL>} or {kind: "nrs",
  // value: <slug, no ".nrs">}.
  var tabs = [];
  var activeTabId = null;
  var nextTabId = 1;

  function activeTab() {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].id === activeTabId) return tabs[i];
    return null;
  }

  function hostnameOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return url; }
  }

  function normalizeUrl(raw) {
    var v = raw.trim();
    if (!v) return null;
    var hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v);
    // No scheme, has a space, or no dot anywhere -- reads like a search
    // phrase rather than a host, so send it to a search engine instead
    // of trying (and failing) to resolve it as one. Bing specifically --
    // verified live (curl + an actual test iframe) that unlike DuckDuckGo,
    // Google, Brave and Ecosia (all of which send X-Frame-Options/CSP
    // frame-ancestors refusing embedding), Bing's search results send
    // neither and render normally in an iframe.
    var looksLikeHost = hasScheme || (/\./.test(v) && !/\s/.test(v));
    if (!looksLikeHost) return "https://www.bing.com/search?q=" + encodeURIComponent(v);
    return hasScheme ? v : "https://" + v;
  }

  // youtube.com/watch itself blocks framing (X-Frame-Options: SAMEORIGIN,
  // verified live) same as its homepage/search -- but youtube.com/embed/
  // sends neither header, because that's YouTube's own official, sanctioned
  // embed player (exactly what their own "Teilen -> Einbetten" button
  // generates). So a specific video link works here; browsing/searching
  // YouTube's own site still doesn't and still needs "Extern öffnen".
  function youtubeEmbedUrl(url) {
    try {
      var u = new URL(url);
      var host = u.hostname.replace(/^(www|m)\./, "");
      var id = null;
      if (host === "youtube.com" && u.pathname === "/watch") id = u.searchParams.get("v");
      else if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
      if (id && /^[\w-]{6,15}$/.test(id)) return "https://www.youtube.com/embed/" + id;
    } catch (e) { /* not a valid absolute URL -- not a YouTube link either */ }
    return null;
  }

  // Same idea, two more sites: open.spotify.com's normal pages restrict
  // frame-ancestors to Spotify's own internal ad-preview domains only
  // (verified live), but open.spotify.com/embed/<type>/<id> -- their
  // official "Einbetten" share option -- sends no such restriction.
  // vimeo.com itself sends X-Frame-Options: sameorigin, but
  // player.vimeo.com/video/<id> -- their official embed player -- sends
  // neither header (also verified live).
  function spotifyEmbedUrl(url) {
    try {
      var u = new URL(url);
      var host = u.hostname.replace(/^open\./, "");
      if (host !== "spotify.com") return null;
      var m = u.pathname.match(/^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/);
      if (m) return "https://open.spotify.com/embed/" + m[1] + "/" + m[2];
    } catch (e) { /* not a valid absolute URL -- not a Spotify link either */ }
    return null;
  }
  function vimeoEmbedUrl(url) {
    try {
      var u = new URL(url);
      if (u.hostname.replace(/^www\./, "") !== "vimeo.com") return null;
      var m = u.pathname.match(/^\/(\d+)/);
      if (m) return "https://player.vimeo.com/video/" + m[1];
    } catch (e) { /* not a valid absolute URL -- not a Vimeo link either */ }
    return null;
  }
  function rewriteToEmbed(url) {
    return youtubeEmbedUrl(url) || spotifyEmbedUrl(url) || vimeoEmbedUrl(url) || url;
  }

  function renderTabTitle(tab) {
    tab.titleEl.textContent = tab.title || "Neuer Tab";
  }

  function createTab(activate) {
    var tab = {
      id: nextTabId++, url: null, title: "Neuer Tab",
      historyStack: [], historyIndex: -1,
    };

    tab.paneEl = document.createElement("div");
    tab.paneEl.className = "nrs-tab-pane";
    tab.paneEl.hidden = true;
    tab.paneEl.innerHTML = homeTemplateHtml;
    tab.frameEl = document.createElement("iframe");
    tab.frameEl.className = "nrs-frame";
    tab.frameEl.hidden = true;
    tab.frameEl.setAttribute("sandbox", SANDBOX_URL);
    tab.paneEl.appendChild(tab.frameEl);
    body.appendChild(tab.paneEl);

    tab.tabBtnEl = document.createElement("div");
    tab.tabBtnEl.className = "nrs-tab";
    tab.tabBtnEl.dataset.tabId = tab.id;
    var titleEl = document.createElement("span");
    titleEl.className = "nrs-tab-title";
    tab.titleEl = titleEl;
    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "nrs-tab-close";
    closeBtn.dataset.closeTab = tab.id;
    closeBtn.setAttribute("aria-label", "Tab schließen");
    closeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18 18 6M6 6l12 12"/></svg>';
    tab.tabBtnEl.appendChild(titleEl);
    tab.tabBtnEl.appendChild(closeBtn);
    tabstrip.insertBefore(tab.tabBtnEl, tabAddBtn);
    renderTabTitle(tab);

    tabs.push(tab);
    if (activate) activateTab(tab.id);
    return tab;
  }

  function updateNavButtons(tab) {
    backBtn.disabled = !tab || tab.historyIndex <= 0;
    forwardBtn.disabled = !tab || tab.historyIndex >= tab.historyStack.length - 1;
  }

  function activateTab(id) {
    activeTabId = id;
    tabs.forEach(function (t) {
      t.paneEl.hidden = t.id !== id;
      t.tabBtnEl.classList.toggle("is-active", t.id === id);
    });
    var tab = activeTab();
    address.value = tab.url || "";
    openNewTab.hidden = !tab.url || tab.urlKind === "nrs";
    if (tab.url && tab.urlKind !== "nrs") openNewTab.href = tab.url;
    updateNavButtons(tab);
  }

  function closeTab(id) {
    var index = tabs.findIndex(function (t) { return t.id === id; });
    if (index === -1) return;
    var tab = tabs[index];
    tab.paneEl.remove();
    tab.tabBtnEl.remove();
    tabs.splice(index, 1);

    if (tabs.length === 0) {
      createTab(true);
      return;
    }
    if (id === activeTabId) {
      var next = tabs[index] || tabs[index - 1];
      activateTab(next.id);
    }
  }

  // entry: {kind: "url", value} | {kind: "nrs", value: slug}
  function render(tab, entry) {
    var home = tab.paneEl.querySelector(".nrs-home");
    if (home) home.hidden = true;
    tab.frameEl.hidden = false;
    tab.frameEl.removeAttribute("src");
    tab.frameEl.removeAttribute("srcdoc");

    if (entry.kind === "nrs") {
      var displayAddress = entry.value + ".nrs";
      tab.url = displayAddress;
      tab.urlKind = "nrs";
      tab.title = displayAddress;
      renderTabTitle(tab);
      tab.frameEl.setAttribute("sandbox", SANDBOX_NRS_SITE);
      tab.frameEl.srcdoc = "<p style=\"font:14px sans-serif;padding:20px;color:#888\">Lädt …</p>";
      var thisFrame = tab.frameEl;
      fetch("/api/nrs/sites/" + encodeURIComponent(entry.value)).then(function (r) { return r.json(); }).then(function (j) {
        if (tab.frameEl !== thisFrame) return; // superseded by a newer load in this tab
        if (!j.ok) {
          thisFrame.srcdoc = "<div style=\"font:14px sans-serif;padding:24px;color:#888\">Diese .nrs-Seite gibt es nicht.</div>";
          return;
        }
        tab.title = j.site.name;
        renderTabTitle(tab);
        thisFrame.srcdoc = j.site.html_code;
      }).catch(function () {
        if (tab.frameEl === thisFrame) {
          thisFrame.srcdoc = "<div style=\"font:14px sans-serif;padding:24px;color:#888\">Konnte nicht geladen werden.</div>";
        }
      });
    } else {
      var url = rewriteToEmbed(entry.value);
      tab.url = url;
      tab.urlKind = "url";
      tab.title = hostnameOf(url);
      renderTabTitle(tab);
      tab.frameEl.setAttribute("sandbox", SANDBOX_URL);
      tab.frameEl.src = url;
    }

    if (tab.id === activeTabId) {
      address.value = tab.url;
      openNewTab.hidden = tab.urlKind === "nrs";
      if (tab.urlKind !== "nrs") openNewTab.href = tab.url;
    }
  }

  function navigate(tab, entry, pushToHistory) {
    render(tab, entry);
    if (pushToHistory) {
      tab.historyStack = tab.historyStack.slice(0, tab.historyIndex + 1);
      tab.historyStack.push(entry);
      tab.historyIndex = tab.historyStack.length - 1;
      // A back/forward replay revisits an entry already on the list, so
      // only a genuinely new navigation gets logged -- and only real
      // URLs; .nrs sites aren't logged to keep the history endpoint's
      // http(s)-only validation simple.
      if (entry.kind === "url") {
        fetch("/api/nrs/history", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: tab.url, title: tab.title }),
        }).catch(function () {});
      }
    }
    if (tab.id === activeTabId) updateNavButtons(tab);
  }

  tabAddBtn.addEventListener("click", function () { createTab(true); });
  tabstrip.addEventListener("click", function (e) {
    var closeBtn = e.target.closest("[data-close-tab]");
    if (closeBtn) {
      e.stopPropagation();
      closeTab(Number(closeBtn.dataset.closeTab));
      return;
    }
    var tabEl = e.target.closest(".nrs-tab");
    if (tabEl) activateTab(Number(tabEl.dataset.tabId));
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var tab = activeTab();
    if (!tab) return;
    var raw = address.value.trim();
    if (!raw) return;
    var nrsCandidate = /\.nrs$/i.test(raw) ? raw.slice(0, -4) : null;
    if (nrsCandidate && NRS_SLUG_RE.test(nrsCandidate)) {
      navigate(tab, { kind: "nrs", value: nrsCandidate.toLowerCase() }, true);
      return;
    }
    var url = normalizeUrl(raw);
    if (url) navigate(tab, { kind: "url", value: url }, true);
  });

  backBtn.addEventListener("click", function () {
    var tab = activeTab();
    if (!tab || tab.historyIndex <= 0) return;
    tab.historyIndex -= 1;
    navigate(tab, tab.historyStack[tab.historyIndex], false);
  });
  forwardBtn.addEventListener("click", function () {
    var tab = activeTab();
    if (!tab || tab.historyIndex >= tab.historyStack.length - 1) return;
    tab.historyIndex += 1;
    navigate(tab, tab.historyStack[tab.historyIndex], false);
  });
  reloadBtn.addEventListener("click", function () {
    var tab = activeTab();
    if (tab && tab.historyStack[tab.historyIndex]) navigate(tab, tab.historyStack[tab.historyIndex], false);
  });

  // ---------------- history panel ----------------
  function openHistoryPanel() {
    historyPanel.classList.add("open");
    historyBackdrop.classList.add("open");
    historyList.innerHTML = '<div class="nrs-history-empty">Lädt …</div>';
    fetch("/api/nrs/history").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      if (!j.entries.length) {
        historyList.innerHTML = '<div class="nrs-history-empty">Noch kein Verlauf.</div>';
        return;
      }
      historyList.innerHTML = j.entries.map(function (e) {
        return '<div class="nrs-history-row" data-url="' + esc(e.url) + '">'
          + '<div class="nrs-history-row-title">' + esc(e.title || e.url) + '</div>'
          + '<div class="nrs-history-row-url">' + esc(e.url) + '</div>'
          + '</div>';
      }).join("");
    });
  }
  function closeHistoryPanel() {
    historyPanel.classList.remove("open");
    historyBackdrop.classList.remove("open");
  }
  historyBtn.addEventListener("click", openHistoryPanel);
  historyClose.addEventListener("click", closeHistoryPanel);
  historyBackdrop.addEventListener("click", closeHistoryPanel);
  historyList.addEventListener("click", function (e) {
    var row = e.target.closest("[data-url]");
    if (!row) return;
    closeHistoryPanel();
    navigate(createTab(true), { kind: "url", value: row.dataset.url }, true);
  });
  historyClearBtn.addEventListener("click", function () {
    if (!window.confirm("Verlauf wirklich löschen?")) return;
    fetch("/api/nrs/history/clear", { method: "POST" }).then(function () {
      historyList.innerHTML = '<div class="nrs-history-empty">Noch kein Verlauf.</div>';
    });
  });

  // ---------------- mini-site builder ----------------
  function slugify(s) {
    return s.toLowerCase().trim()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "seite";
  }
  var slugTouched = false;
  createSlug.addEventListener("input", function () { slugTouched = true; });
  createName.addEventListener("input", function () {
    if (!slugTouched) createSlug.value = slugify(createName.value);
  });

  function openCreateModal() {
    createName.value = "";
    createSlug.value = "";
    createCode.value = "";
    createError.hidden = true;
    slugTouched = false;
    createBackdrop.classList.add("open");
    createModal.classList.add("open");
    createName.focus();
  }
  function closeCreateModal() {
    createBackdrop.classList.remove("open");
    createModal.classList.remove("open");
  }
  createFab.addEventListener("click", openCreateModal);
  createClose.addEventListener("click", closeCreateModal);
  createBackdrop.addEventListener("click", closeCreateModal);

  createSubmit.addEventListener("click", function () {
    var name = createName.value.trim();
    var slug = slugify(createSlug.value || createName.value);
    var code = createCode.value.trim();
    createError.hidden = true;
    if (!name || !code) {
      createError.textContent = "Name und Code dürfen nicht leer sein.";
      createError.hidden = false;
      return;
    }
    createSubmit.disabled = true;
    fetch("/api/nrs/sites", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, slug: slug, html_code: code }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      createSubmit.disabled = false;
      if (!j.ok) {
        createError.textContent = j.error === "slug_taken" ? "Diese Domain ist schon vergeben."
          : j.error === "invalid_slug" ? "Ungültige Domain -- nur Buchstaben, Zahlen und Bindestriche."
          : "Konnte nicht erstellt werden.";
        createError.hidden = false;
        return;
      }
      closeCreateModal();
      var tab = activeTab() || createTab(true);
      navigate(tab, { kind: "nrs", value: j.site.slug }, true);
    }).catch(function () {
      createSubmit.disabled = false;
      createError.textContent = "Konnte nicht erstellt werden.";
      createError.hidden = false;
    });
  });

  createTab(true);
})();
