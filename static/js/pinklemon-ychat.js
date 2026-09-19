(function () {
  "use strict";
  var input = document.getElementById("ycInput");
  var postBtn = document.getElementById("ycPostBtn");
  var count = document.getElementById("ycCount");
  var feed = document.getElementById("ycFeed");

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function timeLabel(iso) {
    var d = new Date(iso);
    var diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "gerade eben";
    if (diffMin < 60) return diffMin + "m";
    if (diffMin < 1440) return Math.round(diffMin / 60) + "h";
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
  }

  function renderPosts(posts) {
    if (!posts.length) {
      feed.innerHTML = '<div class="yc-empty">Noch nichts gepostet -- leg los!</div>';
      return;
    }
    feed.innerHTML = posts.map(function (p) {
      return '<div class="yc-post" data-id="' + p.id + '">'
        + '<div class="meta"><div class="avatar">' + esc((p.author || "?").slice(0, 1).toUpperCase()) + '</div>'
        + '<div><div class="name">' + esc(p.author) + '</div><div class="time">' + timeLabel(p.created_at) + '</div></div></div>'
        + '<p class="text"></p>'
        + '<div class="actions">'
        + '<button class="like' + (p.liked_by_me ? ' liked' : '') + '" data-like="' + p.id + '">&#9829; <span>' + p.likes + '</span></button>'
        + (p.is_mine ? '<button class="del" data-del="' + p.id + '" aria-label="Löschen" title="Löschen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg></button>' : '')
        + '</div></div>';
    }).join("");
    // Post text goes through textContent, never innerHTML, so a post's
    // own text can never be interpreted as markup.
    feed.querySelectorAll(".yc-post").forEach(function (el, i) {
      el.querySelector(".text").textContent = posts[i].content;
    });
  }

  function loadFeed() {
    fetch("/api/ychat/posts").then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) renderPosts(j.posts);
    });
  }

  input.addEventListener("input", function () {
    var len = input.value.trim().length;
    postBtn.disabled = !len;
    count.textContent = len ? (280 - len) : "";
  });

  postBtn.addEventListener("click", function () {
    var content = input.value.trim();
    if (!content) return;
    postBtn.disabled = true;
    fetch("/api/ychat/posts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: content }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) {
        input.value = "";
        count.textContent = "";
        loadFeed();
      } else {
        postBtn.disabled = false;
      }
    }).catch(function () { postBtn.disabled = false; });
  });

  feed.addEventListener("click", function (e) {
    var likeBtn = e.target.closest("[data-like]");
    if (likeBtn) {
      fetch("/api/ychat/posts/" + likeBtn.dataset.like + "/like", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function () { loadFeed(); });
      return;
    }
    var delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      if (!window.confirm("Diesen Post wirklich löschen?")) return;
      fetch("/api/ychat/posts/" + delBtn.dataset.del, { method: "DELETE" })
        .then(function () { loadFeed(); });
    }
  });

  loadFeed();
  setInterval(loadFeed, 5000);
})();
