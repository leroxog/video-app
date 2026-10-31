/* Satürn video download (yipi-download.js): "Video speichern" -- like on TikTok the saved video carries a watermark, the Satürn logo with the name of
   whoever made it (@name). It first sits in the top left corner, in the second half it slides over to the bottom right one. The server sends the
   file as it is; the page plays it once (as fast as it is long), draws every picture together with the watermark on a canvas and records that with
   the recorder of the browser, with the sound of the video. Nothing leaves the device. While it works a small card shows how far it is and has a
   button to cancel. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const { h, toast } = Y;

  const LOGO_PATH = "M11.8 33.7L22.8 33.7L27.8 19.4L36.2 46.3L41.2 30.3L45.4 33.7L52.2 33.7";   // the heartbeat of static/img/pulse-icon.svg (64 x 64)
  const LONG_EDGE = 1280;                                       // bigger videos are saved a bit smaller (the recording runs in real time)
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  let busy = false;

  /* The best format the browser's recorder makes (webm where it can, mp4 on Safari), "" when it cannot record at all. */
  function pickRecorderType() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    return ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((type) => MediaRecorder.isTypeSupported(type)) || "";
  }

  function roundedRect(ctx, x, y, w, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hh, r);
    ctx.arcTo(x + w, y + hh, x, y + hh, r);
    ctx.arcTo(x, y + hh, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const planet = new Image();                                     // the planet of Satürn (loaded once; until it is there the old tile is drawn)
  planet.src = "/static/img/saturn-mark.png";

  /* The watermark: the planet of Satürn (a white tile with the planet in it, so it shows on every video), "Satürn" and "@name" next to it. */
  function drawMark(ctx, plan, handle, logo) {
    const tile = plan.h;
    const left = plan.x + tile * 1.16;
    const room = plan.w - tile * 1.16;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.shadowColor = "rgba(0, 0, 0, 0.6)";
    ctx.shadowBlur = tile * 0.16;
    roundedRect(ctx, plan.x, plan.y, tile, tile, tile * 0.26);
    const withPlanet = planet.complete && planet.naturalWidth > 0;
    ctx.fillStyle = withPlanet ? "#fff" : "#000";
    ctx.fill();
    ctx.shadowColor = "transparent";
    if (withPlanet) {
      const side = tile * 0.8;
      const high = side * planet.naturalHeight / planet.naturalWidth;
      ctx.drawImage(planet, plan.x + (tile - side) / 2, plan.y + (tile - high) / 2, side, high);
    } else {
      ctx.strokeStyle = "#767676";
      ctx.lineWidth = Math.max(1, tile * 0.024);
      ctx.stroke();
      ctx.save();
      ctx.translate(plan.x, plan.y);
      ctx.scale(tile / 64, tile / 64);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 5.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(logo);
      ctx.restore();
    }
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = tile * 0.14;
    ctx.fillStyle = "#fff";
    ctx.textBaseline = "alphabetic";
    let size = tile * 0.5;
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.fillText("Satürn", left, plan.y + tile * 0.47);
    size = tile * 0.34;
    ctx.font = `700 ${size}px ${FONT}`;
    const text = `@${handle}`;
    const width = ctx.measureText(text).width;
    if (width > room) { size *= room / width; ctx.font = `700 ${size}px ${FONT}`; }
    ctx.fillText(text, left, plan.y + tile * 0.9);
    ctx.restore();
  }

  /* The length of the video; recordings from the camera have none in their header, there the browser is asked to jump to the end once. */
  async function knownLength(video) {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    await new Promise((resolve) => {
      const finish = () => { video.removeEventListener("durationchange", check); clearTimeout(timer); resolve(); };
      const check = () => { if (Number.isFinite(video.duration)) { video.currentTime = 0; finish(); } };
      const timer = setTimeout(finish, 3000);
      video.addEventListener("durationchange", check);
      video.currentTime = 1e7;
    });
    return Number.isFinite(video.duration) ? video.duration : 0;
  }

  function panel(onCancel) {
    const fillBar = h("span", { class: "save-fill" });
    const label = h("span", { class: "save-label" }, "Video wird vorbereitet …");
    const cancel = h("button", { class: "save-cancel", type: "button", onclick: onCancel }, "Abbrechen");
    const box = h("div", { class: "save-panel", role: "status", "aria-live": "polite" },
      h("div", { class: "save-row" }, label, cancel),
      h("span", { class: "save-bar" }, fillBar),
      h("span", { class: "save-hint" }, "Bitte lass diese Seite offen, bis es fertig ist."));
    document.body.append(box);
    return {
      set(share) { fillBar.style.width = `${Math.round(share * 100)}%`; label.textContent = `Video wird gespeichert … ${Math.round(share * 100)} %`; },
      close() { box.remove(); },
    };
  }

  function saveFile(blob, name) {
    const address = URL.createObjectURL(blob);
    const anchor = h("a", { href: address, download: name, rel: "noopener" });
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(address), 60000);
  }

  async function downloadVideo(item) {
    const media = item && item.media && item.media.find((entry) => entry.video);
    if (!media) return;
    if (busy) { toast("Ein Video wird gerade gespeichert."); return; }
    const type = pickRecorderType();
    if (!type || !HTMLCanvasElement.prototype.captureStream) { toast("Dieser Browser kann das Video nicht mit Wasserzeichen speichern."); return; }
    busy = true;

    const video = document.createElement("video");
    video.playsInline = true;
    video.preload = "auto";
    video.src = media.url;
    let cancelled = false;
    let timer = 0;
    let recorder = null;
    let audioContext = null;
    const ui = panel(() => { cancelled = true; stop(); });

    // The sound: the video is routed into the recording only (nothing comes out of the speakers).
    let audioTrack = null;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context) {
        audioContext = new Context();
        const source = audioContext.createMediaElementSource(video);
        const sink = audioContext.createMediaStreamDestination();
        source.connect(sink);
        audioTrack = sink.stream.getAudioTracks()[0] || null;
        audioContext.resume?.().catch(() => {});
      }
    } catch (error) { audioTrack = null; }

    const chunks = [];
    function stop() {
      clearInterval(timer);
      video.pause();
      if (recorder && recorder.state !== "inactive") recorder.stop(); else finish(null);
    }
    let done = false;
    function finish(blob) {
      if (done) return;
      done = true;
      clearInterval(timer);
      video.pause();
      video.removeAttribute("src");
      video.load();
      audioContext?.close?.().catch(() => {});
      ui.close();
      busy = false;
      if (cancelled) { toast("Speichern abgebrochen."); return; }
      if (!blob || !blob.size) { toast("Das Video konnte nicht gespeichert werden."); return; }
      saveFile(blob, Core.videoFileName(item.user.handle, blob.type || type));
      Y.sound?.play("success");
      toast("Video gespeichert");
    }

    try {
      await new Promise((resolve, reject) => {
        video.addEventListener("loadedmetadata", resolve, { once: true });
        video.addEventListener("error", () => reject(new Error("load")), { once: true });
        setTimeout(() => reject(new Error("slow")), 20000);
      });
      const total = await knownLength(video);
      const scale = Math.min(1, LONG_EDGE / Math.max(video.videoWidth || 1, video.videoHeight || 1));
      const width = Math.max(2, Math.round((video.videoWidth || 720) * scale / 2) * 2);
      const height = Math.max(2, Math.round((video.videoHeight || 1280) * scale / 2) * 2);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const logo = new Path2D(LOGO_PATH);
      const stream = canvas.captureStream(30);
      if (audioTrack) stream.addTrack(audioTrack);
      recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3000000, audioBitsPerSecond: 128000 });
      recorder.addEventListener("dataavailable", (event) => { if (event.data && event.data.size) chunks.push(event.data); });
      recorder.addEventListener("stop", () => finish(cancelled || !chunks.length ? null : new Blob(chunks, { type: recorder.mimeType || type })));
      const started = performance.now();
      const draw = () => {
        const seen = total ? video.currentTime / total : Math.min(0.95, video.currentTime / Core.MAX_VIDEO_SECONDS);
        ctx.drawImage(video, 0, 0, width, height);
        drawMark(ctx, Core.watermarkPlan(width, height, seen), item.user.handle, logo);
        ui.set(Math.max(0, Math.min(1, seen)));
        if (performance.now() - started > ((total || Core.MAX_VIDEO_SECONDS) + 8) * 1000) stop();   // never runs forever
      };
      video.addEventListener("ended", () => { draw(); setTimeout(stop, 250); }, { once: true });
      video.currentTime = 0;
      draw();
      recorder.start(500);
      video.muted = false;
      video.volume = 1;
      await video.play();
      timer = setInterval(draw, 1000 / 30);
    } catch (error) {
      cancelled = false;
      clearInterval(timer);
      if (recorder && recorder.state !== "inactive") { try { recorder.stop(); } catch (stopError) { /* gone */ } }
      finish(null);
    }
  }

  Object.assign(Y, { downloadVideo, pickRecorderType });
})();
