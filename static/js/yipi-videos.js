/* Nex videos (yipi-videos.js): the Videos tab, made like TikTok -- one video after the other, each as big as the screen, you scroll (or press the
   arrow keys) to the next one, the one on screen plays by itself and cannot be stopped. The order is a shuffle (not the newest first); when every video
   has been shown the page shuffles again and starts over. Only five videos are asked for at a time, only the ones near the screen are fetched (and
   they are fetched piece by piece while they play), the ones far away are let go again. In the video itself, small and see-through, a row to set the
   sound from 0 to 10 (it starts at 10), shown as a picture only: crossed out (0), one wave (1-6), two (7-8), three (9-10). At the side: the person
   (with a plus to follow), like, comments (a sheet like on X), save and share. Every video someone puts into a post is in here, and it is
   the same post as in the normal feed: likes and answers are shared. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, put, h, icon, link, avatar, richText, timeEl, toast, confirmBox, menu } = Y;
  const { qs } = Y;
  const views = Y.views;

  const PAGE = 5;                                               // videos asked for at a time
  const KEEP = 2;                                               // how many videos after (and before) the one on screen keep their file
  const MAX_REELS = 40;                                         // more than this in the page and the oldest ones are dropped

  let volume = 10;                                              // 0 to 10, as loud as possible at the start
  let lastLoud = 10;                                            // what the picture button brings back after it was set to 0
  const shuffle = { seed: 1 + Math.floor(Math.random() * 999999), at: 0 };   // which shuffle, and how far the person has come in it

  const level = (value) => (value <= 0 ? 0 : value <= 6 ? 1 : value <= 8 ? 2 : 3);
  const soundIcon = (value) => `vol${level(value)}`;

  views.videos = function videos(route, ctx) {
    const scroller = h("div", { class: "reels", tabindex: "0", "aria-label": "Videos" });
    let scope = "foryou";                                       // "foryou" or "following"
    const scopes = h("div", { class: "reels-scope", role: "tablist", "aria-label": "Videos" });
    const top = h("div", { class: "reels-top" }, h("h1", { class: "sr-only" }, "Videos"), scopes);
    const status = h("div", { class: "reels-status" });
    const el = h("div", { class: "view reels-view" }, Y.sponsored("bar"), top, scroller, status);      // (the strip at the top shows on a phone held upright, where the bar with the lettering is not)
    let shown = 0;                                              // how many videos were put on the page (every fifth page is a box "Gesponsert")
    const sponsorPage = () => h("section", { class: "reel sponsored-reel", "aria-label": "Gesponsert" }, h("div", { class: "reel-stage" }, Y.sponsored("reel")));
    const reels = [];
    let offset = shuffle.at;                                    // where the next page starts in the shuffle
    let seed = shuffle.seed;
    let loading = false;
    let ended = false;                                          // the shuffle has been read to its end (the next page shuffles again)
    let dead = false;
    let active = null;
    let watching = null;
    let blocked = false;                                        // the browser does not allow sound before the person touches the page

    /* ------------------------------------------------------------------ sound */
    const heard = () => (blocked ? 0 : volume);
    function applySound(reel) {
      reel.video.volume = Math.min(1, Math.max(0, volume / 10));
      reel.video.muted = blocked || volume === 0;
      const shown = heard();
      fill(reel.volumeIcon, icon(soundIcon(shown)));
      reel.volumeButton.setAttribute("aria-label", shown === 0 ? "Ton einschalten" : "Ton ausschalten");
      reel.range.value = String(volume);
      reel.range.style.setProperty("--fill", `${volume * 10}%`);
      reel.range.setAttribute("aria-valuetext", `Lautstärke ${volume} von 10`);
    }
    const applyAll = () => { for (const reel of reels) applySound(reel); };
    function setVolume(value) {
      volume = Math.min(10, Math.max(0, Math.round(value)));
      if (volume > 0) lastLoud = volume;
      applyAll();
    }
    const unlock = () => {
      if (!blocked) return;
      blocked = false;
      applyAll();
    };
    for (const type of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(type, unlock, { passive: true });

    function play(reel) {
      applySound(reel);
      reel.stage.classList.remove("stuck");
      const attempt = reel.video.play();
      if (attempt && attempt.catch) attempt.catch(() => {
        blocked = true;                                         // no sound yet: it starts muted and gets its sound with the first touch
        applyAll();
        reel.video.play().catch(() => reel.stage.classList.add("stuck"));
      });
    }

    /* ------------------------------------------------------------------ loading */
    const fetchFile = (reel) => { if (!reel.video.getAttribute("src")) { reel.video.preload = "auto"; reel.video.src = reel.url; } };
    function letGo(reel) {                                      // far from the screen: no file, no memory
      if (!reel.video.getAttribute("src")) return;
      reel.video.pause();
      reel.video.removeAttribute("src");
      reel.video.load();
    }
    function manage() {
      const at = reels.indexOf(active);
      if (at < 0) return;
      reels.forEach((reel, index) => {
        if (index >= at - 1 && index <= at + KEEP) fetchFile(reel);
        else if (Math.abs(index - at) > KEEP + 1) letGo(reel);
      });
    }

    function setActive(reel) {
      if (active === reel) return;
      active?.video.pause();
      active = reel;
      clearTimeout(watching);
      if (!reel) return;
      const index = reels.indexOf(reel);
      shuffle.at = Math.max(0, reel.position);
      fetchFile(reel);
      reel.video.currentTime = 0;
      play(reel);
      manage();
      watching = setTimeout(() => Y.queueView?.(reel.item.id), 1500);
      if (index >= reels.length - 3) more();
      if (reels.length > MAX_REELS && index > MAX_REELS / 2) trim();
    }

    function trim() {                                           // the first ones leave (and the boxes between them), the scroll position is moved by exactly their height
      const drop = reels.splice(0, 10);
      const height = scroller.clientHeight;
      const boundary = reels[0] ? reels[0].element : null;
      let removed = 0;
      for (const made of drop) { watcher?.unobserve(made.element); made.video.pause(); made.video.removeAttribute("src"); made.video.load(); }
      for (const page of [...scroller.children]) {
        if (page === boundary || !page.classList.contains("reel")) { if (page === boundary) break; continue; }
        page.remove();
        removed += 1;
      }
      scroller.scrollTop -= height * removed;
    }

    const watcher = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const reel = reels.find((candidate) => candidate.element === entry.target);
        if (!reel) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) setActive(reel);
        else if (active === reel && !entry.isIntersecting) { reel.video.pause(); active = null; }
      }
    }, { root: scroller, threshold: [0, 0.6, 1] }) : null;

    /* ------------------------------------------------------------------ one video */
    function reel(item, position) {
      const media = item.media.find((entry) => entry.video) || item.media[0];
      const state = { liked: !!item.viewer.liked, bookmarked: !!item.viewer.bookmarked, likes: item.counts.likes, replies: item.counts.replies };
      const video = h("video", { class: "reel-video", loop: true, muted: true, playsinline: true, preload: "none", "aria-label": item.text || `Video von ${item.user.name}` });
      if (media.width > media.height) video.classList.add("wide");
      const stage = h("div", { class: "reel-stage" });
      const likeCount = h("span", { class: "reel-count" });
      const commentCount = h("span", { class: "reel-count" });
      const like = h("button", { class: "reel-btn", type: "button", "aria-label": "Gefällt mir" }, h("span", { class: "reel-btn-ic" }), likeCount);
      const comment = h("button", { class: "reel-btn", type: "button", "aria-label": "Kommentare" }, h("span", { class: "reel-btn-ic" }, icon("reply")), commentCount);
      const save = h("button", { class: "reel-btn", type: "button", "aria-label": "Lesezeichen" }, h("span", { class: "reel-btn-ic" }), h("span", { class: "reel-count" }, "Merken"));
      const share = h("button", { class: "reel-btn", type: "button", "aria-label": "Teilen", "aria-haspopup": "menu" }, h("span", { class: "reel-btn-ic" }, icon("send")), h("span", { class: "reel-count" }, "Teilen"));
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
      async function toggleLike(x, y) {
        if (!Y.requireLogin("Melde dich an, um mitzumachen.")) return;
        const wanted = !state.liked;
        if (wanted) { const box = like.getBoundingClientRect(); Y.likeBurst(x ?? box.left + box.width / 2, y ?? box.top + box.height / 2, { size: x === undefined ? 56 : 120 }); Y.sound.play("like"); } else Y.sound.play("unlike");
        state.liked = wanted;
        state.likes = Math.max(0, state.likes + (wanted ? 1 : -1));
        draw();
        const reply = wanted ? await Api.post(`/posts/${item.id}/like`) : await Api.del(`/posts/${item.id}/like`);
        if (!reply.ok) { state.liked = !wanted; state.likes = Math.max(0, state.likes + (wanted ? -1 : 1)); draw(); toast(Api.message(reply)); }
        else if (reply.data.counts) { state.likes = reply.data.counts.likes; draw(); }
      }
      like.addEventListener("click", () => toggleLike());
      Y.onDoubleTap(stage, (x, y) => { if (state.liked) { Y.likeBurst(x, y, { size: 120 }); Y.sound.play("like"); } else toggleLike(x, y); }, { ignore: "button, a, input, .reel-volume, .menu" });
      comment.addEventListener("click", () => Y.commentsSheet(item, (n) => { state.replies = Math.max(0, state.replies + n); draw(); }));
      save.addEventListener("click", async () => {
        if (!Y.requireLogin("Melde dich an, um Lesezeichen zu setzen.")) return;
        const wanted = !state.bookmarked;
        state.bookmarked = wanted;
        draw();
        const reply = wanted ? await Api.post(`/posts/${item.id}/bookmark`) : await Api.del(`/posts/${item.id}/bookmark`);
        if (!reply.ok) { state.bookmarked = !wanted; draw(); toast(Api.message(reply)); } else toast(wanted ? "Zu deinen Lesezeichen hinzugefügt" : "Aus den Lesezeichen entfernt");
      });
      share.addEventListener("click", () => menu(share, Y.shareItems(item)));
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

      /* the see-through row in the video: a picture of the sound and a slider, no numbers */
      const volumeIcon = h("span", { class: "reel-vol-ic" });
      const volumeButton = h("button", { class: "reel-vol-btn", type: "button", "aria-label": "Ton ausschalten", onclick: () => { blocked = false; setVolume(volume === 0 ? lastLoud : 0); } }, volumeIcon);
      const range = h("input", { class: "reel-range", type: "range", min: "0", max: "10", step: "1", value: String(volume), "aria-label": "Lautstärke" });
      range.addEventListener("input", () => { blocked = false; setVolume(Number(range.value)); });
      const volumeRow = h("div", { class: "reel-volume" }, volumeButton, range);

      const resume = h("button", { class: "reel-resume", type: "button", "aria-label": "Video abspielen", onclick: () => { const made = reels.find((entry) => entry.video === video); if (made) play(made); } }, icon("playCircle"));
      const bar = h("span", { class: "reel-bar" }, h("span", { class: "reel-bar-fill" }));
      video.addEventListener("timeupdate", () => { if (video.duration) bar.firstChild.style.width = `${(video.currentTime / video.duration) * 100}%`; });
      const [title, ...rest] = String(item.text || "").split("\n");
      const caption = rest.join("\n").trim();
      const info = h("div", { class: "reel-info" },
        link(`/${item.user.handle}`, { class: "reel-user" }, h("b", {}, `@${item.user.handle}`), h("span", { class: "dot" }, "·"), timeEl(item.createdAt)),
        title ? h("p", { class: "reel-title" }, richText(title)) : null,
        caption ? h("p", { class: "reel-text" }, richText(caption)) : null,
        Y.linkCardFor ? Y.linkCardFor(item.text, { compact: true }) : null,
        item.camId && Y.tryButton ? Y.tryButton(item.camId) : null);
      const actions = h("div", { class: "reel-actions" },
        h("span", { class: "reel-person" }, link(`/${item.user.handle}`, { class: "reel-av", "aria-label": `Profil von ${item.user.name}` }, avatar(item.user, "lg")), follow),
        like, comment, save, share, more);
      put(stage, video, volumeRow, resume, bar, info);
      const element = h("section", { class: "reel", "data-id": String(item.id), "aria-label": `Video von ${item.user.name}` }, stage, actions);
      draw();
      return { element, video, stage, item, url: media.url, draw, position, volumeIcon, volumeButton, range };
    }

    function showEmpty() {
      fill(status, h("div", { class: "reels-empty" }, h("span", { class: "chat-empty-ic" }, icon("playCircle")), h("h2", {}, scope === "following" ? "Noch nichts von deinen Leuten" : "Noch keine Videos"),
        h("p", {}, scope === "following" ? "Hier erscheinen die Videos von Leuten, denen du folgst." : "Videos, die jemand hochlädt, erscheinen hier."), h("button", { class: "btn primary", type: "button", onclick: () => Y.newPost({ only: "video" }) }, "Erstes Video hochladen")));
    }

    async function more() {
      if (loading || dead) return;
      loading = true;
      const wrapped = ended;
      if (ended) { seed = shuffle.seed = 1 + Math.floor(Math.random() * 999999); offset = shuffle.at = 0; ended = false; }
      const reply = await Api.get(qs("/timeline", { feed: "videos", order: "random", seed, offset, limit: PAGE, scope: scope === "following" ? "following" : "" }));
      loading = false;
      if (dead) return;
      if (!reply.ok) {
        if (wrapped) ended = true;
        if (!reels.length) fill(status, h("div", { class: "reels-empty" }, h("h2", {}, "Das hat nicht geklappt"), h("p", {}, Api.message(reply)), h("button", { class: "btn primary", type: "button", onclick: () => { fill(status); more(); } }, "Noch einmal versuchen")));
        return;
      }
      fill(status);
      const first = offset;
      reply.data.items.forEach((item, index) => {
        if (!item.media || !item.media.some((entry) => entry.video)) return;
        if (reels.some((other) => other.item.id === item.id)) return;          // (the video that was chosen on Home is already the first one)
        const made = reel(item, first + index);
        applySound(made);
        reels.push(made);
        scroller.append(made.element);
        watcher?.observe(made.element);
        shown += 1;
        if (shown % 4 === 0) scroller.append(sponsorPage());       // after four videos comes the fifth page: a box "Gesponsert"
      });
      if (reply.data.next) offset = reply.data.next; else ended = true;
      if (!reels.length) showEmpty();
      if (!active && reels.length) fetchFile(reels[0]);
      manage();
    }

    scroller.addEventListener("keydown", (event) => {
      const pages = [...scroller.querySelectorAll(".reel")];
      const at = active ? pages.indexOf(active.element) : Math.round(scroller.scrollTop / Math.max(1, scroller.clientHeight));
      if (event.key === "ArrowDown" || event.key === "PageDown") { event.preventDefault(); pages[Math.min(pages.length - 1, at + 1)]?.scrollIntoView({ behavior: "smooth" }); }
      else if (event.key === "ArrowUp" || event.key === "PageUp") { event.preventDefault(); pages[Math.max(0, at - 1)]?.scrollIntoView({ behavior: "smooth" }); }
      else if (event.key === "m") { blocked = false; setVolume(volume === 0 ? lastLoud : 0); }
    });

    function reset() {
      for (const made of reels.splice(0)) { watcher?.unobserve(made.element); made.video.pause(); made.video.removeAttribute("src"); made.video.load(); made.element.remove(); }
      for (const page of scroller.querySelectorAll(".sponsored-reel")) page.remove();
      shown = 0;
      active = null;
      seed = shuffle.seed = 1 + Math.floor(Math.random() * 999999);
      offset = shuffle.at = 0;
      ended = false;
      loading = false;
      scroller.scrollTop = 0;
      fill(status, h("div", { class: "reels-wait" }, Y.pulseLoader()));
      more();
    }
    function drawScopes() {
      fill(scopes, ...[["foryou", "Für dich"], ["following", "Folge ich"]].map(([id, label]) => h("button", { class: `reels-scope-btn${id === scope ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(id === scope), onclick: () => { if (id === scope) return; scope = id; drawScopes(); reset(); } }, label)));
    }
    drawScopes();
    put(status, h("div", { class: "reels-wait" }, Y.pulseLoader()));
    more();
    const result = {
      element: el, title: "Videos",
      onShow() { if (active) play(active); scroller.focus({ preventScroll: true }); },
      onHide() { active?.video.pause(); },
      onPosted(post) {                                          // a video that was just posted is the first one
        if (!post.media || !post.media.some((entry) => entry.video)) return;
        fill(status);
        const made = reel(post, 0);
        applySound(made);
        reels.unshift(made);
        scroller.prepend(made.element);
        watcher?.observe(made.element);
        fetchFile(made);
        scroller.scrollTop = 0;
      },
      refresh() { reset(); },
      destroy() {
        dead = true;
        clearTimeout(watching);
        watcher?.disconnect();
        for (const type of ["pointerdown", "keydown", "touchstart"]) document.removeEventListener(type, unlock);
        for (const made of reels) { made.video.pause(); made.video.removeAttribute("src"); made.video.load(); }
      },
    };
    if (Y.startVideo) { const chosen = Y.startVideo; Y.startVideo = null; result.onPosted(chosen); }       // a short that was tapped on Home comes first
    return result;
  };
})();
