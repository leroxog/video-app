/* Pulse GIFs: the picker (a sheet from the bottom on a phone, a window on a computer) with the library of everybody's GIFs -- popular,
   new, your favourites, your own, and a search --, a star to favourite a GIF, and a "+" to make your own: from photos, from a text
   or from a GIF file. A GIF you make goes into the library, where everybody who is signed in can favourite it and send it.
   Everything a GIF is made of is drawn here on a canvas and written to a file by yipi-gif-core.js, in the browser. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const GifCore = window.YipiGifCore;
  const { fill, put, h, icon, toast, dialog, confirmBox, menu, wait } = Y;

  const TABS = [["trending", "Beliebt"], ["new", "Neu"], ["favorites", "Favoriten"], ["mine", "Meine"]];
  const QUICK = ["Hallo", "Lol", "Wow", "Danke", "Herz", "Party", "Cool", "Ja", "Nein", "Gute Nacht"];

  // ------------------------------------------------------------------------------------------------- grid
  /* The library as a grid of tiles: columns that fill from the shortest one, a star on every tile, more when you scroll. */
  function gifGrid({ tab, query, onPick, onMake }) {
    const scroller = h("div", { class: "gif-scroll" });
    const grid = h("div", { class: "gif-grid" });
    const foot = h("div", { class: "list-foot" });
    put(scroller, grid, foot);
    const state = { items: [], next: null, busy: false, dead: false, token: 0, observer: null };
    const tiles = new Map();

    function columnCount() {
      const width = scroller.clientWidth || window.innerWidth;
      return width >= 640 ? 4 : width >= 420 ? 3 : 2;
    }

    function lay() {
      const columns = Core.gifColumns(state.items, columnCount());
      fill(grid, ...columns.map((items) => h("div", { class: "gif-col" }, items.map((item) => tiles.get(item.id)))));
    }

    function drawStar(tile, item) {
      const star = tile.querySelector(".gif-fav");
      star.classList.toggle("on", !!item.favorite);
      star.setAttribute("aria-pressed", String(!!item.favorite));
      star.setAttribute("aria-label", item.favorite ? "Aus den Favoriten entfernen" : "Zu den Favoriten hinzufügen");
      fill(star, icon(item.favorite ? "starFill" : "star"));
    }

    async function toggleFavorite(item, tile) {
      const wanted = !item.favorite;
      item.favorite = wanted;
      item.favorites = Math.max(0, (item.favorites || 0) + (wanted ? 1 : -1));
      drawStar(tile, item);
      const reply = wanted ? await Api.post(`/gifs/${item.id}/favorite`) : await Api.del(`/gifs/${item.id}/favorite`);
      if (!reply.ok) {
        item.favorite = !wanted;
        drawStar(tile, item);
        toast(Api.message(reply));
        if (reply.status === 404) remove(item);
        return;
      }
      if (tab === "favorites" && !wanted) { remove(item); }
      else toast(wanted ? "Zu deinen Favoriten hinzugefügt" : "Aus den Favoriten entfernt");
    }

    function remove(item) {
      state.items = state.items.filter((entry) => entry.id !== item.id);
      tiles.delete(item.id);
      lay();
      if (!state.items.length && !state.next) showEmpty();
    }

    function moreMenu(item, anchor) {
      menu(anchor, [
        item.mine || (Y.me && Y.me.isAdmin && !item.starter) ? { label: "GIF löschen", icon: "trash", danger: true, run: async () => {
          if (!(await confirmBox({ title: "GIF löschen?", text: "Es verschwindet aus der Bibliothek. Beiträge, in denen es schon steht, bleiben unverändert.", yes: "Löschen", danger: true }))) return;
          const reply = await Api.del(`/gifs/${item.id}`);
          if (!reply.ok) { toast(Api.message(reply)); return; }
          remove(item);
          toast("Das GIF wurde gelöscht.");
        } } : null,
        !item.mine && !item.starter ? { label: "GIF melden", icon: "flag", danger: true, run: () => Y.reportDialog({ gifId: item.id }) } : null,
      ]);
    }

    function makeTile(item) {
      const ratio = Math.max(0.4, Math.min(2.5, item.width / item.height));
      const tile = h("div", { class: "gif-tile" },
        h("button", { class: "gif-pick", type: "button", "aria-label": `GIF verwenden${item.title ? `: ${item.title}` : ""}`, onclick: () => onPick(item) },
          h("img", { src: item.url, alt: item.title || "GIF", loading: "lazy", decoding: "async", width: item.width, height: item.height, style: `aspect-ratio: ${ratio.toFixed(3)}` })),
        h("button", { class: "gif-fav", type: "button", onclick: (event) => { event.stopPropagation(); toggleFavorite(item, tile); } }),
        item.mine || !item.starter ? h("button", { class: "gif-more", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu", onclick: (event) => { event.stopPropagation(); moreMenu(item, event.currentTarget); } }, icon("more")) : null);
      drawStar(tile, item);
      return tile;
    }

    function showEmpty() {
      const nothing = {
        favorites: ["Noch keine Favoriten", "Tippe bei einem GIF auf den Stern, dann findest du es hier wieder."],
        mine: ["Du hast noch kein GIF gemacht", "Aus Fotos, aus einem Text oder aus einer GIF-Datei."],
      }[tab] || (query ? [`Kein GIF für „${query}“`, "Probier ein anderes Wort – oder mach selbst eins."] : ["Hier ist noch nichts", "Mach das erste GIF."]);
      fill(foot, Y.emptyState(nothing[0], nothing[1], h("button", { class: "btn primary", type: "button", onclick: onMake }, "Eigenes GIF machen")));
    }

    function watch() {
      state.observer?.disconnect();
      if (!("IntersectionObserver" in window)) { foot.append(h("button", { class: "btn ghost", type: "button", onclick: () => more() }, "Mehr laden")); return; }
      const marker = h("div", { class: "sentinel" });
      foot.append(marker);
      state.observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) more(); }, { root: scroller, rootMargin: "400px 0px" });
      state.observer.observe(marker);
    }

    async function more() {
      if (state.busy || state.dead) return;
      state.busy = true;
      const mine = state.token;
      foot.replaceChildren(h("div", { class: "gif-loading", "aria-hidden": "true" }, h("span", { class: "spinner" })));
      const path = Y.qs("/gifs", { tab, q: query, offset: state.next || 0 });
      const reply = await Api.get(path);
      state.busy = false;
      if (state.dead || mine !== state.token) return;
      foot.replaceChildren();
      if (!reply.ok) {
        foot.append(h("div", { class: "list-error" }, h("p", {}, reply.offline ? Api.MESSAGES.network : Api.message(reply)), h("button", { class: "btn ghost", type: "button", onclick: () => more() }, "Noch einmal versuchen")));
        return;
      }
      for (const item of reply.data.items) {
        if (tiles.has(item.id)) continue;
        tiles.set(item.id, makeTile(item));
        state.items.push(item);
      }
      state.next = reply.data.next;
      lay();
      if (!state.items.length) showEmpty();
      else if (state.next) watch();
    }

    more();
    return {
      element: scroller,
      relayout: lay,
      destroy() { state.dead = true; state.observer?.disconnect(); },
    };
  }

  // ------------------------------------------------------------------------------------------------- star
  /* A star on a GIF that stands in a post or a message: marks it as a favourite of the library (so it turns up under "Favoriten" in the
     picker) or takes the mark away. `entry` is {id, favorite}: the id of the GIF of the library; `favorite` is kept up to date. */
  Y.gifStar = function gifStar(entry) {
    const button = h("button", { class: "gif-fav", type: "button" });
    const draw = () => {
      button.classList.toggle("on", !!entry.favorite);
      button.setAttribute("aria-pressed", String(!!entry.favorite));
      button.setAttribute("aria-label", entry.favorite ? "GIF aus den Favoriten entfernen" : "GIF zu den Favoriten hinzufügen");
      fill(button, icon(entry.favorite ? "starFill" : "star"));
    };
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (!Y.requireLogin("Melde dich an, um GIFs zu merken.")) return;
      const wanted = !entry.favorite;
      entry.favorite = wanted;
      draw();
      const reply = wanted ? await Api.post(`/gifs/${entry.id}/favorite`) : await Api.del(`/gifs/${entry.id}/favorite`);
      if (!reply.ok) { entry.favorite = !wanted; draw(); toast(Api.message(reply)); return; }
      toast(wanted ? "GIF zu deinen Favoriten hinzugefügt" : "GIF aus den Favoriten entfernt");
    });
    draw();
    return button;
  };

  // ----------------------------------------------------------------------------------------------- picker
  /* The picker. `onPick(gif)` is called with the library entry the person chose (and the picker closes); `onChoose` of a made GIF
     is the same. Returns the dialog. */
  Y.gifPicker = function gifPicker({ onPick }) {
    if (!Y.requireLogin("Melde dich an, um GIFs zu verwenden.")) return null;
    let entry = null;
    let tab = "trending";
    let query = "";
    let grid = null;
    let timer = null;

    const search = h("input", { class: "gif-search-input", type: "search", placeholder: "GIFs suchen", "aria-label": "GIFs suchen", maxlength: 40, autocomplete: "off", enterkeyhint: "search" });
    const chips = h("div", { class: "gif-chips", role: "list" }, QUICK.map((word) => h("button", { class: "gif-chip", type: "button", role: "listitem", onclick: () => { search.value = word; setQuery(word); } }, word)));
    const tabBox = h("div", { class: "gif-tabs" });
    const body = h("div", { class: "gif-body" });
    const plus = h("button", { class: "gif-plus", type: "button", "aria-label": "Eigenes GIF machen", onclick: () => make() }, icon("plus"), h("span", { class: "gif-plus-label" }, "Eigenes GIF"));
    const closeButton = h("button", { class: "icon-btn", type: "button", "aria-label": "Schließen", onclick: () => entry.close() }, icon("close"));
    const head = h("div", { class: "gif-head" }, closeButton, h("label", { class: "gif-search" }, icon("search"), search));
    const sheet = h("div", { class: "gif-sheet" }, head, chips, tabBox, body, plus);

    function pick(item) {
      entry.close();
      onPick(item);
    }

    function drawTabs() {
      fill(tabBox, Y.tabs(TABS, tab, (id) => { tab = id; drawTabs(); mount(); }, "Bibliothek"));
      chips.hidden = !!query || tab !== "trending";
    }

    function mount() {
      grid?.destroy();
      grid = gifGrid({ tab, query, onPick: pick, onMake: () => make() });
      fill(body, grid.element);
      chips.hidden = !!query || tab !== "trending";
    }

    function setQuery(value) {
      query = Core.gifQuery(value);
      clearTimeout(timer);
      mount();
    }

    function make() {
      grid?.destroy();
      grid = null;
      sheet.classList.add("making");
      fill(body, makeView({
        onBack: () => { sheet.classList.remove("making"); tab = "mine"; drawTabs(); mount(); },
        onDone: (gif) => { entry.close(); onPick(gif); },
      }));
    }

    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => setQuery(search.value), 320); });
    search.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); setQuery(search.value); } });
    window.addEventListener("resize", onResize);
    function onResize() { grid?.relayout(); }

    drawTabs();
    mount();
    entry = dialog({ bare: true, label: "GIF auswählen", body: sheet, initialFocus: matchMedia("(pointer: fine)").matches ? search : closeButton, onClose: () => { grid?.destroy(); clearTimeout(timer); window.removeEventListener("resize", onResize); } });
    entry.box.classList.add("gif-dialog");
    return entry;
  };

  // ------------------------------------------------------------------------------------------------ making
  const SWATCHES = [["#7c3aed", "#ffffff"], ["#2563eb", "#ffffff"], ["#0891b2", "#ffffff"], ["#16a34a", "#ffffff"], ["#facc15", "#14161f"], ["#f97316", "#ffffff"], ["#e11d48", "#ffffff"], ["#14161f", "#ffffff"]];
  const TEXT_STYLES = [["pulse", "Pulsieren"], ["shake", "Wackeln"], ["rainbow", "Regenbogen"], ["blink", "Blinken"], ["wave", "Wellen"]];
  const SPEEDS = [["slow", "Langsam", 900], ["medium", "Mittel", 550], ["fast", "Schnell", 280]];
  const SHAPES = [["wide", "Quer", 4 / 3], ["square", "Quadrat", 1], ["tall", "Hoch", 3 / 4]];
  const TEXT_FRAMES = 16;
  const TEXT_WIDTH = 320;

  const wave = (t, cycles = 1, phase = 0) => Math.sin((t * cycles + phase) * Math.PI * 2);

  function segmented(label, options, value, onChange) {
    const box = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
    const draw = () => fill(box, options.map(([id, text]) => h("button", { class: `seg-btn${id === value ? " on" : ""}`, type: "button", role: "radio", "aria-checked": String(id === value), onclick: () => { value = id; draw(); onChange(id); } }, text)));
    draw();
    return box;
  }

  /* Text on a flat colour, in a style: draws the picture at moment t (0 to 1, a loop) on a context of the size width x height. */
  function drawText(context, width, height, text, swatch, style, t) {
    const [background, ink] = swatch;
    let fillStyle = ink;
    let backgroundNow = background;
    if (style === "blink") backgroundNow = t < 0.5 ? background : ink === "#ffffff" ? "#ffffff" : "#14161f";
    if (style === "blink") fillStyle = t < 0.5 ? ink : background;
    context.fillStyle = backgroundNow;
    context.fillRect(0, 0, width, height);
    const words = text.split(/\s+/).filter(Boolean);
    let lines = [words.join(" ")];
    const maxWidth = width * 0.86;
    let size = Math.min(height * 0.5, 96);
    const fit = () => { context.font = `800 ${size}px Inter, "Segoe UI", system-ui, sans-serif`; return Math.max(...lines.map((line) => context.measureText(line).width)); };
    let measured = fit();
    if (measured > maxWidth && words.length > 1) {
      const middle = Math.ceil(words.length / 2);
      lines = [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
      measured = fit();
    }
    while (measured > maxWidth && size > 14) { size -= 2; measured = fit(); }
    context.textAlign = "center";
    context.textBaseline = "middle";
    const lineHeight = size * 1.12;
    const top = height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, row) => {
      const y = top + row * lineHeight;
      if (style === "wave") {
        const letters = Array.from(line);
        const total = context.measureText(line).width;
        let x = width / 2 - total / 2;
        for (let k = 0; k < letters.length; k += 1) {
          const letterWidth = context.measureText(letters[k]).width;
          context.fillStyle = fillStyle;
          context.textAlign = "left";
          context.fillText(letters[k], x, y + wave(t, 1, k / Math.max(3, letters.length)) * size * 0.16);
          x += letterWidth;
        }
        context.textAlign = "center";
        return;
      }
      context.save();
      context.translate(width / 2, y);
      if (style === "pulse") { const grow = 1 + 0.12 * wave(t, 1); context.scale(grow, grow); }
      if (style === "shake") { context.translate(wave(t, 3) * size * 0.07, wave(t, 4, 0.25) * size * 0.04); context.rotate(wave(t, 3, 0.1) * 0.05); }
      context.fillStyle = style === "rainbow" ? `hsl(${Math.round(t * 360 + row * 40)} 90% ${ink === "#14161f" ? 35 : 62}%)` : fillStyle;
      context.fillText(line, 0, 0);
      context.restore();
    });
  }

  /* The photo `source` (a bitmap) cut to fill the whole frame, like object-fit: cover. */
  function drawCover(context, source, width, height) {
    const crop = Core.coverCrop(source.naturalWidth || source.width, source.naturalHeight || source.height, width, height);
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  }

  async function loadPicture(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (error) { /* try an <img> */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      image.src = url;
    });
  }

  const asBlob = (bytes) => new Blob([bytes], { type: "image/gif" });

  /* The view to make a GIF. `onBack()` leaves it, `onDone(gif)` is called with the new library entry. */
  function makeView({ onBack, onDone }) {
    let mode = "photos";
    let busy = false;
    let timer = null;
    const photos = [];                                        // {file, bitmap, url}
    const text = { value: "", swatch: 0, style: "pulse" };
    const file = { blob: null, url: "" };
    const options = { shape: "wide", speed: "medium", pingpong: true };

    const stage = h("div", { class: "gif-stage" });
    const controls = h("div", { class: "gif-controls" });
    const title = h("input", { class: "field", maxlength: GifCore.MAX_TITLE, placeholder: "Name oder Stichwörter, z. B. lachen", "aria-label": "Name des GIFs", autocomplete: "off" });
    const hint = h("p", { class: "hint" }, "Dein GIF kommt in die Bibliothek: alle, die angemeldet sind, können es finden, mit einem Stern merken und verschicken.");
    const create = h("button", { class: "btn primary", type: "button", disabled: true }, "Erstellen und einfügen");
    const modes = h("div", { class: "gif-modes" });
    const picker = h("input", { type: "file", hidden: true, "aria-hidden": "true", tabindex: "-1" });

    // ---- the frames of the current mode (a canvas each), also used to play a preview
    function shapeRatio() { return SHAPES.find(([id]) => id === options.shape)[2]; }

    function photoFrames(width) {
      const height = Math.round(width / shapeRatio());
      const frames = [];
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      for (const photo of photos) {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
        drawCover(context, photo.bitmap, width, height);
        frames.push(context.getImageData(0, 0, width, height).data);
      }
      const order = options.pingpong && frames.length > 2 ? GifCore.pingPong(frames.length) : frames.map((_, i) => i);
      return { width, height, frames: order.map((i) => frames[i]) };
    }

    function textFrames() {
      const canvas = document.createElement("canvas");
      canvas.width = TEXT_WIDTH;
      canvas.height = Math.round(TEXT_WIDTH * 0.75);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const frames = [];
      for (let k = 0; k < TEXT_FRAMES; k += 1) {
        drawText(context, canvas.width, canvas.height, text.value, SWATCHES[text.swatch], text.style, k / TEXT_FRAMES);
        frames.push(context.getImageData(0, 0, canvas.width, canvas.height).data);
      }
      return { width: canvas.width, height: canvas.height, frames };
    }

    // ---- the preview
    function stopPreview() { clearInterval(timer); timer = null; }

    function preview() {
      stopPreview();
      const ready = mode === "photos" ? photos.length >= 2 : mode === "text" ? !!Core.cleanText(text.value) : !!file.blob;
      create.disabled = busy || !ready;
      if (mode === "file") {
        fill(stage, file.url ? h("img", { class: "gif-result", src: file.url, alt: "Vorschau deines GIFs" }) : h("button", { class: "gif-drop", type: "button", onclick: () => { picker.accept = "image/gif"; picker.multiple = false; picker.click(); } }, icon("gif"), h("b", {}, "GIF-Datei auswählen"), h("small", {}, "Höchstens 3 MB")));
        return;
      }
      if (!ready) {
        fill(stage, h("div", { class: "gif-drop idle" }, icon(mode === "photos" ? "image" : "text"), h("b", {}, mode === "photos" ? "Wähle mindestens 2 Fotos" : "Schreib einen Text"), h("small", {}, mode === "photos" ? "Bis zu 10 Fotos werden zu einem Daumenkino." : "Zum Beispiel „Moin!“ oder „Läuft bei dir“.")));
        return;
      }
      const canvas = h("canvas", { class: "gif-canvas", role: "img", "aria-label": "Vorschau deines GIFs" });
      fill(stage, canvas);
      const context = canvas.getContext("2d");
      if (mode === "photos") {
        const width = 360;
        canvas.width = width;
        canvas.height = Math.round(width / shapeRatio());
        const order = options.pingpong && photos.length > 2 ? GifCore.pingPong(photos.length) : photos.map((_, i) => i);
        let step = 0;
        const draw = () => { context.fillStyle = "#000"; context.fillRect(0, 0, canvas.width, canvas.height); drawCover(context, photos[order[step % order.length]].bitmap, canvas.width, canvas.height); step += 1; };
        draw();
        timer = setInterval(draw, SPEEDS.find(([id]) => id === options.speed)[2]);
      } else {
        canvas.width = TEXT_WIDTH;
        canvas.height = Math.round(TEXT_WIDTH * 0.75);
        let step = 0;
        const draw = () => { drawText(context, canvas.width, canvas.height, Core.cleanText(text.value), SWATCHES[text.swatch], text.style, (step % TEXT_FRAMES) / TEXT_FRAMES); step += 1; };
        draw();
        timer = setInterval(draw, 80);
      }
    }

    // ---- the controls of the current mode
    function drawControls() {
      if (mode === "photos") {
        const strip = h("div", { class: "gif-thumbs" }, photos.map((photo, index) => h("div", { class: "gif-thumb" },
          h("img", { src: photo.url, alt: `Foto ${index + 1}` }),
          h("button", { class: "pv-x", type: "button", "aria-label": `Foto ${index + 1} entfernen`, onclick: () => { URL.revokeObjectURL(photo.url); photo.bitmap.close?.(); photos.splice(index, 1); drawControls(); preview(); } }, icon("close")))),
          photos.length < 10 ? h("button", { class: "gif-thumb add", type: "button", "aria-label": "Fotos hinzufügen", onclick: () => { picker.accept = "image/jpeg,image/png,image/webp,image/gif"; picker.multiple = true; picker.click(); } }, icon("plus")) : null);
        fill(controls, strip,
          h("div", { class: "gif-row" }, h("span", { class: "gif-label" }, "Format"), segmented("Format", SHAPES, options.shape, (id) => { options.shape = id; preview(); })),
          h("div", { class: "gif-row" }, h("span", { class: "gif-label" }, "Tempo"), segmented("Tempo", SPEEDS, options.speed, (id) => { options.speed = id; preview(); })),
          h("label", { class: "check gif-check" }, h("input", { type: "checkbox", checked: options.pingpong, onchange: (event) => { options.pingpong = event.currentTarget.checked; preview(); } }), h("span", {}, "Hin und zurück (ohne Sprung am Ende)")));
      } else if (mode === "text") {
        const input = h("input", { class: "field", maxlength: 30, placeholder: "Dein Text", "aria-label": "Text des GIFs", autocomplete: "off" });
        input.value = text.value;
        input.addEventListener("input", () => { text.value = input.value; preview(); });
        fill(controls, input,
          h("div", { class: "gif-row" }, h("span", { class: "gif-label" }, "Stil"), segmented("Stil", TEXT_STYLES, text.style, (id) => { text.style = id; preview(); })),
          h("div", { class: "gif-row" }, h("span", { class: "gif-label" }, "Farbe"), h("div", { class: "swatches", role: "radiogroup", "aria-label": "Farbe" }, SWATCHES.map(([colour], index) =>
            h("button", { class: `swatch${index === text.swatch ? " on" : ""}`, type: "button", role: "radio", "aria-checked": String(index === text.swatch), "aria-label": `Farbe ${index + 1}`, style: `background:${colour}`, onclick: (event) => {
              text.swatch = index;
              for (const other of event.currentTarget.parentNode.children) { other.classList.remove("on"); other.setAttribute("aria-checked", "false"); }
              event.currentTarget.classList.add("on");
              event.currentTarget.setAttribute("aria-checked", "true");
              preview();
            } })))));
        setTimeout(() => input.focus(), 0);
      } else {
        fill(controls, h("p", { class: "hint" }, "Nimm ein GIF, das du selbst gemacht hast oder das du verschicken darfst."));
      }
    }

    function setMode(next) {
      if (busy) return;
      mode = next;
      fill(modes, Y.tabs([["photos", "Fotos"], ["text", "Text"], ["file", "GIF-Datei"]], mode, setMode, "So machst du ein GIF"));
      drawControls();
      preview();
    }

    picker.addEventListener("change", async () => {
      const chosen = [...picker.files];
      picker.value = "";
      if (!chosen.length) return;
      if (chosen.some((entry) => entry.type.startsWith("video/"))) { toast("Videos gibt es bei Pulse nicht. Nimm Fotos oder ein GIF."); return; }
      if (mode === "file") {
        const entry = chosen[0];
        if (entry.type !== "image/gif") { toast("Das ist keine GIF-Datei."); return; }
        if (entry.size > GifCore.MAX_BYTES) { toast(Api.MESSAGES.gif_too_big); return; }
        const bytes = new Uint8Array(await entry.arrayBuffer());
        if (!GifCore.inspect(bytes)) { toast(Api.MESSAGES.bad_gif); return; }
        if (file.url) URL.revokeObjectURL(file.url);
        file.blob = new Blob([bytes], { type: "image/gif" });
        file.url = URL.createObjectURL(file.blob);
        preview();
        return;
      }
      for (const entry of chosen) {
        if (photos.length >= 10) { toast("Mehr als 10 Fotos gehen nicht."); break; }
        if (!/^image\/(jpeg|png|webp|gif)$/.test(entry.type)) { toast(Api.MESSAGES.bad_image); continue; }
        try { photos.push({ file: entry, bitmap: await loadPicture(entry), url: URL.createObjectURL(entry) }); } catch (error) { toast("Dieses Foto konnte nicht gelesen werden."); }
      }
      drawControls();
      preview();
    });

    // ---- making it
    async function encodeCurrent() {
      if (mode === "file") return file.blob;
      if (mode === "text") {
        const made = textFrames();
        return asBlob(GifCore.encode(made.frames, made.width, made.height, { delay: 80, colors: 32 }));
      }
      const delay = SPEEDS.find(([id]) => id === options.speed)[2];
      for (const [width, colors] of [[360, 128], [300, 96], [240, 64], [180, 48]]) {
        const made = photoFrames(width);
        const blob = asBlob(GifCore.encode(made.frames, made.width, made.height, { delay, colors, dither: true }));
        if (blob.size <= GifCore.MAX_BYTES) return blob;
        await wait(20);
      }
      return null;
    }

    create.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      create.disabled = true;
      create.classList.add("busy");
      await wait(40);                                         // let the button show that it is working before the pixels are crunched
      let blob = null;
      try { blob = await encodeCurrent(); } catch (error) { blob = null; }
      if (!blob) { busy = false; create.classList.remove("busy"); create.disabled = false; toast("Das GIF konnte nicht erstellt werden (vielleicht ist es zu groß)."); return; }
      const reply = await Api.uploadGif(blob, { title: GifCore.cleanTitle(title.value) });
      busy = false;
      create.classList.remove("busy");
      create.disabled = false;
      if (!reply.ok) { toast(Api.message(reply)); return; }
      stopPreview();
      toast("Dein GIF ist in der Bibliothek.");
      onDone(reply.data.gif);
    });

    const back = h("button", { class: "btn ghost", type: "button", onclick: () => { stopPreview(); photos.forEach((photo) => { URL.revokeObjectURL(photo.url); photo.bitmap.close?.(); }); if (file.url) URL.revokeObjectURL(file.url); onBack(); } }, "Zurück");
    const root = h("div", { class: "gif-make" },
      h("div", { class: "gif-make-top" }, h("button", { class: "icon-btn", type: "button", "aria-label": "Zurück zur Bibliothek", onclick: () => back.click() }, icon("back")), h("h2", {}, "Eigenes GIF")),
      modes, stage, controls,
      h("label", { class: "field-label" }, h("span", {}, "Name (freiwillig)"), title), hint, picker,
      h("div", { class: "gif-foot" }, back, create));
    setMode("photos");
    return root;
  }

  Object.assign(Y, { gifMakeView: makeView });
})();
