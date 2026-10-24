/* Nex new post (yipi-newpost.js): what happens when somebody taps the "+" -- a small pop-up (it pops open) asks "Beitrag" or "Video".
   "Beitrag" opens the template for a post (the field "Text" at the top, photos, GIF or a poll below it, and hashtags that are added one by one
   and shown in light pink); "Video" opens the template for a video (the name is required, then the video itself, at most 30 seconds, then
   hashtags; the upload shows how far it has come). */
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

  /* The template for a video: name (required), the video (at most 30 seconds, the milliseconds do not count), hashtags. */
  function composeVideo({ file: given } = {}) {
    if (!Y.requireLogin("Melde dich an, um ein Video hochzuladen.")) return null;
    let picked = null;                                            // {file, url, width, height}
    let busy = false;
    let entry = null;
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
        fill(slot, h("button", { class: "vt-drop", type: "button", onclick: () => picker.click() }, h("span", { class: "vt-drop-ic" }, icon("film")), h("b", {}, "Video auswählen"), h("span", { class: "hint" }, "MP4, MOV oder WebM · höchstens 30 Sekunden · bis 25 MB")));
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
      const up = await Api.upload(picked.file, { alt: title, width: String(picked.width), height: String(picked.height) }, (fraction) => {
        bar.style.width = `${Math.round(fraction * 100)}%`;
        progress.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
        if (fraction >= 1) submit.textContent = "Wird verarbeitet …";
      });
      const reply = up.ok ? await Api.post("/posts", { text, media: [up.data.media.id] }) : up;
      busy = false;
      submit.classList.remove("busy");
      submit.textContent = "Hochladen";
      if (!reply.ok) { progress.hidden = true; fail(Api.message(reply)); update(); drawSlot(); return; }
      URL.revokeObjectURL(picked.url);
      entry.close();
      Y.onPosted?.(reply.data.post, {});
      toast("Dein Video ist online.", { label: "Ansehen", run: () => Y.navigate(Core.buildPath({ name: "videos" })) });
    }

    name.addEventListener("input", update);
    name.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); if (!submit.disabled) send(); } });
    picker.addEventListener("change", () => { const file = picker.files[0]; picker.value = ""; if (file) take(file); });
    submit.addEventListener("click", send);
    drawSlot();
    const body = h("div", { class: "template video-template" },
      h("div", { class: "field-head" }, h("label", { class: "field-title", for: "vt-name" }, "Name"), h("span", { class: "hint req" }, "Pflichtfeld")), name, nameCount,
      h("div", { class: "field-head" }, h("span", { class: "field-title" }, "Video"), h("span", { class: "hint" }, "höchstens 30 Sekunden")), slot, picker, problem, progress,
      tags.element,
      h("div", { class: "template-foot" }, submit));
    name.id = "vt-name";
    entry = dialog({ title: "Neues Video", label: "Neues Video", body, initialFocus: name, onClose: () => { if (picked && !busy) URL.revokeObjectURL(picked.url); } });
    if (given) take(given);
    update();
    return entry;
  }

  /* ----------------------------------------------------------------------------------------------- the "+" pop-up */
  function newPost({ anchor, only } = {}) {
    if (!Y.requireLogin("Melde dich an, um etwas hochzuladen.")) return null;
    if (only === "video") return composeVideo();
    if (only === "post") return Y.compose();
    let entry = null;
    const tile = (label, text, symbol, run) => h("button", { class: "pc-tile", type: "button", role: "menuitem", onclick: () => { entry.close(); run(); } },
      h("span", { class: "pc-ic" }, icon(symbol)), h("span", { class: "pc-text" }, h("b", {}, label), h("span", { class: "hint" }, text)), h("span", { class: "pc-go", "aria-hidden": "true" }, icon("chevron")));
    const tiles = h("div", { class: "pc-tiles" }, tile("Beitrag", "Text, Fotos, GIF", "feather", () => Y.compose()), tile("Video", "bis 30 Sekunden", "film", () => composeVideo()),
      tile("Story", "Foto oder Video, 24 Stunden", "image", () => Y.newStory(() => Y.refreshStories?.())));
    if (!anchor) {
      entry = dialog({ title: "Was möchtest du hochladen?", body: tiles });
      return entry;
    }
    const pop = h("div", { class: "menu post-choose", role: "menu", "aria-label": "Was möchtest du hochladen?" }, h("p", { class: "pc-title" }, "Was möchtest du hochladen?"), tiles);
    const placed = floating(anchor, pop, { arrows: true });
    entry = { close: placed.close };
    return entry;
  }

  Object.assign(Y, { newPost, composeVideo, hashtagEditor, readVideo });
})();
