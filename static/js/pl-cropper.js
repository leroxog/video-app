/* Reusable image cropper -- used wherever a profile picture / banner is
   picked (registration wizard, profile edit sheet, server icon, ...) so
   people can choose what part of the photo actually ends up visible
   instead of getting a raw, possibly badly-framed upload.
   Usage: window.PlCropper.open(file, {aspect: 1, shape: "circle"}).then(function (blob) { ... });
   `blob` is null if the user cancelled. */
(function () {
  "use strict";

  function open(file, opts) {
    opts = opts || {};
    var aspect = opts.aspect || 1;
    var shape = opts.shape || "rect";
    var outW = opts.outW || (shape === "circle" ? 512 : 1200);
    var outH = Math.round(outW / aspect);

    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { build(img, url, resolve); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });

    function build(img, url, resolve) {
      var back = document.createElement("div");
      back.className = "pl-crop-back";
      var vpW = Math.min(340, window.innerWidth - 64);
      var vpH = Math.round(vpW / aspect);

      back.innerHTML =
        '<div class="pl-crop-card">' +
          '<h3>' + (opts.title || "Bild zuschneiden") + '</h3>' +
          '<div class="pl-crop-viewport' + (shape === "circle" ? " round" : "") + '" style="width:' + vpW + 'px;height:' + vpH + 'px;">' +
            '<img class="pl-crop-img" draggable="false" alt="">' +
          '</div>' +
          '<input type="range" class="pl-crop-zoom" min="1" max="3" step="0.01" value="1">' +
          '<div class="pl-crop-actions">' +
            '<button type="button" class="pl-crop-cancel">Abbrechen</button>' +
            '<button type="button" class="pl-crop-ok">&Uuml;bernehmen</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(back);
      document.body.style.overflow = "hidden";

      var viewport = back.querySelector(".pl-crop-viewport");
      var imgEl = back.querySelector(".pl-crop-img");
      var zoomEl = back.querySelector(".pl-crop-zoom");
      imgEl.src = img.src;

      var natW = img.naturalWidth, natH = img.naturalHeight;
      var coverScale = Math.max(vpW / natW, vpH / natH);
      var zoom = 1, tx = 0, ty = 0;

      function scale() { return coverScale * zoom; }
      function clamp() {
        var s = scale(), dispW = natW * s, dispH = natH * s;
        tx = Math.min(0, Math.max(vpW - dispW, tx));
        ty = Math.min(0, Math.max(vpH - dispH, ty));
      }
      function render() {
        var s = scale();
        imgEl.style.width = (natW * s) + "px";
        imgEl.style.height = (natH * s) + "px";
        imgEl.style.transform = "translate(" + tx + "px," + ty + "px)";
      }
      function centerInit() {
        var s = scale();
        tx = (vpW - natW * s) / 2;
        ty = (vpH - natH * s) / 2;
        clamp();
        render();
      }
      centerInit();

      zoomEl.addEventListener("input", function () {
        var oldS = scale();
        // keep the viewport's centre point anchored while zooming
        var cx = (vpW / 2 - tx) / oldS, cy = (vpH / 2 - ty) / oldS;
        zoom = parseFloat(zoomEl.value);
        var newS = scale();
        tx = vpW / 2 - cx * newS;
        ty = vpH / 2 - cy * newS;
        clamp();
        render();
      });

      var dragging = false, startX = 0, startY = 0, startTx = 0, startTy = 0;
      viewport.addEventListener("pointerdown", function (e) {
        dragging = true;
        startX = e.clientX; startY = e.clientY; startTx = tx; startTy = ty;
        viewport.setPointerCapture(e.pointerId);
      });
      viewport.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        tx = startTx + (e.clientX - startX);
        ty = startTy + (e.clientY - startY);
        clamp();
        render();
      });
      function endDrag() { dragging = false; }
      viewport.addEventListener("pointerup", endDrag);
      viewport.addEventListener("pointercancel", endDrag);

      function cleanup() {
        document.body.removeChild(back);
        document.body.style.overflow = "";
        URL.revokeObjectURL(url);
      }
      back.querySelector(".pl-crop-cancel").addEventListener("click", function () { cleanup(); resolve(null); });
      back.addEventListener("click", function (e) { if (e.target === back) { cleanup(); resolve(null); } });
      back.querySelector(".pl-crop-ok").addEventListener("click", function () {
        var s = scale();
        var sx = -tx / s, sy = -ty / s, sw = vpW / s, sh = vpH / s;
        var canvas = document.createElement("canvas");
        canvas.width = outW; canvas.height = outH;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        canvas.toBlob(function (blob) {
          cleanup();
          resolve(blob);
        }, "image/jpeg", 0.92);
      });
    }
  }

  window.PlCropper = { open: open };
})();
