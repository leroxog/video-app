/* Nex games: the ranking games (pg-rank.js). "Ranke die Fußballer" (musicians, countries): a machine like a slot machine spins pictures one after the other and stops on one
   person; you tap the place (1 to 5, or 1 to 10) where that person belongs in your own ranking, the picture flies there, and the machine spins again until every place is taken.
   The pictures are freely licensed ones from Wikimedia Commons (static/rank, collected by scripts/fetch_rank_images.py; the page /bildnachweise credits them). Without the
   pictures (or in a test without a browser) the games work with names and coloured circles. Before the first touch the game shows its machine and its places and two switches
   for "Top 5" and "Top 10"; the first touch somewhere else starts it (and the recording). */
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

  for (const cat of CATEGORIES) {
    R({ id: cat.id, name: cat.name, emoji: cat.emoji, cat: "Ranglisten", featured: true, order: cat.order, color: cat.color, hint: "Tippe auf den Platz, auf den die Person gehört", create(e) {
      const g = e.g;
      let items = cat.names.map((name) => ({ name, pic: null }));
      let ready = typeof fetch !== "function" || typeof Image === "undefined";      // without a browser (the tests) the game plays with names only
      if (!ready) loadIndex().then((data) => {
        const list = data && data[cat.key];
        if (Array.isArray(list) && list.length >= 12) {
          items = list.map((entry) => ({ name: entry.name, pic: picture(`/static/rank/${cat.key}/${entry.file}`) }));
          if (phase === "wait") reset();                                          // the round starts from the list with the pictures, not from the one with the names only
        }
        ready = true;
      });
      let size = 5;
      let slots = [];
      let pool = [];
      let current = null;
      let strip = [];
      let phase = "wait";
      let t = 0, started = false, flyT = 0, flyTo = -1, doneT = 0, hover = -1, pulse = 0, shown = 0;
      const SPIN = 1.5, PICK_MAX = 7, FLY = 0.5;
      const TOGGLES = [{ n: 5, x: 112, y: 96, w: 62, h: 28 }, { n: 10, x: 186, y: 96, w: 62, h: 28 }];
      const WIN = { x: 100, y: 134, w: 160, h: 160 };

      function reset() {
        slots = Array.from({ length: size }, () => null);
        pool = e.shuffle(items);
        current = null;
        phase = "wait";
        shown = 0;
      }
      reset();
      const rowRect = (i) => {
        const rows = size, top = 326, bottom = 626, gap = rows === 5 ? 6 : 3;
        const h = (bottom - top - gap * (rows - 1)) / rows;
        return { x: 20, y: top + i * (h + gap), w: 320, h };
      };
      const seen = (item) => !item.pic || item.pic.ok;                         // its picture has arrived (or it has none)
      function nextSpin() {
        if (!pool.length) pool = e.shuffle(items);
        current = pool.pop();
        for (let tries = pool.length; tries > 0 && !seen(current); tries--) { pool.unshift(current); current = pool.pop(); }       // the one that stops should show its picture
        const others = items.filter((item) => item !== current);
        const decoys = e.shuffle(others.filter(seen).length >= 12 ? others.filter(seen) : others).slice(0, 12);
        strip = [...decoys, current];                                   // the machine shows these one after the other and stops on the last
        phase = "spin";
        t = 0;
        shown = 0;
      }
      function place(i) {
        slots[i] = current;
        flyTo = i; flyT = 0; phase = "fly";
        e.score(slots.filter(Boolean).length * 10);
      }

      return {
        peek: () => ({ items, pool, current, slots, ready }),                    // for the tests
        canStart(x, y) { return !TOGGLES.some((tg) => e.inside(x, y, tg.x, tg.y, tg.w, tg.h)); },
        idle(input) {                                                      // before the first touch only the two switches answer
          if (input.tap) for (const tg of TOGGLES) if (e.inside(input.x, input.y, tg.x, tg.y, tg.w, tg.h) && size !== tg.n) { size = tg.n; reset(); }
        },
        update(dt) {
          started = true;
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
              const r = rowRect(k);
              if (slots[k]) continue;
              if (i.down && e.inside(i.x, i.y, r.x, r.y, r.w, r.h)) hover = k;
              if (i.tap && e.inside(i.x, i.y, r.x, r.y, r.w, r.h)) { place(k); return; }
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
          g.fillStyle = "rgba(0,0,0,0.38)";
          rr(g, 8, 62, W - 16, 590, 28); g.fill();
          e.text(`Meine Top ${size}: ${cat.short}`, W / 2, 80, { size: 20 });
          if (!started) {                                                   // the two switches (only before the game starts)
            for (const tg of TOGGLES) {
              const on = size === tg.n;
              g.fillStyle = on ? "#fff" : "rgba(255,255,255,0.18)"; rr(g, tg.x, tg.y, tg.w, tg.h, 14); g.fill();
              e.text(`Top ${tg.n}`, tg.x + tg.w / 2, tg.y + tg.h / 2 + 1, { size: 15, color: on ? "#111" : "#fff", stroke: false });
            }
          }
          // ---- the machine
          g.fillStyle = "rgba(255,255,255,0.12)"; rr(g, WIN.x - 12, WIN.y - 12, WIN.w + 24, WIN.h + 24, 30); g.fill();
          g.fillStyle = cat.color; rr(g, WIN.x - 6, WIN.y - 6, WIN.w + 12, WIN.h + 12, 26); g.fill();
          g.save();
          rr(g, WIN.x, WIN.y, WIN.w, WIN.h, 22); g.clip();
          g.fillStyle = "#14161c"; g.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
          if (phase === "spin" && strip.length) {
            const eased = 1 - Math.pow(1 - shown, 3);
            const pos = eased * (strip.length - 1) * WIN.h;
            for (let k = Math.max(0, Math.floor(pos / WIN.h) - 1); k <= Math.min(strip.length - 1, Math.floor(pos / WIN.h) + 1); k++) {
              drawPicture(g, strip[k], WIN.x, WIN.y + k * WIN.h - pos, WIN.w, WIN.h, 0, cat.fit);
            }
            const speed = 1 - shown;
            g.fillStyle = `rgba(0,0,0,${0.35 * speed})`; g.fillRect(WIN.x, WIN.y, WIN.w, WIN.h);
          } else if (current && (phase === "pick" || phase === "fly")) {
            if (phase === "pick") drawPicture(g, current, WIN.x, WIN.y, WIN.w, WIN.h, 0, cat.fit);
          } else if (phase === "done") {
            e.text("Fertig!", WIN.x + WIN.w / 2, WIN.y + WIN.h / 2, { size: 34 });
          } else {
            e.text("?", WIN.x + WIN.w / 2, WIN.y + WIN.h / 2, { size: 80, color: "rgba(255,255,255,0.7)" });
          }
          g.restore();
          if (phase === "pick") { g.strokeStyle = `rgba(255,255,255,${0.55 + 0.4 * Math.sin(pulse * 8)})`; g.lineWidth = 4; rr(g, WIN.x - 3, WIN.y - 3, WIN.w + 6, WIN.h + 6, 25); g.stroke(); }
          // the name under the machine
          const label = current && (phase === "pick" || phase === "fly") ? current.name : phase === "spin" ? "…" : phase === "done" ? `Deine Top ${size}!` : ready ? `Tippe, um zu starten` : "Bilder werden geladen …";
          e.text(label, W / 2, 312, { size: current && phase === "pick" ? 22 : 18 });
          // ---- the places
          for (let k = 0; k < size; k++) {
            const r = rowRect(k);
            const item = slots[k];
            const free = !item;
            const open = phase === "pick" && free;
            const hot = hover === k;
            g.fillStyle = item ? "rgba(255,255,255,0.92)" : hot ? "rgba(255,255,255,0.4)" : open ? `rgba(255,255,255,${0.16 + 0.07 * Math.sin(pulse * 6 + k)})` : "rgba(255,255,255,0.1)";
            rr(g, r.x, r.y, r.w, r.h, Math.min(16, r.h / 2)); g.fill();
            if (!item) { g.setLineDash?.([5, 5]); g.strokeStyle = "rgba(255,255,255,0.45)"; g.lineWidth = 2; rr(g, r.x + 1, r.y + 1, r.w - 2, r.h - 2, Math.min(15, r.h / 2)); g.stroke(); g.setLineDash?.([]); }
            const b = Math.min(26, r.h - 6);
            g.fillStyle = item ? cat.color : "rgba(255,255,255,0.88)"; g.beginPath(); g.arc(r.x + 8 + b / 2, r.y + r.h / 2, b / 2, 0, TAU); g.fill();
            e.text(String(k + 1), r.x + 8 + b / 2, r.y + r.h / 2 + 1, { size: Math.round(b * 0.62), color: item ? "#fff" : "#111", stroke: false });
            if (item && !(phase === "fly" && flyTo === k && flyT < FLY)) {
              const ph = r.h - 8;
              drawPicture(g, item, r.x + 18 + b, r.y + 4, ph * (cat.fit === "contain" ? 1.35 : 1), ph, 8, cat.fit);
              e.text(item.name, r.x + 28 + b + ph * (cat.fit === "contain" ? 1.35 : 1), r.y + r.h / 2 + 1, { size: size === 5 ? 20 : 15, color: "#111", align: "left", stroke: false });
            }
          }
          // ---- the card that flies to its place
          if (phase === "fly" && current) {
            const r = rowRect(flyTo);
            const u = Math.min(1, flyT / FLY);
            const k = u * u * (3 - 2 * u);
            const fx = WIN.x + (r.x + 18 + 26 - WIN.x) * k, fy = WIN.y + (r.y + 4 - WIN.y) * k - Math.sin(u * Math.PI) * 26;
            const w = WIN.w + ((r.h - 8) - WIN.w) * k;
            drawPicture(g, current, fx, fy, w, w, 12 * (1 - k) + 8 * k, cat.fit);
          }
        },
      };
    } });
  }
})();
