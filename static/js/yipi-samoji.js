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

  // ------------------------------------------------------------------------------------------------- the 3D pictures
  /* The 3D part (three.js) is loaded when the first Samoji is shown; until then (or without WebGL) a plain coloured disc stands in. */
  const lib = () => {
    if (!lib.once) lib.once = import("/static/js/gift3d.mjs?v=27").then((module) => { module.setCatalogue(data); return module; });
    return lib.once;
  };
  /* A Samoji as a picture (3D, rendered once and kept); `item` is a row of the catalogue. */
  function svg(item, size = 64) {
    const img = h("img", { class: "samoji-svg", alt: nameOf(item), width: size, height: size, draggable: false });
    const look = data.palettes[item[2]];
    img.style.background = `radial-gradient(circle at 35% 30%, ${look[1]}, ${look[2]})`;
    img.style.borderRadius = "50%";
    lib().then((module) => module.thumb(item)).then((url) => { img.src = url; img.style.background = "none"; }).catch(() => { /* no WebGL: the disc stays */ });
    return img;
  }

  /* The Samoji comes out of the present like smoke: to the left, then up (3D, smooth). `from` is the place of the button; the screen at the right edge when it is not given. */
  async function burst(item, from) {
    try {
      const module = await lib();
      const start = from || { x: window.innerWidth * 0.9, y: window.innerHeight * 0.58 };
      await module.fly(item, start);
    } catch (error) { /* no WebGL: nothing flies */ }
  }
  /* The presents a video has got (the last ones): they come out one after the other. */
  async function replay(ids, from) {
    await load();
    ids.slice(0, 3).forEach((id, index) => { const item = entry(id); if (item) setTimeout(() => burst(item, from), index * 900); });
  }

  // ------------------------------------------------------------------------------------------------- the sheet
  const TIERS = [["Alle", 0, 1e9], ["1 bis 3", 1, 3], ["4 bis 10", 4, 10], ["11 bis 40", 11, 40], ["ab 41", 41, 1e9]];

  async function open({ to: first, post, chat, group, members, onSent, giftFrom } = {}) {
    if (!Y.requireLogin("Melde dich an, um Samojis zu verschenken.")) return null;
    if (document.querySelector(".samoji-back")) return null;
    const ready = await load();
    if (!ready) { toast("Die Samojis konnten nicht geladen werden."); return null; }
    let tier = 0;
    let term = "";
    let shown = 60;
    let chosen = null;
    let to = first || (members && members[0] ? members[0].handle : "");           // in a group: the member who gets it (chips below the search)
    const back = h("div", { class: "skz-sheet-back samoji-back" });
    let stopLive = null;
    const close = () => { stopLive?.(); document.removeEventListener("keydown", onKey, true); back.classList.add("closing"); document.body.classList.remove("modal-open"); setTimeout(() => back.remove(), 180); };
    const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    const balance = h("span", { class: "sm-balance" });
    const grid = h("div", { class: "sm-grid", role: "list" });
    const more = h("button", { class: "sm-more", type: "button" }, "Mehr zeigen");
    const search = h("input", { class: "sm-search", type: "search", placeholder: "Samoji suchen", "aria-label": "Samoji suchen", autocomplete: "off", maxlength: 30 });
    const chips = h("div", { class: "sm-tiers" });
    const confirm = h("div", { class: "sm-confirm", hidden: true });
    const who = h("div", { class: "sm-tiers sm-who", hidden: !(members && members.length) });
    function drawWho() { fill(who, h("small", { class: "sm-for" }, "Für"), ...(members || []).map((member) => h("button", { class: `sm-chip${member.handle === to ? " on" : ""}`, type: "button", "aria-pressed": String(member.handle === to), onclick: () => { to = member.handle; drawWho(); } }, member.name))); }

    const matches = () => ready.items.filter((item) => item[4] >= TIERS[tier][1] && item[4] <= TIERS[tier][2] && (!term || nameOf(item).toLowerCase().includes(term))).sort((a, b) => a[4] - b[4] || a[0] - b[0]);
    function drawBalance() { balance.textContent = `${tokens} ${tokens === 1 ? "Token" : "Tokens"}`; }
    function drawChips() { fill(chips, ...TIERS.map(([label], index) => h("button", { class: `sm-chip${index === tier ? " on" : ""}`, type: "button", "aria-pressed": String(index === tier), onclick: () => { tier = index; shown = 60; drawChips(); drawGrid(); } }, label))); }
    function drawGrid() {
      const list = matches();
      fill(grid, ...list.slice(0, shown).map((item) => h("button", { class: `sm-tile${chosen && chosen[0] === item[0] ? " on" : ""}`, type: "button", role: "listitem", "aria-label": `${nameOf(item)}, ${priceText(item[4])}`, onclick: () => choose(item) }, svg(item, 56), h("small", {}, priceText(item[4])))));
      if (!list.length) grid.append(h("p", { class: "sm-none" }, "Nichts gefunden."));
      more.hidden = list.length <= shown;
    }
    /* The bill at the top of the sheet (above the Samojis, where it cannot be overlooked): which Samoji, what it costs, what you have, what is left, and the button to send. */
    function choose(item) {
      chosen = item;
      confirm.hidden = false;
      const left = tokens - item[4];
      const enough = left >= 0;
      const send = h("button", { class: "sm-send", type: "button", disabled: !enough }, enough ? `Senden für ${priceText(item[4])}` : "Zu wenig Tokens");
      send.addEventListener("click", () => give(item, send));
      stopLive?.();
      stopLive = null;
      const holder = h("span", { class: "sm-live" });
      lib().then((module) => { if (chosen !== item) return; const preview = module.live(item, 104); holder.append(preview.canvas); stopLive = preview.stop; });
      const line = (label, value, extra = "") => h("div", { class: `sm-line ${extra}`.trim() }, h("span", {}, label), h("b", {}, value));
      fill(confirm, h("div", { class: "sm-bill-top" }, holder, h("div", { class: "sm-bill-name" }, h("small", {}, "Dein Geschenk"), h("b", {}, nameOf(item)))),
        h("div", { class: "sm-lines" }, line("Preis", `− ${priceText(item[4])}`), line("Du hast", priceText(tokens)), h("hr", {}), line("Danach", priceText(Math.max(0, left)), enough ? "total" : "total bad")),
        h("small", { class: "sm-note" }, enough ? "Wer es bekommt, bekommt genauso viele Tokens." : `Dir fehlen ${-left} Tokens.`), send);
      panel.scrollTo({ top: 0, behavior: "smooth" });
      drawGrid();
    }
    async function give(item, button) {
      button.disabled = true;
      const reply = await Api.post("/samojis/send", { id: item[0], to, ...(post ? { post } : {}), ...(chat ? { chat } : {}), ...(group ? { group } : {}) });
      if (!reply.ok) { toast(Api.message(reply)); button.disabled = false; return; }
      tokens = reply.data.tokens;
      Y.me.tokens = tokens;
      close();
      burst(item, giftFrom);
      Y.sound?.play("success");
      toast(`${nameOf(item)} ist angekommen. ${tokens} ${tokens === 1 ? "Token" : "Tokens"} übrig.`);
      onSent?.(reply.data);
    }
    search.addEventListener("input", () => { term = search.value.trim().toLowerCase(); shown = 60; drawGrid(); });
    more.addEventListener("click", () => { shown += 60; drawGrid(); });
    const panel = h("div", { class: "skz-sheet samoji-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Samojis" },
      h("span", { class: "skz-grip", "aria-hidden": "true" }),
      h("div", { class: "sm-head" }, h("h2", {}, "Samojis"), balance, h("button", { class: "icon-btn round", type: "button", "aria-label": "Schließen", onclick: close }, icon("close"))),
      confirm, search, who, chips, grid, more);
    back.addEventListener("click", (event) => { if (event.target === back) close(); });
    back.append(panel);
    document.body.append(back);
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onKey, true);
    drawBalance();
    drawWho();
    drawChips();
    drawGrid();
    return close;
  }

  // ------------------------------------------------------------------------------------------------- in chats
  const fromText = (text) => { const match = typeof text === "string" && text.startsWith(MARKER) ? /^⁣samoji:(\d+)⁣( @\w+)?$/.exec(text) : null; return match ? Number(match[1]) : 0; };
  const toOf = (text) => { const match = typeof text === "string" ? /⁣ @(\w+)$/.exec(text) : null; return match ? match[1] : ""; };       // (a present in a group names the member who got it)
  /* A bubble for a Samoji in a chat: it is drawn when the list of Samojis is there. */
  function bubble(id, text = "") {
    const box = h("div", { class: "bubble-samoji" });
    const receiver = toOf(text);
    load().then(() => { const item = entry(id); if (item) fill(box, svg(item, 120), h("small", {}, `${nameOf(item)} · ${priceText(item[4])}${receiver ? ` · für @${receiver}` : ""}`)); });
    return box;
  }
  /* The Tokens of the person (asked once, then remembered). */
  async function balanceNow() { await load(); return tokens; }

  Y.samoji = { open, load, svg, burst, replay, fromText, bubble, balance: balanceNow, setTokens: (value) => { tokens = value; } };
})();
