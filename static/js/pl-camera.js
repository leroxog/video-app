(function () {
  "use strict";

  function open() {
    return new Promise(function (resolve) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        fallbackFilePicker(resolve);
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
        .then(function (stream) { build(stream, resolve); })
        .catch(function () { fallbackFilePicker(resolve); });
    });
  }

  function fallbackFilePicker(resolve) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.addEventListener("change", function () {
      resolve(input.files[0] || null);
    });
    input.click();
  }

  function build(stream, resolve) {
    var back = document.createElement("div");
    back.className = "pl-cam-back";
    back.innerHTML =
      '<video class="pl-cam-video" autoplay playsinline muted></video>' +
      '<canvas class="pl-cam-canvas" hidden></canvas>' +
      '<button type="button" class="pl-cam-close" aria-label="Schließen">&times;</button>' +
      '<div class="pl-cam-actions">' +
        '<button type="button" class="pl-cam-upload" aria-label="Bild hochladen">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>' +
        '</button>' +
        '<button type="button" class="pl-cam-shutter" aria-label="Aufnehmen"></button>' +
        '<button type="button" class="pl-cam-flip" aria-label="Kamera wechseln">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12a10 10 0 0 1 16.9-7.2M22 12a10 10 0 0 1-16.9 7.2"/><path d="M19 2v5h-5M5 22v-5h5"/></svg>' +
        '</button>' +
      '</div>';
    document.body.appendChild(back);
    document.body.style.overflow = "hidden";

    var video = back.querySelector(".pl-cam-video");
    video.srcObject = stream;
    var facing = "user";
    var closed = false;

    function cleanup() {
      if (closed) return;
      closed = true;
      stream.getTracks().forEach(function (t) { t.stop(); });
      document.body.removeChild(back);
      document.body.style.overflow = "";
    }

    back.querySelector(".pl-cam-close").addEventListener("click", function () {
      cleanup();
      resolve(null);
    });

    back.querySelector(".pl-cam-upload").addEventListener("click", function () {
      cleanup();
      fallbackFilePicker(resolve);
    });

    back.querySelector(".pl-cam-flip").addEventListener("click", function () {
      facing = facing === "user" ? "environment" : "user";
      stream.getTracks().forEach(function (t) { t.stop(); });
      navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false })
        .then(function (newStream) {
          stream = newStream;
          video.srcObject = stream;
        })
        .catch(function () {});
    });

    back.querySelector(".pl-cam-shutter").addEventListener("click", function () {
      var canvas = back.querySelector(".pl-cam-canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        cleanup();
        if (!blob) { resolve(null); return; }
        resolve(new File([blob], "story.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.92);
    });
  }

  window.PlCamera = { open: open };
})();
