(function () {
  "use strict";

  var msgsEl = document.getElementById("nxMsgs");
  var emptyEl = document.getElementById("nxEmpty");
  var input = document.getElementById("nxInput");
  var sendBtn = document.getElementById("nxSend");
  var sidebar = document.getElementById("nxSidebar");
  var sidebarBackdrop = document.getElementById("nxSidebarBackdrop");
  var sidebarList = document.getElementById("nxSidebarList");
  var menuBtn = document.getElementById("nxMenuBtn");
  var newChatBtn = document.getElementById("nxNewChat");
  var busy = false;
  var activeChatId = window.NEX_CHAT_ID || null;
  var chats = window.NEX_CHATS || [];
  var openRowMenu = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------------- message pane ----------------
  function clearEmpty() { if (emptyEl) { emptyEl.remove(); emptyEl = null; } }

  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function showEmptyPane() {
    msgsEl.innerHTML = '<div class="nx-empty" id="nxEmpty">'
      + document.querySelector(".nx-top-mark").outerHTML.replace('class="nx-top-mark"', 'class="nx-empty-mark"')
      + "<h2>Hallo, ich bin Nex</h2><p>Frag mich einfach irgendwas.</p></div>";
    emptyEl = document.getElementById("nxEmpty");
  }

  function addMsg(role, text) {
    clearEmpty();
    var row = document.createElement("div");
    row.className = "nx-row " + (role === "user" ? "me" : "them");
    var b = document.createElement("div");
    b.className = "nx-bubble";
    b.textContent = text;
    row.appendChild(b);
    msgsEl.appendChild(row);
    scrollDown();
    return b;
  }

  var typingRow = null;
  function showTyping() {
    if (typingRow) return;
    clearEmpty();
    typingRow = document.createElement("div");
    typingRow.className = "nx-row them";
    typingRow.innerHTML = '<div class="nx-bubble" style="padding:0;"><div class="nx-typing"><span></span><span></span><span></span></div></div>';
    msgsEl.appendChild(typingRow);
    scrollDown();
  }
  function hideTyping() { if (typingRow) { typingRow.remove(); typingRow = null; } }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }
  function syncSend() { sendBtn.disabled = busy || !input.value.trim(); }
  input.addEventListener("input", function () { autoGrow(); syncSend(); });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  syncSend();

  function nice(err) {
    if (err === "empty") return "Schreib mir doch was.";
    if (err === "not_found") return "Dieser Chat existiert nicht mehr.";
    return "Das hat gerade nicht geklappt. Nochmal versuchen?";
  }

  // ---------------- sidebar ----------------
  function closeRowMenu() { if (openRowMenu) { openRowMenu.remove(); openRowMenu = null; } }

  function closeSidebar() { sidebar.classList.remove("open"); sidebarBackdrop.classList.remove("open"); }
  function openSidebar() { sidebar.classList.add("open"); sidebarBackdrop.classList.add("open"); }
  menuBtn.addEventListener("click", function () { sidebar.classList.contains("open") ? closeSidebar() : openSidebar(); });
  sidebarBackdrop.addEventListener("click", closeSidebar);

  function renderSidebar() {
    if (!chats.length) {
      sidebarList.innerHTML = '<div class="nx-sidebar-empty">Noch keine Chats.</div>';
      return;
    }
    sidebarList.innerHTML = chats.map(function (c) {
      return '<div class="nx-sidebar-row' + (c.id === activeChatId ? " is-active" : "") + '" data-chat-id="' + c.id + '">'
        + '<span class="nx-sidebar-row-title">' + esc(c.title) + '</span>'
        + '<button type="button" class="nx-sidebar-row-more" data-more aria-label="Mehr">'
        + '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></button>'
        + "</div>";
    }).join("");
  }
  renderSidebar();

  function setActive(id) {
    activeChatId = id;
    window.NEX_CHAT_ID = id;
    sidebarList.querySelectorAll(".nx-sidebar-row").forEach(function (row) {
      row.classList.toggle("is-active", Number(row.dataset.chatId) === id);
    });
    history.pushState(null, "", id ? "/?chat=" + id : "/");
  }

  function switchToChat(id) {
    if (id === activeChatId) { closeSidebar(); return; }
    fetch("/api/ai/chats/" + id + "/messages")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { window.plToast && window.plToast(nice(j.error)); return; }
        setActive(id);
        if (!j.messages.length) { showEmptyPane(); }
        else {
          msgsEl.innerHTML = "";
          emptyEl = null;
          j.messages.forEach(function (m) { addMsg(m.role, m.content); });
        }
        closeSidebar();
      });
  }

  function newChat() {
    setActive(null);
    showEmptyPane();
    closeSidebar();
  }
  newChatBtn.addEventListener("click", newChat);

  function renameChat(id, row) {
    closeRowMenu();
    var titleEl = row.querySelector(".nx-sidebar-row-title");
    var current = titleEl.textContent;
    titleEl.innerHTML = '<input type="text" maxlength="100">';
    var inp = titleEl.querySelector("input");
    inp.value = current;
    inp.focus();
    inp.select();
    function commit() {
      var title = inp.value.trim();
      if (!title || title === current) { titleEl.textContent = current; return; }
      fetch("/api/ai/chats/" + id, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        titleEl.textContent = j.ok ? j.chat.title : current;
        var c = chats.find(function (c) { return c.id === id; });
        if (c && j.ok) c.title = j.chat.title;
      }).catch(function () { titleEl.textContent = current; });
    }
    inp.addEventListener("blur", commit);
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      if (e.key === "Escape") { titleEl.textContent = current; }
    });
  }

  function deleteChat(id) {
    closeRowMenu();
    if (!window.confirm("Diesen Chat wirklich löschen?")) return;
    fetch("/api/ai/chats/" + id + "/delete", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      chats = chats.filter(function (c) { return c.id !== id; });
      renderSidebar();
      if (id === activeChatId) {
        if (chats.length) switchToChat(chats[0].id);
        else newChat();
      }
    });
  }

  sidebarList.addEventListener("click", function (e) {
    var moreBtn = e.target.closest("[data-more]");
    var row = e.target.closest(".nx-sidebar-row");
    if (!row) return;
    var id = Number(row.dataset.chatId);
    if (moreBtn) {
      e.stopPropagation();
      var wasOpenOnThisRow = openRowMenu && row.classList.contains("is-open-menu");
      closeRowMenu();
      sidebarList.querySelectorAll(".is-open-menu").forEach(function (r) { r.classList.remove("is-open-menu"); });
      if (wasOpenOnThisRow) return;
      row.classList.add("is-open-menu");
      var menu = document.createElement("div");
      menu.className = "nx-row-menu";
      menu.innerHTML = '<button type="button" data-act="rename">Umbenennen</button><button type="button" class="danger" data-act="delete">Löschen</button>';
      row.appendChild(menu);
      openRowMenu = menu;
      menu.addEventListener("click", function (e2) {
        e2.stopPropagation();
        var act = e2.target.closest("[data-act]");
        if (!act) return;
        if (act.dataset.act === "rename") renameChat(id, row);
        else if (act.dataset.act === "delete") deleteChat(id);
      });
      return;
    }
    if (e.target.closest(".nx-sidebar-row-title input")) return;
    switchToChat(id);
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".nx-row-menu") && !e.target.closest("[data-more]")) {
      closeRowMenu();
      sidebarList.querySelectorAll(".is-open-menu").forEach(function (r) { r.classList.remove("is-open-menu"); });
    }
  });

  window.addEventListener("popstate", function () {
    var params = new URLSearchParams(location.search);
    var id = params.get("chat") ? Number(params.get("chat")) : null;
    if (id !== activeChatId) { if (id) switchToChat(id); else newChat(); }
  });

  // ---------------- send ----------------
  function streamInto(chatId, text) {
    return fetch("/api/ai/chats/" + chatId + "/stream", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }),
    }).then(function (res) {
      var ct = res.headers.get("content-type") || "";
      if (ct.indexOf("application/json") !== -1) {
        return res.json().then(function (j) { throw new Error(nice(j.error)); });
      }
      hideTyping();
      var bubble = addMsg("assistant", "");
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var full = "";
      function pump() {
        return reader.read().then(function (result) {
          if (result.done) return;
          full += decoder.decode(result.value, { stream: true });
          bubble.textContent = full;
          scrollDown();
          return pump();
        });
      }
      return pump();
    });
  }

  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    autoGrow();
    addMsg("user", text);
    busy = true;
    syncSend();
    showTyping();

    var ensureChat = activeChatId
      ? Promise.resolve(activeChatId)
      : fetch("/api/ai/chats", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) {
          chats.unshift(j.chat);
          setActive(j.chat.id);
          renderSidebar();
          return j.chat.id;
        });

    ensureChat
      .then(function (chatId) {
        var isNewTitle = !(chats.find(function (c) { return c.id === chatId; }) || {}).title
          || (chats.find(function (c) { return c.id === chatId; }) || {}).title === "Neuer Chat";
        return streamInto(chatId, text).then(function () {
          if (isNewTitle) {
            var c = chats.find(function (c) { return c.id === chatId; });
            if (c) { c.title = text.slice(0, 40); renderSidebar(); }
          }
        });
      })
      .then(function () {
        busy = false;
        syncSend();
        if (window.plSound) window.plSound.play("receive");
      })
      .catch(function (err) {
        hideTyping();
        busy = false;
        syncSend();
        addMsg("assistant", (err && err.message) || "Verbindungsfehler.");
      });
  }

  sendBtn.addEventListener("click", send);
})();
