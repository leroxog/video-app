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

  // ------------------------------------------------------------------------------------------------- the pictures
  /* Every Samoji is a picture (static/img/samoji/<file>.png, the background is cut away); the Token is the golden coin with the planet. */
  const fileOf = (item) => `/static/img/samoji/${data.files[item[1]]}.png`;
  const coin = (extra = "") => h("img", { class: `coin-ic ${extra}`.trim(), src: "/static/img/samoji/coin.png", alt: "", width: 20, height: 20, draggable: false });
  function svg(item, size = 64) {
    return h("img", { class: "samoji-svg", src: fileOf(item), alt: nameOf(item), width: size, height: size, draggable: false, loading: "lazy" });
  }
  const isBig = (item) => item[1] === data.shapes.length - 1;                           // the hand with the bags: bigger, and the dearest
  /* A Samoji drops from the top of the screen down to the middle (and fades): for a present in a chat. In a video the tally at the edge takes its place (yipi-videos.js). */
  function burst(item) {
    const pic = h("img", { class: `samoji-fall${isBig(item) ? " big" : ""}`, src: fileOf(item), alt: "", draggable: false });
    document.body.append(pic);
    setTimeout(() => pic.remove(), 1700);
  }
  /* The little tally at the edge of a video: for each Samoji "N×" and the small picture; a new one drops in from the top. */
  function tally(box, by, dropId = 0) {
    if (!data) return;
    fill(box, ...(by || []).map(([id, times]) => { const item = entry(id); return item ? h("div", { class: `gift-chip${isBig(item) ? " big" : ""}${Number(id) === dropId ? " drop" : ""}`, title: nameOf(item) }, h("b", {}, `${times}×`), h("img", { src: fileOf(item), alt: nameOf(item), draggable: false })) : null; }).filter(Boolean));
  }
  /* The tally of a video that is shown: the Samojis it has got drop in one after the other. */
  async function replay(by, box) {
    await load();
    tally(box, by);
    [...box.children].forEach((chip, index) => { chip.classList.add("pre"); setTimeout(() => { chip.classList.remove("pre"); chip.classList.add("drop"); }, 150 + index * 220); });
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
    const close = () => { document.removeEventListener("keydown", onKey, true); back.classList.add("closing"); document.body.classList.remove("modal-open"); setTimeout(() => back.remove(), 180); };
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
    function drawBalance() { fill(balance, coin(), `${tokens} ${tokens === 1 ? "Token" : "Tokens"}`); }
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
      const holder = h("span", { class: "sm-live" }, h("img", { class: "sm-live-pic", src: fileOf(item), alt: "", draggable: false }));
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
      if (!post) burst(item);
      Y.sound?.play("success");
      toast(`${nameOf(item)} ist angekommen. ${tokens} ${tokens === 1 ? "Token" : "Tokens"} übrig.`);
      onSent?.(reply.data, item);
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

  Y.coin = coin;
  Y.samoji = { open, load, svg, burst, replay, tally, entry, fromText, bubble, balance: balanceNow, setTokens: (value) => { tokens = value; } };
})();
