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

  // ---------------- sheets ----------------
  function openSheet(el) { el.classList.add("open"); document.body.style.overflow = "hidden"; }
  function closeSheet(el) { el.classList.remove("open"); document.body.style.overflow = ""; }
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

  // ---------------- new post ----------------
  var newPostSheet = $("#plNewPostSheet");
  function openNewPost() {
    $("#plPostHeading").value = "";
    $("#plPostBody").value = "";
    if ($("#plPostHeading")._resetChar) $("#plPostHeading")._resetChar();
    if ($("#plPostBody")._resetChar) $("#plPostBody")._resetChar();
    openSheet(newPostSheet);
    setTimeout(function () { $("#plPostHeading").focus(); }, 250);
  }
  $("#plNewPostBtn").addEventListener("click", openNewPost);
  wireChar("#plPostHeading", "#plPostChar");
  wireChar("#plPsBody", "#plPsChar");
  // the desktop sidebar "POSTEN" button links here with ?compose=1
  if (new URLSearchParams(location.search).get("compose")) {
    openNewPost();
    try { history.replaceState({}, "", location.pathname); } catch (e) {}
  }
  $("#plPostSubmit").addEventListener("click", function () {
    var heading = $("#plPostHeading").value.trim();
    var body = $("#plPostBody").value.trim();
    if (!heading) { $("#plPostHeading").focus(); return; }
    var btn = this; btn.disabled = true;
    api("POST", "/api/pl/posts", { heading: heading, body: body }).then(function (j) {
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
      window.plToast("Gepostet!");
    }).catch(function () { btn.disabled = false; window.plToast("Ging nicht."); });
  });

  // ---------------- P.S. ----------------
  var psSheet = $("#plPsSheet");
  var psTargetId = null;
  function openPs(postId) {
    psTargetId = postId;
    $("#plPsBody").value = "";
    if ($("#plPsBody")._resetChar) $("#plPsBody")._resetChar();
    openSheet(psSheet);
    setTimeout(function () { $("#plPsBody").focus(); }, 250);
  }
  $("#plPsSubmit").addEventListener("click", function () {
    var body = $("#plPsBody").value.trim();
    if (!body || !psTargetId) return;
    var btn = this; btn.disabled = true;
    api("POST", "/api/pl/posts/" + psTargetId + "/ps", { body: body }).then(function (j) {
      btn.disabled = false;
      if (!j.ok) { window.plToast(j.error === "exists" ? "Du hast schon ein P.S." : "Ging nicht."); return; }
      var group = document.querySelector('.pl-post-group[data-post-id="' + psTargetId + '"]');
      if (group) {
        var slot = group.querySelector(".pl-ps-slot");
        slot.innerHTML = '<div class="pl-ps-card is-new"><span class="pl-ps-label">P.S.</span><span class="pl-ps-text">'
          + esc(body) + '</span></div>';
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
    return '<div class="pl-comment' + (c.parent_id ? " reply" : "") + '" data-comment-id="' + c.id + '">'
      + '<div class="pl-comment-head">'
      + '<div class="pl-avatar" style="width:22px;height:22px;font-size:10px;">' + esc(c.author.avatar_letter) + '</div>'
      + '<span class="pl-comment-user">@' + esc(c.author.username) + '</span>'
      + '<span class="pl-comment-time">' + timeAgo(c.created_at) + '</span></div>'
      + '<div class="pl-comment-body">' + esc(c.body) + '</div>'
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
      + '</div>';
    panel.dataset.built = "1";
    panel._replyTo = null;

    var listEl = panel.querySelector(".pl-comments-list");
    var replyTarget = panel.querySelector(".pl-reply-target");
    var input = panel.querySelector(".pl-comment-input");
    var postId = group.dataset.postId;

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
      if (!body) return;
      var payload = { body: body };
      if (panel._replyTo) payload.parent_id = Number(panel._replyTo);
      input.value = "";
      input.style.height = "auto";
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
          navigator.share({ title: "pinklemon", url: link }).catch(function () {});
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

  // ---------------- search ----------------
  var searchForm = $("#plSearchForm");
  searchForm.addEventListener("submit", function () {
    // native GET submit reloads with ?q= -- server renders the video row + posts
  });
})();
