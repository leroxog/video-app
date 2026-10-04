/* ysound: three views (Home, Neuer Song, Bibliothek) behind a bottom bar, one shared audio player.
   Everything that comes from users is put on the page with textContent, never as HTML. */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const VIEWS = ["home", "create", "library"];
  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 6v8M12 18v.5"/></svg>',
  };
  const ERRORS = {
    empty_title: "Gib deinem Song einen Namen.",
    bad_genres: "Wähle 1 bis 3 Genres aus.",
    lyrics_confirm: "Bestätige, dass der Songtext von dir ist.",
    already_generating: "Dein letzter Song wird noch erstellt. Warte kurz.",
    rate_limited: "Du hast gerade viele Songs gemacht. Probiere es in einer Weile wieder.",
    busy: "Gerade ist viel los. Probiere es in einer Minute noch einmal.",
    daily_cap: "Für heute sind alle Songs aufgebraucht. Morgen geht es weiter.",
    not_configured: "ysound ist noch nicht freigeschaltet: Der Musik-Dienst muss erst eingerichtet werden.",
    worker_offline: "Der Song-Rechner ist gerade aus. Probiere es später noch einmal.",
    network: "Keine Verbindung. Prüfe dein Internet und versuche es noch einmal.",
  };

  const audio = $("#audio");
  const state = {
    view: null, vocal: true, genres: new Set(), available: true, submitting: false, admin: false,
    feed: { items: [], next: null }, mine: { items: [], seen: new Map() },
    playingId: null, queue: [], pollTimer: null, seeking: false,
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  async function api(path, options = {}) {
    try {
      const response = await fetch(path, {
        credentials: "same-origin", headers: { "Content-Type": "application/json" }, ...options,
      });
      return await response.json();
    } catch (error) {
      return { ok: false, error: "network" };
    }
  }

  let toastTimer = null;
  function toast(message) {
    const box = $("#toast");
    box.textContent = message;
    box.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { box.hidden = true; }, 3800);
  }

  function clock(totalSeconds) {
    if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "0:00";
    const whole = Math.floor(totalSeconds);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
  }

  function ago(iso) {
    const seconds = (Date.now() - Date.parse(iso)) / 1000;
    if (!(seconds >= 0) || seconds < 60) return "gerade eben";
    if (seconds < 3600) return `vor ${Math.floor(seconds / 60)} Min.`;
    if (seconds < 86400) return `vor ${Math.floor(seconds / 3600)} Std.`;
    if (seconds < 7 * 86400) return `vor ${Math.floor(seconds / 86400)} Tg.`;
    return new Date(iso).toLocaleDateString("de-DE");
  }

  function gradient(song) {
    let hash = 7;
    for (const ch of song.title + song.genres.map((g) => g.id).join("")) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const first = hash % 360;
    const second = (first + 50 + ((hash >> 5) % 90)) % 360;
    return `linear-gradient(135deg, hsl(${first} 85% 58%), hsl(${second} 80% 46%))`;
  }

  // ------------------------------------------------------------------ views

  function show(view) {
    if (!VIEWS.includes(view)) view = "create";
    state.view = view;
    for (const name of VIEWS) $(`#view-${name}`).hidden = name !== view;
    for (const tab of document.querySelectorAll("[data-go]")) tab.classList.toggle("active", tab.dataset.go === view);
    if (location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
    window.scrollTo(0, 0);
    if (view === "home") loadFeed(true);
    if (view === "library") loadMine();
    if (view === "create") refreshStatus();
  }

  // ------------------------------------------------------------------ cards

  function card(song, context) {
    const playable = song.status === "ready" && song.audio_url;
    const root = el("article", "song");
    root.dataset.id = song.id;

    const row = el("div", "song-row");
    const art = el("button", "art");
    art.type = "button";
    art.style.background = gradient(song);
    art.disabled = !playable;
    if (playable) {
      art.setAttribute("aria-label", `${song.title} abspielen`);
      art.addEventListener("click", () => play(song, context));
    } else if (song.status === "generating") {
      art.append(el("div", "spinner"));
      art.setAttribute("aria-label", "Wird erstellt");
    } else {
      art.innerHTML = ICON.warn;
      art.setAttribute("aria-label", "Fehlgeschlagen");
    }
    art.dataset.role = "art";

    const meta = el("div", "meta");
    const title = el("h3", "", song.title);
    if (song.mine && context === "home") title.append(el("span", "badge mine", "Du"));
    if (song.demo) title.append(el("span", "badge demo", "Testton"));
    if (state.admin && song.reports > 0) title.append(el("span", "badge warn", `⚑ ${song.reports}`));
    const tags = [song.with_vocals ? "Sprachlich" : "Instrumental", ...song.genres.map((g) => g.label)].join(" · ");
    meta.append(title, el("div", "tags", tags));
    if (song.status === "generating") {
      meta.append(el("div", "status-line", song.queued
        ? "Wartet auf den Song-Rechner … gleich bist du dran."
        : "Wird erstellt … das kann ein paar Minuten dauern."));
    } else if (song.status === "failed") {
      meta.append(el("div", "status-line bad", song.error || "Das hat nicht geklappt."));
    } else {
      meta.append(el("div", "when", `${clock(song.duration)} · ${ago(song.created_at)}`));
    }
    row.append(art, meta);

    const hasDetail = song.description || song.lyrics || song.mine || state.admin || (context === "home" && playable);
    if (hasDetail) {
      const expand = el("button", "expand");
      expand.type = "button";
      expand.innerHTML = ICON.chevron;
      expand.setAttribute("aria-label", "Details anzeigen");
      expand.setAttribute("aria-expanded", "false");
      row.append(expand);
      root.append(row);

      const detail = el("div", "detail");
      detail.hidden = true;
      if (song.description) {
        detail.append(el("div", "label", "Beschreibung"), el("p", "", song.description));
      }
      if (song.lyrics) {
        detail.append(el("div", "label", "Songtext"), el("pre", "", song.lyrics));
      }
      const actions = el("div", "actions");
      if (song.mine || state.admin) {
        const remove = el("button", "btn danger", "Löschen");
        remove.type = "button";
        remove.addEventListener("click", () => removeSong(song));
        actions.append(remove);
      }
      if (!song.mine && playable) {
        const report = el("button", "btn", "Melden");
        report.type = "button";
        report.addEventListener("click", () => reportSong(song, report));
        actions.append(report);
      }
      if (actions.children.length) detail.append(actions);
      root.append(detail);
      expand.addEventListener("click", () => {
        const open = detail.hidden;
        detail.hidden = !open;
        root.classList.toggle("open", open);
        expand.setAttribute("aria-expanded", String(open));
      });
    } else {
      root.append(row);
    }
    return root;
  }

  function renderList(container, songs, context) {
    container.replaceChildren(...songs.map((song) => card(song, context)));
    syncPlaying();
  }

  // --------------------------------------------------------------- loading

  async function loadFeed(reset) {
    const before = reset ? "" : `?before=${state.feed.next}`;
    const data = await api(`/api/ysound/songs${before}`);
    if (!data.ok) {
      if (reset) toast(ERRORS[data.error] || "Die Songs konnten nicht geladen werden.");
      return;
    }
    state.feed.items = reset ? data.songs : state.feed.items.concat(data.songs);
    state.feed.next = data.next_before;
    renderList($("#homeList"), state.feed.items, "home");
    $("#homeEmpty").hidden = state.feed.items.length > 0;
    $("#homeMore").hidden = !state.feed.next;
  }

  async function loadMine() {
    const data = await api("/api/ysound/mine");
    if (!data.ok) return;
    for (const song of data.songs) {
      const before = state.mine.seen.get(song.id);
      if (before === "generating" && song.status === "ready") toast(`„${song.title}“ ist fertig!`);
      if (before === "generating" && song.status === "failed") toast(`„${song.title}“: ${song.error || "Das hat nicht geklappt."}`);
      state.mine.seen.set(song.id, song.status);
    }
    state.mine.items = data.songs;
    if (state.view === "library" || state.view === null) {
      renderList($("#libList"), data.songs, "library");
      $("#libEmpty").hidden = data.songs.length > 0;
    }
    clearTimeout(state.pollTimer);
    if (data.songs.some((song) => song.status === "generating")) {
      state.pollTimer = setTimeout(loadMine, 3000);
    }
  }

  async function refreshStatus() {
    const data = await api("/api/ysound/status");
    if (!data.ok) return;
    state.admin = data.is_admin;
    state.available = data.available;
    $("#demoBadge").hidden = !data.demo;
    const note = $("#availNote");
    if (!data.available) {
      note.textContent = ERRORS[data.reason] || "Gerade kann kein Song erstellt werden.";
      note.hidden = false;
    } else if (data.demo) {
      note.textContent = "Demo-Modus: Es entsteht nur ein einfacher Testton, keine KI-Musik.";
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    updateGo();
  }

  // ------------------------------------------------------------------ form

  function updateGo() {
    const button = $("#goBtn");
    button.disabled = state.submitting || !state.available;
    button.textContent = state.submitting ? "Wird gestartet …" : "Erstellen";
  }

  function updateGenres() {
    const max = Number($("#genres").dataset.max);
    $("#genreCount").textContent = `${state.genres.size}/${max}`;
    $("#genreCount").classList.toggle("full", state.genres.size >= max);
    $("#genres").classList.toggle("full", state.genres.size >= max);
  }

  function updateOwn() {
    $("#ownRow").hidden = !(state.vocal && $("#fLyrics").value.trim());
  }

  function showFormError(message) {
    const box = $("#formError");
    box.textContent = message || "";
    box.hidden = !message;
  }

  async function submit(event) {
    event.preventDefault();
    showFormError("");
    const title = $("#fTitle").value.trim();
    const lyrics = state.vocal ? $("#fLyrics").value.trim() : "";
    if (!title) return showFormError(ERRORS.empty_title);
    if (!state.genres.size) return showFormError(ERRORS.bad_genres);
    if (lyrics && !$("#fOwn").checked) return showFormError(ERRORS.lyrics_confirm);
    state.submitting = true;
    updateGo();
    const data = await api("/api/ysound/songs", {
      method: "POST",
      body: JSON.stringify({
        title, with_vocals: state.vocal, lyrics, own_lyrics: $("#fOwn").checked,
        description: $("#fDesc").value.trim(), genres: [...state.genres],
      }),
    });
    state.submitting = false;
    if (!data.ok) {
      showFormError(ERRORS[data.error] || "Das hat nicht geklappt. Versuche es noch einmal.");
      if (["daily_cap", "not_configured", "worker_offline"].includes(data.error)) refreshStatus();
      updateGo();
      return;
    }
    for (const id of ["#fTitle", "#fLyrics", "#fDesc"]) $(id).value = "";
    $("#fOwn").checked = false;
    state.genres.clear();
    for (const chip of document.querySelectorAll(".chip")) chip.setAttribute("aria-pressed", "false");
    updateGenres();
    updateOwn();
    updateGo();
    state.mine.seen.set(data.song.id, "generating");
    toast("Dein Song wird erstellt …");
    show("library");
  }

  // ------------------------------------------------------------------ player

  function setPlayerArt(song) {
    $("#playerArt").style.background = gradient(song);
    $("#playerTitle").textContent = song.title;
  }

  function play(song, context) {
    if (state.playingId === song.id) {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
      return;
    }
    const list = context === "library" ? state.mine.items : state.feed.items;
    state.queue = list.filter((item) => item.status === "ready" && item.audio_url);
    start(song);
  }

  function start(song) {
    state.playingId = song.id;
    audio.src = song.audio_url;
    setPlayerArt(song);
    $("#player").hidden = false;
    document.body.classList.add("has-player");
    audio.play().catch(() => toast("Der Song konnte nicht abgespielt werden."));
    if ("mediaSession" in navigator && window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: song.title, artist: "ysound" });
    }
    syncPlaying();
  }

  function syncPlaying() {
    const running = state.playingId != null && !audio.paused;
    $("#playPause").innerHTML = running ? ICON.pause : ICON.play;
    for (const root of document.querySelectorAll(".song")) {
      const mine = Number(root.dataset.id) === state.playingId;
      root.classList.toggle("playing", mine);
      const art = $('[data-role="art"]', root);
      if (!art || art.disabled) continue;
      art.replaceChildren();
      if (mine && running) {
        const bars = el("div", "eq");
        bars.append(el("i"), el("i"), el("i"));
        art.append(bars);
      } else {
        art.innerHTML = ICON.play;
      }
    }
  }

  function closePlayer() {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    state.playingId = null;
    $("#player").hidden = true;
    document.body.classList.remove("has-player");
    syncPlaying();
  }

  audio.addEventListener("play", syncPlaying);
  audio.addEventListener("pause", syncPlaying);
  audio.addEventListener("error", () => {
    if (state.playingId != null) toast("Der Song konnte nicht abgespielt werden.");
  });
  audio.addEventListener("timeupdate", () => {
    if (state.seeking || !Number.isFinite(audio.duration) || !audio.duration) return;
    $("#seek").value = String(Math.round((audio.currentTime / audio.duration) * 1000));
    $("#timeLabel").textContent = clock(audio.currentTime);
  });
  audio.addEventListener("ended", () => {
    const index = state.queue.findIndex((item) => item.id === state.playingId);
    const next = index >= 0 ? state.queue[index + 1] : null;
    if (next) start(next); else syncPlaying();
  });
  $("#seek").addEventListener("input", (event) => {
    state.seeking = true;
    if (Number.isFinite(audio.duration)) {
      const target = (Number(event.target.value) / 1000) * audio.duration;
      $("#timeLabel").textContent = clock(target);
    }
  });
  $("#seek").addEventListener("change", (event) => {
    if (Number.isFinite(audio.duration)) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
    state.seeking = false;
  });
  $("#playPause").addEventListener("click", () => {
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  });
  $("#playerClose").addEventListener("click", closePlayer);

  // ----------------------------------------------------------------- actions

  async function removeSong(song) {
    if (!confirm(`„${song.title}“ wirklich löschen?`)) return;
    const data = await api(`/api/ysound/songs/${song.id}`, { method: "DELETE" });
    if (!data.ok) return toast("Das Löschen hat nicht geklappt.");
    if (state.playingId === song.id) closePlayer();
    state.feed.items = state.feed.items.filter((item) => item.id !== song.id);
    state.mine.items = state.mine.items.filter((item) => item.id !== song.id);
    renderList($("#homeList"), state.feed.items, "home");
    renderList($("#libList"), state.mine.items, "library");
    $("#homeEmpty").hidden = state.feed.items.length > 0;
    $("#libEmpty").hidden = state.mine.items.length > 0;
    toast("Song gelöscht.");
  }

  async function reportSong(song, button) {
    const data = await api(`/api/ysound/songs/${song.id}/report`, { method: "POST" });
    if (data.ok) {
      button.disabled = true;
      button.textContent = "Gemeldet";
      toast("Danke für den Hinweis.");
    } else {
      toast("Das Melden hat nicht geklappt.");
    }
  }

  // -------------------------------------------------------------------- init

  for (const tab of document.querySelectorAll("[data-go]")) {
    tab.addEventListener("click", () => show(tab.dataset.go));
  }
  for (const button of document.querySelectorAll(".seg button")) {
    button.addEventListener("click", () => {
      state.vocal = button.dataset.vocal === "1";
      for (const other of document.querySelectorAll(".seg button")) {
        const on = other === button;
        other.classList.toggle("on", on);
        other.setAttribute("aria-pressed", String(on));
      }
      $("#lyricsBox").hidden = !state.vocal;
      updateOwn();
    });
  }
  $("#fLyrics").addEventListener("input", updateOwn);
  $("#genres").addEventListener("click", (event) => {
    const chip = event.target.closest(".chip");
    if (!chip) return;
    const id = chip.dataset.id;
    const max = Number($("#genres").dataset.max);
    if (state.genres.has(id)) {
      state.genres.delete(id);
    } else if (state.genres.size >= max) {
      return toast(`Du kannst höchstens ${max} Genres wählen.`);
    } else {
      state.genres.add(id);
    }
    chip.setAttribute("aria-pressed", String(state.genres.has(id)));
    updateGenres();
  });
  $("#createForm").addEventListener("submit", submit);
  $("#homeMore").addEventListener("click", () => loadFeed(false));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.view === "create") refreshStatus();
  });

  updateGenres();
  syncPlaying();
  show(location.hash.slice(1) || "create");
  loadMine();   // picks up a song that was still being made when the page was reloaded
})();
