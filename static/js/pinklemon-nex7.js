(function () {
  "use strict";
  var msgsEl = document.getElementById("n7Msgs");
  var input = document.getElementById("n7Input");
  var sendBtn = document.getElementById("n7Send");
  var descEl = document.getElementById("n7Desc");
  var chips = Array.prototype.slice.call(document.querySelectorAll("#n7Chips .n7-chip"));
  var chatId = null;
  var busy = false;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function addMsg(text, who) {
    var d = document.createElement("div");
    d.className = "n7-msg " + who;
    d.innerHTML = esc(text).replace(/\n/g, "<br>");
    msgsEl.appendChild(d);
    scrollDown();
    return d;
  }

  function personaByKey(k) {
    for (var i = 0; i < window.N7.personas.length; i++) if (window.N7.personas[i].key === k) return window.N7.personas[i];
    return window.N7.personas[0];
  }
  function renderDesc() {
    var p = personaByKey(window.N7.persona);
    descEl.innerHTML = "<b>" + esc(p.name) + "</b> — " + esc(p.tag) + "<br>" + esc(p.desc);
  }
  renderDesc();

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      var key = chip.dataset.key;
      if (key === window.N7.persona) return;
      fetch("/api/pl/nex7/persona", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ persona: key }) })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) return;
          window.N7.persona = j.persona;
          window.N7.projectType = j.project_type;
          chips.forEach(function (c) { c.classList.toggle("active", c.dataset.key === j.persona); });
          renderDesc();
          window.plToast("Jetzt: " + personaByKey(j.persona).name);
        });
    });
  });

  // load latest nex7 chat + its messages
  fetch("/api/ai/chats?character=nex7").then(function (r) { return r.json(); }).then(function (j) {
    if (j.ok && j.chats.length) {
      chatId = j.chats[0].id;
      fetch("/api/ai/chats/" + chatId + "/messages").then(function (r) { return r.json(); }).then(function (m) {
        if (m.ok) { m.messages.forEach(function (x) { addMsg(x.content, x.role === "user" ? "me" : "them"); }); }
      });
    } else {
      addMsg("Hey, ich bin deine Ai. Oben kannst du meine Persönlichkeit umstellen.", "them");
    }
  });

  function poll(jobId, thinkEl) {
    fetch("/api/ai/chat/" + jobId).then(function (r) { return r.json(); }).then(function (j) {
      if (j.status === "running") { setTimeout(function () { poll(jobId, thinkEl); }, 700); return; }
      thinkEl.remove();
      busy = false;
      if (j.status === "done" && j.reply) addMsg(j.reply, "them");
      else addMsg("Ich bin gerade nicht erreichbar. Versuch's gleich nochmal.", "them");
    }).catch(function () { thinkEl.remove(); busy = false; addMsg("Verbindungsfehler.", "them"); });
  }

  function send() {
    if (busy) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    addMsg(text, "me");
    busy = true;
    var thinkEl = addMsg("denkt nach …", "think");
    var body = { message: text, character: "nex7" };
    if (window.N7.projectType) body.project_type = window.N7.projectType;
    if (chatId) body.chat_id = chatId;
    fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { thinkEl.remove(); busy = false; addMsg("Ging nicht.", "them"); return; }
        chatId = j.chat_id;
        poll(j.job_id, thinkEl);
      })
      .catch(function () { thinkEl.remove(); busy = false; addMsg("Verbindungsfehler.", "them"); });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); send(); } });
})();
