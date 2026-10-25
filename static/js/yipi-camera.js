/* Nex camera (yipi-camera.js): the camera tab, made like the camera of Snapchat. The front camera fills the screen (you see yourself), at the bottom
   a row of "lenses": face lenses (masks and funny faces that follow your face, pl-face.js), the QR code, and small games. Tap the one in the middle and the game starts on top of your picture, and the recording starts
   with it: the camera, the game and your voice, up to 30 seconds. When the game is over (or you stop it) you see the clip and can post it (the video
   template), send it to friends, save it or throw it away. The games are in a second file (pg-*.js), loaded when this page opens. Without a camera
   (or without permission) the games run on a dark background, and the recording still works. Nothing is sent anywhere until you choose to. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, toast, dialog, wait } = Y;

  const REC_W = 540;
  const LIMIT = 30;                                             // seconds of a clip

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

  const points = (n) => `${n} ${n === 1 ? "Punkt" : "Punkte"}`;
  const best = () => Y.readJson("yipi.games", {});
  const remember = (id, value) => { const all = best(); if (value > (all[id] || 0)) { all[id] = value; Y.writeJson("yipi.games", all); } return all[id] || 0; };

  let micAllowed = null;                                        // null: not asked yet
  let micStream = null;
  let facing = "user";
  let lastGame = "";
  let REC_H = 960;                                              // as high as the stage is (the width is always 540)

  const pickType = () => Y.pickRecorderType();

  Y.views.camera = function camera(route, ctx) {
    const app = document.getElementById("app");
    const feed = h("video", { class: "cam-feed", playsinline: true, muted: true, autoplay: true, "aria-label": "Deine Kamera" });
    feed.muted = true;
    const fallback = h("div", { class: "cam-fallback", hidden: true });          // without a camera: a dark picture instead of it, and a small chip that says why
    const nocamText = h("span", {});
    const nocam = h("button", { class: "cam-nocam", type: "button", hidden: true }, icon("camera"), nocamText);
    const host = h("div", { class: "cam-host" });
    const face = h("video", { class: "cam-face", playsinline: true, muted: true, autoplay: true, hidden: true, "aria-hidden": "true" });     // a small round picture of you for the games that cover the camera
    face.muted = true;
    let wantFace = false;
    const syncFace = () => { face.hidden = !(wantFace && stream); if (!face.hidden && face.paused) face.play().catch(() => {}); };
    const score = h("div", { class: "cam-score", "aria-live": "off" }, "0");
    const timeBar = h("span", { class: "cam-time-fill" });
    const stop = h("button", { class: "cam-stop", type: "button", "aria-label": "Aufnahme beenden" }, h("span", {}));
    const bestLine = h("div", { class: "cam-best" });
    const hud = h("div", { class: "cam-hud", hidden: true }, h("div", { class: "cam-time" }, timeBar), score, bestLine, stop);
    const over = h("div", { class: "cam-over", hidden: true });
    const stage = h("div", { class: "cam-stage" }, feed, fallback, host, hud, over);
    const flip = h("button", { class: "cam-tool", type: "button", "aria-label": "Kamera wechseln" }, icon("flip"));
    const board = h("button", { class: "cam-tool", type: "button", "aria-label": "Bestenliste", "aria-haspopup": "dialog" }, icon("trophy"));
    const all = h("button", { class: "cam-tool", type: "button", "aria-label": "Alle Spiele", "aria-haspopup": "dialog" }, icon("gamepad"));
    const top = h("div", { class: "cam-top" }, h("h1", { class: "sr-only" }, "Kamera"), h("div", { class: "cam-tool-group" }, all), h("span", { class: "cam-title" }, "Kamera"), h("div", { class: "cam-tool-group end" }, board, flip));
    const lensName = h("div", { class: "cam-lens-name" });
    const lensHint = h("div", { class: "cam-lens-hint" });
    const lensBar = h("div", { class: "cam-lenses", role: "listbox", "aria-label": "Spiele", tabindex: "0" });
    const bottom = h("div", { class: "cam-bottom" }, lensName, lensHint, lensBar);
    const review = h("div", { class: "cam-review", hidden: true });
    const loadingBox = h("div", { class: "cam-loading" }, Y.pulseLoader({ compact: true }), h("span", {}, "Die Spiele werden geladen …"));
    const note = h("div", { class: "cam-note", role: "status", hidden: true });                  // "Linse wird geladen ...", "Schau in die Kamera"
    const el = h("div", { class: "view cam-view" }, stage, top, nocam, note, bottom, review, loadingBox);

    let state = "idle";                                        // idle, starting, playing, over, review
    let dead = false;
    let stream = null;
    let list = [];
    let active = 0;
    let runner = null;
    let chosen = null;
    let startedAt = 0;
    let timer = null;
    let recorder = null;
    let chunks = [];
    let raf = 0;
    let recCanvas = null;
    let clip = null;                                           // {blob, url, name, score, game}
    let finalScore = 0;
    let lens = null;                                           // the running face lens (a FaceLens of pl-face.js)
    let lastItem = null;                                       // the lens or game that was open before the QR code (the code can point to it)
    let panelCleanup = null;                                   // what the panel of "QR-Code" has to stop (the scanner)
    const setState = (next) => { state = next; app.dataset.cam = next; el.dataset.state = next; };
    setState("idle");

    // ---------------------------------------------------------------------------------------------- the camera
    async function openCamera() {
      closeCamera();
      fallback.hidden = true;
      nocam.hidden = true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { noCamera("Kamera nicht verfügbar"); return; }
      const video = { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });         // one question for the camera and the microphone
        micAllowed = true;
      } catch (first) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
          micAllowed = false;
        } catch (error) {
          noCamera(error && error.name === "NotAllowedError" ? "Kamera nicht erlaubt" : "Keine Kamera gefunden");
          return;
        }
      }
      micStream = micAllowed ? stream : null;
      if (dead) { stream.getTracks().forEach((track) => track.stop()); return; }
      feed.srcObject = stream;
      feed.classList.toggle("mirror", facing === "user");
      feed.play().catch(() => {});
      face.srcObject = stream;
      face.classList.toggle("mirror", facing === "user");
      face.play().catch(() => {});
      syncFace();
    }
    function closeCamera() {
      if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }
      feed.srcObject = null;
      face.srcObject = null;
      face.hidden = true;
    }
    function noCamera(text) {
      fallback.replaceChildren();
      fallback.hidden = false;
      nocamText.textContent = `${text} · nochmal versuchen`;
      nocam.setAttribute("aria-label", `${text}. Du kannst trotzdem spielen und aufnehmen, nur ohne dich. Tippen, um es noch einmal zu versuchen.`);
      nocam.hidden = false;
    }
    nocam.addEventListener("click", () => openCamera());
    board.addEventListener("click", () => { if (state === "idle" && list[active] && list[active].kind === "game" && !list[active].community) Y.leaderboard(list[active]); else if (state === "idle") toast("Eine Bestenliste gibt es nur bei den Spielen von Nex."); });
    const todaysGame = () => { const games = list.filter((entry) => entry.kind === "game" && !entry.community); return games[Core.dailyIndex(new Date().toISOString().slice(0, 10), games.length)]; };
    flip.addEventListener("click", () => { if (state !== "idle") return; facing = facing === "user" ? "environment" : "user"; openCamera().then(() => lens?.setMirror(facing === "user")); });

    // ---------------------------------------------------------------------------------------------- the lenses
    function lensButton(game, index) {
      const button = h("button", { class: `lens${game.kind === "create" ? " create" : ""}${game.kind === "lens" ? " face" : ""}`, type: "button", role: "option", "aria-selected": "false", "aria-label": `${game.name}: ${game.hint}`, "data-id": game.id },
        h("span", { class: "lens-ic", style: game.color ? `background:${game.color}` : "" }, h("span", { class: "lens-emoji", "aria-hidden": "true" }, game.emoji)));
      button.addEventListener("click", () => {
        if (state !== "idle") return;
        if (index === active) { if (runner && runner.go) runner.go(); else startRound(); } else go(index, true);
      });
      return button;
    }

    /* The lens in the middle is big, the ones next to it are smaller the farther away they are (like the circles of the lenses of Snapchat). */
    function sizeLenses() {
      const first = lensBar.children[0];
      if (!first) return;
      const middle = lensBar.scrollLeft + lensBar.clientWidth / 2;
      const step = (lensBar.children[2] ? lensBar.children[2].offsetLeft - lensBar.children[1].offsetLeft : first.offsetWidth) || 1;
      for (const button of lensBar.children) {
        const away = Math.abs(button.offsetLeft + button.offsetWidth / 2 - middle) / step;
        const grow = Math.max(0.52, 1.18 - 0.3 * away);
        button.style.setProperty("--grow", grow.toFixed(3));
        button.style.opacity = String(Math.max(0.35, 1 - 0.22 * away).toFixed(2));
      }
    }
    function drawLenses() {
      fill(lensBar, ...list.map(lensButton));
      go(active, false);
      requestAnimationFrame(sizeLenses);
    }
    function paintActive() {
      [...lensBar.children].forEach((button, index) => { button.classList.toggle("on", index === active); button.setAttribute("aria-selected", String(index === active)); });
      const game = list[active];
      if (game) {
        lastGame = game.id;
        fill(lensName, h("b", {}, game.name), h("span", { class: "cam-lens-cat" }, game.cat), todaysGame() === game ? h("span", { class: "cam-daily" }, "Spiel des Tages") : null,
          game.by ? h("span", { class: "cam-lens-by" }, `von @${game.by.handle}`) : null);
        lensHint.textContent = game.hint;
        schedulePreview();
      }
    }
    function go(index, smooth) {
      active = Math.max(0, Math.min(list.length - 1, index));
      const button = lensBar.children[active];
      if (button) lensBar.scrollTo({ left: button.offsetLeft - (lensBar.clientWidth - button.offsetWidth) / 2, behavior: smooth ? "smooth" : "auto" });
      paintActive();
    }
    let scrollFrame = 0;
    lensBar.addEventListener("scroll", () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        const first = lensBar.children[0];
        if (!first || state !== "idle") return;
        const middle = lensBar.scrollLeft + lensBar.clientWidth / 2;
        let index = 0;
        let nearest = Infinity;
        for (let i = 0; i < lensBar.children.length; i += 1) {                     // the lens whose middle is nearest to the middle of the strip
          const button = lensBar.children[i];
          const away = Math.abs(button.offsetLeft + button.offsetWidth / 2 - middle);
          if (away < nearest) { nearest = away; index = i; }
        }
        sizeLenses();
        if (index !== active) { active = index; paintActive(); }
      });
    }, { passive: true });
    lensBar.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); go(active + 1, true); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(active - 1, true); }
      else if (event.key === "Enter" && state === "idle" && list[active]) { event.preventDefault(); if (runner && runner.go) runner.go(); else startRound(); }
    });

    function galleryDialog() {
      if (state !== "idle") return;
      let topic = "Alle";
      let term = "";
      const topics = ["Alle", ...new Set(list.map((game) => game.cat))];
      const grid = h("div", { class: "cam-grid" });
      const chips = h("div", { class: "games-chips", role: "tablist", "aria-label": "Themen" });
      const search = h("input", { class: "search-input", type: "search", placeholder: "Spiele suchen", "aria-label": "Spiele suchen", autocomplete: "off", maxlength: 40 });
      let entry = null;
      function draw() {
        fill(chips, ...topics.map((name) => h("button", { class: `chip${name === topic ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(name === topic), onclick: () => { topic = name; draw(); } }, name)));
        const shown = list.filter((game) => (topic === "Alle" || game.cat === topic) && (!term || game.name.toLowerCase().includes(term)));
        const scores = best();
        fill(grid, ...(shown.length ? shown.map((game) => h("button", { class: "cam-tile", type: "button", onclick: () => { entry.close(); go(list.indexOf(game), true); } },
          h("span", { class: "cam-tile-ic", style: game.color ? `background:${game.color}` : "" }, game.emoji), h("b", {}, game.name), h("small", {}, scores[game.id] ? `Bestwert ${scores[game.id]}` : game.cat)))
          : [h("p", { class: "muted games-none" }, "Dazu gibt es kein Spiel.")]));
      }
      search.addEventListener("input", () => { term = search.value.trim().toLowerCase(); draw(); });
      draw();
      entry = dialog({ title: `Alle Spiele (${list.length})`, wide: true, body: h("div", { class: "cam-gallery" }, h("label", { class: "search-box" }, icon("search"), search), chips, grid), initialFocus: search });
    }
    all.addEventListener("click", galleryDialog);

    // ---------------------------------------------------------------------------------------------- a game and its recording
    let previewTimer = 0;
    let previewId = 0;
    const tapHint = h("div", { class: "cam-tap", "aria-live": "polite" }, h("span", {}, "Tippe auf den Bildschirm, um zu starten"));
    stage.append(tapHint);

    /* A moment after a lens is chosen the game is shown on the camera picture, not running yet: the scenery, the figure and the buttons to steer it are there. */
    function schedulePreview() {
      clearTimeout(previewTimer);
      if (state !== "idle") return;
      previewTimer = setTimeout(showPreview, 140);
    }
    function showPreview() {
      if (dead || state !== "idle" || !list[active]) return;
      const game = list[active];
      const mine = ++previewId;
      stopLens();
      panelCleanup?.();
      panelCleanup = null;
      runner?.destroy();
      runner = null;
      host.replaceChildren();
      el.dataset.kind = game.kind || "game";
      if (game.kind === "game" || game.kind === "lens") lastItem = game;
      if (game.kind && game.kind !== "game") { showSpecial(game, mine); return; }
      if (game.community && !window.PulseGames.get(game.id)) { ensureCommunity(game, mine); return; }
      chosen = game;
      finalScore = 0;
      score.textContent = "0";
      tapHint.hidden = false;
      const def = window.PulseGames.get(game.id);
      wantFace = !!def.bubble;
      const before = best()[game.id] || 0;                    // the best score before this round: beating it is announced once
      let announced = false;
      let lastPop = 0;
      bestLine.textContent = before ? `Bestwert ${before}` : "Dein erster Versuch";
      bestLine.classList.remove("hot");
      current = { before, hooks: {
        onScore(value) {
          if (state !== "playing") return;
          finalScore = value;
          score.textContent = String(value);
          const now = performance.now();
          if (now - lastPop > 300) { lastPop = now; score.classList.remove("bump"); void score.offsetWidth; score.classList.add("bump"); }
          if (before && value > before && !announced) { announced = true; bestLine.textContent = "Neuer Bestwert!"; bestLine.classList.add("hot"); navigator.vibrate?.(30); }
        },
        onOver(value) { finish(value); },
        onStart() { startRound(); },
      } };
      if (def.external) {                                     // a game that brings its own page (Fruit Merge): a card, the first touch loads it
        const card = h("button", { class: "cam-ext", type: "button", onclick: () => startRound() },
          h("span", { class: "cam-ext-ic" }, game.emoji), h("b", {}, game.name), h("small", {}, game.hint));
        host.append(card);
        return;
      }
      const canvas = h("canvas", { class: "game-canvas", "aria-label": `${game.name}: Spielfeld`, tabindex: "0" });
      host.append(h("div", { class: "game-frame" }, canvas, face));
      syncFace();
      if (mine !== previewId) return;
      runner = window.PulseGames.run(def, canvas, current.hooks, { armed: true });
      canvas.focus({ preventScroll: true });
    }

    async function ensureCommunity(game, mine) {
      lensNote("Das Spiel wird geladen …");
      const row = await Y.communityGames.fetch(game.id);
      lensNote("");
      if (dead || mine !== previewId) return;
      if (!row) { lensNote("Dieses Spiel gibt es nicht mehr."); return; }
      window.PulseGames.define(window.PulseGames.community.communityDef(row));
      showPreview();
    }

    // ---------------------------------------------------------------------------------------------- face lenses, "create" and the QR code
    const lensNote = (text) => { note.textContent = text || ""; note.hidden = !text; };
    function stopLens() {
      if (lens) { lens.stop(); lens = null; }
      feed.style.filter = "";
      lensNote("");
    }
    const filterCss = (item) => (window.PulseFace && window.PulseFace.filters[item.filter] ? window.PulseFace.filters[item.filter].css : "");

    async function showSpecial(item, mine) {
      chosen = item;
      current = null;
      finalScore = 0;
      wantFace = false;
      syncFace();
      tapHint.hidden = item.kind !== "lens";
      if (item.kind === "lens") await openLens(item, mine);
      else if (item.kind === "create") Y.cameraCreate?.panel({ host, camera: api });
      else if (item.kind === "qr") panelCleanup = Y.cameraQr?.panel({ host, camera: api }) || null;
    }

    async function openLens(item, mine) {
      const canvas = h("canvas", { class: "lens-canvas", "aria-hidden": "true" });
      host.append(canvas);
      lensNote("Gesichtserkennung wird geladen …");
      try { await loadScript(assets.lens); } catch (error) { lensNote("Die Linsen konnten nicht geladen werden."); return; }
      if (mine !== previewId || dead) return;
      if (!stream) { lensNote("Für Linsen braucht Nex die Kamera."); return; }
      feed.style.filter = filterCss(item);
      lens = new window.PulseFace.FaceLens({ video: feed, canvas, mirror: facing === "user", recipe: item, onStatus(status) {
        if (mine !== previewId) return;
        lensNote(status === "ready" ? "" : status === "noface" ? "Schau in die Kamera" : status === "error" ? "Diese Linse läuft auf deinem Gerät nicht." : "Gesichtserkennung wird geladen …");
      } });
      lens.start();
    }
    stage.addEventListener("click", (event) => {
      if (state === "idle" && chosen && chosen.kind === "lens" && !event.target.closest("button")) startLensRound();
    });

    /* A lens is recorded like a game, only without points: the first touch starts the clip (up to 30 seconds), the red button ends it. */
    function startLensRound() {
      if (state !== "idle" || !chosen || chosen.kind !== "lens") return;
      setState("playing");
      clearTimeout(previewTimer);
      previewId += 1;
      tapHint.hidden = true;
      lensBarHide(true);
      hud.hidden = false;
      timeBar.style.width = "100%";
      startRecording();
      startedAt = performance.now();
      clearInterval(timer);
      timer = setInterval(tick, 100);
    }

    /* The first touch on the picture: the round and the recording begin together, at once. */
    async function startRound() {
      if (chosen && chosen.kind === "lens") { startLensRound(); return; }
      if (state !== "idle" || !chosen || !current) return;
      const game = chosen;
      const def = window.PulseGames.get(game.id);
      setState("playing");
      clearTimeout(previewTimer);
      previewId += 1;
      tapHint.hidden = true;
      if (def.external) {
        try { await def.prepare(); } catch (error) { toast("Dieses Spiel konnte nicht geladen werden."); setState("idle"); schedulePreview(); return; }
        if (dead) return;
        host.replaceChildren();
        runner = def.run(host, current.hooks);
      }
      lensBarHide(true);
      hud.hidden = false;
      timeBar.style.width = "100%";
      startRecording();
      startedAt = performance.now();
      clearInterval(timer);
      timer = setInterval(tick, 100);
    }
    let current = null;
    const lensBarHide = (on) => { bottom.hidden = on; top.hidden = on; };

    function tick() {
      if (state !== "playing") return;
      const left = LIMIT - (performance.now() - startedAt) / 1000;
      timeBar.style.width = `${Math.max(0, (left / LIMIT) * 100)}%`;
      if (left <= 0) finish(finalScore);
    }
    stop.addEventListener("click", () => { if (state === "playing") finish(finalScore); });

    function finish(value) {
      if (state !== "playing") return;
      setState("over");
      clearInterval(timer);
      if (chosen.kind === "lens") { navigator.vibrate?.(30); stopRecording().then(showReview); return; }
      finalScore = Math.max(finalScore, Number.isFinite(value) ? value : 0);
      const top = remember(chosen.id, finalScore);
      host.classList.add("shake");
      setTimeout(() => host.classList.remove("shake"), 450);
      navigator.vibrate?.([40, 30, 80]);
      const rank = h("small", { class: "cam-over-rank" });
      fill(over, h("div", { class: "cam-over-box" }, h("b", {}, "Fertig!"), h("span", { class: "cam-over-score" }, points(finalScore)), h("small", {}, finalScore >= top && finalScore > 0 ? "Neuer Bestwert!" : `Bestwert ${top}`), rank));
      over.hidden = false;
      const daily = todaysGame() === chosen && finalScore > 0;
      if (chosen.community) Y.communityGames?.played(chosen.id);
      (chosen.community ? Promise.resolve(null) : Y.reportPlay(chosen.id, finalScore)).then((info) => {
        if (!info || !rank.isConnected) return;
        rank.textContent = `${info.record ? "Neuer Rekord! " : ""}Platz ${info.rank} der Bestenliste${daily ? " · Spiel des Tages geschafft" : ""}`;
      });
      setTimeout(() => { if (state === "over") stopRecording().then(showReview); }, 1500);
    }

    function startRecording() {
      recorder = null;
      chunks = [];
      const type = pickType();
      recCanvas = document.createElement("canvas");
      const shape = stage.getBoundingClientRect();
      REC_H = Math.max(540, Math.min(1200, Math.round(((REC_W * shape.height) / Math.max(1, shape.width)) / 2) * 2));
      recCanvas.width = REC_W;
      recCanvas.height = REC_H;
      if (!type || !recCanvas.captureStream) return;
      const out = recCanvas.captureStream(30);
      if (micStream) for (const track of micStream.getAudioTracks()) out.addTrack(track);
      try {
        recorder = new MediaRecorder(out, { mimeType: type, videoBitsPerSecond: 2000000 });
      } catch (error) {
        recorder = null;
        return;
      }
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.start(500);
      const g = recCanvas.getContext("2d");
      const draw = () => {
        if (!recorder || recorder.state === "inactive") return;
        compose(g);
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    }

    /* The picture of one moment: the camera (as big as the screen, cut to the shape), the layers of the game on top, the score. */
    function compose(g) {
      g.fillStyle = "#111";
      g.fillRect(0, 0, REC_W, REC_H);
      if (feed.videoWidth && feed.videoHeight && feed.readyState >= 2) {
        const scale = Math.max(REC_W / feed.videoWidth, REC_H / feed.videoHeight);
        const w = feed.videoWidth * scale;
        const hh = feed.videoHeight * scale;
        g.save();
        if (feed.style.filter) g.filter = feed.style.filter;
        if (facing === "user") { g.translate(REC_W, 0); g.scale(-1, 1); }
        g.drawImage(feed, (REC_W - w) / 2, (REC_H - hh) / 2, w, hh);
        g.restore();
      } else {
        const gradient = g.createLinearGradient(0, 0, 0, REC_H);
        gradient.addColorStop(0, "#1c1c28");
        gradient.addColorStop(1, "#08080c");
        g.fillStyle = gradient;
        g.fillRect(0, 0, REC_W, REC_H);
      }
      const box = stage.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        for (const canvas of host.querySelectorAll("canvas")) {
          const r = canvas.getBoundingClientRect();
          if (canvas.dataset.frame) {                                 // a play field with a box (Fruit Merge): the box is a style of the page, so it is drawn here too
            g.fillStyle = "rgba(0,0,0,0.3)";
            g.strokeStyle = "rgba(255,255,255,0.7)";
            g.lineWidth = 4;
            g.beginPath();
            const bx = ((r.left - box.left) / box.width) * REC_W, by = ((r.top - box.top) / box.height) * REC_H, bw = (r.width / box.width) * REC_W, bh = (r.height / box.height) * REC_H;
            if (g.roundRect) g.roundRect(bx, by, bw, bh, 22); else g.rect(bx, by, bw, bh);
            g.fill();
            g.stroke();
          }
          try { g.drawImage(canvas, ((r.left - box.left) / box.width) * REC_W, ((r.top - box.top) / box.height) * REC_H, (r.width / box.width) * REC_W, (r.height / box.height) * REC_H); } catch (error) { /* a canvas that is not ready */ }
        }
      }
      if (!face.hidden && feed.videoWidth && feed.readyState >= 2) {                 // the round picture of you (games that cover the camera)
        const box2 = stage.getBoundingClientRect();
        const r = face.getBoundingClientRect();
        if (box2.width > 0 && r.width > 0) {
          const size = (r.width / box2.width) * REC_W;
          const cx = ((r.left - box2.left) / box2.width) * REC_W + size / 2;
          const cy = ((r.top - box2.top) / box2.height) * REC_H + size / 2;
          const cover = Math.max(size / feed.videoWidth, size / feed.videoHeight);
          g.save();
          g.beginPath();
          g.arc(cx, cy, size / 2, 0, Math.PI * 2);
          g.clip();
          g.translate(cx, cy);
          if (facing === "user") g.scale(-1, 1);
          g.drawImage(feed, (-feed.videoWidth * cover) / 2, (-feed.videoHeight * cover) / 2, feed.videoWidth * cover, feed.videoHeight * cover);
          g.restore();
          g.beginPath();
          g.arc(cx, cy, size / 2 - 2, 0, Math.PI * 2);
          g.lineWidth = 5;
          g.strokeStyle = "#fff";
          g.stroke();
        }
      }
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 10;
      g.lineJoin = "round";
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.fillStyle = "#fff";
      if (!chosen || chosen.kind === "game") {
        g.font = "800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        g.strokeText(String(finalScore), REC_W / 2, 90);
        g.fillText(String(finalScore), REC_W / 2, 90);
      }
      g.font = "800 28px system-ui, sans-serif";
      g.textAlign = "right";
      g.strokeText("Nex", REC_W - 24, REC_H - 28);
      g.fillText("Nex", REC_W - 24, REC_H - 28);
    }

    function stopRecording() {
      cancelAnimationFrame(raf);
      return new Promise((resolve) => {
        if (!recorder || recorder.state === "inactive") { resolve(null); return; }
        const done = () => resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || "video/webm" }) : null);
        recorder.onstop = done;
        try { recorder.stop(); } catch (error) { done(); }
      });
    }

    function endGame() {
      clearInterval(timer);
      cancelAnimationFrame(raf);
      stopLens();
      runner?.destroy();
      runner = null;
      host.replaceChildren();
      hud.hidden = true;
      over.hidden = true;
    }

    // ---------------------------------------------------------------------------------------------- the clip
    function showReview(blob) {
      endGame();
      if (dead) return;
      if (!blob) {                                                // no recording (the browser cannot, or nothing was recorded): back to the lenses
        toast("Die Aufnahme ist nicht möglich in diesem Browser. Gespielt hast du trotzdem.");
        backToLenses();
        return;
      }
      const extension = /mp4/.test(blob.type) ? "mp4" : "webm";
      clip = { blob, url: URL.createObjectURL(blob), name: `nex-${chosen.id}.${extension}`, score: finalScore, game: chosen };
      const video = h("video", { class: "cam-clip", src: clip.url, loop: true, playsinline: true, autoplay: true, "aria-label": "Dein Clip" });
      const bar = h("div", { class: "cam-review-bar" },
        action("close", "Verwerfen", () => { discard(); backToLenses(); }),
        action("download", "Speichern", save),
        action("refresh", "Nochmal", () => { discard(); backToLenses(); }),
        h("button", { class: "cam-send", type: "button", onclick: sendDialog }, icon("send"), h("span", {}, "Senden")),
        h("button", { class: "cam-post", type: "button", onclick: post }, icon("plus"), h("span", {}, "Posten")));
      fill(review, video, h("div", { class: "cam-review-top" }, h("b", {}, clip.game.kind === "lens" ? `${clip.game.emoji} ${clip.game.name}` : clip.game.name), clip.game.kind === "lens" ? null : h("span", {}, points(clip.score))), bar);
      review.hidden = false;
      setState("review");
      video.play().catch(() => {});
    }
    const action = (symbol, label, run) => h("button", { class: "cam-act", type: "button", "aria-label": label, onclick: run }, icon(symbol), h("span", {}, label));
    function discard() {
      if (clip) URL.revokeObjectURL(clip.url);
      clip = null;
      review.hidden = true;
      fill(review);
    }
    function backToLenses() {
      lensBarHide(false);
      setState("idle");
      el.dataset.kind = chosen ? chosen.kind || "game" : "game";
      go(active, false);
      requestAnimationFrame(sizeLenses);
    }
    function save() {
      const anchor = h("a", { href: clip.url, download: clip.name });
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      toast("Der Clip wurde gespeichert.");
    }
    function fileOf() { return new File([clip.blob], clip.name, { type: clip.blob.type || "video/webm" }); }
    function post() {
      const file = fileOf();
      Y.composeVideo({ file, camId: clip.game.id });                  // the post remembers the lens or game: "Ausprobieren" / "Mitspielen" under the video
    }

    /* "Senden": pick friends; the clip goes to each of them as a message with the video (a private file). */
    async function sendDialog() {
      const reply = await Api.get("/friends");
      if (!reply.ok) { toast(Api.message(reply)); return; }
      const friends = reply.data.users;
      const chosenFriends = new Set();
      let entry = null;
      const rows = friends.map((friend) => h("label", { class: "pick" }, Y.avatar(friend, "md"), h("span", { class: "pick-main" }, h("b", {}, friend.name), h("span", { class: "handle" }, `@${friend.handle}`)),
        h("input", { type: "checkbox", "aria-label": `An @${friend.handle} senden`, onchange: (event) => { if (event.target.checked) chosenFriends.add(friend.handle); else chosenFriends.delete(friend.handle); } })));
      entry = dialog({ title: "Senden an …", body: friends.length ? h("div", { class: "pick-list" }, rows)
        : h("div", {}, h("p", { class: "muted" }, "Du hast noch keine Freunde. Freunde sind Leute, die dir folgen und denen du folgst."), h("button", { class: "btn ghost", type: "button", onclick: () => { entry.close(); Y.navigate("/explore"); } }, "Leute finden")),
        actions: friends.length ? [{ label: "Senden", kind: "primary", run: async () => {
          if (!chosenFriends.size) { toast("Wähle mindestens eine Person aus."); return false; }
          const up = await Api.attach(fileOf(), () => {});
          if (!up.ok) { toast(Api.message(up)); return false; }
          let sent = 0;
          for (const handle of chosenFriends) {
            const message = await Api.post(`/messages/${handle}`, { fileId: up.data.file.id, text: clip.game.kind === "lens" ? `Mein Clip mit der Linse ${clip.game.name}` : `Mein Clip aus ${clip.game.name}: ${points(clip.score)}` });
            if (message.ok) sent += 1; else toast(`@${handle}: ${Api.message(message)}`);
          }
          if (sent) toast(`An ${sent} ${sent === 1 ? "Person" : "Personen"} gesendet.`);
          return sent > 0;
        } }] : [] });
    }

    // ---------------------------------------------------------------------------------------------- start
    async function loadGames() {
      try {
        await loadScript(assets.games);
      } catch (error) {
        fill(loadingBox, h("span", {}, "Die Spiele konnten nicht geladen werden."), h("button", { class: "btn ghost small", type: "button", onclick: () => ctx.reload() }, "Noch einmal versuchen"));
        return;
      }
      if (dead) return;
      const games = window.PulseGames.list().map((game) => ({ ...game, kind: "game" }));
      const create = { id: "create", kind: "create", name: "Erstellen", emoji: "✨", cat: "Neu", hint: "Baue eine eigene Linse oder ein eigenes Spiel und teile es", color: "#7a2cf0" };
      const qr = { id: "qr", kind: "qr", name: "QR-Code", emoji: "🔳", cat: "Teilen", hint: "Dein QR-Code zum Teilen und Scannen", color: "#1a1a1f" };
      const flagship = games.filter((game) => game.featured);
      list = [create, ...flagship, ...(Y.lenses ? Y.lenses.PRESETS : []), qr, ...games.filter((game) => !game.featured)];
      let wanted = route.game ? list.findIndex((game) => game.id === route.game) : list.findIndex((game) => game.id === lastGame);
      if (wanted < 0 && route.game) wanted = await addShared(route.game);          // a lens or game of somebody else that was linked
      active = wanted >= 0 ? wanted : Math.max(1, list.indexOf(flagship[0]));       // the first lens: the car race (the small "create" lens is on its left)
      loadingBox.hidden = true;
      drawLenses();
      addCommunity();
    }
    /* The lenses and games that other people published come after the ready-made lenses (a moment later, when the list has arrived). */
    async function addCommunity() {
      const [lenses, games] = await Promise.all([Y.lenses ? Y.lenses.community() : [], Y.communityGames ? Y.communityGames.list() : []]);
      if (dead || (!lenses.length && !games.length)) return;
      const keep = list[active] && list[active].id;
      const at = list.findIndex((entry) => entry.kind === "qr");
      list.splice(at, 0, ...lenses.filter((entry) => !list.some((other) => other.id === entry.id)), ...games.filter((entry) => !list.some((other) => other.id === entry.id)));
      if (state === "idle") { active = Math.max(0, list.findIndex((entry) => entry.id === keep)); drawLenses(); }
    }
    async function addShared(id) {
      const found = (Y.lenses && /^lu-/.test(id) && await Y.lenses.find(id)) || (Y.communityGames && /^gu-/.test(id) && await Y.communityGames.find(id));
      if (!found) return -1;
      list.splice(Math.max(1, list.findIndex((entry) => entry.kind === "qr")), 0, found);
      return list.indexOf(found);
    }
    function fit() {                                           // the play field is 9:16 and as big as the screen allows; the camera behind it fills the whole stage
      const box = stage.getBoundingClientRect();
      const width = Math.max(1, Math.min(box.width, (box.height * 9) / 16));
      stage.style.setProperty("--gw", `${width}px`);
      stage.style.setProperty("--gh", `${(width * 16) / 9}px`);
    }
    if (window.ResizeObserver) { const watcher = new ResizeObserver(fit); watcher.observe(stage); }
    window.addEventListener("resize", fit);
    fit();
    openCamera();
    loadGames();

    const api = { feed, stage, host, toast, get before() { return lastItem; }, get stream() { return stream; }, get facing() { return facing; }, go: (id) => { const at = list.findIndex((entry) => entry.id === id); if (at >= 0) go(at, true); },
      add: (item) => { const at = list.findIndex((entry) => entry.id === item.id); if (at < 0) list.splice(1, 0, item); active = Math.max(1, list.findIndex((entry) => entry.id === item.id)); drawLenses(); },
      remove: (id) => { const at = list.findIndex((entry) => entry.id === id); if (at < 0) return; list.splice(at, 1); active = Math.min(Math.max(0, at), list.length - 1); drawLenses(); },
      reload: () => ctx.reload(), reopen: () => openCamera() };
    return {
      element: el, title: "Kamera",
      onHide() { runner?.pause?.(true); },
      onShow() { runner?.pause?.(false); },
      destroy() {
        dead = true;
        clearTimeout(previewTimer);
        stopLens();
        panelCleanup?.();
        endGame();
        recorder = null;
        window.removeEventListener("resize", fit);
        closeCamera();
        if (micStream) { micStream.getTracks().forEach((track) => track.stop()); micStream = null; micAllowed = null; }
        if (clip) URL.revokeObjectURL(clip.url);
        delete app.dataset.cam;
      },
    };
  };
})();
