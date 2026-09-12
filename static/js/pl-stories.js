(function () {
  "use strict";
  var bar = document.getElementById("plStoriesBar");
  if (!bar) return;

  var DURATION = 5000;
  var state = { mine: null, friends: [] };

  function esc(s) { var d = document.createElement("div"); d.textContent = s || ""; return d.innerHTML; }

  function bubble(user, opts) {
    opts = opts || {};
    var hasStories = user.stories && user.stories.length;
    var ring = opts.isMine ? (hasStories ? "has" : "empty") : (user.all_seen ? "seen" : "unseen");
    var av = user.avatar_url ? '<img src="' + esc(user.avatar_url) + '" alt="">' : esc(user.avatar_letter || "?");
    var plusBadge = opts.isMine ? '<span class="pl-story-plus">+</span>' : "";
    return (
      '<button type="button" class="pl-story-bubble ring-' + ring + '" data-username="' + esc(user.username) + '"' + (opts.isMine ? ' data-mine="1"' : '') + '>' +
        '<span class="pl-story-ring"><span class="pl-avatar" style="background:' + esc(user.avatar_color || "#999") + '">' + av + '</span></span>' +
        plusBadge +
        '<span class="pl-story-name">' + (opts.isMine ? "Deine Story" : esc(user.name)) + '</span>' +
      '</button>'
    );
  }

  function render() {
    var meFallback = { username: (window.PL_ME && window.PL_ME.username) || "", avatar_url: null, avatar_letter: "?", avatar_color: "#999", stories: [] };
    var html = bubble(state.mine || meFallback, { isMine: true });
    state.friends.forEach(function (f) { html += bubble(f); });
    bar.innerHTML = html;
  }

  function load() {
    fetch("/api/pl/stories").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      state.mine = j.mine;
      state.friends = j.friends;
      render();
    });
  }

  bar.addEventListener("click", function (e) {
    var b = e.target.closest(".pl-story-bubble");
    if (!b) return;
    if (b.dataset.mine === "1") {
      if (state.mine && state.mine.stories.length) {
        openViewer([state.mine], 0);
      } else {
        addStory();
      }
      return;
    }
    var uname = b.dataset.username;
    var idx = state.friends.findIndex(function (f) { return f.username === uname; });
    if (idx === -1) return;
    openViewer(state.friends, idx);
  });

  document.addEventListener("click", function (e) {
    if (e.target.closest("#plCameraBtn")) { e.preventDefault(); addStory(); }
  });

  function addStory() {
    window.PlCamera.open().then(function (file) {
      if (!file) return null;
      return window.PlCropper.open(file, { aspect: 9 / 16, shape: "rect", title: "Story" });
    }).then(function (blob) {
      if (!blob) return;
      var fd = new FormData();
      fd.append("media", blob, "story.jpg");
      return fetch("/api/pl/stories", { method: "POST", body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j.ok) { load(); window.plToast && window.plToast("Story gepostet."); }
          else window.plToast && window.plToast("Ging nicht.");
        });
    });
  }

  // ---------------- fullscreen viewer ----------------
  function openViewer(users, startIndex) {
    var back = document.createElement("div");
    back.className = "pl-storyview-back";
    document.body.appendChild(back);
    document.body.style.overflow = "hidden";

    var ui = { userIndex: startIndex, storyIndex: 0, timer: null };

    function currentUser() { return users[ui.userIndex]; }
    function currentStory() { return currentUser().stories[ui.storyIndex]; }

    function close() {
      clearTimeout(ui.timer);
      document.body.removeChild(back);
      document.body.style.overflow = "";
    }

    function markViewed(story) {
      if (story.viewed_by_me || story.is_mine) return;
      story.viewed_by_me = true;
      fetch("/api/pl/stories/" + story.id + "/view", { method: "POST" });
    }

    function renderFrame() {
      var user = currentUser();
      var story = currentStory();
      if (!story) { advanceUser(1); return; }
      markViewed(story);
      var bars = user.stories.map(function (s, i) {
        var cls = i < ui.storyIndex ? "done" : (i === ui.storyIndex ? "active" : "");
        return '<span class="pl-storyview-seg ' + cls + '"><span class="pl-storyview-seg-fill"></span></span>';
      }).join("");
      var av = user.avatar_url ? '<img src="' + esc(user.avatar_url) + '" alt="">' : esc(user.avatar_letter || "?");
      back.innerHTML =
        '<div class="pl-storyview-bars">' + bars + '</div>' +
        '<div class="pl-storyview-head">' +
          '<span class="pl-avatar" style="background:' + esc(user.avatar_color || "#999") + '">' + av + '</span>' +
          '<b>' + (story.is_mine ? "Deine Story" : esc(user.name)) + '</b>' +
          '<span class="pl-storyview-ago">' + esc(story.created_ago) + '</span>' +
          '<button type="button" class="pl-storyview-close" aria-label="Schließen">&times;</button>' +
        '</div>' +
        '<img class="pl-storyview-img" src="' + esc(story.url) + '" alt="">' +
        (story.caption ? '<div class="pl-storyview-caption">' + esc(story.caption) + '</div>' : '') +
        '<div class="pl-storyview-zones"><span class="z-prev"></span><span class="z-next"></span></div>' +
        (story.is_mine ? '<button type="button" class="pl-storyview-views">' + plicon_eye() + '<span>Aufrufe</span></button>' : '');

      back.querySelector(".pl-storyview-close").addEventListener("click", close);
      back.querySelector(".z-prev").addEventListener("click", function () { advance(-1); });
      back.querySelector(".z-next").addEventListener("click", function () { advance(1); });
      var vb = back.querySelector(".pl-storyview-views");
      if (vb) vb.addEventListener("click", function () { showViewers(story.id); });

      startTimer();
    }

    function plicon_eye() {
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/></svg>';
    }

    function startTimer() {
      clearTimeout(ui.timer);
      var segs = back.querySelectorAll(".pl-storyview-seg");
      var fill = segs[ui.storyIndex] ? segs[ui.storyIndex].querySelector(".pl-storyview-seg-fill") : null;
      if (fill) {
        fill.style.transition = "none";
        fill.style.width = "0%";
        void fill.offsetWidth;
        fill.style.transition = "width " + DURATION + "ms linear";
        fill.style.width = "100%";
      }
      ui.timer = setTimeout(function () { advance(1); }, DURATION);
    }

    function advance(dir) {
      ui.storyIndex += dir;
      if (ui.storyIndex < 0) { advanceUser(-1); return; }
      if (ui.storyIndex >= currentUser().stories.length) { advanceUser(1); return; }
      renderFrame();
    }

    function advanceUser(dir) {
      ui.userIndex += dir;
      if (ui.userIndex < 0 || ui.userIndex >= users.length) { close(); return; }
      ui.storyIndex = dir > 0 ? 0 : users[ui.userIndex].stories.length - 1;
      renderFrame();
    }

    function showViewers(storyId) {
      clearTimeout(ui.timer);
      fetch("/api/pl/stories/" + storyId + "/viewers").then(function (r) { return r.json(); }).then(function (j) {
        if (!j.ok) return;
        var panel = document.createElement("div");
        panel.className = "pl-storyview-viewers";
        panel.innerHTML =
          '<div class="pl-storyview-viewers-title">Aufrufe (' + j.viewers.length + ')</div>' +
          (j.viewers.length
            ? j.viewers.map(function (v) {
                var av = v.avatar_url ? '<img src="' + esc(v.avatar_url) + '" alt="">' : esc(v.avatar_letter || "?");
                return '<div class="pl-storyview-viewer-row"><span class="pl-avatar" style="background:' + esc(v.avatar_color || "#999") + '">' + av + '</span><span>' + esc(v.name) + '</span><span class="pl-storyview-viewer-ago">' + esc(v.viewed_ago) + '</span></div>';
              }).join("")
            : '<div class="pl-storyview-viewers-empty">Noch keine Aufrufe.</div>');
        panel.addEventListener("click", function (e) {
          if (e.target === panel) { panel.remove(); startTimer(); }
        });
        back.appendChild(panel);
      });
    }

    renderFrame();
  }

  load();
})();
