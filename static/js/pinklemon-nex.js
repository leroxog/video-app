(function () {
  "use strict";

  var msgsEl = document.getElementById("nxMsgs");
  var emptyEl = document.getElementById("nxEmpty");
  var input = document.getElementById("nxInput");
  var sendBtn = document.getElementById("nxSend");
  var busy = false;

  function clearEmpty() { if (emptyEl) { emptyEl.remove(); emptyEl = null; } }

  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

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
    return "Das hat gerade nicht geklappt. Nochmal versuchen?";
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

    fetch("/api/ai/chats/" + window.NEX_CHAT_ID + "/stream", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }),
    })
      .then(function (res) {
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
        return pump().then(function () {
          busy = false;
          syncSend();
          if (window.plSound) window.plSound.play("receive");
        });
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
