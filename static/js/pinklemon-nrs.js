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

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // Each tab keeps its own visited-URL stack for back/forward -- a
  // cross-origin iframe's own navigation history isn't something this
  // page is allowed to read or drive from the outside, so this is the
  // only way to do back/forward at all. Every tab's pane (home state +
  // iframe) stays in the DOM the whole time it's open, just hidden when
  // not the active one, so switching tabs never reloads a page.
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
    tab.frameEl.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
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
    openNewTab.hidden = !tab.url;
    if (tab.url) openNewTab.href = tab.url;
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

  function load(tab, url, pushToHistory) {
    url = youtubeEmbedUrl(url) || url;
    var home = tab.paneEl.querySelector(".nrs-home");
    if (home) home.hidden = true;
    tab.frameEl.hidden = false;
    tab.frameEl.src = url;
    tab.url = url;
    tab.title = hostnameOf(url);
    renderTabTitle(tab);
    if (pushToHistory) {
      tab.historyStack = tab.historyStack.slice(0, tab.historyIndex + 1);
      tab.historyStack.push(url);
      tab.historyIndex = tab.historyStack.length - 1;
      // A back/forward replay revisits a URL already on the list, so
      // only a genuinely new navigation gets logged here.
      fetch("/api/nrs/history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url, title: tab.title }),
      }).catch(function () {});
    }
    if (tab.id === activeTabId) {
      address.value = url;
      openNewTab.hidden = false;
      openNewTab.href = url;
      updateNavButtons(tab);
    }
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
    var url = normalizeUrl(address.value);
    var tab = activeTab();
    if (url && tab) load(tab, url, true);
  });

  backBtn.addEventListener("click", function () {
    var tab = activeTab();
    if (!tab || tab.historyIndex <= 0) return;
    tab.historyIndex -= 1;
    load(tab, tab.historyStack[tab.historyIndex], false);
  });
  forwardBtn.addEventListener("click", function () {
    var tab = activeTab();
    if (!tab || tab.historyIndex >= tab.historyStack.length - 1) return;
    tab.historyIndex += 1;
    load(tab, tab.historyStack[tab.historyIndex], false);
  });
  reloadBtn.addEventListener("click", function () {
    var tab = activeTab();
    if (tab && tab.historyStack[tab.historyIndex]) load(tab, tab.historyStack[tab.historyIndex], false);
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
    load(createTab(true), row.dataset.url, true);
  });
  historyClearBtn.addEventListener("click", function () {
    if (!window.confirm("Verlauf wirklich löschen?")) return;
    fetch("/api/nrs/history/clear", { method: "POST" }).then(function () {
      historyList.innerHTML = '<div class="nrs-history-empty">Noch kein Verlauf.</div>';
    });
  });

  createTab(true);
})();
