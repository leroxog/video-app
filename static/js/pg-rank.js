/* Satürn games: the ranking games (pg-rank.js). "Ranke die Fußballer" (musicians, countries, and the rankings that people made themselves): a reel like a slot machine rolls above the head
   of the player (the camera tab finds the forehead, see `hooks.face`) and stops on one picture; you tap the place (1 to 5, or 1 to 10) at the side of the screen where that picture
   belongs in your own ranking, the picture flies there, and the reel rolls again until every place is taken. The pictures of the games of Satürn are freely licensed ones from Wikimedia
   Commons (static/rank, collected by scripts/fetch_rank_images.py; the page /bildnachweise credits them). Without the pictures (or in a test without a browser) the games work
   with names and coloured circles. Nothing but the reel, the places and a small title is drawn, so the player is seen. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;
  const TAU = Math.PI * 2;
  const rr = (g, x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); };

  const CATEGORIES = [
    { key: "footballers", id: "rank-footballers", name: "Rangliste: Fußballer", short: "Fußballer", emoji: "⚽", color: "#1f9d55", fit: "cover", order: 3,
      names: ["Messi", "Ronaldo", "Mbappé", "Haaland", "Neuer", "Müller", "Musiala", "Wirtz", "Kroos", "Pelé", "Maradona", "Beckenbauer"] },
    { key: "musicians", id: "rank-musicians", name: "Rangliste: Musiker", short: "Musiker", emoji: "🎤", color: "#8a4bd6", fit: "cover", order: 4,
      names: ["Taylor Swift", "Ed Sheeran", "Eminem", "Rihanna", "Beyoncé", "Adele", "Drake", "Shakira", "Nena", "Sido", "Madonna", "Bob Marley"] },
    { key: "countries", id: "rank-countries", name: "Rangliste: Länder", short: "Länder", emoji: "🌍", color: "#2a6fdb", fit: "contain", order: 5,
      names: ["Deutschland", "Frankreich", "Italien", "Spanien", "Brasilien", "Japan", "Kanada", "Schweiz", "Österreich", "Portugal", "Mexiko", "Norwegen"] },
  ];

  // ---- the list of pictures is fetched once; every picture is loaded once
  let indexPromise = null;
  function loadIndex() {
    if (typeof fetch !== "function") return Promise.resolve(null);
    if (!indexPromise) indexPromise = fetch("/static/rank/index.json", { credentials: "same-origin" }).then((reply) => (reply.ok ? reply.json() : null)).catch(() => null);
    return indexPromise;
  }
  const pictures = new Map();
  function picture(url) {
    if (typeof Image === "undefined") return null;
    if (!pictures.has(url)) {
      const img = new Image();
      const entry = { img, ok: false };
      img.onload = () => { entry.ok = true; };
      img.src = url;
      pictures.set(url, entry);
    }
    return pictures.get(url);
  }
  const initials = (name) => name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
  const tint = (name) => `hsl(${[...name].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7)} 55% 42%)`;

  /* one picture (or, without it, a coloured circle with the initials) in a rounded box */
  function drawPicture(g, item, x, y, w, h, radius, fit) {
    g.save();
    rr(g, x, y, w, h, radius);
    g.clip();
    const entry = item.pic;
    if (entry && entry.ok && entry.img.naturalWidth) {
      const iw = entry.img.naturalWidth, ih = entry.img.naturalHeight;
      if (fit === "contain") {
        g.fillStyle = "#f4f4f6"; g.fillRect(x, y, w, h);
        const k = Math.min(w / iw, h / ih);
        g.drawImage(entry.img, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
      } else {
        const k = Math.max(w / iw, h / ih);
        g.drawImage(entry.img, x + (w - iw * k) / 2, y + (h - ih * k) * 0.3, iw * k, ih * k);
      }
    } else {
      g.fillStyle = tint(item.name); g.fillRect(x, y, w, h);
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.font = `800 ${Math.round(Math.min(w, h) * 0.38)}px system-ui, sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(initials(item.name), x + w / 2, y + h / 2 + 1);
    }
    g.restore();
  }

  const clampn = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* The game of one ranking: meta = {id, short, color, fit, size (5 or 10), names (without pictures) or entries [{name, url}], loadItems(): Promise<[{name, url}]> or nothing}. */
  function makeRank(meta, e) {
    const g = e.g;
    let items = (meta.names || []).map((name) => ({ name, pic: null }));
    if (meta.entries) items = meta.entries.map((entry) => ({ name: entry.name, pic: entry.url ? picture(entry.url) : null }));
    let ready = !meta.loadItems || typeof fetch !== "function" || typeof Image === "undefined";      // without a browser (the tests) the game plays with names only
    if (!ready) meta.loadItems().then((list) => {
      if (Array.isArray(list) && list.length >= 12) {
        items = list.map((entry) => ({ name: entry.name, pic: picture(entry.url) }));
        if (phase === "wait") reset();                                          // the round starts from the list with the pictures, not from the one with the names only
      }
      ready = true;
    });
    const size = meta.size === 10 ? 10 : 5;
    let slots = [];
    let pool = [];
    let current = null;
    let strip = [];
    let phase = "wait";
    let t = 0, flyT = 0, flyTo = -1, doneT = 0, hover = -1, pulse = 0, shown = 0;
    const reelAt = { x: W / 2, y: 150, roll: 0, size: 112 };
    const SPIN = 1.5, PICK_MAX = 7, FLY = 0.5;

    function reset() {
      slots = Array.from({ length: size }, () => null);
      pool = e.shuffle(items);
      current = null;
      phase = "wait";
      shown = 0;
    }
    reset();
    /* the places stand at the edge of the screen: 1 to 5 on the right, 6 to 10 on the left (smaller) */
    const slotRect = (i) => (size === 5 ? { x: W - 82, y: 128 + i * 76, w: 70, h: 66 } : i < 5 ? { x: W - 70, y: 112 + i * 64, w: 58, h: 56 } : { x: 12, y: 112 + (i - 5) * 64, w: 58, h: 56 });
    const seen = (item) => !item.pic || item.pic.ok;                         // its picture has arrived (or it has none)
    function nextSpin() {
      if (!pool.length) pool = e.shuffle(items);
      current = pool.pop();
      for (let tries = pool.length; tries > 0 && !seen(current); tries--) { pool.unshift(current); current = pool.pop(); }       // the one that stops should show its picture
      const others = items.filter((item) => item !== current);
      const decoys = e.shuffle(others.filter(seen).length >= 12 ? others.filter(seen) : others).slice(0, 12);
      strip = [...decoys, current];                                   // the reel shows these one after the other and stops on the last
      phase = "spin";
      t = 0;
      shown = 0;
    }
    function place(i) {
      slots[i] = current;
      flyTo = i; flyT = 0; phase = "fly";
      e.score(slots.filter(Boolean).length * 10);
    }
    /* where the reel hangs: on the forehead of the player (when the camera has found it), tilted with the head */
    function follow() {
      const f = e.hooks && e.hooks.face ? e.hooks.face() : null;
      let tx = W / 2, ty = 150, roll = 0, sz = 112;
      if (f && f.have) { sz = clampn(f.w * 0.95, 96, 134); tx = clampn(f.x, sz / 2 + 8, W - sz / 2 - 8); ty = f.y - sz * 0.6 - 10; roll = clampn(f.roll, -0.6, 0.6); }
      ty = Math.max(ty, 112 + sz / 2);
      const k = f && f.have ? 0.35 : 0.1;
      reelAt.x += (tx - reelAt.x) * k; reelAt.y += (ty - reelAt.y) * k; reelAt.roll += (roll - reelAt.roll) * k; reelAt.size += (sz - reelAt.size) * k;
    }

    return {
      peek: () => ({ items, pool, current, slots, ready }),                    // for the tests
      update(dt) {
        const i = e.input;
        pulse += dt;
        hover = -1;
        if (phase === "wait") { if (ready) nextSpin(); return; }
        if (phase === "spin") {
          t += dt;
          shown = Math.min(1, t / SPIN);
          if (t >= SPIN) { phase = "pick"; t = 0; navigator.vibrate?.(15); }
          return;
        }
        if (phase === "pick") {
          t += dt;
          for (let k = 0; k < size; k++) {
            const r = slotRect(k);
            if (slots[k]) continue;
            if (i.down && e.inside(i.x, i.y, r.x - 6, r.y - 4, r.w + 12, r.h + 8)) hover = k;
            if (i.tap && e.inside(i.x, i.y, r.x - 6, r.y - 4, r.w + 12, r.h + 8)) { place(k); return; }
          }
          if (t > PICK_MAX) { const free = slots.map((s, k) => (s ? -1 : k)).filter((k) => k >= 0); place(free[0]); }
          return;
        }
        if (phase === "fly") {
          flyT += dt;
          if (flyT >= FLY) {
            if (slots.every(Boolean)) { phase = "done"; doneT = 0; } else nextSpin();
          }
          return;
        }
        if (phase === "done") { doneT += dt; if (doneT > 2.4) e.over(); }
      },

      draw() {
        follow();
        // ---- the title, small
        e.panel(W / 2 - 92, 540, 184, 28, 14, 0.5);
        e.text(`Meine Top ${size}: ${meta.short}`, W / 2, 554, { size: 14, stroke: false });
        // ---- the places at the side
        for (let k = 0; k < size; k++) {
          const r = slotRect(k);
          const item = slots[k];
          const open = phase === "pick" && !item;
          const hot = hover === k;
          g.fillStyle = item ? "rgba(255,255,255,0.95)" : hot ? "rgba(255,255,255,0.5)" : open ? `rgba(255,255,255,${0.2 + 0.08 * Math.sin(pulse * 6 + k)})` : "rgba(20,22,28,0.42)";
          rr(g, r.x, r.y, r.w, r.h, 16); g.fill();
          g.lineWidth = 2; g.strokeStyle = open ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.4)";
          rr(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 15); g.stroke();
          if (item && !(phase === "fly" && flyTo === k && flyT < FLY)) {
            drawPicture(g, item, r.x + 3, r.y + 3, r.w - 6, r.h - 6, 13, meta.fit);
            g.fillStyle = "rgba(0,0,0,0.5)"; rr(g, r.x + 3, r.y + r.h - 19, r.w - 6, 16, 8); g.fill();
            e.text(item.name.length > 11 ? `${item.name.slice(0, 10)}…` : item.name, r.x + r.w / 2, r.y + r.h - 11, { size: 9.5, weight: 700, stroke: false });
          }
          g.fillStyle = item ? meta.color : "rgba(255,255,255,0.92)"; g.beginPath(); g.arc(r.x + 3, r.y + 3, 10, 0, TAU); g.fill();
          e.text(String(k + 1), r.x + 3, r.y + 4, { size: 12, color: item ? "#fff" : "#111", stroke: false });
        }
        // ---- the reel above the head
        const rs = reelAt.size;
        g.save();
        g.translate(reelAt.x, reelAt.y);
        g.rotate(reelAt.roll);
        const glow = g.createRadialGradient(0, 0, rs * 0.3, 0, 0, rs * 0.95);
        glow.addColorStop(0, "rgba(255,255,255,0.22)"); glow.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = glow; g.fillRect(-rs, -rs, rs * 2, rs * 2);
        g.fillStyle = "rgba(255,255,255,0.95)";                              // the little tail that points to the head
        g.beginPath(); g.moveTo(-10, rs / 2 + 4); g.lineTo(10, rs / 2 + 4); g.lineTo(0, rs / 2 + 16); g.closePath(); g.fill();
        g.fillStyle = meta.color; rr(g, -rs / 2 - 5, -rs / 2 - 5, rs + 10, rs + 10, 24); g.fill();
        g.lineWidth = 3; g.strokeStyle = "rgba(255,255,255,0.95)"; rr(g, -rs / 2 - 5, -rs / 2 - 5, rs + 10, rs + 10, 24); g.stroke();
        g.save();
        rr(g, -rs / 2, -rs / 2, rs, rs, 19); g.clip();
        g.fillStyle = "#14161c"; g.fillRect(-rs / 2, -rs / 2, rs, rs);
        if (phase === "spin" && strip.length) {
          const eased = 1 - Math.pow(1 - shown, 3);
          const pos = eased * (strip.length - 1) * rs;
          for (let k = Math.max(0, Math.floor(pos / rs) - 1); k <= Math.min(strip.length - 1, Math.floor(pos / rs) + 1); k++) drawPicture(g, strip[k], -rs / 2, -rs / 2 + k * rs - pos, rs, rs, 0, meta.fit);
          g.fillStyle = `rgba(0,0,0,${0.35 * (1 - shown)})`; g.fillRect(-rs / 2, -rs / 2, rs, rs);
        } else if (current && phase === "pick") {
          drawPicture(g, current, -rs / 2, -rs / 2, rs, rs, 0, meta.fit);
        } else if (phase === "done") {
          e.text("Fertig!", 0, 0, { size: 26 });
        } else if (phase !== "fly") {
          e.text("?", 0, 2, { size: 64, color: "rgba(255,255,255,0.75)" });
        }
        g.restore();
        if (phase === "pick") { g.strokeStyle = `rgba(255,255,255,${0.5 + 0.45 * Math.sin(pulse * 8)})`; g.lineWidth = 4; rr(g, -rs / 2 - 9, -rs / 2 - 9, rs + 18, rs + 18, 27); g.stroke(); }
        g.restore();
        // the name, above the reel
        if (current && (phase === "pick" || phase === "fly")) e.text(current.name, reelAt.x, reelAt.y - rs / 2 - 16, { size: 18 });
        // ---- the card that flies to its place
        if (phase === "fly" && current) {
          const r = slotRect(flyTo);
          const u = Math.min(1, flyT / FLY);
          const k = u * u * (3 - 2 * u);
          const x0 = reelAt.x - rs / 2, y0 = reelAt.y - rs / 2;
          const w1 = r.w - 6, h1 = r.h - 6;
          drawPicture(g, current, x0 + (r.x + 3 - x0) * k, y0 + (r.y + 3 - y0) * k - Math.sin(u * Math.PI) * 30, rs + (w1 - rs) * k, rs + (h1 - rs) * k, 18 * (1 - k) + 13 * k, meta.fit);
        }
      },
    };
  }

  for (const cat of CATEGORIES) {
    R({ id: cat.id, name: cat.name, emoji: cat.emoji, cat: "Ranglisten", featured: true, bubble: false, backdrop: false, face: true, order: cat.order, color: cat.color, hint: "Tippe auf den Platz, auf den die Person gehört", create(e) {
      return makeRank({ id: cat.id, short: cat.short, color: cat.color, fit: cat.fit, size: 5, names: cat.names,
        loadItems: () => loadIndex().then((data) => { const list = data && data[cat.key]; return Array.isArray(list) ? list.map((entry) => ({ name: entry.name, url: `/static/rank/${cat.key}/${entry.file}` })) : null; }) }, e);
    } });
  }

  /* the game of a ranking that a person made: meta = {id, title, color, size, entries: [{name, url}]} (see pg-community.js) */
  window.PulseGames.rankDef = (meta) => ({
    id: meta.id, name: meta.title, emoji: meta.emoji || "🏆", cat: "Community", hint: "Tippe auf den Platz, auf den es gehört", color: meta.color, bubble: false, backdrop: false, face: true, community: true,
    create: (e) => makeRank({ id: meta.id, short: meta.title.length > 18 ? `${meta.title.slice(0, 17)}…` : meta.title, color: meta.color || "#6c7bff", fit: "cover", size: meta.size === 10 ? 10 : 5, entries: meta.entries }, e),
  });
})();
