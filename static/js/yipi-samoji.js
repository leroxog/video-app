/* Satürn Samojis (yipi-samoji.js): the stickers that are given as presents, for Tokens. The page draws all 1200 of them itself from numbers (a shape, a pair of colours, a badge) that come from
   the server with their prices (yipi_samojis.py); nothing is a picture file. `Y.samoji.open({to, post, chat})` is the sheet to choose one (search, price steps, the balance of Tokens, "Senden für N
   Tokens"); whoever gets a Samoji gets as many Tokens as the giver paid. A Samoji in a chat is a message with an invisible sign in front (`fromText`), drawn as a big sticker. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { h, icon, toast, fill } = Y;

  const NS = "http://www.w3.org/2000/svg";
  const MARKER = "⁣samoji:";
  let data = null;                                               // {shapes, palettes, badges, items, tokens}
  let loading = null;
  let tokens = null;

  const svgEl = (tag, attrs = {}, ...children) => {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
    for (const child of children) if (child) el.append(child);
    return el;
  };

  async function load() {
    if (data) return data;
    if (!loading) loading = Api.get("/samojis").then((reply) => { loading = null; if (reply.ok) { data = reply.data; tokens = reply.data.tokens; } return data; });
    return loading;
  }
  const entry = (id) => (data ? data.items.find((item) => item[0] === Number(id)) || null : null);
  const nameOf = (item) => `${data.shapes[item[1]]} ${data.palettes[item[2]][0]}${data.badges[item[3]] ? ` ${data.badges[item[3]]}` : ""}`;
  const priceText = (price) => `${price} ${price === 1 ? "Token" : "Tokens"}`;

  // ------------------------------------------------------------------------------------------------- the drawings
  /* The body of each of the 24 shapes in a 100 x 100 box. m = the main colour, l = the colour of the line. */
  function body(shape, m, l) {
    const line = { stroke: l, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" };
    const path = (d, fillColor = m, extra = {}) => svgEl("path", { d, fill: fillColor, ...line, ...extra });
    const circle = (cx, cy, r, fillColor = m) => svgEl("circle", { cx, cy, r, fill: fillColor, ...line });
    const poly = (points, fillColor = m) => svgEl("polygon", { points, fill: fillColor, ...line });
    switch (shape) {
      case 0: return [path("M50 88C10 60 6 32 28 23C40 19 48 27 50 33C52 27 60 19 72 23C94 32 90 60 50 88Z")];
      case 1: return [poly("50,8 61,38 93,38 67,57 77,88 50,69 23,88 33,57 7,38 39,38")];
      case 2: return [circle(50, 50, 27), svgEl("ellipse", { cx: 50, cy: 52, rx: 46, ry: 12, transform: "rotate(-20 50 52)", fill: "none", stroke: l, "stroke-width": 5 })];
      case 3: return [path("M14 80L8 28L32 52L50 20L68 52L92 28L86 80Z"), svgEl("rect", { x: 14, y: 76, width: 72, height: 10, rx: 4, fill: l })];
      case 4: return [path("M50 8C58 28 78 36 78 58C78 76 66 90 50 90C34 90 22 76 22 58C22 44 32 36 38 24C42 32 46 34 50 8Z")];
      case 5: return [poly("58,6 22,54 46,54 38,94 78,40 54,40")];
      case 6: return [path("M66 10A42 42 0 1 0 90 66A34 34 0 0 1 66 10Z")];
      case 7: return [...Array.from({ length: 8 }, (_, i) => svgEl("line", { x1: 50 + 32 * Math.cos((i * Math.PI) / 4), y1: 50 + 32 * Math.sin((i * Math.PI) / 4), x2: 50 + 44 * Math.cos((i * Math.PI) / 4), y2: 50 + 44 * Math.sin((i * Math.PI) / 4), stroke: m, "stroke-width": 7, "stroke-linecap": "round" })), circle(50, 50, 25)];
      case 8: return [poly("50,90 10,40 28,14 72,14 90,40"), svgEl("path", { d: "M10 40H90M28 14L40 40L50 90L60 40L72 14", fill: "none", stroke: l, "stroke-width": 2 })];
      case 9: return [poly("30,70 14,92 38,82", l), poly("70,70 86,92 62,82", l), path("M50 6C68 22 70 46 62 74L38 74C30 46 32 22 50 6Z"), circle(50, 38, 7, "#ffffff")];
      case 10: return [poly("20,40 22,10 42,26"), poly("80,40 78,10 58,26"), circle(50, 56, 34)];
      case 11: return [path("M20 90V44C20 20 34 10 50 10C66 10 80 20 80 44V90L68 80L59 90L50 80L41 90L32 80Z")];
      case 12: return [path("M26 76C8 76 6 52 26 50C26 30 52 26 60 42C74 36 94 50 82 66C80 78 70 76 26 76Z")];
      case 13: return [...Array.from({ length: 5 }, (_, i) => circle(50 + 26 * Math.cos((i * 2 * Math.PI) / 5 - Math.PI / 2), 50 + 26 * Math.sin((i * 2 * Math.PI) / 5 - Math.PI / 2), 18)), circle(50, 50, 16, "#fff3b0")];
      case 14: return [circle(36, 36, 20), circle(64, 36, 20), circle(36, 64, 20), circle(64, 64, 20), svgEl("path", { d: "M50 50L50 94", stroke: l, "stroke-width": 4, "stroke-linecap": "round" })];
      case 15: return [svgEl("path", { d: "M50 10a40 40 0 1 0 0.01 0ZM50 38a12 12 0 1 1 -0.01 0Z", "fill-rule": "evenodd", fill: m, ...line })];
      case 16: return [path("M50 92L12 24Q50 8 88 24Z"), circle(42, 42, 6, "#ff6b6b"), circle(60, 52, 6, "#ff6b6b"), circle(48, 66, 5, "#ff6b6b")];
      case 17: return [poly("30,54 50,94 70,54", "#e0a85a"), circle(38, 44, 18), circle(62, 44, 18), circle(50, 30, 18)];
      case 18: return [path("M26 12H74V40C74 58 62 68 50 68C38 68 26 58 26 40Z"), path("M26 20H10C10 38 18 44 28 44M74 20H90C90 38 82 44 72 44", "none"), svgEl("rect", { x: 42, y: 68, width: 16, height: 14, fill: l }), svgEl("rect", { x: 28, y: 82, width: 44, height: 10, rx: 3, fill: l })];
      case 19: return [path("M36 76V22L72 14V66"), circle(28, 78, 12), circle(64, 68, 12)];
      case 20: return [poly("50,10 88,30 50,50 12,30"), poly("12,30 50,50 50,92 12,70", l), poly("88,30 50,50 50,92 88,70", m)];
      case 21: return [path("M6 50C26 16 74 16 94 50C74 84 26 84 6 50Z", "#ffffff"), circle(50, 50, 20)];
      case 22: return [path("M8 50C26 22 60 22 78 50C60 78 26 78 8 50Z"), poly("76,50 94,30 94,70")];
      default: return [poly("50,6 88,28 88,72 50,94 12,72 12,28"), svgEl("path", { d: "M50 6V94M12 28L88 72M88 28L12 72", fill: "none", stroke: l, "stroke-width": 1.5, opacity: 0.5 })];
    }
  }

  /* One badge on top of the shape. */
  function badge(kind) {
    const gold = "#ffd60a";
    const sparkle = (x, y, s) => svgEl("polygon", { points: `${x},${y - s} ${x + s / 3},${y - s / 3} ${x + s},${y} ${x + s / 3},${y + s / 3} ${x},${y + s} ${x - s / 3},${y + s / 3} ${x - s},${y} ${x - s / 3},${y - s / 3}`, fill: "#ffffff", stroke: gold, "stroke-width": 1.5 });
    if (kind === 1) return [sparkle(14, 16, 10), sparkle(88, 22, 8), sparkle(84, 84, 9)];
    if (kind === 2) return [svgEl("circle", { cx: 50, cy: 50, r: 47, fill: "none", stroke: gold, "stroke-width": 3, "stroke-dasharray": "6 4" })];
    if (kind === 3) return [svgEl("path", { d: "M10 30C0 38 2 52 14 56C10 46 12 38 18 34Z", fill: "#fff", stroke: "#b0b0b0", "stroke-width": 1.5 }), svgEl("path", { d: "M90 30C100 38 98 52 86 56C90 46 88 38 82 34Z", fill: "#fff", stroke: "#b0b0b0", "stroke-width": 1.5 })];
    if (kind === 4) return [svgEl("path", { d: "M34 14L32 2L42 9L50 0L58 9L68 2L66 14Z", fill: gold, stroke: "#b38600", "stroke-width": 1.5, "stroke-linejoin": "round" })];
    return [];
  }

  /* A Samoji as a small picture (an <svg> element); `item` is a row of the catalogue. */
  function svg(item, size = 64) {
    const [, shape, palette, bdg] = item;
    const [, main, lineColor] = data.palettes[palette];
    const face = shape === 21 ? [] : [svgEl("circle", { cx: 41, cy: 50, r: 3.6, fill: "#222" }), svgEl("circle", { cx: 59, cy: 50, r: 3.6, fill: "#222" }), svgEl("path", { d: "M41 60Q50 69 59 60", fill: "none", stroke: "#222", "stroke-width": 3, "stroke-linecap": "round" })];
    const root = svgEl("svg", { viewBox: "0 0 100 100", width: size, height: size, role: "img", "aria-label": nameOf(item) }, ...body(shape, main, lineColor), ...face, ...badge(bdg));
    root.classList.add("samoji-svg");
    return root;
  }

  // ------------------------------------------------------------------------------------------------- a flying present
  function burst(item) {
    const flyer = h("span", { class: "samoji-fly", "aria-hidden": "true" }, svg(item, 150));
    document.body.append(flyer);
    requestAnimationFrame(() => { flyer.classList.add("go"); });
    setTimeout(() => flyer.remove(), 1700);
  }

  // ------------------------------------------------------------------------------------------------- the sheet
  const TIERS = [["Alle", 0, 1e9], ["1 bis 3", 1, 3], ["4 bis 10", 4, 10], ["11 bis 40", 11, 40], ["ab 41", 41, 1e9]];

  async function open({ to, post, chat, onSent } = {}) {
    if (!Y.requireLogin("Melde dich an, um Samojis zu verschenken.")) return null;
    if (document.querySelector(".samoji-back")) return null;
    const ready = await load();
    if (!ready) { toast("Die Samojis konnten nicht geladen werden."); return null; }
    let tier = 0;
    let term = "";
    let shown = 60;
    let chosen = null;
    const back = h("div", { class: "skz-sheet-back samoji-back" });
    const close = () => { document.removeEventListener("keydown", onKey, true); back.classList.add("closing"); document.body.classList.remove("modal-open"); setTimeout(() => back.remove(), 180); };
    const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    const balance = h("span", { class: "sm-balance" });
    const grid = h("div", { class: "sm-grid", role: "list" });
    const more = h("button", { class: "sm-more", type: "button" }, "Mehr zeigen");
    const search = h("input", { class: "sm-search", type: "search", placeholder: "Samoji suchen", "aria-label": "Samoji suchen", autocomplete: "off", maxlength: 30 });
    const chips = h("div", { class: "sm-tiers" });
    const confirm = h("div", { class: "sm-confirm", hidden: true });

    const matches = () => ready.items.filter((item) => item[4] >= TIERS[tier][1] && item[4] <= TIERS[tier][2] && (!term || nameOf(item).toLowerCase().includes(term))).sort((a, b) => a[4] - b[4] || a[0] - b[0]);
    function drawBalance() { balance.textContent = `${tokens} ${tokens === 1 ? "Token" : "Tokens"}`; }
    function drawChips() { fill(chips, ...TIERS.map(([label], index) => h("button", { class: `sm-chip${index === tier ? " on" : ""}`, type: "button", "aria-pressed": String(index === tier), onclick: () => { tier = index; shown = 60; drawChips(); drawGrid(); } }, label))); }
    function drawGrid() {
      const list = matches();
      fill(grid, ...list.slice(0, shown).map((item) => h("button", { class: `sm-tile${chosen && chosen[0] === item[0] ? " on" : ""}`, type: "button", role: "listitem", "aria-label": `${nameOf(item)}, ${priceText(item[4])}`, onclick: () => choose(item) }, svg(item, 56), h("small", {}, priceText(item[4])))));
      if (!list.length) grid.append(h("p", { class: "sm-none" }, "Nichts gefunden."));
      more.hidden = list.length <= shown;
    }
    function choose(item) {
      chosen = item;
      confirm.hidden = false;
      const enough = tokens >= item[4];
      const send = h("button", { class: "sm-send", type: "button", disabled: !enough }, `Senden für ${priceText(item[4])}`);
      send.addEventListener("click", () => give(item, send));
      fill(confirm, svg(item, 84), h("div", { class: "sm-confirm-text" }, h("b", {}, nameOf(item)), h("small", {}, enough ? "Der Empfänger bekommt genauso viele Tokens." : `Dir fehlen ${item[4] - tokens} Tokens.`)), send);
      drawGrid();
    }
    async function give(item, button) {
      button.disabled = true;
      const reply = await Api.post("/samojis/send", { id: item[0], to, ...(post ? { post } : {}), ...(chat ? { chat } : {}) });
      if (!reply.ok) { toast(Api.message(reply)); button.disabled = false; return; }
      tokens = reply.data.tokens;
      Y.me.tokens = tokens;
      close();
      burst(item);
      Y.sound?.play("success");
      toast(`${nameOf(item)} ist angekommen. ${tokens} ${tokens === 1 ? "Token" : "Tokens"} übrig.`);
      onSent?.(reply.data);
    }
    search.addEventListener("input", () => { term = search.value.trim().toLowerCase(); shown = 60; drawGrid(); });
    more.addEventListener("click", () => { shown += 60; drawGrid(); });
    const panel = h("div", { class: "skz-sheet samoji-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Samojis" },
      h("span", { class: "skz-grip", "aria-hidden": "true" }),
      h("div", { class: "sm-head" }, h("h2", {}, "Samojis"), balance, h("button", { class: "icon-btn round", type: "button", "aria-label": "Schließen", onclick: close }, icon("close"))),
      search, chips, grid, more, confirm);
    back.addEventListener("click", (event) => { if (event.target === back) close(); });
    back.append(panel);
    document.body.append(back);
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onKey, true);
    drawBalance();
    drawChips();
    drawGrid();
    return close;
  }

  // ------------------------------------------------------------------------------------------------- in chats
  const fromText = (text) => { const match = typeof text === "string" && text.startsWith(MARKER) ? /^⁣samoji:(\d+)⁣$/.exec(text) : null; return match ? Number(match[1]) : 0; };
  /* A bubble for a Samoji in a chat: it is drawn when the list of Samojis is there. */
  function bubble(id) {
    const box = h("div", { class: "bubble-samoji" });
    load().then(() => { const item = entry(id); if (item) fill(box, svg(item, 120), h("small", {}, `${nameOf(item)} · ${priceText(item[4])}`)); });
    return box;
  }
  /* The Tokens of the person (asked once, then remembered). */
  async function balanceNow() { await load(); return tokens; }

  Y.samoji = { open, load, svg, burst, fromText, bubble, balance: balanceNow, setTokens: (value) => { tokens = value; } };
})();
