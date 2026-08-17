(() => {
  const appEl = document.getElementById("kmLobbyApp");
  const code = appEl.dataset.code;
  const myUserId = parseInt(appEl.dataset.userId, 10);
  const myUsername = appEl.dataset.username;

  const roomView = document.getElementById("kmRoomView");
  const playerListEl = document.getElementById("kmPlayerList");
  const startBtn = document.getElementById("kmStartBtn");

  const socket = io();
  const players = new Map(); // user_id -> { username, ready, x, y, el }
  let myReady = false;

  function randomStart() {
    const w = roomView.clientWidth || 800;
    const h = roomView.clientHeight || 500;
    return { x: 40 + Math.random() * Math.max(w - 120, 60), y: 40 + Math.random() * Math.max(h - 120, 60) };
  }

  function ensureAvatar(userId, username) {
    let entry = players.get(userId);
    if (entry) return entry;
    const start = randomStart();
    const el = document.createElement("div");
    el.className = "km-avatar" + (userId === myUserId ? " self" : "");
    el.innerHTML = '<div class="body"></div><div class="face"></div><div class="label"></div>';
    el.querySelector(".label").textContent = username;
    roomView.appendChild(el);
    entry = { username, ready: false, x: start.x, y: start.y, el };
    positionAvatar(entry);
    players.set(userId, entry);
    return entry;
  }

  function positionAvatar(entry) {
    entry.el.style.left = entry.x + "px";
    entry.el.style.top = entry.y + "px";
  }

  function renderPlayerList() {
    playerListEl.innerHTML = "";
    for (const [userId, entry] of players.entries()) {
      const chip = document.createElement("div");
      chip.className = "km-player-chip" + (entry.ready ? " ready" : "");
      chip.innerHTML = '<span class="dot"></span><span></span>';
      chip.querySelector("span:last-child").textContent = entry.username;
      playerListEl.appendChild(chip);
    }
  }

  socket.on("connect", () => {
    socket.emit("km_join_lobby", { code });
  });

  socket.on("km_state", (state) => {
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.user_id);
      const entry = ensureAvatar(p.user_id, p.username);
      entry.ready = p.ready;
      if (p.user_id === myUserId) myReady = p.ready;
    }
    for (const userId of Array.from(players.keys())) {
      if (!seen.has(userId)) {
        players.get(userId).el.remove();
        players.delete(userId);
      }
    }
    renderPlayerList();
    startBtn.classList.toggle("active", myReady);
  });

  socket.on("km_player_moved", (data) => {
    const entry = players.get(data.user_id);
    if (!entry) return;
    entry.x = data.x;
    entry.y = data.y;
    positionAvatar(entry);
  });

  socket.on("km_player_left", (data) => {
    const entry = players.get(data.user_id);
    if (entry) {
      entry.el.remove();
      players.delete(data.user_id);
      renderPlayerList();
    }
  });

  socket.on("km_start", () => {
    window.leroxGamesSounds.start();
    setTimeout(() => {
      window.location.href = "/games/kampumion/" + code + "/room";
    }, 300);
  });

  startBtn.addEventListener("click", () => {
    myReady = !myReady;
    window.leroxGamesSounds[myReady ? "ready" : "unready"]();
    socket.emit("km_ready", { ready: myReady });
  });

  // --- Movement: WASD / arrow keys, ~15 updates/sec sent to the server ---
  const keys = { up: false, down: false, left: false, right: false };
  const KEY_MAP = {
    KeyW: "up", ArrowUp: "up",
    KeyS: "down", ArrowDown: "down",
    KeyA: "left", ArrowLeft: "left",
    KeyD: "right", ArrowRight: "right",
  };
  document.addEventListener("keydown", (e) => {
    if (KEY_MAP[e.code]) keys[KEY_MAP[e.code]] = true;
  });
  document.addEventListener("keyup", (e) => {
    if (KEY_MAP[e.code]) keys[KEY_MAP[e.code]] = false;
  });

  const SPEED = 3.2;
  let lastEmit = 0;
  function tick(ts) {
    const self = ensureAvatar(myUserId, myUsername);
    let dx = 0, dy = 0;
    if (keys.up) dy -= SPEED;
    if (keys.down) dy += SPEED;
    if (keys.left) dx -= SPEED;
    if (keys.right) dx += SPEED;
    if (dx || dy) {
      const w = roomView.clientWidth, h = roomView.clientHeight;
      self.x = Math.min(Math.max(self.x + dx, 0), Math.max(w - 40, 0));
      self.y = Math.min(Math.max(self.y + dy, 0), Math.max(h - 60, 0));
      positionAvatar(self);
      if (ts - lastEmit > 66) {
        socket.emit("km_move", { x: self.x, y: self.y });
        lastEmit = ts;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.addEventListener("beforeunload", () => {
    socket.emit("km_leave_lobby");
  });
})();
