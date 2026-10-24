/* Nex stories (yipi-stories.js): the row of round pictures at the top of Home, like on Snapchat and Instagram. Yours comes first with a "+" to add a photo or a short video
   (at most 30 seconds); then the people you follow who have a story from the last 24 hours, the ones you have not seen yet first, with a dark ring (grey once you have seen
   them all). A tap opens the stories full screen: bars at the top show how far it is, a tap on the right side goes on, on the left side back, holding stops it, and when
   somebody's stories are over the next person's start. Stories disappear after 24 hours (the server removes them). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { h, fill, icon, avatar, toast, dialog, confirmBox } = Y;

  const IMAGE_MS = 5000;                                         // how long a photo is shown
  const MAX_CAPTION = 140;

  // ------------------------------------------------------------------------------------------------------------ make one
  /* Opens the file picker, then a small window with the preview and an optional line of text; "Teilen" uploads it and makes it a story. */
  function newStory(onDone) {
    if (!Y.requireLogin("Melde dich an, um eine Story zu teilen.")) return;
    const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    document.body.append(picker);
    picker.addEventListener("change", async () => {
      const file = picker.files[0];
      picker.remove();
      if (!file) return;
      const isVideo = file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(file.name || "");
      let prepared = file;
      let facts = null;
      let url = "";
      if (isVideo) {
        if (!/^video\/(mp4|quicktime|webm)$/.test(file.type) && !/\.(mp4|m4v|mov|webm)$/i.test(file.name || "")) { toast(Api.MESSAGES.bad_video); return; }
        if (file.size > Core.MAX_VIDEO_BYTES) { toast(Api.MESSAGES.video_too_big); return; }
        const read = await Y.readVideo(file);
        url = read.url;
        facts = read.facts;
        if (!facts || !facts.width || !facts.height) { URL.revokeObjectURL(url); toast("Dieses Video kann dein Browser nicht lesen."); return; }
        if (Core.videoTooLong(facts.seconds)) { URL.revokeObjectURL(url); toast(Api.MESSAGES.video_too_long); return; }
      } else {
        if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { toast(Api.MESSAGES.bad_image); return; }
        try { prepared = await Y.prepareImage(file, { max: 1440 }); } catch (error) { toast("Dieses Foto konnte nicht gelesen werden."); return; }
        url = URL.createObjectURL(prepared);
      }
      const caption = h("input", { class: "field", type: "text", maxlength: MAX_CAPTION, placeholder: "Text zur Story (freiwillig)", autocomplete: "off", "aria-label": "Text zur Story" });
      const preview = isVideo ? h("video", { class: "story-preview", src: url, muted: true, loop: true, autoplay: true, playsinline: true, "aria-label": "Vorschau deiner Story" })
        : h("img", { class: "story-preview", src: url, alt: "Vorschau deiner Story" });
      const problem = h("p", { class: "form-error", role: "alert", hidden: true });
      dialog({
        title: "Neue Story",
        body: h("div", { class: "story-new" }, preview, h("label", { class: "field-label" }, h("span", {}, "Text"), caption), h("p", { class: "hint" }, "Deine Story ist 24 Stunden lang für die Leute zu sehen, die dir folgen."), problem),
        onClose: () => URL.revokeObjectURL(url),
        actions: [{ label: "Teilen", kind: "primary", run: async () => {
          problem.hidden = true;
          const up = await Api.upload(prepared, isVideo ? { width: String(facts.width), height: String(facts.height), alt: "Story" } : { alt: "Story" });
          const reply = up.ok ? await Api.post("/stories", { media: up.data.media.id, caption: caption.value }) : up;
          if (!reply.ok) { problem.textContent = Api.message(reply); problem.hidden = false; return false; }
          Y.sound?.play("success");
          toast("Deine Story ist online.");
          onDone?.(reply.data.story);
          return true;
        } }],
      });
    }, { once: true });
    picker.click();
  }

  // ----------------------------------------------------------------------------------------------------------- look at them
  const ago = (iso) => {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    return minutes < 1 ? "gerade eben" : minutes < 60 ? `vor ${minutes} Min.` : `vor ${Math.round(minutes / 60)} Std.`;
  };

  /* Shows the stories of the people in `rings` (the entries of GET /stories), starting with `start`. `onClose()` is called when the window is gone. */
  function openViewer(rings, start, onClose) {
    let ring = start;
    let items = [];
    let at = 0;
    let frame = 0;
    let startedAt = 0;
    let elapsed = 0;
    let length = IMAGE_MS;
    let paused = false;
    let holding = 0;
    let dead = false;
    let token = 0;

    const bars = h("div", { class: "story-bars" });
    const who = h("div", { class: "story-who" });
    const close = h("button", { class: "story-x", type: "button", "aria-label": "Story schließen", onclick: () => finish() }, icon("close"));
    const stage = h("div", { class: "story-stage" });
    const caption = h("p", { class: "story-caption", hidden: true });
    const tools = h("div", { class: "story-tools" });
    const back = h("button", { class: "story-zone left", type: "button", "aria-label": "Zurück" });
    const forward = h("button", { class: "story-zone right", type: "button", "aria-label": "Weiter" });
    const root = h("div", { class: "story-view", role: "dialog", "aria-modal": "true", "aria-label": "Stories" }, stage, back, forward, h("div", { class: "story-top" }, bars, h("div", { class: "story-head" }, who, close)), caption, tools);

    const entry = () => rings[ring];
    const current = () => items[at];

    function stop() { cancelAnimationFrame(frame); frame = 0; }
    function tick(now) {
      if (dead) return;
      if (!paused) elapsed += now - startedAt;
      startedAt = now;
      const share = Math.min(1, elapsed / length);
      const bar = bars.children[at]?.firstChild;
      if (bar) bar.style.width = `${share * 100}%`;
      if (share >= 1) { next(); return; }
      frame = requestAnimationFrame(tick);
    }
    function run() { stop(); startedAt = performance.now(); frame = requestAnimationFrame(tick); }

    function drawBars() {
      fill(bars, ...items.map((_, index) => h("span", { class: "story-bar" }, h("span", { class: "story-bar-fill", style: `width:${index < at ? 100 : 0}%` }))));
    }

    function show() {
      stop();
      const item = current();
      if (!item) { finish(); return; }
      const who_ = entry().user;
      elapsed = 0;
      paused = false;
      length = IMAGE_MS;
      drawBars();
      fill(who, Y.link(`/${who_.handle}`, { class: "story-person", onclick: () => finish() }, avatar(who_, "md"), h("b", {}, entry().isMe ? "Deine Story" : who_.name)), h("span", { class: "story-age" }, ago(item.createdAt)));
      caption.textContent = item.caption || "";
      caption.hidden = !item.caption;
      const media = item.media;
      const holder = h("div", { class: "story-media" });
      if (media && media.video) {
        const video = h("video", { class: "story-video", src: media.url, playsinline: true, autoplay: true, "aria-label": item.caption || "Video einer Story" });
        video.addEventListener("loadedmetadata", () => { if (Number.isFinite(video.duration) && video.duration > 0) length = Math.min(31000, video.duration * 1000); });
        video.addEventListener("ended", () => next());
        video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
        holder.append(video);
        run();
      } else if (media) {
        const image = h("img", { class: "story-image", src: media.url, alt: item.caption || "Foto einer Story" });
        holder.append(image);
        run();
      } else { holder.append(h("p", { class: "story-gone" }, "Das gibt es nicht mehr.")); run(); }
      fill(stage, holder);
      fill(tools, ...(item.mine ? [
        h("span", { class: "story-views" }, icon("views"), `${item.views || 0}`),
        h("button", { class: "story-tool", type: "button", "aria-label": "Story löschen", onclick: removeCurrent }, icon("trash"))] : []));
      if (!item.mine && !item.seen) {
        item.seen = true;
        Api.post(`/stories/${item.id}/seen`);
        entry().unseen = Math.max(0, (entry().unseen || 0) - 1);
      }
    }

    async function load(index, last = false) {
      const mine = ++token;
      const wanted = rings[index];
      if (!wanted) { finish(); return; }
      const reply = await Api.get(`/stories/${wanted.user.handle}`);
      if (dead || mine !== token) return;
      items = reply.ok ? reply.data.items : [];
      if (!items.length) { if (index < rings.length - 1 && !last) { ring = index + 1; load(ring); } else finish(); return; }
      ring = index;
      at = last ? items.length - 1 : Math.max(0, items.findIndex((item) => !item.seen));
      if (at < 0) at = 0;
      show();
    }

    function next() {
      if (at < items.length - 1) { at += 1; show(); return; }
      if (ring < rings.length - 1) { load(ring + 1); return; }
      finish();
    }
    function previous() {
      if (elapsed > 1500 || (at === 0 && ring === 0)) { show(); return; }
      if (at > 0) { at -= 1; show(); return; }
      load(ring - 1, true);
    }
    async function removeCurrent() {
      paused = true;
      if (!(await confirmBox({ title: "Story löschen?", text: "Sie verschwindet sofort für alle.", yes: "Löschen", danger: true }))) { paused = false; return; }
      const item = current();
      const reply = await Api.del(`/stories/${item.id}`);
      if (!reply.ok) { toast(Api.message(reply)); paused = false; return; }
      items.splice(at, 1);
      entry().count = items.length;
      if (!items.length) { finish(); return; }
      at = Math.min(at, items.length - 1);
      show();
    }
    function finish() {
      if (dead) return;
      dead = true;
      stop();
      document.removeEventListener("keydown", onKey, true);
      root.classList.add("closing");
      document.body.classList.remove("modal-open");
      setTimeout(() => root.remove(), 160);
      onClose?.();
    }
    function onKey(event) {
      if (event.key === "Escape") { event.stopPropagation(); finish(); }
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") previous();
      else if (event.key === " ") { paused = !paused; const video = root.querySelector("video"); if (video) (paused ? video.pause() : video.play().catch(() => {})); event.preventDefault(); }
    }

    // a tap goes on or back, holding stops the story for as long as the finger stays
    for (const [zone, go] of [[back, previous], [forward, next]]) {
      zone.addEventListener("pointerdown", () => {
        holding = performance.now();
        paused = true;
        root.querySelector("video")?.pause();
      });
      const release = (event) => {
        if (!holding) return;
        const long = performance.now() - holding > 260;
        holding = 0;
        paused = false;
        root.querySelector("video")?.play().catch(() => {});
        if (!long && event.type === "pointerup") go();
      };
      zone.addEventListener("pointerup", release);
      zone.addEventListener("pointercancel", release);
      zone.addEventListener("pointerleave", release);
    }
    document.addEventListener("keydown", onKey, true);
    document.body.append(root);
    document.body.classList.add("modal-open");
    close.focus();
    load(start);
  }

  // ----------------------------------------------------------------------------------------------------------- the row on Home
  function storiesBar() {
    const row = h("div", { class: "stories", role: "list", "aria-label": "Stories" });
    const element = h("section", { class: "stories-wrap", "aria-label": "Stories" }, row);
    let rings = [];
    let dead = false;

    function circle(entry, index) {
      const person = entry.user;
      const unseen = entry.unseen > 0;
      const button = h("button", { class: `story-btn${unseen ? " unseen" : ""}${entry.isMe ? " mine" : ""}`, type: "button", role: "listitem", "aria-label": entry.isMe ? "Deine Story ansehen" : `Story von ${person.name}${unseen ? " (neu)" : ""}` },
        h("span", { class: "story-ring" }, avatar(person, "lg")), h("span", { class: "story-name" }, entry.isMe ? "Deine Story" : person.name));
      button.addEventListener("click", () => { Y.sound?.play("open"); openViewer(rings, index, () => load()); });
      return button;
    }

    function mineCircle() {
      const own = rings.find((entry) => entry.isMe);
      const add = h("span", { class: "story-add", "aria-hidden": "true" }, icon("plus"));
      if (own) {
        const wrap = h("div", { class: "story-own", role: "listitem" }, circle(own, rings.indexOf(own)),
          h("button", { class: "story-plus", type: "button", "aria-label": "Neue Story hinzufügen", onclick: () => newStory(() => load()) }, icon("plus")));
        return wrap;
      }
      return h("button", { class: "story-btn mine fresh", type: "button", role: "listitem", "aria-label": "Eine Story hinzufügen", onclick: () => newStory(() => load()) },
        h("span", { class: "story-ring" }, avatar(Y.me, "lg"), add), h("span", { class: "story-name" }, "Deine Story"));
    }

    function draw() {
      const others = rings.map((entry, index) => (entry.isMe ? null : circle(entry, index))).filter(Boolean);
      fill(row, mineCircle(), ...others);
    }

    async function load() {
      const reply = await Api.get("/stories");
      if (dead) return;
      rings = reply.ok ? reply.data.items : [];
      draw();
    }

    draw();
    load();
    return { element, reload: load, destroy() { dead = true; } };
  }

  Object.assign(Y, { storiesBar, newStory, openStories: openViewer });
})();
