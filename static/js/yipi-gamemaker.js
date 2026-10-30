/* Nex game maker (yipi-gamemaker.js): what the "+" lens of the camera offers for games. A game is code (it runs in a sealed Web Worker, see yipi_games.py), and there are two ways to get
   one: "Mit KI erstellen" (the AI writes it for a description, `ai`) and "Spiel-Code hochladen" (`code`: a name, a photo for the round button in the strip, and the code, which a person writes,
   pastes or lets the AI write when the field is empty). The Nex AI chat has the same dialog behind the button "Als Spiel hochladen" under a block of code. The games of other people come into
   the strip of the camera as "Community" games. The bridge to the worker is in pg-community.js (loaded with the games of the camera; `ensureGames` loads it when it is needed somewhere else). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { fill, h, icon, toast, dialog } = Y;

  // ------------------------------------------------------------------------------------------------------------------ the games of the community in the strip of the camera
  const known = new Map();
  function toItem(row) {
    const who = row.user ? `@${row.user.handle}` : "";
    return { id: row.id, kind: "game", community: true, communityKind: row.kind, name: row.title, emoji: row.emoji, color: row.color, image: row.icon || null, cat: "Community", mine: !!row.mine, by: row.user,
      hint: `Spiel von ${who}`, plays: row.plays, user: row.user };
  }
  async function list() {
    const reply = await Api.get("/community-games?sort=popular&limit=40");
    return reply.ok ? reply.data.items.map(toItem) : [];
  }
  async function fetchRow(id) {
    if (known.has(id)) return known.get(id);
    const reply = await Api.get(`/community-games/${id}`);
    if (!reply.ok) return null;
    known.set(id, reply.data.game);
    return reply.data.game;
  }
  async function find(id) {
    const row = await fetchRow(id);
    return row ? toItem(row) : null;
  }
  const played = (id) => { Api.post(`/community-games/${id}/play`).catch(() => {}); };

  /* The games of the camera (and the bridge to the worker) as a script, for the places that are not the camera (the chat with Nex AI); resolves true when they are there. */
  let loading = null;
  function ensureGames() {
    if (window.PulseGames && window.PulseGames.community) return Promise.resolve(true);
    if (!loading) {
      loading = new Promise((resolve) => {
        let source = "";
        try { source = JSON.parse(document.getElementById("yipiAssets").textContent).games; } catch (error) { source = ""; }
        if (!source) { resolve(false); return; }
        const tag = document.createElement("script");
        tag.src = source;
        tag.onload = () => resolve(!!(window.PulseGames && window.PulseGames.community));
        tag.onerror = () => { loading = null; resolve(false); };
        document.head.append(tag);
      });
    }
    return loading;
  }

  /* A window to try a game of code (the sealed worker serves the draft to its author). */
  function tryGame(row, back) {
    const PG = window.PulseGames;
    const def = PG.community.codeDef({ ...row, user: Y.me, hint: "Dein Spiel" });
    const canvas = h("canvas", { class: "gm-test-canvas", "aria-label": "Dein Spiel zum Ausprobieren" });
    const result = h("div", { class: "gm-test-result", hidden: true });
    let runner = null;
    const close = () => { runner?.destroy(); overlay.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    function run() {
      runner?.destroy();
      result.hidden = true;
      runner = PG.run(def, canvas, { onScore() {}, onOver(points) {
        fill(result, h("b", {}, `${points} Punkte`), h("div", { class: "gm-test-buttons" }, h("button", { class: "btn primary", type: "button", onclick: run }, "Nochmal"), h("button", { class: "btn ghost", type: "button", onclick: close }, back)));
        result.hidden = false;
      } }, { armed: false });
    }
    const overlay = h("div", { class: "gm-test", role: "dialog", "aria-modal": "true", "aria-label": "Spiel ausprobieren" }, h("div", { class: "gm-test-frame" }, canvas, result),
      h("button", { class: "gm-test-close", type: "button", "aria-label": "Schließen", onclick: close }, icon("close")));
    document.body.append(overlay);
    document.addEventListener("keydown", onKey);
    run();
  }

  // ------------------------------------------------------------------------------------------------------------------ a game as code (with a name, a photo and the code)
  /* The dialog to publish a game. `prefill` ({title, emoji, code}) is what the AI wrote (in the chat or in "Mit KI erstellen"); without it the field for the code is empty and offers
     "Mit KI erstellen". `camera` (optional) gets the game into its strip. */
  async function code({ camera, prefill } = {}) {
    if (!(await ensureGames())) { toast("Die Spiele konnten nicht geladen werden. Versuch es gleich noch einmal."); return; }
    let entry = null;
    let draftId = "";
    let busy = false;
    let emoji = (prefill && prefill.emoji) || "🎮";
    let photo = null;                                                 // {id, url}: the photo of the round button
    const name = h("input", { class: "field", type: "text", maxlength: 24, placeholder: "Wie heißt dein Spiel?", "aria-label": "Name des Spiels" });
    const source = h("textarea", { class: "field gm-code", rows: 12, spellcheck: false, autocapitalize: "off", autocomplete: "off", "aria-label": "Code deines Spiels", placeholder: "Hier steht dein Code." });
    const picker = h("input", { type: "file", accept: ".js,.txt,text/javascript,text/plain", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const photoPicker = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const status = h("p", { class: "muted small", role: "status" });
    const circle = h("button", { class: "gm-photo", type: "button", "aria-label": "Foto für den runden Knopf wählen", onclick: () => photoPicker.click() });
    const aiInput = h("input", { class: "field", type: "text", maxlength: 300, placeholder: "Was für ein Spiel? Zum Beispiel: ein Auto, das Hindernissen ausweicht", "aria-label": "Beschreibe dein Spiel" });
    const aiGo = h("button", { class: "btn primary", type: "button" }, "Erstellen");
    const aiBox = h("div", { class: "gm-ai", hidden: true }, aiInput, aiGo);
    const emptyBox = h("div", { class: "gm-empty" }, h("button", { class: "try-btn", type: "button", onclick: () => { aiBox.hidden = false; emptyBox.hidden = true; aiInput.focus(); } }, icon("sparkle"), "Mit KI erstellen"), h("span", { class: "muted small" }, "oder schreib deinen Code direkt hier"));
    if (prefill) { name.value = prefill.title || ""; source.value = prefill.code || ""; }
    const drawCircle = () => {
      circle.replaceChildren(photo ? h("img", { src: photo.url, alt: "" }) : h("span", { class: "gm-photo-ic" }, icon("camera")), h("small", {}, photo ? "Foto ändern" : "Foto für die Linse"));
    };
    const sync = () => { emptyBox.hidden = !!source.value.trim() || !aiBox.hidden; };
    source.addEventListener("input", sync);
    drawCircle();
    sync();

    photoPicker.addEventListener("change", async () => {
      const file = photoPicker.files[0];
      photoPicker.value = "";
      if (!file) return;
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { status.textContent = "Das ist kein Foto, das Nex kennt."; return; }
      status.textContent = "Das Foto wird hochgeladen …";
      try {
        const blob = await Y.prepareImage(file, { crop: { width: 256, height: 256 } });
        const up = await Api.upload(blob, { alt: "" });
        if (!up.ok) { status.textContent = Api.message(up); return; }
        photo = { id: up.data.media.id, url: up.data.media.url };
        drawCircle();
        status.textContent = "";
      } catch (problem) { status.textContent = "Dieses Bild konnte nicht gelesen werden."; }
    });
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      picker.value = "";
      if (!file) return;
      if (file.size > 40000) { status.textContent = "Die Datei ist zu groß (höchstens 20 000 Zeichen)."; return; }
      source.value = await file.text();
      sync();
    });

    aiGo.addEventListener("click", async () => {
      const wish = aiInput.value.trim();
      if (wish.length < 4) { status.textContent = "Schreib ein paar Wörter, was für ein Spiel es sein soll."; aiInput.focus(); return; }
      aiGo.disabled = true;
      status.textContent = "Die KI baut dein Spiel. Das dauert etwa eine halbe Minute …";
      const reply = await Api.post("/games/ai", { prompt: wish });
      aiGo.disabled = false;
      if (!reply.ok) { status.textContent = reply.data && reply.data.error === "not_allowed" ? "Das darf die KI nicht bauen. Probier eine andere Beschreibung." : reply.data && reply.data.error === "ai_failed" ? "Die KI hat gerade kein gutes Spiel hinbekommen. Probier es noch einmal." : Api.message(reply); return; }
      source.value = reply.data.code;
      if (!name.value.trim()) name.value = reply.data.title;
      emoji = reply.data.emoji || emoji;
      aiBox.hidden = true;
      sync();
      status.textContent = "Fertig. Probier das Spiel mit „Testen“ aus.";
    });

    /* Saves the code as a draft (the sealed worker serves drafts to their author) and answers the row, or says what is wrong with the code. */
    async function save() {
      const title = name.value.trim() || "Mein Spiel";
      const body = { kind: "code", title, emoji, color: "#7a2cf0", code: source.value, draft: true, ...(photo ? { icon: photo.id } : {}) };
      const reply = draftId ? await Api.put(`/community-games/${draftId}`, body) : await Api.post("/community-games", body);
      if (!reply.ok) { status.textContent = (reply.data && reply.data.message) || (reply.data && reply.data.error === "not_allowed" ? "Dieser Name passt nicht." : Api.message(reply)); return null; }
      draftId = reply.data.game.id;
      return reply.data.game;
    }
    async function test() {
      if (busy) return;
      busy = true;
      status.textContent = "Dein Spiel wird gespeichert …";
      const row = await save();
      busy = false;
      if (!row) return;
      status.textContent = "";
      tryGame(row, "Zurück zum Code");
    }
    async function publish() {
      if (busy) return;
      if (name.value.trim().length < 2) { status.textContent = "Gib deinem Spiel einen Namen."; name.focus(); return; }
      if (!photo) { status.textContent = "Wähle noch ein Foto für den runden Knopf unten in der Linsenleiste."; return; }
      busy = true;
      status.textContent = "Dein Spiel wird veröffentlicht …";
      const row = await save();
      if (!row) { busy = false; return; }
      const done = await Api.post(`/community-games/${row.id}/publish`);
      busy = false;
      if (!done.ok) { status.textContent = Api.message(done); return; }
      const item = toItem({ ...done.data.game, user: Y.me });
      known.set(item.id, { ...done.data.game, data: source.value });
      entry.close();
      if (camera) camera.add(item);
      toast(camera ? "Dein Spiel ist online. Alle können es spielen." : "Dein Spiel ist online. Du findest es in der Kamera, ganz links.");
    }
    entry = dialog({ title: "Spiel-Code hochladen", wide: true, body: h("div", { class: "game-maker" },
      h("div", { class: "gm-head" }, circle, h("div", { class: "gm-head-main" }, name, h("small", { class: "muted" }, "Das Foto ist der runde Knopf deines Spiels unten in der Linsenleiste."))),
      photoPicker,
      h("div", { class: "gm-codebox" }, source, emptyBox), aiBox, picker, status,
      h("details", { class: "gm-help" }, h("summary", {}, "Wie funktioniert der Code?"),
        h("p", { class: "muted small" }, "Das Spiel läuft abgeschottet: ohne Internet, ohne Zugriff auf Nex, nur mit dem Finger als Eingabe und einer Fläche von 360 × 640."),
        h("ul", { class: "gm-api" },
          h("li", {}, h("code", {}, "function start()"), " läuft einmal am Anfang."),
          h("li", {}, h("code", {}, "function update(dt, input)"), ": ", h("code", {}, "dt"), " sind Sekunden, ", h("code", {}, "input"), " hat x, y, down, pressed, tap, released, swipe."),
          h("li", {}, h("code", {}, "function draw(g)"), " malt das Bild (", h("code", {}, "g"), " ist ein Canvas-2D-Kontext, durchsichtig: dahinter ist deine Kamera)."),
          h("li", {}, h("code", {}, "game.score(n)"), " setzt die Punkte, ", h("code", {}, "game.over()"), " beendet das Spiel, ", h("code", {}, "game.random()"), " gibt Zufall."))),
      h("div", { class: "gm-actions" }, h("button", { class: "btn ghost small", type: "button", onclick: () => picker.click() }, "Datei laden"), h("button", { class: "btn ghost", type: "button", onclick: test }, "Testen"), h("button", { class: "btn primary", type: "button", onclick: publish }, "Veröffentlichen"))), initialFocus: name });
  }

  // ------------------------------------------------------------------------------------------------------------------ "Mit KI erstellen"
  const AI_EXAMPLES = ["Ein Auto, das Hindernissen ausweicht", "Ein Ball, der durch Lücken fliegt", "Ein Spiel, in dem man Sterne fängt", "Ein Weltraumschiff, das Asteroiden abschießt", "Eine Schlange, die Äpfel frisst"];

  function ai({ camera } = {}) {
    let entry = null;
    let kind = "game";                                                // "game" or "lens"
    const wish = h("textarea", { class: "field", rows: 3, maxlength: 300, placeholder: "Was willst du bauen?", "aria-label": "Beschreibe, was die KI bauen soll" });
    const status = h("p", { class: "muted small", role: "status" });
    const go = h("button", { class: "btn primary", type: "button" }, "Los");
    const kinds = h("div", { class: "gm-kinds", role: "group", "aria-label": "Was soll gebaut werden?" });
    const chips = h("div", { class: "lm-chips" });
    const EXAMPLES = { game: AI_EXAMPLES, lens: ["Mach die Person dumm aussehend", "Ein Hase mit riesigen Zähnen", "Eine schwarze Strickmaske wie ein Ninja", "Ich bin ein Roboter mit leuchtenden Augen"] };
    function draw() {
      fill(kinds, ...[["game", "Spiel"], ["lens", "Linse"]].map(([id, label]) => h("button", { class: `chip${kind === id ? " on" : ""}`, type: "button", "aria-pressed": String(kind === id), onclick: () => { kind = id; draw(); } }, label)));
      wish.placeholder = kind === "game" ? "Zum Beispiel: ein Spiel, in dem ich mit dem Finger ein Auto lenke" : "Zum Beispiel: mach mich zum Ninja mit Sonnenbrille";
      fill(chips, ...EXAMPLES[kind].slice().sort(() => Math.random() - 0.5).slice(0, 4).map((text) => h("button", { class: "chip", type: "button", onclick: () => { wish.value = text; wish.focus(); } }, text)));
    }
    draw();
    go.addEventListener("click", async () => {
      const text = wish.value.trim();
      if (text.length < 4) { status.textContent = "Schreib ein paar Wörter, was die KI bauen soll."; wish.focus(); return; }
      if (kind === "lens") { entry.close(); Y.cameraCreate?.lensMaker(camera, { prompt: text, auto: true }); return; }
      if (!(await ensureGames())) { status.textContent = "Die Spiele konnten nicht geladen werden."; return; }
      go.disabled = true;
      status.textContent = "Die KI baut dein Spiel. Das dauert etwa eine halbe Minute …";
      const reply = await Api.post("/games/ai", { prompt: text });
      go.disabled = false;
      if (!reply.ok) { status.textContent = reply.data && reply.data.error === "not_allowed" ? "Das darf die KI nicht bauen. Probier eine andere Beschreibung." : reply.data && reply.data.error === "ai_failed" ? "Die KI hat gerade kein gutes Spiel hinbekommen. Probier es noch einmal." : Api.message(reply); return; }
      entry.close();
      code({ camera, prefill: { title: reply.data.title, emoji: reply.data.emoji, code: reply.data.code } });
    });
    entry = dialog({ title: "Mit KI erstellen", body: h("div", { class: "lens-maker" },
      h("p", { class: "muted" }, "Beschreib in ein paar Worten, was du haben willst. Die KI baut es für dich. Danach kannst du es ausprobieren, ändern und veröffentlichen."),
      kinds, wish, chips, h("div", { class: "lm-actions" }, go), status), initialFocus: wish });
  }

  Y.communityGames = { list, find, fetch: fetchRow, toItem, played, known, ensureGames, tryGame };
  Y.gameMaker = { code, ai };
})();
