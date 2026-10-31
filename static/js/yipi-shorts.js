/* Satürn shorts (yipi-shorts.js): videos that are on the screen while somebody scrolls through the feed. Two things:
   1. `Y.autoplay.add(video)`: the videos of the feed play by themselves, always without sound and never more than one at a time. Which one: the one under the mouse (just
      resting on it, no click), or on a phone the one that was pressed for a while; otherwise the one of which most is on the screen (and nearest to the middle of it).
      Videos that nobody sees are stopped, and so is everything while the tab is hidden or when the person asked the system for less motion.
   2. `Y.shortsShelf()`: a row of five short videos on Home after the first few posts, like the shelf of shorts between the long videos on YouTube. Tapping one opens the Videos tab
      with that video first. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { h, icon, put, fill } = Y;

  const LONG_PRESS = 450;                                       // milliseconds that make a press a "choose this one"
  const MIN_SHOWN = 0.5;                                        // how much of a video has to be on the screen to play by itself
  const entries = new Set();
  let hovered = null;
  let pinned = null;
  let scheduled = 0;

  const reduced = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const saving = () => !!(navigator.connection && navigator.connection.saveData);

  const watcher = "IntersectionObserver" in window ? new IntersectionObserver((list) => {
    for (const item of list) {
      const entry = item.target._autoplay;
      if (entry) {
        entry.shown = item.isIntersecting ? item.intersectionRatio : 0;
        if (!item.isIntersecting) entry.stopped = false;                  // somebody who scrolls away and back gets the video playing again
      }
    }
    schedule();
  }, { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }) : null;

  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(() => { scheduled = 0; decide(); }, 60);               // (a short pause, so that a scroll does not decide a hundred times)
  }

  /* Which video plays now: the one under the mouse, else the pressed one (while it is still on the screen), else the one with most of it on the screen. */
  function choose() {
    for (const entry of [...entries]) if (!entry.video.isConnected) { watcher?.unobserve(entry.video); entries.delete(entry); }
    if (document.hidden || reduced() || saving()) return null;
    if (hovered && entries.has(hovered) && hovered.shown > 0.2 && !hovered.stopped) return hovered;
    if (pinned && entries.has(pinned) && pinned.shown > 0.3 && !pinned.stopped) return pinned;
    pinned = null;
    const middle = window.innerHeight / 2;
    let best = null;
    let bestScore = -1;
    for (const entry of entries) {
      if (entry.shown < MIN_SHOWN || entry.stopped) continue;
      const box = entry.video.getBoundingClientRect();
      const score = entry.shown * 1000 - Math.abs(box.top + box.height / 2 - middle) / 10;
      if (score > bestScore) { best = entry; bestScore = score; }
    }
    return best;
  }

  function decide() {
    const now = choose();
    for (const entry of entries) {
      const video = entry.video;
      if (entry === now) {
        if (!video.paused) continue;
        video.muted = true;                                      // always without sound
        if (video.preload !== "auto") video.preload = "auto";
        const attempt = video.play();
        if (attempt && attempt.catch) attempt.catch(() => {});
      } else if (!video.paused) video.pause();
    }
  }

  function add(video, options = {}) {
    if (!video || video._autoplay) return video;
    const entry = { video, shown: 0, shelf: !!options.shelf };
    video._autoplay = entry;
    video.muted = true;
    video.loop = true;
    video.playsinline = true;
    entries.add(entry);
    watcher?.observe(video);
    const host = options.host || video;
    let timer = 0;
    let startX = 0;
    let startY = 0;
    host.addEventListener("pointerenter", (event) => { if (event.pointerType === "mouse") { hovered = entry; schedule(); } });
    host.addEventListener("pointerleave", (event) => { if (event.pointerType === "mouse" && hovered === entry) { hovered = null; schedule(); } });
    host.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse") return;
      startX = event.clientX; startY = event.clientY;
      clearTimeout(timer);
      timer = setTimeout(() => { pinned = entry; navigator.vibrate?.(15); schedule(); }, LONG_PRESS);
    });
    const cancel = () => clearTimeout(timer);
    host.addEventListener("pointerup", cancel);
    host.addEventListener("pointercancel", cancel);
    host.addEventListener("pointermove", (event) => { if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel(); });
    host.addEventListener("contextmenu", (event) => { if (event.pointerType !== "mouse" && pinned === entry) event.preventDefault(); });
    schedule();
    return video;
  }

  document.addEventListener("visibilitychange", schedule);
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);

  /* One click on a video of the feed: it stops (and stays stopped while it is on the screen), or, when it was stopped, it plays and is the one that plays. */
  function toggle(video) {
    const entry = video._autoplay;
    if (!entry) { if (video.paused) video.play().catch(() => {}); else video.pause(); return; }
    if (video.paused) {
      entry.stopped = false;
      pinned = entry;
      video.muted = true;
      const attempt = video.play();
      if (attempt && attempt.catch) attempt.catch(() => {});
    } else {
      entry.stopped = true;
      if (pinned === entry) pinned = null;
      video.pause();
    }
    schedule();
  }

  /* A video with nothing but a click: one click stops it or plays it, there is no bar to wind it forward or back, no button to make it big, no picture-in-picture and no menu
     of the browser. A round play sign shows while it is stopped. `host` is the box around the video (it gets the click). */
  function plainVideo(video, host) {
    video.controls = false;
    video.removeAttribute("controls");
    video.disablePictureInPicture = true;
    video.setAttribute("disablepictureinpicture", "");
    video.setAttribute("disableremoteplayback", "");
    video.setAttribute("controlslist", "nodownload nofullscreen noremoteplayback");
    video.tabIndex = -1;
    video.addEventListener("contextmenu", (event) => event.preventDefault());
    host.classList.add("tap-video");
    host.append(h("span", { class: "video-play", "aria-hidden": "true" }, icon("playCircle")));
    const sync = () => host.classList.toggle("is-paused", video.paused);
    for (const type of ["play", "pause", "ended"]) video.addEventListener(type, sync);
    sync();
    host.tabIndex = 0;
    host.setAttribute("role", "button");
    host.setAttribute("aria-label", "Video anhalten oder abspielen");
    host.addEventListener("click", (event) => { event.stopPropagation(); toggle(video); });
    host.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(video); } });
    return video;
  }

  Y.autoplay = { add, toggle, reselect: schedule, entries: () => entries.size };
  Y.plainVideo = plainVideo;

  // ------------------------------------------------------------------------------------------------ the shelf
  const SHORTS = 5;

  function shortCard(item) {
    const media = item.media.find((entry) => entry.video);
    const video = h("video", { class: "short-video", src: `${media.url}#t=0.001`, muted: true, loop: true, playsinline: true, preload: "metadata", tabindex: "-1", "aria-hidden": "true" });
    const [title] = String(item.text || "").split("\n");
    const card = h("a", { class: "short-card", href: "/videos", "aria-label": `Video von ${item.user.name}${title ? `: ${title}` : ""}` },
      video,
      h("span", { class: "short-info" }, h("b", {}, title || `@${item.user.handle}`), h("small", {}, `@${item.user.handle}`)));
    card.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      Y.startVideo = item;
      Y.navigate("/videos");
    });
    add(video, { host: card, shelf: true });
    return card;
  }

  /* The row of five videos side by side (like the shorts between the long videos on YouTube); it fetches its videos itself and removes itself when there are none. */
  function shortsShelf({ following = false } = {}) {
    const row = h("div", { class: "shorts-row", role: "list" });
    const shelf = h("section", { class: "shorts", "aria-label": "Videos", hidden: true },
      h("div", { class: "shorts-head" }, h("span", { class: "shorts-ic" }, icon("playCircle")), h("h2", {}, "Videos")),
      row);
    Api.get(Y.qs("/timeline", { feed: "videos", order: "random", seed: 1 + Math.floor(Math.random() * 999999), offset: 0, limit: SHORTS, scope: following ? "following" : "" })).then((reply) => {
      const items = reply.ok ? reply.data.items.filter((item) => item.media && item.media.some((entry) => entry.video)) : [];
      if (!items.length) { shelf.remove(); return; }
      for (const item of items) put(row, h("div", { class: "short-slot", role: "listitem" }, shortCard(item)));
      shelf.hidden = false;
    });
    return shelf;
  }

  Y.shortsShelf = shortsShelf;
})();
