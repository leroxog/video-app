/* Satürn subtitles and spoken translation (yipi-captions.js): every video can show subtitles in the language that is spoken in it and in German, English and twenty other languages, and can be
   "dubbed": a voice reads the translation aloud, a woman's voice where a woman speaks and a man's voice where a man speaks, while the original sound is turned down.
   The texts come from the server (yipi_captions.py: speech recognition and translation by Groq, kept once per video and language). The voice is the speech synthesis of the device of the viewer
   (window.speechSynthesis): nothing is sent for it, and a language without a voice on the device cannot be spoken (the list says so). `Y.captions.bind` makes the controller of one video,
   `Y.captions.sheet(controller)` the window to choose the languages, `Y.captions.pitchOf(file)` measures the pitch of the voice in a video that is being uploaded (a number every tenth of a second). */
(function () {
  "use strict";

  const Y = window.Yipi;
  const Api = window.YipiApi;
  const { h, icon, toast, fill, dialog } = Y;

  /* [code, name, language tag of the voice]: the same twenty-two as LANGUAGES in yipi_captions.py */
  const LANGUAGES = [
    ["de", "Deutsch", "de-DE"], ["en", "Englisch", "en-US"], ["es", "Spanisch", "es-ES"], ["fr", "Französisch", "fr-FR"], ["it", "Italienisch", "it-IT"], ["pt", "Portugiesisch", "pt-BR"],
    ["nl", "Niederländisch", "nl-NL"], ["pl", "Polnisch", "pl-PL"], ["tr", "Türkisch", "tr-TR"], ["ru", "Russisch", "ru-RU"], ["uk", "Ukrainisch", "uk-UA"], ["ar", "Arabisch", "ar-SA"],
    ["hi", "Hindi", "hi-IN"], ["ja", "Japanisch", "ja-JP"], ["ko", "Koreanisch", "ko-KR"], ["zh", "Chinesisch", "zh-CN"], ["sv", "Schwedisch", "sv-SE"], ["da", "Dänisch", "da-DK"],
    ["no", "Norwegisch", "nb-NO"], ["fi", "Finnisch", "fi-FI"], ["el", "Griechisch", "el-GR"], ["cs", "Tschechisch", "cs-CZ"],
  ];
  const KEY = "saturn.cc";
  const DUCK = 0.12;                                               // how loud the original sound stays while a voice speaks the translation
  const POLL_MS = 3000;
  const POLL_TRIES = 25;

  // ------------------------------------------------------------------------------------------------------------ what the person chose
  const CODES = new Set(LANGUAGES.map((entry) => entry[0]));
  let prefs = { sub: "off", audio: "orig" };                       // subtitles: "off" (until somebody switches them on), "orig" or a language; the voice: "orig" (the original sound) or a language
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved && typeof saved === "object") prefs = { sub: saved.sub === "off" || saved.sub === "orig" || CODES.has(saved.sub) ? saved.sub : "off", audio: saved.audio === "orig" || CODES.has(saved.audio) ? saved.audio : "orig" };
  } catch (error) { /* storage blocked */ }
  const controllers = new Set();                                   // the videos that are shown right now (the choice of the person reaches them at once)
  function choose(next) {
    prefs = { ...prefs, ...next };
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (error) { /* storage blocked */ }
    for (const controller of controllers) controller.refresh();
  }

  // ------------------------------------------------------------------------------------------------------------ the voices of the device
  let voices = [];
  const synth = window.speechSynthesis || null;
  const readVoices = () => { voices = synth ? synth.getVoices() : []; };
  if (synth) { readVoices(); if (synth.addEventListener) synth.addEventListener("voiceschanged", readVoices); }
  const FEMALE = /female|frau|woman|weiblich|zira|hazel|susan|samantha|victoria|karen|moira|tessa|fiona|anna|helena|katja|hedda|amelie|marie|paulina|elsa|sabina|helga|vicki|allison|ava\b|joana|monica|lucia|ioana|milena|yelda|kyoko|sin-ji|mei-jia|ting-ting|laura|sara|nora|alva|satu|kalliope|zuzana|alice|claire|julie|eva\b|heera|kalpana|ayumi|haruka/i;
  const MALE = /\bmale\b|\bmann\b|david|\bmark\b|george|daniel|thomas|alex\b|fred\b|yannick|stefan|hans\b|jorge|diego|lucas|ralf|markus|paul\b|guy\b|ryan|oliver|rishi|kaan|filip|hemant|ichiro|takumi|jun\b|stefanos|jakub|claude|pablo|cosimo|luca\b|mikko|magnus|bjorn|erik|xander|jonas|bart|maarten/i;
  const isFemale = (voice) => FEMALE.test(voice.name);
  const isMale = (voice) => !isFemale(voice) && MALE.test(voice.name);

  const baseOf = (tag) => String(tag).toLowerCase().split(/[-_]/)[0];
  /* A voice for a language and a sex ("f", "m" or ""): {voice, fits} where `fits` says that the name of the voice is of that sex; null when the device has no voice for the language. */
  function voiceFor(tag, sex) {
    const same = voices.filter((voice) => voice.lang && baseOf(voice.lang) === baseOf(tag));
    if (!same.length) return null;
    const exact = same.filter((voice) => voice.lang.toLowerCase().replace("_", "-") === tag.toLowerCase());
    const pool = exact.length ? exact : same;
    const fit = sex === "f" ? pool.find(isFemale) : sex === "m" ? pool.find(isMale) : null;
    return { voice: fit || pool.find((voice) => voice.localService) || pool[0], fits: !!fit };
  }
  const canSpeak = (code) => { const entry = LANGUAGES.find((language) => language[0] === code); return !!(synth && entry && voiceFor(entry[2], "")); };

  // ------------------------------------------------------------------------------------------------------------ one video
  /* `{video, mediaId, volume() -> 0..1, onChange()}`: the controller of one video. `element` is the subtitle line (put it into the picture), `start()` and `stop()` are called when the
     video becomes the one that is shown or leaves, `state` says what is going on for the window of the choice. */
  function bind({ video, mediaId, mine = false, volume = () => 1, onChange = () => {} }) {
    const line = h("span", { class: "reel-subs-line" });
    const element = h("div", { class: "reel-subs", hidden: true, "aria-hidden": "true" }, line);
    const cache = new Map();                                        // language -> {status, segments, original, lang}
    const loading = new Map();                                      // language -> Promise
    let running = false;
    let timer = 0;
    let last = 0;
    let lastSex = "";
    const spoken = new Set();
    const controller = {
      element, mediaId, mine, state: { original: null, sub: null, audio: null }, ducking: false, listeners: new Set(),
      /* The maker of the video says which language is spoken: everything is heard again in that language. */
      async redo(lang) {
        const reply = await Api.post(`/videos/${mediaId}/captions/redo`, { lang });
        if (!reply.ok) { toast(Api.message(reply)); return false; }
        cache.clear();
        controller.state.original = null;
        controller.refresh();
        return true;
      },
      start() { running = true; controllers.add(controller); clearInterval(timer); timer = setInterval(tick, 120); controller.refresh(); },
      stop() { running = false; controllers.delete(controller); clearInterval(timer); cancelSpeech(); element.hidden = true; controller.ducking = false; onChange(); },
      refresh,
    };

    function say() { for (const listener of controller.listeners) listener(controller.state); }

    /* what the server says for a language, polled while it is being made */
    function fetchLanguage(lang) {
      if (cache.has(lang) && cache.get(lang).status === "ready") return Promise.resolve(cache.get(lang));
      if (loading.has(lang)) return loading.get(lang);
      const task = (async () => {
        for (let attempt = 0; attempt < POLL_TRIES; attempt += 1) {
          if (!running && attempt > 0) break;
          const reply = await Api.get(`/videos/${mediaId}/captions?lang=${lang}`);
          if (!reply.ok) return { status: "error" };
          const data = reply.data;
          if (data.original) controller.state.original = data.original;
          if (data.status !== "pending") { cache.set(lang, data); return data; }
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
        return { status: "error" };
      })().finally(() => loading.delete(lang));
      loading.set(lang, task);
      return task;
    }

    function refresh() {
      if (!running) return;
      const wantSub = prefs.sub === "off" ? null : prefs.sub;
      const wantAudio = prefs.audio === "orig" ? null : prefs.audio;
      controller.state.sub = wantSub ? "loading" : null;
      controller.state.audio = wantAudio ? "loading" : null;
      controller.ducking = false;
      element.hidden = !wantSub;
      line.textContent = "";
      cancelSpeech();
      spoken.clear();
      say();
      onChange();
      if (wantSub) fetchLanguage(wantSub).then((data) => { if (prefs.sub === wantSub) { controller.state.sub = data.status; say(); } });
      if (wantAudio) fetchLanguage(wantAudio).then((data) => { if (prefs.audio === wantAudio) { controller.state.audio = data.status; controller.ducking = data.status === "ready" && canSpeak(wantAudio); say(); onChange(); } });
    }

    const at = (data, time) => (data && data.segments ? data.segments.findIndex((segment) => time >= segment.s && time < segment.e + 0.15) : -1);

    function cancelSpeech() { if (synth && synth.speaking) synth.cancel(); }

    function speak(data, index) {
      const segment = data.segments[index];
      const entry = LANGUAGES.find((language) => language[0] === data.lang) || LANGUAGES[0];
      const sex = segment.g || lastSex;
      if (segment.g) lastSex = segment.g;
      const found = voiceFor(entry[2], sex);
      if (!found) return;
      const utterance = new SpeechSynthesisUtterance(segment.t);
      utterance.lang = entry[2];
      utterance.voice = found.voice;
      utterance.pitch = found.fits || !sex ? 1 : sex === "m" ? 0.72 : 1.25;             // (a voice of the other sex is bent towards the right one)
      utterance.volume = Math.min(1, Math.max(0, volume()));
      const room = Math.max(0.9, segment.e - segment.s + 0.5);
      utterance.rate = Math.min(1.9, Math.max(0.9, (segment.t.length / 13) / room));
      synth.cancel();
      synth.speak(utterance);
    }

    function tick() {
      if (!running) return;
      const time = video.currentTime;
      if (time + 0.4 < last) { spoken.clear(); cancelSpeech(); }                         // the video went back (a loop, a jump)
      last = time;
      const sub = prefs.sub === "off" ? null : cache.get(prefs.sub);
      if (sub && sub.status === "ready") {
        const index = at(sub, time);
        const text = index >= 0 ? sub.segments[index].t : "";
        if (line.textContent !== text) line.textContent = text;
        element.hidden = !text;
      } else if (!element.hidden && prefs.sub !== "off") element.hidden = true;
      const dub = prefs.audio === "orig" ? null : cache.get(prefs.audio);
      const duck = !!(dub && dub.status === "ready" && canSpeak(prefs.audio));                // (the voices of a device may arrive after the page)
      if (duck !== controller.ducking) { controller.ducking = duck; onChange(); }
      if (!dub || dub.status !== "ready" || !synth) return;
      if (video.paused) { cancelSpeech(); return; }
      const index = at(dub, time);
      if (index >= 0 && !spoken.has(index)) {
        spoken.add(index);
        if (time - dub.segments[index].s < 1.6) speak(dub, index);                        // (no sentence is read when it is more than a second and a half old)
      }
    }
    video.addEventListener("pause", cancelSpeech);
    video.addEventListener("seeking", () => { spoken.clear(); cancelSpeech(); });
    return controller;
  }

  // ------------------------------------------------------------------------------------------------------------ the window with the choice
  const STATE_TEXT = { loading: "Wird vorbereitet …", pending: "Wird vorbereitet …", error: "Das geht gerade nicht. Versuch es später noch einmal.", none: "In diesem Video wird nicht gesprochen.", unavailable: "Untertitel sind gerade nicht verfügbar." };

  function sheet(controller) {
    if (!controller) return;
    const subSelect = h("select", { class: "field", "aria-label": "Untertitel" });
    const audioSelect = h("select", { class: "field", "aria-label": "Sprache des Tons" });
    const subNote = h("small", { class: "muted cc-note" });
    const audioNote = h("small", { class: "muted cc-note" });
    const original = () => (controller.state.original ? controller.state.original.name : "");
    function options() {
      fill(subSelect, h("option", { value: "off" }, "Aus"), h("option", { value: "orig" }, `Originalsprache${original() ? ` (${original()})` : ""}`), ...LANGUAGES.map(([code, name]) => h("option", { value: code }, name)));
      fill(audioSelect, h("option", { value: "orig" }, `Originalton${original() ? ` (${original()})` : ""}`), ...LANGUAGES.map(([code, name]) => h("option", { value: code, ...(canSpeak(code) ? {} : { disabled: true }) }, canSpeak(code) ? name : `${name} (keine Stimme auf diesem Gerät)`)));
      subSelect.value = prefs.sub;
      audioSelect.value = prefs.audio;
    }
    function notes(state) {
      subNote.textContent = state.sub && state.sub !== "ready" ? STATE_TEXT[state.sub] || "" : "";
      audioNote.textContent = state.audio && state.audio !== "ready" ? STATE_TEXT[state.audio] || "" : "";
      if (state.original) options();
    }
    options();
    notes(controller.state);
    controller.listeners.add(notes);
    subSelect.addEventListener("change", () => choose({ sub: subSelect.value }));
    audioSelect.addEventListener("change", () => choose({ audio: audioSelect.value }));
    // for the maker of the video: the spoken language, in case the recogniser got it wrong
    const spoken = h("select", { class: "field", "aria-label": "Gesprochene Sprache im Video" }, h("option", { value: "" }, "Bitte wählen"), LANGUAGES.map(([code, name]) => h("option", { value: code }, name)));
    const again = h("button", { class: "btn small", type: "button", disabled: true }, "Neu erkennen");
    spoken.addEventListener("change", () => { again.disabled = !spoken.value; });
    again.addEventListener("click", async () => {
      again.disabled = true;
      if (await controller.redo(spoken.value)) toast("Das Video wird noch einmal angehört. Das dauert einen Moment.");
      again.disabled = !spoken.value;
    });
    const body = h("div", { class: "cc-sheet" },
      h("label", { class: "cc-row" }, h("span", {}, "Untertitel"), subSelect), subNote,
      h("label", { class: "cc-row" }, h("span", {}, "Sprache des Tons"), audioSelect), audioNote,
      controller.mine ? h("div", { class: "cc-fix" }, h("b", {}, "Falsch verstanden?"), h("small", { class: "muted" }, "Sag, welche Sprache in deinem Video gesprochen wird, dann hört Satürn es noch einmal an."),
        h("div", { class: "cc-row" }, spoken, again)) : null,
      h("p", { class: "muted cc-help" }, synth ? "Die Untertitel und die Übersetzung erstellt eine KI. Die Stimme kommt von deinem Gerät: bei einer Frau spricht eine weibliche, bei einem Mann eine männliche Stimme." : "Dein Browser kann nichts vorlesen. Untertitel gehen trotzdem."));
    dialog({ title: "Untertitel und Sprache", body, onClose: () => controller.listeners.delete(notes) });
  }

  // ------------------------------------------------------------------------------------------------------------ the pitch of a voice (while a video is uploaded)
  /* The pitch of the voice in a video as JSON text: a whole number of Hz every tenth of a second, 0 where nobody speaks. "" when the browser cannot read the sound. */
  async function pitchOf(file) {
    try {
      const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Offline || !file || file.size > 26 * 1024 * 1024) return "";
      const context = new Offline(1, 16000, 16000);
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const samples = decoded.getChannelData(0);
      const rate = decoded.sampleRate;
      const windowSize = Math.round(rate * 0.04), hop = Math.round(rate * 0.1);
      const low = Math.floor(rate / 400), high = Math.floor(rate / 60);
      const out = [];
      for (let start = 0; start + windowSize + high < samples.length && out.length < 420; start += hop) {
        let energy = 0;
        for (let i = 0; i < windowSize; i += 1) energy += samples[start + i] * samples[start + i];
        if (energy / windowSize < 1e-5) { out.push(0); continue; }
        const scores = [];
        let best = 0;
        for (let lag = low; lag <= high; lag += 1) {
          let sum = 0, other = 0;
          for (let i = 0; i < windowSize; i += 2) { sum += samples[start + i] * samples[start + i + lag]; other += samples[start + i + lag] * samples[start + i + lag]; }
          const score = sum / Math.sqrt(other * energy / 2 + 1e-12);
          scores.push(score);
          if (score > best) best = score;
        }
        let bestLag = 0;
        if (best > 0.5) {                                                    // (the shortest lag that is nearly as good as the best one: a lag twice as long would be an octave too low)
          for (let k = 1; k < scores.length - 1; k += 1) if (scores[k] >= best * 0.9 && scores[k] >= scores[k - 1] && scores[k] >= scores[k + 1]) { bestLag = low + k; break; }
        }
        out.push(bestLag ? Math.round(rate / bestLag) : 0);
      }
      return out.some((value) => value) ? JSON.stringify(out) : "";
    } catch (error) {
      return "";
    }
  }

  Y.captions = { bind, sheet, pitchOf, LANGUAGES, canSpeak, get prefs() { return { ...prefs }; } };
})();
