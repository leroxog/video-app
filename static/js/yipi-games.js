/* Pulse games (yipi-games.js): the Games tab, laid out like a game portal (Poki): a hub with big tiles and topics, and the page of a game with the
   play field in the middle, its name and buttons below, the rules at the side and more games under it. The games themselves are separate files that
   are loaded when a game is opened (fruit-merge.js and the physics library in static/vendor/); the addresses come with the page (#yipiAssets).
   The best score of each game stays in this browser (localStorage "yipi.games"). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const { fill, put, h, icon, link, toast } = Y;
  const views = Y.views;

  let assets = {};
  try { assets = JSON.parse(document.getElementById("yipiAssets").textContent) || {}; } catch (error) { assets = {}; }

  const NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, ...children) {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) el.setAttribute(key, String(value));
    for (const child of children) if (child) el.append(child);
    return el;
  }

  /* The picture of Fruit Merge on its tile: a heap of fruits in the box of the game. */
  function fruitArt() {
    const fruits = [[88, 230, 46, "#e74c3c"], [196, 236, 54, "#e67e22"], [300, 226, 50, "#8e44ad"], [150, 156, 40, "#b5d94c"], [250, 150, 44, "#ff5c77"], [204, 84, 30, "#f2c230"], [96, 128, 24, "#e0452c"], [312, 120, 26, "#2fa84f"]];
    const defs = svg("defs", {}, ...fruits.map(([, , , colour], index) => svg("radialGradient", { id: `fm${index}`, cx: "35%", cy: "30%", r: "75%" },
      svg("stop", { offset: "0", "stop-color": "#fff", "stop-opacity": "0.75" }), svg("stop", { offset: "0.35", "stop-color": colour }), svg("stop", { offset: "1", "stop-color": colour, "stop-opacity": "0.78" }))));
    return svg("svg", { viewBox: "0 0 400 300", role: "img", "aria-label": "Früchte in einer Kiste", preserveAspectRatio: "xMidYMid meet" },
      defs, svg("rect", { width: 400, height: 300, fill: "#1a1a1a" }), svg("rect", { x: 28, y: 36, width: 344, height: 244, rx: 22, fill: "#101010", stroke: "#3a3a3a", "stroke-width": 3 }),
      svg("line", { x1: 28, x2: 372, y1: 70, y2: 70, stroke: "#ff5050", "stroke-opacity": 0.5, "stroke-dasharray": "8 6", "stroke-width": 2 }),
      ...fruits.map(([x, y, r], index) => svg("circle", { cx: x, cy: y, r, fill: `url(#fm${index})` })));
  }

  const GAMES = [
    { slug: "fruit-merge", name: "Fruit Merge", tags: ["Puzzle", "Geschicklichkeit"], line: "Lass Früchte fallen: zwei gleiche verschmelzen zur nächsten.", art: fruitArt,
      how: ["Bewege die Maus oder den Finger, um zu zielen, und klicke oder lass los, um die Frucht fallen zu lassen.", "Treffen zwei gleiche Früchte aufeinander, werden sie zur nächstgrößeren. Je größer, desto mehr Punkte.", "Wird der Haufen höher als die gestrichelte Linie, ist das Spiel vorbei.", "Pro Runde hast du einmal Schütteln, einmal Löschen und eine Bombe."],
      keys: [["←  →", "zielen"], ["Leertaste", "fallen lassen"]] },
  ];
  const TOPICS = ["Alle", ...new Set(GAMES.flatMap((game) => game.tags))];

  const best = () => Y.readJson("yipi.games", {});
  const remember = (slug, value) => { const all = best(); if (value > (all[slug] || 0)) { all[slug] = value; Y.writeJson("yipi.games", all); } return all[slug] || 0; };

  // ------------------------------------------------------------------------------------------------ the tiles
  function tile(game, index = 99) {
    return link(`/games/${game.slug}`, { class: `game-tile${index === 0 ? " featured" : ""}`, "aria-label": `${game.name} spielen` },
      h("span", { class: "game-art" }, game.art()),
      h("span", { class: "game-info" }, h("b", {}, game.name), h("small", {}, game.tags.join(" · "))),
      h("span", { class: "game-play" }, icon("playCircle"), "Spielen"));
  }

  const soonTile = (label = "Kommt bald!") => h("div", { class: "game-tile soon", "aria-label": "Weiteres Spiel, kommt bald" },
    h("span", { class: "game-art" }, h("span", { class: "game-soon-ic" }, icon("gamepad"))), h("span", { class: "game-info" }, h("b", {}, label), h("small", {}, "Ein neues Spiel")));

  // --------------------------------------------------------------------------------------------------- the hub
  views.games = function games() {
    let topic = "Alle";
    let term = "";
    const grid = h("div", { class: "games-grid" });
    const chips = h("div", { class: "games-chips", role: "tablist", "aria-label": "Themen" });
    const search = h("input", { class: "search-input", type: "search", placeholder: "Spiele suchen", "aria-label": "Spiele suchen", autocomplete: "off", maxlength: 40 });
    const bar = Y.topbar({ title: "Games", className: "big", extra: h("div", { class: "games-tools" }, h("label", { class: "search-box" }, icon("search"), search), chips) });

    function draw() {
      const shown = GAMES.filter((game) => (topic === "Alle" || game.tags.includes(topic)) && (!term || game.name.toLowerCase().includes(term)));
      fill(chips, ...TOPICS.map((name) => h("button", { class: `chip${name === topic ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(name === topic), onclick: () => { topic = name; draw(); } }, name)));
      fill(grid, ...shown.map((game, index) => tile(game, index)), ...(topic === "Alle" && !term ? [soonTile(), soonTile(), soonTile(), soonTile()] : []));
      if (!shown.length) put(grid, h("p", { class: "muted games-none" }, "Dazu gibt es kein Spiel."));
    }
    search.addEventListener("input", () => { term = search.value.trim().toLowerCase(); draw(); });
    draw();
    return { element: h("div", { class: "view games-view" }, bar, grid), title: "Games", keep: true };
  };

  // ---------------------------------------------------------------------------------------------- loading
  const loading = new Map();
  function loadScript(src) {
    if (!src) return Promise.reject(new Error("no address"));
    if (!loading.has(src)) {
      loading.set(src, new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = src;
        tag.onload = () => resolve();
        tag.onerror = () => { loading.delete(src); reject(new Error("could not load")); };
        document.head.append(tag);
      }));
    }
    return loading.get(src);
  }

  // ------------------------------------------------------------------------------------------- a game's page
  views.game = function game(route, ctx) {
    const entry = GAMES.find((item) => item.slug === route.slug);
    if (!entry) return views.notfound();
    let player = null;
    let dead = false;
    let score = 0;

    const scoreEl = h("b", {}, "0");
    const bestEl = h("b", {}, String(best()[entry.slug] || 0));
    const canvas = h("canvas", { class: "game-canvas", "aria-label": `${entry.name}: Spielfeld` });
    const over = h("div", { class: "game-over", hidden: true });
    const status = h("div", { class: "game-status" }, h("span", { class: "spinner" }), h("span", {}, "Das Spiel wird geladen …"));
    const frame = h("div", { class: "game-frame" }, canvas, over, status);
    const power = (label, iconName, key) => {
      const count = h("span", { class: "power-count" }, "1");
      const button = h("button", { class: "power", type: "button", disabled: true, "aria-label": label, onclick: () => player && player[key]() }, icon(iconName), h("span", { class: "power-label" }, label), count);
      button.count = count;
      return button;
    };
    const shake = power("Schütteln", "refresh", "shake");
    const remove = power("Löschen", "trash", "toggleRemove");
    const bomb = power("Bombe", "stop", "toggleBomb");
    const powers = h("div", { class: "game-powers" }, shake, remove, bomb);

    const restart = h("button", { class: "btn ghost small", type: "button", onclick: () => { over.hidden = true; player?.restart(); } }, "Neustart");
    const full = h("button", { class: "btn ghost small", type: "button", onclick: () => { if (document.fullscreenElement) document.exitFullscreen(); else frame.requestFullscreen?.().catch(() => toast("Der Vollbildmodus geht hier nicht.")); } }, "Vollbild");
    const barEl = h("div", { class: "game-bar" },
      h("span", { class: "game-bar-art" }, entry.art()), h("div", { class: "game-bar-title" }, h("b", {}, entry.name), h("small", {}, entry.tags.join(" · "))),
      h("div", { class: "game-score" }, h("span", {}, "Punkte ", scoreEl), h("span", {}, "Bestwert ", bestEl)),
      h("div", { class: "game-buttons" }, restart, full));

    const side = h("aside", { class: "game-side" },
      h("section", { class: "card" }, h("h2", {}, "So spielt man"), h("ul", { class: "game-how" }, entry.how.map((line) => h("li", {}, line)))),
      h("section", { class: "card" }, h("h2", {}, "Tasten"), h("dl", { class: "facts" }, entry.keys.flatMap(([keys, text]) => [h("dt", {}, keys), h("dd", {}, text)]))));
    const more = h("section", { class: "game-more" }, h("h2", { class: "section-title" }, "Mehr Spiele"), h("div", { class: "games-grid" }, GAMES.filter((item) => item !== entry).map(tile), soonTile(), soonTile(), soonTile()));
    const el = h("div", { class: "view game-view" },
      Y.topbar({ back: "/games", title: entry.name }),
      h("div", { class: "game-layout" }, h("section", { class: "game-stage" }, frame, barEl, powers), side), more);

    function updatePowers(state) {
      for (const [button, key, active] of [[shake, "shake", false], [remove, "remove", state.removing], [bomb, "bomb", state.armed]]) {
        button.count.textContent = String(state[key]);
        button.disabled = state.over || state[key] < 1;
        button.classList.toggle("on", !!active);
        button.setAttribute("aria-pressed", String(!!active));
      }
    }

    function gameOver(final) {
      const top = remember(entry.slug, final);
      bestEl.textContent = String(top);
      fill(over, h("div", { class: "game-over-box" }, h("h2", {}, "Spiel vorbei"), h("p", {}, "Punkte: ", h("b", {}, String(final))), final >= top && final > 0 ? h("p", { class: "muted" }, "Neuer Bestwert!") : h("p", { class: "muted" }, `Bestwert: ${top}`),
        h("button", { class: "btn primary", type: "button", onclick: () => { over.hidden = true; player?.restart(); } }, "Nochmal spielen")));
      over.hidden = false;
    }

    (async () => {
      try {
        await loadScript(assets.matter);
        await loadScript(assets.fruit);
      } catch (error) {
        if (!dead) fill(status, h("span", {}, "Das Spiel konnte nicht geladen werden."), h("button", { class: "btn ghost small", type: "button", onclick: () => ctx.reload() }, "Noch einmal versuchen"));
        return;
      }
      if (dead) return;
      status.remove();
      player = window.FruitMerge.create(canvas, {
        onScore(value) { score = value; scoreEl.textContent = String(value); if (value > (best()[entry.slug] || 0)) bestEl.textContent = String(value); },
        onOver: gameOver,
        onPower: updatePowers,
      });
    })();

    ctx.setTitle(`${entry.name} spielen`);
    return { element: el, title: `${entry.name} spielen`, destroy() { dead = true; player?.destroy(); if (score > 0) remember(entry.slug, score); } };
  };
})();
