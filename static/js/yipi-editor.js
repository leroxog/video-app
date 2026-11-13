/* Satürn video editor (yipi-editor.js): when somebody picks a video to upload, it opens here first, laid out like CapCut -- the picture above, the time line below (the strips of the video with two
   handles to cut it, a track for texts and one for the music), the tools at the bottom (Bearbeiten, Audio, Text, Effekte, Überlagerung, Untertitel) and, instead of "Exportieren", the button
   "Hochladen". Everything happens in the browser: the edited clip is drawn on a canvas (cut, speed, filter, texts, stickers) while the sound (the clip and the music) is mixed with the Web Audio
   API, and both are recorded into a new file (MediaRecorder); a clip that was not changed is handed on as it is. `Y.videoEditor.open({file, onDone, onClose})`; `onDone({file, width, height, seconds,
   captions})` gets the finished clip. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const { h, icon, toast } = Y;

  const MAX_SIDE = 1280;                                         // the longest side of the finished clip
  const FILTERS = [["Original", ""], ["Hell", "brightness(1.15) contrast(1.05)"], ["Kontrast", "contrast(1.35) saturate(1.1)"], ["Schwarz-Weiß", "grayscale(1)"], ["Warm", "sepia(0.45) saturate(1.3)"],
    ["Kalt", "hue-rotate(-18deg) saturate(1.15)"], ["Verblasst", "contrast(0.85) brightness(1.1) saturate(0.8)"], ["Weich", "blur(1.2px) brightness(1.05)"]];
  const STICKERS = [0x1F600, 0x1F602, 0x1F60D, 0x1F525, 0x2764, 0x2B50, 0x1F44D, 0x1F389, 0x1F4AF, 0x1FA90].map((code) => String.fromCodePoint(code));
  const COLORS = ["#ffffff", "#000000", "#fe2c55", "#ffd60a", "#34c759", "#0a84ff"];
  const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const clock = (seconds) => { const total = Math.max(0, Math.round(seconds)); return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; };

  function pickMime() {
    if (typeof MediaRecorder === "undefined") return "";
    for (const type of ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) if (MediaRecorder.isTypeSupported(type)) return type;
    return "";
  }

  /* One finished frame: the picture with the filter, then the texts and the stickers that are on at this moment (`at` is the time in the source video). */
  function paint(ctx, source, width, height, state, at) {
    ctx.filter = FILTERS[state.filter][1] || "none";
    ctx.drawImage(source, 0, 0, width, height);
    ctx.filter = "none";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const item of state.texts) {
      if (at < item.from || at > item.to) continue;
      const size = item.size * height / 100;
      ctx.font = `800 ${size}px Inter, "Segoe UI", sans-serif`;
      ctx.lineWidth = size / 7;
      ctx.strokeStyle = item.color === "#000000" ? "#ffffff" : "#000000";
      ctx.lineJoin = "round";
      ctx.strokeText(item.text, item.x * width / 100, item.y * height / 100, width * 0.92);
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, item.x * width / 100, item.y * height / 100, width * 0.92);
    }
    for (const item of state.stickers) {
      if (at < item.from || at > item.to) continue;
      ctx.font = `${item.size * height / 100}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.fillText(item.char, item.x * width / 100, item.y * height / 100);
    }
  }

  function open({ file, onDone, onClose, snap = false, tool: firstTool = "" } = {}) {
    const url = URL.createObjectURL(file);
    const video = h("video", { class: "ed-video", src: url, playsinline: true, preload: "auto", "aria-label": "Vorschau deines Videos" });
    const state = { start: 0, end: 0, speed: 1, clipAudio: true, volume: 1, filter: 0, texts: [], stickers: [], music: null, musicVolume: 0.7, captions: true };
    let duration = 0;
    let tool = firstTool;
    let busy = false;
    let selected = null;                                         // the text or sticker that is chosen
    let song = null;                                             // {song, buffer} the music, decoded
    let musicAudio = null;
    let nextId = 1;
    let closed = false;

    const stage = h("div", { class: "ed-stage" });
    const layer = h("div", { class: "ed-layer" });
    const timeText = h("span", { class: "ed-time" }, "00:00 / 00:00");
    const playButton = h("button", { class: "ed-play", type: "button", "aria-label": "Abspielen" }, icon("play"));
    const strip = h("div", { class: "ed-strip" });
    const handleA = h("span", { class: "ed-handle a", role: "slider", "aria-label": "Anfang" });
    const handleB = h("span", { class: "ed-handle b", role: "slider", "aria-label": "Ende" });
    const shade = h("span", { class: "ed-shade" });
    const head = h("span", { class: "ed-head" });
    const ruler = h("div", { class: "ed-ruler" });
    const textTrack = h("div", { class: "ed-track" });
    const audioTrack = h("div", { class: "ed-track audio" });
    const line = h("div", { class: "ed-line" }, strip, shade, handleA, handleB, head);
    const timeline = h("div", { class: "ed-timeline" }, ruler, line, audioTrack, textTrack);
    const panel = h("div", { class: "ed-panel", hidden: true });
    const progress = h("div", { class: "ed-progress", hidden: true }, h("b", {}, "Dein Video wird gebaut …"), h("span", { class: "ed-bar" }, h("i", {})), h("small", {}, "Bleib bitte auf dieser Seite."));
    const upload = h("button", { class: "ed-upload", type: "button" }, "Hochladen");
    if (snap) upload.textContent = "Fertig";                       // (opened from the camera: it only finishes the clip, the clip is sent from the camera afterwards)
    const close = h("button", { class: "ed-x", type: "button", "aria-label": "Schließen" }, icon("close"));

    // ----------------------------------------------------------------------------------------------- the picture
    const out = () => (state.end - state.start) / state.speed;
    function active(list) { return list.filter((item) => video.currentTime >= item.from && video.currentTime <= item.to); }
    function drawLayer() {
      video.style.filter = FILTERS[state.filter][1] || "none";
      const items = [...active(state.texts).map((item) => ({ item, kind: "text" })), ...active(state.stickers).map((item) => ({ item, kind: "sticker" }))];
      layer.replaceChildren(...items.map(({ item, kind }) => {
        const el = h("span", { class: `ed-item ${kind}${selected === item ? " on" : ""}` }, kind === "text" ? item.text : item.char);
        el.style.left = `${item.x}%`;
        el.style.top = `${item.y}%`;
        el.style.fontSize = `calc(var(--ed-h, 400px) * ${item.size / 100})`;
        if (kind === "text") el.style.color = item.color;
        el.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          selected = item;
          const box = layer.getBoundingClientRect();
          const move = (e) => { item.x = Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)); item.y = Math.min(100, Math.max(0, ((e.clientY - box.top) / box.height) * 100)); el.style.left = `${item.x}%`; el.style.top = `${item.y}%`; };
          const stop = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", stop); drawPanel(); };
          addEventListener("pointermove", move);
          addEventListener("pointerup", stop);
        });
        return el;
      }));
    }
    function sizeStage() {
      const room = stage.getBoundingClientRect();
      if (!video.videoWidth) return;
      const ratio = video.videoWidth / video.videoHeight;
      let width = room.width;
      let height = width / ratio;
      if (height > room.height) { height = room.height; width = height * ratio; }
      layer.style.width = `${width}px`;
      layer.style.height = `${height}px`;
      video.style.width = `${width}px`;
      video.style.height = `${height}px`;
      stage.style.setProperty("--ed-h", `${height}px`);
    }

    // --------------------------------------------------------------------------------------------- the time line
    const percent = (seconds) => `${(seconds / duration) * 100}%`;
    function drawTimeline() {
      if (!duration) return;
      handleA.style.left = percent(state.start);
      handleB.style.left = percent(state.end);
      shade.style.setProperty("--ed-a", percent(state.start));
      shade.style.setProperty("--ed-b", percent(state.end));
      head.style.left = percent(video.currentTime);
      timeText.textContent = `${clock(Math.max(0, video.currentTime - state.start) / state.speed)} / ${clock(out())}`;
      const ticks = Math.min(6, Math.max(2, Math.floor(duration / 2)));
      ruler.replaceChildren(...Array.from({ length: ticks + 1 }, (_, i) => { const tick = h("span", {}, clock((duration * i) / ticks)); tick.style.left = `${(i / ticks) * 100}%`; return tick; }));
      textTrack.replaceChildren(...[...state.texts, ...state.stickers].map((item) => {
        const bar = h("button", { class: `ed-bar-item${selected === item ? " on" : ""}`, type: "button", "aria-label": item.text || item.char }, item.text || item.char);
        bar.style.left = percent(item.from);
        bar.style.width = percent(item.to - item.from);
        bar.addEventListener("click", () => { selected = item; video.currentTime = item.from; tool = item.text ? "text" : "overlay"; drawAll(); });
        return bar;
      }));
      if (state.music) {
        const bar = h("span", { class: "ed-music-bar" }, state.music.title);
        bar.style.width = `${Math.min(100, (out() / duration) * 100)}%`;
        audioTrack.replaceChildren(bar);
      } else audioTrack.replaceChildren(h("button", { class: "ed-add-audio", type: "button", onclick: () => { tool = "audio"; drawAll(); } }, icon("plus"), "Audio hinzufügen"));
    }
    function dragOn(handle, apply) {
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const box = line.getBoundingClientRect();
        const move = (e) => { apply(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) * duration); drawAll(); };
        const stop = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", stop); };
        addEventListener("pointermove", move);
        addEventListener("pointerup", stop);
      });
    }
    dragOn(handleA, (t) => { state.start = Math.min(t, state.end - 0.5); video.currentTime = state.start; });
    dragOn(handleB, (t) => { state.end = Math.max(t, state.start + 0.5); video.currentTime = Math.max(state.start, state.end - 0.05); });
    dragOn(head, (t) => { video.currentTime = Math.min(state.end, Math.max(state.start, t)); });
    line.addEventListener("pointerdown", (event) => { const box = line.getBoundingClientRect(); video.currentTime = Math.min(state.end, Math.max(state.start, ((event.clientX - box.left) / box.width) * duration)); drawAll(); });

    async function thumbs() {
      const probe = h("video", { src: url, muted: true, playsinline: true, preload: "auto" });
      await new Promise((resolve) => { probe.addEventListener("loadeddata", resolve, { once: true }); probe.addEventListener("error", resolve, { once: true }); setTimeout(resolve, 4000); });
      const count = 8;
      const frame = document.createElement("canvas");
      frame.width = 72;
      frame.height = 96;
      const context = frame.getContext("2d");
      for (let i = 0; i < count && !closed; i += 1) {
        const cell = h("span", { class: "ed-cell" });
        strip.append(cell);
        await new Promise((resolve) => { probe.addEventListener("seeked", resolve, { once: true }); probe.currentTime = ((i + 0.5) / count) * duration; setTimeout(resolve, 1500); });
        try { context.drawImage(probe, 0, 0, frame.width, frame.height); cell.style.backgroundImage = `url(${frame.toDataURL("image/jpeg", 0.5)})`; } catch (error) { /* a frame that cannot be read stays grey */ }
      }
      probe.removeAttribute("src");
    }

    // -------------------------------------------------------------------------------------------------- the tools
    const chip = (label, on, run) => h("button", { class: `ed-chip${on ? " on" : ""}`, type: "button", "aria-pressed": String(!!on), onclick: run }, label);
    const slider = (min, max, step, value, onInput, label) => { const input = h("input", { class: "ed-range", type: "range", min: String(min), max: String(max), step: String(step), value: String(value), "aria-label": label }); input.addEventListener("input", () => onInput(Number(input.value))); return input; };
    const remove = (list, item) => { const at = list.indexOf(item); if (at >= 0) list.splice(at, 1); if (selected === item) selected = null; drawAll(); };

    function drawPanel() {
      panel.hidden = !tool;
      if (!tool) return;
      const rows = [];
      if (tool === "edit") {
        rows.push(h("p", { class: "ed-hint" }, "Zieh die Ränder in der Zeitleiste, um das Video zu kürzen."), h("b", {}, "Tempo"), h("div", { class: "ed-chips" }, SPEEDS.map((speed) => chip(`${speed}x`, state.speed === speed, () => { state.speed = speed; video.playbackRate = speed; drawAll(); }))));
      } else if (tool === "audio") {
        rows.push(h("div", { class: "ed-chips" }, chip(state.clipAudio ? "Originalton an" : "Originalton aus", state.clipAudio, () => { state.clipAudio = !state.clipAudio; video.muted = !state.clipAudio; drawAll(); })),
          h("b", {}, "Lautstärke des Videos"), slider(0, 1, 0.05, state.volume, (v) => { state.volume = v; video.volume = v; }, "Lautstärke des Videos"),
          h("div", { class: "ed-chips" }, h("button", { class: "ed-chip", type: "button", onclick: chooseMusic }, icon("music"), state.music ? "Anderen Song wählen" : "Musik hinzufügen"), state.music ? chip("Entfernen", false, () => { state.music = null; song = null; musicAudio?.pause(); musicAudio = null; drawAll(); }) : null));
        if (state.music) rows.push(h("b", {}, `Musik: ${state.music.title}`), slider(0, 1, 0.05, state.musicVolume, (v) => { state.musicVolume = v; if (musicAudio) musicAudio.volume = v; }, "Lautstärke der Musik"));
      } else if (tool === "text") {
        const input = h("input", { class: "ed-field", type: "text", maxlength: 60, placeholder: "Dein Text", "aria-label": "Text" });
        const add = h("button", { class: "ed-chip on", type: "button", onclick: () => {
          const text = input.value.trim();
          if (!text) return;
          const item = { id: nextId++, text, from: video.currentTime, to: Math.min(state.end, video.currentTime + 3), x: 50, y: 50, size: 8, color: "#ffffff" };
          state.texts.push(item);
          selected = item;
          drawAll();
        } }, "Text hinzufügen");
        rows.push(h("div", { class: "ed-row" }, input, add));
        if (selected && selected.text) rows.push(...selectedControls(selected, state.texts));
      } else if (tool === "effects") {
        rows.push(h("div", { class: "ed-chips" }, FILTERS.map(([name], index) => chip(name, state.filter === index, () => { state.filter = index; drawAll(); }))));
      } else if (tool === "overlay") {
        rows.push(h("div", { class: "ed-chips stickers" }, STICKERS.map((char) => h("button", { class: "ed-chip sticker", type: "button", "aria-label": `Sticker ${char}`, onclick: () => {
          const item = { id: nextId++, char, from: video.currentTime, to: Math.min(state.end, video.currentTime + 3), x: 50, y: 40, size: 14 };
          state.stickers.push(item);
          selected = item;
          drawAll();
        } }, char))));
        if (selected && selected.char) rows.push(...selectedControls(selected, state.stickers));
      } else if (tool === "captions") {
        rows.push(chip(state.captions ? "Untertitel automatisch: an" : "Untertitel automatisch: aus", state.captions, () => { state.captions = !state.captions; drawAll(); }),
          h("p", { class: "ed-hint" }, "Satürn schreibt nach dem Hochladen Untertitel und kann das Video in 22 Sprachen vorlesen."));
      }
      panel.replaceChildren(...rows.filter(Boolean));
    }
    function selectedControls(item, list) {
      const controls = [h("b", {}, "Sichtbar von bis"),
        slider(state.start, state.end, 0.1, item.from, (v) => { item.from = Math.min(v, item.to - 0.2); drawTimeline(); drawLayer(); }, "Sichtbar ab"),
        slider(state.start, state.end, 0.1, item.to, (v) => { item.to = Math.max(v, item.from + 0.2); drawTimeline(); drawLayer(); }, "Sichtbar bis"),
        h("b", {}, "Größe"), slider(3, 30, 0.5, item.size, (v) => { item.size = v; drawLayer(); }, "Größe")];
      if (item.text) controls.push(h("div", { class: "ed-chips" }, COLORS.map((color) => { const b = h("button", { class: `ed-color${item.color === color ? " on" : ""}`, type: "button", "aria-label": `Farbe ${color}`, onclick: () => { item.color = color; drawAll(); } }); b.style.background = color; return b; })));
      controls.push(h("button", { class: "ed-chip", type: "button", onclick: () => remove(list, item) }, icon("trash"), "Entfernen"));
      return controls;
    }
    const tools = [["edit", "scissors", "Bearbeiten"], ["audio", "music", "Audio"], ["text", "text", "Text"], ["effects", "sparkle", "Effekte"], ["overlay", "image", "Überlagerung"], ["captions", "captions", "Untertitel"]];
    const toolbar = h("nav", { class: "ed-tools", "aria-label": "Werkzeuge" });
    function drawTools() {
      toolbar.replaceChildren(...tools.map(([id, symbol, label]) => h("button", { class: `ed-tool${tool === id ? " on" : ""}`, type: "button", "aria-pressed": String(tool === id), onclick: () => { tool = tool === id ? "" : id; drawAll(); } }, icon(symbol), h("span", {}, label))));
    }
    function chooseMusic() {
      if (!Y.music) return;
      Y.music.pick({ onPick: async (picked) => {
        const address = Y.music.urlOf(picked);
        const blobUrl = await Y.music.loadWhole(address);
        if (!blobUrl) { toast("Der Song konnte nicht geladen werden."); return; }
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          const context = new AC();
          const buffer = await context.decodeAudioData(await (await fetch(blobUrl)).arrayBuffer());
          context.close();
          song = { song: picked, buffer };
          state.music = { title: picked.title || "Song", start: Number(picked.start) || 0 };
          musicAudio?.pause();
          musicAudio = new Audio(blobUrl);
          musicAudio.volume = state.musicVolume;
          drawAll();
        } catch (error) { toast("Der Song konnte nicht gelesen werden."); }
      } });
    }

    function drawAll() { drawTools(); drawPanel(); drawTimeline(); drawLayer(); }

    // ---------------------------------------------------------------------------------------------- playing
    function play() {
      if (video.currentTime >= state.end - 0.05 || video.currentTime < state.start) video.currentTime = state.start;
      video.playbackRate = state.speed;
      video.muted = !state.clipAudio;
      video.volume = state.volume;
      video.play().catch(() => {});
      if (musicAudio) { musicAudio.currentTime = state.music.start + Math.max(0, (video.currentTime - state.start) / state.speed); musicAudio.play().catch(() => {}); }
    }
    function stopPlaying() { video.pause(); musicAudio?.pause(); }
    playButton.addEventListener("click", () => (video.paused ? play() : stopPlaying()));
    stage.addEventListener("click", (event) => { if (!event.target.closest(".ed-item")) { selected = null; if (video.paused) play(); else stopPlaying(); drawAll(); } });
    video.addEventListener("play", () => { playButton.replaceChildren(icon("pause")); playButton.setAttribute("aria-label", "Anhalten"); });
    video.addEventListener("pause", () => { playButton.replaceChildren(icon("play")); playButton.setAttribute("aria-label", "Abspielen"); });
    video.addEventListener("timeupdate", () => { if (video.currentTime >= state.end) { stopPlaying(); video.currentTime = state.start; } drawTimeline(); drawLayer(); });
    function ready() {
      duration = video.duration;
      state.end = duration;
      video.currentTime = 0;
      sizeStage();
      drawAll();
      thumbs();
    }
    video.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(video.duration)) { ready(); return; }
      // a clip that was recorded in the browser (WebM) does not say how long it is: jumping to the far end makes the browser find out
      const found = () => { if (!Number.isFinite(video.duration)) return; video.removeEventListener("timeupdate", found); ready(); };
      video.addEventListener("timeupdate", found);
      video.currentTime = 1e9;
    });
    addEventListener("resize", sizeStage);

    // ---------------------------------------------------------------------------------------------- finishing
    const changed = () => state.start > 0.05 || state.end < duration - 0.05 || state.speed !== 1 || !state.clipAudio || state.volume !== 1 || state.filter !== 0 || state.texts.length || state.stickers.length || !!state.music;

    async function render() {
      const mime = pickMime();
      if (!mime) throw new Error("no recorder");
      const AC = window.AudioContext || window.webkitAudioContext;
      const width = even(video.videoWidth * Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight)));
      const height = even(video.videoHeight * Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight)));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const source = h("video", { src: url, playsinline: true, preload: "auto" });
      await new Promise((resolve, reject) => { source.addEventListener("loadeddata", resolve, { once: true }); source.addEventListener("error", reject, { once: true }); });
      const audio = new AC();
      await audio.resume();
      const sink = audio.createMediaStreamDestination();
      const clipGain = audio.createGain();
      clipGain.gain.value = state.clipAudio ? state.volume : 0;
      audio.createMediaElementSource(source).connect(clipGain).connect(sink);
      let musicSource = null;
      if (song) {
        musicSource = audio.createBufferSource();
        musicSource.buffer = song.buffer;
        const musicGain = audio.createGain();
        musicGain.gain.value = state.musicVolume;
        musicSource.connect(musicGain).connect(sink);
      }
      const stream = canvas.captureStream(30);
      for (const track of sink.stream.getAudioTracks()) stream.addTrack(track);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3500000 });
      const chunks = [];
      recorder.addEventListener("dataavailable", (event) => { if (event.data && event.data.size) chunks.push(event.data); });
      source.currentTime = state.start;
      await new Promise((resolve) => { source.addEventListener("seeked", resolve, { once: true }); setTimeout(resolve, 2000); });
      source.playbackRate = state.speed;
      const finished = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
      recorder.start(250);
      paint(ctx, source, width, height, state, source.currentTime);
      await source.play();
      if (musicSource) musicSource.start(0, state.music.start);
      await new Promise((resolve) => {
        const bar = progress.querySelector(".ed-bar i");
        const tick = () => {
          paint(ctx, source, width, height, state, source.currentTime);
          bar.style.width = `${Math.min(100, ((source.currentTime - state.start) / (state.end - state.start)) * 100)}%`;
          if (source.currentTime >= state.end - 0.03 || source.ended || closed) resolve(); else setTimeout(tick, 33);       // (a timer, not the animation frame: it keeps running when the page is in the background)
        };
        tick();
      });
      source.pause();
      try { musicSource?.stop(); } catch (error) { /* it had not started */ }
      recorder.stop();
      await finished;
      audio.close();
      source.removeAttribute("src");
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      return { file: new File([blob], `video.${ext}`, { type: blob.type }), width, height, seconds: out(), captions: state.captions };
    }

    async function finish() {
      if (busy) return;
      stopPlaying();
      if (!changed()) { done({ file, width: video.videoWidth, height: video.videoHeight, seconds: duration, captions: state.captions }); return; }
      busy = true;
      upload.disabled = true;
      progress.hidden = false;
      try { done(await render()); } catch (error) {
        console.error(error);
        busy = false;
        upload.disabled = false;
        progress.hidden = true;
        toast("Dein Browser kann das Video nicht bearbeiten. Du kannst es ohne Bearbeitung hochladen.");
      }
    }
    function done(result) { teardown(); onDone?.(result); }
    function teardown() {
      closed = true;
      stopPlaying();
      removeEventListener("resize", sizeStage);
      document.body.classList.remove("modal-open");
      root.remove();
      URL.revokeObjectURL(url);
    }
    upload.addEventListener("click", finish);
    close.addEventListener("click", () => { if (busy) return; teardown(); onClose?.(); });

    const side = h("div", { class: "ed-side" },
      h("button", { class: "ed-quick", type: "button", onclick: () => { state.clipAudio = !state.clipAudio; video.muted = !state.clipAudio; drawAll(); } }, icon("music"), h("span", {}, "Clipaudio aus")),
      h("button", { class: "ed-quick", type: "button", onclick: () => { tool = "edit"; drawAll(); } }, icon("scissors"), h("span", {}, "Tempo")));
    const controls = h("div", { class: "ed-controls" }, timeText, playButton);
    stage.append(video, layer);
    const root = h("div", { class: `ed${snap ? " snap" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": "Video bearbeiten" },
      h("div", { class: "ed-top" }, close, h("span", { class: "ed-spacer" }), upload), stage, controls,
      h("div", { class: "ed-low" }, side, timeline), panel, toolbar, progress);
    document.body.append(root);
    document.body.classList.add("modal-open");
    drawTools();
    return { close: teardown };
  }

  Y.videoEditor = { open };
})();
