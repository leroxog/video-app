(function () {
  "use strict";
  var form = document.getElementById("lkForm");
  var input = document.getElementById("lkInput");
  var goBtn = document.getElementById("lkGo");
  var errorBox = document.getElementById("lkError");
  var result = document.getElementById("lkResult");
  var stage = document.getElementById("lkStage");
  var titleEl = document.getElementById("lkTitle");
  var addBtn = document.getElementById("lkAdd");
  var openLink = document.getElementById("lkOpen");
  var statusEl = document.getElementById("lkStatus");

  var ID_RE = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,15})/;
  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var ADD_ERRORS = {
    limit_reached: "Das Limit von 50 Einträgen ist erreicht.",
    invalid_url: "Das sieht nicht nach einem YouTube-Link aus.",
  };

  var current = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function setError(msg) { errorBox.textContent = msg || ""; }

  function showStage(preview) {
    stage.innerHTML = '<img src="' + esc(preview.thumbnail_url) + '" alt="">'
      + '<button type="button" class="lk-play" aria-label="Abspielen">' + PLAY_ICON + '</button>';
  }

  function play() {
    if (!current) return;
    stage.innerHTML = '<iframe src="https://www.youtube.com/embed/' + esc(current.video_id) + '?autoplay=1"'
      + ' allow="autoplay; encrypted-media" allowfullscreen></iframe>';
  }

  function load(url) {
    var match = ID_RE.exec(url);
    if (!match) { setError("Das sieht nicht nach einem YouTube-Link aus."); return; }
    setError("");
    goBtn.disabled = true;
    fetch("/api/link/preview?url=" + encodeURIComponent(url))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) { setError("Das sieht nicht nach einem YouTube-Link aus."); return; }
        current = { video_id: j.video_id, url: "https://www.youtube.com/watch?v=" + j.video_id };
        showStage(j);
        titleEl.textContent = j.title;
        openLink.href = current.url;
        statusEl.textContent = "";
        addBtn.disabled = false;
        result.classList.add("active");
        result.scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
      .catch(function () { setError("Ging nicht -- versuch es gleich nochmal."); })
      .finally(function () { goBtn.disabled = false; });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var url = input.value.trim();
    if (!url) { setError("Füge zuerst einen YouTube-Link ein."); return; }
    load(url);
  });

  stage.addEventListener("click", function (e) {
    if (e.target.closest(".lk-play")) play();
  });

  addBtn.addEventListener("click", function () {
    if (!current) return;
    addBtn.disabled = true;
    statusEl.textContent = "";
    fetch("/api/ylib/youtube", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: current.url }),
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (j.ok) {
        statusEl.textContent = "Zur Mediathek hinzugefügt.";
      } else {
        statusEl.textContent = ADD_ERRORS[j.error] || "Ging nicht.";
        addBtn.disabled = false;
      }
    }).catch(function () {
      statusEl.textContent = "Ging nicht.";
      addBtn.disabled = false;
    });
  });

  document.querySelectorAll(".lk-ex").forEach(function (row) {
    var url = row.querySelector(".lk-ex-url");
    row.querySelector(".lk-ex-name").addEventListener("dblclick", function () {
      url.hidden = !url.hidden;
    });
    row.querySelector(".lk-ex-thumb").addEventListener("click", function () {
      var link = "https://www.youtube.com/watch?v=" + row.dataset.id;
      input.value = link;
      load(link);
    });
  });
})();
