/* Nex QR codes (yipi-qr.js): a QR code for almost everything -- the whole page, a profile, a post or video, a lens or a game of the camera -- drawn in purple soft squares with the
   Nex heartbeat in the middle, to save, share or scan. The code itself is made by a small free library (static/js/vendor/qrcode.js, MIT) and read by another one
   (jsqr.js, Apache 2.0) or by the browser's own reader when it has one; both are loaded when the first code is shown. Scanning happens on the device: the camera picture goes nowhere.
   A code that points to Nex opens in the app; any other address is only shown (and opened if the person says so). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const { h, fill, icon, toast, dialog } = Y;
  const TAU = Math.PI * 2;

  let assets = {};
  try { assets = JSON.parse(document.getElementById("yipiAssets").textContent) || {}; } catch (error) { assets = {}; }
  const loading = new Map();
  function loadScript(src) {
    if (!src) return Promise.reject(new Error("no address"));
    if (!loading.has(src)) {
      loading.set(src, new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = src;
        tag.onload = () => resolve();
        tag.onerror = () => { loading.delete(src); tag.remove(); reject(new Error("could not load")); };
        document.head.append(tag);
      }));
    }
    return loading.get(src);
  }

  const absolute = (path) => `${location.origin}${path}`;

  /* The dark and light squares of the code for a text (error correction "H": a good part may be covered, e.g. by the logo). */
  async function matrix(text) {
    await loadScript(assets.qr);
    const code = window.qrcode(0, "H");
    code.addData(String(text), "Byte");
    code.make();
    const count = code.getModuleCount();
    return { count, dark: (row, col) => code.isDark(row, col) };
  }

  function roundedRect(g, x, y, w, h2, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h2, r); else g.rect(x, y, w, h2); }

  /* The heartbeat of Nex on its black tile (the same drawing as the logo of the page). */
  function drawLogo(g, x, y, size) {
    g.save();
    g.translate(x, y);
    g.scale(size / 64, size / 64);
    g.fillStyle = "#000";
    roundedRect(g, 0, 0, 64, 64, 16);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 5.4;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    [[11.8, 33.7], [22.8, 33.7], [27.8, 19.4], [36.2, 46.3], [41.2, 30.3], [45.4, 33.7], [52.2, 33.7]].forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
    g.stroke();
    g.restore();
  }

  /* The code as a picture: white card, purple soft squares, rounded finder squares, the logo in the middle (a test reads it back with jsQR). */
  function draw(m, size = 720, { logo = true, colors = ["#4b21c9", "#c13ac9"] } = {}) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext("2d");
    const quiet = 2;
    const n = m.count;
    const cell = size / (n + quiet * 2);
    g.fillStyle = "#fff";
    roundedRect(g, 0, 0, size, size, size * 0.07);
    g.fill();
    const paint = g.createLinearGradient(0, 0, size, size);
    paint.addColorStop(0, colors[0]);
    paint.addColorStop(1, colors[1]);
    const inFinder = (row, col) => (row < 8 && col < 8) || (row < 8 && col >= n - 8) || (row >= n - 8 && col < 8);
    const half = logo ? Math.ceil(n * 0.115) + 1 : 0;                      // modules around the middle that stay free for the logo
    const middle = n / 2;
    g.fillStyle = paint;
    for (let row = 0; row < n; row += 1) {
      for (let col = 0; col < n; col += 1) {
        if (!m.dark(row, col) || inFinder(row, col)) continue;
        if (logo && Math.abs(row + 0.5 - middle) < half && Math.abs(col + 0.5 - middle) < half) continue;
        roundedRect(g, (col + quiet) * cell + cell * 0.03, (row + quiet) * cell + cell * 0.03, cell * 0.94, cell * 0.94, cell * 0.3);       // soft squares: round dots are too hard for some readers
        g.fill();
      }
    }
    for (const [row, col] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const x = (col + quiet) * cell;
      const y = (row + quiet) * cell;
      g.fillStyle = paint; roundedRect(g, x, y, 7 * cell, 7 * cell, 2.2 * cell); g.fill();
      g.fillStyle = "#fff"; roundedRect(g, x + cell, y + cell, 5 * cell, 5 * cell, 1.5 * cell); g.fill();
      g.fillStyle = paint; roundedRect(g, x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell, 1.1 * cell); g.fill();
    }
    if (logo) {
      const box = 2 * half * cell * 0.94;
      const x = (size - box) / 2;
      g.fillStyle = "#fff";
      roundedRect(g, x - cell * 0.5, x - cell * 0.5, box + cell, box + cell, cell * 2);
      g.fill();
      drawLogo(g, x + cell * 0.35, x + cell * 0.35, box - cell * 0.7);
    }
    return canvas;
  }

  async function make(text, options) { return draw(await matrix(text), options && options.size, options); }

  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  async function save(canvas, name) {
    const blob = await toBlob(canvas);
    if (!blob) { toast("Das Speichern hat nicht geklappt."); return; }
    const url = URL.createObjectURL(blob);
    const anchor = h("a", { href: url, download: `${name}.png` });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Der QR-Code wurde gespeichert.");
  }
  async function share(canvas, url, title) {
    try {
      const blob = await toBlob(canvas);
      const file = blob && new File([blob], "nex-qr.png", { type: "image/png" });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title, url }); return; }
      if (navigator.share) { await navigator.share({ title, url }); return; }
    } catch (error) { if (error && error.name === "AbortError") return; }
    Y.copyLink ? Y.copyLink(new URL(url).pathname) : toast(url);
  }

  /* A dialog with the code of one thing: `path` is where it lives on Nex ("/mia", "/mia/status/12", "/camera/l-dumm", "/"). */
  async function showDialog({ path, title, subtitle = "" }) {
    const url = absolute(path);
    const holder = h("div", { class: "qr-holder" }, h("span", { class: "muted" }, "Der Code wird gemacht …"));
    const buttons = h("div", { class: "qr-actions" });
    const body = h("div", { class: "qr-dialog" }, holder, h("p", { class: "qr-url" }, url.replace(/^https?:\/\//, "")), subtitle ? h("p", { class: "muted small" }, subtitle) : null, buttons);
    dialog({ title: title || "QR-Code", body });
    try {
      const canvas = await make(url, { size: 720 });
      canvas.className = "qr-canvas";
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `QR-Code für ${url}`);
      fill(holder, canvas);
      fill(buttons, h("button", { class: "btn primary", type: "button", onclick: () => save(canvas, `nex-${path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "web"}`) }, icon("download"), "Speichern"),
        h("button", { class: "btn ghost", type: "button", onclick: () => share(canvas, url, title || "Nex") }, icon("share"), "Teilen"));
    } catch (error) {
      fill(holder, h("span", { class: "muted" }, "Der QR-Code konnte nicht gemacht werden."));
    }
  }

  // ------------------------------------------------------------------------------------------------------------------ reading a code
  /* Looks at the camera picture until a code is found: onFound(text). Returns the function that stops it. */
  async function scan(video, onFound) {
    const reader = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    if (!reader) await loadScript(assets.jsqr);
    const canvas = document.createElement("canvas");
    const g = canvas.getContext("2d", { willReadFrequently: true });
    let stopped = false;
    async function look() {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          if (reader) {
            const found = await reader.detect(video);
            if (found[0] && found[0].rawValue) { onFound(found[0].rawValue); return; }
          } else {
            const scale = Math.min(1, 520 / video.videoWidth);
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            g.drawImage(video, 0, 0, canvas.width, canvas.height);
            const picture = g.getImageData(0, 0, canvas.width, canvas.height);
            const found = window.jsQR(picture.data, picture.width, picture.height, { inversionAttempts: "attemptBoth" });
            if (found && found.data) { onFound(found.data); return; }
          }
        } catch (error) { /* this picture had no code */ }
      }
      setTimeout(look, 170);
    }
    look();
    return () => { stopped = true; };
  }

  /* What a scanned text does: an address on Nex opens in the app, another address is shown first, plain text is only shown. */
  async function opened(text) {
    let url = null;
    try { url = new URL(text); } catch (error) { url = null; }
    if (url && url.origin === location.origin) { toast("QR-Code erkannt"); Y.navigate(`${url.pathname}${url.search}`); return; }
    const web = url && /^https?:$/.test(url.protocol);
    dialog({ title: "QR-Code erkannt", body: h("div", { class: "qr-dialog" }, h("p", { class: "qr-found" }, text.slice(0, 400)),
      h("p", { class: "muted small" }, web ? "Das ist eine Adresse außerhalb von Nex. Öffne sie nur, wenn du ihr traust." : "Das ist kein Link, nur ein Text.")),
      actions: [...(web ? [{ label: "Öffnen", kind: "primary", run: () => { window.open(url.href, "_blank", "noopener,noreferrer"); } }] : []),
        { label: "Kopieren", run: async () => { try { await navigator.clipboard.writeText(text); toast("Kopiert"); } catch (error) { toast("Das Kopieren hat nicht geklappt."); } return false; } }] });
  }

  // ------------------------------------------------------------------------------------------------------------------ the "QR-Code" lens of the camera
  function cameraPanel({ host, camera }) {
    const me = Y.me;
    const before = camera.before;
    const choices = [
      me ? { id: "me", label: "Mein Profil", path: `/${me.handle}`, text: `@${me.handle}` } : null,
      { id: "web", label: "Nex", path: "/", text: "die ganze Seite" },
      before ? { id: "item", label: `${before.emoji} ${before.name}`, path: `/camera/${before.id}`, text: before.kind === "lens" ? "diese Linse" : "dieses Spiel" } : null,
    ].filter(Boolean);
    let mode = "code";
    let choice = choices[0];
    let stopScan = null;
    const view = h("div", { class: "qr-view" });
    const modes = h("div", { class: "qr-modes", role: "tablist" });
    const chips = h("div", { class: "qr-chips" });
    const panel = h("div", { class: "cam-qr" }, modes, view, chips);
    host.append(panel);

    function drawModes() {
      fill(modes, ...[["code", "Mein Code"], ["scan", "Scannen"]].map(([id, label]) => h("button", { class: `qr-mode${mode === id ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(mode === id),
        onclick: () => { mode = id; stopScan?.(); stopScan = null; drawModes(); drawBody(); } }, label)));
    }
    async function drawBody() {
      if (mode === "scan") {
        chips.hidden = true;
        if (!camera.stream) { fill(view, h("p", { class: "qr-note" }, "Zum Scannen braucht Nex die Kamera.")); return; }
        fill(view, h("div", { class: "qr-reticle", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")), h("p", { class: "qr-note" }, "Halte die Kamera auf einen QR-Code"));
        try { stopScan = await scan(camera.feed, (text) => { stopScan?.(); stopScan = null; navigator.vibrate?.(40); opened(text); }); } catch (error) { fill(view, h("p", { class: "qr-note" }, "Das Scannen geht auf diesem Gerät nicht.")); }
        return;
      }
      chips.hidden = false;
      fill(chips, ...choices.map((entry) => h("button", { class: `chip${entry === choice ? " on" : ""}`, type: "button", onclick: () => { choice = entry; drawBody(); } }, entry.label)));
      fill(view, h("span", { class: "qr-note" }, "Der Code wird gemacht …"));
      const url = absolute(choice.path);
      try {
        const canvas = await make(url, { size: 720 });
        if (!panel.isConnected || mode !== "code") return;
        canvas.className = "qr-canvas";
        canvas.setAttribute("aria-label", `QR-Code für ${choice.label}`);
        fill(view, canvas, h("p", { class: "qr-url" }, `${choice.label} · ${choice.text}`),
          h("div", { class: "qr-actions" }, h("button", { class: "btn primary small", type: "button", onclick: () => save(canvas, `nex-${choice.id}`) }, icon("download"), "Speichern"),
            h("button", { class: "btn ghost small", type: "button", onclick: () => share(canvas, url, `Nex: ${choice.label}`) }, icon("share"), "Teilen")));
      } catch (error) { fill(view, h("span", { class: "qr-note" }, "Der QR-Code konnte nicht gemacht werden.")); }
    }
    drawModes();
    drawBody();
    return () => { stopScan?.(); };
  }

  Y.qr = { make, draw, matrix, dialog: showDialog, scan, opened };
  Y.cameraQr = { panel: cameraPanel };
})();
