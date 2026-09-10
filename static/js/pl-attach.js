/* Shared attachment picker + renderer for HEXAGONUM composers.
   window.PlAttach.mount(containerEl) -> { get(), clear(), raw(), el }
   window.PlAttach.html(att) -> HTML string for a saved attachment */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function html(att) {
    if (!att || !att.kind) return "";
    if (att.kind === "image") return '<div class="pl-att pl-att-image"><img src="' + esc(att.url) + '" loading="lazy" alt="Foto"></div>';
    if (att.kind === "video") return '<div class="pl-att pl-att-video"><video src="' + esc(att.url) + '" controls preload="metadata" playsinline></video></div>';
    return "";
  }

  function mount(container) {
    var att = null;                 // { kind, value, url }

    var bar = document.createElement("div");
    bar.className = "pl-attbar";
    bar.innerHTML =
      '<button type="button" class="pl-attbtn" data-a="photo" title="Foto/Video">📷</button>'
      + '<div class="pl-attprev" hidden></div>'
      + '<input type="file" class="pl-attfile" accept="image/*,video/*" hidden>';
    container.appendChild(bar);

    var fileInput = bar.querySelector(".pl-attfile");
    var prev = bar.querySelector(".pl-attprev");

    function clear() {
      att = null;
      prev.hidden = true;
      prev.innerHTML = "";
      fileInput.value = "";
    }

    function showPrev() {
      if (!att) return;
      var inner = att.kind === "image"
        ? '<img src="' + esc(att.url) + '" alt="">'
        : '<span class="pl-attchip">🎬 Video</span>';
      prev.innerHTML = inner + '<button type="button" class="pl-attx" aria-label="Entfernen">&times;</button>';
      prev.hidden = false;
    }

    bar.querySelector('[data-a="photo"]').addEventListener("click", function () {
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
