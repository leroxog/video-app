(function () {
  "use strict";
  var info = window.NRS_GAME;
  var frame = document.getElementById("pgFrame");
  var views = document.getElementById("pgViews");
  var reportBtn = document.getElementById("pgReportBtn");
  var pop = document.getElementById("pgReportPop");

  function post(url, body) {
    return fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  document.getElementById("pgFullscreen").addEventListener("click", function () {
    if (frame.requestFullscreen) frame.requestFullscreen();
  });

  // A play counts after a few seconds on the page, so a quick bounce doesn't inflate the numbers.
  if (info.published) {
    setTimeout(function () {
      post("/api/play/games/" + info.id + "/view").then(function (j) {
        if (j.ok && j.counted) views.textContent = j.views;
      });
    }, 4000);
  }

  if (reportBtn) {
    reportBtn.addEventListener("click", function () { pop.hidden = !pop.hidden; });
    document.getElementById("pgReportSend").addEventListener("click", function () {
      post("/api/play/games/" + info.id + "/report", { reason: document.getElementById("pgReportReason").value })
        .then(function (j) {
          if (j.ok) document.getElementById("pgReportDone").hidden = false;
        });
    });
  }
})();
