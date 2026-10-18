/* Pulse videos (yipi-videos.js): the Videos tab, made like TikTok -- one video after the other, each as big as the screen, you scroll (or press the
   arrow keys) to the next one, the one on screen plays by itself, a tap pauses it. At the side: the person (with a button to follow), like, comments
   (a sheet with the answers to the post and a box to write one), save and share. Every video someone puts into a post is in here, and it is
   the same post as in the normal feed: likes and answers are shared. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, timeEl, toast, dialog, confirmBox, menu, pager } = Y;
  const { qs, listLoader } = Y;
  const views = Y.views;

  let sound = false;                                            // the sound is off until somebody asks for it (browsers do not start a video with sound by themselves)

  /* The sheet with the comments of a video: the answers to its post, and a box to write one. */
  function commentsSheet(item, changed) {
    const list = pager({ load: listLoader((cursor) => qs(`/posts/${item.id}/replies`, { cursor })), render: (post) => Y.postCard(post, { noReplyLine: true }), empty: h("p", { class: "muted pad" }, "Noch keine Kommentare. Schreib den ersten.") });
    const writer = Y.composer({ replyTo: item, compact: true, placeholder: "Kommentar schreiben …", label: "Senden", draftKey: `reel${item.id}`, onPosted: (post) => {
      list.prepend(Y.postCard(post, { noReplyLine: true }));
      changed(1);
    } });
    dialog({ title: "Kommentare", body: h("div", { class: "comments-sheet" }, writer, list.element), onClose: () => list.destroy() });
  }

  views.videos = function videos(route, ctx) {
    const scroller = h("div", { class: "reels", tabindex: "0", "aria-label": "Videos" });
    const speaker = h("button", { class: "icon-btn round reels-btn", type: "button", "aria-label": "Ton einschalten", "aria-pressed": "false" }, icon("mute"));
    const upload = h("button", { class: "icon-btn round reels-btn", type: "button", "aria-label": "Video hochladen", onclick: () => Y.compose({ video: true }) }, icon("plus"));
    let scope = "foryou";                                       // "foryou" or "following"
    const scopes = h("div", { class: "reels-scope", role: "tablist", "aria-label": "Videos" });
    const top = h("div", { class: "reels-top" }, h("h1", { class: "sr-only" }, "Videos"), scopes, h("div", { class: "reels-tools" }, speaker, upload));
    const status = h("div", { class: "reels-status" });
    const el = h("div", { class: "view reels-view" }, top, scroller, status);
    const reels = [];
    let next = null;
    let loading = false;
    let finished = false;
    let dead = false;
    let active = null;
    let watching = null;

    const drawSpeaker = () => {
      fill(speaker, icon(sound ? "volume" : "mute"));
      speaker.setAttribute("aria-label", sound ? "Ton ausschalten" : "Ton einschalten");
      speaker.setAttribute("aria-pressed", String(sound));
      for (const reel of reels) reel.video.muted = !sound;
    };
    speaker.addEventListener("click", () => { sound = !sound; drawSpeaker(); });

    function play(reel) {
      reel.video.muted = !sound;
      const attempt = reel.video.play();
      if (attempt && attempt.catch) attempt.catch(() => { reel.video.muted = true; reel.video.play().catch(() => reel.stage.classList.add("paused")); });
    }

    function setActive(reel) {
      if (active === reel) return;
      active?.video.pause();
      active = reel;
      clearTimeout(watching);
      if (!reel) return;
      reel.video.currentTime = 0;
      play(reel);
      const index = reels.indexOf(reel);
      for (const near of [reels[index + 1], reels[index + 2]]) if (near && !near.video.getAttribute("src")) near.video.src = near.url;       // the next ones are fetched in advance
      watching = setTimeout(() => Y.queueView?.(reel.item.id), 1500);
      if (!finished && index >= reels.length - 3) more();
    }

    const watcher = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const reel = reels.find((candidate) => candidate.element === entry.target);
        if (!reel) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) setActive(reel);
        else if (active === reel && !entry.isIntersecting) { reel.video.pause(); active = null; }
      }
    }, { root: scroller, threshold: [0, 0.6, 1] }) : null;

    function reel(item) {
      const media = item.media.find((entry) => entry.video) || item.media[0];
      const state = { liked: !!item.viewer.liked, bookmarked: !!item.viewer.bookmarked, likes: item.counts.likes, replies: item.counts.replies };
      const video = h("video", { class: "reel-video", loop: true, muted: true, playsinline: true, preload: "metadata", "aria-label": item.text || `Video von ${item.user.name}` });
      if (media.width > media.height) video.classList.add("wide");
      const stage = h("div", { class: "reel-stage" });
      const likeCount = h("span", { class: "reel-count" });
      const commentCount = h("span", { class: "reel-count" });
      const like = h("button", { class: "reel-btn", type: "button", "aria-label": "Gefällt mir" }, h("span", { class: "reel-btn-ic" }), likeCount);
      const comment = h("button", { class: "reel-btn", type: "button", "aria-label": "Kommentare" }, h("span", { class: "reel-btn-ic" }, icon("reply")), commentCount);
      const save = h("button", { class: "reel-btn", type: "button", "aria-label": "Lesezeichen" }, h("span", { class: "reel-btn-ic" }), h("span", { class: "reel-count" }, "Merken"));
      const share = h("button", { class: "reel-btn", type: "button", "aria-label": "Teilen", "aria-haspopup": "menu" }, h("span", { class: "reel-btn-ic" }, icon("share")), h("span", { class: "reel-count" }, "Teilen"));
      const more = h("button", { class: "reel-btn", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, h("span", { class: "reel-btn-ic" }, icon("more")));
      const mine = !!(Y.me && Y.me.handle === item.user.handle);
      const follow = !mine && !item.user.followedByMe ? h("button", { class: "reel-follow", type: "button", "aria-label": `@${item.user.handle} folgen` }, icon("plus")) : null;

      function draw() {
        fill(like.firstChild, icon(state.liked ? "heartFill" : "heart"));
        like.classList.toggle("on", state.liked);
        like.setAttribute("aria-pressed", String(state.liked));
        likeCount.textContent = Core.formatCount(state.likes);
        commentCount.textContent = Core.formatCount(state.replies);
        fill(save.firstChild, icon(state.bookmarked ? "bookmarkFill" : "bookmark"));
        save.classList.toggle("on", state.bookmarked);
      }
      like.addEventListener("click", async () => {
        if (!Y.requireLogin("Melde dich an, um mitzumachen.")) return;
        const wanted = !state.liked;
        state.liked = wanted;
        state.likes = Math.max(0, state.likes + (wanted ? 1 : -1));
        draw();
        const reply = wanted ? await Api.post(`/posts/${item.id}/like`) : await Api.del(`/posts/${item.id}/like`);
        if (!reply.ok) { state.liked = !wanted; state.likes = Math.max(0, state.likes + (wanted ? -1 : 1)); draw(); toast(Api.message(reply)); }
        else if (reply.data.counts) { state.likes = reply.data.counts.likes; draw(); }
      });
      comment.addEventListener("click", () => commentsSheet(item, (n) => { state.replies += n; draw(); }));
      save.addEventListener("click", async () => {
        if (!Y.requireLogin("Melde dich an, um Lesezeichen zu setzen.")) return;
        const wanted = !state.bookmarked;
        state.bookmarked = wanted;
        draw();
        const reply = wanted ? await Api.post(`/posts/${item.id}/bookmark`) : await Api.del(`/posts/${item.id}/bookmark`);
        if (!reply.ok) { state.bookmarked = !wanted; draw(); toast(Api.message(reply)); } else toast(wanted ? "Zu deinen Lesezeichen hinzugefügt" : "Aus den Lesezeichen entfernt");
      });
      share.addEventListener("click", () => menu(share, [
        { label: "Link kopieren", icon: "link", run: () => Y.copyLink(Y.postPath(item)) },
        { label: "Per Nachricht senden", icon: "mail", run: () => Y.sendPostDialog(item) },
        navigator.share ? { label: "Teilen …", icon: "share", run: async () => { try { await navigator.share({ url: `${location.origin}${Y.postPath(item)}`, title: `${item.user.name} auf Pulse` }); } catch (error) { /* closed */ } } } : null,
      ]));
      more.addEventListener("click", () => menu(more, [
        { label: "Beitrag öffnen", icon: "reply", run: () => Y.navigate(Y.postPath(item)) },
        !mine ? { label: "Beitrag melden", icon: "flag", danger: true, run: () => Y.reportDialog({ postId: item.id }) } : null,
        mine ? { label: "Beitrag löschen", icon: "trash", danger: true, run: async () => {
          if (!(await confirmBox({ title: "Beitrag löschen?", text: "Das Video und alles dazu wird gelöscht. Das lässt sich nicht rückgängig machen.", yes: "Löschen", danger: true }))) return;
          const reply = await Api.del(`/posts/${item.id}`);
          if (!reply.ok) { toast(Api.message(reply)); return; }
          toast("Dein Beitrag wurde gelöscht.");
          const at = reels.findIndex((entry) => entry.item === item);
          if (at >= 0) { watcher?.unobserve(reels[at].element); reels[at].video.pause(); reels[at].element.remove(); reels.splice(at, 1); if (active && active.item === item) active = null; }
          if (!reels.length) showEmpty();
        } } : null,
      ]));
      if (follow) follow.addEventListener("click", async () => {
        if (!Y.requireLogin("Melde dich an, um zu folgen.")) return;
        const reply = await Api.post(`/users/${item.user.handle}/follow`);
        if (!reply.ok) { toast(Api.message(reply)); return; }
        for (const other of reels) if (other.item.user.handle === item.user.handle) other.element.querySelector(".reel-follow")?.remove();
        toast(`Du folgst jetzt @${item.user.handle}.`);
      });

      const playIcon = h("span", { class: "reel-pause", "aria-hidden": "true" }, icon("playCircle"));
      const tap = h("button", { class: "reel-tap", type: "button", "aria-label": "Abspielen oder anhalten", onclick: () => {
        if (video.paused) { play(reels.find((entry) => entry.video === video)); stage.classList.remove("paused"); } else { video.pause(); stage.classList.add("paused"); }
      } });
      video.addEventListener("pause", () => { if (active && active.video === video) stage.classList.add("paused"); });
      video.addEventListener("play", () => stage.classList.remove("paused"));
      const bar = h("span", { class: "reel-bar" }, h("span", { class: "reel-bar-fill" }));
      video.addEventListener("timeupdate", () => { if (video.duration) bar.firstChild.style.width = `${(video.currentTime / video.duration) * 100}%`; });
      const info = h("div", { class: "reel-info" },
        link(`/${item.user.handle}`, { class: "reel-user" }, h("b", {}, `@${item.user.handle}`), h("span", { class: "dot" }, "·"), timeEl(item.createdAt)),
        item.text ? h("p", { class: "reel-text" }, richText(item.text)) : null);
      const actions = h("div", { class: "reel-actions" },
        h("span", { class: "reel-person" }, link(`/${item.user.handle}`, { class: "reel-av", "aria-label": `Profil von ${item.user.name}` }, avatar(item.user, "md")), follow),
        like, comment, save, share, more);
      put(stage, video, tap, playIcon, bar, info);
      const element = h("section", { class: "reel", "data-id": String(item.id), "aria-label": `Video von ${item.user.name}` }, stage, actions);
      draw();
      return { element, video, stage, item, url: media.url, draw };
    }

    function showEmpty() {
      fill(status, h("div", { class: "reels-empty" }, h("span", { class: "chat-empty-ic" }, icon("playCircle")), h("h2", {}, scope === "following" ? "Noch nichts von deinen Leuten" : "Noch keine Videos"),
        h("p", {}, scope === "following" ? "Hier erscheinen die Videos von Leuten, denen du folgst." : "Videos, die jemand in einem Beitrag hochlädt, erscheinen hier."), h("button", { class: "btn primary", type: "button", onclick: () => Y.compose({ video: true }) }, "Erstes Video hochladen")));
    }

    async function more() {
      if (loading || finished || dead) return;
      loading = true;
      const reply = await Api.get(qs("/timeline", { feed: "videos", scope: scope === "following" ? "following" : "", cursor: next }));
      loading = false;
      if (dead) return;
      if (!reply.ok) { if (!reels.length) fill(status, h("div", { class: "reels-empty" }, h("h2", {}, "Das hat nicht geklappt"), h("p", {}, Api.message(reply)), h("button", { class: "btn primary", type: "button", onclick: () => { fill(status); more(); } }, "Noch einmal versuchen"))); return; }
      fill(status);
      for (const item of reply.data.items) {
        if (!item.media || !item.media.some((entry) => entry.video)) continue;
        const made = reel(item);
        reels.push(made);
        scroller.append(made.element);
        watcher?.observe(made.element);
        if (reels.length <= 2) made.video.src = made.url;                // the first two are fetched at once
      }
      next = reply.data.next;
      finished = !next;
      if (!reels.length) showEmpty();
      drawSpeaker();
    }

    scroller.addEventListener("keydown", (event) => {
      const at = reels.indexOf(active);
      if (event.key === "ArrowDown" || event.key === "PageDown") { event.preventDefault(); reels[Math.min(reels.length - 1, at + 1)]?.element.scrollIntoView({ behavior: "smooth" }); }
      else if (event.key === "ArrowUp" || event.key === "PageUp") { event.preventDefault(); reels[Math.max(0, at - 1)]?.element.scrollIntoView({ behavior: "smooth" }); }
      else if (event.key === "m") { sound = !sound; drawSpeaker(); }
      else if (event.key === " " && active) { event.preventDefault(); active.stage.querySelector(".reel-tap").click(); }
    });

    function reset() {
      for (const made of reels.splice(0)) { watcher?.unobserve(made.element); made.video.pause(); made.video.removeAttribute("src"); made.video.load(); made.element.remove(); }
      active = null;
      next = null;
      finished = false;
      loading = false;
      scroller.scrollTop = 0;
      fill(status, h("div", { class: "reels-wait" }, h("span", { class: "spinner" })));
      more();
    }
    function drawScopes() {
      fill(scopes, ...[["foryou", "Für dich"], ["following", "Folge ich"]].map(([id, label]) => h("button", { class: `reels-scope-btn${id === scope ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(id === scope), onclick: () => { if (id === scope) return; scope = id; drawScopes(); reset(); } }, label)));
    }
    drawScopes();
    put(status, h("div", { class: "reels-wait" }, h("span", { class: "spinner" })));
    more();
    drawSpeaker();
    return {
      element: el, title: "Videos",
      onShow() { if (active) play(active); scroller.focus({ preventScroll: true }); },
      onHide() { active?.video.pause(); },
      onPosted(post) {                                          // a video that was just posted is the first one
        if (!post.media || !post.media.some((entry) => entry.video)) return;
        fill(status);
        const made = reel(post);
        reels.unshift(made);
        scroller.prepend(made.element);
        watcher?.observe(made.element);
        made.video.src = made.url;
        scroller.scrollTop = 0;
        drawSpeaker();
      },
      refresh() { reset(); },
      destroy() { dead = true; clearTimeout(watching); watcher?.disconnect(); for (const made of reels) { made.video.pause(); made.video.removeAttribute("src"); made.video.load(); } },
    };
  };
})();
