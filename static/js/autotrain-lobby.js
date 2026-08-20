import * as THREE from "./vendor/three.module.js";
import { buildCharacter } from "./autotrain-character.js";

(() => {
  const appEl = document.getElementById("atLobbyApp");
  const code = appEl.dataset.code;
  const myUserId = parseInt(appEl.dataset.userId, 10);

  const playerListEl = document.getElementById("atPlayerList");
  const previewsEl = document.getElementById("atLobbyPreviews");
  const readyBtn = document.getElementById("atReadyBtn");

  const socket = io();
  const players = new Map(); // user_id -> { username, name, gender, ready, previewEl }
  let myReady = false;

  function makePreviewCard(p) {
    const card = document.createElement("div");
    card.className = "at-preview-card";
    const canvasHost = document.createElement("div");
    canvasHost.className = "at-preview-card-canvas";
    card.appendChild(canvasHost);
    const label = document.createElement("div");
    label.className = "at-preview-card-label";
    card.appendChild(label);
    const readyDot = document.createElement("span");
    readyDot.className = "at-preview-card-ready";
    card.appendChild(readyDot);
    previewsEl.appendChild(card);

    const width = 130, height = 170;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
    camera.position.set(0, 1.0, 2.5);
    camera.lookAt(0, 0.9, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    canvasHost.appendChild(renderer.domElement);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(2, 3, 2);
    scene.add(key);

    const character = buildCharacter(p.gender);
    scene.add(character);

    function renderFrame() {
      character.rotation.y += 0.015;
      renderer.render(scene, camera);
    }

    return { card, label, readyDot, renderFrame };
  }

  function ensureEntry(p) {
    let entry = players.get(p.user_id);
    if (entry) return entry;
    const preview = makePreviewCard(p);
    entry = { username: p.username, name: p.name, gender: p.gender, ready: false, preview };
    players.set(p.user_id, entry);
    return entry;
  }

  function renderPlayerList() {
    playerListEl.innerHTML = "";
    for (const entry of players.values()) {
      const chip = document.createElement("div");
      chip.className = "km-player-chip" + (entry.ready ? " ready" : "");
      chip.innerHTML = '<span class="dot"></span><span></span>';
      chip.querySelector("span:last-child").textContent = entry.name;
      playerListEl.appendChild(chip);
    }
  }

  socket.on("connect", () => {
    socket.emit("at_join_lobby", { code });
  });

  socket.on("at_state", (state) => {
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.user_id);
      const entry = ensureEntry(p);
      entry.ready = p.ready;
      entry.preview.label.textContent = p.name + (p.ready ? " ✓" : "");
      entry.preview.readyDot.classList.toggle("is-ready", p.ready);
      if (p.user_id === myUserId) myReady = p.ready;
    }
    for (const userId of Array.from(players.keys())) {
      if (!seen.has(userId)) {
        players.get(userId).preview.card.remove();
        players.delete(userId);
      }
    }
    renderPlayerList();
    readyBtn.classList.toggle("active", myReady);
    readyBtn.textContent = myReady ? "BEREIT ✓" : "BEREIT";
  });

  socket.on("at_player_left", (data) => {
    const entry = players.get(data.user_id);
    if (entry) {
      entry.preview.card.remove();
      players.delete(data.user_id);
      renderPlayerList();
    }
  });

  socket.on("at_start", () => {
    window.leroxGamesSounds.start();
    setTimeout(() => {
      window.location.href = "/games/autotrain/" + code + "/spiel";
    }, 300);
  });

  readyBtn.addEventListener("click", () => {
    myReady = !myReady;
    window.leroxGamesSounds[myReady ? "ready" : "unready"]();
    socket.emit("at_ready", { ready: myReady });
  });

  function animate() {
    requestAnimationFrame(animate);
    for (const entry of players.values()) entry.preview.renderFrame();
  }
  animate();

  window.addEventListener("beforeunload", () => {
    socket.emit("at_leave_lobby");
  });
})();
