/* Nex music (yipi-music.js): songs for the clips of the camera. `Y.music.pick({upload, onPick})` is the window to choose a song (search, preview, "Zufällig", the start second, and for a lens
   also a file from the folder of the person); `Y.music.player()` plays the chosen song while a clip is recorded and mixes it with the microphone into the sound of the clip; `credit(song)` is the line
   that stands in the clip (the author and the licence of the song). Only music that may be used is offered (the server asks the Internet Archive for audio with a Creative Commons licence that
   allows it, yipi_music.py) and nothing connects to another site: the audio comes from the server of Nex. A song is {src: "archive", id, file, title, creator, licence, licenceUrl, length, start}
   or {src: "upload", media, title, start}. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { fill, h, icon, toast, dialog } = Y;

  const urlOf = (song) => song.url || (song.src === "upload" ? `/yipi-media/${song.media}` : `/yipi-music/${song.id}/${encodeURIComponent(song.file)}`);
  const label = (song) => (song ? `${song.title}${song.creator ? ` · ${song.creator}` : ""}` : "");
  const credit = (song) => (song ? (song.src === "archive" ? `♪ ${song.title} · ${song.creator} · ${song.licence}` : `♪ ${song.title}`) : "");
  const minutes = (seconds) => (seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");

  /* ------------------------------------------------------------------------------------------------ the window to choose a song */
  function pick({ upload = false, onPick, title = "Sound hinzufügen" } = {}) {
    let entry = null;
    let preview = null;                                            // the audio that plays the preview
    let page = 1;
    let busy = false;
    const input = h("input", { class: "field", type: "search", placeholder: "Song oder Künstler suchen", maxlength: 60, "aria-label": "Song suchen" });
    const list = h("div", { class: "mu-list", role: "list" });
    const status = h("p", { class: "muted small", role: "status" });
    const genres = h("div", { class: "lm-chips" }, [["Pop", "pop"], ["Rock", "rock"], ["Hip-Hop", "hiphop"], ["Elektro", "electronic"], ["Chill", "ambient"], ["Jazz", "jazz"], ["Klassik", "classical"], ["Folk", "folk"]]
      .map(([name, word]) => h("button", { class: "chip", type: "button", onclick: () => { input.value = word; search(true); } }, name)));
    const more = h("button", { class: "btn ghost small", type: "button", hidden: true }, "Mehr");
    const fileInput = h("input", { type: "file", accept: "audio/mpeg,audio/ogg,audio/mp4,audio/wav,.mp3,.ogg,.m4a,.wav", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const stopPreview = () => { if (preview) { preview.pause(); preview = null; } for (const row of list.querySelectorAll(".mu-row.playing")) row.classList.remove("playing"); };

    function row(item) {
      const play = h("button", { class: "icon-btn small", type: "button", "aria-label": `${item.title} anhören` }, icon("volume"));
      const take = h("button", { class: "btn primary small", type: "button" }, "Nehmen");
      const start = h("input", { class: "mu-start", type: "range", min: 0, max: 0, value: 0, hidden: true, "aria-label": "Startpunkt im Song" });
      const startText = h("small", { class: "muted", hidden: true });
      const line = h("div", { class: "mu-row", role: "listitem" }, play, h("div", { class: "mu-main" }, h("b", {}, item.title), h("small", { class: "muted" }, `${item.creator} · ${item.licence}`), start, startText), take);
      let track = null;
      async function resolve() {
        if (track) return track;
        const reply = await Api.get(`/music/track/${encodeURIComponent(item.id)}`);
        if (!reply.ok) { status.textContent = "Dieser Song lässt sich nicht abspielen. Nimm einen anderen."; return null; }
        track = reply.data.track;
        if (track.length && track.length > 25) { start.max = String(Math.max(0, track.length - 15)); start.hidden = false; startText.hidden = false; startText.textContent = "Startpunkt: 0:00"; }
        return track;
      }
      start.addEventListener("input", () => { startText.textContent = `Startpunkt: ${minutes(Number(start.value))}`; });
      start.addEventListener("change", () => { if (preview && !preview.paused) preview.currentTime = Number(start.value); });
      play.addEventListener("click", async () => {
        if (line.classList.contains("playing")) { stopPreview(); return; }
        stopPreview();
        const got = await resolve();
        if (!got) return;
        preview = new Audio(got.url);
        preview.volume = Math.max(0.2, Y.camSound ? Y.camSound.volume : 1);
        preview.addEventListener("loadedmetadata", () => { try { preview.currentTime = Number(start.value) || 0; } catch (error) { /* a stream without ranges */ } }, { once: true });
        preview.play().then(() => line.classList.add("playing")).catch(() => { status.textContent = "Der Song lässt sich nicht abspielen."; });
        setTimeout(() => { if (preview && line.classList.contains("playing")) stopPreview(); }, 30000);
      });
      take.addEventListener("click", async () => {
        const got = await resolve();
        if (!got) return;
        stopPreview();
        entry.close();
        onPick({ src: "archive", id: got.id, file: got.file, title: got.title, creator: got.creator, licence: got.licence, licenceUrl: got.licenceUrl, length: got.length, start: Number(start.value) || 0, url: got.url });
      });
      return line;
    }
    async function search(reset) {
      if (busy) return;
      busy = true;
      if (reset) { page = 1; list.replaceChildren(); }
      status.textContent = "Die Songs werden gesucht …";
      const reply = await Api.get(`/music/search?q=${encodeURIComponent(input.value.trim())}&page=${page}`);
      busy = false;
      if (!reply.ok) { status.textContent = Api.message(reply); return; }
      if (reset && !reply.data.items.length) { status.textContent = "Dazu habe ich nichts gefunden. Probier ein anderes Wort."; more.hidden = true; return; }
      list.append(...reply.data.items.map(row));
      more.hidden = reply.data.items.length < 20;
      status.textContent = reply.data.total ? `Frei benutzbare Musik (Creative Commons) vom Internet Archive: über ${reply.data.total.toLocaleString("de-DE")} Audio-Dateien.` : "";
    }
    more.addEventListener("click", () => { page += 1; search(false); });
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); search(true); } });
    let typing = 0;
    input.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => search(true), 450); });
    const random = h("button", { class: "try-btn", type: "button", onclick: async () => {
      status.textContent = "Ein Zufalls-Song wird gesucht …";
      const reply = await Api.get("/music/random");
      if (!reply.ok) { status.textContent = "Gerade habe ich keinen Zufalls-Song gefunden. Versuch es noch einmal."; return; }
      const got = reply.data.track;
      stopPreview();
      entry.close();
      onPick({ src: "archive", id: got.id, file: got.file, title: got.title, creator: got.creator, licence: got.licence, licenceUrl: got.licenceUrl, length: got.length, start: 0, url: got.url });
    } }, icon("sparkle"), "Zufälliger Song");
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      if (file.size > 8_000_000) { status.textContent = "Die Datei ist zu groß (höchstens 8 MB)."; return; }
      status.textContent = "Der Song wird hochgeladen …";
      const up = await Api.uploadSong(file, file.name.replace(/\.[^.]+$/, ""));
      if (!up.ok) { status.textContent = up.data && up.data.error === "bad_audio" ? "Das ist keine Audio-Datei, die Nex kennt (MP3, Ogg, M4A, WAV)." : Api.message(up); return; }
      entry.close();
      onPick({ src: "upload", media: up.data.media.id, title: up.data.media.title || file.name.replace(/\.[^.]+$/, ""), start: 0, url: up.data.media.url });
    });
    entry = dialog({ title, wide: true, body: h("div", { class: "music-picker" },
      h("div", { class: "mu-bar" }, input, random),
      genres,
      list, h("div", { class: "mu-actions" }, more, upload ? h("button", { class: "btn ghost small", type: "button", onclick: () => fileInput.click() }, "Song aus dem Ordner") : null), fileInput,
      upload ? h("p", { class: "muted small" }, "Nimm nur Musik, die du benutzen darfst. Du bist dafür verantwortlich.") : null,
      status), initialFocus: input, onClose: stopPreview });
    search(true);
  }

  /* ------------------------------------------------------------------------------------------------ the player of a clip */
  /* One audio element for the song of the camera; `prepare(song, micStream)` makes it ready (also the mix with the microphone), `track()` is the sound for the recording, `play()` starts it. */
  function player() {
    let audio = null;
    let ctx = null;
    let gain = null;
    let dest = null;
    let mic = null;
    let song = null;
    const volumeNow = () => (Y.camSound ? Y.camSound.volume : 1);
    const follow = () => { if (gain) gain.gain.value = volumeNow(); else if (audio) audio.volume = volumeNow(); };
    function drop() {
      if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
      if (mic) { try { mic.disconnect(); } catch (error) { /* gone */ } }
      if (ctx) { ctx.close().catch(() => {}); }
      audio = ctx = gain = dest = mic = null;
    }
    function prepare(next, micStream) {
      drop();
      song = next;
      if (!next) return;
      audio = new Audio();
      audio.preload = "auto";
      audio.loop = true;
      audio.src = urlOf(next);
      audio.addEventListener("loadedmetadata", () => { try { if (next.start && audio.duration > next.start + 5) audio.currentTime = next.start; } catch (error) { /* no ranges */ } }, { once: true });
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context) {
        try {
          ctx = new Context();
          const source = ctx.createMediaElementSource(audio);
          gain = ctx.createGain();
          dest = ctx.createMediaStreamDestination();
          source.connect(gain);
          gain.connect(ctx.destination);                              // the player hears it
          gain.connect(dest);                                         // and so does the recording
          const tracks = micStream ? micStream.getAudioTracks() : [];
          if (tracks.length) { mic = ctx.createMediaStreamSource(new MediaStream(tracks)); mic.connect(dest); }
          follow();
        } catch (error) { ctx = gain = dest = mic = null; }
      }
      if (!gain) follow();
    }
    return {
      prepare,
      get song() { return song; },
      get ready() { return !!audio; },
      /* the sound of the clip (the song and the microphone mixed), or null when the browser cannot mix */
      track() { return dest ? dest.stream.getAudioTracks()[0] || null : null; },
      async play() {
        if (!audio) return;
        follow();
        try { if (ctx && ctx.state === "suspended") await ctx.resume(); await audio.play(); } catch (error) { /* blocked: the song stays silent */ }
      },
      pause() { if (audio) audio.pause(); },
      rewind() { if (audio) { try { audio.currentTime = (song && song.start) || 0; } catch (error) { /* no ranges */ } } },
      follow,
      destroy: drop,
    };
  }

  Y.music = { pick, player, credit, label, urlOf };
})();
