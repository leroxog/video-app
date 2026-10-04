(function () {
  "use strict";
  var cfg = window.NRS_MUSIC;
  var $ = function (id) { return document.getElementById(id); };
  var genreById = {};
  cfg.genres.forEach(function (g) { genreById[g.id] = g; });

  var PLAY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  var HEART = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.6-9.5-9.3C1.2 8.4 3 5 6.3 5c2 0 3.2 1.1 3.7 2 .5-.9 1.7-2 3.7-2C17 5 18.800 8.400 17.500 11.700 15.500 16.400 12 21 12 21z" transform="translate(1 0)"/></svg>';
  var TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function icon(node, svg) { node.innerHTML = svg; return node; }
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function pref(key, fallback) { try { var v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; } }
  function setPref(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable: preference just isn't remembered */ } }

  function api(url, body, method) {
    var options = { method: method || (body === undefined ? "GET" : "POST") };
    if (body !== undefined) { options.headers = { "Content-Type": "application/json" }; options.body = JSON.stringify(body); }
    return fetch(url, options).then(function (r) { return r.json().then(function (j) { j.status = r.status; return j; }); });
  }

  var toastTimer = null;
  function toast(message) {
    var old = document.querySelector(".ms-toast");
    if (old) old.remove();
    var t = el("div", "ms-toast", message);
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.remove(); }, 2800);
  }

  /* ----------------------------------------------------------------- covers */

  function hash(n) { return ((n * 2654435761) >>> 0) / 4294967296; }

  function paintCover(node, song) {
    node.textContent = "";
    var p = song.palette && song.palette.length === 3 ? song.palette : ["#35e0c0", "#7c8cff", "#101018"];
    var a = Math.round(hash(song.id * 3 + 1) * 100), b = Math.round(hash(song.id * 5 + 2) * 100), angle = Math.round(hash(song.id) * 360);
    node.style.background = "radial-gradient(circle at " + a + "% " + b + "%, " + p[0] + ", transparent 60%), radial-gradient(circle at "
      + (100 - a) + "% " + (100 - b) + "%, " + p[1] + ", transparent 62%), linear-gradient(" + angle + "deg, " + p[2] + ", #14141c)";
    node.appendChild(el("span", "emoji", song.emoji));
    if (song.cover_url) {
      var img = document.createElement("img");
      img.alt = "";
      img.onload = function () { var e = node.querySelector(".emoji"); if (e) e.remove(); };
      img.onerror = function () { img.remove(); };
      img.src = song.cover_url;
      node.appendChild(img);
    }
  }

  function coverEl(song, small) {
    var node = el("div", "ms-cover" + (small ? " small" : ""));
    paintCover(node, song);
    return node;
  }

  /* ----------------------------------------------------------------- songs UI */

  var known = {};  // id -> latest song object, so likes and play counts stay in sync

  function remember(songs) { songs.forEach(function (s) { known[s.id] = s; }); return songs; }

  function setHeart(node, song) {
    node.classList.toggle("on", !!song.liked);
    node.setAttribute("aria-label", song.liked ? "Aus Gefällt mir entfernen" : "Gefällt mir");
  }

  function toggleLike(song) {
    if (cfg.isGuest) { toast("Melde dich an, um Songs zu mögen."); return; }
    api("/api/music/songs/" + song.id + "/like", {}).then(function (j) {
      if (!j.ok) return;
      song.liked = j.liked; song.likes = j.likes;
      document.querySelectorAll('[data-heart="' + song.id + '"]').forEach(function (n) { setHeart(n, song); });
      if (view === "library" && libTab === "liked") loadLibrary();
    });
  }

  function cardEl(song, list) {
    var card = el("button", "ms-card");
    card.type = "button";
    card.appendChild(coverEl(song));
    card.appendChild(icon(el("span", "ms-playfab"), PLAY_ICON));
    card.appendChild(el("div", "ms-card-title", song.title));
    card.appendChild(el("div", "ms-card-sub", song.genre_label + " · " + song.creator));
    card.addEventListener("click", function () { Player.play(song, list); });
    return card;
  }

  function rowEl(song, list, mode) {
    var row = el("div", "ms-row");
    row.dataset.songId = song.id;
    var main = el("div", "ms-row-main");
    main.appendChild(coverEl(song, true));
    var text = el("div", "");
    text.style.minWidth = 0;
    text.appendChild(el("div", "ms-row-title", song.title));
    var sub = song.status === "failed" ? song.error : song.creator + (song.with_vocals ? " · mit Gesang" : "");
    text.appendChild(el("div", "ms-row-sub", sub));
    main.appendChild(text);
    row.appendChild(main);
    row.appendChild(el("div", "hide-m", song.genre_label));
    row.appendChild(el("div", "num hide-m", song.status === "ready" ? song.plays + " Aufrufe" : ""));
    var last = el("div", "num", song.status === "ready" ? fmt(song.duration) : "");
    if (song.status !== "ready") last.appendChild(el("span", "ms-status " + song.status, { composing: "Wird erstellt …", failed: "Fehlgeschlagen", hidden: "Gemeldet" }[song.status] || song.status));
    row.appendChild(last);
    var end = el("div", "");
    if (mode === "mine") {
      var del = el("button", "ms-del"); del.type = "button"; del.setAttribute("aria-label", "Löschen"); icon(del, TRASH);
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (window.confirm("Diesen Song wirklich löschen?")) api("/api/music/songs/" + song.id, undefined, "DELETE").then(loadLibrary);
      });
      end.appendChild(del);
    } else if (mode === "hidden") {
      var restore = el("button", "ms-pill dark", "Freigeben"); restore.type = "button";
      restore.addEventListener("click", function (e) { e.stopPropagation(); api("/api/music/songs/" + song.id + "/restore", {}).then(loadLibrary); });
      end.appendChild(restore);
    } else if (song.status === "ready") {
      var heart = el("button", "ms-heart"); heart.type = "button"; heart.dataset.heart = song.id; icon(heart, HEART); setHeart(heart, song);
      heart.addEventListener("click", function (e) { e.stopPropagation(); toggleLike(song); });
      end.appendChild(heart);
    }
    row.appendChild(end);
    if (song.status === "ready") row.addEventListener("click", function () { Player.play(song, list); });
    if (Player.current() && Player.current().id === song.id) row.classList.add("playing");
    return row;
  }

  function fillShelf(node, songs) {
    node.textContent = "";
    if (!songs.length) { node.appendChild(el("div", "ms-empty", "Noch nichts da. Erstelle den ersten Song!")); node.style.display = "block"; return; }
    node.style.display = "";
    songs.slice(0, 12).forEach(function (s) { node.appendChild(cardEl(s, songs)); });
  }

  function fillRows(node, songs, mode, emptyText) {
    node.textContent = "";
    if (!songs.length) { node.appendChild(el("div", "ms-empty", emptyText)); return; }
    songs.forEach(function (s) { node.appendChild(rowEl(s, songs.filter(function (x) { return x.status === "ready"; }), mode)); });
  }

  function genreTiles(node, onPick) {
    node.textContent = "";
    cfg.genres.forEach(function (g) {
      var tile = el("button", "ms-tile", g.label);
      tile.type = "button";
      tile.style.background = "linear-gradient(135deg, " + g.colors[0] + ", " + g.colors[2] + ")";
      tile.appendChild(el("span", "emoji", g.emoji));
      tile.addEventListener("click", function () { onPick(g.id); });
      node.appendChild(tile);
    });
  }

  /* ------------------------------------------------------------------ views */

  var view = "home", libTab = "mine", genreFilter = null, searchTimer = null, libTimer = null;
  var views = { home: $("viewHome"), search: $("viewSearch"), library: $("viewLibrary"), create: $("viewCreate") };

  function showView(name) {
    view = name;
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
    document.querySelectorAll("#msNav button, #msBottomNav button").forEach(function (b) { b.classList.toggle("active", b.dataset.view === name); });
    $("msSearchBox").hidden = name !== "search";
    $("msOverlay").hidden = true;
    $("msScroll").scrollTop = 0;
    clearInterval(libTimer);
    if (name === "home") loadHome();
    if (name === "search") { loadSearch(); if (!genreFilter) $("msSearch").focus(); }
    if (name === "library") loadLibrary();
  }

  document.querySelectorAll("#msNav button, #msBottomNav button").forEach(function (b) {
    b.addEventListener("click", function () { if (b.dataset.view === "search") genreFilter = null; showView(b.dataset.view); });
  });
  document.querySelectorAll("[data-goto]").forEach(function (b) { b.addEventListener("click", function () { showView(b.dataset.goto); }); });

  function openGenre(id) { genreFilter = id; $("msSearch").value = ""; showView("search"); }

  // sidebar genre list
  cfg.genres.forEach(function (g) {
    var b = el("button", "");
    b.type = "button";
    var dot = el("span", "dot", g.emoji);
    dot.style.background = "linear-gradient(135deg, " + g.colors[0] + ", " + g.colors[2] + ")";
    b.appendChild(dot);
    b.appendChild(el("span", "", g.label));
    b.addEventListener("click", function () { openGenre(g.id); });
    $("msGenreList").appendChild(b);
  });

  // ---- home
  function loadHome() {
    var hour = new Date().getHours();
    $("msGreeting").textContent = hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";
    api("/api/music/songs?sort=new").then(function (j) { if (j.ok) fillShelf($("shelfNew"), remember(j.songs)); });
    api("/api/music/songs?sort=popular").then(function (j) { if (j.ok) fillShelf($("shelfPop"), remember(j.songs)); });
    genreTiles($("homeTiles"), openGenre);
  }

  // ---- search
  function loadSearch() {
    var q = $("msSearch").value.trim();
    if (!q && !genreFilter) {
      $("searchTitle").textContent = "Alles durchsuchen";
      genreTiles($("searchTiles"), openGenre);
      $("searchTiles").hidden = false;
      $("searchResultsWrap").hidden = true;
      return;
    }
    $("searchTiles").hidden = true;
    $("searchResultsWrap").hidden = false;
    $("searchTitle").textContent = genreFilter ? genreById[genreFilter].label : "Ergebnisse";
    var url = "/api/music/songs?sort=popular" + (genreFilter ? "&genre=" + genreFilter : "") + (q ? "&q=" + encodeURIComponent(q) : "");
    api(url).then(function (j) { if (j.ok) fillRows($("searchResults"), remember(j.songs), "search", "Keine Songs gefunden."); });
  }
  $("msSearch").addEventListener("input", function () { clearTimeout(searchTimer); searchTimer = setTimeout(loadSearch, 250); });

  // ---- library
  document.querySelectorAll("#libTabs .ms-tab").forEach(function (t) {
    t.addEventListener("click", function () {
      libTab = t.dataset.lib;
      document.querySelectorAll("#libTabs .ms-tab").forEach(function (x) { x.classList.toggle("active", x === t); });
      loadLibrary();
    });
  });

  function loadLibrary() {
    if (cfg.isGuest) {
      var rows = $("libRows"); rows.textContent = "";
      var box = el("div", "ms-empty", "Melde dich an, um deine Songs und Favoriten zu sehen. ");
      var link = el("a", "ms-pill", "Anmelden"); link.href = "/logout"; box.appendChild(link);
      rows.appendChild(box);
      return;
    }
    api("/api/music/library").then(function (j) {
      if (!j.ok) return;
      remember(j.mine); remember(j.liked);
      var data = libTab === "liked" ? j.liked : libTab === "hidden" ? (j.hidden || []) : j.mine;
      var empty = libTab === "liked" ? "Du hast noch keinen Song mit einem Herz markiert." : libTab === "hidden" ? "Nichts gemeldet." : "Du hast noch keinen Song erstellt.";
      fillRows($("libRows"), data, libTab === "mine" ? "mine" : libTab === "hidden" ? "hidden" : "liked", empty);
      clearInterval(libTimer);
      if (j.mine.some(function (s) { return s.status === "composing"; })) libTimer = setInterval(function () { if (view === "library") loadLibrary(); }, 3000);
    });
  }

  /* --------------------------------------------------------------- create */

  var chosenGenre = cfg.genres[0].id;
  var form = $("createForm");

  if (form) {
    var chips = $("fGenres");
    cfg.genres.forEach(function (g) {
      var c = el("button", "ms-gchip" + (g.id === chosenGenre ? " active" : ""), g.emoji + " " + g.label);
      c.type = "button";
      c.addEventListener("click", function () {
        chosenGenre = g.id;
        chips.querySelectorAll(".ms-gchip").forEach(function (x) { x.classList.toggle("active", x === c); });
      });
      chips.appendChild(c);
    });

    var len = $("fLen");
    function showLen() { $("fLenOut").textContent = fmt(Number(len.value)); len.style.setProperty("--p", ((len.value - len.min) / (len.max - len.min) * 100) + "%"); }
    len.addEventListener("input", showLen); showLen();

    $("fVocals").addEventListener("change", function () { $("lyricsBox").hidden = !this.checked; });
    $("fLyrics").addEventListener("input", function () { $("ownBox").hidden = !this.value.trim(); });

    var ERRORS = {
      empty_title: "Gib deinem Song einen Namen.", bad_genre: "Wähle ein Genre.",
      bad_duration: "Wähle eine Länge zwischen 0:15 und 2:30.",
      lyrics_confirm: "Bitte bestätige, dass du den Text selbst geschrieben hast.",
      limit_reached: "Du hast schon 15 Songs. Lösche zuerst einen.",
      rate_limited: "Du hast gerade viele Songs erstellt. Warte etwas.",
      busy: "Die KI ist gerade ausgelastet. Versuch es in einer Minute noch einmal.",
      not_logged_in: "Bitte melde dich an.",
    };
    var stepTimer = null, pollTimer = null;

    function steps(vocals) {
      return ["Unsere KI plant Tempo, Tonart und Akkorde …", "Die KI feilt an der Stimmung …"]
        .concat(vocals ? ["Der Text wird geschrieben …"] : [])
        .concat(["Das Cover wird gemalt …", "Letzter Schliff …"]);
    }

    function showForm() {
      clearInterval(stepTimer); clearInterval(pollTimer);
      $("createWrap").hidden = false; $("createProgress").hidden = true; $("createDone").hidden = true;
      $("fGo").disabled = false;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      $("fError").textContent = "";
      var vocals = $("fVocals").checked;
      $("fGo").disabled = true;
      api("/api/music/songs", {
        title: $("fTitle").value, genre: chosenGenre, duration: Number(len.value), description: $("fDesc").value,
        with_vocals: vocals, lyrics: vocals ? $("fLyrics").value : "", own_lyrics: $("fOwn").checked,
      }).then(function (j) {
        if (!j.ok) { $("fError").textContent = ERRORS[j.error] || "Das hat nicht geklappt."; $("fGo").disabled = false; return; }
        $("createWrap").hidden = true; $("createProgress").hidden = false;
        var list = steps(vocals), i = 0;
        $("progStep").textContent = list[0];
        stepTimer = setInterval(function () { i = Math.min(i + 1, list.length - 1); $("progStep").textContent = list[i]; }, 4000);
        var tries = 0;
        pollTimer = setInterval(function () {
          tries++;
          api("/api/music/songs/" + j.song.id).then(function (r) {
            if (!r.ok) return;
            var song = remember([r.song])[0];
            if (song.status === "ready") {
              clearInterval(stepTimer); clearInterval(pollTimer);
              $("createProgress").hidden = true; $("createDone").hidden = false;
              paintCover($("doneCover"), song);
              $("doneTitle").textContent = song.title;
              $("doneSub").textContent = song.genre_label + " · " + fmt(song.duration) + " · " + song.license;
              $("donePlay").onclick = function () { Player.play(song, [song]); };
            } else if (song.status === "failed" || tries > 70) {
              showForm();
              $("fError").textContent = song.error || "Das hat zu lange gedauert. Versuch es noch einmal.";
            }
          });
        }, 2500);
      });
    });

    $("doneAgain").addEventListener("click", function () { form.reset(); showLen(); $("lyricsBox").hidden = true; showForm(); });
  }

  /* --------------------------------------------------------------- player */

  var Player = (function () {
    var ctx = null, gain = null, analyser = null, source = null, buffer = null, song = null, queue = [], index = -1;
    var startedAt = 0, pausedAt = 0, playing = false, token = 0, counted = false, cache = [], cueTimers = [], cues = [];
    var volume = clamp(Number(pref("nrs-vol", "80")) / 100, 0, 1), vocalOn = pref("nrs-vocal", "1") === "1";

    function ensureCtx() {
      if (!ctx) {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        gain = ctx.createGain(); gain.gain.value = volume;
        analyser = ctx.createAnalyser(); analyser.fftSize = 128; analyser.smoothingTimeConstant = 0.8;
        analyser.connect(gain); gain.connect(ctx.destination);
      }
      if (ctx.state === "suspended") ctx.resume();
    }

    function position() { return clamp(playing ? ctx.currentTime - startedAt : pausedAt, 0, song ? song.duration : 0); }

    function getBuffer(s) {
      for (var i = 0; i < cache.length; i++) if (cache[i].id === s.id) return Promise.resolve(cache[i].buffer);
      return NRSSynth.render(s.plan, function (p) { $("msRender").style.transform = "scaleX(" + p + ")"; }).then(function (b) {
        cache.push({ id: s.id, buffer: b });
        if (cache.length > 3) cache.shift();
        return b;
      });
    }

    function ensureLyrics(s) {
      if (!s.with_vocals || s.lyrics !== undefined) return Promise.resolve();
      return api("/api/music/songs/" + s.id).then(function (j) { s.lyrics = j.ok ? j.song.lyrics : ""; });
    }

    function stopSource() {
      if (source) { source.onended = null; try { source.stop(); } catch (e) { /* already stopped */ } source.disconnect(); source = null; }
      clearCues();
    }

    function clearCues() {
      cueTimers.forEach(clearTimeout); cueTimers = [];
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    }

    function speak(cue) {
      if (!vocalOn || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(cue.text);
      u.lang = "de-DE"; u.rate = clamp(cue.text.length / (15 * cue.d), 0.7, 1.7); u.pitch = 1.2; u.volume = volume;
      window.speechSynthesis.speak(u);
    }

    function scheduleCues(from) {
      clearCues();
      if (!song.with_vocals || !song.lyrics) { cues = []; return; }
      cues = NRSSynth.lyricCues(song.plan, song.lyrics);
      cues.forEach(function (c) {
        if (c.t + c.d <= from) return;
        cueTimers.push(setTimeout(function () { speak(c); }, Math.max(0, c.t - from) * 1000));
      });
    }

    function begin(offset) {
      stopSource();
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);
      var mine = token;
      source.onended = function () { if (mine === token && playing && position() >= song.duration - 0.4) next(true); };
      startedAt = ctx.currentTime - offset;
      source.start(0, offset);
      playing = true;
      scheduleCues(offset);
      syncControls();
      startUi();
    }

    function play(s, list) {
      token++;
      var mine = token;
      queue = (list && list.length ? list : [s]).filter(function (x) { return x.status === "ready"; });
      index = Math.max(0, queue.findIndex(function (x) { return x.id === s.id; }));
      if (!queue.length) queue = [s];
      stopSource(); playing = false; pausedAt = 0; song = s; counted = false;
      ensureCtx();
      setNow(s);
      $("plSub").textContent = "Wird für dich gerendert …";
      $("msRender").style.transform = "scaleX(0.02)";
      return Promise.all([ensureLyrics(s), getBuffer(s)]).then(function (res) {
        if (mine !== token) return;
        buffer = res[1];
        $("msRender").style.transform = "scaleX(0)";
        $("plSub").textContent = s.creator;
        begin(0);
        renderOverlay();
      }).catch(function () { $("msRender").style.transform = "scaleX(0)"; toast("Der Song konnte nicht abgespielt werden."); });
    }

    function toggle() {
      if (!song || !buffer) return;
      ensureCtx();
      if (playing) { pausedAt = position(); playing = false; stopSource(); stopUi(); syncControls(); }
      else begin(pausedAt >= song.duration - 0.2 ? 0 : pausedAt);
    }

    function seek(fraction) {
      if (!song || !buffer) return;
      pausedAt = clamp(fraction, 0, 1) * song.duration;
      if (playing) begin(pausedAt); else updateBar();
    }

    function next(auto) {
      if (index < queue.length - 1) { play(queue[index + 1], queue); }
      else if (auto) { playing = false; pausedAt = 0; stopSource(); stopUi(); syncControls(); updateBar(); }
    }

    function prev() {
      if (position() > 3 || index <= 0) seek(0); else play(queue[index - 1], queue);
    }

    function setVolume(v) {
      volume = clamp(v, 0, 1); setPref("nrs-vol", String(Math.round(volume * 100)));
      if (gain) gain.gain.value = volume;
    }

    function setVocal(on) { vocalOn = on; setPref("nrs-vocal", on ? "1" : "0"); if (!on) clearCues(); else if (playing) scheduleCues(position()); }

    function updateBar() {
      var dur = song ? song.duration : 0, pos = position();
      $("plCur").textContent = fmt(pos); $("plDur").textContent = fmt(dur);
      var frac = dur ? pos / dur : 0;
      $("plSeek").value = Math.round(frac * 1000);
      $("plSeek").style.setProperty("--p", (frac * 100) + "%");
    }

    function drawVisual() {
      var canvas = $("ovVis");
      if ($("msOverlay").hidden || !analyser) return;
      var c = canvas.getContext("2d"), data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      c.clearRect(0, 0, canvas.width, canvas.height);
      var bars = 40, w = canvas.width / bars;
      for (var i = 0; i < bars; i++) {
        var v = data[Math.floor(i * data.length * 0.7 / bars)] / 255, h = Math.max(3, v * canvas.height);
        c.fillStyle = "rgba(53, 224, 192, " + (0.35 + v * 0.65) + ")";
        c.fillRect(i * w + 2, canvas.height - h, w - 4, h);
      }
    }

    var uiTimer = null, visualOn = false;

    // Position, play counting and the lyric highlight run on a timer, which keeps working in a background tab
    // (animation frames don't), so plays are still counted when someone listens while doing something else.
    function update() {
      if (!playing) return;
      updateBar();
      var pos = position();
      if (!counted && song && pos > Math.min(10, song.duration / 2)) {
        counted = true;
        api("/api/music/songs/" + song.id + "/play", {}).then(function (j) { if (j.ok) song.plays = j.plays; });
      }
      var lines = $("ovLyrics").children;
      for (var i = 0; i < lines.length && i < cues.length; i++) lines[i].classList.toggle("active", pos >= cues[i].t && pos < cues[i].t + cues[i].d + 0.8);
    }

    function startVisual() {
      if (visualOn) return;
      visualOn = true;
      (function loop() {
        if (!playing || $("msOverlay").hidden) { visualOn = false; return; }
        drawVisual();
        requestAnimationFrame(loop);
      })();
    }

    function startUi() { clearInterval(uiTimer); uiTimer = setInterval(update, 250); update(); startVisual(); }
    function stopUi() { clearInterval(uiTimer); }

    function syncControls() {
      icon($("plPlay"), playing ? PAUSE_ICON : PLAY_ICON);
      $("plPlay").disabled = !song;
      $("plPrev").disabled = !song; $("plNext").disabled = !song || index >= queue.length - 1;
      document.querySelectorAll(".ms-row").forEach(function (r) { r.classList.toggle("playing", !!song && Number(r.dataset.songId) === song.id); });
    }

    function setNow(s) {
      paintCover($("plCover"), s);
      $("plTitle").textContent = s.title;
      $("plSub").textContent = s.creator;
      syncControls();
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.creator, album: "NRS Sound", artwork: s.cover_url ? [{ src: s.cover_url, sizes: "512x512" }] : [] });
        navigator.mediaSession.setActionHandler("play", toggle); navigator.mediaSession.setActionHandler("pause", toggle);
        navigator.mediaSession.setActionHandler("previoustrack", prev); navigator.mediaSession.setActionHandler("nexttrack", function () { next(false); });
      }
    }

    $("plPlay").addEventListener("click", toggle);
    $("plNext").addEventListener("click", function () { next(false); });
    $("plPrev").addEventListener("click", prev);
    $("plSeek").addEventListener("change", function () { seek(Number(this.value) / 1000); });
    $("plSeek").addEventListener("input", function () { this.style.setProperty("--p", (this.value / 10) + "%"); });
    $("plVol").value = Math.round(volume * 100);
    $("plVol").style.setProperty("--p", Math.round(volume * 100) + "%");
    $("plVol").addEventListener("input", function () { setVolume(Number(this.value) / 100); this.style.setProperty("--p", this.value + "%"); });

    return {
      play: play, toggle: toggle, setVocal: setVocal, startVisual: startVisual,
      current: function () { return song; }, vocalOn: function () { return vocalOn; },
      buffer: function () { return buffer; }, cues: function () { return cues; },
    };
  })();

  /* ------------------------------------------------------------- overlay */

  function renderOverlay() {
    var s = Player.current();
    if (!s) return;
    paintCover($("ovCover"), s);
    $("ovTitle").textContent = s.title;
    $("ovBy").textContent = "von " + s.creator;
    var badges = $("ovBadges"); badges.textContent = "";
    [s.genre_label, fmt(s.duration), s.plays + " Aufrufe"].forEach(function (t) { badges.appendChild(el("span", "ms-badge", t)); });
    if (s.with_vocals) badges.appendChild(el("span", "ms-badge", "mit Gesang"));
    badges.appendChild(el("span", "ms-badge cc", s.license));
    $("ovDesc").textContent = s.description || "";
    $("ovLike").textContent = s.liked ? "Gefällt mir ✓" : "Gefällt mir";
    $("ovLike").onclick = function () { toggleLike(s); setTimeout(renderOverlay, 400); };
    $("ovVocal").hidden = !s.with_vocals;
    $("ovVocal").textContent = Player.vocalOn() ? "Gesang: an" : "Gesang: aus";
    var lyrics = $("ovLyrics"); lyrics.textContent = "";
    String(s.lyrics || "").split("\n").forEach(function (line) { if (line.trim()) lyrics.appendChild(el("div", "line", line)); });
    lyrics.hidden = !s.lyrics;
  }

  $("msNow").addEventListener("click", function () { if (Player.current()) { renderOverlay(); $("msOverlay").hidden = false; Player.startVisual(); } });
  $("ovClose").addEventListener("click", function () { $("msOverlay").hidden = true; });
  $("ovVocal").addEventListener("click", function () { Player.setVocal(!Player.vocalOn()); $("ovVocal").textContent = Player.vocalOn() ? "Gesang: an" : "Gesang: aus"; });
  $("ovReport").addEventListener("click", function () {
    var s = Player.current();
    if (s && window.confirm("Diesen Song als unpassend melden?")) api("/api/music/songs/" + s.id + "/report", { reason: "unpassend" }).then(function () { toast("Danke, wir schauen es uns an."); });
  });
  $("ovWav").addEventListener("click", function () {
    var s = Player.current(), buf = Player.buffer();
    if (!s || !buf) return;
    var a = document.createElement("a");
    a.href = URL.createObjectURL(NRSSynth.toWav(buf));
    a.download = s.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") + ".wav";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });

  document.addEventListener("keydown", function (e) {
    if (e.code !== "Space" || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement.tagName)) return;
    e.preventDefault();
    Player.toggle();
  });

  showView("home");
})();
