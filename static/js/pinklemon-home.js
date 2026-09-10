(function () {
  "use strict";

  var LONGPRESS_MS = 2350; // "2,35 Sekunden gedrückt halten"
  var DOUBLETAP_MS = 320;

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

  // ---------------- new post ----------------
  var newPostSheet = $("#plNewPostSheet");
  $("#plNewPostBtn").addEventListener("click", function () {
    $("#plPostHeading").value = "";
    $("#plPostBody").value = "";
    openSheet(newPostSheet);
    setTimeout(function () { $("#plPostHeading").focus(); }, 250);
  });
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
      var node = wrap.firstChild;
      feed.insertBefore(node, feed.firstChild);
      wirePost(node);
      window.plToast("Gepostet!");
    }).catch(function () { btn.disabled = false; window.plToast("Ging nicht."); });
  });

  // ---------------- P.S. ----------------
  var psSheet = $("#plPsSheet");
  var psTargetId = null;
  function openPs(postId) {
    psTargetId = postId;
    $("#plPsBody").value = "";
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
      var post = document.querySelector('.pl-post[data-post-id="' + psTargetId + '"]');
      if (post) {
        var slot = post.querySelector(".pl-ps-slot");
        slot.innerHTML = '<div class="pl-ps"><div class="pl-ps-label">P.S.</div><div class="pl-ps-body">'
          + esc(body) + '</div><div class="pl-ps-time">gerade eben</div></div>';
        post.dataset.hasPs = "1";
        var addBtn = post.querySelector("[data-ps-add]");
        if (addBtn) addBtn.remove();
      }
      closeSheet(psSheet);
      window.plToast("P.S. gespeichert.");
    }).catch(function () { btn.disabled = false; });
  });

  // ---------------- comments ----------------
  var commentsSheet = $("#plCommentsSheet");
  var commentsList = $("#plCommentsList");
  var commentInput = $("#plCommentInput");
  var replyTarget = $("#plReplyTarget");
  var commentsPostId = null;
  var replyToId = null;

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
      + '<button type="button" data-clike class="' + liked.trim() + '">♥ <b class="pl-clike-count">' + c.like_count + '</b></button>'
      + (c.parent_id ? "" : '<button type="button" data-creply>Antworten</button>')
      + '</div></div>';
  }

  function renderComments(list) {
    if (!list.length) { commentsList.innerHTML = '<div class="pl-empty" style="padding:28px 0;">Noch keine Kommentare.</div>'; return; }
    commentsList.innerHTML = list.map(commentHTML).join("");
  }

  function openComments(postId) {
    commentsPostId = postId;
    replyToId = null;
    replyTarget.classList.remove("show");
    commentInput.value = "";
    commentsList.innerHTML = '<div class="pl-empty" style="padding:28px 0;">Lädt …</div>';
    openSheet(commentsSheet);
    api("GET", "/api/pl/posts/" + postId + "/comments").then(function (j) {
      if (j.ok) renderComments(j.comments);
    });
  }

  commentsList.addEventListener("click", function (e) {
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
      replyToId = cid;
      var uname = cEl.querySelector(".pl-comment-user").textContent;
      replyTarget.querySelector("span").textContent = "Antwort an " + uname;
      replyTarget.classList.add("show");
      commentInput.focus();
    }
  });

  $("#plCancelReply").addEventListener("click", function () {
    replyToId = null;
    replyTarget.classList.remove("show");
  });

  function sendComment() {
    var body = commentInput.value.trim();
    if (!body || !commentsPostId) return;
    var payload = { body: body };
    if (replyToId) payload.parent_id = Number(replyToId);
    commentInput.value = "";
    api("POST", "/api/pl/posts/" + commentsPostId + "/comments", payload).then(function (j) {
      if (!j.ok) { window.plToast("Ging nicht."); return; }
      var empty = commentsList.querySelector(".pl-empty");
      if (empty) empty.remove();
      var wrap = document.createElement("div");
      wrap.innerHTML = commentHTML(j.comment);
      var node = wrap.firstChild;
      if (replyToId) {
        var parent = commentsList.querySelector('.pl-comment[data-comment-id="' + replyToId + '"]');
        var after = parent;
        var sib = parent.nextElementSibling;
        while (sib && sib.classList.contains("reply")) { after = sib; sib = sib.nextElementSibling; }
        after.insertAdjacentElement("afterend", node);
      } else {
        commentsList.appendChild(node);
      }
      commentsList.scrollTop = commentsList.scrollHeight;
      replyToId = null;
      replyTarget.classList.remove("show");
      // bump the post's comment counter
      var post = document.querySelector('.pl-post[data-post-id="' + commentsPostId + '"]');
      if (post) {
        var cc = post.querySelector(".pl-comment-count");
        cc.textContent = String(Number(cc.textContent || 0) + 1);
      }
    });
  }
  $("#plCommentSend").addEventListener("click", sendComment);
  commentInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendComment(); }
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
        openComments(post.dataset.postId);
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

    // pointer events cover mouse + touch
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
