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

  const narrow = () => !window.matchMedia || matchMedia("(max-width: 819px), (pointer: coarse)").matches;

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
    const title = String(item.text || "").split("\n")[0].trim();
    const ago = Core.relativeTime(item.createdAt);
    const who = kind === "tall"
      ? h("span", { class: "skz-meta" }, h("b", {}, item.user.name), h("small", {}, /^\d+ (Sek|Min|Std|Tg)\./.test(ago) ? `Vor ${ago}` : ago))        // (like Snapchat: the name and "Vor 17 Std." in the corner)
      : h("span", { class: "skz-who" }, avatar(item.user, "sm"), h("b", {}, item.user.name));
    const badge = media && media.video ? h("span", { class: "skz-badge", "aria-hidden": "true" }, icon("playCircle")) : null;
    return h("button", { class: `skz-card ${kind}`, type: "button", "aria-label": `Beitrag von ${item.user.name}${item.text ? `: ${Y.snippet(item.text, 60)}` : ""}`, onclick: () => open(item) }, stage, badge, kind === "big" && media && title ? h("span", { class: "skz-title" }, Y.snippet(title, 50)) : null, who);
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

  // --------------------------------------------------------------------------------------------------------- Home (like Instagram)
  /* One post like in Instagram: a header (round picture, name, three dots), the picture or video the full width, the row of buttons (heart, comment, share ... save at the right), the number of
     likes, the words and the time. A double tap on the picture likes it; a video plays muted while it is on the screen. */
  function igCard(item) {
    const media = first(item);
    const state = { liked: !!(item.viewer && item.viewer.liked), saved: !!(item.viewer && item.viewer.bookmarked), likes: (item.counts && item.counts.likes) || 0 };
    const likeBtn = h("button", { class: "ig-act", type: "button", "aria-label": "Gefällt mir" });
    const saveBtn = h("button", { class: "ig-act ig-save", type: "button", "aria-label": "Speichern" });
    const likes = h("b", { class: "ig-likes" });
    function draw() {
      fill(likeBtn, icon(state.liked ? "heartFill" : "heart"));
      likeBtn.classList.toggle("on", state.liked);
      likeBtn.setAttribute("aria-pressed", String(state.liked));
      fill(saveBtn, icon(state.saved ? "bookmarkFill" : "bookmark"));
      saveBtn.setAttribute("aria-pressed", String(state.saved));
      likes.textContent = state.likes ? `${Core.formatCount(state.likes)} Gefällt mir` : "Sei der Erste, dem das gefällt";
    }
    async function toggleLike() {
      if (!Y.requireLogin("Melde dich an, um mitzumachen.")) return;
      const on = !state.liked;
      state.liked = on; state.likes = Math.max(0, state.likes + (on ? 1 : -1)); draw();
      const reply = on ? await Api.post(`/posts/${item.id}/like`) : await Api.del(`/posts/${item.id}/like`);
      if (!reply.ok) { state.liked = !on; state.likes = Math.max(0, state.likes + (on ? -1 : 1)); draw(); Y.toast?.(Api.message(reply)); return; }
      if (reply.data.counts) { state.likes = reply.data.counts.likes; draw(); }
    }
    async function toggleSave() {
      if (!Y.requireLogin("Melde dich an, um Lesezeichen zu setzen.")) return;
      const on = !state.saved;
      state.saved = on; draw();
      const reply = on ? await Api.post(`/posts/${item.id}/bookmark`) : await Api.del(`/posts/${item.id}/bookmark`);
      if (!reply.ok) { state.saved = !on; draw(); Y.toast?.(Api.message(reply)); }
    }
    likeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      const wasLiked = state.liked;
      toggleLike();
      if (!wasLiked && Y.me) { const box = likeBtn.getBoundingClientRect(); Y.likeBurst?.(box.left + box.width / 2, box.top + box.height / 2, { size: 56 }); Y.sound?.play("like"); }
    });
    saveBtn.addEventListener("click", toggleSave);
    const openIt = () => open(item);
    const comment = h("button", { class: "ig-act", type: "button", "aria-label": "Kommentare", onclick: () => Y.navigate(Y.postPath(item)) }, icon("reply"));
    const share = h("button", { class: "ig-act", type: "button", "aria-label": "Teilen" }, icon("send"));
    share.addEventListener("click", () => Y.menu(share, Y.shareItems(item)));
    const more = h("button", { class: "ig-more", type: "button", "aria-label": "Mehr" }, icon("more"));
    more.addEventListener("click", () => Y.menu(more, [{ label: "Beitrag öffnen", icon: "image", run: openIt }, { label: `Profil von ${item.user.name}`, icon: "user", run: () => Y.navigate(`/${item.user.handle}`) }]));

    const stage = h("div", { class: "ig-stage" });
    let video = null;
    if (media && media.video) {
      video = h("video", { src: `${media.url}#t=0.001`, poster: /^\/yipi-media\/[0-9a-f]{32}$/.test(media.url || "") ? `${media.url}/poster` : undefined, muted: true, loop: true, playsinline: true, preload: "metadata", "aria-hidden": "true" });
      stage.append(video, h("span", { class: "ig-badge", "aria-hidden": "true" }, icon("playCircle")));
    } else if (media) {
      stage.append(h("img", { src: media.url, alt: media.alt || "", loading: "lazy", decoding: "async" }));
      if (item.media.length > 1) stage.append(h("span", { class: "ig-count" }, `1/${item.media.length}`));
    } else {
      stage.classList.add("words");
      stage.style.setProperty("--banner", Core.defaultColors(item.user.handle).banner);
      stage.append(h("span", { class: "skz-words" }, Y.snippet(String(item.text || "").replace(/\s+/g, " "), 160)));
    }
    stage.addEventListener("click", openIt);
    Y.onDoubleTap?.(stage, (x, y) => { if (!state.liked) toggleLike(); Y.likeBurst?.(x, y); if (Y.me) Y.sound?.play("like"); }, { ignore: "button, a" });
    if (video && "IntersectionObserver" in window) {
      new IntersectionObserver((entries) => { for (const entry of entries) { if (entry.isIntersecting && entry.intersectionRatio > 0.6) video.play().catch(() => {}); else video.pause(); } }, { threshold: [0, 0.6] }).observe(video);
    }

    const text = String(item.text || "").trim();
    const replies = (item.counts && item.counts.replies) || 0;
    const card = h("article", { class: "ig-card", "data-id": String(item.id), "aria-label": `Beitrag von ${item.user.name}` },
      h("div", { class: "ig-head" },
        link(`/${item.user.handle}`, { class: "ig-who", "aria-label": `Profil von ${item.user.name}` }, avatar(item.user, "sm"), h("span", { class: "ig-name" }, h("b", {}, item.user.name), h("small", {}, `@${item.user.handle}`))),
        more),
      stage,
      h("div", { class: "ig-bar" }, h("div", { class: "ig-left" }, likeBtn, comment, share), saveBtn),
      h("div", { class: "ig-text" },
        likes,
        media && text ? h("p", { class: "ig-caption" }, h("b", {}, item.user.name), " ", Y.snippet(text, 220)) : null,
        replies ? h("button", { class: "ig-replies", type: "button", onclick: () => Y.navigate(Y.postPath(item)) }, replies === 1 ? "1 Kommentar ansehen" : `Alle ${Core.formatCount(replies)} Kommentare ansehen`) : null,
        h("small", { class: "ig-time" }, Core.relativeTime(item.createdAt))));
    draw();
    return card;
  }

  const oldHome = Y.views.home;
  Y.views.home = function home(route, ctx) {
    if (!Y.me || !narrow()) return oldHome(route, ctx);
    const people = peopleRow();
    people.element.classList.add("ig-stories");
    Y.refreshStories = () => people.reload();
    let scope = "foryou";
    const tabBox = h("div", { class: "ig-tabs", role: "tablist" });
    const feedBox = h("div", { class: "ig-feed" });
    let feed = null;
    function drawFeed() {
      feed?.destroy();
      feed = pager({
        load: listLoader((offset) => qs("/timeline", { feed: scope, offset: offset || 0, limit: 8 })),
        render: (item) => igCard(item),
        empty: Y.emptyState(scope === "following" ? "Noch nichts von deinen Abos" : "Noch nichts los", scope === "following" ? "Folge Leuten, dann siehst du hier ihre Beiträge." : "Beiträge erscheinen hier."),
      });
      fill(feedBox, feed.element);
    }
    function drawTabs() {
      fill(tabBox, ...[["foryou", "Für dich"], ["following", "Abos"]].map(([id, label]) => h("button", { class: `ig-tab${id === scope ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(id === scope), onclick: () => { if (id === scope) return; scope = id; drawTabs(); drawFeed(); } }, label)));
    }
    drawTabs();
    drawFeed();
    const el = h("div", { class: "view home-view skz-home ig-home" }, people.element, tabBox, feedBox);
    const change = () => { if (el.isConnected) Y.rerender?.(); };           // the phone was turned to the side: the feed comes back
    const query = window.matchMedia ? matchMedia("(max-width: 819px), (pointer: coarse)") : null;
    query?.addEventListener?.("change", change);

    return {
      element: el, title: "Satürn", keep: true,
      refresh() { people.reload(); feed?.reload(); },
      onPosted() { feed?.reload(); },
      destroy() { people.destroy(); feed?.destroy(); query?.removeEventListener?.("change", change); if (Y.refreshStories) Y.refreshStories = null; },
    };
  };

  /* A phone or tablet held sideways: a black page says to turn it upright. It looks at how the DEVICE is held (not at the size of the page: with the keyboard open the page is wider than tall,
     and that is not a turned device), and only on touch screens; a computer is never asked. While somebody types the bar at the bottom goes away (the keyboard needs the room). */
  document.body.append(h("div", { class: "turn-note", role: "alert" }, h("span", { class: "turn-phone", "aria-hidden": "true" }), h("b", {}, "Bitte dreh dein Gerät hochkant"), h("small", {}, "Satürn funktioniert nur im Hochformat.")));
  const heldSideways = () => {
    if (!window.matchMedia || !matchMedia("(pointer: coarse)").matches) return false;
    const type = window.screen && screen.orientation && screen.orientation.type;
    if (type) return type.startsWith("landscape");
    return typeof window.orientation === "number" ? Math.abs(window.orientation) === 90 : false;
  };
  const checkTurn = () => document.documentElement.classList.toggle("turned", heldSideways());
  checkTurn();
  addEventListener("orientationchange", () => setTimeout(checkTurn, 250));
  if (window.screen && screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener("change", checkTurn);
  const typing = (event) => { if (event.target && event.target.matches && event.target.matches("input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea")) document.documentElement.classList.toggle("typing", event.type === "focusin"); };
  document.addEventListener("focusin", typing);
  document.addEventListener("focusout", typing);

  Y.skizze = { card, cell, peopleRow, open, grid: narrow };
})();
