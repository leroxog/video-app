(function () {
  "use strict";
  var uploadBtn = document.getElementById("ylUploadBtn");
  var youtubeBtn = document.getElementById("ylYoutubeBtn");
  var fileInput = document.getElementById("ylFileInput");
  var body = document.getElementById("ylBody");
  var grid = document.getElementById("ylGrid");
  var player = document.getElementById("ylPlayer");
  var stage = document.getElementById("ylStage");
  var playerTitle = document.getElementById("ylPlayerTitle");
  var playerMeta = document.getElementById("ylPlayerMeta");
  var backBtn = document.getElementById("ylBackBtn");

  var itemsById = {};

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function timeLabel(iso) {
    var d = new Date(iso);
    var diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "gerade eben hochgeladen";
    if (diffMin < 60) return "vor " + diffMin + " Min. hochgeladen";
    if (diffMin < 1440) return "vor " + Math.round(diffMin / 60) + " Std. hochgeladen";
    return "hochgeladen am " + d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var TRASH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
  var EMPTY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 15 5-5 4 4 3-3 6 6"/></svg>';

  function renderGrid(items) {
    itemsById = {};
    items.forEach(function (it) { itemsById[it.id] = it; });
    if (!items.length) {
      grid.innerHTML = '<div class="yl-empty" style="grid-column: 1/-1">' + EMPTY_ICON
        + '<div>Noch nichts hier -- lade eine Datei hoch oder füge einen YouTube-Link hinzu.</div></div>';
      return;
    }
    grid.innerHTML = items.map(function (it) {
      var thumb;
      if (it.source === "youtube") {
        thumb = '<div class="yl-thumb"><img src="' + esc(it.thumbnail_url) + '" alt="" loading="lazy"><span class="yl-badge">YouTube</span></div>';
      } else if (it.kind === "video") {
        thumb = '<div class="yl-thumb is-video">' + PLAY_ICON + '<span class="yl-badge">Video</span></div>';
      } else {
        thumb = '<div class="yl-thumb"><img src="' + esc(it.url) + '" alt="" loading="lazy"></div>';
      }
      return '<div class="yl-card" data-id="' + it.id + '">'
        + thumb
        + '<button class="yl-del" data-del="' + it.id + '" aria-label="Löschen" title="Löschen">' + TRASH_ICON + '</button>'
        + '<div class="yl-info"><div class="title"></div><div class="meta">' + timeLabel(it.created_at) + '</div></div>'
        + '</div>';
    }).join("");
    grid.querySelectorAll(".yl-card").forEach(function (el, i) {
      el.querySelector(".title").textContent = items[i].title;
    });
  }

  function loadItems() {
    fetch("/api/ylib/items").then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) renderGrid(j.items);
    });
  }

  function openPlayer(item) {
    if (item.source === "youtube") {
      stage.innerHTML = '<iframe style="width:100%;aspect-ratio:16/9;border:none;display:block"'
        + ' src="https://www.youtube.com/embed/' + esc(item.youtube_video_id) + '?autoplay=1"'
        + ' allow="autoplay; encrypted-media" allowfullscreen></iframe>';
    } else {
      stage.innerHTML = item.kind === "video"
        ? '<video src="' + esc(item.url) + '" controls autoplay></video>'
        : '<img src="' + esc(item.url) + '" alt="">';
    }
    playerTitle.textContent = item.title;
    playerMeta.textContent = timeLabel(item.created_at);
    body.classList.add("in-player");
    player.classList.add("active");
  }

  function closePlayer() {
    body.classList.remove("in-player");
    player.classList.remove("active");
    stage.innerHTML = "";
  }

  backBtn.addEventListener("click", closePlayer);

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

  uploadBtn.addEventListener("click", function () { fileInput.click(); });

  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (!file) return;
    var guessTitle = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
    var title = window.prompt("Titel für diese Datei:", guessTitle);
    if (title === null) { fileInput.value = ""; return; }
    var fd = new FormData();
    fd.append("file", file);
    fd.append("title", title);
    uploadBtn.disabled = true;
    uploadBtn.textContent = "Lädt hoch …";
    fetch("/api/ylib/items", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) {
          window.alert(j.error === "bad_type"
            ? "Dieser Dateityp wird nicht unterstützt. Erlaubt: Bilder (png/jpg/gif/webp) und Videos (mp4/webm/ogg/mov)."
            : "Hochladen ging nicht.");
        } else {
          loadItems();
        }
      })
      .catch(function () { window.alert("Hochladen ging nicht."); })
      .finally(function () {
        uploadBtn.disabled = false;
        uploadBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m0-13 5 5m-5-5-5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>Hochladen';
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
        window.alert(j.error === "invalid_url" ? "Das sieht nicht nach einem YouTube-Link aus." : "Ging nicht.");
      } else {
        loadItems();
      }
    }).catch(function () { window.alert("Ging nicht."); })
      .finally(function () { youtubeBtn.disabled = false; });
  });

  loadItems();
})();
