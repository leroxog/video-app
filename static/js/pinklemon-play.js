(function () {
  "use strict";
  var cfg = window.NRS_PLAY || {};
  var tabsEl = document.getElementById("pgTabs");
  var sections = {
    discover: document.getElementById("pgDiscover"),
    mine: document.getElementById("pgMine"),
    review: document.getElementById("pgReview"),
  };
  var grid = document.getElementById("pgGrid");
  var sortBar = document.getElementById("pgSort");
  var sort = "new";
  var activeTab = "discover";

  var STATUS_LABELS = { pending: "In Prüfung", published: "Veröffentlicht", rejected: "Abgelehnt", hidden: "Ausgeblendet (gemeldet)" };
  var ERRORS = {
    empty_title: "Gib deinem Spiel einen Titel.",
    empty_code: "Füge den Code deines Spiels ein.",
    code_too_long: "Der Code ist zu lang (höchstens 100.000 Zeichen).",
    limit_reached: "Du kannst höchstens " + cfg.maxGames + " Spiele haben. Lösche zuerst eins.",
  };
  var EXAMPLE = '<!DOCTYPE html>\n<html><head><meta charset="utf-8">\n<style>\n'
    + '  body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;'
    + 'background:linear-gradient(135deg,#1b1f4b,#0d6b6b);color:#fff;font-family:system-ui,sans-serif}\n'
    + '  button{font:inherit;font-size:22px;font-weight:700;padding:18px 34px;border:0;border-radius:999px;cursor:pointer;'
    + 'background:#ffd479;color:#2a1c00}\n  button:active{transform:scale(.95)}\n</style></head><body>\n'
    + '<h1>Klick-Rennen</h1><div id="n" style="font-size:64px;font-weight:800">0</div>\n'
    + '<button id="b">Klick mich!</button>\n<script>\n  var n = 0;\n'
    + '  document.getElementById("b").onclick = function () {\n    n++;\n    document.getElementById("n").textContent = n;\n  };\n'
    + '<\/script>\n</body></html>';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function post(url, body, method) {
    return fetch(url, {
      method: method || "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function euro(n) { return n.toFixed(2).replace(".", ",") + " €"; }
  function num(n) { return Number(n).toLocaleString("de-DE"); }

  // ------------------------------------------------------------ discover

  function cardEl(g) {
    var card = el("a", "pg-card pg-glass");
    card.href = "/spiele/" + g.id;
    var cover = el("div", "pg-cover pg-a" + g.accent);
    cover.appendChild(el("span", "pg-views", num(g.views) + " Aufrufe"));
    cover.appendChild(el("span", "emoji", g.emoji));
    var body = el("div", "pg-card-body");
    body.appendChild(el("h3", "pg-card-title", g.title));
    body.appendChild(el("p", "pg-card-desc", g.description || "Ein Spiel von " + g.author));
    var foot = el("div", "pg-card-foot");
    foot.appendChild(el("span", "pg-avatar", (g.author || "?").slice(0, 1).toUpperCase()));
    foot.appendChild(el("span", "", g.author));
    foot.appendChild(el("span", "pg-play", "Spielen →"));
    body.appendChild(foot);
    card.appendChild(cover);
    card.appendChild(body);
    return card;
  }

  function loadGames() {
    return fetch("/api/play/games?sort=" + sort).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      grid.textContent = "";
      if (!j.games.length) {
        grid.appendChild(el("div", "pg-empty", "Noch keine Spiele. Sei die erste Person und veröffentliche eins!"));
        return;
      }
      j.games.forEach(function (g) { grid.appendChild(cardEl(g)); });
    });
  }

  sortBar.addEventListener("click", function (e) {
    var chip = e.target.closest(".pg-chip");
    if (!chip) return;
    sort = chip.dataset.sort;
    sortBar.querySelectorAll(".pg-chip").forEach(function (c) { c.classList.toggle("active", c === chip); });
    loadGames();
  });

  // ----------------------------------------------------------------- tabs

  function showTab(name) {
    activeTab = name;
    Object.keys(sections).forEach(function (key) {
      if (sections[key]) sections[key].hidden = key !== name;
    });
    tabsEl.querySelectorAll(".pg-tab").forEach(function (t) { t.classList.toggle("active", t.dataset.tab === name); });
    if (name === "discover") loadGames();
    if (name === "mine" && !cfg.isGuest) loadMine();
    if (name === "review") loadReview();
    document.querySelector(".pg-scroll").scrollTop = 0;
  }

  tabsEl.addEventListener("click", function (e) {
    var tab = e.target.closest(".pg-tab");
    if (tab) showTab(tab.dataset.tab);
  });

  document.getElementById("pgHeroCreate").addEventListener("click", function () {
    showTab("mine");
    if (!cfg.isGuest) openEditor(null);
  });

  if (cfg.isGuest) return loadGames();

  // ------------------------------------------------------------ my games

  var mineList = document.getElementById("pgMineList");
  var editor = document.getElementById("pgEditor");
  var editorError = document.getElementById("pgEditorError");
  var swatches = document.getElementById("pgSwatches");
  var previewFrame = document.getElementById("pgPreview");
  var editingId = null;
  var accent = 0;

  for (var i = 0; i < 6; i++) {
    var swatch = el("button", "pg-swatch pg-a" + i);
    swatch.type = "button";
    swatch.dataset.accent = i;
    swatch.setAttribute("aria-label", "Farbe " + (i + 1));
    swatches.appendChild(swatch);
  }

  function setAccent(value) {
    accent = Number(value);
    swatches.querySelectorAll(".pg-swatch").forEach(function (s) { s.classList.toggle("active", Number(s.dataset.accent) === accent); });
  }
  swatches.addEventListener("click", function (e) {
    var s = e.target.closest(".pg-swatch");
    if (s) setAccent(s.dataset.accent);
  });

  function openEditor(game) {
    editingId = game ? game.id : null;
    document.getElementById("pgEditorTitle").textContent = game ? "Spiel bearbeiten" : "Neues Spiel";
    document.getElementById("pgEmoji").value = game ? game.emoji : "🎮";
    document.getElementById("pgTitle").value = game ? game.title : "";
    document.getElementById("pgDesc").value = game ? game.description : "";
    document.getElementById("pgCode").value = game ? game.code : "";
    setAccent(game ? game.accent : 0);
    editorError.textContent = "";
    previewFrame.srcdoc = game ? game.code : "";
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditor() { editor.hidden = true; editingId = null; previewFrame.srcdoc = ""; }

  document.getElementById("pgNewBtn").addEventListener("click", function () { openEditor(null); });
  document.getElementById("pgCancelBtn").addEventListener("click", closeEditor);
  document.getElementById("pgExampleBtn").addEventListener("click", function () {
    document.getElementById("pgCode").value = EXAMPLE;
    if (!document.getElementById("pgTitle").value) document.getElementById("pgTitle").value = "Klick-Rennen";
    previewFrame.srcdoc = EXAMPLE;
  });
  document.getElementById("pgPreviewBtn").addEventListener("click", function () {
    previewFrame.srcdoc = document.getElementById("pgCode").value;
  });

  document.getElementById("pgSubmit").addEventListener("click", function () {
    editorError.textContent = "";
    var body = {
      title: document.getElementById("pgTitle").value,
      description: document.getElementById("pgDesc").value,
      emoji: document.getElementById("pgEmoji").value,
      code: document.getElementById("pgCode").value,
      accent: accent,
    };
    var request = editingId ? post("/api/play/games/" + editingId, body, "PUT") : post("/api/play/games", body);
    request.then(function (j) {
      if (!j.ok) { editorError.textContent = ERRORS[j.error] || "Ging nicht."; return; }
      closeEditor();
      loadMine();
    });
  });

  function mineItem(g) {
    var item = el("div", "pg-item pg-glass");
    var mini = el("div", "mini pg-a" + g.accent, g.emoji);
    var info = el("div", "info");
    info.appendChild(el("div", "name", g.title));
    var meta = el("div", "meta");
    meta.appendChild(el("span", "pg-status " + g.status, STATUS_LABELS[g.status] || g.status));
    meta.appendChild(el("span", "", num(g.views) + " Aufrufe"));
    meta.appendChild(el("span", "", "≈ " + euro(g.earnings_eur)));
    info.appendChild(meta);
    if (g.status === "rejected" && g.review_note) info.appendChild(el("div", "note", "Hinweis vom Admin: " + g.review_note));
    var btns = el("div", "btns");
    var play = el("a", "pg-btn glass small", g.status === "published" ? "Spielen" : "Ansehen");
    play.href = "/spiele/" + g.id;
    var edit = el("button", "pg-btn glass small", "Bearbeiten");
    edit.type = "button";
    edit.addEventListener("click", function () {
      fetch("/api/play/games/" + g.id + "/source").then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) openEditor({ id: g.id, title: j.game.title, description: j.game.description, code: j.game.code, emoji: j.game.emoji, accent: j.game.accent });
      });
    });
    var del = el("button", "pg-btn danger small", "Löschen");
    del.type = "button";
    del.addEventListener("click", function () {
      if (!window.confirm("Dieses Spiel wirklich löschen?")) return;
      fetch("/api/play/games/" + g.id, { method: "DELETE" }).then(loadMine);
    });
    [play, edit, del].forEach(function (b) { btns.appendChild(b); });
    item.appendChild(mini);
    item.appendChild(info);
    item.appendChild(btns);
    return item;
  }

  function loadMine() {
    return fetch("/api/play/mine").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      document.getElementById("pgStatGames").textContent = j.totals.games;
      document.getElementById("pgStatViews").textContent = num(j.totals.views);
      document.getElementById("pgStatEarn").textContent = euro(j.totals.earnings_eur);
      mineList.textContent = "";
      if (!j.games.length) {
        mineList.appendChild(el("div", "pg-empty", "Du hast noch kein Spiel. Drück auf „Neues Spiel“ und probier das Beispiel aus!"));
        return;
      }
      j.games.forEach(function (g) { mineList.appendChild(mineItem(g)); });
    });
  }

  // -------------------------------------------------------------- review

  var reviewList = document.getElementById("pgReviewList");

  function reviewItem(g) {
    var item = el("div", "pg-item pg-glass pg-review");
    var top = el("div", "info");
    top.appendChild(el("div", "name", g.emoji + " " + g.title));
    var meta = el("div", "meta");
    meta.appendChild(el("span", "pg-status " + g.status, STATUS_LABELS[g.status]));
    meta.appendChild(el("span", "", "von " + g.author));
    if (g.reports) meta.appendChild(el("span", "", g.reports + " Meldungen"));
    top.appendChild(meta);
    if (g.description) top.appendChild(el("div", "meta", g.description));
    var preview = el("div", "pg-preview");
    var frame = document.createElement("iframe");
    frame.src = "/spiele/frame/" + g.id; // sandboxed by that response's own Content-Security-Policy header
    frame.title = g.title;
    preview.appendChild(frame);
    var note = el("input", "pg-input");
    note.placeholder = "Grund bei Ablehnung (wird dem Ersteller gezeigt)";
    note.maxLength = 200;
    var btns = el("div", "btns");
    var approve = el("button", "pg-btn small", "Freigeben");
    var reject = el("button", "pg-btn danger small", "Ablehnen");
    [approve, reject].forEach(function (b) { b.type = "button"; btns.appendChild(b); });
    approve.addEventListener("click", function () {
      post("/api/play/games/" + g.id + "/review", { decision: "approve" }).then(loadReview);
    });
    reject.addEventListener("click", function () {
      post("/api/play/games/" + g.id + "/review", { decision: "reject", note: note.value }).then(loadReview);
    });
    [top, preview, note, btns].forEach(function (n) { item.appendChild(n); });
    return item;
  }

  function loadReview() {
    if (!reviewList) return;
    return fetch("/api/play/review").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      reviewList.textContent = "";
      if (!j.games.length) {
        reviewList.appendChild(el("div", "pg-empty", "Nichts zu prüfen. Alles sauber!"));
        return;
      }
      j.games.forEach(function (g) { reviewList.appendChild(reviewItem(g)); });
    });
  }

  loadGames();
})();
