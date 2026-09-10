(function () {
  "use strict";
  var CHAT = window.PL_CHAT;
  var msgsEl = document.getElementById("plMsgs");
  var emptyEl = document.getElementById("plChatEmpty");
  var input = document.getElementById("plMsgInput");
  var sendBtn = document.getElementById("plMsgSend");
  var lastId = 0;
  var polling = null;
  var A = window.PlAttach || { mount: function () { return { get: function () { return {}; }, clear: function () {}, raw: function () { return null; } }; }, html: function () { return ""; } };
  var msgAtt = A.mount(document.getElementById("plMsgAtt"));

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function updateEmpty() {
    if (!emptyEl) return;
    emptyEl.hidden = msgsEl.querySelector(".pl-msg") !== null;
  }

  function atBottom() { return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60; }
  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function addMsg(m) {
    var div = document.createElement("div");
    div.className = "pl-msg " + (m.is_mine ? "me" : "them");
    var html = "";
    if (CHAT.isGroup && !m.is_mine) html += '<div class="pl-msg-sender">@' + esc(m.sender) + "</div>";
    if (m.text) html += esc(m.text).replace(/\n/g, "<br>");
    if (m.attachment) html += A.html(m.attachment);
    html += '<div class="pl-msg-time">' + esc(m.created_ago) + "</div>";
    div.innerHTML = html;
    msgsEl.appendChild(div);
    lastId = Math.max(lastId, m.id);
    updateEmpty();
  }

  function poll() {
    fetch("/api/pl/chats/" + CHAT.id + "/messages?after=" + lastId)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) return;
        if (j.messages.length) {
          var stick = atBottom();
          var fromOther = j.messages.some(function (m) { return !m.is_mine; });
          j.messages.forEach(addMsg);
          if (stick) scrollDown();
          if (fromOther && window.plSound) window.plSound.play("receive");
        }
      })
      .catch(function () {});
  }

  function send() {
    var text = input.value.trim();
    var a = msgAtt.get();
    if (!text && !a.att_kind) return;
    var payload = { text: text };
    for (var k in a) payload[k] = a[k];
    input.value = "";
    input.style.height = "auto";
    msgAtt.clear();
    fetch("/api/pl/chats/" + CHAT.id + "/messages", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) { window.plToast(j.error === "not_mutual" ? "Ihr folgt euch nicht mehr gegenseitig." : "Ging nicht."); return; }
      addMsg(j.message);
      scrollDown();
    });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });

  // first load
  fetch("/api/pl/chats/" + CHAT.id + "/messages?after=0")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j.ok) { j.messages.forEach(addMsg); scrollDown(); }
      updateEmpty();
      polling = setInterval(poll, 3000);
    })
    .catch(function () { updateEmpty(); polling = setInterval(poll, 3000); });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { clearInterval(polling); }
    else { poll(); polling = setInterval(poll, 3000); }
  });
})();
