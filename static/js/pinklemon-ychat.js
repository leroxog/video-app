(function () {
  "use strict";
  var input = document.getElementById("ycInput");
  var postBtn = document.getElementById("ycPostBtn");
  var count = document.getElementById("ycCount");
  var feed = document.getElementById("ycFeed");
  var liveBtn = document.getElementById("ycLiveBtn");
  var liveSection = document.getElementById("ycLiveSection");
  var liveList = document.getElementById("ycLiveList");
  var iAmLive = !!window.YCHAT_IS_LIVE;

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

  // "Live" here means a REAL live video -- this app has no streaming
  // infrastructure of its own (no RTMP ingest, no transcoding, no CDN;
  // building that is a project on its own, not a feature), so going
  // live means broadcasting to YouTube Live (free, no account setup
  // beyond a Google account) and pasting that stream's link here. It
  // then embeds via YouTube's own official player -- the exact same
  // mechanism NRS already uses for regular videos, since a live
  // broadcast is just a video that happens to be live. Without a link,
  // it's honestly just a text status, not a faked video.
  function loadLive() {
    fetch("/api/ychat/live").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      liveSection.hidden = !j.live.length;
      liveList.innerHTML = j.live.map(function (u) {
        return '<div class="yc-live-row">'
          + '<div class="head"><span class="yc-live-dot"></span>'
          + '<span class="name">' + esc(u.name) + '</span>'
          + (u.title ? '<span class="title">' + esc(u.title) + '</span>' : '')
          + '</div>'
          + (u.video_id
            ? '<div class="yc-live-video"><iframe src="https://www.youtube.com/embed/' + esc(u.video_id) + '?autoplay=0" allowfullscreen></iframe></div>'
            : '')
          + '</div>';
      }).join("");
    });
  }

  function setLiveBtn() {
    liveBtn.textContent = iAmLive ? "Live beenden" : "Live gehen";
    liveBtn.classList.toggle("is-live", iAmLive);
  }

  liveBtn.addEventListener("click", function () {
    if (iAmLive) {
      fetch("/api/ychat/live", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_live: false }),
      }).then(function (r) { return r.json(); }).then(function (j) {
        iAmLive = j.is_live;
        setLiveBtn();
        loadLive();
      });
      return;
    }
    var title = window.prompt("Kurz -- was machst du gerade?", "");
    if (title === null) return;
    var videoUrl = window.prompt(
      "Link zu deinem YouTube-Live-Stream (auf youtube.com/live_dashboard findest du ihn) -- leer lassen für nur Text ohne Video:", ""
    );
    if (videoUrl === null) return;
    fetch("/api/ychat/live", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_live: true, title: title, video_url: videoUrl }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) {
        window.alert(j.error === "invalid_video_url" ? "Das sieht nicht nach einem YouTube-Link aus." : "Ging nicht.");
        return;
      }
      iAmLive = j.is_live;
      setLiveBtn();
      loadLive();
    });
  });

  setLiveBtn();
  loadFeed();
  loadLive();
  setInterval(loadFeed, 5000);
  setInterval(loadLive, 5000);
})();
