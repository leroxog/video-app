(function () {
  "use strict";
  var isAdmin = !!(window.NRS_SERVER && window.NRS_SERVER.isAdmin);
  var tabs = document.getElementById("svTabs");
  var serversSection = document.getElementById("svServersSection");
  var hostsSection = document.getElementById("svHostsSection");
  var list = document.getElementById("svList");
  var noHosts = document.getElementById("svNoHosts");
  var newBtn = document.getElementById("svNewBtn");
  var newForm = document.getElementById("svNewForm");
  var newError = document.getElementById("svNewError");
  var versionSelect = document.getElementById("svVersion");
  var hostList = document.getElementById("svHostList");
  var addHostBtn = document.getElementById("svAddHostBtn");
  var hostForm = document.getElementById("svHostForm");
  var hostError = document.getElementById("svHostError");
  var tokenBox = document.getElementById("svTokenBox");
  var inviteBtn = document.getElementById("svInviteBtn");

  var STATUS_LABELS = { offline: "Offline", queued: "In Warteschlange", starting: "Startet …", online: "Online", stopping: "Stoppt …" };
  var ERRORS = {
    empty_name: "Gib einen Namen ein.",
    bad_version: "Diese Version ist nicht verfügbar.",
    limit_reached: "Du kannst höchstens 2 Server anlegen.",
    bad_invite: "Der Einladungscode ist ungültig, abgelaufen oder schon benutzt.",
  };

  var servers = [];
  var openConsoles = {};
  var activeTab = "servers";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function post(url, body) {
    return fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function copyText(text) {
    if (navigator.clipboard) return navigator.clipboard.writeText(text);
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return Promise.resolve();
  }

  // ---------------------------------------------------------------- servers

  function cardHtml(s) {
    var pill = '<span class="sv-pill ' + esc(s.status) + '">' + STATUS_LABELS[s.status] + '</span>';
    var main;
    if (s.status === "offline") main = '<button type="button" class="sv-btn" data-act="start">Start</button>';
    else if (s.status === "stopping") main = '<button type="button" class="sv-btn secondary" disabled>Stoppt …</button>';
    else main = '<button type="button" class="sv-btn danger" data-act="stop">' + (s.status === "queued" ? "Abbrechen" : "Stopp") + '</button>';
    var showAddress = s.address && (s.status === "starting" || s.status === "online");
    return '<div class="sv-card" data-id="' + s.id + '">'
      + '<div class="sv-card-top"><div class="sv-card-name"></div>' + pill + '</div>'
      + '<div class="sv-meta"><span>Minecraft ' + esc(s.version) + '</span>'
      + (s.status === "online" ? '<span>' + s.players + ' / ' + s.max_players + ' Spieler</span>' : '')
      + (s.host ? '<span class="sv-hostname"></span>' : '') + '</div>'
      + (showAddress ? '<div class="sv-address"><code></code><button type="button" class="sv-btn small secondary" data-act="copy">Kopieren</button></div>' : '')
      + '<div class="sv-actions">' + main
      + (s.status === "offline" ? '<button type="button" class="sv-btn secondary small" data-act="delete">Löschen</button>' : '')
      + '<label class="sv-auto"><input type="checkbox" data-act="auto"' + (s.auto_start ? " checked" : "") + '> Beim Öffnen der Seite automatisch starten</label></div>'
      + '<details class="sv-console"' + (openConsoles[s.id] ? " open" : "") + '><summary>Konsole</summary><pre></pre></details>'
      + '</div>';
  }

  function renderServers() {
    if (!servers.length) {
      list.innerHTML = '<div class="sv-empty">Noch kein Server -- leg mit &bdquo;Neuer Server&ldquo; los.</div>';
      return;
    }
    list.innerHTML = servers.map(cardHtml).join("");
    servers.forEach(function (s) {
      var card = list.querySelector('.sv-card[data-id="' + s.id + '"]');
      card.querySelector(".sv-card-name").textContent = s.name;
      var hostEl = card.querySelector(".sv-hostname");
      if (hostEl) hostEl.textContent = "Läuft auf: " + s.host;
      var addr = card.querySelector(".sv-address code");
      if (addr) addr.textContent = s.address;
      var pre = card.querySelector(".sv-console pre");
      pre.textContent = s.console || "Noch keine Ausgabe.";
      pre.scrollTop = pre.scrollHeight;
    });
  }

  function loadServers() {
    return fetch("/api/mc/servers").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      servers = j.servers;
      var waiting = servers.some(function (s) { return s.status === "queued"; });
      noHosts.hidden = !(waiting && j.hosts_online === 0);
      renderServers();
    });
  }

  list.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-act]");
    var card = e.target.closest(".sv-card");
    if (!btn || !card) return;
    var id = card.dataset.id;
    var act = btn.dataset.act;
    if (act === "copy") {
      var address = card.querySelector(".sv-address code").textContent;
      copyText(address).then(function () { btn.textContent = "Kopiert"; });
    } else if (act === "start" || act === "stop") {
      btn.disabled = true;
      post("/api/mc/servers/" + id + "/" + act).then(loadServers);
    } else if (act === "delete") {
      if (!window.confirm("Diesen Server wirklich löschen?")) return;
      fetch("/api/mc/servers/" + id, { method: "DELETE" }).then(loadServers);
    }
  });

  list.addEventListener("change", function (e) {
    var box = e.target.closest('[data-act="auto"]');
    var card = e.target.closest(".sv-card");
    if (box && card) post("/api/mc/servers/" + card.dataset.id + "/auto-start", { enabled: box.checked });
  });

  list.addEventListener("toggle", function (e) {
    var card = e.target.closest && e.target.closest(".sv-card");
    if (card && e.target.matches("details")) openConsoles[card.dataset.id] = e.target.open;
  }, true);

  newBtn.addEventListener("click", function () {
    newForm.hidden = !newForm.hidden;
    newError.textContent = "";
    if (!newForm.hidden && !versionSelect.options.length) {
      fetch("/api/mc/versions").then(function (r) { return r.json(); }).then(function (j) {
        versionSelect.innerHTML = j.versions.map(function (v) { return '<option>' + esc(v) + '</option>'; }).join("");
      });
    }
  });

  newForm.addEventListener("submit", function (e) {
    e.preventDefault();
    newError.textContent = "";
    post("/api/mc/servers", {
      name: document.getElementById("svName").value,
      version: versionSelect.value,
      max_players: Number(document.getElementById("svPlayers").value),
    }).then(function (j) {
      if (!j.ok) { newError.textContent = ERRORS[j.error] || "Ging nicht."; return; }
      document.getElementById("svName").value = "";
      newForm.hidden = true;
      loadServers();
    });
  });

  // ------------------------------------------------------------------ hosts

  function renderHosts(hosts) {
    if (!hosts.length) {
      hostList.innerHTML = '<div class="sv-empty">Noch kein Computer hinzugefügt.</div>';
      return;
    }
    hostList.innerHTML = hosts.map(function (h) {
      return '<div class="sv-card" data-host="' + h.id + '"><div class="sv-host">'
        + '<div class="sv-host-name"></div>'
        + '<span class="sv-pill ' + (h.online ? "online" : "") + '">' + (h.online ? "Online" : "Offline") + '</span>'
        + '<button type="button" class="sv-btn secondary small" data-act="remove">Entfernen</button></div>'
        + '<div class="sv-meta"><span class="sv-hostaddr"></span><span>Läuft: ' + h.running + ' / ' + h.max_servers + ' Server</span>'
        + (isAdmin ? '<span class="sv-hostowner"></span>' : '') + '</div></div>';
    }).join("");
    hosts.forEach(function (h) {
      var card = hostList.querySelector('[data-host="' + h.id + '"]');
      card.querySelector(".sv-host-name").textContent = h.name;
      card.querySelector(".sv-hostaddr").textContent = h.address ? "Adresse: " + h.address : "Adresse: noch nicht gemeldet";
      var owner = card.querySelector(".sv-hostowner");
      if (owner) owner.textContent = "Besitzer: " + (h.owner || "?");
    });
  }

  function loadHosts() {
    return fetch("/api/mc/hosts").then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) renderHosts(j.hosts);
    });
  }

  hostList.addEventListener("click", function (e) {
    var btn = e.target.closest('[data-act="remove"]');
    var card = e.target.closest("[data-host]");
    if (!btn || !card) return;
    if (!window.confirm("Computer entfernen? Server, die darauf laufen, werden gestoppt.")) return;
    fetch("/api/mc/hosts/" + card.dataset.host, { method: "DELETE" }).then(loadHosts);
  });

  addHostBtn.addEventListener("click", function () {
    hostForm.hidden = !hostForm.hidden;
    tokenBox.hidden = true;
    hostError.textContent = "";
  });

  hostForm.addEventListener("submit", function (e) {
    e.preventDefault();
    hostError.textContent = "";
    post("/api/mc/hosts", {
      invite: document.getElementById("svInvite").value,
      name: document.getElementById("svHostName").value,
    }).then(function (j) {
      if (!j.ok) { hostError.textContent = ERRORS[j.error] || "Ging nicht."; return; }
      document.getElementById("svTokenValue").textContent = j.token;
      document.getElementById("svCommand").textContent =
        "python nrs_host_agent.py --site " + location.origin + " --token " + j.token + " --accept-eula";
      tokenBox.hidden = false;
      hostForm.hidden = true;
      document.getElementById("svInvite").value = "";
      document.getElementById("svHostName").value = "";
      loadHosts();
    });
  });

  if (inviteBtn) {
    inviteBtn.addEventListener("click", function () {
      post("/api/mc/invites").then(function (j) {
        if (!j.ok) return;
        document.getElementById("svInviteCode").textContent = j.code;
        document.getElementById("svInviteBox").hidden = false;
      });
    });
  }

  // -------------------------------------------------------------- tabs, polling

  tabs.addEventListener("click", function (e) {
    var tab = e.target.closest(".sv-tab");
    if (!tab) return;
    activeTab = tab.dataset.tab;
    tabs.querySelectorAll(".sv-tab").forEach(function (t) { t.classList.toggle("active", t === tab); });
    serversSection.hidden = activeTab !== "servers";
    hostsSection.hidden = activeTab !== "hosts";
    if (activeTab === "hosts") loadHosts(); else loadServers();
  });

  // Opening the panel starts servers marked "auto-start"; the page then keeps itself up to date.
  function refresh() {
    if (document.hidden) return;
    if (activeTab === "servers") loadServers(); else loadHosts();
  }

  post("/api/mc/auto-start").then(loadServers);
  setInterval(refresh, 3000);
  document.addEventListener("visibilitychange", refresh);
})();
