/* Pulse games: board and card games against the computer (pg-board.js): Tic-Tac-Toe, Connect Four, Reversi, Nim, Rock Paper Scissors, Pig, Blackjack,
   Higher or Lower, Mastermind, Gomoku and Battleship. The opponents think a few moves ahead (and get better with every round you win). */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;

  /* ------------------------------------------------------------------------------------------------ Tic-Tac-Toe */
  const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
  const winner3 = (b) => { for (const [x, y, z] of LINES3) if (b[x] && b[x] === b[y] && b[y] === b[z]) return b[x]; return b.every(Boolean) ? "draw" : null; };
  function minimax3(b, turn, me) {
    const w = winner3(b);
    if (w === me) return 1; if (w === "draw") return 0; if (w) return -1;
    let best = turn === me ? -2 : 2;
    for (let k = 0; k < 9; k++) if (!b[k]) { b[k] = turn; const v = minimax3(b, turn === "X" ? "O" : "X", me); b[k] = 0; best = turn === me ? Math.max(best, v) : Math.min(best, v); }
    return best;
  }
  R({ id: "tictactoe", name: "Drei gewinnt", emoji: "❎", cat: "Brett", color: "#4cc9ff", hint: "Du bist X. Drei in einer Reihe gewinnen. Der Computer wird mit jeder Runde besser", create(e) {
    let b, turn, round = 0, msg = "", wait = 0, over = false;
    function fresh() { b = Array(9).fill(0); turn = round % 2 === 0 ? "X" : "O"; msg = ""; if (turn === "O") wait = 0.5; }
    fresh();
    function ai() {
      const free = b.map((v, k) => (v ? -1 : k)).filter((k) => k >= 0);
      if (e.rand() < Math.max(0, 0.5 - round * 0.12)) return e.pick(free);
      let best = -3, picks = [];
      for (const k of free) { b[k] = "O"; const v = minimax3(b, "X", "O"); b[k] = 0; if (v > best) { best = v; picks = [k]; } else if (v === best) picks.push(k); }
      return e.pick(picks);
    }
    function after() {
      const w = winner3(b);
      if (!w) { turn = turn === "X" ? "O" : "X"; if (turn === "O") wait = 0.45; return; }
      if (w === "X") { e.addScore(10 + round); msg = "Gewonnen!"; } else if (w === "draw") { e.addScore(3); msg = "Unentschieden"; } else { msg = "Verloren"; over = true; }
      wait = 1.1; turn = "";
    }
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (over) { e.over(); return; } if (turn === "O") { b[ai()] = "O"; after(); } else { round += 1; fresh(); } } return; }
        if (turn === "X" && i.pressed) { const cx = Math.floor((i.x - 30) / 100), cy = Math.floor((i.y - 190) / 100); if (cx >= 0 && cy >= 0 && cx < 3 && cy < 3 && !b[cy * 3 + cx]) { b[cy * 3 + cx] = "X"; after(); } }
        for (let k = 1; k <= 9; k++) if (turn === "X" && i.keyPressed(String(k)) && !b[k - 1]) { b[k - 1] = "X"; after(); break; }
      },
      draw() {
        e.text(msg || (turn === "X" ? "Du bist dran" : "Computer denkt …"), W / 2, 120, { size: 28 });
        e.panel(24, 184, 312, 312, 20, 0.45);
        for (let k = 1; k < 3; k++) { e.line(30 + k * 100, 196, 30 + k * 100, 484, "#fff", 4); e.line(36, 190 + k * 100, 324, 190 + k * 100, "#fff", 4); }
        b.forEach((v, k) => { if (v) e.text(v === "X" ? "✕" : "◯", 80 + (k % 3) * 100, 240 + Math.floor(k / 3) * 100, { size: 64, color: v === "X" ? "#4cc9ff" : "#ff7a9c" }); });
        e.text(`Runde ${round + 1}`, W / 2, 540, { size: 20 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Connect Four */
  R({ id: "connect-four", name: "Vier gewinnt", emoji: "🔴", cat: "Brett", color: "#ff5d73", hint: "Tippe eine Spalte: vier in einer Reihe gewinnen. Der Computer denkt mit", create(e) {
    const COLS = 7, ROWS = 6, S = 46, OX = 19, OY = 190;
    let b, turn = 1, round = 0, msg = "", wait = 0, over = false, hover = 3, falling = null;
    const fresh = () => { b = Array.from({ length: COLS }, () => []); turn = round % 2 === 0 ? 1 : 2; msg = ""; falling = null; if (turn === 2) wait = 0.5; };
    fresh();
    const at = (c, r) => (b[c][r] || 0);
    function four(c, r, p) { for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) { let n = 1; for (const s of [1, -1]) { let x = c + dx * s, y = r + dy * s; while (x >= 0 && x < COLS && y >= 0 && y < ROWS && at(x, y) === p) { n += 1; x += dx * s; y += dy * s; } } if (n >= 4) return true; } return false; }
    function score(p) {
      let total = 0;
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const cells = []; for (let k = 0; k < 4; k++) { const x = c + dx * k, y = r + dy * k; if (x < 0 || x >= COLS || y < 0 || y >= ROWS) break; cells.push(at(x, y)); }
        if (cells.length < 4) continue; const mine = cells.filter((v) => v === p).length, theirs = cells.filter((v) => v && v !== p).length;
        if (mine && theirs) continue; if (mine === 3) total += 50; else if (mine === 2) total += 6; else if (theirs === 3) total -= 60; else if (theirs === 2) total -= 5;
      }
      for (let r = 0; r < ROWS; r++) if (at(3, r) === p) total += 4;
      return total;
    }
    function search(depth, alpha, beta, turnP, me) {
      const moves = [3, 2, 4, 1, 5, 0, 6].filter((c) => b[c].length < ROWS);
      if (!moves.length) return [0, -1];
      if (depth === 0) return [score(me), -1];
      let best = turnP === me ? -1e9 : 1e9, bestMove = moves[0];
      for (const c of moves) {
        b[c].push(turnP); const r = b[c].length - 1;
        const value = four(c, r, turnP) ? (turnP === me ? 1e6 + depth : -1e6 - depth) : search(depth - 1, alpha, beta, turnP === 1 ? 2 : 1, me)[0];
        b[c].pop();
        if (turnP === me ? value > best : value < best) { best = value; bestMove = c; }
        if (turnP === me) alpha = Math.max(alpha, best); else beta = Math.min(beta, best);
        if (alpha >= beta) break;
      }
      return [best, bestMove];
    }
    function drop(c, p) { b[c].push(p); const r = b[c].length - 1; falling = { c, r, t: 0 }; if (four(c, r, p)) { finish(p); } else if (b.every((col) => col.length === ROWS)) finish(0); else { turn = p === 1 ? 2 : 1; if (turn === 2) wait = 0.55; } }
    function finish(p) { if (p === 1) { e.addScore(20 + round * 3); msg = "Gewonnen!"; } else if (p === 0) { e.addScore(5); msg = "Unentschieden"; } else { msg = "Verloren"; over = true; } wait = 1.3; turn = 0; }
    return {
      update(dt) {
        const i = e.input;
        if (falling) { falling.t += dt; if (falling.t > 0.25) falling = null; }
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (over) { e.over(); return; } if (turn === 2) { const depth = Math.min(6, 2 + round); let c; if (e.rand() < Math.max(0, 0.3 - round * 0.1)) { const open = [0, 1, 2, 3, 4, 5, 6].filter((k) => b[k].length < ROWS); c = e.pick(open); } else c = search(depth, -1e9, 1e9, 2, 2)[1]; drop(c, 2); } else { round += 1; fresh(); } } return; }
        if (turn === 1) {
          if (i.down || i.pressed || i.released) hover = e.clamp(Math.floor((i.x - OX) / S), 0, COLS - 1);
          if (i.released || i.pressed && !i.down) { /* a tap drops */ }
          if (i.tap || (i.released && !i.swipe)) { const c = e.clamp(Math.floor((i.x - OX) / S), 0, COLS - 1); if (i.y > 150 && b[c].length < ROWS) drop(c, 1); }
          if (i.keyPressed("ArrowLeft")) hover = Math.max(0, hover - 1); if (i.keyPressed("ArrowRight")) hover = Math.min(COLS - 1, hover + 1);
          if ((i.keyPressed(" ") || i.keyPressed("Enter") || i.keyPressed("ArrowDown")) && b[hover].length < ROWS) drop(hover, 1);
        }
      },
      draw() {
        e.text(msg || (turn === 1 ? "Du bist dran (rot)" : "Computer denkt …"), W / 2, 120, { size: 26 });
        if (turn === 1) e.circle(OX + hover * S + S / 2, OY - 24, 17, "#ff5d73", "#fff", 3);
        e.panel(OX - 6, OY - 6, COLS * S + 12, ROWS * S + 12, 18, 0.55, "20,50,150");
        for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const p = at(c, r); e.circle(OX + c * S + S / 2, OY + (ROWS - 1 - r) * S + S / 2, 18, p === 1 ? "#ff5d73" : p === 2 ? "#ffe66d" : "rgba(0,0,0,0.5)", p ? "#fff" : null, 2); }
        e.text(`Runde ${round + 1}`, W / 2, 520, { size: 20 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Reversi */
  R({ id: "reversi", name: "Reversi", emoji: "⚫", cat: "Brett", color: "#2e8b57", hint: "Schließe Steine des Gegners zwischen deinen ein. Wer am Ende mehr hat, gewinnt", create(e) {
    const N = 8, S = 40, OX = 20, OY = 150;
    const WEIGHT = [[100, -20, 10, 5, 5, 10, -20, 100], [-20, -50, -2, -2, -2, -2, -50, -20], [10, -2, -1, -1, -1, -1, -2, 10], [5, -2, -1, -1, -1, -1, -2, 5], [5, -2, -1, -1, -1, -1, -2, 5], [10, -2, -1, -1, -1, -1, -2, 10], [-20, -50, -2, -2, -2, -2, -50, -20], [100, -20, 10, 5, 5, 10, -20, 100]];
    let b, turn = 1, round = 0, msg = "", wait = 0, done = false, passMsg = "";
    function fresh() { b = Array.from({ length: N }, () => Array(N).fill(0)); b[3][3] = 2; b[4][4] = 2; b[3][4] = 1; b[4][3] = 1; turn = 1; done = false; msg = ""; }
    fresh();
    function flips(board, x, y, p) { if (board[y][x]) return []; const out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const line = []; let cx = x + dx, cy = y + dy; while (cx >= 0 && cy >= 0 && cx < N && cy < N && board[cy][cx] === 3 - p) { line.push([cx, cy]); cx += dx; cy += dy; } if (line.length && cx >= 0 && cy >= 0 && cx < N && cy < N && board[cy][cx] === p) out.push(...line); } return out; }
    const moves = (board, p) => { const list = []; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const f = flips(board, x, y, p); if (f.length) list.push([x, y, f]); } return list; };
    function play(board, x, y, p, f) { board[y][x] = p; for (const [fx, fy] of f) board[fy][fx] = p; }
    const evalBoard = (board) => { let s = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { if (board[y][x] === 2) s += WEIGHT[y][x]; else if (board[y][x] === 1) s -= WEIGHT[y][x]; } return s + (moves(board, 2).length - moves(board, 1).length) * 4; };
    function think() {
      const list = moves(b, 2); if (!list.length) return null;
      if (e.rand() < Math.max(0, 0.35 - round * 0.1)) return e.pick(list);
      let best = null, bestV = -1e9;
      for (const [x, y, f] of list) { const copy = b.map((r) => r.slice()); play(copy, x, y, 2, f); const replies = moves(copy, 1); let v; if (!replies.length) v = evalBoard(copy) + 30; else { v = 1e9; for (const [rx, ry, rf] of replies) { const c2 = copy.map((r) => r.slice()); play(c2, rx, ry, 1, rf); v = Math.min(v, evalBoard(c2)); } } if (v > bestV) { bestV = v; best = [x, y, f]; } }
      return best;
    }
    function check() {
      const mine = moves(b, 1).length, theirs = moves(b, 2).length;
      if (!mine && !theirs) { const a = b.flat().filter((v) => v === 1).length, c = b.flat().filter((v) => v === 2).length; done = true; wait = 1.3; if (a > c) { e.addScore(a + 10); msg = `Gewonnen ${a}:${c}`; } else if (a === c) { e.addScore(a); msg = "Unentschieden"; } else { msg = `Verloren ${a}:${c}`; } e.score(Math.max(e.points, 0)); return; }
      if (turn === 1 && !mine) { turn = 2; passMsg = "Du musst passen"; wait = 0.8; return; }
      if (turn === 2 && !theirs) { turn = 1; passMsg = "Computer passt"; return; }
      if (turn === 2) wait = 0.5;
    }
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) {
          if (done) { if (msg.startsWith("Verloren")) e.over(); else { round += 1; fresh(); } return; }
          if (turn === 2) { const m = think(); if (m) play(b, m[0], m[1], 2, m[2]); turn = 1; check(); }
        } return; }
        if (turn === 1 && i.pressed) {
          const cx = Math.floor((i.x - OX) / S), cy = Math.floor((i.y - OY) / S);
          if (cx >= 0 && cy >= 0 && cx < N && cy < N) { const f = flips(b, cx, cy, 1); if (f.length) { play(b, cx, cy, 1, f); passMsg = ""; turn = 2; check(); } }
        }
      },
      draw() {
        const a = b.flat().filter((v) => v === 1).length, c = b.flat().filter((v) => v === 2).length;
        e.text(msg || passMsg || (turn === 1 ? "Du bist dran (schwarz)" : "Computer denkt …"), W / 2, 100, { size: 24 });
        e.panel(OX - 4, OY - 4, N * S + 8, N * S + 8, 12, 0.7, "20,90,50");
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          e.rect(OX + x * S + 1, OY + y * S + 1, S - 2, S - 2, "rgba(30,130,70,0.75)", 4);
          if (b[y][x]) e.circle(OX + x * S + S / 2, OY + y * S + S / 2, 16, b[y][x] === 1 ? "#161616" : "#f5f5f5", "#fff", 2);
          else if (turn === 1 && !done && flips(b, x, y, 1).length) e.circle(OX + x * S + S / 2, OY + y * S + S / 2, 4, "rgba(255,255,255,0.7)");
        }
        e.text(`⚫ ${a}    ⚪ ${c}`, W / 2, 520, { size: 26 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Nim */
  R({ id: "nim", name: "Nim", emoji: "🥢", cat: "Brett", color: "#c49a6c", hint: "Nimm abwechselnd Hölzer von einem Haufen. Wer das letzte nimmt, gewinnt", create(e) {
    let piles, taking = -1, count = 0, turn = 1, round = 0, msg = "", wait = 0, over = false;
    function fresh() { const n = Math.min(5, 3 + Math.floor(round / 2)); piles = Array.from({ length: n }, (_, k) => e.randInt(2, 5 + k)); taking = -1; count = 0; turn = round % 2 === 0 ? 1 : 2; msg = ""; if (turn === 2) wait = 0.7; }
    fresh();
    function aiMove() {
      const x = piles.reduce((a, b) => a ^ b, 0);
      if (x === 0 || e.rand() < Math.max(0, 0.3 - round * 0.1)) { const open = piles.map((p, k) => (p ? k : -1)).filter((k) => k >= 0); const k = e.pick(open); return [k, e.randInt(1, piles[k])]; }
      for (let k = 0; k < piles.length; k++) { const target = piles[k] ^ x; if (target < piles[k]) return [k, piles[k] - target]; }
      return [0, 1];
    }
    function end(winnerIsMe) { if (winnerIsMe) { e.addScore(10 + round * 2); msg = "Gewonnen!"; } else { msg = "Verloren"; over = true; } wait = 1.2; turn = 0; }
    function take(k, n) { piles[k] -= n; taking = -1; count = 0; if (piles.every((p) => !p)) { end(turn === 1); return; } turn = turn === 1 ? 2 : 1; if (turn === 2) wait = 0.8; }
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (over) { e.over(); return; } if (turn === 2) { const [k, n] = aiMove(); take(k, n); } else { round += 1; fresh(); } } return; }
        if (turn !== 1) return;
        if (i.pressed) {
          piles.forEach((p, k) => { for (let s = 0; s < p; s++) { const x = 40 + k * 60, y = 480 - s * 34; if (e.inside(i.x, i.y, x - 18, y - 16, 36, 32)) { if (taking !== k) { taking = k; count = 0; } count = p - s; } } });
          if (e.inside(i.x, i.y, 110, 560, 140, 46) && taking >= 0 && count > 0) take(taking, count);
        }
      },
      draw() {
        e.text(msg || (turn === 1 ? "Du bist dran" : "Computer denkt …"), W / 2, 110, { size: 26 });
        piles.forEach((p, k) => { for (let s = 0; s < p; s++) { const x = 40 + k * 60, y = 480 - s * 34; const picked = taking === k && s >= p - count; e.rect(x - 7, y - 15, 14, 30, picked ? "#ff7a7a" : "#e8c07a", 6); } e.text(String(p), 40 + k * 60, 520, { size: 18 }); });
        e.button(count ? `Nimm ${count}` : "Wähle Hölzer", 110, 560, 140, 46, { size: 18 });
        e.text("Tippe auf ein Holz: alle darüber werden mitgenommen", W / 2, 150, { size: 14, weight: 600 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Rock Paper Scissors */
  R({ id: "rps", name: "Schere Stein Papier", emoji: "✌️", cat: "Brett", color: "#ffb347", hint: "Schlag die Wahl des Computers. Drei verlorene Runden und es ist vorbei", create(e) {
    const FACE = ["✊", "✋", "✌️"], NAME = ["Stein", "Papier", "Schere"];
    let lives = 3, wins = 0, mine = -1, theirs = -1, show = 0, history = [0, 0, 0], text = "Wähle!";
    const beats = (a, b) => (a - b + 3) % 3 === 1;                 // 0 stone, 1 paper, 2 scissors: paper beats stone, scissors beat paper, stone beats scissors
    function play(choice) {
      const total = history.reduce((a, b) => a + b, 0) || 1;
      let guess = e.rand() < 0.45 ? history.indexOf(Math.max(...history)) : e.randInt(0, 2);            // sometimes the computer expects your favourite
      theirs = (guess + 1) % 3; mine = choice; history[choice] += 1;
      if (mine === theirs) text = "Unentschieden"; else if (beats(mine, theirs)) { wins += 1; e.score(wins); text = "Gewonnen!"; } else { lives -= 1; text = "Verloren"; if (lives <= 0) { show = 1.2; return; } }
      show = 1.0;
    }
    return {
      update(dt) {
        const i = e.input;
        if (show > 0) { show -= dt; if (show <= 0) { mine = theirs = -1; text = "Wähle!"; if (lives <= 0) e.over(); } return; }
        if (i.pressed) FACE.forEach((_, k) => { if (e.inside(i.x, i.y, 30 + k * 105, 470, 95, 110)) play(k); });
        ["1", "2", "3"].forEach((key, k) => { if (i.keyPressed(key)) play(k); });
      },
      draw() {
        e.text(text, W / 2, 130, { size: 32 });
        e.text(theirs >= 0 ? FACE[theirs] : "❔", 270, 290, { size: 90 }); e.text(mine >= 0 ? FACE[mine] : "", 90, 290, { size: 90 });
        e.text("Du", 90, 210, { size: 20 }); e.text("Computer", 270, 210, { size: 20 });
        FACE.forEach((f, k) => { e.rect(30 + k * 105, 470, 95, 110, "rgba(255,255,255,0.88)", 22); e.text(f, 77 + k * 105, 510, { size: 46, stroke: false }); e.text(NAME[k], 77 + k * 105, 560, { size: 14, color: "#111", stroke: false }); });
        e.text("♥".repeat(Math.max(0, lives)), 20, 60, { size: 22, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Pig */
  R({ id: "pig", name: "Schweinchen", emoji: "🎲", cat: "Brett", color: "#ff9fb5", hint: "Würfle so oft du willst, aber bei einer 1 ist alles weg. „Halten“ rettet die Punkte. 50 gewinnen", create(e) {
    let me = 0, cpu = 0, turnPts = 0, turn = 1, die = 1, rolling = 0, msg = "", wait = 0, round = 0, over = false;
    const TARGET = 50;
    const roll = () => { die = e.randInt(1, 6); rolling = 0.3; };
    function resolve() {
      if (die === 1) { turnPts = 0; msg = turn === 1 ? "Eine 1! Alles weg." : "Computer würfelt eine 1."; turn = turn === 1 ? 2 : 1; wait = 0.9; }
      else turnPts += die;
    }
    function bank() {
      if (turn === 1) me += turnPts; else cpu += turnPts; turnPts = 0;
      if (me >= TARGET) { e.addScore(25 + round * 5); msg = "Gewonnen!"; wait = 1.4; turn = 0; return; }
      if (cpu >= TARGET) { msg = "Verloren"; over = true; wait = 1.4; turn = 0; return; }
      turn = turn === 1 ? 2 : 1; wait = 0.6;
    }
    return {
      update(dt) {
        const i = e.input;
        if (rolling > 0) { rolling -= dt; if (rolling <= 0) { resolve(); if (turn === 2 && die !== 1) wait = 0.5; } return; }
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (over) { e.over(); return; } if (turn === 0) { me = cpu = 0; round += 1; turn = 1; msg = ""; } else if (turn === 2) { const stop = turnPts >= 14 + round * 2 || cpu + turnPts >= TARGET; if (stop && turnPts > 0) bank(); else roll(); } else msg = ""; } return; }
        if (turn === 1) {
          if (i.pressed && e.inside(i.x, i.y, 30, 540, 140, 56)) roll();
          if (i.pressed && e.inside(i.x, i.y, 190, 540, 140, 56) && turnPts > 0) bank();
          if (i.keyPressed(" ")) roll(); if (i.keyPressed("Enter") && turnPts > 0) bank();
        }
      },
      draw() {
        e.text(`Du ${me}`, 90, 120, { size: 28 }); e.text(`Computer ${cpu}`, 270, 120, { size: 28 }); e.text(`Ziel: ${TARGET}`, W / 2, 80, { size: 18 });
        e.rect(130, 230, 100, 100, "#fff", 20);
        const dots = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
        for (const [dx, dy] of dots[rolling > 0 ? e.randInt(1, 6) : die]) e.circle(180 + dx * 28, 280 + dy * 28, 9, "#111");
        e.text(`Runde: ${turnPts}`, W / 2, 390, { size: 26, color: "#ffe66d" });
        e.text(msg || (turn === 1 ? "Du bist dran" : turn === 2 ? "Computer ist dran" : ""), W / 2, 450, { size: 22 });
        e.button("Würfeln", 30, 540, 140, 56, { size: 22 }); e.button("Halten", 190, 540, 140, 56, { size: 22, fill: turnPts > 0 ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.35)" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Blackjack */
  R({ id: "blackjack", name: "Blackjack", emoji: "🃏", cat: "Brett", color: "#2e8b57", hint: "Komm näher an 21 als die Bank, ohne drüber zu gehen. 100 Chips zum Start, die Punkte sind dein Höchststand", create(e) {
    const SUITS = ["♠", "♥", "♦", "♣"], BET = 10;
    let deck = [], mine = [], bank = [], chips = 100, peak = 100, phase = "play", msg = "", wait = 0, hands = 0;
    const draw = () => { if (deck.length < 12) { deck = []; for (const s of SUITS) for (let r = 1; r <= 13; r++) deck.push({ r, s }); deck = e.shuffle(deck); } return deck.pop(); };
    const value = (hand) => { let total = 0, aces = 0; for (const c of hand) { if (c.r === 1) { aces += 1; total += 11; } else total += Math.min(10, c.r); } while (total > 21 && aces) { total -= 10; aces -= 1; } return total; };
    function deal() { mine = [draw(), draw()]; bank = [draw(), draw()]; phase = "play"; msg = ""; hands += 1; if (value(mine) === 21) settle(); }
    function settle() {
      phase = "done"; const m = value(mine);
      while (value(bank) < 17 && m <= 21) bank.push(draw());
      const b = value(bank);
      if (m > 21) { chips -= BET; msg = "Drüber! Verloren"; } else if (m === 21 && mine.length === 2 && !(b === 21 && bank.length === 2)) { chips += Math.round(BET * 1.5); msg = "Blackjack!"; }
      else if (b > 21 || m > b) { chips += BET; msg = "Gewonnen!"; } else if (m === b) msg = "Unentschieden"; else { chips -= BET; msg = "Bank gewinnt"; }
      peak = Math.max(peak, chips); e.score(peak); wait = 1.1;
    }
    deal();
    return {
      update(dt) {
        const i = e.input;
        if (phase === "done") { wait -= dt; if (wait <= 0) { if (chips <= 0) e.over(); else deal(); } return; }
        if (i.pressed && e.inside(i.x, i.y, 30, 560, 140, 56) || i.keyPressed(" ")) { mine.push(draw()); if (value(mine) >= 21) settle(); }
        else if (i.pressed && e.inside(i.x, i.y, 190, 560, 140, 56) || i.keyPressed("Enter")) settle();
      },
      draw() {
        const showBank = phase === "done";
        e.text(`Chips: ${chips}`, W / 2, 100, { size: 28 });
        e.text(showBank ? `Bank: ${value(bank)}` : "Bank", W / 2, 160, { size: 20 });
        bank.forEach((c, k) => card(c, 60 + k * 50, 190, !showBank && k === 1));
        e.text(`Du: ${value(mine)}`, W / 2, 360, { size: 20 });
        mine.forEach((c, k) => card(c, 60 + k * 50, 390, false));
        e.text(msg, W / 2, 530, { size: 26, color: "#ffe66d" });
        e.button("Karte", 30, 560, 140, 56, { size: 22 }); e.button("Halten", 190, 560, 140, 56, { size: 22 });
      },
    };
    function card(c, x, y, hidden) {
      e.rect(x, y, 56, 80, hidden ? "#3a6ea5" : "#fff", 10);
      if (hidden) return;
      const label = { 1: "A", 11: "B", 12: "D", 13: "K" }[c.r] || String(c.r);
      e.text(label, x + 28, y + 28, { size: 24, color: c.s === "♥" || c.s === "♦" ? "#d62839" : "#111", stroke: false }); e.text(c.s, x + 28, y + 56, { size: 24, color: c.s === "♥" || c.s === "♦" ? "#d62839" : "#111", stroke: false });
    }
  } });

  /* ------------------------------------------------------------------------------------------------ Higher or Lower */
  R({ id: "higher-lower", name: "Höher oder Tiefer", emoji: "🎴", cat: "Brett", color: "#b46bff", hint: "Ist die nächste Karte höher oder tiefer? Jede richtige Antwort zählt", create(e) {
    let cur = e.randInt(2, 12), next = 0, shown = false, streak = 0, wait = 0, msg = "", bad = false;
    const label = (r) => ({ 1: "A", 11: "B", 12: "D", 13: "K" }[r] || String(r));
    function answer(higher) {
      next = e.randInt(1, 13); shown = true;
      if (next === cur) { msg = "Gleich: weiter!"; wait = 0.9; return; }
      if ((next > cur) === higher) { streak += 1; e.score(streak); msg = "Richtig!"; } else { msg = "Falsch!"; bad = true; }
      wait = 0.9;
    }
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (bad) { e.over(); return; } cur = next; shown = false; msg = ""; } return; }
        if (i.pressed && e.inside(i.x, i.y, 30, 520, 140, 70)) answer(true);
        else if (i.pressed && e.inside(i.x, i.y, 190, 520, 140, 70)) answer(false);
        if (i.keyPressed("ArrowUp")) answer(true); if (i.keyPressed("ArrowDown")) answer(false);
      },
      draw() {
        e.text(`Serie: ${streak}`, W / 2, 100, { size: 28 });
        e.rect(40, 170, 120, 170, "#fff", 18); e.text(label(cur), 100, 255, { size: 64, color: "#111", stroke: false });
        e.rect(200, 170, 120, 170, shown ? "#fff" : "#3a6ea5", 18); e.text(shown ? label(next) : "?", 260, 255, { size: 64, color: shown ? "#111" : "#fff", stroke: shown ? false : true });
        e.text(msg, W / 2, 410, { size: 30, color: bad ? "#ff7a7a" : "#9dff7a" });
        e.button("▲ Höher", 30, 520, 140, 70, { size: 22 }); e.button("▼ Tiefer", 190, 520, 140, 70, { size: 22 });
        e.text("Ass = 1, Bube 11, Dame 12, König 13", W / 2, 620, { size: 13, weight: 600 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Mastermind */
  R({ id: "mastermind", name: "Mastermind", emoji: "🎯", cat: "Brett", color: "#ff6bb5", hint: "Errate die geheime Farbfolge: schwarz = richtig und am richtigen Platz, weiß = nur die Farbe", create(e) {
    const COLORS = ["#ff5d73", "#ffb347", "#ffe66d", "#6bd45f", "#4cc9ff", "#b46bff"];
    let code, guesses = [], cur = [], level = 0, msg = "", wait = 0, lost = false;
    const fresh = () => { code = Array.from({ length: 4 }, () => e.randInt(0, 5)); guesses = []; cur = []; msg = ""; };
    fresh();
    function rate(g) { let black = 0; const a = [], b = []; g.forEach((c, k) => { if (c === code[k]) black += 1; else { a.push(c); b.push(code[k]); } }); let white = 0; for (const c of a) { const k = b.indexOf(c); if (k >= 0) { white += 1; b.splice(k, 1); } } return [black, white]; }
    function submit() {
      const [black, white] = rate(cur); guesses.push({ g: cur.slice(), black, white }); cur = [];
      if (black === 4) { level += 1; e.addScore(10 + (8 - guesses.length) * 4); msg = "Geknackt!"; wait = 1.1; }
      else if (guesses.length >= 8) { msg = "Verloren"; lost = true; wait = 1.4; }
    }
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (lost) e.over(); else fresh(); } return; }
        if (i.pressed) {
          COLORS.forEach((c, k) => { if (e.dist(i.x, i.y, 40 + k * 56, 545) < 24 && cur.length < 4) cur.push(k); });
          if (e.inside(i.x, i.y, 20, 580, 150, 44) && cur.length) cur.pop();
          if (e.inside(i.x, i.y, 190, 580, 150, 44) && cur.length === 4) submit();
        }
        ["1", "2", "3", "4", "5", "6"].forEach((key, k) => { if (i.keyPressed(key) && cur.length < 4) cur.push(k); });
        if (i.keyPressed("Backspace") && cur.length) cur.pop(); if (i.keyPressed("Enter") && cur.length === 4) submit();
      },
      draw() {
        e.text(msg || `Versuch ${Math.min(8, guesses.length + 1)} von 8`, W / 2, 80, { size: 24 });
        e.panel(20, 105, 320, 370, 18, 0.45);
        for (let r = 0; r < 8; r++) {
          const y = 130 + r * 44, row = guesses[r], editing = r === guesses.length && !wait;
          for (let c = 0; c < 4; c++) e.circle(48 + c * 46, y, 16, row ? COLORS[row.g[c]] : editing && cur[c] !== undefined ? COLORS[cur[c]] : "rgba(255,255,255,0.14)", "rgba(255,255,255,0.5)", 2);
          if (row) { for (let p = 0; p < 4; p++) e.circle(260 + (p % 2) * 22, y - 8 + Math.floor(p / 2) * 18, 7, p < row.black ? "#111" : p < row.black + row.white ? "#fff" : "rgba(255,255,255,0.15)", "rgba(255,255,255,0.6)", 1.5); }
        }
        if (lost || (msg === "Geknackt!")) code.forEach((c, k) => e.circle(120 + k * 40, 500, 14, COLORS[c], "#fff", 2));
        COLORS.forEach((c, k) => e.circle(40 + k * 56, 545, 22, c, "#fff", 3));
        e.button("Zurück", 20, 580, 150, 44, { size: 18 }); e.button("Prüfen", 190, 580, 150, 44, { size: 18 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Gomoku */
  R({ id: "gomoku", name: "Fünf gewinnt", emoji: "⚪", cat: "Brett", color: "#d9b36c", hint: "Bring fünf Steine in eine Reihe: waagerecht, senkrecht oder schräg", create(e) {
    const N = 9, S = 36, OX = 18, OY = 150;
    let b, turn = 1, round = 0, msg = "", wait = 0, over = false, last = null;
    const fresh = () => { b = Array.from({ length: N }, () => Array(N).fill(0)); turn = 1; msg = ""; last = null; };
    fresh();
    const at = (x, y) => (x >= 0 && y >= 0 && x < N && y < N ? b[y][x] : -1);
    function five(x, y, p) { for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) { let n = 1; for (const s of [1, -1]) { let cx = x + dx * s, cy = y + dy * s; while (at(cx, cy) === p) { n += 1; cx += dx * s; cy += dy * s; } } if (n >= 5) return true; } return false; }
    function pattern(x, y, p) {
      let total = 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        let n = 1, open = 0;
        for (const s of [1, -1]) { let cx = x + dx * s, cy = y + dy * s; while (at(cx, cy) === p) { n += 1; cx += dx * s; cy += dy * s; } if (at(cx, cy) === 0) open += 1; }
        total += n >= 5 ? 1e6 : n === 4 ? (open === 2 ? 20000 : open === 1 ? 3000 : 0) : n === 3 ? (open === 2 ? 2500 : open === 1 ? 200 : 0) : n === 2 ? (open === 2 ? 120 : open === 1 ? 15 : 0) : 1;
      }
      return total;
    }
    function think() {
      let best = null, bestV = -1;
      const skill = Math.min(1, 0.55 + round * 0.15);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!b[y][x]) {
        let near = false; for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (at(x + dx, y + dy) > 0) { near = true; break; }
        if (!near && b.flat().some(Boolean)) continue;
        const v = pattern(x, y, 2) + pattern(x, y, 1) * (0.8 + 0.2 * skill) + e.rand(0, 6) + (4 - Math.abs(x - 4) - Math.abs(y - 4)) * 0.5;
        if (v > bestV) { bestV = v; best = [x, y]; }
      }
      return best || [4, 4];
    }
    function place(x, y, p) { b[y][x] = p; last = [x, y]; if (five(x, y, p)) { if (p === 1) { e.addScore(30 + round * 5); msg = "Gewonnen!"; } else { msg = "Verloren"; over = true; } wait = 1.3; turn = 0; } else if (b.every((r) => r.every(Boolean))) { e.addScore(5); msg = "Unentschieden"; wait = 1.2; turn = 0; } else { turn = p === 1 ? 2 : 1; if (turn === 2) wait = 0.5; } }
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (over) { e.over(); return; } if (turn === 2) { const [x, y] = think(); place(x, y, 2); } else { round += 1; fresh(); } } return; }
        if (turn === 1 && i.pressed) { const cx = Math.floor((i.x - OX) / S), cy = Math.floor((i.y - OY) / S); if (cx >= 0 && cy >= 0 && cx < N && cy < N && !b[cy][cx]) place(cx, cy, 1); }
      },
      draw() {
        e.text(msg || (turn === 1 ? "Du bist dran (schwarz)" : "Computer denkt …"), W / 2, 100, { size: 24 });
        e.panel(OX - 6, OY - 6, N * S + 12, N * S + 12, 14, 0.75, "170,125,60");
        for (let k = 0; k < N; k++) { e.line(OX + S / 2, OY + k * S + S / 2, OX + (N - 1) * S + S / 2, OY + k * S + S / 2, "rgba(0,0,0,0.6)", 1.5); e.line(OX + k * S + S / 2, OY + S / 2, OX + k * S + S / 2, OY + (N - 1) * S + S / 2, "rgba(0,0,0,0.6)", 1.5); }
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (b[y][x]) e.circle(OX + x * S + S / 2, OY + y * S + S / 2, 14, b[y][x] === 1 ? "#111" : "#f5f5f5", last && last[0] === x && last[1] === y ? "#ff5d73" : "rgba(0,0,0,0.5)", last && last[0] === x && last[1] === y ? 3 : 1.5);
        e.text(`Runde ${round + 1}`, W / 2, 520, { size: 20 });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Battleship (alone) */
  R({ id: "battleship", name: "Schiffe versenken", emoji: "🚢", cat: "Brett", color: "#4d8dff", hint: "Finde die versteckten Schiffe mit höchstens 22 Schüssen", create(e) {
    const N = 7, S = 44, OX = 26, OY = 150, SHIPS = [4, 3, 2];
    let ships, shots, left, level = 0, msg = "", wait = 0, over = false;
    function fresh() {
      ships = []; shots = Array.from({ length: N * N }, () => 0); left = 22 + Math.min(4, level); msg = "";
      const sizes = level > 1 ? [4, 3, 3, 2] : SHIPS;
      for (const size of sizes) {
        for (let attempt = 0; attempt < 200; attempt++) {
          const horizontal = e.rand() < 0.5, x = e.randInt(0, horizontal ? N - size : N - 1), y = e.randInt(0, horizontal ? N - 1 : N - size);
          const cells = Array.from({ length: size }, (_, k) => (horizontal ? y * N + x + k : (y + k) * N + x));
          if (cells.some((c) => ships.some((s) => s.cells.includes(c)))) continue;
          ships.push({ cells, hit: 0 }); break;
        }
      }
    }
    fresh();
    return {
      update(dt) {
        const i = e.input;
        if (wait > 0) { wait -= dt; if (wait <= 0) { if (over) e.over(); else { level += 1; fresh(); } } return; }
        if (i.pressed) {
          const cx = Math.floor((i.x - OX) / S), cy = Math.floor((i.y - OY) / S);
          if (cx >= 0 && cy >= 0 && cx < N && cy < N && !shots[cy * N + cx]) {
            const k = cy * N + cx, ship = ships.find((s) => s.cells.includes(k));
            left -= 1;
            if (ship) { shots[k] = 2; ship.hit += 1; e.addScore(2); if (ship.hit === ship.cells.length) { msg = "Versenkt!"; e.addScore(5); } else msg = "Treffer!"; } else { shots[k] = 1; msg = "Wasser"; }
            if (ships.every((s) => s.hit === s.cells.length)) { e.addScore(left * 2 + 10); msg = "Alle versenkt!"; wait = 1.3; }
            else if (left <= 0) { msg = "Keine Schüsse mehr"; over = true; wait = 1.4; }
          }
        }
      },
      draw() {
        e.text(msg || "Tippe ein Feld", W / 2, 100, { size: 24 });
        e.text(`Schüsse: ${left} · Schiffe: ${ships.filter((s) => s.hit < s.cells.length).length}`, W / 2, 128, { size: 16, weight: 700 });
        e.panel(OX - 4, OY - 4, N * S + 8, N * S + 8, 12, 0.55, "10,40,100");
        for (let k = 0; k < N * N; k++) {
          const x = OX + (k % N) * S, y = OY + Math.floor(k / N) * S;
          e.rect(x + 2, y + 2, S - 4, S - 4, shots[k] === 2 ? "#ff5d73" : shots[k] === 1 ? "rgba(255,255,255,0.35)" : "rgba(60,120,220,0.75)", 8);
          if (shots[k] === 2) e.text("✕", x + S / 2, y + S / 2, { size: 24 }); else if (shots[k] === 1) e.circle(x + S / 2, y + S / 2, 5, "#fff");
          if (over && !shots[k] && ships.some((s) => s.cells.includes(k))) e.rect(x + 10, y + 10, S - 20, S - 20, "rgba(255,255,255,0.7)", 6);
        }
      },
    };
  } });
})();
