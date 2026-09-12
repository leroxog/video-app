(function () {
  "use strict";
  var SID = window.PL_SERVER_ID;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function api(m, u, b) {
    return fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined }).then(function (r) { return r.json(); });
  }
  function openSheet(el) { el.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeSheet(el) { el.classList.remove("open"); document.body.style.overflow = ""; }
  document.querySelectorAll(".pl-sheet-backdrop").forEach(function (bd) {
    bd.addEventListener("click", function (e) {
      if (e.target === bd || e.target.classList.contains("pl-sheet-grip") || e.target.closest("[data-close-sheet]")) closeSheet(bd);
    });
  });

  var ROLE_LABELS = { admin: "Admin", moderator: "Moderator:in", member: "Mitglied" };

  var channelListEl = $("#plSrvChannelList");
  var memberListEl = $("#plSrvMemberList");
  var frame = $("#plSrvFrame");
  var voicePane = $("#plSrvVoicePane");
  var channelNameEl = $("#plSrvChannelName");
  var addChannelBtn = $("#plSrvAddChannelBtn");
  var settingsBtn = $("#plSrvSettingsBtn");

  var state = { server: null, channels: [], members: [], activeChannelId: null };

  function myPerms() { return (state.server && state.server.my_permissions) || []; }
  function has(perm) { return myPerms().indexOf(perm) !== -1; }

  var ICON_HASHTAG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14M5 15h14M10 3 7 21M17 3l-3 18"/></svg>';
  var ICON_SPEAKER = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>';
  var ICON_CHEVRON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  function collapsedKey(cat) { return "plSrvCollapsed:" + SID + ":" + cat; }
  function isCollapsed(cat) { try { return localStorage.getItem(collapsedKey(cat)) === "1"; } catch (e) { return false; } }
  function setCollapsed(cat, v) { try { localStorage.setItem(collapsedKey(cat), v ? "1" : "0"); } catch (e) {} }

  function groupChannels() {
    var groups = {}, order = [];
    state.channels.slice().sort(function (a, b) { return a.position - b.position; }).forEach(function (c) {
      var key = c.category || "";
      if (!(key in groups)) { groups[key] = []; order.push(key); }
      groups[key].push(c);
    });
    order.sort(function (a, b) {
      if (a === "") return -1;
      if (b === "") return 1;
      return a.localeCompare(b);
    });
    return { groups: groups, order: order };
  }

  function channelRowHTML(c) {
    return '<div class="pl-srv-channel-row' + (c.id === state.activeChannelId ? " is-active" : "") + '" data-channel-id="' + c.id + '">'
      + '<span class="pl-srv-channel-hash">' + (c.channel_type === "voice" ? ICON_SPEAKER : ICON_HASHTAG) + '</span>'
      + '<span class="pl-srv-channel-name">' + esc(c.name) + '</span>'
      + (has("manage_channels") ? '<button type="button" class="pl-srv-channel-del" data-del-channel="' + c.id + '" aria-label="L&ouml;schen">&times;</button>' : '')
      + '</div>';
  }

  function renderChannels() {
    var g = groupChannels();
    channelListEl.innerHTML = g.order.map(function (cat) {
      if (!cat) return g.groups[cat].map(channelRowHTML).join("");
      var collapsed = isCollapsed(cat);
      return '<div class="pl-srv-category' + (collapsed ? " is-collapsed" : "") + '" data-category="' + esc(cat) + '">'
        + ICON_CHEVRON + '<span>' + esc(cat).toUpperCase() + '</span></div>'
        + (collapsed ? "" : '<div class="pl-srv-category-channels">' + g.groups[cat].map(channelRowHTML).join("") + '</div>');
    }).join("");
  }

  function memberRowHTML(m) {
    var color = m.role === "moderator" ? "var(--pl-pink)" : "var(--pl-text-dim)";
    var badge = m.is_owner
      ? ' <svg class="pl-srv-crown" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8z"/></svg>'
      : (m.role === "moderator" ? ' <svg class="pl-srv-modbadge" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>' : "");
    var canManage = !m.is_owner && (has("manage_roles") || has("kick_members") || has("ban_members"));
    return '<div class="pl-srv-member-row" data-user-id="' + m.user_id + '">'
      + '<span class="pl-avatar" style="width:32px;height:32px;font-size:12px;background:' + esc(m.avatar_color) + '">'
      + (m.avatar_url ? '<img src="' + esc(m.avatar_url) + '" alt="">' : esc((m.name || "?")[0].toUpperCase())) + '</span>'
      + '<span class="pl-srv-member-dot" style="background:' + (m.online ? "var(--pl-online)" : "var(--pl-text-faint)") + '"></span>'
      + '<span class="pl-srv-member-name" style="color:' + color + '">' + esc(m.nickname || m.name) + badge + '</span>'
      + (canManage ? '<button type="button" class="pl-srv-member-menu-btn" data-member-menu="' + m.user_id + '">&#8942;</button>' : '')
      + '</div>';
  }

  function renderMembers() {
    var sorted = state.members.slice().sort(function (a, b) {
      return (a.nickname || a.name).toLowerCase().localeCompare((b.nickname || b.name).toLowerCase());
    });
    var online = sorted.filter(function (m) { return m.online; });
    var offline = sorted.filter(function (m) { return !m.online; });
    var section = function (label, list) {
      if (!list.length) return "";
      return '<div class="pl-srv-member-group">' + esc(label) + ' — ' + list.length + '</div>'
        + list.map(memberRowHTML).join("");
    };
    memberListEl.innerHTML = section("ONLINE", online) + section("OFFLINE", offline);
  }

  function selectChannel(id) {
    state.activeChannelId = id;
    var ch = state.channels.find(function (c) { return c.id === id; });
    channelNameEl.textContent = ch ? (ch.channel_type === "voice" ? "🔊 " : "# ") + ch.name : "";
    if (ch && ch.channel_type === "voice") {
      frame.hidden = true;
      voicePane.hidden = false;
      if (window.PlVoice) window.PlVoice.open(id, ch.name);
    } else {
      if (window.PlVoice) window.PlVoice.close();
      voicePane.hidden = true;
      frame.hidden = false;
      frame.src = "/freunde/c/" + id;
    }
    renderChannels();
    document.getElementById("plSrvScreen").classList.add("show-main");
  }

  function load() {
    api("GET", "/api/pl/servers/" + SID).then(function (j) {
      if (!j.ok) { window.plToast("Server nicht gefunden."); return; }
      state.server = j.server; state.channels = j.channels; state.members = j.members;
      $("#plSrvName").textContent = state.server.name;
      addChannelBtn.hidden = !has("manage_channels");
      settingsBtn.hidden = !has("manage_server");
      renderChannels();
      renderMembers();
      if (!state.activeChannelId && state.channels.length) selectChannel(state.channels[0].id);
    });
  }

  channelListEl.addEventListener("click", function (e) {
    var del = e.target.closest("[data-del-channel]");
    if (del) {
      e.stopPropagation();
      if (!confirm("Kanal wirklich löschen?")) return;
      api("DELETE", "/api/pl/servers/" + SID + "/channels/" + del.dataset.delChannel).then(function (j) {
        if (j.ok) load();
      });
      return;
    }
    var cat = e.target.closest("[data-category]");
    if (cat) {
      var name = cat.dataset.category;
      setCollapsed(name, !isCollapsed(name));
      renderChannels();
      return;
    }
    var row = e.target.closest("[data-channel-id]");
    if (row) selectChannel(Number(row.dataset.channelId));
  });

  // ---- new channel sheet (name + text/voice + optional category) ----
  var newChannelSheet = $("#plSrvNewChannelSheet");
  var newChannelType = "text";
  addChannelBtn.addEventListener("click", function () {
    $("#plSrvNewChannelName").value = "";
    $("#plSrvNewChannelCategory").value = "";
    newChannelType = "text";
    document.querySelectorAll("#plSrvNewChannelSheet [data-chtype]").forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.chtype === newChannelType);
    });
    openSheet(newChannelSheet);
  });
  newChannelSheet.addEventListener("click", function (e) {
    var b = e.target.closest("[data-chtype]");
    if (!b) return;
    newChannelType = b.dataset.chtype;
    document.querySelectorAll("#plSrvNewChannelSheet [data-chtype]").forEach(function (x) {
      x.classList.toggle("is-active", x === b);
    });
  });
  $("#plSrvCreateChannelBtn").addEventListener("click", function () {
    var name = $("#plSrvNewChannelName").value.trim();
    if (!name) { window.plToast("Name fehlt."); return; }
    var category = $("#plSrvNewChannelCategory").value.trim();
    api("POST", "/api/pl/servers/" + SID + "/channels", {
      name: name, channel_type: newChannelType, category: category || null,
    }).then(function (j) {
      if (j.ok) { closeSheet(newChannelSheet); load(); } else { window.plToast("Ging nicht."); }
    });
  });

  $("#plSrvLeaveBtn").addEventListener("click", function () {
    if (!confirm("Diesen Server wirklich verlassen?")) return;
    api("POST", "/api/pl/servers/" + SID + "/leave").then(function (j) {
      if (j.ok) location.href = "/";
      else window.plToast(j.error === "owner_cannot_leave" ? "Als Besitzer kannst du den Server nicht verlassen." : "Ging nicht.");
    });
  });

  // ---- invite ----
  var inviteSheet = $("#plSrvInviteSheet");
  $("#plSrvInviteBtn").addEventListener("click", function () {
    $("#plSrvInviteCode").textContent = (state.server && state.server.invite_code) || "…";
    openSheet(inviteSheet);
  });
  $("#plSrvCopyInviteBtn").addEventListener("click", function () {
    var code = (state.server && state.server.invite_code) || "";
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { window.plToast("Kopiert."); });
  });

  // ---- member actions: promote/demote, kick, ban -- real buttons, no prompt() ----
  function openMemberMenu(uid) {
    var m = state.members.find(function (x) { return x.user_id === uid; });
    if (!m) return;
    var actions = [];
    if (has("manage_roles")) {
      actions.push(m.role === "moderator"
        ? '<button type="button" class="pl-btn ghost" data-action="demote">Zum Mitglied machen</button>'
        : '<button type="button" class="pl-btn ghost" data-action="promote">Zum Moderator:in machen</button>');
    }
    if (has("kick_members")) actions.push('<button type="button" class="pl-btn ghost" data-action="kick">Aus dem Server entfernen</button>');
    if (has("ban_members")) actions.push('<button type="button" class="pl-btn" style="background:var(--pl-danger);color:#fff;" data-action="ban">Bannen</button>');
    var back = document.createElement("div");
    back.className = "pl-sheet-backdrop pl-sheet-modal open";
    back.innerHTML = '<div class="pl-sheet"><div class="pl-sheet-grip"></div>'
      + '<div class="pl-sheet-bar"><button class="pl-sheet-x" data-close-sheet aria-label="Schließen">&times;</button>'
      + '<h2>' + esc(m.nickname || m.name) + '</h2><span></span></div>'
      + '<div class="pl-srv-member-actions">' + (actions.join("") || '<p style="color:var(--pl-text-faint);text-align:center;">Keine Aktionen verf&uuml;gbar.</p>') + '</div></div>';
    document.body.appendChild(back);
    document.body.style.overflow = "hidden";
    function close() { back.remove(); document.body.style.overflow = ""; }
    back.addEventListener("click", function (e) {
      if (e.target === back || e.target.classList.contains("pl-sheet-grip") || e.target.closest("[data-close-sheet]")) { close(); return; }
      var b = e.target.closest("[data-action]");
      if (!b) return;
      var action = b.dataset.action;
      if (action === "promote" || action === "demote") {
        api("POST", "/api/pl/servers/" + SID + "/members/" + uid + "/role", { role: action === "promote" ? "moderator" : "member" })
          .then(function (j) { if (j.ok) { close(); load(); } else window.plToast("Ging nicht."); });
      } else if (action === "kick") {
        if (!confirm("Wirklich aus dem Server entfernen?")) return;
        api("POST", "/api/pl/servers/" + SID + "/members/" + uid + "/kick").then(function (j) { if (j.ok) { close(); load(); } else window.plToast("Ging nicht."); });
      } else if (action === "ban") {
        if (!confirm("Wirklich bannen?")) return;
        api("POST", "/api/pl/servers/" + SID + "/members/" + uid + "/ban").then(function (j) { if (j.ok) { close(); load(); } else window.plToast("Ging nicht."); });
      }
    });
  }

  memberListEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-member-menu]");
    if (!btn) return;
    openMemberMenu(Number(btn.dataset.memberMenu));
  });

  // ---- server settings (public toggle only -- member management lives in the member list) ----
  var settingsSheet = $("#plSrvSettingsSheet");
  settingsBtn.addEventListener("click", function () {
    $("#plSrvPublicToggle").checked = !!(state.server && state.server.is_public);
    openSheet(settingsSheet);
  });
  $("#plSrvPublicToggle").addEventListener("change", function (e) {
    api("POST", "/api/pl/servers/" + SID + "/visibility", { is_public: e.target.checked }).then(function (j) {
      if (j.ok) state.server.is_public = j.is_public; else e.target.checked = !e.target.checked;
    });
  });

  // ---- mobile navigation ----
  $("#plSrvMobileBack").addEventListener("click", function () {
    document.getElementById("plSrvScreen").classList.remove("show-main");
  });
  $("#plSrvMembersToggleBtn").addEventListener("click", function () {
    document.getElementById("plSrvScreen").classList.toggle("show-members");
  });

  load();
})();
