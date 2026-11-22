/* Satürn video editor (yipi-editor.js): when somebody picks a video (or photos) to upload, it opens here first. It is laid out and works like CapCut: the picture above, the time line below with the
   playhead in the middle (the time line slides under it), several clips one after the other (cut, split, delete, copy, move, trim with two handles, speed, volume, mirror, turn, zoom, filter, "Anpassen"
   with six sliders, transitions between clips, freeze frame), tracks for texts, stickers (emoji and the Samoji pictures), overlays (a second photo or video on top), effects (flash, shake, glitch ...)
   and audio (music, your own voice, volume and fades), the format of the picture (9:16, 1:1, 16:9 ...) with a blurred or black background, undo and redo, and "Hochladen" instead of "Exportieren".
   Everything happens in the browser: one compositor draws a frame of the whole project on a canvas (the same code for the preview and for the finished clip), the sound is mixed with the Web Audio API
   and both are recorded into a new file (MediaRecorder); a clip that was not changed is handed on as it is. `Y.videoEditor.open({file, onDone, onClose, snap, tool})`; `onDone({file, width, height,
   seconds, captions})` gets the finished clip. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const { h, icon, toast } = Y;

  const MAX_SIDE = 1280;                                         // the longest side of the finished clip
  const PREVIEW_SIDE = 640;
  const MAX_CLIPS = 40;
  const FILTERS = [["Original", ""], ["Hell", "brightness(1.15) contrast(1.05)"], ["Kontrast", "contrast(1.35) saturate(1.1)"], ["Schwarz-Weiß", "grayscale(1)"], ["Warm", "sepia(0.45) saturate(1.3)"],
    ["Kalt", "hue-rotate(-18deg) saturate(1.15)"], ["Verblasst", "contrast(0.85) brightness(1.1) saturate(0.8)"], ["Weich", "blur(1.2px) brightness(1.05)"],
    ["Kino", "contrast(1.25) saturate(0.85) sepia(0.2) brightness(0.95)"], ["Lebendig", "saturate(1.7) contrast(1.1)"], ["Retro", "sepia(0.7) contrast(1.1) hue-rotate(-12deg) saturate(1.2)"],
    ["Drama", "contrast(1.6) brightness(0.9) saturate(0.7)"], ["Traum", "brightness(1.12) saturate(1.25) blur(0.6px) hue-rotate(12deg)"], ["Neon", "saturate(2.2) contrast(1.3) hue-rotate(20deg)"],
    ["Mono", "grayscale(1) contrast(1.3)"], ["Negativ", "invert(1)"], ["Sommer", "sepia(0.25) saturate(1.5) brightness(1.08) hue-rotate(-8deg)"], ["Winter", "saturate(0.8) brightness(1.1) hue-rotate(18deg) contrast(1.05)"],
    ["Alt", "sepia(1) contrast(0.9) brightness(0.95)"], ["Pop", "saturate(2) contrast(1.2) brightness(1.05)"]];
  const FONTS = [["Standard", '800 {s}px Inter, "Segoe UI", sans-serif'], ["Dünn", '300 {s}px Inter, "Segoe UI", sans-serif'], ["Schreibmaschine", '700 {s}px "Courier New", monospace'], ["Retro", '800 {s}px Georgia, serif'],
    ["Handschrift", 'italic 700 {s}px "Brush Script MT", "Segoe Script", cursive'], ["Comic", '800 {s}px "Comic Sans MS", "Chalkboard SE", sans-serif']];
  const TEXT_ANIMS = [["none", "Keine"], ["fade", "Einblenden"], ["pop", "Springen"], ["rise", "Hochrutschen"], ["type", "Schreibmaschine"]];
  const EMOJI = [0x1F600, 0x1F602, 0x1F60D, 0x1F973, 0x1F60E, 0x1F62D, 0x1F621, 0x1F631, 0x1F525, 0x2764, 0x1F496, 0x2B50, 0x1F31F, 0x1F44D, 0x1F44F, 0x1F64C, 0x1F389, 0x1F4AF, 0x1F680, 0x1F451, 0x1F308, 0x2600, 0x1F319, 0x1F340, 0x1F355, 0x1F366, 0x1F3B5, 0x1F4A5, 0x1F4A3, 0x1F9E1, 0x1F47B, 0x1F984].map((code) => String.fromCodePoint(code));
  const SAMOJIS = [["herz", "Herz"], ["rose", "Rose"], ["brot", "Brot"], ["bubbletea", "Bubble Tea"], ["nadel", "Nadel"], ["kaktus", "Kaktus"], ["baer", "Bär"], ["flugzeug", "Flugzeug"], ["klo", "Klo"], ["einhorn", "Einhorn"], ["elefant", "Elefant"], ["panda", "Panda"], ["wal", "Wal"], ["geldboerse", "Geldbörse"], ["tueten", "Einkaufstüten"], ["coin", "Münze"]];
  const COLORS = ["#ffffff", "#000000", "#fe2c55", "#ffd60a", "#34c759", "#0a84ff", "#ff9f0a", "#ff6fa5"];
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  const TRANSITIONS = [["none", "Keine"], ["fade", "Überblenden"], ["black", "Schwarz"], ["slide", "Schieben"], ["zoom", "Zoom"], ["wipe", "Wischen"]];
  const FX = [["flash", "Blitz"], ["shake", "Wackeln"], ["pulse", "Puls"], ["rgb", "RGB-Glitch"], ["vhs", "VHS"], ["grain", "Körnung"], ["vignette", "Vignette"], ["bars", "Kino-Balken"]];
  const RATIOS = [["orig", "Original"], ["9:16", "9:16"], ["1:1", "1:1"], ["16:9", "16:9"], ["4:5", "4:5"], ["3:4", "3:4"]];
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clock = (seconds) => { const total = Math.max(0, seconds); const whole = Math.floor(total); return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}.${Math.floor((total - whole) * 10)}`; };
  const DEFAULT_ADJUST = () => ({ brightness: 1, contrast: 1, saturate: 1, blur: 0, temp: 0, vignette: 0 });

  function pickMime() {
    if (typeof MediaRecorder === "undefined") return "";
    for (const type of ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]) if (MediaRecorder.isTypeSupported(type)) return type;
    return "";
  }

  /* The filter of a clip: its look plus the sliders of "Anpassen". */
  const filterOf = (clip) => {
    const a = clip.adj;
    const extra = a.brightness === 1 && a.contrast === 1 && a.saturate === 1 && a.blur === 0 ? "" : ` brightness(${a.brightness}) contrast(${a.contrast}) saturate(${a.saturate})${a.blur ? ` blur(${a.blur}px)` : ""}`;
    return `${FILTERS[clip.filter][1] || ""}${extra}`.trim() || "none";
  };

  // ------------------------------------------------------------------------------------------------------ the project
  /* The layout of the clips on the time line: where each one starts, how long it is (cut length / speed) and how much it overlaps the one before (a transition). */
  function layout(clips) {
    const starts = [];
    const lens = [];
    const overlap = [];
    let end = 0;
    clips.forEach((clip, index) => {
      const len = Math.max(0.1, (clip.out - clip.in) / clip.speed);
      let ov = 0;
      if (index > 0) { const before = clips[index - 1]; ov = before.trans.type === "none" ? 0 : Math.min(before.trans.dur, lens[index - 1] * 0.9, len * 0.9); }
      const start = index === 0 ? 0 : starts[index - 1] + lens[index - 1] - ov;
      starts.push(start); lens.push(len); overlap.push(ov);
      clip.start = start; clip.len = len;
      end = Math.max(end, start + len);
    });
    return { starts, lens, overlap, total: end };
  }

  /* One frame of the whole project at time t, drawn on ctx (width x height). `bounds` (an array) gets the boxes of texts, stickers and overlays for the preview (to pick and drag them). */
  function compose(project, engine, ctx, width, height, t, bounds) {
    const clips = project.clips;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    const live = clips.filter((clip) => t >= clip.start - 0.0005 && t < clip.start + clip.len);
    if (!live.length && clips.length) live.push(t < 0 ? clips[0] : clips[clips.length - 1]);
    if (project.bg === "blur" && live[0]) drawBackdrop(ctx, engine, live[0], width, height);
    if (live.length === 2) {
      const [a, b] = live;
      const ov = Math.max(0.001, a.start + a.len - b.start);
      const p = clamp((t - b.start) / ov, 0, 1);
      const type = a.trans.type;
      if (type === "fade") { drawClip(ctx, engine, a, width, height, {}); drawClip(ctx, engine, b, width, height, { alpha: p }); }
      else if (type === "black") { if (p < 0.5) drawClip(ctx, engine, a, width, height, { alpha: 1 - p * 2 }); else drawClip(ctx, engine, b, width, height, { alpha: p * 2 - 1 }); }
      else if (type === "slide") { drawClip(ctx, engine, a, width, height, { dx: -p * width }); drawClip(ctx, engine, b, width, height, { dx: (1 - p) * width }); }
      else if (type === "zoom") { drawClip(ctx, engine, a, width, height, { scale: 1 + p * 0.35, alpha: 1 - p }); drawClip(ctx, engine, b, width, height, { scale: 1.35 - p * 0.35, alpha: p }); }
      else if (type === "wipe") { drawClip(ctx, engine, a, width, height, {}); drawClip(ctx, engine, b, width, height, { rect: [0, 0, width * p, height] }); }
      else drawClip(ctx, engine, b, width, height, {});
    } else for (const clip of live) drawClip(ctx, engine, clip, width, height, {});
    for (const item of project.overlays) if (t >= item.from && t < item.to) drawOverlay(ctx, engine, item, width, height, t, bounds);
    for (const item of project.fx) if (t >= item.from && t < item.to) drawFx(ctx, engine, item, width, height, t);
    for (const item of project.stickers) if (t >= item.from && t < item.to) drawSticker(ctx, engine, item, width, height, bounds);
    for (const item of project.texts) if (t >= item.from && t < item.to) drawText(ctx, item, width, height, t, bounds);
    ctx.restore();
  }

  const sizeOf = (clip, el) => (clip.photo ? [el.naturalWidth || 0, el.naturalHeight || 0] : [el.videoWidth || 0, el.videoHeight || 0]);

  function drawBackdrop(ctx, engine, clip, width, height) {
    const el = engine.elementFor(clip);
    const [sw, sh] = sizeOf(clip, el);
    if (!sw || (!clip.photo && el.readyState < 2)) return;
    const tiny = engine.tiny;
    const tw = tiny.width; const th = tiny.height;
    const tctx = tiny.getContext("2d");
    const scale = Math.max(tw / sw, th / sh);
    tctx.drawImage(el, (tw - sw * scale) / 2, (th - sh * scale) / 2, sw * scale, sh * scale);
    ctx.filter = "brightness(0.55)";
    ctx.drawImage(tiny, 0, 0, width, height);
    ctx.filter = "none";
  }

  function drawClip(ctx, engine, clip, width, height, o) {
    const el = engine.elementFor(clip);
    const [sw, sh] = sizeOf(clip, el);
    if (!sw || (!clip.photo && el.readyState < 2)) return;
    const turned = clip.rot % 2 === 1;
    const fit = Math.min(width / (turned ? sh : sw), height / (turned ? sw : sh)) * clip.zoom * (o.scale || 1);
    const dw = sw * fit;
    const dh = sh * fit;
    ctx.save();
    if (o.rect) { ctx.beginPath(); ctx.rect(o.rect[0], o.rect[1], o.rect[2], o.rect[3]); ctx.clip(); }
    ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
    ctx.translate(width / 2 + (o.dx || 0), height / 2);
    ctx.rotate(clip.rot * Math.PI / 2);
    ctx.scale(clip.mirror ? -1 : 1, clip.flip ? -1 : 1);
    ctx.filter = filterOf(clip);
    ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
    ctx.filter = "none";
    const a = clip.adj;
    if (a.temp) { ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = a.temp > 0 ? `rgba(255,140,0,${Math.min(1, a.temp * 0.6)})` : `rgba(0,120,255,${Math.min(1, -a.temp * 0.6)})`; ctx.fillRect(-dw / 2, -dh / 2, dw, dh); ctx.globalCompositeOperation = "source-over"; }
    if (a.vignette) {
      const radius = Math.hypot(dw, dh) / 2;
      const grad = ctx.createRadialGradient(0, 0, radius * 0.35, 0, 0, radius);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${a.vignette})`);
      ctx.fillStyle = grad;
      ctx.fillRect(-dw / 2, -dh / 2, dw, dh);
    }
    ctx.restore();
  }

  function drawOverlay(ctx, engine, item, width, height, t, bounds) {
    const el = engine.elementFor(item);
    const [sw, sh] = sizeOf(item, el);
    if (!sw || (!item.photo && el.readyState < 2)) return;
    const dw = (item.size / 100) * width;
    const dh = dw * sh / sw;
    ctx.save();
    ctx.globalAlpha = item.opacity;
    ctx.translate((item.x / 100) * width, (item.y / 100) * height);
    ctx.rotate((item.rot * Math.PI) / 180);
    ctx.scale(item.mirror ? -1 : 1, 1);
    ctx.drawImage(el, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
    if (bounds) bounds.push({ item, kind: "overlay", x: (item.x / 100) * width, y: (item.y / 100) * height, w: dw, h: dh });
  }

  function drawFx(ctx, engine, item, width, height, t) {
    const local = t - item.from;
    const snap = engine.snap;
    const copy = () => { const c = snap.getContext("2d"); c.clearRect(0, 0, snap.width, snap.height); c.drawImage(ctx.canvas, 0, 0, width, height); return c; };
    ctx.save();
    if (item.type === "flash") { const p = (local * 4) % 1; ctx.fillStyle = `rgba(255,255,255,${(1 - p) * 0.85})`; ctx.fillRect(0, 0, width, height); }
    else if (item.type === "shake") { copy(); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height); ctx.drawImage(snap, (Math.random() - 0.5) * width * 0.03, (Math.random() - 0.5) * height * 0.02, width, height); }
    else if (item.type === "pulse") { copy(); const k = 1 + 0.06 * Math.abs(Math.sin(local * Math.PI * 3)); ctx.drawImage(snap, width * (1 - k) / 2, height * (1 - k) / 2, width * k, height * k); }
    else if (item.type === "rgb") {
      copy();
      const tmp = engine.tint;
      const tc = tmp.getContext("2d");
      const shift = width * 0.012 * (1 + Math.sin(local * 12));
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "lighter";
      [["#ff0000", -shift], ["#00ff00", 0], ["#0000ff", shift]].forEach(([color, dx]) => {
        tc.globalCompositeOperation = "source-over"; tc.clearRect(0, 0, tmp.width, tmp.height); tc.drawImage(snap, 0, 0, width, height);
        tc.globalCompositeOperation = "multiply"; tc.fillStyle = color; tc.fillRect(0, 0, width, height);
        ctx.drawImage(tmp, dx, 0, width, height);
      });
    } else if (item.type === "vhs") {
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      for (let y = 0; y < height; y += 4) ctx.fillRect(0, y, width, 2);
      const band = ((local * 0.35) % 1) * height;
      ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(0, band, width, height * 0.06);
    } else if (item.type === "grain") {
      const count = Math.round(width * height / 1800);
      for (let i = 0; i < count; i += 1) { ctx.fillStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.14)"; ctx.fillRect(Math.random() * width, Math.random() * height, 2, 2); }
    } else if (item.type === "vignette") {
      const radius = Math.hypot(width, height) / 2;
      const grad = ctx.createRadialGradient(width / 2, height / 2, radius * 0.3, width / 2, height / 2, radius);
      grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(0,0,0,0.75)");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, width, height);
    } else if (item.type === "bars") { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, width, height * 0.12); ctx.fillRect(0, height * 0.88, width, height * 0.12); }
    ctx.restore();
  }

  const easeOutBack = (x) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

  function drawSticker(ctx, engine, item, width, height, bounds) {
    const size = (item.size / 100) * height;
    ctx.save();
    ctx.translate((item.x / 100) * width, (item.y / 100) * height);
    ctx.rotate((item.rot * Math.PI) / 180);
    let w = size; let hh = size;
    if (item.img) {
      const img = engine.imageFor(item.img);
      if (img.naturalWidth) { const ratio = img.naturalWidth / img.naturalHeight; w = ratio >= 1 ? size : size * ratio; hh = ratio >= 1 ? size / ratio : size; ctx.drawImage(img, -w / 2, -hh / 2, w, hh); }
    } else {
      ctx.font = `${size}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(item.char, 0, 0);
    }
    ctx.restore();
    if (bounds) bounds.push({ item, kind: "sticker", x: (item.x / 100) * width, y: (item.y / 100) * height, w, h: hh });
  }

  function drawText(ctx, item, width, height, t, bounds) {
    const size = (item.size / 100) * height;
    const u = clamp((t - item.from) / 0.45, 0, 1);
    const out = clamp((item.to - t) / 0.3, 0, 1);
    let alpha = 1; let scale = 1; let lift = 0; let text = item.text;
    if (item.anim === "fade") alpha = u;
    else if (item.anim === "pop") scale = Math.max(0.01, easeOutBack(u));
    else if (item.anim === "rise") { alpha = u; lift = (1 - u) * 0.06 * height; }
    else if (item.anim === "type") text = item.text.slice(0, Math.ceil(item.text.length * clamp((t - item.from) / Math.max(0.4, item.text.length * 0.06), 0, 1)));
    if (item.anim !== "none") alpha *= out;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate((item.x / 100) * width, (item.y / 100) * height + lift);
    ctx.rotate((item.rot * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.font = FONTS[item.font][1].replace("{s}", String(size));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const full = ctx.measureText(item.text).width;
    const tw = Math.min(full, width * 0.94);
    if (item.bg) { ctx.fillStyle = item.bg; ctx.fillRect(-tw / 2 - size * 0.3, -size * 0.65, tw + size * 0.6, size * 1.3); }
    if (text) {
      if (item.stroke) { ctx.lineWidth = size / 7; ctx.strokeStyle = item.color === "#000000" ? "#ffffff" : "#000000"; ctx.lineJoin = "round"; ctx.strokeText(text, 0, 0, width * 0.94); }
      if (item.shadow) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = size / 4; ctx.shadowOffsetY = size / 14; }
      ctx.fillStyle = item.color;
      ctx.fillText(text, 0, 0, width * 0.94);
    }
    ctx.restore();
    if (bounds) bounds.push({ item, kind: "text", x: (item.x / 100) * width, y: (item.y / 100) * height + lift, w: tw + size * 0.6, h: size * 1.3 });
  }

  /* The elements that play the clips (a video element for each clip and each video overlay, an image for each photo). `export` mode connects the sound of every element to an audio graph. */
  function createEngine(project, { audio = null, sink = null } = {}) {
    const elements = new Map();
    const gains = new Map();
    const images = new Map();
    const tiny = document.createElement("canvas"); tiny.width = 36; tiny.height = 64;
    const snap = document.createElement("canvas");
    const tint = document.createElement("canvas");
    const engine = {
      tiny, snap, tint,
      elementFor(item) {
        let el = elements.get(item.id);
        if (el) return el;
        if (item.photo) { el = new Image(); el.addEventListener("load", () => { if (engine.onFrame) engine.onFrame(); }); el.src = item.url; }
        else {
          el = h("video", { src: item.url, playsinline: true, preload: "auto" });
          for (const name of ["loadeddata", "seeked", "canplay"]) el.addEventListener(name, () => { if (engine.onFrame) engine.onFrame(); });
          if (audio && sink) { const gain = audio.createGain(); gain.gain.value = 0; audio.createMediaElementSource(el).connect(gain).connect(sink); gains.set(item.id, gain); }
        }
        elements.set(item.id, el);
        return el;
      },
      imageFor(url) { let img = images.get(url); if (!img) { img = new Image(); img.addEventListener("load", () => { if (engine.onFrame) engine.onFrame(); }); img.src = url; images.set(url, img); } return img; },
      size(width, height) { snap.width = tint.width = width; snap.height = tint.height = height; },
      /* Put every element where it must be at time t (and let it play or not). */
      sync(t, playing) {
        const places = [...project.clips.map((clip) => ({ item: clip, at: t - clip.start, len: clip.len, speed: clip.speed, from: clip.in, vol: clip.muted ? 0 : clip.vol })),
          ...project.overlays.filter((o) => !o.photo).map((o) => ({ item: o, at: t - o.from, len: o.to - o.from, speed: 1, from: o.in, vol: o.muted ? 0 : o.vol }))];
        for (const place of places) {
          if (place.item.photo) continue;
          const el = this.elementFor(place.item);
          const active = place.at >= -0.0005 && place.at < place.len;
          const gain = gains.get(place.item.id);
          if (gain) gain.gain.value = active ? place.vol : 0;
          if (!active) { if (!el.paused) el.pause(); continue; }
          const want = place.from + Math.max(0, place.at) * place.speed;
          el.volume = clamp(place.vol, 0, 1);
          el.muted = !!audio || place.vol === 0;                  // (in the finished clip the sound goes through the graph, not through the speakers)
          if (playing) {
            el.playbackRate = place.speed;
            if (el.paused) { el.currentTime = want; el.play().catch(() => {}); } else if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = want;
          } else {
            if (!el.paused) el.pause();
            if (Math.abs(el.currentTime - want) > 0.03) el.currentTime = want;
          }
        }
      },
      pause() { for (const el of elements.values()) if (el.pause && !el.paused) el.pause(); },
      drop(ids) { for (const [id, el] of elements) if (!ids.has(id)) { if (el.pause) el.pause(); if (el.removeAttribute) el.removeAttribute("src"); elements.delete(id); gains.delete(id); } },
      dispose() { for (const el of elements.values()) { if (el.pause) el.pause(); if (el.removeAttribute) el.removeAttribute("src"); } elements.clear(); },
    };
    return engine;
  }

  // ------------------------------------------------------------------------------------------------------ the editor
  function open({ file, onDone, onClose, snap = false, tool: firstTool = "" } = {}) {
    const project = { clips: [], texts: [], stickers: [], overlays: [], fx: [], audios: [], ratio: "orig", bg: "blur", captions: true };
    const files = new Map();                                      // url -> the File (to hand a clip that was not changed back as it is)
    const buffers = new Map();                                    // audio id -> decoded sound
    const thumbs = new Map();                                     // "url@time" -> picture
    let nextId = 1;
    let L = { total: 0 };
    let t = 0;
    let playing = false;
    let clockStart = 0;
    let clockBase = 0;
    let raf = 0;
    let pps = 70;                                                 // pixels per second of the time line
    let tool = firstTool;
    let selected = null;                                          // {kind: "clip"|"text"|"sticker"|"overlay"|"fx"|"audio", item}
    let busy = false;
    let closed = false;
    let history = [];
    let future = [];
    let actx = null;
    let audioSources = [];
    let recording = null;
    let programmatic = false;
    let bounds = [];

    const engine = createEngine(project);
    engine.onFrame = () => { if (!playing && !closed) redraw(); };               // (a frame that arrives after a jump in the clip is drawn when it is there)
    const canvas = h("canvas", { class: "ed-canvas", "aria-label": "Vorschau deines Videos" });
    const ctx = canvas.getContext("2d");
    const stage = h("div", { class: "ed-stage" }, canvas);
    const timeText = h("span", { class: "ed-time" }, "00:00.0 / 00:00.0");
    const playButton = h("button", { class: "ed-play", type: "button", "aria-label": "Abspielen" }, icon("play"));
    const undoButton = h("button", { class: "ed-round", type: "button", "aria-label": "Rückgängig" }, icon("back"));
    const redoButton = h("button", { class: "ed-round redo", type: "button", "aria-label": "Wiederholen" }, icon("back"));
    const zoomOut = h("button", { class: "ed-round small", type: "button", "aria-label": "Zeitleiste verkleinern" }, "−");
    const zoomIn = h("button", { class: "ed-round small", type: "button", "aria-label": "Zeitleiste vergrößern" }, "+");
    const tl = h("div", { class: "ed-tl", tabindex: "0", "aria-label": "Zeitleiste" });
    const tlIn = h("div", { class: "ed-tl-in" });
    tl.append(tlIn);
    const playhead = h("span", { class: "ed-playhead", "aria-hidden": "true" });
    const timeline = h("div", { class: "ed-timeline" }, tl, playhead);
    const panel = h("div", { class: "ed-panel", hidden: true });
    const toolbar = h("nav", { class: "ed-tools", "aria-label": "Werkzeuge" });
    const progress = h("div", { class: "ed-progress", hidden: true }, h("b", {}, "Dein Video wird gebaut …"), h("span", { class: "ed-bar" }, h("i", {})), h("small", {}, "Bleib bitte auf dieser Seite."));
    const upload = h("button", { class: "ed-upload", type: "button" }, snap ? "Fertig" : "Hochladen");
    const close = h("button", { class: "ed-x", type: "button", "aria-label": "Schließen" }, icon("close"));
    const picker = h("input", { class: "ed-file", type: "file", accept: "video/*,image/*", multiple: true, hidden: true });
    const overlayPicker = h("input", { class: "ed-file", type: "file", accept: "video/*,image/*", hidden: true });

    // ---------------------------------------------------------------------------------------------- the project
    const snapshot = () => JSON.stringify({ clips: project.clips, texts: project.texts, stickers: project.stickers, overlays: project.overlays, fx: project.fx, audios: project.audios, ratio: project.ratio, bg: project.bg, captions: project.captions });
    function restore(text) {
      const data = JSON.parse(text);
      for (const key of Object.keys(data)) project[key] = data[key];
      selected = null;
      relayout();
    }
    function remember() { history.push(snapshot()); if (history.length > 60) history.shift(); future = []; drawTopButtons(); }
    function undo() { if (!history.length) return; future.push(snapshot()); restore(history.pop()); drawAll(); }
    function redo() { if (!future.length) return; history.push(snapshot()); restore(future.pop()); drawAll(); }
    function relayout() {
      L = layout(project.clips);
      engine.drop(new Set([...project.clips.map((c) => c.id), ...project.overlays.map((o) => o.id)]));
      const first = project.clips[0];
      const size = outputSize();
      if (canvas.width !== size.pw || canvas.height !== size.ph) { canvas.width = size.pw; canvas.height = size.ph; engine.size(size.pw, size.ph); }
      for (const list of [project.texts, project.stickers, project.overlays, project.fx]) for (const item of list) { item.to = Math.min(item.to, Math.max(L.total, item.from + 0.2)); if (item.from > L.total) item.from = Math.max(0, L.total - 0.5); }
      t = clamp(t, 0, L.total);
      void first;
    }
    /* The size of the finished clip (and of the preview): from the format; "Original" takes the shape of the first clip. */
    function outputSize() {
      let ratio = 9 / 16;
      const first = project.clips[0];
      if (project.ratio === "orig") { if (first) { const turned = first.rot % 2 === 1; ratio = (turned ? first.h : first.w) / (turned ? first.w : first.h); } }
      else { const [a, b] = project.ratio.split(":").map(Number); ratio = a / b; }
      const dims = (side) => (ratio >= 1 ? [side, side / ratio] : [side * ratio, side]);
      const [fw, fh] = dims(MAX_SIDE);
      const [pw, ph] = dims(PREVIEW_SIDE);
      const small = project.ratio === "orig" && first ? Math.min(1, MAX_SIDE / Math.max(first.w, first.h)) : 1;
      return { width: even(fw * small), height: even(fh * small), pw: even(pw), ph: even(ph) };
    }
    const itemId = () => nextId++;

    async function makeClip(item) {
      const photo = item.type.startsWith("image/");
      const url = URL.createObjectURL(item);
      files.set(url, item);
      const clip = { id: itemId(), url, photo, w: 0, h: 0, srcDur: photo ? 60 : 0, in: 0, out: photo ? 3 : 0, speed: 1, vol: 1, muted: false, mirror: false, flip: false, rot: 0, zoom: 1, filter: 0, adj: DEFAULT_ADJUST(), trans: { type: "none", dur: 0.5 } };
      if (photo) {
        const img = new Image();
        await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
        clip.w = img.naturalWidth; clip.h = img.naturalHeight;
      } else {
        const probe = h("video", { src: url, playsinline: true, preload: "auto" });
        await new Promise((resolve, reject) => { probe.addEventListener("loadedmetadata", resolve, { once: true }); probe.addEventListener("error", reject, { once: true }); });
        if (!Number.isFinite(probe.duration)) {
          // a clip that was recorded in the browser (WebM) does not say how long it is: jumping to the far end makes the browser find out
          await new Promise((resolve) => { const found = () => { if (!Number.isFinite(probe.duration)) return; probe.removeEventListener("timeupdate", found); resolve(); }; probe.addEventListener("timeupdate", found); probe.currentTime = 1e9; setTimeout(resolve, 4000); });
        }
        clip.w = probe.videoWidth; clip.h = probe.videoHeight;
        clip.srcDur = Number.isFinite(probe.duration) ? probe.duration : 1;
        clip.out = clip.srcDur;
        probe.removeAttribute("src");
      }
      return clip;
    }
    async function addFiles(list) {
      const picked = [...list].filter((f) => f.type.startsWith("video/") || f.type.startsWith("image/")).slice(0, MAX_CLIPS - project.clips.length);
      if (!picked.length) { toast("Das sind keine Videos oder Fotos."); return; }
      for (const f of picked) {
        try { const clip = await makeClip(f); remember(); project.clips.push(clip); relayout(); if (project.clips.length === 1) t = 0; else t = project.clips[project.clips.length - 1].start; }
        catch (error) { toast("Diese Datei konnte nicht gelesen werden."); }
      }
      selected = null;
      drawAll();
      fitZoom();
    }

    /* A picture of a clip at a time (for the blocks of the time line). */
    function thumbOf(clip) {
      if (clip.photo) return clip.url;
      const key = `${clip.url}@${clip.in.toFixed(1)}`;
      if (thumbs.has(key)) return thumbs.get(key);
      thumbs.set(key, "");
      const probe = h("video", { src: clip.url, muted: true, playsinline: true, preload: "auto" });
      const finish = () => { try { const c = document.createElement("canvas"); c.width = 80; c.height = 110; const x = c.getContext("2d"); const k = Math.max(80 / probe.videoWidth, 110 / probe.videoHeight); x.drawImage(probe, (80 - probe.videoWidth * k) / 2, (110 - probe.videoHeight * k) / 2, probe.videoWidth * k, probe.videoHeight * k); thumbs.set(key, c.toDataURL("image/jpeg", 0.55)); } catch (error) { /* stays grey */ } probe.removeAttribute("src"); if (!closed) drawTimeline(); };
      probe.addEventListener("loadeddata", () => { probe.addEventListener("seeked", finish, { once: true }); probe.currentTime = clip.in + 0.05; }, { once: true });
      probe.addEventListener("error", () => probe.removeAttribute("src"), { once: true });
      return "";
    }

    // ---------------------------------------------------------------------------------------------- drawing
    function redraw() {
      if (closed) return;
      bounds = [];
      compose(project, engine, ctx, canvas.width, canvas.height, t, bounds);
      if (selected && selected.kind !== "clip" && selected.kind !== "audio" && selected.kind !== "fx") {
        const box = bounds.find((b) => b.item === selected.item);
        if (box) { ctx.save(); ctx.strokeStyle = "#fff"; ctx.lineWidth = Math.max(2, canvas.width / 220); ctx.setLineDash([8, 6]); ctx.strokeRect(box.x - box.w / 2 - 6, box.y - box.h / 2 - 6, box.w + 12, box.h + 12); ctx.restore(); }
      }
      timeText.textContent = `${clock(t)} / ${clock(L.total)}`;
    }
    function setTime(value, fromScroll) {
      t = clamp(value, 0, L.total);
      engine.sync(t, playing);
      if (!fromScroll) { programmatic = true; tl.scrollLeft = t * pps; setTimeout(() => { programmatic = false; }, 30); }
      redraw();
    }
    /* After a seek the new frame arrives a moment later: draw again when it is there. */
    const redrawSoon = () => { if (!playing) { setTimeout(redraw, 60); setTimeout(redraw, 220); } };

    // ---------------------------------------------------------------------------------------------- the time line
    const half = () => tl.clientWidth / 2;
    function fitZoom() { if (L.total > 0 && tl.clientWidth) { pps = clamp((tl.clientWidth * 0.7) / L.total, 24, 140); drawTimeline(); setTime(t); } }
    function drawTimeline() {
      const pad = half();
      tlIn.style.width = `${L.total * pps + pad * 2}px`;
      const rows = [];
      // ruler
      const ruler = h("div", { class: "ed-ruler" });
      const step = pps >= 90 ? 1 : pps >= 45 ? 2 : 5;
      for (let s = 0; s <= L.total + 0.01; s += step) { const mark = h("span", {}, `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, "0")}`); mark.style.left = `${pad + s * pps}px`; ruler.append(mark); }
      rows.push(ruler);
      // the main track
      const main = h("div", { class: "ed-row main" });
      project.clips.forEach((clip, index) => {
        const block = h("button", { class: `ed-clip${selected && selected.item === clip ? " on" : ""}${clip.photo ? " photo" : ""}`, type: "button", "aria-label": `Clip ${index + 1}`, "aria-pressed": String(!!(selected && selected.item === clip)) });
        block.style.left = `${pad + clip.start * pps}px`;
        block.style.width = `${Math.max(14, clip.len * pps)}px`;
        const picture = thumbOf(clip);
        if (picture) block.style.backgroundImage = `url(${picture})`;
        block.append(h("small", {}, `${clip.len.toFixed(1)}s${clip.speed !== 1 ? ` · ${clip.speed}x` : ""}`));
        if (clip.muted || clip.vol === 0) block.append(h("i", { class: "ed-muted", "aria-hidden": "true" }, icon("mute")));
        block.addEventListener("click", () => { selected = selected && selected.item === clip ? null : { kind: "clip", item: clip }; if (selected) { tool = ""; } drawAll(); });
        main.append(block);
        if (selected && selected.item === clip) {
          for (const side of ["a", "b"]) {
            const grip = h("span", { class: `ed-grip ${side}`, role: "slider", "aria-label": side === "a" ? "Anfang kürzen" : "Ende kürzen" });
            grip.style.left = `${pad + (side === "a" ? clip.start * pps : (clip.start + clip.len) * pps - 18)}px`;
            grip.addEventListener("pointerdown", (event) => trimDrag(event, clip, side));
            main.append(grip);
          }
        }
        if (index < project.clips.length - 1) {
          const knob = h("button", { class: `ed-join${clip.trans.type !== "none" ? " on" : ""}`, type: "button", "aria-label": "Übergang" }, clip.trans.type !== "none" ? icon("sparkle") : icon("plus"));
          knob.style.left = `${pad + (clip.start + clip.len) * pps - (L.overlap[index + 1] || 0) * pps / 2 - 12}px`;
          knob.addEventListener("click", (event) => { event.stopPropagation(); selected = { kind: "clip", item: clip }; tool = "trans"; drawAll(); });
          main.append(knob);
        }
      });
      const add = h("button", { class: "ed-addclip", type: "button", "aria-label": "Clip hinzufügen", onclick: () => picker.click() }, icon("plus"));
      add.style.left = `${pad + L.total * pps + 10}px`;
      main.append(add);
      rows.push(main);
      // the other tracks
      const track = (list, kind, name, label) => {
        if (!list.length) return null;
        const row = h("div", { class: `ed-row ${kind}` });
        for (const item of list) {
          const bar = h("button", { class: `ed-bar-item ${kind}${selected && selected.item === item ? " on" : ""}`, type: "button", "aria-label": label(item) }, label(item));
          bar.style.left = `${pad + item.from * pps}px`;
          bar.style.width = `${Math.max(16, (item.to - item.from) * pps)}px`;
          bar.addEventListener("pointerdown", (event) => itemDrag(event, item, kind, list));
          row.append(bar);
        }
        return row;
      };
      const extra = [
        track(project.overlays, "overlay", "Überlagerung", (o) => (o.photo ? "Foto" : "Video")),
        track(project.stickers, "sticker", "Sticker", (s) => s.char || "Samoji"),
        track(project.texts, "text", "Text", (x) => x.text),
        track(project.fx, "fx", "Effekt", (f) => (FX.find((e) => e[0] === f.type) || [0, "Effekt"])[1]),
      ].filter(Boolean);
      rows.push(...extra);
      const audioRow = h("div", { class: "ed-row audio" });
      for (const a of project.audios) {
        const bar = h("button", { class: `ed-bar-item audio${selected && selected.item === a ? " on" : ""}`, type: "button", "aria-label": a.title }, a.title);
        bar.style.left = `${pad + a.from * pps}px`;
        bar.style.width = `${Math.max(16, a.len * pps)}px`;
        bar.addEventListener("pointerdown", (event) => itemDrag(event, a, "audio", project.audios));
        audioRow.append(bar);
      }
      if (!project.audios.length) { const none = h("button", { class: "ed-add-audio", type: "button", onclick: () => { tool = "audio"; selected = null; drawAll(); } }, icon("music"), "Audio hinzufügen"); none.style.left = `${pad}px`; audioRow.append(none); }
      rows.push(audioRow);
      tlIn.replaceChildren(...rows);
    }
    function trimDrag(event, clip, side) {
      event.preventDefault(); event.stopPropagation();
      remember();
      const x0 = event.clientX; const in0 = clip.in; const out0 = clip.out;
      const max = clip.photo ? 60 : clip.srcDur;
      const move = (e) => {
        const dt = ((e.clientX - x0) / pps) * clip.speed;
        if (side === "a") clip.in = clamp(in0 + dt, 0, out0 - 0.2 * clip.speed); else clip.out = clamp(out0 + dt, in0 + 0.2 * clip.speed, max);
        relayout(); drawTimeline(); engine.sync(t, false); redraw();
      };
      const stop = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", stop); thumbs.delete(`${clip.url}@${clip.in.toFixed(1)}`); drawAll(); setTime(clamp(t, clip.start, clip.start + clip.len)); };
      addEventListener("pointermove", move); addEventListener("pointerup", stop);
    }
    /* A bar of a text, sticker, overlay, effect or audio: a tap picks it, dragging moves it in time, dragging near an end changes how long it lasts. */
    function itemDrag(event, item, kind, list) {
      event.preventDefault();
      const bar = event.currentTarget;
      const box = bar.getBoundingClientRect();
      const edge = event.clientX - box.left < 12 ? "a" : box.right - event.clientX < 12 ? "b" : "m";
      const len0 = kind === "audio" ? item.len : item.to - item.from;
      const from0 = item.from;
      const x0 = event.clientX;
      let moved = false;
      let remembered = false;
      const move = (e) => {
        const dt = (e.clientX - x0) / pps;
        if (Math.abs(e.clientX - x0) > 4 && !moved) { moved = true; if (!remembered) { remember(); remembered = true; } }
        if (!moved) return;
        if (edge === "m") { item.from = Math.max(0, from0 + dt); if (kind === "audio") item.len = len0; else item.to = item.from + len0; }
        else if (edge === "a") { const nf = clamp(from0 + dt, 0, from0 + len0 - 0.2); if (kind === "audio") { item.in += nf - item.from; item.len = len0 - (nf - from0); } else item.to = from0 + len0; item.from = nf; }
        else if (kind === "audio") item.len = Math.max(0.2, len0 + dt); else item.to = Math.max(item.from + 0.2, from0 + len0 + dt);
        drawTimeline(); redraw();
      };
      const stop = () => {
        removeEventListener("pointermove", move); removeEventListener("pointerup", stop);
        selected = { kind, item };
        if (!moved) { setTime(item.from + 0.01); tool = ""; }
        relayout(); drawAll();
        if (playing) startAudios();
      };
      addEventListener("pointermove", move); addEventListener("pointerup", stop);
    }
    tl.addEventListener("scroll", () => { if (programmatic || playing) return; setTime(tl.scrollLeft / pps, true); redrawSoon(); });
    tl.addEventListener("click", (event) => { if (event.target === tl || event.target === tlIn || event.target.classList.contains("ed-row") || event.target.classList.contains("ed-ruler")) { selected = null; drawAll(); } });
    zoomIn.addEventListener("click", () => { pps = clamp(pps * 1.4, 12, 260); drawTimeline(); setTime(t); });
    zoomOut.addEventListener("click", () => { pps = clamp(pps / 1.4, 12, 260); drawTimeline(); setTime(t); });
    // the preview: a tap on a text, sticker or overlay picks it (and a drag moves it), a tap anywhere else plays or stops
    canvas.addEventListener("pointerdown", (event) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width; const sy = canvas.height / rect.height;
      const px = (event.clientX - rect.left) * sx; const py = (event.clientY - rect.top) * sy;
      const hit = [...bounds].reverse().find((b) => Math.abs(px - b.x) <= b.w / 2 + 8 && Math.abs(py - b.y) <= b.h / 2 + 8);
      if (!hit) { downAt = { x: event.clientX, y: event.clientY, hit: false }; return; }
      event.preventDefault();
      selected = { kind: hit.kind, item: hit.item };
      let remembered = false;
      const move = (e) => {
        if (!remembered) { remember(); remembered = true; }
        hit.item.x = clamp(((e.clientX - rect.left) * sx / canvas.width) * 100, 0, 100);
        hit.item.y = clamp(((e.clientY - rect.top) * sy / canvas.height) * 100, 0, 100);
        redraw();
      };
      const stop = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", stop); tool = hit.kind === "text" ? "text" : hit.kind === "sticker" ? "sticker" : "overlay"; drawAll(); };
      addEventListener("pointermove", move); addEventListener("pointerup", stop);
      downAt = { hit: true };
    });
    let downAt = null;
    canvas.addEventListener("click", () => { if (downAt && downAt.hit) return; togglePlay(); });

    // ---------------------------------------------------------------------------------------------- the sound
    const AC = window.AudioContext || window.webkitAudioContext;
    function audioContext() { if (!actx) actx = new AC(); if (actx.state === "suspended") actx.resume(); return actx; }
    /* The music and voices that play from time `from` on: each one is started at the right moment (and with its fades). `dest`: where the sound goes. */
    function scheduleAudios(context, dest, from, now) {
      const made = [];
      for (const a of project.audios) {
        const buffer = buffers.get(a.id);
        if (!buffer) continue;
        const end = a.from + a.len;
        if (end <= from) continue;
        const source = context.createBufferSource();
        source.buffer = buffer;
        const gain = context.createGain();
        const startAt = now + Math.max(0, a.from - from);
        const offset = a.in + Math.max(0, from - a.from);
        const length = end - Math.max(a.from, from);
        const level = a.vol;
        gain.gain.setValueAtTime(a.fadeIn > 0 && from <= a.from ? 0 : level, startAt);
        if (a.fadeIn > 0 && from <= a.from) gain.gain.linearRampToValueAtTime(level, startAt + a.fadeIn);
        if (a.fadeOut > 0) { const fadeStart = now + Math.max(0, end - a.fadeOut - from); gain.gain.setValueAtTime(level, Math.max(startAt, fadeStart)); gain.gain.linearRampToValueAtTime(0, now + (end - from)); }
        source.connect(gain).connect(dest);
        try { source.start(startAt, offset, Math.max(0.01, length)); } catch (error) { continue; }
        made.push(source);
      }
      return made;
    }
    function startAudios() { stopAudios(); if (!project.audios.length) return; const context = audioContext(); audioSources = scheduleAudios(context, context.destination, t, context.currentTime + 0.02); }
    function stopAudios() { for (const s of audioSources) { try { s.stop(); } catch (error) { /* it had not started */ } } audioSources = []; }
    async function decode(arrayBuffer) { const context = audioContext(); return context.decodeAudioData(arrayBuffer); }
    function chooseMusic() {
      if (!Y.music) return;
      Y.music.pick({ onPick: async (picked) => {
        const blobUrl = await Y.music.loadWhole(Y.music.urlOf(picked));
        if (!blobUrl) { toast("Der Song konnte nicht geladen werden."); return; }
        try {
          const buffer = await decode(await (await fetch(blobUrl)).arrayBuffer());
          const item = { id: itemId(), kind: "music", title: picked.title || "Song", from: t, in: Number(picked.start) || 0, len: 0, vol: 0.7, fadeIn: 0, fadeOut: 0 };
          item.len = Math.max(1, Math.min(buffer.duration - item.in, Math.max(L.total - t, 3)));
          remember(); buffers.set(item.id, buffer); project.audios.push(item); selected = { kind: "audio", item }; tool = "audio"; drawAll();
        } catch (error) { toast("Der Song konnte nicht gelesen werden."); }
      } });
    }
    /* "Aufnehmen": your own voice is recorded while the clips play, and put on the audio track where you started. */
    async function toggleRecording() {
      if (recording) { recording.recorder.stop(); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast("Dein Browser kann nicht aufnehmen."); return; }
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (error) { toast("Ohne Erlaubnis für das Mikrofon geht das nicht."); return; }
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      const startedAt = t;
      recorder.addEventListener("dataavailable", (e) => { if (e.data && e.data.size) chunks.push(e.data); });
      recorder.addEventListener("stop", async () => {
        stream.getTracks().forEach((track) => track.stop());
        recording = null;
        pause();
        try {
          const buffer = await decode(await new Blob(chunks).arrayBuffer());
          const item = { id: itemId(), kind: "voice", title: "Aufnahme", from: startedAt, in: 0, len: buffer.duration, vol: 1, fadeIn: 0, fadeOut: 0 };
          remember(); buffers.set(item.id, buffer); project.audios.push(item); selected = { kind: "audio", item }; relayout();
        } catch (error) { toast("Die Aufnahme konnte nicht gelesen werden."); }
        drawAll();
      });
      recording = { recorder };
      recorder.start();
      play();
      drawPanel();
    }

    // ---------------------------------------------------------------------------------------------- playing
    function tick() {
      if (!playing) return;
      const now = performance.now();
      const value = clockBase + (now - clockStart) / 1000;
      if (value >= L.total) { t = L.total; pause(); setTime(L.total); return; }
      t = value;
      engine.sync(t, true);
      programmatic = true; tl.scrollLeft = t * pps;
      redraw();
      raf = requestAnimationFrame(tick);
      setTimeout(() => { programmatic = false; }, 0);
    }
    function play() {
      if (!L.total) return;
      if (t >= L.total - 0.05) t = 0;
      playing = true;
      clockBase = t; clockStart = performance.now();
      playButton.replaceChildren(icon("pause")); playButton.setAttribute("aria-label", "Anhalten");
      startAudios();
      cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    }
    function pause() {
      playing = false;
      cancelAnimationFrame(raf);
      engine.pause(); stopAudios();
      playButton.replaceChildren(icon("play")); playButton.setAttribute("aria-label", "Abspielen");
      if (recording) recording.recorder.stop();
    }
    const togglePlay = () => (playing ? pause() : play());
    playButton.addEventListener("click", togglePlay);
    undoButton.addEventListener("click", undo);
    redoButton.addEventListener("click", redo);

    // ---------------------------------------------------------------------------------------------- the tools
    const chip = (label, on, run) => h("button", { class: `ed-chip${on ? " on" : ""}`, type: "button", "aria-pressed": String(!!on), onclick: run }, label);
    const slider = (min, max, step, value, onInput, label) => {
      const input = h("input", { class: "ed-range", type: "range", min: String(min), max: String(max), step: String(step), value: String(value), "aria-label": label });
      let marked = false;
      const mark = () => { if (!marked) { remember(); marked = true; } };
      input.addEventListener("pointerdown", mark); input.addEventListener("keydown", mark); input.addEventListener("change", () => { marked = false; drawTimeline(); });
      input.addEventListener("input", () => { mark(); onInput(Number(input.value)); });
      return h("label", { class: "ed-slider" }, h("span", {}, label), input);
    };
    const swatches = (current, run, extra = []) => h("div", { class: "ed-chips" }, [...extra, ...COLORS.map((color) => { const b = h("button", { class: `ed-color${current === color ? " on" : ""}`, type: "button", "aria-label": `Farbe ${color}`, onclick: () => run(color) }); b.style.background = color; return b; })]);
    const targets = () => (selected && selected.kind === "clip" ? [selected.item] : project.clips);                  // what a look, sliders ... change: the chosen clip, or all of them
    const scope = () => (selected && selected.kind === "clip" ? null : h("p", { class: "ed-hint" }, "Gilt für alle Clips. Tippe einen Clip an, um nur ihn zu ändern."));
    const change = (run) => { remember(); run(); relayout(); drawAll(); engine.sync(t, playing); redrawSoon(); };

    function splitAt(clip, at) {
      const cut = clip.in + (at - clip.start) * clip.speed;
      if (cut <= clip.in + 0.15 * clip.speed || cut >= clip.out - 0.15 * clip.speed) return null;
      const second = JSON.parse(JSON.stringify(clip));
      second.id = itemId(); second.in = cut; second.trans = { type: "none", dur: 0.5 };
      clip.out = cut; const index = project.clips.indexOf(clip);
      clip.trans = clip.trans.type !== "none" ? { type: "none", dur: 0.5 } : clip.trans;
      project.clips.splice(index + 1, 0, second);
      return second;
    }
    function freeze() {
      const clip = project.clips.find((c) => t >= c.start && t < c.start + c.len);
      if (!clip || clip.photo) { toast("Einfrieren geht nur bei einem Video."); return; }
      const size = outputSize();
      const frame = document.createElement("canvas"); frame.width = size.pw; frame.height = size.ph;
      const fctx = frame.getContext("2d");
      const keep = project.bg;
      compose({ ...project, texts: [], stickers: [], overlays: [], fx: [], bg: keep, clips: [clip] }, engine, fctx, frame.width, frame.height, t, null);
      frame.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        files.set(url, blob);
        remember();
        const second = splitAt(clip, t);
        const shot = { id: itemId(), url, photo: true, w: frame.width, h: frame.height, srcDur: 60, in: 0, out: 2, speed: 1, vol: 1, muted: false, mirror: false, flip: false, rot: 0, zoom: 1, filter: 0, adj: DEFAULT_ADJUST(), trans: { type: "none", dur: 0.5 } };
        const index = project.clips.indexOf(second || clip);
        project.clips.splice(second ? index : index + 1, 0, shot);
        relayout(); selected = { kind: "clip", item: shot }; drawAll();
      }, "image/png");
    }
    const remove = (list, item) => { remember(); const at = list.indexOf(item); if (at >= 0) list.splice(at, 1); selected = null; relayout(); drawAll(); };
    function duplicate() {
      if (!selected) return;
      remember();
      if (selected.kind === "clip") { const copy = JSON.parse(JSON.stringify(selected.item)); copy.id = itemId(); copy.trans = { type: "none", dur: 0.5 }; project.clips.splice(project.clips.indexOf(selected.item) + 1, 0, copy); selected = { kind: "clip", item: copy }; }
      else { const list = { text: project.texts, sticker: project.stickers, overlay: project.overlays, fx: project.fx, audio: project.audios }[selected.kind]; const copy = JSON.parse(JSON.stringify(selected.item)); copy.id = itemId(); if (selected.kind === "audio") { buffers.set(copy.id, buffers.get(selected.item.id)); copy.from += copy.len; } else { const len = copy.to - copy.from; copy.from += 0.3; copy.to = copy.from + len; if (copy.x !== undefined) { copy.x = clamp(copy.x + 5, 0, 100); copy.y = clamp(copy.y + 5, 0, 100); } } list.push(copy); selected = { kind: selected.kind, item: copy }; }
      relayout(); drawAll();
    }
    function move(step) {
      if (!selected || selected.kind !== "clip") return;
      const index = project.clips.indexOf(selected.item); const to = index + step;
      if (to < 0 || to >= project.clips.length) return;
      remember(); const [clip] = project.clips.splice(index, 1); project.clips.splice(to, 0, clip); relayout(); drawAll(); setTime(clip.start);
    }
    function addItem(kind, make) {
      remember();
      const from = Math.min(t, Math.max(0, L.total - 0.5));
      const item = make(from, Math.min(Math.max(L.total, from + 0.5), from + 3));
      ({ text: project.texts, sticker: project.stickers, overlay: project.overlays, fx: project.fx })[kind].push(item);
      selected = { kind, item }; relayout(); drawAll();
    }
    const newText = (text) => addItem("text", (from, to) => ({ id: itemId(), text, from, to, x: 50, y: 50, size: 7, rot: 0, color: "#ffffff", stroke: true, shadow: false, bg: "", font: 0, anim: "none" }));
    const newSticker = (extra) => addItem("sticker", (from, to) => ({ id: itemId(), from, to, x: 50, y: 40, size: 14, rot: 0, ...extra }));
    async function newOverlay(f) {
      if (!f) return;
      const photo = f.type.startsWith("image/");
      const url = URL.createObjectURL(f);
      const probe = photo ? new Image() : h("video", { src: url, preload: "auto", playsinline: true });
      await new Promise((resolve) => { if (photo) { probe.onload = resolve; probe.onerror = resolve; probe.src = url; } else { probe.addEventListener("loadedmetadata", resolve, { once: true }); probe.addEventListener("error", resolve, { once: true }); } });
      const dur = photo ? 3 : (Number.isFinite(probe.duration) ? probe.duration : 3);
      addItem("overlay", (from) => ({ id: itemId(), url, photo, w: photo ? probe.naturalWidth : probe.videoWidth, h: photo ? probe.naturalHeight : probe.videoHeight, from, to: from + Math.min(dur, Math.max(1, L.total - from || dur)), in: 0, x: 70, y: 70, size: 38, rot: 0, opacity: 1, mirror: false, vol: 1, muted: false }));
    }

    function drawPanel() {
      panel.hidden = !tool;
      if (!tool) { panel.replaceChildren(); return; }
      const rows = [];
      const sel = selected && selected.item;
      const clip = selected && selected.kind === "clip" ? selected.item : null;
      if (tool === "speed") {
        rows.push(h("b", {}, "Tempo"), h("div", { class: "ed-chips" }, SPEEDS.map((speed) => chip(`${speed}x`, targets().every((c) => c.speed === speed), () => change(() => { for (const c of targets()) c.speed = speed; })))), scope());
      } else if (tool === "volume") {
        const c0 = targets()[0];
        rows.push(h("div", { class: "ed-chips" }, chip(targets().every((c) => c.muted) ? "Originalton aus" : "Originalton an", targets().every((c) => !c.muted), () => change(() => { const off = targets().every((c) => !c.muted); for (const c of targets()) c.muted = off; }))),
          c0 ? slider(0, 2, 0.05, c0.vol, (v) => { for (const c of targets()) c.vol = v; engine.sync(t, playing); }, "Lautstärke") : null, scope());
      } else if (tool === "zoom") {
        const c0 = targets()[0];
        rows.push(c0 ? slider(0.5, 3, 0.05, c0.zoom, (v) => { for (const c of targets()) c.zoom = v; redraw(); }, "Zoom") : null,
          h("div", { class: "ed-chips" }, chip("Drehen", false, () => change(() => { for (const c of targets()) c.rot = (c.rot + 1) % 4; })), chip("Spiegeln", targets().every((c) => c.mirror), () => change(() => { const on = !targets().every((c) => c.mirror); for (const c of targets()) c.mirror = on; })), chip("Kopfstand", targets().every((c) => c.flip), () => change(() => { const on = !targets().every((c) => c.flip); for (const c of targets()) c.flip = on; }))), scope());
      } else if (tool === "filter") {
        rows.push(h("div", { class: "ed-chips" }, FILTERS.map(([name], index) => chip(name, targets().every((c) => c.filter === index), () => change(() => { for (const c of targets()) c.filter = index; })))), scope());
      } else if (tool === "adjust") {
        const c0 = targets()[0];
        if (c0) {
          const set = (key) => (v) => { for (const c of targets()) c.adj[key] = v; redraw(); };
          rows.push(slider(0.5, 1.5, 0.05, c0.adj.brightness, set("brightness"), "Helligkeit"), slider(0.5, 1.8, 0.05, c0.adj.contrast, set("contrast"), "Kontrast"), slider(0, 2.5, 0.05, c0.adj.saturate, set("saturate"), "Sättigung"),
            slider(-1, 1, 0.05, c0.adj.temp, set("temp"), "Wärme"), slider(0, 0.9, 0.05, c0.adj.vignette, set("vignette"), "Vignette"), slider(0, 6, 0.25, c0.adj.blur, set("blur"), "Weichzeichner"),
            h("div", { class: "ed-chips" }, chip("Zurücksetzen", false, () => change(() => { for (const c of targets()) c.adj = DEFAULT_ADJUST(); }))), scope());
        }
      } else if (tool === "trans") {
        if (!clip) rows.push(h("p", { class: "ed-hint" }, "Tippe in der Zeitleiste auf einen Clip und dann auf das Plus zwischen zwei Clips."));
        else if (project.clips.indexOf(clip) >= project.clips.length - 1) rows.push(h("p", { class: "ed-hint" }, "Ein Übergang geht vom gewählten Clip zum nächsten. Dieser ist der letzte."));
        else rows.push(h("b", {}, "Übergang zum nächsten Clip"), h("div", { class: "ed-chips" }, TRANSITIONS.map(([id, name]) => chip(name, clip.trans.type === id, () => change(() => { clip.trans.type = id; })))), clip.trans.type !== "none" ? slider(0.2, 1.5, 0.1, clip.trans.dur, (v) => { clip.trans.dur = v; relayout(); drawTimeline(); redraw(); }, "Dauer") : null);
      } else if (tool === "format") {
        rows.push(h("b", {}, "Format"), h("div", { class: "ed-chips" }, RATIOS.map(([id, name]) => chip(name, project.ratio === id, () => change(() => { project.ratio = id; })))),
          h("b", {}, "Hintergrund"), h("div", { class: "ed-chips" }, chip("Unscharf", project.bg === "blur", () => change(() => { project.bg = "blur"; })), chip("Schwarz", project.bg === "black", () => change(() => { project.bg = "black"; }))));
      } else if (tool === "captions") {
        rows.push(chip(project.captions ? "Untertitel automatisch: an" : "Untertitel automatisch: aus", project.captions, () => change(() => { project.captions = !project.captions; })), h("p", { class: "ed-hint" }, "Satürn schreibt nach dem Hochladen Untertitel und kann das Video in 22 Sprachen vorlesen."));
      } else if (tool === "text") {
        const x = selected && selected.kind === "text" ? selected.item : null;
        const input = h("input", { class: "ed-field", type: "text", maxlength: 80, placeholder: "Dein Text", "aria-label": "Text", value: x ? x.text : "" });
        if (x) input.addEventListener("input", () => { x.text = input.value || " "; redraw(); drawTimeline(); });
        const add = h("button", { class: "ed-chip on", type: "button", onclick: () => { const text = input.value.trim(); if (!text) return; newText(text); } }, "Text hinzufügen");
        rows.push(x ? h("div", { class: "ed-row2" }, input) : h("div", { class: "ed-row2" }, input, add));
        if (x) {
          const set = (key, value) => change(() => { x[key] = value; });
          rows.push(h("b", {}, "Schrift"), h("div", { class: "ed-chips" }, FONTS.map(([name], index) => chip(name, x.font === index, () => set("font", index)))),
            h("b", {}, "Farbe"), swatches(x.color, (color) => set("color", color)),
            h("div", { class: "ed-chips" }, chip("Kontur", x.stroke, () => set("stroke", !x.stroke)), chip("Schatten", x.shadow, () => set("shadow", !x.shadow)), chip("Hintergrund", !!x.bg, () => set("bg", x.bg ? "" : "rgba(0,0,0,0.6)")), x.bg ? chip("Weiß", x.bg === "#ffffff", () => set("bg", "#ffffff")) : null),
            h("b", {}, "Animation"), h("div", { class: "ed-chips" }, TEXT_ANIMS.map(([id, name]) => chip(name, x.anim === id, () => set("anim", id)))),
            slider(2, 24, 0.5, x.size, (v) => { x.size = v; redraw(); }, "Größe"), slider(-45, 45, 1, x.rot, (v) => { x.rot = v; redraw(); }, "Drehung"),
            h("div", { class: "ed-chips" }, chip("Kopieren", false, duplicate), h("button", { class: "ed-chip", type: "button", onclick: () => remove(project.texts, x) }, icon("trash"), "Entfernen")));
        }
      } else if (tool === "sticker") {
        const x = selected && selected.kind === "sticker" ? selected.item : null;
        rows.push(h("b", {}, "Samojis"), h("div", { class: "ed-chips stickers" }, SAMOJIS.map(([file, name]) => { const b = h("button", { class: "ed-chip sticker", type: "button", "aria-label": name, onclick: () => newSticker({ img: `/static/img/samoji/${file}.png` }) }, h("img", { src: `/static/img/samoji/${file}.png`, alt: "", draggable: false })); return b; })),
          h("b", {}, "Emoji"), h("div", { class: "ed-chips stickers" }, EMOJI.map((char) => h("button", { class: "ed-chip sticker", type: "button", "aria-label": `Sticker ${char}`, onclick: () => newSticker({ char }) }, char))));
        if (x) rows.push(slider(4, 60, 0.5, x.size, (v) => { x.size = v; redraw(); }, "Größe"), slider(-180, 180, 1, x.rot, (v) => { x.rot = v; redraw(); }, "Drehung"),
          h("div", { class: "ed-chips" }, chip("Kopieren", false, duplicate), h("button", { class: "ed-chip", type: "button", onclick: () => remove(project.stickers, x) }, icon("trash"), "Entfernen")));
      } else if (tool === "overlay") {
        const x = selected && selected.kind === "overlay" ? selected.item : null;
        rows.push(h("div", { class: "ed-chips" }, h("button", { class: "ed-chip on", type: "button", onclick: () => overlayPicker.click() }, icon("plus"), "Foto oder Video darüberlegen")));
        if (x) rows.push(slider(10, 100, 1, x.size, (v) => { x.size = v; redraw(); }, "Größe"), slider(0.1, 1, 0.05, x.opacity, (v) => { x.opacity = v; redraw(); }, "Deckkraft"), slider(-180, 180, 1, x.rot, (v) => { x.rot = v; redraw(); }, "Drehung"),
          h("div", { class: "ed-chips" }, chip("Spiegeln", x.mirror, () => change(() => { x.mirror = !x.mirror; })), x.photo ? null : chip(x.muted ? "Ton aus" : "Ton an", !x.muted, () => change(() => { x.muted = !x.muted; })), chip("Kopieren", false, duplicate), h("button", { class: "ed-chip", type: "button", onclick: () => remove(project.overlays, x) }, icon("trash"), "Entfernen")));
      } else if (tool === "fx") {
        const x = selected && selected.kind === "fx" ? selected.item : null;
        rows.push(h("b", {}, "Effekt an dieser Stelle einfügen"), h("div", { class: "ed-chips" }, FX.map(([id, name]) => chip(name, x && x.type === id, () => { if (x) change(() => { x.type = id; }); else addItem("fx", (from, to) => ({ id: itemId(), type: id, from, to })); }))));
        if (x) rows.push(h("p", { class: "ed-hint" }, "Zieh den Balken in der Zeitleiste, um den Effekt zu verschieben oder länger zu machen."), h("div", { class: "ed-chips" }, chip("Kopieren", false, duplicate), h("button", { class: "ed-chip", type: "button", onclick: () => remove(project.fx, x) }, icon("trash"), "Entfernen")));
      } else if (tool === "audio") {
        const x = selected && selected.kind === "audio" ? selected.item : null;
        rows.push(h("div", { class: "ed-chips" }, h("button", { class: "ed-chip on", type: "button", onclick: chooseMusic }, icon("music"), "Musik hinzufügen"), h("button", { class: `ed-chip${recording ? " rec" : ""}`, type: "button", onclick: toggleRecording }, icon("mic"), recording ? "Aufnahme beenden" : "Aufnehmen")),
          chip(project.clips.every((c) => c.muted) ? "Originalton aus" : "Originalton an", project.clips.every((c) => !c.muted), () => change(() => { const off = project.clips.every((c) => !c.muted); for (const c of project.clips) c.muted = off; })));
        if (x) rows.push(h("b", {}, x.title), slider(0, 2, 0.05, x.vol, (v) => { x.vol = v; }, "Lautstärke"), slider(0, 5, 0.1, x.fadeIn, (v) => { x.fadeIn = v; }, "Einblenden"), slider(0, 5, 0.1, x.fadeOut, (v) => { x.fadeOut = v; }, "Ausblenden"),
          h("div", { class: "ed-chips" }, chip("Kopieren", false, duplicate), h("button", { class: "ed-chip", type: "button", onclick: () => { remember(); buffers.delete(x.id); remove(project.audios, x); } }, icon("trash"), "Entfernen")));
      }
      panel.replaceChildren(...rows.filter(Boolean));
      void sel;
    }

    /* The bar at the bottom: the tools for the project; when a clip is chosen the tools of the clip; when a text, sticker, overlay, effect or sound is chosen the tools of that. */
    function toolList() {
      const sel = selected && selected.kind;
      if (sel === "clip") return [["split", "scissors", "Teilen"], ["speed", "speed", "Tempo"], ["volume", "volume", "Lautstärke"], ["zoom", "maximize", "Zoom"], ["rotate", "refresh", "Drehen"], ["filter", "filter", "Filter"], ["adjust", "settings", "Anpassen"], ["trans", "film", "Übergang"],
        ["freeze", "timer", "Einfrieren"], ["dup", "image", "Kopieren"], ["left", "back", "Nach vorn"], ["right", "chevron", "Nach hinten"], ["del", "trash", "Löschen"], ["done", "check", "Fertig"]];
      if (sel) return [["edit", "pencil", "Bearbeiten"], ["dup", "image", "Kopieren"], ["del", "trash", "Löschen"], ["done", "check", "Fertig"]];
      return [["add", "plus", "Clip"], ["audio", "music", "Audio"], ["text", "text", "Text"], ["sticker", "sticker", "Sticker"], ["overlay", "image", "Überlagerung"], ["fx", "sparkle", "Effekte"], ["filter", "filter", "Filter"], ["adjust", "settings", "Anpassen"], ["format", "maximize", "Format"], ["captions", "captions", "Untertitel"]];
    }
    function runTool(id) {
      if (id === "add") { picker.click(); return; }
      if (id === "done") { selected = null; tool = ""; drawAll(); return; }
      if (id === "split") { const clip = selected.item; remember(); const second = splitAt(clip, t); if (!second) { history.pop(); toast("Halte die Zeitleiste an der Stelle an, wo du teilen willst."); return; } relayout(); selected = { kind: "clip", item: second }; drawAll(); return; }
      if (id === "rotate") { change(() => { selected.item.rot = (selected.item.rot + 1) % 4; }); return; }
      if (id === "freeze") { freeze(); return; }
      if (id === "dup") { duplicate(); return; }
      if (id === "left") { move(-1); return; }
      if (id === "right") { move(1); return; }
      if (id === "del") {
        const kind = selected.kind;
        const list = { clip: project.clips, text: project.texts, sticker: project.stickers, overlay: project.overlays, fx: project.fx, audio: project.audios }[kind];
        if (kind === "clip" && project.clips.length === 1) { toast("Das ist der einzige Clip. Schließe den Schnitt, wenn du aufhören willst."); return; }
        remove(list, selected.item); return;
      }
      if (id === "edit") { tool = { text: "text", sticker: "sticker", overlay: "overlay", fx: "fx", audio: "audio" }[selected.kind]; drawAll(); return; }
      tool = tool === id ? "" : id;
      drawAll();
    }
    function drawTools() {
      toolbar.replaceChildren(...toolList().map(([id, symbol, label]) => h("button", { class: `ed-tool${tool === id ? " on" : ""}`, type: "button", "aria-pressed": String(tool === id), onclick: () => runTool(id) }, icon(symbol), h("span", {}, label))));
    }
    function drawTopButtons() { undoButton.disabled = !history.length; redoButton.disabled = !future.length; }
    function drawAll() { drawTools(); drawPanel(); drawTimeline(); drawTopButtons(); redraw(); }

    // ---------------------------------------------------------------------------------------------- finishing
    const plain = () => {
      if (project.clips.length !== 1 || project.texts.length || project.stickers.length || project.overlays.length || project.fx.length || project.audios.length || project.ratio !== "orig") return false;
      const c = project.clips[0];
      return !c.photo && c.in < 0.05 && c.out > c.srcDur - 0.05 && c.speed === 1 && c.vol === 1 && !c.muted && !c.mirror && !c.flip && c.rot === 0 && c.zoom === 1 && c.filter === 0 && JSON.stringify(c.adj) === JSON.stringify(DEFAULT_ADJUST());
    };

    async function render() {
      const mime = pickMime();
      if (!mime) throw new Error("no recorder");
      const size = outputSize();
      const width = size.width; const height = size.height;
      const out = document.createElement("canvas");
      out.width = width; out.height = height;
      const octx = out.getContext("2d");
      const audio = new AC();
      await audio.resume();
      const sink = audio.createMediaStreamDestination();
      const mixer = createEngine(project, { audio, sink });
      mixer.size(width, height);
      // every element is loaded before the recording starts
      for (const item of [...project.clips, ...project.overlays]) { const el = mixer.elementFor(item); if (!item.photo) await new Promise((resolve) => { if (el.readyState >= 2) resolve(); else { el.addEventListener("loadeddata", resolve, { once: true }); el.addEventListener("error", resolve, { once: true }); setTimeout(resolve, 5000); } }); }
      const total = L.total;
      const stream = out.captureStream(30);
      for (const track of sink.stream.getAudioTracks()) stream.addTrack(track);
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
      const chunks = [];
      recorder.addEventListener("dataavailable", (event) => { if (event.data && event.data.size) chunks.push(event.data); });
      const finished = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
      mixer.sync(0, false);
      await new Promise((resolve) => setTimeout(resolve, 400));
      recorder.start(250);
      const begin = performance.now();
      const sounds = scheduleAudios(audio, sink, 0, audio.currentTime + 0.05);
      await new Promise((resolve) => {
        const bar = progress.querySelector(".ed-bar i");
        const step = () => {
          const now = (performance.now() - begin) / 1000;
          const at = Math.min(now, total);
          mixer.sync(at, true);
          compose(project, mixer, octx, width, height, at, null);
          bar.style.width = `${Math.min(100, (at / total) * 100)}%`;
          if (now >= total || closed) resolve(); else setTimeout(step, 33);       // (a timer, not the animation frame: it keeps running when the page is in the background)
        };
        step();
      });
      mixer.pause();
      for (const s of sounds) { try { s.stop(); } catch (error) { /* it had not started */ } }
      recorder.stop();
      await finished;
      mixer.dispose();
      audio.close();
      const blob = new Blob(chunks, { type: mime.split(";")[0] });
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      return { file: new File([blob], `video.${ext}`, { type: blob.type }), width, height, seconds: total, captions: project.captions };
    }

    async function finish() {
      if (busy || !project.clips.length) return;
      pause();
      if (plain()) { const c = project.clips[0]; done({ file: files.get(c.url) || file, width: c.w, height: c.h, seconds: c.srcDur, captions: project.captions }); return; }
      busy = true;
      upload.disabled = true;
      progress.hidden = false;
      try { done(await render()); } catch (error) {
        console.error(error);
        busy = false;
        upload.disabled = false;
        progress.hidden = true;
        toast("Dein Browser kann das Video nicht bearbeiten. Du kannst es ohne Bearbeitung hochladen.");
      }
    }
    function done(result) { teardown(); onDone?.(result); }
    function teardown() {
      closed = true;
      pause();
      engine.dispose();
      actx?.close?.();
      removeEventListener("resize", onResize);
      document.body.classList.remove("modal-open");
      root.remove();
      for (const url of files.keys()) URL.revokeObjectURL(url);
    }
    const onResize = () => { drawTimeline(); setTime(t); };
    upload.addEventListener("click", finish);
    close.addEventListener("click", () => { if (busy) return; teardown(); onClose?.(); });
    picker.addEventListener("change", () => { addFiles(picker.files); picker.value = ""; });
    overlayPicker.addEventListener("change", () => { newOverlay(overlayPicker.files[0]); overlayPicker.value = ""; });
    addEventListener("resize", onResize);

    const controls = h("div", { class: "ed-controls" }, timeText, h("span", { class: "ed-spacer" }), zoomOut, zoomIn, playButton);
    const root = h("div", { class: `ed${snap ? " snap" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": "Video bearbeiten" },
      h("div", { class: "ed-top" }, close, undoButton, redoButton, h("span", { class: "ed-spacer" }), upload), stage, controls,
      h("div", { class: "ed-low" }, timeline), panel, toolbar, progress, picker, overlayPicker);
    document.body.append(root);
    document.body.classList.add("modal-open");
    drawAll();
    addFiles([file]).then(() => { fitZoom(); setTime(0); });
    return { close: teardown };
  }

  Y.videoEditor = { open };
})();
