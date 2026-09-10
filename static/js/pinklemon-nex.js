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

  // opening greeting, localised to the browser language
  var GREET = {
    en: ["Hello, I'm Nex", "Your personal friend — ask me anything, I know everything!"],
    de: ["Hallo, ich bin Nex", "Dein persönlicher Freund — frag mich alles, ich weiß alles!"],
    es: ["Hola, soy Nex", "Tu amigo personal: pregúntame lo que quieras, ¡lo sé todo!"],
    fr: ["Salut, je suis Nex", "Ton ami perso — demande-moi n'importe quoi, je sais tout !"],
    it: ["Ciao, sono Nex", "Il tuo amico personale: chiedimi qualsiasi cosa, so tutto!"],
    pt: ["Olá, eu sou o Nex", "Teu amigo pessoal — pergunta o que quiseres, eu sei tudo!"],
    nl: ["Hoi, ik ben Nex", "Je persoonlijke vriend — vraag me alles, ik weet alles!"],
    pl: ["Cześć, jestem Nex", "Twój osobisty przyjaciel — pytaj o wszystko, wiem wszystko!"],
    tr: ["Merhaba, ben Nex", "Kişisel arkadaşın — ne istersen sor, her şeyi bilirim!"],
    ru: ["Привет, я Nex", "Твой личный друг — спрашивай что угодно, я знаю всё!"],
    ar: ["مرحبا، أنا Nex", "صديقك الشخصي — اسألني أي شيء، أعرف كل شيء!"]
  };
  function greeting() {
    var lang = (navigator.language || "en").slice(0, 2).toLowerCase();
    return GREET[lang] || GREET.en;
  }
  (function applyGreeting() {
    if (!emptyEl) return;
    var g = greeting();
    var h = emptyEl.querySelector("h2"), p = emptyEl.querySelector("p");
    if (h) h.textContent = g[0];
    if (p) p.textContent = g[1];
  })();

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(u) ? u.replace(/"/g, "%22") : "";
  }

  // very small markdown: fenced code, inline code, **bold**, line breaks,
  // plus generated media: ![alt](url), !audio[label](url), !video[label](url)
  function render(text) {
    var parts = String(text).split(/```/);
    var html = "";
    for (var i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        var body = parts[i].replace(/^[a-zA-Z0-9_-]*\n/, "");
        html += "<pre>" + esc(body.replace(/\n$/, "")) + "</pre>";
      } else {
        var media = [];
        function stash(tag) { media.push(tag); return "" + (media.length - 1) + ""; }
        var seg = parts[i]
          .replace(/!video\[[^\]]*\]\(([^)]+)\)/g, function (_m, u) {
            u = safeUrl(u.trim()); if (!u) return "";
            return stash('<video class="nx-media" src="' + u + '" controls playsinline preload="metadata"></video>');
          })
          .replace(/!audio\[[^\]]*\]\(([^)]+)\)/g, function (_m, u) {
            u = safeUrl(u.trim()); if (!u) return "";
            return stash('<audio class="nx-media" src="' + u + '" controls preload="metadata"></audio>');
          })
          .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_m, alt, u) {
            u = safeUrl(u.trim()); if (!u) return "";
            return stash('<img class="nx-media" src="' + u + '" alt="' + esc(alt) + '" loading="lazy">');
          });
        seg = esc(seg)
          .replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
          .replace(/\n/g, "<br>")
          .replace(/(\d+)/g, function (_m, n) { return media[Number(n)] || ""; });
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
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  }
  function syncSend() {
    sendBtn.disabled = busy || !input.value.trim();
  }
  input.addEventListener("input", function () { autoGrow(); syncSend(); });
  syncSend();

  function setBusy(v) {
    busy = v;
    syncSend();
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
        if (window.plSound) window.plSound.play("receive");
      })
      .catch(function () { hideTyping(); setBusy(false); addMsg("assistant", "Verbindungsfehler."); });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });

  var EMPTY_MARK = '<span class="nx-empty-mark"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="20" fill="#2f2f2f"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M50 19 L78.6 35.5 L78.6 68.5 L50 85 L21.4 68.5 L21.4 35.5 Z"/><path d="M50 52 L50 19 M50 52 L78.6 35.5 M50 52 L78.6 68.5 M50 52 L50 85 M50 52 L21.4 68.5 M50 52 L21.4 35.5"/></g><g fill="#2f2f2f" stroke="#fff" stroke-width="3"><circle cx="50" cy="19" r="7.5"/><circle cx="78.6" cy="35.5" r="7.5"/><circle cx="78.6" cy="68.5" r="7.5"/><circle cx="50" cy="85" r="7.5"/><circle cx="21.4" cy="68.5" r="7.5"/><circle cx="21.4" cy="35.5" r="7.5"/></g><circle cx="50" cy="52" r="4.6" fill="#fff"/></svg></span>';

  newBtn.addEventListener("click", function () {
    chatId = null;
    msgsEl.innerHTML = "";
    emptyEl = document.createElement("div");
    emptyEl.className = "nx-empty";
    var g = greeting();
    emptyEl.innerHTML = EMPTY_MARK + '<h2>' + esc(g[0]) + '</h2><p>' + esc(g[1]) + '</p>';
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
