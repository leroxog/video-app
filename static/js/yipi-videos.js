/* Satürn videos (yipi-videos.js): the Videos tab, made like TikTok -- one video after the other, each as big as the screen, you scroll (or press the
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
    const searchButton = h("button", { class: "reels-side reels-search", type: "button", "aria-label": "Suchen" }, icon("search"));
    const moreButton = h("button", { class: "reels-side reels-more", type: "button", "aria-label": "Mehr", "aria-haspopup": "menu" }, icon("more"));
    moreButton.addEventListener("click", () => active && active.moreMenu ? active.moreMenu(moreButton) : menu(moreButton, [
      { label: "Video hochladen", icon: "film", run: () => Y.newPost({ only: "video" }) },
      { label: "Kamera und Spiele", icon: "camera", run: () => Y.navigate("/camera") },
      { label: "Suchen", icon: "search", run: () => Y.navigate("/explore") },
    ]));
    const top = h("div", { class: "reels-top" }, h("h1", { class: "sr-only" }, "Videos"), searchButton, scopes, moreButton);
    searchButton.addEventListener("click", () => {                  // the magnifier unfolds into a line to write in (the same bar), a cross folds it back
      if (top.classList.contains("searching")) return;
      const form = Y.searchForm("");
      const closeLine = h("button", { class: "reels-side reels-search-close", type: "button", "aria-label": "Suche schließen" }, icon("close"));
      const line = h("div", { class: "reels-searchline" }, form, closeLine);
      closeLine.addEventListener("click", () => { line.remove(); top.classList.remove("searching"); });
      top.classList.add("searching");
      top.append(line);
      form.input.focus();
    });       // (like the sketch: the magnifier, "Folge ich / Für dich", the round button)
    const status = h("div", { class: "reels-status" });
    const el = h("div", { class: "view reels-view" }, top, scroller, status);      // (the strip at the top shows on a phone held upright, where the bar with the lettering is not)
    let shown = 0;                                              // how many videos were put on the page
    const reels = [];
    let offset = shuffle.at;                                    // where the next page starts in the shuffle
    let seed = shuffle.seed;
    let loading = false;
    let ended = false;                                          // the shuffle has been read to its end (the next page shuffles again)
    let dead = false;
    let active = null;
    /* A swipe to the right (mostly sideways, not up or down) opens the profile of the person whose video is on the screen. */
    let swipe = null;
    scroller.addEventListener("touchstart", (event) => { const touch = event.touches[0]; swipe = event.touches.length === 1 && !event.target.closest(".reel-photos") ? { x: touch.clientX, y: touch.clientY } : null; }, { passive: true });
    scroller.addEventListener("touchend", (event) => {
      const start = swipe;
      swipe = null;
      const touch = event.changedTouches[0];
      if (!start || !touch || !active || !active.item) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (dx > 80 && Math.abs(dy) < 45 && dx > Math.abs(dy) * 2.2) Y.navigate(`/${active.item.user.handle}`);
    }, { passive: true });
    /* Shake the phone and the video on the screen gets a like (the sensor of the phone; on iPhones the browser asks once, at the first touch). */
    let lastReading = null;
    let lastShake = 0;
    const onMotion = (event) => {
      const a = event.accelerationIncludingGravity;
      if (!a) return;
      const reading = [a.x || 0, a.y || 0, a.z || 0];
      const jolt = lastReading ? Math.abs(reading[0] - lastReading[0]) + Math.abs(reading[1] - lastReading[1]) + Math.abs(reading[2] - lastReading[2]) : 0;
      lastReading = reading;
      const now = performance.now();
      if (jolt > 30 && now - lastShake > 1500 && active && active.shakeLike) { lastShake = now; active.shakeLike(); }
    };
    if (typeof DeviceMotionEvent !== "undefined") {
      if (typeof DeviceMotionEvent.requestPermission === "function") {
        const ask = () => { scroller.removeEventListener("touchend", ask); DeviceMotionEvent.requestPermission().then((answer) => { if (answer === "granted") addEventListener("devicemotion", onMotion); }).catch(() => {}); };
        scroller.addEventListener("touchend", ask, { once: true });
      } else addEventListener("devicemotion", onMotion);
    }
    /* The Satürn Chest: about every tenth video one may show up (the server decides, with a timer from 10 seconds to 5 minutes). It appears in the middle of the screen and flies at once to the side;
       a tap on it opens a sheet like the one of the "+" with the big chest, a small countdown above it and the button "Öffnen": grey while it is no use to press it, bright when the chest can be
       opened. Then it is a matter of tenths of a second: 0.1 seconds 8 to 13 Tokens, one second 3 to 8, three seconds 0 to 3. */
    let sinceChest = 0;
    let nextChest = 8 + Math.floor(Math.random() * 5);
    let chestBox = null;
    const clockText = (ms) => { const total = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`; };
    async function showChest(info) {
      if (chestBox || dead) return;
      const now = performance.now();
      const opensAt = now + info.opensIn * 1000;
      const closesAt = now + info.closesIn * 1000;
      const state = { phase: "closed", busy: false, sheet: null, readyAt: 0, opensAt, closesAt };
      const pic = h("img", { class: "chest-pic", alt: "", draggable: false, src: "/static/img/samoji/chest-closed.png" });
      const chipTime = h("b", { class: "chest-chip-time" }, clockText(opensAt - now));
      const chip = h("button", { class: "chest-chip pop", type: "button", "aria-label": "Satürn Truhe öffnen" }, pic, chipTime);
      chestBox = { chip, state };
      el.append(chip);
      setTimeout(() => chip.classList.remove("pop"), 1500);       // first in the middle of the screen, then quickly to the side
      const stop = () => { clearInterval(timer); state.sheet?.close(); chip.remove(); chestBox = null; };
      const timer = setInterval(() => {
        const t = performance.now();
        if (t < opensAt) { chipTime.textContent = clockText(opensAt - t); state.sheet?.tick(clockText(opensAt - t), false); }
        else if (t < closesAt) {
          if (state.phase === "closed") { state.phase = "ready"; state.readyAt = t; chip.classList.add("ready"); chipTime.textContent = "Jetzt!"; state.sheet?.ready(); Y.sound?.play("receive"); }
        } else if (!state.busy) { stop(); toast("Die Satürn Truhe ist weg."); }
      }, 100);
      chip.addEventListener("click", () => openChestSheet(info, state, stop));
    }
    /* The sheet with the big chest. */
    async function openChestSheet(info, state, stop) {
      if (state.sheet || dead) return;
      const back = h("div", { class: "skz-sheet-back chest-back" });
      const count = h("small", { class: "chest-count" }, "");
      const host = h("div", { class: "chest-stage" });
      const result = h("b", { class: "chest-result", hidden: true });
      const button = h("button", { class: "chest-open locked", type: "button", "aria-disabled": "true" }, "Öffnen");
      const note = h("small", { class: "chest-note" }, "Noch nicht offen. Gleich leuchtet der Knopf: dann so schnell du kannst!");
      const panel = h("div", { class: "skz-sheet chest-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Satürn Truhe" },
        h("span", { class: "skz-grip", "aria-hidden": "true" }), h("div", { class: "sm-head" }, h("h2", {}, "Satürn Truhe"), h("button", { class: "icon-btn round", type: "button", "aria-label": "Schließen", onclick: () => sheet.close() }, icon("close"))),
        count, host, result, button, note);
      let controller = null;
      const onKey = (event) => { if (event.key === "Escape") { event.stopPropagation(); sheet.close(); } };
      const sheet = {
        close() { controller?.stop(); controller = null; document.removeEventListener("keydown", onKey, true); document.body.classList.remove("modal-open"); back.remove(); state.sheet = null; },
        tick(text) { count.textContent = `Öffnet in ${text}`; },
        ready() { count.textContent = "Jetzt!"; button.classList.remove("locked"); button.classList.add("ready"); button.removeAttribute("aria-disabled"); button.textContent = "Öffnen"; note.textContent = "Tippe jetzt auf Öffnen!"; controller?.mood("ready"); },
      };
      state.sheet = sheet;
      back.addEventListener("click", (event) => { if (event.target === back) sheet.close(); });
      back.append(panel);
      document.body.append(back);
      document.body.classList.add("modal-open");
      document.addEventListener("keydown", onKey, true);
      count.textContent = state.phase === "ready" ? "Jetzt!" : `Öffnet in ${clockText(state.opensAt - performance.now())}`;
      if (state.phase === "ready") sheet.ready();
      const chestPic = h("img", { class: "chest-img", src: "/static/img/samoji/chest-closed.png", alt: "Satürn Truhe", draggable: false });
      host.append(chestPic);
      controller = { mood(name) { host.classList.toggle("ready", name === "ready"); }, open() { host.classList.remove("ready"); host.classList.add("opened"); chestPic.src = "/static/img/samoji/chest-open.png"; }, stop() {} };
      controller.mood(state.phase === "ready" ? "ready" : "locked");
      button.addEventListener("click", async () => {
        if (state.busy) return;
        if (state.phase !== "ready") { panel.classList.add("nudge"); setTimeout(() => panel.classList.remove("nudge"), 350); return; }       // grey: it brings nothing yet
        state.busy = true;
        button.classList.add("pressed");
        const reply = await Api.post(`/chests/${info.id}/open`);
        if (!reply.ok) { toast(Api.message(reply)); state.busy = false; stop(); return; }
        controller?.open();
        const reward = reply.data.reward;
        result.hidden = false;
        result.replaceChildren(...(reward > 0 ? [Y.coin ? Y.coin("big") : "", `+${reward} ${reward === 1 ? "Token" : "Tokens"}`] : ["Zu langsam: leer"]));
        result.classList.toggle("won", reward > 0);
        button.hidden = true;
        note.textContent = reward > 0 ? `Du hast jetzt ${reply.data.tokens} Tokens.` : "Beim nächsten Mal schneller!";
        Y.sound?.play(reward > 0 ? "success" : "unlike");
        if (Y.me) Y.me.tokens = reply.data.tokens;
        Y.samoji?.setTokens(reply.data.tokens);
        setTimeout(() => { state.busy = false; stop(); }, 3200);
      });
    }
    async function askChest(liveOnly) {
      if (!Y.me || chestBox || dead) return;
      const reply = await Api.post("/chests/maybe", liveOnly ? { live: true } : {});
      if (reply.ok && reply.data.chest) showChest(reply.data.chest);
    }
    let lastCounted = null;
    function onReelChange() {
      if (lastCounted === active) return;
      lastCounted = active;
      sinceChest += 1;
      if (sinceChest >= nextChest && !chestBox) { sinceChest = 0; nextChest = 8 + Math.floor(Math.random() * 5); askChest(false); }
    }
    askChest(true);                                             // a chest that is already waiting (the page was opened again) comes back at once
    if (Y.me && !window.__chestWarm) { window.__chestWarm = true; new Image().src = "/static/img/samoji/chest-open.png"; }       // the picture of the open chest is loaded early
    let watching = null;
    let blocked = false;                                        // the browser does not allow sound before the person touches the page

    /* ------------------------------------------------------------------ sound */
    const heard = () => (blocked ? 0 : volume);
    function applySound(reel) {
      reel.video.volume = Math.min(1, Math.max(0, volume / 10)) * (reel.cc && reel.cc.ducking ? 0.12 : 1);       // (a voice speaks the translation: the original sound stays low)
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
    let touched = false;                                        // the person has touched the page once: from then on the browser lets the videos play with sound
    const unlock = () => {
      touched = true;
      if (!blocked) return;
      blocked = false;
      applyAll();
    };
    for (const type of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(type, unlock, { passive: true });

    /* Only a real "the browser does not allow sound yet" (NotAllowedError) turns the sound off for everything; any other failure (the file was swapped while scrolling, it is not loaded yet) just tries again. */
    function play(reel, again = 0) {
      if (reel.photos) { reel.startPhotos(); return; }          // a photo post: the slide show runs, there is no sound
      applySound(reel);
      reel.stage.classList.remove("stuck");
      const attempt = reel.video.play();
      if (attempt && attempt.catch) attempt.catch((error) => {
        if (!error || error.name !== "NotAllowedError") {
          if (again < 3 && active === reel) setTimeout(() => { if (active === reel) play(reel, again + 1); }, 200);
          else if (active === reel) reel.stage.classList.add("stuck");
          return;
        }
        if (touched) {                                          // the person has touched the page already: the sound is allowed, try again without turning anything off
          if (again < 2 && active === reel) setTimeout(() => { if (active === reel) play(reel, again + 1); }, 200);
          return;
        }
        blocked = true;                                         // no sound yet: it starts muted and gets its sound with the first touch
        applyAll();
        reel.video.play().catch(() => reel.stage.classList.add("stuck"));
      });
    }

    /* ------------------------------------------------------------------ loading */
    /* Videos are warmed up in steps, nearest first: the one on the screen loads normally; the next one is ready to play (preload "auto"); the two after it load only their first moments (preload
       "metadata" and a first picture); the next ones after that only get their still picture; everything far away is let go. So the phone never loads whole videos that nobody watches. */
    const warm = (reel, mode) => {
      if (reel.photos) return;                                  // (a photo post has no file to warm up: its pictures load by themselves)
      if (!reel.video.getAttribute("src")) { reel.video.preload = mode; reel.video.src = mode === "metadata" ? `${reel.url}#t=0.1` : reel.url; }
      else if (mode === "auto" && reel.video.preload !== "auto") reel.video.preload = "auto";
    };
    const fetchFile = (reel) => warm(reel, "auto");
    const dress = (reel) => { if (!reel.dressed && /^\/yipi-media\/[0-9a-f]{32}$/.test(reel.url || "")) { reel.dressed = true; reel.video.poster = `${reel.url}/poster`; } };       // (the still picture comes from Bunny when the video is there)
    function letGo(reel) {                                      // far from the screen: no file, no memory
      reel.cc?.stop();
      if (reel.photos) { reel.stopPhotos(); return; }
      if (!reel.video.getAttribute("src")) return;
      reel.video.pause();
      reel.video.removeAttribute("src");
      reel.video.load();
    }
    function manage() {
      const at = reels.indexOf(active);
      if (at < 0) return;
      reels.forEach((reel, index) => {
        const away = index - at;
        if (away === 0) warm(reel, "auto");
        else if (away === 1) { dress(reel); warm(reel, "auto"); }
        else if (away === 2 || away === 3) { dress(reel); warm(reel, "metadata"); }
        else if (away === 4 || away === 5) dress(reel);
        else if (away === -1) warm(reel, "metadata");
        else if (Math.abs(away) > KEEP + 2) letGo(reel);
      });
    }

    function setActive(reel) {
      if (active === reel) return;
      active?.video.pause();
      active?.stopPhotos?.();
      active?.cc?.stop();
      active = reel;
      clearTimeout(watching);
      if (!reel) return;
      const index = reels.indexOf(reel);
      shuffle.at = Math.max(0, reel.position);
      fetchFile(reel);
      reel.video.currentTime = 0;
      play(reel);
      reel.cc?.start();                                         // subtitles and the spoken translation of this video
      if (reel.item.gifts && reel.item.gifts.by && reel.item.gifts.by.length && Y.samoji && !reel.giftsShown) {       // a video that has got presents shows its tally at the edge: the Samojis drop in from the top
        reel.giftsShown = true;
        setTimeout(() => { if (active === reel) Y.samoji.replay(reel.item.gifts.by, reel.tally); }, 500);
      }
      onReelChange();
      manage();
      watching = setTimeout(() => Y.queueView?.(reel.item.id), 1500);
      if (index >= reels.length - 6) more();
      if (reels.length > MAX_REELS && index > MAX_REELS / 2) trim();
    }

    function trim() {                                           // the first ones leave (and the boxes between them), the scroll position is moved by exactly their height
      const drop = reels.splice(0, 10);
      const height = scroller.clientHeight;
      const boundary = reels[0] ? reels[0].element : null;
      let removed = 0;
      for (const made of drop) { watcher?.unobserve(made.element); made.cc?.stop(); made.video.pause(); made.video.removeAttribute("src"); made.video.load(); }
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
        else if (active === reel && !entry.isIntersecting) { reel.video.pause(); reel.stopPhotos?.(); reel.cc?.stop(); active = null; }
      }
    }, { root: scroller, threshold: [0, 0.6, 1] }) : null;

    /* ------------------------------------------------------------------ one video */
    function reel(item, position) {
      const media = item.media.find((entry) => entry.video) || item.media[0];
      const photos = item.media.some((entry) => entry.video) ? null : item.media.filter((entry) => !entry.gif);       // a post without a video: its photos are a slide show (swipe to the side, it also goes on by itself)
      const state = { liked: !!item.viewer.liked, bookmarked: !!item.viewer.bookmarked, likes: item.counts.likes, replies: item.counts.replies, bookmarks: item.counts.bookmarks || 0 };
      const video = h("video", { class: "reel-video", loop: true, muted: true, playsinline: true, preload: "none", "aria-label": item.text || `Video von ${item.user.name}` });
      if (media.width > media.height) video.classList.add("wide");
      const stage = h("div", { class: "reel-stage" });
      const likeCount = h("span", { class: "reel-count" });
      const commentCount = h("span", { class: "reel-count" });
      const like = h("button", { class: "reel-btn", type: "button", "aria-label": "Gefällt mir" }, h("span", { class: "reel-btn-ic" }), likeCount);
      const comment = h("button", { class: "reel-btn", type: "button", "aria-label": "Kommentare" }, h("span", { class: "reel-btn-ic" }, icon("reply")), commentCount);
      const saveCount = h("span", { class: "reel-count" }, "Merken");
      const save = h("button", { class: "reel-btn", type: "button", "aria-label": "Lesezeichen" }, h("span", { class: "reel-btn-ic" }), saveCount);
      const giftCount = h("span", { class: "reel-count" }, item.gifts ? Core.formatCount(item.gifts.count) : "Samoji");
      const gift = Y.samoji && !(Y.me && Y.me.handle === item.user.handle) && !item.user.ai && !item.user.company ? h("button", { class: "reel-btn", type: "button", "aria-label": "Samoji schenken" }, h("span", { class: "reel-btn-ic" }, icon("gift")), giftCount) : null;
      const giftSpot = () => { const box = gift && gift.getBoundingClientRect(); return box && box.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined; };
      const tally = h("div", { class: "gift-tally", "aria-label": "Samojis dieses Videos" });
      if (gift) gift.addEventListener("click", () => Y.samoji.open({ to: item.user.handle, post: item.id, giftFrom: giftSpot(), onSent: (_reply, sent) => {
        const now = item.gifts ? item.gifts.count + 1 : 1;
        const by = item.gifts && item.gifts.by ? item.gifts.by.map((pair) => pair.slice()) : [];
        const row = by.find((pair) => pair[0] === sent[0]);
        if (row) row[1] += 1; else by.push([sent[0], 1]);
        item.gifts = { count: now, last: item.gifts ? item.gifts.last : [], by };
        giftCount.textContent = Core.formatCount(now);
        Y.samoji.tally(tally, by, sent[0]);
      } }));
      const share = h("button", { class: "reel-btn", type: "button", "aria-label": "Teilen", "aria-haspopup": "menu" }, h("span", { class: "reel-btn-ic" }, icon("send")), h("span", { class: "reel-count" }, "Teilen"));
      const cc = !photos && Y.captions ? Y.captions.bind({ video, mediaId: media.id, mine: !!(Y.me && Y.me.handle === item.user.handle), volume: () => (blocked ? 0 : volume / 10) || 0.0001, onChange: () => { const made = reels.find((entry) => entry.video === video); if (made) applySound(made); } }) : null;
      const mine = !!(Y.me && Y.me.handle === item.user.handle);
      const following = !mine && !!item.user.followedByMe;
      // a plus for the people one does not follow, a check for the people one follows (it stays: it is remembered)
      const follow = mine ? null : following ? h("span", { class: "reel-follow done kept", role: "img", "aria-label": `Du folgst @${item.user.handle}` }, icon("check"))
        : h("button", { class: "reel-follow", type: "button", "aria-label": `@${item.user.handle} folgen` }, icon("plus"));
      // the small rounded square at the bottom right with the note: the sound of the video
      const soundButton = Y.music && !photos ? h("button", { class: "reel-sound", type: "button", "aria-label": "Sound dieses Videos", "aria-haspopup": "menu" }, icon("music")) : null;
      if (soundButton) soundButton.addEventListener("click", () => menu(soundButton, [
        { label: "Sound benutzen", icon: "camera", strong: true, run: () => { Y.pendingSong = Y.music.extractedSong(item, media); Y.navigate("/camera"); } },
        !mine ? { label: "Sound melden", icon: "flag", run: () => Y.reportDialog({ postId: item.id, preset: "sound" }) } : null,
        !mine ? { label: "Copyright-Problem melden", icon: "flag", run: () => Y.reportDialog({ postId: item.id, preset: "copyright" }) } : null,
      ]));

      function draw() {
        fill(like.firstChild, icon(state.liked ? "heartFill" : "heart"));
        like.classList.toggle("on", state.liked);
        like.setAttribute("aria-pressed", String(state.liked));
        likeCount.textContent = Core.formatCount(state.likes);
        commentCount.textContent = Core.formatCount(state.replies);
        fill(save.firstChild, icon(state.bookmarked ? "bookmarkFill" : "bookmark"));
        save.classList.toggle("on", state.bookmarked);
        saveCount.textContent = state.bookmarks > 0 ? Core.formatCount(state.bookmarks) : "Merken";
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
      const shakeLike = () => { if (state.liked) return; const box = stage.getBoundingClientRect(); toggleLike(box.left + box.width / 2, box.top + box.height / 2); };
      let tapTimer = 0;
      let doubledAt = 0;
      Y.onDoubleTap(stage, (x, y) => { clearTimeout(tapTimer); doubledAt = performance.now(); if (state.liked) { Y.likeBurst(x, y, { size: 120 }); Y.sound.play("like"); } else toggleLike(x, y); }, { ignore: "button, a, input, .reel-volume, .menu" });
      stage.addEventListener("click", (event) => {                          // one tap stops the video or plays it again (a second tap at once is the like)
        if (event.target.closest("button, a, input, .reel-volume, .menu") || performance.now() - doubledAt < 450) return;
        clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
          const made = reels.find((entry) => entry.video === video);
          if (!made) return;
          if (video.paused) play(made); else { video.pause(); made.stage.classList.add("stuck"); }
        }, 260);
      });
      comment.addEventListener("click", () => Y.commentsSheet(item, (n) => { state.replies = Math.max(0, state.replies + n); draw(); }));
      save.addEventListener("click", async () => {
        if (!Y.requireLogin("Melde dich an, um Lesezeichen zu setzen.")) return;
        const wanted = !state.bookmarked;
        state.bookmarked = wanted;
        state.bookmarks = Math.max(0, state.bookmarks + (wanted ? 1 : -1));
        draw();
        const reply = wanted ? await Api.post(`/posts/${item.id}/bookmark`) : await Api.del(`/posts/${item.id}/bookmark`);
        if (!reply.ok) { state.bookmarked = !wanted; state.bookmarks = Math.max(0, state.bookmarks + (wanted ? -1 : 1)); draw(); toast(Api.message(reply)); } else toast(wanted ? "Zu deinen Lesezeichen hinzugefügt" : "Aus den Lesezeichen entfernt");
      });
      share.addEventListener("click", () => menu(share, Y.shareItems(item)));
      const moreMenu = (anchor) => menu(anchor, [
        Y.downloadVideo ? { label: "Video herunterladen", icon: "download", run: () => Y.downloadVideo(item) } : null,
        { label: "Link kopieren", icon: "link", run: () => Y.copyLink(Y.postPath(item)) },
        { label: "Beitrag öffnen", icon: "reply", run: () => Y.navigate(Y.postPath(item)) },
        cc ? { label: "Untertitel und Sprache", icon: "captions", run: () => Y.captions.sheet(cc) } : null,
        !mine ? { label: "Beitrag melden", icon: "flag", danger: true, run: () => Y.reportDialog({ postId: item.id }) } : null,
        mine || (Y.me && Y.me.isAdmin) ? { label: "Beitrag löschen", icon: "trash", danger: true, run: async () => {
          if (!(await confirmBox({ title: "Beitrag löschen?", text: "Das Video und alles dazu wird gelöscht. Das lässt sich nicht rückgängig machen.", yes: "Löschen", danger: true }))) return;
          const reply = await Api.del(`/posts/${item.id}`);
          if (!reply.ok) { toast(Api.message(reply)); return; }
          toast(mine ? "Dein Beitrag wurde gelöscht." : "Das Video wurde gelöscht (Admin).");
          const at = reels.findIndex((entry) => entry.item === item);
          if (at >= 0) { watcher?.unobserve(reels[at].element); reels[at].video.pause(); reels[at].element.remove(); reels.splice(at, 1); if (active && active.item === item) active = null; }
          if (!reels.length) showEmpty();
        } } : null,
      ]);
      if (follow && follow.tagName === "BUTTON") follow.addEventListener("click", async () => {
        if (!Y.requireLogin("Melde dich an, um zu folgen.")) return;
        const reply = await Api.post(`/users/${item.user.handle}/follow`);
        if (!reply.ok) { toast(Api.message(reply)); return; }
        for (const other of reels) {
          if (other.item.user.handle !== item.user.handle) continue;
          const plus = other.element.querySelector(".reel-follow"), ring = other.element.querySelector(".reel-av");
          if (!plus) continue;
          plus.replaceChildren(icon("check"));                      // the plus turns into a check and stays one: the ring of the picture swells for a moment
          plus.classList.add("done", "kept");
          const pillEl = other.element.querySelector(".reel-pill");
          if (pillEl && pillEl.tagName === "BUTTON") { const done = h("span", { class: "reel-pill done" }, "Folge ich"); pillEl.replaceWith(done); }
          plus.setAttribute("aria-label", `Du folgst @${item.user.handle}`);
          ring?.classList.add("pulse");
          setTimeout(() => ring?.classList.remove("pulse"), 700);
        }
        item.user.followedByMe = true;
        toast(`Du folgst jetzt @${item.user.handle}.`);
      });

      /* the see-through row in the video: a picture of the sound and a slider, no numbers */
      const volumeIcon = h("span", { class: "reel-vol-ic" });
      const volumeButton = h("button", { class: "reel-vol-btn", type: "button", "aria-label": "Ton ausschalten", onclick: () => { blocked = false; setVolume(volume === 0 ? lastLoud : 0); } }, volumeIcon);
      const range = h("input", { class: "reel-range", type: "range", min: "0", max: "10", step: "1", value: String(volume), "aria-label": "Lautstärke" });
      range.addEventListener("input", () => { blocked = false; setVolume(Number(range.value)); });
      const volumeRow = h("div", { class: "reel-volume" }, volumeButton, range);

      const resume = h("button", { class: "reel-resume", type: "button", "aria-label": "Video abspielen", onclick: () => { const made = reels.find((entry) => entry.video === video); if (made) play(made); } }, icon("play"));
      const bar = h("span", { class: "reel-bar" }, h("span", { class: "reel-bar-fill" }));
      video.addEventListener("timeupdate", () => { if (video.duration) bar.firstChild.style.width = `${(video.currentTime / video.duration) * 100}%`; });
      const [title, ...rest] = String(item.text || "").split("\n");
      const caption = rest.join("\n").trim();
      const pill = mine ? null : following ? h("span", { class: "reel-pill done" }, "Folge ich") : h("button", { class: "reel-pill", type: "button", "aria-label": `@${item.user.handle} folgen` }, "Folgen");
      pill?.addEventListener?.("click", () => follow && follow.tagName === "BUTTON" && follow.click());
      const info = h("div", { class: "reel-info" },
        h("div", { class: "reel-author" },
          link(`/${item.user.handle}`, { class: "reel-av2", "aria-label": `Profil von ${item.user.name}` }, avatar(item.user, "md")),
          h("div", { class: "reel-author-text" },
            link(`/${item.user.handle}`, { class: "reel-user" }, h("b", {}, item.user.name)),
            h("span", { class: "reel-handle-row" }, link(`/${item.user.handle}`, { class: "reel-handle" }, `@${item.user.handle}`), pill))),
        title ? h("p", { class: "reel-title" }, richText(title)) : null,
        caption ? h("p", { class: "reel-text" }, richText(caption)) : null,
        Y.linkCardFor ? Y.linkCardFor(item.text, { compact: true }) : null,
        item.camId && Y.tryButton ? Y.tryButton(item.camId) : null);
      const actions = h("div", { class: "reel-actions" },
        h("span", { class: "reel-person" }, link(`/${item.user.handle}`, { class: "reel-av", "aria-label": `Profil von ${item.user.name}` }, avatar(item.user, "lg")), follow),
        like, comment, save, gift, share, soundButton);       // (the sound button is the last one in the column: always exactly under the others) (the three dots at the top open the menu of the video that is on the screen: download, report, link ...)
      let slides = null;
      let photoTimer = 0;
      const stopPhotos = () => { clearInterval(photoTimer); photoTimer = 0; };
      const startPhotos = () => {
        stopPhotos();
        if (!slides || photos.length < 2) return;
        photoTimer = setInterval(() => { const next = (Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)) + 1) % photos.length; slides.scrollTo({ left: next * slides.clientWidth, behavior: "smooth" }); }, 3500);
      };
      if (photos) {
        slides = h("div", { class: "reel-photos" }, photos.map((entry) => h("img", { class: "reel-photo", src: entry.url, alt: entry.alt || "", loading: "lazy", decoding: "async" })));
        const dots = h("div", { class: "reel-dots", hidden: photos.length < 2 }, photos.map((entry, index) => h("i", { class: index === 0 ? "on" : "" })));
        slides.addEventListener("scroll", () => { const at = Math.round(slides.scrollLeft / Math.max(1, slides.clientWidth)); [...dots.children].forEach((dot, index) => dot.classList.toggle("on", index === at)); }, { passive: true });
        stage.classList.add("photos");
        put(stage, slides, dots, info);
      } else put(stage, video, cc ? cc.element : null, volumeRow, resume, bar, info);
      const element = h("section", { class: "reel", "data-id": String(item.id), "aria-label": `Video von ${item.user.name}` }, stage, tally, actions);
      draw();
      return { element, video, stage, item, url: media.url, draw, position, volumeIcon, volumeButton, range, cc, moreMenu, shakeLike, giftSpot, tally, photos, startPhotos, stopPhotos };
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
        if (!item.media || !item.media.some((entry) => entry.video || !entry.gif)) return;       // videos and photo posts
        if (!wrapped && reels.some((other) => other.item.id === item.id)) return;          // (the video that was chosen on Home is already the first one; when the whole list has been seen the videos come round again)
        const made = reel(item, first + index);
        applySound(made);
        reels.push(made);
        scroller.append(made.element);
        watcher?.observe(made.element);
        shown += 1;
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
      fill(scopes, ...[["following", "Folge ich"], ["foryou", "Für dich"]].map(([id, label]) => h("button", { class: `reels-scope-btn${id === scope ? " on" : ""}`, type: "button", role: "tab", "aria-selected": String(id === scope), onclick: () => { if (id === scope) return; scope = id; drawScopes(); reset(); } }, label)));
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
        if (chestBox) { chestBox.state.sheet?.close(); chestBox.chip.remove(); }
        removeEventListener("devicemotion", onMotion);
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
