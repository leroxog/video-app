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
      hint: row.kind === "ranking" ? `Rangliste von ${who}` : `Spiel von ${who}`, plays: row.plays, user: row.user };
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
  function tryGame(row, back, custom) {
    const PG = window.PulseGames;
    const def = custom || PG.community.codeDef({ ...row, user: Y.me, hint: "Dein Spiel" });
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

  // ------------------------------------------------------------------------------------------------------------------ a ranking (a title, Top 5 or Top 10, entries with a name and a picture)
  const RANK_COLORS = ["#2a8cff", "#ec4899", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#14b8a6", "#f97316"];

  /* The dialog to make a ranking: the title, 5 or 10 places, the entries (a name and a picture from Wikimedia Commons, or a photo of the person's own), and "KI schlägt vor" for the entries. */
  async function ranking({ camera, title: start = "", auto = false } = {}) {
    if (!(await ensureGames())) { toast("Die Spiele konnten nicht geladen werden. Versuch es gleich noch einmal."); return; }
    let entry = null;
    let size = 5;
    let busy = false;
    let open = -1;                                                    // the row whose pictures are shown
    const rows = [];                                                  // {name, media: {id, url} | null, credit}
    const title = h("input", { class: "field", type: "text", maxlength: 24, placeholder: "Titel, zum Beispiel: Die besten Pizzasorten", "aria-label": "Titel der Rangliste" });
    const sizes = h("div", { class: "gm-kinds", role: "group", "aria-label": "Wie viele Plätze hat die Rangliste?" });
    const list = h("div", { class: "rk-list" });
    const status = h("p", { class: "muted small", role: "status" });
    const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    let uploadFor = null;
    title.value = start;

    const initials = (name) => (name || "?").split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
    function drawSizes() {
      fill(sizes, ...[5, 10].map((n) => h("button", { class: `chip${size === n ? " on" : ""}`, type: "button", "aria-pressed": String(size === n), onclick: () => { size = n; drawSizes(); } }, `Top ${n}`)));
    }
    function drawRows() {
      fill(list, ...rows.map((row, index) => {
        const name = h("input", { class: "field", type: "text", maxlength: 30, value: row.name, placeholder: `Platz-Kandidat ${index + 1}`, "aria-label": `Name von Eintrag ${index + 1}` });
        name.addEventListener("input", () => { row.name = name.value; });
        const thumb = row.media ? h("img", { class: "rk-thumb", src: row.media.url, alt: "" }) : h("span", { class: "rk-thumb none", "aria-hidden": "true" }, initials(row.name));
        const line = h("div", { class: "rk-row" }, thumb, name,
          h("button", { class: "icon-btn small", type: "button", "aria-label": `Bild für ${row.name || "den Eintrag"} suchen`, onclick: () => showPictures(index) }, icon("search")),
          h("button", { class: "icon-btn small", type: "button", "aria-label": "Eigenes Foto nehmen", onclick: () => { uploadFor = row; picker.click(); } }, icon("image")),
          h("button", { class: "icon-btn small", type: "button", "aria-label": "Eintrag entfernen", onclick: () => { rows.splice(index, 1); open = -1; drawRows(); } }, icon("close")));
        return h("div", { class: "rk-item" }, line, open === index ? h("div", { class: "rk-pick", "data-for": String(index) }, h("small", { class: "muted" }, "Bilder werden gesucht …")) : null, row.credit && row.media ? h("small", { class: "rk-credit" }, `Bild: ${row.credit.author}, ${row.credit.licence}`) : null);
      }));
    }
    async function pick(row, found) {
      status.textContent = "Das Bild wird übernommen …";
      const reply = await Api.post("/ranking/pick", { url: found.url, credit: { author: found.author, licence: found.licence, page: found.page } });
      if (!reply.ok) { status.textContent = Api.message(reply); return false; }
      row.media = { id: reply.data.media.id, url: reply.data.media.url };
      row.credit = reply.data.credit || null;
      status.textContent = "";
      return true;
    }
    async function showPictures(index) {
      open = open === index ? -1 : index;
      drawRows();
      if (open !== index) return;
      const row = rows[index];
      const box = list.querySelector(`.rk-pick[data-for="${index}"]`);
      if (!row.name.trim()) { box.replaceChildren(h("small", { class: "muted" }, "Schreib erst den Namen.")); return; }
      const reply = await Api.get(`/ranking/images?q=${encodeURIComponent(row.name.trim())}`);
      if (!box.isConnected) return;
      if (!reply.ok || !reply.data.items.length) { box.replaceChildren(h("small", { class: "muted" }, "Dazu gibt es kein freies Bild. Nimm ein eigenes Foto.")); return; }
      box.replaceChildren(...reply.data.items.map((found) => h("button", { class: "rk-choice", type: "button", "aria-label": `Bild ${found.title}`, onclick: async () => { if (await pick(row, found)) { open = -1; drawRows(); } } }, h("img", { src: found.url, alt: "", loading: "lazy" }))));
    }
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      picker.value = "";
      const row = uploadFor;
      uploadFor = null;
      if (!file || !row) return;
      if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { status.textContent = "Das ist kein Foto, das Nex kennt."; return; }
      status.textContent = "Das Foto wird hochgeladen …";
      try {
        const blob = await Y.prepareImage(file, { crop: { width: 256, height: 256 } });
        const up = await Api.upload(blob, { alt: "" });
        if (!up.ok) { status.textContent = Api.message(up); return; }
        row.media = { id: up.data.media.id, url: up.data.media.url };
        row.credit = null;
        status.textContent = "";
        drawRows();
      } catch (problem) { status.textContent = "Dieses Bild konnte nicht gelesen werden."; }
    });

    async function suggest() {
      const text = title.value.trim();
      if (text.length < 3) { status.textContent = "Gib deiner Rangliste erst einen Titel."; title.focus(); return; }
      busy = true;
      status.textContent = "Die KI sucht passende Einträge …";
      const reply = await Api.post("/ranking/suggest", { title: text });
      busy = false;
      if (!reply.ok) { status.textContent = reply.data && reply.data.error === "ai_failed" ? "Die KI hat gerade keine Einträge gefunden. Schreib sie selbst oder probier es noch einmal." : reply.data && reply.data.error === "not_allowed" ? "Dazu schlägt die KI nichts vor." : Api.message(reply); return; }
      for (const name of reply.data.entries) if (rows.length < 24 && !rows.some((row) => row.name.toLowerCase() === name.toLowerCase())) rows.push({ name, media: null, credit: null });
      drawRows();
      status.textContent = "Das sind die Vorschläge. Ändere, was du willst, und lass die Bilder suchen.";
    }
    async function pictures() {
      busy = true;
      let found = 0;
      for (const row of rows) {
        if (row.media || !row.name.trim()) continue;
        status.textContent = `Bild für ${row.name} wird gesucht …`;
        const reply = await Api.get(`/ranking/images?q=${encodeURIComponent(row.name.trim())}`);
        if (reply.ok && reply.data.items.length && (await pick(row, reply.data.items[0]))) { found += 1; drawRows(); }
      }
      busy = false;
      status.textContent = found ? "Die Bilder sind da. Tipp auf die Lupe, wenn du ein anderes willst." : "Es gab keine neuen Bilder.";
    }
    function data() {
      const named = rows.filter((row) => row.name.trim());
      return { title: title.value.trim(), size, named, body: { size, entries: named.map((row) => ({ name: row.name.trim(), ...(row.media ? { media: row.media.id } : {}), ...(row.credit ? { credit: row.credit } : {}) })) } };
    }
    function check() {
      const d = data();
      if (d.title.length < 2) { status.textContent = "Gib deiner Rangliste einen Titel."; title.focus(); return null; }
      if (d.named.length < size) { status.textContent = `Für eine Top ${size} brauchst du mindestens ${size} Einträge (jetzt ${d.named.length}).`; return null; }
      return d;
    }
    function test() {
      const d = check();
      if (!d) return;
      const PG = window.PulseGames;
      tryGame({}, "Zurück zur Liste", PG.rankDef({ id: "rank-test", title: d.title, color: RANK_COLORS[0], size, entries: d.named.map((row) => ({ name: row.name.trim(), url: row.media ? row.media.url : null })) }));
    }
    async function publish() {
      if (busy) return;
      const d = check();
      if (!d) return;
      busy = true;
      status.textContent = "Deine Rangliste wird veröffentlicht …";
      const first = d.named.find((row) => row.media);
      const color = RANK_COLORS[d.title.length % RANK_COLORS.length];
      const reply = await Api.post("/community-games", { kind: "ranking", title: d.title, emoji: "🏆", color, ranking: d.body, ...(first ? { icon: first.media.id } : {}) });
      busy = false;
      if (!reply.ok) { status.textContent = (reply.data && reply.data.message) || (reply.data && reply.data.error === "not_allowed" ? "Der Titel oder ein Name passt nicht." : Api.message(reply)); return; }
      const row = { ...reply.data.game, ranking: { size, entries: d.named.map((r) => ({ name: r.name.trim(), url: r.media ? r.media.url : null, credit: r.credit })) } };
      known.set(row.id, row);
      entry.close();
      if (camera) camera.add(toItem({ ...row, user: Y.me }));
      toast(camera ? "Deine Rangliste ist online. Alle können sie spielen." : "Deine Rangliste ist online. Du findest sie in der Kamera.");
    }

    drawSizes();
    entry = dialog({ title: "Rangliste erstellen", wide: true, body: h("div", { class: "game-maker" },
      h("p", { class: "muted" }, "Wähle einen Titel und die Einträge. Beim Spielen rollt über dem Kopf ein Bild nach dem anderen, und man tippt auf den Platz, auf den es gehört."),
      title, sizes, list, picker,
      h("div", { class: "gm-actions" },
        h("button", { class: "btn ghost small", type: "button", onclick: () => { if (rows.length < 24) { rows.push({ name: "", media: null, credit: null }); drawRows(); list.lastElementChild?.querySelector("input")?.focus(); } } }, "Eintrag dazu"),
        h("button", { class: "try-btn", type: "button", onclick: () => !busy && suggest() }, icon("sparkle"), "KI schlägt vor"),
        h("button", { class: "btn ghost small", type: "button", onclick: () => !busy && pictures() }, "Bilder suchen")),
      status,
      h("div", { class: "gm-actions" }, h("button", { class: "btn ghost", type: "button", onclick: test }, "Testen"), h("button", { class: "btn primary", type: "button", onclick: publish }, "Veröffentlichen"))), initialFocus: title });
    drawRows();
    if (start && auto) suggest();
  }

  // ------------------------------------------------------------------------------------------------------------------ "Mit KI erstellen"
  const AI_EXAMPLES = ["Ein Auto, das Hindernissen ausweicht", "Ein Ball, der durch Lücken fliegt", "Ein Spiel, in dem man Sterne fängt", "Ein Weltraumschiff, das Asteroiden abschießt", "Eine Schlange, die Äpfel frisst"];

  function ai({ camera } = {}) {
    let entry = null;
    let kind = "game";                                                // "game", "lens" or "ranking"
    const wish = h("textarea", { class: "field", rows: 3, maxlength: 300, placeholder: "Was willst du bauen?", "aria-label": "Beschreibe, was die KI bauen soll" });
    const status = h("p", { class: "muted small", role: "status" });
    const go = h("button", { class: "btn primary", type: "button" }, "Los");
    const kinds = h("div", { class: "gm-kinds", role: "group", "aria-label": "Was soll gebaut werden?" });
    const chips = h("div", { class: "lm-chips" });
    const EXAMPLES = { game: AI_EXAMPLES, lens: ["Mach die Person dumm aussehend", "Ein Hase mit riesigen Zähnen", "Eine schwarze Strickmaske wie ein Ninja", "Ich bin ein Roboter mit leuchtenden Augen"],
      ranking: ["Die besten Fußballer der Welt", "Meine liebsten Pizzasorten", "Die schönsten Länder", "Die berühmtesten Sänger"] };
    function draw() {
      fill(kinds, ...[["game", "Spiel"], ["lens", "Linse"], ["ranking", "Rangliste"]].map(([id, label]) => h("button", { class: `chip${kind === id ? " on" : ""}`, type: "button", "aria-pressed": String(kind === id), onclick: () => { kind = id; draw(); } }, label)));
      wish.placeholder = kind === "game" ? "Zum Beispiel: ein Spiel, in dem ich mit dem Finger ein Auto lenke" : kind === "lens" ? "Zum Beispiel: mach mich zum Ninja mit Sonnenbrille" : "Der Titel, zum Beispiel: die besten Pizzasorten";
      fill(chips, ...EXAMPLES[kind].slice().sort(() => Math.random() - 0.5).slice(0, 4).map((text) => h("button", { class: "chip", type: "button", onclick: () => { wish.value = text; wish.focus(); } }, text)));
    }
    draw();
    go.addEventListener("click", async () => {
      const text = wish.value.trim();
      if (text.length < 4) { status.textContent = "Schreib ein paar Wörter, was die KI bauen soll."; wish.focus(); return; }
      if (kind === "lens") { entry.close(); Y.cameraCreate?.lensMaker(camera, { prompt: text, auto: true }); return; }
      if (kind === "ranking") { entry.close(); ranking({ camera, title: text.slice(0, 24), auto: true }); return; }
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
  Y.gameMaker = { code, ai, ranking };
})();
