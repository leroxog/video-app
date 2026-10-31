/* Satürn share page (yipi-share.js): what somebody sees who is NOT signed in and opens the link of a post that was sent to them. A video plays once,
   as big as the screen (with sound if the browser allows it). When it is over -- or when the person swipes, scrolls or presses a key to get
   to the next one -- the next video appears, but blurred, without sound, running in a loop, the page can no longer be scrolled and an invitation to
   sign up stands in front of it. A post without a video is shown as a card with the same invitation. Nothing else of Satürn is open without an account. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const Icons = window.YipiIcons;
  const { fill, put, h, icon, avatar, richText } = Y;

  const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Enter", "End", "Home", "j", "k"]);

  function invitation(text) {
    return h("div", { class: "share-card", role: "dialog", "aria-label": "Anmelden" },
      h("span", { class: "hero-logo" }, Icons.logo()),
      h("h2", {}, "Melde dich an, um weiterzuschauen"),
      h("p", {}, text || "Mit einem Konto siehst du alle Videos, kannst liken, kommentieren und selbst etwas hochladen."),
      h("div", { class: "hero-actions" },
        h("button", { class: "btn primary", type: "button", onclick: () => Y.navigate("/i/signup") }, "Konto erstellen"),
        h("button", { class: "btn ghost", type: "button", onclick: () => Y.navigate("/i/login") }, "Anmelden")));
  }

  Y.views.share = function share(route, ctx) {
    const root = h("div", { class: "share-view" }, h("div", { class: "reels-wait" }, Y.pulseLoader()));
    const el = h("div", { class: "view share-shell" }, root);
    const cleanups = [];
    let dead = false;
    const listen = (target, type, handler, options) => { target.addEventListener(type, handler, options); cleanups.push(() => target.removeEventListener(type, handler, options)); };

    function top() {
      return h("div", { class: "share-top" },
        h("span", { class: "share-brand" }, Icons.logo(), "Satürn"),
        h("button", { class: "btn ghost small", type: "button", onclick: () => Y.navigate("/i/login") }, "Anmelden"));
    }

    function cardFlow(post) {
      fill(root, top(), h("div", { class: "share-plain" },
        h("article", { class: "share-post" },
          h("div", { class: "share-who" }, avatar(post.user, "md"), h("div", {}, h("b", {}, post.user.name), h("div", { class: "handle" }, `@${post.user.handle}`))),
          post.text ? h("div", { class: "post-text" }, richText(post.text)) : null,
          post.media.length ? h("div", { class: "share-pics" }, post.media.map((item) => h("img", { src: item.url, alt: item.alt || "", loading: "lazy" }))) : null),
        invitation("Melde dich an, um den ganzen Beitrag mit allem Drum und Dran zu sehen.")));
    }

    function videoFlow(post, media, next) {
      let locked = false;
      let muted = false;
      const video = h("video", { class: `share-video${media.width > media.height ? " wide" : ""}`, playsinline: true, preload: "auto", "aria-label": post.text || `Video von ${post.user.name}` });
      const stage = h("div", { class: "share-stage" }, video);
      const [title, ...rest] = String(post.text || "").split("\n");
      const caption = rest.join("\n").trim();
      const bar = h("span", { class: "reel-bar" }, h("span", { class: "reel-bar-fill" }));
      const sound = h("button", { class: "share-sound", type: "button", "aria-label": "Ton einschalten", hidden: true }, icon("vol0"));
      const info = h("div", { class: "share-info" },
        h("span", { class: "reel-user" }, avatar(post.user, "sm"), h("b", {}, `@${post.user.handle}`)),
        title ? h("p", { class: "reel-title" }, richText(title)) : null,
        caption ? h("p", { class: "reel-text" }, richText(caption)) : null);
      put(stage, top(), info, sound, bar);
      fill(root, stage);
      video.src = media.url;
      video.addEventListener("timeupdate", () => { if (video.duration) bar.firstChild.style.width = `${(video.currentTime / video.duration) * 100}%`; });
      video.addEventListener("ended", gate);
      const start = video.play();
      if (start && start.catch) start.catch(() => { muted = true; video.muted = true; sound.hidden = false; video.play().catch(() => {}); });
      sound.addEventListener("click", () => { muted = false; video.muted = false; sound.hidden = true; video.play().catch(() => {}); });
      listen(document, "pointerdown", () => { if (muted && !locked) { muted = false; video.muted = false; sound.hidden = true; } }, { once: true, passive: true });

      /* the next video, blurred, and the invitation: from now on nothing can be scrolled */
      function gate() {
        if (locked || dead) return;
        locked = true;
        video.pause();
        const other = next && next.media.find((item) => item.video);
        const shown = other || media;
        const blurred = h("video", { class: "share-video blurred", muted: true, loop: true, playsinline: true, autoplay: true, "aria-hidden": "true", tabindex: "-1" });
        blurred.muted = true;
        blurred.src = shown.url;
        stage.classList.add("locked");
        document.documentElement.classList.add("share-locked");
        cleanups.push(() => document.documentElement.classList.remove("share-locked"));
        fill(stage, blurred, top(), h("div", { class: "share-gate" }, invitation()));
        blurred.play().catch(() => {});
      }
      listen(window, "wheel", (event) => { event.preventDefault(); if (event.deltaY > 12) gate(); }, { passive: false });
      listen(window, "keydown", (event) => { if (NAV_KEYS.has(event.key)) { event.preventDefault(); if (event.key !== "ArrowUp" && event.key !== "PageUp" && event.key !== "Home") gate(); } });
      let startY = null;
      listen(stage, "touchstart", (event) => { startY = event.touches[0].clientY; }, { passive: true });
      listen(stage, "touchmove", (event) => { if (locked) event.preventDefault(); }, { passive: false });
      listen(stage, "touchend", (event) => { if (startY !== null && startY - event.changedTouches[0].clientY > 40) gate(); startY = null; }, { passive: true });
      cleanups.push(() => { video.pause(); video.removeAttribute("src"); video.load(); });
    }

    (async () => {
      const reply = await Api.get(`/share/${route.id}`);
      if (dead) return;
      if (!reply.ok) { Y.navigate("/", { replace: true }); return; }
      const { post, next } = reply.data;
      const media = post.media.find((item) => item.video);
      if (media) videoFlow(post, media, next); else cardFlow(post);
    })();

    return {
      element: el, title: "Satürn",
      destroy() { dead = true; for (const undo of cleanups.splice(0)) undo(); },
    };
  };
})();
