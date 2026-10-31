/* Nex GIFs: the picker (a sheet from the bottom on a phone, a window on a computer) with the library of everybody's GIFs -- popular,
   new, your favourites, your own, and a search --, a star to favourite a GIF, and a "+" to make your own: a name and a picture (a photo, a few photos or
   a GIF file). A sticker you make goes into the library, where everybody who is signed in can favourite it and send it.
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
        item.mine || (Y.me && Y.me.isAdmin && !item.starter) ? { label: "Sticker löschen", icon: "trash", danger: true, run: async () => {
          if (!(await confirmBox({ title: "Sticker löschen?", text: "Es verschwindet aus der Bibliothek. Beiträge, in denen es schon steht, bleiben unverändert.", yes: "Löschen", danger: true }))) return;
          const reply = await Api.del(`/gifs/${item.id}`);
          if (!reply.ok) { toast(Api.message(reply)); return; }
          remove(item);
          toast("Der Sticker wurde gelöscht.");
        } } : null,
        !item.mine && !item.starter ? { label: "Sticker melden", icon: "flag", danger: true, run: () => Y.reportDialog({ gifId: item.id }) } : null,
      ]);
    }

    function makeTile(item) {
      const ratio = Math.max(0.4, Math.min(2.5, item.width / item.height));
      const tile = h("div", { class: "gif-tile" },
        h("button", { class: "gif-pick", type: "button", "aria-label": `Sticker verwenden${item.title ? `: ${item.title}` : ""}`, onclick: () => onPick(item) },
          h("img", { src: item.url, alt: item.title || "Sticker", loading: "lazy", decoding: "async", width: item.width, height: item.height, style: `aspect-ratio: ${ratio.toFixed(3)}` })),
        h("button", { class: "gif-fav", type: "button", onclick: (event) => { event.stopPropagation(); toggleFavorite(item, tile); } }),
        item.mine || !item.starter ? h("button", { class: "gif-more", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu", onclick: (event) => { event.stopPropagation(); moreMenu(item, event.currentTarget); } }, icon("more")) : null);
      drawStar(tile, item);
      return tile;
    }

    function showEmpty() {
      const nothing = {
        favorites: ["Noch keine Favoriten", "Tippe bei einem Sticker auf den Stern, dann findest du ihn hier wieder."],
        mine: ["Du hast noch keinen Sticker gemacht", "Aus Fotos, aus einem Text oder aus einer GIF-Datei."],
      }[tab] || (query ? [`Kein Sticker für „${query}“`, "Probier ein anderes Wort – oder mach selbst einen."] : ["Hier ist noch nichts", "Mach den ersten Sticker."]);
      fill(foot, Y.emptyState(nothing[0], nothing[1], h("button", { class: "btn primary", type: "button", onclick: onMake }, "Eigenen Sticker machen")));
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
      button.setAttribute("aria-label", entry.favorite ? "Sticker aus den Favoriten entfernen" : "Sticker zu den Favoriten hinzufügen");
      fill(button, icon(entry.favorite ? "starFill" : "star"));
    };
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (!Y.requireLogin("Melde dich an, um Sticker zu merken.")) return;
      const wanted = !entry.favorite;
      entry.favorite = wanted;
      draw();
      const reply = wanted ? await Api.post(`/gifs/${entry.id}/favorite`) : await Api.del(`/gifs/${entry.id}/favorite`);
      if (!reply.ok) { entry.favorite = !wanted; draw(); toast(Api.message(reply)); return; }
      toast(wanted ? "Sticker zu deinen Favoriten hinzugefügt" : "Sticker aus den Favoriten entfernt");
    });
    draw();
    return button;
  };

  // ----------------------------------------------------------------------------------------------- picker
  /* The picker. `onPick(gif)` is called with the library entry the person chose (and the picker closes); `onChoose` of a made GIF
     is the same. Returns the dialog. */
  Y.gifPicker = function gifPicker({ onPick }) {
    if (!Y.requireLogin("Melde dich an, um Sticker zu verwenden.")) return null;
    let entry = null;
    let tab = "trending";
    let query = "";
    let grid = null;
    let timer = null;

    const search = h("input", { class: "gif-search-input", type: "search", placeholder: "Sticker suchen", "aria-label": "Sticker suchen", maxlength: 40, autocomplete: "off", enterkeyhint: "search" });
    const chips = h("div", { class: "gif-chips", role: "list" }, QUICK.map((word) => h("button", { class: "gif-chip", type: "button", role: "listitem", onclick: () => { search.value = word; setQuery(word); } }, word)));
    const tabBox = h("div", { class: "gif-tabs" });
    const body = h("div", { class: "gif-body" });
    const plus = h("button", { class: "gif-plus", type: "button", "aria-label": "Eigenen Sticker machen", onclick: () => make() }, icon("plus"), h("span", { class: "gif-plus-label" }, "Eigener Sticker"));
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
    entry = dialog({ bare: true, label: "Sticker auswählen", body: sheet, initialFocus: matchMedia("(pointer: fine)").matches ? search : closeButton, onClose: () => { grid?.destroy(); clearTimeout(timer); window.removeEventListener("resize", onResize); } });
    entry.box.classList.add("gif-dialog");
    return entry;
  };

  // ------------------------------------------------------------------------------------------------ making
  const FRAME_MS = 550;                                       // how long each photo is shown when several make one moving sticker
  const STICKER_WIDTH = 360;

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

  /* The view to make a sticker: a name and a picture, nothing else. A GIF file stays as it is, one photo becomes a still sticker, several photos
     (up to ten) one that moves. `onBack()` leaves it, `onDone(gif)` is called with the new library entry. */
  function makeView({ onBack, onDone }) {
    let busy = false;
    let timer = null;
    const photos = [];                                        // {bitmap, url}
    const file = { blob: null, url: "" };                     // a GIF that is taken as it is

    const stage = h("div", { class: "gif-stage" });
    const title = h("input", { class: "field", maxlength: GifCore.MAX_TITLE, placeholder: "Name, z. B. lachen", "aria-label": "Name des Stickers", autocomplete: "off", required: true });
    const hint = h("p", { class: "hint" }, "Dein Sticker kommt in die Bibliothek: alle, die angemeldet sind, können ihn finden, mit einem Stern merken und verschicken.");
    const create = h("button", { class: "btn primary", type: "button", disabled: true }, "Erstellen und einfügen");
    const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });

    const named = () => !!GifCore.cleanTitle(title.value);
    const ready = () => !busy && named() && (!!file.blob || photos.length > 0);
    const ratio = () => Math.max(0.6, Math.min(1.8, photos[0].bitmap.width / photos[0].bitmap.height));
    const choose = () => picker.click();

    function clear() {
      stopPreview();
      photos.splice(0).forEach((photo) => { URL.revokeObjectURL(photo.url); photo.bitmap.close?.(); });
      if (file.url) URL.revokeObjectURL(file.url);
      file.blob = null;
      file.url = "";
    }

    function stopPreview() { clearInterval(timer); timer = null; }

    function photoFrames(width) {
      const height = Math.round(width / ratio());
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const frames = photos.map((photo) => {
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);
        drawCover(context, photo.bitmap, width, height);
        return context.getImageData(0, 0, width, height).data;
      });
      const order = frames.length > 2 ? GifCore.pingPong(frames.length) : frames.map((_, i) => i);
      return { width, height, frames: order.map((i) => frames[i]) };
    }

    function preview() {
      stopPreview();
      create.disabled = !ready();
      if (file.blob) {
        fill(stage, h("img", { class: "gif-result", src: file.url, alt: "Vorschau deines Stickers" }), h("button", { class: "gif-change", type: "button", onclick: choose }, "Anderes Bild"));
        return;
      }
      if (!photos.length) {
        fill(stage, h("button", { class: "gif-drop", type: "button", onclick: choose }, icon("image"), h("b", {}, "Foto oder GIF auswählen"), h("small", {}, "Ein GIF bleibt, wie es ist. Aus mehreren Fotos wird ein Sticker, der sich bewegt.")));
        return;
      }
      const canvas = h("canvas", { class: "gif-canvas", role: "img", "aria-label": "Vorschau deines Stickers" });
      fill(stage, canvas, h("button", { class: "gif-change", type: "button", onclick: choose }, photos.length < 10 ? "Mehr Fotos oder anderes Bild" : "Anderes Bild"));
      const context = canvas.getContext("2d");
      canvas.width = STICKER_WIDTH;
      canvas.height = Math.round(STICKER_WIDTH / ratio());
      const order = photos.length > 2 ? GifCore.pingPong(photos.length) : photos.map((_, i) => i);
      let step = 0;
      const draw = () => { context.fillStyle = "#000"; context.fillRect(0, 0, canvas.width, canvas.height); drawCover(context, photos[order[step % order.length]].bitmap, canvas.width, canvas.height); step += 1; };
      draw();
      if (photos.length > 1) timer = setInterval(draw, FRAME_MS);
    }

    picker.addEventListener("change", async () => {
      const chosen = [...picker.files];
      picker.value = "";
      if (!chosen.length) return;
      if (chosen.some((entry) => entry.type.startsWith("video/"))) { toast("Videos gibt es bei Nex nicht. Nimm Fotos oder ein GIF."); return; }
      if (chosen.length === 1 && chosen[0].type === "image/gif") {          // a GIF is the sticker itself
        const entry = chosen[0];
        if (entry.size > GifCore.MAX_BYTES) { toast(Api.MESSAGES.gif_too_big); return; }
        const bytes = new Uint8Array(await entry.arrayBuffer());
        if (!GifCore.inspect(bytes)) { toast(Api.MESSAGES.bad_gif); return; }
        clear();
        file.blob = new Blob([bytes], { type: "image/gif" });
        file.url = URL.createObjectURL(file.blob);
        preview();
        return;
      }
      if (file.blob) clear();
      for (const entry of chosen) {
        if (photos.length >= 10) { toast("Mehr als 10 Fotos gehen nicht."); break; }
        if (!/^image\/(jpeg|png|webp|gif)$/.test(entry.type)) { toast(Api.MESSAGES.bad_image); continue; }
        try { photos.push({ bitmap: await loadPicture(entry), url: URL.createObjectURL(entry) }); } catch (error) { toast("Dieses Foto konnte nicht gelesen werden."); }
      }
      preview();
    });
    title.addEventListener("input", () => { create.disabled = !ready(); });

    async function encodeCurrent() {
      if (file.blob) return file.blob;
      if (photos.length === 1) {                              // one photo: one picture, in the best quality that fits
        for (const [width, colors] of [[400, 192], [320, 128], [240, 96], [180, 64]]) {
          const made = photoFrames(width);
          const blob = asBlob(GifCore.encode(made.frames, made.width, made.height, { delay: 100, colors, dither: true }));
          if (blob.size <= GifCore.MAX_BYTES) return blob;
          await wait(20);
        }
        return null;
      }
      for (const [width, colors] of [[360, 128], [300, 96], [240, 64], [180, 48]]) {
        const made = photoFrames(width);
        const blob = asBlob(GifCore.encode(made.frames, made.width, made.height, { delay: FRAME_MS, colors, dither: true }));
        if (blob.size <= GifCore.MAX_BYTES) return blob;
        await wait(20);
      }
      return null;
    }

    create.addEventListener("click", async () => {
      if (!ready()) return;
      busy = true;
      create.disabled = true;
      create.classList.add("busy");
      await wait(40);                                         // let the button show that it is working before the pixels are crunched
      let blob = null;
      try { blob = await encodeCurrent(); } catch (error) { blob = null; }
      if (!blob) { busy = false; create.classList.remove("busy"); create.disabled = !ready(); toast("Der Sticker konnte nicht erstellt werden (vielleicht ist das Bild zu groß)."); return; }
      const reply = await Api.uploadGif(blob, { title: GifCore.cleanTitle(title.value) });
      busy = false;
      create.classList.remove("busy");
      create.disabled = !ready();
      if (!reply.ok) { toast(Api.message(reply)); return; }
      clear();
      toast("Dein Sticker ist in der Bibliothek.");
      Y.sound?.play("success");
      onDone(reply.data.gif);
    });

    const leave = () => { clear(); onBack(); };
    const root = h("div", { class: "gif-make" },
      h("div", { class: "gif-make-top" }, h("button", { class: "icon-btn", type: "button", "aria-label": "Zurück zur Bibliothek", onclick: leave }, icon("back")), h("h2", {}, "Eigener Sticker")),
      h("label", { class: "field-label" }, h("span", {}, "Name"), title),
      stage, hint, picker,
      h("div", { class: "gif-foot" }, h("button", { class: "btn ghost", type: "button", onclick: leave }, "Zurück"), create));
    preview();
    return root;
  }

  Object.assign(Y, { gifMakeView: makeView });
})();
