/* Nex components (the file keeps the name yipi-components.js): the parts that make the page -- a post (card with its buttons and
   menus), the box to write a post (with photos or one GIF, emojis and the ring that counts characters), a row for a person with its
   follow button, and the dialogs to compose and to report. Photos are made smaller in the browser before they are sent (which also
   removes where and with what they were taken). Videos are not taken at all. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, timeEl, toast, dialog, confirmBox, menu } = Y;

  const REASONS = [
    ["spam", "Spam"], ["abuse", "Belästigung oder Beleidigung"], ["hate", "Hass oder Hetze"], ["violence", "Gewalt oder Drohungen"],
    ["illegal", "Illegale Inhalte"], ["self_harm", "Selbstverletzung"], ["factcheck", "Der Fact Check ist falsch"], ["other", "Etwas anderes"],
  ];
  const EMOJIS = ["😀", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎", "🤩", "🥳", "😅", "😇", "🙂", "😉", "😋", "🤔", "🤗", "😴", "😭", "😢", "😡", "🤯", "😱", "🥺",
    "👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "🤝", "✌️", "👋", "🤞", "🫶", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "🔥", "✨", "🎉", "🎂",
    "⭐", "💯", "✅", "❌", "⚡", "🌈", "☀️", "🌙", "🌸", "🌹", "🍀", "🍕", "🍔", "🍟", "🍩", "🍫", "☕", "🍺", "🎵", "🎮", "⚽", "🏀", "🚀", "💡",
    "📚", "💻", "📱", "🎬", "🐶", "🐱", "🐼", "🦊", "🦄", "🐢", "🌍", "🏠", "🚲", "✈️", "🎁", "🤖"];

  const postPath = (item) => `/${item.user.handle}/status/${item.id}`;
  const absolute = (path) => `${location.origin}${path}`;

  // ------------------------------------------------------------------------------------ small pieces
  /* A button of the grey row under a post (comments, reposts, likes). `draw(active, count, text)` fills in icon and number. */
  function pillButton({ kind, label, off, on }) {
    const iconBox = h("span", { class: "pill-ic" });
    const number = h("span", { class: "pill-count" });
    const button = h("button", { class: `act-btn ${kind}`, type: "button", "aria-label": label }, iconBox, number);
    button.draw = (active, count, text) => {
      button.classList.toggle("on", !!active);
      if (on) button.setAttribute("aria-pressed", String(!!active));
      fill(iconBox, icon(active && on ? on : off));
      number.textContent = count ? Core.formatCount(count) : "";
      button.setAttribute("aria-label", `${text || label}${count ? `, ${count}` : ""}`);
    };
    return button;
  }

  /* What goes with a link when somebody sends a post or a video: the page does not say "look at this", it says it like a person would. */
  function shareText(item) {
    const video = !!(item && item.media && item.media.some((entry) => entry.video));
    return video ? "Ich habe ein tolles Video auf Nex gefunden willst du es auch sehen?!" : "Ich habe einen tollen Beitrag auf Nex gefunden willst du ihn auch sehen?!";
  }

  /* The entries of the menus that share a post: copy the link, send it to somebody in a message, the share sheet of the phone. */
  function shareItems(item) {
    const video = !!(item && item.media && item.media.some((entry) => entry.video));
    return [
      video && Y.downloadVideo ? { label: "Video speichern", icon: "download", run: () => Y.downloadVideo(item) } : null,
      { label: "Link kopieren", icon: "link", run: () => copyLink(postPath(item)) },
      Y.qr ? { label: "QR-Code", icon: "qr", run: () => Y.qr.dialog({ path: postPath(item), title: video ? "QR-Code des Videos" : "QR-Code des Beitrags", subtitle: `von @${item.user.handle}` }) } : null,
      { label: "Per Nachricht senden", icon: "mail", run: () => sendPostDialog(item) },
      navigator.share ? { label: "Teilen …", icon: "share", run: async () => {
        try { await navigator.share({ url: absolute(postPath(item)), title: `${item.user.name} auf Nex`, text: shareText(item) }); } catch (error) { /* closed */ }
      } } : null,
    ];
  }

  async function copyLink(path) {
    const address = absolute(path);
    try {
      await navigator.clipboard.writeText(address);
      toast("Link kopiert");
    } catch (error) {
      window.prompt("Diesen Link kannst du kopieren:", address);
    }
  }

  function reportDialog({ postId, handle, gifId, factcheck = false }) {
    if (!Y.requireLogin("Melde dich an, um etwas zu melden.")) return;
    let reason = "";
    const note = h("textarea", { class: "field-area", rows: 3, maxlength: 300, placeholder: "Möchtest du etwas dazu sagen? (freiwillig)", "aria-label": "Anmerkung" });
    const choices = REASONS.filter(([value]) => factcheck || value !== "factcheck").map(([value, text]) => h("label", { class: "choice" }, h("input", { type: "radio", name: "reason", value, onchange: () => { reason = value; entry.box.querySelector(".dialog-actions .btn").disabled = false; } }), h("span", {}, text)));
    const entry = dialog({
      title: gifId ? "GIF melden" : postId ? "Beitrag melden" : `@${handle} melden`,
      body: h("div", { class: "report" }, h("p", { class: "dialog-text" }, "Warum meldest du das?"), h("div", { class: "choices" }, choices), note),
      actions: [{ label: "Melden", kind: "primary", run: async () => {
        if (!reason) return false;
        const reply = await Api.post("/reports", { postId, gifId, handle: postId || gifId ? undefined : handle, reason, note: note.value });
        toast(reply.ok ? "Danke, wir schauen uns das an." : Api.message(reply));
        return reply.ok;
      } }],
    });
    entry.box.querySelector(".dialog-actions .btn").disabled = true;
  }

  // ------------------------------------------------------------------------------------------ people
  function followButton(user, options = {}) {
    if (user.isMe) return null;
    const button = h("button", { class: "btn follow", type: "button" });
    function draw() {
      button.classList.toggle("following", !!user.followedByMe);
      button.classList.toggle("blocked", !!user.blockedByMe);
      fill(button, ...(user.blockedByMe
        ? [h("span", {}, "Blockiert")]
        : user.followedByMe ? [h("span", {}, "Folge ich")] : [h("span", {}, user.followsMe ? "Auch folgen" : "Folgen")]));
      button.setAttribute("aria-pressed", String(!!user.followedByMe));
      button.setAttribute("aria-label", user.blockedByMe ? `@${user.handle} ist blockiert` : user.followedByMe ? `@${user.handle} nicht mehr folgen` : `@${user.handle} folgen`);
    }
    draw();
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!Y.requireLogin(`Melde dich an, um @${user.handle} zu folgen.`)) return;
      if (user.blockedByMe) {
        if (!(await confirmBox({ title: `@${user.handle} nicht mehr blockieren?`, text: "Ihr könnt euch dann wieder sehen und folgen.", yes: "Nicht mehr blockieren" }))) return;
        const reply = await Api.del(`/users/${user.handle}/block`);
        if (reply.ok) { Object.assign(user, reply.data.user); draw(); options.onChange?.(user); toast(`@${user.handle} ist nicht mehr blockiert.`); } else toast(Api.message(reply));
        return;
      }
      const wasFollowing = !!user.followedByMe;
      button.disabled = true;
      const reply = wasFollowing ? await Api.del(`/users/${user.handle}/follow`) : await Api.post(`/users/${user.handle}/follow`);
      button.disabled = false;
      if (!reply.ok) { toast(Api.message(reply)); return; }
      Object.assign(user, reply.data.user);
      draw();
      options.onChange?.(user);
    });
    return button;
  }

  /* A line for a person: picture, name, @handle, a short description and the follow button. */
  function userRow(user, options = {}) {
    const row = h("div", { class: "user-row" },
      link(`/${user.handle}`, { class: "ur-av", tabindex: "-1", "aria-hidden": "true" }, avatar(user, "md")),
      h("div", { class: "ur-main" },
        link(`/${user.handle}`, { class: "ur-name" }, h("b", {}, user.name, Y.aiTag(user)), h("span", { class: "handle" }, `@${user.handle}`)),
        options.bio !== false && user.bio ? h("p", { class: "ur-bio" }, richText(user.bio)) : null),
      options.action === undefined ? followButton(user) : options.action);
    return row;
  }

  // ---------------------------------------------------------------------------------------- pictures
  async function loadBitmap(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file); } catch (error) { /* fall back to an <img> */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable")); };
      image.src = url;
    });
  }

  const sizeOf = (bitmap) => ({ width: bitmap.naturalWidth || bitmap.width, height: bitmap.naturalHeight || bitmap.height });

  /* Makes a picture ready to send: scaled down (or cut to a shape for avatars and banners) and saved again as JPEG, which also
     drops the hidden information (place, camera) of the original. GIFs are sent as they are. */
  async function prepareImage(file, { max = 1600, crop = null } = {}) {
    if (file.type === "image/gif" && !crop) return file;
    const bitmap = await loadBitmap(file);
    const { width, height } = sizeOf(bitmap);
    let source = { x: 0, y: 0, width, height };
    let target;
    if (crop) {
      source = Core.coverCrop(width, height, crop.width, crop.height);
      const w = Math.min(crop.width, source.width);
      target = { width: w, height: Math.round((w * crop.height) / crop.width) };
    } else {
      target = Core.fitSize(width, height, max);
    }
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(bitmap, source.x, source.y, source.width, source.height, 0, 0, target.width, target.height);
    if (bitmap.close) bitmap.close();
    for (const quality of [0.86, 0.7, 0.55, 0.4]) {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && blob.size <= 4.5 * 1024 * 1024) return blob;
    }
    throw new Error("too big");
  }

  // ------------------------------------------------------------------------------------------- posts
  /* The player of a video in a post: its own controls, the first picture as the poster, a click on it does not open the post. */
  function videoPlayer(item) {
    const ratio = Math.max(0.5, Math.min(1.78, (item.width || 9) / (item.height || 16)));
    const video = h("video", { class: "post-video", src: `${item.url}#t=0.001`, controls: true, playsinline: true, preload: "metadata", "aria-label": item.alt || "Video" });
    video.addEventListener("click", (event) => event.stopPropagation());
    return h("div", { class: "media media-video", style: `aspect-ratio: ${ratio.toFixed(3)}` }, video);
  }

  function mediaGrid(media) {
    if (media[0].video) return videoPlayer(media[0]);
    const grid = h("div", { class: `media m${Math.min(media.length, 3)}` });
    if (media.length === 1 && media[0].gif && media[0].gifId) put(grid, Y.gifStar({ id: media[0].gifId, favorite: !!media[0].gifFavorite }));
    media.slice(0, 3).forEach((item, index) => {
      const ratio = media.length === 1 ? `aspect-ratio: ${Math.max(0.8, Math.min(1.78, item.width / item.height)).toFixed(3)}` : "";
      put(grid, h("button", { class: `media-item${item.gif ? " is-gif" : ""}`, type: "button", style: ratio, "aria-label": item.alt ? `${item.gif ? "GIF" : "Bild"} vergrößern: ${item.alt}` : item.gif ? "GIF vergrößern" : "Bild vergrößern", onclick: (event) => { event.stopPropagation(); Y.viewer(media, index); } },
        h("img", { src: item.url, alt: item.alt || (item.gif ? "GIF" : ""), loading: "lazy", decoding: "async" }), item.gif ? h("span", { class: "gif-badge", "aria-hidden": "true" }, "GIF") : null));
    });
    return grid;
  }

  function quoteCard(quote) {
    if (quote.unavailable) return h("div", { class: "quote gone" }, "Dieser Beitrag ist nicht verfügbar.");
    const card = h("div", { class: "quote", role: "link", tabindex: "0", "aria-label": `Zitierter Beitrag von ${quote.user.name}` },
      h("div", { class: "quote-head" }, avatar(quote.user, "xs"), h("b", {}, quote.user.name), Y.aiTag(quote.user), h("span", { class: "handle" }, `@${quote.user.handle}`), h("span", { class: "dot" }, "·"), timeEl(quote.createdAt)),
      quote.text ? h("div", { class: "post-text" }, richText(quote.text)) : null,
      quote.media && quote.media.length ? (quote.media[0].video ? h("div", { class: "quote-media quote-video" }, icon("playCircle"), "Video") : h("div", { class: "quote-media" }, h("img", { src: quote.media[0].url, alt: quote.media[0].alt || "", loading: "lazy" }))) : null);
    const open = () => Y.navigate(postPath(quote));
    card.addEventListener("click", (event) => { if (!event.target.closest("a")) { event.stopPropagation(); open(); } });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target === card) open(); });
    return card;
  }

  // ---------------------------------------------------------------------------------------------- views
  /* A post counts as seen when at least half of it has been on screen for a moment; the page tells the server in batches, once per post
     and page view, and only for people who are signed in. */
  const seenViews = new Set();
  const viewQueue = new Set();
  let viewTimer = null;

  async function flushViews() {
    viewTimer = null;
    const ids = [...viewQueue].slice(0, 40);
    ids.forEach((id) => viewQueue.delete(id));
    if (ids.length) await Api.post("/posts/views", { ids });
    if (viewQueue.size && !viewTimer) viewTimer = setTimeout(flushViews, 4000);
  }

  function queueView(id) {
    if (!Y.me || seenViews.has(id)) return;
    seenViews.add(id);
    viewQueue.add(id);
    if (!viewTimer) viewTimer = setTimeout(flushViews, 4000);
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden && viewQueue.size) flushViews(); });

  const watcher = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const element = entry.target;
      clearTimeout(element._viewTimer);
      if (entry.isIntersecting) element._viewTimer = setTimeout(() => { queueView(Number(element.dataset.id)); watcher.unobserve(element); }, 900);
    }
  }, { threshold: [0.5] }) : null;

  // ----------------------------------------------------------------------------------------------- polls
  /* The poll of a post: buttons to choose from while it is open and nobody has voted, bars with percentages after that. */
  function pollView(item) {
    const holder = h("div", { class: "poll-holder" });

    async function vote(optionId) {
      if (!Y.requireLogin("Melde dich an, um abzustimmen.")) return;
      const reply = await Api.post(`/posts/${item.id}/vote`, { optionId });
      if (!reply.ok) {
        toast(Api.message(reply));
        const fresh = await Api.get(`/posts/${item.id}`);
        if (fresh.ok && fresh.data.post.poll) { item.poll = fresh.data.post.poll; draw(); }
        return;
      }
      item.poll = reply.data.post.poll;
      draw();
    }

    function draw() {
      const poll = item.poll;
      const left = Core.pollTimeLeft(poll.endsAt);
      const ended = poll.ended || left.ended;
      const open = !ended && !poll.showResults;                  // somebody who may still vote (or has to sign in first)
      const leader = poll.showResults ? Math.max(0, ...poll.options.map((option) => option.votes || 0)) : 0;
      const rows = poll.options.map((option) => {
        if (open) return h("button", { class: "poll-opt", type: "button", onclick: (event) => { event.stopPropagation(); vote(option.id); } }, option.text);
        const votes = option.votes || 0;
        const percent = poll.showResults ? Core.pollPercent(votes, poll.total) : 0;
        return h("div", { class: `poll-row${leader > 0 && votes === leader ? " lead" : ""}${option.mine ? " mine" : ""}`, role: "img", "aria-label": `${option.text}${poll.showResults ? `: ${percent} Prozent` : ""}${option.mine ? ", deine Stimme" : ""}` },
          h("span", { class: "poll-fill", style: `width:${percent}%` }),
          h("span", { class: "poll-label" }, option.text, option.mine ? icon("check") : null),
          poll.showResults ? h("span", { class: "poll-pct" }, `${percent} %`) : null);
      });
      fill(holder, h("div", { class: "poll", role: "group", "aria-label": "Umfrage" }, rows, h("p", { class: "poll-foot" }, `${Core.pollVotes(poll.total)} · ${ended ? "Beendet" : left.text}`)));
    }
    draw();
    return holder;
  }

  // ------------------------------------------------------------------------------------------- dialogs
  /* The people behind a number ("Gefällt mir", "Reposts"): a dialog with a list that loads more as you scroll. */
  function peopleDialog(title, path) {
    const list = pager({ load: Y.listLoader((cursor) => Y.qs(path, { page: cursor || 1 }), "users"), render: (user) => userRow(user), empty: Y.emptyState("Noch niemand", "") });
    const entry = dialog({ title, body: h("div", { class: "people-dialog" }, list.element), onClose: () => list.destroy() });
    list.element.addEventListener("click", (event) => { if (event.target.closest("a")) entry.close(); });
    return entry;
  }

  /* "Per Nachricht senden": pick a person (the people you write with, or search), the link to the post goes to them as a message. */
  function sendPostDialog(item) {
    if (!Y.requireLogin("Melde dich an, um Beiträge zu senden.")) return;
    const address = absolute(postPath(item));
    const note = h("textarea", { class: "field-area", rows: 3, maxlength: 300, placeholder: "Nachricht hinzufügen (freiwillig)", "aria-label": "Nachricht dazu" });
    note.value = shareText(item);
    const search = h("input", { class: "field", type: "search", placeholder: "Nach Namen oder @Nutzernamen suchen", "aria-label": "Person suchen", autocomplete: "off", maxlength: 50 });
    const results = h("div", { class: "pick-list" }, Y.skeleton(1));
    let entry = null;
    let timer = null;
    let token = 0;

    async function send(user) {
      const text = Core.cleanText(`${Core.cleanText(note.value)}\n${address}`);
      const reply = await Api.post(`/messages/${user.handle}`, { text });
      if (!reply.ok) { toast(Api.message(reply)); return; }
      entry.close();
      toast(`An @${user.handle} gesendet`, { label: "Ansehen", run: () => Y.navigate(`/messages/${user.handle}`) });
    }
    const row = (user) => h("button", { class: "pick", type: "button", onclick: () => send(user) }, avatar(user, "md"), h("span", { class: "pick-main" }, h("b", {}, user.name), h("span", { class: "handle" }, `@${user.handle}`)));
    function show(users, empty) { fill(results, ...(users.length ? users.map(row) : [h("p", { class: "muted" }, empty)])); }

    (async () => {
      const reply = Y.chatLock && Y.chatLock.locked() ? { ok: false } : await Api.get("/messages");     // (with the chat lock on, the list of chats stays shut)
      if (token) return;
      show(reply.ok ? reply.data.items.map((entry) => entry.user) : [], "Suche eine Person, um ihr den Beitrag zu schicken.");
    })();
    search.addEventListener("input", () => {
      clearTimeout(timer);
      const term = Core.cleanText(search.value).replace(/^@/, "");
      const mine = ++token;
      if (term.length < 2) { show([], "Tippe mindestens zwei Zeichen."); return; }
      timer = setTimeout(async () => {
        const reply = await Api.get(`/search?q=${encodeURIComponent(term)}&type=people`);
        if (mine !== token) return;
        show(reply.ok ? reply.data.users.filter((user) => !user.isMe) : [], reply.ok ? "Niemanden gefunden." : Api.message(reply));
      }, 280);
    });
    entry = dialog({ title: "Per Nachricht senden", body: h("div", {}, note, h("div", { class: "field-label" }, search), results), initialFocus: search });
    return entry;
  }

  /* The "Fact Check" under a post whose claim is wrong (like the notes of X): written by Nex, the AI, which can be wrong, so there is a way to say so. */
  function factBox(item) {
    const note = item.factCheck;
    return h("div", { class: `factcheck ${note.status}`, role: "note" },
      h("div", { class: "fc-head" }, icon("shield"), h("b", {}, note.status === "false" ? "Fact Check: falsch" : "Fact Check: irreführend")),
      h("p", { class: "fc-note" }, note.note),
      h("p", { class: "fc-foot" }, "Von Nex, der KI, geprüft. Das kann ein Irrtum sein. ", h("button", { class: "linklike", type: "button", onclick: (event) => { event.stopPropagation(); reportDialog({ postId: item.id, factcheck: true }); } }, "Falsch? Melden")));
  }

  /* One post, as a big rounded card with a little pill on its top edge (like, reply, share). Options: detail (the big version on its own page),
     noReplyLine, onDelete(card), onReply(post), onBookmark(on, card). */
  function postCard(item, options = {}) {
    if (item.deleted) {
      return h("article", { class: "post gone" }, h("p", {}, "Dieser Beitrag wurde gelöscht."));
    }
    const detail = !!options.detail;
    const mine = !!(Y.me && Y.me.handle === item.user.handle);
    const card = h("article", { class: `post${detail ? " detail" : ""}`, "data-id": String(item.id), "data-cursor": String(item.cursor || item.id), tabindex: "0", "aria-label": `Beitrag von ${item.user.name}` });
    const state = { viewer: { ...item.viewer }, counts: { ...item.counts } };

    const likeButton = pillButton({ kind: "like", label: "Gefällt mir", off: "heart", on: "heartFill" });
    const replyButton = pillButton({ kind: "reply", label: "Kommentare", off: "reply" });
    const repostButton = pillButton({ kind: "repost", label: "Reposten", off: "repost" });
    repostButton.setAttribute("aria-haspopup", "menu");
    const moreButton = h("button", { class: "act-btn more", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, h("span", { class: "pill-ic" }, icon("more")));
    const sendButton = h("button", { class: "act-btn send", type: "button", "aria-label": "Senden", "aria-haspopup": "menu" }, h("span", { class: "pill-ic" }, icon("send")));
    const stats = h("div", { class: "post-stats" });
    const foot = h("div", { class: "post-actions", role: "group", "aria-label": "Aktionen" }, replyButton, repostButton, likeButton, moreButton, sendButton);

    function draw() {
      likeButton.draw(state.viewer.liked, state.counts.likes, state.viewer.liked ? "Gefällt mir nicht mehr" : "Gefällt mir");
      replyButton.draw(false, state.counts.replies, "Kommentare");
      repostButton.draw(state.viewer.reposted, state.counts.reposts, state.viewer.reposted ? "Repost, Menü öffnen" : "Reposten");
      repostButton.classList.toggle("on", !!state.viewer.reposted);
      const views = item.views || 0;
      if (detail) {
        fill(stats,
          views ? h("span", {}, h("b", {}, Core.formatCount(views)), ` ${views === 1 ? "Aufruf" : "Aufrufe"}`) : null,
          state.counts.reposts ? h("button", { class: "stat-link", type: "button", onclick: () => peopleDialog("Reposts von", `/posts/${item.id}/reposts`) }, h("b", {}, Core.formatCount(state.counts.reposts)), ` ${state.counts.reposts === 1 ? "Repost" : "Reposts"}`) : null,
          state.counts.likes ? h("button", { class: "stat-link", type: "button", onclick: () => peopleDialog("Gefällt mir von", `/posts/${item.id}/likes`) }, h("b", {}, Core.formatCount(state.counts.likes)), " Gefällt mir") : null,
          state.counts.replies ? h("span", {}, h("b", {}, Core.formatCount(state.counts.replies)), ` ${state.counts.replies === 1 ? "Antwort" : "Antworten"}`) : null);
        stats.hidden = !stats.children.length;
      }
    }

    async function react(on, path, flip) {
      if (!Y.requireLogin("Melde dich an, um mitzumachen.")) return;
      const before = { viewer: { ...state.viewer }, counts: { ...state.counts } };
      flip(on);
      draw();
      const reply = on ? await Api.post(path) : await Api.del(path);
      if (!reply.ok) {
        state.viewer = before.viewer;
        state.counts = before.counts;
        draw();
        toast(Api.message(reply));
        return;
      }
      if (reply.data.counts) state.counts = reply.data.counts;
      draw();
    }

    const toggleLike = () => react(!state.viewer.liked, `/posts/${item.id}/like`, (on) => { state.viewer.liked = on; state.counts.likes = Math.max(0, state.counts.likes + (on ? 1 : -1)); });
    const toggleRepost = () => react(!state.viewer.reposted, `/posts/${item.id}/repost`, (on) => { state.viewer.reposted = on; state.counts.reposts = Math.max(0, state.counts.reposts + (on ? 1 : -1)); });
    const toggleBookmark = async () => {
      if (!Y.requireLogin("Melde dich an, um Lesezeichen zu setzen.")) return;
      const on = !state.viewer.bookmarked;
      state.viewer.bookmarked = on;
      const reply = on ? await Api.post(`/posts/${item.id}/bookmark`) : await Api.del(`/posts/${item.id}/bookmark`);
      if (!reply.ok) { state.viewer.bookmarked = !on; toast(Api.message(reply)); return; }
      toast(on ? "Zu deinen Lesezeichen hinzugefügt" : "Aus den Lesezeichen entfernt");
      options.onBookmark?.(on, card);
    };

    likeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const willLike = !state.viewer.liked;
      toggleLike();
      if (!Y.me) return;
      if (willLike) { const box = likeButton.getBoundingClientRect(); Y.likeBurst(event.clientX || box.left + box.width / 2, event.clientY || box.top + box.height / 2, { size: 56 }); Y.sound.play("like"); } else Y.sound.play("unlike");
    });
    const likeByTap = (x, y) => { if (!state.viewer.liked) toggleLike(); if (Y.me) { Y.likeBurst(x, y); Y.sound.play("like"); } };
    replyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!Y.requireLogin("Melde dich an, um zu antworten.")) return;
      Y.compose({ replyTo: item, onPosted: (post) => { state.counts.replies += 1; draw(); options.onReply?.(post); } });
    });
    repostButton.addEventListener("click", (event) => {
      event.stopPropagation();
      menu(repostButton, [
        { label: state.viewer.reposted ? "Repost rückgängig machen" : "Reposten", icon: "repost", run: () => { if (Y.requireLogin("Melde dich an, um zu reposten.")) toggleRepost(); } },
        { label: "Zitieren", icon: "pencil", run: () => { if (Y.requireLogin("Melde dich an, um zu zitieren.")) Y.compose({ quoteOf: item }); } },
      ]);
    });
    sendButton.addEventListener("click", (event) => {
      event.stopPropagation();
      menu(sendButton, [
        { label: state.viewer.bookmarked ? "Lesezeichen entfernen" : "Lesezeichen setzen", icon: "bookmark", run: toggleBookmark },
        ...shareItems(item),
      ]);
    });
    moreButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const other = item.user.handle;
      menu(moreButton, [
        item.text ? { label: "Mit Nex erklären", icon: "sparkle", run: () => Y.navigate(Core.buildPath({ name: "nex", post: item.id })) } : null,
        mine && !item.replyTo ? (Y.me.pinnedPostId === item.id
          ? { label: "Von deinem Profil lösen", icon: "pushpin", run: async () => { const reply = await Api.del(`/posts/${item.id}/pin`); if (reply.ok) { Y.me.pinnedPostId = reply.data.pinnedPostId; toast("Der Beitrag ist nicht mehr angeheftet."); Y.refreshView?.(); } else toast(Api.message(reply)); } }
          : { label: "An dein Profil anheften", icon: "pushpin", run: async () => { const reply = await Api.post(`/posts/${item.id}/pin`); if (reply.ok) { Y.me.pinnedPostId = reply.data.pinnedPostId; toast("Der Beitrag ist an dein Profil angeheftet.", { label: "Ansehen", run: () => Y.navigate(`/${Y.me.handle}`) }); Y.refreshView?.(); } else toast(Api.message(reply)); } }) : null,
        mine ? { label: "Beitrag löschen", icon: "trash", danger: true, run: async () => {
          if (!(await confirmBox({ title: "Beitrag löschen?", text: "Das lässt sich nicht rückgängig machen.", yes: "Löschen", danger: true }))) return;
          const reply = await Api.del(`/posts/${item.id}`);
          if (!reply.ok) { toast(Api.message(reply)); return; }
          toast("Dein Beitrag wurde gelöscht.");
          if (options.onDelete) options.onDelete(card); else card.remove();
        } } : null,
        Y.me && !mine ? { label: `@${other} stummschalten`, icon: "mute", run: async () => { const reply = await Api.post(`/users/${other}/mute`); toast(reply.ok ? `@${other} ist stummgeschaltet.` : Api.message(reply)); if (reply.ok) card.remove(); } } : null,
        Y.me && !mine ? { label: `@${other} blockieren`, icon: "block", danger: true, run: async () => {
          if (!(await confirmBox({ title: `@${other} blockieren?`, text: "Ihr seht die Beiträge des anderen nicht mehr und könnt euch nicht mehr folgen oder schreiben.", yes: "Blockieren", danger: true }))) return;
          const reply = await Api.post(`/users/${other}/block`);
          toast(reply.ok ? `@${other} ist blockiert.` : Api.message(reply));
          if (reply.ok) card.remove();
        } } : null,
        !mine ? { label: "Beitrag melden", icon: "flag", danger: true, run: () => reportDialog({ postId: item.id }) } : null,
      ]);
    });

    const head = h("div", { class: "post-head" },
      link(`/${item.user.handle}`, { class: "post-av", tabindex: "-1", "aria-hidden": "true" }, avatar(item.user, "sm")),
      h("div", { class: "post-who" },
        link(`/${item.user.handle}`, { class: "post-name" }, item.user.name, Y.aiTag(item.user)),
        h("span", { class: "post-meta" }, h("span", { class: "handle" }, `@${item.user.handle}`), detail ? null : [h("span", { class: "dot" }, "·"), link(postPath(item), { class: "post-time" }, timeEl(item.createdAt))])));

    const body = h("div", { class: "post-body" },
      item.replyTo && item.replyTo.handle && !options.noReplyLine ? h("p", { class: "reply-line" }, "Antwort an ", link(`/${item.replyTo.handle}`, { class: "tok" }, `@${item.replyTo.handle}`)) : null,
      item.text ? h("div", { class: "post-text" }, richText(item.text)) : null,
      item.media && item.media.length ? mediaGrid(item.media) : null,
      item.camId && Y.tryButton ? Y.tryButton(item.camId) : null,
      item.poll ? pollView(item) : null,
      item.quote ? quoteCard(item.quote) : null,
      item.factCheck ? factBox(item) : null);

    draw();

    if (item.pinned) put(card, h("div", { class: "post-context" }, h("span", { class: "ctx-ic" }, icon("pushpin")), "Angeheftet"));
    if (item.repostedBy) {
      const own = Y.me && Y.me.handle === item.repostedBy.handle;
      put(card, h("div", { class: "post-context" }, h("span", { class: "ctx-ic" }, icon("repost")), own ? "Du hast repostet" : link(`/${item.repostedBy.handle}`, {}, `${item.repostedBy.name} hat repostet`)));
    }
    put(card, head, body);

    if (detail) {
      put(card, h("div", { class: "detail-time" }, timeEl(item.createdAt, true)), stats, foot);
      queueView(item.id);
    } else {
      put(card, foot);
      if (watcher && !item.deleted) watcher.observe(card);
      const open = () => { Y.sound.play("open"); Y.navigate(postPath(item)); };
      let openTimer = 0;
      let doubled = 0;
      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button, .menu, .quote, .poll, .post-actions")) return;
        if (window.getSelection && String(window.getSelection())) return;
        if (performance.now() - doubled < 450) return;                  // the second tap of a double tap
        clearTimeout(openTimer);
        if (event.target.closest(".post-body")) openTimer = setTimeout(open, 260);      // (a moment of waiting: a second tap on the text is a like)
        else open();
      });
      Y.onDoubleTap(body, (x, y) => { clearTimeout(openTimer); doubled = performance.now(); likeByTap(x, y); }, { ignore: "a, button, .menu, .quote, .poll, video" });
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target === card) open(); });
    }
    if (detail) Y.onDoubleTap(body, (x, y) => likeByTap(x, y), { ignore: "a, button, .menu, .quote, .poll, video" });
    card.refresh = draw;
    card.bumpReplies = (n = 1) => { state.counts.replies = Math.max(0, state.counts.replies + n); draw(); };
    return card;
  }

  // ---------------------------------------------------------------------------------------- composer
  function ring() {
    const NS = "http://www.w3.org/2000/svg";
    const make = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
    const svg = make("svg", { viewBox: "0 0 24 24", class: "ring", "aria-hidden": "true" });
    const track = make("circle", { cx: 12, cy: 12, r: 10, class: "ring-track" });
    const bar = make("circle", { cx: 12, cy: 12, r: 10, class: "ring-bar", transform: "rotate(-90 12 12)" });
    put(svg, track, bar);
    const length = 2 * Math.PI * 10;
    bar.style.strokeDasharray = String(length);
    return { svg, set(fraction) { bar.style.strokeDashoffset = String(length * (1 - Math.max(0, Math.min(1, fraction)))); } };
  }

  /* The box to write a post. Options: replyTo, quoteOf (posts), placeholder, compact, autofocus, draftKey, text (to start with), onPosted(post), label. */
  function composer(options = {}) {
    const { replyTo, quoteOf, compact, onPosted } = options;
    const draftKey = `yipi.draft.${options.draftKey || (replyTo ? `r${replyTo.id}` : quoteOf ? `q${quoteOf.id}` : "new")}`;
    const picked = [];                                   // {blob, url, alt, uploaded, gif}: up to 3 photos, or one GIF
    const template = !!options.template;                 // the big template for a new post: the field "Text", hashtags as chips below
    let poll = null;                                     // {options: [...], minutes} while a poll is being written (instead of pictures)
    let busy = false;

    const textarea = h("textarea", { class: "compose-text", rows: 1, maxlength: 1000, placeholder: options.placeholder || (replyTo ? "Deine Antwort" : quoteOf ? "Füge einen Kommentar hinzu" : "Was gibt's Neues?"), "aria-label": replyTo ? "Deine Antwort" : "Text deines Beitrags" });
    const previews = h("div", { class: "compose-media", hidden: true });
    const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const gauge = ring();
    const left = h("span", { class: "ring-left" });
    const submit = h("button", { class: "btn primary post-btn", type: "button", disabled: true }, options.label || (replyTo ? "Antworten" : "Posten"));
    const photoButton = h("button", { class: "icon-btn tool", type: "button", "aria-label": "Foto hinzufügen" }, icon("image"));
    const gifButton = h("button", { class: "icon-btn tool", type: "button", "aria-label": "GIF hinzufügen", "aria-haspopup": "dialog" }, icon("gif"));
    const emojiButton = h("button", { class: "icon-btn tool", type: "button", "aria-label": "Emoji einfügen", "aria-haspopup": "dialog" }, icon("emoji"));
    const pollButton = h("button", { class: "icon-btn tool", type: "button", "aria-label": "Umfrage hinzufügen", hidden: !!(replyTo || quoteOf) }, icon("poll"));
    const pollBox = h("div", { class: "poll-editor", hidden: true });
    const tagBox = template ? Y.hashtagEditor({ onChange: () => update(), room: () => Core.MAX_POST - Core.charCount(textarea.value) - 1 }) : null;
    const fullText = () => {
      const text = Core.cleanText(textarea.value);
      return tagBox && tagBox.tags().length ? Core.cleanText(`${text}\n\n${tagBox.text()}`) : text;
    };

    function drawPoll() {
      pollBox.hidden = !poll;
      if (!poll) { fill(pollBox); return; }
      const rows = poll.options.map((value, index) => {
        const input = h("input", { class: "field", maxlength: Core.MAX_POLL_OPTION, placeholder: `Antwort ${index + 1}${index >= Core.POLL_OPTIONS[0] ? " (freiwillig)" : ""}`, "aria-label": `Antwort ${index + 1}`, autocomplete: "off" });
        input.value = value;
        input.addEventListener("input", () => { poll.options[index] = input.value; update(); });
        return h("div", { class: "poll-input" }, input,
          index >= Core.POLL_OPTIONS[0] ? h("button", { class: "icon-btn tiny", type: "button", "aria-label": `Antwort ${index + 1} entfernen`, onclick: () => { poll.options.splice(index, 1); drawPoll(); update(); } }, icon("close")) : null);
      });
      const length = h("select", { class: "field poll-length", "aria-label": "Dauer der Umfrage" }, Core.POLL_LENGTHS.map(([minutes, label]) => h("option", { value: String(minutes) }, label)));
      length.value = String(poll.minutes);
      length.addEventListener("change", () => { poll.minutes = Number(length.value); });
      fill(pollBox,
        h("div", { class: "poll-head" }, h("b", {}, "Umfrage"), h("button", { class: "btn ghost small", type: "button", onclick: () => { poll = null; drawPoll(); update(); } }, "Entfernen")),
        rows,
        poll.options.length < Core.POLL_OPTIONS[1] ? h("button", { class: "poll-add", type: "button", onclick: () => { poll.options.push(""); drawPoll(); update(); pollBox.querySelectorAll("input")[poll.options.length - 1]?.focus(); } }, icon("plus"), "Antwort hinzufügen") : null,
        h("label", { class: "poll-duration" }, h("span", {}, "Dauer"), length));
    }

    function update() {
      const text = fullText();
      const count = Core.charCount(text);
      const state = Core.counterState(text);
      gauge.set(count / Core.MAX_POST);
      gauge.svg.dataset.state = state;
      left.textContent = state === "ok" ? "" : String(Core.MAX_POST - count);
      left.dataset.state = state;
      const pollReady = !poll || (count > 0 && Core.pollAnswers(poll.options).valid);        // a poll needs its question and two answers
      submit.disabled = busy || state === "over" || (!count && !picked.length && !poll) || !pollReady;
      photoButton.disabled = busy || !!poll || (picked.length >= Core.MAX_MEDIA && !picked.some((entry) => entry.gif));
      gifButton.disabled = busy || !!poll;
      pollButton.disabled = busy || picked.length > 0;
      pollButton.classList.toggle("on", !!poll);
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, compact ? 220 : 340)}px`;
      try { if (textarea.value) sessionStorage.setItem(draftKey, textarea.value); else sessionStorage.removeItem(draftKey); } catch (error) { /* storage blocked */ }
    }

    function drawPreviews() {
      previews.hidden = !picked.length;
      previews.className = `compose-media m${Math.min(picked.length, 3)}`;
      fill(previews, ...picked.map((entry, index) => h("div", { class: "pv" },
        h("img", { src: entry.url, alt: entry.alt || "Vorschau" }),
        h("button", { class: "pv-x", type: "button", "aria-label": entry.gif ? "GIF entfernen" : "Foto entfernen", onclick: () => { URL.revokeObjectURL(entry.url); picked.splice(index, 1); drawPreviews(); update(); } }, icon("close")),
        entry.gif ? h("span", { class: "pv-alt gif-badge", "aria-hidden": "true" }, "GIF")
                  : h("button", { class: `pv-alt${entry.alt ? " set" : ""}`, type: "button", onclick: () => altDialog(entry) }, entry.alt ? "ALT ✓" : "+ ALT"))));
    }

    function altDialog(entry) {
      const field = h("textarea", { class: "field-area", rows: 4, maxlength: 200, "aria-label": "Bildbeschreibung", placeholder: "Beschreibe das Bild für Menschen, die es nicht sehen können." }, entry.alt || "");
      field.value = entry.alt || "";
      dialog({ title: "Bildbeschreibung", body: h("div", {}, h("img", { class: "alt-preview", src: entry.url, alt: "" }), field), actions: [{ label: "Speichern", kind: "primary", run: () => { entry.alt = Core.cleanText(field.value).slice(0, 200); drawPreviews(); } }] });
    }

    async function addFiles(files) {
      if (poll) { toast("Zu einer Umfrage gehören keine Fotos."); return; }
      for (const file of files) {
        if (file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm|mkv|avi|wmv|3gp|mpe?g)$/i.test(file.name || "")) { toast("Ein Video lädst du über das Plus und „Video“ hoch."); continue; }
        if (picked.some((entry) => entry.gif)) picked.splice(0, picked.length);          // photos take the place of a GIF
        if (picked.length >= Core.MAX_MEDIA) { toast("Mehr als 3 Fotos gehen nicht."); break; }
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { toast(Api.MESSAGES.bad_image); continue; }
        if (file.type === "image/gif" && file.size > 5 * 1024 * 1024) { toast("Das GIF ist zu groß (höchstens 5 MB)."); continue; }
        if (file.type === "image/gif" && picked.length) { toast(Api.MESSAGES.gif_alone); continue; }
        try {
          const blob = await prepareImage(file);
          picked.push({ blob, url: URL.createObjectURL(blob), alt: "", uploaded: null, name: file.name, gif: file.type === "image/gif" });
          if (file.type === "image/gif") break;
        } catch (error) {
          toast("Dieses Foto konnte nicht gelesen werden.");
        }
      }
      drawPreviews();
      update();
    }

    /* A GIF of the library: its bytes are copied into a picture of the sender (on the server), and that picture goes into the post. */
    async function addGif(gif) {
      if (poll) { toast("Zu einer Umfrage gehört kein GIF."); return; }
      const reply = await Api.post(`/gifs/${gif.id}/use`);
      if (!reply.ok) { toast(Api.message(reply)); return; }
      picked.forEach((entry) => URL.revokeObjectURL(entry.url));
      picked.splice(0, picked.length, { blob: null, url: reply.data.media.url, alt: gif.title || "GIF", uploaded: reply.data.media.id, name: "", gif: true });
      drawPreviews();
      update();
      textarea.focus();
    }

    function clear() {
      picked.forEach((entry) => URL.revokeObjectURL(entry.url));
      picked.length = 0;
      textarea.value = "";
      tagBox?.clear();
      poll = null;
      drawPoll();
      drawPreviews();
      update();
    }

    async function send() {
      const text = fullText();
      if (busy || (!text && !picked.length) || Core.charCount(text) > Core.MAX_POST) return;
      const answers = poll ? Core.pollAnswers(poll.options) : null;
      if (answers && (!answers.valid || !text)) { toast(answers.problem || "Eine Umfrage braucht eine Frage."); return; }
      busy = true;
      submit.disabled = true;
      submit.classList.add("busy");
      update();
      const ids = [];
      for (const entry of picked) {
        if (!entry.uploaded) {
          const up = await Api.upload(entry.blob, { alt: entry.alt || "" });
          if (!up.ok) { busy = false; submit.classList.remove("busy"); submit.textContent = options.label || (replyTo ? "Antworten" : "Posten"); toast(Api.message(up)); update(); return; }
          entry.uploaded = up.data.media.id;
        }
        ids.push(entry.uploaded);
      }
      const body = { text, media: ids };
      if (answers) body.poll = { options: answers.options, minutes: poll.minutes };
      if (replyTo) body.replyTo = replyTo.id;
      if (quoteOf) body.quoteOf = quoteOf.id;
      const reply = await Api.post("/posts", body);
      busy = false;
      submit.classList.remove("busy");
      submit.textContent = options.label || (replyTo ? "Antworten" : "Posten");
      if (!reply.ok) { toast(Api.message(reply)); update(); return; }
      clear();
      onPosted?.(reply.data.post);
    }

    textarea.addEventListener("input", update);
    textarea.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); send(); } });
    textarea.addEventListener("paste", (event) => {
      const files = [...(event.clipboardData ? event.clipboardData.files : [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) { event.preventDefault(); addFiles(files); }
    });
    submit.addEventListener("click", send);
    photoButton.addEventListener("click", () => picker.click());
    pollButton.addEventListener("click", () => {
      poll = poll ? null : { options: ["", ""], minutes: 1440 };
      drawPoll();
      update();
      if (poll) pollBox.querySelector("input")?.focus();
    });
    gifButton.addEventListener("click", () => Y.gifPicker({ onPick: addGif }));
    picker.addEventListener("change", () => { addFiles([...picker.files]); picker.value = ""; });
    emojiButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const pop = h("div", { class: "emoji-pop", role: "dialog", "aria-label": "Emojis" }, EMOJIS.map((emoji) => h("button", { class: "emoji", type: "button", onclick: () => {
        textarea.focus();
        textarea.setRangeText(emoji, textarea.selectionStart, textarea.selectionEnd, "end");
        update();
      } }, emoji)));
      pop.classList.add("menu", "emoji-menu");
      Y.floating(emojiButton, pop, { arrows: false });
    });

    const bar = h("div", { class: "compose-bar" }, h("div", { class: "tools" }, photoButton, gifButton, pollButton, emojiButton, picker),
      h("div", { class: "send" }, left, gauge.svg, submit));
    const root = template
      ? h("div", { class: "composer template" },
        h("div", { class: "field-head" }, h("label", { class: "field-title", for: "post-text" }, "Text"), h("span", { class: "hint" }, "bis zu 280 Zeichen")),
        textarea, previews, pollBox, tagBox.element, bar)
      : h("div", { class: `composer${compact ? " compact" : ""}` }, avatar(Y.me, "md"), h("div", { class: "compose-main" }, textarea, previews, pollBox, bar));
    if (template) textarea.id = "post-text";
    root.addEventListener("dragover", (event) => { if ([...(event.dataTransfer ? event.dataTransfer.types : [])].includes("Files")) { event.preventDefault(); root.classList.add("drop"); } });
    root.addEventListener("dragleave", () => root.classList.remove("drop"));
    root.addEventListener("drop", (event) => { root.classList.remove("drop"); if (event.dataTransfer && event.dataTransfer.files.length) { event.preventDefault(); addFiles([...event.dataTransfer.files]); } });
    if (options.text) textarea.value = options.text;
    else { try { const draft = sessionStorage.getItem(draftKey); if (draft) textarea.value = draft; } catch (error) { /* storage blocked */ } }
    update();
    if (options.autofocus) setTimeout(() => textarea.focus(), 0);
    root.focusText = () => textarea.focus();
    root.send = send;
    return root;
  }

  /* The dialog to write a post, a reply or a quote. */
  Y.compose = function compose({ replyTo, quoteOf, onPosted, text } = {}) {
    if (!Y.requireLogin("Melde dich an, um zu posten.")) return null;
    const target = replyTo || quoteOf;
    let entry;
    const box = composer({
      replyTo, quoteOf, autofocus: true, text, template: !target,
      onPosted: (post) => {
        entry.close();
        onPosted?.(post);
        Y.onPosted?.(post, { replyTo, quoteOf });
        toast(replyTo ? "Deine Antwort wurde gesendet." : "Dein Beitrag wurde gesendet.", { label: "Anzeigen", run: () => Y.navigate(postPath(post)) });
      },
    });
    const context = target ? h("div", { class: "compose-context" }, h("div", { class: "cc-line" }, avatar(target.user, "sm")),
      h("div", {}, h("div", { class: "cc-who" }, h("b", {}, target.user.name), h("span", { class: "handle" }, ` @${target.user.handle}`)), target.text ? h("div", { class: "post-text" }, richText(target.text.length > 280 ? target.text.slice(0, 280) : target.text)) : null,
        replyTo ? h("p", { class: "reply-line" }, "Antwort an ", h("span", { class: "tok" }, `@${target.user.handle}`)) : null)) : null;
    entry = dialog({ title: target ? undefined : "Neuer Beitrag", label: replyTo ? "Antworten" : quoteOf ? "Zitieren" : "Neuer Beitrag", body: h("div", { class: "compose-dialog" }, replyTo ? context : null, box, quoteOf ? h("div", { class: "quote-preview" }, context) : null), initialFocus: box.querySelector("textarea") });
    return entry;
  };

  Object.assign(Y, { queueView, mediaGrid, shareItems, shareText, postCard, composer, userRow, followButton, reportDialog, prepareImage, copyLink, postPath, peopleDialog, sendPostDialog });
})();
