/* Pulse camera (yipi-camera.js): the camera tab, made like the camera of Snapchat. The front camera fills the screen (you see yourself), at the bottom
   a row of "lenses" -- each lens is a small game. Tap the one in the middle and the game starts on top of your picture, and the recording starts
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
    const fallback = h("div", { class: "cam-fallback", hidden: true });
    const host = h("div", { class: "cam-host" });
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
    const el = h("div", { class: "view cam-view" }, stage, top, bottom, review, loadingBox);

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
    const setState = (next) => { state = next; app.dataset.cam = next; el.dataset.state = next; };
    setState("idle");

    // ---------------------------------------------------------------------------------------------- the camera
    async function openCamera() {
      closeCamera();
      fallback.hidden = true;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { noCamera("Dein Browser kann die Kamera nicht benutzen."); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch (error) {
        noCamera(error && error.name === "NotAllowedError" ? "Du hast die Kamera nicht erlaubt." : "Es wurde keine Kamera gefunden.");
        return;
      }
      if (dead) { stream.getTracks().forEach((track) => track.stop()); return; }
      feed.srcObject = stream;
      feed.classList.toggle("mirror", facing === "user");
      feed.play().catch(() => {});
    }
    function closeCamera() {
      if (stream) { stream.getTracks().forEach((track) => track.stop()); stream = null; }
      feed.srcObject = null;
    }
    function noCamera(text) {
      fill(fallback, h("span", { class: "cam-fallback-ic" }, icon("camera")), h("b", {}, "Keine Kamera"), h("p", {}, `${text} Du kannst trotzdem spielen und aufnehmen, nur ohne dich.`),
        h("button", { class: "btn ghost small", type: "button", onclick: () => openCamera() }, "Noch einmal versuchen"));
      fallback.hidden = false;
    }
    board.addEventListener("click", () => { if (state === "idle" && list[active]) Y.leaderboard(list[active]); });
    const todaysGame = () => list[Core.dailyIndex(new Date().toISOString().slice(0, 10), list.length)];
    flip.addEventListener("click", () => { if (state !== "idle") return; facing = facing === "user" ? "environment" : "user"; openCamera(); });

    // ---------------------------------------------------------------------------------------------- the lenses
    function lensButton(game, index) {
      const button = h("button", { class: "lens", type: "button", role: "option", "aria-selected": "false", "aria-label": `${game.name}: ${game.hint}`, "data-id": game.id },
        h("span", { class: "lens-ic", style: game.color ? `background:${game.color}` : "" }, h("span", { class: "lens-emoji", "aria-hidden": "true" }, game.emoji)));
      button.addEventListener("click", () => {
        if (state !== "idle") return;
        if (index === active) begin(game); else go(index, true);
      });
      return button;
    }
    function drawLenses() {
      fill(lensBar, ...list.map(lensButton));
      go(active, false);
    }
    function paintActive() {
      [...lensBar.children].forEach((button, index) => { button.classList.toggle("on", index === active); button.setAttribute("aria-selected", String(index === active)); });
      const game = list[active];
      if (game) {
        lastGame = game.id;
        fill(lensName, h("b", {}, game.name), h("span", { class: "cam-lens-cat" }, game.cat), todaysGame() === game ? h("span", { class: "cam-daily" }, "Spiel des Tages") : null);
        lensHint.textContent = `${game.hint} · tippe den Kreis zum Start`;
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
        const step = (lensBar.children[1] ? lensBar.children[1].offsetLeft - first.offsetLeft : first.offsetWidth) || 1;
        const index = Math.max(0, Math.min(list.length - 1, Math.round((lensBar.scrollLeft + lensBar.clientWidth / 2 - first.offsetWidth / 2 - first.offsetLeft) / step)));
        if (index !== active) { active = index; paintActive(); }
      });
    }, { passive: true });
    lensBar.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight") { event.preventDefault(); go(active + 1, true); }
      else if (event.key === "ArrowLeft") { event.preventDefault(); go(active - 1, true); }
      else if (event.key === "Enter" && state === "idle" && list[active]) { event.preventDefault(); begin(list[active]); }
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
    async function begin(game) {
      if (state !== "idle") return;
      setState("starting");
      chosen = game;
      finalScore = 0;
      score.textContent = "0";
      const def = window.PulseGames.get(game.id);
      try {
        if (def.external) await def.prepare();
      } catch (error) {
        toast("Dieses Spiel konnte nicht geladen werden.");
        setState("idle");
        return;
      }
      if (micAllowed === null && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try { micStream = await navigator.mediaDevices.getUserMedia({ audio: true }); micAllowed = true; } catch (error) { micAllowed = false; }
      }
      if (dead) return;
      host.replaceChildren();
      const before = best()[game.id] || 0;                    // the best score before this round: beating it is announced once
      let announced = false;
      let lastPop = 0;
      bestLine.textContent = before ? `Bestwert ${before}` : "Dein erster Versuch";
      bestLine.classList.remove("hot");
      const hooks = { onScore(value) {
        if (state !== "playing") return;
        finalScore = value;
        score.textContent = String(value);
        const now = performance.now();
        if (now - lastPop > 300) { lastPop = now; score.classList.remove("bump"); void score.offsetWidth; score.classList.add("bump"); }
        if (before && value > before && !announced) { announced = true; bestLine.textContent = "Neuer Bestwert!"; bestLine.classList.add("hot"); navigator.vibrate?.(30); }
      }, onOver(value) { finish(value); } };
      if (def.external) runner = def.run(host, hooks);
      else {
        const canvas = h("canvas", { class: "game-layer", "aria-label": `${game.name}: Spielfeld`, tabindex: "0" });
        host.append(canvas);
        runner = window.PulseGames.run(def, canvas, hooks);
        canvas.focus({ preventScroll: true });
      }
      lensBarHide(true);
      hud.hidden = false;
      timeBar.style.width = "100%";
      runner?.pause?.(true);
      if (!(await countdown())) return;                       // left or cancelled meanwhile
      runner?.pause?.(false);
      startRecording();
      startedAt = performance.now();
      setState("playing");
      clearInterval(timer);
      timer = setInterval(tick, 100);
    }
    const lensBarHide = (on) => { bottom.hidden = on; top.hidden = on; };

    /* 3, 2, 1 before every round (the game stands still and nothing is recorded yet). */
    let countId = 0;
    async function countdown() {
      const mine = ++countId;
      for (const step of ["3", "2", "1"]) {
        if (dead || mine !== countId || state !== "starting") return false;
        fill(over, h("div", { class: "cam-count", "aria-live": "assertive" }, step));
        over.hidden = false;
        await wait(550);
      }
      over.hidden = true;
      return !dead && mine === countId && state === "starting";
    }

    function tick() {
      if (state !== "playing") return;
      const left = LIMIT - (performance.now() - startedAt) / 1000;
      timeBar.style.width = `${Math.max(0, (left / LIMIT) * 100)}%`;
      if (left <= 0) finish(finalScore);
    }
    stop.addEventListener("click", () => {
      if (state === "playing") finish(finalScore);
      else if (state === "starting") { countId += 1; endGame(); lensBarHide(false); setState("idle"); }       // cancelled during the countdown
    });

    function finish(value) {
      if (state !== "playing") return;
      setState("over");
      clearInterval(timer);
      finalScore = Math.max(finalScore, Number.isFinite(value) ? value : 0);
      const top = remember(chosen.id, finalScore);
      host.classList.add("shake");
      setTimeout(() => host.classList.remove("shake"), 450);
      navigator.vibrate?.([40, 30, 80]);
      const rank = h("small", { class: "cam-over-rank" });
      fill(over, h("div", { class: "cam-over-box" }, h("b", {}, "Fertig!"), h("span", { class: "cam-over-score" }, points(finalScore)), h("small", {}, finalScore >= top && finalScore > 0 ? "Neuer Bestwert!" : `Bestwert ${top}`), rank));
      over.hidden = false;
      const daily = todaysGame() === chosen && finalScore > 0;
      Y.reportPlay(chosen.id, finalScore).then((info) => {
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
      g.font = "800 64px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.lineWidth = 10;
      g.lineJoin = "round";
      g.strokeStyle = "rgba(0,0,0,0.7)";
      g.strokeText(String(finalScore), REC_W / 2, 90);
      g.fillStyle = "#fff";
      g.fillText(String(finalScore), REC_W / 2, 90);
      g.font = "800 28px system-ui, sans-serif";
      g.textAlign = "right";
      g.strokeText("Pulse", REC_W - 24, REC_H - 28);
      g.fillText("Pulse", REC_W - 24, REC_H - 28);
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
      clip = { blob, url: URL.createObjectURL(blob), name: `pulse-${chosen.id}.${extension}`, score: finalScore, game: chosen };
      const video = h("video", { class: "cam-clip", src: clip.url, loop: true, playsinline: true, autoplay: true, "aria-label": "Dein Clip" });
      const bar = h("div", { class: "cam-review-bar" },
        action("close", "Verwerfen", () => { discard(); backToLenses(); }),
        action("download", "Speichern", save),
        action("refresh", "Nochmal", () => { const game = chosen; discard(); backToLenses(); begin(game); }),
        h("button", { class: "cam-send", type: "button", onclick: sendDialog }, icon("send"), h("span", {}, "Senden")),
        h("button", { class: "cam-post", type: "button", onclick: post }, icon("plus"), h("span", {}, "Posten")));
      fill(review, video, h("div", { class: "cam-review-top" }, h("b", {}, clip.game.name), h("span", {}, points(clip.score))), bar);
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
      go(active, false);
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
      Y.composeVideo({ file });
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
            const message = await Api.post(`/messages/${handle}`, { fileId: up.data.file.id, text: `Mein Clip aus ${clip.game.name}: ${points(clip.score)}` });
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
      list = window.PulseGames.list();
      const wanted = route.game ? list.findIndex((game) => game.id === route.game) : list.findIndex((game) => game.id === lastGame);
      const todays = list.indexOf(todaysGame());
      active = wanted >= 0 ? wanted : Math.max(0, todays);
      loadingBox.hidden = true;
      drawLenses();
    }
    function fit() {                                           // the play field is 9:16 and as big as the screen allows; the camera behind it fills the whole stage
      const box = stage.getBoundingClientRect();
      const width = Math.max(1, Math.min(box.width, (box.height * 9) / 16));
      host.style.setProperty("--gw", `${width}px`);
      host.style.setProperty("--gh", `${(width * 16) / 9}px`);
    }
    if (window.ResizeObserver) { const watcher = new ResizeObserver(fit); watcher.observe(stage); }
    window.addEventListener("resize", fit);
    fit();
    openCamera();
    loadGames();

    return {
      element: el, title: "Kamera",
      onHide() { runner?.pause?.(true); },
      onShow() { runner?.pause?.(false); },
      destroy() {
        dead = true;
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
