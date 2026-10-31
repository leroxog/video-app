/* Nex composer (yipi-composer.js): the pieces of the line above the keyboard that every place to write has, like the line of WhatsApp: a "+" at the left that slides a panel out under the line
   (it takes the place of the keyboard), a sticker button in the line, a photo button, and the microphone (a voice message in a chat, dictation everywhere else). `Y.composerPanel(ids, onPick)` is the panel,
   `Y.composerTools` has what the entries do (pick a file, the place of the person, a contact, dictation, a voice message). The stickers are the GIFs of Nex: from now on they are called stickers. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { h, icon, toast, dialog, fill } = Y;

  const ENTRIES = {
    photo: ["Fotos", "image", "#7a2cf0"], camera: ["Kamera", "camera", "#ec4899"], location: ["Standort", "pin", "#16a34a"], contact: ["Kontakt", "user", "#2a8cff"],
    document: ["Dokument", "file", "#5b5bd6"], poll: ["Abstimmung", "poll", "#f59e0b"], sticker: ["Sticker", "sticker", "#14b8a6"],
  };

  /* The panel under the line: round coloured buttons with a name, it slides open and the keyboard goes away. `ids` are the entries (see ENTRIES), `onPick(id)` answers a tap. */
  function composerPanel(ids, onPick) {
    const grid = h("div", { class: "cb-grid" }, ids.map((id) => h("button", { class: "cb-item", type: "button", "data-kind": id, onclick: () => { api.close(); onPick(id); } },
      h("span", { class: "cb-ic", style: `background:${ENTRIES[id][2]}` }, icon(ENTRIES[id][1])), h("span", { class: "cb-name" }, ENTRIES[id][0]))));
    const element = h("div", { class: "cb-panel", "aria-hidden": "true" }, grid);
    let open = false;
    const api = {
      element,
      get isOpen() { return open; },
      open() { open = true; element.classList.add("open"); element.setAttribute("aria-hidden", "false"); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); },
      close() { open = false; element.classList.remove("open"); element.setAttribute("aria-hidden", "true"); },
      toggle() { if (open) api.close(); else api.open(); },
      hide(id, on) { const button = grid.querySelector(`[data-kind="${id}"]`); if (button) button.hidden = !!on; },
    };
    return api;
  }

  /* A file from the device: a picture or a document, or a photo taken at once by the camera of the phone (`capture`). Answers the files (none when the person gives up). */
  function pickFiles(accept, { capture = "", multiple = false } = {}) {
    return new Promise((resolve) => {
      const input = h("input", { type: "file", accept, hidden: true, "aria-hidden": "true", tabindex: "-1" });
      if (capture) input.setAttribute("capture", capture);
      input.multiple = multiple;
      const done = (files) => { input.remove(); resolve(files); };
      input.addEventListener("change", () => done([...input.files]));
      input.addEventListener("cancel", () => done([]));
      document.body.append(input);
      input.click();
    });
  }

  /* "📍 Mein Standort: ..." with a link to a map, or null when the device does not say where it is (the person has to allow it each time). */
  function place() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { toast("Dein Gerät kann den Standort nicht bestimmen."); resolve(null); return; }
      navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude.toFixed(4), lon = position.coords.longitude.toFixed(4);      // (about 10 metres: enough to find a place, not a door)
        resolve(`📍 Mein Standort: https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`);
      }, () => { toast("Den Standort darf Nex gerade nicht lesen. Erlaube ihn in den Einstellungen des Browsers."); resolve(null); }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
  }

  /* A window with the friends: the handle of the one that is tapped, or null. */
  async function contact() {
    const reply = await Api.get("/friends");
    if (!reply.ok) { toast(Api.message(reply)); return null; }
    return new Promise((resolve) => {
      let entry = null;
      let chosen = null;
      const rows = reply.data.users.map((friend) => h("button", { class: "pick", type: "button", onclick: () => { chosen = friend.handle; entry.close(); } },
        Y.avatar(friend, "md"), h("span", { class: "pick-main" }, h("b", {}, friend.name), h("span", { class: "handle" }, `@${friend.handle}`))));
      entry = dialog({ title: "Kontakt senden", body: rows.length ? h("div", { class: "pick-list" }, rows) : h("p", { class: "muted" }, "Du hast noch keine Freunde. Freunde sind Leute, die dir folgen und denen du folgst."), onClose: () => resolve(chosen) });
    });
  }

  /* Dictation: the microphone writes what is said into the field (the browser does it; where it cannot, a note says so). */
  function dictation(textarea, button, onChange) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let running = null;
    function stop() { if (running) { try { running.stop(); } catch (error) { /* already stopped */ } } }
    button.addEventListener("click", () => {
      if (!Recognition) { toast("Dein Browser kann nicht mitschreiben. Auf dem iPhone und in Chrome geht es."); return; }
      if (running) { stop(); return; }
      const recognition = new Recognition();
      recognition.lang = document.documentElement.lang === "en" ? "en-US" : "de-DE";
      recognition.interimResults = false;
      recognition.continuous = true;
      recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          if (!event.results[i].isFinal) continue;
          const text = event.results[i][0].transcript.trim();
          if (text) { textarea.value = `${textarea.value}${textarea.value && !/\s$/.test(textarea.value) ? " " : ""}${text}`; onChange?.(); }
        }
      };
      recognition.onerror = () => { toast("Das Mikrofon darf Nex nicht hören. Erlaube es in den Einstellungen des Browsers."); };
      recognition.onend = () => { running = null; button.classList.remove("rec"); button.setAttribute("aria-pressed", "false"); };
      try { recognition.start(); running = recognition; button.classList.add("rec"); button.setAttribute("aria-pressed", "true"); } catch (error) { running = null; }
    });
    return { stop };
  }

  /* A voice message: the line turns into a recorder (a red dot, the time, a bar that moves with the voice, a bin and a send button). `host` is the box of the line, `onSend(blob, seconds)`. */
  async function record({ host, onSend }) {
    if (host.classList.contains("recording")) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") { toast("Dein Browser kann keine Sprachnachricht aufnehmen."); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (error) { toast("Das Mikrofon darf Nex nicht hören. Erlaube es in den Einstellungen des Browsers."); return; }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((candidate) => MediaRecorder.isTypeSupported(candidate)) || "";
    let recorder;
    try { recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined); } catch (error) { stream.getTracks().forEach((track) => track.stop()); toast("Dein Browser kann keine Sprachnachricht aufnehmen."); return; }
    const chunks = [];
    const started = Date.now();
    let cancelled = false;
    let level = null;
    let audio = null;
    const time = h("span", { class: "cb-time" }, "0:00");
    const meter = h("span", { class: "cb-meter-fill" });
    const bin = h("button", { class: "icon-btn cb-bin", type: "button", "aria-label": "Aufnahme verwerfen" }, icon("trash"));
    const go = h("button", { class: "icon-btn send-btn", type: "button", "aria-label": "Sprachnachricht senden" }, icon("arrowUp"));
    const box = h("div", { class: "cb-rec", role: "status", "aria-label": "Aufnahme läuft" }, bin, h("span", { class: "cb-dot", "aria-hidden": "true" }), time, h("span", { class: "cb-meter", "aria-hidden": "true" }, meter), go);
    host.append(box);
    host.classList.add("recording");
    const clock = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; if (s >= 180) finish(false); }, 250);
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      audio = new Context();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      level = setInterval(() => { analyser.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128)); meter.style.transform = `scaleX(${Math.min(1, peak / 70).toFixed(2)})`; }, 80);
    } catch (error) { /* no meter, the recording goes on */ }
    function clean() {
      clearInterval(clock);
      clearInterval(level);
      stream.getTracks().forEach((track) => track.stop());
      if (audio) audio.close().catch(() => {});
      box.remove();
      host.classList.remove("recording");
    }
    function finish(cancel) {
      cancelled = cancel;
      if (recorder.state !== "inactive") recorder.stop(); else clean();
    }
    recorder.addEventListener("dataavailable", (event) => { if (event.data && event.data.size) chunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      const seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
      clean();
      if (!cancelled && chunks.length) onSend(new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" }), seconds);
    });
    bin.addEventListener("click", () => finish(true));
    go.addEventListener("click", () => finish(false));
    recorder.start(1000);
    navigator.vibrate?.(20);
  }

  /* the file name of a voice message by its type */
  const voiceName = (blob) => `Sprachnachricht.${/mp4/.test(blob.type) ? "m4a" : /ogg/.test(blob.type) ? "ogg" : "webm"}`;

  Y.composerPanel = composerPanel;
  Y.composerTools = { pickFiles, place, contact, dictation, record, voiceName };
})();
