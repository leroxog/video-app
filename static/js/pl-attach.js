/* Shared attachment picker + renderer for pinklemon composers.
   window.PlAttach.mount(containerEl) -> { get(), clear(), el }
   window.PlAttach.html(att) -> HTML string for a saved attachment */
(function () {
  "use strict";

  var gamesCache = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function html(att) {
    if (!att || !att.kind) return "";
    if (att.kind === "image") return '<div class="pl-att pl-att-image"><img src="' + esc(att.url) + '" loading="lazy" alt="Foto"></div>';
    if (att.kind === "video") return '<div class="pl-att pl-att-video"><video src="' + esc(att.url) + '" controls preload="metadata" playsinline></video></div>';
    if (att.kind === "game") {
      var url = att.url || ("/spiele/" + att.value);
      return '<div class="pl-att pl-att-game"><div class="pl-att-game">'
        + '<div class="pl-att-game-bar">🎮 ' + esc(att.title || "Spiel") + '</div>'
        + '<iframe src="' + esc(url) + '" loading="lazy" title="' + esc(att.title || "Spiel") + '"></iframe>'
        + '</div></div>';
    }
    return "";
  }

  function loadGames() {
    if (gamesCache) return Promise.resolve(gamesCache);
    return fetch("/api/pl/games").then(function (r) { return r.json(); }).then(function (j) {
      gamesCache = (j && j.games) || [];
      return gamesCache;
    }).catch(function () { return []; });
  }

  function mount(container) {
    var att = null;                 // { kind, value, url, title }

    var bar = document.createElement("div");
    bar.className = "pl-attbar";
    bar.innerHTML =
      '<button type="button" class="pl-attbtn" data-a="photo" title="Foto/Video">📷</button>'
      + '<button type="button" class="pl-attbtn" data-a="game" title="Spiel">🎮</button>'
      + '<div class="pl-attmenu" hidden></div>'
      + '<div class="pl-attprev" hidden></div>'
      + '<input type="file" class="pl-attfile" accept="image/*,video/*" hidden>';
    container.appendChild(bar);

    var fileInput = bar.querySelector(".pl-attfile");
    var menu = bar.querySelector(".pl-attmenu");
    var prev = bar.querySelector(".pl-attprev");

    function clear() {
      att = null;
      prev.hidden = true;
      prev.innerHTML = "";
      menu.hidden = true;
      fileInput.value = "";
    }

    function showPrev() {
      if (!att) return;
      var inner = att.kind === "image"
        ? '<img src="' + esc(att.url) + '" alt="">'
        : att.kind === "video"
          ? '<span class="pl-attchip">🎬 Video</span>'
          : '<span class="pl-attchip">🎮 ' + esc(att.title || "Spiel") + '</span>';
      prev.innerHTML = inner + '<button type="button" class="pl-attx" aria-label="Entfernen">&times;</button>';
      prev.hidden = false;
    }

    bar.querySelector('[data-a="photo"]').addEventListener("click", function () {
      menu.hidden = true;
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var fd = new FormData();
      fd.append("file", f);
      prev.hidden = false;
      prev.innerHTML = '<span class="pl-attchip">… lädt</span>';
      fetch("/api/pl/upload", { method: "POST", body: fd })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.ok) { clear(); (window.plToast || function () {})("Datei ging nicht."); return; }
          att = { kind: j.kind, value: j.value, url: j.url };
          showPrev();
        })
        .catch(function () { clear(); });
    });

    bar.querySelector('[data-a="game"]').addEventListener("click", function () {
      if (!menu.hidden) { menu.hidden = true; return; }
      menu.innerHTML = '<div class="pl-attmenu-load">…</div>';
      menu.hidden = false;
      loadGames().then(function (games) {
        menu.innerHTML = games.map(function (g) {
          return '<button type="button" class="pl-attgame" data-slug="' + esc(g.slug) + '">🎮 ' + esc(g.title) + '</button>';
        }).join("") || '<div class="pl-attmenu-load">Keine Spiele</div>';
      });
    });

    menu.addEventListener("click", function (e) {
      var b = e.target.closest(".pl-attgame");
      if (!b) return;
      var slug = b.dataset.slug;
      var g = (gamesCache || []).find(function (x) { return x.slug === slug; });
      att = { kind: "game", value: slug, url: "/spiele/" + slug, title: g ? g.title : "Spiel" };
      menu.hidden = true;
      showPrev();
    });

    prev.addEventListener("click", function (e) {
      if (e.target.closest(".pl-attx")) clear();
    });

    return {
      el: bar,
      clear: clear,
      raw: function () { return att; },
      get: function () {
        return att ? { att_kind: att.kind, att_value: att.value } : {};
      },
    };
  }

  window.PlAttach = { mount: mount, html: html };
})();
