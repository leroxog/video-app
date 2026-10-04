/* yipi components: the parts that make the page -- a Yip (post card with its buttons and menus), the box to write a Yip
   (with pictures, emojis and the ring that counts characters), a row for a person with its follow button, and the dialogs
   to compose and to report. Pictures are made smaller in the browser before they are sent (which also removes where and
   with what they were taken). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, timeEl, toast, dialog, confirmBox, menu } = Y;

  const REASONS = [
    ["spam", "Spam"], ["abuse", "Belästigung oder Beleidigung"], ["hate", "Hass oder Hetze"], ["violence", "Gewalt oder Drohungen"],
    ["illegal", "Illegale Inhalte"], ["self_harm", "Selbstverletzung"], ["other", "Etwas anderes"],
  ];
  const EMOJIS = ["😀", "😂", "🤣", "😊", "😍", "🥰", "😘", "😎", "🤩", "🥳", "😅", "😇", "🙂", "😉", "😋", "🤔", "🤗", "😴", "😭", "😢", "😡", "🤯", "😱", "🥺",
    "👍", "👎", "👏", "🙌", "🙏", "💪", "👀", "🤝", "✌️", "👋", "🤞", "🫶", "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "🔥", "✨", "🎉", "🎂",
    "⭐", "💯", "✅", "❌", "⚡", "🌈", "☀️", "🌙", "🌸", "🌹", "🍀", "🍕", "🍔", "🍟", "🍩", "🍫", "☕", "🍺", "🎵", "🎮", "⚽", "🏀", "🚀", "💡",
    "📚", "💻", "📱", "🎬", "🐶", "🐱", "🐼", "🦊", "🦄", "🐢", "🌍", "🏠", "🚲", "✈️", "🎁", "🤖"];

  const postPath = (item) => `/${item.user.handle}/status/${item.id}`;
  const absolute = (path) => `${location.origin}${path}`;

  // ------------------------------------------------------------------------------------ small pieces
  /* A round button of the row under a Yip. `draw(active, count)` fills in icon and number. */
  function actionButton({ kind, label, off, on }) {
    const iconBox = h("span", { class: "act-icon" });
    const number = h("span", { class: "act-count" });
    const button = h("button", { class: `act ${kind}`, type: "button", "aria-label": label }, iconBox, number);
    button.draw = (active, count, text) => {
      button.classList.toggle("on", !!active);
      if (on) button.setAttribute("aria-pressed", String(!!active));
      fill(iconBox, icon(active && on ? on : off));
      number.textContent = count ? Core.formatCount(count) : "";
      button.setAttribute("aria-label", `${text || label}${count ? `, ${count}` : ""}`);
    };
    return button;
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

  function reportDialog({ postId, handle }) {
    if (!Y.requireLogin("Melde dich an, um etwas zu melden.")) return;
    let reason = "";
    const note = h("textarea", { class: "field-area", rows: 3, maxlength: 300, placeholder: "Möchtest du etwas dazu sagen? (freiwillig)", "aria-label": "Anmerkung" });
    const choices = REASONS.map(([value, text]) => h("label", { class: "choice" }, h("input", { type: "radio", name: "reason", value, onchange: () => { reason = value; entry.box.querySelector(".dialog-actions .btn").disabled = false; } }), h("span", {}, text)));
    const entry = dialog({
      title: postId ? "Yip melden" : `@${handle} melden`,
      body: h("div", { class: "report" }, h("p", { class: "dialog-text" }, "Warum meldest du das?"), h("div", { class: "choices" }, choices), note),
      actions: [{ label: "Melden", kind: "primary", run: async () => {
        if (!reason) return false;
        const reply = await Api.post("/reports", { postId, handle: postId ? undefined : handle, reason, note: note.value });
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
        : user.followedByMe ? [h("span", { class: "t-on" }, "Folge ich"), h("span", { class: "t-hover" }, "Entfolgen")] : [h("span", {}, user.followsMe ? "Auch folgen" : "Folgen")]));
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
      Y.followChanged?.(!!button.closest(".rail"));
    });
    return button;
  }

  /* A line for a person: picture, name, @handle, a short description and the follow button. */
  function userRow(user, options = {}) {
    const row = h("div", { class: "user-row" },
      link(`/${user.handle}`, { class: "ur-av", tabindex: "-1", "aria-hidden": "true" }, avatar(user, "md")),
      h("div", { class: "ur-main" },
        link(`/${user.handle}`, { class: "ur-name" }, h("b", {}, user.name), h("span", { class: "handle" }, `@${user.handle}`)),
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

  // ------------------------------------------------------------------------------------------- Yips
  function mediaGrid(media) {
    const grid = h("div", { class: `media m${Math.min(media.length, 4)}` });
    media.slice(0, 4).forEach((item, index) => {
      const ratio = media.length === 1 ? `aspect-ratio: ${Math.max(0.8, Math.min(1.78, item.width / item.height)).toFixed(3)}` : "";
      put(grid, h("button", { class: "media-item", type: "button", style: ratio, "aria-label": item.alt ? `Bild vergrößern: ${item.alt}` : "Bild vergrößern", onclick: (event) => { event.stopPropagation(); Y.viewer(media, index); } },
        h("img", { src: item.url, alt: item.alt || "", loading: "lazy", decoding: "async" })));
    });
    return grid;
  }

  function quoteCard(quote) {
    if (quote.unavailable) return h("div", { class: "quote gone" }, "Dieser Yip ist nicht verfügbar.");
    const card = h("div", { class: "quote", role: "link", tabindex: "0", "aria-label": `Zitierter Yip von ${quote.user.name}` },
      h("div", { class: "quote-head" }, avatar(quote.user, "xs"), h("b", {}, quote.user.name), h("span", { class: "handle" }, `@${quote.user.handle}`), h("span", { class: "dot" }, "·"), timeEl(quote.createdAt)),
      quote.text ? h("div", { class: "post-text" }, richText(quote.text)) : null,
      quote.media && quote.media.length ? h("div", { class: "quote-media" }, h("img", { src: quote.media[0].url, alt: quote.media[0].alt || "", loading: "lazy" })) : null);
    const open = () => Y.navigate(postPath(quote));
    card.addEventListener("click", (event) => { if (!event.target.closest("a")) { event.stopPropagation(); open(); } });
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target === card) open(); });
    return card;
  }

  /* One Yip. Options: detail (the big version on its own page), noReplyLine, onDelete(card), onReply(post). */
  function postCard(item, options = {}) {
    if (item.deleted) {
      return h("article", { class: "post gone" }, h("p", {}, "Dieser Yip wurde gelöscht."));
    }
    const detail = !!options.detail;
    const mine = !!(Y.me && Y.me.handle === item.user.handle);
    const card = h("article", { class: `post${detail ? " detail" : ""}`, "data-id": String(item.id), "data-cursor": String(item.cursor || item.id), tabindex: "0", "aria-label": `Yip von ${item.user.name}` });
    const state = { viewer: { ...item.viewer }, counts: { ...item.counts } };

    const replyButton = actionButton({ kind: "reply", label: "Antworten", off: "reply" });
    const repostButton = actionButton({ kind: "repost", label: "Reposten", off: "repost" });
    const likeButton = actionButton({ kind: "like", label: "Gefällt mir", off: "heart", on: "heartFill" });
    const bookmarkButton = actionButton({ kind: "bookmark", label: "Lesezeichen", off: "bookmark", on: "bookmarkFill" });
    const shareButton = h("button", { class: "act share", type: "button", "aria-label": "Teilen" }, h("span", { class: "act-icon" }, icon("share")));
    const moreButton = h("button", { class: "more icon-btn small", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, icon("more"));
    const stats = h("div", { class: "post-stats" });

    function draw() {
      replyButton.draw(false, detail ? 0 : state.counts.replies);
      repostButton.draw(state.viewer.reposted, detail ? 0 : state.counts.reposts, state.viewer.reposted ? "Repost rückgängig machen" : "Reposten");
      repostButton.classList.toggle("on", state.viewer.reposted);
      likeButton.draw(state.viewer.liked, detail ? 0 : state.counts.likes, state.viewer.liked ? "Gefällt mir nicht mehr" : "Gefällt mir");
      bookmarkButton.draw(state.viewer.bookmarked, 0, state.viewer.bookmarked ? "Lesezeichen entfernen" : "Lesezeichen");
      if (detail) {
        fill(stats, 
          state.counts.reposts ? h("span", {}, h("b", {}, Core.formatCount(state.counts.reposts)), ` ${state.counts.reposts === 1 ? "Repost" : "Reposts"}`) : null,
          state.counts.likes ? h("span", {}, h("b", {}, Core.formatCount(state.counts.likes)), " Gefällt mir") : null,
          state.counts.replies ? h("span", {}, h("b", {}, Core.formatCount(state.counts.replies)), ` ${state.counts.replies === 1 ? "Antwort" : "Antworten"}`) : null);
        stats.hidden = !stats.children.length;
      }
    }

    async function react(on, path, key, flip) {
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

    const toggleLike = () => react(!state.viewer.liked, `/posts/${item.id}/like`, "liked", (on) => { state.viewer.liked = on; state.counts.likes = Math.max(0, state.counts.likes + (on ? 1 : -1)); });
    const toggleRepost = () => react(!state.viewer.reposted, `/posts/${item.id}/repost`, "reposted", (on) => { state.viewer.reposted = on; state.counts.reposts = Math.max(0, state.counts.reposts + (on ? 1 : -1)); });
    const toggleBookmark = async () => {
      if (!Y.requireLogin("Melde dich an, um Lesezeichen zu setzen.")) return;
      const on = !state.viewer.bookmarked;
      state.viewer.bookmarked = on;
      draw();
      const reply = on ? await Api.post(`/posts/${item.id}/bookmark`) : await Api.del(`/posts/${item.id}/bookmark`);
      if (!reply.ok) { state.viewer.bookmarked = !on; draw(); toast(Api.message(reply)); return; }
      toast(on ? "Zu deinen Lesezeichen hinzugefügt" : "Aus den Lesezeichen entfernt");
      options.onBookmark?.(on, card);
    };

    likeButton.addEventListener("click", (event) => { event.stopPropagation(); toggleLike(); });
    bookmarkButton.addEventListener("click", (event) => { event.stopPropagation(); toggleBookmark(); });
    replyButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!Y.requireLogin("Melde dich an, um zu antworten.")) return;
      Y.compose({ replyTo: item, onPosted: (post) => { state.counts.replies += 1; draw(); options.onReply?.(post); } });
    });
    repostButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!Y.requireLogin("Melde dich an, um zu reposten.")) return;
      menu(repostButton, [
        { label: state.viewer.reposted ? "Repost rückgängig machen" : "Reposten", icon: "repost", run: toggleRepost },
        { label: "Zitieren", icon: "pencil", run: () => Y.compose({ quoteOf: item }) },
      ]);
    });
    shareButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (navigator.share && matchMedia("(pointer: coarse)").matches) {
        try { await navigator.share({ url: absolute(postPath(item)), title: `${item.user.name} auf yipi` }); return; } catch (error) { if (error && error.name === "AbortError") return; }
      }
      copyLink(postPath(item));
    });
    moreButton.addEventListener("click", (event) => {
      event.stopPropagation();
      const other = item.user.handle;
      menu(moreButton, [
        { label: "Link kopieren", icon: "link", run: () => copyLink(postPath(item)) },
        mine ? { label: "Yip löschen", icon: "trash", danger: true, run: async () => {
          if (!(await confirmBox({ title: "Yip löschen?", text: "Das lässt sich nicht rückgängig machen.", yes: "Löschen", danger: true }))) return;
          const reply = await Api.del(`/posts/${item.id}`);
          if (!reply.ok) { toast(Api.message(reply)); return; }
          toast("Dein Yip wurde gelöscht.");
          if (options.onDelete) options.onDelete(card); else card.remove();
        } } : null,
        Y.me && !mine ? { label: `@${other} stummschalten`, icon: "mute", run: async () => { const reply = await Api.post(`/users/${other}/mute`); toast(reply.ok ? `@${other} ist stummgeschaltet.` : Api.message(reply)); if (reply.ok) card.remove(); } } : null,
        Y.me && !mine ? { label: `@${other} blockieren`, icon: "block", danger: true, run: async () => {
          if (!(await confirmBox({ title: `@${other} blockieren?`, text: "Ihr seht die Yips des anderen nicht mehr und könnt euch nicht mehr folgen oder schreiben.", yes: "Blockieren", danger: true }))) return;
          const reply = await Api.post(`/users/${other}/block`);
          toast(reply.ok ? `@${other} ist blockiert.` : Api.message(reply));
          if (reply.ok) card.remove();
        } } : null,
        !mine ? { label: "Yip melden", icon: "flag", danger: true, run: () => reportDialog({ postId: item.id }) } : null,
      ]);
    });

    const head = h("div", { class: "post-head" },
      link(`/${item.user.handle}`, { class: "post-name" }, h("b", {}, item.user.name), detail ? null : h("span", { class: "handle" }, `@${item.user.handle}`)),
      detail ? null : [h("span", { class: "dot" }, "·"), link(postPath(item), { class: "post-time" }, timeEl(item.createdAt))],
      detail ? null : moreButton);

    const body = h("div", { class: "post-body" },
      item.replyTo && item.replyTo.handle && !options.noReplyLine && !detail ? h("p", { class: "reply-line" }, "Antwort an ", link(`/${item.replyTo.handle}`, { class: "tok" }, `@${item.replyTo.handle}`)) : null,
      item.text ? h("div", { class: "post-text" }, richText(item.text)) : null,
      item.media && item.media.length ? mediaGrid(item.media) : null,
      item.quote ? quoteCard(item.quote) : null);

    const bar = h("div", { class: "post-actions", role: "group", "aria-label": "Aktionen" }, replyButton, repostButton, likeButton, bookmarkButton, shareButton);
    draw();

    if (item.repostedBy) {
      const own = Y.me && Y.me.handle === item.repostedBy.handle;
      put(card, h("div", { class: "post-context" }, h("span", { class: "ctx-ic" }, icon("repost")), own ? "Du hast repostet" : link(`/${item.repostedBy.handle}`, {}, `${item.repostedBy.name} hat repostet`)));
    }

    if (detail) {
      put(card, 
        h("div", { class: "post-row detail-head" }, link(`/${item.user.handle}`, { class: "post-av", tabindex: "-1", "aria-hidden": "true" }, avatar(item.user, "md")),
          h("div", { class: "detail-who" }, link(`/${item.user.handle}`, { class: "post-name" }, h("b", {}, item.user.name)), h("span", { class: "handle" }, `@${item.user.handle}`)), moreButton),
        item.replyTo && item.replyTo.handle ? h("p", { class: "reply-line" }, "Antwort an ", link(`/${item.replyTo.handle}`, { class: "tok" }, `@${item.replyTo.handle}`)) : null,
        body, h("div", { class: "detail-time" }, timeEl(item.createdAt, true)), stats, bar);
    } else {
      put(card, h("div", { class: "post-row" }, link(`/${item.user.handle}`, { class: "post-av", tabindex: "-1" }, avatar(item.user, "md")), h("div", { class: "post-main" }, head, body, bar)));
      const open = () => Y.navigate(postPath(item));
      card.addEventListener("click", (event) => {
        if (event.target.closest("a, button, .menu, .quote")) return;
        if (window.getSelection && String(window.getSelection())) return;
        open();
      });
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target === card) open(); });
    }
    card.refresh = draw;
    card.bumpReplies = () => { state.counts.replies += 1; draw(); };
    card.act = { like: toggleLike, reply: () => replyButton.click() };
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

  /* The box to write a Yip. Options: replyTo, quoteOf (Yips), placeholder, compact, autofocus, draftKey, onPosted(post), label. */
  function composer(options = {}) {
    const { replyTo, quoteOf, compact, onPosted } = options;
    const draftKey = `yipi.draft.${options.draftKey || (replyTo ? `r${replyTo.id}` : quoteOf ? `q${quoteOf.id}` : "new")}`;
    const picked = [];                                   // {blob, url, alt, uploaded}
    let busy = false;

    const textarea = h("textarea", { class: "compose-text", rows: 1, maxlength: 1000, placeholder: options.placeholder || (replyTo ? "Deine Antwort" : quoteOf ? "Füge einen Kommentar hinzu" : "Was gibt's Neues?"), "aria-label": replyTo ? "Deine Antwort" : "Text deines Yips" });
    const previews = h("div", { class: "compose-media", hidden: true });
    const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", multiple: true, hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const gauge = ring();
    const left = h("span", { class: "ring-left" });
    const submit = h("button", { class: "btn primary post-btn", type: "button", disabled: true }, options.label || (replyTo ? "Antworten" : "Yippen"));
    const photoButton = h("button", { class: "icon-btn tool", type: "button", "aria-label": "Bild hinzufügen" }, icon("image"));
    const emojiButton = h("button", { class: "icon-btn tool", type: "button", "aria-label": "Emoji einfügen", "aria-haspopup": "dialog" }, icon("emoji"));

    function update() {
      const text = textarea.value;
      const count = Core.charCount(text);
      const state = Core.counterState(text);
      gauge.set(count / Core.MAX_POST);
      gauge.svg.dataset.state = state;
      left.textContent = state === "ok" ? "" : String(Core.MAX_POST - count);
      left.dataset.state = state;
      submit.disabled = busy || state === "over" || (!count && !picked.length);
      photoButton.disabled = busy || picked.length >= Core.MAX_MEDIA;
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, compact ? 220 : 340)}px`;
      try { if (text) sessionStorage.setItem(draftKey, text); else sessionStorage.removeItem(draftKey); } catch (error) { /* storage blocked */ }
    }

    function drawPreviews() {
      previews.hidden = !picked.length;
      previews.className = `compose-media m${Math.min(picked.length, 4)}`;
      fill(previews, ...picked.map((entry, index) => h("div", { class: "pv" },
        h("img", { src: entry.url, alt: entry.alt || "Vorschau" }),
        h("button", { class: "pv-x", type: "button", "aria-label": "Bild entfernen", onclick: () => { URL.revokeObjectURL(entry.url); picked.splice(index, 1); drawPreviews(); update(); } }, icon("close")),
        h("button", { class: `pv-alt${entry.alt ? " set" : ""}`, type: "button", onclick: () => altDialog(entry) }, entry.alt ? "ALT ✓" : "+ ALT"))));
    }

    function altDialog(entry) {
      const field = h("textarea", { class: "field-area", rows: 4, maxlength: 200, "aria-label": "Bildbeschreibung", placeholder: "Beschreibe das Bild für Menschen, die es nicht sehen können." }, entry.alt || "");
      field.value = entry.alt || "";
      dialog({ title: "Bildbeschreibung", body: h("div", {}, h("img", { class: "alt-preview", src: entry.url, alt: "" }), field), actions: [{ label: "Speichern", kind: "primary", run: () => { entry.alt = Core.cleanText(field.value).slice(0, 200); drawPreviews(); } }] });
    }

    async function addFiles(files) {
      for (const file of files) {
        if (picked.length >= Core.MAX_MEDIA) { toast("Mehr als 4 Bilder gehen nicht."); break; }
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type)) { toast("Das ist kein Bild, das yipi kennt (JPEG, PNG, GIF oder WebP)."); continue; }
        if (file.type === "image/gif" && file.size > 5 * 1024 * 1024) { toast("Das GIF ist zu groß (höchstens 5 MB)."); continue; }
        try {
          const blob = await prepareImage(file);
          picked.push({ blob, url: URL.createObjectURL(blob), alt: "", uploaded: null, name: file.name });
        } catch (error) {
          toast("Dieses Bild konnte nicht gelesen werden.");
        }
      }
      drawPreviews();
      update();
    }

    function clear() {
      picked.forEach((entry) => URL.revokeObjectURL(entry.url));
      picked.length = 0;
      textarea.value = "";
      drawPreviews();
      update();
    }

    async function send() {
      const text = Core.cleanText(textarea.value);
      if (busy || (!text && !picked.length) || Core.charCount(text) > Core.MAX_POST) return;
      busy = true;
      submit.disabled = true;
      submit.classList.add("busy");
      update();
      const ids = [];
      for (const entry of picked) {
        if (!entry.uploaded) {
          const up = await Api.upload(entry.blob, { alt: entry.alt || "" });
          if (!up.ok) { busy = false; submit.classList.remove("busy"); toast(Api.message(up)); update(); return; }
          entry.uploaded = up.data.media.id;
        }
        ids.push(entry.uploaded);
      }
      const body = { text, media: ids };
      if (replyTo) body.replyTo = replyTo.id;
      if (quoteOf) body.quoteOf = quoteOf.id;
      const reply = await Api.post("/posts", body);
      busy = false;
      submit.classList.remove("busy");
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

    const root = h("div", { class: `composer${compact ? " compact" : ""}` },
      avatar(Y.me, "md"),
      h("div", { class: "compose-main" }, textarea, previews,
        h("div", { class: "compose-bar" }, h("div", { class: "tools" }, photoButton, emojiButton, picker),
          h("div", { class: "send" }, left, gauge.svg, submit))));
    root.addEventListener("dragover", (event) => { if ([...(event.dataTransfer ? event.dataTransfer.types : [])].includes("Files")) { event.preventDefault(); root.classList.add("drop"); } });
    root.addEventListener("dragleave", () => root.classList.remove("drop"));
    root.addEventListener("drop", (event) => { root.classList.remove("drop"); if (event.dataTransfer && event.dataTransfer.files.length) { event.preventDefault(); addFiles([...event.dataTransfer.files]); } });
    try { const draft = sessionStorage.getItem(draftKey); if (draft) textarea.value = draft; } catch (error) { /* storage blocked */ }
    update();
    if (options.autofocus) setTimeout(() => textarea.focus(), 0);
    root.focusText = () => textarea.focus();
    root.send = send;
    return root;
  }

  /* The dialog to write a Yip, a reply or a quote. */
  Y.compose = function compose({ replyTo, quoteOf, onPosted } = {}) {
    if (!Y.requireLogin("Melde dich an, um zu yippen.")) return null;
    const target = replyTo || quoteOf;
    let entry;
    const box = composer({
      replyTo, quoteOf, autofocus: true,
      onPosted: (post) => {
        entry.close();
        onPosted?.(post);
        Y.onPosted?.(post, { replyTo, quoteOf });
        toast(replyTo ? "Deine Antwort wurde gesendet." : "Dein Yip wurde gesendet.", { label: "Anzeigen", run: () => Y.navigate(postPath(post)) });
      },
    });
    const context = target ? h("div", { class: "compose-context" }, h("div", { class: "cc-line" }, avatar(target.user, "sm")),
      h("div", {}, h("div", { class: "cc-who" }, h("b", {}, target.user.name), h("span", { class: "handle" }, ` @${target.user.handle}`)), target.text ? h("div", { class: "post-text" }, richText(target.text.length > 280 ? target.text.slice(0, 280) : target.text)) : null,
        replyTo ? h("p", { class: "reply-line" }, "Antwort an ", h("span", { class: "tok" }, `@${target.user.handle}`)) : null)) : null;
    entry = dialog({ label: replyTo ? "Antworten" : quoteOf ? "Zitieren" : "Neuer Yip", body: h("div", { class: "compose-dialog" }, replyTo ? context : null, box, quoteOf ? h("div", { class: "quote-preview" }, context) : null), initialFocus: box.querySelector("textarea") });
    return entry;
  };

  Object.assign(Y, { postCard, composer, userRow, followButton, reportDialog, prepareImage, copyLink, postPath });
})();
