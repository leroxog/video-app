(function () {
  "use strict";
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function api(m, u, b) {
    return fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined }).then(function (r) { return r.json(); });
  }
  function openSheet(el) { el.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeSheet(el) { el.classList.remove("open"); document.body.style.overflow = ""; }

  document.querySelectorAll(".pl-sheet-backdrop").forEach(function (bd) {
    bd.addEventListener("click", function (e) {
      if (e.target === bd || e.target.classList.contains("pl-sheet-grip") || e.target.closest("[data-close-sheet]")) closeSheet(bd);
    });
  });

  // ---- Alle / Ungelesen / Gruppen filter ----
  var filters = $("#plMsgFilters");
  if (filters) {
    filters.addEventListener("click", function (e) {
      var b = e.target.closest("[data-filter]");
      if (!b) return;
      filters.querySelectorAll("button").forEach(function (x) { x.classList.toggle("is-active", x === b); });
      var f = b.dataset.filter;
      document.querySelectorAll("#plChatList .pl-chatrow").forEach(function (row) {
        if (f === "group") row.hidden = row.dataset.group !== "1";
        else if (f === "unread") row.hidden = row.dataset.unread !== "1";
        else row.hidden = false;
      });
    });
  }

  // ---- find people: a single always-visible search pill (WhatsApp-style) ----
  var userSearch = $("#plUserSearch");
  var userResults = $("#plUserResults");
  $("#plFindBtn").addEventListener("click", function () { userSearch.focus(); });

  var searchT = null;
  userSearch.addEventListener("input", function () {
    clearTimeout(searchT);
    var q = userSearch.value.trim();
    searchT = setTimeout(function () {
      if (!q) { userResults.innerHTML = ""; return; }
      api("GET", "/api/pl/users/search?q=" + encodeURIComponent(q)).then(function (j) {
        if (!j.ok) return;
        if (!j.users.length) { userResults.innerHTML = '<div class="pl-empty" style="padding:18px 0;background:none;border:none;">Niemand gefunden.</div>'; return; }
        userResults.innerHTML = j.users.map(function (u) {
          return '<div class="pl-userrow" data-u="' + esc(u.username) + '">'
            + '<a class="pl-avatar" href="/freunde/u/' + encodeURIComponent(u.username) + '" style="background:' + esc(u.avatar_color) + ';">' + esc(u.avatar_letter) + '</a>'
            + '<a class="pl-userrow-name" href="/freunde/u/' + encodeURIComponent(u.username) + '">@' + esc(u.username) + '</a>'
            + (u.mutual
              ? '<button class="pl-mini-btn pink" data-dm>Schreiben</button>'
              : '<button class="pl-mini-btn ' + (u.i_follow ? "" : "pink") + '" data-follow>' + (u.i_follow ? "Entfolgen" : "Folgen") + '</button>')
            + '</div>';
        }).join("");
      });
    }, 220);
  });

  userResults.addEventListener("click", function (e) {
    var row = e.target.closest(".pl-userrow");
    if (!row) return;
    var uname = row.dataset.u;
    if (e.target.closest("[data-follow]")) {
      var btn = e.target.closest("[data-follow]");
      api("POST", "/api/pl/follow/" + encodeURIComponent(uname)).then(function (j) {
        if (!j.ok) return;
        if (j.mutual) { btn.outerHTML = '<button class="pl-mini-btn pink" data-dm>Schreiben</button>'; }
        else { btn.textContent = j.following ? "Entfolgen" : "Folgen"; btn.classList.toggle("pink", !j.following); }
      });
    } else if (e.target.closest("[data-dm]")) {
      api("POST", "/api/pl/chats/dm/" + encodeURIComponent(uname)).then(function (j) {
        if (j.ok) location.href = "/freunde/c/" + j.chat_id;
        else window.plToast(j.error === "not_mutual" ? "Ihr müsst euch gegenseitig folgen." : "Ging nicht.");
      });
    }
  });

  // ---- new chat / group ----
  var newChatSheet = $("#plNewChatSheet");
  var mutualList = $("#plMutualList");
  var selected = {};
  $("#plNewChatBtn").addEventListener("click", function () {
    $("#plGroupName").value = "";
    selected = {};
    mutualList.innerHTML = '<div class="pl-empty" style="padding:16px 0;background:none;border:none;">Lädt …</div>';
    openSheet(newChatSheet);
    api("GET", "/api/pl/mutuals").then(function (j) { renderMutuals(j.ok ? j.users : []); });
  });

  function renderMutuals(list) {
    if (!list.length) {
      mutualList.innerHTML = '<div class="pl-empty" style="padding:16px 0;background:none;border:none;">Noch niemand folgt dir zurück. Nutze zuerst die Suche.</div>';
      return;
    }
    mutualList.innerHTML = list.map(function (u) {
      return '<label class="pl-checkrow"><div class="pl-avatar" style="background:' + esc(u.avatar_color) + ';">' + esc(u.avatar_letter) + '</div>'
        + '<span class="pl-checkrow-name">@' + esc(u.username) + '</span>'
        + '<input type="checkbox" data-u="' + esc(u.username) + '"></label>';
    }).join("");
  }

  mutualList.addEventListener("change", function (e) {
    if (e.target.matches("input[type=checkbox]")) {
      var u = e.target.dataset.u;
      if (e.target.checked) selected[u] = true; else delete selected[u];
    }
  });

  $("#plCreateChatBtn").addEventListener("click", function () {
    var names = Object.keys(selected);
    if (!names.length) { window.plToast("Wähl mindestens eine Person."); return; }
    var groupName = $("#plGroupName").value.trim();
    if (names.length === 1 && !groupName) {
      api("POST", "/api/pl/chats/dm/" + encodeURIComponent(names[0])).then(function (j) {
        if (j.ok) location.href = "/freunde/c/" + j.chat_id;
        else window.plToast("Ging nicht.");
      });
      return;
    }
    if (!groupName) { window.plToast("Für eine Gruppe brauchst du einen Namen."); return; }
    api("POST", "/api/pl/chats/group", { name: groupName, members: names }).then(function (j) {
      if (j.ok) location.href = "/freunde/c/" + j.chat_id;
      else window.plToast("Ging nicht.");
    });
  });

  // ---- servers: create / join by invite code ----
  var serverSheet = $("#plServerSheet");
  var serverAddBtn = $("#plServerAddBtn");
  if (serverAddBtn && serverSheet) {
    serverAddBtn.addEventListener("click", function () { openSheet(serverSheet); });
    $("#plCreateServerBtn").addEventListener("click", function () {
      var name = $("#plNewServerName").value.trim();
      if (!name) { window.plToast("Gib deinem Server einen Namen."); return; }
      api("POST", "/api/pl/servers", { name: name }).then(function (j) {
        if (j.ok) location.href = "/freunde/server/" + j.server.id;
        else window.plToast("Ging nicht.");
      });
    });
    $("#plJoinServerBtn").addEventListener("click", function () {
      var code = $("#plJoinServerCode").value.trim();
      if (!code) { window.plToast("Gib einen Einladungscode ein."); return; }
      api("POST", "/api/pl/servers/join/" + encodeURIComponent(code)).then(function (j) {
        if (j.ok) location.href = "/freunde/server/" + j.server.id;
        else window.plToast(j.error === "banned" ? "Du bist von diesem Server verbannt." : "Ungültiger Einladungscode.");
      });
    });
  }

  // ---- desktop split view: open a chat in the right pane instead of
  // navigating away (WhatsApp Web-style) -- mobile just follows the link
  // normally, there's no room for two panes there. ----
  var detail = $("#plFriendsDetail");
  var emptyEl = $("#plFriendsEmpty");
  var frame = $("#plFriendsFrame");
  var chatList = $("#plChatList");
  var isDesktop = window.matchMedia("(min-width: 900px)");

  function openInPane(id, rowEl) {
    frame.src = "/freunde/c/" + id;
    frame.hidden = false;
    emptyEl.hidden = true;
    document.querySelectorAll("#plChatList .pl-chatrow.is-active").forEach(function (r) { r.classList.remove("is-active"); });
    if (rowEl) rowEl.classList.add("is-active");
  }

  if (chatList && detail) {
    chatList.addEventListener("click", function (e) {
      if (!isDesktop.matches) return; // mobile: let the <a> navigate normally
      var row = e.target.closest(".pl-chatrow[data-chat-id]");
      if (!row) return;
      e.preventDefault();
      openInPane(row.dataset.chatId, row);
    });
  }

  document.querySelectorAll('[data-quick="newchat"]').forEach(function (b) { b.addEventListener("click", function () { $("#plNewChatBtn").click(); }); });
  document.querySelectorAll('[data-quick="server"]').forEach(function (b) { b.addEventListener("click", function () { $("#plServerAddBtn").click(); }); });
})();
