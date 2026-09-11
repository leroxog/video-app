(function () {
  "use strict";

  var LONGPRESS_MS = 1000; // 1 Sekunde gedrückt halten -> Kommentare
  var DOUBLETAP_MS = 320;
  var SEND_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var S = window.plSound || { play: function () {} };

  function copyText(text, okMsg) {
    var done = function () { window.plToast(okMsg || "Kopiert."); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.plToast(text); });
    } else {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); ta.remove(); done();
      } catch (e) { window.plToast(text); }
    }
  }

  // ---------------- sheets ----------------
  function openSheet(el) { el.classList.add("open"); document.body.style.overflow = "hidden"; S.play("open"); }
  function closeSheet(el) { el.classList.remove("open"); document.body.style.overflow = ""; S.play("close"); }
  function closeAllSheets() { $all(".pl-sheet-backdrop.open").forEach(closeSheet); }

  $all(".pl-sheet-backdrop").forEach(function (bd) {
    bd.addEventListener("click", function (e) {
      if (e.target === bd || e.target.closest("[data-close-sheet]") || e.target.classList.contains("pl-sheet-grip")) {
        closeSheet(bd);
      }
    });
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAllSheets(); });

  // live character counter for a textarea/input -> "<n> / <max>"
  function wireChar(fieldSel, outSel) {
    var f = $(fieldSel), out = $(outSel);
    if (!f || !out) return;
    var max = f.getAttribute("maxlength") || "";
    function upd() {
      var n = f.value.length;
      out.textContent = n + " / " + max;
      out.classList.toggle("over", max && n >= max * 0.92);
    }
    f.addEventListener("input", upd);
    f._resetChar = upd;
    upd();
  }

  var A = window.PlAttach || { mount: function () { return { get: function () { return {}; }, clear: function () {}, raw: function () { return null; } }; }, html: function () { return ""; } };

  // ---------------- new post (only where the compose sheet exists) ----------------
  var newPostSheet = $("#plNewPostSheet");
  var openNewPost = function () {};
  var openPs = function () {};

  if (newPostSheet) {
    var postAtt = A.mount($("#plPostAtt"));
    var editingId = null;
    var pollBuild = $("#plPollBuild"), pollToggle = $("#plPollToggle"), sensBox = $("#plPostSensitive");

    openNewPost = function (opts) {
      opts = opts || {};
      editingId = opts.editId || null;
      $("#plPostHeading").value = opts.heading || "";
      $("#plPostBody").value = opts.body || "";
      postAtt.clear();
      if (pollBuild) { pollBuild.hidden = true; $all(".pl-poll-in", pollBuild).forEach(function (i) { i.value = ""; }); }
      if (sensBox) sensBox.checked = !!opts.sensitive;
      $(".pl-sheet-bar h2", newPostSheet).textContent = editingId ? "Post bearbeiten" : "Neuer Post";
      $("#plPostSubmit").textContent = editingId ? "Speichern" : "Posten";
      if ($("#plPostHeading")._resetChar) $("#plPostHeading")._resetChar();
      if ($("#plPostBody")._resetChar) $("#plPostBody")._resetChar();
      openSheet(newPostSheet);
      setTimeout(function () { $("#plPostHeading").focus(); }, 250);
    };
    var nb = $("#plNewPostBtn");
    if (nb) nb.addEventListener("click", function () { openNewPost(); });
    wireChar("#plPostHeading", "#plPostChar");
    wireChar("#plPsBody", "#plPsChar");
    if (pollToggle && pollBuild) pollToggle.addEventListener("click", function () {
      pollBuild.hidden = !pollBuild.hidden;
      pollToggle.classList.toggle("on", !pollBuild.hidden);
    });
    if (new URLSearchParams(location.search).get("compose")) {
      openNewPost();
      try { history.replaceState({}, "", location.pathname); } catch (e) {}
    }
    $("#plPostSubmit").addEventListener("click", function () {
      var heading = $("#plPostHeading").value.trim();
      var body = $("#plPostBody").value.trim();
      if (!heading) { $("#plPostHeading").focus(); return; }
      var btn = this; btn.disabled = true;

      if (editingId) {
        api("PATCH", "/api/pl/posts/" + editingId, { heading: heading, body: body }).then(function (j) {
          btn.disabled = false;
          if (!j.ok) { window.plToast("Ging nicht."); return; }
          var g = document.querySelector('.pl-post-group[data-post-id="' + editingId + '"]');
          if (g && j.html) {
            var w = document.createElement("div"); w.innerHTML = j.html.trim();
            g.replaceWith(w.firstElementChild);
            wirePost(w.firstElementChild.querySelector(".pl-post"));
          }
          closeSheet(newPostSheet);
          window.plToast("Gespeichert.");
        }).catch(function () { btn.disabled = false; });
        return;
      }

      var payload = { heading: heading, body: body };
      var a = postAtt.get(); for (var k in a) payload[k] = a[k];
      if (sensBox && sensBox.checked) payload.sensitive = true;
      if (pollBuild && !pollBuild.hidden) {
        var opts = $all(".pl-poll-in", pollBuild).map(function (i) { return i.value.trim(); }).filter(Boolean);
        if (opts.length >= 2) payload.poll = opts;
      }
      api("POST", "/api/pl/posts", payload).then(function (j) {
        btn.disabled = false;
        if (!j.ok) { window.plToast(j.error === "rate" ? "Kurz warten." : "Ging nicht."); return; }
        closeSheet(newPostSheet);
        var feed = $("#plFeed");
        var empty = feed.querySelector(".pl-empty");
        if (empty) empty.remove();
        var wrap = document.createElement("div");
        wrap.innerHTML = j.html.trim();
        var group = wrap.firstElementChild;
        group.classList.add("is-new");
        feed.insertBefore(group, feed.firstChild);
        wirePost(group.querySelector(".pl-post"));
        group.addEventListener("animationend", function () { group.classList.remove("is-new"); }, { once: true });
        postAtt.clear();
        window.plToast("Gepostet!");
      }).catch(function () { btn.disabled = false; window.plToast("Ging nicht."); });
    });
  }

  // ---------------- P.S. ----------------
  var psSheet = $("#plPsSheet");
  if (psSheet) {
  var psAtt = A.mount($("#plPsAtt"));
  var psTargetId = null;
  openPs = function (postId) {
    psTargetId = postId;
    $("#plPsBody").value = "";
    psAtt.clear();
    if ($("#plPsBody")._resetChar) $("#plPsBody")._resetChar();
    openSheet(psSheet);
    setTimeout(function () { $("#plPsBody").focus(); }, 250);
  };
  $("#plPsSubmit").addEventListener("click", function () {
    var body = $("#plPsBody").value.trim();
    var pa = psAtt.get();
    if ((!body && !pa.att_kind) || !psTargetId) return;
    var btn = this; btn.disabled = true;
    var psPayload = { body: body }; for (var pk in pa) psPayload[pk] = pa[pk];
    var psRaw = psAtt.raw();
    api("POST", "/api/pl/posts/" + psTargetId + "/ps", psPayload).then(function (j) {
      btn.disabled = false;
      if (!j.ok) { window.plToast(j.error === "exists" ? "Du hast schon ein P.S." : "Ging nicht."); return; }
      var group = document.querySelector('.pl-post-group[data-post-id="' + psTargetId + '"]');
      if (group) {
        var slot = group.querySelector(".pl-ps-slot");
        slot.innerHTML = '<div class="pl-ps-card is-new">' + esc(body) + A.html(psRaw) + '</div>';
        group.dataset.hasPs = "1";
        var post = group.querySelector(".pl-post");
        if (post) post.dataset.hasPs = "1";
        var addBtn = group.querySelector("[data-ps-add]");
        if (addBtn) addBtn.remove();
      }
      closeSheet(psSheet);
      window.plToast("P.S. gespeichert.");
    }).catch(function () { btn.disabled = false; });
  });
  }

  // ---------------- comments (inline, per post) ----------------
  function timeAgo(iso) {
    var s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return "gerade eben";
    if (s < 3600) return Math.floor(s / 60) + " Min";
    if (s < 86400) return Math.floor(s / 3600) + " Std";
    return Math.floor(s / 86400) + " d";
  }

  function commentHTML(c) {
    var liked = c.liked_by_me ? " liked" : "";
    var menu = c.is_mine
      ? '<button type="button" data-cact="hide">' + (c.hidden ? "Einblenden" : "Verstecken") + '</button>'
      : '<button type="button" data-cact="report" class="pl-danger">Melden</button>';
    return '<div class="pl-comment' + (c.parent_id ? " reply" : "") + (c.hidden ? " is-hidden" : "") + '" data-comment-id="' + c.id + '" data-mine="' + (c.is_mine ? "1" : "0") + '">'
      + '<div class="pl-comment-head">'
      + '<div class="pl-avatar" style="width:22px;height:22px;font-size:10px;">'
      +   (c.author.avatar_url ? '<img src="' + esc(c.author.avatar_url) + '" alt="">' : esc(c.author.avatar_letter))
      + '</div>'
      + '<span class="pl-comment-user">' + esc(c.author.name || c.author.username) + '</span>'
      + '<span class="pl-comment-handle">@' + esc(c.author.username) + '</span>'
      + (c.hidden ? '<span class="pl-comment-hidden-tag">nur Follower</span>' : '')
      + '<span class="pl-comment-time">' + timeAgo(c.created_at) + '</span>'
      + '<button type="button" class="pl-comment-kebab" data-cmenu aria-label="Mehr">&#8942;</button>'
      + '<div class="pl-comment-menu" hidden>' + menu + '</div></div>'
      + '<div class="pl-comment-body">' + (c.body_html || esc(c.body)) + '</div>'
      + A.html(c.attachment)
      + '<div class="pl-comment-actions">'
      + '<button type="button" data-clike class="' + liked.trim() + '">&#9829; <b class="pl-clike-count">' + c.like_count + '</b></button>'
      + (c.parent_id ? "" : '<button type="button" data-creply>Antworten</button>')
      + '</div></div>';
  }

  function renderComments(listEl, list) {
    if (!list.length) {
      listEl.innerHTML = '<div class="pl-empty" style="padding:22px 0;background:none;border:none;">Noch keine Kommentare. Schreib den ersten!</div>';
      return;
    }
    listEl.innerHTML = list.map(commentHTML).join("");
  }

  function buildCommentsPanel(group, panel) {
    panel.innerHTML =
      '<div class="pl-comments-list"></div>'
      + '<div class="pl-reply-target"><span></span><button type="button" data-cancel-reply>&times;</button></div>'
      + '<div class="pl-comment-compose">'
      +   '<textarea class="pl-comment-input" rows="1" maxlength="2000" placeholder="Kommentieren ..."></textarea>'
      +   '<button type="button" class="pl-comment-send" aria-label="Senden">' + SEND_SVG + '</button>'
      + '</div>'
      + '<div class="pl-comment-att"></div>';
    panel.dataset.built = "1";
    panel._replyTo = null;

    var listEl = panel.querySelector(".pl-comments-list");
    var replyTarget = panel.querySelector(".pl-reply-target");
    var input = panel.querySelector(".pl-comment-input");
    var postId = group.dataset.postId;
    var cAtt = A.mount(panel.querySelector(".pl-comment-att"));

    listEl.addEventListener("click", function (e) {
      var cEl = e.target.closest(".pl-comment");
      if (!cEl) return;
      var cid = cEl.dataset.commentId;
      if (e.target.closest("[data-clike]")) {
        var btn = e.target.closest("[data-clike]");
        api("POST", "/api/pl/comments/" + cid + "/like").then(function (j) {
          if (!j.ok) return;
          btn.classList.toggle("liked", j.liked);
          btn.querySelector(".pl-clike-count").textContent = j.like_count;
        });
      } else if (e.target.closest("[data-creply]")) {
        panel._replyTo = cid;
        replyTarget.querySelector("span").textContent = "Antwort an " + cEl.querySelector(".pl-comment-user").textContent;
        replyTarget.classList.add("show");
        input.focus();
      }
    });

    replyTarget.querySelector("[data-cancel-reply]").addEventListener("click", function () {
      panel._replyTo = null;
      replyTarget.classList.remove("show");
    });

    function send() {
      var body = input.value.trim();
      var a = cAtt.get();
      if (!body && !a.att_kind) return;
      var payload = { body: body };
      for (var k in a) payload[k] = a[k];
      if (panel._replyTo) payload.parent_id = Number(panel._replyTo);
      input.value = "";
      input.style.height = "auto";
      cAtt.clear();
      api("POST", "/api/pl/posts/" + postId + "/comments", payload).then(function (j) {
        if (!j.ok) { window.plToast("Ging nicht."); return; }
        var emptyEl = listEl.querySelector(".pl-empty");
        if (emptyEl) emptyEl.remove();
        var wrap = document.createElement("div");
        wrap.innerHTML = commentHTML(j.comment);
        var node = wrap.firstChild;
        if (panel._replyTo) {
          var parent = listEl.querySelector('.pl-comment[data-comment-id="' + panel._replyTo + '"]');
          var after = parent, sib = parent.nextElementSibling;
          while (sib && sib.classList.contains("reply")) { after = sib; sib = sib.nextElementSibling; }
          after.insertAdjacentElement("afterend", node);
        } else {
          listEl.appendChild(node);
        }
        listEl.scrollTop = listEl.scrollHeight;
        panel._replyTo = null;
        replyTarget.classList.remove("show");
        var cc = group.querySelector(".pl-comment-count");
        if (cc) cc.textContent = String(Number(cc.textContent || 0) + 1);
      });
    }
    panel.querySelector(".pl-comment-send").addEventListener("click", send);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 96) + "px";
    });
  }

  function toggleComments(group) {
    var panel = group.querySelector(".pl-comments");
    if (!panel) return;
    if (panel.dataset.built && !panel.hidden) { panel.hidden = true; return; }
    if (!panel.dataset.built) buildCommentsPanel(group, panel);
    panel.hidden = false;
    S.play("open");
    if (!panel.dataset.loaded) {
      var listEl = panel.querySelector(".pl-comments-list");
      listEl.innerHTML = '<div class="pl-empty" style="padding:18px 0;background:none;border:none;">Lädt …</div>';
      api("GET", "/api/pl/posts/" + group.dataset.postId + "/comments").then(function (j) {
        if (j.ok) renderComments(listEl, j.comments);
        panel.dataset.loaded = "1";
      });
    }
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-comments-toggle]");
    if (!t) return;
    var group = t.closest(".pl-post-group");
    if (group) toggleComments(group);
  });

  // ---------------- per-post: double-tap like + long-press comments + share ----------------
  function doLike(post) {
    var id = post.dataset.postId;
    api("POST", "/api/pl/posts/" + id + "/like").then(function (j) {
      if (!j.ok) return;
      post.dataset.liked = j.liked ? "1" : "0";
      var stat = post.querySelector(".pl-stat-like");
      stat.classList.toggle("pl-stat-liked", j.liked);
      post.querySelector(".pl-like-count").textContent = j.like_count;
    });
  }

  function likeBurst(post) {
    var b = post.querySelector(".pl-like-burst");
    b.classList.remove("go");
    void b.offsetWidth;
    b.classList.add("go");
    S.play("like");
  }

  function wirePost(post) {
    if (!post || post.dataset.wired) return;
    post.dataset.wired = "1";
    var group = post.closest(".pl-post-group") || post;
    var lastTap = 0;
    var lpTimer = null;
    var lpFired = false;
    var startXY = null;

    function clearLP() {
      if (lpTimer) { clearTimeout(lpTimer); lpTimer = null; }
      post.classList.remove("is-holding");
    }

    function onStart(x, y) {
      lpFired = false;
      startXY = { x: x, y: y };
      post.classList.add("is-holding");
      lpTimer = setTimeout(function () {
        lpFired = true;
        post.classList.remove("is-holding");
        if (navigator.vibrate) navigator.vibrate(15);
        toggleComments(group);
      }, LONGPRESS_MS);
    }
    function onMove(x, y) {
      if (!startXY) return;
      if (Math.abs(x - startXY.x) > 12 || Math.abs(y - startXY.y) > 12) clearLP();
    }
    function onEnd() {
      clearLP();
      if (lpFired) { lpFired = false; return; }
    }

    post.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button, a")) return;
      onStart(e.clientX, e.clientY);
    });
    post.addEventListener("pointermove", function (e) { onMove(e.clientX, e.clientY); });
    post.addEventListener("pointerup", function (e) {
      if (e.target.closest("button, a")) { onEnd(); return; }
      var wasLP = lpFired;
      onEnd();
      if (wasLP) return;
      var now = Date.now();
      if (now - lastTap < DOUBLETAP_MS) {
        lastTap = 0;
        likeBurst(post);
        if (post.dataset.liked !== "1") doLike(post);
      } else {
        lastTap = now;
      }
    });
    post.addEventListener("pointercancel", clearLP);
    post.addEventListener("pointerleave", clearLP);
    post.addEventListener("dblclick", function (e) { e.preventDefault(); });
    post.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    var shareBtn = post.querySelector("[data-share]");
    if (shareBtn) shareBtn.addEventListener("click", function () {
      var id = post.dataset.postId;
      api("POST", "/api/pl/posts/" + id + "/share").then(function (j) {
        if (!j.ok) return;
        post.querySelector(".pl-share-count").textContent = j.share_count;
        var link = location.origin + "/p/" + id;
        if (navigator.share) {
          navigator.share({ title: "HEXAGONUM", url: link }).catch(function () {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(link).then(function () { window.plToast("Link kopiert."); });
        } else {
          window.plToast("Geteilt.");
        }
      });
    });

    var psAdd = post.querySelector("[data-ps-add]");
    if (psAdd) psAdd.addEventListener("click", function () { openPs(post.dataset.postId); });
  }

  $all(".pl-post").forEach(wirePost);

  // ---------------- kebab menu + repost + poll + sensitive ----------------
  function syncMenuOpen() {
    $all(".pl-post-group").forEach(function (g) {
      var open = g.querySelector('.pl-post-menu:not([hidden]), .pl-repost-menu:not([hidden])');
      g.classList.toggle("menu-open", !!open);
      if (!open) return;
      // Measure the real content height (scrollHeight -- reliable now that
      // it's unhidden and laid out) and the trigger button's own position,
      // not the menu's own (possibly still-mid-flip) rect -- flip upward
      // whenever it wouldn't otherwise fully fit below the trigger.
      var trigger = open.classList.contains("pl-repost-menu")
        ? g.querySelector("[data-repost-toggle]")
        : g.querySelector("[data-kebab]");
      var tr = (trigger || open).getBoundingClientRect();
      var needed = open.scrollHeight || 260;
      var spaceBelow = window.innerHeight - tr.bottom - 90; // stay clear of the bottom nav
      open.classList.toggle("menu-up", spaceBelow < needed && tr.top > needed + 40);
    });
  }

  document.addEventListener("click", function (e) {
    setTimeout(syncMenuOpen, 0);
    // close any open menu when clicking elsewhere
    if (!e.target.closest(".pl-post-menu") && !e.target.closest("[data-kebab]")) {
      $all(".pl-post-menu").forEach(function (m) { m.hidden = true; });
    }
    if (!e.target.closest(".pl-repost-menu") && !e.target.closest("[data-repost-toggle]")) {
      $all(".pl-repost-menu").forEach(function (m) { m.hidden = true; });
    }

    var kb = e.target.closest("[data-kebab]");
    if (kb) {
      var grpK = kb.closest(".pl-post-group");
      var mainMenu = grpK.querySelector('.pl-post-menu[data-menu="main"]');
      var wasHidden = mainMenu.hidden;
      $all(".pl-post-menu").forEach(function (m) { m.hidden = true; });
      mainMenu.hidden = wasHidden ? false : true;
      return;
    }

    var act = e.target.closest(".pl-post-menu [data-act]");
    if (act) {
      var grp = act.closest(".pl-post-group");
      var pid = grp.dataset.postId;
      var a = act.dataset.act;
      var link = location.origin + "/p/" + pid;

      if (a === "share-open") {
        grp.querySelector('.pl-post-menu[data-menu="main"]').hidden = true;
        grp.querySelector('.pl-post-menu[data-menu="share"]').hidden = false;
        return;
      }
      if (a === "share-back") {
        grp.querySelector('.pl-post-menu[data-menu="share"]').hidden = true;
        grp.querySelector('.pl-post-menu[data-menu="main"]').hidden = false;
        return;
      }
      act.closest(".pl-post-menu").hidden = true;

      if (a === "copy-link") {
        copyText(link, "Link kopiert.");
      } else if (a === "copy-text") {
        var h = (grp.querySelector(".pl-post-heading") || {}).textContent || "";
        var b = (grp.querySelector(".pl-post-body") || {}).textContent || "";
        copyText((h + "\n" + b).trim(), "Text kopiert.");
      } else if (a === "share-wa") {
        window.open("https://wa.me/?text=" + encodeURIComponent(link), "_blank", "noopener");
      } else if (a === "share-fb") {
        window.open("https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(link), "_blank", "noopener");
      } else if (a === "share-ig") {
        copyText(link, "Link kopiert – in Instagram einfügen.");
      } else if (a === "share-tt") {
        copyText(link, "Link kopiert – in TikTok einfügen.");
      } else if (a === "not-interested") {
        api("POST", "/api/pl/posts/" + pid + "/not-interested");
        grp.style.transition = "opacity .2s"; grp.style.opacity = "0";
        setTimeout(function () { grp.remove(); }, 200);
        window.plToast("Weniger davon.");
      } else if (a === "edit") {
        var post = grp.querySelector(".pl-post");
        openNewPost({
          editId: pid,
          heading: post.querySelector(".pl-post-heading").textContent,
          body: (post.querySelector(".pl-post-body") || {}).textContent || "",
        });
      } else if (a === "pin") {
        api("POST", "/api/pl/posts/" + pid + "/pin").then(function (j) {
          if (j.ok) window.plToast(j.pinned ? "Fixiert – oben im Profil." : "Nicht mehr fixiert.");
        });
      } else if (a === "delete") {
        if (!confirm("Diesen Post wirklich löschen?")) return;
        api("DELETE", "/api/pl/posts/" + pid).then(function (j) {
          if (j.ok) {
            grp.style.transition = "opacity .2s"; grp.style.opacity = "0";
            setTimeout(function () { grp.remove(); }, 200);
            window.plToast(j.soft ? "Gelöscht – Reposts bleiben." : "Gelöscht.");
          }
        });
      } else if (a === "report") {
        var reason = prompt("Warum meldest du diesen Post? (optional)") || "";
        api("POST", "/api/pl/posts/" + pid + "/report", { reason: reason }).then(function () { window.plToast("Danke, gemeldet."); });
      }
      return;
    }

    // comment kebab
    var cmk = e.target.closest("[data-cmenu]");
    if (cmk) {
      var cm = cmk.parentElement.querySelector(".pl-comment-menu");
      var cmWas = cm.hidden;
      $all(".pl-comment-menu").forEach(function (m) { m.hidden = true; });
      cm.hidden = cmWas ? false : true;
      return;
    }
    if (!e.target.closest(".pl-comment-menu") && !e.target.closest("[data-cmenu]")) {
      $all(".pl-comment-menu").forEach(function (m) { m.hidden = true; });
    }
    var cact = e.target.closest(".pl-comment-menu [data-cact]");
    if (cact) {
      var cel = cact.closest(".pl-comment");
      var cid = cel.dataset.commentId;
      cact.closest(".pl-comment-menu").hidden = true;
      if (cact.dataset.cact === "hide") {
        api("POST", "/api/pl/comments/" + cid + "/hide").then(function (j) {
          if (!j.ok) return;
          cel.classList.toggle("is-hidden", j.hidden);
          var tagWrap = cel.querySelector(".pl-comment-head");
          var tag = cel.querySelector(".pl-comment-hidden-tag");
          if (j.hidden && !tag) {
            tag = document.createElement("span");
            tag.className = "pl-comment-hidden-tag";
            tag.textContent = "nur Follower";
            tagWrap.insertBefore(tag, cel.querySelector(".pl-comment-time"));
          } else if (!j.hidden && tag) { tag.remove(); }
          var mbtn = cel.querySelector('[data-cact="hide"]');
          if (mbtn) mbtn.textContent = j.hidden ? "Einblenden" : "Verstecken";
          window.plToast(j.hidden ? "Versteckt – nur für deine Follower." : "Wieder sichtbar.");
        });
      } else {
        var r = prompt("Warum meldest du diesen Kommentar? (optional)") || "";
        api("POST", "/api/pl/comments/" + cid + "/report", { reason: r }).catch(function () {});
        window.plToast("Danke, gemeldet.");
      }
      return;
    }

    var rtog = e.target.closest("[data-repost-toggle]");
    if (rtog) {
      var rmenu = rtog.parentElement.querySelector(".pl-repost-menu");
      var rWasHidden = rmenu.hidden;
      $all(".pl-repost-menu").forEach(function (m) { m.hidden = true; });
      rmenu.hidden = !rWasHidden;
      return;
    }

    var rdo = e.target.closest("[data-repost-do]");
    if (rdo) {
      var g = rdo.closest(".pl-post-group");
      rdo.closest(".pl-repost-menu").hidden = true;
      if (rdo.dataset.repostDo === "quote") { openQuoteModal(g); return; }
      sendRepost(g, null);
      return;
    }

    var sens = e.target.closest(".pl-sensitive-show");
    if (sens) {
      var wrap = sens.closest(".pl-post-content");
      wrap.classList.remove("pl-sensitive");
      sens.remove();
      return;
    }

    var pollOpt = e.target.closest(".pl-poll-opt");
    if (pollOpt) {
      var poll = pollOpt.closest(".pl-poll");
      var pg = pollOpt.closest(".pl-post-group");
      api("POST", "/api/pl/posts/" + pg.dataset.postId + "/poll-vote",
          { choice: Number(pollOpt.dataset.choice) }).then(function (j) {
        if (!j.ok || !j.poll) return;
        poll.dataset.voted = "1";
        $all(".pl-poll-opt", poll).forEach(function (o, i) {
          o.classList.toggle("chosen", j.poll.my_vote === i);
          o.querySelector(".pl-poll-bar").style.width = j.poll.percents[i] + "%";
          o.querySelector(".pl-poll-pct").textContent = j.poll.percents[i] + "%";
        });
        poll.querySelector(".pl-poll-total").textContent = j.poll.total + " Stimmen";
      });
      return;
    }

    var wf = e.target.closest("[data-who-follow]");
    if (wf) {
      var row = wf.closest(".pl-who-row");
      wf.disabled = true;
      api("POST", "/api/pl/follow/" + encodeURIComponent(row.dataset.u)).then(function (j) {
        if (j.ok && j.following) { row.style.transition = "opacity .2s"; row.style.opacity = "0"; setTimeout(function () { row.remove(); }, 200); }
        else wf.disabled = false;
      });
      return;
    }
  });

  function sendRepost(g, quote) {
    api("POST", "/api/pl/posts/" + g.dataset.postId + "/repost", { quote: quote || null }).then(function (j) {
      if (!j.ok) return;
      var plain = j.reposted && !j.quote;
      g.dataset.reposted = plain ? "1" : "0";
      var btn = g.querySelector("[data-repost-toggle]");
      if (btn) {
        btn.classList.toggle("on", plain);
        var n = btn.querySelector(".pl-repost-n");
        if (j.repost_count) {
          if (!n) { n = document.createElement("b"); n.className = "pl-repost-n"; btn.appendChild(n); }
          n.textContent = j.repost_count;
        } else if (n) { n.remove(); }
      }
      if (S) S.play(j.reposted ? "like" : "close");
      window.plToast(j.reposted ? (j.quote ? "Zitiert." : "Repostet.") : "Repost entfernt.");
    });
  }

  function openQuoteModal(g) {
    var back = document.createElement("div");
    back.className = "pl-quote-modal-back";
    back.innerHTML =
      '<div class="pl-quote-modal" role="dialog" aria-modal="true">' +
        '<div class="pl-quote-modal-head"><button type="button" class="pl-quote-x" aria-label="Schließen">✕</button><b>Zitieren</b>' +
          '<button type="button" class="pl-quote-send" disabled>Reposten</button></div>' +
        '<textarea class="pl-quote-ta" maxlength="2000" placeholder="Sag etwas dazu …"></textarea>' +
      '</div>';
    document.body.appendChild(back);
    var ta = back.querySelector(".pl-quote-ta");
    var send = back.querySelector(".pl-quote-send");
    function close() { back.remove(); }
    ta.addEventListener("input", function () { send.disabled = !ta.value.trim(); });
    back.querySelector(".pl-quote-x").addEventListener("click", close);
    back.addEventListener("click", function (e) { if (e.target === back) close(); });
    send.addEventListener("click", function () {
      var q = ta.value.trim();
      if (!q) return;
      sendRepost(g, q);
      close();
    });
    setTimeout(function () { ta.focus(); }, 30);
  }

  // ---------------- load more ----------------
  var loadMore = $("#plLoadMore");
  if (loadMore) loadMore.addEventListener("click", function () {
    var btn = this; btn.disabled = true; btn.textContent = "Lädt …";
    var u = "/?before=" + btn.dataset.cursor;
    if (btn.dataset.feed && btn.dataset.feed !== "foryou") u += "&feed=" + btn.dataset.feed;
    if (btn.dataset.q) u += "&q=" + encodeURIComponent(btn.dataset.q);
    fetch(u).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, "text/html");
      var groups = doc.querySelectorAll("#plFeed .pl-post-group");
      var feed = $("#plFeed");
      groups.forEach(function (g) {
        feed.appendChild(g);
        var pa = g.querySelector(".pl-post");
        if (pa) wirePost(pa);
      });
      var nm = doc.querySelector("#plLoadMore");
      if (nm) { btn.dataset.cursor = nm.dataset.cursor; btn.disabled = false; btn.textContent = "Ältere Posts laden"; }
      else btn.remove();
    }).catch(function () { btn.disabled = false; btn.textContent = "Ältere Posts laden"; });
  });

  // ---------------- search ----------------
  var searchForm = $("#plSearchForm");
  if (searchForm) searchForm.addEventListener("submit", function () {
    // native GET submit reloads with ?q= -- server renders the video row + posts
  });

  // ---------------- link long-press preview ----------------
  (function linkPreview() {
    var timer = null, startX = 0, startY = 0, fired = false;

    function openPreview(url) {
      fired = true;
      var back = document.createElement("div");
      back.className = "pl-linkprev-back";
      back.innerHTML =
        '<div class="pl-linkprev" role="dialog" aria-modal="true">' +
          '<div class="pl-linkprev-bar">' +
            '<span class="pl-linkprev-url"></span>' +
            '<a class="pl-linkprev-open" target="_blank" rel="noopener nofollow">Öffnen</a>' +
            '<button type="button" class="pl-linkprev-x" aria-label="Schließen">✕</button>' +
          '</div>' +
          '<div class="pl-linkprev-frame"><iframe title="Vorschau" referrerpolicy="no-referrer" ' +
            'sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>' +
            '<div class="pl-linkprev-fallback" hidden>Vorschau von dieser Seite nicht möglich.<br>' +
            '<a target="_blank" rel="noopener nofollow">Im neuen Tab öffnen</a></div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(back);
      document.body.style.overflow = "hidden";
      var frame = back.querySelector("iframe");
      var fb = back.querySelector(".pl-linkprev-fallback");
      back.querySelector(".pl-linkprev-url").textContent = url.replace(/^https?:\/\/(www\.)?/, "");
      back.querySelector(".pl-linkprev-open").href = url;
      fb.querySelector("a").href = url;
      var settled = false;
      var killT = setTimeout(function () { if (!settled) { settled = true; frame.hidden = true; fb.hidden = false; } }, 4000);
      frame.addEventListener("load", function () { settled = true; clearTimeout(killT); });
      frame.addEventListener("error", function () { settled = true; clearTimeout(killT); frame.hidden = true; fb.hidden = false; });
      frame.src = url;
      function close() { back.remove(); document.body.style.overflow = ""; }
      back.querySelector(".pl-linkprev-x").addEventListener("click", close);
      back.addEventListener("click", function (e) { if (e.target === back) close(); });
      S.play("open");
    }

    document.addEventListener("pointerdown", function (e) {
      var a = e.target.closest("a.pl-link[data-pl-preview]");
      if (!a) return;
      fired = false; startX = e.clientX; startY = e.clientY;
      clearTimeout(timer);
      timer = setTimeout(function () { openPreview(a.getAttribute("data-pl-preview")); }, 430);
    });
    document.addEventListener("pointermove", function (e) {
      if (timer && (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10)) {
        clearTimeout(timer); timer = null;
      }
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      document.addEventListener(ev, function () { clearTimeout(timer); timer = null; });
    });
    // block the normal navigation if the long-press just opened a preview
    document.addEventListener("click", function (e) {
      var a = e.target.closest("a.pl-link[data-pl-preview]");
      if (a && fired) { e.preventDefault(); fired = false; }
    }, true);
  })();
})();
