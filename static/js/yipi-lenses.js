/* Nex lenses (yipi-lenses.js): the ready-made face lenses of the camera tab, and what belongs to them: the lens a person writes as a prompt ("mach mich dumm aussehend"),
   which the server turns into a recipe of the effects below, the lenses that other people published, and the button "Ausprobieren" under a video that was made with one.
   The effects themselves (and the face tracking) are in pl-face.js, loaded when a lens is opened first. A recipe is {fx: [effect names], filter: name of a colour filter}. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { fill, h, icon, toast } = Y;

  /* The ready-made lenses: id "l-...", a name, the picture of the round button, a colour, what the prompt would be, and the recipe. */
  const PRESETS = [
    ["l-dumm", "Dummkopf", "🤪", "#f7b500", "Mach die Person dumm aussehend", ["crossEyes", "buckTeeth", "tongue", "propellerHat"], "none", "Lustig"],
    ["l-zaehne", "Riesenzähne", "😁", "#ff5c8a", "Gib mir riesige Zähne", ["bigTeeth", "blush"], "vivid", "Lustig"],
    ["l-sturmhaube", "Sturmhaube", "🥷", "#2b2b30", "Setz mir eine schwarze Strickmaske auf", ["balaclava"], "none", "Masken"],
    ["l-ninja", "Ninja", "🥷", "#3a3a44", "Ich bin ein Ninja mit Sonnenbrille", ["balaclava", "sunglasses"], "noir", "Masken"],
    ["l-hase", "Hase", "🐰", "#ffb3c7", "Mach mich zu einem Hasen mit großen Zähnen", ["bunnyEars", "buckTeeth", "blush"], "dream", "Tiere"],
    ["l-hund", "Hund", "🐶", "#b8864b", "Mach mich zu einem Hund, der die Zunge rausstreckt", ["dogEars"], "warm", "Tiere"],
    ["l-katze", "Katze", "🐱", "#8f8fa6", "Mach mich zu einer süßen Katze", ["catEars", "blush"], "dream", "Tiere"],
    ["l-cool", "Cool", "😎", "#2a8cff", "Gib mir eine coole Sonnenbrille", ["sunglasses"], "vivid", "Lustig"],
    ["l-verliebt", "Verliebt", "😍", "#ff3b6b", "Ich bin total verliebt", ["heartEyes", "hearts", "blush"], "warm", "Liebe"],
    ["l-herzbrille", "Herzbrille", "💖", "#ff7aa8", "Eine Brille aus Herzen", ["heartGlasses", "hearts"], "dream", "Liebe"],
    ["l-clown", "Clown", "🤡", "#e0245e", "Mach mich zu einem Clown", ["clownWig", "clownNose", "blush"], "vivid", "Lustig"],
    ["l-teufel", "Teufel", "😈", "#b3202e", "Mach mich zu einem kleinen Teufel", ["devilHorns", "angry"], "vivid", "Fantasie"],
    ["l-engel", "Engel", "😇", "#8fd0ff", "Mach mich zu einem Engel", ["halo", "sparkles"], "dream", "Fantasie"],
    ["l-koenig", "König", "👑", "#d99a00", "Ich bin der König oder die Königin", ["crown", "sparkles"], "warm", "Fantasie"],
    ["l-pirat", "Pirat", "🏴‍☠️", "#5b4636", "Mach mich zum Piraten", ["pirate", "beard"], "retro", "Fantasie"],
    ["l-roboter", "Roboter", "🤖", "#7d868f", "Ich bin ein Roboter", ["robot"], "cool", "Fantasie"],
    ["l-zombie", "Zombie", "🧟", "#4b7a3a", "Mach mich zum Zombie", ["zombie"], "night", "Fantasie"],
    ["l-regenbogen", "Regenbogen", "🌈", "#a24bf0", "Mach den Mund auf und ein Regenbogen kommt raus", ["rainbow", "sparkles"], "vivid", "Lustig"],
    ["l-heul", "Heulsuse", "😭", "#3d8bff", "Ich muss weinen", ["tears", "blush"], "cool", "Lustig"],
    ["l-feuer", "Feuerkopf", "🔥", "#ff6a00", "Meine Augen brennen", ["fireEyes", "angry"], "warm", "Fantasie"],
    ["l-hypno", "Hypnose", "😵‍💫", "#7a2cf0", "Hypnotisiere alle mit kreisenden Augen", ["swirlEyes"], "vivid", "Lustig"],
    ["l-reich", "Reich", "🤑", "#1c9a3a", "Ich bin reich", ["moneyEyes", "sparkles", "crown"], "warm", "Lustig"],
    ["l-riesenaugen", "Riesenaugen", "👀", "#ffd23a", "Mach meine Augen riesig", ["bigEyes"], "none", "Verzerrt"],
    ["l-dickerkopf", "Dicker Kopf", "🎈", "#ff8a5c", "Blas meinen Kopf auf", ["bigHead"], "none", "Verzerrt"],
    ["l-nase", "Riesennase", "👃", "#e8a77a", "Gib mir eine riesige Nase", ["bigNose", "clownNose"], "none", "Verzerrt"],
    ["l-mund", "Riesenmund", "👄", "#e0245e", "Mach meinen Mund riesig", ["bigMouth", "tongue"], "none", "Verzerrt"],
    ["l-wackel", "Wackelaugen", "🥴", "#a3e635", "Gib mir große Wackelaugen", ["googlyEyes"], "none", "Lustig"],
    ["l-sabber", "Sabberbacke", "🤤", "#38bdf8", "Ich sabbere und schiele", ["crossEyes", "drool", "tongue"], "none", "Lustig"],
    ["l-nerd", "Nerd", "🤓", "#6b7280", "Mach mich zum Streber", ["nerdGlasses", "buckTeeth"], "none", "Lustig"],
    ["l-gentleman", "Gentleman", "🧐", "#1f2937", "Ich bin ein feiner Herr", ["tophatCane"], "retro", "Masken"],
    ["l-sterne", "Sternenaugen", "🤩", "#fbbf24", "Ich sehe nur Sterne", ["starGlasses", "sparkles"], "vivid", "Liebe"],
    ["l-party", "Party", "🎉", "#f472b6", "Lass es regnen vor Konfetti", ["confetti", "blush"], "vivid", "Fantasie"],
    ["l-schnee", "Schnee", "❄️", "#93c5fd", "Es schneit", ["snow"], "cool", "Fantasie"],
    ["l-opa", "Opa", "🧔", "#78716c", "Mach mich alt mit Vollbart und runder Brille", ["beard", "roundGlasses"], "retro", "Masken"],
    ["l-schnurri", "Schnurrbart", "🥸", "#57534e", "Gib mir einen riesigen Schnurrbart", ["mustache", "monocle"], "retro", "Masken"],
    ["l-sommer", "Sommersprossen", "🌞", "#fb923c", "Gib mir Sommersprossen und rote Wangen", ["freckles", "blush"], "warm", "Liebe"],
    ["l-retro", "Retro", "📼", "#c2410c", "Mach ein Retro-Video aus den 80ern", ["sunglasses"], "retro", "Filter"],
    ["l-noir", "Schwarzweiß", "🎞️", "#52525b", "Ein alter Schwarzweißfilm", ["roundGlasses"], "noir", "Filter"],
    ["l-traum", "Traum", "💭", "#c4b5fd", "Ein weicher Traum mit Glitzer", ["sparkles", "halo"], "dream", "Filter"],
    ["l-nacht", "Nacht", "🌙", "#1e3a8a", "Es ist mitten in der Nacht", ["sparkles"], "night", "Filter"],
    ["l-wuetend", "Wütend", "😠", "#dc2626", "Ich bin richtig sauer", ["angry", "fireEyes"], "vivid", "Lustig"],
    ["l-narr", "Narr", "🃏", "#a855f7", "Mach mich zum Dorftrottel", ["dunceHat", "crossEyes", "drool"], "none", "Lustig"],
    ["l-dickbacke", "Dickbacke", "🐹", "#fdba74", "Mach mich zum Hamster mit dicken Backen", ["bigHead", "blush", "buckTeeth"], "dream", "Verzerrt"],
    ["l-lachflash", "Lachflash", "😂", "#facc15", "Ich lache Tränen", ["tears", "bigTeeth"], "vivid", "Lustig"],
    ["l-popstar", "Popstar", "🎤", "#ec4899", "Ich bin ein Popstar", ["sunglasses", "sparkles", "confetti"], "vivid", "Fantasie"],
    ["l-alien", "Alien", "👽", "#22c55e", "Mach mich zum Außerirdischen", ["bigEyes", "bigHead"], "cool", "Verzerrt"],
    ["l-schiel", "Schieler", "😵", "#06b6d4", "Ich schiele", ["crossEyes"], "none", "Lustig"],
  ].map(([id, name, emoji, color, prompt, fx, filter, cat]) => ({ id, name, emoji, color, prompt, fx, filter, cat, kind: "lens", hint: prompt, preset: true }));

  const byId = new Map(PRESETS.map((lens) => [lens.id, lens]));
  const known = new Map();                              // lenses of other people that were looked at (from the server)

  /* The lens with this id: a ready-made one at once, another one from the server (once). */
  async function find(id) {
    if (byId.has(id)) return byId.get(id);
    if (known.has(id)) return known.get(id);
    if (!/^lu-[0-9a-f]{8}$/.test(String(id))) return null;
    const reply = await Api.get(`/lenses/${id}`);
    if (!reply.ok) return null;
    const lens = fromServer(reply.data.lens);
    known.set(id, lens);
    return lens;
  }

  /* A lens of the server as a lens of the camera strip. */
  function fromServer(row) {
    return { id: row.id, name: row.title, emoji: row.emoji || "✨", color: row.color || "#7a2cf0", prompt: row.prompt, fx: row.fx || [], filter: row.filter || "none", cat: "Community",
      kind: "lens", hint: row.prompt, by: row.user, uses: row.uses || 0, mine: !!row.mine, community: true };
  }

  async function community() {
    const reply = await Api.get("/lenses?sort=popular&limit=40");
    if (!reply.ok) return [];
    const list = reply.data.items.map(fromServer);
    for (const lens of list) known.set(lens.id, lens);
    return list;
  }

  // ------------------------------------------------------------------------------------------------------------------ "Ausprobieren": the button under a video that was made with a lens (or a game)
  /* `camId` is the id of the lens or game of the camera tab the video was made with. The button opens the camera with it. */
  function tryButton(camId, { compact = false } = {}) {
    const isLens = /^(l-|lu-)/.test(String(camId));
    return h("button", { class: `try-btn${compact ? " compact" : ""}`, type: "button", "aria-label": isLens ? "Diese Linse ausprobieren" : "Dieses Spiel mitspielen",
      onclick: (event) => { event.stopPropagation(); Y.navigate(`/camera/${camId}`); } }, icon("sparkle"), h("span", {}, isLens ? "Ausprobieren" : "Mitspielen"));
  }

  // ------------------------------------------------------------------------------------------------------------------ the panel of the small "create" lens
  const EXAMPLES = [
    "Mach die Person dumm aussehend", "Ein Hase mit riesigen Zähnen", "Ich bin ein Roboter mit leuchtenden Augen", "Eine schwarze Strickmaske wie ein Ninja", "Verliebt mit Herzen und roten Wangen",
    "Mach mich zum Zombie in der Nacht", "Ein König mit goldener Krone und Glitzer", "Meine Augen riesig und der Kopf dick", "Ein Clown mit bunter Perücke", "Alter Schwarzweißfilm mit Schnurrbart",
    "Ein Pirat mit Bart", "Ich schiele und sabbere", "Ein Engel, ganz weich und verträumt", "Ein Teufel mit brennenden Augen", "Wütend wie ein Stier", "Reich und berühmt wie ein Popstar",
  ];

  function createPanel({ host, camera }) {
    const mine = h("div", { class: "cc-mine" });
    const panel = h("div", { class: "cam-create", role: "group", "aria-label": "Erstellen" },
      h("h2", {}, "Erstelle etwas Eigenes"),
      h("p", { class: "cc-sub" }, "Veröffentlichen und alle auf Nex können es benutzen."),
      h("button", { class: "cc-card", type: "button", onclick: () => lensMaker(camera) }, h("span", { class: "cc-ic" }, "✨"), h("span", { class: "cc-text" }, h("b", {}, "Linse mit Prompt"), h("small", {}, "Schreib, wie du aussehen willst: dumm, mit großen Zähnen, als Roboter …"))),
      h("button", { class: "cc-card", type: "button", onclick: () => (Y.gameMaker ? Y.gameMaker.platformer(camera) : toast("Der Spiele-Baukasten ist gleich da.")) }, h("span", { class: "cc-ic" }, "🎮"), h("span", { class: "cc-text" }, h("b", {}, "Jump & Run bauen"), h("small", {}, "Setz Blöcke, Münzen und Gegner und teile dein Level"))),
      h("button", { class: "cc-card", type: "button", onclick: () => (Y.gameMaker ? Y.gameMaker.code(camera) : toast("Das Hochladen von Spielen ist gleich da.")) }, h("span", { class: "cc-ic" }, "🧩"), h("span", { class: "cc-text" }, h("b", {}, "Spiel-Code hochladen"), h("small", {}, "Dein eigenes Spiel aus JavaScript, sicher in einer Sandbox"))),
      mine);
    host.append(panel);
    Api.get("/community-games?sort=mine&limit=20").then((reply) => {
      if (!reply.ok || !reply.data.items.length || !panel.isConnected) return;
      panel.append(h("h3", {}, "Deine Spiele"), ...reply.data.items.map((row) => h("div", { class: "cc-row" },
        h("span", { class: "cc-ic small", style: `background:${row.color}` }, row.emoji), h("span", { class: "cc-text" }, h("b", {}, row.title), h("small", {}, `${row.plays} ${row.plays === 1 ? "Mal" : "Mal"} gespielt`)),
        h("button", { class: "icon-btn small", type: "button", "aria-label": `${row.title} spielen`, onclick: () => { const item = Y.communityGames.toItem(row); camera.add(item); } }, icon("camera")),
        h("button", { class: "icon-btn small", type: "button", "aria-label": `${row.title} löschen`, onclick: async () => {
          if (!(await Y.confirmBox({ title: "Spiel löschen?", text: `„${row.title}“ verschwindet für alle.`, yes: "Löschen", danger: true }))) return;
          const gone = await Api.del(`/community-games/${row.id}`);
          if (gone.ok) { camera.remove(row.id); toast("Das Spiel ist gelöscht."); } else toast(Api.message(gone));
        } }, icon("trash")))));
    });
    Api.get("/lenses?sort=mine&limit=20").then((reply) => {
      if (!reply.ok || !reply.data.items.length || !panel.isConnected) return;
      fill(mine, h("h3", {}, "Deine Linsen"), ...reply.data.items.map((row) => h("div", { class: "cc-row" },
        h("span", { class: "cc-ic small", style: `background:${row.color}` }, row.emoji), h("span", { class: "cc-text" }, h("b", {}, row.title), h("small", {}, `${row.uses} ${row.uses === 1 ? "Mal" : "Mal"} benutzt`)),
        h("button", { class: "icon-btn small", type: "button", "aria-label": `${row.title} ausprobieren`, onclick: () => { known.set(row.id, fromServer(row)); camera.add(known.get(row.id)); } }, icon("camera")),
        h("button", { class: "icon-btn small", type: "button", "aria-label": `${row.title} löschen`, onclick: async () => {
          if (!(await Y.confirmBox({ title: "Linse löschen?", text: `„${row.title}“ verschwindet für alle.`, yes: "Löschen", danger: true }))) return;
          const gone = await Api.del(`/lenses/${row.id}`);
          if (gone.ok) { known.delete(row.id); camera.remove(row.id); toast("Die Linse ist gelöscht."); } else toast(Api.message(gone));
        } }, icon("trash")))));
    });
  }

  /* The dialog to write a prompt for a lens: the server makes a recipe of it (the AI service chooses the effects), the person gives it a name and publishes it. */
  function lensMaker(camera) {
    let entry = null;
    let recipe = null;
    const prompt = h("textarea", { class: "field", rows: 3, maxlength: 200, placeholder: "Zum Beispiel: Mach die Person dumm aussehend", "aria-label": "Beschreibe deine Linse" });
    const chips = h("div", { class: "lm-chips" }, EXAMPLES.slice().sort(() => Math.random() - 0.5).slice(0, 6).map((text) => h("button", { class: "chip", type: "button", onclick: () => { prompt.value = text; prompt.focus(); } }, text)));
    const status = h("p", { class: "muted small", role: "status" });
    const build = h("button", { class: "btn primary", type: "button" }, "Linse bauen");
    const publish = h("button", { class: "btn primary", type: "button", hidden: true }, "Veröffentlichen");
    const title = h("input", { class: "field", type: "text", maxlength: 24, "aria-label": "Name der Linse" });
    const emoji = h("span", { class: "lm-emoji" });
    const effects = h("ul", { class: "lm-effects" });
    const result = h("div", { class: "lm-result", hidden: true }, h("div", { class: "lm-card" }, emoji, h("div", { class: "lm-card-main" }, h("label", { class: "field-title", for: "lm-title" }, "Name"), title, effects)));
    function showRecipe() {
      emoji.textContent = recipe.emoji || "✨";
      emoji.style.background = recipe.color || "#7a2cf0";
      title.value = recipe.title;
      fill(effects, ...recipe.about.map((text) => h("li", {}, text)), h("li", { class: "lm-filter" }, `Farbfilter: ${FILTER_LABELS[recipe.filter] || "Normal"}`));
      result.hidden = false;
      publish.hidden = false;
      build.textContent = "Anders versuchen";
      status.textContent = recipe.source === "ai" ? "Die KI hat die Effekte für deine Beschreibung ausgesucht." : "Aus deinen Wörtern habe ich die passenden Effekte gebaut.";
    }
    build.addEventListener("click", async () => {
      const text = prompt.value.trim();
      if (text.length < 3) { status.textContent = "Schreib mindestens ein paar Wörter."; return; }
      build.disabled = true;
      status.textContent = "Die Linse wird gebaut …";
      const reply = await Api.post("/lenses/recipe", { prompt: text });
      build.disabled = false;
      if (!reply.ok) { status.textContent = reply.data && reply.data.error === "not_allowed" ? "Das darf ich nicht bauen. Probier eine andere Beschreibung." : Api.message(reply); return; }
      recipe = reply.data.recipe;
      showRecipe();
    });
    publish.addEventListener("click", async () => {
      if (!recipe) return;
      publish.disabled = true;
      const reply = await Api.post("/lenses", { title: title.value.trim() || recipe.title, prompt: prompt.value.trim(), emoji: recipe.emoji, color: recipe.color, fx: recipe.fx, filter: recipe.filter });
      publish.disabled = false;
      if (!reply.ok) { status.textContent = reply.data && reply.data.error === "not_allowed" ? "Der Name oder die Beschreibung passt nicht." : Api.message(reply); return; }
      const lens = fromServer(reply.data.lens);
      known.set(lens.id, lens);
      entry.close();
      camera.add(lens);
      toast("Deine Linse ist online. Alle können sie jetzt benutzen.");
    });
    entry = Y.dialog({ title: "Linse mit Prompt", body: h("div", { class: "lens-maker" },
      h("p", { class: "muted" }, "Beschreib in ein paar Worten, wie die Linse dein Gesicht verändern soll. Jeder, der sie benutzt, bekommt sie live auf sein eigenes Gesicht."),
      prompt, chips,
      h("div", { class: "lm-actions" }, build),
      status,
      result,
      h("div", { class: "lm-actions" }, publish)), initialFocus: prompt });
    title.id = "lm-title";
  }

  const FILTER_LABELS = { none: "Normal", warm: "Warm", cool: "Kühl", noir: "Schwarzweiß", vivid: "Knallig", retro: "Retro", dream: "Traum", night: "Nacht" };

  Y.cameraCreate = { panel: createPanel, lensMaker };
  Y.tryButton = tryButton;

  Y.lenses = { PRESETS, byId, find, community, fromServer, known };
})();
