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

  // marked doesn't sanitize its output (raw HTML in the source passes
  // through unchanged by design -- see its own README), so a prompt that
  // somehow gets Nex to echo back a <script>/onerror-bearing tag would
  // otherwise execute. DOMPurify strips anything but plain markup before
  // it ever reaches innerHTML.
  function renderMarkdown(text) {
    var html = window.marked ? window.marked.parse(text, { breaks: true, gfm: true }) : esc(text);
    return window.DOMPurify ? window.DOMPurify.sanitize(html) : esc(text);
  }

  function addCopyButtons(container) {
    container.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".nx-copybtn")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nx-copybtn";
      btn.textContent = "Kopieren";
      pre.appendChild(btn);
    });
  }

  // The initial page load renders messages as plain escaped text
  // server-side (fast first paint, no client round-trip) -- upgrade them
  // to rendered markdown once marked/DOMPurify are available.
  msgsEl.querySelectorAll(".nx-bubble").forEach(function (b) {
    var text = b.textContent;
    b.innerHTML = renderMarkdown(text);
    addCopyButtons(b);
  });

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  msgsEl.addEventListener("click", function (e) {
    var btn = e.target.closest(".nx-copybtn");
    if (!btn) return;
    var code = btn.parentElement.querySelector("code");
    var text = code ? code.textContent : "";
    var flash = function (ok) {
      var orig = btn.textContent;
      btn.textContent = ok ? "Kopiert!" : "Ging nicht";
      btn.classList.toggle("copied", ok);
      setTimeout(function () { btn.textContent = orig; btn.classList.remove("copied"); }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { flash(true); }, function () { flash(legacyCopy(text)); });
    } else {
      flash(legacyCopy(text));
    }
  });

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
    b.innerHTML = renderMarkdown(text);
    addCopyButtons(b);
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
    if (err === "rate_limited") return "Kurz durchatmen -- gleich wieder.";
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
          if (result.done) { addCopyButtons(bubble); return; }
          full += decoder.decode(result.value, { stream: true });
          bubble.innerHTML = renderMarkdown(full);
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

  // ---------------- account corner: theme / avatar / logout ----------------
  var accountBtn = document.getElementById("nxAccountBtn");
  if (accountBtn) {
    var accountMenu = document.getElementById("nxAccountMenu");
    var themeToggle = document.getElementById("nxThemeToggle");
    var themeLabel = document.getElementById("nxThemeToggleLabel");
    var avatarChangeBtn = document.getElementById("nxAvatarChangeBtn");
    var avatarFile = document.getElementById("nxAvatarFile");
    var logoutBtn = document.getElementById("nxLogoutBtn");

    function isLight() { return document.documentElement.getAttribute("data-theme") === "light"; }
    function syncThemeLabel() { themeLabel.textContent = isLight() ? "Dunkles Design" : "Helles Design"; }
    syncThemeLabel();

    function closeAccountMenu() { accountMenu.hidden = true; }
    accountBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      accountMenu.hidden = !accountMenu.hidden;
    });
    document.addEventListener("click", function (e) {
      if (!accountMenu.hidden && !e.target.closest(".nx-me")) closeAccountMenu();
    });

    themeToggle.addEventListener("click", function () {
      var next = isLight() ? "dark" : "light";
      if (next === "light") document.documentElement.setAttribute("data-theme", "light");
      else document.documentElement.removeAttribute("data-theme");
      try { localStorage.setItem("pl_theme", next); } catch (e) {}
      syncThemeLabel();
    });

    avatarChangeBtn.addEventListener("click", function () {
      closeAccountMenu();
      avatarFile.click();
    });
    avatarFile.addEventListener("change", function () {
      var f = avatarFile.files[0];
      avatarFile.value = "";
      if (!f || !window.PlCropper) return;
      window.PlCropper.open(f, { aspect: 1, shape: "circle", title: "Profilbild zuschneiden" }).then(function (blob) {
        if (!blob) return;
        var fd = new FormData();
        fd.append("avatar", blob, "avatar.jpg");
        fetch("/api/pl/profile", { method: "POST", body: fd })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (!j.ok) { window.plToast && window.plToast("Ging nicht."); return; }
            accountBtn.innerHTML = '<img src="' + j.avatar_url + '" alt="">';
          })
          .catch(function () { window.plToast && window.plToast("Ging nicht."); });
      });
    });

    logoutBtn.addEventListener("click", function () { location.href = "/logout"; });
  }
})();
