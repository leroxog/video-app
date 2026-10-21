/* Pulse comments (yipi-comments.js): the answers under a post, laid out like on X -- every comment is a row with the picture at the left and a thin
   line running down from it to the answers of that comment, which are shown (loaded when you ask) right below it with their own line. Like,
   answer and more are small buttons under each comment; "Antworten" opens a small box right under the comment, so nothing needs a second
   window. The same list is used in the sheet of a video and under a post. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, timeEl, toast, dialog, confirmBox, menu, pager } = Y;
  const { qs, listLoader } = Y;

  const MAX_DEPTH = 4;                                           // deeper answers open the post itself

  /* One comment with its buttons and (when it has answers) a button that shows them. Options: depth, onCount(change) for the post above. */
  function commentRow(item, options = {}) {
    const depth = options.depth || 0;
    if (item.deleted) return h("article", { class: "cm gone" }, h("div", { class: "cm-rail" }), h("div", { class: "cm-main" }, h("p", { class: "muted" }, "Dieser Kommentar wurde gelöscht.")));
    const mine = !!(Y.me && Y.me.handle === item.user.handle);
    const state = { liked: !!(item.viewer && item.viewer.liked), likes: (item.counts && item.counts.likes) || 0, replies: (item.counts && item.counts.replies) || 0 };
    const row = h("article", { class: `cm d${Math.min(depth, 2)}`, "data-id": String(item.id) });
    const line = h("span", { class: "cm-line" });
    const rail = h("div", { class: "cm-rail" }, link(`/${item.user.handle}`, { class: "cm-av", "aria-label": `Profil von ${item.user.name}` }, avatar(item.user, "sm")), line);
    const likeIcon = h("span", { class: "cm-ic" });
    const likeCount = h("span", { class: "cm-n" });
    const likeButton = h("button", { class: "cm-btn like", type: "button", "aria-label": "Gefällt mir" }, likeIcon, likeCount);
    const replyButton = h("button", { class: "cm-btn", type: "button", "aria-label": "Antworten", "aria-expanded": "false" }, h("span", { class: "cm-ic" }, icon("reply")), h("span", { class: "cm-n" }, "Antworten"));
    const moreButton = h("button", { class: "cm-btn", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, h("span", { class: "cm-ic" }, icon("more")));
    const answers = h("div", { class: "cm-answers" });
    const writer = h("div", { class: "cm-writer", hidden: true });
    const toggle = h("button", { class: "cm-toggle", type: "button", "aria-expanded": "false" });
    let shown = false;
    let list = null;

    function draw() {
      fill(likeIcon, icon(state.liked ? "heartFill" : "heart"));
      likeButton.classList.toggle("on", state.liked);
      likeButton.setAttribute("aria-pressed", String(state.liked));
      likeCount.textContent = state.likes ? Core.formatCount(state.likes) : "";
      toggle.hidden = !state.replies;
      toggle.textContent = shown ? "Antworten ausblenden" : `${Core.formatCount(state.replies)} ${state.replies === 1 ? "Antwort" : "Antworten"} anzeigen`;
      toggle.setAttribute("aria-expanded", String(shown));
      row.classList.toggle("threaded", shown || state.replies > 0);
    }

    likeButton.addEventListener("click", async () => {
      if (!Y.requireLogin("Melde dich an, um mitzumachen.")) return;
      const wanted = !state.liked;
      state.liked = wanted;
      state.likes = Math.max(0, state.likes + (wanted ? 1 : -1));
      draw();
      const reply = wanted ? await Api.post(`/posts/${item.id}/like`) : await Api.del(`/posts/${item.id}/like`);
      if (!reply.ok) { state.liked = !wanted; state.likes = Math.max(0, state.likes + (wanted ? -1 : 1)); draw(); toast(Api.message(reply)); }
      else if (reply.data.counts) { state.likes = reply.data.counts.likes; draw(); }
    });

    function openAnswers() {
      shown = true;
      if (!list) {
        list = pager({ load: listLoader((cursor) => qs(`/posts/${item.id}/replies`, { cursor })), render: (post) => commentRow(post, { depth: depth + 1, close: options.close, onCount: (n) => { state.replies = Math.max(0, state.replies + n); draw(); } }), empty: null });
        put(answers, list.element);
      }
      answers.hidden = false;
      draw();
    }
    toggle.addEventListener("click", () => {
      if (depth >= MAX_DEPTH) { options.close?.(); Y.navigate(Y.postPath(item)); return; }
      if (shown) { shown = false; answers.hidden = true; draw(); } else openAnswers();
    });

    replyButton.addEventListener("click", () => {
      if (!Y.requireLogin("Melde dich an, um zu antworten.")) return;
      if (!writer.hidden) { writer.hidden = true; replyButton.setAttribute("aria-expanded", "false"); fill(writer); return; }
      writer.hidden = false;
      replyButton.setAttribute("aria-expanded", "true");
      const box = Y.composer({ replyTo: item, compact: true, autofocus: true, placeholder: `Antwort an @${item.user.handle}`, label: "Senden", draftKey: `cm${item.id}`, onPosted: (post) => {
        writer.hidden = true;
        replyButton.setAttribute("aria-expanded", "false");
        fill(writer);
        state.replies += 1;
        if (depth >= MAX_DEPTH) { draw(); toast("Deine Antwort wurde gesendet."); return; }
        openAnswers();
        list.prepend(commentRow(post, { depth: depth + 1, close: options.close, onCount: (n) => { state.replies = Math.max(0, state.replies + n); draw(); } }));
      } });
      fill(writer, box);
    });

    moreButton.addEventListener("click", () => menu(moreButton, [
      { label: "Beitrag öffnen", icon: "reply", run: () => { options.close?.(); Y.navigate(Y.postPath(item)); } },
      { label: "Link kopieren", icon: "link", run: () => Y.copyLink(Y.postPath(item)) },
      mine ? { label: "Kommentar löschen", icon: "trash", danger: true, run: async () => {
        if (!(await confirmBox({ title: "Kommentar löschen?", text: "Das lässt sich nicht rückgängig machen.", yes: "Löschen", danger: true }))) return;
        const reply = await Api.del(`/posts/${item.id}`);
        if (!reply.ok) { toast(Api.message(reply)); return; }
        toast("Dein Kommentar wurde gelöscht.");
        options.onCount?.(-1);
        row.remove();
      } } : null,
      !mine ? { label: "Kommentar melden", icon: "flag", danger: true, run: () => Y.reportDialog({ postId: item.id }) } : null,
    ]));

    const main = h("div", { class: "cm-main" },
      h("div", { class: "cm-head" },
        link(`/${item.user.handle}`, { class: "cm-name" }, item.user.name),
        h("span", { class: "handle" }, `@${item.user.handle}`),
        h("span", { class: "dot" }, "·"),
        link(Y.postPath(item), { class: "cm-time" }, timeEl(item.createdAt))),
      item.text ? h("div", { class: "cm-text" }, richText(item.text)) : null,
      item.media && item.media.length ? h("div", { class: "cm-media" }, Y.mediaGrid(item.media)) : null,
      h("div", { class: "cm-actions" }, likeButton, replyButton, moreButton),
      writer, toggle, answers);
    answers.hidden = true;
    put(row, rail, main);
    draw();
    row.addEventListener("click", (event) => { if (event.target.closest("a")) options.close?.(); });
    return row;
  }

  /* The list of the comments of a post (and a way to add one at the top). Returns {element, prepend, destroy}. */
  function commentList(post, options = {}) {
    const list = pager({ load: listLoader((cursor) => qs(`/posts/${post.id}/replies`, { cursor })), render: (item) => commentRow(item, options), empty: options.empty === "" ? null : h("p", { class: "muted pad cm-empty" }, options.empty || "Noch keine Kommentare. Schreib den ersten.") });
    return { element: list.element, prepend: (item) => list.prepend(commentRow(item, options)), destroy: () => list.destroy() };
  }

  /* The sheet with the comments of a video (or any post): the list with its lines, and the box to write one stays at the bottom. */
  function commentsSheet(item, changed) {
    let entry = null;
    const options = { onCount: (n) => changed?.(n), close: () => entry?.close() };
    const list = commentList(item, options);
    let writer;
    if (Y.me) {
      writer = h("div", { class: "cm-compose" }, Y.composer({ replyTo: item, compact: true, placeholder: "Kommentar hinzufügen …", label: "Senden", draftKey: `reel${item.id}`, onPosted: (post) => {
        list.prepend(post);
        changed?.(1);
      } }));
    } else {
      writer = h("div", { class: "cm-compose reply-login" }, h("p", {}, "Melde dich an, um zu kommentieren."), h("button", { class: "btn primary", type: "button", onclick: () => { entry?.close(); Y.navigate("/i/login"); } }, "Anmelden"));
    }
    entry = dialog({ title: "Kommentare", body: h("div", { class: "comments-sheet" }, list.element, writer), onClose: () => list.destroy() });
    return entry;
  }

  Object.assign(Y, { commentRow, commentList, commentsSheet });
})();
