(function () {
  "use strict";
  var CHAT = window.PL_CHAT;
  var msgsEl = document.getElementById("plMsgs");
  var emptyEl = document.getElementById("plChatEmpty");
  var input = document.getElementById("plMsgInput");
  var sendBtn = document.getElementById("plMsgSend");
  var typingEl = document.getElementById("plTyping");
  var pinsBtn = document.getElementById("plPinsBtn");
  var pinsCount = document.getElementById("plPinsCount");
  var pinsPanel = document.getElementById("plPinsPanel");
  var pinsList = document.getElementById("plPinsList");
  var emojiPicker = document.getElementById("plEmojiPicker");
  var replyPreview = document.getElementById("plReplyPreview");
  var replyPreviewName = document.getElementById("plReplyPreviewName");
  var replyPreviewText = document.getElementById("plReplyPreviewText");
  var replyPreviewClose = document.getElementById("plReplyPreviewClose");
  var lastId = 0;
  var polling = null;
  var typingPolling = null;
  var replyToId = null;
  var msgById = {};
  var A = window.PlAttach || { mount: function () { return { get: function () { return {}; }, clear: function () {}, raw: function () { return null; } }; }, html: function () { return ""; } };
  var msgAtt = A.mount(document.getElementById("plMsgAtt"));

  var REACTION_EMOJI = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👎"];
  // Discord-style message grouping: consecutive messages from the same
  // sender within this window collapse into one block (avatar/name shown
  // once), matching Discord's own ~7 minute threshold.
  var GROUP_WINDOW_MS = 7 * 60 * 1000;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function updateEmpty() {
    if (!emptyEl) return;
    emptyEl.hidden = msgsEl.querySelector(".pl-msgline") !== null;
  }

  function atBottom() { return msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60; }
  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  function closeAllActions() {
    msgsEl.querySelectorAll(".pl-msgline.actions-open").forEach(function (w) { w.classList.remove("actions-open"); });
  }

  function reactionsHTML(m) {
    if (!m.reactions || !m.reactions.length) return "";
    return '<div class="pl-msg-reactions">' + m.reactions.map(function (r) {
      return '<button type="button" class="pl-msg-reaction' + (r.me ? " mine" : "") + '" data-react-emoji="' + esc(r.emoji) + '">'
        + esc(r.emoji) + ' <b>' + r.count + '</b></button>';
    }).join("") + '</div>';
  }

  function replyQuoteHTML(m) {
    if (!m.reply_to) return "";
    if (m.reply_to.deleted) {
      return '<div class="pl-msg-reply-quote deleted" data-scroll-to="' + m.reply_to.id + '">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a4 4 0 0 1 4 4v6"/></svg>'
        + '<span>Ursprüngliche Nachricht gelöscht</span></div>';
    }
    return '<div class="pl-msg-reply-quote" data-scroll-to="' + m.reply_to.id + '">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a4 4 0 0 1 4 4v6"/></svg>'
      + '<b>' + esc(m.reply_to.sender_name) + '</b><span>' + esc(m.reply_to.text) + '</span></div>';
  }

  function actionsHTML(m) {
    var out = '<div class="pl-msg-actions">'
      + '<button type="button" data-act="react" aria-label="Reagieren"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/></svg></button>'
      + '<button type="button" data-act="reply" aria-label="Antworten"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a4 4 0 0 1 4 4v6"/></svg></button>'
      + '<button type="button" data-act="pin" aria-label="' + (m.pinned ? "Lösen" : "Anheften") + '"><svg viewBox="0 0 24 24" fill="' + (m.pinned ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z"/><path d="M12 17v4"/></svg></button>';
    if (m.is_mine) {
      out += '<button type="button" data-act="edit" aria-label="Bearbeiten"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>'
        + '<button type="button" class="pl-danger" data-act="delete" aria-label="Löschen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6"/></svg></button>';
    }
    return out + "</div>";
  }

  function avatarHTML(m) {
    return m.sender_avatar_url
      ? '<img src="' + esc(m.sender_avatar_url) + '" alt="">'
      : esc((m.sender_name || m.sender || "?")[0].toUpperCase());
  }

  function lineInnerHTML(m) {
    var html = '<span class="pl-msgline-hovertime">' + esc(m.created_ago) + '</span>';
    html += '<div class="pl-msgline-content">';
    html += replyQuoteHTML(m);
    if (m.text) html += (m.text_html || esc(m.text).replace(/\n/g, "<br>"));
    if (m.attachment) html += A.html(m.attachment);
    if (m.pinned || m.edited) {
      html += '<span class="pl-msgline-tags">';
      if (m.pinned) html += '<span class="pl-msg-pinned-tag"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z"/></svg></span>';
      if (m.edited) html += '<span class="pl-msg-edited">(bearbeitet)</span>';
      html += '</span>';
    }
    html += '</div>';
    html += reactionsHTML(m) + actionsHTML(m);
    return html;
  }

  function lineHTML(m) {
    return '<div class="pl-msgline" data-msg-id="' + m.id + '">' + lineInnerHTML(m) + '</div>';
  }

  function blockOpenHTML(m) {
    return '<span class="pl-avatar pl-msgblock-avatar" style="background:' + esc(m.sender_avatar_color) + '">' + avatarHTML(m) + '</span>'
      + '<div class="pl-msgblock-col">'
      + '<div class="pl-msgblock-headrow"><b class="pl-msgblock-name">' + esc(m.sender_name || m.sender) + '</b>'
      + '<span class="pl-msgblock-time">' + esc(m.created_ago) + '</span></div>';
  }

  function lastBlock() {
    var blocks = msgsEl.querySelectorAll(".pl-msgblock");
    return blocks.length ? blocks[blocks.length - 1] : null;
  }

  function blockMatches(block, m) {
    if (!block) return false;
    if (block.dataset.senderId !== String(m.sender_id)) return false;
    var lastTs = Number(block.dataset.lastTs || 0);
    var ts = new Date(m.created_at).getTime();
    return ts >= lastTs && (ts - lastTs) < GROUP_WINDOW_MS;
  }

  function addMsg(m) {
    msgById[m.id] = m;
    var ts = new Date(m.created_at).getTime();
    var block = lastBlock();
    if (blockMatches(block, m)) {
      block.querySelector(".pl-msgblock-col").insertAdjacentHTML("beforeend", lineHTML(m));
      block.dataset.lastTs = ts;
    } else {
      var wrap = document.createElement("div");
      wrap.className = "pl-msgblock" + (m.is_mine ? " mine" : "");
      wrap.dataset.senderId = m.sender_id;
      wrap.dataset.lastTs = ts;
      wrap.innerHTML = blockOpenHTML(m) + lineHTML(m) + "</div>";
      msgsEl.appendChild(wrap);
    }
    lastId = Math.max(lastId, m.id);
    updateEmpty();
  }

  function updateMsg(m) {
    msgById[m.id] = m;
    var line = msgsEl.querySelector('.pl-msgline[data-msg-id="' + m.id + '"]');
    if (line) line.innerHTML = lineInnerHTML(m);
  }

  function removeMsg(id) {
    delete msgById[id];
    var line = msgsEl.querySelector('.pl-msgline[data-msg-id="' + id + '"]');
    if (!line) return;
    var block = line.closest(".pl-msgblock");
    line.remove();
    if (block && !block.querySelector(".pl-msgline")) block.remove();
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

  function clearReply() {
    replyToId = null;
    replyPreview.hidden = true;
  }

  function setReply(id) {
    var m = msgById[id];
    if (!m) return;
    replyToId = id;
    replyPreviewName.textContent = m.is_mine ? "Dir" : (m.sender_name || m.sender);
    replyPreviewText.textContent = m.text || (m.attachment ? "Anhang" : "");
    replyPreview.hidden = false;
    input.focus();
  }
  replyPreviewClose.addEventListener("click", clearReply);

  function send() {
    var text = input.value.trim();
    var a = msgAtt.get();
    if (!text && !a.att_kind) return;
    var payload = { text: text };
    for (var k in a) payload[k] = a[k];
    if (replyToId) payload.reply_to_id = replyToId;
    input.value = "";
    input.style.height = "auto";
    msgAtt.clear();
    clearReply();
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

  // ---------------- typing indicator ----------------
  var lastTypingPing = 0;
  function pingTyping() {
    var now = Date.now();
    if (now - lastTypingPing < 2500) return;
    lastTypingPing = now;
    fetch("/api/pl/chats/" + CHAT.id + "/typing", { method: "POST" }).catch(function () {});
  }
  function pollTyping() {
    fetch("/api/pl/chats/" + CHAT.id + "/typing")
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) return;
        if (!j.typing.length) { typingEl.hidden = true; return; }
        var names = j.typing.slice(0, 3).join(", ");
        typingEl.textContent = names + (j.typing.length === 1 ? " tippt …" : " tippen …");
        typingEl.hidden = false;
      })
      .catch(function () {});
  }

  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
    if (input.value.trim()) pingTyping();
  });

  // ---------------- message actions: react / reply / pin / edit / delete ----------------
  function closeEmojiPicker() { emojiPicker.hidden = true; }

  function openEmojiPicker(anchorBtn, msgId) {
    emojiPicker.innerHTML = REACTION_EMOJI.map(function (e) {
      return '<button type="button" data-emoji="' + e + '">' + e + '</button>';
    }).join("");
    var r = anchorBtn.getBoundingClientRect();
    emojiPicker.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 260)) + "px";
    emojiPicker.style.top = Math.max(6, r.top - 44) + "px";
    emojiPicker.hidden = false;
    emojiPicker.dataset.msgId = msgId;
  }

  emojiPicker.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-emoji]");
    if (!btn) return;
    react(Number(emojiPicker.dataset.msgId), btn.dataset.emoji);
    closeEmojiPicker();
  });

  function react(msgId, emoji) {
    fetch("/api/pl/messages/" + msgId + "/react", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji: emoji }),
    }).then(function (r) { return r.json(); }).then(function (j) { if (j.ok) updateMsg(j.message); });
  }

  function togglePin(msgId) {
    fetch("/api/pl/messages/" + msgId + "/pin", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) { updateMsg(j.message); window.plToast(j.message.pinned ? "Angeheftet." : "Gelöst."); } });
  }

  function startEdit(line, m) {
    var content = line.querySelector(".pl-msgline-content");
    content.classList.add("pl-msg-editing");
    content.innerHTML = '<textarea class="pl-msg-edit-input" rows="2">' + esc(m.text) + '</textarea>'
      + '<div class="pl-msg-edit-actions"><button type="button" data-cancel>Abbrechen</button><button type="button" data-save>Speichern</button></div>';
    var ta = content.querySelector("textarea");
    ta.focus(); ta.selectionStart = ta.value.length;
    content.querySelector("[data-cancel]").addEventListener("click", function () { updateMsg(m); });
    content.querySelector("[data-save]").addEventListener("click", function () { saveEdit(m.id, ta.value.trim(), m); });
  }

  function saveEdit(msgId, text, original) {
    if (!text) return;
    fetch("/api/pl/messages/" + msgId, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) updateMsg(j.message); else updateMsg(original);
    });
  }

  function deleteMessage(msgId) {
    fetch("/api/pl/messages/" + msgId, { method: "DELETE" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j.ok) removeMsg(msgId); });
  }

  msgsEl.addEventListener("click", function (e) {
    var scrollTarget = e.target.closest("[data-scroll-to]");
    if (scrollTarget) {
      var target = msgsEl.querySelector('.pl-msgline[data-msg-id="' + scrollTarget.dataset.scrollTo + '"]');
      if (target) { target.scrollIntoView({ block: "center", behavior: "smooth" }); }
      return;
    }
    var actBtn = e.target.closest("[data-act]");
    var line = e.target.closest(".pl-msgline");
    if (!line) return;
    var msgId = Number(line.dataset.msgId);
    var m = msgById[msgId];
    if (actBtn) {
      e.stopPropagation();
      var act = actBtn.dataset.act;
      if (act === "react") openEmojiPicker(actBtn, msgId);
      else if (act === "reply") { setReply(msgId); closeAllActions(); }
      else if (act === "pin") { togglePin(msgId); closeAllActions(); }
      else if (act === "edit") { startEdit(line, m); closeAllActions(); }
      else if (act === "delete") { deleteMessage(msgId); closeAllActions(); }
      return;
    }
    if (e.target.closest(".pl-msg-reaction")) {
      react(msgId, e.target.closest(".pl-msg-reaction").dataset.reactEmoji);
      return;
    }
    if (e.target.closest(".pl-msgline-content")) {
      var wasOpen = line.classList.contains("actions-open");
      closeAllActions();
      if (!wasOpen) line.classList.add("actions-open");
    }
  });

  document.addEventListener("click", function (e) {
    if (!e.target.closest(".pl-msgline")) closeAllActions();
    if (!e.target.closest(".pl-emoji-picker") && !e.target.closest('[data-act="react"]')) closeEmojiPicker();
    if (!e.target.closest(".pl-chat-pins-panel") && !e.target.closest("#plPinsBtn")) pinsPanel.hidden = true;
  });

  // ---------------- pinned messages ----------------
  function renderPins(list) {
    pinsCount.textContent = list.length;
    pinsBtn.hidden = list.length === 0;
    if (!list.length) { pinsList.innerHTML = '<div class="pl-chat-pins-empty">Keine angehefteten Nachrichten.</div>'; return; }
    pinsList.innerHTML = list.map(function (m) {
      return '<div class="pl-chat-pin-row" data-scroll-to="' + m.id + '">'
        + '<div class="pl-chat-pin-sender">' + esc(m.sender_name) + '</div>'
        + '<div class="pl-chat-pin-text">' + esc(m.text || "Anhang") + '</div></div>';
    }).join("");
  }

  function loadPins() {
    fetch("/api/pl/chats/" + CHAT.id + "/pinned").then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) renderPins(j.messages);
    });
  }

  pinsBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    pinsPanel.hidden = !pinsPanel.hidden;
    if (!pinsPanel.hidden) loadPins();
  });
  pinsList.addEventListener("click", function (e) {
    var row = e.target.closest("[data-scroll-to]");
    if (!row) return;
    pinsPanel.hidden = true;
    var target = msgsEl.querySelector('.pl-msgline[data-msg-id="' + row.dataset.scrollTo + '"]');
    if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
    else window.plToast("Nachricht ist weiter oben im Verlauf.");
  });

  // first load
  fetch("/api/pl/chats/" + CHAT.id + "/messages?after=0")
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (j.ok) { j.messages.forEach(addMsg); scrollDown(); }
      updateEmpty();
      loadPins();
      polling = setInterval(poll, 3000);
      typingPolling = setInterval(pollTyping, 2500);
    })
    .catch(function () { updateEmpty(); polling = setInterval(poll, 3000); typingPolling = setInterval(pollTyping, 2500); });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { clearInterval(polling); clearInterval(typingPolling); }
    else {
      poll(); pollTyping();
      polling = setInterval(poll, 3000);
      typingPolling = setInterval(pollTyping, 2500);
    }
  });

  // ---------------- 1:1 voice calls (WebRTC) ----------------
  // This file is only the *signaling* client (offer/answer/ICE candidates
  // relayed through /api/pl/chats/<id>/call/*) -- once connected, audio
  // flows peer-to-peer, never through the server. STUN-only (Google's
  // free public server): works for most home/mobile networks, but there's
  // no TURN relay configured, so a call between two people both behind a
  // strict/symmetric NAT (some corporate networks) may fail to connect --
  // a real limitation worth knowing about, not a bug to "fix" by retrying.
  var callBtn = document.getElementById("plCallBtn");
  if (callBtn && CHAT && !CHAT.isGroup) {
    var callOverlay = document.getElementById("plCallOverlay");
    var callStatusEl = document.getElementById("plCallStatus");
    var incomingActions = document.getElementById("plCallIncomingActions");
    var activeActions = document.getElementById("plCallActiveActions");
    var acceptBtn = document.getElementById("plCallAcceptBtn");
    var declineBtn = document.getElementById("plCallDeclineBtn");
    var hangupBtn = document.getElementById("plCallHangupBtn");
    var muteBtn = document.getElementById("plCallMuteBtn");
    var remoteAudio = document.getElementById("plCallRemoteAudio");

    var ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
    var callState = "idle"; // idle | outgoing | incoming | active
    var pc = null;
    var localStream = null;
    var pendingOffer = null;
    var pendingIce = [];
    var lastSignalId = 0;
    var durationTimer = null;
    var callStatePolling = null;

    function fmtDuration(sec) {
      var m = Math.floor(sec / 60), s = sec % 60;
      return m + ":" + (s < 10 ? "0" : "") + s;
    }

    function startDurationTimer() {
      var startedAt = Date.now();
      clearInterval(durationTimer);
      durationTimer = setInterval(function () {
        callStatusEl.textContent = "Verbunden · " + fmtDuration(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    }

    function resetCallUI() {
      callState = "idle";
      callOverlay.hidden = true;
      incomingActions.hidden = true;
      activeActions.hidden = true;
      clearInterval(durationTimer);
      pendingOffer = null;
      pendingIce = [];
      lastSignalId = 0;
      if (muteBtn) muteBtn.classList.remove("is-muted");
      if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
      if (pc) { try { pc.close(); } catch (e) {} pc = null; }
      if (remoteAudio) remoteAudio.srcObject = null;
    }

    function sendSignal(type, data) {
      return fetch("/api/pl/chats/" + CHAT.id + "/call/signal", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: type, data: data }),
      }).catch(function () {});
    }

    function newPeerConnection() {
      var conn = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      conn.onicecandidate = function (e) { if (e.candidate) sendSignal("ice", e.candidate); };
      conn.ontrack = function (e) { if (remoteAudio) { remoteAudio.srcObject = e.streams[0]; remoteAudio.play().catch(function () {}); } };
      conn.onconnectionstatechange = function () {
        if (conn.connectionState === "connected" && callState !== "active") {
          callState = "active";
          incomingActions.hidden = true;
          activeActions.hidden = false;
          startDurationTimer();
        } else if (["disconnected", "failed", "closed"].indexOf(conn.connectionState) !== -1 && callState !== "idle") {
          window.plToast("Anruf beendet.");
          resetCallUI();
        }
      };
      return conn;
    }

    function startCall() {
      if (callState !== "idle") return;
      fetch("/api/pl/chats/" + CHAT.id + "/call/start", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { window.plToast(j.error === "already_in_call" ? "Es läuft schon ein Anruf." : "Anruf ging nicht."); return; }
          callState = "outgoing";
          callOverlay.hidden = false;
          callStatusEl.textContent = "Ruft an …";
          navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            localStream = stream;
            pc = newPeerConnection();
            stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
            return pc.createOffer();
          }).then(function (offer) {
            return pc.setLocalDescription(offer).then(function () { return offer; });
          }).then(function (offer) {
            sendSignal("offer", offer);
          }).catch(function () {
            window.plToast("Kein Zugriff aufs Mikrofon.");
            sendSignal("hangup");
            resetCallUI();
          });
        });
    }

    function showIncoming(callerName) {
      callState = "incoming";
      callOverlay.hidden = false;
      document.querySelector(".pl-call-name").textContent = callerName || document.querySelector(".pl-call-name").textContent;
      callStatusEl.textContent = "Ruft dich an …";
      incomingActions.hidden = false;
      if (window.plSound) window.plSound.play("receive");
    }

    function acceptCall() {
      if (!pendingOffer) { window.plToast("Verbindung noch nicht da, kurz warten."); return; }
      incomingActions.hidden = true;
      callStatusEl.textContent = "Verbinde …";
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        localStream = stream;
        pc = newPeerConnection();
        stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
        return pc.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      }).then(function () {
        flushPendingIce();
        return pc.createAnswer();
      }).then(function (answer) {
        return pc.setLocalDescription(answer).then(function () { return answer; });
      }).then(function (answer) {
        sendSignal("answer", answer);
      }).catch(function () {
        window.plToast("Kein Zugriff aufs Mikrofon.");
        sendSignal("decline");
        resetCallUI();
      });
    }

    function declineCall() { sendSignal("decline"); resetCallUI(); }
    function hangupCall() { sendSignal("hangup"); resetCallUI(); }

    function flushPendingIce() {
      if (!pc || !pc.remoteDescription) return;
      pendingIce.forEach(function (c) { pc.addIceCandidate(new RTCIceCandidate(c)).catch(function () {}); });
      pendingIce = [];
    }

    function handleSignal(sig) {
      if (sig.type === "offer") {
        pendingOffer = sig.data;
      } else if (sig.type === "answer") {
        if (pc) {
          pc.setRemoteDescription(new RTCSessionDescription(sig.data)).then(flushPendingIce).catch(function () {});
          callStatusEl.textContent = "Verbinde …";
        }
      } else if (sig.type === "ice") {
        if (pc && pc.remoteDescription) pc.addIceCandidate(new RTCIceCandidate(sig.data)).catch(function () {});
        else pendingIce.push(sig.data);
      } else if (sig.type === "decline") {
        window.plToast("Anruf abgelehnt.");
        resetCallUI();
      } else if (sig.type === "hangup") {
        window.plToast("Anruf beendet.");
        resetCallUI();
      }
    }

    function pollCallState() {
      fetch("/api/pl/chats/" + CHAT.id + "/call/state?after=" + lastSignalId)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) return;
          if (j.active && !j.is_caller && callState === "idle") showIncoming(j.caller_name);
          if (!j.active && callState !== "idle") { resetCallUI(); }
          (j.signals || []).forEach(function (sig) {
            lastSignalId = Math.max(lastSignalId, sig.id);
            handleSignal(sig);
          });
        })
        .catch(function () {});
    }

    callBtn.addEventListener("click", startCall);
    acceptBtn.addEventListener("click", acceptCall);
    declineBtn.addEventListener("click", declineCall);
    hangupBtn.addEventListener("click", hangupCall);
    muteBtn.addEventListener("click", function () {
      if (!localStream) return;
      var track = localStream.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      muteBtn.classList.toggle("is-muted", !track.enabled);
    });

    callStatePolling = setInterval(pollCallState, 1500);
    pollCallState();
  }
})();
