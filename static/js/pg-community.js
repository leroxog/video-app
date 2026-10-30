/* Nex games of the community (pg-community.js): the bridge to the sealed worker in which a game written as code runs (the code of a person never runs on the page of Nex). Code games:
   see codeDef() -- the code runs in a worker (static script with header "default-src 'none'", served by the server) that gets the finger and gives back pictures, points and "over". */
(function () {
  "use strict";

  const PG = window.PulseGames;
  const W = 360;
  const H = 640;

  // ------------------------------------------------------------------------------------------------------------------ a game that is code (in a sealed worker)
  function codeDef(meta) {
    return { id: meta.id, name: meta.title, emoji: meta.emoji, cat: "Community", hint: meta.hint || `Spiel von @${meta.user ? meta.user.handle : "?"}`, color: meta.color, bubble: true, community: true,
      create(env) {
        let worker = null;
        let frame = null;
        let ready = false;
        let waiting = false;
        let sentAt = 0;
        let problem = "";
        try { worker = new Worker(`/api/yipi/game-worker/${meta.id}`); } catch (error) { problem = "Dieses Spiel kann nicht starten."; }
        if (worker) {
          worker.onmessage = (event) => {
            const m = event.data || {};
            if (m.t === "ready") ready = true;
            else if (m.t === "frame" && m.bitmap && m.bitmap.width === W && m.bitmap.height === H) { if (frame && frame.close) frame.close(); frame = m.bitmap; waiting = false; }
            else if (m.t === "score" && Number.isFinite(m.n)) env.score(m.n);
            else if (m.t === "over") env.over();
            else if (m.t === "error") { problem = `Fehler im Spiel: ${String(m.message || "").slice(0, 80)}`; waiting = false; }
          };
          worker.onerror = (event) => { problem = `Fehler im Code: ${String(event.message || "").slice(0, 80)}`; if (event.preventDefault) event.preventDefault(); };
        }
        return {
          update(dt) {
            if (!worker || problem) return;
            const now = performance.now();
            if (ready && !waiting) {
              const i = env.input;
              worker.postMessage({ t: "input", input: { x: i.x, y: i.y, down: i.down, pressed: i.pressed, tap: i.tap, released: i.released, swipe: i.swipe } });
              worker.postMessage({ t: "step", dt });
              waiting = true;
              sentAt = now;
            } else if (waiting && now - sentAt > 2500) { problem = "Das Spiel hängt: es wurde angehalten."; worker.terminate(); }
          },
          draw() {
            if (frame) env.g.drawImage(frame, 0, 0, W, H);
            if (problem) { env.panel(24, 250, 312, 110, 22, 0.75); env.text(problem, W / 2, 305, { size: 16, weight: 700, stroke: false }); }
          },
          destroy() { if (worker) worker.terminate(); if (frame && frame.close) frame.close(); frame = null; },
        };
      } };
  }

  /* Used by the camera tab for a game of the community: the definition of the game made from what the server sent. */
  function communityDef(row) {
    return codeDef(row);
  }

  PG.community = { communityDef, codeDef };
})();
