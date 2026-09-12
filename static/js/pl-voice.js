(function () {
  "use strict";
  // Discord-style multi-person voice channels. Only the *signaling* is
  // server-relayed (offer/answer/ICE, polled via /api/pl/voice/*); once
  // connected, audio flows peer-to-peer, browser to browser. A full mesh:
  // every participant holds one RTCPeerConnection per OTHER participant.
  // STUN-only (no TURN configured) -- same limitation as the 1:1 calls,
  // and meshes get rough past ~6-8 simultaneous people (connections grow
  // with the square of the room size). To avoid two people both trying
  // to be the offerer for the same pair, the lower user id always
  // initiates -- a simple, deterministic tie-breaker.
  var ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
  var pane = document.getElementById("plSrvVoicePane");
  if (!pane) return;

  var MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  var MIC_MUTE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 9v3a3 3 0 0 0 4.6 2.5M15 4.8A3 3 0 0 0 9 6v.5"/><path d="M19 10v2a7 7 0 0 1-9.5 6.6"/><path d="M5 5v5a7 7 0 0 0 1.3 4.1"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/><line x1="2" y1="2" x2="22" y2="22"/></svg>';
  var SPEAKER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>';
  var HANGUP_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function api(m, u, b) {
    return fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined }).then(function (r) { return r.json(); });
  }

  var chatId = null, channelName = "";
  var myId = window.PL_ME && window.PL_ME.id;
  var joined = false;
  var muted = false;
  var localStream = null;
  var peers = {};          // userId -> { pc, audioEl }
  var participants = [];   // roster from server (includes me once joined)
  var pollTimer = null;
  var statusBar = null;

  function otherParticipants() {
    return participants.filter(function (p) { return p.user_id !== myId; });
  }

  function ensureStatusBar() {
    if (statusBar) return statusBar;
    statusBar = document.createElement("div");
    statusBar.className = "pl-voice-statusbar";
    statusBar.hidden = true;
    var col = document.querySelector(".pl-srv-channels");
    if (col) col.appendChild(statusBar);
    statusBar.addEventListener("click", function (e) {
      if (e.target.closest("[data-voice-mute]")) toggleMute();
      else if (e.target.closest("[data-voice-leave]")) leaveRoom();
    });
    return statusBar;
  }

  function renderStatusBar() {
    var bar = ensureStatusBar();
    if (!joined) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML =
      '<div class="pl-voice-statusbar-info">' + SPEAKER_SVG
      + '<div><div class="pl-voice-statusbar-label">Sprachverbunden</div>'
      + '<div class="pl-voice-statusbar-channel">' + esc(channelName) + '</div></div></div>'
      + '<button type="button" class="pl-voice-statusbar-btn" data-voice-mute aria-label="Stummschalten">' + (muted ? MIC_MUTE_SVG : MIC_SVG) + '</button>'
      + '<button type="button" class="pl-voice-statusbar-btn danger" data-voice-leave aria-label="Verlassen">' + HANGUP_SVG + '</button>';
  }

  function renderPane() {
    if (!joined) {
      pane.innerHTML = '<div class="pl-voice-joinbox">'
        + '<div class="pl-voice-joinicon">' + SPEAKER_SVG + '</div>'
        + '<div class="pl-voice-channel-name">' + esc(channelName) + '</div>'
        + '<button type="button" class="pl-btn pink" id="plVoiceJoinBtn">Beitreten</button>'
        + '</div>';
      var btn = document.getElementById("plVoiceJoinBtn");
      if (btn) btn.addEventListener("click", joinRoom);
      return;
    }
    pane.innerHTML = '<div class="pl-voice-grid">' + participants.map(function (p) {
      var av = p.avatar_url ? '<img src="' + esc(p.avatar_url) + '" alt="">' : esc((p.name || "?")[0].toUpperCase());
      return '<div class="pl-voice-tile">'
        + '<span class="pl-avatar pl-voice-avatar" style="background:' + esc(p.avatar_color) + '">' + av + '</span>'
        + (p.muted ? '<span class="pl-voice-mute-badge">' + MIC_MUTE_SVG + '</span>' : '')
        + '<div class="pl-voice-name">' + esc(p.name) + (p.user_id === myId ? " (du)" : "") + '</div>'
        + '</div>';
    }).join("") + '</div>';
  }

  function sendSignal(toId, type, data) {
    return api("POST", "/api/pl/voice/" + chatId + "/signal", { to_id: toId, type: type, data: data });
  }

  function peerFor(uid) {
    if (peers[uid]) return peers[uid];
    var pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    var audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    document.body.appendChild(audioEl);
    pc.onicecandidate = function (e) { if (e.candidate) sendSignal(uid, "ice", e.candidate); };
    pc.ontrack = function (e) { audioEl.srcObject = e.streams[0]; audioEl.play().catch(function () {}); };
    if (localStream) localStream.getTracks().forEach(function (t) { pc.addTrack(t, localStream); });
    peers[uid] = { pc: pc, audioEl: audioEl };
    return peers[uid];
  }

  function dropPeer(uid) {
    var p = peers[uid];
    if (!p) return;
    try { p.pc.close(); } catch (e) {}
    p.audioEl.remove();
    delete peers[uid];
  }

  function connectTo(uid) {
    if (uid === myId || peers[uid]) return;
    var p = peerFor(uid);
    if (myId < uid) {
      p.pc.createOffer().then(function (offer) {
        return p.pc.setLocalDescription(offer).then(function () { return offer; });
      }).then(function (offer) { sendSignal(uid, "offer", offer); }).catch(function () {});
    }
  }

  function handleSignal(sig) {
    var p = peerFor(sig.from_id);
    if (sig.type === "offer") {
      p.pc.setRemoteDescription(new RTCSessionDescription(sig.data)).then(function () {
        return p.pc.createAnswer();
      }).then(function (answer) {
        return p.pc.setLocalDescription(answer).then(function () { return answer; });
      }).then(function (answer) { sendSignal(sig.from_id, "answer", answer); }).catch(function () {});
    } else if (sig.type === "answer") {
      p.pc.setRemoteDescription(new RTCSessionDescription(sig.data)).catch(function () {});
    } else if (sig.type === "ice") {
      p.pc.addIceCandidate(new RTCIceCandidate(sig.data)).catch(function () {});
    }
  }

  function poll() {
    if (!joined) return;
    api("GET", "/api/pl/voice/" + chatId + "/state").then(function (j) {
      if (!j.ok) return;
      if (!j.in_room) { joined = false; renderPane(); renderStatusBar(); return; }
      participants = j.participants;
      var nowIds = participants.map(function (p) { return p.user_id; });
      nowIds.forEach(function (uid) { if (uid !== myId) connectTo(uid); });
      Object.keys(peers).map(Number).forEach(function (uid) { if (nowIds.indexOf(uid) === -1) dropPeer(uid); });
      (j.signals || []).forEach(handleSignal);
      renderPane();
    }).catch(function () {});
  }

  function joinRoom() {
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      localStream = stream;
      return api("POST", "/api/pl/voice/" + chatId + "/join");
    }).then(function (j) {
      if (!j.ok) { window.plToast && window.plToast("Beitreten ging nicht."); return; }
      joined = true;
      muted = false;
      participants = j.participants;
      renderPane();
      renderStatusBar();
      otherParticipants().forEach(function (p) { connectTo(p.user_id); });
      clearInterval(pollTimer);
      pollTimer = setInterval(poll, 1500);
    }).catch(function () {
      window.plToast && window.plToast("Kein Zugriff aufs Mikrofon.");
    });
  }

  function leaveRoom() {
    api("POST", "/api/pl/voice/" + chatId + "/leave");
    joined = false;
    clearInterval(pollTimer);
    Object.keys(peers).map(Number).forEach(dropPeer);
    if (localStream) { localStream.getTracks().forEach(function (t) { t.stop(); }); localStream = null; }
    participants = [];
    renderPane();
    renderStatusBar();
  }

  function toggleMute() {
    if (!localStream) return;
    var track = localStream.getAudioTracks()[0];
    if (!track) return;
    muted = !muted;
    track.enabled = !muted;
    api("POST", "/api/pl/voice/" + chatId + "/mute", { muted: muted });
    renderStatusBar();
  }

  function open(id, name) {
    if (joined && chatId === id) { renderPane(); return; }
    if (joined && chatId !== id) leaveRoom();
    chatId = id;
    channelName = name;
    joined = false;
    renderPane();
    renderStatusBar();
  }

  function close() {
    if (joined) leaveRoom();
    chatId = null;
  }

  window.PlVoice = { open: open, close: close };
})();
