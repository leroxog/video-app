/* Satürn music (yipi-music.js): songs for the clips of the camera. `Y.music.pick({upload, onPick})` is the window to choose a song (search, preview, "Zufällig", the start second, and for a lens
   also a file from the folder of the person); `Y.music.player()` plays the chosen song while a clip is recorded and mixes it with the microphone into the sound of the clip; `credit(song)` is the line
   that stands in the clip (the author and the licence of the song). Only a short, chosen list of music that fits short videos is offered, all of it under a Creative Commons licence that
   allows it (yipi_music.py, yipi_music_catalogue.py); the server keeps the file of a song, and the player loads the whole song before it plays it, so that it starts at once and in the right place and nothing connects to another site: the audio comes from the server of Satürn. A song is {src: "archive", id, file, title, creator, licence, licenceUrl, length, start}
   or {src: "upload", media, title, start}. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { fill, h, icon, toast, dialog } = Y;

  const urlOf = (song) => song.url || (song.src === "upload" ? `/yipi-media/${song.media}` : `/yipi-music/${song.id}/${encodeURIComponent(song.file)}`);
  /* "Extrahierter Song 123456789": the sound of a video of somebody else. The number comes from the number of the post by a one-to-one mixing (an odd factor modulo 2^30), so that it looks random and two
     videos never get the same one; the same video always has the same number. */
  const extractedNumber = (postId) => { try { return String(Number((BigInt(postId) * 2654435761n) % (1n << 30n))); } catch (error) { return String(postId); } };
  /* The address the mixer may use: a video or an uploaded song is asked from the site itself (the server hands the bytes over), not from the storage of another origin, which would be silent. */
  const sameOriginUrl = (song) => ((song.src === "video" || song.src === "upload") && song.media ? `/yipi-media/${song.media}?same=1` : urlOf(song));
  /* The number of a sound from a video of the device: a counter of this device, mixed with the same one-to-one formula (and a start that is different on every device), so the numbers look random and never come twice. */
  function deviceNumber() {
    let count = 0;
    let offset = 0;
    try {
      count = Number(localStorage.getItem("saturn.extracted") || 0) + 1;
      offset = Number(localStorage.getItem("saturn.extractedStart"));
      if (!offset) { offset = 1 + Math.floor(Math.random() * 1_000_000_000); localStorage.setItem("saturn.extractedStart", String(offset)); }
      localStorage.setItem("saturn.extracted", String(count));
    } catch (error) { count = Date.now(); offset = Math.floor(Math.random() * 1_000_000); }
    return String((BigInt(count) + BigInt(offset)) * 2654435761n % (1n << 30n));
  }
  const extractedSong = (post, media) => ({ src: "video", media: media.id, url: media.url, title: `Extrahierter Song ${extractedNumber(post.id)}`, creator: `@${post.user.handle}`, post: post.id, start: 0 });
  const label = (song) => (song ? `${song.title}${song.creator ? ` · ${song.creator}` : ""}` : "");
  const credit = (song) => (song ? (song.src === "archive" ? `Musik: ${song.title} · ${song.creator} · ${song.licence}` : song.src === "video" || song.src === "device" ? `Musik: ${song.title} · ${song.creator}` : `Musik: ${song.title}`) : "");
  const minutes = (seconds) => (seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}` : "");

  /* ------------------------------------------------------------------------------------------------ the window to choose a song */
  /* Dark, like the sound window of TikTok: a search line, tiles of the styles, four tabs (for you, own files, favourites), the videos whose sound one can take ("Extrahierter Song ..."), and the songs with a
     bookmark (favourite) and a purple plus. All songs are fetched once; searching, the styles and the favourites are filtered here. Favourites are kept in this browser. */
  const VIDEO_FAVS = "saturn.favvideos";
  const FAVS = "saturn.favsongs";
  const favourites = () => { try { const list = JSON.parse(localStorage.getItem(FAVS) || "[]"); return Array.isArray(list) ? list.filter((id) => typeof id === "string").slice(0, 200) : []; } catch (error) { return []; } };
  const keepFavourites = (list) => { try { localStorage.setItem(FAVS, JSON.stringify(list)); } catch (error) { /* storage blocked */ } };
  const STYLES = [["Beliebt", "#7a2cf0", "#ec4899", "car-race"], ["Funk", "#f59e0b", "#ef4444", "basketball"], ["Dance", "#06b6d4", "#6366f1", "cube-dash"], ["Hip-Hop", "#334155", "#a855f7", "darts"],
    ["Lo-Fi", "#14b8a6", "#3b82f6", "copter"], ["Chill", "#22c55e", "#0ea5e9", "mini-golf"], ["Retro", "#f97316", "#db2777", "asteroids"]];                 // (a picture of the site under a colour)

  function pick({ upload = false, onPick, title = "Sounds hinzufügen" } = {}) {
    let entry = null;
    let preview = null;                                            // the audio that plays the preview
    let all = [];                                                  // every song of the list
    let tab = "foryou";                                            // foryou, files, favourites
    let style = "";
    let favs = favourites();
    const input = h("input", { class: "mu-search", type: "search", placeholder: "Songs oder Künstler suchen", maxlength: 60, "aria-label": "Song suchen" });
    const styles = h("div", { class: "mu-styles", role: "list" }, STYLES.map(([name, a, b, picture]) => h("button", { class: "mu-style", type: "button", role: "listitem", style: `background:linear-gradient(135deg,${a}cc,${b}cc),url(/static/img/games/${picture}.jpg) center/cover`,
      onclick: (event) => { style = style === name ? "" : name; for (const tile of styles.children) tile.classList.toggle("on", tile.textContent === style); show(); } }, name)));
    const tabs = h("div", { class: "mu-tabs", role: "tablist" }, [["foryou", "flame", "Für dich"], ["files", "camera", "Eigene"], ["favourites", "bookmark", "Gemerkt"]].map(([id, symbol, name]) => h("button", { class: `mu-tab${id === tab ? " on" : ""}`, type: "button", role: "tab",
      "aria-selected": String(id === tab), "aria-label": name, onclick: () => { tab = id; for (const t of tabs.children) { const on = t.dataset.id === id; t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on)); } show(); } }, icon(symbol), h("span", {}, name))));
    [...tabs.children].forEach((t, i) => { t.dataset.id = ["foryou", "files", "favourites"][i]; });
    const heading = h("h3", { class: "mu-heading" }, "Empfohlen");
    const videos = h("div", { class: "mu-videos", role: "list", hidden: true });
    const list = h("div", { class: "mu-list", role: "list" });
    const status = h("p", { class: "mu-status", role: "status" });
    const fileInput = h("input", { type: "file", accept: "audio/mpeg,audio/ogg,audio/mp4,audio/wav,.mp3,.ogg,.m4a,.wav", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const stopPreview = () => { if (preview) { preview.pause(); preview = null; } for (const row of list.querySelectorAll(".mu-row.playing")) row.classList.remove("playing"); };

    function toggleFavourite(item, button) {
      favs = favs.includes(item.id) ? favs.filter((id) => id !== item.id) : [item.id, ...favs];
      keepFavourites(favs);
      button.classList.toggle("on", favs.includes(item.id));
      fill(button, icon(favs.includes(item.id) ? "bookmarkFill" : "bookmark"));
      button.setAttribute("aria-pressed", String(favs.includes(item.id)));
      if (tab === "favourites") show();
    }
    function row(item) {
      const play = h("button", { class: "mu-cover", type: "button", "aria-label": `${item.title} anhören`, style: `background:linear-gradient(135deg,${(STYLES.find((s) => s[0] === item.tag) || STYLES[0])[1]},${(STYLES.find((s) => s[0] === item.tag) || STYLES[0])[2]})` }, icon("volume"));
      const starred = favs.includes(item.id);
      const star = h("button", { class: `mu-star${starred ? " on" : ""}`, type: "button", "aria-label": `${item.title} merken`, "aria-pressed": String(starred) }, icon(starred ? "bookmarkFill" : "bookmark"));
      const take = h("button", { class: "mu-add", type: "button", "aria-label": `${item.title} nehmen` }, icon("plus"));
      const start = h("input", { class: "mu-start", type: "range", min: 0, max: 0, value: 0, hidden: true, "aria-label": "Startpunkt im Song" });
      const startText = h("small", { class: "mu-startline", hidden: true });
      const wave = h("div", { class: "mu-wave", "aria-hidden": "true" }, Array.from({ length: 40 }, (_, i) => h("i", { style: `height:${20 + ((i * 37) % 80)}%` })));
      const line = h("div", { class: "mu-row", role: "listitem" }, h("div", { class: "mu-rowtop" }, play, h("div", { class: "mu-main" }, h("b", {}, item.title), h("small", {}, `${item.length ? `${minutes(item.length)} · ` : ""}${item.creator} · ${item.tag || item.licence}`)), star, take),
        h("div", { class: "mu-more" }, wave, start, startText));
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
      star.addEventListener("click", () => toggleFavourite(item, star));
      play.addEventListener("click", async () => {
        if (line.classList.contains("playing")) { stopPreview(); return; }
        stopPreview();
        line.classList.add("playing");
        const got = await resolve();
        if (!got) { line.classList.remove("playing"); return; }
        preview = new Audio(got.url);
        preview.volume = Math.max(0.2, Y.camSound ? Y.camSound.volume : 1);
        preview.addEventListener("loadedmetadata", () => { try { preview.currentTime = Number(start.value) || 0; } catch (error) { /* a stream without ranges */ } }, { once: true });
        preview.play().catch(() => { line.classList.remove("playing"); status.textContent = "Der Song lässt sich nicht abspielen."; });
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

    function show() {
      stopPreview();
      const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      let items = all.filter((item) => (!style || item.tag === style) && words.every((word) => `${item.title} ${item.creator} ${item.tag}`.toLowerCase().includes(word)));
      if (tab === "favourites") items = all.filter((item) => favs.includes(item.id) && words.every((word) => `${item.title} ${item.creator}`.toLowerCase().includes(word)));
      heading.textContent = tab === "favourites" ? "Deine Favoriten" : tab === "files" ? "Eigene Dateien" : style || (words.length ? "Gefunden" : "Empfohlen");
      videos.hidden = tab !== "foryou" || !!style || !!words.length || !videos.children.length;
      fill(list);
      if (tab === "files") {
        fill(list, h("div", { class: "mu-files" }, h("p", {}, "Nimm den Ton eines Videos von deinem Gerät. Nur der Ton wird benutzt, das Video bleibt bei dir. Nimm nur Ton, den du benutzen darfst. Du bist dafür verantwortlich."),
          h("button", { class: "mu-pick", type: "button", onclick: () => { fileInput.accept = "video/*,.mp4,.m4v,.mov,.webm"; fileInput.click(); } }, icon("camera"), "Video aus der Galerie wählen"),
          h("button", { class: "mu-pick", type: "button", onclick: () => { fileInput.accept = "audio/mpeg,audio/ogg,audio/mp4,audio/wav,.mp3,.ogg,.m4a,.wav"; fileInput.click(); } }, icon("file"), "Songdatei wählen")));
        status.textContent = "";
        return;
      }
      list.append(...items.map(row));
      status.textContent = items.length ? (tab === "foryou" ? `${all.length} ausgewählte Songs, frei benutzbar (Creative Commons).` : "") : tab === "favourites" ? "Noch keine Favoriten. Tippe bei einem Song auf das Lesezeichen." : "Dazu habe ich nichts gefunden. Probier ein anderes Wort.";
    }
    let typing = 0;
    input.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(show, 200); });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (!file) return;
      if (file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(file.name || "")) {      // the sound of a video of the device: nothing is uploaded, the file is played from the device
        stopPreview();
        entry.close();
        onPick({ src: "device", title: `Extrahierter Song ${deviceNumber()}`, creator: "dein Gerät", start: 0, url: URL.createObjectURL(file) });
        return;
      }
      if (file.size > 50_000_000) { status.textContent = "Die Datei ist zu groß (höchstens 50 MB)."; return; }
      status.textContent = "Der Song wird hochgeladen …";
      const up = await Api.uploadSong(file, file.name.replace(/\.[^.]+$/, ""));
      if (!up.ok) { status.textContent = up.data && up.data.error === "bad_audio" ? "Das ist keine Audio-Datei, die Satürn kennt (MP3, Ogg, M4A, WAV)." : Api.message(up); return; }
      entry.close();
      onPick({ src: "upload", media: up.data.media.id, title: up.data.media.title || file.name.replace(/\.[^.]+$/, ""), start: 0, url: up.data.media.url });
    });
    entry = dialog({ title, wide: true, body: h("div", { class: "music-picker mu-dark" }, h("div", { class: "mu-bar" }, h("span", { class: "mu-search-wrap" }, icon("search"), input)), styles, tabs, heading, videos, list, fileInput, status), initialFocus: window.matchMedia && matchMedia("(pointer: coarse)").matches ? tabs.firstChild : input, onClose: stopPreview });
    entry.box.classList.add("mu-box");
    // the songs, and the videos whose sound one can take
    Api.get("/music/search?q=&rows=100").then((reply) => {
      if (!reply.ok) { status.textContent = Api.message(reply); return; }
      all = reply.data.items;
      show();
    });
    // videos whose sound one can take: eight at first, more when the row is scrolled to its end (the same shuffle goes on); every card has a bookmark and a plus
    let videoSeed = 1 + Math.floor(Math.random() * 99999);
    let videoNext = 0;
    let loadingVideos = false;
    const seenVideos = new Set();
    const savedVideos = () => { try { const got = JSON.parse(localStorage.getItem(VIDEO_FAVS) || "[]"); return Array.isArray(got) ? got : []; } catch (error) { return []; } };
    const keepVideos = (list) => { try { localStorage.setItem(VIDEO_FAVS, JSON.stringify(list.slice(0, 60))); } catch (error) { /* no storage */ } };
    function videoCard(song, url) {
      const clip = h("video", { class: "mu-clip", src: `${url}#t=0.5`, muted: true, playsinline: true, preload: "metadata", "aria-hidden": "true" });
      let saved = savedVideos().some((v) => v.song.post === song.post);
      const star = h("button", { class: `mu-vstar${saved ? " on" : ""}`, type: "button", "aria-label": `${song.title} merken`, "aria-pressed": String(saved) }, icon(saved ? "bookmarkFill" : "bookmark"));
      const plus = h("button", { class: "mu-vadd", type: "button", "aria-label": `${song.title} nehmen` }, icon("plus"));
      star.addEventListener("click", (event) => {
        event.stopPropagation();
        saved = !saved;
        const rest = savedVideos().filter((v) => v.song.post !== song.post);
        keepVideos(saved ? [{ song, url }, ...rest] : rest);
        star.classList.toggle("on", saved);
        star.setAttribute("aria-pressed", String(saved));
        fill(star, icon(saved ? "bookmarkFill" : "bookmark"));
        if (tab === "favourites") show();
      });
      plus.addEventListener("click", (event) => { event.stopPropagation(); stopPreview(); entry.close(); onPick(song); });
      return h("div", { class: "mu-video", role: "listitem", tabindex: "0", "aria-label": song.title, onclick: () => { stopPreview(); entry.close(); onPick(song); } },
        clip, h("span", { class: "mu-video-name" }, song.title.replace("Extrahierter Song ", "Song ")), h("span", { class: "mu-video-by" }, song.creator), star, plus);
    }
    function paintVideos() {
      const list = tab === "favourites" ? savedVideos() : null;
      if (list) fill(videos, ...list.map((v) => videoCard(v.song, v.url)));
      else if (videos.dataset.mode === "saved") fill(videos, ...shownVideos);
      videos.dataset.mode = list ? "saved" : "feed";
    }
    const shownVideos = [];
    async function moreVideos() {
      if (loadingVideos || videoNext === null) return;
      loadingVideos = true;
      const reply = await Api.get(`/timeline?feed=videos&order=random&limit=8&seed=${videoSeed}&offset=${videoNext}`);
      loadingVideos = false;
      if (!reply.ok || !reply.data.items) return;
      videoNext = reply.data.next === null || reply.data.next === undefined ? null : reply.data.next;
      for (const post of reply.data.items) {
        const media = post.media && post.media.find((m) => m.video);
        if (!media || seenVideos.has(post.id) || (Y.me && post.user.handle === Y.me.handle)) continue;
        seenVideos.add(post.id);
        const card = videoCard(extractedSong(post, media), media.url);
        shownVideos.push(card);
        if (videos.dataset.mode !== "saved") videos.append(card);
      }
      show();
    }
    videos.addEventListener("scroll", () => { if (videos.scrollLeft + videos.clientWidth > videos.scrollWidth - 240) moreVideos(); }, { passive: true });
    moreVideos().then(() => { if (videos.scrollWidth <= videos.clientWidth + 40) moreVideos(); });
    const showOld = show;
    show = function showWithVideos() { showOld(); paintVideos(); videos.hidden = !(tab === "foryou" && !style && !input.value.trim() ? videos.children.length : tab === "favourites" && savedVideos().length); };
  }

  /* ------------------------------------------------------------------------------------------------ the player of a clip */
  /* One audio element for the song of the camera; `prepare(song, micStream)` makes it ready (also the mix with the microphone), `track()` is the sound for the recording, `play()` starts it. */
  const blobs = new Map();                                          // address -> {url} of a song that is loaded as a whole (the last three)
  function loadWhole(address) {
    const hit = blobs.get(address);
    if (hit) { blobs.delete(address); blobs.set(address, hit); return hit.ready; }
    const entry = { url: "", ready: null };
    entry.ready = fetch(address, { credentials: "same-origin" }).then((reply) => (reply.ok ? reply.blob() : Promise.reject(new Error("no song")))).then((blob) => { entry.url = URL.createObjectURL(blob); return entry.url; })
      .catch(() => { blobs.delete(address); return ""; });
    blobs.set(address, entry);
    while (blobs.size > 3) { const old = blobs.keys().next().value; const gone = blobs.get(old); blobs.delete(old); if (gone.url) URL.revokeObjectURL(gone.url); }
    return entry.ready;
  }

  function player() {
    let audio = null;
    let loaded = Promise.resolve();                                // the song is in the player (a whole file) or it plays from the server
    let generation = 0;
    let ctx = null;
    let gain = null;
    let dest = null;
    let mic = null;
    let song = null;
    const volumeNow = () => (Y.camSound ? Y.camSound.volume : 1);
    const follow = () => { if (gain) gain.gain.value = volumeNow(); else if (audio) audio.volume = volumeNow(); };
    function drop() {
      generation += 1;
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
      const mine = generation;
      const element = audio;
      loaded = (next.src === "device" ? Promise.resolve(next.url) : loadWhole(sameOriginUrl(next))).then((blobUrl) => new Promise((resolve) => {
        if (mine !== generation) { resolve(); return; }
        element.addEventListener("loadedmetadata", () => { try { if (next.start && element.duration > next.start + 5) element.currentTime = next.start; } catch (error) { /* no ranges */ } resolve(); }, { once: true });
        element.addEventListener("error", () => { if (mine === generation && Y.toast) Y.toast("Der Ton dieses Songs lässt sich nicht abspielen. Nimm einen anderen."); resolve(); }, { once: true });
        if (!blobUrl && (next.src === "video" || next.src === "upload") && Y.toast) Y.toast("Der Ton dieses Videos konnte nicht geladen werden.");
        element.src = blobUrl || urlOf(next);                       // (no whole file: it plays from the server)
        element.load();
      }));
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
        try { await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 4000))]); if (ctx && ctx.state === "suspended") await ctx.resume(); await audio.play(); } catch (error) { /* blocked: the song stays silent */ }
      },
      /* From the start of the song (its starting point) to the sound: resolves when the song really plays (or after `wait` milliseconds), so that a clip can begin at that moment. */
      async start(wait = 450) {
        if (!audio) return;
        this.rewind();
        await Promise.race([this.play(), new Promise((resolve) => setTimeout(resolve, wait))]);
      },
      pause() { if (audio) audio.pause(); },
      rewind() { if (audio) { try { audio.currentTime = (song && song.start) || 0; } catch (error) { /* no ranges */ } } },
      follow,
      destroy: drop,
    };
  }

  Y.music = { pick, player, credit, label, urlOf, extractedNumber, extractedSong, loadWhole };
})();
