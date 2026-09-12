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

  var PERM_LABELS = {
    manage_server: "Server verwalten",
    manage_channels: "Kanäle verwalten",
    manage_roles: "Rollen verwalten",
    manage_messages: "Nachrichten verwalten",
    kick_members: "Mitglieder kicken",
    ban_members: "Mitglieder bannen",
    create_invite: "Einladungen erstellen",
  };
  var ALL_PERMS = Object.keys(PERM_LABELS);

  var channelListEl = $("#plSrvChannelList");
  var memberListEl = $("#plSrvMemberList");
  var frame = $("#plSrvFrame");
  var voicePane = $("#plSrvVoicePane");
  var channelNameEl = $("#plSrvChannelName");
  var addChannelBtn = $("#plSrvAddChannelBtn");
  var settingsBtn = $("#plSrvSettingsBtn");
  var roleListEl = $("#plSrvRoleList");

  var state = { server: null, channels: [], roles: [], members: [], activeChannelId: null };

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

  function roleForMember(m) {
    var roles = state.roles.filter(function (r) { return m.role_ids.indexOf(r.id) !== -1 && !r.is_default; });
    return roles[0] || null;
  }

  function memberRowHTML(m) {
    var role = roleForMember(m);
    var color = role ? role.color : "var(--pl-text-dim)";
    return '<div class="pl-srv-member-row" data-user-id="' + m.user_id + '">'
      + '<span class="pl-avatar" style="width:32px;height:32px;font-size:12px;background:' + esc(m.avatar_color) + '">'
      + (m.avatar_url ? '<img src="' + esc(m.avatar_url) + '" alt="">' : esc((m.name || "?")[0].toUpperCase())) + '</span>'
      + '<span class="pl-srv-member-dot" style="background:' + (m.online ? "var(--pl-online)" : "var(--pl-text-faint)") + '"></span>'
      + '<span class="pl-srv-member-name" style="color:' + color + '">' + esc(m.nickname || m.name)
      + (m.is_owner ? ' <svg class="pl-srv-crown" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8z"/></svg>' : "") + '</span>'
      + (has("manage_roles") || (has("kick_members") && !m.is_owner) ? '<button type="button" class="pl-srv-member-menu-btn" data-member-menu="' + m.user_id + '">&#8942;</button>' : '')
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
      if (window.PlVoice) window.PlVoice.open(id, ch.name); else voicePane.hidden = false;
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
      state.server = j.server; state.channels = j.channels; state.roles = j.roles; state.members = j.members;
      $("#plSrvName").textContent = state.server.name;
      addChannelBtn.hidden = !has("manage_channels");
      settingsBtn.hidden = !has("manage_roles");
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

  // ---- member kick / role menu ----
  memberListEl.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-member-menu]");
    if (!btn) return;
    var uid = Number(btn.dataset.memberMenu);
    var m = state.members.find(function (x) { return x.user_id === uid; });
    if (!m) return;
    var lines = [];
    if (has("manage_roles")) {
      state.roles.filter(function (r) { return !r.is_default; }).forEach(function (r) {
        lines.push((m.role_ids.indexOf(r.id) !== -1 ? "[x] " : "[ ] ") + r.name);
      });
    }
    var msg = "Aktion für " + (m.nickname || m.name) + ":\n" + lines.join("\n")
      + (lines.length ? "\n\nRollenname eingeben zum Umschalten, " : "")
      + (has("kick_members") && !m.is_owner ? "oder 'kick' zum Entfernen." : "");
    var answer = prompt(msg);
    if (!answer) return;
    answer = answer.trim();
    if (answer.toLowerCase() === "kick" && has("kick_members") && !m.is_owner) {
      api("POST", "/api/pl/servers/" + SID + "/members/" + uid + "/kick").then(function (j) { if (j.ok) load(); else window.plToast("Ging nicht."); });
      return;
    }
    var role = state.roles.find(function (r) { return r.name.toLowerCase() === answer.toLowerCase(); });
    if (role && has("manage_roles")) {
      var assign = m.role_ids.indexOf(role.id) === -1;
      api("POST", "/api/pl/servers/" + SID + "/members/" + uid + "/roles", { role_id: role.id, assign: assign })
        .then(function (j) { if (j.ok) load(); });
    }
  });

  // ---- roles settings ----
  var settingsSheet = $("#plSrvSettingsSheet");
  var roleEditSheet = $("#plSrvRoleEditSheet");
  var editingRoleId = null;

  function renderRoleList() {
    roleListEl.innerHTML = state.roles.map(function (r) {
      return '<div class="pl-srv-role-row" data-role-id="' + r.id + '">'
        + '<span class="pl-srv-role-dot" style="background:' + esc(r.color) + '"></span>'
        + '<span class="pl-srv-role-name">' + esc(r.name) + '</span></div>';
    }).join("");
  }

  settingsBtn.addEventListener("click", function () {
    renderRoleList();
    $("#plSrvPublicToggle").checked = !!(state.server && state.server.is_public);
    openSheet(settingsSheet);
  });
  $("#plSrvPublicToggle").addEventListener("change", function (e) {
    api("POST", "/api/pl/servers/" + SID + "/visibility", { is_public: e.target.checked }).then(function (j) {
      if (j.ok) state.server.is_public = j.is_public; else e.target.checked = !e.target.checked;
    });
  });

  roleListEl.addEventListener("click", function (e) {
    var row = e.target.closest("[data-role-id]");
    if (!row) return;
    openRoleEditor(Number(row.dataset.roleId));
  });

  function openRoleEditor(roleId) {
    var role = state.roles.find(function (r) { return r.id === roleId; });
    if (!role) return;
    editingRoleId = roleId;
    $("#plSrvRoleEditTitle").textContent = "Rolle bearbeiten";
    $("#plSrvRoleEditName").value = role.name;
    $("#plSrvRoleEditName").disabled = role.is_default;
    $("#plSrvRoleEditColor").value = role.color;
    $("#plSrvDeleteRoleBtn").hidden = role.is_default;
    $("#plSrvRoleEditPerms").innerHTML = ALL_PERMS.map(function (p) {
      var checked = (role.permissions || []).indexOf(p) !== -1;
      return '<label class="pl-check-inline"><input type="checkbox" data-perm="' + p + '"' + (checked ? " checked" : "") + '> ' + PERM_LABELS[p] + '</label>';
    }).join("");
    openSheet(roleEditSheet);
  }

  $("#plSrvAddRoleBtn").addEventListener("click", function () {
    var name = $("#plSrvNewRoleName").value.trim();
    if (!name) { window.plToast("Name fehlt."); return; }
    api("POST", "/api/pl/servers/" + SID + "/roles", { name: name }).then(function (j) {
      if (j.ok) { $("#plSrvNewRoleName").value = ""; state.roles.push(j.role); renderRoleList(); } else { window.plToast("Ging nicht."); }
    });
  });

  $("#plSrvSaveRoleBtn").addEventListener("click", function () {
    var perms = [...document.querySelectorAll("#plSrvRoleEditPerms input:checked")].map(function (i) { return i.dataset.perm; });
    var body = { color: $("#plSrvRoleEditColor").value, permissions: perms };
    if (!$("#plSrvRoleEditName").disabled) body.name = $("#plSrvRoleEditName").value.trim();
    api("PATCH", "/api/pl/servers/" + SID + "/roles/" + editingRoleId, body).then(function (j) {
      if (j.ok) { closeSheet(roleEditSheet); load(); } else { window.plToast("Ging nicht."); }
    });
  });

  $("#plSrvDeleteRoleBtn").addEventListener("click", function () {
    if (!confirm("Rolle wirklich löschen?")) return;
    api("DELETE", "/api/pl/servers/" + SID + "/roles/" + editingRoleId).then(function (j) {
      if (j.ok) { closeSheet(roleEditSheet); load(); } else { window.plToast("Ging nicht."); }
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
