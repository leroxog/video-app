(function () {
  "use strict";
  var uploadBtn = document.getElementById("ylUploadBtn");
  var uploadLabel = document.getElementById("ylUploadLabel");
  var youtubeBtn = document.getElementById("ylYoutubeBtn");
  var fileInput = document.getElementById("ylFileInput");
  var homeBtn = document.getElementById("ylHome");
  var searchInput = document.getElementById("ylSearch");
  var chips = document.getElementById("ylChips");
  var body = document.getElementById("ylBody");
  var grid = document.getElementById("ylGrid");
  var player = document.getElementById("ylPlayer");
  var stage = document.getElementById("ylStage");
  var playerTitle = document.getElementById("ylPlayerTitle");
  var playerMeta = document.getElementById("ylPlayerMeta");
  var playerName = document.getElementById("ylPlayerName");
  var playerAvatar = document.getElementById("ylPlayerAvatar");
  var playerActions = document.getElementById("ylPlayerActions");
  var related = document.getElementById("ylRelated");
  var backBtn = document.getElementById("ylBackBtn");

  var userName = window.YLIB_USER || "";
  var userInitial = (userName.slice(0, 1) || "?").toUpperCase();
  var allItems = [];
  var itemsById = {};
  var filter = "all";
  var query = "";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var ERROR_TEXTS = {
    bad_type: "Dieser Dateityp wird nicht unterstützt. Erlaubt: Bilder (png/jpg/gif/webp) und Videos (mp4/webm/ogg/mov).",
    too_large: "Die Datei ist zu groß (maximal 50 MB).",
    limit_reached: "Das Limit von 50 Einträgen ist erreicht -- lösche zuerst etwas.",
    invalid_url: "Das sieht nicht nach einem YouTube-Link aus.",
  };

  function errorText(j, fallback) { return ERROR_TEXTS[j.error] || fallback; }

  // Grabs a JPEG frame from the chosen video in the browser (resolves null if the browser can't decode it).
  function makeVideoThumb(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var video = document.createElement("video");
      var settled = false;
      function finish(blob) {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        resolve(blob);
      }
      video.muted = true;
      video.preload = "metadata";
      video.onerror = function () { finish(null); };
      video.onloadeddata = function () {
        video.currentTime = Math.min(1, (video.duration || 2) / 2);
      };
      video.onseeked = function () {
        var vw = video.videoWidth || 480;
        var vh = video.videoHeight || 270;
        var canvas = document.createElement("canvas");
        canvas.width = Math.min(vw, 480);
        canvas.height = Math.round(canvas.width * vh / vw);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(finish, "image/jpeg", 0.8);
      };
      setTimeout(function () { finish(null); }, 8000);
      video.src = url;
    });
  }

  function timeAgo(iso) {
    var d = new Date(iso);
    var diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "gerade eben";
    if (diffMin < 60) return "vor " + diffMin + " Min.";
    if (diffMin < 1440) return "vor " + Math.round(diffMin / 60) + " Std.";
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function sourceLabel(it) {
    if (it.source === "youtube") return "YouTube";
    return it.kind === "video" ? "Video" : "Bild";
  }

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
  var EMPTY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/></svg>';

  function thumbHtml(it) {
    if (it.source === "youtube") {
      return '<div class="yl-thumb"><img src="' + esc(it.thumbnail_url) + '" alt="" loading="lazy"><span class="yl-badge">YouTube</span></div>';
    }
    if (it.kind === "video" && it.thumbnail_url) {
      return '<div class="yl-thumb"><img src="' + esc(it.thumbnail_url) + '" alt="" loading="lazy"><span class="yl-badge">Video</span></div>';
    }
    if (it.kind === "video") {
      return '<div class="yl-thumb is-video">' + PLAY_ICON + '<span class="yl-badge">Video</span></div>';
    }
    return '<div class="yl-thumb"><img src="' + esc(it.url) + '" alt="" loading="lazy"></div>';
  }

  function matchesFilter(it) {
    if (filter === "youtube") return it.source === "youtube";
    if (filter === "video") return it.source === "upload" && it.kind === "video";
    if (filter === "image") return it.kind === "image";
    return true;
  }

  function visibleItems() {
    return allItems.filter(function (it) {
      return matchesFilter(it) && (!query || it.title.toLowerCase().indexOf(query) !== -1);
    });
  }

  function renderGrid() {
    var items = visibleItems();
    if (!items.length) {
      var msg = allItems.length
        ? "Nichts gefunden."
        : "Noch nichts hier -- lade eine Datei hoch oder füge einen YouTube-Link hinzu.";
      grid.innerHTML = '<div class="yl-empty" style="grid-column: 1/-1">' + EMPTY_ICON + '<div>' + msg + '</div></div>';
      return;
    }
    grid.innerHTML = items.map(function (it) {
      return '<div class="yl-card" data-id="' + it.id + '">'
        + thumbHtml(it)
        + '<button class="yl-del" data-del="' + it.id + '" aria-label="Löschen" title="Löschen">' + TRASH_ICON + '</button>'
        + '<div class="yl-meta-row"><div class="yl-avatar">' + esc(userInitial) + '</div>'
        + '<div class="yl-info"><div class="title"></div>'
        + '<div class="meta">' + esc(userName) + ' &bull; ' + sourceLabel(it) + ' &bull; ' + timeAgo(it.created_at) + '</div></div></div>'
        + '</div>';
    }).join("");
    grid.querySelectorAll(".yl-card").forEach(function (el, i) {
      el.querySelector(".title").textContent = items[i].title;
    });
  }

  function loadItems() {
    fetch("/api/ylib/items").then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return;
      allItems = j.items;
      itemsById = {};
      allItems.forEach(function (it) { itemsById[it.id] = it; });
      renderGrid();
    });
  }

  function renderRelated(currentId) {
    var others = allItems.filter(function (it) { return it.id !== currentId; }).slice(0, 12);
    if (!others.length) { related.innerHTML = ""; return; }
    related.innerHTML = others.map(function (it) {
      return '<div class="yl-rel" data-id="' + it.id + '">' + thumbHtml(it)
        + '<div class="yl-rel-info"><div class="t"></div>'
        + '<div class="m">' + esc(userName) + '<br>' + sourceLabel(it) + ' &bull; ' + timeAgo(it.created_at) + '</div></div></div>';
    }).join("");
    related.querySelectorAll(".yl-rel").forEach(function (el, i) {
      el.querySelector(".t").textContent = others[i].title;
    });
  }

  function openPlayer(item) {
    if (item.source === "youtube") {
      stage.innerHTML = '<iframe src="https://www.youtube.com/embed/' + esc(item.youtube_video_id) + '?autoplay=1"'
        + ' allow="autoplay; encrypted-media" allowfullscreen></iframe>';
      playerActions.innerHTML = '<a class="yl-pill-btn" target="_blank" rel="noopener noreferrer"'
        + ' href="https://www.youtube.com/watch?v=' + esc(item.youtube_video_id) + '">Auf YouTube öffnen</a>';
    } else {
      stage.innerHTML = item.kind === "video"
        ? '<video src="' + esc(item.url) + '" controls autoplay></video>'
        : '<img src="' + esc(item.url) + '" alt="">';
      playerActions.innerHTML = '<a class="yl-pill-btn" target="_blank" rel="noopener" download'
        + ' href="' + esc(item.url) + '">Herunterladen</a>';
    }
    playerTitle.textContent = item.title;
    playerAvatar.textContent = userInitial;
    playerName.textContent = userName;
    playerMeta.textContent = sourceLabel(item) + " • " + timeAgo(item.created_at);
    renderRelated(item.id);
    body.classList.add("in-player");
    player.classList.add("active");
    body.scrollTop = 0;
  }

  function closePlayer() {
    body.classList.remove("in-player");
    player.classList.remove("active");
    stage.innerHTML = "";
  }

  function setFilter(value) {
    filter = value;
    chips.querySelectorAll(".yl-chip").forEach(function (c) {
      c.classList.toggle("active", c.dataset.filter === value);
    });
    renderGrid();
  }

  backBtn.addEventListener("click", closePlayer);

  homeBtn.addEventListener("click", function () {
    closePlayer();
    searchInput.value = "";
    query = "";
    setFilter("all");
  });

  chips.addEventListener("click", function (e) {
    var chip = e.target.closest(".yl-chip");
    if (chip) setFilter(chip.dataset.filter);
  });

  searchInput.addEventListener("input", function () {
    query = searchInput.value.trim().toLowerCase();
    if (player.classList.contains("active")) closePlayer();
    renderGrid();
  });

  grid.addEventListener("click", function (e) {
    var delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      e.stopPropagation();
      if (!window.confirm("Diese Datei wirklich löschen?")) return;
      fetch("/api/ylib/items/" + delBtn.dataset.del, { method: "DELETE" })
        .then(function () { loadItems(); });
      return;
    }
    var card = e.target.closest(".yl-card");
    if (card) {
      var item = itemsById[card.dataset.id];
      if (item) openPlayer(item);
    }
  });

  related.addEventListener("click", function (e) {
    var rel = e.target.closest(".yl-rel");
    if (!rel) return;
    var item = itemsById[rel.dataset.id];
    if (item) openPlayer(item);
  });

  uploadBtn.addEventListener("click", function () { fileInput.click(); });

  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (!file) return;
    var guessTitle = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
    var title = window.prompt("Titel für diese Datei:", guessTitle);
    if (title === null) { fileInput.value = ""; return; }
    uploadBtn.disabled = true;
    uploadLabel.textContent = "Lädt hoch …";
    var thumbReady = file.type.indexOf("video/") === 0 ? makeVideoThumb(file) : Promise.resolve(null);
    thumbReady
      .then(function (thumb) {
        var fd = new FormData();
        fd.append("file", file);
        fd.append("title", title);
        if (thumb) fd.append("thumb", thumb, "thumb.jpg");
        return fetch("/api/ylib/items", { method: "POST", body: fd });
      })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) {
          window.alert(errorText(j, "Hochladen ging nicht."));
        } else {
          loadItems();
        }
      })
      .catch(function () { window.alert("Hochladen ging nicht."); })
      .finally(function () {
        uploadBtn.disabled = false;
        uploadLabel.textContent = "Hochladen";
        fileInput.value = "";
      });
  });

  youtubeBtn.addEventListener("click", function () {
    var url = window.prompt("Link zu einem YouTube-Video einfügen:", "");
    if (!url) return;
    youtubeBtn.disabled = true;
    fetch("/api/ylib/youtube", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: url }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) {
        window.alert(errorText(j, "Ging nicht."));
      } else {
        loadItems();
      }
    }).catch(function () { window.alert("Ging nicht."); })
      .finally(function () { youtubeBtn.disabled = false; });
  });

  loadItems();
})();
