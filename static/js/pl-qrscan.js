(function () {
  "use strict";
  // QR scanning via the native BarcodeDetector API (Chrome/Edge/Android) --
  // no vendored decoding library. Where the browser can't do this (mostly
  // Safari/iOS today), `supported()` is false and callers should just hide
  // the "Scannen" button, leaving manual code entry as the only path --
  // never a silently-broken button.
  function supported() {
    return "BarcodeDetector" in window;
  }

  function open() {
    return new Promise(function (resolve) {
      if (!supported()) { resolve(null); return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
        .then(function (stream) { build(stream, resolve); })
        .catch(function () { resolve(null); });
    });
  }

  function build(stream, resolve) {
    var back = document.createElement("div");
    back.className = "pl-cam-back";
    back.innerHTML =
      '<video class="pl-cam-video" autoplay playsinline muted></video>' +
      '<button type="button" class="pl-cam-close" aria-label="Schließen">&times;</button>' +
      '<div class="pl-qrscan-frame"></div>' +
      '<div class="pl-qrscan-hint">QR-Code in den Rahmen halten</div>';
    document.body.appendChild(back);
    document.body.style.overflow = "hidden";

    var video = back.querySelector(".pl-cam-video");
    video.srcObject = stream;
    var closed = false;
    var detector = new BarcodeDetector({ formats: ["qr_code"] });

    function cleanup() {
      if (closed) return;
      closed = true;
      stream.getTracks().forEach(function (t) { t.stop(); });
      document.body.removeChild(back);
      document.body.style.overflow = "";
    }

    back.querySelector(".pl-cam-close").addEventListener("click", function () { cleanup(); resolve(null); });

    function tick() {
      if (closed) return;
      detector.detect(video).then(function (codes) {
        if (closed) return;
        if (codes.length) { cleanup(); resolve(codes[0].rawValue); }
        else requestAnimationFrame(tick);
      }).catch(function () { if (!closed) requestAnimationFrame(tick); });
    }
    video.addEventListener("loadedmetadata", function () { requestAnimationFrame(tick); });
  }

  window.PlQrScan = { open: open, supported: supported };
})();
