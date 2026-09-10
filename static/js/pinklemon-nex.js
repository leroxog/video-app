(function () {
  "use strict";

  var NEX = window.NEX || { projectType: "nexblunt", character: "nex7" };
  var msgsEl = document.getElementById("nxMsgs");
  var emptyEl = document.getElementById("nxEmpty");
  var input = document.getElementById("nxInput");
  var sendBtn = document.getElementById("nxSend");
  var newBtn = document.getElementById("nxNew");

  var chatId = null;
  var busy = false;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // very small markdown: fenced code, inline code, **bold**, line breaks
  function render(text) {
    var parts = String(text).split(/```/);
    var html = "";
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var body = parts[i].replace(/^[a-zA-Z0-9_-]*\n/, "");
        html += "<pre>" + esc(body.replace(/\n$/, "")) + "</pre>";
      } else {
        var seg = esc(parts[i])
          .replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
          .replace(/\n/g, "<br>");
        html += seg;
      }
    }
    return html;
  }

  function clearEmpty() { if (emptyEl) { emptyEl.remove(); emptyEl = null; } }

  function addMsg(role, text) {
    clearEmpty();
    var row = document.createElement("div");
    row.className = "nx-row " + (role === "user" ? "me" : "them");
    var b = document.createElement("div");
    b.className = "nx-bubble";
    b.innerHTML = role === "user" ? esc(text).replace(/\n/g, "<br>") : render(text);
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

  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function autoGrow() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }
  input.addEventListener("input", autoGrow);

  function setBusy(v) {
    busy = v;
    sendBtn.disabled = v;
  }

  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    autoGrow();
    addMsg("user", text);
    setBusy(true);
    showTyping();

    var body = { message: text, character: NEX.character, project_type: NEX.projectType };
    if (chatId) body.chat_id = chatId;
    fetch("/api/ai/chat", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { hideTyping(); setBusy(false); addMsg("assistant", nice(j.error)); return; }
        chatId = j.chat_id;
        poll(j.job_id);
      })
      .catch(function () { hideTyping(); setBusy(false); addMsg("assistant", "Verbindung ist gerade weg. Nochmal?"); });
  }

  function nice(err) {
    if (err === "insufficient_tokens") return "Dir sind die KI-Token ausgegangen. Morgen gibt's neue.";
    if (err === "rate") return "Kurz durchatmen – gleich wieder.";
    return "Das hat gerade nicht geklappt. Nochmal versuchen?";
  }

  function poll(jobId) {
    fetch("/api/ai/chat/" + jobId)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j.status === "running") { setTimeout(function () { poll(jobId); }, 650); return; }
        hideTyping();
        setBusy(false);
        if (j.status === "done" && j.reply) addMsg("assistant", j.reply);
        else addMsg("assistant", "Ich bin gerade nicht erreichbar. Versuch's gleich nochmal.");
      })
      .catch(function () { hideTyping(); setBusy(false); addMsg("assistant", "Verbindungsfehler."); });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  newBtn.addEventListener("click", function () {
    chatId = null;
    msgsEl.innerHTML = "";
    emptyEl = document.createElement("div");
    emptyEl.className = "nx-empty";
    emptyEl.innerHTML = '<div class="nx-empty-orb"></div><h2>Neuer Chat</h2><p>Worüber willst du reden?</p>';
    msgsEl.appendChild(emptyEl);
    input.focus();
  });

  // load the most recent Nex chat, if any
  fetch("/api/ai/chats?character=" + encodeURIComponent(NEX.character))
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j.ok || !j.chats || !j.chats.length) return;
      var c = j.chats[0];
      return fetch("/api/ai/chats/" + c.id + "/messages")
        .then(function (r) { return r.json(); })
        .then(function (m) {
          if (!m.ok || !m.messages.length) return;
          chatId = c.id;
          msgsEl.innerHTML = "";
          emptyEl = null;
          m.messages.forEach(function (msg) { addMsg(msg.role === "user" ? "user" : "assistant", msg.content); });
          scrollDown();
        });
    })
    .catch(function () {});

  setTimeout(function () { input.focus(); }, 200);
})();
