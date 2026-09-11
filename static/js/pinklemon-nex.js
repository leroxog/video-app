(function () {
  "use strict";

  var NEX = window.NEX || { projectType: "nexblunt", character: "nex7", name: "Nex" };
  if (!NEX.name) NEX.name = "Nex";
  var msgsEl = document.getElementById("nxMsgs");
  var emptyEl = document.getElementById("nxEmpty");
  var input = document.getElementById("nxInput");
  var sendBtn = document.getElementById("nxSend");
  var callBtn = document.getElementById("nxCallBtn");
  var newBtn = document.getElementById("nxNew");
  var histBtn = document.getElementById("nxHistBtn");
  var histMenu = document.getElementById("nxHistMenu");
  var histList = document.getElementById("nxHistList");
  var slashMenu = document.getElementById("nxSlashMenu");

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
    var g = GREET[lang] || GREET.en;
    if (NEX.name === "Nex") return g;
    // every GREET entry spells the name as the literal Latin token "Nex",
    // even the non-Latin-script ones -- swap it for a custom /name.
    return [g[0].replace(/Nex/g, NEX.name), g[1]];
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
    var hasText = !!input.value.trim();
    sendBtn.disabled = busy || !hasText;
    // Empty composer: swap the send arrow for a phone icon (call Nex)
    // instead of showing a disabled arrow that does nothing.
    sendBtn.hidden = !hasText;
    if (callBtn) callBtn.hidden = hasText;
  }
  input.addEventListener("input", function () { autoGrow(); syncSend(); renderSlashMenu(); });
  syncSend();

  function setBusy(v) {
    busy = v;
    syncSend();
  }

  // ---------------- /name, /personality, /act slash commands ----------------
  var SLASH_COMMANDS = [
    { cmd: "/name", desc: "Nennt sich ab jetzt so, z.B. „Tom“" },
    { cmd: "/personality", desc: "Komplett eigene Persönlichkeit festlegen" },
    { cmd: "/act", desc: "Tut für diesen Chat so, als ob …" },
    { cmd: "/reset", desc: "Name, Persönlichkeit & Rolle zurücksetzen" },
  ];
  var CMD_RE = /^\/(name|personality|act|reset)\b[ \t]*([\s\S]*)$/i;

  function renderSlashMenu() {
    var v = input.value;
    if (!/^\/[a-zA-Z]*$/.test(v)) { slashMenu.hidden = true; return; }
    var matches = SLASH_COMMANDS.filter(function (c) { return c.cmd.indexOf(v.toLowerCase()) === 0; });
    if (!matches.length) { slashMenu.hidden = true; return; }
    slashMenu.innerHTML = matches.map(function (c, i) {
      return '<button type="button" class="nx-slash-row' + (i === 0 ? " is-active" : "") + '" data-cmd="' + c.cmd + '">'
        + '<span class="nx-slash-cmd">' + c.cmd + '</span><span class="nx-slash-desc">' + esc(c.desc) + '</span></button>';
    }).join("");
    slashMenu.hidden = false;
  }
  function pickSlashCmd(cmd) {
    input.value = cmd + (cmd === "/reset" ? "" : " ");
    slashMenu.hidden = true;
    autoGrow(); syncSend();
    input.focus();
  }
  slashMenu.addEventListener("click", function (e) {
    var row = e.target.closest("[data-cmd]");
    if (row) pickSlashCmd(row.dataset.cmd);
  });
  document.addEventListener("click", function (e) {
    if (!slashMenu.hidden && !e.target.closest(".nx-compose")) slashMenu.hidden = true;
  });

  function setNexName(name) {
    NEX.name = name || "Nex";
    document.querySelectorAll(".nx-top-name").forEach(function (el) { el.textContent = NEX.name; });
    document.title = NEX.name + " · HEXAGONUM";
    input.placeholder = "Nachricht an " + NEX.name + " · / für Befehle";
    var disc = document.getElementById("nxDisclaimer");
    if (disc) disc.textContent = NEX.name + " kann Fehler machen. Wichtiges überprüfen.";
    if (emptyEl) { var g = greeting(); var h = emptyEl.querySelector("h2"); if (h) h.textContent = g[0]; }
  }

  function addSysMsg(text) {
    var b = addMsg("assistant", "");
    b.className = "nx-bubble nx-sysmsg";
    b.textContent = text;
  }

  function runSlashCommand(kind, arg) {
    addMsg("user", "/" + kind + (arg ? " " + arg : ""));
    var payload = kind === "reset" ? { reset_all: true } : (function () {
      var p = {}; p[kind] = arg; return p;
    })();
    fetch("/api/pl/nex/settings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { addSysMsg("Ging gerade nicht. Nochmal versuchen?"); return; }
        if (kind === "name") setNexName(j.name);
        if (kind === "reset") setNexName(j.name);
        if (kind === "name") addSysMsg(arg ? "Ok, ich heiße jetzt „" + j.name + "“." : "Name zurückgesetzt auf Nex.");
        else if (kind === "personality") addSysMsg(arg ? "Persönlichkeit gespeichert." : "Persönlichkeit zurückgesetzt.");
        else if (kind === "act") addSysMsg(arg ? "Ok, ich bin jetzt in der Rolle." : "Rolle beendet.");
        else if (kind === "reset") addSysMsg("Alles zurückgesetzt.");
        if (window.plSound) window.plSound.play("receive");
      })
      .catch(function () { addSysMsg("Verbindungsfehler."); });
  }

  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    var m = text.match(CMD_RE);
    if (m) {
      input.value = ""; autoGrow(); syncSend(); slashMenu.hidden = true;
      runSlashCommand(m[1].toLowerCase(), m[2].trim());
      return;
    }
    input.value = "";
    autoGrow();
    slashMenu.hidden = true;
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

  // ---------------- call Nex: push-to-talk voice conversation ----------------
  // Uses the existing /api/pl/nex/voice (server-side Whisper transcription,
  // works on iOS Safari unlike webkitSpeechRecognition) for listening, and
  // /api/voice-profile/<gender>/speak (falling back to the browser's own
  // speechSynthesis on any failure) for Nex's spoken replies -- the same
  // two building blocks the older assistant's voice orb (see base.html)
  // already relies on, just driven from this chat instead.
  var callOverlay = document.getElementById("nxCallOverlay");
  var callStatusEl = document.getElementById("nxCallStatus");
  var callTranscriptEl = document.getElementById("nxCallTranscript");
  var callOrbWrap = document.getElementById("nxCallOrbWrap");
  var callHangupBtn = document.getElementById("nxCallHangup");

  var callActive = false;
  var callRecorder = null;
  var callStream = null;
  var callAudioEl = null;

  function setCallStatus(text) { if (callStatusEl) callStatusEl.textContent = text; }
  function setOrbMode(mode) {
    if (!callOrbWrap) return;
    callOrbWrap.classList.remove("listening", "thinking", "speaking");
    if (mode) callOrbWrap.classList.add(mode);
  }
  function addCallLine(role, text) {
    if (callTranscriptEl) {
      var line = document.createElement("div");
      line.className = "nx-call-line " + (role === "user" ? "user" : "bot");
      line.textContent = text;
      callTranscriptEl.appendChild(line);
      callTranscriptEl.scrollTop = callTranscriptEl.scrollHeight;
    }
    // Keep the normal chat view in sync too, so the call shows up as a
    // real part of the conversation once you hang up, not a side channel.
    addMsg(role, text);
  }

  function stopCallStream() {
    if (callStream) { callStream.getTracks().forEach(function (t) { t.stop(); }); callStream = null; }
    callRecorder = null;
  }

  function stopCallAudio() {
    if (callAudioEl) { try { callAudioEl.pause(); } catch (e) {} callAudioEl = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function stripForSpeech(text) {
    return String(text)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/!(?:audio|video)\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\n+/g, " ")
      .trim();
  }

  function startCallRecording() {
    if (!callActive) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      setCallStatus("Dein Browser unterstützt leider keine Sprachaufnahme.");
      return;
    }
    setOrbMode("listening");
    setCallStatus("Ich höre zu … tipp auf den Kreis, wenn du fertig bist.");
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!callActive) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      callStream = stream;
      var chunks = [];
      var mime = (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported("audio/webm"))
        ? "audio/webm" : "";
      callRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      callRecorder.addEventListener("dataavailable", function (e) { if (e.data && e.data.size) chunks.push(e.data); });
      callRecorder.addEventListener("stop", function () {
        stopCallStream();
        if (!callActive) return;
        var blob = new Blob(chunks, { type: mime || "audio/webm" });
        handleRecordedAudio(blob);
      });
      callRecorder.start();
    }).catch(function () {
      setCallStatus("Kein Zugriff aufs Mikrofon – bitte im Browser erlauben.");
    });
  }

  function stopCallRecording() {
    if (callRecorder && callRecorder.state !== "inactive") {
      try { callRecorder.stop(); } catch (e) {}
    }
  }

  function handleRecordedAudio(blob) {
    setOrbMode("thinking");
    setCallStatus("Einen Moment …");
    var fd = new FormData();
    fd.append("audio", blob, "speech.webm");
    fetch("/api/pl/nex/voice", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!callActive) return;
        var text = (j.ok && j.transcript || "").trim();
        if (!text) { startCallRecording(); return; }
        addCallLine("user", text);
        sendCallMessage(text);
      })
      .catch(function () {
        if (!callActive) return;
        setCallStatus("Kurze Störung – ich höre trotzdem weiter zu.");
        startCallRecording();
      });
  }

  function sendCallMessage(text) {
    setOrbMode("thinking");
    setCallStatus(NEX.name + " denkt nach …");
    var body = { message: text, character: NEX.character, project_type: NEX.projectType, via_voice: true };
    if (chatId) body.chat_id = chatId;
    fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!callActive) return;
        if (!j.ok) {
          setCallStatus(j.error === "insufficient_tokens" ? "Keine KI-Token mehr übrig." : "Kurze Störung – ich höre trotzdem weiter zu.");
          if (j.error !== "insufficient_tokens") startCallRecording();
          return;
        }
        chatId = j.chat_id;
        pollCallJob(j.job_id, 20);
      })
      .catch(function () {
        if (!callActive) return;
        setCallStatus("Kurze Störung – ich höre trotzdem weiter zu.");
        startCallRecording();
      });
  }

  function pollCallJob(jobId, retriesLeft) {
    if (!callActive) return;
    fetch("/api/ai/chat/" + jobId)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!callActive) return;
        if (j.status === "running") { setTimeout(function () { pollCallJob(jobId, retriesLeft); }, 700); return; }
        if (j.status === "done" && j.reply) {
          addCallLine("bot", j.reply);
          speakCallReply(j.reply);
          if (window.plSound) window.plSound.play("receive");
          return;
        }
        if (retriesLeft > 0) { setTimeout(function () { pollCallJob(jobId, retriesLeft - 1); }, 1200); return; }
        setCallStatus("Kurze Störung – ich höre trotzdem weiter zu.");
        startCallRecording();
      })
      .catch(function () {
        if (!callActive) return;
        if (retriesLeft > 0) { setTimeout(function () { pollCallJob(jobId, retriesLeft - 1); }, 1200); return; }
        setCallStatus("Kurze Störung – ich höre trotzdem weiter zu.");
        startCallRecording();
      });
  }

  function speakCallReply(text) {
    setOrbMode("speaking");
    setCallStatus(NEX.name + " spricht …");
    var spoken = stripForSpeech(text) || text;
    fetch("/api/voice-profile/male/speak", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: spoken }),
    })
      .then(function (r) { if (!r.ok) throw new Error("no cloned voice"); return r.blob(); })
      .then(function (blob) {
        if (!callActive) return;
        var audioEl = new Audio(URL.createObjectURL(blob));
        callAudioEl = audioEl;
        audioEl.addEventListener("ended", function () {
          if (callAudioEl === audioEl) callAudioEl = null;
          if (callActive) startCallRecording();
        });
        audioEl.play().catch(function () { if (callActive) startCallRecording(); });
      })
      .catch(function () { speakCallReplyWithBrowser(spoken); });
  }

  function speakCallReplyWithBrowser(text) {
    if (!callActive) return;
    if (!window.speechSynthesis) { startCallRecording(); return; }
    window.speechSynthesis.cancel();
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = "de-DE";
    utter.rate = 1.05;
    utter.onend = function () { if (callActive) startCallRecording(); };
    window.speechSynthesis.speak(utter);
  }

  function openCall() {
    callActive = true;
    if (callTranscriptEl) callTranscriptEl.innerHTML = "";
    callOverlay.hidden = false;
    setOrbMode(null);
    setCallStatus("Verbinde …");
    startCallRecording();
  }

  function closeCall() {
    callActive = false;
    stopCallRecording();
    stopCallStream();
    stopCallAudio();
    callOverlay.hidden = true;
  }

  function callOrbTap() {
    if (callAudioEl || (window.speechSynthesis && window.speechSynthesis.speaking)) {
      // Interrupt Nex mid-reply, like cutting in on a real call.
      stopCallAudio();
      startCallRecording();
      return;
    }
    if (callRecorder && callRecorder.state === "recording") { stopCallRecording(); return; }
    startCallRecording();
  }

  if (callBtn) callBtn.addEventListener("click", openCall);
  if (callHangupBtn) callHangupBtn.addEventListener("click", closeCall);
  if (callOrbWrap) {
    callOrbWrap.addEventListener("click", callOrbTap);
    callOrbWrap.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); callOrbTap(); }
    });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !slashMenu.hidden) { slashMenu.hidden = true; return; }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!slashMenu.hidden) {
        var active = slashMenu.querySelector(".nx-slash-row");
        if (active) { pickSlashCmd(active.dataset.cmd); return; }
      }
      send();
    }
  });

  var EMPTY_MARK = '<span class="nx-empty-mark"><svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" rx="20" fill="#2f2f2f"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M50 19 L78.6 35.5 L78.6 68.5 L50 85 L21.4 68.5 L21.4 35.5 Z"/><path d="M50 52 L50 19 M50 52 L78.6 35.5 M50 52 L78.6 68.5 M50 52 L50 85 M50 52 L21.4 68.5 M50 52 L21.4 35.5"/></g><g fill="#2f2f2f" stroke="#fff" stroke-width="3"><circle cx="50" cy="19" r="7.5"/><circle cx="78.6" cy="35.5" r="7.5"/><circle cx="78.6" cy="68.5" r="7.5"/><circle cx="50" cy="85" r="7.5"/><circle cx="21.4" cy="68.5" r="7.5"/><circle cx="21.4" cy="35.5" r="7.5"/></g><circle cx="50" cy="52" r="4.6" fill="#fff"/></svg></span>';

  function showEmpty() {
    msgsEl.innerHTML = "";
    emptyEl = document.createElement("div");
    emptyEl.className = "nx-empty";
    var g = greeting();
    emptyEl.innerHTML = EMPTY_MARK + '<h2>' + esc(g[0]) + '</h2><p>' + esc(g[1]) + '</p>';
    msgsEl.appendChild(emptyEl);
  }

  newBtn.addEventListener("click", function () {
    chatId = null;
    showEmpty();
    input.focus();
  });

  // ---------------- chat history: switch between past Nex chats ----------------
  function loadChat(id) {
    return fetch("/api/ai/chats/" + id + "/messages")
      .then(function (r) { return r.json(); })
      .then(function (m) {
        if (!m.ok) return;
        chatId = id;
        if (!m.messages.length) { showEmpty(); return; }
        msgsEl.innerHTML = "";
        emptyEl = null;
        m.messages.forEach(function (msg) { addMsg(msg.role === "user" ? "user" : "assistant", msg.content); });
        scrollDown();
      });
  }

  function fetchChats() {
    return fetch("/api/ai/chats?character=" + encodeURIComponent(NEX.character))
      .then(function (r) { return r.json(); })
      .then(function (j) { return (j.ok && j.chats) || []; })
      .catch(function () { return []; });
  }

  function renderHistList(chats) {
    if (!chats.length) {
      histList.innerHTML = '<div class="nx-hist-empty">Noch keine Chats.</div>';
      return;
    }
    histList.innerHTML = chats.map(function (c) {
      return '<div class="nx-hist-row' + (c.id === chatId ? " is-active" : "") + '" data-chat-id="' + c.id + '">'
        + '<div class="nx-hist-row-main"><div class="nx-hist-row-title">' + esc(c.title) + '</div>'
        + '<div class="nx-hist-row-time">' + esc(c.updated_at) + '</div></div>'
        + '<button type="button" class="nx-hist-del" data-del-chat="' + c.id + '" aria-label="L&ouml;schen">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6"/></svg>'
        + '</button></div>';
    }).join("");
  }

  function openHistMenu() {
    histMenu.hidden = false;
    histList.innerHTML = '<div class="nx-hist-empty">L&auml;dt &hellip;</div>';
    fetchChats().then(renderHistList);
  }
  function closeHistMenu() { histMenu.hidden = true; }

  histBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    if (histMenu.hidden) openHistMenu(); else closeHistMenu();
  });
  document.addEventListener("click", function (e) {
    if (!histMenu.hidden && !e.target.closest(".nx-hist-wrap")) closeHistMenu();
  });
  histList.addEventListener("click", function (e) {
    var del = e.target.closest("[data-del-chat]");
    if (del) {
      e.stopPropagation();
      var id = Number(del.dataset.delChat);
      fetch("/api/ai/chats/" + id + "/delete", { method: "POST" }).then(function () {
        if (id === chatId) { chatId = null; showEmpty(); }
        fetchChats().then(renderHistList);
      });
      return;
    }
    var row = e.target.closest("[data-chat-id]");
    if (row) {
      loadChat(Number(row.dataset.chatId)).then(function () {
        closeHistMenu();
        input.focus();
      });
    }
  });

  // load the most recent Nex chat, if any
  fetchChats().then(function (chats) {
    if (!chats.length) return;
    return loadChat(chats[0].id);
  });

  setTimeout(function () { input.focus(); }, 200);
})();
