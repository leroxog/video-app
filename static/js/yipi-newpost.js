/* Satürn new post (yipi-newpost.js): what happens when somebody taps the "+" or "Posten": a page of its own (white, in the round font of the sign-up) asks "Was willst du hochladen?"
   with "Ein Video" on the left and "Ein Beitrag" on the right (/new). "Ein Beitrag" is a whole page for a post, like the one of X (/new/post: the field "Text" at the top, photos, a sticker or a poll
   below it, and hashtags that are added one by one and shown in light pink); "Ein Video" is a whole page for a video, like the one of TikTok (/new/video: the video in a tall frame, the name,
   which is required, the video itself, at most 120 seconds, then hashtags; the upload shows how far it has come). A reply or a quote is still a window (yipi-components.js). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Core = window.YipiCore;
  const Api = window.YipiApi;
  const { fill, h, icon, toast, dialog, floating } = Y;

  const MAX_TAGS = 8;
  const MAX_NAME = 80;

  /* The row of hashtags below a text: type one (with or without #) and press Enter, space or comma; each becomes a chip that can be removed.
     `room()` says how many characters of the post are still free, a tag that does not fit is not taken. */
  function hashtagEditor({ onChange, room } = {}) {
    const tags = [];
    const input = h("input", { class: "field tag-input", type: "text", maxlength: 30, placeholder: "#Hashtag hinzufügen", autocomplete: "off", autocapitalize: "off", enterkeyhint: "done", "aria-label": "Hashtag hinzufügen" });
    const chips = h("div", { class: "tag-chips", hidden: true });
    const add = h("button", { class: "icon-btn tag-add", type: "button", "aria-label": "Hashtag hinzufügen" }, icon("plus"));
    const note = h("p", { class: "hint tag-note", hidden: true });

    const clean = (raw) => raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 30);
    const text = () => tags.map((tag) => `#${tag}`).join(" ");
    function draw() {
      chips.hidden = !tags.length;
      fill(chips, ...tags.map((tag, index) => h("span", { class: "tag-chip" }, `#${tag}`,
        h("button", { class: "tag-x", type: "button", "aria-label": `#${tag} entfernen`, onclick: () => { tags.splice(index, 1); draw(); onChange?.(); } }, icon("close")))));
    }
    function commit() {
      note.hidden = true;
      for (const part of input.value.split(/[\s,]+/)) {
        const tag = clean(part);
        if (!part) continue;
        if (tag.length < 2) { note.textContent = "Ein Hashtag braucht mindestens 2 Buchstaben oder Zahlen."; note.hidden = false; continue; }
        if (tags.some((other) => other.toLowerCase() === tag.toLowerCase())) continue;
        if (tags.length >= MAX_TAGS) { note.textContent = `Mehr als ${MAX_TAGS} Hashtags gehen nicht.`; note.hidden = false; break; }
        if (room && room() < tag.length + 2) { note.textContent = "So viele Zeichen sind nicht mehr frei."; note.hidden = false; break; }
        tags.push(tag);
      }
      input.value = "";
      draw();
      onChange?.();
    }
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "," || event.key === " ") { event.preventDefault(); event.stopPropagation(); commit(); }
      else if (event.key === "Backspace" && !input.value && tags.length) { tags.pop(); draw(); onChange?.(); }
    });
    input.addEventListener("blur", () => { if (input.value) commit(); });
    add.addEventListener("click", () => { commit(); input.focus(); });
    const element = h("div", { class: "tag-editor" }, h("div", { class: "field-head" }, h("span", { class: "field-title" }, "Hashtags"), h("span", { class: "hint" }, "freiwillig")), chips, h("div", { class: "tag-row" }, input, add), note);
    return { element, tags: () => tags.slice(), text, count: () => (tags.length ? text().length + 2 : 0), clear() { tags.length = 0; input.value = ""; note.hidden = true; draw(); }, commit };
  }

  /* ------------------------------------------------------------------------------------------------------ video */
  function readVideo(file) {
    const url = URL.createObjectURL(file);
    const probe = h("video", { preload: "metadata", muted: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ url, facts: null }), 10000);
      probe.addEventListener("loadedmetadata", () => { clearTimeout(timer); resolve({ url, facts: { width: probe.videoWidth, height: probe.videoHeight, seconds: probe.duration } }); });
      probe.addEventListener("error", () => { clearTimeout(timer); resolve({ url, facts: null }); });
      probe.src = url;
    }).then((result) => { probe.removeAttribute("src"); return result; });
  }

  /* The template for a video: name (required), the video (at most 120 seconds, the milliseconds do not count), hashtags. Returns {body, focus, destroy}; `done()` is called when the video is online. */
  function videoTemplate({ file: given, camId = "", done = () => {} } = {}) {
    let picked = null;                                            // {file, url, width, height}
    let busy = false;
    const name = h("input", { class: "field", type: "text", maxlength: MAX_NAME, placeholder: "Wie heißt dein Video?", autocomplete: "off", "aria-label": "Name des Videos (Pflichtfeld)", "aria-required": "true" });
    const nameCount = h("span", { class: "hint" }, `0 / ${MAX_NAME}`);
    const picker = h("input", { type: "file", accept: "video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm", hidden: true, "aria-hidden": "true", tabindex: "-1" });
    const slot = h("div", { class: "vt-slot" });
    const bar = h("span", { class: "vt-fill" });
    const progress = h("div", { class: "vt-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "Fortschritt des Hochladens", hidden: true }, bar);
    const tags = hashtagEditor({ onChange: () => update(), room: () => Core.MAX_POST - Core.charCount(name.value) - 1 });
    const submit = h("button", { class: "btn primary vt-submit", type: "button", disabled: true }, "Hochladen");
    const problem = h("p", { class: "vt-problem", role: "alert", hidden: true });

    const fail = (text) => { problem.textContent = text; problem.hidden = !text; };
    function update() {
      const length = Array.from(name.value.trim()).length;
      nameCount.textContent = `${length} / ${MAX_NAME}`;
      submit.disabled = busy || !length || !picked;
    }
    function drawSlot() {
      if (!picked) {
        fill(slot, h("button", { class: "vt-drop", type: "button", onclick: () => picker.click() }, h("span", { class: "vt-drop-ic" }, icon("film")), h("b", {}, "Video auswählen"), h("span", { class: "hint" }, "MP4, MOV oder WebM · höchstens 120 Sekunden · bis 250 MB")));
        return;
      }
      fill(slot, h("div", { class: "vt-preview" },
        h("video", { src: picked.url, controls: true, muted: true, playsinline: true, preload: "metadata", "aria-label": "Vorschau deines Videos" }),
        h("button", { class: "pv-x", type: "button", "aria-label": "Video entfernen", disabled: busy, onclick: () => { URL.revokeObjectURL(picked.url); picked = null; drawSlot(); update(); } }, icon("close"))));
    }
    async function take(file) {
      fail("");
      if (!/^video\/(mp4|quicktime|webm)$/.test(file.type) && !/\.(mp4|m4v|mov|webm)$/i.test(file.name || "")) { fail(Api.MESSAGES.bad_video); return; }
      if (file.size > Core.MAX_VIDEO_BYTES) { fail(Api.MESSAGES.video_too_big); return; }
      const { url, facts } = await readVideo(file);
      if (!facts || !facts.width || !facts.height) { URL.revokeObjectURL(url); fail("Dieses Video kann dein Browser nicht lesen. Probier ein MP4 mit dem üblichen Format (H.264)."); return; }
      if (Core.videoTooLong(facts.seconds)) { URL.revokeObjectURL(url); fail(Api.MESSAGES.video_too_long); return; }
      if (picked) URL.revokeObjectURL(picked.url);
      picked = { file, url, width: facts.width, height: facts.height };
      drawSlot();
      update();
    }

    async function send() {
      const title = Core.cleanText(name.value).replace(/\n+/g, " ");
      if (busy || !title || !picked) return;
      const text = Core.cleanText(`${title}${tags.tags().length ? `\n${tags.text()}` : ""}`);
      if (Core.charCount(text) > Core.MAX_POST) { fail("Name und Hashtags sind zusammen zu lang."); return; }
      busy = true;
      fail("");
      progress.hidden = false;
      bar.style.width = "0%";
      submit.classList.add("busy");
      submit.textContent = "Lädt hoch …";
      update();
      const fields = { alt: title, width: String(picked.width), height: String(picked.height), captions: "1", lang: String(navigator.language || "de").slice(0, 2).toLowerCase() };
      const pitch = Y.captions && Y.captions.pitchOf ? await Y.captions.pitchOf(picked.file) : "";          // (the pitch of the voice: women and men get their own voice in the translation)
      if (pitch) fields.pitch = pitch;
      const up = await Api.upload(picked.file, fields, (fraction) => {
        bar.style.width = `${Math.round(fraction * 100)}%`;
        progress.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
        if (fraction >= 1) submit.textContent = "Wird verarbeitet …";
      });
      const reply = up.ok ? await Api.post("/posts", { text, media: [up.data.media.id], ...(camId ? { camId } : {}) }) : up;
      busy = false;
      submit.classList.remove("busy");
      submit.textContent = "Hochladen";
      if (!reply.ok) { progress.hidden = true; fail(Api.message(reply)); update(); drawSlot(); return; }
      URL.revokeObjectURL(picked.url);
      picked = null;
      Y.onPosted?.(reply.data.post, {});
      done();
      toast("Dein Video ist online.", { label: "Ansehen", run: () => Y.navigate(Core.buildPath({ name: "videos" })) });
    }

    name.addEventListener("input", update);
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); if (!submit.disabled) send(); } });
    picker.addEventListener("change", () => { const file = picker.files[0]; picker.value = ""; if (file) take(file); });
    submit.addEventListener("click", send);
    drawSlot();
    const nameHead = h("div", { class: "field-head" }, h("label", { class: "field-title", for: "vt-name" }, "Name"), h("span", { class: "hint req" }, "Pflichtfeld"));
    const body = h("div", { class: "template video-template vt-page" },                       // the video in a tall frame on the left, the name and the hashtags on the right (one under the other on a phone)
      h("div", { class: "vt-left" }, slot, picker, h("p", { class: "hint vt-limit" }, "höchstens 120 Sekunden")),
      h("div", { class: "vt-right" }, nameHead, name, nameCount, problem, progress, tags.element, h("div", { class: "template-foot" }, submit)));
    name.id = "vt-name";
    if (given) take(given);
    update();
    return { body, focus: () => name.focus(), destroy() { if (picked && !busy) URL.revokeObjectURL(picked.url); } };
  }

  /* A page like the one of the sign-up: white, the round font, a button to go back at the top left and a column in the middle. `body` is what the page holds. */
  function whitePage({ back, closeIcon = "back", label, wide = false, body, modifier = "" }) {
    const top = h("div", { class: "au-top" }, h("button", { class: "au-back", type: "button", "aria-label": label || "Zurück", onclick: () => Y.back(back) }, icon(closeIcon)), h("span", { class: "au-back-gap" }));
    return h("div", { class: "view au-holder" }, h("div", { class: `au auth-white nu ${modifier}` }, top, h("div", { class: "au-main nu-main" }, h("div", { class: `nu-column${wide ? " wide" : ""}` }, body))));
  }

  /* ---------------------------------------------------------------------------------------------- the pages */
  const pages = {};                                           // the views of these pages (yipi-views.js takes them into Y.views: it is loaded after this file)
  function chooseCard(kind, title, text, symbol, go) {
    return h("button", { class: `nu-card ${kind}`, type: "button", onclick: go },
      h("span", { class: "nu-ic", "aria-hidden": "true" }, icon(symbol)), h("b", {}, title), h("small", {}, text));
  }

  /* /new: "Was willst du hochladen?": a video on the left, a post on the right. */
  pages.new = function chooseView() {
    if (!Y.requireLogin("Melde dich an, um etwas hochzuladen.")) return { element: h("div", { class: "view" }), title: "Hochladen" };
    const body = h("div", { class: "nu-choose" },
      h("h1", { class: "au-title nu-title" }, "Was willst du hochladen?"),
      h("div", { class: "nu-choices" },
        chooseCard("video", "Ein Video", "Hochkant, bis 120 Sekunden", "film", () => Y.navigate("/new/video")),
        chooseCard("post", "Ein Beitrag", "Text, Fotos, Sticker, Umfrage", "feather", () => Y.navigate("/new/post"))),
      h("button", { class: "nu-story", type: "button", onclick: () => Y.newStory(() => { Y.refreshStories?.(); Y.back(); }) }, icon("image"), "Oder eine Story für 24 Stunden"));
    return { element: whitePage({ back: "/", closeIcon: "close", label: "Schließen", body, modifier: "nu-choosing" }), title: "Hochladen" };
  };

  /* /new/post: a whole page for a post (what a photo from the camera or a text of Nex AI brings along is waiting in Y.pendingPost). */
  pages.newpost = function postView() {
    if (!Y.requireLogin("Melde dich an, um zu posten.")) return { element: h("div", { class: "view" }), title: "Neuer Beitrag" };
    const pending = Y.pendingPost || {};
    Y.pendingPost = null;
    const box = Y.composer({
      template: true, autofocus: true, text: pending.text, files: pending.files,
      onPosted: (post) => {
        pending.onPosted?.(post);
        Y.onPosted?.(post, {});
        Y.navigate("/", { replace: true });
        toast("Dein Beitrag wurde gesendet.", { label: "Anzeigen", run: () => Y.navigate(Y.postPath(post)) });
      },
    });
    const body = h("div", { class: "nu-post" }, h("h1", { class: "au-title nu-title left" }, "Ein Beitrag"), h("p", { class: "au-sub nu-sub left" }, "Schreib, was gerade los ist."), box);
    return { element: whitePage({ back: "/new", label: "Zurück", wide: true, body, modifier: "nu-posting" }), title: "Neuer Beitrag", onShow() { box.focusText?.(); } };
  };

  /* /new/video: a whole page for a video (the video in a tall frame next to the name and the hashtags; one under the other on a phone). */
  pages.newvideo = function videoView() {
    if (!Y.requireLogin("Melde dich an, um ein Video hochzuladen.")) return { element: h("div", { class: "view" }), title: "Neues Video" };
    const pending = Y.pendingVideo || {};
    Y.pendingVideo = null;
    const template = videoTemplate({ file: pending.file, camId: pending.camId || "", done: () => Y.navigate("/videos", { replace: true }) });
    const body = h("div", { class: "nu-video" }, h("h1", { class: "au-title nu-title left" }, "Ein Video"), h("p", { class: "au-sub nu-sub left" }, "Zeig es allen, hochkant und bis zu 120 Sekunden lang."), template.body);
    return { element: whitePage({ back: "/new", label: "Zurück", wide: true, body, modifier: "nu-videoing" }), title: "Neues Video", onShow() { if (!pending.file) template.focus(); }, destroy() { template.destroy(); } };
  };

  /* A video that was made in the camera (or chosen) goes to its page. */
  function composeVideo(options = {}) {
    if (!Y.requireLogin("Melde dich an, um ein Video hochzuladen.")) return null;
    Y.pendingVideo = options;
    Y.navigate("/new/video");
    return null;
  }

  /* ----------------------------------------------------------------------------------------------- the "+" */
  /* "+" and "Posten": the page "Was willst du hochladen?" (or, when the place already knows what it is, the page of the video or of the post). */
  function newPost({ only } = {}) {
    if (!Y.requireLogin("Melde dich an, um etwas hochzuladen.")) return null;
    Y.navigate(only === "video" ? "/new/video" : only === "post" ? "/new/post" : "/new");
    return null;
  }

  Object.assign(Y, { newPost, composeVideo, hashtagEditor, readVideo, uploadPages: pages });
})();
