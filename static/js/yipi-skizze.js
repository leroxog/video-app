/* Satürn sketch look (yipi-skizze.js): the phone layout that was drawn by hand -- Home with the row "Personen", the row of tall cards "Für dich!" and the two-column grid
   "Entdecke"; the "+" as a sheet from the bottom ("Kontakt hinzufügen oder Gruppe erstellen" and the big round "Datei hochladen"). Held upright (up to 819 px wide) Home looks like this;
   wider screens keep the feed. The file is loaded after the pages (yipi-views.js, yipi-chats.js, yipi-stories.js) and puts its own Home in front of the old one. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, pager } = Y;
  const { qs, listLoader } = Y;

  const narrow = () => !window.matchMedia || matchMedia("(max-width: 819px)").matches;

  // ------------------------------------------------------------------------------------------------ the "+" sheet
  /* A sheet from the bottom: the first line adds a contact or makes a group, the big round button below uploads (a video, a post or a story). The camera and the games are one tap away, too. */
  function plusSheet({ contactOnly = false } = {}) {
    if (!Y.requireLogin("Melde dich an, um etwas hochzuladen.")) return null;
    if (document.querySelector(".skz-sheet-back")) return null;
    const back = h("div", { class: "skz-sheet-back" });
    const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } };
    function close() {
      document.removeEventListener("keydown", onKey, true);
      back.classList.add("closing");
      document.body.classList.remove("modal-open");
      setTimeout(() => back.remove(), 180);
    }
    const go = (run) => () => { close(); run(); };
    const contact = h("div", { class: "skz-contact" },
      h("span", { class: "skz-contact-ic", "aria-hidden": "true" }, icon("usersFill")),
      h("div", { class: "skz-contact-text" },
        h("button", { class: "skz-contact-main", type: "button", onclick: go(() => Y.newMessage?.()) }, "Kontakt hinzufügen"),
        h("button", { class: "skz-contact-sub", type: "button", onclick: go(() => Y.newGroup?.()) }, "oder Gruppe erstellen")));
    const upload = h("div", { class: "skz-upload" },
      h("span", { class: "skz-upload-label" }, "Datei hochladen"),
      h("button", { class: "skz-upload-btn", type: "button", "aria-label": "Datei hochladen: Video oder Foto", onclick: go(() => Y.uploadFile()) }, icon("arrowUp")));       // (one picker: a video opens the editor, photos open the post page)
    const more = h("div", { class: "skz-sheet-more" },
      h("button", { class: "skz-chip", type: "button", onclick: go(() => Y.navigate("/camera")) }, icon("camera"), "Kamera und Spiele"),
      h("button", { class: "skz-chip", type: "button", onclick: go(() => Y.newStory?.(() => Y.refreshStories?.())) }, icon("image"), "Story"));
    const people = h("div", { class: "skz-people-sheet" },
      h("button", { class: "skz-big-row", type: "button", onclick: go(() => Y.newMessage?.()) }, icon("user"), h("span", {}, "Kontakt hinzufügen")),
      h("button", { class: "skz-big-row", type: "button", onclick: go(() => Y.newGroup?.()) }, icon("usersFill"), h("span", {}, "Gruppe erstellen")));       // (the round button of the Chats: only contacts and groups)
    const panel = h("div", { class: "skz-sheet", role: "dialog", "aria-modal": "true", "aria-label": contactOnly ? "Kontakt oder Gruppe" : "Neu" }, h("span", { class: "skz-grip", "aria-hidden": "true" }), ...(contactOnly ? [people] : [contact, h("hr", { class: "skz-rule" }), upload, more]));
    back.addEventListener("click", (event) => { if (event.target === back) close(); });
    back.append(panel);
    document.body.append(back);
    document.body.classList.add("modal-open");
    document.addEventListener("keydown", onKey, true);
    panel.querySelector("button")?.focus();
    return close;
  }
  Y.plusSheet = plusSheet;

  /* On a phone the "+" opens the sheet; on a wide screen (and when a place already knows what it wants: a video, a post) the old way stays. */
  const oldNewPost = Y.newPost;
  Y.newPost = function newPost(options = {}) {
    if (options.only || !narrow()) return oldNewPost(options);
    plusSheet();
    return null;
  };

  // ----------------------------------------------------------------------------------------------------- the cards
  const first = (item) => (item.media && item.media[0]) || null;
  const isVideo = (item) => !!(first(item) && first(item).video);

  /* A tap on a card: a video goes to the Videos tab (it comes first there), everything else opens the post. */
  function open(item) {
    if (isVideo(item)) { Y.startVideo = item; Y.navigate("/videos"); } else Y.navigate(Y.postPath(item));
  }

  /* One card. kind "tall": the small portrait card of "Für dich!"; kind "big": the large card of "Entdecke". A post without a picture shows its words on a colour of its author. */
  function card(item, kind) {
    const media = first(item);
    const stage = h("span", { class: "skz-art" });
    if (media && media.video) {
      stage.append(h("video", { src: `${media.url}#t=0.001`, poster: /^\/yipi-media\/[0-9a-f]{32}$/.test(media.url || "") ? `${media.url}/poster` : undefined, muted: true, playsinline: true, preload: "metadata", "aria-hidden": "true" }));
    } else if (media) {
      stage.append(h("img", { src: media.url, alt: media.alt || "", loading: "lazy", decoding: "async" }));
    } else {
      stage.classList.add("words");
      stage.style.setProperty("--banner", Core.defaultColors(item.user.handle).banner);
      stage.append(h("span", { class: "skz-words" }, Y.snippet(String(item.text || "").replace(/\s+/g, " "), kind === "big" ? 120 : 70)));
    }
    const who = h("span", { class: "skz-who" }, avatar(item.user, "sm"), h("b", {}, item.user.name));
    const badge = media && media.video ? h("span", { class: "skz-badge", "aria-hidden": "true" }, icon("playCircle")) : null;
    return h("button", { class: `skz-card ${kind}`, type: "button", "aria-label": `Beitrag von ${item.user.name}${item.text ? `: ${Y.snippet(item.text, 60)}` : ""}`, onclick: () => open(item) }, stage, badge, who);
  }

  /* One square of the profile grid (three in a row): the picture or a still of the video, the words of a post on the colour of its author, a small badge for a video or for more pictures. */
  function cell(item) {
    const media = first(item);
    const stage = h("span", { class: "skz-art" });
    if (media && media.video) stage.append(h("video", { src: `${media.url}#t=0.001`, poster: /^\/yipi-media\/[0-9a-f]{32}$/.test(media.url || "") ? `${media.url}/poster` : undefined, muted: true, playsinline: true, preload: "metadata", "aria-hidden": "true" }));
    else if (media) stage.append(h("img", { src: media.url, alt: media.alt || "", loading: "lazy", decoding: "async" }));
    else {
      stage.classList.add("words");
      stage.style.setProperty("--banner", Core.defaultColors(item.user.handle).banner);
      stage.append(h("span", { class: "skz-words" }, Y.snippet(String(item.text || "").replace(/\s+/g, " "), 60)));
    }
    const badge = media && media.video ? h("span", { class: "skz-badge", "aria-hidden": "true" }, icon("playCircle")) : item.media && item.media.length > 1 ? h("span", { class: "skz-badge", "aria-hidden": "true" }, icon("image")) : null;
    return h("button", { class: "skz-cell", type: "button", "aria-label": `Beitrag von ${item.user.name}${item.text ? `: ${Y.snippet(item.text, 60)}` : ""}`, onclick: () => open(item) }, stage, badge);
  }

  // ------------------------------------------------------------------------------------------------- the row "Personen"
  /* Round pictures: yours first (a plus to add a story, or your story), then the people who have a story (the new ones with a dark ring), then people you could follow. */
  function peopleRow() {
    const row = h("div", { class: "skz-people", role: "list", "aria-label": "Personen" });
    let rings = [];
    let suggestions = [];
    let dead = false;

    const circle = (entry, index) => {
      const person = entry.user;
      const button = h("button", { class: `story-btn${entry.unseen > 0 ? " unseen" : ""}${entry.isMe ? " mine" : ""}`, type: "button", role: "listitem", "aria-label": entry.isMe ? "Deine Story ansehen" : `Story von ${person.name}${entry.unseen > 0 ? " (neu)" : ""}` },
        h("span", { class: "story-ring" }, avatar(person, "lg")), h("span", { class: "story-name" }, entry.isMe ? "Deine Story" : person.name));
      button.addEventListener("click", () => { Y.sound?.play("open"); Y.openStories(rings, index, () => load()); });
      return button;
    };
    const mineCircle = () => {
      const own = rings.find((entry) => entry.isMe);
      if (own) return circle(own, rings.indexOf(own));
      return h("button", { class: "story-btn mine fresh", type: "button", role: "listitem", "aria-label": "Eine Story hinzufügen", onclick: () => Y.newStory(() => load()) },
        h("span", { class: "story-ring" }, avatar(Y.me, "lg"), h("span", { class: "story-add", "aria-hidden": "true" }, icon("plus"))), h("span", { class: "story-name" }, "Deine Story"));
    };
    function draw() {
      const withStory = new Set(rings.map((entry) => entry.user.handle.toLowerCase()));
      const people = rings.map((entry, index) => (entry.isMe ? null : circle(entry, index))).filter(Boolean);
      const others = suggestions.filter((user) => !user.isMe && !withStory.has(user.handle.toLowerCase())).map((user) => link(`/${user.handle}`, { class: "story-btn", role: "listitem", "aria-label": `Profil von ${user.name}` },
        h("span", { class: "story-ring" }, avatar(user, "lg")), h("span", { class: "story-name" }, user.name)));
      fill(row, mineCircle(), ...people, ...others);
    }
    async function load() {
      const [stories, people] = await Promise.all([Api.get("/stories"), Api.get("/suggestions?limit=14")]);
      if (dead) return;
      rings = stories.ok ? stories.data.items : [];
      suggestions = people.ok ? people.data.users : [];
      draw();
    }
    draw();
    load();
    return { element: row, reload: load, destroy() { dead = true; } };
  }

  // --------------------------------------------------------------------------------------------------------- Home
  const oldHome = Y.views.home;
  Y.views.home = function home(route, ctx) {
    if (!Y.me || !narrow()) return oldHome(route, ctx);
    let dead = false;
    const people = peopleRow();
    Y.refreshStories = () => people.reload();
    const forBox = h("div", { class: "skz-for", role: "list" });
    const forSection = h("section", { class: "skz-sec", hidden: true }, h("h2", {}, "Für dich!"), forBox);
    const grid = pager({
      load: listLoader((cursor) => qs("/timeline", { feed: "media", cursor })),
      render: (item) => card(item, "big"),
      empty: Y.emptyState("Noch nichts zu entdecken", "Beiträge mit Fotos und Videos erscheinen hier."),
    });
    grid.element.classList.add("skz-grid");
    const el = h("div", { class: "view home-view skz-home" },
      h("section", { class: "skz-sec" }, h("h2", {}, "Personen"), people.element),
      forSection,
      h("section", { class: "skz-sec" }, h("h2", {}, "Entdecke"), grid.element));

    async function loadFor() {
      const reply = await Api.get(qs("/timeline", { feed: "foryou" }));
      if (dead || !reply.ok || !reply.data.items.length) return;
      forSection.hidden = false;
      fill(forBox, ...reply.data.items.slice(0, 14).map((item) => { const made = card(item, "tall"); made.setAttribute("role", "listitem"); return made; }));
    }
    loadFor();
    const change = () => { if (el.isConnected) Y.rerender?.(); };           // the phone was turned to the side: the feed comes back
    const query = window.matchMedia ? matchMedia("(max-width: 819px)") : null;
    query?.addEventListener?.("change", change);

    return {
      element: el, title: "Satürn", keep: true,
      refresh() { people.reload(); loadFor(); grid.reload(); },
      onPosted() { loadFor(); grid.reload(); },
      destroy() { dead = true; people.destroy(); grid.destroy(); query?.removeEventListener?.("change", change); if (Y.refreshStories) Y.refreshStories = null; },
    };
  };

  Y.skizze = { card, cell, peopleRow, open, grid: narrow };
})();
